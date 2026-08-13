/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSX } from "react";
import {
    Badge,
    Button,
    Dropdown,
    MessageBar,
    MessageBarBody,
    Option,
    Spinner,
    Tab,
    TabList,
    Text,
    Toolbar,
} from "@fluentui/react-components";
import { ArrowClockwise20Regular, Code20Regular, Database20Regular } from "@fluentui/react-icons";
import {
    DashboardTabId,
    ServerDashboardReducers,
    ServerDashboardWebviewState,
    isDashboardTabId,
} from "../../../sharedInterfaces/serverDashboard";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { useVscodeSelector } from "../../common/useVscodeSelector";
import { getDashboardLoc, getPlatformLabel } from "./dashboardLabels";
import { DbAgentTab } from "./tabs/dbAgentTab";
import { OverviewTab } from "./tabs/overviewTab";
import { QueriesTab } from "./tabs/queriesTab";
import { SessionsTab } from "./tabs/sessionsTab";
import { WaitsTab } from "./tabs/waitsTab";

const timeWindowOptions = [60, 360, 1440] as const;

export function DashboardPage(): JSX.Element {
    const dashboardLoc = getDashboardLoc();
    const { extensionRpc } = useVscodeWebview<
        ServerDashboardWebviewState,
        ServerDashboardReducers
    >();
    const snapshot = useVscodeSelector<
        ServerDashboardWebviewState,
        ServerDashboardReducers,
        ServerDashboardWebviewState["snapshot"]
    >((state) => state.snapshot);
    const availableTargets = useVscodeSelector<
        ServerDashboardWebviewState,
        ServerDashboardReducers,
        ServerDashboardWebviewState["availableTargets"]
    >((state) => state.availableTargets);
    const selectedTab = useVscodeSelector<
        ServerDashboardWebviewState,
        ServerDashboardReducers,
        DashboardTabId
    >((state) => state.selectedTab);
    const dbAgentAvailable = useVscodeSelector<
        ServerDashboardWebviewState,
        ServerDashboardReducers,
        boolean
    >((state) => state.dbAgentAvailable);
    const isRefreshing = useVscodeSelector<
        ServerDashboardWebviewState,
        ServerDashboardReducers,
        boolean
    >((state) => state.isRefreshing);
    const errorMessage = useVscodeSelector<
        ServerDashboardWebviewState,
        ServerDashboardReducers,
        string | undefined
    >((state) => state.errorMessage);

    const selectTab = (value: unknown): void => {
        if (isDashboardTabId(value)) {
            extensionRpc.action("selectTab", { tabId: value });
        }
    };

    return (
        <main className="dashboard-root">
            <header className="dashboard-header">
                <div className="dashboard-title-row">
                    <div className="dashboard-title-icon" aria-hidden="true">
                        <Database20Regular />
                    </div>
                    <div>
                        <div className="dashboard-heading-with-badge">
                            <Text as="h1" size={700} weight="semibold">
                                {dashboardLoc.performanceDashboard}
                            </Text>
                            <Badge appearance="tint" color="informative">
                                {dashboardLoc.mockData}
                            </Badge>
                        </div>
                        <Text className="dashboard-secondary-text">
                            {snapshot.target.displayName}
                        </Text>
                    </div>
                </div>

                <Toolbar className="dashboard-toolbar" aria-label={dashboardLoc.dashboardActions}>
                    <Dropdown
                        className="dashboard-resource-picker"
                        aria-label={dashboardLoc.sqlResource}
                        value={snapshot.target.displayName}
                        selectedOptions={[snapshot.target.id]}
                        onOptionSelect={(_, data) => {
                            if (data.optionValue) {
                                extensionRpc.action("changeTarget", {
                                    targetId: data.optionValue,
                                });
                            }
                        }}>
                        {availableTargets.map((target) => (
                            <Option key={target.id} value={target.id} text={target.displayName}>
                                <div className="dashboard-option">
                                    <span>{target.displayName}</span>
                                    <small>{getPlatformLabel(target.platform)}</small>
                                </div>
                            </Option>
                        ))}
                    </Dropdown>
                    <Dropdown
                        aria-label={dashboardLoc.timeRange}
                        value={getTimeWindowLabel(snapshot.windowMinutes)}
                        selectedOptions={[snapshot.windowMinutes.toString()]}
                        onOptionSelect={(_, data) => {
                            if (data.optionValue) {
                                extensionRpc.action("changeTimeWindow", {
                                    windowMinutes: Number(data.optionValue),
                                });
                            }
                        }}>
                        {timeWindowOptions.map((windowMinutes) => (
                            <Option key={windowMinutes} value={windowMinutes.toString()}>
                                {getTimeWindowLabel(windowMinutes)}
                            </Option>
                        ))}
                    </Dropdown>
                    <Button
                        appearance="primary"
                        icon={<Code20Regular />}
                        onClick={() => extensionRpc.action("openNewQuery", {})}>
                        {dashboardLoc.newQuery}
                    </Button>
                    <Button
                        icon={isRefreshing ? <Spinner size="tiny" /> : <ArrowClockwise20Regular />}
                        disabled={isRefreshing}
                        onClick={() => extensionRpc.action("refresh", {})}>
                        {isRefreshing ? dashboardLoc.refreshing : dashboardLoc.refresh}
                    </Button>
                </Toolbar>
            </header>

            {errorMessage ? (
                <MessageBar intent="error">
                    <MessageBarBody>{errorMessage}</MessageBarBody>
                </MessageBar>
            ) : null}

            <section className="dashboard-resource-strip" aria-label={dashboardLoc.resourceSummary}>
                <div>
                    <Text className="dashboard-secondary-text">{dashboardLoc.platform}</Text>
                    <Text weight="semibold">{getPlatformLabel(snapshot.target.platform)}</Text>
                </div>
                <div>
                    <Text className="dashboard-secondary-text">{dashboardLoc.database}</Text>
                    <Text weight="semibold">{snapshot.target.databaseName}</Text>
                </div>
                <div>
                    <Text className="dashboard-secondary-text">{dashboardLoc.serviceTier}</Text>
                    <Text weight="semibold">{snapshot.server.serviceTier}</Text>
                </div>
                <div>
                    <Text className="dashboard-secondary-text">{dashboardLoc.region}</Text>
                    <Text weight="semibold">{snapshot.server.region}</Text>
                </div>
            </section>

            <TabList
                className="dashboard-tabs"
                selectedValue={selectedTab}
                onTabSelect={(_, data) => selectTab(data.value)}>
                <Tab value="overview">{dashboardLoc.overview}</Tab>
                <Tab value="waits">{dashboardLoc.waits}</Tab>
                <Tab value="queries">{dashboardLoc.queries}</Tab>
                <Tab value="sessions">{dashboardLoc.sessions}</Tab>
                {dbAgentAvailable ? (
                    <Tab value="issues">
                        <span className="dashboard-tab-label">
                            {dashboardLoc.databaseAgent}
                            {snapshot.dbAgent.registrationMode === "registered" ? (
                                <Badge appearance="filled" color="informative" size="small">
                                    {
                                        snapshot.dbAgent.issues.filter(
                                            (issue) =>
                                                issue.status !== "resolved" &&
                                                issue.status !== "closed",
                                        ).length
                                    }
                                </Badge>
                            ) : null}
                        </span>
                    </Tab>
                ) : null}
            </TabList>

            <div className="dashboard-scroll-region">
                {selectedTab === "overview" ? <OverviewTab snapshot={snapshot} /> : null}
                {selectedTab === "waits" ? <WaitsTab waits={snapshot.waits} /> : null}
                {selectedTab === "queries" ? (
                    <QueriesTab
                        queries={snapshot.queries}
                        onNewQuery={() => extensionRpc.action("openNewQuery", {})}
                    />
                ) : null}
                {selectedTab === "sessions" ? <SessionsTab sessions={snapshot.sessions} /> : null}
                {dbAgentAvailable && selectedTab === "issues" ? (
                    <DbAgentTab
                        targetId={snapshot.target.id}
                        dbAgent={snapshot.dbAgent}
                        onSetEnabled={(enabled) =>
                            extensionRpc.action("setDbAgentEnabled", { enabled })
                        }
                        onRegister={() => extensionRpc.action("registerDbAgent", {})}
                        onAcknowledgeIssue={(issueId) =>
                            extensionRpc.action("acknowledgeIssue", { issueId })
                        }
                        onDecideAction={(issueId, actionId, decision) =>
                            extensionRpc.action("decideDbAgentAction", {
                                issueId,
                                actionId,
                                decision,
                            })
                        }
                        onExecuteAction={(issueId, actionId) =>
                            extensionRpc.action("executeDbAgentAction", {
                                issueId,
                                actionId,
                            })
                        }
                        onMarkActionApplied={(issueId, actionId) =>
                            extensionRpc.action("markDbAgentActionApplied", {
                                issueId,
                                actionId,
                            })
                        }
                        onAnalyzeSection={(issueId, section) =>
                            extensionRpc.action("analyzeDbAgentSection", {
                                issueId,
                                section,
                            })
                        }
                        onForceResolve={(investigationId) =>
                            extensionRpc.action("forceResolveInvestigation", {
                                investigationId,
                            })
                        }
                        onSaveSettings={(settings) =>
                            extensionRpc.action("saveDbAgentSettings", { settings })
                        }
                        onCreateInstruction={(text) =>
                            extensionRpc.action("createDbAgentInstruction", { text })
                        }
                        onRevokeInstruction={(instructionId) =>
                            extensionRpc.action("revokeDbAgentInstruction", {
                                instructionId,
                            })
                        }
                    />
                ) : null}
            </div>

            <footer className="dashboard-footer">
                <Text className="dashboard-secondary-text">
                    {dashboardLoc.mockProviderLastUpdated(
                        new Intl.DateTimeFormat(undefined, {
                            dateStyle: "short",
                            timeStyle: "medium",
                        }).format(new Date(snapshot.generatedAt)),
                    )}
                </Text>
            </footer>
        </main>
    );
}

function getTimeWindowLabel(windowMinutes: number): string {
    const dashboardLoc = getDashboardLoc();
    switch (windowMinutes) {
        case 60:
            return dashboardLoc.lastHour;
        case 360:
            return dashboardLoc.lastSixHours;
        case 1440:
            return dashboardLoc.lastTwentyFourHours;
        default:
            return dashboardLoc.lastMinutes(windowMinutes);
    }
}
