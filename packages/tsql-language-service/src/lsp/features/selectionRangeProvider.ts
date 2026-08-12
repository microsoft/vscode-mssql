/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Position, Range, SelectionRange } from "vscode-languageserver-types";
import type { SqlToken } from "../../analysis/contracts.js";
import {
    offsetAt,
    type SqlFeatureDocument,
    type SqlFeatureDocumentAccessor,
} from "./featureDocument.js";
import { offsetsToRange, rangeContains, rangesEqual, tokenRangeAt } from "./rangeUtils.js";

export class SqlSelectionRangeProvider {
    public constructor(private readonly documents: SqlFeatureDocumentAccessor) {}

    public async getSelectionRanges(uri: string, positions: Position[]): Promise<SelectionRange[]> {
        const document = await this.documents.getDocument(uri);
        if (!document) {
            return [];
        }
        return positions.map((position) => this.selectionRangeAt(document, position));
    }

    private selectionRangeAt(document: SqlFeatureDocument, position: Position): SelectionRange {
        const offset = offsetAt(document, position);
        const ranges: Range[] = [];
        addRange(ranges, tokenRangeAt(document, offset));
        addRange(ranges, multipartIdentifierRange(document, offset));
        addRange(ranges, commaDelimitedItemRange(document, offset));
        for (const range of parenthesizedRanges(document, offset)) {
            addRange(ranges, range);
        }
        for (const clause of document.analysis.clausesAt(offset)) {
            if (clause.span.start <= offset && offset < clause.span.end) {
                addRange(ranges, offsetsToRange(document, clause.span.start, clause.span.end));
            }
        }
        const statement = document.analysis.statements.find(
            (candidate) => candidate.span.start <= offset && offset < candidate.span.end,
        );
        if (statement) {
            const trimmed = trimSpan(document.text, statement.span.start, statement.span.end);
            addRange(ranges, offsetsToRange(document, trimmed.start, trimmed.end));
        }
        addRange(ranges, offsetsToRange(document, 0, document.text.length));

        const nested = ranges
            .filter((range) => containsPosition(range, position))
            .sort(rangeSizeAscending)
            .filter(
                (range, index, ordered) => index === 0 || !rangesEqual(range, ordered[index - 1]),
            );
        if (nested.length === 0) {
            nested.push({ start: position, end: position });
        }
        let result: SelectionRange | undefined;
        for (let index = nested.length - 1; index >= 0; index--) {
            result = { range: nested[index], parent: result };
        }
        return result!;
    }
}

function multipartIdentifierRange(document: SqlFeatureDocument, offset: number): Range | undefined {
    const tokens = document.analysis.tokens.filter((token) => token.channel === "code");
    let index = tokens.findIndex((token) => token.span.start <= offset && offset < token.span.end);
    if (index < 0 || !isIdentifier(tokens[index])) {
        return undefined;
    }
    let start = index;
    let end = index;
    while (start >= 2 && tokens[start - 1].text === "." && isIdentifier(tokens[start - 2])) {
        start -= 2;
    }
    while (
        end + 2 < tokens.length &&
        tokens[end + 1].text === "." &&
        isIdentifier(tokens[end + 2])
    ) {
        end += 2;
    }
    return start === end
        ? undefined
        : offsetsToRange(document, tokens[start].span.start, tokens[end].span.end);
}

function commaDelimitedItemRange(document: SqlFeatureDocument, offset: number): Range | undefined {
    const tokens = document.analysis.tokens.filter((token) => token.channel === "code");
    const touched = tokens.findIndex(
        (token) => token.span.start <= offset && offset < token.span.end,
    );
    if (touched < 0) {
        return undefined;
    }
    let depth = 0;
    let start = touched;
    for (let index = touched - 1; index >= 0; index--) {
        const token = tokens[index];
        if (token.text === ")") {
            depth++;
        } else if (token.text === "(") {
            if (depth === 0) break;
            depth--;
        } else if (depth === 0 && (token.text === "," || isClauseBoundary(token))) {
            break;
        }
        start = index;
    }
    depth = 0;
    let end = touched;
    for (let index = touched + 1; index < tokens.length; index++) {
        const token = tokens[index];
        if (token.text === "(") {
            depth++;
        } else if (token.text === ")") {
            if (depth === 0) break;
            depth--;
        } else if (depth === 0 && (token.text === "," || isClauseBoundary(token))) {
            break;
        }
        end = index;
    }
    return start === end
        ? undefined
        : offsetsToRange(document, tokens[start].span.start, tokens[end].span.end);
}

function isIdentifier(token: SqlToken): boolean {
    return token.role === "identifier" || token.consumedAs === "identifier";
}

function isClauseBoundary(token: SqlToken): boolean {
    return [
        "SELECT",
        "FROM",
        "WHERE",
        "GROUP",
        "HAVING",
        "ORDER",
        "JOIN",
        "ON",
        "VALUES",
        "SET",
        "OUTPUT",
    ].includes(token.text.toUpperCase());
}

function parenthesizedRanges(document: SqlFeatureDocument, offset: number): Range[] {
    const stack: SqlToken[] = [];
    const pairs: Array<{ start: number; end: number }> = [];
    for (const token of document.analysis.tokens) {
        if (token.channel !== "code") {
            continue;
        }
        if (token.text === "(") {
            stack.push(token);
        } else if (token.text === ")") {
            const opening = stack.pop();
            if (opening && opening.span.start <= offset && offset < token.span.end) {
                pairs.push({ start: opening.span.start, end: token.span.end });
            }
        }
    }
    return pairs
        .sort((left, right) => left.end - left.start - (right.end - right.start))
        .map((pair) => offsetsToRange(document, pair.start, pair.end));
}

function addRange(ranges: Range[], range: Range | undefined): void {
    if (!range || ranges.some((existing) => rangesEqual(existing, range))) {
        return;
    }
    if (ranges.length > 0 && !rangeContains(range, ranges.at(-1)!)) {
        return;
    }
    ranges.push(range);
}

function containsPosition(range: Range, position: Position): boolean {
    return (
        (range.start.line < position.line ||
            (range.start.line === position.line && range.start.character <= position.character)) &&
        (range.end.line > position.line ||
            (range.end.line === position.line && range.end.character >= position.character))
    );
}

function rangeSizeAscending(left: Range, right: Range): number {
    return rangeSize(left) - rangeSize(right);
}

function rangeSize(range: Range): number {
    return (
        (range.end.line - range.start.line) * 1_000_000 +
        range.end.character -
        range.start.character
    );
}

function trimSpan(text: string, start: number, end: number): { start: number; end: number } {
    start = Math.max(0, Math.min(start, text.length));
    end = Math.max(start, Math.min(end, text.length));
    while (start < end && /\s/.test(text[start])) {
        start++;
    }
    while (end > start && /\s/.test(text[end - 1])) {
        end--;
    }
    return { start, end };
}
