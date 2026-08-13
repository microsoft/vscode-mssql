/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSX } from "react";
import { Badge, Card, CardHeader, ProgressBar, Text } from "@fluentui/react-components";
import { DashboardSnapshot } from "../../../../sharedInterfaces/serverDashboard";
import {
    formatMetricValue,
    getDashboardLoc,
    getHealthLabel,
    getMetricLabel,
    getPlatformLabel,
} from "../dashboardLabels";
import { MetricCard } from "../components/metricCard";
import { OperationalOverview } from "../components/operationalOverview";
import { Sparkline } from "../components/sparkline";

export interface OverviewTabProps {
    snapshot: DashboardSnapshot;
}

export function OverviewTab({ snapshot }: OverviewTabProps): JSX.Element {
    const dashboardLoc = getDashboardLoc();
    const primaryMetric = snapshot.metrics[0];
    const storageRatio = snapshot.server.storageUsedGb / snapshot.server.storageMaxGb;
    const overallHealth = snapshot.metrics.some((metric) => metric.status === "critical")
        ? "critical"
        : snapshot.metrics.some((metric) => metric.status === "warning")
          ? "warning"
          : "healthy";
    const healthColor =
        overallHealth === "critical"
            ? "danger"
            : overallHealth === "warning"
              ? "warning"
              : "success";

    return (
        <div className="dashboard-tab-content">
            <section aria-labelledby="dashboard-summary-heading">
                <div className="dashboard-section-heading">
                    <div>
                        <Text as="h2" id="dashboard-summary-heading" size={500} weight="semibold">
                            {dashboardLoc.performanceSummary}
                        </Text>
                        <Text className="dashboard-secondary-text">
                            {dashboardLoc.currentHealthAndUtilization}
                        </Text>
                    </div>
                    <Badge appearance="tint" color={healthColor}>
                        {getHealthLabel(overallHealth)}
                    </Badge>
                </div>
                <div className="dashboard-metric-grid">
                    {snapshot.metrics.map((metric) => (
                        <MetricCard key={metric.id} metric={metric} />
                    ))}
                </div>
            </section>

            <div className="dashboard-two-column">
                <Card>
                    <CardHeader
                        header={
                            <Text as="h2" size={500} weight="semibold">
                                {dashboardLoc.activityOverview}
                            </Text>
                        }
                        description={dashboardLoc.metricOverSelectedRange(
                            getMetricLabel(primaryMetric.kind),
                        )}
                    />
                    <div className="dashboard-large-chart-value">
                        <Text size={700} weight="semibold">
                            {formatMetricValue(primaryMetric)}
                        </Text>
                    </div>
                    <Sparkline
                        points={primaryMetric.points}
                        status={primaryMetric.status}
                        ariaLabel={dashboardLoc.metricActivityChart(
                            getMetricLabel(primaryMetric.kind),
                        )}
                        height={150}
                    />
                </Card>

                <Card>
                    <CardHeader
                        header={
                            <Text as="h2" size={500} weight="semibold">
                                {dashboardLoc.resourceDetails}
                            </Text>
                        }
                        description={getPlatformLabel(snapshot.target.platform)}
                    />
                    <dl className="dashboard-details-list">
                        <div>
                            <dt>{dashboardLoc.server}</dt>
                            <dd>{snapshot.target.serverName}</dd>
                        </div>
                        <div>
                            <dt>{dashboardLoc.database}</dt>
                            <dd>{snapshot.target.databaseName}</dd>
                        </div>
                        <div>
                            <dt>{dashboardLoc.engine}</dt>
                            <dd>{snapshot.server.engineVersion}</dd>
                        </div>
                        <div>
                            <dt>{dashboardLoc.edition}</dt>
                            <dd>{snapshot.server.edition}</dd>
                        </div>
                        <div>
                            <dt>{dashboardLoc.serviceTier}</dt>
                            <dd>{snapshot.server.serviceTier}</dd>
                        </div>
                        <div>
                            <dt>{dashboardLoc.compute}</dt>
                            <dd>{snapshot.server.compute}</dd>
                        </div>
                        <div>
                            <dt>{dashboardLoc.region}</dt>
                            <dd>{snapshot.server.region}</dd>
                        </div>
                        <div>
                            <dt>{dashboardLoc.availability}</dt>
                            <dd>{snapshot.server.availability}</dd>
                        </div>
                    </dl>
                    <div className="dashboard-storage-progress">
                        <div className="dashboard-progress-label">
                            <Text>{dashboardLoc.storage}</Text>
                            <Text>
                                {dashboardLoc.storageUsage(
                                    snapshot.server.storageUsedGb,
                                    snapshot.server.storageMaxGb,
                                )}
                            </Text>
                        </div>
                        <ProgressBar
                            value={storageRatio}
                            aria-label={dashboardLoc.storageUtilization}
                        />
                    </div>
                </Card>
            </div>

            <OperationalOverview operations={snapshot.operations} />
        </div>
    );
}
