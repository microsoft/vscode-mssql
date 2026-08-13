/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    MessageBarTitle,
    Switch,
    Tab,
    TabList,
    Text,
} from "@fluentui/react-components";
import { type JSX, useState } from "react";
import {
    DbAgentAnalyzableSection,
    DbAgentDashboard,
    DbAgentSettings,
} from "../../../../sharedInterfaces/serverDashboard";
import {
    DbAgentAccess,
    DbAgentPolicies,
    DbAgentSettingsPanel,
} from "../components/dbAgentConfiguration";
import { InvestigationBanner, InvestigationHistory } from "../components/dbAgentInvestigation";
import { DbAgentIssues } from "../components/dbAgentIssues";
import { DbAgentRegistration } from "../components/dbAgentRegistration";
import { getDashboardLoc, getHealthLabel } from "../dashboardLabels";

type DbAgentPage = "issues" | "history" | "policies" | "settings" | "access";

export interface DbAgentTabProps {
    dbAgent: DbAgentDashboard;
    onSetEnabled: (enabled: boolean) => void;
    onRegister: () => void;
    onAcknowledgeIssue: (issueId: string) => void;
    onDecideAction: (issueId: string, actionId: string, decision: "approve" | "reject") => void;
    onExecuteAction: (issueId: string, actionId: string) => void;
    onMarkActionApplied: (issueId: string, actionId: string) => void;
    onAnalyzeSection: (issueId: string, section: DbAgentAnalyzableSection) => void;
    onForceResolve: (investigationId: string) => void;
    onSaveSettings: (settings: DbAgentSettings) => void;
    onCreateInstruction: (text: string) => void;
    onRevokeInstruction: (instructionId: string) => void;
}

export function DbAgentTab({
    dbAgent,
    onSetEnabled,
    onRegister,
    onAcknowledgeIssue,
    onDecideAction,
    onExecuteAction,
    onMarkActionApplied,
    onAnalyzeSection,
    onForceResolve,
    onSaveSettings,
    onCreateInstruction,
    onRevokeInstruction,
}: DbAgentTabProps): JSX.Element {
    const dashboardLoc = getDashboardLoc();
    const [selectedPage, setSelectedPage] = useState<DbAgentPage>("issues");
    const [focusIssueId, setFocusIssueId] = useState<string>();
    const registeredOrDegraded =
        dbAgent.registrationMode === "registered" ||
        dbAgent.registrationMode === "degradedAuth" ||
        dbAgent.registrationMode === "degradedAuthz" ||
        dbAgent.registrationMode === "degradedApi";

    if (!registeredOrDegraded) {
        return (
            <DbAgentRegistration
                registrationMode={dbAgent.registrationMode}
                onRegister={onRegister}
            />
        );
    }

    const activeIssueCount = dbAgent.issues.filter(
        (issue) => issue.status !== "resolved" && issue.status !== "closed",
    ).length;
    const degradedMessage = getDegradedMessage(dbAgent.registrationMode);

    return (
        <div className="dashboard-tab-content dashboard-agent-content">
            {dbAgent.surfaceStatus === "error" && dbAgent.errorMessage ? (
                <MessageBar intent="error">
                    <MessageBarBody>{dbAgent.errorMessage}</MessageBarBody>
                </MessageBar>
            ) : null}
            {degradedMessage ? (
                <MessageBar intent="warning">
                    <MessageBarBody>
                        <MessageBarTitle>{dashboardLoc.registrationDegraded}</MessageBarTitle>
                        {degradedMessage}
                    </MessageBarBody>
                    <MessageBarActions>
                        <Button onClick={onRegister}>{dashboardLoc.retryRegistration}</Button>
                    </MessageBarActions>
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
                <div className="dashboard-agent-summary-item">
                    <Text className="dashboard-secondary-text">{dashboardLoc.openIssues}</Text>
                    <Text size={700} weight="semibold">
                        {activeIssueCount}
                    </Text>
                </div>
                <div className="dashboard-agent-summary-item">
                    <Text className="dashboard-secondary-text">{dashboardLoc.automationMode}</Text>
                    <Text size={500} weight="semibold">
                        {dbAgent.automationLevel === "approvalRequired"
                            ? dashboardLoc.approvalRequired
                            : dashboardLoc.recommendOnly}
                    </Text>
                </div>
                <div className="dashboard-agent-summary-item">
                    <Text className="dashboard-secondary-text">
                        {dashboardLoc.lastSuccessfulRun}
                    </Text>
                    <Text size={400} weight="semibold">
                        {formatDateTime(dbAgent.lastSuccessfulRunAt)}
                    </Text>
                </div>
                <div className="dashboard-agent-summary-item">
                    <Text className="dashboard-secondary-text">
                        {dashboardLoc.activeInvestigation}
                    </Text>
                    <Text size={500} weight="semibold">
                        {dbAgent.activeInvestigation
                            ? dashboardLoc.investigating
                            : dashboardLoc.none}
                    </Text>
                </div>
            </div>

            <TabList
                className="dashboard-agent-navigation"
                selectedValue={selectedPage}
                onTabSelect={(_, data) => setSelectedPage(data.value as DbAgentPage)}>
                <Tab value="issues">{dashboardLoc.issues}</Tab>
                <Tab value="history">{dashboardLoc.history}</Tab>
                <Tab value="policies">{dashboardLoc.policies}</Tab>
                <Tab value="settings">{dashboardLoc.settings}</Tab>
                <Tab value="access">{dashboardLoc.access}</Tab>
            </TabList>

            {selectedPage === "issues" ? (
                <>
                    {dbAgent.activeInvestigation ? (
                        <InvestigationBanner
                            investigation={dbAgent.activeInvestigation}
                            issues={dbAgent.issues}
                            onFocusIssue={(issueId) => {
                                setFocusIssueId(issueId);
                                setSelectedPage("issues");
                            }}
                            onForceResolve={onForceResolve}
                        />
                    ) : null}
                    <DbAgentIssues
                        issues={dbAgent.issues}
                        focusIssueId={focusIssueId}
                        onAcknowledge={onAcknowledgeIssue}
                        onDecideAction={onDecideAction}
                        onExecuteAction={onExecuteAction}
                        onMarkActionApplied={onMarkActionApplied}
                        onAnalyzeSection={onAnalyzeSection}
                    />
                </>
            ) : null}
            {selectedPage === "history" ? (
                <InvestigationHistory
                    activeInvestigation={dbAgent.activeInvestigation}
                    investigations={dbAgent.investigations}
                />
            ) : null}
            {selectedPage === "policies" ? (
                <DbAgentPolicies
                    instructions={dbAgent.instructions}
                    onCreateInstruction={onCreateInstruction}
                    onRevokeInstruction={onRevokeInstruction}
                />
            ) : null}
            {selectedPage === "settings" ? (
                <DbAgentSettingsPanel settings={dbAgent.settings} onSave={onSaveSettings} />
            ) : null}
            {selectedPage === "access" ? (
                <DbAgentAccess
                    settings={dbAgent.settings}
                    registrationMode={dbAgent.registrationMode}
                />
            ) : null}
        </div>
    );
}

function getDegradedMessage(mode: DbAgentDashboard["registrationMode"]): string | undefined {
    const dashboardLoc = getDashboardLoc();
    switch (mode) {
        case "degradedAuth":
            return dashboardLoc.degradedAuthentication;
        case "degradedAuthz":
            return dashboardLoc.degradedAuthorization;
        case "degradedApi":
            return dashboardLoc.degradedApi;
        default:
            return undefined;
    }
}

function formatDateTime(timestamp: string): string {
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "short",
        timeStyle: "medium",
    }).format(new Date(timestamp));
}
