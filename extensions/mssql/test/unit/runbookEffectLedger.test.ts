/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    deriveRunbookEffectId,
    RunbookEffectIdentity,
    RunbookEffectLedger,
    RunbookEffectLedgerError,
} from "../../src/runbookStudio/runbookEffectLedger";

suite("runbookEffectLedger", () => {
    let root: string;
    let ledger: RunbookEffectLedger;

    setup(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rbs-effects-"));
        ledger = new RunbookEffectLedger(root);
    });

    teardown(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    function identity(overrides: Partial<RunbookEffectIdentity> = {}): RunbookEffectIdentity {
        const base = {
            runId: "run-1",
            nodeId: "provision-sandbox",
            attempt: 1,
            activityKind: "sandbox.provision",
            activityVersion: 1,
        };
        return {
            effectId: deriveRunbookEffectId(base),
            ...base,
            idempotencyKey: "sha256:idempotency",
            planHash: "sha256:plan",
            bindingDigest: "sha256:binding",
            targetFingerprint: "sha256:target",
            retrySemantics: "operatorDecisionRequired",
            ownerPid: process.pid,
            policy: { version: "runbook-policy/1", outcome: "allowed" },
            approval: {
                approvalId: "approval-1",
                approvalDigest: "sha256:approval",
            },
            ...overrides,
        };
    }

    const resource = {
        resourceKind: "sqlDatabase",
        resourceId: "RunbookStudio_abcd",
        ownershipMarkerDigest: "sha256:owner",
        outputHandles: ["lease:opaque"],
    };

    test("prepared intent survives a crash before the external effect", () => {
        const prepared = ledger.prepareEffect(identity(), 1000);
        expect(prepared.state).to.equal("prepared");

        const fresh = new RunbookEffectLedger(root);
        const scan = fresh.scanRecovery();
        expect(scan.unreadableFiles).to.deep.equal([]);
        expect(scan.outstanding).to.have.length(1);
        expect(scan.outstanding[0].snapshot.state).to.equal("prepared");
        expect(scan.outstanding[0].snapshot.identity.planHash).to.equal("sha256:plan");
    });

    test("observed effect survives the result-recording crash window", () => {
        const effect = identity();
        ledger.prepareEffect(effect, 1000);
        ledger.recordEffectObserved(effect.effectId, resource, 1001);

        const recovered = new RunbookEffectLedger(root).recoverEffect(effect.effectId);
        expect(recovered?.snapshot.state).to.equal("effectObserved");
        expect(recovered?.snapshot.resource).to.deep.equal(resource);
        expect(recovered?.snapshot.seq).to.equal(2);
    });

    test("cleanup is write-ahead and restart recovery retains the resource proof", () => {
        const effect = identity();
        ledger.prepareEffect(effect, 1000);
        ledger.recordEffectObserved(effect.effectId, resource, 1001);
        ledger.startCleanup(effect.effectId, 1002);

        const fresh = new RunbookEffectLedger(root);
        expect(fresh.scanRecovery().outstanding[0].snapshot.state).to.equal("cleanupStarted");
        const cleaned = fresh.completeCleanup(effect.effectId, "sha256:cleanup", 1003);
        expect(cleaned.state).to.equal("cleaned");
        expect(cleaned.cleanupEvidenceDigest).to.equal("sha256:cleanup");
        expect(fresh.scanRecovery().outstanding).to.deep.equal([]);
    });

    test("known no-effect failure is terminal and never enters recovery", () => {
        const effect = identity();
        ledger.prepareEffect(effect, 1000);
        const failed = ledger.recordNoEffectFailure(effect.effectId, "DatabaseCreateRefused", 1001);
        expect(failed.state).to.equal("failedNoEffect");
        expect(ledger.scanRecovery().outstanding).to.deep.equal([]);
    });

    test("verified retained effects can be finalized without entering cleanup recovery", () => {
        const effect = identity({ activityKind: "devdatabase.provision" });
        ledger.prepareEffect(effect, 1000);
        ledger.recordEffectObserved(effect.effectId, resource, 1001);
        const finalized = ledger.finalizeEffect(effect.effectId, "sha256:retained", 1002);

        expect(finalized.state).to.equal("finalized");
        expect(finalized.finalizedEvidenceDigest).to.equal("sha256:retained");
        expect(finalized.resource).to.deep.equal(resource);
        expect(ledger.scanRecovery().outstanding).to.deep.equal([]);
    });

    test("unknown outcome requires an explicit operator decision", () => {
        const effect = identity();
        ledger.prepareEffect(effect, 1000);
        const recovery = ledger.requireOperatorDecision(
            effect.effectId,
            "EffectOutcomeUnknown",
            1001,
        );
        expect(recovery.state).to.equal("needsOperatorDecision");
        expect(recovery.recoveryReasonCode).to.equal("EffectOutcomeUnknown");
        expect(ledger.scanRecovery().outstanding).to.have.length(1);
    });

    test("prepare is idempotent only for the exact same identity", () => {
        const effect = identity();
        ledger.prepareEffect(effect, 1000);
        expect(ledger.prepareEffect(effect, 2000).preparedEpochMs).to.equal(1000);
        expect(() =>
            ledger.prepareEffect({ ...effect, targetFingerprint: "sha256:other" }, 2000),
        ).to.throw(RunbookEffectLedgerError, "another identity");
    });

    test("illegal retry after a terminal transition never reaches disk", () => {
        const effect = identity();
        ledger.prepareEffect(effect, 1000);
        ledger.recordNoEffectFailure(effect.effectId, "Refused", 1001);
        expect(() => ledger.recordEffectObserved(effect.effectId, resource, 1002)).to.throw(
            RunbookEffectLedgerError,
            "cannot apply",
        );
        expect(ledger.recoverEffect(effect.effectId)?.snapshot.seq).to.equal(2);
    });

    test("torn trailing writes are reported and repaired before the next transition", () => {
        const effect = identity();
        ledger.prepareEffect(effect, 1000);
        const journal = path.join(root, "effects", fs.readdirSync(path.join(root, "effects"))[0]);
        fs.appendFileSync(journal, '{"schemaVersion":1,"effectId":"torn');

        const fresh = new RunbookEffectLedger(root);
        expect(fresh.recoverEffect(effect.effectId)?.droppedTrailingLine).to.equal(true);
        fresh.recordEffectObserved(effect.effectId, resource, 1001);
        const recovered = new RunbookEffectLedger(root).recoverEffect(effect.effectId);
        expect(recovered?.droppedTrailingLine).to.equal(false);
        expect(recovered?.snapshot.state).to.equal("effectObserved");
    });

    test("non-trailing corruption is surfaced by the recovery scan", () => {
        const effect = identity();
        ledger.prepareEffect(effect, 1000);
        const effectsDir = path.join(root, "effects");
        const journal = path.join(effectsDir, fs.readdirSync(effectsDir)[0]);
        fs.appendFileSync(journal, "not-json\n{}\n");

        const scan = new RunbookEffectLedger(root).scanRecovery();
        expect(scan.outstanding).to.deep.equal([]);
        expect(scan.unreadableFiles).to.have.length(1);
        expect(scan.unreadableFiles[0].errorCode).to.equal("corruptJournal");
    });

    test("effect ids are deterministic and distinguish attempts", () => {
        const first = deriveRunbookEffectId({
            runId: "run-1",
            nodeId: "node-1",
            attempt: 1,
            activityKind: "sandbox.provision",
            activityVersion: 1,
        });
        const same = deriveRunbookEffectId({
            runId: "run-1",
            nodeId: "node-1",
            attempt: 1,
            activityKind: "sandbox.provision",
            activityVersion: 1,
        });
        const retry = deriveRunbookEffectId({
            runId: "run-1",
            nodeId: "node-1",
            attempt: 2,
            activityKind: "sandbox.provision",
            activityVersion: 1,
        });
        expect(first).to.equal(same);
        expect(retry).to.not.equal(first);
    });

    test("retention deletes only terminal effects for the selected run", () => {
        const terminal = identity();
        ledger.prepareEffect(terminal, 1000);
        ledger.recordNoEffectFailure(terminal.effectId, "Refused", 1001);
        const outstanding = identity({
            effectId: "effect-outstanding",
            nodeId: "other-node",
        });
        ledger.prepareEffect(outstanding, 1000);

        expect(ledger.deleteTerminalEffectsForRun("run-1")).to.equal(1);
        expect(ledger.recoverEffect(terminal.effectId)).to.equal(undefined);
        expect(ledger.recoverEffect(outstanding.effectId)?.snapshot.state).to.equal("prepared");
    });
});
