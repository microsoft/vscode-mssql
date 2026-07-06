/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * MetadataStore (oe-docs metadata_service_oe_v2_design): the SHARED,
 * key-correct, multi-connection metadata service — server catalog leases +
 * database catalog leases over refcounted engines, for Query Studio, the
 * native language service, scripting, and Object Explorer v2.
 *
 * Key-correctness (design §6, the critical fix): every database catalog gets
 * its OWN data-plane metadata session opened with
 * `OpenSessionParams.database = key.database` (preview-safe strategy). The
 * session source is key-aware by construction; a serialized-USE server lane
 * can replace it later behind the same acquisition surface. A post-open
 * check emits `metadataStore.keyCorrectness.violation` (and counts it in
 * store status) if a backend ever hands back a session in the wrong
 * database.
 *
 * Lifecycle: leases are refcounted. When an entry's refcount reaches zero it
 * survives for `idleTtlMs` (warm re-acquire = cache hit), bounded by
 * `maxIdleDatabases` (LRU) so large servers cannot pile up idle sessions.
 */

import { diag } from "../../diagnostics/diagnosticsCore";
import { ISqlConnectionService } from "../sqlDataPlane/api";
import { CatalogSnapshot, SchemaContextRequest, SchemaContextResult } from "./catalogModel";
import {
    DataPlaneMetadataSessionSource,
    MetadataService,
    MetadataSessionSource,
    MetadataStatus,
    MetadataValidationLimiter,
    ModuleDefinitionResult,
} from "./metadataService";
import { PreparedConnection } from "./profileAuthAdapter";
import {
    FreshCatalogResult,
    FreshServerCatalogResult,
    MetadataFreshnessPolicy,
    ServerMetadataFreshnessPolicy,
} from "./cache/metadataFreshness";
import { MetadataCacheCoordinator } from "./cache/metadataCacheCoordinator";
import {
    IPinnedServerCatalogView,
    ServerCatalogStatus,
    ServerMetadataService,
} from "./serverMetadataService";

// ---------------------------------------------------------------------------
// Keys (design §4.2)
// ---------------------------------------------------------------------------

export interface ServerKey {
    readonly serverFingerprint: string;
}

export interface DatabaseKey extends ServerKey {
    /**
     * Exact database spelling as reported/requested. Deliberately NOT
     * case-folded for keying: name case sensitivity is a server-collation
     * fact, and backends report the canonical spelling on context changes.
     */
    readonly database: string;
}

const serverKeyOf = (key: ServerKey): string => key.serverFingerprint;
const databaseKeyOf = (key: DatabaseKey): string => `${key.serverFingerprint}|${key.database}`;

// ---------------------------------------------------------------------------
// Leases (design §5)
// ---------------------------------------------------------------------------

export interface ServerCatalogLease {
    readonly key: ServerKey;
    status(): ServerCatalogStatus;
    pin(): IPinnedServerCatalogView;
    refresh(): Promise<void>;
    /** §4.4: no server-scope digest — validation IS re-hydration. */
    ensureFresh(policy: ServerMetadataFreshnessPolicy): Promise<FreshServerCatalogResult>;
    onDidChange(listener: () => void): { dispose(): void };
    dispose(): void;
}

export interface DatabaseCatalogLease {
    readonly key: DatabaseKey;
    status(): MetadataStatus;
    current(): CatalogSnapshot | undefined;
    buildSchemaContext(req: SchemaContextRequest): SchemaContextResult;
    notifyExecutedBatch(input: { text?: string; succeeded: boolean }): void;
    /** LAZY per-object sys.sql_modules read, cached per generation (B12). */
    getModuleDefinition(objectId: number): Promise<ModuleDefinitionResult>;
    refresh(): Promise<void>;
    /** Policy-routed freshness decision (cache/drift design §5). */
    ensureFresh(policy: MetadataFreshnessPolicy): Promise<FreshCatalogResult>;
    onDidChange(listener: (status: MetadataStatus) => void): { dispose(): void };
    dispose(): void;
}

export interface MetadataStoreStatus {
    readonly servers: readonly {
        readonly readiness: ServerCatalogStatus["readiness"];
        readonly generation: number;
        readonly databaseCount?: number;
        readonly refCount: number;
    }[];
    readonly databases: readonly {
        readonly readiness: MetadataStatus["readiness"];
        readonly generation: number;
        readonly refCount: number;
        readonly idle: boolean;
        /** Where the CURRENT snapshot came from ("disk" until live wins). */
        readonly source?: "disk" | "live";
    }[];
    readonly keyCorrectnessViolations: number;
    readonly cache?: {
        readonly enabled: boolean;
        readonly loadedFromDisk: number;
    };
}

export interface MetadataStoreOptions {
    /** Digest-poll cadence forwarded to database engines (0 disables). */
    pollSeconds?: number;
    /**
     * HOST fact for H-3 focus gating, forwarded verbatim to every engine
     * (the composition root injects `() => vscode.window.state.focused`;
     * engines stay vscode-free). Default: always active.
     */
    isActive?: () => boolean;
    /** Zero-ref entries stay warm this long before disposal (default 120s). */
    idleTtlMs?: number;
    /** Max zero-ref database entries kept warm (LRU, default 4). */
    maxIdleDatabases?: number;
    /**
     * Persistent snapshot cache (CACHE-3): when configured, a fresh
     * database acquire loads the disk snapshot BEFORE live hydration
     * (base §10.1), always followed by a background refresh (C-4.1)
     * unless offline; live generations save back through the coordinator.
     */
    cache?: {
        coordinator: MetadataCacheCoordinator;
        /** Live read of mssql.metadataCache.offlineMode (CACHE-6 owns UX). */
        offlineMode?: () => boolean;
    };
}

interface ServerEntry {
    key: ServerKey;
    prepared: PreparedConnection;
    source: DataPlaneMetadataSessionSource;
    service: ServerMetadataService;
    refCount: number;
    idleTimer: ReturnType<typeof setTimeout> | undefined;
    /** H-6(b): accessState per database name as of the last hydration. */
    accessStates: Map<string, string> | undefined;
    accessSubscription: { dispose(): void } | undefined;
}

interface DatabaseEntry {
    key: DatabaseKey;
    prepared: PreparedConnection;
    source: DataPlaneMetadataSessionSource;
    engine: MetadataService;
    handle: ReturnType<MetadataService["acquire"]>;
    listeners: Set<(status: MetadataStatus) => void>;
    refCount: number;
    idleTimer: ReturnType<typeof setTimeout> | undefined;
    lastReleasedAt: number;
    /** Generation published from disk (undefined = never disk-served). */
    diskGeneration: number | undefined;
    cacheSource: "disk" | "live" | undefined;
}

export class MetadataStore {
    private servers = new Map<string, ServerEntry>();
    private databases = new Map<string, DatabaseEntry>();
    private violations = 0;
    private diskLoads = 0;
    private disposed = false;
    /**
     * H-3.4: ONE cross-entry validation semaphore for the whole store —
     * each database entry composes its own engine, so the cap only
     * constrains anything when the SAME limiter instance rides into every
     * engine's options (a resume storm must not fan out 30 digests).
     */
    private readonly validationLimiter = new MetadataValidationLimiter(2);

    constructor(
        private readonly service: () => Promise<ISqlConnectionService>,
        private readonly options: MetadataStoreOptions = {},
    ) {}

    // -- Server catalog ------------------------------------------------------

    async acquireServer(prepared: PreparedConnection): Promise<ServerCatalogLease> {
        this.assertLive();
        const key: ServerKey = { serverFingerprint: prepared.serverFingerprint };
        const id = serverKeyOf(key);
        let entry = this.servers.get(id);
        const cacheHit = entry !== undefined;
        if (!entry) {
            const connection = await this.service();
            // Server-scoped session: profile default database (server facts
            // and sys.databases are database-agnostic).
            const source = new DataPlaneMetadataSessionSource(connection, {
                profile: prepared.profileRef,
                applicationName: "vscode-mssql-metadata",
                auth: prepared.auth,
            });
            entry = {
                key,
                prepared,
                source,
                service: new ServerMetadataService(source),
                refCount: 0,
                idleTimer: undefined,
                accessStates: undefined,
                accessSubscription: undefined,
            };
            const created = entry;
            // H-6(b): every server hydration diffs accessState per database
            // name against the previous pinned view and pokes matching live
            // database entries with staleReason "accessChanged".
            created.accessSubscription = created.service.onDidChange(() =>
                this.diffServerAccessStates(created),
            );
            this.servers.set(id, entry);
        }
        const resolved = entry;
        resolved.refCount++;
        this.cancelIdle(resolved);
        this.emitAcquire("metadataStore.acquireServer", prepared, cacheHit);
        void resolved.service.ensureHydrated();

        const store = this;
        let disposed = false;
        return {
            key,
            status: () => resolved.service.status(),
            pin: () => resolved.service.pin(),
            refresh: () => resolved.service.refresh(),
            ensureFresh: (policy) => resolved.service.ensureFresh(policy),
            onDidChange: (listener) => resolved.service.onDidChange(listener),
            dispose(): void {
                if (disposed) {
                    return;
                }
                disposed = true;
                store.releaseServer(resolved);
            },
        };
    }

    private releaseServer(entry: ServerEntry): void {
        entry.refCount = Math.max(0, entry.refCount - 1);
        diag.emit({
            feature: "metadata",
            kind: "event",
            type: "metadataStore.disposeLease",
            fields: {
                keyKind: { raw: "server", cls: "diagnostic.metadata" },
                refCount: { raw: entry.refCount, cls: "diagnostic.metadata" },
            },
        });
        if (entry.refCount === 0) {
            this.scheduleIdle(entry, () => {
                this.servers.delete(serverKeyOf(entry.key));
                entry.accessSubscription?.dispose();
                entry.service.dispose();
                entry.source.dispose();
            });
        }
    }

    /**
     * H-6(b): compare the freshly-hydrated server view's accessState per
     * database name to the previous one; transitions poke live database
     * entries via the engine hook. Counted only — no identifiers in the
     * event (database names stay out per the H-6 rule; the H-5 rename
     * event is the only sanctioned name carrier).
     */
    private diffServerAccessStates(server: ServerEntry): void {
        const list = server.service.pin().listDatabases();
        if (!list) {
            return; // failed/loading — never diff against emptiness
        }
        const next = new Map(list.map((db) => [db.name, db.accessState as string]));
        const previous = server.accessStates;
        server.accessStates = next;
        if (!previous) {
            return; // first hydration — nothing to transition from
        }
        let transitions = 0;
        for (const [name, state] of next) {
            const before = previous.get(name);
            if (before === undefined || before === state) {
                continue;
            }
            const dbEntry = this.databases.get(
                databaseKeyOf({ serverFingerprint: server.key.serverFingerprint, database: name }),
            );
            if (dbEntry) {
                dbEntry.engine.noteAccessStateChanged({
                    serverFingerprint: server.key.serverFingerprint,
                    database: name,
                });
                transitions++;
            }
        }
        if (transitions > 0) {
            diag.emit({
                feature: "metadata",
                kind: "event",
                type: "metadataStore.accessDrift",
                fields: {
                    databases: { raw: transitions, cls: "diagnostic.metadata" },
                },
            });
        }
    }

    // -- Database catalog ----------------------------------------------------

    async acquireDatabase(
        prepared: PreparedConnection,
        database: string,
        onStatus?: (status: MetadataStatus) => void,
    ): Promise<DatabaseCatalogLease> {
        this.assertLive();
        const key: DatabaseKey = { serverFingerprint: prepared.serverFingerprint, database };
        const id = databaseKeyOf(key);
        let entry = this.databases.get(id);
        const cacheHit = entry !== undefined;
        if (!entry) {
            const connection = await this.service();
            // KEY-CORRECT by construction: the dedicated session opens IN the
            // requested database (preview-safe strategy, design §6.1). An
            // empty database means "profile default" — no explicit context,
            // and the correctness check does not apply.
            const inner = new DataPlaneMetadataSessionSource(connection, {
                profile: prepared.profileRef,
                ...(key.database ? { database: key.database } : {}),
                applicationName: "vscode-mssql-metadata",
                auth: prepared.auth,
            });
            const source: MetadataSessionSource = {
                open: async () => {
                    const session = await inner.open();
                    if (
                        key.database &&
                        session.info.database &&
                        session.info.database !== key.database
                    ) {
                        this.violations++;
                        diag.emit({
                            feature: "metadata",
                            kind: "event",
                            type: "metadataStore.keyCorrectness.violation",
                            fields: {
                                expected: { raw: key.database, cls: "database.name" },
                                actual: {
                                    raw: session.info.database,
                                    cls: "database.name",
                                },
                            },
                        });
                    }
                    return session;
                },
            };
            const engine = new MetadataService(source, {
                ...(this.options.pollSeconds !== undefined
                    ? { pollSeconds: this.options.pollSeconds }
                    : {}),
                // H-3: focus fact + the SHARED cross-entry digest limiter.
                ...(this.options.isActive ? { isActive: this.options.isActive } : {}),
                validationLimiter: this.validationLimiter,
                // H-5: the engine detects the rename; the STORE owns the
                // sanctioned event (cls database.name, same classes as the
                // key-correctness tripwire) and the violations counter.
                onIdentityDrift: (drift) => {
                    this.violations++;
                    diag.emit({
                        feature: "metadata",
                        kind: "event",
                        type: "metadataStore.keyCorrectness.driftRename",
                        fields: {
                            expected: { raw: drift.expected, cls: "database.name" },
                            actual: { raw: drift.actual, cls: "database.name" },
                        },
                    });
                },
            });
            const engineKey = { serverFingerprint: key.serverFingerprint, database: key.database };
            const cache = this.options.cache;
            const offline = cache?.offlineMode?.() === true;

            // Disk snapshot BEFORE the engine handle exists (base §10.1):
            // publishing first means acquire() below sees "ready" and does
            // not kick its own hydration — the C-4.1 background refresh is
            // scheduled explicitly instead. A miss costs one manifest stat.
            let publishedFromDisk = false;
            let manifestDigest: string | undefined;
            if (cache) {
                const loaded = await cache.coordinator.load(engineKey);
                if (!("miss" in loaded)) {
                    manifestDigest = loaded.manifest.validation.objectDigest;
                    publishedFromDisk = engine.publishExternalSnapshot(
                        engineKey,
                        loaded.snapshot,
                        manifestDigest !== undefined ? { manifestDigest } : {},
                    );
                }
            }

            const listeners = new Set<(status: MetadataStatus) => void>();
            const pendingEntry: { current: DatabaseEntry | undefined } = { current: undefined };
            const handle = engine.acquire(engineKey, (status) => {
                const owner = pendingEntry.current;
                if (owner && cache && status.readiness === "ready") {
                    if (
                        owner.diskGeneration !== undefined &&
                        status.generation !== owner.diskGeneration
                    ) {
                        owner.cacheSource = "live";
                    }
                    // Save LIVE generations back (debounced + eligibility-
                    // gated inside the coordinator); never re-save the
                    // generation that came FROM the disk.
                    if (status.generation !== owner.diskGeneration) {
                        const snapshot = owner.handle?.current();
                        if (snapshot) {
                            cache.coordinator.save(engineKey, snapshot);
                        }
                    }
                }
                for (const listener of [...listeners]) {
                    try {
                        listener(status);
                    } catch {
                        /* listener isolation */
                    }
                }
            });
            if (publishedFromDisk && !offline) {
                // C-4.1: cached data must never become silent forever-truth.
                void handle.refresh();
            }
            entry = {
                key,
                prepared,
                source: inner,
                engine,
                handle,
                listeners,
                refCount: 0,
                idleTimer: undefined,
                lastReleasedAt: 0,
                diskGeneration: publishedFromDisk ? handle.status().generation : undefined,
                cacheSource: publishedFromDisk ? "disk" : undefined,
            };
            pendingEntry.current = entry;
            if (publishedFromDisk) {
                this.diskLoads++;
            }
            this.databases.set(id, entry);
        }
        const resolved = entry;
        resolved.refCount++;
        this.cancelIdle(resolved);
        if (onStatus) {
            resolved.listeners.add(onStatus);
        }
        this.emitAcquire("metadataStore.acquireDatabase", prepared, cacheHit);

        const store = this;
        let disposed = false;
        return {
            key,
            status: () => resolved.handle.status(),
            current: () => resolved.handle.current(),
            buildSchemaContext: (req) => resolved.handle.buildSchemaContext(req),
            notifyExecutedBatch: (input) => resolved.handle.notifyExecutedBatch(input),
            getModuleDefinition: (objectId) => resolved.handle.getModuleDefinition(objectId),
            refresh: () => resolved.handle.refresh(),
            ensureFresh: (policy) => resolved.handle.ensureFresh(policy),
            onDidChange(listener): { dispose(): void } {
                resolved.listeners.add(listener);
                return { dispose: () => resolved.listeners.delete(listener) };
            },
            dispose(): void {
                if (disposed) {
                    return;
                }
                disposed = true;
                if (onStatus) {
                    resolved.listeners.delete(onStatus);
                }
                store.releaseDatabase(resolved);
            },
        };
    }

    private releaseDatabase(entry: DatabaseEntry): void {
        entry.refCount = Math.max(0, entry.refCount - 1);
        diag.emit({
            feature: "metadata",
            kind: "event",
            type: "metadataStore.disposeLease",
            fields: {
                keyKind: { raw: "database", cls: "diagnostic.metadata" },
                refCount: { raw: entry.refCount, cls: "diagnostic.metadata" },
            },
        });
        if (entry.refCount === 0) {
            entry.lastReleasedAt = Date.now();
            this.scheduleIdle(entry, () => this.disposeDatabaseEntry(entry));
            this.enforceIdleCap();
        }
    }

    private disposeDatabaseEntry(entry: DatabaseEntry): void {
        this.databases.delete(databaseKeyOf(entry.key));
        entry.handle.dispose();
        entry.engine.dispose();
        entry.source.dispose();
        entry.listeners.clear();
    }

    /** LRU cap on zero-ref entries (oldest released go first). */
    private enforceIdleCap(): void {
        const cap = this.options.maxIdleDatabases ?? 4;
        const idle = [...this.databases.values()]
            .filter((entry) => entry.refCount === 0)
            .sort((a, b) => a.lastReleasedAt - b.lastReleasedAt);
        while (idle.length > cap) {
            const evict = idle.shift()!;
            this.cancelIdle(evict);
            this.disposeDatabaseEntry(evict);
        }
    }

    // -- Drift + status ------------------------------------------------------

    /** Route a DDL-drift notification to a live catalog, if any. */
    notifyExecutedBatch(input: {
        serverFingerprint: string;
        database: string;
        text?: string;
        succeeded: boolean;
    }): void {
        const entry = this.databases.get(
            databaseKeyOf({ serverFingerprint: input.serverFingerprint, database: input.database }),
        );
        entry?.handle.notifyExecutedBatch({
            ...(input.text !== undefined ? { text: input.text } : {}),
            succeeded: input.succeeded,
        });
    }

    status(): MetadataStoreStatus {
        return {
            servers: [...this.servers.values()].map((entry) => {
                const status = entry.service.status();
                return {
                    readiness: status.readiness,
                    generation: status.generation,
                    ...(status.databaseCount !== undefined
                        ? { databaseCount: status.databaseCount }
                        : {}),
                    refCount: entry.refCount,
                };
            }),
            databases: [...this.databases.values()].map((entry) => {
                const status = entry.handle.status();
                return {
                    readiness: status.readiness,
                    generation: status.generation,
                    refCount: entry.refCount,
                    idle: entry.refCount === 0,
                    ...(entry.cacheSource ? { source: entry.cacheSource } : {}),
                };
            }),
            keyCorrectnessViolations: this.violations,
            ...(this.options.cache
                ? { cache: { enabled: true, loadedFromDisk: this.diskLoads } }
                : {}),
        };
    }

    dispose(): void {
        this.disposed = true;
        for (const entry of this.databases.values()) {
            this.cancelIdle(entry);
            entry.handle.dispose();
            entry.engine.dispose();
            entry.source.dispose();
        }
        this.databases.clear();
        for (const entry of this.servers.values()) {
            this.cancelIdle(entry);
            entry.accessSubscription?.dispose();
            entry.service.dispose();
            entry.source.dispose();
        }
        this.servers.clear();
    }

    // -- internals -----------------------------------------------------------

    private assertLive(): void {
        if (this.disposed) {
            throw new Error("MetadataStore disposed");
        }
    }

    private scheduleIdle(
        entry: { idleTimer: ReturnType<typeof setTimeout> | undefined },
        onExpire: () => void,
    ): void {
        this.cancelIdle(entry);
        const ttl = this.options.idleTtlMs ?? 120_000;
        if (ttl <= 0) {
            onExpire();
            return;
        }
        entry.idleTimer = setTimeout(onExpire, ttl);
        (entry.idleTimer as { unref?: () => void }).unref?.();
    }

    private cancelIdle(entry: { idleTimer: ReturnType<typeof setTimeout> | undefined }): void {
        if (entry.idleTimer) {
            clearTimeout(entry.idleTimer);
            entry.idleTimer = undefined;
        }
    }

    private emitAcquire(
        type: "metadataStore.acquireServer" | "metadataStore.acquireDatabase",
        prepared: PreparedConnection,
        cacheHit: boolean,
    ): void {
        diag.emit({
            feature: "metadata",
            kind: "event",
            type,
            fields: {
                fingerprint: {
                    raw: prepared.serverFingerprint.slice(0, 12),
                    cls: "diagnostic.metadata",
                },
                cache: { raw: cacheHit ? "hit" : "miss", cls: "diagnostic.metadata" },
            },
        });
    }
}
