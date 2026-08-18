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
    if (range.start !== text.length) return "";
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
    const setStatement = ancestorNamed(node, "SetStatement");
    if (setStatement) {
        const option = /^\s*SET\s+([\p{L}_][\p{L}\p{N}_$#@]*)/iu.exec(
            text.slice(setStatement.from, setStatement.to),
        )?.[1];
        if (option && integerSetOptionNames.has(option.toLocaleUpperCase())) return true;
    }
    const option = ancestorNamed(node, "GenericOption");
    if (!option) return false;
    const name = /^\s*([\p{L}_][\p{L}\p{N}_$#@]*)/iu.exec(text.slice(option.from, option.to))?.[1];
    return Boolean(name && integerOptionNames.has(name.toLocaleUpperCase()));
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
