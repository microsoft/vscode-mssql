/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject } from "react";
import { SlickRange, type SlickGrid } from "@slickgrid-universal/common";
import type { Column } from "slickgrid-react";
import {
    SortProperties,
    type ColumnFilterMap,
    type DbCellValue,
    type ISlickRange,
    type ResultSetSummary,
} from "../../../../sharedInterfaces/queryResult";
import { isJson } from "../../jsonUtils";
import { isXmlCell } from "../../xmlUtils";
import {
    FluentResultGridCommandPlacement,
    type FluentResultGridCommandConfiguration,
    type FluentResultGridCommandContext,
    type FluentResultGridCommandEvent,
} from "../types/fluentResultGridCommands";
import { FluentResultGridCommand } from "../types/fluentResultGridCommandIds";
import type { FluentResultGridProps } from "../types/fluentResultGridProps";
import type { FluentResultGridState } from "../types/fluentResultGridState";
import type { FluentResultGridStrings } from "../types/fluentResultGridStrings";
import type { FluentResultGridProviderContextValue } from "./fluentResultGridProviderTypes";
import {
    FLUENT_RESULT_GRID_DEFAULT_COLUMN_WIDTH,
    FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX,
    FLUENT_RESULT_GRID_JSON_LANGUAGE_ID,
    FLUENT_RESULT_GRID_MIN_COLUMN_WIDTH,
    FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID,
    FLUENT_RESULT_GRID_XML_LANGUAGE_ID,
} from "./fluentResultGridConstants";
import {
    getFluentResultGridColumnIndexFromColumn,
    isFluentResultGridDataColumn,
} from "./fluentResultGridColumns";
import type {
    FluentResultGridActiveDataColumn,
    ReactGridInstanceWithSharedService,
    SourceRow,
} from "./fluentResultGridControllerTypes";
import { isFluentResultGridHostCommand } from "./fluentResultGridCommandUtils";
import type { FluentResultGridDataRow } from "./fluentResultGridDataView";
import { toFluentResultGridAnchorRect } from "./fluentResultGridDomUtils";
import type { FluentResultGridFilterValue } from "./fluentResultGridOverlays";
import {
    convertDisplayedSelectionRowsToActual,
    getDisplayedFluentResultGridSelectionForCopy,
    getFluentResultGridDataSelectionsFromRanges,
} from "./fluentResultGridSelection";
import {
    buildFluentResultGridFilterItems,
    normalizeFluentResultGridSelectedFilterValues,
    normalizeStoredFluentResultGridFilterValue,
} from "./fluentResultGridTransforms";
import { FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX } from "./fluentResultGridState";

export interface FluentResultGridCommandController {
    clearAllFilters: (grid: SlickGrid) => Promise<void>;
    clearSort: (grid: SlickGrid) => Promise<void>;
    expandSelection: (grid: SlickGrid, keyCode: string) => void;
    getActiveDataColumn: (grid: SlickGrid) => FluentResultGridActiveDataColumn | undefined;
    handleClick: (event: CustomEvent) => void;
    handleCommand: (event: FluentResultGridCommandEvent) => Promise<void>;
    handleContextMenu: (event: CustomEvent) => void;
    openFilterMenuForColumn: (
        grid: SlickGrid,
        column: Column<FluentResultGridDataRow>,
    ) => Promise<void>;
    openResizeDialogForColumn: (grid: SlickGrid, column: Column<FluentResultGridDataRow>) => void;
    selectActiveCellColumn: (grid: SlickGrid) => void;
    selectActiveCellRow: (grid: SlickGrid) => void;
    selectAllCells: (grid: SlickGrid) => void;
    selectRange: (grid: SlickGrid, range: SlickRange) => void;
    showAllColumns: (grid: SlickGrid, allColumns?: Column<FluentResultGridDataRow>[]) => void;
    toggleSortForColumn: (
        grid: SlickGrid,
        column: Column<FluentResultGridDataRow>,
    ) => Promise<void>;
}

export function useFluentResultGridCommandController({
    applyFrozenColumnIndex,
    applyGridTransforms,
    closeOverlay,
    commandContext,
    commands,
    emitStateChange,
    ensureAllRowsLoaded,
    filterStateRef,
    gridId,
    onCommand,
    openOverlay,
    reactGridRef,
    resultIdentitySignature,
    resultSetSummary,
    setFrozenColumnIndex,
    showRowNumberColumn,
    sortStateRef,
    strings,
    transformedRowsRef,
    updateHeaderButtonStates,
}: {
    applyFrozenColumnIndex: (grid: SlickGrid, columnIndex: number) => void;
    applyGridTransforms: (
        grid: SlickGrid,
        options?: { preserveScrollPosition?: boolean },
    ) => Promise<boolean>;
    closeOverlay: FluentResultGridProviderContextValue["closeOverlay"];
    commandContext: FluentResultGridCommandContext;
    commands?: FluentResultGridCommandConfiguration;
    emitStateChange: (grid: SlickGrid, allColumns?: Column<FluentResultGridDataRow>[]) => void;
    ensureAllRowsLoaded: () => Promise<SourceRow[] | undefined>;
    filterStateRef: MutableRefObject<ColumnFilterMap>;
    gridId: string;
    onCommand?: FluentResultGridProps["onCommand"];
    openOverlay: FluentResultGridProviderContextValue["openOverlay"];
    reactGridRef: MutableRefObject<ReactGridInstanceWithSharedService | undefined>;
    resultIdentitySignature: string;
    resultSetSummary: ResultSetSummary;
    setFrozenColumnIndex: Dispatch<number>;
    showRowNumberColumn: boolean;
    sortStateRef: MutableRefObject<FluentResultGridState["sort"] | undefined>;
    strings: FluentResultGridStrings;
    transformedRowsRef: MutableRefObject<SourceRow[] | undefined>;
    updateHeaderButtonStates: (grid: SlickGrid) => void;
}): FluentResultGridCommandController {
    const activeFilterColumnRef = useRef<string | undefined>(undefined);

    useEffect(() => {
        activeFilterColumnRef.current = undefined;
    }, [resultIdentitySignature]);

    const getActualSelectionForCopy = useCallback(
        (grid: SlickGrid) => {
            const selection = getDisplayedFluentResultGridSelectionForCopy(
                grid,
                grid.getDataLength(),
            );
            const transformedRows = transformedRowsRef.current;
            if (!transformedRows) {
                return selection;
            }

            return convertDisplayedSelectionRowsToActual(
                selection,
                (displayRow) => transformedRows[displayRow]?.rowId,
            );
        },
        [transformedRowsRef],
    );

    const getSelectionForCommand = useCallback(
        (grid: SlickGrid, commandId: string): ISlickRange[] | undefined => {
            switch (commandId) {
                case FluentResultGridCommand.CopySelection:
                case FluentResultGridCommand.CopyWithHeaders:
                case FluentResultGridCommand.CopyAsCsv:
                case FluentResultGridCommand.CopyAsJson:
                case FluentResultGridCommand.CopyAsInClause:
                case FluentResultGridCommand.CopyAsInsertInto:
                    return getActualSelectionForCopy(grid);
                case FluentResultGridCommand.CopyHeaders:
                case FluentResultGridCommand.SaveAsCsv:
                case FluentResultGridCommand.SaveAsJson:
                case FluentResultGridCommand.SaveAsExcel:
                case FluentResultGridCommand.SaveAsInsert:
                    return getDisplayedFluentResultGridSelectionForCopy(grid, grid.getDataLength());
                default:
                    return getFluentResultGridDataSelectionsFromRanges(
                        grid.getSelectionModel()?.getSelectedRanges() ?? [],
                    );
            }
        },
        [getActualSelectionForCopy],
    );

    const emitHostCommand = useCallback(
        async (grid: SlickGrid, event: FluentResultGridCommandEvent): Promise<void> => {
            const liveSelection = getSelectionForCommand(grid, event.commandId);
            await onCommand?.({
                ...event,
                selection: liveSelection ?? event.selection,
            });
        },
        [getSelectionForCommand, onCommand],
    );

    const resizeColumn = useCallback(
        async (grid: SlickGrid, columnId: string, width: number) => {
            const resizedColumns = grid
                .getColumns()
                .map((column) => (column.id === columnId ? { ...column, width } : column));
            grid.setColumns(resizedColumns);
            grid.invalidate();
            emitStateChange(grid);
            grid.focus();
        },
        [emitStateChange],
    );

    const openResizeDialogForColumn = useCallback(
        (grid: SlickGrid, column: Column<FluentResultGridDataRow>) => {
            const columnId = column.id?.toString();
            if (!columnId) {
                return;
            }

            const headerNode = grid.getHeaderColumn(grid.getColumnIndex(column.id));
            if (!headerNode) {
                return;
            }

            openOverlay({
                kind: "resizeDialog",
                gridId,
                columnId,
                columnName: typeof column.name === "string" ? column.name : "",
                anchorRect: toFluentResultGridAnchorRect(headerNode.getBoundingClientRect()),
                initialWidth: column.width ?? FLUENT_RESULT_GRID_DEFAULT_COLUMN_WIDTH,
                minWidth: FLUENT_RESULT_GRID_MIN_COLUMN_WIDTH,
                onDismiss: () => grid.focus(),
                onSubmit: (newWidth: number) => resizeColumn(grid, columnId, newWidth),
            });
        },
        [gridId, openOverlay, resizeColumn],
    );

    const clearAllFilters = useCallback(
        async (grid: SlickGrid) => {
            const clearedFilters: ColumnFilterMap = {};
            for (const [columnId, filterState] of Object.entries(filterStateRef.current)) {
                clearedFilters[columnId] = {
                    ...filterState,
                    filterValues: [],
                };
            }

            filterStateRef.current = clearedFilters;
            const applied = await applyGridTransforms(grid, { preserveScrollPosition: true });
            if (!applied) {
                return;
            }

            closeOverlay();
            updateHeaderButtonStates(grid);
            emitStateChange(grid);
            grid.invalidate();
            grid.focus();
        },
        [
            applyGridTransforms,
            closeOverlay,
            emitStateChange,
            filterStateRef,
            updateHeaderButtonStates,
        ],
    );

    const clearSort = useCallback(
        async (grid: SlickGrid) => {
            const sortedColumnId = sortStateRef.current?.columnId;
            const clearedSortFilters: ColumnFilterMap = {};
            for (const [columnId, filterState] of Object.entries(filterStateRef.current)) {
                clearedSortFilters[columnId] = {
                    ...filterState,
                    sorted: SortProperties.NONE,
                };
            }

            if (sortedColumnId && !clearedSortFilters[sortedColumnId]) {
                clearedSortFilters[sortedColumnId] = {
                    columnDef: sortedColumnId,
                    filterValues: [],
                    sorted: SortProperties.NONE,
                };
            }

            sortStateRef.current = undefined;
            filterStateRef.current = clearedSortFilters;
            const applied = await applyGridTransforms(grid, { preserveScrollPosition: true });
            if (!applied) {
                return;
            }

            updateHeaderButtonStates(grid);
            emitStateChange(grid);
            grid.invalidate();
            grid.focus();
        },
        [
            applyGridTransforms,
            emitStateChange,
            filterStateRef,
            sortStateRef,
            updateHeaderButtonStates,
        ],
    );

    const showAllColumns = useCallback(
        (grid: SlickGrid, allColumns?: Column<FluentResultGridDataRow>[]) => {
            const columnsToShow = allColumns?.length
                ? allColumns
                : (grid.getColumns() as Column<FluentResultGridDataRow>[]);
            for (const column of columnsToShow) {
                if (isFluentResultGridDataColumn(column)) {
                    column.hidden = false;
                }
            }

            grid.setColumns(columnsToShow);
            grid.invalidate();
            updateHeaderButtonStates(grid);
            emitStateChange(grid, columnsToShow);
            grid.focus();
        },
        [emitStateChange, updateHeaderButtonStates],
    );

    const toggleSortForColumn = useCallback(
        async (grid: SlickGrid, column: Column<FluentResultGridDataRow>) => {
            const columnId = column.id?.toString();
            if (!columnId || columnId === FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID) {
                return;
            }

            const existingSort =
                sortStateRef.current?.columnId === columnId
                    ? sortStateRef.current.direction
                    : SortProperties.NONE;
            const nextSort =
                existingSort === SortProperties.NONE
                    ? SortProperties.ASC
                    : existingSort === SortProperties.ASC
                      ? SortProperties.DESC
                      : SortProperties.NONE;
            const previousSortColumnId = sortStateRef.current?.columnId;

            sortStateRef.current =
                nextSort === SortProperties.NONE ? undefined : { columnId, direction: nextSort };

            if (previousSortColumnId && previousSortColumnId !== columnId) {
                filterStateRef.current[previousSortColumnId] = {
                    ...filterStateRef.current[previousSortColumnId],
                    columnDef: previousSortColumnId,
                    filterValues: filterStateRef.current[previousSortColumnId]?.filterValues ?? [],
                    sorted: SortProperties.NONE,
                };
            }

            filterStateRef.current[columnId] = {
                ...filterStateRef.current[columnId],
                columnDef: columnId,
                filterValues: filterStateRef.current[columnId]?.filterValues ?? [],
                sorted: nextSort,
            };

            const applied = await applyGridTransforms(grid);
            if (!applied) {
                return;
            }

            updateHeaderButtonStates(grid);
            emitStateChange(grid);
            grid.invalidate();
            grid.focus();
        },
        [
            applyGridTransforms,
            emitStateChange,
            filterStateRef,
            sortStateRef,
            updateHeaderButtonStates,
        ],
    );

    const updateFilterForColumn = useCallback(
        async (
            grid: SlickGrid,
            column: Column<FluentResultGridDataRow>,
            filterValues: FluentResultGridFilterValue[],
            availableItems?: readonly { value: FluentResultGridFilterValue }[],
        ) => {
            const columnId = column.id?.toString();
            if (!columnId) {
                return;
            }

            const normalizedFilterValues = normalizeFluentResultGridSelectedFilterValues(
                filterValues,
                availableItems,
            );
            filterStateRef.current = {
                ...filterStateRef.current,
                [columnId]: {
                    columnDef: columnId,
                    filterValues: normalizedFilterValues as string[],
                    sorted:
                        sortStateRef.current?.columnId === columnId
                            ? sortStateRef.current.direction
                            : filterStateRef.current[columnId]?.sorted,
                },
            };

            const applied = await applyGridTransforms(grid, { preserveScrollPosition: true });
            if (applied) {
                updateHeaderButtonStates(grid);
                emitStateChange(grid);
            }
        },
        [
            applyGridTransforms,
            emitStateChange,
            filterStateRef,
            sortStateRef,
            updateHeaderButtonStates,
        ],
    );

    const openFilterMenuForColumn = useCallback(
        async (grid: SlickGrid, column: Column<FluentResultGridDataRow>) => {
            const columnId = column.id?.toString();
            if (!columnId || column.id === FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID) {
                return;
            }

            if (activeFilterColumnRef.current === columnId) {
                activeFilterColumnRef.current = undefined;
                closeOverlay();
                grid.focus();
                return;
            }

            const rows = await ensureAllRowsLoaded();
            if (!rows) {
                return;
            }

            const filterItems = buildFluentResultGridFilterItems({
                rows: rows.map((row) => row.cells),
                columnId,
                strings,
            });
            const headerNode = grid.getHeaderColumn(grid.getColumnIndex(column.id));
            if (!headerNode) {
                return;
            }

            activeFilterColumnRef.current = columnId;
            openOverlay({
                kind: "filterMenu",
                gridId,
                columnId,
                anchorRect: toFluentResultGridAnchorRect(headerNode.getBoundingClientRect()),
                items: filterItems,
                initialSelected:
                    filterStateRef.current[columnId]?.filterValues?.map(
                        normalizeStoredFluentResultGridFilterValue,
                    ) ?? [],
                onApply: async (selected) => {
                    await updateFilterForColumn(grid, column, selected, filterItems);
                },
                onClear: async () => {
                    await updateFilterForColumn(grid, column, []);
                },
                onDismiss: () => {
                    activeFilterColumnRef.current = undefined;
                    grid.focus();
                },
            });
        },
        [
            closeOverlay,
            ensureAllRowsLoaded,
            filterStateRef,
            gridId,
            openOverlay,
            strings,
            updateFilterForColumn,
        ],
    );

    const selectRange = useCallback((grid: SlickGrid, range: SlickRange) => {
        grid.getSelectionModel()?.setSelectedRanges([range]);
    }, []);

    const selectAllCells = useCallback(
        (grid: SlickGrid) => {
            const rowCount = grid.getDataLength();
            if (rowCount <= 0) {
                return;
            }

            selectRange(
                grid,
                new SlickRange(
                    0,
                    FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX,
                    rowCount - 1,
                    grid.getColumns().length - 1,
                ),
            );
        },
        [selectRange],
    );

    const getActiveDataColumn = useCallback((grid: SlickGrid) => {
        const active = grid.getActiveCell();
        if (!active || active.cell < FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX) {
            return undefined;
        }

        const column = grid.getColumns()[active.cell] as
            | Column<FluentResultGridDataRow>
            | undefined;
        if (!column || column.id === FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID) {
            return undefined;
        }

        return { active, column };
    }, []);

    const selectActiveCellColumn = useCallback(
        (grid: SlickGrid) => {
            const activeColumn = getActiveDataColumn(grid);
            if (!activeColumn || grid.getDataLength() <= 0) {
                return;
            }

            selectRange(
                grid,
                new SlickRange(
                    0,
                    activeColumn.active.cell,
                    grid.getDataLength() - 1,
                    activeColumn.active.cell,
                ),
            );
            grid.setActiveCell(activeColumn.active.row, activeColumn.active.cell);
        },
        [getActiveDataColumn, selectRange],
    );

    const selectActiveCellRow = useCallback(
        (grid: SlickGrid) => {
            const active = grid.getActiveCell();
            if (!active) {
                return;
            }

            selectRange(
                grid,
                new SlickRange(
                    active.row,
                    FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX,
                    active.row,
                    grid.getColumns().length - 1,
                ),
            );
            grid.setActiveCell(
                active.row,
                Math.max(FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX, active.cell),
            );
        },
        [selectRange],
    );

    const moveActiveCellToRowEdge = useCallback(
        (grid: SlickGrid, toEnd: boolean) => {
            const active = grid.getActiveCell();
            if (!active) {
                return;
            }

            const cell = toEnd
                ? grid.getColumns().length - 1
                : FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX;
            grid.setActiveCell(active.row, cell);
            selectRange(grid, new SlickRange(active.row, cell, active.row, cell));
        },
        [selectRange],
    );

    const expandSelection = useCallback((grid: SlickGrid, keyCode: string) => {
        const active = grid.getActiveCell();
        if (!active) {
            return;
        }

        const selectionModel = grid.getSelectionModel();
        const ranges = selectionModel?.getSelectedRanges() ?? [
            new SlickRange(active.row, active.cell),
        ];
        const nextRanges = [...ranges];
        let lastRange = nextRanges.pop() ?? new SlickRange(active.row, active.cell);
        if (!lastRange.contains(active.row, active.cell)) {
            lastRange = new SlickRange(active.row, active.cell);
        }

        const dirRow = active.row === lastRange.fromRow ? 1 : -1;
        const dirCell = active.cell === lastRange.fromCell ? 1 : -1;
        let rowDelta = lastRange.toRow - lastRange.fromRow;
        let cellDelta = lastRange.toCell - lastRange.fromCell;

        switch (keyCode) {
            case "ArrowLeft":
                cellDelta -= dirCell;
                break;
            case "ArrowRight":
                cellDelta += dirCell;
                break;
            case "ArrowUp":
                rowDelta -= dirRow;
                break;
            case "ArrowDown":
                rowDelta += dirRow;
                break;
            default:
                break;
        }

        const row = Math.min(
            Math.max(active.row + dirRow * rowDelta, 0),
            Math.max(0, grid.getDataLength() - 1),
        );
        const cell = Math.min(
            Math.max(active.cell + dirCell * cellDelta, FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX),
            grid.getColumns().length - 1,
        );
        nextRanges.push(new SlickRange(active.row, active.cell, row, cell));
        selectionModel?.setSelectedRanges(nextRanges);
        grid.scrollRowIntoView(row, false);
        grid.scrollCellIntoView(row, cell, false);
    }, []);

    const handleCommand = useCallback(
        async (event: FluentResultGridCommandEvent) => {
            const grid = reactGridRef.current?.slickGrid;
            if (!grid) {
                return;
            }

            const activeColumn = event.columnId
                ? (grid.getColumns().find((column) => column.id?.toString() === event.columnId) as
                      | Column<FluentResultGridDataRow>
                      | undefined)
                : getActiveDataColumn(grid)?.column;

            switch (event.commandId) {
                case FluentResultGridCommand.SelectAll:
                    selectAllCells(grid);
                    return;
                case FluentResultGridCommand.ToggleSort:
                    if (activeColumn) {
                        await toggleSortForColumn(grid, activeColumn);
                    }
                    return;
                case FluentResultGridCommand.OpenFilter:
                    if (activeColumn) {
                        await openFilterMenuForColumn(grid, activeColumn);
                    }
                    return;
                case FluentResultGridCommand.OpenResizeDialog:
                    if (activeColumn) {
                        openResizeDialogForColumn(grid, activeColumn);
                    }
                    return;
                case FluentResultGridCommand.FreezeColumn:
                    if (activeColumn) {
                        const columnIndex = grid.getColumnIndex(activeColumn.id);
                        setFrozenColumnIndex(columnIndex);
                        applyFrozenColumnIndex(grid, columnIndex);
                        emitStateChange(grid);
                    }
                    return;
                case FluentResultGridCommand.UnfreezeColumn:
                    if (activeColumn) {
                        setFrozenColumnIndex(FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX);
                        applyFrozenColumnIndex(
                            grid,
                            FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX,
                        );
                        emitStateChange(grid);
                    }
                    return;
                case FluentResultGridCommand.ClearAllFilters:
                    await clearAllFilters(grid);
                    return;
                case FluentResultGridCommand.ClearSort:
                    await clearSort(grid);
                    return;
                case FluentResultGridCommand.ShowAllColumns:
                    showAllColumns(grid);
                    return;
                case FluentResultGridCommand.SelectColumn:
                    selectActiveCellColumn(grid);
                    return;
                case FluentResultGridCommand.SelectRow:
                    selectActiveCellRow(grid);
                    return;
                case FluentResultGridCommand.MoveToRowStart:
                    moveActiveCellToRowEdge(grid, false);
                    return;
                case FluentResultGridCommand.MoveToRowEnd:
                    moveActiveCellToRowEdge(grid, true);
                    return;
                case FluentResultGridCommand.ExpandSelectionLeft:
                    expandSelection(grid, "ArrowLeft");
                    return;
                case FluentResultGridCommand.ExpandSelectionRight:
                    expandSelection(grid, "ArrowRight");
                    return;
                case FluentResultGridCommand.ExpandSelectionUp:
                    expandSelection(grid, "ArrowUp");
                    return;
                case FluentResultGridCommand.ExpandSelectionDown:
                    expandSelection(grid, "ArrowDown");
                    return;
                default:
                    break;
            }

            if (isFluentResultGridHostCommand(event.commandId)) {
                await emitHostCommand(grid, event);
            }
        },
        [
            applyFrozenColumnIndex,
            clearAllFilters,
            clearSort,
            emitHostCommand,
            emitStateChange,
            expandSelection,
            getActiveDataColumn,
            moveActiveCellToRowEdge,
            openFilterMenuForColumn,
            openResizeDialogForColumn,
            reactGridRef,
            selectActiveCellColumn,
            selectActiveCellRow,
            selectAllCells,
            setFrozenColumnIndex,
            showAllColumns,
            toggleSortForColumn,
        ],
    );

    const handleClick = useCallback(
        (event: CustomEvent) => {
            const args = event.detail?.args;
            if (!args) {
                return;
            }

            const grid = args.grid as SlickGrid;
            if (args.cell === 0 && showRowNumberColumn) {
                selectRange(
                    grid,
                    new SlickRange(
                        args.row,
                        FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX,
                        args.row,
                        grid.getColumns().length - 1,
                    ),
                );
                grid.setActiveCell(args.row, FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX);
                return;
            }

            if (args.cell < FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX) {
                return;
            }

            grid.setActiveCell(args.row, args.cell);
            selectRange(grid, new SlickRange(args.row, args.cell, args.row, args.cell));

            const row = grid.getDataItem(args.row) as FluentResultGridDataRow | undefined;
            const columnDefinition = grid.getColumns()[args.cell] as
                | Column<FluentResultGridDataRow>
                | undefined;
            if (!columnDefinition) {
                return;
            }

            const resultColumnIndex = getFluentResultGridColumnIndexFromColumn(columnDefinition);
            if (resultColumnIndex === undefined) {
                return;
            }

            const cellValue = row?.[resultColumnIndex.toString()] as DbCellValue | undefined;
            if (!cellValue || typeof cellValue !== "object" || cellValue.isNull) {
                return;
            }

            const column = resultSetSummary.columnInfo[resultColumnIndex];
            const languageId = column?.isXml
                ? FLUENT_RESULT_GRID_XML_LANGUAGE_ID
                : column?.isJson
                  ? FLUENT_RESULT_GRID_JSON_LANGUAGE_ID
                  : isXmlCell(cellValue.displayValue)
                    ? FLUENT_RESULT_GRID_XML_LANGUAGE_ID
                    : isJson(cellValue.displayValue)
                      ? FLUENT_RESULT_GRID_JSON_LANGUAGE_ID
                      : undefined;
            if (!languageId) {
                return;
            }

            void onCommand?.({
                ...commandContext,
                commandId: FluentResultGridCommand.OpenCell,
                cell: {
                    rowIndex: args.row,
                    columnIndex: resultColumnIndex,
                    value: cellValue,
                    languageId,
                },
            });
        },
        [commandContext, onCommand, resultSetSummary.columnInfo, selectRange, showRowNumberColumn],
    );

    const handleContextMenu = useCallback(
        (event: CustomEvent) => {
            const eventData = event.detail?.eventData as MouseEvent | undefined;
            const grid = event.detail?.args?.grid as SlickGrid | undefined;
            if (!eventData || !grid) {
                return;
            }

            eventData.preventDefault();
            eventData.stopPropagation();
            openOverlay({
                kind: "menu",
                gridId,
                placement: FluentResultGridCommandPlacement.CellContextMenu,
                x: eventData.clientX,
                y: eventData.clientY,
                commandContext: {
                    ...commandContext,
                    selection: getDisplayedFluentResultGridSelectionForCopy(
                        grid,
                        grid.getDataLength(),
                    ),
                },
                commands,
                onCommand: handleCommand,
            });
        },
        [commandContext, commands, gridId, handleCommand, openOverlay],
    );

    return {
        clearAllFilters,
        clearSort,
        expandSelection,
        getActiveDataColumn,
        handleClick,
        handleCommand,
        handleContextMenu,
        openFilterMenuForColumn,
        openResizeDialogForColumn,
        selectActiveCellColumn,
        selectActiveCellRow,
        selectAllCells,
        selectRange,
        showAllColumns,
        toggleSortForColumn,
    };
}
