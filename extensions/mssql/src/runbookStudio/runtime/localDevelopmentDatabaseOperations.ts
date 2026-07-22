/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from "crypto";

/** Pure identity and SQL-construction rules for retained, user-named local
 * development databases. This lease is deliberately distinct from the
 * generated disposable sandbox lease: creation is absent-target-only and
 * every later mutation must re-prove the exact ownership marker. New leases
 * live in master so a target DACPAC cannot model or remove their authority. */

const DEVELOPMENT_LEASE_PROPERTY = "RunbookStudioDevelopmentLeaseId";
const DEVELOPMENT_LEASE_PROPERTY_PREFIX = "RunbookStudioDevelopmentLease_";
const DEVELOPMENT_LEASE_PREFIX = "runbook-sql-dev-lease:";
const SYSTEM_DATABASES = new Set(["master", "model", "msdb", "tempdb"]);

export interface LocalDevelopmentDatabaseProbe {
    exists: boolean;
    ownershipMarker?: string;
}

export function isValidLocalDevelopmentDatabaseName(value: string): boolean {
    const name = value.trim();
    return (
        name.length > 0 &&
        name.length <= 128 &&
        /^[A-Za-z_][A-Za-z0-9_$#@-]*$/.test(name) &&
        !SYSTEM_DATABASES.has(name.toLowerCase()) &&
        !/^RunbookStudio_/i.test(name)
    );
}

export function localDevelopmentDatabaseLeaseRef(effectId: string): string {
    assertEffectId(effectId);
    return `${DEVELOPMENT_LEASE_PREFIX}${effectId}`;
}

export function effectIdFromLocalDevelopmentDatabaseLeaseRef(value: string): string | undefined {
    const match = /^runbook-sql-dev-lease:(effect-[a-f0-9]{64})$/i.exec(value.trim());
    return match?.[1];
}

export function buildCreateLocalDevelopmentDatabaseSql(
    databaseName: string,
    effectId: string,
): string {
    assertIdentity(databaseName, effectId);
    const database = quoteIdentifier(databaseName);
    const marker = quoteString(effectId);
    const property = quoteString(localDevelopmentDatabaseOwnershipPropertyName(databaseName));
    return [
        `CREATE DATABASE ${database};`,
        "DECLARE @RunbookStudioDatabaseOwner sysname = SUSER_SNAME(0x01);",
        "IF @RunbookStudioDatabaseOwner IS NULL",
        "    THROW 51000, 'SQL Server system administrator principal is unavailable.', 1;",
        `DECLARE @RunbookStudioAuthorizationSql nvarchar(max) = N'ALTER AUTHORIZATION ON DATABASE::${database} TO ' + QUOTENAME(@RunbookStudioDatabaseOwner) + N';';`,
        "EXEC sys.sp_executesql @RunbookStudioAuthorizationSql;",
        `EXEC sys.sp_addextendedproperty @name = N${property}, @value = N${marker};`,
    ].join("\n");
}

export function buildProbeLocalDevelopmentDatabaseSql(databaseName: string): string {
    assertDatabaseName(databaseName);
    const database = quoteIdentifier(databaseName);
    const name = quoteString(databaseName);
    const property = quoteString(localDevelopmentDatabaseOwnershipPropertyName(databaseName));
    const legacyProperty = quoteString(DEVELOPMENT_LEASE_PROPERTY);
    return [
        `IF DB_ID(N${name}) IS NULL`,
        "    SELECT CAST(0 AS int) AS database_exists, CAST(NULL AS nvarchar(4000)) AS lease_id;",
        "ELSE",
        `    SELECT CAST(1 AS int) AS database_exists, CAST(COALESCE((SELECT TOP (1) [value] FROM master.sys.extended_properties WHERE [class] = 0 AND [name] = N${property}), (SELECT TOP (1) [value] FROM ${database}.sys.extended_properties WHERE [class] = 0 AND [name] = N${legacyProperty})) AS nvarchar(4000)) AS lease_id;`,
    ].join("\n");
}

export function localDevelopmentDatabaseOwnershipPropertyName(databaseName: string): string {
    assertDatabaseName(databaseName);
    const digest = createHash("sha256").update(databaseName.toLowerCase()).digest("hex");
    return `${DEVELOPMENT_LEASE_PROPERTY_PREFIX}${digest}`;
}

export function buildDropLocalDevelopmentDatabaseSql(
    databaseName: string,
    effectId: string,
): string {
    assertIdentity(databaseName, effectId);
    const database = quoteIdentifier(databaseName);
    const name = quoteString(databaseName);
    const marker = quoteString(effectId);
    const property = quoteString(localDevelopmentDatabaseOwnershipPropertyName(databaseName));
    const legacyProperty = quoteString(DEVELOPMENT_LEASE_PROPERTY);
    return [
        `IF DB_ID(N${name}) IS NOT NULL`,
        "BEGIN",
        `    IF (EXISTS (SELECT 1 FROM master.sys.extended_properties WHERE [class] = 0 AND [name] = N${property}) AND NOT EXISTS (SELECT 1 FROM master.sys.extended_properties WHERE [class] = 0 AND [name] = N${property} AND CAST([value] AS nvarchar(4000)) = N${marker})) OR (NOT EXISTS (SELECT 1 FROM master.sys.extended_properties WHERE [class] = 0 AND [name] = N${property}) AND NOT EXISTS (SELECT 1 FROM ${database}.sys.extended_properties WHERE [class] = 0 AND [name] = N${legacyProperty} AND CAST([value] AS nvarchar(4000)) = N${marker}))`,
        "        THROW 51000, 'Runbook Studio development database ownership mismatch.', 1;",
        `    ALTER DATABASE ${database} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;`,
        `    DROP DATABASE ${database};`,
        `    IF EXISTS (SELECT 1 FROM master.sys.extended_properties WHERE [class] = 0 AND [name] = N${property} AND CAST([value] AS nvarchar(4000)) = N${marker})`,
        `        EXEC sys.sp_dropextendedproperty @name = N${property};`,
        "END;",
        `ELSE IF EXISTS (SELECT 1 FROM master.sys.extended_properties WHERE [class] = 0 AND [name] = N${property} AND CAST([value] AS nvarchar(4000)) = N${marker})`,
        `    EXEC sys.sp_dropextendedproperty @name = N${property};`,
    ].join("\n");
}

function assertIdentity(databaseName: string, effectId: string): void {
    assertDatabaseName(databaseName);
    assertEffectId(effectId);
}

function assertDatabaseName(databaseName: string): void {
    if (
        !isValidLocalDevelopmentDatabaseName(databaseName) ||
        databaseName !== databaseName.trim()
    ) {
        throw new Error("invalid local development database name");
    }
}

function assertEffectId(effectId: string): void {
    if (!/^effect-[a-f0-9]{64}$/i.test(effectId)) {
        throw new Error("invalid effect id for development database lease");
    }
}

function quoteIdentifier(value: string): string {
    return `[${value.replace(/]/g, "]]")}]`;
}

function quoteString(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}
