/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * QueryResultAccessService (C2D-1, plan §7 + addendum §1/§5): the product-wide
 * result access layer. Owns live-source registration, immutable snapshots
 * over retained stores, snapshot leases, retention (TTL + budget, deduped by
 * store), clamped row-window reads, and the status surface.
 *
 * Invariants:
 *  - snapshot creation is O(result-set-count) — never a row scan (the
 *    `scanFree` diagnostics attr is the standing regression proof);
 *  - a snapshot's windows clamp to the row counts frozen at creation;
 *  - leased snapshots are never silently disposed; the sweep touches only
 *    unleased ones (TTL for AI/chat purposes, immediate for closed pins);
 *  - no row values, SQL text, or message text in any diagnostics field.
 */

import * as crypto from "crypto";
import { Perf } from "../perf/perfTelemetry";
import { QsCellWindow, QsMessageRow } from "../sharedInterfaces/queryStudio";
import { RowReadReason } from "../queryStudio/rowStore";
import { packBitmap } from "../services/sqlDataPlane/api";
import { windowCellReader } from "./cellReader";
import {
    EvaluateOptions,
    TransformResult,
    TransformSourceReader,
    evaluateTransform,
} from "./transformEngine";
import { TransformSpec, transformSpecDigest } from "./transformSpec";
import {
    CreateQueryResultSnapshotRequest,
    IQueryResultStore,
    LiveQueryResultSource,
    LiveQueryResultSummary,
    QueryResultAccessError,
    QueryResultAccessStatus,
    QueryResultLeaseOwner,
    QueryResultMessageCapture,
    QueryResultQueryCapture,
    QueryResultSetFrozenSummary,
    QueryResultSnapshotDescription,
    QueryResultSnapshotLease,
    QueryResultSnapshotPurpose,
    QueryResultSnapshotSummary,
    QueryResultSourceIdentity,
    QueryResultStoreLease,
} from "./queryResultTypes";
import { newLeaseId } from "./resultStoreLease";
import { QueryResultsSnapshotParams, resolveQueryResultsParams } from "./queryResultsParams";

export interface QueryResultGetWindowParams {
    readonly snapshotId: string;
    readonly resultSetId: string;
    readonly rowStart: number;
    readonly rowCount: number;
    readonly columnStart?: number;
    readonly columnCount?: number;
    readonly reason: RowReadReason;
}

interface SnapshotRecord {
    readonly snapshotId: string;
    readonly createdEpochMs: number;
    readonly source: QueryResultSourceIdentity;
    readonly purpose: QueryResultSnapshotPurpose;
    readonly resultSets: readonly QueryResultSetFrozenSummary[];
    readonly messages: QueryResultMessageCapture;
    readonly query: QueryResultQueryCapture;
    readonly provenance: {
        runId: string;
        runRecordId?: string;
        tuningDigest?: string;
        tuningProfileId?: string;
    };
    readonly storeLease: QueryResultStoreLease;
    readonly leases: Map<string, QueryResultLeaseOwner>;
    /** Derived snapshot (C2D-T §3.6): a row-id view over the parent's store. */
    readonly derived?: {
        readonly parentSnapshotId: string;
        readonly specDigest: string;
        readonly sourceResultSetId: string;
        readonly rowIds: readonly number[];
    };
    lastAccessEpochMs: number;
    lastUnleasedEpochMs: number | undefined;
    disposed: boolean;
}

function shortDigest(value: string): string {
    return crypto.createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}

export class QueryResultAccessService {
    private readonly sources = new Map<string, LiveQueryResultSource>();
    private readonly snapshots = new Map<string, SnapshotRecord>();
    /** leaseId → snapshotId, for releaseLease routing. */
    private readonly leaseIndex = new Map<string, string>();
    private readonly changeListeners = new Set<() => void>();
    private sweepTimer: ReturnType<typeof setInterval> | undefined;
    private lastSweep: { atEpochMs: number; swept: number; expired: number } | undefined;
    private disposed = false;

    constructor(
        private readonly resolveParams: () => QueryResultsSnapshotParams = () =>
            resolveQueryResultsParams(),
        private readonly now: () => number = () => Date.now(),
    ) {}

    // --- live sources ------------------------------------------------------------

    registerLiveSource(source: LiveQueryResultSource): { dispose(): void } {
        this.sources.set(source.sourceId, source);
        return {
            dispose: () => {
                this.sources.delete(source.sourceId);
            },
        };
    }

    listLiveSources(): readonly LiveQueryResultSummary[] {
        return [...this.sources.values()].map((source) => {
            const state = source.state();
            return {
                sourceId: source.sourceId,
                sourceKind: source.sourceKind,
                sourceTitle: source.sourceTitle(),
                streaming: state.streaming,
                resultSetCount: state.resultSets.length,
                totalRows: state.resultSets.reduce((total, s) => total + s.rowCount, 0),
            };
        });
    }

    // --- snapshot creation ---------------------------------------------------------

    async createSnapshot(
        request: CreateQueryResultSnapshotRequest,
    ): Promise<QueryResultSnapshotLease> {
        Perf.marker("mssql.queryResults.snapshot.create.begin", "begin");
        const params = this.resolveParams().params;
        const source = this.resolveSource(request);
        const state = source.state();
        const store = source.currentStore();
        if (!store || store.state !== "active") {
            throw new QueryResultAccessError(
                "storeUnavailable",
                "No result data is available to snapshot — run a query first.",
            );
        }
        const windowReadsBefore = store.stats().windowReads;

        const included = this.resolveScope(request, state.resultSets, store);
        this.enforceRetentionBudget(store, params.maxRetainedBytesMb);

        const storeLease = store.retain({
            kind: request.owner.kind,
            label: request.reason,
            ...(request.owner.ownerKey ? { ownerKey: request.owner.ownerKey } : {}),
        });
        if (!storeLease) {
            throw new QueryResultAccessError(
                "storeUnavailable",
                "The result store is no longer available.",
            );
        }

        const messages = this.captureMessages(
            source,
            request.includeMessages ?? "summary",
            params.maxLocalMessages,
        );
        const query = this.captureQuery(source, request.includeQueryText ?? "digest");
        const snapshotId = `qsnap_${crypto.randomBytes(12).toString("base64url")}`;
        const record: SnapshotRecord = {
            snapshotId,
            createdEpochMs: this.now(),
            source: {
                sourceId: source.sourceId,
                sourceKind: source.sourceKind,
                sourceTitle: source.sourceTitle(),
                sourceUriDigest: source.sourceUriDigest(),
            },
            purpose: request.owner.kind,
            resultSets: included,
            messages,
            query,
            provenance: {
                runId: store.runId,
                ...(source.runRecordId() ? { runRecordId: source.runRecordId() } : {}),
                ...(source.tuning().digest ? { tuningDigest: source.tuning().digest } : {}),
                ...(source.tuning().profileId
                    ? { tuningProfileId: source.tuning().profileId }
                    : {}),
            },
            storeLease,
            leases: new Map(),
            lastAccessEpochMs: this.now(),
            lastUnleasedEpochMs: undefined,
            disposed: false,
        };
        this.snapshots.set(snapshotId, record);
        const lease = this.mintLease(record, request.owner);
        this.ensureSweepTimer();
        Perf.marker("mssql.queryResults.snapshot.create.end", "end", {
            resultSetCount: included.length,
            totalRows: included.reduce((total, s) => total + s.rowCount, 0),
            ownerKind: request.owner.kind,
            purpose: record.purpose,
            scanFree: store.stats().windowReads === windowReadsBefore,
        });
        this.notifyChanged();
        return lease;
    }

    private resolveSource(request: CreateQueryResultSnapshotRequest): LiveQueryResultSource {
        if (request.sourceId) {
            const source = this.sources.get(request.sourceId);
            if (source) {
                return source;
            }
        }
        if (request.sourceUriKey) {
            for (const source of this.sources.values()) {
                if (source.sourceUriDigest() === shortDigest(request.sourceUriKey)) {
                    return source;
                }
            }
        }
        throw new QueryResultAccessError(
            "sourceNotFound",
            "The query document for this snapshot is no longer open.",
        );
    }

    /** Completed-only rule (plan §8.4): every included set must be complete. */
    private resolveScope(
        request: CreateQueryResultSnapshotRequest,
        liveSets: readonly QueryResultSetFrozenSummary[],
        store: IQueryResultStore,
    ): QueryResultSetFrozenSummary[] {
        const freeze = (live: QueryResultSetFrozenSummary): QueryResultSetFrozenSummary => {
            // The store's summary is the authoritative frozen row count; the
            // live summary contributes ordering/plan metadata.
            const fromStore = store.summary(live.resultSetId);
            if (!fromStore) {
                throw new QueryResultAccessError(
                    "resultSetNotFound",
                    `Result set ${live.resultSetId} is not in the current result store.`,
                );
            }
            if (!fromStore.complete) {
                throw new QueryResultAccessError(
                    "resultSetIncomplete",
                    "This result set is still streaming — it can be pinned once it completes.",
                );
            }
            return { ...live, ...fromStore, columnNames: live.columnNames };
        };
        if (request.scope.kind === "resultSet") {
            const id = request.scope.resultSetId;
            const live = liveSets.find((s) => s.resultSetId === id);
            if (!live) {
                throw new QueryResultAccessError(
                    "resultSetNotFound",
                    `Result set ${id} was not found.`,
                );
            }
            return [freeze(live)];
        }
        if (request.scope.kind === "resultSets") {
            const wanted = new Set(request.scope.resultSetIds);
            const picked = liveSets.filter((s) => wanted.has(s.resultSetId));
            if (picked.length !== wanted.size) {
                throw new QueryResultAccessError(
                    "resultSetNotFound",
                    "One or more requested result sets were not found.",
                );
            }
            return picked.map(freeze);
        }
        // allCompleteResultSets: requires the run itself to be settled.
        const complete = liveSets.filter((s) => s.complete);
        if (complete.length === 0) {
            throw new QueryResultAccessError(
                "resultSetNotFound",
                "No complete result sets are available yet.",
            );
        }
        return complete.map(freeze);
    }

    private captureMessages(
        source: LiveQueryResultSource,
        policy: "none" | "summary" | "allLocal",
        maxLocalMessages: number,
    ): QueryResultMessageCapture {
        const rows = source.messagesSnapshot();
        const errorIndexes = rows
            .map((row, index) => (row.kind === "error" ? index : -1))
            .filter((index) => index >= 0);
        const summary = {
            count: policy === "none" ? 0 : rows.length,
            errorCount: policy === "none" ? 0 : errorIndexes.length,
            ...(policy !== "none" && errorIndexes.length > 0
                ? { firstErrorIndex: errorIndexes[0] }
                : {}),
        };
        if (policy !== "allLocal" || rows.length > maxLocalMessages) {
            return { summary };
        }
        const frozen: QsMessageRow[] = rows.map((row) => ({ ...row }));
        return {
            summary,
            getWindow: (start, count) =>
                Promise.resolve({ messages: frozen.slice(start, start + count) }),
        };
    }

    private captureQuery(
        source: LiveQueryResultSource,
        policy: "none" | "digest" | "localOnly",
    ): QueryResultQueryCapture {
        if (policy === "none") {
            return {};
        }
        const text = source.queryText();
        if (text === undefined) {
            return {};
        }
        return {
            digest: shortDigest(text),
            ...(policy === "localOnly" ? { textLocal: text } : {}),
        };
    }

    // --- leases ----------------------------------------------------------------------

    acquireSnapshot(
        snapshotId: string,
        owner: QueryResultLeaseOwner,
    ): QueryResultSnapshotLease | undefined {
        const record = this.snapshots.get(snapshotId);
        if (!record || record.disposed) {
            return undefined;
        }
        const lease = this.mintLease(record, owner);
        Perf.marker("mssql.queryResults.snapshot.acquire", "instant", {
            ownerKind: owner.kind,
            leaseCount: record.leases.size,
        });
        return lease;
    }

    private mintLease(
        record: SnapshotRecord,
        owner: QueryResultLeaseOwner,
    ): QueryResultSnapshotLease {
        const leaseId = newLeaseId();
        record.leases.set(leaseId, owner);
        record.lastUnleasedEpochMs = undefined;
        this.leaseIndex.set(leaseId, record.snapshotId);
        return {
            leaseId,
            snapshotId: record.snapshotId,
            owner,
            dispose: () => this.releaseLease(leaseId, "leaseDisposed"),
        };
    }

    releaseLease(leaseId: string, reason: string = "released"): void {
        const snapshotId = this.leaseIndex.get(leaseId);
        if (!snapshotId) {
            return;
        }
        this.leaseIndex.delete(leaseId);
        const record = this.snapshots.get(snapshotId);
        if (!record || !record.leases.delete(leaseId)) {
            return;
        }
        Perf.marker("mssql.queryResults.snapshot.release", "instant", {
            reason,
            leaseCount: record.leases.size,
        });
        if (record.leases.size === 0) {
            // Pinned-document snapshots live exactly as long as their
            // document; AI/chat snapshots idle until TTL/budget sweeps them.
            if (record.purpose === "pinnedDocument") {
                this.disposeSnapshot(record, "lastLeaseReleased");
            } else {
                record.lastUnleasedEpochMs = this.now();
            }
        }
    }

    private disposeSnapshot(record: SnapshotRecord, reason: string): void {
        if (record.disposed) {
            return;
        }
        record.disposed = true;
        this.snapshots.delete(record.snapshotId);
        for (const leaseId of record.leases.keys()) {
            this.leaseIndex.delete(leaseId);
        }
        record.leases.clear();
        const storeState = record.storeLease.store.state;
        record.storeLease.dispose();
        Perf.marker("mssql.queryResults.snapshot.dispose", "instant", {
            reason,
            ageMs: this.now() - record.createdEpochMs,
            storeDisposed: storeState !== record.storeLease.store.state,
        });
        this.notifyChanged();
    }

    // --- reads ------------------------------------------------------------------------

    /** Clamped to the frozen row counts; never throws through the UI path. */
    async getWindow(params: QueryResultGetWindowParams): Promise<QsCellWindow> {
        const record = this.snapshots.get(params.snapshotId);
        const empty: QsCellWindow = {
            resultSetId: params.resultSetId,
            start: params.rowStart,
            rowCount: 0,
            columns: [],
            values: [],
        };
        if (!record || record.disposed) {
            return empty;
        }
        const frozen = record.resultSets.find((s) => s.resultSetId === params.resultSetId);
        if (!frozen || params.rowStart >= frozen.rowCount) {
            return { ...empty, columns: frozen?.columns ?? [] };
        }
        record.lastAccessEpochMs = this.now();
        const rowCount = Math.min(params.rowCount, frozen.rowCount - params.rowStart);
        if (record.derived) {
            return this.derivedWindow(record, params, rowCount);
        }
        return record.storeLease.store.getWindow({
            resultSetId: params.resultSetId,
            rowStart: params.rowStart,
            rowCount,
            ...(params.columnStart !== undefined && params.columnCount !== undefined
                ? { columnStart: params.columnStart, columnCount: params.columnCount }
                : {}),
            reason: params.reason,
        });
    }

    /**
     * Derived-snapshot window (§3.6): derived offsets → parent SOURCE row
     * ids → batched contiguous fetches, stitched back into one window.
     * Still bounded: at most `rowCount` rows cross this path.
     */
    private async derivedWindow(
        record: SnapshotRecord,
        params: QueryResultGetWindowParams,
        rowCount: number,
    ): Promise<QsCellWindow> {
        const derived = record.derived!;
        const ids = derived.rowIds.slice(params.rowStart, params.rowStart + rowCount);
        const values: unknown[][] = [];
        const nullBits: boolean[] = [];
        let columns = record.resultSets[0]?.columns ?? [];
        let typeHints: string[] | undefined;
        let index = 0;
        while (index < ids.length) {
            // Contiguous run: one store window per run keeps fetches bounded
            // and page-friendly.
            let runEnd = index + 1;
            while (runEnd < ids.length && ids[runEnd] === ids[runEnd - 1] + 1) {
                runEnd++;
            }
            const window = await record.storeLease.store.getWindow({
                resultSetId: derived.sourceResultSetId,
                rowStart: ids[index],
                rowCount: runEnd - index,
                reason: params.reason,
            });
            const cells = windowCellReader(window);
            columns = window.columns.length > 0 ? window.columns : columns;
            typeHints ??= window.typeHints;
            for (let r = 0; r < window.rowCount; r++) {
                const row: unknown[] = [];
                for (let c = 0; c < window.columns.length; c++) {
                    const cell = cells.cellAt(r, c);
                    nullBits.push(cell.isNull);
                    row.push(cell.isNull ? undefined : window.values[r]?.[c]);
                }
                values.push(row);
            }
            index = runEnd;
        }
        return {
            resultSetId: params.resultSetId,
            start: params.rowStart,
            rowCount: values.length,
            columns,
            values,
            nullBitmap: packBitmap(nullBits),
            ...(typeHints ? { typeHints } : {}),
        };
    }

    // --- transforms (C2D-T) ---------------------------------------------------------

    /** Engine-facing reader over a snapshot: frozen clamp + reason tagging. */
    snapshotReader(
        snapshotId: string,
        resultSetId: string,
        reason: RowReadReason,
        chunkRowsDefault = 2048,
    ): TransformSourceReader | undefined {
        const record = this.snapshots.get(snapshotId);
        const frozen = record?.resultSets.find((s) => s.resultSetId === resultSetId);
        if (!record || record.disposed || !frozen) {
            return undefined;
        }
        const service = this;
        return {
            columnNames: () => frozen.columnNames,
            rowCount: () => frozen.rowCount,
            window: (start, count) =>
                service.getWindow({
                    snapshotId,
                    resultSetId,
                    rowStart: start,
                    rowCount: count,
                    reason,
                }),
            async *stream(start, count, chunkRows) {
                const chunk = Math.max(1, chunkRows || chunkRowsDefault);
                let offset = Math.max(0, start);
                const end = Math.min(start + count, frozen.rowCount);
                while (offset < end) {
                    const window = await service.getWindow({
                        snapshotId,
                        resultSetId,
                        rowStart: offset,
                        rowCount: Math.min(chunk, end - offset),
                        reason,
                    });
                    if (window.rowCount === 0) {
                        return;
                    }
                    yield window;
                    offset += window.rowCount;
                }
            },
        };
    }

    /**
     * Evaluate a validated transform spec against a snapshot. Budgets come
     * from the params registry unless overridden; results carry EvalStats
     * honesty verbatim. Diagnostics log the spec DIGEST and stats — never
     * filter literals or output values (§3.7).
     */
    async evaluateSnapshotTransform(
        spec: TransformSpec,
        options?: {
            isCancelled?: () => boolean;
            reason?: RowReadReason;
            overrides?: Partial<EvaluateOptions>;
        },
    ): Promise<TransformResult> {
        const record = this.snapshots.get(spec.source.snapshotId);
        if (!record || record.disposed) {
            throw new QueryResultAccessError(
                "snapshotNotFound",
                "The snapshot for this transform no longer exists.",
            );
        }
        const reader = this.snapshotReader(
            spec.source.snapshotId,
            spec.source.resultSetId,
            options?.reason ?? "transform",
        );
        if (!reader) {
            throw new QueryResultAccessError(
                "resultSetNotFound",
                "The result set for this transform was not found in the snapshot.",
            );
        }
        const { params } = this.resolveParams();
        const evalOptions: EvaluateOptions = {
            budget: {
                maxRowsScanned: params.transformMaxRowsScanned,
                maxEvalMs: params.transformMaxEvalMs,
                maxGroups: params.transformMaxGroups,
                maxOutputCells: params.transformMaxOutputCells,
                maxOutputBytes: params.transformMaxOutputBytes,
            },
            chunkRows: params.transformChunkRows,
            yieldEveryRows: params.transformYieldEveryRows,
            maxDistinctExact: params.maxDistinctExact,
            ...(options?.isCancelled ? { isCancelled: options.isCancelled } : {}),
            ...options?.overrides,
        };
        Perf.marker("mssql.queryResults.transform.evaluate.begin", "begin", {
            terminalKind: spec.terminal.kind,
            opCount: spec.ops?.length ?? 0,
            specDigest: transformSpecDigest(spec),
        });
        const result = await evaluateTransform(spec, reader, evalOptions);
        Perf.marker("mssql.queryResults.transform.evaluate.end", "end", {
            terminalKind: spec.terminal.kind,
            opCount: spec.ops?.length ?? 0,
            specDigest: result.specDigest,
            rowsScanned: result.stats.rowsScanned,
            rowsMatched: result.stats.rowsMatched,
            partial: result.stats.partial,
            ...(result.stats.partialReason ? { partialReason: result.stats.partialReason } : {}),
            outputRows: result.rows.length,
            outputClass: result.outputClass,
            ms: result.stats.elapsedMs,
        });
        return result;
    }

    /**
     * Derived snapshot (§3.6): evaluate a row-producing spec ONCE, keep only
     * the matching source row ids (never page copies), and register a new
     * immutable snapshot over the SAME store. Over `derivedMaxRows` → typed
     * error offering export instead.
     */
    async deriveSnapshot(
        spec: TransformSpec,
        owner: QueryResultLeaseOwner,
    ): Promise<QueryResultSnapshotLease> {
        const parent = this.snapshots.get(spec.source.snapshotId);
        if (!parent || parent.disposed) {
            throw new QueryResultAccessError(
                "snapshotNotFound",
                "The parent snapshot no longer exists.",
            );
        }
        const parentFrozen = parent.resultSets.find(
            (s) => s.resultSetId === spec.source.resultSetId,
        );
        if (!parentFrozen) {
            throw new QueryResultAccessError(
                "resultSetNotFound",
                "The result set was not found in the parent snapshot.",
            );
        }
        const { params } = this.resolveParams();
        Perf.marker("mssql.queryResults.derive.begin", "begin");
        // Row-id collection rides the scan itself; a count terminal keeps
        // the evaluation from materializing any output rows.
        const idSpec: TransformSpec = {
            ...spec,
            terminal: { kind: "aggregate", aggs: [{ fn: "count" }] },
        };
        const result = await this.evaluateSnapshotTransform(idSpec, {
            reason: "transform",
            overrides: { collectMatchedRowIds: { max: params.derivedMaxRows } },
        });
        if (result.matchedRowIdsOverflow) {
            throw new QueryResultAccessError(
                "retentionBudgetExceeded",
                `The filtered view exceeds ${params.derivedMaxRows.toLocaleString()} rows — export the data instead of deriving a snapshot.`,
            );
        }
        if (result.stats.partial) {
            throw new QueryResultAccessError(
                "storeUnavailable",
                `Deriving stopped early (${result.stats.partialReason}); narrow the source or raise the transform budget.`,
            );
        }
        // Compose through a derived parent so ids always index the PHYSICAL set.
        const matched = result.matchedSourceRowIds ?? [];
        const rowIds = parent.derived
            ? matched.map((id) => parent.derived!.rowIds[id]).filter((id) => id !== undefined)
            : matched;
        const sourceResultSetId = parent.derived
            ? parent.derived.sourceResultSetId
            : spec.source.resultSetId;
        const storeLease = parent.storeLease.store.retain(owner);
        if (!storeLease) {
            throw new QueryResultAccessError(
                "storeUnavailable",
                "The parent snapshot's store is no longer available.",
            );
        }
        const specDigest = transformSpecDigest(spec);
        const snapshotId = `qsnap_${crypto.randomBytes(12).toString("base64url")}`;
        const record: SnapshotRecord = {
            snapshotId,
            createdEpochMs: this.now(),
            source: parent.source,
            purpose: owner.kind,
            resultSets: [
                {
                    ...parentFrozen,
                    resultSetId: spec.source.resultSetId,
                    rowCount: rowIds.length,
                    complete: true,
                },
            ],
            messages: { summary: { count: 0, errorCount: 0 } },
            query: parent.query,
            provenance: parent.provenance,
            storeLease,
            leases: new Map(),
            derived: {
                parentSnapshotId: parent.snapshotId,
                specDigest,
                sourceResultSetId,
                rowIds,
            },
            lastAccessEpochMs: this.now(),
            lastUnleasedEpochMs: undefined,
            disposed: false,
        };
        this.snapshots.set(snapshotId, record);
        const lease = this.mintLease(record, owner);
        this.ensureSweepTimer();
        Perf.marker("mssql.queryResults.derive.end", "end", {
            specDigest,
            derivedRows: rowIds.length,
            rowsScanned: result.stats.rowsScanned,
            fromDerived: parent.derived !== undefined,
        });
        this.notifyChanged();
        return lease;
    }

    listSnapshots(): readonly QueryResultSnapshotSummary[] {
        return [...this.snapshots.values()].map((record) => this.summarize(record));
    }

    describeSnapshot(snapshotId: string): QueryResultSnapshotDescription | undefined {
        const record = this.snapshots.get(snapshotId);
        if (!record || record.disposed) {
            return undefined;
        }
        return {
            ...this.summarize(record),
            resultSets: record.resultSets,
            messages: record.messages.summary,
            ...(record.query.digest ? { queryTextDigest: record.query.digest } : {}),
            provenance: {
                ...record.provenance,
                storeKind: record.storeLease.store.kind,
            },
            store: record.storeLease.store.stats(),
            hasLocalMessages: record.messages.getWindow !== undefined,
            hasLocalQueryText: record.query.textLocal !== undefined,
            ...(record.derived
                ? {
                      derived: {
                          parentSnapshotId: record.derived.parentSnapshotId,
                          specDigest: record.derived.specDigest,
                      },
                  }
                : {}),
        };
    }

    /** Local message window for pinned documents (never AI without a grant). */
    getSnapshotMessages(
        snapshotId: string,
        start: number,
        count: number,
    ): Promise<{ messages: QsMessageRow[] }> {
        const record = this.snapshots.get(snapshotId);
        if (!record || record.disposed || !record.messages.getWindow) {
            return Promise.resolve({ messages: [] });
        }
        return record.messages.getWindow(start, count);
    }

    private summarize(record: SnapshotRecord): QueryResultSnapshotSummary {
        return {
            snapshotId: record.snapshotId,
            createdEpochMs: record.createdEpochMs,
            source: record.source,
            purpose: record.purpose,
            resultSetCount: record.resultSets.length,
            totalRows: record.resultSets.reduce((total, s) => total + s.rowCount, 0),
            leaseCount: record.leases.size,
            complete: record.resultSets.every((s) => s.complete),
        };
    }

    // --- retention -----------------------------------------------------------------------

    /**
     * Budget accounting dedupes by store (addendum §5.2): many snapshots on
     * one store cost once. Refusal is a typed error after the sweep fails to
     * free room; leased snapshots are never victims.
     */
    private enforceRetentionBudget(candidate: IQueryResultStore, maxRetainedBytesMb: number): void {
        const budgetBytes = maxRetainedBytesMb * 1024 * 1024;
        const retained = this.retainedStoreMap();
        if (retained.has(candidate.storeId)) {
            return; // already accounted; another snapshot on it adds no bytes
        }
        const candidateBytes = candidate.stats().memoryBytes + candidate.stats().spillBytes;
        const currentBytes = [...retained.values()].reduce(
            (total, store) => total + store.stats().memoryBytes + store.stats().spillBytes,
            0,
        );
        if (currentBytes + candidateBytes <= budgetBytes) {
            return;
        }
        this.sweepNow("budget");
        const afterBytes = [...this.retainedStoreMap().values()].reduce(
            (total, store) => total + store.stats().memoryBytes + store.stats().spillBytes,
            0,
        );
        if (afterBytes + candidateBytes > budgetBytes) {
            throw new QueryResultAccessError(
                "retentionBudgetExceeded",
                "The retained result budget is full. Close pinned result tabs or export data, then try again.",
            );
        }
    }

    private retainedStoreMap(): Map<string, IQueryResultStore> {
        const stores = new Map<string, IQueryResultStore>();
        for (const record of this.snapshots.values()) {
            stores.set(record.storeLease.store.storeId, record.storeLease.store);
        }
        return stores;
    }

    /**
     * Dispose unleased snapshots: expired TTL first, then LRU while over the
     * unpinned-store cap. Exposed for deterministic tests; the timer calls it.
     */
    sweepNow(trigger: "timer" | "budget" | "manual" = "manual"): void {
        const { params } = this.resolveParams();
        const ttlMs = params.snapshotTtlMinutes * 60 * 1000;
        let swept = 0;
        let expired = 0;
        const unleased = [...this.snapshots.values()].filter(
            (record) => record.leases.size === 0 && !record.disposed,
        );
        for (const record of unleased) {
            const idleSince = record.lastUnleasedEpochMs ?? record.createdEpochMs;
            if (this.now() - idleSince > ttlMs) {
                this.disposeSnapshot(record, "ttlExpired");
                swept++;
                expired++;
            }
        }
        // Unpinned-store cap: LRU over stores whose snapshots are ALL unleased.
        const overCap = () =>
            this.unpinnedStoreCount() > params.maxUnpinnedStores ||
            (trigger === "budget" && this.unpinnedStoreCount() > 0);
        while (overCap()) {
            const victim = [...this.snapshots.values()]
                .filter((record) => record.leases.size === 0 && !record.disposed)
                .sort((a, b) => a.lastAccessEpochMs - b.lastAccessEpochMs)[0];
            if (!victim) {
                break;
            }
            this.disposeSnapshot(victim, trigger === "budget" ? "budgetSweep" : "storeCapSweep");
            swept++;
        }
        this.lastSweep = { atEpochMs: this.now(), swept, expired };
        if (swept > 0 || trigger === "timer") {
            Perf.marker("mssql.queryResults.snapshot.retentionSweep", "instant", {
                trigger,
                swept,
                expired,
                snapshots: this.snapshots.size,
                retainedStores: this.retainedStoreMap().size,
            });
        }
        if (this.snapshots.size === 0) {
            this.stopSweepTimer();
        }
    }

    private unpinnedStoreCount(): number {
        const unleasedStores = new Set<string>();
        const leasedStores = new Set<string>();
        for (const record of this.snapshots.values()) {
            const storeId = record.storeLease.store.storeId;
            if (record.leases.size > 0) {
                leasedStores.add(storeId);
            } else {
                unleasedStores.add(storeId);
            }
        }
        for (const storeId of leasedStores) {
            unleasedStores.delete(storeId);
        }
        return unleasedStores.size;
    }

    private ensureSweepTimer(): void {
        if (this.sweepTimer || this.disposed) {
            return;
        }
        const { params } = this.resolveParams();
        this.sweepTimer = setInterval(
            () => this.sweepNow("timer"),
            params.sweepIntervalSeconds * 1000,
        );
        // Never keep the host alive for a sweep.
        this.sweepTimer.unref?.();
    }

    private stopSweepTimer(): void {
        if (this.sweepTimer) {
            clearInterval(this.sweepTimer);
            this.sweepTimer = undefined;
        }
    }

    // --- status / lifecycle -----------------------------------------------------------------

    status(): QueryResultAccessStatus {
        const leasesByOwnerKind: Record<string, number> = {};
        for (const record of this.snapshots.values()) {
            for (const owner of record.leases.values()) {
                leasesByOwnerKind[owner.kind] = (leasesByOwnerKind[owner.kind] ?? 0) + 1;
            }
        }
        const stores = this.retainedStoreMap();
        let memoryBytes = 0;
        let spillBytes = 0;
        for (const store of stores.values()) {
            const stats = store.stats();
            memoryBytes += stats.memoryBytes;
            spillBytes += stats.spillBytes;
        }
        return {
            liveSources: this.sources.size,
            snapshots: this.snapshots.size,
            leasesByOwnerKind,
            retainedStores: stores.size,
            retainedMemoryBytes: memoryBytes,
            retainedSpillBytes: spillBytes,
            ...(this.lastSweep ? { lastSweep: this.lastSweep } : {}),
        };
    }

    onDidChangeSnapshots(listener: () => void): { dispose(): void } {
        this.changeListeners.add(listener);
        return { dispose: () => this.changeListeners.delete(listener) };
    }

    private notifyChanged(): void {
        for (const listener of [...this.changeListeners]) {
            try {
                listener();
            } catch {
                /* listener isolation */
            }
        }
    }

    dispose(): void {
        this.disposed = true;
        this.stopSweepTimer();
        for (const record of [...this.snapshots.values()]) {
            this.disposeSnapshot(record, "serviceDisposed");
        }
        this.sources.clear();
        this.changeListeners.clear();
    }
}

// --- singleton ---------------------------------------------------------------------------

let instance: QueryResultAccessService | undefined;

export function getQueryResultAccessService(): QueryResultAccessService {
    instance ??= new QueryResultAccessService();
    return instance;
}

/** Extension deactivation: dispose every snapshot and release every store. */
export function disposeQueryResultAccessService(): void {
    instance?.dispose();
    instance = undefined;
}

export function sourceUriDigest(uriKey: string): string {
    return shortDigest(uriKey);
}
