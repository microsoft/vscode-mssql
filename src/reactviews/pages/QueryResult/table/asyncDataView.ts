/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IDisposableDataProvider } from './dataProvider';

export interface IObservableCollection<T> {
	getLength(): number;
	at(index: number): T;
	getRange(start: number, end: number): T[];
	setCollectionChangedCallback(callback: (startIndex: number, count: number) => void): void;
	setLength(length: number): void;
}

export interface ISlickColumn<T> extends Slick.Column<T> {
	isEditable?: boolean;
}

export class AsyncDataProvider<T extends Slick.SlickData> implements IDisposableDataProvider<T> {

	private _onFilterStateChange = new vscode.EventEmitter<void>();
	get onFilterStateChange(): vscode.Event<void> { return this._onFilterStateChange.event; }

	private _onSortComplete = new vscode.EventEmitter<Slick.OnSortEventArgs<T>>();
	get onSortComplete(): vscode.Event<Slick.OnSortEventArgs<T>> { return this._onSortComplete.event; }

	constructor(public dataRows: IObservableCollection<T>) {
	}

	public get isDataInMemory(): boolean {
		return false;
	}

	getRangeAsync(startIndex: number, length: number): Promise<T[]> {
		throw new Error('Method not implemented.');
	}

	getColumnValues(column: Slick.Column<T>): Promise<string[]> {
		throw new Error('Method not implemented.');
	}

	sort(options: Slick.OnSortEventArgs<T>): Promise<void> {
		throw new Error('Method not implemented.');
	}

	filter(columns?: Slick.Column<T>[]): Promise<void> {
		throw new Error('Method not implemented.');
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
		throw new Error('Method not supported.');
	}
}
