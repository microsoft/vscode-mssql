/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Folding (design 05 §14.1) — needs only lexer + segmenter, so it ships with
 * LS-0: GO batches, multi-line statements, multi-line block comments, and
 * --#region / --#endregion pairs. BEGIN/END, TRY/CATCH and CASE folding
 * deepen with the B9 sketch parser.
 */

import { FoldingRangeResult } from "../api";
import { Token, TokenKind } from "../core/lexer";
import { SegmentResult } from "../core/segmenter";
import { TextSnapshot } from "../core/text/textSnapshot";

const REGION_START = /^--\s*#region\b/i;
const REGION_END = /^--\s*#endregion\b/i;

export function computeFolding(
    snapshot: TextSnapshot,
    tokens: readonly Token[],
    segments: SegmentResult,
): FoldingRangeResult[] {
    const ranges: FoldingRangeResult[] = [];

    // Batches and their statements.
    for (const batch of segments.batches) {
        addSpanRange(ranges, snapshot, batch.start, batch.end, undefined);
        for (const statement of batch.statements) {
            addSpanRange(ranges, snapshot, statement.start, statement.end, undefined);
        }
    }

    // Multi-line block comments + region pairs.
    const regionStack: number[] = [];
    for (const token of tokens) {
        if (token.kind === TokenKind.BlockComment) {
            addSpanRange(ranges, snapshot, token.start, token.end, "comment");
        } else if (token.kind === TokenKind.LineComment) {
            const text = snapshot.slice(token);
            if (REGION_START.test(text)) {
                regionStack.push(snapshot.positionAt(token.start).line);
            } else if (REGION_END.test(text)) {
                const startLine = regionStack.pop();
                if (startLine !== undefined) {
                    const endLine = snapshot.positionAt(token.start).line;
                    if (endLine > startLine) {
                        ranges.push({ startLine, endLine, kind: "region" });
                    }
                }
            }
        }
    }

    // De-duplicate identical line ranges (batch == its only statement, etc.).
    const seen = new Set<string>();
    return ranges.filter((r) => {
        const key = `${r.startLine}:${r.endLine}:${r.kind ?? ""}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function addSpanRange(
    out: FoldingRangeResult[],
    snapshot: TextSnapshot,
    start: number,
    end: number,
    kind: FoldingRangeResult["kind"],
): void {
    const startLine = snapshot.positionAt(start).line;
    const endLine = snapshot.positionAt(Math.max(start, end - 1)).line;
    if (endLine > startLine) {
        out.push({ startLine, endLine, kind });
    }
}
