/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Builds the page query.
 *
 * Paging is by key rather than by offset. `OFFSET n ROWS` makes the server walk and discard
 * every preceding row, so reaching row five million costs five million rows of work on every
 * page; it also shifts under concurrent inserts, so a row can be seen twice or skipped. A
 * keyset seek starts where the previous page ended, which is both stable and constant cost.
 */

import { ColumnFilter, SortColumn, compileFilters, compileOrderBy } from "./filter";
import { Sql, SqlEditError, qualifiedName, quoteName } from "../core/sql";
import { ColumnMetadata, TableMetadata } from "../metadata/tableMetadata";
import { KeyStrategy } from "../metadata/keyStrategy";
import { projectionCastFor } from "../types/typeTraits";
import { encodeValue } from "../types/valueCodec";

/** Where the next page starts: the key values of the last row of the previous page. */
export type PageCursor = Readonly<Record<string, string | null>>;

export interface PageRequest {
    readonly filters?: readonly ColumnFilter[];
    readonly sort?: readonly SortColumn[];
    readonly pageSize: number;
    /** Absent for the first page. */
    readonly cursor?: PageCursor;
}

export interface CompiledPageQuery {
    readonly sql: string;
    readonly pageSize: number;
    /** Columns the page projects, in order. */
    readonly columns: readonly string[];
    /** Columns that order the page, which are also what a cursor is made of. */
    readonly cursorColumns: readonly string[];
}

const MAX_PAGE_SIZE = 10_000;

/**
 * Columns a SELECT can project.
 *
 * `text`, `ntext` and `image` are read through a cast: the deprecated types cannot be compared
 * or sorted, and the modern equivalents behave identically for display.
 */
function projectColumn(column: ColumnMetadata): Sql {
    const name = quoteName(column.name);
    switch (projectionCastFor(column.typeName)) {
        case "text":
            // xml, json, vector, sql_variant and the deprecated text types all read back as the
            // exact string the codec writes, so a value edited in the grid round-trips.
            return `CONVERT(nvarchar(max), ${name}) AS ${name}`;
        case "binary":
            return `CONVERT(varbinary(max), ${name}) AS ${name}`;
        case "path":
            // hierarchyid's binary form means nothing to a reader; the path is what people edit.
            return `${name}.ToString() AS ${name}`;
        case "spatial":
            // Well-Known Text round-trips through the codec, and carries the SRID so the value
            // can be written back without guessing its spatial reference.
            return `CONVERT(nvarchar(max), N'SRID=' + CONVERT(nvarchar(16), ${name}.STSrid) + N';' + ${name}.STAsText()) AS ${name}`;
        default:
            return `${name} AS ${name}`;
    }
}

/**
 * Reads one cell in full.
 *
 * A page bounds each cell so a grid of documents cannot blow up the wire, which means a large
 * xml or json value arrives clipped. Editing a clipped value would silently truncate the column
 * on save, so the editor fetches the whole value for the one cell being opened.
 */
export function compileCellQuery(
    table: TableMetadata,
    columnName: string,
    cursor: PageCursor,
    order: readonly SortColumn[],
): string {
    const column = table.columns.find((c) => c.name === columnName);
    if (!column) {
        throw new SqlEditError(`There is no column named "${columnName}".`, "invalidValue");
    }
    const predicate = cursorPredicate(table, cursor, order);
    return [
        `SELECT TOP (1) ${projectColumn(column)}`,
        `FROM ${qualifiedName(table.schema, table.name)}`,
        `WHERE ${predicate}`,
    ].join("\n");
}

/** Reads the complete projected row addressed by a stable key for conflict inspection. */
export function compileCurrentRowQuery(
    table: TableMetadata,
    cursor: PageCursor,
    order: readonly SortColumn[],
): string {
    const predicate = cursorPredicate(table, cursor, order);
    const projection = table.columns.map(projectColumn).join(", ");
    return [
        `SELECT TOP (1) ${projection}`,
        `FROM ${qualifiedName(table.schema, table.name)}`,
        `WHERE ${predicate}`,
    ].join("\n");
}

function cursorPredicate(
    table: TableMetadata,
    cursor: PageCursor,
    order: readonly SortColumn[],
): string {
    return order
        .map((s) => {
            const keyColumn = table.columns.find((c) => c.name === s.column);
            if (!keyColumn) {
                throw new SqlEditError(`There is no column named "${s.column}".`, "invalidValue");
            }
            const value = cursor[s.column];
            const quoted = quoteName(s.column);
            return value === null || value === undefined
                ? `${quoted} IS NULL`
                : `${quoted} = ${encodeValue(value, keyColumn, s.column)}`;
        })
        .join(" AND ");
}

/**
 * Order that makes paging deterministic.
 *
 * Any requested sort is honoured first, then the key columns are appended as a tiebreak. Without
 * that tiebreak two rows with equal sort values have no defined order, and a keyset seek across
 * them would skip or repeat rows.
 */
export function resolvePageOrder(
    sort: readonly SortColumn[] | undefined,
    key: KeyStrategy,
): SortColumn[] {
    const order: SortColumn[] = [...(sort ?? [])];
    const seen = new Set(order.map((s) => s.column));
    for (const column of key.columns) {
        if (!seen.has(column)) {
            order.push({ column, descending: false });
            seen.add(column);
        }
    }
    return order;
}

/**
 * The seek predicate for the row after the cursor.
 *
 * Expanded as a chain rather than as a row constructor, because SQL Server has no `(a, b) > (x, y)`
 * comparison. Each term fixes the earlier key columns to equality and advances one column, which
 * is exactly what a row-value comparison means.
 */
export function compileSeek(
    cursor: PageCursor,
    order: readonly SortColumn[],
    columns: readonly ColumnMetadata[],
): Sql {
    const byName = new Map(columns.map((c) => [c.name, c]));
    const terms: string[] = [];

    for (let i = 0; i < order.length; i++) {
        const equalities: string[] = [];
        for (let j = 0; j < i; j++) {
            equalities.push(comparison(order[j], cursor, byName, "="));
        }
        equalities.push(comparison(order[i], cursor, byName, order[i].descending ? "<" : ">"));
        terms.push(`(${equalities.join(" AND ")})`);
    }
    return `(${terms.join(" OR ")})`;
}

function comparison(
    sort: SortColumn,
    cursor: PageCursor,
    byName: ReadonlyMap<string, ColumnMetadata>,
    op: string,
): Sql {
    const column = byName.get(sort.column);
    if (!column) {
        throw new SqlEditError(`There is no column named "${sort.column}".`, "invalidValue");
    }
    const value = cursor[sort.column];
    if (value === undefined) {
        throw new SqlEditError(
            `The page cursor is missing a value for "${sort.column}".`,
            "invalidValue",
        );
    }
    const name = quoteName(column.name);
    if (value === null) {
        // Nulls sort first ascending in SQL Server. Equality against null needs IS NULL, and
        // advancing past a null means anything not null.
        return op === "=" ? `${name} IS NULL` : `${name} IS NOT NULL`;
    }
    const literal = encodeValue(value, column, column.name);
    return op === "=" ? `${name} = ${literal}` : `${name} ${op} ${literal}`;
}

export function compilePageQuery(
    table: TableMetadata,
    key: KeyStrategy,
    request: PageRequest,
    options: { readonly includeLookahead?: boolean } = {},
): CompiledPageQuery {
    if (!Number.isInteger(request.pageSize) || request.pageSize <= 0) {
        throw new SqlEditError("Page size must be a positive whole number.", "invalidValue");
    }
    const pageSize = Math.min(request.pageSize, MAX_PAGE_SIZE);
    const queryPageSize = pageSize + (options.includeLookahead ? 1 : 0);

    const order = resolvePageOrder(request.sort, key);
    if (order.length === 0) {
        throw new SqlEditError(
            "This object cannot be paged because it has no columns to order by.",
            "noKey",
        );
    }

    const projection = table.columns.map(projectColumn).join(",\n    ");
    const where: string[] = [];

    const filterPredicate = compileFilters(request.filters ?? [], table.columns);
    if (filterPredicate) {
        where.push(`(${filterPredicate})`);
    }
    if (request.cursor) {
        where.push(compileSeek(request.cursor, order, table.columns));
    }

    const orderBy = compileOrderBy(order, table.columns);
    const sql = [
        `SELECT TOP (${queryPageSize})`,
        `    ${projection}`,
        `FROM ${qualifiedName(table.schema, table.name)}`,
        where.length > 0 ? `WHERE ${where.join("\n  AND ")}` : undefined,
        `ORDER BY ${orderBy}`,
    ]
        .filter((line) => line !== undefined)
        .join("\n");

    return {
        sql,
        pageSize,
        columns: table.columns.map((c) => c.name),
        cursorColumns: order.map((s) => s.column),
    };
}

/** Counts rows matching the filters, for a total the UI can show honestly. */
export function compileCountQuery(
    table: TableMetadata,
    filters: readonly ColumnFilter[] | undefined,
): string {
    const predicate = compileFilters(filters ?? [], table.columns);
    return [
        `SELECT COUNT_BIG(*) AS total`,
        `FROM ${qualifiedName(table.schema, table.name)}`,
        predicate ? `WHERE ${predicate}` : undefined,
    ]
        .filter((line) => line !== undefined)
        .join("\n");
}
