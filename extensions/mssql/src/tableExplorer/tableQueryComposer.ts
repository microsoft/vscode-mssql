/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure SQL composition helpers for the Table Explorer's filter and sort UI.
 *
 * Lives outside the webview tree so unit tests can exercise it directly
 * without bundling React. Has no vscode/runtime dependencies — the webview
 * imports it for live SQL-pane previews and the controller can use it when
 * composing queries for the edit session.
 */

export type FilterOperator =
    | "equals"
    | "notEquals"
    | "contains"
    | "notContains"
    | "startsWith"
    | "endsWith"
    | "greaterThan"
    | "lessThan"
    | "isNull"
    | "isNotNull";

export type FilterConjunction = "AND" | "OR";

export interface AppliedFilter {
    column: string;
    operator: FilterOperator;
    value: string;
    conjunction?: FilterConjunction;
}

export interface AppliedSortColumn {
    columnName: string;
    sortAsc: boolean;
}

export function operatorTakesValue(op: FilterOperator): boolean {
    return op !== "isNull" && op !== "isNotNull";
}

function escapeStringLiteral(v: string): string {
    return v.replace(/'/g, "''");
}

function escapeLikePattern(value: string, escapeChar: string = "\\"): string {
    return value.replace(/[%_\[\]\\]/g, `${escapeChar}$&`);
}

function buildPredicate(f: AppliedFilter): string {
    if (!f.column) {
        return "";
    }
    const col = `[${f.column.replace(/]/g, "]]")}]`;
    if (f.operator === "isNull") {
        return `${col} IS NULL`;
    }
    if (f.operator === "isNotNull") {
        return `${col} IS NOT NULL`;
    }
    if (f.value === "") {
        return "";
    }
    const escaped = escapeStringLiteral(f.value);
    const lit = `N'${escaped}'`;
    switch (f.operator) {
        case "equals":
            return `${col} = ${lit}`;
        case "notEquals":
            return `${col} <> ${lit}`;
        case "contains": {
            const likeEscaped = escapeLikePattern(escaped);
            return `${col} LIKE N'%${likeEscaped}%' ESCAPE '\\'`;
        }
        case "notContains": {
            const likeEscaped = escapeLikePattern(escaped);
            return `${col} NOT LIKE N'%${likeEscaped}%' ESCAPE '\\'`;
        }
        case "startsWith": {
            const likeEscaped = escapeLikePattern(escaped);
            return `${col} LIKE N'${likeEscaped}%' ESCAPE '\\'`;
        }
        case "endsWith": {
            const likeEscaped = escapeLikePattern(escaped);
            return `${col} LIKE N'%${likeEscaped}' ESCAPE '\\'`;
        }
        case "greaterThan":
            return `${col} > ${lit}`;
        case "lessThan":
            return `${col} < ${lit}`;
        default:
            return "";
    }
}

/**
 * Strips trailing semicolon and any ORDER BY clause from the query.
 * Used when the grid refreshes (which loses sort state) to keep the displayed
 * query in sync, and when re-applying sort to ensure a clean base query.
 */
export function stripTrailingOrderByAndSemicolon(sql: string): string {
    let s = sql.trimEnd();
    if (s.endsWith(";")) {
        s = s.slice(0, -1).trimEnd();
    }
    const matches = [...s.matchAll(/\bORDER\s+BY\b/gi)];
    if (matches.length > 0) {
        const last = matches[matches.length - 1];
        if (last.index !== undefined) {
            s = s.slice(0, last.index).trimEnd();
        }
    }
    return s;
}

/**
 * Compose `ORDER BY ...` from `sortColumns` and append it to `baseQuery`,
 * stripping any pre-existing trailing ORDER BY first. Returns `baseQuery`
 * unchanged when no sort is active.
 */
export function composeSortedQuery(baseQuery: string, sortColumns: AppliedSortColumn[]): string {
    if (!baseQuery || sortColumns.length === 0) {
        return baseQuery;
    }
    const orderParts = sortColumns.map(
        (s) => `[${s.columnName.replace(/]/g, "]]")}] ${s.sortAsc ? "ASC" : "DESC"}`,
    );
    return `${stripTrailingOrderByAndSemicolon(baseQuery)}\nORDER BY ${orderParts.join(", ")}`;
}

/**
 * Inject a WHERE clause built from `filters` into `baseQuery`. If `baseQuery`
 * already has a WHERE, the new predicate is appended with AND. If it has an
 * ORDER BY, the WHERE is inserted before it. Returns the original query
 * unchanged when no filter is complete.
 *
 * Each filter can have a conjunction (AND/OR) that determines how it's combined
 * with the previous filter. The first filter's conjunction is ignored.
 */
export function composeFilteredQuery(baseQuery: string, filters: AppliedFilter[]): string {
    const predicates = filters.map(buildPredicate).filter((p) => p.length > 0);
    if (predicates.length === 0) {
        return baseQuery;
    }

    let newPredicate = predicates[0];
    for (let i = 1; i < predicates.length; i++) {
        const conjunction = filters[i].conjunction || "AND";
        newPredicate += ` ${conjunction} ${predicates[i]}`;
    }

    const orderByMatch = baseQuery.match(/\bORDER\s+BY\b/i);
    const head = orderByMatch ? baseQuery.slice(0, orderByMatch.index) : baseQuery;
    const tail = orderByMatch ? baseQuery.slice(orderByMatch.index) : "";

    const hadTrailingSemicolon = /;\s*$/.test(head);
    const normalizedHead = head.replace(/;\s*$/, "");

    const whereMatch = normalizedHead.match(/\bWHERE\b/i);
    let composedHead: string;
    if (whereMatch && whereMatch.index !== undefined) {
        const beforeWhere = normalizedHead.slice(0, whereMatch.index);
        const existing = normalizedHead.slice(whereMatch.index + "WHERE".length).trim();
        composedHead = `${beforeWhere}WHERE (${existing}) AND (${newPredicate}) `;
    } else {
        composedHead = `${normalizedHead.trimEnd()}\nWHERE ${newPredicate}\n`;
    }
    return composedHead + tail + (hadTrailingSemicolon && tail === "" ? ";" : "");
}
