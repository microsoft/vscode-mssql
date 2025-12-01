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
    useCallback,
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
    Filters,
    FieldType,
    // Formatter,
} from "slickgrid-react";
import { EditSubsetResult } from "../../../sharedInterfaces/tableExplorer";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import { locConstants as loc } from "../../common/locConstants";
import TableExplorerCustomPager from "./TableExplorerCustomPager";
import {
    Input,
    Button,
    Tooltip,
    Badge,
} from "@fluentui/react-components";
import {
    SearchRegular,
    DismissRegular,
    ChevronUpRegular,
    ChevronDownRegular,
} from "@fluentui/react-icons";
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
}

// Search match interface
interface SearchMatch {
    rowIndex: number;
    colIndex: number;
    rowId: number;
}

export interface TableDataGridRef {
    clearAllChangeTracking: () => void;
    getCellChangeCount: () => number;
    goToLastPage: () => void;
    goToFirstPage: () => void;
    getSelectedRowIds: () => number[];
    clearSelection: () => void;
    toggleSearchBar: () => void;
}

// Row number formatter
// const rowNumberFormatter: Formatter = (_row, _cell, _value, _columnDef, dataContext) => {
//     const rowNum = dataContext._rowNumber || "";
//     return `<span class="row-number-cell">${rowNum}</span>`;
// };

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

        // Search state
        const [showSearchBar, setShowSearchBar] = useState(false);
        const [searchTerm, setSearchTerm] = useState("");
        const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
        const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
        const searchHighlightRef = useRef<Set<string>>(new Set());
        const searchInputRef = useRef<HTMLInputElement>(null);

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
                if (reactGridRef.current?.slickGrid) {
                    const selectedRows = reactGridRef.current.slickGrid.getSelectedRows();
                    const dataView = reactGridRef.current.dataView;
                    if (dataView) {
                        return selectedRows.map((rowIdx: number) => {
                            const item = dataView.getItem(rowIdx);
                            return item?.id;
                        }).filter((id: number | undefined) => id !== undefined);
                    }
                }
                return [];
            },
            clearSelection: () => {
                if (reactGridRef.current?.slickGrid) {
                    reactGridRef.current.slickGrid.setSelectedRows([]);
                }
            },
            toggleSearchBar: () => {
                setShowSearchBar((prev) => {
                    const newValue = !prev;
                    if (newValue) {
                        // Focus search input when opening
                        setTimeout(() => searchInputRef.current?.focus(), 100);
                    } else {
                        // Clear search when closing
                        clearSearch();
                    }
                    return newValue;
                });
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
        function createColumns(columnInfo: any[]): Column[] {
            // Row number column (first column)
            // const rowNumberColumn: Column = {
            //     id: "_rowNumber",
            //     name: "#",
            //     field: "_rowNumber",
            //     width: 50,
            //     minWidth: 50,
            //     maxWidth: 80,
            //     resizable: false,
            //     sortable: false,
            //     filterable: false,
            //     selectable: false,
            //     focusable: false,
            //     cssClass: "row-number-column",
            //     formatter: rowNumberFormatter,
            //     excludeFromHeaderMenu: true,
            //     excludeFromColumnPicker: true,
            // };

            // Data columns
            const dataColumns: Column[] = columnInfo.map((colInfo, index) => {
                // Actual column index in grid
                // const gridColumnIndex = index;

                const column: Column = {
                    id: `col${index}`,
                    name: colInfo.name,
                    field: `col${index}`,
                    sortable: true,
                    filterable: true,
                    resizable: true,
                    minWidth: 98,
                    type: FieldType.string,
                    filter: {
                        model: Filters.compoundInputText,
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
                        // const isSearchHighlighted = searchHighlightRef.current.has(
                        //     `${rowId}-${gridColumnIndex}`,
                        // );
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

            return [/* rowNumberColumn, */ ...dataColumns];
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

                const convertedDataset = resultSet.subset.map((row, index) =>
                    convertRowToDataRow(row, resultSet.columnInfo, index),
                );
                setDataset(convertedDataset);

                // Set grid options only on initial load
                if (!options) {
                    // Set row height to 26px for optimal display
                    const ROW_HEIGHT = 26;
                    const FILTER_ROW_HEIGHT = 30;

                    setOptions({
                        alwaysShowVerticalScroll: false,
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

                        // Row selection
                        enableRowSelection: true,
                        // enableCheckboxSelector: true,
                        // checkboxSelector: {
                        //     hideSelectAllCheckbox: false,
                        //     columnIndexPosition: 0, // After row number column
                        //     width: 40,
                        //     cssClass: "checkbox-selector-column",
                        // },
                        rowSelectionOptions: {
                            selectActiveRow: false, // Don't auto-select on cell click
                        },

                        // Sorting
                        enableSorting: true,
                        multiColumnSort: true, // Allow multi-column sorting

                        // Filtering
                        enableFiltering: true,
                        showHeaderRow: true, // Show filter row
                        headerRowHeight: FILTER_ROW_HEIGHT,

                        // Cell navigation
                        enableCellNavigation: true,

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

                        // Edit handler
                        editCommandHandler: (_item, _column, editCommand) => {
                            editCommand.execute();
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
                    const dataRow = convertRowToDataRow(newRow, resultSet.columnInfo, currentLength + i);
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

            console.log(`Cell Changed - Row ID: ${rowId}, Data Column Index: ${dataColumnIndex}, Cell Index: ${cellIndex}, Column ID: ${column?.id}`);

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
        function handleSelectedRowsChanged(_e: any, args: any) {
            if (onSelectedRowsChanged && reactGridRef.current?.dataView) {
                const selectedRowIndices = args.rows || [];
                const selectedRowIds = selectedRowIndices.map((rowIdx: number) => {
                    const item = reactGridRef.current?.dataView?.getItem(rowIdx);
                    return item?.id;
                }).filter((id: number | undefined) => id !== undefined);
                onSelectedRowsChanged(selectedRowIds);
            }
        }

        // Search functions
        const performSearch = useCallback((term: string) => {
            if (!term || !reactGridRef.current?.dataView) {
                setSearchMatches([]);
                setCurrentMatchIndex(-1);
                searchHighlightRef.current.clear();
                if (reactGridRef.current?.slickGrid) {
                    reactGridRef.current.slickGrid.invalidate();
                }
                return;
            }

            const matches: SearchMatch[] = [];
            const dataView = reactGridRef.current.dataView;
            const totalRows = dataView.getLength();
            const lowerTerm = term.toLowerCase();

            // Search through all rows and columns
            for (let rowIdx = 0; rowIdx < totalRows; rowIdx++) {
                const item = dataView.getItem(rowIdx);
                if (!item) continue;

                // Search through data columns (skip _rowNumber and id)
                Object.keys(item).forEach((key) => {
                    if (key.startsWith("col")) {
                        const value = String(item[key] || "").toLowerCase();
                        if (value.includes(lowerTerm)) {
                            const colIndex = parseInt(key.replace("col", ""), 10);
                            // Grid column index = data column index (no row number column)
                            const gridColIndex = colIndex;
                            matches.push({
                                rowIndex: rowIdx,
                                colIndex: gridColIndex,
                                rowId: item.id,
                            });
                        }
                    }
                });
            }

            setSearchMatches(matches);

            // Update highlight ref for all matches
            searchHighlightRef.current.clear();
            matches.forEach((match) => {
                searchHighlightRef.current.add(`${match.rowId}-${match.colIndex}`);
            });

            // Set current match to first result
            if (matches.length > 0) {
                setCurrentMatchIndex(0);
                navigateToMatch(matches[0]);
            } else {
                setCurrentMatchIndex(-1);
            }

            // Refresh grid to show highlights
            if (reactGridRef.current?.slickGrid) {
                reactGridRef.current.slickGrid.invalidate();
            }
        }, []);

        const navigateToMatch = useCallback((match: SearchMatch) => {
            if (!reactGridRef.current?.slickGrid || !reactGridRef.current?.paginationService) {
                return;
            }

            const grid = reactGridRef.current.slickGrid;
            const paginationService = reactGridRef.current.paginationService;

            // Calculate which page the match is on
            const itemsPerPage = paginationService.itemsPerPage;
            const targetPage = Math.floor(match.rowIndex / itemsPerPage) + 1;
            const currentPage = paginationService.pageNumber;

            // Navigate to the correct page if needed
            if (targetPage !== currentPage) {
                void paginationService.goToPageNumber(targetPage);
            }

            // Scroll to the cell and select it
            setTimeout(() => {
                const rowInPage = match.rowIndex % itemsPerPage;
                grid.scrollRowIntoView(rowInPage, false);
                grid.setActiveCell(rowInPage, match.colIndex);
            }, 100);
        }, []);

        const goToNextMatch = useCallback(() => {
            if (searchMatches.length === 0) return;
            const nextIndex = (currentMatchIndex + 1) % searchMatches.length;
            setCurrentMatchIndex(nextIndex);
            navigateToMatch(searchMatches[nextIndex]);
        }, [searchMatches, currentMatchIndex, navigateToMatch]);

        const goToPreviousMatch = useCallback(() => {
            if (searchMatches.length === 0) return;
            const prevIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
            setCurrentMatchIndex(prevIndex);
            navigateToMatch(searchMatches[prevIndex]);
        }, [searchMatches, currentMatchIndex, navigateToMatch]);

        const clearSearch = useCallback(() => {
            setSearchTerm("");
            setSearchMatches([]);
            setCurrentMatchIndex(-1);
            searchHighlightRef.current.clear();
            if (reactGridRef.current?.slickGrid) {
                reactGridRef.current.slickGrid.invalidate();
            }
        }, []);

        const handleSearchInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
            const value = e.target.value;
            setSearchTerm(value);
            performSearch(value);
        }, [performSearch]);

        const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
                if (e.shiftKey) {
                    goToPreviousMatch();
                } else {
                    goToNextMatch();
                }
            } else if (e.key === "Escape") {
                setShowSearchBar(false);
                clearSearch();
            }
        }, [goToNextMatch, goToPreviousMatch, clearSearch]);

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
                {/* Search Bar */}
                {showSearchBar && (
                    <div className="table-explorer-search-bar">
                        <div className="search-input-container">
                            <SearchRegular className="search-icon" />
                            <Input
                                ref={searchInputRef}
                                type="text"
                                value={searchTerm}
                                onChange={handleSearchInputChange}
                                onKeyDown={handleSearchKeyDown}
                                placeholder={loc.common.find}
                                size="small"
                                className="search-input"
                                aria-label={loc.common.find}
                            />
                            {searchMatches.length > 0 && (
                                <Badge
                                    appearance="filled"
                                    color="informative"
                                    size="small"
                                    className="search-match-count">
                                    {loc.common.searchResultSummary(
                                        currentMatchIndex + 1,
                                        searchMatches.length,
                                    )}
                                </Badge>
                            )}
                            {searchTerm && searchMatches.length === 0 && (
                                <Badge
                                    appearance="ghost"
                                    color="subtle"
                                    size="small"
                                    className="search-no-results">
                                    {loc.common.noResults}
                                </Badge>
                            )}
                        </div>
                        <div className="search-nav-buttons">
                            <Tooltip content={loc.common.findPrevious} relationship="label">
                                <Button
                                    icon={<ChevronUpRegular />}
                                    appearance="subtle"
                                    size="small"
                                    onClick={goToPreviousMatch}
                                    disabled={searchMatches.length === 0}
                                    aria-label={loc.common.findPrevious}
                                />
                            </Tooltip>
                            <Tooltip content={loc.common.findNext} relationship="label">
                                <Button
                                    icon={<ChevronDownRegular />}
                                    appearance="subtle"
                                    size="small"
                                    onClick={goToNextMatch}
                                    disabled={searchMatches.length === 0}
                                    aria-label={loc.common.findNext}
                                />
                            </Tooltip>
                            <Tooltip content={loc.common.closeFind} relationship="label">
                                <Button
                                    icon={<DismissRegular />}
                                    appearance="subtle"
                                    size="small"
                                    onClick={() => {
                                        setShowSearchBar(false);
                                        clearSearch();
                                    }}
                                    aria-label={loc.common.closeFind}
                                />
                            </Tooltip>
                        </div>
                    </div>
                )}
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
                />
            </div>
        );
    },
);
