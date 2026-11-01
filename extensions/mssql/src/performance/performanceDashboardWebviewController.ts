/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { listDatabases } from "sql-core";
import {
    applyPlanChange,
    applyQueryStoreSettingsChange,
    getPlanXml,
    getQueryDetails,
    getQueryHistory,
    getQueryPlans,
    getQueryStoreOverview,
    getTopQueries,
    getWaitStats,
    preparePlanChange,
    prepareQueryStoreSettingsChange,
    readQueryStoreSettings,
    verifyForcedPlan,
} from "sql-core/queryStore";
import * as LocConstants from "../constants/locConstants";
import { WebviewNavigation } from "../controllers/webviewNavigation";
import { WebviewPanelController } from "../controllers/webviewPanelController";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import {
    ApplyPlanChangeRequest,
    ApplyQueryStoreSettingsChangeRequest,
    ComparePlansRequest,
    ContinueInChatRequest,
    CopyTextRequest,
    DismissDatabaseHubBannerRequest,
    GetFavoriteQueriesRequest,
    GetQueryDetailsRequest,
    GetQueryHistoryRequest,
    GetQueryPlansRequest,
    GetQueryStoreOverviewRequest,
    GetQueryStoreSettingsRequest,
    GetQueryWaitStatsRequest,
    GetTopQueriesRequest,
    ListDatabasesRequest,
    ListDatabasesResult,
    OpenInDatabaseHubRequest,
    OpenPlanRequest,
    OpenSqlScriptRequest,
    PerformanceDashboardReducers,
    PerformanceDashboardState,
    PerformanceRead,
    PreparePlanChangeRequest,
    PrepareQueryStoreSettingsChangeRequest,
    RefreshDashboardNotification,
    QueryWindowParams,
    SetFavoriteQueryRequest,
    SetQueryCategoryRequest,
    SwitchDatabaseRequest,
    TimeWindowParams,
    VerifyForcedPlanRequest,
    isPerformanceUnavailable,
    type ChatPrompt,
    type QueryCategory,
} from "../sharedInterfaces/performanceDashboard";
import { QueryStoreOperation, QueryStoreService } from "./queryStoreService";
import { DatabaseHubSource, getDatabaseHubService } from "../databaseHub/databaseHubService";
import { RequestType } from "vscode-jsonrpc/node";
import { TelemetryActions } from "../sharedInterfaces/telemetry";
import {
    PerformanceDashboardSource,
    PerformanceDashboardTelemetry,
    codeList,
    readOutcomeOf,
} from "./performanceDashboardTelemetry";

/** The database that a dashboard shows. */
export interface PerformanceDashboardTarget {
    /** The saved connection profile. Its ID is the connection's identity. */
    readonly profileId: string;
    readonly serverName: string;
    /** Empty for the login's default database. */
    readonly databaseName: string;
}

/** What a dashboard needs from the code that opens it. */
export interface PerformanceDashboardHost {
    readonly queryStoreService: QueryStoreService;
    /** Opens Copilot Chat in agent mode and sends a prompt. */
    openChat(prompt: string): Promise<void>;
    /**
     * Shows another database of the same server in the dashboard, or reveals the open dashboard
     * of that database. Returns true when the dashboard now shows the database.
     */
    switchDatabase(dashboard: PerformanceDashboardWebviewController, database: string): boolean;
    /** Opens showplan XML in the execution plan viewer. */
    openPlanXml(planXml: string, name: string): void;
    /** Opens two showplans in the execution plan comparison. */
    compareExecutionPlans(
        first: { readonly name: string; readonly planXml: string },
        second: { readonly name: string; readonly planXml: string },
    ): Promise<void>;
    /** Opens T-SQL in a query editor connected to the dashboard's server and database. */
    openSqlScript(sql: string, target: PerformanceDashboardTarget): Promise<void>;
    /** Whether the user dismissed the Database Hub banner for a connection in this session. */
    isDatabaseHubBannerDismissed(profileId: string): boolean;
    /** Hides the Database Hub banner of a connection's dashboards until the next restart. */
    dismissDatabaseHubBanner(profileId: string): void;
}

/**
 * Returns the saved profile and database of an Object Explorer node, or undefined when the node
 * has no saved profile.
 */
export function performanceDashboardTargetForNode(
    node: TreeNodeInfo | undefined,
): PerformanceDashboardTarget | undefined {
    const profile = node?.connectionProfile;
    if (!profile?.id) {
        return undefined;
    }
    const nodeDatabase = ObjectExplorerUtils.getDatabaseName(node);
    const databaseName =
        nodeDatabase && nodeDatabase !== LocConstants.defaultDatabaseLabel
            ? nodeDatabase
            : profile.database;
    return {
        profileId: profile.id,
        serverName: profile.server,
        databaseName: databaseName ?? "",
    };
}

/** The Query Store performance dashboard of one database. */
export class PerformanceDashboardWebviewController extends WebviewPanelController<
    PerformanceDashboardState,
    PerformanceDashboardReducers
> {
    private readonly _navigation: WebviewNavigation;
    private readonly _telemetry: PerformanceDashboardTelemetry;
    private _target: PerformanceDashboardTarget;

    /**
     * @param initialLocation The dashboard location to open at, for example `queries/913`. The
     * default is the queries page.
     */
    constructor(
        context: vscode.ExtensionContext,
        private readonly _host: PerformanceDashboardHost,
        target: PerformanceDashboardTarget,
        initialLocation?: string,
    ) {
        super(
            context,
            "performanceDashboard",
            "performanceDashboard",
            stateFor(target, savedQueryCategory(context)),
            {
                title: titleFor(target),
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "performanceDashboard_light.svg",
                    ),
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "performanceDashboard_dark.svg",
                    ),
                },
            },
        );
        this._target = target;
        this._telemetry = new PerformanceDashboardTelemetry(target.profileId);
        this._navigation = new WebviewNavigation(this, initialLocation);
        this._navigation.onDidChangeLocation((location) => this._telemetry.navigated(location));
        this.onDisposed(() => this._telemetry.closed());
        this.registerHandlers();
        void this.updateDatabaseHubBanner();
    }

    /** Records that the dashboard opened, or that an open one was shown again. */
    public reportOpened(source: PerformanceDashboardSource, reused: boolean): void {
        this._telemetry.opened(source, this.location, reused);
    }

    public get target(): PerformanceDashboardTarget {
        return this._target;
    }

    /** The current dashboard location. */
    public get location(): string {
        return this._navigation.location;
    }

    /** Shows a dashboard location. */
    public navigate(location: string): void {
        this._navigation.navigate(location);
    }

    /** Shows another database in this panel. The host keeps one panel for each database. */
    public setTarget(target: PerformanceDashboardTarget): void {
        this._target = target;
        this.panel.title = titleFor(target);
        this.state = stateFor(target, this.state.queryCategory);
        void this.updateDatabaseHubBanner();
    }

    private registerHandlers(): void {
        const telemetry = this._telemetry;
        this.onRequest(ListDatabasesRequest.type, () => this.listDatabases());
        this.onRequest(SwitchDatabaseRequest.type, ({ database }) => {
            const switched = this._host.switchDatabase(this, database);
            telemetry.action(TelemetryActions.SwitchDatabase, { switched: String(switched) });
            return { switched };
        });
        this.onRead(GetQueryStoreOverviewRequest.type, () =>
            this.run((reader, capabilities) => getQueryStoreOverview(reader, capabilities)),
        );
        this.onRead(GetTopQueriesRequest.type, ({ rankBy, statistic, top, ...window }) =>
            this.run((reader, capabilities) =>
                getTopQueries(reader, capabilities, {
                    ...toWindow(window),
                    rankBy,
                    statistic,
                    top,
                }),
            ),
        );
        this.onRead(GetQueryDetailsRequest.type, (params) =>
            this.run((reader, capabilities) =>
                getQueryDetails(reader, capabilities, toQueryWindow(params)),
            ),
        );
        this.onRead(GetQueryHistoryRequest.type, (params) =>
            this.run((reader, capabilities) =>
                getQueryHistory(reader, capabilities, {
                    ...toQueryWindow(params),
                    bucketMinutes: params.bucketMinutes,
                }),
            ),
        );
        this.onRead(
            GetQueryWaitStatsRequest.type,
            ({ queryId, planId, bucketMinutes, ...window }) =>
                this.run((reader, capabilities) =>
                    getWaitStats(reader, capabilities, {
                        ...toWindow(window),
                        queryId,
                        planId,
                        bucketMinutes,
                    }),
                ),
        );
        this.onRequest(ContinueInChatRequest.type, ({ prompt, queryId, startUtc, endUtc }) => {
            telemetry.action(TelemetryActions.ContinueInChat, { prompt });
            return this._host.openChat(
                continueInChatPrompt(prompt, this._target, queryId, startUtc, endUtc),
            );
        });
        this.onRead(GetQueryPlansRequest.type, (params) =>
            this.run((reader, capabilities) =>
                getQueryPlans(reader, capabilities, toQueryWindow(params)),
            ),
        );
        this.onRequest(OpenPlanRequest.type, async ({ queryId, planId }) => {
            const planXml = await this.readPlanXml(planId);
            if (planXml) {
                this._host.openPlanXml(
                    planXml,
                    LocConstants.PerformanceDashboard.planTitle(queryId, planId),
                );
            }
            telemetry.action(TelemetryActions.OpenPlan, { opened: String(!!planXml) });
            return { opened: !!planXml };
        });
        this.onRequest(ComparePlansRequest.type, async ({ queryId, planIds }) => {
            const [first, second] = await Promise.all(planIds.map((id) => this.readPlanXml(id)));
            const opened = !!first && !!second;
            telemetry.action(
                TelemetryActions.ComparePlans,
                { opened: String(opened) },
                { planCount: planIds.length },
            );
            if (!opened) {
                return { opened: false };
            }
            const text = LocConstants.PerformanceDashboard;
            await this._host.compareExecutionPlans(
                { name: text.planTitle(queryId, planIds[0]), planXml: first },
                { name: text.planTitle(queryId, planIds[1]), planXml: second },
            );
            return { opened: true };
        });
        this.onRequest(PreparePlanChangeRequest.type, async (target) => {
            const result = await this.run((reader, capabilities) =>
                preparePlanChange(reader, capabilities, target),
            );
            const prepared = dataOf(result);
            telemetry.action(TelemetryActions.PreparePlanChange, {
                kind: target.kind,
                ...readOutcomeOf(result),
                blockers: codeList(prepared?.blockers),
                warnings: codeList(prepared?.warnings),
            });
            return result;
        });
        // sql-core reads the plan state again, rebuilds the SQL from the target, and refuses a
        // prepared change whose SQL or state differ, so the webview cannot run other SQL.
        this.onRequest(ApplyPlanChangeRequest.type, async (prepared) => {
            const result = await this.run(
                (reader, capabilities) => applyPlanChange(reader, capabilities, prepared),
                "change",
            );
            const applied = dataOf(result);
            telemetry.action(TelemetryActions.ApplyPlanChange, {
                kind: prepared.target.kind,
                ...readOutcomeOf(result),
                applied: String(!!applied?.applied),
                blockers: codeList(applied?.blockers),
            });
            return result;
        });
        this.onRequest(VerifyForcedPlanRequest.type, async (request) => {
            const result = await this.run((reader, capabilities) =>
                verifyForcedPlan(reader, capabilities, request),
            );
            telemetry.action(TelemetryActions.VerifyForcedPlan, {
                ...readOutcomeOf(result),
                verification: dataOf(result)?.outcome ?? "",
            });
            return result;
        });
        this.onRead(GetQueryStoreSettingsRequest.type, () =>
            this.run((reader, capabilities) => readQueryStoreSettings(reader, capabilities)),
        );
        this.onRequest(PrepareQueryStoreSettingsChangeRequest.type, async (change) => {
            const result = await this.run((reader, capabilities) =>
                prepareQueryStoreSettingsChange(reader, capabilities, change),
            );
            const prepared = dataOf(result);
            telemetry.action(TelemetryActions.PrepareQueryStoreSettingsChange, {
                changed: codeList(Object.keys(change)),
                operationMode: change.operationMode ?? "",
                ...readOutcomeOf(result),
                blockers: codeList(prepared?.blockers),
                warnings: codeList(prepared?.warnings),
            });
            return result;
        });
        // sql-core reads the settings again, rebuilds the SQL from the change, and refuses a
        // prepared change whose SQL or settings differ, so the webview cannot run other SQL.
        this.onRequest(ApplyQueryStoreSettingsChangeRequest.type, async (prepared) => {
            const result = await this.run(
                (reader, capabilities) =>
                    applyQueryStoreSettingsChange(reader, capabilities, prepared),
                "change",
            );
            const applied = dataOf(result);
            telemetry.action(TelemetryActions.ApplyQueryStoreSettingsChange, {
                changed: codeList(Object.keys(prepared.change)),
                operationMode: prepared.change.operationMode ?? "",
                ...readOutcomeOf(result),
                applied: String(!!applied?.applied),
                blockers: codeList(applied?.blockers),
            });
            return result;
        });
        this.onRequest(OpenSqlScriptRequest.type, ({ sql }) => {
            telemetry.action(TelemetryActions.OpenSqlScript);
            return this._host.openSqlScript(sql, this._target);
        });
        this.onRequest(CopyTextRequest.type, async ({ text }) => {
            telemetry.action(TelemetryActions.CopyText);
            await vscode.env.clipboard.writeText(text);
        });
        this.onRequest(GetFavoriteQueriesRequest.type, () => ({
            queryIds: this.favoriteQueries(),
        }));
        this.onRequest(SetFavoriteQueryRequest.type, async ({ queryId, favorite }) => {
            const result = await this.setFavoriteQuery(queryId, favorite);
            telemetry.action(
                TelemetryActions.SetFavoriteQuery,
                { favorite: String(favorite) },
                { favorites: result.queryIds.length },
            );
            return result;
        });
        this.onNotification(RefreshDashboardNotification.type, () =>
            telemetry.action(TelemetryActions.Refresh),
        );
        this.onRequest(SetQueryCategoryRequest.type, async ({ category }) => {
            // The state keeps it for a webview that loads again; global state, for the next one.
            this.state = { ...this.state, queryCategory: category };
            await this._context.globalState.update(queryCategoryKey, category);
        });
        this.onRequest(OpenInDatabaseHubRequest.type, () => {
            telemetry.action(TelemetryActions.OpenInDatabaseHub);
            return getDatabaseHubService()?.openProfile(
                this._target.profileId,
                this._target.databaseName,
                DatabaseHubSource.PerformanceDashboard,
            );
        });
        this.onRequest(DismissDatabaseHubBannerRequest.type, () => {
            telemetry.action(TelemetryActions.DismissDatabaseHubBanner);
            this._host.dismissDatabaseHubBanner(this._target.profileId);
            this.hideDatabaseHubBanner();
        });
    }

    /** Handles a read request, and records its outcome. */
    private onRead<TParams, TResult>(
        type: RequestType<TParams, PerformanceRead<TResult>, void>,
        read: (params: TParams) => Promise<PerformanceRead<TResult>>,
    ): void {
        this.onRequest(type, async (params) => {
            const database = this._target.databaseName;
            const result = await read(params);
            this._telemetry.read(type.method, database, result);
            return result;
        });
    }

    /** Hides the Database Hub banner, which the user dismissed for the connection. */
    public hideDatabaseHubBanner(): void {
        if (this.state.showDatabaseHubBanner) {
            this.state = { ...this.state, showDatabaseHubBanner: false };
        }
    }

    /**
     * Shows the Database Hub banner when the database has, or may have, a Hub row, unless the
     * user dismissed it for the connection since the last restart.
     */
    private async updateDatabaseHubBanner(): Promise<void> {
        const target = this._target;
        let show = false;
        if (!this._host.isDatabaseHubBannerDismissed(target.profileId)) {
            try {
                const eligibility = await getDatabaseHubService()?.eligibilityForProfile(
                    target.profileId,
                    target.databaseName,
                );
                show = eligibility === "yes" || eligibility === "maybe";
            } catch {
                show = false;
            }
        }
        if (
            this._target === target &&
            !this.isDisposed &&
            show !== !!this.state.showDatabaseHubBanner
        ) {
            this.state = { ...this.state, showDatabaseHubBanner: show };
            if (show) {
                this._telemetry.bannerShown();
            }
        }
    }

    /** Runs an operation on the dashboard's database. */
    private run<T>(
        operation: QueryStoreOperation<T>,
        purpose: "read" | "change" = "read",
        database: string = this._target.databaseName,
    ): Promise<PerformanceRead<T>> {
        return this._host.queryStoreService.run(
            this._target.profileId,
            database || undefined,
            (reader, capabilities) => {
                this._telemetry.setPlatform(capabilities.platform);
                return operation(reader, capabilities);
            },
            purpose,
        );
    }

    private async readPlanXml(planId: string): Promise<string | undefined> {
        const read = await this.run((reader, capabilities) =>
            getPlanXml(reader, capabilities, planId),
        );
        return isPerformanceUnavailable(read) ? undefined : read.data;
    }

    /**
     * Lists the databases of the server. In Azure SQL Database, a user database sees only itself
     * and `master`, so the list comes from `master` when the login can open it.
     */
    private async listDatabases(): Promise<ListDatabasesResult> {
        const read = (database: string) =>
            this.run(
                async (reader, capabilities) => ({
                    status: "ready",
                    data: {
                        platform: capabilities.platform.platform,
                        databases: await listDatabases(reader, capabilities.platform),
                    },
                }),
                "read",
                database,
            );
        const fromTarget = await read(this._target.databaseName);
        if (
            !isPerformanceUnavailable(fromTarget) &&
            fromTarget.data?.platform === "azureSqlDatabase" &&
            this._target.databaseName.toLowerCase() !== "master"
        ) {
            const fromMaster = await read("master");
            if (!isPerformanceUnavailable(fromMaster) && fromMaster.data) {
                return { databases: fromMaster.data.databases };
            }
        }
        if (isPerformanceUnavailable(fromTarget)) {
            return { databases: [], errorMessage: fromTarget.detail ?? fromTarget.reason };
        }
        return fromTarget.data
            ? { databases: fromTarget.data.databases }
            : { databases: [], errorMessage: fromTarget.error?.message ?? fromTarget.status };
    }

    /** The favorite queries of the dashboard's connection and database. */
    private favoriteQueries(): string[] {
        const all = this._context.globalState.get<Record<string, string[]>>(favoritesKey) ?? {};
        return all[dashboardKey(this._target)] ?? [];
    }

    private async setFavoriteQuery(queryId: string, favorite: boolean) {
        const all = this._context.globalState.get<Record<string, string[]>>(favoritesKey) ?? {};
        const key = dashboardKey(this._target);
        const current = new Set(all[key] ?? []);
        if (favorite) {
            current.add(queryId);
        } else {
            current.delete(queryId);
        }
        const queryIds = [...current];
        await this._context.globalState.update(favoritesKey, { ...all, [key]: queryIds });
        return { queryIds };
    }
}

/** The profile ID and the database identify a dashboard. */
export function dashboardKey(target: PerformanceDashboardTarget): string {
    return JSON.stringify([target.profileId, target.databaseName]);
}

function stateFor(
    target: PerformanceDashboardTarget,
    queryCategory: QueryCategory | undefined,
): PerformanceDashboardState {
    return {
        serverName: target.serverName,
        databaseName: target.databaseName,
        queryCategory,
    };
}

/** The category of the Queries page that the user chose last, in any dashboard. */
function savedQueryCategory(context: vscode.ExtensionContext): QueryCategory | undefined {
    return context.globalState.get<QueryCategory>(queryCategoryKey);
}

function titleFor(target: PerformanceDashboardTarget): string {
    return LocConstants.PerformanceDashboard.title(target.databaseName || target.serverName);
}

/** The data of a read, or undefined when the read did not return any. */
function dataOf<T>(result: PerformanceRead<T>): T | undefined {
    return isPerformanceUnavailable(result) ? undefined : result.data;
}

/** A time window from the webview. An invalid date makes the read fail with a range error. */
function toWindow(window: TimeWindowParams): { start: Date; end: Date } {
    return { start: new Date(window.startUtc), end: new Date(window.endUtc) };
}

/**
 * The chat prompt of a query, to analyze its performance or explain it. It names the saved
 * profile, database, and window, so the chat reads them with the Query Store tools and does not
 * need to find them.
 */
export function continueInChatPrompt(
    prompt: ChatPrompt,
    target: PerformanceDashboardTarget,
    queryId: string,
    startUtc: string,
    endUtc: string,
): string {
    const database = target.databaseName || LocConstants.defaultDatabaseLabel;
    const query =
        `Query Store query ${queryId} in database "${database}" on server "${target.serverName}" ` +
        `(saved connection profileId "${target.profileId}") from ${startUtc} to ${endUtc} UTC. ` +
        `Read it with #mssql_query_store_analyze_query using that profileId and database.`;
    return prompt === "explain"
        ? `Explain ${query}\n\n` +
              `In plain language:\n` +
              `1. What the query does: the tables it reads or changes, its joins and filters, and ` +
              `the procedure or function it belongs to, if any.\n` +
              `2. How its main plan runs it: the steps in order, and which operators cost the ` +
              `most.\n` +
              `3. What its numbers mean: how often it runs, how long a run takes, and how much ` +
              `that varies.\n` +
              `Keep it short, and don't suggest changes unless something stands out.`
        : `Analyze the performance of ${query}\n\n` +
              `1. Say whether the query is a problem: how much time and CPU it uses, and how ` +
              `that changed over the window.\n` +
              `2. Find the cause: a plan change or regression, waits (CPU, I/O, locks, memory), ` +
              `parameter sensitivity, or expensive operators and warnings in the plan.\n` +
              `3. Recommend fixes, the most effective first, such as an index, a query rewrite, ` +
              `or forcing a plan. Show the T-SQL for each, and don't run anything that changes ` +
              `the database.`;
}

function toQueryWindow({ queryId, metrics, ...window }: QueryWindowParams) {
    return { queryId, metrics, ...toWindow(window) };
}

/** The global state key of the favorite queries, by connection and database. */
const favoritesKey = "mssql.performanceDashboard.favoriteQueries";
/** The global state key of the category of the Queries page that the user chose last. */
const queryCategoryKey = "mssql.performanceDashboard.queryCategory";
