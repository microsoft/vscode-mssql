/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as ep from "../../src/sharedInterfaces/executionPlan";
import {
    calculateEdgeWeight,
    cleanNodeLabel,
    layoutExecutionPlanGraph,
} from "../../src/webviews/pages/ExecutionPlan/executionPlanLayout";

function createNode(
    id: string,
    label: string,
    children: ep.AzDataGraphCell[] = [],
): ep.AzDataGraphCell {
    return {
        id,
        label,
        tooltipTitle: label,
        rowCountDisplayString: "",
        costDisplayString: "",
        icon: "select",
        metrics: [],
        edges: children.map((_, index) => ({
            id: `${id}-edge-${index}`,
            label: "",
            metrics: [],
            weight: 1,
        })),
        children,
        description: "",
        badges: [],
        cost: 0,
        subTreeCost: 0,
        relativeCost: 0,
        elapsedTimeInMs: 0,
        costMetrics: [],
    };
}

suite("ExecutionPlanLayout", () => {
    test("lays out a branching tree from west to east without overlap", () => {
        const leftLeaf = createNode("leftLeaf", "Index Seek");
        const rightLeaf = createNode("rightLeaf", "Hash Match");
        const branch = createNode("branch", "Nested Loops", [leftLeaf, rightLeaf]);
        const root = layoutExecutionPlanGraph(createNode("root", "Select", [branch]));
        const laidOutBranch = root.children[0];
        const laidOutLeftLeaf = laidOutBranch.children[0];
        const laidOutRightLeaf = laidOutBranch.children[1];

        expect(root.position.x).to.equal(25);
        expect(laidOutBranch.position.x).to.be.greaterThan(root.position.x);
        expect(laidOutLeftLeaf.position.x).to.be.greaterThan(laidOutBranch.position.x);
        expect(laidOutRightLeaf.position.x).to.equal(laidOutLeftLeaf.position.x);
        expect(laidOutRightLeaf.position.y).to.be.greaterThan(laidOutLeftLeaf.position.y);
    });

    test("preserves edge weight formula from azdataGraph", () => {
        expect(calculateEdgeWeight(1)).to.equal(0.5);
        expect(calculateEdgeWeight(100)).to.equal(2);
        expect(calculateEdgeWeight(100_000_000)).to.equal(6);
    });

    test("cleans labels using the existing execution plan display rules", () => {
        const label = cleanNodeLabel(
            "Clustered Index Seek (Clustered)\n[dbo].[VeryLongTableNameThatShouldBeTrimmedForDisplay] [t]\nPredicate",
            "clustered_index_seek",
        );

        expect(label).to.contain("Clustered Index Seek");
        expect(label).not.to.contain("(Clustered)");
        expect(label).to.contain("...");
    });
});
