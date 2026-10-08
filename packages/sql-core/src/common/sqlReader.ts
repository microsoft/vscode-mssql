/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A cell value returned by a reader. Readers return `bigint` and decimal values that do not fit
 * a JavaScript number as decimal strings.
 */
export type SqlValue = string | number | boolean | null;

export interface SqlResultSet {
    readonly columns: readonly string[];
    readonly rows: readonly (readonly SqlValue[])[];
}

export interface SqlReadOptions {
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
}

/**
 * Runs a T-SQL batch and returns every result set in order. Implementations must reject with a
 * {@link SqlReadError} when the batch fails.
 */
export interface SqlReader {
    read(sql: string, options?: SqlReadOptions): Promise<SqlResultSet[]>;
}

export type SqlReadErrorKind = "server" | "timeout" | "canceled" | "connection";

export class SqlReadError extends Error {
    constructor(
        message: string,
        readonly kind: SqlReadErrorKind,
        readonly errorNumber?: number,
    ) {
        super(message);
        this.name = "SqlReadError";
    }
}

export type SqlRecord = Readonly<Record<string, SqlValue>>;

/**
 * Converts a result set to records keyed by column name.
 */
export function toRecords(resultSet: SqlResultSet | undefined): SqlRecord[] {
    if (!resultSet) {
        return [];
    }
    return resultSet.rows.map((row) => {
        const record: Record<string, SqlValue> = {};
        resultSet.columns.forEach((column, index) => {
            record[column] = row[index] ?? null;
        });
        return record;
    });
}

export function readNumber(record: SqlRecord, column: string): number | undefined {
    const value = record[column];
    if (typeof value === "number") {
        return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    if (typeof value === "boolean") {
        return value ? 1 : 0;
    }
    return undefined;
}

export function readString(record: SqlRecord, column: string): string | undefined {
    const value = record[column];
    if (value === null || value === undefined) {
        return undefined;
    }
    return String(value);
}

/**
 * Reads an identifier such as a `bigint` Query Store ID as a decimal string, so that values above
 * `Number.MAX_SAFE_INTEGER` stay exact.
 */
export function readId(record: SqlRecord, column: string): string | undefined {
    return toIdText(record[column]);
}

/** Reads a `bit` value. Readers return it as a boolean, a number, or text. */
export function readBoolean(record: SqlRecord, column: string): boolean | undefined {
    return toBooleanValue(record[column]);
}

/**
 * Reads a date and time as an ISO 8601 string in UTC. Text that is not a date stays as it is.
 * See {@link parseSqlDateTime}.
 */
export function readDateTime(record: SqlRecord, column: string): string | undefined {
    return parseSqlDateTime(record[column])?.toISOString() ?? readString(record, column)?.trim();
}

/** Returns the value as a decimal integer string, or undefined. */
export function toIdText(value: unknown): string | undefined {
    if (typeof value === "number") {
        return Number.isSafeInteger(value) ? value.toString() : undefined;
    }
    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
        return value.trim();
    }
    return undefined;
}

/** Returns the value as a boolean, or undefined when it is not a `bit` value. */
export function toBooleanValue(value: unknown): boolean | undefined {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        return value !== 0;
    }
    if (typeof value === "string") {
        switch (value.trim().toLowerCase()) {
            case "1":
            case "true":
                return true;
            case "0":
            case "false":
                return false;
        }
    }
    return undefined;
}

const sqlDateTimePattern =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * Parses a `datetimeoffset`, `datetime2`, or `datetime` value. Readers return these as text such as
 * `2026-10-08 05:00:00.1234567 +00:00` or `2026-10-08T05:00:00Z`. A value without an offset is UTC,
 * which is how Query Insights stores times. Digits after milliseconds are dropped. Returns
 * undefined for a value that is not a date.
 */
export function parseSqlDateTime(value: unknown): Date | undefined {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? undefined : value;
    }
    if (typeof value !== "string") {
        return undefined;
    }
    const match = sqlDateTimePattern.exec(value.trim());
    if (!match) {
        return undefined;
    }
    const [, year, month, day, hour, minute, second, fraction, zone] = match;
    const parts = {
        month: Number(month),
        day: Number(day),
        hour: Number(hour ?? 0),
        minute: Number(minute ?? 0),
        second: Number(second ?? 0),
    };
    if (
        parts.month < 1 ||
        parts.month > 12 ||
        parts.day < 1 ||
        parts.day > 31 ||
        parts.hour > 23 ||
        parts.minute > 59 ||
        parts.second > 59
    ) {
        return undefined;
    }
    const result = new Date(0);
    result.setUTCFullYear(Number(year), parts.month - 1, parts.day);
    if (result.getUTCDate() !== parts.day) {
        return undefined;
    }
    result.setUTCHours(
        parts.hour,
        parts.minute,
        parts.second,
        Number((fraction ?? "").padEnd(3, "0").slice(0, 3)),
    );
    if (zone && zone.toUpperCase() !== "Z") {
        const digits = zone.slice(1).replace(":", "");
        const offsetMinutes = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4));
        const sign = zone.startsWith("-") ? -1 : 1;
        result.setTime(result.getTime() - sign * offsetMinutes * 60 * 1000);
    }
    return result;
}
