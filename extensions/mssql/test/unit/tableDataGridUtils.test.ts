/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    hasPendingChangesForRow,
    isTableExplorerDataColumn,
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
});
