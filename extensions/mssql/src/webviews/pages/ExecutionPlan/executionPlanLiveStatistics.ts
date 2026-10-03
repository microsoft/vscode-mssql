/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecutionPlanNode } from "../../../sharedInterfaces/executionPlan";
import { locConstants } from "../../common/locConstants";

export function formatLiveExecutionPlanDuration(milliseconds: number, locale?: string): string {
    if (milliseconds < 60_000) {
        return locConstants.executionPlan.liveDurationSeconds(
            new Intl.NumberFormat(locale, {
                minimumFractionDigits: 3,
                maximumFractionDigits: 3,
            }).format(milliseconds / 1000),
        );
    }
    const seconds = Math.floor(milliseconds / 1000);
    return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Row ratios can exceed 100% when the optimizer underestimates cardinality. */
export function formatLiveExecutionPlanRows(
    node: ExecutionPlanNode,
    compact: boolean,
    locale?: string,
): string | undefined {
    const stats = node.liveQueryStatistics;
    if (!stats || (stats.actualRows === undefined && stats.estimatedRows === undefined)) {
        return undefined;
    }
    const formatCount = (value: string | number | undefined): string => {
        if (value === undefined) {
            return locConstants.executionPlan.liveStatisticsUnavailable;
        }
        return new Intl.NumberFormat(
            locale,
            compact && Number(value) >= 10_000
                ? { notation: "compact", maximumFractionDigits: 1 }
                : { maximumFractionDigits: 0 },
        ).format(value as Intl.StringNumericLiteral);
    };
    const actual = formatCount(stats.actualRows);
    const estimated = formatCount(stats.estimatedRows);
    const ratio =
        stats.actualRows !== undefined &&
        stats.estimatedRows !== undefined &&
        stats.estimatedRows > 0
            ? Number(stats.actualRows) / stats.estimatedRows
            : undefined;
    if (ratio !== undefined && Number.isFinite(ratio)) {
        const percent = new Intl.NumberFormat(locale, {
            style: "percent",
            maximumFractionDigits: 0,
        }).format(Math.floor(ratio * 100) / 100);
        return locConstants.executionPlan.liveRowsWithPercentage(actual, estimated, percent);
    }
    return locConstants.executionPlan.liveRows(actual, estimated);
}

/** The live counters participate in layout and hit-testing as well as rendering. */
export function getExecutionPlanNodeLabelLines(node: ExecutionPlanNode, locale?: string): string[] {
    const lines = [...node.subtext];
    const elapsed = node.liveQueryStatistics?.elapsedTimeInMs;
    if (elapsed !== undefined) {
        lines.push(
            locConstants.executionPlan.liveElapsedTime(
                formatLiveExecutionPlanDuration(elapsed, locale),
            ),
        );
    }
    const rows = formatLiveExecutionPlanRows(node, true, locale);
    if (rows) {
        lines.push(rows);
    }
    return lines;
}
