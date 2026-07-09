/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from "react";
import { VscodeEditor } from "../../common/vscodeMonaco";
import { locConstants } from "../../common/locConstants";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import {
    QsCellWindow,
    QsGetRowsRequest,
    QsGridStyle,
    QsResultSetSummary,
    QsState,
} from "../../../sharedInterfaces/queryStudio";
import { cellDisplayText } from "../../../sharedInterfaces/queryStudioGridOps";
import { perfMark, perfMarksEnabled } from "../../common/perfMarks";
import type { Rpc } from "./resultsGrid";

const TEXT_VIEW_CHUNK = 5000;
const MIN_COLUMN_WIDTH = 10;
const DEFAULT_TEXT_VIEW_MAX_ROWS = 100_000;
const DEFAULT_TEXT_VIEW_SAMPLE_ROWS = 1000;

export function QueryStudioResultsTextView(props: {
    rpc: Rpc;
    resultSets: readonly QsResultSetSummary[];
    liveRowCounts: Readonly<Record<string, number>>;
    gridStyle: QsGridStyle | undefined;
}) {
    const { rpc, resultSets, liveRowCounts, gridStyle } = props;
    const { EOL, themeKind } = useVscodeWebview<QsState, void>();
    const [textContent, setTextContent] = useState("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let canceled = false;
        setLoading(true);
        void buildTextViewContent(rpc, resultSets, liveRowCounts, EOL, gridStyle)
            .then((content) => {
                if (!canceled) {
                    setTextContent(content);
                    setLoading(false);
                }
            })
            .catch(() => {
                if (!canceled) {
                    setTextContent(locConstants.queryResult.errorGeneratingTextView);
                    setLoading(false);
                }
            });
        return () => {
            canceled = true;
        };
    }, [EOL, liveRowCounts, resultSets, rpc, gridStyle]);

    if (loading) {
        return (
            <div className="qs-text-view-loading">{locConstants.queryResult.loadingTextView}</div>
        );
    }

    return (
        <div className="qs-text-view">
            <VscodeEditor
                width="100%"
                height="100%"
                language="plaintext"
                themeKind={themeKind}
                value={textContent || locConstants.queryResult.noResultsToDisplay}
                options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    wordWrap: "off",
                    fontFamily: gridStyle?.fontFamily || "var(--vscode-editor-font-family)",
                    fontSize: gridStyle?.fontSize || 12,
                    lineNumbers: "off",
                    glyphMargin: false,
                    folding: false,
                    lineDecorationsWidth: 0,
                    lineNumbersMinChars: 0,
                    renderLineHighlight: "none",
                    automaticLayout: true,
                    scrollbar: {
                        vertical: "auto",
                        horizontal: "auto",
                    },
                }}
            />
        </div>
    );
}

async function buildTextViewContent(
    rpc: Rpc,
    resultSets: readonly QsResultSetSummary[],
    liveRowCounts: Readonly<Record<string, number>>,
    eol: string,
    gridStyle: QsGridStyle | undefined,
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
        const rowCount = Math.max(summary.rowCount, liveRowCounts[summary.resultSetId] ?? 0);
        const cappedCount = Math.min(rowCount, maxRows);
        const rows = await fetchTextRows(rpc, summary, cappedCount);
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
): Promise<string[][]> {
    const rows: string[][] = [];
    for (let start = 0; start < rowCount; start += TEXT_VIEW_CHUNK) {
        const count = Math.min(TEXT_VIEW_CHUNK, rowCount - start);
        const window = await rpc.sendRequest<
            { resultSetId: string; start: number; count: number },
            QsCellWindow
        >(QsGetRowsRequest.type, {
            resultSetId: summary.resultSetId,
            start,
            count,
        });
        const isNull = windowNullFlags(window);
        for (let row = 0; row < window.values.length; row++) {
            const cells: string[] = [];
            for (let column = 0; column < summary.columnNames.length; column++) {
                cells.push(
                    isNull(row, column) ? "NULL" : cellDisplayText(window.values[row]?.[column]),
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
