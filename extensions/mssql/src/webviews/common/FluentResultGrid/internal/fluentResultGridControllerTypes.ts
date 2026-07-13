/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    FocusEvent as ReactFocusEvent,
    KeyboardEvent as ReactKeyboardEvent,
    RefObject,
} from "react";
import type { Column, GridOption, SlickgridReactInstance } from "slickgrid-react";
import type { DbCellValue } from "../../../../sharedInterfaces/queryResult";
import type { FluentResultGridCommandContext } from "../types/fluentResultGridCommands";
import type { FluentResultGridProps } from "../types/fluentResultGridProps";
import type { FluentResultGridDataRow, FluentResultGridDataView } from "./fluentResultGridDataView";

export type SourceRow = {
    rowId: number;
    cells: DbCellValue[];
};

export type ReactGridInstanceWithSharedService = SlickgridReactInstance & {
    sharedService?: {
        allColumns?: Column<FluentResultGridDataRow>[];
        gridOptions?: GridOption;
        frozenVisibleColumnId?: string | number | null;
    };
};

export type FluentResultGridActiveCell = {
    row: number;
    cell: number;
};

export type FluentResultGridActiveDataColumn = {
    active: FluentResultGridActiveCell;
    column: Column<FluentResultGridDataRow>;
};

export type FluentResultGridControllerOptions = FluentResultGridProps & {
    containerRef: RefObject<HTMLDivElement | null>;
};

export interface FluentResultGridControllerResult {
    columns: Column<FluentResultGridDataRow>[];
    commandContext: FluentResultGridCommandContext;
    dataView: FluentResultGridDataView<FluentResultGridDataRow>;
    dataViewKey: number;
    displayedRowCount: number;
    focusGrid: () => void;
    selectAll: () => boolean;
    scrollToRow: (rowIndex: number) => boolean;
    scrollToColumn: (columnIndex: number) => boolean;
    gridOptions: GridOption;
    handleBeforeHeaderCellDestroy: (event: CustomEvent) => void;
    handleClick: (event: CustomEvent) => void;
    handleCommand: FluentResultGridProps["onCommand"];
    handleContextMenu: (event: CustomEvent) => void;
    handleGridContainerBlur: (event: ReactFocusEvent<HTMLDivElement>) => void;
    handleGridContainerFocus: (event: ReactFocusEvent<HTMLDivElement>) => void;
    handleGridKeyDownCapture: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
    handleHeaderCellRendered: (event: CustomEvent) => void;
    handleHeaderClick: (event: CustomEvent) => void;
    handleHeaderContextMenu: (event: CustomEvent) => void;
    handleReactGridCreated: (event: CustomEvent<SlickgridReactInstance>) => void;
    isGridFocused: boolean;
    toolbar: FluentResultGridProps["toolbar"];
    commands: FluentResultGridProps["commands"];
    emptyDataset: FluentResultGridDataRow[];
}
