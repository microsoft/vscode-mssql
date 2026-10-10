/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, BadgeProps, Caption1, makeStyles, tokens } from "@fluentui/react-components";
import { AreaChart, ChartProps } from "@fluentui/react-charts";
import type {
    AutomaticTuningOption,
    TuningRecommendation,
} from "../../../sharedInterfaces/performance";
import { GetAutomaticTuningRequest } from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { isFirstLoad, useExtensionRequest } from "../../common/useExtensionRequest";
import { dateTimeFormat, formatNumber } from "./performanceDashboardFormat";
import { simpleTextColumn } from "./performanceDashboardMetrics";
import { PanelProps } from "./performanceDashboardPanels";
import {
    ChartFrame,
    ChartRange,
    SectionHeader,
    StatusBar,
    ChartCard,
    chartCardChartHeight,
    intervalName,
    readData,
    useAxisStyles,
    xAxisProps,
    yAxisMargin,
} from "./performanceDashboardParts";
import { useRefresh } from "./performanceDashboardRefresh";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { bucketMinutesFor } from "./performanceDashboardSeries";
import { SimpleGrid } from "./performanceDashboardSimpleGrid";
import { ChartSkeleton, TableSkeleton } from "./performanceDashboardSkeletons";
import { readStatusMessage } from "./performanceDashboardStatus";
import { useViewTimeRange } from "./performanceDashboardTimeRange";

const minuteMs = 60_000;

const useStyles = makeStyles({
    view: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        flex: "1 0 auto",
    },
    note: {
        color: tokens.colorNeutralForeground3,
    },
    columns: {
        fontFamily: tokens.fontFamilyMonospace,
        whiteSpace: "nowrap",
        overflowX: "hidden",
        textOverflow: "ellipsis",
    },
});

/** What automatic tuning did to an index: created it, dropped it, or reverted a change. */
type IndexAction = "created" | "dropped" | "reverted";

interface IndexEvent {
    readonly action: IndexAction;
    readonly time: number;
}

/** The index recommendations: create and drop index, not plan corrections. */
function isIndexRecommendation(recommendation: TuningRecommendation): boolean {
    return /^(CREATE_?INDEX|DROP_?INDEX)$/i.test(recommendation.type ?? "");
}

function isDropIndex(recommendation: TuningRecommendation): boolean {
    return /^DROP_?INDEX$/i.test(recommendation.type ?? "");
}

/** The actions on the indexes: an applied create or drop, and a revert of either. */
function indexEvents(recommendations: readonly TuningRecommendation[]): IndexEvent[] {
    const events: IndexEvent[] = [];
    for (const recommendation of recommendations) {
        const applied = Date.parse(recommendation.executeActionStartTime ?? "");
        if (!Number.isNaN(applied)) {
            events.push({
                action: isDropIndex(recommendation) ? "dropped" : "created",
                time: applied,
            });
        }
        const reverted = Date.parse(recommendation.revertActionStartTime ?? "");
        if (!Number.isNaN(reverted)) {
            events.push({ action: "reverted", time: reverted });
        }
    }
    return events;
}

/** The time of the last action on a recommendation, or of its last refresh. */
function lastActionTime(recommendation: TuningRecommendation): string | undefined {
    const times = [
        recommendation.revertActionStartTime,
        recommendation.executeActionStartTime,
        recommendation.lastRefresh,
    ].filter((time): time is string => !!time && !Number.isNaN(Date.parse(time)));
    return times.sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

/**
 * Automatic index tuning: whether it creates and drops indexes, the trend of its actions in the
 * range, and the index recommendations with their state. The engine keeps the recommendations in
 * memory, so they start over after a restart or failover. Azure SQL Database and SQL database in
 * Fabric.
 */
export const PerformanceDashboardAutoIndexView = (_props: PanelProps) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const { range } = useViewTimeRange();
    const tuning = useExtensionRequest(GetAutomaticTuningRequest.type, undefined, [
        databaseName,
        refreshKey,
    ]);

    const message = readStatusMessage(tuning);
    if (message) {
        return <StatusBar message={message} />;
    }
    const data = readData(tuning);
    const loading = isFirstLoad(tuning);
    const option = (name: string) =>
        data?.options.find((candidate) => candidate.name.toUpperCase() === name);
    const recommendations = (data?.recommendations ?? []).filter(isIndexRecommendation);
    const events = indexEvents(recommendations).filter(
        (event) => event.time >= range.from.getTime() && event.time < range.to.getTime(),
    );

    return (
        <div className={classes.view}>
            <ChartCard
                label={text.createIndex}
                value={optionState(option("CREATE_INDEX"))}
                loading={loading}
                figures={[
                    { label: text.dropIndex, value: optionState(option("DROP_INDEX")) },
                    {
                        label: text.indexActionsInRange,
                        value: formatNumber(events.length),
                    },
                ]}
                unit={text.indexActionsPerInterval(intervalName(bucketMinutesFor(range)))}>
                {loading ? (
                    <ChartSkeleton height={chartCardChartHeight} />
                ) : (
                    <IndexTrendChart
                        events={events}
                        bucketMinutes={bucketMinutesFor(range)}
                        range={range}
                    />
                )}
            </ChartCard>
            <SectionHeader
                title={text.indexRecommendations}
                count={
                    recommendations.length > 0 ? formatNumber(recommendations.length) : undefined
                }
            />
            {loading ? (
                <TableSkeleton rows={3} numberColumns={4} />
            ) : (
                <SimpleGrid<TuningRecommendation>
                    fill
                    items={recommendations}
                    getRowId={(recommendation) => recommendation.name}
                    ariaLabel={text.indexRecommendations}
                    columns={[
                        simpleTextColumn<TuningRecommendation>(
                            "schema",
                            text.schemaName,
                            (recommendation) => recommendation.index?.schema,
                            120,
                        ),
                        simpleTextColumn<TuningRecommendation>(
                            "table",
                            text.tableName,
                            (recommendation) => recommendation.index?.table,
                            180,
                        ),
                        simpleTextColumn<TuningRecommendation>(
                            "type",
                            text.recommendationType,
                            (recommendation) =>
                                isDropIndex(recommendation) ? text.dropIndex : text.createIndex,
                            120,
                        ),
                        simpleTextColumn<TuningRecommendation>(
                            "index",
                            text.indexName,
                            (recommendation) => recommendation.index?.indexName,
                            220,
                        ),
                        {
                            id: "status",
                            header: text.status,
                            headerInfo: text.statusInfo,
                            idealWidth: 120,
                            render: (recommendation) => <StateBadge state={recommendation.state} />,
                            compare: (left, right) =>
                                (left.state ?? "").localeCompare(right.state ?? ""),
                        },
                        {
                            id: "keyColumns",
                            header: text.keyColumns,
                            headerInfo: text.keyColumnsInfo,
                            idealWidth: 220,
                            render: (recommendation) => (
                                <span
                                    className={classes.columns}
                                    title={recommendation.index?.indexColumns}>
                                    {recommendation.index?.indexColumns || "—"}
                                </span>
                            ),
                        },
                        {
                            id: "lastAction",
                            header: text.lastAction,
                            headerInfo: text.lastActionInfo,
                            idealWidth: 170,
                            render: (recommendation) => {
                                const time = lastActionTime(recommendation);
                                return time ? dateTimeFormat.format(new Date(time)) : "—";
                            },
                            compare: (left, right) =>
                                Date.parse(lastActionTime(left) ?? "") -
                                Date.parse(lastActionTime(right) ?? ""),
                        },
                    ]}
                />
            )}
            <Caption1 className={classes.note}>{text.automaticTuningRules}</Caption1>
        </div>
    );
};

/** On, Off, or N/A for an automatic tuning option. */
function optionState(option: AutomaticTuningOption | undefined): string {
    const text = loc.performanceDashboard;
    switch (option?.actualState?.toUpperCase()) {
        case "ON":
            return text.on;
        case "OFF":
            return text.off;
        default:
            return text.notAvailable;
    }
}

/** The colors of the index actions: cyan, blue, and lavender, apart from the red of critical. */
const actionColors: Readonly<Record<IndexAction, string>> = {
    created: "#00b7c3",
    reverted: "#0078d4",
    dropped: "#b4a0ff",
};

/** Whole-number ticks from 0: 0 to 4 at least, else 4 equal steps up to the highest count. */
function countTicks(max: number): number[] {
    const step = Math.max(1, Math.ceil(max / 4));
    return [0, 1, 2, 3, 4].map((index) => index * step);
}

/**
 * The index actions of each interval of the range: an area for each action, with a legend that
 * names them, so the color is not the only cue. The chart shows over the whole range even when
 * automatic tuning did nothing, with whole-number ticks.
 */
const IndexTrendChart = ({
    events,
    bucketMinutes,
    range,
}: {
    events: readonly IndexEvent[];
    bucketMinutes: number;
    range: ChartRange;
}) => {
    const axisClasses = useAxisStyles();
    const text = loc.performanceDashboard;
    const sizeMs = bucketMinutes * minuteMs;
    const first = Math.floor(range.from.getTime() / sizeMs) * sizeMs;
    const starts: number[] = [];
    for (let start = first; start < range.to.getTime(); start += sizeMs) {
        starts.push(start);
    }
    const labels: Record<IndexAction, string> = {
        created: text.indexCreated,
        reverted: text.indexReverted,
        dropped: text.indexDropped,
    };
    let maxCount = 0;
    const series = (["created", "reverted", "dropped"] as const).map((action) => {
        const counts = new Map<number, number>();
        for (const event of events.filter((candidate) => candidate.action === action)) {
            const start = Math.floor(event.time / sizeMs) * sizeMs;
            counts.set(start, (counts.get(start) ?? 0) + 1);
        }
        return {
            legend: labels[action],
            color: actionColors[action],
            lineOptions: { curve: "linear" as const },
            data: starts.map((start) => {
                const count = counts.get(start) ?? 0;
                maxCount = Math.max(maxCount, count);
                return {
                    x: new Date(start),
                    y: count,
                    xAxisCalloutData: dateTimeFormat.format(new Date(start)),
                    yAxisCalloutData: formatNumber(count),
                };
            }),
        };
    });
    const ticks = countTicks(maxCount);
    const data: ChartProps = { chartTitle: text.indexTrend, lineChartData: series };
    return (
        <ChartFrame height={chartCardChartHeight}>
            {(width) => (
                <AreaChart
                    data={data}
                    width={width}
                    height={chartCardChartHeight}
                    mode="tozeroy"
                    yMinValue={0}
                    yMaxValue={ticks[ticks.length - 1]}
                    yAxisTickValues={ticks}
                    yAxisTickFormat={formatNumber}
                    margins={{ left: yAxisMargin(ticks.map(formatNumber)) }}
                    {...xAxisProps(width, [], range)}
                    styles={{
                        xAxis: axisClasses.axis,
                        yAxis: axisClasses.axis,
                        axisTitle: axisClasses.title,
                    }}
                    culture={navigator.language}
                />
            )}
        </ChartFrame>
    );
};

const stateColors: Readonly<Record<string, BadgeProps["color"]>> = {
    Active: "brand",
    Verifying: "warning",
    Success: "success",
    Reverted: "danger",
    Expired: "informative",
};

const StateBadge = ({ state }: { state: string | undefined }) =>
    state ? (
        <Badge appearance="tint" shape="rounded" color={stateColors[state] ?? "informative"}>
            {state}
        </Badge>
    ) : (
        <>—</>
    );
