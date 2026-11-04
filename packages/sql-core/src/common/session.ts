/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { sqlIntLiteral } from "./literals";
import { PlatformInfo } from "./platform";

/**
 * `read` is for monitoring queries. `change` is for an approved change, such as forcing a plan.
 */
export type SessionPurpose = "read" | "change";

export interface SessionPreambleOptions {
    /** Maximum lock wait in milliseconds, from 0 to 600000. */
    readonly lockTimeoutMs?: number;
}

export const defaultReadLockTimeoutMs = 5000;
export const defaultChangeLockTimeoutMs = 10000;

/**
 * Returns the `SET` statements that start each batch. On SQL Server, Managed Instance, Azure SQL
 * Database, and SQL database in Fabric, a monitoring session:
 *
 * - reads without shared locks (`READ UNCOMMITTED`), so metadata reads do not queue behind
 *   schema locks;
 * - stops a lock wait after a short time (`LOCK_TIMEOUT`) and returns error 1222;
 * - becomes the deadlock victim before the application (`DEADLOCK_PRIORITY LOW`).
 *
 * A change session uses `READ COMMITTED` and a longer lock timeout. Fabric Warehouse does not
 * support `SET TRANSACTION ISOLATION LEVEL`, and the Synapse support for these options is not
 * confirmed, so those platforms get only `SET NOCOUNT ON`.
 */
export function sessionPreamble(
    info: PlatformInfo,
    purpose: SessionPurpose = "read",
    options: SessionPreambleOptions = {},
): string {
    if (!supportsSessionControls(info)) {
        return "SET NOCOUNT ON;";
    }
    const lockTimeoutMs =
        options.lockTimeoutMs ??
        (purpose === "read" ? defaultReadLockTimeoutMs : defaultChangeLockTimeoutMs);
    const isolation = purpose === "read" ? "READ UNCOMMITTED" : "READ COMMITTED";
    return [
        "SET NOCOUNT ON;",
        `SET TRANSACTION ISOLATION LEVEL ${isolation};`,
        `SET LOCK_TIMEOUT ${sqlIntLiteral(lockTimeoutMs, 0, 600000)};`,
        "SET DEADLOCK_PRIORITY LOW;",
    ].join("\n");
}

function supportsSessionControls(info: PlatformInfo): boolean {
    switch (info.platform) {
        case "sqlServer":
        case "azureSqlManagedInstance":
        case "azureSqlDatabase":
        case "fabricSqlDatabase":
            return true;
        default:
            return false;
    }
}
