/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef } from "react";
import { TableDataView, defaultFilter } from "../QueryResult/table/tableDataView";
import { RowNumberColumn } from "../QueryResult/table/plugins/rowNumberColumn.plugin";
import { NotebookHeaderMenu, FilterButtonWidth } from "./notebookHeaderMenu.plugin";
import { NotebookCellSelectionModel } from "./notebookCellSelectionModel.plugin";
import { textFormatter, DBCellValue, escape } from "../QueryResult/table/formatters";
import { defaultTableStyles, FilterableColumn } from "../QueryResult/table/interfaces";
import type { IDbColumn, DbCellValue } from "../../../sharedInterfaces/queryResult";
import "./notebookResultGrid.css";
import "../../media/slickgrid.css";

export interface NotebookResultGridProps {
    columnInfo: IDbColumn[];
    rows: DbCellValue[][];
    rowCount: number;
}

const ROW_HEIGHT = 24;
const MIN_COLUMN_WIDTH = 80;
const MAX_COLUMN_WIDTH = 400;
const MAX_GRID_HEIGHT = 500;
const HEADER_HEIGHT = 30;

/**
 * Measure the pixel width of a string using a canvas context.
 */
function measureTextWidth(text: string, font: string): number {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        return text.length * 8;
    }
    ctx.font = font;
    return ctx.measureText(text).width;
}

/**
 * Compute optimal column widths by sampling header + data values.
 */
function computeColumnWidths(columns: IDbColumn[], rows: DbCellValue[][], font: string): number[] {
    const padding = 20 + FilterButtonWidth; // cell padding + sort/filter button space
    const maxSampleRows = 50;
    const sampleRows = rows.slice(0, maxSampleRows);

    return columns.map((col, colIdx) => {
        let maxWidth = measureTextWidth(col.columnName, font) + padding;
        for (const row of sampleRows) {
            const cell = row[colIdx];
            if (cell) {
                const val = cell.isNull ? "NULL" : cell.displayValue;
                const truncated = val.length > 250 ? val.slice(0, 250) + "..." : val;
                const w = measureTextWidth(truncated, font) + padding;
                if (w > maxWidth) {
                    maxWidth = w;
                }
            }
        }
        return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.ceil(maxWidth)));
    });
}

/**
 * Get the formatter for a notebook grid column. In the notebook renderer context
 * we use the text formatter with null styling — no hyperlink support since we
 * lack the extension host messaging needed to open files.
 */
function getColumnFormatter(
    _columnInfo: IDbColumn,
): (
    row: number | undefined,
    cell: any,
    value: DbCellValue,
    columnDef: any | undefined,
    dataContext: any | undefined,
) => string | { text: string; addClasses: string } {
    return (
        row: number | undefined,
        cell: any | undefined,
        value: DbCellValue,
        columnDef: any | undefined,
        dataContext: any | undefined,
    ): string | { text: string; addClasses: string } => {
        return textFormatter(
            row,
            cell,
            value,
            columnDef,
            dataContext,
            DBCellValue.isDBCellValue(value) && value.isNull ? "cell-null" : undefined,
        );
    };
}

export function NotebookResultGrid({ columnInfo, rows, rowCount }: NotebookResultGridProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<Slick.Grid<Slick.SlickData> | null>(null);
    const dataViewRef = useRef<TableDataView<Slick.SlickData> | null>(null);

    useEffect(() => {
        if (!containerRef.current || columnInfo.length === 0) {
            return;
        }

        // Convert rows into SlickGrid data format
        const gridData: Slick.SlickData[] = rows.map((row, rowIdx) => {
            const dataRow: { [key: string]: any } = {};
            for (let i = 0; i < columnInfo.length; i++) {
                const cell = row[i];
                const displayValue = cell?.isNull ? "NULL" : (cell?.displayValue ?? "");
                dataRow[i.toString()] = {
                    displayValue: displayValue,
                    ariaLabel: displayValue,
                    isNull: cell?.isNull ?? false,
                    invariantCultureDisplayValue: displayValue,
                };
            }
            dataRow["_rowIndex"] = rowIdx;
            return dataRow;
        });

        // Create TableDataView for in-memory data with sorting and filtering
        const cellValueGetter = (data: any) => {
            if (!data || data.isNull) {
                return undefined;
            }
            return data.displayValue?.trim() === "" ? "" : data.displayValue;
        };
        const filterFn = (data: Slick.SlickData[], columns: Slick.Column<Slick.SlickData>[]) =>
            defaultFilter(data, columns as FilterableColumn<Slick.SlickData>[], cellValueGetter);
        const tableDataView = new TableDataView<Slick.SlickData>(
            gridData,
            undefined,
            undefined,
            filterFn,
            cellValueGetter,
        );
        dataViewRef.current = tableDataView;

        // Compute column widths
        const computedFont = getComputedStyle(containerRef.current);
        const font = `${computedFont.fontSize} ${computedFont.fontFamily}`;
        const colWidths = computeColumnWidths(columnInfo, rows, font);

        // Create column definitions
        const columns: Slick.Column<Slick.SlickData>[] = columnInfo.map((col, index) => ({
            id: index.toString(),
            name: escape(col.columnName),
            toolTip: col.columnName,
            field: index.toString(),
            formatter: getColumnFormatter(col),
            width: colWidths[index],
            sortable: true,
            resizable: true,
        }));

        // Prepend row number column
        const rowNumberColumn = new RowNumberColumn<Slick.SlickData>({
            autoCellSelection: false,
        });
        columns.unshift(rowNumberColumn.getColumnDefinition());

        // Calculate grid height: rows + header, capped at MAX_GRID_HEIGHT
        const totalRowsHeight = gridData.length * ROW_HEIGHT + HEADER_HEIGHT;
        const gridHeight = Math.min(totalRowsHeight, MAX_GRID_HEIGHT);

        // Create grid container div
        const gridDiv = document.createElement("div");
        gridDiv.style.width = "100%";
        gridDiv.style.height = `${gridHeight}px`;
        containerRef.current.appendChild(gridDiv);

        // Apply table styles as CSS custom properties
        const styles = defaultTableStyles;
        if (styles.tableHeaderBackground) {
            gridDiv.style.setProperty("--table-header-bg", styles.tableHeaderBackground);
        }
        if (styles.tableHeaderForeground) {
            gridDiv.style.setProperty("--table-header-fg", styles.tableHeaderForeground);
        }

        // Grid options
        const gridOptions: Slick.GridOptions<Slick.SlickData> = {
            rowHeight: ROW_HEIGHT,
            showRowNumber: true,
            forceFitColumns: false,
            defaultColumnWidth: 120,
            enableCellNavigation: true,
            enableColumnReorder: false,
        };

        // Create grid with empty columns, register plugins, then set columns.
        // This ensures plugins are subscribed to onHeaderCellRendered before
        // headers are rendered.
        const grid = new Slick.Grid(gridDiv, tableDataView, [], gridOptions);
        gridRef.current = grid;

        // Register plugins
        grid.registerPlugin(rowNumberColumn);

        const headerMenu = new NotebookHeaderMenu<Slick.SlickData>();
        grid.registerPlugin(headerMenu);

        // Register cell selection model for multi-cell selection
        const selectionModel = new NotebookCellSelectionModel({
            hasRowSelector: true,
        });
        grid.setSelectionModel(selectionModel);

        // Now set columns — this triggers header rendering with plugins active
        grid.setColumns(columns);

        // Ctrl+C / Cmd+C copy handler
        gridDiv.addEventListener("keydown", (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "c") {
                const ranges = grid.getSelectionModel()?.getSelectedRanges();
                if (!ranges || ranges.length === 0) {
                    // If no selection model, copy active cell
                    const activeCell = grid.getActiveCell();
                    if (activeCell) {
                        const item = tableDataView.getItem(activeCell.row);
                        const col = grid.getColumns()[activeCell.cell];
                        if (item && col?.field) {
                            const cellVal = item[col.field];
                            const text = cellVal?.isNull ? "NULL" : (cellVal?.displayValue ?? "");
                            void navigator.clipboard.writeText(text);
                        }
                    }
                    return;
                }

                // Build tab-separated text from selected ranges
                const lines: string[] = [];
                for (const range of ranges) {
                    const fromRow = range.fromRow;
                    const toRow = range.toRow;
                    const fromCell = range.fromCell;
                    const toCell = range.toCell;
                    for (let r = fromRow; r <= toRow; r++) {
                        const rowValues: string[] = [];
                        const item = tableDataView.getItem(r);
                        for (let c = fromCell; c <= toCell; c++) {
                            const col = grid.getColumns()[c];
                            if (col?.field && col.id !== "rowNumber") {
                                const cellVal = item?.[col.field];
                                rowValues.push(
                                    cellVal?.isNull ? "NULL" : (cellVal?.displayValue ?? ""),
                                );
                            }
                        }
                        lines.push(rowValues.join("\t"));
                    }
                }
                void navigator.clipboard.writeText(lines.join("\n"));
                e.preventDefault();
            }
        });

        // Resize observer to handle container size changes
        const resizeObserver = new ResizeObserver(() => {
            grid.resizeCanvas();
        });
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        // Cleanup
        return () => {
            resizeObserver.disconnect();
            grid.destroy();
            tableDataView.dispose();
        };
    }, [columnInfo, rows, rowCount]);

    return (
        <div className="notebook-result-grid-container" ref={containerRef}>
            <div className="row-count-label">{rowCount} row(s)</div>
        </div>
    );
}
