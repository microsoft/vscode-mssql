/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    formatDateLocale,
    getLocaleDatePlaceholder,
    parseDateLocale,
    localeDateToISOFilter,
    isoToLocaleDate,
} from "../../../src/reactviews/pages/Profiler/profilerDateUtils";

suite("profilerDateUtils", () => {
    // Fixed date: January 29, 2026 14:30:45.123 (local time)
    const testDate = new Date(2026, 0, 29, 14, 30, 45, 123);
    // Fixed date without milliseconds
    const testDateNoMs = new Date(2026, 0, 29, 14, 30, 45, 0);

    suite("formatDateLocale", () => {
        test("should format date in en-US locale (MM/DD/YYYY, 12h)", () => {
            const result = formatDateLocale(testDate, "en-US");
            // en-US: "01/29/2026, 02:30:45 PM.123"
            expect(result).to.include("01/29/2026");
            expect(result).to.include("02:30:45");
            expect(result).to.include("PM");
            expect(result).to.include(".123");
        });

        test("should format date in de-DE locale (DD.MM.YYYY, 24h)", () => {
            const result = formatDateLocale(testDate, "de-DE");
            // de-DE: "29.01.2026, 14:30:45.123"
            expect(result).to.include("29.01.2026");
            expect(result).to.include("14:30:45");
            expect(result).to.not.include("AM");
            expect(result).to.not.include("PM");
            expect(result).to.include(".123");
        });

        test("should format date in ja-JP locale (YYYY/MM/DD, 24h)", () => {
            const result = formatDateLocale(testDate, "ja-JP");
            // ja-JP: "2026/01/29 14:30:45.123"
            expect(result).to.include("2026/01/29");
            expect(result).to.include("14:30:45");
            expect(result).to.include(".123");
        });

        test("should format date in fr-FR locale (DD/MM/YYYY, 24h)", () => {
            const result = formatDateLocale(testDate, "fr-FR");
            // fr-FR: "29/01/2026 14:30:45.123"
            expect(result).to.include("29/01/2026");
            expect(result).to.include("14:30:45");
            expect(result).to.include(".123");
        });

        test("should format date in ko-KR locale (YYYY. MM. DD., 12h)", () => {
            const result = formatDateLocale(testDate, "ko-KR");
            // ko-KR uses year, month, day with periods and 12h with AM/PM (오전/오후)
            expect(result).to.include("2026");
            expect(result).to.include("01");
            expect(result).to.include("29");
            expect(result).to.include(".123");
        });

        test("should format date in pt-BR locale (DD/MM/YYYY, 24h)", () => {
            const result = formatDateLocale(testDate, "pt-BR");
            // pt-BR: "29/01/2026 14:30:45.123"
            expect(result).to.include("29/01/2026");
            expect(result).to.include("14:30:45");
            expect(result).to.include(".123");
        });

        test("should not append milliseconds when ms is 0", () => {
            const result = formatDateLocale(testDateNoMs, "en-US");
            // Should end at seconds, no trailing ".000"
            expect(result).to.not.include(".000");
            expect(result).to.include("02:30:45");
        });

        test("should pad milliseconds to 3 digits", () => {
            const dateWithShortMs = new Date(2026, 0, 29, 14, 30, 45, 5);
            const result = formatDateLocale(dateWithShortMs, "en-US");
            expect(result).to.include(".005");
        });

        test("should produce different formats for different locales", () => {
            const enUS = formatDateLocale(testDate, "en-US");
            const deDE = formatDateLocale(testDate, "de-DE");
            const jaJP = formatDateLocale(testDate, "ja-JP");

            // All three should be different string representations of the same date
            expect(enUS).to.not.equal(deDE);
            expect(enUS).to.not.equal(jaJP);
            expect(deDE).to.not.equal(jaJP);
        });

        test("should use default locale when locale parameter is omitted", () => {
            // When no locale is passed, it should still format without error
            const result = formatDateLocale(testDate);
            expect(result).to.be.a("string");
            expect(result.length).to.be.greaterThan(0);
            // Should still contain the date components
            expect(result).to.include("2026");
            expect(result).to.include("30"); // minute
            expect(result).to.include("45"); // second
            expect(result).to.include(".123"); // milliseconds
        });

        test("should use default locale when locale parameter is undefined", () => {
            const result = formatDateLocale(testDate, undefined);
            expect(result).to.be.a("string");
            expect(result.length).to.be.greaterThan(0);
            expect(result).to.include("2026");
        });

        test("should handle midnight correctly", () => {
            const midnight = new Date(2026, 0, 1, 0, 0, 0, 0);
            const resultUS = formatDateLocale(midnight, "en-US");
            // en-US midnight is 12:00:00 AM
            expect(resultUS).to.include("12:00:00");
            expect(resultUS).to.include("AM");

            const resultDE = formatDateLocale(midnight, "de-DE");
            // de-DE midnight is 00:00:00
            expect(resultDE).to.include("00:00:00");
        });

        test("should handle noon correctly", () => {
            const noon = new Date(2026, 0, 1, 12, 0, 0, 0);
            const resultUS = formatDateLocale(noon, "en-US");
            // en-US noon is 12:00:00 PM
            expect(resultUS).to.include("12:00:00");
            expect(resultUS).to.include("PM");

            const resultDE = formatDateLocale(noon, "de-DE");
            // de-DE noon is 12:00:00
            expect(resultDE).to.include("12:00:00");
        });

        test("should handle end-of-year date", () => {
            const endOfYear = new Date(2026, 11, 31, 23, 59, 59, 999);
            const resultUS = formatDateLocale(endOfYear, "en-US");
            expect(resultUS).to.include("12/31/2026");
            expect(resultUS).to.include(".999");

            const resultDE = formatDateLocale(endOfYear, "de-DE");
            expect(resultDE).to.include("31.12.2026");
            expect(resultDE).to.include(".999");
        });

        test("should verify en-US uses 12-hour format and de-DE uses 24-hour format", () => {
            // 2 PM
            const afternoon = new Date(2026, 5, 15, 14, 0, 0, 0);

            const resultUS = formatDateLocale(afternoon, "en-US");
            expect(resultUS).to.include("PM");
            expect(resultUS).to.include("02:00:00");

            const resultDE = formatDateLocale(afternoon, "de-DE");
            expect(resultDE).to.include("14:00:00");
            expect(resultDE).to.not.include("AM");
            expect(resultDE).to.not.include("PM");
        });
    });

    suite("getLocaleDatePlaceholder", () => {
        test("should return a formatted sample date for en-US", () => {
            const result = getLocaleDatePlaceholder("en-US");
            // Sample date is March 3, 2026, 14:48:00
            expect(result).to.include("03/03/2026");
            expect(result).to.include("02:48:00");
            expect(result).to.include("PM");
        });

        test("should return a formatted sample date for de-DE", () => {
            const result = getLocaleDatePlaceholder("de-DE");
            expect(result).to.include("03.03.2026");
            expect(result).to.include("14:48:00");
        });

        test("should return a formatted sample date for ja-JP", () => {
            const result = getLocaleDatePlaceholder("ja-JP");
            expect(result).to.include("2026/03/03");
            expect(result).to.include("14:48:00");
        });

        test("should work without locale parameter", () => {
            const result = getLocaleDatePlaceholder();
            expect(result).to.be.a("string");
            expect(result.length).to.be.greaterThan(0);
            expect(result).to.include("2026");
        });
    });

    suite("parseDateLocale", () => {
        test("should parse ISO format (backward compatibility)", () => {
            const result = parseDateLocale("2026-01-29 14:30:45");
            expect(result).to.not.be.undefined;
            expect(result!.getFullYear()).to.equal(2026);
            expect(result!.getMonth()).to.equal(0); // January
            expect(result!.getDate()).to.equal(29);
            expect(result!.getHours()).to.equal(14);
            expect(result!.getMinutes()).to.equal(30);
            expect(result!.getSeconds()).to.equal(45);
        });

        test("should parse ISO format with T separator", () => {
            const result = parseDateLocale("2026-01-29T14:30:45");
            expect(result).to.not.be.undefined;
            expect(result!.getFullYear()).to.equal(2026);
        });

        test("should parse ISO format with milliseconds", () => {
            const result = parseDateLocale("2026-01-29 14:30:45.123");
            expect(result).to.not.be.undefined;
            expect(result!.getMilliseconds()).to.equal(123);
        });

        test("should parse de-DE formatted date", () => {
            const result = parseDateLocale("29.01.2026, 14:30:45", "de-DE");
            expect(result).to.not.be.undefined;
            expect(result!.getFullYear()).to.equal(2026);
            expect(result!.getMonth()).to.equal(0); // January
            expect(result!.getDate()).to.equal(29);
            expect(result!.getHours()).to.equal(14);
            expect(result!.getMinutes()).to.equal(30);
            expect(result!.getSeconds()).to.equal(45);
        });

        test("should parse de-DE formatted date with milliseconds", () => {
            const result = parseDateLocale("29.01.2026, 14:30:45.123", "de-DE");
            expect(result).to.not.be.undefined;
            expect(result!.getMilliseconds()).to.equal(123);
        });

        test("should parse en-US formatted date with AM/PM", () => {
            const result = parseDateLocale("01/29/2026, 02:30:45 PM", "en-US");
            expect(result).to.not.be.undefined;
            expect(result!.getFullYear()).to.equal(2026);
            expect(result!.getMonth()).to.equal(0);
            expect(result!.getDate()).to.equal(29);
            expect(result!.getHours()).to.equal(14); // 2 PM = 14
            expect(result!.getMinutes()).to.equal(30);
            expect(result!.getSeconds()).to.equal(45);
        });

        test("should parse en-US AM date correctly", () => {
            const result = parseDateLocale("01/29/2026, 02:30:45 AM", "en-US");
            expect(result).to.not.be.undefined;
            expect(result!.getHours()).to.equal(2);
        });

        test("should parse en-US 12 AM as midnight", () => {
            const result = parseDateLocale("01/29/2026, 12:00:00 AM", "en-US");
            expect(result).to.not.be.undefined;
            expect(result!.getHours()).to.equal(0);
        });

        test("should parse en-US 12 PM as noon", () => {
            const result = parseDateLocale("01/29/2026, 12:00:00 PM", "en-US");
            expect(result).to.not.be.undefined;
            expect(result!.getHours()).to.equal(12);
        });

        test("should parse ja-JP formatted date", () => {
            const result = parseDateLocale("2026/01/29 14:30:45", "ja-JP");
            expect(result).to.not.be.undefined;
            expect(result!.getFullYear()).to.equal(2026);
            expect(result!.getMonth()).to.equal(0);
            expect(result!.getDate()).to.equal(29);
            expect(result!.getHours()).to.equal(14);
        });

        test("should parse fr-FR formatted date", () => {
            const result = parseDateLocale("29/01/2026 14:30:45", "fr-FR");
            expect(result).to.not.be.undefined;
            expect(result!.getFullYear()).to.equal(2026);
            expect(result!.getMonth()).to.equal(0);
            expect(result!.getDate()).to.equal(29);
        });

        test("should return undefined for empty string", () => {
            expect(parseDateLocale("")).to.be.undefined;
            expect(parseDateLocale("  ")).to.be.undefined;
        });

        test("should return undefined for non-date string", () => {
            expect(parseDateLocale("not a date")).to.be.undefined;
        });

        test("should return undefined for partial date", () => {
            expect(parseDateLocale("2026-01-29", "de-DE")).to.be.undefined;
        });

        test("should roundtrip: format then parse for de-DE", () => {
            const original = new Date(2026, 2, 3, 14, 48, 0, 0);
            const formatted = formatDateLocale(original, "de-DE");
            const parsed = parseDateLocale(formatted, "de-DE");
            expect(parsed).to.not.be.undefined;
            expect(parsed!.getFullYear()).to.equal(original.getFullYear());
            expect(parsed!.getMonth()).to.equal(original.getMonth());
            expect(parsed!.getDate()).to.equal(original.getDate());
            expect(parsed!.getHours()).to.equal(original.getHours());
            expect(parsed!.getMinutes()).to.equal(original.getMinutes());
            expect(parsed!.getSeconds()).to.equal(original.getSeconds());
        });

        test("should roundtrip: format then parse for en-US", () => {
            const original = new Date(2026, 2, 3, 14, 48, 0, 0);
            const formatted = formatDateLocale(original, "en-US");
            const parsed = parseDateLocale(formatted, "en-US");
            expect(parsed).to.not.be.undefined;
            expect(parsed!.getFullYear()).to.equal(original.getFullYear());
            expect(parsed!.getMonth()).to.equal(original.getMonth());
            expect(parsed!.getDate()).to.equal(original.getDate());
            expect(parsed!.getHours()).to.equal(original.getHours());
            expect(parsed!.getMinutes()).to.equal(original.getMinutes());
            expect(parsed!.getSeconds()).to.equal(original.getSeconds());
        });

        test("should roundtrip: format then parse with milliseconds", () => {
            const original = new Date(2026, 2, 3, 14, 48, 0, 123);
            const formatted = formatDateLocale(original, "de-DE");
            const parsed = parseDateLocale(formatted, "de-DE");
            expect(parsed).to.not.be.undefined;
            expect(parsed!.getMilliseconds()).to.equal(123);
        });
    });

    suite("localeDateToISOFilter", () => {
        test("should convert de-DE locale date to ISO format", () => {
            const result = localeDateToISOFilter("29.01.2026, 14:30:45", "de-DE");
            expect(result).to.equal("2026-01-29 14:30:45");
        });

        test("should convert en-US locale date to ISO format", () => {
            const result = localeDateToISOFilter("01/29/2026, 02:30:45 PM", "en-US");
            expect(result).to.equal("2026-01-29 14:30:45");
        });

        test("should preserve milliseconds", () => {
            const result = localeDateToISOFilter("29.01.2026, 14:30:45.123", "de-DE");
            expect(result).to.equal("2026-01-29 14:30:45.123");
        });

        test("should return original string if unparseable", () => {
            const result = localeDateToISOFilter("not a date", "de-DE");
            expect(result).to.equal("not a date");
        });

        test("should pass through ISO format unchanged", () => {
            const result = localeDateToISOFilter("2026-01-29 14:30:45");
            expect(result).to.equal("2026-01-29 14:30:45");
        });
    });

    suite("isoToLocaleDate", () => {
        test("should convert ISO to de-DE format", () => {
            const result = isoToLocaleDate("2026-01-29 14:30:45", "de-DE");
            expect(result).to.include("29.01.2026");
            expect(result).to.include("14:30:45");
        });

        test("should convert ISO to en-US format", () => {
            const result = isoToLocaleDate("2026-01-29 14:30:45", "en-US");
            expect(result).to.include("01/29/2026");
            expect(result).to.include("02:30:45");
            expect(result).to.include("PM");
        });

        test("should handle ISO with T separator", () => {
            const result = isoToLocaleDate("2026-01-29T14:30:45", "de-DE");
            expect(result).to.include("29.01.2026");
        });

        test("should return original string for non-ISO input", () => {
            const result = isoToLocaleDate("not an iso date", "de-DE");
            expect(result).to.equal("not an iso date");
        });

        test("should preserve milliseconds in locale format", () => {
            const result = isoToLocaleDate("2026-01-29 14:30:45.123", "de-DE");
            expect(result).to.include(".123");
        });
    });
});
