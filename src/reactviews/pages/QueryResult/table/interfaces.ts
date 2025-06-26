/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ColumnFilterState, SortProperties } from "../../../../sharedInterfaces/queryResult";
import { IDisposableDataProvider } from "./dataProvider";
import { SortDirection } from "./plugins/headerFilter.plugin";

export interface ITableMouseEvent {
    anchor: HTMLElement | { x: number; y: number };
    cell?: { row: number; cell: number };
}

export interface ITableStyles {
    listFocusBackground: string | undefined;
    listFocusForeground: string | undefined;
    listActiveSelectionBackground: string | undefined;
    listActiveSelectionForeground: string | undefined;
    listFocusAndSelectionBackground: string | undefined;
    listFocusAndSelectionForeground: string | undefined;
    listInactiveFocusBackground: string | undefined;
    listInactiveSelectionBackground: string | undefined;
    listInactiveSelectionForeground: string | undefined;
    listHoverBackground: string | undefined;
    listHoverForeground: string | undefined;
    listDropBackground: string | undefined;
    listFocusOutline: string | undefined;
    listSelectionOutline: string | undefined;
    listHoverOutline: string | undefined;
    listInactiveFocusOutline: string | undefined;
    tableHeaderBackground: string | undefined;
    tableHeaderForeground: string | undefined;
}

export interface ITableSorter<T extends Slick.SlickData> {
    (args: Slick.OnSortEventArgs<T>): void;
}

export interface ITableConfiguration<T extends Slick.SlickData> {
    dataProvider?: IDisposableDataProvider<T> | Array<T>;
    columns?: Slick.Column<T>[];
    sorter?: ITableSorter<T>;
}

export interface GridFilters {
    gridId: string;
    columnFilters: ColumnFilterState;
}

export interface GridSortState {
    field: string;
    sortAsc: boolean;
}
export interface FilterableColumn<T extends Slick.SlickData> extends Slick.Column<T> {
    filterable?: boolean;
    filterValues?: Array<string>;
    sorted?: SortProperties;
}

export interface ColumnSortState<T extends Slick.SlickData> {
    column: Slick.Column<T>;
    sortDirection: SortDirection;
}

export interface ITableKeyboardEvent {
    cell?: { row: number; cell: number };
    event: KeyboardEvent;
}

export const defaultTableStyles: ITableStyles = {
    listFocusBackground: "var(--vscode-list-focusBackground)",
    listFocusForeground: "var(--vscode-list-focusForeground)",
    listActiveSelectionBackground: "var(--vscode-list-activeSelectionBackground)",
    listActiveSelectionForeground: "var(--vscode-list-activeSelectionForeground)",
    listFocusAndSelectionBackground: "var(--vscode-list-activeSelectionBackground)", // "var(--vscode-list-focusAndSelectionBackground)"  not defined
    listFocusAndSelectionForeground: "var(--vscode-list-activeSelectionForeground)", // "var(--vscode-list-focusAndSelectionBackground)"  not defined
    listInactiveFocusBackground: undefined,
    listInactiveSelectionBackground: "var(--vscode-list-inactiveSelectionBackground)",
    listInactiveSelectionForeground: undefined,
    listHoverBackground: "var(--vscode-list-hoverBackground)",
    listHoverForeground: "var(--vscode-list-hoverForeground)",
    listDropBackground: "var(--vscode-list-dropBackground)",
    listFocusOutline: "var(--vscode-contrastActiveBorder)",
    listSelectionOutline: "var(--vscode-contrastActiveBorder)",
    listHoverOutline: "var(--vscode-contrastActiveBorder)",
    listInactiveFocusOutline: "var(--vscode-list-inactiveFocusOutline)",
    tableHeaderBackground: "var(--vscode-keybindingTable-headerBackground)",
    tableHeaderForeground: "var(--vscode-foreground)",
};
