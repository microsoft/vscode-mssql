/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TextRange } from "../../text/index.js";

/** Target size keeps initial parsing cache-friendly while never splitting a SQL batch. */
export const defaultBatchChunkTarget = 8 * 1024;

/**
 * Partitions text only after complete line-leading GO commands. Existing safe boundaries are
 * preferred during updates so an edit does not cause unrelated chunk identities to cascade.
 */
export function partitionSqlBatches(
    text: string,
    preferredBoundaries: ReadonlySet<number> = new Set(),
    targetSize = defaultBatchChunkTarget,
): readonly TextRange[] {
    const safeBoundaries = findSafeBatchBoundaries(text);
    const safeSet = new Set(safeBoundaries);
    const preferred = new Set(
        [...preferredBoundaries].filter(
            (boundary) => boundary > 0 && boundary < text.length && safeSet.has(boundary),
        ),
    );
    const result: TextRange[] = [];
    let start = 0;
    for (const boundary of safeBoundaries) {
        if (boundary === text.length || preferred.has(boundary) || boundary - start >= targetSize) {
            if (boundary > start || result.length === 0) result.push({ start, end: boundary });
            start = boundary;
        }
    }
    if (start < text.length) result.push({ start, end: text.length });
    return Object.freeze(result);
}

/**
 * Returns offsets immediately after safe GO lines. The scanner mirrors the external tokenizer's
 * lexical states: newlines inside strings, quoted identifiers, or nested comments do not reset
 * line-leading state.
 */
export function findSafeBatchBoundaries(text: string): readonly number[] {
    const boundaries: number[] = [];
    let offset = 0;
    let lineLeading = true;
    while (offset < text.length) {
        const current = text.charCodeAt(offset);
        const next = text.charCodeAt(offset + 1);
        if (current === 32 || current === 9) {
            offset++;
            continue;
        }
        if (current === 13 || current === 10) {
            offset = consumeLineBreak(text, offset);
            lineLeading = true;
            continue;
        }
        if (current === 45 && next === 45) {
            offset = consumeLineComment(text, offset + 2);
            lineLeading = false;
            continue;
        }
        if (current === 47 && next === 42) {
            offset = consumeNestedBlockComment(text, offset + 2);
            lineLeading = false;
            continue;
        }
        if (current === 39 || current === 34 || current === 91) {
            offset = consumeDelimited(text, offset + 1, current === 91 ? 93 : current);
            lineLeading = false;
            continue;
        }
        if (lineLeading && (current === 71 || current === 103)) {
            const boundary = batchSeparatorEnd(text, offset);
            if (boundary !== undefined) {
                offset = boundary;
                if (
                    offset < text.length &&
                    (text.charCodeAt(offset) === 13 || text.charCodeAt(offset) === 10)
                ) {
                    offset = consumeLineBreak(text, offset);
                }
                boundaries.push(offset);
                lineLeading = true;
                continue;
            }
        }
        lineLeading = false;
        offset++;
    }
    if (boundaries.at(-1) !== text.length) boundaries.push(text.length);
    return Object.freeze(boundaries);
}

function batchSeparatorEnd(text: string, start: number): number | undefined {
    if (start + 1 >= text.length || (text[start + 1] !== "O" && text[start + 1] !== "o")) {
        return undefined;
    }
    let offset = start + 2;
    if (
        offset < text.length &&
        !isHorizontalSpace(text.charCodeAt(offset)) &&
        !isLineEnd(text.charCodeAt(offset))
    ) {
        return undefined;
    }
    while (isHorizontalSpace(text.charCodeAt(offset))) offset++;
    while (isDigit(text.charCodeAt(offset))) offset++;
    while (isHorizontalSpace(text.charCodeAt(offset))) offset++;
    if (text.charCodeAt(offset) === 45 && text.charCodeAt(offset + 1) === 45) {
        offset = consumeLineComment(text, offset + 2);
    }
    return isLineEnd(text.charCodeAt(offset)) ? offset : undefined;
}

function consumeDelimited(text: string, start: number, close: number): number {
    let offset = start;
    while (offset < text.length) {
        if (text.charCodeAt(offset) !== close) {
            offset++;
        } else if (text.charCodeAt(offset + 1) === close) {
            offset += 2;
        } else {
            return offset + 1;
        }
    }
    return offset;
}

function consumeNestedBlockComment(text: string, start: number): number {
    let depth = 1;
    let offset = start;
    while (offset < text.length && depth > 0) {
        const current = text.charCodeAt(offset);
        const next = text.charCodeAt(offset + 1);
        if (current === 47 && next === 42) {
            depth++;
            offset += 2;
        } else if (current === 42 && next === 47) {
            depth--;
            offset += 2;
        } else {
            offset++;
        }
    }
    return offset;
}

function consumeLineComment(text: string, start: number): number {
    let offset = start;
    while (offset < text.length && !isLineEnd(text.charCodeAt(offset))) offset++;
    return offset;
}

function consumeLineBreak(text: string, start: number): number {
    return text.charCodeAt(start) === 13 && text.charCodeAt(start + 1) === 10
        ? start + 2
        : start + 1;
}

function isHorizontalSpace(code: number): boolean {
    return code === 32 || code === 9;
}

function isLineEnd(code: number): boolean {
    return Number.isNaN(code) || code === 13 || code === 10;
}

function isDigit(code: number): boolean {
    return code >= 48 && code <= 57;
}
