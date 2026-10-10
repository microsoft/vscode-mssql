/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Caption1, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { ChartProps, ScatterChart } from "@fluentui/react-charts";
import type {
    QueryHistoryInterval,
    QueryHistoryStats,
} from "../../../sharedInterfaces/performance";
import { locConstants as loc } from "../../common/locConstants";
import { useNavigation } from "../../common/navigation/navigationProvider";
import { dateTimeFormat } from "./performanceDashboardFormat";
import {
    ChartFrame,
    InlineSelect,
    axisDateFormat,
    useAxisStyles,
    xAxisTickCount,
    yAxisMargin,
    zeroBasedTicks,
} from "./performanceDashboardParts";
import { statisticLabel } from "./performanceDashboardQueriesPage";
import { PerformanceDashboardRoute } from "./performanceDashboardRoutes";

export type HistoryMetric = "duration" | "cpu" | "reads";
export type HistoryView = "total" | "avg" | "max" | "min";

const historyMetrics: readonly HistoryMetric[] = ["duration", "cpu", "reads"];
const historyViews: readonly HistoryView[] = ["total", "avg", "max", "min"];

const minuteMs = 60_000;
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
        case "cpu":
            return text.cpuMs;
        case "reads":
            return text.logicalReadsPages;
        default:
            return text.durationMs;
    }
}

/** The label of a metric on its own, for example "Duration (ms)". */
function historyMetricOption(metric: HistoryMetric): string {
    const text = loc.performanceDashboard;
    switch (metric) {
        case "cpu":
            return text.cpuMs;
        case "reads":
            return text.logicalReadsPagesOption;
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
    stats: QueryHistoryStats,
    metric: HistoryMetric,
    view: HistoryView,
): number | undefined {
    switch (metric) {
        case "cpu":
            return {
                total: stats.totalCpuMs,
                avg: stats.avgCpuMs,
                max: stats.maxCpuMs,
                min: stats.minCpuMs,
            }[view];
        case "reads":
            return {
                total: stats.totalLogicalReads,
                avg: stats.avgLogicalReads,
                max: stats.maxLogicalReads,
                min: stats.minLogicalReads,
            }[view];
        default:
            return {
                total: stats.totalDurationMs,
                avg: stats.avgDurationMs,
                max: stats.maxDurationMs,
                min: stats.minDurationMs,
            }[view];
    }
}

/** The length of the Query Store intervals in minutes, from the first interval. */
export function intervalMinutesOf(intervals: readonly QueryHistoryInterval[]): number {
    const first = intervals[0];
    return first
        ? Math.max(
              1,
              Math.round((Date.parse(first.endUtc) - Date.parse(first.startUtc)) / minuteMs),
          )
        : 60;
}

export interface PlanSummaryChartProps {
    readonly intervals: readonly QueryHistoryInterval[];
    readonly metric: HistoryMetric;
    readonly view: HistoryView;
    /** Every plan of the query, ordered by plan ID: the order of the colors and the legend. */
    readonly planIds: readonly string[];
    readonly colorOf: (planId: string) => string;
    readonly format: (value: number) => string;
}

/**
 * The plan summary, as in SSMS: a dot for each plan in each Query Store interval where the plan
 * ran, at the value of the metric and statistic, in the color of the plan.
 */
export const PlanSummaryChart = ({
    intervals,
    metric,
    view,
    planIds,
    colorOf,
    format,
}: PlanSummaryChartProps) => {
    const classes = useStyles();
    const axisClasses = useAxisStyles();
    const text = loc.performanceDashboard;
    const points = new Map<string, { x: Date; y: number }[]>();
    for (const interval of intervals) {
        const x = new Date(interval.startUtc);
        if (Number.isNaN(x.getTime())) {
            continue;
        }
        for (const plan of interval.plans) {
            const y = plan.executionCount > 0 ? historyValue(plan, metric, view) : undefined;
            if (y !== undefined) {
                points.set(plan.planId, [...(points.get(plan.planId) ?? []), { x, y }]);
            }
        }
    }
    if (points.size === 0) {
        return <Caption1 className={classes.empty}>{text.noChartData}</Caption1>;
    }
    const plans = [
        ...planIds.filter((planId) => points.has(planId)),
        ...[...points.keys()].filter((planId) => !planIds.includes(planId)),
    ];
    const data: ChartProps = {
        chartTitle: text.planSummaryTitle(historyTitle(metric, view)),
        scatterChartData: plans.map((planId) => ({
            legend: text.planLegend(planId),
            color: colorOf(planId),
            data: points.get(planId)!.map((point) => ({
                x: point.x,
                y: point.y,
                markerSize: 8,
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
                    margins={{ left: yAxisMargin(ticks.map(format)) }}
                    xAxisTickCount={xAxisTickCount(width)}
                    customDateTimeFormatter={axisDateFormat(allPoints.map((point) => point.x))}
                    styles={{ xAxis: axisClasses.axis, yAxis: axisClasses.axis }}
                    culture={navigator.language}
                />
            )}
        </ChartFrame>
    );
};
