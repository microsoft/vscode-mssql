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
    createDomElement,
    htmlEncode,
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
    deletedRows?: number[];
    onDeleteRow?: (rowId: number) => void;
    onUpdateCell?: (rowId: number, columnId: number, newValue: string) => void;
    onRevertCell?: (rowId: number, columnId: number) => void;
    onRevertRow?: (rowId: number) => void;
    onLoadSubset?: (rowCount: number) => void;
    onCellChangeCountChanged?: (count: number) => void;
    onDeletionCountChanged?: (count: number) => void;
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
            failedCells,
            deletedRows,
            onDeleteRow,
            onUpdateCell,
            onRevertCell,
            onRevertRow,
            onCellChangeCountChanged,
            onDeletionCountChanged,
        },
        ref,
    ) => {
        const [columns, setColumns] = useState<Column[]>([]);
        const [options, setOptions] = useState<GridOption | undefined>(undefined);
        const [dataset, setDataset] = useState<any[]>([]);
        const [currentTheme, setCurrentTheme] = useState<ColorThemeKind | undefined>(themeKind);
        const reactGridRef = useRef<SlickgridReactInstance | null>(null);
        const cellChangesRef = useRef<Map<string, any>>(new Map());
        const deletedRowsRef = useRef<Set<number>>(new Set());
        const failedCellsRef = useRef<Set<string>>(new Set());
        const lastPageRef = useRef<number>(1);
        const lastItemsPerPageRef = useRef<number>(pageSize);
        const previousResultSetRef = useRef<EditSubsetResult | undefined>(undefined);
        const isInitializedRef = useRef<boolean>(false);

        // Create a custom pager component
        const BoundCustomPager = useMemo(
            () =>
                React.forwardRef<any, any>((pagerProps, pagerRef) => (
                    <TableExplorerCustomPager ref={pagerRef} {...pagerProps} />
                )),
            [],
        );

        function reactGridReady(reactGrid: SlickgridReactInstance) {
            reactGridRef.current = reactGrid;
            isInitializedRef.current = true;
        }

        // Clear all change tracking (called after successful save)
        function clearAllChangeTracking() {
            cellChangesRef.current.clear();
            deletedRowsRef.current.clear();
            failedCellsRef.current.clear();

            // Force grid to re-render to remove all colored backgrounds
            if (reactGridRef.current?.slickGrid) {
                reactGridRef.current.slickGrid.invalidate();
            }

            // Notify parent of change count update
            if (onCellChangeCountChanged) {
                onCellChangeCountChanged(0);
            }
            if (onDeletionCountChanged) {
                onDeletionCountChanged(0);
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
        }));

        // Convert a single row to grid format
        function convertRowToDataRow(row: any, columnInfo?: any[]): any {
            const dataRow: any = {
                id: row.id,
            };
            row.cells.forEach((cell: any, cellIndex: number) => {
                let cellValue: string;
                if (cell.isNull) {
                    cellValue = "NULL";
                } else if (!cell.displayValue) {
                    const isNullable = columnInfo?.[cellIndex]?.isNullable !== false;
                    cellValue = isNullable ? "NULL" : "";
                } else {
                    cellValue = cell.displayValue;
                }
                dataRow[`col${cellIndex}`] = cellValue;
            });
            return dataRow;
        }

        // Create columns from columnInfo
        function createColumns(columnInfo: any[]): Column[] {
            // Action columns (delete and undo)
            const actionColumns: Column[] = [
                {
                    id: "delete",
                    field: "id",
                    name: "",
                    excludeFromColumnPicker: true,
                    excludeFromGridMenu: true,
                    excludeFromHeaderMenu: true,
                    formatter: (
                        _row: number,
                        _cell: number,
                        _value: any,
                        _columnDef: any,
                        dataContext: any,
                    ) => {
                        const rowId = dataContext.id;
                        const isDeleted = deletedRowsRef.current.has(rowId);
                        const iconClass = isDeleted
                            ? "mdi mdi-trash-can action-icon disabled"
                            : "mdi mdi-trash-can action-icon pointer";
                        return createDomElement("i", {
                            className: iconClass,
                            title: isDeleted ? "" : loc.tableExplorer.deleteRow,
                        });
                    },
                    minWidth: 30,
                    maxWidth: 30,
                },
                {
                    id: "undo",
                    field: "id",
                    name: "",
                    excludeFromColumnPicker: true,
                    excludeFromGridMenu: true,
                    excludeFromHeaderMenu: true,
                    formatter: (
                        _row: number,
                        _cell: number,
                        _value: any,
                        _columnDef: any,
                        dataContext: any,
                    ) => {
                        const rowId = dataContext.id;
                        const isDeleted = deletedRowsRef.current.has(rowId);
                        const iconClass = isDeleted
                            ? "mdi mdi-undo action-icon pointer"
                            : "mdi mdi-undo action-icon disabled";
                        return createDomElement("i", {
                            className: iconClass,
                            title: isDeleted ? loc.tableExplorer.revertRow : "",
                        });
                    },
                    minWidth: 30,
                    maxWidth: 30,
                },
            ];

            // Data columns
            const dataColumns: Column[] = columnInfo.map((colInfo, index) => {
                const column: Column = {
                    id: `col${index}`,
                    name: colInfo.name,
                    field: `col${index}`,
                    sortable: false,
                    minWidth: 98, // Reduced by 2px to account for border alignment
                    formatter: (
                        _row: number,
                        cell: number,
                        value: any,
                        _columnDef: any,
                        dataContext: any,
                    ) => {
                        const rowId = dataContext.id;
                        const changeKey = `${rowId}-${cell}`;
                        const isModified = cellChangesRef.current.has(changeKey);
                        const hasFailed = failedCellsRef.current.has(changeKey);
                        const displayValue = value ?? "";
                        const isNullValue = displayValue === "NULL";
                        const escapedTooltip = htmlEncode(displayValue);

                        // Build CSS classes based on cell state
                        const cellClasses = [];

                        // Failed cells get error styling
                        if (hasFailed) {
                            cellClasses.push("table-cell-error");
                        }
                        // Modified cells get warning styling
                        else if (isModified) {
                            cellClasses.push("table-cell-modified");
                        }

                        // NULL cells get different styling
                        if (isNullValue) {
                            cellClasses.push("table-cell-null");
                        }

                        const elmType = hasFailed || isModified ? "div" : "span";
                        return createDomElement(elmType, {
                            className: cellClasses.join(" "),
                            title: escapedTooltip,
                            textContent: displayValue,
                        });
                    },
                };

                if (colInfo.isEditable) {
                    column.editor = {
                        model: Editors.text,
                    };
                }

                return column;
            });

            return [...actionColumns, ...dataColumns];
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

        // Sync deleted rows from props to ref and apply CSS classes
        useEffect(() => {
            if (deletedRows !== undefined) {
                deletedRowsRef.current = new Set(deletedRows);

                // Set up row metadata to apply CSS class to deleted rows
                if (reactGridRef.current?.dataView) {
                    const dataView = reactGridRef.current.dataView;

                    // Store the original getItemMetadata if it exists
                    const originalGetItemMetadata = dataView.getItemMetadata;

                    // Override getItemMetadata to add CSS class for deleted rows
                    dataView.getItemMetadata = function (row: number) {
                        // Call original metadata function if it exists
                        const item = dataView.getItem(row);
                        let metadata = originalGetItemMetadata
                            ? originalGetItemMetadata.call(this, row)
                            : null;

                        // Check if this row is deleted
                        if (item && deletedRowsRef.current.has(item.id)) {
                            metadata = metadata || {};
                            metadata.cssClasses = metadata.cssClasses
                                ? `${metadata.cssClasses} deleted-row`
                                : "deleted-row";
                        }

                        return metadata;
                    };

                    // Force grid to re-render with new metadata
                    if (reactGridRef.current?.slickGrid) {
                        reactGridRef.current.slickGrid.invalidate();
                    }
                }
            }
        }, [deletedRows]);

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

                const convertedDataset = resultSet.subset.map((row) =>
                    convertRowToDataRow(row, resultSet.columnInfo),
                );
                setDataset(convertedDataset);

                // Set grid options only on initial load
                if (!options) {
                    // Set row height to 26px for optimal display
                    const ROW_HEIGHT = 26;

                    setOptions({
                        alwaysShowVerticalScroll: false,
                        enableColumnPicker: false,
                        enableGridMenu: false,
                        autoEdit: false,
                        autoCommitEdit: true,
                        editable: true,
                        enableAutoResize: true,
                        autoResize: {
                            container: "#grid-container",
                            bottomPadding: 50, // Reserve space for custom pagination
                            minHeight: 250, // Minimum height to prevent unnecessary scrollbar
                        },
                        forceFitColumns: false, // Allow horizontal scrolling for many columns
                        enableColumnReorder: false,
                        enableHeaderMenu: false,
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
                        rowHeight: ROW_HEIGHT,
                        darkMode:
                            themeKind === ColorThemeKind.Dark ||
                            themeKind === ColorThemeKind.HighContrast,
                    });
                }
            }
            // Scenario 2: Row count changed (delete/add operations) - incremental add/remove
            else if (
                rowCountChanged &&
                reactGridRef.current?.dataView &&
                reactGridRef.current?.gridService
            ) {
                console.log("Row count changed - applying incremental updates");

                // Use ID-based comparison instead of position-based
                const previousIds = new Set(previousResultSet?.subset?.map((r: any) => r.id) || []);
                const currentIds = new Set(resultSet.subset.map((r: any) => r.id));

                // Add new rows (rows in current but not in previous)
                const rowsToAdd = resultSet.subset.filter((row: any) => !previousIds.has(row.id));
                console.log(`Adding ${rowsToAdd.length} new row(s) by ID`);
                for (const newRow of rowsToAdd) {
                    const dataRow = convertRowToDataRow(newRow, resultSet.columnInfo);
                    // Use gridService.addItem with position 'bottom' and scrollRowIntoView
                    // gridService automatically handles pagination updates
                    reactGridRef.current.gridService.addItem(dataRow, {
                        position: "bottom",
                        highlightRow: true,
                        scrollRowIntoView: true,
                        triggerEvent: true,
                    });
                    console.log(`Added row ${dataRow.id} at bottom using gridService`);
                }

                // Remove deleted rows (rows in previous but not in current)
                const rowsToRemove = (previousResultSet?.subset || []).filter(
                    (row: any) => !currentIds.has(row.id),
                );
                console.log(`Removing ${rowsToRemove.length} deleted row(s) by ID`);
                for (const removedRow of rowsToRemove) {
                    reactGridRef.current.gridService.deleteItemById(removedRow.id);
                }
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
                        const dataRow = convertRowToDataRow(newRow, resultSet.columnInfo);
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
            if (
                !reactGridRef.current?.paginationService ||
                !reactGridRef.current?.dataView ||
                dataset.length === 0
            ) {
                return;
            }

            const targetPage = lastPageRef.current;
            const targetItemsPerPage = lastItemsPerPageRef.current;
            const currentPage = reactGridRef.current.paginationService.pageNumber;
            const currentItemsPerPage = reactGridRef.current.paginationService.itemsPerPage;

            if (currentItemsPerPage !== targetItemsPerPage) {
                console.log(`Restoring items per page to: ${targetItemsPerPage}`);
                void reactGridRef.current.paginationService.changeItemPerPage(targetItemsPerPage);
            }

            if (targetPage > 1 && currentPage !== targetPage) {
                console.log(`Restoring page to: ${targetPage}`);
                void reactGridRef.current.paginationService.goToPageNumber(targetPage);
            }
        }, [dataset]);

        function handleCellChange(_e: CustomEvent, args: any) {
            // Capture pagination state
            if (reactGridRef.current?.paginationService) {
                lastPageRef.current = reactGridRef.current.paginationService.pageNumber;
                lastItemsPerPageRef.current = reactGridRef.current.paginationService.itemsPerPage;
            }

            const cellIndex = args.cell;
            const columnIndex = cellIndex;
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

        function handleDeleteRow(rowId: number) {
            // Only handle if row is not already deleted
            if (deletedRowsRef.current.has(rowId)) {
                return;
            }

            // Capture pagination state
            if (reactGridRef.current?.paginationService) {
                lastPageRef.current = reactGridRef.current.paginationService.pageNumber;
                lastItemsPerPageRef.current = reactGridRef.current.paginationService.itemsPerPage;
            }

            if (onDeleteRow) {
                onDeleteRow(rowId);
            }

            // Track the deletion
            deletedRowsRef.current.add(rowId);

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
            if (onDeletionCountChanged) {
                onDeletionCountChanged(deletedRowsRef.current.size);
            }

            // Refresh the grid to update button states
            if (reactGridRef.current?.slickGrid) {
                reactGridRef.current.slickGrid.invalidate();
            }
        }

        function handleUndoDelete(rowId: number) {
            // Only handle if row is deleted
            if (!deletedRowsRef.current.has(rowId)) {
                return;
            }

            // Capture pagination state
            if (reactGridRef.current?.paginationService) {
                lastPageRef.current = reactGridRef.current.paginationService.pageNumber;
                lastItemsPerPageRef.current = reactGridRef.current.paginationService.itemsPerPage;
            }

            if (onRevertRow) {
                onRevertRow(rowId);
            }

            // Remove from deletion tracking
            deletedRowsRef.current.delete(rowId);

            // Notify parent of deletion count update
            if (onDeletionCountChanged) {
                onDeletionCountChanged(deletedRowsRef.current.size);
            }

            // Refresh the grid to update button states
            if (reactGridRef.current?.slickGrid) {
                reactGridRef.current.slickGrid.invalidate();
            }
        }

        function handleCellClick(_e: Event, args: any) {
            const metadata = reactGridRef.current?.gridService.getColumnFromEventArguments(args);
            const rowId = metadata?.dataContext?.id;

            if (metadata?.columnDef.id === "delete") {
                handleDeleteRow(rowId);
            } else if (metadata?.columnDef.id === "undo") {
                handleUndoDelete(rowId);
            }
        }

        function handleKeyDown(e: KeyboardEvent, args: any) {
            // Only handle Enter key
            if (e.key !== "Enter") {
                return;
            }

            const grid = reactGridRef.current?.slickGrid;
            if (!grid) {
                return;
            }

            const activeCell = grid.getActiveCell();
            if (!activeCell) {
                return;
            }

            const column = columns[activeCell.cell];
            if (!column) {
                return;
            }

            // Check if the active cell is in the delete or undo column
            if (column.id === "delete" || column.id === "undo") {
                const dataItem = grid.getDataItem(activeCell.row);
                if (!dataItem) {
                    return;
                }

                const rowId = dataItem.id;

                if (column.id === "delete") {
                    handleDeleteRow(rowId);
                } else if (column.id === "undo") {
                    handleUndoDelete(rowId);
                }

                // Prevent default behavior (e.g., editing the cell)
                e.preventDefault();
                e.stopPropagation();
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

                    // Track the deletion
                    deletedRowsRef.current.add(rowId);

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
                    if (onDeletionCountChanged) {
                        onDeletionCountChanged(deletedRowsRef.current.size);
                    }
                    break;

                case "revert-cell":
                    const cellIndex = args.cell;
                    const columnIndex = cellIndex;
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

                    // Remove from deletion tracking if it was deleted
                    deletedRowsRef.current.delete(rowId);

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
                    if (onDeletionCountChanged) {
                        onDeletionCountChanged(deletedRowsRef.current.size);
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
                        itemVisibilityOverride: (args: any) => {
                            // Hide "Delete Row" if row is already deleted
                            const rowId = args.dataContext?.id;
                            return !deletedRowsRef.current.has(rowId);
                        },
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
                    onClick={($event) =>
                        handleCellClick($event.detail.eventData, $event.detail.args)
                    }
                    onKeyDown={($event) =>
                        handleKeyDown($event.detail.eventData, $event.detail.args)
                    }
                />
            </div>
        );
    },
);
