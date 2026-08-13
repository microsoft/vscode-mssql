/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSX, useState } from "react";
import {
    Badge,
    Button,
    Card,
    MessageBar,
    MessageBarBody,
    MessageBarTitle,
    Switch,
    Text,
} from "@fluentui/react-components";
import {
    ChevronDown20Regular,
    ChevronRight20Regular,
    Checkmark20Regular,
} from "@fluentui/react-icons";
import { DbAgentDashboard, DbAgentIssue } from "../../../../sharedInterfaces/serverDashboard";
import {
    getDashboardLoc,
    getHealthLabel,
    getInvestigationEventLabel,
    getIssueRecommendation,
    getIssueSeverityLabel,
    getIssueStatusLabel,
    getIssueSummary,
    getIssueTitle,
} from "../dashboardLabels";

export interface DbAgentTabProps {
    dbAgent: DbAgentDashboard;
    onSetEnabled: (enabled: boolean) => void;
    onAcknowledgeIssue: (issueId: string) => void;
}

export function DbAgentTab({
    dbAgent,
    onSetEnabled,
    onAcknowledgeIssue,
}: DbAgentTabProps): JSX.Element {
    const dashboardLoc = getDashboardLoc();
    const [expandedIssueIds, setExpandedIssueIds] = useState<Set<string>>(new Set());

    if (!dbAgent.enabled) {
        return (
            <div className="dashboard-tab-content dashboard-agent-onboarding">
                <Card>
                    <Text as="h2" size={600} weight="semibold">
                        {dashboardLoc.databaseAgent}
                    </Text>
                    <Text>{dashboardLoc.databaseAgentDescription}</Text>
                    <div>
                        <Button appearance="primary" onClick={() => onSetEnabled(true)}>
                            {dashboardLoc.enableDatabaseAgent}
                        </Button>
                    </div>
                </Card>
            </div>
        );
    }

    const activeIssue =
        dbAgent.activeInvestigation?.status === "active"
            ? dbAgent.issues.find((issue) => issue.issueId === dbAgent.activeInvestigation?.issueId)
            : undefined;

    const toggleIssue = (issueId: string): void => {
        setExpandedIssueIds((current) => {
            const next = new Set(current);
            if (next.has(issueId)) {
                next.delete(issueId);
            } else {
                next.add(issueId);
            }
            return next;
        });
    };

    return (
        <div className="dashboard-tab-content">
            {activeIssue ? (
                <MessageBar intent="warning">
                    <MessageBarBody>
                        <MessageBarTitle>{dashboardLoc.investigationInProgress}</MessageBarTitle>
                        {dashboardLoc.agentInvestigating(getIssueTitle(activeIssue))}
                    </MessageBarBody>
                </MessageBar>
            ) : null}

            <div className="dashboard-agent-header">
                <div>
                    <div className="dashboard-heading-with-badge">
                        <Text as="h2" size={600} weight="semibold">
                            {dashboardLoc.databaseAgent}
                        </Text>
                        <Badge
                            appearance="tint"
                            color={dbAgent.health === "healthy" ? "success" : "warning"}>
                            {getHealthLabel(dbAgent.health)}
                        </Badge>
                    </div>
                    <Text className="dashboard-secondary-text">
                        {dashboardLoc.agentDescription}
                    </Text>
                </div>
                <Switch
                    checked={dbAgent.enabled}
                    label={dashboardLoc.enabled}
                    onChange={(_, data) => onSetEnabled(data.checked)}
                />
            </div>

            <div className="dashboard-summary-grid">
                <Card>
                    <Text className="dashboard-secondary-text">{dashboardLoc.openIssues}</Text>
                    <Text size={700} weight="semibold">
                        {dbAgent.issues.filter((issue) => issue.status !== "resolved").length}
                    </Text>
                </Card>
                <Card>
                    <Text className="dashboard-secondary-text">{dashboardLoc.automationMode}</Text>
                    <Text size={500} weight="semibold">
                        {dbAgent.automationLevel === "approvalRequired"
                            ? dashboardLoc.approvalRequired
                            : dashboardLoc.recommendOnly}
                    </Text>
                </Card>
                <Card>
                    <Text className="dashboard-secondary-text">{dashboardLoc.lastAnalysis}</Text>
                    <Text size={400} weight="semibold">
                        {new Intl.DateTimeFormat(undefined, {
                            hour: "numeric",
                            minute: "2-digit",
                            second: "2-digit",
                        }).format(new Date(dbAgent.lastAnalysisAt))}
                    </Text>
                </Card>
            </div>

            <section aria-labelledby="dbagent-issues-heading">
                <div className="dashboard-section-heading">
                    <div>
                        <Text as="h3" id="dbagent-issues-heading" size={500} weight="semibold">
                            {dashboardLoc.issues}
                        </Text>
                        <Text className="dashboard-secondary-text">
                            {dashboardLoc.issuesDescription}
                        </Text>
                    </div>
                </div>
                <div className="dashboard-issue-list">
                    {dbAgent.issues.map((issue) => (
                        <IssueCard
                            key={issue.issueId}
                            issue={issue}
                            expanded={expandedIssueIds.has(issue.issueId)}
                            onToggle={() => toggleIssue(issue.issueId)}
                            onAcknowledge={() => onAcknowledgeIssue(issue.issueId)}
                        />
                    ))}
                </div>
            </section>

            {dbAgent.activeInvestigation ? (
                <Card>
                    <Text as="h3" size={500} weight="semibold">
                        {dashboardLoc.investigationTimeline}
                    </Text>
                    <ol className="dashboard-investigation-timeline">
                        {dbAgent.activeInvestigation.events.map((event) => (
                            <li key={event.id}>
                                <span className="dashboard-timeline-dot" aria-hidden="true" />
                                <div>
                                    <Text weight="semibold">
                                        {getInvestigationEventLabel(event.kind)}
                                    </Text>
                                    <Text className="dashboard-secondary-text">
                                        {new Intl.DateTimeFormat(undefined, {
                                            hour: "numeric",
                                            minute: "2-digit",
                                            second: "2-digit",
                                        }).format(new Date(event.timestamp))}
                                    </Text>
                                </div>
                            </li>
                        ))}
                    </ol>
                </Card>
            ) : null}
        </div>
    );
}

interface IssueCardProps {
    issue: DbAgentIssue;
    expanded: boolean;
    onToggle: () => void;
    onAcknowledge: () => void;
}

function IssueCard({ issue, expanded, onToggle, onAcknowledge }: IssueCardProps): JSX.Element {
    const dashboardLoc = getDashboardLoc();
    const severityColor =
        issue.severity === "critical"
            ? "danger"
            : issue.severity === "warning"
              ? "warning"
              : "informative";

    return (
        <Card className="dashboard-issue-card">
            <div className="dashboard-issue-header">
                <Button
                    appearance="transparent"
                    icon={expanded ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
                    aria-expanded={expanded}
                    aria-label={
                        expanded
                            ? dashboardLoc.collapseIssue(getIssueTitle(issue))
                            : dashboardLoc.expandIssue(getIssueTitle(issue))
                    }
                    onClick={onToggle}
                />
                <div className="dashboard-issue-title">
                    <Text weight="semibold">{getIssueTitle(issue)}</Text>
                    <Text className="dashboard-secondary-text">{getIssueSummary(issue)}</Text>
                </div>
                <div className="dashboard-issue-badges">
                    <Badge appearance="tint" color={severityColor}>
                        {getIssueSeverityLabel(issue.severity)}
                    </Badge>
                    <Badge appearance="outline">{getIssueStatusLabel(issue.status)}</Badge>
                </div>
            </div>
            {expanded ? (
                <div className="dashboard-issue-expanded">
                    <dl className="dashboard-detail-stats">
                        <div>
                            <dt>{dashboardLoc.observedValue}</dt>
                            <dd>{issue.metricValue}</dd>
                        </div>
                        <div>
                            <dt>{dashboardLoc.database}</dt>
                            <dd>{issue.affectedDatabase}</dd>
                        </div>
                        <div>
                            <dt>{dashboardLoc.detected}</dt>
                            <dd>
                                {new Intl.DateTimeFormat(undefined, {
                                    dateStyle: "short",
                                    timeStyle: "short",
                                }).format(new Date(issue.detectedAt))}
                            </dd>
                        </div>
                    </dl>
                    <div className="dashboard-recommendation">
                        <Text weight="semibold">{dashboardLoc.recommendedAction}</Text>
                        <Text>{getIssueRecommendation(issue)}</Text>
                    </div>
                    {issue.status !== "monitoring" && issue.status !== "resolved" ? (
                        <Button
                            appearance="primary"
                            icon={<Checkmark20Regular />}
                            onClick={onAcknowledge}>
                            {dashboardLoc.acknowledgeAndMonitor}
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </Card>
    );
}
