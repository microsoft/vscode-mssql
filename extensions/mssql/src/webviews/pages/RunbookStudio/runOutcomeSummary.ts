/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunbookRunSnapshot } from "../../../sharedInterfaces/runbookStudio";

export type RunEvidenceState = "ready" | "pending" | "missing" | "truncated" | "expired";

export interface RunOutcomeSummary {
    elapsedMs?: number;
    terminalSteps: number;
    totalSteps: number;
    failedSteps: number;
    cancelledSteps: number;
    skippedSteps: number;
    branchNotTakenSteps: number;
    diagnosticCounts?: { warningCount: number; errorCount: number };
    evidenceState: RunEvidenceState;
}

const TERMINAL_RUN_STATES = new Set<RunbookRunSnapshot["state"]>([
    "succeeded",
    "failed",
    "cancelled",
]);
const TERMINAL_NODE_STATES = new Set<RunbookRunSnapshot["nodes"][number]["state"]>([
    "succeeded",
    "failed",
    "skipped",
    "cancelled",
]);

function evidenceState(run: RunbookRunSnapshot): RunEvidenceState {
    const bundles = run.nodes.flatMap((node) =>
        (node.outputs ?? []).filter((output) => output.contract === "evidenceBundle/1"),
    );
    if (bundles.some((bundle) => !bundle.expired && !bundle.truncated)) {
        return "ready";
    }
    if (bundles.some((bundle) => !bundle.expired && bundle.truncated)) {
        return "truncated";
    }
    if (bundles.length > 0) {
        return "expired";
    }
    return TERMINAL_RUN_STATES.has(run.state) ? "missing" : "pending";
}

/** Project bounded durable run facts into a compact Results summary. No
 * payload is read, and missing diagnostic measurement remains missing. */
export function buildRunOutcomeSummary(run: RunbookRunSnapshot): RunOutcomeSummary {
    return {
        ...(run.startedEpochMs !== undefined && run.endedEpochMs !== undefined
            ? { elapsedMs: Math.max(0, run.endedEpochMs - run.startedEpochMs) }
            : {}),
        terminalSteps: run.nodes.filter((node) => TERMINAL_NODE_STATES.has(node.state)).length,
        totalSteps: run.nodes.length,
        failedSteps: run.nodes.filter(
            (node) =>
                node.state === "failed" ||
                node.outcome === "failure" ||
                node.outcome === "policyDenied",
        ).length,
        cancelledSteps: run.nodes.filter((node) => node.state === "cancelled").length,
        skippedSteps: run.nodes.filter((node) => node.state === "skipped" && !node.branchNotTaken)
            .length,
        branchNotTakenSteps: run.nodes.filter((node) => node.branchNotTaken).length,
        ...(run.diagnosticCounts ? { diagnosticCounts: { ...run.diagnosticCounts } } : {}),
        evidenceState: evidenceState(run),
    };
}
