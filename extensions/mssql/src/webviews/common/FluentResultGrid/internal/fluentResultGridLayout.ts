/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import type { SlickGrid } from "@slickgrid-universal/common";
import { ResultsGridAutoSizeStyle } from "../../../../sharedInterfaces/queryResult";
import {
    FLUENT_RESULT_GRID_AUTO_SIZE_CELL_PADDING_WIDTH,
    FLUENT_RESULT_GRID_AUTO_SIZE_HEADER_EXTRA_WIDTH,
    FLUENT_RESULT_GRID_AUTO_SIZE_SAMPLE_ROWS,
    FLUENT_RESULT_GRID_DEFAULT_FONT_SIZE,
    FLUENT_RESULT_GRID_MAX_COLUMN_WIDTH,
    FLUENT_RESULT_GRID_MIN_COLUMN_WIDTH,
    FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID,
} from "./fluentResultGridConstants";
import type { ReactGridInstanceWithSharedService } from "./fluentResultGridControllerTypes";
import type { FluentResultGridDataView, FluentResultGridDataRow } from "./fluentResultGridDataView";
import { getFluentResultGridAutoSizeCellText } from "./fluentResultGridFormatters";

const initialAutoSizeRetryDelaysMs = [50, 100, 250, 500, 1000];

export interface FluentResultGridLayoutController {
    applyFrozenColumnIndex: (grid: SlickGrid, columnIndex: number) => void;
    attachFrozenPaneWheelHandler: (grid: SlickGrid) => void;
    cancelAutoSizeColumns: () => void;
    detachFrozenPaneWheelHandler: () => void;
    refreshFrozenColumnLayout: (grid: SlickGrid) => void;
    restoreHorizontalScrollPosition: (grid: SlickGrid, scrollLeft: number) => void;
    scheduleAutoSizeColumns: (attempt?: number) => void;
}

export function restoreFluentResultGridHorizontalScrollPosition(
    grid: SlickGrid,
    scrollLeft: number,
): void {
    const containerNode = grid.getContainerNode();
    const horizontalViewport =
        containerNode.querySelector<HTMLElement>(".slick-viewport-top.slick-viewport-right") ??
        containerNode.querySelector<HTMLElement>(".slick-viewport");
    if (horizontalViewport) {
        horizontalViewport.scrollLeft = scrollLeft;
    }
}

export function useFluentResultGridLayout({
    autoSizeColumnsMode,
    containerRef,
    dataView,
    dataViewRef,
    latestRowCountRef,
    reactGridRef,
}: {
    autoSizeColumnsMode: ResultsGridAutoSizeStyle;
    containerRef: RefObject<HTMLDivElement | null>;
    dataView: FluentResultGridDataView<FluentResultGridDataRow>;
    dataViewRef: MutableRefObject<FluentResultGridDataView<FluentResultGridDataRow> | undefined>;
    latestRowCountRef: MutableRefObject<number>;
    reactGridRef: MutableRefObject<ReactGridInstanceWithSharedService | undefined>;
}): FluentResultGridLayoutController {
    const frozenPaneWheelCleanupRef = useRef<(() => void) | undefined>(undefined);
    const autoSizeRequestIdRef = useRef(0);

    const refreshFrozenColumnLayout = useCallback(
        (grid: SlickGrid) => {
            grid.resizeCanvas();
            grid.invalidateAllRows();
            grid.updateRowCount();
            grid.render();
            dataViewRef.current?.ensureViewportLoaded();
        },
        [dataViewRef],
    );

    const syncFrozenColumnState = useCallback(
        (grid: SlickGrid, columnIndex: number) => {
            const reactGrid = reactGridRef.current;
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
        },
        [reactGridRef],
    );

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

    const detachFrozenPaneWheelHandler = useCallback(() => {
        frozenPaneWheelCleanupRef.current?.();
        frozenPaneWheelCleanupRef.current = undefined;
    }, []);

    const attachFrozenPaneWheelHandler = useCallback(
        (grid: SlickGrid) => {
            detachFrozenPaneWheelHandler();

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
        },
        [dataViewRef, detachFrozenPaneWheelHandler],
    );

    useEffect(() => detachFrozenPaneWheelHandler, [detachFrozenPaneWheelHandler]);

    const restoreHorizontalScrollPosition = useCallback(
        restoreFluentResultGridHorizontalScrollPosition,
        [],
    );

    const applyAutoSizeColumns = useCallback(
        async (requestId?: number, options?: { useLoadedRowsOnly?: boolean }): Promise<boolean> => {
            const grid = reactGridRef.current?.slickGrid;
            if (!grid || autoSizeColumnsMode === ResultsGridAutoSizeStyle.Off) {
                return true;
            }

            const includeHeaders =
                autoSizeColumnsMode === ResultsGridAutoSizeStyle.HeadersAndData ||
                autoSizeColumnsMode === ResultsGridAutoSizeStyle.HeaderOnly;
            const includeData =
                autoSizeColumnsMode === ResultsGridAutoSizeStyle.HeadersAndData ||
                autoSizeColumnsMode === ResultsGridAutoSizeStyle.DataOnly;
            if (!includeHeaders && !includeData) {
                return true;
            }

            const currentRowCount = latestRowCountRef.current;
            let sampleRows: FluentResultGridDataRow[] = [];
            if (includeData && currentRowCount > 0) {
                const sampleRowCount = Math.min(
                    FLUENT_RESULT_GRID_AUTO_SIZE_SAMPLE_ROWS,
                    currentRowCount,
                );
                sampleRows = options?.useLoadedRowsOnly
                    ? dataView.getLoadedRange(0, sampleRowCount)
                    : await dataView.getRangeAsync(0, sampleRowCount);

                if (options?.useLoadedRowsOnly && sampleRows.length === 0) {
                    return false;
                }
            }

            if (requestId !== undefined && autoSizeRequestIdRef.current !== requestId) {
                return true;
            }

            const canvasContext = document.createElement("canvas").getContext("2d");
            if (!canvasContext) {
                return true;
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
                              ? row[columnDataIndex.toString()]
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
                return true;
            }

            grid.setColumns(resizedColumns);
            grid.invalidate();
            grid.render();
            return true;
        },
        [autoSizeColumnsMode, containerRef, dataView, latestRowCountRef, reactGridRef],
    );

    const scheduleAutoSizeColumns = useCallback(
        (attempt = 0) => {
            const requestId = ++autoSizeRequestIdRef.current;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    window.setTimeout(() => {
                        if (autoSizeRequestIdRef.current !== requestId) {
                            return;
                        }

                        const useLoadedRowsOnly = attempt < initialAutoSizeRetryDelaysMs.length;
                        void applyAutoSizeColumns(requestId, { useLoadedRowsOnly }).then(
                            (applied) => {
                                if (
                                    applied ||
                                    autoSizeRequestIdRef.current !== requestId ||
                                    attempt >= initialAutoSizeRetryDelaysMs.length
                                ) {
                                    return;
                                }

                                window.setTimeout(() => {
                                    if (autoSizeRequestIdRef.current === requestId) {
                                        scheduleAutoSizeColumns(attempt + 1);
                                    }
                                }, initialAutoSizeRetryDelaysMs[attempt]);
                            },
                        );
                    }, 0);
                });
            });
        },
        [applyAutoSizeColumns],
    );

    const cancelAutoSizeColumns = useCallback(() => {
        autoSizeRequestIdRef.current++;
    }, []);

    return {
        applyFrozenColumnIndex,
        attachFrozenPaneWheelHandler,
        cancelAutoSizeColumns,
        detachFrozenPaneWheelHandler,
        refreshFrozenColumnLayout,
        restoreHorizontalScrollPosition,
        scheduleAutoSizeColumns,
    };
}
