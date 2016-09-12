/*
*   SlickGrid Angular2 implementation obtained from Pendelton team
*   at Microsoft.
*
*/

/// <reference path="../../../typings/underscore.d.ts" />
import {Component, Input, Output, Inject, forwardRef, OnChanges, OnInit, OnDestroy, ElementRef, SimpleChange, EventEmitter,
    ViewEncapsulation, Optional, HostListener} from '@angular/core';
import {Observable, Subscription} from 'rxjs/Rx';
import {IObservableCollection, CollectionChange} from './BaseLibrary';
import {IGridDataRow} from './SharedControlInterfaces';
import {IColumnDefinition} from './ModelInterfaces';
import {LocalizationService} from './LocalizationService';
import {GridSyncService} from './GridSyncService';

enum FieldType {
    String = 0,
    Boolean = 1,
    Integer = 2,
    Decimal = 3,
    Date = 4,
    Unknown = 5,
}

declare let System;
// noinspection JSUnusedAssignment

declare let jQuery;
declare let Slick;

function getDisabledEditorClass(loadingString: string): any {
    class DisabledEditor {
        constructor(args: any) {
            jQuery('<input type="text" class="editor-text" disabled="true" value="' + loadingString + '" />')
                .appendTo(args.container);
        }

        destroy(): any {
            return undefined;
        };

        focus(): any {
            return undefined;
        };

        isValueChanged(): boolean {
            return false;
        };

        serializeValue(): string {
            return '';
        };

        loadValue(item: any): any {
            return undefined;
        };

        applyValue(item: any, state: any): any {
            return undefined;
        };

        validate(): any {
            return true;
        };
    }

    return DisabledEditor;
}

function getOverridableTextEditorClass(grid: SlickGrid): any {
    class OverridableTextEditor {
        private _textEditor: any;

        constructor(private _args: any) {
            this._textEditor = new Slick.Editors.Text(_args);
        }

        destroy(): void {
            this._textEditor.destroy();
        };

        focus(): void {
            this._textEditor.focus();
        };

        getValue(): string {
            return this._textEditor.getValue();
        };

        setValue(val): void {
            this._textEditor.setValue(val);
        };

        loadValue(item, rowNumber): void {
            let overrideValue = grid.overrideCellFn(rowNumber, this._args.column.id);
            if (overrideValue !== undefined) {
                item[this._args.column.id] = overrideValue;
            }

            this._textEditor.loadValue(item);
        };

        serializeValue(): string {
            return this._textEditor.serializeValue();
        };

        applyValue(item, state): void {
            this._textEditor.applyValue(item, state);
        };

        isValueChanged(): boolean {
            return this._textEditor.isValueChanged();
        };

        validate(): any {
            return this._textEditor.validate();
        };
    }

    return OverridableTextEditor;
}

@Component({
    selector: 'slick-grid',
    templateUrl: 'app/slickgrid/SlickGrid.html',
    styleUrls: ['app/libs/SlickGrid/slick.grid.css', 'app/slickgrid/SlickGrid.css'],
    providers: [LocalizationService, GridSyncService],
    encapsulation: ViewEncapsulation.None
})
export class SlickGrid implements OnChanges, OnInit, OnDestroy {
    @Input() columnDefinitions: IColumnDefinition[];
    @Input() dataRows: IObservableCollection<IGridDataRow>;
    @Input() resized: Observable<any>;
    @Input() editableColumnIds: string[] = [];
    @Input() highlightedCells: {row: number, column: number}[] = [];
    @Input() blurredColumns: string[] = [];
    @Input() contextColumns: string[] = [];
    @Input() columnsLoading: string[] = [];
    @Input() overrideCellFn: (rowNumber, columnId, value?, data?) => string;
    @Input() showHeader: boolean = false;
    @Input() showDataTypeIcon: boolean = true;
    @Input() enableColumnReorder: boolean = false;

    @Output() cellChanged: EventEmitter<{column: string, row: number, newValue: any}> = new EventEmitter<{column: string, row: number, newValue: any}>();
    @Output() editingFinished: EventEmitter<any> = new EventEmitter();

    @Input() topRowNumber: number;
    @Output() topRowNumberChange: EventEmitter<number> = new EventEmitter<number>();

    @HostListener('focus')
    onFocus(): void {
        if (this._grid) {
            this._grid.focus();
        }
    }

    private _grid: any;
    private _gridColumns: ISlickGridColumn[];
    private _gridData: ISlickGridData;
    private _rowHeight = 29;
    private _resizeSubscription: Subscription;
    private _gridSyncSubscription: Subscription;
    private _topRow: number = 0;
    private _leftPx: number = 0;
    private _finishGridEditingFn: (e: any, args: any) => void;

    private static getDataWithSchema(data: IGridDataRow, columns: ISlickGridColumn[]): any {
        let dataWithSchema = {};
        for (let i = 0; i < columns.length; i++) {
            dataWithSchema[columns[i].field] = data.values[i];
        }

        return dataWithSchema;
    }

    constructor(@Inject(forwardRef(() => ElementRef)) private _el,
                @Optional() @Inject(forwardRef(() => GridSyncService)) private _gridSyncService,
                @Inject(forwardRef(() => LocalizationService)) private _localizationService) {
        this._gridData = {
            getLength: (): number => {
                return this.dataRows && this._gridColumns ? this.dataRows.getLength() : 0;
            },
            getItem: (index): any => {
                return SlickGrid.getDataWithSchema(this.dataRows.at(index), this._gridColumns);
            },
            getRange: (start, end): any => {
                return !this.dataRows ? undefined : this.dataRows.getRange(start, end).map(d =>  {
                    return SlickGrid.getDataWithSchema(d, this._gridColumns);
                });
            },
            getItemMetadata: undefined
        };
    }

    ngOnChanges(changes: {[propName: string]: SimpleChange}): void {
        let columnDefinitionChanges = changes['columnDefinitions'];
        let activeCell = this._grid ? this._grid.getActiveCell() : undefined;
        let hasGridStructureChanges = false;
        let wasEditing = this._grid ? !!this._grid.getCellEditor() : false;

        if (columnDefinitionChanges
            && !_.isEqual(columnDefinitionChanges.previousValue, columnDefinitionChanges.currentValue)) {
            this.updateSchema();
            if (!this._grid) {
                this.initGrid();
            } else {
                this._grid.resetActiveCell();
                this._grid.setColumns(this._gridColumns);
            }
            if (this._gridSyncService) {
                let gridColumnWidths: number[] = this._grid.getColumnWidths();
                this._gridSyncService.rowNumberColumnWidthPX = gridColumnWidths[0];
                this._gridSyncService.columnWidthPXs = gridColumnWidths.slice(1);
            }
            hasGridStructureChanges = true;

            if (!columnDefinitionChanges.currentValue || columnDefinitionChanges.currentValue.length === 0) {
                activeCell = undefined;
            }
            if (activeCell) {
                let columnThatContainedActiveCell = columnDefinitionChanges.previousValue[Math.max(activeCell.cell - 1, 0)];
                let newActiveColumnIndex = columnThatContainedActiveCell
                    ? columnDefinitionChanges.currentValue.findIndex(c => c.id === columnThatContainedActiveCell.id)
                    : -1;
                activeCell.cell = newActiveColumnIndex !== -1 ? newActiveColumnIndex + 1 : 0;
            }
        }

        if (changes['dataRows']
            || (changes['highlightedCells'] && !_.isEqual(changes['highlightedCells'].currentValue, changes['highlightedCells'].previousValue))
            || (changes['blurredColumns'] && !_.isEqual(changes['blurredColumns'].currentValue, changes['blurredColumns'].previousValue))
            || (changes['columnsLoading'] && !_.isEqual(changes['columnsLoading'].currentValue, changes['columnsLoading'].previousValue))) {
            this.setCallbackOnDataRowsChanged();
            this._grid.updateRowCount();
            this._grid.invalidateAllRows();
            this._grid.render();
            if (this._gridSyncService) {
                this._gridSyncService.rowNumberColumnWidthPX = this._grid.getColumnWidths()[0];
            }
            hasGridStructureChanges = true;
        }

        if (hasGridStructureChanges) {
            if (activeCell) {
                this._grid.setActiveCell(activeCell.row, activeCell.cell);
            } else {
                this._grid.resetActiveCell();
            }
        }

        if (wasEditing && hasGridStructureChanges) {
            this._grid.editActiveCell();
        }

        if (changes['editableColumnIds']) {
            let newValue = changes['editableColumnIds'].currentValue;
            if (!_.isEqual(newValue, changes['editableColumnIds'].previousValue)) {
                this._grid.onKeyDown.unsubscribe(this.finishGridEditingFn);
                if (newValue && newValue.length > 0) {
                    this._grid.onKeyDown.subscribe(this.finishGridEditingFn);
                    let firstEditableColumn = this._grid.getColumnIndex(newValue[0]) + 1;
                    let rowToFocus = activeCell ? activeCell.row : this._grid.getViewport().top;
                    this._grid.gotoCell(rowToFocus, firstEditableColumn, true);
                }
            }
        }
    }

    private invalidateRange(start: number, end: number): void {
        let refreshedRows = _.range(start, end);
        this._grid.invalidateRows(refreshedRows, true);
        this._grid.render();
    }

    ngOnInit(): void {
        // ngOnInit() will be called *after* the first time ngOnChanges() is called
        // so, grid must be there already
        if (this.topRowNumber === undefined) {
            this.topRowNumber = 0;
        }
        this._grid.scrollRowToTop(this.topRowNumber);

        if (this.resized) {
            // Re-rendering the grid is expensive. Throttle so we only do so every 100ms.
            this.resized.throttleTime(100)
                .subscribe(() => this.onResize());
        }

        // subscribe to slick events
        // https://github.com/mleibman/SlickGrid/wiki/Grid-Events
        this.subscribeToScroll();
        this.subscribeToCellChanged();
        this.subscribeToContextMenu();
    }

    ngOnDestroy(): void {
        if (this._resizeSubscription !== undefined) {
            this._resizeSubscription.unsubscribe();
        }
        if (this._gridSyncSubscription !== undefined) {
            this._gridSyncSubscription.unsubscribe();
        }
    }

    onResize(): void {
        if (this._grid !== undefined) {
            // this will make sure the grid header and body to be re-rendered
            this._grid.resizeCanvas();
        }
    }

    /* tslint:disable:member-ordering */
    private getColumnEditor = (column: any): any => {
        let columnId = column.id;
        let isEditable = this.editableColumnIds && this.editableColumnIds.indexOf(columnId) !== -1;
        let isColumnLoading = this.columnsLoading && this.columnsLoading.indexOf(columnId) !== -1;
        if (isEditable) {
            return isColumnLoading
                ? getDisabledEditorClass(this._localizationService['strings']['loadingCell'])
                : getOverridableTextEditorClass(this);
        }

        return undefined;
    };

    private getFormatter = (column: any): any => {
        if (column.isRowNumber === true) {
            return undefined; // use default formatter for row number cell
        }
        return (row, cell, value, columnDef, dataContext) => {
            let columnId = cell > 0 && this.columnDefinitions.length > cell - 1 ? this.columnDefinitions[cell - 1].id : undefined;
            if (columnId) {
                let columnType = this.columnDefinitions[cell - 1].type;
                let isHighlighted = this.highlightedCells && !!this.highlightedCells.find(c => c.row === row && c.column + 1 === cell);
                let isColumnLoading = this.columnsLoading && this.columnsLoading.indexOf(columnId) !== -1;
                let isShadowed = this.blurredColumns && !!this.blurredColumns.find(c => c === columnId);
                let isContext = this.contextColumns && !!this.contextColumns.find(c => c === columnId);
                let overrideValue = this.overrideCellFn && this.overrideCellFn(row, columnId, value, dataContext);

                let valueToDisplay = (value + '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                let cellClasses = 'grid-cell-value-container';
                if (columnType !== FieldType.String) {
                    cellClasses += ' right-justified';
                }

                /* tslint:disable:no-null-keyword */
                let valueMissing = value === undefined || value === null;
                /* tslint:disable:no-null-keyword */
                let isOverridden = overrideValue !== undefined && overrideValue !== null;

                if (valueMissing && !isOverridden) {
                    cellClasses += ' missing-value';
                }

                if (isColumnLoading === true && !isOverridden) {
                    cellClasses += ' loading-cell';
                    valueToDisplay = this._localizationService['strings']['loadingCell'];
                }

                if (isOverridden) {
                    cellClasses += ' override-cell';
                    valueToDisplay = overrideValue;
                }

                if (isContext) {
                    cellClasses += ' context';
                }

                if (isHighlighted === true) {
                    cellClasses += ' highlighted';
                }

                if (isShadowed && !isHighlighted && !isOverridden) {
                    cellClasses += ' blurred';
                }

                return '<span title="' + valueToDisplay + '" class="' + cellClasses + '">' + valueToDisplay + '</span>';
            }

        };
    };

    private initGrid(): void {
        // https://github.com/mleibman/SlickGrid/wiki/Grid-Options
        let options = {
            enableCellNavigation: true,
            enableColumnReorder: this.enableColumnReorder,
            renderRowWithRange: true,
            showRowNumber: true,
            showDataTypeIcon: this.showDataTypeIcon,
            showHeader: this.showHeader,
            rowHeight: this._rowHeight,
            defaultColumnWidth: 120,
            editable: true,
            editorFactory: {
                getEditor: this.getColumnEditor
            },
            formatterFactory: {
                getFormatter: this.getFormatter
            }
        };

        this._grid = new Slick.Grid(
            this._el.nativeElement.getElementsByClassName('grid')[0],
            this._gridData,
            this._gridColumns,
            options);
        if (this._gridSyncService) {
            this._grid.setSelectionModel(this._gridSyncService.selectionModel);
            this._gridSyncService.scrollBarWidthPX = this._grid.getScrollbarDimensions().width;
            this._gridSyncSubscription = this._gridSyncService.updated
                .filter(p => p === 'columnWidthPXs')
                .debounceTime(10)
                .subscribe(p => {
                    this.updateColumnWidths();
                });
        }
        this.onResize();
    }

    private subscribeToScroll(): void {
        this._grid.onScroll.subscribe((e, args) => {
            let scrollTop = args.scrollTop;
            let scrollRow = Math.floor(scrollTop / this._rowHeight);
            scrollRow = scrollRow < 0 ? 0 : scrollRow;
            if (scrollRow !== this._topRow) {
                this._topRow = scrollRow;
                this.topRowNumberChange.emit(scrollRow);
            }

            if (this._gridSyncService && args.scrollLeft !== this._leftPx) {
                this._leftPx = args.scrollLeft;
                this._gridSyncService.scrollLeftPX = this._leftPx;
            }
        });
    }

    private subscribeToCellChanged(): void {
        this._grid.onCellChange.subscribe((e, args) => {
            let modifiedColumn = this.columnDefinitions[args.cell - 1];
            let oldValue = this.dataRows.at(args.row).values[args.cell - 1];
            let newValue = args.item[modifiedColumn.id];
            if (oldValue && oldValue.toString() === newValue) {
                return;
            }
            this.cellChanged.emit({
                column: modifiedColumn.id,
                row: args.row,
                newValue: args.item[modifiedColumn.id]
            });
        });
    }

    private updateColumnWidths(): void {
        for (let i = 0; i < this._gridColumns.length; i++) {
            this._gridColumns[i].width = this._gridSyncService.columnWidthPXs[i];
        }
        this._grid.setColumnWidths(this._gridColumns, true);
    }

    // add context menu to slickGrid
    public subscribeToContextMenu(): void {
        this._grid.onContextMenu.subscribe(function (event): void {
            event.preventDefault();
            $('.contextMenu').css('top', event.pageY).css('left', event.pageX).show();
            $('tab').one('click', function (): void {
                $('.contextMenu').hide();
            });
        });
    }

    private updateSchema(): void {
        if (!this.columnDefinitions) {
            return;
        }

        this._gridColumns = this.columnDefinitions.map((c, i) => {
            let column: ISlickGridColumn = {
                name: c.id,
                field: c.id,
                id: c.id,
                icon: this.getImagePathForDataType(c.type),
                resizable: true
            };

            if (c.asyncPostRender) {
                column.asyncPostRender = c.asyncPostRender;
            }

            if (this._gridSyncService) {
                let columnWidth = this._gridSyncService.columnWidthPXs[i];
                column.width = columnWidth ? columnWidth : undefined;
                column.minWidth = this._gridSyncService.columnMinWidthPX;
            }

            return column;
        });
    }

    private getImagePathForDataType(type: FieldType): string {
        const resourcePath = './resources/';
        switch (type) {
            case FieldType.String:
                return resourcePath + 'col-type-string.svg';
            case FieldType.Boolean:
                return resourcePath + 'col-type-boolean.svg';
            case FieldType.Integer:
            case FieldType.Decimal:
                return resourcePath + 'col-type-number.svg';
            case FieldType.Date:
                return resourcePath + 'col-type-timedate.svg';
            case FieldType.Unknown:
            default:
                return resourcePath + 'circle.svg';
        }
    }

    private setCallbackOnDataRowsChanged(): void {
        if (this.dataRows) {
            this.dataRows.setCollectionChangedCallback((change: CollectionChange, startIndex: number, count: number) => {
                this.renderGridDataRowsRange(startIndex, count);
            });
        }
    }

    private renderGridDataRowsRange(startIndex: number, count: number): void {
        let editor = this._grid.getCellEditor();
        let oldValue = editor ? editor.getValue() : undefined;
        let wasValueChanged = editor ? editor.isValueChanged() : false;
        this.invalidateRange(startIndex, startIndex + count);
        let activeCell = this._grid.getActiveCell();
        if (editor && activeCell.row >= startIndex && activeCell.row < startIndex + count) {
            if (oldValue && wasValueChanged) {
                editor.setValue(oldValue);
            }
        }
    }

    private get finishGridEditingFn(): (e: any, args: any) => void {
        if (this._finishGridEditingFn === undefined) {
            this._finishGridEditingFn = ((e: any, args: any) => {
                if (e.ctrlKey === true
                    && e.keyCode === 13
                    && this.editableColumnIds
                    && this.editableColumnIds.find(id => id === args.columnDef.id)) {
                    // pressed [Ctrl + Enter] in the editing area
                    this.editingFinished.next(undefined);
                }
            }).bind(this);
        }

        return this._finishGridEditingFn;
    }
}

interface ISlickGridData {
    // https://github.com/mleibman/SlickGrid/wiki/DataView
    getLength(): number;
    getItem(index: number): any;
    getRange(start: number, end: number): any; // only available in the forked SlickGrid
    getItemMetadata(index: number): any;
}

interface ISlickGridColumn {
    // https://github.com/mleibman/SlickGrid/wiki/Column-Options
    name: string;
    field: string;
    id: string;
    icon: string;
    resizable: boolean;
    minWidth?: number;
    width?: number;
    asyncPostRender?: (cellRef: string, row: number, dataContext: JSON, colDef: any) => void;
}
