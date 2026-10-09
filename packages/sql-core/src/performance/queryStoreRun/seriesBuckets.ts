/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlResultSet, readNumber, toRecords } from "../../common/sqlReader";
import { QueryStoreSqlParameter } from "../queryStore/common/sqlParameters";
import { assertValidDate } from "../queryStore/common/timeInterval";

/*
 * The time buckets of the Query Store series. A runtime stats interval counts in the bucket that
 * contains its start_time. Buckets start at whole multiples of the bucket size after
 * 2000-01-01T00:00:00Z, so the same bucket size gives the same buckets in each read. The bucket
 * size is the wanted size, or the Query Store interval length when that is longer.
 */

/** The time that the buckets align to. */
export const seriesBucketOrigin = new Date(Date.UTC(2000, 0, 1));

export const minSeriesBucketMinutes = 1;
export const maxSeriesBucketMinutes = 1440;

const minuteMs = 60 * 1000;

/** The T-SQL variables of a series batch. */
export const seriesParameterNames = {
    start: "@series_start",
    end: "@series_end",
    wantedBucketMinutes: "@wanted_bucket_minutes",
    origin: "@bucket_origin",
    intervalLengthMinutes: "@interval_length_minutes",
    bucketMinutes: "@bucket_minutes",
} as const;

/** Throws a `RangeError` for a window or a bucket size that is not valid. */
export function assertSeriesRequest(start: Date, end: Date, bucketMinutes: number): void {
    assertValidDate(start);
    assertValidDate(end);
    if (start.getTime() >= end.getTime()) {
        throw new RangeError("The start of the window must be before its end.");
    }
    if (
        typeof bucketMinutes !== "number" ||
        !Number.isInteger(bucketMinutes) ||
        bucketMinutes < minSeriesBucketMinutes ||
        bucketMinutes > maxSeriesBucketMinutes
    ) {
        throw new RangeError(
            `The bucket size must be a whole number of minutes from ${minSeriesBucketMinutes} to ${maxSeriesBucketMinutes}.`,
        );
    }
}

/** The window, the wanted bucket size, and the bucket origin. */
export function seriesParameters(
    start: Date,
    end: Date,
    bucketMinutes: number,
): QueryStoreSqlParameter[] {
    return [
        { name: seriesParameterNames.start, type: "datetimeoffset", value: start },
        { name: seriesParameterNames.end, type: "datetimeoffset", value: end },
        { name: seriesParameterNames.wantedBucketMinutes, type: "int", value: bucketMinutes },
        { name: seriesParameterNames.origin, type: "datetimeoffset", value: seriesBucketOrigin },
    ];
}

/**
 * Sets `@interval_length_minutes` and `@bucket_minutes`, and returns them as the first result
 * set. The values are set with `SET`, because Synapse dedicated pools do not assign variables
 * with `SELECT`.
 */
export const bucketSizeStatements = `DECLARE ${seriesParameterNames.intervalLengthMinutes} INT;
SET ${seriesParameterNames.intervalLengthMinutes} = (SELECT TOP (1) interval_length_minutes FROM sys.database_query_store_options);
DECLARE ${seriesParameterNames.bucketMinutes} INT;
SET ${seriesParameterNames.bucketMinutes} = CASE
    WHEN ${seriesParameterNames.intervalLengthMinutes} > ${seriesParameterNames.wantedBucketMinutes}
        THEN ${seriesParameterNames.intervalLengthMinutes}
    ELSE ${seriesParameterNames.wantedBucketMinutes}
END;
SELECT
    ${seriesParameterNames.intervalLengthMinutes} AS interval_length_minutes,
    ${seriesParameterNames.bucketMinutes} AS bucket_minutes;`;

/** The bucket number of `rsi.start_time`, from the origin. */
export const bucketIndexExpression = `CONVERT(bigint, FLOOR(DATEDIFF(MINUTE, ${seriesParameterNames.origin}, rsi.start_time) / CONVERT(float, ${seriesParameterNames.bucketMinutes})))`;

/** The filter of the runtime stats intervals that start in the window. */
export function seriesWindowFilter(indent: string): string {
    return `rsi.start_time >= ${seriesParameterNames.start}\n${indent}AND rsi.start_time < ${seriesParameterNames.end}`;
}

export interface SeriesBucketSize {
    readonly bucketMinutes: number;
    readonly intervalLengthMinutes?: number;
}

/** Maps the result set of {@link bucketSizeStatements}. */
export function readSeriesBucketSize(
    resultSet: SqlResultSet | undefined,
    wantedBucketMinutes: number,
): SeriesBucketSize {
    const record = toRecords(resultSet)[0];
    const intervalLengthMinutes = record && readNumber(record, "interval_length_minutes");
    const bucketMinutes = record && readNumber(record, "bucket_minutes");
    return {
        bucketMinutes:
            bucketMinutes !== undefined && bucketMinutes > 0 ? bucketMinutes : wantedBucketMinutes,
        ...(intervalLengthMinutes !== undefined ? { intervalLengthMinutes } : {}),
    };
}

/** The start and end of a bucket, ISO 8601 UTC. */
export function seriesBucketBounds(
    bucketIndex: number,
    bucketMinutes: number,
): { readonly startUtc: string; readonly endUtc: string } {
    const startMs = seriesBucketOrigin.getTime() + bucketIndex * bucketMinutes * minuteMs;
    return {
        startUtc: new Date(startMs).toISOString(),
        endUtc: new Date(startMs + bucketMinutes * minuteMs).toISOString(),
    };
}
