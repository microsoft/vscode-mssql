/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Caption1,
    InfoLabel,
    Label,
    Link,
    makeStyles,
    mergeClasses,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    Select,
    shorthands,
    Subtitle2,
    Text,
    tokens,
    useId,
} from "@fluentui/react-components";
import { AreaChart, ChartProps } from "@fluentui/react-charts";
import { ArrowDown16Regular, ArrowUp16Regular } from "@fluentui/react-icons";
import { ReactNode, useLayoutEffect, useRef, useState } from "react";
import type { PerformanceReadResult } from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useNavigation } from "../../common/navigation/navigationProvider";
import { ExtensionRequestState, isFirstLoad } from "../../common/useExtensionRequest";
import { dateTimeFormat, formatPercent } from "./performanceDashboardFormat";
import { PerformanceDashboardRoute, withSettings } from "./performanceDashboardRoutes";
import { ChartSkeleton, ValueSkeleton, useFadeInClass } from "./performanceDashboardSkeletons";
import { StatusMessage } from "./performanceDashboardStatus";

const panelBorder = "1px solid var(--vscode-panel-border)";

const useStyles = makeStyles({
    panel: {
        border: panelBorder,
        ...shorthands.borderRadius(tokens.borderRadiusMedium),
    },
    stats: {
        display: "flex",
        flexWrap: "wrap",
    },
    // Equal columns with a line between them.
    stat: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("4px"),
        flex: "1 1 0",
        minWidth: "160px",
        padding: "14px 16px",
        borderLeft: panelBorder,
        "&:first-child": {
            borderLeft: "none",
        },
    },
    chart: {
        borderTop: panelBorder,
        padding: "12px 16px 8px",
    },
    hero: {
        fontSize: tokens.fontSizeHero700,
        lineHeight: tokens.lineHeightHero700,
        fontWeight: tokens.fontWeightSemibold,
    },
    label: {
        color: tokens.colorNeutralForeground2,
    },
    secondary: {
        color: tokens.colorNeutralForeground3,
    },
    value: {
        display: "flex",
        alignItems: "center",
        ...shorthands.gap("4px"),
        fontSize: tokens.fontSizeBase400,
        fontWeight: tokens.fontWeightSemibold,
    },
    stripValue: {
        fontSize: tokens.fontSizeBase400,
        fontWeight: tokens.fontWeightSemibold,
        whiteSpace: "nowrap",
        overflowX: "hidden",
        textOverflow: "ellipsis",
    },
    panelChart: {
        padding: "12px 16px 8px",
    },
    panelBody: {
        borderTop: panelBorder,
    },
    sectionHeader: {
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        ...shorthands.gap("12px"),
    },
    sectionTitle: {
        display: "flex",
        alignItems: "baseline",
        ...shorthands.gap("8px"),
        ...shorthands.margin(0),
    },
    sectionEnd: {
        display: "flex",
        alignItems: "baseline",
        ...shorthands.gap("16px"),
    },
    empty: {
        color: tokens.colorNeutralForeground3,
    },
});

/** The data of a read, when it has data. */
export function readData<T>(state: ExtensionRequestState<PerformanceReadResult<T>>): T | undefined {
    // Data of other parameters, such as the previous category, is not shown while the new loads.
    return !state.stale && state.result && "data" in state.result ? state.result.data : undefined;
}

/** True when the read reports that Query Store is read-only. */
export function isReadOnly(state: ExtensionRequestState<PerformanceReadResult<unknown>>): boolean {
    return !state.stale && !!state.result && "missing" in state.result
        ? state.result.missing.includes("queryStoreReadOnly")
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

export interface SummaryChange {
    readonly label: string;
    /** A change in percent, or undefined when it is not known. */
    readonly value: number | undefined;
}

export interface SummaryCardProps {
    /** What the headline value is, above it. */
    readonly label: string;
    /** Explains how the value is worked out, in an info icon on the label. */
    readonly info?: string;
    /** The headline value, already formatted. */
    readonly value: string;
    /** More about the value, below it, for example "of 16 logical CPUs". */
    readonly detail?: string;
    readonly changes?: readonly SummaryChange[];
    /** Other figures, such as the current count. */
    readonly figures?: readonly { readonly label: string; readonly value: string }[];
    readonly loading?: boolean;
    /** The chart of the value, in the same panel below the figures. */
    readonly children?: ReactNode;
}

/**
 * A panel with a headline value, other figures, and the changes against earlier periods in equal
 * columns, and the chart of the value below them.
 */
export const SummaryCard = ({
    label,
    info,
    value,
    detail,
    changes = [],
    figures = [],
    loading,
    children,
}: SummaryCardProps) => {
    const classes = useStyles();
    const fadeIn = useFadeInClass();
    return (
        <section className={classes.panel} aria-busy={loading}>
            <div className={classes.stats}>
                <div className={classes.stat}>
                    {info ? (
                        <InfoLabel size="small" className={classes.label} info={info}>
                            {label}
                        </InfoLabel>
                    ) : (
                        <Caption1 className={classes.label}>{label}</Caption1>
                    )}
                    {loading ? (
                        <ValueSkeleton width={96} height={36} />
                    ) : (
                        <Text className={mergeClasses(classes.hero, fadeIn)}>{value}</Text>
                    )}
                    {detail && <Caption1 className={classes.secondary}>{detail}</Caption1>}
                </div>
                {figures.map((figure) => (
                    <div key={figure.label} className={classes.stat}>
                        <Caption1 className={classes.label}>{figure.label}</Caption1>
                        {loading ? (
                            <ValueSkeleton />
                        ) : (
                            <Text className={mergeClasses(classes.value, fadeIn)}>
                                {figure.value}
                            </Text>
                        )}
                    </div>
                ))}
                {changes.map((change) => (
                    <div key={change.label} className={classes.stat}>
                        <Caption1 className={classes.label}>{change.label}</Caption1>
                        {loading ? (
                            <ValueSkeleton />
                        ) : (
                            <span className={fadeIn}>
                                <Change value={change.value} />
                            </span>
                        )}
                    </div>
                ))}
            </div>
            {children && <div className={classes.chart}>{children}</div>}
        </section>
    );
};

/** Labeled values in equal columns with a line between them, in a frame. */
export const StatStrip = ({
    stats,
    loading,
}: {
    stats: readonly { readonly label: string; readonly value: string }[];
    loading?: boolean;
}) => {
    const classes = useStyles();
    const fadeIn = useFadeInClass();
    return (
        <section className={classes.panel} aria-busy={loading}>
            <div className={classes.stats}>
                {stats.map((stat) => (
                    <div key={stat.label} className={classes.stat}>
                        <Caption1 className={classes.label}>{stat.label}</Caption1>
                        {loading ? (
                            <ValueSkeleton width={88} />
                        ) : (
                            <Text
                                className={mergeClasses(classes.stripValue, fadeIn)}
                                title={stat.value}>
                                {stat.value}
                            </Text>
                        )}
                    </div>
                ))}
            </div>
        </section>
    );
};

/** A chart in a frame, with a table or other content below it in the same frame. */
export const ChartPanel = ({ chart, children }: { chart: ReactNode; children?: ReactNode }) => {
    const classes = useStyles();
    return (
        <section className={classes.panel}>
            <div className={classes.panelChart}>{chart}</div>
            {children && <div className={classes.panelBody}>{children}</div>}
        </section>
    );
};

/** A change in percent with an arrow, or N/A. */
const Change = ({ value }: { value: number | undefined }) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    if (value === undefined) {
        return <Text className={classes.value}>{`— ${text.notAvailable}`}</Text>;
    }
    const formatted = formatPercent(Math.abs(value));
    const up = value >= 0;
    return (
        <Text
            className={classes.value}
            aria-label={up ? text.increasedBy(formatted) : text.decreasedBy(formatted)}>
            {up ? <ArrowUp16Regular /> : <ArrowDown16Regular />}
            {formatted}
        </Text>
    );
};

export interface SectionHeaderProps {
    readonly title: string;
    /** A count after the title, for example "7 queries". */
    readonly count?: string;
    /** A link or button on the right, for example "View all queries". */
    readonly action?: ReactNode;
    /** A note on the right, such as the observed time. */
    readonly children?: ReactNode;
}

/** A section title with an optional count, and an optional note and action on the right. */
export const SectionHeader = ({ title, count, action, children }: SectionHeaderProps) => {
    const classes = useStyles();
    return (
        <div className={classes.sectionHeader}>
            <Subtitle2 as="h2" className={classes.sectionTitle}>
                {title}
                {count && <Caption1 className={classes.empty}>{count}</Caption1>}
            </Subtitle2>
            {(children || action) && (
                <div className={classes.sectionEnd}>
                    {children && <Caption1 className={classes.empty}>{children}</Caption1>}
                    {action}
                </div>
            )}
        </div>
    );
};

/** The height of a time series chart, with its axes. */
const chartHeight = 260;
/** The height of a time series chart, for placeholders of the same size. */
export const timeSeriesChartHeight = chartHeight;
/** The space for each x-axis label, so that the labels do not crowd. */
const xLabelWidth = 120;
const hourMs = 60 * 60 * 1000;

/** 0, a round middle value, and twice it, so that the top tick is at or above the highest value. */
export function zeroBasedTicks(max: number): number[] {
    if (!(max > 0)) {
        return [0, 1];
    }
    const rough = max / 2;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const step =
        [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((value) => value >= rough) ??
        10 * magnitude;
    return [0, step, 2 * step];
}

/** About the width of a character of the axis labels, which are the size of a caption. */
const axisCharacterWidth = 7;
const minAxisMargin = 40;

/**
 * The left margin of a chart, so that its longest y-axis label fits. The chart reserves a fixed
 * width by default and cuts longer labels, such as 1,000 MB.
 */
export function yAxisMargin(labels: readonly string[]): number {
    const longest = labels.reduce((max, label) => Math.max(max, label.length), 0);
    return Math.max(minAxisMargin, longest * axisCharacterWidth + 16);
}

/** The x-axis ticks for a chart width, so that the labels do not crowd. */
export function xAxisTickCount(width: number): number {
    return Math.max(2, Math.floor(width / xLabelWidth));
}

export const useAxisStyles = makeStyles({
    // The default tick labels are 10px; these are the size of a caption.
    axis: {
        "& text": {
            fontSize: tokens.fontSizeBase200,
            fill: tokens.colorNeutralForeground2,
        },
    },
});

const axisTimeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const axisDayHourFormat = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
});
const axisDayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** The x-axis label format for the span of the chart: the time, the day and hour, or the day. */
export function axisDateFormat(dates: readonly Date[]): (date: Date) => string {
    const times = dates.map((date) => date.getTime());
    const span = times.length > 1 ? Math.max(...times) - Math.min(...times) : 0;
    const format =
        span <= 36 * hourMs
            ? axisTimeFormat
            : span <= 72 * hourMs
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
    readonly read?: ExtensionRequestState<PerformanceReadResult<unknown>>;
    readonly message?: StatusMessage;
}

/** A single series over time: an area with a hover tooltip, no legend. */
export const TimeSeriesChart = ({
    title,
    points,
    format,
    yMax,
    read,
    message,
}: TimeSeriesChartProps) => {
    const classes = useStyles();
    const axisClasses = useAxisStyles();
    if (message) {
        return <StatusBar message={message} />;
    }
    if (read && isFirstLoad(read)) {
        return <ChartSkeleton height={chartHeight} />;
    }
    if (points.length === 0) {
        return (
            <Caption1 className={classes.empty}>{loc.performanceDashboard.noChartData}</Caption1>
        );
    }
    const maxY = points.reduce((max, point) => Math.max(max, point.y), 0);
    // Round ticks from 0, up to at least the given top, such as 100 for percents.
    const yTicks = zeroBasedTicks(yMax !== undefined ? Math.max(yMax, maxY) : maxY);
    const data: ChartProps = {
        chartTitle: title,
        lineChartData: [
            {
                legend: title,
                data: points.map((point) => ({
                    x: point.x,
                    y: point.y,
                    xAxisCalloutData: dateTimeFormat.format(point.x),
                    yAxisCalloutData: format(point.y),
                })),
            },
        ],
    };
    return (
        <ChartFrame height={chartHeight}>
            {(width) => (
                <AreaChart
                    data={data}
                    width={width}
                    height={chartHeight}
                    hideLegend
                    mode="tozeroy"
                    yMinValue={0}
                    yMaxValue={yTicks[yTicks.length - 1]}
                    yAxisTickValues={yTicks}
                    yAxisTickFormat={format}
                    margins={{ left: yAxisMargin(yTicks.map(format)) }}
                    xAxisTickCount={xAxisTickCount(width)}
                    customDateTimeFormatter={axisDateFormat(points.map((point) => point.x))}
                    styles={{ xAxis: axisClasses.axis, yAxis: axisClasses.axis }}
                    culture={navigator.language}
                />
            )}
        </ChartFrame>
    );
};

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
    // No overflow clipping: the chart tooltips render inside the frame.
    frame: {
        position: "relative",
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
