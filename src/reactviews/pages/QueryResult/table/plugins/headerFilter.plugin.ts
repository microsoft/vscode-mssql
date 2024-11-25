/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Adopted and converted to typescript from https://github.com/danny-sg/slickgrid-spreadsheet-plugins/blob/master/ext.headerfilter.js
// heavily modified

import {
    ColumnFilterState,
    FilterableColumn,
    SortProperties,
} from "../interfaces";
import { append, $ } from "../dom";
import {
    IDisposableDataProvider,
    instanceOfIDisposableDataProvider,
} from "../dataProvider";
import "../../../../media/table.css";
import { locConstants } from "../../../../common/locConstants";
import { ColorThemeKind } from "../../../../common/vscodeWebviewProvider";
import { resolveVscodeThemeType } from "../../../../common/utils";
import { VirtualizedList } from "../../../../common/virtualizedList";
import { EventManager } from "../../../../common/eventManager";

import { QueryResultState } from "../../queryResultStateProvider";

export type HeaderFilterCommands = "sort-asc" | "sort-desc";

export interface CommandEventArgs<T extends Slick.SlickData> {
    grid: Slick.Grid<T>;
    column: Slick.Column<T>;
    command: HeaderFilterCommands;
}

const ShowFilterText = locConstants.queryResult.showFilter;

export const FilterButtonWidth: number = 34;

export class HeaderFilter<T extends Slick.SlickData> {
    public theme: ColorThemeKind;
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
    private columnButtonMapping: Map<string, HTMLElement> = new Map<
        string,
        HTMLElement
    >();
    private _listData: TableFilterListElement[] = [];
    private _list!: VirtualizedList<TableFilterListElement>;

    private _eventManager = new EventManager();
    private queryResultState: QueryResultState;

    constructor(theme: ColorThemeKind, queryResultState: QueryResultState) {
        this.queryResultState = queryResultState;
        this.theme = theme;
    }

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
            .subscribe(this.grid.onBeforeDestroy, () => this.destroy());
        // .subscribe(this.grid.onClick, (e: DOMEvent) => this.handleBodyMouseDown(e as MouseEvent))
        // .subscribe(this.grid.onColumnsResized, () => this.columnsResized());

        // addEventListener('click', e => this.handleBodyMouseDown(e));
        // this.disposableStore.add(addDisposableListener(document.body, 'keydown', e => this.handleKeyDown(e)));
    }

    public destroy() {
        this.handler.unsubscribeAll();
        this._eventManager.clearEventListeners();
        this._list.dispose();
    }

    private handleHeaderCellRendered(
        _e: Event,
        args: Slick.OnHeaderCellRenderedEventArgs<T>,
    ) {
        const column = args.column as FilterableColumn<T>;
        if ((<FilterableColumn<T>>column).filterable === false) {
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
        const $el = jQuery(
            `<button tabindex="-1" id="anchor-btn" aria-label="${ShowFilterText}" title="${ShowFilterText}"></button>`,
        )
            .addClass("slick-header-menubutton")
            .data("column", column);
        if (column.filterValues?.length) {
            this.setButtonImage($el, column.filterValues?.length > 0);
        }

        const elDivElement = $el.get(0);
        if (elDivElement) {
            this._eventManager.addEventListener(
                elDivElement,
                "click",
                async (e: Event) => {
                    e.stopPropagation();
                    e.preventDefault();
                    await this.showFilter(elDivElement);
                },
            );
        }

        $el.appendTo(args.node);

        //@ts-ignore
        this.columnButtonMapping[column.id] = $el[0];
    }

    private async showFilter(filterButton: HTMLElement) {
        let $menuButton: JQuery<HTMLElement> | undefined;
        const target = withNullAsUndefined(filterButton);
        if (target) {
            $menuButton = jQuery(target);
            this.columnDef = $menuButton.data("column");
        }

        // Check if the active popup is for the same button
        if (this.activePopup) {
            const isSameButton =
                this.activePopup.data("button") === filterButton;
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
            '<div id="popup-menu" class="slick-header-menu">' +
                `<button id="sort-ascending" type="button" icon="slick-header-menuicon.ascending" class="sort-btn">${locConstants.queryResult.sortAscending}</button>` +
                `<button id="sort-descending" type="button" icon="slick-header-menuicon.descending" class="sort-btn">${locConstants.queryResult.sortDescending}</button>` +
                `<div style="display: flex; align-items: center; margin-bottom: 8px;">` +
                `<input type="checkbox" id="select-all-checkbox" style="margin-right: 8px;" />` +
                `<input type="text" id="search-input" class="searchbox" placeholder=${locConstants.queryResult.search}  />` +
                `</div>` +
                `<div id="checkbox-list" class="checkbox-list"></div>` +
                `<button id="apply-${this.columnDef.id}" type="button" class="filter-btn-primary">${locConstants.queryResult.apply}</button>` +
                `<button id="clear-${this.columnDef.id}" type="button" class="filter-btn">${locConstants.queryResult.clear}</button>` +
                `<button id="close-popup-${this.columnDef.id}" type="button" class="filter-btn">${locConstants.queryResult.close}</button>` +
                "</div>",
        );

        const popupElement = $popup.get(0);
        if (popupElement) {
            this._eventManager.addEventListener(
                document,
                "click",
                (_e: Event) => {
                    if ($popup) {
                        const popupElement = $popup.get(0);
                        if (!popupElement.contains(_e.target as Node)) {
                            closePopup($popup);
                            this.activePopup = null;
                        }
                    }
                },
            );

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
            const searchTerm = (
                e.target as HTMLInputElement
            ).value.toLowerCase();

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

        // Add event listeners for closing or interacting with the popup
        jQuery(document).on("click", (e: JQuery.ClickEvent) => {
            const $target = jQuery(e.target);

            // If the clicked target is not the button or the menu, close the menu
            if (
                !$target.closest("#anchor-btn").length &&
                !$target.closest("#popup-menu").length
            ) {
                this.activePopup!.fadeOut();
                this.activePopup = null;
            }
        });

        // Close the pop-up when the close-popup button is clicked
        jQuery(document).on(
            "click",
            `#close-popup-${this.columnDef.id}`,
            () => {
                closePopup($popup);
                this.activePopup = null;
            },
        );

        // Sorting button click handlers
        jQuery(document).on(
            "click",
            "#sort-ascending",
            (_e: JQuery.ClickEvent) => {
                void this.handleMenuItemClick("sort-asc", this.columnDef);
                closePopup($popup);
                this.activePopup = null;
                this.grid.setSortColumn(this.columnDef.id!, true);
                this.columnDef.sorted = SortProperties.ASC;
            },
        );

        jQuery(document).on(
            "click",
            "#sort-descending",
            (_e: JQuery.ClickEvent) => {
                void this.handleMenuItemClick("sort-desc", this.columnDef);
                closePopup($popup);
                this.activePopup = null;
                this.grid.setSortColumn(this.columnDef.id!, false);
                this.columnDef.sorted = SortProperties.DESC;
            },
        );

        jQuery(document).on(
            "click",
            `#apply-${this.columnDef.id}`,
            async () => {
                this.columnDef.filterValues = this._listData
                    .filter((element) => element.checked)
                    .map((element) => element.value);
                closePopup($popup);
                this.activePopup = null;
                this.applyFilterSelections();
                if (!$menuButton) {
                    return;
                }
                this.setButtonImage(
                    $menuButton,
                    this.columnDef.filterValues.length > 0,
                );
                await this.handleApply(this.columnDef);
            },
        );

        jQuery(document).on(
            "click",
            `#clear-${this.columnDef.id}`,
            async () => {
                this.columnDef.filterValues!.length = 0;

                closePopup($popup);
                this.activePopup = null;
                if (!$menuButton) {
                    return;
                }
                this.setButtonImage($menuButton, false);
                await this.handleApply(this.columnDef, true);
            },
        );

        function closePopup($popup: JQuery<HTMLElement>) {
            $popup.hide({
                duration: 0,
            });
        }

        function openPopup($popup: JQuery<HTMLElement>) {
            $popup.show();
            $popup.find("#sort-ascending").focus();
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

                const id = `checkbox-${item.index}`;
                const checkboxElement = document.createElement("input");
                checkboxElement.type = "checkbox";
                checkboxElement.checked = item.checked;
                checkboxElement.name = item.value;
                checkboxElement.id = id;
                checkboxElement.tabIndex = -1;

                // Attach change listener
                this._eventManager.addEventListener(
                    checkboxElement,
                    "change",
                    () => {
                        this._listData[item.index].checked =
                            checkboxElement.checked;
                        item.checked = checkboxElement.checked;
                    },
                );

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
                console.log(checkboxElement);
                checkboxElement.checked = !checkboxElement.checked;
                console.log(checkboxElement.checked);
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

    private async handleApply(columnDef: Slick.Column<T>, clear?: boolean) {
        let columnFilterState: ColumnFilterState;
        const dataView = this.grid.getData() as IDisposableDataProvider<T>;
        if (instanceOfIDisposableDataProvider(dataView)) {
            await dataView.filter(this.grid.getColumns());
            this.grid.invalidateAllRows();
            this.grid.updateRowCount();
            this.grid.render();
        }
        this.onFilterApplied.notify({ grid: this.grid, column: columnDef });
        this.setFocusToColumn(columnDef);
        // clear filterValues if clear is true
        if (clear) {
            columnFilterState = {
                columnDef: this.columnDef.id!,
                filterValues: [],
                sorted: SortProperties.NONE,
            };
        } else {
            columnFilterState = {
                columnDef: this.columnDef.id!,
                filterValues: this.columnDef.filterValues!,
                sorted: this.columnDef.sorted,
            };
        }
        this.updateState(columnFilterState);
    }

    private updateState(newState: ColumnFilterState) {
        this.queryResultState.provider.setFilterState(newState);
    }

    private async handleMenuItemClick(
        command: HeaderFilterCommands,
        columnDef: Slick.Column<T>,
    ) {
        const dataView = this.grid.getData();
        if (command === "sort-asc" || command === "sort-desc") {
            this.grid.setSortColumn(
                columnDef.id as string,
                command === "sort-asc",
            );
        }
        if (
            instanceOfIDisposableDataProvider<T>(dataView) &&
            (command === "sort-asc" || command === "sort-desc")
        ) {
            await dataView.sort({
                grid: this.grid,
                multiColumnSort: false,
                sortCol: this.columnDef,
                sortAsc: command === "sort-asc",
            });
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
                    (
                        this.grid.getData() as Slick.Data.DataView<T>
                    ).getFilteredItems(),
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

    private getFilterValues(
        dataView: Slick.DataProvider<T>,
        column: Slick.Column<T>,
    ): Array<any> {
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
            const column = this.grid
                .getColumns()
                .findIndex((col) => col.id === columnDef.id);
            if (column >= 0) {
                this.grid.setActiveCell(0, column);
            }
        }
    }

    private setButtonImage($el: JQuery<HTMLElement>, filtered: boolean) {
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
