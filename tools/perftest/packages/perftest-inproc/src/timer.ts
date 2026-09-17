/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const MAX_TIMER_MS = 24 * 60 * 60_000;

/** Validate an untrusted duration before passing it to a Node timer. */
export function validateTimerMs(value: unknown, fallback: number, what: string): number {
    const candidate = value === undefined || value === null ? fallback : value;
    if (
        typeof candidate !== "number" ||
        !Number.isFinite(candidate) ||
        candidate < 0 ||
        candidate > MAX_TIMER_MS
    ) {
        throw new Error(`${what}: duration ${String(value)} ms is outside [0, ${MAX_TIMER_MS}]`);
    }
    return Math.floor(candidate);
}
