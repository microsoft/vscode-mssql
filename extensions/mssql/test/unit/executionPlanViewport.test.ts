/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";

import {
    getViewportForExecutionPlanScroll,
    getViewportForExecutionPlanZoom,
    getViewportToRevealExecutionPlanNode,
} from "../../src/webviews/pages/ExecutionPlan/executionPlanViewport";

suite("ExecutionPlanViewport", () => {
    // A plan 1000 tall and 300 wide in a 400 x 400 canvas: it scrolls vertically and fits across
    const planBounds = { left: 0, top: 0, right: 300, bottom: 1000 };
    const canvas = { width: 400, height: 400 };

    test("scrolls the plan with the wheel and stops at its far edge", () => {
        expect(
            getViewportForExecutionPlanScroll(
                { x: 0, y: 0, zoom: 1 },
                { x: 0, y: 100 },
                planBounds,
                canvas,
            ),
        ).to.deep.equal({ x: 0, y: -100, zoom: 1 });
        expect(
            getViewportForExecutionPlanScroll(
                { x: 0, y: -550, zoom: 1 },
                { x: 0, y: 100 },
                planBounds,
                canvas,
            ),
        ).to.deep.equal({ x: 0, y: -600, zoom: 1 });
    });

    test("hands the wheel to the page when the plan can't move that way", () => {
        // Already at the bottom
        expect(
            getViewportForExecutionPlanScroll(
                { x: 0, y: -600, zoom: 1 },
                { x: 0, y: 100 },
                planBounds,
                canvas,
            ),
        ).to.be.undefined;
        // Already at the top
        expect(
            getViewportForExecutionPlanScroll(
                { x: 0, y: 0, zoom: 1 },
                { x: 0, y: -100 },
                planBounds,
                canvas,
            ),
        ).to.be.undefined;
        // The plan fits across, so sideways scrolling doesn't move it
        expect(
            getViewportForExecutionPlanScroll(
                { x: 0, y: -200, zoom: 1 },
                { x: 100, y: 0 },
                planBounds,
                canvas,
            ),
        ).to.be.undefined;
    });

    test("scrolls the zoomed plan size and never jumps back from past an edge", () => {
        // At half zoom the plan is 500 tall, so it scrolls at most 100
        expect(
            getViewportForExecutionPlanScroll(
                { x: 0, y: 0, zoom: 0.5 },
                { x: 0, y: 300 },
                planBounds,
                canvas,
            ),
        ).to.deep.equal({ x: 0, y: -100, zoom: 0.5 });
        // Panned below the top by dragging: scrolling up stays put instead of snapping back
        expect(
            getViewportForExecutionPlanScroll(
                { x: 0, y: 50, zoom: 1 },
                { x: 0, y: -100 },
                planBounds,
                canvas,
            ),
        ).to.be.undefined;
    });

    test("zooms around the canvas origin", () => {
        const viewport = getViewportForExecutionPlanZoom({ x: -120, y: -60, zoom: 1 }, 1.5);

        expect(viewport).to.deep.equal({ x: -180, y: -90, zoom: 1.5 });
    });

    test("keeps the flow coordinate below a custom anchor fixed", () => {
        const viewport = getViewportForExecutionPlanZoom({ x: -40, y: -20, zoom: 1 }, 2, {
            x: 10,
            y: 10,
        });

        expect(viewport).to.deep.equal({ x: -90, y: -50, zoom: 2 });
    });

    test("does not calculate an invalid zoom viewport", () => {
        expect(getViewportForExecutionPlanZoom({ x: 0, y: 0, zoom: 0 }, 1)).to.be.undefined;
        expect(getViewportForExecutionPlanZoom({ x: 0, y: 0, zoom: 1 }, 0)).to.be.undefined;
    });

    test("leaves the viewport unchanged when the node is visible", () => {
        const viewport = getViewportToRevealExecutionPlanNode(
            { x: -20, y: -10, zoom: 1 },
            { x: 100, y: 60 },
            { width: 80, height: 80 },
            { width: 400, height: 300 },
            8,
        );

        expect(viewport).to.be.undefined;
    });

    test("moves only enough to reveal a node beyond the right edge", () => {
        const viewport = getViewportToRevealExecutionPlanNode(
            { x: 0, y: 0, zoom: 1 },
            { x: 250, y: 60 },
            { width: 80, height: 80 },
            { width: 300, height: 200 },
            8,
        );

        expect(viewport).to.deep.equal({ x: -38, y: 0, zoom: 1 });
    });

    test("reveals a node beyond the top-left corner without changing zoom", () => {
        const viewport = getViewportToRevealExecutionPlanNode(
            { x: -120, y: -80, zoom: 1.5 },
            { x: 60, y: 30 },
            { width: 80, height: 80 },
            { width: 400, height: 300 },
            8,
        );

        expect(viewport).to.deep.equal({ x: -82, y: -37, zoom: 1.5 });
    });
});
