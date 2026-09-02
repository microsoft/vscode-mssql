/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * System schemas and fixed database-role principals rank after user schemas in completion.
 *
 * This is an editor presentation policy, not identifier parsing. The anchored expression is kept
 * here so every catalog feature uses the same reviewed inventory.
 */
const systemSchemaName =
    /^(?:sys|information_schema|guest|dbmanager|loginmanager|db_(?:accessadmin|backupoperator|datareader|datawriter|ddladmin|denydatareader|denydatawriter|owner|securityadmin))$/iu;

export function isSystemSchemaName(name: string): boolean {
    return systemSchemaName.test(name);
}

export function isSystemDatabaseName(name: string): boolean {
    return /^(?:master|model|msdb|tempdb)$/iu.test(name);
}

/** Stable prefix used by completion sort keys; user-owned names sort before system-owned names. */
export function catalogOwnershipSortRank(systemOwned: boolean): string {
    return systemOwned ? "90" : "10";
}
