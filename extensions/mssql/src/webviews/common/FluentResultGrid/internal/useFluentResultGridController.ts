/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import debounce from "lodash/debounce";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
    Column,
    GridMenuCallbackArgs,
    GridMenuCommandItemCallbackArgs,
    GridOption,
    SlickGrid,
} from "slickgrid-react";
import {
    baseFluentReadOnlyGridOption,
    createFluentAutoResizeOptions,
} from "../../FluentSlickGrid/FluentSlickGrid";
import { ResultsGridAutoSizeStyle } from "../../../../sharedInterfaces/queryResult";
import { useFluentResultGridProvider } from "../FluentResultGridProvider";
import { FluentResultGridCommand } from "../types/fluentResultGridCommandIds";
import type {
    FluentResultGridControllerOptions,
    FluentResultGridControllerResult,
    ReactGridInstanceWithSharedService,
} from "./fluentResultGridControllerTypes";
import {
    FLUENT_RESULT_GRID_DEFAULT_IN_MEMORY_DATA_PROCESSING_THRESHOLD,
    FLUENT_RESULT_GRID_SCROLL_POSITION_DEBOUNCE_MS,
} from "./fluentResultGridConstants";
import {
    areAllFluentResultGridColumnsShown,
    createFluentResultGridColumns,
    isFluentResultGridDataColumn,
} from "./fluentResultGridColumns";
import type { FluentResultGridDataRow } from "./fluentResultGridDataView";
import { useFluentResultGridDataController } from "./fluentResultGridDataController";
import {
    updateFluentResultGridHeaderButtonStates,
    useFluentResultGridHeaderController,
} from "./fluentResultGridHeaderController";
import {
    FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX,
    createFluentResultGridIdentitySignature,
    getFluentResultGridRowHeight,
    getFluentResultGridStateForEmit,
    normalizeFluentResultGridFrozenColumnIndex,
    normalizeFluentResultGridRowPadding,
    restoreFluentResultGridColumnWidths,
    restoreFluentResultGridVerticalScrollPosition,
    stabilizeFluentResultGridColumnInfo,
    type FluentResultGridColumnInfoSnapshot,
} from "./fluentResultGridState";
import {
    restoreFluentResultGridHorizontalScrollPosition,
    useFluentResultGridLayout,
} from "./fluentResultGridLayout";
import { useFluentResultGridCommandController } from "./fluentResultGridCommandController";
import { useFluentResultGridKeyboardController } from "./fluentResultGridKeyboardController";
import { useFluentResultGridSlickLifecycle } from "./fluentResultGridSlickLifecycle";
import {
    activateFluentResultGridCellWithoutChangingSelection,
    getFirstVisibleCellInFluentResultGridRange,
    getDisplayedFluentResultGridSelectionForCopy,
    getFluentResultGridSlickRangesFromDataSelections,
    clearFluentResultGridSelection,
} from "./fluentResultGridSelection";
import { getFluentResultGridColumnResizeDoubleClickTarget } from "./fluentResultGridColumnAutosize";
import { hasActiveFluentResultGridFilters } from "./fluentResultGridTransforms";

const emptyDataset: FluentResultGridDataRow[] = [];
const clearAllFiltersCommand = "fluent-result-grid-clear-all-filters";
const clearSortCommand = "fluent-result-grid-clear-sort";
const showAllColumnsCommand = "fluent-result-grid-show-all-columns";

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
    initialStateReady = true,
    onCommand,
    onStateChange,
    onSelectionChange,
    onSelectionSummaryChange,
    onInMemoryDataProcessingThresholdExceeded,
}: FluentResultGridControllerOptions): FluentResultGridControllerResult {
    const { strings, theme, keyBindings, openOverlay, closeOverlay } =
        useFluentResultGridProvider();
    const reactGridRef = useRef<ReactGridInstanceWithSharedService | undefined>(undefined);
    const restoredStateRef = useRef(false);
    const isRestoringInitialStateRef = useRef(false);
    const [frozenColumnIndex, setFrozenColumnIndex] = useState(
        () => initialState?.frozenColumnIndex ?? FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX,
    );

    const rowPadding = normalizeFluentResultGridRowPadding(gridSettings?.rowPadding);
    const rowHeight = getFluentResultGridRowHeight(rowHeightOverride, rowPadding);
    const stableColumnInfoRef = useRef<FluentResultGridColumnInfoSnapshot | undefined>(undefined);
    stableColumnInfoRef.current = stabilizeFluentResultGridColumnInfo(
        stableColumnInfoRef.current,
        resultSetSummary.columnInfo,
    );
    const columnSignature = stableColumnInfoRef.current.signature;
    const stableColumnInfo = stableColumnInfoRef.current.value;
    const resultIdentitySignature = useMemo(
        () =>
            createFluentResultGridIdentitySignature({
                gridId,
                resultSetSummary,
                columnSignature,
            }),
        [columnSignature, gridId, resultSetSummary],
    );
    const initialStateRestoreSignature = useMemo(
        () => (initialStateReady ? JSON.stringify(initialState ?? {}) : undefined),
        [initialState, initialStateReady],
    );

    useEffect(() => {
        setFrozenColumnIndex(
            initialState?.frozenColumnIndex ?? FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX,
        );
    }, [initialState?.frozenColumnIndex, resultIdentitySignature]);

    const dataController = useFluentResultGridDataController({
        dataSource,
        resultSetSummary,
        resultIdentitySignature,
        initialState,
        inMemoryDataProcessingThreshold,
        onInMemoryDataProcessingThresholdExceeded,
        restoreHorizontalScrollPosition: restoreFluentResultGridHorizontalScrollPosition,
    });

    const layoutController = useFluentResultGridLayout({
        autoSizeColumnsMode,
        containerRef,
        dataView: dataController.dataView,
        dataViewRef: dataController.dataViewRef,
        latestRowCountRef: dataController.latestRowCountRef,
        reactGridRef,
    });

    const columns = useMemo<Column<FluentResultGridDataRow>[]>(
        () =>
            createFluentResultGridColumns({
                columnInfo: stableColumnInfo,
                showRowNumberColumn,
            }),
        [showRowNumberColumn, stableColumnInfo],
    );

    const emitStateChange = useCallback(
        (grid: SlickGrid, allColumns?: Column<FluentResultGridDataRow>[]) => {
            if (!restoredStateRef.current) {
                return;
            }

            onStateChange?.(
                getFluentResultGridStateForEmit({
                    grid,
                    allColumns,
                    columnCount: resultSetSummary.columnInfo.length,
                    frozenColumnIndex,
                    initialState,
                    filters: dataController.filterStateRef.current,
                    sort: dataController.sortStateRef.current,
                }),
            );
        },
        [
            dataController.filterStateRef,
            dataController.sortStateRef,
            frozenColumnIndex,
            initialState,
            onStateChange,
            resultSetSummary.columnInfo.length,
        ],
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

    const updateHeaderButtonStates = useCallback(
        (grid: SlickGrid) => {
            updateFluentResultGridHeaderButtonStates({
                grid,
                filters: dataController.filterStateRef.current,
                sort: dataController.sortStateRef.current,
            });
        },
        [dataController.filterStateRef, dataController.sortStateRef],
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

    const commandController = useFluentResultGridCommandController({
        applyFrozenColumnIndex: layoutController.applyFrozenColumnIndex,
        applyGridTransforms: dataController.applyGridTransforms,
        closeOverlay,
        commandContext,
        commands,
        emitStateChange,
        ensureAllRowsLoaded: dataController.ensureAllRowsLoaded,
        filterStateRef: dataController.filterStateRef,
        gridId,
        onCommand,
        openOverlay,
        reactGridRef,
        resultIdentitySignature,
        resultSetSummary,
        setFrozenColumnIndex,
        showRowNumberColumn,
        sortStateRef: dataController.sortStateRef,
        strings,
        transformedRowsRef: dataController.transformedRowsRef,
        updateHeaderButtonStates,
    });

    const headerController = useFluentResultGridHeaderController({
        closeOverlay,
        commands,
        commandContext,
        filterStateRef: dataController.filterStateRef,
        frozenColumnIndex,
        getActiveDataColumn: commandController.getActiveDataColumn,
        gridId,
        handleCommand: commandController.handleCommand,
        openFilterMenuForColumn: commandController.openFilterMenuForColumn,
        openOverlay,
        resultSetSummary,
        selectRangesAndActivate: commandController.selectRangesAndActivate,
        sortStateRef: dataController.sortStateRef,
        strings,
        toggleSortForColumn: commandController.toggleSortForColumn,
    });

    const keyboardController = useFluentResultGridKeyboardController({
        commandContext,
        containerRef,
        handleCommand: commandController.handleCommand,
        keyBindings,
        openHeaderContextMenuForActiveColumn: headerController.openHeaderContextMenuForActiveColumn,
        reactGridRef,
    });

    const clearSelection = useCallback(() => {
        const grid = reactGridRef.current?.slickGrid;
        if (grid) {
            clearFluentResultGridSelection(grid);
        }
    }, []);

    const restoredInitialStateSignatureRef = useRef<string | undefined>(undefined);
    const restoreInitialState = useCallback(
        async (grid: SlickGrid) => {
            restoredStateRef.current = false;
            try {
                const shouldAutoSizeColumns = !initialState?.columnWidths?.length;
                if (
                    initialState?.columnWidths?.length ||
                    typeof initialState?.rowNumberColumnWidth === "number"
                ) {
                    if (initialState.columnWidths?.length) {
                        layoutController.cancelAutoSizeColumns();
                    }
                    const restoredColumns = restoreFluentResultGridColumnWidths(
                        grid.getColumns() as Column<FluentResultGridDataRow>[],
                        initialState,
                    );
                    grid.setColumns(restoredColumns);
                }

                dataController.filterStateRef.current = initialState?.filters ?? {};
                dataController.sortStateRef.current = initialState?.sort;
                if (dataController.hasActiveTransforms()) {
                    await dataController.applyGridTransforms(grid);
                } else {
                    dataController.transformedRowsRef.current = undefined;
                    dataController.dataView.setLength(
                        dataController.latestRowCountRef.current,
                        false,
                    );
                    dataController.setDisplayedRowCount(dataController.latestRowCountRef.current);
                    dataController.dataView.ensureViewportLoaded();
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

                const restoredFrozenColumnIndex = normalizeFluentResultGridFrozenColumnIndex(
                    initialState?.frozenColumnIndex,
                    restoredColumns.length,
                );
                setFrozenColumnIndex(restoredFrozenColumnIndex);
                layoutController.applyFrozenColumnIndex(grid, restoredFrozenColumnIndex);

                if (Array.isArray(initialState?.selection)) {
                    const ranges = getFluentResultGridSlickRangesFromDataSelections(
                        initialState.selection,
                        grid.getDataLength(),
                        restoredColumns,
                    );
                    grid.getSelectionModel()?.setSelectedRanges(ranges);

                    const activeCell = ranges[0]
                        ? getFirstVisibleCellInFluentResultGridRange(grid, ranges[0])
                        : undefined;
                    if (activeCell) {
                        activateFluentResultGridCellWithoutChangingSelection(grid, activeCell);
                    }
                }

                if (initialState?.scrollPosition) {
                    requestAnimationFrame(() => {
                        if (initialState.scrollPosition) {
                            restoreFluentResultGridVerticalScrollPosition(
                                grid,
                                initialState.scrollPosition,
                            );
                            layoutController.restoreHorizontalScrollPosition(
                                grid,
                                initialState.scrollPosition.scrollLeft,
                            );
                        }
                    });
                }

                updateHeaderButtonStates(grid);
                grid.invalidate();
                if (shouldAutoSizeColumns) {
                    layoutController.scheduleAutoSizeColumns();
                }
            } finally {
                restoredStateRef.current = true;
            }
        },
        [dataController, initialState, layoutController, updateHeaderButtonStates],
    );

    const restoreCurrentInitialState = useCallback(
        (grid: SlickGrid) => {
            if (!initialStateReady || initialStateRestoreSignature === undefined) {
                return;
            }

            restoredInitialStateSignatureRef.current = initialStateRestoreSignature;
            isRestoringInitialStateRef.current = true;
            void restoreInitialState(grid).finally(() => {
                isRestoringInitialStateRef.current = false;
            });
        },
        [initialStateReady, initialStateRestoreSignature, restoreInitialState],
    );

    useEffect(() => {
        const grid = reactGridRef.current?.slickGrid;
        if (
            !initialStateReady ||
            !grid ||
            initialStateRestoreSignature === undefined ||
            restoredInitialStateSignatureRef.current === initialStateRestoreSignature
        ) {
            return;
        }

        restoreCurrentInitialState(grid);
    }, [initialStateReady, initialStateRestoreSignature, restoreCurrentInitialState]);

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
            // Resolved in handleColumnsResizeDblClick instead: the library's
            // resize-by-content measures dataView.getItems(), which is empty for this
            // grid's windowed row store and would collapse the column.
            enableColumnResizeOnDoubleClick: false,
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
                            hasActiveFluentResultGridFilters(dataController.filterStateRef.current),
                        positionOrder: 10,
                        title: strings.commands[FluentResultGridCommand.ClearAllFilters]?.label,
                        action: (_event: Event, args: GridMenuCommandItemCallbackArgs) => {
                            void commandController.clearAllFilters(args.grid);
                        },
                    },
                    {
                        command: clearSortCommand,
                        iconCssClass: "fi fi-arrow-sort",
                        itemVisibilityOverride: () => dataController.hasActiveSort(),
                        positionOrder: 11,
                        title: strings.commands[FluentResultGridCommand.ClearSort]?.label,
                        action: (_event: Event, args: GridMenuCommandItemCallbackArgs) => {
                            void commandController.clearSort(args.grid);
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
                            commandController.showAllColumns(
                                args.grid,
                                args.allColumns as Column<FluentResultGridDataRow>[],
                            );
                        },
                    },
                    {
                        command: FluentResultGridCommand.UnfreezeColumn,
                        iconCssClass: "fi fi-pin-off",
                        itemVisibilityOverride: (args: GridMenuCallbackArgs) =>
                            (args.grid.getOptions().frozenColumn ??
                                FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX) >
                            FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX,
                        positionOrder: 13,
                        title: strings.commands[FluentResultGridCommand.UnfreezeColumn]?.label,
                        action: (_event: Event, args: GridMenuCommandItemCallbackArgs) => {
                            setFrozenColumnIndex(FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX);
                            layoutController.applyFrozenColumnIndex(
                                args.grid,
                                FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX,
                            );
                            emitStateChange(args.grid);
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
            // Cell values are rendered in child elements. SlickGrid's default only starts a drag
            // when the event target is the cell itself, making selection depend on whether the
            // pointer starts over text or padding.
            allowDragFromClosest: "div.slick-cell",
            // Ctrl/Cmd is used to append a dragged block. SlickGrid's option merge retains its
            // default blocked keys here, so the initialized array is cleared in the lifecycle.
            preventDragFromKeys: [],
            skipFreezeColumnValidation: true,
        }),
        [
            commandController,
            dataController.filterStateRef,
            dataController.hasActiveSort,
            emitStateChange,
            frozenColumnIndex,
            gridId,
            layoutController,
            rowHeight,
            strings.commands,
            theme?.kind,
        ],
    );

    const lifecycleController = useFluentResultGridSlickLifecycle({
        attachFrozenPaneWheelHandler: layoutController.attachFrozenPaneWheelHandler,
        dataView: dataController.dataView,
        dataViewRef: dataController.dataViewRef,
        detachFrozenPaneWheelHandler: layoutController.detachFrozenPaneWheelHandler,
        emitStateChange,
        handleKeyDown: keyboardController.handleKeyDown,
        onSelectionChange,
        onSelectionSummaryChange,
        persistScrollPosition,
        reactGridRef,
        restoreCurrentInitialState,
        shouldSuppressSelectionSummaryChange: () => isRestoringInitialStateRef.current,
        transformedRowsRef: dataController.transformedRowsRef,
    });

    const handleColumnsResizeDblClick = useCallback(
        (event: CustomEvent) => {
            const target = getFluentResultGridColumnResizeDoubleClickTarget(event.detail);
            if (!target) {
                return;
            }

            void layoutController.autoSizeColumnByContent(target.grid, target.columnId);
        },
        [layoutController],
    );

    return {
        columns,
        commandContext,
        dataView: dataController.dataView,
        dataViewKey: dataController.dataViewKey,
        displayedRowCount: dataController.displayedRowCount,
        clearSelection,
        focusGrid: keyboardController.focusGrid,
        gridOptions,
        handleBeforeHeaderCellDestroy: headerController.handleBeforeHeaderCellDestroy,
        handleClick: commandController.handleClick,
        handleDblClick: commandController.handleDblClick,
        handleColumnsResizeDblClick,
        handleCommand: commandController.handleCommand,
        handleContextMenu: commandController.handleContextMenu,
        handleGridContainerBlur: keyboardController.handleGridContainerBlur,
        handleGridContainerFocus: keyboardController.handleGridContainerFocus,
        handleGridKeyDownCapture: keyboardController.handleGridKeyDownCapture,
        handleHeaderCellRendered: headerController.handleHeaderCellRendered,
        handleHeaderClick: headerController.handleHeaderClick,
        handleHeaderContextMenu: headerController.handleHeaderContextMenu,
        handleReactGridCreated: lifecycleController.handleReactGridCreated,
        isGridFocused: keyboardController.isGridFocused,
        toolbar,
        commands,
        emptyDataset,
    };
}
