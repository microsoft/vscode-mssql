/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";

import { getExecutionPlanArrowGeometry } from "../../src/webviews/pages/ExecutionPlan/executionPlanEdgeGeometry";

suite("ExecutionPlanEdgeGeometry", () => {
    test("creates a small solid head and starts the edge just inside its base", () => {
        const arrow = getExecutionPlanArrowGeometry(100, 50);

        expect(arrow.path).to.equal("M 100 50 L 108 45.5 L 108 54.5 Z");
        expect(arrow.edgeSourceX).to.equal(107);
    });
});
