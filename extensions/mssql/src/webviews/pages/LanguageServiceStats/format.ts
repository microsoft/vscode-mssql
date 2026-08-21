/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Two decimals below ten, one below a hundred, none above.
 *
 * Precision where it can be read: a sub-millisecond figure needs its decimals to mean anything, and
 * a four-figure one does not, so a shared rule keeps every duration on the page comparable.
 */
export function formatMs(value: number): string {
    if (!Number.isFinite(value)) return "—";
    if (value >= 100) return value.toFixed(0);
    if (value >= 10) return value.toFixed(1);
    return value.toFixed(2);
}
