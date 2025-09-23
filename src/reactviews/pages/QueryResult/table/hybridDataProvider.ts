/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ShowFilterDisabledMessageRequest } from "../../../../sharedInterfaces/queryResult";
import { QueryResultReactProvider } from "../queryResultStateProvider";
import { AsyncDataProvider, IObservableCollection } from "./asyncDataView";
import { IDisposableDataProvider } from "./dataProvider";
import { FilterableColumn } from "./interfaces";
import { TableDataView, TableFilterFunc, TableSortFunc, CellValueGetter } from "./tableDataView";

export interface HybridDataProviderOptions {
    inMemoryDataProcessing: boolean;
    inMemoryDataCountThreshold?: number;
}

/**
 * Used to abstract the underlying data provider, based on the options, if we are allowing in-memory data processing and the threshold is not reached the
 * a TableDataView will be used to provide in memory data source, otherwise it will be using the async data provider.
 */
export class HybridDataProvider<T extends Slick.SlickData> implements IDisposableDataProvider<T> {
    private _asyncDataProvider: AsyncDataProvider<T>;
    private _tableDataProvider: TableDataView<T>;
    private _dataCached: boolean = false;

    // private _onFilterStateChange = new vscode.EventEmitter<void>();
    // get onFilterStateChange(): vscode.Event<void> { return this._onFilterStateChange.event; }

    // private _onSortComplete = new vscode.EventEmitter<Slick.OnSortEventArgs<T>>();
    // get onSortComplete(): vscode.Event<Slick.OnSortEventArgs<T>> { return this._onSortComplete.event; }

    constructor(
        dataRows: IObservableCollection<T>,
        private _loadDataFn: (offset: number, count: number) => Thenable<T[]>,
        valueGetter: CellValueGetter,
        private readonly _options: HybridDataProviderOptions,
        private queryResultContext: QueryResultReactProvider,
        filterFn?: TableFilterFunc<T>,
        sortFn?: TableSortFunc<T>,
    ) {
        this._asyncDataProvider = new AsyncDataProvider<T>(dataRows);
        this._tableDataProvider = new TableDataView<T>(
            undefined,
            undefined,
            sortFn,
            filterFn,
            valueGetter,
        );
        // this._asyncDataProvider.onFilterStateChange(() => {
        // 	// this._onFilterStateChange.fire();
        // });
        // this._asyncDataProvider.onSortComplete((args) => {
        // 	// this._onSortComplete.fire(args);
        // });
        // this._tableDataProvider.onFilterStateChange(() => {
        // 	this._onFilterStateChange.fire();
        // });
        // this._tableDataProvider.onSortComplete((args) => {
        // 	this._onSortComplete.fire(args);
        // });
    }

    public get isDataInMemory(): boolean {
        return this._dataCached;
    }

    async getRangeAsync(startIndex: number, length: number): Promise<T[]> {
        return this.provider.getRangeAsync(startIndex, length);
    }

    public async getColumnValues(column: Slick.Column<T>): Promise<string[]> {
        await this.initializeCacheIfNeeded();
        return this.provider.getColumnValues(column);
    }

    public get dataRows(): IObservableCollection<T> {
        return this._asyncDataProvider.dataRows;
    }

    public set dataRows(value: IObservableCollection<T>) {
        this._asyncDataProvider.dataRows = value;
    }

    public getLength(): number {
        return this.provider.getLength();
    }

    public getItem(index: number): T {
        return this.provider.getItem(index);
    }

    public getItems(): T[] {
        throw new Error("Method not implemented.");
    }

    public get length(): number {
        return this.provider.getLength();
    }

    public set length(value: number) {
        this._asyncDataProvider.length = value;
    }

    public async filter(columns: FilterableColumn<T>[]) {
        if (this.thresholdReached) {
            await this.queryResultContext.extensionRpc.sendRequest(
                ShowFilterDisabledMessageRequest.type,
            );
            return;
        }
        await this.initializeCacheIfNeeded();
        void this.provider.filter(columns);
    }

    public async sort(options: Slick.OnSortEventArgs<T>) {
        if (this.thresholdReached) {
            await this.queryResultContext.extensionRpc.sendRequest(
                ShowFilterDisabledMessageRequest.type,
            );
            return;
        }
        await this.initializeCacheIfNeeded();
        void this.provider.sort(options);
    }

    public async resetSort() {
        if (this.thresholdReached) {
            await this.queryResultContext.extensionRpc.sendRequest(
                ShowFilterDisabledMessageRequest.type,
            );
            return;
        }
        void this.provider.resetSort();
    }

    private get thresholdReached(): boolean {
        return (
            this._options.inMemoryDataCountThreshold !== undefined &&
            this.length > this._options.inMemoryDataCountThreshold
        );
    }

    private get provider(): IDisposableDataProvider<T> {
        return this._dataCached ? this._tableDataProvider : this._asyncDataProvider;
    }

    private async initializeCacheIfNeeded() {
        if (!this._options.inMemoryDataProcessing) {
            return;
        }
        if (this.thresholdReached) {
            return;
        }
        if (!this._dataCached) {
            const data = await this._loadDataFn(0, this.length);
            this._dataCached = true;
            this._tableDataProvider.push(data);
        }
    }
}
