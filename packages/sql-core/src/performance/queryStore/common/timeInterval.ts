/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A window that ends now. C# `TimeIntervalOptions` without `Custom`.
 */
export type QueryStoreTimeIntervalOption =
    | "last5Minutes"
    | "last15Minutes"
    | "last30Minutes"
    | "lastHour"
    | "last12Hours"
    | "lastDay"
    | "last2Days"
    | "lastWeek"
    | "last2Weeks"
    | "lastMonth"
    | "last3Months"
    | "last6Months"
    | "lastYear"
    | "allTime";

/** A fixed window. C# `TimeIntervalOptions.Custom`. */
export interface QueryStoreCustomTimeInterval {
    readonly start: Date;
    readonly end: Date;
}

/** A window that ends at the time the query is generated. */
export interface QueryStoreRelativeTimeInterval {
    readonly option: QueryStoreTimeIntervalOption;
}

export type QueryStoreTimeInterval = QueryStoreCustomTimeInterval | QueryStoreRelativeTimeInterval;

export interface ResolvedTimeInterval {
    readonly start: Date;
    readonly end: Date;
}

/**
 * The time zone of the `datetimeoffset` parameters, and of the time buckets in the reports that
 * group by time. C# `QueryStoreCommonConfiguration.DisplayTimeKind`, which is a global setting
 * there. `"local"` is the time zone of the JavaScript runtime.
 */
export type DisplayTimeKind = "utc" | "local";

export function assertDisplayTimeKind(value: unknown): DisplayTimeKind {
    if (value !== "utc" && value !== "local") {
        throw new RangeError(`"${String(value)}" is not a display time kind.`);
    }
    return value;
}

const minuteMs = 60 * 1000;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;

const relativeOptions: ReadonlySet<string> = new Set<QueryStoreTimeIntervalOption>([
    "last5Minutes",
    "last15Minutes",
    "last30Minutes",
    "lastHour",
    "last12Hours",
    "lastDay",
    "last2Days",
    "lastWeek",
    "last2Weeks",
    "lastMonth",
    "last3Months",
    "last6Months",
    "lastYear",
    "allTime",
]);

/**
 * Returns the start and end of the window. A relative window ends at `now`. Throws a
 * `RangeError` when a date is not valid.
 */
export function resolveTimeInterval(
    interval: QueryStoreTimeInterval,
    now: Date = new Date(),
): ResolvedTimeInterval {
    if (interval && "option" in interval) {
        assertValidDate(now);
        return { start: getTimeIntervalStart(now, interval.option), end: new Date(now.getTime()) };
    }
    if (!interval || !("start" in interval) || !("end" in interval)) {
        throw new RangeError("The time interval needs an option or a start and an end.");
    }
    assertValidDate(interval.start);
    assertValidDate(interval.end);
    return { start: new Date(interval.start.getTime()), end: new Date(interval.end.getTime()) };
}

/**
 * Returns the start of a window that ends at `end`. Months and years are calendar months and
 * years in UTC, and the day is clamped to the end of a shorter month. C#
 * `TimeIntervalUtils.GetDateTimeOffset`.
 */
export function getTimeIntervalStart(end: Date, option: QueryStoreTimeIntervalOption): Date {
    assertValidDate(end);
    const time = end.getTime();
    switch (option) {
        case "last5Minutes":
            return new Date(time - 5 * minuteMs);
        case "last15Minutes":
            return new Date(time - 15 * minuteMs);
        case "last30Minutes":
            return new Date(time - 30 * minuteMs);
        case "lastHour":
            return new Date(time - hourMs);
        case "last12Hours":
            return new Date(time - 12 * hourMs);
        case "lastDay":
            return new Date(time - dayMs);
        case "last2Days":
            return new Date(time - 2 * dayMs);
        case "lastWeek":
            return new Date(time - 7 * dayMs);
        case "last2Weeks":
            return new Date(time - 14 * dayMs);
        case "lastMonth":
            return addUtcMonths(end, -1);
        case "last3Months":
            return addUtcMonths(end, -3);
        case "last6Months":
            return addUtcMonths(end, -6);
        case "lastYear":
            return addUtcMonths(end, -12);
        case "allTime":
            return minDateTimeOffset();
        default:
            throw new RangeError(`"${String(option)}" is not a time interval option.`);
    }
}

export function isQueryStoreTimeIntervalOption(
    value: unknown,
): value is QueryStoreTimeIntervalOption {
    return typeof value === "string" && relativeOptions.has(value);
}

/** `DateTimeOffset.MinValue`: 0001-01-01T00:00:00Z. */
export function minDateTimeOffset(): Date {
    const value = new Date(0);
    value.setUTCFullYear(1, 0, 1);
    value.setUTCHours(0, 0, 0, 0);
    return value;
}

/**
 * Throws a `RangeError` unless the value is a valid date in the `datetimeoffset` range.
 */
export function assertValidDate(value: Date): Date {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
        throw new RangeError("Value is not a valid date.");
    }
    const year = value.getUTCFullYear();
    if (year < 1 || year > 9999) {
        throw new RangeError(`Year ${year} is outside the datetimeoffset range.`);
    }
    return value;
}

/** Like `DateTime.AddMonths`: the day is clamped to the last day of the target month. */
function addUtcMonths(value: Date, months: number): Date {
    const result = new Date(value.getTime());
    const day = value.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + months);
    result.setUTCDate(Math.min(day, daysInUtcMonth(result.getUTCFullYear(), result.getUTCMonth())));
    return result;
}

function daysInUtcMonth(year: number, month: number): number {
    const value = new Date(0);
    value.setUTCFullYear(year, month + 1, 0);
    return value.getUTCDate();
}

/** The bucket size of a time series. */
export type BucketInterval = "minute" | "hour" | "day" | "week" | "month" | "automatic";

/** The bucket length in milliseconds. A month is 30 days. `automatic` is 0. */
export function bucketIntervalToMilliseconds(bucketInterval: BucketInterval): number {
    switch (bucketInterval) {
        case "minute":
            return minuteMs;
        case "hour":
            return hourMs;
        case "day":
            return dayMs;
        case "week":
            return 7 * dayMs;
        case "month":
            return 30 * dayMs;
        case "automatic":
            return 0;
        default:
            throw new RangeError(`"${String(bucketInterval)}" is not a bucket interval.`);
    }
}

/**
 * The `datepart` for `DATEADD` and `DATEDIFF`. `automatic` falls back to days, like the C# code.
 */
export function dateFunctionIntervalString(bucketInterval: BucketInterval): string {
    switch (bucketInterval) {
        case "minute":
            return "mi";
        case "hour":
            return "hh";
        case "day":
            return "d";
        case "week":
            return "ww";
        case "month":
            return "m";
        case "automatic":
            return "d";
        default:
            throw new RangeError(`"${String(bucketInterval)}" is not a bucket interval.`);
    }
}

/**
 * Picks a bucket size for a window of the given length in milliseconds. C#
 * `BucketIntervalUtils.CalculateGoodSubInterval`.
 */
export function calculateGoodSubInterval(durationMs: number): BucketInterval {
    if (!Number.isFinite(durationMs)) {
        throw new RangeError(`Duration ${durationMs} is not finite.`);
    }
    if (durationMs / minuteMs <= 60) {
        return "minute";
    }
    if (durationMs / hourMs <= 48) {
        return "hour";
    }
    if (durationMs / dayMs <= 31) {
        return "day";
    }
    if (durationMs / dayMs <= 300) {
        return "week";
    }
    return "month";
}

/** The window of a column in a report that compares two windows, such as Regressed Queries. */
export type ComparisonTimeInterval = "none" | "recent" | "history";

/**
 * The suffix for column labels: `recent` or `hist`. Empty for `none`, like the C# code.
 */
export function comparisonTimeIntervalQueryString(timeInterval: ComparisonTimeInterval): string {
    switch (timeInterval) {
        case "history":
            return "hist";
        case "recent":
            return "recent";
        case "none":
            return "";
        default:
            throw new RangeError(`"${String(timeInterval)}" is not a comparison time interval.`);
    }
}
