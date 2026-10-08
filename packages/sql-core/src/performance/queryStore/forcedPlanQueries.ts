/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryStoreColumnInfo, QueryStoreQuery, simpleColumnInfo } from "./common/columnInfo";
import {
    QueryConfigurationBase,
    ResolvedQueryConfigurationBase,
    resolveQueryConfigurationBase,
} from "./common/configuration";
import { queryStoreParameters, rowsToReturnString } from "./common/queryGeneratorUtils";
import { replicaGroupIds } from "./common/replicaGroup";
import { replicaGroupIdParameter, withUsedParameters } from "./common/reportParameters";
import {
    QueryStoreSqlParameter,
    formatInt,
    getOrderByColumn,
    prependSqlParameters,
} from "./common/sqlParameters";
import { QueryStoreStatistic } from "./common/statistic";
import { QueryStoreTimeInterval } from "./common/timeInterval";
import { appendOrderBy } from "./common/utils";

/*
 * Port of ForcedPlanQueriesQueryGenerator and the Forced Plans function of
 * QueryStoreQueryGenerator from SQL Tools Service.
 */

export interface ForcedPlanQueriesConfiguration extends QueryConfigurationBase {
    /** Default `{ option: "lastMonth" }`. The C# code keeps it, but the SQL does not use it. */
    readonly timeInterval?: QueryStoreTimeInterval;
    /** Default `"avg"`. */
    readonly selectedStatistic?: QueryStoreStatistic;
    /** Default true. */
    readonly returnAllQueries?: boolean;
}

const primaryReplicaGroupId = String(replicaGroupIds.primary);

/**
 * Returns the query for the Forced Plans report. C#
 * `QueryStoreQueryGenerator.GetForcedPlanQueriesReportQuery`, which declares
 * `@results_row_count` as `NVARCHAR(max)` when the report does not return all queries. Returns
 * the query without declarations when it has no parameters.
 *
 * @param orderByColumnId The `id` of a column of {@link forcedPlanQueriesSummary}. Default: the
 * first column. `last_execution_time` is the last execution of the query, because it is the first
 * column with that label.
 */
export function getForcedPlanQueriesReportQuery(
    config: ForcedPlanQueriesConfiguration,
    orderByColumnId?: string,
    descending = true,
): string {
    const { columns } = forcedPlanQueriesSummary(config);
    const orderByColumn = getOrderByColumn(orderByColumnId, columns);
    const { sql } = forcedPlanQueriesSummary(config, orderByColumn, descending);

    const configuration = resolveConfiguration(config);
    const parameters: QueryStoreSqlParameter[] = [];
    if (!configuration.returnAllQueries) {
        parameters.push({
            name: queryStoreParameters.resultsRowCount,
            type: "nvarchar",
            value: formatInt(configuration.topQueriesReturned),
        });
    }
    const used = withUsedParameters(sql, parameters, [
        replicaGroupIdParameter(configuration.replicaGroupId),
    ]);
    return used.length > 0 ? prependSqlParameters(sql, used) : sql;
}

/**
 * Returns the query for the Forced Plans report without parameter declarations, and its columns.
 * Sorts by `orderByColumn` when it is set. C#
 * `ForcedPlanQueriesQueryGenerator.ForcedPlanQueriesSummary`.
 */
export function forcedPlanQueriesSummary(
    config: ForcedPlanQueriesConfiguration,
    orderByColumn?: QueryStoreColumnInfo,
    descending = true,
): QueryStoreQuery {
    const configuration = resolveConfiguration(config);
    const isPrimary = configuration.replicaGroupId === primaryReplicaGroupId;
    const extraJoin = isPrimary
        ? ""
        : " JOIN sys.query_store_plan_forcing_locations qfl ON A.plan_id = qfl.plan_id";
    const replicaGroupIdPredicate = isPrimary
        ? ""
        : ` AND qfl.replica_group_id = ${queryStoreParameters.replicaGroupId}`;

    const finalSelects = getFinalSelects();
    const queryText = `WITH
A AS
(
${getPlanSpecificColumns(isPrimary)}
),
B AS
(
${getAggregatedColumns(isPrimary)}
)
SELECT ${rowsToReturnString(configuration.returnAllQueries)}
${finalSelects.text}
FROM A JOIN B ON A.query_id = B.query_id${extraJoin}
WHERE B.num_plans >= ${formatInt(configuration.minNumberOfQueryPlans)}${replicaGroupIdPredicate}`;

    // Two columns are named last_execution_time, so the ORDER BY needs the table alias.
    const subqueryAlias =
        orderByColumn?.kind === "lastQueryExecTime"
            ? "B"
            : orderByColumn?.kind === "lastForcedPlanExecTime"
              ? "A"
              : undefined;

    return {
        sql: appendOrderBy(queryText, orderByColumn, { descending, subqueryAlias }),
        columns: finalSelects.columns,
    };
}

function getFinalSelects(): { text: string; columns: QueryStoreColumnInfo[] } {
    const queryIdColumn = simpleColumnInfo("queryId");
    const queryTextColumn = simpleColumnInfo("queryText");
    const forcedPlanId = simpleColumnInfo("forcedPlanId");
    const forcedPlanFailureCount = simpleColumnInfo("forcedPlanFailureCount");
    const lastCompileStartTime = simpleColumnInfo("lastCompileStartTime");
    const forcedPlanFailureDescription = simpleColumnInfo("forcedPlanFailureDescription");
    const numPlansColumn = simpleColumnInfo("numPlans");
    const lastQueryExecTime = simpleColumnInfo("lastQueryExecTime");
    const lastForcedPlanExecTime = simpleColumnInfo("lastForcedPlanExecTime");
    const objectIdColumn = simpleColumnInfo("objectId");
    const objectNameColumn = simpleColumnInfo("objectName");

    const columns = [
        queryIdColumn,
        queryTextColumn,
        forcedPlanId,
        forcedPlanFailureCount,
        lastCompileStartTime,
        forcedPlanFailureDescription,
        numPlansColumn,
        lastQueryExecTime,
        lastForcedPlanExecTime,
        objectIdColumn,
        objectNameColumn,
    ];
    const lines = [
        `    A.${queryIdColumn.id},`,
        `    A.${queryTextColumn.id},`,
        `    A.${forcedPlanId.id},`,
        `    A.${forcedPlanFailureCount.id},`,
        `    A.${lastCompileStartTime.id},`,
        `    A.${forcedPlanFailureDescription.id},`,
        `    B.${numPlansColumn.id},`,
        `    B.${lastQueryExecTime.id},`,
        `    A.${lastForcedPlanExecTime.id},`,
        `    A.${objectIdColumn.id},`,
        `    A.${objectNameColumn.id}`,
    ];
    return { text: lines.join("\n").trimEnd(), columns };
}

/** The forced plans. A secondary replica keeps its forcing in another view. */
function getPlanSpecificColumns(isPrimary: boolean): string {
    const queryId = simpleColumnInfo("queryId").id;
    const queryText = simpleColumnInfo("queryText").id;
    const planId = simpleColumnInfo("forcedPlanId").id;
    const forceFailureCount = simpleColumnInfo("forcedPlanFailureCount").id;
    const forcedPlanFailureReason = simpleColumnInfo("forcedPlanFailureDescription").id;
    const lastExecTime = simpleColumnInfo("lastForcedPlanExecTime").id;
    const objectId = simpleColumnInfo("objectId").id;
    const objectName = simpleColumnInfo("objectName").id;
    const lastCompileStartTime = simpleColumnInfo("lastCompileStartTime").id;

    let queryTemplate = `SELECT
    p.${queryId} ${queryId},
    qt.${queryText} ${queryText},
    p.${planId} ${planId},
    p.${forceFailureCount} ${forceFailureCount},
    p.${forcedPlanFailureReason} ${forcedPlanFailureReason},
    p.${lastExecTime} ${lastExecTime},
    q.${objectId} ${objectId},
    ISNULL(OBJECT_NAME(q.${objectId}),'') ${objectName},
    p.${lastCompileStartTime} ${lastCompileStartTime}
FROM sys.query_store_plan p
    JOIN sys.query_store_query q ON q.query_id = p.query_id
    JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id`;

    if (isPrimary) {
        queryTemplate += "\nwhere p.is_forced_plan = 1";
    }
    return queryTemplate;
}

/** The plan count and last execution of each query. */
function getAggregatedColumns(isPrimary: boolean): string {
    const queryId = simpleColumnInfo("queryId").id;
    const lastExecTime = simpleColumnInfo("lastQueryExecTime").id;
    const numPlans = simpleColumnInfo("numPlans").id;

    let queryTemplate = `SELECT
    p.${queryId} ${queryId},
    MAX(p.${lastExecTime}) ${lastExecTime},
    COUNT(distinct p.plan_id) ${numPlans}
FROM sys.query_store_plan p
GROUP BY p.query_id`;

    // A secondary replica does not set is_forced_plan.
    if (isPrimary) {
        queryTemplate += "\nHAVING MAX(CAST(p.is_forced_plan AS tinyint)) = 1";
    }
    return queryTemplate;
}

function resolveConfiguration(
    config: ForcedPlanQueriesConfiguration,
): ResolvedQueryConfigurationBase {
    if (!config || typeof config !== "object") {
        throw new RangeError("The configuration must be an object.");
    }
    return resolveQueryConfigurationBase(config, { returnAllQueries: true });
}
