/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DashboardMetric,
    DashboardMetricPoint,
    DashboardPlatform,
    DashboardQuery,
    DashboardServerDetails,
    DashboardSession,
    DashboardSnapshot,
    DashboardTarget,
    DashboardWait,
    DbAgentDashboard,
    DbAgentIssue,
} from "../../sharedInterfaces/serverDashboard";
import { IDashboardDataService } from "./iDashboardDataService";

const DEFAULT_WINDOW_MINUTES = 60;

const mockTargets: readonly DashboardTarget[] = [
    {
        id: "mock-azure-sql-sales",
        displayName: "contoso-prod-sql / sales",
        serverName: "contoso-prod-sql.database.windows.net",
        databaseName: "sales",
        platform: "azureSql",
        launchSource: "commandPalette",
    },
    {
        id: "mock-sql-server-adventureworks",
        displayName: "sql2025-prod-01 / AdventureWorks2025",
        serverName: "sql2025-prod-01",
        databaseName: "AdventureWorks2025",
        platform: "sqlServer",
        launchSource: "commandPalette",
    },
    {
        id: "mock-fabric-retail",
        displayName: "Contoso Retail Workspace / retail_warehouse",
        serverName: "contoso-retail.datawarehouse.fabric.microsoft.com",
        databaseName: "retail_warehouse",
        platform: "fabricSql",
        launchSource: "commandPalette",
    },
];

export class MockDashboardDataService implements IDashboardDataService {
    private readonly _snapshots = new Map<string, DashboardSnapshot>();
    private readonly _refreshCounts = new Map<string, number>();

    public getAvailableTargets(): DashboardTarget[] {
        return clone([...mockTargets]);
    }

    public async loadDashboard(
        target: DashboardTarget,
        windowMinutes = DEFAULT_WINDOW_MINUTES,
    ): Promise<DashboardSnapshot> {
        const existing = this._snapshots.get(target.id);
        if (existing && existing.windowMinutes === windowMinutes) {
            return clone(existing);
        }

        const snapshot = buildSnapshot(target, windowMinutes);
        mergeDbAgentState(snapshot, existing);
        this._snapshots.set(target.id, snapshot);
        return clone(snapshot);
    }

    public async refreshDashboard(
        target: DashboardTarget,
        windowMinutes: number,
    ): Promise<DashboardSnapshot> {
        const refreshCount = (this._refreshCounts.get(target.id) ?? 0) + 1;
        this._refreshCounts.set(target.id, refreshCount);

        const snapshot = buildSnapshot(target, windowMinutes, refreshCount);
        const previous = this._snapshots.get(target.id);
        mergeDbAgentState(snapshot, previous);

        this._snapshots.set(target.id, snapshot);
        return clone(snapshot);
    }

    public async acknowledgeIssue(
        target: DashboardTarget,
        issueId: string,
    ): Promise<DashboardSnapshot> {
        const snapshot =
            clone(this._snapshots.get(target.id)) ?? (await this.loadDashboard(target));
        const issue = snapshot.dbAgent.issues.find((candidate) => candidate.issueId === issueId);
        if (!issue) {
            throw new Error(
                `Dashboard issue '${issueId}' was not found for target '${target.id}'.`,
            );
        }

        const acknowledgedAt = new Date().toISOString();
        snapshot.dbAgent.issues = snapshot.dbAgent.issues.map((issue) =>
            issue.issueId === issueId
                ? { ...issue, status: "monitoring", updatedAt: acknowledgedAt }
                : issue,
        );
        if (
            snapshot.dbAgent.activeInvestigation?.issueId === issueId &&
            snapshot.dbAgent.activeInvestigation.status !== "monitoring"
        ) {
            snapshot.dbAgent.activeInvestigation = {
                ...snapshot.dbAgent.activeInvestigation,
                status: "monitoring",
                events: [
                    ...snapshot.dbAgent.activeInvestigation.events,
                    {
                        id: `event-monitoring-${issueId}`,
                        kind: "monitoring",
                        timestamp: acknowledgedAt,
                    },
                ],
            };
        }
        this._snapshots.set(target.id, snapshot);
        return clone(snapshot);
    }

    public async setDbAgentEnabled(
        target: DashboardTarget,
        enabled: boolean,
    ): Promise<DashboardSnapshot> {
        const snapshot =
            clone(this._snapshots.get(target.id)) ?? (await this.loadDashboard(target));
        snapshot.dbAgent.enabled = enabled;
        snapshot.dbAgent.registrationMode = enabled ? "registered" : "notRegistered";
        this._snapshots.set(target.id, snapshot);
        return clone(snapshot);
    }
}

function mergeDbAgentState(
    snapshot: DashboardSnapshot,
    previous: DashboardSnapshot | undefined,
): void {
    if (!previous) {
        return;
    }

    snapshot.dbAgent.enabled = previous.dbAgent.enabled;
    snapshot.dbAgent.registrationMode = previous.dbAgent.registrationMode;
    snapshot.dbAgent.issues = mergeIssueState(snapshot.dbAgent.issues, previous.dbAgent.issues);
    snapshot.dbAgent.activeInvestigation = clone(previous.dbAgent.activeInvestigation);
}

function mergeIssueState(
    nextIssues: DbAgentIssue[],
    previousIssues: DbAgentIssue[],
): DbAgentIssue[] {
    const statusByIssueId = new Map(previousIssues.map((issue) => [issue.issueId, issue.status]));
    return nextIssues.map((issue) => ({
        ...issue,
        status: statusByIssueId.get(issue.issueId) ?? issue.status,
    }));
}

function buildSnapshot(
    target: DashboardTarget,
    windowMinutes: number,
    refreshCount = 0,
): DashboardSnapshot {
    const now = Date.now();
    const generatedAt = new Date(now).toISOString();
    const platformData = getPlatformData(target.platform, target.databaseName, now, windowMinutes);
    const metricAdjustment = refreshCount % 3;

    return {
        target: clone(target),
        generatedAt,
        windowMinutes,
        server: platformData.server,
        metrics: platformData.metrics.map((metric, index) => ({
            ...metric,
            value: round(metric.value + (index % 2 === 0 ? metricAdjustment : -metricAdjustment)),
        })),
        queries: platformData.queries,
        waits: platformData.waits,
        sessions: platformData.sessions,
        dbAgent: platformData.dbAgent,
    };
}

interface PlatformData {
    server: DashboardServerDetails;
    metrics: DashboardMetric[];
    queries: DashboardQuery[];
    waits: DashboardWait[];
    sessions: DashboardSession[];
    dbAgent: DbAgentDashboard;
}

function getPlatformData(
    platform: DashboardPlatform,
    databaseName: string,
    now: number,
    windowMinutes: number,
): PlatformData {
    switch (platform) {
        case "azureSql":
            return buildAzureSqlData(databaseName, now, windowMinutes);
        case "fabricSql":
            return buildFabricSqlData(databaseName, now, windowMinutes);
        case "sqlServer":
            return buildSqlServerData(databaseName, now, windowMinutes);
    }
}

function buildAzureSqlData(databaseName: string, now: number, windowMinutes: number): PlatformData {
    return {
        server: {
            engineVersion: "SQL Database 12.0",
            edition: "Azure SQL Database",
            serviceTier: "General Purpose, Gen5",
            region: "East US 2",
            compute: "8 vCores",
            availability: "Zone redundant",
            storageUsedGb: 186,
            storageMaxGb: 512,
        },
        metrics: [
            metric(
                "azure-cpu",
                "cpu",
                68.4,
                "percent",
                8.2,
                "warning",
                now,
                windowMinutes,
                [42, 45, 47, 51, 49, 56, 61, 58, 64, 71, 66, 68.4],
            ),
            metric(
                "azure-data-io",
                "dataIo",
                54.2,
                "percent",
                4.1,
                "healthy",
                now,
                windowMinutes,
                [31, 34, 38, 42, 40, 44, 48, 46, 51, 49, 53, 54.2],
            ),
            metric(
                "azure-log-io",
                "logIo",
                37.8,
                "percent",
                -2.4,
                "healthy",
                now,
                windowMinutes,
                [48, 46, 44, 45, 42, 40, 39, 41, 38, 36, 39, 37.8],
            ),
            metric(
                "azure-sessions",
                "sessions",
                143,
                "count",
                6.7,
                "healthy",
                now,
                windowMinutes,
                [92, 101, 109, 117, 111, 126, 131, 128, 137, 141, 139, 143],
            ),
            metric(
                "azure-workers",
                "workers",
                62,
                "percent",
                3.3,
                "healthy",
                now,
                windowMinutes,
                [44, 47, 51, 48, 52, 55, 57, 54, 59, 61, 60, 62],
            ),
            metric(
                "azure-storage",
                "storage",
                186,
                "gigabytes",
                1.8,
                "healthy",
                now,
                windowMinutes,
                [178, 179, 180, 181, 181, 182, 183, 183, 184, 185, 185, 186],
            ),
        ],
        queries: buildQueries(databaseName, now, 1),
        waits: [
            wait("PAGEIOLATCH_SH", "io", 184_200, 34, 1264, "regressing"),
            wait("WRITELOG", "log", 129_800, 24, 842, "stable"),
            wait("SOS_SCHEDULER_YIELD", "cpu", 91_400, 17, 2141, "regressing"),
            wait("LCK_M_X", "lock", 75_100, 14, 328, "stable"),
            wait("CXPACKET", "parallelism", 59_500, 11, 912, "improving"),
        ],
        sessions: buildSessions(databaseName),
        dbAgent: buildDbAgent(databaseName, now, [
            ["azure-high-cpu", "highCpu", "warning", "actionReady", "68.4%"],
            ["azure-blocking", "blockingChain", "critical", "investigating", "47 sec"],
            ["azure-storage", "storageGrowth", "watch", "monitoring", "12.8 GB/day"],
        ]),
    };
}

function buildSqlServerData(
    databaseName: string,
    now: number,
    windowMinutes: number,
): PlatformData {
    return {
        server: {
            engineVersion: "SQL Server 2025 (17.x)",
            edition: "Enterprise Edition",
            serviceTier: "Always On availability group",
            region: "On-premises / Seattle",
            compute: "32 cores, 256 GB memory",
            availability: "Synchronous replica",
            storageUsedGb: 742,
            storageMaxGb: 2048,
        },
        metrics: [
            metric(
                "sql-cpu",
                "cpu",
                41.6,
                "percent",
                -3.1,
                "healthy",
                now,
                windowMinutes,
                [55, 52, 48, 50, 46, 43, 45, 42, 44, 40, 43, 41.6],
            ),
            metric(
                "sql-batches",
                "batchRequests",
                2840,
                "perSecond",
                12.4,
                "healthy",
                now,
                windowMinutes,
                [1880, 2010, 2140, 2280, 2190, 2370, 2510, 2460, 2630, 2750, 2790, 2840],
            ),
            metric(
                "sql-cache",
                "bufferCache",
                98.7,
                "percent",
                0.2,
                "healthy",
                now,
                windowMinutes,
                [98.2, 98.4, 98.3, 98.5, 98.6, 98.5, 98.7, 98.8, 98.6, 98.7, 98.8, 98.7],
            ),
            metric(
                "sql-ple",
                "pageLifeExpectancy",
                4820,
                "seconds",
                -4.6,
                "healthy",
                now,
                windowMinutes,
                [5300, 5210, 5150, 5080, 4990, 4930, 5010, 4920, 4870, 4790, 4850, 4820],
            ),
            metric(
                "sql-sessions",
                "sessions",
                217,
                "count",
                2.9,
                "healthy",
                now,
                windowMinutes,
                [181, 188, 194, 201, 198, 204, 209, 205, 211, 214, 215, 217],
            ),
            metric(
                "sql-storage",
                "storage",
                742,
                "gigabytes",
                0.8,
                "healthy",
                now,
                windowMinutes,
                [736, 736, 737, 738, 738, 739, 739, 740, 740, 741, 741, 742],
            ),
        ],
        queries: buildQueries(databaseName, now, 2),
        waits: [
            wait("CXCONSUMER", "parallelism", 221_400, 31, 3871, "stable"),
            wait("PAGEIOLATCH_SH", "io", 178_600, 25, 1560, "improving"),
            wait("WRITELOG", "log", 128_100, 18, 1148, "stable"),
            wait("LCK_M_S", "lock", 99_900, 14, 442, "regressing"),
            wait("ASYNC_NETWORK_IO", "network", 85_700, 12, 951, "stable"),
        ],
        sessions: buildSessions(databaseName, 70),
        dbAgent: buildDbAgent(databaseName, now, [
            ["sql-query", "queryRegression", "warning", "actionReady", "+46% duration"],
            ["sql-blocking", "blockingChain", "critical", "investigating", "session 87"],
            ["sql-storage", "storageGrowth", "watch", "monitoring", "6.1 GB/day"],
        ]),
    };
}

function buildFabricSqlData(
    databaseName: string,
    now: number,
    windowMinutes: number,
): PlatformData {
    return {
        server: {
            engineVersion: "Fabric SQL analytics endpoint",
            edition: "Fabric Warehouse",
            serviceTier: "F64 capacity",
            region: "West Europe",
            compute: "Shared Fabric capacity",
            availability: "Microsoft managed",
            storageUsedGb: 1280,
            storageMaxGb: 4096,
        },
        metrics: [
            metric(
                "fabric-capacity",
                "capacity",
                78.3,
                "percent",
                14.8,
                "warning",
                now,
                windowMinutes,
                [39, 42, 45, 51, 56, 54, 61, 67, 72, 75, 81, 78.3],
            ),
            metric(
                "fabric-duration",
                "queryDuration",
                1840,
                "milliseconds",
                22.1,
                "warning",
                now,
                windowMinutes,
                [920, 970, 1040, 1110, 1230, 1190, 1380, 1460, 1580, 1710, 1910, 1840],
            ),
            metric(
                "fabric-cpu",
                "cpu",
                72.5,
                "percent",
                10.2,
                "warning",
                now,
                windowMinutes,
                [41, 45, 49, 52, 57, 55, 61, 64, 68, 74, 76, 72.5],
            ),
            metric(
                "fabric-sessions",
                "sessions",
                84,
                "count",
                8.4,
                "healthy",
                now,
                windowMinutes,
                [48, 52, 57, 61, 59, 66, 69, 72, 75, 79, 82, 84],
            ),
            metric(
                "fabric-data-io",
                "dataIo",
                64.1,
                "percent",
                5.8,
                "healthy",
                now,
                windowMinutes,
                [37, 41, 45, 44, 49, 53, 51, 56, 59, 61, 63, 64.1],
            ),
            metric(
                "fabric-storage",
                "storage",
                1280,
                "gigabytes",
                3.2,
                "healthy",
                now,
                windowMinutes,
                [1212, 1218, 1226, 1231, 1238, 1244, 1250, 1257, 1263, 1269, 1274, 1280],
            ),
        ],
        queries: buildQueries(databaseName, now, 3),
        waits: [
            wait("RESOURCE_GOVERNOR_IDLE", "cpu", 284_300, 36, 1840, "regressing"),
            wait("PAGEIOLATCH_SH", "io", 197_500, 25, 1288, "regressing"),
            wait("CXPACKET", "parallelism", 142_200, 18, 2207, "stable"),
            wait("ASYNC_NETWORK_IO", "network", 102_600, 13, 674, "stable"),
            wait("WRITELOG", "log", 63_200, 8, 390, "improving"),
        ],
        sessions: buildSessions(databaseName, 120),
        dbAgent: buildDbAgent(databaseName, now, [
            ["fabric-capacity", "capacityPressure", "critical", "investigating", "78.3% CU"],
            ["fabric-query", "queryRegression", "warning", "actionReady", "+61% duration"],
            ["fabric-storage", "storageGrowth", "watch", "monitoring", "41 GB/day"],
        ]),
    };
}

function metric(
    id: string,
    kind: DashboardMetric["kind"],
    value: number,
    unit: DashboardMetric["unit"],
    changePercent: number,
    status: DashboardMetric["status"],
    now: number,
    windowMinutes: number,
    values: number[],
): DashboardMetric {
    return {
        id,
        kind,
        value,
        unit,
        changePercent,
        status,
        points: points(values, now, windowMinutes),
    };
}

function points(values: number[], now: number, windowMinutes: number): DashboardMetricPoint[] {
    const intervalMs = (windowMinutes * 60_000) / Math.max(values.length - 1, 1);
    return values.map((value, index) => ({
        timestamp: new Date(now - (values.length - 1 - index) * intervalMs).toISOString(),
        value,
    }));
}

function buildQueries(databaseName: string, now: number, variant: number): DashboardQuery[] {
    const multiplier = 1 + variant * 0.12;
    return [
        query(
            "q-1001",
            "SELECT p.ProductID, p.Name, SUM(s.OrderQty) AS UnitsSold FROM Sales.SalesOrderDetail s JOIN Production.Product p ON p.ProductID = s.ProductID GROUP BY p.ProductID, p.Name ORDER BY UnitsSold DESC;",
            databaseName,
            1834,
            842 * multiplier,
            612,
            184_200,
            "regressing",
            now - 42_000,
        ),
        query(
            "q-1002",
            "EXEC dbo.usp_ProcessPendingOrders @BatchSize = 500;",
            databaseName,
            642,
            1240 * multiplier,
            918,
            92_400,
            "stable",
            now - 67_000,
        ),
        query(
            "q-1003",
            "SELECT c.CustomerID, COUNT_BIG(*) FROM Sales.Customer c JOIN Sales.SalesOrderHeader h ON h.CustomerID = c.CustomerID WHERE h.OrderDate >= DATEADD(day, -30, SYSUTCDATETIME()) GROUP BY c.CustomerID;",
            databaseName,
            2981,
            394 * multiplier,
            287,
            76_100,
            "improving",
            now - 81_000,
        ),
        query(
            "q-1004",
            "UPDATE Inventory.Stock SET Quantity = Quantity - @Quantity WHERE ProductID = @ProductID AND WarehouseID = @WarehouseID;",
            databaseName,
            8274,
            128 * multiplier,
            91,
            18_700,
            "stable",
            now - 96_000,
        ),
        query(
            "q-1005",
            "SELECT TOP (100) * FROM Analytics.DailySalesSummary WHERE RegionID = @RegionID ORDER BY SalesDate DESC;",
            databaseName,
            4589,
            216 * multiplier,
            164,
            32_800,
            "stable",
            now - 112_000,
        ),
    ];
}

function query(
    queryId: string,
    queryText: string,
    databaseName: string,
    executions: number,
    averageDurationMs: number,
    cpuMs: number,
    logicalReads: number,
    trend: DashboardQuery["trend"],
    lastExecutionTime: number,
): DashboardQuery {
    return {
        queryId,
        queryText,
        databaseName,
        executions,
        averageDurationMs: round(averageDurationMs),
        totalDurationMs: round(averageDurationMs * executions),
        cpuMs,
        logicalReads,
        trend,
        lastExecutionTime: new Date(lastExecutionTime).toISOString(),
    };
}

function wait(
    waitType: string,
    category: DashboardWait["category"],
    waitTimeMs: number,
    percentage: number,
    waitingTasks: number,
    trend: DashboardWait["trend"],
): DashboardWait {
    return { waitType, category, waitTimeMs, percentage, waitingTasks, trend };
}

function buildSessions(databaseName: string, offset = 0): DashboardSession[] {
    return [
        session(
            71 + offset,
            "app-orders",
            databaseName,
            "Contoso Orders API",
            "running",
            14820,
            18430,
            "SELECT p.ProductID, p.Name, SUM(s.OrderQty) FROM Sales.SalesOrderDetail s JOIN Production.Product p ON p.ProductID = s.ProductID GROUP BY p.ProductID, p.Name;",
            undefined,
            "SOS_SCHEDULER_YIELD",
        ),
        session(
            87 + offset,
            "etl-service",
            databaseName,
            "Nightly warehouse load",
            "suspended",
            9270,
            47120,
            "MERGE Analytics.DailySalesSummary AS target USING #DailySales AS source ON target.SalesDate = source.SalesDate WHEN MATCHED THEN UPDATE SET TotalSales = source.TotalSales;",
            94 + offset,
            "LCK_M_X",
        ),
        session(
            94 + offset,
            "reporting",
            databaseName,
            "Power BI",
            "running",
            6340,
            22810,
            "SELECT RegionID, ProductCategoryID, SUM(NetAmount) FROM Analytics.FactSales GROUP BY RegionID, ProductCategoryID;",
        ),
        session(
            105 + offset,
            "inventory-api",
            databaseName,
            "Inventory API",
            "sleeping",
            412,
            880,
            "UPDATE Inventory.Stock SET Quantity = Quantity - @Quantity WHERE ProductID = @ProductID;",
        ),
        session(
            118 + offset,
            "data-science",
            databaseName,
            "VS Code MSSQL",
            "running",
            3810,
            7240,
            "SELECT TOP (1000) * FROM Analytics.CustomerFeatures ORDER BY UpdatedAt DESC;",
            undefined,
            "PAGEIOLATCH_SH",
        ),
    ];
}

function session(
    sessionId: number,
    loginName: string,
    databaseName: string,
    applicationName: string,
    status: DashboardSession["status"],
    cpuMs: number,
    elapsedTimeMs: number,
    queryText: string,
    blockingSessionId?: number,
    waitType?: string,
): DashboardSession {
    return {
        sessionId,
        loginName,
        databaseName,
        applicationName,
        status,
        cpuMs,
        elapsedTimeMs,
        queryText,
        blockingSessionId,
        waitType,
    };
}

type IssueSeed = readonly [
    id: string,
    kind: DbAgentIssue["kind"],
    severity: DbAgentIssue["severity"],
    status: DbAgentIssue["status"],
    metricValue: string,
];

function buildDbAgent(
    databaseName: string,
    now: number,
    issueSeeds: readonly IssueSeed[],
): DbAgentDashboard {
    const issues = issueSeeds.map(([issueId, kind, severity, status, metricValue], index) => ({
        issueId,
        kind,
        severity,
        status,
        detectedAt: new Date(now - (index + 1) * 11 * 60_000).toISOString(),
        updatedAt: new Date(now - index * 4 * 60_000).toISOString(),
        metricValue,
        affectedDatabase: databaseName,
    }));

    return {
        enabled: true,
        registrationMode: "registered",
        health: issues.some((issue) => issue.severity === "critical") ? "warning" : "healthy",
        automationLevel: "approvalRequired",
        lastAnalysisAt: new Date(now - 90_000).toISOString(),
        issues,
        activeInvestigation: {
            investigationId: `investigation-${issueSeeds[0][0]}`,
            issueId: issueSeeds[0][0],
            status: "active",
            startedAt: new Date(now - 14 * 60_000).toISOString(),
            events: [
                {
                    id: "event-detected",
                    kind: "detected",
                    timestamp: new Date(now - 14 * 60_000).toISOString(),
                },
                {
                    id: "event-correlated",
                    kind: "correlated",
                    timestamp: new Date(now - 11 * 60_000).toISOString(),
                },
                {
                    id: "event-diagnosed",
                    kind: "diagnosed",
                    timestamp: new Date(now - 7 * 60_000).toISOString(),
                },
                {
                    id: "event-recommended",
                    kind: "recommended",
                    timestamp: new Date(now - 3 * 60_000).toISOString(),
                },
            ],
        },
    };
}

function round(value: number): number {
    return Math.round(value * 10) / 10;
}

function clone<T>(value: T): T {
    return structuredClone(value);
}
