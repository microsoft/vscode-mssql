/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, {
    useState,
    useEffect,
    useRef,
    useImperativeHandle,
    forwardRef,
    useMemo,
} from "react";
import {
    SlickgridReactInstance,
    Column,
    GridOption,
    SlickgridReact,
    Editors,
    ContextMenu,
} from "slickgrid-react";
import { EditSubsetResult } from "../../../sharedInterfaces/tableExplorer";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import { locConstants as loc } from "../../common/locConstants";
import TableExplorerCustomPager from "./TableExplorerCustomPager";
import "@slickgrid-universal/common/dist/styles/css/slickgrid-theme-default.css";

interface TableDataGridProps {
    resultSet: EditSubsetResult | undefined;
    themeKind?: ColorThemeKind;
    pageSize?: number;
    currentRowCount?: number;
    onDeleteRow?: (rowId: number) => void;
    onUpdateCell?: (rowId: number, columnId: number, newValue: string) => void;
    onRevertCell?: (rowId: number, columnId: number) => void;
    onRevertRow?: (rowId: number) => void;
    onLoadSubset?: (rowCount: number) => void;
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
            currentRowCount,
            onDeleteRow,
            onUpdateCell,
            onRevertCell,
            onRevertRow,
            onLoadSubset,
        },
        ref,
    ) => {
        const [columns, setColumns] = useState<Column[]>([]);
        const [options, setOptions] = useState<GridOption | undefined>(undefined);
        const [dataset, setDataset] = useState<any[]>([]);
        const reactGridRef = useRef<SlickgridReactInstance | null>(null);
        const cellChangesRef = useRef<Map<string, any>>(new Map());
        const lastPageRef = useRef<number>(1);
        const lastItemsPerPageRef = useRef<number>(pageSize);
        const previousResultSetRef = useRef<EditSubsetResult | undefined>(undefined);
        const isInitializedRef = useRef<boolean>(false);

        // Create a custom pager component with bound props
        const BoundCustomPager = useMemo(
            () =>
                React.forwardRef<any, any>((pagerProps, pagerRef) => (
                    <TableExplorerCustomPager
                        ref={pagerRef}
                        {...pagerProps}
                        currentRowCount={currentRowCount}
                        onLoadSubset={onLoadSubset}
                    />
                )),
            [currentRowCount, onLoadSubset],
        );

        function reactGridReady(reactGrid: SlickgridReactInstance) {
            reactGridRef.current = reactGrid;
            isInitializedRef.current = true;
        }

        // Clear all change tracking (called after successful save)
        function clearAllChangeTracking() {
            cellChangesRef.current.clear();
            // Force grid to re-render to remove all yellow backgrounds
            if (reactGridRef.current?.slickGrid) {
                reactGridRef.current.slickGrid.invalidate();
            }
        }

        // Expose methods to parent via ref
        useImperativeHandle(ref, () => ({
            clearAllChangeTracking,
        }));

        // Convert a single row to grid format
        function convertRowToDataRow(row: any): any {
            const dataRow: any = {
                id: row.id,
            };
            row.cells.forEach((cell: any, cellIndex: number) => {
                const cellValue = cell.isNull || !cell.displayValue ? "NULL" : cell.displayValue;
                dataRow[`col${cellIndex}`] = cellValue;
            });
            return dataRow;
        }

        // Create columns from columnInfo
        function createColumns(columnInfo: any[]): Column[] {
            // Row number column
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
                    const paginationService = reactGridRef.current?.paginationService;
                    const pageNumber = paginationService?.pageNumber ?? 1;
                    const itemsPerPage = paginationService?.itemsPerPage ?? pageSize;
                    const actualRowNumber = (pageNumber - 1) * itemsPerPage + row + 1;
                    return `<span style="color: var(--vscode-foreground); padding-left: 8px;">${actualRowNumber}</span>`;
                },
            };

            // Data columns
            const dataColumns: Column[] = columnInfo.map((colInfo, index) => {
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
                        const rowId = dataContext.id;
                        const changeKey = `${rowId}-${cell - 1}`;
                        const isModified = cellChangesRef.current.has(changeKey);
                        const displayValue = value ?? "";
                        const isNullValue = displayValue === "NULL";

                        const escapedDisplayValue = displayValue
                            .replace(/&/g, "&amp;")
                            .replace(/</g, "&lt;")
                            .replace(/>/g, "&gt;")
                            .replace(/"/g, "&quot;")
                            .replace(/'/g, "&#039;");

                        const escapedTooltip = escapedDisplayValue;

                        const nullStyle = isNullValue
                            ? "font-style: italic; color: var(--vscode-editorGhostText-foreground, #888);"
                            : "";

                        if (isModified) {
                            return `<div title="${escapedTooltip}" style="background-color: var(--vscode-inputValidation-warningBackground, #fffbe6); padding: 2px 4px; height: 100%; width: 100%; box-sizing: border-box; ${nullStyle}">${escapedDisplayValue}</div>`;
                        }
                        return `<span title="${escapedTooltip}" style="${nullStyle}">${escapedDisplayValue}</span>`;
                    },
                };

                if (colInfo.isEditable) {
                    column.editor = {
                        model: Editors.text,
                    };
                }

                return column;
            });

            return [rowNumberColumn, ...dataColumns];
        }

        // Handle page size changes from props
        useEffect(() => {
            if (reactGridRef.current?.paginationService && pageSize) {
                void reactGridRef.current.paginationService.changeItemPerPage(pageSize);
            }
        }, [pageSize]);

        // Main effect: Handle resultSet changes
        useEffect(() => {
            if (!resultSet?.columnInfo || !resultSet?.subset) {
                return;
            }

            const previousResultSet = previousResultSetRef.current;
            const isInitialLoad = !isInitializedRef.current || !previousResultSet;
            const columnCountChanged =
                previousResultSet?.columnInfo?.length !== resultSet.columnInfo.length;
            const rowCountChanged = previousResultSet?.subset?.length !== resultSet.subset.length;

            console.log(
                `ResultSet update - Initial: ${isInitialLoad}, Columns changed: ${columnCountChanged}, Rows changed: ${rowCountChanged}`,
            );

            // Scenario 1: Initial load or structural changes - full recreation
            if (isInitialLoad || columnCountChanged) {
                console.log("Full grid initialization");

                const newColumns = createColumns(resultSet.columnInfo);
                setColumns(newColumns);

                const convertedDataset = resultSet.subset.map(convertRowToDataRow);
                setDataset(convertedDataset);

                // Set grid options only on initial load
                if (!options) {
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
                        gridHeight: window.innerHeight - 150,
                        enableCellNavigation: true,
                        enableSorting: false,
                        enableContextMenu: true,
                        contextMenu: getContextMenuOptions(),
                        customPaginationComponent: BoundCustomPager,
                        enablePagination: true,
                        pagination: {
                            pageSize: pageSize,
                            pageSizes: [10, 50, 100, 1000],
                        },
                        editCommandHandler: (_item, _column, editCommand) => {
                            editCommand.execute();
                        },
                        darkMode:
                            themeKind === ColorThemeKind.Dark ||
                            themeKind === ColorThemeKind.HighContrast,
                    });
                }
            }
            // Scenario 2: Row count changed (delete/add operations) - full dataset refresh
            else if (rowCountChanged) {
                console.log("Row count changed - refreshing dataset");
                const convertedDataset = resultSet.subset.map(convertRowToDataRow);
                setDataset(convertedDataset);
            }
            // Scenario 3: Row count same - incremental updates only
            else if (reactGridRef.current?.dataView) {
                console.log("Incremental update - checking for changed rows");
                let hasChanges = false;

                // Check each row for changes
                for (let i = 0; i < resultSet.subset.length; i++) {
                    const newRow = resultSet.subset[i];
                    const oldRow = previousResultSet?.subset[i];

                    // Compare row data
                    if (!oldRow || JSON.stringify(newRow) !== JSON.stringify(oldRow)) {
                        const dataRow = convertRowToDataRow(newRow);
                        const existingItem = reactGridRef.current.dataView.getItemById(dataRow.id);

                        if (existingItem) {
                            // Update existing row incrementally
                            console.log(`Updating row ${dataRow.id} incrementally`);
                            reactGridRef.current.dataView.updateItem(dataRow.id, dataRow);
                            hasChanges = true;
                        }
                    }
                }

                // Only invalidate if there were actual changes
                if (hasChanges && reactGridRef.current?.slickGrid) {
                    reactGridRef.current.slickGrid.invalidate();
                }
            }

            previousResultSetRef.current = resultSet;
        }, [resultSet, options, themeKind, pageSize]);

        // Restore pagination after dataset changes
        useEffect(() => {
            if (!reactGridRef.current?.paginationService || dataset.length === 0) {
                return;
            }

            const targetPage = lastPageRef.current;
            const targetItemsPerPage = lastItemsPerPageRef.current;

            // Small delay to ensure grid is ready
            const timeoutId = setTimeout(() => {
                if (!reactGridRef.current?.paginationService) return;

                const currentPage = reactGridRef.current.paginationService.pageNumber;
                const currentItemsPerPage = reactGridRef.current.paginationService.itemsPerPage;

                if (currentItemsPerPage !== targetItemsPerPage) {
                    console.log(`Restoring items per page to: ${targetItemsPerPage}`);
                    void reactGridRef.current.paginationService.changeItemPerPage(
                        targetItemsPerPage,
                    );
                }

                if (targetPage > 1 && currentPage !== targetPage) {
                    console.log(`Restoring page to: ${targetPage}`);
                    void reactGridRef.current.paginationService.goToPageNumber(targetPage);
                }
            }, 100);

            return () => clearTimeout(timeoutId);
        }, [dataset]);

        function handleCellChange(_e: CustomEvent, args: any) {
            // Capture pagination state
            if (reactGridRef.current?.paginationService) {
                lastPageRef.current = reactGridRef.current.paginationService.pageNumber;
                lastItemsPerPageRef.current = reactGridRef.current.paginationService.itemsPerPage;
            }

            const cellIndex = args.cell;
            const columnIndex = cellIndex - 1;
            const column = columns[cellIndex];
            const rowId = args.item.id;

            console.log(`Cell Changed - Row ID: ${rowId}, Column Index: ${columnIndex}`);

            // Track the change
            const changeKey = `${rowId}-${columnIndex}`;
            cellChangesRef.current.set(changeKey, {
                rowId,
                columnIndex,
                columnId: column?.id,
                field: column?.field,
                newValue: args.item[column?.field],
            });

            console.log(`Total changes tracked: ${cellChangesRef.current.size}`);

            // Notify parent
            if (onUpdateCell) {
                const newValue = args.item[column?.field];
                onUpdateCell(rowId, columnIndex, newValue);
            }

            // Update the display without full re-render
            if (reactGridRef.current?.slickGrid) {
                reactGridRef.current.slickGrid.invalidate();
            }
        }

        function handleContextMenuCommand(_e: any, args: any) {
            // Capture pagination state
            if (reactGridRef.current?.paginationService) {
                lastPageRef.current = reactGridRef.current.paginationService.pageNumber;
                lastItemsPerPageRef.current = reactGridRef.current.paginationService.itemsPerPage;
            }

            const command = args.command;
            const dataContext = args.dataContext;
            const rowId = dataContext.id;

            switch (command) {
                case "delete-row":
                    if (onDeleteRow) {
                        onDeleteRow(rowId);
                    }

                    // Remove tracked changes for this row
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
                    const columnIndex = cellIndex - 1;
                    const changeKey = `${rowId}-${columnIndex}`;

                    if (onRevertCell) {
                        onRevertCell(rowId, columnIndex);
                    }

                    cellChangesRef.current.delete(changeKey);
                    console.log(`Reverted cell for row ID ${rowId}, column ${columnIndex}`);
                    break;

                case "revert-row":
                    if (onRevertRow) {
                        onRevertRow(rowId);
                    }

                    // Remove tracked changes for this row
                    const keysToDeleteForRevert: string[] = [];
                    cellChangesRef.current.forEach((_, key) => {
                        if (key.startsWith(`${rowId}-`)) {
                            keysToDeleteForRevert.push(key);
                        }
                    });
                    keysToDeleteForRevert.forEach((key) => cellChangesRef.current.delete(key));
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
                        height: 95vh;
                    }

                    #tableExplorerGrid .slick-viewport {
                        overflow-x: hidden !important;
                    }

                    #tableExplorerGrid .slick-cell {
                        display: flex;
                        align-items: center;
                    }

                    /* VS Code-style context menu */
                    .slick-context-menu {
                        background-color: var(--vscode-menu-background) !important;
                        border: 1px solid var(--vscode-menu-border) !important;
                        border-radius: 5px !important;
                        box-shadow: 0 2px 8px var(--vscode-widget-shadow) !important;
                        padding: 4px 0 !important;
                        min-width: 180px !important;
                    }

                    .slick-context-menu .slick-menu-item {
                        background-color: transparent !important;
                        color: var(--vscode-menu-foreground) !important;
                        padding: 4px 20px 4px 30px !important;
                        line-height: 22px !important;
                        font-size: 13px !important;
                        border: none !important;
                        cursor: pointer !important;
                        position: relative !important;
                        display: flex !important;
                        align-items: center !important;
                        white-space: nowrap !important;
                    }

                    .slick-context-menu .slick-menu-item:hover {
                        background-color: var(--vscode-menu-selectionBackground) !important;
                        color: var(--vscode-menu-selectionForeground) !important;
                    }

                    .slick-context-menu .slick-menu-item .slick-menu-icon {
                        position: absolute !important;
                        left: 8px !important;
                        width: 16px !important;
                        height: 16px !important;
                        display: flex !important;
                        align-items: center !important;
                        justify-content: center !important;
                    }

                    .slick-context-menu .slick-menu-item .slick-menu-content {
                        flex: 1 !important;
                        padding: 0 !important;
                        margin: 0 !important;
                    }

                    .slick-context-menu .slick-menu-item.red {
                        color: var(--vscode-menu-foreground) !important;
                    }

                    .slick-context-menu .slick-menu-item.red:hover {
                        color: var(--vscode-menu-selectionForeground) !important;
                    }

                    .slick-context-menu .slick-menu-item .mdi {
                        color: var(--vscode-menu-foreground) !important;
                        font-size: 16px !important;
                    }

                    .slick-context-menu .slick-menu-item:hover .mdi {
                        color: var(--vscode-menu-selectionForeground) !important;
                    }

                    .slick-context-menu .slick-menu-item.bold,
                    .slick-context-menu .slick-menu-item .bold {
                        font-weight: normal !important;
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
