/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-jsonrpc";
import type { ReadResult } from "sql-core";
import type {
    AppliedPlanChange,
    AppliedQueryStoreSettingsChange,
    ForcedPlanVerification,
    PlanChangeTarget,
    PreparedPlanChange,
    PreparedQueryStoreSettingsChange,
    QueryStoreInterval,
    QueryStoreMetric,
    QueryStoreOverview,
    QueryStorePlan,
    QueryStoreQueryDetails,
    QueryStoreRanking,
    QueryStoreResult,
    QueryStoreSettingsChange,
    QueryStoreSettingsInfo,
    QueryStoreStatistic,
    QueryStoreWaitStats,
    TopQueries,
} from "sql-core/queryStore";

/*
 * The messages of the performance dashboard. Every value is JSON and a code, not display text:
 * the webview shows localized text for each code.
 */

export type * from "sql-core/queryStore";
export type { ReadResult, ReadStatus, SqlPlatform } from "sql-core";

export type PerformanceUnavailableReason =
    /** `mssql.enableExperimentalFeatures` or `mssql.sqlDataPlane.enabled` is off. */
    | "dataPlaneDisabled"
    /** The settings are on, but the window has not reloaded since they changed. */
    | "reloadRequired"
    /** The SQL data plane did not start or cannot open sessions. */
    | "dataPlaneUnavailable"
    /** No saved profile matches the dashboard's connection. */
    | "connectionNotFound"
    /** The SQL data plane does not support the authentication type of the connection. */
    | "authenticationUnsupported"
    /** The session did not open, for example because the server is not reachable. */
    | "connectionFailed";

export interface PerformanceUnavailable {
    readonly status: "unavailable";
    readonly reason: PerformanceUnavailableReason;
    /** The settings that must be on, for `dataPlaneDisabled` and `reloadRequired`. */
    readonly requiredSettings?: readonly string[];
    /** The data plane's untranslated error text. */
    readonly detail?: string;
}

export function isPerformanceUnavailable(value: unknown): value is PerformanceUnavailable {
    return (
        typeof value === "object" &&
        !!value &&
        (value as { status?: unknown }).status === "unavailable"
    );
}

/** A read of the dashboard's database, or why the database could not be read. */
export type PerformanceRead<T> = QueryStoreResult<T> | ReadResult<T> | PerformanceUnavailable;

export interface PerformanceDashboardState {
    serverName: string;
    /** Empty for the login's default database. */
    databaseName: string;
    /**
     * The category of the Queries page that the user chose last, in any dashboard. The extension
     * saves it, so the page opens at it after a restart.
     */
    queryCategory?: QueryCategory;
}

/** The categories of the Queries page. */
export type QueryCategory = "cpu" | "duration" | "memory" | "executions" | "reads";

export interface SetQueryCategoryParams {
    readonly category: QueryCategory;
}

/** Saves the category of the Queries page that the user chose, for the next dashboard. */
export namespace SetQueryCategoryRequest {
    export const type = new RequestType<SetQueryCategoryParams, void, void>(
        "performanceDashboard/setQueryCategory",
    );
}

export type PerformanceDashboardReducers = Record<string, never>;

export interface TimeWindowParams {
    /** ISO 8601 UTC. */
    readonly startUtc: string;
    readonly endUtc: string;
}

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

/** Reads the state of Query Store and how far back its data goes, for the time range picker. */
export namespace GetQueryStoreOverviewRequest {
    export const type = new RequestType<void, PerformanceRead<QueryStoreOverview>, void>(
        "performanceDashboard/getQueryStoreOverview",
    );
}

export interface TopQueriesParams extends TimeWindowParams {
    readonly rankBy: QueryStoreRanking;
    /** Default `total`. */
    readonly statistic?: QueryStoreStatistic;
    readonly top: number;
}

/** Reads the queries with the highest statistic of a metric, and the workload totals. */
export namespace GetTopQueriesRequest {
    export const type = new RequestType<TopQueriesParams, PerformanceRead<TopQueries>, void>(
        "performanceDashboard/getTopQueries",
    );
}

export interface QueryWindowParams extends TimeWindowParams {
    readonly queryId: string;
    readonly metrics: readonly QueryStoreMetric[];
}

/** Reads the text, the module, the plans, and the runtime stats of one query. */
export namespace GetQueryDetailsRequest {
    export const type = new RequestType<
        QueryWindowParams,
        PerformanceRead<QueryStoreQueryDetails>,
        void
    >("performanceDashboard/getQueryDetails");
}

export interface QueryHistoryParams extends QueryWindowParams {
    /** The shortest bucket to sum the intervals into, in minutes. Default: each interval. */
    readonly bucketMinutes?: number;
}

/** Reads the runtime stats of one query for each Query Store interval, or bucket of intervals. */
export namespace GetQueryHistoryRequest {
    export const type = new RequestType<
        QueryHistoryParams,
        PerformanceRead<readonly QueryStoreInterval[]>,
        void
    >("performanceDashboard/getQueryHistory");
}

export interface QueryWaitStatsParams extends TimeWindowParams {
    readonly queryId: string;
    /** One plan's waits. Default: every plan of the query. */
    readonly planId?: string;
    /** The shortest bucket of the waits over time, in minutes. Default: each interval. */
    readonly bucketMinutes?: number;
}

/** Reads the wait time of one query by wait category, in total and over time. */
export namespace GetQueryWaitStatsRequest {
    export const type = new RequestType<
        QueryWaitStatsParams,
        PerformanceRead<QueryStoreWaitStats>,
        void
    >("performanceDashboard/getQueryWaitStats");
}

/** Reads the plans of one query. */
export namespace GetQueryPlansRequest {
    export const type = new RequestType<
        QueryWindowParams,
        PerformanceRead<readonly QueryStorePlan[]>,
        void
    >("performanceDashboard/getQueryPlans");
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

/** Prepares forcing or unforcing a plan, for review. Changes nothing. */
export namespace PreparePlanChangeRequest {
    export const type = new RequestType<
        PlanChangeTarget,
        PerformanceRead<PreparedPlanChange>,
        void
    >("performanceDashboard/preparePlanChange");
}

/**
 * Applies a prepared plan change after the user approved it. sql-core reads the state again and
 * refuses a change that is not the prepared one.
 */
export namespace ApplyPlanChangeRequest {
    export const type = new RequestType<
        PreparedPlanChange,
        PerformanceRead<AppliedPlanChange>,
        void
    >("performanceDashboard/applyPlanChange");
}

export interface VerifyForcedPlanParams extends PlanParams {
    /** The time of the change, ISO 8601 UTC. */
    readonly sinceUtc: string;
}

/** Reads whether the forced plan is in use since the change. */
export namespace VerifyForcedPlanRequest {
    export const type = new RequestType<
        VerifyForcedPlanParams,
        PerformanceRead<ForcedPlanVerification>,
        void
    >("performanceDashboard/verifyForcedPlan");
}

/** Reads the Query Store settings, the ALTER permission, and whether a change is allowed. */
export namespace GetQueryStoreSettingsRequest {
    export const type = new RequestType<void, PerformanceRead<QueryStoreSettingsInfo>, void>(
        "performanceDashboard/getQueryStoreSettings",
    );
}

/** Prepares a change of the Query Store settings for review. Changes nothing. */
export namespace PrepareQueryStoreSettingsChangeRequest {
    export const type = new RequestType<
        QueryStoreSettingsChange,
        PerformanceRead<PreparedQueryStoreSettingsChange>,
        void
    >("performanceDashboard/prepareQueryStoreSettingsChange");
}

/**
 * Applies a prepared change of the Query Store settings after the user approved it. sql-core
 * reads the settings again and refuses a change that is not the prepared one.
 */
export namespace ApplyQueryStoreSettingsChangeRequest {
    export const type = new RequestType<
        PreparedQueryStoreSettingsChange,
        PerformanceRead<AppliedQueryStoreSettingsChange>,
        void
    >("performanceDashboard/applyQueryStoreSettingsChange");
}

export interface OpenSqlScriptParams {
    readonly sql: string;
}

/** Opens a script in a new query editor connected to the dashboard's database. */
export namespace OpenSqlScriptRequest {
    export const type = new RequestType<OpenSqlScriptParams, void, void>(
        "performanceDashboard/openSqlScript",
    );
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

/** The tabs of the query page. */
export type QueryPageTab = "history" | "waits" | "plans" | "compare";

/** What a chat prompt asks about a query: an analysis of its performance, or an explanation. */
export type ChatPrompt = "analyze" | "explain";

export interface ContinueInChatParams extends TimeWindowParams {
    readonly prompt: ChatPrompt;
    readonly queryId: string;
}

/**
 * Sends Copilot Chat a prompt about the query that names the dashboard's connection, database,
 * and time range, so the chat does not need to find them.
 */
export namespace ContinueInChatRequest {
    export const type = new RequestType<ContinueInChatParams, void, void>(
        "performanceDashboard/continueInChat",
    );
}
