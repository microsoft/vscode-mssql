/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { SqlReadError, classifyPlatform } = require("../dist/index.js");
const {
    buildBlockingChains,
    buildSqlEngineActivityQuery,
    getActiveRequests,
} = require("../dist/performance/index.js");

const now = new Date(Date.UTC(2026, 9, 8, 6, 0, 0));

function scriptedReader(responses) {
    const calls = [];
    return {
        calls,
        read: async (sql) => {
            calls.push(sql);
            const response = responses.shift();
            if (response instanceof Error) {
                throw response;
            }
            return response ?? [];
        },
    };
}

const requestColumns = [
    "session_id",
    "request_id",
    "status",
    "command",
    "elapsed_ms",
    "wait_type",
    "wait_ms",
    "blocking_session_id",
    "granted_memory_pages",
    "statement_text",
];

suite("blocking chains", () => {
    test("finds the head blocker, the intermediate, and the blocked sessions", () => {
        const summary = buildBlockingChains(
            [
                { sessionId: "64", status: "running" },
                { sessionId: "77", status: "suspended", blockingSessionId: "64" },
                { sessionId: "81", status: "suspended", blockingSessionId: "77" },
                { sessionId: "85", status: "suspended", blockingSessionId: "77" },
            ],
            [],
        );
        assert.equal(summary.blockedCount, 3);
        assert.equal(summary.chains.length, 1);
        const [head] = summary.chains;
        assert.equal(head.sessionId, "64");
        assert.equal(head.role, "headBlocker");
        assert.equal(head.children[0].role, "intermediate");
        assert.deepEqual(
            head.children[0].children.map((node) => [node.sessionId, node.role]),
            [
                ["81", "blocked"],
                ["85", "blocked"],
            ],
        );
    });

    test("uses the idle session for a head blocker with no request", () => {
        const summary = buildBlockingChains(
            [{ sessionId: "90", blockingSessionId: "55" }],
            [{ sessionId: "55", status: "sleeping", openTransactionCount: 1 }],
        );
        const [head] = summary.chains;
        assert.equal(head.sessionId, "55");
        assert.equal(head.request, undefined);
        assert.equal(head.idleSession.status, "sleeping");
    });

    test("reports owners that are not sessions", () => {
        const summary = buildBlockingChains([{ sessionId: "70", blockingSessionId: "-2" }], []);
        assert.equal(summary.chains.length, 0);
        assert.equal(summary.blockedCount, 1);
        assert.deepEqual(summary.nonSessionBlockers, [{ sessionId: "70", blockerCode: "-2" }]);
    });

    test("ends a cycle at the lowest session", () => {
        const summary = buildBlockingChains(
            [
                { sessionId: "60", blockingSessionId: "61" },
                { sessionId: "61", blockingSessionId: "60" },
            ],
            [],
        );
        assert.equal(summary.chains.length, 1);
        assert.equal(summary.chains[0].sessionId, "60");
        assert.equal(summary.chains[0].children[0].sessionId, "61");
    });
});

suite("active requests", () => {
    test("checks the version-specific permission", () => {
        assert.match(
            buildSqlEngineActivityQuery(
                classifyPlatform({ engineEdition: 3, productVersion: "16.0.1000.6" }),
            ),
            /VIEW SERVER PERFORMANCE STATE/,
        );
        assert.match(
            buildSqlEngineActivityQuery(
                classifyPlatform({ engineEdition: 3, productVersion: "15.0.2000.5" }),
            ),
            /'VIEW SERVER STATE'/,
        );
        assert.match(
            buildSqlEngineActivityQuery(classifyPlatform({ engineEdition: 5 })),
            /'VIEW DATABASE STATE'/,
        );
    });

    test("reads requests, idle blockers, and their last statement on Azure SQL Database", async () => {
        const reader = scriptedReader([
            [
                { columns: ["has_permission"], rows: [[1]] },
                {
                    columns: requestColumns,
                    rows: [
                        [
                            "90",
                            "0",
                            "suspended",
                            "SELECT",
                            4000,
                            "LCK_M_S",
                            3900,
                            "55",
                            4,
                            "SELECT 1",
                        ],
                    ],
                },
                {
                    columns: ["session_id", "status", "open_transaction_count"],
                    rows: [["55", "sleeping", 1]],
                },
            ],
            [
                {
                    columns: ["session_id", "last_statement_text"],
                    rows: [["55", "UPDATE t SET c = 1"]],
                },
            ],
        ]);
        const result = await getActiveRequests(
            reader,
            classifyPlatform({ engineEdition: 5 }),
            undefined,
            now,
        );
        assert.equal(result.status, "ready");
        assert.equal(result.scope, "database");
        assert.match(reader.calls[1], /WHERE c\.session_id IN \(55\)/);
        const [request] = result.data.requests;
        assert.equal(request.grantedMemoryKb, 32);
        assert.equal(request.blockingSessionId, "55");
        const [head] = result.data.blocking.chains;
        assert.equal(head.idleSession.lastStatementText, "UPDATE t SET c = 1");
    });

    test("keeps the result when the idle statement text is not permitted", async () => {
        const reader = scriptedReader([
            [
                { columns: ["has_permission"], rows: [[1]] },
                {
                    columns: requestColumns,
                    rows: [["90", "0", "suspended", "SELECT", 1, null, 0, "55", 0, null]],
                },
                { columns: ["session_id", "status"], rows: [["55", "sleeping"]] },
            ],
            new SqlReadError("VIEW SERVER STATE permission denied", "server", 300),
        ]);
        const result = await getActiveRequests(
            reader,
            classifyPlatform({ engineEdition: 5 }),
            undefined,
            now,
        );
        assert.equal(result.status, "ready");
        assert.deepEqual(result.missing, ["statementText"]);
    });

    test("returns selfOnly without the permission", async () => {
        const reader = scriptedReader([
            [
                { columns: ["has_permission"], rows: [[0]] },
                { columns: requestColumns, rows: [] },
                { columns: ["session_id"], rows: [] },
            ],
        ]);
        const result = await getActiveRequests(
            reader,
            classifyPlatform({ engineEdition: 3, productVersion: "16.0.1000.6" }),
            undefined,
            now,
        );
        assert.equal(result.status, "selfOnly");
        assert.equal(result.scope, "instance");
    });

    test("reads queued requests and lock waits on Synapse dedicated pools", async () => {
        const reader = scriptedReader([
            [
                {
                    columns: [
                        "request_id",
                        "session_id",
                        "status",
                        "start_time",
                        "elapsed_ms",
                        "label",
                        "resource_class",
                        "statement_text",
                    ],
                    rows: [
                        [
                            "QID10",
                            "SID1",
                            "Running",
                            "2026-10-08T05:59:00",
                            60000,
                            null,
                            "smallrc",
                            "INSERT ...",
                        ],
                        ["QID11", "SID2", "Suspended", null, 0, "load", "smallrc", "SELECT ..."],
                    ],
                },
                {
                    columns: [
                        "request_id",
                        "object_type",
                        "object_name",
                        "wait_type",
                        "blocking_session_id",
                    ],
                    rows: [["QID11", "OBJECT", "[db].[dbo].[t]", "Shared", "SID1"]],
                },
            ],
        ]);
        const result = await getActiveRequests(
            reader,
            classifyPlatform({ engineEdition: 6 }),
            undefined,
            now,
        );
        assert.equal(result.source, "pdwDmv");
        assert.equal(result.scope, "pool");
        assert.deepEqual(result.missing, ["cpuReadsAndMemory"]);
        const queued = result.data.requests.find((request) => request.requestId === "QID11");
        assert.equal(queued.queued, true);
        assert.equal(queued.blockingSessionId, "SID1");
        assert.equal(queued.waitResource, "OBJECT [db].[dbo].[t]");
        assert.equal(result.data.blocking.chains[0].sessionId, "SID1");
    });

    test("reports the gaps on Fabric Warehouse", async () => {
        const reader = scriptedReader([
            [
                { columns: requestColumns, rows: [] },
                { columns: ["session_id"], rows: [] },
            ],
        ]);
        const result = await getActiveRequests(
            reader,
            classifyPlatform({ engineEdition: 11, dataLakeLogPublishing: "AUTO" }),
            undefined,
            now,
        );
        assert.equal(result.scope, "item");
        assert.deepEqual(result.missing, ["statementText", "otherUsersRequests"]);
        assert.doesNotMatch(reader.calls[0], /dm_exec_sql_text/);
    });

    test("returns unsupported for an unknown platform", async () => {
        const result = await getActiveRequests(
            scriptedReader([]),
            classifyPlatform({ engineEdition: 9 }),
            undefined,
            now,
        );
        assert.equal(result.status, "unsupported");
    });
});
