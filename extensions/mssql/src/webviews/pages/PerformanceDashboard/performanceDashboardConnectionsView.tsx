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
    ChartCard,
    TimeSeriesChart,
    TimeSeriesPoint,
    readData,
} from "./performanceDashboardParts";
import { usePolling, useRefresh } from "./performanceDashboardRefresh";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { metrics, simpleMetricColumn, simpleTextColumn } from "./performanceDashboardMetrics";
import { SimpleGrid, SimpleGridColumn } from "./performanceDashboardSimpleGrid";
import { TableSkeleton } from "./performanceDashboardSkeletons";
import { readStatusMessage } from "./performanceDashboardStatus";

/** The samples that the chart keeps: one hour at one sample each 15 seconds. */
const maxSamples = 240;

const useStyles = makeStyles({
    // Grows to the bottom of the page, so the grid can fill the space left.
    view: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("16px"),
        flex: "1 0 auto",
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
    const sessions = useExtensionRequest(
        GetSessionSummaryRequest.type,
        undefined,
        [databaseName, refreshKey],
        true,
        tick,
    );
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

    // The client of each group of connections: program, host, login, and driver, then the count.
    const columns: SimpleGridColumn<SessionGroup>[] = [
        simpleTextColumn<SessionGroup>(
            "program",
            text.programName,
            (group) => group.programName,
            240,
        ),
        simpleTextColumn<SessionGroup>("host", text.hostName, (group) => group.hostName),
        simpleTextColumn<SessionGroup>("login", text.loginName, (group) => group.loginName),
        simpleTextColumn<SessionGroup>(
            "clientInterface",
            text.clientInterfaceName,
            (group) => group.clientInterfaceName,
            220,
        ),
        simpleMetricColumn<SessionGroup>(metrics.connections, {
            id: "connections",
            value: (group) => group.sessionCount,
        }),
    ];

    return (
        <div className={classes.view}>
            {selfOnly && <StatusBar message={{ intent: "warning", text: text.sessionsSelfOnly }} />}
            <ChartCard
                label={text.userSessionsNow}
                value={summary ? formatNumber(summary.totalSessions) : text.notAvailable}
                figures={[
                    {
                        label: text.running,
                        value: summary ? formatNumber(summary.runningSessions) : text.notAvailable,
                    },
                ]}
                unit={text.userSessions}
                loading={sessions.loading && !summary}>
                <TimeSeriesChart
                    compact
                    title={text.userSessions}
                    points={samples}
                    format={formatNumber}
                />
            </ChartCard>
            <SectionHeader title={text.sessionsByClient}>
                {observedAt && text.observedAt(timeFormat.format(new Date(observedAt)))}
            </SectionHeader>
            {isFirstLoad(sessions) ? (
                <TableSkeleton numberColumns={4} />
            ) : summary && summary.groups.length > 0 ? (
                <SimpleGrid
                    fill
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
