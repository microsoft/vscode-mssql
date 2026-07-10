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
        return record.storeLease.store.getWindow({
            resultSetId: params.resultSetId,
            rowStart: params.rowStart,
            rowCount: Math.min(params.rowCount, frozen.rowCount - params.rowStart),
            ...(params.columnStart !== undefined && params.columnCount !== undefined
                ? { columnStart: params.columnStart, columnCount: params.columnCount }
                : {}),
            reason: params.reason,
        });
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
