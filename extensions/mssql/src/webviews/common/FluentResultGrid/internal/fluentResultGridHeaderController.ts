/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, type MutableRefObject } from "react";
import { SlickRange } from "@slickgrid-universal/common";
import type { Column, SlickGrid } from "slickgrid-react";
import type {
    ColumnFilterMap,
    ResultSetSummary,
    SortProperties,
} from "../../../../sharedInterfaces/queryResult";
import {
    FluentResultGridCommandPlacement,
    type FluentResultGridCommandConfiguration,
    type FluentResultGridCommandContext,
    type FluentResultGridCommandEvent,
} from "../types/fluentResultGridCommands";
import { FluentResultGridCommand } from "../types/fluentResultGridCommandIds";
import type { FluentResultGridStrings } from "../types/fluentResultGridStrings";
import type { FluentResultGridProviderContextValue } from "./fluentResultGridProviderTypes";
import {
    FLUENT_RESULT_GRID_FIRST_DATA_CELL_INDEX,
    FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID,
} from "./fluentResultGridConstants";
import type { FluentResultGridActiveDataColumn } from "./fluentResultGridControllerTypes";
import type { FluentResultGridDataRow } from "./fluentResultGridDataView";

export function updateFluentResultGridHeaderButtonStates({
    grid,
    filters,
    sort,
}: {
    grid: SlickGrid;
    filters: ColumnFilterMap;
    sort: { columnId: string; direction: SortProperties } | undefined;
}): void {
    for (const column of grid.getColumns()) {
        const columnId = column.id?.toString();
        if (!columnId || columnId === FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID) {
            continue;
        }

        const headerNode = grid.getHeaderColumn(grid.getColumnIndex(column.id));
        if (headerNode) {
            updateFluentResultGridHeaderButtonState({
                headerNode,
                columnId,
                filters,
                sort,
            });
        }
    }
}

/** Update one rendered header without scanning every grid column. */
export function updateFluentResultGridHeaderButtonState({
    headerNode,
    columnId,
    filters,
    sort,
}: {
    headerNode: HTMLElement;
    columnId: string;
    filters: ColumnFilterMap;
    sort: { columnId: string; direction: SortProperties } | undefined;
}): void {
    const filterButton = headerNode.querySelector<HTMLButtonElement>(".slick-header-filterbutton");
    const sortButton = headerNode.querySelector<HTMLButtonElement>(".slick-header-sortbutton");
    filterButton?.classList.toggle("filtered", (filters[columnId]?.filterValues?.length ?? 0) > 0);

    sortButton?.classList.remove("sorted-asc", "sorted-desc");
    if (sort?.columnId === columnId) {
        if (sort.direction === "ASC") {
            sortButton?.classList.add("sorted-asc");
        } else if (sort.direction === "DESC") {
            sortButton?.classList.add("sorted-desc");
        }
    }
}

export interface FluentResultGridHeaderController {
    handleBeforeHeaderCellDestroy: (event: CustomEvent) => void;
    handleHeaderCellRendered: (event: CustomEvent) => void;
    handleHeaderClick: (event: CustomEvent) => void;
    handleHeaderContextMenu: (event: CustomEvent) => void;
    openHeaderContextMenuForActiveColumn: (grid: SlickGrid) => void;
    openHeaderContextMenuForColumn: (
        grid: SlickGrid,
        column: Column<FluentResultGridDataRow>,
        x: number,
        y: number,
    ) => void;
}

export function useFluentResultGridHeaderController({
    closeOverlay,
    commands,
    commandContext,
    filterStateRef,
    frozenColumnIndex,
    getActiveDataColumn,
    gridId,
    handleCommand,
    openFilterMenuForColumn,
    openOverlay,
    resultSetSummary,
    selectRange,
    sortStateRef,
    strings,
    toggleSortForColumn,
}: {
    closeOverlay: FluentResultGridProviderContextValue["closeOverlay"];
    commands?: FluentResultGridCommandConfiguration;
    commandContext: FluentResultGridCommandContext;
    filterStateRef: MutableRefObject<ColumnFilterMap>;
    frozenColumnIndex: number;
    getActiveDataColumn: (grid: SlickGrid) => FluentResultGridActiveDataColumn | undefined;
    gridId: string;
    handleCommand: (event: FluentResultGridCommandEvent) => Promise<void>;
    openFilterMenuForColumn: (
        grid: SlickGrid,
        column: Column<FluentResultGridDataRow>,
    ) => Promise<void>;
    openOverlay: FluentResultGridProviderContextValue["openOverlay"];
    resultSetSummary: ResultSetSummary;
    selectRange: (grid: SlickGrid, range: SlickRange) => void;
    sortStateRef: MutableRefObject<{ columnId: string; direction: SortProperties } | undefined>;
    strings: FluentResultGridStrings;
    toggleSortForColumn: (
        grid: SlickGrid,
        column: Column<FluentResultGridDataRow>,
    ) => Promise<void>;
}): FluentResultGridHeaderController {
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
                updateFluentResultGridHeaderButtonState({
                    headerNode: node,
                    columnId: column.id.toString(),
                    filters: filterStateRef.current,
                    sort: sortStateRef.current,
                });
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
            updateFluentResultGridHeaderButtonState({
                headerNode: node,
                columnId: column.id.toString(),
                filters: filterStateRef.current,
                sort: sortStateRef.current,
            });
        },
        [
            filterStateRef,
            openFilterMenuForColumn,
            sortStateRef,
            strings.commands,
            toggleSortForColumn,
        ],
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

    return {
        handleBeforeHeaderCellDestroy,
        handleHeaderCellRendered,
        handleHeaderClick,
        handleHeaderContextMenu,
        openHeaderContextMenuForActiveColumn,
        openHeaderContextMenuForColumn,
    };
}
