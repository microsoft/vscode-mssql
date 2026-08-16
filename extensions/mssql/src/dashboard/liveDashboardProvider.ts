/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlDashboard } from "../sharedInterfaces/sqlDashboard";
import { DashboardProvider, DashboardProviderError } from "./dashboardProvider";
import {
    DashboardQueryError,
    DashboardQueryPool,
    DashboardQueryResult,
} from "./data/dashboardQueryPool";
import { sqlLiteral } from "./data/sqlLiteral";

const SERVER_IDENTITY_SQL = `SELECT
    CONVERT(nvarchar(256), SERVERPROPERTY('ServerName')) AS server_name,
    CONVERT(nvarchar(256), SERVERPROPERTY('Edition')) AS edition,
    CONVERT(nvarchar(64), SERVERPROPERTY('ProductVersion')) AS product_version,
    CONVERT(nvarchar(64), SERVERPROPERTY('ProductLevel')) AS product_level;`;

const SERVER_RESOURCES_SQL = `SELECT
    cpu_count,
    physical_memory_kb,
    DATEDIFF_BIG(second, sqlserver_start_time, SYSUTCDATETIME()) AS uptime_seconds
FROM sys.dm_os_sys_info;`;

const SERVER_ACTIVITY_SQL = `SELECT
    SUM(CASE WHEN r.session_id <> @@SPID THEN 1 ELSE 0 END) AS active_requests,
    SUM(CASE WHEN r.session_id <> @@SPID AND r.blocking_session_id > 0 THEN 1 ELSE 0 END) AS blocked_requests,
    MAX(CASE WHEN r.blocking_session_id > 0 THEN DATEDIFF(second, r.start_time, SYSUTCDATETIME()) END) AS max_blocked_seconds
FROM sys.dm_exec_requests AS r
INNER JOIN sys.dm_exec_sessions AS s ON s.session_id = r.session_id
WHERE s.program_name NOT LIKE N'vscode-mssql-dashboard-%';`;

const SERVER_DATABASES_SQL = `SELECT TOP (100)
    d.name,
    d.state_desc,
    d.recovery_model_desc,
    d.compatibility_level,
    CONVERT(bigint, COALESCE(SUM(mf.size), 0)) * 8 / 1024 AS size_mb
FROM sys.databases AS d
LEFT JOIN sys.master_files AS mf ON mf.database_id = d.database_id
GROUP BY d.name, d.state_desc, d.recovery_model_desc, d.compatibility_level
ORDER BY d.name;`;

function databaseFactsSql(database: string): string {
    return `USE ${sqlLiteral.ident(database)};
SELECT
    DB_NAME() AS database_name,
    d.state_desc,
    d.recovery_model_desc,
    d.compatibility_level,
    (SELECT CONVERT(bigint, COALESCE(SUM(df.size), 0)) * 8 / 1024
        FROM sys.database_files AS df) AS size_mb,
    (SELECT CONVERT(float, lsu.used_log_space_in_percent)
        FROM sys.dm_db_log_space_usage AS lsu) AS log_used_percent
FROM sys.databases AS d
WHERE d.database_id = DB_ID();`;
}

function queryStoreOptionsSql(database: string): string {
    return `USE ${sqlLiteral.ident(database)};
SELECT
    actual_state_desc,
    current_storage_size_mb,
    max_storage_size_mb,
    size_based_cleanup_mode_desc
FROM sys.database_query_store_options;`;
}

function topQueriesSql(database: string): string {
    return `USE ${sqlLiteral.ident(database)};
WITH query_aggregate AS (
    SELECT
        q.query_id,
        SUM(CONVERT(bigint, rs.count_executions)) AS executions,
        SUM(CONVERT(float, rs.avg_duration) * rs.count_executions)
            / NULLIF(SUM(rs.count_executions), 0) / 1000.0 AS average_duration_ms,
        MAX(CASE WHEN rsi.end_time >= DATEADD(minute, -15, SYSUTCDATETIME())
            THEN CONVERT(float, rs.avg_duration) / 1000.0 END) AS current_duration_ms,
        SUM(CONVERT(float, rs.avg_cpu_time) * rs.count_executions)
            / NULLIF(SUM(rs.count_executions), 0) / 1000.0 AS cpu_ms,
        SUM(CONVERT(float, rs.avg_logical_io_reads) * rs.count_executions)
            / NULLIF(SUM(rs.count_executions), 0) AS logical_reads,
        COUNT(DISTINCT p.plan_id) AS plan_count,
        SUM(CONVERT(float, rs.avg_duration) * rs.count_executions) AS total_duration
    FROM sys.query_store_query AS q
    INNER JOIN sys.query_store_plan AS p ON p.query_id = q.query_id
    INNER JOIN sys.query_store_runtime_stats AS rs ON rs.plan_id = p.plan_id
    INNER JOIN sys.query_store_runtime_stats_interval AS rsi
        ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
    WHERE rsi.end_time >= DATEADD(hour, -24, SYSUTCDATETIME())
    GROUP BY q.query_id
)
SELECT TOP (100)
    query_id,
    executions,
    average_duration_ms,
    COALESCE(current_duration_ms, average_duration_ms) AS current_duration_ms,
    cpu_ms,
    logical_reads,
    plan_count,
    COUNT_BIG(*) OVER () AS total_query_count
FROM query_aggregate
ORDER BY total_duration DESC, query_id;`;
}

function queryPlansSql(database: string, queryId: string): string {
    return `USE ${sqlLiteral.ident(database)};
SELECT
    p.plan_id,
    p.initial_compile_start_time,
    p.last_compile_start_time,
    p.is_forced_plan,
    SUM(CONVERT(bigint, rs.count_executions)) AS executions,
    SUM(CONVERT(float, rs.avg_duration) * rs.count_executions)
        / NULLIF(SUM(rs.count_executions), 0) / 1000.0 AS average_duration_ms
FROM sys.query_store_plan AS p
LEFT JOIN sys.query_store_runtime_stats AS rs ON rs.plan_id = p.plan_id
WHERE p.query_id = ${sqlLiteral.bigint(queryId)}
GROUP BY p.plan_id, p.initial_compile_start_time, p.last_compile_start_time, p.is_forced_plan
ORDER BY p.last_compile_start_time DESC, p.plan_id DESC;`;
}

function queryWaitsSql(database: string, queryId: string): string {
    return `USE ${sqlLiteral.ident(database)};
SELECT
    ws.wait_category_desc,
    SUM(CONVERT(float, ws.total_query_wait_time_ms)) AS duration_ms
FROM sys.query_store_wait_stats AS ws
INNER JOIN sys.query_store_plan AS p ON p.plan_id = ws.plan_id
INNER JOIN sys.query_store_runtime_stats_interval AS rsi
    ON rsi.runtime_stats_interval_id = ws.runtime_stats_interval_id
WHERE p.query_id = ${sqlLiteral.bigint(queryId)}
  AND rsi.end_time >= DATEADD(hour, -24, SYSUTCDATETIME())
GROUP BY ws.wait_category_desc
ORDER BY duration_ms DESC;`;
}

function records(result: DashboardQueryResult): Array<Record<string, unknown>> {
    const names = result.columns.map((column) => column.name.toLowerCase());
    return result.rows.map((row) =>
        Object.fromEntries(names.map((name, index) => [name, row[index]])),
    );
}

function text(value: unknown, fallback = "Not reported"): string {
    return value === undefined || value === null || value === "" ? fallback : String(value);
}

function numberValue(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDuration(seconds: number): string {
    if (seconds < 60) {
        return `${Math.max(0, Math.round(seconds))} seconds`;
    }
    if (seconds < 86_400) {
        return `${Math.round(seconds / 3_600)} hours`;
    }
    return `${Math.round(seconds / 86_400)} days`;
}

function formatSizeMb(sizeMb: number): string {
    return sizeMb >= 1024 ? `${(sizeMb / 1024).toFixed(1)} GB` : `${Math.round(sizeMb)} MB`;
}

function nowUtc(): string {
    return new Date().toISOString();
}

function isoUtc(value: unknown, fallback = nowUtc()): string {
    const date = new Date(text(value, fallback));
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function booleanValue(value: unknown): boolean {
    return value === true || value === 1 || value === "1" || value === "true";
}

function source(kind: SqlDashboard.SourceKind, label: string): SqlDashboard.SourceFacts {
    return { kind, label };
}

function section(
    id: string,
    title: string,
    kind: SqlDashboard.SourceKind,
    overrides: Partial<SqlDashboard.SectionFacts> = {},
): SqlDashboard.SectionFacts {
    return {
        id,
        title,
        load: { state: "ready" },
        source: source(kind, labelForSource(kind)),
        freshness: { state: "live", asOfUtc: nowUtc() },
        permission: { state: "granted" },
        ...overrides,
    };
}

function labelForSource(kind: SqlDashboard.SourceKind): string {
    switch (kind) {
        case "serverDmv":
            return "SQL Server dynamic management views";
        case "databaseDmv":
            return "Database catalog and dynamic management views";
        case "queryStore":
            return "Query Store";
        case "metadataStore":
            return "Metadata Store";
        case "msdbHistory":
            return "msdb history";
        case "errorLog":
            return "SQL Server error log";
        case "ringBuffer":
            return "SQL Server ring buffer";
        case "resourceStats":
            return "Azure resource statistics";
        case "deterministicMock":
            return "Deterministic dashboard fixture";
    }
}

function unavailableSection(
    id: string,
    title: string,
    kind: SqlDashboard.SourceKind,
    reason: Extract<SqlDashboard.LoadState, { state: "unavailable" }>["reason"],
    detail: string,
    required?: string,
): SqlDashboard.SectionFacts {
    return section(id, title, kind, {
        load: { state: "unavailable", reason, detail },
        freshness: { state: "unavailable", reason: detail },
        permission: required
            ? { state: "denied", required }
            : { state: reason === "permissionDenied" ? "denied" : "unknown" },
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
        route,
        requestedRoute: route,
        title: route.kind === "agent" ? "SQL Agent" : "SQL Dashboard",
        subtitle: "The requested data is not currently available.",
        sections: [unavailableSection("availability", "Availability", "serverDmv", reason, detail)],
        attention: [],
        state,
    };
}

function reasonFor(error: unknown): {
    reason: Extract<SqlDashboard.LoadState, { state: "unavailable" }>["reason"];
    detail: string;
    remediation?: string;
} {
    if (error instanceof DashboardProviderError) {
        if (error.code === "queryStoreDisabled") {
            return {
                reason: "queryStoreDisabled",
                detail: error.message,
                remediation: "Enable Query Store and allow it to collect a representative window.",
            };
        }
        return {
            reason: "providerUnavailable",
            detail: error.message,
            remediation: error.retryable ? "Retry the dashboard route." : undefined,
        };
    }
    if (error instanceof DashboardQueryError) {
        if ([229, 297, 300].includes(error.serverErrorNumber ?? -1)) {
            return {
                reason: "permissionDenied",
                detail: "The current login cannot read this performance source.",
                remediation:
                    "Ask an administrator for the narrow performance-state permission shown for the section.",
            };
        }
        if (error.code === "connectionLost" || error.outcomeCertainty === "unknown") {
            return {
                reason: "disconnected",
                detail: "The dashboard data-plane session was lost. Values are not presented as current.",
                remediation: "Reconnect and refresh the dashboard.",
            };
        }
    }
    return {
        reason: "providerUnavailable",
        detail: "The SQL data plane could not provide this dashboard section.",
        remediation: "Open the MSSQL Debug Console for provider diagnostics, then retry.",
    };
}

export class LiveDashboardProvider implements DashboardProvider {
    readonly mode = "live" as const;

    constructor(
        private readonly pool: DashboardQueryPool,
        readonly connection: SqlDashboard.WebviewState["connection"],
    ) {}

    async load(route: SqlDashboard.Route, signal: AbortSignal): Promise<SqlDashboard.Page> {
        try {
            switch (route.kind) {
                case "serverOverview":
                    return await this.serverOverview(signal);
                case "databaseOverview":
                    return await this.databaseOverview(route.database, signal);
                case "databasePerformance":
                    return await this.databasePerformance(route.database, signal);
                case "queryDetail":
                    return await this.queryDetail(route.database, route.queryId, signal);
                case "liveActivity":
                    return unavailablePage(
                        route,
                        "unsupported",
                        "Live Activity is not enabled in this first dashboard slice. No hidden polling is running.",
                    );
                case "agent":
                    return unavailablePage(
                        route,
                        "unsupported",
                        "SQL Agent integration is staged behind an explicit legacy bridge and is not enabled yet.",
                    );
            }
        } catch (error) {
            const unavailable = reasonFor(error);
            return unavailablePage(
                route,
                unavailable.reason,
                unavailable.detail,
                unavailable.remediation,
            );
        }
    }

    private async serverOverview(signal: AbortSignal): Promise<SqlDashboard.ServerOverviewPage> {
        const [identityResult, resourcesResult, activityResult, databasesResult] =
            await Promise.allSettled([
                this.pool.query(SERVER_IDENTITY_SQL, {
                    tag: "dashboard:serverIdentity",
                    timeoutMs: 5_000,
                    signal,
                }),
                this.pool.query(SERVER_RESOURCES_SQL, {
                    tag: "dashboard:serverResources",
                    timeoutMs: 5_000,
                    signal,
                }),
                this.pool.query(SERVER_ACTIVITY_SQL, {
                    tag: "dashboard:serverActivity",
                    timeoutMs: 5_000,
                    signal,
                    priority: "interactive",
                }),
                this.pool.query(SERVER_DATABASES_SQL, {
                    tag: "dashboard:databases",
                    timeoutMs: 15_000,
                    signal,
                }),
            ]);
        if (identityResult.status === "rejected") {
            throw identityResult.reason;
        }
        const identity = records(identityResult.value)[0] ?? {};
        const resources =
            resourcesResult.status === "fulfilled" ? (records(resourcesResult.value)[0] ?? {}) : {};
        const activity =
            activityResult.status === "fulfilled" ? (records(activityResult.value)[0] ?? {}) : {};
        const databases =
            databasesResult.status === "fulfilled" ? records(databasesResult.value) : [];
        const activityAvailable = activityResult.status === "fulfilled";
        const resourcesAvailable = resourcesResult.status === "fulfilled";
        const serverName = text(identity.server_name, this.connection.server);
        const activeRequests = numberValue(activity.active_requests);
        const blocked = numberValue(activity.blocked_requests);
        const blockedSeconds = numberValue(activity.max_blocked_seconds);

        return {
            kind: "serverOverview",
            route: { kind: "serverOverview" },
            title: serverName,
            subtitle: "Live SQL Server overview",
            server: {
                name: serverName,
                environment: "Saved connection",
                version: `${text(identity.edition)} · ${text(identity.product_version)}`,
                platform: "Not reported by this collector",
                processors: resourcesAvailable
                    ? `${numberValue(resources.cpu_count)} logical processors`
                    : "Unknown",
                memory: resourcesAvailable
                    ? formatSizeMb(numberValue(resources.physical_memory_kb) / 1024)
                    : "Unknown",
                uptime: resourcesAvailable
                    ? formatDuration(numberValue(resources.uptime_seconds))
                    : "Unknown",
            },
            sections: [
                section("identity", "Server identity", "serverDmv"),
                ...(resourcesAvailable
                    ? [section("resources", "Server resources", "serverDmv")]
                    : [
                          unavailableSection(
                              "resources",
                              "Server resources",
                              "serverDmv",
                              "permissionDenied",
                              "Server resource facts are not visible to this login.",
                              "VIEW SERVER PERFORMANCE STATE",
                          ),
                      ]),
                ...(activityAvailable
                    ? [section("workload", "Workload", "serverDmv")]
                    : [
                          unavailableSection(
                              "workload",
                              "Workload",
                              "serverDmv",
                              "permissionDenied",
                              "Live requests are not visible to this login.",
                              "VIEW SERVER PERFORMANCE STATE",
                          ),
                      ]),
                ...(databasesResult.status === "fulfilled"
                    ? [section("databases", "Databases", "serverDmv")]
                    : [
                          unavailableSection(
                              "databases",
                              "Databases",
                              "serverDmv",
                              "permissionDenied",
                              "The server database catalog is not visible to this login.",
                          ),
                      ]),
            ],
            kpis: [
                {
                    id: "active",
                    label: "Active requests",
                    value: activityAvailable ? String(activeRequests) : "Unknown",
                    tone: activityAvailable ? "neutral" : "unknown",
                    seriesBasis: "none",
                },
                {
                    id: "blocking",
                    label: "Blocking",
                    value: activityAvailable ? `${blocked} requests` : "Unknown",
                    note:
                        activityAvailable && blocked > 0
                            ? `Oldest blocked request: ${formatDuration(blockedSeconds)}`
                            : undefined,
                    tone: !activityAvailable ? "unknown" : blocked > 0 ? "warning" : "good",
                    seriesBasis: "none",
                },
                {
                    id: "cpuCount",
                    label: "Logical processors",
                    value: resourcesAvailable
                        ? String(numberValue(resources.cpu_count))
                        : "Unknown",
                    tone: resourcesAvailable ? "neutral" : "unknown",
                    seriesBasis: "none",
                },
                {
                    id: "memory",
                    label: "Physical memory",
                    value: resourcesAvailable
                        ? formatSizeMb(numberValue(resources.physical_memory_kb) / 1024)
                        : "Unknown",
                    tone: resourcesAvailable ? "neutral" : "unknown",
                    seriesBasis: "none",
                },
            ],
            databases: databases.map((row) => ({
                name: text(row.name),
                state: text(row.state_desc),
                size: formatSizeMb(numberValue(row.size_mb)),
                logUsed: "Not sampled",
                recoveryModel: text(row.recovery_model_desc),
                compatibilityLevel: numberValue(row.compatibility_level),
                lastBackup: "Not sampled",
                tone: row.state_desc === "ONLINE" ? "neutral" : "warning",
            })),
            attention:
                activityAvailable && blocked > 0
                    ? [
                          {
                              id: "blocking",
                              severity: "warning",
                              title: `${blocked} blocked requests detected`,
                              detail: `The oldest blocked request has waited ${formatDuration(blockedSeconds)}.`,
                              route: { kind: "liveActivity" },
                          },
                      ]
                    : [],
        };
    }

    private async queryStoreOptions(database: string, signal: AbortSignal) {
        const result = await this.pool.query(queryStoreOptionsSql(database), {
            tag: "dashboard:queryStoreOptions",
            timeoutMs: 5_000,
            signal,
        });
        const row = records(result)[0] ?? {};
        return {
            state: text(row.actual_state_desc, "UNKNOWN"),
            usedMb: numberValue(row.current_storage_size_mb),
            maxMb: numberValue(row.max_storage_size_mb),
            cleanupMode: text(row.size_based_cleanup_mode_desc, "UNKNOWN"),
        };
    }

    private async databaseOverview(
        database: string,
        signal: AbortSignal,
    ): Promise<SqlDashboard.DatabaseOverviewPage> {
        const [factsResult, optionsResult] = await Promise.allSettled([
            this.pool.query(databaseFactsSql(database), {
                tag: "dashboard:databaseFacts",
                timeoutMs: 5_000,
                signal,
            }),
            this.queryStoreOptions(database, signal),
        ]);
        if (factsResult.status === "rejected") {
            throw factsResult.reason;
        }
        const facts = records(factsResult.value)[0] ?? {};
        const options =
            optionsResult.status === "fulfilled"
                ? optionsResult.value
                : { state: "UNKNOWN", usedMb: 0, maxMb: 0, cleanupMode: "UNKNOWN" };
        const queryStoreEnabled = ["READ_WRITE", "READ_ONLY"].includes(options.state);
        let queries: SqlDashboard.QueryRow[] = [];
        let queryLoadFailed = false;
        if (queryStoreEnabled) {
            try {
                queries = await this.queryRows(database, signal);
            } catch {
                // Section state below reports the unavailable source. The rest
                // of the database page remains useful and truthful.
                queryLoadFailed = true;
            }
        }
        const sizeMb = numberValue(facts.size_mb);
        const logUsed = numberValue(facts.log_used_percent);
        return {
            kind: "databaseOverview",
            route: { kind: "databaseOverview", database },
            title: database,
            subtitle: "Live database health, capacity, and Query Store",
            database,
            sections: [
                section("properties", "Database properties", "databaseDmv"),
                ...(queryStoreEnabled && !queryLoadFailed
                    ? [section("queryStore", "Query Store", "queryStore")]
                    : [
                          unavailableSection(
                              "queryStore",
                              "Query Store",
                              "queryStore",
                              queryLoadFailed
                                  ? "providerUnavailable"
                                  : options.state === "OFF"
                                    ? "queryStoreDisabled"
                                    : optionsResult.status === "rejected"
                                      ? "permissionDenied"
                                      : "providerUnavailable",
                              queryLoadFailed
                                  ? "Query Store runtime statistics could not be loaded."
                                  : options.state === "OFF"
                                    ? "Query Store is disabled for this database."
                                    : "Query Store state could not be established.",
                              "VIEW DATABASE PERFORMANCE STATE",
                          ),
                      ]),
            ],
            properties: [
                { label: "State", value: text(facts.state_desc) },
                { label: "Data size", value: formatSizeMb(sizeMb) },
                { label: "Log used", value: `${logUsed.toFixed(1)}%` },
                { label: "Recovery model", value: text(facts.recovery_model_desc) },
                { label: "Compatibility", value: text(facts.compatibility_level) },
            ],
            kpis: queries.length
                ? summaryKpis(queries)
                : [
                      {
                          id: "queryHealth",
                          label: "Historical query health",
                          value: queryStoreEnabled ? "No rows in window" : "Unknown",
                          tone: queryStoreEnabled ? "neutral" : "unknown",
                          seriesBasis: "none",
                      },
                  ],
            queryStore: {
                state:
                    options.state === "READ_WRITE"
                        ? "readWrite"
                        : options.state === "READ_ONLY"
                          ? "readOnly"
                          : options.state === "OFF"
                            ? "off"
                            : "unknown",
                ...(optionsResult.status === "fulfilled"
                    ? {
                          usedMb: options.usedMb,
                          maxMb: options.maxMb,
                          ...(options.cleanupMode === "AUTO" ? { cleanupPercent: 90 } : {}),
                      }
                    : {}),
            },
            topQueries: queries.slice(0, 8),
            attention:
                options.state === "OFF"
                    ? [
                          {
                              id: "queryStoreOff",
                              severity: "unknown",
                              title: "Historical query health is unknown",
                              detail: "Query Store is disabled; the dashboard does not infer health from missing rows.",
                          },
                      ]
                    : [],
        };
    }

    private async queryRows(
        database: string,
        signal: AbortSignal,
    ): Promise<SqlDashboard.QueryRow[]> {
        const result = await this.pool.query(topQueriesSql(database), {
            tag: "dashboard:topQueries",
            timeoutMs: 15_000,
            signal,
        });
        return records(result).map((row) => {
            const average = numberValue(row.average_duration_ms);
            const current = numberValue(row.current_duration_ms, average);
            const regressPercent = average > 0 ? ((current - average) / average) * 100 : undefined;
            return {
                queryId: text(row.query_id),
                executions: numberValue(row.executions),
                averageDurationMs: average,
                currentDurationMs: current,
                cpuMs: numberValue(row.cpu_ms),
                logicalReads: numberValue(row.logical_reads),
                ...(regressPercent !== undefined ? { regressPercent } : {}),
                planCount: numberValue(row.plan_count),
                status:
                    regressPercent === undefined
                        ? "unknown"
                        : regressPercent >= 20
                          ? "regressed"
                          : regressPercent <= -20
                            ? "improved"
                            : "stable",
                queryLabel: `Query ${text(row.query_id)}`,
            };
        });
    }

    private async databasePerformance(
        database: string,
        signal: AbortSignal,
    ): Promise<SqlDashboard.Page> {
        const options = await this.queryStoreOptions(database, signal);
        if (!(["READ_WRITE", "READ_ONLY"] as string[]).includes(options.state)) {
            return unavailablePage(
                { kind: "databasePerformance", database },
                options.state === "OFF" ? "queryStoreDisabled" : "providerUnavailable",
                options.state === "OFF"
                    ? "Query Store is disabled, so historical performance cannot be calculated."
                    : "Query Store did not report a readable state.",
                "Enable Query Store and allow it to collect a representative window.",
            );
        }
        const result = await this.pool.query(topQueriesSql(database), {
            tag: "dashboard:performanceQueries",
            timeoutMs: 15_000,
            signal,
        });
        const raw = records(result);
        const queries = raw.map((row) => {
            const average = numberValue(row.average_duration_ms);
            const current = numberValue(row.current_duration_ms, average);
            const regressPercent = average > 0 ? ((current - average) / average) * 100 : undefined;
            return {
                queryId: text(row.query_id),
                executions: numberValue(row.executions),
                averageDurationMs: average,
                currentDurationMs: current,
                cpuMs: numberValue(row.cpu_ms),
                logicalReads: numberValue(row.logical_reads),
                ...(regressPercent !== undefined ? { regressPercent } : {}),
                planCount: numberValue(row.plan_count),
                status:
                    regressPercent === undefined
                        ? ("unknown" as const)
                        : regressPercent >= 20
                          ? ("regressed" as const)
                          : regressPercent <= -20
                            ? ("improved" as const)
                            : ("stable" as const),
                queryLabel: `Query ${text(row.query_id)}`,
            };
        });
        return {
            kind: "databasePerformance",
            route: { kind: "databasePerformance", database },
            title: "Database performance",
            subtitle: `${database} · Query Store · last 24 hours`,
            database,
            windowLabel: "Last 24 hours",
            sections: [
                section("summary", "Performance summary", "queryStore", {
                    freshness: { state: "sampled", asOfUtc: nowUtc(), windowSeconds: 86_400 },
                }),
                section("queries", "Top queries", "queryStore", {
                    freshness: { state: "sampled", asOfUtc: nowUtc(), windowSeconds: 86_400 },
                }),
            ],
            kpis: summaryKpis(queries),
            queries,
            totalQueryCount: numberValue(raw[0]?.total_query_count, queries.length),
            attention: queries
                .filter((query) => query.status === "regressed")
                .slice(0, 4)
                .map((query) => ({
                    id: `regression-${query.queryId}`,
                    severity: "warning" as const,
                    title: `${query.queryLabel} regressed ${Math.round(query.regressPercent ?? 0)}%`,
                    detail: "The most recent interval is slower than its 24-hour weighted baseline.",
                    route: {
                        kind: "queryDetail" as const,
                        database,
                        queryId: query.queryId,
                    },
                })),
        };
    }

    private async queryDetail(
        database: string,
        queryId: string,
        signal: AbortSignal,
    ): Promise<SqlDashboard.QueryDetailPage> {
        const options = await this.queryStoreOptions(database, signal);
        if (!(["READ_WRITE", "READ_ONLY"] as string[]).includes(options.state)) {
            throw new DashboardProviderError(
                "queryStoreDisabled",
                false,
                "Query Store is not readable for this database",
            );
        }
        const [summaryResult, plansResult, waitsResult] = await Promise.allSettled([
            this.pool.query(topQueriesSql(database), {
                tag: "dashboard:queryDetailSummary",
                timeoutMs: 15_000,
                signal,
            }),
            this.pool.query(queryPlansSql(database, queryId), {
                tag: "dashboard:queryPlans",
                timeoutMs: 15_000,
                signal,
            }),
            this.pool.query(queryWaitsSql(database, queryId), {
                tag: "dashboard:queryWaits",
                timeoutMs: 15_000,
                signal,
            }),
        ]);
        if (summaryResult.status === "rejected") {
            throw summaryResult.reason;
        }
        if (plansResult.status === "rejected") {
            throw plansResult.reason;
        }
        const summaryRows = records(summaryResult.value);
        const queryRow = summaryRows.find((row) => text(row.query_id) === queryId);
        const query = queryRow
            ? (() => {
                  const average = numberValue(queryRow.average_duration_ms);
                  const current = numberValue(queryRow.current_duration_ms, average);
                  const regressPercent =
                      average > 0 ? ((current - average) / average) * 100 : undefined;
                  return {
                      queryId,
                      executions: numberValue(queryRow.executions),
                      averageDurationMs: average,
                      currentDurationMs: current,
                      cpuMs: numberValue(queryRow.cpu_ms),
                      logicalReads: numberValue(queryRow.logical_reads),
                      ...(regressPercent !== undefined ? { regressPercent } : {}),
                      planCount: numberValue(queryRow.plan_count),
                      status:
                          regressPercent === undefined
                              ? ("unknown" as const)
                              : regressPercent >= 20
                                ? ("regressed" as const)
                                : regressPercent <= -20
                                  ? ("improved" as const)
                                  : ("stable" as const),
                      queryLabel: `Query ${queryId}`,
                  };
              })()
            : undefined;
        if (!query) {
            throw new DashboardProviderError(
                "queryNotInWindow",
                false,
                "The selected Query Store query has no runtime rows in the current 24-hour window",
            );
        }
        const planRows = records(plansResult.value);
        const plans: SqlDashboard.PlanSummary[] = planRows.map((row, index) => ({
            planId: text(row.plan_id),
            firstSeenUtc: isoUtc(row.initial_compile_start_time),
            lastSeenUtc: isoUtc(row.last_compile_start_time),
            averageDurationMs: numberValue(row.average_duration_ms),
            executions: numberValue(row.executions),
            forced: booleanValue(row.is_forced_plan),
            status:
                index === 0 ? "current" : index === planRows.length - 1 ? "baseline" : "historical",
        }));
        const waitRows = waitsResult.status === "fulfilled" ? records(waitsResult.value) : [];
        const totalWaitMs = waitRows.reduce((sum, row) => sum + numberValue(row.duration_ms), 0);
        const waits = waitRows.map((row) => ({
            category: text(row.wait_category_desc),
            durationMs: numberValue(row.duration_ms),
            percent: totalWaitMs > 0 ? (numberValue(row.duration_ms) / totalWaitMs) * 100 : 0,
        }));
        return {
            kind: "queryDetail",
            route: { kind: "queryDetail", database, queryId },
            title: query.queryLabel,
            subtitle: `${database} · Query Store query detail`,
            database,
            queryId,
            queryLabel: query.queryLabel,
            sections: [
                section("summary", "Query summary", "queryStore"),
                section("plans", "Plan history", "queryStore"),
                ...(waitsResult.status === "fulfilled"
                    ? [section("waits", "Wait categories", "queryStore")]
                    : [
                          unavailableSection(
                              "waits",
                              "Wait categories",
                              "queryStore",
                              "unsupported",
                              "Query Store wait statistics are unavailable on this server or permission set.",
                          ),
                      ]),
            ],
            kpis: [
                {
                    id: "current",
                    label: "Current duration",
                    value: `${query.currentDurationMs.toFixed(0)} ms`,
                    tone: query.status === "regressed" ? "warning" : "neutral",
                    seriesBasis: "historical",
                    ...(query.regressPercent !== undefined
                        ? {
                              delta: {
                                  value: `${query.regressPercent >= 0 ? "+" : ""}${Math.round(query.regressPercent)}%`,
                                  direction:
                                      query.regressPercent > 0
                                          ? ("up" as const)
                                          : ("down" as const),
                              },
                          }
                        : {}),
                },
                {
                    id: "baseline",
                    label: "24-hour average",
                    value: `${query.averageDurationMs.toFixed(0)} ms`,
                    tone: "neutral",
                    seriesBasis: "historical",
                },
                {
                    id: "executions",
                    label: "Executions",
                    value: query.executions.toLocaleString("en-US"),
                    tone: "neutral",
                    seriesBasis: "historical",
                },
                {
                    id: "reads",
                    label: "Logical reads",
                    value: Math.round(query.logicalReads).toLocaleString("en-US"),
                    tone: "neutral",
                    seriesBasis: "historical",
                },
            ],
            waits,
            plans,
            privacy: {
                queryTextAvailable: false,
                queryTextPersisted: false,
                message:
                    "Query text is not included in dashboard state, diagnostics, telemetry, or snapshots.",
            },
            attention:
                query.status === "regressed"
                    ? [
                          {
                              id: "regression",
                              severity: "warning",
                              title: `${query.queryLabel} is slower than its 24-hour baseline`,
                              detail: "Compare the current and historical plans before taking action.",
                          },
                      ]
                    : [],
        };
    }

    dispose(): Promise<void> {
        return this.pool.dispose();
    }
}

function summaryKpis(queries: SqlDashboard.QueryRow[]): SqlDashboard.Kpi[] {
    const executions = queries.reduce((sum, row) => sum + row.executions, 0);
    const weightedDuration = queries.reduce(
        (sum, row) => sum + row.averageDurationMs * row.executions,
        0,
    );
    const cpuMs = queries.reduce((sum, row) => sum + row.cpuMs * row.executions, 0);
    const reads = queries.reduce((sum, row) => sum + row.logicalReads * row.executions, 0);
    return [
        {
            id: "executions",
            label: "Executions",
            value: executions.toLocaleString("en-US"),
            note: "Top Query Store rows in the 24-hour window",
            tone: "neutral",
            seriesBasis: "historical",
        },
        {
            id: "duration",
            label: "Average duration",
            value: executions > 0 ? `${Math.round(weightedDuration / executions)} ms` : "No data",
            tone: executions > 0 ? "neutral" : "unknown",
            seriesBasis: "historical",
        },
        {
            id: "cpu",
            label: "CPU time",
            value: `${(cpuMs / 3_600_000).toFixed(1)} h`,
            tone: "neutral",
            seriesBasis: "historical",
        },
        {
            id: "reads",
            label: "Logical reads",
            value: Math.round(reads).toLocaleString("en-US"),
            tone: "neutral",
            seriesBasis: "historical",
        },
    ];
}
