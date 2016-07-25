import {ISelectionRange} from './BackingModel';

export class SelectionModel implements ISlickSelectionModel {

    constructor(private _rowSelectionModel: ISlickSelectionModel,
                private _handler: ISlickEventHandler,
                private _onSelectedRangesChanged: ISlickEvent,
                private _slickRangeFactory: (fromRow: number, fromCell: number, toRow: number, toCell: number) => ISlickRange) { }

    get range(): ISlickRange[] {
        return this._ranges;
    }

    get onSelectedRangesChanged(): ISlickEvent {
        return this._onSelectedRangesChanged;
    }

    init(grid: ISlickGrid): void {
        this._grid = grid;
        this._rowSelectionModel.init(grid);
        this._handler.subscribe(this._rowSelectionModel.onSelectedRangesChanged, (e, ranges) => {
            this.updateSelectedRanges(ranges);
        });
    }

    destroy(): void {
        this._handler.unsubscribeAll();
        this._rowSelectionModel.destroy();
    }

    setSelectedRanges(ranges: ISlickRange[]): void {
        this.updateSelectedRanges(ranges);
    }

    changeSelectedRanges(selections: ISelectionRange[]): void {
        let slickRange = (selections || []).map(s =>
            this._slickRangeFactory(s.startRow, s.startColumn, s.endRow - 1, s.endColumn - 1)
        );
        this.updateSelectedRanges(slickRange);
    }

    toggleSingleColumnSelection(columnId: string): void {
        let newRanges = [this.getColumnRange(columnId)];
        if (SelectionModel.areRangesIdentical(newRanges, this._ranges)) {
            this.clearSelection();
        } else {
            this.setSingleColumnSelection(columnId);
        }
    }

    setSingleColumnSelection(columnId: string): void {
        this._lastSelectedColumnIndexSequence = [this._grid.getColumnIndex(columnId)];
        this._grid.resetActiveCell();
        this.updateSelectedRanges([this.getColumnRange(columnId)]);
    }

    toggleMultiColumnSelection(columnId: string): void {
        if (this.isColumnSelectionCurrently === false) {
            return this.toggleSingleColumnSelection(columnId);
        }
        let columnIndex = this._grid.getColumnIndex(columnId);
        let columnRange = this.getColumnRangeByIndex(columnIndex);
        let columnInRange = false;
        let newRanges = this._ranges.filter((value, index) => {
            if (value.fromCell === columnRange.fromCell && value.toCell === columnRange.toCell) {
                columnInRange = true;
                return false;
            }
            return true;
        });
        this._lastSelectedColumnIndexSequence = this._lastSelectedColumnIndexSequence.filter(value => value !== columnIndex);

        if (columnInRange === false) {
            newRanges.push(columnRange);
            this._lastSelectedColumnIndexSequence.push(this._grid.getColumnIndex(columnId));
        }

        this._grid.resetActiveCell();
        this.updateSelectedRanges(newRanges);
    }

    extendMultiColumnSelection(columnId: string): void {
        if (this.isColumnSelectionCurrently === false
            || !this._lastSelectedColumnIndexSequence
            || this._lastSelectedColumnIndexSequence.length === 0) {
            return this.toggleSingleColumnSelection(columnId);
        }

        let columnIndex = this._grid.getColumnIndex(columnId);
        let lastSelectedColumnIndex = this._lastSelectedColumnIndexSequence[this._lastSelectedColumnIndexSequence.length - 1];

        let start = Math.min(columnIndex, lastSelectedColumnIndex);
        let end = Math.max(columnIndex, lastSelectedColumnIndex);

        let newRanges = [];
        this._lastSelectedColumnIndexSequence = [];
        for (let i = start; i <= end; i++) {
            newRanges.push(this.getColumnRangeByIndex(i));
            if (i !== lastSelectedColumnIndex) {
                this._lastSelectedColumnIndexSequence.push(i);
            }
        }
        this._lastSelectedColumnIndexSequence.push(lastSelectedColumnIndex);

        this._grid.resetActiveCell();
        this.updateSelectedRanges(newRanges);
    }

    clearSelection(): void {
        this._lastSelectedColumnIndexSequence = [];
        this._grid.resetActiveCell();
        this.updateSelectedRanges([]);
    }

    private _grid: ISlickGrid;
    private _ranges: ISlickRange[] = [];
    private _lastSelectedColumnIndexSequence: number[] = [];

    private static areRangesIdentical(lhs: ISlickRange[], rhs: ISlickRange[]): boolean {
        if (lhs && rhs && (lhs !== rhs) && lhs.length === rhs.length) {
            for (let i = 0; i < lhs.length; ++i) {
                if (lhs[i].fromRow !== rhs[i].fromRow
                    || lhs[i].toRow !== rhs[i].toRow
                    || lhs[i].fromCell !== rhs[i].fromCell
                    || lhs[i].toCell !== rhs[i].toCell) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    private getColumnRange(columnId: string): ISlickRange {
        let columnIndex = this._grid.getColumnIndex(columnId);
        return this.getColumnRangeByIndex(columnIndex);
    }

    private getColumnRangeByIndex(columnIndex: number): ISlickRange {
        let rowCount = this._grid.getDataLength();
        let lastRowToSelect =  rowCount === 0 ? 0 : rowCount - 1 ;
        return this._slickRangeFactory(0, columnIndex, lastRowToSelect, columnIndex);
    }

    private get isColumnSelectionCurrently(): boolean {
        return this._ranges
            && this._ranges.length > 0
            && this._ranges.find(r => {
                let startAtFirstRow = r.fromRow === 0;
                let endAtLastRow = r.toRow === Math.max(0, this._grid.getDataLength() - 1);
                return !startAtFirstRow || !endAtLastRow || r.fromCell !== r.toCell;
            }) === undefined;
    }

    private updateSelectedRanges(ranges: ISlickRange[]): void {
        // Set focus to this grid if it's not already somewhere inside it.
        if (ranges && ranges.length !== 0 && this._grid && this._grid.getCanvasNode() && !this._grid.getCanvasNode().contains(document.activeElement)) {
            this._grid.focus();
        }

        if (SelectionModel.areRangesIdentical(ranges, this._ranges)) {
            return;
        }

        this._ranges = ranges;
        this.onSelectedRangesChanged.notify(this._ranges);
    }
}

export interface ISlickSelectionModel {
    range: ISlickRange[];
    onSelectedRangesChanged: any;
    init(grid: any): void;
    destroy(): void;
    setSelectedRanges(ranges: ISlickRange[]): void;
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
