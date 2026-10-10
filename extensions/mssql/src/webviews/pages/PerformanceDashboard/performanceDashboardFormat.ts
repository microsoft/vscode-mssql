/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Number and time formats of the dashboard. Small values keep two significant digits, so that a
 * value such as 0.004 busy cores does not show as 0.
 */

const wholeFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const smallFormat = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 2 });
const percentFormat = new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 1,
});
const smallPercentFormat = new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumSignificantDigits: 2,
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

/** A percent from 0 to 100, for example 37.4%. Below 1%, two significant digits. */
export function formatPercent(percent: number): string {
    const ratio = percent / 100;
    if (ratio === 0 || Math.abs(percent) >= 1) {
        return percentFormat.format(ratio);
    }
    return smallPercentFormat.format(ratio);
}

/** A headline percent with at most one decimal, so that 0.0044% shows as 0%. */
export function formatPercentRounded(percent: number): string {
    return percentFormat.format(percent / 100);
}

/** A share of a whole in percent, for example 91.3%, or <0.1% for a small share. */
export function formatShare(percent: number): string {
    return percent > 0 && percent < 0.1
        ? `<${percentFormat.format(0.001)}`
        : formatPercentRounded(percent);
}

/** A size in KB as MB, for example 12.5 MB. */
export function formatMegabytes(kilobytes: number): string {
    return formatUnit(kilobytes / 1024, "megabyte");
}

/** Milliseconds as seconds, for example 1.2 s, for wait times. */
export function formatSeconds(milliseconds: number): string {
    return formatUnit(milliseconds / 1000, "second");
}

/** An elapsed time, for example "6m 12s" or "1h 3m". */
export function formatElapsed(milliseconds: number): string {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const part = (value: number, unit: "hour" | "minute" | "second") =>
        new Intl.NumberFormat(undefined, {
            style: "unit",
            unit,
            unitDisplay: "narrow",
        }).format(value);
    if (hours > 0) {
        return `${part(hours, "hour")} ${part(minutes, "minute")}`;
    }
    return minutes > 0
        ? `${part(minutes, "minute")} ${part(seconds, "second")}`
        : part(seconds, "second");
}

function formatUnit(value: number, unit: "megabyte" | "second"): string {
    const size = Math.abs(value);
    return new Intl.NumberFormat(undefined, {
        style: "unit",
        unit,
        unitDisplay: "short",
        ...(size > 0 && size < 1
            ? { maximumSignificantDigits: 2 }
            : { maximumFractionDigits: size >= 100 ? 0 : 1 }),
    }).format(value);
}
