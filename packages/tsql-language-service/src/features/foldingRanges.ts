/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxNode, SyntaxSnapshot, SyntaxToken } from "../syntax/index.js";
import type { FoldingRange, FoldingRangeKind, FoldingRangeOptions } from "./contracts.js";

/**
 * Wrappers that repeat the range of the construct they hold, plus the batch and script nodes the
 * mixed parser mounts inside a module body. Folding them would put a second arrow on a line that
 * already has one, or an arrow on the first line of a block rather than on its header.
 */
const transparentKinds = new Set(["Script", "Statement", "ProceduralStatement"]);

/** Bodies and bracketed lists worth collapsing on their own, beyond whole statements. */
const blockKinds = new Set([
    "ModuleBody",
    "CreateTableDefinitionBody",
    "TableDefinition",
    "TableConstraint",
    "CommonTableExpression",
    "CaseExpression",
    "DerivedTable",
    "ParenthesizedQuery",
    "ValuesInsertSource",
    "ProcedureParameterList",
    "FunctionParameterList",
    "MergeActionClause",
    "MergeAction",
    "WithColumnSchema",
    "QuerySpecification",
    "WindowSpecification",
    "PivotJoin",
    "UnpivotJoin",
    "TableHintClause",
    "IndexWithClause",
]);

/**
 * Clauses that begin with their own keyword, so the fold arrow lands on `WHERE` or `GROUP BY`
 * rather than on the first item beneath it. A select list is excluded for that reason: it starts at
 * its first expression, which would put an arrow in the middle of the statement it belongs to.
 */
const clauseKinds = new Set([
    "FromClause",
    "WhereClause",
    "GroupByClause",
    "HavingClause",
    "OrderByClause",
]);

/** Ranking for candidates that begin and end on the same lines; lower wins. */
const kindPriority: Record<string, number> = { region: 0, comment: 1, structural: 2 };

// The shapes `syntaxes/sql.configuration.json` declares for the editor fallback, matched without
// regard to case so an upper-case marker is not silently ignored. Nothing follows `#region` here
// because the configuration accepts a trailing label, and `#endregion` cannot match the start
// pattern, so a plain prefix test keeps both in step with it.
const regionStart = /^--\s*#region/iu;
const regionEnd = /^--\s*#endregion/iu;

interface Candidate {
    readonly start: number;
    readonly end: number;
    readonly kind?: FoldingRangeKind;
}

/**
 * Derives collapsible regions from the published syntax snapshot. Nothing is parsed here: statement
 * and block folds come from tree shape, comment folds from the token stream, and region folds from
 * the `-- #region` and `-- #endregion` markers the SQL language configuration already defines.
 */
export function collectFoldingRanges(
    syntax: SyntaxSnapshot,
    options: FoldingRangeOptions = {},
): readonly FoldingRange[] {
    const candidates: Candidate[] = [];
    const contentEnds: number[] = [];
    const root = syntax.root();
    // A batch fold collapses one GO-delimited section. With no GO the only batch is the document
    // itself, and collapsing everything from its first line is not a fold anybody asks for.
    collectStructuralRanges(root, undefined, countBatches(root) > 1, candidates);
    collectCommentRanges(syntax, candidates, contentEnds);
    return normalize(candidates, syntax, contentEnds, options.limit);
}

function countBatches(root: SyntaxNode): number {
    let count = 0;
    for (const child of root.children()) {
        if (child.kind === "Batch" && child.end > child.start) count++;
    }
    return count;
}

function collectStructuralRanges(
    node: SyntaxNode,
    parent: SyntaxNode | undefined,
    foldBatches: boolean,
    candidates: Candidate[],
): void {
    if (node.kind === "Batch") candidates.push(...transactionRanges(node));
    if (node.kind === "BeginControlStatement") {
        // BEGIN/END pairs are collected from the block keywords so that TRY and CATCH collapse
        // separately rather than as one region covering both.
        candidates.push(...beginEndRanges(node));
    } else if (isFoldableKind(node, parent, foldBatches)) {
        candidates.push({ start: node.start, end: node.end });
    }
    for (const child of node.children()) {
        collectStructuralRanges(child, node, foldBatches, candidates);
    }
}

function isFoldableKind(
    node: SyntaxNode,
    parent: SyntaxNode | undefined,
    foldBatches: boolean,
): boolean {
    if (node.kind === "Batch") {
        if (!foldBatches) return false;
        // Only the batches of the document itself, never the ones a mounted module body contains,
        // and only when the batch groups several statements. A batch holding one statement begins
        // on that statement's line, and a line can carry a single fold.
        const topLevel =
            parent !== undefined && parent.kind === "Script" && parent.parent() === undefined;
        return topLevel && countStatements(node) > 1;
    }
    if (transparentKinds.has(node.kind)) return false;
    return (
        node.kind.endsWith("Statement") || blockKinds.has(node.kind) || clauseKinds.has(node.kind)
    );
}

function countStatements(batch: SyntaxNode): number {
    let count = 0;
    for (const child of batch.children()) {
        if (child.kind === "Statement") count++;
    }
    return count;
}

/**
 * A transaction has no enclosing node: `BEGIN TRANSACTION` and `COMMIT` are sibling statements. The
 * pair is matched over the statements of one batch, innermost first, the way nesting behaves at
 * run time. An unclosed transaction folds nothing, and `SAVE TRANSACTION` marks a savepoint rather
 * than closing anything.
 */
function transactionRanges(batch: SyntaxNode): readonly Candidate[] {
    const ranges: Candidate[] = [];
    const open: SyntaxNode[] = [];
    for (const statement of batch.children()) {
        for (const child of statement.children()) {
            if (child.kind === "BeginTransactionStatement") open.push(child);
            else if (
                child.kind === "CommitTransactionStatement" ||
                child.kind === "RollbackTransactionStatement"
            ) {
                const start = open.pop();
                if (start) ranges.push({ start: start.start, end: child.end });
            }
        }
    }
    return ranges;
}

function beginEndRanges(node: SyntaxNode): readonly Candidate[] {
    const ranges: Candidate[] = [];
    let open: SyntaxNode | undefined;
    for (const child of node.children()) {
        if (child.kind === "Begin") open = child;
        else if (child.kind === "End" && open) {
            ranges.push({ start: open.start, end: child.end });
            open = undefined;
        }
    }
    // An unterminated block still collapses to the end of what was parsed.
    return open ? [...ranges, { start: open.start, end: node.end }] : ranges;
}

function collectCommentRanges(
    syntax: SyntaxSnapshot,
    candidates: Candidate[],
    contentEnds: number[],
): void {
    const regions: SyntaxToken[] = [];
    let run: SyntaxToken[] = [];
    const flushRun = (): void => {
        if (run.length > 1) {
            candidates.push({ start: run[0]!.start, end: run.at(-1)!.end, kind: "comment" });
        }
        run = [];
    };

    let previousLineComment: SyntaxToken | undefined;
    for (const token of syntax.tokens()) {
        if (!token.trivia) contentEnds.push(token.end);
        if (token.kind === "BlockComment") {
            flushRun();
            previousLineComment = undefined;
            candidates.push({ start: token.start, end: token.end, kind: "comment" });
            continue;
        }
        if (token.kind === "StringLiteral") {
            // Dynamic SQL and JSON payloads are written as literals that run over many lines.
            flushRun();
            previousLineComment = undefined;
            candidates.push({ start: token.start, end: token.end });
            continue;
        }
        if (token.kind !== "LineComment") {
            // Whitespace between two comment lines keeps the run open; anything else ends it.
            if (token.trivia && !containsBlankLine(token.text)) continue;
            flushRun();
            previousLineComment = undefined;
            continue;
        }
        if (!token.lineStart) {
            flushRun();
            previousLineComment = undefined;
            continue;
        }
        if (regionStart.test(token.text) || regionEnd.test(token.text)) {
            flushRun();
            previousLineComment = undefined;
            regions.push(token);
            continue;
        }
        if (previousLineComment) run.push(token);
        else run = [token];
        previousLineComment = token;
    }
    flushRun();
    candidates.push(...regionRanges(regions));
}

/** A blank line separates two comment runs, matching how a reader sees them. */
/**
 * A parse tree hands trailing trivia to the construct that precedes it, so a statement can appear
 * to reach into the comment or blank lines after it. A structural fold therefore stops at the last
 * code the construct actually contains. Comment and region folds keep their own trivia ends.
 */
function structuralEnd(candidate: Candidate, text: string, contentEnds: readonly number[]): number {
    const limit = Math.min(candidate.end, text.length);
    let low = 0;
    let high = contentEnds.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (contentEnds[middle]! <= limit) low = middle + 1;
        else high = middle;
    }
    const snapped = contentEnds[low - 1];
    if (snapped !== undefined && snapped > candidate.start) return snapped;
    let end = limit;
    while (end > candidate.start && /\s/u.test(text[end - 1]!)) end--;
    return end;
}

function containsBlankLine(text: string): boolean {
    return /\r?\n[^\S\r\n]*\r?\n/u.test(text);
}

function regionRanges(markers: readonly SyntaxToken[]): readonly Candidate[] {
    const ranges: Candidate[] = [];
    const open: SyntaxToken[] = [];
    for (const marker of markers) {
        if (regionStart.test(marker.text)) {
            open.push(marker);
            continue;
        }
        const start = open.pop();
        // An end marker without a start is left to the user to fix; it folds nothing.
        if (start) ranges.push({ start: start.start, end: marker.end, kind: "region" });
    }
    return ranges;
}

/**
 * Turns raw candidates into the guarantees the contract states: more than one line each, one range
 * per starting line, and proper nesting. Ends are trimmed of trailing whitespace so a construct
 * that stops at a line break does not collapse the line after it.
 */
function normalize(
    candidates: readonly Candidate[],
    syntax: SyntaxSnapshot,
    contentEnds: readonly number[],
    limit: number | undefined,
): readonly FoldingRange[] {
    const text = syntax.document.text;
    const resolved = candidates
        .map((candidate) => {
            const end = candidate.kind
                ? Math.min(candidate.end, text.length)
                : structuralEnd(candidate, text, contentEnds);
            return {
                start: candidate.start,
                end,
                kind: candidate.kind,
                startLine: syntax.document.positionAt(candidate.start).line,
                endLine: syntax.document.positionAt(end).line,
            };
        })
        .filter((candidate) => candidate.endLine > candidate.startLine)
        .sort(
            (left, right) =>
                left.startLine - right.startLine ||
                right.endLine - left.endLine ||
                kindPriority[left.kind ?? "structural"]! -
                    kindPriority[right.kind ?? "structural"]!,
        );

    const accepted: FoldingRange[] = [];
    const spans: number[] = [];
    const openEndLines: number[] = [];
    let previousStartLine = -1;
    for (const candidate of resolved) {
        if (candidate.startLine === previousStartLine) continue;
        while (openEndLines.length > 0 && openEndLines.at(-1)! < candidate.startLine) {
            openEndLines.pop();
        }
        // A candidate that leaves an enclosing region before ending would fold across its parent.
        if (openEndLines.length > 0 && candidate.endLine > openEndLines.at(-1)!) continue;
        previousStartLine = candidate.startLine;
        openEndLines.push(candidate.endLine);
        accepted.push(
            Object.freeze(
                candidate.kind
                    ? { start: candidate.start, end: candidate.end, kind: candidate.kind }
                    : { start: candidate.start, end: candidate.end },
            ),
        );
        spans.push(candidate.endLine - candidate.startLine);
    }
    return Object.freeze(withinLimit(accepted, spans, limit));
}

/**
 * Keeps the widest regions when there are more than the host will accept. Only the narrowest ranges
 * are dropped, and a range is never wider than the one containing it, so nesting still holds.
 */
function withinLimit(
    accepted: readonly FoldingRange[],
    spans: readonly number[],
    limit: number | undefined,
): FoldingRange[] {
    if (limit === undefined || accepted.length <= limit) return [...accepted];
    if (limit <= 0) return [];
    const order = accepted.map((_range, index) => index);
    order.sort((left, right) => spans[right]! - spans[left]! || left - right);
    const keep = new Set(order.slice(0, limit));
    return accepted.filter((_range, index) => keep.has(index));
}
