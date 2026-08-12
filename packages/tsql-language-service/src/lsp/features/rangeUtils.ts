/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Position, Range } from "vscode-languageserver-types";
import type {
    SqlOccurrence,
    SqlSpan,
    SqlSymbol,
    SqlSymbolKind,
    SqlToken,
} from "../../analysis/contracts.js";
import { positionAt, type SqlFeatureDocument } from "./featureDocument.js";

export interface NormalizedOccurrence {
    readonly occurrence: SqlOccurrence;
    readonly range: Range;
    readonly start: number;
    readonly end: number;
    readonly sourceText: string;
}

export function spanToRange(document: SqlFeatureDocument, span: SqlSpan): Range {
    return offsetsToRange(document, span.start, span.end);
}

export function offsetsToRange(document: SqlFeatureDocument, start: number, end: number): Range {
    return { start: positionAt(document, start), end: positionAt(document, end) };
}

export function comparePositions(left: Position, right: Position): number {
    return left.line - right.line || left.character - right.character;
}

export function compareRanges(left: Range, right: Range): number {
    return comparePositions(left.start, right.start) || comparePositions(left.end, right.end);
}

export function rangeContains(outer: Range, inner: Range): boolean {
    return (
        comparePositions(outer.start, inner.start) <= 0 &&
        comparePositions(outer.end, inner.end) >= 0
    );
}

export function rangeIntersects(left: Range, right: Range): boolean {
    return (
        comparePositions(left.start, right.end) < 0 && comparePositions(right.start, left.end) < 0
    );
}

export function rangesEqual(left: Range, right: Range): boolean {
    return compareRanges(left, right) === 0;
}

export function normalizeOccurrence(
    document: SqlFeatureDocument,
    occurrence: SqlOccurrence,
    symbol: string,
    kind: SqlSymbolKind,
    symbols: readonly SqlSymbol[],
): NormalizedOccurrence | undefined {
    const analysis = document.analysis;
    const expected = foldSymbol(analysis, symbol, kind);
    const symbolSpan = findBestSymbolSpan(analysis, occurrence, expected, kind, symbols);
    const tokens = analysis.tokens.filter(
        (token) =>
            isIdentifierToken(token) &&
            token.span.start >= occurrence.span.start &&
            token.span.end <= occurrence.span.end,
    );
    const token = pickIdentifierToken(analysis, tokens, expected, kind, symbolSpan);
    if (token) {
        return normalized(document, occurrence, token.span.start, token.span.end);
    }
    return symbolSpan && symbolSpan.end > symbolSpan.start
        ? normalized(document, occurrence, symbolSpan.start, symbolSpan.end)
        : undefined;
}

export function tokenRangeAt(document: SqlFeatureDocument, offset: number): Range | undefined {
    const token = tokenCovering(document.analysis.tokens, offset);
    return token ? offsetsToRange(document, token.span.start, token.span.end) : undefined;
}

export function tokenCovering(tokens: readonly SqlToken[], offset: number): SqlToken | undefined {
    return tokens.find((token) => token.span.start <= offset && offset < token.span.end);
}

export function isIdentifierToken(token: SqlToken): boolean {
    return token.role === "identifier" || token.consumedAs === "identifier";
}

export function identifierDisplayName(document: SqlFeatureDocument, text: string): string {
    return document.analysis.displayIdentifier(text.replace(/^[@#]+/, ""));
}

function normalized(
    document: SqlFeatureDocument,
    occurrence: SqlOccurrence,
    start: number,
    end: number,
): NormalizedOccurrence {
    return {
        occurrence,
        range: offsetsToRange(document, start, end),
        start,
        end,
        sourceText: document.text.slice(start, end),
    };
}

function findBestSymbolSpan(
    analysis: SqlFeatureDocument["analysis"],
    occurrence: SqlOccurrence,
    expected: string,
    kind: SqlSymbolKind,
    symbols: readonly SqlSymbol[],
): SqlSpan | undefined {
    const candidates = symbols.filter(
        (candidate) =>
            candidate.kind === kind &&
            candidate.span.start >= occurrence.span.start &&
            candidate.span.end <= occurrence.span.end &&
            foldSymbol(analysis, candidate.name, kind) === expected &&
            (occurrence.role !== "declaration" || candidate.modifiers.includes("declaration")),
    );
    if (candidates.length === 0 && occurrence.role === "declaration") {
        return symbols.find(
            (candidate) =>
                candidate.kind === kind &&
                candidate.modifiers.includes("declaration") &&
                candidate.span.start >= occurrence.span.start &&
                candidate.span.end <= occurrence.span.end &&
                foldSymbol(analysis, candidate.name, kind) === expected,
        )?.span;
    }
    return candidates.sort(spanWidth)[0]?.span;
}

function spanWidth(left: SqlSymbol, right: SqlSymbol): number {
    return left.span.end - left.span.start - (right.span.end - right.span.start);
}

function pickIdentifierToken(
    analysis: SqlFeatureDocument["analysis"],
    tokens: readonly SqlToken[],
    expected: string,
    kind: SqlSymbolKind,
    preferredSpan?: SqlSpan,
): SqlToken | undefined {
    const matching = tokens.filter((token) => foldSymbol(analysis, token.text, kind) === expected);
    if (preferredSpan) {
        const preferred = matching.find(
            (token) =>
                token.span.start >= preferredSpan.start && token.span.end <= preferredSpan.end,
        );
        if (preferred) {
            return preferred;
        }
    }
    return matching.at(-1);
}

function foldSymbol(
    analysis: SqlFeatureDocument["analysis"],
    raw: string,
    kind: SqlSymbolKind,
): string {
    const lastPart = raw.split(".").at(-1) ?? raw;
    return analysis.normalizeIdentifier(
        lastPart.replace(/^[@#]+/, ""),
        kind === "table" || kind === "tempTable" ? "table" : "other",
    );
}
