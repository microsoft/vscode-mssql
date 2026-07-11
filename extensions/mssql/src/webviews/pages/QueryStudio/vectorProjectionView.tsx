/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Projection workspace (VEC-6): deterministic PCA 2D scatter on a Canvas 2D
 * engine ported from the r06 mock recipe — devicePixelRatio backing store
 * sized by ResizeObserver, drag-pan and wheel-zoom-to-cursor (scale clamp
 * 6–1200) that mutate a ref and redraw directly (NEVER setState on
 * mousemove), click-pick within 7 px, Fit = bounding box × 0.86, offscreen
 * culling, +/−/0 keys. A synchronized manually-virtualized point list
 * (rowH 24) gives every point a keyboard/AT path; selection is bidirectional.
 *
 * Truth banner (≤24 px): analyzed vs rendered are SEPARATE counts (P0-8 —
 * the render cap is never called a sample) and distances are computed in the
 * original D-dimensional space, never from these coordinates.
 *
 * v1 renders a single accent color; `pointGroup` is structured for future
 * group coloring. Coordinates are allowed to the webview per spec — they are
 * still result data and never enter logs.
 */

import * as React from "react";
import { Rpc } from "./resultsGridShared";
import {
    QsVectorProjectionRequest,
    QsVectorProjectionResult,
    VectorProjectionSummary,
} from "../../../sharedInterfaces/vectorWorkbench";
import { formatCount, formatPct, formatStat, resolveToken } from "./vectorViewsShared";

export interface VectorProjectionViewProps {
    rpc: Rpc;
    /** Host-minted analysis-session handle (qs/vector.open). */
    handle: string;
    /** Generation stamp — a rerun resets via this changing. */
    generation: number;
}

/** Integration descriptor for vectorTab.tsx (rail id + mount component). */
export const vectorProjectionIntegration = {
    workspace: "projection" as const,
    label: "Projection",
    Component: VectorProjectionView,
};

const ROW_HEIGHT = 24;
const SCALE_MIN = 6;
const SCALE_MAX = 1200;
const PICK_RADIUS_SQ = 49; // ≤7 px
const FIT_PADDING = 0.86;

interface PointStore {
    readonly xs: Float64Array;
    readonly ys: Float64Array;
    readonly ordinals: Int32Array;
    /** Future group index per point (v1: all zero — single accent). */
    readonly pointGroup: Uint8Array;
    readonly count: number;
}

interface ViewTransform {
    cx: number;
    cy: number;
    scale: number;
}

export function VectorProjectionView(props: VectorProjectionViewProps): React.JSX.Element {
    const { rpc, handle, generation } = props;
    const [summary, setSummary] = React.useState<VectorProjectionSummary | undefined>();
    const [error, setError] = React.useState<string | undefined>();
    const [loading, setLoading] = React.useState(true);
    const [selected, setSelected] = React.useState(-1);
    const [listScrollTop, setListScrollTop] = React.useState(0);
    const [listHeight, setListHeight] = React.useState(0);
    const [announcement, setAnnouncement] = React.useState("");

    const wrapRef = React.useRef<HTMLDivElement | null>(null);
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
    const listRef = React.useRef<HTMLDivElement | null>(null);
    const pointsRef = React.useRef<PointStore | undefined>(undefined);
    const viewRef = React.useRef<ViewTransform>({ cx: 0, cy: 0, scale: 60 });
    const selectedRef = React.useRef(-1);
    const dragRef = React.useRef<{ x: number; y: number; moved: boolean } | undefined>(undefined);
    const scrollRafRef = React.useRef(0);

    // --- canvas engine (direct-DOM hot paths; no React state involved) ------
    const draw = React.useCallback(() => {
        const canvas = canvasRef.current;
        const points = pointsRef.current;
        if (!canvas || !points) {
            return;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            return;
        }
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;
        const view = viewRef.current;
        const bg = resolveToken(canvas, "--vscode-editor-background", "#1e1e1e");
        const axis = resolveToken(canvas, "--vscode-panel-border", "#2b2b2b");
        const accent = resolveToken(canvas, "--vscode-charts-blue", "#4daafc");
        const focus = resolveToken(canvas, "--vscode-focusBorder", "#007fd4");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        // Axis cross-hairs through the world origin.
        const originX = (0 - view.cx) * view.scale + w / 2;
        const originY = h / 2 - (0 - view.cy) * view.scale;
        ctx.strokeStyle = axis;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, originY);
        ctx.lineTo(w, originY);
        ctx.moveTo(originX, 0);
        ctx.lineTo(originX, h);
        ctx.stroke();
        // Points: offscreen culled ±6 px; single accent in v1.
        ctx.globalAlpha = 0.82;
        ctx.fillStyle = accent;
        for (let i = 0; i < points.count; i++) {
            const sx = (points.xs[i] - view.cx) * view.scale + w / 2;
            const sy = h / 2 - (points.ys[i] - view.cy) * view.scale;
            if (sx < -6 || sy < -6 || sx > w + 6 || sy > h + 6) {
                continue;
            }
            ctx.beginPath();
            ctx.arc(sx, sy, 2.4, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        const sel = selectedRef.current;
        if (sel >= 0 && sel < points.count) {
            const sx = (points.xs[sel] - view.cx) * view.scale + w / 2;
            const sy = h / 2 - (points.ys[sel] - view.cy) * view.scale;
            ctx.strokeStyle = focus;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(sx, sy, 6, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = accent;
            ctx.beginPath();
            ctx.arc(sx, sy, 2.4, 0, Math.PI * 2);
            ctx.fill();
        }
    }, []);

    const fit = React.useCallback(() => {
        const canvas = canvasRef.current;
        const points = pointsRef.current;
        if (!canvas || !points || points.count === 0) {
            return;
        }
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < points.count; i++) {
            const x = points.xs[i];
            const y = points.ys[i];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        const view = viewRef.current;
        view.cx = (minX + maxX) / 2;
        view.cy = (minY + maxY) / 2;
        const spanX = Math.max(1e-9, maxX - minX);
        const spanY = Math.max(1e-9, maxY - minY);
        view.scale = Math.min(
            SCALE_MAX,
            Math.max(SCALE_MIN, Math.min(w / spanX, h / spanY) * FIT_PADDING),
        );
        draw();
    }, [draw]);

    const zoomAt = React.useCallback(
        (factor: number, sx?: number, sy?: number) => {
            const canvas = canvasRef.current;
            if (!canvas) {
                return;
            }
            const dpr = window.devicePixelRatio || 1;
            const w = canvas.width / dpr;
            const h = canvas.height / dpr;
            const px = sx ?? w / 2;
            const py = sy ?? h / 2;
            const view = viewRef.current;
            // World point under the cursor stays fixed through the zoom.
            const wx = view.cx + (px - w / 2) / view.scale;
            const wy = view.cy - (py - h / 2) / view.scale;
            view.scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, view.scale * factor));
            view.cx = wx - (px - w / 2) / view.scale;
            view.cy = wy + (py - h / 2) / view.scale;
            draw();
        },
        [draw],
    );

    const select = React.useCallback(
        (index: number) => {
            selectedRef.current = index;
            setSelected(index);
            draw();
            const points = pointsRef.current;
            if (index >= 0 && points) {
                setAnnouncement(`Point for result row ${points.ordinals[index]} selected.`);
                const list = listRef.current;
                if (list) {
                    // Center the row; instant scroll (reduced-motion safe).
                    const target = index * ROW_HEIGHT - list.clientHeight / 2 + ROW_HEIGHT / 2;
                    list.scrollTop = Math.max(0, target);
                }
            }
        },
        [draw],
    );

    const pick = React.useCallback(
        (sx: number, sy: number) => {
            const canvas = canvasRef.current;
            const points = pointsRef.current;
            if (!canvas || !points) {
                return;
            }
            const dpr = window.devicePixelRatio || 1;
            const w = canvas.width / dpr;
            const h = canvas.height / dpr;
            const view = viewRef.current;
            let best = -1;
            let bestD = PICK_RADIUS_SQ;
            for (let i = 0; i < points.count; i++) {
                const px = (points.xs[i] - view.cx) * view.scale + w / 2;
                const py = h / 2 - (points.ys[i] - view.cy) * view.scale;
                const dx = px - sx;
                const dy = py - sy;
                const d = dx * dx + dy * dy;
                if (d < bestD) {
                    bestD = d;
                    best = i;
                }
            }
            select(best);
        },
        [select],
    );

    // --- data fetch (per handle/generation) ---------------------------------
    React.useEffect(() => {
        let cancelled = false;
        setSummary(undefined);
        setError(undefined);
        setLoading(true);
        setSelected(-1);
        selectedRef.current = -1;
        pointsRef.current = undefined;
        void (async () => {
            try {
                const result = await rpc.sendRequest<{ handle: string }, QsVectorProjectionResult>(
                    QsVectorProjectionRequest.type,
                    { handle },
                );
                if (cancelled) {
                    return;
                }
                if (result.error || !result.projection) {
                    setError(result.error ?? "The projection returned no data.");
                } else {
                    const projection = result.projection;
                    const count = projection.points.length;
                    const xs = new Float64Array(count);
                    const ys = new Float64Array(count);
                    const ordinals = new Int32Array(count);
                    for (let i = 0; i < count; i++) {
                        xs[i] = projection.points[i].x;
                        ys[i] = projection.points[i].y;
                        ordinals[i] = projection.points[i].ordinal;
                    }
                    pointsRef.current = {
                        xs,
                        ys,
                        ordinals,
                        pointGroup: new Uint8Array(count),
                        count,
                    };
                    setSummary(projection);
                }
            } catch (e) {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : String(e));
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [rpc, handle, generation]);

    // --- canvas lifecycle: DPR backing store + auto-fit once ----------------
    React.useLayoutEffect(() => {
        if (!summary) {
            return;
        }
        const wrap = wrapRef.current;
        const canvas = canvasRef.current;
        if (!wrap || !canvas) {
            return;
        }
        let fitted = false;
        const resize = () => {
            const rect = wrap.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.max(1, Math.round(rect.width * dpr));
            canvas.height = Math.max(1, Math.round(rect.height * dpr));
            if (!fitted) {
                fitted = true;
                fit(); // auto-fit once after the first complete projection
            } else {
                draw();
            }
        };
        const observer = new ResizeObserver(resize);
        observer.observe(wrap);
        resize();
        // Theme changes flip VS Code CSS vars on the root — redraw to resync
        // (colors are resolved at draw time).
        const themeObserver = new MutationObserver(() => draw());
        themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
        return () => {
            observer.disconnect();
            themeObserver.disconnect();
        };
    }, [summary, fit, draw]);

    // --- global drag listeners (capture-phase; survive leaving the canvas) --
    React.useEffect(() => {
        const move = (e: MouseEvent) => {
            const drag = dragRef.current;
            const canvas = canvasRef.current;
            if (!drag || !canvas) {
                return;
            }
            const dx = e.clientX - drag.x;
            const dy = e.clientY - drag.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) {
                drag.moved = true;
            }
            drag.x = e.clientX;
            drag.y = e.clientY;
            const view = viewRef.current;
            view.cx -= dx / view.scale;
            view.cy += dy / view.scale;
            draw(); // ref-mutating fast path — no setState on mousemove
        };
        const up = (e: MouseEvent) => {
            const drag = dragRef.current;
            const canvas = canvasRef.current;
            dragRef.current = undefined;
            if (!drag || !canvas || drag.moved) {
                return;
            }
            const rect = canvas.getBoundingClientRect();
            pick(e.clientX - rect.left, e.clientY - rect.top);
        };
        window.addEventListener("mousemove", move, { capture: true });
        window.addEventListener("mouseup", up, { capture: true });
        return () => {
            window.removeEventListener("mousemove", move, { capture: true });
            window.removeEventListener("mouseup", up, { capture: true });
        };
    }, [draw, pick]);

    // --- wheel zoom to cursor (non-passive to preventDefault) ---------------
    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !summary) {
            return;
        }
        const wheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - rect.left, e.clientY - rect.top);
        };
        canvas.addEventListener("wheel", wheel, { passive: false });
        return () => canvas.removeEventListener("wheel", wheel);
    }, [summary, zoomAt]);

    // --- list viewport measurement + rAF-throttled scroll window ------------
    React.useLayoutEffect(() => {
        if (!summary) {
            return;
        }
        const list = listRef.current;
        if (!list) {
            return;
        }
        const observer = new ResizeObserver(() => setListHeight(list.clientHeight));
        observer.observe(list);
        setListHeight(list.clientHeight);
        return () => observer.disconnect();
    }, [summary]);

    const onListScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const top = e.currentTarget.scrollTop;
        if (scrollRafRef.current !== 0) {
            return;
        }
        scrollRafRef.current = requestAnimationFrame(() => {
            scrollRafRef.current = 0;
            setListScrollTop(top);
        });
    };
    React.useEffect(
        () => () => {
            if (scrollRafRef.current !== 0) {
                cancelAnimationFrame(scrollRafRef.current);
            }
        },
        [],
    );

    const onCanvasKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "+" || e.key === "=") {
            zoomAt(1.25);
            e.preventDefault();
        } else if (e.key === "-" || e.key === "_") {
            zoomAt(0.8);
            e.preventDefault();
        } else if (e.key === "0") {
            fit();
            e.preventDefault();
        }
    };

    const onListKeyDown = (e: React.KeyboardEvent) => {
        const points = pointsRef.current;
        if (!points || points.count === 0) {
            return;
        }
        if (e.key === "ArrowDown") {
            select(Math.min(points.count - 1, selectedRef.current + 1));
            e.preventDefault();
        } else if (e.key === "ArrowUp") {
            select(Math.max(0, selectedRef.current <= 0 ? 0 : selectedRef.current - 1));
            e.preventDefault();
        } else if (e.key === "Home") {
            select(0);
            e.preventDefault();
        } else if (e.key === "End") {
            select(points.count - 1);
            e.preventDefault();
        }
    };

    if (loading) {
        return <div className="qs-vec-empty qs-muted">Computing deterministic PCA 2D…</div>;
    }
    if (error || !summary) {
        return (
            <div className="qs-vec-empty">
                <div className="qs-vec-error">{error ?? "No projection available."}</div>
            </div>
        );
    }

    const points = pointsRef.current;
    const count = points?.count ?? 0;
    const windowStart = Math.max(0, Math.floor(listScrollTop / ROW_HEIGHT) - 4);
    const windowEnd = Math.min(
        count,
        Math.ceil((listScrollTop + Math.max(listHeight, ROW_HEIGHT)) / ROW_HEIGHT) + 8,
    );
    const visible: React.JSX.Element[] = [];
    if (points) {
        for (let i = windowStart; i < windowEnd; i++) {
            visible.push(
                <div
                    key={i}
                    role="option"
                    id={`qs-vec6-point-${i}`}
                    aria-selected={selected === i}
                    className={`qs-vec6-point-row${selected === i ? " active" : ""}`}
                    style={{ top: i * ROW_HEIGHT }}
                    onClick={() => select(i)}>
                    <span className="qs-vec6-swatch" aria-hidden="true" />
                    <span className="qs-vec-num">#{formatCount(points.ordinals[i])}</span>
                    <span className="qs-vec-num qs-vec-muted qs-vec6-point-coords">
                        {formatStat(points.xs[i])} · {formatStat(points.ys[i])}
                    </span>
                </div>,
            );
        }
    }

    return (
        <div className="qs-vec6-projection">
            <div className="qs-vec6-proj-header">
                <span className="qs-vec-muted">PCA 2D · Center only</span>
                <button className="qs-vec6-secondary-btn" onClick={fit} title="Fit (0)">
                    Fit
                </button>
            </div>
            <div className="qs-vec6-truth-banner" role="note">
                PCA 2D · {formatCount(summary.analyzedCount)} analyzed,{" "}
                {formatCount(summary.renderedCount)} rendered · PC1{" "}
                {formatPct(summary.pc1VariancePct)} · PC2 {formatPct(summary.pc2VariancePct)} · next{" "}
                {formatPct(summary.nextVariancePct)} not shown · distances are computed in the
                original {formatCount(summary.dimensions)}-dimensional space, not from these
                coordinates
            </div>
            <div className="qs-vec6-proj-body">
                <div
                    ref={wrapRef}
                    className="qs-vec6-canvas-wrap"
                    role="application"
                    aria-label="PCA scatter. Drag to pan, scroll to zoom, click to pick a point. Plus and minus keys zoom, 0 fits. Use the point list for keyboard navigation."
                    tabIndex={0}
                    onKeyDown={onCanvasKeyDown}>
                    <canvas
                        ref={canvasRef}
                        className="qs-vec6-canvas"
                        onMouseDown={(e) => {
                            dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
                            e.preventDefault();
                        }}
                    />
                    <div className="qs-vec6-zoom-cluster">
                        <button aria-label="Zoom in" onClick={() => zoomAt(1.25)}>
                            +
                        </button>
                        <button aria-label="Fit" onClick={fit}>
                            ⤢
                        </button>
                        <button aria-label="Zoom out" onClick={() => zoomAt(0.8)}>
                            −
                        </button>
                    </div>
                </div>
                <div className="qs-vec6-point-panel">
                    <div className="qs-vec-section-label qs-vec6-point-header">
                        <span>Points</span>
                        <span className="qs-vec-muted">
                            {formatCount(summary.analyzedCount)} analyzed ·{" "}
                            {formatCount(summary.renderedCount)} rendered
                        </span>
                    </div>
                    <div
                        ref={listRef}
                        className="qs-vec6-point-list"
                        role="listbox"
                        aria-label="Projected points"
                        aria-activedescendant={
                            selected >= 0 ? `qs-vec6-point-${selected}` : undefined
                        }
                        tabIndex={0}
                        onScroll={onListScroll}
                        onKeyDown={onListKeyDown}>
                        <div
                            className="qs-vec6-point-spacer"
                            style={{ height: count * ROW_HEIGHT }}>
                            {visible}
                        </div>
                    </div>
                </div>
            </div>
            <div className="qs-vec6-sr-live" aria-live="polite">
                {announcement}
            </div>
        </div>
    );
}
