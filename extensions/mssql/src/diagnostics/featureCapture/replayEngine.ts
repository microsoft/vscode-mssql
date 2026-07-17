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
 *
 * V2 context (final plan WI-3.2 / addendum §7.2, §7.4, §7.5 — additive over
 * the preserved sequential kernel and per-item containment):
 * - durable ids from identity.ts (`rr-…` runs, `ri-…` items);
 * - every config (including "live" mode) resolves and FREEZES at queue time,
 *   with the frozen config's sha256 digest recorded on the row;
 * - real cancellation: queued rows removed immediately, the ACTIVE item gets
 *   a cancellation token, the run holds `cancelling` until the active
 *   execution settles, and per-item outcomes distinguish
 *   cancelledBeforeStart / cancelledInFlight / cancelRequestedButCompleted;
 * - optional host estimate/preflight/classifySafety hooks, a hard item cap
 *   (default 500/run) that refuses with an honest failed-run state;
 * - an optional run observer so a durable repository can persist run/item
 *   evidence without the engine learning about storage or UI.
 */

import { diag, DiagSpan } from "../diagnosticsCore";
import {
    FeatureReplayCancellationToken,
    FeatureReplayConfigMode,
    FeatureReplayExecuteResult,
    FeatureReplayMatrixCellBase,
    FeatureReplayQueueRow,
    FeatureReplayRun,
    FeatureReplayRunStatus,
    FeatureReplaySnapshot,
    FeatureReplayState,
    FeatureReplayTags,
    createEmptyFeatureReplayState,
} from "../../sharedInterfaces/featureReplay";
import {
    ReplayCancellationOutcome,
    ReplayEstimate,
    ReplayPreflightContext,
    ReplayPreflightResult,
    ReplaySafetyAssessment,
} from "../../sharedInterfaces/replaySafety";
import { sha256OfCanonicalJson } from "./configGroups";
import { newReplayItemId, newReplayRunId } from "./identity";

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
    /**
     * Re-execute one captured event with the resolved (frozen) config.
     * Errors are contained per row. The cancellation token is signalled when
     * the user cancels the run while this item is active (addendum §7.4) —
     * hosts thread it into their underlying operation (model request, SQL
     * execution). The optional result reference links the replayed output
     * into the durable item record.
     */
    execute(
        event: TEvent,
        config: TConfig,
        tags: FeatureReplayTags,
        cancellation: FeatureReplayCancellationToken,
    ): Promise<FeatureReplayExecuteResult | void>;
    /**
     * Optional pre-queue cost estimate (addendum §7.5). Computed before
     * anything queues and exposed on the run state for the UI.
     */
    estimate?(
        sources: FeatureReplaySnapshot<TEvent, TConfig>[],
        cells: TCell[],
        repetitions?: number,
    ): ReplayEstimate;
    /**
     * Optional async gate evaluated after the run is announced (status
     * "queued") but before any item queues; `ok: false` flips the run to an
     * honest "failed" state with the blocked reason.
     */
    preflight?(context: ReplayPreflightContext<TConfig>): Promise<ReplayPreflightResult>;
    /** Optional adapter safety classification recorded on the run (§7.8). */
    classifySafety?(context: ReplayPreflightContext<TConfig>): ReplaySafetyAssessment;
    /** State push hook — called after every engine state change. */
    onStateChanged(): void;
    isDisposed(): boolean;
}

// ---------------------------------------------------------------------------
// Run observer (durable persistence seam — WI-3.3)
// ---------------------------------------------------------------------------

/** Everything the repository needs about one planned item, at queue time. */
export interface FeatureReplayPlannedItem<TEvent, TConfig> {
    replayItemId: string;
    runId: string;
    sourceEventId: string;
    sourceLabel: string;
    /** The captured source event (snapshot payload) — digested, never mutated. */
    sourceEvent: TEvent;
    position: number;
    repetition: number;
    config: TConfig;
    configDigest: string;
    matrixCellId?: string;
    matrixCellLabel?: string;
    queuedAt: number;
}

export type FeatureReplayItemStatus = "completed" | "failed" | "cancelled";

/** Terminal record of one item (addendum §7.3 per-item fields). */
export interface FeatureReplayItemOutcome {
    replayItemId: string;
    runId: string;
    sourceEventId: string;
    matrixCellId?: string;
    repetition: number;
    queuedAt: number;
    startedAt?: number;
    endedAt: number;
    configDigest: string;
    status: FeatureReplayItemStatus;
    cancellationOutcome?: ReplayCancellationOutcome;
    resultEventId?: string;
    resultCaptureEventId?: string;
    errorCode?: string;
    errorMessage?: string;
    attempt: number;
}

/**
 * Durable-state callback surface. Every callback is failure-isolated: a
 * throwing observer never affects a run (§2.3 product isolation).
 */
export interface FeatureReplayRunObserver<
    TEvent,
    TConfig,
    TCell extends FeatureReplayMatrixCellBase,
> {
    /** A run passed its gates and its items entered the queue. */
    onRunQueued?(
        run: FeatureReplayRun<TCell>,
        items: FeatureReplayPlannedItem<TEvent, TConfig>[],
    ): void;
    /** Run status/progress changed (running/cancelling/terminal states). */
    onRunUpdated?(run: FeatureReplayRun<TCell>): void;
    /** One item reached a terminal state (including cancelledBeforeStart). */
    onItemSettled?(outcome: FeatureReplayItemOutcome, run: FeatureReplayRun<TCell>): void;
}

export interface FeatureReplayEngineOptions<
    TEvent,
    TConfig,
    TCell extends FeatureReplayMatrixCellBase,
> {
    /** Hard per-run item cap (addendum §7.5); default 500. */
    maxItemsPerRun?: number;
    observer?: FeatureReplayRunObserver<TEvent, TConfig, TCell>;
}

export const REPLAY_ENGINE_DEFAULT_MAX_ITEMS_PER_RUN = 500;

const TERMINAL_RUN_STATUSES: readonly FeatureReplayRunStatus[] = [
    "cancelled",
    "completed",
    "partial",
    "failed",
];

function isTerminalRunStatus(status: FeatureReplayRunStatus): boolean {
    return TERMINAL_RUN_STATUSES.includes(status);
}

/** Minimal webview-free cancellation source (vscode-token shaped). */
export class ReplayCancellationSource {
    private _cancelled = false;
    private _listeners: Array<() => void> = [];
    public readonly token: FeatureReplayCancellationToken;

    constructor() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        this.token = {
            get isCancellationRequested(): boolean {
                return self._cancelled;
            },
            onCancellationRequested(listener: () => void): { dispose(): void } {
                if (self._cancelled) {
                    try {
                        listener();
                    } catch {
                        // listener failures never propagate into the engine
                    }
                    return { dispose: () => undefined };
                }
                self._listeners.push(listener);
                return {
                    dispose: () => {
                        self._listeners = self._listeners.filter((entry) => entry !== listener);
                    },
                };
            },
        };
    }

    public get isCancellationRequested(): boolean {
        return this._cancelled;
    }

    public cancel(): void {
        if (this._cancelled) {
            return;
        }
        this._cancelled = true;
        const listeners = this._listeners;
        this._listeners = [];
        for (const listener of listeners) {
            try {
                listener();
            } catch {
                // listener failures never propagate into the engine
            }
        }
    }
}

export class FeatureReplayEngine<
    TEvent extends { id: string; timestamp: number },
    TConfig,
    TCell extends FeatureReplayMatrixCellBase,
> {
    private readonly _host: FeatureReplayHost<TEvent, TConfig, TCell>;
    private _observer: FeatureReplayRunObserver<TEvent, TConfig, TCell> | undefined;
    private readonly _maxItemsPerRun: number;
    private _state: FeatureReplayState<TEvent, TConfig, TCell> = createEmptyFeatureReplayState<
        TEvent,
        TConfig,
        TCell
    >();
    private _snapshotCounter = 0;
    private _traceCounter = 0;
    private _drainActive = false;
    private readonly _runSpans = new Map<string, DiagSpan>();
    /** Per-row cancellation sources, keyed by replay item id. */
    private readonly _itemCancellations = new Map<string, ReplayCancellationSource>();

    constructor(
        host: FeatureReplayHost<TEvent, TConfig, TCell>,
        options: FeatureReplayEngineOptions<TEvent, TConfig, TCell> = {},
    ) {
        this._host = host;
        this._observer = options.observer;
        this._maxItemsPerRun = options.maxItemsPerRun ?? REPLAY_ENGINE_DEFAULT_MAX_ITEMS_PER_RUN;
    }

    public getState(): FeatureReplayState<TEvent, TConfig, TCell> {
        return this._state;
    }

    /** Late-bind the durable-state observer (repository wiring, WI-3.3). */
    public setRunObserver(
        observer: FeatureReplayRunObserver<TEvent, TConfig, TCell> | undefined,
    ): void {
        this._observer = observer;
    }

    /** Mark a run as durably persisted (set by the repository subscriber). */
    public setRunDurable(runId: string, durable: boolean): void {
        if (!this._state.runs.some((run) => run.id === runId && run.durable !== durable)) {
            return;
        }
        this.updateState({
            ...this._state,
            runs: this._state.runs.map((run) => (run.id === runId ? { ...run, durable } : run)),
        });
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
        const runId = newReplayRunId();
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

        // Hard cap (addendum §7.5): refuse HONESTLY before anything queues —
        // the run appears in state as "failed" with the reason, no item runs.
        if (total > this._maxItemsPerRun) {
            const refused: FeatureReplayRun<TCell> = {
                ...run,
                status: "failed",
                completedAt: Date.now(),
                errorMessage:
                    `Run refused: ${total} items exceed the hard cap of ` +
                    `${this._maxItemsPerRun} items per run. Reduce sources or matrix cells.`,
            };
            diag.emit({
                feature: this._host.feature,
                kind: "event",
                type: "replay.run.refused",
                status: "warning",
                fields: {
                    replayRunId: { raw: runId, cls: "diagnostic.metadata" },
                    requestedItems: { raw: total, cls: "diagnostic.metadata" },
                    maxItemsPerRun: { raw: this._maxItemsPerRun, cls: "diagnostic.metadata" },
                },
            });
            this.updateState({ ...this._state, runs: [...this._state.runs, refused] });
            return;
        }

        // ALL configs — including "live" mode — resolve and freeze here, at
        // queue time (honesty invariant §2.2 #4); rows carry the digest.
        let runPosition = 0;
        const planned: Array<{
            row: FeatureReplayQueueRow<TEvent, TConfig>;
            item: FeatureReplayPlannedItem<TEvent, TConfig>;
        }> =
            kind === "matrix"
                ? cells.flatMap((cell) =>
                      runnableSnapshots.map((snapshot) =>
                          this.createPlannedRow(snapshot, run, ++runPosition, total, cell),
                      ),
                  )
                : runnableSnapshots.map((snapshot) =>
                      this.createPlannedRow(
                          snapshot,
                          run,
                          ++runPosition,
                          total,
                          undefined,
                          configMode,
                      ),
                  );
        const queueRows = planned.map((entry) => entry.row);
        const plannedItems = planned.map((entry) => entry.item);

        const preflightContext: ReplayPreflightContext<TConfig> = {
            replayRunId: runId,
            sourceItems: runnableSnapshots.length,
            matrixCells: cells.length,
            repetitions: 1,
            configs: queueRows.map((row) => row.config),
        };
        if (this._host.estimate) {
            try {
                run.estimate = this._host.estimate(runnableSnapshots, cells, 1);
            } catch {
                // an estimator failure never blocks the run — it just has no estimate
            }
        }
        if (this._host.classifySafety) {
            try {
                run.safety = this._host.classifySafety(preflightContext);
            } catch {
                // classification failure leaves safety honestly absent
            }
        }

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

        if (this._host.preflight) {
            // Announce the run (visible "queued"), gate the items on the
            // async preflight, then commit or refuse.
            this.updateState({
                ...this._state,
                runs: [...this._state.runs, run],
                builderOpen: false,
            });
            void this.finishPreflightAndCommit(run, queueRows, plannedItems, preflightContext);
            return;
        }

        this.commitQueuedRun(run, queueRows, plannedItems, false);
    }

    public cancelRun(runId: string | undefined): void {
        const effectiveRunId = runId ?? this._state.activeRunId;
        if (!effectiveRunId) {
            return;
        }
        const run = this._state.runs.find((item) => item.id === effectiveRunId);
        if (!run || isTerminalRunStatus(run.status)) {
            return;
        }

        const now = Date.now();
        const removedRows = this._state.queueRows.filter(
            (row) => row.runId === effectiveRunId && row.status !== "running",
        );
        const remainingRows = this._state.queueRows.filter(
            (row) => row.runId !== effectiveRunId || row.status === "running",
        );
        const activeRow = remainingRows.find((row) => row.runId === effectiveRunId);
        let updatedRun: FeatureReplayRun<TCell> | undefined;
        this.updateState({
            ...this._state,
            queueRows: remainingRows,
            activeRunId: remainingRows[0]?.runId,
            runs: this._state.runs.map((item) =>
                item.id === effectiveRunId
                    ? (updatedRun = {
                          ...item,
                          // §7.4: cancelling until the active execution settles.
                          status: activeRow ? "cancelling" : "cancelled",
                          cancelRequestedAt: now,
                          completedAt: activeRow ? item.completedAt : now,
                      })
                    : item,
            ),
        });

        // Queued rows removed immediately: cancelledBeforeStart outcomes.
        for (const row of removedRows) {
            this._itemCancellations.delete(row.id);
            if (updatedRun) {
                this.notifyItemSettled(row, updatedRun, {
                    status: "cancelled",
                    cancellationOutcome: "cancelledBeforeStart",
                    endedAt: now,
                });
            }
        }
        if (activeRow) {
            // Signal the active item's token; the drain settles the run.
            this._itemCancellations.get(activeRow.id)?.cancel();
        } else {
            this.settleRunSpan(effectiveRunId, "cancelled");
        }
        if (updatedRun) {
            this.notifyRunUpdated(updatedRun);
        }
    }

    /**
     * Disposal never silently loses run evidence (WI-3.2 accept): every
     * non-terminal run flips to the honest "partial" state, the active
     * item's token is cancelled, and the observer sees the final states.
     */
    public dispose(): void {
        const now = Date.now();
        for (const source of this._itemCancellations.values()) {
            source.cancel();
        }
        this._itemCancellations.clear();
        const interrupted = this._state.runs.filter((run) => !isTerminalRunStatus(run.status));
        if (interrupted.length > 0) {
            const interruptedIds = new Set(interrupted.map((run) => run.id));
            const runs = this._state.runs.map((run) =>
                interruptedIds.has(run.id)
                    ? { ...run, status: "partial" as const, completedAt: now }
                    : run,
            );
            // Host is (being) disposed: update state directly; updateState's
            // onStateChanged guard would drop the notification anyway.
            this._state = { ...this._state, runs, queueRows: [], activeRunId: undefined };
            for (const run of runs) {
                if (interruptedIds.has(run.id)) {
                    this.notifyRunUpdated(run);
                }
            }
        }
        for (const [runId] of this._runSpans) {
            this.settleRunSpan(runId, "disposed");
        }
    }

    // -------------------------------------------------------------- internal

    private commitQueuedRun(
        run: FeatureReplayRun<TCell>,
        queueRows: FeatureReplayQueueRow<TEvent, TConfig>[],
        plannedItems: FeatureReplayPlannedItem<TEvent, TConfig>[],
        runAlreadyInState: boolean,
    ): void {
        this.updateState({
            ...this._state,
            runs: runAlreadyInState
                ? this._state.runs.map((item) => (item.id === run.id ? run : item))
                : [...this._state.runs, run],
            queueRows: [...this._state.queueRows, ...queueRows],
            activeRunId: this._state.activeRunId ?? run.id,
            builderOpen: false,
        });
        this.notifyObserver((observer) => observer.onRunQueued?.(run, plannedItems));
        this.startDrain();
    }

    private async finishPreflightAndCommit(
        run: FeatureReplayRun<TCell>,
        queueRows: FeatureReplayQueueRow<TEvent, TConfig>[],
        plannedItems: FeatureReplayPlannedItem<TEvent, TConfig>[],
        context: ReplayPreflightContext<TConfig>,
    ): Promise<void> {
        let result: ReplayPreflightResult;
        try {
            result = await this._host.preflight!(context);
        } catch (error) {
            result = {
                ok: false,
                blockedReason: `preflight failed: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
        if (this._host.isDisposed()) {
            return;
        }
        const current = this._state.runs.find((item) => item.id === run.id);
        if (!current || current.status !== "queued") {
            // Cancelled (or otherwise settled) while preflighting: drop rows.
            for (const row of queueRows) {
                this._itemCancellations.delete(row.id);
            }
            return;
        }
        if (!result.ok) {
            for (const row of queueRows) {
                this._itemCancellations.delete(row.id);
            }
            const refused: FeatureReplayRun<TCell> = {
                ...current,
                status: "failed",
                completedAt: Date.now(),
                errorMessage: result.blockedReason ?? "preflight refused the run",
            };
            this.updateState({
                ...this._state,
                runs: this._state.runs.map((item) => (item.id === run.id ? refused : item)),
            });
            this.settleRunSpan(run.id, "refused");
            this.notifyRunUpdated(refused);
            return;
        }
        this.commitQueuedRun(current, queueRows, plannedItems, true);
    }

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

    private createPlannedRow(
        snapshot: FeatureReplaySnapshot<TEvent, TConfig>,
        run: FeatureReplayRun<TCell>,
        position: number,
        total: number,
        matrixCell: TCell | undefined,
        configMode?: FeatureReplayConfigMode,
    ): {
        row: FeatureReplayQueueRow<TEvent, TConfig>;
        item: FeatureReplayPlannedItem<TEvent, TConfig>;
    } {
        const replayItemId = newReplayItemId();
        const config = matrixCell
            ? this._host.resolveMatrixCellConfig(matrixCell)
            : this.resolveSnapshotConfig(snapshot, configMode);
        const configDigest = safeConfigDigest(config);
        const queuedAt = Date.now();
        this._itemCancellations.set(replayItemId, new ReplayCancellationSource());
        const row: FeatureReplayQueueRow<TEvent, TConfig> = {
            id: replayItemId,
            runId: run.id,
            traceId: run.traceId,
            snapshotId: snapshot.id,
            sourceEventId: snapshot.sourceEventId,
            position,
            total,
            status: "queued",
            queuedAt,
            config,
            configDigest,
            repetition: 1,
            matrixCellId: matrixCell?.cellId,
            matrixCellLabel: matrixCell ? this._host.formatCellLabel(matrixCell) : undefined,
            event: this._host.createQueuedEvent(snapshot, config, run, position, total, matrixCell),
        };
        const item: FeatureReplayPlannedItem<TEvent, TConfig> = {
            replayItemId,
            runId: run.id,
            sourceEventId: snapshot.sourceEventId,
            sourceLabel: snapshot.sourceLabel,
            sourceEvent: snapshot.event,
            position,
            repetition: 1,
            config,
            configDigest,
            ...(matrixCell ? { matrixCellId: matrixCell.cellId } : {}),
            ...(matrixCell ? { matrixCellLabel: this._host.formatCellLabel(matrixCell) } : {}),
            queuedAt,
        };
        return { row, item };
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
                    this._itemCancellations.delete(nextRow.id);
                    this.updateState({
                        ...this._state,
                        queueRows: this._state.queueRows.slice(1),
                    });
                    continue;
                }

                const startedAt = Date.now();
                let runningRun: FeatureReplayRun<TCell> | undefined;
                const runWasQueued = run.status === "queued";
                this.updateState({
                    ...this._state,
                    activeRunId: run.id,
                    runs: this._state.runs.map((item) =>
                        item.id === run.id
                            ? (runningRun = {
                                  ...item,
                                  status:
                                      item.status === "cancelled" || item.status === "cancelling"
                                          ? item.status
                                          : "running",
                                  activeMatrixCellId: nextRow.matrixCellId,
                              })
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
                if (runWasQueued && runningRun && runningRun.status === "running") {
                    this.notifyRunUpdated(runningRun);
                }

                const cancellation =
                    this._itemCancellations.get(nextRow.id) ?? new ReplayCancellationSource();
                const tags = createReplayTags(nextRow);
                const itemSpan = diag.startSpan({
                    feature: this._host.feature,
                    kind: "span",
                    type: "replay.item",
                    fields: {
                        replayTraceId: { raw: tags.replayTraceId, cls: "diagnostic.metadata" },
                        replayRunId: { raw: tags.replayRunId, cls: "diagnostic.metadata" },
                        replayItemId: { raw: nextRow.id, cls: "diagnostic.metadata" },
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
                let outcomeInfo: ItemOutcomeInfo;
                try {
                    const result = (await this._host.execute(
                        nextRow.event,
                        nextRow.config,
                        tags,
                        cancellation.token,
                    )) as FeatureReplayExecuteResult | undefined;
                    const cancellationOutcome: ReplayCancellationOutcome | undefined =
                        result?.cancellationOutcome ??
                        (cancellation.isCancellationRequested
                            ? "cancelRequestedButCompleted"
                            : undefined);
                    outcomeInfo = {
                        status:
                            cancellationOutcome === "cancelledInFlight" ? "cancelled" : "completed",
                        ...(cancellationOutcome ? { cancellationOutcome } : {}),
                        ...(result?.resultEventId ? { resultEventId: result.resultEventId } : {}),
                        ...(result?.resultCaptureEventId
                            ? { resultCaptureEventId: result.resultCaptureEventId }
                            : {}),
                        endedAt: Date.now(),
                        startedAt,
                    };
                    itemSpan.end("ok");
                } catch (error) {
                    // A throwing executor must not wedge the drain loop; the
                    // feature records its own error event for the row.
                    const cancelled = cancellation.isCancellationRequested;
                    outcomeInfo = {
                        status: cancelled ? "cancelled" : "failed",
                        ...(cancelled ? { cancellationOutcome: "cancelledInFlight" as const } : {}),
                        ...(error instanceof Error && error.name ? { errorCode: error.name } : {}),
                        errorMessage: error instanceof Error ? error.message : String(error),
                        endedAt: Date.now(),
                        startedAt,
                    };
                    itemSpan.fail(error);
                }

                this._itemCancellations.delete(nextRow.id);
                this.completeQueueRow(nextRow, outcomeInfo);
            }
        } finally {
            this._drainActive = false;
            if (!this._host.isDisposed() && this._state.queueRows.length > 0) {
                this.startDrain();
            }
        }
    }

    private completeQueueRow(
        row: FeatureReplayQueueRow<TEvent, TConfig>,
        outcomeInfo: ItemOutcomeInfo,
    ): void {
        const currentRun = this._state.runs.find((run) => run.id === row.runId);
        // A run dispose() already settled as partial/failed stays settled —
        // a late-settling execute must not resurrect it.
        const runAlreadySettled =
            currentRun !== undefined &&
            (currentRun.status === "partial" || currentRun.status === "failed");
        const completedEvents = (currentRun?.completedEvents ?? 0) + 1;
        const remainingRows = this._state.queueRows.filter((item) => item.id !== row.id);
        const runHasQueuedRows = remainingRows.some((item) => item.runId === row.runId);
        let settledStatus: "cancelled" | "completed" | undefined;
        let updatedRun: FeatureReplayRun<TCell> | undefined;
        const updatedRuns = this._state.runs.map((run) => {
            if (run.id !== row.runId || runAlreadySettled) {
                return run;
            }

            const status: FeatureReplayRunStatus =
                run.status === "cancelled" || run.status === "cancelling"
                    ? "cancelled"
                    : runHasQueuedRows
                      ? "running"
                      : "completed";
            if (!runHasQueuedRows && (status === "cancelled" || status === "completed")) {
                settledStatus = status;
            }
            updatedRun = {
                ...run,
                completedEvents,
                status,
                activeMatrixCellId: runHasQueuedRows ? run.activeMatrixCellId : undefined,
                completedAt: runHasQueuedRows ? run.completedAt : Date.now(),
            };
            return updatedRun;
        });

        this.updateState({
            ...this._state,
            queueRows: remainingRows,
            runs: updatedRuns,
            activeRunId: remainingRows[0]?.runId,
        });
        if (updatedRun) {
            this.notifyItemSettled(row, updatedRun, outcomeInfo);
            this.notifyRunUpdated(updatedRun);
        }
        if (settledStatus) {
            this.settleRunSpan(row.runId, settledStatus);
        }
    }

    private notifyItemSettled(
        row: FeatureReplayQueueRow<TEvent, TConfig>,
        run: FeatureReplayRun<TCell>,
        info: ItemOutcomeInfo,
    ): void {
        const outcome: FeatureReplayItemOutcome = {
            replayItemId: row.id,
            runId: row.runId,
            sourceEventId: row.sourceEventId,
            ...(row.matrixCellId ? { matrixCellId: row.matrixCellId } : {}),
            repetition: row.repetition ?? 1,
            queuedAt: row.queuedAt,
            ...(info.startedAt !== undefined
                ? { startedAt: info.startedAt }
                : row.startedAt !== undefined
                  ? { startedAt: row.startedAt }
                  : {}),
            endedAt: info.endedAt,
            configDigest: row.configDigest ?? "",
            status: info.status,
            ...(info.cancellationOutcome ? { cancellationOutcome: info.cancellationOutcome } : {}),
            ...(info.resultEventId ? { resultEventId: info.resultEventId } : {}),
            ...(info.resultCaptureEventId
                ? { resultCaptureEventId: info.resultCaptureEventId }
                : {}),
            ...(info.errorCode ? { errorCode: info.errorCode } : {}),
            ...(info.errorMessage ? { errorMessage: info.errorMessage } : {}),
            attempt: 1,
        };
        this.notifyObserver((observer) => observer.onItemSettled?.(outcome, run));
    }

    private notifyRunUpdated(run: FeatureReplayRun<TCell>): void {
        this.notifyObserver((observer) => observer.onRunUpdated?.(run));
    }

    /** Observer failures are contained: persistence never breaks a run. */
    private notifyObserver(
        callback: (observer: FeatureReplayRunObserver<TEvent, TConfig, TCell>) => void,
    ): void {
        if (!this._observer) {
            return;
        }
        try {
            callback(this._observer);
        } catch {
            // repository/observer failure never affects the run (§2.3)
        }
    }

    private settleRunSpan(
        runId: string,
        outcome: "completed" | "cancelled" | "disposed" | "refused",
    ): void {
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

interface ItemOutcomeInfo {
    status: FeatureReplayItemStatus;
    endedAt: number;
    startedAt?: number;
    cancellationOutcome?: ReplayCancellationOutcome;
    resultEventId?: string;
    resultCaptureEventId?: string;
    errorCode?: string;
    errorMessage?: string;
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

/** Config digests must never break queueing — a digest failure is recorded as "". */
function safeConfigDigest(config: unknown): string {
    try {
        return sha256OfCanonicalJson(config);
    } catch {
        return "";
    }
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}
