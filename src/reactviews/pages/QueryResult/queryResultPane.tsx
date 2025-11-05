/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Link,
    Tab,
    TabList,
    Title3,
    makeStyles,
    Text,
    Spinner,
} from "@fluentui/react-components";
import { useContext, useEffect, useRef, useState } from "react";
import { DatabaseSearch24Regular, ErrorCircle24Regular, OpenRegular } from "@fluentui/react-icons";
import * as qr from "../../../sharedInterfaces/queryResult";
import { locConstants } from "../../common/locConstants";
import { hasResultsOrMessages } from "./queryResultUtils";
import { QueryResultCommandsContext } from "./queryResultStateProvider";
import { useQueryResultSelector } from "./queryResultSelector";
import { ExecuteCommandRequest } from "../../../sharedInterfaces/webview";
import { ExecutionPlanGraph } from "../../../sharedInterfaces/executionPlan";
import { getGridCount } from "./table/utils";
import { QueryMessageTab } from "./queryMessageTab";
import { QueryExecutionPlanTab } from "./queryExecutionPlanTab";
import { QueryResultsTab } from "./queryResultsTab";

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
        height: "100%",
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

export const QueryResultPane = () => {
    const classes = useStyles();
    const context = useContext(QueryResultCommandsContext);

    if (!context) {
        return;
    }

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

    const resultPaneParentRef = useRef<HTMLDivElement>(null);
    const ribbonRef = useRef<HTMLDivElement>(null);

    const getWebviewLocation = async () => {
        const res = await context.extensionRpc.sendRequest(qr.GetWebviewLocationRequest.type, {
            uri: uri,
        });
        setWebviewLocation(res);
    };
    const [webviewLocation, setWebviewLocation] = useState("");
    useEffect(() => {
        getWebviewLocation().catch((e) => {
            console.error(e);
            setWebviewLocation("panel");
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
            </div>
        );
    }

    if (!uri || !hasResultsOrMessages(resultSetSummaries, messages)) {
        return (
            <div className={classes.root}>
                <div className={classes.noResultsContainer}>
                    <div className={classes.noResultsScrollablePane}>
                        {webviewLocation === "document" ? (
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
                                            ExecuteCommandRequest.type,
                                            {
                                                command: "workbench.action.closePanel",
                                            },
                                        );
                                    }}>
                                    {locConstants.queryResult.clickHereToHideThisPanel}
                                </Link>
                            </>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={classes.root} ref={resultPaneParentRef}>
            <div className={classes.ribbon} ref={ribbonRef}>
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
                            key={qr.QueryResultPaneTabs.Results}>
                            {locConstants.queryResult.results(getGridCount(resultSetSummaries))}
                        </Tab>
                    )}
                    <Tab
                        value={qr.QueryResultPaneTabs.Messages}
                        key={qr.QueryResultPaneTabs.Messages}>
                        {locConstants.queryResult.messages}
                    </Tab>
                    {Object.keys(resultSetSummaries).length > 0 && isExecutionPlan && (
                        <Tab
                            value={qr.QueryResultPaneTabs.ExecutionPlan}
                            key={qr.QueryResultPaneTabs.ExecutionPlan}>
                            {`${locConstants.queryResult.queryPlan(executionPlanGraphs?.length || 0)}`}
                        </Tab>
                    )}
                </TabList>
                {webviewLocation === "panel" && (
                    <Button
                        icon={<OpenRegular />}
                        iconPosition="after"
                        appearance="subtle"
                        onClick={async () => {
                            await context.extensionRpc.sendRequest(qr.OpenInNewTabRequest.type, {
                                uri: uri!,
                            });
                        }}
                        title={locConstants.queryResult.openResultInNewTab}
                        style={{ marginTop: "4px", marginBottom: "4px" }}>
                        {locConstants.queryResult.openResultInNewTab}
                    </Button>
                )}
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
                    <QueryResultsTab />
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
                        visibility:
                            tabStates!.resultPaneTab === qr.QueryResultPaneTabs.ExecutionPlan
                                ? "visible"
                                : "hidden",
                    }}
                    aria-hidden={tabStates!.resultPaneTab !== qr.QueryResultPaneTabs.ExecutionPlan}>
                    <QueryExecutionPlanTab />
                </div>
            </div>
        </div>
    );
};
