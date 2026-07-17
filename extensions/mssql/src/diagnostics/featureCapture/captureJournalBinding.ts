/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Feature-capture journal binding (final plan WI-2.4 — the M2 "dark journal"
 * write path). Binds a FeatureCaptureStore's typed lifecycle hooks to
 * bounded journal writers, one stream per capture epoch:
 *
 *   <storeRoot>/sessions/<hostSessionId>/rich/<featureId>/<captureSessionId>/
 *
 * Record mapping (documented contract):
 * - addEvent with a non-terminal (pending) result → `event.created` (rev 1,
 *   value = the ring event);
 * - updateEvent/addEvent reaching a terminal result → `event.finalized`
 *   (revision incremented per captureEventId; the binding tracks revisions,
 *   so eviction-then-finalize keeps ONE logical journal event);
 * - a terminal event whose captureEventId was never journaled (e.g. a skip
 *   recorded without a pending phase) writes an `event.created` +
 *   `event.finalized` PAIR so the reducer's lifecycle invariants (acceptance
 *   only after finalization, explicit terminal state) hold uniformly;
 * - a mutation with kind "acceptance" (threaded from mutateEvent) →
 *   `acceptance.changed`; other mutation kinds are not journaled;
 * - intermediate pending→pending replacements (stage churn) are NOT
 *   journaled — the journal keeps lifecycle records, not read-model noise;
 * - events WITHOUT a link block (imported/legacy) have no durable identity
 *   and are skipped + counted (health().linklessSkipped).
 *
 * Policy semantics (addendum §3.3 Amendment C / §9.2):
 * - the binding is active only while the injected policy provider returns a
 *   snapshot with persistence "localJournal" — arming stays the store's
 *   business (shouldCapture gates event creation; the binding follows);
 * - a policy NEVER mutates mid-stream: refreshPolicy() with a different
 *   policyId closes the stream and the next event opens a new one. Because
 *   stream identity (captureSessionId) is frozen by the epoch, the roll
 *   lands in a sibling directory `<captureSessionId>--<phase>` whose header
 *   still carries the true epoch id;
 * - fidelity is enforced AT APPEND TIME: under contentRedacted/digestOnly
 *   every record value passes the injected redaction before tryWrite. The
 *   reducer's resurrection guard is a backstop, never the mechanism.
 *
 * Performance/failure contract: hooks fire on the completion hot path — the
 * binding does synchronous tryWrite (bounded queue, no fs) plus revision-map
 * upkeep only. Every handler is wrapped; a journal (or catalog) failure can
 * never affect the product or the live ring (§2.3).
 */

import { RichCapturePolicySnapshot } from "../../sharedInterfaces/featureTrace";
import { logger2 } from "../../models/logger2";
import {
    FeatureCaptureEventBase,
    FeatureCaptureLifecycleHooks,
    FeatureCaptureStore,
} from "./captureStore";
import {
    FeatureCaptureJournalWriter,
    FeatureCaptureJournalWriterHealth,
    FeatureCaptureJournalWriterOptions,
    JournalClock,
    JournalFsLike,
    joinPath,
} from "./journal/journalWriter";

// ---------------------------------------------------------------------------
// Seams
// ---------------------------------------------------------------------------

/**
 * The slice of ObservabilityBundleManager the binding needs — narrow so tests
 * inject a recorder and the binding never learns catalog internals.
 */
export interface CaptureJournalBundleRegistrar {
    registerArtifact(
        hostSessionId: string,
        input: {
            artifactId: string;
            kind: "featureCapture";
            featureId: string;
            schema: string;
            relativeManifest: string;
            status: "active" | "closed" | "partial";
            records?: number;
            events?: number;
            bytes: number;
            gaps: number;
            truncations: number;
            classification: {
                containsRichPayload: boolean;
                maximumClass: string;
                policyId: string;
                replayPayloadAvailable?: boolean;
            };
        },
    ): Promise<void>;
    closeArtifact(
        hostSessionId: string,
        artifactId: string,
        patch?: {
            status?: "active" | "closed" | "partial" | "invalid" | "missing";
            records?: number;
            events?: number;
            bytes: number;
            gaps: number;
        },
    ): Promise<boolean>;
    /**
     * Optional (WI-2.8): surface the latest ring↔journal reconciliation
     * outcome on the bundle's health row. Health-only — never persisted
     * into bundle.json.
     */
    noteReconciliation?(
        hostSessionId: string,
        info: { atUtc: string; matches: boolean; mismatchCount: number },
    ): void;
}

export interface FeatureCaptureJournalBindingOptions<
    TEvent extends FeatureCaptureEventBase,
    TOverrides,
> {
    store: FeatureCaptureStore<TEvent, TOverrides>;
    /** The session-diag store root (DiagnosticsManager's SessionStore root). */
    storeRoot: string;
    /** The live extension-host session (diag.sessionId). */
    hostSessionId: string;
    /** Schema id of the journaled event values. */
    eventSchema: string;
    /** Schema id of the feature's overrides object (header metadata). */
    overridesSchema: string;
    /**
     * Effective capture policy, consulted at stream open and on
     * refreshPolicy(). Returning undefined (or persistence !== localJournal)
     * deactivates the binding — the settings-compatibility gate.
     */
    policyProvider: () => RichCapturePolicySnapshot | undefined;
    /**
     * Append-time fidelity enforcement: applied to event values under a
     * redacted policy (completions passes its trace redaction extended to
     * cover locals/error content). Must return a JSON-safe clone.
     */
    redactEventValue: (event: TEvent) => TEvent;
    /** True when the event reached a terminal (non-pending) result. */
    isTerminal: (event: TEvent) => boolean;
    /**
     * Map a mutateEvent hook (with its mutation-kind hint) to the
     * acceptance.changed record value; undefined = mutation not journaled.
     */
    acceptanceValue?: (event: TEvent, mutationKind: string) => unknown | undefined;
    bundleRegistrar?: CaptureJournalBundleRegistrar;
    /** Classification the bundle descriptor should claim for a policy. */
    classifyPolicy?: (policy: RichCapturePolicySnapshot) => {
        containsRichPayload: boolean;
        maximumClass: string;
        replayPayloadAvailable: boolean;
    };
    fs?: JournalFsLike;
    clock?: JournalClock;
    writerOptions?: Omit<
        FeatureCaptureJournalWriterOptions,
        "directory" | "header" | "fs" | "clock"
    >;
}

export interface FeatureCaptureJournalBindingHealth {
    /** Whether a localJournal policy is currently in force. */
    active: boolean;
    policyId?: string;
    fidelity?: RichCapturePolicySnapshot["fidelity"];
    /** Directory of the open stream, when one has been opened this phase. */
    streamDirectory?: string;
    writer?: FeatureCaptureJournalWriterHealth;
    /** Events skipped because they carried no durable link identity. */
    linklessSkipped: number;
    /** Streams opened this epoch (>1 after a mid-epoch policy change). */
    epochPhase: number;
    /**
     * Cumulative dropped records across ALL streams of the CURRENT epoch
     * (closed policy phases + the open writer) — the journal-primary
     * deactivate decision needs epoch-wide honesty, not just the open
     * writer's counters (WI-2.7).
     */
    epochDroppedRecords: number;
    lastError?: string;
    lastReconciliation?: { atUtc: string; matches: boolean; mismatchCount: number };
}

/**
 * Default classification (documented WI-2.4 decision, ranks per
 * bundleSchemas.PAYLOAD_CLASS_RANK):
 * - fullLocal streams hold raw model replies → containsRichPayload TRUE,
 *   maximumClass "model.response" (the top of what completions stores);
 * - contentRedacted streams have prompts/responses/schema text/locals/error
 *   content replaced at append time; what remains is document names/URIs →
 *   containsRichPayload FALSE, maximumClass "source.path";
 * - digestOnly (unused by completions today) → metadata only.
 */
export function defaultClassifyCapturePolicy(policy: RichCapturePolicySnapshot): {
    containsRichPayload: boolean;
    maximumClass: string;
    replayPayloadAvailable: boolean;
} {
    switch (policy.fidelity) {
        case "fullLocal":
            return {
                containsRichPayload: true,
                maximumClass: "model.response",
                replayPayloadAvailable: true,
            };
        case "contentRedacted":
            return {
                containsRichPayload: false,
                maximumClass: "source.path",
                replayPayloadAvailable: false,
            };
        case "digestOnly":
            return {
                containsRichPayload: false,
                maximumClass: "diagnostic.metadata",
                replayPayloadAvailable: false,
            };
    }
}

const BUNDLE_SYNC_DEBOUNCE_MS = 2_000;

export class FeatureCaptureJournalBinding<TEvent extends FeatureCaptureEventBase, TOverrides> {
    private readonly _logger = logger2.withPrefix("CaptureJournalBinding");
    private readonly _options: FeatureCaptureJournalBindingOptions<TEvent, TOverrides>;
    private readonly _hooksDisposable: { dispose(): void };

    private _writer:
        | FeatureCaptureJournalWriter<TEvent, TEvent, unknown, Record<string, unknown>>
        | undefined;
    private _currentPolicy: RichCapturePolicySnapshot | undefined;
    private _epochId: string;
    private _epochPhase = 1;
    /** Highest journaled revision per captureEventId, for the CURRENT epoch. */
    private readonly _revisions = new Map<string, number>();
    /** Stream directories opened this epoch (phase rolls append here). */
    private _epochStreamDirectories: string[] = [];
    /** Drops accumulated from streams already closed this epoch. */
    private _closedStreamDrops = 0;
    private _linklessSkipped = 0;
    private _lastError: string | undefined;
    private _lastReconciliation:
        | { atUtc: string; matches: boolean; mismatchCount: number }
        | undefined;
    private _bundleSyncTimer: NodeJS.Timeout | undefined;
    private _closeChain: Promise<void> = Promise.resolve();
    private _disposed = false;

    constructor(options: FeatureCaptureJournalBindingOptions<TEvent, TOverrides>) {
        this._options = options;
        this._epochId = options.store.captureSessionId;
        this._currentPolicy = this.resolvePolicy();
        const hooks: FeatureCaptureLifecycleHooks<TEvent> = {
            onEventAdded: (event) => this.guard(() => this.handleEventAdded(event)),
            onEventReplaced: (event) => this.guard(() => this.handleEventReplaced(event)),
            onEventMutated: (event, kind) => this.guard(() => this.handleEventMutated(event, kind)),
            onEpochChanged: (reason, captureSessionId) =>
                this.guard(() => this.handleEpochChanged(reason, captureSessionId)),
        };
        this._hooksDisposable = options.store.registerLifecycleHooks(hooks);
    }

    // -- public surface ---------------------------------------------------------

    public get isActive(): boolean {
        return this._currentPolicy !== undefined;
    }

    public get activePolicy(): RichCapturePolicySnapshot | undefined {
        return this._currentPolicy;
    }

    /** The host session every stream of this binding belongs to. */
    public get hostSessionId(): string {
        return this._options.hostSessionId;
    }

    /** The epoch this binding is currently journaling. */
    public get epochId(): string {
        return this._epochId;
    }

    /** Stream directories written for the CURRENT epoch (phase rolls > 1). */
    public get currentEpochStreamDirectories(): readonly string[] {
        return [...this._epochStreamDirectories];
    }

    /** The directory the CURRENT (or next lazily-opened) stream targets. */
    public get currentStreamDirectory(): string {
        return this.streamDirectory(this._epochId, this._epochPhase);
    }

    /**
     * Re-read the policy provider (call on settings changes). Same policyId →
     * no-op; changed policyId → the stream closes and the next event opens a
     * fresh one (a policy never mutates mid-stream, §9.2); no policy → stop.
     */
    public refreshPolicy(): void {
        this.guard(() => {
            const next = this.resolvePolicy();
            const current = this._currentPolicy;
            if (next === undefined && current === undefined) {
                return;
            }
            if (next !== undefined && current !== undefined && next.policyId === current.policyId) {
                this._currentPolicy = next;
                return;
            }
            if (this._writer) {
                this.closeCurrentStream("policyChange");
                this._epochPhase++;
            }
            this._currentPolicy = next;
        });
    }

    /** Flush queued records + catalog updates now (save/export/test barrier). */
    public async flushBarrier(): Promise<void> {
        const writer = this._writer;
        if (writer) {
            await writer.flushBarrier();
            await this.syncBundleNow();
        }
        await this._closeChain;
    }

    /**
     * Deactivation: unhook from the store, flush, and close the stream. The
     * legacy save-on-deactivate path is untouched (M2 is dual-write).
     * Idempotent; never rejects.
     */
    public async dispose(): Promise<void> {
        if (this._disposed) {
            await this._closeChain;
            return;
        }
        this._disposed = true;
        this._hooksDisposable.dispose();
        this.cancelBundleTimer();
        this.guard(() => this.closeCurrentStream("dispose"));
        await this._closeChain;
    }

    public noteReconciliation(report: { matches: boolean; mismatches: readonly unknown[] }): void {
        this._lastReconciliation = {
            atUtc: new Date((this._options.clock ?? { now: () => Date.now() }).now()).toISOString(),
            matches: report.matches,
            mismatchCount: report.mismatches.length,
        };
        // WI-2.8: the bundle catalog's health rows carry the same outcome.
        try {
            this._options.bundleRegistrar?.noteReconciliation?.(
                this._options.hostSessionId,
                this._lastReconciliation,
            );
        } catch (error) {
            this.noteError("forwarding the reconciliation outcome", error);
        }
    }

    public health(): FeatureCaptureJournalBindingHealth {
        return {
            active: this.isActive,
            ...(this._currentPolicy
                ? { policyId: this._currentPolicy.policyId, fidelity: this._currentPolicy.fidelity }
                : {}),
            ...(this._writer ? { streamDirectory: this._writer.directory } : {}),
            ...(this._writer ? { writer: this._writer.health() } : {}),
            linklessSkipped: this._linklessSkipped,
            epochPhase: this._epochPhase,
            epochDroppedRecords:
                this._closedStreamDrops + (this._writer?.statsSnapshot().droppedRecords ?? 0),
            ...(this._lastError ? { lastError: this._lastError } : {}),
            ...(this._lastReconciliation ? { lastReconciliation: this._lastReconciliation } : {}),
        };
    }

    // -- lifecycle handlers -------------------------------------------------------

    private handleEventAdded(event: TEvent): void {
        if (!this._currentPolicy || this._disposed) {
            return;
        }
        const captureEventId = event.link?.captureEventId;
        if (!captureEventId) {
            this._linklessSkipped++;
            return;
        }
        const writer = this.ensureWriter();
        if (!writer) {
            return;
        }
        const value = this.applyFidelity(event);
        const known = this._revisions.get(captureEventId);
        if (known === undefined) {
            this._revisions.set(captureEventId, 1);
            writer.tryWrite({
                kind: "event.created",
                eventRevision: 1,
                captureEventId,
                at: event.timestamp,
                value,
            });
            if (this._options.isTerminal(event)) {
                // Directly-terminal first record (e.g. a skip with no pending
                // phase): keep lifecycle uniform with an immediate finalize.
                this._revisions.set(captureEventId, 2);
                writer.tryWrite({
                    kind: "event.finalized",
                    eventRevision: 2,
                    captureEventId,
                    at: event.timestamp,
                    value,
                });
            }
        } else if (this._options.isTerminal(event)) {
            // Eviction-then-finalize lands here: the ring re-added a fresh row
            // for a captureEventId already journaled — ONE logical event.
            const revision = known + 1;
            this._revisions.set(captureEventId, revision);
            writer.tryWrite({
                kind: "event.finalized",
                eventRevision: revision,
                captureEventId,
                at: event.timestamp,
                value,
            });
        }
        // Duplicate pending for a known id: read-model churn, not journaled.
        this.scheduleBundleSync();
    }

    private handleEventReplaced(event: TEvent): void {
        if (!this._currentPolicy || this._disposed) {
            return;
        }
        const captureEventId = event.link?.captureEventId;
        if (!captureEventId) {
            this._linklessSkipped++;
            return;
        }
        if (!this._options.isTerminal(event)) {
            return; // pending-stage churn stays a read-model concern
        }
        const writer = this.ensureWriter();
        if (!writer) {
            return;
        }
        const value = this.applyFidelity(event);
        const known = this._revisions.get(captureEventId);
        if (known === undefined) {
            // Terminal replacement for an id the journal never saw (created
            // was skipped/lost): write the uniform created+finalized pair.
            this._revisions.set(captureEventId, 2);
            writer.tryWrite({
                kind: "event.created",
                eventRevision: 1,
                captureEventId,
                at: event.timestamp,
                value,
            });
            writer.tryWrite({
                kind: "event.finalized",
                eventRevision: 2,
                captureEventId,
                at: event.timestamp,
                value,
            });
        } else {
            const revision = known + 1;
            this._revisions.set(captureEventId, revision);
            writer.tryWrite({
                kind: "event.finalized",
                eventRevision: revision,
                captureEventId,
                at: event.timestamp,
                value,
            });
        }
        this.scheduleBundleSync();
    }

    private handleEventMutated(event: TEvent, mutationKind: string): void {
        if (!this._currentPolicy || this._disposed) {
            return;
        }
        const captureEventId = event.link?.captureEventId;
        if (!captureEventId) {
            this._linklessSkipped++;
            return;
        }
        const value = this._options.acceptanceValue?.(event, mutationKind);
        if (value === undefined) {
            return; // unmapped mutation kinds are not journaled
        }
        const writer = this.ensureWriter();
        if (!writer) {
            return;
        }
        const revision = (this._revisions.get(captureEventId) ?? 1) + 1;
        this._revisions.set(captureEventId, revision);
        writer.tryWrite({
            kind: "acceptance.changed",
            eventRevision: revision,
            captureEventId,
            at: (this._options.clock ?? { now: () => Date.now() }).now(),
            value,
        });
        this.scheduleBundleSync();
    }

    private handleEpochChanged(_reason: "clear" | "import", captureSessionId: string): void {
        this.closeCurrentStream("epochChange");
        this._epochId = captureSessionId;
        this._epochPhase = 1;
        this._revisions.clear();
        this._epochStreamDirectories = [];
        this._closedStreamDrops = 0;
        this._linklessSkipped = 0;
        // The next stream opens lazily on the first event of the new epoch.
    }

    // -- stream lifecycle ---------------------------------------------------------

    private streamDirName(epochId: string, phase: number): string {
        // Phase 1 keeps the plain epoch directory; policy rolls within one
        // epoch land in `<epoch>--<phase>` siblings (the header still carries
        // the true captureSessionId, so identity checks hold).
        return phase === 1 ? epochId : `${epochId}--${phase}`;
    }

    private streamDirectory(epochId: string, phase: number): string {
        const options = this._options;
        return joinPath(
            options.storeRoot,
            `sessions/${options.hostSessionId}/rich/${options.store.featureId}/${this.streamDirName(epochId, phase)}`,
        );
    }

    private ensureWriter():
        | FeatureCaptureJournalWriter<TEvent, TEvent, unknown, Record<string, unknown>>
        | undefined {
        if (this._writer) {
            return this._writer;
        }
        const policy = this._currentPolicy;
        if (!policy) {
            return undefined;
        }
        const options = this._options;
        const directory = this.streamDirectory(this._epochId, this._epochPhase);
        this._writer = new FeatureCaptureJournalWriter<
            TEvent,
            TEvent,
            unknown,
            Record<string, unknown>
        >({
            directory,
            header: {
                featureId: options.store.featureId,
                hostSessionId: options.hostSessionId,
                captureSessionId: this._epochId,
                eventSchema: options.eventSchema,
                overridesSchema: options.overridesSchema,
                capturePolicy: policy,
            },
            ...(options.fs ? { fs: options.fs } : {}),
            ...(options.clock ? { clock: options.clock } : {}),
            ...(options.writerOptions ?? {}),
        });
        this._epochStreamDirectories.push(directory);
        void this.syncBundleNow();
        return this._writer;
    }

    /** Close the active stream (flush barrier); never blocks the caller. */
    private closeCurrentStream(reason: string): void {
        const writer = this._writer;
        if (!writer) {
            return;
        }
        this._writer = undefined;
        // Snapshot drops synchronously so epoch-wide accounting stays honest
        // even before the async close settles (post-close drops still reach
        // the manifest; this counter is the fast-path summary).
        this._closedStreamDrops += writer.statsSnapshot().droppedRecords;
        this.cancelBundleTimer();
        const artifactId = this.artifactIdFor(writer.directory);
        this._closeChain = this._closeChain
            .then(async () => {
                await writer.close();
                const stats = writer.statsSnapshot();
                await this._options.bundleRegistrar?.closeArtifact(
                    this._options.hostSessionId,
                    artifactId,
                    {
                        status: stats.status === "active" ? "closed" : stats.status,
                        records: stats.records,
                        events: stats.events,
                        bytes: stats.bytes,
                        gaps: stats.droppedRecords,
                    },
                );
            })
            .catch((error) => {
                this.noteError(`closing the journal stream (${reason})`, error);
            });
    }

    private applyFidelity(event: TEvent): TEvent {
        const fidelity = this._currentPolicy?.fidelity;
        if (fidelity === "contentRedacted" || fidelity === "digestOnly") {
            return this._options.redactEventValue(event);
        }
        return event;
    }

    // -- bundle catalog notifications ----------------------------------------------

    private artifactIdFor(directory: string): string {
        const dirName = directory.split(/[/\\]/).filter(Boolean).pop() ?? this._epochId;
        return `fc-${dirName}`;
    }

    private scheduleBundleSync(): void {
        if (this._bundleSyncTimer || !this._options.bundleRegistrar || this._disposed) {
            return;
        }
        this._bundleSyncTimer = setTimeout(() => {
            this._bundleSyncTimer = undefined;
            void this.syncBundleNow();
        }, BUNDLE_SYNC_DEBOUNCE_MS);
        this._bundleSyncTimer.unref?.();
    }

    private cancelBundleTimer(): void {
        if (this._bundleSyncTimer) {
            clearTimeout(this._bundleSyncTimer);
            this._bundleSyncTimer = undefined;
        }
    }

    private async syncBundleNow(): Promise<void> {
        const registrar = this._options.bundleRegistrar;
        const writer = this._writer;
        const policy = this._currentPolicy;
        if (!registrar || !writer || !policy) {
            return;
        }
        try {
            const stats = writer.statsSnapshot();
            const dirName = this.streamDirName(this._epochId, this._epochPhase);
            const classify = this._options.classifyPolicy ?? defaultClassifyCapturePolicy;
            const classification = classify(policy);
            await registrar.registerArtifact(this._options.hostSessionId, {
                artifactId: `fc-${dirName}`,
                kind: "featureCapture",
                featureId: this._options.store.featureId,
                schema: "mssql.featureCapture.manifest/1",
                relativeManifest: `rich/${this._options.store.featureId}/${dirName}/manifest.json`,
                status: stats.status,
                records: stats.records,
                events: stats.events,
                bytes: stats.bytes,
                gaps: stats.droppedRecords,
                truncations: 0,
                classification: {
                    containsRichPayload: classification.containsRichPayload,
                    maximumClass: classification.maximumClass,
                    policyId: policy.policyId,
                    replayPayloadAvailable: classification.replayPayloadAvailable,
                },
            });
        } catch (error) {
            this.noteError("updating the bundle catalog", error);
        }
    }

    // -- failure isolation ----------------------------------------------------------

    private resolvePolicy(): RichCapturePolicySnapshot | undefined {
        try {
            const policy = this._options.policyProvider();
            return policy && policy.persistence === "localJournal" ? policy : undefined;
        } catch (error) {
            this.noteError("resolving the capture policy", error);
            return undefined;
        }
    }

    private guard(fn: () => void): void {
        try {
            fn();
        } catch (error) {
            this.noteError("handling a capture lifecycle notification", error);
        }
    }

    private noteError(action: string, error: unknown): void {
        this._lastError = `${action} failed: ${error instanceof Error ? error.message : String(error)}`;
        this._logger.warn(`Journal binding degraded (isolated) — ${this._lastError}`);
    }
}
