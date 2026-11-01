/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    type PlanChangeKind,
    type PlanChangeWarning,
    type PreparedPlanChange,
    type QueryStoreRanking,
    type QueryStoreStatistic,
    type TimeWindow,
    applyPlanChange,
    buildQueryAnalysis,
    getPlanXml,
    getQueryDetails,
    getQueryHistory,
    getQueryPlans,
    getQueryStoreOverview,
    getTopQueries,
    getWaitStats,
    historyBucketMinutes,
    preparePlanChange,
    queryStoreMetrics,
    summarizePlan,
    verifyForcedPlan,
} from "sql-core/queryStore";
import ConnectionManager from "../../controllers/connectionManager";
import * as Constants from "../../constants/constants";
import * as LocConstants from "../../constants/locConstants";
import { getConnectionDisplayName } from "../../models/connectionInfo";
import { IConnectionProfile } from "../../models/interfaces";
import { PerformanceDashboardTarget } from "../../performance/performanceDashboardWebviewController";
import {
    compactAnalysis,
    compactInterval,
    compactPlan,
    compactPlanSummary,
    compactQuery,
    compactStats,
    compactWaits,
    detailQueryTextLength,
    listQueryTextLength,
} from "../../performance/queryStoreCompact";
import { QueryStoreOperation, QueryStoreService } from "../../performance/queryStoreService";
import {
    PerformanceRead,
    isPerformanceUnavailable,
} from "../../sharedInterfaces/performanceDashboard";
import { resolveToolConnectionReference } from "./toolConnectionResolver";
import { ToolBase } from "./toolBase";
import { getDisplayNameForTool } from "./toolsUtils";

const loc = LocConstants.QueryStoreTools;

/**
 * The database of a Query Store tool call: an open connection, or a saved profile, which the
 * tools read through the SQL data plane without a connection.
 */
export interface QueryStoreToolTargetParams {
    connectionId?: string;
    profileId?: string;
    /** Default: the connection's or the profile's database. */
    database?: string;
}

/** The time window of a read: the last `hours`, or `startUtc` to `endUtc`. Default 24 hours. */
export interface QueryStoreToolWindowParams {
    hours?: number;
    startUtc?: string;
    endUtc?: string;
}

/** The rows of a history read. A longer window sums its intervals into buckets. */
const maxHistoryRows = 48;
const defaultHours = 24;
const maxHours = 365 * 24;
const defaultTop = 10;
const maxTop = 50;
/** The prepared plan changes that wait for their call. Older ones are dropped. */
const maxPreparedChanges = 20;

interface ResolvedTarget extends PerformanceDashboardTarget {
    readonly displayName: string;
}

type TargetResolution = ResolvedTarget | { readonly message: string };

/**
 * The saved profile and database of a tool call. The tools read through the SQL data plane, which
 * opens its own session with the profile's credentials, so an open connection must come from a
 * saved profile.
 */
export async function resolveQueryStoreTarget(
    params: QueryStoreToolTargetParams,
    connectionManager: ConnectionManager,
): Promise<TargetResolution> {
    const database = params.database?.trim();
    if (params.profileId) {
        const profile = (await connectionManager.connectionStore.connectionConfig.getConnectionById(
            params.profileId,
        )) as IConnectionProfile | undefined;
        if (!profile) {
            return { message: loc.profileNotFound(params.profileId) };
        }
        return {
            profileId: params.profileId,
            serverName: profile.server,
            databaseName: database || profile.database || "",
            displayName: getConnectionDisplayName(profile),
        };
    }
    if (!params.connectionId) {
        return { message: loc.connectionOrProfileRequired };
    }
    const resolved = resolveToolConnectionReference(
        { connectionId: params.connectionId },
        connectionManager,
    );
    if ("reason" in resolved) {
        return { message: resolved.message };
    }
    const credentials = resolved.connectionInfo.credentials as IConnectionProfile;
    if (!credentials.id) {
        return { message: loc.savedProfileRequired };
    }
    return {
        profileId: credentials.id,
        serverName: credentials.server,
        databaseName: database || credentials.database || "",
        displayName: getDisplayNameForTool(resolved.connectionInfo),
    };
}

/** The window of a tool call, or undefined when the parameters are not valid. */
export function resolveToolWindow(
    params: QueryStoreToolWindowParams,
    now: Date = new Date(),
): TimeWindow | undefined {
    if (params.startUtc !== undefined || params.endUtc !== undefined) {
        const start = new Date(params.startUtc ?? "");
        const end = new Date(params.endUtc ?? "");
        return start.getTime() < end.getTime() ? { start, end } : undefined;
    }
    const hours = params.hours ?? defaultHours;
    if (!(typeof hours === "number" && hours >= 1 && hours <= maxHours)) {
        return undefined;
    }
    return { start: new Date(now.getTime() - hours * 60 * 60 * 1000), end: now };
}

/**
 * The JSON result of a read: its status and data, or why the database could not be read. The
 * statuses and reasons are codes, which the model explains.
 */
function readResultJson<T>(read: PerformanceRead<T>, shape: (data: T) => unknown): string {
    if (isPerformanceUnavailable(read)) {
        return JSON.stringify({
            success: false,
            status: read.status,
            reason: read.reason,
            requiredSettings: read.requiredSettings,
            detail: read.detail,
        });
    }
    return JSON.stringify({
        success: read.status === "ready" || read.status === "noData",
        status: read.status,
        queryStore: "queryStore" in read ? read.queryStore : undefined,
        error: read.error,
        data: read.data === undefined ? undefined : shape(read.data),
    });
}

function failureJson(message: string): string {
    return JSON.stringify({ success: false, message });
}

function databaseLabel(target: ResolvedTarget): string {
    return target.databaseName || LocConstants.defaultDatabaseLabel;
}

function windowJson(window: TimeWindow) {
    return { startUtc: window.start.toISOString(), endUtc: window.end.toISOString() };
}

/**
 * A Query Store read tool: it resolves the database and runs sql-core reads through the Query
 * Store service. The reads only read Query Store, so they run without a confirmation.
 */
abstract class QueryStoreReadTool<T extends QueryStoreToolTargetParams> extends ToolBase<T> {
    constructor(
        protected readonly connectionManager: ConnectionManager,
        protected readonly service: QueryStoreService,
    ) {
        super();
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<T>,
        _token: vscode.CancellationToken,
    ): Promise<string> {
        const target = await resolveQueryStoreTarget(options.input, this.connectionManager);
        if ("message" in target) {
            return failureJson(target.message);
        }
        return this.read(target, options.input);
    }

    protected abstract read(target: ResolvedTarget, input: T): Promise<string>;

    protected run<TData>(
        target: ResolvedTarget,
        operation: QueryStoreOperation<TData>,
    ): Promise<PerformanceRead<TData>> {
        return this.service.run(target.profileId, target.databaseName || undefined, operation);
    }

    /** A windowed read, or the failure of a window that is not valid. */
    protected async readWindow(
        input: QueryStoreToolWindowParams,
        read: (window: TimeWindow) => Promise<string>,
    ): Promise<string> {
        const window = resolveToolWindow(input);
        return window ? read(window) : failureJson(loc.invalidTimeWindow);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<T>,
        _token: vscode.CancellationToken,
    ) {
        const target = await resolveQueryStoreTarget(options.input, this.connectionManager);
        return {
            invocationMessage:
                "message" in target
                    ? loc.readInvocation(
                          options.input.database ?? "",
                          LocConstants.MssqlChatAgent.unknownConnection,
                      )
                    : loc.readInvocation(databaseLabel(target), target.displayName),
        };
    }
}

export type QueryStoreStatusToolParams = QueryStoreToolTargetParams;

/** Reads whether Query Store is on, why it is read-only, and how far back its data goes. */
export class QueryStoreStatusTool extends QueryStoreReadTool<QueryStoreStatusToolParams> {
    public readonly toolName = Constants.copilotQueryStoreStatusToolName;

    protected async read(target: ResolvedTarget): Promise<string> {
        const read = await this.run(target, async (reader, capabilities) => {
            const overview = await getQueryStoreOverview(reader, capabilities);
            return {
                ...overview,
                data: overview.data && {
                    ...overview.data,
                    recordedMetrics: capabilities.metrics,
                    recordsWaitStats: capabilities.hasWaitStatsCapture,
                },
            };
        });
        return readResultJson(read, (data) => ({
            ...data,
            profileId: target.profileId,
            database: target.databaseName,
        }));
    }
}

export interface TopQueriesToolParams
    extends QueryStoreToolTargetParams,
        QueryStoreToolWindowParams {
    rankBy: QueryStoreRanking;
    statistic?: QueryStoreStatistic;
    top?: number;
}

/** Reads the queries with the highest statistic of a metric in a window. */
export class TopQueriesTool extends QueryStoreReadTool<TopQueriesToolParams> {
    public readonly toolName = Constants.copilotQueryStoreTopQueriesToolName;

    protected read(target: ResolvedTarget, input: TopQueriesToolParams): Promise<string> {
        return this.readWindow(input, async (window) => {
            const top = Math.min(maxTop, Math.max(1, Math.floor(input.top ?? defaultTop)));
            const read = await this.run(target, (reader, capabilities) =>
                getTopQueries(reader, capabilities, {
                    ...window,
                    rankBy: input.rankBy,
                    statistic: input.statistic,
                    top,
                    metrics: queryStoreMetrics,
                }),
            );
            return readResultJson(read, (data) => ({
                ...windowJson(window),
                queries: data.queries.map((query) => compactQuery(query, listQueryTextLength)),
                workload: compactStats(data.workload),
            }));
        });
    }
}

export interface QueryToolParams extends QueryStoreToolTargetParams, QueryStoreToolWindowParams {
    queryId: string;
}

/** Reads one query: its text, module, stats, and every plan with its stats in a window. */
export class QueryDetailsTool extends QueryStoreReadTool<QueryToolParams> {
    public readonly toolName = Constants.copilotQueryStoreQueryDetailsToolName;

    protected read(target: ResolvedTarget, input: QueryToolParams): Promise<string> {
        return this.readWindow(input, async (window) => {
            const request = { ...window, queryId: input.queryId, metrics: queryStoreMetrics };
            const read = await this.run(target, async (reader, capabilities) => {
                const details = await getQueryDetails(reader, capabilities, request);
                if (!details.data) {
                    return { ...details, data: undefined };
                }
                const plans = await getQueryPlans(reader, capabilities, request);
                return { ...details, data: { details: details.data, plans: plans.data ?? [] } };
            });
            return readResultJson(read, ({ details, plans }) => ({
                ...windowJson(window),
                query: {
                    ...compactQuery(details, detailQueryTextLength),
                    totalPlanCount: details.totalPlanCount,
                    forcedPlanId: details.forcedPlanId,
                },
                plans: plans.map(compactPlan),
            }));
        });
    }
}

/** Reads the stats of one query over a window, in at most 48 time buckets, with each plan's. */
export class QueryHistoryTool extends QueryStoreReadTool<QueryToolParams> {
    public readonly toolName = Constants.copilotQueryStoreQueryHistoryToolName;

    protected read(target: ResolvedTarget, input: QueryToolParams): Promise<string> {
        return this.readWindow(input, async (window) => {
            const read = await this.run(target, (reader, capabilities) =>
                getQueryHistory(reader, capabilities, {
                    ...window,
                    queryId: input.queryId,
                    metrics: queryStoreMetrics,
                    bucketMinutes: historyBucketMinutes(window, maxHistoryRows),
                }),
            );
            return readResultJson(read, (intervals) => ({
                ...windowJson(window),
                buckets: intervals.map(compactInterval),
            }));
        });
    }
}

export interface WaitStatsToolParams
    extends QueryStoreToolTargetParams,
        QueryStoreToolWindowParams {
    queryId?: string;
    planId?: string;
}

/** Reads the wait time by category of the database, one query, or one plan, in a window. */
export class WaitStatsTool extends QueryStoreReadTool<WaitStatsToolParams> {
    public readonly toolName = Constants.copilotQueryStoreWaitStatsToolName;

    protected read(target: ResolvedTarget, input: WaitStatsToolParams): Promise<string> {
        return this.readWindow(input, async (window) => {
            const read = await this.run(target, (reader, capabilities) =>
                getWaitStats(reader, capabilities, {
                    ...window,
                    queryId: input.queryId,
                    planId: input.planId,
                }),
            );
            return readResultJson(read, (waits) => ({
                ...windowJson(window),
                ...compactWaits(waits),
            }));
        });
    }
}

export interface PlanSummaryToolParams extends QueryStoreToolTargetParams {
    planId: string;
}

/** Summarizes a Query Store plan: statement facts, warnings, missing indexes, and costly operators. */
export class PlanSummaryTool extends QueryStoreReadTool<PlanSummaryToolParams> {
    public readonly toolName = Constants.copilotQueryStorePlanSummaryToolName;

    protected async read(target: ResolvedTarget, input: PlanSummaryToolParams): Promise<string> {
        const read = await this.run(target, (reader, capabilities) =>
            getPlanXml(reader, capabilities, input.planId),
        );
        return readResultJson(read, (planXml) => {
            const summary = summarizePlan(planXml);
            return summary
                ? { planId: input.planId, ...compactPlanSummary(summary) }
                : { planId: input.planId, notAShowplan: true };
        });
    }
}

export interface AnalyzeQueryToolParams extends QueryToolParams {
    planIds?: string[];
}

/**
 * Reads everything that explains one query in one call: the query, its plans, its history and
 * waits over time, and summaries of its main plans.
 */
export class AnalyzeQueryTool extends QueryStoreReadTool<AnalyzeQueryToolParams> {
    public readonly toolName = Constants.copilotQueryStoreAnalyzeQueryToolName;

    protected read(target: ResolvedTarget, input: AnalyzeQueryToolParams): Promise<string> {
        return this.readWindow(input, async (window) => {
            const read = await this.run(target, (reader, capabilities) =>
                buildQueryAnalysis(reader, capabilities, {
                    ...window,
                    queryId: input.queryId,
                    planIds: input.planIds,
                }),
            );
            return readResultJson(read, compactAnalysis);
        });
    }
}

export interface VerifyForcedPlanToolParams extends QueryStoreToolTargetParams {
    queryId: string;
    planId: string;
    sinceUtc: string;
}

/** Checks whether the executions after a plan was forced used the forced plan. */
export class VerifyForcedPlanTool extends QueryStoreReadTool<VerifyForcedPlanToolParams> {
    public readonly toolName = Constants.copilotQueryStoreVerifyForcedPlanToolName;

    protected async read(
        target: ResolvedTarget,
        input: VerifyForcedPlanToolParams,
    ): Promise<string> {
        const read = await this.run(target, (reader, capabilities) =>
            verifyForcedPlan(reader, capabilities, {
                queryId: input.queryId,
                planId: input.planId,
                sinceUtc: input.sinceUtc,
            }),
        );
        return readResultJson(read, (data) => data);
    }
}

export interface PlanForcingToolParams extends QueryStoreToolTargetParams {
    action: "force" | "unforce";
    queryId: string;
    planId: string;
}

type PreparedOutcome = { readonly prepared: PreparedPlanChange } | { readonly result: string };

/**
 * Forces or unforces a plan. The review reads the plan's state and builds the exact T-SQL, which
 * the confirmation shows. The call runs only that reviewed change: sql-core reads the state again
 * and refuses the change when it or its SQL differ.
 */
export class PlanForcingTool extends ToolBase<PlanForcingToolParams> {
    public readonly toolName = Constants.copilotQueryStorePlanForcingToolName;
    /** The reviewed changes by call, until the call runs them. */
    private readonly _reviewed = new Map<string, PreparedOutcome>();

    constructor(
        private readonly _connectionManager: ConnectionManager,
        private readonly _service: QueryStoreService,
    ) {
        super();
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<PlanForcingToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const input = options.input;
        const kind: PlanChangeKind = input.action === "unforce" ? "unforcePlan" : "forcePlan";
        const invocationMessage =
            kind === "forcePlan"
                ? loc.forcePlanInvocation(input.planId, input.queryId)
                : loc.unforcePlanInvocation(input.planId, input.queryId);
        const target = await resolveQueryStoreTarget(input, this._connectionManager);
        if ("message" in target) {
            this.remember(input, { result: failureJson(target.message) });
            return { invocationMessage };
        }
        const read = await this._service.run(
            target.profileId,
            target.databaseName || undefined,
            (reader, capabilities) =>
                preparePlanChange(reader, capabilities, {
                    kind,
                    queryId: input.queryId,
                    planId: input.planId,
                }),
        );
        if (isPerformanceUnavailable(read) || !read.data || read.data.blockers.length > 0) {
            // Nothing can run, so there is nothing to confirm: the call returns why.
            this.remember(input, {
                result: readResultJson(read, (prepared) => ({
                    applied: false,
                    blockers: prepared.blockers,
                    warnings: prepared.warnings,
                })),
            });
            return { invocationMessage };
        }
        const prepared = read.data;
        this.remember(input, { prepared });
        const confirm =
            kind === "forcePlan" ? loc.forcePlanConfirmation : loc.unforcePlanConfirmation;
        const message = new vscode.MarkdownString();
        message.appendText(
            confirm(input.planId, input.queryId, databaseLabel(target), target.displayName),
        );
        message.appendCodeblock(prepared.sql, "sql");
        if (prepared.warnings.length > 0) {
            message.appendText(`${loc.planChangeWarnings}\n`);
            message.appendMarkdown(
                prepared.warnings.map((warning) => `- ${warningText(warning)}`).join("\n"),
            );
        }
        return {
            invocationMessage,
            confirmationMessages: {
                title: `${Constants.extensionName}: ${
                    kind === "forcePlan" ? loc.forcePlanTitle : loc.unforcePlanTitle
                }`,
                message,
            },
        };
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<PlanForcingToolParams>,
        _token: vscode.CancellationToken,
    ): Promise<string> {
        const key = reviewKey(options.input);
        const reviewed = this._reviewed.get(key);
        this._reviewed.delete(key);
        if (!reviewed) {
            return failureJson(loc.planChangeNotReviewed);
        }
        if ("result" in reviewed) {
            return reviewed.result;
        }
        const target = await resolveQueryStoreTarget(options.input, this._connectionManager);
        if ("message" in target) {
            return failureJson(target.message);
        }
        const read = await this._service.run(
            target.profileId,
            target.databaseName || undefined,
            (reader, capabilities) => applyPlanChange(reader, capabilities, reviewed.prepared),
            "change",
        );
        return readResultJson(read, (applied) => ({
            ...applied,
            warnings: reviewed.prepared.warnings,
        }));
    }

    private remember(input: PlanForcingToolParams, outcome: PreparedOutcome): void {
        this._reviewed.set(reviewKey(input), outcome);
        while (this._reviewed.size > maxPreparedChanges) {
            this._reviewed.delete(this._reviewed.keys().next().value as string);
        }
    }
}

function reviewKey(input: PlanForcingToolParams): string {
    return JSON.stringify([
        input.connectionId ?? "",
        input.profileId ?? "",
        input.database ?? "",
        input.action,
        input.queryId,
        input.planId,
    ]);
}

function warningText(warning: PlanChangeWarning): string {
    switch (warning) {
        case "replacesForcedPlan":
            return loc.warningReplacesForcedPlan;
        case "planForcingTypeUnknown":
            return loc.warningPlanForcingTypeUnknown;
        case "variantPlan":
            return loc.warningVariantPlan;
        case "dispatcherPlan":
            return loc.warningDispatcherPlan;
        default:
            return loc.warningPreviousForceFailures;
    }
}

export interface OpenPerformanceDashboardToolParams extends QueryStoreToolTargetParams {
    queryId?: string;
    tab?: "history" | "waits" | "plans" | "compare";
}

/** Opens the performance dashboard of a database, at a query when one is given. */
export class OpenPerformanceDashboardTool extends ToolBase<OpenPerformanceDashboardToolParams> {
    public readonly toolName = Constants.copilotOpenPerformanceDashboardToolName;

    constructor(
        private readonly _connectionManager: ConnectionManager,
        private readonly _open: (target: PerformanceDashboardTarget, location: string) => void,
    ) {
        super();
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<OpenPerformanceDashboardToolParams>,
        _token: vscode.CancellationToken,
    ): Promise<string> {
        const target = await resolveQueryStoreTarget(options.input, this._connectionManager);
        if ("message" in target) {
            return failureJson(target.message);
        }
        const location = dashboardLocation(options.input);
        this._open(
            {
                profileId: target.profileId,
                serverName: target.serverName,
                databaseName: target.databaseName,
            },
            location,
        );
        return JSON.stringify({ success: true, location });
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<OpenPerformanceDashboardToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const target = await resolveQueryStoreTarget(options.input, this._connectionManager);
        return {
            invocationMessage:
                "message" in target
                    ? loc.openDashboardInvocation(
                          options.input.database ?? "",
                          LocConstants.MssqlChatAgent.unknownConnection,
                      )
                    : loc.openDashboardInvocation(databaseLabel(target), target.displayName),
        };
    }
}

/** The dashboard location of a query and tab, or of the queries list. */
export function dashboardLocation(input: OpenPerformanceDashboardToolParams): string {
    const queryId = input.queryId?.trim();
    // Digits only: the location is built from the ID, so it must not hold "/", "?", or "&".
    if (!queryId || !/^\d+$/.test(queryId)) {
        return "queries";
    }
    const tab = input.tab && input.tab !== "history" ? `?tab=${input.tab}` : "";
    return `queries/${queryId}${tab}`;
}
