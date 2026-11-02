/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { locConstants } from "../../common/locConstants";
import {
    QsCellWindow,
    QsGetRowsRequest,
    QsGridStyle,
    QsResultSetSummary,
} from "../../../sharedInterfaces/queryStudio";
import { cellTextForPurpose } from "../../../sharedInterfaces/queryStudioGridOps";
import { perfMark, perfMarksEnabled } from "../../common/perfMarks";
import type { Rpc } from "./resultsGridShared";

const TEXT_VIEW_CHUNK = 5000;
const MIN_COLUMN_WIDTH = 10;
const DEFAULT_TEXT_VIEW_MAX_ROWS = 100_000;
const DEFAULT_TEXT_VIEW_SAMPLE_ROWS = 1000;

/** Only completed data and text-layout options invalidate materialized text. */
export function textViewContentInput(
    resultSets: readonly QsResultSetSummary[],
    eol: string,
    gridStyle: QsGridStyle | undefined,
): string {
    return JSON.stringify({
        resultSets: resultSets.filter((set) => set.complete),
        eol,
        maxRows: gridStyle?.textViewMaxRows ?? DEFAULT_TEXT_VIEW_MAX_ROWS,
        sampleRows: gridStyle?.textViewSampleRows ?? DEFAULT_TEXT_VIEW_SAMPLE_ROWS,
    });
}

export async function buildTextViewContent(
    rpc: Rpc,
    resultSets: readonly QsResultSetSummary[],
    liveRowCounts: Readonly<Record<string, number>>,
    eol: string,
    gridStyle: Pick<QsGridStyle, "textViewMaxRows" | "textViewSampleRows"> | undefined,
    isCanceled: () => boolean,
): Promise<string> {
    if (resultSets.length === 0) {
        return locConstants.queryResult.noResultsToDisplay;
    }

    // QO-8: text view is a heavy materialization — cap it at the tuning
    // limit with a VISIBLE truncation line (never silent), and compute
    // column widths from a bounded sample instead of every row.
    const maxRows = gridStyle?.textViewMaxRows ?? DEFAULT_TEXT_VIEW_MAX_ROWS;
    const sampleRows = gridStyle?.textViewSampleRows ?? DEFAULT_TEXT_VIEW_SAMPLE_ROWS;
    const blocks: string[] = [];
    for (const summary of resultSets) {
        if (isCanceled()) {
            return "";
        }
        const rowCount = Math.max(summary.rowCount, liveRowCounts[summary.resultSetId] ?? 0);
        const cappedCount = Math.min(rowCount, maxRows);
        const rows = await fetchTextRows(rpc, summary, cappedCount, isCanceled);
        if (isCanceled()) {
            return "";
        }
        if (cappedCount < rowCount && perfMarksEnabled()) {
            perfMark("mssql.queryStudio.textView.capped", {
                totalRows: rowCount,
                renderedRows: cappedCount,
            });
        }
        const columnWidths = computeColumnWidths(summary.columnNames, rows.slice(0, sampleRows));
        const lines: string[] = [];
        lines.push(
            locConstants.queryResult.resultSet(
                summary.batchOrdinal + 1,
                resultSetOrdinal(summary.resultSetId) + 1,
            ),
        );
        lines.push("=".repeat(40));
        lines.push("");
        lines.push(formatTextRow(summary.columnNames, columnWidths));
        lines.push(columnWidths.map((width) => "-".repeat(width)).join("  "));
        for (const row of rows) {
            lines.push(formatTextRow(row, columnWidths));
        }
        if (cappedCount < rowCount) {
            lines.push(
                `… display truncated at ${cappedCount.toLocaleString()} of ${rowCount.toLocaleString()} rows ` +
                    "(save the result set to a file for the full output).",
            );
        }
        lines.push(locConstants.queryResult.rowsAffected(rowCount));
        blocks.push(lines.join(eol));
    }
    return `${blocks.join(eol + eol)}${eol}`;
}

async function fetchTextRows(
    rpc: Rpc,
    summary: QsResultSetSummary,
    rowCount: number,
    isCanceled: () => boolean,
): Promise<string[][]> {
    const rows: string[][] = [];
    for (let start = 0; start < rowCount; start += TEXT_VIEW_CHUNK) {
        if (isCanceled()) {
            break;
        }
        const count = Math.min(TEXT_VIEW_CHUNK, rowCount - start);
        const window = await rpc.sendRequest<
            { resultSetId: string; start: number; count: number; purpose: "text" },
            QsCellWindow
        >(QsGetRowsRequest.type, {
            resultSetId: summary.resultSetId,
            start,
            count,
            purpose: "text",
        });
        const isNull = windowNullFlags(window);
        for (let row = 0; row < window.values.length; row++) {
            const cells: string[] = [];
            for (let column = 0; column < summary.columnNames.length; column++) {
                // Results-to-text is a data-fidelity surface: typed vector
                // cells render their full JSON array, not the grid preview.
                cells.push(
                    isNull(row, column)
                        ? "NULL"
                        : cellTextForPurpose(window.values[row]?.[column], "textView"),
                );
            }
            rows.push(cells);
        }
        if (window.values.length < count) {
            break;
        }
    }
    return rows;
}

function windowNullFlags(window: QsCellWindow): (row: number, column: number) => boolean {
    const bytes = window.nullBitmap ? atob(window.nullBitmap) : undefined;
    const columnCount = window.columns.length;
    return (row, column) => {
        const value = window.values[row]?.[column];
        if (value === undefined || value === null) {
            return true;
        }
        if (!bytes) {
            return false;
        }
        const index = row * columnCount + column;
        const byteIndex = index >> 3;
        return byteIndex < bytes.length && (bytes.charCodeAt(byteIndex) & (1 << (index & 7))) !== 0;
    };
}

function computeColumnWidths(
    columnNames: readonly string[],
    rows: readonly (readonly string[])[],
): number[] {
    const widths = columnNames.map((name) => Math.max(MIN_COLUMN_WIDTH, name.length));
    for (const row of rows) {
        for (let column = 0; column < widths.length; column++) {
            widths[column] = Math.max(widths[column], (row[column] ?? "").length);
        }
    }
    return widths;
}

function formatTextRow(cells: readonly string[], columnWidths: readonly number[]): string {
    return cells
        .map((cell, index) => cell.padEnd(columnWidths[index] ?? MIN_COLUMN_WIDTH))
        .join("  ");
}

function resultSetOrdinal(resultSetId: string): number {
    const ordinal = Number(resultSetId.split("s").pop());
    return Number.isFinite(ordinal) ? ordinal : 0;
}
