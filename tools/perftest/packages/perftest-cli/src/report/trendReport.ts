/**
 * Cross-run trend + local history (Phase-3 M15): time-series of official
 * metrics across runs with a rolling-baseline band and step-change
 * attribution (the run + product SHA where a metric stepped), plus the
 * history dashboard. All rendering via the shared chart/shell modules.
 */

import { writeFileSync } from "node:fs";
import type { PerfStore } from "../store/sqliteStore";
import type { HarnessLogger } from "../telemetry/logger";
import { trendChart, TOKENS } from "./charts";
import {
    chartCard,
    dataTable,
    esc,
    kpiRow,
    pageShell,
    pill,
    section,
    type PillKind,
} from "./htmlShell";

export interface TrendResult {
    series: ReturnType<PerfStore["trendSeries"]>;
    stepChange?: { runId: string; productSha: string | null; deltaPct: number; index: number };
    htmlPath?: string;
}

function nsToDate(ns: string): Date {
    return new Date(Number(BigInt(ns) / 1_000_000n));
}

/** Flag the largest consecutive step exceeding pct+abs thresholds. */
export function findStepChange(
    series: ReturnType<PerfStore["trendSeries"]>,
    thresholdPct = 10,
    thresholdAbs = 5,
): TrendResult["stepChange"] {
    let best: TrendResult["stepChange"];
    for (let i = 1; i < series.length; i++) {
        const prev = series[i - 1]!.median;
        const curr = series[i]!.median;
        const deltaAbs = Math.abs(curr - prev);
        const deltaPct = prev !== 0 ? (deltaAbs / prev) * 100 : 0;
        if (deltaPct >= thresholdPct && deltaAbs >= thresholdAbs) {
            if (!best || deltaPct > best.deltaPct) {
                best = {
                    runId: series[i]!.runId,
                    productSha: series[i]!.productSha,
                    deltaPct: Number((((curr - prev) / prev) * 100).toFixed(1)),
                    index: i,
                };
            }
        }
    }
    return best;
}

export function renderTrend(
    store: PerfStore,
    scenarioId: string,
    metricName: string,
    options: { lastN?: number; tag?: string; outPath?: string },
    logger: HarnessLogger,
): TrendResult {
    const series = store.trendSeries(scenarioId, metricName, {
        ...(options.lastN !== undefined ? { lastN: options.lastN } : {}),
        ...(options.tag !== undefined ? { tag: options.tag } : {}),
    });
    const stepChange = findStepChange(series);

    const result: TrendResult = { series, ...(stepChange ? { stepChange } : {}) };
    if (series.length === 0 || !options.outPath) {
        return result;
    }

    // Baseline band: median ± 10% of all-but-the-last run (the "expected" band).
    const prior = series
        .slice(0, -1)
        .map((s) => s.median)
        .sort((a, b) => a - b);
    const priorMedian = prior.length
        ? prior[Math.floor((prior.length - 1) / 2)]!
        : series[0]!.median;

    const points = series.map((s, i) => ({
        x: i,
        y: s.median,
        label: `${s.runId}${s.tag ? ` [${s.tag}]` : ""} — ${s.median.toFixed(1)} (${s.samples} reps)${s.productSha ? ` @${s.productSha.slice(0, 8)}` : ""}`,
    }));
    const chart = trendChart(points, {
        title: `${scenarioId} / ${metricName}`,
        xLabel: "run (chronological)",
        yLabel: metricName,
        ...(prior.length >= 2
            ? {
                  baselineBand: {
                      center: priorMedian,
                      halfWidth: priorMedian * 0.1,
                      label: `prior-runs median ±10% (${prior.length} runs)`,
                  },
              }
            : {}),
        ...(stepChange
            ? {
                  markers: [
                      {
                          x: stepChange.index,
                          label: `${stepChange.deltaPct > 0 ? "+" : ""}${stepChange.deltaPct}% @${(stepChange.productSha ?? "?").slice(0, 8)}`,
                      },
                  ],
              }
            : {}),
    });

    const rows = series.map((s, i) => [
        String(i),
        `<span class="mono">${esc(s.runId)}</span>`,
        nsToDate(s.createdAtUnixNs).toISOString().slice(0, 16).replace("T", " "),
        s.median.toFixed(1),
        String(s.samples),
        s.tag ? pill(s.tag, "info") : "—",
        `<span class="mono">${esc((s.productSha ?? "").slice(0, 10))}</span>`,
    ]);
    const html = pageShell({
        title: "perftest trend",
        subtitle: `${scenarioId} / ${metricName} · ${series.length} runs`,
        ...(stepChange
            ? {
                  statusPill: {
                      label: `step ${stepChange.deltaPct > 0 ? "+" : ""}${stepChange.deltaPct}%`,
                      kind: (stepChange.deltaPct > 0 ? "fail" : "ok") as PillKind,
                  },
              }
            : {}),
        body: [
            chartCard(
                `${metricName} across runs`,
                chart,
                stepChange
                    ? `Step change flagged at run ${stepChange.runId} (${stepChange.deltaPct > 0 ? "+" : ""}${stepChange.deltaPct}%) — product SHA ${stepChange.productSha ?? "unknown"}.`
                    : "No step change beyond thresholds (10% and 5 units).",
            ),
            `<div class="spacer"></div>`,
            section(
                "Runs",
                "",
                dataTable(
                    [
                        { label: "#" },
                        { label: "Run" },
                        { label: "When (UTC)" },
                        { label: "Median", numeric: true },
                        { label: "Reps", numeric: true },
                        { label: "Tag" },
                        { label: "vscode-mssql SHA" },
                    ],
                    rows,
                ),
            ),
        ].join("\n"),
    });
    writeFileSync(options.outPath, html, "utf8");
    logger.info("trend.written", options.outPath, { runs: series.length });
    result.htmlPath = options.outPath;
    return result;
}

export function renderHistory(store: PerfStore, outPath: string, logger: HarnessLogger): string {
    const runs = store.listRuns(50);
    const comparisons = store.recentComparisons(15);
    const baselines = store.listBaselines();

    const statusKind = (status: string): PillKind =>
        status === "passed" || status === "improved"
            ? "ok"
            : status === "failed" || status === "regressed"
              ? "fail"
              : "warn";

    // Trend charts for the scenarios with the most runs.
    const scenarioCounts = store.query<{ scenario_id: string; n: number }>(
        `SELECT scenario_id, COUNT(DISTINCT run_id) AS n FROM repetitions
     WHERE warmup = 0 GROUP BY scenario_id ORDER BY n DESC LIMIT 4`,
    );
    const trendCards: string[] = [];
    for (const { scenario_id } of scenarioCounts) {
        const series = store.trendSeries(scenario_id, "scenario.wallclock", { lastN: 30 });
        if (series.length < 2) continue;
        const step = findStepChange(series);
        trendCards.push(
            chartCard(
                `${scenario_id} — scenario.wallclock`,
                trendChart(
                    series.map((s, i) => ({
                        x: i,
                        y: s.median,
                        label: `${s.runId} — ${s.median.toFixed(1)}ms (${s.samples} reps)`,
                    })),
                    {
                        title: scenario_id,
                        xLabel: "run",
                        yLabel: "ms",
                        width: 560,
                        height: 190,
                        ...(step
                            ? {
                                  markers: [
                                      {
                                          x: step.index,
                                          label: `${step.deltaPct > 0 ? "+" : ""}${step.deltaPct}%`,
                                      },
                                  ],
                              }
                            : {}),
                    },
                ),
            ),
        );
    }

    const html = pageShell({
        title: "perftest history",
        subtitle: `${runs.length} recent runs · local store`,
        body: [
            kpiRow([
                { label: "Runs (recent)", value: String(runs.length) },
                {
                    label: "Regressions (recent comparisons)",
                    value: String(comparisons.filter((c) => c.status === "regressed").length),
                    kind: comparisons.some((c) => c.status === "regressed") ? "fail" : "ok",
                },
                { label: "Named baselines", value: String(baselines.length) },
                {
                    label: "Environments (recent)",
                    value: String(new Set(runs.map((r) => r.environmentHash)).size),
                },
            ]),
            trendCards.length > 0
                ? section(
                      "Trends",
                      "per-scenario official wallclock, last 30 runs",
                      `<div class="chart-grid">${trendCards.join("")}</div>`,
                  )
                : "",
            section(
                "Recent runs",
                "",
                dataTable(
                    [
                        { label: "Run" },
                        { label: "When (UTC)" },
                        { label: "Pass" },
                        { label: "Status" },
                        { label: "Tag" },
                        { label: "Environment" },
                    ],
                    runs.map((r) => [
                        `<span class="mono">${esc(r.runId)}</span>`,
                        nsToDate(r.createdAtUnixNs).toISOString().slice(0, 16).replace("T", " "),
                        r.passType,
                        pill(r.status, statusKind(r.status)),
                        r.tag ? pill(r.tag, "info") : "—",
                        `<span class="mono muted">${esc(r.environmentHash.slice(0, 18))}…</span>`,
                    ]),
                ),
            ),
            section(
                "Recent comparisons",
                "",
                comparisons.length
                    ? dataTable(
                          [{ label: "Current" }, { label: "Baseline" }, { label: "Verdict" }],
                          comparisons.map((c) => [
                              `<span class="mono">${esc(c.currentRunId)}</span>`,
                              `<span class="mono">${esc(c.baselineRunId)}</span>`,
                              pill(c.status, statusKind(c.status)),
                          ]),
                      )
                    : `<p class="muted">none yet</p>`,
                { open: false },
            ),
            section(
                "Named baselines",
                "",
                baselines.length
                    ? dataTable(
                          [
                              { label: "Name" },
                              { label: "Scenario" },
                              { label: "Run" },
                              { label: "Environment" },
                          ],
                          baselines.map((b) => [
                              pill(b.name, "info"),
                              esc(b.scenarioId),
                              `<span class="mono">${esc(b.runId)}</span>`,
                              `<span class="mono muted">${esc(b.environmentHash.slice(0, 18))}…</span>`,
                          ]),
                      )
                    : `<p class="muted">none yet — perftest baseline set &lt;name&gt; &lt;runId&gt;</p>`,
                { open: false },
            ),
        ].join("\n"),
    });
    writeFileSync(outPath, html, "utf8");
    logger.info("history.written", outPath, { runs: runs.length, charts: trendCards.length });
    void TOKENS;
    return outPath;
}
