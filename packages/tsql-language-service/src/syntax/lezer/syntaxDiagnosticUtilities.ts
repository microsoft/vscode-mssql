/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxNode as LezerNode } from "@lezer/common";
import type { TextRange } from "../../text/index.js";

export function unterminatedBlockCommentRange(text: string): TextRange | undefined {
    const stack: number[] = [];
    let quote: "string" | "quoted" | "bracket" | undefined;
    for (let index = 0; index < text.length; index++) {
        const current = text[index];
        const next = text[index + 1];
        if (stack.length > 0) {
            if (current === "/" && next === "*") {
                stack.push(index++);
            } else if (current === "*" && next === "/") {
                stack.pop();
                index++;
            }
            continue;
        }
        if (quote) {
            const close = quote === "string" ? "'" : quote === "quoted" ? '"' : "]";
            if (current === close && next === close) index++;
            else if (current === close) quote = undefined;
        } else if (current === "-" && next === "-") {
            const newline = text.indexOf("\n", index + 2);
            if (newline < 0) break;
            index = newline;
        } else if (current === "/" && next === "*") {
            stack.push(index++);
        } else if (current === "'") quote = "string";
        else if (current === '"') quote = "quoted";
        else if (current === "[") quote = "bracket";
    }
    const start = stack[0];
    return start === undefined ? undefined : { start, end: text.length };
}

export function unterminatedStringRange(text: string): TextRange | undefined {
    let stringStart: number | undefined;
    let quote: "quoted" | "bracket" | undefined;
    let blockDepth = 0;
    for (let index = 0; index < text.length; index++) {
        const current = text[index];
        const next = text[index + 1];
        if (blockDepth > 0) {
            if (current === "/" && next === "*") {
                blockDepth++;
                index++;
            } else if (current === "*" && next === "/") {
                blockDepth--;
                index++;
            }
            continue;
        }
        if (stringStart !== undefined) {
            if (current === "'" && next === "'") index++;
            else if (current === "'") stringStart = undefined;
            continue;
        }
        if (quote) {
            const close = quote === "quoted" ? '"' : "]";
            if (current === close && next === close) index++;
            else if (current === close) quote = undefined;
            continue;
        }
        if (current === "-" && next === "-") {
            const newline = text.indexOf("\n", index + 2);
            if (newline < 0) break;
            index = newline;
        } else if (current === "/" && next === "*") {
            blockDepth++;
            index++;
        } else if (current === "'") {
            stringStart = index;
        } else if (current === '"') {
            quote = "quoted";
        } else if (current === "[") {
            quote = "bracket";
        }
    }
    return stringStart === undefined ? undefined : { start: stringStart, end: text.length };
}

/**
 * A delimited identifier escapes its own delimiter by doubling it, so an opener whose closing runs
 * always pair up never ends and takes the rest of the document with it.
 */
export function unterminatedDelimitedIdentifierRange(text: string): TextRange | undefined {
    let blockDepth = 0;
    for (let index = 0; index < text.length; index++) {
        const current = text[index];
        const next = text[index + 1];
        if (blockDepth > 0) {
            if (current === "/" && next === "*") {
                blockDepth++;
                index++;
            } else if (current === "*" && next === "/") {
                blockDepth--;
                index++;
            }
            continue;
        }
        if (current === "-" && next === "-") {
            const newline = text.indexOf("\n", index + 2);
            if (newline < 0) break;
            index = newline;
        } else if (current === "/" && next === "*") {
            blockDepth++;
            index++;
        } else if (current === "'") {
            const close = stringLiteralEnd(text, index);
            if (close === undefined) break;
            index = close;
        } else if (current === '"' || current === "[") {
            const close = delimitedIdentifierEnd(text, index, current === "[" ? "]" : '"');
            if (close === undefined) return { start: index, end: text.length };
            index = close;
        }
    }
    return undefined;
}

/**
 * Reports where the delimited identifier starting at `open` closes, or nothing when it never does.
 * A doubled delimiter is an escape, so only a run that leaves one delimiter over ends the name.
 */
function delimitedIdentifierEnd(text: string, open: number, close: string): number | undefined {
    let index = open + 1;
    while (index < text.length) {
        if (text[index] !== close) {
            index++;
            continue;
        }
        let runEnd = index;
        while (runEnd < text.length && text[runEnd] === close) runEnd++;
        if ((runEnd - index) % 2 === 1) return runEnd - 1;
        index = runEnd;
    }
    return undefined;
}

function stringLiteralEnd(text: string, open: number): number | undefined {
    for (let index = open + 1; index < text.length; index++) {
        if (text[index] !== "'") continue;
        if (text[index + 1] === "'") {
            index++;
            continue;
        }
        return index;
    }
    return undefined;
}

/**
 * Where an availability diagnostic is drawn.
 *
 * The declared keyword is preferred, because it names the construct the way an author wrote it. A
 * construct with no single word to point at, or one whose keyword the source spells differently,
 * falls back to the node's own first token rather than losing the diagnostic.
 */
export function availabilityRange(
    node: LezerNode,
    text: string,
    keyword: string | undefined,
): TextRange {
    if (keyword !== undefined) {
        const start = findWord(text, node.from, node.to, keyword);
        if (start >= 0) return { start, end: start + keyword.length };
    }
    let end = node.from;
    while (end < node.to && !/\s/u.test(text[end]!)) end++;
    return { start: node.from, end: Math.min(end === node.from ? node.from + 1 : end, node.to) };
}

export function findWord(text: string, start: number, end: number, word: string): number {
    const lowerWord = word.toLowerCase();
    for (let index = start; index + word.length <= end; index++) {
        if (text.slice(index, index + word.length).toLowerCase() !== lowerWord) continue;
        if (
            (index === start || !isIdentifierCharacter(text.charCodeAt(index - 1))) &&
            (index + word.length === end ||
                !isIdentifierCharacter(text.charCodeAt(index + word.length)))
        ) {
            return index;
        }
    }
    return -1;
}

export function expectedSuffix(node: LezerNode, text: string, range: TextRange): string {
    if (
        text.slice(range.start, range.end) === ")" &&
        node.from === node.to &&
        ancestorNamed(node, "ColumnNameList")
    ) {
        return "  Expecting ID, or QUOTED_ID.";
    }
    // An option clause opens its list with a parenthesis, so a WITH followed by anything else is
    // missing exactly that.
    if (node.prevSibling?.name === "With" && node.from === node.to) return "  Expecting '('.";
    // Inside a table definition only another element or the closing parenthesis may follow one.
    if (node.parent?.name === "TableDefinition") return "  Expecting ')', or ','.";
    if (range.start !== text.length) return "";
    // AUTHORIZATION names a principal, so a statement that ends on the keyword itself is missing
    // one identifier and nothing else.
    if (node.prevSibling?.name === "Authorization") return "  Expecting ID, or QUOTED_ID.";
    const parent = node.parent;
    if (
        parent?.name === "MultipartIdentifier" &&
        text.slice(parent.from, node.from).endsWith(".")
    ) {
        return "  Expecting '.', ID, or QUOTED_ID.";
    }
    return "";
}

export function diagnosticNearRange(start: number, end: number, text: string): TextRange {
    if (start !== end || start === text.length) return { start, end };
    let tokenEnd = start;
    if (isIdentifierCharacter(text.charCodeAt(start))) {
        while (tokenEnd < text.length && isIdentifierCharacter(text.charCodeAt(tokenEnd))) {
            tokenEnd++;
        }
    } else {
        tokenEnd++;
    }
    return { start, end: tokenEnd };
}

function isIdentifierCharacter(code: number): boolean {
    return (
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        code === 35 ||
        code === 64 ||
        code === 95 ||
        code >= 128
    );
}

export function ancestorNamed(node: LezerNode, name: string): LezerNode | undefined {
    for (let current: LezerNode | null = node.parent; current; current = current.parent) {
        if (current.name === name) return current;
    }
    return undefined;
}

export function missingMergeTerminator(
    merge: LezerNode,
    text: string,
    errorOffset: number,
): boolean {
    if (errorOffset < merge.from || errorOffset > merge.to) return false;
    return text.slice(merge.from, errorOffset).trimEnd().toLowerCase().startsWith("merge");
}

export function requiresIntegerLiteral(node: LezerNode, text: string): boolean {
    if (ancestorNamed(node, "DataType")) return true;
    const setStatement = ancestorNamed(node, "SetStatement");
    if (setStatement) {
        const option = /^\s*SET\s+([\p{L}_][\p{L}\p{N}_$#@]*)/iu.exec(
            text.slice(setStatement.from, setStatement.to),
        )?.[1];
        if (option && integerSetOptionNames.has(option.toUpperCase())) return true;
    }
    const option = ancestorNamed(node, "GenericOption");
    if (!option) return false;
    const name = /^\s*([\p{L}_][\p{L}\p{N}_$#@]*)/iu.exec(text.slice(option.from, option.to))?.[1];
    return Boolean(name && integerOptionNames.has(name.toUpperCase()));
}

const integerSetOptionNames = new Set([
    "DEADLOCK_PRIORITY",
    "LOCK_TIMEOUT",
    "QUERY_GOVERNOR_COST_LIMIT",
    "TEXTSIZE",
    "ERRLVL",
    "ROWCOUNT",
]);

const integerOptionNames = new Set([
    "BUCKET_COUNT",
    "COMPRESSION_DELAY",
    "FILLFACTOR",
    "MAXDOP",
    "MAX_DURATION",
    "R",
    "L",
    "M",
]);

export function isAtLineStart(text: string, offset: number): boolean {
    for (let index = offset - 1; index >= 0; index--) {
        const character = text[index];
        if (character === "\n" || character === "\r") return true;
        if (character !== " " && character !== "\t") return false;
    }
    return true;
}

/**
 * Bounds a text recovery scan to the statement that begins at `from`, so a replacement cannot
 * suppress the diagnostics of a later statement or client batch in the same parser chunk.
 */
export function statementEndOffset(text: string, from: number): number {
    let depth = 0;
    for (let index = from; index < text.length; index++) {
        const character = text[index];
        if (character === "'" || character === '"' || character === "[") {
            index = delimitedEnd(text, index);
            continue;
        }
        if (character === "-" && text[index + 1] === "-") {
            const newline = text.indexOf("\n", index + 2);
            if (newline < 0) return text.length;
            index = newline;
            continue;
        }
        if (character === "/" && text[index + 1] === "*") {
            const end = text.indexOf("*/", index + 2);
            if (end < 0) return text.length;
            index = end + 1;
            continue;
        }
        if (character === "(") depth++;
        else if (character === ")") depth--;
        else if (character === ";" && depth <= 0) return index;
        else if (
            depth <= 0 &&
            (character === "g" || character === "G") &&
            /^GO\b/iu.test(text.slice(index, index + 3)) &&
            isAtLineStart(text, index)
        ) {
            return index;
        }
    }
    return text.length;
}

/** Reports the offset of the parenthesis closing the one at `open`, or -1 when none does. */
export function matchingCloseParenOffset(text: string, open: number, limit = text.length): number {
    let depth = 0;
    for (let index = open; index < limit; index++) {
        const character = text[index];
        if (character === "'" || character === '"' || character === "[") {
            index = delimitedEnd(text, index);
            continue;
        }
        if (character === "(") depth++;
        else if (character === ")" && --depth === 0) return index;
    }
    return -1;
}

/** Reports the offset of the delimiter closing the string or delimited name opened at `open`. */
function delimitedEnd(text: string, open: number): number {
    const close = text[open] === "[" ? "]" : text[open]!;
    for (let index = open + 1; index < text.length; index++) {
        if (text[index] !== close) continue;
        if (text[index + 1] === close) {
            index++;
            continue;
        }
        return index;
    }
    return text.length;
}

/**
 * Blanks comment bodies and string contents so a recovery scanner reads only code. Offsets and
 * length are preserved, so a match in the masked text indexes the original text directly.
 */
export function codeMask(text: string): string {
    const mask = [...text];
    const blank = (start: number, end: number): void => {
        for (let index = start; index < end && index < mask.length; index++) {
            if (mask[index] !== "\n" && mask[index] !== "\r") mask[index] = " ";
        }
    };
    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (character === "-" && text[index + 1] === "-") {
            const newline = text.indexOf("\n", index + 2);
            const end = newline < 0 ? text.length : newline;
            blank(index, end);
            index = end;
        } else if (character === "/" && text[index + 1] === "*") {
            const end = text.indexOf("*/", index + 2);
            const stop = end < 0 ? text.length : end + 2;
            blank(index, stop);
            index = stop - 1;
        } else if (character === "'" || character === '"' || character === "[") {
            const close = delimitedEnd(text, index);
            blank(index + 1, close);
            index = close;
        }
    }
    return mask.join("");
}
