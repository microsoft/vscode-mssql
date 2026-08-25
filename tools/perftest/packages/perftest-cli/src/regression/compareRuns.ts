/**
 * Run comparison orchestration (design §24.3): resolve the baseline, enforce
 * environment-hash matching, classify every official metric key, persist to
 * SQLite, and write comparison.json into the current run's directory.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ThresholdSpec } from "@mssqlperf/contracts";
import type { PerfStore } from "../store/sqliteStore";
import type { HarnessLogger } from "../telemetry/logger";
import {
    classifyMetric,
    overallStatus,
    resolveThreshold,
    type MetricComparison,
    type MetricKey,
    type RunComparison,
} from "./regression";

export class CompareError extends Error {}

export interface CompareOptions {
    thresholds?: { default?: ThresholdSpec; metrics?: Record<string, ThresholdSpec> };
    /** Design default is false: cross-environment official comparison is refused. */
    allowCrossEnvironment?: boolean;
    /** Write comparison.json into the current run's output dir (default true). */
    persist?: boolean;
}

function keyOf(sample: {
    scenarioId: string;
    name: string;
    component: string;
    processRole: string;
    unit: string;
}): string {
    return [sample.scenarioId, sample.name, sample.component, sample.processRole, sample.unit].join(
        "|",
    );
}

export function compareRuns(
    store: PerfStore,
    currentRunId: string,
    baselineRef: string,
    logger: HarnessLogger,
    options: CompareOptions = {},
): RunComparison {
    const span = logger.span("compare", { currentRunId, baselineRef });

    const current = store.getRun(currentRunId);
    if (!current) {
        throw new CompareError(`Current run '${currentRunId}' not found in the store`);
    }

    // Baseline forms: explicit run id, named baseline, or "rolling:N" — the
    // pooled official samples of the last N green runs on the SAME environment
    // hash (M15.3; cuts single-run baseline noise).
    let baselineRunId = baselineRef;
    let baselineSamples: ReturnType<PerfStore["officialSamples"]>;
    let environmentMatched = true;
    const rollingMatch = /^rolling:(\d+)$/.exec(baselineRef);
    if (rollingMatch) {
        const lastN = Number(rollingMatch[1]);
        baselineSamples = store.rollingBaselineSamples(
            current.environmentHash,
            lastN,
            currentRunId,
        );
        if (baselineSamples.length === 0) {
            throw new CompareError(
                `rolling:${lastN} baseline has no prior green runs on environment ${current.environmentHash.slice(0, 18)}...`,
            );
        }
        baselineRunId = `rolling:${lastN}@${current.environmentHash.slice(0, 15)}`;
    } else {
        if (!store.getRun(baselineRef)) {
            const named = store.getBaselineRun(baselineRef);
            if (!named) {
                throw new CompareError(
                    `Baseline '${baselineRef}' is neither a run id, a named baseline, nor rolling:N`,
                );
            }
            baselineRunId = named.runId;
        }
        const baseline = store.getRun(baselineRunId);
        if (!baseline) {
            throw new CompareError(`Baseline run '${baselineRunId}' not found in the store`);
        }
        environmentMatched = current.environmentHash === baseline.environmentHash;
        if (!environmentMatched && !options.allowCrossEnvironment) {
            throw new CompareError(
                `Environment hash mismatch: current ${current.environmentHash.slice(0, 18)}... vs baseline ${baseline.environmentHash.slice(0, 18)}... ` +
                    `Official metrics are not comparable across environments (design §23.1); pass allowCrossEnvironment to override.`,
            );
        }
        baselineSamples = store.officialSamples(baselineRunId);
    }

    const currentSamples = store.officialSamples(currentRunId);

    const grouped = new Map<
        string,
        { key: MetricKey; lowerIsBetter: boolean; current: number[]; baseline: number[] }
    >();
    for (const [samples, side] of [
        [currentSamples, "current"],
        [baselineSamples, "baseline"],
    ] as const) {
        for (const sample of samples) {
            const k = keyOf(sample);
            let entry = grouped.get(k);
            if (!entry) {
                entry = {
                    key: {
                        scenarioId: sample.scenarioId,
                        name: sample.name,
                        component: sample.component,
                        processRole: sample.processRole,
                        unit: sample.unit,
                    },
                    lowerIsBetter: sample.lowerIsBetter,
                    current: [],
                    baseline: [],
                };
                grouped.set(k, entry);
            }
            entry[side].push(sample.value);
        }
    }

    const metrics: MetricComparison[] = [];
    for (const entry of grouped.values()) {
        const threshold = resolveThreshold(entry.key.name, options.thresholds);
        metrics.push(
            classifyMetric(
                entry.key,
                entry.current,
                entry.baseline,
                entry.lowerIsBetter,
                threshold,
            ),
        );
    }
    metrics.sort((a, b) => verdictRank(a.verdict) - verdictRank(b.verdict));

    const comparison: RunComparison = {
        currentRunId,
        baselineRunId,
        status: overallStatus(metrics),
        metrics,
        environmentMatched,
    };

    // Rolling baselines have no baseline run row (FK) — persist JSON only.
    if (options.persist !== false && !rollingMatch) {
        const comparisonId = store.insertComparison(
            currentRunId,
            baselineRunId,
            comparison.status,
            JSON.stringify({ status: comparison.status, environmentMatched }),
        );
        for (const m of metrics) {
            store.insertComparisonMetric(comparisonId, {
                scenarioId: m.key.scenarioId,
                metricName: m.key.name,
                component: m.key.component,
                processRole: m.key.processRole,
                unit: m.key.unit,
                official: true,
                ...(m.baseline
                    ? { baselineValue: m.baseline.aggregate, baselineSamples: m.baseline.samples }
                    : {}),
                ...(m.current
                    ? { currentValue: m.current.aggregate, currentSamples: m.current.samples }
                    : {}),
                ...(m.deltaAbs !== undefined ? { deltaAbs: m.deltaAbs } : {}),
                ...(m.deltaPct !== undefined ? { deltaPct: m.deltaPct } : {}),
                ...(m.pValue !== undefined ? { pValue: m.pValue } : {}),
                verdict: m.verdict,
                thresholdJson: JSON.stringify(m.threshold),
                detailsJson: JSON.stringify({ reason: m.reason }),
            });
        }
    }
    if (options.persist !== false) {
        try {
            writeFileSync(
                join(current.outputDir, "comparison.json"),
                JSON.stringify(comparison, null, 2),
                "utf8",
            );
        } catch (error) {
            logger.warn("compare.persistJsonFailed", String(error));
        }
    }

    span.end({ status: comparison.status, metricCount: metrics.length });
    return comparison;
}

function verdictRank(verdict: MetricComparison["verdict"]): number {
    switch (verdict) {
        case "regressed":
            return 0;
        case "inconclusive":
            return 1;
        case "improved":
            return 2;
        default:
            return 3;
    }
}

export function renderComparisonConsole(comparison: RunComparison): string {
    const lines: string[] = [];
    lines.push(`Current:  ${comparison.currentRunId}`);
    lines.push(`Baseline: ${comparison.baselineRunId}`);
    lines.push(`Status:   ${comparison.status.toUpperCase()}`);
    lines.push("");
    lines.push(
        "Scenario                  Metric                      Current      Baseline     Delta      Verdict",
    );
    lines.push(
        "------------------------- --------------------------- ------------ ------------ ---------- ------------",
    );
    for (const m of comparison.metrics) {
        const cur = m.current ? `${m.current.aggregate.toFixed(1)} ${m.key.unit}` : "—";
        const base = m.baseline ? `${m.baseline.aggregate.toFixed(1)} ${m.key.unit}` : "—";
        const delta =
            m.deltaPct !== undefined
                ? `${m.deltaPct >= 0 ? "+" : ""}${m.deltaPct.toFixed(1)}%`
                : "—";
        const verdict = m.verdict === "regressed" ? "REGRESSED" : m.verdict;
        lines.push(
            `${m.key.scenarioId.padEnd(25)} ${m.key.name.padEnd(27)} ${cur.padEnd(12)} ${base.padEnd(12)} ${delta.padEnd(10)} ${verdict}`,
        );
    }
    return lines.join("\n");
}
