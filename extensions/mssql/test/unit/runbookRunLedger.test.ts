/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Durable ledger behavior (RBS2-3): write-ahead append with seq ownership,
 * one-terminal enforcement at the journal boundary, immutable terminal
 * records, history listing, and crash recovery (including a torn trailing
 * line dropped honestly). Persistence hardening: journal self-sufficiency
 * via the accepted-event metadata, interrupted-run sealing with synthesized
 * terminals, cross-window pid guards, and retention selection.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RunbookRunLedger, selectExpiredRuns } from "../../src/runbookStudio/runbookRunLedger";
import { LedgerInvariantError } from "../../src/runbookStudio/runbookRunModel";

suite("runbookRunLedger", () => {
    let root: string;
    let ledger: RunbookRunLedger;

    setup(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rbs-ledger-"));
        ledger = new RunbookRunLedger(root);
    });

    teardown(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    function accept(runId: string) {
        return ledger.acceptRun({
            runId,
            runbookId: "rb-1",
            planRevision: "1",
            planHash: "sha256:x",
            nodeIds: ["a", "b"],
            epochMs: 1000,
        });
    }

    test("accept + append assigns monotonic seq and persists write-ahead", () => {
        const accepted = accept("run_a");
        expect(accepted.seq).to.equal(1);
        const running = ledger.append("run_a", {
            type: "run.state",
            epochMs: 1001,
            runState: "running",
        });
        expect(running.seq).to.equal(2);
        const lines = fs
            .readFileSync(path.join(root, "ledger", "run_a.jsonl"), "utf8")
            .split("\n")
            .filter(Boolean);
        expect(lines).to.have.length(2);
        expect(JSON.parse(lines[0]).type).to.equal("run.accepted");
    });

    test("terminal seals the run into an immutable record and closes the ledger", () => {
        accept("run_b");
        ledger.append("run_b", { type: "run.state", epochMs: 1001, runState: "running" });
        const terminal = ledger.append("run_b", {
            type: "run.terminal",
            epochMs: 1002,
            runState: "succeeded",
            outcome: "pass",
        });
        expect(terminal.state).to.equal("succeeded");
        expect(ledger.isOpen("run_b")).to.equal(false);
        const record = JSON.parse(
            fs.readFileSync(path.join(root, "runs", "run_b.record.json"), "utf8"),
        );
        expect(record.state).to.equal("succeeded");
        expect(record.verdict).to.equal("pass");
        // Post-terminal appends are refused at the journal boundary.
        expect(() =>
            ledger.append("run_b", { type: "run.state", epochMs: 1003, runState: "running" }),
        ).to.throw(LedgerInvariantError);
    });

    test("an invariant-violating event never reaches the journal", () => {
        accept("run_c");
        expect(() =>
            ledger.append("run_c", {
                type: "node.state",
                epochMs: 1001,
                nodeId: "unknown-node",
                nodeState: "running",
                attempt: 1,
            }),
        ).to.throw(LedgerInvariantError);
        const lines = fs
            .readFileSync(path.join(root, "ledger", "run_c.jsonl"), "utf8")
            .split("\n")
            .filter(Boolean);
        expect(lines).to.have.length(1); // only run.accepted
    });

    test("listRuns returns sealed and open runs for the runbook, newest first", () => {
        accept("run_old");
        ledger.append("run_old", {
            type: "run.terminal",
            epochMs: 1001,
            runState: "failed",
            outcome: "fail",
        });
        accept("run_new");
        const entries = ledger.listRuns("rb-1");
        expect(entries.map((e) => e.runId)).to.deep.equal(["run_new", "run_old"]);
        expect(entries[1].verdict).to.equal("fail");
        expect(ledger.listRuns("other-rb")).to.deep.equal([]);
    });

    test("recovery folds the journal and drops a torn trailing line honestly", () => {
        accept("run_d");
        ledger.append("run_d", { type: "run.state", epochMs: 1001, runState: "running" });
        ledger.append("run_d", {
            type: "node.state",
            epochMs: 1002,
            nodeId: "a",
            nodeState: "running",
            attempt: 1,
        });
        // Simulate a crash mid-write: torn JSON tail.
        const file = path.join(root, "ledger", "run_d.jsonl");
        fs.appendFileSync(file, '{"schemaVersion":1,"runId":"run_d","seq":4,"ty');
        const fresh = new RunbookRunLedger(root);
        const recovered = fresh.recoverRun("run_d");
        expect(recovered.droppedTrailingLine).to.equal(true);
        expect(recovered.snapshot?.seq).to.equal(3);
        expect(recovered.snapshot?.state).to.equal("running");
        expect(recovered.snapshot?.nodes.find((n) => n.nodeId === "a")?.state).to.equal("running");
    });

    test("recovery of a sealed run returns the immutable record", () => {
        accept("run_e");
        ledger.append("run_e", {
            type: "run.terminal",
            epochMs: 1001,
            runState: "cancelled",
        });
        const fresh = new RunbookRunLedger(root);
        const recovered = fresh.recoverRun("run_e");
        expect(recovered.snapshot?.state).to.equal("cancelled");
        expect(recovered.droppedTrailingLine).to.equal(false);
    });

    test("the journal is self-sufficient: recovery restores the plan identity", () => {
        accept("run_f");
        ledger.append("run_f", { type: "run.state", epochMs: 1001, runState: "running" });
        // Only node "b" ever sees an event — the accepted metadata must
        // still restore BOTH plan nodes in plan order.
        ledger.append("run_f", {
            type: "node.state",
            epochMs: 1002,
            nodeId: "b",
            nodeState: "running",
            attempt: 1,
        });
        const fresh = new RunbookRunLedger(root);
        const recovered = fresh.recoverRun("run_f");
        expect(recovered.snapshot?.runbookId).to.equal("rb-1");
        expect(recovered.snapshot?.planRevision).to.equal("1");
        expect(recovered.snapshot?.planHash).to.equal("sha256:x");
        expect(recovered.snapshot?.nodes.map((n) => n.nodeId)).to.deep.equal(["a", "b"]);
    });

    test("sealInterruptedRun synthesizes an honest terminal and seals the record", () => {
        accept("run_g");
        ledger.append("run_g", { type: "run.state", epochMs: 2000, runState: "running" });
        ledger.append("run_g", {
            type: "node.state",
            epochMs: 2500,
            nodeId: "a",
            nodeState: "running",
            attempt: 1,
        });
        // A fresh instance = the next window; the recorded pid is ours, so
        // no liveness refusal applies (same-process restart semantics).
        const fresh = new RunbookRunLedger(root);
        const sealed = fresh.sealInterruptedRun("run_g", "interrupted by window close");
        expect(sealed?.state).to.equal("failed");
        expect(sealed?.error?.code).to.equal("RunbookStudio.Interrupted");
        // Honest interruption time: the LAST observed event, not "now" —
        // a stale run must not flash terminal UI on the next open.
        expect(sealed?.endedEpochMs).to.equal(2500);
        const lines = fs
            .readFileSync(path.join(root, "ledger", "run_g.jsonl"), "utf8")
            .split("\n")
            .filter(Boolean);
        const last = JSON.parse(lines[lines.length - 1]);
        expect(last.type).to.equal("run.terminal");
        expect(last.synthesized).to.equal(true);
        // Sealed record is now listed run history for the runbook.
        const entries = fresh.listRuns("rb-1");
        expect(entries.find((e) => e.runId === "run_g")?.state).to.equal("failed");
        // Idempotent: a second seal returns the existing record unchanged.
        const again = fresh.sealInterruptedRun("run_g", "unused");
        expect(again?.endedEpochMs).to.equal(2500);
    });

    test("sealInterruptedRun removes a torn tail so later recovery stays valid", () => {
        accept("run_h");
        ledger.append("run_h", { type: "run.state", epochMs: 3000, runState: "running" });
        const file = path.join(root, "ledger", "run_h.jsonl");
        fs.appendFileSync(file, '{"schemaVersion":1,"runId":"run_h","seq":3,"ty');
        const fresh = new RunbookRunLedger(root);
        const sealed = fresh.sealInterruptedRun("run_h", "interrupted");
        expect(sealed?.state).to.equal("failed");
        // The journal must be fully parseable afterwards — the synthetic
        // terminal may never live behind a corrupt line.
        const later = new RunbookRunLedger(root);
        const recovered = later.recoverRun("run_h");
        expect(recovered.snapshot?.state).to.equal("failed");
        expect(recovered.droppedTrailingLine).to.equal(false);
    });

    test("sealInterruptedRun refuses a run plausibly live in another window", () => {
        const line = JSON.stringify({
            schemaVersion: 1,
            runId: "run_other",
            seq: 1,
            type: "run.accepted",
            epochMs: 4000,
            accepted: {
                runbookId: "rb-1",
                planRevision: "1",
                planHash: "sha256:x",
                nodeIds: ["a"],
                pid: process.pid + 12345,
            },
        });
        fs.writeFileSync(path.join(root, "ledger", "run_other.jsonl"), line + "\n");
        const otherAlive = new RunbookRunLedger(root, { isPidAlive: () => true });
        expect(otherAlive.sealInterruptedRun("run_other", "interrupted")).to.equal(undefined);
        // Same journal, owner process dead: seals honestly.
        const otherDead = new RunbookRunLedger(root, { isPidAlive: () => false });
        expect(otherDead.sealInterruptedRun("run_other", "interrupted")?.state).to.equal("failed");
    });

    test("sealInterruptedRun refuses runs open in this process", () => {
        accept("run_live");
        expect(ledger.sealInterruptedRun("run_live", "interrupted")).to.equal(undefined);
        expect(ledger.isOpen("run_live")).to.equal(true);
    });

    test("listAllRuns attributes sealed records and journal-only runs", () => {
        accept("run_sealed");
        ledger.append("run_sealed", {
            type: "run.terminal",
            epochMs: 1001,
            runState: "succeeded",
            outcome: "pass",
        });
        accept("run_journal");
        const fresh = new RunbookRunLedger(root);
        const all = fresh.listAllRuns();
        const sealed = all.find((r) => r.runId === "run_sealed");
        const journal = all.find((r) => r.runId === "run_journal");
        expect(sealed?.sealed).to.equal(true);
        expect(sealed?.runbookId).to.equal("rb-1");
        expect(journal?.sealed).to.equal(false);
        expect(journal?.runbookId).to.equal("rb-1");
        expect(journal?.ownerPid).to.equal(process.pid);
    });

    test("deleteRun removes journal and record but never an open run", () => {
        accept("run_del");
        ledger.append("run_del", {
            type: "run.terminal",
            epochMs: 1001,
            runState: "succeeded",
        });
        accept("run_open");
        expect(ledger.deleteRun("run_open")).to.equal(false);
        expect(ledger.deleteRun("run_del")).to.equal(true);
        expect(fs.existsSync(path.join(root, "ledger", "run_del.jsonl"))).to.equal(false);
        expect(fs.existsSync(path.join(root, "runs", "run_del.record.json"))).to.equal(false);
        expect(ledger.snapshotOf("run_del")).to.equal(undefined);
    });

    test("selectExpiredRuns keeps the newest N per runbook deterministically", () => {
        const runs = [
            { runId: "r1", runbookId: "rb-a", startedEpochMs: 100 },
            { runId: "r2", runbookId: "rb-a", startedEpochMs: 300 },
            { runId: "r3", runbookId: "rb-a", startedEpochMs: 200 },
            { runId: "r4", runbookId: "rb-b", startedEpochMs: 50 },
            // Tie on start time: runId breaks it deterministically.
            { runId: "r5", runbookId: "rb-a", startedEpochMs: 300 },
        ];
        const expired = selectExpiredRuns(runs, 2);
        // rb-a newest two are r5/r2 (300 tie -> r5 first), so r3+r1 expire;
        // rb-b has one run and keeps it.
        expect(expired.sort()).to.deep.equal(["r1", "r3"]);
        expect(selectExpiredRuns(runs, 0).sort()).to.deep.equal(["r1", "r2", "r3", "r4", "r5"]);
    });
});
