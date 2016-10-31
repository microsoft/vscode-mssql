import { Observable } from 'rxjs/Rx';
export declare enum CollectionChange {
    ItemsReplaced = 0,
}
export interface IObservableCollection<T> {
    getLength(): number;
    at(index: number): T;
    getRange(start: number, end: number): T[];
    setCollectionChangedCallback(callback: (change: CollectionChange, startIndex: number, count: number) => void): void;
}
export declare class CancellationToken {
    private _isCanceled;
    private _canceled;
    cancel(): void;
    isCanceled: boolean;
    canceled: Observable<any>;
}
