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
    "SELECT c.object_id, c.column_id, c.name, t.name AS type_name, c.max_length, c.precision, c.scale, c.is_nullable " +
    "FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id " +
    "JOIN sys.objects o ON o.object_id = c.object_id AND o.type IN ('U','V','IF','TF') AND o.is_ms_shipped = 0 " +
    "ORDER BY c.object_id, c.column_id;";
const H5_FOREIGN_KEYS =
    "SELECT fk.object_id, fk.name, fk.parent_object_id, fk.referenced_object_id " +
    "FROM sys.foreign_keys fk WHERE fk.is_ms_shipped = 0 ORDER BY fk.object_id;";
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
                return buildSchemaContext(snapshot, req);
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

    /**
     * Background catalog query → rows. Awaits the HANDLE completion (not
     * the sink callback): the session frees its active-query slot via the
     * completion promise's reaction order, so sequential queries must
     * synchronize on it or the next execute races into Busy.
     */
    private async rows(session: ISqlSession, sql: string, tag: string): Promise<unknown[][]> {
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

    private async hydrate(entry: CatalogEntry, force = false): Promise<void> {
        if (entry.hydrating && !force) {
            return entry.hydrating;
        }
        const run = this.hydrateCore(entry);
        entry.hydrating = run;
        try {
            await run;
        } finally {
            entry.hydrating = undefined;
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
                    );
                }
            } catch {
                columnsFailed = true; // publish failed, never pretend-empty (§7.4)
            }
            // H5 FK edges
            let fkFailed = false;
            try {
                for (const row of await this.rows(session, H5_FOREIGN_KEYS, "metadata:H5")) {
                    builder.addForeignKey(Number(row[2]), Number(row[3]), String(row[1]));
                }
            } catch {
                fkFailed = true;
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
                    foreignKeys: fkFailed ? "failed" : "ready",
                },
                columnsFailed || fkFailed ? "partial" : "full",
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
