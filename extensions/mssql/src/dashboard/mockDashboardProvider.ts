/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlDashboard } from "../sharedInterfaces/sqlDashboard";
import { DashboardProvider } from "./dashboardProvider";

const AS_OF_UTC = "2026-08-14T23:52:35.000Z";

const mockSource: SqlDashboard.SourceFacts = {
    kind: "deterministicMock",
    label: "Deterministic dashboard fixture",
    detail: "sql-dashboard canonical scenario v1",
};

function section(
    id: string,
    title: string,
    overrides: Partial<SqlDashboard.SectionFacts> = {},
): SqlDashboard.SectionFacts {
    return {
        id,
        title,
        load: { state: "ready" },
        source: mockSource,
        freshness: { state: "sampled", asOfUtc: AS_OF_UTC, windowSeconds: 900 },
        permission: { state: "granted" },
        ...overrides,
    };
}

const canonicalQueries: SqlDashboard.QueryRow[] = [
    {
        queryId: "42",
        executions: 1_834,
        averageDurationMs: 687,
        currentDurationMs: 1_003,
        cpuMs: 742,
        logicalReads: 18_420,
        regressPercent: 46,
        planCount: 2,
        status: "regressed",
        queryLabel: "Query 42 · Orders by customer and date",
    },
    {
        queryId: "118",
        executions: 9_428,
        averageDurationMs: 184,
        currentDurationMs: 192,
        cpuMs: 121,
        logicalReads: 4_872,
        regressPercent: 4,
        planCount: 1,
        status: "stable",
        queryLabel: "Query 118 · Stock item availability",
    },
    {
        queryId: "317",
        executions: 643,
        averageDurationMs: 2_841,
        currentDurationMs: 2_214,
        cpuMs: 1_306,
        logicalReads: 94_102,
        regressPercent: -22,
        planCount: 3,
        status: "improved",
        queryLabel: "Query 317 · Invoice aging summary",
    },
    {
        queryId: "512",
        executions: 38_210,
        averageDurationMs: 42,
        currentDurationMs: 44,
        cpuMs: 21,
        logicalReads: 634,
        regressPercent: 5,
        planCount: 1,
        status: "stable",
        queryLabel: "Query 512 · Customer lookup",
    },
    {
        queryId: "684",
        executions: 2_102,
        averageDurationMs: 921,
        currentDurationMs: 1_144,
        cpuMs: 804,
        logicalReads: 31_745,
        regressPercent: 24,
        planCount: 2,
        status: "regressed",
        queryLabel: "Query 684 · Supplier transaction history",
    },
    {
        queryId: "711",
        executions: 81_008,
        averageDurationMs: 18,
        currentDurationMs: 17,
        cpuMs: 8,
        logicalReads: 118,
        regressPercent: -6,
        planCount: 1,
        status: "stable",
        queryLabel: "Query 711 · Session context probe",
    },
    {
        queryId: "889",
        executions: 312,
        averageDurationMs: 4_106,
        currentDurationMs: 4_992,
        cpuMs: 2_048,
        logicalReads: 184_500,
        regressPercent: 22,
        planCount: 4,
        status: "regressed",
        queryLabel: "Query 889 · Warehouse movement analysis",
    },
    {
        queryId: "1004",
        executions: 17_441,
        averageDurationMs: 73,
        currentDurationMs: 69,
        cpuMs: 33,
        logicalReads: 1_002,
        regressPercent: -5,
        planCount: 1,
        status: "stable",
        queryLabel: "Query 1004 · Recent orders",
    },
];

function expandedQueries(count: number): SqlDashboard.QueryRow[] {
    return Array.from({ length: Math.min(100, count) }, (_, index) => {
        const base = canonicalQueries[index % canonicalQueries.length];
        const queryNumber = 1_100 + index;
        return {
            ...base,
            queryId: String(queryNumber),
            executions: base.executions + index * 17,
            currentDurationMs: base.currentDurationMs + (index % 11) * 13,
            queryLabel: `Query ${queryNumber} · deterministic workload shape`,
        };
    });
}

function unavailablePage(
    route: SqlDashboard.Route,
    reason: Extract<SqlDashboard.LoadState, { state: "unavailable" }>["reason"],
    detail: string,
    remediation?: string,
): SqlDashboard.UnavailablePage {
    const state: Extract<SqlDashboard.LoadState, { state: "unavailable" }> = {
        state: "unavailable",
        reason,
        detail,
        ...(remediation ? { remediation } : {}),
    };
    return {
        kind: "unavailable",
        requestedRoute: route,
        route,
        title: route.kind === "agent" ? "SQL Agent" : "SQL Dashboard",
        subtitle: "This surface cannot currently provide trustworthy data.",
        sections: [
            section("unavailable", "Availability", {
                load: state,
                freshness: { state: "unavailable", reason: detail },
            }),
        ],
        attention: [],
        state,
    };
}

function serverPage(lowPermission: boolean): SqlDashboard.ServerOverviewPage {
    const restricted = section("workload", "Workload and waits", {
        load: {
            state: "unavailable",
            reason: "permissionDenied",
            detail: "Server workload metrics require VIEW SERVER PERFORMANCE STATE.",
            remediation: "Ask an administrator for the narrow server performance permission.",
        },
        freshness: {
            state: "unavailable",
            reason: "The server did not expose workload metrics to this login.",
        },
        permission: { state: "denied", required: "VIEW SERVER PERFORMANCE STATE" },
    });
    return {
        kind: "serverOverview",
        route: { kind: "serverOverview" },
        title: "sqlprod01",
        subtitle: "Production SQL Server overview",
        server: {
            name: "sqlprod01",
            environment: "Production",
            version: "SQL Server 2025 Enterprise",
            platform: "Ubuntu 22.04",
            processors: "32 logical processors",
            memory: "256 GB",
            uptime: "41 days",
        },
        sections: [
            section("identity", "Server identity", {
                freshness: { state: "live", asOfUtc: AS_OF_UTC },
            }),
            ...(lowPermission ? [restricted] : [section("workload", "Workload and waits")]),
            section("databases", "Databases"),
        ],
        kpis: lowPermission
            ? [
                  {
                      id: "cpu",
                      label: "Server CPU",
                      value: "Unknown",
                      note: "Permission required",
                      tone: "unknown",
                      seriesBasis: "none",
                  },
                  {
                      id: "requests",
                      label: "Workload",
                      value: "Unknown",
                      note: "Permission required",
                      tone: "unknown",
                      seriesBasis: "none",
                  },
              ]
            : [
                  {
                      id: "cpu",
                      label: "Server CPU",
                      value: "41.6%",
                      note: "60-second observation window",
                      tone: "neutral",
                      seriesBasis: "historical",
                      delta: { value: "+3.2 pp", direction: "up" },
                      series: [31, 35, 34, 39, 42, 38, 44, 41.6],
                  },
                  {
                      id: "requests",
                      label: "Workload",
                      value: "2,840 req/s",
                      note: "60-second observation window",
                      tone: "neutral",
                      seriesBasis: "historical",
                      series: [2_220, 2_490, 2_610, 2_540, 2_730, 2_890, 2_840],
                  },
                  {
                      id: "active",
                      label: "Active requests",
                      value: "23",
                      tone: "neutral",
                      seriesBasis: "none",
                  },
                  {
                      id: "blocking",
                      label: "Blocking",
                      value: "1 chain",
                      note: "47 s · 3 sessions affected",
                      tone: "warning",
                      seriesBasis: "none",
                  },
                  {
                      id: "readLatency",
                      label: "Read latency",
                      value: "11.4 ms",
                      tone: "neutral",
                      seriesBasis: "sessionAccumulated",
                  },
                  {
                      id: "writeLatency",
                      label: "Write latency",
                      value: "2.1 ms",
                      tone: "good",
                      seriesBasis: "sessionAccumulated",
                  },
              ],
        databases: [
            {
                name: "WideWorldImporters",
                state: "Online",
                size: "4.7 GB / 8 GB",
                logUsed: "38%",
                recoveryModel: "Simple",
                compatibilityLevel: 130,
                lastBackup: "312 days ago",
                tone: "warning",
            },
            {
                name: "SalesDW",
                state: "Online",
                size: "84.2 GB / 128 GB",
                logUsed: "21%",
                recoveryModel: "Full",
                compatibilityLevel: 170,
                lastBackup: "2 hours ago",
                tone: "good",
            },
            {
                name: "Operations",
                state: "Online",
                size: "18.8 GB / 32 GB",
                logUsed: "67%",
                recoveryModel: "Full",
                compatibilityLevel: 160,
                lastBackup: "5 hours ago",
                tone: "neutral",
            },
        ],
        attention: lowPermission
            ? [
                  {
                      id: "permission",
                      severity: "unknown",
                      title: "Workload health is unknown",
                      detail: "The current login cannot read server performance state.",
                  },
              ]
            : [
                  {
                      id: "blocking",
                      severity: "warning",
                      title: "Blocking chain active for 47 seconds",
                      detail: "Session 164 blocks 157, which blocks sessions 203 and 214.",
                      route: { kind: "liveActivity" },
                  },
                  {
                      id: "backup",
                      severity: "critical",
                      title: "WideWorldImporters backup is 312 days old",
                      detail: "The last full backup is outside the configured recovery objective.",
                      route: { kind: "databaseOverview", database: "WideWorldImporters" },
                  },
              ],
    };
}

function databasePage(queryStoreOff: boolean): SqlDashboard.DatabaseOverviewPage {
    return {
        kind: "databaseOverview",
        route: { kind: "databaseOverview", database: "WideWorldImporters" },
        title: "WideWorldImporters",
        subtitle: "Database health, capacity, and Query Store",
        database: "WideWorldImporters",
        sections: [
            section("properties", "Database properties", {
                freshness: { state: "live", asOfUtc: AS_OF_UTC },
            }),
            section("queryStore", "Query Store", {
                load: queryStoreOff
                    ? {
                          state: "unavailable",
                          reason: "queryStoreDisabled",
                          detail: "Query Store is disabled for this database.",
                          remediation:
                              "Enable Query Store before using historical performance views.",
                      }
                    : { state: "ready" },
                freshness: queryStoreOff
                    ? { state: "unavailable", reason: "Query Store is disabled." }
                    : { state: "sampled", asOfUtc: AS_OF_UTC, windowSeconds: 900 },
            }),
        ],
        properties: [
            { label: "State", value: "Online", tone: "good" },
            { label: "Data size", value: "4.7 GB of 8 GB" },
            { label: "Log used", value: "38%" },
            { label: "Recovery model", value: "Simple" },
            { label: "Compatibility", value: "130", tone: "warning" },
            { label: "Last full backup", value: "312 days ago", tone: "critical" },
        ],
        kpis: [
            {
                id: "executions",
                label: "Executions",
                value: "412,380",
                note: "Last 24 hours",
                tone: "neutral",
                seriesBasis: "historical",
            },
            {
                id: "duration",
                label: "Average duration",
                value: "214 ms",
                note: "24.5 h total duration",
                tone: "neutral",
                seriesBasis: "historical",
            },
            {
                id: "cpu",
                label: "CPU time",
                value: "12.2 h",
                tone: "neutral",
                seriesBasis: "historical",
            },
            {
                id: "reads",
                label: "Logical reads",
                value: "2.1 B",
                tone: "neutral",
                seriesBasis: "historical",
            },
        ],
        queryStore: queryStoreOff
            ? { state: "off" }
            : { state: "readWrite", usedMb: 387, maxMb: 512, cleanupPercent: 90 },
        topQueries: queryStoreOff ? [] : canonicalQueries,
        attention: [
            {
                id: "backup",
                severity: "critical",
                title: "Full backup is 312 days old",
                detail: "Review the backup policy before relying on this database for production recovery.",
            },
            ...(queryStoreOff
                ? [
                      {
                          id: "queryStoreOff",
                          severity: "unknown" as const,
                          title: "Historical query health is unknown",
                          detail: "Query Store is disabled; no stale performance claims are shown.",
                      },
                  ]
                : []),
        ],
    };
}

function performancePage(total: number): SqlDashboard.DatabasePerformancePage {
    const queries = total > canonicalQueries.length ? expandedQueries(total) : canonicalQueries;
    return {
        kind: "databasePerformance",
        route: { kind: "databasePerformance", database: "WideWorldImporters" },
        title: "Database performance",
        subtitle: "WideWorldImporters · Query Store · last 24 hours",
        database: "WideWorldImporters",
        windowLabel: "Last 24 hours",
        sections: [section("summary", "Performance summary"), section("queries", "Top queries")],
        kpis: databasePage(false).kpis,
        queries,
        totalQueryCount: total,
        attention: [
            {
                id: "regression42",
                severity: "warning",
                title: "Query 42 regressed 46%",
                detail: "The current plan is slower than the historical baseline.",
                route: {
                    kind: "queryDetail",
                    database: "WideWorldImporters",
                    queryId: "42",
                },
            },
        ],
    };
}

function queryDetailPage(queryId: string): SqlDashboard.QueryDetailPage {
    const row = canonicalQueries.find((query) => query.queryId === queryId) ?? canonicalQueries[0];
    return {
        kind: "queryDetail",
        route: { kind: "queryDetail", database: "WideWorldImporters", queryId },
        title: row.queryLabel,
        subtitle: "WideWorldImporters · Query Store query detail",
        database: "WideWorldImporters",
        queryId,
        queryLabel: row.queryLabel,
        sections: [
            section("summary", "Query summary"),
            section("plans", "Plan history"),
            section("waits", "Wait categories"),
        ],
        kpis: [
            {
                id: "current",
                label: "Current duration",
                value: "1.00 s",
                tone: "warning",
                seriesBasis: "historical",
                delta: { value: "+46%", direction: "up" },
            },
            {
                id: "baseline",
                label: "Baseline duration",
                value: "687 ms",
                tone: "good",
                seriesBasis: "historical",
            },
            {
                id: "executions",
                label: "Executions",
                value: "1,834",
                tone: "neutral",
                seriesBasis: "historical",
            },
            {
                id: "reads",
                label: "Logical reads",
                value: "18,420",
                tone: "neutral",
                seriesBasis: "historical",
            },
        ],
        waits: [
            { category: "CPU", percent: 38, durationMs: 381 },
            { category: "Storage I/O", percent: 31, durationMs: 311 },
            { category: "Locks", percent: 18, durationMs: 181 },
            { category: "Other", percent: 13, durationMs: 130 },
        ],
        plans: [
            {
                planId: "811",
                firstSeenUtc: "2026-08-01T07:21:00.000Z",
                lastSeenUtc: "2026-08-14T23:40:51.000Z",
                averageDurationMs: 687,
                executions: 1_792,
                forced: false,
                status: "baseline",
            },
            {
                planId: "847",
                firstSeenUtc: "2026-08-14T23:41:07.000Z",
                lastSeenUtc: AS_OF_UTC,
                averageDurationMs: 1_003,
                executions: 42,
                forced: false,
                status: "current",
            },
        ],
        privacy: {
            queryTextAvailable: true,
            queryTextPersisted: false,
            message:
                "Query text is revealed only on this explicit route and is never persisted, logged, or sent to telemetry.",
        },
        attention: [
            {
                id: "planChange",
                severity: "warning",
                title: "A new plan appeared at 4:41:07 PM",
                detail: "Plan 847 is 46% slower than baseline plan 811.",
            },
        ],
    };
}

export class MockDashboardProvider implements DashboardProvider {
    readonly mode = "mock" as const;
    readonly connection = {
        displayName: "sqlprod01 · Production",
        server: "sqlprod01",
        database: "WideWorldImporters",
        backend: "deterministicMock",
    };

    constructor(readonly scenario: SqlDashboard.MockScenario = "canonical") {}

    async load(route: SqlDashboard.Route, signal: AbortSignal): Promise<SqlDashboard.Page> {
        if (signal.aborted) {
            throw new DOMException("Dashboard route load was cancelled", "AbortError");
        }
        if (this.scenario === "disconnected") {
            return unavailablePage(
                route,
                "disconnected",
                "The saved connection is disconnected. Previously observed values are not presented as current.",
                "Reconnect and refresh the dashboard.",
            );
        }
        switch (route.kind) {
            case "serverOverview":
                return serverPage(this.scenario === "lowPermission");
            case "databaseOverview":
                return databasePage(this.scenario === "queryStoreOff");
            case "databasePerformance":
                if (this.scenario === "lowPermission") {
                    return unavailablePage(
                        route,
                        "permissionDenied",
                        "Query Store catalog views are not visible to this login.",
                        "Ask for VIEW DATABASE PERFORMANCE STATE on this database.",
                    );
                }
                if (this.scenario === "queryStoreOff") {
                    return unavailablePage(
                        route,
                        "queryStoreDisabled",
                        "Query Store is disabled, so historical performance cannot be calculated.",
                        "Enable Query Store and allow it to collect a representative window.",
                    );
                }
                return performancePage(
                    this.scenario === "queryVolume5000"
                        ? 5_000
                        : this.scenario === "queryVolume500"
                          ? 500
                          : 1_284,
                );
            case "queryDetail":
                return queryDetailPage(route.queryId);
            case "liveActivity":
                return unavailablePage(
                    route,
                    "unsupported",
                    "Live Activity is staged for the next dashboard slice. No background polling was started.",
                );
            case "agent":
                return unavailablePage(
                    route,
                    "agentDisabled",
                    "SQL Agent is disabled in this deterministic scenario.",
                );
        }
    }

    dispose(): void {}
}
