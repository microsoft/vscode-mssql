/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PlatformInfo, isFabricWarehouseFamily } from "../../common/platform";
import { maxDopOneHint, sessionPreamble } from "../../common/session";
import { ActivityReadOptions } from "./types";
import { SqlReader, SqlRecord, readNumber, readString, toRecords } from "../../common/sqlReader";
import {
    MissingDataCode,
    PerfResult,
    PerfScope,
    PerfSource,
    errorResult,
    unsupportedResult,
} from "../result";
import { viewStatePermissionExpression } from "./activeRequests";

/** The user sessions of one login, program, and host. */
export interface SessionGroup {
    readonly loginName?: string;
    readonly programName?: string;
    /** The client host name. On Synapse dedicated pools, `client_id`: the client address. */
    readonly hostName?: string;
    /**
     * The client driver, for example ".Net SqlClient Data Provider". On the SQL engine only: SQL
     * Server, Managed Instance, Azure SQL Database, and SQL database in Fabric.
     */
    readonly clientInterfaceName?: string;
    readonly sessionCount: number;
    /** Sessions with status running (or ACTIVE on Synapse dedicated). */
    readonly runningCount: number;
    /**
     * Sessions with an open transaction (`open_transaction_count > 0`, or `is_transactional` on
     * Synapse dedicated pools).
     */
    readonly openTransactionCount: number;
}

export interface SessionSummary {
    readonly totalSessions: number;
    readonly runningSessions: number;
    /** Ordered by sessionCount descending. */
    readonly groups: readonly SessionGroup[];
}

type SessionFamily = "sqlEngine" | "synapseDedicated" | "fabricWarehouse" | "synapseServerless";

/**
 * Reads the open user sessions, grouped by login, program, and host. The session of the read is
 * not counted.
 *
 * - SQL Server, Managed Instance, Azure SQL Database, and SQL database in Fabric: the sessions of
 *   the current database in `sys.dm_exec_sessions`. `selfOnly` (with data) when the principal does
 *   not have VIEW SERVER STATE (VIEW SERVER PERFORMANCE STATE on SQL Server 2022 and later) or, on
 *   Azure SQL Database and Fabric, VIEW DATABASE STATE.
 * - Synapse dedicated pools: the ACTIVE and IDLE sessions in `sys.dm_pdw_exec_sessions`.
 * - Synapse serverless, Fabric Data Warehouse, and the SQL analytics endpoint: the sessions in
 *   `sys.dm_exec_sessions`. In Fabric, only the workspace Admin role sees the sessions of other
 *   users, so the result always has `otherUsersRequests`.
 *
 * `unsupported` on an unknown platform.
 */
export async function readSessionSummary(
    reader: SqlReader,
    info: PlatformInfo,
    options?: ActivityReadOptions,
    now: Date = new Date(),
): Promise<PerfResult<SessionSummary>> {
    const family = sessionFamily(info);
    if (!family) {
        return unsupportedResult(info, now);
    }
    const source: PerfSource = family === "synapseDedicated" ? "pdwDmv" : "dmv";
    try {
        const resultSets = await reader.read(
            buildSessionSummaryQuery(info, options?.excludeOwnSession !== false),
            options,
        );
        let hasPermission = true;
        let groupSet = resultSets[0];
        if (family === "sqlEngine") {
            hasPermission = readNumber(toRecords(resultSets[0])[0] ?? {}, "has_permission") === 1;
            groupSet = resultSets[1];
        }
        const groups = toRecords(groupSet).map(toSessionGroup);
        const missing: MissingDataCode[] =
            family === "fabricWarehouse" ? ["otherUsersRequests"] : [];
        return {
            status: hasPermission ? "ready" : "selfOnly",
            platform: info.platform,
            source,
            scope: scopeFor(family),
            observedAtUtc: now.toISOString(),
            data: {
                totalSessions: groups.reduce((sum, group) => sum + group.sessionCount, 0),
                runningSessions: groups.reduce((sum, group) => sum + group.runningCount, 0),
                groups,
            },
            missing,
        };
    } catch (error) {
        return errorResult(info, error, now, source);
    }
}

/**
 * Returns the batch of {@link readSessionSummary}. On SQL Server, Managed Instance, Azure SQL
 * Database, and SQL database in Fabric, the first result set is the permission check. Throws a
 * `RangeError` for an unknown platform. Exported for tests.
 */
export function buildSessionSummaryQuery(info: PlatformInfo, excludeOwnSession = true): string {
    const family = sessionFamily(info);
    switch (family) {
        case "sqlEngine":
            return `${sessionPreamble(info, "read")}
SELECT ${viewStatePermissionExpression(info)} AS has_permission;
${sessionGroupsQuery("\n    AND s.database_id = DB_ID()", maxDopOneHint(info), true, excludeOwnSession)}`;
        case "synapseDedicated":
            return `${sessionPreamble(info, "read")}
SELECT
    login_name,
    app_name AS program_name,
    client_id AS host_name,
    COUNT(*) AS session_count,
    SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS running_count,
    SUM(CASE WHEN is_transactional = 1 THEN 1 ELSE 0 END) AS open_transaction_count
FROM sys.dm_pdw_exec_sessions
WHERE status IN ('ACTIVE', 'IDLE')${excludeOwnSession ? " AND session_id <> SESSION_ID()" : ""}
GROUP BY login_name, app_name, client_id
ORDER BY session_count DESC, login_name, app_name, client_id;`;
        case "fabricWarehouse":
        case "synapseServerless":
            return `${sessionPreamble(info, "read")}
${sessionGroupsQuery("", maxDopOneHint(info), false, excludeOwnSession)}`;
        default:
            throw new RangeError(`The platform "${info.platform}" has no session view.`);
    }
}

/**
 * The sessions grouped by login, program, and host, and on the SQL engine also by the client
 * interface (the driver), for example ".Net SqlClient Data Provider".
 */
function sessionGroupsQuery(
    databaseFilter: string,
    hint: string,
    clientInterface = false,
    excludeOwnSession = true,
): string {
    const client = clientInterface ? ", s.client_interface_name" : "";
    return `SELECT
    s.login_name,
    s.program_name,
    s.host_name${client},
    COUNT(*) AS session_count,
    SUM(CASE WHEN LOWER(s.status) = N'running' THEN 1 ELSE 0 END) AS running_count,
    SUM(CASE WHEN s.open_transaction_count > 0 THEN 1 ELSE 0 END) AS open_transaction_count
FROM sys.dm_exec_sessions AS s
WHERE s.is_user_process = 1${excludeOwnSession ? "\n    AND s.session_id <> @@SPID" : ""}${databaseFilter}
GROUP BY s.login_name, s.program_name, s.host_name${client}
ORDER BY session_count DESC, s.login_name, s.program_name, s.host_name${client}${hint};`;
}

function sessionFamily(info: PlatformInfo): SessionFamily | undefined {
    switch (info.platform) {
        case "sqlServer":
        case "azureSqlManagedInstance":
        case "azureSqlDatabase":
        case "fabricSqlDatabase":
            return "sqlEngine";
        case "synapseDedicated":
            return "synapseDedicated";
        case "synapseServerless":
            return "synapseServerless";
        default:
            return isFabricWarehouseFamily(info) ? "fabricWarehouse" : undefined;
    }
}

function scopeFor(family: SessionFamily): PerfScope {
    switch (family) {
        case "synapseDedicated":
            return "pool";
        case "synapseServerless":
            return "server";
        case "fabricWarehouse":
            return "item";
        default:
            return "database";
    }
}

function toSessionGroup(record: SqlRecord): SessionGroup {
    return {
        loginName: emptyToUndefined(readString(record, "login_name")),
        programName: emptyToUndefined(readString(record, "program_name")),
        hostName: emptyToUndefined(readString(record, "host_name")),
        clientInterfaceName: emptyToUndefined(readString(record, "client_interface_name")),
        sessionCount: readNumber(record, "session_count") ?? 0,
        runningCount: readNumber(record, "running_count") ?? 0,
        openTransactionCount: readNumber(record, "open_transaction_count") ?? 0,
    };
}

function emptyToUndefined(value: string | undefined): string | undefined {
    return value === undefined || value.trim() === "" ? undefined : value;
}
