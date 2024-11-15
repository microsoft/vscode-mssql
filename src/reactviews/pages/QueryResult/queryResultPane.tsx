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
import { useContext, useEffect, useRef, useState } from "react";
import { OpenRegular } from "@fluentui/react-icons";
import { QueryResultContext } from "./queryResultStateProvider";
import * as qr from "../../../sharedInterfaces/queryResult";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import ResultGrid, { ResultGridHandle } from "./resultGrid";
import CommandBar from "./commandBar";
import { locConstants } from "../../common/locConstants";
import {
    ACTIONBAR_WIDTH_PX,
    SCROLLBAR_PX,
    TABLE_ALIGN_PX,
} from "./table/table";
import { ExecutionPlanPage } from "../ExecutionPlan/executionPlanPage";
import { ExecutionPlanStateProvider } from "../ExecutionPlan/executionPlanStateProvider";
import { hasResultsOrMessages } from "./queryResultUtils";

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
        fontFamily: "Menlo, Monaco, 'Courier New', monospace",
        fontWeight: "normal",
        fontSize: "12px",
    },
    queryResultPaneOpenButton: {
        position: "absolute",
        top: "0px",
        right: "0px",
    },
    messagesContainer: {
        width: "100%",
        height: "100%",
        flexDirection: "column",
        "> *": {
            marginBottom: "10px",
        },
    },
    messagesRows: {
        lineHeight: "18px",
        fontSize: "12px",
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

function getAvailableHeight(
    resultPaneParent: HTMLDivElement,
    ribbonRef: HTMLDivElement,
) {
    return resultPaneParent.clientHeight - ribbonRef.clientHeight;
}

export const QueryResultPane = () => {
    const classes = useStyles();
    const state = useContext(QueryResultContext);
    const webViewState = useVscodeWebview<
        qr.QueryResultWebviewState,
        qr.QueryResultReducers
    >();
    webViewState;
    var metadata = state?.state;
    const resultPaneParentRef = useRef<HTMLDivElement>(null);
    const ribbonRef = useRef<HTMLDivElement>(null);
    const gridParentRef = useRef<HTMLDivElement>(null);
    const [messageGridHeight, setMessageGridHeight] = useState(0);
    // Resize grid when parent element resizes
    useEffect(() => {
        let gridCount = 0;
        Object.values(metadata?.resultSetSummaries ?? []).forEach((v) => {
            gridCount += Object.keys(v).length;
        });
        if (gridCount === 0) {
            return; // Exit if there are no grids to render
        }

        const resultPaneParent = resultPaneParentRef.current;
        if (!resultPaneParent) {
            return;
        }
        const observer = new ResizeObserver(() => {
            if (!gridRefs.current || !ribbonRef.current) {
                return;
            }

            const availableHeight = getAvailableHeight(
                resultPaneParent,
                ribbonRef.current,
            );
            setMessageGridHeight(availableHeight);
            if (resultPaneParent.clientWidth && availableHeight) {
                const gridHeight = calculateGridHeight(
                    gridCount,
                    availableHeight,
                );
                const gridWidth = calculateGridWidth(
                    resultPaneParent,
                    gridCount,
                    availableHeight,
                );
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
    }, [metadata?.resultSetSummaries, resultPaneParentRef.current]);

    const calculateGridHeight = (
        gridCount: number,
        availableHeight: number,
    ) => {
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
                gridCount * MIN_GRID_HEIGHT >= availableHeight
                    ? SCROLLBAR_PX
                    : 0;

            return (
                resultPaneParent.clientWidth -
                ACTIONBAR_WIDTH_PX -
                scrollbarAdjustment
            );
        }
        // gridCount is 1
        return resultPaneParent.clientWidth - ACTIONBAR_WIDTH_PX;
    };

    const linkHandler = (fileContent: string, fileType: string) => {
        if (state) {
            state.provider.openFileThroughLink(fileContent, fileType);
        }
    };

    //#region Result Grid
    const gridRefs = useRef<ResultGridHandle[]>([]);
    const renderGrid = (
        batchId: number,
        resultId: number,
        gridCount: number,
    ) => {
        const divId = `grid-parent-${batchId}-${resultId}`;
        return (
            <div
                id={divId}
                className={classes.queryResultContainer}
                ref={gridParentRef}
                style={{
                    height:
                        resultPaneParentRef.current && ribbonRef.current
                            ? `${calculateGridHeight(
                                  getAvailableHeight(
                                      resultPaneParentRef.current!,
                                      ribbonRef.current!,
                                  ) - TABLE_ALIGN_PX,
                                  gridCount,
                              )}px`
                            : "",
                }}
            >
                <ResultGrid
                    loadFunc={(
                        offset: number,
                        count: number,
                    ): Thenable<any[]> => {
                        return webViewState.extensionRpc
                            .call("getRows", {
                                uri: metadata?.uri,
                                batchId: batchId,
                                resultId: resultId,
                                rowStart: offset,
                                numberOfRows: count,
                            })
                            .then((response) => {
                                if (!response) {
                                    return [];
                                }
                                let r = response as qr.ResultSetSubset;
                                var columnLength =
                                    metadata?.resultSetSummaries[batchId][
                                        resultId
                                    ]?.columnInfo?.length;
                                return r.rows.map((r) => {
                                    let dataWithSchema: {
                                        [key: string]: any;
                                    } = {};
                                    // skip the first column since its a number column
                                    for (
                                        let i = 1;
                                        columnLength && i < columnLength + 1;
                                        i++
                                    ) {
                                        const displayValue =
                                            r[i - 1].displayValue ?? "";
                                        const ariaLabel = displayValue;
                                        dataWithSchema[(i - 1).toString()] = {
                                            displayValue: displayValue,
                                            ariaLabel: ariaLabel,
                                            isNull: r[i - 1].isNull,
                                            invariantCultureDisplayValue:
                                                displayValue,
                                        };
                                    }
                                    return dataWithSchema;
                                });
                            });
                    }}
                    ref={(gridRef) => (gridRefs.current[gridCount] = gridRef!)}
                    resultSetSummary={
                        metadata?.resultSetSummaries[batchId][resultId]
                    }
                    gridParentRef={gridParentRef}
                    uri={metadata?.uri}
                    webViewState={webViewState}
                    linkHandler={linkHandler}
                />
                <CommandBar
                    uri={metadata?.uri}
                    resultSetSummary={
                        metadata?.resultSetSummaries[batchId][resultId]
                    }
                />
            </div>
        );
    };

    const renderGridPanel = () => {
        const grids = [];
        gridRefs.current.forEach((r) => r?.refreshGrid());
        let count = 0;
        for (const batchIdStr in metadata?.resultSetSummaries ?? {}) {
            const batchId = parseInt(batchIdStr);
            for (const resultIdStr in metadata?.resultSetSummaries[batchId] ??
                {}) {
                const resultId = parseInt(resultIdStr);
                grids.push(renderGrid(batchId, resultId, count));
                count++;
            }
        }
        return grids;
    };
    //#endregion

    //#region Message Grid
    const columnsDef: TableColumnDefinition<qr.IMessage>[] = [
        createTableColumn({
            columnId: "time",
            renderHeaderCell: () => <>{locConstants.queryResult.timestamp}</>,
            renderCell: (item) => (
                <>{item.batchId === undefined ? item.time : null}</>
            ),
        }),
        createTableColumn({
            columnId: "message",
            renderHeaderCell: () => <>{locConstants.queryResult.message}</>,
            renderCell: (item) => {
                if (item.link?.text && item.selection) {
                    return (
                        <div>
                            {item.message}{" "}
                            <Link
                                onClick={async () => {
                                    await webViewState.extensionRpc.call(
                                        "setEditorSelection",
                                        {
                                            uri: metadata?.uri,
                                            selectionData: item.selection,
                                        },
                                    );
                                }}
                                inline
                                style={{ fontSize: "12px" }}
                            >
                                {item?.link?.text}
                            </Link>
                        </div>
                    );
                } else {
                    return <>{item.message}</>;
                }
            },
        }),
    ];
    const renderRow: RowRenderer<qr.IMessage> = ({ item, rowId }, style) => (
        <DataGridRow<qr.IMessage>
            key={rowId}
            style={style}
            className={classes.messagesRows}
        >
            {({ renderCell }) => (
                <DataGridCell focusMode="group" style={{ minHeight: "18px" }}>
                    {renderCell(item)}
                </DataGridCell>
            )}
        </DataGridRow>
    );

    const [columns] =
        useState<TableColumnDefinition<qr.IMessage>[]>(columnsDef);
    const items = metadata?.messages ?? [];

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

    const [columnSizingOption] =
        useState<TableColumnSizingOptions>(sizingOptions);

    const renderMessageGrid = () => {
        return (
            <DataGrid
                items={items}
                columns={columns}
                focusMode="cell"
                resizableColumns
                columnSizingOptions={columnSizingOption}
            >
                <DataGridBody<qr.IMessage>
                    itemSize={18}
                    height={messageGridHeight}
                >
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
            state &&
            metadata &&
            metadata.isExecutionPlan &&
            metadata.uri &&
            metadata.executionPlanState &&
            !metadata.executionPlanState.executionPlanGraphs!.length
        ) {
            state.provider.getExecutionPlan(metadata.uri);
        }
    }, [metadata?.executionPlanState?.xmlPlans]);
    //#endregion

    const getWebviewLocation = async () => {
        const res = (await webViewState.extensionRpc.call(
            "getWebviewLocation",
            {
                uri: metadata?.uri,
            },
        )) as string;
        setWebviewLocation(res);
    };
    const [webviewLocation, setWebviewLocation] = useState("");
    useEffect(() => {
        getWebviewLocation().catch((e) => {
            console.error(e);
            setWebviewLocation("panel");
        });
    }, []);

    return !metadata || !hasResultsOrMessages(metadata) ? (
        <div>
            <div className={classes.noResultMessage}>
                {locConstants.queryResult.noResultMessage}
            </div>
            <div>
                <Link
                    className={classes.hidePanelLink}
                    onClick={async () => {
                        await webViewState.extensionRpc.call("executeCommand", {
                            command: "workbench.action.togglePanel",
                        });
                    }}
                >
                    {locConstants.queryResult.clickHereToHideThisPanel}
                </Link>
            </div>
        </div>
    ) : (
        <div className={classes.root} ref={resultPaneParentRef}>
            <div className={classes.ribbon} ref={ribbonRef}>
                <TabList
                    size="medium"
                    selectedValue={metadata.tabStates!.resultPaneTab}
                    onTabSelect={(_event, data) => {
                        state?.provider.setResultTab(
                            data.value as qr.QueryResultPaneTabs,
                        );
                    }}
                    className={classes.queryResultPaneTabs}
                >
                    {Object.keys(metadata.resultSetSummaries).length > 0 && (
                        <Tab
                            value={qr.QueryResultPaneTabs.Results}
                            key={qr.QueryResultPaneTabs.Results}
                        >
                            {locConstants.queryResult.results}
                        </Tab>
                    )}
                    <Tab
                        value={qr.QueryResultPaneTabs.Messages}
                        key={qr.QueryResultPaneTabs.Messages}
                    >
                        {locConstants.queryResult.messages}
                    </Tab>
                    {Object.keys(metadata.resultSetSummaries).length > 0 &&
                        metadata.isExecutionPlan && (
                            <Tab
                                value={qr.QueryResultPaneTabs.ExecutionPlan}
                                key={qr.QueryResultPaneTabs.ExecutionPlan}
                            >
                                {locConstants.queryResult.queryPlan}
                            </Tab>
                        )}
                </TabList>
                {webviewLocation === "panel" && (
                    <Button
                        icon={<OpenRegular />}
                        appearance="subtle"
                        onClick={async () => {
                            await webViewState.extensionRpc.call(
                                "openInNewTab",
                                {
                                    uri: metadata?.uri,
                                },
                            );
                        }}
                        title={locConstants.queryResult.openResultInNewTab}
                    ></Button>
                )}
            </div>
            <div className={classes.tabContent}>
                {metadata.tabStates!.resultPaneTab ===
                    qr.QueryResultPaneTabs.Results &&
                    Object.keys(metadata.resultSetSummaries).length > 0 &&
                    renderGridPanel()}
                {metadata.tabStates!.resultPaneTab ===
                    qr.QueryResultPaneTabs.Messages && (
                    <div
                        className={classes.messagesContainer}
                        data-vscode-context={JSON.stringify({
                            webviewSection: "queryResultMessagesPane",
                            uri: metadata?.uri,
                        })}
                    >
                        {renderMessageGrid()}
                    </div>
                )}
                {metadata.tabStates!.resultPaneTab ===
                    qr.QueryResultPaneTabs.ExecutionPlan &&
                    metadata.isExecutionPlan && (
                        <div
                            id={"executionPlanResultsTab"}
                            className={classes.queryResultContainer}
                            style={{ height: "100%", minHeight: "300px" }}
                        >
                            <ExecutionPlanStateProvider>
                                <ExecutionPlanPage />
                            </ExecutionPlanStateProvider>
                        </div>
                    )}
            </div>
        </div>
    );
};
