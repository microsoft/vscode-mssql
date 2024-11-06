/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ColorThemeKind } from "./vscodeWebviewProvider";

/**
 * Format a string. Behaves like C#'s string.Format() function.
 */
export function formatString(str: string, ...args: any[]): string {
    // This is based on code originally from https://github.com/Microsoft/vscode/blob/master/src/vs/nls.js
    // License: https://github.com/Microsoft/vscode/blob/master/LICENSE.txt
    let result: string;
    if (args.length === 0) {
        result = str;
    } else {
        result = str.replace(/\{(\d+)\}/g, (match, rest) => {
            let index = rest[0];
            return typeof args[index] !== "undefined" ? args[index] : match;
        });
    }
    return result;
}

/**
 * Get the css string representation of a ColorThemeKind
 * @param themeKind The ColorThemeKind to convert
 */
export function resolveVscodeThemeType(themeKind: ColorThemeKind): string {
    switch (themeKind) {
        case ColorThemeKind.Dark:
            return "vs-dark";
        case ColorThemeKind.HighContrast:
            return "hc-black";
        default: // Both hc-light and light themes are treated as light.
            return "light";
    }
}

export function themeType(themeKind: ColorThemeKind): string {
    const themeType = resolveVscodeThemeType(themeKind);
    if (themeType !== "light") {
        return "dark";
    }
    return themeType;
}

/** Removes duplicate values from an array */
export function removeDuplicates<T>(array: T[]): T[] {
    return Array.from(new Set(array));
}
