/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Adopted and converted to typescript from https://github.com/danny-sg/slickgrid-spreadsheet-plugins/blob/master/ext.headerfilter.js
// heavily modified

import { FilterableColumn } from "../interfaces";
import { append, $ } from "../dom";
import { IDisposableDataProvider, instanceOfIDisposableDataProvider } from "../dataProvider";
import "../../../../media/table.css";
import { locConstants } from "../../../../common/locConstants";
import { resolveVscodeThemeType } from "../../../../common/utils";
import { EventManager } from "../../../../common/eventManager";
import type { FilterPopupAnchorRect, FilterPopupItem, FilterValue } from "./FilterPopup";

import {
    ColumnFilterState,
    GetFiltersRequest,
    GridColumnMap,
    SetFiltersRequest,
    ShowFilterDisabledMessageRequest,
    SortProperties,
} from "../../../../../sharedInterfaces/queryResult";
import { ColorThemeKind } from "../../../../../sharedInterfaces/webview";
import { QueryResultReactProvider } from "../../queryResultStateProvider";

export type SortDirection = "sort-asc" | "sort-desc" | "reset";

export interface CommandEventArgs<T extends Slick.SlickData> {
    grid: Slick.Grid<T>;
    column: Slick.Column<T>;
    command: SortDirection;
}

export const FilterButtonWidth = 34;

export class HeaderMenu<T extends Slick.SlickData> {
    public onFilterApplied = new Slick.Event<{
        grid: Slick.Grid<T>;
        column: FilterableColumn<T>;
    }>();
    public onCommand = new Slick.Event<CommandEventArgs<T>>();
    public enabled: boolean = true;

    private activeColumnId: string | null = null;

    private grid!: Slick.Grid<T>;
    private handler = new Slick.EventHandler();
    private columnDef!: FilterableColumn<T>;
    private columnFilterButtonMapping: Map<string, HTMLElement> = new Map<string, HTMLElement>();
    private columnSortStateMapping: Map<string, SortProperties> = new Map<string, SortProperties>();

    private _eventManager = new EventManager();
    private currentSortColumn: string = "";

    constructor(
        private uri: string,
        public theme: ColorThemeKind,
        private queryResultContext: QueryResultReactProvider,
        private gridId: string,
    ) {}

    public init(grid: Slick.Grid<T>): void {
        this.grid = grid;
        this.handler
            .subscribe(
                this.grid.onHeaderCellRendered,
                (e: Event, args: Slick.OnHeaderCellRenderedEventArgs<T>) =>
                    this.handleHeaderCellRendered(e, args),
            )
            .subscribe(
                this.grid.onBeforeHeaderCellDestroy,
                (e: Event, args: Slick.OnBeforeHeaderCellDestroyEventArgs<T>) =>
                    this.handleBeforeHeaderCellDestroy(e, args),
            )
            .subscribe(this.grid.onBeforeDestroy, () => this.destroy())
            .subscribe(this.grid.onHeaderContextMenu, (e: Event) =>
                this.headerContextMenuHandler(e),
            );
    }

    public destroy() {
        this.handler.unsubscribeAll();
        this._eventManager.clearEventListeners();
        this.queryResultContext.hideColumnFilterPopup();
        this.activeColumnId = null;
    }

    private async headerContextMenuHandler(e: Event): Promise<void> {
        // Prevent the default vscode context menu from showing on right-clicking the header
        e.preventDefault();
    }

    public async openFilterForActiveColumn(): Promise<void> {
        const activeCell = this.grid.getActiveCell();
        if (activeCell) {
            const column = this.grid.getColumns()[activeCell.cell] as FilterableColumn<T>;
            if (column && column.filterable !== false) {
                const filterButton = this.columnFilterButtonMapping.get(column.id!);
                if (filterButton) {
                    await this.showColumnMenu(filterButton);
                }
            }
        }
    }

    private handleHeaderCellRendered(_e: Event, args: Slick.OnHeaderCellRenderedEventArgs<T>) {
        const column = args.column as FilterableColumn<T>;
        if ((column as FilterableColumn<T>).filterable === false) {
            return;
        }
        if (args.node.classList.contains("slick-header-with-filter")) {
            // the the filter button has already being added to the header
            return;
        }

        // The default sorting feature is triggered by clicking on the column header, but that is conflicting with query editor grid,
        // For query editor grid when column header is clicked, the entire column will be selected.
        // If the column is not defined as sortable because of the above reason, we will add the sort indicator here.
        if (column.sortable !== true) {
            args.node.classList.add("slick-header-sortable");
            append(args.node, $("span.slick-sort-indicator"));
        }
        const theme: string = resolveVscodeThemeType(this.theme);
        args.node.classList.add("slick-header-with-filter");
        args.node.classList.add(theme);
        const $headerMenuButton = jQuery(
            `<button tabindex="0" id="anchor-btn" aria-label="${locConstants.queryResult.showMenu}" title="${locConstants.queryResult.showMenu}"></button>`,
        )
            .addClass("slick-header-menubutton")
            .data("column", column);
        if (column.filterValues?.length) {
            this.showMenuButtonImage($headerMenuButton, column.filterValues?.length > 0);
        }

        const menuButton = $headerMenuButton.get(0);
        if (menuButton) {
            this._eventManager.addEventListener(menuButton, "click", async (e: Event) => {
                e.stopPropagation();
                e.preventDefault();
                await this.showColumnMenu(menuButton);
                this.grid.onHeaderClick.notify();
            });
        }

        // Add sort indicator
        const $sortIndicator = jQuery('<span class="slick-sort-indicator-icon"></span>');
        $sortIndicator.appendTo(args.node);

        $headerMenuButton.appendTo(args.node);

        this.columnFilterButtonMapping.set(column.id!, menuButton);
        if (this.columnSortStateMapping.get(column.id!) === undefined) {
            this.columnSortStateMapping.set(column.id!, SortProperties.NONE);
        }

        // Update sort indicator if column is sorted
        if (column.sorted && column.sorted !== SortProperties.NONE) {
            this.updateSortIndicator(args.node, column.sorted);
        }
    }

    private async showColumnMenu(menuButton: HTMLElement) {
        if (!this.enabled) {
            await this.queryResultContext.extensionRpc.sendRequest(
                ShowFilterDisabledMessageRequest.type,
            );
            return;
        }
        const target = withNullAsUndefined(menuButton);
        if (target) {
            const menuButton = jQuery(target);
            this.columnDef = menuButton.data("column");
        }

        if (!this.columnDef) {
            return;
        }

        const columnId = this.columnDef.id!;
        if (this.activeColumnId === columnId) {
            this.queryResultContext.hideColumnFilterPopup();
            this.activeColumnId = null;
            return;
        }

        if (this.activeColumnId) {
            this.queryResultContext.hideColumnFilterPopup();
        }

        const filterItems = await this.buildFilterItems();
        const initialSelected = (this.columnDef.filterValues ?? []) as FilterValue[];
        const anchorRect = this.toAnchorRect(menuButton.getBoundingClientRect());
        const filterButtonElement = jQuery(menuButton);

        const applySelection = async (selected: FilterValue[]) => {
            this.columnDef.filterValues = selected as unknown as string[];
            this.showMenuButtonImage(filterButtonElement, this.columnDef.filterValues.length > 0);
            await this.handleApply(this.columnDef);
        };

        const clearSelection = async () => {
            this.columnDef.filterValues = [];
            this.showMenuButtonImage(filterButtonElement, false);
            await this.handleApply(this.columnDef, true);
        };

        this.queryResultContext.showColumnFilterPopup({
            columnId,
            anchorRect,
            items: filterItems,
            initialSelected,
            onApply: async (selected) => {
                await applySelection(selected);
            },
            onClear: async () => {
                await clearSelection();
            },
            onDismiss: () => {
                this.activeColumnId = null;
                this.setFocusToColumn(this.columnDef);
            },
            onSortAscending: async () => {
                await this.handleSortFromPopup(this.columnDef, "sort-asc");
            },
            onSortDescending: async () => {
                await this.handleSortFromPopup(this.columnDef, "sort-desc");
            },
        });

        this.activeColumnId = columnId;
        this.grid.onHeaderClick.notify();
    }

    private async handleSortFromPopup(
        column: FilterableColumn<T>,
        command: "sort-asc" | "sort-desc",
    ) {
        const columnId = column.id!;

        // Clear previous sort state
        if (this.currentSortColumn && this.currentSortColumn !== columnId) {
            const prevColumn = this.grid
                .getColumns()
                .find((col) => col.id === this.currentSortColumn) as FilterableColumn<T>;
            if (prevColumn) {
                this.columnSortStateMapping.set(this.currentSortColumn, SortProperties.NONE);
                let prevFilterState: ColumnFilterState = {
                    columnDef: prevColumn.id!,
                    filterValues: prevColumn.filterValues ?? [],
                    sorted: SortProperties.NONE,
                };
                await this.updateState(prevFilterState, prevColumn.id!);
                // Clear sort indicator on previous column
                const prevHeaderNode = this.getHeaderNode(prevColumn.id!);
                if (prevHeaderNode) {
                    this.updateSortIndicator(prevHeaderNode, SortProperties.NONE);
                }
            }
        }

        // Apply new sort
        const sortProperty = command === "sort-asc" ? SortProperties.ASC : SortProperties.DESC;
        this.columnSortStateMapping.set(columnId, sortProperty);
        this.currentSortColumn = columnId;

        await this.handleMenuItemClick(command, column);

        const columnFilterState: ColumnFilterState = {
            columnDef: column.id!,
            filterValues: column.filterValues ?? [],
            sorted: sortProperty,
        };
        await this.updateState(columnFilterState, column.id!);

        // Update sort indicator on current column
        const headerNode = this.getHeaderNode(columnId);
        if (headerNode) {
            this.updateSortIndicator(headerNode, sortProperty);
        }
    }

    private getHeaderNode(columnId: string): HTMLElement | null {
        const columns = this.grid.getColumns();
        const columnIndex = columns.findIndex((col) => col.id === columnId);
        if (columnIndex >= 0) {
            const gridContainer = this.grid.getContainerNode();
            return gridContainer?.querySelector(
                `.slick-header-columns .slick-header-column:nth-child(${columnIndex + 1})`,
            ) as HTMLElement | null;
        }
        return null;
    }

    private updateSortIndicator(headerNode: HTMLElement, sortState: SortProperties): void {
        const indicator = headerNode.querySelector(".slick-sort-indicator-icon");
        if (indicator) {
            indicator.classList.remove("sorted-asc", "sorted-desc");
            if (sortState === SortProperties.ASC) {
                indicator.classList.add("sorted-asc");
            } else if (sortState === SortProperties.DESC) {
                indicator.classList.add("sorted-desc");
            }
        }
    }

    private async buildFilterItems(): Promise<FilterPopupItem[]> {
        this.columnDef.filterValues = this.columnDef.filterValues || [];
        let filterItems: FilterValue[];
        const dataView = this.grid.getData() as IDisposableDataProvider<T>;

        if (instanceOfIDisposableDataProvider(dataView)) {
            filterItems = await dataView.getColumnValues(this.columnDef);
        } else {
            const filterApplied =
                this.grid.getColumns().findIndex((col) => {
                    const filterableColumn = col as FilterableColumn<T>;
                    return (filterableColumn.filterValues?.length ?? 0) > 0;
                }) !== -1;
            if (!filterApplied) {
                filterItems = this.getFilterValues(
                    this.grid.getData() as Slick.DataProvider<T>,
                    this.columnDef,
                );
            } else {
                filterItems = this.getAllFilterValues(
                    (this.grid.getData() as Slick.Data.DataView<T>).getFilteredItems(),
                    this.columnDef,
                );
            }
        }

        const uniqueValues = new Map<FilterValue, string>();
        for (const value of filterItems) {
            const normalized = this.normalizeFilterValue(value);
            if (typeof normalized === "string" && normalized.indexOf("Error:") >= 0) {
                continue;
            }
            if (!uniqueValues.has(normalized)) {
                uniqueValues.set(normalized, this.getDisplayText(normalized));
            }
        }

        const nullEntries: Array<[FilterValue, string]> = [];
        const blankEntries: Array<[FilterValue, string]> = [];
        const otherEntries: Array<[FilterValue, string]> = [];

        uniqueValues.forEach((displayText, value) => {
            if (value === undefined) {
                nullEntries.push([value, displayText]);
            } else if (value === "") {
                blankEntries.push([value, displayText]);
            } else {
                otherEntries.push([value, displayText]);
            }
        });

        otherEntries.sort((a, b) =>
            this.filterValueToSortString(a[0]).localeCompare(this.filterValueToSortString(b[0])),
        );

        const orderedEntries = [...nullEntries, ...blankEntries, ...otherEntries];

        return orderedEntries.map(([value, displayText], index) => ({
            value,
            displayText,
            index,
        }));
    }

    private toAnchorRect(rect: DOMRect): FilterPopupAnchorRect {
        return {
            top: rect.top,
            left: rect.left,
            bottom: rect.bottom,
            right: rect.right,
            width: rect.width,
            height: rect.height,
        };
    }

    private normalizeFilterValue(value: unknown): FilterValue {
        if (value === undefined || value === null) {
            return undefined;
        }
        return String(value);
    }

    private filterValueToSortString(value: FilterValue): string {
        if (value === undefined || value === null) {
            return "";
        }
        return String(value);
    }

    private getDisplayText(value: FilterValue): string {
        if (value === undefined || value === null) {
            return locConstants.queryResult.null;
        }
        if (value === "") {
            return locConstants.queryResult.blankString;
        }
        return String(value);
    }

    private async resetData(columnDef: Slick.Column<T>) {
        const dataView = this.grid.getData() as IDisposableDataProvider<T>;
        if (instanceOfIDisposableDataProvider(dataView)) {
            await dataView.filter(this.grid.getColumns());
            this.grid.invalidateAllRows();
            this.grid.updateRowCount();
            this.grid.render();
        }
        this.onFilterApplied.notify({ grid: this.grid, column: columnDef });
        this.setFocusToColumn(columnDef);
    }

    private async handleApply(columnDef: Slick.Column<T>, clear?: boolean) {
        let columnFilterState: ColumnFilterState;
        await this.resetData(columnDef);
        // clear filterValues if clear is true
        if (clear) {
            columnFilterState = {
                columnDef: this.columnDef.id!,
                filterValues: [],
                sorted: SortProperties.NONE,
            };
            if (this.uri) {
                // Get the current filters from the query result singleton store
                let gridColumnMapArray = await this.queryResultContext.extensionRpc.sendRequest(
                    GetFiltersRequest.type,
                    {
                        uri: this.uri,
                    },
                );
                if (!gridColumnMapArray) {
                    gridColumnMapArray = [];
                }
                // Drill down into the grid column map array and clear the filter values for the specified column
                gridColumnMapArray = this.clearFilterValues(gridColumnMapArray, columnDef.id!);
                await this.queryResultContext.extensionRpc.sendRequest(SetFiltersRequest.type, {
                    uri: this.uri,
                    filters: gridColumnMapArray,
                });
            }
        } else {
            columnFilterState = {
                columnDef: this.columnDef.id!,
                filterValues: this.columnDef.filterValues!,
                sorted: this.columnDef.sorted,
            };
        }

        await this.updateState(columnFilterState, columnDef.id!);
    }

    /**
     * Update the filter state in the query result singleton store
     * @param newState
     * @param columnId
     * @returns
     */
    private async updateState(newState: ColumnFilterState, columnId: string): Promise<void> {
        let newStateArray: GridColumnMap[];
        // Check if there is any existing filter state
        if (!this.uri) {
            this.queryResultContext.log("no uri set for query result state");
            return;
        }
        let currentFiltersArray = await this.queryResultContext.extensionRpc.sendRequest(
            GetFiltersRequest.type,
            {
                uri: this.uri,
            },
        );
        if (!currentFiltersArray) {
            currentFiltersArray = [];
        }
        newStateArray = this.combineFilters(currentFiltersArray, newState, columnId);
        await this.queryResultContext.extensionRpc.sendRequest(SetFiltersRequest.type, {
            uri: this.uri,
            filters: newStateArray,
        });
    }

    /**
     * Drill down into the grid column map array and clear the filter values for the specified column
     * @param gridFiltersArray
     * @param columnId
     * @returns
     */
    private clearFilterValues(gridFiltersArray: GridColumnMap[], columnId: string) {
        const targetGridFilters = gridFiltersArray.find((gridFilters) => gridFilters[this.gridId]);

        if (!targetGridFilters) {
            return gridFiltersArray;
        }

        for (const columnFilterMap of targetGridFilters[this.gridId]) {
            if (columnFilterMap[columnId]) {
                columnFilterMap[columnId] = columnFilterMap[columnId].map((filterState) => ({
                    ...filterState,
                    filterValues: [],
                }));
            }
        }

        return gridFiltersArray;
    }

    /**
     * Combines two GridColumnMaps into one, keeping filters separate for different gridIds and removing any duplicate filterValues within the same column id
     * @param currentFiltersArray filters array for all grids
     * @param newFilters
     * @param columnId
     * @returns
     */
    private combineFilters(
        gridFiltersArray: GridColumnMap[],
        newFilterState: ColumnFilterState,
        columnId: string,
    ): GridColumnMap[] {
        // Find the appropriate GridColumnFilterMap for the gridId
        let targetGridFilters = gridFiltersArray.find((gridFilters) => gridFilters[this.gridId]);

        if (!targetGridFilters) {
            // If no GridColumnFilterMap found for the gridId, create a new one
            targetGridFilters = { [this.gridId]: [] };
            gridFiltersArray.push(targetGridFilters);
        }

        let columnFilterMap = targetGridFilters[this.gridId].find((map) => map[columnId]);

        if (!columnFilterMap) {
            // If no existing ColumnFilterMap for this column, create a new one
            columnFilterMap = { [columnId]: [newFilterState] };
            targetGridFilters[this.gridId].push(columnFilterMap);
        } else {
            // Update the existing column filter state
            const filterStates = columnFilterMap[columnId];
            const existingIndex = filterStates.findIndex(
                (filter) => filter.columnDef === newFilterState.columnDef,
            );

            if (existingIndex !== -1) {
                // Replace existing filter state for the column
                filterStates[existingIndex] = newFilterState;
            } else {
                // Add new filter state for this column
                filterStates.push(newFilterState);
            }
        }

        return [...gridFiltersArray];
    }

    private async handleMenuItemClick(command: SortDirection, columnDef: Slick.Column<T>) {
        const dataView = this.grid.getData();
        if (command === "sort-asc" || command === "sort-desc") {
            this.grid.setSortColumn(columnDef.id as string, command === "sort-asc");
        }
        if (instanceOfIDisposableDataProvider<T>(dataView)) {
            if (command === "sort-asc" || command === "sort-desc") {
                await dataView.sort({
                    grid: this.grid,
                    multiColumnSort: false,
                    sortCol: this.columnDef,
                    sortAsc: command === "sort-asc",
                });
            } else {
                dataView.resetSort();
                this.grid.setSortColumn("", false);
            }
            this.grid.invalidateAllRows();
            this.grid.updateRowCount();
            this.grid.render();
        }

        this.onCommand.notify({
            grid: this.grid,
            column: columnDef,
            command: command,
        });

        this.setFocusToColumn(columnDef);
    }

    private getFilterValues(
        dataView: Slick.DataProvider<T>,
        column: Slick.Column<T>,
    ): FilterValue[] {
        const seen: Set<FilterValue> = new Set();
        dataView.getItems().forEach((items) => {
            const value = items[column.field!];
            const valueArr = value instanceof Array ? value : [value];
            valueArr.forEach((v) => seen.add(this.normalizeFilterValue(v)));
        });

        return Array.from(seen);
    }

    private getAllFilterValues(data: Array<T>, column: Slick.Column<T>): FilterValue[] {
        const seen: Set<FilterValue> = new Set();

        data.forEach((items) => {
            const value = items[column.field!];
            const valueArr = value instanceof Array ? value : [value];
            valueArr.forEach((v) => seen.add(this.normalizeFilterValue(v)));
        });

        return Array.from(seen).sort((a, b) =>
            this.filterValueToSortString(a).localeCompare(this.filterValueToSortString(b)),
        );
    }

    private handleBeforeHeaderCellDestroy(
        _e: Event,
        args: Slick.OnBeforeHeaderCellDestroyEventArgs<T>,
    ) {
        jQuery(args.node).find(".slick-header-menubutton").remove();
    }

    private setFocusToColumn(columnDef: Slick.Column<T>): void {
        if (this.grid.getDataLength() > 0) {
            const column = this.grid.getColumns().findIndex((col) => col.id === columnDef.id);
            if (column >= 0) {
                this.grid.setActiveCell(0, column);
            }
        }
    }

    private showMenuButtonImage($el: JQuery<HTMLElement>, filtered: boolean) {
        const element: HTMLElement | undefined = $el.get(0);
        if (element) {
            if (filtered) {
                element.className += " filtered";
            } else {
                const classList = element.classList;
                if (classList.contains("filtered")) {
                    classList.remove("filtered");
                }
            }
        }
    }
}

/**
 * Converts null to undefined, passes all other values through.
 */
export function withNullAsUndefined<T>(x: T | null): T | undefined {
    return x === null ? undefined : x;
}
