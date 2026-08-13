/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    Card,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    MessageBarTitle,
    Text,
} from "@fluentui/react-components";
import { CheckmarkCircle20Regular, Timeline20Regular } from "@fluentui/react-icons";
import { type JSX, useState } from "react";
import { DbAgentInvestigation, DbAgentIssue } from "../../../../sharedInterfaces/serverDashboard";
import { getDashboardLoc, getInvestigationEventLabel } from "../dashboardLabels";

export interface InvestigationBannerProps {
    investigation: DbAgentInvestigation;
    issues: DbAgentIssue[];
    onFocusIssue: (issueId: string) => void;
    onForceResolve: (investigationId: string) => void;
}

export function InvestigationBanner({
    investigation,
    issues,
    onFocusIssue,
    onForceResolve,
}: InvestigationBannerProps): JSX.Element {
    const dashboardLoc = getDashboardLoc();
    const [showTimeline, setShowTimeline] = useState(false);
    const relatedIssues = issues.filter((issue) => investigation.issueIds.includes(issue.issueId));

    return (
        <div className="dashboard-investigation-banner">
            <MessageBar intent="warning">
                <MessageBarBody>
                    <MessageBarTitle>{dashboardLoc.activeInvestigation}</MessageBarTitle>
                    {investigation.triggerSummary}
                    <div className="dashboard-investigation-issue-links">
                        {relatedIssues.map((issue) => (
                            <Button
                                key={issue.issueId}
                                appearance="transparent"
                                size="small"
                                onClick={() => onFocusIssue(issue.issueId)}>
                                {issue.title}
                            </Button>
                        ))}
                    </div>
                </MessageBarBody>
                <MessageBarActions>
                    <Button
                        icon={<Timeline20Regular />}
                        onClick={() => setShowTimeline((current) => !current)}>
                        {showTimeline ? dashboardLoc.hideTimeline : dashboardLoc.viewTimeline}
                    </Button>
                    <Button
                        appearance="primary"
                        icon={<CheckmarkCircle20Regular />}
                        onClick={() => onForceResolve(investigation.investigationId)}>
                        {dashboardLoc.forceResolve}
                    </Button>
                </MessageBarActions>
            </MessageBar>
            {showTimeline ? (
                <Card className="dashboard-investigation-details">
                    <InvestigationSummary investigation={investigation} />
                    <InvestigationTimeline investigation={investigation} />
                </Card>
            ) : null}
        </div>
    );
}

export interface InvestigationHistoryProps {
    activeInvestigation?: DbAgentInvestigation;
    investigations: DbAgentInvestigation[];
}

export function InvestigationHistory({
    activeInvestigation,
    investigations,
}: InvestigationHistoryProps): JSX.Element {
    const dashboardLoc = getDashboardLoc();
    const allInvestigations = activeInvestigation
        ? [activeInvestigation, ...investigations]
        : investigations;

    return (
        <section className="dashboard-agent-section">
            <div className="dashboard-section-heading">
                <div>
                    <Text as="h3" size={500} weight="semibold">
                        {dashboardLoc.investigationHistory}
                    </Text>
                    <Text className="dashboard-secondary-text">
                        {dashboardLoc.investigationTimeline}
                    </Text>
                </div>
            </div>
            {allInvestigations.length === 0 ? (
                <Card className="dashboard-empty-state">
                    <Text>{dashboardLoc.noInvestigationHistory}</Text>
                </Card>
            ) : (
                <div className="dashboard-investigation-history">
                    {allInvestigations.map((investigation) => (
                        <Card key={investigation.investigationId}>
                            <InvestigationSummary investigation={investigation} />
                            <InvestigationTimeline investigation={investigation} />
                        </Card>
                    ))}
                </div>
            )}
        </section>
    );
}

function InvestigationSummary({
    investigation,
}: {
    investigation: DbAgentInvestigation;
}): JSX.Element {
    const dashboardLoc = getDashboardLoc();
    return (
        <div className="dashboard-investigation-summary">
            <div>
                <Text weight="semibold">{investigation.triggerSummary}</Text>
                <Text className="dashboard-secondary-text">
                    {dashboardLoc.issueCount(investigation.issueIds.length)}
                </Text>
            </div>
            <div className="dashboard-issue-badges">
                <Badge
                    appearance="tint"
                    color={investigation.status === "resolved" ? "success" : "warning"}>
                    {investigation.status === "resolved"
                        ? dashboardLoc.resolved
                        : dashboardLoc.investigating}
                </Badge>
                <Text className="dashboard-secondary-text">
                    {dashboardLoc.started}: {formatDateTime(investigation.startedAt)}
                </Text>
            </div>
        </div>
    );
}

function InvestigationTimeline({
    investigation,
}: {
    investigation: DbAgentInvestigation;
}): JSX.Element {
    return (
        <ol className="dashboard-investigation-timeline">
            {investigation.events.map((event) => (
                <li key={event.id}>
                    <span className="dashboard-timeline-dot" aria-hidden="true" />
                    <div>
                        <Text weight="semibold">
                            {event.title || getInvestigationEventLabel(event.kind)}
                        </Text>
                        <Text>{event.detail}</Text>
                        <Text className="dashboard-secondary-text">
                            {formatDateTime(event.timestamp)}
                        </Text>
                    </div>
                </li>
            ))}
        </ol>
    );
}

function formatDateTime(timestamp: string): string {
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "short",
        timeStyle: "short",
    }).format(new Date(timestamp));
}
