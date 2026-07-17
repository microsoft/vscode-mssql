/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Durable replay run repository (final plan WI-3.3 / addendum §7.3). A replay
 * run is evidence, not only transient UI state: each run persists under
 * `<storeRoot>/sessions/<hostSessionId>/replay/<replayRunId>/` as
 *
 * - `manifest.json` — `ReplayRunManifestV1` (`mssql.replay.run/1`), updated
 *   via temp-file + atomic rename on state transitions (debounced; terminal
 *   transitions flush immediately);
 * - `items.jsonl` — one line per item terminal (§7.3 per-item record);
 * - `configGroups.json` — the FULL frozen `ConfigGroupV1` definitions (§7.6:
 *   profile labels and definitions are frozen into the run; the manifest
 *   carries the normative ref subset).
 *
 * The repository is failure-isolated end to end (§2.3): every write rides a
 * serialized per-run promise chain, failures degrade the repository and are
 * counted, and nothing ever throws into the replay engine or the product.
 * The bundle catalog is notified through the same narrow registrar seam the
 * capture journal uses; run manifests are metadata-only (result events live
 * in the rich journal), so descriptors claim `containsRichPayload: false`.
 */

import { logger2 } from "../../models/logger2";
import { ConfigGroupV1 } from "../../sharedInterfaces/configGroup";
import {
    ReplayActualCost,
    ReplayCancellationOutcome,
    ReplayEstimate,
    ReplayProvenance,
    ReplaySafetyAssessment,
} from "../../sharedInterfaces/replaySafety";
import {
    ObservabilityArtifactDescriptorInputV1,
    ObservabilityArtifactPatchV1,
} from "../sessionBundle/bundleManager";
import { sha256OfCanonicalJson } from "./configGroups";
import { JournalClock, JournalFsLike, NodeJournalFs, joinPath } from "./journal/journalWriter";

// ---------------------------------------------------------------------------
// Contracts (addendum §7.3 — normative)
// ---------------------------------------------------------------------------

/** Frozen schema id (final plan §1.4). */
export const REPLAY_RUN_MANIFEST_SCHEMA = "mssql.replay.run/1";
export const REPLAY_RUN_MANIFEST_FILE = "manifest.json";
export const REPLAY_RUN_ITEMS_FILE = "items.jsonl";
export const REPLAY_RUN_CONFIG_GROUPS_FILE = "configGroups.json";

export type ReplayRunSemantics = "interactiveExperiment" | "verification" | "harness";

export type ReplayRunManifestStatus =
    | "queued"
    | "running"
    | "cancelling"
    | "cancelled"
    | "completed"
    | "partial"
    | "failed";

export interface ReplayRunSourceV1 {
    captureSessionId: string;
    captureEventId: string;
    /** sha256 of the captured snapshot event's canonical JSON. */
    snapshotDigest: string;
    label: string;
}

/** The manifest's config-group ref subset (§7.3); full groups ride configGroups.json. */
export interface ReplayRunConfigGroupRefV1 {
    configGroupId: string;
    version: number;
    label: string;
    effectiveConfigDigest: string;
}

export interface ReplayRunCellV1 {
    matrixCellId: string;
    configGroupId: string;
    label: string;
    ordinal: number;
}

export interface ReplayRunManifestV1 {
    schema: typeof REPLAY_RUN_MANIFEST_SCHEMA;
    replayRunId: string;
    featureId: string;
    semantics: ReplayRunSemantics;
    createdAt: number;
    startedAt?: number;
    endedAt?: number;
    status: ReplayRunManifestStatus;
    sourceBasketDigest: string;
    sources: ReplayRunSourceV1[];
    configGroups: ReplayRunConfigGroupRefV1[];
    cells: ReplayRunCellV1[];
    repetitions: number;
    expectedItems: number;
    completedItems: number;
    failedItems: number;
    cancelledItems: number;
    estimate?: ReplayEstimate;
    actual?: ReplayActualCost;
    safety: ReplaySafetyAssessment;
    provenance: ReplayProvenance;
}

/** One items.jsonl line (§7.3 per-item record fields). */
export interface ReplayRunItemRecordV1 {
    replayRunId: string;
    replayItemId: string;
    sourceCaptureEventId: string;
    matrixCellId?: string;
    configGroupId?: string;
    repetition: number;
    queuedAt: number;
    startedAt?: number;
    endedAt: number;
    resolvedConfigDigest: string;
    status: "completed" | "failed" | "cancelled";
    /** Durable link id of the replayed result event, when the host recorded one. */
    resultCaptureEventId?: string;
    /** Ring-local display id of the result event. */
    resultEventId?: string;
    errorCode?: string;
    /** Redacted/short error detail — never payload content. */
    errorMessage?: string;
    cancellationOutcome?: ReplayCancellationOutcome;
    attempt: number;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface ReplayRunBeginInput {
    replayRunId: string;
    createdAt: number;
    sources: Array<{
        captureSessionId?: string;
        captureEventId: string;
        label: string;
        /** The captured snapshot event — digested here, never persisted. */
        snapshotJson: unknown;
    }>;
    /** Full frozen config groups; the manifest stores the ref subset. */
    configGroups: ConfigGroupV1[];
    cells: ReplayRunCellV1[];
    repetitions: number;
    expectedItems: number;
    estimate?: ReplayEstimate;
    safety?: ReplaySafetyAssessment;
}

export interface ReplayRunStatusUpdate {
    replayRunId: string;
    status: ReplayRunManifestStatus;
    actual?: ReplayActualCost;
}

export type ReplayRunItemInput = Omit<ReplayRunItemRecordV1, "replayRunId">;

/**
 * The slice of ObservabilityBundleManager the repository needs — narrow so
 * tests inject a recorder and the repository never learns catalog internals.
 */
export interface ReplayRunBundleRegistrar {
    registerArtifact(
        hostSessionId: string,
        input: ObservabilityArtifactDescriptorInputV1,
    ): Promise<void>;
    updateArtifact(
        hostSessionId: string,
        artifactId: string,
        patch: ObservabilityArtifactPatchV1,
    ): Promise<boolean>;
    closeArtifact(
        hostSessionId: string,
        artifactId: string,
        patch?: ObservabilityArtifactPatchV1,
    ): Promise<boolean>;
}

export interface ReplayRunRepositoryOptions {
    storeRoot: string;
    hostSessionId: string;
    featureId: string;
    semantics?: ReplayRunSemantics;
    provenance?: ReplayProvenance;
    bundleRegistrar?: ReplayRunBundleRegistrar;
    fs?: JournalFsLike;
    clock?: JournalClock;
    /** Debounce window for non-terminal manifest writes (default 500ms). */
    debounceMs?: number;
    /** Consecutive write failures before a run's persistence stops retrying. */
    failureThreshold?: number;
    /** Temp-file suffix nonces; defaults to an internal counter. */
    idFactory?: () => string;
}

export const REPLAY_RUN_REPOSITORY_DEFAULTS = {
    debounceMs: 500,
    failureThreshold: 5,
} as const;

const TERMINAL_MANIFEST_STATUSES: readonly ReplayRunManifestStatus[] = [
    "cancelled",
    "completed",
    "partial",
    "failed",
];

function isTerminalManifestStatus(status: ReplayRunManifestStatus): boolean {
    return TERMINAL_MANIFEST_STATUSES.includes(status);
}

interface RunPersistState {
    manifest: ReplayRunManifestV1;
    dir: string;
    chain: Promise<void>;
    dirty: boolean;
    debounceTimer: NodeJS.Timeout | undefined;
    itemsBytes: number;
    consecutiveFailures: number;
    failed: boolean;
    bundleRegistered: boolean;
    bundleClosed: boolean;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class ReplayRunRepository {
    private readonly _logger = logger2.withPrefix("ReplayRunRepository");
    private readonly _options: ReplayRunRepositoryOptions;
    private readonly _fs: JournalFsLike;
    private readonly _clock: JournalClock;
    private readonly _debounceMs: number;
    private readonly _failureThreshold: number;
    private readonly _idFactory: () => string;
    private readonly _runs = new Map<string, RunPersistState>();
    private _tempNonce = 0;
    private _disposed = false;

    constructor(options: ReplayRunRepositoryOptions) {
        this._options = options;
        this._fs = options.fs ?? new NodeJournalFs();
        this._clock = options.clock ?? { now: () => Date.now() };
        this._debounceMs = options.debounceMs ?? REPLAY_RUN_REPOSITORY_DEFAULTS.debounceMs;
        this._failureThreshold =
            options.failureThreshold ?? REPLAY_RUN_REPOSITORY_DEFAULTS.failureThreshold;
        this._idFactory = options.idFactory ?? (() => `${++this._tempNonce}`);
    }

    /** Runs currently tracked in memory (health/tests). */
    public get trackedRunIds(): string[] {
        return [...this._runs.keys()];
    }

    /**
     * Start persisting one run: builds the manifest (status "queued"),
     * writes it immediately, freezes the config groups, and registers the
     * bundle descriptor. Resolves true when the initial manifest landed —
     * the caller may then mark the run `durable` in UI state. Never rejects.
     */
    public async beginRun(input: ReplayRunBeginInput): Promise<boolean> {
        if (this._disposed || this._runs.has(input.replayRunId)) {
            return false;
        }
        let manifest: ReplayRunManifestV1;
        try {
            const sources: ReplayRunSourceV1[] = input.sources.map((source) => ({
                captureSessionId: source.captureSessionId ?? "unknown",
                captureEventId: source.captureEventId,
                snapshotDigest: sha256OfCanonicalJson(source.snapshotJson),
                label: source.label,
            }));
            manifest = {
                schema: REPLAY_RUN_MANIFEST_SCHEMA,
                replayRunId: input.replayRunId,
                featureId: this._options.featureId,
                semantics: this._options.semantics ?? "interactiveExperiment",
                createdAt: input.createdAt,
                status: "queued",
                sourceBasketDigest: sha256OfCanonicalJson(
                    sources.map((source) => ({
                        captureEventId: source.captureEventId,
                        snapshotDigest: source.snapshotDigest,
                    })),
                ),
                sources,
                configGroups: input.configGroups.map((group) => ({
                    configGroupId: group.configGroupId,
                    version: group.version,
                    label: group.label,
                    effectiveConfigDigest: group.effectiveConfigDigest ?? "",
                })),
                cells: [...input.cells],
                repetitions: input.repetitions,
                expectedItems: input.expectedItems,
                completedItems: 0,
                failedItems: 0,
                cancelledItems: 0,
                ...(input.estimate ? { estimate: input.estimate } : {}),
                safety: input.safety ?? {
                    sideEffectClass: "unknown",
                    targetBinding: "none",
                    requiresConfirmation: false,
                    requiresSandbox: false,
                    reasons: ["host provided no safety classification"],
                },
                provenance: { ...(this._options.provenance ?? {}) },
            };
        } catch (error) {
            // Digest/serialization failure: the run stays UI-only, honestly.
            this._logger.warn(
                `Replay run ${input.replayRunId} could not be prepared for persistence: ` +
                    `${error instanceof Error ? error.message : String(error)}`,
            );
            return false;
        }

        const state: RunPersistState = {
            manifest,
            dir: this.runDir(input.replayRunId),
            chain: Promise.resolve(),
            dirty: true,
            debounceTimer: undefined,
            itemsBytes: 0,
            consecutiveFailures: 0,
            failed: false,
            bundleRegistered: false,
            bundleClosed: false,
        };
        this._runs.set(input.replayRunId, state);

        // Initial write is immediate: a durable claim needs a file behind it.
        let firstWriteOk = false;
        await this.enqueue(state, async () => {
            await this._fs.mkdirp(state.dir);
            await this.writeManifestAtomically(state);
            firstWriteOk = true;
            try {
                await this._fs.writeFile(
                    joinPath(state.dir, REPLAY_RUN_CONFIG_GROUPS_FILE),
                    JSON.stringify(input.configGroups, null, 2),
                );
            } catch (error) {
                // Frozen groups are supplementary; the manifest refs remain.
                this._logger.warn(
                    `Replay run ${input.replayRunId}: configGroups.json write failed ` +
                        `(${error instanceof Error ? error.message : String(error)})`,
                );
            }
        });
        if (firstWriteOk) {
            this.syncBundleDescriptor(state);
        }
        return firstWriteOk;
    }

    /** Run status transition; terminal statuses flush immediately. */
    public noteRunStatus(update: ReplayRunStatusUpdate): void {
        const state = this._runs.get(update.replayRunId);
        if (!state || state.failed) {
            return;
        }
        const manifest = state.manifest;
        if (isTerminalManifestStatus(manifest.status)) {
            return; // terminal is terminal — no resurrection
        }
        if (manifest.status === update.status && !update.actual) {
            // Progress-only updates still refresh the debounced manifest.
            this.markDirty(state, false);
            return;
        }
        manifest.status = update.status;
        if (update.status === "running" && manifest.startedAt === undefined) {
            manifest.startedAt = this._clock.now();
        }
        if (update.actual) {
            manifest.actual = update.actual;
        }
        const terminal = isTerminalManifestStatus(update.status);
        if (terminal) {
            manifest.endedAt = this._clock.now();
        }
        this.markDirty(state, terminal);
        this.syncBundleDescriptor(state);
    }

    /** Append one per-item terminal record and bump the manifest counts. */
    public recordItem(replayRunId: string, item: ReplayRunItemInput): void {
        const state = this._runs.get(replayRunId);
        if (!state || state.failed) {
            return;
        }
        const record: ReplayRunItemRecordV1 = { replayRunId, ...item };
        switch (record.status) {
            case "completed":
                state.manifest.completedItems++;
                break;
            case "failed":
                state.manifest.failedItems++;
                break;
            case "cancelled":
                state.manifest.cancelledItems++;
                break;
        }
        let line: string;
        try {
            line = `${JSON.stringify(record)}\n`;
        } catch (error) {
            this._logger.warn(
                `Replay item ${item.replayItemId} could not be serialized: ` +
                    `${error instanceof Error ? error.message : String(error)}`,
            );
            return;
        }
        void this.enqueue(state, async () => {
            await this._fs.appendFile(joinPath(state.dir, REPLAY_RUN_ITEMS_FILE), line);
            state.itemsBytes += Buffer.byteLength(line, "utf8");
        });
        this.markDirty(state, false);
    }

    /** Flush every pending write now — the barrier for dispose and tests. */
    public async flushBarrier(): Promise<void> {
        for (const state of this._runs.values()) {
            this.cancelTimer(state);
            if (state.dirty && !state.failed) {
                await this.enqueue(state, () => this.writeManifestAtomically(state));
            } else {
                await state.chain;
            }
        }
    }

    /** Final flush. Runs still non-terminal stay as-is on disk — the startup
     *  reconciliation marks them `partial` honestly on the next launch. */
    public async dispose(): Promise<void> {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        await this.flushBarrier();
    }

    // -- internals -------------------------------------------------------------

    private runDir(replayRunId: string): string {
        return joinPath(
            this._options.storeRoot,
            `sessions/${this._options.hostSessionId}/replay/${replayRunId}`,
        );
    }

    private markDirty(state: RunPersistState, flushNow: boolean): void {
        state.dirty = true;
        if (state.failed) {
            return;
        }
        if (flushNow) {
            this.cancelTimer(state);
            void this.enqueue(state, () => this.writeManifestAtomically(state));
            return;
        }
        if (state.debounceTimer || this._disposed) {
            return;
        }
        state.debounceTimer = setTimeout(() => {
            state.debounceTimer = undefined;
            void this.enqueue(state, () => this.writeManifestAtomically(state));
        }, this._debounceMs);
        state.debounceTimer.unref?.();
    }

    private cancelTimer(state: RunPersistState): void {
        if (state.debounceTimer) {
            clearTimeout(state.debounceTimer);
            state.debounceTimer = undefined;
        }
    }

    /** Serialized, contained execution: failures degrade, never throw. */
    private enqueue(state: RunPersistState, work: () => Promise<void>): Promise<void> {
        state.chain = state.chain.then(async () => {
            if (state.failed) {
                return;
            }
            try {
                await work();
                state.consecutiveFailures = 0;
            } catch (error) {
                state.consecutiveFailures++;
                const detail = error instanceof Error ? error.message : String(error);
                if (state.consecutiveFailures >= this._failureThreshold) {
                    state.failed = true;
                    this._logger.error(
                        `Replay run ${state.manifest.replayRunId} persistence FAILED after ` +
                            `${state.consecutiveFailures} consecutive failures: ${detail}. ` +
                            `The run continues; its durable record stays behind.`,
                    );
                } else {
                    this._logger.warn(
                        `Replay run ${state.manifest.replayRunId} persistence degraded: ${detail}`,
                    );
                }
            }
        });
        return state.chain;
    }

    private async writeManifestAtomically(state: RunPersistState): Promise<void> {
        if (!state.dirty) {
            return;
        }
        state.dirty = false;
        const manifestPath = joinPath(state.dir, REPLAY_RUN_MANIFEST_FILE);
        const tempPath = `${manifestPath}.${this._idFactory()}.tmp`;
        try {
            await this._fs.mkdirp(state.dir);
            await this._fs.writeFile(tempPath, JSON.stringify(state.manifest, null, 2));
            await this._fs.rename(tempPath, manifestPath);
        } catch (error) {
            // The rename never landed: the previous manifest.json is intact
            // and the state stays dirty for the next attempt.
            state.dirty = true;
            throw error;
        }
    }

    /** Register-or-update the bundle catalog descriptor (fire and forget). */
    private syncBundleDescriptor(state: RunPersistState): void {
        const registrar = this._options.bundleRegistrar;
        if (!registrar || state.failed) {
            return;
        }
        const manifest = state.manifest;
        const runId = manifest.replayRunId;
        const terminal = isTerminalManifestStatus(manifest.status);
        const descriptorStatus = terminal
            ? manifest.status === "completed" || manifest.status === "cancelled"
                ? ("closed" as const)
                : ("partial" as const)
            : ("active" as const);
        void (async () => {
            try {
                if (!state.bundleRegistered) {
                    state.bundleRegistered = true;
                    await registrar.registerArtifact(this._options.hostSessionId, {
                        artifactId: runId,
                        kind: "replayRun",
                        featureId: manifest.featureId,
                        schema: REPLAY_RUN_MANIFEST_SCHEMA,
                        relativeManifest: `replay/${runId}/${REPLAY_RUN_MANIFEST_FILE}`,
                        createdUtc: new Date(manifest.createdAt).toISOString(),
                        status: descriptorStatus,
                        events: manifest.expectedItems,
                        bytes: state.itemsBytes,
                        gaps: 0,
                        truncations: 0,
                        classification: {
                            // The run manifest is metadata; the replayed
                            // result events live in the rich journal.
                            containsRichPayload: false,
                            maximumClass: "diagnostic.metadata",
                            policyId: "replayRunMetadata",
                        },
                    });
                    return;
                }
                if (terminal && !state.bundleClosed) {
                    state.bundleClosed = true;
                    await registrar.closeArtifact(this._options.hostSessionId, runId, {
                        status: descriptorStatus,
                        events:
                            manifest.completedItems +
                            manifest.failedItems +
                            manifest.cancelledItems,
                        bytes: state.itemsBytes,
                    });
                    return;
                }
                if (!terminal) {
                    await registrar.updateArtifact(this._options.hostSessionId, runId, {
                        status: descriptorStatus,
                        events:
                            manifest.completedItems +
                            manifest.failedItems +
                            manifest.cancelledItems,
                        bytes: state.itemsBytes,
                    });
                }
            } catch (error) {
                // Catalog failure never fails the run or the repository (§2.3).
                this._logger.warn(
                    `Replay run ${runId}: bundle descriptor sync failed ` +
                        `(${error instanceof Error ? error.message : String(error)})`,
                );
            }
        })();
    }
}

// ---------------------------------------------------------------------------
// Startup reconciliation (restart honesty — addendum §2.2)
// ---------------------------------------------------------------------------

export interface ReplayRunReconcileReport {
    runsScanned: number;
    runsMarkedPartial: number;
    issues: string[];
}

/**
 * Mark replay runs a dead host session left `queued`/`running`/`cancelling`
 * as `partial` (WI-3.3 accept: incomplete runs are marked partial after
 * restart). Rewrites each affected manifest via temp-file + atomic rename.
 * Never throws; the current host session's runs are never touched.
 */
export async function reconcileReplayRunsOnStartup(options: {
    storeRoot: string;
    currentHostSessionId: string;
    fs?: JournalFsLike;
    clock?: JournalClock;
    idFactory?: () => string;
}): Promise<ReplayRunReconcileReport> {
    const fs = options.fs ?? new NodeJournalFs();
    const clock = options.clock ?? { now: () => Date.now() };
    let nonce = 0;
    const idFactory = options.idFactory ?? (() => `${++nonce}`);
    const report: ReplayRunReconcileReport = { runsScanned: 0, runsMarkedPartial: 0, issues: [] };
    let sessionNames: string[] = [];
    try {
        sessionNames = await fs.readdir(joinPath(options.storeRoot, "sessions"));
    } catch {
        return report;
    }
    for (const sessionName of sessionNames) {
        if (sessionName === options.currentHostSessionId) {
            continue;
        }
        const replayDir = joinPath(options.storeRoot, `sessions/${sessionName}/replay`);
        for (const runDirName of await fs.readdir(replayDir)) {
            const manifestPath = joinPath(replayDir, `${runDirName}/${REPLAY_RUN_MANIFEST_FILE}`);
            try {
                const raw = await fs.readFile(manifestPath);
                const manifest = JSON.parse(raw) as Partial<ReplayRunManifestV1>;
                if (manifest?.schema !== REPLAY_RUN_MANIFEST_SCHEMA) {
                    continue;
                }
                report.runsScanned++;
                const status = manifest.status;
                if (status !== "queued" && status !== "running" && status !== "cancelling") {
                    continue;
                }
                manifest.status = "partial";
                manifest.endedAt = manifest.endedAt ?? clock.now();
                const tempPath = `${manifestPath}.${idFactory()}.tmp`;
                await fs.writeFile(tempPath, JSON.stringify(manifest, null, 2));
                await fs.rename(tempPath, manifestPath);
                report.runsMarkedPartial++;
            } catch (error) {
                report.issues.push(
                    `${sessionName}/${runDirName}: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }
    }
    return report;
}
