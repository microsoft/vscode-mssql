/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Caption1, makeStyles, Text, tokens } from "@fluentui/react-components";
import { useMemo } from "react";
import { GetRegressedQueriesRequest } from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useNavigation } from "../../common/navigation/navigationProvider";
import {
    TimeRangePreset,
    resolveTimeRange,
    timeRangeFromQuery,
    timeRangeToQuery,
} from "../../common/timeRange/timeRange";
import { TimeRangePicker } from "../../common/timeRange/timeRangePicker";
import { formatNumber } from "./performanceDashboardFormat";
import { metrics } from "./performanceDashboardMetrics";
import {
    InlineSelect,
    ReadOnlyNotice,
    isReadOnly,
    readData,
    usePerformanceRead,
} from "./performanceDashboardParts";
import {
    HistoryMetric,
    historyMetricOption,
    historyMetrics,
} from "./performanceDashboardPlanHistory";
import { RecentPeriod, formatChange, recentPeriodLabel } from "./performanceDashboardQueryCompare";
import {
    PerformanceDashboardQueryList,
    QueryCategoryViewProps,
    QueryGridColumn,
    queryCount,
    useChatRowActions,
} from "./performanceDashboardQueryGrid";
import {
    RegressedQueryRow,
    filterQueryRows,
    regressedQueryRows,
} from "./performanceDashboardQueryList";
import { useRefresh } from "./performanceDashboardRefresh";
import { PerformanceDashboardRoute } from "./performanceDashboardRoutes";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { useQueryStoreAvailableFrom, useViewTimeRange } from "./performanceDashboardTimeRange";

/** The executions in each period that make an average worth comparing. */
const minExecutions = 2;

const dayMs = 24 * 60 * 60 * 1000;
const defaultBaselineId = "same";

/** The baselines, which end where the recent period starts. */
function baselinePresets(recentMs: number): TimeRangePreset[] {
    const text = loc.performanceDashboard;
    return [
        { id: defaultBaselineId, durationMs: recentMs, label: text.baselineSameLength },
        { id: "7d", durationMs: 7 * dayMs, label: text.baseline7Days },
        { id: "30d", durationMs: 30 * dayMs, label: text.baseline30Days },
    ];
}

const useStyles = makeStyles({
    muted: {
        color: tokens.colorNeutralForeground3,
    },
});

/**
 * The category of the queries that got worse per execution from a baseline period to a recent
 * one. The recent period is the time range at the top of the page. The metric and the baseline are
 * in the location, for example `queries?category=regressed&metric=cpuTime&baseline=7d`.
 */
export const PerformanceDashboardRegressedQueries = ({
    controls,
    search,
    favoritesOnly,
    favorites,
    setQuery,
}: QueryCategoryViewProps) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { match } = useNavigation<PerformanceDashboardRoute>();
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const { range, value, presets: recentPresets, window: recent } = useViewTimeRange();
    const availableFrom = useQueryStoreAvailableFrom();

    const metric: HistoryMetric = historyMetrics.includes(match.query.metric as HistoryMetric)
        ? (match.query.metric as HistoryMetric)
        : "duration";

    const presets = baselinePresets(range.to.getTime() - range.from.getTime());
    const baselineValue = timeRangeFromQuery(
        { range: match.query.baseline, from: match.query.baselineFrom, to: match.query.baselineTo },
        presets,
        defaultBaselineId,
    );
    const { from: baselineFrom, to: baselineTo } = resolveTimeRange(
        baselineValue,
        presets,
        range.from,
    );
    const baseline = { startUtc: baselineFrom.toISOString(), endUtc: baselineTo.toISOString() };
    // A custom baseline can overlap after the recent period moves, which compares nothing.
    const overlaps = baselineTo.getTime() > range.from.getTime();

    const regressed = usePerformanceRead(
        GetRegressedQueriesRequest.type,
        { recent, baseline, metric, top: queryCount, minExecutions },
        [databaseName, refreshKey],
        !overlaps,
    );

    const rows = useMemo(
        () =>
            filterQueryRows(
                regressedQueryRows(readData(regressed)),
                search,
                favoritesOnly ? favorites.queryIds : undefined,
            ),
        [regressed, search, favoritesOnly, favorites.queryIds],
    );

    // From the start of the baseline to now, so that the chat sees the query before and after.
    const chatWindow = useMemo(
        () => ({ startUtc: baseline.startUtc, endUtc: recent.endUtc }),
        [baseline.startUtc, recent.endUtc],
    );
    const rowActions = useChatRowActions(chatWindow);

    // A query opens at the metric of the list, and at the average that the list compares.
    const queryPageQuery = useMemo(
        () => ({ metric: metric === "duration" ? undefined : metric, view: "avg" }),
        [metric],
    );

    const columns = useMemo<QueryGridColumn<RegressedQueryRow>[]>(() => {
        const columnText = loc.performanceDashboard;
        const definition = metrics[metric];
        const average = columnText.rankedMetric(columnText.averageShort, definition.name());
        return [
            {
                id: "added",
                header: columnText.addedMetric(definition.name()),
                value: (row) => row.value,
                format: definition.display,
                exact: definition.exact,
                share: (row) => row.share,
                showShare: false,
            },
            {
                id: "change",
                header: columnText.change,
                value: (row) => row.changePercent,
                format: formatChange,
                textClass: "performance-grid-worse",
            },
            {
                id: "recent",
                header: columnText.recentColumn(average),
                value: (row) => row.recentAverage,
                format: definition.display,
                exact: definition.exact,
            },
            {
                id: "baseline",
                header: columnText.baselineColumn(average),
                value: (row) => row.baselineAverage,
                format: definition.display,
                exact: definition.exact,
            },
            {
                id: "executions",
                header: columnText.recentColumn(columnText.executionCount),
                value: (row) => row.executions,
                format: formatNumber,
            },
            {
                id: "newPlans",
                header: columnText.newPlans,
                value: (row) => row.newPlanCount,
                format: formatNumber,
            },
        ];
    }, [metric]);

    return (
        <>
            {controls(
                <>
                    <InlineSelect<HistoryMetric>
                        label={text.metric}
                        value={metric}
                        options={historyMetrics.map((option) => ({
                            value: option,
                            label: historyMetricOption(option),
                        }))}
                        onChange={(option) =>
                            setQuery({ metric: option === "duration" ? undefined : option })
                        }
                    />
                    <Text className={classes.muted}>{text.compareRecent}</Text>
                    <RecentPeriod label={recentPeriodLabel(range, value, recentPresets)} />
                    <Text className={classes.muted}>{text.versus}</Text>
                    <Text className={classes.muted}>{text.compareBaseline}</Text>
                    <TimeRangePicker
                        presets={presets}
                        value={baselineValue}
                        availableFrom={availableFrom}
                        presetEnd={range.from}
                        ariaLabel={text.baselineRangeLabel}
                        onChange={(next) => {
                            const query = timeRangeToQuery(next, defaultBaselineId);
                            setQuery({
                                baseline: query.range,
                                baselineFrom: query.from,
                                baselineTo: query.to,
                            });
                        }}
                    />
                </>,
            )}
            {overlaps ? (
                <Caption1 className={classes.muted}>{text.baselineOverlapsRecent}</Caption1>
            ) : (
                <>
                    {isReadOnly(regressed) && <ReadOnlyNotice />}
                    <PerformanceDashboardQueryList<RegressedQueryRow>
                        read={regressed}
                        rows={rows}
                        columns={columns}
                        ariaLabel={text.regressedQueries}
                        favorites={favorites}
                        rowActions={rowActions}
                        queryPageQuery={queryPageQuery}
                        emptyText={
                            favoritesOnly || search
                                ? text.noMatchingQueries
                                : text.noRegressedQueries
                        }
                    />
                    <Caption1 className={classes.muted}>
                        {text.regressedNote(formatNumber(minExecutions))}
                    </Caption1>
                </>
            )}
        </>
    );
};
