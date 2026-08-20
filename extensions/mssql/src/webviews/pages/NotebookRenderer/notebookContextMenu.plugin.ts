/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { locConstants } from "../../common/locConstants";
import { IDisposableDataProvider } from "../QueryResult/table/dataProvider";
import type { IDbColumn } from "../../../sharedInterfaces/queryResult";
import type { NotebookCopyAsCsvOptions } from "../../../sharedInterfaces/notebookQueryResult";
import { getEOL, isMac } from "../../common/utils";

const getModKeyLabel = () => (isMac() ? "⌘" : "Ctrl+");

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
    private static readonly NUMERIC_SQL_TYPES = new Set([
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

    private static readonly JSON_NUMBER_TYPES = new Set([
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
    ]);
    private static readonly JSON_NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
    private static readonly SQL_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
    private static readonly INSERT_ROW_LIMIT = 1000;

    constructor(
        private readonly columnInfo: IDbColumn[] = [],
        private readonly copyAsCsvOptions?: NotebookCopyAsCsvOptions,
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
        this.handler.subscribe(this.grid.onClick, () => {
            if (this.menuElement) this.dismiss();
        });
    }

    public destroy(): void {
        this.handler.unsubscribeAll();
        this.dismiss();
    }

    private handleContextMenu(e: Event): void {
        e.preventDefault();
        e.stopPropagation();
        this.dismiss();

        const mouseEvent = e as MouseEvent;
        const { menu, showSubmenu } = this.buildMenu();
        menu.setAttribute("role", "menu");
        document.body.appendChild(menu);
        this.menuElement = menu;

        const margin = 8;
        const menuRect = menu.getBoundingClientRect();
        const maxX = Math.max(margin, window.innerWidth - menuRect.width - margin);
        const maxY = Math.max(margin, window.innerHeight - menuRect.height - margin);
        const x = Math.min(Math.max(mouseEvent.pageX, margin), maxX);
        const y = Math.min(Math.max(mouseEvent.pageY, margin), maxY);

        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        menu.tabIndex = -1;
        let focusedIdx = -1;
        const menuItems = Array.from(menu.querySelectorAll<HTMLElement>(".nb-context-menu-item"));
        const setMenuFocus = (next: number) => {
            menuItems[focusedIdx]?.classList.remove("nb-context-menu-item--focused");
            focusedIdx = (next + menuItems.length) % menuItems.length;
            menuItems[focusedIdx]?.classList.add("nb-context-menu-item--focused");
            menuItems[focusedIdx]?.focus();
        };

        menu.addEventListener("keydown", (evt: KeyboardEvent) => {
            switch (evt.key) {
                case "ArrowDown":
                    evt.preventDefault();
                    evt.stopPropagation();
                    setMenuFocus(focusedIdx + 1);
                    break;
                case "ArrowUp":
                    evt.preventDefault();
                    evt.stopPropagation();
                    setMenuFocus(focusedIdx < 0 ? menuItems.length - 1 : focusedIdx - 1);
                    break;
                case "ArrowRight":
                    if (focusedIdx >= 0 && menuItems[focusedIdx]?.dataset.hasSubmenu) {
                        evt.preventDefault();
                        evt.stopPropagation();
                        showSubmenu();
                    }
                    break;
                case "Enter":
                case " ":
                    evt.preventDefault();
                    evt.stopPropagation();
                    if (menuItems[focusedIdx]?.dataset.hasSubmenu) {
                        showSubmenu();
                    } else {
                        menuItems[focusedIdx]?.click();
                    }
                    break;
            }
        });

        const dismissHandler = (evt: MouseEvent) => {
            const target = evt.target as Node;
            if (!menu.contains(target) && !this.submenuElement?.contains(target)) {
                this.dismiss();
            }
        };
        this.dismissHandler = dismissHandler;

        // Wait until the current context-menu event has finished before listening for dismissal.
        queueMicrotask(() => {
            if (this.dismissHandler !== dismissHandler) {
                return;
            }
            setMenuFocus(0);
            document.addEventListener("mousedown", dismissHandler);
        });

        this.escapeHandler = (evt: KeyboardEvent) => {
            if (evt.key === "Escape") this.dismiss();
        };
        document.addEventListener("keydown", this.escapeHandler);

        this.scrollHandler = () => this.dismiss();
        this.grid.getCanvasNode().addEventListener("scroll", this.scrollHandler);
    }

    private dismiss(): void {
        const shouldRestoreGridFocus = this.menuElement !== null;
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
        if (shouldRestoreGridFocus) {
            this.grid.focus();
        }
    }

    private buildMenu(): { menu: HTMLElement; showSubmenu: () => void } {
        const menu = document.createElement("div");
        menu.className = "nb-context-menu";

        this.addMenuItem(
            menu,
            locConstants.queryResult.selectAll,
            `${getModKeyLabel()}A`,
            NotebookContextMenuAction.SelectAll,
        );

        this.addSeparator(menu);

        this.addMenuItem(
            menu,
            locConstants.queryResult.copy,
            `${getModKeyLabel()}C`,
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

        const showSubmenu = this.addSubmenuItem(menu, locConstants.queryResult.copyAs, [
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

        return { menu, showSubmenu };
    }

    private addSubmenuItem(
        parent: HTMLElement,
        label: string,
        subItems: Array<{ label: string; action: NotebookContextMenuAction }>,
    ): () => void {
        const item = document.createElement("div");
        item.className = "nb-context-menu-item";
        item.dataset.hasSubmenu = "true";
        item.tabIndex = -1;
        item.setAttribute("role", "menuitem");
        item.setAttribute("aria-haspopup", "menu");
        item.setAttribute("aria-expanded", "false");

        const labelSpan = document.createElement("span");
        labelSpan.className = "nb-context-menu-label";
        labelSpan.textContent = label;
        item.appendChild(labelSpan);

        const submenu = document.createElement("div");
        submenu.className = "nb-context-menu";
        submenu.setAttribute("role", "menu");
        submenu.style.display = "none";
        submenu.style.flexDirection = "column";
        submenu.tabIndex = -1;

        const submenuItems: HTMLElement[] = [];
        for (const subItem of subItems) {
            submenuItems.push(this.addMenuItem(submenu, subItem.label, undefined, subItem.action));
        }

        document.body.appendChild(submenu);
        this.submenuElement = submenu;

        let submenuFocusedIdx = -1;

        const clearFocus = () => {
            if (submenuFocusedIdx >= 0) {
                submenuItems[submenuFocusedIdx]?.classList.remove("nb-context-menu-item--focused");
                submenuFocusedIdx = -1;
            }
        };

        const setSubmenuFocus = (next: number) => {
            submenuItems[submenuFocusedIdx]?.classList.remove("nb-context-menu-item--focused");
            submenuFocusedIdx = (next + submenuItems.length) % submenuItems.length;
            submenuItems[submenuFocusedIdx]?.classList.add("nb-context-menu-item--focused");
            submenuItems[submenuFocusedIdx]?.focus();
        };

        const positionSubmenu = () => {
            const rect = item.getBoundingClientRect();
            submenu.style.visibility = "hidden";
            submenu.style.display = "flex";
            const submenuRect = submenu.getBoundingClientRect();
            let left = rect.right;
            if (left + submenuRect.width > window.innerWidth - 8) {
                left = rect.left - submenuRect.width;
            }
            submenu.style.left = `${left}px`;
            submenu.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - submenuRect.height - 8))}px`;
            submenu.style.visibility = "";
            item.setAttribute("aria-expanded", "true");
        };

        const show = () => {
            positionSubmenu();
            setSubmenuFocus(0);
        };

        const hideSubmenu = (e: MouseEvent) => {
            if (
                !submenu.contains(e.relatedTarget as Node) &&
                !item.contains(e.relatedTarget as Node)
            ) {
                submenu.style.display = "none";
                item.setAttribute("aria-expanded", "false");
                clearFocus();
            }
        };

        item.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            show();
        });
        item.addEventListener("mouseenter", positionSubmenu);
        item.addEventListener("mouseleave", hideSubmenu);
        submenu.addEventListener("mouseleave", hideSubmenu);

        submenu.addEventListener("keydown", (evt: KeyboardEvent) => {
            switch (evt.key) {
                case "ArrowDown":
                    evt.preventDefault();
                    evt.stopPropagation();
                    setSubmenuFocus(submenuFocusedIdx + 1);
                    break;
                case "ArrowUp":
                    evt.preventDefault();
                    evt.stopPropagation();
                    setSubmenuFocus(
                        submenuFocusedIdx < 0 ? submenuItems.length - 1 : submenuFocusedIdx - 1,
                    );
                    break;
                case "ArrowLeft":
                case "Escape":
                    evt.preventDefault();
                    evt.stopPropagation();
                    submenu.style.display = "none";
                    item.setAttribute("aria-expanded", "false");
                    clearFocus();
                    item.focus();
                    break;
                case "Enter":
                case " ":
                    evt.preventDefault();
                    evt.stopPropagation();
                    if (submenuFocusedIdx >= 0) submenuItems[submenuFocusedIdx]?.click();
                    break;
            }
        });

        parent.appendChild(item);
        return show;
    }

    private addMenuItem(
        parent: HTMLElement,
        label: string,
        shortcut: string | undefined,
        action: NotebookContextMenuAction,
    ): HTMLElement {
        const item = document.createElement("div");
        item.className = "nb-context-menu-item";
        item.tabIndex = -1;
        item.setAttribute("role", "menuitem");

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
        return item;
    }

    private addSeparator(parent: HTMLElement): void {
        const sep = document.createElement("div");
        sep.className = "nb-context-menu-separator";
        sep.setAttribute("role", "separator");
        parent.appendChild(sep);
    }

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

    private getSelectedColumnIndices(ranges: Slick.Range[], columns: Slick.Column<T>[]): number[] {
        const selected = new Set<number>();
        for (const range of ranges) {
            for (let c = range.fromCell; c <= range.toCell; c++) {
                const col = columns[c];
                if (col?.id !== "rowNumber" && col?.field) {
                    selected.add(c);
                }
            }
        }
        return [...selected].sort((a, b) => a - b);
    }

    private isCellSelected(ranges: Slick.Range[], row: number, colIndex: number): boolean {
        return ranges.some(
            (rng) =>
                row >= rng.fromRow &&
                row <= rng.toRow &&
                colIndex >= rng.fromCell &&
                colIndex <= rng.toCell,
        );
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

    private getColumnInfo(col: Slick.Column<T>): IDbColumn | undefined {
        const colIndex = parseInt(col.field!, 10);
        return !isNaN(colIndex) ? this.columnInfo[colIndex] : undefined;
    }

    private async copyToClipboard(text: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
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
        return lines.join(getEOL());
    }

    private formatHeaders(ranges: Slick.Range[], columns: Slick.Column<T>[]): string {
        const headers: string[] = [];
        for (const range of ranges) {
            const dataCols = this.getDataColumnsInRange(columns, range.fromCell, range.toCell);
            headers.push(dataCols.map((c) => c.name ?? "").join("\t"));
        }
        return headers.join(getEOL());
    }

    public formatAsCsv(
        ranges: Slick.Range[],
        columns: Slick.Column<T>[],
        dataProvider: IDisposableDataProvider<T>,
    ): string {
        const {
            delimiter = ",",
            includeHeaders = true,
            lineSeparator = getEOL(),
            textIdentifier = '"',
        } = this.copyAsCsvOptions ?? {};
        const quote = (v: string): string => {
            if (
                v.includes(textIdentifier) ||
                v.includes(delimiter) ||
                v.includes("\n") ||
                v.includes("\r")
            ) {
                return (
                    textIdentifier +
                    v.replaceAll(textIdentifier, textIdentifier + textIdentifier) +
                    textIdentifier
                );
            }
            return v;
        };
        const colIndices = this.getSelectedColumnIndices(ranges, columns);
        const lines: string[] = [];
        if (includeHeaders) {
            lines.push(
                colIndices
                    .map((c) => quote(columns[c].toolTip ?? columns[c].name ?? ""))
                    .join(delimiter),
            );
        }
        for (const range of ranges) {
            for (let r = range.fromRow; r <= range.toRow; r++) {
                lines.push(
                    colIndices
                        .map((c) =>
                            this.isCellSelected(ranges, r, c)
                                ? quote(
                                      this.getCellDisplayValue(dataProvider, r, columns[c].field!),
                                  )
                                : "",
                        )
                        .join(delimiter),
                );
            }
        }
        return lines.join(lineSeparator);
    }

    public formatAsJson(
        ranges: Slick.Range[],
        columns: Slick.Column<T>[],
        dataProvider: IDisposableDataProvider<T>,
    ): string {
        const colMeta = this.getSelectedColumnIndices(ranges, columns).map((c) => {
            const col = columns[c];
            const typeName = this.getColumnInfo(col)?.dataTypeName?.toLowerCase();
            return {
                field: col.field!,
                index: c,
                key: JSON.stringify(col.toolTip ?? col.name ?? col.field!),
                isJsonNumber: !!typeName && NotebookContextMenu.JSON_NUMBER_TYPES.has(typeName),
            };
        });

        const eol = getEOL();
        const rows: string[] = [];
        for (const range of ranges) {
            for (let r = range.fromRow; r <= range.toRow; r++) {
                const item = dataProvider.getItem(r) as Slick.SlickData;
                const pairs: string[] = [];
                for (const { field, index, key, isJsonNumber } of colMeta) {
                    const cellVal = item?.[field];
                    let val: string;
                    if (!this.isCellSelected(ranges, r, index) || cellVal?.isNull) {
                        val = "null";
                    } else {
                        const displayVal = cellVal?.displayValue ?? "";
                        val =
                            isJsonNumber && NotebookContextMenu.JSON_NUMBER_PATTERN.test(displayVal)
                                ? displayVal
                                : JSON.stringify(displayVal);
                    }
                    pairs.push(`    ${key}: ${val}`);
                }
                rows.push(`  {${eol}${pairs.join(`,${eol}`)}${eol}  }`);
            }
        }
        return `[${eol}${rows.join(`,${eol}`)}${eol}]`;
    }

    public formatAsInClause(
        ranges: Slick.Range[],
        columns: Slick.Column<T>[],
        dataProvider: IDisposableDataProvider<T>,
    ): string | null {
        const valueLines: string[] = [];
        let col: Slick.Column<T> | undefined;
        let isNumeric = false;

        for (const range of ranges) {
            const rangeCols = this.getDataColumnsInRange(columns, range.fromCell, range.toCell);
            if (rangeCols.length !== 1) return null;
            if (col === undefined) {
                col = rangeCols[0];
                isNumeric = this.isNumericSqlType(this.getColumnInfo(col)?.dataTypeName);
            } else if (rangeCols[0].field !== col.field) {
                return null;
            }

            for (let r = range.fromRow; r <= range.toRow; r++) {
                const item = dataProvider.getItem(r) as Slick.SlickData;
                const cellVal = item?.[col.field!];
                const rawVal = cellVal?.displayValue ?? "";
                const val = cellVal?.isNull
                    ? "NULL"
                    : isNumeric && NotebookContextMenu.SQL_NUMBER_PATTERN.test(rawVal)
                      ? rawVal
                      : this.sqlStr(rawVal);
                valueLines.push(val);
            }
        }

        const indented = valueLines.map((v, i, a) => `    ${v}${i < a.length - 1 ? "," : ""}`);
        return ["IN", "(", ...indented, ")"].join(getEOL());
    }

    private showError(message: string): void {
        if (this.postMessage) {
            this.postMessage({ type: "showError", message });
        }
    }

    public formatAsInsertInto(
        ranges: Slick.Range[],
        columns: Slick.Column<T>[],
        dataProvider: IDisposableDataProvider<T>,
    ): string {
        const colMeta = this.getSelectedColumnIndices(ranges, columns).map((c) => {
            const col = columns[c];
            return {
                col,
                index: c,
                isNumeric: this.isNumericSqlType(this.getColumnInfo(col)?.dataTypeName),
            };
        });

        const valueRows: string[] = [];
        for (const range of ranges) {
            for (let r = range.fromRow; r <= range.toRow; r++) {
                const item = dataProvider.getItem(r) as Slick.SlickData;
                const values = colMeta.map(({ col, index, isNumeric }) => {
                    if (!this.isCellSelected(ranges, r, index)) {
                        return "NULL";
                    }
                    const cellVal = item?.[col.field!];
                    if (cellVal?.isNull) return "NULL";
                    const val = cellVal?.displayValue ?? "";
                    return isNumeric && NotebookContextMenu.SQL_NUMBER_PATTERN.test(val)
                        ? val
                        : this.sqlStr(val);
                });
                valueRows.push(`    (${values.join(", ")})`);
            }
        }

        if (colMeta.length === 0 || valueRows.length === 0) {
            return "";
        }

        const colNames = colMeta
            .map(({ col }) => this.escapeSqlIdentifier(col.toolTip ?? col.name ?? col.field ?? ""))
            .join(", ");
        const statements: string[] = [];
        for (
            let start = 0;
            start < valueRows.length;
            start += NotebookContextMenu.INSERT_ROW_LIMIT
        ) {
            const batch = valueRows.slice(start, start + NotebookContextMenu.INSERT_ROW_LIMIT);
            const rowLines = batch.map((row, i) => row + (i < batch.length - 1 ? "," : ";"));
            statements.push(
                [`INSERT INTO TableName (${colNames})`, "VALUES", ...rowLines].join(getEOL()),
            );
        }
        return statements.join(getEOL() + getEOL());
    }

    private isNumericSqlType(dataTypeName: string | undefined): boolean {
        return (
            !!dataTypeName && NotebookContextMenu.NUMERIC_SQL_TYPES.has(dataTypeName.toLowerCase())
        );
    }

    private sqlStr(v: string): string {
        return "'" + v.replace(/'/g, "''") + "'";
    }

    private escapeSqlIdentifier(value: string): string {
        return `[${value.replaceAll("]", "]]")}]`;
    }
}
