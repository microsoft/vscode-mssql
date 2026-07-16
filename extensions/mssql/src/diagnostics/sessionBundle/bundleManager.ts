/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Observability bundle manager (final plan WI-2.3 / addendum §3.1
 * Amendment A). The ONLY writer of `bundle.json` — child writers (diag sink,
 * feature-capture journals, replay repository) own their own manifests and
 * never touch the catalog; they notify this manager instead.
 *
 * Guarantees:
 * - lazy creation: no bundle file exists until the first artifact registers
 *   (works when Plane-A capture is off — WI-A.3 recommendation);
 * - updates are serialized per bundle on an in-process promise queue and
 *   written by temp-file + atomic rename, debounced to at most one write per
 *   window, with a flush barrier for close/deactivate;
 * - the catalog is always reconstructible: `rebuildBundle` re-derives it
 *   from child manifests, and corrupt bundles are rebuilt, never fatal;
 * - startup reconciliation marks artifacts that still claim `active` from a
 *   dead host session as `partial` (honesty invariant §2.2);
 * - `deleteSensitiveArtifacts` removes rich/replay children while PRESERVING
 *   metadata-only diag streams (§9.4), deleting only the fixed `rich/` and
 *   `replay/` session subdirectories — descriptor paths are never followed
 *   outside the session directory;
 * - catalog failure never fails capture or the product (§2.3).
 */

import { logger2 } from "../../models/logger2";
import { BundleHealthRow, SessionManifest } from "../../sharedInterfaces/debugConsole";
import { newBundleId } from "../featureCapture/identity";
import { FeatureCaptureManifestV1 } from "../featureCapture/journal/journalSchemas";
import {
    JournalClock,
    JournalFsLike,
    NodeJournalFs,
    joinPath,
} from "../featureCapture/journal/journalWriter";
import {
    OBSERVABILITY_BUNDLE_FILE,
    OBSERVABILITY_BUNDLE_SCHEMA,
    ObservabilityArtifactDescriptorV1,
    ObservabilityBundleStatus,
    ObservabilityBundleV1,
    bundlePathTopSegment,
    computeBundleClassificationSummary,
    computeBundleTotals,
    isObservabilityBundleShape,
    isSafeBundleRelativePath,
} from "./bundleSchemas";

// ---------------------------------------------------------------------------
// Seams
// ---------------------------------------------------------------------------

/**
 * The journal module's filesystem seam plus recursive delete (the one
 * operation the catalog needs that a journal writer never does).
 */
export interface BundleFsLike extends JournalFsLike {
    /** Recursive best-effort delete; succeeds when the path is already gone. */
    rmrf(path: string): Promise<void>;
}

/** Real implementation over node fs/promises. */
export class NodeBundleFs extends NodeJournalFs implements BundleFsLike {
    async rmrf(path: string): Promise<void> {
        const fs = await import("fs/promises");
        await fs.rm(path, { recursive: true, force: true });
    }
}

export interface ObservabilityBundleManagerOptions {
    storeRoot: string;
    /** The live extension-host session; other sessions' `active` claims are stale. */
    currentHostSessionId: string;
    provenance?: ObservabilityBundleV1["provenance"];
    fs?: BundleFsLike;
    clock?: JournalClock;
    /** Debounce window: at most one bundle write per window (default 500ms). */
    debounceMs?: number;
    /** Consecutive write failures before automatic retries stop (explicit flushes still retry). */
    failureThreshold?: number;
    /** Temp-file suffix nonces; defaults to an internal counter. */
    idFactory?: () => string;
}

export const BUNDLE_MANAGER_DEFAULTS = {
    debounceMs: 500,
    failureThreshold: 5,
} as const;

const MAX_ISSUES_PER_BUNDLE = 20;

// ---------------------------------------------------------------------------
// Inputs and results
// ---------------------------------------------------------------------------

/** What a child writer hands to registerArtifact (the manager stamps timestamps). */
export type ObservabilityArtifactDescriptorInputV1 = Omit<
    ObservabilityArtifactDescriptorV1,
    "createdUtc" | "updatedUtc"
> & { createdUtc?: string };

/** Mutable summary fields a child writer may patch after registration. */
export type ObservabilityArtifactPatchV1 = Partial<
    Pick<
        ObservabilityArtifactDescriptorV1,
        | "status"
        | "records"
        | "events"
        | "bytes"
        | "gaps"
        | "truncations"
        | "classification"
        | "manifestDigest"
        | "relativeManifest"
        | "externalRef"
    >
>;

export interface BundleReconcileReport {
    /** Session directories examined (the current host session is skipped). */
    sessionsScanned: number;
    /** Sessions without a bundle.json — legacy, deliberately left untouched (§10.1). */
    legacySessions: number;
    /** Bundles whose stale `active` claims were marked `partial`. */
    bundlesRepaired: number;
    /** Corrupt bundle.json files reconstructed from child manifests. */
    bundlesRebuilt: number;
    artifactsMarkedPartial: number;
    issues: string[];
}

export interface ClearSensitiveCapturesResult {
    sessionsScanned: number;
    /** rich/ and replay/ directories removed. */
    removedDirectories: number;
    /** Sensitive descriptors removed from bundle catalogs. */
    removedArtifacts: number;
    /** diagStream descriptors left in place (metadata-only evidence is kept). */
    preservedDiagArtifacts: number;
    issues: string[];
}

interface BundleState {
    hostSessionId: string;
    dir: string;
    bundle: ObservabilityBundleV1;
    /** Serialized write queue — all bundle.json writes go through here. */
    chain: Promise<void>;
    queueDepth: number;
    dirty: boolean;
    everWritten: boolean;
    rebuiltOnLoad: boolean;
    debounceTimer: NodeJS.Timeout | undefined;
    lastWriteAt: number | undefined;
    writesCompleted: number;
    consecutiveWriteFailures: number;
    issues: string[];
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class ObservabilityBundleManager {
    private readonly _logger = logger2.withPrefix("ObservabilityBundle");
    private readonly _storeRoot: string;
    private readonly _currentHostSessionId: string;
    private readonly _provenance: ObservabilityBundleV1["provenance"];
    private readonly _fs: BundleFsLike;
    private readonly _clock: JournalClock;
    private readonly _debounceMs: number;
    private readonly _failureThreshold: number;
    private readonly _idFactory: () => string;
    private _tempNonce = 0;
    private _disposed = false;

    /** Load promises keyed by hostSessionId (loading is async and raced). */
    private readonly _states = new Map<string, Promise<BundleState>>();
    /** Resolved states for synchronous health snapshots. */
    private readonly _resolved = new Map<string, BundleState>();

    constructor(options: ObservabilityBundleManagerOptions) {
        this._storeRoot = options.storeRoot;
        this._currentHostSessionId = options.currentHostSessionId;
        this._provenance = options.provenance ?? {};
        this._fs = options.fs ?? new NodeBundleFs();
        this._clock = options.clock ?? { now: () => Date.now() };
        this._debounceMs = options.debounceMs ?? BUNDLE_MANAGER_DEFAULTS.debounceMs;
        this._failureThreshold =
            options.failureThreshold ?? BUNDLE_MANAGER_DEFAULTS.failureThreshold;
        this._idFactory = options.idFactory ?? (() => `${++this._tempNonce}`);
    }

    // -- public API -----------------------------------------------------------

    /**
     * Ensure the in-memory bundle exists (loading — or rebuilding a corrupt —
     * bundle.json when present). Creates NO file: the catalog reaches disk on
     * the first artifact registration. Returns a snapshot copy.
     */
    public async ensureBundle(hostSessionId: string): Promise<ObservabilityBundleV1> {
        const state = await this.getState(hostSessionId);
        return cloneBundle(state.bundle);
    }

    /**
     * Register — or update, when the artifactId is already cataloged — one
     * child artifact. Upsert semantics let child writers notify the manager
     * from their existing flush paths without tracking registration state.
     */
    public async registerArtifact(
        hostSessionId: string,
        input: ObservabilityArtifactDescriptorInputV1,
    ): Promise<void> {
        const state = await this.getState(hostSessionId);
        const nowUtc = this.nowIso();
        const existing = state.bundle.artifacts.find(
            (artifact) => artifact.artifactId === input.artifactId,
        );
        if (existing) {
            const updates = { ...input };
            delete updates.createdUtc; // registration time is immutable
            Object.assign(existing, updates);
            existing.updatedUtc = nowUtc;
        } else {
            state.bundle.artifacts.push({
                ...input,
                createdUtc: input.createdUtc ?? nowUtc,
                updatedUtc: nowUtc,
            });
        }
        this.scheduleWrite(state);
    }

    /**
     * Patch mutable summary fields of a registered artifact. Last write wins
     * per field. Returns false (with a recorded issue) for unknown artifacts.
     */
    public async updateArtifact(
        hostSessionId: string,
        artifactId: string,
        patch: ObservabilityArtifactPatchV1,
    ): Promise<boolean> {
        const state = await this.getState(hostSessionId);
        const artifact = state.bundle.artifacts.find((entry) => entry.artifactId === artifactId);
        if (!artifact) {
            this.noteIssue(state, `update for unknown artifact ${artifactId} ignored`);
            return false;
        }
        Object.assign(artifact, patch);
        artifact.updatedUtc = this.nowIso();
        this.scheduleWrite(state);
        return true;
    }

    /**
     * Terminal-state update: applies the patch, defaults the status to
     * "closed", and flushes immediately (terminal states must not sit in a
     * debounce window across deactivate).
     */
    public async closeArtifact(
        hostSessionId: string,
        artifactId: string,
        patch: ObservabilityArtifactPatchV1 = {},
    ): Promise<boolean> {
        const updated = await this.updateArtifact(hostSessionId, artifactId, {
            status: "closed",
            ...patch,
        });
        if (updated) {
            await this.flushBarrier(hostSessionId);
        }
        return updated;
    }

    /** Read a bundle without creating manager state (undefined = legacy session). */
    public async getBundle(hostSessionId: string): Promise<ObservabilityBundleV1 | undefined> {
        const existing = this._resolved.get(hostSessionId);
        if (existing) {
            return cloneBundle(existing.bundle);
        }
        try {
            const raw = await this._fs.readFile(
                joinPath(this.sessionDir(hostSessionId), OBSERVABILITY_BUNDLE_FILE),
            );
            const parsed: unknown = JSON.parse(raw);
            return isObservabilityBundleShape(parsed) ? parsed : undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * Flush pending catalog writes now (one bundle, or every bundle when no
     * id is given) — the barrier for close/deactivate and tests.
     */
    public async flushBarrier(hostSessionId?: string): Promise<void> {
        const targets = hostSessionId
            ? [this._states.get(hostSessionId)].filter(
                  (state): state is Promise<BundleState> => state !== undefined,
              )
            : [...this._states.values()];
        for (const pending of targets) {
            const state = await pending;
            this.cancelTimer(state);
            await this.enqueueWrite(state);
        }
    }

    /**
     * Reconstruct the catalog from the child manifests actually on disk —
     * the recovery path, also usable to synthesize a bundle for a legacy
     * session on demand. Written immediately (this is an explicit repair).
     */
    public async rebuildBundle(
        hostSessionId: string,
    ): Promise<{ bundle: ObservabilityBundleV1; issues: string[] }> {
        const state = await this.getState(hostSessionId);
        const scan = await this.scanChildManifests(state.dir);
        const previous = state.bundle;
        state.bundle = {
            schema: OBSERVABILITY_BUNDLE_SCHEMA,
            bundleId: previous.bundleId,
            hostSessionId,
            createdUtc: scan.earliestCreatedUtc ?? previous.createdUtc,
            updatedUtc: this.nowIso(),
            status: deriveBundleStatus(scan.artifacts, previous.status),
            provenance: previous.provenance,
            artifacts: scan.artifacts,
            totals: computeBundleTotals(scan.artifacts),
        };
        for (const issue of scan.issues) {
            this.noteIssue(state, issue);
        }
        state.dirty = true;
        this.cancelTimer(state);
        await this.enqueueWrite(state);
        return { bundle: cloneBundle(state.bundle), issues: scan.issues };
    }

    /**
     * Startup reconciliation: artifacts (and bundles) that still claim
     * `active` in a session directory that is not the current host session
     * belong to a dead process — mark them `partial`. Corrupt bundles are
     * rebuilt from child manifests. Legacy sessions (no bundle.json) are
     * left exactly as they are (§10.1). Never throws.
     */
    public async reconcileOnStartup(): Promise<BundleReconcileReport> {
        const report: BundleReconcileReport = {
            sessionsScanned: 0,
            legacySessions: 0,
            bundlesRepaired: 0,
            bundlesRebuilt: 0,
            artifactsMarkedPartial: 0,
            issues: [],
        };
        let names: string[] = [];
        try {
            names = await this._fs.readdir(joinPath(this._storeRoot, "sessions"));
        } catch {
            return report; // no store yet — nothing to reconcile
        }
        for (const name of names) {
            if (name === this._currentHostSessionId) {
                continue;
            }
            try {
                const children = await this._fs.readdir(
                    joinPath(this._storeRoot, `sessions/${name}`),
                );
                if (children.length === 0) {
                    continue; // not a session directory (or an empty one)
                }
                report.sessionsScanned++;
                if (!children.includes(OBSERVABILITY_BUNDLE_FILE)) {
                    report.legacySessions++;
                    continue;
                }
                const state = await this.getState(name);
                if (state.rebuiltOnLoad) {
                    report.bundlesRebuilt++;
                    report.issues.push(`${name}: corrupt bundle.json rebuilt from child manifests`);
                }
                let marked = 0;
                for (const artifact of state.bundle.artifacts) {
                    if (artifact.status === "active") {
                        artifact.status = "partial";
                        artifact.updatedUtc = this.nowIso();
                        marked++;
                    }
                }
                let statusChanged = false;
                if (state.bundle.status === "active") {
                    state.bundle.status = "partial";
                    statusChanged = true;
                }
                if (marked > 0 || statusChanged) {
                    report.bundlesRepaired++;
                    report.artifactsMarkedPartial += marked;
                    state.dirty = true;
                }
                if (state.dirty) {
                    this.cancelTimer(state);
                    await this.enqueueWrite(state);
                }
            } catch (error) {
                report.issues.push(
                    `${name}: reconcile failed (${error instanceof Error ? error.message : String(error)})`,
                );
            }
        }
        if (report.bundlesRepaired > 0 || report.bundlesRebuilt > 0) {
            this._logger.info(
                `Startup reconciliation: ${report.bundlesRepaired} bundle(s) repaired, ` +
                    `${report.bundlesRebuilt} rebuilt, ${report.artifactsMarkedPartial} stale artifact(s) marked partial.`,
            );
        }
        return report;
    }

    /**
     * "Clear sensitive captures" (§9.4): remove rich feature captures and
     * replay runs — files AND catalog descriptors — across ALL sessions,
     * while preserving metadata-only diag streams. Deletion targets are
     * exactly the fixed `rich/` and `replay/` children of each session
     * directory; descriptor paths are validated but NEVER used as deletion
     * targets, so a hostile "..\" path cannot reach outside the store.
     */
    public async deleteSensitiveArtifacts(): Promise<ClearSensitiveCapturesResult> {
        const result: ClearSensitiveCapturesResult = {
            sessionsScanned: 0,
            removedDirectories: 0,
            removedArtifacts: 0,
            preservedDiagArtifacts: 0,
            issues: [],
        };
        let names: string[] = [];
        try {
            names = await this._fs.readdir(joinPath(this._storeRoot, "sessions"));
        } catch {
            return result;
        }
        for (const name of names) {
            const dir = joinPath(this._storeRoot, `sessions/${name}`);
            let children: string[] = [];
            try {
                children = await this._fs.readdir(dir);
            } catch {
                continue;
            }
            if (children.length === 0) {
                continue;
            }
            result.sessionsScanned++;
            for (const sensitiveDir of ["rich", "replay"]) {
                if (!children.includes(sensitiveDir)) {
                    continue;
                }
                try {
                    // Path-contained by construction: always the fixed child.
                    await this._fs.rmrf(joinPath(dir, sensitiveDir));
                    result.removedDirectories++;
                } catch (error) {
                    result.issues.push(
                        `${name}: failed to remove ${sensitiveDir}/ (${error instanceof Error ? error.message : String(error)})`,
                    );
                }
            }
            if (!children.includes(OBSERVABILITY_BUNDLE_FILE)) {
                continue; // legacy session: no catalog to update
            }
            try {
                const state = await this.getState(name);
                const kept: ObservabilityArtifactDescriptorV1[] = [];
                for (const artifact of state.bundle.artifacts) {
                    if (artifact.kind !== "featureCapture" && artifact.kind !== "replayRun") {
                        if (artifact.kind === "diagStream") {
                            result.preservedDiagArtifacts++;
                        }
                        kept.push(artifact);
                        continue;
                    }
                    const path = artifact.relativeManifest;
                    const contained =
                        isSafeBundleRelativePath(path) &&
                        (bundlePathTopSegment(path) === "rich" ||
                            bundlePathTopSegment(path) === "replay");
                    if (contained) {
                        result.removedArtifacts++;
                        continue; // its files were deleted with the fixed directory
                    }
                    // The descriptor points outside rich/ and replay/ (possibly
                    // a traversal attempt): its files were NOT deleted, so the
                    // descriptor stays — marked invalid, honestly.
                    artifact.status = "invalid";
                    artifact.updatedUtc = this.nowIso();
                    kept.push(artifact);
                    result.issues.push(
                        `${name}: refused to follow descriptor path outside the session directory (${artifact.artifactId}: ${String(path)})`,
                    );
                }
                state.bundle.artifacts = kept;
                state.dirty = true;
                this.cancelTimer(state);
                await this.enqueueWrite(state);
            } catch (error) {
                result.issues.push(
                    `${name}: catalog update failed (${error instanceof Error ? error.message : String(error)})`,
                );
            }
        }
        this._logger.info(
            `Clear sensitive captures: removed ${result.removedDirectories} director(ies) and ` +
                `${result.removedArtifacts} descriptor(s); ${result.preservedDiagArtifacts} diag stream(s) preserved.`,
        );
        return result;
    }

    /** Per-bundle health: status, queue depth, last write, issues. */
    public healthSnapshot(): BundleHealthRow[] {
        return [...this._resolved.values()].map((state) => ({
            hostSessionId: state.hostSessionId,
            bundleId: state.bundle.bundleId,
            status: state.bundle.status,
            artifacts: state.bundle.artifacts.length,
            dirty: state.dirty,
            queueDepth: state.queueDepth,
            writesCompleted: state.writesCompleted,
            consecutiveWriteFailures: state.consecutiveWriteFailures,
            ...(state.lastWriteAt !== undefined
                ? { lastWriteUtc: new Date(state.lastWriteAt).toISOString() }
                : {}),
            issues: [...state.issues],
        }));
    }

    /**
     * Deactivation: flush everything, then stamp the CURRENT session's bundle
     * closed (partial when any artifact still claims active — an honest
     * record that the writer went away before its child did). Idempotent.
     */
    public async dispose(): Promise<void> {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        const current = this._resolved.get(this._currentHostSessionId);
        if (current && (current.everWritten || current.dirty)) {
            const anyActive = current.bundle.artifacts.some(
                (artifact) => artifact.status === "active",
            );
            const anyDegraded = current.bundle.artifacts.some(
                (artifact) => artifact.status === "partial" || artifact.status === "invalid",
            );
            current.bundle.status = anyActive || anyDegraded ? "partial" : "closed";
            current.bundle.closedUtc = this.nowIso();
            current.dirty = true;
        }
        await this.flushBarrier();
    }

    // -- state loading ----------------------------------------------------------

    private sessionDir(hostSessionId: string): string {
        return joinPath(this._storeRoot, `sessions/${hostSessionId}`);
    }

    private getState(hostSessionId: string): Promise<BundleState> {
        let pending = this._states.get(hostSessionId);
        if (!pending) {
            pending = this.loadState(hostSessionId);
            this._states.set(hostSessionId, pending);
        }
        return pending;
    }

    private async loadState(hostSessionId: string): Promise<BundleState> {
        const dir = this.sessionDir(hostSessionId);
        const state: BundleState = {
            hostSessionId,
            dir,
            bundle: this.newBundle(hostSessionId),
            chain: Promise.resolve(),
            queueDepth: 0,
            dirty: false,
            everWritten: false,
            rebuiltOnLoad: false,
            debounceTimer: undefined,
            lastWriteAt: undefined,
            writesCompleted: 0,
            consecutiveWriteFailures: 0,
            issues: [],
        };
        let corrupt = false;
        try {
            const raw = await this._fs.readFile(joinPath(dir, OBSERVABILITY_BUNDLE_FILE));
            try {
                const parsed: unknown = JSON.parse(raw);
                if (isObservabilityBundleShape(parsed)) {
                    state.bundle = parsed;
                    state.everWritten = true;
                } else {
                    corrupt = true;
                }
            } catch {
                corrupt = true;
            }
        } catch {
            // Missing bundle: fresh in-memory catalog, written lazily on the
            // first artifact registration.
        }
        if (corrupt) {
            // Never crash on our own file: rebuild the catalog from the child
            // manifests, which remain the ownership source of truth.
            const scan = await this.scanChildManifests(dir);
            state.bundle = this.newBundle(hostSessionId);
            state.bundle.artifacts = scan.artifacts;
            state.bundle.createdUtc = scan.earliestCreatedUtc ?? state.bundle.createdUtc;
            state.bundle.status = deriveBundleStatus(scan.artifacts, "partial");
            state.rebuiltOnLoad = true;
            state.dirty = true;
            this.noteIssue(state, "bundle.json was corrupt; rebuilt from child manifests");
            for (const issue of scan.issues) {
                this.noteIssue(state, issue);
            }
            this._logger.warn(
                `Corrupt bundle.json for session ${hostSessionId} rebuilt from child manifests.`,
            );
        }
        this._resolved.set(hostSessionId, state);
        return state;
    }

    private newBundle(hostSessionId: string): ObservabilityBundleV1 {
        const nowUtc = this.nowIso();
        return {
            schema: OBSERVABILITY_BUNDLE_SCHEMA,
            bundleId: newBundleId(),
            hostSessionId,
            createdUtc: nowUtc,
            updatedUtc: nowUtc,
            status: "active",
            provenance: { ...this._provenance },
            artifacts: [],
            totals: computeBundleTotals([]),
        };
    }

    // -- child-manifest scanning (rebuild) ---------------------------------------

    private async scanChildManifests(dir: string): Promise<{
        artifacts: ObservabilityArtifactDescriptorV1[];
        earliestCreatedUtc?: string;
        issues: string[];
    }> {
        const artifacts: ObservabilityArtifactDescriptorV1[] = [];
        const issues: string[] = [];

        // Diag stream: <sessionDir>/manifest.json (existing layout, unmoved).
        try {
            const raw = await this._fs.readFile(joinPath(dir, "manifest.json"));
            const manifest = JSON.parse(raw) as SessionManifest;
            if (manifest?.schemaVersion === "mssql.diag.sessionManifest/1") {
                artifacts.push(diagManifestToArtifact(manifest, this.nowIso()));
            } else {
                issues.push("manifest.json is not a recognized diag session manifest");
            }
        } catch {
            // No diag manifest — legitimate when Plane-A capture was off.
        }

        // Rich streams: rich/<featureId>/<captureSessionId>/manifest.json.
        for (const featureId of await this._fs.readdir(joinPath(dir, "rich"))) {
            for (const captureSessionId of await this._fs.readdir(
                joinPath(dir, `rich/${featureId}`),
            )) {
                const relativeManifest = `rich/${featureId}/${captureSessionId}/manifest.json`;
                try {
                    const raw = await this._fs.readFile(joinPath(dir, relativeManifest));
                    const manifest = JSON.parse(raw) as FeatureCaptureManifestV1;
                    if (manifest?.schema !== "mssql.featureCapture.manifest/1") {
                        issues.push(`${relativeManifest} is not a feature-capture manifest`);
                        continue;
                    }
                    artifacts.push(
                        featureCaptureManifestToArtifact(
                            manifest,
                            relativeManifest,
                            captureSessionId,
                            this.nowIso(),
                        ),
                    );
                } catch {
                    issues.push(`${relativeManifest} missing or unreadable`);
                }
            }
        }

        // Replay runs: replay/<replayRunId>/manifest.json (repository lands in
        // WI-3.3; rebuild catalogs whatever honest metadata exists).
        for (const replayRunId of await this._fs.readdir(joinPath(dir, "replay"))) {
            const relativeManifest = `replay/${replayRunId}/manifest.json`;
            try {
                const raw = await this._fs.readFile(joinPath(dir, relativeManifest));
                const manifest = JSON.parse(raw) as Record<string, unknown>;
                artifacts.push(
                    replayManifestToArtifact(
                        manifest,
                        relativeManifest,
                        replayRunId,
                        this.nowIso(),
                    ),
                );
            } catch {
                issues.push(`${relativeManifest} missing or unreadable`);
            }
        }

        const earliest = artifacts.map((artifact) => artifact.createdUtc).sort()[0];
        return {
            artifacts,
            ...(earliest !== undefined ? { earliestCreatedUtc: earliest } : {}),
            issues,
        };
    }

    // -- serialized, debounced writes ---------------------------------------------

    private scheduleWrite(state: BundleState): void {
        state.dirty = true;
        if (
            state.debounceTimer ||
            this._disposed ||
            state.consecutiveWriteFailures >= this._failureThreshold
        ) {
            return;
        }
        state.debounceTimer = setTimeout(() => {
            state.debounceTimer = undefined;
            void this.enqueueWrite(state);
        }, this._debounceMs);
        state.debounceTimer.unref?.();
    }

    private cancelTimer(state: BundleState): void {
        if (state.debounceTimer) {
            clearTimeout(state.debounceTimer);
            state.debounceTimer = undefined;
        }
    }

    private enqueueWrite(state: BundleState): Promise<void> {
        state.queueDepth++;
        state.chain = state.chain
            .then(() => this.writeBundleNow(state))
            .finally(() => {
                state.queueDepth--;
            });
        return state.chain;
    }

    /** One serialized write pass: temp file + atomic rename. Never throws. */
    private async writeBundleNow(state: BundleState): Promise<void> {
        if (!state.dirty) {
            return;
        }
        state.dirty = false;
        const bundle = state.bundle;
        bundle.totals = computeBundleTotals(bundle.artifacts);
        bundle.classificationSummary = computeBundleClassificationSummary(bundle.artifacts);
        bundle.updatedUtc = this.nowIso();
        const bundlePath = joinPath(state.dir, OBSERVABILITY_BUNDLE_FILE);
        const tempPath = `${bundlePath}.${this._idFactory()}.tmp`;
        try {
            await this._fs.mkdirp(state.dir);
            await this._fs.writeFile(tempPath, JSON.stringify(bundle, null, 2));
            await this._fs.rename(tempPath, bundlePath);
            state.everWritten = true;
            state.lastWriteAt = this._clock.now();
            state.writesCompleted++;
            state.consecutiveWriteFailures = 0;
        } catch (error) {
            // The rename never landed, so the previous bundle.json is intact;
            // the state stays dirty and the next window (or flush) retries.
            state.dirty = true;
            state.consecutiveWriteFailures++;
            const detail = error instanceof Error ? error.message : String(error);
            this.noteIssue(state, `bundle write failed: ${detail}`);
            this._logger.warn(
                `Bundle write failed for session ${state.hostSessionId} (attempt ${state.consecutiveWriteFailures}): ${detail}`,
            );
            if (state.consecutiveWriteFailures < this._failureThreshold && !this._disposed) {
                this.scheduleWrite(state);
            }
        }
    }

    private noteIssue(state: BundleState, issue: string): void {
        state.issues.push(issue);
        if (state.issues.length > MAX_ISSUES_PER_BUNDLE) {
            state.issues.splice(0, state.issues.length - MAX_ISSUES_PER_BUNDLE);
        }
    }

    private nowIso(): string {
        return new Date(this._clock.now()).toISOString();
    }
}

// ---------------------------------------------------------------------------
// Descriptor mappings (pure; shared by live notification and rebuild)
// ---------------------------------------------------------------------------

/** Deterministic id so register-or-update and rebuild land on one artifact. */
export function diagArtifactId(sessionId: string): string {
    return `diag-${sessionId}`;
}

/**
 * Map a diag session manifest to its bundle descriptor input. Used by the
 * live SessionDiagSink notification (via DiagnosticsManager) and by rebuild.
 */
export function diagManifestToArtifactInput(
    manifest: SessionManifest,
): ObservabilityArtifactDescriptorInputV1 {
    return {
        artifactId: diagArtifactId(manifest.sessionId),
        kind: "diagStream",
        featureId: "sessionDiag",
        schema: manifest.schemaVersion,
        relativeManifest: "manifest.json",
        createdUtc: manifest.createdUtc,
        status: manifest.status,
        events: manifest.eventCount,
        bytes: manifest.sizeBytes ?? 0,
        gaps: manifest.gapCount,
        truncations: 0,
        classification: {
            containsRichPayload: false,
            // Elevated (full) Plane-A capture may hold governed user text;
            // digest/redacted streams stay metadata-class.
            maximumClass: manifest.captureMode === "full" ? "user.text" : "diagnostic.metadata",
            policyId: manifest.policyId,
        },
    };
}

function diagManifestToArtifact(
    manifest: SessionManifest,
    nowUtc: string,
): ObservabilityArtifactDescriptorV1 {
    return {
        ...diagManifestToArtifactInput(manifest),
        createdUtc: manifest.createdUtc,
        updatedUtc: manifest.updatedUtc ?? nowUtc,
    };
}

function featureCaptureManifestToArtifact(
    manifest: FeatureCaptureManifestV1,
    relativeManifest: string,
    captureSessionId: string,
    nowUtc: string,
): ObservabilityArtifactDescriptorV1 {
    return {
        artifactId: `fc-${manifest.stream?.captureSessionId ?? captureSessionId}`,
        kind: "featureCapture",
        featureId: manifest.stream?.featureId ?? "unknown",
        schema: manifest.schema,
        relativeManifest,
        createdUtc: manifest.createdUtc ?? nowUtc,
        updatedUtc: manifest.updatedUtc ?? nowUtc,
        status: manifest.status ?? "partial",
        records: manifest.totals?.records ?? 0,
        events: manifest.totals?.events ?? 0,
        bytes: manifest.totals?.bytes ?? 0,
        gaps: manifest.totals?.droppedRecords ?? 0,
        truncations: 0,
        classification: {
            // The child manifest records a policy id, not its fidelity —
            // rebuild stays conservative: rich until proven otherwise, and
            // an unknown maximum class refuses central preview by rank.
            containsRichPayload: true,
            maximumClass: "unknown",
            policyId: manifest.stream?.capturePolicyId ?? "unknown",
        },
    };
}

function replayManifestToArtifact(
    manifest: Record<string, unknown>,
    relativeManifest: string,
    replayRunId: string,
    nowUtc: string,
): ObservabilityArtifactDescriptorV1 {
    const status = typeof manifest.status === "string" ? manifest.status : undefined;
    return {
        artifactId: typeof manifest.replayRunId === "string" ? manifest.replayRunId : replayRunId,
        kind: "replayRun",
        ...(typeof manifest.featureId === "string" ? { featureId: manifest.featureId } : {}),
        schema: typeof manifest.schema === "string" ? manifest.schema : "unknown",
        relativeManifest,
        createdUtc: typeof manifest.createdUtc === "string" ? manifest.createdUtc : nowUtc,
        updatedUtc: nowUtc,
        status:
            status === "completed" || status === "cancelled"
                ? "closed"
                : status === "queued" || status === "running" || status === "cancelling"
                  ? "active"
                  : "partial",
        bytes: typeof manifest.bytes === "number" ? manifest.bytes : 0,
        gaps: 0,
        truncations: 0,
        classification: {
            containsRichPayload: true,
            maximumClass: "unknown",
            policyId: typeof manifest.policyId === "string" ? manifest.policyId : "unknown",
        },
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveBundleStatus(
    artifacts: readonly ObservabilityArtifactDescriptorV1[],
    fallback: ObservabilityBundleStatus,
): ObservabilityBundleStatus {
    if (artifacts.length === 0) {
        return fallback;
    }
    if (artifacts.some((artifact) => artifact.status === "active")) {
        return "active";
    }
    if (
        artifacts.some(
            (artifact) =>
                artifact.status === "partial" ||
                artifact.status === "invalid" ||
                artifact.status === "missing",
        )
    ) {
        return "partial";
    }
    return "closed";
}

function cloneBundle(bundle: ObservabilityBundleV1): ObservabilityBundleV1 {
    return JSON.parse(JSON.stringify(bundle)) as ObservabilityBundleV1;
}
