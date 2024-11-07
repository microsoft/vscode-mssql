/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Adopted and converted to typescript from https://github.com/danny-sg/slickgrid-spreadsheet-plugins/blob/master/ext.headerfilter.js
// heavily modified

import { FilterableColumn } from "../interfaces";
import { append, $ } from "../dom";
import {
    IDisposableDataProvider,
    instanceOfIDisposableDataProvider,
} from "../dataProvider";
import "./headerFilter.css";
import { locConstants } from "../../../../common/locConstants";

export type HeaderFilterCommands = "sort-asc" | "sort-desc";

export interface CommandEventArgs<T extends Slick.SlickData> {
    grid: Slick.Grid<T>;
    column: Slick.Column<T>;
    command: HeaderFilterCommands;
}

const ShowFilterText = locConstants.queryResult.showFilter;

export const FilterButtonWidth: number = 34;

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
    private columnButtonMapping: Map<string, HTMLElement> = new Map<
        string,
        HTMLElement
    >();
    private list?: List<TableFilterListElement>;
    private listData: TableFilterListElement[];
    private filteredListData: TableFilterListElement[];

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
            );
        // .subscribe(this.grid.onClick, (e: DOMEvent) => this.handleBodyMouseDown(e as MouseEvent))
        // .subscribe(this.grid.onColumnsResized, () => this.columnsResized());

        // addEventListener('click', e => this.handleBodyMouseDown(e));
        // this.disposableStore.add(addDisposableListener(document.body, 'keydown', e => this.handleKeyDown(e)));
    }

    public destroy() {
        this.handler.unsubscribeAll();
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

        args.node.classList.add("slick-header-with-filter");
        const $el = jQuery(
            `<button tabindex="-1" id="anchor-btn" aria-label="${ShowFilterText}" title="${ShowFilterText}"></button>`,
        )
            .addClass("slick-header-menubutton")
            .data("column", column);
        if (column.filterValues?.length) {
            this.setButtonImage($el, column.filterValues?.length > 0);
        }

        $el.on("click", async (e: JQuery.ClickEvent) => {
            e.stopPropagation();
            e.preventDefault();
            await this.showFilter($el[0]);
        });

        $el.appendTo(args.node);

        //@ts-ignore
        this.columnButtonMapping[column.id] = $el[0];
    }

    private async showFilter(filterButton: HTMLElement) {
        let $menuButton;
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
            '<div id="popup-menu">' +
                `<button id="sort-ascending" type="button" icon="slick-header-menuicon.ascending" class="sort-btn">${locConstants.queryResult.sortAscending}</button>` +
                `<button id="sort-descending" type="button" icon="slick-header-menuicon.descending" class="sort-btn">${locConstants.queryResult.sortDescending}</button>` +
                `<div id="checkbox-list" class="checkbox-list"></div>` +
                `<button id="apply" type="button" class="sort-btn">${locConstants.queryResult.apply}</button>` +
                `<button id="clear" type="button" class="sort-btn">${locConstants.queryResult.clear}</button>` +
                `<button id="close-popup" type="button" class="sort-btn">${locConstants.queryResult.cancel}</button>` +
                "</div>",
        );

        if (offset) {
            $popup.css({
                top: offset.top + $menuButton?.outerHeight()!, // Position below the button
                left: offset.left, // Align left edges
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
        if (this.listData) {
            this.listData.forEach((option) => {
                const checkbox = jQuery(
                    `<label><input type="checkbox" value="${option.value}"> ${option.displayText}</label>`,
                );
                checkbox.appendTo(checkboxContainer);
            });
        }

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
        jQuery(document).on("click", "#close-popup", () => {
            closePopup($popup);
            this.activePopup = null;
        });

        // Sorting button click handlers
        jQuery(document).on(
            "click",
            "#sort-ascending",
            (_e: JQuery.ClickEvent) => {
                void this.handleMenuItemClick("sort-asc", this.columnDef);
                closePopup($popup);
                this.activePopup = null;
            },
        );

        jQuery(document).on(
            "click",
            "#sort-descending",
            (_e: JQuery.ClickEvent) => {
                void this.handleMenuItemClick("sort-desc", this.columnDef);
                closePopup($popup);
                this.activePopup = null;
            },
        );

        jQuery(document).on("click", "#apply", async (e: JQuery.ClickEvent) => {
            this.columnDef.filterValues = this.listData
                .filter((element) => element.checked)
                .map((element) => element.value);
            this.setButtonImage(
                $menuButton,
                this.columnDef.filterValues.length > 0,
            );
            closePopup($popup);
            this.activePopup = null;
            this.applyFilterSelections(checkboxContainer);
            await this.handleApply(this.columnDef);
        });

        jQuery(document).on("click", "#clear", async (e: JQuery.ClickEvent) => {
            this.columnDef.filterValues!.length = 0;
            this.setButtonImage($menuButton, false);
            closePopup($popup);
            this.activePopup = null;
            await this.handleApply(this.columnDef);
        });

        function closePopup($popup: JQuery<HTMLElement>) {
            $popup.fadeOut();
        }

        function openPopup($popup: JQuery<HTMLElement>) {
            $popup.fadeIn();
        }
    }

    private applyFilterSelections(checkboxContainer: JQuery<HTMLElement>) {
        const selectedValues: string[] = [];
        checkboxContainer
            .find("input[type=checkbox]:checked")
            .each((_idx, checkbox) => {
                selectedValues.push((<HTMLInputElement>checkbox).value);
            });

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

    private async handleApply(columnDef: Slick.Column<T>) {
        const dataView = this.grid.getData();
        if (instanceOfIDisposableDataProvider(dataView)) {
            await (dataView as IDisposableDataProvider<T>).filter(
                this.grid.getColumns(),
            );
            this.grid.invalidateAllRows();
            this.grid.updateRowCount();
            this.grid.render();
        }
        this.onFilterApplied.notify({ grid: this.grid, column: columnDef });
        this.setFocusToColumn(columnDef);
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
        const dataView = this.grid.getData() as Slick.DataProvider<T>;
        if (instanceOfIDisposableDataProvider(dataView)) {
            filterItems = await (
                dataView as IDisposableDataProvider<T>
            ).getColumnValues(this.columnDef);
        } else {
            const filterApplied =
                this.grid.getColumns().findIndex((col) => {
                    const filterableColumn = col as FilterableColumn<T>;
                    return filterableColumn.filterValues?.length > 0;
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
        const nullValueIndex = filterItems.indexOf(undefined);
        if (nullValueIndex !== -1) {
            filterItems.splice(nullValueIndex, 1);
            filterItems.unshift(undefined);
        }

        this.listData = [];
        for (let i = 0; i < filterItems.length; i++) {
            const filtered = workingFilters.some((x) => x === filterItems[i]);
            // work item to remove the 'Error:' string check: https://github.com/microsoft/azuredatastudio/issues/15206
            const filterItem = filterItems[i];
            if (!filterItem || filterItem.indexOf("Error:") < 0) {
                let element = new TableFilterListElement(filterItem, filtered);
                this.listData.push(element);
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

class TableFilterListElement {
    private _checked: boolean;

    constructor(val: string, checked: boolean) {
        this.value = val;
        this._checked = checked;

        // Handle the values that are visually hard to differentiate.
        if (val === undefined) {
            this.displayText = locConstants.queryResult.null;
        } else if (val === "") {
            this.displayText = locConstants.queryResult.blankString;
        } else {
            this.displayText = val;
        }
    }

    public displayText: string;
    public value: string;

    // public onCheckStateChanged = this._onCheckStateChanged.event;

    public get checked(): boolean {
        return this._checked;
    }
    public set checked(val: boolean) {
        if (this._checked !== val) {
            this._checked = val;
        }
    }
}

/**
 * Converts null to undefined, passes all other values through.
 */
export function withNullAsUndefined<T>(x: T | null): T | undefined {
    return x === null ? undefined : x;
}
