/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { orderItemsParentFirst } from "../../src/utils/hierarchyUtils";

interface TestHierarchyItem {
    id: string;
    parentId?: string;
}

suite("Hierarchy Utils Tests", () => {
    test("orders parents before children while preserving sibling order", () => {
        const childOne = { id: "child-one", parentId: "parent" };
        const childTwo = { id: "child-two", parentId: "parent" };
        const parent = { id: "parent", parentId: "root" };

        const result = orderItemsParentFirst<TestHierarchyItem>(
            [childOne, childTwo, parent],
            (item) => item.id,
            (item) => item.parentId,
            new Set(["root"]),
        );

        expect(result.orderedItems).to.deep.equal([parent, childOne, childTwo]);
        expect(result.unresolvedItems).to.be.empty;
    });

    test("returns items with missing parents as unresolved", () => {
        const orphan = { id: "orphan", parentId: "missing" };

        const result = orderItemsParentFirst<TestHierarchyItem>(
            [orphan],
            (item) => item.id,
            (item) => item.parentId,
        );

        expect(result.orderedItems).to.be.empty;
        expect(result.unresolvedItems).to.deep.equal([orphan]);
    });

    test("returns cycles and their dependents as unresolved", () => {
        const groupA = { id: "group-a", parentId: "group-b" };
        const groupB = { id: "group-b", parentId: "group-a" };
        const child = { id: "child", parentId: "group-a" };

        const result = orderItemsParentFirst<TestHierarchyItem>(
            [groupA, groupB, child],
            (item) => item.id,
            (item) => item.parentId,
        );

        expect(result.orderedItems).to.be.empty;
        expect(result.unresolvedItems).to.deep.equal([groupA, groupB, child]);
    });
});
