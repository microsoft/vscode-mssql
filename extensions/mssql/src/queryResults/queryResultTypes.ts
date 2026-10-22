/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Chat-to-Data (C2D) result-access contracts (chat_to_data plan §6/§7,
 * addendum §1): the product-wide vocabulary for detached query result data.
 * Storage tiers (RowStore today, ResultStoreV2/STS2/remote later) hide behind
 * IQueryResultStore; every consumer — pinned documents, exports, transforms,
 * AI tools — reads bounded windows through leases and never owns the store.
 *
 * Binding rules (addendum §1.1/§1.7): every read surface is Promise-returning
 * and carries a RowReadReason down to the store and up into diagnostics.
 * No type in this module may carry raw row values into coarse state — windows
 * are fetched, never stored on snapshots.
 */

import { QsCellWindow, QsMessageRow, QsResultColumn } from "../sharedInterfaces/queryStudio";
import { RowReadReason } from "../queryStudio/rowStore";

// --- leases ------------------------------------------------------------------

export type QueryResultLeaseOwnerKind =
    | "liveRun"
    | "pinnedDocument"
    | "aiTool"
    | "chatParticipant"
    | "export"
    | "command"
    | "debug"
    | "vectorWorkbench"
    | "spatialView";

export interface QueryResultLeaseOwner {
    readonly kind: QueryResultLeaseOwnerKind;
    readonly label?: string;
    /** Best-effort accident prevention, not a security boundary (addendum §1.8). */
    readonly ownerKey?: string;
    readonly documentUri?: string;
}

export interface QueryResultStoreLease {
    readonly leaseId: string;
    readonly owner: QueryResultLeaseOwner;
    readonly store: IQueryResultStore;
    dispose(): void;
}

// --- store facade --------------------------------------------------------------

export type QueryResultStoreKind = "rowStoreV1" | "resultStoreV2" | "sts2" | "remote";

export type QueryResultStoreState = "active" | "draining" | "disposed";

/** Window read request (addendum §1.2 — the QO window shape plus reason). */
export interface CellWindowRequest {
    readonly resultSetId: string;
    readonly rowStart: number;
    readonly rowCount: number;
    /** Horizontal projection (QO-7b); omitted = all columns. */
    readonly columnStart?: number;
    readonly columnCount?: number;
    /**
     * Sparse projection (VEC-3): explicit column ordinals in caller order —
     * a vector scan reads the vector column plus distant key/label columns
     * with one spill materialization per page. Wins over columnStart/Count
     * when both are present.
     */
    readonly columnOrdinals?: readonly number[];
    readonly reason: RowReadReason;
}

export interface RowStreamRequest {
    readonly resultSetId: string;
    readonly rowStart: number;
    /** Total rows to stream; clamped to what the set holds. */
    readonly rowCount: number;
    readonly chunkRows: number;
    /** Sparse projection (VEC-3), forwarded to every chunk window. */
    readonly columnOrdinals?: readonly number[];
    readonly reason: RowReadReason;
}

export interface QueryResultSetFrozenSummary {
    readonly resultSetId: string;
    readonly batchOrdinal?: number;
    readonly columnNames: string[];
    readonly columns?: QsResultColumn[];
    readonly typeHints?: string[];
    /** Row count frozen at snapshot creation; windows clamp to it. */
    readonly rowCount: number;
    readonly complete: boolean;
    readonly truncatedReason?: string;
    readonly corrupt: boolean;
    readonly isPlanResult?: boolean;
}

export interface QueryResultStoreStats {
    readonly memoryBytes: number;
    readonly spillBytes: number;
    readonly resultSets: number;
    readonly pages: number;
    readonly spillReads: number;
    readonly windowCacheHits: number;
    readonly windowCacheMisses: number;
    /** getWindow invocations through this facade — the scan-free proof. */
    readonly windowReads: number;
}

/**
 * The storage facade (plan §6.2, addendum §1.2). One physical run's rows.
 * Consumers hold leases; the final release disposes the physical store and
 * its spill. `retain` returns undefined once the store is draining/disposed —
 * a racing acquire gets a clean miss, never a lease on a dying store.
 */
export interface IQueryResultStore {
    readonly storeId: string;
    readonly runId: string;
    readonly createdEpochMs: number;
    readonly kind: QueryResultStoreKind;
    readonly state: QueryResultStoreState;

    retain(owner: QueryResultLeaseOwner): QueryResultStoreLease | undefined;
    getWindow(req: CellWindowRequest): Promise<QsCellWindow>;
    streamRows(req: RowStreamRequest): AsyncIterable<QsCellWindow>;
    summary(resultSetId: string): QueryResultSetFrozenSummary | undefined;
    stats(): QueryResultStoreStats;
    /** Lazy memory-cap shrink for retained stores (addendum §5.1). */
    demote(targetMemoryBytes: number): void;
}

// --- snapshots -----------------------------------------------------------------

export type QueryResultSnapshotPurpose = QueryResultLeaseOwnerKind;

export interface QueryResultSourceIdentity {
    readonly sourceId: string;
    readonly sourceKind: "queryStudio" | "headless";
    readonly sourceTitle: string;
    /** Digest, never the raw URI (diagnostics rules, plan §18.2). */
    readonly sourceUriDigest: string;
}

export interface QueryResultMessageSummary {
    readonly count: number;
    readonly errorCount: number;
    readonly firstErrorIndex?: number;
}

/**
 * Message capture behind an interface so a future host MessageStore swap is
 * invisible to snapshots (addendum §5.6). V1 = frozen array under threshold.
 */
export interface QueryResultMessageCapture {
    readonly summary: QueryResultMessageSummary;
    getWindow?(start: number, count: number): Promise<{ messages: QsMessageRow[] }>;
}

export interface QueryResultQueryCapture {
    /** sha256[0:12] of the run's SQL text; safe provenance. */
    readonly digest?: string;
    /** Full text, local consumers only; AI output requires a grant (C2D-5). */
    readonly textLocal?: string;
}

/** Provenance frozen at creation (addendum §1.6). */
export interface QueryResultSnapshotProvenance {
    readonly runId: string;
    readonly runRecordId?: string;
    readonly tuningDigest?: string;
    readonly tuningProfileId?: string;
    readonly storeKind: QueryResultStoreKind;
}

export interface QueryResultSnapshotLease {
    readonly leaseId: string;
    readonly snapshotId: string;
    readonly owner: QueryResultLeaseOwner;
    dispose(): void;
}

export interface CreateQueryResultSnapshotRequest {
    readonly owner: QueryResultLeaseOwner;
    readonly reason: string;
    /** Live source to snapshot; `sourceId` from listLiveSources or a URI key. */
    readonly sourceId?: string;
    readonly sourceUriKey?: string;
    readonly scope:
        | { kind: "resultSet"; resultSetId: string }
        | { kind: "resultSets"; resultSetIds: readonly string[] }
        | { kind: "allCompleteResultSets" };
    readonly includeMessages?: "none" | "summary" | "allLocal";
    readonly includeQueryText?: "none" | "digest" | "localOnly";
}

export interface QueryResultSnapshotSummary {
    readonly snapshotId: string;
    readonly createdEpochMs: number;
    readonly source: QueryResultSourceIdentity;
    readonly purpose: QueryResultSnapshotPurpose;
    readonly resultSetCount: number;
    readonly totalRows: number;
    readonly leaseCount: number;
    readonly complete: boolean;
}

export interface QueryResultSnapshotDescription extends QueryResultSnapshotSummary {
    readonly resultSets: readonly QueryResultSetFrozenSummary[];
    readonly messages: QueryResultMessageSummary;
    readonly queryTextDigest?: string;
    readonly provenance: QueryResultSnapshotProvenance;
    readonly store: QueryResultStoreStats;
    readonly hasLocalMessages: boolean;
    readonly hasLocalQueryText: boolean;
    /** Derived-snapshot lineage (C2D-T): parent + reproducing spec digest. */
    readonly derived?: { readonly parentSnapshotId: string; readonly specDigest: string };
}

// --- live sources ----------------------------------------------------------------

export interface LiveQueryResultState {
    readonly streaming: boolean;
    readonly runId?: string;
    readonly resultSets: readonly QueryResultSetFrozenSummary[];
}

/**
 * A live result-producing owner (a Query Studio document model). Models
 * register themselves; the service never scans provider registries (plan §9.1).
 */
export interface LiveQueryResultSource {
    readonly sourceId: string;
    readonly sourceKind: "queryStudio" | "headless";
    sourceTitle(): string;
    sourceUriDigest(): string;
    state(): LiveQueryResultState;
    currentStore(): IQueryResultStore | undefined;
    /** Current run's message rows for capture policy (never AI without a grant). */
    messagesSnapshot(): readonly QsMessageRow[];
    queryText(): string | undefined;
    runRecordId(): string | undefined;
    tuning(): { digest?: string; profileId?: string };
}

export interface LiveQueryResultSummary {
    readonly sourceId: string;
    readonly sourceKind: "queryStudio" | "headless";
    readonly sourceTitle: string;
    readonly streaming: boolean;
    readonly resultSetCount: number;
    readonly totalRows: number;
}

// --- service status ---------------------------------------------------------------

export interface QueryResultAccessStatus {
    readonly liveSources: number;
    readonly snapshots: number;
    readonly leasesByOwnerKind: Readonly<Record<string, number>>;
    /** Deduped by storeId (addendum §5.2): stores cost once, snapshots don't. */
    readonly retainedStores: number;
    readonly retainedMemoryBytes: number;
    readonly retainedSpillBytes: number;
    readonly lastSweep?: {
        readonly atEpochMs: number;
        readonly swept: number;
        readonly expired: number;
    };
}

// --- typed errors -----------------------------------------------------------------

export type QueryResultAccessErrorCode =
    | "sourceNotFound"
    | "storeUnavailable"
    | "snapshotNotFound"
    | "snapshotExpired"
    | "resultSetNotFound"
    | "resultSetIncomplete"
    | "runStreaming"
    | "retentionBudgetExceeded";

export class QueryResultAccessError extends Error {
    constructor(
        readonly code: QueryResultAccessErrorCode,
        message: string,
    ) {
        super(message);
        this.name = "QueryResultAccessError";
    }
}
