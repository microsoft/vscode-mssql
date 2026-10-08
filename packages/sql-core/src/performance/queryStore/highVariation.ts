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
import {
    SelectList,
    getDetailFinalSelects,
    getExecutionCountText,
    getPlanCountText,
} from "./common/queryTemplates";
import { intervalReportParameters } from "./common/reportParameters";
import { formatInt, getOrderByColumn, prependSqlParameters } from "./common/sqlParameters";
import { QueryStoreStatistic, statisticQueryString } from "./common/statistic";
import { QueryStoreTimeInterval, resolveTimeInterval } from "./common/timeInterval";
import { appendOrderBy, except } from "./common/utils";
import { getWaitStatsTableExpression } from "./common/waitStats";

/*
 * Port of HighVariationQueryGenerator and the High Variation functions of
 * QueryStoreQueryGenerator from SQL Tools Service.
 */

export interface HighVariationConfiguration extends QueryConfigurationBase {
    /** Default `{ option: "lastHour" }`. */
    readonly timeInterval?: QueryStoreTimeInterval;
    /** Default `"variation"`. */
    readonly selectedStatistic?: QueryStoreStatistic;
}

interface ResolvedConfiguration extends ResolvedQueryConfigurationBase {
    readonly timeInterval: QueryStoreTimeInterval;
}

const parameters = queryStoreParameters;

/**
 * Returns the query for the High Variation report, with the `DECLARE` statements for its
 * parameters. A relative time interval ends at `now`. C#
 * `QueryStoreQueryGenerator.GetHighVariationQueriesSummaryReportQuery`.
 *
 * @param orderByColumnId The `id` of a column of {@link highVariationSummary}. Default: the first
 * column.
 */
export function getHighVariationQueriesSummaryReportQuery(
    config: HighVariationConfiguration,
    orderByColumnId?: string,
    descending = true,
    now: Date = new Date(),
): string {
    const { columns } = highVariationSummary(config);
    const orderByColumn = getOrderByColumn(orderByColumnId, columns);
    const { sql } = highVariationSummary(config, orderByColumn, descending);
    return prependSqlParameters(sql, reportParameters(config, sql, now));
}

/**
 * Returns the query for the detailed High Variation report, which has every available metric,
 * with the `DECLARE` statements for its parameters. C#
 * `QueryStoreQueryGenerator.GetHighVariationQueriesDetailedSummaryReportQuery`, which reads the
 * metrics from the database.
 */
export function getHighVariationQueriesDetailedSummaryReportQuery(
    config: HighVariationConfiguration,
    availableMetrics: readonly QueryStoreMetric[],
    orderByColumnId?: string,
    descending = true,
    now: Date = new Date(),
): string {
    const { columns } = highVariationDetailedSummary(availableMetrics, config);
    const orderByColumn = getOrderByColumn(orderByColumnId, columns);
    const { sql } = highVariationDetailedSummary(
        availableMetrics,
        config,
        orderByColumn,
        descending,
    );
    return prependSqlParameters(sql, reportParameters(config, sql, now));
}

/**
 * Returns the query for the High Variation report without parameter declarations, and its
 * columns. Sorts by `orderByColumn` when it is set. C#
 * `HighVariationQueryGenerator.HighVariationSummary`.
 */
export function highVariationSummary(
    config: HighVariationConfiguration,
    orderByColumn?: QueryStoreColumnInfo,
    descending = true,
): QueryStoreQuery {
    const configuration = resolveConfiguration(config);
    const statistic = configuration.selectedStatistic;
    const metric = configuration.selectedMetric;

    const statsViewName = getStatsViewName(metric);
    const statsAlias = getStatsViewAlias(metric);
    const waitstatsSubQuery =
        metric === "waitTime"
            ? getWaitStatsTableExpression(statsViewName, {
                  includeReplicaGroupId: configuration.isQdsRoAvailable,
                  includeQueryExecutionLastWaitTime: false,
                  addWithClause: true,
              })
            : "";

    const replicaFilter = configuration.isQdsRoAvailable
        ? `    AND ${statsAlias}.replica_group_id = ${parameters.replicaGroupId}`
        : "";

    const finalSelects = getFinalSelects(metric, statistic, statsAlias);
    const query = highVariationQueryTemplate(
        waitstatsSubQuery,
        rowsToReturnString(configuration.returnAllQueries),
        finalSelects.text,
        statsViewName,
        statsAlias,
        parameters.intervalEndTime,
        parameters.intervalStartTime,
        configuration.minNumberOfQueryPlans,
        "count_executions",
        replicaFilter,
    ).trim();

    return {
        sql: appendOrderBy(query, orderByColumn, { descending }),
        columns: finalSelects.columns,
    };
}

/**
 * Returns the query for the detailed High Variation report without parameter declarations, and
 * its columns. Sorts by `orderByColumn` when it is set. C#
 * `HighVariationQueryGenerator.HighVariationDetailedSummary`.
 */
export function highVariationDetailedSummary(
    availableMetrics: readonly QueryStoreMetric[],
    config: HighVariationConfiguration,
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
    const runtimestatsViewName = getStatsViewName(selectedMetric);
    const runtimestatsViewAlias = getStatsViewAlias(selectedMetric);
    const runtimestatsMetricList = except(availableMetrics, ["executionCount", "waitTime"]);

    const replicaFilter = configuration.isQdsRoAvailable
        ? ` AND ${runtimestatsViewAlias}.replica_group_id = ${parameters.replicaGroupId}`
        : "";

    const cte = getCteStatement(
        configuration,
        runtimestatsMetricList,
        selectedMetric,
        true,
        runtimestatsViewName,
        runtimestatsViewAlias,
        parameters.intervalStartTime,
        parameters.intervalEndTime,
    );
    const query = highVariationDetailedQueryTemplate(
        cte.text,
        configuration.minNumberOfQueryPlans,
        runtimestatsViewAlias,
        replicaFilter,
    );

    return { sql: appendOrderBy(query, orderByColumn, { descending }), columns: cte.columns };
}

/** C# `HighVariationQueryGenerator.HighVariationDetailedSummaryWithWaitStats`. */
function detailedSummaryWithWaitStats(
    availableMetrics: readonly QueryStoreMetric[],
    configuration: ResolvedConfiguration,
    orderByColumn: QueryStoreColumnInfo | undefined,
    descending: boolean,
): QueryStoreQuery {
    const waitTimeMetric: QueryStoreMetric = "waitTime";
    const durationMetric: QueryStoreMetric = "duration";
    const waitstatsViewName = getStatsViewName(waitTimeMetric);
    const waitstatsViewAlias = getStatsViewAlias(waitTimeMetric);
    const runtimestatsViewName = getStatsViewName(durationMetric);
    const runtimestatsViewAlias = getStatsViewAlias(durationMetric);

    const waitstatsMetricList: QueryStoreMetric[] = [waitTimeMetric];
    const runtimestatsMetricList = except(availableMetrics, ["executionCount", "waitTime"]);
    const statsMetricList = except(availableMetrics, ["executionCount"]);

    const waitstatsSubQuery = getWaitStatsTableExpression(waitstatsViewName, {
        statisticList: ["avg", "stdev"],
        includeReplicaGroupId: configuration.isQdsRoAvailable,
        includeQueryExecutionLastWaitTime: false,
        addWithClause: false,
        addSeparator: true,
    });

    const replicaFilter = configuration.isQdsRoAvailable
        ? ` AND A.replica_group_id = ${parameters.replicaGroupId}`
        : "";

    const waitStatsCte = getCteStatement(
        configuration,
        waitstatsMetricList,
        waitTimeMetric,
        false,
        waitstatsViewName,
        waitstatsViewAlias,
        parameters.intervalStartTime,
        parameters.intervalEndTime,
    );
    const runtimeStatsCte = getCteStatement(
        configuration,
        runtimestatsMetricList,
        durationMetric,
        false,
        runtimestatsViewName,
        runtimestatsViewAlias,
        parameters.intervalStartTime,
        parameters.intervalEndTime,
    );
    const finalSelects = getDetailFinalSelects(
        configuration.selectedStatistic,
        statsMetricList,
        "A",
        "B",
    );
    const query = highVariationDetailedQueryWithWaitStatsTemplate(
        waitstatsSubQuery,
        waitStatsCte.text,
        runtimeStatsCte.text,
        rowsToReturnString(configuration.returnAllQueries),
        finalSelects.text,
        configuration.minNumberOfQueryPlans,
        replicaFilter,
    );

    return {
        sql: appendOrderBy(query, orderByColumn, { descending }),
        columns: finalSelects.columns,
    };
}

/**
 * The select list of the summary: query ID, object ID, object name, query text, standard
 * deviation and average of the metric, the variation when the statistic is `variation`,
 * execution count, and plan count.
 */
function getFinalSelects(
    metric: QueryStoreMetric,
    statistic: QueryStoreStatistic,
    statsAlias: string,
): SelectList {
    const queryIdColumn = simpleColumnInfo("queryId");
    const objectIdColumn = simpleColumnInfo("objectId");
    const objectNameColumn = simpleColumnInfo("objectName");
    const queryTextColumn = simpleColumnInfo("queryText");
    const stdDevMetricColumn = statisticMetricColumnInfo("stdev", metric);
    const avgMetricColumn = statisticMetricColumnInfo("avg", metric);
    const variationMetricColumn = statisticMetricColumnInfo("variation", metric);
    const columns = [
        queryIdColumn,
        objectIdColumn,
        objectNameColumn,
        queryTextColumn,
        stdDevMetricColumn,
        avgMetricColumn,
    ];
    const lines = [
        `    p.query_id ${queryIdColumn.id},`,
        `    q.object_id ${objectIdColumn.id},`,
        `    ISNULL(OBJECT_NAME(q.object_id),'') ${objectNameColumn.id},`,
        `    qt.${queryTextColumn.id} ${queryTextColumn.id},`,
        `    ${getRuntimeStatsSummary("stdev", metric, statsAlias)} ${stdDevMetricColumn.id},`,
        `    ${getRuntimeStatsSummary("avg", metric, statsAlias)} ${avgMetricColumn.id},`,
    ];

    if (statistic === "variation") {
        columns.push(variationMetricColumn);
        lines.push(
            `    ${getRuntimeStatsSummary("variation", metric, statsAlias)} ${variationMetricColumn.id},`,
        );
    }

    columns.push(executionCountColumnInfo());
    lines.push(getExecutionCountText(metric, statsAlias));

    columns.push(simpleColumnInfo("numPlans"));
    lines.push(getPlanCountText());

    return { text: lines.join("\n").trimEnd(), columns };
}

/** The query of a common table expression with a column for each metric. */
function getCteStatement(
    configuration: ResolvedConfiguration,
    metrics: readonly QueryStoreMetric[],
    selectedMetric: QueryStoreMetric,
    addTopClause: boolean,
    statsTableName: string,
    statsTableAlias: string,
    startTimeParameter: string,
    endTimeParameter: string,
): SelectList {
    const statistic = configuration.selectedStatistic;
    const columns = [
        simpleColumnInfo("queryId"),
        simpleColumnInfo("objectId"),
        simpleColumnInfo("objectName"),
        simpleColumnInfo("queryText"),
    ];
    const lines: string[] = [];

    for (const metric of metrics) {
        const column = statisticMetricColumnInfo(statistic, metric);
        lines.push(
            `    ${getRuntimeStatsSummary(statistic, metric, statsTableAlias)} ${statisticQueryString(statistic)}_${metricQueryString(metric)},`,
        );
        columns.push(column);
    }

    columns.push(executionCountColumnInfo());
    lines.push(getExecutionCountText(selectedMetric, statsTableAlias));

    columns.push(simpleColumnInfo("numPlans"));
    lines.push(getPlanCountText());

    if (configuration.isQdsRoAvailable) {
        lines.push(`, ${statsTableAlias}.replica_group_id`);
    }

    const replicaFilter = configuration.isQdsRoAvailable
        ? `    AND ${statsTableAlias}.replica_group_id = ${parameters.replicaGroupId}`
        : "";
    // Three spaces, unlike the Top Resource Consumers template.
    const replicaGroupBy = configuration.isQdsRoAvailable
        ? `   , ${statsTableAlias}.replica_group_id `
        : "";

    const text = highVariationCteTemplate(
        addTopClause ? rowsToReturnString(configuration.returnAllQueries) : "",
        lines.join("\n").trimEnd(),
        statsTableName,
        statsTableAlias,
        endTimeParameter,
        startTimeParameter,
        replicaFilter,
        replicaGroupBy,
    );
    return { text, columns };
}

function resolveConfiguration(config: HighVariationConfiguration): ResolvedConfiguration {
    if (!config || typeof config !== "object") {
        throw new RangeError("The configuration must be an object.");
    }
    return {
        ...resolveQueryConfigurationBase(config, { selectedStatistic: "variation" }),
        timeInterval: config.timeInterval ?? { option: "lastHour" },
    };
}

function reportParameters(config: HighVariationConfiguration, sql: string, now: Date) {
    const configuration = resolveConfiguration(config);
    return intervalReportParameters(
        sql,
        configuration,
        resolveTimeInterval(configuration.timeInterval, now),
    );
}

/** C# `QueryTemplates.GenerateHighVariationQueryTemplate`. */
function highVariationQueryTemplate(
    waitstatsSubQuery: string,
    rowsToReturn: string,
    finalSelect: string,
    statsViewName: string,
    statsAlias: string,
    parameterIntervalEndTime: string,
    parameterIntervalStartTime: string,
    minNumberOfQueryPlans: number,
    execCountColumnName: string,
    replicaFilter: string,
): string {
    return `${waitstatsSubQuery}
SELECT ${rowsToReturn}
${finalSelect}
FROM ${statsViewName} ${statsAlias}
    JOIN sys.query_store_plan p ON p.plan_id = ${statsAlias}.plan_id
    JOIN sys.query_store_query q ON q.query_id = p.query_id
    JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
WHERE
    NOT (${statsAlias}.first_execution_time > ${parameterIntervalEndTime} OR ${statsAlias}.last_execution_time < ${parameterIntervalStartTime})
${replicaFilter}
GROUP BY p.query_id, qt.query_sql_text, q.object_id
HAVING COUNT(distinct p.plan_id) >= ${formatInt(minNumberOfQueryPlans)} AND SUM(${statsAlias}.${execCountColumnName}) > 1`;
}

/** C# `QueryTemplates.GenerateHighVariationDetailedQueryWithWaitStatsTemplate`. */
function highVariationDetailedQueryWithWaitStatsTemplate(
    waitstatsSubQuery: string,
    waitStatscteStatement: string,
    runtimeStatscteStatement: string,
    rowsToReturn: string,
    finalSelects: string,
    minNumberOfQueryPlans: number,
    replicaFilter: string,
): string {
    return `WITH ${waitstatsSubQuery}
wait_stats_variation AS
(
${waitStatscteStatement}
),
other_stats_variation AS
(
${runtimeStatscteStatement}
)
SELECT ${rowsToReturn}
${finalSelects}
FROM other_stats_variation A LEFT JOIN wait_stats_variation B on A.query_id = B.query_id and A.query_sql_text = B.query_sql_text and A.object_id = B.object_id
WHERE A.num_plans >= ${formatInt(minNumberOfQueryPlans)} AND A.count_executions > 1${replicaFilter}`;
}

/** C# `QueryTemplates.GenerateHighVariationDetailedQueryTemplate`. */
function highVariationDetailedQueryTemplate(
    runtimeStatscteStatement: string,
    minNumberOfQueryPlans: number,
    runtimestatsViewAlias: string,
    replicaFilter: string,
): string {
    return `${runtimeStatscteStatement}
HAVING COUNT(distinct p.plan_id) >= ${formatInt(minNumberOfQueryPlans)} AND SUM(${runtimestatsViewAlias}.count_executions) > 1${replicaFilter}`;
}

/** C# `QueryTemplates.GenerateHighVariationCteTemplate`. */
function highVariationCteTemplate(
    rowsToReturn: string,
    metrics: string,
    statsTableName: string,
    statsTableAlias: string,
    endTimeParameter: string,
    startTimeParameter: string,
    replicaFilter: string,
    replicaGroupBy: string,
): string {
    return `SELECT ${rowsToReturn}
    p.query_id query_id,
    q.object_id object_id,
    ISNULL(OBJECT_NAME(q.object_id),'') object_name,
    qt.query_sql_text query_sql_text,
${metrics}
FROM ${statsTableName} ${statsTableAlias}
    JOIN sys.query_store_plan p ON p.plan_id = ${statsTableAlias}.plan_id
    JOIN sys.query_store_query q ON q.query_id = p.query_id
    JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
WHERE
    NOT (${statsTableAlias}.first_execution_time > ${endTimeParameter} OR ${statsTableAlias}.last_execution_time < ${startTimeParameter})
${replicaFilter}
GROUP BY p.query_id, qt.query_sql_text, q.object_id ${replicaGroupBy}`;
}
