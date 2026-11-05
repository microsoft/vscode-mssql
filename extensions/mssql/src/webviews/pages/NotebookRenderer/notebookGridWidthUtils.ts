/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IDbColumn, DbCellValue } from "../../../sharedInterfaces/queryResult";
import { FilterButtonWidth } from "./notebookHeaderMenu.plugin";

export const MIN_COLUMN_WIDTH = 80;
export const MAX_COLUMN_WIDTH = 400;
export const MAX_SAMPLE_ROWS = 50;

// Extra horizontal space inside a header cell beyond the text:
// 8px cell padding (4px each side) + 1px border + 12px sort indicator (8px width + 4px margin) + 1px subpixel rounding = 22px
export const HEADER_TEXT_PADDING = 22;
export const HEADER_EXTRA_WIDTH = HEADER_TEXT_PADDING + FilterButtonWidth;
export const CELL_PADDING = 20 + FilterButtonWidth; // preserve existing cell-content padding

/**
 * Measure the pixel width of a string using a canvas context.
 */
export function measureTextWidth(text: string, font: string): number {
    if (typeof document === "undefined") {
        return text.length * 8;
    }
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        return text.length * 8;
    }
    ctx.font = font;
    return ctx.measureText(text).width;
}

/**
 * Compute optimal column widths by sampling header + data values.
 */
export function computeColumnWidths(
    columns: IDbColumn[],
    rows: DbCellValue[][],
    font: string,
    measureText: (text: string, font: string) => number = measureTextWidth,
): number[] {
    const sampleRows = rows.slice(0, MAX_SAMPLE_ROWS);

    return columns.map((col, colIdx) => {
        let maxWidth = measureText(col.columnName, font) + HEADER_EXTRA_WIDTH;
        for (const row of sampleRows) {
            const cell = row[colIdx];
            if (cell) {
                const val = cell.isNull ? "NULL" : cell.displayValue;
                const truncated = val.length > 250 ? val.slice(0, 250) + "..." : val;
                const w = measureText(truncated, font) + CELL_PADDING;
                if (w > maxWidth) {
                    maxWidth = w;
                }
            }
        }
        return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.ceil(maxWidth)));
    });
}
