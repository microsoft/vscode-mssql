/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ExecutionOrchestrator end-to-end over the FakeBackend: batch loop,
 * continue-on-error (SSMS default), stopOnError, cancel partial truth,
 * multi-batch GO scripts, error-line mapping into navigable messages, and
 * RowStore window serving of what streamed — the whole M2 host pipeline in
 * one process.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FakeBackend } from "../../src/services/sqlDataPlane/fakeBackend";
import { ExecutionOrchestrator, RunEvents } from "../../src/queryStudio/executionOrchestrator";
import { DEFAULT_LIMITS, RowStore } from "../../src/queryStudio/rowStore";
import { QsMessageRow } from "../../src/sharedInterfaces/queryStudio";
import {
    IQueryEventSink,
    ISqlSession,
    QueryCompleteSummary,
    QueryHandle,
} from "../../src/services/sqlDataPlane/api";

class RecordingEvents implements RunEvents {
    readonly phases: string[] = [];
    readonly messages: QsMessageRow[] = [];
    readonly resultSets: string[] = [];
    readonly rowEvents: Array<{ id: string; n: number }> = [];
    onResultSetStarted(s: { resultSetId: string }): void {
        this.resultSets.push(s.resultSetId);
    }
    onRowsAppended(id: string, n: number): void {
        this.rowEvents.push({ id, n });
    }
    onResultSetEnded(): void {}
    onMessages(messages: QsMessageRow[]): void {
        this.messages.push(...messages);
    }
    onPhase(phase: string): void {
        this.phases.push(phase);
    }
}

async function sessionFor(backend: FakeBackend): Promise<ISqlSession> {
    return backend.openSession({
        profile: {
            profileFingerprint: "fp",
            server: "localhost",
            authKind: "sql",
            user: "sa",
        },
        applicationName: "test",
    });
}

function store(): RowStore {
    return new RowStore(fs.mkdtempSync(path.join(os.tmpdir(), "qs-orch-")));
}

/**
 * Minimal scripted ISqlSession mimicking the STS2 binding's sink usage:
 * server messages carry number/severity/line, and onResultSetEnded is NEVER
 * sent (it's optional on IQueryEventSink and the real adapter doesn't emit
 * it) — the orchestrator must close open sets at batch completion itself.
 */
function scriptedSession(
    runBatch: (
        text: string,
        sink: IQueryEventSink,
    ) => Promise<Omit<QueryCompleteSummary, "clientQueryId">>,
): ISqlSession {
    return {
        state: "open",
        execute(text: string, _opts: unknown, sink: IQueryEventSink): QueryHandle {
            const completion = (async (): Promise<QueryCompleteSummary> => {
                const summary = { clientQueryId: "q", ...(await runBatch(text, sink)) };
                await sink.onComplete(summary);
                return summary;
            })();
            return {
                clientQueryId: "q",
                completion,
                cancel: async () => ({ acknowledged: false }),
                dispose: async () => undefined,
            } as QueryHandle;
        },
    } as unknown as ISqlSession;
}

suite("Query Studio execution orchestrator", () => {
    test("multi-batch GO script: both batches execute, rows land in the store, windows serve", async () => {
        const backend = new FakeBackend({
            scripts: [
                {
                    match: (t) => t.includes("select 1"),
                    events: [
                        { type: "resultSet", columns: ["a"], rows: [[1], [2]] },
                        { type: "message", kind: "info", text: "(2 rows affected)" },
                        { type: "complete", status: "succeeded", rowsAffected: 2 },
                    ],
                },
                {
                    match: (t) => t.includes("select 3"),
                    events: [
                        { type: "resultSet", columns: ["b"], rows: [[3]] },
                        { type: "complete", status: "succeeded", rowsAffected: 1 },
                    ],
                },
            ],
        });
        const session = await sessionFor(backend);
        const rowStore = store();
        const events = new RecordingEvents();
        const orchestrator = new ExecutionOrchestrator(session, rowStore, events);
        const result = await orchestrator.run("select 1\nGO\nselect 3", {
            selectionStartLine: 1,
            stopOnError: false,
            scope: "document",
        });
        expect(result.status).to.equal("succeeded");
        expect(result.batches).to.equal(2);
        expect(result.resultSets).to.equal(2);
        expect(result.totalRows).to.equal(3);
        expect(result.rowsAffected).to.equal(3);
        // Store ids are batch-scoped; both windows serve.
        expect((await rowStore.getRows(events.resultSets[0], 0, 10)).rowCount).to.equal(2);
        expect((await rowStore.getRows(events.resultSets[1], 0, 10)).rowCount).to.equal(1);
        expect(events.phases[0]).to.equal("executing");
        expect(events.phases[events.phases.length - 1]).to.equal("succeeded");
        rowStore.dispose();
    });

    test("continue-on-error (SSMS default): failed batch doesn't stop the run; summary says completedWithErrors", async () => {
        const backend = new FakeBackend({
            scripts: [
                {
                    match: (t) => t.includes("bad"),
                    events: [
                        {
                            type: "message",
                            kind: "error",
                            text: "Invalid object name 'missing'.",
                            line: 1,
                        },
                        { type: "complete", status: "failed" },
                    ],
                },
                {
                    match: (t) => t.includes("good"),
                    events: [
                        { type: "resultSet", columns: ["x"], rows: [[42]] },
                        { type: "complete", status: "succeeded" },
                    ],
                },
            ],
        });
        const session = await sessionFor(backend);
        const rowStore = store();
        const events = new RecordingEvents();
        const orchestrator = new ExecutionOrchestrator(session, rowStore, events);
        const result = await orchestrator.run("select bad\nGO\nselect good", {
            selectionStartLine: 1,
            stopOnError: false,
            scope: "document",
        });
        expect(result.status).to.equal("completedWithErrors");
        expect(result.totalRows).to.equal(1); // the good batch still ran
        expect(result.errors).to.equal(1);
        rowStore.dispose();
    });

    test("stopOnError halts at the failing batch", async () => {
        const backend = new FakeBackend({
            scripts: [
                {
                    match: (t) => t.includes("bad"),
                    events: [
                        { type: "message", kind: "error", text: "boom", line: 1 },
                        { type: "complete", status: "failed" },
                    ],
                },
                {
                    match: (t) => t.includes("good"),
                    events: [
                        { type: "resultSet", columns: ["x"], rows: [[42]] },
                        { type: "complete", status: "succeeded" },
                    ],
                },
            ],
        });
        const session = await sessionFor(backend);
        const rowStore = store();
        const orchestrator = new ExecutionOrchestrator(session, rowStore, new RecordingEvents());
        const result = await orchestrator.run("select bad\nGO\nselect good", {
            selectionStartLine: 1,
            stopOnError: true,
            scope: "document",
        });
        expect(result.status).to.equal("completedWithErrors");
        expect(result.totalRows).to.equal(0); // second batch never ran
        rowStore.dispose();
    });

    test("error messages map server lines to navigable document lines (selection offset)", async () => {
        const backend = new FakeBackend({
            scripts: [
                {
                    match: () => true,
                    events: [
                        { type: "message", kind: "error", text: "Msg 208", line: 3 },
                        { type: "complete", status: "failed" },
                    ],
                },
            ],
        });
        const session = await sessionFor(backend);
        const rowStore = store();
        const events = new RecordingEvents();
        const orchestrator = new ExecutionOrchestrator(session, rowStore, events);
        // Executed text starts at document line 10 (selection execution).
        await orchestrator.run("select x", {
            selectionStartLine: 10,
            stopOnError: false,
            scope: "selection",
        });
        // messages[0] is the synthesized "Started executing" line — find
        // the server error among the run's messages.
        const error = events.messages.find((m) => m.kind === "error");
        expect(error?.navigable?.line).to.equal(12); // 10 + 0 + (3-1)
        rowStore.dispose();
    });

    test("terminal summary error is surfaced in Messages when no error message arrived", async () => {
        const session = scriptedSession(async () => ({
            status: "failed",
            resultSetCount: 0,
            totalRows: 0,
            errorCount: 1,
            error: {
                code: "208",
                message: "Invalid object name 'sys'.",
                retryable: false,
                server: { number: 208, severity: 16, state: 1, line: 1 },
            },
        }));
        const rowStore = store();
        const events = new RecordingEvents();
        const orchestrator = new ExecutionOrchestrator(session, rowStore, events);
        const result = await orchestrator.run("select * from sys.", {
            selectionStartLine: 1,
            stopOnError: false,
            scope: "document",
        });

        const error = events.messages.find((m) => m.kind === "error");
        expect(result.status).to.equal("completedWithErrors");
        expect(result.errors).to.equal(1);
        expect(error?.text).to.contain("Msg 208, Level 16, State 1, Line 1");
        expect(error?.text).to.contain("Invalid object name 'sys'.");
        expect(error?.navigable?.line).to.equal(1);
        rowStore.dispose();
    });

    test("parse-only wrapper batches wait for active-query cleanup before the next execute", async () => {
        const seen: string[] = [];
        const backend = new FakeBackend({
            scripts: [
                {
                    match: (text) => {
                        const matched = text.trim().toUpperCase() === "SET PARSEONLY ON;";
                        if (matched) {
                            seen.push("on");
                        }
                        return matched;
                    },
                    events: [{ type: "complete", status: "succeeded" }],
                },
                {
                    match: (text) => {
                        const matched = text.includes("EXEC");
                        if (matched) {
                            seen.push("user");
                        }
                        return matched;
                    },
                    events: [
                        {
                            type: "message",
                            kind: "error",
                            text: "Incorrect syntax near 'EXEC'.",
                            line: 1,
                        },
                        { type: "complete", status: "failed" },
                    ],
                },
                {
                    match: (text) => {
                        const matched = text.trim().toUpperCase() === "SET PARSEONLY OFF;";
                        if (matched) {
                            seen.push("off");
                        }
                        return matched;
                    },
                    events: [{ type: "complete", status: "succeeded" }],
                },
            ],
        });
        const session = await sessionFor(backend);
        const rowStore = store();
        const events = new RecordingEvents();
        const orchestrator = new ExecutionOrchestrator(session, rowStore, events);
        const result = await orchestrator.run("EXEC", {
            selectionStartLine: 1,
            stopOnError: false,
            scope: "document",
            mode: "parseOnly",
        });

        expect(result.status).to.equal("completedWithErrors");
        expect(seen).to.deep.equal(["on", "user", "off"]);
        expect(events.messages.some((message) => /one active query/i.test(message.text))).to.equal(
            false,
        );
        rowStore.dispose();
    });

    test("synthesizes classic execution messages: started line, rows affected, total time (ordered)", async () => {
        const backend = new FakeBackend({
            scripts: [
                {
                    match: (t) => t.includes("select 1"),
                    events: [
                        { type: "resultSet", columns: ["a"], rows: [[1], [2]] },
                        { type: "complete", status: "succeeded", rowsAffected: 2 },
                    ],
                },
                {
                    // DML batch: no result set — rowsAffected rides the summary.
                    match: (t) => t.includes("update t"),
                    events: [{ type: "complete", status: "succeeded", rowsAffected: 5 }],
                },
            ],
        });
        const session = await sessionFor(backend);
        const rowStore = store();
        const events = new RecordingEvents();
        const orchestrator = new ExecutionOrchestrator(session, rowStore, events);
        await orchestrator.run("select 1\nGO\nupdate t set x = 1", {
            selectionStartLine: 3,
            stopOnError: false,
            scope: "selection",
        });
        const texts = events.messages.map((m) => m.text);
        // Classic/SSMS wording, in run order.
        expect(texts[0]).to.equal("Started executing query at Line 3");
        expect(texts[texts.length - 1]).to.match(
            /^Total execution time: \d{2}:\d{2}:\d{2}\.\d{3}$/,
        );
        const selectAffected = texts.indexOf("(2 rows affected)"); // result-set count
        const dmlAffected = texts.indexOf("(5 rows affected)"); // summary rowsAffected
        expect(selectAffected).to.be.greaterThan(0);
        expect(dmlAffected).to.be.greaterThan(selectAffected); // batch order preserved
        expect(dmlAffected).to.be.lessThan(texts.length - 1); // before total time
        rowStore.dispose();
    });

    test("rows-affected synthesis uses singular wording for one row", async () => {
        const backend = new FakeBackend({
            scripts: [
                {
                    match: () => true,
                    events: [
                        { type: "resultSet", columns: ["n"], rows: [[7]] },
                        { type: "complete", status: "succeeded", rowsAffected: 1 },
                    ],
                },
            ],
        });
        const session = await sessionFor(backend);
        const rowStore = store();
        const events = new RecordingEvents();
        const orchestrator = new ExecutionOrchestrator(session, rowStore, events);
        await orchestrator.run("select 7", {
            selectionStartLine: 1,
            stopOnError: false,
            scope: "document",
        });
        const texts = events.messages.map((m) => m.text);
        expect(texts).to.include("(1 row affected)");
        expect(texts).to.not.include("(1 rows affected)");
        rowStore.dispose();
    });

    test("cancel mid-stream: partial rows retained, sets marked cancelled, run canceled", async () => {
        const backend = new FakeBackend({
            scripts: [
                {
                    match: () => true,
                    events: [
                        {
                            type: "resultSet",
                            columns: ["n"],
                            rows: Array.from({ length: 60 }, (_, i) => [i]),
                            pageSize: 10,
                            pageDelayMs: 8,
                        },
                        { type: "complete", status: "succeeded" },
                    ],
                },
            ],
        });
        const session = await sessionFor(backend);
        const rowStore = store();
        const events = new RecordingEvents();
        const orchestrator = new ExecutionOrchestrator(session, rowStore, events);
        const runPromise = orchestrator.run("select big", {
            selectionStartLine: 1,
            stopOnError: false,
            scope: "document",
        });
        await new Promise((r) => setTimeout(r, 20));
        await orchestrator.requestCancel();
        const result = await runPromise;
        expect(result.status).to.equal("canceled");
        expect(result.totalRows).to.be.greaterThan(0);
        expect(result.totalRows).to.be.lessThan(60);
        const summary = rowStore.summary(events.resultSets[0]);
        expect(summary?.truncatedReason).to.equal("cancelled");
        expect(events.phases).to.include("cancelRequested");
        // A cancelled set's clipped count must NOT print as "rows affected".
        expect(events.messages.some((m) => m.text.includes("rows affected"))).to.equal(false);
        rowStore.dispose();
    });

    test("row cap truncates the result set and cancels the active query", async () => {
        const backend = new FakeBackend({
            scripts: [
                {
                    match: () => true,
                    events: [
                        {
                            type: "resultSet",
                            columns: ["n"],
                            rows: Array.from({ length: 5 }, (_, i) => [i]),
                            pageSize: 1,
                        },
                        { type: "complete", status: "succeeded" },
                    ],
                },
            ],
        });
        const session = await sessionFor(backend);
        const rowStore = new RowStore(fs.mkdtempSync(path.join(os.tmpdir(), "qs-orch-")), {
            ...DEFAULT_LIMITS,
            maxRowsPerResultSet: 2,
        });
        const events = new RecordingEvents();
        const orchestrator = new ExecutionOrchestrator(session, rowStore, events);
        const result = await orchestrator.run("select too_much", {
            selectionStartLine: 1,
            stopOnError: false,
            scope: "document",
        });
        const storeId = events.resultSets[0];
        const summary = rowStore.summary(storeId);
        const warning = events.messages.find((m) => m.kind === "warning");

        expect(result.status).to.equal("canceled");
        expect(result.totalRows).to.equal(2);
        expect(events.phases).to.include("cancelRequested");
        expect(summary?.rowCount).to.equal(2);
        expect(summary?.complete).to.equal(true);
        expect(summary?.truncatedReason).to.equal("maxRowsPerResultSet");
        expect(warning?.text).to.contain("result row limit of 2 rows");
        expect(warning?.text).to.contain("mssql.queryStudio.maxRowsPerResultSet");
        expect(events.messages.some((m) => m.text.includes("rows affected"))).to.equal(false);
        rowStore.dispose();
    });

    test("GO n repeats a batch and store ids stay distinct per repetition", async () => {
        const backend = new FakeBackend({
            scripts: [
                {
                    match: () => true,
                    events: [
                        { type: "resultSet", columns: ["n"], rows: [[1]] },
                        { type: "complete", status: "succeeded", rowsAffected: 1 },
                    ],
                },
            ],
        });
        const session = await sessionFor(backend);
        const rowStore = store();
        const events = new RecordingEvents();
        const orchestrator = new ExecutionOrchestrator(session, rowStore, events);
        const result = await orchestrator.run("insert t values(1)\nGO 3", {
            selectionStartLine: 1,
            stopOnError: false,
            scope: "document",
        });
        expect(result.batches).to.equal(3);
        expect(result.totalRows).to.equal(3);
        expect(result.rowsAffected).to.equal(3);
        expect(new Set(events.resultSets).size).to.equal(3);
        // GO n is ONE batch repeated — one started line, not n.
        expect(
            events.messages.filter((m) => m.text.startsWith("Started executing query")).length,
        ).to.equal(1);
        rowStore.dispose();
    });

    test("SSMS message parity: per-GO-batch started lines, error header + mapping, second batch rows affected, total time last", async () => {
        // Karl's repro: batch 1 fails with Msg 4145 at its line 3; batch 2
        // (document line 7 — the raw start after GO, blank line included)
        // returns 5 rows. The adapter never sends onResultSetEnded (STS2
        // parity) — the orchestrator must still print "(5 rows affected)".
        const script =
            "SELECT *\nFROM sys.databases d\nWHERE condition;\n\n\nGO\n\nselect t.name\nfrom sys.tables t;";
        const session = scriptedSession(async (text, sink) => {
            if (text.includes("sys.databases")) {
                await sink.onMessage({
                    kind: "error",
                    text: "An expression of non-boolean type specified in a context where a condition is expected, near ';'.",
                    number: 4145,
                    severity: 15,
                    line: 3,
                });
                return { status: "failed", resultSetCount: 0, totalRows: 0, errorCount: 1 };
            }
            await sink.onResultSetStarted({
                resultSetId: "rs1",
                batchOrdinal: 0,
                columns: [{ ordinal: 0, name: "name", displayName: "name" }],
            });
            await sink.onRowsPage({
                resultSetId: "rs1",
                pageSeq: 0,
                rowOffset: 0,
                compact: { values: [["a"], ["b"], ["c"], ["d"], ["e"]] },
                rowCount: 5,
                approxBytes: 25,
            });
            // Deliberately NO onResultSetEnded here.
            return { status: "succeeded", resultSetCount: 1, totalRows: 5, errorCount: 0 };
        });
        const rowStore = store();
        const events = new RecordingEvents();
        const orchestrator = new ExecutionOrchestrator(session, rowStore, events);
        const result = await orchestrator.run(script, {
            selectionStartLine: 1,
            stopOnError: false,
            scope: "document",
        });
        const texts = events.messages.map((m) => m.text);
        expect(texts).to.have.length(5);
        expect(texts[0]).to.equal("Started executing query at Line 1");
        expect(texts[1]).to.equal(
            "Msg 4145, Level 15, State 1, Line 3\n" +
                "An expression of non-boolean type specified in a context where a condition is expected, near ';'.",
        );
        expect(texts[2]).to.equal("Started executing query at Line 7");
        expect(texts[3]).to.equal("(5 rows affected)");
        expect(texts[4]).to.match(/^Total execution time: \d{2}:\d{2}:\d{2}\.\d{3}$/);
        // Error row keeps navigation + server metadata (document-mapped line).
        const error = events.messages.find((m) => m.kind === "error");
        expect(error?.navigable?.line).to.equal(3);
        expect(error?.server?.number).to.equal(4145);
        expect(error?.server?.severity).to.equal(15);
        expect(error?.server?.line).to.equal(3);
        // Continue-on-error: batch 2's rows still streamed and closed.
        expect(result.status).to.equal("completedWithErrors");
        expect(result.totalRows).to.equal(5);
        expect((await rowStore.getRows(events.resultSets[0], 0, 10)).rowCount).to.equal(5);
        expect(rowStore.summary(events.resultSets[0])?.complete).to.equal(true);
        rowStore.dispose();
    });

    test("selection offset shifts per-batch started lines and error header lines", async () => {
        // Same shape as the repro but executed as a selection starting at
        // document line 4: every synthesized line is document-mapped.
        const session = scriptedSession(async (text, sink) => {
            if (text.includes("bad")) {
                await sink.onMessage({
                    kind: "error",
                    text: "boom",
                    number: 208,
                    severity: 16,
                    state: 3,
                    line: 2,
                });
                return { status: "failed", resultSetCount: 0, totalRows: 0, errorCount: 1 };
            }
            return { status: "succeeded", resultSetCount: 0, totalRows: 0, errorCount: 0 };
        });
        const rowStore = store();
        const events = new RecordingEvents();
        const orchestrator = new ExecutionOrchestrator(session, rowStore, events);
        await orchestrator.run("select 1\nselect bad;\nGO\nselect 2", {
            selectionStartLine: 4,
            stopOnError: false,
            scope: "selection",
        });
        const texts = events.messages.map((m) => m.text);
        expect(texts[0]).to.equal("Started executing query at Line 4");
        // Server line 2 → document line 4 + 0 + (2 - 1) = 5; wire state kept.
        expect(texts[1]).to.equal("Msg 208, Level 16, State 3, Line 5\nboom");
        expect(texts[2]).to.equal("Started executing query at Line 7");
        const error = events.messages.find((m) => m.kind === "error");
        expect(error?.navigable?.line).to.equal(5);
        expect(error?.server?.state).to.equal(3);
        rowStore.dispose();
    });

    test("rows affected prints once when the adapter DOES report result-set end", async () => {
        // FakeBackend sends onResultSetEnded — the completion-time close for
        // STS2-style adapters must not print a duplicate count.
        const backend = new FakeBackend({
            scripts: [
                {
                    match: () => true,
                    events: [
                        { type: "resultSet", columns: ["a"], rows: [[1], [2]] },
                        { type: "complete", status: "succeeded", rowsAffected: 2 },
                    ],
                },
            ],
        });
        const session = await sessionFor(backend);
        const rowStore = store();
        const events = new RecordingEvents();
        const orchestrator = new ExecutionOrchestrator(session, rowStore, events);
        await orchestrator.run("select 1", {
            selectionStartLine: 1,
            stopOnError: false,
            scope: "document",
        });
        const affected = events.messages.filter((m) => m.text === "(2 rows affected)");
        expect(affected).to.have.length(1);
        rowStore.dispose();
    });

    test("tuning wire params flow into every user batch's ExecuteOptions (QO-1)", async () => {
        const seenOptions: Array<Record<string, unknown>> = [];
        const session: ISqlSession = {
            state: "open",
            execute(_text: string, opts: unknown, sink: IQueryEventSink): QueryHandle {
                seenOptions.push({ ...(opts as Record<string, unknown>) });
                const completion = (async (): Promise<QueryCompleteSummary> => {
                    const summary: QueryCompleteSummary = {
                        clientQueryId: "q",
                        status: "succeeded",
                    } as QueryCompleteSummary;
                    await sink.onComplete(summary);
                    return summary;
                })();
                return {
                    clientQueryId: "q",
                    completion,
                    cancel: async () => ({ acknowledged: false }),
                    dispose: async () => undefined,
                } as QueryHandle;
            },
        } as unknown as ISqlSession;
        const rowStore = store();
        const orchestrator = new ExecutionOrchestrator(session, rowStore, new RecordingEvents());
        await orchestrator.run("select 1\nGO\nselect 2", {
            selectionStartLine: 1,
            stopOnError: false,
            scope: "document",
            wire: { pageRows: 512, pageBytes: 131072, maxCellBytes: 65536 },
        });
        expect(seenOptions).to.have.length(2);
        for (const opts of seenOptions) {
            expect(opts.pageRows).to.equal(512);
            expect(opts.pageBytes).to.equal(131072);
            expect(opts.maxCellBytes).to.equal(65536);
            expect(opts.priority).to.equal("interactive");
        }
        rowStore.dispose();
    });
});
