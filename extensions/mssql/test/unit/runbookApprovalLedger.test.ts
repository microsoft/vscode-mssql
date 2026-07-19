/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    buildRunbookApprovalChallenge,
    RunbookApprovalChallenge,
    RunbookApprovalLedger,
    RunbookApprovalLedgerError,
} from "../../src/runbookStudio/runbookApprovalLedger";
import { createDeveloperValidationPreviewArtifact } from "../../src/runbookStudio/developerValidationPreview";

suite("runbookApprovalLedger", () => {
    let root: string;
    let ledger: RunbookApprovalLedger;

    setup(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rbs-approvals-"));
        ledger = new RunbookApprovalLedger(root);
    });

    teardown(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    function challenge(overrides: Partial<RunbookApprovalChallenge> = {}) {
        return {
            approvalId: "approval-1",
            runId: "run-1",
            gateNodeId: "approve",
            activityNodeId: "provision",
            activityKind: "sandbox.provision",
            activityVersion: 1,
            attempt: 1,
            planRevision: "1",
            planHash: "sha256:plan",
            resolvedArgumentDigest: "sha256:args",
            targetFingerprint: "sha256:target",
            effectSummaryDigest: "sha256:effect",
            policyVersion: "runbook-policy/1",
            ...overrides,
        } satisfies RunbookApprovalChallenge;
    }

    test("request and approved decision survive restart with digest evidence", () => {
        const requested = ledger.requestApproval(challenge(), 1000);
        expect(requested.decision).to.equal(undefined);
        const decided = ledger.decide("approval-1", "approved", 1001);
        expect(decided.decision?.actorKind).to.equal("interactiveVscodeUser");

        const fresh = new RunbookApprovalLedger(root);
        expect(fresh.listPending()).to.deep.equal([]);
        expect(fresh.approvedEvidence("approval-1", requested.challengeDigest)).to.deep.equal({
            approvalId: "approval-1",
            approvalDigest: decided.decisionDigest,
        });
    });

    test("rejection never produces approved evidence", () => {
        ledger.requestApproval(challenge(), 1000);
        ledger.decide("approval-1", "rejected", 1001);
        expect(ledger.approvedEvidence("approval-1")).to.equal(undefined);
    });

    test("the same request and decision are idempotent but drift is refused", () => {
        const requested = ledger.requestApproval(challenge(), 1000);
        expect(ledger.requestApproval(challenge(), 2000).requestedEpochMs).to.equal(1000);
        const decided = ledger.decide("approval-1", "approved", 1001);
        expect(ledger.decide("approval-1", "approved", 2000).decisionDigest).to.equal(
            decided.decisionDigest,
        );
        expect(() => ledger.requestApproval(challenge({ planHash: "sha256:changed" }))).to.throw(
            RunbookApprovalLedgerError,
            "another challenge",
        );
        expect(() => ledger.decide("approval-1", "rejected", 1002)).to.throw(
            RunbookApprovalLedgerError,
            "different decision",
        );
        expect(ledger.approvedEvidence("approval-1", "sha256:stale")).to.equal(undefined);
        expect(requested.challengeDigest).to.match(/^sha256:[a-f0-9]{64}$/);
    });

    test("pending approvals and run-scoped retention are durable", () => {
        ledger.requestApproval(challenge(), 1000);
        ledger.requestApproval(challenge({ approvalId: "approval-2", runId: "run-2" }), 1001);
        expect(ledger.listPending()).to.have.length(2);
        expect(ledger.deleteApprovalsForRun("run-1")).to.equal(1);
        expect(ledger.read("approval-1")).to.equal(undefined);
        expect(ledger.read("approval-2")?.challenge.runId).to.equal("run-2");
    });

    test("developer fixture gate binds approval to the exact provision effect", () => {
        const artifact = createDeveloperValidationPreviewArtifact();
        const profileCanary = "saved-profile-secret-canary";
        const built = buildRunbookApprovalChallenge({
            runId: "run-fixture",
            artifact,
            parameterValues: {
                projectPath: "Database.sqlproj",
                sandboxName: profileCanary,
            },
            gateNodeId: "approve-sandbox",
        });

        expect(built).to.include({
            activityNodeId: "provision-sandbox",
            activityKind: "sandbox.provision",
            activityVersion: 1,
            planHash: artifact.lock?.planHash,
        });
        expect(built?.resolvedArgumentDigest).to.match(/^sha256:[a-f0-9]{64}$/);
        expect(built?.targetFingerprint).to.match(/^sha256:[a-f0-9]{64}$/);
        expect(JSON.stringify(built)).to.not.include(profileCanary);
    });

    test("binding and plan drift change the challenge identity", () => {
        const artifact = createDeveloperValidationPreviewArtifact();
        const first = buildRunbookApprovalChallenge({
            runId: "run-fixture",
            artifact,
            parameterValues: { sandboxName: "profile-a", projectPath: "A.sqlproj" },
            gateNodeId: "approve-sandbox",
        })!;
        const rebound = buildRunbookApprovalChallenge({
            runId: "run-fixture",
            artifact,
            parameterValues: { sandboxName: "profile-b", projectPath: "A.sqlproj" },
            gateNodeId: "approve-sandbox",
        })!;
        const revisedArtifact = structuredClone(artifact);
        revisedArtifact.lock!.planHash = "sha256:changed";
        const revised = buildRunbookApprovalChallenge({
            runId: "run-fixture",
            artifact: revisedArtifact,
            parameterValues: { sandboxName: "profile-a", projectPath: "A.sqlproj" },
            gateNodeId: "approve-sandbox",
        })!;

        expect(rebound.resolvedArgumentDigest).to.not.equal(first.resolvedArgumentDigest);
        expect(rebound.targetFingerprint).to.not.equal(first.targetFingerprint);
        expect(revised.planHash).to.not.equal(first.planHash);
    });
});
