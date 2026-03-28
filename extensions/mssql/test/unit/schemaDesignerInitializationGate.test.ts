/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    createInitializationGateController,
    type InitializationDeferred,
} from "../../src/webviews/pages/SchemaDesigner/initializationGate";

suite("SchemaDesigner initialization gate", () => {
    test("waitForInitialization returns true when already initialized", async () => {
        const gateController = createInitializationGateController();

        const initialized = await gateController.waitForInitialization(() => true);

        expect(initialized).to.equal(true);
    });

    test("waiter follows gate rotation and resolves from the new gate", async () => {
        const gateController = createInitializationGateController();
        let isInitialized = false;

        const waiter = gateController.waitForInitialization(() => isInitialized);
        const nextGate = gateController.rotateGate();

        // Let the waiter observe previous-gate resolution and transition to the new gate.
        await Promise.resolve();
        isInitialized = true;
        nextGate.resolve(true);

        const initialized = await waiter;
        expect(initialized).to.equal(true);
    });

    test("waitForInitialization returns false when current gate resolves false", async () => {
        const gateController = createInitializationGateController();
        let isInitialized = false;

        const waiter = gateController.waitForInitialization(() => isInitialized);
        gateController.getCurrentGate().resolve(false);

        const initialized = await waiter;
        expect(initialized).to.equal(false);
    });

    test("rotateGate resolves previous gate with false", async () => {
        let previousGateResolvedValue: boolean | undefined;
        const previousGate: InitializationDeferred = {
            promise: Promise.resolve(false),
            resolve: (value) => {
                previousGateResolvedValue = value;
            },
        };

        const gateController = createInitializationGateController(previousGate);
        const nextGate = gateController.rotateGate();

        expect(previousGateResolvedValue).to.equal(false);
        expect(nextGate).to.not.equal(previousGate);
        expect(gateController.getCurrentGate()).to.equal(nextGate);
    });
});
