/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Column, GridOption, SlickGrid } from "slickgrid-react";
import type {
    GridViewState,
    IDbColumn,
    ResultSetSummary,
} from "../../../../sharedInterfaces/queryResult";
import type { FluentResultGridState } from "../types/fluentResultGridState";
import {
    FLUENT_RESULT_GRID_DEFAULT_COLUMN_WIDTH,
    FLUENT_RESULT_GRID_DEFAULT_FONT_SIZE,
    FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID,
} from "./fluentResultGridConstants";
import type { FluentResultGridDataRow } from "./fluentResultGridDataView";
import { getFluentResultGridDataSelectionsFromRanges } from "./fluentResultGridSelection";

export const FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX = 0;

export function applyFluentResultGridColumnWidths(
    columns: Column<FluentResultGridDataRow>[],
    widths: readonly number[],
): { changed: boolean; rerender: boolean } {
    let changed = false;
    let rerender = false;
    for (let index = 0; index < columns.length; index++) {
        const column = columns[index];
        const width = widths[index];
        if (!column || typeof width !== "number" || column.width === width) {
            continue;
        }
        changed = true;
        rerender ||= column.rerenderOnResize === true;
        column.width = width;
    }
    return { changed, rerender };
}

export function shouldApplyFluentResultGridFrozenOptions(
    options: Pick<
        GridOption,
        | "alwaysShowVerticalScroll"
        | "enableMouseWheelScrollHandler"
        | "frozenColumn"
        | "skipFreezeColumnValidation"
    >,
    columnIndex: number,
): boolean {
    return (
        options.alwaysShowVerticalScroll !== false ||
        options.enableMouseWheelScrollHandler !== true ||
        (options.frozenColumn ?? -1) !== columnIndex ||
        options.skipFreezeColumnValidation !== true
    );
}

export function normalizeFluentResultGridRowPadding(rowPadding: number | null | undefined): number {
    return typeof rowPadding === "number" && Number.isFinite(rowPadding)
        ? Math.max(0, rowPadding)
        : 0;
}

export function getFluentResultGridRowHeight(
    rowHeight: number | undefined,
    rowPadding: number,
): number {
    return rowHeight ?? FLUENT_RESULT_GRID_DEFAULT_FONT_SIZE + 12 + rowPadding * 2;
}

export function normalizeFluentResultGridFrozenColumnIndex(
    value: number | undefined,
    columnCount: number,
): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX;
    }

    return Math.min(
        Math.max(FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX, Math.trunc(value)),
        Math.max(FLUENT_RESULT_GRID_DEFAULT_FROZEN_COLUMN_INDEX, columnCount - 1),
    );
}

export function createFluentResultGridColumnSignature(columnInfo: readonly IDbColumn[]): string {
    return columnInfo
        .map((column) =>
            [
                column.columnName,
                column.dataType,
                column.isXml ? "xml" : "",
                column.isJson ? "json" : "",
                column.isVector ? "vector" : "",
            ].join(","),
        )
        .join("|");
}

export function createFluentResultGridIdentitySignature({
    gridId,
    resultSetSummary,
    columnSignature,
}: {
    gridId: string;
    resultSetSummary: ResultSetSummary;
    columnSignature: string;
}): string {
    return [gridId, resultSetSummary.batchId, resultSetSummary.id, columnSignature].join("|");
}

export function getFluentResultGridCurrentColumnWidths(
    grid: SlickGrid,
    columnCount: number,
): number[] {
    const columnWidths = new Array<number>(columnCount);
    grid.getColumns().forEach((column) => {
        if (column.id === FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID) {
            return;
        }

        const columnIndex = Number(column.field);
        if (Number.isInteger(columnIndex)) {
            columnWidths[columnIndex] = column.width ?? FLUENT_RESULT_GRID_DEFAULT_COLUMN_WIDTH;
        }
    });

    return columnWidths.map((width) => width ?? FLUENT_RESULT_GRID_DEFAULT_COLUMN_WIDTH);
}

function isFluentResultGridStateDataColumn(column: Column<FluentResultGridDataRow>): boolean {
    return column.id !== FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID && !column.excludeFromGridMenu;
}

export function getFluentResultGridCurrentViewState({
    grid,
    allColumns,
    frozenColumnIndex,
}: {
    grid: SlickGrid;
    allColumns?: Column<FluentResultGridDataRow>[];
    frozenColumnIndex: number;
}): GridViewState {
    const columnsForState = allColumns?.length
        ? allColumns
        : (grid.getColumns() as Column<FluentResultGridDataRow>[]);
    const selectedRanges = grid.getSelectionModel()?.getSelectedRanges() ?? [];

    return {
        hiddenColumnIds: columnsForState
            .filter(isFluentResultGridStateDataColumn)
            .filter((column) => !!column.hidden)
            .map((column) => column.id.toString()),
        frozenColumnIndex: normalizeFluentResultGridFrozenColumnIndex(
            grid.getOptions().frozenColumn ?? frozenColumnIndex,
            columnsForState.length,
        ),
        selection: getFluentResultGridDataSelectionsFromRanges(selectedRanges),
    };
}

export function getFluentResultGridStateForEmit({
    grid,
    allColumns,
    columnCount,
    frozenColumnIndex,
    initialState,
    filters,
    sort,
}: {
    grid: SlickGrid;
    allColumns?: Column<FluentResultGridDataRow>[];
    columnCount: number;
    frozenColumnIndex: number;
    initialState?: FluentResultGridState;
    filters: FluentResultGridState["filters"];
    sort: FluentResultGridState["sort"];
}): FluentResultGridState {
    const viewport = grid.getViewport();
    return {
        ...(initialState ?? {}),
        ...getFluentResultGridCurrentViewState({
            grid,
            allColumns,
            frozenColumnIndex,
        }),
        columnWidths: getFluentResultGridCurrentColumnWidths(grid, columnCount),
        filters,
        sort,
        scrollPosition: {
            scrollLeft: viewport.leftPx,
            scrollTop: viewport.top,
        },
    };
}
