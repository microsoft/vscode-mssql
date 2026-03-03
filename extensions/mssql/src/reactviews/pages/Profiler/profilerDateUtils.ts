/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Formats a Date using the user's locale with date, time, and fractional seconds.
 * Uses Intl.DateTimeFormat for locale-aware formatting.
 * Example (en-US): "1/29/2026, 2:30:45.123 PM"
 * Example (ru-RU): "29.01.2026, 14:30:45.123"
 */
export function formatDateLocale(date: Date): string {
    // Use the user's locale (undefined = browser default)
    const formatted = new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: undefined, // Let locale decide 12h vs 24h
    }).format(date);

    // Append milliseconds since Intl.DateTimeFormat doesn't support fractional seconds in all environments
    const ms = date.getMilliseconds();
    if (ms > 0) {
        return `${formatted}.${String(ms).padStart(3, "0")}`;
    }
    return formatted;
}
