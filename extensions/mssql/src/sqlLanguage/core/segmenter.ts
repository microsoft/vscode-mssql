/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Batch + statement segmenter (language-service design 05 §7.2).
 *
 * Batch segmentation MUST agree with Query Studio execution splitting
 * (src/sql/batchSplitter.ts) for GO / GO n / trailing-junk — parity is
 * asserted by tests over the shared corpus; the splitter stays the execution
 * source of truth, this segmenter serves language features.
 *
 * Statement segmentation is tolerant v1: top-level semicolons,
 * statement-start keywords at depth 0 (with continuation exceptions:
 * UNION/EXCEPT/INTERSECT/ELSE/AS/open-paren), BEGIN/END block tracking
 * (BEGIN TRAN is a statement, not a block), TRY/CATCH, and
 * CREATE|ALTER module ... AS consuming the rest of the batch as the module
 * body with nested statements. The B9 sketch parser deepens per feature.
 */

import { Token, TokenKind, isTrivia } from "./lexer";

export interface StatementSegment {
    /** Character span (first significant token start .. last token end incl. terminator). */
    readonly start: number;
    readonly end: number;
    /** Token index range [firstToken, lastToken] inclusive, into the full token array. */
    readonly firstToken: number;
    readonly lastToken: number;
    /** Uppercase leading word (identifier/keyword) when present, e.g. "SELECT". */
    readonly leadingWord?: string;
    /** True when this statement is inside a CREATE/ALTER module body. */
    readonly inModuleBody?: boolean;
}

export interface BatchSegment {
    /** Character span of the batch content (excludes the GO line). */
    readonly start: number;
    readonly end: number;
    /** 1 for plain GO; max(1, n) for GO n; 1 when there is no GO (final batch). */
    readonly repeatCount: number;
    /** Token index of the GO separator terminating this batch, if any. */
    readonly goTokenIndex?: number;
    readonly statements: readonly StatementSegment[];
}

export interface SegmentResult {
    readonly batches: readonly BatchSegment[];
}

const CONTINUATION_BEFORE = new Set(["UNION", "EXCEPT", "INTERSECT", "ALL", "ELSE", "AS", "THEN"]);

const MODULE_KINDS = new Set(["PROC", "PROCEDURE", "FUNCTION", "VIEW", "TRIGGER"]);

export function segment(text: string, tokens: readonly Token[]): SegmentResult {
    const batches: BatchSegment[] = [];
    let batchFirst = 0; // token index where the current batch begins

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.kind === TokenKind.GoSeparator) {
            const { repeatCount, lineEnd } = readGoLine(text, tokens, i);
            // Empty batches are dropped, matching the execution splitter.
            if (hasSignificant(tokens, batchFirst, i)) {
                batches.push(buildBatch(text, tokens, batchFirst, i, repeatCount, i));
            }
            i = lineEnd;
            batchFirst = lineEnd + 1;
        } else if (t.kind === TokenKind.EndOfFile) {
            if (hasSignificant(tokens, batchFirst, i)) {
                batches.push(buildBatch(text, tokens, batchFirst, i, 1, undefined));
            }
        }
    }
    return { batches };
}

/**
 * Read the GO line remainder. The lexer only emits GoSeparator when the line
 * matches the execution splitter's shape, so this just extracts the count
 * (splitter semantics: count = max(1, n)).
 */
function readGoLine(
    text: string,
    tokens: readonly Token[],
    goIndex: number,
): { repeatCount: number; lineEnd: number } {
    let repeatCount = 1;
    let i = goIndex + 1;
    for (; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.kind === TokenKind.NewLine || t.kind === TokenKind.EndOfFile) {
            break;
        }
        if (t.kind === TokenKind.NumberLiteral) {
            const parsed = Number.parseInt(text.slice(t.start, t.end), 10);
            if (Number.isFinite(parsed)) {
                repeatCount = Math.max(1, parsed);
            }
        }
    }
    return { repeatCount, lineEnd: i };
}

/**
 * Batch CONTENT includes comments (execution-splitter parity: its batches
 * carry comment lines and a comment-only batch is still emitted); only
 * whitespace/newlines are outside batch spans.
 */
function isBatchContent(kind: TokenKind): boolean {
    return (
        kind !== TokenKind.Whitespace && kind !== TokenKind.NewLine && kind !== TokenKind.EndOfFile
    );
}

function hasSignificant(tokens: readonly Token[], from: number, toExclusive: number): boolean {
    for (let i = from; i < toExclusive; i++) {
        if (isBatchContent(tokens[i].kind)) {
            return true;
        }
    }
    return false;
}

function buildBatch(
    text: string,
    tokens: readonly Token[],
    firstToken: number,
    endTokenExclusive: number,
    repeatCount: number,
    goTokenIndex: number | undefined,
): BatchSegment {
    // Trim to content bounds for the char span (comments count as content).
    let firstSig = -1;
    let lastSig = -1;
    for (let i = firstToken; i < endTokenExclusive; i++) {
        if (isBatchContent(tokens[i].kind)) {
            if (firstSig < 0) {
                firstSig = i;
            }
            lastSig = i;
        }
    }
    const start = firstSig >= 0 ? tokens[firstSig].start : (tokens[firstToken]?.start ?? 0);
    const end = lastSig >= 0 ? tokens[lastSig].end : start;
    const statements =
        firstSig >= 0 ? segmentStatements(text, tokens, firstSig, endTokenExclusive) : [];
    return { start, end, repeatCount, goTokenIndex, statements };
}

interface WordInfo {
    readonly upper: string;
    readonly index: number;
}

function wordAt(text: string, tokens: readonly Token[], index: number): string | undefined {
    const t = tokens[index];
    if (t === undefined || t.kind !== TokenKind.Identifier) {
        return undefined;
    }
    return text.slice(t.start, t.end).toUpperCase();
}

function segmentStatements(
    text: string,
    tokens: readonly Token[],
    firstSig: number,
    endExclusive: number,
): StatementSegment[] {
    const statements: StatementSegment[] = [];
    let stmtFirst = -1;
    let lastSigInStmt = -1;
    let parenDepth = 0;
    let beginDepth = 0; // BEGIN...END blocks (incl. TRY/CATCH)
    let caseDepth = 0;
    let inModuleBody = false;
    let prevWord: WordInfo | undefined;

    const flush = (lastTokenIndex: number): void => {
        if (stmtFirst < 0 || lastTokenIndex < stmtFirst) {
            return;
        }
        const leading = wordAt(text, tokens, stmtFirst);
        statements.push({
            start: tokens[stmtFirst].start,
            end: tokens[lastTokenIndex].end,
            firstToken: stmtFirst,
            lastToken: lastTokenIndex,
            leadingWord: leading,
            inModuleBody: inModuleBody || undefined,
        });
        stmtFirst = -1;
        lastSigInStmt = -1;
    };

    for (let i = firstSig; i < endExclusive; i++) {
        const t = tokens[i];
        if (isTrivia(t.kind) || t.kind === TokenKind.EndOfFile) {
            continue;
        }

        if (stmtFirst < 0) {
            stmtFirst = i;
        }

        if (t.kind === TokenKind.Punctuation) {
            const ch = text.charCodeAt(t.start);
            if (ch === 40 /* ( */) {
                parenDepth++;
            } else if (ch === 41 /* ) */) {
                parenDepth = Math.max(0, parenDepth - 1);
            } else if (ch === 59 /* ; */ && parenDepth === 0 && caseDepth === 0) {
                flush(i);
                prevWord = undefined;
                continue;
            }
            lastSigInStmt = i;
            prevWord = undefined;
            continue;
        }

        if (t.kind === TokenKind.Identifier) {
            const upper = text.slice(t.start, t.end).toUpperCase();

            // CASE/END tracking (END closes CASE before it closes BEGIN).
            if (upper === "CASE") {
                caseDepth++;
            } else if (upper === "END") {
                if (caseDepth > 0) {
                    caseDepth--;
                } else if (beginDepth > 0) {
                    beginDepth--;
                    // END TRY / END CATCH consume the following word.
                    const next = nextSignificantWord(text, tokens, i + 1, endExclusive);
                    if (next !== undefined && (next.upper === "TRY" || next.upper === "CATCH")) {
                        lastSigInStmt = next.index;
                        prevWord = undefined;
                        i = next.index;
                        continue;
                    }
                }
            } else if (upper === "BEGIN" && parenDepth === 0) {
                const next = nextSignificantWord(text, tokens, i + 1, endExclusive);
                const isTran =
                    next !== undefined &&
                    (next.upper === "TRAN" ||
                        next.upper === "TRANSACTION" ||
                        next.upper === "DISTRIBUTED" ||
                        next.upper === "DIALOG" ||
                        next.upper === "CONVERSATION");
                if (!isTran) {
                    beginDepth++;
                }
            }

            // Module body: CREATE|ALTER <module kind> ... AS -> rest of batch is body.
            if (
                !inModuleBody &&
                upper === "AS" &&
                parenDepth === 0 &&
                statementStartsWithModuleHeader(text, tokens, stmtFirst)
            ) {
                // The header statement ends at AS; the body statements follow.
                flush(i);
                inModuleBody = true;
                prevWord = undefined;
                continue;
            }

            // New-statement boundary: a statement-start keyword at depth 0 that
            // is not a continuation of the previous token's construct.
            if (
                parenDepth === 0 &&
                caseDepth === 0 &&
                stmtFirst !== i &&
                t.keyword?.category === "statement" &&
                t.keyword.reserved && // unreserved words (GO, THROW) are legal identifiers
                upper !== "BEGIN" && // block handled above; BEGIN TRAN starts stmt below
                (prevWord === undefined || !CONTINUATION_BEFORE.has(prevWord.upper)) &&
                lastSigInStmt >= 0 &&
                !isBoundarySuppressed(text, tokens, lastSigInStmt)
            ) {
                flush(lastSigInStmt);
                stmtFirst = i;
            }

            lastSigInStmt = i;
            prevWord = { upper, index: i };
            continue;
        }

        lastSigInStmt = i;
        prevWord = undefined;
    }

    flush(lastSigInStmt >= 0 ? lastSigInStmt : stmtFirst >= 0 ? stmtFirst : firstSig);
    return statements;
}

/** Suppress a keyword boundary right after tokens that syntactically continue. */
function isBoundarySuppressed(text: string, tokens: readonly Token[], lastSig: number): boolean {
    const t = tokens[lastSig];
    if (t === undefined) {
        return false;
    }
    if (t.kind === TokenKind.Punctuation) {
        const ch = text.charCodeAt(t.start);
        return ch === 40 || ch === 44 || ch === 46; // ( , .
    }
    if (t.kind === TokenKind.Operator) {
        return true; // e.g. "= SELECT" inside DECLARE ... = (subquery-ish); tolerant
    }
    return false;
}

function nextSignificantWord(
    text: string,
    tokens: readonly Token[],
    from: number,
    endExclusive: number,
): WordInfo | undefined {
    for (let i = from; i < endExclusive; i++) {
        const t = tokens[i];
        if (isTrivia(t.kind)) {
            continue;
        }
        if (t.kind === TokenKind.Identifier) {
            return { upper: text.slice(t.start, t.end).toUpperCase(), index: i };
        }
        return undefined;
    }
    return undefined;
}

/** True when the statement starting at stmtFirst looks like CREATE|ALTER <module>. */
function statementStartsWithModuleHeader(
    text: string,
    tokens: readonly Token[],
    stmtFirst: number,
): boolean {
    const first = wordAt(text, tokens, stmtFirst);
    if (first !== "CREATE" && first !== "ALTER") {
        return false;
    }
    // Scan a few significant tokens for the module kind (handles OR ALTER).
    let seen = 0;
    for (let i = stmtFirst + 1; i < tokens.length && seen < 4; i++) {
        const t = tokens[i];
        if (isTrivia(t.kind)) {
            continue;
        }
        if (t.kind !== TokenKind.Identifier) {
            return false;
        }
        const upper = text.slice(t.start, t.end).toUpperCase();
        if (MODULE_KINDS.has(upper)) {
            return true;
        }
        if (upper !== "OR" && upper !== "ALTER") {
            return false;
        }
        seen++;
    }
    return false;
}
