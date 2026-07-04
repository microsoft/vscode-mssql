/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Reusable cross-process waterfall renderer.
 *
 * Zooming uses NATIVE horizontal scrolling: the track content grows to
 * `zoom × 100%`, so the scrollbar expands with zoom and always works
 * (Perfetto-style: wheel zooms at the cursor, W/S zoom, A/D pan, drag to pan,
 * Esc/double-click resets). Lane labels live in a fixed column outside the
 * horizontal scroller — bars can never render into the label area. The time
 * axis shows the VISIBLE window and updates as you scroll/zoom.
 *
 * Two layouts:
 *   full     — the Waterfall page: a splitter grid that fills the page
 *              (chart | inspector + critical path, event details across the
 *              bottom), no outer document scrollbars.
 *   embedded — the Perf Test History tab: compact stacked cards, no table.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
    DiagProcess,
    DiagStatus,
    WaterfallActivity,
    WaterfallModel,
} from "../../../sharedInterfaces/debugConsole";
import { formatDuration, PROCESS_COLOR, PROCESS_LABEL, StatusPill } from "./common";

export const LANE_ORDER: Array<DiagProcess | "userAction" | "driver"> = [
    "userAction",
    "extensionHost",
    "webview",
    "sqlToolsService",
    "driver",
    "sqlServer",
    "harness",
    "system",
];

const LABEL_COL_PX = 132;
const ROW_HEIGHT = 22;
/** Keep zoomed content well under the browser's max element width. */
const MAX_CONTENT_PX = 1_500_000;
const MIN_WINDOW_MS = 0.5;

interface LanePacked {
    lane: WaterfallActivity["lane"];
    activities: WaterfallActivity[];
    rowOf: Map<string, number>;
    height: number;
}

function packLanes(model: WaterfallModel): LanePacked[] {
    return LANE_ORDER.filter((lane) => model.activities.some((a) => a.lane === lane)).map(
        (lane) => {
            const activities = model.activities
                .filter((a) => a.lane === lane)
                .sort((a, b) => a.startEpochMs - b.startEpochMs);
            const rowEnds: number[] = [];
            const rowOf = new Map<string, number>();
            for (const activity of activities) {
                let row = rowEnds.findIndex((end) => end <= activity.startEpochMs + 0.01);
                if (row < 0) {
                    row = rowEnds.length;
                    rowEnds.push(0);
                }
                rowEnds[row] = activity.endEpochMs;
                rowOf.set(activity.id, row);
            }
            return {
                lane,
                activities,
                rowOf,
                height: Math.max(30, rowEnds.length * ROW_HEIGHT + 8),
            };
        },
    );
}

/** Zoom/pan state built on native horizontal scrolling. */
function useWaterfallZoom(model: WaterfallModel) {
    const [zoom, setZoom] = useState(1);
    const [windowFrac, setWindowFrac] = useState({ start: 0, end: 1 });
    const hscrollRef = useRef<HTMLDivElement>(null);
    const pendingScroll = useRef<{ frac: number; px: number } | undefined>(undefined);
    const panState = useRef<{ startX: number; startScroll: number; moved: boolean } | undefined>(
        undefined,
    );
    const rafRef = useRef<number | undefined>(undefined);

    const fullSpan = Math.max(1, model.endEpochMs - model.startEpochMs);

    const maxZoom = useCallback(() => {
        const el = hscrollRef.current;
        const clientPx = Math.max(200, el?.clientWidth ?? 1000);
        return Math.max(1, Math.min(fullSpan / MIN_WINDOW_MS, MAX_CONTENT_PX / clientPx));
    }, [fullSpan]);

    const syncWindow = useCallback(() => {
        const el = hscrollRef.current;
        if (!el || el.scrollWidth === 0) {
            return;
        }
        const start = el.scrollLeft / el.scrollWidth;
        const end = (el.scrollLeft + el.clientWidth) / el.scrollWidth;
        setWindowFrac((current) =>
            Math.abs(current.start - start) < 1e-6 && Math.abs(current.end - end) < 1e-6
                ? current
                : { start, end: Math.min(1, end) },
        );
    }, []);

    const onScroll = useCallback(() => {
        if (rafRef.current !== undefined) {
            return;
        }
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = undefined;
            syncWindow();
        });
    }, [syncWindow]);

    /** Zoom keeping the time under `anchorPx` (viewport x) stationary. */
    const zoomBy = useCallback(
        (factor: number, anchorPx?: number) => {
            const el = hscrollRef.current;
            if (!el) {
                return;
            }
            const px = anchorPx ?? el.clientWidth / 2;
            const frac = (el.scrollLeft + px) / Math.max(1, el.scrollWidth);
            const next = Math.min(maxZoom(), Math.max(1, zoom * factor));
            if (next === zoom) {
                return;
            }
            pendingScroll.current = { frac, px };
            setZoom(next);
        },
        [zoom, maxZoom],
    );

    // Apply anchor-preserving scroll after the content width changes.
    useLayoutEffect(() => {
        const el = hscrollRef.current;
        const pending = pendingScroll.current;
        if (el && pending) {
            pendingScroll.current = undefined;
            el.scrollLeft = Math.max(0, pending.frac * el.scrollWidth - pending.px);
        }
        syncWindow();
    }, [zoom, syncWindow]);

    // Reset when the trace changes.
    useEffect(() => {
        setZoom(1);
        pendingScroll.current = undefined;
        const el = hscrollRef.current;
        if (el) {
            el.scrollLeft = 0;
        }
        setWindowFrac({ start: 0, end: 1 });
    }, [model.traceId]);

    // Wheel zoom needs a non-passive listener (preventDefault stops page scroll).
    useEffect(() => {
        const el = hscrollRef.current;
        if (!el) {
            return;
        }
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = el.getBoundingClientRect();
            const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
            zoomBy(e.deltaY > 0 ? 1 / 1.3 : 1.3, x);
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [zoomBy]);

    const onKeyDown = (e: React.KeyboardEvent) => {
        const el = hscrollRef.current;
        const key = e.key.toLowerCase();
        if (key === "w") {
            zoomBy(1.4);
        } else if (key === "s") {
            zoomBy(1 / 1.4);
        } else if (key === "a" && el) {
            el.scrollLeft -= el.clientWidth * 0.25;
        } else if (key === "d" && el) {
            el.scrollLeft += el.clientWidth * 0.25;
        } else if (key === "0" || key === "escape") {
            reset();
        } else {
            return;
        }
        e.preventDefault();
    };

    const onMouseDown = (e: React.MouseEvent) => {
        const el = hscrollRef.current;
        if (e.button !== 0 || !el) {
            return;
        }
        panState.current = { startX: e.clientX, startScroll: el.scrollLeft, moved: false };
        const onMove = (move: MouseEvent) => {
            const pan = panState.current;
            if (!pan || !el) {
                return;
            }
            const dx = move.clientX - pan.startX;
            if (Math.abs(dx) > 3) {
                pan.moved = true;
                el.scrollLeft = pan.startScroll - dx;
            }
        };
        const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            setTimeout(() => {
                panState.current = undefined;
            }, 0);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    };

    const reset = () => {
        setZoom(1);
        const el = hscrollRef.current;
        if (el) {
            el.scrollLeft = 0;
        }
    };

    const zoomToRange = (startMs: number, endMs: number) => {
        const spanMs = Math.max(MIN_WINDOW_MS, endMs - startMs);
        const next = Math.min(maxZoom(), Math.max(1, fullSpan / (spanMs * 2)));
        const centerFrac = (startMs + (endMs - startMs) / 2 - model.startEpochMs) / fullSpan;
        const el = hscrollRef.current;
        pendingScroll.current = { frac: centerFrac, px: (el?.clientWidth ?? 800) / 2 };
        setZoom(next);
    };

    const wasPan = () => panState.current?.moved === true;

    return {
        zoom,
        windowFrac,
        fullSpan,
        hscrollRef,
        onScroll,
        onKeyDown,
        onMouseDown,
        reset,
        zoomBy,
        zoomToRange,
        wasPan,
    };
}

type Zoomer = ReturnType<typeof useWaterfallZoom>;

// ---------------------------------------------------------------------------
// Chart (labels column + natively scrolling tracks)
// ---------------------------------------------------------------------------

function WfChart({
    model,
    zoomer,
    selectedBar,
    onSelect,
}: {
    model: WaterfallModel;
    zoomer: Zoomer;
    selectedBar?: string;
    onSelect: (id: string) => void;
}) {
    const lanes = useMemo(() => packLanes(model), [model]);
    const { zoom, windowFrac, fullSpan } = zoomer;
    const [trackPx, setTrackPx] = useState(1000);

    // Track the viewport width for pixel-based label visibility.
    useEffect(() => {
        const measure = () => {
            const el = zoomer.hscrollRef.current;
            if (el) {
                setTrackPx(Math.max(200, el.clientWidth));
            }
        };
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [zoomer.hscrollRef]);

    const visibleSpan = fullSpan * (windowFrac.end - windowFrac.start);
    const windowStartMs = windowFrac.start * fullSpan;
    const decimals = visibleSpan < 200 ? 4 : visibleSpan < 2000 ? 3 : 2;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
        left: f * 100,
        label: `+${((windowStartMs + f * visibleSpan) / 1000).toFixed(decimals)}s`,
    }));

    return (
        <div className="dc-wf2">
            {/* Axis shows the VISIBLE window; updates on scroll/zoom. */}
            <div className="dc-wf2-axis">
                <div className="dc-wf2-axis-label dc-muted">
                    {formatDuration(visibleSpan)} window
                </div>
                <div className="dc-wf2-axis-ticks">
                    {ticks.map((tick) => (
                        <span className="tick" style={{ left: `${tick.left}%` }} key={tick.left}>
                            {tick.label}
                        </span>
                    ))}
                </div>
            </div>
            <div className="dc-wf2-vscroll">
                <div className="dc-wf2-cols">
                    <div className="dc-wf2-labels" style={{ width: LABEL_COL_PX }}>
                        {lanes.map((lane) => (
                            <div
                                className="dc-wf2-label"
                                key={lane.lane}
                                style={{ height: lane.height }}>
                                <span
                                    className="dc-proc-dot"
                                    style={{ background: PROCESS_COLOR[lane.lane] }}
                                />
                                {PROCESS_LABEL[lane.lane] ?? lane.lane}
                                {lane.activities.length > 1 ? (
                                    <span className="dc-muted" style={{ fontSize: 10 }}>
                                        ×{lane.activities.length}
                                    </span>
                                ) : null}
                            </div>
                        ))}
                    </div>
                    <div
                        className="dc-wf2-hscroll"
                        ref={zoomer.hscrollRef}
                        tabIndex={0}
                        role="application"
                        aria-label="Waterfall timeline — scroll to zoom, drag to pan, W/S/A/D keys"
                        onScroll={zoomer.onScroll}
                        onKeyDown={zoomer.onKeyDown}
                        onMouseDown={zoomer.onMouseDown}
                        onDoubleClick={zoomer.reset}>
                        <div className="dc-wf2-inner" style={{ width: `${zoom * 100}%` }}>
                            {lanes.map((lane) => (
                                <div
                                    className="dc-wf2-track"
                                    key={lane.lane}
                                    style={{ height: lane.height }}>
                                    {lane.activities.map((activity) => {
                                        const left =
                                            ((activity.startEpochMs - model.startEpochMs) /
                                                fullSpan) *
                                            100;
                                        const widthPct = Math.max(
                                            0.05,
                                            ((activity.endEpochMs - activity.startEpochMs) /
                                                fullSpan) *
                                                100,
                                        );
                                        const official =
                                            activity.timingClass === "officialSameProcess" ||
                                            activity.timingClass === "productTimer";
                                        const row = lane.rowOf.get(activity.id) ?? 0;
                                        // Label if the bar is wide enough ON SCREEN.
                                        const barPx = (widthPct / 100) * zoom * trackPx;
                                        const showLabel = barPx > 46;
                                        return (
                                            <div
                                                key={activity.id}
                                                className={`dc-wf-bar ${official ? "" : "hatched"} ${selectedBar === activity.id ? "selected" : ""}`}
                                                style={{
                                                    left: `${left}%`,
                                                    width: `${widthPct}%`,
                                                    minWidth: 2,
                                                    top: 5 + row * ROW_HEIGHT,
                                                    background: PROCESS_COLOR[activity.lane],
                                                    opacity: official ? 0.95 : 0.75,
                                                }}
                                                title={`${activity.label} — ${formatDuration(activity.durationMs)} (${activity.timingClass})`}
                                                onClick={() => {
                                                    if (!zoomer.wasPan()) {
                                                        onSelect(activity.id);
                                                    }
                                                }}>
                                                {showLabel ? (
                                                    <span className="dc-wf-bar-label">
                                                        {activity.label}
                                                    </span>
                                                ) : null}
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Side panels + event table
// ---------------------------------------------------------------------------

function WfInspector({
    model,
    selected,
    onZoomTo,
}: {
    model: WaterfallModel;
    selected: WaterfallActivity;
    onZoomTo: (a: WaterfallActivity) => void;
}) {
    return (
        <div className="dc-card" style={{ margin: 0 }}>
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
                <span className="v">{String(selected.lane)}</span>
                <span className="k">Source events</span>
                <span className="v">{selected.sourceEventIds.join(", ")}</span>
            </div>
            <button
                className="dc-btn"
                style={{ marginTop: 6 }}
                title="Zoom the timeline to this bar"
                onClick={() => onZoomTo(selected)}>
                ⤢ Zoom to bar
            </button>
        </div>
    );
}

function WfCriticalPath({ model }: { model: WaterfallModel }) {
    const fullSpan = Math.max(1, model.endEpochMs - model.startEpochMs);
    return (
        <div className="dc-card" style={{ margin: 0 }}>
            <div className="dc-card-title">
                Critical path
                <span className="right dc-mono">{formatDuration(fullSpan)}</span>
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
                            {step.note ? <span className="dc-muted"> · {step.note}</span> : null}
                        </span>
                        <span className="dc-mono">{formatDuration(step.durationMs)}</span>
                    </div>
                ))
            )}
        </div>
    );
}

function WfEventTable({
    model,
    selectedBar,
    onSelect,
    onZoomTo,
}: {
    model: WaterfallModel;
    selectedBar?: string;
    onSelect: (id: string) => void;
    onZoomTo: (a: WaterfallActivity) => void;
}) {
    const ordered = useMemo(
        () => [...model.activities].sort((a, b) => a.startEpochMs - b.startEpochMs),
        [model.activities],
    );
    return (
        <div className="ph-pane">
            <div className="dc-toolbar ph-subbar" style={{ marginBottom: 0 }}>
                <b>Event details</b>
                <span className="dc-muted" style={{ fontSize: 11 }}>
                    {ordered.length} bar(s) · click = select + inspect · double-click = zoom to bar
                </span>
            </div>
            <div className="dc-table-wrap ph-fill-scroll ph-noselect" style={{ border: "none" }}>
                <table className="dc-table ph-dense ph-table-fixed" style={{ minWidth: 640 }}>
                    <colgroup>
                        <col style={{ width: 82 }} />
                        <col style={{ width: 118 }} />
                        <col />
                        <col style={{ width: 84 }} />
                        <col style={{ width: 168 }} />
                        <col style={{ width: 76 }} />
                    </colgroup>
                    <thead>
                        <tr>
                            <th className="num">Start</th>
                            <th>Lane</th>
                            <th>Event</th>
                            <th className="num">Duration</th>
                            <th>Timing</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {ordered.map((activity) => (
                            <tr
                                key={activity.id}
                                className={selectedBar === activity.id ? "selected" : ""}
                                onClick={() => onSelect(activity.id)}
                                onDoubleClick={() => {
                                    onSelect(activity.id);
                                    onZoomTo(activity);
                                }}>
                                <td className="num dc-mono">
                                    +{(activity.startEpochMs - model.startEpochMs).toFixed(0)}ms
                                </td>
                                <td>
                                    <span
                                        className="dc-proc-dot"
                                        style={{
                                            background: PROCESS_COLOR[activity.lane],
                                            display: "inline-block",
                                            marginRight: 5,
                                        }}
                                    />
                                    {PROCESS_LABEL[activity.lane] ?? activity.lane}
                                </td>
                                <td className="dc-mono">{activity.label}</td>
                                <td className="num dc-mono">
                                    {formatDuration(activity.durationMs)}
                                </td>
                                <td className="dc-muted">{activity.timingClass}</td>
                                <td>
                                    <StatusPill status={activity.status as DiagStatus} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

function WfDecomposition({ model }: { model: WaterfallModel }) {
    const lanes = LANE_ORDER.filter((lane) => model.activities.some((a) => a.lane === lane));
    const fullSpan = Math.max(1, model.endEpochMs - model.startEpochMs);
    const laneTotals = lanes
        .map((lane) => ({
            lane,
            ms: model.activities
                .filter((a) => a.lane === lane)
                .reduce((sum, a) => sum + a.durationMs, 0),
        }))
        .filter((entry) => entry.ms > 0);
    const stripTotal = laneTotals.reduce((sum, entry) => sum + entry.ms, 0) || 1;
    return (
        <div className="dc-card">
            <div className="dc-card-title">
                Wall-clock decomposition
                <span className="right dc-mono">{formatDuration(fullSpan)}</span>
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
                <span>
                    <span className="swatch" style={{ background: "var(--dc-proc-sts)" }} />
                    solid = monotonic
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
                    hatched = aligned diagnostic
                </span>
            </div>
        </div>
    );
}

export function WaterfallView({
    model,
    layout = "embedded",
}: {
    model: WaterfallModel;
    layout?: "full" | "embedded";
}) {
    const [selectedBar, setSelectedBar] = useState<string | undefined>(undefined);
    const zoomer = useWaterfallZoom(model);

    useEffect(() => {
        setSelectedBar(undefined);
    }, [model.traceId]);

    const selected = model.activities.find((a) => a.id === selectedBar);
    const zoomToActivity = (a: WaterfallActivity) =>
        zoomer.zoomToRange(a.startEpochMs, a.endEpochMs);

    const hintBar = (
        <div className="dc-toolbar" style={{ marginBottom: 4 }}>
            <span className="dc-muted" style={{ fontSize: 11 }}>
                scroll = zoom at cursor · drag/scrollbar = pan · W/S zoom · A/D pan · Esc/dbl-click
                = reset (click the chart to focus)
            </span>
            <span style={{ marginLeft: "auto" }} className="dc-mono dc-muted">
                zoom {zoomer.zoom < 10 ? zoomer.zoom.toFixed(1) : Math.round(zoomer.zoom)}×
            </span>
            {zoomer.zoom > 1 ? (
                <button className="dc-btn" onClick={zoomer.reset}>
                    ⟲ Reset zoom
                </button>
            ) : null}
        </div>
    );

    if (layout === "embedded") {
        return (
            <>
                <WfDecomposition model={model} />
                {hintBar}
                <WfChart
                    model={model}
                    zoomer={zoomer}
                    selectedBar={selectedBar}
                    onSelect={setSelectedBar}
                />
                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                    {selected ? (
                        <WfInspector model={model} selected={selected} onZoomTo={zoomToActivity} />
                    ) : null}
                    <WfCriticalPath model={model} />
                </div>
            </>
        );
    }

    // Full page: packed splitter grid, everything fills, no outer scrolling.
    return (
        <>
            <WfDecomposition model={model} />
            {hintBar}
            <PanelGroup direction="vertical" className="ph-split-root">
                <Panel defaultSize={58} minSize={25} className="dc-panel-min0">
                    <PanelGroup direction="horizontal" className="ph-split-inner">
                        <Panel defaultSize={66} minSize={35} className="dc-panel-min0">
                            <WfChart
                                model={model}
                                zoomer={zoomer}
                                selectedBar={selectedBar}
                                onSelect={setSelectedBar}
                            />
                        </Panel>
                        <PanelResizeHandle className="dc-resize-handle" />
                        <Panel defaultSize={34} minSize={18} className="dc-panel-min0">
                            <div
                                className="ph-pane ph-fill-scroll"
                                style={{ padding: "0 6px", gap: 8 }}>
                                {selected ? (
                                    <WfInspector
                                        model={model}
                                        selected={selected}
                                        onZoomTo={zoomToActivity}
                                    />
                                ) : (
                                    <div className="dc-muted" style={{ padding: 8, fontSize: 12 }}>
                                        Select a bar (or a row below) to inspect it.
                                    </div>
                                )}
                                <WfCriticalPath model={model} />
                            </div>
                        </Panel>
                    </PanelGroup>
                </Panel>
                <PanelResizeHandle className="dc-resize-handle horizontal" />
                <Panel defaultSize={42} minSize={15} className="dc-panel-min0">
                    <WfEventTable
                        model={model}
                        selectedBar={selectedBar}
                        onSelect={setSelectedBar}
                        onZoomTo={zoomToActivity}
                    />
                </Panel>
            </PanelGroup>
        </>
    );
}
