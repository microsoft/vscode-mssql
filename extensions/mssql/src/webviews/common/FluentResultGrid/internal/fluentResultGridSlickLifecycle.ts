/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import {
    SlickEventData,
    SlickEventHandler,
    type SlickGrid,
    type SlickRange,
    type SlickgridReactInstance,
} from "slickgrid-react";
import type { FluentResultGridProps } from "../types/fluentResultGridProps";
import type { ReactGridInstanceWithSharedService } from "./fluentResultGridControllerTypes";
import type { FluentResultGridDataRow, FluentResultGridDataView } from "./fluentResultGridDataView";
import { makeFluentResultGridMenuButtonsUntabbable } from "./fluentResultGridDomUtils";
import { getFluentResultGridDataSelectionsFromRanges } from "./fluentResultGridSelection";

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
    onSelectionSummaryChange,
    persistScrollPosition,
    reactGridRef,
    restoreCurrentInitialState,
}: {
    attachFrozenPaneWheelHandler: (grid: SlickGrid) => void;
    dataView: FluentResultGridDataView<FluentResultGridDataRow>;
    dataViewRef: MutableRefObject<FluentResultGridDataView<FluentResultGridDataRow> | undefined>;
    detachFrozenPaneWheelHandler: () => void;
    emitStateChange: (grid: SlickGrid) => void;
    handleKeyDown: (eventData: SlickEventData, args: { grid: SlickGrid }) => void;
    onSelectionSummaryChange?: FluentResultGridProps["onSelectionSummaryChange"];
    persistScrollPosition: (grid: SlickGrid) => void;
    reactGridRef: MutableRefObject<ReactGridInstanceWithSharedService | undefined>;
    restoreCurrentInitialState: (grid: SlickGrid) => void;
}): FluentResultGridSlickLifecycleController {
    const selectionEventHandlerRef = useRef<SlickEventHandler | undefined>(undefined);
    const gridStateEventHandlerRef = useRef<SlickEventHandler | undefined>(undefined);
    const keyboardEventHandlerRef = useRef<SlickEventHandler | undefined>(undefined);
    const gridMenuObserverRef = useRef<MutationObserver | undefined>(undefined);
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
                    (_event, ranges: SlickRange[]) => {
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
            onSelectionSummaryChange,
            persistScrollPosition,
            reactGridRef,
            restoreCurrentInitialState,
        ],
    );

    return { handleReactGridCreated };
}
