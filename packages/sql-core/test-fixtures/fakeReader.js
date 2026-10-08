/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * A fake SqlReader and result set builders for the run function tests.
 */

const { classifyPlatform } = require("../dist/index.js");

/**
 * Returns a reader that answers each batch with the next response. A response that is an Error
 * is thrown. `calls` has the SQL of each batch, and `options` the read options.
 */
function scriptedReader(responses) {
    const calls = [];
    const options = [];
    return {
        calls,
        options,
        read: async (sql, readOptions) => {
            calls.push(sql);
            options.push(readOptions);
            const response = responses.shift();
            if (response instanceof Error) {
                throw response;
            }
            return response ?? [];
        },
    };
}

const resultSet = (columns, rows = []) => ({ columns, rows });

/** The sys.query_store_runtime_stats column of each metric. */
const metricColumns = {
    executionCount: "count_executions",
    duration: "avg_duration",
    cpuTime: "avg_cpu_time",
    logicalReads: "avg_logical_io_reads",
    logicalWrites: "avg_logical_io_writes",
    physicalReads: "avg_physical_io_reads",
    clrTime: "avg_clr_time",
    dop: "avg_dop",
    memoryConsumption: "avg_query_max_used_memory",
    rowCount: "avg_rowcount",
    logMemoryUsed: "avg_log_bytes_used",
    tempDbMemoryUsed: "avg_tempdb_space_used",
};

/** SQL Server 2016 metrics, in column order. */
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

/** Every metric, in column order, and wait time. */
const allMetrics = [...sql2016Metrics, "logMemoryUsed", "tempDbMemoryUsed", "waitTime"];

/**
 * The result sets of the probe batch.
 *
 * @param state `actual_state`: 0 OFF, 1 READ_ONLY, 2 READ_WRITE, 3 ERROR.
 * @param metrics The metrics, or undefined when the run does not read them.
 * @param replicaColumn True or false for the replica column probe, or undefined when the run
 * does not read it.
 * @param planColumns `{ forcingType, planType }` when the run reads the plan columns.
 * @param oldestInterval The start of the oldest interval, or null for none, when the run reads it.
 */
function probe({
    state = 2,
    readOnlyReason = 0,
    metrics,
    replicaColumn = false,
    planColumns,
    oldestInterval,
} = {}) {
    const sets = [resultSet(["actual_state", "readonly_reason"], [[state, readOnlyReason]])];
    if (metrics) {
        sets.push(
            resultSet([
                "runtime_stats_id",
                "plan_id",
                "first_execution_time",
                ...metrics.filter((metric) => metric !== "waitTime").map((m) => metricColumns[m]),
            ]),
        );
        sets.push(resultSet(["result"], [[metrics.includes("waitTime")]]));
    }
    if (replicaColumn !== undefined) {
        sets.push(resultSet(["ReplicaColumnExists"], [[replicaColumn ? 1 : 0]]));
    }
    if (planColumns) {
        sets.push(
            resultSet(
                ["has_plan_forcing_type", "has_plan_type"],
                [[planColumns.forcingType ? 1 : 0, planColumns.planType ? 1 : 0]],
            ),
        );
    }
    if (oldestInterval !== undefined) {
        sets.push(resultSet(["oldest_interval_start"], [[oldestInterval]]));
    }
    return sets;
}

const platforms = {
    sql2014: classifyPlatform({ engineEdition: 3, productVersion: "12.0.6024.0" }),
    sql2016: classifyPlatform({ engineEdition: 3, productVersion: "13.0.6300.2" }),
    sql2019: classifyPlatform({ engineEdition: 3, productVersion: "15.0.4153.1" }),
    sql2022: classifyPlatform({ engineEdition: 3, productVersion: "16.0.4135.4" }),
    azureSql: classifyPlatform({ engineEdition: 5 }),
    managedInstance: classifyPlatform({ engineEdition: 8 }),
    fabricSqlDatabase: classifyPlatform({ engineEdition: 12 }),
    synapseDedicated: classifyPlatform({ engineEdition: 6 }),
    synapseServerless: classifyPlatform({ engineEdition: 11 }),
    fabricWarehouse: classifyPlatform({ engineEdition: 11, dataLakeLogPublishing: "AUTO" }),
    sqlAnalyticsEndpoint: classifyPlatform({
        engineEdition: 11,
        dataLakeLogPublishing: "UNSUPPORTED",
    }),
    unknown: classifyPlatform({ engineEdition: 99 }),
};

module.exports = { allMetrics, platforms, probe, resultSet, scriptedReader, sql2016Metrics };
