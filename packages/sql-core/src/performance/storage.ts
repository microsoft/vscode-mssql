/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PlatformInfo } from "../common/platform";
import { maxDopOneHint, sessionPreamble } from "../common/session";
import {
    SqlReadOptions,
    SqlReader,
    SqlRecord,
    readNumber,
    readString,
    toRecords,
} from "../common/sqlReader";
import { PerfResult, errorResult, unsupportedResult } from "./result";

/*
 * The storage of the current database: the size of its data files, the space used in them, the
 * size limit on Azure SQL Database, and the user tables. Sizes are MB.
 */

/** A table and its size, from `sys.dm_db_partition_stats`. */
export interface TableStorage {
    readonly schemaName: string;
    readonly tableName: string;
    /** The rows of the heap or the clustered index. */
    readonly rowCount: number;
    /** The pages in use by all its indexes, in MB. */
    readonly usedMb: number;
    /** The pages reserved by all its indexes, in MB. */
    readonly reservedMb: number;
}

export interface DatabaseStorage {
    /** The size of the data files. */
    readonly allocatedMb: number;
    /** The space used in the data files. */
    readonly usedMb: number;
    /** The size limit of the database, on Azure SQL Database. */
    readonly maxSizeMb?: number;
    /** The user tables by used space, largest first. */
    readonly tables: readonly TableStorage[];
}

const megabytesPerPage = 8 / 1024;

/** True when the database has its files and partition stats: the SQL engine platforms. */
export function hasDatabaseStorage(info: PlatformInfo): boolean {
    switch (info.platform) {
        case "sqlServer":
        case "azureSqlManagedInstance":
        case "azureSqlDatabase":
        case "fabricSqlDatabase":
            return true;
        default:
            return false;
    }
}

/**
 * Reads the size of the data files, the space used in them, the size limit, and all user
 * tables. SQL Server, Managed Instance, Azure SQL Database, and SQL database in Fabric;
 * `unsupported` elsewhere. The tables need VIEW DATABASE STATE; a missing permission gives
 * `permissionMissing`.
 */
export async function readDatabaseStorage(
    reader: SqlReader,
    info: PlatformInfo,
    options: SqlReadOptions = {},
    now: Date = new Date(),
): Promise<PerfResult<DatabaseStorage>> {
    if (!hasDatabaseStorage(info)) {
        return unsupportedResult(info, now);
    }
    const sql = buildDatabaseStorageQuery(info);
    try {
        const [fileSet, tableSet] = await reader.read(sql, options);
        const files = toRecords(fileSet)[0];
        const number = (column: string) => (files ? readNumber(files, column) : undefined);
        const maxSizeBytes = number("max_size_bytes");
        return {
            status: "ready",
            platform: info.platform,
            source: "dmv",
            scope: "database",
            observedAtUtc: now.toISOString(),
            data: {
                allocatedMb: (number("allocated_pages") ?? 0) * megabytesPerPage,
                usedMb: (number("used_pages") ?? 0) * megabytesPerPage,
                // SQL Server has no limit; MaxSizeInBytes is NULL or -1 there.
                ...(maxSizeBytes !== undefined && maxSizeBytes > 0
                    ? { maxSizeMb: maxSizeBytes / (1024 * 1024) }
                    : {}),
                tables: toRecords(tableSet).map(toTableStorage),
            },
            missing: [],
        };
    } catch (error) {
        return errorResult(info, error, now, "dmv");
    }
}

/**
 * Returns the batch of {@link readDatabaseStorage}: the data files and the size limit, and then
 * all user tables. Exported for tests.
 */
export function buildDatabaseStorageQuery(info: PlatformInfo): string {
    return `${sessionPreamble(info, "read")}
SELECT
    SUM(CAST(f.size AS bigint)) AS allocated_pages,
    SUM(CAST(FILEPROPERTY(f.name, 'SpaceUsed') AS bigint)) AS used_pages,
    CAST(DATABASEPROPERTYEX(DB_NAME(), 'MaxSizeInBytes') AS bigint) AS max_size_bytes
FROM sys.database_files AS f
WHERE f.type = 0;
SELECT
    s.name AS schema_name,
    t.name AS table_name,
    COALESCE(SUM(CASE WHEN ps.index_id IN (0, 1) THEN ps.row_count ELSE 0 END), 0) AS row_count,
    COALESCE(SUM(ps.used_page_count), 0) AS used_pages,
    COALESCE(SUM(ps.reserved_page_count), 0) AS reserved_pages
FROM sys.tables AS t
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
LEFT JOIN sys.dm_db_partition_stats AS ps ON ps.object_id = t.object_id
WHERE t.is_ms_shipped = 0
GROUP BY s.name, t.name
ORDER BY used_pages DESC, s.name, t.name${maxDopOneHint(info)};`;
}

function toTableStorage(record: SqlRecord): TableStorage {
    return {
        schemaName: readString(record, "schema_name") ?? "",
        tableName: readString(record, "table_name") ?? "",
        rowCount: readNumber(record, "row_count") ?? 0,
        usedMb: (readNumber(record, "used_pages") ?? 0) * megabytesPerPage,
        reservedMb: (readNumber(record, "reserved_pages") ?? 0) * megabytesPerPage,
    };
}
