/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { FluentSlickGrid } from "../FluentSlickGrid/FluentSlickGrid";
import { FluentResultGridToolbar } from "./FluentResultGridToolbar";
import { useFluentResultGridProvider } from "./FluentResultGridProvider";
import { useFluentResultGridController } from "./internal/useFluentResultGridController";
import type { FluentResultGridHandle, FluentResultGridProps } from "./types/fluentResultGridProps";
import type { FluentResultGridHeightMode } from "./types/fluentResultGridState";
import "./FluentResultGrid.css";

function getHeightModeStyle(heightMode: FluentResultGridHeightMode | undefined) {
    if (!heightMode || heightMode.kind === "fill") {
        return {
            height: "100%",
        };
    }

    return {
        minHeight: heightMode.minHeight,
        maxHeight: heightMode.maxHeight,
    };
}

/**
 * Reusable SQL result grid. It must be rendered inside FluentResultGridProvider so strings,
 * keybindings, theme metadata, and provider-owned overlays can be coordinated across grids.
 */
export const FluentResultGrid = forwardRef<FluentResultGridHandle, FluentResultGridProps>(
    (props, ref) => {
        const { strings, theme } = useFluentResultGridProvider();
        const containerRef = useRef<HTMLDivElement>(null);
        const controller = useFluentResultGridController({
            ...props,
            containerRef,
        });

        useImperativeHandle(
            ref,
            () => ({
                focusGrid: controller.focusGrid,
                selectAll: controller.selectAll,
                scrollToRow: controller.scrollToRow,
                scrollToColumn: controller.scrollToColumn,
            }),
            [
                controller.focusGrid,
                controller.scrollToColumn,
                controller.scrollToRow,
                controller.selectAll,
            ],
        );

        const containerStyle = useMemo(
            () => ({
                ...getHeightModeStyle(props.heightMode),
                ...theme?.style,
                ...props.style,
                "--results-row-padding": `${props.gridSettings?.rowPadding ?? 0}px`,
            }),
            [props.gridSettings?.rowPadding, props.heightMode, props.style, theme?.style],
        );

        const classNames = [
            "fluent-result-grid",
            controller.isGridFocused ? "focused" : "",
            props.gridSettings?.alternatingRowColors ? "results-grid--alternating" : "",
            theme?.className,
            props.className,
        ]
            .filter(Boolean)
            .join(" ");
        const label =
            props.ariaLabel ??
            strings.accessibility.gridAriaLabel(
                props.resultSetSummary.batchId,
                props.resultSetSummary.id,
            );

        if (controller.columns.length === 0) {
            return null;
        }

        return (
            <div
                id={`fluent-result-grid-container-${props.gridId}`}
                ref={containerRef}
                className={classNames}
                style={containerStyle}
                tabIndex={0}
                role="region"
                aria-label={label}
                data-fluent-result-grid="true"
                data-grid-id={props.gridId}
                data-row-count={controller.displayedRowCount}
                onFocus={controller.handleGridContainerFocus}
                onBlur={controller.handleGridContainerBlur}
                onPointerDownCapture={controller.handleGridPointerDownCapture}
                // Chromium dispatches NO pointer events for native scrollbar
                // interactions — only mouse events — so a scrollbar grab must
                // arm the pointer-initiated-focus guard through mousedown or
                // the focus it triggers re-activates the grid and yanks both
                // scroll axes back to the active cell.
                onMouseDownCapture={controller.handleGridPointerDownCapture}
                onKeyDownCapture={controller.handleGridKeyDownCapture}>
                <div
                    id={`fluent-result-grid-body-${props.gridId}`}
                    className="fluent-result-grid-body"
                    data-fluent-result-grid-body="true">
                    <FluentSlickGrid
                        key={controller.dataViewKey}
                        gridId={`fluent-result-grid-${props.gridId}`}
                        columns={controller.columns}
                        options={controller.gridOptions}
                        dataset={controller.emptyDataset}
                        customDataView={controller.dataView as any}
                        onReactGridCreated={controller.handleReactGridCreated}
                        onClick={controller.handleClick}
                        onContextMenu={controller.handleContextMenu}
                        onHeaderCellRendered={controller.handleHeaderCellRendered}
                        onBeforeHeaderCellDestroy={controller.handleBeforeHeaderCellDestroy}
                        onHeaderClick={controller.handleHeaderClick}
                        onHeaderContextMenu={controller.handleHeaderContextMenu}
                    />
                    {controller.displayedRowCount <= 0 && (
                        <div className="fluent-result-grid-empty-state" role="status">
                            {strings.filter.noResultsToDisplay}
                        </div>
                    )}
                </div>
                <FluentResultGridToolbar
                    toolbar={controller.toolbar}
                    commands={controller.commands}
                    commandContext={controller.commandContext}
                    onCommand={controller.handleCommand}
                />
            </div>
        );
    },
);

FluentResultGrid.displayName = "FluentResultGrid";
