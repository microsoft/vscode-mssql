/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Adopted and converted to typescript from https://github.com/danny-sg/slickgrid-spreadsheet-plugins/blob/master/ext.headerfilter.js
// heavily modified

import { FilterableColumn } from "../interfaces";
import { IDisposableDataProvider, instanceOfIDisposableDataProvider } from "../dataProvider";
import "../../../../media/table.css";
import { locConstants } from "../../../../common/locConstants";
import { resolveVscodeThemeType } from "../../../../common/utils";
import { EventManager } from "../../../../common/eventManager";
import type { ColumnMenuPopupAnchorRect, FilterListItem, FilterValue } from "./ColumnMenuPopup";

import {
    ColumnFilterMap,
    ColumnFilterState,
    GetFiltersRequest,
    SetColumnWidthsRequest,
    SetFiltersRequest,
    ShowFilterDisabledMessageRequest,
    SortProperties,
} from "../../../../../sharedInterfaces/queryResult";
import {
    ColorThemeKind,
    WebviewAction,
    WebviewKeyBindings,
} from "../../../../../sharedInterfaces/webview";
import { QueryResultReactProvider } from "../../queryResultStateProvider";

export interface CommandEventArgs<T extends Slick.SlickData> {
    grid: Slick.Grid<T>;
    column: Slick.Column<T>;
    command: SortProperties;
}

export const FilterButtonWidth = 34;

export class HeaderMenu<T extends Slick.SlickData> {
    public onFilterApplied = new Slick.Event<{
        grid: Slick.Grid<T>;
        column: FilterableColumn<T>;
    }>();
    public onSortChanged = new Slick.Event<SortProperties>();
    public onCommand = new Slick.Event<CommandEventArgs<T>>();
    public enabled: boolean = true;

    private _activeColumnId: string | null = null;

    private _grid!: Slick.Grid<T>;
    private _handler = new Slick.EventHandler();
    private _columnDef!: FilterableColumn<T>;
    private _columnFilterButtonMapping: Map<string, HTMLElement> = new Map<string, HTMLElement>();
    private _columnSortStateMapping: Map<string, SortProperties> = new Map<
        string,
        SortProperties
    >();

    private _eventManager = new EventManager();
    private _currentSortColumn: string = "";

    constructor(
        private readonly uri: string,
        public theme: ColorThemeKind,
        private readonly queryResultContext: QueryResultReactProvider,
        private readonly gridId: string,
        public keyBindings: WebviewKeyBindings,
    ) {}

    public init(grid: Slick.Grid<T>): void {
        this._grid = grid;
        this._handler
            .subscribe(
                this._grid.onHeaderCellRendered,
                (e: Event, args: Slick.OnHeaderCellRenderedEventArgs<T>) =>
                    this.onHeaderCellRendered(e, args),
            )
            .subscribe(
                this._grid.onBeforeHeaderCellDestroy,
                (e: Event, args: Slick.OnBeforeHeaderCellDestroyEventArgs<T>) =>
                    this.onBeforeHeaderCellDestroy(e, args),
            )
            .subscribe(this._grid.onBeforeDestroy, () => this.destroy())
            .subscribe(this._grid.onHeaderContextMenu, (e, args) =>
                this.onHeaderContextMenu(e, args),
            );
    }

    public destroy() {
        this._handler.unsubscribeAll();
        this._eventManager.clearEventListeners();
        this.queryResultContext.hideColumnMenuPopup();
        this._activeColumnId = null;
    }

    private async showColumnMenuForColumn(column: FilterableColumn<T>): Promise<void> {
        if (!column || column.filterable === false) return;

        const columnId = column.id;
        if (!columnId) {
            return;
        }

        const filterButton = this._columnFilterButtonMapping.get(columnId);
        if (filterButton) {
            await this.showColumnMenu(filterButton);
        }
    }

    private async onHeaderContextMenu(
        e: Event,
        args: Slick.OnHeaderContextMenuEventArgs<T>,
    ): Promise<void> {
        // Prevent the default vscode context menu from showing on right-clicking the header
        e.preventDefault();
        e.stopPropagation();
        const column = args.column;
        if (!column) {
            return;
        }
        try {
            await this.showColumnMenuForColumn(column);
        } catch (err) {
            console.error("Error showing column menu:", err);
        }
    }

    public async openMenuForActiveColumn(): Promise<void> {
        const activeCell = this._grid.getActiveCell();
        if (!activeCell) {
            return;
        }
        const column = this._grid.getColumns()[activeCell.cell] as FilterableColumn<T>;
        await this.showColumnMenuForColumn(column);
    }

    private onHeaderCellRendered(_e: Event, args: Slick.OnHeaderCellRenderedEventArgs<T>) {
        const column = args.column as FilterableColumn<T>;
        if (column.filterable === false) {
            return;
        }

        if (args.node.classList.contains("slick-header-with-filter")) {
            // the the filter button has already being added to the header
            return;
        }

        const theme: string = resolveVscodeThemeType(this.theme);
        args.node.classList.add("slick-header-with-filter");
        args.node.classList.add(theme);

        // Add sort indicator
        jQuery('<span class="slick-sort-indicator-icon"></span>').appendTo(args.node);

        const $menuButton = jQuery(
            `
            <button id="anchor-btn"
                    aria-label="${locConstants.queryResult.showMenu(
                        this.keyBindings[WebviewAction.ResultGridOpenColumnMenu].label,
                    )}"
                    title="${locConstants.queryResult.showMenu(
                        this.keyBindings[WebviewAction.ResultGridOpenColumnMenu].label,
                    )}"  />
            `,
        )
            .addClass("slick-header-menubutton")
            .data("column", column);

        if (column.filterValues?.length) {
            this.updateMenuButtonImage($menuButton, column.filterValues?.length > 0);
        }
        const buttonEl = $menuButton.get(0);
        if (buttonEl) {
            buttonEl.tabIndex = -1; // Make button focusable but not in tab order
            this._eventManager.addEventListener(buttonEl, "click", async (e: Event) => {
                e.stopPropagation();
                e.preventDefault();
                await this.showColumnMenu(buttonEl);
                this._grid.onHeaderClick.notify();
            });
        }
        $menuButton.appendTo(args.node);

        this._columnFilterButtonMapping.set(column.id!, buttonEl);

        let existingSort = this._columnSortStateMapping.get(column.id!);
        if (existingSort === undefined) {
            existingSort = column.sorted ?? SortProperties.NONE;
            this._columnSortStateMapping.set(column.id!, existingSort);
        } else if (column.sorted && existingSort !== column.sorted) {
            existingSort = column.sorted;
            this._columnSortStateMapping.set(column.id!, existingSort);
        }
        if (existingSort && existingSort !== SortProperties.NONE) {
            this._currentSortColumn = column.id!;
            this.updateSortIndicator(args.node, existingSort);
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
            this._columnDef = menuButton.data("column");
        }

        if (!this._columnDef) {
            return;
        }

        const columnId = this._columnDef.id!;
        if (this._activeColumnId === columnId) {
            this.queryResultContext.hideColumnMenuPopup();
            this._activeColumnId = null;
            return;
        }

        if (this._activeColumnId) {
            this.queryResultContext.hideColumnMenuPopup();
        }

        const filterItems = await this.buildFilterItems();
        const initialSelected = (this._columnDef.filterValues ?? []) as FilterValue[];
        const anchorRect = this.toAnchorRect(menuButton.getBoundingClientRect());
        const filterButtonElement = jQuery(menuButton);

        const applySelection = async (selected: FilterValue[]) => {
            this._columnDef.filterValues = selected as unknown as string[];
            this.updateMenuButtonImage(
                filterButtonElement,
                this._columnDef.filterValues.length > 0,
            );
            await this.applyFilters(this._columnDef);
        };

        const clearSelection = async () => {
            this._columnDef.filterValues = [];
            this.updateMenuButtonImage(filterButtonElement, false);
            await this.applyFilters(this._columnDef, true);
        };

        // Get current sort state for this column
        const currentSort = this._columnSortStateMapping.get(columnId) ?? SortProperties.NONE;

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
                this._activeColumnId = null;
                this._grid.focus();
            },
            onSortAscending: async () => {
                await this.applySort(this._columnDef, SortProperties.ASC, true);
            },
            onSortDescending: async () => {
                await this.applySort(this._columnDef, SortProperties.DESC, true);
            },
            onClearSort: async () => {
                await this.handleClearSort(this._columnDef, true);
            },
            onResize: async () => {
                await this.queryResultContext.openResizeDialog({
                    open: true,
                    columnId: columnId,
                    columnName: this._columnDef.name ?? "",
                    initialWidth: this._columnDef.width ?? 0,
                    gridId: this.gridId,
                    onDismiss: () => {
                        this.resizeCancel();
                    },
                    onSubmit: (newWidth: number) => this.resizeColumn(columnId, newWidth),
                });
            },
            currentSort,
        });

        this._activeColumnId = columnId;
        this._grid.onHeaderClick.notify();
    }

    private async applySort(
        column: FilterableColumn<T>,
        command: SortProperties,
        skipFocusReset: boolean = false,
    ) {
        const columnId = column.id!;

        // Clear previous sort state
        if (this._currentSortColumn && this._currentSortColumn !== columnId) {
            const prevColumn = this._grid
                .getColumns()
                .find((col) => col.id === this._currentSortColumn) as FilterableColumn<T>;
            if (prevColumn) {
                this._columnSortStateMapping.set(this._currentSortColumn, SortProperties.NONE);
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

        this._columnSortStateMapping.set(columnId, command);

        // Update current sort column - clear it if command is NONE
        if (command === SortProperties.NONE) {
            this._currentSortColumn = "";
        } else {
            this._currentSortColumn = columnId;
        }

        await this.handleMenuItemClick(command, column, skipFocusReset);

        const columnFilterState: ColumnFilterState = {
            columnDef: column.id!,
            filterValues: column.filterValues ?? [],
            sorted: command,
        };
        await this.updateState(columnFilterState, column.id!);

        // Update sort indicator on current column
        const headerNode = this.getHeaderNode(columnId);
        if (headerNode) {
            this.updateSortIndicator(headerNode, command);
        }

        this.onSortChanged.notify(command);
        this._grid.focus();
    }

    private getHeaderNode(columnId: string): HTMLElement | null {
        const columns = this._grid.getColumns();
        const columnIndex = columns.findIndex((col) => col.id === columnId);
        if (columnIndex >= 0) {
            const gridContainer = this._grid.getContainerNode();
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

    private async handleClearSort(column: FilterableColumn<T>, skipFocusReset: boolean = false) {
        const columnId = column.id!;

        // Only clear if this column is currently sorted
        const currentSortState = this._columnSortStateMapping.get(columnId);
        if (currentSortState === SortProperties.NONE || currentSortState === undefined) {
            return;
        }

        // Clear current sort state
        this._columnSortStateMapping.set(columnId, SortProperties.NONE);
        this._currentSortColumn = "";

        // Clear sort in grid
        await this.handleMenuItemClick(SortProperties.NONE, column, skipFocusReset);

        // Update state
        const columnFilterState: ColumnFilterState = {
            columnDef: column.id!,
            filterValues: column.filterValues ?? [],
            sorted: SortProperties.NONE,
        };
        await this.updateState(columnFilterState, column.id!);

        // Clear sort indicator
        const headerNode = this.getHeaderNode(columnId);
        if (headerNode) {
            this.updateSortIndicator(headerNode, SortProperties.NONE);
        }
    }

    public async toggleSortForColumn(columnIndex: number): Promise<void> {
        const columns = this._grid.getColumns();
        if (columnIndex < 0 || columnIndex >= columns.length) {
            return;
        }

        const column = columns[columnIndex] as FilterableColumn<T>;
        if (!column || column.filterable === false) {
            return;
        }

        const columnId = column.id!;
        const currentSort = this._columnSortStateMapping.get(columnId) ?? SortProperties.NONE;

        // Cycle through: NONE → ASC → DESC → NONE
        let nextSort: SortProperties;
        if (currentSort === SortProperties.NONE) {
            nextSort = SortProperties.ASC;
        } else if (currentSort === SortProperties.ASC) {
            nextSort = SortProperties.DESC;
        } else {
            nextSort = SortProperties.NONE;
        }
        // Skip focus reset to keep the active cell in place
        await this.applySort(column, nextSort, true);
    }

    public updateSortStateFromExternal(columnId: string, sort: SortProperties): void {
        if (!this._grid) {
            return;
        }

        const previousSortColumn = this._currentSortColumn;
        const updatingCurrentColumn = previousSortColumn === columnId;
        const columns = this._grid.getColumns() as FilterableColumn<T>[];

        if (previousSortColumn && previousSortColumn !== columnId) {
            this._columnSortStateMapping.set(previousSortColumn, SortProperties.NONE);
            const previousHeader = this.getHeaderNode(previousSortColumn);
            if (previousHeader) {
                this.updateSortIndicator(previousHeader, SortProperties.NONE);
            }
            const previousColumn = columns.find((col) => col.id === previousSortColumn);
            if (previousColumn) {
                previousColumn.sorted = undefined;
            }
        }

        const targetColumn = columns.find((col) => col.id === columnId);
        if (targetColumn) {
            targetColumn.sorted = sort === SortProperties.NONE ? undefined : sort;
        }

        this._columnSortStateMapping.set(columnId, sort);

        if (sort === SortProperties.NONE) {
            if (updatingCurrentColumn) {
                this._currentSortColumn = "";
                this._grid.setSortColumn("", false);
            }
        } else {
            this._currentSortColumn = columnId;
            this._grid.setSortColumn(columnId, sort === SortProperties.ASC);
        }

        const headerNode = this.getHeaderNode(columnId);
        if (headerNode) {
            this.updateSortIndicator(headerNode, sort);
        }
    }

    public clearSortState(): void {
        if (!this._currentSortColumn) {
            return;
        }
        this.updateSortStateFromExternal(this._currentSortColumn, SortProperties.NONE);
    }

    private async buildFilterItems(): Promise<FilterListItem[]> {
        this._columnDef.filterValues = this._columnDef.filterValues || [];
        let filterItems: FilterValue[];
        const dataView = this._grid.getData() as IDisposableDataProvider<T>;

        if (instanceOfIDisposableDataProvider(dataView)) {
            filterItems = await dataView.getColumnValues(this._columnDef);
        } else {
            const filterApplied =
                this._grid.getColumns().findIndex((col) => {
                    const filterableColumn = col as FilterableColumn<T>;
                    return (filterableColumn.filterValues?.length ?? 0) > 0;
                }) !== -1;
            if (!filterApplied) {
                filterItems = this.getFilterValues(
                    this._grid.getData() as Slick.DataProvider<T>,
                    this._columnDef,
                );
            } else {
                filterItems = this.getAllFilterValues(
                    (this._grid.getData() as Slick.Data.DataView<T>).getFilteredItems(),
                    this._columnDef,
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

    private toAnchorRect(rect: DOMRect): ColumnMenuPopupAnchorRect {
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
        const dataView = this._grid.getData() as IDisposableDataProvider<T>;
        if (instanceOfIDisposableDataProvider(dataView)) {
            await dataView.filter(this._grid.getColumns());
            this._grid.invalidateAllRows();
            this._grid.updateRowCount();
            this._grid.render();
        }
        this.onFilterApplied.notify({ grid: this._grid, column: columnDef });
        this.setFocusToColumn(columnDef);
    }

    private async applyFilters(columnDef: Slick.Column<T>, clear?: boolean) {
        let columnFilterState: ColumnFilterState;
        await this.resetData(columnDef);
        // clear filterValues if clear is true
        if (clear) {
            columnFilterState = {
                columnDef: this._columnDef.id!,
                filterValues: [],
                sorted: SortProperties.NONE,
            };
            if (this.uri) {
                // Get the current filters from the query result singleton store
                let gridColumnMapArray = await this.queryResultContext.extensionRpc.sendRequest(
                    GetFiltersRequest.type,
                    {
                        uri: this.uri,
                        gridId: this.gridId,
                    },
                );
                if (!gridColumnMapArray) {
                    return;
                }
                // Drill down into the grid column map array and clear the filter values for the specified column
                gridColumnMapArray = this.clearFilterValues(gridColumnMapArray, columnDef.id!);
                await this.queryResultContext.extensionRpc.sendRequest(SetFiltersRequest.type, {
                    uri: this.uri,
                    gridId: this.gridId,
                    filters: gridColumnMapArray,
                });
            }
        } else {
            columnFilterState = {
                columnDef: this._columnDef.id!,
                filterValues: this._columnDef.filterValues!,
                sorted: this._columnDef.sorted,
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
        let currentFiltersArray =
            (await this.queryResultContext.extensionRpc.sendRequest(GetFiltersRequest.type, {
                uri: this.uri,
                gridId: this.gridId,
            })) ?? [];
        currentFiltersArray[columnId] = newState;
        await this.queryResultContext.extensionRpc.sendRequest(SetFiltersRequest.type, {
            uri: this.uri,
            gridId: this.gridId,
            filters: currentFiltersArray,
        });
    }

    /**
     * Drill down into the grid column map array and clear the filter values for the specified column
     * @param gridFiltersArray
     * @param columnId
     * @returns
     */
    private clearFilterValues(gridFiltersArray: ColumnFilterMap, columnId: string) {
        gridFiltersArray[columnId] = {
            ...gridFiltersArray[columnId],
            filterValues: [],
        };
        return gridFiltersArray;
    }

    private async handleMenuItemClick(
        command: SortProperties,
        columnDef: Slick.Column<T>,
        skipFocusReset: boolean = false,
    ) {
        const dataView = this._grid.getData();
        if (command === SortProperties.ASC || command === SortProperties.DESC) {
            this._grid.setSortColumn(columnDef.id as string, command === SortProperties.ASC);
        }
        if (instanceOfIDisposableDataProvider<T>(dataView)) {
            if (command === SortProperties.ASC || command === SortProperties.DESC) {
                await dataView.sort({
                    grid: this._grid,
                    multiColumnSort: false,
                    sortCol: columnDef,
                    sortAsc: command === SortProperties.ASC,
                });
            } else {
                dataView.resetSort();
                this._grid.setSortColumn("", false);
            }
            this._grid.invalidateAllRows();
            this._grid.updateRowCount();
            this._grid.render();
        }

        this.onCommand.notify({
            grid: this._grid,
            column: columnDef,
            command: command,
        });

        if (!skipFocusReset) {
            this.setFocusToColumn(columnDef);
        }
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

    private onBeforeHeaderCellDestroy(
        _e: Event,
        args: Slick.OnBeforeHeaderCellDestroyEventArgs<T>,
    ) {
        jQuery(args.node).find(".slick-header-menubutton").remove();
    }

    private setFocusToColumn(columnDef: Slick.Column<T>): void {
        if (this._grid.getDataLength() > 0) {
            const column = this._grid.getColumns().findIndex((col) => col.id === columnDef.id);
            if (column >= 0) {
                // Select the single cell and set it as active
                const cellRange = new Slick.Range(0, column, 0, column);
                const selectionModel = this._grid.getSelectionModel();
                if (selectionModel && selectionModel.setSelectedRanges) {
                    selectionModel.setSelectedRanges([cellRange]);
                }
                this._grid.setActiveCell(0, column);
            }
        }
    }

    private updateMenuButtonImage($el: JQuery<HTMLElement>, filtered: boolean) {
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

    /**
     * Cancel the resize operation and refocus the grid
     */
    public resizeCancel(): void {
        this._grid.focus();
    }

    /**
     * Resize the specified column to the new width
     * @param columnId resize column id
     * @param newWidth new width in pixels
     */
    public resizeColumn(columnId: string, newWidth: number): void {
        const columns = this._grid.getColumns();
        const columnIndex = columns.findIndex((col) => col.id === columnId);
        if (columnIndex >= 0) {
            const column = columns[columnIndex];
            column.width = newWidth;
            this._grid.setColumns(columns);
        }
        void this.queryResultContext.extensionRpc.sendRequest(SetColumnWidthsRequest.type, {
            uri: this.uri,
            gridId: this.gridId,
            columnWidths: columns.slice(1).map((v) => v.width),
        });
        this._grid.focus();
    }
}

/**
 * Converts null to undefined, passes all other values through.
 */
export function withNullAsUndefined<T>(x: T | null): T | undefined {
    return x === null ? undefined : x;
}
