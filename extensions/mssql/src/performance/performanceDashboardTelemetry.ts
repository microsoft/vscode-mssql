/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Telemetry of the performance dashboard, shaped for funnels: Open, then Load (the first Query
 * Store read of each database), then Navigate (pages, tabs, categories, time ranges), then the
 * actions on a query (plans, plan forcing, chat), then Close.
 *
 * Every event carries `dashboardId`, which joins the events of one dashboard panel, the
 * connection and server properties that other features send (`authenticationType`,
 * `connectionType`, `serverVersion`, `serverEdition`, `serverEngineEdition`), and the sql-core
 * `platform` once a read has run. Values are codes only: no query text, query IDs, plan IDs,
 * server names, or times.
 */

import { ServerInfo, sendActionEvent } from "extension-toolkit/vscode";
import type { PlatformInfo } from "sql-core";
import { ConnectionTelemetry, getDatabaseHubService } from "../databaseHub/databaseHubService";
import {
    PerformanceRead,
    isPerformanceUnavailable,
} from "../sharedInterfaces/performanceDashboard";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { uuid } from "../utils/utils";

/** Where a dashboard was opened from. A telemetry value. */
export enum PerformanceDashboardSource {
    ObjectExplorer = "objectExplorer",
    Copilot = "copilot",
    Unknown = "unknown",
}

/** The location values that describe what the user looks at. Others, such as IDs, are left out. */
const pageViewKeys = [
    "tab",
    "category",
    "rank",
    "metric",
    "view",
    "compareView",
    "compareMetric",
] as const;

const codePattern = /^[A-Za-z0-9_-]{1,32}$/;

/** A value that is safe to send: a short code, or `other`. */
function code(value: string | undefined): string {
    if (!value) {
        return "";
    }
    return codePattern.test(value) ? value : "other";
}

/** Codes such as blockers and warnings, sorted and joined, or empty. */
export function codeList(values: readonly string[] | undefined): string {
    return [...new Set((values ?? []).map(code))].sort().join(",");
}

/**
 * The telemetry values of a dashboard location, such as `queries/913?tab=plans&range=7d`: the
 * page (`queries` or `query`), its tab and options, and the time range preset, or `custom`.
 */
export function pageViewOf(location: string): Record<string, string> {
    const [path, query = ""] = location.split("?");
    const segments = path.split("/").filter(Boolean);
    const params = new URLSearchParams(query);
    const page =
        segments.length === 0 || (segments.length === 1 && segments[0] === "queries")
            ? "queries"
            : segments.length === 2 && segments[0] === "queries"
              ? "query"
              : "other";
    const view: Record<string, string> = { page };
    for (const key of pageViewKeys) {
        view[key] = code(params.get(key) ?? undefined);
    }
    view.timeRange =
        params.has("from") || params.has("to") ? "custom" : code(params.get("range") ?? undefined);
    view.settings = code(params.get("settings") ?? undefined);
    return view;
}

/** The status of a read: the sql-core status, or `unavailable` with its reason. */
export function readOutcomeOf(result: PerformanceRead<unknown>): Record<string, string> {
    if (isPerformanceUnavailable(result)) {
        return { status: "unavailable", unavailableReason: result.reason };
    }
    return {
        status: result.status,
        unavailableReason: "",
        errorNumber:
            result.error?.errorNumber !== undefined ? String(result.error.errorNumber) : "",
    };
}

/** The telemetry of one dashboard panel. */
export class PerformanceDashboardTelemetry {
    /** Joins the events of this panel. */
    public readonly dashboardId = uuid();
    private readonly _openedAt = Date.now();
    private _connection: Promise<ConnectionTelemetry>;
    private _platform: PlatformInfo | undefined;
    private _lastPageView: string | undefined;
    private readonly _loadedDatabases = new Set<string>();
    private _bannerShown = false;
    private _closed = false;
    private _pageViews = 0;
    private _queryPageViews = 0;
    private _queryActions = 0;

    constructor(profileId: string) {
        this._connection = PerformanceDashboardTelemetry.connectionOf(profileId);
    }

    /** The dashboard opened, or an open one was shown again. */
    public opened(source: PerformanceDashboardSource, location: string, reused: boolean): void {
        this.send(TelemetryActions.Open, {
            source,
            reused: String(reused),
            ...pageViewOf(location),
        });
    }

    /** The page reported a new location. Repeats of the same view are not sent. */
    public navigated(location: string): void {
        const pageView = pageViewOf(location);
        const key = JSON.stringify(pageView);
        if (key === this._lastPageView) {
            return;
        }
        const previous = this._lastPageView ? JSON.parse(this._lastPageView).page : "";
        this._lastPageView = key;
        this._pageViews++;
        if (pageView.page === "query" && previous !== "query") {
            this._queryPageViews++;
        }
        this.send(TelemetryActions.Navigate, pageView, { pageViews: this._pageViews });
    }

    /** Remembers the platform of the dashboard's server, from the capabilities of a read. */
    public setPlatform(platform: PlatformInfo): void {
        this._platform = platform;
    }

    /**
     * A read finished. The first Query Store overview of each database sends Load, the funnel
     * step that tells whether the user saw data. Any read that didn't succeed sends ReadFailed.
     */
    public read(method: string, database: string, result: PerformanceRead<unknown>): void {
        const request = method.slice(method.lastIndexOf("/") + 1);
        const outcome = readOutcomeOf(result);
        if (request === "getQueryStoreOverview" && !this._loadedDatabases.has(database)) {
            this._loadedDatabases.add(database);
            const queryStore = isPerformanceUnavailable(result)
                ? undefined
                : (result as { queryStore?: { actualState?: string; readOnlyReason?: string } })
                      .queryStore;
            this.send(TelemetryActions.Load, {
                ...outcome,
                queryStoreState: code(queryStore?.actualState),
                readOnlyReason: code(queryStore?.readOnlyReason),
                databaseKind: database ? "named" : "default",
            });
        }
        if (outcome.status !== "ready" && outcome.status !== "noData") {
            this.send(TelemetryActions.ReadFailed, { request, ...outcome });
        }
    }

    /** An action on the dashboard, such as forcing a plan. Counts toward the Close summary. */
    public action(
        action: TelemetryActions,
        properties: Record<string, string> = {},
        measurements: Record<string, number> = {},
    ): void {
        this._queryActions++;
        this.send(action, properties, measurements);
    }

    /** The Database Hub banner appeared. Sent once for each panel. */
    public bannerShown(): void {
        if (!this._bannerShown) {
            this._bannerShown = true;
            this.send(TelemetryActions.ShowDatabaseHubBanner);
        }
    }

    /** The panel closed: how long it was open, and how much of the funnel it covered. */
    public closed(): void {
        if (this._closed) {
            return;
        }
        this._closed = true;
        this.send(
            TelemetryActions.Close,
            { lastPage: this._lastPageView ? JSON.parse(this._lastPageView).page : "" },
            {
                durationMs: Date.now() - this._openedAt,
                pageViews: this._pageViews,
                queryPageViews: this._queryPageViews,
                actions: this._queryActions,
                databases: this._loadedDatabases.size,
            },
        );
    }

    private send(
        action: TelemetryActions,
        properties: Record<string, string> = {},
        measurements: Record<string, number> = {},
    ): void {
        // Events wait for the connection properties, and keep their order.
        void this._connection.then((connection) =>
            sendActionEvent(TelemetryViews.PerformanceDashboard, action, {
                ...connection,
                serverInfo: this.serverInfo(connection.serverInfo),
                additionalProps: {
                    dashboardId: this.dashboardId,
                    platform: this._platform?.platform ?? "",
                    ...properties,
                },
                additionalMeasurements: measurements,
            }),
        );
    }

    /**
     * The server info of the connection. Without an open or earlier connection, the platform
     * that the dashboard's own reads found gives the engine edition.
     */
    private serverInfo(serverInfo: ServerInfo | undefined): ServerInfo | undefined {
        if (serverInfo || !this._platform) {
            return serverInfo;
        }
        return {
            engineEditionId: this._platform.engineEdition,
            isCloud: this._platform.platform !== "sqlServer",
        };
    }

    private static async connectionOf(profileId: string): Promise<ConnectionTelemetry> {
        try {
            return (await getDatabaseHubService()?.connectionTelemetryForProfile(profileId)) ?? {};
        } catch {
            return {};
        }
    }
}
