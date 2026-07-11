/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure Compare math (VEC-6): pairwise metrics, top-|Δ| and contribution
 * dimensions, and the selection summary for 2..8 decoded vectors. Small
 * enough to run in-process — no worker for ≤8 vectors.
 *
 * Discipline mirrors the analysis worker (impl plan §14): float64
 * accumulation everywhere; SQL-matching metric definitions
 * (`cosine distance = 1 − dot/(‖a‖·‖b‖)`, `euclidean = √Σ(aᵢ−bᵢ)²`,
 * `negative dot product = −Σaᵢbᵢ`); zero-norm cosine is UNDEFINED (null),
 * never coerced to 0 or 1. Outputs are derived numbers only — safe for the
 * webview, banned from logs.
 */

import {
    VECTOR_COMPARE_TOP_DIMENSIONS,
    VectorCompareDimensionEntry,
    VectorCompareItem,
    VectorCompareSummary,
    VectorPairwiseMatrices,
} from "../../sharedInterfaces/vectorWorkbench";

export interface VectorCompareInputVector {
    /** Zero-based result-row ordinal (basket identity). */
    readonly ordinal: number;
    /** Decoded float32 components (all inputs share one dimensionality). */
    readonly values: Float32Array;
}

export interface VectorCompareComputation {
    readonly items: readonly VectorCompareItem[];
    readonly pairwise: VectorPairwiseMatrices;
    readonly topDeltaDimensions: readonly VectorCompareDimensionEntry[];
    readonly topContributions: readonly VectorCompareDimensionEntry[];
    readonly summary: VectorCompareSummary;
}

const ZERO_NORM_EPSILON = 0; // exact: cosine undefined only for ‖v‖ = 0

/** Bounded top-k selection by |value| desc, dimension asc on ties. */
function topByAbs(values: Float64Array, k: number): VectorCompareDimensionEntry[] {
    const order = Array.from(values.keys()).sort(
        (a, b) => Math.abs(values[b]) - Math.abs(values[a]) || a - b,
    );
    return order.slice(0, Math.min(k, values.length)).map((dimension) => ({
        dimension,
        value: values[dimension],
    }));
}

/**
 * Compute the full Compare body (minus evidence — the service stamps that).
 * Preconditions the caller (service) enforces: 2..8 vectors, identical
 * dimensionality across all of them.
 */
export function computeVectorCompare(
    vectors: readonly VectorCompareInputVector[],
): VectorCompareComputation {
    const n = vectors.length;
    const dimensions = vectors[0]?.values.length ?? 0;

    // Per-item norms (float64 accumulation).
    const l2 = new Float64Array(n);
    const items: VectorCompareItem[] = vectors.map((vector, i) => {
        let sumSq = 0;
        let sumAbs = 0;
        let maxAbs = 0;
        for (let d = 0; d < dimensions; d++) {
            const v = vector.values[d];
            sumSq += v * v;
            const abs = Math.abs(v);
            sumAbs += abs;
            if (abs > maxAbs) {
                maxAbs = abs;
            }
        }
        l2[i] = Math.sqrt(sumSq);
        return {
            ordinal: vector.ordinal,
            dimensions,
            l2: l2[i],
            l1: sumAbs,
            linf: maxAbs,
        };
    });

    // Pairwise matrices: upper triangle computed once, mirrored.
    const cosine: Array<Array<number | null>> = [];
    const euclidean: number[][] = [];
    const negativeDot: number[][] = [];
    for (let i = 0; i < n; i++) {
        cosine.push(new Array<number | null>(n).fill(0));
        euclidean.push(new Array<number>(n).fill(0));
        negativeDot.push(new Array<number>(n).fill(0));
    }
    for (let i = 0; i < n; i++) {
        const a = vectors[i].values;
        // Diagonal: metric identity — distances 0, negative dot = −‖a‖².
        negativeDot[i][i] = -(l2[i] * l2[i]);
        cosine[i][i] = l2[i] > ZERO_NORM_EPSILON ? 0 : null;
        for (let j = i + 1; j < n; j++) {
            const b = vectors[j].values;
            let dot = 0;
            let distSq = 0;
            for (let d = 0; d < dimensions; d++) {
                const av = a[d];
                const bv = b[d];
                dot += av * bv;
                const diff = av - bv;
                distSq += diff * diff;
            }
            const cos =
                l2[i] > ZERO_NORM_EPSILON && l2[j] > ZERO_NORM_EPSILON
                    ? 1 - dot / (l2[i] * l2[j])
                    : null;
            cosine[i][j] = cos;
            cosine[j][i] = cos;
            const dist = Math.sqrt(distSq);
            euclidean[i][j] = dist;
            euclidean[j][i] = dist;
            negativeDot[i][j] = -dot;
            negativeDot[j][i] = -dot;
        }
    }

    // First pair (A ↔ B): top |Δ| and top contribution dimensions, bounded.
    let topDeltaDimensions: VectorCompareDimensionEntry[] = [];
    let topContributions: VectorCompareDimensionEntry[] = [];
    if (n >= 2) {
        const a = vectors[0].values;
        const b = vectors[1].values;
        const delta = new Float64Array(dimensions);
        const contribution = new Float64Array(dimensions);
        for (let d = 0; d < dimensions; d++) {
            delta[d] = a[d] - b[d];
            contribution[d] = a[d] * b[d];
        }
        topDeltaDimensions = topByAbs(delta, VECTOR_COMPARE_TOP_DIMENSIONS);
        topContributions = topByAbs(contribution, VECTOR_COMPARE_TOP_DIMENSIONS);
    }

    // Selection summary over defined cosine pairs (undefined pairs excluded,
    // never coerced). All aggregates carry the metric name.
    let pairSum = 0;
    let pairCount = 0;
    let closestPair: VectorCompareSummary["closestPair"] = null;
    const rowSum = new Float64Array(n);
    const rowCount = new Int32Array(n);
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const value = cosine[i][j];
            if (value === null) {
                continue;
            }
            pairSum += value;
            pairCount++;
            rowSum[i] += value;
            rowSum[j] += value;
            rowCount[i]++;
            rowCount[j]++;
            if (closestPair === null || value < closestPair.distance) {
                closestPair = { a: i, b: j, distance: value };
            }
        }
    }
    let medoidIndex: number | null = null;
    let mostIsolatedIndex: number | null = null;
    let medoidAvg = Infinity;
    let isolatedAvg = -Infinity;
    for (let i = 0; i < n; i++) {
        if (rowCount[i] === 0) {
            continue;
        }
        const avg = rowSum[i] / rowCount[i];
        if (avg < medoidAvg) {
            medoidAvg = avg;
            medoidIndex = i;
        }
        if (avg > isolatedAvg) {
            isolatedAvg = avg;
            mostIsolatedIndex = i;
        }
    }
    const summary: VectorCompareSummary = {
        metric: "cosine",
        medoidIndex,
        mostIsolatedIndex,
        mostIsolatedAvgDistance: mostIsolatedIndex !== null ? isolatedAvg : null,
        closestPair,
        avgPairDistance: pairCount > 0 ? pairSum / pairCount : null,
        compatibleCount: n,
    };

    return {
        items,
        pairwise: { cosine, euclidean, negativeDot },
        topDeltaDimensions,
        topContributions,
        summary,
    };
}

/**
 * Evenly thinned render indices (P0-8): pick `min(count, cap)` indices from
 * 0..count−1 with a uniform stride. This is a RENDER cap over fully analyzed
 * rows — never a sample, and callers must never label it one.
 */
export function selectRenderIndices(count: number, cap: number): number[] {
    const take = Math.max(0, Math.min(count, cap));
    if (take === count) {
        return Array.from({ length: count }, (_, i) => i);
    }
    const indices: number[] = new Array(take);
    for (let k = 0; k < take; k++) {
        indices[k] = Math.floor((k * count) / take);
    }
    return indices;
}
