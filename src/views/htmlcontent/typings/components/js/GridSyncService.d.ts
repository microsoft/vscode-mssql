import { Observable } from 'rxjs/Rx';
import { SelectionModel } from './SelectionModel';
export declare class GridSyncService {
    columnMinWidthPX: number;
    private _scrollLeftPX;
    private _scrollBarWidthPX;
    private _columnWidthPXs;
    private _rowNumberColumnWidthPX;
    private _updated;
    private _typeDropdownOffset;
    private _selectionModel;
    private _initialColumnWidthPXsOnResize;
    private _isGridReadOnly;
    initialColumnResize(): void;
    resizeColumn(index: number, deltaWidthPX: number): void;
    openTypeDropdown(columnIndex: number): void;
    private setColumnWidthPX(index, widthPX);
    updated: Observable<string>;
    typeDropdownOffset: Observable<[number, number]>;
    scrollLeftPX: number;
    scrollBarWidthPX: number;
    columnWidthPXs: number[];
    rowNumberColumnWidthPX: number;
    selectionModel: SelectionModel;
    isGridReadOnly: boolean;
    private notifyUpdates(propertyName);
}
