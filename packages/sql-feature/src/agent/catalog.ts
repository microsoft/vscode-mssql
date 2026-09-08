/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CatalogQuery } from "../core/catalog";
import { createJobScheduleSql, JobSchedule } from "./schedule";

/**
 * SQL Server Agent lives in msdb and does not exist on Azure SQL Database, which uses Elastic
 * Jobs instead. Every query here is gated to the platforms that actually have it rather than
 * failing at run time with an object-not-found error.
 */
const AGENT_PLATFORMS = ["sqlServer", "managedInstance"] as const;

export const jobs: CatalogQuery = {
    id: "agent.jobs",
    title: "Jobs",
    description: "Every Agent job with its schedule, last outcome and next run.",
    platforms: [...AGENT_PLATFORMS],
    requiresCapability: "hasSqlAgent",
    requiresPermission: "SQLAgentUserRole (msdb)",
    columns: [
        { field: "name", header: "Job", width: 240 },
        { field: "enabled", header: "Enabled", width: 80 },
        { field: "current_status", header: "Status", width: 110 },
        { field: "last_run_outcome", header: "Last outcome", width: 120 },
        { field: "last_run_time", header: "Last run", format: "datetime", width: 160 },
        {
            field: "last_run_duration_ms",
            header: "Last duration",
            format: "duration-ms",
            width: 120,
        },
        { field: "next_run_time", header: "Next run", format: "datetime", width: 160 },
        { field: "category", header: "Category", width: 140 },
        { field: "owner", header: "Owner", width: 140 },
        { field: "description", header: "Description", wide: true },
    ],
    sql: () => `
SELECT
    j.job_id, j.name,
    CONVERT(bit, j.enabled)                                   AS enabled,
        CASE
            WHEN ja.run_requested_date IS NOT NULL
                AND ja.start_execution_date IS NULL
                AND ja.stop_execution_date IS NULL THEN 'Start requested'
            WHEN ja.start_execution_date IS NOT NULL
                AND ja.stop_execution_date IS NULL THEN 'Running'
            ELSE 'Idle'
        END                                                        AS current_status,
    CASE jh.run_status
         WHEN 0 THEN 'Failed' WHEN 1 THEN 'Succeeded' WHEN 2 THEN 'Retry'
         WHEN 3 THEN 'Canceled' WHEN 4 THEN 'In progress' END AS last_run_outcome,
    ${historyTimestampSql("jh")} AS last_run_time,
    -- run_duration is HHMMSS packed as an integer, not seconds.
    ${historyDurationSql("jh")}                               AS last_run_duration_ms,
    CASE WHEN js.next_run_date > 0
         THEN msdb.dbo.agent_datetime(js.next_run_date, js.next_run_time) END AS next_run_time,
    c.name                                                    AS category,
    SUSER_SNAME(j.owner_sid)                                  AS owner,
    j.description
FROM msdb.dbo.sysjobs AS j
LEFT JOIN msdb.dbo.syscategories AS c ON c.category_id = j.category_id
LEFT JOIN msdb.dbo.sysjobactivity AS ja
       ON ja.job_id = j.job_id
      AND ja.session_id = (SELECT MAX(session_id) FROM msdb.dbo.syssessions)
OUTER APPLY (
    SELECT TOP (1) h.run_status, h.run_date, h.run_time, h.run_duration
    FROM msdb.dbo.sysjobhistory AS h
    WHERE h.job_id = j.job_id AND h.step_id = 0
    ORDER BY h.instance_id DESC
) AS jh
OUTER APPLY (
    SELECT TOP (1) s.next_run_date, s.next_run_time
    FROM msdb.dbo.sysjobschedules AS s
    WHERE s.job_id = j.job_id AND s.next_run_date > 0
    ORDER BY s.next_run_date, s.next_run_time
) AS js
ORDER BY j.name`,
};

export const jobSteps: CatalogQuery = {
    id: "agent.jobSteps",
    title: "Job steps",
    description: "The steps of one job, in execution order, with what each one runs.",
    platforms: [...AGENT_PLATFORMS],
    requiresCapability: "hasSqlAgent",
    requiresPermission: "SQLAgentUserRole (msdb)",
    columns: [
        { field: "step_id", header: "Step", format: "number", width: 70 },
        { field: "step_name", header: "Name", width: 220 },
        { field: "subsystem", header: "Type", width: 110 },
        { field: "database_name", header: "Database", width: 130 },
        { field: "on_success", header: "On success", width: 130 },
        { field: "on_fail", header: "On failure", width: 130 },
        { field: "command", header: "Command", wide: true },
    ],
    sql: (params) => `
SELECT
    s.step_id, s.step_name, s.subsystem, s.database_name,
    CASE s.on_success_action WHEN 1 THEN 'Quit with success' WHEN 2 THEN 'Quit with failure'
         WHEN 3 THEN 'Go to next step' WHEN 4 THEN CONCAT('Go to step ', s.on_success_step_id) END AS on_success,
    CASE s.on_fail_action WHEN 1 THEN 'Quit with success' WHEN 2 THEN 'Quit with failure'
         WHEN 3 THEN 'Go to next step' WHEN 4 THEN CONCAT('Go to step ', s.on_fail_step_id) END AS on_fail,
    s.command
FROM msdb.dbo.sysjobsteps AS s
JOIN msdb.dbo.sysjobs AS j ON j.job_id = s.job_id
WHERE j.job_id = ${jobIdLiteral(params?.jobId)}
ORDER BY s.step_id`,
};

export const jobHistory: CatalogQuery = {
    id: "agent.jobHistory",
    title: "Job history",
    description: "Past runs of a job, including per-step messages for diagnosing a failure.",
    platforms: [...AGENT_PLATFORMS],
    requiresCapability: "hasSqlAgent",
    requiresPermission: "SQLAgentUserRole (msdb)",
    columns: [
        { field: "run_time", header: "Run", format: "datetime", width: 165 },
        { field: "step_id", header: "Step", format: "number", width: 70 },
        { field: "step_name", header: "Step name", width: 200 },
        { field: "run_status", header: "Outcome", width: 110 },
        { field: "run_duration_ms", header: "Duration", format: "duration-ms", width: 110 },
        { field: "retries_attempted", header: "Retries", format: "number", width: 90 },
        { field: "message", header: "Message", wide: true },
    ],
    sql: (params) => `
SELECT TOP (${clampTop(params?.top, 200)})
    ${historyTimestampSql("h")} AS run_time,
    h.step_id,
    h.step_name,
    CASE h.run_status WHEN 0 THEN 'Failed' WHEN 1 THEN 'Succeeded' WHEN 2 THEN 'Retry'
         WHEN 3 THEN 'Canceled' WHEN 4 THEN 'In progress' END AS run_status,
    ${historyDurationSql("h")}                                AS run_duration_ms,
    h.retries_attempted,
    h.message, h.instance_id, h.run_status AS run_status_code
FROM msdb.dbo.sysjobhistory AS h
JOIN msdb.dbo.sysjobs AS j ON j.job_id = h.job_id
WHERE j.job_id = ${jobIdLiteral(params?.jobId)}
ORDER BY h.instance_id DESC`,
};

export const runningJobs: CatalogQuery = {
    id: "agent.runningJobs",
    title: "Currently running jobs",
    description: "Jobs executing right now, and which step each one is on.",
    platforms: [...AGENT_PLATFORMS],
    requiresCapability: "hasSqlAgent",
    requiresPermission: "SQLAgentUserRole (msdb)",
    columns: [
        { field: "name", header: "Job", width: 260 },
        { field: "start_execution_date", header: "Started", format: "datetime", width: 165 },
        {
            field: "last_executed_step_id",
            header: "Last observed step",
            format: "number",
            width: 130,
        },
        {
            field: "last_executed_step_date",
            header: "Last observed step time",
            format: "datetime",
            width: 165,
        },
    ],
    sql: () => `
SELECT j.job_id, j.name, ja.start_execution_date, ja.last_executed_step_id, ja.last_executed_step_date
FROM msdb.dbo.sysjobactivity AS ja
JOIN msdb.dbo.sysjobs AS j ON j.job_id = ja.job_id
WHERE ja.session_id = (SELECT MAX(session_id) FROM msdb.dbo.syssessions)
  AND ja.start_execution_date IS NOT NULL
  AND ja.stop_execution_date IS NULL
ORDER BY ja.start_execution_date`,
};

export const agentStatus: CatalogQuery = {
    id: "agent.status",
    title: "Agent service status",
    description:
        "Whether SQL Server Agent is running, so a job that never fires has an explanation.",
    platforms: [...AGENT_PLATFORMS],
    requiresCapability: "hasSqlAgent",
    columns: [
        { field: "status_desc", header: "Status", width: 140 },
        { field: "startup_type_desc", header: "Startup", width: 140 },
    ],
    sql: () =>
        `SELECT status, status_desc, startup_type_desc FROM sys.dm_server_services WHERE servicename LIKE 'SQL Server Agent%'`,
};

export const agentQueries: readonly CatalogQuery[] = [jobs, runningJobs, agentStatus];

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Agent mutations go through msdb stored procedures rather than direct table writes, which is
 * the only supported way to change jobs. Every caller-supplied name is passed as a quoted
 * literal built by {@link literal}, so a name can never terminate the string and run as code.
 */
export interface CreateJobRequest {
    readonly name: string;
    readonly description?: string;
    readonly enabled?: boolean;
    readonly category?: string;
    readonly steps: readonly CreateJobStep[];
    readonly schedule?: JobSchedule;
}

export interface CreateJobStep {
    readonly name: string;
    readonly command: string;
    /** Defaults to "TSQL". */
    readonly subsystem?: string;
    /** Database the step runs in. */
    readonly database: string;
    readonly retryAttempts?: number;
    /** Delay between retries, in minutes. Zero retries disables retry behavior. */
    readonly retryIntervalMinutes?: number;
}

/** Builds the batch that creates a job with its steps. */
export function createJobSql(request: CreateJobRequest): string {
    if (typeof request?.name !== "string" || !request.name.trim()) {
        throw new Error("A job name is required.");
    }
    if (!Array.isArray(request.steps) || request.steps.length === 0) {
        throw new Error("A job needs at least one step.");
    }

    if (request.name.length > 128) throw new Error("A job name cannot exceed 128 characters.");
    for (const step of request.steps) {
        if (typeof step?.name !== "string" || !step.name.trim() || step.name.length > 128) {
            throw new Error("Each job step needs a name of 1 to 128 characters.");
        }
        for (const value of [step.retryAttempts ?? 0, step.retryIntervalMinutes ?? 0]) {
            if (!Number.isInteger(value) || value < 0 || value > 2147483647) {
                throw new Error("Retry settings must be nonnegative SQL integers.");
            }
        }
        if (typeof step.command !== "string" || !step.command.trim()) {
            throw new Error("Each job step needs a command.");
        }
        if (typeof step.database !== "string" || !step.database.trim()) {
            throw new Error("Each job step needs a database.");
        }
    }

    const parts: string[] = [
        `IF @@TRANCOUNT <> 0 THROW 51000, 'Job creation requires a connection without an active transaction.', 1;
DECLARE @jobId uniqueidentifier, @returnCode int;
BEGIN TRY
BEGIN TRANSACTION;`,
        `EXEC @returnCode = msdb.dbo.sp_add_job
    @job_name = ${literal(request.name)},
    @description = ${literal(request.description ?? "")},
    @enabled = ${request.enabled === false ? 0 : 1},
    ${request.category ? `@category_name = ${literal(request.category)},` : ""}
    @job_id = @jobId OUTPUT;
IF @returnCode <> 0 OR @jobId IS NULL THROW 51000, 'SQL Agent could not create the job.', 1;`,
    ];

    request.steps.forEach((step, index) => {
        parts.push(`EXEC @returnCode = msdb.dbo.sp_add_jobstep
    @job_id = @jobId,
    @step_id = ${index + 1},
    @step_name = ${literal(step.name)},
    @subsystem = ${literal(step.subsystem ?? "TSQL")},
    @database_name = ${literal(step.database.trim())},
    @command = ${literal(step.command)},
    @retry_attempts = ${step.retryAttempts ?? 0},
    @retry_interval = ${step.retryIntervalMinutes ?? 0},
    @on_success_action = ${index === request.steps.length - 1 ? 1 : 3},
    @on_fail_action = 2;
IF @returnCode <> 0 THROW 51000, 'SQL Agent could not create a job step.', 1;`);
    });

    if (request.schedule) parts.push(createJobScheduleSql(request.schedule));

    // Without a target server the job exists but can never run, which looks like a silent failure.
    parts.push(`EXEC @returnCode = msdb.dbo.sp_add_jobserver @job_id = @jobId, @server_name = N'(local)';
IF @returnCode <> 0 THROW 51000, 'SQL Agent could not assign the target server.', 1;
COMMIT TRANSACTION;
END TRY
BEGIN CATCH
IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
THROW;
END CATCH;
SELECT @jobId AS job_id;`);
    return parts.join("\n");
}

export function startJobSql(jobId: string): string {
    return checkedJobCommand(`msdb.dbo.sp_start_job @job_id = ${jobIdLiteral(jobId)}`);
}

export function stopJobSql(jobId: string): string {
    return checkedJobCommand(`msdb.dbo.sp_stop_job @job_id = ${jobIdLiteral(jobId)}`);
}

export function deleteJobSql(jobId: string): string {
    return checkedJobCommand(
        `msdb.dbo.sp_delete_job @job_id = ${jobIdLiteral(jobId)}, @delete_unused_schedule = 0, @delete_history = 1`,
    );
}

export function setJobEnabledSql(jobId: string, enabled: boolean): string {
    return checkedJobCommand(
        `msdb.dbo.sp_update_job @job_id = ${jobIdLiteral(jobId)}, @enabled = ${enabled ? 1 : 0}`,
    );
}

/**
 * Renders a value as a quoted Unicode SQL literal, doubling embedded quotes. Every
 * caller-supplied string reaching a statement in this module goes through here.
 */
export function literal(value: unknown): string {
    if (value === undefined || value === null) {
        return "NULL";
    }
    return `N'${String(value).replace(/'/g, "''")}'`;
}

function clampTop(raw: unknown, fallback: number): number {
    const n = typeof raw === "number" ? Math.floor(raw) : Number.NaN;
    return Number.isFinite(n) && n > 0 && n <= 5000 ? n : fallback;
}

/** A zero time is midnight, whereas a zero date means no recorded run. */
function historyTimestampSql(alias: "h" | "jh"): string {
    return `CASE WHEN ${alias}.run_date > 0
         THEN msdb.dbo.agent_datetime(${alias}.run_date, ${alias}.run_time) END`;
}

/** Packed HHMMSS supports durations over 24 hours; widen before multiplying. */
function historyDurationSql(alias: "h" | "jh"): string {
    return `(CONVERT(bigint, ${alias}.run_duration / 10000) * 3600
      + ((${alias}.run_duration % 10000) / 100) * 60
      + (${alias}.run_duration % 100)) * 1000`;
}

/** Job identity must survive renames and must never fall back to a reused display name. */
export function jobIdLiteral(value: unknown): string {
    if (
        typeof value !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ) {
        throw new Error("A valid SQL Agent job ID is required.");
    }
    return literal(value);
}

function checkedJobCommand(command: string): string {
    return `DECLARE @returnCode int;
EXEC @returnCode = ${command};
IF @returnCode <> 0 THROW 51000, 'SQL Agent rejected the job operation.', 1;`;
}
