/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    QueryStoreInterval,
    QueryStorePlanIntervalStats,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { dateTimeFormat } from "./performanceDashboardFormat";
import type { TimeBand } from "./performanceDashboardTimeBand";

/** An interval of the history, with the plans that ran in it. */
export interface HistoryRow {
    readonly interval: QueryStoreInterval;
    /** The plans that ran in the interval, the most executions first. */
    readonly plans: readonly QueryStorePlanIntervalStats[];
}

/** The plans that ran in the intervals, by plan ID. */
export function planIdsOf(intervals: readonly QueryStoreInterval[]): string[] {
    const ids = new Set(intervals.flatMap((interval) => interval.plans.map((plan) => plan.planId)));
    return [...ids].sort((left, right) => Number(left) - Number(right));
}

/** The rows of the history, the oldest first: each interval's plans, the most executions first. */
export function historyRows(intervals: readonly QueryStoreInterval[]): HistoryRow[] {
    return intervals.map((interval) => ({
        interval,
        plans: interval.plans
            .filter((plan) => plan.executionCount > 0)
            .sort(
                (left, right) =>
                    right.executionCount - left.executionCount ||
                    Number(left.planId) - Number(right.planId),
            ),
    }));
}

/**
 * The band of the plan that ran most in each interval. Next intervals with the same plan are one
 * segment, so a change of plan shows as a change of color; an interval without runs is empty.
 */
export function planBand(
    rows: readonly HistoryRow[],
    planIds: readonly string[],
    colorOf: (planId: string) => string,
): TimeBand | undefined {
    const text = loc.performanceDashboard;
    const runs: { planId: string; start: Date; end: Date }[] = [];
    for (const { interval, plans } of rows) {
        const planId = plans[0]?.planId;
        if (planId === undefined) {
            continue;
        }
        const start = new Date(interval.startUtc);
        const end = new Date(interval.endUtc);
        const last = runs[runs.length - 1];
        if (last && last.planId === planId && last.end.getTime() === start.getTime()) {
            last.end = end;
        } else {
            runs.push({ planId, start, end });
        }
    }
    if (runs.length === 0) {
        return undefined;
    }
    const shown = new Set(runs.map((run) => run.planId));
    const legendIds = [
        ...planIds.filter((planId) => shown.has(planId)),
        ...[...shown].filter((planId) => !planIds.includes(planId)),
    ];
    return {
        label: text.plan,
        description: text.planBandDescription,
        segments: runs.map((run) => ({
            start: run.start,
            end: run.end,
            color: colorOf(run.planId),
            title: text.planRanMost(
                run.planId,
                dateTimeFormat.format(run.start),
                dateTimeFormat.format(run.end),
            ),
        })),
        legend: legendIds.map((planId) => ({
            label: text.planLegend(planId),
            color: colorOf(planId),
        })),
    };
}
