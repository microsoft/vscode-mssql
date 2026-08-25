/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Aggregation and statistics for regression comparison (design §24.1/§24.3).
 * Pure functions, fully unit-tested — these numbers gate CI, so the math has
 * to be boring and verifiable.
 */

export interface SampleSummary {
    samples: number;
    mean: number;
    median: number;
    min: number;
    max: number;
    stdDev: number;
    /** Coefficient of variation (stdDev / mean); 0 when mean is 0. */
    cv: number;
    p90: number;
    p95: number;
    /** Half-width of the 95% confidence interval of the mean (normal approx). */
    ci95: number;
    /** The regression-facing aggregate: 20% trimmed mean when n>=10, else median. */
    aggregate: number;
    aggregation: "trimmedMean20" | "median";
}

export function quantile(sorted: number[], q: number): number {
    if (sorted.length === 0) {
        return NaN;
    }
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    const lower = sorted[base]!;
    const upper = sorted[Math.min(base + 1, sorted.length - 1)]!;
    return lower + rest * (upper - lower);
}

export function trimmedMean(values: number[], trimFraction: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const trim = Math.floor(sorted.length * trimFraction);
    const kept = sorted.slice(trim, sorted.length - trim);
    return kept.reduce((s, v) => s + v, 0) / kept.length;
}

export function summarize(values: number[]): SampleSummary {
    if (values.length === 0) {
        throw new Error("Cannot summarize zero samples");
    }
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const mean = sorted.reduce((s, v) => s + v, 0) / n;
    const variance = n > 1 ? sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
    const stdDev = Math.sqrt(variance);
    const median = quantile(sorted, 0.5);
    const useTrimmed = n >= 10;
    return {
        samples: n,
        mean,
        median,
        min: sorted[0]!,
        max: sorted[n - 1]!,
        stdDev,
        cv: mean !== 0 ? stdDev / Math.abs(mean) : 0,
        p90: quantile(sorted, 0.9),
        p95: quantile(sorted, 0.95),
        ci95: n > 1 ? (1.96 * stdDev) / Math.sqrt(n) : 0,
        aggregate: useTrimmed ? trimmedMean(sorted, 0.2) : median,
        aggregation: useTrimmed ? "trimmedMean20" : "median",
    };
}

// ---------------------------------------------------------------------------
// Welch's t-test (unequal variances), two-tailed p-value.
// ---------------------------------------------------------------------------

export interface WelchResult {
    t: number;
    df: number;
    pValue: number;
}

export function welchT(a: number[], b: number[]): WelchResult | undefined {
    if (a.length < 2 || b.length < 2) {
        return undefined;
    }
    const meanA = a.reduce((s, v) => s + v, 0) / a.length;
    const meanB = b.reduce((s, v) => s + v, 0) / b.length;
    const varA = a.reduce((s, v) => s + (v - meanA) ** 2, 0) / (a.length - 1);
    const varB = b.reduce((s, v) => s + (v - meanB) ** 2, 0) / (b.length - 1);
    const seA = varA / a.length;
    const seB = varB / b.length;
    const se = seA + seB;
    if (se === 0) {
        // Identical constant samples: no evidence of difference.
        return { t: 0, df: a.length + b.length - 2, pValue: 1 };
    }
    const t = (meanA - meanB) / Math.sqrt(se);
    const df = se ** 2 / (seA ** 2 / (a.length - 1) + seB ** 2 / (b.length - 1));
    const pValue = twoTailedPValue(t, df);
    return { t, df, pValue };
}

/** Two-tailed p-value from the t-distribution via the incomplete beta function. */
export function twoTailedPValue(t: number, df: number): number {
    const x = df / (df + t * t);
    return Math.min(1, incompleteBeta(x, df / 2, 0.5));
}

/** Regularized incomplete beta function I_x(a,b) (continued fraction method). */
export function incompleteBeta(x: number, a: number, b: number): number {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const lnBeta = logGamma(a) + logGamma(b) - logGamma(a + b);
    const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lnBeta);
    if (x < (a + 1) / (a + b + 2)) {
        return (front * betaContinuedFraction(x, a, b)) / a;
    }
    return 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

function betaContinuedFraction(x: number, a: number, b: number): number {
    const MAX_ITER = 200;
    const EPS = 3e-12;
    const TINY = 1e-30;
    let c = 1;
    let d = 1 - ((a + b) * x) / (a + 1);
    if (Math.abs(d) < TINY) d = TINY;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= MAX_ITER; m++) {
        const m2 = 2 * m;
        let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
        d = 1 + aa * d;
        if (Math.abs(d) < TINY) d = TINY;
        c = 1 + aa / c;
        if (Math.abs(c) < TINY) c = TINY;
        d = 1 / d;
        h *= d * c;
        aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
        d = 1 + aa * d;
        if (Math.abs(d) < TINY) d = TINY;
        c = 1 + aa / c;
        if (Math.abs(c) < TINY) c = TINY;
        d = 1 / d;
        const del = d * c;
        h *= del;
        if (Math.abs(del - 1) < EPS) break;
    }
    return h;
}

/** Lanczos approximation of ln(Γ(x)). */
export function logGamma(x: number): number {
    const coefficients = [
        76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
        0.1208650973866179e-2, -0.5395239384953e-5,
    ];
    let y = x;
    let tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (const c of coefficients) {
        y += 1;
        ser += c / y;
    }
    return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
