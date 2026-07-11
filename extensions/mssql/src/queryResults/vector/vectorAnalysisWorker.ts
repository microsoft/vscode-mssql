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

export interface VectorWorkerOptions {
    /**
     * Compute the heavy Profile stages (duplicate hashing, centroid
     * outliers, norm outliers, pair sampling). Default true. A projection
     * run with a cached profile turns this off.
     */
    readonly profile?: boolean;
    /**
     * Compute the deterministic PCA 2D projection (VEC-6). Default false —
     * profile-only runs never pay for PCA.
     */
    readonly projection?: boolean;
}

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
    /** Which stages to run; omitted = profile only (VEC-4 behavior). */
    readonly opts?: VectorWorkerOptions;
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

export interface VectorWorkerProjection {
    /** Interleaved [x0, y0, x1, y1, …] PC1/PC2 scores per analyzed row. */
    readonly coords: Float64Array;
    /** Packed-row index per analyzed row (non-finite rows are excluded). */
    readonly rowIndices: Int32Array;
    readonly analyzedRows: number;
    /** Explained variance %, of total sampled variance over analyzed rows. */
    readonly pc1VariancePct: number;
    readonly pc2VariancePct: number;
    /** Third working component — the truth banner's "next z% not shown". */
    readonly nextVariancePct: number;
    /** Orthogonal iterations actually run (deterministic, disclosed). */
    readonly iterations: number;
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
    /** Deterministic PCA 2D output; present only when opts.projection. */
    readonly projection?: VectorWorkerProjection;
    /**
     * True when the time budget expired before pair sampling or the PCA
     * completed (a half-finished projection is never returned).
     */
    readonly partialTime: boolean;
    /** Wall-clock the analysis consumed (diagnostic metric, value-free). */
    readonly elapsedMs: number;
}

const HISTOGRAM_BUCKETS = 24;
const NEAR_ZERO_EPSILON = 1e-6;
const NEAR_CONSTANT_VARIANCE = 1e-5;
const DETAIL_CAP = 256;
const VARIANCE_LIST = 10;

// --- PCA 2D (VEC-6; impl plan §14 "covariance-free orthogonal iteration") ---
// Working components: 2 displayed + 1 "next" estimate for the truth banner.
const PCA_COMPONENTS = 3;
/** Fixed iteration ceiling — deterministic and bounded (~50 per spec). */
const PCA_ITERATIONS = 50;
/** Deterministic early stop once the subspace is stationary. */
const PCA_CONVERGENCE_EPS = 1e-9;
/** Fixed constant — the init basis is seed-INDEPENDENT and deterministic. */
const PCA_INIT_SEED = 0x5eedc0de;

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

/**
 * Modified Gram–Schmidt over `basis` (in place, double pass for stability).
 * Degenerate columns (rank-deficient data) are replaced deterministically
 * with unit axes so the basis stays orthonormal.
 */
function orthonormalize(basis: Float64Array[], dimensions: number): void {
    for (let k = 0; k < basis.length; k++) {
        const v = basis[k];
        for (let pass = 0; pass < 2; pass++) {
            for (let j = 0; j < k; j++) {
                const q = basis[j];
                let r = 0;
                for (let d = 0; d < dimensions; d++) {
                    r += v[d] * q[d];
                }
                for (let d = 0; d < dimensions; d++) {
                    v[d] -= r * q[d];
                }
            }
        }
        let norm = 0;
        for (let d = 0; d < dimensions; d++) {
            norm += v[d] * v[d];
        }
        norm = Math.sqrt(norm);
        if (norm > 1e-12) {
            for (let d = 0; d < dimensions; d++) {
                v[d] /= norm;
            }
            continue;
        }
        // Deterministic fallback: walk fixed unit axes until one survives
        // orthogonalization against the previous columns.
        let replaced = false;
        for (let axis = 0; axis < dimensions && !replaced; axis++) {
            v.fill(0);
            v[(k + axis) % dimensions] = 1;
            for (let j = 0; j < k; j++) {
                const q = basis[j];
                let r = 0;
                for (let d = 0; d < dimensions; d++) {
                    r += v[d] * q[d];
                }
                for (let d = 0; d < dimensions; d++) {
                    v[d] -= r * q[d];
                }
            }
            let axisNorm = 0;
            for (let d = 0; d < dimensions; d++) {
                axisNorm += v[d] * v[d];
            }
            axisNorm = Math.sqrt(axisNorm);
            if (axisNorm > 1e-6) {
                for (let d = 0; d < dimensions; d++) {
                    v[d] /= axisNorm;
                }
                replaced = true;
            }
        }
        if (!replaced) {
            // dimensions < k+1 (more components than dimensions): leave a
            // zero column — its scores and variance are exactly 0.
            v.fill(0);
        }
    }
}

/**
 * Deterministic PCA 2D via covariance-free orthogonal iteration
 * (impl plan §14): d×K basis (K = min(3, d)), Gram–Schmidt each iteration,
 * fixed iteration ceiling with a deterministic convergence stop, float64
 * accumulators throughout, seed-independent deterministic init. NEVER
 * allocates a d×d covariance matrix — per-iteration work is Z = Xc·Q then
 * Y = Xcᵀ·Z with the centering folded in algebraically (Xc = X − 1·meanᵀ).
 *
 * Returns null when the deadline passes mid-iteration: a half-converged
 * projection is never returned (honest partial).
 */
export function computePca2d(
    packed: Float32Array,
    dimensions: number,
    analyzedRows: Int32Array,
    deadline: number,
): VectorWorkerProjection | null {
    const n = analyzedRows.length;
    const k = Math.min(PCA_COMPONENTS, dimensions);

    // Component means over the ANALYZED rows only (float64).
    const mean = new Float64Array(dimensions);
    for (let i = 0; i < n; i++) {
        const base = analyzedRows[i] * dimensions;
        for (let d = 0; d < dimensions; d++) {
            mean[d] += packed[base + d];
        }
    }
    if (n > 0) {
        for (let d = 0; d < dimensions; d++) {
            mean[d] /= n;
        }
    }

    // Seed-independent deterministic init (fixed PRNG stream), orthonormalized.
    const initRng = makeRng(PCA_INIT_SEED);
    const basis: Float64Array[] = [];
    for (let c = 0; c < k; c++) {
        const v = new Float64Array(dimensions);
        for (let d = 0; d < dimensions; d++) {
            v[d] = initRng() * 2 - 1;
        }
        basis.push(v);
    }
    orthonormalize(basis, dimensions);

    const q0 = basis[0];
    const q1 = k > 1 ? basis[1] : undefined;
    const q2 = k > 2 ? basis[2] : undefined;
    const y0 = new Float64Array(dimensions);
    const y1 = q1 ? new Float64Array(dimensions) : undefined;
    const y2 = q2 ? new Float64Array(dimensions) : undefined;
    const next: Float64Array[] = [y0];
    if (y1) {
        next.push(y1);
    }
    if (y2) {
        next.push(y2);
    }

    let iterations = 0;
    for (let iter = 0; iter < PCA_ITERATIONS && n > 0; iter++) {
        if (performance.now() > deadline) {
            return null; // honest: no half-projection
        }
        // uq[c] = mean · q[c] (centering correction for Z).
        let uq0 = 0;
        let uq1 = 0;
        let uq2 = 0;
        for (let d = 0; d < dimensions; d++) {
            uq0 += mean[d] * q0[d];
            if (q1) {
                uq1 += mean[d] * q1[d];
            }
            if (q2) {
                uq2 += mean[d] * q2[d];
            }
        }
        y0.fill(0);
        y1?.fill(0);
        y2?.fill(0);
        let s0 = 0;
        let s1 = 0;
        let s2 = 0;
        for (let i = 0; i < n; i++) {
            const base = analyzedRows[i] * dimensions;
            let z0 = 0;
            let z1 = 0;
            let z2 = 0;
            for (let d = 0; d < dimensions; d++) {
                const v = packed[base + d];
                z0 += v * q0[d];
                if (q1) {
                    z1 += v * q1[d];
                }
                if (q2) {
                    z2 += v * q2[d];
                }
            }
            z0 -= uq0;
            z1 -= uq1;
            z2 -= uq2;
            s0 += z0;
            s1 += z1;
            s2 += z2;
            for (let d = 0; d < dimensions; d++) {
                const v = packed[base + d];
                y0[d] += v * z0;
                if (y1) {
                    y1[d] += v * z1;
                }
                if (y2) {
                    y2[d] += v * z2;
                }
            }
        }
        // Centering correction for Y: Xcᵀ·Z = Xᵀ·Z − mean·(1ᵀ·Z).
        for (let d = 0; d < dimensions; d++) {
            y0[d] -= mean[d] * s0;
            if (y1) {
                y1[d] -= mean[d] * s1;
            }
            if (y2) {
                y2[d] -= mean[d] * s2;
            }
        }
        orthonormalize(next, dimensions);
        // Deterministic convergence measure BEFORE adopting the new basis.
        let delta = 0;
        for (let c = 0; c < k; c++) {
            let dot = 0;
            for (let d = 0; d < dimensions; d++) {
                dot += next[c][d] * basis[c][d];
            }
            delta = Math.max(delta, 1 - Math.abs(dot));
        }
        for (let c = 0; c < k; c++) {
            basis[c].set(next[c]);
        }
        iterations = iter + 1;
        if (delta < PCA_CONVERGENCE_EPS) {
            break;
        }
    }

    // Deterministic sign normalization: largest-|loading| component positive.
    for (let c = 0; c < k; c++) {
        const v = basis[c];
        let argmax = 0;
        for (let d = 1; d < dimensions; d++) {
            if (Math.abs(v[d]) > Math.abs(v[argmax])) {
                argmax = d;
            }
        }
        if (v[argmax] < 0) {
            for (let d = 0; d < dimensions; d++) {
                v[d] = -v[d];
            }
        }
    }

    // Final pass: scores for every analyzed row + score/total variance.
    const scores = new Float64Array(n * PCA_COMPONENTS);
    const sum = new Float64Array(PCA_COMPONENTS);
    const sumSq = new Float64Array(PCA_COMPONENTS);
    let totalSq = 0;
    let uq0 = 0;
    let uq1 = 0;
    let uq2 = 0;
    for (let d = 0; d < dimensions; d++) {
        uq0 += mean[d] * q0[d];
        if (q1) {
            uq1 += mean[d] * q1[d];
        }
        if (q2) {
            uq2 += mean[d] * q2[d];
        }
    }
    for (let i = 0; i < n; i++) {
        const base = analyzedRows[i] * dimensions;
        let z0 = 0;
        let z1 = 0;
        let z2 = 0;
        for (let d = 0; d < dimensions; d++) {
            const v = packed[base + d];
            z0 += v * q0[d];
            if (q1) {
                z1 += v * q1[d];
            }
            if (q2) {
                z2 += v * q2[d];
            }
            const centered = v - mean[d];
            totalSq += centered * centered;
        }
        z0 -= uq0;
        z1 = q1 ? z1 - uq1 : 0;
        z2 = q2 ? z2 - uq2 : 0;
        scores[i * PCA_COMPONENTS] = z0;
        scores[i * PCA_COMPONENTS + 1] = z1;
        scores[i * PCA_COMPONENTS + 2] = z2;
        sum[0] += z0;
        sum[1] += z1;
        sum[2] += z2;
        sumSq[0] += z0 * z0;
        sumSq[1] += z1 * z1;
        sumSq[2] += z2 * z2;
    }
    const componentVariance = new Float64Array(PCA_COMPONENTS);
    for (let c = 0; c < PCA_COMPONENTS; c++) {
        componentVariance[c] =
            n > 1 ? Math.max(0, (sumSq[c] - (sum[c] * sum[c]) / n) / (n - 1)) : 0;
    }
    const totalVariance = n > 1 ? totalSq / (n - 1) : 0;

    // Order components by descending explained variance (stable, deterministic).
    const order = [0, 1, 2].sort((a, b) => componentVariance[b] - componentVariance[a] || a - b);
    const coords = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
        coords[i * 2] = scores[i * PCA_COMPONENTS + order[0]];
        coords[i * 2 + 1] = scores[i * PCA_COMPONENTS + order[1]];
    }
    const pct = (c: number) =>
        totalVariance > 0 ? (componentVariance[order[c]] / totalVariance) * 100 : 0;
    return {
        coords,
        rowIndices: analyzedRows,
        analyzedRows: n,
        pc1VariancePct: pct(0),
        pc2VariancePct: pct(1),
        nextVariancePct: pct(2),
        iterations,
    };
}

/** The pure analysis core — unit-testable without worker_threads. */
export function analyzePackedVectors(input: VectorWorkerInput): VectorWorkerResult {
    const startedAt = performance.now();
    const deadline = startedAt + Math.max(1, input.timeBudgetMs);
    const { packed, rows, dimensions } = input;
    const wantProfile = input.opts?.profile !== false;
    const wantProjection = input.opts?.projection === true;

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

    // --- duplicate groups: SHA-256 over exact row bytes (profile only) ------
    const duplicateGroups: number[][] = [];
    let duplicateRowCount = 0;
    if (wantProfile) {
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
        for (const members of groups.values()) {
            if (members.length > 1) {
                duplicateGroups.push(members);
                duplicateRowCount += members.length;
            }
        }
    }

    // --- centroid-distance outliers (cosine from sample centroid; profile) --
    const centroidOutliers: number[] = [];
    if (wantProfile) {
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
        for (let r = 0; r < rows && centroidComparable > 0; r++) {
            if (!Number.isNaN(centroidDistances[r]) && centroidDistances[r] > p99) {
                centroidOutliers.push(r);
            }
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
    if (wantProfile && comparableRows.length >= 2 && input.pairTarget > 0) {
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

    // --- deterministic PCA 2D (VEC-6; opts.projection only) -----------------
    let projection: VectorWorkerProjection | undefined;
    if (wantProjection) {
        // Non-finite rows are excluded from the PCA (their coordinates would
        // poison every accumulator); zero/near-zero rows participate.
        let finiteCount = 0;
        for (let r = 0; r < rows; r++) {
            if (nonFiniteFlag[r] === 0) {
                finiteCount++;
            }
        }
        const analyzedRows = new Int32Array(finiteCount);
        for (let r = 0, i = 0; r < rows; r++) {
            if (nonFiniteFlag[r] === 0) {
                analyzedRows[i++] = r;
            }
        }
        if (finiteCount > 0) {
            const pca = computePca2d(packed, dimensions, analyzedRows, deadline);
            if (pca === null) {
                partialTime = true; // honest: no half-projection
            } else {
                projection = pca;
            }
        }
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
        ...(projection ? { projection } : {}),
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
    readonly opts?: VectorWorkerOptions;
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
            ...(envelope.opts ? { opts: envelope.opts } : {}),
        });
        parentPort.postMessage({ ok: true, result });
    } catch (error) {
        parentPort.postMessage({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
