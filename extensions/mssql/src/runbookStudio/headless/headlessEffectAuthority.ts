/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Same-run bridge from a digest-bound headless gate decision to an effect delegate. */

import type { RunbookArtifactFile } from "../../sharedInterfaces/runbookStudio";
import {
    buildRunbookApprovalChallenge,
    RunbookApprovalChallenge,
    RunbookApprovalEvidence,
} from "../runbookApprovalLedger";
import { digestRunbookValue } from "../runbookDigest";
import type { RuntimeOutputPayload } from "../runtime/runtimeAdapterTypes";
import type { ActivityInvocationIdentity } from "../runtime/fakeRuntimeAdapter";

export interface HeadlessEffectAuthorization {
    challenge: RunbookApprovalChallenge;
    evidence: RunbookApprovalEvidence;
}

export class HeadlessEffectAuthority {
    private readonly byActivityNode = new Map<string, HeadlessEffectAuthorization>();

    constructor(
        private readonly runId: string,
        private readonly artifact: RunbookArtifactFile,
        private readonly parameterValues: Record<string, string | number | boolean | null>,
    ) {}

    public recordApprovedGate(
        gateNodeId: string,
        policyDigest: string,
        outputs: Readonly<Record<string, RuntimeOutputPayload>>,
    ): void {
        const challenge = buildRunbookApprovalChallenge({
            runId: this.runId,
            artifact: this.artifact,
            parameterValues: this.parameterValues,
            gateNodeId,
            nodeValues: outputValues(outputs),
        });
        if (!challenge || !/^sha256:[a-f0-9]{64}$/iu.test(policyDigest)) {
            throw new Error("HeadlessActivityHost.EffectApprovalInvalid");
        }
        this.byActivityNode.set(challenge.activityNodeId, {
            challenge,
            evidence: {
                approvalId: `headless-manifest:${gateNodeId}`,
                approvalDigest: digestRunbookValue({
                    challengeDigest: digestRunbookValue(challenge),
                    policyDigest,
                }),
            },
        });
    }

    public require(
        activityNodeId: string,
        activityKind: string,
        invocation: ActivityInvocationIdentity,
    ): HeadlessEffectAuthorization {
        const authorization = this.byActivityNode.get(activityNodeId);
        if (
            !authorization ||
            authorization.challenge.runId !== invocation.runId ||
            authorization.challenge.planRevision !== invocation.planRevision ||
            authorization.challenge.planHash !== invocation.planHash ||
            authorization.challenge.attempt !== invocation.attempt ||
            authorization.challenge.activityNodeId !== activityNodeId ||
            authorization.challenge.activityKind !== activityKind
        ) {
            throw new Error("HeadlessActivityHost.EffectApprovalRequired");
        }
        return authorization;
    }
}

function outputValues(
    outputs: Readonly<Record<string, RuntimeOutputPayload>>,
): ReadonlyMap<string, Readonly<Record<string, number | string | boolean>>> {
    return new Map(
        Object.entries(outputs).map(([nodeId, output]) => [nodeId, { ...(output.scalars ?? {}) }]),
    );
}
