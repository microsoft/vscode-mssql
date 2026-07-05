/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generic feature replay engine: cart snapshots with per-row config modes
 * (snapshot/override/live), single and matrix runs over a sequential
 * single-flight drain, cancellation, and Trace Identity replay tagging
 * (replayTraceId/replayRunId/replayMatrixCellId/replaySourceEventId).
 *
 * Everything domain-specific — what a config IS, how a matrix cell resolves
 * to a config, and how an event is re-executed — flows through the host
 * callbacks. The engine also narrates itself into the diag substrate as
 * replay.run / replay.item spans so replays are visible on the Debug Console
 * timeline next to the feature events they re-drive.
 */

import { diag, DiagSpan } from "../diagnosticsCore";
import {
    FeatureReplayConfigMode,
    FeatureReplayMatrixCellBase,
    FeatureReplayQueueRow,
    FeatureReplayRun,
    FeatureReplaySnapshot,
    FeatureReplayState,
    FeatureReplayTags,
    createEmptyFeatureReplayState,
} from "../../sharedInterfaces/featureReplay";

export interface FeatureReplayHost<
    TEvent extends { id: string; timestamp: number },
    TConfig,
    TCell extends FeatureReplayMatrixCellBase,
> {
    /** Diag feature bucket for replay.run/replay.item spans (e.g. "completions", "queryStudio"). */
    feature: string;
    /** Rows whose events are not runnable (in-flight placeholders) are skipped at queue time. */
    isRunnable(event: TEvent): boolean;
    /** Build the captured config for an event added to the cart. */
    captureConfig(event: TEvent): TConfig;
    /** The feature's current (toolbar/settings) config. */
    resolveLiveConfig(): TConfig;
    /** Normalize a full config (drop empty overrides etc.). */
    compactConfig(config: TConfig): TConfig;
    /** Normalize a partial override before merging over a captured config. */
    compactPartialConfig(partial: Partial<TConfig> | null | undefined): Partial<TConfig>;
    /** Resolve a matrix cell to a full config (current config + cell dimensions). */
    resolveMatrixCellConfig(cell: TCell): TConfig;
    /** Human label for a queue row's matrix cell (e.g. "Balanced x Tight"). */
    formatCellLabel(cell: TCell): string;
    /** Default cart label for an event when the caller supplies none. */
    formatSourceLabel(event: TEvent): string;
    /** Placeholder event shown in the queue while a row waits/runs. */
    createQueuedEvent(
        snapshot: FeatureReplaySnapshot<TEvent, TConfig>,
        config: TConfig,
        run: FeatureReplayRun<TCell>,
        position: number,
        total: number,
        cell: TCell | undefined,
    ): TEvent;
    /** Flip a queued placeholder to its in-flight shape when its row starts running. */
    markEventRunning(event: TEvent, startedAt: number): TEvent;
    /** Re-execute one captured event with the resolved config. Errors are contained per row. */
    execute(event: TEvent, config: TConfig, tags: FeatureReplayTags): Promise<void>;
    /** State push hook — called after every engine state change. */
    onStateChanged(): void;
    isDisposed(): boolean;
}

export class FeatureReplayEngine<
    TEvent extends { id: string; timestamp: number },
    TConfig,
    TCell extends FeatureReplayMatrixCellBase,
> {
    private readonly _host: FeatureReplayHost<TEvent, TConfig, TCell>;
    private _state: FeatureReplayState<TEvent, TConfig, TCell> = createEmptyFeatureReplayState<
        TEvent,
        TConfig,
        TCell
    >();
    private _snapshotCounter = 0;
    private _traceCounter = 0;
    private _runCounter = 0;
    private _queueCounter = 0;
    private _drainActive = false;
    private readonly _runSpans = new Map<string, DiagSpan>();

    constructor(host: FeatureReplayHost<TEvent, TConfig, TCell>) {
        this._host = host;
    }

    public getState(): FeatureReplayState<TEvent, TConfig, TCell> {
        return this._state;
    }

    /** Replace externally-owned display state (builder drawer open/closed). */
    public setBuilderOpen(open: boolean): void {
        this.updateState({ ...this._state, builderOpen: open });
    }

    // ------------------------------------------------------------------ cart

    public addToCart(items: Array<{ event: TEvent; sourceLabel?: string }>): void {
        const snapshots = items
            .filter((item) => this._host.isRunnable(item.event))
            .map((item) => this.createSnapshot(item.event, item.sourceLabel));
        if (snapshots.length === 0) {
            return;
        }

        this.updateState({
            ...this._state,
            cart: [...this._state.cart, ...snapshots],
            lastAddedAt: Date.now(),
        });
    }

    public removeFromCart(snapshotId: string): void {
        this.updateState({
            ...this._state,
            cart: this._state.cart.filter((snapshot) => snapshot.id !== snapshotId),
        });
    }

    public clearCart(): void {
        this.updateState({ ...this._state, cart: [] });
    }

    public reverseCart(): void {
        this.updateState({ ...this._state, cart: [...this._state.cart].reverse() });
    }

    /** Replace the whole cart (e.g. restoring a dialog-open snapshot on cancel). */
    public replaceCart(cart: FeatureReplaySnapshot<TEvent, TConfig>[]): void {
        this.updateState({ ...this._state, cart });
    }

    /** Bounds-checked positional move; out-of-range indices are a no-op. */
    public moveCartItem(fromIndex: number, toIndex: number): void {
        if (
            fromIndex < 0 ||
            toIndex < 0 ||
            fromIndex >= this._state.cart.length ||
            toIndex >= this._state.cart.length ||
            fromIndex === toIndex
        ) {
            return;
        }

        const cart = [...this._state.cart];
        const [moved] = cart.splice(fromIndex, 1);
        if (moved !== undefined) {
            cart.splice(toIndex, 0, moved);
        }
        this.updateState({ ...this._state, cart });
    }

    public updateCartSnapshot(
        snapshotId: string,
        update: Partial<Pick<FeatureReplaySnapshot<TEvent, TConfig>, "configMode" | "override">>,
    ): void {
        this.updateState({
            ...this._state,
            cart: this._state.cart.map((snapshot) =>
                snapshot.id === snapshotId ? { ...snapshot, ...update } : snapshot,
            ),
        });
    }

    // ----------------------------------------------------------------- queue

    public queueCart(configMode?: FeatureReplayConfigMode): void {
        this.queueSnapshots(this._state.cart, "single", [], configMode);
    }

    /** Matrix run: the feature builds its cells (cartesian product of its dimensions). */
    public runMatrix(cells: TCell[]): void {
        if (cells.length === 0) {
            return;
        }

        this.queueSnapshots(this._state.cart, "matrix", cells);
    }

    /**
     * Queue events directly without touching the cart (e.g. "replay this
     * whole session now"). Snapshots are created internally with the given
     * config mode.
     */
    public queueEvents(
        events: TEvent[],
        kind: FeatureReplayRun<TCell>["kind"],
        sourceLabel?: string,
        configMode?: FeatureReplayConfigMode,
    ): void {
        const snapshots = events
            .filter((event) => this._host.isRunnable(event))
            .map((event) => ({
                ...this.createSnapshot(event, sourceLabel),
                ...(configMode ? { configMode } : {}),
            }));
        this.queueSnapshots(snapshots, kind);
    }

    /** Queue snapshots directly (single event replay, session replay). */
    public queueSnapshots(
        snapshots: FeatureReplaySnapshot<TEvent, TConfig>[],
        kind: FeatureReplayRun<TCell>["kind"],
        matrixCells: TCell[] = [],
        configMode?: FeatureReplayConfigMode,
    ): void {
        const runnableSnapshots = snapshots.filter((snapshot) =>
            this._host.isRunnable(snapshot.event),
        );
        if (runnableSnapshots.length === 0) {
            return;
        }

        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const traceId = `trace-${stamp}-${++this._traceCounter}`;
        const runId = `run-${stamp}-${++this._runCounter}`;
        const cells = kind === "matrix" ? matrixCells : [];
        const total = (cells.length || 1) * runnableSnapshots.length;
        const startedAt = Date.now();
        const run: FeatureReplayRun<TCell> = {
            id: runId,
            traceId,
            kind,
            startedAt,
            status: "queued",
            totalEvents: total,
            completedEvents: 0,
            matrixCells: cells.length > 0 ? cells : undefined,
        };
        let runPosition = 0;
        const queueRows =
            kind === "matrix"
                ? cells.flatMap((cell) =>
                      runnableSnapshots.map((snapshot) =>
                          this.createQueueRow(snapshot, run, ++runPosition, total, cell),
                      ),
                  )
                : runnableSnapshots.map((snapshot) =>
                      this.createQueueRow(
                          snapshot,
                          run,
                          ++runPosition,
                          total,
                          undefined,
                          configMode,
                      ),
                  );

        this._runSpans.set(
            runId,
            diag.startSpan({
                feature: this._host.feature,
                kind: "span",
                type: "replay.run",
                fields: {
                    replayTraceId: { raw: traceId, cls: "diagnostic.metadata" },
                    replayRunId: { raw: runId, cls: "diagnostic.metadata" },
                    runKind: { raw: kind, cls: "diagnostic.metadata" },
                    totalEvents: { raw: total, cls: "diagnostic.metadata" },
                    matrixCells: { raw: cells.length, cls: "diagnostic.metadata" },
                },
            }),
        );

        this.updateState({
            ...this._state,
            runs: [...this._state.runs, run],
            queueRows: [...this._state.queueRows, ...queueRows],
            activeRunId: this._state.activeRunId ?? run.id,
            builderOpen: false,
        });
        this.startDrain();
    }

    public cancelRun(runId: string | undefined): void {
        const effectiveRunId = runId ?? this._state.activeRunId;
        if (!effectiveRunId) {
            return;
        }

        const remainingRows = this._state.queueRows.filter(
            (row) => row.runId !== effectiveRunId || row.status === "running",
        );
        const hasRunningRow = remainingRows.some((row) => row.runId === effectiveRunId);
        this.updateState({
            ...this._state,
            queueRows: remainingRows,
            activeRunId: remainingRows[0]?.runId,
            runs: this._state.runs.map((run) =>
                run.id === effectiveRunId
                    ? {
                          ...run,
                          status: "cancelled",
                          completedAt: hasRunningRow ? run.completedAt : Date.now(),
                      }
                    : run,
            ),
        });
        if (!hasRunningRow) {
            this.settleRunSpan(effectiveRunId, "cancelled");
        }
    }

    public dispose(): void {
        for (const [runId] of this._runSpans) {
            this.settleRunSpan(runId, "disposed");
        }
    }

    // -------------------------------------------------------------- internal

    private createSnapshot(
        event: TEvent,
        sourceLabel: string | undefined,
    ): FeatureReplaySnapshot<TEvent, TConfig> {
        return {
            id: `snapshot-${++this._snapshotCounter}`,
            sourceEventId: event.id,
            sourceLabel: sourceLabel ?? this._host.formatSourceLabel(event),
            capturedAt: Date.now(),
            event: cloneJson(event),
            capturedConfig: this._host.captureConfig(event),
            configMode: "snapshot",
            override: null,
        };
    }

    private createQueueRow(
        snapshot: FeatureReplaySnapshot<TEvent, TConfig>,
        run: FeatureReplayRun<TCell>,
        position: number,
        total: number,
        matrixCell: TCell | undefined,
        configMode?: FeatureReplayConfigMode,
    ): FeatureReplayQueueRow<TEvent, TConfig> {
        this._queueCounter++;
        const config = matrixCell
            ? this._host.resolveMatrixCellConfig(matrixCell)
            : this.resolveSnapshotConfig(snapshot, configMode);
        return {
            id: `queue-${this._queueCounter}`,
            runId: run.id,
            traceId: run.traceId,
            snapshotId: snapshot.id,
            sourceEventId: snapshot.sourceEventId,
            position,
            total,
            status: "queued",
            queuedAt: Date.now(),
            config,
            matrixCellId: matrixCell?.cellId,
            matrixCellLabel: matrixCell ? this._host.formatCellLabel(matrixCell) : undefined,
            event: this._host.createQueuedEvent(snapshot, config, run, position, total, matrixCell),
        };
    }

    private resolveSnapshotConfig(
        snapshot: FeatureReplaySnapshot<TEvent, TConfig>,
        configModeOverride?: FeatureReplayConfigMode,
    ): TConfig {
        const configMode = configModeOverride ?? snapshot.configMode;
        if (configMode === "live") {
            return this._host.compactConfig(this._host.resolveLiveConfig());
        }

        return this._host.compactConfig({
            ...snapshot.capturedConfig,
            ...(configMode === "override"
                ? this._host.compactPartialConfig(snapshot.override)
                : {}),
        });
    }

    private startDrain(): void {
        if (this._drainActive) {
            return;
        }

        this._drainActive = true;
        void this.drainQueue();
    }

    private async drainQueue(): Promise<void> {
        try {
            while (!this._host.isDisposed()) {
                const nextRow = this._state.queueRows[0];
                if (!nextRow) {
                    this.updateState({ ...this._state, activeRunId: undefined });
                    return;
                }

                const run = this._state.runs.find((item) => item.id === nextRow.runId);
                if (!run) {
                    this.updateState({
                        ...this._state,
                        queueRows: this._state.queueRows.slice(1),
                    });
                    continue;
                }

                const startedAt = Date.now();
                this.updateState({
                    ...this._state,
                    activeRunId: run.id,
                    runs: this._state.runs.map((item) =>
                        item.id === run.id
                            ? {
                                  ...item,
                                  status: item.status === "cancelled" ? "cancelled" : "running",
                                  activeMatrixCellId: nextRow.matrixCellId,
                              }
                            : item,
                    ),
                    queueRows: this._state.queueRows.map((item) =>
                        item.id === nextRow.id
                            ? {
                                  ...item,
                                  status: "running" as const,
                                  startedAt,
                                  event: this._host.markEventRunning(item.event, startedAt),
                              }
                            : item,
                    ),
                });

                const tags = createReplayTags(nextRow);
                const itemSpan = diag.startSpan({
                    feature: this._host.feature,
                    kind: "span",
                    type: "replay.item",
                    fields: {
                        replayTraceId: { raw: tags.replayTraceId, cls: "diagnostic.metadata" },
                        replayRunId: { raw: tags.replayRunId, cls: "diagnostic.metadata" },
                        replaySourceEventId: {
                            raw: tags.replaySourceEventId,
                            cls: "diagnostic.metadata",
                        },
                        ...(tags.replayMatrixCellId
                            ? {
                                  replayMatrixCellId: {
                                      raw: tags.replayMatrixCellId,
                                      cls: "diagnostic.metadata",
                                  },
                              }
                            : {}),
                        position: { raw: nextRow.position, cls: "diagnostic.metadata" },
                        total: { raw: nextRow.total, cls: "diagnostic.metadata" },
                    },
                });
                try {
                    await this._host.execute(nextRow.event, nextRow.config, tags);
                    itemSpan.end("ok");
                } catch (error) {
                    // A throwing executor must not wedge the drain loop; the
                    // feature records its own error event for the row.
                    itemSpan.fail(error);
                }

                this.completeQueueRow(nextRow);
            }
        } finally {
            this._drainActive = false;
            if (!this._host.isDisposed() && this._state.queueRows.length > 0) {
                this.startDrain();
            }
        }
    }

    private completeQueueRow(row: FeatureReplayQueueRow<TEvent, TConfig>): void {
        const currentRun = this._state.runs.find((run) => run.id === row.runId);
        const completedEvents = (currentRun?.completedEvents ?? 0) + 1;
        const remainingRows = this._state.queueRows.filter((item) => item.id !== row.id);
        const runHasQueuedRows = remainingRows.some((item) => item.runId === row.runId);
        let settledStatus: "cancelled" | "completed" | undefined;
        const updatedRuns = this._state.runs.map((run) => {
            if (run.id !== row.runId) {
                return run;
            }

            const status: FeatureReplayRun<TCell>["status"] =
                run.status === "cancelled"
                    ? "cancelled"
                    : runHasQueuedRows
                      ? "running"
                      : "completed";
            if (!runHasQueuedRows && (status === "cancelled" || status === "completed")) {
                settledStatus = status;
            }
            return {
                ...run,
                completedEvents,
                status,
                activeMatrixCellId: runHasQueuedRows ? run.activeMatrixCellId : undefined,
                completedAt: runHasQueuedRows ? run.completedAt : Date.now(),
            };
        });

        this.updateState({
            ...this._state,
            queueRows: remainingRows,
            runs: updatedRuns,
            activeRunId: remainingRows[0]?.runId,
        });
        if (settledStatus) {
            this.settleRunSpan(row.runId, settledStatus);
        }
    }

    private settleRunSpan(runId: string, outcome: "completed" | "cancelled" | "disposed"): void {
        const span = this._runSpans.get(runId);
        if (!span) {
            return;
        }

        this._runSpans.delete(runId);
        span.end(outcome === "completed" ? "ok" : "warning", {
            outcome: { raw: outcome, cls: "diagnostic.metadata" },
        });
    }

    private updateState(next: FeatureReplayState<TEvent, TConfig, TCell>): void {
        this._state = next;
        if (!this._host.isDisposed()) {
            this._host.onStateChanged();
        }
    }
}

export function createReplayTags<TEvent, TConfig>(
    row: FeatureReplayQueueRow<TEvent, TConfig>,
): FeatureReplayTags {
    return {
        replayTraceId: row.traceId,
        replayRunId: row.runId,
        ...(row.matrixCellId ? { replayMatrixCellId: row.matrixCellId } : {}),
        replaySourceEventId: row.sourceEventId,
    };
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}
