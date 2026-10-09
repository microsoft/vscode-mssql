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
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    Select,
    shorthands,
    Spinner,
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
import type { ExtensionRequestState } from "../../common/useExtensionRequest";
import { dateTimeFormat, formatPercent } from "./performanceDashboardFormat";
import { PerformanceDashboardRoute, withSettings } from "./performanceDashboardRoutes";
import { StatusMessage } from "./performanceDashboardStatus";

const useStyles = makeStyles({
    summary: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-end",
        columnGap: "40px",
        rowGap: "8px",
        ...shorthands.padding("12px", "16px"),
        ...shorthands.border("1px", "solid", "var(--vscode-panel-border)"),
        ...shorthands.borderRadius(tokens.borderRadiusMedium),
    },
    figure: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("2px"),
        minWidth: "120px",
    },
    hero: {
        fontSize: tokens.fontSizeHero700,
        lineHeight: tokens.lineHeightHero700,
        fontWeight: tokens.fontWeightSemibold,
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
    sectionHeader: {
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        ...shorthands.gap("12px"),
    },
    sectionTitle: {
        ...shorthands.margin(0),
    },
    empty: {
        color: tokens.colorNeutralForeground3,
    },
});

/** The data of a read, when it has data. */
export function readData<T>(state: ExtensionRequestState<PerformanceReadResult<T>>): T | undefined {
    return state.result && "data" in state.result ? state.result.data : undefined;
}

/** True when the read reports that Query Store is read-only. */
export function isReadOnly(state: ExtensionRequestState<PerformanceReadResult<unknown>>): boolean {
    return !!state.result && "missing" in state.result
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
    /** The headline value, already formatted. */
    readonly value: string;
    readonly caption: string;
    /** Explains how the value is worked out. */
    readonly info?: string;
    readonly changes?: readonly SummaryChange[];
    /** Other figures, such as the current count. */
    readonly figures?: readonly { readonly label: string; readonly value: string }[];
    readonly loading?: boolean;
}

/** A headline value with its changes against earlier periods. */
export const SummaryCard = ({
    value,
    caption,
    info,
    changes = [],
    figures = [],
    loading,
}: SummaryCardProps) => {
    const classes = useStyles();
    return (
        <div className={classes.summary} aria-busy={loading}>
            <div className={classes.figure}>
                <Text className={classes.hero}>{loading ? "…" : value}</Text>
                {info ? (
                    <InfoLabel size="small" className={classes.secondary} info={info}>
                        {caption}
                    </InfoLabel>
                ) : (
                    <Caption1 className={classes.secondary}>{caption}</Caption1>
                )}
            </div>
            {figures.map((figure) => (
                <div key={figure.label} className={classes.figure}>
                    <Caption1 className={classes.secondary}>{figure.label}</Caption1>
                    <Text className={classes.value}>{loading ? "…" : figure.value}</Text>
                </div>
            ))}
            {changes.map((change) => (
                <div key={change.label} className={classes.figure}>
                    <Caption1 className={classes.secondary}>{change.label}</Caption1>
                    <Change value={loading ? undefined : change.value} />
                </div>
            ))}
        </div>
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

/** A section title with optional content on the right, such as the observed time. */
export const SectionHeader = ({ title, children }: { title: string; children?: ReactNode }) => {
    const classes = useStyles();
    return (
        <div className={classes.sectionHeader}>
            <Subtitle2 as="h2" className={classes.sectionTitle}>
                {title}
            </Subtitle2>
            {children && <Caption1 className={classes.empty}>{children}</Caption1>}
        </div>
    );
};

/** The height of a time series chart, with its axes. */
const chartHeight = 260;

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
    if (message) {
        return <StatusBar message={message} />;
    }
    if (read?.loading && points.length === 0) {
        return <Spinner size="small" label={loc.common.loading} />;
    }
    if (points.length === 0) {
        return (
            <Caption1 className={classes.empty}>{loc.performanceDashboard.noChartData}</Caption1>
        );
    }
    const maxY = points.reduce((max, point) => Math.max(max, point.y), 0);
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
                    yMaxValue={yMax !== undefined ? Math.max(yMax, maxY) : undefined}
                    yAxisTickFormat={format}
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
        <div ref={frame} className={classes.frame} style={{ height }}>
            {width > 0 && children(width)}
        </div>
    );
};
