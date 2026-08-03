/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DbCellValue, IDbColumn, ISlickRange } from "../../../../sharedInterfaces/queryResult";

export type MaybePromise<T> = T | PromiseLike<T>;

export type FluentResultGridId = string;
export type FluentResultGridColumnId = string;

export type FluentResultGridViewMode = "grid" | "text";

export interface FluentResultGridResultIdentity {
    gridId: FluentResultGridId;
    batchId: number;
    resultId: number;
}

export interface FluentResultGridSelectionContext {
    selection?: readonly ISlickRange[];
}

export interface FluentResultGridColumnContext {
    column?: IDbColumn;
    columnId?: FluentResultGridColumnId;
}

export interface FluentResultGridCellContext {
    rowIndex: number;
    columnIndex: number;
    value: DbCellValue;
    languageId?: string;
}

export interface FluentResultGridPoint {
    x: number;
    y: number;
}

export interface FluentResultGridAnchorRect {
    top: number;
    right: number;
    bottom: number;
    left: number;
    width: number;
    height: number;
}
