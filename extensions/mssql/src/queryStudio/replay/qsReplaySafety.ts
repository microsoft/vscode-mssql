/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio replay safety classification (WI-3.6 / addendum §7.8 —
 * NORMATIVE). Pure functions, no vscode imports: the adapter, the preflight
 * gate, and the tests all reason through this one module.
 *
 * Execution classes (§7.8.1):
 * - `noExecution`: parse-only (SET PARSEONLY — the server compiles, nothing
 *   executes);
 * - `readOnlyExpected`: estimated plan (SET SHOWPLAN_XML — plan requests
 *   only, but they DO run against the live connection);
 * - `potentiallyMutating`: normal execution, actual plan (SET STATISTICS XML
 *   executes the statements), and anything unknown — DDL, DML, procedure
 *   calls, and dynamic SQL all live here, and no parser claim downgrades
 *   them without a proven read-only analysis.
 */

import { QsReplayConfig, QsRunRecord } from "../../sharedInterfaces/queryStudioReplay";
import { ReplaySafetyAssessment } from "../../sharedInterfaces/replaySafety";

export type QsReplayExecutionClass = "noExecution" | "readOnlyExpected" | "potentiallyMutating";

/**
 * WI-3.7 — Query Studio mutating-mode decision gate.
 *
 * `false` means: replaying captured runs in `normal` or `actualPlan` mode
 * (or any mode this module cannot classify) is DISABLED — preflight refuses
 * the run, classifySafety marks it blocked, and the per-item executor
 * refuses again as defense in depth. This is a CODE-LEVEL gate, not a user
 * setting, on purpose (addendum WI-3.7: "do not enable broad normal or
 * actual-plan matrix execution until product and security review approves
 * the policy"). Flipping it requires:
 *
 * 1. an approved product/security review of the §7.8.3 policy (sandbox or
 *    test-connection preference, confirmation UX, no transaction-wrapping
 *    safety claims);
 * 2. a warning + confirmation flow that names target, database, and item
 *    count for every potentially mutating run;
 * 3. adapter-approved target groups only — never arbitrary database
 *    cartesian products (§7.8.5).
 *
 * Until then this constant stays `false` and no configuration surface may
 * expose it.
 */
export const QS_MUTATING_REPLAY_GATE = false;

export const QS_MUTATING_REPLAY_BLOCKED_REASON =
    "Potentially mutating replay (normal/actualPlan) is disabled pending product/security review " +
    "(WI-3.7 gate). Replay with parse-only or estimated-plan mode instead.";

export const QS_TEXTLESS_BLOCKED_REASON =
    "captured without SQL text — enable elevated capture to record replayable runs";

export const QS_NO_TARGET_BLOCKED_REASON =
    "no target matching the captured fingerprint; select a target explicitly";

/**
 * §7.8.1 execution classification for ONE planned item: the effective mode
 * is the frozen config's mode when set, else the record's captured mode;
 * anything unrecognized classifies as the most severe class.
 */
export function classifyQsReplayExecution(
    record: Pick<QsRunRecord, "mode">,
    config: Pick<QsReplayConfig, "mode">,
): QsReplayExecutionClass {
    const effectiveMode = config.mode ?? record.mode;
    switch (effectiveMode) {
        case "parseOnly":
            return "noExecution";
        case "estimatedPlan":
            return "readOnlyExpected";
        default:
            // "normal", "actualPlan", and anything unknown.
            return "potentiallyMutating";
    }
}

/** The most severe class across a planned run's items. */
export function worstQsReplayExecutionClass(
    classes: readonly QsReplayExecutionClass[],
): QsReplayExecutionClass {
    if (classes.length === 0 || classes.includes("potentiallyMutating")) {
        // An empty plan cannot be proven safe — classify as most severe.
        return "potentiallyMutating";
    }
    return classes.includes("readOnlyExpected") ? "readOnlyExpected" : "noExecution";
}

/**
 * §7.8 safety assessment for a planned run. Target binding is ALWAYS
 * `exactRequired` — Query Studio replay never runs without a fingerprint
 * match or an explicit user selection (§2.2.5: never silently substitute a
 * target).
 */
export function classifyQsReplaySafety(
    classes: readonly QsReplayExecutionClass[],
): ReplaySafetyAssessment {
    const worst = worstQsReplayExecutionClass(classes);
    if (worst === "noExecution") {
        return {
            sideEffectClass: "none",
            targetBinding: "exactRequired",
            requiresConfirmation: false,
            requiresSandbox: false,
            reasons: ["parse-only: the server compiles the batches, nothing executes"],
        };
    }
    if (worst === "readOnlyExpected") {
        return {
            sideEffectClass: "readOnlyExpected",
            targetBinding: "exactRequired",
            requiresConfirmation: true,
            requiresSandbox: false,
            reasons: [
                "estimated-plan requests execute against the bound live connection; " +
                    "a confirmation naming target and item count is required (§7.8.3)",
            ],
        };
    }
    return {
        sideEffectClass: "potentiallyMutating",
        targetBinding: "exactRequired",
        requiresConfirmation: true,
        requiresSandbox: true,
        reasons: [
            "normal/actual-plan execution can mutate the target (DML, DDL, procedures, dynamic SQL)",
        ],
        ...(QS_MUTATING_REPLAY_GATE ? {} : { blockedReason: QS_MUTATING_REPLAY_BLOCKED_REASON }),
    };
}
