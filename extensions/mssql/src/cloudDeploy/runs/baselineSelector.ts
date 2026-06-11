/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — baseline selector (Scope 2, decisions D-B / M8).
 *
 * After a run finishes, the auto-diff feature compares it against a baseline:
 * the most recent EARLIER run of the same environment whose schema hash DIFFERS
 * from the just-finished run. That is the local analog of CI's "diff against
 * main" — same diffing engine, the only difference is how the baseline is
 * selected. When the schema is unchanged since the last run (same hash) or there
 * is no earlier different-schema run (first run, or every prior run shares the
 * hash), there is no baseline and no diff is surfaced.
 *
 * Pure and store-agnostic: it operates over a minimal `BaselineCandidate` shape
 * so it is trivially unit-testable. The caller (controller) projects its run
 * history into candidates and acts on the selected runId.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Minimal projection of a run needed to pick a baseline: its id, when it
 * started, and the schema hash it validated (absent for runs that predate
 * source-version stamping).
 */
export interface BaselineCandidate {
    readonly runId: string;
    readonly startedAtMs: number;
    readonly sourceVersionHash: string | undefined;
}

// =============================================================================
// Selector
// =============================================================================

/**
 * Picks the baseline run for `current`: the most recent EARLIER candidate whose
 * `sourceVersionHash` is present and DIFFERS from `current.sourceVersionHash`.
 *
 * Returns `undefined` when no diff should be surfaced:
 *   * `current` has no hash (can't compare), or
 *   * no earlier candidate has a different hash (first run, or the schema is
 *     unchanged since every earlier run).
 *
 * "Earlier" is by `startedAtMs` (ties broken so a strictly-earlier run wins);
 * the current run itself is excluded by id.
 */
export function selectBaselineRun(
    current: BaselineCandidate,
    history: readonly BaselineCandidate[],
): BaselineCandidate | undefined {
    if (current.sourceVersionHash === undefined) {
        return undefined;
    }

    const earlierFirst = history
        .filter(
            (candidate) =>
                candidate.runId !== current.runId && candidate.startedAtMs <= current.startedAtMs,
        )
        .sort((a, b) => b.startedAtMs - a.startedAtMs);

    for (const candidate of earlierFirst) {
        if (
            candidate.sourceVersionHash !== undefined &&
            candidate.sourceVersionHash !== current.sourceVersionHash
        ) {
            return candidate;
        }
    }
    return undefined;
}
