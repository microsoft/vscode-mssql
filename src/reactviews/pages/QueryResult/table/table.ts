/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "../../../media/table.css";
import { TableDataView } from "./tableDataView";
import { ITableSorter, ITableConfiguration, ITableStyles, FilterableColumn } from "./interfaces";
import * as DOM from "./dom";

import { IDisposableDataProvider } from "./dataProvider";
import { CellSelectionModel } from "./plugins/cellSelectionModel.plugin";
import { mixin } from "./objects";
import { HeaderFilter } from "./plugins/headerFilter.plugin";
import { ContextMenu } from "./plugins/contextMenu.plugin";
import {
    ColumnFilterState,
    GetColumnWidthsRequest,
    GetFiltersRequest,
    GetGridScrollPositionRequest,
    ResultSetSummary,
    SetColumnWidthsRequest,
    SetGridScrollPositionNotification,
} from "../../../../sharedInterfaces/queryResult";
import { QueryResultReactProvider } from "../queryResultStateProvider";
import { CopyKeybind } from "./plugins/copyKeybind.plugin";
import { AutoColumnSize } from "./plugins/autoColumnSize.plugin";
import { MouseButton } from "../../../common/utils";
import { ColorThemeKind } from "../../../../sharedInterfaces/webview";

function getDefaultOptions<T extends Slick.SlickData>(): Slick.GridOptions<T> {
    return {
        syncColumnCellResize: true,
        enableColumnReorder: false,
        emulatePagingWhenScrolling: false,
    } as Slick.GridOptions<T>;
}

export const MAX_COLUMN_WIDTH_PX = 400;
export const ACTIONBAR_WIDTH_PX = 36;
export const TABLE_ALIGN_PX = 7;
export const SCROLLBAR_PX = 15;
export const xmlLanguageId = "xml";
export const jsonLanguageId = "json";

export class Table<T extends Slick.SlickData> implements IThemable {
    protected styleElement: HTMLStyleElement;
    protected idPrefix: string;

    protected _grid: Slick.Grid<T>;
    // protected _columns: Slick.Column<T>[];
    protected _data: IDisposableDataProvider<T>;
    private _sorter?: ITableSorter<T>;
    private _classChangeTimeout: any;

    private _autoscroll?: boolean;
    private _container: HTMLElement;
    protected _tableContainer: HTMLElement;
    private selectionModel: CellSelectionModel<T>;
    public headerFilter: HeaderFilter<T>;
    private _lastScrollAt: number = 0;

    constructor(
        parent: HTMLElement,
        styles: ITableStyles,
        private uri: string,
        private resultSetSummary: ResultSetSummary,
        private context: QueryResultReactProvider,
        private linkHandler: (fileContent: string, fileType: string) => void,
        private gridId: string,
        private configuration: ITableConfiguration<T>,
        options?: Slick.GridOptions<T>,
        gridParentRef?: React.RefObject<HTMLDivElement>,
        autoSizeColumns: boolean = false,
        themeKind: ColorThemeKind = ColorThemeKind.Dark,
    ) {
        this.linkHandler = linkHandler;
        this.selectionModel = new CellSelectionModel<T>(
            {
                hasRowSelector: true,
            },
            context,
        );
        if (
            !configuration ||
            !configuration.dataProvider ||
            Array.isArray(configuration.dataProvider)
        ) {
            this._data = new TableDataView<T>(
                configuration && (configuration.dataProvider as Array<T>),
            );
        } else {
            this._data = configuration.dataProvider as any;
        }

        let newOptions = mixin(options || {}, getDefaultOptions<T>(), false);

        this._container = document.createElement("div");
        this._container.className = "monaco-table";

        DOM.addDisposableListener(
            this._container,
            DOM.EventType.FOCUS,
            () => {
                clearTimeout(this._classChangeTimeout);
                this._classChangeTimeout = setTimeout(() => {
                    this._container.classList.add("focused");
                }, 100);
            },
            true,
        );

        DOM.addDisposableListener(
            this._container,
            DOM.EventType.BLUR,
            () => {
                clearTimeout(this._classChangeTimeout);
                this._classChangeTimeout = setTimeout(() => {
                    this._container.classList.remove("focused");
                }, 100);
            },
            true,
        );

        parent.appendChild(this._container);
        this.styleElement = DOM.createStyleSheet(this._container);
        this._tableContainer = document.createElement("div");
        // this._tableContainer.className = //TODO: class name for styles
        let gridParent = gridParentRef?.current;
        if (gridParent) {
            this._tableContainer.style.width = `${(gridParent?.clientWidth - ACTIONBAR_WIDTH_PX).toString()}px`;
            const height = gridParent?.clientHeight;
            this._tableContainer.style.height = `${height.toString()}px`;
        }
        this._container.appendChild(this._tableContainer);
        this.styleElement = DOM.createStyleSheet(this._container);
        this._grid = new Slick.Grid<T>(this._tableContainer, this._data, [], newOptions);
        this.headerFilter = new HeaderFilter(this.uri, themeKind, this.context, gridId);
        this.registerPlugin(this.headerFilter);
        this.registerPlugin(
            new ContextMenu(
                this.uri,
                this.resultSetSummary,
                this.context,
                this.configuration.dataProvider as IDisposableDataProvider<T>,
            ),
        );
        this.registerPlugin(
            new CopyKeybind(
                this.uri,
                this.resultSetSummary,
                this.context,
                this.configuration.dataProvider as IDisposableDataProvider<T>,
            ),
        );

        this.registerPlugin(
            new AutoColumnSize(
                {
                    maxWidth: MAX_COLUMN_WIDTH_PX,
                    autoSizeOnRender: autoSizeColumns,
                },
                this.context,
            ),
        );

        if (configuration && configuration.columns) {
            this.columns = configuration.columns;
        } else {
            this.columns = new Array<Slick.Column<T>>();
        }

        this.idPrefix = this._tableContainer.classList[0];
        this._container.classList.add(this.idPrefix);
        if (configuration && configuration.sorter) {
            this._sorter = configuration.sorter;
            this._grid.onSort.subscribe((_e, args) => {
                this._sorter!(args);
                this._grid.invalidate();
                this._grid.render();
            });
        }

        this.setSelectionModel(this.selectionModel);
        this.mapMouseEvent(this._grid.onContextMenu);
        this.mapMouseEvent(this._grid.onClick);
        this.mapMouseEvent(this._grid.onDblClick);
        this._grid.onColumnsResized.subscribe(async (_e, data) => {
            if (!data) {
                return;
            }
            let columnSizes = this.grid
                .getColumns()
                .slice(1)
                .map((v) => v.width);
            let currentColumnSizes = await this.context.extensionRpc.sendRequest(
                GetColumnWidthsRequest.type,
                { uri: this.uri },
            );
            if (currentColumnSizes === columnSizes) {
                return;
            }
            await this.context.extensionRpc.sendRequest(SetColumnWidthsRequest.type, {
                uri: this.uri,
                columnWidths: columnSizes as number[],
            });
        });

        this._grid.onScroll.subscribe(async (_e, data) => {
            if (!data) {
                return;
            }

            const viewport = this._grid.getViewport();
            this._lastScrollAt = Date.now();
            await this.context.extensionRpc.sendNotification(
                SetGridScrollPositionNotification.type,
                {
                    uri: this.uri,
                    gridId: this.gridId,
                    scrollLeft: viewport.leftPx,
                    scrollTop: viewport.top,
                },
            );
        });

        this.style(styles);
        // this.registerPlugin(new MouseWheelSupport());
    }

    public async restoreColumnWidths(): Promise<void> {
        const columnWidthArray = await this.context.extensionRpc.sendRequest(
            GetColumnWidthsRequest.type,
            {
                uri: this.uri,
            },
        );

        if (!columnWidthArray) {
            return;
        }
        let count = 0;
        for (const column of this._grid.getColumns()) {
            // Skip the first column (row selector)
            if (count === 0) {
                count++;
                continue;
            }
            column.width = columnWidthArray[count - 1];
            count++;
        }
    }

    /**
     * Load filters from the query result state and apply them to the table
     * @returns true if filters were successfully loaded and applied, false if no filters were found
     */
    public async setupFilterState(): Promise<boolean> {
        let sortColumn: Slick.Column<T> | undefined = undefined;
        let sortDirection: boolean | undefined = undefined;
        const filterMapArray = await this.context.extensionRpc.sendRequest(GetFiltersRequest.type, {
            uri: this.uri,
        });
        if (!filterMapArray) {
            return false;
        }
        const filterMap = filterMapArray.find((filter) => filter[this.gridId]);
        if (!filterMap || !filterMap[this.gridId]) {
            this.context.log("No filters found in store");
            return false;
        }
        for (const column of this.columns) {
            for (const columnFilterMap of filterMap[this.gridId]) {
                if (columnFilterMap[column.id!]) {
                    const filterStateArray = columnFilterMap[column.id!];
                    filterStateArray.forEach((filterState: ColumnFilterState) => {
                        if (filterState.columnDef === column.field) {
                            (column as FilterableColumn<T>).filterValues = filterState.filterValues;
                        }
                    });
                    let columnSortDirection = columnFilterMap[column.id!][0].sorted;
                    if (
                        (columnSortDirection === "ASC" || columnSortDirection === "DESC") &&
                        !sortDirection
                    ) {
                        sortColumn = column;
                        (column as FilterableColumn<T>).sorted = columnSortDirection;
                        sortDirection = columnSortDirection === "ASC" ? true : false;
                    }
                }
            }
        }
        await this._data.filter(this.columns);
        if (sortDirection !== undefined && sortColumn) {
            let sortArgs = {
                grid: this._grid,
                multiColumnSort: false,
                sortCol: sortColumn,
                sortAsc: sortDirection,
            };
            await this._data.sort(sortArgs);
        }
        return true;
    }

    public async setupScrollPosition(): Promise<void> {
        const scrollPosition = await this.context.extensionRpc.sendRequest(
            GetGridScrollPositionRequest.type,
            {
                uri: this.uri,
                gridId: this.gridId,
            },
        );
        if (scrollPosition) {
            setTimeout(() => {
                this._grid.scrollRowToTop(scrollPosition.scrollTop);
                const containerNode = this._grid.getContainerNode();
                const viewport = containerNode
                    ? (containerNode.querySelector(".slick-viewport") as HTMLElement)
                    : undefined;
                if (viewport) {
                    viewport.scrollLeft = scrollPosition.scrollLeft;
                }
            }, 0);
        }
    }

    /**
     * Execute a rendering action while preserving the current selection and focus state
     * @param action The action to execute
     */
    private withRenderPreservingSelection(action: () => void): void {
        const hadFocus = this._container.contains(document.activeElement);
        const activeCell = this._grid.getActiveCell();
        const selectedRanges = this.getSelectedRanges();

        action();

        if (hadFocus) {
            // Let SlickGrid finish its render tick before restoring focus/selection
            setTimeout(() => {
                this.focus();
                const recentlyScrolled = Date.now() - this._lastScrollAt < 250;
                // Restore selection always – this does not force scroll
                if (selectedRanges?.length) {
                    this.selectionModel.setSelectedRanges(selectedRanges);
                }
                // Only restore active cell if it would not force-scroll the viewport
                if (activeCell && !recentlyScrolled) {
                    const vp = this._grid.getViewport();
                    const inView = activeCell.row >= vp.top && activeCell.row <= vp.bottom;
                    if (inView) {
                        this._grid.setActiveCell(activeCell.row, activeCell.cell);
                    }
                    // If not in view or user recently scrolled, skip restoring active cell to avoid snapping viewport
                }
            }, 0);
        }
    }

    public rerenderGrid() {
        this.withRenderPreservingSelection(() => {
            this._grid.updateRowCount();
            this._grid.setColumns(this._grid.getColumns());
            this._grid.invalidateAllRows();
            this._grid.render();
        });
    }

    private mapMouseEvent(slickEvent: Slick.Event<any>) {
        slickEvent.subscribe((e: Slick.EventData) => {
            const originalEvent = (e as JQuery.TriggeredEvent).originalEvent;
            const cell = this._grid.getCellFromEvent(originalEvent!);
            // If event is left click
            if (
                cell &&
                originalEvent instanceof MouseEvent &&
                originalEvent.button === MouseButton.LeftClick
            ) {
                this.handleLinkClick(cell);
            }
        });
    }

    private handleLinkClick(cell: Slick.Cell): void {
        const columnInfo = this.resultSetSummary.columnInfo[cell.cell - 1];
        if (!columnInfo) {
            return;
        }
        if (columnInfo.isXml || columnInfo.isJson) {
            this.linkHandler(
                this.getCellValue(cell.row, cell.cell),
                columnInfo.isXml ? xmlLanguageId : jsonLanguageId,
            );
        }
    }

    public getCellValue(row: number, column: number): string {
        const rowRef = this._grid.getDataItem(row);
        const col = this._grid.getColumns()[column].field!;
        return rowRef[col].displayValue;
    }

    public dispose() {
        this._container.remove();
    }

    public invalidateRows(rows: number[], keepEditor: boolean) {
        this.withRenderPreservingSelection(() => {
            this._grid.invalidateRows(rows, keepEditor);
            this._grid.render();
        });
    }

    public updateRowCount() {
        this.withRenderPreservingSelection(() => {
            this._grid.updateRowCount();
            this._grid.render();
            if (this._autoscroll) {
                this._grid.scrollRowIntoView(this._data.getLength() - 1, false);
            }
            this.ariaRowCount = this.grid.getDataLength();
            this.ariaColumnCount = this.grid.getColumns().length;
        });
    }

    set columns(columns: Slick.Column<T>[]) {
        this._grid.setColumns(columns);
    }

    public get grid(): Slick.Grid<T> {
        return this._grid;
    }

    setData(data: Array<T>): void;
    setData(data: TableDataView<T>): void;
    setData(data: Array<T> | TableDataView<T>): void {
        if (data instanceof TableDataView) {
            this._data = data;
        } else {
            this._data = new TableDataView<T>(data);
        }
        this._grid.setData(this._data, true);
        this.updateRowCount();
    }

    getData(): IDisposableDataProvider<T> {
        return this._data;
    }

    get columns(): Slick.Column<T>[] {
        return this._grid.getColumns();
    }

    public setSelectedRows(rows: number[] | boolean) {
        if (isBoolean(rows)) {
            this._grid.setSelectedRows(range(this._grid.getDataLength()));
        } else {
            this._grid.setSelectedRows(rows);
        }
    }

    public getSelectedRows(): number[] {
        return this._grid.getSelectedRows();
    }

    onSelectedRowsChanged(
        fn: (e: Slick.EventData, data: Slick.OnSelectedRowsChangedEventArgs<T>) => any,
    ): void;
    // onSelectedRowsChanged(fn: (e: Slick.DOMEvent, data: Slick.OnSelectedRowsChangedEventArgs<T>) => any): vscode.Disposable;
    onSelectedRowsChanged(fn: any): void {
        this._grid.onSelectedRowsChanged.subscribe(fn);
        console.log("onselectedrowschanged");
        return;
    }

    setSelectionModel(model: Slick.SelectionModel<T, Array<Slick.Range>>) {
        this._grid.setSelectionModel(model);
    }

    getSelectionModel(): Slick.SelectionModel<T, Array<Slick.Range>> {
        return this._grid.getSelectionModel();
    }

    getSelectedRanges(): Slick.Range[] {
        let selectionModel = this._grid.getSelectionModel();
        if (selectionModel && selectionModel.getSelectedRanges) {
            return selectionModel.getSelectedRanges();
        }
        return <Slick.Range[]>(<unknown>undefined);
    }

    focus(): void {
        this._grid.focus();
    }

    setActiveCell(row: number, cell: number): void {
        this._grid.setActiveCell(row, cell);
    }

    get activeCell(): Slick.Cell | null {
        return this._grid.getActiveCell();
    }

    registerPlugin(plugin: Slick.Plugin<T>): void {
        this._grid.registerPlugin(plugin);
    }

    unregisterPlugin(plugin: Slick.Plugin<T>): void {
        this._grid.unregisterPlugin(plugin);
    }

    /**
     * This function needs to be called if the table is drawn off dom.
     */
    resizeCanvas() {
        this._grid.resizeCanvas();
    }

    layout(dimension: DOM.Dimension): void;
    layout(size: number, orientation: Orientation): void;
    layout(sizing: number | DOM.Dimension, orientation?: Orientation): void {
        if (sizing instanceof DOM.Dimension) {
            this._container.style.width = sizing.width + "px";
            this._container.style.height = sizing.height + "px";
            this._tableContainer.style.width = sizing.width + "px";
            this._tableContainer.style.height = sizing.height + "px";
        } else {
            if (orientation === Orientation.VERTICAL) {
                this._container.style.width = "100%";
                this._container.style.height = sizing + "px";
                this._tableContainer.style.width = "100%";
                this._tableContainer.style.height = sizing + "px";
            } else {
                this._container.style.width = sizing + "px";
                this._container.style.height = "100%";
                this._tableContainer.style.width = sizing + "px";
                this._tableContainer.style.height = "100%";
            }
        }
        this.resizeCanvas();
    }

    autosizeColumns() {
        this._grid.autosizeColumns();
    }

    set autoScroll(active: boolean) {
        this._autoscroll = active;
    }

    style(styles: ITableStyles): void {
        const content: string[] = [];

        if (styles.tableHeaderBackground) {
            content.push(
                `.monaco-table .${this.idPrefix} .slick-header .slick-header-column { background-color: ${styles.tableHeaderBackground}; }`,
            );
        }

        if (styles.tableHeaderForeground) {
            content.push(
                `.monaco-table .${this.idPrefix} .slick-header .slick-header-column { color: ${styles.tableHeaderForeground}; }`,
            );
        }

        if (styles.listFocusBackground) {
            content.push(
                `.monaco-table.${this.idPrefix}.focused .slick-row .active { background-color: ${styles.listFocusBackground}; }`,
            );
            content.push(
                `.monaco-table.${this.idPrefix}.focused .slick-row .active:hover { background-color: ${styles.listFocusBackground}; }`,
            ); // overwrite :hover style in this case!
        }

        if (styles.listFocusForeground) {
            content.push(
                `.monaco-table.${this.idPrefix}.focused .slick-row .active { color: ${styles.listFocusForeground}; }`,
            );
        }

        if (styles.listActiveSelectionBackground) {
            content.push(
                `.monaco-table.${this.idPrefix}.focused .slick-row .selected { background-color: ${styles.listActiveSelectionBackground}; }`,
            );
            content.push(
                `.monaco-table.${this.idPrefix}.focused .slick-row .selected:hover { background-color: ${styles.listActiveSelectionBackground}; }`,
            ); // overwrite :hover style in this case!
        }

        if (styles.listActiveSelectionForeground) {
            content.push(
                `.monaco-table.${this.idPrefix}.focused .slick-row .selected { color: ${styles.listActiveSelectionForeground}; }`,
            );
        }

        if (styles.listFocusAndSelectionBackground) {
            content.push(
                `.monaco-table.${this.idPrefix}.focused .slick-row .selected.active { background-color: ${styles.listFocusAndSelectionBackground}; }`,
            );
        }

        if (styles.listFocusAndSelectionForeground) {
            content.push(
                `.monaco-table.${this.idPrefix}.focused .slick-row .selected.active { color: ${styles.listFocusAndSelectionForeground}; }`,
            );
        }

        if (styles.listInactiveFocusBackground) {
            content.push(
                `.monaco-table.${this.idPrefix} .slick-row .selected.active { background-color:  ${styles.listInactiveFocusBackground}; }`,
            );
            content.push(
                `.monaco-table.${this.idPrefix} .slick-row .selected.active:hover { background-color:  ${styles.listInactiveFocusBackground}; }`,
            ); // overwrite :hover style in this case!
        }

        if (styles.listInactiveSelectionBackground) {
            content.push(
                `.monaco-table.${this.idPrefix} .slick-row .selected { background-color:  ${styles.listInactiveSelectionBackground}; }`,
            );
            content.push(
                `.monaco-table.${this.idPrefix} .slick-row .selected:hover { background-color:  ${styles.listInactiveSelectionBackground}; }`,
            ); // overwrite :hover style in this case!
        }

        if (styles.listInactiveSelectionForeground) {
            content.push(
                `.monaco-table.${this.idPrefix} .slick-row .selected { color: ${styles.listInactiveSelectionForeground}; }`,
            );
        }

        if (styles.listHoverBackground) {
            content.push(
                `.monaco-table.${this.idPrefix} .slick-row:hover { background-color:  ${styles.listHoverBackground}; }`,
            );
            // handle no coloring during drag
            content.push(
                `.monaco-table.${this.idPrefix} .drag .slick-row:hover { background-color: inherit; }`,
            );
        }

        if (styles.listHoverForeground) {
            content.push(
                `.monaco-table.${this.idPrefix} .slick-row:hover { color:  ${styles.listHoverForeground}; }`,
            );
            // handle no coloring during drag
            content.push(
                `.monaco-table.${this.idPrefix} .drag .slick-row:hover { color: inherit; }`,
            );
        }

        if (styles.listSelectionOutline) {
            content.push(
                `.monaco-table.${this.idPrefix} .slick-row .selected.active { outline: 1px dotted ${styles.listSelectionOutline}; outline-offset: -1px; }`,
            );
        }

        if (styles.listFocusOutline) {
            content.push(
                `.monaco-table.${this.idPrefix}.focused .slick-row .selected { outline: 1px solid ${styles.listFocusOutline}; outline-offset: -1px; }`,
            );
            content.push(
                `.monaco-table.${this.idPrefix}.focused .slick-row .selected.active { outline: 2px solid ${styles.listFocusOutline}; outline-offset: -1px; }`,
            );
        }

        if (styles.listInactiveFocusOutline) {
            content.push(
                `.monaco-table.${this.idPrefix} .slick-row .selected .active { outline: 1px dotted ${styles.listInactiveFocusOutline}; outline-offset: -1px; }`,
            );
        }

        if (styles.listHoverOutline) {
            content.push(
                `.monaco-table.${this.idPrefix} .slick-row:hover { outline: 1px dashed ${styles.listHoverOutline}; outline-offset: -1px; }`,
            );
        }

        this.styleElement.innerHTML = content.join("\n");
    }

    public setOptions(newOptions: Slick.GridOptions<T>) {
        this._grid.setOptions(newOptions);
        this._grid.invalidate();
    }

    public setTableTitle(title: string): void {
        this._tableContainer.title = title;
    }

    public removeAriaRowCount(): void {
        this._tableContainer.removeAttribute("aria-rowcount");
    }

    public set ariaRowCount(value: number) {
        this._tableContainer.setAttribute("aria-rowcount", value.toString());
    }

    public removeAriaColumnCount(): void {
        this._tableContainer.removeAttribute("aria-colcount");
    }

    public set ariaColumnCount(value: number) {
        this._tableContainer.setAttribute("aria-colcount", value.toString());
    }

    public set ariaRole(value: string) {
        this._tableContainer.setAttribute("role", value);
    }

    public set ariaLabel(value: string) {
        this._tableContainer.setAttribute("aria-label", value);
    }

    public get container(): HTMLElement {
        return this._tableContainer;
    }
}

export const enum Orientation {
    VERTICAL,
    HORIZONTAL,
}

/**
 * @returns whether the provided parameter is a JavaScript Boolean or not.
 */
export function isBoolean(obj: unknown): obj is boolean {
    return obj === true || obj === false;
}

export function range(arg: number, to?: number): number[] {
    let from = typeof to === "number" ? arg : 0;

    if (typeof to === "number") {
        from = arg;
    } else {
        from = 0;
        to = arg;
    }

    const result: number[] = [];

    if (from <= to) {
        for (let i = from; i < to; i++) {
            result.push(i);
        }
    } else {
        for (let i = from; i > to; i--) {
            result.push(i);
        }
    }

    return result;
}

export type styleFn = (colors: any) => void;

export interface IThemable {
    style: styleFn;
}
