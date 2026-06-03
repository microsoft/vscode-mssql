/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — run comparison (D3-Part-2 / TBD-5 resolution).
 *
 * Pure, side-effect-free diff between two `RunRecord`s. Given two runs — the
 * same environment at different times, or two different environments — it
 * pairs their validations by `validationId` and reports per-validation deltas
 * the hub's compare page renders side by side.
 *
 * Pure types + one pure function: no Node imports, no I/O. Safe to include in
 * the webview build and trivial to unit-test.
 */

import { RunRecord, RunStatus, ValidationResult, ValidationStatus } from "./types";
import { ValidationType } from "../environments/types";

// =============================================================================
// Types
// =============================================================================

/** Whether a validation is present in run A, run B, or both. */
export type ValidationPresence = "both" | "only-a" | "only-b";

/** Per-validation delta between the two runs being compared. */
export interface ValidationDelta {
    /** Stable id used to pair the two sides. */
    readonly validationId: string;
    /** Display name, preferring run B's label, falling back to run A's. */
    readonly displayName: string;
    /** Validation type, when known from whichever side is present. */
    readonly validationType?: ValidationType;
    readonly presence: ValidationPresence;
    readonly statusA?: ValidationStatus;
    readonly statusB?: ValidationStatus;
    /** True when both sides are present and their statuses differ. */
    readonly statusChanged: boolean;
    readonly findingCountA: number;
    readonly findingCountB: number;
    /** `findingCountB - findingCountA`. Positive = run B has more findings. */
    readonly findingCountDelta: number;
    /** `durationB - durationA` in milliseconds. `undefined` unless both present. */
    readonly durationDeltaMs?: number;
}

/** Complete comparison of two runs. */
export interface RunComparison {
    readonly runIdA: string;
    readonly runIdB: string;
    readonly statusA: RunStatus;
    readonly statusB: RunStatus;
    readonly startedAtMsA: number;
    readonly startedAtMsB: number;
    readonly environmentNameA: string;
    readonly environmentNameB: string;
    /** Per-validation deltas, ordered by run A's declaration then run B extras. */
    readonly validations: readonly ValidationDelta[];
}

// =============================================================================
// compareRuns
// =============================================================================

/**
 * Computes the comparison of two run records. Validations are paired by
 * `validationId`: a validation present in both yields a `"both"` delta with a
 * status/finding/duration comparison; one present on a single side yields an
 * `"only-a"` / `"only-b"` delta. Run A's validations are emitted first in
 * declaration order, followed by validations unique to run B.
 */
export function compareRuns(a: RunRecord, b: RunRecord): RunComparison {
    const bById = new Map<string, ValidationResult>();
    for (const v of b.validations) {
        bById.set(v.validationId, v);
    }

    const deltas: ValidationDelta[] = [];
    const seen = new Set<string>();

    for (const va of a.validations) {
        seen.add(va.validationId);
        const vb = bById.get(va.validationId);
        deltas.push(buildDelta(va, vb));
    }

    for (const vb of b.validations) {
        if (seen.has(vb.validationId)) {
            continue;
        }
        deltas.push(buildDelta(undefined, vb));
    }

    return {
        runIdA: a.runId,
        runIdB: b.runId,
        statusA: a.status,
        statusB: b.status,
        startedAtMsA: a.startedAtMs,
        startedAtMsB: b.startedAtMs,
        environmentNameA: a.environmentSnapshot.name,
        environmentNameB: b.environmentSnapshot.name,
        validations: deltas,
    };
}

// =============================================================================
// Helpers
// =============================================================================

function buildDelta(
    a: ValidationResult | undefined,
    b: ValidationResult | undefined,
): ValidationDelta {
    const presence: ValidationPresence =
        a !== undefined && b !== undefined ? "both" : a !== undefined ? "only-a" : "only-b";
    const validationId = (a ?? b)!.validationId;
    const displayName = b?.displayName ?? a?.displayName ?? validationId;
    const validationType = (b ?? a)?.payload.validationType;
    const findingCountA = a?.payload.findings.length ?? 0;
    const findingCountB = b?.payload.findings.length ?? 0;
    const durationDeltaMs =
        a !== undefined && b !== undefined
            ? b.endedAtMs - b.startedAtMs - (a.endedAtMs - a.startedAtMs)
            : undefined;
    return {
        validationId,
        displayName,
        validationType,
        presence,
        statusA: a?.status,
        statusB: b?.status,
        statusChanged: a !== undefined && b !== undefined && a.status !== b.status,
        findingCountA,
        findingCountB,
        findingCountDelta: findingCountB - findingCountA,
        durationDeltaMs,
    };
}
