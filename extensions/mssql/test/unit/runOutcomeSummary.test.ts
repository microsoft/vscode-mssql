/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { RunbookRunSnapshot } from "../../src/sharedInterfaces/runbookStudio";
import { buildRunOutcomeSummary } from "../../src/webviews/pages/RunbookStudio/runOutcomeSummary";

function snapshot(overrides: Partial<RunbookRunSnapshot> = {}): RunbookRunSnapshot {
    return {
        runId: "run-1",
        runbookId: "book-1",
        planRevision: "1",
        planHash: "plan-hash",
        state: "succeeded",
        seq: 12,
        startedEpochMs: 1_000,
        endedEpochMs: 2_500,
        verdict: "pass",
        nodes: [
            { nodeId: "build", state: "succeeded", outcome: "success", attempt: 1 },
            {
                nodeId: "branch",
                state: "skipped",
                outcome: "skipped",
                branchNotTaken: true,
                attempt: 1,
            },
            {
                nodeId: "evidence",
                state: "succeeded",
                outcome: "success",
                attempt: 1,
                outputs: [{ handleId: "private-evidence", contract: "evidenceBundle/1" }],
            },
        ],
        diagnosticCounts: { warningCount: 2, errorCount: 0 },
        ...overrides,
    };
}

suite("runOutcomeSummary", () => {
    test("summarizes durable completion, diagnostics, and exportable evidence", () => {
        const summary = buildRunOutcomeSummary(snapshot());
        expect(summary).to.deep.equal({
            elapsedMs: 1_500,
            terminalSteps: 3,
            totalSteps: 3,
            failedSteps: 0,
            cancelledSteps: 0,
            skippedSteps: 0,
            branchNotTakenSteps: 1,
            diagnosticCounts: { warningCount: 2, errorCount: 0 },
            evidenceState: "ready",
        });
        expect(JSON.stringify(summary)).not.to.contain("private-evidence");
    });

    test("keeps active evidence pending and absent diagnostics unmeasured", () => {
        const summary = buildRunOutcomeSummary(
            snapshot({
                state: "running",
                verdict: undefined,
                endedEpochMs: undefined,
                diagnosticCounts: undefined,
                nodes: [{ nodeId: "build", state: "running", attempt: 1 }],
            }),
        );
        expect(summary.elapsedMs).to.equal(undefined);
        expect(summary.diagnosticCounts).to.equal(undefined);
        expect(summary.terminalSteps).to.equal(0);
        expect(summary.evidenceState).to.equal("pending");
    });

    test("distinguishes unusable retained evidence and terminal absence", () => {
        const truncated = buildRunOutcomeSummary(
            snapshot({
                nodes: [
                    {
                        nodeId: "evidence",
                        state: "succeeded",
                        attempt: 1,
                        outputs: [
                            {
                                handleId: "truncated",
                                contract: "evidenceBundle/1",
                                truncated: true,
                            },
                        ],
                    },
                ],
            }),
        );
        expect(truncated.evidenceState).to.equal("truncated");
        const expired = buildRunOutcomeSummary(
            snapshot({
                nodes: [
                    {
                        nodeId: "evidence",
                        state: "succeeded",
                        attempt: 1,
                        outputs: [
                            { handleId: "expired", contract: "evidenceBundle/1", expired: true },
                        ],
                    },
                ],
            }),
        );
        expect(expired.evidenceState).to.equal("expired");
        expect(buildRunOutcomeSummary(snapshot({ nodes: [] })).evidenceState).to.equal("missing");
    });
});
