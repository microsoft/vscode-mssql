/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Metadata cache coordinator (CACHE-2; cache/drift design §9/§14, review
 * addendum C-5/§5.5/H-4/H-7): the policy brain between the MetadataStore
 * (CACHE-3 wires it) and the filesystem store.
 *
 * LOAD: reads a sha-verified entry, applies the C-5 privacy/policy
 * intersection IN BOTH DIRECTIONS — a section excluded by current policy,
 * or absent from the payload regardless of what the manifest's readiness
 * claims, comes back "absent", NEVER ready-and-empty (the empty-vs-failed
 * invariant, now minted from disk). A policyId mismatch is a normal load
 * with `policyIntersected: true`, not corruption. The snapshot publishes
 * with `generation = manifest.capture.publishedGeneration` (C-2.4).
 *
 * SAVE: debounced by writeDelayMs (coalescing bursts — latest snapshot
 * wins), gated by the base §14 rule (objects+schemas ready and at least one
 * of columns/keys/foreignKeys/parameters ready). Addendum deltas: §5.5 —
 * when the contentHash equals the manifest's under the same policy, only
 * the validation block is rewritten (manifest-last protocol, no payload
 * write); H-4.4 — a newer manifest on disk skips the save
 * (skipped:"newerExists"), writerId "<pid>:<nonce>" travels in the
 * manifest; H-4.5 — one post-save manifest re-read detects a lost
 * two-writer race (raceLost, benign, no retry); H-7 — compressed payloads
 * over maxEntryBytes skip (skipped:"entryTooLarge").
 *
 * Observability: metadataCache.* events through the diag facade, fields
 * strictly from the addendum App C allowlist. contentHash prefixes stay
 * OUT of events (addendum §12 Q2 pending) — they ride returned outcomes
 * only.
 */

import { diag, RawField } from "../../../diagnostics/diagnosticsCore";
import { CatalogSection, CatalogSnapshot, SectionState } from "../catalogModel";
import { staleAgeBucket } from "./metadataFreshness";
import {
    canonicalPayloadJson,
    CATALOG_MODEL_VERSION,
    CatalogCachePayloadV1,
    computeContentHash,
    rehydrateSnapshot,
    serializeSnapshot,
    stripDescriptions,
} from "./metadataCacheCodec";
import {
    CACHE_CODEC,
    CACHE_FORMAT_VERSION,
    CACHE_PAYLOAD_FILE,
    CatalogCacheManifest,
} from "./metadataCacheManifest";
import {
    CacheEntryKey,
    CacheMissReason,
    computeDatabaseHash,
    EvictionSummary,
    MetadataCacheStore,
} from "./metadataCacheStore";
import { MetadataCacheSettings } from "./metadataCacheSettings";

export type CacheLoadResult =
    | {
          readonly snapshot: CatalogSnapshot;
          readonly manifest: CatalogCacheManifest;
          /** C-5: current policy or payload absence forced sections absent. */
          readonly policyIntersected: boolean;
      }
    | { readonly miss: true; readonly reason: CacheMissReason };

export type CacheSaveSkipReason = "disabled" | "notEligible" | "newerExists" | "entryTooLarge";

export interface CacheSaveOutcome {
    readonly result: "saved" | "manifestOnly" | "skipped" | "failed" | "raceLost";
    readonly skipped?: CacheSaveSkipReason;
    readonly errorClass?: string;
    readonly payloadBytes?: number;
    /** May appear in returned status objects; NEVER in events (App C Q2). */
    readonly contentHash?: string;
}

export interface CacheSaveOptions {
    /** Validation block for the manifest (CACHE-3 passes digest state). */
    readonly validation?: CatalogCacheManifest["validation"];
}

export interface MetadataCacheCoordinatorOptions {
    readonly producer?: {
        readonly extensionVersion?: string;
        /** VS Code version string (addendum §5.1). */
        readonly appVersion?: string;
        readonly gitCommit?: string;
    };
    /** H-10: kick an eviction pass after each full save (default true). */
    readonly evictAfterSave?: boolean;
    readonly now?: () => number;
    readonly pid?: number;
    readonly random?: () => number;
}

interface PendingSave {
    key: CacheEntryKey;
    snapshot: CatalogSnapshot;
    options: CacheSaveOptions | undefined;
    timer: ReturnType<typeof setTimeout>;
}

const pendingKeyOf = (key: CacheEntryKey): string => `${key.serverFingerprint}|${key.database}`;

export class MetadataCacheCoordinator {
    private readonly now: () => number;
    private readonly pid: number;
    private readonly random: () => number;
    private readonly evictAfterSave: boolean;
    private readonly pending = new Map<string, PendingSave>();
    private nonceCounter = 0;
    private disposed = false;

    constructor(
        private readonly store: MetadataCacheStore,
        private readonly settings: () => MetadataCacheSettings,
        private readonly options: MetadataCacheCoordinatorOptions = {},
    ) {
        this.now = options.now ?? (() => Date.now());
        this.pid = options.pid ?? process.pid;
        this.random = options.random ?? (() => Math.random());
        this.evictAfterSave = options.evictAfterSave ?? true;
    }

    // -- load -------------------------------------------------------------------

    async load(key: CacheEntryKey): Promise<CacheLoadResult> {
        const startedAt = this.now();
        const settings = this.settings();
        if (!settings.enabled) {
            return this.miss(key, "disabled");
        }
        const read = await this.store.readEntry(key);
        if (read.kind === "miss") {
            return this.miss(key, read.reason);
        }
        const manifest = read.manifest;

        // C-5 intersection, both directions. Start from the manifest's
        // readiness; force excluded/absent sections to "absent".
        const readiness: Partial<Record<CatalogSection, SectionState>> = { ...manifest.readiness };
        let policyIntersected = manifest.privacy.policyId !== settings.policyId;
        let payload: CatalogCachePayloadV1 = read.payload;
        const payloadHasDescriptions = payload.descriptionOwner !== undefined;
        const descriptionsAllowed = settings.persistDescriptions;
        if (!descriptionsAllowed || !payloadHasDescriptions) {
            if (readiness.descriptions !== undefined && readiness.descriptions !== "absent") {
                policyIntersected = true;
            }
            readiness.descriptions = "absent";
            if (payloadHasDescriptions) {
                // Data DROPPED, not merely hidden: strip before adoption so
                // no description prose survives into the snapshot (T-A8).
                payload = stripDescriptions(payload);
                policyIntersected = true;
            }
        }
        // Never persisted in v1: row counts and module definitions. A
        // manifest claiming otherwise is intersected down, not trusted.
        if (readiness.rowCounts !== undefined && readiness.rowCounts !== "absent") {
            readiness.rowCounts = "absent";
            policyIntersected = true;
        }

        const snapshot = rehydrateSnapshot(payload, {
            generation: manifest.capture.publishedGeneration,
            readiness,
            mode: manifest.mode,
        });
        const ageMs = Math.max(0, this.now() - Date.parse(manifest.capture.capturedAtUtc));
        this.emit("metadataCache.load", key, {
            generation: {
                raw: String(manifest.capture.publishedGeneration),
                cls: "diagnostic.metadata",
            },
            readinessSummary: {
                raw: readinessSummary(snapshot.readiness),
                cls: "diagnostic.metadata",
            },
            staleAgeBucket: {
                raw: staleAgeBucket(Number.isFinite(ageMs) ? ageMs : 0),
                cls: "diagnostic.metadata",
            },
            payloadBytes: { raw: read.payloadBytes, cls: "diagnostic.metadata" },
            durationMs: { raw: this.now() - startedAt, cls: "diagnostic.metadata" },
            policyIntersected: { raw: policyIntersected, cls: "diagnostic.metadata" },
            source: { raw: "disk", cls: "diagnostic.metadata" },
        });
        this.emit("metadataCache.hit", key, {
            generation: {
                raw: String(manifest.capture.publishedGeneration),
                cls: "diagnostic.metadata",
            },
        });
        return { snapshot, manifest, policyIntersected };
    }

    private miss(key: CacheEntryKey, reason: CacheMissReason): CacheLoadResult {
        this.emit("metadataCache.miss", key, {
            reason: { raw: reason, cls: "diagnostic.metadata" },
        });
        return { miss: true, reason };
    }

    // -- save (debounced; base §14) ----------------------------------------------

    /**
     * Schedule a debounced save. Calls within writeDelayMs coalesce; the
     * LATEST snapshot wins (base §14 "coalesce multiple refreshes").
     */
    save(key: CacheEntryKey, snapshot: CatalogSnapshot, options?: CacheSaveOptions): void {
        if (this.disposed) {
            return;
        }
        const id = pendingKeyOf(key);
        const existing = this.pending.get(id);
        if (existing) {
            clearTimeout(existing.timer);
        }
        const timer = setTimeout(() => {
            const entry = this.pending.get(id);
            this.pending.delete(id);
            if (entry) {
                void this.saveNow(entry.key, entry.snapshot, entry.options).catch(() => {
                    /* outcomes travel via events; never throw into timers */
                });
            }
        }, this.settings().writeDelayMs);
        (timer as { unref?: () => void }).unref?.();
        this.pending.set(id, { key, snapshot, options, timer });
    }

    /** Flush every pending debounced save immediately (host shutdown/tests). */
    async flush(): Promise<void> {
        const entries = [...this.pending.values()];
        this.pending.clear();
        for (const entry of entries) {
            clearTimeout(entry.timer);
            await this.saveNow(entry.key, entry.snapshot, entry.options).catch(() => undefined);
        }
    }

    async saveNow(
        key: CacheEntryKey,
        snapshot: CatalogSnapshot,
        options?: CacheSaveOptions,
    ): Promise<CacheSaveOutcome> {
        const startedAt = this.now();
        const settings = this.settings();
        if (!settings.enabled) {
            return this.saveSkipped(key, snapshot, "disabled");
        }
        // Base §14 save rule: objects+schemas ready, and ≥1 of
        // columns/keys/foreignKeys/parameters ready.
        const readiness = snapshot.readiness;
        const eligible =
            readiness.objects === "ready" &&
            readiness.schemas === "ready" &&
            (readiness.columns === "ready" ||
                readiness.keys === "ready" ||
                readiness.foreignKeys === "ready" ||
                readiness.parameters === "ready");
        if (!eligible) {
            return this.saveSkipped(key, snapshot, "notEligible");
        }

        const payload = serializeSnapshot(snapshot, {
            includeDescriptions: settings.persistDescriptions,
        });
        const contentHash = computeContentHash(payload);
        if (snapshot.contentHash === undefined) {
            snapshot.setContentHashOnce(contentHash);
        }
        const validation: CatalogCacheManifest["validation"] = options?.validation ?? {
            lastValidatedAtUtc: new Date(this.now()).toISOString(),
            validationTier: "fullRefresh",
        };

        const current = await this.store.readManifest(key);
        if (current) {
            // H-4.4 fairness guard: never clobber a strictly newer capture.
            const currentCaptured = Date.parse(current.capture.capturedAtUtc);
            const ourCaptured = Date.parse(snapshot.capturedAtUtc);
            if (
                Number.isFinite(currentCaptured) &&
                Number.isFinite(ourCaptured) &&
                currentCaptured > ourCaptured &&
                current.capture.publishedGeneration >= snapshot.generation
            ) {
                return this.saveSkipped(key, snapshot, "newerExists");
            }
            // §5.5: refresh confirmed no change ⇒ manifest-only rewrite of
            // the validation block; the steady state is a tiny write.
            if (
                current.payload.contentHash === contentHash &&
                current.privacy.policyId === settings.policyId
            ) {
                const bumped: CatalogCacheManifest = { ...current, validation };
                const rewrite = await this.store.rewriteManifest(key, bumped);
                if (!rewrite.ok) {
                    return this.saveFailed(key, snapshot, rewrite.errorClass ?? "ioError");
                }
                this.emitSave(key, snapshot, {
                    result: { raw: "manifestOnly", cls: "diagnostic.metadata" },
                    durationMs: { raw: this.now() - startedAt, cls: "diagnostic.metadata" },
                });
                return { result: "manifestOnly", contentHash };
            }
        }

        const writerId = this.newWriterId();
        const payloadJson = canonicalPayloadJson(payload);
        const outcome = await this.store.writeEntry(
            key,
            payloadJson,
            (payloadInfo) =>
                this.buildManifest(key, snapshot, settings, writerId, contentHash, validation, {
                    sha256: payloadInfo.sha256,
                    payloadBytes: payloadInfo.payloadBytes,
                    uncompressedBytes: payloadInfo.uncompressedBytes,
                }),
            { maxEntryBytes: settings.maxEntryBytes },
        );
        if (outcome.skipped === "entryTooLarge") {
            return this.saveSkipped(key, snapshot, "entryTooLarge", outcome.payloadBytes);
        }
        if (!outcome.ok) {
            return this.saveFailed(key, snapshot, outcome.errorClass ?? "ioError");
        }
        // H-4.5: one post-save re-read; if the manifest is not ours another
        // window won the race — benign, emit raceLost, do not retry.
        const after = await this.store.readManifest(key);
        if (!after || after.writerId !== writerId) {
            this.emit("metadataCache.raceLost", key, {});
            const race: CacheSaveOutcome = { result: "raceLost", contentHash };
            return outcome.payloadBytes === undefined
                ? race
                : { ...race, payloadBytes: outcome.payloadBytes };
        }
        this.emitSave(key, snapshot, {
            result: { raw: "saved", cls: "diagnostic.metadata" },
            payloadBytes: { raw: outcome.payloadBytes ?? 0, cls: "diagnostic.metadata" },
            durationMs: { raw: this.now() - startedAt, cls: "diagnostic.metadata" },
        });
        if (this.evictAfterSave) {
            // H-10: hygiene after saves — async, throttled inside the store,
            // never awaited on the save path.
            void this.store
                .runEviction({ maxAgeDays: settings.maxAgeDays, maxBytes: settings.maxBytes })
                .catch(() => undefined);
        }
        const saved: CacheSaveOutcome = { result: "saved", contentHash };
        return outcome.payloadBytes === undefined
            ? saved
            : { ...saved, payloadBytes: outcome.payloadBytes };
    }

    private buildManifest(
        key: CacheEntryKey,
        snapshot: CatalogSnapshot,
        settings: MetadataCacheSettings,
        writerId: string,
        contentHash: string,
        validation: CatalogCacheManifest["validation"],
        payloadInfo: { sha256: string; payloadBytes: number; uncompressedBytes: number },
    ): CatalogCacheManifest {
        const environment = snapshot.codecView.environment;
        // C-5 save direction: excluded sections are marked absent, never
        // ready — the manifest must agree with what the payload holds.
        const readiness = { ...snapshot.readiness };
        if (!settings.persistDescriptions) {
            readiness.descriptions = "absent";
        }
        readiness.rowCounts = "absent";
        const producer: CatalogCacheManifest["producer"] = {
            catalogModelVersion: CATALOG_MODEL_VERSION,
            cacheCodec: CACHE_CODEC,
            ...(this.options.producer?.extensionVersion !== undefined
                ? { extensionVersion: this.options.producer.extensionVersion }
                : {}),
            ...(this.options.producer?.appVersion !== undefined
                ? { appVersion: this.options.producer.appVersion }
                : {}),
            ...(this.options.producer?.gitCommit !== undefined
                ? { gitCommit: this.options.producer.gitCommit }
                : {}),
        };
        return {
            formatVersion: CACHE_FORMAT_VERSION,
            producer,
            writerId,
            key: {
                serverFingerprint: key.serverFingerprint,
                databaseHash: computeDatabaseHash(key.serverFingerprint, key.database),
                databaseExact: key.database,
            },
            capture: {
                capturedAtUtc: snapshot.capturedAtUtc,
                publishedGeneration: snapshot.generation,
                source: "live",
            },
            validation,
            environment: {
                ...(environment.engineEdition !== undefined
                    ? { engineEdition: environment.engineEdition }
                    : {}),
                ...(environment.collationName !== undefined
                    ? { collationName: environment.collationName }
                    : {}),
                ...(environment.caseSensitive !== undefined
                    ? { caseSensitive: environment.caseSensitive }
                    : {}),
                ...(environment.defaultSchema !== undefined
                    ? { defaultSchema: environment.defaultSchema }
                    : {}),
            },
            readiness,
            mode: snapshot.mode,
            stats: {
                ...snapshot.stats,
                payloadBytes: payloadInfo.payloadBytes,
                uncompressedBytes: payloadInfo.uncompressedBytes,
            },
            privacy: {
                includesDescriptions: settings.persistDescriptions,
                // NEVER true in v1 — module definitions are not in the
                // payload regardless of the setting (C-5.3).
                includesModuleDefinitions: false,
                includesRowCounts: false,
                policyId: settings.policyId,
            },
            payload: {
                file: CACHE_PAYLOAD_FILE,
                sha256: payloadInfo.sha256,
                contentHash,
            },
        };
    }

    // -- clear / maintenance -------------------------------------------------------

    async clearAll(): Promise<void> {
        await this.store.clearAll();
    }

    async clearForConnection(key: CacheEntryKey): Promise<void> {
        await this.store.clearForKey(key);
    }

    /**
     * EXPLICIT maintenance entry point — the host calls this AFTER
     * activation completes (H-10: cache hygiene must never appear in
     * mssql.activate timings).
     */
    runMaintenance(): Promise<EvictionSummary> {
        const settings = this.settings();
        return this.store.runEviction({
            maxAgeDays: settings.maxAgeDays,
            maxBytes: settings.maxBytes,
        });
    }

    dispose(): void {
        this.disposed = true;
        for (const entry of this.pending.values()) {
            clearTimeout(entry.timer);
        }
        this.pending.clear();
    }

    // -- internals ------------------------------------------------------------------

    private newWriterId(): string {
        this.nonceCounter++;
        return `${this.pid}:${this.now().toString(36)}${this.nonceCounter.toString(36)}${Math.floor(
            this.random() * 36 ** 4,
        ).toString(36)}`;
    }

    private saveSkipped(
        key: CacheEntryKey,
        snapshot: CatalogSnapshot,
        skipped: CacheSaveSkipReason,
        payloadBytes?: number,
    ): CacheSaveOutcome {
        this.emitSave(key, snapshot, {
            result: { raw: "skipped", cls: "diagnostic.metadata" },
            skipped: { raw: skipped, cls: "diagnostic.metadata" },
        });
        const outcome: CacheSaveOutcome = { result: "skipped", skipped };
        return payloadBytes === undefined ? outcome : { ...outcome, payloadBytes };
    }

    private saveFailed(
        key: CacheEntryKey,
        snapshot: CatalogSnapshot,
        errorClass: string,
    ): CacheSaveOutcome {
        this.emitSave(key, snapshot, {
            result: { raw: "failed", cls: "diagnostic.metadata" },
            errorClass: { raw: errorClass, cls: "diagnostic.metadata" },
        });
        return { result: "failed", errorClass };
    }

    private emitSave(
        key: CacheEntryKey,
        snapshot: CatalogSnapshot,
        fields: Record<string, RawField>,
    ): void {
        this.emit("metadataCache.save", key, {
            generation: { raw: String(snapshot.generation), cls: "diagnostic.metadata" },
            readinessSummary: {
                raw: readinessSummary(snapshot.readiness),
                cls: "diagnostic.metadata",
            },
            ...fields,
        });
    }

    /**
     * App C allowlist discipline: ONLY hash prefixes, generations,
     * readiness summaries, buckets, byte/duration counts, and safe enums.
     * Never object names, raw database names, SQL text, endpoints, secrets,
     * descriptions — and no contentHash (Q2 pending).
     */
    private emit(type: string, key: CacheEntryKey, fields: Record<string, RawField>): void {
        diag.emit({
            feature: "metadata",
            kind: "event",
            type,
            fields: {
                serverFpPrefix: {
                    raw: key.serverFingerprint.slice(0, 12),
                    cls: "diagnostic.metadata",
                },
                dbHashPrefix: {
                    raw: computeDatabaseHash(key.serverFingerprint, key.database).slice(0, 12),
                    cls: "diagnostic.metadata",
                },
                ...fields,
            },
        });
    }
}

/** Compact non-absent readiness summary, e.g. "objects=ready,columns=failed". */
function readinessSummary(readiness: Readonly<Record<CatalogSection, SectionState>>): string {
    return Object.entries(readiness)
        .filter(([, state]) => state !== "absent")
        .map(([section, state]) => `${section}=${state}`)
        .join(",");
}
