/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, shorthands, Spinner } from "@fluentui/react-components";
import type { QueryHistoryInterval } from "../../../sharedInterfaces/performance";
import {
    GetQueryHistoryRequest,
    GetQueryPlansRequest,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useExtensionRequest } from "../../common/useExtensionRequest";
import { dateTimeFormat, formatNumber, timeFormat } from "./performanceDashboardFormat";
import { StatusBar, TimeSeriesChart, readData } from "./performanceDashboardParts";
import { usePlanColor } from "./performanceDashboardPlanColors";
import {
    HistoryControls,
    historyTitle,
    historyValue,
    intervalMinutesOf,
    useHistorySelection,
} from "./performanceDashboardPlanHistory";
import { useRefresh } from "./performanceDashboardRefresh";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { filledSeriesPoints } from "./performanceDashboardSeries";
import { SimpleGrid } from "./performanceDashboardSimpleGrid";
import { readStatusMessage } from "./performanceDashboardStatus";
import { useQueryStoreAvailableFrom, useViewTimeRange } from "./performanceDashboardTimeRange";

const useStyles = makeStyles({
    history: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("16px"),
    },
    table: {
        maxHeight: "420px",
        overflowY: "auto",
    },
    plans: {
        display: "inline-flex",
        flexWrap: "wrap",
        alignItems: "center",
        columnGap: "10px",
    },
    plan: {
        display: "inline-flex",
        alignItems: "center",
        ...shorthands.gap("4px"),
    },
    swatch: {
        width: "8px",
        height: "8px",
        ...shorthands.borderRadius("2px"),
        flexShrink: 0,
    },
});

/**
 * The runtime stats of the query over the time range, for all plans together: a chart of a
 * metric and statistic, and a table of each Query Store interval with the plans that ran in it.
 * The metric and statistic are in the location.
 */
export const PerformanceDashboardQueryHistory = ({ queryId }: { queryId: string }) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const { range, window } = useViewTimeRange();
    const availableFrom = useQueryStoreAvailableFrom();
    const { metric, view } = useHistorySelection();

    const key = [databaseName, refreshKey];
    const history = useExtensionRequest(GetQueryHistoryRequest.type, { queryId, ...window }, key);
    // Every plan of the query, for the same colors as the Plans tab.
    const plansRead = useExtensionRequest(GetQueryPlansRequest.type, { queryId, ...window }, key);
    const planIds = (readData(plansRead)?.plans ?? []).map((plan) => plan.planId);
    const colorOf = usePlanColor(planIds);

    const message = readStatusMessage(history);
    if (message) {
        return <StatusBar message={message} />;
    }
    const intervals = readData(history)?.intervals ?? [];
    if (history.loading && intervals.length === 0) {
        return <Spinner size="small" label={loc.common.loading} />;
    }

    const points = filledSeriesPoints(
        intervals.map((interval) => ({
            startUtc: interval.startUtc,
            value: historyValue(interval, metric, view) ?? 0,
        })),
        intervalMinutesOf(intervals),
        range,
        availableFrom,
    );

    return (
        <div className={classes.history}>
            <HistoryControls />
            <TimeSeriesChart
                title={historyTitle(metric, view)}
                points={points}
                format={formatNumber}
                read={history}
            />
            {intervals.length > 0 && (
                <div className={classes.table}>
                    <SimpleGrid<QueryHistoryInterval>
                        items={[...intervals].reverse()}
                        getRowId={(interval) => interval.startUtc}
                        ariaLabel={text.executionHistory}
                        columns={[
                            {
                                id: "interval",
                                header: text.timeInterval,
                                idealWidth: 240,
                                render: (interval) =>
                                    text.timeIntervalRange(
                                        dateTimeFormat.format(new Date(interval.startUtc)),
                                        timeFormat.format(new Date(interval.endUtc)),
                                    ),
                                compare: (left, right) =>
                                    Date.parse(left.startUtc) - Date.parse(right.startUtc),
                            },
                            {
                                id: "plans",
                                header: text.plans,
                                idealWidth: 140,
                                render: (interval) => (
                                    <span className={classes.plans}>
                                        {interval.plans.map((plan) => (
                                            <span key={plan.planId} className={classes.plan}>
                                                <span
                                                    className={classes.swatch}
                                                    style={{
                                                        backgroundColor: colorOf(plan.planId),
                                                    }}
                                                    aria-hidden
                                                />
                                                {plan.planId}
                                            </span>
                                        ))}
                                    </span>
                                ),
                            },
                            {
                                id: "executions",
                                header: text.executionCount,
                                numeric: true,
                                render: (interval) => formatNumber(interval.executionCount),
                                compare: (left, right) =>
                                    left.executionCount - right.executionCount,
                            },
                            {
                                id: "duration",
                                header: text.totalDurationMs,
                                numeric: true,
                                render: (interval) => formatNumber(interval.totalDurationMs),
                                compare: (left, right) =>
                                    left.totalDurationMs - right.totalDurationMs,
                            },
                            {
                                id: "cpu",
                                header: text.totalCpuMs,
                                numeric: true,
                                render: (interval) => formatNumber(interval.totalCpuMs),
                                compare: (left, right) => left.totalCpuMs - right.totalCpuMs,
                            },
                            {
                                id: "reads",
                                header: text.totalLogicalReadsPages,
                                numeric: true,
                                render: (interval) => formatNumber(interval.totalLogicalReads),
                                compare: (left, right) =>
                                    left.totalLogicalReads - right.totalLogicalReads,
                            },
                        ]}
                    />
                </div>
            )}
        </div>
    );
};
