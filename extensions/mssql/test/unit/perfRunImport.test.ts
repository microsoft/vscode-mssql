/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Perf-run import: bounded reads (file + UTF-8 line caps), the harness
 * warmup/failure contract (run-config.snapshot.jsonc, errors[]), and the
 * privacy rule that imported SQL text is never plaintext.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    failureReasonOf,
    importPerfMetrics,
    importPerfRep,
    isWarmupRep,
    MAX_MARKER_LINE_BYTES,
    parseJsonc,
    readJsonlBounded,
    readWarmupRepetitions,
    repIdFrom,
} from "../../src/diagnostics/perfRunImport";
import {
    parseMarkerLines,
    redactResultDump,
} from "../../src/diagnostics/perfHistory/perfHistoryService";

function marker(name: string, ns: number, attrs?: Record<string, unknown>): string {
    return JSON.stringify({
        runId: "run",
        name,
        phase: "instant",
        timestampUnixNs: String(ns),
        monotonicNs: String(ns),
        process: { role: "extensionHost", pid: 1, name: "exthost" },
        ...(attrs ? { attrs } : {}),
    });
}

suite("Perf run import", () => {
    let root: string;

    setup(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "perf-import-"));
    });

    teardown(() => {
        try {
            fs.rmSync(root, { recursive: true, force: true });
        } catch {
            // best effort on Windows
        }
    });

    test("readJsonlBounded refuses lines by UTF-8 bytes, not UTF-16 code units", () => {
        const file = path.join(root, "lines.jsonl");
        // 3 bytes per char: a line under the cap in code units but over it in bytes.
        const wide = "€".repeat(MAX_MARKER_LINE_BYTES / 3 + 10);
        expect(wide.length).to.be.lessThan(MAX_MARKER_LINE_BYTES);
        expect(Buffer.byteLength(wide, "utf8")).to.be.greaterThan(MAX_MARKER_LINE_BYTES);
        fs.writeFileSync(file, `{"ok":1}\n${wide}\n\n{"ok":2}\n`, "utf8");
        const bounded = readJsonlBounded(file);
        expect(bounded.lines).to.deep.equal(['{"ok":1}', '{"ok":2}']);
        expect(bounded.refusedLines).to.equal(1);
        expect(bounded.refusedReason).to.equal(undefined);
    });

    test("readJsonlBounded refuses a whole file over the size cap without reading it", () => {
        const file = path.join(root, "big.jsonl");
        fs.writeFileSync(file, "x".repeat(2048), "utf8");
        const bounded = readJsonlBounded(file, 1024);
        expect(bounded.lines).to.deep.equal([]);
        expect(bounded.refusedReason).to.include("over the 1024-byte import cap");
        expect(readJsonlBounded(path.join(root, "missing.jsonl")).refusedReason).to.equal(
            "unreadable",
        );
    });

    test("parseJsonc tolerates comments and trailing commas but keeps string contents", () => {
        const parsed = parseJsonc(
            `{\n  // line comment\n  "warmupRepetitions": 2, /* block */\n  "note": "keep // this /* too */",\n  "list": [1, 2,],\n}`,
        ) as { warmupRepetitions: number; note: string; list: number[] };
        expect(parsed.warmupRepetitions).to.equal(2);
        expect(parsed.note).to.equal("keep // this /* too */");
        expect(parsed.list).to.deep.equal([1, 2]);
    });

    test("warmup is derived from run-config.snapshot.jsonc like the harness loader", () => {
        const runDir = path.join(root, "2026-07-01T00-00-00Z_aa");
        fs.mkdirSync(runDir, { recursive: true });
        expect(readWarmupRepetitions(runDir)).to.equal(0);
        fs.writeFileSync(
            path.join(runDir, "run-config.snapshot.jsonc"),
            `{ "warmupRepetitions": 1, // one cold rep\n "repetitions": 3 }`,
            "utf8",
        );
        expect(readWarmupRepetitions(runDir)).to.equal(1);
        expect(isWarmupRep({}, 0, 1)).to.equal(true);
        expect(isWarmupRep({}, 1, 1)).to.equal(false);
        expect(isWarmupRep({ warmup: true }, 5, 0)).to.equal(true);
        expect(repIdFrom("rep-03", {})).to.equal(3);
        expect(repIdFrom("rep-03", { repId: 7 })).to.equal(7);
        expect(repIdFrom("junk", {})).to.equal(undefined);
    });

    test("failureReason falls back to the harness errors[] record", () => {
        expect(failureReasonOf({})).to.equal(undefined);
        expect(failureReasonOf({ failureReason: "explicit" })).to.equal("explicit");
        expect(
            failureReasonOf({ errors: [{ code: "x" }, { message: "marker sink not clean" }] }),
        ).to.equal("marker sink not clean");
        expect(failureReasonOf({ errors: [{ message: "x".repeat(500) }] })).to.have.length(200);
    });

    test("importPerfRep never imports SQL text as plaintext (digest keeps grouping)", () => {
        const repDir = path.join(root, "rep-00");
        fs.mkdirSync(path.join(repDir, "artifacts", "sql"), { recursive: true });
        fs.writeFileSync(path.join(repDir, "markers.jsonl"), `${marker("scenario.begin", 1e15)}\n`);
        const secret = "SELECT card_number FROM dbo.Customers WHERE ssn = 'canary-123'";
        fs.writeFileSync(
            path.join(repDir, "artifacts", "sql", "sql-activity.jsonl"),
            [
                JSON.stringify({
                    event_name: "sql_batch_completed",
                    ts_utc: "2026-07-01T00:00:00.000Z",
                    duration_us: 1500,
                    cpu_time_us: 1000,
                    logical_reads: 4,
                    row_count: 1,
                    batch_text: secret,
                }),
                JSON.stringify({
                    event_name: "sql_batch_completed",
                    ts_utc: "2026-07-01T00:00:01.000Z",
                    duration_us: 1700,
                    cpu_time_us: 1000,
                    logical_reads: 4,
                    row_count: 1,
                    batch_text: secret,
                }),
            ].join("\n") + "\n",
        );
        const events = importPerfRep(repDir, "run_rep-00");
        const sql = events.filter((e) => e.kind === "sqlActivity");
        expect(sql).to.have.length(2);
        expect(JSON.stringify(events)).to.not.include("card_number");
        expect(JSON.stringify(events)).to.not.include("canary-123");
        const text = sql[0].payload!["text"];
        expect(text.cls).to.equal("sql.text");
        expect(text.handling).to.equal("digest");
        expect(text.digest).to.be.a("string");
        // Same text → same digest: grouping survives redaction.
        expect(sql[1].payload!["text"].digest).to.equal(text.digest);
        expect(sql[0].cls.redactedFields).to.equal(1);
        expect(sql[0].tags).to.not.include("synthetic");
    });

    test("importPerfRep reports a refused markers file instead of silently importing nothing", () => {
        const repDir = path.join(root, "rep-01");
        fs.mkdirSync(repDir, { recursive: true });
        fs.writeFileSync(path.join(repDir, "markers.jsonl"), `${marker("a", 1e15)}\nnot json\n`);
        const events = importPerfRep(repDir, "run_rep-01");
        const warning = events.find((e) => e.type === "import.linesSkipped");
        expect(warning?.payload?.["skipped"]?.v).to.equal(1);
    });

    test("importPerfMetrics excludes derived warmup reps and memoizes per root", () => {
        const runDir = path.join(root, "2026-07-01T00-00-00Z_aa");
        fs.writeFileSync(path.join(root, "README.txt"), "not a run", "utf8");
        fs.mkdirSync(runDir, { recursive: true });
        fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify({ status: "passed" }));
        fs.writeFileSync(
            path.join(runDir, "run-config.snapshot.jsonc"),
            `{ "warmupRepetitions": 1 }`,
            "utf8",
        );
        for (const repId of [0, 1, 2]) {
            const repDir = path.join(runDir, "scenarios", "selftest-noop", "reps", `rep-0${repId}`);
            fs.mkdirSync(repDir, { recursive: true });
            fs.writeFileSync(
                path.join(repDir, "result.json"),
                JSON.stringify({
                    repId,
                    status: "passed",
                    metrics: [
                        {
                            name: "scenario.wallclock",
                            value: 100 + repId,
                            unit: "ms",
                            official: true,
                        },
                    ],
                }),
            );
        }
        const first = importPerfMetrics(root);
        // rep-00 is the warmup rep (config says 1) even though result.json has no warmup flag.
        expect(first.samples.map((s) => s.value)).to.deep.equal([101, 102]);
        expect(first.runs).to.have.length(1);
        expect(importPerfMetrics(root)).to.equal(first); // memoized: same object
        // A changed summary.json invalidates the memo.
        fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify({ status: "failed" }));
        fs.utimesSync(path.join(runDir, "summary.json"), new Date(), new Date(Date.now() + 5000));
        const second = importPerfMetrics(root);
        expect(second).to.not.equal(first);
        expect(second.runs[0].status).to.equal("failed");
    });

    test("parseMarkerLines keeps only well-shaped markers and never throws", () => {
        const markers = parseMarkerLines([
            "null",
            "42",
            '"x"',
            "[1]",
            '{"name":"a"}',
            '{"name":"b","timestampUnixNs":"abc"}',
            '{"name":"c","timestampUnixNs":"123","attrs":{"durationMs":2}}',
            "{not json",
        ]);
        expect(markers).to.have.length(1);
        expect(markers[0].name).to.equal("c");
        expect(markers[0].attrs["durationMs"]).to.equal(2);
    });

    test("redactResultDump strips the machine id and error stacks only", () => {
        const dump = redactResultDump({
            status: "failed",
            environment: { machineId: "DESKTOP-SECRET", os: "win32" },
            errors: [{ message: "boom", stack: "at C:\\Users\\someone\\x.ts:1" }],
        }) as { environment: Record<string, unknown>; errors: Array<Record<string, unknown>> };
        expect(dump.environment.machineId).to.equal("[redacted]");
        expect(dump.environment.os).to.equal("win32");
        expect(dump.errors[0].message).to.equal("boom");
        expect(dump.errors[0].stack).to.equal("[redacted]");
        expect(redactResultDump(null)).to.equal(null);
    });
});
