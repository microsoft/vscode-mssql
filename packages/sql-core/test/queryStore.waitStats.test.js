/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    aggWaitTimePerQueryForWaitCategoryId,
    aggWaitTimePerQueryForWaitCategoryIdToolTip,
    aggWaitTimePerWaitCategory,
    getAggWaitTimePerQueryForWaitCategoryReportQuery,
    getAggWaitTimePerQueryForWaitCategoryToolTipQuery,
    getAggWaitTimePerWaitCategoryReportQuery,
    getTotalWaitTimePerWaitCategoryForQueryIdToolTipQuery,
    totalWaitTimePerWaitCategoryForQueryId,
} = require("../dist/performance/index.js");
const csharp = require("../test-fixtures/queryStoreCSharpOutputs.js");
const { ids, testTimeInterval } = require("../test-fixtures/queryStoreTestSettings.js");

const intervalDeclarations =
    "DECLARE @interval_start_time DATETIMEOFFSET = '2023-06-10T12:34:56.0000000+00:00';\n" +
    "DECLARE @interval_end_time DATETIMEOFFSET = '2023-06-17T12:34:56.0000000+00:00';\n";

function config(selectedStatistic, all, isQdsRoAvailable) {
    return {
        selectedMetric: "waitTime",
        selectedStatistic,
        returnAllWaitCategories: all,
        returnAllQueries: all,
        isQdsRoAvailable,
        timeInterval: testTimeInterval,
    };
}

suite("Query Wait Stats", () => {
    test("matches the C# wait time per category", () => {
        assert.equal(
            aggWaitTimePerWaitCategory(config("total", false, true)).sql,
            csharp.waitStatsPerCategoryTotalTopReplicaGenerator,
        );
        const sorted = config("avg", true, false);
        const { columns } = aggWaitTimePerWaitCategory(sorted);
        assert.equal(
            aggWaitTimePerWaitCategory(sorted, columns[3], false).sql,
            csharp.waitStatsPerCategoryAvgAllSortedGenerator,
        );
        assert.deepEqual(
            columns.map((column) => column.id + (column.bindRuntimeData ? "*" : "")),
            [
                "wait_category",
                "wait_category_desc",
                "avg_query_wait_time*",
                "min_query_wait_time",
                "max_query_wait_time",
                "stdev_query_wait_time",
                "total_query_wait_time",
                "count_executions",
            ],
        );
    });

    test("matches the C# wait time per query, sorted by the statistic by default", () => {
        assert.equal(
            aggWaitTimePerQueryForWaitCategoryId(config("avg", false, false)).sql,
            csharp.waitStatsPerQueryAvgTopDefaultSortGenerator,
        );
        assert.equal(
            aggWaitTimePerQueryForWaitCategoryIdToolTip(config("total", false, true)),
            csharp.waitStatsPerQueryTooltipReplicaGenerator,
        );
        assert.equal(
            totalWaitTimePerWaitCategoryForQueryId({ isQdsRoAvailable: true }),
            csharp.waitStatsTotalPerCategoryReplicaGenerator,
        );
    });

    test("declares the parameters of the report queries", () => {
        const perCategory = getAggWaitTimePerWaitCategoryReportQuery(
            { ...config("total", false, true), topWaitCategoriesReturned: 5 },
            "total_query_wait_time",
        );
        assert.equal(
            perCategory,
            `${intervalDeclarations}DECLARE @results_row_count INT = 5;\nDECLARE @replica_group_id BIGINT = 1;\n\n` +
                `${csharp.waitStatsPerCategoryTotalTopReplicaGenerator}\nORDER BY total_query_wait_time DESC`,
        );

        const perQuery = getAggWaitTimePerQueryForWaitCategoryReportQuery(
            { ...config("avg", false, false), topQueriesReturned: 7 },
            3,
            "avg_query_wait_time",
        );
        assert.equal(
            perQuery,
            `DECLARE @wait_category INT = 3;\n${intervalDeclarations}DECLARE @results_row_count INT = 7;\n\n` +
                csharp.waitStatsPerQueryAvgTopDefaultSortGenerator,
        );
        assert.throws(
            () =>
                getAggWaitTimePerQueryForWaitCategoryReportQuery(config("avg", false, false), 1.5),
            RangeError,
        );
    });

    test("returns the tooltip queries only when the C# code has a tooltip", () => {
        const waitStats = {
            ...config("total", false, true),
            isExtendedDataForToolTipAvailable: true,
        };
        assert.equal(
            getAggWaitTimePerQueryForWaitCategoryToolTipQuery(waitStats, 14),
            `DECLARE @wait_category INT = 14;\n${intervalDeclarations}DECLARE @results_row_count INT = 10;\nDECLARE @replica_group_id BIGINT = 1;\n\n` +
                csharp.waitStatsPerQueryTooltipReplicaGenerator,
        );
        assert.equal(
            getAggWaitTimePerQueryForWaitCategoryToolTipQuery(config("total", false, true), 14),
            undefined,
        );

        const trc = {
            selectedMetric: "waitTime",
            isQdsRoAvailable: true,
            timeInterval: testTimeInterval,
        };
        assert.equal(
            getTotalWaitTimePerWaitCategoryForQueryIdToolTipQuery(trc, "42"),
            `DECLARE @query_id BIGINT = 42;\n${intervalDeclarations}DECLARE @replica_group_id BIGINT = 1;\n\n` +
                csharp.waitStatsTotalPerCategoryReplicaGenerator,
        );
        assert.equal(
            getTotalWaitTimePerWaitCategoryForQueryIdToolTipQuery(
                { ...trc, selectedStatistic: "avg" },
                42,
            ),
            undefined,
        );
        assert.equal(
            getTotalWaitTimePerWaitCategoryForQueryIdToolTipQuery(
                { ...trc, selectedMetric: "duration" },
                42,
            ),
            undefined,
        );
        assert.throws(
            () => getTotalWaitTimePerWaitCategoryForQueryIdToolTipQuery(trc, "42 OR 1=1"),
            RangeError,
        );
    });

    test("uses the C# defaults", () => {
        const now = new Date(Date.UTC(2026, 9, 8, 6, 0, 0));
        const sql = getAggWaitTimePerWaitCategoryReportQuery({}, undefined, true, now);
        assert.ok(
            sql.startsWith(
                "DECLARE @interval_start_time DATETIMEOFFSET = '2026-10-08T05:00:00.0000000+00:00';\n" +
                    "DECLARE @interval_end_time DATETIMEOFFSET = '2026-10-08T06:00:00.0000000+00:00';\n" +
                    "DECLARE @results_row_count INT = 10;\n\nSELECT TOP (@results_row_count)\n",
            ),
        );
        assert.match(sql, /\nORDER BY wait_category DESC$/);
        assert.equal(ids(aggWaitTimePerWaitCategory({}).columns)[6], "total_query_wait_time");
        assert.equal(aggWaitTimePerWaitCategory({}).columns[6].bindRuntimeData, true);
    });
});
