/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const xmlParser = new DOMParser();

/**
 * Determines if a string value has the shape of XML data by checking if it starts with '<' and ends with '>'
 * @param value - string value to check
 * @returns true if the value has the shape of XML, false otherwise
 */
function isXmlShape(value: string): boolean {
    const trimmedValue = value?.trim();
    return !!trimmedValue && trimmedValue.startsWith("<") && trimmedValue.endsWith(">");
}

/**
 * Determines if a string value contains valid XML data
 * First checks if the value has the shape of XML to avoid unnecessary parsing, then attempts to parse and checks for errors
 * @param value - string value to check
 * @returns true if the value contains valid XML, false otherwise
 */
export function isXmlCell(value: string): boolean {
    if (!isXmlShape(value)) {
        return false;
    }
    try {
        // Script elements if any are not evaluated during parsing
        var doc = xmlParser.parseFromString(value, "text/xml");
        // For non-XMLs, parsererror element is present in the parsed document.
        var parserErrors = doc.getElementsByTagName("parsererror");
        return parserErrors?.length === 0;
    } catch (e) {
        return false;
    }
}
