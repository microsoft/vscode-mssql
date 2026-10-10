/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { locConstants as loc } from "../../common/locConstants";
import { formatNumber, formatShare } from "./performanceDashboardFormat";
import type { QueryGridColumn } from "./performanceDashboardQueryGrid";
import type { QueryListRow } from "./performanceDashboardQueryList";
import type { SimpleGridColumn } from "./performanceDashboardSimpleGrid";

/*
 * The measures that the dashboard shows, and how: the name in a header, the value with its unit
 * in a cell, and the exact value for a tooltip. Columns and stats are built from them, so a
 * measure looks the same in every table and summary.
 */

/** The statistics that a list can rank by. */
export type MetricStatistic = "total" | "avg";

export interface MetricDefinition {
    /** The name in a header, after the statistic: CPU in "Total CPU". */
    readonly name: () => string;
    /** The value with its unit for a cell, for example 5,300 ms or 12.5 MB. */
    readonly display: (value: number) => string;
    /** The exact value with its unit, for a tooltip. */
    readonly exact: (value: number) => string;
    /** The width of a column of the measure. */
    readonly width: number;
}

const kilobytesPerMegabyte = 1024;

function exactUnit(unit: "millisecond" | "kilobyte" | "megabyte", value: number): string {
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

/** The catalog. Values come in the units of the data: ms, KB from Query Store, MB from storage. */
export const metrics = {
    cpuTime: metric({
        name: () => loc.performanceDashboard.metricCpu,
        display: displayMilliseconds,
        exact: (ms) => exactUnit("millisecond", ms),
        width: 180,
    }),
    duration: metric({
        name: () => loc.performanceDashboard.metricDuration,
        display: displayMilliseconds,
        exact: (ms) => exactUnit("millisecond", ms),
        width: 180,
    }),
    memoryGrant: metric({
        name: () => loc.performanceDashboard.metricMemory,
        display: (kb) => displayMegabytes(kb / kilobytesPerMegabyte),
        exact: (kb) => exactUnit("kilobyte", kb),
        width: 180,
    }),
    tempdbSpill: metric({
        name: () => loc.performanceDashboard.metricSpill,
        display: (kb) => displayMegabytes(kb / kilobytesPerMegabyte),
        exact: (kb) => exactUnit("kilobyte", kb),
        width: 150,
    }),
    logicalReads: metric({
        name: () => loc.performanceDashboard.metricReads,
        display: (kb) => displayMegabytes(kb / kilobytesPerMegabyte),
        exact: (kb) => exactUnit("kilobyte", kb),
        width: 180,
    }),
    executions: metric({
        name: () => loc.performanceDashboard.executionCount,
        display: formatNumber,
        exact: formatNumber,
        width: 130,
    }),
    connections: metric({
        name: () => loc.performanceDashboard.connectionCount,
        display: formatNumber,
        exact: formatNumber,
        width: 130,
    }),
    rows: metric({
        name: () => loc.performanceDashboard.rowCount,
        display: formatNumber,
        exact: formatNumber,
        width: 140,
    }),
    usedSize: metric({
        name: () => loc.performanceDashboard.usedSize,
        display: displayMegabytes,
        exact: (mb) => exactUnit("megabyte", mb),
        width: 150,
    }),
} as const;

export type MetricId = keyof typeof metrics;

function statisticName(statistic: MetricStatistic): string {
    const text = loc.performanceDashboard;
    return statistic === "avg" ? text.averageShort : text.total;
}

/** The header of a measure, for example "Total CPU" or "Executions". The cells have the unit. */
export function metricHeader(definition: MetricDefinition, statistic?: MetricStatistic): string {
    return statistic
        ? loc.performanceDashboard.rankedMetric(statisticName(statistic), definition.name())
        : definition.name();
}

/** The value of a measure with its unit, for example 5,300 ms or 12.5 MB. */
export function metricValue(definition: MetricDefinition, value: number): string {
    return definition.display(value);
}

export interface QueryMetricColumnOptions {
    readonly id: string;
    /** The statistic in the header. None for a count. */
    readonly statistic?: MetricStatistic;
    readonly value: (row: QueryListRow) => number | undefined;
    /** The percent under the value: of a whole, or of the highest value. */
    readonly share?: (row: QueryListRow) => number | undefined;
    /** False shows the bar without the percent, for a share of the highest value. */
    readonly showShare?: boolean;
}

/** A column of the query grid for a measure. */
export function queryMetricColumn(
    definition: MetricDefinition,
    options: QueryMetricColumnOptions,
): QueryGridColumn {
    return {
        id: options.id,
        header: metricHeader(definition, options.statistic),
        value: options.value,
        format: (value) => metricValue(definition, value),
        exact: definition.exact,
        ...(options.share
            ? {
                  share: options.share,
                  showShare: options.showShare ?? true,
                  shareTitle: (share: number, value: number) =>
                      loc.performanceDashboard.shareOfAllQueries(
                          formatShare(share),
                          definition.exact(value),
                      ),
              }
            : {}),
    };
}

export interface SimpleMetricColumnOptions<T> {
    readonly id: string;
    readonly statistic?: MetricStatistic;
    readonly value: (item: T) => number | undefined;
}

/** A sortable number column of a simple grid for a measure. */
export function simpleMetricColumn<T>(
    definition: MetricDefinition,
    options: SimpleMetricColumnOptions<T>,
): SimpleGridColumn<T> {
    return {
        id: options.id,
        header: metricHeader(definition, options.statistic),
        numeric: true,
        idealWidth: definition.width,
        render: (item) => {
            const value = options.value(item);
            return value === undefined ? "—" : metricValue(definition, value);
        },
        compare: (left, right) => (options.value(left) ?? -1) - (options.value(right) ?? -1),
    };
}

/** A text column of a simple grid, sorted by its text. */
export function simpleTextColumn<T>(
    id: string,
    header: string,
    text: (item: T) => string | undefined,
    idealWidth = 180,
): SimpleGridColumn<T> {
    return {
        id,
        header,
        idealWidth,
        render: (item) => text(item) || "—",
        compare: (left, right) => (text(left) ?? "").localeCompare(text(right) ?? ""),
    };
}
