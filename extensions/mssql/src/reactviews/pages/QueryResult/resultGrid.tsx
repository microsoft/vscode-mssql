/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import $ from "jquery";
import {
  forwardRef,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
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
import { isJson } from "../../common/jsonUtils";
import * as DOM from "./table/dom";
import { locConstants } from "../../common/locConstants";
import { QueryResultCommandsContext } from "./queryResultStateProvider";
import { LogCallback } from "../../../sharedInterfaces/webview";
import { useQueryResultSelector } from "./queryResultSelector";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import * as qr from "../../../sharedInterfaces/queryResult";
import { SLICKGRID_ROW_ID_PROP } from "./table/utils";
import { deepEqual } from "../../common/utils";
import { MARGIN_BOTTOM } from "./queryResultsGridView";

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
  gridId: string;
  gridParentRef: React.RefObject<HTMLDivElement>;
  resultId: number;
  batchId: number;
}

export interface ResultGridHandle {
  focusGrid: () => void;
}

const ResultGrid = forwardRef<ResultGridHandle, ResultGridProps>(
  (props: ResultGridProps, ref) => {
    const tableRef = useRef<Table<any> | null>(null);

    const context = useContext(QueryResultCommandsContext);
    if (!context) {
      return undefined;
    }

    const { themeKind, keyBindings } = useVscodeWebview2();

    const uri = useQueryResultSelector((state) => state.uri);
    if (!uri) {
      return undefined;
    }
    const inMemoryDataProcessingThreshold =
      useQueryResultSelector<number | undefined>(
        (state) => state.inMemoryDataProcessingThreshold,
      ) ?? 5000;
    const fontSettings = useQueryResultSelector((state) => state.fontSettings);
    const autoSizeColumns = useQueryResultSelector(
      (state) => state.autoSizeColumns,
    );

    const resultSetSummary = useQueryResultSelector(
      (state) => state.resultSetSummaries[props.batchId]?.[props.resultId],
      (a, b) => deepEqual(a, b), // Deep equality check to avoid unnecessary re-renders
    );

    const gridContainerRef = useRef<HTMLDivElement>(null);
    const isTableCreated = useRef<boolean>(false);
    if (!props.gridParentRef) {
      return undefined;
    }

    // Handler methods exposed to parent via ref
    const focusGrid = () => {
      if (!tableRef?.current) {
        return;
      }
      tableRef.current.focus();
    };
    useImperativeHandle(ref, () => ({
      focusGrid,
    }));

    const fetchRows = async (offset: number, count: number) => {
      const response = await context.extensionRpc.sendRequest(
        qr.GetRowsRequest.type,
        {
          uri: uri,
          batchId: props.batchId,
          resultId: props.resultId,
          rowStart: offset,
          numberOfRows: count,
        },
      );
      if (!response) {
        return [];
      }
      var columnLength = resultSetSummary?.columnInfo?.length;
      return response.rows.map((r, rowOffset) => {
        let dataWithSchema: {
          [key: string]: any;
        } = {};
        // Skip the first item since it is the row index column
        for (let i = 1; columnLength && i < columnLength + 1; i++) {
          const cell = r[i - 1];
          const displayValue = cell.isNull ? "NULL" : (cell.displayValue ?? "");
          const ariaLabel = displayValue;
          dataWithSchema[(i - 1).toString()] = {
            displayValue: displayValue,
            ariaLabel: ariaLabel,
            isNull: cell.isNull,
            invariantCultureDisplayValue: displayValue,
          };
          dataWithSchema[SLICKGRID_ROW_ID_PROP] = offset + rowOffset;
        }
        return dataWithSchema;
      });
    };

    // Resize the grid when the parent container size changes
    useEffect(() => {
      const handleResize = () => {
        if (props?.gridParentRef?.current && tableRef.current) {
          tableRef.current.layout(
            new DOM.Dimension(
              props.gridParentRef.current.clientWidth,
              props.gridParentRef.current.clientHeight - MARGIN_BOTTOM,
            ),
          );
        }
      };
      const resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      if (props?.gridParentRef?.current) {
        resizeObserver.observe(props.gridParentRef.current);
      }
      return () => {
        resizeObserver.disconnect();
      };
    }, [gridContainerRef.current]);

    // On URI change, clear all tableRef to allow recreation of table for new result set
    useEffect(() => {
      function disposeAllTables() {
        if (tableRef.current) {
          tableRef.current.dispose();
          tableRef.current = null;
          isTableCreated.current = false;
        }
      }
      disposeAllTables();
    }, [uri]);

    // On Column Info change, create the table. Ideally this should run only once.
    useEffect(() => {
      const createTable = async () => {
        if (isTableCreated.current) {
          return; // Maybe update column definitions instead of recreating the table
        }
        const columnInfo = resultSetSummary?.columnInfo;
        const rowCount = resultSetSummary?.rowCount;

        // Setting up dimensions based on font settings
        const DEFAULT_FONT_SIZE = 12;
        const ROW_HEIGHT = fontSettings.fontSize! + 12; // 12 px is the padding
        const COLUMN_WIDTH = Math.max(
          (fontSettings.fontSize! / DEFAULT_FONT_SIZE) * 120,
          120,
        ); // Scale width with font size, but keep a minimum of 120px

        let columns: Slick.Column<Slick.SlickData>[] = columnInfo?.map(
          (col, index) => {
            return {
              id: index.toString(),
              name: getColumnName(col),
              toolTip: col.columnName,
              field: index.toString(),
              formatter: getColumnFormatter(col),
            };
          },
        );

        const div = document.createElement("div");
        div.id = "grid";
        div.className = "grid-panel";
        div.style.display = "inline-block";

        const tableOptions: Slick.GridOptions<Slick.SlickData> = {
          rowHeight: ROW_HEIGHT,
          showRowNumber: true,
          forceFitColumns: false,
          defaultColumnWidth: COLUMN_WIDTH,
        };

        const rowNumberColumn = new RowNumberColumn<Slick.SlickData>({
          autoCellSelection: false,
        });

        // Add row number column at the start
        columns.unshift(rowNumberColumn.getColumnDefinition());

        let collection = new VirtualizedCollection<any>(
          50,
          (_index) => {},
          rowCount ?? 0,
          fetchRows,
        );

        let dataProvider = new HybridDataProvider(
          collection,
          fetchRows,
          (data: qr.DbCellValue) => {
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
          uri,
          resultSetSummary,
          context,
          context.openFileThroughLink,
          props.gridId,
          { dataProvider: dataProvider, columns: columns },
          keyBindings,
          tableOptions,
          props.gridParentRef,
          autoSizeColumns,
          themeKind,
        );

        collection.setCollectionChangedCallback((startIndex, count) => {
          let refreshedRows = range(startIndex, startIndex + count);
          tableRef.current?.invalidateRows(refreshedRows, true);
        });

        tableRef.current.layout(
          new DOM.Dimension(
            props.gridParentRef?.current?.clientWidth || 0,
            props.gridParentRef?.current?.clientHeight || 0,
          ),
        );

        // Append the grid div to the container
        if (gridContainerRef.current) {
          gridContainerRef.current.appendChild(div);
        }

        isTableCreated.current = true;
        async function restoreGridState() {
          if (!tableRef.current) return;
          // Restore sort and filter state
          await tableRef.current.setupFilterState();
          tableRef.current.headerFilter.enabled =
            tableRef.current.grid.getDataLength() <
            inMemoryDataProcessingThreshold!;
          tableRef.current.rerenderGrid();

          // Restore column widths
          await tableRef.current.restoreColumnWidths();
          // Restore scroll position
          await tableRef.current.setupScrollPosition();
        }
        void restoreGridState();
      };

      function updateTableRowCount() {
        const rowCount = resultSetSummary?.rowCount;
        if (tableRef.current && rowCount !== undefined && rowCount > 0) {
          // Update the data provider with new row count
          const dataProvider =
            tableRef.current.getData() as HybridDataProvider<any>;
          if (dataProvider && "length" in dataProvider) {
            dataProvider.length = rowCount;

            // Also update the underlying collection
            if (dataProvider.dataRows && "setLength" in dataProvider.dataRows) {
              dataProvider.dataRows.setLength(rowCount);
            }
          }
          tableRef.current.updateRowCount();
        }
      }

      if (tableRef.current !== null) {
        updateTableRowCount();
      } else {
        void createTable();
      }
    }, [resultSetSummary]);

    // Update key bindings on slickgrid when key bindings change
    useEffect(() => {
      function updateTableKeyBindings() {
        if (tableRef.current) {
          tableRef.current.updateKeyBindings(keyBindings);
        }
      }
      updateTableKeyBindings();
    }, [keyBindings]);

    return <div id="gridContainter" ref={gridContainerRef}></div>;
  },
);

/**
 * Get the column name to be displayed in the grid header.
 * @param columnInfo The column info object.
 * @returns The column name to be displayed.
 */
function getColumnName(columnInfo: qr.IDbColumn): string {
  return columnInfo.columnName === "Microsoft SQL Server 2005 XML Showplan"
    ? locConstants.queryResult.showplanXML
    : escape(columnInfo.columnName);
}

function getColumnFormatter(columnInfo: qr.IDbColumn): (
  row: number | undefined,
  cell: any,
  value: qr.DbCellValue,
  columnDef: any | undefined,
  dataContext: any | undefined,
) =>
  | string
  | {
      text: string;
      addClasses: string;
    } {
  if (columnInfo.isXml || columnInfo.isJson) {
    return hyperLinkFormatter;
  }
  return (
    row: number | undefined,
    cell: any | undefined,
    value: qr.DbCellValue,
    columnDef: any | undefined,
    dataContext: any | undefined,
  ): string | { text: string; addClasses: string } => {
    if (isXmlCell(value) && columnInfo) {
      columnInfo.isXml = true;
      return hyperLinkFormatter(row, cell, value, columnDef, dataContext);
    } else if (isJson(value?.displayValue) && columnInfo) {
      //TODO use showJsonAsLink config
      columnInfo.isJson = true;
      return hyperLinkFormatter(row, cell, value, columnDef, dataContext);
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
  };
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

// The css class for null cell
const NULL_CELL_CSS_CLASS = "cell-null";

ResultGrid.displayName = "ResultGrid";
export default ResultGrid;
