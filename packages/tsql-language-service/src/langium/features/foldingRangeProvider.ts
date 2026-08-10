/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FoldingRangeKind, type FoldingRange } from "vscode-languageserver-types";
import type { SqlToken } from "../../analysis/contracts.js";
import {
    positionAt,
    type SqlFeatureDocument,
    type SqlFeatureDocumentAccessor,
} from "./featureDocument.js";

interface OpenFold {
    readonly token: SqlToken;
    readonly kind: "parenthesis" | "begin" | "case";
}

export class SqlFoldingRangeProvider {
    public constructor(private readonly documents: SqlFeatureDocumentAccessor) {}

    public async getFoldingRanges(uri: string): Promise<FoldingRange[]> {
        const document = await this.documents.getDocument(uri);
        if (!document) {
            return [];
        }
        const ranges: FoldingRange[] = [];
        this.collectComments(document, ranges);
        this.collectDelimitedBlocks(document, ranges);
        this.collectStatements(document, ranges);
        return dedupeRanges(ranges).sort(
            (left, right) =>
                left.startLine - right.startLine ||
                (left.startCharacter ?? 0) - (right.startCharacter ?? 0) ||
                left.endLine - right.endLine,
        );
    }

    private collectComments(document: SqlFeatureDocument, ranges: FoldingRange[]): void {
        const comments = document.analysis.tokens.filter((token) => token.role === "comment");
        const regions: SqlToken[] = [];
        let lineRun: { start: SqlToken; end: SqlToken } | undefined;
        for (const token of comments) {
            const regionMarker = /^\s*--\s*#(end)?region\b/iu.exec(token.text);
            if (regionMarker?.[1]) {
                const opening = regions.pop();
                if (opening && token.start.line > opening.start.line) {
                    ranges.push({
                        startLine: opening.start.line,
                        startCharacter: opening.start.character,
                        endLine: token.end.line,
                        endCharacter: token.end.character,
                        kind: FoldingRangeKind.Region,
                    });
                }
            } else if (regionMarker) {
                regions.push(token);
            }
            if (token.role !== "comment" || token.end.line <= token.start.line) {
                if (token.text.trimStart().startsWith("--")) {
                    if (lineRun && token.start.line <= lineRun.end.end.line + 1) {
                        lineRun.end = token;
                    } else {
                        flushLineCommentRun(lineRun, ranges);
                        lineRun = { start: token, end: token };
                    }
                }
            } else {
                flushLineCommentRun(lineRun, ranges);
                lineRun = undefined;
                ranges.push({
                    startLine: token.start.line,
                    startCharacter: token.start.character,
                    endLine: token.end.line,
                    endCharacter: token.end.character,
                    kind: FoldingRangeKind.Comment,
                });
            }
        }
        flushLineCommentRun(lineRun, ranges);
    }

    private collectDelimitedBlocks(document: SqlFeatureDocument, ranges: FoldingRange[]): void {
        const tokens = document.analysis.tokens.filter((token) => token.channel === "code");
        const stack: OpenFold[] = [];
        for (let index = 0; index < tokens.length; index++) {
            const token = tokens[index];
            const keyword = token.consumedAs === "keyword" ? token.text.toUpperCase() : "";
            if (token.text === "(") {
                stack.push({ token, kind: "parenthesis" });
            } else if (token.text === ")") {
                closeNearest(stack, "parenthesis", token, ranges);
            } else if (keyword === "CASE") {
                stack.push({ token, kind: "case" });
            } else if (keyword === "BEGIN" && !isTransactionBegin(tokens[index + 1])) {
                stack.push({ token, kind: "begin" });
            } else if (keyword === "END") {
                closeNearest(stack, ["case", "begin"], token, ranges);
            }
        }
    }

    private collectStatements(document: SqlFeatureDocument, ranges: FoldingRange[]): void {
        for (const statement of document.analysis.statements) {
            const start = firstNonWhitespace(
                document.text,
                statement.span.start,
                statement.span.end,
            );
            const end = lastNonWhitespace(document.text, statement.span.start, statement.span.end);
            if (start >= end) {
                continue;
            }
            const startPosition = positionAt(document, start);
            const endPosition = positionAt(document, end);
            if (endPosition.line > startPosition.line) {
                ranges.push({
                    startLine: startPosition.line,
                    startCharacter: startPosition.character,
                    endLine: endPosition.line,
                    endCharacter: endPosition.character,
                    kind: FoldingRangeKind.Region,
                });
            }
        }
    }
}

function flushLineCommentRun(
    run: { readonly start: SqlToken; readonly end: SqlToken } | undefined,
    ranges: FoldingRange[],
): void {
    if (run && run.end.end.line > run.start.start.line) {
        ranges.push({
            startLine: run.start.start.line,
            startCharacter: run.start.start.character,
            endLine: run.end.end.line,
            endCharacter: run.end.end.character,
            kind: FoldingRangeKind.Comment,
        });
    }
}

function closeNearest(
    stack: OpenFold[],
    requestedKind: OpenFold["kind"] | OpenFold["kind"][],
    closing: SqlToken,
    ranges: FoldingRange[],
): void {
    const kinds = Array.isArray(requestedKind) ? requestedKind : [requestedKind];
    const index = stack.findLastIndex((entry) => kinds.includes(entry.kind));
    if (index < 0) {
        return;
    }
    const [opening] = stack.splice(index, 1);
    if (closing.start.line > opening.token.start.line) {
        ranges.push({
            startLine: opening.token.start.line,
            startCharacter: opening.token.start.character + opening.token.text.length,
            endLine: closing.start.line,
            endCharacter: closing.start.character,
            kind: FoldingRangeKind.Region,
        });
    }
}

function isTransactionBegin(token: SqlToken | undefined): boolean {
    return Boolean(
        token && ["TRAN", "TRANSACTION", "DISTRIBUTED"].includes(token.text.toUpperCase()),
    );
}

function firstNonWhitespace(text: string, start: number, end: number): number {
    while (start < end && /\s/.test(text[start])) {
        start++;
    }
    return start;
}

function lastNonWhitespace(text: string, start: number, end: number): number {
    while (end > start && /\s/.test(text[end - 1])) {
        end--;
    }
    return end;
}

function dedupeRanges(ranges: readonly FoldingRange[]): FoldingRange[] {
    const unique = new Map<string, FoldingRange>();
    for (const range of ranges) {
        if (range.endLine <= range.startLine) {
            continue;
        }
        const key = `${range.startLine}:${range.startCharacter ?? ""}:${range.endLine}:${range.endCharacter ?? ""}`;
        const existing = unique.get(key);
        if (!existing || (!existing.kind && range.kind)) {
            unique.set(key, range);
        }
    }
    return [...unique.values()];
}
