/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Perf & Sessions (deep analysis over perftest runs) and History
 *  (cross-session trace aggregates). */

import { useEffect, useMemo, useState } from "react";
import {
    DcGetHistoryRequest,
    DcGetPerfSummaryRequest,
    HistorySummary,
    PerfSummary,
} from "../../../sharedInterfaces/debugConsole";
import { DeltaBars, Histogram, Sparkline, TrendChart } from "./charts";
import { EmptyState, formatDuration, Kpi, PageHeader, StatusPill } from "./common";
import { useDc } from "./state";

// ---------------------------------------------------------------------------
// Shared math
// ---------------------------------------------------------------------------

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)];
}

function percentile(values: number[], p: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

interface RunStats {
    runId: string;
    createdUtc: string;
    median: number;
    p95: number;
    min: number;
    max: number;
    n: number;
    values: number[];
}

// ---------------------------------------------------------------------------
// Perf & Sessions
// ---------------------------------------------------------------------------

export function PerfPage() {
    const { rpc } = useDc();
    const [summary, setSummary] = useState<PerfSummary | undefined>(undefined);
    const [scenario, setScenario] = useState<string>("");
    const [metric, setMetric] = useState<string>("scenario.wallclock");
    const [baselineRun, setBaselineRun] = useState<string>("");
    const [candidateRun, setCandidateRun] = useState<string>("");

    useEffect(() => {
        void rpc.sendRequest(DcGetPerfSummaryRequest.type, {}).then((result) => {
            setSummary(result);
        });
    }, [rpc]);

    // Scenario browser: always keyed on scenario.wallclock so the browser
    // stays stable while the metric selector changes.
    const scenarioCards = useMemo(() => {
        if (!summary) return [];
        const byScenario = new Map<string, Map<string, number[]>>();
        for (const sample of summary.samples) {
            if (sample.metricName !== "scenario.wallclock" || !sample.official) continue;
            const runs = byScenario.get(sample.scenarioId) ?? new Map<string, number[]>();
            const values = runs.get(sample.runId) ?? [];
            values.push(sample.value);
            runs.set(sample.runId, values);
            byScenario.set(sample.scenarioId, runs);
        }
        return [...byScenario.entries()]
            .map(([scenarioId, runs]) => {
                const series = [...runs.entries()]
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([, values]) => median(values));
                const latest = series[series.length - 1];
                const previous = series.length > 1 ? series[series.length - 2] : undefined;
                const deltaPct =
                    previous !== undefined && previous !== 0
                        ? ((latest - previous) / previous) * 100
                        : undefined;
                return { scenarioId, series, latest, deltaPct, runCount: series.length };
            })
            .sort((a, b) => b.runCount - a.runCount);
    }, [summary]);

    useEffect(() => {
        if (!scenario && scenarioCards.length > 0) {
            setScenario(scenarioCards[0].scenarioId);
        }
    }, [scenarioCards, scenario]);

    // Metrics available for the SELECTED scenario (with run counts) — the
    // dropdown never offers a metric this scenario has no data for.
    const availableMetrics = useMemo(() => {
        if (!summary) return [];
        const counts = new Map<string, Set<string>>();
        for (const sample of summary.samples) {
            if (sample.scenarioId !== scenario || !sample.official) continue;
            const runs = counts.get(sample.metricName) ?? new Set<string>();
            runs.add(sample.runId);
            counts.set(sample.metricName, runs);
        }
        return [...counts.entries()]
            .map(([name, runs]) => ({ name, runCount: runs.size }))
            .sort((a, b) => b.runCount - a.runCount || a.name.localeCompare(b.name));
    }, [summary, scenario]);

    // Keep the metric valid when the scenario changes.
    useEffect(() => {
        if (availableMetrics.length === 0) return;
        if (!availableMetrics.some((m) => m.name === metric)) {
            const fallback =
                availableMetrics.find((m) => m.name === "scenario.wallclock") ??
                availableMetrics[0];
            setMetric(fallback.name);
        }
    }, [availableMetrics, metric]);

    // Per-run stats for the selected scenario + metric.
    const runStats = useMemo<RunStats[]>(() => {
        if (!summary) return [];
        const byRun = new Map<string, { createdUtc: string; values: number[] }>();
        for (const sample of summary.samples) {
            if (sample.scenarioId !== scenario || sample.metricName !== metric || !sample.official)
                continue;
            const entry = byRun.get(sample.runId) ?? { createdUtc: sample.createdUtc, values: [] };
            entry.values.push(sample.value);
            byRun.set(sample.runId, entry);
        }
        return [...byRun.entries()]
            .map(([runId, entry]) => ({
                runId,
                createdUtc: entry.createdUtc,
                median: median(entry.values),
                p95: percentile(entry.values, 95),
                min: Math.min(...entry.values),
                max: Math.max(...entry.values),
                n: entry.values.length,
                values: entry.values,
            }))
            .sort((a, b) => a.runId.localeCompare(b.runId));
    }, [summary, scenario, metric]);

    useEffect(() => {
        if (runStats.length > 0) {
            setCandidateRun((current) =>
                current && runStats.some((r) => r.runId === current)
                    ? current
                    : runStats[runStats.length - 1].runId,
            );
            setBaselineRun((current) =>
                current && runStats.some((r) => r.runId === current)
                    ? current
                    : (runStats[runStats.length - 2]?.runId ?? runStats[0].runId),
            );
        } else {
            // No data for this scenario+metric: clear stale A/B selections so
            // nothing renders from a previous combination.
            setCandidateRun("");
            setBaselineRun("");
        }
    }, [runStats]);

    // Step change: largest consecutive median jump > 10% and > 5ms.
    const stepIndex = useMemo(() => {
        let best = -1;
        let bestPct = 10;
        for (let i = 1; i < runStats.length; i++) {
            const previous = runStats[i - 1].median;
            const current = runStats[i].median;
            const pct = previous !== 0 ? (Math.abs(current - previous) / previous) * 100 : 0;
            if (pct > bestPct && Math.abs(current - previous) > 5) {
                bestPct = pct;
                best = i;
            }
        }
        return best;
    }, [runStats]);

    // A/B deltas across all official metrics of the scenario.
    const abDeltas = useMemo(() => {
        if (!summary || !baselineRun || !candidateRun) return [];
        const metricsOf = (runId: string) => {
            const map = new Map<string, number[]>();
            for (const sample of summary.samples) {
                if (sample.scenarioId !== scenario || sample.runId !== runId || !sample.official)
                    continue;
                const values = map.get(sample.metricName) ?? [];
                values.push(sample.value);
                map.set(sample.metricName, values);
            }
            return map;
        };
        const base = metricsOf(baselineRun);
        const cand = metricsOf(candidateRun);
        const deltas: Array<{ label: string; deltaPct: number; detail: string }> = [];
        for (const [name, candValues] of cand) {
            const baseValues = base.get(name);
            if (!baseValues) continue;
            const baseMedian = median(baseValues);
            const candMedian = median(candValues);
            if (baseMedian === 0) continue;
            deltas.push({
                label: name,
                deltaPct: Number((((candMedian - baseMedian) / baseMedian) * 100).toFixed(1)),
                detail: `${formatDuration(baseMedian)} → ${formatDuration(candMedian)}`,
            });
        }
        return deltas.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct)).slice(0, 12);
    }, [summary, scenario, baselineRun, candidateRun]);

    if (!summary) {
        return <PageHeader title="Perf & Sessions" sub="Loading…" />;
    }
    if (summary.samples.length === 0) {
        return (
            <>
                <PageHeader title="Perf & Sessions" />
                <EmptyState
                    title="No perf metrics found"
                    body="Point mssql.debugConsole.perfRunsRoot at a perftest perf-runs directory (Settings page) to analyze official metrics, trends, and A/B deltas across runs."
                />
            </>
        );
    }

    const latest = runStats[runStats.length - 1];
    const previous = runStats.length > 1 ? runStats[runStats.length - 2] : undefined;
    const deltaPct =
        latest && previous && previous.median !== 0
            ? ((latest.median - previous.median) / previous.median) * 100
            : undefined;
    const prior = runStats.slice(0, -1).map((r) => r.median);
    const band =
        prior.length >= 2
            ? {
                  center: median(prior),
                  halfWidth: median(prior) * 0.1,
                  label: `prior-runs median ±10% (${prior.length} runs)`,
              }
            : undefined;

    return (
        <>
            <PageHeader
                title="Perf & Sessions"
                sub={`${summary.runs.length} runs discovered · official metrics only · ${summary.samples.length.toLocaleString()} samples`}
            />
            <div className="dc-toolbar">
                <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
                    {scenarioCards.map((card) => (
                        <option key={card.scenarioId} value={card.scenarioId}>
                            {card.scenarioId} ({card.runCount} runs)
                        </option>
                    ))}
                </select>
                <select value={metric} onChange={(e) => setMetric(e.target.value)}>
                    {availableMetrics.map((m) => (
                        <option key={m.name} value={m.name}>
                            {m.name} ({m.runCount} runs)
                        </option>
                    ))}
                </select>
                <span className="dc-muted">
                    {availableMetrics.length} metric(s) recorded for this scenario
                </span>
            </div>

            <div className="dc-kpis">
                <Kpi label="Runs (this scenario)" value={runStats.length} />
                <Kpi
                    label="Latest median"
                    value={latest ? formatDuration(latest.median) : "—"}
                    note={latest ? `${latest.n} reps` : undefined}
                />
                <Kpi
                    label="Δ vs previous"
                    value={
                        deltaPct !== undefined
                            ? `${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(1)}%`
                            : "—"
                    }
                    tone={
                        deltaPct !== undefined
                            ? deltaPct > 10
                                ? "error"
                                : deltaPct < -10
                                  ? "ok"
                                  : undefined
                            : undefined
                    }
                />
                <Kpi label="Latest p95" value={latest ? formatDuration(latest.p95) : "—"} />
                <Kpi
                    label="Best / Worst median"
                    value={
                        runStats.length > 0
                            ? `${formatDuration(Math.min(...runStats.map((r) => r.median)))} / ${formatDuration(Math.max(...runStats.map((r) => r.median)))}`
                            : "—"
                    }
                />
                <Kpi label="Scenarios" value={scenarioCards.length} />
            </div>

            <div className="dc-card">
                <div className="dc-card-title">
                    Scenario browser
                    <span className="right">scenario.wallclock · per-run medians</span>
                </div>
                <div
                    className="dc-chart-grid"
                    style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
                    {scenarioCards.map((card) => (
                        <div
                            key={card.scenarioId}
                            className="dc-card"
                            style={{
                                margin: 0,
                                cursor: "pointer",
                                outline:
                                    card.scenarioId === scenario
                                        ? "1px solid var(--dc-focus)"
                                        : undefined,
                            }}
                            onClick={() => setScenario(card.scenarioId)}>
                            <div className="dc-mono" style={{ fontSize: 11, marginBottom: 4 }}>
                                {card.scenarioId}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <Sparkline values={card.series} />
                                <div>
                                    <div style={{ fontWeight: 650, fontSize: 15 }}>
                                        {formatDuration(card.latest)}
                                    </div>
                                    {card.deltaPct !== undefined ? (
                                        <div
                                            className="dc-mono"
                                            style={{
                                                fontSize: 10.5,
                                                color:
                                                    card.deltaPct > 10
                                                        ? "var(--dc-error)"
                                                        : card.deltaPct < -10
                                                          ? "var(--dc-ok)"
                                                          : "var(--dc-muted)",
                                            }}>
                                            {Math.abs(card.deltaPct) > 999
                                                ? `${card.deltaPct > 0 ? ">+999" : "<-999"}%`
                                                : `${card.deltaPct > 0 ? "+" : ""}${card.deltaPct.toFixed(1)}%`}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {runStats.length === 0 ? (
                <div className="dc-card dc-muted">
                    No runs recorded <span className="dc-mono">{metric}</span> for{" "}
                    <span className="dc-mono">{scenario}</span> — pick another metric above (the
                    dropdown only lists recorded ones).
                </div>
            ) : (
                <>
                    <div className="dc-two-col">
                        <div className="dc-card">
                            <div className="dc-card-title">
                                Trend across runs
                                <span className="right">
                                    {stepIndex >= 0
                                        ? `step change at ${runStats[stepIndex].runId.slice(0, 20)}…`
                                        : "no step change beyond 10%"}
                                </span>
                            </div>
                            <TrendChart
                                points={runStats.map((run, index) => ({
                                    x: index,
                                    y: run.median,
                                    label: `${run.runId}\nmedian ${formatDuration(run.median)} · p95 ${formatDuration(run.p95)} · ${run.n} reps`,
                                    highlight: index === stepIndex,
                                }))}
                                {...(band ? { band } : {})}
                                onPick={(index) => setCandidateRun(runStats[index].runId)}
                            />
                            <div className="dc-muted" style={{ fontSize: 11 }}>
                                Click a point to select it as the A/B candidate. Amber = step
                                change.
                            </div>
                        </div>
                        <div className="dc-card">
                            <div className="dc-card-title">
                                Latest run distribution
                                <span className="right">{latest?.runId.slice(0, 24)}</span>
                            </div>
                            <Histogram values={latest?.values ?? []} />
                        </div>
                    </div>

                    {runStats.length >= 2 ? (
                        <div className="dc-card">
                            <div className="dc-card-title">
                                A/B comparison
                                <span className="right">
                                    official metric medians · red = slower
                                </span>
                            </div>
                            <div className="dc-toolbar">
                                <span className="dc-muted">Baseline</span>
                                <select
                                    value={baselineRun}
                                    onChange={(e) => setBaselineRun(e.target.value)}>
                                    {runStats.map((run) => (
                                        <option key={run.runId} value={run.runId}>
                                            {run.runId}
                                        </option>
                                    ))}
                                </select>
                                <span className="dc-muted">Candidate</span>
                                <select
                                    value={candidateRun}
                                    onChange={(e) => setCandidateRun(e.target.value)}>
                                    {runStats.map((run) => (
                                        <option key={run.runId} value={run.runId}>
                                            {run.runId}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <DeltaBars entries={abDeltas} />
                        </div>
                    ) : null}
                </>
            )}

            <div className="dc-card">
                <div className="dc-card-title">
                    All runs
                    <span className="right">{summary.runs.length} discovered · all statuses</span>
                </div>
                <div className="dc-table-wrap" style={{ maxHeight: 300 }}>
                    <table className="dc-table">
                        <thead>
                            <tr>
                                <th>Run</th>
                                <th>When (UTC)</th>
                                <th>Status</th>
                                <th>Pass</th>
                                <th className="num">Scenarios</th>
                                <th className="num">Median ({scenario || "—"})</th>
                            </tr>
                        </thead>
                        <tbody>
                            {[...summary.runs].reverse().map((run) => {
                                const stats = runStats.find((r) => r.runId === run.runId);
                                return (
                                    <tr
                                        key={run.runId}
                                        title={
                                            stats
                                                ? "Click to select as A/B candidate"
                                                : "No data for the selected scenario/metric"
                                        }
                                        className={run.runId === candidateRun ? "selected" : ""}
                                        onClick={() =>
                                            stats ? setCandidateRun(run.runId) : undefined
                                        }>
                                        <td className="dc-mono">{run.runId}</td>
                                        <td className="dc-mono dc-muted">
                                            {run.createdUtc.replace("T", " ").replace("Z", "")}
                                        </td>
                                        <td>
                                            <StatusPill
                                                status={
                                                    run.status === "passed"
                                                        ? "ok"
                                                        : run.status === "failed"
                                                          ? "error"
                                                          : "warning"
                                                }
                                            />
                                        </td>
                                        <td className="dc-muted">{run.passType ?? "—"}</td>
                                        <td className="num dc-mono">{run.scenarioCount}</td>
                                        <td className="num dc-mono">
                                            {stats ? formatDuration(stats.median) : "—"}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </>
    );
}

// ---------------------------------------------------------------------------
// History — cross-session trace aggregates
// ---------------------------------------------------------------------------

export function HistoryPage() {
    const {
        rpc,
        dataVersion,
        setActiveSourceId,
        setIsLive,
        navigate,
        captureMode,
        setCaptureMode,
    } = useDc();
    const [history, setHistory] = useState<HistorySummary | undefined>(undefined);

    useEffect(() => {
        void rpc.sendRequest(DcGetHistoryRequest.type).then(setHistory);
    }, [rpc, dataVersion]);

    if (!history) {
        return <PageHeader title="History" sub="Loading…" />;
    }
    if (history.sessions.length <= 1 && captureMode === "off") {
        return (
            <>
                <PageHeader title="History" />
                <EmptyState
                    title="No saved sessions yet"
                    body="Enable Session Diag capture and traces auto-save locally across VS Code sessions — then this page shows aggregates and per-action latency trends over time.">
                    <button className="dc-btn primary" onClick={() => setCaptureMode("redacted")}>
                        Enable redacted capture
                    </button>
                </EmptyState>
            </>
        );
    }
    const totalErrors = history.sessions.reduce((sum, session) => sum + session.errors, 0);
    return (
        <>
            <PageHeader
                title="History"
                sub="Aggregates and trends across locally stored sessions. Sessions auto-save while capture is on."
            />
            <div className="dc-kpis">
                <Kpi label="Sessions" value={history.sessions.length} />
                <Kpi label="Events (all)" value={history.totalEvents.toLocaleString()} />
                <Kpi label="User actions" value={history.totalActions.toLocaleString()} />
                <Kpi
                    label="Errors (all)"
                    value={totalErrors}
                    tone={totalErrors > 0 ? "error" : undefined}
                />
            </div>

            {history.trends.length > 0 ? (
                <div className="dc-chart-grid">
                    {history.trends.map((trend) => (
                        <div className="dc-card" style={{ margin: 0 }} key={trend.label}>
                            <div className="dc-card-title">
                                {trend.label}
                                <span className="right">median per session · {trend.feature}</span>
                            </div>
                            <TrendChart
                                height={150}
                                points={trend.points.map((point, index) => ({
                                    x: index,
                                    y: point.medianMs,
                                    label: `${point.sessionLabel}\n${formatDuration(point.medianMs)} median · ${point.count} occurrence(s)${point.errors > 0 ? ` · ${point.errors} error(s)` : ""}`,
                                }))}
                            />
                        </div>
                    ))}
                </div>
            ) : (
                <div className="dc-card dc-muted">
                    No repeated user actions across sessions yet — use MSSQL features with capture
                    on and trends appear here.
                </div>
            )}

            <div className="dc-card" style={{ marginTop: 12 }}>
                <div className="dc-card-title">Stored sessions</div>
                <div className="dc-table-wrap" style={{ border: "none" }}>
                    <table className="dc-table">
                        <thead>
                            <tr>
                                <th>Session</th>
                                <th>Created (UTC)</th>
                                <th className="num">Events</th>
                                <th className="num">Actions</th>
                                <th className="num">Errors</th>
                                <th className="num">Gaps</th>
                                <th>Capture</th>
                            </tr>
                        </thead>
                        <tbody>
                            {[...history.sessions].reverse().map((session) => (
                                <tr
                                    key={session.sourceId}
                                    onClick={() => {
                                        setActiveSourceId(session.sourceId);
                                        setIsLive(session.live);
                                        navigate({ page: "trace" });
                                    }}>
                                    <td>
                                        {session.live ? (
                                            <span
                                                className="dc-live-dot"
                                                style={{ display: "inline-block", marginRight: 6 }}
                                            />
                                        ) : null}
                                        {session.label}
                                    </td>
                                    <td className="dc-mono dc-muted">
                                        {session.createdUtc.slice(0, 16).replace("T", " ")}
                                    </td>
                                    <td className="num dc-mono">
                                        {session.events.toLocaleString()}
                                    </td>
                                    <td className="num dc-mono">{session.actionCount}</td>
                                    <td className="num dc-mono">{session.errors}</td>
                                    <td className="num dc-mono">{session.gaps}</td>
                                    <td>
                                        <span className="dc-pill diag">{session.captureMode}</span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </>
    );
}
