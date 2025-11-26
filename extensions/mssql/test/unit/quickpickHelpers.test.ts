/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { groupQuickPickItems, MssqlQuickPickItem } from "../../src/utils/quickpickHelpers";
import { QuickPickItemKind } from "vscode";

suite("Quick Pick Helpers", () => {
    test("groupQuickPickItems should group items correctly", () => {
        const items = [
            { label: "Item B1", group: "Group B" },
            { label: "Item A2", group: "Group A" },
            { label: "Item B2", group: "Group B" },
            { label: "Item A1", group: "Group A" },
            { label: "Item _1" }, // No group
        ];

        const groupedItems: MssqlQuickPickItem[] = groupQuickPickItems(items);

        const expected = [
            {
                label: "Item _1", // ungrouped items appear first
            },
            {
                label: "Group A", // groups are sorted alphabetically
                kind: QuickPickItemKind.Separator, // group headers are added in the form of separators
            },
            {
                label: "Item A2", // order is preserved within group
                group: "Group A",
            },
            {
                label: "Item A1",
                group: "Group A",
            },
            {
                label: "Group B",
                kind: QuickPickItemKind.Separator,
            },
            {
                label: "Item B1",
                group: "Group B",
            },
            {
                label: "Item B2",
                group: "Group B",
            },
        ] as MssqlQuickPickItem[];

        expect(groupedItems).to.deep.equal(
            expected,
            "Items should be grouped and organized correctly, with separators inserted for groups",
        );
    });
});
