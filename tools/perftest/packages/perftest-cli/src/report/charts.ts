/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Reusable inline-SVG chart renderers (Phase-3 M14.1). Deterministic, zero
 * dependencies, self-contained output — reports open as file:// with no
 * external fetches. Factored for reuse by the Phase-4 in-product views.
 *
 * Honesty rules baked in: trend charts always draw the CI band and annotate
 * R² and n; small samples are flagged; nothing is smoothed. The waterfall
 * visually distinguishes official same-process monotonic intervals (solid)
 * from epoch-aligned diagnostic intervals (outlined) and surfaces calibration
 * jitter.
 *
 * Design tokens follow the owner's benchmark.html design system.
 */

export const TOKENS = {
    text: "#172033",
    muted: "#64748b",
    line: "#d9e0ea",
    grid: "#e2e8f0",
    panel: "#ffffff",
    ok: "#087f5b",
    warn: "#b45309",
    fail: "#b42318",
    info: "#2563eb",
    series: [
        "#2563eb",
        "#087f5b",
        "#b45309",
        "#7c3aed",
        "#0891b2",
        "#be185d",
        "#4d7c0f",
        "#b42318",
    ],
    font: 'Inter, ui-sans-serif, system-ui, "Segoe UI", sans-serif',
    mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as const;

function esc(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function fmt(value: number): string {
    if (!Number.isFinite(value)) return "—";
    const abs = Math.abs(value);
    if (abs >= 10000) return value.toFixed(0);
    if (abs >= 100) return value.toFixed(1);
    if (abs >= 1) return value.toFixed(2);
    return value.toPrecision(2);
}

/** "Nice" axis ticks covering [min,max]. */
export function niceTicks(min: number, max: number, target = 5): number[] {
    if (!(max > min)) return [min];
    const span = max - min;
    const step0 = span / target;
    const magnitude = 10 ** Math.floor(Math.log10(step0));
    const step =
        [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => span / s <= target) ??
        magnitude * 10;
    const ticks: number[] = [];
    for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) {
        ticks.push(Number(t.toPrecision(12)));
    }
    return ticks;
}

interface Frame {
    width: number;
    height: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
}

function svgOpen(frame: Frame, title: string): string {
    return (
        `<svg class="chart-svg" viewBox="0 0 ${frame.width} ${frame.height}" width="100%" ` +
        `font-family="${TOKENS.font}" font-size="11" role="img" aria-label="${esc(title)}">`
    );
}

function xAxis(frame: Frame, ticks: number[], toX: (v: number) => number, label?: string): string {
    const parts: string[] = [];
    const y = frame.height - frame.bottom;
    parts.push(
        `<line x1="${frame.left}" y1="${y}" x2="${frame.width - frame.right}" y2="${y}" stroke="${TOKENS.line}"/>`,
    );
    for (const t of ticks) {
        const x = toX(t);
        parts.push(
            `<line x1="${x}" y1="${frame.top}" x2="${x}" y2="${y}" stroke="${TOKENS.grid}" stroke-dasharray="2,3"/>`,
        );
        parts.push(
            `<text x="${x}" y="${y + 14}" text-anchor="middle" fill="${TOKENS.muted}">${fmt(t)}</text>`,
        );
    }
    if (label) {
        parts.push(
            `<text x="${(frame.left + frame.width - frame.right) / 2}" y="${frame.height - 4}" text-anchor="middle" fill="${TOKENS.muted}">${esc(label)}</text>`,
        );
    }
    return parts.join("");
}

function yAxis(frame: Frame, ticks: number[], toY: (v: number) => number, label?: string): string {
    const parts: string[] = [];
    parts.push(
        `<line x1="${frame.left}" y1="${frame.top}" x2="${frame.left}" y2="${frame.height - frame.bottom}" stroke="${TOKENS.line}"/>`,
    );
    for (const t of ticks) {
        const y = toY(t);
        parts.push(
            `<line x1="${frame.left}" y1="${y}" x2="${frame.width - frame.right}" y2="${y}" stroke="${TOKENS.grid}" stroke-dasharray="2,3"/>`,
        );
        parts.push(
            `<text x="${frame.left - 6}" y="${y + 3}" text-anchor="end" fill="${TOKENS.muted}">${fmt(t)}</text>`,
        );
    }
    if (label) {
        parts.push(
            `<text x="12" y="${(frame.top + frame.height - frame.bottom) / 2}" text-anchor="middle" fill="${TOKENS.muted}" transform="rotate(-90 12 ${(frame.top + frame.height - frame.bottom) / 2})">${esc(label)}</text>`,
        );
    }
    return parts.join("");
}

// ---------------------------------------------------------------------------
// Histogram
// ---------------------------------------------------------------------------

export function histogram(
    values: number[],
    options: { title: string; unit?: string; bins?: number; width?: number; height?: number },
): string {
    const width = options.width ?? 460;
    const height = options.height ?? 200;
    const frame: Frame = { width, height, left: 48, right: 12, top: 14, bottom: 34 };
    if (values.length === 0) {
        return `${svgOpen(frame, options.title)}<text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="${TOKENS.muted}">no samples</text></svg>`;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const binCount = options.bins ?? Math.min(24, Math.max(6, Math.ceil(Math.sqrt(values.length))));
    const span = max - min || 1;
    const counts = new Array<number>(binCount).fill(0);
    for (const v of values) {
        const bin = Math.min(binCount - 1, Math.floor(((v - min) / span) * binCount));
        counts[bin]!++;
    }
    const maxCount = Math.max(...counts);
    const toX = (v: number): number =>
        frame.left + ((v - min) / span) * (width - frame.left - frame.right);
    const toY = (c: number): number =>
        height - frame.bottom - (c / maxCount) * (height - frame.top - frame.bottom);
    const parts = [svgOpen(frame, options.title)];
    parts.push(xAxis(frame, niceTicks(min, max), toX, options.unit));
    parts.push(yAxis(frame, niceTicks(0, maxCount, 4), toY, "count"));
    const barWidth = (width - frame.left - frame.right) / binCount;
    counts.forEach((count, i) => {
        if (count === 0) return;
        const x = frame.left + i * barWidth;
        const y = toY(count);
        const lo = min + (i * span) / binCount;
        const hi = min + ((i + 1) * span) / binCount;
        parts.push(
            `<rect x="${x + 0.5}" y="${y}" width="${Math.max(1, barWidth - 1)}" height="${height - frame.bottom - y}" fill="${TOKENS.info}" opacity="0.75"><title>${fmt(lo)}–${fmt(hi)}${options.unit ? " " + esc(options.unit) : ""}: ${count}</title></rect>`,
        );
    });
    parts.push(
        `<text x="${width - frame.right}" y="${frame.top}" text-anchor="end" fill="${TOKENS.muted}">n=${values.length}${values.length < 5 ? " (small sample)" : ""}</text>`,
    );
    parts.push("</svg>");
    return parts.join("");
}

// ---------------------------------------------------------------------------
// Trend with fit + CI band (soak trends, cross-run trends)
// ---------------------------------------------------------------------------

export interface TrendFit {
    slope: number;
    intercept: number;
    slopeCi95: number;
    r2: number;
}

export function trendChart(
    points: Array<{ x: number; y: number; label?: string }>,
    options: {
        title: string;
        xLabel: string;
        yLabel: string;
        fit?: TrendFit;
        baselineBand?: { center: number; halfWidth: number; label: string };
        markers?: Array<{ x: number; label: string }>;
        width?: number;
        height?: number;
    },
): string {
    const width = options.width ?? 640;
    const height = options.height ?? 240;
    const frame: Frame = { width, height, left: 62, right: 14, top: 16, bottom: 36 };
    if (points.length === 0) {
        return `${svgOpen(frame, options.title)}<text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="${TOKENS.muted}">no data</text></svg>`;
    }
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const bandYs = options.baselineBand
        ? [
              options.baselineBand.center - options.baselineBand.halfWidth,
              options.baselineBand.center + options.baselineBand.halfWidth,
          ]
        : [];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys, ...bandYs);
    const maxY = Math.max(...ys, ...bandYs);
    const padY = (maxY - minY || 1) * 0.08;
    const toX = (v: number): number =>
        frame.left + ((v - minX) / (maxX - minX || 1)) * (width - frame.left - frame.right);
    const toY = (v: number): number =>
        height -
        frame.bottom -
        ((v - (minY - padY)) / (maxY + padY - (minY - padY))) * (height - frame.top - frame.bottom);

    const parts = [svgOpen(frame, options.title)];
    parts.push(xAxis(frame, niceTicks(minX, maxX), toX, options.xLabel));
    parts.push(yAxis(frame, niceTicks(minY - padY, maxY + padY), toY, options.yLabel));

    if (options.baselineBand) {
        const y1 = toY(options.baselineBand.center + options.baselineBand.halfWidth);
        const y2 = toY(options.baselineBand.center - options.baselineBand.halfWidth);
        parts.push(
            `<rect x="${frame.left}" y="${y1}" width="${width - frame.left - frame.right}" height="${y2 - y1}" fill="${TOKENS.ok}" opacity="0.08"><title>${esc(options.baselineBand.label)}</title></rect>`,
            `<line x1="${frame.left}" y1="${toY(options.baselineBand.center)}" x2="${width - frame.right}" y2="${toY(options.baselineBand.center)}" stroke="${TOKENS.ok}" stroke-dasharray="4,3" opacity="0.6"/>`,
        );
    }

    // CI band of the fitted line (drawn under the fit + points).
    if (options.fit) {
        const { slope, intercept, slopeCi95 } = options.fit;
        const xm = (minX + maxX) / 2;
        const yAt = (x: number, s: number): number => intercept + slope * xm + s * (x - xm);
        const upper = `M ${toX(minX)} ${toY(yAt(minX, slope + slopeCi95))} L ${toX(maxX)} ${toY(yAt(maxX, slope + slopeCi95))}`;
        const lower = `L ${toX(maxX)} ${toY(yAt(maxX, slope - slopeCi95))} L ${toX(minX)} ${toY(yAt(minX, slope - slopeCi95))} Z`;
        parts.push(`<path d="${upper} ${lower}" fill="${TOKENS.info}" opacity="0.10"/>`);
        parts.push(
            `<line x1="${toX(minX)}" y1="${toY(intercept + slope * minX)}" x2="${toX(maxX)}" y2="${toY(intercept + slope * maxX)}" stroke="${TOKENS.info}" stroke-width="1.5"/>`,
        );
    }

    for (const point of points) {
        parts.push(
            `<circle cx="${toX(point.x)}" cy="${toY(point.y)}" r="2.5" fill="${TOKENS.text}" opacity="0.55"><title>${esc(point.label ?? `${fmt(point.x)}, ${fmt(point.y)}`)}</title></circle>`,
        );
    }

    for (const marker of options.markers ?? []) {
        parts.push(
            `<line x1="${toX(marker.x)}" y1="${frame.top}" x2="${toX(marker.x)}" y2="${height - frame.bottom}" stroke="${TOKENS.fail}" stroke-dasharray="4,3"/>`,
            `<text x="${toX(marker.x) + 4}" y="${frame.top + 10}" fill="${TOKENS.fail}">${esc(marker.label)}</text>`,
        );
    }

    const annotations: string[] = [
        `n=${points.length}${points.length < 8 ? " (small sample)" : ""}`,
    ];
    if (options.fit) {
        annotations.unshift(
            `slope ${fmt(options.fit.slope)}±${fmt(options.fit.slopeCi95)}/x · R²=${options.fit.r2.toFixed(3)}`,
        );
    }
    parts.push(
        `<text x="${width - frame.right}" y="${frame.top}" text-anchor="end" fill="${TOKENS.muted}">${esc(annotations.join(" · "))}</text>`,
    );
    parts.push("</svg>");
    return parts.join("");
}

// ---------------------------------------------------------------------------
// Horizontal bars (top-N, A/B deltas)
// ---------------------------------------------------------------------------

export function horizontalBars(
    entries: Array<{ label: string; value: number; color?: string; detail?: string }>,
    options: { title: string; unit: string; width?: number; signed?: boolean },
): string {
    const width = options.width ?? 640;
    const rowHeight = 20;
    const frame: Frame = {
        width,
        height: Math.max(60, entries.length * rowHeight + 40),
        left: 230,
        right: 70,
        top: 8,
        bottom: 26,
    };
    if (entries.length === 0) {
        return `${svgOpen(frame, options.title)}<text x="${width / 2}" y="30" text-anchor="middle" fill="${TOKENS.muted}">no data</text></svg>`;
    }
    const maxAbs = Math.max(...entries.map((e) => Math.abs(e.value))) || 1;
    const zeroX = options.signed ? frame.left + (width - frame.left - frame.right) / 2 : frame.left;
    const scale =
        (options.signed
            ? (width - frame.left - frame.right) / 2
            : width - frame.left - frame.right) / maxAbs;
    const parts = [svgOpen(frame, options.title)];
    if (options.signed) {
        parts.push(
            `<line x1="${zeroX}" y1="${frame.top}" x2="${zeroX}" y2="${frame.height - frame.bottom}" stroke="${TOKENS.line}"/>`,
        );
    }
    entries.forEach((entry, i) => {
        const y = frame.top + i * rowHeight;
        const barLength = Math.abs(entry.value) * scale;
        const x = entry.value < 0 ? zeroX - barLength : zeroX;
        const color =
            entry.color ??
            (options.signed ? (entry.value > 0 ? TOKENS.fail : TOKENS.ok) : TOKENS.info);
        const label = entry.label.length > 34 ? entry.label.slice(0, 33) + "…" : entry.label;
        parts.push(
            `<text x="${frame.left - 8}" y="${y + 13}" text-anchor="end" fill="${TOKENS.text}" font-family="${TOKENS.mono}" font-size="10">${esc(label)}</text>`,
            `<rect x="${x}" y="${y + 3}" width="${Math.max(1, barLength)}" height="${rowHeight - 8}" fill="${color}" opacity="0.8" rx="2"><title>${esc(entry.detail ?? entry.label)}: ${fmt(entry.value)} ${esc(options.unit)}</title></rect>`,
            `<text x="${entry.value < 0 ? x - 4 : x + barLength + 4}" y="${y + 13}" text-anchor="${entry.value < 0 ? "end" : "start"}" fill="${TOKENS.muted}" font-size="10">${fmt(entry.value)}</text>`,
        );
    });
    parts.push(
        `<text x="${width - frame.right}" y="${frame.height - 8}" text-anchor="end" fill="${TOKENS.muted}">${esc(options.unit)}</text>`,
    );
    parts.push("</svg>");
    return parts.join("");
}

// ---------------------------------------------------------------------------
// Cross-process waterfall (M14.2)
// ---------------------------------------------------------------------------

export interface WaterfallBar {
    /** ms from timeline origin */
    startMs: number;
    endMs: number;
    name: string;
    /** "monotonic" = official same-process interval; "epoch" = cross-process aligned. */
    plane: "monotonic" | "epoch";
    color?: string;
    detail?: string;
}

export interface WaterfallLane {
    label: string;
    bars: WaterfallBar[];
}

export function waterfall(
    lanes: WaterfallLane[],
    options: {
        title: string;
        /** Calibration round-trip in ms — the honest cross-process alignment error bound. */
        calibrationJitterMs?: number;
        width?: number;
    },
): string {
    const width = options.width ?? 960;
    const laneHeight = 26;
    const frame: Frame = {
        width,
        height: Math.max(80, lanes.length * laneHeight + 58),
        left: 150,
        right: 16,
        top: 20,
        bottom: 38,
    };
    const allBars = lanes.flatMap((l) => l.bars);
    if (allBars.length === 0) {
        return `${svgOpen(frame, options.title)}<text x="${width / 2}" y="40" text-anchor="middle" fill="${TOKENS.muted}">no timeline events</text></svg>`;
    }
    const minMs = Math.min(...allBars.map((b) => b.startMs));
    const maxMs = Math.max(...allBars.map((b) => b.endMs));
    const toX = (ms: number): number =>
        frame.left + ((ms - minMs) / (maxMs - minMs || 1)) * (width - frame.left - frame.right);

    const parts = [svgOpen(frame, options.title)];
    parts.push(
        xAxis(frame, niceTicks(minMs, maxMs, 8), toX, "ms from scenario start (epoch-aligned)"),
    );
    lanes.forEach((lane, i) => {
        const y = frame.top + i * laneHeight;
        parts.push(
            `<text x="${frame.left - 8}" y="${y + 15}" text-anchor="end" fill="${TOKENS.text}" font-size="11">${esc(lane.label)}</text>`,
        );
        if (i % 2 === 1) {
            parts.push(
                `<rect x="${frame.left}" y="${y}" width="${width - frame.left - frame.right}" height="${laneHeight}" fill="${TOKENS.grid}" opacity="0.25"/>`,
            );
        }
        for (const bar of lane.bars) {
            const x = toX(bar.startMs);
            const barWidth = Math.max(1.5, toX(bar.endMs) - x);
            const color = bar.color ?? TOKENS.info;
            const durMs = bar.endMs - bar.startMs;
            const title = `${bar.name} — ${fmt(durMs)}ms [${bar.startMs.toFixed(1)}→${bar.endMs.toFixed(1)}] (${bar.plane === "monotonic" ? "official monotonic interval" : "epoch-aligned, ±calibration jitter"})${bar.detail ? " — " + bar.detail : ""}`;
            if (bar.plane === "monotonic") {
                parts.push(
                    `<rect x="${x}" y="${y + 5}" width="${barWidth}" height="${laneHeight - 11}" fill="${color}" opacity="0.85" rx="2"><title>${esc(title)}</title></rect>`,
                );
            } else {
                // Epoch-aligned diagnostic intervals: outlined, translucent — visually
                // honest about the weaker alignment guarantee.
                parts.push(
                    `<rect x="${x}" y="${y + 5}" width="${barWidth}" height="${laneHeight - 11}" fill="${color}" opacity="0.28" stroke="${color}" stroke-width="1" stroke-dasharray="3,2" rx="2"><title>${esc(title)}</title></rect>`,
                );
            }
            if (barWidth > 46) {
                parts.push(
                    `<text x="${x + 3}" y="${y + 16}" fill="#fff" font-size="9" style="paint-order:stroke" stroke="${color}" stroke-width="2">${esc(bar.name.length > Math.floor(barWidth / 6) ? bar.name.slice(0, Math.floor(barWidth / 6)) + "…" : bar.name)}</text>`,
                );
            }
        }
    });
    const legendY = frame.height - 10;
    parts.push(
        `<rect x="${frame.left}" y="${legendY - 8}" width="14" height="8" fill="${TOKENS.info}" opacity="0.85" rx="1"/>`,
        `<text x="${frame.left + 18}" y="${legendY}" fill="${TOKENS.muted}">official monotonic</text>`,
        `<rect x="${frame.left + 120}" y="${legendY - 8}" width="14" height="8" fill="${TOKENS.info}" opacity="0.28" stroke="${TOKENS.info}" stroke-dasharray="3,2" rx="1"/>`,
        `<text x="${frame.left + 138}" y="${legendY}" fill="${TOKENS.muted}">epoch-aligned (diagnostic)${options.calibrationJitterMs !== undefined ? ` · clock calibration round-trip ${fmt(options.calibrationJitterMs)}ms` : ""}</text>`,
    );
    parts.push("</svg>");
    return parts.join("");
}
