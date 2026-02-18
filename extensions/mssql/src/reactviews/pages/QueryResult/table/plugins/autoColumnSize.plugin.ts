/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Adapted from https://github.com/naresh-n/slickgrid-column-data-autosize/blob/master/src/slick.autocolumnsize.js

import { TelemetryActions, TelemetryViews } from "../../../../../sharedInterfaces/telemetry";
import { WebviewTelemetryActionEvent } from "../../../../../sharedInterfaces/webview";
import { deepClone } from "../../../../common/utils";
import { QueryResultReactProvider } from "../../queryResultStateProvider";
import { mixin } from "../objects";
import { MAX_COLUMN_WIDTH_PX, MIN_COLUMN_WIDTH_PX } from "../table";

export interface IAutoColumnSizeOptions extends Slick.PluginOptions {
    maxWidth?: number;
    autoSizeOnRender?: boolean;
    extraColumnHeaderWidth?: number;
    includeHeaderWidthInCalculation?: boolean;
    includeDataWidthInCalculation?: boolean;
}

const defaultOptions: IAutoColumnSizeOptions = {
    maxWidth: MAX_COLUMN_WIDTH_PX,
    autoSizeOnRender: false,
    extraColumnHeaderWidth: 20,
    includeHeaderWidthInCalculation: true,
    includeDataWidthInCalculation: true,
};

const NUM_ROWS_TO_SCAN = 50;

export class AutoColumnSize<T extends Slick.SlickData> implements Slick.Plugin<T> {
    private _grid!: Slick.Grid<T>;
    private _$container!: JQuery;
    private _context!: CanvasRenderingContext2D;
    private _options: IAutoColumnSizeOptions;
    private _onPostEventHandler = new Slick.EventHandler();

    constructor(
        options: IAutoColumnSizeOptions = defaultOptions,
        private _qrContext: QueryResultReactProvider,
    ) {
        this._options = mixin(options, defaultOptions, false);
    }

    public init(grid: Slick.Grid<T>) {
        this._grid = grid;
        if (this._options.autoSizeOnRender) {
            this._onPostEventHandler.subscribe(this._grid.onRendered, () => this.onPostRender());
            this._onPostEventHandler.subscribe(this._grid.onViewportChanged, () => {
                setTimeout(() => this.onPostRender(), 10);
            });
        }

        this._$container = jQuery(this._grid.getContainerNode());
        this._$container.on("dblclick.autosize", ".slick-resizable-handle", (e) =>
            this.handleDoubleClick(e),
        );
        this._context = document.createElement("canvas").getContext("2d")!;
    }

    public destroy() {
        this._$container.off();
    }

    public autosizeColumns() {
        this.onPostRender();
    }

    /**
     * Calculate optimal column width based on header and content width.
     * Prioritizes content width but ensures headers are readable.
     */
    private calculateOptimalColumnWidth(headerWidth: number, contentWidth: number): number {
        if (!this._options.includeHeaderWidthInCalculation) {
            headerWidth = 0;
        }
        if (!this._options.includeDataWidthInCalculation) {
            contentWidth = 0;
        }
        // Default to max of header and content, but cap at maxWidth
        return (
            Math.max(
                Math.min(
                    Math.max(headerWidth, contentWidth),
                    this._options.maxWidth || MAX_COLUMN_WIDTH_PX,
                ),
                MIN_COLUMN_WIDTH_PX,
            ) + 1
        );
    }

    private onPostRender() {
        // this doesn't do anything if the grid isn't on the dom
        if (!this._grid.getContainerNode().isConnected) {
            return;
        }

        // Ensure headers are rendered before trying to size columns
        let headerColumnsQuery = jQuery(this._grid.getContainerNode()).find(
            ".slick-header-columns",
        );
        if (!headerColumnsQuery || !headerColumnsQuery.length) {
            // If headers aren't ready, try again in a short while
            setTimeout(() => this.onPostRender(), 50);
            return;
        }

        // since data can be async we want to only do this if we have the data to actual
        // work on since we are measuring the physical length of data
        let data = this._grid.getData() as Slick.DataProvider<T>;

        // Check if we have any data at all
        if (data.getLength() === 0) {
            return;
        }

        let item = data.getItem(0);
        if (!item || Object.keys(item).length === 0) {
            return;
        }

        let headerColumns = headerColumnsQuery[0];
        let origCols = this._grid.getColumns();
        let allColumns = deepClone(origCols);
        allColumns.forEach((col, index) => {
            col.formatter = origCols[index].formatter;
            col.asyncPostRender = origCols[index].asyncPostRender;
        });
        let change = false;
        let headerElements: HTMLElement[] = [];
        let columnDefs: Slick.Column<T>[] = [];
        let colIndices: number[] = [];

        for (let i = 0; i <= headerColumns.children.length; i++) {
            let headerEl = jQuery(headerColumns.children.item(i)! as HTMLElement);
            let columnDef = headerEl.data("column");
            if (columnDef) {
                headerElements.push(headerEl[0]);
                columnDefs.push(columnDef);
                colIndices.push(this._grid.getColumnIndex(columnDef.id));
            }
        }

        let headerWidths: number[];
        if (this._options.includeHeaderWidthInCalculation) {
            headerWidths = this.getElementWidths(headerElements).map((width, index) => {
                return width + (index === 0 ? 0 : this._options.extraColumnHeaderWidth!);
            });
        } else {
            headerWidths = new Array(columnDefs.length).fill(0);
        }
        let maxColumnTextWidths: number[];
        if (this._options.includeDataWidthInCalculation) {
            maxColumnTextWidths = this.getMaxColumnTextWidths(columnDefs, colIndices);
        } else {
            maxColumnTextWidths = new Array(columnDefs.length).fill(0);
        }

        for (let i = 0; i < columnDefs.length; i++) {
            let colIndex: number = colIndices[i];
            // Skip row number column (index 0) - it has a fixed width
            if (colIndex === 0) {
                continue;
            }
            let column: Slick.Column<T> = allColumns[colIndex];
            let autoSizeWidth: number = this.calculateOptimalColumnWidth(
                headerWidths[i],
                maxColumnTextWidths[i],
            );
            if (autoSizeWidth !== column.width) {
                allColumns[colIndex].width = autoSizeWidth;
                change = true;
            }
        }

        if (change) {
            this._onPostEventHandler.unsubscribeAll();
            this._grid.setColumns(allColumns);
            this._grid.onColumnsResized.notify();
        }
    }

    private handleDoubleClick(e: JQuery.TriggeredEvent<HTMLElement, unknown>) {
        let headerEl = jQuery(e.currentTarget).closest(".slick-header-column");
        let columnDef = headerEl.data("column");

        if (!columnDef || !columnDef.resizable) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        this.resizeColumn(headerEl, columnDef);
    }

    private resizeColumn(headerEl: JQuery, columnDef: Slick.Column<T>) {
        let colIndex = this._grid.getColumnIndex(columnDef.id!);
        // Skip row number column (index 0) - it has a fixed width
        if (colIndex === 0) {
            return;
        }
        let headerWidth = this._options.includeHeaderWidthInCalculation
            ? this.getElementWidths([headerEl[0]])[0] + this._options.extraColumnHeaderWidth!
            : 0;
        let origCols = this._grid.getColumns();
        let allColumns = deepClone(origCols);
        allColumns.forEach((col, index) => {
            col.formatter = origCols[index].formatter;
            col.asyncPostRender = origCols[index].asyncPostRender;
        });
        let column = allColumns[colIndex];

        let contentWidth = this._options.includeDataWidthInCalculation
            ? this.getMaxColumnTextWidth(columnDef, colIndex)
            : 0;
        let autoSizeWidth = this.calculateOptimalColumnWidth(headerWidth, contentWidth);

        // Only resize if the current width is smaller than the new width.
        if (autoSizeWidth > (column?.width || 0)) {
            allColumns[colIndex].width = autoSizeWidth;
            this._grid.setColumns(allColumns);
            this._grid.onColumnsResized.notify();
        }
    }

    /**
     * For each column, find the max width of the texts in the first 100 rows.
     * @param columnDefs Column definitions of all columns that need to be resized
     * @param colIndices Column indices of all columns that need to be resized
     * @returns An array of the max widths of each column
     */
    private getMaxColumnTextWidths(columnDefs: Slick.Column<T>[], colIndices: number[]): number[] {
        let data = this._grid.getData() as Slick.DataProvider<T>;
        let dataLength = data.getLength();
        let start = 0;
        let end = Math.min(NUM_ROWS_TO_SCAN, dataLength);

        // Early return if no data available in the range
        if (start >= end || dataLength === 0) {
            return columnDefs.map(() => 100); // Return default width
        }

        let allTexts: Array<string>[] = [];
        let rowElements: JQuery[] = [];

        columnDefs.forEach((columnDef) => {
            let texts: Array<string> = [];
            for (let i = start; i < end; i++) {
                const item = data.getItem(i);
                if (item && columnDef.field) {
                    texts.push(item[columnDef.field] || "");
                } else {
                    texts.push("");
                }
            }
            allTexts.push(texts);
            let rowEl = this.createRow();
            rowElements.push(rowEl);
        });

        let templates = this.getMaxTextTemplates(
            allTexts,
            columnDefs,
            colIndices,
            data,
            rowElements,
        );

        let widths = this.getTemplateWidths(rowElements, templates);
        rowElements.forEach((rowElement) => {
            this.deleteRow(rowElement);
        });
        if (this._options.maxWidth) {
            return widths.map((width) => Math.min(this._options.maxWidth!, width));
        } else {
            return widths.map((width) => width);
        }
    }

    private getMaxColumnTextWidth(columnDef: Slick.Column<T>, colIndex: number): number {
        let texts: Array<string> = [];
        let rowEl = this.createRow();
        let data = this._grid.getData() as Slick.DataProvider<T>;
        let dataLength = data.getLength();
        let start = 0;
        let end = Math.min(NUM_ROWS_TO_SCAN, dataLength);
        for (let i = start; i < end; i++) {
            const item = data.getItem(i);
            if (item && columnDef.field) {
                texts.push(item[columnDef.field] || "");
            } else {
                texts.push("");
            }
        }
        // adding -1 for column since this is a single column resize
        let template = this.getMaxTextTemplate(texts, columnDef, colIndex, data, rowEl, -1);
        let width = this.getTemplateWidths([rowEl], [template])[0];
        this.deleteRow(rowEl);
        return width > this._options.maxWidth! ? this._options.maxWidth! : width;
    }

    private getTemplateWidths(
        rowElements: JQuery[],
        templates: (JQuery | HTMLElement | string)[],
    ): number[] {
        // Write all changes first then read all widths to prevent layout thrashing
        // (https://developers.google.com/web/fundamentals/performance/rendering/avoid-large-complex-layouts-and-layout-thrashing)
        const cells: JQuery[] = templates.map((template, index) => {
            let rowEl = rowElements[index];
            let cell = jQuery(rowEl.find(".slick-cell"));
            cell.append(template);
            jQuery(cell).find("*").css("position", "relative");
            return cell;
        });

        return cells.map((cell) => cell.outerWidth()! + 1);
    }

    private getMaxTextTemplates(
        allTexts: string[][],
        columnDefs: Slick.Column<T>[],
        colIndices: number[],
        data: Slick.DataProvider<T>,
        rowElements: JQuery[],
    ): (JQuery | HTMLElement | string)[] {
        let numColumns = columnDefs.length;
        return columnDefs.map((columnDef, index) =>
            this.getMaxTextTemplate(
                allTexts[index],
                columnDef,
                colIndices[index],
                data,
                rowElements[index],
                numColumns,
            ),
        );
    }

    private getMaxTextTemplate(
        texts: string[],
        columnDef: Slick.Column<T>,
        colIndex: number,
        data: Slick.DataProvider<T>,
        rowEl: JQuery,
        numColumns: number,
    ): JQuery | HTMLElement | string {
        let max = 0,
            maxTemplate: JQuery | HTMLElement | string | undefined;
        let formatFun = columnDef.formatter;
        let startTime = Date.now();
        texts.forEach((text, index) => {
            let template;
            if (formatFun) {
                const item = data.getItem(index);
                if (item) {
                    template = jQuery(
                        "<span>" + formatFun(index, colIndex, text, columnDef, item) + "</span>",
                    );
                    text = template.text() || text;
                } else {
                    // If item is undefined, use the raw text
                    template = jQuery("<span>" + (text || "") + "</span>");
                    text = template.text() || text;
                }
            }
            let length = text ? this.getElementWidthUsingCanvas(rowEl, text) : 0;
            if (length > max) {
                max = length;
                maxTemplate = template || text;
            }
        });
        let endTime = Date.now();
        let timeElapsed = endTime - startTime;
        let telemetryEvent: WebviewTelemetryActionEvent = {
            telemetryView: TelemetryViews.QueryResult,
            telemetryAction: TelemetryActions.AutoColumnSize,
            additionalMeasurements: {
                timeElapsedMs: timeElapsed,
                rows: texts.length,
                columns: numColumns,
            },
        };
        this._qrContext.sendActionEvent(telemetryEvent);
        return maxTemplate!;
    }

    private createRow(): JQuery {
        let rowEl = jQuery('<div class="slick-row"><div class="slick-cell"></div></div>');
        rowEl.find(".slick-cell").css({
            visibility: "hidden",
            "text-overflow": "initial",
            "white-space": "nowrap",
        });
        let gridCanvas = this._$container.find(".grid-canvas");
        jQuery(gridCanvas).append(rowEl);
        return rowEl;
    }

    private deleteRow(rowEl: JQuery) {
        jQuery(rowEl).remove();
    }

    private getElementWidths(elements: HTMLElement[]): number[] {
        let clones: HTMLElement[] = [];
        let widths: number[] = [];

        // Write all changes first then read all widths to prevent layout thrashing
        // (https://developers.google.com/web/fundamentals/performance/rendering/avoid-large-complex-layouts-and-layout-thrashing)
        elements.forEach((element) => {
            let clone = element.cloneNode(true) as HTMLElement;
            clone.style.cssText =
                "position: absolute; visibility: hidden;right: auto;text-overflow: initial;white-space: nowrap;";
            element.parentNode!.insertBefore(clone, element);
            clones.push(clone);
        });

        clones.forEach((clone) => {
            widths.push(clone.offsetWidth);
        });

        clones.forEach((clone) => {
            clone.parentNode!.removeChild(clone);
        });

        return widths;
    }

    private getElementWidthUsingCanvas(element: JQuery, text: string): number {
        this._context.font = element.css("font-size") + " " + element.css("font-family");
        let metrics = this._context.measureText(text);
        return metrics.width;
    }
}
