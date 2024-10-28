/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import $ from "jquery";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import "../../media/slickgrid.css";
import { range, Table } from "./table/table";
import { defaultTableStyles } from "./table/interfaces";
import { RowNumberColumn } from "./table/plugins/rowNumberColumn.plugin";
import { VirtualizedCollection } from "./table/asyncDataView";
import { HybridDataProvider } from "./table/hybridDataProvider";
import {
    hyperLinkFormatter,
    textFormatter,
    DBCellValue,
    escape,
} from "./table/formatters";
import {
    DbCellValue,
    QueryResultReducers,
    QueryResultWebviewState,
    ResultSetSummary,
} from "../../../sharedInterfaces/queryResult";
import * as DOM from "./table/dom";
import { locConstants } from "../../common/locConstants";
import { VscodeWebviewContext } from "../../common/vscodeWebviewProvider";

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
    webViewState?: VscodeWebviewContext<
        QueryResultWebviewState,
        QueryResultReducers
    >;
}

export interface ResultGridHandle {
    refreshGrid: () => void;
    resizeGrid: (width: number, height: number) => void;
}

const ResultGrid = forwardRef<ResultGridHandle, ResultGridProps>(
    (props: ResultGridProps, ref) => {
        let table: Table<any>;
        const gridContainerRef = useRef<HTMLDivElement>(null);

        // Function to create or recreate the grid
        const initializeGrid = () => {
            if (gridContainerRef.current) {
                // Clean up the container
                while (gridContainerRef.current.firstChild) {
                    gridContainerRef.current.removeChild(
                        gridContainerRef.current.firstChild,
                    );
                }

                // Set up and configure the grid
                const ROW_HEIGHT = 25;
                if (!props.resultSetSummary) {
                    return;
                }

                let columns: Slick.Column<Slick.SlickData>[] =
                    props.resultSetSummary.columnInfo.map((c, i) => {
                        return {
                            id: i.toString(),
                            name:
                                c.columnName ===
                                "Microsoft SQL Server 2005 XML Showplan"
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
                                          if (
                                              isXmlCell(value) &&
                                              props.resultSetSummary
                                          ) {
                                              props.resultSetSummary.columnInfo[
                                                  i
                                              ].isXml = true;
                                              return hyperLinkFormatter(
                                                  row,
                                                  cell,
                                                  value,
                                                  columnDef,
                                                  dataContext,
                                              );
                                          } else if (
                                              isJsonCell(value) &&
                                              props.resultSetSummary
                                          ) {
                                              //TODO use showJsonAsLink config
                                              props.resultSetSummary.columnInfo[
                                                  i
                                              ].isJson = true;
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
                                                  DBCellValue.isDBCellValue(
                                                      value,
                                                  ) && value.isNull
                                                      ? NULL_CELL_CSS_CLASS
                                                      : undefined,
                                              );
                                          }
                                      },
                        };
                    });

                let div = document.createElement("div");
                div.id = "grid";
                div.className = "grid-panel";
                div.style.display = "inline-block";

                let tableOptions: Slick.GridOptions<Slick.SlickData> = {
                    rowHeight: ROW_HEIGHT,
                    showRowNumber: true,
                    forceFitColumns: false,
                    defaultColumnWidth: 120,
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
                        return props.loadFunc(_startIndex, _count);
                    },
                    (data: DbCellValue) => {
                        if (!data || data.isNull) {
                            return undefined;
                        }
                        return data.displayValue.trim() === ""
                            ? ""
                            : data.displayValue;
                    },
                    {
                        inMemoryDataProcessing: true,
                    },
                    undefined,
                    undefined,
                );
                table = new Table(
                    div,
                    defaultTableStyles,
                    props.uri!,
                    props.resultSetSummary!,
                    props.webViewState!,
                    { dataProvider: dataProvider, columns: columns },
                    tableOptions,
                    props.divId,
                );

                collection.setCollectionChangedCallback((startIndex, count) => {
                    let refreshedRows = range(startIndex, startIndex + count);
                    table.invalidateRows(refreshedRows, true);
                });
                table.updateRowCount();
                gridContainerRef.current.appendChild(div);
            }
        };

        // Initialize the grid on mount
        useEffect(() => {
            initializeGrid();
        }, []);

        const refreshGrid = () => {
            initializeGrid(); // Directly call initializeGrid to reset the DOM and grid content
        };

        const resizeGrid = (width: number, height: number) => {
            const dimension = new DOM.Dimension(width, height);
            table?.layout(dimension);
        };

        useImperativeHandle(ref, () => ({
            refreshGrid,
            resizeGrid,
        }));

        return <div id="gridContainer" ref={gridContainerRef}></div>;
    },
);

function isJsonCell(value: DbCellValue): boolean {
    return !!(value && !value.isNull && value.displayValue?.match(IsJsonRegex));
}

function isXmlCell(value: DBCellValue): boolean {
    let isXML = false;
    try {
        if (value && !value.isNull && value.displayValue.trim() !== "") {
            var parser = new DOMParser();
            var doc = parser.parseFromString(value.displayValue, "text/xml");
            var parserErrors =
                doc.body?.getElementsByTagName("parsererror") ?? [];
            isXML = parserErrors?.length === 0;
        }
    } catch (e) {
        console.log(`An error occurred when parsing data as XML: ${e}`);
    }
    return isXML;
}

const IsJsonRegex = /^\s*[\{|\[][\S\s]*[\}\]]\s*$/g;
const NULL_CELL_CSS_CLASS = "cell-null";

ResultGrid.displayName = "ResultGrid";
export default ResultGrid;
