/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExternalTokenizer, type InputStream, type Stack } from "@lezer/lr";
import {
    BlockChunk,
    ComputeChunk,
    ConditionChunk,
    Return,
    StatementChunk,
    With,
} from "./generated/tsqlParser.terms.js";

const statementStarters = new Set([
    "alter",
    "begin",
    "break",
    "checkpoint",
    "close",
    "commit",
    "continue",
    "create",
    "deallocate",
    "declare",
    "delete",
    "drop",
    "exec",
    "execute",
    "fetch",
    "goto",
    "if",
    "insert",
    "merge",
    "open",
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
    "use",
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
    if (stack.canShift(ComputeChunk) && readCompute(input)) return;
    if (stack.canShift(ConditionChunk) && readCondition(input)) return;
    if (stack.canShift(BlockChunk) && readBlock(input, stack)) return;
    if (stack.canShift(StatementChunk)) readStatement(input);
});

function readCompute(input: InputStream): boolean {
    if (wordAt(input, 0)?.text !== "compute") return false;
    const boundary = findBoundary(input, "statement");
    if (boundary <= 0) return false;
    input.advance(boundary);
    input.acceptToken(ComputeChunk);
    return true;
}

function readCondition(input: InputStream): boolean {
    const boundary = findBoundary(input, "condition");
    if (boundary <= 0) return false;
    input.advance(boundary);
    input.acceptToken(ConditionChunk);
    return true;
}

function readBlock(input: InputStream, stack: Stack): boolean {
    const firstWord = wordAt(input, 0)?.text;
    if (firstWord === "return" && stack.canShift(Return) && isStructuredFunctionReturn(input)) {
        return false;
    }
    if (
        firstWord === "atomic" ||
        firstWord === "try" ||
        firstWord === "catch" ||
        firstWord === "external" ||
        firstWord === "tran" ||
        firstWord === "transaction" ||
        firstWord === "distributed"
    ) {
        return false;
    }
    // After BEGIN ATOMIC the WITH clause belongs to the structured atomic header. A normal BEGIN
    // block does not shift WITH directly, so its leading CTE remains safely mounted as BlockChunk.
    if (firstWord === "with" && stack.canShift(With)) return false;
    const boundary = findBoundary(input, "block");
    if (boundary <= 0) return false;
    input.advance(boundary);
    input.acceptToken(BlockChunk);
    return true;
}

function isStructuredFunctionReturn(input: InputStream): boolean {
    let offset = "return".length;
    while (isWhitespace(input.peek(offset))) offset++;
    const direct = wordAt(input, offset)?.text;
    if (direct === "select") return true;
    if (input.peek(offset) !== 40) return false;
    offset++;
    while (isWhitespace(input.peek(offset))) offset++;
    const parenthesized = wordAt(input, offset)?.text;
    return parenthesized === "select" || parenthesized === "with";
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
            // Mounted procedural regions must never consume a SQL client batch separator.
            if (word.text === "go" && isBatchSeparatorAt(input, offset, word.end)) {
                return trimEnd(input, offset);
            }
            if (mode === "condition" && statementStarters.has(word.text)) {
                if (!(word.text === "update" && nextNonTrivia(input, word.end) === 40))
                    return trimEnd(input, offset);
            } else if (mode === "statement") {
                if (word.text === "else" || word.text === "end") return trimEnd(input, offset);
                // A semicolon-less controlled statement ends before the next line-leading control
                // statement. This preserves classic IF/ELSE and WHILE scripts without treating
                // ordinary multi-line SELECT/FROM clauses as separate bodies.
                if (
                    offset > 0 &&
                    controlStarters.has(word.text) &&
                    isLineLeadingWord(input, offset)
                ) {
                    return trimEnd(input, offset);
                }
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

function isLineLeadingWord(input: InputStream, start: number): boolean {
    for (let offset = start - 1; offset >= 0; offset--) {
        const code = input.peek(offset);
        if (isLineBreak(code)) return true;
        if (code !== 9 && code !== 32) return false;
    }
    return true;
}

function isBatchSeparatorAt(input: InputStream, start: number, wordEnd: number): boolean {
    for (let offset = start - 1; offset >= 0; offset--) {
        const code = input.peek(offset);
        if (isLineBreak(code)) break;
        if (code !== 9 && code !== 32) return false;
    }

    let offset = wordEnd;
    while (input.peek(offset) === 9 || input.peek(offset) === 32) offset++;
    while (input.peek(offset) >= 48 && input.peek(offset) <= 57) offset++;
    while (input.peek(offset) === 9 || input.peek(offset) === 32) offset++;
    if (input.peek(offset) === 45 && input.peek(offset + 1) === 45) {
        offset += 2;
        while (input.peek(offset) >= 0 && !isLineBreak(input.peek(offset))) offset++;
    }
    return input.peek(offset) < 0 || isLineBreak(input.peek(offset));
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
    return (
        (code >= 0x0000 && code <= 0x000d) ||
        (code >= 0x000e && code <= 0x0020) ||
        code === 0x0085 ||
        code === 0x00a0 ||
        code === 0x1680 ||
        (code >= 0x2000 && code <= 0x200b) ||
        code === 0x2028 ||
        code === 0x2029 ||
        code === 0x202f ||
        code === 0x205f ||
        code === 0x3000
    );
}

function isLineBreak(code: number): boolean {
    return code === 10 || code === 13;
}
