/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    alterFromCreateScript,
    availableReplicasQuery,
    calculateCaretPosition,
    getContainingObjectDefinitionQuery,
    getQueryStoreReadOnlyReason,
    getQueryTextQuery,
    getShowPlanXmlQuery,
    isReadOnlyOrReadCapture,
    mapAvailableReplicas,
    mapQueryStoreOperationalMode,
    mapQueryTextRow,
    mapReplicaGroupColumnProbe,
    queryStoreOperationalModeQuery,
    replicaGroupColumnProbeQuery,
    resolveQueryText,
} = require("../dist/performance/index.js");

const resultSet = (columns, rows) => ({ columns, rows });

suite("Query Store replicas", () => {
    test("keeps the C# probe text", () => {
        assert.ok(replicaGroupColumnProbeQuery.startsWith("\nSELECT CASE WHEN EXISTS(\n"));
        assert.ok(
            replicaGroupColumnProbeQuery.endsWith("\nTHEN 1 ELSE 0 END as ReplicaColumnExists;"),
        );
        assert.ok(availableReplicasQuery.includes("SELECT r.replica_name, r.replica_group_id  \n"));
    });

    test("maps the replica group column probe", () => {
        const probe = (value) =>
            mapReplicaGroupColumnProbe([resultSet(["ReplicaColumnExists"], [[value]])]);
        assert.equal(probe(1), true);
        assert.equal(probe(true), true);
        assert.equal(probe(0), false);
        assert.equal(mapReplicaGroupColumnProbe([resultSet(["ReplicaColumnExists"], [])]), false);
        assert.equal(mapReplicaGroupColumnProbe([]), false);
    });

    test("returns the four replica groups when the replica table is empty", () => {
        assert.deepEqual(
            mapAvailableReplicas([
                resultSet(["ReplicaCount"], [[0]]),
                resultSet(["replica_name", "replica_group_id"], []),
            ]),
            [
                { replicaGroupId: "1", replicaName: "Primary" },
                { replicaGroupId: "2", replicaName: "Secondary" },
                { replicaGroupId: "3", replicaName: "GeoSecondary" },
                { replicaGroupId: "4", replicaName: "GeoHASecondary" },
            ],
        );
    });

    test("returns the replicas with runtime stats, and the primary first when it is missing", () => {
        assert.deepEqual(
            mapAvailableReplicas([
                resultSet(["ReplicaCount"], [[3]]),
                resultSet(
                    ["replica_name", "replica_group_id"],
                    [
                        ["Secondary A", "2"],
                        ["Geo", 3],
                    ],
                ),
            ]),
            [
                { replicaGroupId: "1", replicaName: "Primary" },
                { replicaGroupId: "2", replicaName: "Secondary A" },
                { replicaGroupId: "3", replicaName: "Geo" },
            ],
        );
        assert.deepEqual(
            mapAvailableReplicas([
                resultSet(["ReplicaCount"], [[2]]),
                resultSet(
                    ["replica_name", "replica_group_id"],
                    [
                        ["Main", 1],
                        ["", 2],
                        ["Late", 3],
                    ],
                ),
            ]),
            [{ replicaGroupId: "1", replicaName: "Main" }],
        );
        assert.deepEqual(mapAvailableReplicas([]), [
            { replicaGroupId: "1", replicaName: "Primary" },
        ]);
    });
});

suite("Query Store operational mode", () => {
    test("maps the state and the read-only reason", () => {
        assert.equal(
            queryStoreOperationalModeQuery,
            "SELECT actual_state, readonly_reason FROM sys.database_query_store_options",
        );
        const mode = mapQueryStoreOperationalMode([
            resultSet(["actual_state", "readonly_reason"], [[1, 65536]]),
        ]);
        assert.deepEqual(mode, { operationalStatus: "readOnly", readOnlyReason: 65536 });
        assert.equal(isReadOnlyOrReadCapture(mode), true);
        assert.deepEqual(
            mapQueryStoreOperationalMode([
                resultSet(["actual_state", "readonly_reason"], [[3, 0]]),
            ]),
            { operationalStatus: "off", readOnlyReason: 0 },
        );
        assert.deepEqual(mapQueryStoreOperationalMode([]), {
            operationalStatus: "off",
            readOnlyReason: 0,
        });
        assert.equal(
            mapQueryStoreOperationalMode([resultSet(["actual_state", "readonly_reason"], [[4, 0]])])
                .operationalStatus,
            "readCapture",
        );
    });

    test("picks the read-only reason in the C# order", () => {
        assert.equal(getQueryStoreReadOnlyReason(0), undefined);
        assert.equal(getQueryStoreReadOnlyReason(1), "dbReadOnly");
        assert.equal(getQueryStoreReadOnlyReason(3), "dbInSingleUserMode");
        assert.equal(getQueryStoreReadOnlyReason(12), "dbInLogAcceptMode");
        assert.equal(getQueryStoreReadOnlyReason(0x30001), "stmtHashMapMemoryLimit");
        // The C# code shows the database read-only text for this flag.
        assert.equal(getQueryStoreReadOnlyReason(0x10008), "diskSizeLimit");
    });
});

suite("Query text", () => {
    test("declares the IDs of the query text queries", () => {
        assert.equal(
            getQueryTextQuery(42),
            "DECLARE @Query_ID BIGINT = 42;\n\nSELECT q.object_id, qt.query_sql_text\n" +
                "                        FROM sys.query_store_query q, sys.query_store_query_text qt\n" +
                "                        WHERE q.query_id = @Query_ID AND q.query_text_id = qt.query_text_id",
        );
        assert.equal(
            getContainingObjectDefinitionQuery("123456789012"),
            "DECLARE @Object_ID BIGINT = 123456789012;\n\nselect definition from sys.sql_modules where object_id = @Object_ID",
        );
        assert.equal(
            getShowPlanXmlQuery(7),
            "DECLARE @plan_id BIGINT = 7;\n\nselect query_plan from sys.query_store_plan where plan_id = @plan_id",
        );
        assert.throws(() => getQueryTextQuery("1 OR 1=1"), RangeError);
    });

    test("resolves the text of a query in a module", () => {
        const definition = "CREATE PROCEDURE p\nAS\nSELECT 1";
        const row = mapQueryTextRow([
            resultSet(["object_id", "query_sql_text"], [["1977058079", "SELECT 1"]]),
        ]);
        assert.deepEqual(row, { objectId: "1977058079", queryText: "SELECT 1" });
        assert.deepEqual(resolveQueryText(row, [resultSet(["definition"], [[definition]])]), {
            kind: "containingObject",
            script: "ALTER PROCEDURE p\nAS\nSELECT 1",
            coordinates: { startLine: 2, startColumn: 0, endLine: 2, endColumn: 8 },
        });
        assert.deepEqual(resolveQueryText(row, [resultSet(["definition"], [])]), {
            kind: "containingObjectNotFound",
            queryText: "SELECT 1",
        });
        assert.deepEqual(
            resolveQueryText(row, [
                resultSet(["definition"], [["CREATE PROCEDURE p AS SELECT 2"]]),
            ]),
            {
                kind: "queryNotInContainingObject",
                queryText: "SELECT 1",
            },
        );
        assert.deepEqual(resolveQueryText({ objectId: "0", queryText: "SELECT 3" }), {
            kind: "queryText",
            text: "SELECT 3",
        });
        assert.deepEqual(mapQueryTextRow([resultSet(["object_id", "query_sql_text"], [])]), {
            objectId: "0",
            queryText: "",
        });
    });

    test("replaces the first create like the C# code, even in a comment", () => {
        assert.equal(
            alterFromCreateScript("create proc p as select 1"),
            "ALTER proc p as select 1",
        );
        assert.equal(
            alterFromCreateScript("-- Created by me\nCREATE PROCEDURE p AS SELECT 1"),
            "-- ALTERd by me\nCREATE PROCEDURE p AS SELECT 1",
        );
        assert.equal(
            alterFromCreateScript("ALTER PROCEDURE p AS SELECT 1"),
            "ALTER PROCEDURE p AS SELECT 1",
        );
    });

    test("finds the caret position like the C# code on Windows", () => {
        // The C# results for the same text with "\r\n" line breaks.
        const cases = [
            ["CREATE PROCEDURE p\nAS\nSELECT 1", "SELECT 1", [2, 0, 2, 8]],
            [
                "CREATE PROCEDURE p\nAS\nBEGIN\n    SELECT a,\n        b\n    FROM t\nEND",
                "SELECT a,\n        b\n    FROM t",
                [3, 4, 5, 10],
            ],
            ["CREATE PROCEDURE p\nAS\nSELECT SELECT 1\nSELECT 2", "SELECT 2", [3, 0, 3, 8]],
            ["CREATE PROCEDURE p AS\nSELECT 1", "SELECT 1", [1, 0, 1, 8]],
            ["CREATE PROCEDURE p\nAS\n  SELECT\nx SELECT\ny", "SELECT\ny", [3, 2, 4, 1]],
        ];
        for (const [parent, query, [startLine, startColumn, endLine, endColumn]] of cases) {
            assert.deepEqual(calculateCaretPosition(parent, query), {
                startLine,
                startColumn,
                endLine,
                endColumn,
            });
            assert.deepEqual(
                calculateCaretPosition(parent.replace(/\n/g, "\r\n"), query.replace(/\n/g, "\r\n")),
                { startLine, startColumn, endLine, endColumn },
            );
        }
        // The C# code throws when the query is on the first line.
        assert.deepEqual(calculateCaretPosition("CREATE PROC p AS SELECT 1", "SELECT 1"), {
            startLine: 0,
            startColumn: 17,
            endLine: 0,
            endColumn: 25,
        });
    });
});
