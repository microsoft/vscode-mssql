/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import { createHash } from "crypto";

export const LOCAL_XEVENT_TEMPLATE = "developer-diagnostics";
export const MIN_LOCAL_XEL_FILE_SIZE_MB = 1;
export const MAX_LOCAL_XEL_FILE_SIZE_MB = 64;
export const MAX_LOCAL_XEL_ARTIFACT_BYTES = 64 * 1024 * 1024;
export const MAX_LOCAL_XEL_ARCHIVE_BYTES = MAX_LOCAL_XEL_ARTIFACT_BYTES + 1024 * 1024;
export const MAX_LOCAL_XEVENT_ANALYSIS_ROWS = 1000;

const XEVENT_SESSION_NAME = /^rbs_xe_[a-f0-9]{24}$/;
const XEL_DIRECTORY = "/var/opt/mssql/log";

export class LocalXeventPolicyError extends Error {
    constructor(
        public readonly reason:
            | "invalidTemplate"
            | "invalidFileSize"
            | "invalidSession"
            | "invalidServerPath"
            | "invalidArchive"
            | "artifactTooLarge",
    ) {
        super(`Local XEvent policy rejected the operation: ${reason}`);
        this.name = "LocalXeventPolicyError";
    }
}

export function localXeventSessionName(effectId: string): string {
    return `rbs_xe_${createHash("sha256").update(effectId).digest("hex").slice(0, 24)}`;
}

export function localXeventBasePath(sessionName: string): string {
    requireSessionName(sessionName);
    return `${XEL_DIRECTORY}/${sessionName}.xel`;
}

export function workloadApplicationName(runId: string): string {
    return `vscode-mssql-runbook/${createHash("sha256").update(runId).digest("hex").slice(0, 24)}`;
}

export function buildStartLocalXeventSql(
    sessionName: string,
    template: string,
    maxFileSizeMb: number,
): string {
    requireSessionName(sessionName);
    if (template !== LOCAL_XEVENT_TEMPLATE) {
        throw new LocalXeventPolicyError("invalidTemplate");
    }
    if (
        !Number.isSafeInteger(maxFileSizeMb) ||
        maxFileSizeMb < MIN_LOCAL_XEL_FILE_SIZE_MB ||
        maxFileSizeMb > MAX_LOCAL_XEL_FILE_SIZE_MB
    ) {
        throw new LocalXeventPolicyError("invalidFileSize");
    }
    const filePath = localXeventBasePath(sessionName);
    return [
        `IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = N'${sessionName}')`,
        "    THROW 51000, 'Runbook Studio XEvent session already exists.', 1;",
        `CREATE EVENT SESSION [${sessionName}] ON SERVER`,
        "ADD EVENT sqlserver.error_reported(",
        "    ACTION(sqlserver.client_app_name, sqlserver.client_hostname, sqlserver.database_name, sqlserver.session_id, sqlserver.sql_text)",
        "),",
        "ADD EVENT sqlserver.rpc_completed(",
        "    ACTION(sqlserver.client_app_name, sqlserver.client_hostname, sqlserver.database_name, sqlserver.session_id, sqlserver.sql_text)",
        "),",
        "ADD EVENT sqlserver.sql_batch_completed(",
        "    ACTION(sqlserver.client_app_name, sqlserver.client_hostname, sqlserver.database_name, sqlserver.session_id, sqlserver.sql_text)",
        ")",
        `ADD TARGET package0.event_file(SET filename=N'${filePath}', max_file_size=(${maxFileSizeMb}), max_rollover_files=(1))`,
        "WITH (MAX_MEMORY=4096 KB, EVENT_RETENTION_MODE=ALLOW_SINGLE_EVENT_LOSS, MAX_DISPATCH_LATENCY=5 SECONDS, MAX_EVENT_SIZE=0 KB, MEMORY_PARTITION_MODE=NONE, TRACK_CAUSALITY=ON, STARTUP_STATE=OFF);",
        `ALTER EVENT SESSION [${sessionName}] ON SERVER STATE = START;`,
    ].join("\n");
}

export function buildReadLocalXeventFilePathSql(sessionName: string): string {
    requireSessionName(sessionName);
    return [
        "SELECT CAST(t.target_data AS xml).value('(/EventFileTarget/File/@name)[1]', 'nvarchar(4000)') AS [XelFilePath]",
        "FROM sys.dm_xe_session_targets AS t",
        "INNER JOIN sys.dm_xe_sessions AS s ON s.address = t.event_session_address",
        `WHERE s.name = N'${sessionName}' AND t.target_name = N'event_file';`,
    ].join("\n");
}

export function buildStopLocalXeventSql(sessionName: string): string {
    requireSessionName(sessionName);
    const basePath = localXeventBasePath(sessionName);
    return [
        `IF NOT EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = N'${sessionName}')`,
        "    THROW 51001, 'Runbook Studio XEvent session was not found.', 1;",
        "DECLARE @rbsXelPath nvarchar(4000) = (",
        "    SELECT CAST(t.target_data AS xml).value('(/EventFileTarget/File/@name)[1]', 'nvarchar(4000)')",
        "    FROM sys.dm_xe_session_targets AS t",
        "    INNER JOIN sys.dm_xe_sessions AS s ON s.address = t.event_session_address",
        `    WHERE s.name = N'${sessionName}' AND t.target_name = N'event_file'`,
        ");",
        "IF @rbsXelPath IS NULL",
        "    THROW 51002, 'Runbook Studio XEvent file target was not found.', 1;",
        `IF @rbsXelPath <> N'${basePath}' AND @rbsXelPath NOT LIKE N'${XEL_DIRECTORY}/${sessionName}[_]%.xel'`,
        "    THROW 51003, 'Runbook Studio XEvent file target changed.', 1;",
        `IF EXISTS (SELECT 1 FROM sys.dm_xe_sessions WHERE name = N'${sessionName}')`,
        `    ALTER EVENT SESSION [${sessionName}] ON SERVER STATE = STOP;`,
        "DECLARE @rbsEventCount bigint = (SELECT COUNT_BIG(*) FROM sys.fn_xe_file_target_read_file(@rbsXelPath, NULL, NULL, NULL));",
        `DROP EVENT SESSION [${sessionName}] ON SERVER;`,
        "SELECT @rbsXelPath AS [XelFilePath], @rbsEventCount AS [EventCount];",
    ].join("\n");
}

/**
 * Idempotent failure-path cleanup. It accepts only the ownership-derived
 * session name, stops/drops that exact session when it still exists, and can
 * rediscover its single retained rollover file after a crash between the SQL
 * effect and the local ledger append. A recovered capture is intentionally
 * classified incomplete by the caller; this query never promotes it to
 * release evidence.
 */
export function buildReconcileLocalXeventSql(sessionName: string): string {
    requireSessionName(sessionName);
    const basePath = localXeventBasePath(sessionName);
    const wildcardPath = `${XEL_DIRECTORY}/${sessionName}*.xel`;
    return [
        "SET NOCOUNT ON;",
        "DECLARE @rbsXelPath nvarchar(4000);",
        `IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = N'${sessionName}')`,
        "BEGIN",
        "    SELECT @rbsXelPath = CAST(t.target_data AS xml).value('(/EventFileTarget/File/@name)[1]', 'nvarchar(4000)')",
        "    FROM sys.dm_xe_session_targets AS t",
        "    INNER JOIN sys.dm_xe_sessions AS s ON s.address = t.event_session_address",
        `    WHERE s.name = N'${sessionName}' AND t.target_name = N'event_file';`,
        `    IF EXISTS (SELECT 1 FROM sys.dm_xe_sessions WHERE name = N'${sessionName}')`,
        `        ALTER EVENT SESSION [${sessionName}] ON SERVER STATE = STOP;`,
        `    DROP EVENT SESSION [${sessionName}] ON SERVER;`,
        "END;",
        "IF @rbsXelPath IS NULL",
        "BEGIN",
        "    SELECT TOP (1) @rbsXelPath = [file_name]",
        `    FROM sys.fn_xe_file_target_read_file(N'${wildcardPath}', NULL, NULL, NULL)`,
        "    ORDER BY [file_name] DESC;",
        "END;",
        "IF @rbsXelPath IS NULL",
        "    THROW 51004, 'Runbook Studio XEvent capture could not be reconciled.', 1;",
        `IF @rbsXelPath <> N'${basePath}' AND @rbsXelPath NOT LIKE N'${XEL_DIRECTORY}/${sessionName}[_]%.xel'`,
        "    THROW 51003, 'Runbook Studio XEvent file target changed.', 1;",
        "DECLARE @rbsEventCount bigint = (SELECT COUNT_BIG(*) FROM sys.fn_xe_file_target_read_file(@rbsXelPath, NULL, NULL, NULL));",
        "SELECT @rbsXelPath AS [XelFilePath], @rbsEventCount AS [EventCount];",
    ].join("\n");
}

/** Perftest-style correlation over the retained XEL. Prefer the exact
 * run-specific application name. Some classic STS hosts replace the supplied
 * application name; in that case, fall back to the unique database on the
 * same-run owned disposable container. SQL text is deliberately excluded
 * from the result contract. */
export function buildAnalyzeLocalXeventSql(
    sessionName: string,
    serverPath: string,
    databaseName: string,
    applicationName: string,
): string {
    const validatedPath = validateLocalXelServerPath(sessionName, serverPath);
    if (
        !databaseName ||
        databaseName.length > 128 ||
        !applicationName ||
        applicationName.length > 128
    ) {
        throw new LocalXeventPolicyError("invalidServerPath");
    }
    const pathLiteral = sqlLiteral(validatedPath);
    const databaseLiteral = sqlLiteral(databaseName);
    const applicationLiteral = sqlLiteral(applicationName);
    return [
        "SET NOCOUNT ON;",
        "WITH [raw] AS (",
        "    SELECT CAST([event_data] AS xml) AS [event_xml]",
        `    FROM sys.fn_xe_file_target_read_file(N'${pathLiteral}', NULL, NULL, NULL)`,
        "), [parsed] AS (",
        "    SELECT",
        "        [event_xml].value('(/event/@name)[1]', 'nvarchar(64)') AS [event_name],",
        "        [event_xml].value('(/event/@timestamp)[1]', 'datetime2(7)') AS [timestamp_utc],",
        "        [event_xml].value('(/event/action[@name=''client_app_name'']/value)[1]', 'nvarchar(256)') AS [client_app_name],",
        "        [event_xml].value('(/event/action[@name=''database_name'']/value)[1]', 'nvarchar(128)') AS [database_name],",
        "        [event_xml].value('(/event/data[@name=''duration'']/value)[1]', 'bigint') AS [duration_us],",
        "        [event_xml].value('(/event/data[@name=''cpu_time'']/value)[1]', 'bigint') AS [cpu_time_us],",
        "        [event_xml].value('(/event/data[@name=''logical_reads'']/value)[1]', 'bigint') AS [logical_reads],",
        "        [event_xml].value('(/event/data[@name=''physical_reads'']/value)[1]', 'bigint') AS [physical_reads],",
        "        [event_xml].value('(/event/data[@name=''writes'']/value)[1]', 'bigint') AS [writes],",
        "        [event_xml].value('(/event/data[@name=''row_count'']/value)[1]', 'bigint') AS [row_count],",
        "        [event_xml].value('(/event/data[@name=''object_name'']/value)[1]', 'nvarchar(256)') AS [object_name],",
        "        [event_xml].value('(/event/data[@name=''error_number'']/value)[1]', 'int') AS [error_number]",
        "    FROM [raw]",
        "), [database_events] AS (",
        "    SELECT * FROM [parsed]",
        `    WHERE [database_name] = N'${databaseLiteral}'`,
        "), [correlated] AS (",
        "    SELECT * FROM [database_events]",
        `    WHERE [client_app_name] = N'${applicationLiteral}'`,
        "       OR NOT EXISTS (",
        "           SELECT 1 FROM [database_events]",
        `           WHERE [client_app_name] = N'${applicationLiteral}'`,
        "       )",
        ")",
        `SELECT TOP (${MAX_LOCAL_XEVENT_ANALYSIS_ROWS})`,
        "    CONVERT(nvarchar(33), [timestamp_utc], 127) AS [timestamp_utc], [event_name],",
        "    CAST(COALESCE([duration_us], 0) / 1000.0 AS float) AS [duration_ms],",
        "    CAST(COALESCE([cpu_time_us], 0) / 1000.0 AS float) AS [cpu_ms],",
        "    COALESCE([logical_reads], 0) AS [logical_reads],",
        "    COALESCE([physical_reads], 0) AS [physical_reads],",
        "    COALESCE([writes], 0) AS [writes],",
        "    COALESCE([row_count], 0) AS [row_count],",
        "    COALESCE([object_name], N'') AS [object_name],",
        "    COALESCE([error_number], 0) AS [error_number],",
        "    COUNT_BIG(*) OVER () AS [total_event_count],",
        "    CAST(SUM(COALESCE([duration_us], 0)) OVER () / 1000.0 AS float) AS [total_duration_ms],",
        "    CAST(SUM(COALESCE([cpu_time_us], 0)) OVER () / 1000.0 AS float) AS [total_cpu_ms],",
        "    SUM(COALESCE([logical_reads], 0)) OVER () AS [total_logical_reads],",
        "    SUM(COALESCE([physical_reads], 0)) OVER () AS [total_physical_reads],",
        "    SUM(COALESCE([writes], 0)) OVER () AS [total_writes]",
        "FROM [correlated]",
        "ORDER BY [timestamp_utc], [event_name];",
    ].join("\n");
}

export function validateLocalXelServerPath(sessionName: string, serverPath: string): string {
    requireSessionName(sessionName);
    const normalized = path.posix.normalize(serverPath.trim().replace(/\\/g, "/"));
    const fileName = path.posix.basename(normalized);
    if (
        path.posix.dirname(normalized) !== XEL_DIRECTORY ||
        (!fileName.startsWith(`${sessionName}_`) && fileName !== `${sessionName}.xel`) ||
        !fileName.toLowerCase().endsWith(".xel")
    ) {
        throw new LocalXeventPolicyError("invalidServerPath");
    }
    return normalized;
}

export function extractLocalXelFromDockerArchive(
    archive: Buffer,
    expectedFileName: string,
): Buffer {
    if (
        archive.length === 0 ||
        archive.length > MAX_LOCAL_XEL_ARCHIVE_BYTES ||
        path.posix.basename(expectedFileName) !== expectedFileName ||
        !expectedFileName.toLowerCase().endsWith(".xel")
    ) {
        throw new LocalXeventPolicyError("invalidArchive");
    }
    let offset = 0;
    let found: Buffer | undefined;
    while (offset + 512 <= archive.length) {
        const header = archive.subarray(offset, offset + 512);
        if (header.every((value) => value === 0)) {
            break;
        }
        const name = readTarString(header.subarray(0, 100));
        const sizeText = readTarString(header.subarray(124, 136)).trim();
        const size = Number.parseInt(sizeText || "0", 8);
        const type = header[156];
        if (!Number.isSafeInteger(size) || size < 0) {
            throw new LocalXeventPolicyError("invalidArchive");
        }
        const dataStart = offset + 512;
        const dataEnd = dataStart + size;
        if (dataEnd > archive.length) {
            throw new LocalXeventPolicyError("invalidArchive");
        }
        const regularFile = type === 0 || type === 48;
        if (regularFile && path.posix.basename(name) === expectedFileName) {
            if (found || size === 0) {
                throw new LocalXeventPolicyError("invalidArchive");
            }
            if (size > MAX_LOCAL_XEL_ARTIFACT_BYTES) {
                throw new LocalXeventPolicyError("artifactTooLarge");
            }
            found = Buffer.from(archive.subarray(dataStart, dataEnd));
        }
        offset = dataStart + Math.ceil(size / 512) * 512;
    }
    if (!found) {
        throw new LocalXeventPolicyError("invalidArchive");
    }
    return found;
}

function requireSessionName(sessionName: string): void {
    if (!XEVENT_SESSION_NAME.test(sessionName)) {
        throw new LocalXeventPolicyError("invalidSession");
    }
}

function sqlLiteral(value: string): string {
    if (/\u0000/.test(value)) {
        throw new LocalXeventPolicyError("invalidServerPath");
    }
    return value.replace(/'/g, "''");
}

function readTarString(bytes: Buffer): string {
    const end = bytes.indexOf(0);
    return bytes.subarray(0, end < 0 ? bytes.length : end).toString("utf8");
}
