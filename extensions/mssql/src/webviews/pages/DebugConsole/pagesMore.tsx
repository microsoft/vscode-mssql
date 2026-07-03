/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Feature + session pages: Perf & Sessions, SQL Activity, Connections,
 *  Query & Results, Object Explorer, Exports, Settings, and gated stubs. */

import { useEffect, useMemo, useState } from "react";
import {
    DcExportRequest,
    DcGetPerfSummaryRequest,
    DcGetSqlActivityRequest,
    DcQueryEventsRequest,
    DiagEvent,
    PerfSummary,
    SqlActivityRow,
} from "../../../sharedInterfaces/debugConsole";
import {
    EmptyState,
    formatDuration,
    formatTime,
    Kpi,
    PageHeader,
    RedactedField,
    StatusPill,
} from "./common";
import { useDc } from "./state";

export function GatedPage({ title, body }: { title: string; body: string }) {
    return (
        <>
            <PageHeader title={title} />
            <EmptyState title={`${title} is gated in this build`} body={body}>
                <span className="dc-pill blocked">blocked · honest gating beats fake fidelity</span>
            </EmptyState>
        </>
    );
}

// ---------------------------------------------------------------------------
// Perf & Sessions — trend + distribution from perf-runs imports
// ---------------------------------------------------------------------------

export function PerfPage() {
    const { rpc } = useDc();
    const [summary, setSummary] = useState<PerfSummary | undefined>(undefined);
    const [scenario, setScenario] = useState<string>("");
    const [metric, setMetric] = useState<string>("scenario.wallclock");

    useEffect(() => {
        void rpc.sendRequest(DcGetPerfSummaryRequest.type, {}).then((s) => {
            setSummary(s);
            if (s.scenarios.length > 0 && !scenario) {
                setScenario(s.scenarios[0]);
            }
        });
    }, [rpc]);

    const series = useMemo(() => {
        if (!summary) return [];
        const byRun = new Map<string, number[]>();
        for (const sample of summary.samples) {
            if (sample.scenarioId !== scenario || sample.metricName !== metric || !sample.official)
                continue;
            const list = byRun.get(sample.runId) ?? [];
            list.push(sample.value);
            byRun.set(sample.runId, list);
        }
        return [...byRun.entries()]
            .map(([runId, values]) => {
                const sorted = [...values].sort((a, b) => a - b);
                return {
                    runId,
                    median: sorted[Math.floor((sorted.length - 1) / 2)],
                    n: sorted.length,
                };
            })
            .sort((a, b) => a.runId.localeCompare(b.runId));
    }, [summary, scenario, metric]);

    if (!summary || summary.samples.length === 0) {
        return (
            <>
                <PageHeader title="Perf & Sessions" />
                <EmptyState
                    title="No perf metrics found"
                    body="Point mssql.debugConsole.perfRunsRoot at a perftest perf-runs directory (Settings page) to analyze official metrics, trends, and distributions across runs."
                />
            </>
        );
    }

    const values = series.map((point) => point.median);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const latest = values[values.length - 1];
    const median = [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)];

    const width = 640;
    const height = 180;
    const pad = { l: 50, r: 12, t: 12, b: 24 };
    const toX = (index: number) =>
        pad.l + (index / Math.max(1, series.length - 1)) * (width - pad.l - pad.r);
    const toY = (value: number) =>
        height - pad.b - ((value - min) / Math.max(1, max - min)) * (height - pad.t - pad.b);

    return (
        <>
            <PageHeader
                title="Perf & Sessions"
                sub="Official metrics across imported perf runs. Official metrics gate; diagnostic metrics explain."
            />
            <div className="dc-toolbar">
                <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
                    {summary.scenarios.map((s) => (
                        <option key={s}>{s}</option>
                    ))}
                </select>
                <select value={metric} onChange={(e) => setMetric(e.target.value)}>
                    {summary.metrics.map((m) => (
                        <option key={m}>{m}</option>
                    ))}
                </select>
            </div>
            <div className="dc-kpis">
                <Kpi label="Runs" value={series.length} />
                <Kpi
                    label="Latest median"
                    value={latest !== undefined ? formatDuration(latest) : "—"}
                />
                <Kpi
                    label="All-runs median"
                    value={median !== undefined ? formatDuration(median) : "—"}
                />
                <Kpi label="Min / Max" value={`${formatDuration(min)} / ${formatDuration(max)}`} />
            </div>
            <div className="dc-card">
                <div className="dc-card-title">
                    {scenario} · {metric}
                    <span className="right">per-run medians · official only</span>
                </div>
                {series.length < 2 ? (
                    <span className="dc-muted">Need at least two runs for a trend.</span>
                ) : (
                    <svg
                        viewBox={`0 0 ${width} ${height}`}
                        width="100%"
                        role="img"
                        aria-label={`Trend of ${metric} for ${scenario}: ${series.length} runs from ${formatDuration(min)} to ${formatDuration(max)}`}>
                        <line
                            x1={pad.l}
                            y1={height - pad.b}
                            x2={width - pad.r}
                            y2={height - pad.b}
                            stroke="var(--dc-border)"
                        />
                        <text
                            x={pad.l - 6}
                            y={toY(max) + 4}
                            textAnchor="end"
                            fontSize="10"
                            fill="var(--dc-muted)">
                            {formatDuration(max)}
                        </text>
                        <text
                            x={pad.l - 6}
                            y={toY(min) + 4}
                            textAnchor="end"
                            fontSize="10"
                            fill="var(--dc-muted)">
                            {formatDuration(min)}
                        </text>
                        <polyline
                            fill="none"
                            stroke="var(--dc-link)"
                            strokeWidth="1.5"
                            points={series
                                .map((point, index) => `${toX(index)},${toY(point.median)}`)
                                .join(" ")}
                        />
                        {series.map((point, index) => (
                            <circle
                                key={point.runId}
                                cx={toX(index)}
                                cy={toY(point.median)}
                                r="3"
                                fill="var(--dc-text)">
                                <title>
                                    {point.runId}: {formatDuration(point.median)} ({point.n} reps)
                                </title>
                            </circle>
                        ))}
                    </svg>
                )}
            </div>
            <div className="dc-table-wrap">
                <table className="dc-table">
                    <thead>
                        <tr>
                            <th>Run</th>
                            <th className="num">Median</th>
                            <th className="num">Reps</th>
                        </tr>
                    </thead>
                    <tbody>
                        {[...series].reverse().map((point) => (
                            <tr key={point.runId}>
                                <td className="dc-mono">{point.runId}</td>
                                <td className="num dc-mono">{formatDuration(point.median)}</td>
                                <td className="num dc-mono">{point.n}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </>
    );
}

// ---------------------------------------------------------------------------
// SQL Activity
// ---------------------------------------------------------------------------

export function SqlActivityPage() {
    const { rpc, activeSourceId, dataVersion } = useDc();
    const [rows, setRows] = useState<SqlActivityRow[]>([]);
    const [selected, setSelected] = useState<SqlActivityRow | undefined>(undefined);

    useEffect(() => {
        void rpc
            .sendRequest(DcGetSqlActivityRequest.type, { sourceId: activeSourceId })
            .then(setRows);
    }, [rpc, activeSourceId, dataVersion]);

    if (rows.length === 0) {
        return (
            <>
                <PageHeader title="SQL Activity" />
                <EmptyState
                    title="No SQL activity in this source"
                    body="SQL Server command capture arrives via imported perf runs (XEvents artifacts) today; live server-side capture is gated on capture-policy hardening. Extension-side query events appear in Consolidated Trace."
                />
            </>
        );
    }
    const totalMs = rows.reduce((sum, row) => sum + (row.durationMs ?? 0), 0);
    const reads = rows.reduce((sum, row) => sum + (row.logicalReads ?? 0), 0);
    return (
        <>
            <PageHeader title="SQL Activity" />
            <div className="dc-kpis">
                <Kpi label="Commands" value={rows.length} />
                <Kpi label="Total duration" value={formatDuration(totalMs)} />
                <Kpi label="Logical reads" value={reads.toLocaleString()} />
                <Kpi
                    label="Rows"
                    value={rows.reduce((sum, row) => sum + (row.rowCount ?? 0), 0).toLocaleString()}
                />
            </div>
            <div className="dc-split" style={{ height: "calc(100vh - 260px)" }}>
                <div className="dc-table-wrap">
                    <table className="dc-table">
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>Event</th>
                                <th className="num">Duration</th>
                                <th className="num">CPU</th>
                                <th className="num">Reads</th>
                                <th className="num">Rows</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, index) => (
                                <tr
                                    key={index}
                                    className={selected === row ? "selected" : ""}
                                    onClick={() => setSelected(row)}>
                                    <td className="dc-mono">{formatTime(row.epochMs)}</td>
                                    <td className="dc-mono">{row.eventName}</td>
                                    <td className="num dc-mono">
                                        {formatDuration(row.durationMs)}
                                    </td>
                                    <td className="num dc-mono">{formatDuration(row.cpuMs)}</td>
                                    <td className="num dc-mono">
                                        {row.logicalReads?.toLocaleString() ?? "—"}
                                    </td>
                                    <td className="num dc-mono">
                                        {row.rowCount?.toLocaleString() ?? "—"}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="dc-detail">
                    <div className="dc-detail-body">
                        {selected ? (
                            <>
                                <div className="dc-card-title">SQL text</div>
                                <div style={{ marginBottom: 10 }}>
                                    <RedactedField value={selected.text} />
                                </div>
                                <div className="dc-kv">
                                    <span className="k">Duration</span>
                                    <span className="v">{formatDuration(selected.durationMs)}</span>
                                    <span className="k">CPU</span>
                                    <span className="v">{formatDuration(selected.cpuMs)}</span>
                                    <span className="k">Logical reads</span>
                                    <span className="v">
                                        {selected.logicalReads?.toLocaleString() ?? "—"}
                                    </span>
                                    <span className="k">Rows</span>
                                    <span className="v">
                                        {selected.rowCount?.toLocaleString() ?? "—"}
                                    </span>
                                    <span className="k">Correlation</span>
                                    <span className="v">{selected.correlation ?? "—"}</span>
                                </div>
                            </>
                        ) : (
                            <span className="dc-muted">Select a command.</span>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}

// ---------------------------------------------------------------------------
// Feature pages built on filtered trace queries
// ---------------------------------------------------------------------------

function useFeatureEvents(features: string[]): DiagEvent[] {
    const { rpc, activeSourceId, dataVersion } = useDc();
    const [events, setEvents] = useState<DiagEvent[]>([]);
    useEffect(() => {
        void rpc
            .sendRequest(DcQueryEventsRequest.type, {
                sourceId: activeSourceId,
                features,
                limit: 1000,
            })
            .then((result) =>
                setEvents(result.rows.filter((row): row is DiagEvent => row.kind !== "gap")),
            );
    }, [rpc, activeSourceId, dataVersion]);
    return events;
}

function FeatureEventTable({ events }: { events: DiagEvent[] }) {
    return (
        <div className="dc-table-wrap">
            <table className="dc-table">
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>Type</th>
                        <th className="num">Duration</th>
                        <th>Status</th>
                        <th>Corr</th>
                    </tr>
                </thead>
                <tbody>
                    {events.slice(-200).map((event) => (
                        <tr key={event.eventId}>
                            <td className="dc-mono">{formatTime(event.epochMs)}</td>
                            <td className="dc-mono">{event.type}</td>
                            <td className="num dc-mono">{formatDuration(event.durationMs)}</td>
                            <td>
                                <StatusPill status={event.status} />
                            </td>
                            <td className="dc-mono dc-muted">
                                {event.traceId ? `${event.traceId.slice(0, 16)}…` : "—"}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function ConnectionsPage() {
    const events = useFeatureEvents(["connection", "rpc"]);
    const ready = events.filter((e) => e.type === "mssql.connection.ready");
    const failures = events.filter((e) => e.status === "error");
    return (
        <>
            <PageHeader title="Connections" sub="Connection lifecycle, STS RPCs, and failures." />
            <div className="dc-kpis">
                <Kpi label="Connections ready" value={ready.length} />
                <Kpi
                    label="Failures"
                    value={failures.length}
                    tone={failures.length > 0 ? "error" : undefined}
                />
                <Kpi label="Lifecycle events" value={events.length} />
            </div>
            <FeatureEventTable events={events} />
        </>
    );
}

export function QueryResultsPage() {
    const events = useFeatureEvents(["query", "resultsGrid"]);
    const complete = events.filter((e) => e.type === "mssql.query.complete");
    const renders = events.filter((e) => e.type === "mssql.resultsGrid.renderComplete");
    const windowFetches = events.filter((e) => e.type.startsWith("mssql.resultsGrid.windowFetch"));
    const lastRowCount = complete
        .map((e) => e.payload?.["rowCount"]?.v)
        .filter((v): v is number => typeof v === "number")
        .pop();
    return (
        <>
            <PageHeader
                title="Query & Results"
                sub="Query execution, grid rendering, virtual windowing."
            />
            <div className="dc-kpis">
                <Kpi label="Queries completed" value={complete.length} />
                <Kpi label="Grid renders" value={renders.length} />
                <Kpi
                    label="Window fetches"
                    value={windowFetches.length / 2 >= 1 ? Math.floor(windowFetches.length / 2) : 0}
                    note={windowFetches.length > 0 ? "virtual windowing active" : undefined}
                />
                <Kpi label="Last row count" value={lastRowCount?.toLocaleString() ?? "—"} />
            </div>
            <FeatureEventTable events={events} />
        </>
    );
}

export function ObjectExplorerPage() {
    const events = useFeatureEvents(["objectExplorer"]);
    const expands = events.filter((e) => e.type === "mssql.oe.expand.end");
    const counts = expands
        .map((e) => e.payload?.["childCount"]?.v)
        .filter((v): v is number => typeof v === "number");
    return (
        <>
            <PageHeader
                title="Object Explorer"
                sub="Tree expansion, node counts, and metadata query cost."
            />
            <div className="dc-kpis">
                <Kpi label="Expansions" value={expands.length} />
                <Kpi
                    label="Largest node"
                    value={counts.length > 0 ? Math.max(...counts).toLocaleString() : "—"}
                    note="children"
                />
                <Kpi label="OE events" value={events.length} />
            </div>
            <FeatureEventTable events={events} />
        </>
    );
}

export function ExportsPage() {
    const { rpc, activeSourceId } = useDc();
    const [last, setLast] = useState<string | undefined>(undefined);
    return (
        <>
            <PageHeader
                title="Exports"
                sub="Redacted, local evidence for bug reports and agents."
            />
            <div className="dc-card">
                <div className="dc-card-title">Export current source</div>
                <p className="dc-muted" style={{ marginTop: 0 }}>
                    Exports the selected source's events as redacted JSONL. Redaction is applied at
                    capture time — raw sensitive values are never present in the export. Bundle
                    export (zip + manifest + privacy report + validation) lands in the next
                    iteration.
                </p>
                <button
                    className="dc-btn primary"
                    onClick={() => {
                        void rpc
                            .sendRequest(DcExportRequest.type, { sourceId: activeSourceId })
                            .then((result) => {
                                setLast(
                                    result.error
                                        ? `Export ${result.error}`
                                        : `Exported ${result.events} events (${result.redactions} redactions) → ${result.path}`,
                                );
                            });
                    }}>
                    ⇩ Export events (redacted JSONL)
                </button>
                {last ? (
                    <div className="dc-mono dc-muted" style={{ marginTop: 8 }}>
                        {last}
                    </div>
                ) : null}
            </div>
        </>
    );
}

export function SettingsPage() {
    const { captureMode, setCaptureMode, state } = useDc();
    return (
        <>
            <PageHeader title="Settings" sub="Capture, retention, storage, privacy." />
            <div className="dc-card">
                <div className="dc-card-title">Session Diag capture</div>
                <div className="dc-kv" style={{ marginBottom: 10 }}>
                    <span className="k">Current mode</span>
                    <span className="v">{captureMode}</span>
                    <span className="k">Storage</span>
                    <span className="v">local only · never uploaded</span>
                    <span className="k">Hard rule</span>
                    <span className="v">secrets/connection strings never persisted</span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                    <button className="dc-btn" onClick={() => setCaptureMode("redacted")}>
                        Enable (redacted)
                    </button>
                    <button className="dc-btn" onClick={() => setCaptureMode("digest")}>
                        Enable (digest)
                    </button>
                    <button className="dc-btn" onClick={() => setCaptureMode("off")}>
                        Disable
                    </button>
                </div>
            </div>
            <div className="dc-card">
                <div className="dc-card-title">Retention &amp; storage</div>
                <p className="dc-muted" style={{ margin: 0 }}>
                    Retention caps live in VS Code settings:{" "}
                    <span className="dc-mono">mssql.sessionDiag.maxSessions</span> (default 10) and{" "}
                    <span className="dc-mono">mssql.sessionDiag.maxAgeDays</span> (default 14).
                    Clear all local diagnostics via the command palette:{" "}
                    <span className="dc-mono">MS SQL: Session Diagnostics: Clear Local Data</span>.
                </p>
            </div>
            <div className="dc-card">
                <div className="dc-card-title">Perf runs</div>
                <p className="dc-muted" style={{ margin: 0 }}>
                    Set <span className="dc-mono">mssql.debugConsole.perfRunsRoot</span> to your
                    perftest <span className="dc-mono">perf-runs</span> directory to light up Perf
                    &amp; Sessions, or use "Import perf run…" on the Overview page for a single run.
                </p>
            </div>
            <div className="dc-card">
                <div className="dc-card-title">Experimental</div>
                <div className="dc-kv">
                    <span className="k">STS2 live source</span>
                    <span className="v">
                        <span className="dc-pill blocked">gated on STS2 hardening</span>
                    </span>
                    <span className="k">Replay Lab</span>
                    <span className="v">
                        <span className="dc-pill blocked">gated · completions adapter first</span>
                    </span>
                    <span className="k">Fixture mode</span>
                    <span className="v">{state?.fixtureMode ? "on" : "off"}</span>
                </div>
            </div>
        </>
    );
}
