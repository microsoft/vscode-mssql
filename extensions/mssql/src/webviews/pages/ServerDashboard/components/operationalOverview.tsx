/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
import { type JSX } from "react";
import {
    DashboardBackupStatus,
    DashboardOperationalStatus,
    DashboardOperationalSummary,
} from "../../../../sharedInterfaces/serverDashboard";
import { getDashboardLoc, getHealthLabel } from "../dashboardLabels";

export function OperationalOverview({
    operations,
}: {
    operations: DashboardOperationalSummary;
}): JSX.Element {
    const dashboardLoc = getDashboardLoc();
    const latestBackup = operations.backups[0];
    return (
        <>
            <section aria-labelledby="dashboard-readiness-heading">
                <div className="dashboard-section-heading">
                    <div>
                        <Text as="h2" id="dashboard-readiness-heading" size={500} weight="semibold">
                            {dashboardLoc.resourceReadiness}
                        </Text>
                        <Text className="dashboard-secondary-text">
                            {dashboardLoc.resourceReadinessDescription}
                        </Text>
                    </div>
                </div>
                <div className="dashboard-readiness-grid">
                    {operations.readiness.map((check) => (
                        <Card key={check.id}>
                            <div className={`dashboard-status-indicator ${check.status}`} />
                            <div>
                                <Text weight="semibold">{check.title}</Text>
                                <Text className="dashboard-secondary-text">{check.detail}</Text>
                            </div>
                            <Badge appearance="tint" color={getStatusColor(check.status)}>
                                {getHealthLabel(check.status)}
                            </Badge>
                        </Card>
                    ))}
                </div>
            </section>

            <div className="dashboard-two-column dashboard-operations-two-column">
                <Card>
                    <div className="dashboard-section-heading">
                        <div>
                            <Text as="h2" size={500} weight="semibold">
                                {dashboardLoc.resourceTopology}
                            </Text>
                            <Text className="dashboard-secondary-text">
                                {dashboardLoc.resourceTopologyDescription}
                            </Text>
                        </div>
                    </div>
                    <div className="dashboard-topology">
                        {operations.topology.map((node, index) => (
                            <div key={node.id} className="dashboard-topology-node">
                                <div className={`dashboard-topology-icon ${node.status}`}>
                                    {index + 1}
                                </div>
                                <div>
                                    <div className="dashboard-heading-with-badge">
                                        <Text weight="semibold">{node.name}</Text>
                                        <Badge
                                            appearance="tint"
                                            color={getStatusColor(node.status)}
                                            size="small">
                                            {getHealthLabel(node.status)}
                                        </Badge>
                                    </div>
                                    <Text>{node.role}</Text>
                                    <Text className="dashboard-secondary-text">
                                        {node.location} - {node.detail}
                                    </Text>
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>

                <Card>
                    <Text as="h2" size={500} weight="semibold">
                        {dashboardLoc.networkConfiguration}
                    </Text>
                    <dl className="dashboard-details-list">
                        <div>
                            <dt>{dashboardLoc.connectionPolicy}</dt>
                            <dd>{operations.network.connectionPolicy}</dd>
                        </div>
                        <div>
                            <dt>{dashboardLoc.publicNetworkAccess}</dt>
                            <dd>{operations.network.publicNetworkAccess}</dd>
                        </div>
                        <div>
                            <dt>{dashboardLoc.privateEndpoint}</dt>
                            <dd>{operations.network.privateEndpoint}</dd>
                        </div>
                        <div>
                            <dt>{dashboardLoc.minimumTlsVersion}</dt>
                            <dd>{operations.network.minimumTlsVersion}</dd>
                        </div>
                        <div>
                            <dt>{dashboardLoc.firewallRules}</dt>
                            <dd>{operations.network.firewallRuleCount}</dd>
                        </div>
                    </dl>
                </Card>
            </div>

            <div className="dashboard-two-column dashboard-operations-two-column">
                <Card className="dashboard-table-card">
                    <div className="dashboard-card-heading">
                        <Text as="h2" size={500} weight="semibold">
                            {dashboardLoc.configuration}
                        </Text>
                        <Text className="dashboard-secondary-text">
                            {dashboardLoc.configurationDescription}
                        </Text>
                    </div>
                    <Table aria-label={dashboardLoc.configuration}>
                        <TableHeader>
                            <TableRow>
                                <TableHeaderCell>{dashboardLoc.configuration}</TableHeaderCell>
                                <TableHeaderCell>{dashboardLoc.observedValue}</TableHeaderCell>
                                <TableHeaderCell>{dashboardLoc.source}</TableHeaderCell>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {operations.configuration.map((item) => (
                                <TableRow key={item.id}>
                                    <TableCell>
                                        <Text weight="semibold">{item.name}</Text>
                                    </TableCell>
                                    <TableCell>{item.value}</TableCell>
                                    <TableCell>{item.source}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Card>

                <Card className="dashboard-table-card">
                    <div className="dashboard-card-heading">
                        <Text as="h2" size={500} weight="semibold">
                            {dashboardLoc.backupAndRecovery}
                        </Text>
                    </div>
                    <Table aria-label={dashboardLoc.backupAndRecovery}>
                        <TableHeader>
                            <TableRow>
                                <TableHeaderCell>{dashboardLoc.backupType}</TableHeaderCell>
                                <TableHeaderCell>{dashboardLoc.completed}</TableHeaderCell>
                                <TableHeaderCell>{dashboardLoc.retention}</TableHeaderCell>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {operations.backups.map((backup) => (
                                <TableRow key={backup.id}>
                                    <TableCell>
                                        <div className="dashboard-heading-with-badge">
                                            <Text weight="semibold">
                                                {getBackupTypeLabel(backup)}
                                            </Text>
                                            <Badge
                                                appearance="tint"
                                                color={getStatusColor(backup.status)}
                                                size="small">
                                                {getHealthLabel(backup.status)}
                                            </Badge>
                                        </div>
                                    </TableCell>
                                    <TableCell>{formatDateTime(backup.completedAt)}</TableCell>
                                    <TableCell>{backup.retention}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    {latestBackup ? (
                        <div className="dashboard-recovery-point">
                            <Text className="dashboard-secondary-text">
                                {dashboardLoc.recoverableThrough}
                            </Text>
                            <Text weight="semibold">
                                {formatDateTime(latestBackup.recoverableThrough)}
                            </Text>
                        </div>
                    ) : null}
                </Card>
            </div>

            <section aria-labelledby="dashboard-activity-heading">
                <div className="dashboard-section-heading">
                    <div>
                        <Text as="h2" id="dashboard-activity-heading" size={500} weight="semibold">
                            {dashboardLoc.recentActivity}
                        </Text>
                        <Text className="dashboard-secondary-text">
                            {dashboardLoc.recentActivityDescription}
                        </Text>
                    </div>
                </div>
                <Card className="dashboard-activity-list">
                    {operations.activity.map((event) => (
                        <div key={event.id}>
                            <div className={`dashboard-status-indicator ${event.status}`} />
                            <div>
                                <Text weight="semibold">{event.title}</Text>
                                <Text>{event.detail}</Text>
                            </div>
                            <Text className="dashboard-secondary-text">
                                {formatDateTime(event.timestamp)}
                            </Text>
                        </div>
                    ))}
                </Card>
            </section>
        </>
    );
}

function getStatusColor(status: DashboardOperationalStatus): "success" | "warning" | "danger" {
    return status === "healthy" ? "success" : status === "warning" ? "warning" : "danger";
}

function getBackupTypeLabel(backup: DashboardBackupStatus): string {
    const dashboardLoc = getDashboardLoc();
    switch (backup.backupType) {
        case "full":
            return dashboardLoc.fullBackup;
        case "differential":
            return dashboardLoc.differentialBackup;
        case "log":
            return dashboardLoc.logBackup;
        case "continuous":
            return dashboardLoc.continuousBackup;
    }
}

function formatDateTime(timestamp: string): string {
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "short",
        timeStyle: "short",
    }).format(new Date(timestamp));
}
