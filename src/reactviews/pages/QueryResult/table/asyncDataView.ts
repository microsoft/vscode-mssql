/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// import * as vscode from 'vscode';
import { IDisposableDataProvider } from "./dataProvider";

export interface IObservableCollection<T> {
    getLength(): number;
    at(index: number): T;
    getRange(start: number, end: number): T[];
    setCollectionChangedCallback(callback: (startIndex: number, count: number) => void): void;
    setLength(length: number): void;
}

export interface ISlickColumn<T extends Slick.SlickData> extends Slick.Column<T> {
    isEditable?: boolean;
}

class DataWindow<T> {
    private _data: T[] | undefined;
    private _length: number = 0;
    private _offsetFromDataSource: number = -1;
    private _currentRequestId: number = 0;
    private _debounceTimeout: NodeJS.Timeout | undefined;
    private readonly _debounceDelay: number = 50; // ms to wait before sending request
    private _lastPositionTime: number = 0;
    private _consecutivePositionCount: number = 0;

    // private cancellationToken = new CancellationTokenSource();

    constructor(
        private loadFunction: (offset: number, count: number) => Thenable<T[]>,
        private placeholderItemGenerator: (index: number) => T,
        private loadCompleteCallback: (start: number, end: number) => void,
    ) {}

    dispose() {
        this._data = undefined;
        if (this._debounceTimeout) {
            clearTimeout(this._debounceTimeout);
            this._debounceTimeout = undefined;
        }
        // this.cancellationToken.cancel();
    }

    public getStartIndex(): number {
        return this._offsetFromDataSource;
    }

    public getEndIndex(): number {
        return this._offsetFromDataSource + this._length;
    }

    public contains(dataSourceIndex: number): boolean {
        return dataSourceIndex >= this.getStartIndex() && dataSourceIndex < this.getEndIndex();
    }

    public getItem(index: number): T {
        if (!this._data) {
            return this.placeholderItemGenerator(index);
        }
        return this._data[index - this._offsetFromDataSource];
    }

    public positionWindow(offset: number, length: number): void {
        this._offsetFromDataSource = offset;
        this._length = length;
        this._data = undefined;

        // Increment request ID to invalidate any pending requests
        this._currentRequestId++;
        const currentRequestId = this._currentRequestId;

        if (length === 0) {
            return;
        }

        // Detect if this is rapid continuous scrolling or a jump to position
        const now = Date.now();
        const timeSinceLastPosition = now - this._lastPositionTime;
        this._lastPositionTime = now;

        // If positions are happening very rapidly (< 100ms apart), it's continuous scrolling
        if (timeSinceLastPosition < 100) {
            this._consecutivePositionCount++;
        } else {
            this._consecutivePositionCount = 0;
        }

        // Clear any pending debounced requests
        if (this._debounceTimeout) {
            clearTimeout(this._debounceTimeout);
        }

        const executeLoad = () => {
            // Double-check that this request is still current
            if (currentRequestId !== this._currentRequestId) {
                return; // Window was repositioned again, skip this request
            }

            this.loadFunction(offset, length).then((data) => {
                // Only apply data if this request is still current (window hasn't been repositioned)
                if (currentRequestId === this._currentRequestId) {
                    this._data = data;
                    this.loadCompleteCallback(
                        this._offsetFromDataSource,
                        this._offsetFromDataSource + this._length,
                    );
                }
                // Otherwise, ignore this outdated response to prevent flickering
            });
        };

        // If rapid continuous scrolling (3+ rapid events), debounce to reduce load
        if (this._consecutivePositionCount >= 3) {
            this._debounceTimeout = setTimeout(() => {
                this._debounceTimeout = undefined;
                executeLoad();
            }, this._debounceDelay);
        } else {
            // Otherwise, load immediately (scrollbar drag, single scroll, or first few scrolls)
            executeLoad();
        }
    }
}

export class VirtualizedCollection<T extends Slick.SlickData> implements IObservableCollection<T> {
    private _bufferWindowBefore: DataWindow<T>;
    private _window: DataWindow<T>;
    private _bufferWindowAfter: DataWindow<T>;
    private _lengthChanged = false;

    private collectionChangedCallback?: (startIndex: number, count: number) => void;

    constructor(
        private readonly windowSize: number,
        private placeHolderGenerator: (index: number) => T,
        private length: number,
        loadFn: (offset: number, count: number) => Thenable<T[]>,
    ) {
        let loadCompleteCallback = (start: number, end: number) => {
            if (this.collectionChangedCallback) {
                this.collectionChangedCallback(start, end - start);
            }
        };

        this._bufferWindowBefore = new DataWindow(
            loadFn,
            placeHolderGenerator,
            loadCompleteCallback,
        );
        this._window = new DataWindow(loadFn, placeHolderGenerator, loadCompleteCallback);
        this._bufferWindowAfter = new DataWindow(
            loadFn,
            placeHolderGenerator,
            loadCompleteCallback,
        );
    }

    public setCollectionChangedCallback(
        callback: (startIndex: number, count: number) => void,
    ): void {
        this.collectionChangedCallback = callback;
    }

    public getLength(): number {
        return this.length;
    }

    setLength(length: number): void {
        if (this.length !== length) {
            this._lengthChanged = true;
            this.length = length;
        }
    }

    public at(index: number): T {
        return this.getRange(index, index + 1)[0];
    }

    public getRange(start: number, end: number): T[] {
        // current data may contain placeholders
        let currentData = this.getRangeFromCurrent(start, end);

        // only shift window and make promise of refreshed data in following condition:
        if (
            this._lengthChanged ||
            start < this._bufferWindowBefore.getStartIndex() ||
            end > this._bufferWindowAfter.getEndIndex()
        ) {
            // jump, reset
            this._lengthChanged = false;
            this.resetWindowsAroundIndex(start);
        } else if (end <= this._bufferWindowBefore.getEndIndex()) {
            // scroll up, shift up
            let windowToRecycle = this._bufferWindowAfter;
            this._bufferWindowAfter = this._window;
            this._window = this._bufferWindowBefore;
            this._bufferWindowBefore = windowToRecycle;
            let newWindowOffset = Math.max(0, this._window.getStartIndex() - this.windowSize);
            // Ensure window length is never negative (defensive guard)
            let newWindowLength = Math.max(0, this._window.getStartIndex() - newWindowOffset);

            this._bufferWindowBefore.positionWindow(newWindowOffset, newWindowLength);
        } else if (start >= this._bufferWindowAfter.getStartIndex()) {
            // scroll down, shift down
            let windowToRecycle = this._bufferWindowBefore;
            this._bufferWindowBefore = this._window;
            this._window = this._bufferWindowAfter;
            this._bufferWindowAfter = windowToRecycle;
            let newWindowOffset = Math.min(
                this._window.getStartIndex() + this.windowSize,
                this.length,
            );
            // Ensure window length is never negative by using Math.max(0, ...)
            let newWindowLength = Math.max(
                0,
                Math.min(this.length - newWindowOffset, this.windowSize),
            );

            this._bufferWindowAfter.positionWindow(newWindowOffset, newWindowLength);
        }

        return currentData;
    }

    private getRangeFromCurrent(start: number, end: number): T[] {
        const currentData: Array<T> = [];
        for (let i = 0; i < end - start; i++) {
            currentData.push(this.getDataFromCurrent(start + i));
        }

        return currentData;
    }

    private getDataFromCurrent(index: number): T {
        if (this._bufferWindowBefore.contains(index)) {
            return this._bufferWindowBefore.getItem(index);
        } else if (this._bufferWindowAfter.contains(index)) {
            return this._bufferWindowAfter.getItem(index);
        } else if (this._window.contains(index)) {
            return this._window.getItem(index);
        }

        return this.placeHolderGenerator(index);
    }

    public resetWindowsAroundIndex(index: number): void {
        let bufferWindowBeforeStart = Math.max(0, index - this.windowSize * 1.5);
        let bufferWindowBeforeEnd = Math.max(0, index - this.windowSize / 2);
        // Ensure window length is never negative
        let bufferWindowBeforeLength = Math.max(0, bufferWindowBeforeEnd - bufferWindowBeforeStart);
        this._bufferWindowBefore.positionWindow(bufferWindowBeforeStart, bufferWindowBeforeLength);

        let mainWindowStart = bufferWindowBeforeEnd;
        let mainWindowEnd = Math.min(mainWindowStart + this.windowSize, this.length);
        // Ensure window length is never negative
        let mainWindowLength = Math.max(0, mainWindowEnd - mainWindowStart);
        this._window.positionWindow(mainWindowStart, mainWindowLength);

        let bufferWindowAfterStart = mainWindowEnd;
        let bufferWindowAfterEnd = Math.min(bufferWindowAfterStart + this.windowSize, this.length);
        // Ensure window length is never negative
        let bufferWindowAfterLength = Math.max(0, bufferWindowAfterEnd - bufferWindowAfterStart);
        this._bufferWindowAfter.positionWindow(bufferWindowAfterStart, bufferWindowAfterLength);
    }
}

export class AsyncDataProvider<T extends Slick.SlickData> implements IDisposableDataProvider<T> {
    // private _onFilterStateChange = new vscode.EventEmitter<void>();
    // get onFilterStateChange(): vscode.Event<void> { return this._onFilterStateChange.event; }

    // private _onSortComplete = new vscode.EventEmitter<Slick.OnSortEventArgs<T>>();
    // get onSortComplete(): vscode.Event<Slick.OnSortEventArgs<T>> { return this._onSortComplete.event; }

    constructor(public dataRows: IObservableCollection<T>) {}

    public get isDataInMemory(): boolean {
        return false;
    }

    getRangeAsync(_startIndex: number, _length: number): Promise<T[]> {
        throw new Error("Method not implemented.");
    }

    getColumnValues(_column: Slick.Column<T>): Promise<string[]> {
        throw new Error("Method not implemented.");
    }

    sort(_options: Slick.OnSortEventArgs<T>): Promise<void> {
        throw new Error("Method not implemented.");
    }

    filter(_columns?: Slick.Column<T>[]): Promise<void> {
        throw new Error("Method not implemented.");
    }

    resetSort(): void {
        throw new Error("Method not implemented.");
    }

    public getLength(): number {
        return this.dataRows.getLength();
    }

    public getItem(index: number): T {
        return this.dataRows.at(index);
    }

    public getRange(start: number, end: number): T[] {
        return this.dataRows.getRange(start, end);
    }

    public set length(length: number) {
        this.dataRows.setLength(length);
    }

    public get length(): number {
        return this.dataRows.getLength();
    }

    getItems(): T[] {
        throw new Error("Method not supported.");
    }
}
