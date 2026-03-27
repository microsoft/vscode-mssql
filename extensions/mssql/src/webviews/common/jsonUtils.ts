/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Determines if a string value has the shape of a JSON object or array
 * @param value - string value to check
 * @returns true if the value has the shape of a JSON object or array, false otherwise
 */
function isJsonShape(value: string): boolean {
    const trimmedValue = value?.trim();
    return (
        !!trimmedValue &&
        ((trimmedValue.startsWith("{") && trimmedValue.endsWith("}")) ||
            (trimmedValue.startsWith("[") && trimmedValue.endsWith("]")))
    );
}

/**
 * Determines if a string value contains valid JSON data
 * Uses a regular expression to quickly check the structure before attempting to parse
 * @param value - string value to check
 * @returns true if the value contains valid JSON, false otherwise
 */
export function isJson(value: string): boolean {
    if (isJsonShape(value)) {
        try {
            JSON.parse(value);
            return true;
        } catch {
            return false;
        }
    }
    return false;
}
