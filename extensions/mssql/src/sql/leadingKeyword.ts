/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Return the first SQL keyword after whitespace and comments. Block comments
 * may nest in T-SQL, including when the outer comment closes mid-line.
 */
export function leadingKeyword(text: string): string | undefined {
    let index = 0;
    let blockDepth = 0;
    while (index < text.length) {
        const character = text[index];
        const next = text[index + 1];
        if (blockDepth > 0) {
            if (character === "/" && next === "*") {
                blockDepth++;
                index += 2;
            } else if (character === "*" && next === "/") {
                blockDepth--;
                index += 2;
            } else {
                index++;
            }
            continue;
        }
        if (character === "/" && next === "*") {
            blockDepth = 1;
            index += 2;
            continue;
        }
        if (character === "-" && next === "-") {
            const endOfLine = text.indexOf("\n", index);
            if (endOfLine < 0) {
                return undefined;
            }
            index = endOfLine + 1;
            continue;
        }
        if (/\s/.test(character)) {
            index++;
            continue;
        }
        const match = /^([A-Za-z_]+)/.exec(text.slice(index));
        return match ? match[1].toUpperCase() : undefined;
    }
    return undefined;
}
