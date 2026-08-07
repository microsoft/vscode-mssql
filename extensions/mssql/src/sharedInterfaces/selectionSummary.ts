/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SelectionSummaryMetrics } from "./queryResult";

/**
 * A single selected grid cell reduced to the two facts the summary needs: whether
 * the cell is SQL NULL, and its displayed text (used for distinct and numeric
 * aggregation when the cell is not null).
 */
export interface SelectionCell {
    isNull: boolean;
    text: string;
}

/**
 * Compute selection summary metrics from the selected cells. This mirrors the
 * aggregation the SQL Tools Service performs for the `.sql` results grid so SQL
 * notebooks can show the same status bar summary without a live result set (for
 * example, when a saved notebook is reopened). Cells are consumed lazily so even a
 * very large selection is aggregated in a single pass without materializing an
 * intermediate array.
 * @param cells The selected cells, already stripped of the row-number column.
 * @returns The computed metrics, or undefined when the selection is empty.
 */
export function summarizeSelectionCells(
    cells: Iterable<SelectionCell>,
): SelectionSummaryMetrics | undefined {
    const distinctValues = new Set<string>();
    let count = 0;
    let nullCount = 0;
    let numericCount = 0;
    let sum = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    for (const cell of cells) {
        count++;
        if (cell.isNull) {
            nullCount++;
            continue;
        }

        distinctValues.add(cell.text);

        const numericValue = toFiniteNumber(cell.text);
        if (numericValue !== undefined) {
            numericCount++;
            sum += numericValue;
            min = Math.min(min, numericValue);
            max = Math.max(max, numericValue);
        }
    }

    if (count === 0) {
        return undefined;
    }

    const metrics: SelectionSummaryMetrics = {
        count,
        distinctCount: distinctValues.size,
        nullCount,
    };

    // Average/sum/min/max only make sense — and only mark the summary as "numeric" —
    // when at least one selected cell parsed as a finite number.
    if (numericCount > 0) {
        metrics.average = sum / numericCount;
        metrics.sum = sum;
        metrics.min = min;
        metrics.max = max;
    }

    return metrics;
}

/**
 * Parse a cell's displayed text as a finite number, or undefined when it is blank
 * or non-numeric. Blank text is treated as non-numeric so empty cells do not skew
 * the average toward zero.
 * @param text The cell's displayed text.
 * @returns The parsed finite number, or undefined when the text is not numeric.
 */
function toFiniteNumber(text: string): number | undefined {
    if (text.trim().length === 0) {
        return undefined;
    }
    const value = Number(text);
    return Number.isFinite(value) ? value : undefined;
}
