/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    QueryStoreColumnInfo,
    QueryStoreQuery,
    executionCountColumnInfo,
    simpleColumnInfo,
    statisticMetricRegressionColumnInfo,
    statisticMetricTimeColumnInfo,
} from "./common/columnInfo";
import {
    QueryConfigurationBase,
    ResolvedQueryConfigurationBase,
    resolveQueryConfigurationBase,
} from "./common/configuration";
import { QueryStoreMetric, assertQueryStoreMetric, metricQueryString } from "./common/metric";
import {
    getRuntimeStatsSummary,
    getStatsViewAlias,
    getStatsViewName,
    queryStoreParameters,
    rowsToReturnString,
} from "./common/queryGeneratorUtils";
import { SelectList, getExecutionCountText, getPlanCountText } from "./common/queryTemplates";
import { replicaGroupIdParameter, withUsedParameters } from "./common/reportParameters";
import {
    QueryStoreSqlParameter,
    formatBigInt,
    formatInt,
    prependSqlParameters,
    timeIntervalParameters,
} from "./common/sqlParameters";
import { QueryStoreStatistic, statisticQueryString } from "./common/statistic";
import {
    ComparisonTimeInterval,
    QueryStoreTimeInterval,
    resolveTimeInterval,
} from "./common/timeInterval";
import { appendOrderBy, except } from "./common/utils";
import { getWaitStatsTableExpression } from "./common/waitStats";

/*
 * Port of RegressedQueriesQueryGenerator and the Regressed Queries functions of
 * QueryStoreQueryGenerator from SQL Tools Service. The report compares a recent window with a
 * history window.
 */

export interface RegressedQueriesConfiguration extends QueryConfigurationBase {
    /** Default `{ option: "lastHour" }`. */
    readonly timeIntervalRecent?: QueryStoreTimeInterval;
    /** Default `{ option: "lastWeek" }`. */
    readonly timeIntervalHistory?: QueryStoreTimeInterval;
    /** Keeps only the queries with at least this many recent executions. A `bigint`. Default 1. */
    readonly minExecutionCount?: number | bigint | string;
    /** Default `"total"`. */
    readonly selectedStatistic?: QueryStoreStatistic;
}

/** The T-SQL variables of the report, in addition to {@link queryStoreParameters}. */
export const regressedQueriesParameters = {
    resultsRowCount: "@results_row_count",
    recentStartTime: "@recent_start_time",
    recentEndTime: "@recent_end_time",
    historyStartTime: "@history_start_time",
    historyEndTime: "@history_end_time",
    minExecutionCount: "@min_exec_count",
} as const;

interface ResolvedConfiguration extends ResolvedQueryConfigurationBase {
    readonly timeIntervalRecent: QueryStoreTimeInterval;
    readonly timeIntervalHistory: QueryStoreTimeInterval;
    /** A decimal string. */
    readonly minExecutionCount: string;
}

const parameters = regressedQueriesParameters;

/**
 * Returns the query for the Regressed Queries report, with the `DECLARE` statements for its
 * parameters. It is not sorted. Relative time intervals end at `now`. C#
 * `QueryStoreQueryGenerator.GetRegressedQueriesSummaryReportQuery`.
 */
export function getRegressedQueriesSummaryReportQuery(
    config: RegressedQueriesConfiguration,
    now: Date = new Date(),
): string {
    const { sql } = regressedQuerySummary(config);
    return prependSqlParameters(sql, reportParameters(config, sql, now));
}

/**
 * Returns the query for the detailed Regressed Queries report, which has every available metric,
 * with the `DECLARE` statements for its parameters. It is not sorted. C#
 * `QueryStoreQueryGenerator.GetRegressedQueriesDetailedSummaryReportQuery`, which reads the
 * metrics from the database.
 */
export function getRegressedQueriesDetailedSummaryReportQuery(
    config: RegressedQueriesConfiguration,
    availableMetrics: readonly QueryStoreMetric[],
    now: Date = new Date(),
): string {
    const { sql } = regressedQueryDetailedSummary(availableMetrics, config);
    return prependSqlParameters(sql, reportParameters(config, sql, now));
}

/**
 * Returns the query for the Regressed Queries report without parameter declarations, and its
 * columns. Sorts by `orderByColumn` when it is set. C#
 * `RegressedQueriesQueryGenerator.RegressedQuerySummary`.
 */
export function regressedQuerySummary(
    config: RegressedQueriesConfiguration,
    orderByColumn?: QueryStoreColumnInfo,
    descending = true,
): QueryStoreQuery {
    const configuration = resolveConfiguration(config);
    const metric = configuration.selectedMetric;
    const availableMetrics: QueryStoreMetric[] = [metric];

    const statsViewName = getStatsViewName(metric);
    const statsAlias = getStatsViewAlias(metric);
    const waitStatsSubQuery =
        metric === "waitTime"
            ? getWaitStatsTableExpression(statsViewName, {
                  includeReplicaGroupId: configuration.isQdsRoAvailable,
                  includeQueryExecutionLastWaitTime: false,
                  addWithClause: false,
                  addSeparator: true,
                  endTime: parameters.historyEndTime,
                  startTime: parameters.historyStartTime,
              })
            : "";

    const historyCte = getCteStatement(
        configuration,
        availableMetrics,
        metric,
        statsViewName,
        statsAlias,
        parameters.historyStartTime,
        parameters.historyEndTime,
    );
    const recentCte = getCteStatement(
        configuration,
        availableMetrics,
        metric,
        statsViewName,
        statsAlias,
        parameters.recentStartTime,
        parameters.recentEndTime,
    );
    const finalSelects = getFinalSelects(configuration, availableMetrics);
    let query = regressedQueryTemplate(
        waitStatsSubQuery,
        historyCte,
        recentCte,
        finalSelects.text,
        getResultStatement(configuration, availableMetrics, metricQueryString("executionCount")),
        parameters.minExecutionCount,
        configuration.minNumberOfQueryPlans,
        generateFilterClause(
            statisticMetricRegressionColumnInfo(
                configuration.selectedStatistic,
                configuration.selectedMetric,
            ).id,
        ),
    );

    query = appendOrderBy(query, orderByColumn, { descending });
    query += "\nOPTION (MERGE JOIN)";
    return { sql: query, columns: finalSelects.columns };
}

/**
 * Returns the query for the detailed Regressed Queries report without parameter declarations,
 * and its columns. Sorts by `orderByColumn` when it is set. C#
 * `RegressedQueriesQueryGenerator.RegressedQueryDetailedSummary`, which also removes metrics from
 * the caller's list. This port does not change `availableMetrics`.
 */
export function regressedQueryDetailedSummary(
    availableMetrics: readonly QueryStoreMetric[],
    config: RegressedQueriesConfiguration,
    orderByColumn?: QueryStoreColumnInfo,
    descending = true,
): QueryStoreQuery {
    if (!Array.isArray(availableMetrics)) {
        throw new RangeError("The available metrics must be an array.");
    }
    availableMetrics.forEach(assertQueryStoreMetric);
    const configuration = resolveConfiguration(config);

    if (availableMetrics.includes("waitTime")) {
        return detailedSummaryWithWaitStats(
            availableMetrics,
            configuration,
            orderByColumn,
            descending,
        );
    }

    const selectedMetric: QueryStoreMetric = "duration";
    const runtimeStatsViewName = getStatsViewName(selectedMetric);
    const runtimeStatsViewAlias = getStatsViewAlias(selectedMetric);

    // Like List.Remove, which removes only the first match. Wait stats have their own template,
    // and the report does not compare execution counts.
    const metrics = removeFirst(removeFirst(availableMetrics, "waitTime"), "executionCount");

    const historyCte = getCteStatement(
        configuration,
        metrics,
        selectedMetric,
        runtimeStatsViewName,
        runtimeStatsViewAlias,
        parameters.historyStartTime,
        parameters.historyEndTime,
    );
    const recentCte = getCteStatement(
        configuration,
        metrics,
        selectedMetric,
        runtimeStatsViewName,
        runtimeStatsViewAlias,
        parameters.recentStartTime,
        parameters.recentEndTime,
    );
    const finalSelects = getFinalSelects(configuration, metrics);
    let query = regressedQueryTemplate(
        "",
        historyCte,
        recentCte,
        finalSelects.text,
        getResultStatement(configuration, metrics, metricQueryString("executionCount")),
        parameters.minExecutionCount,
        configuration.minNumberOfQueryPlans,
        "",
    );

    query = appendOrderBy(query, orderByColumn, { descending });
    query += "\nOPTION (MERGE JOIN)";
    return { sql: query, columns: finalSelects.columns };
}

/** C# `RegressedQueriesQueryGenerator.RegressedQueryDetailedSummaryWithWaitStats`. */
function detailedSummaryWithWaitStats(
    availableMetrics: readonly QueryStoreMetric[],
    configuration: ResolvedConfiguration,
    orderByColumn: QueryStoreColumnInfo | undefined,
    descending: boolean,
): QueryStoreQuery {
    const waitMetric: QueryStoreMetric = "waitTime";
    const waitStatsViewName = getStatsViewName(waitMetric);
    const waitStatsViewAlias = getStatsViewAlias(waitMetric);
    const durationMetric: QueryStoreMetric = "duration";
    const runtimeStatsViewName = getStatsViewName(durationMetric);
    const runtimeStatsViewAlias = getStatsViewAlias(durationMetric);

    const waitStatsMetricList: QueryStoreMetric[] = [waitMetric];
    const runtimeStatsMetricList = except(availableMetrics, ["executionCount", "waitTime"]);
    const statsMetricList = except(availableMetrics, ["executionCount"]);

    const waitStatsSubQuery = getWaitStatsTableExpression(waitStatsViewName, {
        includeReplicaGroupId: configuration.isQdsRoAvailable,
        includeQueryExecutionLastWaitTime: false,
        addWithClause: false,
        addSeparator: true,
        endTime: parameters.historyEndTime,
        startTime: parameters.historyStartTime,
    });
    const executionCount = "wait_stats_count_executions";

    const cte = (
        metrics: readonly QueryStoreMetric[],
        selectedMetric: QueryStoreMetric,
        viewName: string,
        viewAlias: string,
        startTime: string,
        endTime: string,
    ) =>
        getCteStatement(
            configuration,
            metrics,
            selectedMetric,
            viewName,
            viewAlias,
            startTime,
            endTime,
        );

    const historyWaitCte = cte(
        waitStatsMetricList,
        waitMetric,
        waitStatsViewName,
        waitStatsViewAlias,
        parameters.historyStartTime,
        parameters.historyEndTime,
    );
    const historyRuntimeCte = cte(
        runtimeStatsMetricList,
        durationMetric,
        runtimeStatsViewName,
        runtimeStatsViewAlias,
        parameters.historyStartTime,
        parameters.historyEndTime,
    );
    const historyColumns = getCombinedColumnNames(
        "other_hist",
        "wait_stats_hist",
        configuration.selectedStatistic,
        statsMetricList,
    );
    const recentWaitCte = cte(
        waitStatsMetricList,
        waitMetric,
        waitStatsViewName,
        waitStatsViewAlias,
        parameters.recentStartTime,
        parameters.recentEndTime,
    );
    const recentRuntimeCte = cte(
        runtimeStatsMetricList,
        durationMetric,
        runtimeStatsViewName,
        runtimeStatsViewAlias,
        parameters.recentStartTime,
        parameters.recentEndTime,
    );
    const recentColumns = getCombinedColumnNames(
        "other_recent",
        "wait_stats_recent",
        configuration.selectedStatistic,
        statsMetricList,
    );
    const finalSelects = getFinalSelects(configuration, statsMetricList);

    let query = regressedQueryDetailWithWaitStatsTemplate(
        waitStatsSubQuery,
        historyWaitCte,
        historyRuntimeCte,
        historyColumns,
        recentWaitCte,
        recentRuntimeCte,
        recentColumns,
        finalSelects.text,
        getResultStatement(configuration, statsMetricList, executionCount),
        parameters.minExecutionCount,
        configuration.minNumberOfQueryPlans,
    );

    query = appendOrderBy(query, orderByColumn, { descending });
    query += "\nOPTION (MERGE JOIN)";
    return { sql: query, columns: finalSelects.columns };
}

/**
 * The regression of a metric: the additional workload for `total`, and the change in percent for
 * the other statistics.
 */
function getRegressionCalculation(
    statistic: QueryStoreStatistic,
    metric: QueryStoreMetric,
    executionCountPrefix: string,
): string {
    const name = `${statisticQueryString(statistic)}_${metricQueryString(metric)}`;
    return statistic === "total"
        ? `ROUND(CONVERT(float, recent.${name}/recent.${executionCountPrefix}-hist.${name}/hist.${executionCountPrefix})*(recent.${executionCountPrefix}), 2)`
        : `ROUND(CONVERT(float, recent.${name}-hist.${name})/NULLIF(hist.${name},0)*100.0, 2)`;
}

function getTimeIntervalCalculation(
    statistic: QueryStoreStatistic,
    metric: QueryStoreMetric,
    timeInterval: ComparisonTimeInterval,
): string {
    const name = `${statisticQueryString(statistic)}_${metricQueryString(metric)}`;
    switch (timeInterval) {
        case "history":
            return `ROUND(hist.${name}, 2)`;
        case "recent":
            return `ROUND(recent.${name}, 2)`;
        default:
            return "";
    }
}

/** The query of a common table expression for one window. */
function getCteStatement(
    configuration: ResolvedConfiguration,
    metrics: readonly QueryStoreMetric[],
    selectedMetric: QueryStoreMetric,
    statsTableName: string,
    statsTableAlias: string,
    startTimeParameter: string,
    endTimeParameter: string,
): string {
    const statistic = configuration.selectedStatistic;
    const lines: string[] = [];
    for (const metric of metrics) {
        lines.push(
            `    ${getRuntimeStatsSummary(statistic, metric, statsTableAlias)} ${statisticQueryString(statistic)}_${metricQueryString(metric)},`,
        );
    }
    lines.push(getExecutionCountText(selectedMetric, statsTableAlias));
    lines.push(getPlanCountText());

    const replicaFilter = configuration.isQdsRoAvailable
        ? `    AND ${statsTableAlias}.replica_group_id = ${queryStoreParameters.replicaGroupId}`
        : "";

    return regressedQueryCteTemplate(
        lines.join("\n").trimEnd(),
        statsTableName,
        statsTableAlias,
        endTimeParameter,
        startTimeParameter,
        replicaFilter,
    );
}

/** The columns that join the recent and history windows. */
function getResultStatement(
    configuration: ResolvedConfiguration,
    metrics: readonly QueryStoreMetric[],
    executionCountPrefix: string,
): string {
    const statistic = configuration.selectedStatistic;
    const lines: string[] = [];
    for (const metric of metrics) {
        const name = `${statisticQueryString(statistic)}_${metricQueryString(metric)}`;
        lines.push(
            `    ${getRegressionCalculation(statistic, metric, executionCountPrefix)} ${statisticMetricRegressionColumnInfo(statistic, metric).id},`,
            `    ${getTimeIntervalCalculation(statistic, metric, "recent")} ${name}_recent,`,
            `    ${getTimeIntervalCalculation(statistic, metric, "history")} ${name}_hist,`,
        );
    }
    return lines.join("\n").trimEnd();
}

/**
 * The final select list: query ID, object ID, object name, query text, then the regression,
 * recent, and history values of each metric, then the recent and history execution counts, and
 * the plan count.
 */
function getFinalSelects(
    configuration: ResolvedConfiguration,
    metrics: readonly QueryStoreMetric[],
): SelectList {
    const statistic = configuration.selectedStatistic;
    const queryIdColumn = simpleColumnInfo("queryId");
    const objectIdColumn = simpleColumnInfo("objectId");
    const objectNameColumn = simpleColumnInfo("objectName");
    const queryTextColumn = simpleColumnInfo("queryText");
    const columns: QueryStoreColumnInfo[] = [
        queryIdColumn,
        objectIdColumn,
        objectNameColumn,
        queryTextColumn,
    ];
    const lines: string[] = [];

    for (const metric of metrics) {
        const regressionColumn = statisticMetricRegressionColumnInfo(statistic, metric);
        const recentColumn = statisticMetricTimeColumnInfo(statistic, metric, "recent");
        const historyColumn = statisticMetricTimeColumnInfo(statistic, metric, "history");
        lines.push(`    results.${regressionColumn.id} ${regressionColumn.id},`);
        lines.push(`    results.${recentColumn.id} ${recentColumn.id},`);
        lines.push(`    results.${historyColumn.id} ${historyColumn.id},`);
        columns.push(regressionColumn, recentColumn, historyColumn);
    }

    const executionCountRecentColumn = executionCountColumnInfo("recent");
    const executionCountHistoryColumn = executionCountColumnInfo("history");
    const numPlansColumn = simpleColumnInfo("numPlans");
    columns.push(executionCountRecentColumn, executionCountHistoryColumn, numPlansColumn);

    const text = regressedQueryFinalSelectTemplate(
        rowsToReturnString(configuration.returnAllQueries),
        queryIdColumn.id,
        objectIdColumn.id,
        objectNameColumn.id,
        queryTextColumn.id,
        lines.join("\n").trimEnd(),
        executionCountRecentColumn.id,
        executionCountHistoryColumn.id,
        numPlansColumn.id,
    );
    return { text, columns };
}

function generateFilterClause(columnName: string): string {
    return `\nWHERE ${columnName} > 0`;
}

/**
 * Combines the wait stats and runtime stats columns of one window. A query that did not wait has
 * no wait stats row, so wait time uses `ISNULL`.
 */
function getCombinedColumnNames(
    table1: string,
    table2: string,
    statistic: QueryStoreStatistic,
    metrics: readonly QueryStoreMetric[],
): string {
    const lines = metrics.map((metric) => {
        const name = `${statisticQueryString(statistic)}_${metricQueryString(metric)}`;
        return metric === "waitTime"
            ? `    ISNULL(${table2}.${name}, 0) ${name},`
            : `    ${table1}.${name} ${name},`;
    });
    return lines.join("\n").trimEnd();
}

function removeFirst(
    metrics: readonly QueryStoreMetric[],
    metric: QueryStoreMetric,
): QueryStoreMetric[] {
    const result = [...metrics];
    const index = result.indexOf(metric);
    if (index >= 0) {
        result.splice(index, 1);
    }
    return result;
}

function resolveConfiguration(config: RegressedQueriesConfiguration): ResolvedConfiguration {
    if (!config || typeof config !== "object") {
        throw new RangeError("The configuration must be an object.");
    }
    return {
        ...resolveQueryConfigurationBase(config, { selectedStatistic: "total" }),
        timeIntervalRecent: config.timeIntervalRecent ?? { option: "lastHour" },
        timeIntervalHistory: config.timeIntervalHistory ?? { option: "lastWeek" },
        minExecutionCount: formatBigInt(config.minExecutionCount ?? 1),
    };
}

/**
 * `@recent_start_time`, `@recent_end_time`, `@history_start_time`, `@history_end_time`,
 * `@min_exec_count`, `@results_row_count` when the report does not return all queries, and
 * `@replica_group_id` when the SQL uses it.
 */
function reportParameters(
    config: RegressedQueriesConfiguration,
    sql: string,
    now: Date,
): QueryStoreSqlParameter[] {
    const configuration = resolveConfiguration(config);
    const result = [
        ...timeIntervalParameters(
            parameters.recentStartTime,
            parameters.recentEndTime,
            resolveTimeInterval(configuration.timeIntervalRecent, now),
            configuration.displayTimeKind,
        ),
        ...timeIntervalParameters(
            parameters.historyStartTime,
            parameters.historyEndTime,
            resolveTimeInterval(configuration.timeIntervalHistory, now),
            configuration.displayTimeKind,
        ),
        {
            name: parameters.minExecutionCount,
            type: "bigint",
            value: configuration.minExecutionCount,
        } satisfies QueryStoreSqlParameter,
    ];
    if (!configuration.returnAllQueries) {
        result.push({
            name: parameters.resultsRowCount,
            type: "int",
            value: configuration.topQueriesReturned,
        });
    }
    return withUsedParameters(sql, result, [replicaGroupIdParameter(configuration.replicaGroupId)]);
}

/** C# `QueryTemplates.GenerateRegressedQueryTemplate`. */
function regressedQueryTemplate(
    waitStatsSubQuery: string,
    historyTimeIntervalCte: string,
    recentTimeIntervalCte: string,
    finalSelectColumns: string,
    resultStatement: string,
    parameterMinExecutionCount: string,
    minNumberOfQueryPlans: number,
    additionalFilter: string,
): string {
    return `WITH ${waitStatsSubQuery}
hist AS
(
${historyTimeIntervalCte}
),
recent AS
(
${recentTimeIntervalCte}
)
${finalSelectColumns}
FROM
(
SELECT
    hist.query_id query_id,
    q.object_id object_id,
    qt.query_sql_text query_sql_text,
${resultStatement}
    recent.count_executions count_executions_recent,
    hist.count_executions count_executions_hist
FROM hist
    JOIN recent ON hist.query_id = recent.query_id
    JOIN sys.query_store_query q ON q.query_id = hist.query_id
    JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
WHERE
    recent.count_executions >= ${parameterMinExecutionCount}
) AS results
JOIN
(
SELECT
    p.query_id query_id,
    COUNT(distinct p.plan_id) num_plans
FROM sys.query_store_plan p
GROUP BY p.query_id
HAVING COUNT(distinct p.plan_id) >= ${formatInt(minNumberOfQueryPlans)}
) AS queries ON queries.query_id = results.query_id${additionalFilter}`;
}

/** C# `QueryTemplates.GenerateRegressedQueryDetailWithWaitStatsTemplate`. */
function regressedQueryDetailWithWaitStatsTemplate(
    waitStatsSubQuery: string,
    historyWaittimeIntervalCte: string,
    historyRuntimeIntervalCte: string,
    combinedHistoryColumns: string,
    recentWaittimeIntervalCte: string,
    recentRuntimetimeTimeIntervalCte: string,
    combinedRecentColumns: string,
    combinedHistoryRecentColumns: string,
    combinedColumns: string,
    parameterMinExecutionCount: string,
    minNumberOfQueryPlans: number,
): string {
    return `WITH
${waitStatsSubQuery}
wait_stats_hist AS
(
${historyWaittimeIntervalCte}
),
other_hist AS
(
${historyRuntimeIntervalCte}
),
hist AS
(
SELECT
    other_hist.query_id,
${combinedHistoryColumns}
    other_hist.count_executions,
    wait_stats_hist.count_executions wait_stats_count_executions,
    other_hist.num_plans
FROM other_hist
    LEFT JOIN wait_stats_hist ON wait_stats_hist.query_id = other_hist.query_id
),
wait_stats_recent AS
(
${recentWaittimeIntervalCte}
),
other_recent AS
(
${recentRuntimetimeTimeIntervalCte}
),
recent AS
(
SELECT
    other_recent.query_id,
${combinedRecentColumns}
    other_recent.count_executions,
    wait_stats_recent.count_executions wait_stats_count_executions,
    other_recent.num_plans
FROM other_recent
    LEFT JOIN wait_stats_recent ON wait_stats_recent.query_id = other_recent.query_id
)
${combinedHistoryRecentColumns}
FROM
(
SELECT
    hist.query_id query_id,
    q.object_id object_id,
    qt.query_sql_text query_sql_text,
${combinedColumns}
    recent.count_executions count_executions_recent,
    hist.count_executions count_executions_hist
FROM hist
    JOIN recent ON hist.query_id = recent.query_id
    JOIN sys.query_store_query q ON q.query_id = hist.query_id
    JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
WHERE
    recent.count_executions >= ${parameterMinExecutionCount}
) AS results
JOIN
(
SELECT
    p.query_id query_id,
    COUNT(distinct p.plan_id) num_plans
FROM sys.query_store_plan p
GROUP BY p.query_id
HAVING COUNT(distinct p.plan_id) >= ${formatInt(minNumberOfQueryPlans)}
) AS queries ON queries.query_id = results.query_id`;
}

/** C# `QueryTemplates.GenerateRegressedQueryFinalSelectTemplate`. */
function regressedQueryFinalSelectTemplate(
    rowsToReturn: string,
    queryIdColumnName: string,
    objectIdColumnName: string,
    objectNameColumnName: string,
    queryTextIdColumnName: string,
    selectedMetricColumnNames: string,
    execCountRecentColumn: string,
    execCountHistoryColumn: string,
    numPlansColumn: string,
): string {
    return `SELECT ${rowsToReturn}
    results.query_id ${queryIdColumnName},
    results.object_id ${objectIdColumnName},
    ISNULL(OBJECT_NAME(results.object_id),'') ${objectNameColumnName},
    results.query_sql_text ${queryTextIdColumnName},
${selectedMetricColumnNames}
    ISNULL(results.${execCountRecentColumn}, 0) ${execCountRecentColumn},
    ISNULL(results.${execCountHistoryColumn}, 0) ${execCountHistoryColumn},
    queries.num_plans ${numPlansColumn}`;
}

/** C# `QueryTemplates.GenerateRegressedQueryCteTemplate`. */
function regressedQueryCteTemplate(
    metrics: string,
    statsTableName: string,
    statsTableAlias: string,
    endTimeParameter: string,
    startTimeParameter: string,
    replicaFilter: string,
): string {
    return `SELECT
    p.query_id query_id,
${metrics}
FROM ${statsTableName} ${statsTableAlias}
    JOIN sys.query_store_plan p ON p.plan_id = ${statsTableAlias}.plan_id
WHERE
    NOT (${statsTableAlias}.first_execution_time > ${endTimeParameter} OR ${statsTableAlias}.last_execution_time < ${startTimeParameter})
${replicaFilter}
GROUP BY p.query_id`;
}
