/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { MutationCoordinator } from "../../src/webviews/pages/TableExplorer/mutationCoordinator";

suite("MutationCoordinator", () => {
    test("should wait for every deferred mutation before allowing commit", async () => {
        const coordinator = new MutationCoordinator();
        const mutationResolvers: Array<() => void> = [];
        let isReadyToCommit = false;

        for (let i = 0; i < 3; i++) {
            coordinator.track(
                new Promise<void>((resolve) => {
                    mutationResolvers.push(resolve);
                }),
            );
        }

        const waitForMutations = coordinator.waitForPending().then(() => {
            isReadyToCommit = true;
        });

        mutationResolvers[0]();
        mutationResolvers[1]();
        await Promise.resolve();
        expect(isReadyToCommit).to.be.false;

        mutationResolvers[2]();
        await waitForMutations;

        expect(isReadyToCommit).to.be.true;
    });
});
