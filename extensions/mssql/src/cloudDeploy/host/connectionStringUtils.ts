/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — pure connection-string helpers (Scope 2).
 *
 * Kept separate from the vscode-mssql host glue so the string logic can be
 * unit-tested without pulling in `ConnectionManager`.
 */

/**
 * Ensures a connection string targets `database`. sqlpackage requires the
 * database to live INSIDE the connection string — it rejects a separate
 * `/SourceDatabaseName` or `/TargetDatabaseName` argument when a connection
 * string is supplied — so the catalog must be present. Appends `Database=...`
 * only when no `Database` / `Initial Catalog` keyword is already present (a
 * boundary-anchored check, so a value that merely contains the word is not
 * mistaken for the keyword), and never when `database` is empty.
 */
export function ensureDatabaseInConnectionString(
    connectionString: string,
    database: string | undefined,
): string {
    if (database === undefined || database.length === 0) {
        return connectionString;
    }
    if (/(^|;)\s*(database|initial catalog)\s*=/i.test(connectionString)) {
        return connectionString;
    }
    const separator = connectionString.trim().endsWith(";") ? "" : ";";
    return `${connectionString}${separator}Database=${database}`;
}
