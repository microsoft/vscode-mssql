/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Describes an editable object from the catalog views.
 *
 * This replaces the SMO object model the old editor used. SMO hydrates a whole server-side
 * object graph to answer a handful of questions and costs several round trips to do it; two
 * catalog queries answer the same questions in one pass, and they work against every edition,
 * including the ones where SMO is unavailable.
 */

import { SqlEditError, qualifiedName, stringLiteral } from "../core/sql";
import { ColumnTypeInfo, isWritableType } from "../types/valueCodec";
import { SqlRunner } from "../core/types";

export interface ColumnMetadata extends ColumnTypeInfo {
    readonly name: string;
    /** Catalog spelling retained for display, including alias types. Encoding uses typeName. */
    readonly declaredTypeName?: string;
    readonly declaredTypeSchema?: string;
    /** Position in the table, used to keep generated column lists stable. */
    readonly ordinal: number;
    readonly isIdentity: boolean;
    readonly isComputed: boolean;
    /** True for rowversion/timestamp, which the server maintains. */
    readonly isServerAssigned: boolean;
    /** True when the column has a default, so an insert may legitimately omit it. */
    readonly hasDefault: boolean;
    /**
     * False when a value cannot be sent for this column at all: computed columns, rowversion,
     * and identity columns outside an IDENTITY_INSERT block.
     */
    readonly isWritable: boolean;
}

export interface IndexMetadata {
    readonly name: string;
    readonly isPrimaryKey: boolean;
    readonly isUnique: boolean;
    /** True when every key column is non-nullable, which is what makes it usable as an identity. */
    readonly isNullable: boolean;
    readonly columns: readonly string[];
}

export interface TableMetadata {
    readonly schema: string;
    readonly name: string;
    readonly objectType: "table" | "view";
    readonly columns: readonly ColumnMetadata[];
    readonly indexes: readonly IndexMetadata[];
    /** Present when the table has a rowversion column, the cheapest concurrency token there is. */
    readonly rowVersionColumn?: string;
    readonly isMemoryOptimized: boolean;
    /** Views are only editable when they resolve to one base table; this says whether they do. */
    readonly isUpdatable: boolean;
}

/**
 * Reads columns and their storage properties.
 *
 * `sys.computed_columns` and `is_identity` decide writability; a column that cannot be written
 * must be excluded from every INSERT and UPDATE or the server rejects the whole statement.
 */
export function columnsSql(schema: string, name: string): string {
    return `
SELECT
    c.name                                   AS column_name,
    c.column_id                              AS ordinal,
    LOWER(CASE WHEN t.is_assembly_type = 1 THEN t.name ELSE COALESCE(bt.name, t.name) END) AS type_name,
    t.name                                   AS declared_type_name,
    SCHEMA_NAME(t.schema_id)                 AS declared_type_schema,
    c.max_length                             AS max_length,
    c.precision                              AS precision,
    c.scale                                  AS scale,
    CONVERT(bit, c.is_nullable)              AS is_nullable,
    CONVERT(bit, c.is_identity)              AS is_identity,
    CONVERT(bit, c.is_computed)              AS is_computed,
    CONVERT(bit, CASE WHEN c.default_object_id <> 0 THEN 1 ELSE 0 END) AS has_default,
    CONVERT(bit, o.is_ms_shipped)            AS is_ms_shipped,
    LOWER(o.type_desc)                       AS object_type
FROM sys.columns AS c
JOIN sys.objects AS o ON o.object_id = c.object_id
JOIN sys.types   AS t ON t.user_type_id = c.user_type_id
LEFT JOIN sys.types AS bt ON bt.user_type_id = c.system_type_id
    AND bt.system_type_id = bt.user_type_id
WHERE o.schema_id = SCHEMA_ID(${stringLiteral(schema)})
  AND o.name = ${stringLiteral(name)}
ORDER BY c.column_id`;
}

/**
 * Reads unique indexes, which is where a usable row identity comes from.
 *
 * Filtered and disabled indexes are excluded: a filtered index does not cover every row, and a
 * disabled one has no data behind it, so neither can identify an arbitrary row.
 */
export function indexesSql(schema: string, name: string): string {
    return `
SELECT
    i.name                              AS index_name,
    CONVERT(bit, i.is_primary_key)      AS is_primary_key,
    CONVERT(bit, i.is_unique)           AS is_unique,
    c.name                              AS column_name,
    ic.key_ordinal                      AS key_ordinal,
    CONVERT(bit, c.is_nullable)         AS is_nullable
FROM sys.indexes AS i
JOIN sys.index_columns AS ic
    ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
JOIN sys.columns AS c
    ON c.object_id = ic.object_id AND c.column_id = ic.column_id
JOIN sys.objects AS o ON o.object_id = i.object_id
WHERE o.schema_id = SCHEMA_ID(${stringLiteral(schema)})
  AND o.name = ${stringLiteral(name)}
  AND i.is_unique = 1
  AND i.has_filter = 0
  AND i.is_disabled = 0
ORDER BY i.is_primary_key DESC, i.name, ic.key_ordinal`;
}

/** Memory-optimized tables need a snapshot hint on every statement, so this is asked separately. */
export function tablePropertiesSql(schema: string, name: string): string {
    return `
SELECT
    LOWER(o.type_desc) AS object_type,
    CONVERT(bit, ISNULL(t.is_memory_optimized, 0)) AS is_memory_optimized
FROM sys.objects AS o
LEFT JOIN sys.tables AS t ON t.object_id = o.object_id
WHERE o.schema_id = SCHEMA_ID(${stringLiteral(schema)})
  AND o.name = ${stringLiteral(name)}`;
}

/** Loads everything the engine needs about one object, in three catalog reads. */
export async function loadTableMetadata(
    runner: SqlRunner,
    schema: string,
    name: string,
): Promise<TableMetadata> {
    // Sequential, not concurrent: a data-plane connection permits one active query at a time,
    // so issuing these together fails with "a query is already active on this connection".
    const columnRows = await runner.query(columnsSql(schema, name), { tag: "sqlEdit.columns" });
    const indexRows = await runner.query(indexesSql(schema, name), { tag: "sqlEdit.indexes" });
    const propertyRows = await runner.query(tablePropertiesSql(schema, name), {
        tag: "sqlEdit.properties",
    });

    if (columnRows.rows.length === 0) {
        throw new SqlEditError(
            `${qualifiedName(schema, name)} was not found, or you do not have permission to see it.`,
            "notEditable",
        );
    }

    const columns = columnRows.rows.map((row) => buildColumn(row));
    const indexes = groupIndexes(indexRows.rows);
    const properties = propertyRows.rows[0] ?? {};
    const objectType = String(properties.object_type ?? "").includes("view") ? "view" : "table";
    const rowVersion = columns.find((c) => c.isServerAssigned);

    return {
        schema,
        name,
        objectType,
        columns,
        indexes,
        ...(rowVersion ? { rowVersionColumn: rowVersion.name } : {}),
        isMemoryOptimized: truthy(properties.is_memory_optimized),
        // A view with no unique index can still be updatable, but this engine will not guess:
        // without an identity it cannot address a row, which the key strategy reports.
        isUpdatable: objectType === "table" || indexes.length > 0,
    };
}

function buildColumn(row: Record<string, unknown>): ColumnMetadata {
    const typeName = String(row.type_name ?? "").toLowerCase();
    const isIdentity = truthy(row.is_identity);
    const isComputed = truthy(row.is_computed);
    const isServerAssigned = typeName === "timestamp" || typeName === "rowversion";
    return {
        name: String(row.column_name ?? ""),
        ordinal: Number(row.ordinal ?? 0),
        typeName,
        declaredTypeName: String(row.declared_type_name ?? typeName),
        declaredTypeSchema: String(row.declared_type_schema ?? "sys"),
        maxLength: numberOrUndefined(row.max_length),
        precision: numberOrUndefined(row.precision),
        scale: numberOrUndefined(row.scale),
        isNullable: truthy(row.is_nullable),
        isIdentity,
        isComputed,
        isServerAssigned,
        hasDefault: truthy(row.has_default),
        isWritable: !isComputed && !isServerAssigned && !isIdentity && isWritableType(typeName),
    };
}

function groupIndexes(rows: readonly Record<string, unknown>[]): IndexMetadata[] {
    const byName = new Map<string, { meta: Omit<IndexMetadata, "columns">; columns: string[] }>();
    for (const row of rows) {
        const indexName = String(row.index_name ?? "");
        let entry = byName.get(indexName);
        if (!entry) {
            entry = {
                meta: {
                    name: indexName,
                    isPrimaryKey: truthy(row.is_primary_key),
                    isUnique: truthy(row.is_unique),
                    isNullable: false,
                },
                columns: [],
            };
            byName.set(indexName, entry);
        }
        entry.columns.push(String(row.column_name ?? ""));
        if (truthy(row.is_nullable)) {
            entry.meta = { ...entry.meta, isNullable: true };
        }
    }
    return [...byName.values()].map((e) => ({ ...e.meta, columns: e.columns }));
}

function truthy(value: unknown): boolean {
    return value === true || value === 1 || value === "1" || value === "True" || value === "true";
}

function numberOrUndefined(value: unknown): number | undefined {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}
