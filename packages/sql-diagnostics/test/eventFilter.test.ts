/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from "node:test";
import * as assert from "node:assert/strict";

import { matchesFilter, parseFilter } from "../src/profiler/eventFilter";
import { ProfilerEvent } from "../src/profiler/xelParser";

function event(name: string, values: Record<string, string>): ProfilerEvent {
    return { name, timestamp: "2026-09-07T10:00:00.000Z", values } as ProfilerEvent;
}

const slow = event("sql_batch_completed", {
    batch_text: "SELECT TOP (3) name FROM sys.objects ORDER BY name;",
    duration: "250000",
    cpu_time: "120000",
    logical_reads: "5400",
    database_name: "master",
    client_app_name: "SQLCMD",
    session_id: "73",
});

const quick = event("sql_batch_completed", {
    batch_text: "SELECT 1;",
    duration: "800",
    cpu_time: "100",
    logical_reads: "2",
    database_name: "tempdb",
    client_app_name: "vscode-mssql",
    session_id: "51",
});

const starting = event("sql_batch_starting", {
    batch_text: "EXEC dbo.usp_Work;",
    database_name: "master",
    client_app_name: "SQLCMD",
    session_id: "73",
});

const match = (input: string, e: ProfilerEvent) => matchesFilter(e, parseFilter(input));

void test("an empty filter keeps everything", () => {
    assert.ok(match("", slow));
    assert.ok(match("   ", quick));
    assert.ok(parseFilter("").isEmpty);
});

void test("bare words match any field", () => {
    assert.ok(match("order by", slow));
    assert.ok(!match("order by", quick));
    // Matching is case-insensitive, since nobody types SQL back exactly as captured.
    assert.ok(match("ORDER BY", slow));
});

void test("a quoted phrase is one term, not two words", () => {
    assert.ok(match('"ORDER BY name"', slow));
    assert.ok(!match('"name ORDER BY"', slow));
});

void test("terms are ANDed so each word narrows further", () => {
    assert.ok(match("select master", slow));
    assert.ok(!match("select tempdb", slow));
});

void test("field terms narrow to that field", () => {
    assert.ok(match("db:master", slow));
    assert.ok(!match("db:master", quick));
    // The alias and the real field name mean the same thing.
    assert.ok(match("database_name:master", slow));
});

void test("aliases spare the user the Extended Events field names", () => {
    assert.ok(match("app:SQLCMD", slow));
    assert.ok(match("text:objects", slow));
    assert.ok(match("spid:73", slow));
});

void test("event: matches the event type rather than a field", () => {
    assert.ok(match("event:completed", slow));
    assert.ok(!match("event:completed", starting));
    assert.ok(match("event:starting", starting));
});

void test("numeric comparisons work on duration in real units", () => {
    assert.ok(match("duration:>100ms", slow));
    assert.ok(!match("duration:>100ms", quick));
    assert.ok(match("duration:<1ms", quick));
    // A bare number on a duration field is the raw microsecond value.
    assert.ok(match("duration:>1000", slow));
});

void test("seconds and thousands suffixes convert", () => {
    assert.ok(!match("duration:>1s", slow));
    assert.ok(match("duration:<1s", slow));
    assert.ok(match("reads:>1k", slow));
    assert.ok(!match("reads:>1k", quick));
});

void test("an id keeps behaving like an id, not a comparison", () => {
    assert.ok(match("session:73", slow));
    assert.ok(!match("session:73", quick));
});

void test("a leading dash excludes", () => {
    assert.ok(!match("-app:SQLCMD", slow));
    assert.ok(match("-app:SQLCMD", quick));
    assert.ok(match("-nonsense", slow));
});

void test("negation combines with other terms", () => {
    assert.ok(match("db:master -event:starting", slow));
    assert.ok(!match("db:master -event:starting", starting));
});

void test("a field the event does not carry simply does not match", () => {
    // sql_batch_starting has no duration, so a duration filter must exclude it rather than
    // throw or silently pass.
    assert.ok(!match("duration:>1ms", starting));
    assert.ok(match("-duration:>1ms", starting));
});

void test("a half-typed filter narrows instead of erroring", () => {
    // Every prefix of a real filter has to be a valid filter, or typing flashes errors.
    for (const prefix of ["d", "du", "duration", "duration:", "duration:>", "duration:>10"]) {
        assert.doesNotThrow(() => parseFilter(prefix));
    }
    assert.ok(match("duration:", slow), "a trailing colon is treated as text, not an error");
});

void test("unknown fields match nothing rather than everything", () => {
    assert.ok(!match("nosuchfield:value", slow));
});
