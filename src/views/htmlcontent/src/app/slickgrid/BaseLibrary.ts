import {Observable, Subject} from 'rxjs/Rx';

export enum CollectionChange {
    ItemsReplaced
}

export interface IObservableCollection<T> {
    getLength(): number;
    at(index: number): T;
    getRange(start: number, end: number): T[];
    setCollectionChangedCallback(callback: (change: CollectionChange, startIndex: number, count: number) => void): void;
}

export class CancellationToken {
    private _isCanceled: boolean = false;
    private _canceled: Subject<any> = new Subject<any>();

    cancel(): void {
        this._isCanceled = true;
        this._canceled.next(undefined);
    }

    get isCanceled(): boolean {
        return this._isCanceled;
    }

    get canceled(): Observable<any> {
        return this._canceled;
    }
}
