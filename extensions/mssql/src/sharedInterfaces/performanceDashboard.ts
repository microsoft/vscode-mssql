/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-jsonrpc";
import type {
    ActiveActivity,
    AppliedChange,
    AppliedQueryStoreSettingsChange,
    AutomaticTuningInfo,
    DatabaseFacts,
    ForcedPlanVerification,
    MetricSeries,
    MetricTotals,
    PerformanceResult,
    PerformanceUnavailable,
    PlanShape,
    PreparedChange,
    PreparedQueryStoreSettingsChange,
    QueryDetails,
    QueryHistoryInterval,
    QueryPlanInfo,
    QueryStoreMetric,
    QueryStoreReport,
    DatabaseStorage,
    QueryStoreSettingsChange,
    QueryStoreSettingsInfo,
    QueryStoreStatistic,
    ResourceCpuSample,
    SessionSummary,
    SqlPlatform,
    WaitSeries,
} from "./performance";

export interface PerformanceDashboardState {
    serverName: string;
    /** Empty for the login's default database. */
    databaseName: string;
}

export type PerformanceDashboardReducers = Record<string, never>;

export interface ListDatabasesResult {
    /** The online databases that the connection can see, by name. */
    readonly databases: readonly string[];
    /** Untranslated error text when the list could not be read. */
    readonly errorMessage?: string;
}

/** Lists the databases of the dashboard's server. */
export namespace ListDatabasesRequest {
    export const type = new RequestType<void, ListDatabasesResult, void>(
        "performanceDashboard/listDatabases",
    );
}

export interface SwitchDatabaseParams {
    readonly database: string;
}

export interface SwitchDatabaseResult {
    /**
     * True when the dashboard now shows the database. False when another open dashboard already
     * showed it, and that dashboard was revealed instead.
     */
    readonly switched: boolean;
}

/** Shows another database of the same server in the dashboard. */
export namespace SwitchDatabaseRequest {
    export const type = new RequestType<SwitchDatabaseParams, SwitchDatabaseResult, void>(
        "performanceDashboard/switchDatabase",
    );
}

export interface DatabaseFactsResult {
    readonly platform?: SqlPlatform;
    /** SQL Server major version, for example 16 for SQL Server 2022. */
    readonly majorVersion?: number;
    readonly facts?: DatabaseFacts;
    /** Untranslated error text when the facts could not be read. */
    readonly errorMessage?: string;
}

/** Reads the platform, service tier, and size of the database, for the overview header. */
export namespace GetDatabaseFactsRequest {
    export const type = new RequestType<void, DatabaseFactsResult, void>(
        "performanceDashboard/getDatabaseFacts",
    );
}

export interface QueryStoreAvailability {
    /**
     * The start of the oldest Query Store interval, ISO 8601 UTC. Absent when the database has no
     * Query Store, Query Store is off, or it has no data.
     */
    readonly oldestIntervalStartUtc?: string;
}

/** Reads how far back the Query Store data goes, for the time range picker. */
export namespace GetQueryStoreAvailabilityRequest {
    export const type = new RequestType<void, QueryStoreAvailability, void>(
        "performanceDashboard/getQueryStoreAvailability",
    );
}

/** A read of the performance service: its result, or why it could not run. */
export type PerformanceReadResult<T> = PerformanceResult<T> | PerformanceUnavailable;

export interface TimeWindowParams {
    /** ISO 8601 UTC. */
    readonly startUtc: string;
    readonly endUtc: string;
}

export interface MetricTotalsParams {
    readonly metric: QueryStoreMetric;
    readonly windows: readonly TimeWindowParams[];
}

/** Totals a Query Store metric over each window. */
export namespace GetMetricTotalsRequest {
    export const type = new RequestType<
        MetricTotalsParams,
        PerformanceReadResult<MetricTotals>,
        void
    >("performanceDashboard/getMetricTotals");
}

/** Reads the Query Store totals for each time bucket of the window (Overall Resource Consumption). */
export namespace GetResourceConsumptionRequest {
    export const type = new RequestType<
        TimeWindowParams,
        PerformanceReadResult<QueryStoreReport>,
        void
    >("performanceDashboard/getResourceConsumption");
}

export interface TopQueriesParams extends TimeWindowParams {
    readonly metric: QueryStoreMetric;
    /** The statistic to rank by. Default "total". */
    readonly statistic?: QueryStoreStatistic;
    /** The number of queries to return. */
    readonly top: number;
}

/**
 * Reads the queries with the highest statistic of a metric in the window (Top Resource
 * Consumers). The dashboard's own reads of Query Store and the DMVs are left out.
 */
/**
 * Reads the top queries ranked by a metric, with the same statistic of every other metric, for
 * example the memory grant, the tempdb space, and the executions of each query.
 */
export namespace GetTopQueriesDetailedRequest {
    export const type = new RequestType<
        TopQueriesParams,
        PerformanceReadResult<QueryStoreReport>,
        void
    >("performanceDashboard/getTopQueriesDetailed");
}

export interface StorageParams {
    /** The number of tables to return. */
    readonly top: number;
}

/** Reads the data size, the size limit, and the largest tables. */
export namespace GetStorageRequest {
    export const type = new RequestType<
        StorageParams,
        PerformanceReadResult<DatabaseStorage>,
        void
    >("performanceDashboard/getStorage");
}

/** The dashboard's own settings, apart from the database's. */
export interface DashboardSettings {
    /** Leaves out the dashboard's own queries and session. Off by default. */
    readonly hideOwnActivity: boolean;
}

export namespace GetDashboardSettingsRequest {
    export const type = new RequestType<void, DashboardSettings, void>(
        "performanceDashboard/getDashboardSettings",
    );
}

export namespace SetDashboardSettingsRequest {
    export const type = new RequestType<DashboardSettings, void, void>(
        "performanceDashboard/setDashboardSettings",
    );
}

export namespace GetTopQueriesRequest {
    export const type = new RequestType<
        TopQueriesParams,
        PerformanceReadResult<QueryStoreReport>,
        void
    >("performanceDashboard/getTopQueries");
}

/** Reads the Query Store settings, the ALTER permission, and whether a change is allowed. */
export namespace GetQueryStoreSettingsRequest {
    export const type = new RequestType<void, PerformanceReadResult<QueryStoreSettingsInfo>, void>(
        "performanceDashboard/getQueryStoreSettings",
    );
}

/** Prepares a change of the Query Store settings for review. Changes nothing. */
export namespace PrepareQueryStoreSettingsChangeRequest {
    export const type = new RequestType<
        QueryStoreSettingsChange,
        PerformanceReadResult<PreparedQueryStoreSettingsChange>,
        void
    >("performanceDashboard/prepareQueryStoreSettingsChange");
}

/**
 * Applies a prepared change of the Query Store settings after the user approved it. The extension
 * reads the settings again and refuses a change that is not the prepared one.
 */
export namespace ApplyQueryStoreSettingsChangeRequest {
    export const type = new RequestType<
        PreparedQueryStoreSettingsChange,
        PerformanceReadResult<AppliedQueryStoreSettingsChange>,
        void
    >("performanceDashboard/applyQueryStoreSettingsChange");
}

export interface OpenSqlScriptParams {
    readonly sql: string;
}

/** Opens a script in a new SQL editor, so that the user can review or run it. */
export namespace OpenSqlScriptRequest {
    export const type = new RequestType<OpenSqlScriptParams, void, void>(
        "performanceDashboard/openSqlScript",
    );
}

export interface MetricSeriesParams extends TimeWindowParams {
    readonly metric: QueryStoreMetric;
    readonly bucketMinutes: number;
}

/** Reads a Query Store metric for each time bucket. */
export namespace GetMetricSeriesRequest {
    export const type = new RequestType<
        MetricSeriesParams,
        PerformanceReadResult<MetricSeries>,
        void
    >("performanceDashboard/getMetricSeries");
}

export interface WaitSeriesParams extends TimeWindowParams {
    readonly waitCategoryId: number;
    readonly bucketMinutes: number;
    /** Extra windows to total, for the summary. */
    readonly windows?: readonly TimeWindowParams[];
}

/** Reads the wait time of a wait category for each time bucket. */
export namespace GetWaitSeriesRequest {
    export const type = new RequestType<WaitSeriesParams, PerformanceReadResult<WaitSeries>, void>(
        "performanceDashboard/getWaitSeries",
    );
}

/** Reads the current user sessions of the database. */
export namespace GetSessionSummaryRequest {
    export const type = new RequestType<void, PerformanceReadResult<SessionSummary>, void>(
        "performanceDashboard/getSessionSummary",
    );
}

/** Reads the running requests and the blocking chains. */
export namespace GetActiveRequestsRequest {
    export const type = new RequestType<void, PerformanceReadResult<ActiveActivity>, void>(
        "performanceDashboard/getActiveRequests",
    );
}

/** Reads the automatic tuning options and recommendations. */
export namespace GetAutomaticTuningRequest {
    export const type = new RequestType<void, PerformanceReadResult<AutomaticTuningInfo>, void>(
        "performanceDashboard/getAutomaticTuning",
    );
}

/**
 * Reads the CPU percent of the database from the resource stats of Azure SQL Database: the last
 * hour from the database, and up to 14 days from master. The samples are in time order.
 */
export namespace GetResourceCpuRequest {
    export const type = new RequestType<
        TimeWindowParams,
        PerformanceReadResult<ResourceCpuSample[]>,
        void
    >("performanceDashboard/getResourceCpu");
}

export interface QueryWindowParams extends TimeWindowParams {
    readonly queryId: string;
}

/** Reads the details and the text of one query. */
export namespace GetQueryDetailsRequest {
    export const type = new RequestType<
        QueryWindowParams,
        PerformanceReadResult<QueryDetails>,
        void
    >("performanceDashboard/getQueryDetails");
}

/** Reads the runtime stats of one query for each Query Store interval. */
export namespace GetQueryHistoryRequest {
    export const type = new RequestType<
        QueryWindowParams,
        PerformanceReadResult<{ readonly intervals: readonly QueryHistoryInterval[] }>,
        void
    >("performanceDashboard/getQueryHistory");
}

/** Reads the plans of one query. */
export namespace GetQueryPlansRequest {
    export const type = new RequestType<
        QueryWindowParams,
        PerformanceReadResult<{ readonly plans: readonly QueryPlanInfo[] }>,
        void
    >("performanceDashboard/getQueryPlans");
}

export interface PlanShapesParams {
    readonly planIds: readonly string[];
}

/** Reads the shape of each plan from its showplan XML. A plan without XML has no entry. */
export namespace GetPlanShapesRequest {
    export const type = new RequestType<
        PlanShapesParams,
        { readonly shapes: Readonly<Record<string, PlanShape>> },
        void
    >("performanceDashboard/getPlanShapes");
}

export interface PlanParams {
    readonly queryId: string;
    readonly planId: string;
}

/** Opens the showplan XML of a plan in the execution plan viewer. */
export namespace OpenPlanRequest {
    export const type = new RequestType<PlanParams, { readonly opened: boolean }, void>(
        "performanceDashboard/openPlan",
    );
}

export interface ComparePlansParams {
    readonly queryId: string;
    readonly planIds: readonly [string, string];
}

/** Opens two plans in the execution plan comparison. */
export namespace ComparePlansRequest {
    export const type = new RequestType<ComparePlansParams, { readonly opened: boolean }, void>(
        "performanceDashboard/comparePlans",
    );
}

export interface PlanChangeParams extends PlanParams {
    readonly kind: "forcePlan" | "unforcePlan";
}

/** Prepares forcing or unforcing a plan, for review. Changes nothing. */
export namespace PreparePlanChangeRequest {
    export const type = new RequestType<
        PlanChangeParams,
        PerformanceReadResult<PreparedChange>,
        void
    >("performanceDashboard/preparePlanChange");
}

/** Applies a prepared plan change after the user approved it. */
export namespace ApplyPlanChangeRequest {
    export const type = new RequestType<PreparedChange, PerformanceReadResult<AppliedChange>, void>(
        "performanceDashboard/applyPlanChange",
    );
}

export interface VerifyForcedPlanParams extends PlanParams {
    /** The time of the change, ISO 8601 UTC. */
    readonly since: string;
}

/** Reads whether the forced plan is in use since the change. */
export namespace VerifyForcedPlanRequest {
    export const type = new RequestType<
        VerifyForcedPlanParams,
        PerformanceReadResult<ForcedPlanVerification>,
        void
    >("performanceDashboard/verifyForcedPlan");
}

export interface CopyTextParams {
    readonly text: string;
}

/** Copies text to the clipboard. */
export namespace CopyTextRequest {
    export const type = new RequestType<CopyTextParams, void, void>(
        "performanceDashboard/copyText",
    );
}

export interface FavoriteQueries {
    /** The favorite query IDs of the dashboard's database. */
    readonly queryIds: readonly string[];
}

/** Reads the favorite queries of the dashboard's database. */
export namespace GetFavoriteQueriesRequest {
    export const type = new RequestType<void, FavoriteQueries, void>(
        "performanceDashboard/getFavoriteQueries",
    );
}

export interface SetFavoriteQueryParams {
    readonly queryId: string;
    readonly favorite: boolean;
}

/** Adds or removes a favorite query of the dashboard's database. Returns the new list. */
export namespace SetFavoriteQueryRequest {
    export const type = new RequestType<SetFavoriteQueryParams, FavoriteQueries, void>(
        "performanceDashboard/setFavoriteQuery",
    );
}
