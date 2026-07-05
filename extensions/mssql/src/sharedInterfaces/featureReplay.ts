/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generic replay contracts shared by the host-side replay engine
 * (src/diagnostics/featureCapture/replayEngine.ts) and feature webviews.
 * Pure JSON-serializable types — no imports, webview-safe.
 *
 * A feature instantiates these with its own event, config, and matrix-cell
 * types; the engine handles cart/queue/run lifecycle, sequential drain,
 * cancellation, and replay tagging identically for every feature.
 */

/**
 * How a cart row resolves its replay config at queue time:
 * - "snapshot": the config captured when the row was added to the cart;
 * - "override": captured config + the row's partial override;
 * - "live": the feature's current (toolbar) config at run time.
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

export interface FeatureReplayRun<TCell extends FeatureReplayMatrixCellBase> {
    id: string;
    traceId: string;
    kind: "single" | "matrix";
    startedAt: number;
    completedAt?: number;
    status: "queued" | "running" | "cancelled" | "completed";
    totalEvents: number;
    completedEvents: number;
    matrixCells?: TCell[];
    activeMatrixCellId?: string;
}

export interface FeatureReplayQueueRow<TEvent, TConfig> {
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
