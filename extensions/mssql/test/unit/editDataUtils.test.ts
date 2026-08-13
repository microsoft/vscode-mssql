/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { removeAcknowledgedCleanCellChanges } from "../../src/tableExplorer/editDataUtils";

suite("editDataUtils", () => {
    test("removes a locally tracked cell when the service reports it clean", () => {
        const changes = new Map([["7-0", { requestId: 1, newValue: "original" }]]);

        const changed = removeAcknowledgedCleanCellChanges(
            { "7-0": { requestId: 1, isDirty: false } },
            changes,
        );

        expect(changed).to.be.true;
        expect(changes).to.be.empty;
    });

    test("preserves a pending cell when another cell is acknowledged clean", () => {
        const changes = new Map([
            ["7-0", { requestId: 1, newValue: "original" }],
            ["7-1", { requestId: 2, newValue: "pending" }],
        ]);

        const changed = removeAcknowledgedCleanCellChanges(
            { "7-0": { requestId: 1, isDirty: false } },
            changes,
        );

        expect(changed).to.be.true;
        expect([...changes.keys()]).to.deep.equal(["7-1"]);
    });

    test("preserves a newer edit when an older request is acknowledged clean", () => {
        const changes = new Map([["7-0", { requestId: 2, newValue: "newer edit" }]]);

        const changed = removeAcknowledgedCleanCellChanges(
            { "7-0": { requestId: 1, isDirty: false } },
            changes,
        );

        expect(changed).to.be.false;
        expect([...changes.keys()]).to.deep.equal(["7-0"]);
    });

    test("preserves a matching edit when the service reports it dirty", () => {
        const changes = new Map([["7-0", { requestId: 1, newValue: "changed" }]]);

        const changed = removeAcknowledgedCleanCellChanges(
            { "7-0": { requestId: 1, isDirty: true } },
            changes,
        );

        expect(changed).to.be.false;
        expect([...changes.keys()]).to.deep.equal(["7-0"]);
    });
});
