/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Connection, ConnectionConfiguration, Request } from "tedious";
import { getAuthenticationType, getPassword, getServerName, getUserName } from "./envConfigReader";

/** One result set: each row maps column name to value. */
export type SqlRow = Record<string, unknown>;

/**
 * Splits SERVER_NAME into tedious' host, port, and instance options.
 *
 * Accepts the forms the connection dialog does: `host`, `host,port`, and `host\instance`.
 */
function parseServerName(serverName: string): {
    server: string;
    port?: number;
    instanceName?: string;
} {
    const [hostAndInstance, portText] = serverName.split(",");
    const [server, instanceName] = hostAndInstance.split("\\");
    return {
        server: server.trim(),
        port: portText ? Number(portText.trim()) : undefined,
        instanceName: instanceName?.trim() || undefined,
    };
}

function buildConfig(database: string): ConnectionConfiguration {
    if (getAuthenticationType() !== "SQL Login") {
        throw new Error(
            "The e2e SQL setup helper only supports AUTHENTICATION_TYPE='SQL Login'. " +
                "Configure the .env file with a SQL login, as CI does.",
        );
    }
    const { server, port, instanceName } = parseServerName(getServerName());
    return {
        server,
        authentication: {
            type: "default",
            options: { userName: getUserName(), password: getPassword() },
        },
        options: {
            database,
            port: instanceName ? undefined : (port ?? 1433),
            instanceName,
            encrypt: true,
            trustServerCertificate: true,
            rowCollectionOnRequestCompletion: false,
            connectTimeout: 60 * 1000,
            requestTimeout: 5 * 60 * 1000,
        },
    };
}

function connect(database: string): Promise<Connection> {
    return new Promise((resolve, reject) => {
        const connection = new Connection(buildConfig(database));
        connection.on("connect", (error) => (error ? reject(error) : resolve(connection)));
        connection.connect();
    });
}

function execBatch(connection: Connection, sql: string): Promise<SqlRow[][]> {
    return new Promise((resolve, reject) => {
        const resultSets: SqlRow[][] = [];
        let current: SqlRow[] | undefined;
        const request = new Request(sql, (error) => (error ? reject(error) : resolve(resultSets)));
        request.on("columnMetadata", () => {
            current = [];
            resultSets.push(current);
        });
        request.on("row", (columns) => {
            const row: SqlRow = {};
            for (const column of columns) {
                row[column.metadata.colName] = column.value;
            }
            current?.push(row);
        });
        connection.execSqlBatch(request);
    });
}

/** Splits a script on `GO` separator lines, the way SSMS and sqlcmd do. */
export function splitBatches(script: string): string[] {
    return script
        .split(/^\s*GO\s*;?\s*$/gim)
        .map((batch) => batch.trim())
        .filter((batch) => batch.length > 0);
}

/**
 * Runs a T-SQL script directly against the e2e server, outside VS Code.
 *
 * Used to seed and verify database state, so a test only drives the UI for the behaviour it is
 * actually checking. `GO` separators are honoured. Returns every result set of every batch.
 */
export async function runSql(script: string, database = "master"): Promise<SqlRow[][]> {
    const connection = await connect(database);
    try {
        const results: SqlRow[][] = [];
        for (const batch of splitBatches(script)) {
            results.push(...(await execBatch(connection, batch)));
        }
        return results;
    } finally {
        connection.close();
    }
}

/** Runs a query and returns the first column of the first row, or undefined. */
export async function querySingleValue<T = unknown>(
    sql: string,
    database = "master",
): Promise<T | undefined> {
    const [firstSet] = await runSql(sql, database);
    const firstRow = firstSet?.[0];
    return firstRow ? (Object.values(firstRow)[0] as T) : undefined;
}

/** Quotes an identifier for safe use in dynamic SQL. */
export function quoteName(name: string): string {
    return `[${name.replace(/]/g, "]]")}]`;
}

/** Drops a database if it exists, closing any connections the UI still holds to it. */
export async function dropDatabaseIfExists(databaseName: string): Promise<void> {
    const literal = databaseName.replace(/'/g, "''");
    await runSql(`
IF DB_ID(N'${literal}') IS NOT NULL
BEGIN
    ALTER DATABASE ${quoteName(databaseName)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE ${quoteName(databaseName)};
END`);
}

/** Drops then creates an empty database. */
export async function recreateDatabase(databaseName: string): Promise<void> {
    await dropDatabaseIfExists(databaseName);
    await runSql(`CREATE DATABASE ${quoteName(databaseName)};`);
}

/**
 * Builds a database name that is unique to this run, so suites never collide with each other or
 * with a database a previous, aborted run left behind.
 */
export function uniqueDatabaseName(prefix: string): string {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    return `${prefix}_${suffix}`;
}
