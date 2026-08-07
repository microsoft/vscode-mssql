/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";

import {
    BadgeType,
    ExecutionPlanGraphElementProperty,
    ExecutionPlanGraphElementPropertyBetterValue,
    ExecutionPlanGraphElementPropertyDataType,
    ExecutionPlanNode,
    ExpensiveMetricType,
    SearchType,
} from "../../src/sharedInterfaces/executionPlan";
import {
    ExecutionPlanModel,
    getExecutionPlanEdgeWeight,
    getExpensiveMetricValue,
    getHiddenExecutionPlanElementIds,
    layoutExecutionPlan,
} from "../../src/webviews/pages/ExecutionPlan/executionPlanModel";
import { formatExecutionPlanNodeTooltip } from "../../src/webviews/pages/ExecutionPlan/executionPlanTooltip";
import { locConstants } from "../../src/webviews/common/locConstants";

function property(
    name: string,
    value: string,
    overrides: Partial<ExecutionPlanGraphElementProperty> = {},
): ExecutionPlanGraphElementProperty {
    return {
        name,
        value,
        displayValue: value,
        showInTooltip: true,
        displayOrder: 1,
        positionAtBottom: false,
        dataType: ExecutionPlanGraphElementPropertyDataType.String,
        betterValue: ExecutionPlanGraphElementPropertyBetterValue.None,
        ...overrides,
    };
}

function node(
    id: string,
    name: string,
    children: ExecutionPlanNode[] = [],
    overrides: Partial<ExecutionPlanNode> = {},
): ExecutionPlanNode {
    return {
        id,
        type: "tableScan",
        cost: 1,
        subTreeCost: 10,
        relativeCost: 0.1,
        elapsedTimeInMs: 0,
        elapsedCpuTimeInMs: 0,
        properties: [property("Physical Operation", name)],
        name,
        description: `${name} description`,
        subtext: [name],
        children,
        edges: children.map((_, index) => ({
            rowCount: index === 0 ? 100 : 0,
            rowSize: 8,
            properties: [property("Rows", String(index === 0 ? 100 : 0))],
        })),
        badges: [{ type: BadgeType.Warning, tooltip: "warning" }],
        rowCountDisplayString: "1",
        costDisplayString: "10%",
        costMetrics: [],
        ...overrides,
    };
}

suite("ExecutionPlanModel", () => {
    test("normalizes immutably with stable element IDs and deduplicated derived properties", () => {
        const source = node("root", "Root", [node("child", "Child")], {
            properties: [
                property("Physical Operation", "Root"),
                property(locConstants.executionPlan.subtreeCostLabel, "old"),
                property(locConstants.executionPlan.operatorCostLabel, "old"),
            ],
        });
        const sourceSnapshot = JSON.stringify(source);

        const first = new ExecutionPlanModel(source);
        const second = new ExecutionPlanModel(source);

        expect(JSON.stringify(source)).to.equal(sourceSnapshot);
        expect(second.nodes.map((candidate) => candidate.id)).to.deep.equal(
            first.nodes.map((candidate) => candidate.id),
        );
        expect(second.edges.map((candidate) => candidate.id)).to.deep.equal(
            first.edges.map((candidate) => candidate.id),
        );
        expect(
            first.root.properties.filter(
                (candidate) => candidate.name === locConstants.executionPlan.subtreeCostLabel,
            ),
        ).to.have.length(1);
        expect(
            first.root.properties.filter(
                (candidate) => candidate.name === locConstants.executionPlan.operatorCostLabel,
            ),
        ).to.have.length(1);
    });

    test("indexes parents, children, edges, and computes bounded edge weights", () => {
        const model = new ExecutionPlanModel(
            node("root", "Root", [node("first", "First"), node("second", "Second")]),
        );
        const [firstId, secondId] = model.getChildIds(model.root.id);
        const [firstEdge, secondEdge] = model.edges;

        expect(model.getParentId(firstId)).to.equal(model.root.id);
        expect(model.getParentId(secondId)).to.equal(model.root.id);
        expect(firstEdge.targetId).to.equal(firstId);
        expect(secondEdge.targetId).to.equal(secondId);
        expect(firstEdge.weight).to.equal(2);
        expect(secondEdge.weight).to.equal(0.5);
        expect(getExecutionPlanEdgeWeight(Number.MAX_VALUE)).to.equal(6);
    });

    test("normalizes a runtime payload with omitted edges", () => {
        const source = node("root", "Root", [node("child", "Child")]);
        delete (source as Partial<ExecutionPlanNode>).edges;

        const model = new ExecutionPlanModel(source);

        expect(model.edges).to.be.empty;
        expect(model.getChildIds(model.root.id)).to.have.length(1);
    });

    test("searches the complete plan and extracts zero-valued metrics", () => {
        const zeroMetricChild = node("zero", "Zero", [], {
            cost: 0,
            costMetrics: [{ name: "ActualRows", value: 0 }],
            properties: [property("Object", "dbo.Zero")],
        });
        const model = new ExecutionPlanModel(node("root", "Root", [zeroMetricChild]));

        expect(
            model.searchNodes({
                propertyName: "Object",
                value: "Zero",
                searchType: SearchType.Contains,
            }),
        ).to.have.length(1);
        expect(
            getExpensiveMetricValue(
                model.getNode(model.getChildIds(model.root.id)[0])!,
                ExpensiveMetricType.ActualNumberOfRowsForAllExecutions,
            ),
        ).to.equal(0);
        expect(
            model.findMostExpensiveNode((candidate) =>
                getExpensiveMetricValue(
                    candidate,
                    ExpensiveMetricType.ActualNumberOfRowsForAllExecutions,
                ),
            )?.name,
        ).to.equal("Zero");
    });

    test("preserves coordinates and nested collapse state", () => {
        const grandchild = node("grandchild", "Grandchild", [], {
            subtext: Array.from({ length: 8 }, (_, index) => `line ${index}`),
        });
        const child = node("child", "A label much wider than its parent", [grandchild]);
        const sibling = node("sibling", "Sibling");
        const model = new ExecutionPlanModel(node("root", "Root", [child, sibling]));
        const positions = layoutExecutionPlan(model, (text) => text.length * 10);
        const [childId, siblingId] = model.getChildIds(model.root.id);
        const grandchildId = model.getChildIds(childId)[0];
        const initialGrandchildPosition = { ...positions.get(grandchildId)! };

        expect(positions.get(model.root.id)!.x).to.equal(25);
        expect(positions.get(childId)!.x).to.be.greaterThan(positions.get(model.root.id)!.x);
        expect(Math.abs(positions.get(siblingId)!.y - positions.get(childId)!.y)).to.be.at.least(
            125,
        );

        const collapsed = new Set([childId, model.root.id]);
        expect([...getHiddenExecutionPlanElementIds(model, collapsed)]).to.have.members([
            childId,
            siblingId,
            grandchildId,
        ]);
        collapsed.delete(model.root.id);
        expect([...getHiddenExecutionPlanElementIds(model, collapsed)]).to.deep.equal([
            grandchildId,
        ]);
        expect(positions.get(grandchildId)).to.deep.equal(initialGrandchildPosition);
    });

    test("formats tooltip text safely and truncates flattened footer values", () => {
        const htmlLikeText = "<img src=x onerror=alert(1)>";
        const longValue = `${htmlLikeText} ${"value ".repeat(30)}`;
        const planNode = node("root", htmlLikeText, [], {
            description: htmlLikeText,
            properties: [
                property("Physical Operation", "Root"),
                property("Footer", longValue, {
                    positionAtBottom: true,
                    value: [property("Nested", longValue)],
                }),
                property("Statement", "-- comment\r\nSELECT 1", {
                    positionAtBottom: true,
                }),
                property("Predicate", longValue),
            ],
        });

        const tooltip = formatExecutionPlanNodeTooltip(planNode);

        expect(tooltip.titleLines[0]).to.equal(htmlLikeText);
        expect(tooltip.description).to.equal(htmlLikeText);
        expect(tooltip.footer[0].value).to.have.length(103);
        expect(tooltip.footer[0].value.endsWith("...")).to.be.true;
        expect(tooltip.footer[0].isSql).to.be.false;
        expect(tooltip.footer[1]).to.deep.include({
            name: "Statement",
            value: "-- comment\r\nSELECT 1",
            isSql: true,
        });
        expect(tooltip.metrics[0].value).to.have.length(103);
        expect(tooltip.metrics[0].value.endsWith("...")).to.be.true;
    });
});
