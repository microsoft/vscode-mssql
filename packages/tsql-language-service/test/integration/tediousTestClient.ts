/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Connection, Request, type ConnectionConfiguration } from "tedious";
import type { SimpleQueryCell, SimpleQueryExecutor, SimpleQueryResult } from "../../src/index.ts";

const packageRoot = resolve(__dirname, "../..");
const environmentPath = resolve(packageRoot, ".env");
if (!process.env.TSQL_INTEGRATION_CONNECTION_STRING && existsSync(environmentPath)) {
    process.loadEnvFile(environmentPath);
}

export const connectionString = process.env.TSQL_INTEGRATION_CONNECTION_STRING;

export function connectionStringForDatabase(database: string): string {
    if (!connectionString) throw new Error("TSQL_INTEGRATION_CONNECTION_STRING is not configured.");
    return `${connectionString};Initial Catalog={${database}}`;
}

export class TediousTestClient implements SimpleQueryExecutor {
    private readonly connection: Connection;
    private pending: Promise<void> = Promise.resolve();

    public constructor(value: string) {
        this.connection = new Connection(tediousConfig(value));
    }

    public async connect(): Promise<void> {
        await new Promise<void>((resolvePromise, reject) => {
            const connected = (error?: Error): void => {
                this.connection.removeListener("error", reject);
                if (error) reject(error);
                else resolvePromise();
            };
            this.connection.once("connect", connected);
            this.connection.once("error", reject);
            this.connection.connect();
        });
    }

    public execute(query: string, signal?: AbortSignal): Promise<SimpleQueryResult> {
        const execution = this.pending.then(() => this.executeNow(query, signal));
        this.pending = execution.then(
            () => undefined,
            () => undefined,
        );
        return execution;
    }

    private executeNow(query: string, signal?: AbortSignal): Promise<SimpleQueryResult> {
        if (signal?.aborted) return Promise.reject(signal.reason);
        return new Promise<SimpleQueryResult>((resolvePromise, reject) => {
            let columns: SimpleQueryResult["columns"] = [];
            const rows: SimpleQueryCell[][] = [];
            const request = new Request(query, (error) => {
                signal?.removeEventListener("abort", abort);
                if (error) reject(error);
                else resolvePromise({ columns, rows });
            });
            const abort = (): void => request.cancel();
            signal?.addEventListener("abort", abort, { once: true });
            request.on("columnMetadata", (metadata) => {
                const values = Array.isArray(metadata) ? metadata : Object.values(metadata);
                columns = values.map((column) => ({
                    name: column.colName,
                    type: column.type?.name,
                }));
            });
            request.on("row", (cells: unknown) => rows.push(decodeRow(cells)));
            this.connection.execSql(request);
        });
    }

    public async close(): Promise<void> {
        await this.pending;
        this.connection.close();
    }
}

function tediousConfig(value: string): ConnectionConfiguration {
    const options = parseConnectionString(value);
    const source = required(options, "data source", "server").replace(/^tcp:/iu, "");
    const separator = source.lastIndexOf(",");
    const server = separator < 0 ? source : source.slice(0, separator);
    const port = separator < 0 ? 1433 : Number.parseInt(source.slice(separator + 1), 10);
    return {
        server,
        authentication: {
            type: "default",
            options: {
                userName: required(options, "user id", "uid", "user"),
                password: required(options, "password", "pwd"),
            },
        },
        options: {
            port,
            database: first(options, "initial catalog", "database"),
            encrypt: booleanOption(options, true, "encrypt"),
            trustServerCertificate: booleanOption(
                options,
                false,
                "trust server certificate",
                "trustservercertificate",
            ),
            connectTimeout: secondsOption(options, 15_000, "connect timeout"),
            requestTimeout: secondsOption(options, 30_000, "command timeout"),
            appName: first(options, "application name") ?? "tsql-language-service-integration",
        },
    };
}

function parseConnectionString(value: string): ReadonlyMap<string, string> {
    const result = new Map<string, string>();
    let start = 0;
    let quote: string | undefined;
    let braces = 0;
    for (let index = 0; index <= value.length; index++) {
        const character = value[index];
        if (quote) {
            if (character === quote) quote = undefined;
        } else if (character === '"' || character === "'") {
            quote = character;
        } else if (character === "{") {
            braces++;
        } else if (character === "}" && braces > 0) {
            braces--;
        }
        if (index !== value.length && (character !== ";" || quote || braces > 0)) continue;
        const part = value.slice(start, index).trim();
        start = index + 1;
        if (!part) continue;
        const equals = part.indexOf("=");
        if (equals < 1) throw new Error(`Invalid connection-string component: ${part}`);
        const key = part.slice(0, equals).trim().toLocaleLowerCase();
        const raw = part.slice(equals + 1).trim();
        const unwrapped =
            (raw.startsWith("{") && raw.endsWith("}")) ||
            (raw.startsWith('"') && raw.endsWith('"')) ||
            (raw.startsWith("'") && raw.endsWith("'"))
                ? raw.slice(1, -1)
                : raw;
        result.set(key, unwrapped);
    }
    return result;
}

function first(
    options: ReadonlyMap<string, string>,
    ...names: readonly string[]
): string | undefined {
    return names.map((name) => options.get(name)).find((value) => value !== undefined);
}

function required(options: ReadonlyMap<string, string>, ...names: readonly string[]): string {
    const value = first(options, ...names);
    if (!value) throw new Error(`Connection string is missing ${names[0]}.`);
    return value;
}

function booleanOption(
    options: ReadonlyMap<string, string>,
    fallback: boolean,
    ...names: readonly string[]
): boolean {
    const value = first(options, ...names);
    return value === undefined ? fallback : /^(?:true|yes|1)$/iu.test(value);
}

function secondsOption(
    options: ReadonlyMap<string, string>,
    fallback: number,
    ...names: readonly string[]
): number {
    const value = first(options, ...names);
    return value === undefined ? fallback : Number.parseInt(value, 10) * 1_000;
}

function decodeRow(value: unknown): SimpleQueryCell[] {
    if (!Array.isArray(value)) throw new TypeError("Tedious returned a non-array row.");
    return value.map((cell) => {
        if (!isRecord(cell) || !("value" in cell)) {
            throw new TypeError("Tedious returned an invalid row cell.");
        }
        return decodeCell(cell.value);
    });
}

function decodeCell(value: unknown): SimpleQueryCell {
    if (value === null || value === undefined) return undefined;
    if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        typeof value === "bigint" ||
        value instanceof Uint8Array ||
        value instanceof Date
    ) {
        return value;
    }
    throw new TypeError(`Tedious returned an unsupported cell value: ${typeof value}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

export function rowsAsObjects(
    result: SimpleQueryResult,
): ReadonlyArray<Readonly<Record<string, SimpleQueryCell>>> {
    return result.rows.map((row) =>
        Object.fromEntries(result.columns.map((column, index) => [column.name, row[index]])),
    );
}
