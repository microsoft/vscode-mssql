/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Reusable cross-process waterfall renderer: wall-clock decomposition strip,
 * packed lane chart (overlapping activities stack into sub-rows), selected-bar
 * inspector, and critical path. Used by the Waterfall page (live/session
 * traces) and the Perf Test History Waterfall tab (per-rep harness traces).
 */

import { useState } from "react";
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

export function WaterfallView({ model }: { model: WaterfallModel }) {
    const [selectedBar, setSelectedBar] = useState<string | undefined>(undefined);

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
                                        const row = rowOf.get(activity.id) ?? 0;
                                        const showLabel = width > 12;
                                        return (
                                            <div
                                                key={activity.id}
                                                className={`dc-wf-bar ${official ? "" : "hatched"} ${selectedBar === activity.id ? "selected" : ""}`}
                                                style={{
                                                    left: `${left}%`,
                                                    width: `${width}%`,
                                                    top: 5 + row * ROW_HEIGHT,
                                                    background: PROCESS_COLOR[activity.lane],
                                                    opacity: official ? 0.95 : 0.75,
                                                }}
                                                title={`${activity.label} — ${formatDuration(activity.durationMs)} (${activity.timingClass})`}
                                                onClick={() => setSelectedBar(activity.id)}>
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
