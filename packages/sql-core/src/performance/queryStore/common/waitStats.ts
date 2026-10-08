/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { metricQueryString } from "./metric";
import {
    getStatsViewAlias,
    getWaitStatsSummary,
    queryStoreParameters,
} from "./queryGeneratorUtils";
import { QueryStoreStatistic, assertQueryStoreStatistic, statisticQueryString } from "./statistic";
import { assertSqlAlias, assertSqlParameterName } from "./utils";

/*
 * Port of QueryWaitStatsQueryGenerator.GetWaitStatsTableExpression and its two QueryTemplates.
 * Several reports use the table expression, so it is part of the common layer.
 */

/**
 * The statistics that wait stats have: every statistic except `last` and `variation`. C#
 * `QueryWaitStatsQueryGenerator.GetAvailableMetrics`.
 */
export const waitStatsStatistics: readonly QueryStoreStatistic[] = [
    "avg",
    "min",
    "max",
    "stdev",
    "total",
];

export interface WaitStatsTableExpressionOptions {
    /** The statistics to compute. Default (and when empty): {@link waitStatsStatistics}. */
    readonly statisticList?: readonly QueryStoreStatistic[];
    /** Adds the `replica_group_id` column, filter, and grouping. */
    readonly includeReplicaGroupId: boolean;
    /** Uses the template that adds `execution_type` and the last wait time. Default false. */
    readonly includeQueryExecutionLastWaitTime?: boolean;
    /** Puts `WITH ` before the name. Default false. */
    readonly addWithClause?: boolean;
    /** Puts `,` after the closing parenthesis. Default false. */
    readonly addSeparator?: boolean;
    /** Default `@interval_end_time`. */
    readonly endTime?: string;
    /** Default `@interval_start_time`. */
    readonly startTime?: string;
}

/**
 * Returns a common table expression that shows `sys.query_store_wait_stats` with the same shape
 * as `sys.query_store_runtime_stats`, so that the reports can treat wait time like another
 * metric. C# `QueryWaitStatsQueryGenerator.GetWaitStatsTableExpression`.
 */
export function getWaitStatsTableExpression(
    waitstatsViewName: string,
    options: WaitStatsTableExpressionOptions,
): string {
    const subQuery = getWaitStatsTableExpressionSubQuery(
        options.statisticList,
        options.includeQueryExecutionLastWaitTime ?? false,
        assertSqlParameterName(options.endTime ?? queryStoreParameters.intervalEndTime),
        assertSqlParameterName(options.startTime ?? queryStoreParameters.intervalStartTime),
        options.includeReplicaGroupId,
    );
    return `${options.addWithClause ? "WITH " : ""}${assertSqlAlias(waitstatsViewName)} AS
(
${subQuery}
)${options.addSeparator ? "," : ""}`;
}

function getWaitStatsTableExpressionSubQuery(
    statisticList: readonly QueryStoreStatistic[] | undefined,
    includeQueryExecutionLastWaitTime: boolean,
    endTime: string,
    startTime: string,
    includeReplicaGroupId: boolean,
): string {
    const statistics =
        statisticList === undefined || statisticList.length === 0
            ? waitStatsStatistics
            : statisticList;
    const alias = getStatsViewAlias("waitTime");

    let summary = includeReplicaGroupId ? "    ws.replica_group_id,\n" : "";
    for (const statistic of statistics) {
        assertQueryStoreStatistic(statistic);
        summary += `    ${getWaitStatsSummary(statistic, alias)} ${statisticQueryString(statistic)}_${metricQueryString("waitTime")},\n`;
    }
    summary = summary.trimEnd();

    const replicaFilter = !includeReplicaGroupId
        ? ""
        : includeQueryExecutionLastWaitTime
          ? `    WHERE replica_group_id = ${queryStoreParameters.replicaGroupId}`
          : `    AND ws.replica_group_id = ${queryStoreParameters.replicaGroupId}`;
    const extraGroupBy = includeReplicaGroupId ? ", ws.replica_group_id" : "";

    return includeQueryExecutionLastWaitTime
        ? waitStatsViewTemplateIncludeLastQueryExecutionWaitTime(
              summary,
              endTime,
              startTime,
              replicaFilter,
              extraGroupBy,
          )
        : waitStatsViewTemplateGroupedByPlanIdIntervalIdWaitCategory(
              summary,
              endTime,
              startTime,
              replicaFilter,
              extraGroupBy,
          );
}

/** C# `QueryTemplates.GenerateWaitStatsViewTemplateGroupedByPlanIdIntervalIdWaitCategory`. */
function waitStatsViewTemplateGroupedByPlanIdIntervalIdWaitCategory(
    summary: string,
    endTime: string,
    startTime: string,
    replicaFilter: string,
    extraGroupBy: string,
): string {
    return `SELECT
    ws.plan_id plan_id,
    ws.wait_category,
${summary}
    CAST(ROUND(SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms),0) AS BIGINT) count_executions,
    MAX(itvl.end_time) last_execution_time,
    MIN(itvl.start_time) first_execution_time
FROM sys.query_store_wait_stats ws
    JOIN sys.query_store_runtime_stats_interval itvl ON itvl.runtime_stats_interval_id = ws.runtime_stats_interval_id
WHERE
    NOT (itvl.start_time > ${endTime} OR itvl.end_time < ${startTime})
${replicaFilter}
GROUP BY ws.plan_id, ws.runtime_stats_interval_id, ws.wait_category${extraGroupBy}`;
}

/** C# `QueryTemplates.GenerateWaitStatsViewTemplateIncludeLastQueryExecutionWaitTime`. */
function waitStatsViewTemplateIncludeLastQueryExecutionWaitTime(
    summary: string,
    endTime: string,
    startTime: string,
    replicaFilter: string,
    extraGroupBy: string,
): string {
    return `SELECT
    ws.plan_id plan_id,
    ws.execution_type,
${summary}
    CAST(ROUND(SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms),0) AS BIGINT) count_executions,
    MAX(itvl.end_time) last_execution_time,
    MIN(itvl.start_time) first_execution_time
    FROM
    (
    SELECT *, LAST_VALUE(last_query_wait_time_ms) OVER (order by plan_id, runtime_stats_interval_id, execution_type, wait_category) last_query_wait_time
    FROM sys.query_store_wait_stats
${replicaFilter}
    )
AS ws
    JOIN sys.query_store_runtime_stats_interval itvl ON itvl.runtime_stats_interval_id = ws.runtime_stats_interval_id
WHERE NOT (itvl.start_time > ${endTime} OR itvl.end_time < ${startTime})
GROUP BY ws.plan_id, ws.runtime_stats_interval_id, ws.execution_type, ws.wait_category${extraGroupBy}`;
}
