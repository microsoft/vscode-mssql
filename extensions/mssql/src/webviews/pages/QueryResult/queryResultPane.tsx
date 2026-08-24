/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Link,
    Menu,
    MenuItemSwitch,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Tab,
    TabList,
    Title3,
    makeStyles,
    Text,
    Spinner,
    Toolbar,
    ToolbarButton,
} from "@fluentui/react-components";
import { type ComponentType, useContext, useEffect, useState } from "react";
import {
    DatabaseSearch24Regular,
    ErrorCircle24Regular,
    MoreVertical20Filled,
    OpenRegular,
} from "@fluentui/react-icons";
import * as qr from "../../../sharedInterfaces/queryResult";
import { locConstants } from "../../common/locConstants";
import { getTotalResultSetRowCount, hasResultsOrMessages } from "./queryResultUtils";
import { QueryResultCommandsContext } from "./queryResultStateProvider";
import { useQueryResultSelector } from "./queryResultSelector";
import { WebviewAction } from "../../../sharedInterfaces/webview";
import { ExecutionPlanGraph } from "../../../sharedInterfaces/executionPlan";
import { getGridCount } from "./table/utils";
import { QueryMessageTab } from "./queryMessageTab";
import { QueryExecutionPlanTab } from "./queryExecutionPlanTab";
import { QueryResultsTab } from "./queryResultsTab";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { eventMatchesShortcut } from "../../common/keyboardUtils";
import { QueryResultSummaryFooter } from "./queryResultSummaryFooter";
import { CopyIndicator } from "../../common/CopyIndicator";

const useStyles = makeStyles({
    root: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
    },
    ribbon: {
        width: "100%",
        display: "flex",
        flexDirection: "row",
        "> *": {
            marginRight: "10px",
        },
    },
    ribbonActions: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
    },
    queryResultPaneTabs: {
        flex: 1,
    },
    tabContentContainer: {
        position: "relative",
        flex: 1,
        width: "100%",
        height: "100%",
    },
    tabContent: {
        position: "absolute",
        inset: 0,
        overflow: "auto",
    },
    noResultMessage: {
        fontSize: "14px",
        margin: "10px 0 0 10px",
    },
    hidePanelLink: {
        fontSize: "14px",
        margin: "10px 0 0 10px",
        cursor: "pointer",
    },
    noResultsContainer: {
        width: "100%",
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        overflowY: "auto",
        overflowX: "hidden",
        boxSizing: "border-box",
        padding: "20px",
    },
    noResultsScrollablePane: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "8px",
        minHeight: "150px",
    },
    noResultsIcon: {
        width: "56px",
        height: "56px",
        display: "grid",
        placeItems: "center",
        borderRadius: "14px",
        // Use VS Code theme info color for background accent
        // color-mix provides theme-aware translucent gradient
        background: "linear-gradient(135deg, rgba(0,120,212,.16), rgba(0,120,212,.06))",
    },
    resultErrorIcon: {
        width: "56px",
        height: "56px",
        display: "grid",
        placeItems: "center",
        borderRadius: "14px",
        // Use VS Code theme error color for background accent
        background: "linear-gradient(135deg, rgba(255,0,0,.16), rgba(255,0,0,.06))",
    },
});

interface QueryResultPaneProps {
    GridView: ComponentType;
    isBetaResultsGridEnabled: boolean;
}

export const QueryResultPane = ({ GridView, isBetaResultsGridEnabled }: QueryResultPaneProps) => {
    const classes = useStyles();
    const context = useContext(QueryResultCommandsContext);

    if (!context) {
        return;
    }
    const log = context.log;

    // Use selectors to get specific state pieces
    const resultSetSummaries = useQueryResultSelector<
        Record<number, Record<number, qr.ResultSetSummary>>
    >((s) => s.resultSetSummaries);
    const initilizationError = useQueryResultSelector<string | undefined>(
        (s) => s.initializationError,
    );
    const messages = useQueryResultSelector<qr.IMessage[]>((s) => s.messages);
    const uri = useQueryResultSelector<string | undefined>((s) => s.uri);
    const tabStates = useQueryResultSelector<qr.QueryResultTabStates | undefined>(
        (s) => s.tabStates,
    );
    const isExecutionPlan = useQueryResultSelector<boolean | undefined>((s) => s.isExecutionPlan);
    const executionPlanGraphs = useQueryResultSelector<ExecutionPlanGraph[] | undefined>(
        (s) => s.executionPlanState?.executionPlanGraphs,
    );
    const { keyBindings } = useVscodeWebview();
    const [isPreviewGridSwitchChecked, setIsPreviewGridSwitchChecked] =
        useState(isBetaResultsGridEnabled);
    const [isPreviewGridSwitchPending, setIsPreviewGridSwitchPending] = useState(false);

    useEffect(() => {
        setIsPreviewGridSwitchChecked(isBetaResultsGridEnabled);
        setIsPreviewGridSwitchPending(false);
    }, [isBetaResultsGridEnabled]);

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            let handled = false;
            if (
                eventMatchesShortcut(
                    event,
                    keyBindings[WebviewAction.QueryResultSwitchToResultsTab]?.keyCombination,
                )
            ) {
                if (Object.keys(resultSetSummaries ?? {}).length > 0) {
                    context.setResultTab(qr.QueryResultPaneTabs.Results);
                    handled = true;
                }
            } else if (
                eventMatchesShortcut(
                    event,
                    keyBindings[WebviewAction.QueryResultSwitchToMessagesTab]?.keyCombination,
                )
            ) {
                context.setResultTab(qr.QueryResultPaneTabs.Messages);
                handled = true;
            } else if (
                eventMatchesShortcut(
                    event,
                    keyBindings[WebviewAction.QueryResultSwitchToQueryPlanTab]?.keyCombination,
                )
            ) {
                if (isExecutionPlan) {
                    context.setResultTab(qr.QueryResultPaneTabs.ExecutionPlan);
                    handled = true;
                }
            }
            if (handled) {
                event.preventDefault();
                event.stopPropagation();
            }
        };

        document.addEventListener("keydown", handler, true);
        return () => {
            document.removeEventListener("keydown", handler, true);
        };
    }, [tabStates?.resultPaneTab, getGridCount, context, resultSetSummaries]);

    const getWebviewLocation = async () => {
        const res = await context.extensionRpc.sendRequest(qr.GetWebviewLocationRequest.type, {
            uri: uri,
        });
        setWebviewLocation(res);
    };
    const [webviewLocation, setWebviewLocation] = useState<qr.QueryResultWebviewLocation>(
        qr.QueryResultWebviewLocation.Panel,
    );

    useEffect(() => {
        getWebviewLocation().catch((e) => {
            log.error("Failed to get webview location", e);
            setWebviewLocation(qr.QueryResultWebviewLocation.Panel);
        });
    }, []);

    if (initilizationError) {
        return (
            <div className={classes.root}>
                <div className={classes.noResultsContainer}>
                    <div className={classes.noResultsScrollablePane}>
                        <div className={classes.resultErrorIcon} aria-hidden>
                            <ErrorCircle24Regular />
                        </div>
                        <Title3>{locConstants.queryResult.failedToStartQuery}</Title3>
                        <Text className={classes.noResultMessage}>{initilizationError}</Text>
                    </div>
                </div>
                {isBetaResultsGridEnabled && <QueryResultSummaryFooter hideMetrics={true} />}
            </div>
        );
    }

    if (!uri || !hasResultsOrMessages(resultSetSummaries, messages)) {
        return (
            <div className={classes.root}>
                <div className={classes.noResultsContainer}>
                    <div className={classes.noResultsScrollablePane}>
                        {webviewLocation === qr.QueryResultWebviewLocation.Document ? (
                            <Spinner
                                label={locConstants.queryResult.loadingResultsMessage}
                                labelPosition="below"
                                size="large"
                            />
                        ) : (
                            <>
                                <div className={classes.noResultsIcon} aria-hidden>
                                    <DatabaseSearch24Regular />
                                </div>
                                <Title3>{locConstants.queryResult.noResultsHeader}</Title3>
                                <Text>{locConstants.queryResult.noResultMessage}</Text>
                                <Link
                                    className={classes.hidePanelLink}
                                    onClick={async () => {
                                        await context.extensionRpc.sendRequest(
                                            qr.CloseResultsPanelRequest.type,
                                        );
                                    }}>
                                    {locConstants.queryResult.clickHereToHideThisPanel}
                                </Link>
                            </>
                        )}
                    </div>
                </div>
                {isBetaResultsGridEnabled && <QueryResultSummaryFooter hideMetrics={true} />}
            </div>
        );
    }

    return (
        <div className={classes.root}>
            <div className={classes.ribbon}>
                <TabList
                    size="medium"
                    selectedValue={tabStates!.resultPaneTab}
                    onTabSelect={(_event, data) => {
                        context.setResultTab(data.value as qr.QueryResultPaneTabs);
                    }}
                    className={classes.queryResultPaneTabs}>
                    {Object.keys(resultSetSummaries).length > 0 && (
                        <Tab
                            value={qr.QueryResultPaneTabs.Results}
                            title={
                                isBetaResultsGridEnabled
                                    ? locConstants.queryResult.resultBetaTabTooltip(
                                          keyBindings[WebviewAction.QueryResultSwitchToResultsTab]
                                              .label,
                                      )
                                    : locConstants.queryResult.resultTabTooltip(
                                          keyBindings[WebviewAction.QueryResultSwitchToResultsTab]
                                              .label,
                                      )
                            }
                            key={qr.QueryResultPaneTabs.Results}>
                            {isBetaResultsGridEnabled
                                ? locConstants.queryResult.resultsBeta(
                                      getGridCount(resultSetSummaries),
                                  )
                                : locConstants.queryResult.results(
                                      getGridCount(resultSetSummaries),
                                  )}
                        </Tab>
                    )}
                    <Tab
                        value={qr.QueryResultPaneTabs.Messages}
                        title={locConstants.queryResult.messagesTabTooltip(
                            keyBindings[WebviewAction.QueryResultSwitchToMessagesTab].label,
                        )}
                        key={qr.QueryResultPaneTabs.Messages}>
                        {locConstants.queryResult.messages}
                    </Tab>
                    {Object.keys(resultSetSummaries).length > 0 && isExecutionPlan && (
                        <Tab
                            value={qr.QueryResultPaneTabs.ExecutionPlan}
                            title={locConstants.queryResult.queryPlanTooltip(
                                keyBindings[WebviewAction.QueryResultSwitchToQueryPlanTab].label,
                            )}
                            key={qr.QueryResultPaneTabs.ExecutionPlan}>
                            {`${locConstants.queryResult.queryPlan(executionPlanGraphs?.length || 0)}`}
                        </Tab>
                    )}
                </TabList>

                <Toolbar aria-label={locConstants.queryResult.resultsToolbar}>
                    <CopyIndicator visible={context.copyIndicatorVisible} />
                    {webviewLocation === qr.QueryResultWebviewLocation.Panel && (
                        <Button
                            icon={<OpenRegular />}
                            iconPosition="after"
                            appearance="subtle"
                            onClick={async () => {
                                await context.extensionRpc.sendRequest(
                                    qr.OpenInNewTabRequest.type,
                                    {
                                        uri: uri!,
                                    },
                                );
                            }}
                            title={locConstants.queryResult.openResultInNewTab}
                            style={{ marginTop: "4px", marginBottom: "4px" }}>
                            {locConstants.queryResult.openResultInNewTab}
                        </Button>
                    )}
                    <Menu
                        checkedValues={{
                            previewGrid: isPreviewGridSwitchChecked ? ["enabled"] : [],
                        }}
                        onCheckedValueChange={(_event, data) => {
                            if (data.name !== "previewGrid") {
                                return;
                            }

                            const previousValue = isPreviewGridSwitchChecked;
                            setIsPreviewGridSwitchChecked(data.checkedItems.includes("enabled"));
                            setIsPreviewGridSwitchPending(true);

                            // Not awaited: switching the mode reloads this webview into the other
                            // bundle, so the response may never arrive. Roll back only if the
                            // extension reports a failure before the reload.
                            void context.extensionRpc
                                .sendRequest(qr.ToggleResultsGridModeRequest.type, {
                                    gridCount: getGridCount(resultSetSummaries),
                                    rowCount: getTotalResultSetRowCount(resultSetSummaries),
                                })
                                .catch((error) => {
                                    setIsPreviewGridSwitchChecked(previousValue);
                                    setIsPreviewGridSwitchPending(false);
                                    log.error(`Failed to toggle results grid mode: ${error}`);
                                });
                        }}>
                        <MenuTrigger disableButtonEnhancement>
                            <ToolbarButton
                                appearance="subtle"
                                icon={<MoreVertical20Filled />}
                                aria-label={locConstants.queryResult.moreActions}
                                title={locConstants.queryResult.moreActions}
                            />
                        </MenuTrigger>
                        <MenuPopover>
                            <MenuList>
                                <MenuItemSwitch
                                    name="previewGrid"
                                    value="enabled"
                                    disabled={isPreviewGridSwitchPending}
                                    title={locConstants.queryResult.previewGridSwitchTooltip}
                                    persistOnClick>
                                    {locConstants.queryResult.previewGrid}
                                </MenuItemSwitch>
                            </MenuList>
                        </MenuPopover>
                    </Menu>
                </Toolbar>
            </div>

            <div className={classes.tabContentContainer}>
                <div
                    className={classes.tabContent}
                    style={{
                        visibility:
                            tabStates!.resultPaneTab === qr.QueryResultPaneTabs.Results
                                ? "visible"
                                : "hidden",
                    }}
                    aria-hidden={tabStates!.resultPaneTab !== qr.QueryResultPaneTabs.Results}>
                    <QueryResultsTab GridView={GridView} />
                </div>

                <div
                    className={classes.tabContent}
                    style={{
                        visibility:
                            tabStates!.resultPaneTab === qr.QueryResultPaneTabs.Messages
                                ? "visible"
                                : "hidden",
                    }}
                    aria-hidden={tabStates!.resultPaneTab !== qr.QueryResultPaneTabs.Messages}>
                    <QueryMessageTab />
                </div>

                <div
                    className={classes.tabContent}
                    style={{
                        display:
                            tabStates!.resultPaneTab === qr.QueryResultPaneTabs.ExecutionPlan
                                ? "block"
                                : "none",
                        visibility:
                            tabStates!.resultPaneTab === qr.QueryResultPaneTabs.ExecutionPlan
                                ? "visible"
                                : "hidden",
                    }}
                    aria-hidden={tabStates!.resultPaneTab !== qr.QueryResultPaneTabs.ExecutionPlan}>
                    <QueryExecutionPlanTab />
                </div>
            </div>
            {isBetaResultsGridEnabled && <QueryResultSummaryFooter />}
        </div>
    );
};
