/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Replay safety, cost, and execution-context contracts (final plan WI-3.2 /
 * addendum §7.4–§7.5, Appendix C — normative shapes). Pure JSON-serializable
 * types, webview-safe: the Replay Lab renders these badges/estimates directly
 * and the durable run manifest (mssql.replay.run/1) embeds them verbatim.
 */

/**
 * What re-executing the run's items may do to the world (addendum §7.8):
 * - "none": no side effects beyond a model call (completions);
 * - "readOnlyExpected": estimated plan / parser-proven read-only SQL;
 * - "potentiallyMutating": normal execution, DML/DDL, procedures, dynamic SQL;
 * - "unknown": the adapter could not classify — treated as the most severe.
 */
export type ReplaySideEffectClass = "none" | "readOnlyExpected" | "potentiallyMutating" | "unknown";

/** How the run binds to an execution target (database, service, ...). */
export type ReplayTargetBinding = "none" | "exactRequired" | "userSelected";

/** Appendix C: adapter-declared safety classification for a planned run. */
export interface ReplaySafetyAssessment {
    sideEffectClass: ReplaySideEffectClass;
    targetBinding: ReplayTargetBinding;
    requiresConfirmation: boolean;
    requiresSandbox: boolean;
    reasons: string[];
    blockedReason?: string;
}

/** Appendix C: pre-queue cost/cardinality estimate (addendum §7.5). */
export interface ReplayEstimate {
    sourceItems: number;
    matrixCells: number;
    repetitions: number;
    totalExecutions: number;
    estimatedInputTokens?: number;
    estimatedOutputTokens?: number;
    estimatedCost?: number;
    currency?: string;
    warnings: string[];
}

/** Post-run actuals recorded next to the estimate (honesty: estimate vs. actual). */
export interface ReplayActualCost {
    totalExecutions: number;
    inputTokens?: number;
    outputTokens?: number;
}

/** Context handed to `preflight`/`classifySafety` before anything queues. */
export interface ReplayPreflightContext<TConfig = unknown> {
    replayRunId: string;
    sourceItems: number;
    matrixCells: number;
    repetitions: number;
    /** The resolved (frozen) config of every planned item, in queue order. */
    configs: TConfig[];
    /**
     * WI-3.6 (additive): the planned (source event, frozen config) pair of
     * every item, in queue order. Adapters whose safety classification
     * depends on the SOURCE record — Query Studio's execution mode and SQL
     * text presence (§7.8) — read these; `sourceEvent` is the frozen cart
     * snapshot payload, typed by the feature adapter.
     */
    pairs?: Array<{ sourceEvent: unknown; config: TConfig }>;
}

export interface ReplayPreflightResult {
    ok: boolean;
    blockedReason?: string;
}

/** Execution target identity recorded per run/item (addendum §7.8 binding). */
export interface ReplayTargetRef {
    kind: string;
    fingerprint: string;
    label: string;
}

/**
 * Provenance block of a durable replay run. Features define richer typed
 * shapes (e.g. Appendix D `CompletionReplayProvenanceV1`); the generic
 * contract only promises JSON-serializable metadata — never payload content.
 */
export type ReplayProvenance = Record<string, unknown>;

/**
 * How a cancellation request related to one item's actual execution
 * (addendum §7.4): removed before it started, interrupted in flight, or
 * requested while the item was running but the execution completed anyway.
 */
export type ReplayCancellationOutcome =
    | "cancelledBeforeStart"
    | "cancelledInFlight"
    | "cancelRequestedButCompleted";

/** Appendix C: per-item execution context (durable identity + frozen config). */
export interface ReplayExecutionContext<TSource, TConfig> {
    replayRunId: string;
    replayItemId: string;
    matrixCellId?: string;
    repetition: number;
    source: TSource;
    config: TConfig;
    configDigest: string;
    target?: ReplayTargetRef;
    provenance: ReplayProvenance;
}
