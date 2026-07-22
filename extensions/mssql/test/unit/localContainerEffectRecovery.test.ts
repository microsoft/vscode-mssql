/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { digestRunbookValue } from "../../src/runbookStudio/runbookDigest";
import {
    deriveRunbookEffectId,
    RunbookEffectIdentity,
    RunbookEffectLedger,
} from "../../src/runbookStudio/runbookEffectLedger";
import { settleVerifiedAbsentContainerEffects } from "../../src/runbookStudio/runtime/localContainerEffectRecovery";

suite("Runbook Studio owned-container effect recovery", () => {
    let root: string;
    let ledger: RunbookEffectLedger;
    const runId = "run-container-recovery";
    const connectionProfileId = `runbook-container-profile:${"a".repeat(64)}`;
    const ownershipMarkerDigest = digestRunbookValue(`effect-${"a".repeat(64)}`);

    setup(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rbs-container-effects-"));
        ledger = new RunbookEffectLedger(root);
    });

    teardown(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    function prepare(
        activityKind: string,
        resourceKind: string,
        overrides: Partial<RunbookEffectIdentity> = {},
    ): RunbookEffectIdentity {
        const base = {
            runId,
            nodeId: `node-${activityKind.replaceAll(".", "-")}`,
            attempt: 1,
            activityKind,
            activityVersion: 1,
        };
        const identity: RunbookEffectIdentity = {
            ...base,
            effectId: deriveRunbookEffectId(base),
            idempotencyKey: `sha256:${activityKind}`,
            planHash: "sha256:plan",
            bindingDigest: "sha256:binding",
            targetFingerprint: "sha256:target",
            retrySemantics: "atMostOnceUnknownOutcome",
            ownerPid: process.pid,
            policy: { version: "runbook-policy/1", outcome: "allowed" },
            recovery: {
                resourceKind,
                resourceId: "MyApp_Dev",
                connectionProfileId,
                ownershipMarkerDigest,
            },
            ...overrides,
        };
        ledger.prepareEffect(identity);
        return identity;
    }

    test("compensates closed unknown effects only after exact container absence proof", () => {
        const deployment = prepare("dacpac.deploy.container", "dacpacDeployment");
        const workload = prepare("sql.workload.run", "workloadExecution");
        const xevent = prepare("xevent.session.start", "xeventSession");
        const migration = prepare("migration.apply", "migrationExecution");
        ledger.recordEffectObserved(workload.effectId, {
            resourceKind: "workloadExecution",
            resourceId: "MyApp_Dev",
            connectionProfileId,
            ownershipMarkerDigest,
        });
        ledger.recordEffectObserved(migration.effectId, {
            resourceKind: "migrationExecution",
            resourceId: "MyApp_Dev",
            connectionProfileId,
            ownershipMarkerDigest,
        });

        const otherRun = prepare("migration.apply", "migrationExecution", {
            runId: "run-other",
            nodeId: "node-other-run",
            effectId: `effect-${"b".repeat(64)}`,
        });
        const protectedPromotion = prepare("release.promote", "migrationExecution", {
            nodeId: "node-protected-promotion",
            effectId: `effect-${"c".repeat(64)}`,
        });
        const wrongOwner = prepare("migration.apply", "migrationExecution", {
            nodeId: "node-wrong-owner",
            effectId: `effect-${"d".repeat(64)}`,
            recovery: {
                resourceKind: "migrationExecution",
                resourceId: "MyApp_Dev",
                connectionProfileId,
                ownershipMarkerDigest: "sha256:other-owner",
            },
        });

        expect(
            settleVerifiedAbsentContainerEffects({
                ledger,
                runId,
                connectionProfileId,
                ownershipMarkerDigest,
                containerCleanupEvidenceDigest: "sha256:container-absent",
                containerAbsent: true,
            }),
        ).to.equal(4);

        for (const effect of [deployment, workload, xevent, migration]) {
            expect(ledger.recoverEffect(effect.effectId)?.snapshot.state).to.equal("cleaned");
        }
        expect(ledger.recoverEffect(deployment.effectId)?.snapshot.resource?.resourceKind).to.equal(
            "dacpacDeploymentOutcomeUnknown",
        );
        expect(ledger.recoverEffect(migration.effectId)?.snapshot.cleanupEvidenceDigest).to.be.a(
            "string",
        ).and.not.empty;
        for (const effect of [otherRun, protectedPromotion, wrongOwner]) {
            expect(ledger.recoverEffect(effect.effectId)?.snapshot.state).to.equal("prepared");
        }
    });
});
