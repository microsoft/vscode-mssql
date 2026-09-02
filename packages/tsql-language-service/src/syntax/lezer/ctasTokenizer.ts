/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExternalTokenizer, type InputStream } from "@lezer/lr";
import { CtasColumnNameList } from "./generated/tsqlParser.terms.js";

/** Recognizes only `(name, ...) WITH`, keeping CTAS names distinct from typed table columns. */
export const ctasColumnNameListToken = new ExternalTokenizer((input) => {
    const end = readCtasColumnNameList(input);
    if (end === undefined) return;
    input.advance(end);
    input.acceptToken(CtasColumnNameList);
});

function readCtasColumnNameList(input: InputStream): number | undefined {
    if (input.next !== 40) return undefined;
    let offset = skipTrivia(input, 1);
    let names = 0;
    while (true) {
        const nameEnd = readIdentifier(input, offset);
        if (nameEnd === undefined) return undefined;
        names++;
        offset = skipTrivia(input, nameEnd);
        if (input.peek(offset) === 44) {
            offset = skipTrivia(input, offset + 1);
            continue;
        }
        if (input.peek(offset) !== 41 || names === 0) return undefined;
        const tokenEnd = offset + 1;
        offset = skipTrivia(input, tokenEnd);
        return matchesWord(input, offset, "with") ? tokenEnd : undefined;
    }
}

function readIdentifier(input: InputStream, offset: number): number | undefined {
    const first = input.peek(offset);
    if (first === 91) return readDelimited(input, offset + 1, 93);
    if (first === 34) return readDelimited(input, offset + 1, 34);
    if (!isIdentifierStart(first)) return undefined;
    offset++;
    while (isIdentifierPart(input.peek(offset))) offset++;
    return offset;
}

function readDelimited(input: InputStream, offset: number, close: number): number | undefined {
    while (input.peek(offset) >= 0) {
        if (input.peek(offset) !== close) {
            offset++;
            continue;
        }
        if (input.peek(offset + 1) === close) {
            offset += 2;
            continue;
        }
        return offset + 1;
    }
    return undefined;
}

function skipTrivia(input: InputStream, start: number): number {
    let offset = start;
    while (true) {
        while (isWhitespace(input.peek(offset))) offset++;
        if (input.peek(offset) === 45 && input.peek(offset + 1) === 45) {
            offset += 2;
            while (
                input.peek(offset) >= 0 &&
                input.peek(offset) !== 10 &&
                input.peek(offset) !== 13
            )
                offset++;
            continue;
        }
        if (input.peek(offset) !== 47 || input.peek(offset + 1) !== 42) return offset;
        offset += 2;
        let depth = 1;
        while (depth > 0 && input.peek(offset) >= 0) {
            if (input.peek(offset) === 47 && input.peek(offset + 1) === 42) {
                depth++;
                offset += 2;
            } else if (input.peek(offset) === 42 && input.peek(offset + 1) === 47) {
                depth--;
                offset += 2;
            } else offset++;
        }
        if (depth > 0) return offset;
    }
}

function matchesWord(input: InputStream, offset: number, word: string): boolean {
    for (let index = 0; index < word.length; index++) {
        if (lower(input.peek(offset + index)) !== word.charCodeAt(index)) return false;
    }
    return !isIdentifierPart(input.peek(offset + word.length));
}

function lower(code: number): number {
    return code >= 65 && code <= 90 ? code + 32 : code;
}

function isWhitespace(code: number): boolean {
    return code === 9 || code === 10 || code === 13 || code === 32;
}

function isIdentifierStart(code: number): boolean {
    return (
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        code === 95 ||
        code === 35 ||
        code === 64 ||
        code >= 128
    );
}

function isIdentifierPart(code: number): boolean {
    return isIdentifierStart(code) || (code >= 48 && code <= 57) || code === 36;
}
