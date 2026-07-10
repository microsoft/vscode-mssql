/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Dogfood 2026-07-10 (held-F5): executing while a run is active must cancel
 * the run and QUEUE the new request — never surface "one active query per
 * STS2 session". Covers the two halves:
 * - ExecutionHost: cancel → wait for terminal → queued rerun (latest wins);
 *   the post-run probe never runs between a run and its queued restart.
 * - ExecutionOrchestrator: a briefly-busy session (post-run @@TRANCOUNT /
 *   @@SPID probe holding the single query slot) is WAITED OUT, not failed.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ExecutionHost } from "../../src/queryStudio/executionHost";
import { ExecutionOrchestrator, RunEvents } from "../../src/queryStudio/executionOrchestrator";
import { RowStore } from "../../src/queryStudio/rowStore";
import { DocumentSessionBinding } from "../../src/queryStudio/documentSessionBinding";
import {
    IQueryEventSink,
    ISqlSession,
    QueryCompleteSummary,
    QueryHandle,
} from "../../src/services/sqlDataPlane/api";

const RECORDING_EVENTS = (): RunEvents =>
    ({
        onResultSetStarted: () => undefined,
        onRowsAppended: () => undefined,
        onResultSetEnded: () => undefined,
        onMessages: () => undefined,
        onPhase: () => undefined,
    }) as unknown as RunEvents;

function instantHandle(sink: IQueryEventSink): QueryHandle {
    const summary: QueryCompleteSummary = {
        clientQueryId: "q",
        status: "succeeded",
    } as QueryCompleteSummary;
    const completion = (async () => {
        await sink.onComplete(summary);
        return summary;
    })();
    return {
        clientQueryId: "q",
        completion,
        cancel: async () => ({ acknowledged: false }),
        dispose: async () => undefined,
    } as unknown as QueryHandle;
}

async function waitFor(predicate: () => boolean, ms = 4_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!predicate()) {
        if (Date.now() > deadline) {
            throw new Error("condition not reached in time");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

suite("Query Studio restart-on-execute (dogfood)", () => {
    test("orchestrator waits out a briefly-busy session instead of failing the run", async () => {
        let busyThrows = 2;
        const session = {
            state: "open",
            execute(_text: string, _opts: unknown, sink: IQueryEventSink): QueryHandle {
                if (busyThrows > 0) {
                    busyThrows--;
                    const error = new Error("one active query per STS2 session") as Error & {
                        code: string;
                    };
                    error.code = "SqlDataPlane.Busy";
                    throw error;
                }
                return instantHandle(sink);
            },
        } as unknown as ISqlSession;
        const rowStore = new RowStore(fs.mkdtempSync(path.join(os.tmpdir(), "qs-busy-")));
        const result = await new ExecutionOrchestrator(session, rowStore, RECORDING_EVENTS()).run(
            "select 1",
            { selectionStartLine: 1, stopOnError: false, scope: "document" },
        );
        expect(result.status).to.equal("succeeded");
        expect(busyThrows).to.equal(0); // both busy throws were retried through
        rowStore.dispose();
    });

    test("orchestrator rethrows non-busy errors immediately", async () => {
        const session = {
            state: "open",
            execute(): QueryHandle {
                const error = new Error("boom") as Error & { code: string };
                error.code = "SqlDataPlane.Unavailable";
                throw error;
            },
        } as unknown as ISqlSession;
        const rowStore = new RowStore(fs.mkdtempSync(path.join(os.tmpdir(), "qs-busy-")));
        let failed = false;
        await new ExecutionOrchestrator(session, rowStore, RECORDING_EVENTS())
            .run("select 1", { selectionStartLine: 1, stopOnError: false, scope: "document" })
            .catch(() => (failed = true));
        expect(failed).to.equal(true);
        rowStore.dispose();
    });

    test("F5 during a run cancels it and starts the queued run; held F5 keeps the LATEST", async () => {
        // Session: the FIRST execute blocks until canceled; later executes
        // complete instantly and record their text.
        const executedTexts: string[] = [];
        let firstCancel: (() => void) | undefined;
        const probeCalls: string[] = [];
        const session = {
            state: "open",
            info: {},
            execute(text: string, opts: { tag?: string }, sink: IQueryEventSink): QueryHandle {
                if (opts.tag?.includes("Probe") || opts.tag?.includes("tranProbe")) {
                    probeCalls.push(opts.tag);
                    return instantHandle(sink);
                }
                executedTexts.push(text);
                if (text.includes("one")) {
                    let resolveCompletion!: (summary: QueryCompleteSummary) => void;
                    const completion = new Promise<QueryCompleteSummary>((resolve) => {
                        resolveCompletion = resolve;
                    });
                    firstCancel = () => {
                        const summary = {
                            clientQueryId: "q1",
                            status: "canceled",
                        } as QueryCompleteSummary;
                        void sink.onComplete(summary);
                        resolveCompletion(summary);
                    };
                    return {
                        clientQueryId: "q1",
                        completion,
                        cancel: async () => {
                            firstCancel?.();
                            return { acknowledged: true };
                        },
                        dispose: async () => undefined,
                    } as unknown as QueryHandle;
                }
                return instantHandle(sink);
            },
        } as unknown as ISqlSession;

        const binding = {
            activeSession: session,
            setExecuting: () => undefined,
            notifyExecutedBatch: () => undefined,
            probeTransactionState: async () => {
                probeCalls.push("hostProbe");
            },
            metadataStatus: undefined,
        } as unknown as DocumentSessionBinding;

        const spillRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qs-restart-"));
        const host = new ExecutionHost(path.join(spillRoot, "spill"), binding, "test-uri");

        const first = host.execute("select 'one'", {
            selectionStartLine: 1,
            scope: "document",
        });
        expect(first.started).to.equal(true);
        // Let run 1 actually reach the wire before the restart lands.
        await waitFor(() => executedTexts.length === 1);

        // Held F5: two more executes while run 1 is active — the queue keeps
        // the LATEST request, and the caller gets an honest restart reason.
        const second = host.execute("select 'two'", { selectionStartLine: 1, scope: "document" });
        expect(second.started).to.equal(false);
        expect(second.reason).to.include("Restarting");
        const third = host.execute("select 'three'", { selectionStartLine: 1, scope: "document" });
        expect(third.started).to.equal(false);

        await waitFor(
            () =>
                host.executionState.kind === "succeeded" &&
                executedTexts.some((text) => text.includes("three")),
        );
        // Run 1 ran and was canceled; run "three" ran; "two" was superseded.
        expect(executedTexts.some((text) => text.includes("one"))).to.equal(true);
        expect(executedTexts.some((text) => text.includes("two"))).to.equal(false);
        // No probe fired BETWEEN the canceled run and its queued restart —
        // the probe belongs to the FINAL run's settlement only.
        expect(probeCalls.length).to.be.lessThan(2);
    });
});
