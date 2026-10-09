/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Time ranges for pages that show data over time. A range is a preset that ends now, such as the
 * past 24 hours, or a fixed custom range. Locations keep it as `range=24h`, or as `from` and `to`
 * in ISO 8601 UTC. This module has no React or DOM dependency.
 */

export interface TimeRangePreset {
    /** The `range` value in a location, for example `24h`. */
    readonly id: string;
    readonly durationMs: number;
    readonly label: string;
}

export type TimeRangeValue =
    | { readonly kind: "preset"; readonly presetId: string }
    | { readonly kind: "custom"; readonly from: Date; readonly to: Date };

export interface ResolvedTimeRange {
    readonly from: Date;
    readonly to: Date;
}

/**
 * Reads a time range from location query values. A missing or invalid value gives the default
 * preset.
 */
export function timeRangeFromQuery(
    query: Readonly<Record<string, string>>,
    presets: readonly TimeRangePreset[],
    defaultPresetId: string,
): TimeRangeValue {
    const from = parseIsoDate(query.from);
    const to = parseIsoDate(query.to);
    if (from && to && from.getTime() < to.getTime()) {
        return { kind: "custom", from, to };
    }
    const presetId = presets.some((preset) => preset.id === query.range)
        ? query.range
        : defaultPresetId;
    return { kind: "preset", presetId };
}

/** Returns the location query values of a time range. The default preset has none. */
export function timeRangeToQuery(
    value: TimeRangeValue,
    defaultPresetId: string,
): Record<string, string | undefined> {
    if (value.kind === "custom") {
        return { from: formatIsoDate(value.from), to: formatIsoDate(value.to) };
    }
    return { range: value.presetId === defaultPresetId ? undefined : value.presetId };
}

/** Returns the start and end of a range. A preset ends at `now`. */
export function resolveTimeRange(
    value: TimeRangeValue,
    presets: readonly TimeRangePreset[],
    now: Date,
): ResolvedTimeRange {
    if (value.kind === "custom") {
        return { from: value.from, to: value.to };
    }
    const preset = presets.find((candidate) => candidate.id === value.presetId) ?? presets[0];
    return { from: new Date(now.getTime() - preset.durationMs), to: now };
}

/** True when a preset starts before the oldest data. */
export function startsBeforeAvailable(
    preset: TimeRangePreset,
    availableFrom: Date | undefined,
    now: Date,
): boolean {
    return !!availableFrom && now.getTime() - preset.durationMs < availableFrom.getTime();
}

/**
 * Keeps a custom range inside the data: the start is not before `availableFrom`, and the end is
 * not after `now`. Returns undefined when nothing of the range is left.
 */
export function clampTimeRange(
    range: ResolvedTimeRange,
    availableFrom: Date | undefined,
    now: Date,
): ResolvedTimeRange | undefined {
    const from =
        availableFrom && range.from.getTime() < availableFrom.getTime()
            ? availableFrom
            : range.from;
    const to = range.to.getTime() > now.getTime() ? now : range.to;
    return from.getTime() < to.getTime() ? { from, to } : undefined;
}

/** Returns `base` on the local calendar day of `date`, at the same local time. */
export function withDate(base: Date, date: Date): Date {
    return new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        base.getHours(),
        base.getMinutes(),
    );
}

/** Returns `base` at the local hours and minutes of `time`, on the same local day. */
export function withTime(base: Date, time: Date): Date {
    return new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate(),
        time.getHours(),
        time.getMinutes(),
    );
}

function parseIsoDate(value: string | undefined): Date | undefined {
    if (!value || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
        return undefined;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

/** ISO 8601 UTC without milliseconds when they are zero. */
function formatIsoDate(date: Date): string {
    return date.toISOString().replace(/\.000Z$/, "Z");
}
