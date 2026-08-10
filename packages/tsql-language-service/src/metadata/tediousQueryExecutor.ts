/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Connection, Request, type ConnectionConfiguration } from "tedious";
import type { SqlQueryColumn, SqlQueryExecutor } from "./contracts.js";

/** Tedious adapter. A short-lived connection keeps ownership and cancellation deterministic. */
export class TediousQueryExecutor implements SqlQueryExecutor {
    public constructor(private readonly configuration: ConnectionConfiguration) {}

    public async execute<T>(
        sql: string,
        mapRow: (columns: readonly SqlQueryColumn[]) => T | undefined,
        signal?: AbortSignal,
    ): Promise<readonly T[]> {
        throwIfAborted(signal);
        const connection = new Connection(this.configuration);
        try {
            await connect(connection, signal);
            return await executeRequest(connection, sql, mapRow, signal);
        } finally {
            connection.close();
        }
    }
}

function connect(connection: Connection, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error): void => {
            if (settled) {
                return;
            }
            settled = true;
            signal?.removeEventListener("abort", abort);
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        };
        const abort = (): void => {
            connection.close();
            finish(signal?.reason ?? new Error("SQL metadata connection was cancelled"));
        };
        signal?.addEventListener("abort", abort, { once: true });
        connection.once("connect", (error) => {
            finish(error);
        });
        if (signal?.aborted) {
            abort();
            return;
        }
        connection.connect();
    });
}

function executeRequest<T>(
    connection: Connection,
    sql: string,
    mapRow: (columns: readonly SqlQueryColumn[]) => T | undefined,
    signal?: AbortSignal,
): Promise<readonly T[]> {
    return new Promise((resolve, reject) => {
        const rows: T[] = [];
        let settled = false;
        const finish = (error?: Error): void => {
            if (settled) {
                return;
            }
            settled = true;
            signal?.removeEventListener("abort", abort);
            if (error) {
                reject(error);
            } else {
                resolve(rows);
            }
        };
        const request = new Request(sql, (error) => finish(error));
        const abort = (): void => {
            request.cancel();
            finish(signal?.reason ?? new Error("SQL metadata query was cancelled"));
        };
        request.on("row", (columns) => {
            if (settled) {
                return;
            }
            const mapped = mapRow(
                columns.map((column) => ({
                    name: column.metadata.colName,
                    value: column.value,
                })),
            );
            if (mapped !== undefined) {
                rows.push(mapped);
            }
        });
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) {
            abort();
            return;
        }
        connection.execSql(request);
    });
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw signal.reason ?? new Error("SQL metadata operation was cancelled");
    }
}
