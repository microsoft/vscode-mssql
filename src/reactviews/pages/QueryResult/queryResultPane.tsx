/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Link,
    Tab,
    TabList,
    TableColumnDefinition,
    TableColumnSizingOptions,
    createTableColumn,
    makeStyles,
    shorthands,
} from "@fluentui/react-components";
import {
    DataGridBody,
    DataGrid,
    DataGridRow,
    DataGridCell,
    RowRenderer,
} from "@fluentui-contrib/react-data-grid-react-window";
import React, { useContext, useEffect, useRef, useState } from "react";
import { OpenRegular } from "@fluentui/react-icons";
import { QueryResultContext } from "./queryResultStateProvider";
import * as qr from "../../../sharedInterfaces/queryResult";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import ResultGrid, { ResultGridHandle } from "./resultGrid";
import CommandBar from "./commandBar";
import { TextView } from "./textView";
import { locConstants } from "../../common/locConstants";
import { ACTIONBAR_WIDTH_PX, SCROLLBAR_PX, TABLE_ALIGN_PX } from "./table/table";
import { ExecutionPlanPage } from "../ExecutionPlan/executionPlanPage";
import { ExecutionPlanStateProvider } from "../ExecutionPlan/executionPlanStateProvider";
import { hasResultsOrMessages, splitMessages } from "./queryResultUtils";
import { ExecuteCommandRequest } from "../../../sharedInterfaces/webview";

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
    tabContent: {
        ...shorthands.flex(1),
        width: "100%",
        height: "100%",
        ...shorthands.overflow("auto"),
    },
    queryResultContainer: {
        width: "100%",
        position: "relative",
        display: "flex",
        fontWeight: "normal",
    },
    queryResultPaneOpenButton: {
        position: "absolute",
        top: "0px",
        right: "0px",
    },
    messagesContainer: {
        width: "100%",
        height: "100%",
        fontFamily: "var(--vscode-editor-font-family)",
        flexDirection: "column",
        "> *": {
            marginBottom: "10px",
        },
    },
    messagesLink: {
        fontSize: "var(--vscode-editor-font-size)",
        fontFamily: "var(--vscode-editor-font-family)",
    },
    messagesRows: {
        lineHeight: "18px",
        fontSize: "var(--vscode-editor-font-size)",
        flexDirection: "row",
        borderBottom: "none",
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
});

const MIN_GRID_HEIGHT = 273; // Minimum height for a grid

function getAvailableHeight(resultPaneParent: HTMLDivElement, ribbonRef: HTMLDivElement) {
    return resultPaneParent.clientHeight - ribbonRef.clientHeight;
}

export const QueryResultPane = () => {
    const classes = useStyles();
    const context = useContext(QueryResultContext);

    if (!context) {
        return;
    }
    const webViewState = useVscodeWebview<qr.QueryResultWebviewState, qr.QueryResultReducers>();
    const state = context.state;
    const isProgrammaticScroll = useRef(true);
    isProgrammaticScroll.current = true;

    // lifecycle logging right after context consumption
    useEffect(() => {
        console.debug("QueryResultPane mounted", {
            hasState: !!state,
            state: state,
            hasContext: !!context,
            context: context,
            uri: state?.uri,
            resultSetCount: Object.keys(state?.resultSetSummaries ?? {}).length,
            messageCount: state?.messages?.length,
            isExecutionPlan: state?.isExecutionPlan,
            hasExecutionPlanState: !!state?.executionPlanState,
        });

        return () => {
            console.debug("QueryResultPane unmounted", {
                hasState: !!state,
                state: state,
                hasContext: !!context,
                context: context,
                uri: state?.uri,
            });
        };
    }, []);

    // context change logging
    useEffect(() => {
        console.debug("QueryResultPane context updated", {
            uri: state?.uri,
            hasMetadata: !!state,
            metadata: state,
            hasState: !!context,
            state: context,
            resultSetCount: Object.keys(state?.resultSetSummaries ?? {}).length,
            messageCount: state?.messages?.length,
        });
    }, [state, context]);

    const resultPaneParentRef = useRef<HTMLDivElement>(null);
    const ribbonRef = useRef<HTMLDivElement>(null);
    const gridParentRef = useRef<HTMLDivElement>(null);
    const scrollabelPanelRef = useRef<HTMLDivElement>(null);
    const [messageGridHeight, setMessageGridHeight] = useState(0);

    // Resize grid when parent element resizes
    useEffect(() => {
        let gridCount = 0;
        Object.values(state?.resultSetSummaries ?? []).forEach((v) => {
            gridCount += Object.keys(v).length;
        });
        if (gridCount === 0 && state?.messages?.length === 0) {
            return; // Exit if there are no results/messages grids to render
        }

        const resultPaneParent = resultPaneParentRef.current;
        if (!resultPaneParent) {
            return;
        }
        const observer = new ResizeObserver(() => {
            if (!gridRefs.current || !ribbonRef.current) {
                return;
            }

            const availableHeight = getAvailableHeight(resultPaneParent, ribbonRef.current);
            if (state.tabStates?.resultPaneTab === qr.QueryResultPaneTabs.Messages) {
                setMessageGridHeight(availableHeight);
            }
            if (resultPaneParent.clientWidth && availableHeight) {
                const gridHeight = calculateGridHeight(gridCount, availableHeight);
                const gridWidth = calculateGridWidth(resultPaneParent, gridCount, availableHeight);
                if (gridCount > 1) {
                    gridRefs.current.forEach((gridRef) => {
                        gridRef?.resizeGrid(gridWidth, gridHeight);
                    });
                } else if (gridCount === 1) {
                    gridRefs.current[0]?.resizeGrid(gridWidth, gridHeight);
                }
            }
        });

        observer.observe(resultPaneParent);

        return () => {
            observer.disconnect();
        };
    }, [state?.resultSetSummaries, resultPaneParentRef.current]);

    const calculateGridHeight = (gridCount: number, availableHeight: number) => {
        if (gridCount > 1) {
            // Calculate the grid height, ensuring it's not smaller than the minimum height
            return Math.max(
                (availableHeight - gridCount * TABLE_ALIGN_PX) / gridCount,
                MIN_GRID_HEIGHT,
            );
        }
        // gridCount is 1
        return availableHeight - TABLE_ALIGN_PX;
    };

    const calculateGridWidth = (
        resultPaneParent: HTMLDivElement,
        gridCount: number,
        availableHeight: number,
    ) => {
        if (gridCount > 1) {
            let scrollbarAdjustment =
                gridCount * MIN_GRID_HEIGHT >= availableHeight ? SCROLLBAR_PX : 0;

            return resultPaneParent.clientWidth - ACTIONBAR_WIDTH_PX - scrollbarAdjustment;
        }
        // gridCount is 1
        return resultPaneParent.clientWidth - ACTIONBAR_WIDTH_PX;
    };

    const linkHandler = (fileContent: string, fileType: string) => {
        if (context) {
            context.openFileThroughLink(fileContent, fileType);
        }
    };

    //#region Result Display (Grid or Text)
    const gridRefs = useRef<ResultGridHandle[]>([]);

    const getCurrentViewMode = (): qr.QueryResultViewMode => {
        return state?.tabStates?.resultViewMode ?? qr.QueryResultViewMode.Grid;
    };

    const renderResultSet = (batchId: number, resultId: number, gridCount: number) => {
        const divId = `result-parent-${batchId}-${resultId}`;
        const gridId = `resultGrid-${batchId}-${resultId}`;
        const viewMode = getCurrentViewMode();

        return (
            <div
                id={divId}
                className={classes.queryResultContainer}
                ref={gridParentRef}
                style={{
                    height:
                        resultPaneParentRef.current && ribbonRef.current
                            ? `${calculateGridHeight(
                                  gridCount,
                                  getAvailableHeight(
                                      resultPaneParentRef.current!,
                                      ribbonRef.current!,
                                  ),
                              )}px`
                            : "",
                    fontFamily: state.fontSettings.fontFamily
                        ? state.fontSettings.fontFamily
                        : "var(--vscode-editor-font-family)",
                    fontSize: `${state.fontSettings.fontSize ?? 12}px`,
                }}>
                {/* Render Grid View */}
                {viewMode === qr.QueryResultViewMode.Grid && (
                    <ResultGrid
                        loadFunc={async (offset: number, count: number): Promise<any[]> => {
                            console.debug("getRows rpc call", {
                                uri: state?.uri,
                                batchId: batchId,
                                resultId: resultId,
                                rowStart: offset,
                                numberOfRows: count,
                            });
                            const response = await webViewState.extensionRpc.sendRequest(
                                qr.GetRowsRequest.type,
                                {
                                    uri: state?.uri,
                                    batchId: batchId,
                                    resultId: resultId,
                                    rowStart: offset,
                                    numberOfRows: count,
                                },
                            );

                            if (!response) {
                                return [];
                            }
                            let r = response as qr.ResultSetSubset;
                            var columnLength =
                                state?.resultSetSummaries[batchId][resultId]?.columnInfo?.length;
                            return r.rows.map((r) => {
                                let dataWithSchema: {
                                    [key: string]: any;
                                } = {};
                                // skip the first column since its a number column
                                for (let i = 1; columnLength && i < columnLength + 1; i++) {
                                    const displayValue = r[i - 1].displayValue ?? "";
                                    const ariaLabel = displayValue;
                                    dataWithSchema[(i - 1).toString()] = {
                                        displayValue: displayValue,
                                        ariaLabel: ariaLabel,
                                        isNull: r[i - 1].isNull,
                                        invariantCultureDisplayValue: displayValue,
                                    };
                                }
                                return dataWithSchema;
                            });
                        }}
                        ref={(gridRef) => (gridRefs.current[gridCount] = gridRef!)}
                        resultSetSummary={state?.resultSetSummaries[batchId][resultId]}
                        gridParentRef={gridParentRef}
                        uri={state?.uri}
                        webViewState={webViewState}
                        linkHandler={linkHandler}
                        gridId={gridId}
                    />
                )}

                {/* Render Text View */}
                {viewMode === qr.QueryResultViewMode.Text && (
                    <TextView
                        uri={state?.uri}
                        resultSetSummaries={state?.resultSetSummaries}
                        fontSettings={state?.fontSettings}
                    />
                )}

                <CommandBar
                    uri={state?.uri}
                    resultSetSummary={state?.resultSetSummaries[batchId][resultId]}
                    viewMode={viewMode}
                    maximizeResults={() => {
                        if (viewMode === qr.QueryResultViewMode.Grid) {
                            maximizeResults(gridRefs.current[gridCount]);
                            hideOtherGrids(gridRefs, gridCount);
                        }
                    }}
                    restoreResults={() => {
                        if (viewMode === qr.QueryResultViewMode.Grid) {
                            showOtherGrids(gridRefs, gridCount);
                            restoreResults(gridRefs.current);
                        }
                    }}
                />
            </div>
        );
    };

    const hideOtherGrids = (
        gridRefs: React.MutableRefObject<ResultGridHandle[]>,
        gridCount: number,
    ) => {
        gridRefs.current.forEach((grid) => {
            if (grid !== gridRefs.current[gridCount]) {
                grid.hideGrid();
            }
        });
    };

    const showOtherGrids = (
        gridRefs: React.MutableRefObject<ResultGridHandle[]>,
        gridCount: number,
    ) => {
        gridRefs.current.forEach((grid) => {
            if (grid !== gridRefs.current[gridCount]) {
                grid.showGrid();
            }
        });
    };

    const maximizeResults = (gridRef: ResultGridHandle) => {
        const height =
            getAvailableHeight(resultPaneParentRef.current!, ribbonRef.current!) - TABLE_ALIGN_PX;
        const width = resultPaneParentRef.current?.clientWidth! - ACTIONBAR_WIDTH_PX;
        gridRef.resizeGrid(width, height);
    };

    const restoreResults = (gridRefs: ResultGridHandle[]) => {
        gridRefs.forEach((gridRef) => {
            const height = calculateGridHeight(
                gridRefs.length,
                getAvailableHeight(resultPaneParentRef.current!, ribbonRef.current!),
            );
            const width = resultPaneParentRef.current?.clientWidth! - ACTIONBAR_WIDTH_PX;
            gridRef.resizeGrid(width, height);
        });
    };

    const renderResultPanel = () => {
        const results = [];
        let count = 0;
        for (const batchIdStr in state?.resultSetSummaries ?? {}) {
            const batchId = parseInt(batchIdStr);
            for (const resultIdStr in state?.resultSetSummaries[batchId] ?? {}) {
                const resultId = parseInt(resultIdStr);
                results.push(
                    <React.Fragment key={`result-${batchId}-${resultId}`}>
                        {renderResultSet(batchId, resultId, count)}
                    </React.Fragment>,
                );
                count++;
            }
        }
        return results;
    };
    //#endregion

    //#region Message Grid
    const columnsDef: TableColumnDefinition<qr.IMessage>[] = [
        createTableColumn({
            columnId: "time",
            renderHeaderCell: () => <>{locConstants.queryResult.timestamp}</>,
            renderCell: (item) => (
                <div>
                    <DataGridCell focusMode="group" style={{ minHeight: "18px", width: "100px" }}>
                        {item.batchId === undefined ? item.time : null}
                    </DataGridCell>
                </div>
            ),
        }),
        createTableColumn({
            columnId: "message",
            renderHeaderCell: () => <>{locConstants.queryResult.message}</>,
            renderCell: (item) => {
                if (item.link?.text && item.selection) {
                    return (
                        <DataGridCell focusMode="group" style={{ minHeight: "18px" }}>
                            <div style={{ whiteSpace: "nowrap" }}>
                                {item.message}{" "}
                                <Link
                                    className={classes.messagesLink}
                                    onClick={async () => {
                                        await webViewState.extensionRpc.sendRequest(
                                            qr.SetEditorSelectionRequest.type,
                                            {
                                                uri: item.link?.uri,
                                                selectionData: item.selection,
                                            },
                                        );
                                    }}
                                    inline>
                                    {item?.link?.text}
                                </Link>
                            </div>
                        </DataGridCell>
                    );
                } else {
                    return (
                        <DataGridCell focusMode="group" style={{ minHeight: "18px" }}>
                            <div
                                style={{
                                    whiteSpace: "nowrap",
                                    color: item.isError
                                        ? "var(--vscode-errorForeground)"
                                        : undefined,
                                }}>
                                {item.message}
                            </div>
                        </DataGridCell>
                    );
                }
            },
        }),
    ];
    const renderRow: RowRenderer<qr.IMessage> = ({ item, rowId }, style) => {
        return (
            <DataGridRow<qr.IMessage>
                key={rowId}
                className={classes.messagesRows}
                style={style}
                aria-label={locConstants.queryResult.message}
                role={locConstants.queryResult.message}
                aria-roledescription={locConstants.queryResult.message}>
                {({ renderCell }) => <>{renderCell(item)}</>}
            </DataGridRow>
        );
    };

    const [columns] = useState<TableColumnDefinition<qr.IMessage>[]>(columnsDef);
    const items: qr.IMessage[] = splitMessages(state?.messages) ?? [];

    const sizingOptions: TableColumnSizingOptions = {
        time: {
            minWidth: 100,
            idealWidth: 100,
            defaultWidth: 100,
        },
        message: {
            minWidth: 500,
            idealWidth: 500,
            defaultWidth: 500,
        },
    };

    const [columnSizingOption] = useState<TableColumnSizingOptions>(sizingOptions);

    const renderMessageGrid = () => {
        return (
            <DataGrid
                items={items}
                columns={columns}
                focusMode="cell"
                resizableColumns={true}
                columnSizingOptions={columnSizingOption}
                role={locConstants.queryResult.messages}
                aria-label={locConstants.queryResult.messages}
                aria-roledescription={locConstants.queryResult.messages}>
                <DataGridBody<qr.IMessage> itemSize={18} height={messageGridHeight}>
                    {renderRow}
                </DataGridBody>
            </DataGrid>
        );
    };
    //#endregion

    //#region Query Plan
    useEffect(() => {
        // gets execution plans
        if (
            context &&
            state &&
            state.isExecutionPlan &&
            state.uri &&
            state.executionPlanState &&
            !state.executionPlanState.executionPlanGraphs!.length
        ) {
            context.getExecutionPlan(state.uri);
        }
    }, [state?.executionPlanState?.xmlPlans]);
    //#endregion

    const getWebviewLocation = async () => {
        const res = await webViewState.extensionRpc.sendRequest(qr.GetWebviewLocationRequest.type, {
            uri: state?.uri,
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

    useEffect(() => {
        async function loadScrollPosition() {
            if (state?.uri) {
                isProgrammaticScroll.current = true;
                const position = await webViewState.extensionRpc.sendRequest(
                    qr.GetGridPaneScrollPositionRequest.type,
                    { uri: state.uri },
                );
                const el = scrollabelPanelRef.current;
                if (!el) return;

                requestAnimationFrame(() => {
                    el.scrollTo({
                        top: position.scrollTop ?? 0,
                        behavior: "instant",
                    });

                    setTimeout(() => {
                        isProgrammaticScroll.current = false;
                    }, 100);
                });
            }
        }

        setTimeout(() => {
            void loadScrollPosition();
        }, 10);
    }, [state?.uri]);

    return !state || !hasResultsOrMessages(state) ? (
        <div>
            <div className={classes.noResultMessage}>
                {locConstants.queryResult.noResultMessage}
            </div>
            <div>
                <Link
                    className={classes.hidePanelLink}
                    onClick={async () => {
                        await webViewState.extensionRpc.sendRequest(ExecuteCommandRequest.type, {
                            command: "workbench.action.closePanel",
                        });
                    }}>
                    {locConstants.queryResult.clickHereToHideThisPanel}
                </Link>
            </div>
        </div>
    ) : (
        <div className={classes.root} ref={resultPaneParentRef}>
            <div className={classes.ribbon} ref={ribbonRef}>
                <TabList
                    size="medium"
                    selectedValue={state.tabStates!.resultPaneTab}
                    onTabSelect={(_event, data) => {
                        context.setResultTab(data.value as qr.QueryResultPaneTabs);
                    }}
                    className={classes.queryResultPaneTabs}>
                    {Object.keys(state.resultSetSummaries).length > 0 && (
                        <Tab
                            value={qr.QueryResultPaneTabs.Results}
                            key={qr.QueryResultPaneTabs.Results}>
                            {locConstants.queryResult.results}
                        </Tab>
                    )}
                    <Tab
                        value={qr.QueryResultPaneTabs.Messages}
                        key={qr.QueryResultPaneTabs.Messages}>
                        {locConstants.queryResult.messages}
                    </Tab>
                    {Object.keys(state.resultSetSummaries).length > 0 && state.isExecutionPlan && (
                        <Tab
                            value={qr.QueryResultPaneTabs.ExecutionPlan}
                            key={qr.QueryResultPaneTabs.ExecutionPlan}>
                            {locConstants.queryResult.queryPlan}
                        </Tab>
                    )}
                </TabList>
                {webviewLocation === "panel" && (
                    <Button
                        icon={<OpenRegular />}
                        iconPosition="after"
                        appearance="subtle"
                        onClick={async () => {
                            await webViewState.extensionRpc.sendRequest(
                                qr.OpenInNewTabRequest.type,
                                {
                                    uri: state?.uri,
                                },
                            );
                        }}
                        title={locConstants.queryResult.openResultInNewTab}
                        style={{ marginTop: "4px", marginBottom: "4px" }}>
                        {locConstants.queryResult.openResultInNewTab}
                    </Button>
                )}
            </div>
            <div
                className={classes.tabContent}
                ref={scrollabelPanelRef}
                onScroll={(e) => {
                    if (isProgrammaticScroll.current) return;
                    const scrollTop = e.currentTarget.scrollTop;
                    void webViewState.extensionRpc.sendNotification(
                        qr.SetGridPaneScrollPositionNotification.type,
                        { uri: state?.uri, scrollTop },
                    );
                }}>
                {state.tabStates!.resultPaneTab === qr.QueryResultPaneTabs.Results &&
                    Object.keys(state.resultSetSummaries).length > 0 &&
                    renderResultPanel()}
                {state.tabStates!.resultPaneTab === qr.QueryResultPaneTabs.Messages && (
                    <div
                        className={classes.messagesContainer}
                        data-vscode-context={JSON.stringify({
                            webviewSection: "queryResultMessagesPane",
                            uri: state?.uri,
                        })}>
                        {renderMessageGrid()}
                    </div>
                )}
                {state.tabStates!.resultPaneTab === qr.QueryResultPaneTabs.ExecutionPlan &&
                    state.isExecutionPlan && (
                        <div
                            id={"executionPlanResultsTab"}
                            className={classes.queryResultContainer}
                            style={{ height: "100%", minHeight: "300px" }}>
                            <ExecutionPlanStateProvider>
                                <ExecutionPlanPage />
                            </ExecutionPlanStateProvider>
                        </div>
                    )}
            </div>
        </div>
    );
};
