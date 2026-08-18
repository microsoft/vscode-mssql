/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function preserveIdentifierQuotes(original: string, replacement: string): string {
    if (original.startsWith("[") && original.endsWith("]")) return quoteIdentifier(replacement);
    if (original.startsWith('"') && original.endsWith('"')) {
        return `"${replacement.replaceAll('"', '""')}"`;
    }
    return replacement;
}

export function quoteIdentifier(value: string): string {
    return "[" + value.replaceAll("]", "]]") + "]";
}

export function quoteIdentifierIfNeeded(value: string): string {
    return /^[\p{L}_#][\p{L}\p{N}_$#@]*$/u.test(value) ? value : quoteIdentifier(value);
}
