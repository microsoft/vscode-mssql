/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Reusable cross-process waterfall renderer with a Perfetto-style viewport:
 *   - mouse wheel zooms around the cursor
 *   - W/S zoom in/out, A/D pan (click the chart first to focus it)
 *   - drag the track background to pan; double-click to reset
 *   - bar labels appear as zoom makes them wide enough
 * Plus the wall-clock decomposition strip, selected-bar inspector, critical
 * path, and (optionally) a master/detail "Event details" table listing every
 * bar — the fix for "you can't tell what anything is when bars are small".
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { DiagProcess, WaterfallModel } from "../../../sharedInterfaces/debugConsole";
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

interface Viewport {
    start: number;
    end: number;
}

const MIN_SPAN_MS = 1;

export function WaterfallView({
    model,
    showEventTable = false,
}: {
    model: WaterfallModel;
    showEventTable?: boolean;
}) {
    const [selectedBar, setSelectedBar] = useState<string | undefined>(undefined);
    const [view, setView] = useState<Viewport | undefined>(undefined);
    const chartRef = useRef<HTMLDivElement>(null);
    const panRef = useRef<{ startX: number; view: Viewport; moved: boolean } | undefined>(
        undefined,
    );

    const fullSpan = Math.max(1, model.endEpochMs - model.startEpochMs);
    const effective: Viewport = view ?? { start: model.startEpochMs, end: model.endEpochMs };
    const span = Math.max(MIN_SPAN_MS, effective.end - effective.start);
    const zoomed = view !== undefined;

    // A new trace resets the viewport and selection.
    useEffect(() => {
        setView(undefined);
        setSelectedBar(undefined);
    }, [model.traceId]);

    const clampView = (start: number, end: number): Viewport | undefined => {
        let s = start;
        let e = end;
        const requested = Math.max(MIN_SPAN_MS, e - s);
        if (requested >= fullSpan) {
            return undefined; // fully zoomed out
        }
        if (s < model.startEpochMs) {
            s = model.startEpochMs;
            e = s + requested;
        }
        if (e > model.endEpochMs) {
            e = model.endEpochMs;
            s = e - requested;
        }
        return { start: s, end: e };
    };

    const zoomAt = (anchorTime: number, factor: number) => {
        const newSpan = Math.max(MIN_SPAN_MS, Math.min(fullSpan, span * factor));
        const ratio = (anchorTime - effective.start) / span;
        const start = anchorTime - ratio * newSpan;
        setView(clampView(start, start + newSpan));
    };

    const panBy = (deltaMs: number) => {
        setView(clampView(effective.start + deltaMs, effective.end + deltaMs));
    };

    // Wheel zoom needs a non-passive listener (preventDefault stops page scroll).
    useEffect(() => {
        const el = chartRef.current;
        if (!el) {
            return;
        }
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = el.getBoundingClientRect();
            const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
            const anchor = effective.start + (x / Math.max(1, rect.width)) * span;
            zoomAt(anchor, e.deltaY > 0 ? 1.3 : 1 / 1.3);
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    });

    const onKeyDown = (e: React.KeyboardEvent) => {
        const key = e.key.toLowerCase();
        if (key === "w") {
            zoomAt(effective.start + span / 2, 1 / 1.4);
        } else if (key === "s") {
            zoomAt(effective.start + span / 2, 1.4);
        } else if (key === "a") {
            panBy(-span * 0.2);
        } else if (key === "d") {
            panBy(span * 0.2);
        } else if (key === "0" || key === "escape") {
            setView(undefined);
            return;
        } else {
            return;
        }
        e.preventDefault();
    };

    const onMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) {
            return;
        }
        panRef.current = { startX: e.clientX, view: effective, moved: false };
        const onMove = (move: MouseEvent) => {
            const pan = panRef.current;
            const el = chartRef.current;
            if (!pan || !el) {
                return;
            }
            const dx = move.clientX - pan.startX;
            if (Math.abs(dx) > 3) {
                pan.moved = true;
                const deltaMs =
                    (-dx / Math.max(1, el.clientWidth)) * (pan.view.end - pan.view.start);
                setView(clampView(pan.view.start + deltaMs, pan.view.end + deltaMs));
            }
        };
        const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            // keep panRef.moved until the click event fires (suppression)
            setTimeout(() => {
                panRef.current = undefined;
            }, 0);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    };

    const selectBar = (id: string) => {
        if (panRef.current?.moved) {
            return; // that click was a pan, not a selection
        }
        setSelectedBar(id);
    };

    const lanes = LANE_ORDER.filter((lane) => model.activities.some((a) => a.lane === lane));
    const selected = model.activities.find((a) => a.id === selectedBar);

    // Wall-clock decomposition per lane (whole trace, viewport-independent).
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
        label: `+${((effective.start - model.startEpochMs + f * span) / 1000).toFixed(span < 2000 ? 3 : 2)}s`,
    }));

    const orderedActivities = useMemo(
        () => [...model.activities].sort((a, b) => a.startEpochMs - b.startEpochMs),
        [model.activities],
    );

    return (
        <>
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

            <div className="dc-toolbar" style={{ marginBottom: 4 }}>
                <span className="dc-muted" style={{ fontSize: 11 }}>
                    scroll = zoom at cursor · drag = pan · W/S zoom · A/D pan · Esc/dbl-click =
                    reset (click the chart to focus)
                </span>
                <span style={{ marginLeft: "auto" }} className="dc-mono dc-muted">
                    window {formatDuration(span)}
                    {zoomed ? ` of ${formatDuration(fullSpan)}` : " (full trace)"}
                </span>
                {zoomed ? (
                    <button className="dc-btn" onClick={() => setView(undefined)}>
                        ⟲ Reset zoom
                    </button>
                ) : null}
            </div>

            <div className="dc-two-col">
                <div
                    className="dc-wf dc-wf-zoomable"
                    ref={chartRef}
                    tabIndex={0}
                    role="application"
                    aria-label="Waterfall timeline — scroll to zoom, drag to pan, W/S/A/D keys"
                    onKeyDown={onKeyDown}
                    onMouseDown={onMouseDown}
                    onDoubleClick={() => setView(undefined)}>
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
                    {lanes.map((lane) => {
                        // Row packing: overlapping activities stack into
                        // sub-rows instead of piling onto one line.
                        const laneActivities = model.activities
                            .filter((a) => a.lane === lane)
                            .sort((a, b) => a.startEpochMs - b.startEpochMs);
                        const rowEnds: number[] = [];
                        const rowOf = new Map<string, number>();
                        for (const activity of laneActivities) {
                            let row = rowEnds.findIndex(
                                (end) => end <= activity.startEpochMs + 0.01,
                            );
                            if (row < 0) {
                                row = rowEnds.length;
                                rowEnds.push(0);
                            }
                            rowEnds[row] = activity.endEpochMs;
                            rowOf.set(activity.id, row);
                        }
                        const ROW_HEIGHT = 22;
                        const laneHeight = Math.max(30, rowEnds.length * ROW_HEIGHT + 8);
                        return (
                            <div className="dc-wf-lane" key={lane}>
                                <div className="dc-wf-lane-label">
                                    <span
                                        className="dc-proc-dot"
                                        style={{ background: PROCESS_COLOR[lane] }}
                                    />
                                    {PROCESS_LABEL[lane] ?? lane}
                                    {rowEnds.length > 1 ? (
                                        <span className="dc-muted" style={{ fontSize: 10 }}>
                                            ×{laneActivities.length}
                                        </span>
                                    ) : null}
                                </div>
                                <div className="dc-wf-track" style={{ minHeight: laneHeight }}>
                                    {laneActivities.map((activity) => {
                                        const left =
                                            ((activity.startEpochMs - effective.start) / span) *
                                            100;
                                        const width = Math.max(
                                            0.35,
                                            ((activity.endEpochMs - activity.startEpochMs) / span) *
                                                100,
                                        );
                                        // Outside the viewport: skip entirely.
                                        if (left + width < -1 || left > 101) {
                                            return null;
                                        }
                                        const official =
                                            activity.timingClass === "officialSameProcess" ||
                                            activity.timingClass === "productTimer";
                                        const row = rowOf.get(activity.id) ?? 0;
                                        // Labels appear as zoom makes bars wide
                                        // enough (viewport-relative width).
                                        const showLabel = width > 7;
                                        return (
                                            <div
                                                key={activity.id}
                                                className={`dc-wf-bar ${official ? "" : "hatched"} ${selectedBar === activity.id ? "selected" : ""}`}
                                                style={{
                                                    left: `${left}%`,
                                                    width: `${Math.min(width, 200)}%`,
                                                    top: 5 + row * ROW_HEIGHT,
                                                    background: PROCESS_COLOR[activity.lane],
                                                    opacity: official ? 0.95 : 0.75,
                                                }}
                                                title={`${activity.label} — ${formatDuration(activity.durationMs)} (${activity.timingClass})`}
                                                onClick={() => selectBar(activity.id)}>
                                                {showLabel ? (
                                                    <span
                                                        style={{
                                                            position: "absolute",
                                                            left: 4,
                                                            top: 1,
                                                            fontSize: 9.5,
                                                            color: "#fff",
                                                            whiteSpace: "nowrap",
                                                            overflow: "hidden",
                                                            maxWidth: "calc(100% - 6px)",
                                                            textShadow: "0 0 3px rgba(0,0,0,.6)",
                                                            pointerEvents: "none",
                                                        }}>
                                                        {activity.label}
                                                    </span>
                                                ) : null}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
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
                            <button
                                className="dc-btn"
                                style={{ marginTop: 6 }}
                                title="Zoom the timeline to this bar"
                                onClick={() => {
                                    const pad =
                                        Math.max(1, selected.endEpochMs - selected.startEpochMs) *
                                        0.5;
                                    setView(
                                        clampView(
                                            selected.startEpochMs - pad,
                                            selected.endEpochMs + pad,
                                        ),
                                    );
                                }}>
                                ⤢ Zoom to bar
                            </button>
                        </div>
                    ) : null}
                    <div className="dc-card">
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

            {showEventTable ? (
                <div className="dc-card" style={{ marginTop: 10 }}>
                    <div className="dc-card-title">
                        Event details
                        <span className="right">
                            {orderedActivities.length} bar(s) · click = select + inspect ·
                            double-click = zoom to bar
                        </span>
                    </div>
                    <div className="dc-table-wrap" style={{ maxHeight: 300, border: "none" }}>
                        <table className="dc-table ph-dense ph-table-fixed">
                            <colgroup>
                                <col style={{ width: 76 }} />
                                <col style={{ width: 110 }} />
                                <col />
                                <col style={{ width: 84 }} />
                                <col style={{ width: 170 }} />
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
                                {orderedActivities.map((activity) => (
                                    <tr
                                        key={activity.id}
                                        className={selectedBar === activity.id ? "selected" : ""}
                                        onClick={() => setSelectedBar(activity.id)}
                                        onDoubleClick={() => {
                                            const pad =
                                                Math.max(
                                                    1,
                                                    activity.endEpochMs - activity.startEpochMs,
                                                ) * 0.5;
                                            setView(
                                                clampView(
                                                    activity.startEpochMs - pad,
                                                    activity.endEpochMs + pad,
                                                ),
                                            );
                                            setSelectedBar(activity.id);
                                        }}>
                                        <td className="num dc-mono">
                                            +
                                            {(activity.startEpochMs - model.startEpochMs).toFixed(
                                                0,
                                            )}
                                            ms
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
                                            <StatusPill status={activity.status} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : null}
        </>
    );
}
