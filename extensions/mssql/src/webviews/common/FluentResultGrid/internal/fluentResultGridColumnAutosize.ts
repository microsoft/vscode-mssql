/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SlickGrid } from "slickgrid-react";
import {
    FLUENT_RESULT_GRID_AUTO_SIZE_CELL_PADDING_WIDTH,
    FLUENT_RESULT_GRID_AUTO_SIZE_HEADER_EXTRA_WIDTH,
    FLUENT_RESULT_GRID_MAX_COLUMN_WIDTH,
    FLUENT_RESULT_GRID_MIN_COLUMN_WIDTH,
    FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID,
} from "./fluentResultGridConstants";

export function getFluentResultGridColumnResizeDoubleClickTarget(
    detail:
        | {
              args?: {
                  grid?: SlickGrid;
                  triggeredByColumn?: string;
              };
          }
        | undefined,
): { grid: SlickGrid; columnId: string } | undefined {
    const grid = detail?.args?.grid;
    const columnId = detail?.args?.triggeredByColumn;
    return grid && columnId !== undefined ? { grid, columnId } : undefined;
}

/**
 * Fits a single column against fetched rows. Columns are re-read after the asynchronous fetch so
 * concurrent resize/reorder changes are preserved, and the resize notification persists the fit.
 */
export async function autoSizeFluentResultGridColumnByContent<TRow>({
    grid,
    columnId,
    getSampleRows,
    getCellText,
    measureText,
}: {
    grid: SlickGrid;
    columnId: string;
    getSampleRows: () => Promise<TRow[]>;
    getCellText: (row: TRow, columnDataIndex: number) => string;
    measureText: (text: string) => number;
}): Promise<void> {
    const initialColumns = grid.getColumns();
    const initialColumnIndex = initialColumns.findIndex(
        (column) => column.id?.toString() === columnId,
    );
    const initialColumn = initialColumns[initialColumnIndex];
    if (
        !initialColumn ||
        initialColumnIndex < 0 ||
        initialColumn.id === FLUENT_RESULT_GRID_ROW_NUMBER_COLUMN_ID ||
        initialColumn.resizable === false
    ) {
        return;
    }

    const sampleRows = await getSampleRows();

    const columns = grid.getColumns();
    const columnIndex = columns.findIndex((candidate) => candidate.id?.toString() === columnId);
    const column = columns[columnIndex];
    if (!column || columnIndex < 0 || column.resizable === false) {
        return;
    }

    const headerWidth =
        measureText(String(column.name ?? "")) + FLUENT_RESULT_GRID_AUTO_SIZE_HEADER_EXTRA_WIDTH;
    const columnDataIndex = Number(column.field);
    const dataWidth = Number.isInteger(columnDataIndex)
        ? sampleRows.reduce(
              (maxWidth, row) =>
                  Math.max(
                      maxWidth,
                      measureText(getCellText(row, columnDataIndex)) +
                          FLUENT_RESULT_GRID_AUTO_SIZE_CELL_PADDING_WIDTH,
                  ),
              0,
          )
        : 0;

    const fittedWidth = Math.max(
        FLUENT_RESULT_GRID_MIN_COLUMN_WIDTH,
        Math.min(
            FLUENT_RESULT_GRID_MAX_COLUMN_WIDTH,
            Math.ceil(Math.max(headerWidth, dataWidth)) + 1,
        ),
    );
    if (fittedWidth === column.width) {
        return;
    }

    grid.setColumns(
        columns.map((candidate, index) =>
            index === columnIndex ? { ...candidate, width: fittedWidth } : candidate,
        ),
    );
    grid.invalidate();
    grid.onColumnsResized.notify({ grid, triggeredByColumn: columnId });
}
