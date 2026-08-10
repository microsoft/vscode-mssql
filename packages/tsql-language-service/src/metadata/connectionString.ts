/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConnectionConfiguration } from "tedious";

/** Parses the SQL-password subset of ADO.NET connection strings used by local integration tests. */
export function parseSqlServerConnectionString(value: string): ConnectionConfiguration {
    const properties = parseProperties(value);
    const dataSource = getRequired(properties, "data source", "server", "address", "addr");
    const [server, instancePort] = splitServerAndPort(dataSource);
    const authentication = get(properties, "authentication")?.toLowerCase();
    if (authentication && authentication !== "sqlpassword" && authentication !== "sql password") {
        throw new Error(`Unsupported authentication mode: ${authentication}`);
    }

    return {
        server,
        authentication: {
            type: "default",
            options: {
                userName: getRequired(properties, "user id", "uid", "user"),
                password: getRequired(properties, "password", "pwd"),
            },
        },
        options: {
            database: get(properties, "initial catalog", "database"),
            port: instancePort ?? 1433,
            encrypt: getBoolean(properties, true, "encrypt"),
            trustServerCertificate: getBoolean(
                properties,
                false,
                "trust server certificate",
                "trustservercertificate",
            ),
            appName: "@vscode-mssql/tsql-language-service",
        },
    };
}

function parseProperties(value: string): ReadonlyMap<string, string> {
    const result = new Map<string, string>();
    let start = 0;
    let quote: string | undefined;

    const commit = (end: number): void => {
        const segment = value.slice(start, end).trim();
        start = end + 1;
        if (!segment) {
            return;
        }
        const separator = segment.indexOf("=");
        if (separator < 1) {
            throw new Error("Invalid connection-string property");
        }
        const key = segment.slice(0, separator).trim().toLowerCase();
        let propertyValue = segment.slice(separator + 1).trim();
        if (
            propertyValue.length >= 2 &&
            ((propertyValue.startsWith("'") && propertyValue.endsWith("'")) ||
                (propertyValue.startsWith('"') && propertyValue.endsWith('"')))
        ) {
            propertyValue = propertyValue.slice(1, -1);
        }
        result.set(key, propertyValue);
    };

    for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (quote) {
            if (character === quote) {
                quote = undefined;
            }
        } else if (character === "'" || character === '"') {
            quote = character;
        } else if (character === ";") {
            commit(index);
        }
    }
    commit(value.length);
    return result;
}

function get(properties: ReadonlyMap<string, string>, ...keys: string[]): string | undefined {
    for (const key of keys) {
        const value = properties.get(key);
        if (value !== undefined) {
            return value;
        }
    }
    return undefined;
}

function getRequired(properties: ReadonlyMap<string, string>, ...keys: string[]): string {
    const value = get(properties, ...keys);
    if (!value) {
        throw new Error(`Missing connection-string property: ${keys[0]}`);
    }
    return value;
}

function getBoolean(
    properties: ReadonlyMap<string, string>,
    fallback: boolean,
    ...keys: string[]
): boolean {
    const value = get(properties, ...keys);
    if (value === undefined) {
        return fallback;
    }
    if (/^(true|yes|1)$/iu.test(value)) {
        return true;
    }
    if (/^(false|no|0)$/iu.test(value)) {
        return false;
    }
    throw new Error(`Invalid boolean connection-string property: ${keys[0]}`);
}

function splitServerAndPort(value: string): readonly [string, number | undefined] {
    const normalized = value.replace(/^tcp:/iu, "");
    const separator = normalized.lastIndexOf(",");
    if (separator < 0) {
        return [normalized, undefined];
    }
    const port = Number.parseInt(normalized.slice(separator + 1), 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
        throw new Error(`Invalid SQL Server port in data source: ${value}`);
    }
    return [normalized.slice(0, separator), port];
}
