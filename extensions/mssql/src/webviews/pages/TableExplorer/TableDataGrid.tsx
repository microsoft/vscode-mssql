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
    Editors,
    ContextMenu,
} from "slickgrid-react";
import { FluentCompoundFilter } from "./fluentCompoundFilter";
import { EditSubsetResult, ExportData } from "../../../sharedInterfaces/tableExplorer";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import { locConstants as loc } from "../../common/locConstants";
import TableExplorerCustomPager from "./TableExplorerCustomPager";
import { slickGridLocales } from "./commonGridOptions";
import "./TableDataGrid.css";
import {
    createFluentAutoResizeOptions,
    FluentSlickGrid,
} from "../../common/FluentSlickGrid/FluentSlickGrid";

interface TableDataGridProps {
    resultSet: EditSubsetResult | undefined;
    themeKind?: ColorThemeKind;
    pageSize?: number;
    currentRowCount?: number;
    failedCells?: string[];
    deletedRows?: number[];
    newRowIds?: number[];
    tableQuery?: string;
    onDeleteRow?: (rowId: number) => void;
    onUpdateCell?: (rowId: number, columnId: number, newValue: string) => void;
    onRevertCell?: (rowId: number, columnId: number) => void;
    onRevertRow?: (rowId: number) => void;
    onLoadSubset?: (rowCount: number) => void;
    onCellChangeCountChanged?: (count: number) => void;
    onDeletionCountChanged?: (count: number) => void;
    onSelectedRowsChanged?: (selectedRowIds: number[]) => void;
    onSaveResults?: (format: "csv" | "json" | "excel", data: ExportData) => void;
    onModifyTable?: () => void;
}

export interface DataColumnVisibility {
    id: string;
    name: string;
    visible: boolean;
}

export interface TableDataGridRef {
    clearAllChangeTracking: () => void;
    getCellChangeCount: () => number;
    goToLastPage: () => void;
    goToFirstPage: () => void;
    getSelectedRowIds: () => number[];
    clearSelection: () => void;
    exportData: (format: "csv" | "excel" | "json") => void;
    getDataColumns: () => DataColumnVisibility[];
    setDataColumnVisibility: (id: string, visible: boolean) => void;
    deleteRows: (rowIds: number[]) => void;
    getSqlForCurrentView: () => string;
}

export const TableDataGrid = forwardRef<TableDataGridRef, TableDataGridProps>(
    (
        {
            resultSet,
            themeKind,
            pageSize = 50,
            failedCells,
            deletedRows,
            newRowIds,
            tableQuery,
            onDeleteRow,
            onUpdateCell,
            onRevertCell,
            onRevertRow,
            onCellChangeCountChanged,
            onDeletionCountChanged,
            onSelectedRowsChanged,
            onSaveResults,
            onModifyTable,
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
        const newRowIdsRef = useRef<Set<number>>(new Set());
        const failedCellsRef = useRef<Set<string>>(new Set());
        const lastPageRef = useRef<number>(1);
        const lastItemsPerPageRef = useRef<number>(pageSize);
        const previousResultSetRef = useRef<EditSubsetResult | undefined>(undefined);
        const isInitializedRef = useRef<boolean>(false);
        // Tracks whether we've already auto-selected the first cell on initial load.
        // Spec: "When user first enters Edit Data, auto-select the first column
        // in the first row."
        const firstCellSelectedRef = useRef<boolean>(false);
        // Mirror of all columns (including hidden) so imperative methods can recompose
        // the visible set without losing hidden columns.
        const columnsRef = useRef<Column[]>([]);
        // Plain-text column names for callers that need a label without HTML.
        const columnDisplayNamesRef = useRef<Map<string | number, string>>(new Map());

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
            tryAutoSelectFirstCell();
        }

        // Visible cell index of the first data column (skipping the
        // checkbox-selector / delete / undo non-data columns).
        function getFirstDataCellIndex(): number {
            const grid = reactGridRef.current?.slickGrid;
            if (!grid) {
                return 1;
            }
            const cols = grid.getColumns();
            for (let i = 0; i < cols.length; i++) {
                const id = String(cols[i].id);
                if (id !== "_checkbox_selector" && id !== "delete" && id !== "undo") {
                    return i;
                }
            }
            return 0;
        }

        // Spec: on first entry to Edit Data, auto-select the first column of
        // the first row. The grid and dataset can become ready in either order,
        // so this is called from both reactGridReady and the dataset effect; the
        // ref guards against re-running once we've successfully auto-selected.
        function tryAutoSelectFirstCell() {
            if (firstCellSelectedRef.current) {
                return;
            }
            const grid = reactGridRef.current?.slickGrid;
            const dataView = reactGridRef.current?.dataView;
            if (!grid || !dataView || dataView.getLength() === 0) {
                return;
            }
            const cellIdx = getFirstDataCellIndex();
            grid.setActiveCell(0, cellIdx);
            firstCellSelectedRef.current = true;
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
            exportData: (format: "csv" | "excel" | "json") => {
                if (format === "csv") {
                    exportToFile();
                } else if (format === "excel") {
                    exportToExcel();
                } else {
                    exportToJson();
                }
            },
            getDataColumns: () => {
                const grid = reactGridRef.current?.slickGrid;
                if (!grid) {
                    return [];
                }
                const visibleIds = new Set(grid.getColumns().map((c) => c.id));
                return columnsRef.current
                    .filter(
                        (c) =>
                            c.id !== "delete" && c.id !== "undo" && c.id !== "_checkbox_selector",
                    )
                    .map((c) => ({
                        id: String(c.id),
                        name:
                            columnDisplayNamesRef.current.get(c.id) ??
                            (typeof c.name === "string" ? c.name : String(c.id)),
                        visible: visibleIds.has(c.id),
                    }));
            },
            setDataColumnVisibility: (id: string, visible: boolean) => {
                const grid = reactGridRef.current?.slickGrid;
                if (!grid) {
                    return;
                }
                const allColumns = columnsRef.current;
                const currentGridColumns = grid.getColumns();
                const dataColumnIds = new Set(allColumns.map((c) => c.id));
                const visibleIds = new Set(currentGridColumns.map((c) => c.id));
                if (visible) {
                    visibleIds.add(id);
                } else {
                    visibleIds.delete(id);
                }
                const nonDataColumns = currentGridColumns.filter((c) => !dataColumnIds.has(c.id));
                const visibleDataColumns = allColumns.filter((c) => visibleIds.has(c.id));
                grid.setColumns([...nonDataColumns, ...visibleDataColumns]);
            },
            deleteRows: (rowIds: number[]) => {
                if (!onDeleteRow) {
                    return;
                }
                if (reactGridRef.current?.paginationService) {
                    lastPageRef.current = reactGridRef.current.paginationService.pageNumber;
                    lastItemsPerPageRef.current =
                        reactGridRef.current.paginationService.itemsPerPage;
                }
                for (const rowId of rowIds) {
                    if (!deletedRowsRef.current.has(rowId)) {
                        onDeleteRow(rowId);
                    }
                }
                if (reactGridRef.current?.slickGrid) {
                    reactGridRef.current.slickGrid.setSelectedRows([]);
                    reactGridRef.current.slickGrid.invalidate();
                }
            },
            getSqlForCurrentView: () => {
                const base = (tableQuery ?? "").trimEnd();
                const grid = reactGridRef.current?.slickGrid;
                if (!grid || !base) {
                    return base;
                }
                const sortCols = grid.getSortColumns?.() ?? [];
                if (sortCols.length === 0) {
                    return base;
                }
                const orderParts = sortCols
                    .map((s: any) => {
                        const colName = columnDisplayNamesRef.current.get(s.columnId);
                        if (!colName) {
                            return undefined;
                        }
                        return `[${colName.replace(/]/g, "]]")}] ${s.sortAsc ? "ASC" : "DESC"}`;
                    })
                    .filter((p): p is string => Boolean(p));
                if (orderParts.length === 0) {
                    return base;
                }
                // Strip a trailing semicolon if present so the appended ORDER BY is valid.
                const stripped = base.replace(/;\s*$/, "");
                return `${stripped}\nORDER BY ${orderParts.join(", ")}`;
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
            // Data columns
            const dataColumns: Column[] = columnInfo.map((colInfo, index) => {
                const headerName = colInfo.dataTypeName
                    ? `<span class="column-name">${htmlEncode(colInfo.name)}</span><span class="column-data-type">${htmlEncode(colInfo.dataTypeName)}</span>`
                    : htmlEncode(colInfo.name);
                const column: Column = {
                    id: `col${index}`,
                    name: headerName,
                    toolTip: colInfo.dataTypeName
                        ? `${colInfo.name} (${colInfo.dataTypeName})`
                        : colInfo.name,
                    field: `col${index}`,
                    sortable: true,
                    filterable: true,
                    resizable: true,
                    minWidth: 180,
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

            return dataColumns;
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

                        // Check if this row is a newly inserted row
                        if (item && newRowIdsRef.current.has(item.id)) {
                            metadata = metadata || {};
                            metadata.cssClasses = metadata.cssClasses
                                ? `${metadata.cssClasses} new-row`
                                : "new-row";
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

        // Sync new row IDs from props to ref so the row-metadata override
        // applies the yellow highlight to newly inserted rows.
        useEffect(() => {
            newRowIdsRef.current = new Set(newRowIds ?? []);
            if (reactGridRef.current?.slickGrid) {
                reactGridRef.current.slickGrid.invalidate();
            }
        }, [newRowIds]);

        // Auto-select the first cell once the dataset has rendered. Pairs with
        // the same call inside reactGridReady to cover either ordering.
        useEffect(() => {
            tryAutoSelectFirstCell();
        }, [dataset]);

        // Handle theme changes - just update state to trigger re-render
        useEffect(() => {
            if (themeKind !== currentTheme) {
                console.log("Theme changed - triggering re-render");
                setCurrentTheme(themeKind);
            }
        }, [themeKind, currentTheme]);

        // When the table query changes (custom query run), reset the previous result set
        // reference so the next resultSet update triggers a full grid re-initialization
        // (Scenario 1) instead of an incremental update (Scenario 2). This is necessary
        // because the backend assigns position-based row IDs (0, 1, 2, ...), so
        // incremental ID-based comparison would incorrectly keep stale data for
        // overlapping IDs.
        useEffect(() => {
            previousResultSetRef.current = undefined;
        }, [tableQuery]);

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
                columnsRef.current = newColumns;
                const displayNames = new Map<string | number, string>();
                resultSet.columnInfo.forEach((c: any, i: number) => {
                    displayNames.set(`col${i}`, c.name);
                });
                columnDisplayNamesRef.current = displayNames;

                const convertedDataset = resultSet.subset.map((row, index) =>
                    convertRowToDataRow(row, resultSet.columnInfo, index),
                );
                setDataset(convertedDataset);

                // If the grid is already initialized (e.g. after a custom query),
                // explicitly replace the DataView items so slickgrid re-renders
                if (reactGridRef.current?.dataView) {
                    reactGridRef.current.dataView.setItems(convertedDataset);
                    reactGridRef.current.slickGrid?.invalidate();
                }

                // Set grid options only on initial load
                if (!options) {
                    // Set row height to 26px for optimal display
                    const ROW_HEIGHT = 26;
                    const FILTER_ROW_HEIGHT = 34;

                    setOptions({
                        autoEdit: false,
                        autoCommitEdit: true,
                        editable: true,
                        autoResize: createFluentAutoResizeOptions("#grid-container", {
                            autoHeight: false,
                            bottomPadding: 10,
                            minHeight: 180,
                        }),

                        // Localization for grid UI
                        locales: slickGridLocales,

                        // Column operations
                        enableColumnPicker: true, // Allow hide/show columns from column picker
                        columnPicker: {
                            hideForceFitButton: true,
                            hideSyncResizeButton: true,
                        },
                        enableHeaderMenu: true, // Enable header menu for column operations
                        headerMenu: {
                            hideCommands: ["freeze-columns"],
                        },

                        // Sorting
                        enableSorting: true,
                        multiColumnSort: true, // Allow multi-column sorting

                        // Filtering
                        enableFiltering: true,
                        showHeaderRow: true, // Show filter row
                        headerRowHeight: FILTER_ROW_HEIGHT,

                        // Row selection (checkbox column for multi-select).
                        // Excel copy buffer is also on, so slickgrid uses the hybrid
                        // selection model. The hybrid model's default selectActiveRow:true
                        // collapses multi-select down to one row whenever the active
                        // cell changes — and CheckboxSelectColumn moves the active
                        // cell on every checkbox click. Setting selectActiveRow:false
                        // on selectionOptions keeps prior checkbox selections intact.
                        enableCheckboxSelector: true,
                        multiSelect: true,
                        checkboxSelector: {
                            hideInFilterHeaderRow: true,
                            hideInColumnTitleRow: false,
                            applySelectOnAllPages: false,
                            columnIndexPosition: 0,
                        },
                        selectionOptions: {
                            selectActiveRow: false,
                        },

                        // Cell navigation and copy buffer
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
                const dataView = reactGridRef.current.dataView;
                const paginationService = reactGridRef.current.paginationService;
                const currentLength = dataView.getLength();

                // Spec: insert new rows directly below the currently selected
                // (active) row. If the active row is the last visible slot of
                // the current page, the row lands at the start of the next page
                // and we navigate the user there. Falls back to current page
                // bottom when there's no active cell.
                const slickGrid = reactGridRef.current.slickGrid;
                const activeCell = slickGrid?.getActiveCell();
                const itemsPerPage = paginationService?.itemsPerPage ?? 0;
                const pageNumber = paginationService?.pageNumber ?? 1;
                const pageStart = itemsPerPage > 0 ? (pageNumber - 1) * itemsPerPage : 0;

                let insertAt: number;
                let advanceToNextPage = false;
                if (activeCell && itemsPerPage > 0) {
                    const activeAbsolute = pageStart + activeCell.row;
                    insertAt = Math.min(activeAbsolute + 1, currentLength);
                    if (activeCell.row === itemsPerPage - 1) {
                        advanceToNextPage = true;
                    }
                } else if (itemsPerPage > 0) {
                    insertAt = Math.min(pageNumber * itemsPerPage, currentLength);
                } else {
                    insertAt = currentLength;
                }

                const firstNewRowAbsoluteIndex = insertAt;
                for (let i = 0; i < rowsToAdd.length; i++) {
                    const newRow = rowsToAdd[i];
                    const dataRow = convertRowToDataRow(newRow, resultSet.columnInfo, insertAt);
                    dataView.insertItem(insertAt, dataRow);
                    insertAt += 1;
                    console.log(
                        `Inserted row ${dataRow.id} at index ${insertAt - 1} (below active row${
                            advanceToNextPage ? ", advancing page" : ""
                        })`,
                    );
                }
                if (rowsToAdd.length > 0 && slickGrid) {
                    slickGrid.invalidate();
                }

                // After inserting, move focus to the first new row so a follow-up
                // Add Row click chains below it. Navigate pages first if needed.
                if (rowsToAdd.length > 0 && slickGrid && itemsPerPage > 0) {
                    const targetPage = Math.floor(firstNewRowAbsoluteIndex / itemsPerPage) + 1;
                    const visibleRow = firstNewRowAbsoluteIndex % itemsPerPage;
                    const cellIdx = getFirstDataCellIndex();
                    const focusNewRow = () => {
                        const grid = reactGridRef.current?.slickGrid;
                        if (!grid) {
                            return;
                        }
                        grid.setActiveCell(visibleRow, cellIdx);
                        grid.scrollCellIntoView(visibleRow, cellIdx, false);
                    };
                    if (advanceToNextPage && paginationService) {
                        lastPageRef.current = targetPage;
                        void paginationService.goToPageNumber(targetPage).then(() => focusNewRow());
                    } else {
                        focusNewRow();
                    }
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
            const gridColumns = reactGridRef.current?.slickGrid?.getVisibleColumns() || [];
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
                    const gridColumns = reactGridRef.current?.slickGrid?.getVisibleColumns() || [];
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

                case "modify-table":
                    if (onModifyTable) {
                        onModifyTable();
                    }
                    break;
            }
        }

        // Implements a tri-state cycle (unsorted → asc → desc → unsorted) on top
        // of slickgrid's built-in two-state toggle. When a column flips from
        // desc(false) → asc(true) — the would-be third click — and that's the
        // ONLY column being sorted, we delegate to SortService.clearSorting()
        // (the same API the column-header "Remove sort" menu uses). It clears
        // the sort icons AND re-sorts the dataView by the default field id,
        // restoring the original row order.
        const sortReentryRef = useRef(false);
        function handleSort(_e: any, args: any) {
            if (sortReentryRef.current) {
                return;
            }
            const reactGrid = reactGridRef.current;
            if (!reactGrid?.slickGrid) {
                return;
            }

            const newCols: Array<{ columnId: any; sortAsc: boolean }> = args?.multiColumnSort
                ? (args.sortCols ?? [])
                : args?.sortCol
                  ? [{ columnId: args.sortCol.id, sortAsc: args.sortAsc }]
                  : [];
            const previousCols: Array<{ columnId: any; sortAsc: boolean }> =
                args?.previousSortColumns ?? [];

            const wouldRemove = newCols.filter((c) => {
                const prev = previousCols.find((p) => p.columnId === c.columnId);
                return prev && prev.sortAsc === false && c.sortAsc === true;
            });

            if (wouldRemove.length === 0) {
                return;
            }

            // Only handle the single-column tri-state case for now: every
            // currently-sorted column matches the "third click" pattern, so
            // clearing all sort is safe. Multi-column reductions (clicking
            // one of several sorted columns) are intentionally left alone —
            // slickgrid's default flip-back-to-asc behavior will apply there.
            if (wouldRemove.length !== newCols.length) {
                return;
            }

            sortReentryRef.current = true;
            try {
                reactGrid.sortService?.clearSorting(true);
            } finally {
                sortReentryRef.current = false;
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
            const visibleColumns = grid.getVisibleColumns();

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
            const visibleColumns = grid.getVisibleColumns();

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
                hideCommands: ["copy"],
                hideCloseButton: true,
                commandItems: [
                    // Copy commands
                    {
                        command: "copy",
                        title: loc.slickGrid.copy,
                        iconCssClass: "fi fi-copy",
                        positionOrder: 1,
                    },
                    {
                        command: "copy-with-headers",
                        title: loc.slickGrid.copyWithHeaders,
                        iconCssClass: "fi fi-copy",
                        positionOrder: 2,
                    },
                    {
                        command: "copy-headers",
                        title: loc.slickGrid.copyHeaders,
                        iconCssClass: "fi fi-copy",
                        positionOrder: 3,
                    },
                    // Divider before export
                    { divider: true, command: "", positionOrder: 4 },
                    // Export commands
                    {
                        command: "export-csv",
                        title: loc.slickGrid.exportToCsv,
                        iconCssClass: "fi fi-arrow-download",
                        positionOrder: 5,
                    },
                    {
                        command: "export-excel",
                        title: loc.slickGrid.exportToExcel,
                        iconCssClass: "fi fi-arrow-download",
                        positionOrder: 6,
                    },
                    {
                        command: "export-json",
                        title: loc.slickGrid.exportToJson,
                        iconCssClass: "fi fi-arrow-download",
                        positionOrder: 7,
                    },
                    // Divider before edit commands
                    { divider: true, command: "", positionOrder: 8 },
                    // Edit commands
                    {
                        command: "delete-row",
                        title: loc.tableExplorer.deleteRow,
                        iconCssClass: "fi fi-dismiss",
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
                        iconCssClass: "fi fi-arrow-undo",
                        positionOrder: 10,
                    },
                    {
                        command: "revert-row",
                        title: loc.tableExplorer.revertRow,
                        iconCssClass: "fi fi-arrow-undo",
                        positionOrder: 11,
                    },
                    // Divider before navigation commands
                    { divider: true, command: "", positionOrder: 12 },
                    // Navigation commands
                    {
                        command: "modify-table",
                        title: loc.tableExplorer.modifyTable,
                        iconCssClass: "fi fi-table-edit",
                        positionOrder: 13,
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
                <FluentSlickGrid
                    gridId="tableExplorerGrid"
                    columns={columns}
                    options={options}
                    dataset={dataset}
                    onReactGridCreated={($event) => reactGridReady($event.detail)}
                    onCellChange={($event) => handleCellChange($event, $event.detail.args)}
                    onSelectedRowsChanged={($event) =>
                        handleSelectedRowsChanged($event, $event.detail.args)
                    }
                    onSort={($event) => handleSort($event, $event.detail.args)}
                />
            </div>
        );
    },
);
