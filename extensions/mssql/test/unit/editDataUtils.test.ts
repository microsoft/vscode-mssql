/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { removeCleanCellChanges } from "../../src/tableExplorer/editDataUtils";
import { EditCell, EditRow, EditRowState } from "../../src/sharedInterfaces/tableExplorer";

suite("editDataUtils", () => {
    const createRow = (cellDirtyStates: boolean[]): EditRow => ({
        id: 7,
        isDirty: cellDirtyStates.some(Boolean),
        state: cellDirtyStates.some(Boolean) ? EditRowState.dirtyUpdate : EditRowState.clean,
        cells: cellDirtyStates.map(
            (isDirty, index): EditCell => ({
                displayValue: String(index),
                invariantCultureDisplayValue: String(index),
                isNull: false,
                isDirty,
            }),
        ),
    });

    test("removes a locally tracked cell when the service reports it clean", () => {
        const changes = new Map<string, unknown>([["7-0", { newValue: "original" }]]);

        const changed = removeCleanCellChanges([createRow([false])], changes);

        expect(changed).to.be.true;
        expect(changes).to.be.empty;
    });

    test("preserves other dirty cells in the same row", () => {
        const changes = new Map<string, unknown>([
            ["7-0", { newValue: "original" }],
            ["7-1", { newValue: "changed" }],
        ]);

        const changed = removeCleanCellChanges([createRow([false, true])], changes);

        expect(changed).to.be.true;
        expect([...changes.keys()]).to.deep.equal(["7-1"]);
    });

    test("does not clear tracking when dirty state is absent", () => {
        const row = createRow([true]);
        delete (row.cells[0] as { isDirty?: boolean }).isDirty;
        const changes = new Map<string, unknown>([["7-0", { newValue: "changed" }]]);

        const changed = removeCleanCellChanges([row], changes);

        expect(changed).to.be.false;
        expect([...changes.keys()]).to.deep.equal(["7-0"]);
    });
});
