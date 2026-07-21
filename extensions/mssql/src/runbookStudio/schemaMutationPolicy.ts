/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from "crypto";

const MAX_SCHEMA_MUTATION_BYTES = 32 * 1024;
const IDENTIFIER = String.raw`(?:\[[^\]\r\n]+\]|"[^"\r\n]+"|[A-Za-z_][A-Za-z0-9_$#@]*)`;

export interface LocalCreateTablePolicyResult {
    sql: string;
    sqlSha256: string;
    schemaName: string;
    tableName: string;
    qualifiedTableName: string;
}

/** Admission and execution policy for the first schema-mutation activity.
 * It intentionally accepts only one two-part-or-less CREATE TABLE statement.
 * The target executor adds the transaction and independently restricts the
 * database to an ownership-verified named development lease. */
export function validateLocalCreateTableSql(
    value: unknown,
): LocalCreateTablePolicyResult | undefined {
    if (typeof value !== "string") {
        return undefined;
    }
    const sql = value.trim();
    if (
        sql.length === 0 ||
        Buffer.byteLength(sql, "utf8") > MAX_SCHEMA_MUTATION_BYTES ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(sql)
    ) {
        return undefined;
    }
    const sanitized = sanitizeSql(sql);
    if (!sanitized || /^\s*GO\s*$/im.test(sanitized)) {
        return undefined;
    }
    const header = new RegExp(
        String.raw`^\s*CREATE\s+TABLE\s+(${IDENTIFIER})(?:\s*\.\s*(${IDENTIFIER}))?\s*\(`,
        "i",
    ).exec(sanitized);
    if (!header) {
        return undefined;
    }
    const openingParen = header[0].lastIndexOf("(");
    const closingParen = matchingClosingParen(sanitized, openingParen);
    if (
        closingParen < 0 ||
        sanitized.slice(openingParen + 1, closingParen).trim().length === 0 ||
        !/^\s*;?\s*$/.test(sanitized.slice(closingParen + 1))
    ) {
        return undefined;
    }
    const body = sanitized.slice(openingParen + 1, closingParen);
    if (
        /\b(ALTER|BACKUP|BULK|DBCC|DELETE|DENY|DROP|EXEC(?:UTE)?|EXTERNAL|FILESTREAM|FILETABLE|GRANT|INSERT|KILL|MERGE|OPENROWSET|OPENDATASOURCE|RECONFIGURE|RESTORE|REVOKE|SELECT|SHUTDOWN|TRUNCATE|UPDATE|USE|WAITFOR)\b/i.test(
            sanitized,
        ) ||
        /\b(?:xp|sp)_[A-Za-z0-9_$#@]+\b/i.test(sanitized) ||
        /\b(?:MEMORY_OPTIMIZED|SYSTEM_VERSIONING)\b/i.test(sanitized) ||
        new RegExp(String.raw`${IDENTIFIER}\s*\.\s*${IDENTIFIER}\s*\.\s*${IDENTIFIER}`, "i").test(
            sanitized,
        ) ||
        !containsColumnDefinition(body)
    ) {
        return undefined;
    }

    const first = unquoteIdentifier(header[1]);
    const second = header[2] ? unquoteIdentifier(header[2]) : undefined;
    const schemaName = second ? first : "dbo";
    const tableName = second ?? first;
    return {
        sql,
        sqlSha256: crypto.createHash("sha256").update(sql, "utf8").digest("hex"),
        schemaName,
        tableName,
        qualifiedTableName: `${schemaName}.${tableName}`,
    };
}

export function buildTransactionalCreateTableSql(policy: LocalCreateTablePolicyResult): string {
    const objectName = quoteString(policy.qualifiedTableName);
    return [
        "SET XACT_ABORT ON;",
        "BEGIN TRY",
        "    BEGIN TRANSACTION;",
        policy.sql,
        "    COMMIT TRANSACTION;",
        `    SELECT CAST(CASE WHEN OBJECT_ID(N${objectName}, N'U') IS NULL THEN 0 ELSE 1 END AS int) AS table_exists;`,
        "END TRY",
        "BEGIN CATCH",
        "    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;",
        "    THROW;",
        "END CATCH;",
    ].join("\n");
}

function sanitizeSql(sql: string): string | undefined {
    let result = "";
    for (let index = 0; index < sql.length; ) {
        const current = sql[index];
        const next = sql[index + 1];
        if (current === "-" && next === "-") {
            const end = sql.indexOf("\n", index + 2);
            result += " ";
            index = end < 0 ? sql.length : end;
            continue;
        }
        if (current === "/" && next === "*") {
            const end = sql.indexOf("*/", index + 2);
            if (end < 0) {
                return undefined;
            }
            result += " ";
            index = end + 2;
            continue;
        }
        if (current === "'") {
            result += "''";
            index++;
            let closed = false;
            while (index < sql.length) {
                if (sql[index] !== "'") {
                    index++;
                    continue;
                }
                if (sql[index + 1] === "'") {
                    index += 2;
                    continue;
                }
                index++;
                closed = true;
                break;
            }
            if (!closed) {
                return undefined;
            }
            continue;
        }
        result += current;
        index++;
    }
    return result;
}

function matchingClosingParen(sql: string, openingParen: number): number {
    let depth = 0;
    for (let index = openingParen; index < sql.length; index++) {
        if (sql[index] === "(") {
            depth++;
        } else if (sql[index] === ")") {
            depth--;
            if (depth === 0) {
                return index;
            }
            if (depth < 0) {
                return -1;
            }
        }
    }
    return -1;
}

function containsColumnDefinition(body: string): boolean {
    return new RegExp(String.raw`^\s*${IDENTIFIER}\s+[A-Za-z_][A-Za-z0-9_]*`, "i").test(body);
}

function unquoteIdentifier(value: string): string {
    if (value.startsWith("[") && value.endsWith("]")) {
        return value.slice(1, -1).replace(/]]/g, "]");
    }
    if (value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1).replace(/""/g, '"');
    }
    return value;
}

function quoteString(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}
