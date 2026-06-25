/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Context menu plugin for the notebook renderer grid.
 *
 * This is intentionally separate from QueryResult's ContextMenu because
 * the two share very little implementation:
 *  - QueryResult renders its menu via React (queryResultContext.showGridContextMenu)
 *    and delegates copy/format to the extension host via RPC, since it requires
 *    live SQL Tools Service result set IDs for server-side formatting;
 *  - The notebook renderer builds the menu with raw DOM and formats data
 *    client-side using in-memory row data, then writes via the clipboard API.
 *    (A renderer↔extension-host messaging channel exists via RendererContext
 *    but offers no advantage here since the data is already in memory.)
 */

import { locConstants } from "../../common/locConstants";
import { IDisposableDataProvider } from "../QueryResult/table/dataProvider";
import type { IDbColumn } from "../../../sharedInterfaces/queryResult";

/** Actions available in the notebook grid context menu. */
enum NotebookContextMenuAction {
    SelectAll = "select-all",
    CopySelection = "copy-selection",
    CopyWithHeaders = "copy-with-headers",
    CopyHeaders = "copy-headers",
    CopyAsCsv = "copy-as-csv",
    CopyAsJson = "copy-as-json",
    CopyAsInClause = "copy-as-in-clause",
    CopyAsInsertInto = "copy-as-insert-into",
}

export class NotebookContextMenu<T extends Slick.SlickData> {
    constructor(
        private readonly columnInfo: IDbColumn[] = [],
        private readonly postMessage?: (message: unknown) => void,
    ) {}

    private grid!: Slick.Grid<T>;
    private handler = new Slick.EventHandler();
    private menuElement: HTMLElement | null = null;
    private submenuElement: HTMLElement | null = null;
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

        // Dismiss on outside click (also allow clicks inside the submenu panel)
        this.dismissHandler = (evt: MouseEvent) => {
            const target = evt.target as Node;
            if (!menu.contains(target) && !this.submenuElement?.contains(target)) {
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
        if (this.submenuElement) {
            this.submenuElement.remove();
            this.submenuElement = null;
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
            locConstants.queryResult.selectAll,
            `${modKey}A`,
            NotebookContextMenuAction.SelectAll,
        );

        this.addSeparator(menu);

        this.addMenuItem(
            menu,
            locConstants.queryResult.copy,
            `${modKey}C`,
            NotebookContextMenuAction.CopySelection,
        );
        this.addMenuItem(
            menu,
            locConstants.queryResult.copyWithHeaders,
            undefined,
            NotebookContextMenuAction.CopyWithHeaders,
        );
        this.addMenuItem(
            menu,
            locConstants.queryResult.copyHeaders,
            undefined,
            NotebookContextMenuAction.CopyHeaders,
        );

        this.addSeparator(menu);

        this.addSubmenuItem(menu, locConstants.queryResult.copyAs, [
            {
                label: locConstants.queryResult.copyAsCsv,
                action: NotebookContextMenuAction.CopyAsCsv,
            },
            {
                label: locConstants.queryResult.copyAsJson,
                action: NotebookContextMenuAction.CopyAsJson,
            },
            {
                label: locConstants.queryResult.copyAsInsertInto,
                action: NotebookContextMenuAction.CopyAsInsertInto,
            },
            {
                label: locConstants.queryResult.copyAsInClause,
                action: NotebookContextMenuAction.CopyAsInClause,
            },
        ]);

        return menu;
    }

    private addSubmenuItem(
        parent: HTMLElement,
        label: string,
        subItems: Array<{ label: string; action: NotebookContextMenuAction }>,
    ): void {
        const item = document.createElement("div");
        item.className = "nb-context-menu-item";

        const labelSpan = document.createElement("span");
        labelSpan.className = "nb-context-menu-label";
        labelSpan.textContent = label;
        item.appendChild(labelSpan);

        const arrow = document.createElement("span");
        arrow.textContent = "›";
        item.appendChild(arrow);

        const submenu = document.createElement("div");
        submenu.className = "nb-context-menu";
        submenu.style.display = "none";

        for (const subItem of subItems) {
            const subMenuItem = document.createElement("div");
            subMenuItem.className = "nb-context-menu-item";
            const subLabelSpan = document.createElement("span");
            subLabelSpan.className = "nb-context-menu-label";
            subLabelSpan.textContent = subItem.label;
            subMenuItem.appendChild(subLabelSpan);
            subMenuItem.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.dismiss();
                void this.handleAction(subItem.action);
            });
            submenu.appendChild(subMenuItem);
        }

        document.body.appendChild(submenu);
        this.submenuElement = submenu;

        const showSubmenu = () => {
            const rect = item.getBoundingClientRect();
            submenu.style.display = "flex";
            submenu.style.flexDirection = "column";
            const submenuRect = submenu.getBoundingClientRect();
            let left = rect.right;
            if (left + submenuRect.width > window.innerWidth - 8) {
                left = rect.left - submenuRect.width;
            }
            submenu.style.left = `${left}px`;
            submenu.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - submenuRect.height - 8))}px`;
        };

        const hideSubmenu = (e: MouseEvent) => {
            if (
                !submenu.contains(e.relatedTarget as Node) &&
                !item.contains(e.relatedTarget as Node)
            ) {
                submenu.style.display = "none";
            }
        };

        item.addEventListener("mouseenter", showSubmenu);
        item.addEventListener("mouseleave", hideSubmenu);
        submenu.addEventListener("mouseleave", hideSubmenu);

        parent.appendChild(item);
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
            case NotebookContextMenuAction.CopyAsCsv:
                await this.copyToClipboard(this.formatAsCsv(ranges, columns, dataProvider));
                break;
            case NotebookContextMenuAction.CopyAsJson:
                await this.copyToClipboard(this.formatAsJson(ranges, columns, dataProvider));
                break;
            case NotebookContextMenuAction.CopyAsInClause: {
                const inClause = this.formatAsInClause(ranges, columns, dataProvider);
                if (inClause === null) {
                    this.showError(locConstants.queryResult.copyAsInClauseRequiresSingleColumn);
                } else {
                    await this.copyToClipboard(inClause);
                }
                break;
            }
            case NotebookContextMenuAction.CopyAsInsertInto:
                await this.copyToClipboard(this.formatAsInsertInto(ranges, columns, dataProvider));
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

    private formatAsCsv(
        ranges: Slick.Range[],
        columns: Slick.Column<T>[],
        dataProvider: IDisposableDataProvider<T>,
    ): string {
        const quote = (v: string): string => {
            if (v.includes('"') || v.includes(",") || v.includes("\n") || v.includes("\r")) {
                return '"' + v.replace(/"/g, '""') + '"';
            }
            return v;
        };
        const lines: string[] = [];
        for (const range of ranges) {
            const dataCols = this.getDataColumnsInRange(columns, range.fromCell, range.toCell);
            if (dataCols.length === 0) {
                continue;
            }
            lines.push(dataCols.map((c) => quote(c.toolTip ?? c.name ?? "")).join(","));
            for (let r = range.fromRow; r <= range.toRow; r++) {
                lines.push(
                    dataCols
                        .map((col) => quote(this.getCellDisplayValue(dataProvider, r, col.field!)))
                        .join(","),
                );
            }
        }
        return lines.join("\r\n");
    }

    private formatAsJson(
        ranges: Slick.Range[],
        columns: Slick.Column<T>[],
        dataProvider: IDisposableDataProvider<T>,
    ): string {
        const objects: Record<string, string | null>[] = [];
        for (const range of ranges) {
            const dataCols = this.getDataColumnsInRange(columns, range.fromCell, range.toCell);
            if (dataCols.length === 0) {
                continue;
            }
            for (let r = range.fromRow; r <= range.toRow; r++) {
                const obj: Record<string, string | null> = {};
                for (const col of dataCols) {
                    const item = dataProvider.getItem(r) as Slick.SlickData;
                    const cellVal = item?.[col.field!];
                    obj[col.toolTip ?? col.name ?? col.field!] = cellVal?.isNull
                        ? null
                        : (cellVal?.displayValue ?? null);
                }
                objects.push(obj);
            }
        }
        return JSON.stringify(objects, null, 2);
    }

    /** Returns null when more than one data column is selected (caller shows error). */
    private formatAsInClause(
        ranges: Slick.Range[],
        columns: Slick.Column<T>[],
        dataProvider: IDisposableDataProvider<T>,
    ): string | null {
        for (const range of ranges) {
            if (this.getDataColumnsInRange(columns, range.fromCell, range.toCell).length !== 1) {
                return null;
            }
        }

        const sqlStr = (v: string) => "'" + v.replace(/'/g, "''") + "'";
        const valueLines: string[] = [];

        for (const range of ranges) {
            const col = this.getDataColumnsInRange(columns, range.fromCell, range.toCell)[0];
            const colIndex = parseInt(col.field!, 10);
            const colInfo = !isNaN(colIndex) ? this.columnInfo[colIndex] : undefined;
            const isNumeric = this.isNumericSqlType(colInfo?.dataTypeName);

            for (let r = range.fromRow; r <= range.toRow; r++) {
                const item = dataProvider.getItem(r) as Slick.SlickData;
                const cellVal = item?.[col.field!];
                const val = cellVal?.isNull
                    ? "NULL"
                    : isNumeric
                      ? (cellVal?.displayValue ?? "")
                      : sqlStr(cellVal?.displayValue ?? "");
                valueLines.push(val);
            }
        }

        const lastIdx = valueLines.length - 1;
        const indented = valueLines.map((v, i) => `    ${v}${i < lastIdx ? "," : ""}`);
        return ["IN", "(", ...indented, ")"].join("\n");
    }

    private showError(message: string): void {
        if (this.postMessage) {
            this.postMessage({ type: "showError", message });
        }
    }

    private formatAsInsertInto(
        ranges: Slick.Range[],
        columns: Slick.Column<T>[],
        dataProvider: IDisposableDataProvider<T>,
    ): string {
        const sqlStr = (v: string) => "'" + v.replace(/'/g, "''") + "'";

        let dataCols: Slick.Column<T>[] = [];
        const valueRows: string[] = [];

        for (const range of ranges) {
            const rangeCols = this.getDataColumnsInRange(columns, range.fromCell, range.toCell);
            if (rangeCols.length === 0) {
                continue;
            }
            if (dataCols.length === 0) {
                dataCols = rangeCols;
            }
            for (let r = range.fromRow; r <= range.toRow; r++) {
                const values = dataCols.map((col) => {
                    const item = dataProvider.getItem(r) as Slick.SlickData;
                    const cellVal = item?.[col.field!];
                    if (cellVal?.isNull) {
                        return "NULL";
                    }
                    const val = cellVal?.displayValue ?? "";
                    const colIndex = parseInt(col.field!, 10);
                    const colInfo = !isNaN(colIndex) ? this.columnInfo[colIndex] : undefined;
                    return this.isNumericSqlType(colInfo?.dataTypeName) ? val : sqlStr(val);
                });
                valueRows.push(`    (${values.join(", ")})`);
            }
        }

        if (dataCols.length === 0 || valueRows.length === 0) {
            return "";
        }

        const colNames = dataCols.map((c) => c.toolTip ?? c.name ?? c.field ?? "").join(", ");
        const lastIdx = valueRows.length - 1;
        const rowLines = valueRows.map((row, i) => row + (i < lastIdx ? "," : ";"));

        return [`INSERT INTO table_name (${colNames})`, "VALUES", ...rowLines].join("\n");
    }

    private isNumericSqlType(dataTypeName: string | undefined): boolean {
        if (!dataTypeName) {
            return false;
        }
        const numericTypes = new Set([
            "int",
            "bigint",
            "smallint",
            "tinyint",
            "decimal",
            "numeric",
            "float",
            "real",
            "money",
            "smallmoney",
            "bit",
        ]);
        return numericTypes.has(dataTypeName.toLowerCase());
    }
}
