import { ISelectionRange } from './BackingModel';
export declare class SelectionModel implements ISlickSelectionModel {
    private _rowSelectionModel;
    private _handler;
    private _onSelectedRangesChanged;
    private _slickRangeFactory;
    constructor(_rowSelectionModel: ISlickSelectionModel, _handler: ISlickEventHandler, _onSelectedRangesChanged: ISlickEvent, _slickRangeFactory: (fromRow: number, fromCell: number, toRow: number, toCell: number) => ISlickRange);
    range: ISlickRange[];
    onSelectedRangesChanged: ISlickEvent;
    init(grid: ISlickGrid): void;
    destroy(): void;
    setSelectedRanges(ranges: ISlickRange[]): void;
    getSelectedRanges(): ISlickRange[];
    changeSelectedRanges(selections: ISelectionRange[]): void;
    toggleSingleColumnSelection(columnId: string): void;
    setSingleColumnSelection(columnId: string): void;
    toggleMultiColumnSelection(columnId: string): void;
    extendMultiColumnSelection(columnId: string): void;
    clearSelection(): void;
    private _grid;
    private _ranges;
    private _lastSelectedColumnIndexSequence;
    private static areRangesIdentical(lhs, rhs);
    private getColumnRange(columnId);
    private getColumnRangeByIndex(columnIndex);
    private isColumnSelectionCurrently;
    private updateSelectedRanges(ranges);
}
export interface ISlickSelectionModel {
    range: ISlickRange[];
    onSelectedRangesChanged: any;
    init(grid: any): void;
    destroy(): void;
    setSelectedRanges(ranges: ISlickRange[]): void;
    getSelectedRanges(): ISlickRange[];
}
export interface ISlickEventHandler {
    subscribe(event: any, handler: any): void;
    unsubscribeAll(): void;
}
export interface ISlickEvent {
    notify(eventData: ISlickRange[]): void;
    subscribe(handler: (e: any, args: any) => void): void;
}
export interface ISlickRange {
    fromCell: number;
    fromRow: number;
    toCell: number;
    toRow: number;
}
export interface ISlickGrid {
    getActiveCellNode(): any;
    getCanvasNode(): any;
    resetActiveCell(): void;
    focus(): void;
    getColumnIndex(columnId: string): number;
    getDataLength(): number;
}
