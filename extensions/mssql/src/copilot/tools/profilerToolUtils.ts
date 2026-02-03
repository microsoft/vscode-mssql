/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Truncates text to a maximum length, adding an ellipsis if truncated.
 * @param text - The text to truncate
 * @param maxLength - Maximum allowed length (default: 512)
 * @returns Object with truncated text and a flag indicating if truncation occurred
 */
export function truncateText(
    text: string | undefined | null,
    maxLength: number = 512,
): { text: string; truncated: boolean } {
    if (!text) {
        return { text: "", truncated: false };
    }

    if (text.length <= maxLength) {
        return { text, truncated: false };
    }

    // Truncate and add ellipsis, ensuring we stay under maxLength
    const truncatedText = text.substring(0, maxLength - 3) + "...";
    return { text: truncatedText, truncated: true };
}

/**
 * Text truncation limits for different contexts
 */
export const TEXT_TRUNCATION_LIMITS = {
    /** Summary view - shorter for list displays */
    SUMMARY: 512,
    /** Detail view - longer for single event inspection */
    DETAIL: 4096,
} as const;

/**
 * Default and maximum limits for query results
 */
export const QUERY_LIMITS = {
    /** Default number of events returned */
    DEFAULT_LIMIT: 50,
    /** Maximum number of events that can be returned */
    MAX_LIMIT: 200,
} as const;
