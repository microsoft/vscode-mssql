/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * MetadataService core (metadata design §5/§7–9): progressive hydration
 * (H1 schemas → H2 objects/synonyms → H3 types/columns → H4 keys → H5/H5B
 * FKs → H6 parameters → H7 MS_Description) streamed from ISqlSession
 * background queries, per-section readiness with
 * honest "failed" states, drift triggers (A: DDL sniff via the shared
 * lexer; B: cheap digest poll while handles are alive; C: explicit
 * refresh), and generation-bumped immutable snapshots.
 *
 * Session policy (§8.2): a DEDICATED metadata session per ServerKey
 * (applicationName `vscode-mssql-metadata`), opened through the same data
 * plane; hydration/poll queries never contend with the user's F5.
 */

import { diag } from "../../diagnostics/diagnosticsCore";
import {
    IQueryEventSink,
    ISqlConnectionService,
    ISqlSession,
    OpenSessionParams,
} from "../sqlDataPlane/api";
import { leadingKeyword } from "../../sql/batchSplitter";
import {
    buildSchemaContext,
    CatalogBuilder,
    CatalogSnapshot,
    ObjectKind,
    SchemaContextRequest,
    SchemaContextResult,
} from "./catalogModel";
import {
    FreshCatalogResult,
    MetadataFreshnessPolicy,
    MetadataValidationSummary,
} from "./cache/metadataFreshness";

export interface CatalogKey {
    serverFingerprint: string;
    database: string;
}

const keyOf = (key: CatalogKey) => `${key.serverFingerprint}|${key.database}`;

export interface MetadataStatus {
    /**
     * As-built vocabulary, UNTOUCHED by the cache layer (addendum C-3):
     * "stale" means "re-hydration in flight over an existing snapshot",
     * never "old data" — age-based staleness rides FreshCatalogResult.
     */
    readiness: "absent" | "loading" | "ready" | "failed" | "stale";
    generation: number;
    mode: "full" | "lite" | "partial";
    stats?: { schemas: number; objects: number; columns: number; foreignKeys: number };
    /** Most recent T1/full validation outcome, when one has run. */
    validation?: MetadataValidationSummary;
}

interface CatalogEntry {
    key: CatalogKey;
    snapshot: CatalogSnapshot | undefined;
    generation: number;
    status: MetadataStatus["readiness"];
    hydrating: Promise<void> | undefined;
    lastDigest: string | undefined;
    listeners: Set<(status: MetadataStatus) => void>;
    refCount: number;
    /** Lazy module-definition cache, cleared on every new generation (B12). */
    moduleDefinitions: Map<number, ModuleDefinitionResult>;
    /** In-flight lazy reads by object id (dedupe). */
    moduleDefinitionReads: Map<number, Promise<ModuleDefinitionResult>>;
    /**
     * Serialization lane for ALL session work (hydration, digest polls,
     * lazy module reads): the dedicated session allows ONE active query, so
     * everything that executes on it runs exclusively through this lane.
     */
    sessionLane: Promise<void>;
    /** Coalesced T1 validation shared by concurrent requireValidated (§4.3). */
    validationInFlight: Promise<MetadataValidationSummary> | undefined;
    lastValidation: MetadataValidationSummary | undefined;
    lastValidatedAtMs: number | undefined;
    /**
     * Bumped when the lane watchdog abandons an operation (H-2): an
     * abandoned hydrateCore/validate MUST NOT mutate the entry when it
     * eventually settles — every completion path checks its epoch.
     */
    opEpoch: number;
    /** Set by a watchdog fire; the NEXT lane item recycles the session. */
    sessionWedged: boolean;
}

/** Result of a lazy sys.sql_modules read (B12 scripting/definition). */
export interface ModuleDefinitionResult {
    text?: string;
    /** Why text is absent — an HONEST state, never a fabricated script. */
    unavailableReason?: "encrypted" | "permission" | "notLoaded";
    /** Catalog generation current when the definition was read. */
    generation: number;
}

/** Kind codes from sys.objects type. */
const KIND_BY_TYPE: Record<string, ObjectKind> = {
    U: "table",
    V: "view",
    P: "procedure",
    FN: "scalarFunction",
    IF: "tableFunction",
    TF: "tableFunction",
    SN: "synonym",
};

const H1_SCHEMAS =
    "SELECT schema_id, name FROM sys.schemas WHERE schema_id < 16384 ORDER BY schema_id;";
const H2_OBJECTS =
    "SELECT o.object_id, o.schema_id, o.name, RTRIM(o.type) AS type, CONVERT(varchar(33), o.modify_date, 126) AS modify_date " +
    "FROM sys.objects o WHERE o.type IN ('U','V','P','FN','IF','TF','SN') AND o.is_ms_shipped = 0 ORDER BY o.object_id;";
const H3_COLUMNS =
    "SELECT c.object_id, c.column_id, c.name, t.name AS type_name, c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity, c.is_computed " +
    "FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id " +
    "JOIN sys.objects o ON o.object_id = c.object_id AND o.type IN ('U','V','IF','TF') AND o.is_ms_shipped = 0 " +
    "ORDER BY c.object_id, c.column_id;";
const H5_FOREIGN_KEYS =
    "SELECT fk.object_id, fk.name, fk.parent_object_id, fk.referenced_object_id " +
    "FROM sys.foreign_keys fk WHERE fk.is_ms_shipped = 0 ORDER BY fk.object_id;";
const H0_ENV =
    "SELECT CAST(SERVERPROPERTY('EngineEdition') AS int) AS engine_edition, " +
    "COALESCE(CAST(SCHEMA_NAME() AS sysname), 'dbo') AS default_schema, " +
    "CAST(DATABASEPROPERTYEX(DB_NAME(), 'Collation') AS nvarchar(128)) AS collation_name;";
const H4_KEYS =
    "SELECT ic.object_id, c.name, i.name AS index_name, i.is_primary_key, i.is_unique_constraint " +
    "FROM sys.indexes i " +
    "JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id " +
    "JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id " +
    "WHERE i.is_primary_key = 1 OR i.is_unique_constraint = 1 " +
    "ORDER BY ic.object_id, i.index_id, ic.key_ordinal;";
const H5B_FOREIGN_KEY_COLUMNS =
    "SELECT fkc.constraint_object_id, pc.name AS parent_column, rc.name AS referenced_column " +
    "FROM sys.foreign_key_columns fkc " +
    "JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id " +
    "JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id " +
    "ORDER BY fkc.constraint_object_id, fkc.constraint_column_id;";
const H6_PARAMETERS =
    "SELECT p.object_id, p.parameter_id, p.name, t.name AS type_name, p.max_length, p.precision, p.scale, p.is_output " +
    "FROM sys.parameters p JOIN sys.types t ON p.user_type_id = t.user_type_id " +
    "JOIN sys.objects o ON o.object_id = p.object_id AND o.type IN ('P','FN','IF','TF') AND o.is_ms_shipped = 0 " +
    "ORDER BY p.object_id, p.parameter_id;";
// H7 uses COL_NAME() instead of a sys.columns join ON PURPOSE: FakeScript
// fixtures match by substring in array order, and "sys.columns" (H3),
// "sys.parameters" (H6), "is_primary_key" (H4) etc. would collide. Keep
// this query free of every earlier matcher substring (see the matcher-order
// notes in test/unit/metadataStore.test.ts and largeCatalogFixture.ts).
const H7_DESCRIPTIONS =
    "SELECT ep.major_id, ep.minor_id, COL_NAME(ep.major_id, ep.minor_id) AS column_name, CAST(ep.value AS nvarchar(4000)) AS description " +
    "FROM sys.extended_properties ep " +
    "WHERE ep.class = 1 AND ep.name = 'MS_Description' " +
    "ORDER BY ep.major_id, ep.minor_id;";
// CHEAP_DIGEST v2 (H-1 + H-5): schema_id and the BYTE-EXACT name (varbinary
// cast — plain CHECKSUM over character data is collation-folded, so a
// pure-case rename on a CI server would still hide) participate in the hash,
// because object_id and modify_date both survive sp_rename and ALTER SCHEMA
// TRANSFER — v1 was blind to renames performed outside this editor.
// DB_NAME() rides along for the CACHE-5 database-rename identity check
// (H-5): a renamed database is an identity event, not schema drift, so it
// is NOT part of the compared digest. Still "likely unchanged", never proof:
// column/key/FK/parameter/description drift stays invisible until T2
// section digests. Matcher note: this SQL still contains
// "FROM sys.objects o WHERE" (H2's substring — digest fixtures must stay
// ordered BEFORE H2); "DB_NAME()" and "varbinary(256)" collide with no
// earlier matcher.
const CHEAP_DIGEST =
    "SELECT DB_NAME() AS current_db, COUNT(*) AS object_count, " +
    "ISNULL(CHECKSUM_AGG(CHECKSUM(o.object_id, o.schema_id, CAST(o.name AS varbinary(256)), o.modify_date)), 0) AS object_hash " +
    "FROM sys.objects o WHERE o.type IN ('U','V','P','FN','IF','TF','SN') AND o.is_ms_shipped = 0;";
// LAZY per-object module definition (B12 scripting/definition) — NOT part of
// the H-series bulk hydration: one targeted query per requested object,
// cached per generation. Matcher-collision note (see H7): this SQL must
// avoid every earlier FakeScript matcher substring — "sys.sql_modules" and
// "OBJECTPROPERTY" collide with none of them.
const MODULE_DEFINITION = (objectId: number): string =>
    "SELECT sm.definition, OBJECTPROPERTY(sm.object_id, 'IsEncrypted') AS is_encrypted " +
    `FROM sys.sql_modules sm WHERE sm.object_id = ${Math.trunc(objectId)};`;

/** DDL keywords that schedule a refresh (design §9.1). */
const DDL_KEYWORDS = new Set(["CREATE", "ALTER", "DROP", "SP_RENAME"]);
const MAYBE_DDL = new Set(["EXEC", "EXECUTE"]);

/**
 * Case sensitivity from a collation name: `_CS` collations, plus binary
 * collations (`_BIN`/`_BIN2` compare by byte/codepoint and carry no `_CS`
 * token — C-11; a BIN-collated catalog classified as insensitive makes
 * resolveName accept folded-only matches the server would reject).
 * Accent/kana/width sensitivity stay unmodeled: catalog folding is
 * case-only, an accepted limit.
 */
export function collationIsCaseSensitive(collation: string): boolean {
    return /_CS(_|$)|_BIN2?(_|$)/i.test(collation);
}

export function typeDisplay(
    typeName: string,
    maxLength: number,
    precision: number,
    scale: number,
): string {
    const t = typeName.toLowerCase();
    if (["varchar", "char", "varbinary", "binary"].includes(t)) {
        return `${t}(${maxLength < 0 ? "max" : maxLength})`;
    }
    if (["nvarchar", "nchar"].includes(t)) {
        return `${t}(${maxLength < 0 ? "max" : maxLength / 2})`;
    }
    if (["decimal", "numeric"].includes(t)) {
        return `${t}(${precision},${scale})`;
    }
    if (["datetime2", "datetimeoffset", "time"].includes(t)) {
        return `${t}(${scale})`;
    }
    return t;
}

export interface MetadataSessionSource {
    open(): Promise<ISqlSession>;
    /**
     * Drop the current session so the next open() creates a fresh one —
     * the lane watchdog's recovery path (H-2: a wedged session is disposed,
     * a fresh dedicated session is cheap). Optional for fixture sources.
     */
    recycle?(): void;
}

/** Dedicated-session source over the data plane (§8.2). */
export class DataPlaneMetadataSessionSource implements MetadataSessionSource {
    private session: ISqlSession | undefined;
    constructor(
        private readonly service: ISqlConnectionService,
        private readonly params: OpenSessionParams,
    ) {}

    async open(): Promise<ISqlSession> {
        if (this.session && this.session.state === "open") {
            return this.session;
        }
        this.session = await this.service.openSession({
            ...this.params,
            applicationName: "vscode-mssql-metadata",
        });
        return this.session;
    }

    recycle(): void {
        this.dispose();
    }

    dispose(): void {
        void this.session?.dispose();
        this.session = undefined;
    }
}

/**
 * Background catalog query → rows. Awaits the HANDLE completion (not the
 * sink callback): the session frees its active-query slot via the completion
 * promise's reaction order, so sequential queries must synchronize on it or
 * the next execute races into Busy. Shared by MetadataService and
 * ServerMetadataService.
 */
export async function runMetadataQuery(
    session: ISqlSession,
    sql: string,
    tag: string,
): Promise<unknown[][]> {
    const collected: unknown[][] = [];
    let failed: string | undefined;
    const sink: IQueryEventSink = {
        onResultSetStarted: () => undefined,
        onRowsPage: (page) => {
            collected.push(...page.compact.values);
        },
        onMessage: (message) => {
            if (message.kind === "error") {
                failed = message.text;
            }
        },
        onComplete: () => undefined,
    };
    const handle = session.execute(
        sql,
        { priority: "background", commandKind: "metadata", tag },
        sink,
    );
    const summary = await handle.completion;
    if (summary.status !== "succeeded") {
        throw new Error(failed ?? `metadata query ${summary.status}`);
    }
    return collected;
}

export class MetadataService {
    private entries = new Map<string, CatalogEntry>();
    private pollTimer: ReturnType<typeof setInterval> | undefined;

    constructor(
        private readonly sessions: MetadataSessionSource,
        private readonly options: {
            pollSeconds?: number;
            /** Lane watchdog ceiling for hydration passes (default 60s). */
            hydrationTimeoutMs?: number;
            /** Lane watchdog ceiling for digest/lazy reads (default 15s). */
            laneOpTimeoutMs?: number;
        } = {},
    ) {}

    /** Acquire (and hydrate if needed) the catalog for a key. */
    acquire(
        key: CatalogKey,
        onStatus?: (status: MetadataStatus) => void,
    ): {
        dispose(): void;
        refresh(): Promise<void>;
        current(): CatalogSnapshot | undefined;
        status(): MetadataStatus;
        buildSchemaContext(req: SchemaContextRequest): SchemaContextResult;
        notifyExecutedBatch(input: { text?: string; succeeded: boolean }): void;
        /** LAZY per-object sys.sql_modules read, cached per generation (B12). */
        getModuleDefinition(objectId: number): Promise<ModuleDefinitionResult>;
        /** Policy-routed freshness decision (cache/drift design §5, §4.2). */
        ensureFresh(policy: MetadataFreshnessPolicy): Promise<FreshCatalogResult>;
    } {
        const id = keyOf(key);
        let entry = this.entries.get(id);
        if (!entry) {
            entry = {
                key,
                snapshot: undefined,
                generation: 0,
                status: "absent",
                hydrating: undefined,
                lastDigest: undefined,
                listeners: new Set(),
                refCount: 0,
                moduleDefinitions: new Map(),
                moduleDefinitionReads: new Map(),
                sessionLane: Promise.resolve(),
                validationInFlight: undefined,
                lastValidation: undefined,
                lastValidatedAtMs: undefined,
                opEpoch: 0,
                sessionWedged: false,
            };
            this.entries.set(id, entry);
        }
        entry.refCount++;
        if (onStatus) {
            entry.listeners.add(onStatus);
        }
        if (entry.status === "absent" || entry.status === "failed") {
            void this.hydrate(entry);
        }
        this.ensurePolling();

        const service = this;
        return {
            dispose() {
                entry!.refCount = Math.max(0, entry!.refCount - 1);
                if (onStatus) {
                    entry!.listeners.delete(onStatus);
                }
                service.maybeStopPolling();
            },
            refresh: () => this.hydrate(entry!, true),
            current: () => entry!.snapshot,
            status: () => service.statusOf(entry!),
            buildSchemaContext(req: SchemaContextRequest): SchemaContextResult {
                const snapshot = entry!.snapshot;
                if (!snapshot) {
                    return {
                        text: "",
                        charCount: 0,
                        objectsIncluded: 0,
                        catalogGeneration: 0,
                        truncated: false,
                        degraded: "catalogNotReady",
                        composition: { tables: 0, views: 0, columnsElided: 0 },
                    };
                }
                const span = diag.startSpan({
                    feature: "metadata",
                    kind: "span",
                    type: "metadata.contextBuild",
                    fields: {
                        generation: {
                            raw: String(snapshot.generation),
                            cls: "diagnostic.metadata",
                        },
                    },
                });
                try {
                    const result = buildSchemaContext(snapshot, req);
                    span.end("ok", {
                        charCount: { raw: result.charCount, cls: "diagnostic.metadata" },
                        objectsIncluded: {
                            raw: result.objectsIncluded,
                            cls: "diagnostic.metadata",
                        },
                        truncated: { raw: result.truncated, cls: "diagnostic.metadata" },
                        degraded: { raw: result.degraded ?? "none", cls: "diagnostic.metadata" },
                    });
                    return result;
                } catch (error) {
                    span.fail(error);
                    throw error;
                }
            },
            notifyExecutedBatch(input: { text?: string; succeeded: boolean }): void {
                if (!input.succeeded || !input.text) {
                    return;
                }
                const keyword = leadingKeyword(input.text)?.toUpperCase();
                if (!keyword) {
                    return;
                }
                if (DDL_KEYWORDS.has(keyword)) {
                    // Sniff accelerates refresh; the poll remains the backstop.
                    void service.hydrate(entry!, true);
                } else if (MAYBE_DDL.has(keyword)) {
                    void service.checkDigest(entry!);
                }
            },
            getModuleDefinition: (objectId: number) =>
                service.getModuleDefinition(entry!, objectId),
            ensureFresh: (policy: MetadataFreshnessPolicy) =>
                service.ensureFreshEntry(entry!, policy),
        };
    }

    private statusOf(entry: CatalogEntry): MetadataStatus {
        return {
            readiness: entry.status,
            generation: entry.generation,
            mode: entry.snapshot?.mode ?? "full",
            ...(entry.snapshot ? { stats: entry.snapshot.stats } : {}),
            ...(entry.lastValidation ? { validation: entry.lastValidation } : {}),
        };
    }

    private notify(entry: CatalogEntry): void {
        const status = this.statusOf(entry);
        for (const listener of [...entry.listeners]) {
            try {
                listener(status);
            } catch {
                /* listener isolation */
            }
        }
    }

    /** See runMetadataQuery — kept as a method alias for the hydration code. */
    private async rows(session: ISqlSession, sql: string, tag: string): Promise<unknown[][]> {
        return runMetadataQuery(session, sql, tag);
    }

    /**
     * Run session work exclusively: the dedicated session allows ONE active
     * query, so hydration, digest polls, and lazy module reads all chain
     * through the per-entry lane (a prior failure never blocks the lane).
     *
     * WATCHDOG (H-2): the lane must survive a completion that never comes —
     * the lane continuation attaches to the RACED promise, so a hung
     * operation fails after `timeoutMs` (error class laneTimeout), the
     * entry's opEpoch advances (the abandoned work must not mutate the
     * entry when it eventually settles), and the NEXT lane item recycles
     * the session source. The watchdog never rejects the shared lane for
     * queued waiters — it fails the one operation.
     */
    private runExclusive<T>(
        entry: CatalogEntry,
        work: () => Promise<T>,
        watchdog?: { timeoutMs: number; opKind: string },
    ): Promise<T> {
        const run = entry.sessionLane
            .catch(() => undefined)
            .then(() => {
                if (entry.sessionWedged) {
                    entry.sessionWedged = false;
                    this.sessions.recycle?.();
                }
                return watchdog ? this.withWatchdog(entry, work, watchdog) : work();
            });
        entry.sessionLane = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }

    private withWatchdog<T>(
        entry: CatalogEntry,
        work: () => Promise<T>,
        watchdog: { timeoutMs: number; opKind: string },
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                entry.opEpoch++; // abandoned work must not mutate the entry
                entry.sessionWedged = true; // next lane item recycles
                diag.emit({
                    feature: "metadata",
                    kind: "event",
                    type: "metadata.laneTimeout",
                    fields: {
                        opKind: { raw: watchdog.opKind, cls: "diagnostic.metadata" },
                        timeoutMs: { raw: watchdog.timeoutMs, cls: "diagnostic.metadata" },
                    },
                });
                reject(new Error(`laneTimeout:${watchdog.opKind}`));
            }, watchdog.timeoutMs);
            (timer as { unref?: () => void }).unref?.();
            work().then(
                (value) => {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timer);
                        resolve(value);
                    }
                },
                (error: unknown) => {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timer);
                        reject(error instanceof Error ? error : new Error(String(error)));
                    }
                },
            );
        });
    }

    /**
     * LAZY module-definition read (B12): one targeted sys.sql_modules query
     * per requested object, cached per generation (the cache clears when a
     * hydration publishes a new snapshot). Reads are serialized on the
     * session lane behind any in-flight hydration. Failures return an honest
     * "notLoaded" and are NOT cached; NULL definitions map to
     * encrypted/permission — never a fabricated script.
     */
    async getModuleDefinition(
        entry: CatalogEntry,
        objectId: number,
    ): Promise<ModuleDefinitionResult> {
        const cached = entry.moduleDefinitions.get(objectId);
        if (cached !== undefined) {
            return cached;
        }
        const inFlight = entry.moduleDefinitionReads.get(objectId);
        if (inFlight !== undefined) {
            return inFlight;
        }
        const read = this.runExclusive(
            entry,
            async (): Promise<ModuleDefinitionResult> => {
                const generation = entry.generation;
                try {
                    const session = await this.sessions.open();
                    const rows = await this.rows(
                        session,
                        MODULE_DEFINITION(objectId),
                        "metadata:moduleDefinition",
                    );
                    let result: ModuleDefinitionResult;
                    if (rows.length === 0) {
                        // Catalog visibility filtered the row: the login cannot
                        // see the module's metadata (or it is not a module).
                        result = { unavailableReason: "permission", generation };
                    } else {
                        const [definition, isEncrypted] = rows[0];
                        if (definition === null || definition === undefined) {
                            result = {
                                unavailableReason:
                                    isEncrypted === true || isEncrypted === 1
                                        ? "encrypted"
                                        : "permission",
                                generation,
                            };
                        } else {
                            result = { text: String(definition), generation };
                        }
                    }
                    if (entry.generation === generation) {
                        entry.moduleDefinitions.set(objectId, result);
                    }
                    return result;
                } catch {
                    return { unavailableReason: "notLoaded", generation };
                }
            },
            { timeoutMs: this.options.laneOpTimeoutMs ?? 15_000, opKind: "moduleDefinition" },
        ).catch(
            // Only the watchdog rejects (the work catches internally): a
            // timed-out read is an honest notLoaded, never a thrown error.
            (): ModuleDefinitionResult => ({
                unavailableReason: "notLoaded",
                generation: entry.generation,
            }),
        );
        entry.moduleDefinitionReads.set(objectId, read);
        try {
            return await read;
        } finally {
            entry.moduleDefinitionReads.delete(objectId);
        }
    }

    /**
     * Hydrations are SERIALIZED per entry: the dedicated session allows one
     * active query, so a forced refresh chains AFTER the in-flight run
     * rather than overlapping it (overlap made both runs race into Busy —
     * found by the B15 store's concurrent A/B isolation tests).
     */
    private async hydrate(entry: CatalogEntry, force = false): Promise<void> {
        const watchdog = {
            timeoutMs: this.options.hydrationTimeoutMs ?? 60_000,
            opKind: "hydrate",
        };
        if (entry.hydrating) {
            if (!force) {
                return entry.hydrating;
            }
            const chained = entry.hydrating
                .catch(() => undefined)
                .then(() => this.runExclusive(entry, () => this.hydrateCore(entry), watchdog));
            entry.hydrating = this.containLaneTimeout(entry, chained);
            return entry.hydrating;
        }
        // Hydration runs on the session lane too (lazy module reads share
        // the single-active-query session — B12).
        const run = this.runExclusive(entry, () => this.hydrateCore(entry), watchdog);
        entry.hydrating = this.containLaneTimeout(entry, run);
        return entry.hydrating;
    }

    /**
     * A watchdog-abandoned hydration surfaces to callers as a FAILED entry,
     * never as a rejected refresh() (the abandoned hydrateCore is epoch-
     * barred from mutating the entry itself). Identity-guarded like every
     * other completion path.
     */
    private containLaneTimeout(entry: CatalogEntry, run: Promise<void>): Promise<void> {
        const contained = run
            .catch(() => {
                entry.status = "failed";
                this.notify(entry);
            })
            .finally(() => {
                if (entry.hydrating === contained) {
                    entry.hydrating = undefined;
                }
            });
        return contained;
    }

    private async hydrateCore(entry: CatalogEntry): Promise<void> {
        // Epoch capture (H-2): if the lane watchdog abandons this run, the
        // epoch advances and NO completion path below may mutate the entry.
        const epoch = entry.opEpoch;
        entry.status = entry.snapshot ? "stale" : "loading";
        this.notify(entry);
        const span = diag.startSpan({
            feature: "metadata",
            kind: "span",
            type: "metadata.hydrate",
            fields: {
                database: { raw: entry.key.database, cls: "source.path" },
                generation: { raw: String(entry.generation + 1), cls: "diagnostic.metadata" },
            },
        });
        try {
            const session = await this.sessions.open();
            const builder = new CatalogBuilder();

            // H0 environment (best-effort; defaults survive a failed probe)
            try {
                const envRows = await this.rows(session, H0_ENV, "metadata:H0");
                const env = envRows[0];
                if (env) {
                    const collation =
                        env[2] === null || env[2] === undefined ? undefined : String(env[2]);
                    builder.setEnvironment({
                        engineEdition: Number.isFinite(Number(env[0])) ? Number(env[0]) : undefined,
                        defaultSchema: env[1] ? String(env[1]) : undefined,
                        collationName: collation,
                        caseSensitive: collation ? collationIsCaseSensitive(collation) : undefined,
                    });
                }
            } catch {
                // Environment probe is an enhancement; hydration proceeds.
            }

            // H1 schemas
            for (const row of await this.rows(session, H1_SCHEMAS, "metadata:H1")) {
                builder.addSchema(Number(row[0]), String(row[1]));
            }
            // H2 objects (+synonym rows share the object table)
            for (const row of await this.rows(session, H2_OBJECTS, "metadata:H2")) {
                const kind = KIND_BY_TYPE[String(row[3])];
                if (kind) {
                    builder.addObject(
                        Number(row[0]),
                        Number(row[1]),
                        String(row[2]),
                        kind,
                        row[4] === null || row[4] === undefined ? undefined : String(row[4]),
                    );
                }
            }
            // H3 columns (grouped by object_id, column_id — matches builder spans)
            let columnsFailed = false;
            try {
                for (const row of await this.rows(session, H3_COLUMNS, "metadata:H3")) {
                    builder.addColumn(
                        Number(row[0]),
                        String(row[2]),
                        typeDisplay(String(row[3]), Number(row[4]), Number(row[5]), Number(row[6])),
                        row[7] === true || row[7] === 1,
                        row[8] === true || row[8] === 1,
                        row[9] === true || row[9] === 1,
                    );
                }
            } catch {
                columnsFailed = true; // publish failed, never pretend-empty (§7.4)
            }
            // H4 key constraints (PK columns keep their dedicated marking;
            // unique-constraint columns are recorded but never PK-marked)
            let keysFailed = false;
            try {
                for (const row of await this.rows(session, H4_KEYS, "metadata:H4")) {
                    const objectId = Number(row[0]);
                    const columnName = String(row[1]);
                    const isPrimaryKey = row[3] === true || row[3] === 1;
                    const isUniqueConstraint = row[4] === true || row[4] === 1;
                    if (isPrimaryKey) {
                        builder.markPrimaryKeyColumn(objectId, columnName);
                    }
                    if (isPrimaryKey || isUniqueConstraint) {
                        builder.addKeyConstraintColumn(
                            objectId,
                            String(row[2]),
                            isPrimaryKey ? "primaryKey" : "uniqueConstraint",
                            columnName,
                        );
                    }
                }
            } catch {
                keysFailed = true;
            }
            // H5 FK edges
            let fkFailed = false;
            try {
                for (const row of await this.rows(session, H5_FOREIGN_KEYS, "metadata:H5")) {
                    builder.addForeignKey(
                        Number(row[2]),
                        Number(row[3]),
                        String(row[1]),
                        Number(row[0]),
                    );
                }
                for (const row of await this.rows(
                    session,
                    H5B_FOREIGN_KEY_COLUMNS,
                    "metadata:H5B",
                )) {
                    builder.addForeignKeyColumn(Number(row[0]), String(row[1]), String(row[2]));
                }
            } catch {
                fkFailed = true;
            }
            // H6 routine parameters
            let paramsFailed = false;
            try {
                for (const row of await this.rows(session, H6_PARAMETERS, "metadata:H6")) {
                    const name = row[2] === null || row[2] === undefined ? "" : String(row[2]);
                    builder.addParameter(
                        Number(row[0]),
                        Number(row[1]),
                        name,
                        typeDisplay(String(row[3]), Number(row[4]), Number(row[5]), Number(row[6])),
                        row[7] === true || row[7] === 1,
                    );
                }
            } catch {
                paramsFailed = true;
            }
            // H7 MS_Description extended properties (objects + columns)
            let descriptionsFailed = false;
            try {
                for (const row of await this.rows(session, H7_DESCRIPTIONS, "metadata:H7")) {
                    const value = row[3] === null || row[3] === undefined ? "" : String(row[3]);
                    if (value.length === 0) {
                        continue;
                    }
                    const minorId = Number(row[1]);
                    const columnName =
                        row[2] === null || row[2] === undefined ? undefined : String(row[2]);
                    if (minorId > 0 && columnName === undefined) {
                        continue; // column dropped since the property was set
                    }
                    builder.addDescription(
                        Number(row[0]),
                        value,
                        minorId > 0 ? columnName : undefined,
                    );
                }
            } catch {
                descriptionsFailed = true; // section failed, never pretend-empty
            }

            if (entry.opEpoch !== epoch) {
                span.fail(new Error("laneTimeout:abandoned"));
                return; // watchdog abandoned this run — a newer op owns the entry
            }
            entry.generation++;
            entry.snapshot = builder.build(
                entry.generation,
                {
                    schemas: "ready",
                    objects: "ready",
                    synonyms: "ready",
                    types: "ready",
                    columns: columnsFailed ? "failed" : "ready",
                    keys: keysFailed ? "failed" : "ready",
                    foreignKeys: fkFailed ? "failed" : "ready",
                    parameters: paramsFailed ? "failed" : "ready",
                    descriptions: descriptionsFailed ? "failed" : "ready",
                },
                columnsFailed || fkFailed || keysFailed || paramsFailed || descriptionsFailed
                    ? "partial"
                    : "full",
            );
            entry.status = "ready";
            entry.lastDigest = undefined; // re-baseline on next poll
            entry.moduleDefinitions.clear(); // lazy cache is per generation
            // A completed full hydration is the strongest validation.
            entry.lastValidatedAtMs = Date.now();
            entry.lastValidation = {
                tier: "fullRefresh",
                result: "unchanged",
                validatedAtUtc: new Date().toISOString(),
            };
            span.end("ok");
        } catch (error) {
            if (entry.opEpoch !== epoch) {
                span.fail(error);
                return; // abandoned run must not stomp a newer op's state
            }
            entry.status = "failed";
            span.fail(error);
        }
        this.notify(entry);
    }

    /**
     * T1 validation (cheap digest v2), COALESCED per entry (§4.3): all
     * concurrent requireValidated callers await the same run. Never
     * rejects — outcomes travel in the summary. A "changed" verdict awaits
     * the chained forced refresh before resolving, so a caller that
     * outlasts its timeout race still converges on the new generation.
     */
    private validateEntry(entry: CatalogEntry): Promise<MetadataValidationSummary> {
        if (entry.validationInFlight) {
            return entry.validationInFlight;
        }
        const startedAt = Date.now();
        const finish = (
            summary: Omit<MetadataValidationSummary, "validatedAtUtc" | "durationMs">,
            validated: boolean,
        ): MetadataValidationSummary => {
            const full: MetadataValidationSummary = {
                ...summary,
                validatedAtUtc: new Date().toISOString(),
                durationMs: Date.now() - startedAt,
            };
            if (validated) {
                entry.lastValidatedAtMs = Date.now();
            }
            entry.lastValidation = full;
            return full;
        };
        const run = (async (): Promise<MetadataValidationSummary> => {
            if (!entry.snapshot || entry.status === "failed" || entry.status === "absent") {
                // Nothing to validate — validation IS the (joined) hydration.
                await this.hydrate(entry);
                const ok = entry.status === "ready";
                return finish({ tier: "fullRefresh", result: ok ? "unchanged" : "failed" }, ok);
            }
            try {
                const digest = await this.runExclusive(
                    entry,
                    async () => {
                        const session = await this.sessions.open();
                        const rows = await this.rows(session, CHEAP_DIGEST, "metadata:digest");
                        // Row shape: [current_db, object_count, object_hash];
                        // current_db is the CACHE-5 identity rider (H-5) and
                        // never part of the compared digest.
                        const row = rows[0] ?? [];
                        return `${row[1]}:${row[2]}`;
                    },
                    { timeoutMs: this.options.laneOpTimeoutMs ?? 15_000, opKind: "digest" },
                );
                const baseline = entry.lastDigest;
                entry.lastDigest = digest;
                if (baseline !== undefined && digest !== baseline) {
                    diag.emit({
                        feature: "metadata",
                        kind: "event",
                        type: "metadata.drift",
                        fields: {
                            database: { raw: entry.key.database, cls: "source.path" },
                            generation: {
                                raw: String(entry.generation),
                                cls: "diagnostic.metadata",
                            },
                        },
                    });
                    await this.hydrate(entry, true);
                    return finish(
                        {
                            tier: "cheapDatabaseDigest",
                            result: "changed",
                            staleReason: "digestMismatch",
                        },
                        entry.status === "ready",
                    );
                }
                return finish({ tier: "cheapDatabaseDigest", result: "unchanged" }, true);
            } catch {
                return finish(
                    { tier: "cheapDatabaseDigest", result: "failed", staleReason: "unknown" },
                    false,
                );
            }
        })();
        entry.validationInFlight = run;
        void run.finally(() => {
            if (entry.validationInFlight === run) {
                entry.validationInFlight = undefined;
            }
        });
        return run;
    }

    /**
     * Cheap digest check (§9.2), poll/EXEC-sniff entry point: silent, never
     * queued, skipped while hydrating — a thin wrapper over the coalesced
     * T1 validation (the summary machinery is shared with ensureFresh).
     */
    private async checkDigest(entry: CatalogEntry): Promise<void> {
        if (entry.status !== "ready" || entry.hydrating) {
            return;
        }
        try {
            await this.validateEntry(entry);
        } catch {
            // validateEntry never rejects; defensive only (§9.2 silence).
        }
    }

    /**
     * The freshness decision procedure (addendum §4.2, implemented
     * exactly). Disk branches land in CACHE-3; offline settings in CACHE-6
     * (mode "offlineSnapshot" is honored now). Waits are races (C-9): the
     * underlying lane work always completes for other waiters.
     */
    async ensureFreshEntry(
        entry: CatalogEntry,
        policy: MetadataFreshnessPolicy,
    ): Promise<FreshCatalogResult> {
        const startedAt = Date.now();
        const span = diag.startSpan({
            feature: "metadata",
            kind: "span",
            type: "metadata.ensureFresh",
            fields: {
                mode: { raw: policy.mode, cls: "diagnostic.metadata" },
                reason: { raw: policy.reason, cls: "diagnostic.metadata" },
            },
        });
        try {
            const decided = await this.decideFresh(entry, policy, startedAt);
            const result = this.applySectionGate(decided, policy);
            span.end("ok", {
                freshness: { raw: result.freshness, cls: "diagnostic.metadata" },
                source: { raw: result.source, cls: "diagnostic.metadata" },
                waitedMs: { raw: result.waitedMs, cls: "diagnostic.metadata" },
            });
            return result;
        } catch (error) {
            span.fail(error);
            throw error;
        }
    }

    private makeFresh(
        entry: CatalogEntry,
        startedAt: number,
        snapshot: CatalogSnapshot | undefined,
        source: FreshCatalogResult["source"],
        freshness: FreshCatalogResult["freshness"],
        extra?: Partial<FreshCatalogResult>,
    ): FreshCatalogResult {
        const capturedAtUtc = snapshot?.capturedAtUtc;
        const staleAge = capturedAtUtc ? Date.now() - Date.parse(capturedAtUtc) : undefined;
        return {
            snapshot,
            generation: snapshot?.generation ?? entry.generation,
            source: snapshot ? source : "none",
            freshness,
            ...(capturedAtUtc ? { capturedAtUtc } : {}),
            ...(staleAge !== undefined && Number.isFinite(staleAge)
                ? { staleAgeMs: Math.max(0, staleAge) }
                : {}),
            waitedMs: Date.now() - startedAt,
            ...extra,
        };
    }

    private validatedWithin(entry: CatalogEntry, ttlMs: number | undefined): boolean {
        return (
            ttlMs !== undefined &&
            entry.lastValidatedAtMs !== undefined &&
            Date.now() - entry.lastValidatedAtMs <= ttlMs
        );
    }

    private async decideFresh(
        entry: CatalogEntry,
        policy: MetadataFreshnessPolicy,
        startedAt: number,
    ): Promise<FreshCatalogResult> {
        switch (policy.mode) {
            case "allowStale": {
                if (entry.snapshot) {
                    let backgroundRefreshStarted = false;
                    const ageMs = Date.now() - Date.parse(entry.snapshot.capturedAtUtc);
                    if (
                        policy.backgroundRefresh !== false &&
                        policy.maxStalenessMs !== undefined &&
                        Number.isFinite(ageMs) &&
                        ageMs > policy.maxStalenessMs &&
                        !entry.hydrating
                    ) {
                        void this.hydrate(entry, true);
                        backgroundRefreshStarted = true;
                    }
                    const freshness = entry.hydrating
                        ? "refreshing"
                        : this.validatedWithin(entry, policy.validationTtlMs)
                          ? "validated"
                          : "stale";
                    return this.makeFresh(entry, startedAt, entry.snapshot, "memory", freshness, {
                        ...(backgroundRefreshStarted ? { backgroundRefreshStarted } : {}),
                    });
                }
                // No snapshot: join (or kick) hydration up to the wait budget.
                const outcome = await this.raceWait(this.hydrate(entry), policy);
                if (outcome === "done" && entry.snapshot) {
                    return this.makeFresh(entry, startedAt, entry.snapshot, "live", "live");
                }
                return this.makeFresh(entry, startedAt, entry.snapshot, "memory", "unavailable");
            }
            case "requireValidated": {
                if (
                    entry.snapshot &&
                    this.validatedWithin(entry, policy.validationTtlMs ?? 120_000)
                ) {
                    return this.makeFresh(entry, startedAt, entry.snapshot, "memory", "validated");
                }
                const validation = this.validateEntry(entry);
                const outcome = await this.raceWait(validation, policy);
                if (outcome === "timeout") {
                    // C-9: stop waiting, never cancel; best snapshot + honesty.
                    return this.makeFresh(
                        entry,
                        startedAt,
                        entry.snapshot,
                        "memory",
                        entry.snapshot ? "stale" : "unavailable",
                        { validation: { tier: "none", result: "notChecked" } },
                    );
                }
                const summary = await validation;
                if (summary.result === "unchanged") {
                    return this.makeFresh(entry, startedAt, entry.snapshot, "memory", "validated", {
                        validation: summary,
                    });
                }
                if (summary.result === "changed" && entry.status === "ready") {
                    // validateEntry awaited the chained refresh internally.
                    return this.makeFresh(entry, startedAt, entry.snapshot, "live", "live", {
                        validation: summary,
                    });
                }
                // failed (or changed-but-refresh-failed): C-7 row — snapshot
                // stays readable, freshness says the bar was not met.
                return this.makeFresh(
                    entry,
                    startedAt,
                    entry.snapshot,
                    "memory",
                    entry.snapshot ? "stale" : "unavailable",
                    { validation: summary },
                );
            }
            case "requireLive": {
                const outcome = await this.raceWait(this.hydrate(entry, true), policy);
                if (outcome === "done" && entry.status === "ready") {
                    return this.makeFresh(entry, startedAt, entry.snapshot, "live", "live");
                }
                // C-7: strict callers refuse on freshness — but they still
                // get the retained snapshot to offer the explicit offline path.
                return this.makeFresh(entry, startedAt, entry.snapshot, "memory", "unavailable");
            }
            case "offlineSnapshot": {
                // No network, ever, on this path.
                return this.makeFresh(
                    entry,
                    startedAt,
                    entry.snapshot,
                    "offline",
                    entry.snapshot ? "stale" : "unavailable",
                );
            }
        }
    }

    /**
     * Readiness gating AFTER the freshness decision (§4.2 tail): require*
     * callers with unready requested sections downgrade to "unavailable"
     * unless allowPartial; allowStale callers receive the snapshot plus
     * per-section truth and do their own honest degradation.
     */
    private applySectionGate(
        result: FreshCatalogResult,
        policy: MetadataFreshnessPolicy,
    ): FreshCatalogResult {
        if (
            !policy.sections?.length ||
            policy.allowPartial === true ||
            policy.mode === "allowStale" ||
            policy.mode === "offlineSnapshot" ||
            !result.snapshot
        ) {
            return result;
        }
        const unready = policy.sections.some((section) => {
            const state = result.snapshot!.readiness[section];
            return state !== "ready" && state !== "lite";
        });
        return unready ? { ...result, freshness: "unavailable" } : result;
    }

    /**
     * Race a wait budget (and optional AbortSignal) against shared work —
     * NEVER a cancellation (C-9): the work keeps running for other waiters.
     */
    private raceWait(
        work: Promise<unknown>,
        policy: MetadataFreshnessPolicy,
    ): Promise<"done" | "timeout"> {
        const timeoutMs = policy.timeoutMs;
        const signal = policy.signal;
        if (timeoutMs === undefined && !signal) {
            return work.then(
                () => "done" as const,
                () => "done" as const,
            );
        }
        return new Promise((resolve) => {
            let settled = false;
            const settle = (value: "done" | "timeout") => {
                if (!settled) {
                    settled = true;
                    if (timer !== undefined) {
                        clearTimeout(timer);
                    }
                    resolve(value);
                }
            };
            const timer =
                timeoutMs !== undefined
                    ? setTimeout(() => settle("timeout"), timeoutMs)
                    : undefined;
            (timer as { unref?: () => void } | undefined)?.unref?.();
            if (signal) {
                if (signal.aborted) {
                    settle("timeout");
                } else {
                    signal.addEventListener("abort", () => settle("timeout"), { once: true });
                }
            }
            work.then(
                () => settle("done"),
                () => settle("done"),
            );
        });
    }

    private ensurePolling(): void {
        if (this.pollTimer) {
            return;
        }
        const seconds = this.options.pollSeconds ?? 60;
        if (seconds <= 0) {
            return;
        }
        this.pollTimer = setInterval(() => {
            for (const entry of this.entries.values()) {
                if (entry.refCount > 0) {
                    void this.checkDigest(entry);
                }
            }
        }, seconds * 1000);
        (this.pollTimer as { unref?: () => void }).unref?.();
    }

    private maybeStopPolling(): void {
        if ([...this.entries.values()].every((entry) => entry.refCount === 0) && this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
    }

    dispose(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
        this.entries.clear();
    }
}
