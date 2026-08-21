/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TextRange } from "../text/index.js";
import { isReservedKeyword } from "../syntax/keywords.js";

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

/**
 * Grammar-sensitive fragments for recovery recognizers that cannot ask a complete syntax tree.
 * Consumers compose these strings with `new RegExp`; they must not restate the character classes.
 * `namedVariable` requires a name after `@`, while the parser may retain a bare `@` during typing.
 */
export const tsqlIdentifierPattern = Object.freeze({
    start: String.raw`[\p{L}_#@]`,
    continuation: String.raw`[\p{L}\p{N}_$#@]`,
    unquoted: String.raw`[\p{L}_#@][\p{L}\p{N}_$#@]*`,
    ordinary: String.raw`[\p{L}_#][\p{L}\p{N}_$#@]*`,
    namedVariable: String.raw`@[\p{L}_][\p{L}\p{N}_$#@]*`,
    delimited: String.raw`(?:\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*")`,
    component: String.raw`(?:\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*"|[\p{L}_#@][\p{L}\p{N}_$#@]*)`,
});

const componentMatcher = new RegExp(tsqlIdentifierPattern.component, "gu");
const unquotedIdentifier = new RegExp(`^${tsqlIdentifierPattern.unquoted}$`, "u");
const identifierContinuation = new RegExp(tsqlIdentifierPattern.continuation, "u");
const incompleteBracketSuffix = /\[((?:[^\]]|\]\])*)$/u;
const incompleteDoubleQuoteSuffix = /"((?:[^"]|"")*)$/u;

export interface IncompleteDelimitedIdentifier {
    readonly kind: "bracket" | "doubleQuote";
    readonly start: number;
    readonly end: number;
    readonly prefix: string;
}

export type IdentifierDelimiter = "bracket" | "doubleQuote";
export type IdentifierRole = "regular" | "temporaryObject" | "localVariable" | "globalVariable";

/** Escapes identifier content without adding its surrounding delimiter. */
export function escapeIdentifierContent(value: string, delimiter: IdentifierDelimiter): string {
    return delimiter === "bracket" ? value.replaceAll("]", "]]") : value.replaceAll('"', '""');
}

/** Unescapes identifier content after its surrounding delimiter has been removed. */
export function unescapeIdentifierContent(value: string, delimiter: IdentifierDelimiter): string {
    return delimiter === "bracket" ? value.replaceAll("]]", "]") : value.replaceAll('""', '"');
}

/** Classifies an identifier by the prefix role SQL Server assigns before binding. */
export function identifierRole(value: string): IdentifierRole {
    if (isQuotedIdentifier(value)) return "regular";
    if (value.startsWith("@@")) return "globalVariable";
    if (value.startsWith("@")) return "localVariable";
    if (value.startsWith("#")) return "temporaryObject";
    return "regular";
}

/** Removes `[...]` or `"..."` delimiters and unescapes the doubled delimiter inside them. */
export function normalizeIdentifier(value: string): string {
    if (value.startsWith("[") && value.endsWith("]") && value.length >= 2) {
        return unescapeIdentifierContent(value.slice(1, -1), "bracket");
    }
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
        return unescapeIdentifierContent(value.slice(1, -1), "doubleQuote");
    }
    return value;
}

/** Removes a T-SQL string delimiter and unescapes doubled apostrophes. */
export function normalizeStringLiteral(value: string): string {
    const quoted = /^[Nn]'/u.test(value) ? value.slice(1) : value;
    if (!quoted.startsWith("'") || !quoted.endsWith("'") || quoted.length < 2) return value;
    return quoted.slice(1, -1).replaceAll("''", "'");
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

/** Absolute ranges of every component in a multipart spelling. */
export function multipartIdentifierPartRanges(text: string, offset = 0): readonly TextRange[] {
    return parseMultipartName(text, offset).parts.map((part) => part.range);
}

/** One component range, falling back to the supplied owner when recovery omitted that component. */
export function multipartIdentifierPartRange(
    text: string,
    offset: number,
    partIndex: number,
    fallback: TextRange,
): TextRange {
    return (
        parseMultipartName(text, offset).parts[partIndex]?.range ?? {
            start: fallback.start,
            end: fallback.end,
        }
    );
}

export function lastMultipartIdentifierPartRange(
    text: string,
    offset: number,
    fallback: TextRange,
): TextRange {
    const parts = parseMultipartName(text, offset).parts;
    return parts.at(-1)?.range ?? { start: fallback.start, end: fallback.end };
}

/**
 * Exact range of the named variable at the start of an already-parsed argument/declaration.
 *
 * The recognizer is anchored and uses the central variable grammar; it cannot consume another
 * clause or infer a statement shape.
 */
export function leadingNamedVariableRange(
    text: string,
    offset: number,
    fallback: TextRange,
): TextRange {
    const match = new RegExp(String.raw`^\s*(${tsqlIdentifierPattern.namedVariable})`, "iu").exec(
        text,
    );
    const value = match?.[1];
    if (!value || match.index === undefined) {
        return { start: fallback.start, end: fallback.end };
    }
    const relative = match[0].indexOf(value);
    return {
        start: offset + match.index + relative,
        end: offset + match.index + relative + value.length,
    };
}

/**
 * Case-folds a component for catalog comparison.
 *
 * SQL Server compares identifiers under the database collation. Until a host reports a
 * case-sensitive one the service folds, which is what every current metadata provider does; the
 * parameter exists so a case-sensitive environment is a value rather than a second code path.
 */
export function foldIdentifier(value: string, caseSensitive = false): string {
    return caseSensitive ? value : value.toUpperCase();
}

/** One comparable key for a multipart name, independent of spelling and delimiters. */
export function catalogKey(parts: readonly string[], caseSensitive = false): string {
    return parts.map((part) => foldIdentifier(part, caseSensitive)).join(".");
}

/** Wraps a component in brackets, escaping any closing bracket it contains. */
export function quoteIdentifier(value: string): string {
    return "[" + escapeIdentifierContent(value, "bracket") + "]";
}

/** Wraps a component only when writing it bare would not round-trip. */
export function quoteIdentifierIfNeeded(value: string): string {
    return unquotedIdentifier.test(value) && !isReservedKeyword(value)
        ? value
        : quoteIdentifier(value);
}

/** True for a character that can continue an ordinary identifier while the user is typing. */
export function isIdentifierContinuationCharacter(character: string): boolean {
    return identifierContinuation.test(character);
}

/**
 * The identifier component touching a caret.
 *
 * Delimited components keep spaces and punctuation inside their matching delimiters. Ordinary
 * components use the same continuation policy as the canonical identifier parser.
 */
export function identifierComponentRangeAt(text: string, offset: number): TextRange {
    const safeOffset = Math.max(0, Math.min(offset, text.length));
    const delimited = delimitedComponentRangeAt(text, safeOffset);
    if (delimited) return delimited;
    let start = safeOffset;
    while (start > 0 && isIdentifierContinuationCharacter(text[start - 1]!)) start--;
    let end = safeOffset;
    while (end < text.length && isIdentifierContinuationCharacter(text[end]!)) end++;
    return { start, end };
}

/** The complete multipart name touching a caret, including quoted components and separators. */
export function multipartIdentifierRangeAt(text: string, offset: number): TextRange {
    const active = identifierComponentRangeAt(text, offset);
    let start = active.start;
    while (true) {
        let cursor = skipWhitespaceBackward(text, start);
        if (cursor === 0 || text[cursor - 1] !== ".") break;
        cursor = skipWhitespaceBackward(text, cursor - 1);
        const componentStart = componentStartBefore(text, cursor);
        if (componentStart === cursor) {
            start = cursor;
            continue;
        }
        start = componentStart;
    }

    let end = active.end;
    while (true) {
        let cursor = skipWhitespaceForward(text, end);
        if (cursor >= text.length || text[cursor] !== ".") break;
        cursor = skipWhitespaceForward(text, cursor + 1);
        const componentEnd = componentEndAfter(text, cursor);
        end = componentEnd === cursor ? cursor : componentEnd;
    }
    return { start, end };
}

/**
 * Reads an unfinished `[` or `"` identifier ending at the caret.
 *
 * The caller remains responsible for excluding string/comment syntax. Keeping these two recovery
 * expressions here prevents completion, hover, and rename from defining different delimiter
 * escaping rules.
 */
export function incompleteDelimitedIdentifierAt(
    text: string,
    offset: number,
): IncompleteDelimitedIdentifier | undefined {
    const safeOffset = Math.max(0, Math.min(offset, text.length));
    const lineStart =
        Math.max(text.lastIndexOf("\n", safeOffset - 1), text.lastIndexOf("\r", safeOffset - 1)) +
        1;
    const leading = text.slice(lineStart, safeOffset);
    const bracket = incompleteBracketSuffix.exec(leading);
    if (bracket?.index !== undefined) {
        return {
            kind: "bracket",
            start: lineStart + bracket.index,
            end: safeOffset,
            prefix: unescapeIdentifierContent(bracket[1]!, "bracket"),
        };
    }
    const quoted = incompleteDoubleQuoteSuffix.exec(leading);
    if (quoted?.index === undefined) return undefined;
    return {
        kind: "doubleQuote",
        start: lineStart + quoted.index,
        end: safeOffset,
        prefix: unescapeIdentifierContent(quoted[1]!, "doubleQuote"),
    };
}

/** Normalized multipart components immediately before the active completion component. */
export function identifierQualifiersBefore(text: string, partStart: number): readonly string[] {
    const parts: string[] = [];
    let cursor = Math.max(0, Math.min(partStart, text.length));
    while (true) {
        cursor = skipWhitespaceBackward(text, cursor);
        if (cursor === 0 || text[cursor - 1] !== ".") break;
        cursor = skipWhitespaceBackward(text, cursor - 1);
        const componentEnd = cursor;
        const componentStart = componentStartBefore(text, componentEnd);
        if (componentStart === componentEnd) {
            parts.unshift("");
            continue;
        }
        parts.unshift(normalizeIdentifier(text.slice(componentStart, componentEnd)));
        cursor = componentStart;
    }
    return Object.freeze(parts);
}

/** Rewrites `replacement` using the delimiter style `original` was written with. */
export function preserveIdentifierQuotes(original: string, replacement: string): string {
    if (original.startsWith("[") && original.endsWith("]")) return quoteIdentifier(replacement);
    if (original.startsWith('"') && original.endsWith('"')) {
        return `"${escapeIdentifierContent(replacement, "doubleQuote")}"`;
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
    const compacted: string[] = [];
    let whitespaceStart: number | undefined;
    for (let index = 0; index < text.length; index++) {
        const character = text[index]!;
        if (character.trim().length === 0) {
            whitespaceStart ??= index;
            continue;
        }
        if (character === ".") {
            whitespaceStart = undefined;
            compacted.push(character);
            continue;
        }
        if (whitespaceStart !== undefined && compacted.length > 0 && compacted.at(-1) !== ".") {
            compacted.push(text.slice(whitespaceStart, index));
        }
        whitespaceStart = undefined;
        compacted.push(character);
    }
    return compacted.join("");
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

function delimitedComponentRangeAt(text: string, offset: number): TextRange | undefined {
    const lineStart =
        Math.max(text.lastIndexOf("\n", offset - 1), text.lastIndexOf("\r", offset - 1)) + 1;
    for (let start = offset - 1; start >= lineStart; start--) {
        const opener = text[start];
        if (opener !== "[" && opener !== '"') continue;
        const closer = opener === "[" ? "]" : '"';
        let end = start + 1;
        while (end < text.length) {
            if (text[end] !== closer) {
                end++;
                continue;
            }
            if (text[end + 1] === closer) {
                end += 2;
                continue;
            }
            end++;
            return start < offset && offset <= end ? { start, end } : undefined;
        }
        return start < offset ? { start, end: text.length } : undefined;
    }
    return undefined;
}

function skipWhitespaceBackward(text: string, offset: number): number {
    while (offset > 0 && /\s/u.test(text[offset - 1]!)) offset--;
    return offset;
}

function skipWhitespaceForward(text: string, offset: number): number {
    while (offset < text.length && /\s/u.test(text[offset]!)) offset++;
    return offset;
}

function componentStartBefore(text: string, end: number): number {
    if (end === 0) return end;
    const closer = text[end - 1];
    if (closer === "]" || closer === '"') {
        const opener = closer === "]" ? "[" : '"';
        let cursor = end - 2;
        while (cursor >= 0) {
            if (text[cursor] === closer && text[cursor - 1] === closer) {
                cursor -= 2;
                continue;
            }
            if (text[cursor] === opener) return cursor;
            cursor--;
        }
        return end;
    }
    let start = end;
    while (start > 0 && isIdentifierContinuationCharacter(text[start - 1]!)) start--;
    return start;
}

function componentEndAfter(text: string, start: number): number {
    const opener = text[start];
    if (opener === "[" || opener === '"') {
        const closer = opener === "[" ? "]" : '"';
        let cursor = start + 1;
        while (cursor < text.length) {
            if (text[cursor] !== closer) {
                cursor++;
                continue;
            }
            if (text[cursor + 1] === closer) cursor += 2;
            else return cursor + 1;
        }
        return cursor;
    }
    let end = start;
    while (end < text.length && isIdentifierContinuationCharacter(text[end]!)) end++;
    return end;
}
