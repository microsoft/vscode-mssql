/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from "@fluentui/react-components";
import type { SqlPlatform } from "../../../sharedInterfaces/performance";
import {
    DatabaseFactsResult,
    GetMetricSeriesRequest,
    GetMetricTotalsRequest,
    GetPlatformMetricRequest,
    GetResourceConsumptionRequest,
    PlatformMetricKind,
    PlatformMetricSeries,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { isFirstLoad, useExtensionRequest } from "../../common/useExtensionRequest";
import {
    cpuBucketMs,
    cpuChartPoints,
    cpuCoreCount,
    cpuSummaryWindows,
} from "./performanceDashboardCpuModel";
import {
    dateTimeFormat,
    formatMegabytes,
    formatNumber,
    formatPercentRounded,
    formatStorageSize,
} from "./performanceDashboardFormat";
import { sizeLabel } from "./performanceDashboardOverviewModel";
import {
    ReadOnlyNotice,
    StatusBar,
    ChartCard,
    chartCardChartHeight,
    intervalName,
    ThresholdChart,
    TimeSeriesChart,
    isReadOnly,
    readData,
} from "./performanceDashboardParts";
import { useRefresh } from "./performanceDashboardRefresh";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { bucketMinutesFor, dataStart, filledSeriesPoints } from "./performanceDashboardSeries";
import { ChartCardSkeleton } from "./performanceDashboardSkeletons";
import { readStatusMessage } from "./performanceDashboardStatus";
import { useQueryStoreAvailableFrom, useViewTimeRange } from "./performanceDashboardTimeRange";

/*
 * The panels of the overview segments: a summary of a measure, and its chart in the same frame.
 * CPU, memory, and storage come from the platform when it keeps them: Azure Monitor for Azure SQL
 * Database and Managed Instance, and Fabric for SQL database in Fabric. Without them, for example
 * without an Azure sign-in or on SQL Server, the panels read Query Store in the database.
 */

/** A value at or above this percent of the capacity is critical. */
export const criticalPercent = 80;
/** Requests are counted for each 15 minutes. */
const requestBucketMinutes = 15;

const useStyles = makeStyles({
    panel: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
    },
    note: {
        color: tokens.colorNeutralForeground3,
    },
});

export interface PanelProps {
    /** The platform and size of the database. */
    readonly facts: DatabaseFactsResult | undefined;
}

/** The measures that each platform keeps, which the panels read from it. */
const platformMetricKinds: Partial<Record<SqlPlatform, readonly PlatformMetricKind[]>> = {
    azureSqlDatabase: ["cpu", "memory", "storage", "logins"],
    // Managed Instance reports CPU for the instance; no memory, and storage of the instance.
    azureSqlManagedInstance: ["cpu"],
    fabricSqlDatabase: ["cpu", "memory", "storage", "logins", "requests", "blocked"],
};

/**
 * The history of a measure from the platform of the database, for the view's time range. Pending
 * while the platform reads; no series when the platform does not keep the measure or cannot be
 * read, and the panel then reads the database.
 */
export function usePlatformMetric(
    kind: PlatformMetricKind,
    facts: DatabaseFactsResult | undefined,
) {
    const { key, window } = useReadContext();
    const platform = facts?.platform;
    const enabled = !!platform && (platformMetricKinds[platform]?.includes(kind) ?? false);
    const read = useExtensionRequest(
        GetPlatformMetricRequest.type,
        { ...window, kind, ...(platform ? { platform } : {}) },
        key,
        enabled,
    );
    return {
        pending: enabled && isFirstLoad(read),
        series: enabled && !read.stale ? read.result?.series : undefined,
    };
}

/** The measures that count activity, where an interval without a value had none. */
const activityKinds: ReadonlySet<PlatformMetricKind> = new Set([
    "cpu",
    "logins",
    "requests",
    "blocked",
]);

/**
 * The points of a platform series. The platforms report no value for an interval without
 * activity, so for activity a missing value is 0, as the Fabric portal shows it. Memory and
 * storage are levels, so a missing value is left out rather than shown as 0.
 */
export function platformPoints(series: PlatformMetricSeries) {
    const zeroWhenMissing = activityKinds.has(series.kind);
    return series.points
        .filter((point) => point.value !== null || zeroWhenMissing)
        .map((point) => ({ x: new Date(point.startUtc), y: point.value ?? 0 }));
}

/** What a platform series shows and where it comes from, for the unit row of a card. */
export function platformUnit(series: PlatformMetricSeries): string {
    const text = loc.performanceDashboard;
    const interval = intervalName(series.bucketMinutes);
    const name = {
        cpu: series.unit === "vCores" ? text.vCoresUsed : text.cpuPercentOfLimit,
        memory: series.unit === "percent" ? text.memoryPercentOfLimit : text.memoryUsed,
        storage: text.usedSize,
        logins: text.loginsPerInterval(interval),
        requests: text.requestsPerInterval(interval),
        blocked: text.peakBlockedPerInterval(interval),
    }[series.kind];
    return text.unitWithSource(
        name,
        series.source === "fabric" ? text.sourceFabric : text.sourceAzureMonitor,
    );
}

/** The Query Store reads of a view: the database and refresh key, and the time range. */
function useReadContext() {
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const time = useViewTimeRange();
    const availableFrom = useQueryStoreAvailableFrom();
    return { key: [databaseName, refreshKey], availableFrom, ...time };
}

/** CPU from the platform when it keeps it, or else from Query Store. */
export const CpuPanel = ({ facts }: PanelProps) => {
    const platform = usePlatformMetric("cpu", facts);
    if (platform.pending) {
        return <ChartCardSkeleton chartHeight={chartCardChartHeight} />;
    }
    return platform.series ? (
        <PlatformMetricCard series={platform.series} facts={facts} />
    ) : (
        <CpuQueryStorePanel facts={facts} />
    );
};

/** Memory from the platform when it keeps it, or else the memory grants in Query Store. */
export const MemoryPanel = ({ facts }: PanelProps) => {
    const platform = usePlatformMetric("memory", facts);
    if (platform.pending) {
        return <ChartCardSkeleton chartHeight={chartCardChartHeight} />;
    }
    return platform.series ? (
        <PlatformMetricCard series={platform.series} facts={facts} />
    ) : (
        <MemoryGrantPanel facts={facts} />
    );
};

/**
 * A measure from the platform: its average and peak in the range, and its chart, critical at 80%
 * of the limit when the limit is known. The unit row names the platform as the source.
 */
const PlatformMetricCard = ({
    series,
    facts,
}: {
    series: PlatformMetricSeries;
    facts: DatabaseFactsResult | undefined;
}) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { range } = useReadContext();
    const points = platformPoints(series);
    const average =
        points.length > 0
            ? points.reduce((sum, point) => sum + point.y, 0) / points.length
            : undefined;
    const peak = points.reduce<(typeof points)[number] | undefined>(
        (top, point) => (point.y > (top?.y ?? -1) ? point : top),
        undefined,
    );
    const vCoreLimit =
        series.unit === "vCores" ? (series.limit ?? facts?.facts?.vCores) : undefined;
    const format = (value: number) => {
        switch (series.unit) {
            case "vCores":
                // Two significant digits below 1, so 0.006 vCores does not show as 0 or 0.01.
                return text.vCoresValue(formatNumber(value));
            case "percent":
                return formatPercentRounded(value);
            case "megabytes":
                return formatStorageSize(value);
            case "count":
                return formatNumber(value);
        }
    };
    const critical =
        series.unit === "percent"
            ? criticalPercent
            : vCoreLimit
              ? (criticalPercent / 100) * vCoreLimit
              : undefined;

    return (
        <div className={classes.panel}>
            <ChartCard
                label={series.kind === "cpu" ? text.averageCpu : text.averageMemory}
                value={average !== undefined ? format(average) : text.notAvailable}
                figures={[
                    {
                        label: text.peak,
                        value: peak
                            ? text.valueAt(format(peak.y), dateTimeFormat.format(peak.x))
                            : text.notAvailable,
                    },
                    ...(vCoreLimit
                        ? [{ label: text.limit, value: text.vCoresValue(formatNumber(vCoreLimit)) }]
                        : []),
                ]}
                unit={platformUnit(series)}>
                <ThresholdChart
                    compact
                    title={platformUnit(series)}
                    range={range}
                    points={points}
                    format={format}
                    tickFormat={formatNumber}
                    critical={critical}
                    {...(series.unit === "percent" ? { yMax: 100 } : {})}
                />
            </ChartCard>
        </div>
    );
};

/**
 * CPU from Query Store: the CPU time of the captured queries against the cores, and the CPU
 * seconds of each interval. An interval is critical at 80% of the CPU seconds that the cores
 * have in it.
 */
export const CpuQueryStorePanel = ({ facts }: PanelProps) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { key, range, window, availableFrom } = useReadContext();
    const databaseFacts = facts?.facts;
    const cores = cpuCoreCount(databaseFacts);

    const consumption = useExtensionRequest(GetResourceConsumptionRequest.type, window, key);

    const coresLabel =
        cores === undefined
            ? undefined
            : sizeLabel(
                  cores === databaseFacts?.vCores ? { vCores: cores } : { logicalCpus: cores },
              );
    // Without cores to divide by, a point is the cores in use: the CPU time over the interval.
    // Times the interval, it is the CPU seconds of the interval.
    const report = readData(consumption);
    const intervalSeconds = (cpuBucketMs(report) ?? 0) / 1000;
    const points = cpuChartPoints(report, range, availableFrom, undefined).map((point) => ({
        x: point.x,
        y: point.y * intervalSeconds,
    }));
    const critical =
        cores !== undefined && intervalSeconds > 0
            ? (criticalPercent / 100) * cores * intervalSeconds
            : undefined;
    // The figures are of the chart: the CPU seconds in the range, and its busiest interval.
    const totalSeconds = points.reduce((sum, point) => sum + point.y, 0);
    const peak = points.reduce<(typeof points)[number] | undefined>(
        (top, point) => (point.y > (top?.y ?? 0) ? point : top),
        undefined,
    );
    const interval = intervalSeconds > 0 ? intervalName(intervalSeconds / 60) : undefined;
    const unit = interval ? text.cpuSecondsPerInterval(interval) : text.cpuSecondsAxis;

    return (
        <div className={classes.panel}>
            {isReadOnly(consumption) && <ReadOnlyNotice />}
            <ChartCard
                label={text.cpuUsed}
                value={report ? formatCpuSeconds(totalSeconds) : text.notAvailable}
                figures={[
                    {
                        label: interval ? text.peakPerInterval(interval) : text.peak,
                        value: peak
                            ? text.valueAt(formatCpuSeconds(peak.y), dateTimeFormat.format(peak.x))
                            : text.notAvailable,
                    },
                ]}
                unit={coresLabel ? text.unitWithSize(unit, coresLabel) : unit}
                loading={isFirstLoad(consumption)}>
                <ThresholdChart
                    compact
                    title={text.capturedCpuSeconds}
                    range={range}
                    points={points}
                    format={formatCpuSeconds}
                    tickFormat={formatNumber}
                    critical={critical}
                    read={consumption}
                    message={readStatusMessage(consumption)}
                />
            </ChartCard>
        </div>
    );
};

const cpuSecondsFormat = new Intl.NumberFormat(undefined, {
    style: "unit",
    unit: "second",
    unitDisplay: "short",
    maximumFractionDigits: 2,
});

/** CPU seconds with the unit, for example 12.5 sec. */
function formatCpuSeconds(seconds: number): string {
    return cpuSecondsFormat.format(seconds);
}

/**
 * Memory from Query Store: the average grant for each execution, the peak grant, and the peak
 * grant of each interval. Query Store has no memory limit to compare with, so no interval
 * is critical.
 */
export const MemoryGrantPanel = (_props: PanelProps) => {
    const text = loc.performanceDashboard;
    const { key, range, window, now, availableFrom } = useReadContext();
    const totals = useExtensionRequest(
        GetMetricTotalsRequest.type,
        { metric: "memoryConsumption", windows: cpuSummaryWindows(range, now) },
        key,
    );
    const series = useExtensionRequest(
        GetMetricSeriesRequest.type,
        { ...window, metric: "memoryConsumption", bucketMinutes: bucketMinutesFor(range) },
        key,
    );

    const blocking = readStatusMessage(totals);
    if (blocking) {
        return <StatusBar message={blocking} />;
    }
    const windows = readData(totals)?.windows ?? [];
    const [inRange] = windows;
    const averageKb =
        inRange && inRange.executionCount > 0 ? inRange.total / inRange.executionCount : undefined;
    const seriesData = readData(series);
    const peakKb = seriesData?.buckets.reduce((max, bucket) => Math.max(max, bucket.max ?? 0), 0);
    const points = seriesData
        ? filledSeriesPoints(
              seriesData.buckets.map((bucket) => ({
                  startUtc: bucket.startUtc,
                  value: (bucket.max ?? 0) / 1024,
              })),
              seriesData.bucketMinutes,
              range,
              availableFrom,
          )
        : [];

    return (
        <>
            {isReadOnly(totals) && <ReadOnlyNotice />}
            <ChartCard
                label={text.averageMemoryGrant}
                value={averageKb !== undefined ? formatMegabytes(averageKb) : text.notAvailable}
                figures={[
                    {
                        label: text.peakMemoryGrant,
                        value: peakKb !== undefined ? formatMegabytes(peakKb) : text.notAvailable,
                    },
                ]}
                unit={text.peakMemoryGrantPerInterval(
                    intervalName(seriesData?.bucketMinutes ?? bucketMinutesFor(range)),
                )}
                loading={(totals.loading && windows.length === 0) || isFirstLoad(series)}>
                <ThresholdChart
                    compact
                    title={text.peakMemoryGrantMb}
                    range={range}
                    points={points}
                    format={(megabytes) => formatMegabytes(megabytes * 1024)}
                    tickFormat={formatNumber}
                    read={series}
                    message={readStatusMessage(series)}
                />
            </ChartCard>
        </>
    );
};

/** Requests from the platform when it keeps them, or else the executions in Query Store. */
export const RequestsPanel = ({ facts }: PanelProps) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { range } = useReadContext();
    const platform = usePlatformMetric("requests", facts);
    if (platform.pending) {
        return <ChartCardSkeleton chartHeight={chartCardChartHeight} />;
    }
    if (!platform.series) {
        return <RequestsQueryStorePanel facts={facts} />;
    }
    const series = platform.series;
    const points = platformPoints(series);
    const total = points.reduce((sum, point) => sum + point.y, 0);
    return (
        <div className={classes.panel}>
            <ChartCard
                label={text.averageRequestsPerInterval(intervalName(series.bucketMinutes))}
                value={points.length > 0 ? formatNumber(total / points.length) : text.notAvailable}
                figures={[{ label: text.totalRequests, value: formatNumber(total) }]}
                unit={platformUnit(series)}>
                <TimeSeriesChart
                    compact
                    title={platformUnit(series)}
                    range={range}
                    points={points}
                    format={formatNumber}
                />
            </ChartCard>
        </div>
    );
};

/**
 * The requests from Query Store: the executions of each 15 minutes, or of each Query Store interval
 * when it is longer, and their changes. The average is per bucket of the chart, so they agree.
 */
const RequestsQueryStorePanel = (_props: PanelProps) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { key, range, window, now, availableFrom } = useReadContext();
    const totals = useExtensionRequest(
        GetMetricTotalsRequest.type,
        { metric: "executionCount", windows: cpuSummaryWindows(range, now) },
        key,
    );
    const series = useExtensionRequest(
        GetMetricSeriesRequest.type,
        { ...window, metric: "executionCount", bucketMinutes: requestBucketMinutes },
        key,
    );

    const blocking = readStatusMessage(totals);
    if (blocking) {
        return <StatusBar message={blocking} />;
    }
    const windows = readData(totals)?.windows ?? [];
    const [inRange] = windows;
    const seriesData = readData(series);
    const bucketMinutes = seriesData?.bucketMinutes ?? requestBucketMinutes;
    const periods =
        (range.to.getTime() - dataStart(range, availableFrom)) / (bucketMinutes * 60_000);
    const perPeriod = inRange && periods > 0 ? inRange.total / periods : undefined;
    const points = seriesData
        ? filledSeriesPoints(
              seriesData.buckets.map((bucket) => ({
                  startUtc: bucket.startUtc,
                  value: bucket.executionCount,
              })),
              seriesData.bucketMinutes,
              range,
              availableFrom,
          )
        : [];

    return (
        <div className={classes.panel}>
            {isReadOnly(totals) && <ReadOnlyNotice />}
            <ChartCard
                label={text.averageRequestsPerInterval(intervalName(bucketMinutes))}
                value={
                    perPeriod !== undefined && seriesData
                        ? formatNumber(perPeriod)
                        : text.notAvailable
                }
                figures={[
                    {
                        label: text.totalRequests,
                        value: inRange ? formatNumber(inRange.total) : text.notAvailable,
                    },
                ]}
                unit={text.requestsPerInterval(intervalName(bucketMinutes))}
                loading={(totals.loading && windows.length === 0) || isFirstLoad(series)}>
                <TimeSeriesChart
                    compact
                    title={text.requestsPerInterval(intervalName(bucketMinutes))}
                    range={range}
                    points={points}
                    format={formatNumber}
                    read={series}
                    message={readStatusMessage(series)}
                />
            </ChartCard>
        </div>
    );
};
