/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure run-model invariants (RBS2-3): monotonic sequence, one terminal,
 * nothing after terminal, unknown nodes rejected, gate flow, duration fold.
 */

import { expect } from "chai";
import {
    applyRunEvent,
    createInitialSnapshot,
    foldRunEvents,
    LedgerInvariantError,
} from "../../src/runbookStudio/runbookRunModel";
import {
    RunbookRunEvent,
    RunbookRunSnapshot,
    RUNBOOK_RUN_EVENT_SCHEMA_VERSION,
} from "../../src/sharedInterfaces/runbookStudio";

function initial(): RunbookRunSnapshot {
    return createInitialSnapshot({
        runId: "run_1",
        runbookId: "rb",
        planRevision: "1",
        planHash: "sha256:x",
        nodeIds: ["a", "b"],
    });
}

let seqCounter = 0;

function ev(
    partial: Partial<RunbookRunEvent> & { type: RunbookRunEvent["type"] },
): RunbookRunEvent {
    seqCounter++;
    return {
        schemaVersion: RUNBOOK_RUN_EVENT_SCHEMA_VERSION,
        runId: "run_1",
        seq: seqCounter,
        epochMs: 1000 + seqCounter,
        ...partial,
    };
}

suite("runbookRunModel", () => {
    setup(() => {
        seqCounter = 0;
    });

    test("full lifecycle folds to a terminal snapshot with verdict", () => {
        const snapshot = foldRunEvents(initial(), [
            ev({ type: "run.accepted" }),
            ev({ type: "run.state", runState: "running" }),
            ev({ type: "node.state", nodeId: "a", nodeState: "running", attempt: 1 }),
            ev({
                type: "node.state",
                nodeId: "a",
                nodeState: "succeeded",
                attempt: 1,
                outcome: "success",
            }),
            ev({ type: "node.state", nodeId: "b", nodeState: "running", attempt: 1 }),
            ev({
                type: "node.state",
                nodeId: "b",
                nodeState: "succeeded",
                attempt: 1,
                outcome: "success",
            }),
            ev({
                type: "run.terminal",
                runState: "succeeded",
                outcome: "pass",
                runMetrics: {
                    "tests.passed": 18,
                    "deployment.changed": false,
                    invalid: Number.NaN,
                },
            }),
        ]);
        expect(snapshot.state).to.equal("succeeded");
        expect(snapshot.verdict).to.equal("pass");
        expect(snapshot.runMetrics).to.deep.equal({
            "tests.passed": 18,
            "deployment.changed": false,
        });
        expect(snapshot.endedEpochMs).to.be.a("number");
        expect(snapshot.nodes.every((n) => n.state === "succeeded")).to.equal(true);
        // Duration folds from running -> terminal epochs.
        expect(snapshot.nodes[0].durationMs).to.be.a("number");
    });

    test("non-monotonic sequence throws", () => {
        let snapshot = applyRunEvent(initial(), ev({ type: "run.accepted" }));
        const skip = ev({ type: "run.state", runState: "running" });
        skip.seq = 5;
        expect(() => applyRunEvent(snapshot, skip)).to.throw(LedgerInvariantError);
    });

    test("second terminal throws duplicateTerminal", () => {
        const snapshot = foldRunEvents(initial(), [
            ev({ type: "run.accepted" }),
            ev({ type: "run.terminal", runState: "failed" }),
        ]);
        expect(() =>
            applyRunEvent(snapshot, ev({ type: "run.terminal", runState: "succeeded" })),
        ).to.throw(LedgerInvariantError, /after terminal|second terminal/);
    });

    test("events after terminal throw", () => {
        const snapshot = foldRunEvents(initial(), [
            ev({ type: "run.accepted" }),
            ev({ type: "run.terminal", runState: "cancelled" }),
        ]);
        expect(() =>
            applyRunEvent(
                snapshot,
                ev({ type: "node.state", nodeId: "a", nodeState: "running", attempt: 1 }),
            ),
        ).to.throw(LedgerInvariantError);
    });

    test("terminal state cannot ride run.state", () => {
        const snapshot = applyRunEvent(initial(), ev({ type: "run.accepted" }));
        expect(() =>
            applyRunEvent(snapshot, ev({ type: "run.state", runState: "succeeded" })),
        ).to.throw(LedgerInvariantError);
    });

    test("unknown node throws", () => {
        const snapshot = applyRunEvent(initial(), ev({ type: "run.accepted" }));
        expect(() =>
            applyRunEvent(
                snapshot,
                ev({ type: "node.state", nodeId: "nope", nodeState: "running", attempt: 1 }),
            ),
        ).to.throw(LedgerInvariantError, /unknown node/);
    });

    test("a terminal node cannot resurrect without a new attempt", () => {
        const snapshot = foldRunEvents(initial(), [
            ev({ type: "run.accepted" }),
            ev({ type: "node.state", nodeId: "a", nodeState: "running", attempt: 1 }),
            ev({
                type: "node.state",
                nodeId: "a",
                nodeState: "failed",
                attempt: 1,
                outcome: "failure",
            }),
        ]);
        // Both candidate events target the SAME next sequence slot — the
        // first is rejected by the fold, so seq 4 remains the expected next.
        const resurrect = ev({ type: "node.state", nodeId: "a", nodeState: "running", attempt: 1 });
        expect(() => applyRunEvent(snapshot, resurrect)).to.throw(
            LedgerInvariantError,
            /terminal state/,
        );
        const retry = { ...resurrect, attempt: 2 };
        // A NEW attempt may run the node again (retry semantics).
        const retried = applyRunEvent(snapshot, retry);
        expect(retried.nodes[0].attempt).to.equal(2);
    });

    test("gate flow: requested pauses, responded resumes", () => {
        let snapshot = foldRunEvents(initial(), [
            ev({ type: "run.accepted" }),
            ev({ type: "run.state", runState: "running" }),
            ev({
                type: "gate.requested",
                gate: { nodeId: "b", gateKind: "approval", impactSummary: "writes files" },
            }),
        ]);
        expect(snapshot.state).to.equal("awaitingApproval");
        expect(snapshot.pendingGate?.nodeId).to.equal("b");
        snapshot = applyRunEvent(
            snapshot,
            ev({ type: "gate.responded", nodeId: "b", outcome: "approved" }),
        );
        expect(snapshot.state).to.equal("running");
        expect(snapshot.pendingGate).to.equal(undefined);
    });

    test("outputs accumulate across node.state events", () => {
        const snapshot = foldRunEvents(initial(), [
            ev({ type: "run.accepted" }),
            ev({ type: "node.state", nodeId: "a", nodeState: "running", attempt: 1 }),
            ev({
                type: "node.state",
                nodeId: "a",
                nodeState: "succeeded",
                attempt: 1,
                outputs: [{ handleId: "h1", contract: "rowset/1", rows: 5 }],
            }),
        ]);
        expect(snapshot.nodes[0].outputs).to.have.length(1);
        expect(snapshot.nodes[0].outputs![0].handleId).to.equal("h1");
    });

    test("branch-not-taken state folds as structured durable evidence", () => {
        const snapshot = foldRunEvents(initial(), [
            ev({ type: "run.accepted" }),
            ev({
                type: "node.state",
                nodeId: "b",
                nodeState: "skipped",
                attempt: 0,
                outcome: "skipped",
                branchNotTaken: true,
                message: "localized display text",
            }),
        ]);
        expect(snapshot.nodes[1]).to.deep.include({
            state: "skipped",
            outcome: "skipped",
            branchNotTaken: true,
            message: "localized display text",
        });
    });
});
