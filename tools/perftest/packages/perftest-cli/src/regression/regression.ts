/**
 * Regression classification (design §24.3): compare official metric
 * distributions between a current run and a baseline run, per metric key,
 * with percent + absolute-floor thresholds and an optional Welch t-test.
 * Worst metric wins the run verdict.
 *
 * Rules enforced here:
 *  - Warmup and non-passed reps never participate (the sample query excludes
 *    them at the SQL level).
 *  - Minimum sample size or the metric is `inconclusive`, never gated.
 *  - High variance (cv > maxCv) marks the comparison inconclusive.
 *  - A regression requires BOTH the percent threshold and the absolute floor
 *    to be exceeded (small absolute wobbles on tiny metrics don't gate).
 */

import type { ThresholdSpec } from "@mssqlperf/contracts";
import { summarize, welchT, type SampleSummary } from "./statistics";

export type Verdict = "regressed" | "improved" | "unchanged" | "inconclusive";

export interface MetricKey {
    scenarioId: string;
    name: string;
    component: string;
    processRole: string;
    unit: string;
}

export interface MetricComparison {
    key: MetricKey;
    verdict: Verdict;
    baseline?: SampleSummary;
    current?: SampleSummary;
    deltaAbs?: number;
    deltaPct?: number;
    pValue?: number;
    threshold: Required<Pick<ThresholdSpec, "pct" | "absMs" | "minSamples">> & ThresholdSpec;
    reason: string;
}

export interface RunComparison {
    currentRunId: string;
    baselineRunId: string;
    status: "passed" | "regressed" | "improved" | "inconclusive";
    metrics: MetricComparison[];
    environmentMatched: boolean;
}

export interface MetricSamples {
    key: MetricKey;
    values: number[];
    lowerIsBetter: boolean;
}

const DEFAULT_THRESHOLD: Required<Pick<ThresholdSpec, "pct" | "absMs" | "minSamples">> &
    ThresholdSpec = {
    pct: 10,
    absMs: 5,
    minSamples: 3,
    maxCv: 0.2,
    test: "welchT",
    pValue: 0.05,
};

export function resolveThreshold(
    metricName: string,
    thresholds: { default?: ThresholdSpec; metrics?: Record<string, ThresholdSpec> } | undefined,
): MetricComparison["threshold"] {
    return {
        ...DEFAULT_THRESHOLD,
        ...(thresholds?.default ?? {}),
        ...(thresholds?.metrics?.[metricName] ?? {}),
    };
}

export function classifyMetric(
    key: MetricKey,
    currentValues: number[],
    baselineValues: number[],
    lowerIsBetter: boolean,
    threshold: MetricComparison["threshold"],
): MetricComparison {
    if (
        currentValues.length < threshold.minSamples ||
        baselineValues.length < threshold.minSamples
    ) {
        return {
            key,
            verdict: "inconclusive",
            threshold,
            reason: `insufficient samples (current=${currentValues.length}, baseline=${baselineValues.length}, need ${threshold.minSamples})`,
            ...(currentValues.length > 0 ? { current: summarize(currentValues) } : {}),
            ...(baselineValues.length > 0 ? { baseline: summarize(baselineValues) } : {}),
        };
    }

    const current = summarize(currentValues);
    const baseline = summarize(baselineValues);
    const deltaAbs = current.aggregate - baseline.aggregate;
    const deltaPct = baseline.aggregate !== 0 ? (deltaAbs / baseline.aggregate) * 100 : 0;

    const maxCv = threshold.maxCv ?? DEFAULT_THRESHOLD.maxCv!;
    if (current.cv > maxCv || baseline.cv > maxCv) {
        return {
            key,
            verdict: "inconclusive",
            current,
            baseline,
            deltaAbs,
            deltaPct,
            threshold,
            reason: `variance too high (cv current=${current.cv.toFixed(3)}, baseline=${baseline.cv.toFixed(3)}, max ${maxCv})`,
        };
    }

    // Direction-aware "worse" delta: for lowerIsBetter metrics, worse = larger.
    const worseAbs = lowerIsBetter ? deltaAbs : -deltaAbs;
    const worsePct = lowerIsBetter ? deltaPct : -deltaPct;

    let pValue: number | undefined;
    if (threshold.test === "welchT") {
        pValue = welchT(currentValues, baselineValues)?.pValue;
    }

    const exceedsThresholds =
        Math.abs(worsePct) >= threshold.pct && Math.abs(worseAbs) >= threshold.absMs;
    const significant =
        threshold.test !== "welchT" ||
        pValue === undefined ||
        pValue <= (threshold.pValue ?? DEFAULT_THRESHOLD.pValue!);

    let verdict: Verdict;
    let reason: string;
    if (worsePct >= threshold.pct && worseAbs >= threshold.absMs) {
        if (significant) {
            verdict = "regressed";
            reason = `worse by ${worsePct.toFixed(1)}% / ${worseAbs.toFixed(1)}${key.unit}${pValue !== undefined ? ` (p=${pValue.toFixed(4)})` : ""}`;
        } else {
            verdict = "inconclusive";
            reason = `delta exceeds thresholds but not statistically significant (p=${pValue?.toFixed(4)})`;
        }
    } else if (-worsePct >= threshold.pct && -worseAbs >= threshold.absMs && significant) {
        verdict = "improved";
        reason = `better by ${(-worsePct).toFixed(1)}% / ${(-worseAbs).toFixed(1)}${key.unit}`;
    } else {
        verdict = "unchanged";
        reason = exceedsThresholds
            ? "delta within noise"
            : `delta ${worsePct.toFixed(1)}% / ${worseAbs.toFixed(1)}${key.unit} below thresholds (${threshold.pct}% and ${threshold.absMs}${key.unit})`;
    }

    return {
        key,
        verdict,
        current,
        baseline,
        deltaAbs,
        deltaPct,
        ...(pValue !== undefined ? { pValue } : {}),
        threshold,
        reason,
    };
}

/** Worst-metric-wins run verdict over official gated metrics. */
export function overallStatus(metrics: MetricComparison[]): RunComparison["status"] {
    if (metrics.some((m) => m.verdict === "regressed")) return "regressed";
    if (metrics.length > 0 && metrics.every((m) => m.verdict === "inconclusive"))
        return "inconclusive";
    if (metrics.some((m) => m.verdict === "improved")) return "improved";
    return "passed";
}
