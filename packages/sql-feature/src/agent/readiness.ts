/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface AgentReadiness {
    supported: boolean;
    service: "unknown" | "running" | "stopped" | "other";
    visibility: "unknown" | "owned" | "all";
    serviceError?: string;
    accessError?: string;
    jobsError?: string;
}

/** Runs inside msdb without changing the connection's current database. */
export const agentAccessSql = `EXEC msdb.sys.sp_executesql N'SELECT
    IS_SRVROLEMEMBER(''sysadmin'') AS is_admin,
    IS_MEMBER(''SQLAgentUserRole'') AS is_user,
    IS_MEMBER(''SQLAgentReaderRole'') AS is_reader,
    IS_MEMBER(''SQLAgentOperatorRole'') AS is_operator';`;

export function agentVisibility(row?: Record<string, unknown>): AgentReadiness["visibility"] {
    const yes = (value: unknown) => value === 1 || value === true;
    if (yes(row?.is_admin) || yes(row?.is_reader) || yes(row?.is_operator)) return "all";
    if (yes(row?.is_user)) return "owned";
    // No recognized role is not proof that custom permissions deny all access.
    return "unknown";
}
export function agentServiceState(status: unknown): AgentReadiness["service"] {
    if (status === 4) return "running";
    if (status === 1) return "stopped";
    if (typeof status === "number" && [2, 3, 5, 6, 7].includes(status)) return "other";
    return "unknown";
}
