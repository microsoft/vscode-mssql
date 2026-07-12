/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * VectorWorkbenchService (VEC-4): analysis-session manager between the Query
 * Studio controller's RPC handlers and the worker. One session = one opened
 * (resultSetId, vector column) with a `vectorWorkbench` store lease held for
 * its lifetime — reruns can't dispose data out from under an analysis, and
 * closing the session releases the lease promptly.
 *
 * Authority: the webview supplies ONLY the selection (result set + column
 * ordinal). Handles are host-minted random tokens; generations stamp every
 * response so stale answers are discardable; budgets come from the resolved
 * QueryTuning snapshot and are echoed, never accepted, from the client.
 *
 * Concurrency: at most `vectorMaxWorkers` analyses run at once (global FIFO
 * slot queue); at most MAX_SESSIONS sessions per service (oldest idle session
 * closes to admit a new one). Idle sessions expire after IDLE_EXPIRY_MS.
 *
 * Observability: registry-vocabulary markers with counts/bytes/ms/enums only
 * — never components, keys, labels, or distances.
 */

import * as crypto from "crypto";
import * as path from "path";
import { Worker } from "worker_threads";
import { Perf } from "../../perf/perfTelemetry";
import {
    QsVectorCompareResult,
    QsVectorFindingDetailResult,
    QsVectorOpenParams,
    QsVectorOpenResult,
    QsVectorProfileResult,
    QsVectorProjectionResult,
    VECTOR_COMPARE_MAX_ROWS,
    VECTOR_COMPARE_MIN_ROWS,
    VECTOR_PROJECTION_RENDER_CAP,
    VectorFindingKind,
    VectorFindingSummary,
    VectorProfileSummary,
    VectorProjectionPoint,
    VectorProjectionSummary,
    VectorSampleDescriptor,
} from "../../sharedInterfaces/vectorWorkbench";
import { QueryTuningParams } from "../../sharedInterfaces/queryTuning";
import { decodeVectorFloat32 } from "../../sharedInterfaces/queryResultCellCodec";
import { IQueryResultStore, QueryResultStoreLease } from "../queryResultTypes";
import {
    VectorWorkerFinding,
    VectorWorkerOptions,
    VectorWorkerResult,
} from "./vectorAnalysisWorker";
import {
    computeVectorCompare,
    selectRenderIndices,
    VectorCompareInputVector,
} from "./vectorCompareMath";
import {
    ingestBudgetFrom,
    ingestVectorColumn,
    VectorIngestBudget,
    VectorIngestError,
    VectorIngestResult,
} from "./vectorResultSource";

const MAX_SESSIONS = 2;
const IDLE_EXPIRY_MS = 5 * 60_000;
const PAIR_TARGET = 10_000;

interface FindingDetailCache {
    readonly kind: VectorFindingKind;
    readonly subject: VectorWorkerFinding["subject"];
    readonly resultRowOrdinals?: readonly number[];
    readonly dimensionOrdinals?: readonly number[];
    readonly values?: readonly number[];
    readonly truncated: boolean;
}

interface VectorSession {
    readonly handle: string;
    generation: number;
    readonly store: IQueryResultStore;
    readonly lease: QueryResultStoreLease;
    readonly resultSetId: string;
    readonly columnOrdinal: number;
    readonly seed: number;
    readonly transport: "binary-v1" | "textFallback";
    readonly dimensions?: number;
    readonly totalRows: number;
    readonly workers: Set<Worker>;
    readonly activeAnalyses: Map<
        string,
        { readonly generation: number; readonly abortController: AbortController }
    >;
    profile?: VectorProfileSummary;
    /** Cached per-session PCA result (VEC-6) — one worker run per session. */
    projection?: VectorProjectionSummary;
    details: Map<VectorFindingKind, FindingDetailCache>;
    idleTimer?: ReturnType<typeof setTimeout>;
    activeStoreOperations: number;
    leaseReleased: boolean;
    disposed: boolean;
}

/**
 * Scoped, lease-backed view used by live-only Vector workspaces. Callers must
 * release it in a finally block; close/dispose then waits for their store read
 * to settle before releasing the retained result store.
 */
export interface VectorWorkbenchSessionFacts {
    readonly generation: number;
    readonly transport: "binary-v1" | "textFallback";
    readonly dimensions?: number;
    readonly totalRows: number;
    readonly store: IQueryResultStore;
    readonly resultSetId: string;
    readonly vectorColumnOrdinal: number;
    readonly isActive: () => boolean;
    readonly release: () => void;
}

interface VectorWorkerWaiter {
    readonly owner: symbol;
    readonly limit: number;
    readonly signal: AbortSignal;
    readonly resolve: (release: (() => void) | undefined) => void;
    readonly onAbort: () => void;
}

/**
 * FIFO process-wide worker coordinator. Each operation contributes the
 * vectorMaxWorkers value from its resolved run tuning. A lower-cap operation
 * runs alone once earlier work drains; later higher-cap work cannot bypass it.
 */
export class VectorWorkerCoordinator {
    private readonly active = new Map<number, { readonly owner: symbol; readonly limit: number }>();
    private readonly waiters: VectorWorkerWaiter[] = [];
    private nextLeaseId = 1;

    acquire(
        owner: symbol,
        effectiveLimit: number,
        signal: AbortSignal,
    ): Promise<(() => void) | undefined> {
        const limit = Number.isFinite(effectiveLimit)
            ? Math.min(4, Math.max(0, Math.floor(effectiveLimit)))
            : 0;
        if (limit === 0 || signal.aborted) {
            return Promise.resolve(undefined);
        }
        return new Promise((resolve) => {
            const waiter: VectorWorkerWaiter = {
                owner,
                limit,
                signal,
                resolve,
                onAbort: () => this.removeWaiter(waiter),
            };
            signal.addEventListener("abort", waiter.onAbort, { once: true });
            this.waiters.push(waiter);
            this.drain();
        });
    }

    disposeOwner(owner: symbol): void {
        const removed: VectorWorkerWaiter[] = [];
        for (let index = this.waiters.length - 1; index >= 0; index--) {
            const waiter = this.waiters[index];
            if (waiter.owner === owner) {
                this.waiters.splice(index, 1);
                waiter.signal.removeEventListener("abort", waiter.onAbort);
                removed.push(waiter);
            }
        }
        for (const waiter of removed) {
            waiter.resolve(undefined);
        }
        this.drain();
    }

    private removeWaiter(waiter: VectorWorkerWaiter): void {
        const index = this.waiters.indexOf(waiter);
        if (index < 0) {
            return;
        }
        this.waiters.splice(index, 1);
        waiter.signal.removeEventListener("abort", waiter.onAbort);
        waiter.resolve(undefined);
        this.drain();
    }

    private drain(): void {
        for (;;) {
            const waiter = this.waiters[0];
            if (!waiter) {
                return;
            }
            if (waiter.signal.aborted) {
                this.removeWaiter(waiter);
                continue;
            }
            let processLimit = waiter.limit;
            for (const lease of this.active.values()) {
                processLimit = Math.min(processLimit, lease.limit);
            }
            if (this.active.size >= processLimit) {
                return;
            }
            this.waiters.shift();
            waiter.signal.removeEventListener("abort", waiter.onAbort);
            const leaseId = this.nextLeaseId++;
            this.active.set(leaseId, { owner: waiter.owner, limit: waiter.limit });
            let released = false;
            waiter.resolve(() => {
                if (released) {
                    return;
                }
                released = true;
                this.active.delete(leaseId);
                this.drain();
            });
        }
    }
}

const GLOBAL_VECTOR_WORKER_COORDINATOR = new VectorWorkerCoordinator();

export class VectorWorkbenchService {
    private readonly sessions = new Map<string, VectorSession>();
    private readonly workerOwner = Symbol("vectorWorkbench");

    constructor(
        private readonly tuning: () => QueryTuningParams,
        /** Injectable for tests; production passes dist/vectorAnalysisWorker.js. */
        private readonly workerPath: string = path.join(__dirname, "vectorAnalysisWorker.js"),
        private readonly workerCoordinator: VectorWorkerCoordinator = GLOBAL_VECTOR_WORKER_COORDINATOR,
    ) {}

    private acquireWorkerSlot(
        effectiveLimit: number,
        signal: AbortSignal,
    ): Promise<(() => void) | undefined> {
        return this.workerCoordinator.acquire(this.workerOwner, effectiveLimit, signal);
    }

    open(store: IQueryResultStore | undefined, params: QsVectorOpenParams): QsVectorOpenResult {
        const budget = ingestBudgetFrom(this.tuning());
        const refused = (error: string): QsVectorOpenResult => ({
            handle: "",
            generation: 0,
            transport: "textFallback",
            totalRows: 0,
            effectiveBudget: budget,
            error,
        });
        if (!store) {
            return refused("No result store is available for this document.");
        }
        const summary = store.summary(params.resultSetId);
        if (!summary) {
            return refused("The result set is no longer available.");
        }
        if (!summary.complete) {
            return refused(
                "Vector analysis waits for the result set to reach a terminal state; this result is still streaming.",
            );
        }
        const column = summary.columns?.[params.columnOrdinal];
        if (!column || column.sqlType?.toLowerCase() !== "vector") {
            return refused("The selected column is not a native vector column.");
        }
        // Session cap: close the oldest session to admit the new one (the
        // webview drives one active analysis; parallel panes are bounded).
        if (this.sessions.size >= MAX_SESSIONS) {
            const oldest = this.sessions.values().next().value as VectorSession | undefined;
            if (oldest) {
                this.close(oldest.handle);
            }
        }
        const lease = store.retain({ kind: "vectorWorkbench", label: "Vector Workbench" });
        if (!lease) {
            return refused("The result store is closing; rerun the query to analyze.");
        }
        const session: VectorSession = {
            handle: `vec_${crypto.randomBytes(9).toString("base64url")}`,
            generation: 1,
            store,
            lease,
            resultSetId: params.resultSetId,
            columnOrdinal: params.columnOrdinal,
            seed: crypto.randomBytes(4).readUInt32LE(0),
            transport: column.vector?.transport ?? "textFallback",
            ...(column.vector?.dimensions !== undefined
                ? { dimensions: column.vector.dimensions }
                : {}),
            totalRows: summary.rowCount,
            workers: new Set(),
            activeAnalyses: new Map(),
            details: new Map(),
            activeStoreOperations: 0,
            leaseReleased: false,
            disposed: false,
        };
        this.sessions.set(session.handle, session);
        this.touch(session);
        Perf.marker("mssql.queryResults.vector.ingest", "instant", {
            phase: "open",
            totalRows: summary.rowCount,
            transport: session.transport,
            ...(column.vector?.dimensions !== undefined
                ? { dimensions: column.vector.dimensions }
                : {}),
        });
        return {
            handle: session.handle,
            generation: session.generation,
            ...(column.vector?.dimensions !== undefined
                ? { dimensions: column.vector.dimensions }
                : {}),
            transport: session.transport,
            totalRows: summary.rowCount,
            effectiveBudget: budget,
        };
    }

    async profile(handle: string): Promise<QsVectorProfileResult> {
        const session = this.sessions.get(handle);
        if (!session || session.disposed) {
            return { generation: 0, error: "The analysis session has expired; reopen the tab." };
        }
        this.touch(session);
        if (session.profile) {
            return { generation: session.generation, summary: session.profile };
        }
        if (session.transport !== "binary-v1") {
            return {
                generation: session.generation,
                error: "This query ran without the typed vector transport; rerun with the Vector Workbench enabled to analyze.",
            };
        }
        const generation = session.generation;
        const tuning = this.tuning();
        const budget = ingestBudgetFrom(tuning);
        const analysis = this.beginAnalysis(session, {
            totalBudgetMs: budget.maxTimeMs,
        });
        const { correlationId } = analysis;
        const startedAt = performance.now();
        if (tuning.vectorMaxWorkers <= 0) {
            this.endAnalysis(session, correlationId, "refused", {
                ms: Math.round(performance.now() - startedAt),
            });
            return {
                generation: session.generation,
                error: "Vector analysis workers are disabled by the current tuning profile.",
            };
        }
        let ingest: VectorIngestResult | VectorIngestError;
        try {
            ingest = await this.ingest(session, budget);
        } catch (error) {
            if (this.analysisIsCancelled(session, correlationId, generation)) {
                return { generation: session.generation, error: "The analysis was cancelled." };
            }
            this.endAnalysis(session, correlationId, "error", {
                ms: Math.round(performance.now() - startedAt),
            });
            return {
                generation: session.generation,
                error: error instanceof Error ? error.message : String(error),
            };
        }
        if (this.analysisIsCancelled(session, correlationId, generation)) {
            return { generation: session.generation, error: "The analysis was cancelled." };
        }
        if ("error" in ingest) {
            this.endAnalysis(session, correlationId, "refused", {
                ms: Math.round(performance.now() - startedAt),
            });
            return { generation: session.generation, error: ingest.error };
        }
        Perf.marker("mssql.queryResults.vector.ingest", "instant", {
            phase: "packed",
            rows: ingest.rows,
            dimensions: ingest.dimensions,
            packedBytes: ingest.descriptor.packedBytes,
            scannedBytes: ingest.descriptor.scannedBytes,
            rowsScanned: ingest.descriptor.rowsScanned,
            nulls: ingest.nullCount,
            unavailable: ingest.unavailableCount,
            ...(ingest.descriptor.partialReason
                ? { partialReason: ingest.descriptor.partialReason }
                : {}),
        });

        const release = await this.acquireWorkerSlot(
            tuning.vectorMaxWorkers,
            analysis.abortController.signal,
        );
        if (!release) {
            return { generation: session.generation, error: "The analysis was cancelled." };
        }
        try {
            if (this.analysisIsCancelled(session, correlationId, generation)) {
                return { generation: session.generation, error: "The analysis was cancelled." };
            }
            const remainingMs = Math.max(
                1000,
                budget.maxTimeMs - Math.round(performance.now() - startedAt),
            );
            const result = await this.runWorker(
                session,
                ingest,
                remainingMs,
                undefined,
                correlationId,
            );
            if (this.analysisIsCancelled(session, correlationId, generation)) {
                return { generation: session.generation, error: "The analysis was cancelled." };
            }
            const summary = this.toProfileSummary(session, ingest, result);
            session.profile = summary;
            this.endAnalysis(session, correlationId, "ok", {
                rows: result.rows,
                dimensions: result.dimensions,
                findings: result.findings.length,
                partialTime: result.partialTime,
                workerMs: Math.round(result.elapsedMs),
                ms: Math.round(performance.now() - startedAt),
            });
            return { generation: session.generation, summary };
        } catch (error) {
            if (this.analysisIsCancelled(session, correlationId, generation)) {
                return { generation: session.generation, error: "The analysis was cancelled." };
            }
            this.endAnalysis(session, correlationId, "error", {
                ms: Math.round(performance.now() - startedAt),
            });
            return {
                generation: session.generation,
                error: error instanceof Error ? error.message : String(error),
            };
        } finally {
            release();
        }
    }

    /**
     * Deterministic PCA 2D projection (VEC-6). Cached per session; the worker
     * run computes profile + PCA together when the profile is not yet cached
     * (single ingest, single worker invocation, same gate discipline).
     * Exported RPC entry point — the controller binds
     * QsVectorProjectionRequest to this method.
     */
    async projection(handle: string): Promise<QsVectorProjectionResult> {
        const session = this.sessions.get(handle);
        if (!session || session.disposed) {
            return { generation: 0, error: "The analysis session has expired; reopen the tab." };
        }
        this.touch(session);
        if (session.projection) {
            return { generation: session.generation, projection: session.projection };
        }
        if (session.transport !== "binary-v1") {
            return {
                generation: session.generation,
                error: "This query ran without the typed vector transport; rerun with the Vector Workbench enabled to analyze.",
            };
        }
        const generation = session.generation;
        const tuning = this.tuning();
        const budget = ingestBudgetFrom(tuning);
        const analysis = this.beginAnalysis(session, {
            totalBudgetMs: budget.maxTimeMs,
        });
        const { correlationId } = analysis;
        const startedAt = performance.now();
        if (tuning.vectorMaxWorkers <= 0) {
            this.endAnalysis(session, correlationId, "refused", {
                ms: Math.round(performance.now() - startedAt),
            });
            return {
                generation: session.generation,
                error: "Vector analysis workers are disabled by the current tuning profile.",
            };
        }
        let ingest: VectorIngestResult | VectorIngestError;
        try {
            ingest = await this.ingest(session, budget);
        } catch (error) {
            if (this.analysisIsCancelled(session, correlationId, generation)) {
                return { generation: session.generation, error: "The projection was cancelled." };
            }
            this.endAnalysis(session, correlationId, "error", {
                ms: Math.round(performance.now() - startedAt),
            });
            return {
                generation: session.generation,
                error: error instanceof Error ? error.message : String(error),
            };
        }
        if (this.analysisIsCancelled(session, correlationId, generation)) {
            return { generation: session.generation, error: "The analysis was cancelled." };
        }
        if ("error" in ingest) {
            this.endAnalysis(session, correlationId, "refused", {
                ms: Math.round(performance.now() - startedAt),
            });
            return { generation: session.generation, error: ingest.error };
        }
        const release = await this.acquireWorkerSlot(
            tuning.vectorMaxWorkers,
            analysis.abortController.signal,
        );
        if (!release) {
            return { generation: session.generation, error: "The projection was cancelled." };
        }
        try {
            if (this.analysisIsCancelled(session, correlationId, generation)) {
                return { generation: session.generation, error: "The analysis was cancelled." };
            }
            const remainingMs = Math.max(
                1000,
                budget.maxTimeMs - Math.round(performance.now() - startedAt),
            );
            const wantProfile = session.profile === undefined;
            const result = await this.runWorker(
                session,
                ingest,
                remainingMs,
                {
                    profile: wantProfile,
                    projection: true,
                },
                correlationId,
            );
            if (this.analysisIsCancelled(session, correlationId, generation)) {
                return { generation: session.generation, error: "The analysis was cancelled." };
            }
            if (wantProfile) {
                session.profile = this.toProfileSummary(session, ingest, result);
            }
            const projection = result.projection;
            if (!projection) {
                this.endAnalysis(session, correlationId, "error", {
                    partialTime: result.partialTime,
                    ms: Math.round(performance.now() - startedAt),
                });
                return {
                    generation: session.generation,
                    error: result.partialTime
                        ? "The projection did not complete within the analysis time budget; no partial projection is shown."
                        : "No analyzable vectors for the projection (all rows non-finite or unavailable).",
                };
            }
            // Render cap (P0-8): every analyzed row went through the PCA;
            // only the point payload is evenly thinned — never "sampled".
            const renderIndices = selectRenderIndices(
                projection.analyzedRows,
                VECTOR_PROJECTION_RENDER_CAP,
            );
            const points: VectorProjectionPoint[] = renderIndices.map((i) => ({
                ordinal: ingest.sourceOrdinals[projection.rowIndices[i]],
                x: projection.coords[i * 2],
                y: projection.coords[i * 2 + 1],
            }));
            const descriptor: VectorSampleDescriptor = result.partialTime
                ? { ...ingest.descriptor, partialReason: "timeBudget" }
                : ingest.descriptor;
            const summary: VectorProjectionSummary = {
                points,
                analyzedCount: projection.analyzedRows,
                renderedCount: points.length,
                renderCap: VECTOR_PROJECTION_RENDER_CAP,
                pc1VariancePct: projection.pc1VariancePct,
                pc2VariancePct: projection.pc2VariancePct,
                nextVariancePct: projection.nextVariancePct,
                dimensions: result.dimensions,
                evidence: this.evidence(descriptor),
                sample: descriptor,
            };
            session.projection = summary;
            this.endAnalysis(session, correlationId, "ok", {
                rows: result.rows,
                dimensions: result.dimensions,
                partialTime: result.partialTime,
                workerMs: Math.round(result.elapsedMs),
                ms: Math.round(performance.now() - startedAt),
            });
            return { generation: session.generation, projection: summary };
        } catch (error) {
            if (this.analysisIsCancelled(session, correlationId, generation)) {
                return { generation: session.generation, error: "The projection was cancelled." };
            }
            this.endAnalysis(session, correlationId, "error", {
                ms: Math.round(performance.now() - startedAt),
            });
            return {
                generation: session.generation,
                error: error instanceof Error ? error.message : String(error),
            };
        } finally {
            release();
        }
    }

    /**
     * Compare 2..8 selected result rows (VEC-6). Vectors are pulled host-side
     * through the session lease (sparse projection, reason "vectorAnalysis"),
     * decoded via the shared cell codec, and reduced in-process — only
     * derived numbers travel to the webview, and none of them enter logs.
     * Exported RPC entry point — the controller binds QsVectorCompareRequest
     * to this method.
     */
    async compare(handle: string, ordinals: readonly number[]): Promise<QsVectorCompareResult> {
        const session = this.sessions.get(handle);
        if (!session || session.disposed) {
            return { generation: 0, error: "The analysis session has expired; reopen the tab." };
        }
        this.touch(session);
        if (session.transport !== "binary-v1") {
            return {
                generation: session.generation,
                error: "This query ran without the typed vector transport; rerun with the Vector Workbench enabled to analyze.",
            };
        }
        const summary = session.store.summary(session.resultSetId);
        if (!summary) {
            return {
                generation: session.generation,
                error: "The result set is no longer available.",
            };
        }
        // Ordinal validation: the webview's authority ends at the selection.
        if (
            !Array.isArray(ordinals) ||
            ordinals.length < VECTOR_COMPARE_MIN_ROWS ||
            ordinals.length > VECTOR_COMPARE_MAX_ROWS
        ) {
            return {
                generation: session.generation,
                error: `Select between ${VECTOR_COMPARE_MIN_ROWS} and ${VECTOR_COMPARE_MAX_ROWS} result rows to compare.`,
            };
        }
        const seen = new Set<number>();
        for (const ordinal of ordinals) {
            if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= summary.rowCount) {
                return {
                    generation: session.generation,
                    error: `Result-row ordinal ${ordinal} is out of range (0–${summary.rowCount - 1}).`,
                };
            }
            if (seen.has(ordinal)) {
                return {
                    generation: session.generation,
                    error: `Result-row ordinal ${ordinal} appears more than once.`,
                };
            }
            seen.add(ordinal);
        }
        const generation = session.generation;
        const startedAt = performance.now();
        const { correlationId } = this.beginAnalysis(session, {});
        this.beginStoreOperation(session);
        try {
            const vectors: VectorCompareInputVector[] = [];
            let dimensions = 0;
            for (const ordinal of ordinals) {
                const window = await session.store.getWindow({
                    resultSetId: session.resultSetId,
                    rowStart: ordinal,
                    rowCount: 1,
                    columnOrdinals: [session.columnOrdinal],
                    reason: "vectorAnalysis",
                });
                if (this.analysisIsCancelled(session, correlationId, generation)) {
                    return {
                        generation: session.generation,
                        error: "The comparison was cancelled.",
                    };
                }
                const cell: unknown = window.values[0]?.[0];
                const decoded =
                    cell === undefined || cell === null ? null : decodeVectorFloat32(cell);
                if (decoded === null) {
                    this.endAnalysis(session, correlationId, "refused", {
                        ms: Math.round(performance.now() - startedAt),
                    });
                    return {
                        generation: session.generation,
                        error: `Row ${ordinal} has no analyzable vector value in the selected column.`,
                    };
                }
                if (dimensions === 0) {
                    dimensions = decoded.dimensions;
                } else if (decoded.dimensions !== dimensions) {
                    this.endAnalysis(session, correlationId, "refused", {
                        ms: Math.round(performance.now() - startedAt),
                    });
                    return {
                        generation: session.generation,
                        error: `Row ${ordinal} has ${decoded.dimensions} dimensions; the selection expects ${dimensions}. Incompatible dimensions cannot be compared jointly.`,
                    };
                }
                vectors.push({ ordinal, values: decoded.values });
            }
            const computed = computeVectorCompare(vectors);
            this.endAnalysis(session, correlationId, "ok", {
                rows: vectors.length,
                dimensions,
                ms: Math.round(performance.now() - startedAt),
            });
            return {
                generation: session.generation,
                compare: {
                    ...computed,
                    evidence: { source: "localComputation", capturedEpochMs: Date.now() },
                },
            };
        } catch (error) {
            if (this.analysisIsCancelled(session, correlationId, generation)) {
                return { generation: session.generation, error: "The comparison was cancelled." };
            }
            this.endAnalysis(session, correlationId, "error", {
                ms: Math.round(performance.now() - startedAt),
            });
            return {
                generation: session.generation,
                error: error instanceof Error ? error.message : String(error),
            };
        } finally {
            this.endStoreOperation(session);
        }
    }

    /** VEC-10 seam: facts about an open analysis session, by handle. */
    sessionFacts(handle: string): VectorWorkbenchSessionFacts | undefined {
        const session = this.sessions.get(handle);
        if (!session || session.disposed) {
            return undefined;
        }
        this.touch(session);
        this.beginStoreOperation(session);
        const generation = session.generation;
        let released = false;
        return {
            generation,
            transport: session.transport,
            ...(session.dimensions !== undefined ? { dimensions: session.dimensions } : {}),
            totalRows: session.totalRows,
            store: session.store,
            resultSetId: session.resultSetId,
            vectorColumnOrdinal: session.columnOrdinal,
            isActive: () => !session.disposed && session.generation === generation,
            release: () => {
                if (released) {
                    return;
                }
                released = true;
                this.endStoreOperation(session);
            },
        };
    }

    findingDetail(handle: string, kind: VectorFindingKind): QsVectorFindingDetailResult {
        const session = this.sessions.get(handle);
        if (!session || session.disposed) {
            return { generation: 0, error: "The analysis session has expired." };
        }
        this.touch(session);
        const cached = session.details.get(kind);
        if (!cached) {
            return { generation: session.generation, error: "No detail for this finding." };
        }
        return {
            generation: session.generation,
            detail: {
                kind: cached.kind,
                subject: cached.subject,
                ...(cached.resultRowOrdinals
                    ? { resultRowOrdinals: cached.resultRowOrdinals }
                    : {}),
                ...(cached.dimensionOrdinals
                    ? { dimensionOrdinals: cached.dimensionOrdinals }
                    : {}),
                ...(cached.values ? { values: cached.values } : {}),
                truncated: cached.truncated,
                evidence: { source: "localComputation" },
            },
        };
    }

    cancel(handle: string): void {
        const session = this.sessions.get(handle);
        if (!session || session.disposed) {
            return;
        }
        session.generation++;
        for (const [correlationId, analysis] of [...session.activeAnalyses]) {
            analysis.abortController.abort();
            Perf.marker("mssql.queryResults.vector.analysis.cancel", "instant", {}, correlationId);
            this.endAnalysis(session, correlationId, "cancelled", {});
        }
        if (session.workers.size > 0) {
            for (const worker of session.workers) {
                void worker.terminate();
            }
            session.workers.clear();
        }
    }

    close(handle: string): void {
        const session = this.sessions.get(handle);
        if (!session) {
            return;
        }
        this.cancel(handle);
        session.disposed = true;
        if (session.idleTimer) {
            clearTimeout(session.idleTimer);
        }
        this.sessions.delete(handle);
        this.releaseLeaseWhenIdle(session);
    }

    /** Cancel only in-flight work; completed session caches remain reusable. */
    suspend(): boolean {
        let invalidated = false;
        for (const session of this.sessions.values()) {
            if (
                session.activeAnalyses.size > 0 ||
                session.workers.size > 0 ||
                session.activeStoreOperations > 0
            ) {
                invalidated = true;
                this.cancel(session.handle);
            }
        }
        return invalidated;
    }

    dispose(): void {
        for (const handle of [...this.sessions.keys()]) {
            this.close(handle);
        }
        this.workerCoordinator.disposeOwner(this.workerOwner);
    }

    private touch(session: VectorSession): void {
        if (session.idleTimer) {
            clearTimeout(session.idleTimer);
        }
        session.idleTimer = setTimeout(() => this.close(session.handle), IDLE_EXPIRY_MS);
        session.idleTimer.unref?.();
    }

    private beginAnalysis(
        session: VectorSession,
        attrs: Record<string, string | number | boolean | null>,
    ): {
        readonly correlationId: string;
        readonly abortController: AbortController;
    } {
        const correlationId = crypto.randomUUID();
        const abortController = new AbortController();
        session.activeAnalyses.set(correlationId, {
            generation: session.generation,
            abortController,
        });
        Perf.marker("mssql.queryResults.vector.analysis.begin", "begin", attrs, correlationId);
        return { correlationId, abortController };
    }

    private endAnalysis(
        session: VectorSession,
        correlationId: string,
        outcome: "ok" | "error" | "refused" | "cancelled",
        attrs: Record<string, string | number | boolean | null>,
    ): void {
        if (!session.activeAnalyses.delete(correlationId)) {
            return;
        }
        Perf.marker(
            "mssql.queryResults.vector.analysis.end",
            "end",
            { outcome, ...attrs },
            correlationId,
        );
    }

    private analysisIsCancelled(
        session: VectorSession,
        correlationId: string,
        generation: number,
    ): boolean {
        return (
            session.disposed ||
            session.generation !== generation ||
            !session.activeAnalyses.has(correlationId)
        );
    }

    /**
     * Keep the result-store lease alive until a scan that started before
     * close/dispose has settled. Store streams are not cooperatively
     * cancellable yet, so releasing the lease in close() would let a rerun
     * dispose the store underneath an awaited getWindow().
     */
    private async ingest(
        session: VectorSession,
        budget: VectorIngestBudget,
    ): Promise<VectorIngestResult | VectorIngestError> {
        this.beginStoreOperation(session);
        try {
            return await ingestVectorColumn({
                store: session.store,
                resultSetId: session.resultSetId,
                columnOrdinal: session.columnOrdinal,
                budget,
                seed: session.seed,
            });
        } finally {
            this.endStoreOperation(session);
        }
    }

    private beginStoreOperation(session: VectorSession): void {
        session.activeStoreOperations++;
    }

    private endStoreOperation(session: VectorSession): void {
        session.activeStoreOperations--;
        this.releaseLeaseWhenIdle(session);
    }

    private releaseLeaseWhenIdle(session: VectorSession): void {
        if (!session.disposed || session.activeStoreOperations !== 0 || session.leaseReleased) {
            return;
        }
        session.leaseReleased = true;
        session.lease.dispose();
    }

    private runWorker(
        session: VectorSession,
        ingest: VectorIngestResult,
        timeBudgetMs: number,
        opts?: VectorWorkerOptions,
        correlationId?: string,
    ): Promise<VectorWorkerResult> {
        return new Promise<VectorWorkerResult>((resolve, reject) => {
            const operation = opts?.projection === true ? "projection" : "profile";
            const generation = session.generation;
            const startedAt = performance.now();
            const buffer = ingest.packed.buffer as ArrayBuffer;
            const worker = new Worker(this.workerPath, {
                workerData: {
                    rows: ingest.rows,
                    dimensions: ingest.dimensions,
                    seed: session.seed,
                    timeBudgetMs,
                    pairTarget: PAIR_TARGET,
                    ...(opts ? { opts } : {}),
                    packedBuffer: buffer,
                },
                transferList: [buffer],
            });
            session.workers.add(worker);
            let settled = false;
            const settle = (
                outcome: "ok" | "error" | "cancelled",
                fn: () => void,
                result?: VectorWorkerResult,
            ) => {
                if (!settled) {
                    settled = true;
                    session.workers.delete(worker);
                    void worker.terminate();
                    Perf.marker(
                        "mssql.queryResults.vector.worker.end",
                        "instant",
                        {
                            operation,
                            outcome,
                            rows: ingest.rows,
                            dimensions: ingest.dimensions,
                            ...(result ? { partialTime: result.partialTime } : {}),
                            ms: Math.round(result?.elapsedMs ?? performance.now() - startedAt),
                        },
                        correlationId,
                    );
                    fn();
                }
            };
            const failureOutcome = (): "error" | "cancelled" =>
                session.disposed || session.generation !== generation ? "cancelled" : "error";
            worker.once(
                "message",
                (message: { ok: boolean; result?: VectorWorkerResult; error?: string }) => {
                    const result = message.result;
                    if (message.ok && result) {
                        settle("ok", () => resolve(result), result);
                    } else {
                        settle(failureOutcome(), () =>
                            reject(new Error(message.error ?? "Vector analysis failed.")),
                        );
                    }
                },
            );
            worker.once("error", (error) => settle(failureOutcome(), () => reject(error)));
            worker.once("exit", (code) =>
                settle(failureOutcome(), () =>
                    reject(new Error(`Vector analysis worker exited early (code ${code}).`)),
                ),
            );
        });
    }

    private toProfileSummary(
        session: VectorSession,
        ingest: VectorIngestResult,
        result: VectorWorkerResult,
    ): VectorProfileSummary {
        // Map packed-row indices → result-row ordinals; cache drill-ins.
        session.details.clear();
        const findings: VectorFindingSummary[] = result.findings.map((finding) => {
            const resultRowOrdinals = finding.rowIndices?.map(
                (index) => ingest.sourceOrdinals[index],
            );
            session.details.set(finding.kind, {
                kind: finding.kind,
                subject: finding.subject,
                ...(resultRowOrdinals ? { resultRowOrdinals } : {}),
                ...(finding.dimensionOrdinals
                    ? { dimensionOrdinals: finding.dimensionOrdinals }
                    : {}),
                ...(finding.values ? { values: finding.values } : {}),
                truncated: finding.truncated,
            });
            return {
                kind: finding.kind,
                subject: finding.subject,
                severity: finding.severity,
                affectedCount: finding.affectedCount,
                evidence: this.evidence(ingest.descriptor),
                hasDetail:
                    (resultRowOrdinals?.length ?? 0) > 0 ||
                    (finding.dimensionOrdinals?.length ?? 0) > 0,
            };
        });
        const descriptor: VectorSampleDescriptor = result.partialTime
            ? { ...ingest.descriptor, partialReason: "timeBudget" }
            : ingest.descriptor;
        return {
            evidence: this.evidence(descriptor),
            sample: descriptor,
            dimensions: result.dimensions,
            baseType: "float32",
            nullCount: ingest.nullCount,
            unavailableCount: ingest.unavailableCount,
            norms: result.norms,
            varianceTop: result.varianceTop,
            varianceBottom: result.varianceBottom,
            findings,
            ...(result.pairDistances ? { pairDistances: result.pairDistances } : {}),
        };
    }

    private evidence(descriptor: VectorSampleDescriptor) {
        return {
            source: "localComputation" as const,
            sampleDescriptor: descriptor,
            capturedEpochMs: Date.now(),
        };
    }
}
