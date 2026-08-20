/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A manually controlled promise for deterministic concurrency tests.
 *
 * Metadata tests use this instead of timers so publication, cancellation, replacement, and late
 * completion can be ordered exactly and remain reliable on slow CI machines.
 */
function deferred() {
    let resolvePromise;
    let rejectPromise;
    let settled = false;
    const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });
    return Object.freeze({
        promise,
        get settled() {
            return settled;
        },
        resolve(value) {
            if (settled) throw new Error("Deferred promise was already settled.");
            settled = true;
            resolvePromise(value);
        },
        reject(error) {
            if (settled) throw new Error("Deferred promise was already settled.");
            settled = true;
            rejectPromise(error);
        },
    });
}

/** Lets promise continuations queued by a controlled resolution publish before assertions run. */
function flushAsyncWork() {
    return new Promise((resolve) => setImmediate(resolve));
}

module.exports = { deferred, flushAsyncWork };
