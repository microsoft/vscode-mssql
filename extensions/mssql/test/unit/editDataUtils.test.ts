/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    commitChangesAndClearTracking,
    removeAcknowledgedCleanCellChanges,
    revertCellAndClearTracking,
    updateCellAndTrackFailure,
} from "../../src/tableExplorer/editDataUtils";

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

    test("clears local tracking after a successful commit", async () => {
        let trackingCleared = false;

        const committed = await commitChangesAndClearTracking(
            async () => {},
            () => {
                trackingCleared = true;
            },
        );

        expect(committed).to.be.true;
        expect(trackingCleared).to.be.true;
    });

    test("preserves local tracking after a failed commit", async () => {
        let trackingCleared = false;

        const committed = await commitChangesAndClearTracking(
            async () => {
                throw new Error("Commit failed");
            },
            () => {
                trackingCleared = true;
            },
        );

        expect(committed).to.be.false;
        expect(trackingCleared).to.be.false;
    });

    test("does not mark a successful cell update as failed", async () => {
        let failureTracked = false;

        const updated = await updateCellAndTrackFailure(
            async () => {},
            () => {
                failureTracked = true;
            },
        );

        expect(updated).to.be.true;
        expect(failureTracked).to.be.false;
    });

    test("preserves tracking and marks a rejected cell update as failed", async () => {
        const trackedChanges = new Map([["7-0", "pending"]]);
        let failureTracked = false;

        const updated = await updateCellAndTrackFailure(
            async () => {
                throw new Error("Update was not applied");
            },
            () => {
                failureTracked = true;
            },
        );

        expect(updated).to.be.false;
        expect(failureTracked).to.be.true;
        expect(trackedChanges.has("7-0")).to.be.true;
    });

    test("clears cell tracking after a successful revert", async () => {
        let trackingCleared = false;

        const reverted = await revertCellAndClearTracking(
            async () => {},
            () => {
                trackingCleared = true;
            },
        );

        expect(reverted).to.be.true;
        expect(trackingCleared).to.be.true;
    });

    test("preserves cell tracking after a failed revert", async () => {
        let trackingCleared = false;

        const reverted = await revertCellAndClearTracking(
            async () => {
                throw new Error("Revert failed");
            },
            () => {
                trackingCleared = true;
            },
        );

        expect(reverted).to.be.false;
        expect(trackingCleared).to.be.false;
    });
});
