/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Divider,
    Link,
    Tab,
    TabList,
    Table,
    TableBody,
    TableCell,
    TableColumnDefinition,
    TableColumnSizingOptions,
    TableRow,
    createTableColumn,
    makeStyles,
    shorthands,
    useTableColumnSizing_unstable,
    useTableFeatures,
} from "@fluentui/react-components";
import { useContext, useEffect, useRef, useState } from "react";
import { OpenFilled } from "@fluentui/react-icons";
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
        height: "18px",
        fontSize: "12px",
        flexDirection: "row",
        ...shorthands.padding("10px"),
        "> *": {
            marginRight: "10px",
        },
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
    gridParent: HTMLDivElement,
    ribbonRef: HTMLDivElement,
) {
    return gridParent.clientHeight - ribbonRef.clientHeight;
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
    const columnsDef: TableColumnDefinition<qr.IMessage>[] = [
        createTableColumn({
            columnId: "time",
            renderHeaderCell: () => <>{locConstants.queryResult.timestamp}</>,
        }),
        createTableColumn({
            columnId: "message",
            renderHeaderCell: () => <>{locConstants.queryResult.message}</>,
        }),
    ];
    const gridParentRef = useRef<HTMLDivElement>(null);
    const ribbonRef = useRef<HTMLDivElement>(null);
    // Resize grid when parent element resizes
    useEffect(() => {
        let gridCount = 0;
        Object.values(metadata?.resultSetSummaries ?? []).forEach((v) => {
            gridCount += Object.keys(v).length;
        });
        if (gridCount === 0) {
            return; // Exit if there are no grids to render
        }

        const gridParent = gridParentRef.current;
        if (!gridParent) {
            return;
        }
        const observer = new ResizeObserver(() => {
            if (!gridRefs.current || !ribbonRef.current) {
                return;
            }

            const availableHeight = getAvailableHeight(
                gridParent,
                ribbonRef.current,
            );

            if (gridParent.clientWidth && availableHeight) {
                if (gridCount > 1) {
                    let scrollbarAdjustment =
                        gridCount * MIN_GRID_HEIGHT >= availableHeight
                            ? SCROLLBAR_PX
                            : 0;

                    // Calculate the grid height, ensuring it's not smaller than the minimum height
                    const gridHeight = Math.max(
                        (availableHeight - gridCount * TABLE_ALIGN_PX) /
                            gridCount,
                        MIN_GRID_HEIGHT,
                    );

                    gridRefs.current.forEach((gridRef) => {
                        gridRef?.resizeGrid(
                            gridParent.clientWidth -
                                ACTIONBAR_WIDTH_PX -
                                scrollbarAdjustment,
                            gridHeight,
                        );
                    });
                } else if (gridCount === 1) {
                    gridRefs.current[0]?.resizeGrid(
                        gridParent.clientWidth - ACTIONBAR_WIDTH_PX,
                        availableHeight - TABLE_ALIGN_PX,
                    );
                }
            }
        });

        observer.observe(gridParent);

        return () => observer.disconnect();
    }, [metadata?.resultSetSummaries]);
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
    const { getRows, columnSizing_unstable, tableRef } = useTableFeatures(
        {
            columns,
            items: items,
        },
        [
            useTableColumnSizing_unstable({
                columnSizingOptions: columnSizingOption,
            }),
        ],
    );
    const rows = getRows();

    const gridRefs = useRef<ResultGridHandle[]>([]);

    const renderGrid = (
        batchId: number,
        resultId: number,
        gridCount: number,
    ) => {
        const divId = `grid-parent-${batchId}-${resultId}`;
        return (
            <div id={divId} className={classes.queryResultContainer}>
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
                                // if the result is an execution plan xml,
                                // get the execution plan graph from it
                                if (metadata?.isExecutionPlan) {
                                    state?.provider.addXmlPlan(
                                        r.rows[0][0].displayValue,
                                    );
                                }
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
                    divId={divId}
                    uri={metadata?.uri}
                    webViewState={webViewState}
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
        // execution plans only load after reading the resulting xml showplan
        // of the query. therefore, it updates the state once the results
        // are loaded, which causes a rendering loop if the grid
        // gets refreshed
        if (!metadata?.isExecutionPlan) {
            gridRefs.current.forEach((r) => r?.refreshGrid());
        }

        let count = 0;
        for (
            let i = 0;
            i < Object.keys(metadata?.resultSetSummaries ?? []).length;
            i++
        ) {
            var batch = metadata?.resultSetSummaries[i];
            for (let j = 0; j < Object.keys(batch ?? []).length; j++) {
                grids.push(renderGrid(i, j, count));
                count++;
            }
        }
        return grids;
    };

    useEffect(() => {
        if (
            // makes sure state is defined
            metadata &&
            // makes sure result sets are defined
            metadata.resultSetSummaries &&
            // makes sure this is an execution plan
            metadata.isExecutionPlan &&
            // makes sure the xml plans set by results are defined
            metadata.executionPlanState.xmlPlans &&
            // makes sure xml plans have been fully updated- necessary for multiple results sets
            Object.keys(metadata.resultSetSummaries).length ===
                metadata.executionPlanState.xmlPlans.length &&
            // checks that we haven't already gotten the graphs
            metadata.executionPlanState?.executionPlanGraphs &&
            !metadata.executionPlanState.executionPlanGraphs.length
        ) {
            // get execution plan graphs
            state!.provider.getExecutionPlan(
                metadata.executionPlanState.xmlPlans,
            );
        }
    });

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
        <div className={classes.root} ref={gridParentRef}>
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
                {false && ( // hide divider until we implement snapshot
                    <Divider
                        vertical
                        style={{
                            flex: "0",
                        }}
                    />
                )}
                {false && ( // hide button until we implement snapshot
                    <Button
                        appearance="transparent"
                        icon={<OpenFilled />}
                        onClick={async () => {
                            console.log("todo: open in new tab");
                            // gridRef.current.refreshGrid();
                        }}
                        title={locConstants.queryResult.openSnapshot}
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
                    <div className={classes.messagesContainer}>
                        <Table
                            size="small"
                            as="table"
                            {...columnSizing_unstable.getTableProps()}
                            ref={tableRef}
                        >
                            <TableBody>
                                {rows.map((row, index) => {
                                    return (
                                        <TableRow
                                            key={index}
                                            className={classes.messagesRows}
                                        >
                                            <TableCell
                                                {...columnSizing_unstable.getTableCellProps(
                                                    "time",
                                                )}
                                            >
                                                {row.item.batchId === undefined
                                                    ? row.item.time
                                                    : null}
                                            </TableCell>
                                            <TableCell
                                                {...columnSizing_unstable.getTableCellProps(
                                                    "message",
                                                )}
                                            >
                                                {row.item.message}
                                                {row.item.link?.text &&
                                                    row.item.selection && (
                                                        <>
                                                            {" "}
                                                            <Link
                                                                onClick={async () => {
                                                                    await webViewState.extensionRpc.call(
                                                                        "setEditorSelection",
                                                                        {
                                                                            uri: metadata?.uri,
                                                                            selectionData:
                                                                                row
                                                                                    .item
                                                                                    .selection,
                                                                        },
                                                                    );
                                                                }}
                                                            >
                                                                {
                                                                    row.item
                                                                        ?.link
                                                                        ?.text
                                                                }
                                                            </Link>
                                                        </>
                                                    )}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}
                {metadata.tabStates!.resultPaneTab ===
                    qr.QueryResultPaneTabs.ExecutionPlan &&
                    Object.keys(metadata.resultSetSummaries).length > 0 && (
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
