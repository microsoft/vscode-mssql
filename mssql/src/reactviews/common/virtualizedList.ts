/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode } from "./keys";
import { EventManager } from "./eventManager";

const defaultConfig = {
    itemHeight: 20,
    buffer: 5,
};

export class VirtualizedList<T> {
    private _listId: string = window.crypto.randomUUID();
    private _visibleCount: number;
    private _scrollOffset: number;
    private _eventManager: EventManager = new EventManager();
    private _focusedItemIndex: number = 0;
    constructor(
        private _container: HTMLElement,
        private _items: T[],
        private _renderItem: (itemContainer: HTMLElement, item: T) => void,
        private _itemSelected: (itemContainer: HTMLElement, item: T) => void,
        private _config: VirtualizedListConfig,
    ) {
        this._config = { ...defaultConfig, ..._config };
        this._visibleCount =
            Math.ceil(_container.clientHeight / _config.itemHeight) + _config.buffer;
        this._scrollOffset = 0;
        this.init();
    }

    private init() {
        // Set container styles
        this._container.style.overflowY = "auto";
        this._container.style.position = "relative";
        this._container.style.height = `${this._visibleCount * this._config.itemHeight}px`;

        // Set total height to create the scroll effect
        const totalHeight = this._items.length * this._config.itemHeight;
        const spacer = document.createElement("div");
        spacer.style.height = `${totalHeight}px`;
        spacer.style.position = "relative";
        this._container.appendChild(spacer);

        // Set up scroll listener
        this._eventManager.addEventListener(this._container, "scroll", () => this.onScroll());

        // Reset focused item index
        this._focusedItemIndex = 0;

        // Render initial items
        this.renderList();
    }

    private scrollToIndex(index: number) {
        const itemTop = index * this._config.itemHeight;
        const itemBottom = itemTop + this._config.itemHeight;

        if (itemTop < this._container.scrollTop) {
            this._container.scrollTop = itemTop;
        } else if (itemBottom > this._container.scrollTop + this._container.clientHeight) {
            this._container.scrollTop = itemBottom - this._container.clientHeight;
        }
    }

    private updateFocusedItemIndex(newIndex: number) {
        if (newIndex < 0 || newIndex >= this._items.length) {
            return;
        }
        const oldItem = document.getElementById(`${this._listId}-${this._focusedItemIndex}`);
        if (oldItem) {
            oldItem.setAttribute("tabindex", "-1");
        }
        const newItem = document.getElementById(`${this._listId}-${newIndex}`);
        if (newItem) {
            newItem.setAttribute("tabindex", "0");
        }

        this._focusedItemIndex = newIndex;
        this.scrollToIndex(newIndex);
        newItem?.focus();
    }

    private onScroll() {
        const newOffset = Math.floor(this._container.scrollTop / this._config.itemHeight);
        if (newOffset !== this._scrollOffset) {
            this._scrollOffset = newOffset;
            this.renderList();
        }
    }

    private renderList() {
        const startIndex = Math.max(this._scrollOffset - this._config.buffer, 0);
        const endIndex = Math.min(
            this._scrollOffset + this._visibleCount + this._config.buffer,
            this._items.length,
        );
        // Remove existing visible items
        Array.from(this._container.children)
            .filter((child) => child.tagName === "DIV" && child !== this._container.firstChild)
            .forEach((child) => this._container.removeChild(child));

        for (let i = startIndex; i < endIndex; i++) {
            const item = this._items[i];
            const itemDiv = document.createElement("div");
            itemDiv.id = `${this._listId}-${i}`;
            this._renderItem(itemDiv, item);
            itemDiv.style.position = "absolute";
            itemDiv.style.height = `${this._config.itemHeight}px`;
            itemDiv.style.width = "100%";
            itemDiv.style.top = `${i * this._config.itemHeight}px`;
            this._container.appendChild(itemDiv);
            itemDiv.setAttribute("tabindex", i === this._focusedItemIndex ? "0" : "-1");

            // Set up click listener
            this._eventManager.addEventListener(itemDiv, "click", (e) => {
                if (!(e.target instanceof HTMLInputElement)) {
                    this.updateFocusedItemIndex(i);
                    this._itemSelected(itemDiv, item);
                    e.preventDefault();
                }
                e.stopPropagation();
            });

            this._eventManager.addEventListener(itemDiv, "keydown", (e) => {
                const event = e as KeyboardEvent;
                let handled = false;
                if (event.code === KeyCode.ArrowDown) {
                    this.updateFocusedItemIndex(i + 1);
                    handled = true;
                } else if (event.code === KeyCode.ArrowUp) {
                    this.updateFocusedItemIndex(i - 1);
                    handled = true;
                } else if (event.code === KeyCode.Enter || event.code === KeyCode.Space) {
                    this._itemSelected(itemDiv, item);
                    handled = true;
                }
                if (handled) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            });
        }
    }

    public updateItems(items: T[]) {
        this._container.scrollTop = 0;
        this._container.innerHTML = "";
        this._items = items;
        this.init();
    }

    public dispose() {
        this._eventManager.clearEventListeners();
        this._container.innerHTML = "";
    }
}

export interface VirtualizedListConfig {
    itemHeight: number;
    buffer: number;
}
