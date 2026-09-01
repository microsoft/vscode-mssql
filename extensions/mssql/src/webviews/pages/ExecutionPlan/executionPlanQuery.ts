/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Removes separators carried over from the preceding ShowPlan statement without
 * removing the current statement's leading comments or other punctuation.
 */
export function normalizeExecutionPlanQuery(query: string): string {
    return query.replace(/^(?:\s*;\s*)+/, "").trimStart();
}

/**
 * Flattens a server-provided recommendation display string onto a single line so it fits
 * the one-line-per-recommendation layout of the plan header.
 */
export function normalizeRecommendationDisplayString(displayString: string): string {
    return displayString.replace(/\s+/g, " ").trim();
}

export interface ParsedRecommendation {
    /** Estimated impact percentage, when the server string exposed one. */
    impact?: number;
    /** The index script on its own, or the whole string when no prefix was recognized. */
    script: string;
}

/**
 * Splits a recommendation such as "Missing Index (Impact 99.5): CREATE NONCLUSTERED INDEX ..."
 * into its impact figure and its script so the two can be styled separately. Server strings are
 * localized, so anything unrecognized falls back to rendering the text as-is rather than risking
 * a mangled display.
 */
export function parseRecommendationDisplayString(displayString: string): ParsedRecommendation {
    const normalized = normalizeRecommendationDisplayString(displayString);
    const separatorIndex = normalized.indexOf(":");
    const script = separatorIndex === -1 ? "" : normalized.slice(separatorIndex + 1).trim();

    if (!script) {
        return { script: normalized };
    }

    const impactMatch = normalized.slice(0, separatorIndex).match(/(\d+(?:[.,]\d+)?)/);
    const impact = impactMatch ? Number(impactMatch[1].replace(",", ".")) : Number.NaN;

    return { impact: Number.isFinite(impact) ? impact : undefined, script };
}
