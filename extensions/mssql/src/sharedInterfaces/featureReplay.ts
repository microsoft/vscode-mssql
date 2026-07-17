/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generic replay contracts shared by the host-side replay engine
 * (src/diagnostics/featureCapture/replayEngine.ts) and feature webviews.
 * Pure JSON-serializable types plus the minimal cancellation-token interface
 * — imports only webview-safe sibling contracts, webview-safe.
 *
 * A feature instantiates these with its own event, config, and matrix-cell
 * types; the engine handles cart/queue/run lifecycle, sequential drain,
 * cancellation, and replay tagging identically for every feature.
 */

import {
    ReplayCancellationOutcome,
    ReplayEstimate,
    ReplaySafetyAssessment,
    ReplayTargetRef,
} from "./replaySafety";

/**
 * How a cart row resolves its replay config at queue time:
 * - "snapshot": the config captured when the row was added to the cart;
 * - "override": captured config + the row's partial override;
 * - "live": the feature's current (toolbar) config, resolved and FROZEN at
 *   queue time (addendum §2.2 honesty invariant: a "live" replay config is
 *   frozen and recorded at a defined boundary — this one).
 */
export type FeatureReplayConfigMode = "snapshot" | "override" | "live";

export interface FeatureReplayMatrixCellBase {
    cellId: string;
    ordinal: number;
}

export interface FeatureReplaySnapshot<TEvent, TConfig> {
    id: string;
    sourceEventId: string;
    sourceLabel: string;
    capturedAt: number;
    event: TEvent;
    capturedConfig: TConfig;
    configMode: FeatureReplayConfigMode;
    override?: Partial<TConfig> | null;
}

/**
 * Run lifecycle (addendum §7.3/§7.4): "cancelling" holds while a cancel
 * request waits for the active item to settle; "partial" is the honest state
 * of a run whose owner went away mid-drain (disposal/restart); "failed" is a
 * run refused before queueing (hard cap, preflight block).
 */
export type FeatureReplayRunStatus =
    | "queued"
    | "running"
    | "cancelling"
    | "cancelled"
    | "completed"
    | "partial"
    | "failed";

export interface FeatureReplayRun<TCell extends FeatureReplayMatrixCellBase> {
    /** Durable replay run id (`rr-<uuid>`, identity.ts) — globally unique. */
    id: string;
    traceId: string;
    kind: "single" | "matrix";
    startedAt: number;
    completedAt?: number;
    status: FeatureReplayRunStatus;
    totalEvents: number;
    completedEvents: number;
    matrixCells?: TCell[];
    activeMatrixCellId?: string;
    /** When a cancel was requested (set even if items complete anyway). */
    cancelRequestedAt?: number;
    /** Honest reason for a "failed" run that never queued (cap/preflight). */
    errorMessage?: string;
    /**
     * WI-3.4: items whose mode-required inputs were unavailable and that were
     * therefore refused per-item (they count into completedEvents progress
     * but executed nothing). Absent/0 when nothing blocked.
     */
    blockedEvents?: number;
    /** Pre-queue cost estimate when the host provides one (addendum §7.5). */
    estimate?: ReplayEstimate;
    /** Adapter safety classification when the host provides one (§7.8). */
    safety?: ReplaySafetyAssessment;
    /** True once the durable run repository accepted the run manifest. */
    durable?: boolean;
}

export interface FeatureReplayQueueRow<TEvent, TConfig> {
    /** Durable replay item id (`ri-<uuid>`, identity.ts) — globally unique. */
    id: string;
    runId: string;
    traceId: string;
    snapshotId: string;
    sourceEventId: string;
    position: number;
    total: number;
    status: "queued" | "running";
    queuedAt: number;
    startedAt?: number;
    config: TConfig;
    /** sha256 of the frozen config's canonical JSON, computed at queue time. */
    configDigest?: string;
    /** Repetition ordinal (1-based; always 1 until repetitions land). */
    repetition?: number;
    matrixCellId?: string;
    matrixCellLabel?: string;
    event: TEvent;
}

export interface FeatureReplayState<TEvent, TConfig, TCell extends FeatureReplayMatrixCellBase> {
    cart: FeatureReplaySnapshot<TEvent, TConfig>[];
    runs: FeatureReplayRun<TCell>[];
    queueRows: FeatureReplayQueueRow<TEvent, TConfig>[];
    activeRunId?: string;
    builderOpen: boolean;
    lastAddedAt?: number;
}

/** Correlation tags stamped on every replayed event (Trace Identity V1). */
export interface FeatureReplayTags {
    replayTraceId: string;
    replayRunId: string;
    replayMatrixCellId?: string;
    replaySourceEventId: string;
}

/**
 * Minimal cancellation token the engine hands to `execute` (addendum §7.4).
 * Shaped like vscode.CancellationToken but webview-free; host adapters may
 * bridge it to a vscode.CancellationTokenSource.
 */
export interface FeatureReplayCancellationToken {
    readonly isCancellationRequested: boolean;
    onCancellationRequested(listener: () => void): { dispose(): void };
}

/**
 * Optional result reference an `execute` implementation may return so the
 * durable item record can link the replayed output (addendum §7.3 "result
 * capture event ID or artifact reference").
 */
export interface FeatureReplayExecuteResult {
    /** Ring-local id of the recorded result event (display ordinal). */
    resultEventId?: string;
    /** Durable link id (`ce-<uuid>`) of the recorded result event. */
    resultCaptureEventId?: string;
    /** Host-observed cancellation outcome, overriding engine inference. */
    cancellationOutcome?: ReplayCancellationOutcome;
    /**
     * WI-3.4: set when the item was refused because its replay mode required
     * inputs that were unavailable (e.g. required current schema). The engine
     * records the item as `blocked` — a visible state, never an error.
     */
    blockedReason?: string;
    /** WI-3.4: the feature-declared replay mode this item executed under. */
    replayMode?: string;
    /** WI-3.4: where the item's schema/context inputs came from (incl. explicit fallback). */
    schemaContextSource?: string;
    /** WI-3.6 (§7.8.2): the resolved execution target this item ran against. */
    target?: ReplayTargetRef;
    /** WI-3.6 (§7.8.2): the database the item actually executed in. */
    targetDatabase?: string;
}

export function createEmptyFeatureReplayState<
    TEvent,
    TConfig,
    TCell extends FeatureReplayMatrixCellBase,
>(): FeatureReplayState<TEvent, TConfig, TCell> {
    return {
        cart: [],
        runs: [],
        queueRows: [],
        activeRunId: undefined,
        builderOpen: false,
        lastAddedAt: undefined,
    };
}
