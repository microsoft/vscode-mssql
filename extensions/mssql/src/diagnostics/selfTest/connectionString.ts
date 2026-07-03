/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Minimal ADO.NET-style SQL connection-string parsing for the self-test's
 * env-var connection mode. Pure and dependency-free so redaction behavior is
 * unit-testable. The RAW string and the password are never logged or
 * persisted by callers — parse output is handed straight to the in-process
 * engine and the label is server/database only.
 */

export interface ParsedSqlConnectionString {
    server: string;
    database?: string;
    user?: string;
    password?: string;
    integrated: boolean;
    encrypt?: string;
    trustServerCertificate?: boolean;
}

/** Redacted display label: server/database only, never credentials. */
export function connectionStringLabel(parsed: ParsedSqlConnectionString): string {
    return `${parsed.server}${parsed.database ? ` / ${parsed.database}` : ""} (${parsed.integrated ? "Integrated" : "SQL login"})`;
}

const KEY_ALIASES: Record<string, string> = {
    server: "server",
    "data source": "server",
    address: "server",
    addr: "server",
    "network address": "server",
    database: "database",
    "initial catalog": "database",
    "user id": "user",
    uid: "user",
    user: "user",
    password: "password",
    pwd: "password",
    "integrated security": "integrated",
    trusted_connection: "integrated",
    encrypt: "encrypt",
    trustservercertificate: "trust",
    "trust server certificate": "trust",
};

/**
 * Parse `Key=Value;Key=Value` pairs. Supports `'…'`/`"…"` quoted values and
 * `==`-escaped equals in keys per ADO.NET rules (good enough for dev use).
 * Returns undefined with a reason when no server is present.
 */
export function parseSqlConnectionString(
    raw: string,
): { parsed: ParsedSqlConnectionString } | { error: string } {
    const fields = new Map<string, string>();
    for (const segment of splitSegments(raw)) {
        const eq = segment.indexOf("=");
        if (eq <= 0) {
            continue;
        }
        const key = segment.slice(0, eq).trim().toLowerCase();
        let value = segment.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
            (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
        ) {
            value = value.slice(1, -1);
        }
        const canonical = KEY_ALIASES[key];
        if (canonical) {
            fields.set(canonical, value);
        }
    }
    const server = fields.get("server");
    if (!server) {
        return { error: "connection string has no Server/Data Source" };
    }
    const integratedRaw = (fields.get("integrated") ?? "").toLowerCase();
    const integrated =
        integratedRaw === "true" || integratedRaw === "yes" || integratedRaw === "sspi";
    const trustRaw = (fields.get("trust") ?? "").toLowerCase();
    const parsed: ParsedSqlConnectionString = {
        server,
        integrated,
        ...(fields.get("database") ? { database: fields.get("database")! } : {}),
        ...(fields.get("user") ? { user: fields.get("user")! } : {}),
        ...(fields.get("password") ? { password: fields.get("password")! } : {}),
        ...(fields.get("encrypt") ? { encrypt: fields.get("encrypt")! } : {}),
        ...(trustRaw ? { trustServerCertificate: trustRaw === "true" || trustRaw === "yes" } : {}),
    };
    if (!integrated && !parsed.user) {
        return { error: "connection string has neither Integrated Security nor a User ID" };
    }
    return { parsed };
}

/** Split on `;` while respecting quoted values (quotes may contain `;`). */
function splitSegments(raw: string): string[] {
    const segments: string[] = [];
    let current = "";
    let quote: string | undefined;
    for (const ch of raw) {
        if (quote) {
            current += ch;
            if (ch === quote) {
                quote = undefined;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            current += ch;
            continue;
        }
        if (ch === ";") {
            segments.push(current);
            current = "";
            continue;
        }
        current += ch;
    }
    if (current.trim()) {
        segments.push(current);
    }
    return segments;
}
