/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Durable ledger behavior (RBS2-3): write-ahead append with seq ownership,
 * one-terminal enforcement at the journal boundary, immutable terminal
 * records, history listing, and crash recovery (including a torn trailing
 * line dropped honestly).
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RunbookRunLedger } from "../../src/runbookStudio/runbookRunLedger";
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
});
