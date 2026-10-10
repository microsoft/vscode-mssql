/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { sqlDateTime2UtcLiteral, sqlNStringLiteral } from "../common/literals";
import { PlatformInfo } from "../common/platform";
import { maxDopOneHint, sessionPreamble } from "../common/session";
import {
    SqlReadOptions,
    SqlReader,
    SqlResultSet,
    parseSqlDateTime,
    readNumber,
    toRecords,
} from "../common/sqlReader";
import { PerfResult, errorResult, unsupportedResult } from "./result";

/*
 * The CPU, memory, and storage history of an Azure SQL Database, and the recent CPU and memory of
 * a SQL database in Fabric. The views store UTC times as `datetime`, without an offset, so the
 * times are read as UTC.
 */

/** One row of a resource stats view. Times are ISO 8601 UTC. */
export interface ResourceCpuSample {
    readonly startUtc: string;
    readonly endUtc: string;
    /** Percent of the CPU limit of the database. */
    readonly avgCpuPercent: number;
    /** Percent of the memory limit of the database. */
    readonly avgMemoryPercent?: number;
    /** The data size in MB. Only in `sys.resource_stats`. */
    readonly storageMb?: number;
}

export interface ServerResourceCpuRequest {
    /** The database to read, as `sys.resource_stats.database_name` has it. */
    readonly databaseName: string;
    readonly start: Date;
    readonly end: Date;
}

/** `sys.dm_db_resource_stats` has one row for each 15 seconds. */
const databaseResourceStatsRowMs = 15 * 1000;
const maxDatabaseNameLength = 128;

/**
 * sys.dm_db_resource_stats in the user database: one row each 15 seconds for about 1 hour.
 * start = end_time - 15 s. Run it on the user database. Azure SQL Database and SQL database in
 * Fabric; `unsupported` elsewhere. Needs VIEW DATABASE STATE. `noData` (with an empty array) when the view has no rows,
 * for example just after a failover. Ordered by time.
 */
export async function readDatabaseResourceCpu(
    reader: SqlReader,
    info: PlatformInfo,
    options?: SqlReadOptions,
    now: Date = new Date(),
): Promise<PerfResult<ResourceCpuSample[]>> {
    if (!hasDatabaseResourceStats(info)) {
        return unsupportedResult(info, now);
    }
    try {
        const [resultSet] = await reader.read(buildDatabaseResourceCpuQuery(info), options);
        return samplesResult(info, now, toDatabaseSamples(resultSet));
    } catch (error) {
        return errorResult(info, error, now, "dmv");
    }
}

/**
 * master.sys.resource_stats, read on a session connected to the master database: one row each 5
 * minutes for about 14 days. A row counts when its start_time is in [start, end). Azure SQL
 * Database only; `unsupported` elsewhere. The reader must be connected to `master` of the same
 * logical server, with a login that can connect to `master`. Run on a user database, the read
 * fails with error 208 (`unsupported`). `noData` (with an empty array) when the database has no
 * rows in the window, for example an idle database. Ordered by start_time.
 */
export async function readServerResourceCpu(
    reader: SqlReader,
    info: PlatformInfo,
    request: ServerResourceCpuRequest,
    options?: SqlReadOptions,
    now: Date = new Date(),
): Promise<PerfResult<ResourceCpuSample[]>> {
    const sql = buildServerResourceCpuQuery(info, request);
    if (info.platform !== "azureSqlDatabase") {
        return unsupportedResult(info, now);
    }
    try {
        const [resultSet] = await reader.read(sql, options);
        return samplesResult(info, now, toServerSamples(resultSet));
    } catch (error) {
        return errorResult(info, error, now, "dmv");
    }
}

/** Returns the batch of {@link readDatabaseResourceCpu}. Exported for tests. */
export function buildDatabaseResourceCpuQuery(info: PlatformInfo): string {
    return `${sessionPreamble(info, "read")}
SELECT
    end_time,
    avg_cpu_percent,
    avg_memory_usage_percent
FROM sys.dm_db_resource_stats
ORDER BY end_time${maxDopOneHint(info)};`;
}

/**
 * Returns the batch of {@link readServerResourceCpu}. Throws a `RangeError` for a database name
 * or a window that is not valid. Exported for tests.
 */
export function buildServerResourceCpuQuery(
    info: PlatformInfo,
    request: ServerResourceCpuRequest,
): string {
    if (!request || typeof request !== "object") {
        throw new RangeError("The request must be an object.");
    }
    const name = request.databaseName;
    if (typeof name !== "string" || name.trim() === "" || name.length > maxDatabaseNameLength) {
        throw new RangeError(`"${String(name)}" is not a database name.`);
    }
    // The literal functions check the dates.
    const start = sqlDateTime2UtcLiteral(request.start);
    const end = sqlDateTime2UtcLiteral(request.end);
    if (request.start.getTime() >= request.end.getTime()) {
        throw new RangeError("The start of the window must be before its end.");
    }
    return `${sessionPreamble(info, "read")}
SELECT
    start_time,
    end_time,
    avg_cpu_percent,
    avg_memory_usage_percent,
    storage_in_megabytes
FROM sys.resource_stats
WHERE database_name = ${sqlNStringLiteral(name)}
    AND start_time >= ${start}
    AND start_time < ${end}
ORDER BY start_time;`;
}

function toDatabaseSamples(resultSet: SqlResultSet | undefined): ResourceCpuSample[] {
    const samples: ResourceCpuSample[] = [];
    for (const record of toRecords(resultSet)) {
        const end = parseSqlDateTime(record.end_time);
        if (!end) {
            continue;
        }
        samples.push({
            startUtc: new Date(end.getTime() - databaseResourceStatsRowMs).toISOString(),
            endUtc: end.toISOString(),
            avgCpuPercent: readNumber(record, "avg_cpu_percent") ?? 0,
            ...optionalNumber("avgMemoryPercent", readNumber(record, "avg_memory_usage_percent")),
        });
    }
    return samples;
}

function toServerSamples(resultSet: SqlResultSet | undefined): ResourceCpuSample[] {
    const samples: ResourceCpuSample[] = [];
    for (const record of toRecords(resultSet)) {
        const start = parseSqlDateTime(record.start_time);
        const end = parseSqlDateTime(record.end_time);
        if (!start || !end) {
            continue;
        }
        samples.push({
            startUtc: start.toISOString(),
            endUtc: end.toISOString(),
            avgCpuPercent: readNumber(record, "avg_cpu_percent") ?? 0,
            ...optionalNumber("avgMemoryPercent", readNumber(record, "avg_memory_usage_percent")),
            ...optionalNumber("storageMb", readNumber(record, "storage_in_megabytes")),
        });
    }
    return samples;
}

/** The memory that the database's SQL process may use, which memory percents are of. */
export interface MemoryLimit {
    readonly memoryLimitMb: number;
}

/**
 * Reads the memory limit of the database's SQL process from `sys.dm_os_job_object`, to turn the
 * memory percent of the resource stats into MB. Azure SQL Database and SQL database in Fabric;
 * `unsupported` elsewhere. Needs VIEW DATABASE STATE. `noData` when the view has no limit.
 */
export async function readDatabaseMemoryLimit(
    reader: SqlReader,
    info: PlatformInfo,
    options?: SqlReadOptions,
    now: Date = new Date(),
): Promise<PerfResult<MemoryLimit>> {
    if (!hasDatabaseResourceStats(info)) {
        return unsupportedResult(info, now);
    }
    try {
        const [resultSet] = await reader.read(buildDatabaseMemoryLimitQuery(info), options);
        const record = toRecords(resultSet)[0];
        const limit = record ? readNumber(record, "process_memory_limit_mb") : undefined;
        return {
            status: limit !== undefined && limit > 0 ? "ready" : "noData",
            platform: info.platform,
            source: "dmv",
            scope: "database",
            observedAtUtc: now.toISOString(),
            ...(limit !== undefined && limit > 0 ? { data: { memoryLimitMb: limit } } : {}),
            missing: [],
        };
    } catch (error) {
        return errorResult(info, error, now, "dmv");
    }
}

/** Returns the batch of {@link readDatabaseMemoryLimit}. Exported for tests. */
export function buildDatabaseMemoryLimitQuery(info: PlatformInfo): string {
    return `${sessionPreamble(info, "read")}
SELECT process_memory_limit_mb
FROM sys.dm_os_job_object;`;
}

/**
 * True when the database has `sys.dm_db_resource_stats`: Azure SQL Database and SQL database in
 * Fabric.
 */
export function hasDatabaseResourceStats(info: PlatformInfo): boolean {
    return info.platform === "azureSqlDatabase" || info.platform === "fabricSqlDatabase";
}

/** `{ [key]: value }`, or nothing when the value is not known. */
function optionalNumber<K extends string>(
    key: K,
    value: number | undefined,
): { [P in K]?: number } {
    return (value === undefined ? {} : { [key]: value }) as { [P in K]?: number };
}

function samplesResult(
    info: PlatformInfo,
    now: Date,
    samples: ResourceCpuSample[],
): PerfResult<ResourceCpuSample[]> {
    return {
        status: samples.length > 0 ? "ready" : "noData",
        platform: info.platform,
        source: "dmv",
        scope: "database",
        observedAtUtc: now.toISOString(),
        data: samples,
        missing: [],
    };
}
