/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Adopted and converted to typescript from https://github.com/danny-sg/slickgrid-spreadsheet-plugins/blob/master/ext.headerfilter.js
// heavily modified

import { FilterableColumn } from "../interfaces";
import { append, $ } from "../dom";
import { instanceOfIDisposableDataProvider } from "../dataProvider";
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
            this.showFilter($el[0]);
        });

        $el.appendTo(args.node);

        //@ts-ignore
        this.columnButtonMapping[column.id] = $el[0];
    }

    private showFilter(filterButton: HTMLElement) {
        let $menuButton;
        const target = withNullAsUndefined(filterButton);
        if (target) {
            $menuButton = jQuery(target);
            this.columnDef = $menuButton.data("column");
        }

        const offset = jQuery(filterButton).offset();
        if (offset) {
            // If there is not enough vertical space under the filter button, we will move up the menu.
            // const menuTop = offset.top + this.menu.offsetHeight <= window.innerHeight ? offset.top : window.innerHeight - this.menu.offsetHeight;
            // Make sure the menu is on the screen horizontally.
            // const menuLeft = offset.left + filterButton.offsetWidth + this.menu.offsetWidth <= window.innerWidth ? offset.left + filterButton.offsetWidth : window.innerWidth - this.menu.offsetWidth;
        }

        const $popup = jQuery(
            '<div id="popup-menu">' +
                `<button id="sort-ascending" type="button" icon="slick-header-menuicon.ascending" class="sort-btn">${locConstants.queryResult.sortAscending}</button>` +
                `<button id="sort-descending" type="button" icon="slick-header-menuicon.descending" class="sort-btn">${locConstants.queryResult.sortDescending}</button>` +
                `<button id="close-popup" type="button" class="sort-btn">${locConstants.queryResult.cancel}</button>` +
                "</div>",
        );

        if (offset) {
            $popup.css({
                top: offset.top + $menuButton?.outerHeight()!, // Position below the anchor
                left: offset.left, // Align left edges
            });
            // If there is not enough vertical space under the filter button, we will move up the menu.
            // const menuTop = offset.top + this.menu.offsetHeight <= window.innerHeight ? offset.top : window.innerHeight - this.menu.offsetHeight;
            // Make sure the menu is on the screen horizontally.
            // const menuLeft = offset.left + filterButton.offsetWidth + this.menu.offsetWidth <= window.innerWidth ? offset.left + filterButton.offsetWidth : window.innerWidth - this.menu.offsetWidth;
        }

        $popup.appendTo(document.body);
        if (this.activePopup) {
            this.activePopup.fadeOut();
            this.activePopup = null;
        }
        openPopup($popup);
        this.activePopup = $popup;
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
        jQuery(document).on("click", "#close-popup", function () {
            closePopup($popup);
        });
        jQuery(document).on(
            "click",
            "#sort-ascending",
            (_e: JQuery.ClickEvent) => {
                void this.handleMenuItemClick("sort-asc", this.columnDef);
                closePopup($popup);
            },
        );
        jQuery(document).on(
            "click",
            "#sort-descending",
            (_e: JQuery.ClickEvent) => {
                void this.handleMenuItemClick("sort-desc", this.columnDef);
                closePopup($popup);
            },
        );

        function closePopup($popup: JQuery<HTMLElement>) {
            $popup.fadeOut();
        }

        function openPopup($popup: JQuery<HTMLElement>) {
            $popup.fadeIn();
        }
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

/**
 * Converts null to undefined, passes all other values through.
 */
export function withNullAsUndefined<T>(x: T | null): T | undefined {
    return x === null ? undefined : x;
}
