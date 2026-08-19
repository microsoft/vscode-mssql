/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TextRange } from "../text/index.js";

/**
 * The one place T-SQL identifiers are read, compared, and written.
 *
 * Every other module asks this module what a name says, what it means, and how to write it back.
 * Splitting a multipart name with an ad hoc regex is what let completion insert a name that
 * diagnostics then failed to resolve, so those helpers live here and nowhere else.
 */

/** One component of a multipart name, keeping both the source spelling and the semantic identity. */
export interface IdentifierPart {
    /** The component exactly as written, including any delimiters. */
    readonly text: string;
    /** The component with delimiters removed and doubled delimiters unescaped. */
    readonly normalized: string;
    /** True when the component was written as `[name]` or `"name"`. */
    readonly quoted: boolean;
    /** The component's span, absolute when the caller supplied the name's start offset. */
    readonly range: TextRange;
}

/** A multipart name as written, with every component's spelling, identity, and span preserved. */
export interface MultipartName {
    readonly parts: readonly IdentifierPart[];
    readonly range: TextRange;
    /** True when a component was omitted, as in `db..object`. */
    readonly hasOmittedParts: boolean;
}

const componentMatcher = /\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*"|[^.\s]+/gu;
const unquotedIdentifier = /^[\p{L}_#@][\p{L}\p{N}_$#@]*$/u;

/** Removes `[...]` or `"..."` delimiters and unescapes the doubled delimiter inside them. */
export function normalizeIdentifier(value: string): string {
    if (value.startsWith("[") && value.endsWith("]") && value.length >= 2) {
        return value.slice(1, -1).replaceAll("]]", "]");
    }
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
        return value.slice(1, -1).replaceAll('""', '"');
    }
    return value;
}

/** True when the component carries `[...]` or `"..."` delimiters. */
export function isQuotedIdentifier(value: string): boolean {
    return (
        (value.startsWith("[") && value.endsWith("]") && value.length >= 2) ||
        (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
    );
}

/**
 * Reads a multipart name.
 *
 * `offset` is the absolute start of `text`, so a caller holding a syntax node gets absolute part
 * ranges without recomputing them. Omitted components produce no part; `hasOmittedParts` records
 * that a dot ran without a name in front of it.
 */
export function parseMultipartName(text: string, offset = 0): MultipartName {
    const parts: IdentifierPart[] = [];
    for (const match of text.matchAll(componentMatcher)) {
        if (match.index === undefined) continue;
        const spelling = match[0];
        parts.push({
            text: spelling,
            normalized: normalizeIdentifier(spelling),
            quoted: isQuotedIdentifier(spelling),
            range: { start: offset + match.index, end: offset + match.index + spelling.length },
        });
    }
    return {
        parts: Object.freeze(parts),
        range: { start: offset, end: offset + text.length },
        // `a..b` and `.b` both leave a dot without a component in front of it. Counting dots is
        // enough because a component never contains an unquoted dot.
        hasOmittedParts: countSeparators(text) >= parts.length,
    };
}

/** The normalized components of a multipart name, in written order. */
export function multipartIdentifierParts(text: string): readonly string[] {
    return parseMultipartName(text).parts.map((part) => part.normalized);
}

/**
 * Case-folds a component for catalog comparison.
 *
 * SQL Server compares identifiers under the database collation. Until a host reports a
 * case-sensitive one the service folds, which is what every current metadata provider does; the
 * parameter exists so a case-sensitive environment is a value rather than a second code path.
 */
export function foldIdentifier(value: string, caseSensitive = false): string {
    return caseSensitive ? value : value.toLocaleUpperCase();
}

/** One comparable key for a multipart name, independent of spelling and delimiters. */
export function catalogKey(parts: readonly string[], caseSensitive = false): string {
    return parts.map((part) => foldIdentifier(part, caseSensitive)).join(".");
}

/** Wraps a component in brackets, escaping any closing bracket it contains. */
export function quoteIdentifier(value: string): string {
    return "[" + value.replaceAll("]", "]]") + "]";
}

/** Wraps a component only when writing it bare would not round-trip. */
export function quoteIdentifierIfNeeded(value: string): string {
    return unquotedIdentifier.test(value) ? value : quoteIdentifier(value);
}

/** Rewrites `replacement` using the delimiter style `original` was written with. */
export function preserveIdentifierQuotes(original: string, replacement: string): string {
    if (original.startsWith("[") && original.endsWith("]")) return quoteIdentifier(replacement);
    if (original.startsWith('"') && original.endsWith('"')) {
        return `"${replacement.replaceAll('"', '""')}"`;
    }
    return replacement;
}

/**
 * The insertion form of a multipart name.
 *
 * Completion and rename both write names, and a name that is inserted differently from the way it
 * is looked up is the defect this exists to prevent: each component is quoted only when it needs
 * to be, and the parts are joined by a single dot.
 */
export function formatMultipartName(parts: readonly string[]): string {
    return parts.map((part) => quoteIdentifierIfNeeded(part)).join(".");
}

/** The written name with whitespace around its separators removed, for diagnostic messages. */
export function compactMultipartName(text: string): string {
    return text.replaceAll(/\s*\.\s*/gu, ".").trim();
}

function countSeparators(text: string): number {
    let separators = 0;
    let index = 0;
    while (index < text.length) {
        const character = text[index]!;
        if (character === "[" || character === '"') {
            const closing = character === "[" ? "]" : '"';
            index += 1;
            while (index < text.length) {
                if (text[index] === closing) {
                    if (text[index + 1] === closing) index += 2;
                    else break;
                } else index += 1;
            }
            index += 1;
            continue;
        }
        if (character === ".") separators += 1;
        index += 1;
    }
    return separators;
}
