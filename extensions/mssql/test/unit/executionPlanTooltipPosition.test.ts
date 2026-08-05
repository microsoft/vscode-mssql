/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";

import {
    fitExecutionPlanTooltipPlacement,
    getExecutionPlanTooltipPlacement,
} from "../../src/webviews/pages/ExecutionPlan/executionPlanTooltipPosition";

suite("ExecutionPlanTooltipPosition", () => {
    test("places a node tooltip to the right when space is available", () => {
        const placement = getExecutionPlanTooltipPlacement(
            {
                x: 188,
                y: 100,
                sourceBounds: { left: 100, right: 180, top: 100, bottom: 180 },
            },
            { width: 1000, height: 700 },
        );

        expect(placement.left).to.equal(188);
        expect(placement.top).to.equal(100);
    });

    test("places a node tooltip to the left without covering its source", () => {
        const sourceBounds = { left: 574, right: 654, top: 168, bottom: 248 };
        const placement = getExecutionPlanTooltipPlacement(
            {
                x: sourceBounds.right + 8,
                y: sourceBounds.top,
                sourceBounds,
            },
            { width: 1063, height: 505 },
        );

        expect(placement.left).to.equal(46);
        expect(placement.left + 520).to.be.at.most(sourceBounds.left);
    });

    test("places a node tooltip vertically when neither side is wide enough", () => {
        const sourceBounds = { left: 200, right: 280, top: 100, bottom: 180 };
        const placement = getExecutionPlanTooltipPlacement(
            {
                x: sourceBounds.right + 8,
                y: sourceBounds.top,
                sourceBounds,
            },
            { width: 480, height: 700 },
        );

        expect(placement.top).to.equal(sourceBounds.bottom + 8);
        expect(placement.maxHeight).to.equal(420);
    });

    test("keeps edge tooltips inside the viewport", () => {
        const placement = getExecutionPlanTooltipPlacement(
            { x: 990, y: 690 },
            { width: 1000, height: 700 },
        );

        expect(placement.left).to.equal(472);
        expect(placement.top).to.equal(500);
        expect(placement.maxHeight).to.equal(192);
    });

    test("moves a naturally sized tooltip upward instead of clipping its bottom", () => {
        const placement = fitExecutionPlanTooltipPlacement(
            { left: 8, top: 142, maxHeight: 405 },
            { width: 520, height: 430 },
            { width: 539, height: 555 },
        );

        expect(placement.left).to.equal(8);
        expect(placement.top).to.equal(117);
        expect(placement.top + 430).to.equal(555 - 8);
        expect(placement.maxHeight).to.equal(430);
    });

    test("caps a tooltip only when its natural height exceeds the viewport", () => {
        const placement = fitExecutionPlanTooltipPlacement(
            { left: 8, top: 142, maxHeight: 405 },
            { width: 520, height: 600 },
            { width: 539, height: 555 },
        );

        expect(placement.top).to.equal(8);
        expect(placement.maxHeight).to.equal(539);
    });
});
