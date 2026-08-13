/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Badge,
    Button,
    Card,
    Dropdown,
    Option,
    Tab,
    TabList,
    Text,
} from "@fluentui/react-components";
import {
    Checkmark20Regular,
    ChevronDown20Regular,
    ChevronRight20Regular,
    Dismiss20Regular,
    Play20Regular,
} from "@fluentui/react-icons";
import { type JSX, useEffect, useMemo, useState } from "react";
import {
    DbAgentAnalyzableSection,
    DbAgentIssue,
    DbAgentIssueAction,
    DbAgentIssueCategory,
    DbAgentIssueSeverity,
    DbAgentMetricChart,
} from "../../../../sharedInterfaces/serverDashboard";
import {
    getActionApprovalLabel,
    getActionRiskLabel,
    getDashboardLoc,
    getExecutionVenueLabel,
    getIssueCategoryLabel,
    getIssueSeverityLabel,
    getIssueStatusLabel,
} from "../dashboardLabels";

type IssueBucket = "active" | "resolved" | "closed";
type SeverityFilter = DbAgentIssueSeverity | "all";
type CategoryFilter = DbAgentIssueCategory | "all";

export interface DbAgentIssuesProps {
    issues: DbAgentIssue[];
    focusIssueId?: string;
    onAcknowledge: (issueId: string) => void;
    onDecideAction: (issueId: string, actionId: string, decision: "approve" | "reject") => void;
    onExecuteAction: (issueId: string, actionId: string) => void;
    onMarkActionApplied: (issueId: string, actionId: string) => void;
    onAnalyzeSection: (issueId: string, section: DbAgentAnalyzableSection) => void;
}

export function DbAgentIssues({
    issues,
    focusIssueId,
    onAcknowledge,
    onDecideAction,
    onExecuteAction,
    onMarkActionApplied,
    onAnalyzeSection,
}: DbAgentIssuesProps): JSX.Element {
    const dashboardLoc = getDashboardLoc();
    const [bucket, setBucket] = useState<IssueBucket>("active");
    const [severity, setSeverity] = useState<SeverityFilter>("all");
    const [category, setCategory] = useState<CategoryFilter>("all");
    const [expandedIssueId, setExpandedIssueId] = useState<string | undefined>(focusIssueId);

    useEffect(() => {
        if (!focusIssueId) {
            return;
        }
        setBucket(getIssueBucket(issues.find((issue) => issue.issueId === focusIssueId)));
        setExpandedIssueId(focusIssueId);
    }, [focusIssueId, issues]);

    const bucketCounts = useMemo(
        () => ({
            active: issues.filter((issue) => getIssueBucket(issue) === "active").length,
            resolved: issues.filter((issue) => getIssueBucket(issue) === "resolved").length,
            closed: issues.filter((issue) => getIssueBucket(issue) === "closed").length,
        }),
        [issues],
    );
    const filteredIssues = issues.filter(
        (issue) =>
            getIssueBucket(issue) === bucket &&
            (severity === "all" || issue.severity === severity) &&
            (category === "all" || issue.category === category),
    );

    return (
        <section className="dashboard-agent-section" aria-labelledby="dbagent-issues-heading">
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
            <div className="dashboard-agent-issue-controls">
                <TabList
                    selectedValue={bucket}
                    onTabSelect={(_, data) => setBucket(data.value as IssueBucket)}>
                    <Tab value="active">
                        {dashboardLoc.activeIssues}{" "}
                        <Badge size="small">{bucketCounts.active}</Badge>
                    </Tab>
                    <Tab value="resolved">
                        {dashboardLoc.resolvedIssues}{" "}
                        <Badge size="small">{bucketCounts.resolved}</Badge>
                    </Tab>
                    <Tab value="closed">
                        {dashboardLoc.closedIssues}{" "}
                        <Badge size="small">{bucketCounts.closed}</Badge>
                    </Tab>
                </TabList>
                <div className="dashboard-agent-filters">
                    <Dropdown
                        aria-label={dashboardLoc.filterBySeverity}
                        value={
                            severity === "all"
                                ? dashboardLoc.allSeverities
                                : getIssueSeverityLabel(severity)
                        }
                        selectedOptions={[severity]}
                        onOptionSelect={(_, data) =>
                            setSeverity((data.optionValue as SeverityFilter) ?? "all")
                        }>
                        <Option value="all">{dashboardLoc.allSeverities}</Option>
                        <Option value="critical">{dashboardLoc.critical}</Option>
                        <Option value="warning">{dashboardLoc.warning}</Option>
                        <Option value="watch">{dashboardLoc.watch}</Option>
                    </Dropdown>
                    <Dropdown
                        aria-label={dashboardLoc.filterByCategory}
                        value={
                            category === "all"
                                ? dashboardLoc.allCategories
                                : getIssueCategoryLabel(category)
                        }
                        selectedOptions={[category]}
                        onOptionSelect={(_, data) =>
                            setCategory((data.optionValue as CategoryFilter) ?? "all")
                        }>
                        <Option value="all">{dashboardLoc.allCategories}</Option>
                        <Option value="performance">{dashboardLoc.performance}</Option>
                        <Option value="availability">{dashboardLoc.availabilityCategory}</Option>
                        <Option value="storage">{dashboardLoc.storageCategory}</Option>
                        <Option value="security">{dashboardLoc.security}</Option>
                    </Dropdown>
                </div>
            </div>
            {filteredIssues.length === 0 ? (
                <Card className="dashboard-empty-state">
                    <Text>{dashboardLoc.noIssuesInView}</Text>
                </Card>
            ) : (
                <div className="dashboard-issue-list">
                    {filteredIssues.map((issue) => (
                        <IssueCard
                            key={issue.issueId}
                            issue={issue}
                            expanded={expandedIssueId === issue.issueId}
                            onToggle={() =>
                                setExpandedIssueId((current) =>
                                    current === issue.issueId ? undefined : issue.issueId,
                                )
                            }
                            onAcknowledge={() => onAcknowledge(issue.issueId)}
                            onDecideAction={(actionId, decision) =>
                                onDecideAction(issue.issueId, actionId, decision)
                            }
                            onExecuteAction={(actionId) => onExecuteAction(issue.issueId, actionId)}
                            onMarkActionApplied={(actionId) =>
                                onMarkActionApplied(issue.issueId, actionId)
                            }
                            onAnalyzeSection={(section) => onAnalyzeSection(issue.issueId, section)}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}

interface IssueCardProps {
    issue: DbAgentIssue;
    expanded: boolean;
    onToggle: () => void;
    onAcknowledge: () => void;
    onDecideAction: (actionId: string, decision: "approve" | "reject") => void;
    onExecuteAction: (actionId: string) => void;
    onMarkActionApplied: (actionId: string) => void;
    onAnalyzeSection: (section: DbAgentAnalyzableSection) => void;
}

function IssueCard({
    issue,
    expanded,
    onToggle,
    onAcknowledge,
    onDecideAction,
    onExecuteAction,
    onMarkActionApplied,
    onAnalyzeSection,
}: IssueCardProps): JSX.Element {
    const dashboardLoc = getDashboardLoc();
    const active = getIssueBucket(issue) === "active";

    return (
        <Card className="dashboard-issue-card">
            <div className="dashboard-issue-header">
                <Button
                    appearance="transparent"
                    icon={expanded ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
                    aria-expanded={expanded}
                    aria-label={
                        expanded
                            ? dashboardLoc.collapseIssue(issue.title)
                            : dashboardLoc.expandIssue(issue.title)
                    }
                    onClick={onToggle}
                />
                <button className="dashboard-issue-title-button" type="button" onClick={onToggle}>
                    <span>{issue.title}</span>
                    <small>{issue.summary}</small>
                </button>
                <div className="dashboard-issue-badges">
                    <Badge appearance="tint" color={getSeverityColor(issue.severity)}>
                        {getIssueSeverityLabel(issue.severity)}
                    </Badge>
                    <Badge appearance="outline">{getIssueCategoryLabel(issue.category)}</Badge>
                    <Badge appearance="outline">{getIssueStatusLabel(issue.status)}</Badge>
                    <Text weight="semibold">{issue.metricValue}</Text>
                </div>
            </div>
            {expanded ? (
                <div className="dashboard-issue-expanded">
                    <dl className="dashboard-detail-stats dashboard-agent-issue-metadata">
                        <div>
                            <dt>{dashboardLoc.database}</dt>
                            <dd>{issue.affectedDatabase}</dd>
                        </div>
                        <div>
                            <dt>{dashboardLoc.detected}</dt>
                            <dd>{formatDateTime(issue.detectedAt)}</dd>
                        </div>
                        <div>
                            <dt>{dashboardLoc.updated}</dt>
                            <dd>{formatDateTime(issue.updatedAt)}</dd>
                        </div>
                    </dl>
                    <AnalysisSection
                        title={dashboardLoc.summary}
                        content={issue.summary}
                        note={issue.analysisNotes.summary}
                        onAnalyze={() => onAnalyzeSection("summary")}
                    />
                    <Accordion
                        multiple
                        collapsible
                        defaultOpenItems={["diagnosis", "metrics", "actions"]}>
                        <AccordionItem value="diagnosis">
                            <AccordionHeader>{dashboardLoc.diagnosis}</AccordionHeader>
                            <AccordionPanel>
                                <AnalysisSection
                                    content={issue.diagnosis}
                                    note={issue.analysisNotes.diagnosis}
                                    onAnalyze={() => onAnalyzeSection("diagnosis")}
                                />
                            </AccordionPanel>
                        </AccordionItem>
                        <AccordionItem value="metrics">
                            <AccordionHeader>{dashboardLoc.metricEvidence}</AccordionHeader>
                            <AccordionPanel>
                                <div className="dashboard-agent-metric-grid">
                                    {issue.metricCharts.map((chart) => (
                                        <IssueMetricChart key={chart.id} chart={chart} />
                                    ))}
                                </div>
                                <AnalysisNote
                                    note={issue.analysisNotes.metrics}
                                    onAnalyze={() => onAnalyzeSection("metrics")}
                                />
                            </AccordionPanel>
                        </AccordionItem>
                        <AccordionItem value="actions">
                            <AccordionHeader>{dashboardLoc.recommendedActions}</AccordionHeader>
                            <AccordionPanel>
                                <div className="dashboard-agent-actions">
                                    {issue.recommendedActions.map((action) => (
                                        <ActionCard
                                            key={action.actionId}
                                            action={action}
                                            onDecide={(decision) =>
                                                onDecideAction(action.actionId, decision)
                                            }
                                            onExecute={() => onExecuteAction(action.actionId)}
                                            onMarkApplied={() =>
                                                onMarkActionApplied(action.actionId)
                                            }
                                        />
                                    ))}
                                </div>
                                <AnalysisNote
                                    note={issue.analysisNotes.recommendedAction}
                                    onAnalyze={() => onAnalyzeSection("recommendedAction")}
                                />
                            </AccordionPanel>
                        </AccordionItem>
                        <AccordionItem value="history">
                            <AccordionHeader>{dashboardLoc.eventHistory}</AccordionHeader>
                            <AccordionPanel>
                                <IssueHistory issue={issue} />
                            </AccordionPanel>
                        </AccordionItem>
                    </Accordion>
                    {active &&
                    issue.status !== "monitoring" &&
                    issue.status !== "verifying" &&
                    issue.status !== "executing" ? (
                        <div className="dashboard-agent-primary-action">
                            <Button
                                appearance="primary"
                                icon={<Checkmark20Regular />}
                                onClick={onAcknowledge}>
                                {dashboardLoc.acknowledgeAndMonitor}
                            </Button>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </Card>
    );
}

interface AnalysisSectionProps {
    title?: string;
    content: string;
    note?: string;
    onAnalyze: () => void;
}

function AnalysisSection({ title, content, note, onAnalyze }: AnalysisSectionProps): JSX.Element {
    return (
        <section className="dashboard-agent-analysis-section">
            {title ? (
                <Text as="h4" size={400} weight="semibold">
                    {title}
                </Text>
            ) : null}
            <Text>{content}</Text>
            <AnalysisNote note={note} onAnalyze={onAnalyze} />
        </section>
    );
}

function AnalysisNote({ note, onAnalyze }: { note?: string; onAnalyze: () => void }): JSX.Element {
    const dashboardLoc = getDashboardLoc();
    return note ? (
        <div className="dashboard-agent-copilot-note">
            <Text weight="semibold">{dashboardLoc.copilotAnalysis}</Text>
            <Text>{note}</Text>
        </div>
    ) : (
        <Button appearance="subtle" size="small" onClick={onAnalyze}>
            {dashboardLoc.analyzeWithCopilot}
        </Button>
    );
}

function IssueMetricChart({ chart }: { chart: DbAgentMetricChart }): JSX.Element {
    const dashboardLoc = getDashboardLoc();
    const width = 700;
    const height = 150;
    const allPoints = chart.series.flatMap((series) => series.points);
    const values = allPoints.map((point) => point.value);
    const timestamps = allPoints.map((point) => Date.parse(point.timestamp));
    const minimumValue = Math.min(...values);
    const maximumValue = Math.max(...values);
    const valueRange = Math.max(maximumValue - minimumValue, 1);
    const minimumTime = Math.min(...timestamps);
    const maximumTime = Math.max(...timestamps);
    const timeRange = Math.max(maximumTime - minimumTime, 1);

    const buildPath = (points: DbAgentMetricChart["series"][number]["points"]): string =>
        points
            .map((point, index) => {
                const x = ((Date.parse(point.timestamp) - minimumTime) / timeRange) * width;
                const y = height - ((point.value - minimumValue) / valueRange) * (height - 20) - 10;
                return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
            })
            .join(" ");

    return (
        <Card className="dashboard-agent-metric-card">
            <div className="dashboard-metric-heading">
                <Text weight="semibold">{chart.title}</Text>
                <Text className="dashboard-secondary-text">
                    {chart.series[0]?.points.at(-1)?.value} {chart.series[0]?.unit}
                </Text>
            </div>
            <svg
                viewBox={`0 0 ${width} ${height}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={dashboardLoc.observedAndBaseline(chart.title)}>
                {chart.annotations.map((annotation) => {
                    const x =
                        ((Date.parse(annotation.timestamp) - minimumTime) / timeRange) * width;
                    return (
                        <line
                            key={`${annotation.timestamp}-${annotation.kind}`}
                            x1={x}
                            y1="0"
                            x2={x}
                            y2={height}
                            className={`dashboard-agent-chart-annotation dashboard-agent-chart-annotation-${annotation.kind}`}
                        />
                    );
                })}
                {chart.series.map((series, index) => (
                    <path
                        key={series.id}
                        d={buildPath(series.points)}
                        className={
                            index === 0
                                ? "dashboard-agent-chart-observed"
                                : "dashboard-agent-chart-baseline"
                        }
                    />
                ))}
            </svg>
            <div className="dashboard-agent-chart-legend">
                {chart.series.map((series, index) => (
                    <span key={series.id}>
                        <i className={index === 0 ? "observed" : "baseline"} aria-hidden="true" />
                        {series.label}
                    </span>
                ))}
            </div>
        </Card>
    );
}

interface ActionCardProps {
    action: DbAgentIssueAction;
    onDecide: (decision: "approve" | "reject") => void;
    onExecute: () => void;
    onMarkApplied: () => void;
}

function ActionCard({ action, onDecide, onExecute, onMarkApplied }: ActionCardProps): JSX.Element {
    const dashboardLoc = getDashboardLoc();
    const canDecide = action.approvalStatus === "pending";
    const canExecute = action.approvalStatus === "approved" && action.executionVenue !== "manual";
    const canMarkApplied =
        action.executionVenue === "manual" &&
        (action.approvalStatus === "pending" || action.approvalStatus === "approved");

    return (
        <Card className="dashboard-agent-action-card">
            <div className="dashboard-agent-action-header">
                <div>
                    <Text className="dashboard-secondary-text">
                        {dashboardLoc.stage} {action.stageNumber}
                    </Text>
                    <Text size={400} weight="semibold">
                        {action.title}
                    </Text>
                </div>
                <div className="dashboard-issue-badges">
                    <Badge appearance="tint" color={getRiskColor(action.risk)}>
                        {getActionRiskLabel(action.risk)} {dashboardLoc.risk.toLocaleLowerCase()}
                    </Badge>
                    <Badge appearance="outline">
                        {dashboardLoc.confidence}: {action.confidencePercent}%
                    </Badge>
                    <Badge appearance="outline">
                        {getExecutionVenueLabel(action.executionVenue)}
                    </Badge>
                    <Badge appearance="filled">
                        {getActionApprovalLabel(action.approvalStatus)}
                    </Badge>
                </div>
            </div>
            <dl className="dashboard-agent-action-details">
                <div>
                    <dt>{dashboardLoc.reasoning}</dt>
                    <dd>{action.reasoning}</dd>
                </div>
                <div>
                    <dt>{dashboardLoc.expectedOutcome}</dt>
                    <dd>{action.expectedOutcome}</dd>
                </div>
                <div>
                    <dt>{dashboardLoc.rollbackPlan}</dt>
                    <dd>{action.rollbackPlan}</dd>
                </div>
            </dl>
            <div className="dashboard-agent-parameters">
                <Text weight="semibold">{dashboardLoc.parameters}</Text>
                {Object.entries(action.parameters).map(([name, value]) => (
                    <code key={name}>
                        {name}: {String(value)}
                    </code>
                ))}
            </div>
            {canDecide || canExecute || canMarkApplied ? (
                <div className="dashboard-agent-action-buttons">
                    {canDecide ? (
                        <>
                            <Button
                                appearance="primary"
                                icon={<Checkmark20Regular />}
                                onClick={() => onDecide("approve")}>
                                {dashboardLoc.approve}
                            </Button>
                            <Button icon={<Dismiss20Regular />} onClick={() => onDecide("reject")}>
                                {dashboardLoc.reject}
                            </Button>
                        </>
                    ) : null}
                    {canExecute ? (
                        <Button appearance="primary" icon={<Play20Regular />} onClick={onExecute}>
                            {dashboardLoc.executeAction}
                        </Button>
                    ) : null}
                    {canMarkApplied ? (
                        <Button appearance="primary" onClick={onMarkApplied}>
                            {dashboardLoc.markAsApplied}
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </Card>
    );
}

function IssueHistory({ issue }: { issue: DbAgentIssue }): JSX.Element {
    const dashboardLoc = getDashboardLoc();
    return (
        <div className="dashboard-agent-history-grid">
            <div>
                <Text weight="semibold">{dashboardLoc.eventHistory}</Text>
                <ol className="dashboard-investigation-timeline">
                    {issue.events.map((event) => (
                        <li key={event.eventId}>
                            <span className="dashboard-timeline-dot" aria-hidden="true" />
                            <div>
                                <Text>{event.description}</Text>
                                <Text className="dashboard-secondary-text">
                                    {formatDateTime(event.timestamp)}
                                </Text>
                            </div>
                        </li>
                    ))}
                </ol>
            </div>
            <div>
                <Text weight="semibold">{dashboardLoc.severityHistory}</Text>
                <ol className="dashboard-investigation-timeline">
                    {issue.severityHistory.map((entry) => (
                        <li key={`${entry.timestamp}-${entry.severity}`}>
                            <span className="dashboard-timeline-dot" aria-hidden="true" />
                            <div>
                                <Badge appearance="tint" color={getSeverityColor(entry.severity)}>
                                    {getIssueSeverityLabel(entry.severity)}
                                </Badge>
                                <Text>{entry.reason}</Text>
                                <Text className="dashboard-secondary-text">
                                    {formatDateTime(entry.timestamp)}
                                </Text>
                            </div>
                        </li>
                    ))}
                </ol>
            </div>
            <div>
                <Text weight="semibold">{dashboardLoc.issueRelationships}</Text>
                {issue.blockedByIssueIds.length === 0 && issue.blockingIssueIds.length === 0 ? (
                    <Text className="dashboard-secondary-text">{dashboardLoc.noRelatedIssues}</Text>
                ) : (
                    <dl className="dashboard-agent-relationships">
                        {issue.blockedByIssueIds.length > 0 ? (
                            <div>
                                <dt>{dashboardLoc.blockedByIssues}</dt>
                                <dd>{issue.blockedByIssueIds.join(", ")}</dd>
                            </div>
                        ) : null}
                        {issue.blockingIssueIds.length > 0 ? (
                            <div>
                                <dt>{dashboardLoc.blockingIssues}</dt>
                                <dd>{issue.blockingIssueIds.join(", ")}</dd>
                            </div>
                        ) : null}
                    </dl>
                )}
            </div>
            {issue.actionsTaken.length > 0 ? (
                <div>
                    <Text weight="semibold">{dashboardLoc.actionsTaken}</Text>
                    {issue.actionsTaken.map((action) => (
                        <Card key={`${action.actionId}-${action.executedAt}`}>
                            <Text weight="semibold">{action.title}</Text>
                            <Text>{action.validationResult}</Text>
                            <Text className="dashboard-secondary-text">
                                {action.executedBy} - {formatDateTime(action.executedAt)}
                            </Text>
                        </Card>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function getIssueBucket(issue: DbAgentIssue | undefined): IssueBucket {
    if (issue?.status === "resolved") {
        return "resolved";
    }
    if (issue?.status === "closed") {
        return "closed";
    }
    return "active";
}

function getSeverityColor(severity: DbAgentIssueSeverity): "danger" | "warning" | "informative" {
    return severity === "critical" ? "danger" : severity === "warning" ? "warning" : "informative";
}

function getRiskColor(risk: DbAgentIssueAction["risk"]): "success" | "warning" | "danger" {
    return risk === "low" ? "success" : risk === "medium" ? "warning" : "danger";
}

function formatDateTime(timestamp: string): string {
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "short",
        timeStyle: "short",
    }).format(new Date(timestamp));
}
