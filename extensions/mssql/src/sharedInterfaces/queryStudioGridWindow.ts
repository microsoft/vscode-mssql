/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DbCellValue } from "./queryResult";
import type { QsCellWindow } from "./queryStudio";
import {
    QS_CELL_DISPLAY_CLAMP,
    cellDocumentLanguage,
    cellDisplayText,
    cellTextForPurpose,
    clampDisplay,
} from "./queryStudioGridOps";

/** Decode one window's null bitmap into projected-cell null flags. */
export function queryStudioWindowNullFlags(
    window: QsCellWindow,
): (row: number, col: number) => boolean {
    const bytes = window.nullBitmap ? atob(window.nullBitmap) : undefined;
    const colCount = window.columns.length;
    return (row, col) => {
        const value = window.values[row]?.[col];
        if (value === undefined || value === null) {
            return true;
        }
        if (!bytes) {
            return false;
        }
        const index = row * colCount + col;
        const byteIndex = index >> 3;
        return byteIndex < bytes.length && (bytes.charCodeAt(byteIndex) & (1 << (index & 7))) !== 0;
    };
}

/**
 * Convert a contiguous wire window into the grid's full source-column space.
 * Cells outside the projected span remain sparse placeholders; source field
 * ordinals, row ids, nulls, and rich-cell language metadata remain stable.
 */
export function queryStudioWindowToGridRows(
    window: QsCellWindow,
    totalColumnCount: number,
    columnStart = 0,
    clamp = true,
): DbCellValue[][] {
    const isNull = queryStudioWindowNullFlags(window);
    return window.values.map((row, rowIndex) => {
        const cells = new Array<DbCellValue>(totalColumnCount);
        for (let projectedColumn = 0; projectedColumn < window.columns.length; projectedColumn++) {
            const sourceColumn = columnStart + projectedColumn;
            if (sourceColumn < 0 || sourceColumn >= totalColumnCount) {
                continue;
            }
            const nulled = isNull(rowIndex, projectedColumn);
            const value = row[projectedColumn];
            const text = nulled
                ? ""
                : clamp
                  ? cellDisplayText(value)
                  : cellTextForPurpose(value, "copy");
            const metadata = window.columns[projectedColumn];
            const languageId = nulled
                ? undefined
                : cellDocumentLanguage(value, {
                      sqlType: metadata?.sqlType,
                      typeHint: window.typeHints?.[projectedColumn],
                      isXml: metadata?.isXml,
                      isJson: metadata?.isJson,
                  });
            cells[sourceColumn] = {
                displayValue: clamp ? clampDisplay(text, QS_CELL_DISPLAY_CLAMP) : text,
                isNull: nulled,
                rowId: window.start + rowIndex,
                ...(languageId ? { languageId } : {}),
            };
        }
        return cells;
    });
}
