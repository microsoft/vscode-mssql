/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Context menu plugin for the notebook renderer grid.
 * Shows a right-click menu with copy operations, all handled locally
 * using the clipboard API (no extension host RPC).
 */

import * as l10n from "@vscode/l10n";
import { IDisposableDataProvider } from "../QueryResult/table/dataProvider";

/** Actions available in the notebook grid context menu. */
enum NotebookContextMenuAction {
    SelectAll = "select-all",
    CopySelection = "copy-selection",
    CopyWithHeaders = "copy-with-headers",
    CopyHeaders = "copy-headers",
}

export class NotebookContextMenu<T extends Slick.SlickData> {
    private grid!: Slick.Grid<T>;
    private handler = new Slick.EventHandler();
    private menuElement: HTMLElement | null = null;
    private dismissHandler: ((e: MouseEvent) => void) | null = null;
    private escapeHandler: ((e: KeyboardEvent) => void) | null = null;
    private scrollHandler: (() => void) | null = null;

    public init(grid: Slick.Grid<T>): void {
        this.grid = grid;
        this.handler.subscribe(this.grid.onContextMenu, (e: Event) => this.handleContextMenu(e));
        this.handler.subscribe(this.grid.onHeaderClick, () => this.dismiss());
    }

    public destroy(): void {
        this.handler.unsubscribeAll();
        this.dismiss();
    }

    // ── Menu display ─────────────────────────────────────────────────

    private handleContextMenu(e: Event): void {
        e.preventDefault();
        e.stopPropagation();
        this.dismiss();

        const mouseEvent = e as MouseEvent;
        const menu = this.buildMenu();
        document.body.appendChild(menu);
        this.menuElement = menu;

        // Position with viewport awareness
        const margin = 8;
        const menuRect = menu.getBoundingClientRect();
        const maxX = Math.max(margin, window.innerWidth - menuRect.width - margin);
        const maxY = Math.max(margin, window.innerHeight - menuRect.height - margin);
        const x = Math.min(Math.max(mouseEvent.pageX, margin), maxX);
        const y = Math.min(Math.max(mouseEvent.pageY, margin), maxY);

        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        // Dismiss on outside click
        this.dismissHandler = (evt: MouseEvent) => {
            if (!menu.contains(evt.target as Node)) {
                this.dismiss();
            }
        };
        // Use setTimeout so the current right-click event doesn't immediately dismiss
        setTimeout(() => {
            document.addEventListener("mousedown", this.dismissHandler!);
        }, 0);

        // Dismiss on Escape
        this.escapeHandler = (evt: KeyboardEvent) => {
            if (evt.key === "Escape") {
                this.dismiss();
            }
        };
        document.addEventListener("keydown", this.escapeHandler);

        // Dismiss on scroll
        this.scrollHandler = () => this.dismiss();
        this.grid.getCanvasNode().addEventListener("scroll", this.scrollHandler);
    }

    private dismiss(): void {
        if (this.menuElement) {
            this.menuElement.remove();
            this.menuElement = null;
        }
        if (this.dismissHandler) {
            document.removeEventListener("mousedown", this.dismissHandler);
            this.dismissHandler = null;
        }
        if (this.escapeHandler) {
            document.removeEventListener("keydown", this.escapeHandler);
            this.escapeHandler = null;
        }
        if (this.scrollHandler) {
            this.grid?.getCanvasNode()?.removeEventListener("scroll", this.scrollHandler);
            this.scrollHandler = null;
        }
    }

    // ── Menu construction ────────────────────────────────────────────

    private buildMenu(): HTMLElement {
        const menu = document.createElement("div");
        menu.className = "nb-context-menu";

        const isMac =
            typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
        const modKey = isMac ? "\u2318" : "Ctrl+";

        this.addMenuItem(
            menu,
            l10n.t("Select All"),
            `${modKey}A`,
            NotebookContextMenuAction.SelectAll,
        );

        this.addSeparator(menu);

        this.addMenuItem(
            menu,
            l10n.t("Copy"),
            `${modKey}C`,
            NotebookContextMenuAction.CopySelection,
        );
        this.addMenuItem(
            menu,
            l10n.t("Copy with Headers"),
            undefined,
            NotebookContextMenuAction.CopyWithHeaders,
        );
        this.addMenuItem(
            menu,
            l10n.t("Copy Headers"),
            undefined,
            NotebookContextMenuAction.CopyHeaders,
        );

        return menu;
    }

    private addMenuItem(
        parent: HTMLElement,
        label: string,
        shortcut: string | undefined,
        action: NotebookContextMenuAction,
    ): void {
        const item = document.createElement("div");
        item.className = "nb-context-menu-item";

        const labelSpan = document.createElement("span");
        labelSpan.className = "nb-context-menu-label";
        labelSpan.textContent = label;
        item.appendChild(labelSpan);

        if (shortcut) {
            const shortcutSpan = document.createElement("span");
            shortcutSpan.className = "nb-context-menu-shortcut";
            shortcutSpan.textContent = shortcut;
            item.appendChild(shortcutSpan);
        }

        item.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.dismiss();
            void this.handleAction(action);
        });

        parent.appendChild(item);
    }

    private addSeparator(parent: HTMLElement): void {
        const sep = document.createElement("div");
        sep.className = "nb-context-menu-separator";
        parent.appendChild(sep);
    }

    // ── Actions ──────────────────────────────────────────────────────

    private async handleAction(action: NotebookContextMenuAction): Promise<void> {
        const { ranges, columns, dataProvider } = this.getSelectionContext();

        switch (action) {
            case NotebookContextMenuAction.SelectAll: {
                const selModel = this.grid.getSelectionModel();
                const colCount = this.grid.getColumns().length;
                const rowCount = dataProvider.getLength();
                selModel.setSelectedRanges([new Slick.Range(0, 0, rowCount - 1, colCount - 1)]);
                break;
            }
            case NotebookContextMenuAction.CopySelection:
                await this.copyToClipboard(
                    this.formatTabSeparated(ranges, columns, dataProvider, false),
                );
                break;
            case NotebookContextMenuAction.CopyWithHeaders:
                await this.copyToClipboard(
                    this.formatTabSeparated(ranges, columns, dataProvider, true),
                );
                break;
            case NotebookContextMenuAction.CopyHeaders:
                await this.copyToClipboard(this.formatHeaders(ranges, columns));
                break;
        }
    }

    private getSelectionContext(): {
        ranges: Slick.Range[];
        columns: Slick.Column<T>[];
        dataProvider: IDisposableDataProvider<T>;
    } {
        const selModel = this.grid.getSelectionModel();
        let ranges = selModel?.getSelectedRanges() ?? [];

        // If no selection, select the entire grid
        if (ranges.length === 0) {
            const colCount = this.grid.getColumns().length;
            const rowCount = (this.grid.getData() as IDisposableDataProvider<T>).getLength();
            ranges = [new Slick.Range(0, 0, rowCount - 1, colCount - 1)];
        }

        return {
            ranges,
            columns: this.grid.getColumns(),
            dataProvider: this.grid.getData() as IDisposableDataProvider<T>,
        };
    }

    /** Get data columns (excluding rowNumber) within the given cell range. */
    private getDataColumnsInRange(
        columns: Slick.Column<T>[],
        fromCell: number,
        toCell: number,
    ): Slick.Column<T>[] {
        const result: Slick.Column<T>[] = [];
        for (let c = fromCell; c <= toCell; c++) {
            const col = columns[c];
            if (col?.id !== "rowNumber" && col?.field) {
                result.push(col);
            }
        }
        return result;
    }

    private getCellDisplayValue(
        dataProvider: IDisposableDataProvider<T>,
        row: number,
        field: string,
    ): string {
        const item = dataProvider.getItem(row) as Slick.SlickData;
        const cellVal = item?.[field];
        if (!cellVal) {
            return "";
        }
        return cellVal.isNull ? "NULL" : (cellVal.displayValue ?? "");
    }

    private async copyToClipboard(text: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            // Fallback: execCommand for environments where clipboard API is restricted
            const textarea = document.createElement("textarea");
            textarea.value = text;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand("copy");
            document.body.removeChild(textarea);
        }
    }

    // ── Formatters ───────────────────────────────────────────────────

    private formatTabSeparated(
        ranges: Slick.Range[],
        columns: Slick.Column<T>[],
        dataProvider: IDisposableDataProvider<T>,
        includeHeaders: boolean,
    ): string {
        const lines: string[] = [];

        for (const range of ranges) {
            const dataCols = this.getDataColumnsInRange(columns, range.fromCell, range.toCell);
            if (dataCols.length === 0) {
                continue;
            }

            if (includeHeaders) {
                lines.push(dataCols.map((c) => c.name ?? "").join("\t"));
            }

            for (let r = range.fromRow; r <= range.toRow; r++) {
                const values = dataCols.map((col) =>
                    this.getCellDisplayValue(dataProvider, r, col.field!),
                );
                lines.push(values.join("\t"));
            }
        }
        return lines.join("\n");
    }

    private formatHeaders(ranges: Slick.Range[], columns: Slick.Column<T>[]): string {
        const headers: string[] = [];
        for (const range of ranges) {
            const dataCols = this.getDataColumnsInRange(columns, range.fromCell, range.toCell);
            headers.push(dataCols.map((c) => c.name ?? "").join("\t"));
        }
        return headers.join("\n");
    }
}
