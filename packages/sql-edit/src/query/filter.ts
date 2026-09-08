/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Compiles structured filters into a predicate.
 *
 * The old path spliced a WHERE clause into a query string with regular expressions, which meant
 * the filter had to be re-parsed out of text it was never parsed into. Filters arrive here as
 * data, are checked against real columns, and are encoded by column type, so an unknown column
 * or a mistyped value fails here with a sentence rather than at the server as a syntax error.
 */

import { ColumnMetadata } from "../metadata/tableMetadata";
import { Sql, SqlEditError, quoteName, stringLiteral } from "../core/sql";
import { encodeValue } from "../types/valueCodec";

export type FilterOperator =
    | "equals"
    | "notEquals"
    | "greaterThan"
    | "greaterThanOrEqual"
    | "lessThan"
    | "lessThanOrEqual"
    | "contains"
    | "notContains"
    | "startsWith"
    | "endsWith"
    | "isNull"
    | "isNotNull"
    | "in";

export interface ColumnFilter {
    readonly column: string;
    readonly operator: FilterOperator;
    /** Absent for isNull/isNotNull; an array only for `in`. */
    readonly value?: string | null;
    readonly values?: readonly string[];
}

export interface SortColumn {
    readonly column: string;
    readonly descending?: boolean;
}

/** Operators that compare text with LIKE and therefore need pattern escaping. */
const PATTERN_OPERATORS = new Set<FilterOperator>([
    "contains",
    "notContains",
    "startsWith",
    "endsWith",
]);

/**
 * Escapes the LIKE metacharacters so a search for `50%` finds a literal per cent sign.
 *
 * The escape character is declared on the clause rather than assumed, because the server's
 * default differs by collation and an undeclared backslash is treated as an ordinary character.
 */
function escapeLikePattern(value: string): string {
    return value.replace(/[%_[\]\\]/g, "\\$&");
}

export function compileFilters(
    filters: readonly ColumnFilter[],
    columns: readonly ColumnMetadata[],
): Sql | undefined {
    if (filters.length === 0) {
        return undefined;
    }
    const byName = new Map(columns.map((c) => [c.name, c]));
    const predicates = filters.map((filter) => compileFilter(filter, byName));
    return predicates.join(" AND ");
}

function compileFilter(filter: ColumnFilter, byName: ReadonlyMap<string, ColumnMetadata>): Sql {
    const column = byName.get(filter.column);
    if (!column) {
        throw new SqlEditError(`There is no column named "${filter.column}".`, "invalidValue");
    }
    const col = quoteName(column.name);

    switch (filter.operator) {
        case "isNull":
            return `${col} IS NULL`;
        case "isNotNull":
            return `${col} IS NOT NULL`;
        case "in": {
            const values = filter.values ?? [];
            if (values.length === 0) {
                // An empty set matches nothing. Saying so explicitly beats omitting the clause,
                // which would silently widen the result to everything.
                return "1 = 0";
            }
            const list = values.map((v) => encodeValue(v, column, column.name)).join(", ");
            return `${col} IN (${list})`;
        }
        default:
            break;
    }

    if (filter.value === undefined || filter.value === null) {
        // `= NULL` is never true; the user almost certainly meant IS NULL, so say so rather
        // than returning an empty grid they cannot explain.
        throw new SqlEditError(
            `Use "is null" to filter ${column.name} for empty values.`,
            "invalidValue",
        );
    }

    if (PATTERN_OPERATORS.has(filter.operator)) {
        return compilePattern(filter.operator, col, filter.value, column);
    }

    const literal = encodeValue(filter.value, column, column.name);
    switch (filter.operator) {
        case "equals":
            return `${col} = ${literal}`;
        case "notEquals":
            // A not-equals that silently drops nulls surprises people, so nulls are kept.
            return `(${col} <> ${literal} OR ${col} IS NULL)`;
        case "greaterThan":
            return `${col} > ${literal}`;
        case "greaterThanOrEqual":
            return `${col} >= ${literal}`;
        case "lessThan":
            return `${col} < ${literal}`;
        case "lessThanOrEqual":
            return `${col} <= ${literal}`;
        default:
            throw new SqlEditError(`Unsupported filter operator.`, "invalidValue");
    }
}

function compilePattern(
    operator: FilterOperator,
    col: Sql,
    value: string,
    column: ColumnMetadata,
): Sql {
    const textTypes = ["char", "nchar", "varchar", "nvarchar", "text", "ntext", "sysname"];
    if (!textTypes.includes(column.typeName)) {
        throw new SqlEditError(
            `"${column.name}" holds ${column.typeName} values, which cannot be searched for text.`,
            "invalidValue",
        );
    }
    const escaped = escapeLikePattern(value);
    const pattern =
        operator === "startsWith"
            ? `${escaped}%`
            : operator === "endsWith"
              ? `%${escaped}`
              : `%${escaped}%`;
    const like = `${col} LIKE ${stringLiteral(pattern)} ESCAPE '\\'`;
    return operator === "notContains" ? `(NOT ${like} OR ${col} IS NULL)` : like;
}

/** Compiles an ORDER BY, rejecting any column that is not real. */
export function compileOrderBy(
    sort: readonly SortColumn[],
    columns: readonly ColumnMetadata[],
): Sql | undefined {
    if (sort.length === 0) {
        return undefined;
    }
    const byName = new Map(columns.map((c) => [c.name, c]));
    const parts = sort.map((s) => {
        if (!byName.has(s.column)) {
            throw new SqlEditError(`There is no column named "${s.column}".`, "invalidValue");
        }
        return `${quoteName(s.column)} ${s.descending ? "DESC" : "ASC"}`;
    });
    return parts.join(", ");
}
