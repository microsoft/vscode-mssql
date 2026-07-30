/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as LocalizedConstants from "../constants/locConstants";
import type { SelectionSummaryMetrics } from "../sharedInterfaces/queryResult";

/**
 * The localized status bar strings for a selection summary.
 */
export interface SelectionSummaryStatusBarStrings {
    text: string;
    tooltip: string;
}

/**
 * Build the localized status bar text and tooltip for a selection summary. A
 * summary is numeric when its metrics include an average: numeric summaries
 * surface Average/Count/Sum with a richer tooltip, while non-numeric summaries
 * fall back to Count/Distinct/Null. Shared by the `.sql` results grid and SQL
 * notebooks so both render identical status bar text.
 * @param metrics The computed selection summary metrics.
 * @returns The localized status bar text and tooltip.
 */
export function buildSelectionSummaryStatusBarStrings(
    metrics: SelectionSummaryMetrics,
): SelectionSummaryStatusBarStrings {
    if (metrics.average !== undefined) {
        const average = metrics.average.toFixed(2);
        return {
            text: LocalizedConstants.QueryResult.numericSelectionSummary(
                average,
                metrics.count,
                metrics.sum ?? 0,
            ),
            tooltip: LocalizedConstants.QueryResult.numericSelectionSummaryTooltip(
                average,
                metrics.count,
                metrics.distinctCount,
                metrics.max ?? 0,
                metrics.min ?? 0,
                metrics.nullCount,
                metrics.sum ?? 0,
            ),
        };
    }

    return {
        text: LocalizedConstants.QueryResult.nonNumericSelectionSummary(
            metrics.count,
            metrics.distinctCount,
            metrics.nullCount,
        ),
        tooltip: LocalizedConstants.QueryResult.nonNumericSelectionSummaryTooltip(
            metrics.count,
            metrics.distinctCount,
            metrics.nullCount,
        ),
    };
}
