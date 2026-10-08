/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    QueryStoreColumnInfo,
    QueryStoreQuery,
    simpleColumnInfo,
    statisticMetricColumnInfo,
} from "./common/columnInfo";
import {
    QueryConfigurationBase,
    ResolvedQueryConfigurationBase,
    resolveQueryConfigurationBase,
} from "./common/configuration";
import { QueryStoreMetric, assertQueryStoreMetric, metricQueryString } from "./common/metric";
import { getRuntimeStatsSummary, queryStoreParameters } from "./common/queryGeneratorUtils";
import { replicaGroupIdParameter, withUsedParameters } from "./common/reportParameters";
import { prependSqlParameters, timeIntervalParameters } from "./common/sqlParameters";
import {
    BucketInterval,
    QueryStoreTimeInterval,
    calculateGoodSubInterval,
    dateFunctionIntervalString,
    resolveTimeInterval,
} from "./common/timeInterval";
import { appendOrderBy } from "./common/utils";

/*
 * Port of OverallResourceConsumptionQueryGenerator and the Overall Resource Consumption function
 * of QueryStoreQueryGenerator from SQL Tools Service. The report has one row for each time
 * bucket, with the total of each metric.
 */

export interface OverallResourceConsumptionConfiguration extends QueryConfigurationBase {
    /** Default `{ option: "lastMonth" }`. */
    readonly specifiedTimeInterval?: QueryStoreTimeInterval;
    /** Default `"automatic"`, which picks a size from the length of the time interval. */
    readonly selectedBucketInterval?: BucketInterval;
    /**
     * The metrics that the report shows. Default `["duration", "executionCount", "cpuTime",
     * "logicalReads"]`. The C# code keeps them for the charts. They do not change the SQL, which
     * has every available metric.
     */
    readonly selectedMetrics?: readonly QueryStoreMetric[];
}

interface ResolvedConfiguration extends ResolvedQueryConfigurationBase {
    readonly specifiedTimeInterval: QueryStoreTimeInterval;
    readonly selectedBucketInterval: BucketInterval;
}

const bucketStart = simpleColumnInfo("bucketStartTime").id;
const bucketEnd = simpleColumnInfo("bucketEndTime").id;
const bucketIntervals: readonly BucketInterval[] = [
    "minute",
    "hour",
    "day",
    "week",
    "month",
    "automatic",
];

/** The default of `selectedMetrics`. */
export const overallResourceConsumptionDefaultMetrics: readonly QueryStoreMetric[] = [
    "duration",
    "executionCount",
    "cpuTime",
    "logicalReads",
];

/**
 * Returns the query for the Overall Resource Consumption report, with the `DECLARE` statements
 * for its parameters. It is not sorted. A relative time interval ends at `now`. C#
 * `QueryStoreQueryGenerator.GetOverallResourceConsumptionReportQuery`, which reads the metrics
 * from the database.
 */
export function getOverallResourceConsumptionReportQuery(
    config: OverallResourceConsumptionConfiguration,
    availableMetrics: readonly QueryStoreMetric[],
    now: Date = new Date(),
): string {
    const { sql } = overallResourceConsumption(availableMetrics, config, undefined, true, now);
    const configuration = resolveConfiguration(config);
    const parameters = timeIntervalParameters(
        queryStoreParameters.intervalStartTime,
        queryStoreParameters.intervalEndTime,
        resolveTimeInterval(configuration.specifiedTimeInterval, now),
        configuration.displayTimeKind,
    );
    return prependSqlParameters(
        sql,
        withUsedParameters(sql, parameters, [
            replicaGroupIdParameter(configuration.replicaGroupId),
        ]),
    );
}

/**
 * Returns the query for the Overall Resource Consumption report without parameter declarations,
 * and its columns. Sorts by `orderByColumn` when it is set. An `"automatic"` bucket size depends
 * on the length of the time interval, and a relative interval ends at `now`. C#
 * `OverallResourceConsumptionQueryGenerator.GenerateQuery`.
 */
export function overallResourceConsumption(
    availableMetrics: readonly QueryStoreMetric[],
    config: OverallResourceConsumptionConfiguration,
    orderByColumn?: QueryStoreColumnInfo,
    descending = true,
    now: Date = new Date(),
): QueryStoreQuery {
    if (!Array.isArray(availableMetrics)) {
        throw new RangeError("The available metrics must be an array.");
    }
    availableMetrics.forEach(assertQueryStoreMetric);
    const configuration = resolveConfiguration(config);

    let bucketInterval = configuration.selectedBucketInterval;
    if (bucketInterval === "automatic") {
        const interval = resolveTimeInterval(configuration.specifiedTimeInterval, now);
        bucketInterval = calculateGoodSubInterval(
            interval.end.getTime() - interval.start.getTime(),
        );
    }
    const timeIntervalSpecification = dateFunctionIntervalString(bucketInterval);

    const columns: QueryStoreColumnInfo[] = [];
    const columnList: string[] = [];
    let columnNames = "";
    for (const metric of availableMetrics) {
        // Wait time has its own table expression.
        if (metric === "waitTime") {
            continue;
        }
        columnList.push(
            `    ${getRuntimeStatsSummary("total", metric, "rs")} as total_${metricQueryString(metric)},`,
        );
        columnNames += `    total_${metricQueryString(metric)},\n`;
        columns.push(statisticMetricColumnInfo("total", metric));
    }
    const allMetricsSubQuery = columnList.join("\n").trimEnd();

    let waitStatsSubQuery = "";
    let waitStatsAlias = "";
    if (availableMetrics.includes("waitTime")) {
        waitStatsSubQuery = waitStatsTemplate(
            timeIntervalSpecification,
            queryStoreParameters.intervalStartTime,
            queryStoreParameters.intervalEndTime,
            configuration.isQdsRoAvailable
                ? `    AND ws.replica_group_id = ${queryStoreParameters.replicaGroupId}`
                : "",
        );
        waitStatsAlias = ", WaitStats";
        columns.push(statisticMetricColumnInfo("total", "waitTime"));
        columnNames += `    total_${metricQueryString("waitTime")},`;
    }

    columns.push(simpleColumnInfo("bucketStartTime"), simpleColumnInfo("bucketEndTime"));

    const replicaFilter = configuration.isQdsRoAvailable
        ? `    AND rs.replica_group_id = ${queryStoreParameters.replicaGroupId}`
        : "";

    // In local time, the buckets start at local midnight and so on.
    const timeSourceForGrouping =
        configuration.displayTimeKind === "local"
            ? `SWITCHOFFSET(rs.last_execution_time, DATEPART(tz, ${queryStoreParameters.intervalStartTime}))`
            : "rs.last_execution_time";

    let query = overallResourceConsumptionTemplate(
        timeIntervalSpecification,
        queryStoreParameters.intervalStartTime,
        queryStoreParameters.intervalEndTime,
        waitStatsSubQuery,
        allMetricsSubQuery,
        bucketStart,
        bucketEnd,
        columnNames.trimEnd(),
        waitStatsAlias,
        replicaFilter,
        timeSourceForGrouping,
    ).trimEnd();

    query = appendOrderBy(query, orderByColumn, { descending });
    query += "\nOPTION (MAXRECURSION 0)";
    return { sql: query, columns };
}

function resolveConfiguration(
    config: OverallResourceConsumptionConfiguration,
): ResolvedConfiguration {
    if (!config || typeof config !== "object") {
        throw new RangeError("The configuration must be an object.");
    }
    const selectedBucketInterval = config.selectedBucketInterval ?? "automatic";
    if (!bucketIntervals.includes(selectedBucketInterval)) {
        throw new RangeError(`"${String(selectedBucketInterval)}" is not a bucket interval.`);
    }
    (config.selectedMetrics ?? overallResourceConsumptionDefaultMetrics).forEach(
        assertQueryStoreMetric,
    );
    return {
        ...resolveQueryConfigurationBase(config),
        specifiedTimeInterval: config.specifiedTimeInterval ?? { option: "lastMonth" },
        selectedBucketInterval,
    };
}

/** C# `QueryTemplates.GenerateOverallResourceConsumptionTemplate`. */
function overallResourceConsumptionTemplate(
    timeIntervalSpecification: string,
    parameterIntervalStartTime: string,
    parameterIntervalEndTime: string,
    waitStatsSubQuery: string,
    allMetricsSubQuery: string,
    bucketStartName: string,
    bucketEndName: string,
    columnNames: string,
    waitStatsAlias: string,
    replicaFilter: string,
    timeSourceForGrouping: string,
): string {
    // The C# template has a space at the end of the "WHERE " and "SELECT " lines.
    return `WITH DateGenerator AS
(
SELECT CAST(${parameterIntervalStartTime} AS DATETIME) DatePlaceHolder
UNION ALL
SELECT  DATEADD(${timeIntervalSpecification}, 1, DatePlaceHolder)
FROM    DateGenerator
WHERE   DATEADD(${timeIntervalSpecification}, 1, DatePlaceHolder) < ${parameterIntervalEndTime}
), ${waitStatsSubQuery}
UnionAll AS
(
SELECT
${allMetricsSubQuery}
    TODATETIMEOFFSET(DATEADD(${timeIntervalSpecification}, ((DATEDIFF(${timeIntervalSpecification}, 0, ${timeSourceForGrouping}))), 0), DATEPART(tz, @interval_start_time)) as ${bucketStartName},
    TODATETIMEOFFSET(DATEADD(${timeIntervalSpecification}, (1 + (DATEDIFF(${timeIntervalSpecification}, 0, ${timeSourceForGrouping}))), 0), DATEPART(tz, @interval_start_time)) as ${bucketEndName}
FROM sys.query_store_runtime_stats rs
WHERE${" "}
    NOT (rs.first_execution_time > ${parameterIntervalEndTime} OR rs.last_execution_time < ${parameterIntervalStartTime})
${replicaFilter}
GROUP BY DATEDIFF(${timeIntervalSpecification}, 0, ${timeSourceForGrouping})
)
SELECT${" "}
${columnNames}
    ${bucketStartName},
    ${bucketEndName}
FROM
(
SELECT *, ROW_NUMBER() OVER (PARTITION BY ${bucketStartName} ORDER BY ${bucketStartName}, total_duration DESC) AS RowNumber
FROM UnionAll ${waitStatsAlias}
) as UnionAllResults
WHERE UnionAllResults.RowNumber = 1
`;
}

/** C# `QueryTemplates.GenerateOverallResourceConsumptionWaitStatsTemplate`. */
function waitStatsTemplate(
    timeIntervalSpecification: string,
    parameterIntervalStartTime: string,
    parameterIntervalEndTime: string,
    replicaFilter: string,
): string {
    return `WaitStats AS
(
SELECT
    ROUND(CONVERT(float, SUM(ws.total_query_wait_time_ms))*1,2) total_query_wait_time
FROM sys.query_store_wait_stats ws
    JOIN sys.query_store_runtime_stats_interval itvl ON itvl.runtime_stats_interval_id = ws.runtime_stats_interval_id
WHERE
    NOT (itvl.start_time > ${parameterIntervalEndTime} OR itvl.end_time < ${parameterIntervalStartTime})
${replicaFilter}
GROUP BY DATEDIFF(${timeIntervalSpecification}, 0, itvl.end_time)
),`;
}
