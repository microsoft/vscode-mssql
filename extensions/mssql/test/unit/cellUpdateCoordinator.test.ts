/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { CellUpdateCoordinator } from "../../src/webviews/pages/TableExplorer/cellUpdateCoordinator";

suite("CellUpdateCoordinator", () => {
    test("should wait for an active-cell update before allowing commit", async () => {
        const coordinator = new CellUpdateCoordinator();
        let resolveUpdate: () => void;
        let isReadyToCommit = false;

        const waitForUpdate = coordinator
            .commitCurrentEditAndWait(() => {
                coordinator.track(
                    new Promise<void>((resolve) => {
                        resolveUpdate = resolve;
                    }),
                );
                return true;
            })
            .then((result) => {
                isReadyToCommit = result;
            });

        await Promise.resolve();
        expect(isReadyToCommit).to.be.false;

        resolveUpdate!();
        await waitForUpdate;

        expect(isReadyToCommit).to.be.true;
    });
});
