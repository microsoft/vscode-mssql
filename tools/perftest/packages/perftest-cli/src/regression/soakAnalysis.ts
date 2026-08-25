/**
 * Soak/stress analysis (Phase-2 M10.2). Pure functions, unit-tested — these
 * verdicts make leak/reliability claims, the #1 fabrication risk of Phase 2.
 *
 * Honesty rules:
 *  - Leak verdicts resolve to stable | growing | inconclusive, and every one
 *    carries slope + 95% CI + R² + sample count. Thin or noisy data ⇒
 *    inconclusive, never "no leak".
 *  - Reliability numbers are real counts of real outcomes. Nothing is
 *    suppressed, retried away, or rounded.
 */

import type { Marker, Metric } from "@mssqlperf/contracts";
import { quantile } from "./statistics";

// ---------------------------------------------------------------------------
// Iteration records (from iteration.start/iteration.end markers)
// ---------------------------------------------------------------------------

export interface IterationRecord {
    index: number;
    warmup: boolean;
    status: "passed" | "failed";
    durationMs: number;
    errorKind?: string;
    startUnixNs: string;
    endUnixNs: string;
}

/** Pair iteration.start/end markers (by attrs.index) into records. */
export function extractIterations(markers: Marker[]): IterationRecord[] {
    const starts = new Map<number, Marker>();
    const records: IterationRecord[] = [];
    for (const marker of markers) {
        const index = Number(marker.attrs?.["index"]);
        if (!Number.isInteger(index)) continue;
        if (marker.name === "iteration.start") {
            starts.set(index, marker);
        } else if (marker.name === "iteration.end") {
            const start = starts.get(index);
            if (!start) continue;
            const samePlane =
                start.process.pid === marker.process.pid && start.monotonicNs && marker.monotonicNs;
            const durationMs = samePlane
                ? Number(
                      BigInt(marker.monotonicNs as string) - BigInt(start.monotonicNs as string),
                  ) / 1e6
                : Number(BigInt(marker.timestampUnixNs) - BigInt(start.timestampUnixNs)) / 1e6;
            const record: IterationRecord = {
                index,
                warmup: marker.attrs?.["warmup"] === true,
                status: marker.attrs?.["status"] === "failed" ? "failed" : "passed",
                durationMs,
                startUnixNs: start.timestampUnixNs,
                endUnixNs: marker.timestampUnixNs,
            };
            const errorKind = marker.attrs?.["errorKind"];
            if (typeof errorKind === "string") record.errorKind = errorKind;
            records.push(record);
        }
    }
    return records.sort((a, b) => a.index - b.index);
}

// ---------------------------------------------------------------------------
// Least squares with confidence interval
// ---------------------------------------------------------------------------

export interface LinearFit {
    slope: number;
    intercept: number;
    r2: number;
    /** 95% CI half-width of the slope (normal approximation, n>=8). */
    slopeCi95: number;
    n: number;
}

export function linearFit(points: Array<{ x: number; y: number }>): LinearFit | undefined {
    const n = points.length;
    if (n < 3) return undefined;
    const meanX = points.reduce((s, p) => s + p.x, 0) / n;
    const meanY = points.reduce((s, p) => s + p.y, 0) / n;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const p of points) {
        sxx += (p.x - meanX) ** 2;
        sxy += (p.x - meanX) * (p.y - meanY);
        syy += (p.y - meanY) ** 2;
    }
    if (sxx === 0) return undefined;
    const slope = sxy / sxx;
    const intercept = meanY - slope * meanX;
    const ssRes = points.reduce((s, p) => s + (p.y - (intercept + slope * p.x)) ** 2, 0);
    const r2 = syy === 0 ? 1 : 1 - ssRes / syy;
    const se = n > 2 ? Math.sqrt(ssRes / (n - 2) / sxx) : 0;
    return { slope, intercept, r2, slopeCi95: 1.96 * se, n };
}

// ---------------------------------------------------------------------------
// Soak analysis
// ---------------------------------------------------------------------------

export type LeakVerdict = "stable" | "growing" | "inconclusive";

export interface SoakAnalysis {
    latency: {
        p50Ms: number;
        p95Ms: number;
        /** ms per iteration over the steady-state window. */
        slopeMsPerIteration?: number;
        slopeCi95?: number;
    };
    reliability: {
        iterations: number;
        steadyStateIterations: number;
        failures: number;
        failureRate: number;
        firstFailureIndex?: number;
        errorTaxonomy: Record<string, number>;
    };
    memory?: {
        verdict: LeakVerdict;
        reason: string;
        slopeBytesPerIteration?: number;
        slopeCi95?: number;
        r2?: number;
        samples: number;
        totalGrowthMb?: number;
    };
}

export interface SoakMemoryPoint {
    /** Iteration index the sample falls in (interpolated by timestamp). */
    iteration: number;
    bytes: number;
}

export interface SoakThresholds {
    /** Minimum steady-state memory samples for any leak verdict. */
    minMemorySamples: number;
    /** Slope below this (bytes/iteration, upper CI) counts as stable. */
    stableSlopeBytesPerIteration: number;
}

export const DEFAULT_SOAK_THRESHOLDS: SoakThresholds = {
    minMemorySamples: 20,
    stableSlopeBytesPerIteration: 2048,
};

export function analyzeSoak(
    iterations: IterationRecord[],
    memorySeries: SoakMemoryPoint[],
    thresholds: SoakThresholds = DEFAULT_SOAK_THRESHOLDS,
): SoakAnalysis {
    const steady = iterations.filter((i) => !i.warmup);
    const durations = steady.map((i) => i.durationMs).sort((a, b) => a - b);
    const failures = steady.filter((i) => i.status === "failed");
    const taxonomy: Record<string, number> = {};
    for (const failure of failures) {
        const kind = failure.errorKind ?? "unknown";
        taxonomy[kind] = (taxonomy[kind] ?? 0) + 1;
    }

    const latencyFit = linearFit(
        steady.filter((i) => i.status === "passed").map((i) => ({ x: i.index, y: i.durationMs })),
    );

    const analysis: SoakAnalysis = {
        latency: {
            p50Ms: durations.length ? Number(quantile(durations, 0.5).toFixed(2)) : NaN,
            p95Ms: durations.length ? Number(quantile(durations, 0.95).toFixed(2)) : NaN,
            ...(latencyFit
                ? {
                      slopeMsPerIteration: Number(latencyFit.slope.toFixed(4)),
                      slopeCi95: Number(latencyFit.slopeCi95.toFixed(4)),
                  }
                : {}),
        },
        reliability: {
            iterations: iterations.length,
            steadyStateIterations: steady.length,
            failures: failures.length,
            failureRate: steady.length ? Number((failures.length / steady.length).toFixed(4)) : 0,
            ...(failures.length > 0 ? { firstFailureIndex: failures[0]!.index } : {}),
            errorTaxonomy: taxonomy,
        },
    };

    // --- Memory leak classification -------------------------------------------
    const warmupMax = iterations.filter((i) => i.warmup).length
        ? Math.max(...iterations.filter((i) => i.warmup).map((i) => i.index))
        : -1;
    const steadyMemory = memorySeries.filter((p) => p.iteration > warmupMax);
    if (steadyMemory.length === 0) {
        return analysis;
    }
    if (steadyMemory.length < thresholds.minMemorySamples) {
        analysis.memory = {
            verdict: "inconclusive",
            reason: `only ${steadyMemory.length} steady-state memory samples (need ${thresholds.minMemorySamples})`,
            samples: steadyMemory.length,
        };
        return analysis;
    }
    const fit = linearFit(steadyMemory.map((p) => ({ x: p.iteration, y: p.bytes })));
    if (!fit) {
        analysis.memory = {
            verdict: "inconclusive",
            reason: "memory series has no iteration spread",
            samples: steadyMemory.length,
        };
        return analysis;
    }
    const lower = fit.slope - fit.slopeCi95;
    const upper = fit.slope + fit.slopeCi95;
    const first = steadyMemory[0]!.bytes;
    const last = steadyMemory[steadyMemory.length - 1]!.bytes;
    const totalGrowthMb = Number(((last - first) / 1024 / 1024).toFixed(2));

    let verdict: LeakVerdict;
    let reason: string;
    if (lower > thresholds.stableSlopeBytesPerIteration) {
        verdict = "growing";
        reason = `slope ${fmtBytes(fit.slope)}/iter (95% CI lower bound ${fmtBytes(lower)}) exceeds the ${fmtBytes(thresholds.stableSlopeBytesPerIteration)}/iter stability threshold`;
    } else if (upper < thresholds.stableSlopeBytesPerIteration) {
        verdict = "stable";
        reason = `slope ${fmtBytes(fit.slope)}/iter with 95% CI upper bound ${fmtBytes(upper)} below the stability threshold`;
    } else {
        verdict = "inconclusive";
        reason = `95% CI [${fmtBytes(lower)}, ${fmtBytes(upper)}]/iter straddles the stability threshold — cannot conclude`;
    }
    analysis.memory = {
        verdict,
        reason,
        slopeBytesPerIteration: Number(fit.slope.toFixed(1)),
        slopeCi95: Number(fit.slopeCi95.toFixed(1)),
        r2: Number(fit.r2.toFixed(4)),
        samples: steadyMemory.length,
        totalGrowthMb,
    };
    return analysis;
}

function fmtBytes(bytes: number): string {
    const abs = Math.abs(bytes);
    if (abs >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
    if (abs >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${bytes.toFixed(0)}B`;
}

/** Map RSS counter markers to iteration indices by timestamp. */
export function memorySeriesFromMarkers(
    markers: Marker[],
    iterations: IterationRecord[],
    counterName = "exthost.memory.rss",
): SoakMemoryPoint[] {
    const points: SoakMemoryPoint[] = [];
    if (iterations.length === 0) return points;
    for (const marker of markers) {
        if (marker.phase !== "counter" || marker.name !== counterName) continue;
        const value = marker.attrs?.["value"];
        if (typeof value !== "number") continue;
        const ts = BigInt(marker.timestampUnixNs);
        const iteration = iterations.find(
            (i) => ts >= BigInt(i.startUnixNs) && ts <= BigInt(i.endUnixNs),
        );
        if (iteration) {
            points.push({ iteration: iteration.index, bytes: value });
        }
    }
    return points;
}

/** Turn a soak analysis into result metrics (official eligibility decided by caller). */
export function soakMetrics(analysis: SoakAnalysis, officialEligible: boolean): Metric[] {
    const metrics: Metric[] = [];
    const push = (
        name: string,
        value: number,
        unit: string,
        official: boolean,
        lowerIsBetter: boolean,
        tags?: Record<string, string | number | boolean | null>,
    ): void => {
        if (!Number.isFinite(value)) return;
        metrics.push({
            name,
            value,
            unit,
            component: "soak",
            processRole: "boundary",
            source: "marker",
            official,
            lowerIsBetter,
            ...(tags ? { tags } : {}),
        });
    };
    push("soak.latency.p50", analysis.latency.p50Ms, "ms", officialEligible, true);
    push("soak.latency.p95", analysis.latency.p95Ms, "ms", officialEligible, true);
    if (analysis.latency.slopeMsPerIteration !== undefined) {
        push(
            "soak.latency.slope",
            analysis.latency.slopeMsPerIteration,
            "ms/iter",
            officialEligible,
            true,
            {
                ci95: analysis.latency.slopeCi95 ?? null,
            },
        );
    }
    push(
        "soak.reliability.failureRate",
        analysis.reliability.failureRate,
        "ratio",
        officialEligible,
        true,
        {
            failures: analysis.reliability.failures,
            iterations: analysis.reliability.steadyStateIterations,
        },
    );
    if (analysis.memory) {
        if (analysis.memory.slopeBytesPerIteration !== undefined) {
            push(
                "soak.memory.rssSlope",
                analysis.memory.slopeBytesPerIteration,
                "B/iter",
                officialEligible,
                true,
                {
                    verdict: analysis.memory.verdict,
                    ci95: analysis.memory.slopeCi95 ?? null,
                    r2: analysis.memory.r2 ?? null,
                    samples: analysis.memory.samples,
                },
            );
        }
        if (analysis.memory.totalGrowthMb !== undefined) {
            push("soak.memory.totalGrowth", analysis.memory.totalGrowthMb, "MB", false, true, {
                verdict: analysis.memory.verdict,
            });
        }
    }
    return metrics;
}
