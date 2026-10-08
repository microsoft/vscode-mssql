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
    const value = record[column];
    if (typeof value === "number") {
        return Number.isSafeInteger(value) ? value.toString() : undefined;
    }
    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
        return value.trim();
    }
    return undefined;
}
