import { IObservableCollection, CollectionChange } from './BaseLibrary';
export declare class VirtualizedCollection<TData> implements IObservableCollection<TData> {
    private _placeHolderGenerator;
    private _length;
    private _windowSize;
    private _bufferWindowBefore;
    private _window;
    private _bufferWindowAfter;
    private collectionChangedCallback;
    constructor(windowSize: number, length: number, loadFn: (offset: number, count: number) => Promise<TData[]>, _placeHolderGenerator: (index: number) => TData);
    setCollectionChangedCallback(callback: (change: CollectionChange, startIndex: number, count: number) => void): void;
    getLength(): number;
    at(index: number): TData;
    getRange(start: number, end: number): TData[];
    private getRangeFromCurrent(start, end);
    private getDataFromCurrent(index);
    private resetWindowsAroundIndex(index);
}
