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
import { VscodeWebviewContext } from "../../../../common/vscodeWebviewProvider";
import { resolveVscodeThemeType } from "../../../../common/utils";
import { VirtualizedList } from "../../../../common/virtualizedList";
import { EventManager } from "../../../../common/eventManager";

import {
    ColumnFilterState,
    GetFiltersRequest,
    GridColumnMap,
    QueryResultReducers,
    QueryResultWebviewState,
    SetFiltersRequest,
    ShowFilterDisabledMessageRequest,
    SortProperties,
} from "../../../../../sharedInterfaces/queryResult";
import { ColorThemeKind } from "../../../../../sharedInterfaces/webview";

export type SortDirection = "sort-asc" | "sort-desc" | "reset";

export interface CommandEventArgs<T extends Slick.SlickData> {
    grid: Slick.Grid<T>;
    column: Slick.Column<T>;
    command: SortDirection;
}

export const FilterButtonWidth = 34;

export class HeaderFilter<T extends Slick.SlickData> {
    public onFilterApplied = new Slick.Event<{
        grid: Slick.Grid<T>;
        column: FilterableColumn<T>;
    }>();
    public onCommand = new Slick.Event<CommandEventArgs<T>>();
    public enabled: boolean = true;

    private activePopup: JQuery<HTMLElement> | null = null;

    private grid!: Slick.Grid<T>;
    private handler = new Slick.EventHandler();
    private columnDef!: FilterableColumn<T>;
    private columnFilterButtonMapping: Map<string, HTMLElement> = new Map<string, HTMLElement>();
    private columnSortStateMapping: Map<string, SortProperties> = new Map<string, SortProperties>();
    private _listData: TableFilterListElement[] = [];
    private _list!: VirtualizedList<TableFilterListElement>;

    private _eventManager = new EventManager();
    private currentSortColumn: string = "";
    private currentSortButton: JQuery<HTMLElement> | null = null;

    constructor(
        public theme: ColorThemeKind,
        private queryResultContext: QueryResultContextProps,
        private webviewState: VscodeWebviewContext<QueryResultWebviewState, QueryResultReducers>,
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
        this._list.dispose();
    }

    private async headerContextMenuHandler(e: Event): Promise<void> {
        // Prevent the default vscode context menu from showing on right-clicking the header
        e.preventDefault();
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
        const $filterButton = jQuery(
            `<button tabindex="0" id="anchor-btn" aria-label="${locConstants.queryResult.showFilter}" title="${locConstants.queryResult.showFilter}"></button>`,
        )
            .addClass("slick-header-menubutton")
            .data("column", column);
        const $sortButton = jQuery(
            `<button tabindex="0" id="anchor-btn" aria-label="${locConstants.queryResult.sortAscending}" title="${locConstants.queryResult.sortAscending}" data-column-id="${column.id}"></button>`,
        )
            .addClass("slick-header-sort-button")
            .data("column", column);
        if (column.filterValues?.length) {
            this.setFilterButtonImage($filterButton, column.filterValues?.length > 0);
        }
        if (column.sorted) {
            this.setSortButtonImage($sortButton, column);
            this.columnSortStateMapping.set(column.id!, column.sorted);
        }

        const filterButton = $filterButton.get(0);
        if (filterButton) {
            this._eventManager.addEventListener(filterButton, "click", async (e: Event) => {
                e.stopPropagation();
                e.preventDefault();
                await this.showFilter(filterButton);
                this.grid.onHeaderClick.notify();
            });
        }

        const sortButton = $sortButton.get(0);
        if (sortButton) {
            this._eventManager.addEventListener(sortButton, "click", async (e: Event) => {
                e.stopPropagation();
                e.preventDefault();
                if (!this.enabled) {
                    await this.webviewState.extensionRpc.sendRequest(
                        ShowFilterDisabledMessageRequest.type,
                    );
                    return;
                }
                this.columnDef = jQuery(sortButton).data("column"); //TODO: fix, shouldn't assign in the event handler
                let columnFilterState: ColumnFilterState = {
                    columnDef: this.columnDef.id!,
                    filterValues: this.columnDef.filterValues!,
                    sorted: this.columnDef.sorted ?? SortProperties.NONE,
                };
                let sortState = this.columnSortStateMapping.get(column.id!);

                switch (sortState) {
                    case SortProperties.NONE:
                        if (this.currentSortColumn && this.currentSortButton) {
                            const $prevSortButton = this.currentSortButton;
                            let prevColumnDef = jQuery($prevSortButton).data("column");
                            $prevSortButton.removeClass("slick-header-sortasc-button");
                            $prevSortButton.removeClass("slick-header-sortdesc-button");
                            $prevSortButton.addClass("slick-header-sort-button");
                            this.columnSortStateMapping.set(
                                this.currentSortColumn,
                                SortProperties.NONE,
                            );
                            columnFilterState.sorted = SortProperties.NONE;
                            let prevFilterState: ColumnFilterState = {
                                columnDef: prevColumnDef.id!,
                                filterValues: prevColumnDef.filterValues!,
                                sorted: SortProperties.NONE,
                            };
                            await this.updateState(prevFilterState, prevColumnDef.id!);
                        }
                        $sortButton.removeClass("slick-header-sort-button");
                        $sortButton.addClass("slick-header-sortasc-button");
                        $sortButton.attr("aria-label", locConstants.queryResult.sortDescending); // setting ASC, so next is DESC
                        $sortButton.attr("title", locConstants.queryResult.sortDescending);
                        await this.handleMenuItemClick("sort-asc", column);
                        this.columnSortStateMapping.set(column.id!, SortProperties.ASC);
                        columnFilterState.sorted = SortProperties.ASC;
                        this.currentSortColumn = column.id!;
                        this.currentSortButton = $sortButton;
                        break;
                    case SortProperties.ASC:
                        $sortButton.removeClass("slick-header-sortasc-button");
                        $sortButton.addClass("slick-header-sortdesc-button");
                        $sortButton.attr("aria-label", locConstants.queryResult.clearSort); // setting DESC, so next is cleared
                        $sortButton.attr("title", locConstants.queryResult.clearSort);
                        await this.handleMenuItemClick("sort-desc", column);
                        this.columnSortStateMapping.set(column.id!, SortProperties.DESC);
                        columnFilterState.sorted = SortProperties.DESC;
                        break;
                    case SortProperties.DESC:
                        $sortButton.removeClass("slick-header-sortdesc-button");
                        $sortButton.addClass("slick-header-sort-button");
                        $sortButton.attr("aria-label", locConstants.queryResult.sortAscending); // setting cleared, so next is ASC
                        $sortButton.attr("title", locConstants.queryResult.sortAscending);
                        this.columnSortStateMapping.set(column.id!, SortProperties.NONE);
                        await this.handleMenuItemClick("reset", column);
                        columnFilterState.sorted = SortProperties.NONE;
                        await this.updateState(columnFilterState, this.columnDef.id!);
                        this.currentSortColumn = "";
                        break;
                }
                await this.updateState(columnFilterState, this.columnDef.id!);
                this.grid.onHeaderClick.notify();
            });
        }

        $sortButton.appendTo(args.node);
        $filterButton.appendTo(args.node);

        this.columnFilterButtonMapping.set(column.id!, filterButton);
        if (this.columnSortStateMapping.get(column.id!) === undefined) {
            this.columnSortStateMapping.set(column.id!, SortProperties.NONE);
        }
    }

    private async showFilter(filterButton: HTMLElement) {
        if (!this.enabled) {
            await this.webviewState.extensionRpc.sendRequest(ShowFilterDisabledMessageRequest.type);
            return;
        }
        let $menuButton: JQuery<HTMLElement> | undefined;
        const target = withNullAsUndefined(filterButton);
        if (target) {
            $menuButton = jQuery(target);
            this.columnDef = $menuButton.data("column");
        }

        // Check if the active popup is for the same button
        if (this.activePopup) {
            const isSameButton = this.activePopup.data("button") === filterButton;
            // close the popup and reset activePopup
            this.activePopup.fadeOut();
            this.activePopup = null;
            if (isSameButton) {
                return; // Exit since we're just closing the popup for the same button
            }
        }

        // Proceed to open the new popup for the clicked column
        const offset = jQuery(filterButton).offset();
        const $popup = jQuery(
            '<div id="popup-menu" class="slick-header-menu" tabindex="0">' +
                `<div style="display: flex; align-items: center; margin-bottom: 8px;">` +
                `<input type="checkbox" id="select-all-checkbox" style="margin-right: 8px;" tabindex="0"/>` +
                `<input type="text" id="search-input" class="searchbox" placeholder=${locConstants.queryResult.search} tabindex="0"/>` +
                `</div>` +
                `<div id="checkbox-list" class="checkbox-list"></div>` +
                `<button id="apply-${this.columnDef.id}" type="button" class="filter-btn-primary" tabindex="0">${locConstants.queryResult.apply}</button>` +
                `<button id="clear-${this.columnDef.id}" type="button" class="filter-btn" tabindex="0">${locConstants.queryResult.clear}</button>` +
                `<button id="close-popup-${this.columnDef.id}" type="button" class="filter-btn" tabindex="0">${locConstants.queryResult.close}</button>` +
                "</div>",
        );

        const popupElement = $popup.get(0);
        if (popupElement) {
            this._eventManager.addEventListener(document, "click", (_e: Event) => {
                if ($popup) {
                    const popupElement = $popup.get(0);
                    if (!popupElement.contains(_e.target as Node)) {
                        closePopup($popup);
                        this.activePopup = null;
                    }
                }
            });

            this._eventManager.addEventListener(window, "blur", (_e: Event) => {
                if ($popup) {
                    closePopup($popup);
                    this.activePopup = null;
                }
            });
        }

        if (offset) {
            $popup.css({
                top: offset.top + $menuButton?.outerHeight()!, // Position below the button
                left: Math.min(offset.left, document.body.clientWidth - 250), // Position to the left of the button
            });
        }

        await this.createFilterList();

        // Append and show the new popup
        $popup.appendTo(document.body);
        openPopup($popup);

        // Store the clicked button reference with the popup, so we can check it later
        $popup.data("button", filterButton);

        // Set the new popup as the active popup
        this.activePopup = $popup;
        const checkboxContainer = $popup.find("#checkbox-list");
        this._list = this.createList(checkboxContainer);

        $popup.find("#search-input").on("input", (e: Event) => {
            const searchTerm = (e.target as HTMLInputElement).value.toLowerCase();

            const visibleItems: TableFilterListElement[] = [];

            this._listData.forEach((i) => {
                i.isVisible = i.displayText.toLowerCase().includes(searchTerm);
                if (i.isVisible) {
                    visibleItems.push(i);
                }
            });
            this._list.updateItems(visibleItems);
        });

        $popup.find("#select-all-checkbox").on("change", (e: Event) => {
            const isChecked = (e.target as HTMLInputElement).checked;
            this.selectAllFiltered(isChecked);
        });

        jQuery(document).on("click", (e: JQuery.ClickEvent) => {
            const $target = jQuery(e.target);

            // If the clicked target is not the button or the menu, close the menu
            if (!$target.closest("#anchor-btn").length && !$target.closest("#popup-menu").length) {
                if (this.activePopup) {
                    this.activePopup.fadeOut();
                    this.activePopup = null;
                }
            }
        });

        jQuery(document).on("contextmenu", () => {
            if (this.activePopup) {
                this.activePopup!.fadeOut();
                this.activePopup = null;
            }
        });

        // Close the pop-up when the close-popup button is clicked
        jQuery(document).on("click", `#close-popup-${this.columnDef.id}`, () => {
            closePopup($popup);
            this.activePopup = null;
        });

        jQuery(document).on("click", `#apply-${this.columnDef.id}`, async () => {
            closePopup($popup);
            this.activePopup = null;
            this.applyFilterSelections();
            if (!$menuButton) {
                return;
            }
            if (this.columnDef.filterValues) {
                this.setFilterButtonImage($menuButton, this.columnDef.filterValues.length > 0);
            }
            await this.handleApply(this.columnDef);
        });

        jQuery(document).on("click", `#clear-${this.columnDef.id}`, async () => {
            if (this.columnDef.filterValues) {
                this.columnDef.filterValues.length = 0;
            }

            if (!$menuButton) {
                return;
            }
            this.setFilterButtonImage($menuButton, false);
            await this.handleApply(this.columnDef, true);
        });

        function closePopup($popup: JQuery<HTMLElement>) {
            $popup.hide({
                duration: 0,
            });
        }

        function openPopup($popup: JQuery<HTMLElement>) {
            $popup.show();
            ($popup[0] as HTMLElement).focus();
        }
    }

    public createList(checkboxContainer: JQuery<HTMLElement>) {
        return new VirtualizedList(
            checkboxContainer.get(0),
            this._listData,
            (itemContainer, item) => {
                itemContainer.style.boxSizing = "border-box";
                itemContainer.style.display = "flex";
                itemContainer.style.alignItems = "center";
                itemContainer.style.padding = "0 5px";
                itemContainer.id = `listitemcontainer-${item.index}`;

                itemContainer.addEventListener("keydown", (e) => {
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();

                        let nextIndex = e.key === "ArrowDown" ? item.index + 1 : item.index - 1;
                        const nextItemContainer = checkboxContainer
                            .get(0)
                            .querySelectorAll(`[id="listitemcontainer-${nextIndex}"]`);
                        if (nextItemContainer) {
                            const nextItem = nextItemContainer[0] as HTMLElement;
                            nextItem.scrollIntoView({
                                behavior: "smooth",
                                block: "nearest",
                            });
                            nextItem.tabIndex = 0; // Set tabIndex to 0 for the next item
                            itemContainer.tabIndex = -1; // Remove focus from the current item
                            nextItem.focus();
                        }
                    }
                });

                const id = `checkbox-${item.index}`;
                const checkboxElement = document.createElement("input");
                checkboxElement.type = "checkbox";
                checkboxElement.checked = item.checked;
                checkboxElement.name = item.value;
                checkboxElement.id = id;
                checkboxElement.tabIndex = -1;

                // Attach change listener
                this._eventManager.addEventListener(checkboxElement, "change", () => {
                    this._listData[item.index].checked = checkboxElement.checked;
                    item.checked = checkboxElement.checked;
                });

                const label = document.createElement("label");
                label.style.flex = "1";
                label.style.overflow = "hidden";
                label.style.textOverflow = "ellipsis";
                label.style.whiteSpace = "nowrap";
                label.innerText = item.displayText;
                label.title = item.displayText;
                label.setAttribute("for", id);

                itemContainer.appendChild(checkboxElement);
                itemContainer.appendChild(label);
            },
            (itemDiv, item) => {
                const checkboxElement = itemDiv.querySelector(
                    "input[type='checkbox']",
                ) as HTMLInputElement;
                checkboxElement.checked = !checkboxElement.checked;
                this._listData[item.index].checked = checkboxElement.checked;
                item.checked = checkboxElement.checked;
            },
            {
                itemHeight: 30,
                buffer: 5,
            },
        );
    }

    private selectAllFiltered(select: boolean) {
        for (let i = 0; i < this._listData.length; i++) {
            if (!this._listData[i].isVisible) {
                continue;
            }
            this._listData[i].checked = select;
        }
        this._list.updateItems(this._listData.filter((i) => i.isVisible));
    }

    private applyFilterSelections() {
        const selectedValues: string[] = this._listData
            .filter((i) => i.checked)
            .map((i) => i.value);

        // Update the column filter values
        this.columnDef.filterValues = selectedValues;
        this.onFilterApplied.notify({
            grid: this.grid,
            column: this.columnDef,
        });

        // Refresh the grid or apply filtering logic based on the selected values
        this.grid.invalidate();
        this.grid.render();
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
            if (this.queryResultContext.state.uri) {
                // Get the current filters from the query result singleton store
                let gridColumnMapArray = await this.webviewState.extensionRpc.sendRequest(
                    GetFiltersRequest.type,
                    {
                        uri: this.queryResultContext.state.uri,
                    },
                );
                if (!gridColumnMapArray) {
                    gridColumnMapArray = [];
                }
                // Drill down into the grid column map array and clear the filter values for the specified column
                gridColumnMapArray = await this.clearFilterValues(
                    gridColumnMapArray,
                    columnDef.id!,
                );
                await this.webviewState.extensionRpc.sendRequest(SetFiltersRequest.type, {
                    uri: this.queryResultContext.state.uri,
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
        if (!this.queryResultContext.state.uri) {
            this.queryResultContext.log("no uri set for query result state");
            return;
        }
        let currentFiltersArray = await this.webviewState.extensionRpc.sendRequest(
            GetFiltersRequest.type,
            {
                uri: this.queryResultContext.state.uri,
            },
        );
        if (!currentFiltersArray) {
            currentFiltersArray = [];
        }
        newStateArray = this.combineFilters(currentFiltersArray, newState, columnId);
        await this.webviewState.extensionRpc.sendRequest(SetFiltersRequest.type, {
            uri: this.queryResultContext.state.uri,
            filters: newStateArray,
        });
    }

    /**
     * Drill down into the grid column map array and clear the filter values for the specified column
     * @param gridFiltersArray
     * @param columnId
     * @returns
     */
    private async clearFilterValues(gridFiltersArray: GridColumnMap[], columnId: string) {
        const targetGridFilters = gridFiltersArray.find((gridFilters) => gridFilters[this.gridId]);

        // Return original array if gridId is not found
        if (!targetGridFilters) {
            return gridFiltersArray;
        }

        // Iterate through each ColumnFilterMap and clear filterValues for the specified columnId
        for (const columnFilterMap of targetGridFilters[this.gridId]) {
            if (columnFilterMap[columnId]) {
                columnFilterMap[columnId] = columnFilterMap[columnId].map((filterState) => ({
                    ...filterState,
                    filterValues: [],
                }));
            }
        }

        this._listData = [];
        const dataView = this.grid.getData() as IDisposableDataProvider<T>;

        let filterItems = await dataView.getColumnValues(this.columnDef);
        this.columnDef.filterValues = this.columnDef.filterValues || [];
        const workingFilters = this.columnDef.filterValues.slice(0);

        this.compileFilters(workingFilters, filterItems);
        this._list.updateItems(this._listData.filter((i) => i.isVisible));
        return gridFiltersArray;
    }

    private compileFilters(workingFilters: string[], filterItems: string[]) {
        for (let i = 0; i < filterItems.length; i++) {
            const filtered = workingFilters.some((x) => x === filterItems[i]);
            // work item to remove the 'Error:' string check: https://github.com/microsoft/azuredatastudio/issues/15206
            const filterItem = filterItems[i];
            if (!filterItem || filterItem.indexOf("Error:") < 0) {
                let element = new TableFilterListElement(filterItem, filtered);
                element.index = i;
                this._listData.push(element);
            }
        }
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

    private async createFilterList(): Promise<void> {
        this.columnDef.filterValues = this.columnDef.filterValues || [];
        // WorkingFilters is a copy of the filters to enable apply/cancel behaviour
        const workingFilters = this.columnDef.filterValues.slice(0);
        let filterItems: Array<string>;
        const dataView = this.grid.getData() as IDisposableDataProvider<T>;
        if (instanceOfIDisposableDataProvider(dataView)) {
            filterItems = await dataView.getColumnValues(this.columnDef);
        } else {
            const filterApplied =
                this.grid.getColumns().findIndex((col) => {
                    const filterableColumn = col as FilterableColumn<T>;
                    return filterableColumn.filterValues?.length! > 0;
                }) !== -1;
            if (!filterApplied) {
                // Filter based all available values
                filterItems = this.getFilterValues(
                    this.grid.getData() as Slick.DataProvider<T>,
                    this.columnDef,
                );
            } else {
                // Filter based on current dataView subset
                filterItems = this.getAllFilterValues(
                    (this.grid.getData() as Slick.Data.DataView<T>).getFilteredItems(),
                    this.columnDef,
                );
            }
        }
        // Sort the list to make it easier to find a string
        filterItems.sort();
        // Promote undefined (NULL) to be always at the top of the list
        const nullValueIndex = filterItems.indexOf("");
        if (nullValueIndex !== -1) {
            filterItems.splice(nullValueIndex, 1);
            filterItems.unshift("");
        }
        this._listData = [];
        this.compileFilters(workingFilters, filterItems);
    }

    private getFilterValues(dataView: Slick.DataProvider<T>, column: Slick.Column<T>): Array<any> {
        const seen: Set<string> = new Set();
        dataView.getItems().forEach((items) => {
            const value = items[column.field!];
            const valueArr = value instanceof Array ? value : [value];
            valueArr.forEach((v) => seen.add(v));
        });

        return Array.from(seen);
    }

    private getAllFilterValues(data: Array<T>, column: Slick.Column<T>) {
        const seen: Set<any> = new Set();

        data.forEach((items) => {
            const value = items[column.field!];
            const valueArr = value instanceof Array ? value : [value];
            valueArr.forEach((v) => seen.add(v));
        });

        return Array.from(seen).sort((v) => {
            return v;
        });
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

    private setFilterButtonImage($el: JQuery<HTMLElement>, filtered: boolean) {
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

    private setSortButtonImage($sortButton: JQuery<HTMLElement>, column: FilterableColumn<T>) {
        if ($sortButton && column.sorted && column.sorted !== SortProperties.NONE) {
            switch (column.sorted) {
                case SortProperties.ASC:
                    $sortButton.removeClass("slick-header-sort-button");
                    $sortButton.addClass("slick-header-sortasc-button");
                    break;
                case SortProperties.DESC:
                    $sortButton.removeClass("slick-header-sort-button");
                    $sortButton.addClass("slick-header-sortdesc-button");
                    break;
            }
        }
    }
}

export class TableFilterListElement {
    private _checked: boolean;
    private _isVisible: boolean;
    private _index: number = 0;
    public displayText: string;
    public value: string;

    constructor(val: string, checked: boolean) {
        this.value = val;
        this._checked = checked;
        this._isVisible = true;
        // Handle the values that are visually hard to differentiate.
        if (val === undefined) {
            this.displayText = locConstants.queryResult.null;
        } else if (val === "") {
            this.displayText = locConstants.queryResult.blankString;
        } else {
            this.displayText = val;
        }
    }

    // public onCheckStateChanged = this._onCheckStateChanged.event;

    public get checked(): boolean {
        return this._checked;
    }
    public set checked(val: boolean) {
        if (this._checked !== val) {
            this._checked = val;
        }
    }

    public get isVisible(): boolean {
        return this._isVisible;
    }

    public set isVisible(val: boolean) {
        if (this._isVisible !== val) {
            this._isVisible = val;
        }
    }

    public get index(): number {
        return this._index;
    }

    public set index(val: number) {
        if (this._index !== val) {
            this._index = val;
        }
    }
}

/**
 * Converts null to undefined, passes all other values through.
 */
export function withNullAsUndefined<T>(x: T | null): T | undefined {
    return x === null ? undefined : x;
}
