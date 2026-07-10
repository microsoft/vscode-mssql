/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * RetainedRowStore (C2D-1, plan §8 + addendum §5.1/§5.3): the lease-owning
 * wrapper over one run's RowStore. The live run holds an implicit lease from
 * construction; snapshots/pins/exports retain additional leases. The FINAL
 * release — whoever it is — disposes the physical store and its spill.
 *
 * Lifecycle state machine: active → draining → disposed. `retain` succeeds
 * only while active; a retain racing the final release gets a clean
 * `undefined`, never a lease on a dying store. Every release path is
 * idempotent. On live-owner release the store demotes its memory cap
 * (lazily — set the ceiling, let async spill drain the overage; a release
 * must never stall the host on synchronous I/O).
 */

import * as crypto from "crypto";
import { Perf } from "../perf/perfTelemetry";
import { QsCellWindow } from "../sharedInterfaces/queryStudio";
import { RowStore } from "../queryStudio/rowStore";
import {
    CellWindowRequest,
    IQueryResultStore,
    QueryResultLeaseOwner,
    QueryResultSetFrozenSummary,
    QueryResultStoreLease,
    QueryResultStoreState,
    QueryResultStoreStats,
    RowStreamRequest,
} from "./queryResultTypes";

export type LiveOwnerReleaseReason =
    | "rerun"
    | "documentClosed"
    | "disconnect"
    | "extensionDeactivate";

export interface RetainedRowStoreMetadata {
    readonly runId: string;
    readonly createdEpochMs: number;
    readonly tuningDigest?: string;
    readonly tuningProfileId?: string;
    /** Memory ceiling applied when the live owner releases (addendum §5.1). */
    readonly retainedMemoryBytes: number;
}

export function newLeaseId(): string {
    return crypto.randomBytes(9).toString("base64url");
}

export class RetainedRowStore implements IQueryResultStore {
    readonly storeId = `qrs_${crypto.randomBytes(9).toString("base64url")}`;
    readonly kind = "rowStoreV1" as const;
    readonly runId: string;
    readonly createdEpochMs: number;

    private readonly leases = new Map<string, QueryResultLeaseOwner>();
    private liveLeaseId: string | undefined;
    private _state: QueryResultStoreState = "active";
    private windowReads = 0;
    private _runRecordId: string | undefined;
    private readonly disposeListeners = new Set<() => void>();

    constructor(
        private readonly rowStore: RowStore,
        private readonly metadata: RetainedRowStoreMetadata,
    ) {
        this.runId = metadata.runId;
        this.createdEpochMs = metadata.createdEpochMs;
        this.liveLeaseId = newLeaseId();
        this.leases.set(this.liveLeaseId, { kind: "liveRun", label: "Query Studio live run" });
    }

    get state(): QueryResultStoreState {
        return this._state;
    }

    get tuningDigest(): string | undefined {
        return this.metadata.tuningDigest;
    }

    get tuningProfileId(): string | undefined {
        return this.metadata.tuningProfileId;
    }

    get runRecordId(): string | undefined {
        return this._runRecordId;
    }

    /** Run records begin after store construction; stamped once known. */
    setRunRecordId(runRecordId: string | undefined): void {
        this._runRecordId = runRecordId;
    }

    /** Owners currently holding leases (status/diagnostics surface). */
    leaseOwners(): readonly QueryResultLeaseOwner[] {
        return [...this.leases.values()];
    }

    onDidDispose(listener: () => void): { dispose(): void } {
        this.disposeListeners.add(listener);
        return { dispose: () => this.disposeListeners.delete(listener) };
    }

    retain(owner: QueryResultLeaseOwner): QueryResultStoreLease | undefined {
        if (this._state !== "active") {
            return undefined;
        }
        const leaseId = newLeaseId();
        this.leases.set(leaseId, owner);
        return {
            leaseId,
            owner,
            store: this,
            dispose: () => this.release(leaseId),
        };
    }

    /**
     * The live run lets go: rerun, document close, disconnect, deactivate.
     * Idempotent. Demotes the memory cap so a store kept alive only by
     * snapshots stops holding a live-scroll-sized page cache.
     */
    releaseLiveOwner(reason: LiveOwnerReleaseReason): void {
        if (!this.liveLeaseId) {
            return;
        }
        const liveLeaseId = this.liveLeaseId;
        this.liveLeaseId = undefined;
        if (this._state === "active" && this.leases.size > 1) {
            const before = this.rowStore.stats.memoryBytes;
            this.rowStore.shrinkMemoryCap(this.metadata.retainedMemoryBytes);
            Perf.marker("mssql.queryResults.store.demote", "instant", {
                reason,
                targetBytes: this.metadata.retainedMemoryBytes,
                memoryBytesBefore: before,
            });
        }
        this.release(liveLeaseId);
    }

    demote(targetMemoryBytes: number): void {
        this.rowStore.shrinkMemoryCap(targetMemoryBytes);
    }

    private release(leaseId: string): void {
        if (!this.leases.delete(leaseId)) {
            return;
        }
        if (this.leases.size === 0 && this._state === "active") {
            this._state = "draining";
            // RowStore.dispose chains spill cleanup off the call stack; the
            // synchronous part only clears maps, so drain completes inline.
            this.rowStore.dispose();
            this._state = "disposed";
            for (const listener of [...this.disposeListeners]) {
                try {
                    listener();
                } catch {
                    /* listener isolation */
                }
            }
            this.disposeListeners.clear();
        }
    }

    getWindow(req: CellWindowRequest): Promise<QsCellWindow> {
        this.windowReads++;
        if (this._state !== "active") {
            return Promise.resolve({
                resultSetId: req.resultSetId,
                start: req.rowStart,
                rowCount: 0,
                columns: [],
                values: [],
            });
        }
        return this.rowStore.getRows(
            req.resultSetId,
            req.rowStart,
            req.rowCount,
            req.reason,
            req.columnStart !== undefined && req.columnCount !== undefined
                ? { start: req.columnStart, count: req.columnCount }
                : undefined,
        );
    }

    /** Chunked pull — the one iteration idiom for scans (addendum §1.2). */
    async *streamRows(req: RowStreamRequest): AsyncIterable<QsCellWindow> {
        const chunk = Math.max(1, req.chunkRows);
        let offset = req.rowStart;
        const end = req.rowStart + req.rowCount;
        while (offset < end) {
            const window = await this.getWindow({
                resultSetId: req.resultSetId,
                rowStart: offset,
                rowCount: Math.min(chunk, end - offset),
                reason: req.reason,
            });
            if (window.rowCount === 0) {
                return; // clamped past the set (or short/corrupt window)
            }
            yield window;
            offset += window.rowCount;
        }
    }

    summary(resultSetId: string): QueryResultSetFrozenSummary | undefined {
        const summary = this.rowStore.summary(resultSetId);
        if (!summary) {
            return undefined;
        }
        return {
            resultSetId,
            columnNames: summary.columns.map((c) => c.name),
            columns: summary.columns,
            rowCount: summary.rowCount,
            complete: summary.complete,
            ...(summary.truncatedReason ? { truncatedReason: summary.truncatedReason } : {}),
            corrupt: summary.corrupt,
        };
    }

    stats(): QueryResultStoreStats {
        const stats = this.rowStore.stats;
        return {
            memoryBytes: stats.memoryBytes,
            spillBytes: stats.spillBytes,
            resultSets: stats.resultSets,
            pages: stats.pages,
            spillReads: stats.spillReads,
            windowCacheHits: stats.windowCacheHits,
            windowCacheMisses: stats.windowCacheMisses,
            windowReads: this.windowReads,
        };
    }
}
