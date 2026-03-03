/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Formats a Date using the user's locale with date, time, and fractional seconds.
 * Uses Intl.DateTimeFormat for locale-aware formatting.
 * Example (en-US): "1/29/2026, 2:30:45.123 PM"
 * Example (ru-RU): "29.01.2026, 14:30:45.123"
 *
 * @param date - The Date object to format
 * @param locale - Optional BCP 47 locale string (e.g. "en-US", "de-DE").
 *                 When omitted, uses the runtime's default locale (browser/OS locale).
 *                 Note: In VS Code webviews, the runtime locale is determined by VS Code's
 *                 display language, NOT by Windows custom date-format overrides.
 *                 To test different formats, change VS Code's display language
 *                 (Ctrl+Shift+P → "Configure Display Language") or your OS locale.
 */
/**
 * Returns the Intl.DateTimeFormat options used across all locale-aware date helpers.
 * Centralised so that formatting, parsing, and placeholder generation stay in sync.
 */
function dateTimeFormatOptions(): Intl.DateTimeFormatOptions {
    return {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: undefined, // Let locale decide 12h vs 24h
    };
}

export function formatDateLocale(date: Date, locale?: string): string {
    // Use the user's locale (undefined = browser/OS default)
    const formatted = new Intl.DateTimeFormat(locale, dateTimeFormatOptions()).format(date);

    // Append milliseconds since Intl.DateTimeFormat doesn't support fractional seconds in all environments
    const ms = date.getMilliseconds();
    if (ms > 0) {
        return `${formatted}.${String(ms).padStart(3, "0")}`;
    }
    return formatted;
}

/**
 * Returns a locale-aware example date string for use as an input placeholder.
 * Uses a fixed sample date (March 3, 2026, 14:48:00) so the placeholder clearly
 * demonstrates day/month/year ordering and time format for the current locale.
 *
 * Example outputs:
 *   en-US → "03/03/2026, 02:48:00 PM"
 *   de-DE → "03.03.2026, 14:48:00"
 */
export function getLocaleDatePlaceholder(locale?: string): string {
    const sample = new Date();
    return formatDateLocale(sample, locale);
}

/**
 * Parses a date string written in the user's locale format back into a Date object.
 *
 * Strategy:
 *   1. Try ISO format first ("YYYY-MM-DD HH:mm:ss[.SSS]") for backward compatibility.
 *   2. Use Intl.DateTimeFormat.formatToParts() on a reference date to discover the
 *      locale-specific ordering of year / month / day / hour / minute / second,
 *      then extract the numeric groups from the input in that same order.
 *
 * @param input - The date string to parse (e.g. "03.03.2026, 14:48:00" for de-DE)
 * @param locale - Optional BCP 47 locale string. Omit to use the runtime default.
 * @returns A Date object, or undefined if the input cannot be parsed.
 */
export function parseDateLocale(input: string, locale?: string): Date | undefined {
    if (!input || !input.trim()) {
        return undefined;
    }

    const trimmed = input.trim();

    // 1. Try ISO format first (backward compatibility)
    const ISO_REGEX = /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}(\.\d{1,3})?$/;
    if (ISO_REGEX.test(trimmed)) {
        const d = new Date(trimmed.replace(" ", "T"));
        return isNaN(d.getTime()) ? undefined : d;
    }

    // 2. Parse using locale-aware part ordering
    // Strip trailing milliseconds (e.g. ".123") before locale parsing
    let msValue = 0;
    let corePart = trimmed;
    const msMatch = trimmed.match(/\.(\d{1,3})$/);
    if (msMatch) {
        msValue = parseInt(msMatch[1].padEnd(3, "0"), 10);
        corePart = trimmed.slice(0, -msMatch[0].length);
    }

    // Discover part order by formatting a reference date whose numeric values
    // are all distinct, making each part uniquely identifiable.
    const fmt = new Intl.DateTimeFormat(locale, dateTimeFormatOptions());
    const refDate = new Date();
    const parts = fmt.formatToParts(refDate);

    // Collect the date/time part types in order (skip literals like "/" or ".")
    const datePartTypes = parts
        .filter((p) => p.type !== "literal")
        .map((p) => p.type as Intl.DateTimeFormatPartTypes);

    // Extract all numeric groups from the input
    const numericGroups = corePart.match(/\d+/g);
    if (!numericGroups) {
        return undefined;
    }

    // Check for AM/PM (dayPeriod)
    const hasDayPeriod = datePartTypes.includes("dayPeriod");
    const isPM = /pm/i.test(corePart);
    const isAM = /am/i.test(corePart);

    // For locales with dayPeriod, we expect one fewer numeric group
    // (the period text is not numeric). Map numeric-only part types.
    const numericPartTypes = datePartTypes.filter((t) => t !== "dayPeriod");
    if (numericGroups.length < numericPartTypes.length) {
        return undefined;
    }

    // Build a map of part type → numeric value
    const partMap: Record<string, number> = {};
    for (let i = 0; i < numericPartTypes.length; i++) {
        partMap[numericPartTypes[i]] = parseInt(numericGroups[i], 10);
    }

    const year = partMap["year"];
    const month = partMap["month"];
    const day = partMap["day"];
    let hour = partMap["hour"] ?? 0;
    const minute = partMap["minute"] ?? 0;
    const second = partMap["second"] ?? 0;

    if (year === undefined || month === undefined || day === undefined) {
        return undefined;
    }

    // Adjust hour for 12-hour clocks
    if (hasDayPeriod) {
        if (isPM && hour < 12) {
            hour += 12;
        }
        if (isAM && hour === 12) {
            hour = 0;
        }
    }

    const result = new Date(year, month - 1, day, hour, minute, second, msValue);
    return isNaN(result.getTime()) ? undefined : result;
}

/**
 * Converts a date value (ISO string, Date, or locale-formatted string) to an
 * ISO-like string "YYYY-MM-DD HH:mm:ss[.SSS]" suitable for the filter backend.
 * Returns the original string unchanged if it cannot be parsed.
 */
export function localeDateToISOFilter(input: string, locale?: string): string {
    const date = parseDateLocale(input, locale);
    if (!date) {
        return input;
    }
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const pad3 = (n: number) => String(n).padStart(3, "0");
    const iso = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
    const ms = date.getMilliseconds();
    return ms > 0 ? `${iso}.${pad3(ms)}` : iso;
}

/**
 * Converts an ISO-like date string "YYYY-MM-DD HH:mm:ss[.SSS]" into the
 * user's locale format, so that filter inputs display consistently with column
 * values. Returns the original string if it cannot be parsed.
 */
export function isoToLocaleDate(input: string, locale?: string): string {
    const ISO_REGEX = /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}(\.\d{1,3})?$/;
    if (!ISO_REGEX.test(input)) {
        return input;
    }
    const d = new Date(input.replace(" ", "T"));
    if (isNaN(d.getTime())) {
        return input;
    }
    return formatDateLocale(d, locale);
}
