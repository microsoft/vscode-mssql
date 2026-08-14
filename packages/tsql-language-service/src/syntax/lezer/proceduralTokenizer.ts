/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExternalTokenizer, type InputStream } from "@lezer/lr";
import { BlockChunk, ConditionChunk, StatementChunk } from "./generated/tsqlParser.terms.js";

const statementStarters = new Set([
    "begin",
    "break",
    "continue",
    "declare",
    "delete",
    "exec",
    "execute",
    "goto",
    "if",
    "insert",
    "merge",
    "print",
    "raiserror",
    "return",
    "revert",
    "rollback",
    "save",
    "select",
    "set",
    "throw",
    "truncate",
    "update",
    "waitfor",
    "while",
    "with",
]);
const controlStarters = new Set(["begin", "if", "while"]);
const nonBlockBeginFollowers = new Set([
    "conversation",
    "dialog",
    "distributed",
    "tran",
    "transaction",
]);

/** Produces bounded regions that are recursively mounted with the main SQL/expression parser. */
export const proceduralTokens = new ExternalTokenizer((input, stack) => {
    if (stack.canShift(ConditionChunk) && readCondition(input)) return;
    if (stack.canShift(BlockChunk) && readBlock(input)) return;
    if (stack.canShift(StatementChunk)) readStatement(input);
});

function readCondition(input: InputStream): boolean {
    const boundary = findBoundary(input, "condition");
    if (boundary <= 0) return false;
    input.advance(boundary);
    input.acceptToken(ConditionChunk);
    return true;
}

function readBlock(input: InputStream): boolean {
    const firstWord = wordAt(input, 0)?.text;
    if (
        firstWord === "try" ||
        firstWord === "catch" ||
        firstWord === "external" ||
        firstWord === "tran" ||
        firstWord === "transaction" ||
        firstWord === "distributed"
    ) {
        return false;
    }
    const boundary = findBoundary(input, "block");
    if (boundary <= 0) return false;
    input.advance(boundary);
    input.acceptToken(BlockChunk);
    return true;
}

function readStatement(input: InputStream): boolean {
    const firstWord = wordAt(input, 0);
    if (firstWord && controlStarters.has(firstWord.text)) return false;
    const boundary = findBoundary(input, "statement");
    if (boundary <= 0) return false;
    input.advance(boundary);
    input.acceptToken(StatementChunk);
    return true;
}

function findBoundary(input: InputStream, mode: "condition" | "block" | "statement"): number {
    let offset = 0;
    let parentheses = 0;
    let nestedBegins = 0;
    let cases = 0;
    let quote: "string" | "quoted" | "bracket" | undefined;
    let blockComments = 0;
    while (input.peek(offset) >= 0) {
        const current = input.peek(offset);
        const next = input.peek(offset + 1);
        if (blockComments > 0) {
            if (current === 47 && next === 42) {
                blockComments++;
                offset += 2;
            } else if (current === 42 && next === 47) {
                blockComments--;
                offset += 2;
            } else offset++;
            continue;
        }
        if (quote) {
            const close = quote === "string" ? 39 : quote === "quoted" ? 34 : 93;
            if (current === close && next === close) offset += 2;
            else {
                offset++;
                if (current === close) quote = undefined;
            }
            continue;
        }
        if (current === 45 && next === 45) {
            while (input.peek(offset) >= 0 && !isLineBreak(input.peek(offset))) offset++;
            continue;
        }
        if (current === 47 && next === 42) {
            blockComments = 1;
            offset += 2;
            continue;
        }
        if (current === 39 || current === 34 || current === 91) {
            quote = current === 39 ? "string" : current === 34 ? "quoted" : "bracket";
            offset++;
            continue;
        }
        if (current === 40) {
            parentheses++;
            offset++;
            continue;
        }
        if (current === 41) {
            parentheses = Math.max(0, parentheses - 1);
            offset++;
            continue;
        }
        if (parentheses === 0 && current === 59 && mode === "statement") return offset;
        if (parentheses === 0 && isWordStart(current)) {
            const word = wordAt(input, offset)!;
            if (mode === "condition" && statementStarters.has(word.text)) {
                if (!(word.text === "update" && nextNonTrivia(input, word.end) === 40))
                    return trimEnd(input, offset);
            } else if (mode === "statement" && (word.text === "else" || word.text === "end")) {
                return trimEnd(input, offset);
            } else if (mode === "block") {
                if (word.text === "case") cases++;
                else if (word.text === "begin") {
                    const following = nextWordAfterTrivia(input, word.end)?.text;
                    if (!following || !nonBlockBeginFollowers.has(following)) nestedBegins++;
                } else if (word.text === "end") {
                    if (cases > 0) cases--;
                    else if (nestedBegins > 0) nestedBegins--;
                    else return trimEnd(input, offset);
                }
            }
            offset = word.end;
            continue;
        }
        offset++;
    }
    return trimEnd(input, offset);
}

function wordAt(input: InputStream, offset: number): { text: string; end: number } | undefined {
    if (!isWordStart(input.peek(offset))) return undefined;
    let end = offset + 1;
    while (isWordPart(input.peek(end))) end++;
    let text = "";
    for (let index = offset; index < end; index++) text += String.fromCharCode(input.peek(index));
    return { text: text.toLowerCase(), end };
}

function nextNonTrivia(input: InputStream, offset: number): number {
    while (isWhitespace(input.peek(offset))) offset++;
    return input.peek(offset);
}

function nextWordAfterTrivia(
    input: InputStream,
    initialOffset: number,
): { text: string; end: number } | undefined {
    let offset = initialOffset;
    while (input.peek(offset) >= 0) {
        while (isWhitespace(input.peek(offset))) offset++;
        if (input.peek(offset) === 45 && input.peek(offset + 1) === 45) {
            while (input.peek(offset) >= 0 && !isLineBreak(input.peek(offset))) offset++;
            continue;
        }
        if (input.peek(offset) === 47 && input.peek(offset + 1) === 42) {
            let depth = 1;
            offset += 2;
            while (input.peek(offset) >= 0 && depth > 0) {
                if (input.peek(offset) === 47 && input.peek(offset + 1) === 42) {
                    depth++;
                    offset += 2;
                } else if (input.peek(offset) === 42 && input.peek(offset + 1) === 47) {
                    depth--;
                    offset += 2;
                } else offset++;
            }
            continue;
        }
        return wordAt(input, offset);
    }
    return undefined;
}

function trimEnd(input: InputStream, offset: number): number {
    while (offset > 0 && isWhitespace(input.peek(offset - 1))) offset--;
    return offset;
}

function isWordStart(code: number): boolean {
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code >= 128;
}

function isWordPart(code: number): boolean {
    return isWordStart(code) || (code >= 48 && code <= 57) || code === 35 || code === 64;
}

function isWhitespace(code: number): boolean {
    return code === 9 || code === 10 || code === 12 || code === 13 || code === 32;
}

function isLineBreak(code: number): boolean {
    return code === 10 || code === 13;
}
