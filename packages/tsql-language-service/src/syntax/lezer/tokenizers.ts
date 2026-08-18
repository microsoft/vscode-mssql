/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExternalTokenizer, type InputStream, type Stack } from "@lezer/lr";
import {
    AtTimeZone,
    BlockComment,
    ExecuteInvalidContextOption,
    ExecuteInvalidInlineOption,
    ExecuteInvalidNullInputOption,
    ExecuteInvalidSimpleOption,
    Go,
    Label,
    Match,
    MoneyLiteral,
    UpdatePredicateKeyword,
    ViewCheckWith,
    lineContentStart,
    horizontalWhitespace,
    lineBreak,
} from "./generated/tsqlParser.terms.js";

const asterisk = "*".charCodeAt(0);
const lowerA = "a".charCodeAt(0);
const carriageReturn = "\r".charCodeAt(0);
const digitZero = "0".charCodeAt(0);
const digitNine = "9".charCodeAt(0);
const forwardSlash = "/".charCodeAt(0);
const hyphen = "-".charCodeAt(0);
const lineFeed = "\n".charCodeAt(0);
const lowerG = "g".charCodeAt(0);
const lowerM = "m".charCodeAt(0);
const lowerO = "o".charCodeAt(0);
const space = " ".charCodeAt(0);
const tab = "\t".charCodeAt(0);
const upperG = "G".charCodeAt(0);
const upperM = "M".charCodeAt(0);
const upperO = "O".charCodeAt(0);
const upperA = "A".charCodeAt(0);
const lowerU = "u".charCodeAt(0);
const upperU = "U".charCodeAt(0);
const lowerW = "w".charCodeAt(0);
const upperW = "W".charCodeAt(0);
const colon = ":".charCodeAt(0);
const openParen = "(".charCodeAt(0);
const plus = "+".charCodeAt(0);
const period = ".".charCodeAt(0);
const lowerE = "e".charCodeAt(0);
const upperE = "E".charCodeAt(0);
const moneySigns = new Set([
    0x0024, 0x00a3, 0x00a4, 0x00a5, 0x09f2, 0x09f3, 0x0e3f, 0x20ac, 0x20a1, 0x20a2, 0x20a3, 0x20a4,
    0x20a6, 0x20a7, 0x20a8, 0x20a9, 0x20aa, 0x20ab,
]);

export const sqlServerTokens = new ExternalTokenizer((input, stack) => {
    if (isHorizontalSpace(input.next)) {
        readHorizontalWhitespace(input);
        return;
    }
    if (input.next === carriageReturn || input.next === lineFeed) {
        readLineBreak(input);
        return;
    }
    if (input.next === forwardSlash && input.peek(1) === asterisk) {
        readNestedBlockComment(input);
        return;
    }
    if (moneySigns.has(input.next) && stack.canShift(MoneyLiteral) && readMoneyLiteral(input))
        return;
    if (readInvalidExecuteModuleOption(input, stack)) return;
    // Labels are statement-leading constructs. Checking the lexical line state avoids both
    // misclassifying identifier/colon pairs inside expressions and an expensive LR canShift call
    // for every identifier in the document.
    if (isLineLeading(stack) && isIdentifierStart(input.next) && readLabel(input)) return;
    if ((input.next === lowerA || input.next === upperA) && readAtTimeZone(input)) return;
    if (
        (input.next === lowerM || input.next === upperM) &&
        matchesWord(input, 0, "match") &&
        stack.canShift(Match) &&
        readContextualWord(input, "match", Match)
    ) {
        return;
    }
    if (
        (input.next === lowerU || input.next === upperU) &&
        looksLikeUpdatePredicate(input) &&
        stack.canShift(UpdatePredicateKeyword) &&
        readUpdatePredicateKeyword(input)
    ) {
        return;
    }
    if (
        (input.next === lowerW || input.next === upperW) &&
        looksLikeViewCheckWith(input) &&
        stack.canShift(ViewCheckWith) &&
        readViewCheckWith(input)
    ) {
        return;
    }
    if ((input.next === lowerG || input.next === upperG) && isLineLeading(stack)) {
        if (readBatchSeparator(input)) return;
    }
    if (isLineLeading(stack)) input.acceptToken(lineContentStart);
});

/** Recognizes only the finite module-option catalog when the EXECUTE tail requests it. */
function readInvalidExecuteModuleOption(input: InputStream, stack: Stack): boolean {
    const candidates: readonly [string, number][] = [
        ["encryption", ExecuteInvalidSimpleOption],
        ["schemabinding", ExecuteInvalidSimpleOption],
        ["view_metadata", ExecuteInvalidSimpleOption],
        ["native_compilation", ExecuteInvalidSimpleOption],
        ["execute", ExecuteInvalidContextOption],
        ["returns", ExecuteInvalidNullInputOption],
        ["inline", ExecuteInvalidInlineOption],
    ];
    for (const [word, term] of candidates) {
        if (!matchesWord(input, 0, word) || !stack.canShift(term)) continue;
        return readContextualWord(input, word, term);
    }
    return false;
}

function readMoneyLiteral(input: InputStream): boolean {
    if (!moneySigns.has(input.next)) return false;
    let offset = 1;
    while (input.peek(offset) === space) offset++;
    if (input.peek(offset) === plus || input.peek(offset) === hyphen) offset++;
    const digitStart = offset;
    while (isDigit(input.peek(offset))) offset++;
    if (offset === digitStart) return false;
    if (input.peek(offset) === period) {
        offset++;
        while (isDigit(input.peek(offset))) offset++;
    }
    if (input.peek(offset) === lowerE || input.peek(offset) === upperE) {
        const exponentStart = offset;
        offset++;
        if (input.peek(offset) === plus || input.peek(offset) === hyphen) offset++;
        const exponentDigits = offset;
        while (isDigit(input.peek(offset))) offset++;
        if (offset === exponentDigits) offset = exponentStart;
    }
    input.advance(offset);
    input.acceptToken(MoneyLiteral);
    return true;
}

function readContextualWord(input: InputStream, expected: string, term: number): boolean {
    for (let offset = 0; offset < expected.length; offset++) {
        const code = input.peek(offset);
        const lower = code >= 65 && code <= 90 ? code + 32 : code;
        if (lower !== expected.charCodeAt(offset)) return false;
    }
    if (isIdentifierCode(input.peek(expected.length))) return false;
    input.advance(expected.length);
    input.acceptToken(term);
    return true;
}

function readUpdatePredicateKeyword(input: InputStream): boolean {
    const expected = "update";
    for (let offset = 0; offset < expected.length; offset++) {
        const code = input.peek(offset);
        const lower = code >= 65 && code <= 90 ? code + 32 : code;
        if (lower !== expected.charCodeAt(offset)) return false;
    }
    if (isIdentifierCode(input.peek(expected.length))) return false;
    let follower = expected.length;
    while (isSqlWhitespace(input.peek(follower))) follower++;
    if (input.peek(follower) !== openParen) return false;
    input.advance(expected.length);
    input.acceptToken(UpdatePredicateKeyword);
    return true;
}

function looksLikeUpdatePredicate(input: InputStream): boolean {
    if (!matchesWord(input, 0, "update")) return false;
    let follower = "update".length;
    while (isSqlWhitespace(input.peek(follower))) follower++;
    return input.peek(follower) === openParen;
}

function readViewCheckWith(input: InputStream): boolean {
    if (!matchesWord(input, 0, "with")) return false;
    let offset = "with".length;
    if (!isSqlWhitespace(input.peek(offset))) return false;
    while (isSqlWhitespace(input.peek(offset))) offset++;
    if (!matchesWord(input, offset, "check")) return false;
    input.advance("with".length);
    input.acceptToken(ViewCheckWith);
    return true;
}

function looksLikeViewCheckWith(input: InputStream): boolean {
    if (!matchesWord(input, 0, "with")) return false;
    let offset = "with".length;
    if (!isSqlWhitespace(input.peek(offset))) return false;
    while (isSqlWhitespace(input.peek(offset))) offset++;
    return matchesWord(input, offset, "check");
}

function matchesWord(input: InputStream, start: number, expected: string): boolean {
    for (let offset = 0; offset < expected.length; offset++) {
        const code = input.peek(start + offset);
        const lower = code >= 65 && code <= 90 ? code + 32 : code;
        if (lower !== expected.charCodeAt(offset)) return false;
    }
    return !isIdentifierCode(input.peek(start + expected.length));
}

function readLabel(input: InputStream): boolean {
    let offset = 1;
    while (isIdentifierCode(input.peek(offset))) offset++;
    while (isHorizontalSpace(input.peek(offset))) offset++;
    if (input.peek(offset) !== colon || input.peek(offset + 1) === colon) return false;
    input.advance(offset + 1);
    input.acceptToken(Label);
    return true;
}

function readAtTimeZone(input: InputStream): boolean {
    const expectedWords = ["at", "time", "zone"];
    let offset = 0;
    for (let wordIndex = 0; wordIndex < expectedWords.length; wordIndex++) {
        for (const character of expectedWords[wordIndex]!) {
            if (String.fromCharCode(input.peek(offset)).toLowerCase() !== character) return false;
            offset++;
        }
        if (isIdentifierCode(input.peek(offset))) return false;
        if (wordIndex < expectedWords.length - 1) {
            if (!isSqlWhitespace(input.peek(offset))) return false;
            while (isSqlWhitespace(input.peek(offset))) offset++;
        }
    }
    input.advance(offset);
    input.acceptToken(AtTimeZone);
    return true;
}

function readHorizontalWhitespace(input: InputStream): void {
    do input.advance();
    while (isHorizontalSpace(input.next));
    input.acceptToken(horizontalWhitespace);
}

function readLineBreak(input: InputStream): void {
    if (input.next === carriageReturn) input.advance();
    if (input.next === lineFeed) input.advance();
    while (isHorizontalSpace(input.next)) input.advance();
    input.acceptToken(lineBreak);
}

function readNestedBlockComment(input: InputStream): void {
    input.advance(2);
    let depth = 1;
    while (input.next >= 0) {
        if (input.next === forwardSlash && input.peek(1) === asterisk) {
            depth++;
            input.advance(2);
        } else if (input.next === asterisk && input.peek(1) === forwardSlash) {
            depth--;
            input.advance(2);
            if (depth === 0) break;
        } else {
            input.advance();
        }
    }
    input.acceptToken(BlockComment);
}

function isLineLeading(stack: Stack): boolean {
    return (stack.context as SqlLexicalContext | null)?.lineLeading ?? stack.pos === 0;
}

interface SqlLexicalContext {
    readonly lineLeading: boolean;
    readonly statementLeading: boolean;
}

function readBatchSeparator(input: InputStream): boolean {
    const second = input.peek(1);
    if (second !== lowerO && second !== upperO) return false;
    let offset = 2;
    const boundary = input.peek(offset);
    if (!isHorizontalSpace(boundary) && !isLineEnd(boundary)) return false;

    while (isHorizontalSpace(input.peek(offset))) offset++;
    while (isDigit(input.peek(offset))) offset++;
    while (isHorizontalSpace(input.peek(offset))) offset++;

    if (input.peek(offset) === hyphen && input.peek(offset + 1) === hyphen) {
        offset += 2;
        while (!isLineEnd(input.peek(offset))) offset++;
    }
    if (!isLineEnd(input.peek(offset))) return false;

    input.advance(offset);
    // Validate the full line but retain count/comment as separate grammar/public tokens.
    input.acceptToken(Go, 2 - offset);
    return true;
}

function isDigit(code: number): boolean {
    return code >= digitZero && code <= digitNine;
}

function isHorizontalSpace(code: number): boolean {
    return (
        (code >= 0x0000 && code <= 0x0008) ||
        code === tab ||
        code === 0x000b ||
        code === 0x000c ||
        (code >= 0x000e && code <= space) ||
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

function isLineEnd(code: number): boolean {
    return code < 0 || code === carriageReturn || code === lineFeed;
}

function isSqlWhitespace(code: number): boolean {
    return isHorizontalSpace(code) || code === carriageReturn || code === lineFeed;
}

function isIdentifierCode(code: number): boolean {
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

function isIdentifierStart(code: number): boolean {
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code >= 128;
}
