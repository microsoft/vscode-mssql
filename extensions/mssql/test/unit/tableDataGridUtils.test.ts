/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    clearRevertedCellChanges,
    hasPendingChangesForRow,
    isTableExplorerDataColumn,
    snapshotCellChangesForRow,
} from "../../src/webviews/pages/TableExplorer/tableDataGridUtils";

suite("tableDataGridUtils", () => {
    suite("isTableExplorerDataColumn", () => {
        test("returns true for data columns", () => {
            expect(isTableExplorerDataColumn({ originalIndex: 0 })).to.equal(true);
        });

        test("returns false for control columns", () => {
            expect(isTableExplorerDataColumn({ id: "_checkbox_selector" })).to.equal(false);
            expect(isTableExplorerDataColumn({ id: "undo" })).to.equal(false);
            expect(isTableExplorerDataColumn(undefined)).to.equal(false);
        });
    });

    suite("hasPendingChangesForRow", () => {
        test("returns true for a row with a pending cell edit", () => {
            const cellChanges = [{ rowId: 3 }, { rowId: 5 }];

            expect(hasPendingChangesForRow(5, cellChanges, new Set(), new Set())).to.equal(true);
        });

        test("returns true for a row pending deletion", () => {
            expect(hasPendingChangesForRow(5, [], new Set([5]), new Set())).to.equal(true);
        });

        test("returns true for a newly inserted row", () => {
            expect(hasPendingChangesForRow(5, [], new Set(), new Set([5]))).to.equal(true);
        });

        test("returns false for a row without pending changes", () => {
            expect(hasPendingChangesForRow(5, [{ rowId: 3 }], new Set([4]), new Set([6]))).to.equal(
                false,
            );
        });
    });

    suite("reverted cell change cleanup", () => {
        test("snapshots only changes for the reverted row", () => {
            const rowFiveChange = { rowId: 5 };
            const cellChanges = new Map([
                ["5-0", rowFiveChange],
                ["6-0", { rowId: 6 }],
            ]);

            expect([...snapshotCellChangesForRow(5, cellChanges)]).to.deep.equal([
                ["5-0", rowFiveChange],
            ]);
        });

        test("preserves changes made while the row revert is pending", () => {
            const originalFirstCellChange = { rowId: 5, newValue: "before" };
            const originalSecondCellChange = { rowId: 5, newValue: "unchanged" };
            const cellChanges = new Map([
                ["5-0", originalFirstCellChange],
                ["5-1", originalSecondCellChange],
            ]);
            const revertedCellChanges = snapshotCellChangesForRow(5, cellChanges);
            const laterFirstCellChange = { rowId: 5, newValue: "after" };
            const laterThirdCellChange = { rowId: 5, newValue: "new" };
            cellChanges.set("5-0", laterFirstCellChange);
            cellChanges.set("5-2", laterThirdCellChange);
            const failedCells = new Set(["5-0", "5-1", "5-2"]);

            clearRevertedCellChanges(cellChanges, revertedCellChanges, failedCells);

            expect(cellChanges.get("5-0")).to.equal(laterFirstCellChange);
            expect(cellChanges.has("5-1")).to.equal(false);
            expect(cellChanges.get("5-2")).to.equal(laterThirdCellChange);
            expect([...failedCells]).to.deep.equal(["5-0", "5-2"]);
        });
    });
});
