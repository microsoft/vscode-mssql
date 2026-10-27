/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Caption1, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { ChartProps, ScatterChart } from "@fluentui/react-charts";
import { memo, useMemo } from "react";
import { historyBucketMinutes } from "sql-core/queryStore";
import {
    GetQueryHistoryRequest,
    type PerformanceRead,
    type QueryStoreInterval,
    type QueryStoreRuntimeStats,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useNavigation } from "../../common/navigation/navigationProvider";
import { ExtensionRequestState } from "../../common/useExtensionRequest";
import { dateTimeFormat } from "./performanceDashboardFormat";
import {
    ChartFrame,
    ChartRange,
    InlineSelect,
    useAxisStyles,
    xAxisProps,
    yAxisMargin,
    zeroBasedTicks,
    usePerformanceRead,
} from "./performanceDashboardParts";
import { statisticLabel } from "./performanceDashboardQueriesPage";
import { useRefresh } from "./performanceDashboardRefresh";
import { PerformanceDashboardRoute } from "./performanceDashboardRoutes";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { useViewTimeRange } from "./performanceDashboardTimeRange";

export type HistoryMetric = "duration" | "cpuTime" | "logicalReads";
export type HistoryView = "total" | "avg" | "max" | "min";

/** The metrics that the query page charts can show, which its reads ask for. */
export const historyMetrics: readonly HistoryMetric[] = ["duration", "cpuTime", "logicalReads"];
const historyViews: readonly HistoryView[] = ["total", "avg", "max", "min"];

const minuteMs = 60_000;
/**
 * The most points of a history chart, and rows of its table. A longer range sums the Query Store
 * intervals into buckets, on the server, so the page draws the same amount for any range.
 */
const maxHistoryPoints = 200;

/**
 * The history of the query over the time range. The execution history and the plan summary send
 * the same read, so the second one comes from the cache.
 */
export function useQueryHistory(
    queryId: string,
): ExtensionRequestState<PerformanceRead<readonly QueryStoreInterval[]>> {
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const { range, window } = useViewTimeRange();
    return usePerformanceRead(
        GetQueryHistoryRequest.type,
        {
            queryId,
            metrics: historyMetrics,
            ...window,
            bucketMinutes: historyBucketMinutes(
                { start: range.from, end: range.to },
                maxHistoryPoints,
            ),
        },
        [databaseName, refreshKey],
    );
}
/** The height of the plan summary chart, with its axes and legend. */
export const planSummaryChartHeight = 320;
const chartHeight = planSummaryChartHeight;

const useStyles = makeStyles({
    controls: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        ...shorthands.gap("8px", "20px"),
    },
    empty: {
        color: tokens.colorNeutralForeground3,
    },
});

export function historyMetricLabel(metric: HistoryMetric): string {
    const text = loc.performanceDashboard;
    switch (metric) {
        case "cpuTime":
            return text.cpuMs;
        case "logicalReads":
            return text.logicalReadsKb;
        default:
            return text.durationMs;
    }
}

/** The label of a metric on its own, for example "Duration (ms)". */
function historyMetricOption(metric: HistoryMetric): string {
    const text = loc.performanceDashboard;
    switch (metric) {
        case "cpuTime":
            return text.cpuMs;
        case "logicalReads":
            return text.logicalReadsKbOption;
        default:
            return text.durationMsOption;
    }
}

/** The chart title for a metric and statistic, for example "Total Duration (ms)". */
export function historyTitle(metric: HistoryMetric, view: HistoryView): string {
    return loc.performanceDashboard.rankedMetric(statisticLabel(view), historyMetricLabel(metric));
}

/**
 * The metric and statistic of the query page charts. They are in the location, so the execution
 * history and the plan summary show the same values.
 */
export function useHistorySelection(): { metric: HistoryMetric; view: HistoryView } {
    const { match } = useNavigation<PerformanceDashboardRoute>();
    const metric = historyMetrics.includes(match.query.metric as HistoryMetric)
        ? (match.query.metric as HistoryMetric)
        : "duration";
    const view = historyViews.includes(match.query.view as HistoryView)
        ? (match.query.view as HistoryView)
        : "total";
    return { metric, view };
}

/** The Metric and View by selects of the query page charts. */
export const HistoryControls = () => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { router, match, navigate } = useNavigation<PerformanceDashboardRoute>();
    const { metric, view } = useHistorySelection();
    const setQuery = (values: Record<string, string | undefined>) =>
        navigate(router.build("query", match.params, { ...match.query, ...values }));
    return (
        <div className={classes.controls}>
            <InlineSelect<HistoryMetric>
                label={text.metric}
                value={metric}
                options={historyMetrics.map((value) => ({
                    value,
                    label: historyMetricOption(value),
                }))}
                onChange={(value) => setQuery({ metric: value === "duration" ? undefined : value })}
            />
            <InlineSelect<HistoryView>
                label={text.viewBy}
                value={view}
                options={historyViews.map((value) => ({ value, label: statisticLabel(value) }))}
                onChange={(value) => setQuery({ view: value === "total" ? undefined : value })}
            />
        </div>
    );
};

/** The value of a metric and statistic in the stats of an interval, for all plans or one plan. */
export function historyValue(
    stats: QueryStoreRuntimeStats,
    metric: HistoryMetric,
    view: HistoryView,
): number | undefined {
    return stats.metrics[metric]?.[view];
}

/** The length of the Query Store intervals in minutes, from the first interval. */
export function intervalMinutesOf(
    intervals: readonly { readonly startUtc: string; readonly endUtc: string }[],
): number {
    const first = intervals[0];
    return first
        ? Math.max(
              1,
              Math.round((Date.parse(first.endUtc) - Date.parse(first.startUtc)) / minuteMs),
          )
        : 60;
}

export interface PlanSummaryChartProps {
    readonly intervals: readonly QueryStoreInterval[];
    readonly metric: HistoryMetric;
    readonly view: HistoryView;
    /** Every plan of the query, ordered by plan ID: the order of the colors and the legend. */
    readonly planIds: readonly string[];
    readonly colorOf: (planId: string) => string;
    readonly format: (value: number) => string;
    /** The time range of the view, which the x-axis spans. */
    readonly range?: ChartRange;
}

/**
 * The plan summary, as in SSMS: a dot for each plan in each Query Store interval where the plan
 * ran, at the value of the metric and statistic, in the color of the plan. It draws again only
 * when its props change, not when the plans table beside it does.
 */
export const PlanSummaryChart = memo(function PlanSummaryChart({
    intervals,
    metric,
    view,
    planIds,
    colorOf,
    format,
    range,
}: PlanSummaryChartProps) {
    const classes = useStyles();
    const axisClasses = useAxisStyles();
    const text = loc.performanceDashboard;
    const points = useMemo(() => {
        const byPlan = new Map<string, { x: Date; y: number }[]>();
        for (const interval of intervals) {
            const x = new Date(interval.startUtc);
            if (Number.isNaN(x.getTime())) {
                continue;
            }
            for (const plan of interval.plans) {
                const y = plan.executionCount > 0 ? historyValue(plan, metric, view) : undefined;
                if (y !== undefined) {
                    let planPoints = byPlan.get(plan.planId);
                    if (!planPoints) {
                        planPoints = [];
                        byPlan.set(plan.planId, planPoints);
                    }
                    planPoints.push({ x, y });
                }
            }
        }
        return byPlan;
    }, [intervals, metric, view]);
    if (points.size === 0) {
        return <Caption1 className={classes.empty}>{text.noChartData}</Caption1>;
    }
    const plans = [
        ...planIds.filter((planId) => points.has(planId)),
        ...[...points.keys()].filter((planId) => !planIds.includes(planId)),
    ];
    const data: ChartProps = {
        chartTitle: text.planSummaryTitle(historyTitle(metric, view)),
        // The points have no marker size, so they are the chart's small default dots.
        scatterChartData: plans.map((planId) => ({
            legend: text.planLegend(planId),
            color: colorOf(planId),
            data: points.get(planId)!.map((point) => ({
                x: point.x,
                y: point.y,
                xAxisCalloutData: dateTimeFormat.format(point.x),
                yAxisCalloutData: format(point.y),
            })),
        })),
    };
    const allPoints = [...points.values()].flat();
    // The scatter chart pads its domain below the lowest point, so it would show a negative
    // tick. Three ticks from 0 keep the axis like the other charts.
    const ticks = zeroBasedTicks(allPoints.reduce((max, point) => Math.max(max, point.y), 0));
    return (
        <ChartFrame height={chartHeight}>
            {(width) => (
                <ScatterChart
                    data={data}
                    width={width}
                    height={chartHeight}
                    yMinValue={0}
                    yMaxValue={ticks[ticks.length - 1]}
                    yAxisTickValues={ticks}
                    yAxisTickFormat={format}
                    margins={{ left: yAxisMargin(ticks.map(format), historyTitle(metric, view)) }}
                    yAxisTitle={historyTitle(metric, view)}
                    {...xAxisProps(
                        width,
                        allPoints.map((point) => point.x),
                        range,
                    )}
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
