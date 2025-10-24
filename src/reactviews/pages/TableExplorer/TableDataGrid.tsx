/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState, useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import {
    SlickgridReactInstance,
    Column,
    GridOption,
    SlickgridReact,
    EditCommand,
    Editors,
    ContextMenu,
} from "slickgrid-react";
import { EditSubsetResult } from "../../../sharedInterfaces/tableExplorer";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import { locConstants as loc } from "../../common/locConstants";
import "@slickgrid-universal/common/dist/styles/css/slickgrid-theme-default.css";

interface TableDataGridProps {
    resultSet: EditSubsetResult | undefined;
    themeKind?: ColorThemeKind;
    pageSize?: number;
    onDeleteRow?: (rowId: number) => void;
    onUpdateCell?: (rowId: number, columnId: number, newValue: string) => void;
    onRevertCell?: (rowId: number, columnId: number) => void;
    onRevertRow?: (rowId: number) => void;
}

export interface TableDataGridRef {
    clearAllChangeTracking: () => void;
}

export const TableDataGrid = forwardRef<TableDataGridRef, TableDataGridProps>(
    (
        {
            resultSet,
            themeKind,
            pageSize = 100,
            onDeleteRow,
            onUpdateCell,
            onRevertCell,
            onRevertRow,
        },
        ref,
    ) => {
        const [dataset, setDataset] = useState<any[]>([]);
        const [columns, setColumns] = useState<Column[]>([]);
        const [options, setOptions] = useState<GridOption | undefined>(undefined);
        const reactGridRef = useRef<SlickgridReactInstance | null>(null);
        const [commandQueue] = useState<EditCommand[]>([]);
        const cellChangesRef = useRef<Map<string, any>>(new Map());

        function reactGridReady(reactGrid: SlickgridReactInstance) {
            reactGridRef.current = reactGrid;
        }

        // Clear all change tracking (called after successful save)
        function clearAllChangeTracking() {
            cellChangesRef.current.clear();
            // Force grid to re-render to remove all yellow backgrounds
            if (reactGridRef.current?.slickGrid) {
                reactGridRef.current.slickGrid.invalidate();
                reactGridRef.current.slickGrid.render();
            }
        }

        // Expose methods to parent via ref
        useImperativeHandle(ref, () => ({
            clearAllChangeTracking,
        }));

        // Handle page size changes
        useEffect(() => {
            if (reactGridRef.current?.paginationService && pageSize) {
                void reactGridRef.current.paginationService.changeItemPerPage(pageSize);
            }
        }, [pageSize]);

        function handleCellChange(_e: CustomEvent, args: any) {
            const rowIndex = args.row;
            const cellIndex = args.cell; // The actual cell index in the grid
            const columnIndex = cellIndex - 1; // -1 because first column is row number
            const column = columns[cellIndex]; // Use cellIndex to get the correct column
            const rowId = args.item.id; // Use the actual row ID from the data

            console.log(
                `Cell Changed - Row: ${rowIndex}, Cell: ${cellIndex}, Column Index: ${columnIndex}`,
            );
            console.log(`Column ID: ${column?.id}, Field: ${column?.field}`);
            console.log(`New Value: ${args.item[column?.field]}`);

            // Store the change with a unique key (rowId-columnIndex)
            // Use rowId (actual data row ID) instead of rowIndex (visual position) for consistency across pages
            const changeKey = `${rowId}-${columnIndex}`;
            cellChangesRef.current.set(changeKey, {
                rowId,
                rowIndex,
                columnIndex,
                columnId: column?.id,
                field: column?.field,
                newValue: args.item[column?.field],
                item: args.item,
            });

            console.log(`Total changes tracked: ${cellChangesRef.current.size}`);

            // Call the updateCell reducer to update the backend edit session
            if (onUpdateCell) {
                const newValue = args.item[column?.field];
                onUpdateCell(rowId, columnIndex, newValue);
            }

            // Force grid to re-render to show background color change
            if (reactGridRef.current?.slickGrid) {
                reactGridRef.current.slickGrid.invalidate();
                reactGridRef.current.slickGrid.render();
            }
        }

        function handleContextMenuCommand(_e: any, args: any) {
            const command = args.command;
            const dataContext = args.dataContext;
            const rowId = dataContext.id; // Use actual row ID from data

            switch (command) {
                case "delete-row":
                    if (onDeleteRow) {
                        onDeleteRow(rowId);
                    }

                    // Note: Don't remove from grid here - let the backend update state.resultSet
                    // which will trigger the useEffect to rebuild the dataset with correct pagination

                    // Also remove any tracked changes for this row using row ID
                    const keysToDelete: string[] = [];
                    cellChangesRef.current.forEach((_, key) => {
                        if (key.startsWith(`${rowId}-`)) {
                            keysToDelete.push(key);
                        }
                    });
                    keysToDelete.forEach((key) => cellChangesRef.current.delete(key));
                    break;

                case "revert-cell":
                    const cellIndex = args.cell;
                    const columnIndex = cellIndex - 1; // -1 because first column is row number
                    const changeKey = `${rowId}-${columnIndex}`;

                    // Call the revertCell reducer to revert in the backend
                    if (onRevertCell) {
                        onRevertCell(rowId, columnIndex);
                    }

                    // Clear the change tracking for this cell
                    cellChangesRef.current.delete(changeKey);

                    // The backend will update state.resultSet with the reverted value
                    // The useEffect will rebuild the dataset with the correct value from backend
                    // Force grid to re-render to remove yellow background
                    if (reactGridRef.current?.slickGrid) {
                        reactGridRef.current.slickGrid.invalidate();
                        reactGridRef.current.slickGrid.render();
                    }

                    console.log(`Reverted cell for row ID ${rowId}, column ${columnIndex}`);
                    break;

                case "revert-row":
                    // Call the revertRow reducer to revert in the backend
                    if (onRevertRow) {
                        onRevertRow(rowId);
                    }

                    // Clear the change tracking for all cells in this row using row ID
                    const keysToDeleteForRevert: string[] = [];
                    cellChangesRef.current.forEach((_, key) => {
                        if (key.startsWith(`${rowId}-`)) {
                            keysToDeleteForRevert.push(key);
                        }
                    });
                    keysToDeleteForRevert.forEach((key) => cellChangesRef.current.delete(key));

                    // The backend will update state.resultSet with the reverted row
                    // The useEffect will rebuild the dataset with the correct values from backend
                    // Force grid to re-render to remove yellow backgrounds
                    if (reactGridRef.current?.slickGrid) {
                        reactGridRef.current.slickGrid.invalidate();
                        reactGridRef.current.slickGrid.render();
                    }

                    console.log(`Reverted row with ID ${rowId}`);
                    break;
            }
        }

        function getContextMenuOptions(): ContextMenu {
            return {
                hideCopyCellValueCommand: true,
                hideCloseButton: true,
                commandItems: [
                    {
                        command: "delete-row",
                        title: loc.tableExplorer.deleteRow,
                        iconCssClass: "mdi mdi-close",
                        cssClass: "red",
                        textCssClass: "bold",
                        positionOrder: 1,
                    },
                    {
                        command: "revert-cell",
                        title: loc.tableExplorer.revertCell,
                        iconCssClass: "mdi mdi-undo",
                        positionOrder: 2,
                    },
                    {
                        command: "revert-row",
                        title: loc.tableExplorer.revertRow,
                        iconCssClass: "mdi mdi-undo",
                        positionOrder: 3,
                    },
                ],
                onCommand: (e, args) => handleContextMenuCommand(e, args),
            };
        }

        // Convert resultSet data to SlickGrid format (initial setup)
        useEffect(() => {
            if (resultSet?.columnInfo && resultSet?.subset) {
                // Create a simple row number column
                const rowNumberColumn: Column = {
                    id: "rowNumber",
                    name: '<span style="padding-left: 8px;">#</span>',
                    field: "id",
                    excludeFromColumnPicker: true,
                    excludeFromGridMenu: true,
                    excludeFromHeaderMenu: true,
                    width: 50,
                    minWidth: 40,
                    maxWidth: 80,
                    sortable: false,
                    resizable: true,
                    focusable: false,
                    selectable: false,
                    formatter: (row: number) => {
                        // Calculate the actual row number accounting for pagination
                        // Get the current page info from the grid
                        const paginationService = reactGridRef.current?.paginationService;
                        const pageNumber = paginationService?.pageNumber ?? 1; // SlickGrid pages are 1-indexed
                        const itemsPerPage = paginationService?.itemsPerPage ?? pageSize;
                        // Subtract 1 from pageNumber since it's 1-indexed
                        const actualRowNumber = (pageNumber - 1) * itemsPerPage + row + 1;
                        return `<span style="color: var(--vscode-foreground); padding-left: 8px;">${actualRowNumber}</span>`;
                    },
                };

                // Create columns using the columnInfo from resultSet
                const dataColumns: Column[] = resultSet.columnInfo.map((colInfo, index) => {
                    const column: Column = {
                        id: `col${index}`,
                        name: colInfo.name,
                        field: `col${index}`,
                        sortable: false,
                        minWidth: 100,
                        formatter: (
                            _row: number,
                            cell: number,
                            value: any,
                            _columnDef: any,
                            dataContext: any,
                        ) => {
                            // Use the actual row ID from dataContext instead of visual row position
                            const rowId = dataContext.id;
                            // The first column is row number, so data columns start at cell 1
                            const changeKey = `${rowId}-${cell - 1}`;
                            const isModified = cellChangesRef.current.has(changeKey);
                            const displayValue = value ?? "";
                            const isNullValue = displayValue === "NULL";

                            // HTML-escape the display value to prevent HTML injection
                            const escapedDisplayValue = displayValue
                                .replace(/&/g, "&amp;")
                                .replace(/</g, "&lt;")
                                .replace(/>/g, "&gt;")
                                .replace(/"/g, "&quot;")
                                .replace(/'/g, "&#039;");

                            const escapedTooltip = escapedDisplayValue;

                            // Style for NULL values (italic and dimmed)
                            const nullStyle = isNullValue
                                ? "font-style: italic; color: var(--vscode-editorGhostText-foreground, #888);"
                                : "";

                            if (isModified) {
                                return `<div title="${escapedTooltip}" style="background-color: var(--vscode-inputValidation-warningBackground, #fffbe6); padding: 2px 4px; height: 100%; width: 100%; box-sizing: border-box; ${nullStyle}">${escapedDisplayValue}</div>`;
                            }
                            return `<span title="${escapedTooltip}" style="${nullStyle}">${escapedDisplayValue}</span>`;
                        },
                    };

                    // Only add editor if the column is editable
                    if (colInfo.isEditable) {
                        column.editor = {
                            model: Editors.text,
                        };
                    }

                    return column;
                });

                // Add row number column as the first column
                const allColumns = [rowNumberColumn, ...dataColumns];
                setColumns(allColumns);

                // Convert rows to dataset
                const convertedDataset = resultSet.subset.map((row) => {
                    const dataRow: any = {
                        id: row.id,
                    };
                    row.cells.forEach((cell, cellIndex) => {
                        // Display "NULL" for null cells or empty displayValue
                        // Check both isNull flag and if displayValue is empty/null/undefined
                        const cellValue =
                            cell.isNull || !cell.displayValue ? "NULL" : cell.displayValue;
                        dataRow[`col${cellIndex}`] = cellValue;

                        // Debug logging for first row to understand data structure
                        if (row.id === 0 || (row.isDirty && row.state === 1)) {
                            console.log(
                                `Row ${row.id}, Cell ${cellIndex}: isNull=${cell.isNull}, displayValue="${cell.displayValue}", !cell.displayValue=${!cell.displayValue}, final="${cellValue}", dataRow.col${cellIndex}="${dataRow[`col${cellIndex}`]}"`,
                            );
                        }
                    });
                    console.log(`Row ${row.id} dataRow:`, dataRow);
                    return dataRow;
                });
                setDataset(convertedDataset);

                // Set grid options
                setOptions({
                    enableColumnPicker: false,
                    enableGridMenu: false,
                    autoEdit: false,
                    autoCommitEdit: false,
                    editable: true,
                    enableAutoResize: true,
                    autoResize: {
                        container: "#grid-container",
                        calculateAvailableSizeBy: "container",
                    },
                    forceFitColumns: true,
                    enableColumnReorder: false,
                    enableHeaderMenu: false,
                    gridHeight: 400,
                    enableCellNavigation: true,
                    enableSorting: false,
                    enableContextMenu: true,
                    contextMenu: getContextMenuOptions(),
                    enablePagination: true,
                    pagination: {
                        pageSize: pageSize,
                        pageSizes: [10, 50, 100, 1000],
                    },
                    editCommandHandler: (_item, _column, editCommand) => {
                        // Add to command queue for undo functionality
                        commandQueue.push(editCommand);
                        editCommand.execute();
                    },
                    darkMode:
                        themeKind === ColorThemeKind.Dark ||
                        themeKind === ColorThemeKind.HighContrast,
                });
            }
        }, [resultSet, themeKind, commandQueue, pageSize]);

        if (!resultSet || columns.length === 0 || !options) {
            return null;
        }

        const isDarkMode =
            themeKind === ColorThemeKind.Dark || themeKind === ColorThemeKind.HighContrast;

        return (
            <>
                <style>
                    {`
                    .table-explorer-grid-container {
                        margin-bottom: 60px;
                        padding-bottom: 20px;
                        width: 100vw;
                        max-width: 100%;
                    }

                    #tableExplorerGrid {
                        --slick-border-color: ${isDarkMode ? "#3e3e3e" : "#d4d4d4"};
                        --slick-cell-border-right: 1px solid var(--slick-border-color);
                        --slick-cell-border-top: 1px solid var(--slick-border-color);
                        --slick-cell-border-bottom: 0;
                        --slick-cell-border-left: 0;
                        --slick-cell-box-shadow: none;
                        --slick-grid-border-color: var(--slick-border-color);
                        width: 100%;
                        max-width: 100%;
                    }

                    #tableExplorerGrid .slick-viewport {
                        overflow-x: hidden !important;
                    }

                    #tableExplorerGrid .slick-cell {
                        display: flex;
                        align-items: center;
                    }

                    /* Reposition pagination footer to the left */
                    #pager {
                        width: 100%;
                        max-width: 100%;
                        box-sizing: border-box;
                    }

                    #pager .slick-pagination {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-top: 10px;
                        margin-bottom: 20px;
                        padding: 8px 0;
                        padding-right: 40px;
                    }

                    #pager .slick-pagination .slick-pagination-nav .pagination {
                        padding-left: 0px;
                    }

                    #pager .slick-pagination .slick-pagination-status {
                        order: 3;
                        margin-left: 10px;
                    }
                    `}
                </style>
                <div
                    id="grid-container"
                    className={`table-explorer-grid-container ${isDarkMode ? "dark-mode" : ""}`}>
                    <SlickgridReact
                        gridId="tableExplorerGrid"
                        columns={columns}
                        options={options}
                        dataset={dataset}
                        onReactGridCreated={($event) => reactGridReady($event.detail)}
                        onCellChange={($event) => handleCellChange($event, $event.detail.args)}
                    />
                </div>
            </>
        );
    },
);
