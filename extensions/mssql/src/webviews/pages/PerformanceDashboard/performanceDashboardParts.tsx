/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Caption1,
    Label,
    Link,
    makeStyles,
    mergeClasses,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    Select,
    shorthands,
    Text,
    tokens,
    useId,
} from "@fluentui/react-components";
import { AreaChart, ChartProps } from "@fluentui/react-charts";
import { ReactNode, memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RequestType } from "vscode-jsonrpc/browser";
import {
    type PerformanceRead,
    isPerformanceUnavailable,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useNavigation } from "../../common/navigation/navigationProvider";
import {
    ExtensionRequestState,
    isFirstLoad,
    useExtensionRequest,
} from "../../common/useExtensionRequest";
import { dateTimeFormat } from "./performanceDashboardFormat";
import { PerformanceDashboardRoute, withSettings } from "./performanceDashboardRoutes";
import { ChartSkeleton, ValueSkeleton, useFadeInClass } from "./performanceDashboardSkeletons";
import { StatusMessage } from "./performanceDashboardStatus";

const panelBorder = "1px solid var(--vscode-panel-border)";
/** The height of the title row of a chart card, so it does not change as the value loads. */
const cardHeaderHeight = 36;

const useStyles = makeStyles({
    panel: {
        border: panelBorder,
        ...shorthands.borderRadius(tokens.borderRadiusMedium),
    },
    label: {
        color: tokens.colorNeutralForeground2,
    },
    // A panel with a body grows to the bottom of the page, so a grid in it can fill the space.
    panelFill: {
        display: "flex",
        flexDirection: "column",
        flex: "1 0 auto",
    },
    panelChart: {
        padding: "12px 16px 8px",
    },
    panelBody: {
        display: "flex",
        flexDirection: "column",
        flex: "1 0 auto",
        borderTop: panelBorder,
    },
    empty: {
        color: tokens.colorNeutralForeground3,
    },
    // A chart card: the headline and the chart's unit in one row over the chart.
    cardHeader: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        ...shorthands.gap("4px", "16px"),
        minHeight: `${cardHeaderHeight}px`,
        boxSizing: "border-box",
        padding: "6px 16px",
    },
    // The line between the title row and the chart.
    cardHeaderDivider: {
        borderBottom: panelBorder,
    },
    // The figures of a chart card, apart from each other.
    headline: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        columnGap: "28px",
        rowGap: "4px",
        minWidth: 0,
    },
    // A figure: its label, value, and detail on one baseline, in one text size.
    figure: {
        display: "inline-flex",
        alignItems: "baseline",
        columnGap: "5px",
        whiteSpace: "nowrap",
    },
    figureLabel: {
        color: tokens.colorNeutralForeground3,
    },
    figureValue: {
        color: tokens.colorNeutralForeground1,
    },
    unit: {
        color: tokens.colorNeutralForeground3,
        whiteSpace: "nowrap",
    },
    cardChart: {
        padding: "8px 16px 4px 8px",
    },
});

/** The data of a read, when it has data. */
export function readData<T>(state: ExtensionRequestState<PerformanceRead<T>>): T | undefined {
    // Data of other parameters, such as the previous category, is not shown while the new loads.
    return !state.stale && state.result && "data" in state.result ? state.result.data : undefined;
}

/**
 * Sends a dashboard read, and caches its result only when the read succeeded, so a read that
 * failed, such as one of a database that was paused, runs again when its view opens again.
 */
export function usePerformanceRead<TParams, T>(
    type: RequestType<TParams, PerformanceRead<T>, void>,
    params: TParams,
    key?: unknown,
): ExtensionRequestState<PerformanceRead<T>> {
    return useExtensionRequest(type, params, key, true, undefined, isSuccessfulRead);
}

function isSuccessfulRead(result: PerformanceRead<unknown>): boolean {
    return (
        !isPerformanceUnavailable(result) &&
        (result.status === "ready" || result.status === "noData")
    );
}

/** True when the read reports that Query Store is read-only. */
export function isReadOnly(state: ExtensionRequestState<PerformanceRead<unknown>>): boolean {
    return !state.stale && !!state.result && "queryStore" in state.result
        ? state.result.queryStore?.actualState === "readOnly"
        : false;
}

/** A message, with a link to the settings section that can fix the cause. */
export const StatusBar = ({ message }: { message: StatusMessage }) => {
    const { match, navigate } = useNavigation<PerformanceDashboardRoute>();
    const section = message.settingsSection;
    return (
        <MessageBar intent={message.intent}>
            <MessageBarBody>{message.text}</MessageBarBody>
            {section && (
                <MessageBarActions>
                    <Link onClick={() => navigate(withSettings(match, section))}>
                        {loc.performanceDashboard.openQueryStoreSettings}
                    </Link>
                </MessageBarActions>
            )}
        </MessageBar>
    );
};

/** The notice for read-only Query Store, with a link to its settings. */
export const ReadOnlyNotice = () => (
    <StatusBar
        message={{
            intent: "info",
            text: loc.performanceDashboard.queryStoreReadOnly,
            settingsSection: "queryStore",
        }}
    />
);

export interface ChartCardProps {
    /** What the headline value is, before it. */
    readonly label: string;
    /** The headline value, already formatted. */
    readonly value: string;
    /** More about the value, after it, for example "of 16 logical CPUs". */
    readonly detail?: string;
    /** Other figures after the headline, such as the peak. */
    readonly figures?: readonly { readonly label: string; readonly value: string }[];
    /** What the chart shows, on the right of the title row, for example "CPU seconds per hour". */
    readonly unit?: string;
    /** A figure on the right of the title row, in place of the unit, such as the last run. */
    readonly endFigure?: { readonly label: string; readonly value: string };
    readonly loading?: boolean;
    /** The chart, below the title row. */
    readonly children?: ReactNode;
}

/**
 * A chart in a frame with one title row: the headline value and other figures on the left, and
 * what the chart shows on the right, in place of a y-axis title.
 */
export const ChartCard = ({
    label,
    value,
    detail,
    figures = [],
    unit,
    endFigure,
    loading,
    children,
}: ChartCardProps) => {
    const classes = useStyles();
    const fadeIn = useFadeInClass();
    const figure = (figureLabel: string, figureValue: string, figureDetail?: string) => (
        <span key={figureLabel} className={classes.figure}>
            <Text size={200} className={classes.figureLabel}>
                {figureLabel}
            </Text>
            {loading ? (
                <ValueSkeleton width={40} height={14} />
            ) : (
                <Text
                    size={200}
                    weight="semibold"
                    className={mergeClasses(classes.figureValue, fadeIn)}>
                    {figureValue}
                </Text>
            )}
            {figureDetail && (
                <Text size={200} className={classes.figureLabel}>
                    {figureDetail}
                </Text>
            )}
        </span>
    );
    return (
        <section className={classes.panel} aria-busy={loading}>
            <div
                className={mergeClasses(
                    classes.cardHeader,
                    children ? classes.cardHeaderDivider : undefined,
                )}>
                <div className={classes.headline}>
                    {figure(label, value, detail)}
                    {figures.map((other) => figure(other.label, other.value))}
                </div>
                {endFigure
                    ? figure(endFigure.label, endFigure.value)
                    : unit && (
                          <Text size={200} className={classes.unit}>
                              {unit}
                          </Text>
                      )}
            </div>
            {children && <div className={classes.cardChart}>{children}</div>}
        </section>
    );
};

/** Labeled values in one row in a frame, as in the title row of a chart card. */
export const StatStrip = ({
    stats,
    end,
    loading,
}: {
    stats: readonly { readonly label: string; readonly value: string }[];
    /** A value on the right, such as the last run. */
    end?: { readonly label: string; readonly value: string };
    loading?: boolean;
}) => {
    const [first, ...others] = stats;
    return first ? (
        <ChartCard
            label={first.label}
            value={first.value}
            figures={others}
            endFigure={end}
            loading={loading}
        />
    ) : null;
};

/** A chart in a frame, with a table or other content below it in the same frame. */
export const ChartPanel = ({ chart, children }: { chart: ReactNode; children?: ReactNode }) => {
    const classes = useStyles();
    return (
        <section className={mergeClasses(classes.panel, children ? classes.panelFill : undefined)}>
            <div className={classes.panelChart}>{chart}</div>
            {children && <div className={classes.panelBody}>{children}</div>}
        </section>
    );
};

/** The height of a time series chart, with its axes. */
const chartHeight = 260;
/** The height of a chart in a chart card, whose title row names the unit. */
const compactChartHeight = 180;
/** The height of a time series chart, for placeholders of the same size. */
export const timeSeriesChartHeight = chartHeight;
/** The space for each x-axis label, so that the labels do not crowd. */
const xLabelWidth = 120;
const hourMs = 60 * 60 * 1000;

/** Five evenly spaced round ticks from 0, so that the top tick is at or above the highest value. */
export function zeroBasedTicks(max: number): number[] {
    const intervals = 4;
    if (!(max > 0)) {
        return [0, 1];
    }
    const rough = max / intervals;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const step =
        [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
            .map((factor) => factor * magnitude)
            .find((value) => value >= rough) ?? 10 * magnitude;
    // Rounded, so that 3 × 0.0015 is 0.0045 and not 0.0045000000000000005.
    return Array.from({ length: intervals + 1 }, (_, index) =>
        Number((index * step).toPrecision(12)),
    );
}

/** About the width of a character of the axis labels, which are the size of a caption. */
const axisCharacterWidth = 7;
const minAxisMargin = 40;
const axisTitleWidth = 24;

/**
 * The left margin of a chart, so that its longest y-axis label fits. The chart reserves a fixed
 * width by default and cuts longer labels, such as 1,000 MB.
 */
export function yAxisMargin(labels: readonly string[], title?: string): number {
    const longest = labels.reduce((max, label) => Math.max(max, label.length), 0);
    // A title is rotated beside the labels.
    return (
        Math.max(minAxisMargin, longest * axisCharacterWidth + 16) + (title ? axisTitleWidth : 0)
    );
}

/** The x-axis ticks for a chart width, so that the labels do not crowd. */
export function xAxisTickCount(width: number): number {
    return Math.max(2, Math.floor(width / xLabelWidth));
}

/** The time range that a chart's x-axis spans. */
export interface ChartRange {
    readonly from: Date;
    readonly to: Date;
}

/**
 * The x-axis of a time chart. The charts span their data, so with a range the axis gets ticks
 * spread evenly from its start to its end, which make it span the whole range. Without a range,
 * for data sampled while a view is open, the axis spans the data.
 */
export function xAxisProps(
    width: number,
    dates: readonly Date[],
    range?: ChartRange,
): {
    xAxisTickCount?: number;
    tickValues?: Date[];
    customDateTimeFormatter: (date: Date) => string;
} {
    if (!range) {
        return {
            xAxisTickCount: xAxisTickCount(width),
            customDateTimeFormatter: axisDateFormat(dates),
        };
    }
    const from = range.from.getTime();
    const span = range.to.getTime() - from;
    // The labels of a range over 3 days are days, so the ticks are at least a day apart and no
    // day shows twice.
    const count =
        span > dayLabelSpanMs
            ? Math.max(2, Math.min(xAxisTickCount(width), Math.floor(span / (24 * hourMs)) + 1))
            : xAxisTickCount(width);
    return {
        tickValues: Array.from(
            { length: count },
            (_, index) => new Date(from + (span * index) / (count - 1)),
        ),
        customDateTimeFormatter: axisDateFormat([range.from, range.to]),
    };
}

export const useAxisStyles = makeStyles({
    // The chart root clips by default, so its tooltip shrinks to the plot and scrolls. Without
    // clipping, the tooltip has the room of the page.
    root: {
        overflow: "visible",
    },
    // The default tick labels are 10px; these are the size of a caption.
    axis: {
        "& text": {
            fontSize: tokens.fontSizeBase200,
            fill: tokens.colorNeutralForeground2,
        },
    },
    // The y-axis also has its line, which the charts hide by default.
    yAxis: {
        "& text": {
            fontSize: tokens.fontSizeBase200,
            fill: tokens.colorNeutralForeground2,
        },
        "& path": {
            display: "inline",
            stroke: tokens.colorNeutralStroke1,
        },
    },
    title: {
        fontSize: tokens.fontSizeBase200,
        fill: tokens.colorNeutralForeground2,
    },
});

const axisTimeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const axisDayHourFormat = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
});
const axisDayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
/** The longest span with hours in the x-axis labels; longer spans show days. */
const dayLabelSpanMs = 72 * hourMs;

/** The x-axis label format for the span of the chart: the time, the day and hour, or the day. */
export function axisDateFormat(dates: readonly Date[]): (date: Date) => string {
    const times = dates.map((date) => date.getTime());
    const span = times.length > 1 ? Math.max(...times) - Math.min(...times) : 0;
    const format =
        span <= 36 * hourMs
            ? axisTimeFormat
            : span <= dayLabelSpanMs
              ? axisDayHourFormat
              : axisDayFormat;
    return (date) => format.format(date);
}

export interface TimeSeriesPoint {
    readonly x: Date;
    readonly y: number;
}

export interface TimeSeriesChartProps {
    readonly title: string;
    readonly points: readonly TimeSeriesPoint[];
    readonly format: (value: number) => string;
    /** The top of the y-axis, for example 100 for percents. Default: from the data. */
    readonly yMax?: number;
    /** The read of the chart data. A message replaces the chart; a spinner shows on the first load. */
    readonly read?: ExtensionRequestState<PerformanceRead<unknown>>;
    readonly message?: StatusMessage;
    /** The title beside the y-axis, for example CPU seconds. */
    readonly yAxisTitle?: string;
    /** The time range of the view, for an x-axis that spans it. Default: the span of the data. */
    readonly range?: ChartRange;
    /**
     * For a chart card: shorter, with straight lines and no y-axis line or title. The top tick has
     * the unit, from `format`; the others are plain numbers, from `tickFormat`.
     */
    readonly compact?: boolean;
    /** The y-axis tick labels below the top one. Default: `format`. */
    readonly tickFormat?: (value: number) => string;
}

/**
 * A single series over time: an area with a hover tooltip, no legend. It draws again only when
 * its props change.
 */
export const TimeSeriesChart = memo(function TimeSeriesChart({
    title,
    points,
    format,
    yMax,
    read,
    message,
    yAxisTitle,
    range,
    compact,
    tickFormat,
}: TimeSeriesChartProps) {
    const classes = useStyles();
    const axisClasses = useAxisStyles();
    const height = compact ? compactChartHeight : chartHeight;
    const series = useMemo(
        () =>
            points.map((point) => ({
                x: point.x,
                y: point.y,
                xAxisCalloutData: dateTimeFormat.format(point.x),
                yAxisCalloutData: format(point.y),
            })),
        [points, format],
    );
    if (message) {
        return <StatusBar message={message} />;
    }
    if (read && isFirstLoad(read)) {
        return <ChartSkeleton height={height} />;
    }
    if (points.length === 0) {
        return (
            <Caption1 className={classes.empty}>{loc.performanceDashboard.noChartData}</Caption1>
        );
    }
    const maxY = points.reduce((max, point) => Math.max(max, point.y), 0);
    // Round ticks from 0, up to at least the given top, such as 100 for percents.
    const yTicks = zeroBasedTicks(yMax !== undefined ? Math.max(yMax, maxY) : maxY);
    const topTick = yTicks[yTicks.length - 1];
    const tickLabel = (value: number) =>
        value === topTick ? format(value) : (tickFormat ?? format)(value);
    const data: ChartProps = {
        chartTitle: title,
        lineChartData: [
            {
                legend: title,
                ...(compact ? { lineOptions: { curve: "linear" as const } } : {}),
                data: series,
            },
        ],
    };
    return (
        <ChartFrame height={height}>
            {(width) => (
                <AreaChart
                    data={data}
                    width={width}
                    height={height}
                    hideLegend
                    mode="tozeroy"
                    yMinValue={0}
                    yMaxValue={topTick}
                    yAxisTickValues={yTicks}
                    yAxisTickFormat={tickLabel}
                    margins={{
                        left: yAxisMargin(yTicks.map(tickLabel), compact ? undefined : yAxisTitle),
                    }}
                    yAxisTitle={compact ? undefined : yAxisTitle}
                    {...xAxisProps(
                        width,
                        points.map((point) => point.x),
                        range,
                    )}
                    styles={{
                        root: axisClasses.root,
                        xAxis: axisClasses.axis,
                        yAxis: compact ? axisClasses.axis : axisClasses.yAxis,
                        axisTitle: axisClasses.title,
                    }}
                    culture={navigator.language}
                />
            )}
        </ChartFrame>
    );
});

const useInlineSelectStyles = makeStyles({
    field: {
        display: "inline-flex",
        alignItems: "center",
        ...shorthands.gap("8px"),
    },
    label: {
        whiteSpace: "nowrap",
    },
});

export interface InlineSelectProps<T extends string> {
    readonly label: string;
    readonly value: T;
    readonly options: readonly { readonly value: T; readonly label: string }[];
    readonly onChange: (value: T) => void;
}

/** A label and a small select on one line. */
export function InlineSelect<T extends string>({
    label,
    value,
    options,
    onChange,
}: InlineSelectProps<T>) {
    const classes = useInlineSelectStyles();
    const id = useId("inline-select");
    return (
        <span className={classes.field}>
            <Label htmlFor={id} size="small" className={classes.label}>
                {label}
            </Label>
            <Select
                id={id}
                size="small"
                value={value}
                onChange={(_event, data) => onChange(data.value as T)}>
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </Select>
        </span>
    );
}

const useChartFrameStyles = makeStyles({
    // No overflow clipping: the chart tooltips render inside the frame. The frame stacks above
    // the sticky grid headers below it, so a tooltip that extends past the chart is not hidden.
    frame: {
        position: "relative",
        zIndex: 3,
        width: "100%",
    },
});

/**
 * A fixed-height frame for a Fluent chart. The chart sizes itself from its container, so the
 * container must not size from the chart, or the two resize each other in a loop. The chart
 * renders after the frame has a width, so it never draws with a width of 0.
 */
export const ChartFrame = ({
    height,
    children,
}: {
    height: number;
    children: (width: number) => ReactNode;
}) => {
    const classes = useChartFrameStyles();
    const fadeIn = useFadeInClass();
    const frame = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        const element = frame.current;
        if (!element) {
            return;
        }
        const measure = (next: number) =>
            setWidth((current) => (Math.abs(current - next) >= 1 ? Math.floor(next) : current));
        measure(element.getBoundingClientRect().width);
        const observer = new ResizeObserver((entries) => measure(entries[0].contentRect.width));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    return (
        <div ref={frame} className={mergeClasses(classes.frame, fadeIn)} style={{ height }}>
            {width > 0 && children(width)}
        </div>
    );
};
