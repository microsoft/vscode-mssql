/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * MetadataService core (metadata design §5/§7–9): progressive hydration
 * (H1 schemas → H2 objects/synonyms → H3 types/columns → H5 FK edges)
 * streamed from ISqlSession background queries, per-section readiness with
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

export interface CatalogKey {
    serverFingerprint: string;
    database: string;
}

const keyOf = (key: CatalogKey) => `${key.serverFingerprint}|${key.database}`;

export interface MetadataStatus {
    readiness: "absent" | "loading" | "ready" | "failed" | "stale";
    generation: number;
    mode: "full" | "lite" | "partial";
    stats?: { schemas: number; objects: number; columns: number; foreignKeys: number };
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
    "SELECT ic.object_id, c.name FROM sys.indexes i " +
    "JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id " +
    "JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id " +
    "WHERE i.is_primary_key = 1 ORDER BY ic.object_id, ic.key_ordinal;";
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
const CHEAP_DIGEST =
    "SELECT COUNT(*) AS object_count, ISNULL(CHECKSUM_AGG(CHECKSUM(o.object_id, o.modify_date)), 0) AS object_hash " +
    "FROM sys.objects o WHERE o.type IN ('U','V','P','FN','IF','TF','SN') AND o.is_ms_shipped = 0;";

/** DDL keywords that schedule a refresh (design §9.1). */
const DDL_KEYWORDS = new Set(["CREATE", "ALTER", "DROP", "SP_RENAME"]);
const MAYBE_DDL = new Set(["EXEC", "EXECUTE"]);

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
        private readonly options: { pollSeconds?: number } = {},
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
        };
    }

    private statusOf(entry: CatalogEntry): MetadataStatus {
        return {
            readiness: entry.status,
            generation: entry.generation,
            mode: entry.snapshot?.mode ?? "full",
            ...(entry.snapshot ? { stats: entry.snapshot.stats } : {}),
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
     * Hydrations are SERIALIZED per entry: the dedicated session allows one
     * active query, so a forced refresh chains AFTER the in-flight run
     * rather than overlapping it (overlap made both runs race into Busy —
     * found by the B15 store's concurrent A/B isolation tests).
     */
    private async hydrate(entry: CatalogEntry, force = false): Promise<void> {
        if (entry.hydrating) {
            if (!force) {
                return entry.hydrating;
            }
            const chained = entry.hydrating
                .catch(() => undefined)
                .then(() => this.hydrateCore(entry));
            entry.hydrating = chained;
            try {
                await chained;
            } finally {
                if (entry.hydrating === chained) {
                    entry.hydrating = undefined;
                }
            }
            return;
        }
        const run = this.hydrateCore(entry);
        entry.hydrating = run;
        try {
            await run;
        } finally {
            if (entry.hydrating === run) {
                entry.hydrating = undefined;
            }
        }
    }

    private async hydrateCore(entry: CatalogEntry): Promise<void> {
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
                        caseSensitive: collation ? /_CS(_|$)/i.test(collation) : undefined,
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
            // H4 primary key columns
            let keysFailed = false;
            try {
                for (const row of await this.rows(session, H4_KEYS, "metadata:H4")) {
                    builder.markPrimaryKeyColumn(Number(row[0]), String(row[1]));
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
                },
                columnsFailed || fkFailed || keysFailed || paramsFailed ? "partial" : "full",
            );
            entry.status = "ready";
            entry.lastDigest = undefined; // re-baseline on next poll
            span.end("ok");
        } catch (error) {
            entry.status = "failed";
            span.fail(error);
        }
        this.notify(entry);
    }

    /** Cheap digest (§9.2): change → full re-hydrate (v1 refresh plan). */
    private async checkDigest(entry: CatalogEntry): Promise<void> {
        if (entry.status !== "ready" || entry.hydrating) {
            return;
        }
        try {
            const session = await this.sessions.open();
            const rows = await this.rows(session, CHEAP_DIGEST, "metadata:digest");
            const digest = rows.map((row) => row.join(":")).join(";");
            if (entry.lastDigest === undefined) {
                entry.lastDigest = digest;
                return;
            }
            if (digest !== entry.lastDigest) {
                entry.lastDigest = digest;
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
            }
        } catch {
            // Poll failures are silent (skipped polls are not queued — §9.2).
        }
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
