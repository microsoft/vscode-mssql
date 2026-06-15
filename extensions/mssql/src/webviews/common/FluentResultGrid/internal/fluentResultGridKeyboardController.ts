/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    useCallback,
    useState,
    type FocusEvent as ReactFocusEvent,
    type KeyboardEvent as ReactKeyboardEvent,
    type MutableRefObject,
    type RefObject,
} from "react";
import { SlickEventData, type SlickGrid } from "slickgrid-react";
import { getPreviousFocusableElement } from "../../utils";
import type {
    FluentResultGridCommandContext,
    FluentResultGridCommandEvent,
    FluentResultGridKeyBindingMap,
} from "../types/fluentResultGridCommands";
import { FluentResultGridCommand } from "../types/fluentResultGridCommandIds";
import { FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX } from "./fluentResultGridConstants";
import type { ReactGridInstanceWithSharedService } from "./fluentResultGridControllerTypes";
import { isEditableFluentResultGridKeyboardTarget } from "./fluentResultGridDomUtils";
import { getFluentResultGridKeyboardAction } from "./fluentResultGridKeyboard";

export interface FluentResultGridKeyboardController {
    focusGrid: () => void;
    handleGridContainerBlur: (event: ReactFocusEvent<HTMLDivElement>) => void;
    handleGridContainerFocus: (event: ReactFocusEvent<HTMLDivElement>) => void;
    handleGridKeyDownCapture: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
    handleKeyDown: (eventData: SlickEventData, args: { grid: SlickGrid }) => void;
    isGridFocused: boolean;
}

export function useFluentResultGridKeyboardController({
    commandContext,
    containerRef,
    handleCommand,
    keyBindings,
    openHeaderContextMenuForActiveColumn,
    reactGridRef,
}: {
    commandContext: FluentResultGridCommandContext;
    containerRef: RefObject<HTMLDivElement | null>;
    handleCommand: (event: FluentResultGridCommandEvent) => Promise<void>;
    keyBindings: FluentResultGridKeyBindingMap;
    openHeaderContextMenuForActiveColumn: (grid: SlickGrid) => void;
    reactGridRef: MutableRefObject<ReactGridInstanceWithSharedService | undefined>;
}): FluentResultGridKeyboardController {
    const [isGridFocused, setIsGridFocused] = useState(false);

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

    const handleGridKeyDownCapture = useCallback(
        (event: ReactKeyboardEvent<HTMLDivElement>) => {
            const keyboardEvent = event.nativeEvent;
            if (isEditableFluentResultGridKeyboardTarget(keyboardEvent.target)) {
                return;
            }

            const action = getFluentResultGridKeyboardAction(keyboardEvent, keyBindings);
            if (
                !action ||
                action.kind !== "command" ||
                action.commandId !== FluentResultGridCommand.SelectAll
            ) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            keyboardEvent.stopImmediatePropagation();

            void handleCommand({
                ...commandContext,
                commandId: FluentResultGridCommand.SelectAll,
            });
        },
        [commandContext, handleCommand, keyBindings],
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

            const action = getFluentResultGridKeyboardAction(keyboardEvent, keyBindings);
            if (!action) {
                return;
            }

            if (action.kind === "command") {
                void handleCommand({
                    ...commandContext,
                    commandId: action.commandId,
                });
            } else if (action.kind === "openColumnMenu") {
                openHeaderContextMenuForActiveColumn(grid);
            } else {
                moveFocusOutsideGrid(action.forward);
            }

            completeKeyboardEvent(eventData);
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
    }, [containerRef, reactGridRef]);

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
        focusGrid,
        handleGridContainerBlur,
        handleGridContainerFocus,
        handleGridKeyDownCapture,
        handleKeyDown,
        isGridFocused,
    };
}
