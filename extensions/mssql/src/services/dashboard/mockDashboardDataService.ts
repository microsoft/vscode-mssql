/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DashboardMetric,
    DashboardMetricPoint,
    DashboardOperationalSummary,
    DashboardPlatform,
    DashboardQuery,
    DashboardServerDetails,
    DashboardSession,
    DashboardSnapshot,
    DashboardTarget,
    DashboardWait,
    DbAgentAnalyzableSection,
    DbAgentDashboard,
    DbAgentIssue,
    DbAgentIssueAction,
    DbAgentIssueKind,
    DbAgentSettings,
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
        const snapshot = await this.getMutableSnapshot(target);
        const issue = findIssue(snapshot, issueId);
        const acknowledgedAt = new Date().toISOString();
        issue.status = "monitoring";
        issue.updatedAt = acknowledgedAt;
        appendIssueEvent(issue, "acknowledged", "Issue acknowledged and moved to monitoring.");
        if (
            snapshot.dbAgent.activeInvestigation?.issueIds.includes(issueId) &&
            snapshot.dbAgent.activeInvestigation.status !== "monitoring"
        ) {
            snapshot.dbAgent.activeInvestigation = {
                ...snapshot.dbAgent.activeInvestigation,
                status: "monitoring",
                updatedAt: acknowledgedAt,
                events: [
                    ...snapshot.dbAgent.activeInvestigation.events,
                    {
                        id: `event-monitoring-${issueId}`,
                        kind: "monitoring",
                        timestamp: acknowledgedAt,
                        title: "Monitoring started",
                        detail: "The issue was acknowledged. The agent is validating recovery.",
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
        const snapshot = await this.getMutableSnapshot(target);
        snapshot.dbAgent.enabled = enabled;
        snapshot.dbAgent.registrationMode = enabled ? "registered" : "notRegistered";
        snapshot.dbAgent.settings.enabled = enabled;
        this._snapshots.set(target.id, snapshot);
        return clone(snapshot);
    }

    public async registerDbAgent(target: DashboardTarget): Promise<DashboardSnapshot> {
        const snapshot = await this.getMutableSnapshot(target);
        snapshot.dbAgent.enabled = true;
        snapshot.dbAgent.settings.enabled = true;
        snapshot.dbAgent.registrationMode = "registered";
        snapshot.dbAgent.registrationStep = undefined;
        snapshot.dbAgent.surfaceStatus = "ready";
        snapshot.dbAgent.errorMessage = undefined;
        this._snapshots.set(target.id, snapshot);
        return clone(snapshot);
    }

    public async decideDbAgentAction(
        target: DashboardTarget,
        issueId: string,
        actionId: string,
        decision: "approve" | "reject",
    ): Promise<DashboardSnapshot> {
        const snapshot = await this.getMutableSnapshot(target);
        const issue = findIssue(snapshot, issueId);
        const action = findAction(issue, actionId);
        action.approvalStatus = decision === "approve" ? "approved" : "rejected";
        issue.status = decision === "approve" ? "actionProposed" : "diagnosed";
        issue.updatedAt = new Date().toISOString();
        appendIssueEvent(
            issue,
            decision === "approve" ? "actionApproved" : "actionRejected",
            decision === "approve"
                ? `Approved recommendation: ${action.title}.`
                : `Rejected recommendation: ${action.title}.`,
        );
        this._snapshots.set(target.id, snapshot);
        return clone(snapshot);
    }

    public async executeDbAgentAction(
        target: DashboardTarget,
        issueId: string,
        actionId: string,
    ): Promise<DashboardSnapshot> {
        const snapshot = await this.getMutableSnapshot(target);
        const issue = findIssue(snapshot, issueId);
        const action = findAction(issue, actionId);
        if (action.approvalStatus !== "approved") {
            throw new Error(`Dashboard action '${actionId}' must be approved before execution.`);
        }

        applyAction(issue, action, "executed", "Database Agent", "Validation checks passed.");
        issue.status = "verifying";
        appendIssueEvent(issue, "actionExecuted", `Executed recommendation: ${action.title}.`);
        appendInvestigationAction(snapshot, issueId, action.title);
        this._snapshots.set(target.id, snapshot);
        return clone(snapshot);
    }

    public async markDbAgentActionApplied(
        target: DashboardTarget,
        issueId: string,
        actionId: string,
    ): Promise<DashboardSnapshot> {
        const snapshot = await this.getMutableSnapshot(target);
        const issue = findIssue(snapshot, issueId);
        const action = findAction(issue, actionId);
        applyAction(
            issue,
            action,
            "manuallyApplied",
            "Current user",
            "Manual application recorded; monitoring has started.",
        );
        issue.status = "monitoring";
        appendIssueEvent(issue, "actionExecuted", `Recorded manual application: ${action.title}.`);
        appendInvestigationAction(snapshot, issueId, action.title);
        this._snapshots.set(target.id, snapshot);
        return clone(snapshot);
    }

    public async analyzeDbAgentSection(
        target: DashboardTarget,
        issueId: string,
        section: DbAgentAnalyzableSection,
    ): Promise<DashboardSnapshot> {
        const snapshot = await this.getMutableSnapshot(target);
        const issue = findIssue(snapshot, issueId);
        issue.analysisNotes[section] = getAnalysisNote(issue, section);
        issue.updatedAt = new Date().toISOString();
        this._snapshots.set(target.id, snapshot);
        return clone(snapshot);
    }

    public async forceResolveInvestigation(
        target: DashboardTarget,
        investigationId: string,
        reason?: string,
    ): Promise<DashboardSnapshot> {
        const snapshot = await this.getMutableSnapshot(target);
        const investigation = snapshot.dbAgent.activeInvestigation;
        if (!investigation || investigation.investigationId !== investigationId) {
            throw new Error(`Dashboard investigation '${investigationId}' was not found.`);
        }

        const resolvedAt = new Date().toISOString();
        investigation.status = "resolved";
        investigation.updatedAt = resolvedAt;
        investigation.resolvedAt = resolvedAt;
        investigation.events.push({
            id: `event-resolved-${investigationId}`,
            kind: "resolved",
            timestamp: resolvedAt,
            title: "Investigation resolved",
            detail: reason?.trim() || "Marked resolved after operator review.",
        });
        for (const issueId of investigation.issueIds) {
            const issue = findIssue(snapshot, issueId);
            issue.status = "resolved";
            issue.updatedAt = resolvedAt;
            appendIssueEvent(issue, "resolved", "Resolved with the active investigation.");
        }
        snapshot.dbAgent.investigations = [
            clone(investigation),
            ...snapshot.dbAgent.investigations.filter(
                (candidate) => candidate.investigationId !== investigationId,
            ),
        ];
        snapshot.dbAgent.activeInvestigation = undefined;
        this._snapshots.set(target.id, snapshot);
        return clone(snapshot);
    }

    public async saveDbAgentSettings(
        target: DashboardTarget,
        settings: DbAgentSettings,
    ): Promise<DashboardSnapshot> {
        const snapshot = await this.getMutableSnapshot(target);
        snapshot.dbAgent.settings = clone(settings);
        snapshot.dbAgent.enabled = settings.enabled;
        this._snapshots.set(target.id, snapshot);
        return clone(snapshot);
    }

    public async createDbAgentInstruction(
        target: DashboardTarget,
        text: string,
    ): Promise<DashboardSnapshot> {
        const normalizedText = text.trim();
        if (!normalizedText) {
            throw new Error("A custom instruction cannot be empty.");
        }

        const snapshot = await this.getMutableSnapshot(target);
        const createdAt = new Date().toISOString();
        snapshot.dbAgent.instructions = [
            {
                instructionId: `instruction-${createdAt}`,
                text: normalizedText,
                createdBy: "Current user",
                createdAt,
            },
            ...snapshot.dbAgent.instructions,
        ];
        this._snapshots.set(target.id, snapshot);
        return clone(snapshot);
    }

    public async revokeDbAgentInstruction(
        target: DashboardTarget,
        instructionId: string,
    ): Promise<DashboardSnapshot> {
        const snapshot = await this.getMutableSnapshot(target);
        if (
            !snapshot.dbAgent.instructions.some(
                (instruction) => instruction.instructionId === instructionId,
            )
        ) {
            throw new Error(`Dashboard instruction '${instructionId}' was not found.`);
        }

        snapshot.dbAgent.instructions = snapshot.dbAgent.instructions.filter(
            (instruction) => instruction.instructionId !== instructionId,
        );
        this._snapshots.set(target.id, snapshot);
        return clone(snapshot);
    }

    private async getMutableSnapshot(target: DashboardTarget): Promise<DashboardSnapshot> {
        return clone(this._snapshots.get(target.id)) ?? (await this.loadDashboard(target));
    }
}

function mergeDbAgentState(
    snapshot: DashboardSnapshot,
    previous: DashboardSnapshot | undefined,
): void {
    if (!previous) {
        return;
    }

    snapshot.dbAgent = clone(previous.dbAgent);
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
        operations: buildOperationalSummary(target.platform, target.databaseName, now),
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

function buildOperationalSummary(
    platform: DashboardPlatform,
    databaseName: string,
    now: number,
): DashboardOperationalSummary {
    const commonActivity: DashboardOperationalSummary["activity"] = [
        {
            id: `${platform}-activity-plan`,
            timestamp: new Date(now - 24 * 60_000).toISOString(),
            title: "Query Store plan changed",
            detail: "A new plan became active for a high-volume query.",
            status: "warning",
        },
        {
            id: `${platform}-activity-agent`,
            timestamp: new Date(now - 51 * 60_000).toISOString(),
            title: "Database Agent analysis completed",
            detail: "Telemetry correlation completed with three prioritized findings.",
            status: "healthy",
        },
        {
            id: `${platform}-activity-login`,
            timestamp: new Date(now - 86 * 60_000).toISOString(),
            title: "Administrative connection",
            detail: "A connection was opened from VS Code MSSQL.",
            status: "healthy",
        },
    ];
    const commonConfiguration: DashboardOperationalSummary["configuration"] = [
        {
            id: `${platform}-config-compatibility`,
            name: "Compatibility level",
            value: platform === "fabricSql" ? "Fabric managed" : "170",
            source: "Database",
        },
        {
            id: `${platform}-config-query-store`,
            name: "Query Store",
            value: "Read write",
            source: "Database",
        },
        {
            id: `${platform}-config-maxdop`,
            name: "MAXDOP",
            value: platform === "fabricSql" ? "Managed" : "8",
            source: platform === "sqlServer" ? "Server" : "Database scoped",
        },
        {
            id: `${platform}-config-auto-tuning`,
            name: "Automatic tuning",
            value: platform === "sqlServer" ? "Force last good plan" : "Microsoft managed",
            source: "Database",
        },
    ];

    switch (platform) {
        case "azureSql":
            return {
                readiness: [
                    readiness(
                        "azure-connectivity",
                        "Connectivity",
                        "All connection probes passed.",
                    ),
                    readiness(
                        "azure-redundancy",
                        "Zone redundancy",
                        "Synchronous replicas are healthy.",
                    ),
                    readiness(
                        "azure-backup",
                        "Point-in-time restore",
                        "Recovery points are current.",
                    ),
                ],
                topology: [
                    topology(
                        "azure-primary",
                        databaseName,
                        "Primary database",
                        "East US 2 / zone 1",
                        "Read-write endpoint",
                    ),
                    topology(
                        "azure-zone-replica",
                        "Zone replica",
                        "Synchronous replica",
                        "East US 2 / zone 2",
                        "Microsoft managed",
                    ),
                    topology(
                        "azure-geo-secondary",
                        `${databaseName}-dr`,
                        "Geo-secondary",
                        "Central US",
                        "Readable disaster recovery replica",
                        "warning",
                    ),
                ],
                network: {
                    connectionPolicy: "Redirect",
                    publicNetworkAccess: "Selected networks",
                    privateEndpoint: "pe-contoso-prod-sql",
                    minimumTlsVersion: "1.2",
                    firewallRuleCount: 4,
                },
                configuration: commonConfiguration,
                backups: [
                    backup(
                        "azure-pitr",
                        "continuous",
                        now - 4 * 60_000,
                        "35 days",
                        now - 3 * 60_000,
                    ),
                    backup(
                        "azure-ltr",
                        "full",
                        now - 20 * 60 * 60_000,
                        "12 months",
                        now - 20 * 60 * 60_000,
                    ),
                ],
                activity: commonActivity,
            };
        case "sqlServer":
            return {
                readiness: [
                    readiness("sql-connectivity", "Connectivity", "Listener probes passed."),
                    readiness(
                        "sql-ag",
                        "Availability group",
                        "Primary and synchronous secondary are synchronized.",
                    ),
                    readiness(
                        "sql-log-backup",
                        "Log backup",
                        "The latest log backup is approaching the 15-minute objective.",
                        "warning",
                    ),
                ],
                topology: [
                    topology(
                        "sql-primary",
                        "sql2025-prod-01",
                        "Primary replica",
                        "Seattle datacenter",
                        "Synchronous commit",
                    ),
                    topology(
                        "sql-secondary",
                        "sql2025-prod-02",
                        "Secondary replica",
                        "Seattle datacenter",
                        "Synchronized / readable",
                    ),
                    topology(
                        "sql-dr",
                        "sql2025-dr-01",
                        "Disaster recovery replica",
                        "Quincy datacenter",
                        "Asynchronous commit",
                        "warning",
                    ),
                ],
                network: {
                    connectionPolicy: "Availability group listener",
                    publicNetworkAccess: "Disabled",
                    privateEndpoint: "10.40.8.24 / port 1433",
                    minimumTlsVersion: "1.2",
                    firewallRuleCount: 6,
                },
                configuration: commonConfiguration,
                backups: [
                    backup(
                        "sql-full",
                        "full",
                        now - 8 * 60 * 60_000,
                        "28 days",
                        now - 8 * 60 * 60_000,
                    ),
                    backup(
                        "sql-log",
                        "log",
                        now - 13 * 60_000,
                        "7 days",
                        now - 13 * 60_000,
                        "warning",
                    ),
                ],
                activity: [
                    {
                        id: "sql-activity-failover",
                        timestamp: new Date(now - 3 * 60 * 60_000).toISOString(),
                        title: "Availability replica validated",
                        detail: "The automatic failover readiness check passed.",
                        status: "healthy",
                    },
                    ...commonActivity,
                ],
            };
        case "fabricSql":
            return {
                readiness: [
                    readiness(
                        "fabric-endpoint",
                        "SQL endpoint",
                        "The analytics endpoint is online.",
                    ),
                    readiness(
                        "fabric-onelake",
                        "OneLake synchronization",
                        "The latest table changes are available.",
                    ),
                    readiness(
                        "fabric-capacity",
                        "Capacity headroom",
                        "Current utilization is above the recommended interactive threshold.",
                        "warning",
                    ),
                ],
                topology: [
                    topology(
                        "fabric-endpoint",
                        databaseName,
                        "SQL analytics endpoint",
                        "West Europe",
                        "Read-only T-SQL surface",
                    ),
                    topology(
                        "fabric-warehouse",
                        "retail_warehouse",
                        "Fabric Warehouse",
                        "Contoso Retail Workspace",
                        "OneLake-backed storage",
                    ),
                    topology(
                        "fabric-capacity",
                        "Contoso F64",
                        "Fabric capacity",
                        "West Europe",
                        "78% current utilization",
                        "warning",
                    ),
                ],
                network: {
                    connectionPolicy: "Fabric gateway",
                    publicNetworkAccess: "Tenant policy",
                    privateEndpoint: "Workspace managed private endpoint",
                    minimumTlsVersion: "1.2",
                    firewallRuleCount: 2,
                },
                configuration: commonConfiguration,
                backups: [
                    backup(
                        "fabric-snapshot",
                        "continuous",
                        now - 7 * 60_000,
                        "Microsoft managed",
                        now - 5 * 60_000,
                    ),
                ],
                activity: [
                    {
                        id: "fabric-activity-refresh",
                        timestamp: new Date(now - 14 * 60_000).toISOString(),
                        title: "OneLake table refresh completed",
                        detail: "Retail sales partitions synchronized successfully.",
                        status: "healthy",
                    },
                    ...commonActivity,
                ],
            };
    }
}

function readiness(
    id: string,
    title: string,
    detail: string,
    status: DashboardOperationalSummary["readiness"][number]["status"] = "healthy",
): DashboardOperationalSummary["readiness"][number] {
    return { id, title, detail, status };
}

function topology(
    id: string,
    name: string,
    role: string,
    location: string,
    detail: string,
    status: DashboardOperationalSummary["topology"][number]["status"] = "healthy",
): DashboardOperationalSummary["topology"][number] {
    return { id, name, role, location, detail, status };
}

function backup(
    id: string,
    backupType: DashboardOperationalSummary["backups"][number]["backupType"],
    completedAt: number,
    retention: string,
    recoverableThrough: number,
    status: DashboardOperationalSummary["backups"][number]["status"] = "healthy",
): DashboardOperationalSummary["backups"][number] {
    return {
        id,
        backupType,
        completedAt: new Date(completedAt).toISOString(),
        retention,
        recoverableThrough: new Date(recoverableThrough).toISOString(),
        status,
    };
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
            ["azure-high-cpu", "highCpu", "warning", "actionProposed", "68.4%"],
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
            ["sql-query", "queryRegression", "warning", "actionProposed", "+46% duration"],
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
        dbAgent: buildDbAgent(
            databaseName,
            now,
            [
                ["fabric-capacity", "capacityPressure", "critical", "investigating", "78.3% CU"],
                ["fabric-query", "queryRegression", "warning", "actionProposed", "+61% duration"],
                ["fabric-storage", "storageGrowth", "watch", "monitoring", "41 GB/day"],
            ],
            "notRegistered",
        ),
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
    registrationMode: DbAgentDashboard["registrationMode"] = "registered",
): DbAgentDashboard {
    const targetPrefix = issueSeeds[0][0].split("-")[0];
    const allSeeds: readonly IssueSeed[] = [
        ...issueSeeds,
        [`${targetPrefix}-resolved-workload`, "highCpu", "watch", "resolved", "34% peak CPU"],
        [`${targetPrefix}-closed-maintenance`, "storageGrowth", "watch", "closed", "2.1 GB/day"],
    ];
    const issues = allSeeds.map((seed, index) =>
        buildIssue(databaseName, now, seed, index, allSeeds),
    );
    const activeInvestigation = buildActiveInvestigation(now, issues);
    const investigationHistory = buildInvestigationHistory(now, issues);

    return {
        enabled: registrationMode === "registered",
        surfaceStatus: "ready",
        registrationMode,
        health: issues.some((issue) => issue.severity === "critical") ? "warning" : "healthy",
        automationLevel: "approvalRequired",
        lastAnalysisAt: new Date(now - 90_000).toISOString(),
        lastSuccessfulRunAt: new Date(now - 2 * 60_000).toISOString(),
        issues,
        activeInvestigation,
        investigations: investigationHistory,
        settings: {
            enabled: registrationMode === "registered",
            notifyOnResolve: true,
            notifyOnFailure: true,
            currentRole: "admin",
            approvingAdmin: "sql-platform-admins@contoso.com",
            actionCategories: [
                { category: "performance", enabled: true, approvalRequired: true },
                { category: "availability", enabled: true, approvalRequired: true },
                { category: "storage", enabled: true, approvalRequired: false },
                { category: "security", enabled: false, approvalRequired: true },
            ],
        },
        instructions: [
            {
                instructionId: `${targetPrefix}-instruction-business-hours`,
                text: "Do not terminate sessions owned by the month-end reporting workload.",
                createdBy: "Adele Vance",
                createdAt: new Date(now - 9 * 24 * 60 * 60_000).toISOString(),
            },
            {
                instructionId: `${targetPrefix}-instruction-capacity`,
                text: "Prefer query tuning before recommending a compute scale-up.",
                createdBy: "Diego Siciliani",
                createdAt: new Date(now - 4 * 24 * 60 * 60_000).toISOString(),
            },
        ],
    };
}

interface IssueProfile {
    category: DbAgentIssue["category"];
    title: string;
    summary: string;
    diagnosis: string;
    actionTitle: string;
    actionType: string;
    executionVenue: DbAgentIssueAction["executionVenue"];
    risk: DbAgentIssueAction["risk"];
    reasoning: string;
    expectedOutcome: string;
    rollbackPlan: string;
    parameters: DbAgentIssueAction["parameters"];
}

const issueProfiles: Record<DbAgentIssueKind, IssueProfile> = {
    blockingChain: {
        category: "performance",
        title: "Long-running blocking chain",
        summary:
            "A write transaction is blocking order processing sessions and increasing request latency.",
        diagnosis:
            "Session 94 holds an exclusive lock after a warehouse aggregation exceeded its normal execution window.",
        actionTitle: "Terminate the head blocker",
        actionType: "terminateSession",
        executionVenue: "client",
        risk: "high",
        reasoning:
            "The head blocker is an idempotent reporting transaction and has no uncommitted business writes.",
        expectedOutcome: "Release 18 blocked sessions and restore write latency below 250 ms.",
        rollbackPlan: "The reporting job will retry automatically on its next scheduled interval.",
        parameters: { sessionId: 94, includeDescendants: false },
    },
    capacityPressure: {
        category: "availability",
        title: "Fabric capacity pressure",
        summary:
            "Interactive SQL workloads are consuming sustained capacity and delaying scheduled ingestion.",
        diagnosis:
            "Three concurrent semantic model refreshes overlap with the retail aggregation workload.",
        actionTitle: "Pause low-priority refresh",
        actionType: "pauseFabricWorkload",
        executionVenue: "runner",
        risk: "medium",
        reasoning:
            "Deferring the development model refresh frees enough capacity without affecting production reports.",
        expectedOutcome: "Reduce capacity utilization below 65% within five minutes.",
        rollbackPlan: "Resume the paused refresh after the retail aggregation completes.",
        parameters: { workload: "Retail Dev semantic model", durationMinutes: 20 },
    },
    highCpu: {
        category: "performance",
        title: "Sustained CPU saturation",
        summary:
            "CPU utilization is above the learned baseline during the highest-volume API interval.",
        diagnosis:
            "A recently changed product-ranking query is compiling an inefficient parallel plan.",
        actionTitle: "Force the last known good plan",
        actionType: "forceQueryStorePlan",
        executionVenue: "client",
        risk: "medium",
        reasoning:
            "The prior Query Store plan used 43% less CPU across the same parameter distribution.",
        expectedOutcome: "Lower CPU below 50% and improve p95 query duration by approximately 35%.",
        rollbackPlan:
            "Unforce the plan in Query Store if validation detects a duration regression.",
        parameters: { queryId: 1001, planId: 3814, validateMinutes: 10 },
    },
    queryRegression: {
        category: "performance",
        title: "Query performance regression",
        summary: "A high-volume query is slower than its seven-day baseline after a plan change.",
        diagnosis:
            "The current plan scans the sales detail index instead of using the selective date predicate.",
        actionTitle: "Apply Query Store plan correction",
        actionType: "forceQueryStorePlan",
        executionVenue: "client",
        risk: "medium",
        reasoning:
            "The recommended plan is proven across 8,200 executions with consistent parameter shapes.",
        expectedOutcome: "Return average duration to 540 ms without increasing logical reads.",
        rollbackPlan: "Unforce the plan and restore automatic plan selection.",
        parameters: { queryId: 1001, planId: 3802, validateMinutes: 15 },
    },
    storageGrowth: {
        category: "storage",
        title: "Unexpected storage growth",
        summary:
            "Database growth is above the forecast and will consume the configured storage threshold.",
        diagnosis:
            "Transient staging rows are retained for 30 days although downstream processing completes in 48 hours.",
        actionTitle: "Reduce staging retention",
        actionType: "updateRetentionPolicy",
        executionVenue: "manual",
        risk: "low",
        reasoning:
            "Rows older than seven days have no active references and are already represented in curated tables.",
        expectedOutcome: "Recover 84 GB and reduce daily growth to less than 3 GB.",
        rollbackPlan: "Restore the 30-day retention configuration before the next cleanup job.",
        parameters: { table: "staging.ImportEvents", retentionDays: 7 },
    },
    availabilityRisk: {
        category: "availability",
        title: "Availability risk detected",
        summary: "Replica health has moved outside the expected recovery objective.",
        diagnosis: "Log send latency is accumulating on the synchronous secondary.",
        actionTitle: "Suspend the affected replica",
        actionType: "suspendReplica",
        executionVenue: "manual",
        risk: "critical",
        reasoning:
            "Isolating the unhealthy replica prevents commit latency from increasing further.",
        expectedOutcome: "Restore primary transaction latency while the replica is repaired.",
        rollbackPlan: "Resume data movement after network and storage validation completes.",
        parameters: { replica: "sql2025-dr-01" },
    },
    securityRisk: {
        category: "security",
        title: "Security configuration risk",
        summary:
            "A privileged login is using an authentication path outside the approved baseline.",
        diagnosis: "The login is not mapped to the managed identity policy used by this database.",
        actionTitle: "Disable the legacy login",
        actionType: "disableLogin",
        executionVenue: "manual",
        risk: "high",
        reasoning: "No active application dependency has used this login during the last 30 days.",
        expectedOutcome: "Remove the unapproved authentication path.",
        rollbackPlan: "Re-enable the login while the dependent workload is migrated.",
        parameters: { loginName: "legacy-reporting-admin" },
    },
};

function buildIssue(
    databaseName: string,
    now: number,
    [issueId, kind, severity, status, metricValue]: IssueSeed,
    index: number,
    allSeeds: readonly IssueSeed[],
): DbAgentIssue {
    const profile = issueProfiles[kind];
    const detectedAt = new Date(now - (index + 1) * 11 * 60_000).toISOString();
    const updatedAt = new Date(now - index * 4 * 60_000).toISOString();
    const action = buildIssueAction(issueId, profile, status);
    const actionCompleted = action.approvalStatus === "executed";
    const events: DbAgentIssue["events"] = [
        {
            eventId: `${issueId}-detected`,
            kind: "detected",
            timestamp: detectedAt,
            description: "Database Agent detected a statistically significant deviation.",
        },
        {
            eventId: `${issueId}-diagnosed`,
            kind: "diagnosed",
            timestamp: new Date(Date.parse(detectedAt) + 3 * 60_000).toISOString(),
            description: profile.diagnosis,
        },
        {
            eventId: `${issueId}-recommended`,
            kind: "actionProposed",
            timestamp: new Date(Date.parse(detectedAt) + 7 * 60_000).toISOString(),
            description: `Recommended action: ${profile.actionTitle}.`,
        },
    ];
    if (actionCompleted) {
        events.push(
            {
                eventId: `${issueId}-executed`,
                kind: "actionExecuted",
                timestamp: new Date(Date.parse(updatedAt) - 2 * 60_000).toISOString(),
                description: `Executed action: ${profile.actionTitle}.`,
            },
            {
                eventId: `${issueId}-resolved`,
                kind: "resolved",
                timestamp: updatedAt,
                description: "Validation confirmed that the issue returned to its baseline.",
            },
        );
    }

    return {
        issueId,
        kind,
        category: profile.category,
        severity,
        status,
        title: profile.title,
        summary: profile.summary,
        diagnosis: profile.diagnosis,
        detectedAt,
        updatedAt,
        metricValue,
        affectedDatabase: databaseName,
        metricCharts: [
            {
                id: `${issueId}-primary-metric`,
                title: getMetricTitle(kind),
                series: [
                    {
                        id: `${issueId}-observed`,
                        label: "Observed",
                        unit: getMetricUnit(kind),
                        points: points(
                            [32, 36, 39, 44, 52, 61, 74, 82, 77, 69, 63, 58].map(
                                (value) => value + (index % 3) * 3,
                            ),
                            now,
                            60,
                        ),
                    },
                    {
                        id: `${issueId}-baseline`,
                        label: "Expected baseline",
                        unit: getMetricUnit(kind),
                        points: points([34, 35, 36, 35, 37, 38, 37, 38, 39, 38, 37, 38], now, 60),
                    },
                ],
                annotations: [
                    {
                        timestamp: detectedAt,
                        label: "Issue detected",
                        kind: "detection",
                    },
                    ...(actionCompleted
                        ? [
                              {
                                  timestamp: new Date(
                                      Date.parse(updatedAt) - 2 * 60_000,
                                  ).toISOString(),
                                  label: "Action applied",
                                  kind: "action" as const,
                              },
                          ]
                        : []),
                ],
            },
        ],
        events,
        severityHistory: [
            {
                timestamp: detectedAt,
                severity: severity === "critical" ? "warning" : "watch",
                reason: "Initial severity based on the first two anomalous intervals.",
            },
            {
                timestamp: new Date(Date.parse(detectedAt) + 4 * 60_000).toISOString(),
                severity,
                reason: "Severity updated after workload and dependency correlation.",
            },
        ],
        recommendedActions: [action],
        actionsTaken: actionCompleted
            ? [
                  {
                      actionId: action.actionId,
                      title: action.title,
                      executedAt: new Date(Date.parse(updatedAt) - 2 * 60_000).toISOString(),
                      executedBy: "Database Agent",
                      outcome: "succeeded",
                      validationResult: "Primary metric remained within baseline for 10 minutes.",
                  },
              ]
            : [],
        blockedByIssueIds: index === 0 && allSeeds.length > 1 ? [allSeeds[1][0]] : [],
        blockingIssueIds: index === 1 ? [allSeeds[0][0]] : [],
        analysisNotes: {},
    };
}

function buildIssueAction(
    issueId: string,
    profile: IssueProfile,
    status: DbAgentIssue["status"],
): DbAgentIssueAction {
    return {
        actionId: `${issueId}-action-1`,
        stageNumber: 1,
        title: profile.actionTitle,
        actionType: profile.actionType,
        executionVenue: profile.executionVenue,
        approvalStatus:
            status === "resolved" ? "executed" : status === "closed" ? "rejected" : "pending",
        risk: profile.risk,
        confidencePercent: status === "resolved" ? 96 : 88,
        reasoning: profile.reasoning,
        expectedOutcome: profile.expectedOutcome,
        rollbackPlan: profile.rollbackPlan,
        parameters: clone(profile.parameters),
    };
}

function buildActiveInvestigation(
    now: number,
    issues: DbAgentIssue[],
): DbAgentDashboard["activeInvestigation"] {
    const issueIds = issues.slice(0, 2).map((issue) => issue.issueId);
    const investigationId = `investigation-${issueIds[0]}`;
    const startedAt = new Date(now - 14 * 60_000).toISOString();
    return {
        investigationId,
        issueIds,
        triggerSummary: "Concurrent workload regressions detected across the database.",
        status: "active",
        startedAt,
        updatedAt: new Date(now - 3 * 60_000).toISOString(),
        events: [
            {
                id: `${investigationId}-detected`,
                kind: "detected",
                timestamp: startedAt,
                title: "Anomaly detected",
                detail: "Multiple metrics moved outside their learned workload baselines.",
            },
            {
                id: `${investigationId}-correlated`,
                kind: "correlated",
                timestamp: new Date(now - 11 * 60_000).toISOString(),
                title: "Related issues correlated",
                detail: "Query, wait, and session telemetry indicate a shared workload cause.",
            },
            {
                id: `${investigationId}-diagnosed`,
                kind: "diagnosed",
                timestamp: new Date(now - 7 * 60_000).toISOString(),
                title: "Root cause identified",
                detail: issues[0].diagnosis,
            },
            {
                id: `${investigationId}-recommended`,
                kind: "recommended",
                timestamp: new Date(now - 3 * 60_000).toISOString(),
                title: "Mitigation ready",
                detail: issues[0].recommendedActions[0].title,
            },
        ],
    };
}

function buildInvestigationHistory(
    now: number,
    issues: DbAgentIssue[],
): DbAgentDashboard["investigations"] {
    const issue = issues.find((candidate) => candidate.status === "resolved");
    if (!issue) {
        return [];
    }

    const startedAt = new Date(now - 20 * 60 * 60_000).toISOString();
    const resolvedAt = new Date(now - 19 * 60 * 60_000).toISOString();
    return [
        {
            investigationId: `investigation-history-${issue.issueId}`,
            issueIds: [issue.issueId],
            triggerSummary: "Morning workload CPU exceeded its predicted range.",
            status: "resolved",
            startedAt,
            updatedAt: resolvedAt,
            resolvedAt,
            events: [
                {
                    id: `history-${issue.issueId}-detected`,
                    kind: "detected",
                    timestamp: startedAt,
                    title: "Workload regression detected",
                    detail: issue.summary,
                },
                {
                    id: `history-${issue.issueId}-action`,
                    kind: "action",
                    timestamp: new Date(now - 19.5 * 60 * 60_000).toISOString(),
                    title: issue.recommendedActions[0].title,
                    detail: "The approved mitigation completed successfully.",
                },
                {
                    id: `history-${issue.issueId}-resolved`,
                    kind: "resolved",
                    timestamp: resolvedAt,
                    title: "Issue resolved",
                    detail: "Observed metrics remained within baseline for the validation period.",
                },
            ],
        },
    ];
}

function getMetricTitle(kind: DbAgentIssueKind): string {
    switch (kind) {
        case "blockingChain":
            return "Blocked session duration";
        case "capacityPressure":
            return "Capacity utilization";
        case "highCpu":
            return "CPU utilization";
        case "queryRegression":
            return "Query duration";
        case "storageGrowth":
            return "Daily storage growth";
        case "availabilityRisk":
            return "Replica send latency";
        case "securityRisk":
            return "Privileged login activity";
    }
}

function getMetricUnit(kind: DbAgentIssueKind): string {
    switch (kind) {
        case "blockingChain":
        case "queryRegression":
        case "availabilityRisk":
            return "ms";
        case "storageGrowth":
            return "GB/day";
        case "securityRisk":
            return "events";
        default:
            return "%";
    }
}

function findIssue(snapshot: DashboardSnapshot, issueId: string): DbAgentIssue {
    const issue = snapshot.dbAgent.issues.find((candidate) => candidate.issueId === issueId);
    if (!issue) {
        throw new Error(
            `Dashboard issue '${issueId}' was not found for target '${snapshot.target.id}'.`,
        );
    }
    return issue;
}

function findAction(issue: DbAgentIssue, actionId: string): DbAgentIssueAction {
    const action = issue.recommendedActions.find((candidate) => candidate.actionId === actionId);
    if (!action) {
        throw new Error(
            `Dashboard action '${actionId}' was not found for issue '${issue.issueId}'.`,
        );
    }
    return action;
}

function appendIssueEvent(
    issue: DbAgentIssue,
    kind: DbAgentIssue["events"][number]["kind"],
    description: string,
): void {
    const timestamp = new Date().toISOString();
    issue.events.push({
        eventId: `${issue.issueId}-${kind}-${timestamp}`,
        kind,
        timestamp,
        description,
    });
}

function applyAction(
    issue: DbAgentIssue,
    action: DbAgentIssueAction,
    approvalStatus: "executed" | "manuallyApplied",
    executedBy: string,
    validationResult: string,
): void {
    const executedAt = new Date().toISOString();
    action.approvalStatus = approvalStatus;
    issue.updatedAt = executedAt;
    issue.actionsTaken.push({
        actionId: action.actionId,
        title: action.title,
        executedAt,
        executedBy,
        outcome: "succeeded",
        validationResult,
    });
}

function appendInvestigationAction(
    snapshot: DashboardSnapshot,
    issueId: string,
    actionTitle: string,
): void {
    const investigation = snapshot.dbAgent.activeInvestigation;
    if (!investigation?.issueIds.includes(issueId)) {
        return;
    }

    const timestamp = new Date().toISOString();
    investigation.updatedAt = timestamp;
    investigation.status = "monitoring";
    investigation.events.push({
        id: `${investigation.investigationId}-action-${timestamp}`,
        kind: "action",
        timestamp,
        title: "Mitigation applied",
        detail: actionTitle,
    });
}

function getAnalysisNote(issue: DbAgentIssue, section: DbAgentAnalyzableSection): string {
    switch (section) {
        case "summary":
            return `Copilot correlated this issue with ${issue.events.length} telemetry events and found the deviation to be workload-specific rather than system-wide.`;
        case "diagnosis":
            return `The diagnosis has ${issue.recommendedActions[0]?.confidencePercent ?? 0}% confidence based on Query Store, wait, and session evidence.`;
        case "metrics":
            return "The observed series diverges from baseline at the detection marker and remains statistically significant across consecutive intervals.";
        case "recommendedAction":
            return `The recommended action is ${issue.recommendedActions[0]?.risk ?? "unknown"} risk and includes an explicit rollback path.`;
    }
}

function round(value: number): number {
    return Math.round(value * 10) / 10;
}

function clone<T>(value: T): T {
    return structuredClone(value);
}
