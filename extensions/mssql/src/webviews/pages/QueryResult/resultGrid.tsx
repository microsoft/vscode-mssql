/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import $ from "jquery";
import { forwardRef, useContext, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import "../../media/slickgrid.css";
import { range, Table } from "./table/table";
import { defaultTableStyles } from "./table/interfaces";
import { RowNumberColumn } from "./table/plugins/rowNumberColumn.plugin";
import { VirtualizedCollection } from "./table/asyncDataView";
import { HybridDataProvider } from "./table/hybridDataProvider";
import { hyperLinkFormatter, textFormatter, DBCellValue, escape } from "./table/formatters";
import { isJson } from "../../common/jsonUtils";
import * as DOM from "./table/dom";
import { locConstants } from "../../common/locConstants";
import { QueryResultCommandsContext } from "./queryResultStateProvider";
import { useQueryResultSelector } from "./queryResultSelector";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import * as qr from "../../../sharedInterfaces/queryResult";
import { SLICKGRID_ROW_ID_PROP } from "./table/utils";
import { MARGIN_BOTTOM } from "./queryResultsGridView";
import { isXmlCell } from "../../common/xmlUtils";
import {
    getQueryResultGridPerfNow,
    measureQueryResultGridPerfAsync,
    recordQueryResultGridPerfEvent,
    scheduleQueryResultGridPerfPaint,
    setQueryResultGridPerfEnabled,
    type QueryResultGridPerfContext,
} from "./gridPerf";

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
    gridParentRef: React.RefObject<HTMLDivElement | null>;
    resultId: number;
    batchId: number;
    viewMode?: qr.QueryResultViewMode;
    canToggleMaximize?: boolean;
    isMaximized?: boolean;
    onToggleMaximize?: () => void;
}

export interface ResultGridHandle {
    focusGrid: () => void;
}

const ResultGrid = forwardRef<ResultGridHandle, ResultGridProps>((props: ResultGridProps, ref) => {
    const tableRef = useRef<Table<any> | null>(null);

    const context = useContext(QueryResultCommandsContext);
    if (!context) {
        return undefined;
    }

    const { themeKind, keyBindings } = useVscodeWebview();

    const uri = useQueryResultSelector((state) => state.uri);
    if (!uri) {
        return undefined;
    }
    const inMemoryDataProcessingThreshold =
        useQueryResultSelector<number | undefined>(
            (state) => state.inMemoryDataProcessingThreshold,
        ) ?? 5000;
    const fontSettings = useQueryResultSelector((state) => state.fontSettings);
    const gridSettings = useQueryResultSelector((state) => state.gridSettings);
    const autoSizeColumnsMode =
        useQueryResultSelector((state) => state.autoSizeColumnsMode) ??
        qr.ResultsGridAutoSizeStyle.HeadersAndData;
    const isGridPerfTelemetryEnabled = useQueryResultSelector(
        (state) => state.isGridPerfTelemetryEnabled === true,
    );

    const resultSetSummary = useQueryResultSelector(
        (state) => state.resultSetSummaries[props.batchId]?.[props.resultId],
        (a, b) => {
            // Only re-render if row count has changed. ids and column info are immutable and will not change on new data arrival, so we can ignore them for re-rendering purposes.
            return a?.rowCount === b?.rowCount;
        },
    );

    const gridContainerRef = useRef<HTMLDivElement>(null);
    const isTableCreated = useRef<boolean>(false);
    const gridPerfContext = useMemo<QueryResultGridPerfContext>(
        () => ({
            enabled: isGridPerfTelemetryEnabled,
            gridKind: "legacy",
            gridId: props.gridId,
            batchId: props.batchId,
            resultId: props.resultId,
        }),
        [isGridPerfTelemetryEnabled, props.batchId, props.gridId, props.resultId],
    );
    const gridPerfContextRef = useRef(gridPerfContext);
    gridPerfContextRef.current = gridPerfContext;
    const gridPerfMountStartRef = useRef(getQueryResultGridPerfNow());
    const gridPerfFirstDataPaintRecordedRef = useRef(false);
    const gridPerfFirstFetchResponseTimeRef = useRef<number | undefined>(undefined);
    const gridPerfPreviousRowCountRef = useRef<number | undefined>(undefined);
    const gridPerfResultIdentity = useMemo(
        () =>
            [
                props.gridId,
                resultSetSummary?.batchId,
                resultSetSummary?.id,
                resultSetSummary?.columnInfo
                    ?.map((column) => `${column.columnName},${column.dataType}`)
                    .join("|"),
            ].join("|"),
        [props.gridId, resultSetSummary],
    );

    useEffect(() => {
        setQueryResultGridPerfEnabled(isGridPerfTelemetryEnabled);
    }, [isGridPerfTelemetryEnabled]);

    useEffect(() => {
        if (!resultSetSummary) {
            return;
        }

        const mountStart = getQueryResultGridPerfNow();
        gridPerfMountStartRef.current = mountStart;
        gridPerfFirstDataPaintRecordedRef.current = false;
        gridPerfFirstFetchResponseTimeRef.current = undefined;
        gridPerfPreviousRowCountRef.current = resultSetSummary.rowCount;

        recordQueryResultGridPerfEvent(gridPerfContext, "mount-start", {
            rowCount: resultSetSummary.rowCount,
            columnCount: resultSetSummary.columnInfo.length,
        });
        scheduleQueryResultGridPerfPaint(gridPerfContext, "mount-first-paint", mountStart, {
            rowCount: resultSetSummary.rowCount,
            columnCount: resultSetSummary.columnInfo.length,
        });

        return () => {
            recordQueryResultGridPerfEvent(gridPerfContext, "unmount");
        };
    }, [gridPerfContext, gridPerfResultIdentity]);

    useEffect(() => {
        if (!resultSetSummary) {
            return;
        }

        const previousRowCount = gridPerfPreviousRowCountRef.current;
        if (previousRowCount !== undefined && previousRowCount !== resultSetSummary.rowCount) {
            const startTime = getQueryResultGridPerfNow();
            const metadata = {
                previousRowCount,
                rowCount: resultSetSummary.rowCount,
            };
            recordQueryResultGridPerfEvent(gridPerfContext, "row-count-change", metadata);
            scheduleQueryResultGridPerfPaint(
                gridPerfContext,
                "row-count-change-paint",
                startTime,
                metadata,
            );
        }

        gridPerfPreviousRowCountRef.current = resultSetSummary.rowCount;
    }, [gridPerfContext, resultSetSummary?.rowCount]);
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
        const response = await measureQueryResultGridPerfAsync(
            gridPerfContextRef.current,
            "get-rows",
            {
                offset,
                count,
            },
            async () =>
                context.extensionRpc.sendRequest(qr.GetRowsRequest.type, {
                    uri: uri,
                    batchId: props.batchId,
                    resultId: props.resultId,
                    rowStart: offset,
                    numberOfRows: count,
                }),
        );
        if (!response) {
            return [];
        }
        var columnLength = resultSetSummary?.columnInfo?.length;
        const rows = response.rows.map((r, rowOffset) => {
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

        if (rows.length > 0 && !gridPerfFirstDataPaintRecordedRef.current) {
            gridPerfFirstDataPaintRecordedRef.current = true;
            gridPerfFirstFetchResponseTimeRef.current = getQueryResultGridPerfNow();
        }

        return rows;
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

    // When row-height-affecting settings change, dispose the existing table so it is recreated
    // with the correct dimensions. This covers both rowPadding and fontSize, both of which
    // feed into the ROW_HEIGHT and COLUMN_WIDTH calculations inside createTable.
    useEffect(() => {
        if (tableRef.current) {
            tableRef.current.dispose();
            tableRef.current = null;
            isTableCreated.current = false;
        }
    }, [gridSettings?.rowPadding, fontSettings?.fontSize]);

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
            const fontSize = fontSettings?.fontSize ?? DEFAULT_FONT_SIZE;
            const rowPadding = gridSettings?.rowPadding ?? 0;
            const ROW_HEIGHT = fontSize + 12 + rowPadding * 2; // 12 px base padding, plus extra row padding on each side
            const COLUMN_WIDTH = Math.max((fontSize / DEFAULT_FONT_SIZE) * 120, 120); // Scale width with font size, but keep a minimum of 120px

            let columns: Slick.Column<Slick.SlickData>[] = columnInfo?.map((col, index) => {
                return {
                    id: index.toString(),
                    name: getColumnName(col),
                    toolTip: col.columnName,
                    field: index.toString(),
                    formatter: getColumnFormatter(col),
                };
            });

            const div = document.createElement("div");
            div.id = `grid-${props.gridId}`;
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
                autoSizeColumnsMode,
                themeKind,
            );

            collection.setCollectionChangedCallback((startIndex, count) => {
                let refreshedRows = range(startIndex, startIndex + count);
                tableRef.current?.invalidateRows(refreshedRows, true);

                const firstFetchResponseTime = gridPerfFirstFetchResponseTimeRef.current;
                if (firstFetchResponseTime !== undefined) {
                    gridPerfFirstFetchResponseTimeRef.current = undefined;
                    scheduleQueryResultGridPerfPaint(
                        gridPerfContextRef.current,
                        "get-rows-response-paint",
                        firstFetchResponseTime,
                        {
                            offset: startIndex,
                            count,
                            returnedRows: count,
                        },
                    );
                    scheduleQueryResultGridPerfPaint(
                        gridPerfContextRef.current,
                        "first-data-paint",
                        gridPerfMountStartRef.current,
                        {
                            offset: startIndex,
                            count,
                            returnedRows: count,
                        },
                    );
                }
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
                    tableRef.current.grid.getDataLength() < inMemoryDataProcessingThreshold!;
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
                const dataProvider = tableRef.current.getData() as HybridDataProvider<any>;
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
    }, [resultSetSummary, gridSettings?.rowPadding, fontSettings?.fontSize]);

    // Update key bindings on slickgrid when key bindings change
    useEffect(() => {
        function updateTableKeyBindings() {
            if (tableRef.current) {
                tableRef.current.updateKeyBindings(keyBindings);
            }
        }
        updateTableKeyBindings();
    }, [keyBindings]);

    return <div id={`gridContainter-${props.gridId}`} ref={gridContainerRef}></div>;
});

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

    // VECTOR columns display as plain text. Their [n,n,n] format looks like a JSON array
    // but must never be formatted as a JSON hyperlink or opened in the JSON viewer.
    if (columnInfo.isVector) {
        return textFormatter;
    }

    // Avoid expensive XML/JSON parsing on every cell render for plain-text columns.
    // Track which rows we've already sampled so SlickGrid re-renders don't
    // exhaust the budget.
    const sampledRows = new Set<number>();
    const maxDistinctRows = 20;

    return (
        row: number | undefined,
        cell: any | undefined,
        value: qr.DbCellValue,
        columnDef: any | undefined,
        dataContext: any | undefined,
    ): string | { text: string; addClasses: string } => {
        if (columnInfo.isXml || columnInfo.isJson) {
            return hyperLinkFormatter(row, cell, value, columnDef, dataContext);
        }

        const displayValue = value?.displayValue;

        // Skip detection for null/empty values or when we've already sampled this row
        if (
            !displayValue ||
            value?.isNull ||
            row === undefined ||
            sampledRows.has(row) ||
            sampledRows.size >= maxDistinctRows
        ) {
            return textFormatter(
                row,
                cell,
                value,
                columnDef,
                dataContext,
                DBCellValue.isDBCellValue(value) && value.isNull ? NULL_CELL_CSS_CLASS : undefined,
            );
        }

        sampledRows.add(row);

        if (isXmlCell(displayValue) && columnInfo) {
            columnInfo.isXml = true;
            return hyperLinkFormatter(row, cell, value, columnDef, dataContext);
        } else if (isJson(displayValue) && columnInfo) {
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
                DBCellValue.isDBCellValue(value) && value.isNull ? NULL_CELL_CSS_CLASS : undefined,
            );
        }
    };
}

// The css class for null cell
const NULL_CELL_CSS_CLASS = "cell-null";

ResultGrid.displayName = "ResultGrid";
export default ResultGrid;
