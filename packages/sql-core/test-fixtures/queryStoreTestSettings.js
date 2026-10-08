/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * The settings of the Query Store fixtures: the configurations of QueryStoreTests.cs in SQL Tools
 * Service, and the settings of queryStoreCSharpOutputs.js.
 */

/** QueryStoreTests.cs: TestWindowStart = 6/10/2023 12:34:56 PM +0:00. */
const testWindowStart = new Date(Date.UTC(2023, 5, 10, 12, 34, 56));
/** QueryStoreTests.cs: TestWindowEnd = TestWindowStart + 7 days. */
const testWindowEnd = new Date(testWindowStart.getTime() + 7 * 24 * 60 * 60 * 1000);
/** QueryStoreTests.cs: TestWindowRecentStart = TestWindowEnd - 1 hour. */
const testWindowRecentStart = new Date(testWindowEnd.getTime() - 60 * 60 * 1000);

const testTimeInterval = { start: testWindowStart, end: testWindowEnd };
const recentTestTimeInterval = { start: testWindowRecentStart, end: testWindowEnd };

/** The settings that every report test of QueryStoreTests.cs uses. */
const baselineSettings = {
    returnAllQueries: true,
    selectedMetric: "waitTime",
    selectedStatistic: "stdev",
    minNumberOfQueryPlans: 1,
    topQueriesReturned: 50,
};

/** QueryStoreTests.cs: GetMockMetricFetcher. */
const mockAvailableMetrics = [
    "clrTime",
    "cpuTime",
    "dop",
    "duration",
    "executionCount",
    "logicalReads",
    "logicalWrites",
    "logMemoryUsed",
    "memoryConsumption",
    "physicalReads",
    "rowCount",
    "tempDbMemoryUsed",
    "waitTime",
];

/** The metrics of SQL Server 2016, in sys.query_store_runtime_stats column order. */
const sql2016Metrics = [
    "executionCount",
    "duration",
    "cpuTime",
    "logicalReads",
    "logicalWrites",
    "physicalReads",
    "clrTime",
    "dop",
    "memoryConsumption",
    "rowCount",
];

/** Every metric, in sys.query_store_runtime_stats column order, and wait time. */
const dbOrderMetrics = [...sql2016Metrics, "logMemoryUsed", "tempDbMemoryUsed", "waitTime"];

/** The settings of queryStoreCSharpOutputs.js. */
const harnessSettings = {
    topQueriesReturned: 7,
    minNumberOfQueryPlans: 2,
};

function addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60 * 1000);
}

/**
 * Adds declarations after the declarations of a C# query, for the variables that the C# code
 * uses but does not declare.
 */
function withDeclarations(sql, ...declarations) {
    const lines = declarations.join("\n");
    if (!sql.startsWith("DECLARE ")) {
        return `${lines}\n\n${sql}`;
    }
    const end = sql.indexOf("\n\n");
    return `${sql.slice(0, end)}\n${lines}${sql.slice(end)}`;
}

const ids = (columns) => columns.map((column) => column.id);

module.exports = {
    addMinutes,
    baselineSettings,
    dbOrderMetrics,
    harnessSettings,
    ids,
    mockAvailableMetrics,
    recentTestTimeInterval,
    sql2016Metrics,
    testTimeInterval,
    testWindowEnd,
    testWindowStart,
    withDeclarations,
};
