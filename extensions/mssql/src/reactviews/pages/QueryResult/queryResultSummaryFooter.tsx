/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Tooltip, makeStyles } from "@fluentui/react-components";
import { Fragment, useContext, useEffect, useMemo, useState } from "react";
import { ExecuteCommandRequest } from "../../../sharedInterfaces/webview";
import * as qr from "../../../sharedInterfaces/queryResult";
import { locConstants } from "../../common/locConstants";
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
        textTransform: "uppercase",
        letterSpacing: "0.08em",
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
        color: "var(--vscode-terminal-ansiBlue)",
    },
    timeAccent: {
        color: "var(--vscode-terminal-ansiYellow)",
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
        color: "var(--vscode-textLink-foreground)",
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
        color: "var(--vscode-terminal-ansiBlue)",
    },
    selectionTooltipMetricValue: {
        justifySelf: "end",
        textAlign: "right",
        fontVariantNumeric: "tabular-nums",
        fontFeatureSettings: '"tnum"',
    },
    cancelled: {
        color: "var(--vscode-errorForeground)",
    },
});

function getFirstResultSetRowCount(
    summaries: Record<number, Record<number, qr.ResultSetSummary>>,
): number | undefined {
    for (const batch of Object.values(summaries ?? {})) {
        for (const result of Object.values(batch ?? {})) {
            if (typeof result?.rowCount === "number") {
                return result.rowCount;
            }
        }
    }
    return undefined;
}

function getActiveResultSetRowCount(
    summaries: Record<number, Record<number, qr.ResultSetSummary>>,
    selectionSummary?: qr.SelectionSummary,
): number | undefined {
    if (
        selectionSummary?.batchId !== undefined &&
        selectionSummary?.resultId !== undefined &&
        typeof summaries?.[selectionSummary.batchId]?.[selectionSummary.resultId]?.rowCount ===
            "number"
    ) {
        return summaries[selectionSummary.batchId][selectionSummary.resultId].rowCount;
    }

    return getFirstResultSetRowCount(summaries);
}

function getRowsAffectedFromMessages(messages: qr.IMessage[]): number | undefined {
    const rowsAffectedRegex = /\(?\s*(\d+)\s+rows?\s+affected\s*\)?/i;
    for (let i = messages.length - 1; i >= 0; i--) {
        const text = messages[i]?.message;
        if (!text) {
            continue;
        }
        const match = text.match(rowsAffectedRegex);
        if (match && match[1] !== undefined) {
            const parsed = Number(match[1]);
            if (!Number.isNaN(parsed)) {
                return parsed;
            }
        }
    }
    return undefined;
}

function getLatestExecutionTimeMessage(messages: qr.IMessage[]): string | undefined {
    const prefix = locConstants.queryResult.totalExecutionTimePrefix;
    for (let i = messages.length - 1; i >= 0; i--) {
        const text = messages[i]?.message;
        if (!text) {
            continue;
        }
        if (text.startsWith(prefix) || /execution\s+time/i.test(text)) {
            return text;
        }
    }
    return undefined;
}

function hasCancellationMessage(messages: qr.IMessage[]): boolean {
    return messages.some((message) => /cancel(?:ed|led|ing)?/i.test(message?.message ?? ""));
}

function normalizeStatusText(text?: string): string {
    if (!text) {
        return "";
    }
    return text.replace(/\$\([^)]+\)\s*/g, "").trim();
}

function normalizeExecutionText(text: string): string {
    return text.replace(locConstants.queryResult.totalExecutionTimePrefix, "").trim();
}

function parseTimeStringToMilliseconds(value: string): number | undefined {
    const match = value.match(/(\d+):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/);
    if (!match) {
        return undefined;
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const milliseconds = Number((match[4] ?? "0").padEnd(3, "0").slice(0, 3));

    if ([hours, minutes, seconds, milliseconds].some((num) => Number.isNaN(num))) {
        return undefined;
    }

    return hours * 3600000 + minutes * 60000 + seconds * 1000 + milliseconds;
}

function formatMillisecondsCompact(milliseconds: number): string {
    if (milliseconds < 1000) {
        return `${milliseconds}ms`;
    }

    if (milliseconds < 60000) {
        const seconds = milliseconds / 1000;
        return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
    }

    if (milliseconds < 3600000) {
        const minutes = Math.floor(milliseconds / 60000);
        const seconds = Math.round((milliseconds % 60000) / 1000);
        if (seconds === 0) {
            return `${minutes}m`;
        }
        if (seconds === 60) {
            return `${minutes + 1}m`;
        }
        return `${minutes}m ${seconds}s`;
    }

    const hours = Math.floor(milliseconds / 3600000);
    const minutes = Math.round((milliseconds % 3600000) / 60000);
    if (minutes === 0) {
        return `${hours}h`;
    }
    if (minutes === 60) {
        return `${hours + 1}h`;
    }
    return `${hours}h ${minutes}m`;
}

function formatExecutionTextCompact(text: string): string {
    const normalized = normalizeExecutionText(text);
    const timeMatch = normalized.match(/\d+:\d{2}:\d{2}(?:\.\d{1,3})?/);
    if (!timeMatch) {
        return normalized;
    }

    const totalMilliseconds = parseTimeStringToMilliseconds(timeMatch[0]);
    if (totalMilliseconds === undefined) {
        return normalized;
    }

    return normalized.replace(timeMatch[0], formatMillisecondsCompact(totalMilliseconds));
}

function formatRunningTimeCompact(milliseconds: number): string {
    if (milliseconds < 1000) {
        return locConstants.queryResult.runningLabel;
    }

    if (milliseconds < 60000) {
        return `${Math.floor(milliseconds / 1000)}s`;
    }

    if (milliseconds < 3600000) {
        const minutes = Math.floor(milliseconds / 60000);
        const seconds = Math.floor((milliseconds % 60000) / 1000);
        return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
    }

    const hours = Math.floor(milliseconds / 3600000);
    const minutes = Math.floor((milliseconds % 3600000) / 60000);
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
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
    const messages = useQueryResultSelector((state) => state.messages);
    const selectionSummary = useQueryResultSelector((state) => state.selectionSummary);
    const tabStates = useQueryResultSelector((state) => state.tabStates);
    const isExecuting = useQueryResultSelector((state) => state.isExecuting ?? false);
    const executionStartTime = useQueryResultSelector((state) => state.executionStartTime);
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

    const rowsAffectedCount = useMemo(() => {
        const activeResultRowCount = getActiveResultSetRowCount(
            resultSetSummaries,
            selectionSummary,
        );
        if (typeof activeResultRowCount === "number") {
            return activeResultRowCount;
        }
        return getRowsAffectedFromMessages(messages);
    }, [messages, resultSetSummaries, selectionSummary]);

    const rowsText =
        typeof rowsAffectedCount === "number"
            ? rowsAffectedCount > 0
                ? locConstants.queryResult.rowsAffected(rowsAffectedCount)
                : locConstants.queryResult.noRowsAffected
            : locConstants.queryResult.noRowsAffected;

    const executionTimeText = getLatestExecutionTimeMessage(messages);
    const cancelled = hasCancellationMessage(messages);

    const executionText = cancelled
        ? executionTimeText
            ? `${locConstants.queryResult.executionCancelled} - ${executionTimeText}`
            : locConstants.queryResult.executionCancelled
        : (executionTimeText ?? locConstants.queryResult.executionTimeUnavailable);
    const liveExecutionMilliseconds =
        isExecuting && executionStartTime
            ? Math.max(0, tickTimestamp - executionStartTime)
            : undefined;
    const compactExecutionText =
        liveExecutionMilliseconds !== undefined
            ? formatRunningTimeCompact(liveExecutionMilliseconds)
            : formatExecutionTextCompact(executionText);
    const executionTooltipText =
        liveExecutionMilliseconds !== undefined
            ? compactExecutionText === locConstants.queryResult.runningLabel
                ? locConstants.queryResult.runningLabel
                : `${locConstants.queryResult.runningLabel}: ${compactExecutionText}`
            : executionText;
    const selectionStats = selectionSummary?.stats;
    const selectionCommand = selectionSummary?.command;
    const selectionStatusText = normalizeStatusText(selectionSummary?.text);
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
    const compactRowsText =
        typeof rowsAffectedCount === "number" ? rowsAffectedCount.toLocaleString() : "0";
    const isTextResultsView =
        tabStates?.resultPaneTab === qr.QueryResultPaneTabs.Results &&
        tabStates?.resultViewMode === qr.QueryResultViewMode.Text;
    const isMessagesPane = tabStates?.resultPaneTab === qr.QueryResultPaneTabs.Messages;

    if (isTextResultsView || isMessagesPane) {
        return <Fragment />;
    }

    return (
        <div className={classes.footer}>
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
                    <span className={classes.divider}>|</span>
                    <div className={classes.metric}>
                        <span className={classes.label}>{locConstants.queryResult.timeLabel}</span>
                        <Tooltip
                            withArrow
                            relationship="description"
                            content={executionTooltipText}>
                            <span
                                className={`${classes.value} ${classes.timeAccent} ${cancelled ? classes.cancelled : ""}`}>
                                {compactExecutionText}
                            </span>
                        </Tooltip>
                    </div>
                </div>
            )}
            <div className={classes.spacer} />
            <div className={classes.selectionSegment}>
                <span className={classes.divider}>|</span>
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
