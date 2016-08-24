import {Injectable} from '@angular/core';
import {Subject, Observable} from 'rxjs/Rx';
import {SelectionModel, ISlickRange} from './SelectionModel';

declare let Slick;
declare let DragRowSelectionModel;

@Injectable()
export class GridSyncService {
    columnMinWidthPX: number = 30;

    private _scrollLeftPX: number = 0;
    private _scrollBarWidthPX: number = 0;
    private _columnWidthPXs: number[] = [];
    private _rowNumberColumnWidthPX: number;
    private _updated = new Subject<string>();
    private _typeDropdownOffset = new Subject<[number, number]>();
    private _selectionModel = new SelectionModel(
        new Slick.DragRowSelectionModel(),
        new Slick.EventHandler(),
        new Slick.Event(),
        (fromRow: number, fromCell: number, toRow: number, toCell: number): ISlickRange => new Slick.Range(fromRow, fromCell, toRow, toCell));
    private _initialColumnWidthPXsOnResize: number[] = [];
    private _isGridReadOnly: boolean = false;

    initialColumnResize(): void {
        this._initialColumnWidthPXsOnResize = this._columnWidthPXs.slice(0);
    }

    resizeColumn(index: number, deltaWidthPX: number): void {
        this._columnWidthPXs = this._initialColumnWidthPXsOnResize.slice(0);
        let newWidthPX = this._columnWidthPXs[index] + deltaWidthPX;
        this.setColumnWidthPX(index, newWidthPX);
        this.notifyUpdates('columnWidthPXs');
    }

    openTypeDropdown(columnIndex: number): void {
        let offset = this._rowNumberColumnWidthPX + this._columnWidthPXs.slice(0, columnIndex).reduce((x, y) => x + y, 0) - this.scrollLeftPX;
        this._typeDropdownOffset.next([columnIndex, offset]);
    }

    private setColumnWidthPX(index: number, widthPX: number): void {
        if (index < 0 || index >= this._columnWidthPXs.length) {
            return;
        }

        if (widthPX >= this.columnMinWidthPX) {
            this._columnWidthPXs[index] = widthPX;
        } else {
            this._columnWidthPXs[index] = this.columnMinWidthPX;

            if (index > 0) {
                let leftShrink = this.columnMinWidthPX - widthPX;
                this.setColumnWidthPX(index - 1, this._columnWidthPXs[index - 1] - leftShrink);
            }
        }
    }

    get updated(): Observable<string> {
        return this._updated;
    }

    get typeDropdownOffset(): Observable<[number, number]> {
        return this._typeDropdownOffset;
    }

    set scrollLeftPX(value: number) {
        this._scrollLeftPX = value;
        this.notifyUpdates('scrollLeftPX');
    }

    get scrollLeftPX(): number {
        return this._scrollLeftPX;
    }

    set scrollBarWidthPX(value: number) {
        this._scrollBarWidthPX = value;
        this.notifyUpdates('scrollBarWidthPX');
    }

    get scrollBarWidthPX(): number {
        return this._scrollBarWidthPX;
    }

    set columnWidthPXs(value: number[]) {
        this._columnWidthPXs = value;
        this.notifyUpdates('columnWidthPXs');
    }

    get columnWidthPXs(): number[] {
        return this._columnWidthPXs;
    }

    set rowNumberColumnWidthPX(value: number) {
        this._rowNumberColumnWidthPX = value;
        this.notifyUpdates('rowNumberColumnWidthPX');
    }

    get rowNumberColumnWidthPX(): number {
        return this._rowNumberColumnWidthPX;
    }

    get selectionModel(): SelectionModel {
        return this._selectionModel;
    }

    set isGridReadOnly(value: boolean) {
        this._isGridReadOnly = value;
        this.notifyUpdates('isGridReadOnly');
    }

    get isGridReadOnly(): boolean {
        return this._isGridReadOnly;
    }

    private notifyUpdates(propertyName: string): void {
        this._updated.next(propertyName);
    }
}
