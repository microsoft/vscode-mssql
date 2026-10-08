/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    appendQueryHints,
    classifyPlatform,
    maxDopOneHint,
    sessionPreamble,
} = require("../dist/index.js");
const {
    buildSqlEngineActivityQuery,
    buildTopQueriesPlan,
} = require("../dist/performance/index.js");

const azureSql = classifyPlatform({ engineEdition: 5 });
const fabricWarehouse = classifyPlatform({ engineEdition: 11, dataLakeLogPublishing: "AUTO" });
const synapseDedicated = classifyPlatform({ engineEdition: 6 });

suite("session preamble", () => {
    test("reads without shared locks, with a short lock timeout and low deadlock priority", () => {
        assert.equal(
            sessionPreamble(azureSql),
            [
                "SET NOCOUNT ON;",
                "SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;",
                "SET LOCK_TIMEOUT 5000;",
                "SET DEADLOCK_PRIORITY LOW;",
            ].join("\n"),
        );
    });

    test("uses READ COMMITTED and a longer timeout for a change", () => {
        const preamble = sessionPreamble(azureSql, "change");
        assert.match(preamble, /READ COMMITTED;/);
        assert.match(preamble, /SET LOCK_TIMEOUT 10000;/);
        assert.match(preamble, /SET DEADLOCK_PRIORITY LOW;/);
    });

    test("accepts a lock timeout in range only", () => {
        assert.match(sessionPreamble(azureSql, "read", { lockTimeoutMs: 0 }), /LOCK_TIMEOUT 0;/);
        assert.throws(() => sessionPreamble(azureSql, "read", { lockTimeoutMs: -1 }), RangeError);
        assert.throws(() => sessionPreamble(azureSql, "read", { lockTimeoutMs: 1.5 }), RangeError);
    });

    test("uses only NOCOUNT where the options are not supported or not confirmed", () => {
        assert.equal(sessionPreamble(fabricWarehouse), "SET NOCOUNT ON;");
        assert.equal(sessionPreamble(synapseDedicated), "SET NOCOUNT ON;");
        assert.equal(maxDopOneHint(fabricWarehouse), "");
        assert.equal(maxDopOneHint(azureSql), "\nOPTION (MAXDOP 1)");
    });
});

suite("query hints", () => {
    test("appends an OPTION clause", () => {
        assert.equal(
            appendQueryHints("SELECT 1 FROM t;  ", ["MAXDOP 1"]),
            "SELECT 1 FROM t\nOPTION (MAXDOP 1);",
        );
    });

    test("merges into an existing OPTION clause", () => {
        assert.equal(
            appendQueryHints("SELECT 1 FROM t\nOPTION (MERGE JOIN)", ["MAXDOP 1"]),
            "SELECT 1 FROM t\nOPTION (MERGE JOIN, MAXDOP 1);",
        );
    });

    test("does nothing without hints", () => {
        assert.equal(appendQueryHints("SELECT 1", []), "SELECT 1");
    });
});

suite("providers use the preamble", () => {
    test("active requests read without locks and on one CPU", () => {
        const sql = buildSqlEngineActivityQuery(azureSql);
        assert.match(sql, /READ UNCOMMITTED/);
        assert.equal((sql.match(/OPTION \(MAXDOP 1\)/g) ?? []).length, 2);
    });

    test("top queries read without locks and on one CPU", () => {
        const plan = buildTopQueriesPlan(azureSql, {
            metric: "cpu",
            start: new Date(Date.UTC(2026, 9, 8, 5)),
            end: new Date(Date.UTC(2026, 9, 8, 6)),
            top: 5,
        });
        assert.match(plan.sql, /READ UNCOMMITTED/);
        assert.match(plan.sql, /OPTION \(MAXDOP 1\);/);
    });

    test("Query Insights reads use only NOCOUNT", () => {
        const plan = buildTopQueriesPlan(fabricWarehouse, {
            metric: "cpu",
            start: new Date(Date.UTC(2026, 9, 8, 5)),
            end: new Date(Date.UTC(2026, 9, 8, 6)),
            top: 5,
        });
        assert.doesNotMatch(plan.sql, /ISOLATION LEVEL|MAXDOP/);
    });
});
