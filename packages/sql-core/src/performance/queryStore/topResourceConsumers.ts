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
import {
    QueryStoreSqlParameter,
    formatInt,
    getOrderByColumn,
    prependSqlParameters,
} from "./common/sqlParameters";
import { QueryStoreStatistic, statisticQueryString } from "./common/statistic";
import { QueryStoreTimeInterval, resolveTimeInterval } from "./common/timeInterval";
import { appendOrderBy, except } from "./common/utils";
import { getWaitStatsTableExpression } from "./common/waitStats";

/*
 * Port of TopResourceConsumersQueryGenerator and the Top Resource Consumers functions of
 * QueryStoreQueryGenerator from SQL Tools Service.
 */

export interface TopResourceConsumersConfiguration extends QueryConfigurationBase {
    /** Default `{ option: "lastHour" }`. */
    readonly timeInterval?: QueryStoreTimeInterval;
    /** Default `"total"`. */
    readonly selectedStatistic?: QueryStoreStatistic;
}

interface ResolvedConfiguration extends ResolvedQueryConfigurationBase {
    readonly timeInterval: QueryStoreTimeInterval;
}

const parameters = queryStoreParameters;

/**
 * Returns the query for the Top Resource Consumers report, with the `DECLARE` statements for its
 * parameters. A relative time interval ends at `now`. C#
 * `QueryStoreQueryGenerator.GetTopResourceConsumersSummaryReportQuery`.
 *
 * @param orderByColumnId The `id` of a column of {@link topResourceConsumersSummary}. Default: the
 * first column.
 */
export function getTopResourceConsumersSummaryReportQuery(
    config: TopResourceConsumersConfiguration,
    orderByColumnId?: string,
    descending = true,
    now: Date = new Date(),
): string {
    const { columns } = topResourceConsumersSummary(config);
    const orderByColumn = getOrderByColumn(orderByColumnId, columns);
    const { sql } = topResourceConsumersSummary(config, orderByColumn, descending);
    return prependSqlParameters(sql, reportParameters(config, sql, now));
}

/**
 * Returns the query for the detailed Top Resource Consumers report, which has every available
 * metric, with the `DECLARE` statements for its parameters. C#
 * `QueryStoreQueryGenerator.GetTopResourceConsumersDetailedSummaryReportQuery`, which reads the
 * metrics from the database.
 *
 * @param availableMetrics The metrics that the server records. Read them with
 * `availableMetricsProbeQuery` and `mapAvailableMetrics`.
 * @param orderByColumnId The `id` of a column of {@link topResourceConsumersDetailedSummary}.
 * Default: the first column.
 */
export function getTopResourceConsumersDetailedSummaryReportQuery(
    config: TopResourceConsumersConfiguration,
    availableMetrics: readonly QueryStoreMetric[],
    orderByColumnId?: string,
    descending = true,
    now: Date = new Date(),
): string {
    const { columns } = topResourceConsumersDetailedSummary(availableMetrics, config);
    const orderByColumn = getOrderByColumn(orderByColumnId, columns);
    const { sql } = topResourceConsumersDetailedSummary(
        availableMetrics,
        config,
        orderByColumn,
        descending,
    );
    return prependSqlParameters(sql, reportParameters(config, sql, now));
}

/**
 * Returns the query for the Top Resource Consumers report without parameter declarations, and
 * its columns. Sorts by `orderByColumn` when it is set. C#
 * `TopResourceConsumersQueryGenerator.TopResourceConsumersSummary`.
 */
export function topResourceConsumersSummary(
    config: TopResourceConsumersConfiguration,
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
                  addSeparator: false,
              })
            : "";

    const replicaFilter = configuration.isQdsRoAvailable
        ? `    AND ${statsAlias}.replica_group_id = ${parameters.replicaGroupId}`
        : "";

    const finalSelects = getFinalSelects(metric, statistic, statsAlias);
    const query = summaryTemplate(
        waitstatsSubQuery,
        rowsToReturnString(configuration.returnAllQueries),
        finalSelects.text,
        statsViewName,
        statsAlias,
        parameters.intervalEndTime,
        parameters.intervalStartTime,
        configuration.minNumberOfQueryPlans,
        replicaFilter,
    ).trim();

    return {
        sql: appendOrderBy(query, orderByColumn, { descending }),
        columns: finalSelects.columns,
    };
}

/**
 * Returns the query for the detailed Top Resource Consumers report without parameter
 * declarations, and its columns. Sorts by `orderByColumn` when it is set. C#
 * `TopResourceConsumersQueryGenerator.TopResourceConsumersDetailedSummary`.
 */
export function topResourceConsumersDetailedSummary(
    availableMetrics: readonly QueryStoreMetric[],
    config: TopResourceConsumersConfiguration,
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

    const durationMetric: QueryStoreMetric = "duration";
    const runtimestatsViewName = getStatsViewName(durationMetric);
    const runtimestatsViewAlias = getStatsViewAlias(durationMetric);
    const runtimestatsMetricList = except(availableMetrics, ["executionCount", "waitTime"]);

    const replicaFilter = configuration.isQdsRoAvailable
        ? ` AND ${runtimestatsViewAlias}.replica_group_id = ${parameters.replicaGroupId}`
        : "";

    const cte = getCteStatement(
        configuration,
        runtimestatsMetricList,
        durationMetric,
        runtimestatsViewName,
        runtimestatsViewAlias,
        parameters.intervalStartTime,
        parameters.intervalEndTime,
    );
    const query = detailSummaryTemplate(
        cte.text,
        configuration.minNumberOfQueryPlans,
        replicaFilter,
    );

    return { sql: appendOrderBy(query, orderByColumn, { descending }), columns: cte.columns };
}

/** C# `TopResourceConsumersQueryGenerator.TopResourceConsumersDetailedSummaryWithWaitStats`. */
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

    // The common table expressions always return every row.
    const cteConfiguration: ResolvedConfiguration = { ...configuration, returnAllQueries: true };

    const topWaitStats = getCteStatement(
        cteConfiguration,
        waitstatsMetricList,
        waitTimeMetric,
        waitstatsViewName,
        waitstatsViewAlias,
        parameters.intervalStartTime,
        parameters.intervalEndTime,
    );
    const topOtherStats = getCteStatement(
        cteConfiguration,
        runtimestatsMetricList,
        durationMetric,
        runtimestatsViewName,
        runtimestatsViewAlias,
        parameters.intervalStartTime,
        parameters.intervalEndTime,
    );

    const replicaFilter = configuration.isQdsRoAvailable
        ? ` AND A.replica_group_id = ${parameters.replicaGroupId}`
        : "";

    const finalSelects = getDetailFinalSelects(
        configuration.selectedStatistic,
        statsMetricList,
        "A",
        "B",
    );
    const query = detailSummaryWithWaitStatsTemplate(
        waitstatsSubQuery,
        topWaitStats.text,
        topOtherStats.text,
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
 * The select list of the summary: query ID, object ID, object name, query text, the statistic of
 * the metric (not for execution count), execution count, and plan count.
 */
function getFinalSelects(
    metric: QueryStoreMetric,
    statistic: QueryStoreStatistic,
    statsTableName: string,
): SelectList {
    const queryIdColumn = simpleColumnInfo("queryId");
    const objectIdColumn = simpleColumnInfo("objectId");
    const objectNameColumn = simpleColumnInfo("objectName");
    const queryTextColumn = simpleColumnInfo("queryText");
    const columns = [queryIdColumn, objectIdColumn, objectNameColumn, queryTextColumn];
    const lines = [
        `    p.query_id ${queryIdColumn.id},`,
        `    q.object_id ${objectIdColumn.id},`,
        `    ISNULL(OBJECT_NAME(q.object_id),'') ${objectNameColumn.id},`,
        `    qt.${queryTextColumn.id} ${queryTextColumn.id},`,
    ];

    // The execution count column is already in the list.
    if (metric !== "executionCount") {
        const extendedTooltipData = metric === "waitTime" && statistic === "total";
        const statisticMetricColumn = statisticMetricColumnInfo(
            statistic,
            metric,
            extendedTooltipData,
        );
        columns.push(statisticMetricColumn);
        lines.push(
            `    ${getRuntimeStatsSummary(statistic, metric, statsTableName)} ${statisticMetricColumn.id},`,
        );
    }

    columns.push(executionCountColumnInfo());
    lines.push(getExecutionCountText(metric, statsTableName));

    columns.push(simpleColumnInfo("numPlans"));
    lines.push(getPlanCountText());

    return { text: lines.join("\n").trimEnd(), columns };
}

/** The query of a common table expression with a column for each metric. */
function getCteStatement(
    configuration: ResolvedConfiguration,
    metrics: readonly QueryStoreMetric[],
    selectedMetric: QueryStoreMetric,
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
    const replicaGroupBy = configuration.isQdsRoAvailable
        ? `  , ${statsTableAlias}.replica_group_id `
        : "";

    const text = cteTemplate(
        rowsToReturnString(configuration.returnAllQueries),
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

function resolveConfiguration(config: TopResourceConsumersConfiguration): ResolvedConfiguration {
    if (!config || typeof config !== "object") {
        throw new RangeError("The configuration must be an object.");
    }
    return {
        ...resolveQueryConfigurationBase(config, { selectedStatistic: "total" }),
        timeInterval: config.timeInterval ?? { option: "lastHour" },
    };
}

/** The parameters of both reports. */
function reportParameters(
    config: TopResourceConsumersConfiguration,
    sql: string,
    now: Date,
): QueryStoreSqlParameter[] {
    const configuration = resolveConfiguration(config);
    return intervalReportParameters(
        sql,
        configuration,
        resolveTimeInterval(configuration.timeInterval, now),
    );
}

/** C# `QueryTemplates.GenerateTopResourceConsumersSummaryTemplate`. */
function summaryTemplate(
    waitstatsSubQuery: string,
    rowsToReturn: string,
    finalSelect: string,
    statsViewName: string,
    statsAlias: string,
    parameterIntervalEndTime: string,
    parameterIntervalStartTime: string,
    minNumberOfQueryPlans: number,
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
HAVING COUNT(distinct p.plan_id) >= ${formatInt(minNumberOfQueryPlans)}`;
}

/** C# `QueryTemplates.GenerateTopResourceConsumersDetailSummaryWithWaitStatsTemplate`. */
function detailSummaryWithWaitStatsTemplate(
    waitstatsSubQuery: string,
    topWaitStats: string,
    topOtherStats: string,
    rowsToReturn: string,
    finalSelects: string,
    minNumberOfQueryPlans: number,
    replicaFilter: string,
): string {
    return `WITH ${waitstatsSubQuery}
top_wait_stats AS
(
${topWaitStats}
),
top_other_stats AS
(
${topOtherStats}
)
SELECT ${rowsToReturn}
${finalSelects}
FROM top_other_stats A LEFT JOIN top_wait_stats B on A.query_id = B.query_id and A.query_sql_text = B.query_sql_text and A.object_id = B.object_id
WHERE A.num_plans >= ${formatInt(minNumberOfQueryPlans)}${replicaFilter}`;
}

/** C# `QueryTemplates.GenerateTopResourceConsumersDetailSummaryTemplate`. */
function detailSummaryTemplate(
    runtimeStatsCteStatement: string,
    minNumberOfQueryPlans: number,
    replicaFilter: string,
): string {
    return `${runtimeStatsCteStatement}
HAVING COUNT(distinct p.plan_id) >= ${formatInt(minNumberOfQueryPlans)}${replicaFilter}`;
}

/** C# `QueryTemplates.GenerateTopResourceConsumersCteTemplate`. */
function cteTemplate(
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
