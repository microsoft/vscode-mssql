/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Regular expression to match JSON objects and arrays
 * Matches strings that start with { or [ and end with } or ] respectively
 */
export const IsJsonRegex = /^\s*(\{[\S\s]*\}|\[[\S\s]*\])\s*$/;

/**
 * Determines if a string value contains valid JSON data
 * Uses a regular expression to quickly check the structure before attempting to parse
 * @param value - string value to check
 * @returns true if the value contains valid JSON, false otherwise
 */
export function isJson(value: string): boolean {
    if (value && value.match(IsJsonRegex)) {
        try {
            JSON.parse(value);
            return true;
        } catch {
            return false;
        }
    }
    return false;
}
