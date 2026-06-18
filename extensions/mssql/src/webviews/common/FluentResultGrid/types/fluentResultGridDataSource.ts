/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DbCellValue } from "../../../../sharedInterfaces/queryResult";
import type { MaybePromise } from "./fluentResultGridPrimitives";

export type FluentResultGridRow = DbCellValue[];
export type FluentResultGridRows = FluentResultGridRow[];
export type FluentResultGridRowsResult = MaybePromise<FluentResultGridRows>;

export interface FluentResultGridInMemoryDataSource {
    kind: "rows";
    rows: FluentResultGridRows;
    rowCount?: number;
}

export interface FluentResultGridWindowedDataSource {
    kind: "windowed";
    rowCount: number;
    getRows: (offset: number, count: number) => FluentResultGridRowsResult;
}

export type FluentResultGridDataSource =
    | FluentResultGridInMemoryDataSource
    | FluentResultGridWindowedDataSource;
