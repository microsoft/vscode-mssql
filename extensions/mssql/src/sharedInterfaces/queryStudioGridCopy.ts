/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { QsCellWindow } from "./queryStudio";
import { cellTextForPurpose } from "./queryStudioGridOps";
import { queryStudioWindowNullFlags } from "./queryStudioGridWindow";

/**
 * Pure planning for Query Studio grid copies. The planner intentionally works
 * with inclusive intervals instead of materializing every selected row/cell:
 * a 100-million-row selection must be rejected in constant selection-space.
 */

export interface QueryStudioGridCopyRange {
    fromRow: number;
    toRow: number;
    fromCell: number;
    toCell: number;
}

export interface QueryStudioGridCopyInterval {
    from: number;
    to: number;
}

export interface QueryStudioGridCopyRowBand {
    fromRow: number;
    toRow: number;
    /** Selected data-column intervals for every row in this band. */
    columnRuns: QueryStudioGridCopyInterval[];
}

export interface QueryStudioGridCopyPlan {
    /** Normalized, bounds-clamped selection rectangles. */
    ranges: QueryStudioGridCopyRange[];
    /** Contiguous source-row runs that must be fetched. */
    rowRuns: QueryStudioGridCopyInterval[];
    /** Contiguous projected column runs that must be fetched. */
    columnRuns: QueryStudioGridCopyInterval[];
    /** Row bands with identical selected-column coverage. */
    rowBands: QueryStudioGridCopyRowBand[];
    rowCount: number;
    columnCount: number;
    /** Cells in the SSMS-style row-union x column-union output matrix. */
    outputCellCount: number;
}

export interface QueryStudioGridCopyLimits {
    maxRanges: number;
    maxRows: number;
    maxOutputCells: number;
}

export const QUERY_STUDIO_GRID_COPY_DEFAULT_LIMITS: QueryStudioGridCopyLimits = {
    // Row-band planning is proportional to active selection rectangles. This
    // also prevents a synthetic command from using millions of tiny ranges.
    maxRanges: 1_024,
    maxRows: 100_000,
    // Bounds transport, decoded-cell objects, sparse-union blanks, and TSV
    // field-array work independently of the eventual character-size guard.
    maxOutputCells: 1_000_000,
};

/** Large narrow copies amortize fetch overhead but never retain more rows. */
export const QUERY_STUDIO_COPY_MAX_ROWS_PER_WINDOW = 8_192;
/** Responsive raw-value working set for one copy window. */
export const QUERY_STUDIO_COPY_TARGET_DECODED_CELLS_PER_WINDOW = 8_192;
/** Approx. 16 MiB UTF-16 payload, before the clipboard's own copy. */
export const QUERY_STUDIO_COPY_MAX_TSV_CHARACTERS = 8_000_000;

export interface QueryStudioGridCopyTextOptions {
    readonly plan: QueryStudioGridCopyPlan;
    readonly columnNames: readonly string[];
    readonly includeHeaders: boolean;
    /** Fetches raw, horizontally-projected values; no display-clamped window may be used. */
    readonly getRows: (
        start: number,
        count: number,
        columns: { start: number; count: number },
    ) => Promise<QsCellWindow>;
}

export type QueryStudioGridCopyTextResult =
    | {
          kind: "copied";
          text: string;
          characters: number;
          fetchCount: number;
          fetchMs: number;
          formatMs: number;
          windowRows: number;
      }
    | {
          kind: "tooLarge" | "empty";
          characters: number;
          fetchCount: number;
          fetchMs: number;
          formatMs: number;
          windowRows: number;
      };

export type QueryStudioGridCopyPlanResult =
    | { kind: "ok"; plan: QueryStudioGridCopyPlan }
    | { kind: "empty" }
    | { kind: "tooLarge"; reason: "ranges" | "rows" | "cells" };

function finiteInteger(value: number): number | undefined {
    return Number.isFinite(value) ? Math.trunc(value) : undefined;
}

function availableCount(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
        return 0;
    }
    return Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(value));
}

function normalizeAxis(
    firstValue: number,
    secondValue: number,
    count: number,
): QueryStudioGridCopyInterval | undefined {
    const first = finiteInteger(firstValue);
    const second = finiteInteger(secondValue);
    if (first === undefined || second === undefined || count <= 0) {
        return undefined;
    }
    const low = Math.min(first, second);
    const high = Math.max(first, second);
    if (high < 0 || low >= count) {
        return undefined;
    }
    return {
        from: Math.max(0, low),
        to: Math.min(count - 1, high),
    };
}

/** Merge overlapping or adjacent inclusive intervals without expanding them. */
export function mergeQueryStudioGridCopyIntervals(
    intervals: readonly QueryStudioGridCopyInterval[],
): QueryStudioGridCopyInterval[] {
    if (intervals.length === 0) {
        return [];
    }
    const sorted = intervals
        .map((interval) => ({ from: interval.from, to: interval.to }))
        .sort((a, b) => a.from - b.from || a.to - b.to);
    const merged: QueryStudioGridCopyInterval[] = [];
    for (const interval of sorted) {
        const previous = merged[merged.length - 1];
        if (!previous || interval.from > previous.to + 1) {
            merged.push(interval);
        } else if (interval.to > previous.to) {
            previous.to = interval.to;
        }
    }
    return merged;
}

function intervalCount(intervals: readonly QueryStudioGridCopyInterval[]): number {
    return intervals.reduce((count, interval) => count + interval.to - interval.from + 1, 0);
}

/** Bounds-clamped selected-column runs, useful for the headers-only command. */
export function queryStudioGridCopyColumnRuns(
    selection: readonly QueryStudioGridCopyRange[],
    availableColumnCount: number,
): QueryStudioGridCopyInterval[] {
    const columnCount = availableCount(availableColumnCount);
    return mergeQueryStudioGridCopyIntervals(
        selection
            .map((range) => normalizeAxis(range.fromCell, range.toCell, columnCount))
            .filter((interval): interval is QueryStudioGridCopyInterval => interval !== undefined),
    );
}

function sameIntervals(
    left: readonly QueryStudioGridCopyInterval[],
    right: readonly QueryStudioGridCopyInterval[],
): boolean {
    return (
        left.length === right.length &&
        left.every(
            (interval, index) =>
                interval.from === right[index].from && interval.to === right[index].to,
        )
    );
}

function buildRowBands(ranges: readonly QueryStudioGridCopyRange[]): QueryStudioGridCopyRowBand[] {
    const events = new Map<number, { add: number[]; remove: number[] }>();
    const eventAt = (row: number) => {
        let event = events.get(row);
        if (!event) {
            event = { add: [], remove: [] };
            events.set(row, event);
        }
        return event;
    };
    ranges.forEach((range, index) => {
        eventAt(range.fromRow).add.push(index);
        eventAt(range.toRow + 1).remove.push(index);
    });

    const coordinates = [...events.keys()].sort((a, b) => a - b);
    const active = new Set<number>();
    const bands: QueryStudioGridCopyRowBand[] = [];
    for (let index = 0; index + 1 < coordinates.length; index++) {
        const coordinate = coordinates[index];
        const event = events.get(coordinate)!;
        event.remove.forEach((rangeIndex) => active.delete(rangeIndex));
        event.add.forEach((rangeIndex) => active.add(rangeIndex));
        const next = coordinates[index + 1];
        if (active.size === 0 || next <= coordinate) {
            continue;
        }
        const columnRuns = mergeQueryStudioGridCopyIntervals(
            [...active].map((rangeIndex) => ({
                from: ranges[rangeIndex].fromCell,
                to: ranges[rangeIndex].toCell,
            })),
        );
        const previous = bands[bands.length - 1];
        if (
            previous &&
            previous.toRow + 1 === coordinate &&
            sameIntervals(previous.columnRuns, columnRuns)
        ) {
            previous.toRow = next - 1;
        } else {
            bands.push({ fromRow: coordinate, toRow: next - 1, columnRuns });
        }
    }
    return bands;
}

/**
 * Normalize a SlickGrid-style selection and produce a bounded execution plan.
 * All cardinality checks use interval arithmetic and happen before any row or
 * column index is enumerated.
 */
export function planQueryStudioGridCopy(
    selection: readonly QueryStudioGridCopyRange[],
    availableRowCount: number,
    availableColumnCount: number,
    limits: QueryStudioGridCopyLimits = QUERY_STUDIO_GRID_COPY_DEFAULT_LIMITS,
): QueryStudioGridCopyPlanResult {
    const rows = availableCount(availableRowCount);
    const columns = availableCount(availableColumnCount);
    if (selection.length === 0 || rows === 0 || columns === 0) {
        return { kind: "empty" };
    }
    if (selection.length > Math.max(0, Math.trunc(limits.maxRanges))) {
        return { kind: "tooLarge", reason: "ranges" };
    }

    const ranges: QueryStudioGridCopyRange[] = [];
    for (const range of selection) {
        const row = normalizeAxis(range.fromRow, range.toRow, rows);
        const column = normalizeAxis(range.fromCell, range.toCell, columns);
        if (row && column) {
            ranges.push({
                fromRow: row.from,
                toRow: row.to,
                fromCell: column.from,
                toCell: column.to,
            });
        }
    }
    if (ranges.length === 0) {
        return { kind: "empty" };
    }

    const rowRuns = mergeQueryStudioGridCopyIntervals(
        ranges.map((range) => ({ from: range.fromRow, to: range.toRow })),
    );
    const columnRuns = mergeQueryStudioGridCopyIntervals(
        ranges.map((range) => ({ from: range.fromCell, to: range.toCell })),
    );
    const rowCount = intervalCount(rowRuns);
    const columnCount = intervalCount(columnRuns);
    const maxRows = Math.max(0, Math.trunc(limits.maxRows));
    const maxOutputCells = Math.max(0, Math.trunc(limits.maxOutputCells));
    if (rowCount > maxRows) {
        return { kind: "tooLarge", reason: "rows" };
    }
    // Division avoids overflowing while evaluating rowCount * columnCount.
    if (rowCount > 0 && columnCount > Math.floor(maxOutputCells / rowCount)) {
        return { kind: "tooLarge", reason: "cells" };
    }

    return {
        kind: "ok",
        plan: {
            ranges,
            rowRuns,
            columnRuns,
            rowBands: buildRowBands(ranges),
            rowCount,
            columnCount,
            outputCellCount: rowCount * columnCount,
        },
    };
}

/**
 * Assemble one exact TSV payload from an already bounded copy plan. This is
 * deliberately shared by the webview and extension host: large-result copy
 * can keep raw cells host-side, while ordinary copies retain the direct
 * webview clipboard path without two subtly different formatters.
 */
export async function buildQueryStudioGridCopyText(
    options: QueryStudioGridCopyTextOptions,
): Promise<QueryStudioGridCopyTextResult> {
    const { plan, columnNames, includeHeaders, getRows } = options;
    let fetchCount = 0;
    let fetchMs = 0;
    let formatMs = 0;
    let characters = 0;
    const windowRows = Math.max(
        1,
        Math.min(
            QUERY_STUDIO_COPY_MAX_ROWS_PER_WINDOW,
            Math.floor(QUERY_STUDIO_COPY_TARGET_DECODED_CELLS_PER_WINDOW / plan.columnCount),
        ),
    );
    const textSegments: string[] = [];
    let lineCount = 0;
    const appendLine = (line: string): boolean => {
        const added = line.length + (lineCount > 0 ? 1 : 0);
        if (characters + added > QUERY_STUDIO_COPY_MAX_TSV_CHARACTERS) {
            return false;
        }
        if (lineCount > 0) {
            textSegments.push("\n");
        }
        textSegments.push(line);
        characters += added;
        lineCount++;
        return true;
    };

    if (includeHeaders) {
        const headerStarted = performance.now();
        const headers: string[] = [];
        for (const run of plan.columnRuns) {
            for (let column = run.from; column <= run.to; column++) {
                headers.push(columnNames[column] ?? "");
            }
        }
        const appended = appendLine(headers.join("\t"));
        formatMs += Math.max(0, performance.now() - headerStarted);
        if (!appended) {
            return { kind: "tooLarge", characters, fetchCount, fetchMs, formatMs, windowRows };
        }
    }

    let rowBandIndex = 0;
    for (const rowRun of plan.rowRuns) {
        let start = rowRun.from;
        while (start <= rowRun.to) {
            const requestedRows = Math.min(windowRows, rowRun.to - start + 1);
            const fetchedRuns: Array<{
                window: QsCellWindow;
                isNull: (row: number, column: number) => boolean;
            }> = [];
            let returnedRows = requestedRows;
            for (const run of plan.columnRuns) {
                const fetchStarted = performance.now();
                const window = await getRows(start, requestedRows, {
                    start: run.from,
                    count: run.to - run.from + 1,
                });
                fetchMs += Math.max(0, performance.now() - fetchStarted);
                fetchCount++;
                fetchedRuns.push({ window, isNull: queryStudioWindowNullFlags(window) });
                returnedRows = Math.min(returnedRows, window.rowCount);
            }
            if (returnedRows === 0) {
                break;
            }

            const formatStarted = performance.now();
            for (let rowOffset = 0; rowOffset < returnedRows; rowOffset++) {
                const sourceRow = start + rowOffset;
                while (
                    rowBandIndex + 1 < plan.rowBands.length &&
                    plan.rowBands[rowBandIndex].toRow < sourceRow
                ) {
                    rowBandIndex++;
                }
                const selectedColumns = plan.rowBands[rowBandIndex]?.columnRuns ?? [];
                let selectedRunIndex = 0;
                const fields: string[] = [];
                let prospectiveCharacters = characters + (lineCount > 0 ? 1 : 0);
                for (let runIndex = 0; runIndex < plan.columnRuns.length; runIndex++) {
                    const run = plan.columnRuns[runIndex];
                    const fetched = fetchedRuns[runIndex];
                    const rowValues = fetched?.window.values[rowOffset];
                    for (let column = run.from; column <= run.to; column++) {
                        while (
                            selectedRunIndex < selectedColumns.length &&
                            selectedColumns[selectedRunIndex].to < column
                        ) {
                            selectedRunIndex++;
                        }
                        const selected =
                            selectedRunIndex < selectedColumns.length &&
                            selectedColumns[selectedRunIndex].from <= column;
                        const projectedColumn = column - run.from;
                        const value = !selected
                            ? ""
                            : fetched.isNull(rowOffset, projectedColumn)
                              ? "NULL"
                              : cellTextForPurpose(rowValues?.[projectedColumn], "copy");
                        prospectiveCharacters += value.length + (fields.length > 0 ? 1 : 0);
                        if (prospectiveCharacters > QUERY_STUDIO_COPY_MAX_TSV_CHARACTERS) {
                            formatMs += Math.max(0, performance.now() - formatStarted);
                            return {
                                kind: "tooLarge",
                                characters,
                                fetchCount,
                                fetchMs,
                                formatMs,
                                windowRows,
                            };
                        }
                        fields.push(value);
                    }
                }
                if (!appendLine(fields.join("\t"))) {
                    formatMs += Math.max(0, performance.now() - formatStarted);
                    return {
                        kind: "tooLarge",
                        characters,
                        fetchCount,
                        fetchMs,
                        formatMs,
                        windowRows,
                    };
                }
            }
            formatMs += Math.max(0, performance.now() - formatStarted);
            start += returnedRows;
        }
    }

    const joinStarted = performance.now();
    const text = textSegments.join("");
    formatMs += Math.max(0, performance.now() - joinStarted);
    return { kind: "copied", text, characters, fetchCount, fetchMs, formatMs, windowRows };
}
