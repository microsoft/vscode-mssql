/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Tooltip, makeStyles } from "@fluentui/react-components";
import { Fragment, useContext, useEffect, useMemo, useState } from "react";
import { ExecuteCommandRequest } from "../../../sharedInterfaces/webview";
import * as qr from "../../../sharedInterfaces/queryResult";
import { locConstants } from "../../common/locConstants";
import { getDisplayedRowsCount } from "./queryResultUtils";
import { useQueryResultSelector } from "./queryResultSelector";
import { QueryResultCommandsContext } from "./queryResultStateProvider";

const useStyles = makeStyles({
    footer: {
        position: "sticky",
        bottom: 0,
        zIndex: 3,
        width: "100%",
        minHeight: "26px",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "3px 10px",
        borderTop: "1px solid var(--vscode-editorWidget-border)",
        backgroundColor: "var(--vscode-sideBar-background)",
    },
    metricsGroup: {
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        gap: "8px",
    },
    metric: {
        minWidth: 0,
        display: "flex",
        alignItems: "baseline",
        gap: "6px",
    },
    spacer: {
        minWidth: 0,
        flex: "1 1 auto",
    },
    label: {
        flexShrink: 0,
        fontSize: "10px",
        color: "var(--vscode-descriptionForeground)",
    },
    value: {
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: "11px",
        color: "var(--vscode-foreground)",
        fontWeight: 600,
    },
    divider: {
        color: "var(--vscode-editorWidget-border)",
        flexShrink: 0,
    },
    rowsAccent: {
        color: "var(--vscode-foreground)",
    },
    timeAccent: {
        color: "var(--vscode-foreground)",
    },
    selectionSegment: {
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: "8px",
        color: "var(--vscode-descriptionForeground)",
    },
    selectionValue: {
        minWidth: 0,
        maxWidth: "42vw",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: "11px",
        color: "var(--vscode-foreground)",
        fontWeight: 600,
    },
    selectionValueButton: {
        minWidth: 0,
        maxWidth: "42vw",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        textAlign: "left",
        border: "none",
        background: "none",
        padding: 0,
        margin: 0,
        color: "var(--vscode-foreground)",
        cursor: "pointer",
        fontSize: "11px",
        fontWeight: 600,
    },
    selectionTooltipText: {
        whiteSpace: "pre-line",
    },
    selectionTooltipMetrics: {
        minWidth: "180px",
        display: "grid",
        rowGap: "6px",
    },
    selectionTooltipMetricRow: {
        display: "grid",
        gridTemplateColumns: "max-content minmax(0, 1fr)",
        columnGap: "12px",
        alignItems: "baseline",
    },
    selectionMetricLabel: {
        color: "var(--vscode-descriptionForeground)",
    },
    selectionMetricValue: {
        color: "var(--vscode-foreground)",
    },
    selectionTooltipMetricValue: {
        justifySelf: "end",
        textAlign: "right",
        fontVariantNumeric: "tabular-nums",
        fontFeatureSettings: '"tnum"',
    },
    cancelled: {
        color: "var(--vscode-foreground)",
    },
});

function formatMillisecondsCompact(milliseconds: number): string {
    if (milliseconds < 1000) {
        return locConstants.queryResult.compactMilliseconds(milliseconds);
    }

    if (milliseconds < 60000) {
        const seconds = milliseconds / 1000;
        return locConstants.queryResult.compactSeconds(
            seconds < 10 ? seconds.toFixed(1) : Math.round(seconds),
        );
    }

    if (milliseconds < 3600000) {
        const minutes = Math.floor(milliseconds / 60000);
        const seconds = Math.round((milliseconds % 60000) / 1000);
        if (seconds === 0) {
            return locConstants.queryResult.compactMinutes(minutes);
        }
        if (seconds === 60) {
            return locConstants.queryResult.compactMinutes(minutes + 1);
        }
        return locConstants.queryResult.compactMinutesSeconds(minutes, seconds);
    }

    const hours = Math.floor(milliseconds / 3600000);
    const minutes = Math.round((milliseconds % 3600000) / 60000);
    if (minutes === 0) {
        return locConstants.queryResult.compactHours(hours);
    }
    if (minutes === 60) {
        return locConstants.queryResult.compactHours(hours + 1);
    }
    return locConstants.queryResult.compactHoursMinutes(hours, minutes);
}

function formatRunningTimeCompact(milliseconds: number): string {
    if (milliseconds < 1000) {
        return locConstants.queryResult.runningLabel;
    }

    if (milliseconds < 60000) {
        return locConstants.queryResult.compactSeconds(Math.floor(milliseconds / 1000));
    }

    if (milliseconds < 3600000) {
        const minutes = Math.floor(milliseconds / 60000);
        const seconds = Math.floor((milliseconds % 60000) / 1000);
        return seconds > 0
            ? locConstants.queryResult.compactMinutesSeconds(minutes, seconds)
            : locConstants.queryResult.compactMinutes(minutes);
    }

    const hours = Math.floor(milliseconds / 3600000);
    const minutes = Math.floor((milliseconds % 3600000) / 60000);
    return minutes > 0
        ? locConstants.queryResult.compactHoursMinutes(hours, minutes)
        : locConstants.queryResult.compactHours(hours);
}

type SelectionMetricKey = keyof qr.SelectionSummaryMetrics;

const INLINE_NUMERIC_METRIC_ORDER: readonly SelectionMetricKey[] = ["count", "average", "sum"];
const INLINE_NON_NUMERIC_METRIC_ORDER: readonly SelectionMetricKey[] = [
    "count",
    "distinctCount",
    "nullCount",
];
const TOOLTIP_NUMERIC_METRIC_ORDER: readonly SelectionMetricKey[] = [
    "count",
    "average",
    "sum",
    "min",
    "max",
    "distinctCount",
    "nullCount",
];
const TOOLTIP_NON_NUMERIC_METRIC_ORDER: readonly SelectionMetricKey[] = [
    "count",
    "distinctCount",
    "nullCount",
];

const SELECTION_TOOLTIP_POSITIONING = {
    position: "above",
    align: "end",
    strategy: "fixed",
    overflowBoundary: "window",
    flipBoundary: "window",
} as const;

function isNumericSelectionSummary(stats: qr.SelectionSummaryMetrics): boolean {
    return typeof stats.average === "number";
}

function getSelectionMetricLabel(metric: SelectionMetricKey): string {
    switch (metric) {
        case "count":
            return locConstants.queryResult.selectionSummaryCountLabel;
        case "average":
            return locConstants.queryResult.selectionSummaryAverageLabel;
        case "sum":
            return locConstants.queryResult.selectionSummarySumLabel;
        case "min":
            return locConstants.queryResult.selectionSummaryMinLabel;
        case "max":
            return locConstants.queryResult.selectionSummaryMaxLabel;
        case "distinctCount":
            return locConstants.queryResult.selectionSummaryDistinctLabel;
        case "nullCount":
            return locConstants.queryResult.selectionSummaryNullLabel;
    }
}

function formatSelectionMetricValue(metric: SelectionMetricKey, value: number): string {
    if (metric === "average") {
        return value.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }

    if (Number.isInteger(value)) {
        return value.toLocaleString();
    }

    return value.toLocaleString(undefined, {
        maximumFractionDigits: 20,
    });
}

function getSelectionMetrics(
    stats: qr.SelectionSummaryMetrics,
    order: readonly SelectionMetricKey[],
): Array<{ label: string; value: string }> {
    return order.flatMap((metric) => {
        const value = stats[metric];
        if (typeof value !== "number") {
            return [];
        }
        if (metric === "nullCount" && value === 0) {
            return [];
        }

        return [
            {
                label: getSelectionMetricLabel(metric),
                value: formatSelectionMetricValue(metric, value),
            },
        ];
    });
}

function renderSelectionMetricsInline(
    stats: qr.SelectionSummaryMetrics,
    classes: Record<string, string>,
) {
    const metrics = getSelectionMetrics(
        stats,
        isNumericSelectionSummary(stats)
            ? INLINE_NUMERIC_METRIC_ORDER
            : INLINE_NON_NUMERIC_METRIC_ORDER,
    );

    return (
        <span>
            {metrics.map((metric, index) => (
                <Fragment key={`${metric.label}-${index}`}>
                    {index > 0 ? " \u00b7 " : ""}
                    <span className={classes.selectionMetricLabel}>{metric.label}:</span>{" "}
                    <span className={classes.selectionMetricValue}>{metric.value}</span>
                </Fragment>
            ))}
        </span>
    );
}

function renderSelectionMetricsTooltip(
    stats: qr.SelectionSummaryMetrics,
    classes: Record<string, string>,
) {
    const metrics = getSelectionMetrics(
        stats,
        isNumericSelectionSummary(stats)
            ? TOOLTIP_NUMERIC_METRIC_ORDER
            : TOOLTIP_NON_NUMERIC_METRIC_ORDER,
    );

    return (
        <div className={classes.selectionTooltipMetrics}>
            {metrics.map((metric) => (
                <div className={classes.selectionTooltipMetricRow} key={`${metric.label}-tooltip`}>
                    <span className={classes.selectionMetricLabel}>{metric.label}:</span>
                    <span
                        className={`${classes.selectionMetricValue} ${classes.selectionTooltipMetricValue}`}>
                        {metric.value}
                    </span>
                </div>
            ))}
        </div>
    );
}

export interface QueryResultSummaryFooterProps {
    hideMetrics?: boolean;
}

export const QueryResultSummaryFooter = ({
    hideMetrics = false,
}: QueryResultSummaryFooterProps) => {
    const classes = useStyles();
    const context = useContext(QueryResultCommandsContext);
    const resultSetSummaries = useQueryResultSelector((state) => state.resultSetSummaries);
    const rowsAffected = useQueryResultSelector((state) => state.rowsAffected);
    const selectionSummary = useQueryResultSelector((state) => state.selectionSummary);
    const tabStates = useQueryResultSelector((state) => state.tabStates);
    const isExecuting = useQueryResultSelector((state) => state.isExecuting ?? false);
    const executionStartTime = useQueryResultSelector((state) => state.executionStartTime);
    const executionElapsedMilliseconds = useQueryResultSelector(
        (state) => state.executionElapsedMilliseconds,
    );
    const [tickTimestamp, setTickTimestamp] = useState<number>(Date.now());

    useEffect(() => {
        if (!isExecuting || !executionStartTime) {
            return;
        }

        setTickTimestamp(Date.now());
        const timer = window.setInterval(() => {
            setTickTimestamp(Date.now());
        }, 1000);

        return () => {
            window.clearInterval(timer);
        };
    }, [isExecuting, executionStartTime]);

    const displayedResultRowsCount = useMemo(() => {
        return getDisplayedRowsCount(resultSetSummaries, selectionSummary, undefined);
    }, [resultSetSummaries, selectionSummary]);
    const rowsCount =
        typeof displayedResultRowsCount === "number" ? displayedResultRowsCount : rowsAffected;

    const rowsText =
        typeof rowsCount === "number"
            ? typeof displayedResultRowsCount === "number"
                ? locConstants.queryResult.rowsReturned(rowsCount)
                : locConstants.queryResult.rowsAffected(rowsCount)
            : locConstants.queryResult.rowsCount(0);
    const liveExecutionMilliseconds =
        isExecuting && executionStartTime
            ? Math.max(0, tickTimestamp - executionStartTime)
            : undefined;
    const compactExecutionText =
        liveExecutionMilliseconds !== undefined
            ? formatRunningTimeCompact(liveExecutionMilliseconds)
            : executionElapsedMilliseconds !== undefined
              ? formatMillisecondsCompact(executionElapsedMilliseconds)
              : locConstants.queryResult.executionTimeUnavailable;
    const executionTooltipText =
        liveExecutionMilliseconds !== undefined
            ? compactExecutionText === locConstants.queryResult.runningLabel
                ? locConstants.queryResult.runningLabel
                : locConstants.queryResult.runningWithDuration(compactExecutionText)
            : compactExecutionText;
    const selectionStats = selectionSummary?.stats;
    const selectionCommand = selectionSummary?.command;
    const selectionStatusText = selectionSummary?.displayText ?? selectionSummary?.text ?? "";
    const selectionDisplayContent = selectionStats
        ? renderSelectionMetricsInline(selectionStats, classes)
        : (selectionStatusText ?? "") || locConstants.queryResult.noSelectionSummary;
    const selectionTooltipContent = selectionStats ? (
        renderSelectionMetricsTooltip(selectionStats, classes)
    ) : (
        <span className={classes.selectionTooltipText}>
            {selectionSummary?.tooltip ||
                selectionStatusText ||
                locConstants.queryResult.noSelectionSummary}
        </span>
    );
    const compactRowsText = typeof rowsCount === "number" ? rowsCount.toLocaleString() : "0";
    const isTextResultsView =
        tabStates?.resultPaneTab === qr.QueryResultPaneTabs.Results &&
        tabStates?.resultViewMode === qr.QueryResultViewMode.Text;

    if (isTextResultsView) {
        return <Fragment />;
    }

    return (
        <div className={classes.footer} role="status" aria-live={isExecuting ? "off" : "polite"}>
            {!hideMetrics && (
                <div className={classes.metricsGroup}>
                    <div className={classes.metric}>
                        <span className={classes.label}>
                            {locConstants.queryResult.rowsAffectedLabel}
                        </span>
                        <Tooltip withArrow relationship="description" content={rowsText}>
                            <span className={`${classes.value} ${classes.rowsAccent}`}>
                                {compactRowsText}
                            </span>
                        </Tooltip>
                    </div>
                    <span className={classes.divider} aria-hidden="true">
                        |
                    </span>
                    <div className={classes.metric}>
                        <span className={classes.label}>{locConstants.queryResult.timeLabel}</span>
                        <Tooltip
                            withArrow
                            relationship="description"
                            content={executionTooltipText}>
                            <span className={`${classes.value} ${classes.timeAccent}`}>
                                {compactExecutionText}
                            </span>
                        </Tooltip>
                    </div>
                </div>
            )}
            <div className={classes.spacer} />
            <div className={classes.selectionSegment}>
                <span className={classes.divider} aria-hidden="true">
                    |
                </span>
                <Tooltip
                    withArrow
                    relationship="description"
                    positioning={SELECTION_TOOLTIP_POSITIONING}
                    content={selectionTooltipContent}>
                    {selectionCommand?.command ? (
                        <button
                            type="button"
                            className={classes.selectionValueButton}
                            onClick={async () => {
                                await context?.extensionRpc.sendRequest(
                                    ExecuteCommandRequest.type,
                                    {
                                        command: selectionCommand.command,
                                        args: selectionCommand.arguments,
                                    },
                                );
                            }}>
                            {selectionDisplayContent}
                        </button>
                    ) : (
                        <span className={classes.selectionValue}>{selectionDisplayContent}</span>
                    )}
                </Tooltip>
            </div>
        </div>
    );
};
