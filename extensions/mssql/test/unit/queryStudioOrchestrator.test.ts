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
import { RowStore } from "../../src/queryStudio/rowStore";
import { QsMessageRow } from "../../src/sharedInterfaces/queryStudio";
import { ISqlSession } from "../../src/services/sqlDataPlane/api";

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
        expect(rowStore.getRows(events.resultSets[0], 0, 10).rowCount).to.equal(2);
        expect(rowStore.getRows(events.resultSets[1], 0, 10).rowCount).to.equal(1);
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
        expect(events.messages[0].navigable?.line).to.equal(12); // 10 + 0 + (3-1)
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
        rowStore.dispose();
    });
});
