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

            console.log(
                `Cell Changed - Row: ${rowIndex}, Cell: ${cellIndex}, Column Index: ${columnIndex}`,
            );
            console.log(`Column ID: ${column?.id}, Field: ${column?.field}`);
            console.log(`New Value: ${args.item[column?.field]}`);

            // Store the change with a unique key (row-columnIndex)
            // Use columnIndex (which excludes row number column) for consistency with formatter
            const changeKey = `${rowIndex}-${columnIndex}`;
            cellChangesRef.current.set(changeKey, {
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
                const rowId = args.item.id;
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

            switch (command) {
                case "delete-row":
                    if (onDeleteRow) {
                        onDeleteRow(dataContext.id);
                    }

                    // Note: Don't remove from grid here - let the backend update state.resultSet
                    // which will trigger the useEffect to rebuild the dataset with correct pagination

                    // Also remove any tracked changes for this row
                    const keysToDelete: string[] = [];
                    cellChangesRef.current.forEach((_, key) => {
                        if (key.startsWith(`${args.row}-`)) {
                            keysToDelete.push(key);
                        }
                    });
                    keysToDelete.forEach((key) => cellChangesRef.current.delete(key));
                    break;

                case "revert-cell":
                    const rowIndex = args.row;
                    const cellIndex = args.cell;
                    const columnIndex = cellIndex - 1; // -1 because first column is row number
                    const changeKey = `${rowIndex}-${columnIndex}`;

                    // Call the revertCell reducer to revert in the backend
                    if (onRevertCell) {
                        onRevertCell(dataContext.id, columnIndex);
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

                    console.log(`Reverted cell at row ${rowIndex}, column ${columnIndex}`);
                    break;

                case "revert-row":
                    const rowIdx = args.row;

                    // Call the revertRow reducer to revert in the backend
                    if (onRevertRow) {
                        onRevertRow(dataContext.id);
                    }

                    // Clear the change tracking for all cells in this row
                    const keysToDeleteForRevert: string[] = [];
                    cellChangesRef.current.forEach((_, key) => {
                        if (key.startsWith(`${rowIdx}-`)) {
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

                    console.log(`Reverted row at index ${rowIdx}`);
                    break;
            }
        }

        function getContextMenuOptions(): ContextMenu {
            return {
                hideCopyCellValueCommand: true,
                hideCloseButton: false,
                commandTitle: "Commands",
                commandItems: [
                    {
                        command: "delete-row",
                        title: "Delete Row",
                        iconCssClass: "mdi mdi-close",
                        cssClass: "red",
                        textCssClass: "bold",
                        positionOrder: 1,
                    },
                    {
                        command: "revert-cell",
                        title: "Revert Cell",
                        iconCssClass: "mdi mdi-undo",
                        positionOrder: 2,
                    },
                    {
                        command: "revert-row",
                        title: "Revert Row",
                        iconCssClass: "mdi mdi-undo-variant",
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
                    formatter: (row: number) =>
                        `<span style="color: var(--vscode-foreground); padding-left: 8px;">${row + 1}</span>`,
                };

                // Create columns using the columnInfo from resultSet
                const dataColumns: Column[] = resultSet.columnInfo.map((colInfo, index) => {
                    const column: Column = {
                        id: `col${index}`,
                        name: colInfo.name,
                        field: `col${index}`,
                        sortable: false,
                        minWidth: 100,
                        formatter: (row: number, cell: number, value: any) => {
                            // The first column is row number, so data columns start at cell 1
                            const changeKey = `${row}-${cell - 1}`;
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
                                return `<span title="${escapedTooltip}" style="display: block; background-color: var(--vscode-inputValidation-warningBackground, #fffbe6); padding: 2px 4px; height: 100%; ${nullStyle}">${escapedDisplayValue}</span>`;
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
                    autoEdit: false,
                    autoCommitEdit: false,
                    editable: true,
                    enableAutoResize: true,
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
            <div className={`table-explorer-grid-container ${isDarkMode ? "dark-mode" : ""}`}>
                <SlickgridReact
                    gridId="tableExplorerGrid"
                    columns={columns}
                    options={options}
                    dataset={dataset}
                    onReactGridCreated={($event) => reactGridReady($event.detail)}
                    onCellChange={($event) => handleCellChange($event, $event.detail.args)}
                />
            </div>
        );
    },
);
