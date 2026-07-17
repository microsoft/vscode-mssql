/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio SAFE replay adapter (WI-3.6 / addendum §7.8 — NORMATIVE).
 * The FeatureReplayHost the Query Studio replay surfaces run on, extracted
 * from the panel controller so the safety contract is testable against fake
 * execution hosts:
 *
 * - §7.8.1 execution classification (qsReplaySafety.ts) gates every run:
 *   parse-only and estimated-plan replay only; normal/actualPlan stays
 *   behind the WI-3.7 code gate (`QS_MUTATING_REPLAY_GATE`, CLOSED);
 * - §7.8.2 exact target binding: an item replays ONLY against a live
 *   document whose session's server\database fingerprint matches the
 *   record's captured `profileFingerprint` (same salted digest path), or an
 *   EXPLICIT user target selection — NEVER the first connected document
 *   (§2.2.5: no silent target substitution; no candidate → `blocked`);
 * - §7.8.3 confirmation: readOnlyExpected runs pass a host-side modal (the
 *   injected dialog seam) that names target and item count before queueing;
 * - §7.8.4 cancellation: the engine's item token is wired to the execution
 *   host's REAL cancel path (`ExecutionHost.cancel()` →
 *   `ExecutionOrchestrator.requestCancel()` → the data-plane QueryHandle's
 *   cancel), and `cancelledInFlight` is reported only when the run's
 *   terminal state proves the cancel landed.
 */

import { diag } from "../../diagnostics/diagnosticsCore";
import {
    FeatureReplayHost,
    FeatureReplayPlannedItem,
    FeatureReplayRunObserver,
} from "../../diagnostics/featureCapture/replayEngine";
import { ReplayRunRepository } from "../../diagnostics/featureCapture/replayRunRepository";
import { logger2 } from "../../models/logger2";
import {
    FeatureReplayCancellationToken,
    FeatureReplayExecuteResult,
    FeatureReplaySnapshot,
    FeatureReplayTags,
} from "../../sharedInterfaces/featureReplay";
import {
    QsReplayConfig,
    QsReplayMatrixCell,
    QsRunRecord,
} from "../../sharedInterfaces/queryStudioReplay";
import {
    ReplayCancellationOutcome,
    ReplayEstimate,
    ReplayPreflightContext,
    ReplayTargetRef,
} from "../../sharedInterfaces/replaySafety";
import { queryTuningParamsToOverrides } from "../../sharedInterfaces/queryTuning";
import { computeQsProfileFingerprint } from "./qsRunCapture";
import { createQsReplayConfigGroup, formatQsConfigGroupLabel } from "./qsReplayConfigGroups";
import {
    classifyQsReplayExecution,
    classifyQsReplaySafety,
    QS_MUTATING_REPLAY_BLOCKED_REASON,
    QS_MUTATING_REPLAY_GATE,
    QS_NO_TARGET_BLOCKED_REASON,
    QS_TEXTLESS_BLOCKED_REASON,
    QsReplayExecutionClass,
} from "./qsReplaySafety";

const adapterLogger = logger2.withPrefix("QueryStudioReplay");

// ---------------------------------------------------------------------------
// Target surface (structural subset of QueryStudioDocumentModel)
// ---------------------------------------------------------------------------

/** The execution-host slice replay needs; ExecutionHost satisfies it. */
export interface QsReplayExecutionHostLike {
    executionState: { kind: string };
    execute(
        text: string,
        options: {
            selectionStartLine: number;
            scope: "selection" | "document";
            mode?: "normal" | "parseOnly" | "estimatedPlan" | "actualPlan";
            tuningOverrides?: NonNullable<QsReplayConfig["tuning"]>;
            replayTags?: FeatureReplayTags;
        },
    ): { started: boolean; reason?: string };
    setDatabase(database: string): Promise<boolean>;
    cancel(): Promise<{ acknowledged: boolean }>;
    attach(listener: {
        onResultSetStarted(summary: never): void;
        onRowsAppended(resultSetId: string, newRowCount: number, complete: boolean): void;
        onResultSetEnded(resultSetId: string, rowCount: number, truncatedReason?: string): void;
        onMessages(messages: never): void;
        onExecutionStateChanged(): void;
    }): { dispose(): void };
}

/** Structural subset of QueryStudioDocumentModel the adapter binds to. */
export interface QsReplayTargetModel {
    readonly uriKey: string;
    readonly backingDocument?: { fileName: string };
    readonly sessionBinding: {
        readonly activeSession?: { readonly info: object } | undefined;
    };
    readonly executionHost: QsReplayExecutionHostLike;
}

function targetLabel(model: QsReplayTargetModel): string {
    const fileName = model.backingDocument?.fileName ?? model.uriKey;
    const separator = Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\"));
    return separator >= 0 ? fileName.slice(separator + 1) : fileName;
}

function sessionIdentity(
    model: QsReplayTargetModel,
): { server?: string; database?: string } | undefined {
    // SessionInfo carries backend-dependent identity fields; the capture path
    // reads the same shape (executionHost.ts), keeping derivation identical.
    return model.sessionBinding.activeSession?.info as
        | { server?: string; database?: string }
        | undefined;
}

/** Live session fingerprint — SAME salted digest path as capture (§7.8.2). */
export function liveTargetFingerprint(model: QsReplayTargetModel): string | undefined {
    const identity = sessionIdentity(model);
    if (!identity) {
        return undefined;
    }
    return computeQsProfileFingerprint(identity.server, identity.database);
}

export type QsReplayTargetBindingKind = "fingerprintMatch" | "explicitSelection";

export interface QsReplayTargetResolution {
    model: QsReplayTargetModel;
    targetRef: ReplayTargetRef;
    binding: QsReplayTargetBindingKind;
}

/**
 * §7.8.2 exact target binding. Resolution order:
 * 1. a live document whose session fingerprint MATCHES the record's captured
 *    `profileFingerprint` (among multiple matches, the one that is also the
 *    record's original document wins);
 * 2. the user's EXPLICIT target selection (recorded on the run);
 * 3. nothing — `undefined`. There is deliberately no "first live document"
 *    fallback (honesty invariant §2.2 #5).
 */
export function resolveQsReplayTarget(
    record: Pick<QsRunRecord, "profileFingerprint" | "documentUriDigest">,
    models: readonly QsReplayTargetModel[],
    explicitTargetUriKey: string | undefined,
): QsReplayTargetResolution | undefined {
    if (record.profileFingerprint) {
        const matches = models.filter(
            (model) => liveTargetFingerprint(model) === record.profileFingerprint,
        );
        if (matches.length > 0) {
            const model = matches[0]!;
            return {
                model,
                targetRef: {
                    kind: "qsDocument",
                    fingerprint: record.profileFingerprint,
                    label: targetLabel(model),
                },
                binding: "fingerprintMatch",
            };
        }
    }
    if (explicitTargetUriKey !== undefined) {
        const model = models.find((candidate) => candidate.uriKey === explicitTargetUriKey);
        if (model) {
            return {
                model,
                targetRef: {
                    kind: "qsDocument",
                    fingerprint: liveTargetFingerprint(model) ?? "unbound",
                    label: targetLabel(model),
                },
                binding: "explicitSelection",
            };
        }
    }
    return undefined;
}

/** ReplayTargetRef for an explicitly selected live document (run provenance). */
export function explicitQsTargetRef(
    models: readonly QsReplayTargetModel[],
    explicitTargetUriKey: string | undefined,
): ReplayTargetRef | undefined {
    if (explicitTargetUriKey === undefined) {
        return undefined;
    }
    const model = models.find((candidate) => candidate.uriKey === explicitTargetUriKey);
    if (!model) {
        return undefined;
    }
    return {
        kind: "qsDocument",
        fingerprint: liveTargetFingerprint(model) ?? "unbound",
        label: targetLabel(model),
    };
}

// ---------------------------------------------------------------------------
// The replay host
// ---------------------------------------------------------------------------

export interface QsReplayHostDeps {
    /** Live Query Studio documents (the standalone panel's model registry). */
    listTargets(): readonly QsReplayTargetModel[];
    /** The user's explicit replay-target selection, when one is set. */
    getSelectedTargetUriKey(): string | undefined;
    /**
     * §7.8.3 dialog seam: a host-side MODAL shown before a readOnlyExpected
     * run queues. The message already names target and item count; resolve
     * true to proceed. Injected so tests never touch vscode UI.
     */
    confirmReadOnlyRun(message: string): Promise<boolean>;
    /** The feature's current toolbar overrides (frozen at queue time). */
    getLiveOverrides(): QsReplayConfig;
    /** Per-item execution failure surface (panel `lastError`). */
    onExecuteError?(message: string): void;
    onStateChanged(): void;
    isDisposed(): boolean;
}

type QsPreflightPair = { sourceEvent: QsRunRecord; config: QsReplayConfig };

function preflightPairs(context: ReplayPreflightContext<QsReplayConfig>): QsPreflightPair[] {
    return (context.pairs ?? []) as QsPreflightPair[];
}

function pairClasses(pairs: readonly QsPreflightPair[]): QsReplayExecutionClass[] {
    return pairs.map((pair) => classifyQsReplayExecution(pair.sourceEvent, pair.config));
}

/** Unique resolved-target labels for a set of records ("" when unresolved). */
function describeTargets(
    records: readonly Pick<QsRunRecord, "profileFingerprint" | "documentUriDigest">[],
    deps: QsReplayHostDeps,
): { labels: string[]; unresolved: number } {
    const labels = new Set<string>();
    let unresolved = 0;
    const models = deps.listTargets();
    const explicit = deps.getSelectedTargetUriKey();
    for (const record of records) {
        const resolution = resolveQsReplayTarget(record, models, explicit);
        if (resolution) {
            labels.add(resolution.targetRef.label);
        } else {
            unresolved++;
        }
    }
    return { labels: [...labels], unresolved };
}

export function createQsReplayHost(
    deps: QsReplayHostDeps,
): FeatureReplayHost<QsRunRecord, QsReplayConfig, QsReplayMatrixCell> {
    return {
        feature: "queryStudio",
        isRunnable: (record) => record.result !== "pending" && record.result !== "queued",
        captureConfig: (record) => ({
            database: record.database ?? null,
            mode: record.mode,
            stopOnError: null,
            // Snapshot mode replays with the CAPTURED tuning params (QO-1)
            // so a faithful replay reproduces the run's parameter set.
            tuning: record.tuning ? queryTuningParamsToOverrides(record.tuning) : null,
        }),
        resolveLiveConfig: () => deps.getLiveOverrides(),
        compactConfig: (config) => ({
            database: config.database ?? null,
            mode: config.mode ?? null,
            stopOnError: config.stopOnError ?? null,
            tuning: config.tuning ?? null,
        }),
        compactPartialConfig: (partial) => ({ ...(partial ?? {}) }),
        resolveMatrixCellConfig: (cell) => ({
            ...deps.getLiveOverrides(),
            database: cell.database ?? null,
            mode: cell.mode ?? null,
            // Tuning axis for parameter-sweep experiments (QO-1).
            ...(cell.tuning ? { tuning: cell.tuning } : {}),
        }),
        formatCellLabel: (cell) => cell.label,
        formatSourceLabel: (record) =>
            `${record.database ?? "unknown db"} · ${new Date(record.timestamp).toLocaleTimeString()}`,
        createQueuedEvent: (snapshot) => ({
            ...snapshot.event,
            result: "queued",
        }),
        markEventRunning: (record, startedAt) => ({
            ...record,
            timestamp: startedAt,
            result: "pending",
        }),
        execute: (record, config, tags, cancellation) =>
            executeQsReplayItem(record, config, tags, cancellation, deps),
        // §7.5 pre-queue estimate: sources × cells, with §7.8 warnings.
        estimate: (sources, cells, repetitions) =>
            estimateQsReplayRun(sources, cells, repetitions ?? 1, deps),
        // §7.8 adapter safety classification, recorded on the run/manifest.
        classifySafety: (context) => classifyQsReplaySafety(pairClasses(preflightPairs(context))),
        // §7.8 gates, evaluated before any item queues.
        preflight: async (context) => {
            const pairs = preflightPairs(context);
            if (pairs.length === 0) {
                return {
                    ok: false,
                    blockedReason: "nothing to classify — the planned run carried no items",
                };
            }
            const classes = pairClasses(pairs);
            // WI-3.7 gate: potentially mutating replay stays CLOSED.
            if (!QS_MUTATING_REPLAY_GATE && classes.includes("potentiallyMutating")) {
                return { ok: false, blockedReason: QS_MUTATING_REPLAY_BLOCKED_REASON };
            }
            // Digest-only captures cannot re-execute (honest refusal).
            if (pairs.some((pair) => !pair.sourceEvent.scriptText)) {
                return { ok: false, blockedReason: QS_TEXTLESS_BLOCKED_REASON };
            }
            // §7.8.2: every record must bind a target NOW (and again per item).
            const uniqueRecords = [
                ...new Map(pairs.map((p) => [p.sourceEvent.id, p.sourceEvent])),
            ].map(([, record]) => record);
            const targets = describeTargets(uniqueRecords, deps);
            if (targets.unresolved > 0) {
                return { ok: false, blockedReason: QS_NO_TARGET_BLOCKED_REASON };
            }
            // §7.8.3: readOnlyExpected requires a confirmation naming target
            // and item count (noExecution-only runs queue without one).
            if (classes.includes("readOnlyExpected")) {
                const targetSummary = targets.labels.join(", ");
                const confirmed = await deps.confirmReadOnlyRun(
                    `Replay ${pairs.length} estimated-plan item${pairs.length === 1 ? "" : "s"} ` +
                        `against ${targetSummary}? Estimated-plan requests execute against the ` +
                        `live connection.`,
                );
                if (!confirmed) {
                    return {
                        ok: false,
                        blockedReason: "estimated-plan replay declined at the confirmation prompt",
                    };
                }
            }
            return { ok: true };
        },
        onStateChanged: () => deps.onStateChanged(),
        isDisposed: () => deps.isDisposed(),
    };
}

// ---------------------------------------------------------------------------
// Estimation (§7.5 + §7.8 warnings)
// ---------------------------------------------------------------------------

function estimateEffectiveMode(
    snapshot: FeatureReplaySnapshot<QsRunRecord, QsReplayConfig>,
    cell: QsReplayMatrixCell | undefined,
    liveConfig: QsReplayConfig,
): QsRunRecord["mode"] {
    if (cell) {
        return cell.mode ?? snapshot.event.mode;
    }
    if (snapshot.configMode === "live") {
        return liveConfig.mode ?? snapshot.event.mode;
    }
    const overrideMode = snapshot.configMode === "override" ? snapshot.override?.mode : undefined;
    return overrideMode ?? snapshot.capturedConfig.mode ?? snapshot.event.mode;
}

function estimateQsReplayRun(
    sources: FeatureReplaySnapshot<QsRunRecord, QsReplayConfig>[],
    cells: QsReplayMatrixCell[],
    repetitions: number,
    deps: QsReplayHostDeps,
): ReplayEstimate {
    const cellCount = Math.max(cells.length, 1);
    const totalExecutions = sources.length * cellCount * repetitions;
    const cellAxis: Array<QsReplayMatrixCell | undefined> = cells.length > 0 ? cells : [undefined];
    const liveConfig = deps.getLiveOverrides();
    const classes = new Set<QsReplayExecutionClass>();
    for (const source of sources) {
        for (const cell of cellAxis) {
            classes.add(
                classifyQsReplayExecution(
                    { mode: estimateEffectiveMode(source, cell, liveConfig) },
                    { mode: null },
                ),
            );
        }
    }
    const warnings: string[] = [];
    if (classes.has("readOnlyExpected")) {
        const targets = describeTargets(
            sources.map((source) => source.event),
            deps,
        );
        const summary =
            targets.labels.length > 0
                ? targets.labels.join(", ")
                : "no matching target (explicit selection required)";
        warnings.push(`Executes estimated-plan requests against ${summary}.`);
    }
    if (classes.has("potentiallyMutating") && !QS_MUTATING_REPLAY_GATE) {
        warnings.push(QS_MUTATING_REPLAY_BLOCKED_REASON);
    }
    const textless = sources.filter((source) => !source.event.scriptText).length;
    if (textless > 0) {
        warnings.push(
            `${textless} record${textless === 1 ? "" : "s"} captured without SQL text will be refused.`,
        );
    }
    return {
        sourceItems: sources.length,
        matrixCells: cells.length,
        repetitions,
        totalExecutions,
        warnings,
    };
}

// ---------------------------------------------------------------------------
// Item execution (§7.8.2 binding + §7.8.4 cancellation)
// ---------------------------------------------------------------------------

async function executeQsReplayItem(
    record: QsRunRecord,
    config: QsReplayConfig,
    tags: FeatureReplayTags,
    cancellation: FeatureReplayCancellationToken,
    deps: QsReplayHostDeps,
): Promise<FeatureReplayExecuteResult> {
    const effectiveMode = config.mode ?? record.mode;
    // Defense in depth: preflight already gates the run, and every item
    // re-checks so nothing mutating can slip through a mixed queue.
    if (
        !QS_MUTATING_REPLAY_GATE &&
        classifyQsReplayExecution(record, config) === "potentiallyMutating"
    ) {
        return { blockedReason: QS_MUTATING_REPLAY_BLOCKED_REASON, replayMode: effectiveMode };
    }
    if (!record.scriptText) {
        return { blockedReason: QS_TEXTLESS_BLOCKED_REASON, replayMode: effectiveMode };
    }
    const resolution = resolveQsReplayTarget(
        record,
        deps.listTargets(),
        deps.getSelectedTargetUriKey(),
    );
    if (!resolution) {
        // §2.2.5: no silent substitution — the item is blocked, honestly.
        return { blockedReason: QS_NO_TARGET_BLOCKED_REASON, replayMode: effectiveMode };
    }
    const { model, targetRef } = resolution;
    if (!model.sessionBinding.activeSession) {
        return {
            blockedReason: `replay target ${targetRef.label} is not connected`,
            replayMode: effectiveMode,
            target: targetRef,
        };
    }

    try {
        const currentDatabase = sessionIdentity(model)?.database ?? record.database;
        if (config.database && config.database !== currentDatabase) {
            // Explicit database override (user-chosen row override or matrix
            // axis) — an explicit selection, recorded on the item below.
            const changed = await model.executionHost.setDatabase(config.database);
            if (!changed) {
                throw new Error(`could not switch replay database to ${config.database}`);
            }
        }
        const targetDatabase = config.database ?? currentDatabase;
        const outcome = model.executionHost.execute(record.scriptText, {
            selectionStartLine: 0,
            scope: record.scope,
            mode: effectiveMode,
            ...(config.tuning ? { tuningOverrides: config.tuning } : {}),
            replayTags: tags,
        });
        if (!outcome.started) {
            throw new Error(outcome.reason ?? "replay execution refused");
        }
        // §7.8.4: the engine's token drives the execution host's REAL cancel
        // path; the acknowledgment promise settles when the backend answers.
        let cancelAck: Promise<{ acknowledged: boolean }> | undefined;
        const cancelSubscription = cancellation.onCancellationRequested(() => {
            cancelAck = model.executionHost.cancel();
        });
        try {
            await waitForQsRunCompletion(model);
        } finally {
            cancelSubscription.dispose();
        }
        let cancellationOutcome: ReplayCancellationOutcome | undefined;
        if (cancellation.isCancellationRequested) {
            // Await the acknowledgment, then report from the TERMINAL state:
            // `cancelledInFlight` only when the run actually ended canceled;
            // a run that completed anyway is `cancelRequestedButCompleted`.
            if (cancelAck) {
                await cancelAck.catch(() => ({ acknowledged: false }));
            }
            cancellationOutcome =
                model.executionHost.executionState.kind === "canceled"
                    ? "cancelledInFlight"
                    : "cancelRequestedButCompleted";
        }
        return {
            replayMode: effectiveMode,
            target: targetRef,
            ...(targetDatabase ? { targetDatabase } : {}),
            ...(cancellationOutcome ? { cancellationOutcome } : {}),
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const surfaced = `Replay of ${record.id} failed: ${message}`;
        deps.onExecuteError?.(surfaced);
        adapterLogger.warn(surfaced);
        diag.emit({
            feature: "queryStudio",
            kind: "event",
            type: "queryStudio.runRecord.captured",
            status: "warning",
            fields: {
                batches: { raw: record.batches.length, cls: "diagnostic.metadata" },
                elevated: { raw: record.elevated, cls: "diagnostic.metadata" },
                replay: { raw: true, cls: "diagnostic.metadata" },
                refused: { raw: true, cls: "diagnostic.metadata" },
            },
        });
        throw error;
    }
}

/** Resolve when the target's execution state leaves executing/cancelRequested. */
function waitForQsRunCompletion(model: QsReplayTargetModel): Promise<void> {
    return new Promise<void>((resolve) => {
        const settled = () => {
            const kind = model.executionHost.executionState.kind;
            return kind !== "executing" && kind !== "cancelRequested";
        };
        if (settled()) {
            resolve();
            return;
        }
        const subscription = model.executionHost.attach({
            onResultSetStarted: () => undefined,
            onRowsAppended: () => undefined,
            onResultSetEnded: () => undefined,
            onMessages: () => undefined,
            onExecutionStateChanged: () => {
                if (settled()) {
                    subscription.dispose();
                    resolve();
                }
            },
        });
    });
}

// ---------------------------------------------------------------------------
// Durable-run observer (WI-3.6 Lab integration; mirrors the completions one)
// ---------------------------------------------------------------------------

export interface QsReplayRunObserverHooks {
    /** Flip the engine-side `durable` flag once the manifest landed. */
    setRunDurable(runId: string, durable: boolean): void;
    isDisposed(): boolean;
    /** Explicit target selection at queue time — recorded on the run (§7.8.2). */
    getExplicitTarget(): ReplayTargetRef | undefined;
}

interface QsRunPersistLookup {
    sourceCaptureIds: Map<string, string>;
    groupIdsByDigest: Map<string, string>;
}

/**
 * Forwards run/item lifecycle into the durable replay-run repository.
 * Fire-and-forget and failure-isolated: persistence never affects a run.
 */
export function createQsReplayRunObserver(
    repository: ReplayRunRepository,
    hooks: QsReplayRunObserverHooks,
): FeatureReplayRunObserver<QsRunRecord, QsReplayConfig, QsReplayMatrixCell> {
    const lookups = new Map<string, QsRunPersistLookup>();
    return {
        onRunQueued: (run, items) => {
            const lookup: QsRunPersistLookup = {
                sourceCaptureIds: new Map(),
                groupIdsByDigest: new Map(),
            };
            const configGroups = new Map<string, ReturnType<typeof createQsReplayConfigGroup>>();
            const cellGroupIds = new Map<string, string>();
            const sources = new Map<
                string,
                {
                    captureSessionId?: string;
                    captureEventId: string;
                    label: string;
                    snapshotJson: unknown;
                }
            >();
            for (const item of items as FeatureReplayPlannedItem<QsRunRecord, QsReplayConfig>[]) {
                if (!configGroups.has(item.configDigest)) {
                    configGroups.set(
                        item.configDigest,
                        createQsReplayConfigGroup(
                            item.config,
                            item.matrixCellLabel ?? formatQsConfigGroupLabel(item.config),
                        ),
                    );
                }
                const group = configGroups.get(item.configDigest)!;
                lookup.groupIdsByDigest.set(item.configDigest, group.configGroupId);
                if (item.matrixCellId && !cellGroupIds.has(item.matrixCellId)) {
                    cellGroupIds.set(item.matrixCellId, group.configGroupId);
                }
                if (!sources.has(item.sourceEventId)) {
                    const captureEventId =
                        item.sourceEvent.link?.captureEventId ?? item.sourceEventId;
                    sources.set(item.sourceEventId, {
                        ...(item.sourceEvent.link?.captureSessionId
                            ? { captureSessionId: item.sourceEvent.link.captureSessionId }
                            : {}),
                        captureEventId,
                        label: item.sourceLabel,
                        snapshotJson: item.sourceEvent,
                    });
                    lookup.sourceCaptureIds.set(item.sourceEventId, captureEventId);
                }
            }
            lookups.set(run.id, lookup);
            const explicitTarget = hooks.getExplicitTarget();
            void repository
                .beginRun({
                    replayRunId: run.id,
                    createdAt: run.startedAt,
                    sources: [...sources.values()],
                    configGroups: [...configGroups.values()],
                    cells: (run.matrixCells ?? []).map((cell) => ({
                        matrixCellId: cell.cellId,
                        configGroupId: cellGroupIds.get(cell.cellId) ?? "",
                        label: cell.label,
                        ordinal: cell.ordinal,
                    })),
                    repetitions: 1,
                    expectedItems: run.totalEvents,
                    ...(run.estimate ? { estimate: run.estimate } : {}),
                    ...(run.safety ? { safety: run.safety } : {}),
                    // §7.8.2: an explicit user target selection is recorded
                    // on the run, next to the per-item target refs.
                    ...(explicitTarget ? { provenance: { explicitTarget } } : {}),
                })
                .then((durable) => {
                    if (durable && !hooks.isDisposed()) {
                        hooks.setRunDurable(run.id, true);
                    }
                });
        },
        onRunUpdated: (run) => {
            repository.noteRunStatus({ replayRunId: run.id, status: run.status });
            if (
                run.status === "completed" ||
                run.status === "cancelled" ||
                run.status === "partial" ||
                run.status === "failed"
            ) {
                lookups.delete(run.id);
            }
        },
        onItemSettled: (outcome) => {
            const lookup = lookups.get(outcome.runId);
            repository.recordItem(outcome.runId, {
                replayItemId: outcome.replayItemId,
                sourceCaptureEventId:
                    lookup?.sourceCaptureIds.get(outcome.sourceEventId) ?? outcome.sourceEventId,
                ...(outcome.matrixCellId ? { matrixCellId: outcome.matrixCellId } : {}),
                ...(lookup?.groupIdsByDigest.has(outcome.configDigest)
                    ? { configGroupId: lookup.groupIdsByDigest.get(outcome.configDigest)! }
                    : {}),
                repetition: outcome.repetition,
                queuedAt: outcome.queuedAt,
                ...(outcome.startedAt !== undefined ? { startedAt: outcome.startedAt } : {}),
                endedAt: outcome.endedAt,
                resolvedConfigDigest: outcome.configDigest,
                status: outcome.status,
                ...(outcome.resultCaptureEventId
                    ? { resultCaptureEventId: outcome.resultCaptureEventId }
                    : {}),
                ...(outcome.resultEventId ? { resultEventId: outcome.resultEventId } : {}),
                ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
                ...(outcome.errorMessage ? { errorMessage: outcome.errorMessage } : {}),
                ...(outcome.cancellationOutcome
                    ? { cancellationOutcome: outcome.cancellationOutcome }
                    : {}),
                ...(outcome.replayMode ? { replayMode: outcome.replayMode } : {}),
                // §7.8.2: fingerprint + database recorded on each item.
                ...(outcome.target ? { target: outcome.target } : {}),
                ...(outcome.targetDatabase ? { targetDatabase: outcome.targetDatabase } : {}),
                attempt: outcome.attempt,
            });
        },
    };
}
