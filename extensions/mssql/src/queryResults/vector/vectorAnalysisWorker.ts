/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Vector analysis worker (VEC-4): the numerical core of the Vector Workbench
 * Profile, run OFF the extension host thread. Input is one transferred packed
 * row-major Float32Array (never cloned) plus counts and a seed; output is
 * derived data only — histograms, per-dimension variance, finding ordinals.
 *
 * Discipline (impl plan §17–19):
 *  - float64 accumulation everywhere (norms, moments, dot products);
 *  - deterministic: seeded xorshift128 PRNG for pair sampling, stable
 *    iteration order, no Date-dependent math (the time budget uses a
 *    monotonic deadline and reports partial honestly);
 *  - bounded: every drill-in list caps at DETAIL_CAP ordinals with a
 *    truncated flag — the full packed input never travels back;
 *  - value-free messaging: the worker posts numbers derived from the data,
 *    never key/label/text columns (it never receives them).
 *
 * The module also exports the pure `analyzePackedVectors` for direct unit
 * testing — the worker_threads harness is a thin envelope around it.
 */

import { createHash } from "crypto";
import { parentPort, workerData } from "worker_threads";
import {
    VectorFindingKind,
    VectorFindingSeverity,
    VectorFindingSubject,
    VectorHistogram,
} from "../../sharedInterfaces/vectorWorkbench";

export interface VectorWorkerInput {
    /** Row-major packed components; length === rows * dimensions. */
    readonly packed: Float32Array;
    readonly rows: number;
    readonly dimensions: number;
    /** Deterministic seed (sample descriptor stamps it). */
    readonly seed: number;
    /** Monotonic time budget in ms for the whole analysis. */
    readonly timeBudgetMs: number;
    /** Sampled pair-distance pair count target. */
    readonly pairTarget: number;
}

export interface VectorWorkerFinding {
    readonly kind: VectorFindingKind;
    readonly subject: VectorFindingSubject;
    readonly severity: VectorFindingSeverity;
    readonly affectedCount: number;
    /** Row indices into the packed sample (subject row/duplicateGroup) — capped. */
    readonly rowIndices?: readonly number[];
    /** Dimension ordinals (subject dimension) — capped. */
    readonly dimensionOrdinals?: readonly number[];
    /** Per-entry scalar facts aligned with the ordinal list. */
    readonly values?: readonly number[];
    readonly truncated: boolean;
}

export interface VectorWorkerResult {
    readonly rows: number;
    readonly dimensions: number;
    readonly norms: {
        readonly l2: VectorHistogram;
        readonly l1: VectorHistogram;
        readonly linf: VectorHistogram;
        readonly nearZeroCount: number;
        readonly nearZeroEpsilon: number;
    };
    readonly varianceTop: Array<{ dimension: number; variance: number }>;
    readonly varianceBottom: Array<{ dimension: number; variance: number }>;
    readonly findings: VectorWorkerFinding[];
    readonly pairDistances?: VectorHistogram & { metric: "cosine"; pairCount: number };
    /** True when the time budget expired before pair sampling completed. */
    readonly partialTime: boolean;
    /** Wall-clock the analysis consumed (diagnostic metric, value-free). */
    readonly elapsedMs: number;
}

const HISTOGRAM_BUCKETS = 24;
const NEAR_ZERO_EPSILON = 1e-6;
const NEAR_CONSTANT_VARIANCE = 1e-5;
const DETAIL_CAP = 256;
const VARIANCE_LIST = 10;

/** xorshift128 — deterministic, seedable, good enough for pair sampling. */
export function makeRng(seed: number): () => number {
    let x = seed >>> 0 || 0x9e3779b9;
    let y = 0x243f6a88;
    let z = 0xb7e15162;
    let w = 0xdeadbeef ^ (seed >>> 16);
    return () => {
        const t = x ^ (x << 11);
        x = y;
        y = z;
        z = w;
        w = (w ^ (w >>> 19) ^ (t ^ (t >>> 8))) >>> 0;
        return w / 0x100000000;
    };
}

function histogram(values: Float64Array, count: number): VectorHistogram {
    if (count === 0) {
        return { min: 0, max: 0, bucketCounts: [], p5: 0, median: 0, p95: 0 };
    }
    const sorted = values.slice(0, count).sort();
    const min = sorted[0];
    const max = sorted[count - 1];
    const buckets = new Array<number>(HISTOGRAM_BUCKETS).fill(0);
    const span = max - min || 1;
    for (let i = 0; i < count; i++) {
        const bucket = Math.min(
            HISTOGRAM_BUCKETS - 1,
            Math.floor(((sorted[i] - min) / span) * HISTOGRAM_BUCKETS),
        );
        buckets[bucket]++;
    }
    const q = (p: number) => sorted[Math.min(count - 1, Math.floor(p * (count - 1)))];
    return {
        min,
        max,
        bucketCounts: buckets,
        p5: q(0.05),
        median: q(0.5),
        p95: q(0.95),
    };
}

/** The pure analysis core — unit-testable without worker_threads. */
export function analyzePackedVectors(input: VectorWorkerInput): VectorWorkerResult {
    const startedAt = performance.now();
    const deadline = startedAt + Math.max(1, input.timeBudgetMs);
    const { packed, rows, dimensions } = input;

    // --- pass 1: per-row norms + non-finite scan + per-dim moments ---------
    const l2 = new Float64Array(rows);
    const l1 = new Float64Array(rows);
    const linf = new Float64Array(rows);
    const dimMean = new Float64Array(dimensions);
    const dimM2 = new Float64Array(dimensions);
    const nonFiniteRows: number[] = [];
    const nonFiniteFlag = new Uint8Array(rows);
    const zeroRows: number[] = [];
    const nearZeroRows: number[] = [];
    let nearZeroCount = 0;

    for (let r = 0; r < rows; r++) {
        const base = r * dimensions;
        let sumSq = 0;
        let sumAbs = 0;
        let maxAbs = 0;
        let finite = true;
        let allZero = true;
        for (let d = 0; d < dimensions; d++) {
            const v = packed[base + d];
            if (!Number.isFinite(v)) {
                finite = false;
            }
            if (v !== 0) {
                allZero = false;
            }
            const abs = Math.abs(v);
            sumSq += v * v;
            sumAbs += abs;
            if (abs > maxAbs) {
                maxAbs = abs;
            }
            // Welford per dimension (n = r + 1 at this row).
            const delta = v - dimMean[d];
            dimMean[d] += delta / (r + 1);
            dimM2[d] += delta * (v - dimMean[d]);
        }
        l2[r] = Math.sqrt(sumSq);
        l1[r] = sumAbs;
        linf[r] = maxAbs;
        if (!finite) {
            nonFiniteRows.push(r);
            nonFiniteFlag[r] = 1;
        } else if (allZero) {
            zeroRows.push(r);
        } else if (l2[r] <= NEAR_ZERO_EPSILON) {
            nearZeroRows.push(r);
        }
        if (l2[r] <= NEAR_ZERO_EPSILON) {
            nearZeroCount++;
        }
    }

    // --- per-dimension variance lists ---------------------------------------
    const variance = new Float64Array(dimensions);
    for (let d = 0; d < dimensions; d++) {
        variance[d] = rows > 1 ? dimM2[d] / (rows - 1) : 0;
    }
    const dimOrder = Array.from({ length: dimensions }, (_, d) => d).sort(
        (a, b) => variance[b] - variance[a] || a - b,
    );
    const varianceTop = dimOrder
        .slice(0, VARIANCE_LIST)
        .map((d) => ({ dimension: d, variance: variance[d] }));
    const varianceBottom = dimOrder
        .slice(Math.max(0, dimensions - VARIANCE_LIST))
        .reverse()
        .map((d) => ({ dimension: d, variance: variance[d] }));
    const nearConstant = dimOrder
        .filter((d) => variance[d] < NEAR_CONSTANT_VARIANCE)
        .sort((a, b) => a - b);

    // --- duplicate groups: SHA-256 over exact row bytes ---------------------
    const groups = new Map<string, number[]>();
    const rowBytes = new Uint8Array(packed.buffer, packed.byteOffset, packed.byteLength);
    for (let r = 0; r < rows; r++) {
        const digest = createHash("sha256")
            .update(rowBytes.subarray(r * dimensions * 4, (r + 1) * dimensions * 4))
            .digest("base64");
        const members = groups.get(digest);
        if (members) {
            members.push(r);
        } else {
            groups.set(digest, [r]);
        }
    }
    const duplicateGroups = [...groups.values()].filter((members) => members.length > 1);
    const duplicateRowCount = duplicateGroups.reduce((sum, g) => sum + g.length, 0);

    // --- centroid-distance outliers (cosine distance from sample centroid) --
    const centroid = dimMean; // mean vector (float64)
    let centroidNorm = 0;
    for (let d = 0; d < dimensions; d++) {
        centroidNorm += centroid[d] * centroid[d];
    }
    centroidNorm = Math.sqrt(centroidNorm);
    const centroidDistances = new Float64Array(rows);
    let centroidComparable = 0;
    for (let r = 0; r < rows; r++) {
        if (l2[r] <= NEAR_ZERO_EPSILON || centroidNorm === 0 || nonFiniteFlag[r] === 1) {
            centroidDistances[r] = NaN;
            continue;
        }
        const base = r * dimensions;
        let dot = 0;
        for (let d = 0; d < dimensions; d++) {
            dot += packed[base + d] * centroid[d];
        }
        centroidDistances[r] = 1 - dot / (l2[r] * centroidNorm);
        centroidComparable++;
    }
    // p99 threshold over comparable rows.
    const comparable = new Float64Array(centroidComparable);
    for (let r = 0, i = 0; r < rows; r++) {
        if (!Number.isNaN(centroidDistances[r])) {
            comparable[i++] = centroidDistances[r];
        }
    }
    const sortedComparable = comparable.slice().sort();
    const p99 =
        centroidComparable > 0
            ? sortedComparable[
                  Math.min(centroidComparable - 1, Math.floor(0.99 * (centroidComparable - 1)))
              ]
            : 0;
    const centroidOutliers: number[] = [];
    for (let r = 0; r < rows && centroidComparable > 0; r++) {
        if (!Number.isNaN(centroidDistances[r]) && centroidDistances[r] > p99) {
            centroidOutliers.push(r);
        }
    }

    // --- norm outliers (unnormalized rows in a mostly unit-norm sample) -----
    const l2Histogram = histogram(l2, rows);
    const normOutliers: number[] = [];
    if (rows >= 8) {
        // Robust band: median ± 6 * MAD-ish spread via percentiles.
        const spread = Math.max(1e-9, l2Histogram.p95 - l2Histogram.p5);
        for (let r = 0; r < rows; r++) {
            if (
                Number.isFinite(l2[r]) &&
                l2[r] > NEAR_ZERO_EPSILON &&
                Math.abs(l2[r] - l2Histogram.median) > 3 * spread
            ) {
                normOutliers.push(r);
            }
        }
    }

    // --- sampled pair distances (cosine; deterministic; time-budgeted) ------
    const rng = makeRng(input.seed);
    const comparableRows: number[] = [];
    for (let r = 0; r < rows; r++) {
        if (Number.isFinite(l2[r]) && l2[r] > NEAR_ZERO_EPSILON) {
            comparableRows.push(r);
        }
    }
    let pairDistances: VectorWorkerResult["pairDistances"];
    let partialTime = false;
    if (comparableRows.length >= 2 && input.pairTarget > 0) {
        const target = Math.min(
            input.pairTarget,
            (comparableRows.length * (comparableRows.length - 1)) / 2,
        );
        const distances = new Float64Array(target);
        let sampled = 0;
        while (sampled < target) {
            if ((sampled & 0x3ff) === 0 && performance.now() > deadline) {
                partialTime = true;
                break;
            }
            const a = comparableRows[Math.floor(rng() * comparableRows.length)];
            const b = comparableRows[Math.floor(rng() * comparableRows.length)];
            if (a === b) {
                continue;
            }
            const baseA = a * dimensions;
            const baseB = b * dimensions;
            let dot = 0;
            for (let d = 0; d < dimensions; d++) {
                dot += packed[baseA + d] * packed[baseB + d];
            }
            distances[sampled++] = 1 - dot / (l2[a] * l2[b]);
        }
        pairDistances = {
            ...histogram(distances, sampled),
            metric: "cosine",
            pairCount: sampled,
        };
    }

    // --- findings (severity-ordered; bounded ordinal lists) -----------------
    const cap = (list: number[]) => ({
        rowIndices: list.slice(0, DETAIL_CAP),
        truncated: list.length > DETAIL_CAP,
    });
    const findings: VectorWorkerFinding[] = [];
    if (nonFiniteRows.length > 0) {
        findings.push({
            kind: "nonFiniteComponents",
            subject: "row",
            severity: "error",
            affectedCount: nonFiniteRows.length,
            ...cap(nonFiniteRows),
        });
    }
    if (zeroRows.length > 0) {
        findings.push({
            kind: "zeroVectors",
            subject: "row",
            severity: "warning",
            affectedCount: zeroRows.length,
            ...cap(zeroRows),
        });
    }
    if (nearZeroRows.length > 0) {
        findings.push({
            kind: "nearZeroVectors",
            subject: "row",
            severity: "warning",
            affectedCount: nearZeroRows.length,
            ...cap(nearZeroRows),
        });
    }
    if (duplicateGroups.length > 0) {
        const flattened = duplicateGroups.flat().sort((a, b) => a - b);
        findings.push({
            kind: "duplicateVectors",
            subject: "duplicateGroup",
            severity: "info",
            affectedCount: duplicateGroups.length,
            values: [duplicateRowCount],
            ...cap(flattened),
        });
    }
    if (normOutliers.length > 0) {
        findings.push({
            kind: "normOutliers",
            subject: "row",
            severity: "warning",
            affectedCount: normOutliers.length,
            ...cap(normOutliers),
        });
    }
    if (centroidOutliers.length > 0) {
        findings.push({
            kind: "centroidDistanceOutliers",
            subject: "row",
            severity: "info",
            affectedCount: centroidOutliers.length,
            ...cap(centroidOutliers),
        });
    }
    if (nearConstant.length > 0) {
        findings.push({
            kind: "nearConstantDimensions",
            subject: "dimension",
            severity: "info",
            affectedCount: nearConstant.length,
            dimensionOrdinals: nearConstant.slice(0, DETAIL_CAP),
            values: nearConstant.slice(0, DETAIL_CAP).map((d) => variance[d]),
            truncated: nearConstant.length > DETAIL_CAP,
        });
    }

    return {
        rows,
        dimensions,
        norms: {
            l2: l2Histogram,
            l1: histogram(l1, rows),
            linf: histogram(linf, rows),
            nearZeroCount,
            nearZeroEpsilon: NEAR_ZERO_EPSILON,
        },
        varianceTop,
        varianceBottom,
        findings,
        ...(pairDistances ? { pairDistances } : {}),
        partialTime,
        elapsedMs: performance.now() - startedAt,
    };
}

// --- worker_threads envelope -------------------------------------------------

interface WorkerEnvelope {
    readonly rows: number;
    readonly dimensions: number;
    readonly seed: number;
    readonly timeBudgetMs: number;
    readonly pairTarget: number;
    /** Transferred, never cloned. */
    readonly packedBuffer: ArrayBuffer;
}

if (parentPort) {
    const envelope = workerData as WorkerEnvelope;
    try {
        const result = analyzePackedVectors({
            packed: new Float32Array(envelope.packedBuffer),
            rows: envelope.rows,
            dimensions: envelope.dimensions,
            seed: envelope.seed,
            timeBudgetMs: envelope.timeBudgetMs,
            pairTarget: envelope.pairTarget,
        });
        parentPort.postMessage({ ok: true, result });
    } catch (error) {
        parentPort.postMessage({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
