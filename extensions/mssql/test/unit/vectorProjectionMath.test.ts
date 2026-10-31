/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    VECTOR_PROJECTION_SCALE_MAX,
    VECTOR_PROJECTION_SCALE_MIN,
    VECTOR_PROJECTION_ZOOM_OUT_RATIO,
    computeProjectionFit,
    projectionShowsAnyPoint,
    projectionZoomFloor,
} from "../../src/webviews/pages/QueryStudio/vectorProjectionMath";

function points(coords: Array<[number, number]>) {
    return {
        xs: coords.map(([x]) => x),
        ys: coords.map(([, y]) => y),
        count: coords.length,
    };
}

suite("vectorProjectionMath", () => {
    suite("computeProjectionFit", () => {
        test("frames every point inside the viewport with padding", () => {
            const store = points([
                [-2, -1],
                [2, 1],
                [0, 0],
            ]);
            const fit = computeProjectionFit(store, 800, 600)!;
            expect(fit.cx).to.equal(0);
            expect(fit.cy).to.equal(0);
            // width-limited: (800 / 4) * 0.86
            expect(fit.scale).to.be.closeTo(172, 1e-9);
            expect(projectionShowsAnyPoint(store, fit, 800, 600)).to.equal(true);
        });

        test("wide PCA spreads fit at scales below the legacy minimum", () => {
            // Unnormalized embeddings: hundreds of world units of spread. The
            // old clamp forced scale >= 6 and pushed every point offscreen —
            // the "always zoom out first" bug.
            const store = points([
                [-300, -200],
                [300, 200],
            ]);
            const fit = computeProjectionFit(store, 800, 600)!;
            expect(fit.scale).to.be.lessThan(VECTOR_PROJECTION_SCALE_MIN);
            expect(fit.scale).to.be.closeTo((800 / 600) * 0.86, 1e-9);
            expect(projectionShowsAnyPoint(store, fit, 800, 600)).to.equal(true);
        });

        test("degenerate single-point extents cap at the shared maximum", () => {
            const fit = computeProjectionFit(points([[5, 7]]), 800, 600)!;
            expect(fit.scale).to.equal(VECTOR_PROJECTION_SCALE_MAX);
            expect(fit.cx).to.equal(5);
            expect(fit.cy).to.equal(7);
        });

        test("returns undefined for empty stores and unusable canvases", () => {
            expect(computeProjectionFit(points([]), 800, 600)).to.equal(undefined);
            expect(computeProjectionFit(points([[1, 1]]), 1, 600)).to.equal(undefined);
            expect(computeProjectionFit(points([[1, 1]]), 800, 0)).to.equal(undefined);
        });

        test("skips non-finite coordinates instead of poisoning the frame", () => {
            const store = {
                xs: [NaN, -1, 1, Infinity],
                ys: [0, -1, 1, 0],
                count: 4,
            };
            const fit = computeProjectionFit(store, 800, 600)!;
            expect(fit.cx).to.equal(0);
            expect(fit.cy).to.equal(0);
            expect(Number.isFinite(fit.scale)).to.equal(true);
        });

        test("all-non-finite stores return undefined", () => {
            expect(computeProjectionFit({ xs: [NaN], ys: [NaN], count: 1 }, 800, 600)).to.equal(
                undefined,
            );
        });
    });

    suite("projectionZoomFloor", () => {
        test("legacy absolute floor without a known fit", () => {
            expect(projectionZoomFloor(undefined)).to.equal(VECTOR_PROJECTION_SCALE_MIN);
            expect(projectionZoomFloor(NaN)).to.equal(VECTOR_PROJECTION_SCALE_MIN);
            expect(projectionZoomFloor(0)).to.equal(VECTOR_PROJECTION_SCALE_MIN);
        });

        test("sits below a small fit so zooming back out stays reachable", () => {
            const floor = projectionZoomFloor(1.2);
            expect(floor).to.be.closeTo(1.2 / VECTOR_PROJECTION_ZOOM_OUT_RATIO, 1e-12);
            expect(floor).to.be.lessThan(1.2);
        });

        test("never exceeds the legacy floor for large fits", () => {
            expect(projectionZoomFloor(600)).to.equal(VECTOR_PROJECTION_SCALE_MIN);
        });
    });

    suite("projectionShowsAnyPoint", () => {
        test("true when a point lands inside the viewport", () => {
            const store = points([[0, 0]]);
            expect(projectionShowsAnyPoint(store, { cx: 0, cy: 0, scale: 60 }, 800, 600)).to.equal(
                true,
            );
        });

        test("false when a restored camera frames none of the data", () => {
            // Camera saved against a different column: data lives far away.
            const store = points([
                [1000, 1000],
                [1001, 1001],
            ]);
            expect(projectionShowsAnyPoint(store, { cx: 0, cy: 0, scale: 60 }, 800, 600)).to.equal(
                false,
            );
        });

        test("false for empty stores and non-positive scales", () => {
            expect(
                projectionShowsAnyPoint(points([]), { cx: 0, cy: 0, scale: 60 }, 800, 600),
            ).to.equal(false);
            expect(
                projectionShowsAnyPoint(points([[0, 0]]), { cx: 0, cy: 0, scale: 0 }, 800, 600),
            ).to.equal(false);
        });

        test("honors the margin used by the draw cull", () => {
            const store = points([[0, 0]]);
            // Point projects 4px left of the viewport: visible with the
            // default 6px margin, invisible with a zero margin.
            const view = { cx: 404 / 60, cy: 0, scale: 60 };
            expect(projectionShowsAnyPoint(store, view, 800, 600, 6)).to.equal(true);
            expect(projectionShowsAnyPoint(store, view, 800, 600, 0)).to.equal(false);
        });
    });
});
