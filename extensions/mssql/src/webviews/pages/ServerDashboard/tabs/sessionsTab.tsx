/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSX } from "react";
import {
    Badge,
    Card,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Text,
} from "@fluentui/react-components";
import { DashboardSession } from "../../../../sharedInterfaces/serverDashboard";
import {
    formatDuration,
    formatNumber,
    getDashboardLoc,
    getSessionStatusLabel,
} from "../dashboardLabels";

export interface SessionsTabProps {
    sessions: DashboardSession[];
}

export function SessionsTab({ sessions }: SessionsTabProps): JSX.Element {
    const dashboardLoc = getDashboardLoc();
    const runningCount = sessions.filter((session) => session.status === "running").length;
    const suspendedCount = sessions.filter((session) => session.status === "suspended").length;
    const blockedCount = sessions.filter((session) => session.blockingSessionId).length;

    return (
        <div className="dashboard-tab-content">
            <div className="dashboard-section-heading">
                <div>
                    <Text as="h2" size={500} weight="semibold">
                        {dashboardLoc.sessions}
                    </Text>
                    <Text className="dashboard-secondary-text">
                        {dashboardLoc.currentActivityAndBlocking}
                    </Text>
                </div>
            </div>

            <div className="dashboard-summary-grid">
                <Card>
                    <Text className="dashboard-secondary-text">{dashboardLoc.activeSessions}</Text>
                    <Text size={700} weight="semibold">
                        {sessions.length}
                    </Text>
                </Card>
                <Card>
                    <Text className="dashboard-secondary-text">{dashboardLoc.running}</Text>
                    <Text size={700} weight="semibold">
                        {runningCount}
                    </Text>
                </Card>
                <Card>
                    <Text className="dashboard-secondary-text">{dashboardLoc.suspended}</Text>
                    <Text size={700} weight="semibold">
                        {suspendedCount}
                    </Text>
                </Card>
                <Card>
                    <Text className="dashboard-secondary-text">{dashboardLoc.blocked}</Text>
                    <Text size={700} weight="semibold">
                        {blockedCount}
                    </Text>
                </Card>
            </div>

            <Card className="dashboard-table-card">
                <div className="dashboard-table-scroll">
                    <Table aria-label={dashboardLoc.currentSessions}>
                        <TableHeader>
                            <TableRow>
                                <TableHeaderCell>{dashboardLoc.session}</TableHeaderCell>
                                <TableHeaderCell>{dashboardLoc.login}</TableHeaderCell>
                                <TableHeaderCell>{dashboardLoc.application}</TableHeaderCell>
                                <TableHeaderCell>{dashboardLoc.status}</TableHeaderCell>
                                <TableHeaderCell>{dashboardLoc.cpu}</TableHeaderCell>
                                <TableHeaderCell>{dashboardLoc.elapsed}</TableHeaderCell>
                                <TableHeaderCell>{dashboardLoc.waitOrBlocker}</TableHeaderCell>
                                <TableHeaderCell>{dashboardLoc.currentQuery}</TableHeaderCell>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sessions.map((session) => (
                                <TableRow key={session.sessionId}>
                                    <TableCell>{session.sessionId}</TableCell>
                                    <TableCell>{session.loginName}</TableCell>
                                    <TableCell>{session.applicationName}</TableCell>
                                    <TableCell>
                                        <Badge
                                            appearance="tint"
                                            color={
                                                session.status === "suspended"
                                                    ? "warning"
                                                    : session.status === "running"
                                                      ? "success"
                                                      : "informative"
                                            }>
                                            {getSessionStatusLabel(session.status)}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>{formatDuration(session.cpuMs)}</TableCell>
                                    <TableCell>{formatDuration(session.elapsedTimeMs)}</TableCell>
                                    <TableCell>
                                        {session.blockingSessionId
                                            ? dashboardLoc.blockedBy(session.blockingSessionId)
                                            : session.waitType || dashboardLoc.none}
                                    </TableCell>
                                    <TableCell>
                                        <span
                                            className="dashboard-query-preview"
                                            title={session.queryText}>
                                            {session.queryText}
                                        </span>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </Card>
            <Text className="dashboard-secondary-text">
                {dashboardLoc.sessionsShown(formatNumber(sessions.length))}
            </Text>
        </div>
    );
}
