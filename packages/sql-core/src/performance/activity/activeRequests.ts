/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { sqlIntLiteral } from "../../common/literals";
import { PlatformInfo, isFabricWarehouseFamily } from "../../common/platform";
import { maxDopOneHint, sessionPreamble } from "../../common/session";
import {
    MissingDataCode,
    PerfResult,
    PerfScope,
    PerfSource,
    errorResult,
    unsupportedResult,
} from "../result";
import {
    SqlReadOptions,
    SqlReader,
    SqlRecord,
    readNumber,
    readString,
    toRecords,
} from "../../common/sqlReader";
import { BlockingSummary, buildBlockingChains } from "./blockingChains";
import { ActiveRequest, IdleSession } from "./types";

export interface ActiveActivity {
    readonly requests: readonly ActiveRequest[];
    readonly blocking: BlockingSummary;
}

type ActivityFamily = "sqlEngine" | "synapseDedicated" | "fabricWarehouse" | "synapseServerless";

const statementTextExpression = `LEFT(SUBSTRING(t.text, (r.statement_start_offset / 2) + 1,
        ((CASE r.statement_end_offset WHEN -1 THEN DATALENGTH(t.text)
            ELSE r.statement_end_offset END - r.statement_start_offset) / 2) + 1), 4000)`;

const idleBlockersFilter = `s.session_id IN (
        SELECT r.blocking_session_id FROM sys.dm_exec_requests AS r WHERE r.blocking_session_id > 0)
    AND NOT EXISTS (SELECT 1 FROM sys.dm_exec_requests AS r2 WHERE r2.session_id = s.session_id)`;

function idleBlockersQuery(hint: string): string {
    return `
SELECT
    CONVERT(varchar(11), s.session_id) AS session_id,
    s.status,
    s.login_name,
    s.host_name,
    s.program_name,
    s.open_transaction_count,
    CONVERT(varchar(33), s.last_request_start_time, 126) AS last_request_start_time,
    CONVERT(varchar(33), s.last_request_end_time, 126) AS last_request_end_time
FROM sys.dm_exec_sessions AS s
WHERE ${idleBlockersFilter}${hint};`;
}

/**
 * Reads the running requests and builds the blocking chains.
 */
export async function getActiveRequests(
    reader: SqlReader,
    info: PlatformInfo,
    options?: SqlReadOptions,
    now: Date = new Date(),
): Promise<PerfResult<ActiveActivity>> {
    const family = activityFamily(info);
    if (!family) {
        return unsupportedResult(info, now);
    }
    const source: PerfSource = family === "synapseDedicated" ? "pdwDmv" : "dmv";

    try {
        switch (family) {
            case "sqlEngine":
                return await readSqlEngine(reader, info, source, options, now);
            case "synapseDedicated":
                return await readSynapseDedicated(reader, info, source, options, now);
            case "fabricWarehouse":
            case "synapseServerless":
                return await readFabricOrServerless(reader, info, family, source, options, now);
        }
    } catch (error) {
        return errorResult(info, error, now, source);
    }
}

/**
 * Returns the T-SQL that reads the permission, the requests, and the idle blockers on SQL Server,
 * Managed Instance, Azure SQL Database, and SQL database in Fabric. Exported for tests.
 */
export function buildSqlEngineActivityQuery(info: PlatformInfo): string {
    return `
${sessionPreamble(info)}
SELECT ${permissionExpression(info)} AS has_permission;
SELECT
    CONVERT(varchar(11), r.session_id) AS session_id,
    CONVERT(varchar(11), r.request_id) AS request_id,
    r.status,
    r.command,
    r.total_elapsed_time AS elapsed_ms,
    r.cpu_time AS cpu_ms,
    r.logical_reads,
    r.reads,
    r.writes,
    r.granted_query_memory AS granted_memory_pages,
    r.wait_type,
    r.wait_time AS wait_ms,
    r.wait_resource,
    CONVERT(varchar(11), r.blocking_session_id) AS blocking_session_id,
    r.open_transaction_count,
    DB_NAME(r.database_id) AS database_name,
    CONVERT(varchar(18), r.query_hash, 1) AS query_hash,
    CONVERT(varchar(18), r.query_plan_hash, 1) AS query_plan_hash,
    s.login_name,
    s.host_name,
    s.program_name,
    ${statementTextExpression} AS statement_text
FROM sys.dm_exec_requests AS r
INNER JOIN sys.dm_exec_sessions AS s ON s.session_id = r.session_id
OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) AS t
WHERE s.is_user_process = 1 AND r.session_id <> @@SPID${maxDopOneHint(info)};
${idleBlockersQuery(maxDopOneHint(info))}
`;
}

function activityFamily(info: PlatformInfo): ActivityFamily | undefined {
    switch (info.platform) {
        case "sqlServer":
        case "azureSqlManagedInstance":
        case "azureSqlDatabase":
        case "fabricSqlDatabase":
            return "sqlEngine";
        case "synapseDedicated":
            return "synapseDedicated";
        case "synapseServerless":
            return "synapseServerless";
        default:
            return isFabricWarehouseFamily(info) ? "fabricWarehouse" : undefined;
    }
}

function scopeFor(info: PlatformInfo): PerfScope {
    switch (info.platform) {
        case "sqlServer":
        case "azureSqlManagedInstance":
            return "instance";
        case "synapseDedicated":
            return "pool";
        case "synapseServerless":
            return "server";
        case "fabricWarehouse":
        case "fabricSqlAnalyticsEndpoint":
            return "item";
        default:
            return "database";
    }
}

function permissionExpression(info: PlatformInfo): string {
    switch (info.platform) {
        case "azureSqlDatabase":
        case "fabricSqlDatabase":
            return "HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW DATABASE STATE')";
        case "sqlServer":
            return (info.majorVersion ?? 0) >= 16
                ? "HAS_PERMS_BY_NAME(NULL, NULL, 'VIEW SERVER PERFORMANCE STATE')"
                : "HAS_PERMS_BY_NAME(NULL, NULL, 'VIEW SERVER STATE')";
        default:
            return "HAS_PERMS_BY_NAME(NULL, NULL, 'VIEW SERVER STATE')";
    }
}

async function readSqlEngine(
    reader: SqlReader,
    info: PlatformInfo,
    source: PerfSource,
    options: SqlReadOptions | undefined,
    now: Date,
): Promise<PerfResult<ActiveActivity>> {
    const [permissionSet, requestSet, idleSet] = await reader.read(
        buildSqlEngineActivityQuery(info),
        options,
    );
    const hasPermission = readNumber(toRecords(permissionSet)[0] ?? {}, "has_permission") === 1;
    const requests = toRecords(requestSet).map(toActiveRequest);
    let idleSessions = toRecords(idleSet).map(toIdleSession);
    const missing: MissingDataCode[] = [];

    if (idleSessions.length > 0) {
        // The last statement of an idle session needs sys.dm_exec_connections. Some Azure SQL
        // Database tiers permit it only to administrators, so a failure removes only the text.
        try {
            idleSessions = await addIdleStatementText(reader, info, idleSessions, options);
        } catch {
            missing.push("statementText");
        }
    }

    return {
        status: hasPermission ? "ready" : "selfOnly",
        platform: info.platform,
        source,
        scope: scopeFor(info),
        observedAtUtc: now.toISOString(),
        data: { requests, blocking: buildBlockingChains(requests, idleSessions) },
        missing,
    };
}

async function addIdleStatementText(
    reader: SqlReader,
    info: PlatformInfo,
    idleSessions: IdleSession[],
    options: SqlReadOptions | undefined,
): Promise<IdleSession[]> {
    const ids = idleSessions.map((session) => sqlIntLiteral(Number(session.sessionId), 1, 32767));
    const [textSet] = await reader.read(
        `
${sessionPreamble(info)}
SELECT
    CONVERT(varchar(11), c.session_id) AS session_id,
    LEFT(t.text, 4000) AS last_statement_text
FROM sys.dm_exec_connections AS c
OUTER APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle) AS t
WHERE c.session_id IN (${ids.join(", ")}) AND c.net_transport <> N'Session'${maxDopOneHint(info)};
`,
        options,
    );
    const textBySession = new Map(
        toRecords(textSet).map((record) => [
            readString(record, "session_id"),
            readString(record, "last_statement_text"),
        ]),
    );
    return idleSessions.map((session) => ({
        ...session,
        lastStatementText: textBySession.get(session.sessionId),
    }));
}

async function readSynapseDedicated(
    reader: SqlReader,
    info: PlatformInfo,
    source: PerfSource,
    options: SqlReadOptions | undefined,
    now: Date,
): Promise<PerfResult<ActiveActivity>> {
    const [requestSet, waitSet] = await reader.read(
        `
${sessionPreamble(info)}
SELECT
    request_id,
    session_id,
    status,
    CONVERT(varchar(33), start_time, 126) AS start_time,
    total_elapsed_time AS elapsed_ms,
    label,
    resource_class,
    LEFT(COALESCE(command2, command), 4000) AS statement_text
FROM sys.dm_pdw_exec_requests
WHERE status NOT IN ('Completed', 'Failed', 'Cancelled') AND session_id <> SESSION_ID();
SELECT
    waiting.request_id,
    waiting.object_type,
    waiting.object_name,
    waiting.type AS wait_type,
    blocking.session_id AS blocking_session_id
FROM sys.dm_pdw_waits AS waiting
INNER JOIN sys.dm_pdw_waits AS blocking
    ON waiting.object_type = blocking.object_type AND waiting.object_name = blocking.object_name
WHERE waiting.state = 'Queued' AND blocking.state = 'Granted'
    AND waiting.request_id <> blocking.request_id;
`,
        options,
    );

    const waitByRequest = new Map<string, SqlRecord>();
    for (const record of toRecords(waitSet)) {
        const requestId = readString(record, "request_id");
        if (requestId && !waitByRequest.has(requestId)) {
            waitByRequest.set(requestId, record);
        }
    }

    const requests = toRecords(requestSet).map((record): ActiveRequest => {
        const requestId = readString(record, "request_id");
        const wait = requestId ? waitByRequest.get(requestId) : undefined;
        const status = readString(record, "status");
        return {
            sessionId: readString(record, "session_id") ?? "",
            requestId,
            status,
            queued: status === "Suspended" && readString(record, "start_time") === undefined,
            elapsedMs: readNumber(record, "elapsed_ms"),
            label: readString(record, "label"),
            resourceClass: readString(record, "resource_class"),
            statementText: readString(record, "statement_text"),
            waitType: wait ? readString(wait, "wait_type") : undefined,
            waitResource: wait
                ? [readString(wait, "object_type"), readString(wait, "object_name")]
                      .filter((part) => part !== undefined)
                      .join(" ")
                : undefined,
            blockingSessionId: wait ? readString(wait, "blocking_session_id") : undefined,
        };
    });

    return {
        status: "ready",
        platform: info.platform,
        source,
        scope: scopeFor(info),
        observedAtUtc: now.toISOString(),
        data: { requests, blocking: buildBlockingChains(requests, []) },
        missing: ["cpuReadsAndMemory"],
    };
}

async function readFabricOrServerless(
    reader: SqlReader,
    info: PlatformInfo,
    family: ActivityFamily,
    source: PerfSource,
    options: SqlReadOptions | undefined,
    now: Date,
): Promise<PerfResult<ActiveActivity>> {
    const requestsQuery = `
SELECT
    CONVERT(varchar(11), r.session_id) AS session_id,
    CONVERT(varchar(11), r.request_id) AS request_id,
    r.status,
    r.command,
    r.total_elapsed_time AS elapsed_ms,
    r.cpu_time AS cpu_ms,
    r.granted_query_memory AS granted_memory_pages,
    r.wait_type,
    r.wait_time AS wait_ms,
    r.wait_resource,
    CONVERT(varchar(11), r.blocking_session_id) AS blocking_session_id,
    r.open_transaction_count,
    s.login_name,
    s.host_name,
    s.program_name
FROM sys.dm_exec_requests AS r
INNER JOIN sys.dm_exec_sessions AS s ON s.session_id = r.session_id
WHERE r.session_id <> @@SPID;`;
    // Synapse serverless has no lock views, so it has no idle blockers to read.
    const sql =
        family === "fabricWarehouse"
            ? `${sessionPreamble(info)}${requestsQuery}${idleBlockersQuery("")}`
            : `${sessionPreamble(info)}${requestsQuery}`;
    const [requestSet, idleSet] = await reader.read(sql, options);
    const requests = toRecords(requestSet).map(toActiveRequest);
    const idleSessions = toRecords(idleSet).map(toIdleSession);

    // In Fabric, only the workspace Admin role sees the requests of other users. T-SQL cannot
    // read the role, so the result always reports the gap.
    const missing: MissingDataCode[] =
        family === "fabricWarehouse" ? ["statementText", "otherUsersRequests"] : ["statementText"];

    return {
        status: "ready",
        platform: info.platform,
        source,
        scope: scopeFor(info),
        observedAtUtc: now.toISOString(),
        data: { requests, blocking: buildBlockingChains(requests, idleSessions) },
        missing,
    };
}

function toActiveRequest(record: SqlRecord): ActiveRequest {
    const blocker = readString(record, "blocking_session_id");
    const grantedPages = readNumber(record, "granted_memory_pages");
    return {
        sessionId: readString(record, "session_id") ?? "",
        requestId: readString(record, "request_id"),
        status: readString(record, "status"),
        command: readString(record, "command"),
        elapsedMs: readNumber(record, "elapsed_ms"),
        cpuMs: readNumber(record, "cpu_ms"),
        logicalReads: readNumber(record, "logical_reads"),
        reads: readNumber(record, "reads"),
        writes: readNumber(record, "writes"),
        grantedMemoryKb: grantedPages === undefined ? undefined : grantedPages * 8,
        waitType: readString(record, "wait_type"),
        waitMs: readNumber(record, "wait_ms"),
        waitResource: emptyToUndefined(readString(record, "wait_resource")),
        blockingSessionId: blocker && blocker !== "0" ? blocker : undefined,
        openTransactionCount: readNumber(record, "open_transaction_count"),
        databaseName: readString(record, "database_name"),
        loginName: readString(record, "login_name"),
        hostName: readString(record, "host_name"),
        programName: readString(record, "program_name"),
        statementText: readString(record, "statement_text"),
        queryHash: readString(record, "query_hash"),
        queryPlanHash: readString(record, "query_plan_hash"),
    };
}

function toIdleSession(record: SqlRecord): IdleSession {
    return {
        sessionId: readString(record, "session_id") ?? "",
        status: readString(record, "status"),
        loginName: readString(record, "login_name"),
        hostName: readString(record, "host_name"),
        programName: readString(record, "program_name"),
        openTransactionCount: readNumber(record, "open_transaction_count"),
        lastRequestStartTime: readString(record, "last_request_start_time"),
        lastRequestEndTime: readString(record, "last_request_end_time"),
    };
}

function emptyToUndefined(value: string | undefined): string | undefined {
    return value === undefined || value.trim() === "" ? undefined : value;
}
