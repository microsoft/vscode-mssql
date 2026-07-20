/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { RunbookRunSnapshot } from "../../src/sharedInterfaces/runbookStudio";
import { compareRunSnapshots } from "../../src/webviews/pages/RunbookStudio/runComparison";

function snapshot(overrides: Partial<RunbookRunSnapshot> = {}): RunbookRunSnapshot {
    return {
        runId: "run-1",
        runbookId: "book-1",
        planRevision: "4",
        planHash: "plan-hash",
        state: "succeeded",
        seq: 10,
        startedEpochMs: 1_000,
        endedEpochMs: 2_000,
        verdict: "pass",
        nodes: [
            {
                nodeId: "build",
                state: "succeeded",
                outcome: "success",
                attempt: 1,
                durationMs: 400,
                outputs: [{ handleId: "build-output", contract: "rowset/1", rows: 2 }],
            },
        ],
        runMetrics: { "build.warningCount": 0, provider: "local" },
        diagnosticCounts: { warningCount: 0, errorCount: 0 },
        ...overrides,
    };
}

suite("runComparison", () => {
    test("compares only durable run, node, diagnostic, and metric facts", () => {
        const baseline = snapshot();
        const current = snapshot({
            runId: "run-2",
            endedEpochMs: 2_500,
            nodes: [
                {
                    nodeId: "build",
                    state: "failed",
                    outcome: "failure",
                    attempt: 1,
                    durationMs: 900,
                    outputs: [{ handleId: "private-handle", contract: "rowset/1", rows: 3 }],
                },
                { nodeId: "cleanup", state: "succeeded", outcome: "success", attempt: 1 },
            ],
            runMetrics: { "build.warningCount": 2, provider: "local", tests: 12 },
            diagnosticCounts: { warningCount: 2, errorCount: 1 },
        });
        const compared = compareRunSnapshots(baseline, current);
        expect(compared.samePlan).to.equal(true);
        expect(compared.elapsedMs).to.deep.equal({
            baseline: 1_000,
            current: 1_500,
            delta: 500,
            changed: true,
        });
        expect(compared.warningCount?.delta).to.equal(2);
        expect(compared.errorCount?.delta).to.equal(1);
        expect(compared.nodes).to.deep.include({
            nodeId: "build",
            baselineState: "succeeded",
            currentState: "failed",
            baselineOutcome: "success",
            currentOutcome: "failure",
            durationMs: { baseline: 400, current: 900, delta: 500, changed: true },
            rows: { baseline: 2, current: 3, delta: 1, changed: true },
            changed: true,
        });
        expect(compared.metrics.find((metric) => metric.key === "tests")).to.deep.equal({
            key: "tests",
            current: 12,
            changed: true,
        });
        expect(JSON.stringify(compared)).not.to.contain("private-handle");
    });

    test("marks plan drift and keeps unmeasured diagnostics absent", () => {
        const baseline = snapshot({ diagnosticCounts: undefined });
        const current = snapshot({ planRevision: "5", planHash: "new-plan" });
        const compared = compareRunSnapshots(baseline, current);
        expect(compared.samePlan).to.equal(false);
        expect(compared.warningCount).to.equal(undefined);
        expect(compared.errorCount).to.equal(undefined);
    });
});
