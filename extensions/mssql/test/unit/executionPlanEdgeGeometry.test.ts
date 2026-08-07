/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";

import { getExecutionPlanClassicArrowGeometry } from "../../src/webviews/pages/ExecutionPlan/executionPlanEdgeGeometry";

suite("ExecutionPlanEdgeGeometry", () => {
    test("creates a notched classic marker and starts the edge at its notch", () => {
        const arrow = getExecutionPlanClassicArrowGeometry(100, 50, 2);

        expect(arrow.path).to.equal("M 101 50 L 109 46 L 107 50 L 109 54 Z");
        expect(arrow.edgeSourceX).to.equal(107);
    });

    test("scales the marker with weighted edges and normalizes invalid widths", () => {
        const weighted = getExecutionPlanClassicArrowGeometry(0, 0, 6);
        const fallback = getExecutionPlanClassicArrowGeometry(0, 0, Number.NaN);

        expect(weighted.edgeSourceX).to.be.greaterThan(fallback.edgeSourceX);
        expect(fallback.edgeSourceX).to.equal(5.75);
    });
});
