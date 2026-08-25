/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from "vitest";
import {
    incompleteBeta,
    quantile,
    summarize,
    trimmedMean,
    twoTailedPValue,
    welchT,
} from "../src/regression/statistics";
import {
    classifyMetric,
    overallStatus,
    resolveThreshold,
    type MetricKey,
} from "../src/regression/regression";

const KEY: MetricKey = {
    scenarioId: "s",
    name: "scenario.wallclock",
    component: "scenario",
    processRole: "boundary",
    unit: "ms",
};

const THRESHOLD = resolveThreshold("scenario.wallclock", {
    default: { pct: 10, absMs: 5, minSamples: 3, maxCv: 0.2, test: "welchT", pValue: 0.05 },
});

describe("statistics", () => {
    it("summarize computes the documented aggregates", () => {
        const s = summarize([10, 12, 11, 13, 14]);
        expect(s.samples).toBe(5);
        expect(s.median).toBe(12);
        expect(s.min).toBe(10);
        expect(s.max).toBe(14);
        expect(s.aggregation).toBe("median"); // n < 10 → median
        expect(s.aggregate).toBe(12);
        expect(s.cv).toBeGreaterThan(0);
    });

    it("uses 20% trimmed mean for n >= 10 and it resists outliers", () => {
        const values = [10, 10, 10, 10, 10, 10, 10, 10, 10, 1000];
        const s = summarize(values);
        expect(s.aggregation).toBe("trimmedMean20");
        expect(s.aggregate).toBe(10); // the 1000 outlier is trimmed
        expect(trimmedMean(values, 0.2)).toBe(10);
    });

    it("quantile interpolates", () => {
        expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
        expect(quantile([1, 2, 3, 4, 5], 0.9)).toBeCloseTo(4.6);
    });

    it("incomplete beta matches known values", () => {
        // I_0.5(1,1) = 0.5 (uniform); I_x(1,1) = x
        expect(incompleteBeta(0.5, 1, 1)).toBeCloseTo(0.5, 6);
        expect(incompleteBeta(0.25, 1, 1)).toBeCloseTo(0.25, 6);
    });

    it("two-tailed p-values match reference t-distribution points", () => {
        // t=2.0, df=10 → p ≈ 0.0734 (reference: scipy.stats 2*(1-cdf))
        expect(twoTailedPValue(2.0, 10)).toBeCloseTo(0.0734, 3);
        // t=0 → p = 1
        expect(twoTailedPValue(0, 10)).toBeCloseTo(1, 6);
    });

    it("welchT detects a clear shift and ignores identical samples", () => {
        const shifted = welchT([10, 11, 10, 12, 11], [20, 21, 20, 22, 21]);
        expect(shifted!.pValue).toBeLessThan(0.001);
        const same = welchT([10, 10, 10], [10, 10, 10]);
        expect(same!.pValue).toBe(1);
    });
});

describe("classifyMetric", () => {
    it("flags a clear regression (both thresholds exceeded, significant)", () => {
        const result = classifyMetric(
            KEY,
            [110, 112, 111, 113, 110], // current: ~+11% and +11ms worse
            [100, 101, 100, 99, 100],
            true,
            THRESHOLD,
        );
        expect(result.verdict).toBe("regressed");
        expect(result.deltaPct).toBeGreaterThan(10);
    });

    it("small absolute deltas never regress even with large percentages", () => {
        // +50% but only +0.5ms — below the 5ms absolute floor
        const result = classifyMetric(
            KEY,
            [1.5, 1.5, 1.5, 1.5],
            [1.0, 1.0, 1.0, 1.0],
            true,
            THRESHOLD,
        );
        expect(result.verdict).toBe("unchanged");
    });

    it("improvements are classified as improved", () => {
        const result = classifyMetric(
            KEY,
            [80, 81, 80, 79, 80],
            [100, 101, 100, 99, 100],
            true,
            THRESHOLD,
        );
        expect(result.verdict).toBe("improved");
    });

    it("higherIsBetter metrics regress in the opposite direction", () => {
        const result = classifyMetric(
            { ...KEY, name: "throughput" },
            [80, 81, 80, 79, 80], // lower throughput = worse
            [100, 101, 100, 99, 100],
            false,
            THRESHOLD,
        );
        expect(result.verdict).toBe("regressed");
    });

    it("insufficient samples → inconclusive, never gated", () => {
        const result = classifyMetric(KEY, [200], [100, 100, 100], true, THRESHOLD);
        expect(result.verdict).toBe("inconclusive");
    });

    it("high variance → inconclusive", () => {
        const result = classifyMetric(
            KEY,
            [50, 200, 60, 190, 55], // cv way over 0.2
            [100, 100, 101, 99, 100],
            true,
            THRESHOLD,
        );
        expect(result.verdict).toBe("inconclusive");
    });

    it("metric-specific threshold overrides the default", () => {
        const custom = resolveThreshold("scenario.wallclock", {
            default: { pct: 10, absMs: 5 },
            metrics: { "scenario.wallclock": { pct: 50, absMs: 100 } },
        });
        const result = classifyMetric(KEY, [120, 121, 120, 119], [100, 100, 101, 99], true, custom);
        expect(result.verdict).toBe("unchanged"); // +20% < 50% custom threshold
    });

    it("does not apply the millisecond floor to ratio metrics", () => {
        const threshold = resolveThreshold("soak.reliability.failureRate", {
            default: { pct: 10, absMs: 5, minSamples: 3, test: "none" },
        });
        const result = classifyMetric(
            { ...KEY, name: "soak.reliability.failureRate", unit: "ratio" },
            [1, 1, 1],
            [0, 0, 0],
            true,
            threshold,
        );
        expect(result.verdict).toBe("regressed");
        expect(result.deltaPct).toBe(Number.POSITIVE_INFINITY);
    });
});

describe("overallStatus (worst metric wins)", () => {
    const mk = (verdict: "regressed" | "improved" | "unchanged" | "inconclusive") =>
        ({ key: KEY, verdict, threshold: THRESHOLD, reason: "" }) as never;

    it("any regression wins", () => {
        expect(overallStatus([mk("improved"), mk("regressed"), mk("unchanged")])).toBe("regressed");
    });
    it("all inconclusive → inconclusive", () => {
        expect(overallStatus([mk("inconclusive"), mk("inconclusive")])).toBe("inconclusive");
    });
    it("improvement without regression → improved", () => {
        expect(overallStatus([mk("improved"), mk("unchanged")])).toBe("improved");
    });
    it("all unchanged → passed", () => {
        expect(overallStatus([mk("unchanged")])).toBe("passed");
    });
    it("no official metric comparisons → inconclusive", () => {
        expect(overallStatus([])).toBe("inconclusive");
    });
});
