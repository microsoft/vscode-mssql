/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type DashboardPlatform = "azureSql" | "sqlServer" | "fabricSql";

export type DashboardLaunchSource = "objectExplorer" | "commandPalette";

export type DashboardTabId = "overview" | "waits" | "queries" | "sessions" | "issues";

export const dashboardTabIds: readonly DashboardTabId[] = [
    "overview",
    "waits",
    "queries",
    "sessions",
    "issues",
];

export function isDashboardTabId(value: unknown): value is DashboardTabId {
    return typeof value === "string" && (dashboardTabIds as readonly string[]).includes(value);
}

export interface DashboardTarget {
    id: string;
    displayName: string;
    serverName: string;
    databaseName: string;
    platform: DashboardPlatform;
    launchSource: DashboardLaunchSource;
}

export type DashboardMetricKind =
    | "cpu"
    | "dataIo"
    | "logIo"
    | "storage"
    | "sessions"
    | "workers"
    | "batchRequests"
    | "bufferCache"
    | "pageLifeExpectancy"
    | "capacity"
    | "queryDuration";

export type DashboardMetricUnit =
    | "percent"
    | "milliseconds"
    | "seconds"
    | "count"
    | "gigabytes"
    | "perSecond";

export type DashboardHealthStatus = "healthy" | "warning" | "critical";

export interface DashboardMetricPoint {
    timestamp: string;
    value: number;
}

export interface DashboardMetric {
    id: string;
    kind: DashboardMetricKind;
    value: number;
    unit: DashboardMetricUnit;
    changePercent: number;
    status: DashboardHealthStatus;
    points: DashboardMetricPoint[];
}

export interface DashboardServerDetails {
    engineVersion: string;
    edition: string;
    serviceTier: string;
    region: string;
    compute: string;
    availability: string;
    storageUsedGb: number;
    storageMaxGb: number;
}

export type DashboardQueryTrend = "improving" | "stable" | "regressing";

export interface DashboardQuery {
    queryId: string;
    queryText: string;
    databaseName: string;
    executions: number;
    averageDurationMs: number;
    totalDurationMs: number;
    cpuMs: number;
    logicalReads: number;
    trend: DashboardQueryTrend;
    lastExecutionTime: string;
}

export type DashboardWaitCategory = "cpu" | "io" | "lock" | "log" | "network" | "parallelism";

export interface DashboardWait {
    waitType: string;
    category: DashboardWaitCategory;
    waitTimeMs: number;
    percentage: number;
    waitingTasks: number;
    trend: DashboardQueryTrend;
}

export type DashboardSessionStatus = "running" | "sleeping" | "suspended";

export interface DashboardSession {
    sessionId: number;
    loginName: string;
    databaseName: string;
    applicationName: string;
    status: DashboardSessionStatus;
    cpuMs: number;
    elapsedTimeMs: number;
    blockingSessionId?: number;
    waitType?: string;
    queryText: string;
}

export type DbAgentIssueKind =
    | "blockingChain"
    | "capacityPressure"
    | "highCpu"
    | "queryRegression"
    | "storageGrowth";

export type DbAgentIssueSeverity = "critical" | "warning" | "watch";

export type DbAgentIssueStatus = "investigating" | "actionReady" | "monitoring" | "resolved";

export interface DbAgentIssue {
    issueId: string;
    kind: DbAgentIssueKind;
    severity: DbAgentIssueSeverity;
    status: DbAgentIssueStatus;
    detectedAt: string;
    updatedAt: string;
    metricValue: string;
    affectedDatabase: string;
}

export type DbAgentInvestigationEventKind =
    | "detected"
    | "correlated"
    | "diagnosed"
    | "recommended"
    | "monitoring";

export interface DbAgentInvestigationEvent {
    id: string;
    kind: DbAgentInvestigationEventKind;
    timestamp: string;
}

export interface DbAgentInvestigation {
    investigationId: string;
    issueId: string;
    status: "active" | "monitoring" | "resolved";
    startedAt: string;
    events: DbAgentInvestigationEvent[];
}

export interface DbAgentDashboard {
    enabled: boolean;
    registrationMode: "notRegistered" | "registered";
    health: DashboardHealthStatus;
    automationLevel: "recommendOnly" | "approvalRequired";
    lastAnalysisAt: string;
    issues: DbAgentIssue[];
    activeInvestigation?: DbAgentInvestigation;
}

export interface DashboardSnapshot {
    target: DashboardTarget;
    generatedAt: string;
    windowMinutes: number;
    server: DashboardServerDetails;
    metrics: DashboardMetric[];
    queries: DashboardQuery[];
    waits: DashboardWait[];
    sessions: DashboardSession[];
    dbAgent: DbAgentDashboard;
}

export interface ServerDashboardWebviewState {
    snapshot: DashboardSnapshot;
    availableTargets: DashboardTarget[];
    dbAgentAvailable: boolean;
    selectedTab: DashboardTabId;
    isRefreshing: boolean;
    errorMessage?: string;
}

export interface ServerDashboardReducers {
    refresh: Record<string, never>;
    changeTarget: { targetId: string };
    changeTimeWindow: { windowMinutes: number };
    selectTab: { tabId: DashboardTabId };
    acknowledgeIssue: { issueId: string };
    setDbAgentEnabled: { enabled: boolean };
    openNewQuery: Record<string, never>;
}
