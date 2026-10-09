/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as LocConstants from "../constants/locConstants";
import { WebviewNavigation } from "../controllers/webviewNavigation";
import { WebviewPanelController } from "../controllers/webviewPanelController";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import { isPerformanceToolQuery, summarizePlanShape } from "sql-core/performance";
import {
    PerformanceConnectionReference,
    PerformanceResult,
    PlanShape,
    QueryStoreReport,
    ResourceCpuSample,
    isPerformanceUnavailable,
} from "../sharedInterfaces/performance";
import {
    DatabaseFactsResult,
    GetDatabaseFactsRequest,
    GetMetricTotalsRequest,
    GetQueryStoreAvailabilityRequest,
    GetResourceConsumptionRequest,
    GetTopQueriesRequest,
    ApplyQueryStoreSettingsChangeRequest,
    GetQueryStoreSettingsRequest,
    OpenSqlScriptRequest,
    PrepareQueryStoreSettingsChangeRequest,
    ListDatabasesRequest,
    ListDatabasesResult,
    PerformanceDashboardReducers,
    PerformanceDashboardState,
    PerformanceReadResult,
    QueryStoreAvailability,
    SwitchDatabaseRequest,
    TimeWindowParams,
    ApplyPlanChangeRequest,
    ComparePlansRequest,
    CopyTextRequest,
    GetActiveRequestsRequest,
    GetAutomaticTuningRequest,
    GetFavoriteQueriesRequest,
    GetMetricSeriesRequest,
    GetPlanShapesRequest,
    GetQueryDetailsRequest,
    GetQueryHistoryRequest,
    GetQueryPlansRequest,
    GetResourceCpuRequest,
    GetSessionSummaryRequest,
    GetWaitSeriesRequest,
    OpenPlanRequest,
    PreparePlanChangeRequest,
    SetFavoriteQueryRequest,
    VerifyForcedPlanRequest,
} from "../sharedInterfaces/performanceDashboard";
import { PerformanceService, PerformanceTarget } from "./performanceService";

/** The database that a dashboard shows. */
export interface PerformanceDashboardTarget {
    /** The connection to give the performance service. */
    readonly reference: PerformanceConnectionReference;
    readonly serverName: string;
    /** Empty for the login's default database. */
    readonly databaseName: string;
}

/** What a dashboard needs from the code that opens it. */
export interface PerformanceDashboardHost {
    readonly performanceService: PerformanceService;
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
        reference: databaseName
            ? { profileId: profile.id, database: databaseName }
            : { profileId: profile.id },
        serverName: profile.server,
        databaseName: databaseName ?? "",
    };
}

/** Returns the target for another database of the same server. */
export function performanceDashboardTargetForDatabase(
    target: PerformanceDashboardTarget,
    database: string,
): PerformanceDashboardTarget {
    return {
        ...target,
        reference: { ...target.reference, database },
        databaseName: database,
    };
}

/** The performance dashboard of one database. */
export class PerformanceDashboardWebviewController extends WebviewPanelController<
    PerformanceDashboardState,
    PerformanceDashboardReducers
> {
    private readonly _navigation: WebviewNavigation;
    private _target: PerformanceDashboardTarget;

    /**
     * @param initialLocation The dashboard location to open at, for example `queries/913`. The
     * default is the overview.
     */
    constructor(
        context: vscode.ExtensionContext,
        private readonly _host: PerformanceDashboardHost,
        target: PerformanceDashboardTarget,
        initialLocation?: string,
    ) {
        super(context, "performanceDashboard", "performanceDashboard", stateFor(target), {
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
        });
        this._target = target;
        this._navigation = new WebviewNavigation(this, initialLocation);
        this.onRequest(ListDatabasesRequest.type, () => this.listDatabases());
        this.onRequest(SwitchDatabaseRequest.type, ({ database }) => ({
            switched: this._host.switchDatabase(this, database),
        }));
        this.onRequest(GetDatabaseFactsRequest.type, () => this.databaseFacts());
        this.onRequest(GetQueryStoreAvailabilityRequest.type, () => this.queryStoreAvailability());
        this.onRequest(GetMetricTotalsRequest.type, ({ metric, windows }) =>
            this.read((target) => target.metricTotals({ metric, windows: windows.map(toWindow) })),
        );
        this.onRequest(GetResourceConsumptionRequest.type, (window) =>
            this.read((target) =>
                target.overallConsumption({ specifiedTimeInterval: toWindow(window) }),
            ),
        );
        this.onRequest(GetTopQueriesRequest.type, ({ metric, statistic, top, ...window }) =>
            this.read(async (target) =>
                withoutOwnQueries(
                    await target.topConsumers({
                        selectedMetric: metric,
                        selectedStatistic: statistic ?? "total",
                        timeInterval: toWindow(window),
                        // Room for the dashboard's own reads, which are left out.
                        topQueriesReturned: top + ownQueryMargin,
                    }),
                    top,
                ),
            ),
        );
        this.onRequest(GetMetricSeriesRequest.type, ({ metric, bucketMinutes, ...window }) =>
            this.read((target) =>
                target.metricSeries({ metric, bucketMinutes, ...toWindow(window) }),
            ),
        );
        this.onRequest(
            GetWaitSeriesRequest.type,
            ({ waitCategoryId, bucketMinutes, windows, ...window }) =>
                this.read((target) =>
                    target.waitSeries({
                        waitCategoryId,
                        bucketMinutes,
                        windows: windows?.map(toWindow),
                        ...toWindow(window),
                    }),
                ),
        );
        this.onRequest(GetSessionSummaryRequest.type, () =>
            this.read((target) => target.sessionSummary()),
        );
        this.onRequest(GetActiveRequestsRequest.type, () =>
            this.read((target) => target.activeRequests()),
        );
        this.onRequest(GetAutomaticTuningRequest.type, () =>
            this.read((target) => target.automaticTuning()),
        );
        this.onRequest(GetResourceCpuRequest.type, (window) => this.resourceCpu(window));
        this.onRequest(GetQueryDetailsRequest.type, ({ queryId, ...window }) =>
            this.read((target) => target.queryDetails({ queryId, ...toWindow(window) })),
        );
        this.onRequest(GetQueryHistoryRequest.type, ({ queryId, ...window }) =>
            this.read((target) => target.queryExecutionHistory({ queryId, ...toWindow(window) })),
        );
        this.onRequest(GetQueryPlansRequest.type, ({ queryId, ...window }) =>
            this.read((target) => target.queryPlans({ queryId, ...toWindow(window) })),
        );
        this.onRequest(GetPlanShapesRequest.type, ({ planIds }) => this.planShapes(planIds));
        this.onRequest(OpenPlanRequest.type, async ({ queryId, planId }) => {
            const planXml = await this.readPlanXml(planId);
            if (planXml) {
                this._host.openPlanXml(
                    planXml,
                    LocConstants.PerformanceDashboard.planTitle(queryId, planId),
                );
            }
            return { opened: !!planXml };
        });
        this.onRequest(ComparePlansRequest.type, async ({ queryId, planIds }) => {
            const [first, second] = await Promise.all(planIds.map((id) => this.readPlanXml(id)));
            if (!first || !second) {
                return { opened: false };
            }
            const text = LocConstants.PerformanceDashboard;
            await this._host.compareExecutionPlans(
                { name: text.planTitle(queryId, planIds[0]), planXml: first },
                { name: text.planTitle(queryId, planIds[1]), planXml: second },
            );
            return { opened: true };
        });
        this.onRequest(PreparePlanChangeRequest.type, ({ kind, queryId, planId }) =>
            this.read((target) =>
                kind === "forcePlan"
                    ? target.prepareForcePlan({ queryId, planId })
                    : target.prepareUnforcePlan({ queryId, planId }),
            ),
        );
        // sql-core reads the plan state again and rebuilds the SQL from the target, and refuses
        // a prepared change whose SQL or state differ, so the webview cannot run other SQL.
        this.onRequest(ApplyPlanChangeRequest.type, (prepared) =>
            this.read((target) => target.applyChange(prepared)),
        );
        this.onRequest(VerifyForcedPlanRequest.type, ({ queryId, planId, since }) =>
            this.read((target) => target.verifyForcedPlan({ queryId, planId, since })),
        );
        this.onRequest(CopyTextRequest.type, async ({ text }) => {
            await vscode.env.clipboard.writeText(text);
        });
        this.onRequest(GetFavoriteQueriesRequest.type, () => ({
            queryIds: this.favoriteQueries(),
        }));
        this.onRequest(SetFavoriteQueryRequest.type, ({ queryId, favorite }) =>
            this.setFavoriteQuery(queryId, favorite),
        );
        this.onRequest(GetQueryStoreSettingsRequest.type, () =>
            this.read((target) => target.queryStoreSettings()),
        );
        this.onRequest(PrepareQueryStoreSettingsChangeRequest.type, (change) =>
            this.read((target) => target.prepareQueryStoreSettingsChange(change)),
        );
        // sql-core reads the settings again, rebuilds the SQL from the change, and refuses a
        // prepared change whose SQL or settings differ, so the webview cannot run other SQL.
        this.onRequest(ApplyQueryStoreSettingsChangeRequest.type, (prepared) =>
            this.read((target) => target.applyQueryStoreSettingsChange(prepared)),
        );
        this.onRequest(OpenSqlScriptRequest.type, async ({ sql }) => {
            const document = await vscode.workspace.openTextDocument({
                language: "sql",
                content: sql,
            });
            await vscode.window.showTextDocument(document);
        });
    }

    /** Runs a read on the dashboard's database, or returns why the database cannot be read. */
    private async read<T>(
        run: (target: PerformanceTarget) => Promise<PerformanceResult<T>>,
    ): Promise<PerformanceReadResult<T>> {
        const target = await this._host.performanceService.resolveTarget(this._target.reference);
        return isPerformanceUnavailable(target) ? target : run(target);
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
        this.state = stateFor(target);
    }

    /**
     * The CPU percent of the database from the resource stats: up to 14 days from master, then
     * the last hour from the database, which has finer samples. Azure SQL Database only.
     */
    private async resourceCpu(
        window: TimeWindowParams,
    ): Promise<PerformanceReadResult<ResourceCpuSample[]>> {
        const target = await this._host.performanceService.resolveTarget(this._target.reference);
        if (isPerformanceUnavailable(target)) {
            return target;
        }
        const recent = await target.databaseResourceCpu();
        const { start, end } = toWindow(window);
        const firstRecent = recent.data?.[0]?.startUtc;
        let older: ResourceCpuSample[] = [];
        if (!firstRecent || Date.parse(firstRecent) > start.getTime()) {
            const master = await this._host.performanceService.resolveTarget({
                ...this._target.reference,
                database: "master",
            });
            if (!isPerformanceUnavailable(master)) {
                const read = await master.serverResourceCpu({
                    databaseName: target.database,
                    start,
                    end: firstRecent ? new Date(firstRecent) : end,
                });
                older = read.data ?? [];
            }
        }
        const samples = [...older, ...(recent.data ?? [])].filter(
            (sample) =>
                Date.parse(sample.endUtc) > start.getTime() &&
                Date.parse(sample.startUtc) < end.getTime(),
        );
        if (samples.length === 0 && !recent.data) {
            return recent;
        }
        return {
            ...recent,
            status: samples.length > 0 ? "ready" : "noData",
            data: samples,
        };
    }

    /** Summarizes the showplan XML of each plan. Reads at most 20 plans. */
    private async planShapes(
        planIds: readonly string[],
    ): Promise<{ readonly shapes: Readonly<Record<string, PlanShape>> }> {
        const shapes: Record<string, PlanShape> = {};
        for (const planId of planIds.slice(0, maxPlanShapes)) {
            const planXml = await this.readPlanXml(planId);
            if (planXml) {
                shapes[planId] = summarizePlanShape(planXml);
            }
        }
        return { shapes };
    }

    private async readPlanXml(planId: string): Promise<string | undefined> {
        const read = await this.read((target) => target.planXml({ planId }));
        return "data" in read ? read.data?.queryPlan : undefined;
    }

    /** The favorite queries of the dashboard's connection and database. */
    private favoriteQueries(): string[] {
        const all = this._context.globalState.get<Record<string, string[]>>(favoritesKey) ?? {};
        return all[favoritesKeyFor(this._target)] ?? [];
    }

    private async setFavoriteQuery(queryId: string, favorite: boolean) {
        const all = this._context.globalState.get<Record<string, string[]>>(favoritesKey) ?? {};
        const key = favoritesKeyFor(this._target);
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

    /**
     * Lists the databases of the server. In Azure SQL Database, a user database sees only itself
     * and `master`, so the list comes from `master` when the login can open it.
     */
    private async listDatabases(): Promise<ListDatabasesResult> {
        const reference = this._target.reference;
        const fromTarget = await this.readDatabases(reference);
        if (
            fromTarget.platform === "azureSqlDatabase" &&
            reference.database?.toLowerCase() !== "master"
        ) {
            const fromMaster = await this.readDatabases({ ...reference, database: "master" });
            if (!fromMaster.result.errorMessage) {
                return fromMaster.result;
            }
        }
        return fromTarget.result;
    }

    private async databaseFacts(): Promise<DatabaseFactsResult> {
        const target = await this._host.performanceService.resolveTarget(this._target.reference);
        if (isPerformanceUnavailable(target)) {
            return { errorMessage: target.detail ?? target.reason };
        }
        const read = await target.databaseFacts();
        if (!read.data) {
            return {
                platform: read.platform,
                errorMessage: read.error?.message ?? read.status,
            };
        }
        // The read detected the platform, so this does not read again.
        const info = await target.platform();
        return {
            platform: info.platform,
            ...(info.majorVersion !== undefined ? { majorVersion: info.majorVersion } : {}),
            facts: read.data,
        };
    }

    private async queryStoreAvailability(): Promise<QueryStoreAvailability> {
        const target = await this._host.performanceService.resolveTarget(this._target.reference);
        if (isPerformanceUnavailable(target)) {
            return {};
        }
        const capabilities = (await target.queryStoreCapabilities()).data;
        return capabilities?.operationalStatus !== "off" && capabilities?.oldestIntervalStartUtc
            ? { oldestIntervalStartUtc: capabilities.oldestIntervalStartUtc }
            : {};
    }

    private async readDatabases(
        reference: PerformanceConnectionReference,
    ): Promise<{ result: ListDatabasesResult; platform?: string }> {
        const target = await this._host.performanceService.resolveTarget(reference);
        if (isPerformanceUnavailable(target)) {
            return { result: { databases: [], errorMessage: target.detail ?? target.reason } };
        }
        const read = await target.databases();
        return {
            platform: read.platform,
            result: read.data
                ? { databases: read.data }
                : { databases: [], errorMessage: read.error?.message ?? read.status },
        };
    }
}

function stateFor(target: PerformanceDashboardTarget): PerformanceDashboardState {
    return { serverName: target.serverName, databaseName: target.databaseName };
}

function titleFor(target: PerformanceDashboardTarget): string {
    return LocConstants.PerformanceDashboard.title(target.databaseName || target.serverName);
}

/** A time window from the webview. An invalid date makes the read fail with a range error. */
function toWindow(window: TimeWindowParams): { start: Date; end: Date } {
    return { start: new Date(window.startUtc), end: new Date(window.endUtc) };
}

/** The number of extra top queries to read, to replace the dashboard's own reads. */
const ownQueryMargin = 20;

/** The number of plans whose shape is read. */
const maxPlanShapes = 20;

/** The global state key of the favorite queries, by connection and database. */
const favoritesKey = "mssql.performanceDashboard.favoriteQueries";

function favoritesKeyFor(target: PerformanceDashboardTarget): string {
    const { reference } = target;
    return JSON.stringify([
        reference.profileId ?? reference.ownerUri,
        reference.database ?? target.databaseName,
    ]);
}

/**
 * Leaves the dashboard's own reads out of a top queries report, and keeps the first `top` rows.
 */
function withoutOwnQueries(
    result: PerformanceResult<QueryStoreReport>,
    top: number,
): PerformanceResult<QueryStoreReport> {
    const report = result.data;
    const textColumn = report?.columns.find((column) => column.kind === "queryText");
    if (!report || !textColumn) {
        return result;
    }
    const rows = report.rows
        .filter((row) => !isPerformanceToolQuery(String(row[textColumn.id] ?? "")))
        .slice(0, top);
    return {
        ...result,
        status: rows.length > 0 ? result.status : "noData",
        data: { ...report, rows },
    };
}
