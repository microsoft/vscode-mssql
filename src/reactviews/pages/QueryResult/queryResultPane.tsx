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
import { ExecutionPlanGraphInfo } from "../ExecutionPlan/executionPlanInterfaces";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import ResultGrid, { ResultGridHandle } from "./resultGrid";
import CommandBar from "./commandBar";
import { locConstants } from "../../common/locConstants";
import { ExecutionPlanPage } from "../ExecutionPlan/executionPlanPage";

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
        flexDirection: "row",
        ...shorthands.padding("10px"),
        "> *": {
            marginRight: "10px",
        },
    },
});

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
        const gridParent = gridParentRef.current;
        if (!gridParent) {
            return;
        }
        const observer = new ResizeObserver(() => {
            if (!gridRef.current) {
                return;
            }
            if (!ribbonRef.current) {
                return;
            }
            if (gridParent.clientWidth && gridParent.clientHeight) {
                gridRef.current.resizeGrid(
                    gridParent.clientWidth,
                    gridParent.clientHeight -
                        ribbonRef.current.clientHeight -
                        5,
                );
            }
        });
        observer.observe(gridParent);
        return () => observer.disconnect();
    }, []);
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

    if (!metadata) {
        return null;
    }

    const gridRef = useRef<ResultGridHandle>(null);

    const renderGrid = (idx: number) => {
        const divId = `grid-parent-${idx}`;
        return (
            <div
                id={divId}
                className={classes.queryResultContainer}
                style={{
                    height:
                        Object.keys(metadata?.resultSetSummaries ?? [])
                            .length === 1
                            ? "100%"
                            : "50%",
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
                                batchId:
                                    metadata?.resultSetSummaries[idx]?.batchId,
                                resultId: metadata?.resultSetSummaries[idx]?.id,
                                rowStart: offset,
                                numberOfRows: count,
                            })
                            .then((response) => {
                                if (!response) {
                                    return [];
                                }
                                let r = response as qr.ResultSetSubset;
                                var columnLength =
                                    metadata?.resultSetSummaries[idx]
                                        ?.columnInfo?.length;
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
                    ref={gridRef}
                    resultSetSummary={metadata?.resultSetSummaries[idx]}
                    divId={divId}
                />
                <CommandBar
                    uri={metadata?.uri}
                    resultSetSummary={metadata?.resultSetSummaries[idx]}
                />
            </div>
        );
    };

    const renderGridPanel = () => {
        const grids = [];
        for (
            let i = 0;
            i < Object.keys(metadata?.resultSetSummaries ?? []).length;
            i++
        ) {
            grids.push(renderGrid(i));
        }
        return grids;
    };

    useEffect(() => {
        const getExecutionPlanGraphs = (contents: string) => {
            if (
                metadata &&
                metadata.executionPlanState?.executionPlanGraphs &&
                !metadata.executionPlanState.executionPlanGraphs.length
            ) {
                let planFile: ExecutionPlanGraphInfo = {
                    graphFileContent: contents,
                    graphFileType: ".sqlplan",
                };

                state!.provider.getExecutionPlan(planFile);
            }
        };

        if (
            metadata &&
            metadata.resultSetSummaries &&
            metadata.executionPlanState.xmlPlans &&
            Object.keys(metadata.resultSetSummaries).length > 0 &&
            Object.keys(metadata.resultSetSummaries).length ===
                metadata.executionPlanState.xmlPlans.length
        ) {
            getExecutionPlanGraphs(
                mergePlans(metadata.executionPlanState.xmlPlans),
            );
        }
    });

    return (
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
                                        <TableRow key={index}>
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
                            <ExecutionPlanPage context={state} />
                        </div>
                    )}
            </div>
        </div>
    );
};

function mergePlans(sqlPlanContents: string[]): string {
    let combinedXmls = sqlPlanContents[0];

    // If there's only one XML, return it as is
    if (sqlPlanContents.length === 1) {
        return combinedXmls;
    }

    // else, compile the xmls of each statment into one
    for (let i = 1; i < sqlPlanContents.length; i++) {
        const plan = sqlPlanContents[i];

        // insert each plan's sql statement xml into the combined plan
        // and then update the id
        let statements = plan.match(/<StmtSimple[\s\S]*?<\/StmtSimple>/g);
        if (statements) {
            statements.forEach((statement) => {
                statement = statement.replace(
                    /StatementId="\d+"/,
                    `StatementId="${i + 1}"`,
                );
                statement = statement.replace(
                    /StatementCompId="\d+"/,
                    `StatementCompId="${i + 1}"`,
                );

                const lastStmtSimpleIndex =
                    combinedXmls.lastIndexOf("</StmtSimple>") +
                    "</StmtSimple>".length;

                combinedXmls =
                    combinedXmls.slice(0, lastStmtSimpleIndex) +
                    statement +
                    combinedXmls.slice(lastStmtSimpleIndex);
            });
        }
    }
    return combinedXmls;
}
