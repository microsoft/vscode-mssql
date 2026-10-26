/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Results-pane sizing v2 (issue A): pure layout math shared by the Query
 * Studio webview and the unit tests (webview-safe by convention — no
 * vscode/DOM imports, same pattern as queryStudioGridOps).
 *
 * Rules (Karl's spec, SSMS tie-breaks):
 * - One grid → fill the whole results area; the grid's virtualized
 *   scrollbar is THE scrollbar (no dead space, no pane scroll).
 * - Multiple grids, all of whose rows fit in the visible area → each grid
 *   gets exact content height with a one-row floor (no pane scroll unless
 *   those visual floors themselves overflow).
 * - Otherwise: grids whose full content fits within their fair share keep
 *   every row; the remaining space splits evenly among the rest with a
 *   per-grid minimum of QS_MIN_GRID_ROWS data rows. When even the minimums
 *   exceed the pane, the stack overflows and the pane scrolls.
 * - A maximized grid fills the pane alone (handled by the caller).
 */

export const QS_MIN_GRID_ROWS = 12;

/** Minimum visible rows for stacked grids even when a set has zero rows. */
export const QS_MIN_VISIBLE_GRID_ROWS = 1;

/** Fallback rows per grid while the pane height is still unmeasured. */
export const QS_FALLBACK_GRID_ROWS = 14;

export interface QsResultsLayoutMetrics {
    /** Pixel height of one data row (grid rowHeight). */
    rowHeight: number;
    /** Grid header strip height in px. */
    headerHeight: number;
    /** Per-grid chrome: borders + horizontal scrollbar allowance, px. */
    chromePx: number;
    /** Per-grid strip above the body: caption row + block margin, px. */
    captionPx: number;
    /** Minimum data rows for a grid that cannot show everything. */
    minRows?: number;
    /** Minimum visible data rows for any stacked grid. */
    minVisibleRows?: number;
}

export type QsGridSizing = { kind: "fill" } | { kind: "height"; bodyPx: number };

export interface QsResultsLayout {
    sizing: QsGridSizing[];
    /** True when the stacked blocks exceed the pane — the pane scrolls. */
    paneScrolls: boolean;
}

/** Body height (header + rows + chrome) needed to show every row. */
export function qsGridContentHeight(rowCount: number, metrics: QsResultsLayoutMetrics): number {
    return metrics.headerHeight + Math.max(rowCount, 1) * metrics.rowHeight + metrics.chromePx;
}

export function computeResultsLayout(
    rowCounts: readonly number[],
    paneHeight: number | undefined,
    metrics: QsResultsLayoutMetrics,
): QsResultsLayout {
    const n = rowCounts.length;
    if (n === 0) {
        return { sizing: [], paneScrolls: false };
    }
    if (n === 1) {
        // The lone grid IS the pane — its scrollbar is THE scrollbar.
        return { sizing: [{ kind: "fill" }], paneScrolls: false };
    }

    const visualFloor = qsGridContentHeight(
        metrics.minVisibleRows ?? QS_MIN_VISIBLE_GRID_ROWS,
        metrics,
    );
    const contents = rowCounts.map((rows) =>
        Math.max(qsGridContentHeight(rows, metrics), visualFloor),
    );

    if (paneHeight === undefined || paneHeight <= 0) {
        // Unmeasured first paint: content height capped at the fallback rows;
        // the ResizeObserver measurement corrects this on the next frame.
        const cap = qsGridContentHeight(QS_FALLBACK_GRID_ROWS, metrics);
        return {
            sizing: contents.map((px) => ({ kind: "height", bodyPx: Math.min(px, cap) })),
            paneScrolls: false,
        };
    }

    const available = paneHeight - n * metrics.captionPx;
    const total = contents.reduce((sum, px) => sum + px, 0);
    if (total <= available) {
        // Every grid can show every row: split the area to fit each exactly.
        return {
            sizing: contents.map((px) => ({ kind: "height", bodyPx: px })),
            paneScrolls: false,
        };
    }

    // Fair-share allocation: grids whose full content fits within the
    // current fair share keep every row (they never grow past content);
    // the freed space re-splits among the remaining grids.
    const assigned = new Array<number | undefined>(n).fill(undefined);
    let remaining = available;
    let open = contents.map((_px, i) => i);
    for (;;) {
        const fair = remaining / open.length;
        const fitting = open.filter((i) => contents[i] <= fair);
        if (fitting.length === 0) {
            break;
        }
        for (const i of fitting) {
            assigned[i] = contents[i];
            remaining -= contents[i];
        }
        open = open.filter((i) => assigned[i] === undefined);
        if (open.length === 0) {
            break;
        }
    }
    if (open.length > 0) {
        const minPx = qsGridContentHeight(metrics.minRows ?? QS_MIN_GRID_ROWS, metrics);
        const fair = Math.floor(remaining / open.length);
        for (const i of open) {
            // At least the minimum, never more than the grid's own content.
            assigned[i] = Math.min(Math.max(fair, minPx), contents[i]);
        }
    }
    const sizing = assigned.map((px) => ({ kind: "height" as const, bodyPx: px ?? 0 }));
    const assignedTotal = sizing.reduce((sum, s) => sum + s.bodyPx, 0);
    return { sizing, paneScrolls: assignedTotal > available + 1 || available < 0 };
}
