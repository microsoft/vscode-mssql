/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryStoreColumnInfo } from "./columnInfo";

/*
 * Port of the SQL generation parts of Microsoft.SqlTools.SqlCore.Performance.Common.Utils. The
 * generated SQL uses "\n" line breaks. The C# code uses Environment.NewLine.
 */

const sqlAliasPattern = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;
const sqlParameterNamePattern = /^@[A-Za-z_][A-Za-z0-9_]*$/;

export interface AppendOrderByOptions {
    /** False for ascending order. Default true. */
    readonly descending?: boolean;
    /** The alias that qualifies the column, when the column name is ambiguous. */
    readonly subqueryAlias?: string;
}

/**
 * Appends an `ORDER BY` clause for the column on a new line. Returns the query unchanged when
 * there is no column.
 */
export function appendOrderBy(
    query: string,
    orderByColumn: QueryStoreColumnInfo | undefined,
    options: AppendOrderByOptions = {},
): string {
    if (!orderByColumn) {
        return query;
    }
    const prefix =
        options.subqueryAlias !== undefined ? `${assertSqlAlias(options.subqueryAlias)}.` : "";
    const direction = (options.descending ?? true) ? "DESC" : "ASC";
    return `${query}\nORDER BY ${prefix}${assertSqlAlias(orderByColumn.id)} ${direction}`;
}

/**
 * Replaces `{0}`, `{1}`, and so on with the arguments, like `string.Format` in C#. The templates
 * in this package do not have literal braces.
 */
export function formatSqlTemplate(template: string, ...args: readonly (string | number)[]): string {
    return template.replace(/\{(\d+)\}/g, (_match, index: string) => {
        const value = args[Number(index)];
        if (value === undefined) {
            throw new RangeError(`The template needs argument ${index}.`);
        }
        return String(value);
    });
}

/**
 * Checks that a table alias, view name, or column label is a plain (optionally schema-qualified)
 * identifier that is safe to put in generated SQL without quotes.
 */
export function assertSqlAlias(name: string): string {
    if (typeof name !== "string" || !sqlAliasPattern.test(name)) {
        throw new RangeError(`"${String(name)}" is not a valid alias.`);
    }
    return name;
}

/**
 * Checks that a value is a T-SQL variable name such as `@interval_start_time`.
 */
export function assertSqlParameterName(name: string): string {
    if (typeof name !== "string" || !sqlParameterNamePattern.test(name)) {
        throw new RangeError(`"${String(name)}" is not a valid parameter name.`);
    }
    return name;
}

/**
 * Returns the distinct items that are not in `excluded`, in their first order. It has the same
 * result as LINQ `Except`.
 */
export function except<T>(items: readonly T[], excluded: readonly NoInfer<T>[]): T[] {
    const seen = new Set<T>(excluded);
    const result: T[] = [];
    for (const item of items) {
        if (!seen.has(item)) {
            seen.add(item);
            result.push(item);
        }
    }
    return result;
}
