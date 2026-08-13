/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSX } from "react";
import {
    Badge,
    Card,
    ProgressBar,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Text,
} from "@fluentui/react-components";
import { DashboardWait } from "../../../../sharedInterfaces/serverDashboard";
import {
    formatDuration,
    formatNumber,
    getDashboardLoc,
    getTrendLabel,
    getWaitCategoryLabel,
} from "../dashboardLabels";

export interface WaitsTabProps {
    waits: DashboardWait[];
}

export function WaitsTab({ waits }: WaitsTabProps): JSX.Element {
    const dashboardLoc = getDashboardLoc();
    const totalWaitTime = waits.reduce((total, wait) => total + wait.waitTimeMs, 0);
    const totalTasks = waits.reduce((total, wait) => total + wait.waitingTasks, 0);

    return (
        <div className="dashboard-tab-content">
            <div className="dashboard-section-heading">
                <div>
                    <Text as="h2" size={500} weight="semibold">
                        {dashboardLoc.waitStatistics}
                    </Text>
                    <Text className="dashboard-secondary-text">
                        {dashboardLoc.waitStatisticsDescription}
                    </Text>
                </div>
            </div>

            <div className="dashboard-summary-grid">
                <Card>
                    <Text className="dashboard-secondary-text">{dashboardLoc.totalWaitTime}</Text>
                    <Text size={700} weight="semibold">
                        {formatDuration(totalWaitTime)}
                    </Text>
                </Card>
                <Card>
                    <Text className="dashboard-secondary-text">{dashboardLoc.waitingTasks}</Text>
                    <Text size={700} weight="semibold">
                        {formatNumber(totalTasks)}
                    </Text>
                </Card>
                <Card>
                    <Text className="dashboard-secondary-text">{dashboardLoc.topWaitType}</Text>
                    <Text size={500} weight="semibold">
                        {waits[0]?.waitType}
                    </Text>
                </Card>
            </div>

            <Card className="dashboard-table-card">
                <div className="dashboard-table-scroll">
                    <Table aria-label={dashboardLoc.waitStatistics}>
                        <TableHeader>
                            <TableRow>
                                <TableHeaderCell>{dashboardLoc.waitType}</TableHeaderCell>
                                <TableHeaderCell>{dashboardLoc.category}</TableHeaderCell>
                                <TableHeaderCell>{dashboardLoc.waitTime}</TableHeaderCell>
                                <TableHeaderCell>{dashboardLoc.share}</TableHeaderCell>
                                <TableHeaderCell>{dashboardLoc.waitingTasks}</TableHeaderCell>
                                <TableHeaderCell>{dashboardLoc.trend}</TableHeaderCell>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {waits.map((wait) => (
                                <TableRow key={wait.waitType}>
                                    <TableCell>
                                        <Text weight="semibold">{wait.waitType}</Text>
                                    </TableCell>
                                    <TableCell>{getWaitCategoryLabel(wait.category)}</TableCell>
                                    <TableCell>{formatDuration(wait.waitTimeMs)}</TableCell>
                                    <TableCell>
                                        <div className="dashboard-wait-share">
                                            <ProgressBar
                                                value={wait.percentage / 100}
                                                aria-label={dashboardLoc.totalWaitShare(
                                                    wait.percentage,
                                                )}
                                            />
                                            <span>{wait.percentage}%</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>{formatNumber(wait.waitingTasks)}</TableCell>
                                    <TableCell>
                                        <Badge
                                            appearance="tint"
                                            color={
                                                wait.trend === "regressing"
                                                    ? "warning"
                                                    : wait.trend === "improving"
                                                      ? "success"
                                                      : "informative"
                                            }>
                                            {getTrendLabel(wait.trend)}
                                        </Badge>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </Card>
        </div>
    );
}
