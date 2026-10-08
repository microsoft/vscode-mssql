/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    QueryStoreColumnInfo,
    QueryStoreQuery,
    executionCountColumnInfo,
    simpleColumnInfo,
    statisticMetricColumnInfo,
} from "./common/columnInfo";
import {
    QueryConfigurationBase,
    ResolvedQueryConfigurationBase,
    assertBoolean,
    queryStoreConstants,
    resolveQueryConfigurationBase,
} from "./common/configuration";
import { QueryStoreMetric, metricQueryString } from "./common/metric";
import {
    getStatsViewAlias,
    getWaitStatsSummary,
    queryStoreParameters,
    rowsToReturnString,
} from "./common/queryGeneratorUtils";
import { replicaGroupIdParameter, withUsedParameters } from "./common/reportParameters";
import {
    QueryStoreSqlParameter,
    formatInt,
    getOrderByColumn,
    prependSqlParameters,
    timeIntervalParameters,
} from "./common/sqlParameters";
import { QueryStoreStatistic, statisticQueryString } from "./common/statistic";
import { QueryStoreTimeInterval, resolveTimeInterval } from "./common/timeInterval";
import { appendOrderBy } from "./common/utils";
import { waitStatsStatistics } from "./common/waitStats";
import { TopResourceConsumersConfiguration } from "./topResourceConsumers";

/*
 * Port of the report functions of QueryWaitStatsQueryGenerator, QueryWaitStatsConfiguration, and
 * the wait stats tooltip functions of Utils from SQL Tools Service. The C# facade has no wait
 * stats functions, so the facade functions here follow the pattern of the other reports.
 */

export interface QueryWaitStatsConfiguration extends QueryConfigurationBase {
    /** Default `{ option: "lastHour" }`. */
    readonly timeInterval?: QueryStoreTimeInterval;
    /** True when the per-query tooltip is available. Default false. */
    readonly isExtendedDataForToolTipAvailable?: boolean;
    /** Default false. */
    readonly returnAllWaitCategories?: boolean;
    /** The number of wait categories when `returnAllWaitCategories` is false. Default 10. */
    readonly topWaitCategoriesReturned?: number;
    /** Default `"waitTime"`. */
    readonly selectedMetric?: QueryStoreMetric;
    /** Default `"total"`. */
    readonly selectedStatistic?: QueryStoreStatistic;
}

interface ResolvedConfiguration extends ResolvedQueryConfigurationBase {
    readonly timeInterval: QueryStoreTimeInterval;
    readonly isExtendedDataForToolTipAvailable: boolean;
    readonly returnAllWaitCategories: boolean;
    readonly topWaitCategoriesReturned: number;
}

const parameters = queryStoreParameters;

/**
 * Returns the query for the wait time of each wait category, with the `DECLARE` statements for
 * its parameters: the interval, `@results_row_count` (`topWaitCategoriesReturned`) when the report
 * does not return all categories, and `@replica_group_id` when the SQL uses it.
 *
 * @param orderByColumnId The `id` of a column of {@link aggWaitTimePerWaitCategory}. Default: the
 * first column.
 */
export function getAggWaitTimePerWaitCategoryReportQuery(
    config: QueryWaitStatsConfiguration,
    orderByColumnId?: string,
    descending = true,
    now: Date = new Date(),
): string {
    const { columns } = aggWaitTimePerWaitCategory(config);
    const orderByColumn = getOrderByColumn(orderByColumnId, columns);
    const { sql } = aggWaitTimePerWaitCategory(config, orderByColumn, descending);

    const configuration = resolveConfiguration(config);
    const result = intervalParameters(configuration, now);
    if (!configuration.returnAllWaitCategories) {
        result.push({
            name: parameters.resultsRowCount,
            type: "int",
            value: configuration.topWaitCategoriesReturned,
        });
    }
    return prependSqlParameters(sql, withReplicaGroup(sql, result, configuration));
}

/**
 * Returns the query for the wait time of each query in a wait category, with the `DECLARE`
 * statements for its parameters: `@wait_category`, the interval, `@results_row_count`
 * (`topQueriesReturned`) when the report does not return all queries, and `@replica_group_id`
 * when the SQL uses it.
 *
 * @param waitCategoryId `sys.query_store_wait_stats.wait_category`.
 * @param orderByColumnId The `id` of a column of {@link aggWaitTimePerQueryForWaitCategoryId}.
 * Default: the first column.
 */
export function getAggWaitTimePerQueryForWaitCategoryReportQuery(
    config: QueryWaitStatsConfiguration,
    waitCategoryId: number,
    orderByColumnId?: string,
    descending = true,
    now: Date = new Date(),
): string {
    const { columns } = aggWaitTimePerQueryForWaitCategoryId(config);
    const orderByColumn = getOrderByColumn(orderByColumnId, columns);
    const { sql } = aggWaitTimePerQueryForWaitCategoryId(config, orderByColumn, descending);

    const configuration = resolveConfiguration(config);
    const result: QueryStoreSqlParameter[] = [
        waitCategoryParameter(waitCategoryId),
        ...intervalParameters(configuration, now),
    ];
    if (!configuration.returnAllQueries) {
        result.push({
            name: parameters.resultsRowCount,
            type: "int",
            value: configuration.topQueriesReturned,
        });
    }
    return prependSqlParameters(sql, withReplicaGroup(sql, result, configuration));
}

/**
 * Returns the tooltip query of a wait category: the queries with the most wait time in it, up to
 * 10, sorted by the selected statistic. Returns undefined when
 * `isExtendedDataForToolTipAvailable` is false. C#
 * `Utils.GetExtendedTooltipForAggWaitTimePerQueryForCategory`, which binds the same parameters.
 */
export function getAggWaitTimePerQueryForWaitCategoryToolTipQuery(
    config: QueryWaitStatsConfiguration,
    waitCategoryId: number,
    now: Date = new Date(),
): string | undefined {
    const configuration = resolveConfiguration(config);
    if (!configuration.isExtendedDataForToolTipAvailable) {
        return undefined;
    }
    const sql = aggWaitTimePerQueryForWaitCategoryIdToolTip(config);
    const result: QueryStoreSqlParameter[] = [
        waitCategoryParameter(waitCategoryId),
        ...intervalParameters(configuration, now),
        {
            name: parameters.resultsRowCount,
            type: "int",
            value: queryStoreConstants.maxRecordsForWaitStatsPerQueryToolTip,
        },
    ];
    return prependSqlParameters(sql, withReplicaGroup(sql, result, configuration));
}

/**
 * Returns the tooltip query of a Top Resource Consumers row: the wait time of each wait category
 * for the query. Returns undefined unless the metric is `waitTime` and the statistic is `total`.
 * C# `Utils.GetExtendedToolTipForTopResourceConsumingQuery`, which binds the same parameters.
 */
export function getTotalWaitTimePerWaitCategoryForQueryIdToolTipQuery(
    config: TopResourceConsumersConfiguration,
    queryId: number | bigint | string,
    now: Date = new Date(),
): string | undefined {
    const configuration = resolveQueryConfigurationBase(config, { selectedStatistic: "total" });
    if (
        configuration.selectedMetric !== "waitTime" ||
        configuration.selectedStatistic !== "total"
    ) {
        return undefined;
    }
    const sql = totalWaitTimePerWaitCategoryForQueryId(config);
    const result: QueryStoreSqlParameter[] = [
        { name: parameters.queryId, type: "bigint", value: queryId },
        ...timeIntervalParameters(
            parameters.intervalStartTime,
            parameters.intervalEndTime,
            resolveTimeInterval(config.timeInterval ?? { option: "lastHour" }, now),
            configuration.displayTimeKind,
        ),
    ];
    return prependSqlParameters(
        sql,
        withUsedParameters(sql, result, [replicaGroupIdParameter(configuration.replicaGroupId)]),
    );
}

/**
 * Returns the query for the total wait time of each wait category for a query, without
 * parameter declarations. C# `QueryWaitStatsQueryGenerator.TotalWaitTimePerWaitCategoryForQueryId`.
 */
export function totalWaitTimePerWaitCategoryForQueryId(
    config: TopResourceConsumersConfiguration,
): string {
    const configuration = resolveQueryConfigurationBase(config, { selectedStatistic: "total" });
    const replicaFilter = configuration.isQdsRoAvailable
        ? `    AND ws.replica_group_id = ${parameters.replicaGroupId}`
        : "";
    return `SELECT
    ws.wait_category_desc WaitCategory,
    SUM(ws.total_query_wait_time_ms) WaitTime
FROM sys.query_store_wait_stats ws
    JOIN sys.query_store_plan p ON p.plan_id = ws.plan_id
    JOIN sys.query_store_runtime_stats_interval itvl ON itvl.runtime_stats_interval_id = ws.runtime_stats_interval_id
WHERE
    NOT (itvl.start_time > ${parameters.intervalEndTime} OR itvl.end_time < ${parameters.intervalStartTime})
${replicaFilter}
AND p.query_id = ${parameters.queryId}
GROUP BY wait_category_desc
ORDER BY WaitTime Desc`;
}

/**
 * Returns the query for the wait time of each wait category without parameter declarations, and
 * its columns. Sorts by `orderByColumn` when it is set. C#
 * `QueryWaitStatsQueryGenerator.AggWaitTimePerWaitCategory`.
 */
export function aggWaitTimePerWaitCategory(
    config: QueryWaitStatsConfiguration,
    orderByColumn?: QueryStoreColumnInfo,
    descending = true,
): QueryStoreQuery {
    const configuration = resolveConfiguration(config);
    const metric = configuration.selectedMetric;
    const columns: QueryStoreColumnInfo[] = [
        simpleColumnInfo("waitCategoryId"),
        simpleColumnInfo("waitCategoryDesc"),
    ];
    const lines: string[] = [];
    for (const statistic of waitStatsStatistics) {
        // Only total wait time has more data for the tooltip.
        const extendedTooltipData =
            metric === "waitTime" && statistic === configuration.selectedStatistic;
        columns.push(statisticMetricColumnInfo(statistic, metric, extendedTooltipData));
        lines.push(summaryLine(statistic, metric));
    }
    columns.push(executionCountColumnInfo());

    const sql = `SELECT ${rowsToReturnString(configuration.returnAllWaitCategories)}
    ws.wait_category wait_category,
    ws.wait_category_desc wait_category_desc,
${lines.join("\n").trimEnd()}
    CAST(ROUND(SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms),0) AS BIGINT) count_executions
FROM sys.query_store_wait_stats ws
    JOIN sys.query_store_runtime_stats_interval itvl ON itvl.runtime_stats_interval_id = ws.runtime_stats_interval_id
WHERE
    NOT (itvl.start_time > ${parameters.intervalEndTime} OR itvl.end_time < ${parameters.intervalStartTime})
${replicaFilter(configuration)}
GROUP BY ws.wait_category, wait_category_desc`;

    return { sql: appendOrderBy(sql, orderByColumn, { descending }), columns };
}

/**
 * Returns the query for the wait time of each query in the wait category `@wait_category`
 * without parameter declarations, and its columns. Sorts by `orderByColumn`, or by the selected
 * statistic of the metric when it is not set. C#
 * `QueryWaitStatsQueryGenerator.AggWaitTimePerQueryForWaitCategoryId`.
 */
export function aggWaitTimePerQueryForWaitCategoryId(
    config: QueryWaitStatsConfiguration,
    orderByColumn?: QueryStoreColumnInfo,
    descending = true,
): QueryStoreQuery {
    const configuration = resolveConfiguration(config);
    const metric = configuration.selectedMetric;
    const sortColumn =
        orderByColumn ?? statisticMetricColumnInfo(configuration.selectedStatistic, metric);

    const columns: QueryStoreColumnInfo[] = [
        simpleColumnInfo("queryId"),
        simpleColumnInfo("objectId"),
        simpleColumnInfo("objectName"),
        simpleColumnInfo("queryText"),
    ];
    const lines: string[] = [];
    for (const statistic of waitStatsStatistics) {
        columns.push(statisticMetricColumnInfo(statistic, metric));
        lines.push(summaryLine(statistic, metric));
    }
    columns.push(executionCountColumnInfo());

    const sql = `SELECT ${rowsToReturnString(configuration.returnAllQueries)}
    p.query_id query_id,
    q.object_id object_id,
    ISNULL(OBJECT_NAME(q.object_id),'') object_name,
    qt.query_sql_text query_sql_text,
${lines.join("\n").trimEnd()}
    CAST(ROUND(SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms),0) AS BIGINT) count_executions
FROM sys.query_store_wait_stats ws
    JOIN sys.query_store_plan p on p.plan_id = ws.plan_id
    JOIN sys.query_store_query q ON q.query_id = p.query_id
    JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
    JOIN sys.query_store_runtime_stats_interval itvl ON itvl.runtime_stats_interval_id = ws.runtime_stats_interval_id
WHERE
    NOT (itvl.start_time > ${parameters.intervalEndTime} OR itvl.end_time < ${parameters.intervalStartTime}) AND ws.wait_category = ${parameters.waitCategoryId}
${replicaFilter(configuration)}
GROUP BY p.query_id, qt.query_sql_text, q.object_id`;

    return { sql: appendOrderBy(sql, sortColumn, { descending }), columns };
}

/**
 * The tooltip version of {@link aggWaitTimePerQueryForWaitCategoryId}: limited to
 * `@results_row_count` rows and sorted by the selected statistic in descending order. C#
 * `QueryWaitStatsQueryGenerator.AggWaitTimePerQueryForWaitCategoryId(configuration)`, which also
 * sets `ReturnAllQueries` to false on the caller's configuration.
 */
export function aggWaitTimePerQueryForWaitCategoryIdToolTip(
    config: QueryWaitStatsConfiguration,
): string {
    const configuration = resolveConfiguration(config);
    return aggWaitTimePerQueryForWaitCategoryId(
        { ...config, returnAllQueries: false },
        statisticMetricColumnInfo(configuration.selectedStatistic, configuration.selectedMetric),
        true,
    ).sql;
}

function summaryLine(statistic: QueryStoreStatistic, metric: QueryStoreMetric): string {
    return `    ${getWaitStatsSummary(statistic, getStatsViewAlias("waitTime"))} ${statisticQueryString(statistic)}_${metricQueryString(metric)},`;
}

function replicaFilter(configuration: ResolvedConfiguration): string {
    return configuration.isQdsRoAvailable
        ? `    AND ws.replica_group_id = ${parameters.replicaGroupId}`
        : "";
}

function intervalParameters(configuration: ResolvedConfiguration, now: Date) {
    return timeIntervalParameters(
        parameters.intervalStartTime,
        parameters.intervalEndTime,
        resolveTimeInterval(configuration.timeInterval, now),
        configuration.displayTimeKind,
    );
}

function withReplicaGroup(
    sql: string,
    result: readonly QueryStoreSqlParameter[],
    configuration: ResolvedConfiguration,
): QueryStoreSqlParameter[] {
    return withUsedParameters(sql, result, [replicaGroupIdParameter(configuration.replicaGroupId)]);
}

/** `@wait_category` as an `int`. The C# code binds the ID as a string. */
function waitCategoryParameter(waitCategoryId: number): QueryStoreSqlParameter {
    return { name: parameters.waitCategoryId, type: "int", value: waitCategoryId };
}

function resolveConfiguration(config: QueryWaitStatsConfiguration): ResolvedConfiguration {
    if (!config || typeof config !== "object") {
        throw new RangeError("The configuration must be an object.");
    }
    const topWaitCategoriesReturned =
        config.topWaitCategoriesReturned ?? queryStoreConstants.topWaitCategoriesReturned;
    formatInt(topWaitCategoriesReturned);
    return {
        ...resolveQueryConfigurationBase(config, {
            selectedMetric: "waitTime",
            selectedStatistic: "total",
        }),
        timeInterval: config.timeInterval ?? { option: "lastHour" },
        isExtendedDataForToolTipAvailable: assertBoolean(
            config.isExtendedDataForToolTipAvailable ?? false,
        ),
        returnAllWaitCategories: assertBoolean(config.returnAllWaitCategories ?? false),
        topWaitCategoriesReturned,
    };
}
