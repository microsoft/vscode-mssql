/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Caption1, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { useEffect, useState } from "react";
import type { SessionGroup } from "../../../sharedInterfaces/performance";
import { GetSessionSummaryRequest } from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { isFirstLoad, useExtensionRequest } from "../../common/useExtensionRequest";
import { formatNumber, timeFormat } from "./performanceDashboardFormat";
import {
    SectionHeader,
    StatusBar,
    SummaryCard,
    TimeSeriesChart,
    TimeSeriesPoint,
    readData,
} from "./performanceDashboardParts";
import { usePolling, useRefresh } from "./performanceDashboardRefresh";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { SimpleGrid, SimpleGridColumn } from "./performanceDashboardSimpleGrid";
import { TableSkeleton } from "./performanceDashboardSkeletons";
import { readStatusMessage } from "./performanceDashboardStatus";

/** The samples that the chart keeps: one hour at one sample each 15 seconds. */
const maxSamples = 240;

const useStyles = makeStyles({
    view: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("16px"),
    },
    note: {
        color: tokens.colorNeutralForeground3,
    },
});

/**
 * The user sessions of the database now, grouped by login, application, and host. The views
 * keep no history, so the chart shows the counts sampled while the tab is open.
 */
export const PerformanceDashboardConnectionsView = () => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const tick = usePolling();
    const sessions = useExtensionRequest(GetSessionSummaryRequest.type, undefined, [
        databaseName,
        refreshKey,
        tick,
    ]);
    const [samples, setSamples] = useState<TimeSeriesPoint[]>([]);

    useEffect(() => setSamples([]), [databaseName]);

    const summary = readData(sessions);
    const observedAt =
        sessions.result && "observedAtUtc" in sessions.result
            ? sessions.result.observedAtUtc
            : undefined;
    useEffect(() => {
        if (summary && observedAt) {
            setSamples((current) =>
                [...current, { x: new Date(observedAt), y: summary.totalSessions }].slice(
                    -maxSamples,
                ),
            );
        }
        // One sample for each read: a read has a new result object.
    }, [summary, observedAt]);

    const message = readStatusMessage(sessions);
    if (message) {
        return <StatusBar message={message} />;
    }
    const selfOnly = sessions.result?.status === "selfOnly";

    const columns: SimpleGridColumn<SessionGroup>[] = [
        {
            id: "login",
            header: text.login,
            render: (group) => group.loginName ?? "—",
            compare: (left, right) => (left.loginName ?? "").localeCompare(right.loginName ?? ""),
            idealWidth: 180,
        },
        {
            id: "program",
            header: text.application,
            render: (group) => group.programName || "—",
            compare: (left, right) =>
                (left.programName ?? "").localeCompare(right.programName ?? ""),
            idealWidth: 240,
        },
        {
            id: "host",
            header: text.host,
            render: (group) => group.hostName || "—",
            compare: (left, right) => (left.hostName ?? "").localeCompare(right.hostName ?? ""),
            idealWidth: 160,
        },
        {
            id: "sessions",
            header: text.sessions,
            render: (group) => formatNumber(group.sessionCount),
            compare: (left, right) => left.sessionCount - right.sessionCount,
            numeric: true,
        },
        {
            id: "running",
            header: text.running,
            render: (group) => formatNumber(group.runningCount),
            compare: (left, right) => left.runningCount - right.runningCount,
            numeric: true,
        },
        {
            id: "transactions",
            header: text.openTransactions,
            render: (group) => formatNumber(group.openTransactionCount),
            compare: (left, right) => left.openTransactionCount - right.openTransactionCount,
            numeric: true,
        },
    ];

    return (
        <div className={classes.view}>
            {selfOnly && <StatusBar message={{ intent: "warning", text: text.sessionsSelfOnly }} />}
            <SummaryCard
                value={summary ? formatNumber(summary.totalSessions) : text.notAvailable}
                label={text.userSessionsNow}
                loading={sessions.loading && !summary}
                figures={
                    summary
                        ? [{ label: text.running, value: formatNumber(summary.runningSessions) }]
                        : []
                }>
                <TimeSeriesChart title={text.userSessions} points={samples} format={formatNumber} />
            </SummaryCard>
            <Caption1 className={classes.note}>{text.sampledWhileOpen}</Caption1>
            <SectionHeader title={text.sessionsByClient}>
                {observedAt && text.observedAt(timeFormat.format(new Date(observedAt)))}
            </SectionHeader>
            {isFirstLoad(sessions) ? (
                <TableSkeleton numberColumns={4} />
            ) : summary && summary.groups.length > 0 ? (
                <SimpleGrid
                    items={summary.groups}
                    columns={columns}
                    getRowId={(group) =>
                        JSON.stringify([group.loginName, group.programName, group.hostName])
                    }
                    ariaLabel={text.sessionsByClient}
                />
            ) : (
                summary && <Caption1 className={classes.note}>{text.noSessions}</Caption1>
            )}
        </div>
    );
};
