/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SQL Dashboard contracts. This module crosses the extension-host/webview
 * boundary, so every value must remain JSON-serializable and runtime imports
 * are limited to vscode-jsonrpc protocol descriptors.
 */

import { NotificationType, RequestType } from "vscode-jsonrpc";

export namespace SqlDashboard {
    export const schemaVersion = 1 as const;

    export type Route =
        | { kind: "serverOverview" }
        | { kind: "databaseOverview"; database: string }
        | { kind: "databasePerformance"; database: string }
        | { kind: "queryDetail"; database: string; queryId: string }
        | { kind: "liveActivity"; database?: string }
        | { kind: "agent" };

    export type MockScenario =
        | "canonical"
        | "lowPermission"
        | "queryStoreOff"
        | "disconnected"
        | "queryVolume500"
        | "queryVolume5000";

    export type SourceKind =
        | "serverDmv"
        | "databaseDmv"
        | "queryStore"
        | "metadataStore"
        | "msdbHistory"
        | "errorLog"
        | "ringBuffer"
        | "resourceStats"
        | "deterministicMock";

    export interface SourceFacts {
        kind: SourceKind;
        label: string;
        detail?: string;
    }

    export type Freshness =
        | { state: "live"; asOfUtc: string }
        | { state: "sampled"; asOfUtc: string; windowSeconds: number }
        | { state: "cached"; asOfUtc: string; ageSeconds: number }
        | { state: "stale"; asOfUtc: string; reason: string }
        | { state: "unavailable"; reason: string };

    export type LoadState =
        | { state: "loading" }
        | { state: "ready" }
        | { state: "empty"; reason: string }
        | {
              state: "unavailable";
              reason:
                  | "permissionDenied"
                  | "queryStoreDisabled"
                  | "agentDisabled"
                  | "unsupported"
                  | "disconnected"
                  | "providerUnavailable";
              detail: string;
              remediation?: string;
          }
        | { state: "error"; code: string; detail: string; retryable: boolean };

    export interface SectionFacts {
        id: string;
        title: string;
        load: LoadState;
        source: SourceFacts;
        freshness: Freshness;
        permission?: {
            state: "granted" | "limited" | "denied" | "unknown";
            required?: string;
        };
    }

    export type KpiTone = "neutral" | "good" | "warning" | "critical" | "unknown";
    export type SeriesBasis = "historical" | "sessionAccumulated" | "none";

    export interface Kpi {
        id: string;
        label: string;
        value: string;
        note?: string;
        tone: KpiTone;
        seriesBasis: SeriesBasis;
        delta?: { value: string; direction: "up" | "down" | "flat" };
        series?: number[];
    }

    export interface AttentionItem {
        id: string;
        severity: "info" | "warning" | "critical" | "unknown";
        title: string;
        detail: string;
        route?: Route;
    }

    export interface DatabaseRow {
        name: string;
        state: string;
        size: string;
        logUsed: string;
        recoveryModel: string;
        compatibilityLevel: number;
        lastBackup: string;
        tone: KpiTone;
    }

    export interface QueryRow {
        queryId: string;
        executions: number;
        averageDurationMs: number;
        currentDurationMs: number;
        cpuMs: number;
        logicalReads: number;
        regressPercent?: number;
        planCount: number;
        status: "stable" | "regressed" | "improved" | "unknown";
        queryLabel: string;
    }

    export interface WaitCategory {
        category: string;
        percent: number;
        durationMs: number;
    }

    export interface PlanSummary {
        planId: string;
        firstSeenUtc: string;
        lastSeenUtc: string;
        averageDurationMs: number;
        executions: number;
        forced: boolean;
        status: "baseline" | "current" | "historical";
    }

    export interface PageBase {
        route: Route;
        title: string;
        subtitle: string;
        sections: SectionFacts[];
        attention: AttentionItem[];
    }

    export interface ServerOverviewPage extends PageBase {
        kind: "serverOverview";
        server: {
            name: string;
            environment: string;
            version: string;
            platform: string;
            processors: string;
            memory: string;
            uptime: string;
        };
        kpis: Kpi[];
        databases: DatabaseRow[];
    }

    export interface DatabaseOverviewPage extends PageBase {
        kind: "databaseOverview";
        database: string;
        properties: Array<{ label: string; value: string; tone?: KpiTone }>;
        kpis: Kpi[];
        queryStore: {
            state: "readWrite" | "readOnly" | "off" | "unknown";
            usedMb?: number;
            maxMb?: number;
            cleanupPercent?: number;
        };
        topQueries: QueryRow[];
    }

    export interface DatabasePerformancePage extends PageBase {
        kind: "databasePerformance";
        database: string;
        windowLabel: string;
        kpis: Kpi[];
        queries: QueryRow[];
        totalQueryCount: number;
    }

    export interface QueryDetailPage extends PageBase {
        kind: "queryDetail";
        database: string;
        queryId: string;
        queryLabel: string;
        kpis: Kpi[];
        waits: WaitCategory[];
        plans: PlanSummary[];
        privacy: {
            queryTextAvailable: boolean;
            queryTextPersisted: false;
            message: string;
        };
    }

    export interface UnavailablePage extends PageBase {
        kind: "unavailable";
        requestedRoute: Route;
        state: Extract<LoadState, { state: "unavailable" }>;
    }

    export type Page =
        | ServerOverviewPage
        | DatabaseOverviewPage
        | DatabasePerformancePage
        | QueryDetailPage
        | UnavailablePage;

    export interface WebviewState {
        schemaVersion: typeof schemaVersion;
        mode: "live" | "mock";
        scenario?: MockScenario;
        connection: {
            displayName: string;
            server: string;
            database?: string;
            backend?: string;
        };
        requestId: number;
        route: Route;
        status: "loading" | "ready" | "error";
        page?: Page;
        error?: { code: string; detail: string; retryable: boolean };
    }

    export namespace NavigateRequest {
        export const type = new RequestType<{ route: Route }, WebviewState, void>(
            "dashboard/navigate",
        );
    }

    export namespace RefreshRequest {
        export const type = new RequestType<void, WebviewState, void>("dashboard/refresh");
    }

    export namespace OpenQueryStudioRequest {
        export const type = new RequestType<
            { database: string; queryId?: string },
            { opened: boolean },
            void
        >("dashboard/openQueryStudio");
    }

    export namespace RenderedNotification {
        export const type = new NotificationType<{
            requestId: number;
            route: Route["kind"];
            tableRows: number;
        }>("dashboard/rendered");
    }
}
