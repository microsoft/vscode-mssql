/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Dates and times are server-local wall-clock values, never browser timestamps. */
export interface JobSchedule {
    name: string;
    kind: "once" | "daily" | "weekly" | "monthly";
    startDate: string;
    startTime: string;
    endDate?: string;
    every?: number;
    monthDay?: number;
    repeat?: { unit: "seconds" | "minutes" | "hours"; every: number; endTime: string };
    /** Sunday = 0 through Saturday = 6. */
    weekdays?: number[];
}

export class AgentScheduleError extends Error {
    constructor(
        public readonly reason:
            | "name"
            | "date"
            | "time"
            | "range"
            | "recurrence"
            | "weekdays"
            | "kind"
            | "monthDay"
            | "repeat",
    ) {
        super(`Invalid Agent schedule: ${reason}`);
    }
}

function dateValue(value: string): number {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new AgentScheduleError("date");
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        year < 1990 ||
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    )
        throw new AgentScheduleError("date");
    return year * 10000 + month * 100 + day;
}

/** Compiles only validated schedule values for an existing @jobId within the creation batch. */
export function createJobScheduleSql(schedule: JobSchedule): string {
    if (typeof schedule.name !== "string" || !schedule.name.trim() || schedule.name.length > 128)
        throw new AgentScheduleError("name");
    if (!["once", "daily", "weekly", "monthly"].includes(schedule.kind))
        throw new AgentScheduleError("kind");
    const start = dateValue(schedule.startDate);
    const end = schedule.endDate ? dateValue(schedule.endDate) : 99991231;
    if (end < start) throw new AgentScheduleError("range");
    const time = timeValue(schedule.startTime);
    let subdayType = 1;
    let subdayInterval = 0;
    let endTime = 235959;
    if (schedule.repeat) {
        const repeat = schedule.repeat;
        if (
            schedule.kind === "once" ||
            !["seconds", "minutes", "hours"].includes(repeat.unit) ||
            !Number.isInteger(repeat.every) ||
            repeat.every < (repeat.unit === "seconds" ? 10 : 1) ||
            repeat.every > 2147483647
        )
            throw new AgentScheduleError("repeat");
        endTime = timeValue(repeat.endTime);
        if (endTime <= time) throw new AgentScheduleError("range");
        subdayType = repeat.unit === "seconds" ? 2 : repeat.unit === "minutes" ? 4 : 8;
        subdayInterval = repeat.every;
    }
    const every = schedule.every ?? 1;
    if (!Number.isInteger(every) || every < 1 || every > 2147483647)
        throw new AgentScheduleError("recurrence");
    let interval = schedule.kind === "daily" ? every : 0;
    if (schedule.kind === "weekly") {
        const days = schedule.weekdays;
        if (
            !Array.isArray(days) ||
            days.length === 0 ||
            days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
        )
            throw new AgentScheduleError("weekdays");
        interval = [...new Set(days)].reduce((mask, day) => mask | (1 << day), 0);
    }
    if (schedule.kind === "monthly") {
        if (
            !Number.isInteger(schedule.monthDay) ||
            schedule.monthDay! < 1 ||
            schedule.monthDay! > 31
        )
            throw new AgentScheduleError("monthDay");
        interval = schedule.monthDay!;
    }
    return `EXEC @returnCode = msdb.dbo.sp_add_jobschedule
    @job_id = @jobId,
    @name = N'${schedule.name.replace(/'/g, "''")}',
    @enabled = 1,
    @freq_type = ${schedule.kind === "once" ? 1 : schedule.kind === "daily" ? 4 : schedule.kind === "weekly" ? 8 : 16},
    @freq_interval = ${interval},
    @freq_recurrence_factor = ${schedule.kind === "weekly" || schedule.kind === "monthly" ? every : 0},
    @freq_subday_type = ${subdayType},
    @freq_subday_interval = ${subdayInterval},
    @active_start_date = ${start},
    @active_end_date = ${end},
    @active_start_time = ${time},
    @active_end_time = ${endTime};
IF @returnCode <> 0 THROW 51000, 'SQL Agent could not create the job schedule.', 1;`;
}

function timeValue(value: string): number {
    if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value))
        throw new AgentScheduleError("time");
    const [hours, minutes, seconds = 0] = value.split(":").map(Number);
    return hours * 10000 + minutes * 100 + seconds;
}
