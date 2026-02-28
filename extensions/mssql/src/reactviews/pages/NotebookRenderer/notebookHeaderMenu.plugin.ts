/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Simplified header filter/sort plugin for the notebook renderer.
 * Similar to HeaderMenu but without RPC dependencies or Fluent UI.
 * Uses inline SVG icons with currentColor for automatic theme adaptation.
 * Renders filter popups as plain DOM elements.
 */

import { instanceOfIDisposableDataProvider } from "../QueryResult/table/dataProvider";
import { FilterableColumn } from "../QueryResult/table/interfaces";
import { SortProperties } from "../../../sharedInterfaces/queryResult";

// Inline SVG icons — fill="currentColor" inherits the header text color for automatic theme support.
const SORT_ICON = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M4.85355 2.14645C4.65829 1.95118 4.34171 1.95118 4.14645 2.14645L1.14645 5.14645C0.951184 5.34171 0.951184 5.65829 1.14645 5.85355C1.34171 6.04882 1.65829 6.04882 1.85355 5.85355L4 3.70711V13.5C4 13.7761 4.22386 14 4.5 14C4.77614 14 5 13.7761 5 13.5V3.70711L7.14645 5.85355C7.34171 6.04882 7.65829 6.04882 7.85355 5.85355C8.04882 5.65829 8.04882 5.34171 7.85355 5.14645L4.85355 2.14645ZM11.1525 13.8595C11.3463 14.0468 11.6537 14.0468 11.8475 13.8595L14.8475 10.9594C15.0461 10.7675 15.0514 10.4509 14.8595 10.2524C14.6676 10.0538 14.351 10.0485 14.1525 10.2404L12 12.3212L12 2.5001C12 2.22395 11.7761 2.0001 11.5 2.0001C11.2239 2.0001 11 2.22395 11 2.5001L11 12.3212L8.84752 10.2404C8.64898 10.0485 8.33244 10.0538 8.14051 10.2524C7.94858 10.4509 7.95394 10.7675 8.15248 10.9594L11.1525 13.8595Z"/></svg>`;

const SORT_ASC_ICON = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M7.14645 2.14645C7.34171 1.95118 7.65829 1.95118 7.85355 2.14645L10.8536 5.14645C11.0488 5.34171 11.0488 5.65829 10.8536 5.85355C10.6583 6.04882 10.3417 6.04882 10.1464 5.85355L8 3.70711V13.5C8 13.7761 7.77614 14 7.5 14C7.22386 14 7 13.7761 7 13.5V3.70711L4.85355 5.85355C4.65829 6.04882 4.34171 6.04882 4.14645 5.85355C3.95118 5.65829 3.95118 5.34171 4.14645 5.14645L7.14645 2.14645Z"/></svg>`;

const SORT_DESC_ICON = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M7.14645 13.8536C7.34171 14.0488 7.65829 14.0488 7.85355 13.8536L10.8536 10.8536C11.0488 10.6583 11.0488 10.3417 10.8536 10.1464C10.6583 9.95118 10.3417 9.95118 10.1464 10.1464L8 12.2929V2.5C8 2.22386 7.77614 2 7.5 2C7.22386 2 7 2.22386 7 2.5V12.2929L4.85355 10.1464C4.65829 9.95118 4.34171 9.95118 4.14645 10.1464C3.95118 10.3417 3.95118 10.6583 4.14645 10.8536L7.14645 13.8536Z"/></svg>`;

const FILTER_ICON = `<svg width="14" height="14" viewBox="0 0 2048 2048" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M0 320q0-40 15-75t41-61 61-41 75-15h1664q40 0 75 15t61 41 41 61 15 75q0 82-60 139l-648 618q-14 14-25 30t-19 33q-16 35-16 76v768q0 26-19 45t-45 19q-19 0-35-11l-384-256q-29-19-29-53v-512q0-40-15-76-8-18-19-33t-26-30L60 459Q0 402 0 320zm1920-1q0-26-19-44t-45-19H192q-26 0-45 18t-19 45q0 29 20 47l649 618q47 45 73 106t26 126v478l256 170v-648q0-65 26-126t73-106l649-618q20-18 20-47z"/></svg>`;

const FILTER_FILLED_ICON = `<svg width="14" height="14" viewBox="0 0 2048 2048" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M0 320q0-40 15-75t41-61 61-41 75-15h1664q40 0 75 15t61 41 41 61 15 75q0 82-60 139l-648 618q-14 14-25 29t-20 34q-15 36-15 76v768q0 26-19 45t-45 19q-19 0-35-11l-384-256q-13-8-21-22t-8-31v-512q0-40-15-76-8-18-19-33t-26-30L60 459Q0 402 0 320z"/></svg>`;

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

    // ── Header Cell Rendering ──────────────────────────────────────────

    private onHeaderCellRendered(_e: Event, args: Slick.OnHeaderCellRenderedEventArgs<T>): void {
        const column = args.column as FilterableColumn<T>;
        if (column.filterable === false) {
            return;
        }
        if (args.node.classList.contains("slick-header-with-filter")) {
            return;
        }

        args.node.classList.add("slick-header-with-filter");

        // Sort button
        const sortBtn = document.createElement("button");
        sortBtn.className = "nb-sort-button";
        sortBtn.innerHTML = SORT_ICON;
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

        // Filter button
        const filterBtn = document.createElement("button");
        filterBtn.className = "nb-filter-button";
        filterBtn.innerHTML = FILTER_ICON;
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
        const sortBtn = args.node.querySelector(".nb-sort-button");
        if (sortBtn) {
            sortBtn.remove();
        }
        const filterBtn = args.node.querySelector(".nb-filter-button");
        if (filterBtn) {
            filterBtn.remove();
        }
    }

    // ── Sort ───────────────────────────────────────────────────────────

    private updateSortIcon(columnId: string, sortState: SortProperties): void {
        const btn = this._columnSortButtonMapping.get(columnId);
        if (!btn) {
            return;
        }
        switch (sortState) {
            case SortProperties.ASC:
                btn.innerHTML = SORT_ASC_ICON;
                break;
            case SortProperties.DESC:
                btn.innerHTML = SORT_DESC_ICON;
                break;
            default:
                btn.innerHTML = SORT_ICON;
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

        // Cycle: NONE → ASC → DESC → NONE
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

    // ── Filter ─────────────────────────────────────────────────────────

    private updateFilterIcon(columnId: string, hasFilter: boolean): void {
        const btn = this._columnFilterButtonMapping.get(columnId);
        if (!btn) {
            return;
        }
        btn.innerHTML = hasFilter ? FILTER_FILLED_ICON : FILTER_ICON;
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

        // ── Title bar ──
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

        // ── Divider ──
        const divider = document.createElement("div");
        divider.className = "nb-filter-divider";
        popup.appendChild(divider);

        // ── Search input ──
        const searchContainer = document.createElement("div");
        searchContainer.className = "nb-filter-search-container";
        const searchIcon = document.createElement("span");
        searchIcon.className = "nb-filter-search-icon";
        searchIcon.textContent = "\uD83D\uDD0D"; // 🔍
        const searchInput = document.createElement("input");
        searchInput.type = "text";
        searchInput.className = "nb-filter-search-input";
        searchInput.placeholder = "Search...";
        searchContainer.appendChild(searchIcon);
        searchContainer.appendChild(searchInput);
        popup.appendChild(searchContainer);

        // ── Select All row ──
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

        // ── Scrollable checkbox list ──
        const listContainer = document.createElement("div");
        listContainer.className = "nb-filter-list";
        popup.appendChild(listContainer);

        // ── Action buttons ──
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

        // ── Render helpers ──

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

        // ── Search ──
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

        // ── Select All ──
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

        // ── Apply ──
        applyBtn.addEventListener("click", () => {
            void this.applyFilter(column, Array.from(selectedValues) as unknown as string[]);
            this.dismissPopup();
        });

        // ── Clear ──
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
