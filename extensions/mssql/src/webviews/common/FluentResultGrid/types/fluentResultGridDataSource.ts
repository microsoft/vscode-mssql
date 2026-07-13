/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DbCellValue } from "../../../../sharedInterfaces/queryResult";
import type { MaybePromise } from "./fluentResultGridPrimitives";

export type FluentResultGridRow = DbCellValue[];
export type FluentResultGridRows = FluentResultGridRow[];
export type FluentResultGridRowsResult = MaybePromise<FluentResultGridRows>;

/**
 * Contiguous source-column span needed by the live viewport. The data source
 * still returns rows in the full logical column space (unrequested cells may
 * be sparse/undefined), so SlickGrid field ordinals and command semantics do
 * not change when viewport projection is enabled.
 */
export interface FluentResultGridColumnWindow {
    start: number;
    count: number;
}

export interface FluentResultGridColumnWindowingOptions {
    /** Do not project schemas narrower than this; default 64 columns. */
    minimumColumnCount?: number;
    /** Source columns retained on each side of the visible span; default 8. */
    overscanColumnCount?: number;
}

export interface FluentResultGridInMemoryDataSource {
    kind: "rows";
    rows: FluentResultGridRows;
    rowCount?: number;
}

export interface FluentResultGridWindowedDataSource {
    kind: "windowed";
    rowCount: number;
    /** Opt in to horizontal viewport projection for wide sources. */
    columnWindowing?: FluentResultGridColumnWindowingOptions;
    /**
     * columnWindow is present only for viewport reads. Calls without it are
     * authoritative full-row reads used by sort/filter/autosize/commands.
     */
    getRows: (
        offset: number,
        count: number,
        columnWindow?: FluentResultGridColumnWindow,
    ) => FluentResultGridRowsResult;
}

export type FluentResultGridDataSource =
    | FluentResultGridInMemoryDataSource
    | FluentResultGridWindowedDataSource;
