/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResolvedQueryConfigurationBase } from "./configuration";
import { queryStoreParameters } from "./queryGeneratorUtils";
import {
    QueryStoreSqlParameter,
    referencesSqlParameter,
    timeIntervalParameters,
} from "./sqlParameters";
import { ResolvedTimeInterval } from "./timeInterval";

/*
 * The parameter lists of the report facades. Some C# queries use a variable that the C# facade
 * does not declare, so the query fails: @replica_group_id when Query Store for secondary replicas
 * is on or the replica is not the primary, and @interval_start_time in the plan summary when it
 * covers all history. This port declares a variable when the SQL uses it and the list does not
 * have it. It adds the declarations after the ones the C# code has.
 */

/**
 * Appends each optional parameter that the SQL uses and that the list does not declare.
 */
export function withUsedParameters(
    sql: string,
    parameters: readonly QueryStoreSqlParameter[],
    optional: readonly QueryStoreSqlParameter[],
): QueryStoreSqlParameter[] {
    const result = [...parameters];
    for (const parameter of optional) {
        const declared = result.some(
            (item) => item.name.toLowerCase() === parameter.name.toLowerCase(),
        );
        if (!declared && referencesSqlParameter(sql, parameter.name)) {
            result.push(parameter);
        }
    }
    return result;
}

/** `@replica_group_id` as a `bigint`, like the C# code binds it. */
export function replicaGroupIdParameter(replicaGroupId: string): QueryStoreSqlParameter {
    return { name: queryStoreParameters.replicaGroupId, type: "bigint", value: replicaGroupId };
}

/**
 * The parameters of the reports with one time interval: `@interval_start_time`,
 * `@interval_end_time`, `@results_row_count` when the report does not return all queries, and
 * `@replica_group_id` when the SQL uses it.
 */
export function intervalReportParameters(
    sql: string,
    configuration: ResolvedQueryConfigurationBase,
    interval: ResolvedTimeInterval,
): QueryStoreSqlParameter[] {
    const parameters = timeIntervalParameters(
        queryStoreParameters.intervalStartTime,
        queryStoreParameters.intervalEndTime,
        interval,
        configuration.displayTimeKind,
    );
    if (!configuration.returnAllQueries) {
        parameters.push({
            name: queryStoreParameters.resultsRowCount,
            type: "int",
            value: configuration.topQueriesReturned,
        });
    }
    return withUsedParameters(sql, parameters, [
        replicaGroupIdParameter(configuration.replicaGroupId),
    ]);
}
