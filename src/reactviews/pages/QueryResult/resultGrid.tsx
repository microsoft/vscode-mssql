/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import $ from "jquery";
import { forwardRef, useContext, useEffect, useImperativeHandle, useRef, useState } from "react";
import "../../media/slickgrid.css";
import { ACTIONBAR_WIDTH_PX, range, Table } from "./table/table";
import { defaultTableStyles } from "./table/interfaces";
import { RowNumberColumn } from "./table/plugins/rowNumberColumn.plugin";
import { VirtualizedCollection } from "./table/asyncDataView";
import { HybridDataProvider } from "./table/hybridDataProvider";
import { hyperLinkFormatter, textFormatter, DBCellValue, escape } from "./table/formatters";
import {
    DbCellValue,
    QueryResultReducers,
    QueryResultWebviewState,
    ResultSetSummary,
} from "../../../sharedInterfaces/queryResult";
import * as DOM from "./table/dom";
import { locConstants } from "../../common/locConstants";
import { VscodeWebviewContext } from "../../common/vscodeWebviewProvider";
import { QueryResultContext } from "./queryResultStateProvider";
import { LogCallback } from "../../../sharedInterfaces/webview";

window.jQuery = $ as any;
require("slickgrid/lib/jquery.event.drag-2.3.0.js");
require("slickgrid/lib/jquery-1.11.2.min.js");
require("slickgrid/slick.core.js");
require("slickgrid/slick.grid.js");
require("slickgrid/plugins/slick.cellrangedecorator.js");

declare global {
    interface Window {
        $: any;
        jQuery: any;
    }
}

export interface ResultGridProps {
    loadFunc: (offset: number, count: number) => Thenable<any[]>;
    resultSetSummary?: ResultSetSummary;
    divId?: string;
    uri?: string;
    webViewState?: VscodeWebviewContext<QueryResultWebviewState, QueryResultReducers>;
    gridParentRef?: React.RefObject<HTMLDivElement>;
    linkHandler: (fileContent: string, fileType: string) => void;
    gridId: string;
}

export interface ResultGridHandle {
    refreshGrid: () => void;
    resizeGrid: (width: number, height: number) => void;
    hideGrid: () => void;
    showGrid: () => void;
}

const ResultGrid = forwardRef<ResultGridHandle, ResultGridProps>((props: ResultGridProps, ref) => {
    const context = useContext(QueryResultContext);
    if (!context) {
        return undefined;
    }

    const gridContainerRef = useRef<HTMLDivElement>(null);
    const tableRef = useRef<Table<any> | undefined>();
    const currentResultSetRef = useRef<ResultSetSummary | undefined>();
    const dataProviderRef = useRef<any>();
    const collectionRef = useRef<any>();
    const [refreshKey, setRefreshKey] = useState(0);

    if (!props.gridParentRef) {
        return undefined;
    }
    // Smart update function that updates the table without recreation
    const updateResult = (resultSet: ResultSetSummary) => {
        if (tableRef.current && currentResultSetRef.current) {
            // Check if this is the same result set structure
            const current = currentResultSetRef.current;
            const isSameStructure =
                current.id === resultSet.id &&
                current.batchId === resultSet.batchId &&
                current.columnInfo.length === resultSet.columnInfo.length &&
                current.columnInfo.every(
                    (col, index) =>
                        col.columnName === resultSet.columnInfo[index]?.columnName &&
                        col.isXml === resultSet.columnInfo[index]?.isXml &&
                        col.isJson === resultSet.columnInfo[index]?.isJson,
                );

            if (isSameStructure) {
                // Avoid infinite loops - don't process if row count hasn't actually changed
                if (current.rowCount === resultSet.rowCount) {
                    console.log(`Skipping update - row count unchanged: ${resultSet.rowCount}`);
                    return true;
                }

                console.log(
                    `Updating row count for result set ${resultSet.batchId}-${resultSet.id}: ${current.rowCount} → ${resultSet.rowCount}`,
                );

                // Update the stored result set
                currentResultSetRef.current = resultSet;

                // Update the data provider length and refresh the table
                const dataProvider = dataProviderRef.current;
                const collection = collectionRef.current;
                console.log("dataProvider exists:", !!dataProvider);
                console.log("collection exists:", !!collection);

                if (collection) {
                    const oldLength = collection.getLength();
                    console.log(
                        `Current lengths - oldLength: ${oldLength}, newLength: ${resultSet.rowCount}`,
                    );
                    collection.setLength(resultSet.rowCount);

                    // If we have new rows, trigger loading for them
                    if (resultSet.rowCount > oldLength) {
                        const newRowStart = Math.max(0, oldLength);
                        const newRowCount = resultSet.rowCount - oldLength;
                        console.log(
                            `Triggering load for new rows: ${newRowStart} to ${newRowStart + newRowCount - 1}`,
                        );

                        // Special handling for first time getting data (0 -> positive rows)
                        const isFirstTimeGettingData = oldLength === 0 && resultSet.rowCount > 0;
                        console.log(
                            `About to set timeout - isFirstTimeGettingData: ${isFirstTimeGettingData}, oldLength: ${oldLength}, newRowCount: ${resultSet.rowCount}`,
                        );

                        // Trigger loading by accessing new rows directly
                        setTimeout(
                            () => {
                                console.log(
                                    `setTimeout callback executing, isFirstTimeGettingData: ${isFirstTimeGettingData}`,
                                );
                                console.log(`tableRef.current exists: ${!!tableRef.current}`);

                                if (tableRef.current) {
                                    if (isFirstTimeGettingData) {
                                        // For first time data, do full initialization like we do for new tables
                                        console.log(
                                            "First time getting data - doing full initialization",
                                        );
                                        tableRef.current.updateRowCount();
                                        tableRef.current.grid.invalidateAllRows();
                                        tableRef.current.grid.render();

                                        const viewport = tableRef.current.grid.getViewport();
                                        console.log("Viewport:", viewport);
                                        if (viewport) {
                                            console.log(
                                                `Loading initial viewport: rows ${viewport.top} to ${viewport.bottom}`,
                                            );
                                            for (
                                                let i = viewport.top;
                                                i <=
                                                Math.min(viewport.bottom, resultSet.rowCount - 1);
                                                i++
                                            ) {
                                                console.log(`Requesting data item ${i}`);
                                                const item = tableRef.current.grid.getDataItem(i);
                                                console.log(`Got data item ${i}:`, item);
                                            }
                                        }
                                    } else {
                                        // Normal incremental loading for new rows
                                        console.log("Loading incremental new rows");
                                        for (
                                            let i = newRowStart;
                                            i < Math.min(newRowStart + 50, resultSet.rowCount);
                                            i++
                                        ) {
                                            console.log(`Requesting new data item ${i}`);
                                            tableRef.current.grid.getDataItem(i);
                                        }
                                    }

                                    // Invalidate the new rows to trigger rendering
                                    const refreshedRows = range(
                                        newRowStart,
                                        newRowStart + newRowCount,
                                    );
                                    console.log("Invalidating rows:", refreshedRows);
                                    tableRef.current.invalidateRows(refreshedRows, true);
                                } else {
                                    console.log("tableRef.current is null in setTimeout callback");
                                }
                            },
                            isFirstTimeGettingData ? 100 : 0,
                        ); // Longer timeout for first time
                    }
                }

                // Update the table row count and trigger refresh
                tableRef.current.updateRowCount();

                // Force the table to refresh its viewport to load visible data
                if (resultSet.rowCount > 0) {
                    // Trigger data loading for currently visible rows
                    const visibleRange = tableRef.current.grid.getViewport();
                    if (visibleRange) {
                        // Force data loading by accessing visible row data
                        setTimeout(() => {
                            if (tableRef.current) {
                                for (
                                    let i = visibleRange.top;
                                    i <= Math.min(visibleRange.bottom, resultSet.rowCount - 1);
                                    i++
                                ) {
                                    tableRef.current.grid.getDataItem(i);
                                }

                                // Invalidate visible rows to trigger rendering
                                const visibleRows = range(
                                    visibleRange.top,
                                    Math.min(visibleRange.bottom + 1, resultSet.rowCount),
                                );
                                tableRef.current.invalidateRows(visibleRows, true);
                            }
                        }, 0);
                    }
                }

                return true; // Updated existing table
            }
        }

        return false; // Need to create new table
    };

    const refreshGrid = () => {
        if (gridContainerRef.current) {
            while (gridContainerRef.current.firstChild) {
                gridContainerRef.current.removeChild(gridContainerRef.current.firstChild);
            }
        }
        tableRef.current = undefined;
        dataProviderRef.current = undefined;
        collectionRef.current = undefined;
        currentResultSetRef.current = undefined;
    };
    const resizeGrid = (width: number, height: number) => {
        if (!tableRef.current) {
            context.log("resizeGrid - table is not initialized");
            refreshGrid();
            setRefreshKey(refreshKey + 1);
        }
        let gridParent: HTMLElement | null;
        if (!props.resultSetSummary) {
            return;
        }
        gridParent = document.getElementById(
            `grid-parent-${props.resultSetSummary.batchId}-${props.resultSetSummary.id}`,
        );
        if (gridParent) {
            gridParent.style.height = `${height}px`;
        }
        const dimension = new DOM.Dimension(width, height);
        tableRef.current?.layout(dimension);
    };

    const hideGrid = () => {
        let gridParent: HTMLElement | null;
        if (!props.resultSetSummary) {
            return;
        }
        gridParent = document.getElementById(
            `grid-parent-${props.resultSetSummary.batchId}-${props.resultSetSummary.id}`,
        );
        if (gridParent) {
            gridParent.style.display = "none";
        }
    };

    const showGrid = () => {
        let gridParent: HTMLElement | null;
        if (!props.resultSetSummary) {
            return;
        }
        gridParent = document.getElementById(
            `grid-parent-${props.resultSetSummary.batchId}-${props.resultSetSummary.id}`,
        );
        if (gridParent) {
            gridParent.style.display = "";
        }
    };

    const createTable = () => {
        if (!props.resultSetSummary) {
            return;
        }

        // Try to update existing table first
        if (updateResult(props.resultSetSummary)) {
            return; // Successfully updated existing table
        }

        // Need to create new table
        console.log(
            `Creating new table for result set ${props.resultSetSummary.batchId}-${props.resultSetSummary.id}`,
        );

        const setupState = async () => {
            await table.setupFilterState();
            await table.restoreColumnWidths();
            await table.setupScrollPosition();
            table.headerFilter.enabled =
                table.grid.getDataLength() < context.state.inMemoryDataProcessingThreshold!;

            table.rerenderGrid();
        };
        const DEFAULT_FONT_SIZE = 12;
        context?.log(`resultGrid: ${context.state.fontSettings.fontSize}`);

        const ROW_HEIGHT = context.state.fontSettings.fontSize! + 12; // 12 px is the padding
        const COLUMN_WIDTH = Math.max(
            (context.state.fontSettings.fontSize! / DEFAULT_FONT_SIZE) * 120,
            120,
        ); // Scale width with font size, but keep a minimum of 120px
        if (!props.resultSetSummary || !props.linkHandler) {
            return;
        }

        let columns: Slick.Column<Slick.SlickData>[] = props.resultSetSummary.columnInfo.map(
            (c, i) => {
                return {
                    id: i.toString(),
                    name:
                        c.columnName === "Microsoft SQL Server 2005 XML Showplan"
                            ? locConstants.queryResult.showplanXML
                            : escape(c.columnName),
                    field: i.toString(),
                    formatter:
                        c.isXml || c.isJson
                            ? hyperLinkFormatter
                            : (
                                  row: number | undefined,
                                  cell: any | undefined,
                                  value: DbCellValue,
                                  columnDef: any | undefined,
                                  dataContext: any | undefined,
                              ):
                                  | string
                                  | {
                                        text: string;
                                        addClasses: string;
                                    } => {
                                  if (isXmlCell(value, context?.log) && props.resultSetSummary) {
                                      props.resultSetSummary.columnInfo[i].isXml = true;
                                      return hyperLinkFormatter(
                                          row,
                                          cell,
                                          value,
                                          columnDef,
                                          dataContext,
                                      );
                                  } else if (isJsonCell(value) && props.resultSetSummary) {
                                      //TODO use showJsonAsLink config
                                      props.resultSetSummary.columnInfo[i].isJson = true;
                                      return hyperLinkFormatter(
                                          row,
                                          cell,
                                          value,
                                          columnDef,
                                          dataContext,
                                      );
                                  } else {
                                      return textFormatter(
                                          row,
                                          cell,
                                          value,
                                          columnDef,
                                          dataContext,
                                          DBCellValue.isDBCellValue(value) && value.isNull
                                              ? NULL_CELL_CSS_CLASS
                                              : undefined,
                                      );
                                  }
                              },
                };
            },
        );

        let div = document.createElement("div");
        div.id = "grid";
        div.className = "grid-panel";
        div.style.display = "inline-block";

        let tableOptions: Slick.GridOptions<Slick.SlickData> = {
            rowHeight: ROW_HEIGHT,
            showRowNumber: true,
            forceFitColumns: false,
            defaultColumnWidth: COLUMN_WIDTH,
        };
        let rowNumberColumn = new RowNumberColumn<Slick.SlickData>({
            autoCellSelection: false,
        });
        columns.unshift(rowNumberColumn.getColumnDefinition());

        let collection = new VirtualizedCollection<any>(
            50,
            (_index) => {},
            props.resultSetSummary?.rowCount ?? 0,
            (offset: number, count: number) => {
                console.log(
                    `VirtualizedCollection requesting data: offset=${offset}, count=${count}`,
                );
                const dataPromise = props.loadFunc(offset, count);
                dataPromise
                    .then((data) => {
                        console.log(
                            `VirtualizedCollection received data for offset=${offset}, count=${count}:`,
                            data?.length,
                            "rows",
                        );
                        if (data && data.length > 0) {
                            console.log("First row sample:", data[0]);
                        }
                    })
                    .catch((error) => {
                        console.error("VirtualizedCollection data loading error:", error);
                    });
                return dataPromise;
            },
        );

        let dataProvider = new HybridDataProvider(
            collection,
            (_startIndex, _count) => {
                console.log(
                    `HybridDataProvider requesting data: startIndex=${_startIndex}, count=${_count}`,
                );
                if (props.resultSetSummary?.rowCount && props.resultSetSummary?.rowCount > 0) {
                    const dataPromise = props.loadFunc(_startIndex, _count);
                    dataPromise
                        .then((data) => {
                            console.log(
                                `HybridDataProvider received data for startIndex=${_startIndex}, count=${_count}:`,
                                data?.length,
                                "rows",
                            );
                            if (data && data.length > 0) {
                                console.log("First row sample:", data[0]);
                            }
                        })
                        .catch((error) => {
                            console.error("HybridDataProvider data loading error:", error);
                        });
                    return dataPromise;
                } else {
                    console.info(`No rows to load: start index: ${_startIndex}, count: ${_count}`);
                    return Promise.resolve([]);
                }
            },
            (data: DbCellValue) => {
                if (!data || data.isNull) {
                    return undefined;
                }
                // If the string only contains whitespaces, it will be treated as empty string to make the filtering easier.
                // Note: this is the display string and does not impact the export/copy features.
                return data.displayValue.trim() === "" ? "" : data.displayValue;
            },
            {
                inMemoryDataProcessing: true,
                inMemoryDataCountThreshold: context.state.inMemoryDataProcessingThreshold,
            },
            undefined,
            undefined,
        );
        const table = new Table(
            div,
            defaultTableStyles,
            props.uri!,
            props.resultSetSummary!,
            props.webViewState!,
            context,
            props.linkHandler!,
            props.gridId,
            { dataProvider: dataProvider, columns: columns },
            tableOptions,
            props.gridParentRef,
        );

        // Store table, dataProvider, collection, and current result set for future updates
        tableRef.current = table;
        dataProviderRef.current = dataProvider;
        collectionRef.current = collection;
        currentResultSetRef.current = props.resultSetSummary;

        // Set up collection callback BEFORE triggering any data loading
        collection.setCollectionChangedCallback((startIndex, count) => {
            let refreshedRows = range(startIndex, startIndex + count);
            table.invalidateRows(refreshedRows, true);
        });

        void setupState();
        table.updateRowCount();

        // If the result set already has rows, trigger initial data loading
        if (props.resultSetSummary.rowCount > 0) {
            console.log(`Triggering initial data load for ${props.resultSetSummary.rowCount} rows`);

            // Force the grid to render and trigger data loading
            setTimeout(() => {
                table.updateRowCount();

                // Force the grid to request visible data by invalidating all rows
                table.grid.invalidateAllRows();
                table.grid.render();

                // Also try to access data directly to ensure VirtualizedCollection loads it
                const viewport = table.grid.getViewport();
                if (viewport && props.resultSetSummary) {
                    console.log(
                        `Loading initial viewport: rows ${viewport.top} to ${viewport.bottom}`,
                    );

                    // Force access to trigger data loading
                    for (
                        let i = viewport.top;
                        i <= Math.min(viewport.bottom, props.resultSetSummary.rowCount - 1);
                        i++
                    ) {
                        console.log(`Requesting data item ${i}`);
                        const item = table.grid.getDataItem(i);
                        console.log(`Got data item ${i}:`, item);
                    }
                }
            }, 100); // Increased timeout to ensure grid is ready
        }
        gridContainerRef.current?.appendChild(div);
        if (
            props.gridParentRef &&
            props.gridParentRef.current &&
            props.gridParentRef.current.clientWidth
        ) {
            table.layout(
                new DOM.Dimension(
                    props.gridParentRef.current.clientWidth - ACTIONBAR_WIDTH_PX,
                    props.gridParentRef.current.clientHeight,
                ),
            );
        }
    };

    useImperativeHandle(ref, () => ({
        refreshGrid,
        resizeGrid,
        hideGrid,
        showGrid,
    }));

    useEffect(() => {
        createTable();
    }, [refreshKey]);

    // Effect to handle result set changes
    useEffect(() => {
        if (props.resultSetSummary) {
            createTable();
        }
    }, [props.resultSetSummary]);

    // Cleanup when component unmounts
    useEffect(() => {
        return () => {
            tableRef.current = undefined;
            dataProviderRef.current = undefined;
            collectionRef.current = undefined;
            currentResultSetRef.current = undefined;
        };
    }, []);

    return <div id="gridContainter" ref={gridContainerRef}></div>;
});

function isJsonCell(value: DbCellValue): boolean {
    return !!(value && !value.isNull && value.displayValue?.match(IsJsonRegex));
}

function isXmlCell(value: DBCellValue, log?: LogCallback): boolean {
    let isXML = false;
    try {
        if (value && !value.isNull && value.displayValue.trim() !== "") {
            var parser = new DOMParser();
            // Script elements if any are not evaluated during parsing
            var doc = parser.parseFromString(value.displayValue, "text/xml");
            // For non-xmls, parsererror element is present in body element.
            var parserErrors = doc.body?.getElementsByTagName("parsererror") ?? [];
            isXML = parserErrors?.length === 0;
        }
    } catch (e) {
        // Ignore errors when parsing cell content, log and continue
        log && log(`An error occurred when parsing data as XML: ${e}`); // only call if callback is defined
    }
    return isXML;
}

// The regex to check whether a string is a valid JSON string. It is used to determine:
// 1. whether the cell should be rendered as a hyperlink.
// 2. when user clicks a cell, whether the cell content should be displayed in a new text editor as json.
// Based on the requirements, the solution doesn't need to be very accurate, a simple regex is enough since it is more
// performant than trying to parse the string to object.
// Regex explaination: after removing the trailing whitespaces and line breaks, the string must start with '[' (to support arrays)
// or '{', and there must be a '}' or ']' to close it.
const IsJsonRegex = /^\s*[\{|\[][\S\s]*[\}\]]\s*$/g;

// The css class for null cell
const NULL_CELL_CSS_CLASS = "cell-null";

ResultGrid.displayName = "ResultGrid";
export default ResultGrid;
