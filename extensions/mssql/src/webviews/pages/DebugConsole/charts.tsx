/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Self-contained SVG chart primitives for the Debug Console (no chart deps).
 *  Honesty rules: show real points, annotate n, never smooth away variance. */

import { formatDuration } from "./common";

export function Sparkline({
    values,
    width = 120,
    height = 28,
    stroke = "var(--dc-link)",
}: {
    values: number[];
    width?: number;
    height?: number;
    stroke?: string;
}) {
    if (values.length < 2) {
        return (
            <span className="dc-muted dc-mono">
                {values.length === 1 ? formatDuration(values[0]) : "—"}
            </span>
        );
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const points = values
        .map(
            (value, index) =>
                `${(index / (values.length - 1)) * (width - 4) + 2},${height - 3 - ((value - min) / span) * (height - 6)}`,
        )
        .join(" ");
    return (
        <svg width={width} height={height} aria-label={`sparkline of ${values.length} values`}>
            <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.4" />
            <circle
                cx={width - 4 + 2 - ((width - 4) / (values.length - 1)) * 0}
                cy={height - 3 - ((values[values.length - 1] - min) / span) * (height - 6)}
                r="2.4"
                fill={stroke}
            />
        </svg>
    );
}

export interface TrendPoint {
    x: number;
    y: number;
    label: string;
    highlight?: boolean;
}

export function TrendChart({
    points,
    height = 200,
    unitFormat = formatDuration,
    band,
    onPick,
}: {
    points: TrendPoint[];
    height?: number;
    unitFormat?: (v: number) => string;
    /** Baseline band {center, halfWidth} drawn behind the series. */
    band?: { center: number; halfWidth: number; label: string };
    onPick?: (index: number) => void;
}) {
    const width = 720;
    const pad = { l: 56, r: 14, t: 12, b: 26 };
    if (points.length === 0) {
        return <div className="dc-muted">no data</div>;
    }
    const ys = points.map((p) => p.y);
    const bandYs = band ? [band.center - band.halfWidth, band.center + band.halfWidth] : [];
    const min = Math.min(...ys, ...bandYs);
    const max = Math.max(...ys, ...bandYs);
    const span = max - min || 1;
    const toX = (index: number) =>
        pad.l + (points.length === 1 ? 0.5 : index / (points.length - 1)) * (width - pad.l - pad.r);
    const toY = (value: number) =>
        height - pad.b - ((value - min) / span) * (height - pad.t - pad.b);
    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            width="100%"
            role="img"
            aria-label={`trend of ${points.length} points between ${unitFormat(min)} and ${unitFormat(max)}`}>
            {band ? (
                <>
                    <rect
                        x={pad.l}
                        y={toY(band.center + band.halfWidth)}
                        width={width - pad.l - pad.r}
                        height={Math.max(
                            1,
                            toY(band.center - band.halfWidth) - toY(band.center + band.halfWidth),
                        )}
                        fill="var(--dc-ok)"
                        opacity="0.08">
                        <title>{band.label}</title>
                    </rect>
                    <line
                        x1={pad.l}
                        y1={toY(band.center)}
                        x2={width - pad.r}
                        y2={toY(band.center)}
                        stroke="var(--dc-ok)"
                        strokeDasharray="4 3"
                        opacity="0.5"
                    />
                </>
            ) : null}
            <line
                x1={pad.l}
                y1={height - pad.b}
                x2={width - pad.r}
                y2={height - pad.b}
                stroke="var(--dc-border)"
            />
            {[min, (min + max) / 2, max].map((tick) => (
                <g key={tick}>
                    <text
                        x={pad.l - 6}
                        y={toY(tick) + 3.5}
                        textAnchor="end"
                        fontSize="10"
                        fill="var(--dc-muted)">
                        {unitFormat(tick)}
                    </text>
                    <line
                        x1={pad.l}
                        y1={toY(tick)}
                        x2={width - pad.r}
                        y2={toY(tick)}
                        stroke="var(--dc-border)"
                        strokeDasharray="2 4"
                        opacity="0.5"
                    />
                </g>
            ))}
            <polyline
                fill="none"
                stroke="var(--dc-link)"
                strokeWidth="1.5"
                points={points.map((point, index) => `${toX(index)},${toY(point.y)}`).join(" ")}
            />
            {points.map((point, index) => (
                <circle
                    key={index}
                    cx={toX(index)}
                    cy={toY(point.y)}
                    r={point.highlight ? 4.5 : 3}
                    fill={point.highlight ? "var(--dc-warn)" : "var(--dc-text)"}
                    style={onPick ? { cursor: "pointer" } : undefined}
                    onClick={onPick ? () => onPick(index) : undefined}>
                    <title>{point.label}</title>
                </circle>
            ))}
            <text x={width - pad.r} y={pad.t} textAnchor="end" fontSize="10" fill="var(--dc-muted)">
                n={points.length}
                {points.length < 5 ? " (small sample)" : ""}
            </text>
        </svg>
    );
}

export function Histogram({
    values,
    height = 180,
    unitFormat = formatDuration,
}: {
    values: number[];
    height?: number;
    unitFormat?: (v: number) => string;
}) {
    const width = 420;
    const pad = { l: 10, r: 10, t: 12, b: 24 };
    if (values.length === 0) {
        return <div className="dc-muted">no samples</div>;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const binCount = Math.min(18, Math.max(5, Math.ceil(Math.sqrt(values.length))));
    const bins = new Array<number>(binCount).fill(0);
    for (const value of values) {
        bins[Math.min(binCount - 1, Math.floor(((value - min) / span) * binCount))]++;
    }
    const maxBin = Math.max(...bins);
    const barWidth = (width - pad.l - pad.r) / binCount;
    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            width="100%"
            role="img"
            aria-label={`distribution of ${values.length} samples between ${unitFormat(min)} and ${unitFormat(max)}`}>
            {bins.map((count, index) => {
                const barHeight = (count / maxBin) * (height - pad.t - pad.b);
                return count > 0 ? (
                    <rect
                        key={index}
                        x={pad.l + index * barWidth + 1}
                        y={height - pad.b - barHeight}
                        width={Math.max(1, barWidth - 2)}
                        height={barHeight}
                        rx="2"
                        fill="var(--dc-link)"
                        opacity="0.75">
                        <title>
                            {unitFormat(min + (index * span) / binCount)}–
                            {unitFormat(min + ((index + 1) * span) / binCount)}: {count}
                        </title>
                    </rect>
                ) : null;
            })}
            <text x={pad.l} y={height - 8} fontSize="10" fill="var(--dc-muted)">
                {unitFormat(min)}
            </text>
            <text
                x={width - pad.r}
                y={height - 8}
                textAnchor="end"
                fontSize="10"
                fill="var(--dc-muted)">
                {unitFormat(max)}
            </text>
            <text x={width - pad.r} y={pad.t} textAnchor="end" fontSize="10" fill="var(--dc-muted)">
                n={values.length}
            </text>
        </svg>
    );
}

export function DeltaBars({
    entries,
    unitFormat = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`,
}: {
    entries: Array<{ label: string; deltaPct: number; detail?: string }>;
    unitFormat?: (v: number) => string;
}) {
    const width = 560;
    const rowHeight = 22;
    const labelWidth = 230;
    const height = entries.length * rowHeight + 8;
    if (entries.length === 0) {
        return <div className="dc-muted">no comparable metrics</div>;
    }
    const maxAbs = Math.max(...entries.map((e) => Math.abs(e.deltaPct)), 1);
    const zero = labelWidth + (width - labelWidth - 60) / 2;
    const scale = (width - labelWidth - 60) / 2 / maxAbs;
    return (
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="metric deltas">
            <line x1={zero} y1={2} x2={zero} y2={height - 2} stroke="var(--dc-border)" />
            {entries.map((entry, index) => {
                const y = index * rowHeight + 4;
                const barLength = Math.abs(entry.deltaPct) * scale;
                const x = entry.deltaPct < 0 ? zero - barLength : zero;
                const color = entry.deltaPct > 0 ? "var(--dc-error)" : "var(--dc-ok)";
                return (
                    <g key={entry.label}>
                        <text
                            x={labelWidth - 8}
                            y={y + 12}
                            textAnchor="end"
                            fontSize="10.5"
                            fill="var(--dc-text)"
                            fontFamily="var(--dc-mono)">
                            {entry.label.length > 34 ? entry.label.slice(0, 33) + "…" : entry.label}
                        </text>
                        <rect
                            x={x}
                            y={y + 2}
                            width={Math.max(1, barLength)}
                            height={rowHeight - 9}
                            rx="2"
                            fill={color}
                            opacity="0.8">
                            <title>
                                {entry.label}: {unitFormat(entry.deltaPct)}
                                {entry.detail ? ` — ${entry.detail}` : ""}
                            </title>
                        </rect>
                        <text
                            x={entry.deltaPct < 0 ? x - 4 : x + barLength + 4}
                            y={y + 12}
                            textAnchor={entry.deltaPct < 0 ? "end" : "start"}
                            fontSize="10"
                            fill="var(--dc-muted)">
                            {unitFormat(entry.deltaPct)}
                        </text>
                    </g>
                );
            })}
        </svg>
    );
}
