/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Accent-color contrast (production-safety status bar): given an arbitrary
 * background color, pick a text color that stays readable — WCAG relative
 * luminance decides between near-white and near-black. Shared interface
 * module: pure, no vscode, usable from both the extension host and
 * webviews.
 */

/** #rgb, #rrggbb, #rrggbbaa, or rgb()/rgba() → [r,g,b]; undefined when unparsable. */
export function parseHexColor(color: string): [number, number, number] | undefined {
    const trimmed = color.trim();
    const rgbMatch = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(trimmed);
    if (rgbMatch) {
        return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
    }
    const raw = trimmed.replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(raw)) {
        return [
            parseInt(raw[0] + raw[0], 16),
            parseInt(raw[1] + raw[1], 16),
            parseInt(raw[2] + raw[2], 16),
        ];
    }
    if (/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(raw)) {
        return [
            parseInt(raw.slice(0, 2), 16),
            parseInt(raw.slice(2, 4), 16),
            parseInt(raw.slice(4, 6), 16),
        ];
    }
    return undefined;
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance(rgb: [number, number, number]): number {
    const [r, g, b] = rgb.map((channel) => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors (1..21). */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
}

const NEAR_BLACK: [number, number, number] = [31, 31, 31]; // #1f1f1f
const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

/**
 * Text color for an accent background — the curated-candidates approach
 * (Karl 2026-07-10): classify by CONTRAST RATIO against a small set of
 * known-good text colors instead of a raw luminance threshold.
 *  - light backgrounds → soft near-black (#1f1f1f reads calmer than pure
 *    black on pastel group colors);
 *  - dark backgrounds → white;
 *  - awkward mid-tones where neither clears WCAG AA (4.5:1) → whichever of
 *    pure black/white scores strictly higher (the best any single color
 *    can do).
 * Unparsable colors get white (accents default to strong/dark hues).
 */
export function accentTextColor(background: string): string {
    const rgb = parseHexColor(background);
    if (!rgb) {
        return "#ffffff";
    }
    if (contrastRatio(rgb, NEAR_BLACK) >= 4.5) {
        return "#1f1f1f";
    }
    if (contrastRatio(rgb, WHITE) >= 4.5) {
        return "#ffffff";
    }
    return contrastRatio(rgb, BLACK) > contrastRatio(rgb, WHITE) ? "#000000" : "#ffffff";
}
