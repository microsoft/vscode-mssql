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
import "./TableDataGrid.css";

interface TableDataGridProps {
    resultSet: EditSubsetResult | undefined;
    themeKind?: ColorThemeKind;
    pageSize?: number;
    currentRowCount?: number;
    failedCells?: string[];
    onDeleteRow?: (rowId: number) => void;
    onUpdateCell?: (rowId: number, columnId: number, newValue: string) => void;
    onRevertCell?: (rowId: number, columnId: number) => void;
    onRevertRow?: (rowId: number) => void;
    onLoadSubset?: (rowCount: number) => void;
    onCellChangeCountChanged?: (count: number) => void;
}

export interface TableDataGridRef {
    clearAllChangeTracking: () => void;
    getCellChangeCount: () => number;
    goToLastPage: () => void;
    goToFirstPage: () => void;
}

export const TableDataGrid = forwardRef<TableDataGridRef, TableDataGridProps>(
    (
        {
            resultSet,
            themeKind,
            pageSize = 100,
            currentRowCount,
            failedCells,
            onDeleteRow,
            onUpdateCell,
            onRevertCell,
            onRevertRow,
            onLoadSubset,
            onCellChangeCountChanged,
        },
        ref,
    ) => {
        const [columns, setColumns] = useState<Column[]>([]);
        const [options, setOptions] = useState<GridOption | undefined>(undefined);
        const [dataset, setDataset] = useState<any[]>([]);
        const [currentTheme, setCurrentTheme] = useState<ColorThemeKind | undefined>(themeKind);
        const reactGridRef = useRef<SlickgridReactInstance | null>(null);
        const cellChangesRef = useRef<Map<string, any>>(new Map());
        const failedCellsRef = useRef<Set<string>>(new Set());
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
            failedCellsRef.current.clear();
            // Force grid to re-render to remove all colored backgrounds
            if (reactGridRef.current?.slickGrid) {
                reactGridRef.current.slickGrid.invalidate();
            }

            // Notify parent of change count update
            if (onCellChangeCountChanged) {
                onCellChangeCountChanged(0);
            }
        }

        // Expose methods to parent via ref
        useImperativeHandle(ref, () => ({
            clearAllChangeTracking,
            getCellChangeCount: () => cellChangesRef.current.size,
            goToLastPage: () => {
                if (reactGridRef.current?.paginationService && reactGridRef.current?.dataView) {
                    const totalItems = reactGridRef.current.dataView.getLength();
                    const itemsPerPage = reactGridRef.current.paginationService.itemsPerPage;
                    const lastPage = Math.ceil(totalItems / itemsPerPage);
                    void reactGridRef.current.paginationService.goToPageNumber(lastPage);
                }
            },
            goToFirstPage: () => {
                if (reactGridRef.current?.paginationService) {
                    void reactGridRef.current.paginationService.goToPageNumber(1);
                }
            },
        })); // Convert a single row to grid format
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
                name: '<span class="table-row-number">#</span>',
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
                    return `<span class="table-row-number">${actualRowNumber}</span>`;
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
                        const hasFailed = failedCellsRef.current.has(changeKey);
                        const displayValue = value ?? "";
                        const isNullValue = displayValue === "NULL";

                        // Safely escape HTML entities (with null/undefined check)
                        const escapedDisplayValue =
                            displayValue && typeof displayValue === "string"
                                ? displayValue
                                      .replace(/&/g, "&amp;")
                                      .replace(/</g, "&lt;")
                                      .replace(/>/g, "&gt;")
                                      .replace(/"/g, "&quot;")
                                      .replace(/'/g, "&#039;")
                                : String(displayValue || "");

                        const escapedTooltip = escapedDisplayValue;

                        // Build CSS classes based on cell state
                        const cellClasses = [];
                        if (hasFailed) {
                            cellClasses.push("table-cell-error");
                        } else if (isModified) {
                            cellClasses.push("table-cell-modified");
                        }

                        if (isNullValue) {
                            cellClasses.push("table-cell-null");
                        }

                        const classAttr =
                            cellClasses.length > 0 ? ` class="${cellClasses.join(" ")}"` : "";

                        // Failed cells get error styling
                        if (hasFailed) {
                            return `<div title="${escapedTooltip}"${classAttr}>${escapedDisplayValue}</div>`;
                        }
                        // Modified cells get warning styling
                        if (isModified) {
                            return `<div title="${escapedTooltip}"${classAttr}>${escapedDisplayValue}</div>`;
                        }
                        // Normal cells
                        return `<span title="${escapedTooltip}"${classAttr}>${escapedDisplayValue}</span>`;
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

        // Sync failed cells from props to ref (convert array to Set for fast lookups)
        useEffect(() => {
            if (failedCells) {
                failedCellsRef.current = new Set(failedCells);
                // Force grid to re-render to update cell colors
                if (reactGridRef.current?.slickGrid) {
                    reactGridRef.current.slickGrid.invalidate();
                }
            }
        }, [failedCells]);

        // Handle theme changes - just update state to trigger re-render
        useEffect(() => {
            if (themeKind !== currentTheme) {
                console.log("Theme changed - triggering re-render");
                setCurrentTheme(themeKind);
            }
        }, [themeKind, currentTheme]);

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

            // Notify parent of change count update
            if (onCellChangeCountChanged) {
                onCellChangeCountChanged(cellChangesRef.current.size);
            }

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

                    // Remove tracked changes and failed cells for this row
                    const keysToDelete: string[] = [];
                    cellChangesRef.current.forEach((_, key) => {
                        if (key.startsWith(`${rowId}-`)) {
                            keysToDelete.push(key);
                        }
                    });
                    keysToDelete.forEach((key) => {
                        cellChangesRef.current.delete(key);
                        failedCellsRef.current.delete(key);
                    });

                    // Notify parent of change count update
                    if (onCellChangeCountChanged) {
                        onCellChangeCountChanged(cellChangesRef.current.size);
                    }
                    break;

                case "revert-cell":
                    const cellIndex = args.cell;
                    const columnIndex = cellIndex - 1;
                    const changeKey = `${rowId}-${columnIndex}`;

                    if (onRevertCell) {
                        onRevertCell(rowId, columnIndex);
                    }

                    cellChangesRef.current.delete(changeKey);
                    failedCellsRef.current.delete(changeKey);
                    console.log(`Reverted cell for row ID ${rowId}, column ${columnIndex}`);

                    // Notify parent of change count update
                    if (onCellChangeCountChanged) {
                        onCellChangeCountChanged(cellChangesRef.current.size);
                    }
                    break;

                case "revert-row":
                    if (onRevertRow) {
                        onRevertRow(rowId);
                    }

                    // Remove tracked changes and failed cells for this row
                    const keysToDeleteForRevert: string[] = [];
                    cellChangesRef.current.forEach((_, key) => {
                        if (key.startsWith(`${rowId}-`)) {
                            keysToDeleteForRevert.push(key);
                        }
                    });
                    keysToDeleteForRevert.forEach((key) => {
                        cellChangesRef.current.delete(key);
                        failedCellsRef.current.delete(key);
                    });
                    console.log(`Reverted row with ID ${rowId}`);

                    // Notify parent of change count update
                    if (onCellChangeCountChanged) {
                        onCellChangeCountChanged(cellChangesRef.current.size);
                    }
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
            currentTheme === ColorThemeKind.Dark || currentTheme === ColorThemeKind.HighContrast;

        return (
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
        );
    },
);
