/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Caption1,
    Link,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    makeStyles,
    shorthands,
    tokens,
} from "@fluentui/react-components";
import { AreaChart, ChartProps, DataVizPalette, getColorFromToken } from "@fluentui/react-charts";
import { memo, useMemo, useState } from "react";
import { historyBucketMinutes } from "sql-core/queryStore";
import {
    GetQueryPlansRequest,
    GetQueryWaitStatsRequest,
    PerformanceDashboardReducers,
    PerformanceDashboardState,
    type WaitCategoryStats,
    type WaitStatsInterval,
} from "../../../sharedInterfaces/performanceDashboard";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import { locConstants as loc } from "../../common/locConstants";
import { useNavigation } from "../../common/navigation/navigationProvider";
import type { ResolvedTimeRange } from "../../common/timeRange/timeRange";
import { isFirstLoad } from "../../common/useExtensionRequest";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { dateTimeFormat, formatNumber, formatShare } from "./performanceDashboardFormat";
import {
    ChartFrame,
    ChartPanel,
    InlineSelect,
    StatStrip,
    StatusBar,
    readData,
    timeSeriesChartHeight,
    useAxisStyles,
    xAxisProps,
    yAxisMargin,
    zeroBasedTicks,
    usePerformanceRead,
} from "./performanceDashboardParts";
import { intervalMinutesOf } from "./performanceDashboardPlanHistory";
import { planMetrics } from "./performanceDashboardQueryPlans";
import { useRefresh } from "./performanceDashboardRefresh";
import { PerformanceDashboardRoute, withSettings } from "./performanceDashboardRoutes";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { filledSeriesPoints } from "./performanceDashboardSeries";
import { DashboardGrid } from "./performanceDashboardGrid";
import { ChartSkeleton, TableSkeleton } from "./performanceDashboardSkeletons";
import { readStatusMessage } from "./performanceDashboardStatus";
import { useQueryStoreAvailableFrom, useViewTimeRange } from "./performanceDashboardTimeRange";

/** The most points of the wait chart, as for the execution history. */
const maxWaitPoints = 200;
/** The categories that the chart shows on their own; the others are summed as Other. */
const chartCategories = 5;
const allPlans = "";

const useStyles = makeStyles({
    waits: {
        display: "flex",
        flexDirection: "column",
        flex: "1 0 auto",
        ...shorthands.gap("12px"),
    },
    controls: {
        display: "flex",
        justifyContent: "flex-end",
    },
    empty: {
        color: tokens.colorNeutralForeground3,
    },
});

/**
 * What the query waits on in the time range: the wait time and the part of the duration spent
 * waiting, the wait time of the main categories over time, and a table of every category. The
 * waits are of all plans, or of one plan.
 */
export const PerformanceDashboardQueryWaits = ({ queryId }: { queryId: string }) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { match, navigate } = useNavigation<PerformanceDashboardRoute>();
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const { range, window } = useViewTimeRange();
    const availableFrom = useQueryStoreAvailableFrom();
    const [planId, setPlanId] = useState(allPlans);
    const key = [databaseName, refreshKey];

    // The Plans tab's read, so the plan list comes from the cache.
    const plansRead = usePerformanceRead(
        GetQueryPlansRequest.type,
        { queryId, metrics: planMetrics, ...window },
        key,
    );
    const waitsRead = usePerformanceRead(
        GetQueryWaitStatsRequest.type,
        {
            queryId,
            planId: planId || undefined,
            ...window,
            bucketMinutes: historyBucketMinutes(
                { start: range.from, end: range.to },
                maxWaitPoints,
            ),
        },
        key,
    );
    const plans = readData(plansRead) ?? [];
    const waits = readData(waitsRead);

    const message = readStatusMessage(waitsRead);
    const loading = isFirstLoad(waitsRead);
    const durationShare =
        waits && waits.durationTotalMs > 0
            ? Math.min(1, waits.totalWaitMs / waits.durationTotalMs)
            : undefined;
    const milliseconds = (value: number) => text.milliseconds(formatNumber(value));

    return (
        <div className={classes.waits}>
            {plans.length > 1 && (
                <div className={classes.controls}>
                    <InlineSelect<string>
                        label={text.plan}
                        value={planId}
                        options={[
                            { value: allPlans, label: text.allPlans },
                            ...plans.map((plan) => ({
                                value: plan.planId,
                                label: text.planLegend(plan.planId),
                            })),
                        ]}
                        onChange={setPlanId}
                    />
                </div>
            )}
            {waits?.captureMode === "off" && (
                <MessageBar intent="warning">
                    <MessageBarBody>{text.waitCaptureOff}</MessageBarBody>
                    <MessageBarActions>
                        <Link onClick={() => navigate(withSettings(match, "queryStore"))}>
                            {text.turnOnWaitCapture}
                        </Link>
                    </MessageBarActions>
                </MessageBar>
            )}
            {message ? (
                <StatusBar message={message} />
            ) : (
                <>
                    <StatStrip
                        loading={loading}
                        stats={[
                            {
                                label: text.totalWait,
                                value: waits ? milliseconds(waits.totalWaitMs) : "",
                            },
                            {
                                label: text.waitingShare,
                                value:
                                    durationShare === undefined
                                        ? text.notAvailable
                                        : formatShare(durationShare * 100),
                            },
                            {
                                label: text.topWait,
                                value: waits?.categories[0]?.category ?? text.notAvailable,
                            },
                            {
                                label: text.executionCount,
                                value: waits ? formatNumber(waits.executionCount) : "",
                            },
                        ]}
                    />
                    {loading ? (
                        <ChartPanel chart={<ChartSkeleton height={timeSeriesChartHeight} />}>
                            <TableSkeleton framed={false} rows={3} numberColumns={4} />
                        </ChartPanel>
                    ) : !waits || waits.categories.length === 0 ? (
                        <Caption1 className={classes.empty}>{text.noWaits}</Caption1>
                    ) : (
                        <ChartPanel
                            chart={
                                <WaitChart
                                    intervals={waits.intervals}
                                    categories={waits.categories}
                                    range={range}
                                    availableFrom={availableFrom}
                                />
                            }>
                            <DashboardGrid<WaitCategoryStats>
                                framed={false}
                                items={waits.categories}
                                getRowId={(category) => category.category}
                                ariaLabel={text.waitsTab}
                                defaultSort={{ column: "total", direction: "descending" }}
                                columns={[
                                    {
                                        id: "category",
                                        header: text.waitCategory,
                                        grow: true,
                                        width: 200,
                                        text: (category) => category.category,
                                        sortValue: (category) => category.category,
                                    },
                                    {
                                        id: "total",
                                        header: text.totalWait,
                                        numeric: true,
                                        text: (category) => milliseconds(category.totalMs),
                                        sortValue: (category) => category.totalMs,
                                    },
                                    {
                                        id: "average",
                                        header: text.avgWaitPerExecution,
                                        numeric: true,
                                        width: 180,
                                        text: (category) =>
                                            category.avgMsPerExecution === undefined
                                                ? text.notAvailable
                                                : milliseconds(category.avgMsPerExecution),
                                        sortValue: (category) => category.avgMsPerExecution,
                                    },
                                    {
                                        id: "max",
                                        header: text.maxWait,
                                        numeric: true,
                                        text: (category) => milliseconds(category.maxMs),
                                        sortValue: (category) => category.maxMs,
                                    },
                                    {
                                        id: "share",
                                        header: text.shareOfWaits,
                                        numeric: true,
                                        text: (category) => formatShare(category.share * 100),
                                        sortValue: (category) => category.share,
                                    },
                                ]}
                            />
                        </ChartPanel>
                    )}
                </>
            )}
        </div>
    );
};

interface WaitChartProps {
    readonly intervals: readonly WaitStatsInterval[];
    /** Most wait time first. */
    readonly categories: readonly WaitCategoryStats[];
    readonly range: ResolvedTimeRange;
    readonly availableFrom: Date | undefined;
}

/** The wait time of the main categories over time, stacked, with Other for the rest. */
const WaitChart = memo(function WaitChart({
    intervals,
    categories,
    range,
    availableFrom,
}: WaitChartProps) {
    const axisClasses = useAxisStyles();
    const { themeKind } = useVscodeWebview<
        PerformanceDashboardState,
        PerformanceDashboardReducers
    >();
    const isDark = themeKind === ColorThemeKind.Dark || themeKind === ColorThemeKind.HighContrast;
    const { series, top } = useMemo(() => {
        const text = loc.performanceDashboard;
        const shown = categories.slice(0, chartCategories).map((category) => category.category);
        const hasOther = categories.length > chartCategories;
        const bucketMinutes = intervalMinutesOf(intervals);
        const valueOf = (interval: WaitStatsInterval, name: string | undefined) =>
            name !== undefined
                ? (interval.waits[name] ?? 0)
                : Object.entries(interval.waits)
                      .filter(([category]) => !shown.includes(category))
                      .reduce((sum, [, value]) => sum + value, 0);
        const names: (string | undefined)[] = [...shown, ...(hasOther ? [undefined] : [])];
        const built = names.map((name, index) => ({
            legend: name ?? text.otherWaits,
            color: getColorFromToken(
                DataVizPalette[`color${index + 1}` as keyof typeof DataVizPalette],
                isDark,
            ),
            data: filledSeriesPoints(
                intervals.map((interval) => ({
                    startUtc: interval.startUtc,
                    value: valueOf(interval, name),
                })),
                bucketMinutes,
                range,
                availableFrom,
            ).map((point) => ({
                x: point.x,
                y: point.y,
                xAxisCalloutData: dateTimeFormat.format(point.x),
                yAxisCalloutData: text.milliseconds(formatNumber(point.y)),
            })),
        }));
        // The stacked top of each point, for the y-axis.
        const stackedTop = built.reduce<number[]>(
            (totals, line) => line.data.map((point, index) => (totals[index] ?? 0) + point.y),
            [],
        );
        return { series: built, top: Math.max(0, ...stackedTop) };
    }, [intervals, categories, range, availableFrom, isDark]);

    const text = loc.performanceDashboard;
    const ticks = zeroBasedTicks(top);
    const data: ChartProps = { chartTitle: text.waitTimeMs, lineChartData: series };
    return (
        <ChartFrame height={timeSeriesChartHeight}>
            {(width) => (
                <AreaChart
                    data={data}
                    width={width}
                    height={timeSeriesChartHeight}
                    yMinValue={0}
                    yMaxValue={ticks[ticks.length - 1]}
                    yAxisTickValues={ticks}
                    yAxisTickFormat={formatNumber}
                    margins={{ left: yAxisMargin(ticks.map(formatNumber), text.waitTimeMs) }}
                    yAxisTitle={text.waitTimeMs}
                    {...xAxisProps(width, series[0]?.data.map((point) => point.x) ?? [], range)}
                    styles={{
                        root: axisClasses.root,
                        xAxis: axisClasses.axis,
                        yAxis: axisClasses.yAxis,
                        axisTitle: axisClasses.title,
                    }}
                    culture={navigator.language}
                />
            )}
        </ChartFrame>
    );
});
