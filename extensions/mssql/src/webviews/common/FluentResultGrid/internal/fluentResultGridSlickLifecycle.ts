/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import debounce from "lodash/debounce";
import {
    SlickEventData,
    SlickEventHandler,
    type SlickGrid,
    type SlickRange,
} from "@slickgrid-universal/common";
import type { SlickgridReactInstance } from "slickgrid-react";
import type { FluentResultGridProps } from "../types/fluentResultGridProps";
import type {
    ReactGridInstanceWithSharedService,
    SourceRow,
} from "./fluentResultGridControllerTypes";
import type { FluentResultGridDataRow, FluentResultGridDataView } from "./fluentResultGridDataView";
import { FLUENT_RESULT_GRID_SELECTION_SUMMARY_DEBOUNCE_MS } from "./fluentResultGridConstants";
import { makeFluentResultGridMenuButtonsUntabbable } from "./fluentResultGridDomUtils";
import { enableFluentResultGridModifierDrag } from "./fluentResultGridCellRangeSelector";
import {
    convertDisplayedSelectionRowsToActual,
    getFluentResultGridDataSelectionsFromRanges,
} from "./fluentResultGridSelection";
import { FluentResultGridSelectionModel } from "./fluentResultGridSelectionModel";

export interface FluentResultGridSlickLifecycleController {
    handleReactGridCreated: (event: CustomEvent<SlickgridReactInstance>) => void;
}

export function useFluentResultGridSlickLifecycle({
    attachFrozenPaneWheelHandler,
    dataView,
    dataViewRef,
    detachFrozenPaneWheelHandler,
    emitStateChange,
    handleKeyDown,
    onSelectionChange,
    onSelectionSummaryChange,
    persistScrollPosition,
    reactGridRef,
    restoreCurrentInitialState,
    shouldSuppressSelectionSummaryChange,
    transformedRowsRef,
}: {
    attachFrozenPaneWheelHandler: (grid: SlickGrid) => void;
    dataView: FluentResultGridDataView<FluentResultGridDataRow>;
    dataViewRef: MutableRefObject<FluentResultGridDataView<FluentResultGridDataRow> | undefined>;
    detachFrozenPaneWheelHandler: () => void;
    emitStateChange: (grid: SlickGrid) => void;
    handleKeyDown: (eventData: SlickEventData, args: { grid: SlickGrid }) => void;
    onSelectionChange?: FluentResultGridProps["onSelectionChange"];
    onSelectionSummaryChange?: FluentResultGridProps["onSelectionSummaryChange"];
    persistScrollPosition: (grid: SlickGrid) => void;
    reactGridRef: MutableRefObject<ReactGridInstanceWithSharedService | undefined>;
    restoreCurrentInitialState: (grid: SlickGrid) => void;
    shouldSuppressSelectionSummaryChange: () => boolean;
    transformedRowsRef: MutableRefObject<SourceRow[] | undefined>;
}): FluentResultGridSlickLifecycleController {
    const selectionEventHandlerRef = useRef<SlickEventHandler | undefined>(undefined);
    const gridStateEventHandlerRef = useRef<SlickEventHandler | undefined>(undefined);
    const keyboardEventHandlerRef = useRef<SlickEventHandler | undefined>(undefined);
    const gridMenuObserverRef = useRef<MutationObserver | undefined>(undefined);
    const onSelectionChangeRef = useRef(onSelectionChange);
    const onSelectionSummaryChangeRef = useRef(onSelectionSummaryChange);
    const shouldSuppressSelectionSummaryChangeRef = useRef(shouldSuppressSelectionSummaryChange);
    onSelectionChangeRef.current = onSelectionChange;
    onSelectionSummaryChangeRef.current = onSelectionSummaryChange;
    shouldSuppressSelectionSummaryChangeRef.current = shouldSuppressSelectionSummaryChange;
    const publishSelectionSummaryRef = useRef(
        debounce(
            (
                selection: Parameters<
                    NonNullable<FluentResultGridProps["onSelectionSummaryChange"]>
                >[0],
                displaySelection: Parameters<
                    NonNullable<FluentResultGridProps["onSelectionSummaryChange"]>
                >[1],
            ) => {
                void onSelectionSummaryChangeRef.current?.(selection, displaySelection);
            },
            FLUENT_RESULT_GRID_SELECTION_SUMMARY_DEBOUNCE_MS,
        ),
    );
    const handleKeyDownRef = useRef<
        ((eventData: SlickEventData, args: { grid: SlickGrid }) => void) | undefined
    >(undefined);
    handleKeyDownRef.current = handleKeyDown;

    useEffect(() => {
        return () => {
            selectionEventHandlerRef.current?.unsubscribeAll();
            selectionEventHandlerRef.current = undefined;
            detachFrozenPaneWheelHandler();
            gridStateEventHandlerRef.current?.unsubscribeAll();
            gridStateEventHandlerRef.current = undefined;
            keyboardEventHandlerRef.current?.unsubscribeAll();
            keyboardEventHandlerRef.current = undefined;
            publishSelectionSummaryRef.current.cancel();
            gridMenuObserverRef.current?.disconnect();
            gridMenuObserverRef.current = undefined;
        };
    }, [dataView, detachFrozenPaneWheelHandler]);

    const handleReactGridCreated = useCallback(
        (event: CustomEvent<SlickgridReactInstance>) => {
            const reactGrid = event.detail as ReactGridInstanceWithSharedService;
            const grid = reactGrid.slickGrid;
            reactGridRef.current = reactGrid;
            dataViewRef.current?.setGrid(grid);
            enableFluentResultGridModifierDrag(grid.getOptions().preventDragFromKeys);
            attachFrozenPaneWheelHandler(grid);
            grid.setSelectionModel(
                new FluentResultGridSelectionModel({
                    ...grid.getOptions().selectionOptions,
                    selectionType: "cell",
                }),
            );

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
                    (_event, ranges: SlickRange[]) => {
                        const displaySelection =
                            getFluentResultGridDataSelectionsFromRanges(ranges);
                        const transformedRows = transformedRowsRef.current;
                        const selection = transformedRows
                            ? convertDisplayedSelectionRowsToActual(
                                  displaySelection,
                                  (displayRow) => transformedRows[displayRow]?.rowId,
                              )
                            : displaySelection;
                        publishSelectionSummaryRef.current.cancel();
                        if (!shouldSuppressSelectionSummaryChangeRef.current()) {
                            onSelectionChangeRef.current?.(displaySelection);
                            publishSelectionSummaryRef.current(selection, displaySelection);
                        }
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

            const containerNode = grid.getContainerNode();
            makeFluentResultGridMenuButtonsUntabbable(containerNode);
            gridMenuObserverRef.current?.disconnect();
            const gridMenuObserver = new MutationObserver(() => {
                makeFluentResultGridMenuButtonsUntabbable(containerNode);
            });
            gridMenuObserver.observe(containerNode, { childList: true, subtree: true });
            gridMenuObserverRef.current = gridMenuObserver;

            grid.updateRowCount();
            grid.render();
            restoreCurrentInitialState(grid);
        },
        [
            attachFrozenPaneWheelHandler,
            dataViewRef,
            emitStateChange,
            persistScrollPosition,
            reactGridRef,
            restoreCurrentInitialState,
            transformedRowsRef,
        ],
    );

    return { handleReactGridCreated };
}
