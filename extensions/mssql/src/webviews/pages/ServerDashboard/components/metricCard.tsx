/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSX } from "react";
import { Badge, Card, Text } from "@fluentui/react-components";
import { DashboardMetric } from "../../../../sharedInterfaces/serverDashboard";
import {
    formatMetricValue,
    getDashboardLoc,
    getHealthLabel,
    getMetricLabel,
} from "../dashboardLabels";
import { Sparkline } from "./sparkline";

export interface MetricCardProps {
    metric: DashboardMetric;
}

export function MetricCard({ metric }: MetricCardProps): JSX.Element {
    const dashboardLoc = getDashboardLoc();
    const metricLabel = getMetricLabel(metric.kind);
    const changeLabel =
        metric.changePercent >= 0
            ? dashboardLoc.upFromPreviousPeriod(Math.abs(metric.changePercent))
            : dashboardLoc.downFromPreviousPeriod(Math.abs(metric.changePercent));
    const badgeColor =
        metric.status === "critical"
            ? "danger"
            : metric.status === "warning"
              ? "warning"
              : "success";

    return (
        <Card className="dashboard-metric-card" aria-label={metricLabel}>
            <div className="dashboard-metric-heading">
                <Text weight="semibold">{metricLabel}</Text>
                <Badge appearance="tint" color={badgeColor}>
                    {getHealthLabel(metric.status)}
                </Badge>
            </div>
            <Text size={700} weight="semibold">
                {formatMetricValue(metric)}
            </Text>
            <Text size={200} className="dashboard-secondary-text">
                {changeLabel}
            </Text>
            <Sparkline
                points={metric.points}
                status={metric.status}
                ariaLabel={dashboardLoc.metricTrend(metricLabel)}
            />
        </Card>
    );
}
