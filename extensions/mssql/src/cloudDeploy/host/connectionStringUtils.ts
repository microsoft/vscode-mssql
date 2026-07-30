/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — pure connection-string helpers.
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

/**
 * Returns `connectionString` with its target database set to `database`,
 * replacing any existing `Database` / `Initial Catalog` value (boundary-anchored
 * so a value that merely contains the word is not mistaken for the keyword), or
 * appending `Database=...` when none is present. Unlike
 * `ensureDatabaseInConnectionString` (append-only), this OVERRIDES an existing
 * catalog — required by the connection runtime host, whose saved connection
 * string points at the developer's own database but must be re-targeted at the
 * throwaway `CloudDeployValidation_<uuid>` (and at `master` for CREATE / DROP).
 */
export function withDatabaseInConnectionString(connectionString: string, database: string): string {
    const existing = /(^|;)(\s*)(database|initial catalog)(\s*)=([^;]*)/i;
    if (existing.test(connectionString)) {
        return connectionString.replace(existing, `$1$2$3$4=${database}`);
    }
    const separator = connectionString.trim().endsWith(";") ? "" : ";";
    return `${connectionString}${separator}Database=${database}`;
}
