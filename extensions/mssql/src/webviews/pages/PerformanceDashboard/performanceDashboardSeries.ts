/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { MetricWindowTotal, ResourceCpuSample } from "../../../sharedInterfaces/performance";
import type { ResolvedTimeRange } from "../../common/timeRange/timeRange";
import type { TimeSeriesPoint } from "./performanceDashboardParts";

const minuteMs = 60_000;
const hourMs = 60 * minuteMs;
/** A guard against a bucket size that would give too many points. */
const maxPoints = 5000;

/** A chart bucket size for a range: about 50 to 300 points. */
export function bucketMinutesFor(range: ResolvedTimeRange): number {
    const lengthMs = range.to.getTime() - range.from.getTime();
    if (lengthMs <= hourMs) {
        return 1;
    }
    if (lengthMs <= 12 * hourMs) {
        return 5;
    }
    if (lengthMs <= 24 * hourMs) {
        return 15;
    }
    return lengthMs <= 7 * 24 * hourMs ? 60 : 240;
}

/** The start of the data in the range: the range start, or the oldest data when it is later. */
export function dataStart(range: ResolvedTimeRange, availableFrom: Date | undefined): number {
    return Math.max(range.from.getTime(), availableFrom?.getTime() ?? -Infinity);
}

/**
 * Returns a point for each bucket from the start of the data to the end of the range. A bucket
 * without a value is 0, because Query Store has no runtime stats for it: nothing ran.
 */
export function filledSeriesPoints(
    buckets: readonly { readonly startUtc: string; readonly value: number }[],
    bucketMinutes: number,
    range: ResolvedTimeRange,
    availableFrom: Date | undefined,
): TimeSeriesPoint[] {
    const sizeMs = bucketMinutes * minuteMs;
    const values = new Map(buckets.map((bucket) => [Date.parse(bucket.startUtc), bucket.value]));
    const first = Math.floor(dataStart(range, availableFrom) / sizeMs) * sizeMs;
    const points: TimeSeriesPoint[] = [];
    for (
        let start = first;
        start < range.to.getTime() && points.length < maxPoints;
        start += sizeMs
    ) {
        points.push({ x: new Date(start), y: values.get(start) ?? 0 });
    }
    return points;
}

/** The time-weighted average CPU percent of the samples in a window, or undefined without samples. */
export function averageResourceCpu(
    samples: readonly ResourceCpuSample[],
    start: number,
    end: number,
): number | undefined {
    let weighted = 0;
    let covered = 0;
    for (const sample of samples) {
        const from = Math.max(start, Date.parse(sample.startUtc));
        const to = Math.min(end, Date.parse(sample.endUtc));
        if (to > from) {
            weighted += sample.avgCpuPercent * (to - from);
            covered += to - from;
        }
    }
    return covered > 0 ? weighted / covered : undefined;
}

/** The average CPU percent for each bucket of the range. Buckets without samples are left out. */
export function resourceCpuPoints(
    samples: readonly ResourceCpuSample[],
    range: ResolvedTimeRange,
    bucketMinutes: number,
): TimeSeriesPoint[] {
    const sizeMs = bucketMinutes * minuteMs;
    const points: TimeSeriesPoint[] = [];
    const first = Math.floor(range.from.getTime() / sizeMs) * sizeMs;
    for (
        let start = first;
        start < range.to.getTime() && points.length < maxPoints;
        start += sizeMs
    ) {
        const average = averageResourceCpu(samples, start, start + sizeMs);
        if (average !== undefined) {
            points.push({ x: new Date(start), y: average });
        }
    }
    return points;
}

/**
 * The change of the average CPU percent from the previous window to the current one, in percent.
 * Undefined when the samples do not reach back to the start of the previous window.
 */
export function resourceCpuChange(
    samples: readonly ResourceCpuSample[],
    current: { readonly start: number; readonly end: number },
    previous: { readonly start: number; readonly end: number },
): number | undefined {
    const oldest = samples.length > 0 ? Date.parse(samples[0].startUtc) : Infinity;
    // resource_stats has one row each 5 minutes, so allow one row of slack.
    if (oldest > previous.start + 5 * minuteMs) {
        return undefined;
    }
    const now = averageResourceCpu(samples, current.start, current.end);
    const before = averageResourceCpu(samples, previous.start, previous.end);
    if (now === undefined || before === undefined || before <= 0) {
        return undefined;
    }
    return ((now - before) / before) * 100;
}

/**
 * The change of the average per execution from the previous window to the current one, in
 * percent. Undefined when Query Store has no data for the start of the previous window, or the
 * previous window had no executions.
 */
export function averageChange(
    current: MetricWindowTotal | undefined,
    previous: MetricWindowTotal | undefined,
    availableFrom: Date | undefined,
): number | undefined {
    if (!current || !previous || previous.executionCount <= 0 || current.executionCount <= 0) {
        return undefined;
    }
    if (availableFrom && Date.parse(previous.startUtc) < availableFrom.getTime()) {
        return undefined;
    }
    const now = current.total / current.executionCount;
    const before = previous.total / previous.executionCount;
    return before > 0 ? ((now - before) / before) * 100 : undefined;
}
