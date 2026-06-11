/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import debounce from "lodash/debounce";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type FocusEvent as ReactFocusEvent,
    type RefObject,
} from "react";
import type { Column, GridOption, SlickgridReactInstance } from "slickgrid-react";
import {
    SlickEventData,
    SlickEventHandler,
    SlickGrid,
    SlickRange,
    type GridMenuCallbackArgs,
    type GridMenuCommandItemCallbackArgs,
} from "@slickgrid-universal/common";
import {
    baseFluentReadOnlyGridOption,
    createFluentAutoResizeOptions,
} from "../../FluentSlickGrid/FluentSlickGrid";
import { isJson } from "../../jsonUtils";
import { getPreviousFocusableElement } from "../../utils";
import { isXmlCell } from "../../xmlUtils";
import {
    ResultsGridAutoSizeStyle,
    SortProperties,
    type ColumnFilterMap,
    type DbCellValue,
    type GridViewState,
    type ISlickRange,
} from "../../../../sharedInterfaces/queryResult";
import { useFluentResultGridProvider } from "../FluentResultGridProvider";
import { FluentResultGridCommand } from "../types/fluentResultGridCommandIds";
import {
    FluentResultGridCommandPlacement,
    type FluentResultGridCommandEvent,
} from "../types/fluentResultGridCommands";
import type { FluentResultGridProps } from "../types/fluentResultGridProps";
import type { FluentResultGridState } from "../types/fluentResultGridState";
import {
    FLUENT_RESULT_GRID_AUTO_SIZE_CELL_PADDING_WIDTH,
    FLUENT_RESULT_GRID_AUTO_SIZE_HEADER_EXTRA_WIDTH,
    FLUENT_RESULT_GRID_AUTO_SIZE_SAMPLE_ROWS,
    FLUENT_RESULT_GRID_DEFAULT_COLUMN_WIDTH,
    FLUENT_RESULT_GRID_DEFAULT_FONT_SIZE,
    FLUENT_RESULT_GRID_DEFAULT_IN_MEMORY_DATA_PROCESSING_THRESHOLD,
    FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX,
    FLUENT_RESULT_GRID_JSON_LANGUAGE_ID,
    FLUENT_RESULT_GRID_MAX_COLUMN_WIDTH,
    FLUENT_RESULT_GRID_MIN_COLUMN_WIDTH,
    FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID,
    FLUENT_RESULT_GRID_SCROLL_POSITION_DEBOUNCE_MS,
    FLUENT_RESULT_GRID_WINDOW_SIZE,
    FLUENT_RESULT_GRID_XML_LANGUAGE_ID,
} from "./fluentResultGridConstants";
import {
    areAllFluentResultGridColumnsShown,
    createFluentResultGridColumns,
    getFluentResultGridColumnIndexFromColumn,
    isFluentResultGridDataColumn,
} from "./fluentResultGridColumns";
import {
    createFluentResultGridDataView,
    type FluentResultGridDataRow,
} from "./fluentResultGridDataView";
import { getFluentResultGridAutoSizeCellText } from "./fluentResultGridFormatters";
import {
    fluentResultGridEventMatchesShortcut,
    isFluentResultGridMetaOrCtrlKeyPressed,
} from "./fluentResultGridKeyboard";
import {
    buildFluentResultGridFilterItems,
    getFluentResultGridCellFilterValue,
    hasActiveFluentResultGridFilters,
    normalizeStoredFluentResultGridFilterValue,
} from "./fluentResultGridTransforms";
import type { FluentResultGridFilterValue } from "./fluentResultGridOverlays";
import {
    convertDisplayedSelectionRowsToActual,
    getDisplayedFluentResultGridSelectionForCopy,
    getFirstVisibleCellInFluentResultGridRange,
    getFluentResultGridDataSelectionsFromRanges,
    getFluentResultGridSlickRangesFromDataSelections,
} from "./fluentResultGridSelection";

const emptyDataset: FluentResultGridDataRow[] = [];
const clearAllFiltersCommand = "fluent-result-grid-clear-all-filters";
const clearSortCommand = "fluent-result-grid-clear-sort";
const showAllColumnsCommand = "fluent-result-grid-show-all-columns";
const defaultFrozenColumnIndex = 0;

type SourceRow = {
    rowId: number;
    cells: DbCellValue[];
};

type ReactGridInstanceWithSharedService = SlickgridReactInstance & {
    sharedService?: {
        allColumns?: Column<FluentResultGridDataRow>[];
        gridOptions?: GridOption;
        frozenVisibleColumnId?: string | number | null;
    };
};

type ControllerOptions = FluentResultGridProps & {
    containerRef: RefObject<HTMLDivElement | null>;
};

function normalizeRowPadding(rowPadding: number | null | undefined): number {
    return typeof rowPadding === "number" && Number.isFinite(rowPadding)
        ? Math.max(0, rowPadding)
        : 0;
}

function getRowHeight(rowHeight: number | undefined, rowPadding: number): number {
    return rowHeight ?? FLUENT_RESULT_GRID_DEFAULT_FONT_SIZE + 12 + rowPadding * 2;
}

function normalizeFrozenColumnIndex(value: number | undefined, columnCount: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return defaultFrozenColumnIndex;
    }

    return Math.min(
        Math.max(defaultFrozenColumnIndex, Math.trunc(value)),
        Math.max(defaultFrozenColumnIndex, columnCount - 1),
    );
}

function toAnchorRect(rect: DOMRect) {
    return {
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
        width: rect.width,
        height: rect.height,
    };
}

function isHostCommand(commandId: string): boolean {
    switch (commandId) {
        case FluentResultGridCommand.SelectAll:
        case FluentResultGridCommand.ToggleSort:
        case FluentResultGridCommand.OpenFilter:
        case FluentResultGridCommand.OpenResizeDialog:
        case FluentResultGridCommand.FreezeColumn:
        case FluentResultGridCommand.UnfreezeColumn:
        case FluentResultGridCommand.ClearAllFilters:
        case FluentResultGridCommand.ClearSort:
        case FluentResultGridCommand.ShowAllColumns:
        case FluentResultGridCommand.ExpandSelectionLeft:
        case FluentResultGridCommand.ExpandSelectionRight:
        case FluentResultGridCommand.ExpandSelectionUp:
        case FluentResultGridCommand.ExpandSelectionDown:
        case FluentResultGridCommand.OpenColumnMenu:
        case FluentResultGridCommand.MoveToRowStart:
        case FluentResultGridCommand.MoveToRowEnd:
        case FluentResultGridCommand.SelectColumn:
        case FluentResultGridCommand.SelectRow:
            return false;
        default:
            return true;
    }
}

export function useFluentResultGridController({
    containerRef,
    gridId,
    resultSetSummary,
    dataSource,
    showRowNumberColumn = true,
    autoSizeColumnsMode = ResultsGridAutoSizeStyle.HeadersAndData,
    inMemoryDataProcessingThreshold = FLUENT_RESULT_GRID_DEFAULT_IN_MEMORY_DATA_PROCESSING_THRESHOLD,
    gridSettings,
    rowHeight: rowHeightOverride,
    toolbar,
    commands,
    viewMode = "grid",
    canToggleViewMode,
    canToggleMaximize,
    isMaximized,
    initialState,
    onCommand,
    onStateChange,
    onSelectionSummaryChange,
    onInMemoryDataProcessingThresholdExceeded,
}: ControllerOptions) {
    const { strings, theme, keyBindings, openOverlay, closeOverlay } =
        useFluentResultGridProvider();
    const reactGridRef = useRef<SlickgridReactInstance | undefined>(undefined);
    const dataViewRef = useRef<ReturnType<typeof createFluentResultGridDataView> | undefined>(
        undefined,
    );
    const frozenPaneWheelCleanupRef = useRef<(() => void) | undefined>(undefined);
    const selectionEventHandlerRef = useRef<SlickEventHandler | undefined>(undefined);
    const gridStateEventHandlerRef = useRef<SlickEventHandler | undefined>(undefined);
    const keyboardEventHandlerRef = useRef<SlickEventHandler | undefined>(undefined);
    const handleKeyDownRef = useRef<
        ((eventData: SlickEventData, args: { grid: SlickGrid }) => void) | undefined
    >(undefined);
    const allRowsCacheRef = useRef<SourceRow[] | undefined>(undefined);
    const transformedRowsRef = useRef<SourceRow[] | undefined>(undefined);
    const filterStateRef = useRef<ColumnFilterMap>(initialState?.filters ?? {});
    const sortStateRef = useRef<FluentResultGridState["sort"] | undefined>(initialState?.sort);
    const activeFilterColumnRef = useRef<string | undefined>(undefined);
    const restoredStateRef = useRef(false);
    const restoredInitialStateSignatureRef = useRef<string | undefined>(undefined);
    const autoSizeRequestIdRef = useRef(0);
    const [frozenColumnIndex, setFrozenColumnIndex] = useState(
        () => initialState?.frozenColumnIndex ?? defaultFrozenColumnIndex,
    );
    const [isGridFocused, setIsGridFocused] = useState(false);
    const [displayedRowCount, setDisplayedRowCount] = useState(resultSetSummary.rowCount);
    const latestRowCountRef = useRef(resultSetSummary.rowCount);
    latestRowCountRef.current = resultSetSummary.rowCount;

    const rowPadding = normalizeRowPadding(gridSettings?.rowPadding);
    const rowHeight = getRowHeight(rowHeightOverride, rowPadding);
    const columnSignature = useMemo(
        () =>
            resultSetSummary.columnInfo
                .map((column) =>
                    [
                        column.columnName,
                        column.dataType,
                        column.isXml ? "xml" : "",
                        column.isJson ? "json" : "",
                        column.isVector ? "vector" : "",
                    ].join(","),
                )
                .join("|"),
        [resultSetSummary.columnInfo],
    );
    const resultIdentitySignature = useMemo(
        () =>
            [
                gridId,
                resultSetSummary.batchId,
                resultSetSummary.id,
                resultSetSummary.rowCount,
                columnSignature,
            ].join("|"),
        [
            columnSignature,
            gridId,
            resultSetSummary.batchId,
            resultSetSummary.id,
            resultSetSummary.rowCount,
        ],
    );
    const previousResultIdentitySignatureRef = useRef<string | undefined>(undefined);
    const dataSourceRef = useRef(dataSource);
    dataSourceRef.current = dataSource;
    const rowsDataSource = dataSource.kind === "rows" ? dataSource : undefined;
    const initialStateRestoreSignature = useMemo(
        () => JSON.stringify(initialState ?? {}),
        [initialState],
    );

    const fetchRowsFromSource = useCallback(
        async (offset: number, count: number): Promise<SourceRow[]> => {
            const currentDataSource = dataSourceRef.current;
            const rows =
                currentDataSource.kind === "rows"
                    ? currentDataSource.rows.slice(offset, offset + count)
                    : await currentDataSource.getRows(offset, count);

            return rows.map((cells, rowOffset) => ({
                rowId: offset + rowOffset,
                cells,
            }));
        },
        [],
    );

    const fetchRows = useCallback(
        async (offset: number, count: number): Promise<DbCellValue[][]> => {
            const transformedRows = transformedRowsRef.current;
            if (transformedRows) {
                return transformedRows.slice(offset, offset + count).map((row) => row.cells);
            }

            return (await fetchRowsFromSource(offset, count)).map((row) => row.cells);
        },
        [fetchRowsFromSource],
    );

    const dataView = useMemo(() => {
        return createFluentResultGridDataView({
            dataSource:
                rowsDataSource ??
                ({
                    kind: "windowed",
                    rowCount:
                        dataSourceRef.current.kind === "windowed"
                            ? dataSourceRef.current.rowCount
                            : 0,
                    getRows: fetchRows,
                } as const),
            columnCount: resultSetSummary.columnInfo.length,
            windowSize: FLUENT_RESULT_GRID_WINDOW_SIZE,
        });
    }, [fetchRows, resultSetSummary.columnInfo.length, rowsDataSource]);

    const dataViewKeyRef = useRef(0);
    const previousDataViewRef = useRef(dataView);
    if (previousDataViewRef.current !== dataView) {
        previousDataViewRef.current = dataView;
        dataViewKeyRef.current++;
    }
    dataViewRef.current = dataView;

    useEffect(() => {
        return () => {
            selectionEventHandlerRef.current?.unsubscribeAll();
            selectionEventHandlerRef.current = undefined;
            frozenPaneWheelCleanupRef.current?.();
            frozenPaneWheelCleanupRef.current = undefined;
            gridStateEventHandlerRef.current?.unsubscribeAll();
            gridStateEventHandlerRef.current = undefined;
            keyboardEventHandlerRef.current?.unsubscribeAll();
            keyboardEventHandlerRef.current = undefined;
            dataView.dispose();
            if (dataViewRef.current === dataView) {
                dataViewRef.current = undefined;
            }
        };
    }, [dataView]);

    useEffect(() => {
        const shouldResetData =
            previousResultIdentitySignatureRef.current !== resultIdentitySignature;
        previousResultIdentitySignatureRef.current = resultIdentitySignature;

        dataView.setLength(resultSetSummary.rowCount, shouldResetData);
        setDisplayedRowCount(resultSetSummary.rowCount);
        if (shouldResetData) {
            dataView.refresh(0);
        }
    }, [dataView, resultIdentitySignature, resultSetSummary.rowCount]);

    useEffect(() => {
        allRowsCacheRef.current = undefined;
        transformedRowsRef.current = undefined;
        filterStateRef.current = initialState?.filters ?? {};
        sortStateRef.current = initialState?.sort;
        activeFilterColumnRef.current = undefined;
        setFrozenColumnIndex(initialState?.frozenColumnIndex ?? defaultFrozenColumnIndex);
    }, [
        columnSignature,
        gridId,
        initialState?.filters,
        initialState?.frozenColumnIndex,
        initialState?.sort,
        resultSetSummary.batchId,
        resultSetSummary.id,
    ]);

    const columns = useMemo<Column<FluentResultGridDataRow>[]>(
        () =>
            createFluentResultGridColumns({
                columnInfo: resultSetSummary.columnInfo,
                showRowNumberColumn,
            }),
        [columnSignature, resultSetSummary.columnInfo, showRowNumberColumn],
    );

    const getCurrentColumnWidths = useCallback(
        (grid: SlickGrid): number[] => {
            const columnWidths = new Array<number>(resultSetSummary.columnInfo.length);
            grid.getColumns().forEach((column) => {
                if (column.id === FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID) {
                    return;
                }

                const columnIndex = Number(column.field);
                if (Number.isInteger(columnIndex)) {
                    columnWidths[columnIndex] =
                        column.width ?? FLUENT_RESULT_GRID_DEFAULT_COLUMN_WIDTH;
                }
            });

            return columnWidths.map((width) => width ?? FLUENT_RESULT_GRID_DEFAULT_COLUMN_WIDTH);
        },
        [resultSetSummary.columnInfo.length],
    );

    const getCurrentGridViewState = useCallback(
        (grid: SlickGrid, allColumns?: Column<FluentResultGridDataRow>[]): GridViewState => {
            const columnsForState = allColumns?.length
                ? allColumns
                : (grid.getColumns() as Column<FluentResultGridDataRow>[]);
            const selectedRanges = grid.getSelectionModel()?.getSelectedRanges() ?? [];

            return {
                hiddenColumnIds: columnsForState
                    .filter(isFluentResultGridDataColumn)
                    .filter((column) => !!column.hidden)
                    .map((column) => column.id.toString()),
                frozenColumnIndex: normalizeFrozenColumnIndex(
                    grid.getOptions().frozenColumn ?? frozenColumnIndex,
                    columnsForState.length,
                ),
                selection: getFluentResultGridDataSelectionsFromRanges(selectedRanges),
            };
        },
        [frozenColumnIndex],
    );

    const emitStateChange = useCallback(
        (grid: SlickGrid, allColumns?: Column<FluentResultGridDataRow>[]) => {
            if (!restoredStateRef.current) {
                return;
            }

            const viewport = grid.getViewport();
            onStateChange?.({
                ...(initialState ?? {}),
                ...getCurrentGridViewState(grid, allColumns),
                columnWidths: getCurrentColumnWidths(grid),
                filters: filterStateRef.current,
                sort: sortStateRef.current,
                scrollPosition: {
                    scrollLeft: viewport.leftPx,
                    scrollTop: viewport.top,
                },
            });
        },
        [getCurrentColumnWidths, getCurrentGridViewState, initialState, onStateChange],
    );

    const persistScrollPosition = useMemo(
        () =>
            debounce((grid: SlickGrid) => {
                emitStateChange(grid);
            }, FLUENT_RESULT_GRID_SCROLL_POSITION_DEBOUNCE_MS),
        [emitStateChange],
    );

    useEffect(() => {
        return () => {
            persistScrollPosition.cancel();
        };
    }, [persistScrollPosition]);

    const refreshFrozenColumnLayout = useCallback((grid: SlickGrid) => {
        grid.resizeCanvas();
        grid.invalidateAllRows();
        grid.updateRowCount();
        grid.render();
        dataViewRef.current?.ensureViewportLoaded();
    }, []);

    const syncFrozenColumnState = useCallback((grid: SlickGrid, columnIndex: number) => {
        const reactGrid = reactGridRef.current as ReactGridInstanceWithSharedService | undefined;
        if (reactGrid?.sharedService?.gridOptions) {
            reactGrid.sharedService.gridOptions.frozenColumn = columnIndex;
            reactGrid.sharedService.gridOptions.enableMouseWheelScrollHandler = true;
            reactGrid.sharedService.gridOptions.alwaysShowVerticalScroll = false;
            reactGrid.sharedService.gridOptions.skipFreezeColumnValidation = true;
        }

        const gridWithFrozenColumnId = grid as SlickGrid & {
            getFrozenColumnId?: () => string | number | null;
        };
        if (reactGrid?.sharedService) {
            reactGrid.sharedService.frozenVisibleColumnId =
                gridWithFrozenColumnId.getFrozenColumnId?.() ?? null;
        }
    }, []);

    const applyFrozenColumnIndex = useCallback(
        (grid: SlickGrid, columnIndex: number) => {
            grid.setOptions({
                alwaysShowVerticalScroll: false,
                enableMouseWheelScrollHandler: true,
                frozenColumn: columnIndex,
                skipFreezeColumnValidation: true,
            });
            syncFrozenColumnState(grid, columnIndex);
            refreshFrozenColumnLayout(grid);
        },
        [refreshFrozenColumnLayout, syncFrozenColumnState],
    );

    const attachFrozenPaneWheelHandler = useCallback((grid: SlickGrid) => {
        frozenPaneWheelCleanupRef.current?.();

        const containerNode = grid.getContainerNode();
        const handleFrozenPaneWheel = (event: WheelEvent) => {
            if ((grid.getOptions().frozenColumn ?? -1) < 0 || event.deltaY === 0) {
                return;
            }

            const target = event.target as Element | null;
            if (!target?.closest(".slick-viewport-left")) {
                return;
            }

            const scrollViewport = containerNode.querySelector<HTMLElement>(
                ".slick-viewport-top.slick-viewport-right",
            );
            if (!scrollViewport) {
                return;
            }

            scrollViewport.scrollTop += event.deltaY;
            dataViewRef.current?.ensureViewportLoaded();
            requestAnimationFrame(() => {
                dataViewRef.current?.ensureViewportLoaded();
                grid.render();
            });
            event.preventDefault();
            event.stopPropagation();
        };

        containerNode.addEventListener("wheel", handleFrozenPaneWheel, {
            capture: true,
            passive: false,
        });
        frozenPaneWheelCleanupRef.current = () => {
            containerNode.removeEventListener("wheel", handleFrozenPaneWheel, {
                capture: true,
            });
        };
    }, []);

    const restoreHorizontalScrollPosition = useCallback((grid: SlickGrid, scrollLeft: number) => {
        const containerNode = grid.getContainerNode();
        const horizontalViewport =
            containerNode.querySelector<HTMLElement>(".slick-viewport-top.slick-viewport-right") ??
            containerNode.querySelector<HTMLElement>(".slick-viewport");
        if (horizontalViewport) {
            horizontalViewport.scrollLeft = scrollLeft;
        }
    }, []);

    const ensureAllRowsLoaded = useCallback(async (): Promise<SourceRow[] | undefined> => {
        const currentRowCount = latestRowCountRef.current;
        if (currentRowCount > inMemoryDataProcessingThreshold) {
            await onInMemoryDataProcessingThresholdExceeded?.();
            return undefined;
        }

        const cachedRows = allRowsCacheRef.current;
        if (cachedRows && cachedRows.length === currentRowCount) {
            return cachedRows;
        }

        const rows = currentRowCount > 0 ? await fetchRowsFromSource(0, currentRowCount) : [];
        allRowsCacheRef.current = rows;
        return rows;
    }, [
        fetchRowsFromSource,
        inMemoryDataProcessingThreshold,
        onInMemoryDataProcessingThresholdExceeded,
    ]);

    const hasActiveSort = useCallback(
        () =>
            sortStateRef.current !== undefined &&
            sortStateRef.current.direction !== SortProperties.NONE,
        [],
    );

    const hasActiveTransforms = useCallback(
        () => hasActiveFluentResultGridFilters(filterStateRef.current) || hasActiveSort(),
        [hasActiveSort],
    );

    const updateHeaderButtonStates = useCallback((grid: SlickGrid) => {
        for (const column of grid.getColumns()) {
            const columnId = column.id?.toString();
            if (!columnId || columnId === FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID) {
                continue;
            }

            const headerNode = grid.getHeaderColumn(grid.getColumnIndex(column.id));
            const filterButton = headerNode?.querySelector<HTMLButtonElement>(
                ".slick-header-filterbutton",
            );
            const sortButton = headerNode?.querySelector<HTMLButtonElement>(
                ".slick-header-sortbutton",
            );
            const filterValues = filterStateRef.current[columnId]?.filterValues ?? [];
            filterButton?.classList.toggle("filtered", filterValues.length > 0);

            sortButton?.classList.remove("sorted-asc", "sorted-desc");
            if (sortStateRef.current?.columnId === columnId) {
                if (sortStateRef.current.direction === SortProperties.ASC) {
                    sortButton?.classList.add("sorted-asc");
                } else if (sortStateRef.current.direction === SortProperties.DESC) {
                    sortButton?.classList.add("sorted-desc");
                }
            }
        }
    }, []);

    const applyGridTransforms = useCallback(
        async (
            grid: SlickGrid,
            options?: { preserveScrollPosition?: boolean },
        ): Promise<boolean> => {
            const preservedTopRow = options?.preserveScrollPosition ? grid.getViewport().top : 0;
            const preservedScrollLeft = options?.preserveScrollPosition
                ? grid.getViewport().leftPx
                : 0;

            if (!hasActiveTransforms()) {
                transformedRowsRef.current = undefined;
                dataView.setLength(latestRowCountRef.current, true);
                setDisplayedRowCount(latestRowCountRef.current);
                const targetRow = Math.min(
                    preservedTopRow,
                    Math.max(0, latestRowCountRef.current - 1),
                );
                dataView.refresh(targetRow);
                grid.invalidateAllRows();
                grid.updateRowCount();
                if (options?.preserveScrollPosition && latestRowCountRef.current > 0) {
                    grid.scrollRowToTop(targetRow);
                }
                grid.render();
                if (options?.preserveScrollPosition) {
                    restoreHorizontalScrollPosition(grid, preservedScrollLeft);
                }
                dataView.ensureViewportLoaded();
                return true;
            }

            const allRows = await ensureAllRowsLoaded();
            if (!allRows) {
                return false;
            }

            let rows = [...allRows];
            for (const [columnId, filterState] of Object.entries(filterStateRef.current)) {
                const filterValues = filterState.filterValues?.map(
                    normalizeStoredFluentResultGridFilterValue,
                );
                if (!filterValues?.length) {
                    continue;
                }

                const selectedValues = new Set<FluentResultGridFilterValue>(filterValues);
                rows = rows.filter((row) =>
                    selectedValues.has(getFluentResultGridCellFilterValue(row.cells, columnId)),
                );
            }

            const sortState = sortStateRef.current;
            if (sortState && sortState.direction !== SortProperties.NONE) {
                const sortMultiplier = sortState.direction === SortProperties.ASC ? 1 : -1;
                rows.sort((a, b) => {
                    const left = getFluentResultGridCellFilterValue(a.cells, sortState.columnId);
                    const right = getFluentResultGridCellFilterValue(b.cells, sortState.columnId);
                    const leftNumber = Number(left);
                    const rightNumber = Number(right);
                    const isLeftNumber =
                        left !== undefined && left !== "" && !Number.isNaN(leftNumber);
                    const isRightNumber =
                        right !== undefined && right !== "" && !Number.isNaN(rightNumber);

                    if (left === undefined || right === undefined) {
                        return (left === right ? 0 : left === undefined ? -1 : 1) * sortMultiplier;
                    }

                    if (isLeftNumber || isRightNumber) {
                        if (isLeftNumber && isRightNumber) {
                            return (
                                (leftNumber === rightNumber
                                    ? 0
                                    : leftNumber > rightNumber
                                      ? 1
                                      : -1) * sortMultiplier
                            );
                        }

                        return (isLeftNumber ? -1 : 1) * sortMultiplier;
                    }

                    return left.localeCompare(right) * sortMultiplier;
                });
            }

            transformedRowsRef.current = rows;
            dataView.setLength(rows.length, true);
            setDisplayedRowCount(rows.length);
            const targetRow = Math.min(preservedTopRow, Math.max(0, rows.length - 1));
            dataView.refresh(targetRow);
            grid.invalidateAllRows();
            grid.updateRowCount();
            if (options?.preserveScrollPosition && rows.length > 0) {
                grid.scrollRowToTop(targetRow);
            } else {
                grid.scrollTo(0);
            }
            grid.render();
            if (options?.preserveScrollPosition) {
                restoreHorizontalScrollPosition(grid, preservedScrollLeft);
            }
            dataView.ensureViewportLoaded();
            return true;
        },
        [dataView, ensureAllRowsLoaded, hasActiveTransforms, restoreHorizontalScrollPosition],
    );

    const getActualSelectionForCopy = useCallback((grid: SlickGrid) => {
        const selection = getDisplayedFluentResultGridSelectionForCopy(grid, grid.getDataLength());
        const transformedRows = transformedRowsRef.current;
        if (!transformedRows) {
            return selection;
        }

        return convertDisplayedSelectionRowsToActual(
            selection,
            (displayRow) => transformedRows[displayRow]?.rowId,
        );
    }, []);

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
            grid.render();
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

            openOverlay({
                kind: "resizeDialog",
                gridId,
                columnId,
                columnName: typeof column.name === "string" ? column.name : "",
                initialWidth: column.width ?? FLUENT_RESULT_GRID_DEFAULT_COLUMN_WIDTH,
                minWidth: FLUENT_RESULT_GRID_MIN_COLUMN_WIDTH,
                maxWidth: FLUENT_RESULT_GRID_MAX_COLUMN_WIDTH,
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
            grid.render();
            grid.focus();
        },
        [applyGridTransforms, closeOverlay, emitStateChange, updateHeaderButtonStates],
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
            grid.render();
            grid.focus();
        },
        [applyGridTransforms, emitStateChange, updateHeaderButtonStates],
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
            grid.render();
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
            grid.render();
            grid.focus();
        },
        [applyGridTransforms, emitStateChange, updateHeaderButtonStates],
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

            const normalizedFilterValues =
                availableItems && filterValues.length === availableItems.length ? [] : filterValues;
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
        [applyGridTransforms, emitStateChange, updateHeaderButtonStates],
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
                anchorRect: toAnchorRect(headerNode.getBoundingClientRect()),
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
        [closeOverlay, ensureAllRowsLoaded, gridId, openOverlay, strings, updateFilterForColumn],
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

    const moveFocusOutsideGrid = useCallback(
        (forward: boolean) => {
            if (!containerRef.current) {
                return;
            }

            if (forward) {
                const toolbarTarget = containerRef.current.querySelector<HTMLElement>(
                    '[data-fluent-result-grid-toolbar="true"] button:not([disabled])',
                );
                toolbarTarget?.focus();
                return;
            }

            const focusableGridElements = [
                containerRef.current,
                ...Array.from(
                    containerRef.current.querySelectorAll<HTMLElement>(
                        'a[href], button, textarea, input:not([type="hidden"]), select, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
                    ),
                ),
            ].filter(
                (element) =>
                    !element.hasAttribute("disabled") && element.getClientRects().length > 0,
            );
            const boundaryElement = focusableGridElements[0];
            if (!boundaryElement) {
                return;
            }

            getPreviousFocusableElement(boundaryElement)?.focus();
        },
        [containerRef],
    );

    const commandContext = useMemo(
        () => ({
            gridId,
            batchId: resultSetSummary.batchId,
            resultId: resultSetSummary.id,
            viewMode,
            canToggleViewMode,
            canToggleMaximize,
            isMaximized,
            selection:
                reactGridRef.current?.slickGrid &&
                getDisplayedFluentResultGridSelectionForCopy(
                    reactGridRef.current.slickGrid,
                    reactGridRef.current.slickGrid.getDataLength(),
                ),
        }),
        [
            canToggleMaximize,
            canToggleViewMode,
            gridId,
            isMaximized,
            resultSetSummary.batchId,
            resultSetSummary.id,
            viewMode,
        ],
    );

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
                        setFrozenColumnIndex(defaultFrozenColumnIndex);
                        applyFrozenColumnIndex(grid, defaultFrozenColumnIndex);
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

            if (isHostCommand(event.commandId)) {
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
            selectActiveCellColumn,
            selectActiveCellRow,
            selectAllCells,
            showAllColumns,
            toggleSortForColumn,
        ],
    );

    const openHeaderContextMenuForColumn = useCallback(
        (grid: SlickGrid, column: Column<FluentResultGridDataRow>, x: number, y: number) => {
            const columnId = column.id?.toString();
            const columnIndex = grid.getColumnIndex(column.id);
            if (!columnId || column.id === FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID) {
                return;
            }

            const activeFrozenColumnIndex = grid.getOptions().frozenColumn ?? frozenColumnIndex;
            openOverlay({
                kind: "menu",
                gridId,
                placement: FluentResultGridCommandPlacement.ColumnHeaderMenu,
                x,
                y,
                commandContext: {
                    ...commandContext,
                    column: resultSetSummary.columnInfo[Number(column.field)],
                    columnId,
                    isColumnFrozen: activeFrozenColumnIndex >= columnIndex,
                },
                commands,
                onCommand: handleCommand,
            });
        },
        [
            commandContext,
            commands,
            frozenColumnIndex,
            gridId,
            handleCommand,
            openOverlay,
            resultSetSummary.columnInfo,
        ],
    );

    const openHeaderContextMenuForActiveColumn = useCallback(
        (grid: SlickGrid) => {
            const activeColumn = getActiveDataColumn(grid);
            if (!activeColumn) {
                return;
            }

            const columnIndex = grid.getColumnIndex(activeColumn.column.id);
            const headerNode = grid.getHeaderColumn(columnIndex);
            const headerRect = headerNode?.getBoundingClientRect();
            openHeaderContextMenuForColumn(
                grid,
                activeColumn.column,
                headerRect ? headerRect.left : window.innerWidth / 2,
                headerRect ? headerRect.bottom : window.innerHeight / 2,
            );
        },
        [getActiveDataColumn, openHeaderContextMenuForColumn],
    );

    const completeKeyboardEvent = useCallback((eventData: SlickEventData) => {
        eventData.preventDefault();
        eventData.stopPropagation();
        eventData.stopImmediatePropagation();
    }, []);

    const handleKeyDown = useCallback(
        (eventData: SlickEventData, args: { grid: SlickGrid }) => {
            const keyboardEvent = eventData.getNativeEvent<KeyboardEvent>();
            const grid = args.grid;
            if (!keyboardEvent || !grid) {
                return;
            }

            let commandId: string | undefined;
            let handled = true;

            if (
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent,
                    keyBindings[FluentResultGridCommand.CopySelection],
                )
            ) {
                commandId = FluentResultGridCommand.CopySelection;
            } else if (
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent,
                    keyBindings[FluentResultGridCommand.CopyWithHeaders],
                )
            ) {
                commandId = FluentResultGridCommand.CopyWithHeaders;
            } else if (
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent,
                    keyBindings[FluentResultGridCommand.CopyHeaders],
                )
            ) {
                commandId = FluentResultGridCommand.CopyHeaders;
            } else if (
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent,
                    keyBindings[FluentResultGridCommand.CopyAsCsv],
                )
            ) {
                commandId = FluentResultGridCommand.CopyAsCsv;
            } else if (
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent,
                    keyBindings[FluentResultGridCommand.CopyAsJson],
                )
            ) {
                commandId = FluentResultGridCommand.CopyAsJson;
            } else if (
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent,
                    keyBindings[FluentResultGridCommand.CopyAsInsertInto],
                )
            ) {
                commandId = FluentResultGridCommand.CopyAsInsertInto;
            } else if (
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent,
                    keyBindings[FluentResultGridCommand.CopyAsInClause],
                )
            ) {
                commandId = FluentResultGridCommand.CopyAsInClause;
            } else if (
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent,
                    keyBindings[FluentResultGridCommand.SaveAsJson],
                )
            ) {
                commandId = FluentResultGridCommand.SaveAsJson;
            } else if (
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent,
                    keyBindings[FluentResultGridCommand.SaveAsCsv],
                )
            ) {
                commandId = FluentResultGridCommand.SaveAsCsv;
            } else if (
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent,
                    keyBindings[FluentResultGridCommand.SaveAsExcel],
                )
            ) {
                commandId = FluentResultGridCommand.SaveAsExcel;
            } else if (
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent,
                    keyBindings[FluentResultGridCommand.SaveAsInsert],
                )
            ) {
                commandId = FluentResultGridCommand.SaveAsInsert;
            } else if (
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent,
                    keyBindings[FluentResultGridCommand.SelectAll],
                ) ||
                (isFluentResultGridMetaOrCtrlKeyPressed(keyboardEvent) &&
                    keyboardEvent.code === "KeyA")
            ) {
                commandId = FluentResultGridCommand.SelectAll;
            } else if (
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent,
                    keyBindings[FluentResultGridCommand.ExpandSelectionLeft],
                ) ||
                (keyboardEvent.shiftKey &&
                    !isFluentResultGridMetaOrCtrlKeyPressed(keyboardEvent) &&
                    keyboardEvent.code === "ArrowLeft")
            ) {
                commandId = FluentResultGridCommand.ExpandSelectionLeft;
            } else if (
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent,
                    keyBindings[FluentResultGridCommand.ExpandSelectionRight],
                ) ||
                (keyboardEvent.shiftKey &&
                    !isFluentResultGridMetaOrCtrlKeyPressed(keyboardEvent) &&
                    keyboardEvent.code === "ArrowRight")
            ) {
                commandId = FluentResultGridCommand.ExpandSelectionRight;
            } else if (
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent,
                    keyBindings[FluentResultGridCommand.ExpandSelectionUp],
                ) ||
                (keyboardEvent.shiftKey &&
                    !isFluentResultGridMetaOrCtrlKeyPressed(keyboardEvent) &&
                    keyboardEvent.code === "ArrowUp")
            ) {
                commandId = FluentResultGridCommand.ExpandSelectionUp;
            } else if (
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent,
                    keyBindings[FluentResultGridCommand.ExpandSelectionDown],
                ) ||
                (keyboardEvent.shiftKey &&
                    !isFluentResultGridMetaOrCtrlKeyPressed(keyboardEvent) &&
                    keyboardEvent.code === "ArrowDown")
            ) {
                commandId = FluentResultGridCommand.ExpandSelectionDown;
            } else if (
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent,
                    keyBindings[FluentResultGridCommand.OpenColumnMenu],
                ) ||
                (keyboardEvent.shiftKey && keyboardEvent.code === "F10") ||
                keyboardEvent.code === "ContextMenu"
            ) {
                openHeaderContextMenuForActiveColumn(grid);
            } else if (
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent,
                    keyBindings[FluentResultGridCommand.OpenFilter],
                )
            ) {
                commandId = FluentResultGridCommand.OpenFilter;
            } else if (
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent,
                    keyBindings[FluentResultGridCommand.MoveToRowStart],
                )
            ) {
                commandId = FluentResultGridCommand.MoveToRowStart;
            } else if (
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent,
                    keyBindings[FluentResultGridCommand.MoveToRowEnd],
                )
            ) {
                commandId = FluentResultGridCommand.MoveToRowEnd;
            } else if (
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent,
                    keyBindings[FluentResultGridCommand.SelectColumn],
                )
            ) {
                commandId = FluentResultGridCommand.SelectColumn;
            } else if (
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent,
                    keyBindings[FluentResultGridCommand.SelectRow],
                )
            ) {
                commandId = FluentResultGridCommand.SelectRow;
            } else if (
                fluentResultGridEventMatchesShortcut(
                    keyboardEvent,
                    keyBindings[FluentResultGridCommand.ToggleSort],
                )
            ) {
                commandId = FluentResultGridCommand.ToggleSort;
            } else if (keyboardEvent.shiftKey && keyboardEvent.code === "Tab") {
                moveFocusOutsideGrid(false);
            } else if (!keyboardEvent.shiftKey && keyboardEvent.code === "Tab") {
                moveFocusOutsideGrid(true);
            } else {
                handled = false;
            }

            if (commandId) {
                void handleCommand({
                    ...commandContext,
                    commandId,
                });
            }

            if (handled) {
                completeKeyboardEvent(eventData);
            }
        },
        [
            commandContext,
            completeKeyboardEvent,
            handleCommand,
            keyBindings,
            moveFocusOutsideGrid,
            openHeaderContextMenuForActiveColumn,
        ],
    );
    handleKeyDownRef.current = handleKeyDown;

    const applyAutoSizeColumns = useCallback(
        async (requestId?: number) => {
            const grid = reactGridRef.current?.slickGrid;
            if (!grid || autoSizeColumnsMode === ResultsGridAutoSizeStyle.Off) {
                return;
            }

            const includeHeaders =
                autoSizeColumnsMode === ResultsGridAutoSizeStyle.HeadersAndData ||
                autoSizeColumnsMode === ResultsGridAutoSizeStyle.HeaderOnly;
            const includeData =
                autoSizeColumnsMode === ResultsGridAutoSizeStyle.HeadersAndData ||
                autoSizeColumnsMode === ResultsGridAutoSizeStyle.DataOnly;
            if (!includeHeaders && !includeData) {
                return;
            }

            const currentRowCount = latestRowCountRef.current;
            const sampleRows =
                includeData && currentRowCount > 0
                    ? await fetchRows(
                          0,
                          Math.min(FLUENT_RESULT_GRID_AUTO_SIZE_SAMPLE_ROWS, currentRowCount),
                      )
                    : [];
            if (requestId !== undefined && autoSizeRequestIdRef.current !== requestId) {
                return;
            }

            const canvasContext = document.createElement("canvas").getContext("2d");
            if (!canvasContext) {
                return;
            }

            const computedStyle = containerRef.current
                ? window.getComputedStyle(containerRef.current)
                : undefined;
            const fontSize =
                parseInt(computedStyle?.fontSize ?? "", 10) || FLUENT_RESULT_GRID_DEFAULT_FONT_SIZE;
            const fontFamily = computedStyle?.fontFamily ?? "monospace";
            canvasContext.font = `${fontSize}px ${fontFamily}`;

            const resizedColumns = grid.getColumns().map((column, columnIndex) => {
                if (column.id === FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID || columnIndex === 0) {
                    return column;
                }

                const headerWidth = includeHeaders
                    ? canvasContext.measureText(String(column.name ?? "")).width +
                      FLUENT_RESULT_GRID_AUTO_SIZE_HEADER_EXTRA_WIDTH
                    : 0;
                const dataWidth = includeData
                    ? sampleRows.reduce((maxWidth, row) => {
                          const columnDataIndex = Number(column.field);
                          const value = Number.isInteger(columnDataIndex)
                              ? row[columnDataIndex]
                              : undefined;
                          const text = getFluentResultGridAutoSizeCellText(value);
                          return Math.max(
                              maxWidth,
                              canvasContext.measureText(text).width +
                                  FLUENT_RESULT_GRID_AUTO_SIZE_CELL_PADDING_WIDTH,
                          );
                      }, 0)
                    : 0;

                return {
                    ...column,
                    width: Math.max(
                        FLUENT_RESULT_GRID_MIN_COLUMN_WIDTH,
                        Math.min(
                            FLUENT_RESULT_GRID_MAX_COLUMN_WIDTH,
                            Math.ceil(Math.max(headerWidth, dataWidth)) + 1,
                        ),
                    ),
                };
            });

            if (requestId !== undefined && autoSizeRequestIdRef.current !== requestId) {
                return;
            }

            grid.setColumns(resizedColumns);
            grid.invalidate();
            grid.render();
        },
        [autoSizeColumnsMode, containerRef, fetchRows],
    );

    const scheduleAutoSizeColumns = useCallback(() => {
        const requestId = ++autoSizeRequestIdRef.current;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (autoSizeRequestIdRef.current === requestId) {
                    void applyAutoSizeColumns(requestId);
                }
            });
        });
    }, [applyAutoSizeColumns]);

    const restoreInitialState = useCallback(
        async (grid: SlickGrid) => {
            restoredStateRef.current = false;
            try {
                const shouldAutoSizeColumns = !initialState?.columnWidths?.length;
                if (initialState?.columnWidths?.length) {
                    autoSizeRequestIdRef.current++;
                    const restoredColumns = grid.getColumns().map((column) => {
                        if (column.id === FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID) {
                            return column;
                        }

                        const columnIndex = Number(column.field);
                        const width = initialState.columnWidths?.[columnIndex];
                        return typeof width === "number" ? { ...column, width } : column;
                    });
                    grid.setColumns(restoredColumns);
                }

                filterStateRef.current = initialState?.filters ?? {};
                sortStateRef.current = initialState?.sort;
                if (hasActiveTransforms()) {
                    await applyGridTransforms(grid);
                } else {
                    transformedRowsRef.current = undefined;
                    dataView.setLength(latestRowCountRef.current, false);
                    setDisplayedRowCount(latestRowCountRef.current);
                    dataView.ensureViewportLoaded();
                }

                let restoredColumns = grid.getColumns() as Column<FluentResultGridDataRow>[];
                if (Array.isArray(initialState?.hiddenColumnIds)) {
                    const hiddenColumnIds = new Set(initialState.hiddenColumnIds);
                    restoredColumns = restoredColumns.map((column) =>
                        isFluentResultGridDataColumn(column)
                            ? {
                                  ...column,
                                  hidden: hiddenColumnIds.has(column.id.toString()),
                              }
                            : column,
                    );
                    grid.setColumns(restoredColumns);
                }

                const restoredFrozenColumnIndex = normalizeFrozenColumnIndex(
                    initialState?.frozenColumnIndex,
                    restoredColumns.length,
                );
                setFrozenColumnIndex(restoredFrozenColumnIndex);
                applyFrozenColumnIndex(grid, restoredFrozenColumnIndex);

                if (Array.isArray(initialState?.selection)) {
                    const ranges = getFluentResultGridSlickRangesFromDataSelections(
                        initialState.selection,
                        grid.getDataLength(),
                        restoredColumns.length,
                    );
                    grid.getSelectionModel()?.setSelectedRanges(ranges);

                    const activeCell = ranges[0]
                        ? getFirstVisibleCellInFluentResultGridRange(grid, ranges[0])
                        : undefined;
                    if (activeCell) {
                        grid.setActiveCell(activeCell.row, activeCell.cell);
                    }
                }

                if (initialState?.scrollPosition) {
                    requestAnimationFrame(() => {
                        if (initialState.scrollPosition) {
                            grid.scrollRowToTop(initialState.scrollPosition.scrollTop);
                            restoreHorizontalScrollPosition(
                                grid,
                                initialState.scrollPosition.scrollLeft,
                            );
                        }
                    });
                }

                updateHeaderButtonStates(grid);
                grid.invalidate();
                grid.render();
                if (shouldAutoSizeColumns) {
                    scheduleAutoSizeColumns();
                }
            } finally {
                restoredStateRef.current = true;
            }
        },
        [
            applyFrozenColumnIndex,
            applyGridTransforms,
            dataView,
            hasActiveTransforms,
            initialState,
            restoreHorizontalScrollPosition,
            scheduleAutoSizeColumns,
            updateHeaderButtonStates,
        ],
    );

    const restoreCurrentInitialState = useCallback(
        (grid: SlickGrid) => {
            restoredInitialStateSignatureRef.current = initialStateRestoreSignature;
            void restoreInitialState(grid);
        },
        [initialStateRestoreSignature, restoreInitialState],
    );

    useEffect(() => {
        const grid = reactGridRef.current?.slickGrid;
        if (!grid || restoredInitialStateSignatureRef.current === initialStateRestoreSignature) {
            return;
        }

        restoreCurrentInitialState(grid);
    }, [initialStateRestoreSignature, restoreCurrentInitialState]);

    const gridOptions = useMemo<GridOption>(
        () => ({
            ...baseFluentReadOnlyGridOption,
            alwaysShowVerticalScroll: false,
            autoResize: createFluentAutoResizeOptions(`#fluent-result-grid-body-${gridId}`, {
                bottomPadding: 0,
                minHeight: 50,
            }),
            darkMode: theme?.kind === "dark",
            datasetIdPropertyName: "id",
            editable: false,
            enableAutoSizeColumns: false,
            enableCellNavigation: true,
            enableColumnPicker: false,
            enableColumnReorder: true,
            enableContextMenu: false,
            enableEmptyDataWarningMessage: false,
            enableExcelCopyBuffer: false,
            enableGridMenu: true,
            enableSorting: false,
            enableMouseWheelScrollHandler: true,
            enableSelection: true,
            forceFitColumns: false,
            frozenColumn: frozenColumnIndex,
            frozenRightViewportMinWidth: 50,
            gridMenu: {
                commandItems: [
                    {
                        command: clearAllFiltersCommand,
                        iconCssClass: "fi fi-filter-dismiss",
                        itemVisibilityOverride: () =>
                            hasActiveFluentResultGridFilters(filterStateRef.current),
                        positionOrder: 10,
                        title: strings.commands[FluentResultGridCommand.ClearAllFilters]?.label,
                        action: (_event: Event, args: GridMenuCommandItemCallbackArgs) => {
                            void clearAllFilters(args.grid);
                        },
                    },
                    {
                        command: clearSortCommand,
                        iconCssClass: "fi fi-arrow-sort",
                        itemVisibilityOverride: () => hasActiveSort(),
                        positionOrder: 11,
                        title: strings.commands[FluentResultGridCommand.ClearSort]?.label,
                        action: (_event: Event, args: GridMenuCommandItemCallbackArgs) => {
                            void clearSort(args.grid);
                        },
                    },
                    {
                        command: showAllColumnsCommand,
                        iconCssClass: "fi fi-table",
                        itemUsabilityOverride: (args: GridMenuCallbackArgs) =>
                            !areAllFluentResultGridColumnsShown(
                                args.columns as Column<FluentResultGridDataRow>[],
                            ),
                        positionOrder: 12,
                        title: strings.commands[FluentResultGridCommand.ShowAllColumns]?.label,
                        action: (_event: Event, args: GridMenuCommandItemCallbackArgs) => {
                            showAllColumns(
                                args.grid,
                                args.allColumns as Column<FluentResultGridDataRow>[],
                            );
                        },
                    },
                ],
                hideForceFitButton: true,
                hideSyncResizeButton: true,
                onColumnsChanged: (_event, args) => {
                    emitStateChange(
                        args.grid,
                        args.allColumns as Column<FluentResultGridDataRow>[],
                    );
                },
            },
            rowHeight,
            selectionOptions: {
                selectActiveCell: true,
                selectActiveRow: false,
                selectionType: "cell",
            },
            skipFreezeColumnValidation: true,
        }),
        [
            clearAllFilters,
            clearSort,
            emitStateChange,
            frozenColumnIndex,
            gridId,
            hasActiveSort,
            rowHeightOverride,
            rowHeight,
            showAllColumns,
            strings.commands,
            theme?.kind,
        ],
    );

    const handleReactGridCreated = useCallback(
        (event: CustomEvent<SlickgridReactInstance>) => {
            const reactGrid = event.detail;
            const grid = reactGrid.slickGrid;
            reactGridRef.current = reactGrid;
            dataViewRef.current?.setGrid(grid);
            attachFrozenPaneWheelHandler(grid);

            selectionEventHandlerRef.current?.unsubscribeAll();
            selectionEventHandlerRef.current = new SlickEventHandler();
            gridStateEventHandlerRef.current?.unsubscribeAll();
            gridStateEventHandlerRef.current = new SlickEventHandler();
            keyboardEventHandlerRef.current?.unsubscribeAll();
            keyboardEventHandlerRef.current = new SlickEventHandler();
            keyboardEventHandlerRef.current.subscribe(grid.onKeyDown, (eventData, args) => {
                handleKeyDownRef.current?.(eventData as SlickEventData, args);
            });

            const selectionModel = grid.getSelectionModel();
            if (selectionModel?.onSelectedRangesChanged) {
                selectionEventHandlerRef.current.subscribe(
                    selectionModel.onSelectedRangesChanged,
                    (_event, ranges) => {
                        const selection = getFluentResultGridDataSelectionsFromRanges(ranges);
                        void onSelectionSummaryChange?.(selection);
                        emitStateChange(grid);
                    },
                );
            }

            gridStateEventHandlerRef.current.subscribe(grid.onColumnsResized, () => {
                emitStateChange(grid);
            });
            gridStateEventHandlerRef.current.subscribe(grid.onColumnsReordered, () => {
                emitStateChange(grid);
            });
            gridStateEventHandlerRef.current.subscribe(grid.onScroll, () => {
                persistScrollPosition(grid);
            });

            grid.getContainerNode()
                .querySelectorAll<HTMLElement>(".slick-grid-menu-button")
                .forEach((button) => {
                    button.tabIndex = -1;
                });
            requestAnimationFrame(() => {
                grid.getContainerNode()
                    .querySelectorAll<HTMLElement>(".slick-grid-menu-button")
                    .forEach((button) => {
                        button.tabIndex = -1;
                    });
            });

            grid.updateRowCount();
            grid.render();
            restoreCurrentInitialState(grid);
        },
        [
            attachFrozenPaneWheelHandler,
            emitStateChange,
            onSelectionSummaryChange,
            persistScrollPosition,
            restoreCurrentInitialState,
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

    const handleHeaderContextMenu = useCallback(
        (event: CustomEvent) => {
            const eventData = event.detail?.eventData as MouseEvent | undefined;
            const args = event.detail?.args;
            const grid = args?.grid as SlickGrid | undefined;
            const column = args?.column as Column<FluentResultGridDataRow> | undefined;
            if (
                !eventData ||
                !grid ||
                !column ||
                column.id === FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID
            ) {
                return;
            }

            eventData.preventDefault();
            eventData.stopPropagation();
            openHeaderContextMenuForColumn(grid, column, eventData.clientX, eventData.clientY);
        },
        [openHeaderContextMenuForColumn],
    );

    const handleHeaderCellRendered = useCallback(
        (event: CustomEvent) => {
            const args = event.detail?.args;
            const grid = args?.grid as SlickGrid | undefined;
            const column = args?.column as Column<FluentResultGridDataRow> | undefined;
            const node = args?.node as HTMLElement | undefined;
            if (
                !grid ||
                !column ||
                !node ||
                column.id === FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID
            ) {
                if (node) {
                    node.tabIndex = -1;
                }
                return;
            }

            node.tabIndex = -1;
            if (node.classList.contains("slick-header-with-filter")) {
                node.classList.remove("slick-header-sortable", "slick-header-column-sorted");
                node.querySelector(".slick-sort-indicator")?.remove();
                node.querySelector(".slick-sort-indicator-numbered")?.remove();
                updateHeaderButtonStates(grid);
                return;
            }

            node.classList.add("slick-header-with-filter");
            node.classList.remove("slick-header-sortable", "slick-header-column-sorted");
            node.querySelector(".slick-sort-indicator")?.remove();
            node.querySelector(".slick-sort-indicator-numbered")?.remove();

            const sortTitle =
                strings.commands[FluentResultGridCommand.ToggleSort]?.tooltip ??
                strings.commands[FluentResultGridCommand.ToggleSort]?.label ??
                "";
            const sortButton = document.createElement("button");
            sortButton.id = "sort-btn";
            sortButton.type = "button";
            sortButton.className = "slick-header-sortbutton";
            sortButton.tabIndex = -1;
            sortButton.setAttribute("aria-label", sortTitle);
            sortButton.title = sortTitle;
            sortButton.addEventListener("mousedown", (mouseEvent) => {
                mouseEvent.preventDefault();
                mouseEvent.stopPropagation();
            });
            sortButton.addEventListener("click", async (clickEvent) => {
                clickEvent.preventDefault();
                clickEvent.stopPropagation();
                await toggleSortForColumn(grid, column);
            });
            const resizableHandle = node.querySelector(".slick-resizable-handle");
            node.insertBefore(sortButton, resizableHandle);

            const filterTitle =
                strings.commands[FluentResultGridCommand.OpenFilter]?.tooltip ??
                strings.commands[FluentResultGridCommand.OpenFilter]?.label ??
                "";
            const filterButton = document.createElement("button");
            filterButton.id = "filter-btn";
            filterButton.type = "button";
            filterButton.className = "slick-header-filterbutton";
            filterButton.tabIndex = -1;
            filterButton.setAttribute("aria-label", filterTitle);
            filterButton.title = filterTitle;
            filterButton.addEventListener("mousedown", (mouseEvent) => {
                mouseEvent.preventDefault();
                mouseEvent.stopPropagation();
            });
            filterButton.addEventListener("click", async (clickEvent) => {
                clickEvent.preventDefault();
                clickEvent.stopPropagation();
                await openFilterMenuForColumn(grid, column);
            });
            node.insertBefore(filterButton, resizableHandle);
            updateHeaderButtonStates(grid);
        },
        [openFilterMenuForColumn, strings.commands, toggleSortForColumn, updateHeaderButtonStates],
    );

    const handleBeforeHeaderCellDestroy = useCallback((event: CustomEvent) => {
        const node = event.detail?.args?.node as HTMLElement | undefined;
        if (!node) {
            return;
        }

        node.querySelector(".slick-header-sortbutton")?.remove();
        node.querySelector(".slick-header-filterbutton")?.remove();
        node.classList.remove("slick-header-with-filter");
    }, []);

    const handleHeaderClick = useCallback(
        (event: CustomEvent) => {
            closeOverlay();
            const args = event.detail?.args;
            const grid = args?.grid as SlickGrid | undefined;
            const column = args?.column as Column<FluentResultGridDataRow> | undefined;
            if (!grid || !column || grid.getDataLength() <= 0) {
                return;
            }

            const columnIndex = grid.getColumnIndex(column.id);
            const lastRow = grid.getDataLength() - 1;
            const lastCell = grid.getColumns().length - 1;

            if (column.id === FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID) {
                selectRange(
                    grid,
                    new SlickRange(0, FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX, lastRow, lastCell),
                );
                return;
            }

            if (columnIndex >= FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX) {
                selectRange(grid, new SlickRange(0, columnIndex, lastRow, columnIndex));
            }
        },
        [closeOverlay, selectRange],
    );

    const focusGrid = useCallback(() => {
        const grid = reactGridRef.current?.slickGrid;
        if (!grid || grid.getDataLength() <= 0) {
            containerRef.current?.focus();
            return;
        }

        const active = grid.getActiveCell();
        const row = active?.row ?? 0;
        const cell = Math.max(
            active?.cell ?? FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX,
            FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX,
        );
        (grid as SlickGrid & { tabbingDirection?: number }).tabbingDirection = 1;
        grid.gotoCell(row, cell, false);
    }, [containerRef]);

    const handleGridContainerFocus = useCallback(
        (event: ReactFocusEvent<HTMLDivElement>) => {
            setIsGridFocused(true);

            if (event.target === event.currentTarget) {
                focusGrid();
            }
        },
        [focusGrid],
    );

    const handleGridContainerBlur = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
        const nextFocusedElement = event.relatedTarget as Node | null;
        if (!nextFocusedElement || !event.currentTarget.contains(nextFocusedElement)) {
            setIsGridFocused(false);
        }
    }, []);

    return {
        columns,
        commandContext,
        dataView,
        dataViewKey: dataViewKeyRef.current,
        displayedRowCount,
        focusGrid,
        gridOptions,
        handleBeforeHeaderCellDestroy,
        handleClick,
        handleCommand,
        handleContextMenu,
        handleGridContainerBlur,
        handleGridContainerFocus,
        handleHeaderCellRendered,
        handleHeaderClick,
        handleHeaderContextMenu,
        handleReactGridCreated,
        isGridFocused,
        toolbar,
        commands,
        emptyDataset,
    };
}
