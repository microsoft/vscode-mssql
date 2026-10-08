/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryStoreMetric, assertQueryStoreMetric } from "./metric";
import { replicaGroupIds } from "./replicaGroup";
import { formatBigInt, formatInt } from "./sqlParameters";
import { QueryStoreStatistic, assertQueryStoreStatistic } from "./statistic";
import { DisplayTimeKind, assertDisplayTimeKind } from "./timeInterval";

/** C# `QueryStoreConstants`, without the values that only the UI uses. */
export const queryStoreConstants = {
    invalidQueryId: 0,
    invalidPlanId: 0,
    invalidReplicaGroupId: -1,
    invalidWaitCategoryId: 0,
    /** The replica group ID when the server does not have Query Store for secondary replicas. */
    replicaGroupIdUnavailable: 0,
    maxRecordsForWaitStatsPerQueryToolTip: 10,
    /** The default minimum number of plans for a query in a report. */
    minNumberOfQueryPlans: 1,
    /** The default number of queries that a report returns. */
    topQueriesReturned: 25,
    /** The default number of wait categories that a report returns. */
    topWaitCategoriesReturned: 10,
} as const;

/**
 * Settings that every report configuration has. C# `QueryConfigurationBase`, without the
 * operational mode, which does not change the generated SQL.
 */
export interface QueryConfigurationBase {
    /** Default `"duration"`. */
    readonly selectedMetric?: QueryStoreMetric;
    /** Default `"avg"`. Some reports have another default. */
    readonly selectedStatistic?: QueryStoreStatistic;
    /** The number of queries to return when `returnAllQueries` is false. An `int`. Default 25. */
    readonly topQueriesReturned?: number;
    /** Default false. */
    readonly returnAllQueries?: boolean;
    /** Keeps only the queries with at least this many plans. An `int`. Default 1. */
    readonly minNumberOfQueryPlans?: number;
    /**
     * The replica group to report on when `isQdsRoAvailable` is true. A `bigint`. Default 1, the
     * primary replica.
     */
    readonly replicaGroupId?: number | bigint | string;
    /**
     * True when the server has Query Store for secondary replicas, that is, when
     * `sys.query_store_runtime_stats` has a `replica_group_id` column. C# `IsQDSROAvailable`.
     * Default false.
     */
    readonly isQdsRoAvailable?: boolean;
    /**
     * The time zone of the `datetimeoffset` parameters and of time buckets. Default `"utc"`. The
     * C# global `QueryStoreCommonConfiguration.DisplayTimeKind` defaults to local time.
     */
    readonly displayTimeKind?: DisplayTimeKind;
}

/** A configuration with every default applied and every value checked. */
export interface ResolvedQueryConfigurationBase {
    readonly selectedMetric: QueryStoreMetric;
    readonly selectedStatistic: QueryStoreStatistic;
    readonly topQueriesReturned: number;
    readonly returnAllQueries: boolean;
    readonly minNumberOfQueryPlans: number;
    /** A decimal string. */
    readonly replicaGroupId: string;
    readonly isQdsRoAvailable: boolean;
    readonly displayTimeKind: DisplayTimeKind;
}

export const queryConfigurationBaseDefaults: ResolvedQueryConfigurationBase = {
    selectedMetric: "duration",
    selectedStatistic: "avg",
    topQueriesReturned: queryStoreConstants.topQueriesReturned,
    returnAllQueries: false,
    minNumberOfQueryPlans: queryStoreConstants.minNumberOfQueryPlans,
    replicaGroupId: String(replicaGroupIds.primary),
    isQdsRoAvailable: false,
    displayTimeKind: "utc",
};

/**
 * Applies the defaults and checks the values. Throws a `RangeError` for a value that is not
 * valid. `defaults` overrides the base defaults, for reports with other defaults.
 */
export function resolveQueryConfigurationBase(
    config: QueryConfigurationBase,
    defaults: Partial<ResolvedQueryConfigurationBase> = {},
): ResolvedQueryConfigurationBase {
    const base = { ...queryConfigurationBaseDefaults, ...defaults };
    const topQueriesReturned = config.topQueriesReturned ?? base.topQueriesReturned;
    const minNumberOfQueryPlans = config.minNumberOfQueryPlans ?? base.minNumberOfQueryPlans;
    formatInt(topQueriesReturned);
    formatInt(minNumberOfQueryPlans);
    return {
        selectedMetric: assertQueryStoreMetric(config.selectedMetric ?? base.selectedMetric),
        selectedStatistic: assertQueryStoreStatistic(
            config.selectedStatistic ?? base.selectedStatistic,
        ),
        topQueriesReturned,
        returnAllQueries: assertBoolean(config.returnAllQueries ?? base.returnAllQueries),
        minNumberOfQueryPlans,
        replicaGroupId: formatBigInt(config.replicaGroupId ?? base.replicaGroupId),
        isQdsRoAvailable: assertBoolean(config.isQdsRoAvailable ?? base.isQdsRoAvailable),
        displayTimeKind: assertDisplayTimeKind(config.displayTimeKind ?? base.displayTimeKind),
    };
}

/** Throws a `RangeError` unless the value is a boolean. */
export function assertBoolean(value: unknown): boolean {
    if (typeof value !== "boolean") {
        throw new RangeError(`Value ${String(value)} is not a boolean.`);
    }
    return value;
}
