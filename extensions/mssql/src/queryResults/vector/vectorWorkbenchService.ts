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
import { ingestBudgetFrom, ingestVectorColumn, VectorIngestResult } from "./vectorResultSource";

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
    worker?: Worker;
    profile?: VectorProfileSummary;
    /** Cached per-session PCA result (VEC-6) — one worker run per session. */
    projection?: VectorProjectionSummary;
    details: Map<VectorFindingKind, FindingDetailCache>;
    idleTimer?: ReturnType<typeof setTimeout>;
    disposed: boolean;
}

/** FIFO worker-slot gate (global across service instances). */
class SlotGate {
    private available: number;
    private readonly waiters: Array<() => void> = [];
    constructor(slots: number) {
        this.available = Math.max(1, slots);
    }
    async acquire(): Promise<() => void> {
        if (this.available > 0) {
            this.available--;
        } else {
            await new Promise<void>((resolve) => this.waiters.push(resolve));
        }
        let released = false;
        return () => {
            if (released) {
                return;
            }
            released = true;
            const next = this.waiters.shift();
            if (next) {
                next();
            } else {
                this.available++;
            }
        };
    }
}

export class VectorWorkbenchService {
    private readonly sessions = new Map<string, VectorSession>();
    private readonly gate: SlotGate;

    constructor(
        private readonly tuning: () => QueryTuningParams,
        /** Injectable for tests; production passes dist/vectorAnalysisWorker.js. */
        private readonly workerPath: string = path.join(__dirname, "vectorAnalysisWorker.js"),
    ) {
        this.gate = new SlotGate(this.tuning().vectorMaxWorkers);
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
            details: new Map(),
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
        Perf.marker("mssql.queryResults.vector.analysis.begin", "begin", {
            totalBudgetMs: budget.maxTimeMs,
        });
        const startedAt = performance.now();
        const ingest = await ingestVectorColumn({
            store: session.store,
            resultSetId: session.resultSetId,
            columnOrdinal: session.columnOrdinal,
            budget,
            seed: session.seed,
        });
        if (session.disposed || session.generation !== generation) {
            return { generation: session.generation, error: "The analysis was cancelled." };
        }
        if ("error" in ingest) {
            Perf.marker("mssql.queryResults.vector.analysis.end", "end", {
                outcome: "refused",
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

        const release = await this.gate.acquire();
        try {
            if (session.disposed || session.generation !== generation) {
                return { generation: session.generation, error: "The analysis was cancelled." };
            }
            const remainingMs = Math.max(
                1000,
                budget.maxTimeMs - Math.round(performance.now() - startedAt),
            );
            const result = await this.runWorker(session, ingest, remainingMs);
            if (session.disposed || session.generation !== generation) {
                return { generation: session.generation, error: "The analysis was cancelled." };
            }
            const summary = this.toProfileSummary(session, ingest, result);
            session.profile = summary;
            Perf.marker("mssql.queryResults.vector.analysis.end", "end", {
                outcome: "ok",
                rows: result.rows,
                dimensions: result.dimensions,
                findings: result.findings.length,
                partialTime: result.partialTime,
                workerMs: Math.round(result.elapsedMs),
                ms: Math.round(performance.now() - startedAt),
            });
            return { generation: session.generation, summary };
        } catch (error) {
            Perf.marker("mssql.queryResults.vector.analysis.end", "end", {
                outcome: "error",
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
        const budget = ingestBudgetFrom(this.tuning());
        Perf.marker("mssql.queryResults.vector.analysis.begin", "begin", {
            totalBudgetMs: budget.maxTimeMs,
        });
        const startedAt = performance.now();
        const ingest = await ingestVectorColumn({
            store: session.store,
            resultSetId: session.resultSetId,
            columnOrdinal: session.columnOrdinal,
            budget,
            seed: session.seed,
        });
        if (session.disposed || session.generation !== generation) {
            return { generation: session.generation, error: "The analysis was cancelled." };
        }
        if ("error" in ingest) {
            Perf.marker("mssql.queryResults.vector.analysis.end", "end", {
                outcome: "refused",
                ms: Math.round(performance.now() - startedAt),
            });
            return { generation: session.generation, error: ingest.error };
        }
        const release = await this.gate.acquire();
        try {
            if (session.disposed || session.generation !== generation) {
                return { generation: session.generation, error: "The analysis was cancelled." };
            }
            const remainingMs = Math.max(
                1000,
                budget.maxTimeMs - Math.round(performance.now() - startedAt),
            );
            const wantProfile = session.profile === undefined;
            const result = await this.runWorker(session, ingest, remainingMs, {
                profile: wantProfile,
                projection: true,
            });
            if (session.disposed || session.generation !== generation) {
                return { generation: session.generation, error: "The analysis was cancelled." };
            }
            if (wantProfile) {
                session.profile = this.toProfileSummary(session, ingest, result);
            }
            const projection = result.projection;
            if (!projection) {
                Perf.marker("mssql.queryResults.vector.analysis.end", "end", {
                    outcome: "error",
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
            Perf.marker("mssql.queryResults.vector.analysis.end", "end", {
                outcome: "ok",
                rows: result.rows,
                dimensions: result.dimensions,
                partialTime: result.partialTime,
                workerMs: Math.round(result.elapsedMs),
                ms: Math.round(performance.now() - startedAt),
            });
            return { generation: session.generation, projection: summary };
        } catch (error) {
            Perf.marker("mssql.queryResults.vector.analysis.end", "end", {
                outcome: "error",
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
        Perf.marker("mssql.queryResults.vector.analysis.begin", "begin", {});
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
                if (session.disposed || session.generation !== generation) {
                    return {
                        generation: session.generation,
                        error: "The comparison was cancelled.",
                    };
                }
                const cell: unknown = window.values[0]?.[0];
                const decoded =
                    cell === undefined || cell === null ? null : decodeVectorFloat32(cell);
                if (decoded === null) {
                    Perf.marker("mssql.queryResults.vector.analysis.end", "end", {
                        outcome: "refused",
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
                    Perf.marker("mssql.queryResults.vector.analysis.end", "end", {
                        outcome: "refused",
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
            Perf.marker("mssql.queryResults.vector.analysis.end", "end", {
                outcome: "ok",
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
            Perf.marker("mssql.queryResults.vector.analysis.end", "end", {
                outcome: "error",
                ms: Math.round(performance.now() - startedAt),
            });
            return {
                generation: session.generation,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /** VEC-10 seam: facts about an open analysis session, by handle. */
    sessionFacts(
        handle: string,
    ): { store: IQueryResultStore; resultSetId: string; vectorColumnOrdinal: number } | undefined {
        const session = this.sessions.get(handle);
        if (!session || session.disposed) {
            return undefined;
        }
        this.touch(session);
        return {
            store: session.store,
            resultSetId: session.resultSetId,
            vectorColumnOrdinal: session.columnOrdinal,
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
        if (session.worker) {
            void session.worker.terminate();
            session.worker = undefined;
            Perf.marker("mssql.queryResults.vector.analysis.cancel", "instant", {});
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
        session.lease.dispose();
        this.sessions.delete(handle);
    }

    dispose(): void {
        for (const handle of [...this.sessions.keys()]) {
            this.close(handle);
        }
    }

    private touch(session: VectorSession): void {
        if (session.idleTimer) {
            clearTimeout(session.idleTimer);
        }
        session.idleTimer = setTimeout(() => this.close(session.handle), IDLE_EXPIRY_MS);
        session.idleTimer.unref?.();
    }

    private runWorker(
        session: VectorSession,
        ingest: VectorIngestResult,
        timeBudgetMs: number,
        opts?: VectorWorkerOptions,
    ): Promise<VectorWorkerResult> {
        return new Promise<VectorWorkerResult>((resolve, reject) => {
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
            session.worker = worker;
            let settled = false;
            const settle = (fn: () => void) => {
                if (!settled) {
                    settled = true;
                    session.worker = undefined;
                    void worker.terminate();
                    fn();
                }
            };
            worker.once(
                "message",
                (message: { ok: boolean; result?: VectorWorkerResult; error?: string }) => {
                    settle(() =>
                        message.ok && message.result
                            ? resolve(message.result)
                            : reject(new Error(message.error ?? "Vector analysis failed.")),
                    );
                },
            );
            worker.once("error", (error) => settle(() => reject(error)));
            worker.once("exit", (code) =>
                settle(() =>
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
