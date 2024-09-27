/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// import 'media/table';
// import 'media/slick.grid';
// import 'media/slickColorTheme';

import "../../../media/table.css";
import { TableDataView } from "./tableDataView";
import { ITableSorter, ITableConfiguration, ITableStyles } from "./interfaces";
import * as DOM from "./dom";

import { IDisposableDataProvider } from "./dataProvider";
import { CellSelectionModel } from "./plugins/cellSelectionModel.plugin";
import { mixin } from "./objects";
import { HeaderFilter } from "./plugins/headerFilter.plugin";
// import { MouseWheelSupport } from './plugins/mousewheelTableScroll.plugin';

function getDefaultOptions<T extends Slick.SlickData>(): Slick.GridOptions<T> {
    return {
        syncColumnCellResize: true,
        enableColumnReorder: false,
        emulatePagingWhenScrolling: false,
    } as Slick.GridOptions<T>;
}

const ACTIONBAR_WIDTH = 36; //px

export class Table<T extends Slick.SlickData> implements IThemable {
    protected styleElement: HTMLStyleElement;
    protected idPrefix: string;

    protected _grid: Slick.Grid<T>;
    // protected _columns: Slick.Column<T>[];
    protected _data: IDisposableDataProvider<T>;
    private _sorter?: ITableSorter<T>;

    private _autoscroll?: boolean;
    private _container: HTMLElement;
    protected _tableContainer: HTMLElement;
    private selectionModel = new CellSelectionModel<T>({
        hasRowSelector: true,
    });

    constructor(
        parent: HTMLElement,
        styles: ITableStyles,
        configuration?: ITableConfiguration<T>,
        options?: Slick.GridOptions<T>,
    ) {
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

        parent.appendChild(this._container);
        this.styleElement = DOM.createStyleSheet(this._container);
        this._tableContainer = document.createElement("div");
        // this._tableContainer.className = //TODO: class name for styles
        let gridParent = document.getElementById("grid-parent");
        if (gridParent) {
            this._tableContainer.style.width = `${(gridParent?.clientWidth - ACTIONBAR_WIDTH).toString()}px`;
            const height = gridParent?.clientHeight - 5;
            this._tableContainer.style.height = `${height.toString()}px`;
        }
        this._container.appendChild(this._tableContainer);
        this.styleElement = DOM.createStyleSheet(this._container);
        this._grid = new Slick.Grid<T>(
            this._tableContainer,
            this._data,
            [],
            newOptions,
        );
        this.registerPlugin(new HeaderFilter());

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
        this.mapMouseEvent(this._grid.onHeaderClick);
        this.mapMouseEvent(this._grid.onDblClick);
        this._grid.onColumnsResized.subscribe(() =>
            console.log("oncolumnresize"),
        );
        this.style(styles);
        // this.registerPlugin(new MouseWheelSupport());
    }

    public rerenderGrid() {
        this._grid.updateRowCount();
        this._grid.setColumns(this._grid.getColumns());
        this._grid.invalidateAllRows();
        this._grid.render();
    }

    private mapMouseEvent(slickEvent: Slick.Event<any>) {
        slickEvent.subscribe((e: Slick.EventData) => {
            const originalEvent = (e as JQuery.TriggeredEvent).originalEvent;
            const cell = this._grid.getCellFromEvent(originalEvent!);
            const anchor =
                originalEvent instanceof MouseEvent
                    ? { x: originalEvent.x, y: originalEvent.y }
                    : (originalEvent!.srcElement as HTMLElement);
            console.log("anchor: ", anchor);
            console.log("cell: ", cell);
            // emitter.fire({ anchor, cell });
        });
    }

    public dispose() {
        this._container.remove();
    }

    public invalidateRows(rows: number[], keepEditor: boolean) {
        this._grid.invalidateRows(rows, keepEditor);
        this._grid.render();
    }

    public updateRowCount() {
        this._grid.updateRowCount();
        this._grid.render();
        if (this._autoscroll) {
            this._grid.scrollRowIntoView(this._data.getLength() - 1, false);
        }
        this.ariaRowCount = this.grid.getDataLength();
        this.ariaColumnCount = this.grid.getColumns().length;
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
        fn: (
            e: Slick.EventData,
            data: Slick.OnSelectedRowsChangedEventArgs<T>,
        ) => any,
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
