/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Results-pane sizing v2 (issue A): single-grid fill, exact-fit stacked
 * splits with a small visual floor, fair-share growth with the 12-row
 * minimum, and pane scrolling once even the minimums overflow.
 */

import { expect } from "chai";
import {
    QS_FALLBACK_GRID_ROWS,
    QS_MIN_GRID_ROWS,
    QS_MIN_VISIBLE_GRID_ROWS,
    computeResultsLayout,
    qsGridContentHeight,
    type QsResultsLayoutMetrics,
} from "../../src/sharedInterfaces/queryStudioResultsLayout";

const metrics: QsResultsLayoutMetrics = {
    rowHeight: 24,
    headerHeight: 34,
    chromePx: 20,
    captionPx: 30,
};

function bodyHeights(rowCounts: number[], paneHeight: number | undefined): number[] {
    return computeResultsLayout(rowCounts, paneHeight, metrics).sizing.map((s) =>
        s.kind === "height" ? s.bodyPx : -1,
    );
}

suite("Query Studio results layout (sizing v2)", () => {
    test("no grids → empty layout", () => {
        const layout = computeResultsLayout([], 600, metrics);
        expect(layout.sizing).to.deep.equal([]);
        expect(layout.paneScrolls).to.equal(false);
    });

    test("one grid fills the pane (the grid scrollbar is THE scrollbar)", () => {
        const layout = computeResultsLayout([100000], 600, metrics);
        expect(layout.sizing).to.deep.equal([{ kind: "fill" }]);
        expect(layout.paneScrolls).to.equal(false);
    });

    test("all grids fit → each gets at least the stacked visual floor", () => {
        const layout = computeResultsLayout([5, 3], 800, metrics);
        expect(layout.paneScrolls).to.equal(false);
        expect(layout.sizing).to.deep.equal([
            { kind: "height", bodyPx: qsGridContentHeight(5, metrics) },
            { kind: "height", bodyPx: qsGridContentHeight(QS_MIN_VISIBLE_GRID_ROWS, metrics) },
        ]);
    });

    test("stacked one-row grids do not collapse into one-row slivers", () => {
        const layout = computeResultsLayout([1, 1], 800, metrics);
        expect(layout.sizing).to.deep.equal([
            { kind: "height", bodyPx: qsGridContentHeight(QS_MIN_VISIBLE_GRID_ROWS, metrics) },
            { kind: "height", bodyPx: qsGridContentHeight(QS_MIN_VISIBLE_GRID_ROWS, metrics) },
        ]);
        expect(layout.paneScrolls).to.equal(false);
    });

    test("small grids keep every row; big grids absorb the remaining space", () => {
        const pane = 900;
        const [smallPx, bigPx] = bodyHeights([5, 100000], pane);
        expect(smallPx).to.equal(qsGridContentHeight(5, metrics));
        // The big grid takes what is left of the pane (minus captions).
        const available = pane - 2 * metrics.captionPx;
        expect(bigPx).to.equal(Math.floor(available - smallPx));
        expect(bigPx).to.be.greaterThan(qsGridContentHeight(QS_MIN_GRID_ROWS, metrics));
    });

    test("two big grids split the pane evenly", () => {
        const pane = 1200;
        const [a, b] = bodyHeights([100000, 100000], pane);
        expect(a).to.equal(b);
        const available = pane - 2 * metrics.captionPx;
        expect(a).to.equal(Math.floor(available / 2));
    });

    test("tight pane: big grids floor at the 12-row minimum and the pane scrolls", () => {
        const pane = 400; // even two minimums plus captions exceed this
        const layout = computeResultsLayout([100000, 100000, 100000], pane, metrics);
        const minPx = qsGridContentHeight(QS_MIN_GRID_ROWS, metrics);
        for (const sizing of layout.sizing) {
            expect(sizing).to.deep.equal({ kind: "height", bodyPx: minPx });
        }
        expect(layout.paneScrolls).to.equal(true);
    });

    test("small grids use the visual floor rather than the large-grid floor", () => {
        const layout = computeResultsLayout([2, 100000, 100000], 400, metrics);
        expect(layout.sizing[0]).to.deep.equal({
            kind: "height",
            bodyPx: qsGridContentHeight(QS_MIN_VISIBLE_GRID_ROWS, metrics),
        });
    });

    test("unmeasured pane falls back to the visible-row cap", () => {
        const heights = bodyHeights([100000, 3], undefined);
        expect(heights[0]).to.equal(qsGridContentHeight(QS_FALLBACK_GRID_ROWS, metrics));
        expect(heights[1]).to.equal(qsGridContentHeight(QS_MIN_VISIBLE_GRID_ROWS, metrics));
    });

    test("zero-row grids reserve one visual row", () => {
        const layout = computeResultsLayout([0, 0], 800, metrics);
        expect(layout.sizing[0]).to.deep.equal({
            kind: "height",
            bodyPx: qsGridContentHeight(QS_MIN_VISIBLE_GRID_ROWS, metrics),
        });
        expect(layout.paneScrolls).to.equal(false);
    });
});
