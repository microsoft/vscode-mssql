/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Simplified header filter/sort plugin for the notebook renderer.
 * Similar to HeaderMenu but without RPC dependencies or Fluent UI.
 * Reuses shared SVG icons from table.css via CSS background-image.
 * Renders filter popups as plain DOM elements.
 */

import { instanceOfIDisposableDataProvider } from "../QueryResult/table/dataProvider";
import { FilterableColumn } from "../QueryResult/table/interfaces";
import { SortProperties } from "../../../sharedInterfaces/queryResult";

// Sort/filter icons are provided via CSS background-image in table.css,
// which references the shared SVG files in src/webviews/media/.

/** Extra width added to each column to accommodate the sort + filter buttons. */
export const FilterButtonWidth = 38;

type FilterValue = string | undefined;

interface FilterListItem {
    value: FilterValue;
    displayText: string;
}

export class NotebookHeaderMenu<T extends Slick.SlickData> {
    public onFilterApplied = new Slick.Event<{
        grid: Slick.Grid<T>;
        column: FilterableColumn<T>;
    }>();
    public onSortChanged = new Slick.Event<SortProperties>();

    private _grid!: Slick.Grid<T>;
    private _handler = new Slick.EventHandler();
    private _columnSortButtonMapping = new Map<string, HTMLElement>();
    private _columnFilterButtonMapping = new Map<string, HTMLElement>();
    private _columnSortStateMapping = new Map<string, SortProperties>();
    private _currentSortColumn = "";
    private _activePopup: HTMLElement | null = null;
    private _activeColumnId: string | null = null;
    private _listeners: {
        target: EventTarget;
        type: string;
        handler: EventListenerOrEventListenerObject;
    }[] = [];
    private _outsideClickHandler: ((e: MouseEvent) => void) | null = null;
    private _escapeHandler: ((e: KeyboardEvent) => void) | null = null;

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
            .subscribe(this._grid.onBeforeDestroy, () => this.destroy());
    }

    public destroy(): void {
        this._handler.unsubscribeAll();
        this.dismissPopup();
        for (const { target, type, handler } of this._listeners) {
            target.removeEventListener(type, handler);
        }
        this._listeners = [];
    }

    private addListener(
        target: EventTarget,
        type: string,
        handler: EventListenerOrEventListenerObject,
    ): void {
        target.addEventListener(type, handler);
        this._listeners.push({ target, type, handler });
    }

    // â”€â”€ Header Cell Rendering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private onHeaderCellRendered(_e: Event, args: Slick.OnHeaderCellRenderedEventArgs<T>): void {
        const column = args.column as FilterableColumn<T>;
        if (column.filterable === false) {
            return;
        }
        if (args.node.classList.contains("slick-header-with-filter")) {
            return;
        }

        args.node.classList.add("slick-header-with-filter");

        // Sort button â€” uses shared slick-header-sortbutton class (icons via table.css)
        const sortBtn = document.createElement("button");
        sortBtn.className = "slick-header-sortbutton";
        sortBtn.title = "Sort";
        sortBtn.tabIndex = -1;
        this.addListener(sortBtn, "click", (e: Event) => {
            e.stopPropagation();
            e.preventDefault();
            const idx = this._grid.getColumns().findIndex((c) => c.id === column.id);
            void this.toggleSort(idx);
        });
        args.node.appendChild(sortBtn);
        this._columnSortButtonMapping.set(column.id!, sortBtn);

        // Filter button â€” uses shared slick-header-filterbutton class (icons via table.css)
        const filterBtn = document.createElement("button");
        filterBtn.className = "slick-header-filterbutton";
        filterBtn.title = "Filter";
        filterBtn.tabIndex = -1;
        this.addListener(filterBtn, "click", (e: Event) => {
            e.stopPropagation();
            e.preventDefault();
            void this.showFilterPopup(filterBtn, column);
        });
        args.node.appendChild(filterBtn);
        this._columnFilterButtonMapping.set(column.id!, filterBtn);

        // Restore existing sort state
        const existingSort = this._columnSortStateMapping.get(column.id!) ?? SortProperties.NONE;
        if (existingSort !== SortProperties.NONE) {
            this._currentSortColumn = column.id!;
            this.updateSortIcon(column.id!, existingSort);
        }

        // Restore existing filter icon state
        if (column.filterValues && column.filterValues.length > 0) {
            this.updateFilterIcon(column.id!, true);
        }
    }

    private onBeforeHeaderCellDestroy(
        _e: Event,
        args: Slick.OnBeforeHeaderCellDestroyEventArgs<T>,
    ): void {
        const sortBtn = args.node.querySelector(".slick-header-sortbutton");
        if (sortBtn) {
            sortBtn.remove();
        }
        const filterBtn = args.node.querySelector(".slick-header-filterbutton");
        if (filterBtn) {
            filterBtn.remove();
        }
    }

    // â”€â”€ Sort â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private updateSortIcon(columnId: string, sortState: SortProperties): void {
        const btn = this._columnSortButtonMapping.get(columnId);
        if (!btn) {
            return;
        }
        btn.classList.remove("sorted-asc", "sorted-desc");
        if (sortState === SortProperties.ASC) {
            btn.classList.add("sorted-asc");
        } else if (sortState === SortProperties.DESC) {
            btn.classList.add("sorted-desc");
        }
    }

    public async toggleSort(columnIndex: number): Promise<void> {
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

        // Cycle: NONE â†’ ASC â†’ DESC â†’ NONE
        let nextSort: SortProperties;
        if (currentSort === SortProperties.NONE) {
            nextSort = SortProperties.ASC;
        } else if (currentSort === SortProperties.ASC) {
            nextSort = SortProperties.DESC;
        } else {
            nextSort = SortProperties.NONE;
        }

        // Apply sort via data provider; bail out if the operation was rejected (e.g., threshold exceeded)
        const dataView = this._grid.getData();
        if (instanceOfIDisposableDataProvider<T>(dataView)) {
            if (nextSort === SortProperties.ASC || nextSort === SortProperties.DESC) {
                const sortApplied = await dataView.sort({
                    grid: this._grid,
                    multiColumnSort: false,
                    sortCol: column,
                    sortAsc: nextSort === SortProperties.ASC,
                });
                if (!sortApplied) {
                    return;
                }
                this._grid.setSortColumn(columnId, nextSort === SortProperties.ASC);
            } else {
                const resetApplied = await dataView.resetSort();
                if (!resetApplied) {
                    return;
                }
                this._grid.setSortColumn("", false);
            }
            this._grid.invalidateAllRows();
            this._grid.updateRowCount();
            this._grid.render();
        }

        // Clear previous sort column's state
        if (this._currentSortColumn && this._currentSortColumn !== columnId) {
            this._columnSortStateMapping.set(this._currentSortColumn, SortProperties.NONE);
            this.updateSortIcon(this._currentSortColumn, SortProperties.NONE);
        }

        this._columnSortStateMapping.set(columnId, nextSort);
        this._currentSortColumn = nextSort === SortProperties.NONE ? "" : columnId;

        this.updateSortIcon(columnId, nextSort);
        this.onSortChanged.notify(nextSort);
    }

    // â”€â”€ Filter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private updateFilterIcon(columnId: string, hasFilter: boolean): void {
        const btn = this._columnFilterButtonMapping.get(columnId);
        if (!btn) {
            return;
        }
        btn.classList.toggle("filtered", hasFilter);
    }

    private async showFilterPopup(
        anchorEl: HTMLElement,
        column: FilterableColumn<T>,
    ): Promise<void> {
        const columnId = column.id!;

        // Toggle off if same column
        if (this._activeColumnId === columnId) {
            this.dismissPopup();
            return;
        }
        this.dismissPopup();

        // Get unique column values from the data provider
        const dataView = this._grid.getData();
        let rawValues: FilterValue[] = [];
        if (instanceOfIDisposableDataProvider<T>(dataView)) {
            rawValues = (await dataView.getColumnValues(column)) as FilterValue[];
        }

        const items = this.buildFilterItems(rawValues);
        const currentFilterValues = new Set<FilterValue>(
            (column.filterValues ?? []) as FilterValue[],
        );

        const popup = this.createFilterPopup(items, currentFilterValues, column);

        // Position below the anchor button, clamped to viewport
        const rect = anchorEl.getBoundingClientRect();
        const popupWidth = 220;
        let left = rect.left;
        if (left + popupWidth > window.innerWidth - 8) {
            left = Math.max(8, rect.right - popupWidth);
        }
        popup.style.left = `${left}px`;
        popup.style.top = `${rect.bottom + 4}px`;

        document.body.appendChild(popup);
        this._activePopup = popup;
        this._activeColumnId = columnId;

        // Focus search input
        const searchInput = popup.querySelector<HTMLInputElement>(".nb-filter-search-input");
        searchInput?.focus();

        // Dismiss on outside click
        this._outsideClickHandler = (e: MouseEvent) => {
            if (!popup.contains(e.target as Node)) {
                this.dismissPopup();
            }
        };
        setTimeout(() => {
            if (this._outsideClickHandler) {
                document.addEventListener("mousedown", this._outsideClickHandler, true);
            }
        }, 0);

        // Dismiss on Escape
        this._escapeHandler = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                this.dismissPopup();
                this._grid.focus();
            }
        };
        document.addEventListener("keydown", this._escapeHandler);
    }

    private buildFilterItems(rawValues: FilterValue[]): FilterListItem[] {
        const uniqueValues = new Map<FilterValue, string>();
        for (const value of rawValues) {
            const normalized = value === null ? undefined : value;
            if (typeof normalized === "string" && normalized.indexOf("Error:") >= 0) {
                continue;
            }
            if (!uniqueValues.has(normalized)) {
                uniqueValues.set(normalized, this.getDisplayText(normalized));
            }
        }

        const nullEntries: FilterListItem[] = [];
        const blankEntries: FilterListItem[] = [];
        const otherEntries: FilterListItem[] = [];

        uniqueValues.forEach((displayText, value) => {
            const item = { value, displayText };
            if (value === undefined) {
                nullEntries.push(item);
            } else if (value === "") {
                blankEntries.push(item);
            } else {
                otherEntries.push(item);
            }
        });

        otherEntries.sort((a, b) => (a.displayText ?? "").localeCompare(b.displayText ?? ""));

        return [...nullEntries, ...blankEntries, ...otherEntries];
    }

    private getDisplayText(value: FilterValue): string {
        if (value === undefined || value === null) {
            return "NULL";
        }
        if (value === "") {
            return "(Blank)";
        }
        return String(value);
    }

    private createFilterPopup(
        items: FilterListItem[],
        initialSelected: Set<FilterValue>,
        column: FilterableColumn<T>,
    ): HTMLElement {
        const popup = document.createElement("div");
        popup.className = "nb-filter-popup";

        // Track selected values
        const selectedValues = new Set(initialSelected);
        let filteredItems = [...items];

        // â”€â”€ Title bar â”€â”€
        const titleBar = document.createElement("div");
        titleBar.className = "nb-filter-title-bar";
        const title = document.createElement("span");
        title.className = "nb-filter-title";
        title.textContent = "FILTER";
        const closeBtn = document.createElement("button");
        closeBtn.className = "nb-filter-close-btn";
        closeBtn.textContent = "\u00D7";
        closeBtn.title = "Close";
        closeBtn.addEventListener("click", () => this.dismissPopup());
        titleBar.appendChild(title);
        titleBar.appendChild(closeBtn);
        popup.appendChild(titleBar);

        // â”€â”€ Divider â”€â”€
        const divider = document.createElement("div");
        divider.className = "nb-filter-divider";
        popup.appendChild(divider);

        // â”€â”€ Search input â”€â”€
        const searchContainer = document.createElement("div");
        searchContainer.className = "nb-filter-search-container";
        const searchIcon = document.createElement("span");
        searchIcon.className = "nb-filter-search-icon";
        searchIcon.textContent = "\uD83D\uDD0D"; // ðŸ”
        const searchInput = document.createElement("input");
        searchInput.type = "text";
        searchInput.className = "nb-filter-search-input";
        searchInput.placeholder = "Search...";
        searchContainer.appendChild(searchIcon);
        searchContainer.appendChild(searchInput);
        popup.appendChild(searchContainer);

        // â”€â”€ Select All row â”€â”€
        const selectAllRow = document.createElement("div");
        selectAllRow.className = "nb-filter-select-all-row";
        const selectAllCheckbox = document.createElement("input");
        selectAllCheckbox.type = "checkbox";
        selectAllCheckbox.className = "nb-filter-checkbox";
        const selectAllLabel = document.createElement("span");
        selectAllLabel.textContent = "Select All";
        const selectedCount = document.createElement("span");
        selectedCount.className = "nb-filter-selected-count";
        selectAllRow.appendChild(selectAllCheckbox);
        selectAllRow.appendChild(selectAllLabel);
        selectAllRow.appendChild(selectedCount);
        popup.appendChild(selectAllRow);

        // â”€â”€ Scrollable checkbox list â”€â”€
        const listContainer = document.createElement("div");
        listContainer.className = "nb-filter-list";
        popup.appendChild(listContainer);

        // â”€â”€ Action buttons â”€â”€
        const actions = document.createElement("div");
        actions.className = "nb-filter-actions";
        const applyBtn = document.createElement("button");
        applyBtn.className = "nb-filter-apply-btn";
        applyBtn.textContent = "Apply";
        const clearBtn = document.createElement("button");
        clearBtn.className = "nb-filter-clear-btn";
        clearBtn.textContent = "Clear";
        actions.appendChild(applyBtn);
        actions.appendChild(clearBtn);
        popup.appendChild(actions);

        // â”€â”€ Render helpers â”€â”€

        const updateSelectedCount = () => {
            selectedCount.textContent = `${selectedValues.size} selected`;
        };

        const updateSelectAllState = () => {
            const visibleSelected = filteredItems.filter((item) =>
                selectedValues.has(item.value),
            ).length;
            selectAllCheckbox.checked =
                visibleSelected === filteredItems.length && filteredItems.length > 0;
            selectAllCheckbox.indeterminate =
                visibleSelected > 0 && visibleSelected < filteredItems.length;
            updateSelectedCount();
        };

        const renderItems = () => {
            listContainer.innerHTML = "";
            for (const item of filteredItems) {
                const row = document.createElement("div");
                row.className = "nb-filter-item";
                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.className = "nb-filter-checkbox";
                cb.checked = selectedValues.has(item.value);
                const label = document.createElement("span");
                label.className = "nb-filter-item-label";
                label.textContent = item.displayText;
                label.title = item.displayText;
                cb.addEventListener("change", () => {
                    if (cb.checked) {
                        selectedValues.add(item.value);
                    } else {
                        selectedValues.delete(item.value);
                    }
                    updateSelectAllState();
                });
                row.addEventListener("click", (e) => {
                    if (e.target !== cb) {
                        cb.checked = !cb.checked;
                        cb.dispatchEvent(new Event("change"));
                    }
                });
                row.appendChild(cb);
                row.appendChild(label);
                listContainer.appendChild(row);
            }
            updateSelectAllState();
        };

        // â”€â”€ Search â”€â”€
        searchInput.addEventListener("input", () => {
            const query = searchInput.value.trim().toLowerCase();
            if (!query) {
                filteredItems = [...items];
            } else {
                filteredItems = items.filter((item) =>
                    item.displayText.toLowerCase().includes(query),
                );
            }
            renderItems();
        });

        // â”€â”€ Select All â”€â”€
        selectAllCheckbox.addEventListener("change", () => {
            const shouldSelect = selectAllCheckbox.checked;
            for (const item of filteredItems) {
                if (shouldSelect) {
                    selectedValues.add(item.value);
                } else {
                    selectedValues.delete(item.value);
                }
            }
            renderItems();
        });

        // â”€â”€ Apply â”€â”€
        applyBtn.addEventListener("click", () => {
            void this.applyFilter(column, Array.from(selectedValues) as unknown as string[]);
            this.dismissPopup();
        });

        // â”€â”€ Clear â”€â”€
        clearBtn.addEventListener("click", () => {
            void this.applyFilter(column, []);
            this.dismissPopup();
        });

        // Initial render
        renderItems();

        return popup;
    }

    private async applyFilter(column: FilterableColumn<T>, selected: string[]): Promise<void> {
        const previousFilterValues = column.filterValues;
        column.filterValues = selected;
        const dataView = this._grid.getData();
        if (instanceOfIDisposableDataProvider<T>(dataView)) {
            const filterApplied = await dataView.filter(this._grid.getColumns());
            if (!filterApplied) {
                // Restore previous filter values since the operation was rejected
                column.filterValues = previousFilterValues;
                return;
            }
            this._grid.invalidateAllRows();
            this._grid.updateRowCount();
            this._grid.render();
        }
        this.updateFilterIcon(column.id!, selected.length > 0);
        this.onFilterApplied.notify({ grid: this._grid, column });
    }

    private dismissPopup(): void {
        if (this._activePopup) {
            this._activePopup.remove();
            this._activePopup = null;
        }
        if (this._outsideClickHandler) {
            document.removeEventListener("mousedown", this._outsideClickHandler, true);
            this._outsideClickHandler = null;
        }
        if (this._escapeHandler) {
            document.removeEventListener("keydown", this._escapeHandler);
            this._escapeHandler = null;
        }
        this._activeColumnId = null;
    }
}
