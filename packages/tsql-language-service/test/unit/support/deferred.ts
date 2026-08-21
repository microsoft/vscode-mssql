/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface Deferred<T> {
    readonly promise: Promise<T>;
    readonly settled: boolean;
    resolve(value: T): void;
    reject(error: unknown): void;
}

export function deferred<T = void>(): Deferred<T> {
    let resolvePromise: (value: T | PromiseLike<T>) => void = () => {
        throw new Error("Deferred promise was not initialized.");
    };
    let rejectPromise: (reason?: unknown) => void = () => {
        throw new Error("Deferred promise was not initialized.");
    };
    let settled = false;
    const promise = new Promise<T>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });
    return Object.freeze({
        promise,
        get settled() {
            return settled;
        },
        resolve(value: T) {
            if (settled) throw new Error("Deferred promise was already settled.");
            settled = true;
            resolvePromise(value);
        },
        reject(error: unknown) {
            if (settled) throw new Error("Deferred promise was already settled.");
            settled = true;
            rejectPromise(error);
        },
    });
}

export function flushAsyncWork(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}
