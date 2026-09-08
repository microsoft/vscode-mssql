/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * State and reducers shared between the SQL Diagnostics webview and its controller.
 *
 * The webview never talks to a server: it asks for a query by id and renders whatever rows come
 * back, so the SQL, the platform gating and the permissions all stay on the extension side.
 */

export type DiagnosticsSection = "dmv" | "querystore" | "agent";
import type { DmvReadiness } from "sql-feature/diagnostics/dmv";
import type { CellValue } from "sql-feature/core";
import type {
    QueryStoreReadiness,
    QueryStoreConfiguration,
    QueryStoreInterventionCapabilities,
    QueryStoreMaintenanceAction,
    QueryStoreInvestigationContext,
    QueryStorePlanXmlInspection,
    QueryStorePlanAction,
} from "sql-feature/diagnostics/querystore";

/** A column as the grid needs it, flattened from the package's catalog definition. */
export interface DiagnosticsColumn {
    field: string;
    header: string;
    format?: string;
    width?: number;
    /** Long text that belongs in the detail pane rather than a narrow cell. */
    wide?: boolean;
}

/** One query offered in the picker, with whether it can run against this server. */
export interface DiagnosticsQuerySummary {
    id: string;
    title: string;
    description: string;
    section: DiagnosticsSection;
    /** False when this server cannot run it; `unavailableReason` says why. */
    available: boolean;
    unavailableReason?: string;
    /** True when the query needs a job or plan selected before it can run. */
    requiresSelection?: boolean;
}

export interface DiagnosticsResult {
    params?: Record<string, unknown>;
    queryId: string;
    columns: DiagnosticsColumn[];
    rows: Record<string, CellValue>[];
    /** Wall time on the server side, milliseconds. */
    durationMs: number;
    /** True when at least one cell arrived clipped; the grid must say so. */
    truncated: boolean;
    ranAt: string;
    /** The immutable evidence context for the rows shown in this result. */
    snapshot: DiagnosticsSnapshot;
    /** Query Store-specific context shared by the SQL request, views, details, and export. */
    queryStoreContext?: QueryStoreInvestigationContext;
}

export type DiagnosticsCompleteness = "complete" | "empty" | "partial" | "unknown";

export interface DiagnosticsSnapshot {
    collectionStartedAt: string;
    collectionEndedAt: string;
    completeness: DiagnosticsCompleteness;
    scope: {
        section: DiagnosticsSection;
        serverName?: string;
        database?: string;
        targetId?: string;
    };
    window: {
        kind: "pointInTime" | "lookback" | "comparison" | "sinceReset";
        start?: string;
        end?: string;
        baselineStart?: string;
        baselineEnd?: string;
        label?: string;
    };
    metric?: "duration" | "cpu" | "reads" | "executions" | "waits" | "storage";
    aggregation?: "raw" | "sum" | "maximum" | "weightedMean" | "pooledVariation";
    rowLimit?: number;
    exclusions: string[];
    coverage: {
        kind: "point" | "intervals" | "unknown";
        observedIntervals?: number;
        availableIntervals?: number;
        baselineObservedIntervals?: number;
        baselineAvailableIntervals?: number;
        note?: string;
    };
    comparison?: {
        status: "baseline" | "delta" | "invalid";
        baselineCollectedAt?: string;
        reason?: "counterReset" | "incomplete" | "invalidValue";
    };
}

/** What the server is, shown in the header so a user knows why things are hidden. */
export interface DiagnosticsServerSummary {
    platformName: string;
    edition?: string;
    productVersion?: string;
    serverName?: string;
    database?: string;
    hasSqlAgent: boolean;
    hasQueryStore: boolean;
    queryStoreEnabled?: boolean;
}

export interface SqlDiagnosticsState {
    dmvReadiness?: DmvReadiness;
    dmvReadinessBusy?: boolean;
    agentReadiness?: import("sql-feature/agent").AgentReadiness;
    agentReadinessBusy?: boolean;
    jobActionBusy?: boolean;
    queryStore?: QueryStoreReadiness;
    queryStoreInterventions?: QueryStoreInterventionCapabilities;
    queryStoreMaintenance?: {
        action: QueryStoreMaintenanceAction;
        outcome: "verified" | "acceptedUnverified";
    };
    queryStorePlan?: {
        queryId: number;
        planId: number;
        loading: boolean;
        inspection?: QueryStorePlanXmlInspection;
        isForced?: boolean;
        forceFailureCount?: number;
        forceFailureReason?: string;
        error?: string;
    };
    queryStoreHint?: {
        queryId: number;
        loading: boolean;
        hint?: string;
        state?: string;
        failureReason?: string;
        error?: string;
    };
    queryStorePlans?: {
        queryId: number;
        loading: boolean;
        plans: {
            planId: number;
            isForced: boolean;
            forceFailureCount?: number;
            forceFailureReason?: string;
            firstObserved?: string;
            lastObserved?: string;
            executions: number;
            totalDurationUs?: number;
            averageDurationUs?: number;
            selectedMetricTotal?: number;
            selectedMetricAverage?: number;
            selectedMetricMaximum?: number;
            observedIntervals: number;
            firstInterval?: string;
            lastInterval?: string;
            lastExecution?: string;
        }[];
        error?: string;
    };
    jobCreation?: { busy: boolean; error?: string; createdJobId?: string };
    /** Absent until the server has been identified. */
    server?: DiagnosticsServerSummary;
    section: DiagnosticsSection;
    queries: DiagnosticsQuerySummary[];
    selectedQueryId?: string;
    result?: DiagnosticsResult;
    isLoading: boolean;
    /** Set when the last action failed, in words a user can act on. */
    errorMessage?: string;
    /** Agent job identities and display names, for the queries that need one selected. */
    jobOptions: { id: string; name: string }[];
    selectedJobId?: string;
}

/** One step of a job the user is creating. Kept minimal: a name, what to run, and where. */
export interface NewJobStep {
    retryAttempts?: number;
    retryIntervalMinutes?: number;
    name: string;
    command: string;
    database: string;
}

/** The create-job form's contents, validated again on the controller before any SQL is built. */
export interface NewJobRequest {
    schedule?: import("sql-feature/agent").JobSchedule;
    name: string;
    description: string;
    enabled: boolean;
    steps: NewJobStep[];
}

export interface SqlDiagnosticsReducers {
    openResultText: { ranAt: string; rowIndex: number; field: string };
    chooseDatabase: Record<string, never>;
    recheckAgent: Record<string, never>;
    runQuery: { queryId: string; params?: Record<string, unknown> };
    selectJob: { jobId: string };
    /** Agent job actions. `action` is validated against the allowed set on the controller. */
    jobAction: { jobId: string; action: "start" | "stop" | "enable" | "disable" | "delete" };
    /** Creates a SQL Agent job from the form. */
    createJob: { request: NewJobRequest };
    /** Turns Query Store on or off for the connected database. */
    setQueryStore: { enabled: boolean; configuration?: QueryStoreConfiguration };
    queryStoreMaintenance: { action: QueryStoreMaintenanceAction };
    inspectQueryStorePlan: { queryId: number; planId: number };
    openQueryStorePlan: Record<string, never>;
    queryStorePlanAction: {
        queryId: number;
        planId: number;
        action: QueryStorePlanAction;
    };
    setQueryStoreHint: { queryId: number; hint: string };
    clearQueryStoreHint: { queryId: number };
    loadQueryStorePlans: { queryId: number };
    refresh: Record<string, never>;
    exportCsv: Record<string, never>;
    openInEditor: { queryId: string };
}

/** Formats a microsecond duration for display, the unit Extended Events and the DMVs report. */
export function formatMicroseconds(value: number): string {
    if (!Number.isFinite(value)) {
        return "";
    }
    if (value < 1000) {
        return `${Math.round(value)} µs`;
    }
    if (value < 1_000_000) {
        return `${(value / 1000).toFixed(1)} ms`;
    }
    return `${(value / 1_000_000).toFixed(2)} s`;
}

export function formatMilliseconds(value: number): string {
    if (!Number.isFinite(value)) {
        return "";
    }
    if (value < 1000) {
        return `${Math.round(value)} ms`;
    }
    return `${(value / 1000).toFixed(2)} s`;
}

export function formatBytes(value: number): string {
    if (!Number.isFinite(value)) {
        return "";
    }
    const units = ["B", "KB", "MB", "GB", "TB"];
    let n = value;
    let unit = 0;
    while (n >= 1024 && unit < units.length - 1) {
        n /= 1024;
        unit++;
    }
    return `${unit === 0 ? n : n.toFixed(1)} ${units[unit]}`;
}

/** Renders one cell for display, applying the column's declared format. */
export function formatCell(value: unknown, format?: string): string {
    if (value === null || value === undefined) {
        return "";
    }
    if (typeof value === "object") {
        const tagged = value as { $t?: unknown; v?: unknown; of?: unknown };
        if (tagged.$t === "binary" && typeof tagged.v === "string") {
            return `[binary base64] ${tagged.v}`;
        }
        if (tagged.$t === "truncated" && typeof tagged.v === "string") {
            const kind = tagged.of === "binary" ? "binary base64 prefix" : "text prefix";
            return `[${kind}] ${tagged.v} [truncated]`;
        }
    }
    const n = typeof value === "number" ? value : Number(value);

    switch (format) {
        case "duration-us":
            return Number.isFinite(n) ? formatMicroseconds(n) : String(value);
        case "duration-ms":
            return Number.isFinite(n) ? formatMilliseconds(n) : String(value);
        case "bytes":
            return Number.isFinite(n) ? formatBytes(n) : String(value);
        case "percent":
            return Number.isFinite(n) ? `${n}%` : String(value);
        case "number":
            return Number.isFinite(n) ? n.toLocaleString() : String(value);
        case "datetime": {
            const d = new Date(String(value));
            return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
        }
        default:
            return String(value);
    }
}

/** Keeps tagged binary and truncated cells distinguishable outside the grid formatter. */
export function cellDisplayText(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") {
        const tagged = value as {
            $t?: unknown;
            v?: unknown;
            of?: unknown;
            bytes?: unknown;
            digest?: unknown;
        };
        if (tagged.$t === "binary" && typeof tagged.v === "string") {
            return `[binary base64]\n${tagged.v}`;
        }
        if (tagged.$t === "truncated" && typeof tagged.v === "string") {
            const metadata = [
                tagged.of === "binary" ? "binary base64 prefix" : "text prefix",
                typeof tagged.bytes === "number" ? `${tagged.bytes} bytes total` : undefined,
                typeof tagged.digest === "string" ? tagged.digest : undefined,
            ].filter((item): item is string => item !== undefined);
            return `[truncated ${metadata.join(", ")}]\n${tagged.v}`;
        }
    }
    return String(value);
}
