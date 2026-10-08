/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    forcedPlanQueriesSummary,
    getForcedPlanQueriesReportQuery,
    getTrackedQueriesReportQuery,
    queryIdSearchQuery,
} = require("../dist/performance/index.js");
const baselines = require("../test-fixtures/queryStoreBaselines.js");
const csharp = require("../test-fixtures/queryStoreCSharpOutputs.js");
const {
    baselineSettings,
    harnessSettings,
    testTimeInterval,
    withDeclarations,
} = require("../test-fixtures/queryStoreTestSettings.js");

suite("Forced Plans", () => {
    test("matches the SQL Tools Service baseline", () => {
        // QueryStoreTests.cs: the ForcedPlanQueries test. It returns all queries, so there is
        // nothing to declare.
        const sql = getForcedPlanQueriesReportQuery(
            { ...baselineSettings, timeInterval: testTimeInterval },
            "query_id",
            true,
        );
        assert.equal(sql, baselines.handleGetForcedPlanQueriesReportRequest);
        assert.equal(getForcedPlanQueriesReportQuery({}), csharp.forcedPlansDefaults);
    });

    test("declares the row count as text, and sorts last_execution_time by query", () => {
        const sql = getForcedPlanQueriesReportQuery(
            { ...harnessSettings, returnAllQueries: false, replicaGroupId: 2 },
            "last_execution_time",
            false,
        );
        assert.equal(
            sql,
            withDeclarations(
                csharp.forcedPlansTopSecondarySortByLastExecution,
                "DECLARE @replica_group_id BIGINT = 2;",
            ),
        );
        assert.match(sql, /^DECLARE @results_row_count NVARCHAR\(max\) = N'7';$/m);
        assert.match(sql, /\nORDER BY B\.last_execution_time ASC$/);
    });

    test("sorts by the forced plan's last execution in the generator function", () => {
        const { columns } = forcedPlanQueriesSummary({});
        assert.equal(columns[8].kind, "lastForcedPlanExecTime");
        assert.equal(
            forcedPlanQueriesSummary({}, columns[8], false).sql,
            csharp.forcedPlansSortByForcedPlanLastExecutionGenerator,
        );
    });

    test("returns both last execution columns", () => {
        const { columns } = forcedPlanQueriesSummary({});
        assert.deepEqual(
            columns.map((column) => column.kind),
            [
                "queryId",
                "queryText",
                "forcedPlanId",
                "forcedPlanFailureCount",
                "lastCompileStartTime",
                "forcedPlanFailureDescription",
                "numPlans",
                "lastQueryExecTime",
                "lastForcedPlanExecTime",
                "objectId",
                "objectName",
            ],
        );
    });

    test("rejects values that are not valid", () => {
        assert.throws(
            () => getForcedPlanQueriesReportQuery({ replicaGroupId: "2 OR 1=1" }),
            RangeError,
        );
        assert.throws(
            () =>
                getForcedPlanQueriesReportQuery({
                    returnAllQueries: false,
                    topQueriesReturned: 1.5,
                }),
            RangeError,
        );
        assert.throws(() => getForcedPlanQueriesReportQuery({}, "plan_id; --"), RangeError);
    });
});

suite("Tracked Queries", () => {
    test("matches the SQL Tools Service baseline", () => {
        assert.equal(
            getTrackedQueriesReportQuery("test search text"),
            baselines.handleGetTrackedQueriesReportRequest,
        );
    });

    test("escapes quotes in the search text", () => {
        assert.equal(
            getTrackedQueriesReportQuery("O'Brien's ''query''"),
            csharp.trackedQueriesQuotes,
        );
        assert.match(csharp.trackedQueriesQuotes, /N'O''Brien''s ''''query'''''/);
        assert.throws(() => getTrackedQueriesReportQuery("a\0b"), RangeError);
        assert.throws(() => getTrackedQueriesReportQuery(42), RangeError);
    });

    test("keeps the trailing spaces of the C# query", () => {
        assert.equal(
            queryIdSearchQuery().split("\n")[0],
            "SELECT TOP 500 q.query_id, q.query_text_id, qt.query_sql_text ",
        );
    });
});
