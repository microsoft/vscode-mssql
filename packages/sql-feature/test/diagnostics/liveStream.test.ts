/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
    CAPTURE_FORMAT,
    buildCapture,
    eventsToCsv,
    parseCapture,
} from "../../src/diagnostics/profiler/capture";
import { gate } from "../../src/core/catalog";
import { capabilitiesFrom } from "../../src/core/platform";
import * as agent from "../../src/agent/catalog";
import { ProfilerEvent } from "../../src/diagnostics/profiler/xelParser";

function event(sequence: number, overrides: Partial<ProfilerEvent> = {}): ProfilerEvent {
    return {
        name: "sql_batch_completed",
        timestamp: "2026-09-07T00:00:00.000Z",
        eventTypeId: "00000000-0000-0000-0000-000000000000",
        eventSequence: sequence,
        values: { batch_text: "SELECT 1", duration: "100" },
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Capture round trip
// ---------------------------------------------------------------------------

void test("a saved capture reopens with its events and gaps intact", () => {
    const events = [event(1), event(2), event(5)];
    const gaps = [{ fromSequence: 3, toSequence: 4, count: 2, reason: "bufferOverflow" as const }];

    const capture = buildCapture(
        { sessionName: "trace1", serverName: "srv", windowed: true },
        events,
        gaps,
    );
    const reopened = parseCapture(JSON.stringify(capture));

    assert.equal(reopened.format, CAPTURE_FORMAT);
    assert.equal(reopened.events.length, 3);
    // The gap must survive: without it a reader cannot tell a quiet server from lost events.
    assert.equal(reopened.gaps.length, 1);
    assert.equal(reopened.gaps[0].count, 2);
    assert.equal(reopened.session.startedAt, events[0].timestamp);
});

void test("opening a file that is not a capture says so plainly", () => {
    assert.throws(() => parseCapture("not json"), /not valid JSON/);
    assert.throws(
        () => parseCapture(JSON.stringify({ format: "something-else" })),
        /not a profiler capture/,
    );
});

void test("a capture from a newer format is refused rather than half-read", () => {
    const future = JSON.stringify({ format: CAPTURE_FORMAT, version: 999, events: [] });
    assert.throws(() => parseCapture(future), /newer version/);
});

void test("CSV covers every field, not just the first event's", () => {
    const csv = eventsToCsv([event(1, { values: { a: "1" } }), event(2, { values: { b: "2" } })]);
    const header = csv.split("\n")[0];
    assert.ok(header.includes("a") && header.includes("b"), "both fields should be columns");
});

void test("CSV quotes values containing delimiters", () => {
    const csv = eventsToCsv([event(1, { values: { batch_text: 'SELECT "x", 1' } })]);
    assert.ok(csv.includes('"SELECT ""x"", 1"'), "embedded quotes and commas must be escaped");
});

// ---------------------------------------------------------------------------
// Platform gating
// ---------------------------------------------------------------------------

void test("SQL Agent is hidden on Express, which has no Agent", () => {
    const express = capabilitiesFrom({ engineEditionId: 4, edition: "Express Edition (64-bit)" });
    const result = gate(agent.jobs, express);

    assert.equal(result.allowed, false);
    assert.match(result.reason ?? "", /SQL Server Agent is not available/);
});

void test("SQL Agent is available on Developer edition", () => {
    const developer = capabilitiesFrom({
        engineEditionId: 3,
        edition: "Developer Edition (64-bit)",
    });
    assert.equal(gate(agent.jobs, developer).allowed, true);
});

void test("SQL Agent is hidden on Azure SQL Database", () => {
    const azure = capabilitiesFrom({ engineEditionId: 5, edition: "SQL Azure" });
    const result = gate(agent.jobs, azure);

    assert.equal(result.allowed, false);
    assert.match(result.reason ?? "", /Azure SQL Database/);
});

void test("Extended Events are database-scoped on Azure SQL Database", () => {
    assert.equal(capabilitiesFrom({ engineEditionId: 5 }).xeventScope, "database");
    assert.equal(capabilitiesFrom({ engineEditionId: 3 }).xeventScope, "server");
    // Synapse has no Extended Events surface these features can use.
    assert.equal(capabilitiesFrom({ engineEditionId: 6 }).xeventScope, "none");
});

void test("an unidentified server offers nothing rather than probing blindly", () => {
    const unknown = capabilitiesFrom({ engineEditionId: 999 });
    assert.equal(unknown.platform, "unknown");
    assert.equal(unknown.hasSqlAgent, false);
    assert.equal(unknown.hasExecutionDmvs, false);
});

// ---------------------------------------------------------------------------
// SQL construction safety
// ---------------------------------------------------------------------------

void test("job actions require stable IDs and reject display names or injected SQL", () => {
    assert.throws(() => agent.startJobSql("nightly'; DROP TABLE x; --"), /job ID/);
    assert.throws(() => agent.startJobSql("nightly"), /job ID/);
    const id = "01234567-89ab-cdef-0123-456789abcdef";
    for (const sql of [
        agent.startJobSql(id),
        agent.stopJobSql(id),
        agent.deleteJobSql(id),
        agent.setJobEnabledSql(id, false),
    ]) {
        assert.ok(sql.includes(`@job_id = N'${id}'`));
        assert.ok(!sql.includes("@job_name"));
    }
    assert.ok(agent.deleteJobSql(id).includes("@delete_unused_schedule = 0"));
});

void test("creating a job requires a name and at least one step", () => {
    assert.throws(() => agent.createJobSql({ name: "  ", steps: [] }), /name is required/);
    assert.throws(() => agent.createJobSql({ name: "j", steps: [] }), /at least one step/);
});

void test("a created job is bound to a server, or it could never run", () => {
    const sql = agent.createJobSql({
        name: "nightly",
        steps: [{ name: "step1", command: "SELECT 1", database: "Warehouse" }],
    });
    assert.ok(sql.includes("sp_add_jobserver"), "without this the job exists but never fires");
});

void test("job creation rejects incomplete steps instead of silently dropping work", () => {
    assert.throws(
        () =>
            agent.createJobSql({
                name: "Job",
                steps: [
                    { name: "First", command: "SELECT 1", database: "Warehouse" },
                    { name: "Second", command: " ", database: "Warehouse" },
                ],
            }),
        /command/,
    );
    assert.throws(
        () =>
            agent.createJobSql({
                name: "Job",
                steps: [{ name: "", command: "SELECT 1", database: "Warehouse" }],
            }),
        /step needs a name/,
    );
    assert.throws(
        () =>
            agent.createJobSql({
                name: "x".repeat(129),
                steps: [{ name: "Step", command: "SELECT 1", database: "Warehouse" }],
            }),
        /128/,
    );
    const missingDatabase = {
        name: "Job",
        steps: [{ name: "Step", command: "SELECT 1" }],
    } as unknown as Parameters<typeof agent.createJobSql>[0];
    assert.throws(() => agent.createJobSql(missingDatabase), /database/);
});

void test("step retries preserve counts and minute intervals and reject unsafe values", () => {
    const step = {
        name: "Step",
        command: "SELECT 1",
        database: "Warehouse",
        retryAttempts: 3,
        retryIntervalMinutes: 5,
    };
    const sql = agent.createJobSql({ name: "Job", steps: [step] });
    assert.ok(sql.includes("@retry_attempts = 3"));
    assert.ok(sql.includes("@retry_interval = 5"));
    for (const invalid of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2147483648]) {
        assert.throws(
            () => agent.createJobSql({ name: "Job", steps: [{ ...step, retryAttempts: invalid }] }),
            /Retry settings/,
        );
        assert.throws(
            () =>
                agent.createJobSql({
                    name: "Job",
                    steps: [{ ...step, retryIntervalMinutes: invalid }],
                }),
            /Retry settings/,
        );
    }
});
