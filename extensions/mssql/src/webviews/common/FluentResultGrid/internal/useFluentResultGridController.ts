/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import debounce from "lodash/debounce";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Column, GridOption } from "slickgrid-react";
import type {
    GridMenuCallbackArgs,
    GridMenuCommandItemCallbackArgs,
    SlickGrid,
} from "@slickgrid-universal/common";
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
    FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID,
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
    createFluentResultGridColumnSignature,
    createFluentResultGridIdentitySignature,
    getFluentResultGridRowHeight,
    getFluentResultGridStateForEmit,
    normalizeFluentResultGridFrozenColumnIndex,
    normalizeFluentResultGridRowPadding,
} from "./fluentResultGridState";
import {
    restoreFluentResultGridHorizontalScrollPosition,
    useFluentResultGridLayout,
} from "./fluentResultGridLayout";
import { useFluentResultGridCommandController } from "./fluentResultGridCommandController";
import { useFluentResultGridKeyboardController } from "./fluentResultGridKeyboardController";
import { useFluentResultGridSlickLifecycle } from "./fluentResultGridSlickLifecycle";
import {
    getFirstVisibleCellInFluentResultGridRange,
    getDisplayedFluentResultGridSelectionForCopy,
    getFluentResultGridSlickRangesFromDataSelections,
} from "./fluentResultGridSelection";
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
    onSelectionSummaryChange,
    onInMemoryDataProcessingThresholdExceeded,
}: FluentResultGridControllerOptions): FluentResultGridControllerResult {
    const { strings, theme, keyBindings, openOverlay, closeOverlay } =
        useFluentResultGridProvider();
    const reactGridRef = useRef<ReactGridInstanceWithSharedService | undefined>(undefined);
    const restoredStateRef = useRef(false);
    const [frozenColumnIndex, setFrozenColumnIndex] = useState(
        () => initialState?.frozenColumnIndex ?? FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX,
    );

    const rowPadding = normalizeFluentResultGridRowPadding(gridSettings?.rowPadding);
    const rowHeight = getFluentResultGridRowHeight(rowHeightOverride, rowPadding);
    const columnSignature = useMemo(
        () => createFluentResultGridColumnSignature(resultSetSummary.columnInfo),
        [resultSetSummary.columnInfo],
    );
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
                columnInfo: resultSetSummary.columnInfo,
                showRowNumberColumn,
            }),
        [columnSignature, resultSetSummary.columnInfo, showRowNumberColumn],
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
        selectRange: commandController.selectRange,
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

    const restoredInitialStateSignatureRef = useRef<string | undefined>(undefined);
    const restoreInitialState = useCallback(
        async (grid: SlickGrid) => {
            restoredStateRef.current = false;
            try {
                const shouldAutoSizeColumns = !initialState?.columnWidths?.length;
                if (initialState?.columnWidths?.length) {
                    layoutController.cancelAutoSizeColumns();
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
                            layoutController.restoreHorizontalScrollPosition(
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
            void restoreInitialState(grid);
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
        onSelectionSummaryChange,
        persistScrollPosition,
        reactGridRef,
        restoreCurrentInitialState,
    });

    return {
        columns,
        commandContext,
        dataView: dataController.dataView,
        dataViewKey: dataController.dataViewKey,
        displayedRowCount: dataController.displayedRowCount,
        focusGrid: keyboardController.focusGrid,
        gridOptions,
        handleBeforeHeaderCellDestroy: headerController.handleBeforeHeaderCellDestroy,
        handleClick: commandController.handleClick,
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
