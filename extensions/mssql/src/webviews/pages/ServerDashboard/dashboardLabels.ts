/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DashboardHealthStatus,
    DashboardMetric,
    DashboardMetricKind,
    DashboardPlatform,
    DashboardQueryTrend,
    DashboardSessionStatus,
    DashboardWaitCategory,
    DbAgentInvestigationEventKind,
    DbAgentIssue,
    DbAgentIssueSeverity,
    DbAgentIssueStatus,
} from "../../../sharedInterfaces/serverDashboard";
import { LocConstants } from "../../common/locConstants";

export function getDashboardLoc(): LocConstants["serverDashboard"] {
    return LocConstants.getInstance().serverDashboard;
}

const numberFormatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
});

const integerFormatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
});

export function getPlatformLabel(platform: DashboardPlatform): string {
    const dashboardLoc = getDashboardLoc();
    switch (platform) {
        case "azureSql":
            return dashboardLoc.azureSqlDatabase;
        case "fabricSql":
            return dashboardLoc.fabricSqlEndpoint;
        case "sqlServer":
            return dashboardLoc.sqlServer;
    }
}

export function getMetricLabel(kind: DashboardMetricKind): string {
    const dashboardLoc = getDashboardLoc();
    switch (kind) {
        case "cpu":
            return dashboardLoc.cpuUtilization;
        case "dataIo":
            return dashboardLoc.dataIo;
        case "logIo":
            return dashboardLoc.logIo;
        case "storage":
            return dashboardLoc.storageUsed;
        case "sessions":
            return dashboardLoc.activeSessions;
        case "workers":
            return dashboardLoc.workerUtilization;
        case "batchRequests":
            return dashboardLoc.batchRequests;
        case "bufferCache":
            return dashboardLoc.bufferCacheHitRatio;
        case "pageLifeExpectancy":
            return dashboardLoc.pageLifeExpectancy;
        case "capacity":
            return dashboardLoc.capacityUtilization;
        case "queryDuration":
            return dashboardLoc.averageQueryDuration;
    }
}

export function formatMetricValue(metric: Pick<DashboardMetric, "value" | "unit">): string {
    const dashboardLoc = getDashboardLoc();
    switch (metric.unit) {
        case "percent":
            return new Intl.NumberFormat(undefined, {
                style: "percent",
                maximumFractionDigits: 1,
            }).format(metric.value / 100);
        case "milliseconds":
            return dashboardLoc.milliseconds(numberFormatter.format(metric.value));
        case "seconds":
            return dashboardLoc.seconds(integerFormatter.format(metric.value));
        case "count":
            return integerFormatter.format(metric.value);
        case "gigabytes":
            return dashboardLoc.gigabytes(numberFormatter.format(metric.value));
        case "perSecond":
            return dashboardLoc.perSecond(integerFormatter.format(metric.value));
    }
}

export function formatDuration(milliseconds: number): string {
    const dashboardLoc = getDashboardLoc();
    if (milliseconds >= 60_000) {
        return dashboardLoc.minutes(numberFormatter.format(milliseconds / 60_000));
    }
    if (milliseconds >= 1_000) {
        return dashboardLoc.seconds(numberFormatter.format(milliseconds / 1_000));
    }
    return dashboardLoc.milliseconds(numberFormatter.format(milliseconds));
}

export function formatNumber(value: number): string {
    return integerFormatter.format(value);
}

export function getHealthLabel(status: DashboardHealthStatus): string {
    const dashboardLoc = getDashboardLoc();
    switch (status) {
        case "healthy":
            return dashboardLoc.healthy;
        case "warning":
            return dashboardLoc.needsAttention;
        case "critical":
            return dashboardLoc.critical;
    }
}

export function getTrendLabel(trend: DashboardQueryTrend): string {
    const dashboardLoc = getDashboardLoc();
    switch (trend) {
        case "improving":
            return dashboardLoc.improving;
        case "stable":
            return dashboardLoc.stable;
        case "regressing":
            return dashboardLoc.regressing;
    }
}

export function getWaitCategoryLabel(category: DashboardWaitCategory): string {
    const dashboardLoc = getDashboardLoc();
    switch (category) {
        case "cpu":
            return dashboardLoc.cpu;
        case "io":
            return dashboardLoc.dataIo;
        case "lock":
            return dashboardLoc.locking;
        case "log":
            return dashboardLoc.transactionLog;
        case "network":
            return dashboardLoc.network;
        case "parallelism":
            return dashboardLoc.parallelism;
    }
}

export function getSessionStatusLabel(status: DashboardSessionStatus): string {
    const dashboardLoc = getDashboardLoc();
    switch (status) {
        case "running":
            return dashboardLoc.running;
        case "sleeping":
            return dashboardLoc.sleeping;
        case "suspended":
            return dashboardLoc.suspended;
    }
}

export function getIssueSeverityLabel(severity: DbAgentIssueSeverity): string {
    const dashboardLoc = getDashboardLoc();
    switch (severity) {
        case "critical":
            return dashboardLoc.critical;
        case "warning":
            return dashboardLoc.warning;
        case "watch":
            return dashboardLoc.watch;
    }
}

export function getIssueStatusLabel(status: DbAgentIssueStatus): string {
    const dashboardLoc = getDashboardLoc();
    switch (status) {
        case "investigating":
            return dashboardLoc.investigating;
        case "actionReady":
            return dashboardLoc.actionReady;
        case "monitoring":
            return dashboardLoc.monitoring;
        case "resolved":
            return dashboardLoc.resolved;
    }
}

export function getIssueTitle(issue: DbAgentIssue): string {
    const dashboardLoc = getDashboardLoc();
    switch (issue.kind) {
        case "blockingChain":
            return dashboardLoc.longRunningBlockingChain;
        case "capacityPressure":
            return dashboardLoc.fabricCapacityPressure;
        case "highCpu":
            return dashboardLoc.sustainedCpuPressure;
        case "queryRegression":
            return dashboardLoc.queryPerformanceRegression;
        case "storageGrowth":
            return dashboardLoc.acceleratedStorageGrowth;
    }
}

export function getIssueSummary(issue: DbAgentIssue): string {
    const dashboardLoc = getDashboardLoc();
    switch (issue.kind) {
        case "blockingChain":
            return dashboardLoc.blockingChainSummary(issue.affectedDatabase);
        case "capacityPressure":
            return dashboardLoc.capacityPressureSummary(issue.affectedDatabase);
        case "highCpu":
            return dashboardLoc.highCpuSummary(issue.affectedDatabase);
        case "queryRegression":
            return dashboardLoc.queryRegressionSummary(issue.affectedDatabase);
        case "storageGrowth":
            return dashboardLoc.storageGrowthSummary(issue.affectedDatabase);
    }
}

export function getIssueRecommendation(issue: DbAgentIssue): string {
    const dashboardLoc = getDashboardLoc();
    switch (issue.kind) {
        case "blockingChain":
            return dashboardLoc.blockingChainRecommendation;
        case "capacityPressure":
            return dashboardLoc.capacityPressureRecommendation;
        case "highCpu":
            return dashboardLoc.highCpuRecommendation;
        case "queryRegression":
            return dashboardLoc.queryRegressionRecommendation;
        case "storageGrowth":
            return dashboardLoc.storageGrowthRecommendation;
    }
}

export function getInvestigationEventLabel(kind: DbAgentInvestigationEventKind): string {
    const dashboardLoc = getDashboardLoc();
    switch (kind) {
        case "detected":
            return dashboardLoc.anomalyDetected;
        case "correlated":
            return dashboardLoc.signalsCorrelated;
        case "diagnosed":
            return dashboardLoc.rootCauseIdentified;
        case "recommended":
            return dashboardLoc.actionPrepared;
        case "monitoring":
            return dashboardLoc.recoveryMonitoring;
    }
}
