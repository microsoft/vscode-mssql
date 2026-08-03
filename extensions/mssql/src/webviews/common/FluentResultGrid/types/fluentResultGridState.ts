/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    ColumnFilterMap,
    GridViewState,
    SortProperties,
} from "../../../../sharedInterfaces/queryResult";
import type { FluentResultGridColumnId } from "./fluentResultGridPrimitives";

export type FluentResultGridHeightMode =
    | { kind: "fill" }
    | {
          kind: "contentCapped";
          maxHeight: number;
          minHeight?: number;
      };

export interface FluentResultGridSortState {
    columnId: FluentResultGridColumnId;
    direction: SortProperties;
}

export interface FluentResultGridScrollPosition {
    scrollTop: number;
    scrollLeft: number;
}

export interface FluentResultGridState extends GridViewState {
    columnWidths?: number[];
    filters?: ColumnFilterMap;
    sort?: FluentResultGridSortState;
    scrollPosition?: FluentResultGridScrollPosition;
}
