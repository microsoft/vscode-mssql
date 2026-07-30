/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";

import {
    ExecutionGraphComparisonResult,
    ExecutionPlanComparisonResult,
    ExecutionPlanGraphElementProperty,
    ExecutionPlanGraphElementPropertyBetterValue,
    ExecutionPlanGraphElementPropertyDataType,
    ExecutionPlanNode,
} from "../../src/sharedInterfaces/executionPlan";
import {
    buildExecutionPlanComparisonMaps,
    buildExecutionPlanComparisonPropertyRows,
} from "../../src/webviews/pages/ExecutionPlan/executionPlanComparisonModel";

function node(id: string): ExecutionPlanNode {
    return {
        id,
        type: "select",
        cost: 0,
        subTreeCost: 0,
        relativeCost: 0,
        elapsedTimeInMs: 0,
        elapsedCpuTimeInMs: 0,
        properties: [],
        name: id,
        description: "",
        subtext: [],
        children: [],
        edges: [],
        badges: [],
        rowCountDisplayString: "0",
        costDisplayString: "0%",
        costMetrics: [],
    };
}

function comparisonNode(
    id: string,
    groupIndex: number,
    matchingNodesId: number[],
    children: ExecutionGraphComparisonResult[] = [],
): ExecutionGraphComparisonResult {
    return {
        baseNode: node(id),
        children,
        groupIndex,
        hasMatch: true,
        matchingNodesId,
        parentNode: undefined!,
    };
}

function property(
    name: string,
    displayValue: string,
    overrides: Partial<ExecutionPlanGraphElementProperty> = {},
): ExecutionPlanGraphElementProperty {
    return {
        name,
        value: displayValue,
        showInTooltip: true,
        displayOrder: 1,
        positionAtBottom: false,
        displayValue,
        dataType: ExecutionPlanGraphElementPropertyDataType.String,
        betterValue: ExecutionPlanGraphElementPropertyBetterValue.None,
        ...overrides,
    };
}

suite("ExecutionPlanComparisonModel", () => {
    test("normalizes matching IDs and records only the first root for each group", () => {
        const result: ExecutionPlanComparisonResult = {
            success: true,
            errorMessage: "",
            firstComparisonResult: comparisonNode(
                "1",
                7,
                [11],
                [comparisonNode("2", 7, [12]), comparisonNode("3", 8, [13])],
            ),
            secondComparisonResult: comparisonNode(
                "11",
                7,
                [1],
                [comparisonNode("12", 7, [2]), comparisonNode("13", 8, [3])],
            ),
        };

        const maps = buildExecutionPlanComparisonMaps(result);

        expect(maps.primaryMatches.get("element-1")).to.deep.equal(["element-11"]);
        expect(maps.primaryMatches.get("element-2")).to.deep.equal(["element-12"]);
        expect([...maps.primaryGroupRoots.entries()]).to.deep.equal([
            ["element-1", 7],
            ["element-3", 8],
        ]);
        expect([...maps.secondaryGroupRoots.entries()]).to.deep.equal([
            ["element-11", 7],
            ["element-13", 8],
        ]);
    });

    test("compares numeric values, missing values, nested values, and flattens line breaks", () => {
        const rows = buildExecutionPlanComparisonPropertyRows(
            [
                property("Rows", "20", {
                    dataType: ExecutionPlanGraphElementPropertyDataType.Number,
                    betterValue: ExecutionPlanGraphElementPropertyBetterValue.LowerNumber,
                }),
                property("Description", "line 1\r\nline 2"),
                property("Nested", "", {
                    dataType: ExecutionPlanGraphElementPropertyDataType.Nested,
                    value: [property("Child", "same")],
                }),
            ],
            [
                property("Rows", "10", {
                    dataType: ExecutionPlanGraphElementPropertyDataType.Number,
                    betterValue: ExecutionPlanGraphElementPropertyBetterValue.LowerNumber,
                }),
                property("Description", "line 1\nline 2"),
                property("Nested", "", {
                    dataType: ExecutionPlanGraphElementPropertyDataType.Nested,
                    value: [property("Child", "same")],
                }),
                property("Only secondary", "value"),
            ],
        );

        expect(rows.find((row) => row.name === "Rows")?.comparison).to.equal("greater");
        expect(rows.find((row) => row.name === "Description")).to.include({
            primaryValue: "line 1 line 2",
            secondaryValue: "line 1 line 2",
            comparison: "different",
        });
        expect(rows.find((row) => row.name === "Nested")?.children[0]).to.include({
            name: "Child",
            comparison: "equal",
        });
        expect(rows.find((row) => row.name === "Only secondary")?.comparison).to.equal("different");
    });
});
