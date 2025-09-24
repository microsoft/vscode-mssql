/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import $ from "jquery";
import { forwardRef, useContext, useEffect, useImperativeHandle, useRef } from "react";
import "../../media/slickgrid.css";
import { ACTIONBAR_WIDTH_PX, range, Table } from "./table/table";
import { defaultTableStyles } from "./table/interfaces";
import { RowNumberColumn } from "./table/plugins/rowNumberColumn.plugin";
import { VirtualizedCollection } from "./table/asyncDataView";
import { HybridDataProvider } from "./table/hybridDataProvider";
import { hyperLinkFormatter, textFormatter, DBCellValue, escape } from "./table/formatters";
import { DbCellValue, ResultSetSummary } from "../../../sharedInterfaces/queryResult";
import * as DOM from "./table/dom";
import { locConstants } from "../../common/locConstants";
import { QueryResultCommandsContext } from "./queryResultStateProvider";
import { LogCallback } from "../../../sharedInterfaces/webview";
import { useQueryResultSelector } from "./queryResultSelector";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";

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
    const tableRef = useRef<Table<any> | null>(null);
    const gridContainerRef = useRef<HTMLDivElement>(null);

    const context = useContext(QueryResultCommandsContext);
    if (!context) {
        return undefined;
    }
    // Helper to get selected columns from the grid selection
    const getSelectedColumns = () => {
        if (!tableRef.current) return [];
        const ranges = tableRef.current.getSelectedRanges();
        const columns: Set<number> = new Set();
        ranges.forEach((range) => {
            for (let c = range.fromCell; c <= range.toCell; c++) {
                columns.add(c);
            }
        });
        // Skip row selector column (usually index 0)
        return Array.from(columns).filter((idx) => idx > 0);
    };

    // Resize selected columns by delta px
    const resizeSelectedColumns = (delta: number) => {
        if (!tableRef.current) return;
        const grid = tableRef.current.grid;
        const columns = grid.getColumns();
        const selectedCols = getSelectedColumns();
        let changed = false;
        selectedCols.forEach((colIdx) => {
            const col = columns[colIdx];
            if (col && col.width) {
                col.width = Math.max(40, Math.min(col.width + delta, 800));
                changed = true;
            }
        });
        if (changed) {
            grid.setColumns(columns);
            grid.render();
        }
    };

    // Wheel event handler for CTRL + scroll
    useEffect(() => {
        const gridDiv = gridContainerRef.current;
        if (!gridDiv) return;
        const wheelHandler = (event: WheelEvent) => {
            if (event.ctrlKey && getSelectedColumns().length > 0) {
                event.preventDefault();
                if (event.deltaY < 0) {
                    resizeSelectedColumns(20); // Expand
                } else if (event.deltaY > 0) {
                    resizeSelectedColumns(-20); // Contract
                }
            }
        };
        gridDiv.addEventListener("wheel", wheelHandler, { passive: false });
        return () => gridDiv.removeEventListener("wheel", wheelHandler);
    }, [tableRef.current]);

    const inMemoryDataProcessingThreshold = useQueryResultSelector<number | undefined>(
        (state) => state.inMemoryDataProcessingThreshold,
    );
    const fontSettings = useQueryResultSelector((state) => state.fontSettings);
    const autoSizeColumns = useQueryResultSelector((state) => state.autoSizeColumns);
    const { themeKind } = useVscodeWebview2();

    const isTableCreated = useRef<boolean>(false);
    if (!props.gridParentRef) {
        return undefined;
    }
    const refreshGrid = () => {
        if (gridContainerRef.current) {
            while (gridContainerRef.current.firstChild) {
                gridContainerRef.current.removeChild(gridContainerRef.current.firstChild);
            }
        }
        isTableCreated.current = false;
        tableRef.current = null;
    };

    const resizeGrid = (width: number, height: number) => {
        if (!tableRef.current) {
            context.log("resizeGrid - table is not initialized, creating table");
            createTableIfNeeded();
            return;
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

    const updateRowCountOnly = () => {
        if (tableRef.current && props.resultSetSummary) {
            // Update the data provider with new row count
            const dataProvider = tableRef.current.getData() as HybridDataProvider<any>;
            if (dataProvider && "length" in dataProvider) {
                dataProvider.length = props.resultSetSummary.rowCount;
            }
            tableRef.current.updateRowCount();
        }
    };

    const createTableIfNeeded = () => {
        if (isTableCreated.current && tableRef.current) {
            // Table already exists, just update row count
            updateRowCountOnly();
            return;
        }
        const setupState = async () => {
            if (!tableRef.current) return;
            await tableRef.current.setupFilterState();
            await tableRef.current.restoreColumnWidths();
            await tableRef.current.setupScrollPosition();
            tableRef.current.headerFilter.enabled =
                tableRef.current.grid.getDataLength() < inMemoryDataProcessingThreshold!;

            tableRef.current.rerenderGrid();
        };
        const DEFAULT_FONT_SIZE = 12;

        const ROW_HEIGHT = fontSettings.fontSize! + 12; // 12 px is the padding
        const COLUMN_WIDTH = Math.max((fontSettings.fontSize! / DEFAULT_FONT_SIZE) * 120, 120); // Scale width with font size, but keep a minimum of 120px
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
            props.loadFunc,
        );

        let dataProvider = new HybridDataProvider(
            collection,
            (_startIndex, _count) => {
                if (props.resultSetSummary?.rowCount && props.resultSetSummary?.rowCount > 0) {
                    return props.loadFunc(_startIndex, _count);
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
                inMemoryDataCountThreshold: inMemoryDataProcessingThreshold,
            },
            context,
            undefined,
            undefined,
        );
        tableRef.current = new Table(
            div,
            defaultTableStyles,
            props.uri!,
            props.resultSetSummary!,
            context,
            props.linkHandler!,
            props.gridId,
            { dataProvider: dataProvider, columns: columns },
            tableOptions,
            props.gridParentRef,
            autoSizeColumns,
            themeKind,
        );
        void setupState();
        collection.setCollectionChangedCallback((startIndex, count) => {
            let refreshedRows = range(startIndex, startIndex + count);
            tableRef.current?.invalidateRows(refreshedRows, true);
        });
        tableRef.current.updateRowCount();
        gridContainerRef.current?.appendChild(div);
        if (
            props.gridParentRef &&
            props.gridParentRef.current &&
            props.gridParentRef.current.clientWidth
        ) {
            tableRef.current.layout(
                new DOM.Dimension(
                    props.gridParentRef.current.clientWidth - ACTIONBAR_WIDTH_PX,
                    props.gridParentRef.current.clientHeight,
                ),
            );
        }

        isTableCreated.current = true;
    };

    useImperativeHandle(ref, () => ({
        refreshGrid,
        resizeGrid,
        hideGrid,
        showGrid,
    }));

    useEffect(() => {
        createTableIfNeeded();
    }, [props.resultSetSummary?.rowCount]);

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
