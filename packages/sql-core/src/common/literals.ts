/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Readers do not bind parameters. These functions validate a value and return a T-SQL literal for
 * it. Every value that goes into generated SQL must pass through one of them.
 */

const maxBigInt = 9223372036854775807n;
const minBigInt = -9223372036854775808n;
const maxIdentifierLength = 128;

/**
 * Returns a `bigint` literal, for example a Query Store `query_id` or `plan_id`.
 */
export function sqlBigIntLiteral(value: string | number | bigint): string {
    let parsed: bigint;
    if (typeof value === "bigint") {
        parsed = value;
    } else if (typeof value === "number") {
        if (!Number.isSafeInteger(value)) {
            throw new RangeError(`Value ${value} is not a safe integer.`);
        }
        parsed = BigInt(value);
    } else {
        const text = value.trim();
        if (!/^-?\d{1,19}$/.test(text)) {
            throw new RangeError(`Value "${value}" is not a bigint.`);
        }
        parsed = BigInt(text);
    }
    if (parsed > maxBigInt || parsed < minBigInt) {
        throw new RangeError(`Value ${parsed} is outside the bigint range.`);
    }
    return `CAST(${parsed.toString()} AS bigint)`;
}

/**
 * Returns an integer literal in the inclusive range.
 */
export function sqlIntLiteral(value: number, min: number, max: number): string {
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new RangeError(`Value ${value} must be an integer from ${min} to ${max}.`);
    }
    return value.toString();
}

/**
 * Returns a `datetimeoffset` literal in UTC.
 */
export function sqlDateTimeOffsetLiteral(value: Date): string {
    return `CAST(N'${toUtcIso(value)}' AS datetimeoffset)`;
}

/**
 * Returns a `datetime2` literal in UTC, for sources that store UTC times without an offset, such
 * as Query Insights.
 */
export function sqlDateTime2UtcLiteral(value: Date): string {
    return `CAST(N'${toUtcIso(value).replace("Z", "")}' AS datetime2)`;
}

/**
 * Returns an `nvarchar` literal.
 */
export function sqlNStringLiteral(value: string): string {
    if (value.includes("\0")) {
        throw new RangeError("Value contains a null character.");
    }
    return `N'${value.replace(/'/g, "''")}'`;
}

/**
 * Returns a delimited identifier, with the same escape rules as `QUOTENAME`.
 */
export function quoteSqlIdentifier(name: string): string {
    if (name.length === 0 || name.length > maxIdentifierLength || name.includes("\0")) {
        throw new RangeError(`"${name}" is not a valid identifier.`);
    }
    return `[${name.replace(/]/g, "]]")}]`;
}

function toUtcIso(value: Date): string {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
        throw new RangeError("Value is not a valid date.");
    }
    return value.toISOString();
}
