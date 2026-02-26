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
        color: "var(--vscode-textLink-foreground)",
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
    selectionMetricLabel: {
        color: "var(--vscode-descriptionForeground)",
    },
    selectionMetricValue: {
        color: "var(--vscode-textLink-foreground)",
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

function abbreviateSummaryText(text: string): string {
    if (!text) {
        return "";
    }

    return text
        .replace(/\bDistinct Count\b/gi, "DISTINCT")
        .replace(/\bNull Count\b/gi, "NULL")
        .replace(/\bAverage\b/gi, "AVG")
        .replace(/\bCount\b/gi, "COUNT")
        .replace(/\bSum\b/gi, "SUM")
        .replace(/\bMin\b/gi, "MIN")
        .replace(/\bMax\b/gi, "MAX");
}

const METRIC_ORDER = ["COUNT", "AVG", "SUM", "MIN", "MAX", "DISTINCT", "NULL"] as const;

function isZeroMetricValue(value: string): boolean {
    const normalized = value.replace(/,/g, "").trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed === 0;
}

function parseSelectionMetrics(text: string): Array<{ label: string; value: string }> {
    const metricMap = new Map<string, string>();
    const discoveredOrder: string[] = [];
    const metricRegex = /([A-Z]+):\s*([^:\n]+?)(?=(?:\s{2,}[A-Z]+:)|$|\n)/g;
    let match: RegExpExecArray | null;

    while ((match = metricRegex.exec(text)) !== null) {
        const label = match[1];
        const value = match[2].trim();
        if (!metricMap.has(label)) {
            discoveredOrder.push(label);
        }
        metricMap.set(label, value);
    }

    const orderedKnownMetrics: Array<{ label: string; value: string }> = [];
    for (const label of METRIC_ORDER) {
        const value = metricMap.get(label);
        if (value === undefined) {
            continue;
        }
        if (label === "NULL" && isZeroMetricValue(value)) {
            continue;
        }
        orderedKnownMetrics.push({ label, value });
    }

    const orderedUnknownMetrics = discoveredOrder
        .filter((label) => !METRIC_ORDER.includes(label as (typeof METRIC_ORDER)[number]))
        .map((label) => ({ label, value: metricMap.get(label)! }));

    return [...orderedKnownMetrics, ...orderedUnknownMetrics];
}

function renderSelectionMetricsInline(text: string, classes: Record<string, string>): JSX.Element {
    const metrics = parseSelectionMetrics(text);
    if (metrics.length === 0) {
        return <span>{text}</span>;
    }

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

function renderSelectionMetricsTooltip(text: string, classes: Record<string, string>): JSX.Element {
    const metrics = parseSelectionMetrics(text);
    if (metrics.length === 0) {
        return <span className={classes.selectionTooltipText}>{text}</span>;
    }

    return (
        <span className={classes.selectionTooltipText}>
            {metrics.map((metric, index) => (
                <Fragment key={`${metric.label}-tooltip-${index}`}>
                    {index > 0 ? " \u00b7 " : ""}
                    <span className={classes.selectionMetricLabel}>{metric.label}:</span>{" "}
                    <span className={classes.selectionMetricValue}>{metric.value}</span>
                </Fragment>
            ))}
        </span>
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

    const selectionText = abbreviateSummaryText(normalizeStatusText(selectionSummary?.text));
    const selectionDisplayText = selectionText || locConstants.queryResult.noSelectionSummary;
    const selectionTooltip = abbreviateSummaryText(
        selectionSummary?.tooltip || selectionDisplayText,
    );
    const compactRowsText =
        typeof rowsAffectedCount === "number" ? rowsAffectedCount.toLocaleString() : "0";

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
                    content={renderSelectionMetricsTooltip(selectionTooltip, classes)}>
                    {selectionSummary?.command?.command ? (
                        <button
                            type="button"
                            className={classes.selectionValueButton}
                            onClick={async () => {
                                await context?.extensionRpc.sendRequest(
                                    ExecuteCommandRequest.type,
                                    {
                                        command: selectionSummary.command.command,
                                        args: selectionSummary.command.arguments,
                                    },
                                );
                            }}>
                            {renderSelectionMetricsInline(selectionDisplayText, classes)}
                        </button>
                    ) : (
                        <span className={classes.selectionValue}>
                            {renderSelectionMetricsInline(selectionDisplayText, classes)}
                        </span>
                    )}
                </Tooltip>
            </div>
        </div>
    );
};
