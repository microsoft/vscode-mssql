/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import $ from "jquery";
import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
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
    ResultSetSummary,
} from "../../../sharedInterfaces/queryResult";
import * as DOM from "./table/dom";

window.jQuery = $ as any;
require("slickgrid/lib/jquery.event.drag-2.3.0.js");
require("slickgrid/lib/jquery-1.11.2.min.js");
require("slickgrid/slick.core.js");
require("slickgrid/slick.grid.js");
require("slickgrid/plugins/slick.cellrangedecorator.js");

//TODO: get hardcoded data & get gridpanel to render the hardcoded data
// add console.log in the event handlers for example to onTableClick function

declare global {
    interface Window {
        $: any;
        jQuery: any;
    }
}

export interface SlickGridProps {
    loadFunc: (offset: number, count: number) => Thenable<any[]>;
    resultSetSummary?: ResultSetSummary;
}

export interface SlickGridHandle {
    refreshGrid: () => void;
    resizeGrid: (width: number, height: number) => void;
}
let table: Table<any>;

const SlickGrid = forwardRef<SlickGridHandle, SlickGridProps>(
    (props: SlickGridProps, ref) => {
        const gridContainerRef = useRef<HTMLDivElement>(null);
        const [refreshkey, setRefreshKey] = useState(0);
        const refreshGrid = () => {
            setRefreshKey((prev) => prev + 1);
        };
        const resizeGrid = (width: number, height: number) => {
            const dimension = new DOM.Dimension(width, height);
            table.layout(dimension);
        };
        useEffect(() => {
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
                                ? "TODO loc - Showplan XML"
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
                        // width: this.state.columnSizes && this.state.columnSizes[i] ? this.state.columnSizes[i] : undefined
                    };
                });
            // let options = {
            //     enableCellNavigation: true,
            //     enableColumnReorder: false
            // };

            let div = document.createElement("div");
            div.id = "grid";
            div.className = "grid-panel";
            div.style.display = "inline-block";

            //TODO: eventually need to calculate snapshot button width and subtract
            // let actionBarWidth = this.showActionBar ? ACTIONBAR_WIDTH : 0;
            // this.tableContainer.style.width = `calc(100% - ${actionBarWidth}px)`;

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
                (_startIndex, _count) => Promise.resolve([]),
                (data: DbCellValue) => {
                    if (!data || data.isNull) {
                        return undefined;
                    }
                    // If the string only contains whitespaces, it will be treated as empty string to make the filtering easier.
                    // Note: this is the display string and does not impact the export/copy features.
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
                { dataProvider: dataProvider, columns: columns },
                tableOptions,
            );

            collection.setCollectionChangedCallback((startIndex, count) => {
                let refreshedRows = range(startIndex, startIndex + count);
                table.invalidateRows(refreshedRows, true);
            });
            table.updateRowCount();

            let grid = document.body.appendChild(div);
            const elm = document.getElementById("grid")!;
            document.body.removeChild(grid);
            gridContainerRef.current?.appendChild(elm);
        }, [refreshkey]);

        useImperativeHandle(ref, () => ({
            refreshGrid,
            resizeGrid,
        }));

        return <div ref={gridContainerRef}></div>;
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
            // Script elements if any are not evaluated during parsing
            var doc = parser.parseFromString(value.displayValue, "text/xml");
            // For non-xmls, parsererror element is present in body element.
            var parserErrors =
                doc.body?.getElementsByTagName("parsererror") ?? [];
            isXML = parserErrors?.length === 0;
        }
    } catch (e) {
        // Ignore errors when parsing cell content, log and continue
        console.log(`An error occurred when parsing data as XML: ${e}`);
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

SlickGrid.displayName = "SlickGrid";
export default SlickGrid;
