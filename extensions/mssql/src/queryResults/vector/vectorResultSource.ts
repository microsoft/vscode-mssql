/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * VectorResultSource (VEC-4): bounded, deterministic ingest of one vector
 * column from a retained result store into a packed row-major Float32Array —
 * the single input format the analysis worker accepts (transferred, never
 * cloned).
 *
 * Locked path discipline (impl plan §12): reads go through the store lease's
 * `streamRows` with reason "vectorAnalysis" (never re-admits cache pages) and
 * sparse `columnOrdinals` projection (one spill materialization per page, no
 * neighbor columns). No second raw cache: the packed buffer is the ONLY copy
 * and it is handed to the worker.
 *
 * Budgets are host-authoritative (QueryTuning registry) and enforced here:
 * component budget (dims × rows) picks full-vs-sampled up front; the scan-row,
 * packed-byte, scan-byte (DA A6), and time budgets stop ingestion honestly
 * with a `VectorPartialReason` — never a silent cap. Sampling is
 * deterministic: evenly spaced uniform windows over the set (method + seed
 * disclosed on the descriptor).
 */

import {
    decodeVectorFloat32,
    isVectorCellEncodingV1,
} from "../../sharedInterfaces/queryResultCellCodec";
import { QueryTuningParams } from "../../sharedInterfaces/queryTuning";
import {
    VectorPartialReason,
    VectorSampleDescriptor,
} from "../../sharedInterfaces/vectorWorkbench";
import { IQueryResultStore } from "../queryResultTypes";
import { VectorWorkbenchMessages as VectorWorkbenchLoc } from "../../constants/locConstants";

export interface VectorIngestBudget {
    readonly maxRowsScanned: number;
    readonly maxSampleRows: number;
    readonly maxComponents: number;
    readonly maxPackedBytes: number;
    readonly maxScanBytes: number;
    readonly maxTimeMs: number;
}

export function ingestBudgetFrom(params: QueryTuningParams): VectorIngestBudget {
    return {
        maxRowsScanned: params.vectorScanRowLimit,
        maxSampleRows: params.vectorSampleRows,
        maxComponents: params.vectorComponentBudget,
        maxPackedBytes: params.vectorPackedInputBytes,
        maxScanBytes: params.vectorScanByteBudget,
        maxTimeMs: params.vectorAnalysisTimeMsBudget,
    };
}

export interface VectorIngestResult {
    /** Row-major packed components; rows × dimensions. TRANSFER to the worker. */
    readonly packed: Float32Array;
    readonly rows: number;
    readonly dimensions: number;
    /** Result-row ordinal per packed row (drill-ins map through this). */
    readonly sourceOrdinals: Int32Array;
    readonly nullCount: number;
    readonly unavailableCount: number;
    readonly descriptor: VectorSampleDescriptor;
}

export interface VectorIngestError {
    readonly error: string;
}

interface WindowPlan {
    readonly start: number;
    readonly rows: number;
}

/**
 * Deterministic sampling plan: full when everything fits the budgets, else
 * evenly spaced uniform windows (stable for a given set size + budgets; the
 * seed rides the descriptor for downstream deterministic computations).
 */
export function planWindows(
    totalRows: number,
    dimensions: number,
    budget: VectorIngestBudget,
): { windows: WindowPlan[]; method: "full" | "uniformWindows"; targetRows: number } {
    const byComponents =
        dimensions > 0 ? Math.floor(budget.maxComponents / dimensions) : budget.maxSampleRows;
    const byPackedBytes =
        dimensions > 0
            ? Math.floor(budget.maxPackedBytes / (dimensions * 4))
            : budget.maxSampleRows;
    const fullFits =
        totalRows <= budget.maxRowsScanned &&
        totalRows <= byComponents &&
        totalRows <= byPackedBytes;
    if (fullFits) {
        return {
            windows: [{ start: 0, rows: totalRows }],
            method: "full",
            targetRows: totalRows,
        };
    }
    const targetRows = Math.max(
        1,
        Math.min(budget.maxSampleRows, byComponents, byPackedBytes, budget.maxRowsScanned),
    );
    const WINDOW_ROWS = 64;
    const windowCount = Math.max(1, Math.ceil(targetRows / WINDOW_ROWS));
    const windows: WindowPlan[] = [];
    let planned = 0;
    for (let w = 0; w < windowCount && planned < targetRows; w++) {
        // Evenly spaced window starts across the whole set (deterministic).
        const start = Math.floor((w * totalRows) / windowCount);
        const rows = Math.min(WINDOW_ROWS, targetRows - planned, totalRows - start);
        if (rows <= 0) {
            continue;
        }
        const previous = windows[windows.length - 1];
        if (previous && start < previous.start + previous.rows) {
            continue; // windows collapsed onto each other for tiny sets
        }
        windows.push({ start, rows });
        planned += rows;
    }
    return { windows, method: "uniformWindows", targetRows: planned };
}

/**
 * Ingest one vector column. Returns an honest error when the set/column
 * cannot be analyzed at all; partial ingests return data + partialReason.
 */
export async function ingestVectorColumn(args: {
    store: IQueryResultStore;
    resultSetId: string;
    columnOrdinal: number;
    budget: VectorIngestBudget;
    seed: number;
}): Promise<VectorIngestResult | VectorIngestError> {
    const { store, resultSetId, columnOrdinal, budget, seed } = args;
    const startedAt = performance.now();
    const summary = store.summary(resultSetId);
    if (!summary) {
        return { error: VectorWorkbenchLoc.resultSetIsNoLongerAvailable };
    }
    if (summary.corrupt) {
        return { error: VectorWorkbenchLoc.retainedResultsCouldNotBeRead };
    }
    const totalRows = summary.rowCount;
    if (totalRows === 0) {
        return { error: VectorWorkbenchLoc.theResultSetHasNoRowsToAnalyze };
    }

    // Dimensions from column metadata when present; else discovered from the
    // first typed cell (per-cell facts are authoritative — a metadata mismatch
    // later counts the cell unavailable rather than trusting the hint).
    const column = summary.columns?.[columnOrdinal];
    let dimensions = column?.vector?.dimensions ?? 0;

    let packed: Float32Array | undefined;
    let sourceOrdinals: Int32Array | undefined;
    let capacity = 0;
    let rows = 0;
    let rowsScanned = 0;
    let scannedBytes = 0;
    let nullCount = 0;
    let unavailableCount = 0;
    let partialReason: VectorPartialReason | undefined;

    // Find dimensions before choosing sampling windows. Discovery consumes
    // the same scan/time/byte budgets, but does not contribute sample counts.
    if (dimensions === 0) {
        discover: for await (const chunk of store.streamRows({
            resultSetId,
            rowStart: 0,
            rowCount: Math.min(totalRows, budget.maxRowsScanned),
            chunkRows: 512,
            columnOrdinals: [columnOrdinal],
            reason: "vectorAnalysis",
        })) {
            if (store.summary(resultSetId)?.corrupt) {
                partialReason = "storeCorrupt";
                break;
            }
            if (chunk.start !== rowsScanned || chunk.rowCount !== chunk.values.length) {
                partialReason = "storeShortRead";
                break;
            }
            for (const row of chunk.values) {
                if (performance.now() - startedAt > budget.maxTimeMs) {
                    partialReason = "timeBudget";
                    break discover;
                }
                if (rowsScanned >= budget.maxRowsScanned) {
                    partialReason = "rowBudget";
                    break discover;
                }
                rowsScanned++;
                const cell = row?.[0];
                if (isVectorCellEncodingV1(cell) && cell.status === "ok") {
                    scannedBytes += cell.byteLength;
                    if (scannedBytes > budget.maxScanBytes) {
                        partialReason = "byteBudget";
                        break discover;
                    }
                    dimensions = cell.dimensions;
                    break discover;
                }
            }
        }
        if (store.summary(resultSetId)?.corrupt) partialReason = "storeCorrupt";
        if (partialReason === "storeCorrupt" || partialReason === "storeShortRead") {
            return { error: VectorWorkbenchLoc.retainedResultsCouldNotBeRead };
        }
        if (dimensions === 0) {
            if (rowsScanned < Math.min(totalRows, budget.maxRowsScanned) && !partialReason) {
                return { error: VectorWorkbenchLoc.retainedResultsCouldNotBeRead };
            }
            return {
                error:
                    partialReason || rowsScanned < totalRows
                        ? VectorWorkbenchLoc.noVectorWithinScanBudget
                        : VectorWorkbenchLoc.noAnalyzableVectorValues,
            };
        }
    }
    if (rowsScanned >= budget.maxRowsScanned) {
        return { error: VectorWorkbenchLoc.noVectorWithinScanBudget };
    }
    const { windows, method, targetRows } = planWindows(totalRows, dimensions, {
        ...budget,
        maxRowsScanned: budget.maxRowsScanned - rowsScanned,
    });

    outer: for (const window of windows) {
        let windowRows = 0;
        for await (const chunk of store.streamRows({
            resultSetId,
            rowStart: window.start,
            rowCount: window.rows,
            chunkRows: 512,
            columnOrdinals: [columnOrdinal],
            reason: "vectorAnalysis",
        })) {
            // A failed spill read may compact later rows into this chunk.
            // Refuse it before assigning any physical source ordinals.
            if (store.summary(resultSetId)?.corrupt) {
                partialReason = "storeCorrupt";
                break outer;
            }
            if (
                chunk.start !== window.start + windowRows ||
                chunk.rowCount !== chunk.values.length
            ) {
                partialReason = "storeShortRead";
                break outer;
            }
            windowRows += chunk.rowCount;
            if (performance.now() - startedAt > budget.maxTimeMs) {
                partialReason = "timeBudget";
                break outer;
            }
            for (let i = 0; i < chunk.values.length; i++) {
                const sourceOrdinal = chunk.start + i;
                rowsScanned++;
                if (rowsScanned > budget.maxRowsScanned) {
                    partialReason = "rowBudget";
                    break outer;
                }
                const cell = chunk.values[i]?.[0];
                if (cell === undefined || cell === null) {
                    nullCount++;
                    continue;
                }
                if (!isVectorCellEncodingV1(cell)) {
                    unavailableCount++;
                    continue;
                }
                if (cell.status !== "ok") {
                    unavailableCount++;
                    continue;
                }
                scannedBytes += cell.byteLength;
                if (scannedBytes > budget.maxScanBytes) {
                    partialReason = "byteBudget";
                    break outer;
                }
                if (cell.dimensions !== dimensions) {
                    unavailableCount++;
                    continue;
                }
                if (packed === undefined) {
                    capacity = targetRows;
                    packed = new Float32Array(capacity * dimensions);
                    sourceOrdinals = new Int32Array(capacity);
                }
                if (rows >= capacity) {
                    partialReason = "componentBudget";
                    break outer;
                }
                if ((rows + 1) * dimensions * 4 > budget.maxPackedBytes) {
                    partialReason = "byteBudget";
                    break outer;
                }
                const decoded = decodeVectorFloat32(cell);
                if (decoded === null) {
                    unavailableCount++;
                    continue;
                }
                packed.set(decoded.values, rows * dimensions);
                sourceOrdinals![rows] = sourceOrdinal;
                rows++;
            }
        }
        if (windowRows !== window.rows) {
            partialReason = "storeShortRead";
            break;
        }
    }
    if (store.summary(resultSetId)?.corrupt) partialReason = "storeCorrupt";

    if (packed === undefined || rows === 0) {
        return {
            error:
                partialReason === "storeCorrupt" || partialReason === "storeShortRead"
                    ? VectorWorkbenchLoc.retainedResultsCouldNotBeRead
                    : partialReason
                      ? VectorWorkbenchLoc.noVectorWithinScanBudget
                      : VectorWorkbenchLoc.noAnalyzableVectorValues,
        };
    }

    const descriptor: VectorSampleDescriptor = {
        sampleRows: rows,
        totalRows,
        // Method describes the SCAN plan: a full scan stays "full" even when
        // nulls/unavailable cells reduce the packed yield below totalRows.
        method,
        seed,
        rowsScanned,
        budget: {
            maxRowsScanned: budget.maxRowsScanned,
            maxSampleRows: budget.maxSampleRows,
            maxComponents: budget.maxComponents,
            maxPackedBytes: budget.maxPackedBytes,
            maxScanBytes: budget.maxScanBytes,
            maxTimeMs: budget.maxTimeMs,
        },
        packedBytes: rows * dimensions * 4,
        scannedBytes,
        ...(partialReason ? { partialReason } : {}),
    };
    return {
        packed: rows === capacity ? packed : packed.slice(0, rows * dimensions),
        rows,
        dimensions,
        sourceOrdinals: sourceOrdinals!.slice(0, rows),
        nullCount,
        unavailableCount,
        descriptor,
    };
}
