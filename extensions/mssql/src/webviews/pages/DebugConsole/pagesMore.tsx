/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Feature + session pages: SQL Activity, Connections, Query & Results,
 *  Object Explorer (occurrence views), Exports, Settings, and gated stubs. */

import { useEffect, useMemo, useState } from "react";
import {
    DcExportRequest,
    DcGetSqlActivityRequest,
    DcQueryEventsRequest,
    DiagEvent,
    SqlActivityRow,
    DcGetHealthRequest,
    DiagHealthSnapshot,
} from "../../../sharedInterfaces/debugConsole";
import { Sparkline } from "./charts";
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
import { CentralUploadCard } from "./centralUploadCard";

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
// Shared: occurrence extraction (begin/end pairing per trace)
// ---------------------------------------------------------------------------

function useFeatureEvents(features: string[]): DiagEvent[] {
    const { rpc, activeSourceId, dataVersion } = useDc();
    const [events, setEvents] = useState<DiagEvent[]>([]);
    useEffect(() => {
        void rpc
            .sendRequest(DcQueryEventsRequest.type, {
                sourceId: activeSourceId,
                features,
                limit: 2000,
            })
            .then((result) =>
                setEvents(result.rows.filter((row): row is DiagEvent => row.kind !== "gap")),
            );
        // features array is a constant literal per page
        // eslint-disable-next-line
    }, [rpc, activeSourceId, dataVersion]);
    return events;
}

interface Occurrence {
    startEpochMs: number;
    durationMs?: number;
    status: DiagEvent["status"];
    traceId?: string;
    endEvent: DiagEvent;
}

/** Pair begin/end types chronologically (per trace when available). */
function pairOccurrences(events: DiagEvent[], beginType: string, endType: string): Occurrence[] {
    const occurrences: Occurrence[] = [];
    const openBegins: DiagEvent[] = [];
    for (const event of events) {
        if (event.type === beginType) {
            openBegins.push(event);
        } else if (event.type === endType) {
            let beginIndex = openBegins.findIndex(
                (b) => b.traceId !== undefined && b.traceId === event.traceId,
            );
            if (beginIndex < 0 && openBegins.length > 0) {
                beginIndex = 0;
            }
            if (beginIndex >= 0) {
                const begin = openBegins.splice(beginIndex, 1)[0];
                const sameProcess =
                    begin.monotonicNs !== undefined &&
                    event.monotonicNs !== undefined &&
                    begin.process === event.process;
                const durationMs = sameProcess
                    ? Number(BigInt(event.monotonicNs!) - BigInt(begin.monotonicNs!)) / 1e6
                    : event.epochMs - begin.epochMs;
                occurrences.push({
                    startEpochMs: begin.epochMs,
                    durationMs: Number(durationMs.toFixed(1)),
                    status: event.status,
                    ...(begin.traceId !== undefined ? { traceId: begin.traceId } : {}),
                    endEvent: event,
                });
            } else {
                occurrences.push({
                    startEpochMs: event.epochMs,
                    status: event.status,
                    ...(event.traceId !== undefined ? { traceId: event.traceId } : {}),
                    endEvent: event,
                });
            }
        }
    }
    return occurrences.reverse();
}

function payloadNumber(event: DiagEvent, key: string): number | undefined {
    const value = event.payload?.[key]?.v;
    return typeof value === "number" ? value : undefined;
}

function OccurrenceTable({
    occurrences,
    extraColumns,
}: {
    occurrences: Occurrence[];
    extraColumns?: Array<{ label: string; value: (o: Occurrence) => React.ReactNode }>;
}) {
    const { navigate } = useDc();
    return (
        <div className="dc-table-wrap" style={{ maxHeight: "50vh" }}>
            <table className="dc-table">
                <thead>
                    <tr>
                        <th>Time</th>
                        <th className="num">Duration</th>
                        <th>Status</th>
                        {(extraColumns ?? []).map((column) => (
                            <th key={column.label}>{column.label}</th>
                        ))}
                        <th>Correlation</th>
                    </tr>
                </thead>
                <tbody>
                    {occurrences.map((occurrence, index) => (
                        <tr
                            key={index}
                            onClick={() =>
                                occurrence.traceId
                                    ? navigate({ page: "waterfall", traceId: occurrence.traceId })
                                    : undefined
                            }>
                            <td className="dc-mono">{formatTime(occurrence.startEpochMs)}</td>
                            <td className="num dc-mono">{formatDuration(occurrence.durationMs)}</td>
                            <td>
                                <StatusPill status={occurrence.status} />
                            </td>
                            {(extraColumns ?? []).map((column) => (
                                <td key={column.label} className="dc-mono">
                                    {column.value(occurrence)}
                                </td>
                            ))}
                            <td className="dc-mono dc-muted">
                                {occurrence.traceId ? `${occurrence.traceId.slice(0, 18)}…` : "—"}
                            </td>
                        </tr>
                    ))}
                    {occurrences.length === 0 ? (
                        <tr>
                            <td colSpan={5} className="dc-muted">
                                No occurrences in this source yet.
                            </td>
                        </tr>
                    ) : null}
                </tbody>
            </table>
        </div>
    );
}

function occurrenceKpis(occurrences: Occurrence[]): {
    count: number;
    medianMs?: number;
    p95Ms?: number;
    errors: number;
    durations: number[];
} {
    const durations = occurrences
        .map((o) => o.durationMs)
        .filter((d): d is number => d !== undefined);
    const sorted = [...durations].sort((a, b) => a - b);
    const result: ReturnType<typeof occurrenceKpis> = {
        count: occurrences.length,
        errors: occurrences.filter((o) => o.status === "error").length,
        durations: [...durations].reverse(),
    };
    if (sorted.length > 0) {
        result.medianMs = sorted[Math.floor((sorted.length - 1) / 2)];
        result.p95Ms = sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];
    }
    return result;
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
                    body="SQL Server command capture arrives via imported perf runs (XEvents artifacts) today; live server-side capture is gated on capture-policy hardening. Extension-side query events appear in Consolidated Trace and Query & Results."
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
// Connections — connection lifecycle occurrences
// ---------------------------------------------------------------------------

export function ConnectionsPage() {
    const events = useFeatureEvents(["connection", "rpc"]);
    const occurrences = useMemo(
        () => pairOccurrences(events, "mssql.connection.begin", "mssql.connection.ready"),
        [events],
    );
    const kpis = occurrenceKpis(occurrences);
    const rpcSpans = events.filter((e) => e.feature === "rpc" && e.type.endsWith(".end"));
    return (
        <>
            <PageHeader
                title="Connections"
                sub="Every connection open in this source with time-to-ready; STS RPC volume alongside."
            />
            <div className="dc-kpis">
                <Kpi label="Connections" value={kpis.count} />
                <Kpi
                    label="Median time-to-ready"
                    value={kpis.medianMs !== undefined ? formatDuration(kpis.medianMs) : "—"}
                />
                <Kpi
                    label="p95"
                    value={kpis.p95Ms !== undefined ? formatDuration(kpis.p95Ms) : "—"}
                />
                <Kpi
                    label="Failures"
                    value={kpis.errors}
                    tone={kpis.errors > 0 ? "error" : undefined}
                />
                <Kpi label="STS RPC calls" value={rpcSpans.length} />
                <div className="dc-kpi">
                    <div className="label">Ready-time trend</div>
                    <div style={{ marginTop: 8 }}>
                        <Sparkline values={kpis.durations.slice(-30)} width={140} height={30} />
                    </div>
                </div>
            </div>
            <OccurrenceTable occurrences={occurrences} />
        </>
    );
}

// ---------------------------------------------------------------------------
// Query & Results — per-query occurrences with row counts and render times
// ---------------------------------------------------------------------------

export function QueryResultsPage() {
    const events = useFeatureEvents(["query", "resultsGrid"]);
    const occurrences = useMemo(
        () => pairOccurrences(events, "mssql.query.submit", "mssql.query.complete"),
        [events],
    );
    const kpis = occurrenceKpis(occurrences);
    const rendersByTrace = useMemo(() => {
        const map = new Map<string, number>();
        for (const event of events) {
            if (event.type === "mssql.resultsGrid.renderComplete" && event.traceId) {
                const rowCount = payloadNumber(event, "rowCount");
                if (rowCount !== undefined) {
                    map.set(event.traceId, rowCount);
                }
            }
        }
        return map;
    }, [events]);
    const windowFetches = events.filter(
        (e) => e.type === "mssql.resultsGrid.windowFetch.end",
    ).length;
    return (
        <>
            <PageHeader
                title="Query & Results"
                sub="Every query execution with duration, rows, errors, and grid rendering."
            />
            <div className="dc-kpis">
                <Kpi label="Queries" value={kpis.count} />
                <Kpi
                    label="Median duration"
                    value={kpis.medianMs !== undefined ? formatDuration(kpis.medianMs) : "—"}
                />
                <Kpi
                    label="p95"
                    value={kpis.p95Ms !== undefined ? formatDuration(kpis.p95Ms) : "—"}
                />
                <Kpi
                    label="Errors"
                    value={kpis.errors}
                    tone={kpis.errors > 0 ? "error" : undefined}
                />
                <Kpi
                    label="Window fetches"
                    value={windowFetches}
                    note={windowFetches > 0 ? "virtual windowing active" : undefined}
                />
                <div className="dc-kpi">
                    <div className="label">Duration trend</div>
                    <div style={{ marginTop: 8 }}>
                        <Sparkline values={kpis.durations.slice(-30)} width={140} height={30} />
                    </div>
                </div>
            </div>
            <OccurrenceTable
                occurrences={occurrences}
                extraColumns={[
                    {
                        label: "Rows",
                        value: (occurrence) =>
                            payloadNumber(occurrence.endEvent, "rowCount")?.toLocaleString() ?? "—",
                    },
                    {
                        label: "Rendered",
                        value: (occurrence) =>
                            occurrence.traceId !== undefined &&
                            rendersByTrace.has(occurrence.traceId)
                                ? rendersByTrace.get(occurrence.traceId)!.toLocaleString()
                                : "—",
                    },
                    {
                        label: "Error",
                        value: (occurrence) =>
                            occurrence.endEvent.payload?.["hasError"]?.v === true ? "yes" : "—",
                    },
                ]}
            />
        </>
    );
}

// ---------------------------------------------------------------------------
// Object Explorer — expansion occurrences with node counts
// ---------------------------------------------------------------------------

export function ObjectExplorerPage() {
    const events = useFeatureEvents(["objectExplorer"]);
    const occurrences = useMemo(
        () => pairOccurrences(events, "mssql.oe.expand.begin", "mssql.oe.expand.end"),
        [events],
    );
    const kpis = occurrenceKpis(occurrences);
    const counts = occurrences
        .map((o) => payloadNumber(o.endEvent, "childCount"))
        .filter((v): v is number => v !== undefined);
    return (
        <>
            <PageHeader
                title="Object Explorer"
                sub="Every tree expansion with duration and child count. Node paths follow the capture policy (digested in redacted mode)."
            />
            <div className="dc-kpis">
                <Kpi label="Expansions" value={kpis.count} />
                <Kpi
                    label="Median duration"
                    value={kpis.medianMs !== undefined ? formatDuration(kpis.medianMs) : "—"}
                />
                <Kpi
                    label="p95"
                    value={kpis.p95Ms !== undefined ? formatDuration(kpis.p95Ms) : "—"}
                />
                <Kpi
                    label="Largest node"
                    value={counts.length > 0 ? Math.max(...counts).toLocaleString() : "—"}
                    note="children"
                />
                <Kpi
                    label="Failures"
                    value={kpis.errors}
                    tone={kpis.errors > 0 ? "error" : undefined}
                />
                <div className="dc-kpi">
                    <div className="label">Expand-time trend</div>
                    <div style={{ marginTop: 8 }}>
                        <Sparkline values={kpis.durations.slice(-30)} width={140} height={30} />
                    </div>
                </div>
            </div>
            <OccurrenceTable
                occurrences={occurrences}
                extraColumns={[
                    {
                        label: "Children",
                        value: (occurrence) =>
                            payloadNumber(occurrence.endEvent, "childCount")?.toLocaleString() ??
                            "—",
                    },
                    {
                        label: "Node",
                        value: (occurrence) => {
                            const nodePath = occurrence.endEvent.payload?.["nodePath"];
                            return nodePath ? <RedactedField value={nodePath} /> : "—";
                        },
                    },
                ]}
            />
        </>
    );
}

// ---------------------------------------------------------------------------
// Exports & Settings
// ---------------------------------------------------------------------------

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
            <CentralUploadCard />
        </>
    );
}

/** Sink + store health: a sink may degrade, but never silently (Chunk 2). */
function DiagHealthCard() {
    const { rpc } = useDc();
    const [health, setHealth] = useState<DiagHealthSnapshot | undefined>(undefined);
    const refresh = () => {
        void rpc.sendRequest(DcGetHealthRequest.type).then(setHealth);
    };
    useEffect(refresh, [rpc]);
    return (
        <div className="dc-card">
            <div className="dc-card-title">
                Diagnostics health
                <span className="right">
                    <button className="dc-btn" onClick={refresh}>
                        ⟳ Refresh
                    </button>
                </span>
            </div>
            {!health ? (
                <span className="dc-muted">Loading…</span>
            ) : (
                <>
                    <table className="dc-table ph-dense">
                        <thead>
                            <tr>
                                <th>Sink</th>
                                <th>Status</th>
                                <th>Detail</th>
                                <th>Counters</th>
                            </tr>
                        </thead>
                        <tbody>
                            {health.sinks.map((sink) => (
                                <tr key={sink.id}>
                                    <td className="dc-mono">{sink.id}</td>
                                    <td>
                                        <span
                                            className={`dc-pill ${sink.healthy ? "ok" : "error"}`}>
                                            {sink.healthy ? "healthy" : "degraded"}
                                        </span>
                                    </td>
                                    <td>{sink.detail}</td>
                                    <td className="dc-mono dc-muted" style={{ fontSize: 10.5 }}>
                                        {Object.entries(sink.counters)
                                            .map(([k, v]) => `${k}=${v.toLocaleString()}`)
                                            .join(" · ")}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="dc-kv" style={{ marginTop: 8 }}>
                        <span className="k">Store</span>
                        <span className="v">
                            {health.store.enabled ? "capturing" : "off"} · {health.store.sessions}{" "}
                            session(s) · {(health.store.totalBytes / (1024 * 1024)).toFixed(1)} MB
                        </span>
                        <span className="k">Integrity</span>
                        <span className="v">
                            {health.store.issues.length === 0 ? (
                                <span className="dc-pill ok">clean</span>
                            ) : (
                                `${health.store.issues.length} issue(s)`
                            )}
                        </span>
                    </div>
                    {health.store.issues.length > 0 ? (
                        <ul className="dc-muted" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                            {health.store.issues.slice(0, 12).map((issue, index) => (
                                <li key={index} style={{ fontSize: 11.5 }}>
                                    {issue}
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </>
            )}
        </div>
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
            <DiagHealthCard />
            <div className="dc-card">
                <div className="dc-card-title">Retention &amp; storage</div>
                <p className="dc-muted" style={{ margin: 0 }}>
                    Retention caps live in VS Code settings:{" "}
                    <span className="dc-mono">mssql.sessionDiag.maxSessions</span> (default 10) and{" "}
                    <span className="dc-mono">mssql.sessionDiag.maxAgeDays</span> (default 14), and
                    <span className="dc-mono"> mssql.sessionDiag.maxTotalMB</span> (default 512).
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
