/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";

import {
    ExecutionPlanGraphElementProperty,
    ExecutionPlanGraphElementPropertyBetterValue,
    ExecutionPlanGraphElementPropertyDataType,
} from "../../src/sharedInterfaces/executionPlan";
import { CompareExecutionPlanGraphsResult } from "../../src/sharedInterfaces/executionPlanComparison";
import {
    buildExecutionPlanComparisonMaps,
    buildExecutionPlanComparisonPropertyRows,
    ExecutionPlanComparisonPropertyRow,
    filterComparisonPropertyRows,
    flattenComparisonPropertyRows,
    sortComparisonPropertyRows,
} from "../../src/webviews/pages/ExecutionPlan/comparison/comparisonModel";

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

function nested(
    name: string,
    displayOrder: number,
    children: ExecutionPlanGraphElementProperty[],
): ExecutionPlanGraphElementProperty {
    return property(name, "", {
        displayOrder,
        dataType: ExecutionPlanGraphElementPropertyDataType.Nested,
        value: children,
    });
}

function names(rows: readonly ExecutionPlanComparisonPropertyRow[]): string[] {
    return rows.map((row) => row.name);
}

suite("ExecutionPlanComparisonModel", () => {
    test("normalizes matching IDs and records only the first root for each group", () => {
        const result: CompareExecutionPlanGraphsResult = {
            primary: [
                { nodeId: "1", groupIndex: 7, matchingNodeIds: ["11"] },
                { nodeId: "2", groupIndex: 7, matchingNodeIds: ["12"] },
                { nodeId: "3", groupIndex: 8, matchingNodeIds: ["13"] },
            ],
            secondary: [
                { nodeId: "11", groupIndex: 7, matchingNodeIds: ["1"] },
                { nodeId: "12", groupIndex: 7, matchingNodeIds: ["2"] },
                { nodeId: "13", groupIndex: 8, matchingNodeIds: ["3"] },
            ],
        };

        const maps = buildExecutionPlanComparisonMaps(result);

        expect(maps.primaryMatches.get("element-1")).to.deep.equal(["element-11"]);
        expect(maps.secondaryMatches.get("element-12")).to.deep.equal(["element-2"]);
        expect([...maps.primaryGroupRoots.keys()]).to.deep.equal(["element-1", "element-3"]);
        expect([...maps.secondaryGroupRoots.keys()]).to.deep.equal(["element-11", "element-13"]);
    });

    test("colors similar areas in order of appearance, matching across both plans", () => {
        // Sparse group numbers that share a remainder must still get different colors.
        const result: CompareExecutionPlanGraphsResult = {
            primary: [
                { nodeId: "1", groupIndex: 40, matchingNodeIds: ["12"] },
                { nodeId: "2", groupIndex: 4, matchingNodeIds: ["11"] },
            ],
            secondary: [
                { nodeId: "11", groupIndex: 4, matchingNodeIds: ["2"] },
                { nodeId: "12", groupIndex: 40, matchingNodeIds: ["1"] },
            ],
        };

        const maps = buildExecutionPlanComparisonMaps(result);

        expect([...maps.primaryGroupRoots]).to.deep.equal([
            ["element-1", 0],
            ["element-2", 1],
        ]);
        expect([...maps.secondaryGroupRoots]).to.deep.equal([
            ["element-11", 1],
            ["element-12", 0],
        ]);
    });

    test("compares numeric values, missing values, nested values, and preserves full values", () => {
        const rows = buildExecutionPlanComparisonPropertyRows(
            [
                property("Rows", "20", {
                    dataType: ExecutionPlanGraphElementPropertyDataType.Number,
                    betterValue: ExecutionPlanGraphElementPropertyBetterValue.LowerNumber,
                }),
                property("Description", "line 1\r\nline 2"),
                nested("Nested", 1, [property("Child", "same")]),
            ],
            [
                property("Rows", "10", {
                    dataType: ExecutionPlanGraphElementPropertyDataType.Number,
                    betterValue: ExecutionPlanGraphElementPropertyBetterValue.LowerNumber,
                }),
                property("Description", "line 1\nline 2"),
                nested("Nested", 1, [property("Child", "same")]),
                property("Only secondary", "value"),
            ],
        );

        expect(rows.find((row) => row.name === "Rows")?.comparison).to.equal("greater");
        expect(rows.find((row) => row.name === "Description")).to.include({
            primaryValue: "line 1\r\nline 2",
            secondaryValue: "line 1\nline 2",
            comparison: "different",
        });
        expect(rows.find((row) => row.name === "Nested")?.children[0]).to.include({
            name: "Child",
            comparison: "equal",
        });
        expect(rows.find((row) => row.name === "Only secondary")?.comparison).to.equal("different");
    });

    test("treats the same number written differently as equal", () => {
        const number = {
            dataType: ExecutionPlanGraphElementPropertyDataType.Number,
            betterValue: ExecutionPlanGraphElementPropertyBetterValue.LowerNumber,
        };
        const rows = buildExecutionPlanComparisonPropertyRows(
            [property("Rows", "1", number), property("Cost", "0.5", number)],
            [property("Rows", "1.0", number), property("Cost", "0.50", number)],
        );

        expect(rows.find((row) => row.name === "Rows")).to.include({
            comparison: "equal",
            hasDifference: false,
        });
        expect(rows.find((row) => row.name === "Cost")?.comparison).to.equal("equal");
    });

    test("marks a property as different when only a nested value differs", () => {
        const rows = buildExecutionPlanComparisonPropertyRows(
            [
                property("Physical Operation", "Hash Match", { displayOrder: 1 }),
                nested("Output List", 2, [property("Column a", "a"), property("Column b", "b")]),
            ],
            [
                property("Physical Operation", "Hash Match", { displayOrder: 1 }),
                nested("Output List", 2, [property("Column a", "a"), property("Column b", "c")]),
            ],
        );

        const [physicalOperation, outputList] = rows;
        expect(physicalOperation.hasDifference).to.equal(false);
        expect(outputList).to.include({ comparison: "equal", hasDifference: true });
        expect(outputList.children.map((row) => row.hasDifference)).to.deep.equal([false, true]);
    });

    test("filters nested matches without separating them from their parent", () => {
        const rows = buildExecutionPlanComparisonPropertyRows(
            [
                property("Physical Operation", "Hash Match", { displayOrder: 1 }),
                nested("Output List", 2, [property("Column a", "a"), property("Column b", "b")]),
            ],
            [],
        );

        const filtered = filterComparisonPropertyRows(rows, "column B");

        expect(names(filtered)).to.deep.equal(["Output List"]);
        expect(names(filtered[0].children)).to.deep.equal(["Column b"]);
        expect(filterComparisonPropertyRows(rows, "  ")).to.equal(rows);
    });

    test("orders numbered list items by number", () => {
        const rows = buildExecutionPlanComparisonPropertyRows(
            [
                nested(
                    "Output List",
                    1,
                    ["[10]", "[2]", "[1]"].map((name) => property(name, name)),
                ),
            ],
            [],
        );

        expect(names(rows[0].children)).to.deep.equal(["[1]", "[2]", "[10]"]);
        expect(
            names(sortComparisonPropertyRows(rows, "reverseAlphabetical")[0].children),
        ).to.deep.equal(["[10]", "[2]", "[1]"]);
    });

    test("records which plans have each property", () => {
        const [row] = buildExecutionPlanComparisonPropertyRows([], [property("Is Percent", "")]);

        expect(row).to.include({ inPrimary: false, inSecondary: true, comparison: "different" });
    });

    test("sorts siblings at each level and lists children under their expanded parent", () => {
        const rows = buildExecutionPlanComparisonPropertyRows(
            [
                nested("Output List", 1, [property("Column b", "b"), property("Column a", "a")]),
                property("Actual Rows", "1", { displayOrder: 2 }),
                property("Zebra", "z", { displayOrder: 3 }),
            ],
            [],
        );

        const sorted = sortComparisonPropertyRows(rows, "alphabetical");
        const collapsed = flattenComparisonPropertyRows(sorted, () => false);
        const expanded = flattenComparisonPropertyRows(sorted, () => true);

        expect(names(collapsed)).to.deep.equal(["Actual Rows", "Output List", "Zebra"]);
        expect(names(expanded)).to.deep.equal([
            "Actual Rows",
            "Output List",
            "Column a",
            "Column b",
            "Zebra",
        ]);
        expect(
            names(
                flattenComparisonPropertyRows(
                    sortComparisonPropertyRows(rows, "reverseAlphabetical"),
                    () => true,
                ),
            ),
        ).to.deep.equal(["Zebra", "Output List", "Column b", "Column a", "Actual Rows"]);
        expect(sortComparisonPropertyRows(rows, "importance")).to.equal(rows);
    });
});
