/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure client-side grid operations for the Query Studio results grid
 * (classic in-memory sort/filter parity — headerFilter/hybridDataProvider
 * intent). Webview-safe by convention: no vscode/DOM imports, shared by the
 * results webview and the unit tests (test/unit cannot compile src/webviews
 * — the tsconfig split excludes it from the extension build).
 */

export type QsSortDirection = "asc" | "desc";

export interface QsSortSpec {
    column: number;
    direction: QsSortDirection;
}

export interface QsColumnFilter {
    column: number;
    /** Case-insensitive substring match over the cell display text. */
    contains?: string;
    /** Selected distinct display texts; undefined = every value passes. */
    values?: readonly string[];
}

/** Distinct-values list cap in the filter popup (classic headerFilter scale). */
export const QS_DISTINCT_VALUES_CAP = 200;
/** Rendered cell text clamp — longer cells display truncated and link out. */
export const QS_CELL_DISPLAY_CLAMP = 2048;
/** Cell tooltip (title attribute) clamp. */
export const QS_CELL_TITLE_CLAMP = 512;

/** Display text for one wire cell value (grid cellText parity). */
export function cellDisplayText(value: unknown): string {
    if (value === undefined || value === null) {
        return "NULL";
    }
    if (typeof value === "object") {
        return JSON.stringify(value);
    }
    return String(value);
}

/**
 * Ascending comparator over two cell values. NULLs sort first (SQL Server
 * ORDER BY ASC semantics — a desc pass negates the result, landing NULLs
 * last). Numeric columns compare numerically; everything else compares
 * case-insensitively by display text. A "numeric" value that fails to parse
 * falls back to the string comparison so mixed content stays deterministic.
 */
export function compareCells(a: unknown, b: unknown, numeric: boolean): number {
    const aNull = a === undefined || a === null;
    const bNull = b === undefined || b === null;
    if (aNull || bNull) {
        return aNull && bNull ? 0 : aNull ? -1 : 1;
    }
    if (numeric) {
        const na = typeof a === "number" ? a : Number(String(a));
        const nb = typeof b === "number" ? b : Number(String(b));
        if (!Number.isNaN(na) && !Number.isNaN(nb)) {
            return na < nb ? -1 : na > nb ? 1 : 0;
        }
    }
    const sa = cellDisplayText(a).toLowerCase();
    const sb = cellDisplayText(b).toLowerCase();
    return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** True when the row passes every filter (AND across columns). */
export function rowPassesFilters(
    row: readonly unknown[],
    filters: readonly QsColumnFilter[],
): boolean {
    for (const filter of filters) {
        const text = cellDisplayText(row[filter.column]);
        if (
            filter.contains !== undefined &&
            filter.contains.length > 0 &&
            !text.toLowerCase().includes(filter.contains.toLowerCase())
        ) {
            return false;
        }
        if (filter.values !== undefined && !filter.values.includes(text)) {
            return false;
        }
    }
    return true;
}

/**
 * Filter + sort over the materialized rows. Returns ORIGINAL row indices in
 * view order — callers keep source row numbers alongside each rendered row.
 * Ties keep their original relative order (stable).
 */
export function applyFilterSort(
    rows: readonly (readonly unknown[])[],
    sort: QsSortSpec | undefined,
    filters: readonly QsColumnFilter[],
    typeHints?: readonly (string | undefined)[],
): number[] {
    const indices: number[] = [];
    for (let i = 0; i < rows.length; i++) {
        if (rowPassesFilters(rows[i], filters)) {
            indices.push(i);
        }
    }
    if (sort) {
        const numeric = typeHints?.[sort.column] === "number";
        const direction = sort.direction === "desc" ? -1 : 1;
        indices.sort((x, y) => {
            const order = compareCells(rows[x][sort.column], rows[y][sort.column], numeric);
            return order !== 0 ? order * direction : x - y;
        });
    }
    return indices;
}

/** Distinct display texts for one column, sorted, capped (default 200). */
export function distinctValues(
    rows: readonly (readonly unknown[])[],
    column: number,
    cap: number = QS_DISTINCT_VALUES_CAP,
): { values: string[]; hasMore: boolean } {
    const seen = new Set<string>();
    let hasMore = false;
    for (const row of rows) {
        const text = cellDisplayText(row[column]);
        if (seen.has(text)) {
            continue;
        }
        if (seen.size >= cap) {
            hasMore = true;
            break;
        }
        seen.add(text);
    }
    const values = [...seen].sort((a, b) => compareCells(a, b, false));
    return { values, hasMore };
}

/** Clamp display text; longer input truncates with a trailing ellipsis. */
export function clampDisplay(text: string, max: number): string {
    return text.length <= max ? text : text.slice(0, max) + "…";
}
