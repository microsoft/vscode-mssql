/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { Connection, Request } = require("tedious");

const packageRoot = resolve(__dirname, "../..");
const environmentPath = resolve(packageRoot, ".env");
if (!process.env.TSQL_INTEGRATION_CONNECTION_STRING && existsSync(environmentPath)) {
    process.loadEnvFile(environmentPath);
}

const connectionString = process.env.TSQL_INTEGRATION_CONNECTION_STRING;

function connectionStringForDatabase(database) {
    if (!connectionString) return undefined;
    // A later connection-string key wins, so this works with or without an existing catalog.
    return `${connectionString};Initial Catalog={${database}}`;
}

class TediousTestClient {
    constructor(value) {
        this.config = tediousConfig(value);
        this.connection = new Connection(this.config);
        this.pending = Promise.resolve();
    }

    async connect() {
        await new Promise((resolvePromise, reject) => {
            const connected = (error) => {
                this.connection.removeListener("error", reject);
                if (error) reject(error);
                else resolvePromise();
            };
            this.connection.once("connect", connected);
            this.connection.once("error", reject);
            this.connection.connect();
        });
    }

    execute(query, signal) {
        const execution = this.pending.then(() => this.executeNow(query, signal));
        this.pending = execution.then(
            () => undefined,
            () => undefined,
        );
        return execution;
    }

    executeNow(query, signal) {
        if (signal?.aborted) return Promise.reject(signal.reason);
        return new Promise((resolvePromise, reject) => {
            let columns = [];
            const rows = [];
            const request = new Request(query, (error) => {
                signal?.removeEventListener("abort", abort);
                if (error) reject(error);
                else resolvePromise({ columns, rows });
            });
            const abort = () => request.cancel();
            signal?.addEventListener("abort", abort, { once: true });
            request.on("columnMetadata", (metadata) => {
                columns = metadata.map((column) => ({
                    name: column.colName,
                    type: column.type?.name,
                }));
            });
            request.on("row", (cells) => rows.push(cells.map((cell) => cell.value)));
            this.connection.execSql(request);
        });
    }

    async close() {
        await this.pending;
        this.connection.close();
    }
}

function tediousConfig(value) {
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

function parseConnectionString(value) {
    const result = new Map();
    let start = 0;
    let quote;
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

function first(options, ...names) {
    return names.map((name) => options.get(name)).find((value) => value !== undefined);
}

function required(options, ...names) {
    const value = first(options, ...names);
    if (!value) throw new Error(`Connection string is missing ${names[0]}.`);
    return value;
}

function booleanOption(options, fallback, ...names) {
    const value = first(options, ...names);
    return value === undefined ? fallback : /^(?:true|yes|1)$/iu.test(value);
}

function secondsOption(options, fallback, ...names) {
    const value = first(options, ...names);
    return value === undefined ? fallback : Number.parseInt(value, 10) * 1_000;
}

function rowsAsObjects(result) {
    return result.rows.map((row) =>
        Object.fromEntries(result.columns.map((column, index) => [column.name, row[index]])),
    );
}

module.exports = {
    connectionString,
    connectionStringForDatabase,
    rowsAsObjects,
    TediousTestClient,
};
