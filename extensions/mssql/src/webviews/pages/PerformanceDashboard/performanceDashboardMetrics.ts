/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { locConstants as loc } from "../../common/locConstants";
import { formatNumber } from "./performanceDashboardFormat";

/*
 * The measures that the dashboard shows, and how: the name in a header, the value with its unit
 * in a cell, and the exact value for a tooltip, so a measure looks the same in every table.
 */

export interface MetricDefinition {
    /** The name in a header, after the statistic: CPU in "Total CPU". */
    readonly name: () => string;
    /** The value with its unit for a cell, for example 5,300 ms or 12.5 MB. */
    readonly display: (value: number) => string;
    /** The exact value with its unit, for a tooltip. */
    readonly exact: (value: number) => string;
}

const kilobytesPerMegabyte = 1024;

function exactUnit(unit: "millisecond" | "kilobyte", value: number): string {
    return new Intl.NumberFormat(undefined, {
        style: "unit",
        unit,
        unitDisplay: "short",
        maximumFractionDigits: 3,
    }).format(value);
}

/** A time in ms: 5,300 ms, and two significant digits below 1 ms. */
function displayMilliseconds(milliseconds: number): string {
    const time = Math.abs(milliseconds);
    return new Intl.NumberFormat(undefined, {
        style: "unit",
        unit: "millisecond",
        unitDisplay: "short",
        ...(time > 0 && time < 1 ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 0 }),
    }).format(milliseconds);
}

/** A size in MB: 12.5 MB, 1,024 MB, and two significant digits below 1 MB. */
function displayMegabytes(megabytes: number): string {
    const size = Math.abs(megabytes);
    return new Intl.NumberFormat(undefined, {
        style: "unit",
        unit: "megabyte",
        unitDisplay: "short",
        ...(size > 0 && size < 1
            ? { maximumSignificantDigits: 2 }
            : { maximumFractionDigits: size >= 100 ? 0 : 1 }),
    }).format(megabytes);
}

function metric(definition: MetricDefinition): MetricDefinition {
    return definition;
}

/** The catalog. Values come in the units of Query Store: ms and KB. */
export const metrics = {
    cpuTime: metric({
        name: () => loc.performanceDashboard.metricCpu,
        display: displayMilliseconds,
        exact: (ms) => exactUnit("millisecond", ms),
    }),
    duration: metric({
        name: () => loc.performanceDashboard.metricDuration,
        display: displayMilliseconds,
        exact: (ms) => exactUnit("millisecond", ms),
    }),
    memoryGrant: metric({
        name: () => loc.performanceDashboard.metricMemory,
        display: (kb) => displayMegabytes(kb / kilobytesPerMegabyte),
        exact: (kb) => exactUnit("kilobyte", kb),
    }),
    logicalReads: metric({
        name: () => loc.performanceDashboard.metricReads,
        display: (kb) => displayMegabytes(kb / kilobytesPerMegabyte),
        exact: (kb) => exactUnit("kilobyte", kb),
    }),
    executions: metric({
        name: () => loc.performanceDashboard.executionCount,
        display: formatNumber,
        exact: formatNumber,
    }),
} as const;
