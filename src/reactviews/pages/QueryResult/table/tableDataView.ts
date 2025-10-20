/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ColumnSortState, FilterableColumn } from "./interfaces";
import { IDisposableDataProvider } from "./dataProvider";
import { SortProperties } from "../../../../sharedInterfaces/queryResult";

export interface IFindPosition {
    col: number;
    row: number;
}

export type CellValueGetter = (data: any) => any;
export type TableFilterFunc<T extends Slick.SlickData> = (
    data: Array<T>,
    columns: Slick.Column<T>[],
) => Array<T>;
export type TableSortFunc<T extends Slick.SlickData> = (
    args: Slick.OnSortEventArgs<T>,
    data: Array<T>,
) => Array<T>;
export type TableFindFunc<T extends Slick.SlickData> = (val: T, exp: string) => Array<number>;

export function defaultCellValueGetter(data: any): any {
    return data;
}

export function defaultSort<T extends Slick.SlickData>(
    args: Slick.OnSortEventArgs<T>,
    data: Array<T>,
    cellValueGetter: CellValueGetter = defaultCellValueGetter,
): Array<T> {
    if (!args.sortCol || !args.sortCol.field || data.length === 0) {
        return data;
    }
    const field = args.sortCol.field;
    const sign = args.sortAsc ? 1 : -1;
    const comparer: (a: T, b: T) => number = (a: T, b: T) => {
        const value1 = cellValueGetter(a[field]);
        const value2 = cellValueGetter(b[field]);
        const num1 = Number(value1);
        const num2 = Number(value2);
        const isValue1Number = !isNaN(num1);
        const isValue2Number = !isNaN(num2);
        // Order: undefined -> number -> string
        if (value1 === undefined || value2 === undefined) {
            return value1 === value2 ? 0 : value1 === undefined ? -1 : 1;
        } else if (isValue1Number || isValue2Number) {
            if (isValue1Number && isValue2Number) {
                return num1 === num2 ? 0 : num1 > num2 ? 1 : -1;
            } else {
                return isValue1Number ? -1 : 1;
            }
        } else {
            return compare(value1, value2);
        }
    };

    return data.sort((a, b) => comparer(a, b) * sign);
}

export function defaultFilter<T extends Slick.SlickData>(
    data: T[],
    columns: FilterableColumn<T>[],
    cellValueGetter: CellValueGetter = defaultCellValueGetter,
): T[] {
    let filteredData = data;
    columns?.forEach((column) => {
        if (column.filterValues!?.length > 0 && column.field) {
            filteredData = filteredData.filter((item) => {
                return column.filterValues!.includes(cellValueGetter(item[column.field!]));
            });
        }
    });
    return filteredData;
}

export class TableDataView<T extends Slick.SlickData> implements IDisposableDataProvider<T> {
    //The data exposed publicly, when filter is enabled, _data holds the filtered data.
    private _data: Array<T>;
    //Used when filtering is enabled, _allData holds the complete set of data.
    private _allData!: Array<T>;
    //Used to reset the data when a sort is cleared.
    private _resetSortData: Array<T>;
    // private _resetDataUnfiltered: Array<T>;
    private _findArray?: Array<IFindPosition>;
    private _findIndex?: number;
    private _filterEnabled: boolean;
    private _currentColumnFilters: FilterableColumn<T>[] = [];
    private _currentColumnSort: ColumnSortState<T> | undefined;

    // private _onFilterStateChange = new vscode.EventEmitter<void>();
    // get onFilterStateChange(): vscode.Event<void> { return this._onFilterStateChange.event; }

    // private _onSortComplete = new vscode.EventEmitter<Slick.OnSortEventArgs<T>>();
    // get onSortComplete(): vscode.Event<Slick.OnSortEventArgs<T>> { return this._onSortComplete.event; }

    constructor(
        data?: Array<T>,
        private _findFn?: TableFindFunc<T>,
        private _sortFn?: TableSortFunc<T>,
        private _filterFn?: TableFilterFunc<T>,
        private _cellValueGetter: CellValueGetter = defaultCellValueGetter,
    ) {
        this._resetSortData = [];
        // this._resetDataUnfiltered = [];
        if (data) {
            this._data = data;
        } else {
            this._data = new Array<T>();
        }

        // @todo @anthonydresser 5/1/19 theres a lot we could do by just accepting a regex as a exp rather than accepting a full find function
        this._sortFn = _sortFn
            ? _sortFn
            : (args, data) => {
                  return defaultSort(args, data, _cellValueGetter);
              };
        this._filterFn = _filterFn
            ? _filterFn
            : (data, columns) => {
                  return defaultFilter(data, columns, _cellValueGetter);
              };
        this._filterEnabled = false;
        this._cellValueGetter = this._cellValueGetter
            ? this._cellValueGetter
            : (cellValue) => cellValue?.toString();
    }

    public get isDataInMemory(): boolean {
        return true;
    }

    async getRangeAsync(startIndex: number, length: number): Promise<T[]> {
        return this._data.slice(startIndex, startIndex + length);
    }

    public async getColumnValues(column: Slick.Column<T>): Promise<string[]> {
        const distinctValues: Set<string> = new Set();
        this._data.forEach((items) => {
            const value = items[column.field!];
            const valueArr = value instanceof Array ? value : [value];
            valueArr.forEach((v) => distinctValues.add(this._cellValueGetter(v)));
        });

        return Array.from(distinctValues);
    }

    public get filterEnabled(): boolean {
        return this._filterEnabled;
    }

    public async filter(columns?: Slick.Column<T>[]) {
        if (!this.filterEnabled) {
            this._allData = new Array(...this._data);
            this._filterEnabled = true;
        }
        this._currentColumnFilters = columns!;
        this._data = this._filterFn!(this._allData, columns!);
        if (this._resetSortData.length > 0) {
            this._resetSortData = this._filterFn!(this._resetSortData, columns!);
        }
        if (this._data.length === this._allData.length) {
            await this.clearFilter();
        } else {
            // this._onFilterStateChange.fire();
        }
    }

    public async clearFilter() {
        if (this._filterEnabled) {
            this._data = this._allData;
            if (this._resetSortData.length > 0) {
                this._resetSortData = new Array(...this._allData);
            }
            this._allData = [];
            this._filterEnabled = false;
            if (this._currentColumnSort) {
                this._data = this._sortFn!(
                    {
                        sortCol: this._currentColumnSort.column,
                        sortAsc: this._currentColumnSort.sortDirection === SortProperties.ASC,
                        grid: undefined,
                        multiColumnSort: false,
                    },
                    this._data,
                );
            }
            // this._onFilterStateChange.fire();
        }
    }

    async sort(args: Slick.OnSortEventArgs<T>): Promise<void> {
        if (this._resetSortData.length === 0) {
            this._resetSortData.push(...this._data);
        }

        this._data = this._sortFn!(args, this._data);
        this._currentColumnSort = {
            column: args.sortCol!,
            sortDirection: args.sortAsc ? SortProperties.ASC : SortProperties.DESC,
        };
        // this._onSortComplete.fire(args);
    }

    // Need to consider multiple scenarios:
    // 1. filter is enabled then sort & unsort,
    // 2. filter is not enabled, sort, then enable filter & unsort
    // 3. filter is enabled then sort, and then disabled
    async resetSort(): Promise<void> {
        // Check if the current data set is larger than the original data set.
        // If it is, we need to use the full data set and re-apply the current filters.
        if (this._data.length > this._resetSortData.length) {
            this._data = this._allData;
        } else {
            this._data = this._resetSortData;
        }
        // if there are filters applied, we need to reapply them to the reset data
        if (this._currentColumnFilters.length > 0) {
            this._data = this._filterFn!(this._data, this._currentColumnFilters);
        }
        this._currentColumnSort = undefined;
        this._resetSortData = [];
        // this._resetDataUnfiltered = [];
    }

    getLength(): number {
        return this._data.length;
    }

    getItem(index: number): T {
        return this._data[index];
    }

    getItems(): T[] {
        return this._data.slice();
    }

    getLengthNonFiltered(): number {
        return this.filterEnabled ? this._allData.length : this._data.length;
    }

    push(items: Array<T>): void;
    push(item: T): void;
    push(input: T | Array<T>): void {
        let inputArray = new Array();
        if (Array.isArray(input)) {
            inputArray.push(...input);
        } else {
            inputArray.push(input);
        }

        if (this._filterEnabled) {
            this._allData.push(...inputArray);
            let filteredArray = this._filterFn!(inputArray, this._currentColumnFilters);
            if (filteredArray.length !== 0) {
                this._data.push(...filteredArray);
            }
        } else {
            this._data.push(...inputArray);
        }
        // this._onRowCountChange.fire(this.getLength());
    }

    clear() {
        this._data = new Array<T>();
        if (this._filterEnabled) {
            this._allData = new Array<T>();
        }
        // this._onRowCountChange.fire(this.getLength());
    }

    find(exp: string, maxMatches?: number): Promise<IFindPosition> {
        if (!this._findFn) {
            return Promise.reject(new Error("no find function provided"));
        }
        this._findArray = new Array<IFindPosition>();
        this._findIndex = 0;
        // this._onFindCountChange.fire(this._findArray.length);
        if (exp) {
            return new Promise<IFindPosition>(() => {
                this._startSearch(exp, maxMatches);
            });
        } else {
            return Promise.reject(new Error("no expression"));
        }
    }

    private _startSearch(exp: string, maxMatches: number = 0): void {
        for (let i = 0; i < this._data.length; i++) {
            const item = this._data[i];
            const result = this._findFn!(item, exp);
            let breakout = false;
            if (result) {
                for (let j = 0; j < result.length; j++) {
                    const pos = result[j];
                    const index = { col: pos, row: i };
                    this._findArray!.push(index);
                    // this._onFindCountChange.fire(this._findArray!.length);
                    if (maxMatches > 0 && this._findArray!.length === maxMatches) {
                        breakout = true;
                        break;
                    }
                }
            }

            if (breakout) {
                break;
            }
        }
    }

    clearFind() {
        this._findArray = new Array<IFindPosition>();
        this._findIndex = 0;
        // this._onFindCountChange.fire(this._findArray.length);
    }

    findNext(): Thenable<IFindPosition> {
        if (this._findArray && this._findArray.length !== 0) {
            if (this._findIndex === this._findArray.length - 1) {
                this._findIndex = 0;
            } else {
                ++this._findIndex!;
            }
            return Promise.resolve(this._findArray[this._findIndex!]);
        } else {
            return Promise.reject(new Error("no search running"));
        }
    }

    findPrevious(): Thenable<IFindPosition> {
        if (this._findArray && this._findArray.length !== 0) {
            if (this._findIndex === 0) {
                this._findIndex = this._findArray.length - 1;
            } else {
                --this._findIndex!;
            }
            return Promise.resolve(this._findArray[this._findIndex!]);
        } else {
            return Promise.reject(new Error("no search running"));
        }
    }

    get currentFindPosition(): Thenable<IFindPosition> {
        if (this._findArray && this._findArray.length !== 0) {
            return Promise.resolve(this._findArray[this._findIndex!]);
        } else {
            return Promise.reject(new Error("no search running"));
        }
    }

    /* 1 indexed */
    get findPosition(): number {
        return isUndefinedOrNull(this._findIndex) ? 0 : this._findIndex + 1;
    }

    get findCount(): number {
        return isUndefinedOrNull(this._findArray) ? 0 : this._findArray.length;
    }

    dispose() {
        this._data = [];
        this._allData = [];
        this._findArray = [];
    }
}

/**
 * @returns whether the provided parameter is undefined.
 */
export function isUndefined(obj: unknown): obj is undefined {
    return typeof obj === "undefined";
}

/**
 * @returns whether the provided parameter is undefined or null.
 */
export function isUndefinedOrNull(obj: unknown): obj is undefined | null {
    return isUndefined(obj) || obj === null;
}

export function compare(a: string, b: string): number {
    if (a < b) {
        return -1;
    } else if (a > b) {
        return 1;
    } else {
        return 0;
    }
}
