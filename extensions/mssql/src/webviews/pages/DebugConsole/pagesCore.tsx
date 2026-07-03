/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Core Debug Console pages: Overview, Consolidated Trace, Waterfall. */

import { useEffect, useMemo, useState } from "react";
import {
    CauseTreeNode,
    DcGetCauseTreeRequest,
    DcGetOverviewRequest,
    DcGetWaterfallRequest,
    DcListTracesRequest,
    DcQueryEventsRequest,
    DiagEvent,
    DiagProcess,
    EventQueryResult,
    GapRecord,
    SourceOverview,
    UserActionSummary,
    WaterfallModel,
} from "../../../sharedInterfaces/debugConsole";
import {
    EmptyState,
    formatDuration,
    formatTime,
    Kpi,
    PageHeader,
    PROCESS_COLOR,
    ProcessPill,
    RedactedField,
    StatusPill,
} from "./common";
import { useDc } from "./state";

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export function OverviewPage() {
    const {
        rpc,
        activeSourceId,
        navigate,
        captureMode,
        setCaptureMode,
        dataVersion,
        sources,
        importPerfRun,
    } = useDc();
    const [overview, setOverview] = useState<SourceOverview | undefined>(undefined);

    useEffect(() => {
        void rpc
            .sendRequest(DcGetOverviewRequest.type, { sourceId: activeSourceId })
            .then(setOverview);
    }, [rpc, activeSourceId, dataVersion]);

    if (!overview) {
        return <PageHeader title="Overview" sub="Loading…" />;
    }
    const { kpis, actions, anomalies } = overview;
    if (kpis.events === 0 && captureMode === "off" && activeSourceId.startsWith("live:")) {
        return (
            <>
                <PageHeader title="Overview" />
                <EmptyState
                    title="Session diagnostics are off"
                    body="Turn on local Session Diag to capture classified, redacted traces for this VS Code session. Nothing is uploaded. The live view still shows events while the console is open.">
                    <div style={{ display: "flex", gap: 8 }}>
                        <button
                            className="dc-btn primary"
                            onClick={() => setCaptureMode("redacted")}>
                            Enable redacted capture
                        </button>
                        <button className="dc-btn" onClick={importPerfRun}>
                            Import perf run…
                        </button>
                    </div>
                </EmptyState>
            </>
        );
    }
    return (
        <>
            <PageHeader
                title="Overview"
                sub="Session triage — what's captured, what's slow, what changed."
            />
            <div className="dc-kpis">
                <Kpi label="Events" value={kpis.events.toLocaleString()} />
                <Kpi
                    label="Errors"
                    value={kpis.errors}
                    tone={kpis.errors > 0 ? "error" : undefined}
                />
                <Kpi
                    label="Warnings"
                    value={kpis.warnings}
                    tone={kpis.warnings > 0 ? "warn" : undefined}
                />
                <Kpi
                    label="Live-tail gaps"
                    value={kpis.gaps}
                    note={kpis.gaps > 0 ? "backfillable" : undefined}
                    tone={kpis.gaps > 0 ? "warn" : undefined}
                />
                {kpis.slowestActionMs !== undefined ? (
                    <Kpi
                        label="Slowest action"
                        value={formatDuration(kpis.slowestActionMs)}
                        note={kpis.slowestActionLabel}
                    />
                ) : null}
                <Kpi label="SQL commands" value={kpis.sqlCommands} />
                <Kpi label="Capture mode" value={kpis.captureMode} note="local only" />
                <Kpi label="Redacted fields" value={kpis.redactedFields.toLocaleString()} />
            </div>
            <div className="dc-two-col">
                <div className="dc-card">
                    <div className="dc-card-title">
                        Recent user actions
                        <span className="right">
                            <a
                                style={{ cursor: "pointer", color: "var(--dc-link)" }}
                                onClick={() => navigate({ page: "trace" })}>
                                open in Trace →
                            </a>
                        </span>
                    </div>
                    <div className="dc-table-wrap" style={{ border: "none" }}>
                        <table className="dc-table">
                            <thead>
                                <tr>
                                    <th>Start</th>
                                    <th>Action</th>
                                    <th>Feature</th>
                                    <th className="num">Dur</th>
                                    <th>Status</th>
                                    <th className="num">SQL</th>
                                    <th className="num">Render</th>
                                    <th className="num">Events</th>
                                </tr>
                            </thead>
                            <tbody>
                                {actions.map((action) => (
                                    <tr
                                        key={action.traceId}
                                        onClick={() =>
                                            navigate({ page: "waterfall", traceId: action.traceId })
                                        }>
                                        <td className="dc-mono">
                                            {formatTime(action.startEpochMs)}
                                        </td>
                                        <td>{action.label}</td>
                                        <td className="dc-muted">{action.feature}</td>
                                        <td className="num dc-mono">
                                            {formatDuration(action.durationMs)}
                                        </td>
                                        <td>
                                            <StatusPill status={action.status} />
                                        </td>
                                        <td className="num dc-mono">{action.sqlCommands}</td>
                                        <td className="num dc-mono">
                                            {action.renderMs !== undefined
                                                ? formatDuration(action.renderMs)
                                                : "—"}
                                        </td>
                                        <td className="num dc-mono">{action.eventCount}</td>
                                    </tr>
                                ))}
                                {actions.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="dc-muted">
                                            Use MSSQL features — connect, run a query, expand Object
                                            Explorer — and actions appear here.
                                        </td>
                                    </tr>
                                ) : null}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div>
                    <div className="dc-card-title" style={{ marginBottom: 8 }}>
                        Anomalies
                    </div>
                    {anomalies.length === 0 ? (
                        <div className="dc-muted">Nothing anomalous detected in this source.</div>
                    ) : (
                        anomalies.map((anomaly) => (
                            <div className={`dc-anomaly ${anomaly.severity}`} key={anomaly.id}>
                                <div className="title">{anomaly.title}</div>
                                <div className="detail">{anomaly.detail}</div>
                                <a
                                    onClick={() =>
                                        navigate({
                                            page:
                                                anomaly.page === "waterfall"
                                                    ? "waterfall"
                                                    : "trace",
                                            ...(anomaly.traceId
                                                ? { traceId: anomaly.traceId }
                                                : {}),
                                        })
                                    }>
                                    Open in {anomaly.page === "waterfall" ? "Waterfall" : "Trace"} →
                                </a>
                            </div>
                        ))
                    )}
                    <div className="dc-card" style={{ marginTop: 10 }}>
                        <div className="dc-card-title">Sessions &amp; imported runs</div>
                        {sources.map((source) => (
                            <div
                                key={source.id}
                                style={{
                                    display: "flex",
                                    gap: 8,
                                    alignItems: "center",
                                    padding: "3px 0",
                                }}>
                                <span
                                    className="dc-live-dot"
                                    style={{
                                        background:
                                            source.kind === "liveSession"
                                                ? "var(--dc-ok)"
                                                : "var(--dc-proc-system)",
                                    }}
                                />
                                <span
                                    style={{
                                        flex: 1,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                    }}>
                                    {source.label}
                                </span>
                                <span className="dc-pill diag">{source.kind}</span>
                                <span className="dc-mono dc-muted">
                                    {source.eventCount?.toLocaleString() ?? ""}
                                </span>
                            </div>
                        ))}
                        <a
                            style={{ cursor: "pointer", color: "var(--dc-link)", fontSize: 11.5 }}
                            onClick={importPerfRun}>
                            Import perf run…
                        </a>
                    </div>
                </div>
            </div>
        </>
    );
}

// ---------------------------------------------------------------------------
// Consolidated Trace
// ---------------------------------------------------------------------------

const DETAIL_TABS = ["Summary", "Payload", "Cause", "Privacy", "Raw"] as const;

function EventDetail({ event }: { event: DiagEvent }) {
    const { rpc, activeSourceId, navigate } = useDc();
    const [tab, setTab] = useState<(typeof DETAIL_TABS)[number]>("Summary");
    const [cause, setCause] = useState<CauseTreeNode | undefined>(undefined);

    useEffect(() => {
        setTab("Summary");
        setCause(undefined);
    }, [event.eventId]);

    useEffect(() => {
        if (tab === "Cause" && !cause) {
            void rpc
                .sendRequest(DcGetCauseTreeRequest.type, {
                    sourceId: activeSourceId,
                    eventId: event.eventId,
                })
                .then(setCause);
        }
    }, [tab, cause, rpc, activeSourceId, event.eventId]);

    const renderCause = (node: CauseTreeNode, depth: number): React.ReactNode => (
        <div className={depth > 0 ? "dc-cause-node" : ""} key={node.event.eventId}>
            <span className="dc-cause-label">
                <span
                    className="dc-proc-dot"
                    style={{ background: PROCESS_COLOR[node.event.process] }}
                />
                {node.event.type}
                {node.event.durationMs !== undefined ? (
                    <span className="dc-muted">{formatDuration(node.event.durationMs)}</span>
                ) : null}
            </span>
            {node.children.map((child) => renderCause(child, depth + 1))}
        </div>
    );

    return (
        <div className="dc-detail">
            <div className="dc-tabs">
                {DETAIL_TABS.map((t) => (
                    <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                        {t}
                    </button>
                ))}
            </div>
            <div className="dc-detail-body">
                {tab === "Summary" ? (
                    <div className="dc-kv">
                        <span className="k">Type</span>
                        <span className="v">{event.type}</span>
                        <span className="k">Status</span>
                        <span className="v">
                            <StatusPill status={event.status} />
                        </span>
                        <span className="k">Time</span>
                        <span className="v">{new Date(event.epochMs).toISOString()}</span>
                        {event.durationMs !== undefined ? (
                            <>
                                <span className="k">Duration</span>
                                <span className="v">{formatDuration(event.durationMs)}</span>
                            </>
                        ) : null}
                        <span className="k">Process</span>
                        <span className="v">
                            <ProcessPill process={event.process} />
                            {event.pid ? ` pid ${event.pid}` : ""}
                        </span>
                        <span className="k">Feature</span>
                        <span className="v">{event.feature}</span>
                        <span className="k">Kind</span>
                        <span className="v">{event.kind}</span>
                        <span className="k">Event ID</span>
                        <span className="v">{event.eventId}</span>
                        <span className="k">Seq</span>
                        <span className="v">{event.seq}</span>
                        {event.traceId ? (
                            <>
                                <span className="k">Correlation</span>
                                <span className="v">
                                    <a
                                        style={{ color: "var(--dc-link)", cursor: "pointer" }}
                                        onClick={() =>
                                            navigate({ page: "waterfall", traceId: event.traceId })
                                        }>
                                        {event.traceId}
                                    </a>
                                </span>
                            </>
                        ) : null}
                        {event.timingClass ? (
                            <>
                                <span className="k">Timing class</span>
                                <span className="v">{event.timingClass}</span>
                            </>
                        ) : null}
                        <span className="k">Classification</span>
                        <span className="v">
                            {event.cls.max} · {event.cls.redactedFields} redacted
                        </span>
                    </div>
                ) : null}
                {tab === "Payload" ? (
                    event.payload && Object.keys(event.payload).length > 0 ? (
                        <div className="dc-kv">
                            {Object.entries(event.payload).map(([key, value]) => (
                                <div style={{ display: "contents" }} key={key}>
                                    <span className="k">{key}</span>
                                    <span className="v">
                                        <RedactedField value={value} />
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <span className="dc-muted">No payload fields.</span>
                    )
                ) : null}
                {tab === "Cause" ? (
                    cause ? (
                        renderCause(cause, 0)
                    ) : (
                        <span className="dc-muted">Loading cause tree…</span>
                    )
                ) : null}
                {tab === "Privacy" ? (
                    <div className="dc-kv">
                        <span className="k">Max classification</span>
                        <span className="v">{event.cls.max}</span>
                        <span className="k">Redacted fields</span>
                        <span className="v">{event.cls.redactedFields}</span>
                        <span className="k">Policy</span>
                        <span className="v">{event.cls.policyId}</span>
                        {Object.entries(event.payload ?? {}).map(([key, value]) => (
                            <div style={{ display: "contents" }} key={key}>
                                <span className="k">{key}</span>
                                <span className="v">
                                    {value.cls} · {value.handling}
                                </span>
                            </div>
                        ))}
                    </div>
                ) : null}
                {tab === "Raw" ? (
                    <pre className="dc-json">{JSON.stringify(event, null, 2)}</pre>
                ) : null}
            </div>
        </div>
    );
}

export function TracePage() {
    const { rpc, activeSourceId, search, dataVersion, isLive } = useDc();
    const [result, setResult] = useState<EventQueryResult | undefined>(undefined);
    const [selected, setSelected] = useState<DiagEvent | undefined>(undefined);
    const [processFilter, setProcessFilter] = useState<string>("all");
    const [featureFilter, setFeatureFilter] = useState<string>("all");
    const [statusFilter, setStatusFilter] = useState<string>("all");

    useEffect(() => {
        const query = {
            sourceId: activeSourceId,
            limit: 400,
            ...(processFilter !== "all" ? { processes: [processFilter as DiagProcess] } : {}),
            ...(featureFilter !== "all" ? { features: [featureFilter] } : {}),
            ...(statusFilter !== "all" ? { statuses: [statusFilter as DiagEvent["status"]] } : {}),
            ...(search ? { text: search } : {}),
        };
        void rpc.sendRequest(DcQueryEventsRequest.type, query).then(setResult);
    }, [rpc, activeSourceId, processFilter, featureFilter, statusFilter, search, dataVersion]);

    const features = useMemo(() => {
        const set = new Set<string>();
        for (const row of result?.rows ?? []) {
            if (row.kind !== "gap") {
                set.add((row as DiagEvent).feature);
            }
        }
        return [...set].sort();
    }, [result]);

    return (
        <>
            <PageHeader title="Consolidated Trace" />
            <div className="dc-toolbar">
                <select value={processFilter} onChange={(e) => setProcessFilter(e.target.value)}>
                    <option value="all">Process: all</option>
                    <option value="extensionHost">Extension</option>
                    <option value="webview">Webview</option>
                    <option value="sqlToolsService">STS</option>
                    <option value="sqlServer">SQL Server</option>
                    <option value="system">System</option>
                </select>
                <select value={featureFilter} onChange={(e) => setFeatureFilter(e.target.value)}>
                    <option value="all">Feature: all</option>
                    {features.map((feature) => (
                        <option key={feature} value={feature}>
                            {feature}
                        </option>
                    ))}
                </select>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="all">Status: any</option>
                    <option value="ok">ok</option>
                    <option value="warning">warning</option>
                    <option value="error">error</option>
                </select>
                <span className="dc-muted" style={{ marginLeft: "auto" }}>
                    {isLive ? "Streaming · newest at bottom · " : ""}
                    {result
                        ? `${Math.min(result.rows.length, result.totalMatching)} of ${result.totalInSource.toLocaleString()} shown`
                        : ""}
                </span>
            </div>
            <div className="dc-split">
                <div className="dc-table-wrap">
                    <table className="dc-table">
                        <thead>
                            <tr>
                                <th className="dc-proc-stripe" />
                                <th>Time</th>
                                <th className="num">Seq</th>
                                <th>Process</th>
                                <th>Feature</th>
                                <th>Type</th>
                                <th>Corr</th>
                                <th className="num">Dur</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(result?.rows ?? []).map((row) =>
                                row.kind === "gap" ? (
                                    <tr className="dc-gap-row" key={(row as GapRecord).gapId}>
                                        <td className="dc-proc-stripe" />
                                        <td colSpan={8}>
                                            ⚠ {(row as GapRecord).droppedCount} events dropped ·
                                            seq {(row as GapRecord).fromSeq}–
                                            {(row as GapRecord).throughSeq} ·{" "}
                                            {(row as GapRecord).reason} —{" "}
                                            <span className="dc-muted">
                                                retained in Session Diag store when capture is on
                                            </span>
                                        </td>
                                    </tr>
                                ) : (
                                    <tr
                                        key={(row as DiagEvent).eventId}
                                        className={
                                            selected?.eventId === (row as DiagEvent).eventId
                                                ? "selected"
                                                : ""
                                        }
                                        onClick={() => setSelected(row as DiagEvent)}>
                                        <td
                                            className="dc-proc-stripe"
                                            style={{
                                                background:
                                                    PROCESS_COLOR[(row as DiagEvent).process],
                                            }}
                                        />
                                        <td className="dc-mono">
                                            {formatTime((row as DiagEvent).epochMs)}
                                        </td>
                                        <td className="num dc-mono dc-muted">
                                            {(row as DiagEvent).seq}
                                        </td>
                                        <td>
                                            <ProcessPill process={(row as DiagEvent).process} />
                                        </td>
                                        <td className="dc-muted">{(row as DiagEvent).feature}</td>
                                        <td className="dc-mono">{(row as DiagEvent).type}</td>
                                        <td className="dc-mono dc-muted">
                                            {(row as DiagEvent).traceId
                                                ? `${(row as DiagEvent).traceId!.slice(0, 14)}…`
                                                : "—"}
                                        </td>
                                        <td className="num dc-mono">
                                            {formatDuration((row as DiagEvent).durationMs)}
                                        </td>
                                        <td>
                                            <StatusPill status={(row as DiagEvent).status} />
                                        </td>
                                    </tr>
                                ),
                            )}
                        </tbody>
                    </table>
                </div>
                {selected ? (
                    <EventDetail event={selected} />
                ) : (
                    <div className="dc-detail">
                        <div className="dc-detail-body dc-muted">
                            Select an event to inspect its payload, cause chain, and privacy
                            classification.
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}

// ---------------------------------------------------------------------------
// Waterfall
// ---------------------------------------------------------------------------

const LANE_ORDER: Array<DiagProcess | "userAction"> = [
    "userAction",
    "extensionHost",
    "webview",
    "sqlToolsService",
    "sqlServer",
    "harness",
    "system",
];

export function WaterfallPage() {
    const { rpc, activeSourceId, route, navigate, dataVersion } = useDc();
    const [traces, setTraces] = useState<UserActionSummary[]>([]);
    const [model, setModel] = useState<WaterfallModel | undefined>(undefined);
    const [selectedBar, setSelectedBar] = useState<string | undefined>(undefined);

    useEffect(() => {
        void rpc
            .sendRequest(DcListTracesRequest.type, { sourceId: activeSourceId })
            .then((list) => {
                setTraces(list);
                const traceId = route.traceId ?? list[0]?.traceId;
                if (traceId) {
                    void rpc
                        .sendRequest(DcGetWaterfallRequest.type, {
                            sourceId: activeSourceId,
                            traceId,
                        })
                        .then(setModel);
                } else {
                    setModel(undefined);
                }
            });
    }, [rpc, activeSourceId, route.traceId, dataVersion]);

    if (!model) {
        return (
            <>
                <PageHeader title="Cross-Process Waterfall" />
                <EmptyState
                    title="No user action selected"
                    body="Run a query, connect, or expand Object Explorer — then pick the action here to see where the time went across processes."
                />
            </>
        );
    }

    const total = Math.max(1, model.endEpochMs - model.startEpochMs);
    const lanes = LANE_ORDER.filter((lane) => model.activities.some((a) => a.lane === lane));
    const selected = model.activities.find((a) => a.id === selectedBar);

    // Wall-clock decomposition per lane (exclusive-ish: sum per lane, capped).
    const laneTotals = lanes
        .map((lane) => ({
            lane,
            ms: model.activities
                .filter((a) => a.lane === lane)
                .reduce((sum, a) => sum + a.durationMs, 0),
        }))
        .filter((entry) => entry.ms > 0);
    const stripTotal = laneTotals.reduce((sum, entry) => sum + entry.ms, 0) || 1;

    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
        left: f * 100,
        label: `${((total * f) / 1000).toFixed(2)}s`,
    }));

    return (
        <>
            <PageHeader title="Cross-Process Waterfall" />
            <div className="dc-toolbar">
                <select
                    value={model.traceId}
                    onChange={(e) => navigate({ page: "waterfall", traceId: e.target.value })}>
                    {traces.map((trace) => (
                        <option key={trace.traceId} value={trace.traceId}>
                            {trace.label} · {formatTime(trace.startEpochMs)} ·{" "}
                            {formatDuration(trace.durationMs)}
                        </option>
                    ))}
                </select>
                <span
                    className="dc-muted"
                    style={{ marginLeft: "auto" }}
                    title={model.calibrationNote}>
                    {model.calibrationNote}
                </span>
            </div>

            <div className="dc-card">
                <div className="dc-card-title">
                    Wall-clock decomposition
                    <span className="right dc-mono">{formatDuration(total)}</span>
                </div>
                <div className="dc-wf-strip">
                    {laneTotals.map((entry) => (
                        <div
                            key={entry.lane}
                            className="seg"
                            title={`${entry.lane}: ${formatDuration(entry.ms)} (summed per lane; lanes overlap)`}
                            style={{
                                width: `${(entry.ms / stripTotal) * 100}%`,
                                background: PROCESS_COLOR[entry.lane],
                            }}
                        />
                    ))}
                </div>
                <div className="dc-wf-legend">
                    {laneTotals.map((entry) => (
                        <span key={entry.lane}>
                            <span
                                className="swatch"
                                style={{ background: PROCESS_COLOR[entry.lane] }}
                            />
                            {entry.lane} {formatDuration(entry.ms)}
                        </span>
                    ))}
                    <span className="dc-muted">(per-lane sums; lanes overlap in time)</span>
                </div>
                <div className="dc-wf-legend">
                    <span>
                        <span className="swatch" style={{ background: "var(--dc-proc-sts)" }} />
                        solid = same-process monotonic
                    </span>
                    <span>
                        <span
                            className="swatch dc-wf-bar hatched"
                            style={{
                                background: "var(--dc-proc-sts)",
                                position: "static",
                                display: "inline-block",
                            }}
                        />
                        hatched = epoch-aligned diagnostic
                    </span>
                </div>
            </div>

            <div className="dc-two-col">
                <div className="dc-wf">
                    <div className="dc-wf-axis">
                        <div />
                        <div className="ticks">
                            {ticks.map((tick) => (
                                <span
                                    className="tick"
                                    style={{ left: `${tick.left}%` }}
                                    key={tick.left}>
                                    {tick.label}
                                </span>
                            ))}
                        </div>
                    </div>
                    {lanes.map((lane) => (
                        <div className="dc-wf-lane" key={lane}>
                            <div className="dc-wf-lane-label">
                                <span
                                    className="dc-proc-dot"
                                    style={{ background: PROCESS_COLOR[lane] }}
                                />
                                {lane === "userAction" ? "User action" : lane}
                            </div>
                            <div className="dc-wf-track">
                                {model.activities
                                    .filter((a) => a.lane === lane)
                                    .map((activity) => {
                                        const left =
                                            ((activity.startEpochMs - model.startEpochMs) / total) *
                                            100;
                                        const width = Math.max(
                                            0.4,
                                            ((activity.endEpochMs - activity.startEpochMs) /
                                                total) *
                                                100,
                                        );
                                        const official =
                                            activity.timingClass === "officialSameProcess" ||
                                            activity.timingClass === "productTimer";
                                        return (
                                            <div
                                                key={activity.id}
                                                className={`dc-wf-bar ${official ? "" : "hatched"} ${selectedBar === activity.id ? "selected" : ""}`}
                                                style={{
                                                    left: `${left}%`,
                                                    width: `${width}%`,
                                                    background: PROCESS_COLOR[activity.lane],
                                                    opacity: official ? 0.95 : 0.75,
                                                }}
                                                title={`${activity.label} — ${formatDuration(activity.durationMs)} (${activity.timingClass})`}
                                                onClick={() => setSelectedBar(activity.id)}
                                            />
                                        );
                                    })}
                            </div>
                        </div>
                    ))}
                </div>
                <div>
                    {selected ? (
                        <div className="dc-card">
                            <div className="dc-card-title dc-mono">{selected.label}</div>
                            <div className="dc-kv">
                                <span className="k">Duration</span>
                                <span className="v">{formatDuration(selected.durationMs)}</span>
                                <span className="k">Start</span>
                                <span className="v">
                                    +{(selected.startEpochMs - model.startEpochMs).toFixed(0)}ms
                                </span>
                                <span className="k">Timing class</span>
                                <span className="v">{selected.timingClass}</span>
                                <span className="k">Status</span>
                                <span className="v">
                                    <StatusPill status={selected.status} />
                                </span>
                                <span className="k">Lane</span>
                                <span className="v">{selected.lane}</span>
                                <span className="k">Source events</span>
                                <span className="v">{selected.sourceEventIds.join(", ")}</span>
                            </div>
                        </div>
                    ) : null}
                    <div className="dc-card">
                        <div className="dc-card-title">
                            Critical path
                            <span className="right dc-mono">{formatDuration(total)}</span>
                        </div>
                        {model.criticalPath.length === 0 ? (
                            <span className="dc-muted">
                                Critical path unavailable — not enough paired spans in this trace.
                            </span>
                        ) : (
                            model.criticalPath.map((step, index) => (
                                <div
                                    key={index}
                                    style={{
                                        display: "flex",
                                        gap: 8,
                                        alignItems: "baseline",
                                        padding: "3px 0",
                                        borderBottom:
                                            "1px solid color-mix(in srgb, var(--dc-border) 50%, transparent)",
                                    }}>
                                    <span
                                        className="dc-pill info"
                                        style={{ minWidth: 18, justifyContent: "center" }}>
                                        {index + 1}
                                    </span>
                                    <span className="dc-mono" style={{ flex: 1 }}>
                                        {step.label}
                                        {step.note ? (
                                            <span className="dc-muted"> · {step.note}</span>
                                        ) : null}
                                    </span>
                                    <span className="dc-mono">
                                        {formatDuration(step.durationMs)}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
