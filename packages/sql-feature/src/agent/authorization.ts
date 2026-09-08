/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { jobIdLiteral, literal } from "./catalog";
export type AgentJobAction = "start" | "stop" | "enable" | "disable" | "delete";

/** Current job definition and operation-specific facts, resolved in msdb. */
export function jobActionStateSql(jobId: string): string {
    const sql = `SELECT j.job_id, j.name, j.version_number, j.enabled,
    CONVERT(varchar(170), j.owner_sid, 1) AS owner_sid,
    CONVERT(bit, CASE WHEN j.owner_sid=SUSER_SID() THEN 1 ELSE 0 END) AS is_owner,
    CONVERT(bit, CASE WHEN j.originating_server_id=0 AND NOT EXISTS(SELECT 1 FROM dbo.sysjobservers s WHERE s.job_id=j.job_id AND s.server_id<>0) THEN 1 ELSE 0 END) AS is_local,
    IS_SRVROLEMEMBER('sysadmin') AS is_admin,
    IS_MEMBER('SQLAgentUserRole') AS is_user, IS_MEMBER('SQLAgentReaderRole') AS is_reader,
    IS_MEMBER('SQLAgentOperatorRole') AS is_operator,
    HAS_PERMS_BY_NAME('dbo.sp_start_job','OBJECT','EXECUTE') AS can_start,
    HAS_PERMS_BY_NAME('dbo.sp_stop_job','OBJECT','EXECUTE') AS can_stop,
    HAS_PERMS_BY_NAME('dbo.sp_update_job','OBJECT','EXECUTE') AS can_enable,
    HAS_PERMS_BY_NAME('dbo.sp_update_job','OBJECT','EXECUTE') AS can_disable,
    HAS_PERMS_BY_NAME('dbo.sp_delete_job','OBJECT','EXECUTE') AS can_delete
FROM dbo.sysjobs j WHERE j.job_id=@id;`;
    return `EXEC msdb.sys.sp_executesql ${literal(sql)}, N'@id uniqueidentifier', @id=${jobIdLiteral(jobId)};`;
}

/** Positive authorization evidence; absent/custom role evidence remains unestablished. */
export function canApplyJobAction(
    row: Record<string, unknown> | undefined,
    action: AgentJobAction,
): boolean {
    if (!row) return false;
    const yes = (value: unknown) => value === 1 || value === true;
    if (yes(row.is_admin)) return true;
    if (!yes(row.is_local) || !yes(row[`can_${action}`])) return false;
    const agentRole = yes(row.is_user) || yes(row.is_reader) || yes(row.is_operator);
    if (agentRole && yes(row.is_owner)) return true;
    return yes(row.is_operator) && action !== "delete";
}

/** Ignores runtime activity; detects definition and authorization drift during review. */
export function jobActionFingerprint(row: Record<string, unknown>): string {
    return JSON.stringify(
        [
            "job_id",
            "name",
            "version_number",
            "enabled",
            "owner_sid",
            "is_owner",
            "is_local",
            "is_admin",
            "is_user",
            "is_reader",
            "is_operator",
            "can_start",
            "can_stop",
            "can_enable",
            "can_disable",
            "can_delete",
        ].map((key) => row[key]),
    );
}
