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
import { FluentCompoundFilter } from "./fluentCompoundFilter";
import { EditSubsetResult, ExportData } from "../../../sharedInterfaces/tableExplorer";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import { locConstants as loc } from "../../common/locConstants";
import TableExplorerCustomPager from "./TableExplorerCustomPager";
import { slickGridLocales } from "./commonGridOptions";
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
    onSelectedRowsChanged?: (selectedRowIds: number[]) => void;
    onSaveResults?: (format: "csv" | "json" | "excel", data: ExportData) => void;
}

export interface TableDataGridRef {
    clearAllChangeTracking: () => void;
    getCellChangeCount: () => number;
    goToLastPage: () => void;
    goToFirstPage: () => void;
    getSelectedRowIds: () => number[];
    clearSelection: () => void;
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
            onSelectedRowsChanged,
            onSaveResults,
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
            getSelectedRowIds: () => {
                if (reactGridRef.current?.dataView) {
                    return reactGridRef.current.dataView.getAllSelectedIds() as number[];
                }
                return [];
            },
            clearSelection: () => {
                if (reactGridRef.current?.slickGrid) {
                    reactGridRef.current.slickGrid.setSelectedRows([]);
                }
            },
        }));

        // Convert a single row to grid format
        function convertRowToDataRow(row: any, columnInfo?: any[], rowIndex?: number): any {
            const dataRow: any = {
                id: row.id,
                _rowNumber: rowIndex !== undefined ? rowIndex + 1 : row.id + 1, // 1-based row numbers
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
        function createColumns(columnInfo: any[], currentThemeKind?: ColorThemeKind): Column[] {
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
                    sortable: true,
                    filterable: true,
                    resizable: true,
                    minWidth: 98,
                    type: "string",
                    filter: {
                        model: FluentCompoundFilter,
                        params: {
                            themeKind: currentThemeKind,
                        },
                    },
                    formatter: (
                        _row: number,
                        _cell: number,
                        value: any,
                        _columnDef: any,
                        dataContext: any,
                    ) => {
                        const rowId = dataContext.id;
                        // Use the data column index (not grid cell index) for change tracking
                        const changeKey = `${rowId}-${index}`;
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

                // Add originalIndex as a custom property for tracking edits with hidden columns
                (column as any).originalIndex = index;

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
                const previousDeletedRows = deletedRowsRef.current;
                deletedRowsRef.current = new Set(deletedRows);

                // When a row is successfully deleted (added to deletedRows prop),
                // clear its cell changes and failed cells
                deletedRows.forEach((rowId) => {
                    if (!previousDeletedRows.has(rowId)) {
                        // This is a newly deleted row
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
                    }
                });

                // Notify parent of deletion count update
                if (onDeletionCountChanged) {
                    onDeletionCountChanged(deletedRows.length);
                }

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

                const newColumns = createColumns(resultSet.columnInfo, currentTheme);
                setColumns(newColumns);

                const convertedDataset = resultSet.subset.map((row, index) =>
                    convertRowToDataRow(row, resultSet.columnInfo, index),
                );
                setDataset(convertedDataset);

                // Set grid options only on initial load
                if (!options) {
                    // Set row height to 26px for optimal display
                    const ROW_HEIGHT = 26;
                    const FILTER_ROW_HEIGHT = 34;

                    setOptions({
                        alwaysShowVerticalScroll: true,
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

                        // Localization for grid UI
                        locales: slickGridLocales,

                        // Column operations
                        enableColumnReorder: true, // Allow column reordering via drag-and-drop
                        enableColumnPicker: true, // Allow hide/show columns from column picker
                        columnPicker: {
                            hideForceFitButton: true,
                            hideSyncResizeButton: true,
                        },
                        enableHeaderMenu: true, // Enable header menu for column operations
                        headerMenu: {
                            hideColumnHideCommand: false, // Show "Hide Column" command
                            hideSortCommands: false, // Show sort commands
                            hideClearSortCommand: false, // Show "Clear Sort" command
                            hideClearFilterCommand: false, // Show "Clear Filter" command
                            hideFilterCommand: false, // Show "Filter" command
                            hideFreezeColumnsCommand: true, // Hide freeze columns (not needed)
                        },

                        // Sorting
                        enableSorting: true,
                        multiColumnSort: true, // Allow multi-column sorting

                        // Filtering
                        enableFiltering: true,
                        showHeaderRow: true, // Show filter row
                        headerRowHeight: FILTER_ROW_HEIGHT,

                        // Cell navigation and copy buffer
                        enableCellNavigation: true,
                        enableExcelCopyBuffer: true, // Enables cell range selection + copy/paste (Ctrl+C, Ctrl+V)

                        // Context menu
                        enableContextMenu: true,
                        contextMenu: getContextMenuOptions(),

                        // Pagination
                        customPaginationComponent: BoundCustomPager,
                        enablePagination: true,
                        pagination: {
                            pageSize: pageSize,
                            pageSizes: [10, 50, 100, 1000],
                        },

                        // Row height
                        rowHeight: ROW_HEIGHT,

                        // Theme
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
                const currentLength = reactGridRef.current.dataView.getLength();
                for (let i = 0; i < rowsToAdd.length; i++) {
                    const newRow = rowsToAdd[i];
                    const dataRow = convertRowToDataRow(
                        newRow,
                        resultSet.columnInfo,
                        currentLength + i,
                    );
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
                        const dataRow = convertRowToDataRow(newRow, resultSet.columnInfo, i);
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
            // Get the actual column from the grid (accounts for hidden columns)
            const gridColumns = reactGridRef.current?.slickGrid?.getColumns() || [];
            const column = gridColumns[cellIndex];
            // Use the original column index stored in column metadata (handles hidden columns)
            const dataColumnIndex = (column as any)?.originalIndex ?? cellIndex;
            const rowId = args.item.id;

            console.log(
                `Cell Changed - Row ID: ${rowId}, Data Column Index: ${dataColumnIndex}, Cell Index: ${cellIndex}, Column ID: ${column?.id}`,
            );

            // Track the change using original data column index (not visible cell index)
            const changeKey = `${rowId}-${dataColumnIndex}`;
            cellChangesRef.current.set(changeKey, {
                rowId,
                columnIndex: dataColumnIndex,
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
                onUpdateCell(rowId, dataColumnIndex, newValue);
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

        function handleKeyDown(e: KeyboardEvent, _: any) {
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
            const rowId = dataContext?.id;

            switch (command) {
                case "copy":
                    copySelectionToClipboard(false, false);
                    break;

                case "copy-with-headers":
                    copySelectionToClipboard(true, false);
                    break;

                case "copy-headers":
                    copySelectionToClipboard(false, true);
                    break;

                case "export-csv":
                    exportToFile();
                    break;

                case "export-excel":
                    exportToExcel();
                    break;

                case "export-json":
                    exportToJson();
                    break;

                case "delete-row":
                    if (onDeleteRow) {
                        onDeleteRow(rowId);
                    }
                    break;

                case "revert-cell":
                    const cellIndex = args.cell;
                    // Get the actual column from the grid (accounts for hidden columns)
                    const gridColumns = reactGridRef.current?.slickGrid?.getColumns() || [];
                    const column = gridColumns[cellIndex];
                    // Use the original column index stored in column metadata (handles hidden columns)
                    const dataColumnIndex = (column as any)?.originalIndex ?? cellIndex;
                    const changeKey = `${rowId}-${dataColumnIndex}`;

                    if (onRevertCell) {
                        onRevertCell(rowId, dataColumnIndex);
                    }

                    cellChangesRef.current.delete(changeKey);
                    failedCellsRef.current.delete(changeKey);
                    console.log(`Reverted cell for row ID ${rowId}, column ${dataColumnIndex}`);

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

        // Handle row selection changes
        function handleSelectedRowsChanged(_e: any, _args: any) {
            if (onSelectedRowsChanged && reactGridRef.current?.dataView) {
                const selectedRowIds =
                    reactGridRef.current.dataView.getAllSelectedIds() as number[];
                onSelectedRowsChanged(selectedRowIds);
            }
        }

        /**
         * Copy selected cells to clipboard
         * @param includeHeaders - Whether to include column headers
         * @param headersOnly - Whether to copy only headers (no data)
         */
        function copySelectionToClipboard(includeHeaders: boolean, headersOnly: boolean) {
            if (!reactGridRef.current?.slickGrid) {
                return;
            }

            const grid = reactGridRef.current.slickGrid;
            const dataView = reactGridRef.current.dataView;
            const visibleColumns = grid.getColumns();

            // Get selection ranges from the cell selection model
            const selectionModel = grid.getSelectionModel();
            const selectedRanges = selectionModel?.getSelectedRanges() || [];

            // Create array of range bounds to process
            interface RangeBounds {
                fromRow: number;
                toRow: number;
                fromCell: number;
                toCell: number;
            }
            const rangesToProcess: RangeBounds[] = [];

            if (selectedRanges.length > 0) {
                // Copy range properties from selected ranges
                for (const r of selectedRanges) {
                    rangesToProcess.push({
                        fromRow: r.fromRow,
                        toRow: r.toRow,
                        fromCell: r.fromCell,
                        toCell: r.toCell,
                    });
                }
            } else {
                // No cell range selected, try to use active cell
                const activeCell = grid.getActiveCell();
                if (!activeCell) {
                    return;
                }
                // Create a single-cell range
                rangesToProcess.push({
                    fromRow: activeCell.row,
                    toRow: activeCell.row,
                    fromCell: activeCell.cell,
                    toCell: activeCell.cell,
                });
            }

            const lines: string[] = [];

            // Process each selection range
            for (const range of rangesToProcess) {
                const fromRow = Math.min(range.fromRow, range.toRow);
                const toRow = Math.max(range.fromRow, range.toRow);
                const fromCell = Math.min(range.fromCell, range.toCell);
                const toCell = Math.max(range.fromCell, range.toCell);

                // Get headers for the selected columns
                if (includeHeaders || headersOnly) {
                    const headerValues: string[] = [];
                    for (let c = fromCell; c <= toCell; c++) {
                        const column = visibleColumns[c];
                        if (column) {
                            headerValues.push(column.name?.toString() || "");
                        }
                    }
                    lines.push(headerValues.join("\t"));
                }

                // Get data for selected cells (skip if headersOnly)
                if (!headersOnly && dataView) {
                    for (let r = fromRow; r <= toRow; r++) {
                        const rowValues: string[] = [];
                        const item = dataView.getItem(r);
                        if (item) {
                            for (let c = fromCell; c <= toCell; c++) {
                                const column = visibleColumns[c];
                                if (column && column.field) {
                                    const value = item[column.field];
                                    // Handle NULL values and convert to string
                                    rowValues.push(value === "NULL" ? "" : value?.toString() || "");
                                }
                            }
                        }
                        lines.push(rowValues.join("\t"));
                    }
                }
            }

            // Copy to clipboard
            const textToCopy = lines.join("\n");
            void navigator.clipboard.writeText(textToCopy);
        }

        /**
         * Helper function to get export data from the grid
         * If cells are selected, returns only the selected range data
         * Otherwise returns all data respecting filters, sort, and visible columns
         */
        function getExportData(): { headers: string[]; rows: string[][] } | null {
            if (!reactGridRef.current?.dataView || !reactGridRef.current?.slickGrid) {
                return null;
            }

            const dataView = reactGridRef.current.dataView;
            const grid = reactGridRef.current.slickGrid;
            const visibleColumns = grid.getColumns();

            // Check if there's a cell selection
            const selectionModel = grid.getSelectionModel();
            const selectedRanges = selectionModel?.getSelectedRanges() || [];

            // If there's a selection, export only selected data
            if (selectedRanges.length > 0) {
                return getSelectedRangeData(selectedRanges, visibleColumns, dataView);
            }

            // No selection - export all data
            // Get headers from visible columns (skip action columns)
            const headers = visibleColumns
                .filter((col) => col.field && col.name && col.id !== "delete" && col.id !== "undo")
                .map((col) => col.name?.toString() || "");

            // Get all filtered/sorted items from the DataView
            const items = dataView.getFilteredItems();

            // Get rows data (skip action columns)
            const rows = items.map((item: any) => {
                return visibleColumns
                    .filter((col) => col.field && col.id !== "delete" && col.id !== "undo")
                    .map((col) => {
                        const value = item[col.field!];
                        // Convert NULL to empty string for export
                        return value === "NULL" ? "" : value?.toString() || "";
                    });
            });

            return { headers, rows };
        }

        /**
         * Helper function to get data from selected cell ranges
         */
        function getSelectedRangeData(
            selectedRanges: any[],
            visibleColumns: Column[],
            dataView: any,
        ): { headers: string[]; rows: string[][] } | null {
            // Process the first range (primary selection)
            // For multiple ranges, we combine them
            interface RangeBounds {
                fromRow: number;
                toRow: number;
                fromCell: number;
                toCell: number;
            }

            const rangesToProcess: RangeBounds[] = selectedRanges.map((r) => ({
                fromRow: Math.min(r.fromRow, r.toRow),
                toRow: Math.max(r.fromRow, r.toRow),
                fromCell: Math.min(r.fromCell, r.toCell),
                toCell: Math.max(r.fromCell, r.toCell),
            }));

            // For simplicity, use the bounding box of all ranges
            const minRow = Math.min(...rangesToProcess.map((r) => r.fromRow));
            const maxRow = Math.max(...rangesToProcess.map((r) => r.toRow));
            const minCell = Math.min(...rangesToProcess.map((r) => r.fromCell));
            const maxCell = Math.max(...rangesToProcess.map((r) => r.toCell));

            // Get headers for selected columns (skip action columns)
            const headers: string[] = [];
            for (let c = minCell; c <= maxCell; c++) {
                const column = visibleColumns[c];
                if (column && column.name && column.id !== "delete" && column.id !== "undo") {
                    headers.push(column.name.toString());
                }
            }

            // Get rows data for selected range (skip action columns)
            const rows: string[][] = [];
            for (let r = minRow; r <= maxRow; r++) {
                const item = dataView.getItem(r);
                if (item) {
                    const rowData: string[] = [];
                    for (let c = minCell; c <= maxCell; c++) {
                        const column = visibleColumns[c];
                        if (
                            column &&
                            column.field &&
                            column.id !== "delete" &&
                            column.id !== "undo"
                        ) {
                            const value = item[column.field];
                            // Convert NULL to empty string for export
                            rowData.push(value === "NULL" ? "" : value?.toString() || "");
                        }
                    }
                    rows.push(rowData);
                }
            }

            return { headers, rows };
        }

        /**
         * Export grid data to CSV file
         * Uses the filtered/sorted data from the DataView
         */
        function exportToFile() {
            const data = getExportData();
            if (!data || !onSaveResults) {
                return;
            }
            onSaveResults("csv", data);
        }

        /**
         * Export grid data to Excel file
         * Uses the filtered/sorted data from the DataView
         */
        function exportToExcel() {
            const data = getExportData();
            if (!data || !onSaveResults) {
                return;
            }
            onSaveResults("excel", data);
        }

        /**
         * Export grid data to JSON file
         * Uses the filtered/sorted data from the DataView
         */
        function exportToJson() {
            const data = getExportData();
            if (!data || !onSaveResults) {
                return;
            }
            onSaveResults("json", data);
        }

        function getContextMenuOptions(): ContextMenu {
            return {
                hideCopyCellValueCommand: true,
                hideCloseButton: true,
                commandItems: [
                    // Copy commands
                    {
                        command: "copy",
                        title: loc.slickGrid.copy,
                        iconCssClass: "mdi mdi-content-copy",
                        positionOrder: 1,
                    },
                    {
                        command: "copy-with-headers",
                        title: loc.tableExplorer.copyWithHeaders,
                        iconCssClass: "mdi mdi-content-copy",
                        positionOrder: 2,
                    },
                    {
                        command: "copy-headers",
                        title: loc.tableExplorer.copyHeaders,
                        iconCssClass: "mdi mdi-content-copy",
                        positionOrder: 3,
                    },
                    // Divider before export
                    { divider: true, command: "", positionOrder: 4 },
                    // Export commands
                    {
                        command: "export-csv",
                        title: loc.slickGrid.exportToCsv,
                        iconCssClass: "mdi mdi-file-delimited",
                        positionOrder: 5,
                    },
                    {
                        command: "export-excel",
                        title: loc.slickGrid.exportToExcel,
                        iconCssClass: "mdi mdi-file-excel",
                        positionOrder: 6,
                    },
                    {
                        command: "export-json",
                        title: loc.tableExplorer.exportToJson,
                        iconCssClass: "mdi mdi-code-json",
                        positionOrder: 7,
                    },
                    // Divider before edit commands
                    { divider: true, command: "", positionOrder: 8 },
                    // Edit commands
                    {
                        command: "delete-row",
                        title: loc.tableExplorer.deleteRow,
                        iconCssClass: "mdi mdi-close",
                        cssClass: "red",
                        textCssClass: "bold",
                        positionOrder: 9,
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
                        positionOrder: 10,
                    },
                    {
                        command: "revert-row",
                        title: loc.tableExplorer.revertRow,
                        iconCssClass: "mdi mdi-undo",
                        positionOrder: 11,
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
                    onSelectedRowsChanged={($event) =>
                        handleSelectedRowsChanged($event, $event.detail.args)
                    }
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
