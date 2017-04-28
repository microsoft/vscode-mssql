export function formatString(str: string, ...args: any[]): string {
    // This is based on code originally from https://github.com/Microsoft/vscode/blob/master/src/vs/nls.js
    // License: https://github.com/Microsoft/vscode/blob/master/LICENSE.txt
    let result: string;
    if (args.length === 0) {
        result = str;
    } else {
        result = str.replace(/\{(\d+)\}/g, (match, rest) => {
            let index = rest[0];
            return typeof args[index] !== 'undefined' ? args[index] : match;
        });
    }
    return result;
}

export function isNumber(val: any): boolean {
    return typeof(val) === 'number';
}

/**
 * Converts <, >, &, ", ', and any characters that are outside \u00A0 to numeric HTML entity values
 * like &#123;
 * (Adapted from http://stackoverflow.com/a/18750001)
 * @param str String to convert
 * @return String with characters replaced.
 */
export function htmlEntities(str: string): string {
    return typeof(str) === 'string'
        ? str.replace(/[\u00A0-\u9999<>\&"']/gim, (i) => { return `&#${i.charCodeAt(0)};`; })
        : undefined;
}

/**
 * Determines if an object is a DbCellValue based on the properties it exposes
 * @param object The object to check
 * @returns True if the object is a DbCellValue, false otherwise
 */
export function isDbCellValue(object: any): boolean {
    return object !== undefined
        && object.displayValue !== undefined
        && object.isNull !== undefined;
}
