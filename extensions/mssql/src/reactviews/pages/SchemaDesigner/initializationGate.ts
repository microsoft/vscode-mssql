/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface InitializationDeferred {
    promise: Promise<boolean>;
    resolve: (value: boolean) => void;
}

export function createInitializationDeferred(): InitializationDeferred {
    let resolve!: (value: boolean) => void;
    const promise = new Promise<boolean>((resolvePromise) => {
        resolve = resolvePromise;
    });

    return {
        promise,
        resolve,
    };
}

export interface InitializationGateController {
    getCurrentGate: () => InitializationDeferred;
    rotateGate: () => InitializationDeferred;
    waitForInitialization: (isInitialized: () => boolean) => Promise<boolean>;
}

export function createInitializationGateController(
    initialGate: InitializationDeferred = createInitializationDeferred(),
): InitializationGateController {
    let currentGate = initialGate;

    const getCurrentGate = () => currentGate;

    const rotateGate = () => {
        const previousGate = currentGate;
        const nextGate = createInitializationDeferred();
        currentGate = nextGate;
        previousGate.resolve(false);
        return nextGate;
    };

    const waitForInitialization = async (isInitialized: () => boolean) => {
        while (true) {
            if (isInitialized()) {
                return true;
            }

            const gate = currentGate;
            const initialized = await gate.promise;

            if (isInitialized()) {
                return true;
            }

            // Initialization was retriggered while waiting; wait on the new gate.
            if (gate !== currentGate) {
                continue;
            }

            return initialized;
        }
    };

    return {
        getCurrentGate,
        rotateGate,
        waitForInitialization,
    };
}
