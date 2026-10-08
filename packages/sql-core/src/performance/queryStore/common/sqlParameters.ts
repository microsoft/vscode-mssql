/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { sqlIntLiteral, sqlNStringLiteral } from "../../../common/literals";
import { QueryStoreColumnInfo } from "./columnInfo";
import { DisplayTimeKind, ResolvedTimeInterval, assertValidDate } from "./timeInterval";
import { assertSqlParameterName } from "./utils";

/*
 * Readers do not bind parameters, so the Query Store queries declare their variables in the
 * batch, like the C# QueryStoreQueryGenerator does for SQL Tools Service.
 */

const minInt = -2147483648;
const maxInt = 2147483647;
const maxBigInt = 9223372036854775807n;
const minBigInt = -9223372036854775808n;
const minuteMs = 60 * 1000;
/** 0001-01-01T00:00:00Z and 9999-12-31T23:59:59.999Z, the range of `DateTime`. */
const minDateMs = -62135596800000;
const maxDateMs = 253402300799999;

/** A value for a T-SQL variable, with the T-SQL type that the C# code infers from the CLR type. */
export type QueryStoreSqlValue =
    | { readonly type: "int"; readonly value: number }
    | { readonly type: "bigint"; readonly value: number | bigint | string }
    | { readonly type: "nvarchar"; readonly value: string }
    | {
          readonly type: "datetimeoffset";
          readonly value: Date;
          /** Default `"utc"`. */
          readonly displayTimeKind?: DisplayTimeKind;
      };

export type QueryStoreSqlParameter = QueryStoreSqlValue & {
    /** The variable name, for example `@interval_start_time`. */
    readonly name: string;
};

/**
 * Returns the type and value part of a declaration, for example `INT = 999`. C#
 * `QueryStoreQueryGenerator.GetTSqlRepresentation`. Throws a `RangeError` for a value that is not
 * valid for the type.
 */
export function getTSqlRepresentation(parameter: QueryStoreSqlValue): string {
    switch (parameter.type) {
        case "int":
            return `INT = ${formatInt(parameter.value)}`;
        case "bigint":
            return `BIGINT = ${formatBigInt(parameter.value)}`;
        case "nvarchar":
            if (typeof parameter.value !== "string") {
                throw new RangeError("Value is not a string.");
            }
            return `NVARCHAR(max) = ${sqlNStringLiteral(parameter.value)}`;
        case "datetimeoffset":
            return `DATETIMEOFFSET = '${formatDateTimeOffset(parameter.value, parameter.displayTimeKind)}'`;
        default:
            throw new RangeError(
                `Type "${String((parameter as { type?: unknown }).type)}" is not supported.`,
            );
    }
}

/**
 * Puts a `DECLARE` statement for each parameter, in order, and a blank line before the query.
 * C# `QueryStoreQueryGenerator.PrependSqlParameters`.
 */
export function prependSqlParameters(
    query: string,
    parameters: readonly QueryStoreSqlParameter[],
): string {
    const names = new Set<string>();
    let result = "";
    for (const parameter of parameters) {
        const name = assertSqlParameterName(parameter.name);
        const key = name.toLowerCase();
        if (names.has(key)) {
            throw new RangeError(`Parameter ${name} is declared more than once.`);
        }
        names.add(key);
        result += `DECLARE ${name} ${getTSqlRepresentation(parameter)};\n`;
    }
    result += "\n";
    result += `${query}\n`;
    return result.trim();
}

/**
 * True when the generated SQL uses the variable. The generated SQL has no user text, so a text
 * search is exact.
 */
export function referencesSqlParameter(sql: string, name: string): boolean {
    const escaped = assertSqlParameterName(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`${escaped}(?![A-Za-z0-9_@#$])`, "i").test(sql);
}

/**
 * The start and end parameters of a time interval, as `datetimeoffset` values.
 */
export function timeIntervalParameters(
    startName: string,
    endName: string,
    interval: ResolvedTimeInterval,
    displayTimeKind: DisplayTimeKind,
): QueryStoreSqlParameter[] {
    return [
        { name: startName, type: "datetimeoffset", value: interval.start, displayTimeKind },
        { name: endName, type: "datetimeoffset", value: interval.end, displayTimeKind },
    ];
}

/**
 * Returns the column with the label, or the first column when there is no label. C#
 * `QueryStoreQueryGenerator.GetOrderByColumn`. Throws a `RangeError` when no column has the label.
 */
export function getOrderByColumn(
    orderByColumnId: string | undefined,
    columns: readonly QueryStoreColumnInfo[],
): QueryStoreColumnInfo {
    const column =
        orderByColumnId === undefined
            ? columns[0]
            : columns.find((item) => item.id === orderByColumnId);
    if (!column) {
        throw new RangeError(
            orderByColumnId === undefined
                ? "The query has no columns."
                : `The query has no column "${orderByColumnId}".`,
        );
    }
    return column;
}

/**
 * Returns the time in the round-trip ("O") format of a C# `DateTimeOffset`, for example
 * `2023-06-10T12:34:56.0000000+00:00`. Throws a `RangeError` for a date that is not valid.
 *
 * With `"local"`, the time has the offset of the JavaScript runtime's time zone at that time, like
 * `DateTimeOffset.ToLocalTime`. A local time before 0001-01-01 is clamped to 0001-01-01T00:00:00
 * with the offset of January 1, like .NET clamps `DateTimeOffset.MinValue`. For dates before
 * about 1900, JavaScript uses the IANA history of the zone, so the offset can differ from .NET on
 * Windows.
 */
export function formatDateTimeOffset(
    value: Date,
    displayTimeKind: DisplayTimeKind = "utc",
): string {
    assertValidDate(value);
    if (displayTimeKind === "utc") {
        // toISOString is yyyy-MM-ddTHH:mm:ss.fffZ for years 1 through 9999.
        return `${value.toISOString().slice(0, -1)}0000+00:00`;
    }
    if (displayTimeKind !== "local") {
        throw new RangeError(`"${String(displayTimeKind)}" is not a display time kind.`);
    }
    let offsetMinutes = -Math.trunc(value.getTimezoneOffset());
    let wallMs = value.getTime() + offsetMinutes * minuteMs;
    if (wallMs < minDateMs) {
        offsetMinutes = -new Date(Date.UTC(2001, 0, 1)).getTimezoneOffset();
        wallMs = minDateMs;
    } else if (wallMs > maxDateMs) {
        wallMs = maxDateMs;
    }
    const absolute = Math.abs(offsetMinutes);
    const sign = offsetMinutes < 0 ? "-" : "+";
    const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
    const minutes = String(absolute % 60).padStart(2, "0");
    return `${new Date(wallMs).toISOString().slice(0, -1)}0000${sign}${hours}:${minutes}`;
}

/** Returns an `int` as text. Throws a `RangeError` for a value that is not an `int`. */
export function formatInt(value: number): string {
    if (typeof value !== "number") {
        throw new RangeError(`Value ${String(value)} is not a number.`);
    }
    return sqlIntLiteral(value, minInt, maxInt);
}

/** Returns a `bigint` as text. Throws a `RangeError` for a value that is not a `bigint`. */
export function formatBigInt(value: number | bigint | string): string {
    let parsed: bigint;
    if (typeof value === "bigint") {
        parsed = value;
    } else if (typeof value === "number") {
        if (!Number.isSafeInteger(value)) {
            throw new RangeError(`Value ${value} is not a safe integer.`);
        }
        parsed = BigInt(value);
    } else if (typeof value === "string" && /^-?\d{1,19}$/.test(value.trim())) {
        parsed = BigInt(value.trim());
    } else {
        throw new RangeError(`Value "${String(value)}" is not a bigint.`);
    }
    if (parsed > maxBigInt || parsed < minBigInt) {
        throw new RangeError(`Value ${parsed} is outside the bigint range.`);
    }
    return parsed.toString();
}
