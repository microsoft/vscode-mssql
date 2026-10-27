/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Number and time formats of the dashboard. Small values keep two significant digits, so that a
 * value such as 0.004 ms does not show as 0.
 */

const wholeFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const smallFormat = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 2 });
const percentFormat = new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 1,
});

export const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
});

export const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

/** Whole numbers from 100, up to two decimals from 1, and two significant digits below 1. */
export function formatNumber(value: number): string {
    const size = Math.abs(value);
    if (size === 0) {
        return wholeFormat.format(0);
    }
    if (size >= 100) {
        return wholeFormat.format(value);
    }
    return size >= 1 ? decimalFormat.format(value) : smallFormat.format(value);
}

/** A share of a whole in percent, for example 91.3%, or <0.1% for a small share. */
export function formatShare(percent: number): string {
    return percent > 0 && percent < 0.1
        ? `<${percentFormat.format(0.001)}`
        : percentFormat.format(percent / 100);
}
