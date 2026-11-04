/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ResolvedTimeRange } from "../../common/timeRange/timeRange";
import type { TimeSeriesPoint } from "./performanceDashboardParts";

const minuteMs = 60_000;
/** A guard against a bucket size that would give too many points. */
const maxPoints = 5000;

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
