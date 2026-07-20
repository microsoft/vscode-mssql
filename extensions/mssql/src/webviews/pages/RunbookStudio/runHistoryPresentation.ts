/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunbookRunHistoryEntry } from "../../../sharedInterfaces/runbookStudio";

export type RunHistoryTone = "pass" | "fail" | "indeterminate" | "active";
export type RunHistoryPlanRelation = "current" | "different" | "unknown";

export interface RunHistoryPresentation {
    outcome: RunbookRunHistoryEntry["verdict"] | RunbookRunHistoryEntry["state"];
    tone: RunHistoryTone;
    planRelation: RunHistoryPlanRelation;
    selected: boolean;
}

export function presentRunHistoryEntry(
    entry: RunbookRunHistoryEntry,
    currentPlanRevision: string | undefined,
    selectedRunId: string | undefined,
): RunHistoryPresentation {
    const tone: RunHistoryTone = entry.verdict
        ? entry.verdict
        : entry.state === "succeeded"
          ? "pass"
          : entry.state === "failed"
            ? "fail"
            : entry.state === "cancelled"
              ? "indeterminate"
              : "active";
    return {
        outcome: entry.verdict ?? entry.state,
        tone,
        planRelation:
            currentPlanRevision === undefined
                ? "unknown"
                : entry.planRevision === currentPlanRevision
                  ? "current"
                  : "different",
        selected: entry.runId === selectedRunId,
    };
}
