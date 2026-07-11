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

/** #rgb, #rrggbb, or #rrggbbaa → [r,g,b] 0..255; undefined when unparsable. */
export function parseHexColor(color: string): [number, number, number] | undefined {
    const raw = color.trim().replace(/^#/, "");
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

/**
 * Text color for an accent background: near-white on dark, near-black on
 * light. The 0.4 threshold biases toward white text — mid-tones (saturated
 * reds/blues typical of group colors) read better inverted-light.
 * Unparsable colors get white (accents default to strong/dark hues).
 */
export function accentTextColor(background: string): string {
    const rgb = parseHexColor(background);
    if (!rgb) {
        return "#ffffff";
    }
    return relativeLuminance(rgb) > 0.4 ? "#1e1e1e" : "#ffffff";
}
