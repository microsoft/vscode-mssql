/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { digestRunbookValue } from "../runbookDigest";
import type { RunbookEffectLedger } from "../runbookEffectLedger";
import { classifyLocalSqlContainerDependentEffect } from "./localContainerOperations";

/**
 * Settle unknown effects only after the caller has independently verified
 * deletion and absence of the exact ownership-labelled container. This is
 * compensation evidence, not evidence that the original mutation succeeded.
 */
export function settleVerifiedAbsentContainerEffects(args: {
    ledger: RunbookEffectLedger;
    runId: string;
    connectionProfileId: string;
    ownershipMarkerDigest: string;
    containerCleanupEvidenceDigest: string;
    containerAbsent: true;
}): number {
    if (args.containerAbsent !== true) {
        return 0;
    }
    let settled = 0;
    for (const entry of args.ledger.scanRecovery().outstanding) {
        let dependent = entry.snapshot;
        const recovery = dependent.identity.recovery;
        const outcomeKind = classifyLocalSqlContainerDependentEffect(
            dependent.identity.activityKind,
            recovery?.resourceKind,
        );
        if (
            dependent.identity.runId !== args.runId ||
            !outcomeKind ||
            !recovery ||
            recovery.connectionProfileId !== args.connectionProfileId ||
            recovery.ownershipMarkerDigest !== args.ownershipMarkerDigest ||
            dependent.state === "needsOperatorDecision"
        ) {
            continue;
        }
        if (dependent.state === "prepared") {
            dependent = args.ledger.recordEffectObserved(dependent.identity.effectId, {
                resourceKind: outcomeKind,
                resourceId: recovery.resourceId,
                ownershipMarkerDigest: args.ownershipMarkerDigest,
                connectionProfileId: args.connectionProfileId,
            });
        }
        if (dependent.state === "effectObserved") {
            dependent = args.ledger.startCleanup(dependent.identity.effectId);
        }
        if (dependent.state === "cleanupStarted") {
            dependent = args.ledger.completeCleanup(
                dependent.identity.effectId,
                digestRunbookValue({
                    cleanupEvidenceDigest: args.containerCleanupEvidenceDigest,
                    dependentEffectId: dependent.identity.effectId,
                    compensatedByContainerDeletion: true,
                }),
            );
        }
        if (dependent.state === "cleaned") {
            settled++;
        }
    }
    return settled;
}
