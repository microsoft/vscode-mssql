/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from "@fluentui/react-components";
import {
    DatabaseFactsResult,
    GetMetricSeriesRequest,
    GetMetricTotalsRequest,
    GetResourceConsumptionRequest,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { isFirstLoad, useExtensionRequest } from "../../common/useExtensionRequest";
import {
    cpuBucketMs,
    cpuChartPoints,
    cpuCoreCount,
    cpuSummary,
    cpuSummaryWindows,
} from "./performanceDashboardCpuModel";
import { formatMegabytes, formatNumber, formatPercentRounded } from "./performanceDashboardFormat";
import { sizeLabel } from "./performanceDashboardOverviewModel";
import {
    ReadOnlyNotice,
    StatusBar,
    ChartCard,
    intervalName,
    ThresholdChart,
    TimeSeriesChart,
    isReadOnly,
    readData,
} from "./performanceDashboardParts";
import { useRefresh } from "./performanceDashboardRefresh";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { bucketMinutesFor, dataStart, filledSeriesPoints } from "./performanceDashboardSeries";
import { readStatusMessage } from "./performanceDashboardStatus";
import { useQueryStoreAvailableFrom, useViewTimeRange } from "./performanceDashboardTimeRange";

/*
 * The panels of the overview segments: a summary of a measure, and its chart in the same frame.
 * Each panel reads Query Store, so the panels are the same on every platform.
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

/** The Query Store reads of a view: the database and refresh key, and the time range. */
function useReadContext() {
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const time = useViewTimeRange();
    const availableFrom = useQueryStoreAvailableFrom();
    return { key: [databaseName, refreshKey], availableFrom, ...time };
}

/**
 * CPU from Query Store, on every platform: the CPU time of the captured queries against the
 * cores, and the CPU seconds of each interval. An interval is critical at 80% of the CPU
 * seconds that the cores have in it.
 */
export const CpuQueryStorePanel = ({ facts }: PanelProps) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { key, range, window, now, availableFrom } = useReadContext();
    const databaseFacts = facts?.facts;
    const cores = cpuCoreCount(databaseFacts);

    const totals = useExtensionRequest(
        GetMetricTotalsRequest.type,
        { metric: "cpuTime", windows: cpuSummaryWindows(range, now) },
        key,
    );
    const consumption = useExtensionRequest(GetResourceConsumptionRequest.type, window, key);

    const blocking = readStatusMessage(totals);
    if (blocking) {
        return <StatusBar message={blocking} />;
    }
    const coresLabel =
        cores === undefined
            ? undefined
            : sizeLabel(
                  cores === databaseFacts?.vCores ? { vCores: cores } : { logicalCpus: cores },
              );
    const totalsData = readData(totals);
    const cpu = totalsData ? cpuSummary(totalsData.windows, cores, availableFrom) : undefined;
    const average =
        cpu?.averagePercent !== undefined
            ? formatPercentRounded(cpu.averagePercent)
            : cpu?.averageBusyCores !== undefined
              ? formatNumber(cpu.averageBusyCores)
              : text.notAvailable;
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

    return (
        <div className={classes.panel}>
            {isReadOnly(totals) && <ReadOnlyNotice />}
            <ChartCard
                label={coresLabel ? text.averageCpu : text.averageBusyCores}
                value={average}
                detail={coresLabel ? text.ofCpuSize(coresLabel) : undefined}
                unit={
                    intervalSeconds > 0
                        ? text.cpuSecondsPerInterval(intervalName(intervalSeconds / 60))
                        : text.cpuSecondsAxis
                }
                loading={totals.loading && !cpu}>
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
 * Memory from Query Store, on every platform: the average grant for each execution, the peak
 * grant, and the peak grant of each interval. Query Store has no memory limit to compare with, so no interval
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

/**
 * The requests from Query Store: the executions of each 15 minutes, or of each Query Store interval
 * when it is longer, and their changes. The average is per bucket of the chart, so they agree.
 */
export const RequestsPanel = (_props: PanelProps) => {
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
