/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { quoteSqlIdentifier, sqlNStringLiteral } from "../common/literals";
import { PlatformInfo } from "../common/platform";
import { sessionPreamble } from "../common/session";
import {
    SqlReadOptions,
    SqlReader,
    SqlRecord,
    readNumber,
    readString,
    toRecords,
} from "../common/sqlReader";
import { PerfResult, errorResult, unsupportedResult } from "./result";
import { hasDatabaseStorage } from "./storage";

/*
 * One table: how its space splits between its data and each index, what row or page compression
 * would save, and the change that applies the compression. Sizes are KB.
 */

export interface TableName {
    readonly schemaName: string;
    readonly tableName: string;
}

/** The kind of an index. The heap or the clustered index holds the table's data. */
export type TableIndexKind =
    | "heap"
    | "clustered"
    | "nonclustered"
    | "clusteredColumnstore"
    | "nonclusteredColumnstore"
    | "other";

export interface TableIndex {
    readonly indexId: number;
    /** No name for a heap. */
    readonly indexName?: string;
    readonly kind: TableIndexKind;
    /** The `sys.indexes.type_desc` value, for kinds that the dashboard does not name. */
    readonly typeDesc: string;
    /** The pages in use, in KB: in-row, LOB, and row-overflow. */
    readonly usedKb: number;
    readonly rowCount: number;
    /** The compression of the index, for example NONE, ROW, or PAGE. Mixed partitions show one. */
    readonly compression?: string;
}

export interface TableIndexes {
    readonly indexes: readonly TableIndex[];
}

export type DataCompression = "row" | "page";

export interface CompressionEstimateIndex {
    readonly indexId: number;
    readonly indexName?: string;
    readonly currentKb: number;
    readonly estimatedKb: number;
}

export interface CompressionEstimate {
    readonly compression: DataCompression;
    readonly indexes: readonly CompressionEstimateIndex[];
}

/** Why a compression change cannot run. */
export type CompressionChangeBlocker = "tableNotFound" | "columnstoreTable" | "preparedSqlMismatch";

export interface PreparedCompressionChange {
    readonly kind: "tableCompression";
    readonly table: TableName;
    readonly compression: DataCompression;
    /** The batch to run: the change preamble and a rebuild of the data and each rowstore index. */
    readonly sql: string;
    /** The columnstore and other indexes that the change leaves as they are. */
    readonly skippedIndexes: readonly string[];
    readonly blockers: readonly CompressionChangeBlocker[];
}

export interface AppliedCompressionChange {
    readonly applied: boolean;
    readonly blockers: readonly CompressionChangeBlocker[];
}

const kilobytesPerPage = 8;

/** The `OBJECT_ID` argument of a table: its delimited two-part name, as a string literal. */
function objectNameLiteral(table: TableName): string {
    return sqlNStringLiteral(
        `${quoteSqlIdentifier(table.schemaName)}.${quoteSqlIdentifier(table.tableName)}`,
    );
}

function base(info: PlatformInfo, now: Date) {
    return {
        platform: info.platform,
        source: "dmv",
        scope: "database",
        observedAtUtc: now.toISOString(),
        missing: [],
    } as const;
}

/**
 * Reads the indexes of a table and the space that each uses. SQL Server, Managed Instance, Azure
 * SQL Database, and SQL database in Fabric; `unsupported` elsewhere. Needs VIEW DATABASE STATE.
 */
export async function readTableIndexes(
    reader: SqlReader,
    info: PlatformInfo,
    table: TableName,
    options: SqlReadOptions = {},
    now: Date = new Date(),
): Promise<PerfResult<TableIndexes>> {
    if (!hasDatabaseStorage(info)) {
        return unsupportedResult(info, now);
    }
    try {
        const [resultSet] = await reader.read(buildTableIndexesQuery(info, table), options);
        return {
            ...base(info, now),
            status: "ready",
            data: { indexes: toRecords(resultSet).map(toTableIndex) },
        };
    } catch (error) {
        return errorResult(info, error, now, "dmv");
    }
}

/** Returns the batch of {@link readTableIndexes}. Exported for tests. */
export function buildTableIndexesQuery(info: PlatformInfo, table: TableName): string {
    return `${sessionPreamble(info, "read")}
SELECT
    i.index_id,
    i.name AS index_name,
    i.type_desc,
    COALESCE(SUM(ps.used_page_count), 0) AS used_pages,
    COALESCE(SUM(ps.row_count), 0) AS row_count,
    MAX(p.data_compression_desc) AS data_compression
FROM sys.indexes AS i
LEFT JOIN sys.dm_db_partition_stats AS ps
    ON ps.object_id = i.object_id AND ps.index_id = i.index_id
LEFT JOIN sys.partitions AS p ON p.partition_id = ps.partition_id
WHERE i.object_id = OBJECT_ID(${objectNameLiteral(table)})
GROUP BY i.index_id, i.name, i.type_desc
ORDER BY used_pages DESC, i.index_id;`;
}

function indexKind(typeDesc: string): TableIndexKind {
    switch (typeDesc.toUpperCase()) {
        case "HEAP":
            return "heap";
        case "CLUSTERED":
            return "clustered";
        case "NONCLUSTERED":
            return "nonclustered";
        case "CLUSTERED COLUMNSTORE":
            return "clusteredColumnstore";
        case "NONCLUSTERED COLUMNSTORE":
            return "nonclusteredColumnstore";
        default:
            return "other";
    }
}

function toTableIndex(record: SqlRecord): TableIndex {
    const typeDesc = readString(record, "type_desc") ?? "";
    return {
        indexId: readNumber(record, "index_id") ?? 0,
        indexName: readString(record, "index_name"),
        kind: indexKind(typeDesc),
        typeDesc,
        usedKb: (readNumber(record, "used_pages") ?? 0) * kilobytesPerPage,
        rowCount: readNumber(record, "row_count") ?? 0,
        compression: readString(record, "data_compression"),
    };
}

/**
 * Estimates the size of each index of a table with row or page compression, with
 * `sp_estimate_data_compression_savings`. It samples the table into tempdb and changes nothing.
 */
export async function estimateCompressionSavings(
    reader: SqlReader,
    info: PlatformInfo,
    table: TableName,
    compression: DataCompression,
    options: SqlReadOptions = {},
    now: Date = new Date(),
): Promise<PerfResult<CompressionEstimate>> {
    if (!hasDatabaseStorage(info)) {
        return unsupportedResult(info, now);
    }
    try {
        const [resultSet] = await reader.read(
            buildCompressionEstimateQuery(info, table, compression),
            options,
        );
        return {
            ...base(info, now),
            status: "ready",
            data: {
                compression,
                indexes: toRecords(resultSet).map((record) => ({
                    indexId: readNumber(record, "index_id") ?? 0,
                    indexName: readString(record, "index_name"),
                    currentKb: readNumber(record, "current_kb") ?? 0,
                    estimatedKb: readNumber(record, "estimated_kb") ?? 0,
                })),
            },
        };
    } catch (error) {
        return errorResult(info, error, now, "dmv");
    }
}

/** Returns the batch of {@link estimateCompressionSavings}. Exported for tests. */
export function buildCompressionEstimateQuery(
    info: PlatformInfo,
    table: TableName,
    compression: DataCompression,
): string {
    return `${sessionPreamble(info, "read")}
DECLARE @estimate TABLE (
    object_name sysname NOT NULL,
    schema_name sysname NOT NULL,
    index_id int NOT NULL,
    partition_number int NOT NULL,
    size_with_current_compression_setting bigint NULL,
    size_with_requested_compression_setting bigint NULL,
    sample_size_with_current_compression_setting bigint NULL,
    sample_size_with_requested_compression_setting bigint NULL
);
INSERT INTO @estimate
EXEC sys.sp_estimate_data_compression_savings
    @schema_name = ${sqlNStringLiteral(table.schemaName)},
    @object_name = ${sqlNStringLiteral(table.tableName)},
    @index_id = NULL,
    @partition_number = NULL,
    @data_compression = ${compression === "page" ? "N'PAGE'" : "N'ROW'"};
SELECT
    e.index_id,
    i.name AS index_name,
    SUM(e.size_with_current_compression_setting) AS current_kb,
    SUM(e.size_with_requested_compression_setting) AS estimated_kb
FROM @estimate AS e
LEFT JOIN sys.indexes AS i
    ON i.object_id = OBJECT_ID(${objectNameLiteral(table)}) AND i.index_id = e.index_id
GROUP BY e.index_id, i.name
ORDER BY current_kb DESC, e.index_id;`;
}

/**
 * Prepares the change that compresses a table and its rowstore indexes, for review. It reads the
 * indexes and changes nothing. The change rebuilds the heap or the clustered index and each
 * nonclustered rowstore index; columnstore and other indexes stay as they are.
 */
export async function prepareCompressionChange(
    reader: SqlReader,
    info: PlatformInfo,
    table: TableName,
    compression: DataCompression,
    options: SqlReadOptions = {},
    now: Date = new Date(),
): Promise<PerfResult<PreparedCompressionChange>> {
    const read = await readTableIndexes(reader, info, table, options, now);
    if (!read.data) {
        return { ...read, data: undefined };
    }
    return { ...read, data: buildCompressionChange(info, table, compression, read.data.indexes) };
}

/**
 * Builds the change that compresses a table from its indexes. Exported for tests.
 */
export function buildCompressionChange(
    info: PlatformInfo,
    table: TableName,
    compression: DataCompression,
    indexes: readonly TableIndex[],
): PreparedCompressionChange {
    const option = compression === "page" ? "PAGE" : "ROW";
    const target = `${quoteSqlIdentifier(table.schemaName)}.${quoteSqlIdentifier(table.tableName)}`;
    const blockers: CompressionChangeBlocker[] = [];
    if (indexes.length === 0) {
        blockers.push("tableNotFound");
    }
    if (indexes.some((index) => index.kind === "clusteredColumnstore")) {
        blockers.push("columnstoreTable");
    }
    const statements = [
        `ALTER TABLE ${target} REBUILD PARTITION = ALL WITH (DATA_COMPRESSION = ${option});`,
    ];
    const skippedIndexes: string[] = [];
    for (const index of indexes) {
        if (index.kind === "nonclustered" && index.indexName) {
            statements.push(
                `ALTER INDEX ${quoteSqlIdentifier(index.indexName)} ON ${target} REBUILD PARTITION = ALL WITH (DATA_COMPRESSION = ${option});`,
            );
        } else if (index.kind !== "heap" && index.kind !== "clustered" && index.indexName) {
            skippedIndexes.push(index.indexName);
        }
    }
    return {
        kind: "tableCompression",
        table,
        compression,
        sql: `${sessionPreamble(info, "change")}\n${statements.join("\n")}`,
        skippedIndexes,
        blockers,
    };
}

/**
 * Runs a prepared compression change on the "change" session, after it reads the indexes again
 * and builds the same SQL. A change whose SQL differs, because the indexes changed or the SQL
 * did not come from {@link prepareCompressionChange}, is refused.
 */
export async function applyCompressionChange(
    reader: SqlReader,
    info: PlatformInfo,
    prepared: PreparedCompressionChange,
    options: SqlReadOptions = {},
    now: Date = new Date(),
): Promise<PerfResult<AppliedCompressionChange>> {
    if (prepared.kind !== "tableCompression") {
        throw new RangeError(`"${String(prepared.kind)}" is not a compression change.`);
    }
    const again = await prepareCompressionChange(
        reader,
        info,
        prepared.table,
        prepared.compression,
        options,
        now,
    );
    if (!again.data) {
        return { ...again, data: undefined };
    }
    const refuse = (blockers: CompressionChangeBlocker[]) => ({
        ...again,
        data: { applied: false, blockers },
    });
    if (again.data.blockers.length > 0) {
        return refuse([...again.data.blockers]);
    }
    if (again.data.sql !== prepared.sql) {
        return refuse(["preparedSqlMismatch"]);
    }
    try {
        await reader.read(prepared.sql, options);
        return { ...again, data: { applied: true, blockers: [] } };
    } catch (error) {
        return errorResult(info, error, now, "dmv");
    }
}
