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
    | "storageGrowth"
    | "availabilityRisk"
    | "securityRisk";

export type DbAgentIssueSeverity = "critical" | "warning" | "watch";

export type DbAgentIssueCategory = "performance" | "availability" | "storage" | "security";

export type DbAgentIssueStatus =
    | "new"
    | "investigating"
    | "diagnosed"
    | "actionProposed"
    | "executing"
    | "verifying"
    | "monitoring"
    | "resolved"
    | "closed"
    | "failed";

export type DbAgentMetricAnnotationKind = "detection" | "action" | "resolution";

export interface DbAgentMetricAnnotation {
    timestamp: string;
    label: string;
    kind: DbAgentMetricAnnotationKind;
}

export interface DbAgentMetricSeries {
    id: string;
    label: string;
    unit: string;
    points: DashboardMetricPoint[];
}

export interface DbAgentMetricChart {
    id: string;
    title: string;
    series: DbAgentMetricSeries[];
    annotations: DbAgentMetricAnnotation[];
}

export type DbAgentActionRisk = "low" | "medium" | "high" | "critical";

export type DbAgentActionApprovalStatus =
    | "pending"
    | "approved"
    | "rejected"
    | "executed"
    | "manuallyApplied";

export type DbAgentExecutionVenue = "runner" | "client" | "manual";

export interface DbAgentIssueAction {
    actionId: string;
    stageNumber: number;
    title: string;
    actionType: string;
    executionVenue: DbAgentExecutionVenue;
    approvalStatus: DbAgentActionApprovalStatus;
    risk: DbAgentActionRisk;
    confidencePercent: number;
    reasoning: string;
    expectedOutcome: string;
    rollbackPlan: string;
    parameters: Record<string, string | number | boolean>;
}

export interface DbAgentActionTaken {
    actionId: string;
    title: string;
    executedAt: string;
    executedBy: string;
    outcome: "succeeded" | "failed";
    validationResult: string;
}

export type DbAgentIssueEventKind =
    | "detected"
    | "severityChanged"
    | "diagnosed"
    | "actionProposed"
    | "actionApproved"
    | "actionRejected"
    | "actionExecuted"
    | "acknowledged"
    | "resolved";

export interface DbAgentIssueEvent {
    eventId: string;
    kind: DbAgentIssueEventKind;
    timestamp: string;
    description: string;
}

export interface DbAgentSeverityHistoryEntry {
    timestamp: string;
    severity: DbAgentIssueSeverity;
    reason: string;
}

export interface DbAgentIssue {
    issueId: string;
    kind: DbAgentIssueKind;
    category: DbAgentIssueCategory;
    severity: DbAgentIssueSeverity;
    status: DbAgentIssueStatus;
    title: string;
    summary: string;
    diagnosis: string;
    detectedAt: string;
    updatedAt: string;
    metricValue: string;
    affectedDatabase: string;
    metricCharts: DbAgentMetricChart[];
    events: DbAgentIssueEvent[];
    severityHistory: DbAgentSeverityHistoryEntry[];
    recommendedActions: DbAgentIssueAction[];
    actionsTaken: DbAgentActionTaken[];
    blockedByIssueIds: string[];
    blockingIssueIds: string[];
    analysisNotes: Partial<Record<DbAgentAnalyzableSection, string>>;
}

export type DbAgentAnalyzableSection = "summary" | "diagnosis" | "metrics" | "recommendedAction";

export type DbAgentInvestigationEventKind =
    | "detected"
    | "correlated"
    | "diagnosed"
    | "recommended"
    | "action"
    | "monitoring"
    | "resolved";

export interface DbAgentInvestigationEvent {
    id: string;
    kind: DbAgentInvestigationEventKind;
    timestamp: string;
    title: string;
    detail: string;
}

export interface DbAgentInvestigation {
    investigationId: string;
    issueIds: string[];
    triggerSummary: string;
    status: "active" | "monitoring" | "resolved" | "closed";
    startedAt: string;
    updatedAt: string;
    resolvedAt?: string;
    events: DbAgentInvestigationEvent[];
}

export type DbAgentRegistrationMode =
    | "notEligible"
    | "notRegistered"
    | "registering"
    | "registered"
    | "degradedAuth"
    | "degradedAuthz"
    | "degradedApi";

export type DbAgentSurfaceStatus = "loading" | "ready" | "error";

export type DbAgentRole = "reader" | "contributor" | "admin";

export interface DbAgentActionCategorySetting {
    category: DbAgentIssueCategory;
    enabled: boolean;
    approvalRequired: boolean;
}

export interface DbAgentSettings {
    enabled: boolean;
    notifyOnResolve: boolean;
    notifyOnFailure: boolean;
    currentRole: DbAgentRole;
    approvingAdmin: string;
    actionCategories: DbAgentActionCategorySetting[];
}

export interface DbAgentInstruction {
    instructionId: string;
    text: string;
    createdBy: string;
    createdAt: string;
}

export interface DbAgentDashboard {
    enabled: boolean;
    surfaceStatus: DbAgentSurfaceStatus;
    registrationMode: DbAgentRegistrationMode;
    registrationStep?: number;
    errorMessage?: string;
    health: DashboardHealthStatus;
    automationLevel: "recommendOnly" | "approvalRequired";
    lastAnalysisAt: string;
    lastSuccessfulRunAt: string;
    issues: DbAgentIssue[];
    activeInvestigation?: DbAgentInvestigation;
    investigations: DbAgentInvestigation[];
    settings: DbAgentSettings;
    instructions: DbAgentInstruction[];
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
    registerDbAgent: Record<string, never>;
    decideDbAgentAction: {
        issueId: string;
        actionId: string;
        decision: "approve" | "reject";
    };
    executeDbAgentAction: { issueId: string; actionId: string };
    markDbAgentActionApplied: { issueId: string; actionId: string };
    analyzeDbAgentSection: { issueId: string; section: DbAgentAnalyzableSection };
    forceResolveInvestigation: { investigationId: string; reason?: string };
    saveDbAgentSettings: { settings: DbAgentSettings };
    createDbAgentInstruction: { text: string };
    revokeDbAgentInstruction: { instructionId: string };
    openNewQuery: Record<string, never>;
}
