/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "node:assert/strict";
import { test } from "node:test";
import { createJobScheduleSql, JobSchedule } from "../../src/agent/schedule";
const schedule: JobSchedule = {
    name: "Nightly",
    kind: "daily",
    startDate: "2028-02-29",
    startTime: "00:00",
    every: 2,
};
void test("schedule dates preserve midnight and leap days without timezone conversion", () => {
    const sql = createJobScheduleSql(schedule);
    assert.ok(sql.includes("@active_start_date = 20280229"));
    assert.ok(sql.includes("@active_start_time = 0,"));
    assert.ok(sql.includes("@freq_interval = 2,"));
    for (const startDate of ["2027-02-29", "2028-04-31", "2028-13-01", "1989-12-31", "2028-1-1"]) {
        assert.throws(() => createJobScheduleSql({ ...schedule, startDate }), /date/);
    }
});
void test("weekly schedules use weekday masks and recurrence in weeks", () => {
    const sql = createJobScheduleSql({ ...schedule, kind: "weekly", weekdays: [0, 2, 6, 2] });
    assert.ok(sql.includes("@freq_type = 8,"));
    assert.ok(sql.includes("@freq_interval = 69,"));
    assert.ok(sql.includes("@freq_recurrence_factor = 2,"));
    assert.throws(
        () => createJobScheduleSql({ ...schedule, kind: "weekly", weekdays: [] }),
        /weekdays/,
    );
});
void test("invalid times, date ranges and recurrences are rejected before SQL exists", () => {
    for (const startTime of ["24:00", "12:60", "12:00:60", "12:00Z"])
        assert.throws(() => createJobScheduleSql({ ...schedule, startTime }), /time/);
    assert.throws(() => createJobScheduleSql({ ...schedule, endDate: "2028-02-28" }), /range/);
    for (const every of [0, -1, 1.5, Infinity, 2147483648])
        assert.throws(() => createJobScheduleSql({ ...schedule, every }), /recurrence/);
});
void test("one-time schedule and quoted names cannot introduce SQL", () => {
    const sql = createJobScheduleSql({ ...schedule, kind: "once", name: "Job's schedule" });
    assert.ok(sql.includes("@freq_type = 1,"));
    assert.ok(sql.includes("N'Job''s schedule'"));
});

void test("monthly day and month recurrence compile independently", () => {
    const sql = createJobScheduleSql({ ...schedule, kind: "monthly", monthDay: 31, every: 3 });
    assert.ok(sql.includes("@freq_type = 16,"));
    assert.ok(sql.includes("@freq_interval = 31,"));
    assert.ok(sql.includes("@freq_recurrence_factor = 3,"));
    for (const monthDay of [0, 32, 1.5, undefined])
        assert.throws(
            () => createJobScheduleSql({ ...schedule, kind: "monthly", monthDay }),
            /monthDay/,
        );
});
void test("within-day recurrence preserves units and rejects reversed or invalid windows", () => {
    const sql = createJobScheduleSql({
        ...schedule,
        startTime: "09:00",
        repeat: { unit: "minutes", every: 15, endTime: "17:30" },
    });
    assert.ok(sql.includes("@freq_subday_type = 4,"));
    assert.ok(sql.includes("@freq_subday_interval = 15,"));
    assert.ok(sql.includes("@active_end_time = 173000;"));
    assert.throws(
        () =>
            createJobScheduleSql({
                ...schedule,
                repeat: { unit: "seconds", every: 9, endTime: "12:00" },
            }),
        /repeat/,
    );
    assert.throws(
        () =>
            createJobScheduleSql({
                ...schedule,
                startTime: "23:00",
                repeat: { unit: "hours", every: 1, endTime: "01:00" },
            }),
        /range/,
    );
    assert.throws(
        () =>
            createJobScheduleSql({
                ...schedule,
                kind: "once",
                repeat: { unit: "minutes", every: 5, endTime: "12:00" },
            }),
        /repeat/,
    );
});
