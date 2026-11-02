/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Core Debug Console pages: Consolidated Trace and Waterfall. */

import { useEffect, useMemo, useRef, useState } from "react";
import {
    CauseTreeNode,
    DcGetCauseTreeRequest,
    DcGetTraceQualityRequest,
    DcGetWaterfallRequest,
    DcListTracesRequest,
    DcQueryEventsRequest,
    DiagEvent,
    DiagProcess,
    EventQueryResult,
    GapRecord,
    TraceQualityReport,
    UserActionSummary,
    WaterfallModel,
} from "../../../sharedInterfaces/debugConsole";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
    activatable,
    EmptyState,
    formatDuration,
    formatTime,
    LinkButton,
    PageHeader,
    PROCESS_COLOR,
    ProcessPill,
    RedactedField,
    RpcError,
    StatusPill,
    useRpcQuery,
} from "./common";
import { applyTraceFilter, parseTraceFilter } from "../../../sharedInterfaces/traceFilter";
import { useDc } from "./state";
import { WaterfallView } from "./waterfallView";

const DETAIL_TABS = ["Summary", "Payload", "Cause", "Privacy", "Raw"] as const;

function EventDetail({ event }: { event: DiagEvent }) {
    const { rpc, activeSourceId, navigate } = useDc();
    const [tab, setTab] = useState<(typeof DETAIL_TABS)[number]>("Summary");

    useEffect(() => {
        setTab("Summary");
    }, [event.eventId]);

    const { data: cause, error: causeError } = useRpcQuery<CauseTreeNode | undefined>(
        () =>
            tab === "Cause"
                ? rpc.sendRequest(DcGetCauseTreeRequest.type, {
                      sourceId: activeSourceId,
                      eventId: event.eventId,
                  })
                : undefined,
        [tab, rpc, activeSourceId, event.eventId],
    );

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
                                    <LinkButton
                                        onClick={() =>
                                            navigate({ page: "waterfall", traceId: event.traceId })
                                        }>
                                        {event.traceId}
                                    </LinkButton>
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
                    ) : causeError ? (
                        <RpcError error={causeError} />
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
    const [selected, setSelected] = useState<DiagEvent | undefined>(undefined);
    const [processFilter, setProcessFilter] = useState<string>("all");
    const [featureFilter, setFeatureFilter] = useState<string>("all");
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [showViewerInternal, setShowViewerInternal] = useState(false);
    // Live-capture controls (completions-style): pause freezes the view while
    // collection continues; clear hides everything before the watermark;
    // auto-scroll sticks the table to the newest rows.
    const [paused, setPaused] = useState(false);
    const [autoScroll, setAutoScroll] = useState(true);
    const [clearFromSeq, setClearFromSeq] = useState<number | undefined>(undefined);
    const [filterExpr, setFilterExpr] = useState("");
    const tableWrapRef = useRef<HTMLDivElement>(null);
    const parsedFilter = useMemo(() => parseTraceFilter(filterExpr), [filterExpr]);

    // Pause/clear are per-live-session state; switching sources resets them.
    useEffect(() => {
        setPaused(false);
        setClearFromSeq(undefined);
    }, [activeSourceId]);

    const {
        data: result,
        error: queryError,
        refresh: rerunQuery,
    } = useRpcQuery<EventQueryResult>(() => {
        const base = {
            sourceId: activeSourceId,
            limit: 400,
            ...(processFilter !== "all" ? { processes: [processFilter as DiagProcess] } : {}),
            ...(featureFilter !== "all" ? { features: [featureFilter] } : {}),
            ...(statusFilter !== "all" ? { statuses: [statusFilter as DiagEvent["status"]] } : {}),
            ...(search ? { text: search } : {}),
            ...(showViewerInternal ? { includeViewerInternal: true } : {}),
            ...(clearFromSeq !== undefined ? { fromSeq: clearFromSeq } : {}),
        };
        return rpc.sendRequest(DcQueryEventsRequest.type, applyTraceFilter(base, parsedFilter));
    }, [
        rpc,
        activeSourceId,
        processFilter,
        featureFilter,
        statusFilter,
        search,
        // Paused: freeze the view (collection continues server-side).
        paused ? -1 : dataVersion,
        showViewerInternal,
        clearFromSeq,
        parsedFilter,
    ]);

    // Stick to the newest rows while streaming (unless the user turned it off).
    useEffect(() => {
        const el = tableWrapRef.current;
        if (el && autoScroll && isLive && !paused) {
            el.scrollTop = el.scrollHeight;
        }
    }, [result, autoScroll, isLive, paused]);

    const features = useMemo(() => {
        const set = new Set<string>();
        for (const row of result?.rows ?? []) {
            if (row.kind !== "gap") {
                set.add((row as DiagEvent).feature);
            }
        }
        return [...set].sort();
    }, [result]);

    const lastSeq = useMemo(() => {
        const rows = result?.rows ?? [];
        for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i].kind !== "gap") {
                return (rows[i] as DiagEvent).seq;
            }
        }
        return undefined;
    }, [result]);

    return (
        <>
            <PageHeader title="Consolidated Trace" />
            <div className="dc-toolbar">
                {/* Live-capture controls only make sense on the live session —
                    pre-recorded sources are already frozen. */}
                <button
                    className={`dc-btn ${paused ? "warn-chip" : ""}`}
                    disabled={!isLive}
                    title={
                        !isLive
                            ? "Only the live session can be paused — this source is pre-recorded"
                            : paused
                              ? "Resume the live view (collection kept running)"
                              : "Pause the view — collection continues, the table freezes"
                    }
                    onClick={() => setPaused((p) => !p)}>
                    {paused ? "▶ Resume" : "⏸ Pause"}
                </button>
                <button
                    className="dc-btn"
                    disabled={!isLive}
                    title={
                        !isLive
                            ? "Only the live session can be cleared — this source is pre-recorded"
                            : "Hide everything captured so far (collection continues; 'show all' undoes)"
                    }
                    onClick={() =>
                        setClearFromSeq(lastSeq !== undefined ? lastSeq + 1 : undefined)
                    }>
                    ⌫ Clear
                </button>
                {clearFromSeq !== undefined && isLive ? (
                    <button
                        className="dc-btn"
                        title="Show all captured events again"
                        onClick={() => setClearFromSeq(undefined)}>
                        show all
                    </button>
                ) : null}
                <label
                    className="dc-muted"
                    title={
                        isLive
                            ? "Keep the table scrolled to the newest events"
                            : "Auto-scroll applies to the live session only"
                    }
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        opacity: isLive ? 1 : 0.5,
                    }}>
                    <input
                        type="checkbox"
                        checked={autoScroll}
                        disabled={!isLive}
                        onChange={(e) => setAutoScroll(e.target.checked)}
                    />
                    auto-scroll
                </label>
                <input
                    className="ph-search"
                    style={{ minWidth: 220, maxWidth: 320 }}
                    placeholder="filter: dur>1000 proc:sts status:error text…"
                    value={filterExpr}
                    spellCheck={false}
                    title="Filter expressions: dur>1000, dur<2s, proc:sts|extension|webview|sql, feat:query, status:error, plain text. Tokens are ANDed."
                    onChange={(e) => setFilterExpr(e.target.value)}
                />
                {parsedFilter.invalid.length > 0 ? (
                    <span
                        className="dc-muted"
                        style={{ color: "var(--dc-warn)", fontSize: 11 }}
                        title="These tokens were not understood and are ignored">
                        ⚠ {parsedFilter.invalid.join(", ")}
                    </span>
                ) : null}
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
                <label
                    className="dc-muted"
                    title="Show the Debug Console's own RPC spans (excluded by default so viewing a trace never pollutes it)"
                    style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <input
                        type="checkbox"
                        checked={showViewerInternal}
                        onChange={(e) => setShowViewerInternal(e.target.checked)}
                    />
                    viewer internals
                </label>
                <span className="dc-muted" style={{ marginLeft: "auto" }}>
                    {paused ? "⏸ paused · " : isLive ? "Streaming · " : ""}
                    {result
                        ? `${Math.min(result.rows.length, result.totalMatching)} of ${result.totalInSource.toLocaleString()} shown`
                        : ""}
                </span>
            </div>
            <PanelGroup direction="horizontal" className="dc-split-panels">
                <Panel defaultSize={62} minSize={30} className="dc-panel-min0">
                    <div ref={tableWrapRef} className="dc-table-wrap" style={{ height: "100%" }}>
                        {queryError ? <RpcError error={queryError} retry={rerunQuery} /> : null}
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
                                                ⚠ {(row as GapRecord).droppedCount} events dropped
                                                · seq {(row as GapRecord).fromSeq}–
                                                {(row as GapRecord).throughSeq} ·{" "}
                                                {(row as GapRecord).reason} —{" "}
                                                <span className="dc-muted">
                                                    retained in Session Diag store when capture is
                                                    on
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
                                            {...activatable(() => setSelected(row as DiagEvent))}
                                            onClick={() => setSelected(row as DiagEvent)}>
                                            <td
                                                className="dc-proc-stripe"
                                                style={{
                                                    background:
                                                        (row as DiagEvent).feature === "rpc"
                                                            ? PROCESS_COLOR["sqlToolsService"]
                                                            : PROCESS_COLOR[
                                                                  (row as DiagEvent).process
                                                              ],
                                                }}
                                            />
                                            <td className="dc-mono">
                                                {formatTime((row as DiagEvent).epochMs)}
                                            </td>
                                            <td className="num dc-mono dc-muted">
                                                {(row as DiagEvent).seq}
                                            </td>
                                            <td>
                                                {(row as DiagEvent).feature === "rpc" ? (
                                                    <span
                                                        className="dc-proc-pill"
                                                        title="JSON-RPC round-trip to SQL Tools Service, measured from the extension host"
                                                        style={{
                                                            color: PROCESS_COLOR["sqlToolsService"],
                                                            background: `color-mix(in srgb, ${PROCESS_COLOR["sqlToolsService"]} 13%, transparent)`,
                                                        }}>
                                                        <span
                                                            className="dc-proc-dot"
                                                            style={{
                                                                background:
                                                                    PROCESS_COLOR[
                                                                        "sqlToolsService"
                                                                    ],
                                                            }}
                                                        />
                                                        STS rpc
                                                    </span>
                                                ) : (
                                                    <ProcessPill
                                                        process={(row as DiagEvent).process}
                                                    />
                                                )}
                                            </td>
                                            <td className="dc-muted">
                                                {(row as DiagEvent).feature}
                                            </td>
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
                </Panel>
                <PanelResizeHandle className="dc-resize-handle" />
                <Panel defaultSize={38} minSize={22} className="dc-panel-min0">
                    {selected ? (
                        <EventDetail event={selected} />
                    ) : (
                        <div className="dc-detail" style={{ height: "100%" }}>
                            <div className="dc-detail-body dc-muted">
                                Select an event to inspect its payload, cause chain, and privacy
                                classification.
                            </div>
                        </div>
                    )}
                </Panel>
            </PanelGroup>
        </>
    );
}

// ---------------------------------------------------------------------------
// Waterfall
// ---------------------------------------------------------------------------

export function WaterfallPage() {
    const { rpc, activeSourceId, route, navigate, dataVersion } = useDc();

    // Trace list + selected model in ONE guarded query: a response for an
    // older source/trace can never land after a newer selection.
    const {
        data: loaded,
        error: loadError,
        refresh: reload,
    } = useRpcQuery<{
        traces: UserActionSummary[];
        model: WaterfallModel | undefined;
    }>(async () => {
        const traces = await rpc.sendRequest(DcListTracesRequest.type, {
            sourceId: activeSourceId,
        });
        const traceId = route.traceId ?? traces[0]?.traceId;
        const model = traceId
            ? await rpc.sendRequest(DcGetWaterfallRequest.type, {
                  sourceId: activeSourceId,
                  traceId,
              })
            : undefined;
        return { traces, model };
    }, [rpc, activeSourceId, route.traceId, dataVersion]);
    const traces = loaded?.traces ?? [];
    const model = loaded?.model;

    // Per-trace stitching quality: unpaired spans and orphans mean this
    // waterfall has fog — say so instead of drawing invented roads.
    const { data: quality } = useRpcQuery<TraceQualityReport>(
        () =>
            model?.traceId
                ? rpc.sendRequest(DcGetTraceQualityRequest.type, {
                      sourceId: activeSourceId,
                      traceId: model.traceId,
                  })
                : undefined,
        [rpc, activeSourceId, model?.traceId],
    );

    if (loadError) {
        return (
            <>
                <PageHeader title="Cross-Process Waterfall" />
                <RpcError error={loadError} retry={reload} />
            </>
        );
    }
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
                {quality && quality.score !== "good" ? (
                    <span
                        className={`dc-pill ${quality.score === "fair" ? "warn" : "error"}`}
                        title={quality.notes.join("\n")}>
                        stitching: {quality.score}
                        {quality.unmatchedPairs.length > 0
                            ? ` · ${quality.unmatchedPairs.length} unpaired`
                            : ""}
                        {quality.orphanCount > 0 ? ` · ${quality.orphanCount} orphans` : ""}
                    </span>
                ) : null}
                {model.activityCap ? (
                    <span
                        className="dc-pill warn"
                        title="The host keeps the longest bars of a very large trace; the extent and critical path use every activity">
                        showing longest {model.activityCap.shown} of {model.activityCap.total} bars
                    </span>
                ) : null}
                <span
                    className="dc-muted"
                    style={{ marginLeft: "auto" }}
                    title={model.calibrationNote}>
                    {model.calibrationNote}
                </span>
            </div>
            <WaterfallView model={model} layout="full" />
        </>
    );
}
