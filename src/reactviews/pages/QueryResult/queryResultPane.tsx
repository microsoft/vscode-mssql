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
import SlickGrid, { SlickGridHandle } from "./slickgrid";
import * as l10n from "@vscode/l10n";
import CommandBar from "./commandBar";

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
        display: "flex",
        ...shorthands.overflow("auto"),
    },
    queryResultContainer: {
        width: "100%",
        height: "100%",
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

const RESULTS = l10n.t("Results");
const MESSAGES = l10n.t("Messages");
const TIMESTAMP = l10n.t("Timestamp");
const MESSAGE = l10n.t("Message");
const OPEN_SNAPSHOT_IN_NEW_TAB = l10n.t("Open snapshot in new tab");

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
            renderHeaderCell: () => <>{TIMESTAMP}</>,
        }),
        createTableColumn({
            columnId: "message",
            renderHeaderCell: () => <>{MESSAGE}</>,
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

    const gridRef = useRef<SlickGridHandle>(null);

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
                    {metadata.resultSetSummary && (
                        <Tab
                            value={qr.QueryResultPaneTabs.Results}
                            key={qr.QueryResultPaneTabs.Results}
                        >
                            {RESULTS}
                        </Tab>
                    )}
                    <Tab
                        value={qr.QueryResultPaneTabs.Messages}
                        key={qr.QueryResultPaneTabs.Messages}
                    >
                        {MESSAGES}
                    </Tab>
                </TabList>
                {metadata.tabStates!.resultPaneTab ==
                    qr.QueryResultPaneTabs.Results && (
                    <Divider
                        vertical
                        style={{
                            flex: "0",
                        }}
                    />
                )}

                {
                    <Button
                        appearance="transparent"
                        icon={<OpenFilled />}
                        onClick={async () => {
                            console.log("todo: open in new tab");
                            // gridRef.current.refreshGrid();
                        }}
                        title={OPEN_SNAPSHOT_IN_NEW_TAB}
                    ></Button>
                }
            </div>
            <div className={classes.tabContent}>
                {metadata.tabStates!.resultPaneTab ===
                    qr.QueryResultPaneTabs.Results &&
                    metadata.resultSetSummary && (
                        <div
                            id={"grid-parent"}
                            className={classes.queryResultContainer}
                        >
                            <SlickGrid
                                loadFunc={(
                                    offset: number,
                                    count: number,
                                ): Thenable<any[]> => {
                                    return webViewState.extensionRpc
                                        .call("getRows", {
                                            uri: metadata?.uri,
                                            batchId:
                                                metadata?.resultSetSummary
                                                    ?.batchId,
                                            resultId:
                                                metadata?.resultSetSummary?.id,
                                            rowStart: offset,
                                            numberOfRows: count,
                                        })
                                        .then((response) => {
                                            if (!response) {
                                                return [];
                                            }
                                            let r =
                                                response as qr.ResultSetSubset;
                                            var columnLength =
                                                metadata?.resultSetSummary
                                                    ?.columnInfo?.length;
                                            return r.rows.map((r) => {
                                                let dataWithSchema: {
                                                    [key: string]: any;
                                                } = {};
                                                // skip the first column since its a number column
                                                for (
                                                    let i = 1;
                                                    columnLength &&
                                                    i < columnLength + 1;
                                                    i++
                                                ) {
                                                    const displayValue =
                                                        r[i - 1].displayValue ??
                                                        "";
                                                    const ariaLabel =
                                                        displayValue;
                                                    dataWithSchema[
                                                        (i - 1).toString()
                                                    ] = {
                                                        displayValue:
                                                            displayValue,
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
                                resultSetSummary={metadata.resultSetSummary}
                            />
                            <CommandBar />
                        </div>
                    )}
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
            </div>
        </div>
    );
};
