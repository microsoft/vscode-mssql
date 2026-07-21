/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from "crypto";

/** Pure naming, locality, and SQL construction rules for the first disposable
 * SQL target. The executor accepts only a loopback SQL Server profile and only
 * drops databases with both the generated name and exact ownership marker.
 * New markers live in master so target DACPAC reconciliation cannot remove
 * the cleanup authority. */

const LEASE_PROPERTY = "RunbookStudioLeaseId";
const LEASE_PROPERTY_PREFIX = "RunbookStudioLease_";
const DATABASE_PREFIX = "RunbookStudio_";

export interface LocalSandboxProbe {
    exists: boolean;
    ownershipMarker?: string;
}

export function isStrictLoopbackSqlServer(server: string): boolean {
    const normalized = server.trim().toLowerCase().replace(/^tcp:/, "");
    return /^(localhost|127\.0\.0\.1|\[::1\]|\.|\(local\))(?:[\\,].+)?$/.test(normalized);
}

export function localSandboxDatabaseName(effectId: string): string {
    const digest = /^effect-([a-f0-9]{64})$/i.exec(effectId)?.[1];
    if (!digest) {
        throw new Error("invalid effect id for sandbox database name");
    }
    return `${DATABASE_PREFIX}${digest.slice(0, 20)}`;
}

export function localSandboxLeaseRef(effectId: string): string {
    if (!/^effect-[a-f0-9]{64}$/i.test(effectId)) {
        throw new Error("invalid effect id for sandbox lease reference");
    }
    return `runbook-sql-lease:${effectId}`;
}

export function effectIdFromLocalSandboxLeaseRef(value: string): string | undefined {
    const match = /^runbook-sql-lease:(effect-[a-f0-9]{64})$/i.exec(value.trim());
    return match?.[1];
}

export function isRunbookSandboxDatabaseName(value: string): boolean {
    return new RegExp(`^${DATABASE_PREFIX}[a-f0-9]{20}$`, "i").test(value);
}

export function buildCreateLocalSandboxSql(databaseName: string, effectId: string): string {
    assertSandboxIdentity(databaseName, effectId);
    const database = quoteIdentifier(databaseName);
    const marker = quoteString(effectId);
    const property = quoteString(localSandboxOwnershipPropertyName(databaseName));
    return [
        `CREATE DATABASE ${database};`,
        `EXEC sys.sp_addextendedproperty @name = N${property}, @value = N${marker};`,
    ].join("\n");
}

export function buildProbeLocalSandboxSql(databaseName: string): string {
    if (!isRunbookSandboxDatabaseName(databaseName)) {
        throw new Error("invalid sandbox database name");
    }
    const database = quoteIdentifier(databaseName);
    const name = quoteString(databaseName);
    const property = quoteString(localSandboxOwnershipPropertyName(databaseName));
    const legacyProperty = quoteString(LEASE_PROPERTY);
    return [
        `IF DB_ID(N${name}) IS NULL`,
        "    SELECT CAST(0 AS int) AS database_exists, CAST(NULL AS nvarchar(4000)) AS lease_id;",
        "ELSE",
        `    SELECT CAST(1 AS int) AS database_exists, CAST(COALESCE((SELECT TOP (1) [value] FROM master.sys.extended_properties WHERE [class] = 0 AND [name] = N${property}), (SELECT TOP (1) [value] FROM ${database}.sys.extended_properties WHERE [class] = 0 AND [name] = N${legacyProperty})) AS nvarchar(4000)) AS lease_id;`,
    ].join("\n");
}

export function localSandboxOwnershipPropertyName(databaseName: string): string {
    if (!isRunbookSandboxDatabaseName(databaseName)) {
        throw new Error("invalid sandbox database name");
    }
    const digest = createHash("sha256").update(databaseName.toLowerCase()).digest("hex");
    return `${LEASE_PROPERTY_PREFIX}${digest}`;
}

export function buildDropLocalSandboxSql(databaseName: string, effectId: string): string {
    assertSandboxIdentity(databaseName, effectId);
    const database = quoteIdentifier(databaseName);
    const name = quoteString(databaseName);
    const marker = quoteString(effectId);
    const property = quoteString(localSandboxOwnershipPropertyName(databaseName));
    const legacyProperty = quoteString(LEASE_PROPERTY);
    return [
        `IF DB_ID(N${name}) IS NOT NULL`,
        "BEGIN",
        `    IF (EXISTS (SELECT 1 FROM master.sys.extended_properties WHERE [class] = 0 AND [name] = N${property}) AND NOT EXISTS (SELECT 1 FROM master.sys.extended_properties WHERE [class] = 0 AND [name] = N${property} AND CAST([value] AS nvarchar(4000)) = N${marker})) OR (NOT EXISTS (SELECT 1 FROM master.sys.extended_properties WHERE [class] = 0 AND [name] = N${property}) AND NOT EXISTS (SELECT 1 FROM ${database}.sys.extended_properties WHERE [class] = 0 AND [name] = N${legacyProperty} AND CAST([value] AS nvarchar(4000)) = N${marker}))`,
        "        THROW 51000, 'Runbook Studio sandbox ownership mismatch.', 1;",
        `    ALTER DATABASE ${database} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;`,
        `    DROP DATABASE ${database};`,
        `    IF EXISTS (SELECT 1 FROM master.sys.extended_properties WHERE [class] = 0 AND [name] = N${property} AND CAST([value] AS nvarchar(4000)) = N${marker})`,
        `        EXEC sys.sp_dropextendedproperty @name = N${property};`,
        "END;",
        `ELSE IF EXISTS (SELECT 1 FROM master.sys.extended_properties WHERE [class] = 0 AND [name] = N${property} AND CAST([value] AS nvarchar(4000)) = N${marker})`,
        `    EXEC sys.sp_dropextendedproperty @name = N${property};`,
    ].join("\n");
}

function assertSandboxIdentity(databaseName: string, effectId: string): void {
    if (
        !isRunbookSandboxDatabaseName(databaseName) ||
        localSandboxDatabaseName(effectId) !== databaseName
    ) {
        throw new Error("sandbox database name does not match its effect identity");
    }
}

function quoteIdentifier(value: string): string {
    return `[${value.replace(/]/g, "]]")}]`;
}

function quoteString(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}
