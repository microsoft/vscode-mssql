/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tolerant statement sketch parser (design 05 §7.3). Total: always returns a
 * sketch, even for half-written SQL — recovery is "skip to the next anchor".
 * Works over the full-fidelity token stream; all indices are into the shared
 * token array; spans are character offsets.
 */

import { Token, TokenKind, isTrivia } from "../lexer";
import { StatementSegment } from "../segmenter";
import {
    ClauseKind,
    CteDecl,
    ExecArg,
    QueryScope,
    SelectItem,
    SketchSpan,
    SourceKind,
    SourceRef,
    StatementKind,
    StatementSketch,
    VariableDecl,
} from "./types";

export * from "./types";

// Clause-introducing keywords at depth 0 inside a query expression.
const CLAUSE_STARTERS = new Set([
    "SELECT",
    "INTO",
    "FROM",
    "WHERE",
    "GROUP",
    "HAVING",
    "WINDOW",
    "ORDER",
    "OPTION",
    "UNION",
    "EXCEPT",
    "INTERSECT",
    "FOR",
]);

const JOIN_WORDS = new Set(["JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "OUTER"]);

/** Words that end an alias hunt (never aliases themselves). */
const NON_ALIAS_WORDS = new Set([
    ...CLAUSE_STARTERS,
    ...JOIN_WORDS,
    "ON",
    "AS",
    "WITH",
    "APPLY",
    "PIVOT",
    "UNPIVOT",
    "TABLESAMPLE",
    "OUTPUT",
    "SET",
    "USING",
    "WHEN",
    "VALUES",
    "END",
    "GO",
]);

class SketchBuilder {
    readonly scopes: QueryScope[] = [];
    readonly clauses: { kind: ClauseKind; scopeId: number; span: SketchSpan }[] = [];
    readonly sources: SourceRef[] = [];
    readonly selectItems: SelectItem[] = [];
    readonly ctes: CteDecl[] = [];
    readonly declares: VariableDecl[] = [];
    selectIntoParts: string[] | undefined;
    selectIntoSpan: SketchSpan | undefined;

    constructor(
        readonly text: string,
        readonly tokens: readonly Token[],
    ) {}

    newScope(parentId: number | undefined, span: SketchSpan): number {
        const id = this.scopes.length;
        this.scopes.push({ id, parentId, span });
        return id;
    }

    clause(kind: ClauseKind, scopeId: number, start: number, end: number): void {
        if (end > start) {
            this.clauses.push({ kind, scopeId, span: { start, end } });
        }
    }

    // ---- token helpers -----------------------------------------------------

    next(i: number, endExclusive: number): number {
        let j = i;
        while (j < endExclusive && isTrivia(this.tokens[j].kind)) {
            j++;
        }
        return j;
    }

    tok(i: number): Token | undefined {
        return this.tokens[i];
    }

    word(i: number): string | undefined {
        const t = this.tokens[i];
        if (t === undefined || t.kind !== TokenKind.Identifier) {
            return undefined;
        }
        return this.text.slice(t.start, t.end).toUpperCase();
    }

    punct(i: number): string | undefined {
        const t = this.tokens[i];
        if (
            t === undefined ||
            (t.kind !== TokenKind.Punctuation && t.kind !== TokenKind.Operator)
        ) {
            return undefined;
        }
        return this.text.slice(t.start, t.end);
    }

    /** Raw text of a name-capable token with quoting stripped. */
    namePart(i: number): string | undefined {
        const t = this.tokens[i];
        if (t === undefined) {
            return undefined;
        }
        const raw = this.text.slice(t.start, t.end);
        switch (t.kind) {
            case TokenKind.Identifier:
                return raw;
            case TokenKind.BracketedIdentifier:
                return raw.slice(1, raw.endsWith("]") ? -1 : undefined).replace(/\]\]/g, "]");
            case TokenKind.QuotedIdentifier:
                return raw.slice(1, raw.endsWith('"') ? -1 : undefined).replace(/""/g, '"');
            case TokenKind.TempName:
            case TokenKind.GlobalTempName:
                return raw;
            default:
                return undefined;
        }
    }

    isNameToken(i: number): boolean {
        const t = this.tokens[i];
        return (
            t !== undefined &&
            (t.kind === TokenKind.Identifier ||
                t.kind === TokenKind.BracketedIdentifier ||
                t.kind === TokenKind.QuotedIdentifier ||
                t.kind === TokenKind.TempName ||
                t.kind === TokenKind.GlobalTempName)
        );
    }

    /** Skip a balanced ( ... ) group; i points AT the open paren. */
    skipBalanced(i: number, endExclusive: number): number {
        let depth = 0;
        let j = i;
        while (j < endExclusive) {
            const p = this.punct(j);
            if (p === "(") {
                depth++;
            } else if (p === ")") {
                depth--;
                if (depth === 0) {
                    return j + 1;
                }
            }
            j++;
        }
        return endExclusive;
    }
}

/** Read a dotted name chain starting at i; returns undefined if none. */
function readNameParts(
    b: SketchBuilder,
    i: number,
    endExclusive: number,
): { parts: string[]; span: SketchSpan; next: number } | undefined {
    let j = b.next(i, endExclusive);
    if (!b.isNameToken(j)) {
        return undefined;
    }
    const parts: string[] = [];
    const start = b.tok(j)!.start;
    let end = b.tok(j)!.end;
    parts.push(b.namePart(j)!);
    let k = j + 1;
    for (;;) {
        const dot = b.next(k, endExclusive);
        if (b.punct(dot) !== ".") {
            return { parts, span: { start, end }, next: dot };
        }
        const nextName = b.next(dot + 1, endExclusive);
        if (!b.isNameToken(nextName)) {
            // Trailing dot: "o." — record the empty tail so the classifier
            // knows a member position follows.
            return { parts: [...parts, ""], span: { start, end: b.tok(dot)!.end }, next: nextName };
        }
        parts.push(b.namePart(nextName)!);
        end = b.tok(nextName)!.end;
        k = nextName + 1;
    }
}

/** Optional [AS] alias after a source; returns alias + next index. */
function readAlias(
    b: SketchBuilder,
    i: number,
    endExclusive: number,
): { alias?: string; next: number } {
    let j = b.next(i, endExclusive);
    const w = b.word(j);
    if (w === "AS") {
        const n = b.next(j + 1, endExclusive);
        if (b.isNameToken(n)) {
            return { alias: b.namePart(n), next: n + 1 };
        }
        return { next: n };
    }
    if (b.isNameToken(j)) {
        const word = b.word(j);
        if (word === undefined) {
            // bracket/quoted alias
            return { alias: b.namePart(j), next: j + 1 };
        }
        const t = b.tok(j)!;
        if (!NON_ALIAS_WORDS.has(word) && !(t.keyword?.reserved === true)) {
            return { alias: b.namePart(j), next: j + 1 };
        }
    }
    return { next: j };
}

/**
 * Scan an expression span for parenthesized subqueries; each becomes a child
 * scope parsed recursively.
 */
function scanForSubqueries(
    b: SketchBuilder,
    scopeId: number,
    i: number,
    endExclusive: number,
    depthGuard: number,
): void {
    if (depthGuard > 24) {
        return;
    }
    let j = i;
    while (j < endExclusive) {
        if (b.punct(j) === "(") {
            const close = b.skipBalanced(j, endExclusive);
            const first = b.next(j + 1, close - 1);
            const w = b.word(first);
            if (w === "SELECT" || w === "WITH") {
                const child = b.newScope(scopeId, {
                    start: b.tok(j)!.start,
                    end: b.tok(Math.max(j, close - 1))!.end,
                });
                parseQueryExpression(b, child, first, close - 1, depthGuard + 1);
            } else {
                scanForSubqueries(b, scopeId, j + 1, close - 1, depthGuard + 1);
            }
            j = close;
            continue;
        }
        j++;
    }
}

/** Parse FROM-clause sources until a clause keyword at depth 0. */
function parseFromSources(
    b: SketchBuilder,
    scopeId: number,
    i: number,
    endExclusive: number,
    depthGuard: number,
): number {
    let j = b.next(i, endExclusive);
    let expectSource = true;
    while (j < endExclusive) {
        const w = b.word(j);
        if (w !== undefined && CLAUSE_STARTERS.has(w) && w !== "SELECT") {
            return j;
        }
        if (w === "ON") {
            // ON expression until next join/clause keyword at depth 0.
            const start = b.next(j + 1, endExclusive);
            let k = start;
            while (k < endExclusive) {
                const p = b.punct(k);
                if (p === "(") {
                    k = b.skipBalanced(k, endExclusive);
                    continue;
                }
                const kw = b.word(k);
                if (
                    kw !== undefined &&
                    (JOIN_WORDS.has(kw) ||
                        (CLAUSE_STARTERS.has(kw) && kw !== "SELECT") ||
                        kw === "APPLY")
                ) {
                    break;
                }
                if (p === ",") {
                    break;
                }
                k++;
            }
            if (k > start && b.tok(start) !== undefined) {
                b.clause("on", scopeId, b.tok(start)!.start, b.tok(Math.max(start, k - 1))!.end);
                scanForSubqueries(b, scopeId, start, k, depthGuard);
            } else {
                // Caret right after ON — record an empty-anchor clause.
                const anchor = b.tok(j)!.end;
                b.clause("on", scopeId, anchor, anchor + 1);
            }
            j = k;
            expectSource = false;
            continue;
        }
        if (w !== undefined && (JOIN_WORDS.has(w) || w === "APPLY")) {
            j = b.next(j + 1, endExclusive);
            expectSource = true;
            continue;
        }
        if (b.punct(j) === ",") {
            j = b.next(j + 1, endExclusive);
            expectSource = true;
            continue;
        }
        if (!expectSource) {
            j++;
            continue;
        }

        // One source.
        if (b.punct(j) === "(") {
            const close = b.skipBalanced(j, endExclusive);
            const first = b.next(j + 1, close - 1);
            const fw = b.word(first);
            let kind: SourceKind = "unknown";
            let innerScopeId: number | undefined;
            if (fw === "SELECT" || fw === "WITH") {
                kind = "derived";
                innerScopeId = b.newScope(scopeId, {
                    start: b.tok(j)!.start,
                    end: b.tok(Math.max(j, close - 1))!.end,
                });
                parseQueryExpression(b, innerScopeId, first, close - 1, depthGuard + 1);
            } else if (fw === "VALUES") {
                kind = "values";
            }
            const spanStart = b.tok(j)!.start;
            const spanEnd = b.tok(Math.max(j, close - 1))!.end;
            const aliasRead = readAlias(b, close, endExclusive);
            b.sources.push({
                scopeId,
                parts: [],
                kind,
                alias: aliasRead.alias,
                span: { start: spanStart, end: spanEnd },
                innerScopeId,
            });
            j = aliasRead.next;
            expectSource = false;
            continue;
        }

        // Table variable source: FROM @t [AS] alias.
        const varTok = b.tok(j);
        if (varTok !== undefined && varTok.kind === TokenKind.Variable) {
            const aliasRead = readAlias(b, j + 1, endExclusive);
            b.sources.push({
                scopeId,
                parts: [b.text.slice(varTok.start, varTok.end)],
                kind: "table",
                alias: aliasRead.alias,
                span: { start: varTok.start, end: varTok.end },
            });
            j = aliasRead.next;
            expectSource = false;
            continue;
        }

        const name = readNameParts(b, j, endExclusive);
        if (name === undefined) {
            j++;
            continue;
        }
        let kind: SourceKind = "table";
        let after = name.next;
        if (b.punct(after) === "(") {
            kind =
                name.parts.length === 1 && name.parts[0].toUpperCase() === "OPENROWSET"
                    ? "openrowset"
                    : "tvf";
            after = b.skipBalanced(after, endExclusive);
        }
        const aliasRead = readAlias(b, after, endExclusive);
        after = aliasRead.next;
        // Table hints: WITH ( ... )
        const hintWord = b.next(after, endExclusive);
        if (b.word(hintWord) === "WITH") {
            const open = b.next(hintWord + 1, endExclusive);
            if (b.punct(open) === "(") {
                after = b.skipBalanced(open, endExclusive);
            }
        }
        b.sources.push({
            scopeId,
            parts: name.parts,
            kind,
            alias: aliasRead.alias,
            span: name.span,
        });
        j = after;
        expectSource = false;
    }
    return j;
}

/** Split the SELECT list into items on top-level commas. */
function parseSelectList(
    b: SketchBuilder,
    scopeId: number,
    i: number,
    endExclusive: number,
    depthGuard: number,
): void {
    let itemStart = -1;
    let lastSig = -1;
    let j = i;
    const flush = (endTok: number): void => {
        if (itemStart < 0 || endTok < itemStart) {
            return;
        }
        const spanStart = b.tok(itemStart)!.start;
        const spanEnd = b.tok(endTok)!.end;
        // Star detection: single '*' or trailing '.*'.
        let isStar = false;
        let starQualifier: string | undefined;
        const firstP = b.punct(itemStart);
        if (firstP === "*" && b.next(itemStart + 1, endTok + 1) > endTok) {
            isStar = true;
        } else if (b.punct(endTok) === "*" && b.punct(endTok - 1) === ".") {
            isStar = true;
            const name = readNameParts(b, itemStart, endTok);
            starQualifier = name?.parts.filter((p) => p.length > 0).join(".");
        }
        // Alias: trailing [AS] name where name is not reserved.
        let alias: string | undefined;
        if (!isStar) {
            const t = b.tok(endTok);
            if (
                t !== undefined &&
                b.isNameToken(endTok) &&
                (b.word(endTok) === undefined || t.keyword?.reserved !== true)
            ) {
                // Either "expr AS alias" or "expr alias" — accept as alias
                // only when more than one significant token exists.
                if (endTok > itemStart) {
                    alias = b.namePart(endTok);
                }
            }
        }
        b.selectItems.push({
            scopeId,
            span: { start: spanStart, end: spanEnd },
            alias,
            isStar: isStar || undefined,
            starQualifier,
        });
        scanForSubqueries(b, scopeId, itemStart, endTok + 1, depthGuard);
    };
    while (j < endExclusive) {
        if (isTrivia(b.tok(j)?.kind ?? TokenKind.EndOfFile)) {
            j++;
            continue;
        }
        const p = b.punct(j);
        if (p === "(") {
            j = b.skipBalanced(j, endExclusive);
            lastSig = j - 1;
            continue;
        }
        if (p === ",") {
            flush(lastSig);
            itemStart = -1;
            j++;
            continue;
        }
        if (itemStart < 0) {
            itemStart = j;
        }
        lastSig = j;
        j++;
    }
    flush(lastSig);
}

/**
 * Parse one query expression within [i, endExclusive) attached to scopeId.
 * Returns the index it stopped at.
 */
function parseQueryExpression(
    b: SketchBuilder,
    scopeId: number,
    i: number,
    endExclusive: number,
    depthGuard: number,
): number {
    if (depthGuard > 24) {
        return endExclusive;
    }
    let j = b.next(i, endExclusive);
    while (j < endExclusive) {
        const w = b.word(j);
        if (w === undefined) {
            if (b.punct(j) === "(") {
                j = b.skipBalanced(j, endExclusive);
                continue;
            }
            j++;
            continue;
        }
        switch (w) {
            case "SELECT": {
                // TOP (n) [PERCENT] handled inside the list span harmlessly.
                const listStart = b.next(j + 1, endExclusive);
                const listEnd = findClauseEnd(b, listStart, endExclusive);
                if (listStart < listEnd) {
                    b.clause(
                        "selectList",
                        scopeId,
                        b.tok(listStart)!.start,
                        b.tok(listEnd - 1)!.end,
                    );
                    parseSelectList(b, scopeId, listStart, listEnd, depthGuard);
                } else {
                    const anchor = b.tok(j)!.end;
                    b.clause("selectList", scopeId, anchor, anchor + 1);
                }
                j = listEnd;
                break;
            }
            case "INTO": {
                const name = readNameParts(b, j + 1, endExclusive);
                if (name !== undefined) {
                    b.clause("into", scopeId, name.span.start, name.span.end);
                    b.selectIntoParts = name.parts;
                    b.selectIntoSpan = name.span;
                    j = name.next;
                } else {
                    const anchor = b.tok(j)!.end;
                    b.clause("into", scopeId, anchor, anchor + 1);
                    j = b.next(j + 1, endExclusive);
                }
                break;
            }
            case "FROM": {
                const fromStart = b.next(j + 1, endExclusive);
                const stopped = parseFromSources(b, scopeId, fromStart, endExclusive, depthGuard);
                const spanStart =
                    fromStart < endExclusive && b.tok(fromStart) !== undefined
                        ? b.tok(fromStart)!.start
                        : b.tok(j)!.end;
                const spanEnd =
                    stopped > fromStart && b.tok(stopped - 1) !== undefined
                        ? b.tok(stopped - 1)!.end
                        : spanStart + 1;
                b.clause("from", scopeId, spanStart, spanEnd);
                j = stopped;
                break;
            }
            case "WHERE":
            case "HAVING": {
                const start = b.next(j + 1, endExclusive);
                const end = findClauseEnd(b, start, endExclusive);
                if (start < end) {
                    b.clause(
                        w === "WHERE" ? "where" : "having",
                        scopeId,
                        b.tok(start)!.start,
                        b.tok(end - 1)!.end,
                    );
                    scanForSubqueries(b, scopeId, start, end, depthGuard);
                } else {
                    const anchor = b.tok(j)!.end;
                    b.clause(w === "WHERE" ? "where" : "having", scopeId, anchor, anchor + 1);
                }
                j = end;
                break;
            }
            case "GROUP":
            case "ORDER": {
                const by = b.next(j + 1, endExclusive);
                const start = b.word(by) === "BY" ? b.next(by + 1, endExclusive) : by;
                const end = findClauseEnd(b, start, endExclusive);
                const kind: ClauseKind = w === "GROUP" ? "groupBy" : "orderBy";
                if (start < end) {
                    b.clause(kind, scopeId, b.tok(start)!.start, b.tok(end - 1)!.end);
                    scanForSubqueries(b, scopeId, start, end, depthGuard);
                } else {
                    const anchor = b.tok(j)!.end;
                    b.clause(kind, scopeId, anchor, anchor + 1);
                }
                j = end;
                break;
            }
            case "OPTION":
            case "WINDOW":
            case "FOR": {
                const start = b.next(j + 1, endExclusive);
                const end = findClauseEnd(b, start, endExclusive);
                if (w === "OPTION" && start < end) {
                    b.clause("option", scopeId, b.tok(start)!.start, b.tok(end - 1)!.end);
                }
                j = Math.max(end, j + 1);
                break;
            }
            case "UNION":
            case "EXCEPT":
            case "INTERSECT":
                j = b.next(j + 1, endExclusive);
                break;
            default:
                j++;
                break;
        }
    }
    return endExclusive;
}

/** Find where the current clause ends: next clause keyword at depth 0. */
function findClauseEnd(b: SketchBuilder, i: number, endExclusive: number): number {
    let j = i;
    while (j < endExclusive) {
        if (b.punct(j) === "(") {
            j = b.skipBalanced(j, endExclusive);
            continue;
        }
        const w = b.word(j);
        if (w !== undefined && CLAUSE_STARTERS.has(w) && w !== "SELECT") {
            return j;
        }
        if (w === "SELECT" && j !== i) {
            return j;
        }
        j++;
    }
    return endExclusive;
}

/** WITH name [(cols)] AS ( ... ) [, ...] — returns index after the CTE list. */
function parseCtes(b: SketchBuilder, rootScope: number, i: number, endExclusive: number): number {
    let j = b.next(i, endExclusive);
    for (;;) {
        const name = readNameParts(b, j, endExclusive);
        if (name === undefined) {
            return j;
        }
        let k = name.next;
        let columns: string[] | undefined;
        if (b.punct(k) === "(") {
            const close = b.skipBalanced(k, endExclusive);
            columns = [];
            let c = b.next(k + 1, close - 1);
            while (c < close - 1) {
                if (b.isNameToken(c)) {
                    columns.push(b.namePart(c)!);
                }
                // advance to next comma
                while (c < close - 1 && b.punct(c) !== ",") {
                    c++;
                }
                c = b.next(c + 1, close - 1);
            }
            k = b.next(close, endExclusive);
        }
        let bodyScopeId: number | undefined;
        let end = name.span.end;
        if (b.word(k) === "AS") {
            const open = b.next(k + 1, endExclusive);
            if (b.punct(open) === "(") {
                const close = b.skipBalanced(open, endExclusive);
                bodyScopeId = b.newScope(rootScope, {
                    start: b.tok(open)!.start,
                    end: b.tok(Math.max(open, close - 1))!.end,
                });
                parseQueryExpression(b, bodyScopeId, b.next(open + 1, close - 1), close - 1, 1);
                k = b.next(close, endExclusive);
                end = b.tok(Math.max(open, close - 1))!.end;
            }
        }
        b.ctes.push({
            name: name.parts[0],
            columns,
            bodyScopeId,
            span: { start: name.span.start, end },
        });
        if (b.punct(k) === ",") {
            j = b.next(k + 1, endExclusive);
            continue;
        }
        return k;
    }
}

function parseDeclare(b: SketchBuilder, i: number, endExclusive: number): void {
    let j = b.next(i, endExclusive);
    while (j < endExclusive) {
        const t = b.tok(j);
        if (t === undefined) {
            break;
        }
        if (t.kind !== TokenKind.Variable) {
            j++;
            continue;
        }
        const varName = b.text.slice(t.start, t.end);
        let k = b.next(j + 1, endExclusive);
        if (b.word(k) === "AS") {
            k = b.next(k + 1, endExclusive);
        }
        if (b.word(k) === "TABLE") {
            const open = b.next(k + 1, endExclusive);
            let tableColumns: string[] | undefined;
            let end = b.tok(k)!.end;
            if (b.punct(open) === "(") {
                const close = b.skipBalanced(open, endExclusive);
                tableColumns = readColumnNames(b, open, close);
                end = b.tok(Math.max(open, close - 1))!.end;
                k = close;
            }
            b.declares.push({
                name: varName,
                typeText: "TABLE",
                isTable: true,
                tableColumns,
                span: { start: t.start, end },
            });
            j = k;
            continue;
        }
        // Scalar: type = tokens until , or = or end.
        const typeStart = k;
        let typeEnd = k;
        while (k < endExclusive) {
            const tk = b.tok(k);
            if (tk === undefined) {
                break;
            }
            if (isTrivia(tk.kind)) {
                k++;
                continue;
            }
            const p = b.punct(k);
            if (p === "," || p === "=") {
                break;
            }
            if (p === "(") {
                k = b.skipBalanced(k, endExclusive);
                typeEnd = k - 1;
                continue;
            }
            if (tk.kind === TokenKind.Variable) {
                break;
            }
            typeEnd = k;
            k++;
        }
        const typeText =
            typeEnd >= typeStart && b.tok(typeStart) !== undefined
                ? b.text.slice(b.tok(typeStart)!.start, b.tok(typeEnd)!.end)
                : undefined;
        b.declares.push({
            name: varName,
            typeText,
            span: { start: t.start, end: typeText !== undefined ? b.tok(typeEnd)!.end : t.end },
        });
        j = k;
    }
}

/** Column names from a CREATE TABLE / table-variable body ( ... ). */
function readColumnNames(b: SketchBuilder, openParen: number, closeExclusive: number): string[] {
    const names: string[] = [];
    let j = b.next(openParen + 1, closeExclusive - 1);
    let atSegmentStart = true;
    const CONSTRAINT_STARTERS = new Set([
        "CONSTRAINT",
        "PRIMARY",
        "UNIQUE",
        "FOREIGN",
        "CHECK",
        "INDEX",
        "PERIOD",
    ]);
    while (j < closeExclusive - 1) {
        const t = b.tok(j);
        if (t === undefined) {
            break;
        }
        if (isTrivia(t.kind)) {
            j++;
            continue;
        }
        if (b.punct(j) === "(") {
            j = b.skipBalanced(j, closeExclusive);
            continue;
        }
        if (b.punct(j) === ",") {
            atSegmentStart = true;
            j++;
            continue;
        }
        if (atSegmentStart) {
            const w = b.word(j);
            if (b.isNameToken(j) && (w === undefined || !CONSTRAINT_STARTERS.has(w))) {
                names.push(b.namePart(j)!);
            }
            atSegmentStart = false;
        }
        j++;
    }
    return names;
}

function parseExec(
    b: SketchBuilder,
    i: number,
    endExclusive: number,
): { procParts: string[]; procSpan: SketchSpan; args: ExecArg[] } | undefined {
    let j = b.next(i, endExclusive);
    // Optional @return = form.
    const t = b.tok(j);
    if (t !== undefined && t.kind === TokenKind.Variable) {
        const eq = b.next(j + 1, endExclusive);
        if (b.punct(eq) === "=") {
            j = b.next(eq + 1, endExclusive);
        }
    }
    if (b.punct(j) === "(") {
        return undefined; // EXEC ('dynamic sql') — opaque
    }
    const name = readNameParts(b, j, endExclusive);
    if (name === undefined) {
        return { procParts: [], procSpan: { start: 0, end: 0 }, args: [] };
    }
    const args: ExecArg[] = [];
    let k = b.next(name.next, endExclusive);
    let argStart = -1;
    let argName: string | undefined;
    let lastSig = -1;
    const flush = (): void => {
        if (argStart >= 0 && lastSig >= argStart) {
            args.push({
                name: argName,
                span: { start: b.tok(argStart)!.start, end: b.tok(lastSig)!.end },
            });
        }
        argStart = -1;
        argName = undefined;
    };
    while (k < endExclusive) {
        const tk = b.tok(k);
        if (tk === undefined) {
            break;
        }
        if (isTrivia(tk.kind)) {
            k++;
            continue;
        }
        if (b.punct(k) === "(") {
            k = b.skipBalanced(k, endExclusive);
            lastSig = k - 1;
            continue;
        }
        if (b.punct(k) === ",") {
            flush();
            k++;
            continue;
        }
        if (argStart < 0) {
            argStart = k;
            if (tk.kind === TokenKind.Variable) {
                const eq = b.next(k + 1, endExclusive);
                if (b.punct(eq) === "=") {
                    argName = b.text.slice(tk.start, tk.end);
                }
            }
        }
        lastSig = k;
        k++;
    }
    flush();
    return { procParts: name.parts, procSpan: name.span, args };
}

/** Parse one statement into a sketch. */
export function sketchStatement(
    text: string,
    tokens: readonly Token[],
    statement: StatementSegment,
): StatementSketch {
    const b = new SketchBuilder(text, tokens);
    const span = { start: statement.start, end: statement.end };
    const endExclusive = statement.lastToken + 1;
    const rootScope = b.newScope(undefined, span);
    let i = statement.firstToken;
    let kind: StatementKind = "other";
    let target: StatementSketch["target"];
    let insertColumns: StatementSketch["insertColumns"];
    let exec: StatementSketch["exec"];
    let useDatabase: string | undefined;
    let createdTable: StatementSketch["createdTable"];

    let leading = b.word(b.next(i, endExclusive));
    i = b.next(i, endExclusive);

    if (leading === "WITH") {
        b.clause("with", rootScope, b.tok(i)!.start, b.tok(i)!.end);
        const after = parseCtes(b, rootScope, i + 1, endExclusive);
        i = after;
        leading = b.word(b.next(i, endExclusive));
        i = b.next(i, endExclusive);
    }

    switch (leading) {
        case "SELECT":
            kind = "select";
            parseQueryExpression(b, rootScope, i, endExclusive, 0);
            break;
        case "INSERT": {
            kind = "insert";
            let j = b.next(i + 1, endExclusive);
            if (b.word(j) === "INTO") {
                j = b.next(j + 1, endExclusive);
            }
            const name = readNameParts(b, j, endExclusive);
            if (name !== undefined) {
                target = { parts: name.parts, span: name.span };
                j = name.next;
                if (b.punct(j) === "(") {
                    const close = b.skipBalanced(j, endExclusive);
                    insertColumns = {
                        names: readColumnNames(b, j, close),
                        span: {
                            start: b.tok(j)!.start,
                            end: b.tok(Math.max(j, close - 1))!.end,
                        },
                    };
                    b.clause(
                        "insertColumns",
                        rootScope,
                        insertColumns.span.start,
                        insertColumns.span.end,
                    );
                    j = b.next(close, endExclusive);
                }
            }
            const next = b.word(j);
            if (next === "VALUES") {
                const start = b.next(j + 1, endExclusive);
                const end = endExclusive;
                if (start < end && b.tok(start) !== undefined) {
                    b.clause("values", rootScope, b.tok(start)!.start, statement.end);
                    scanForSubqueries(b, rootScope, start, end, 0);
                } else {
                    const anchor = b.tok(j)!.end;
                    b.clause("values", rootScope, anchor, anchor + 1);
                }
            } else if (next === "SELECT" || next === "WITH") {
                parseQueryExpression(b, rootScope, j, endExclusive, 0);
            } else if (next === "EXEC" || next === "EXECUTE") {
                exec = parseExec(b, j + 1, endExclusive) ?? undefined;
            } else if (next === "OUTPUT" || next === "DEFAULT") {
                // INSERT ... OUTPUT / DEFAULT VALUES — opaque v1.
            }
            break;
        }
        case "UPDATE": {
            kind = "update";
            const name = readNameParts(b, i + 1, endExclusive);
            if (name !== undefined) {
                target = {
                    parts: name.parts,
                    span: name.span,
                    isAliasForm: name.parts.length === 1 || undefined,
                };
                // SET assignments until FROM/WHERE/OUTPUT.
                let j = name.next;
                if (b.word(j) === "SET") {
                    const start = b.next(j + 1, endExclusive);
                    let k = start;
                    while (k < endExclusive) {
                        if (b.punct(k) === "(") {
                            k = b.skipBalanced(k, endExclusive);
                            continue;
                        }
                        const w2 = b.word(k);
                        if (w2 === "FROM" || w2 === "WHERE" || w2 === "OUTPUT") {
                            break;
                        }
                        k++;
                    }
                    if (start < k && b.tok(start) !== undefined) {
                        b.clause(
                            "setAssignments",
                            rootScope,
                            b.tok(start)!.start,
                            b.tok(Math.max(start, k - 1))!.end,
                        );
                        scanForSubqueries(b, rootScope, start, k, 0);
                    } else {
                        const anchor = b.tok(j)!.end;
                        b.clause("setAssignments", rootScope, anchor, anchor + 1);
                    }
                    j = k;
                }
                parseQueryExpression(b, rootScope, j, endExclusive, 0);
            }
            break;
        }
        case "DELETE": {
            kind = "delete";
            let j = b.next(i + 1, endExclusive);
            if (b.word(j) === "TOP") {
                const open = b.next(j + 1, endExclusive);
                j =
                    b.punct(open) === "("
                        ? b.next(b.skipBalanced(open, endExclusive), endExclusive)
                        : open;
            }
            if (b.word(j) === "FROM") {
                j = b.next(j + 1, endExclusive);
            }
            const name = readNameParts(b, j, endExclusive);
            if (name !== undefined) {
                target = {
                    parts: name.parts,
                    span: name.span,
                    isAliasForm: name.parts.length === 1 || undefined,
                };
                parseQueryExpression(b, rootScope, name.next, endExclusive, 0);
            }
            break;
        }
        case "MERGE": {
            kind = "merge";
            let j = b.next(i + 1, endExclusive);
            if (b.word(j) === "INTO") {
                j = b.next(j + 1, endExclusive);
            }
            const name = readNameParts(b, j, endExclusive);
            if (name !== undefined) {
                target = { parts: name.parts, span: name.span };
                const aliasRead = readAlias(b, name.next, endExclusive);
                if (aliasRead.alias !== undefined) {
                    b.sources.push({
                        scopeId: rootScope,
                        parts: name.parts,
                        kind: "table",
                        alias: aliasRead.alias,
                        span: name.span,
                    });
                }
                j = aliasRead.next;
                if (b.word(j) === "USING") {
                    j = parseFromSources(
                        b,
                        rootScope,
                        b.next(j + 1, endExclusive),
                        endExclusive,
                        0,
                    );
                }
                parseQueryExpression(b, rootScope, j, endExclusive, 0);
            }
            break;
        }
        case "DECLARE":
            kind = "declare";
            parseDeclare(b, i + 1, endExclusive);
            if (b.tok(i) !== undefined) {
                b.clause("declareBody", rootScope, b.tok(i)!.end, statement.end);
            }
            break;
        case "SET":
            kind = "set";
            scanForSubqueries(b, rootScope, i + 1, endExclusive, 0);
            break;
        case "EXEC":
        case "EXECUTE": {
            kind = "exec";
            exec = parseExec(b, i + 1, endExclusive) ?? undefined;
            if (exec !== undefined && exec.procParts.length > 0 && b.tok(i) !== undefined) {
                b.clause("execArgs", rootScope, exec.procSpan.end, statement.end);
            }
            break;
        }
        case "USE": {
            kind = "use";
            const name = readNameParts(b, i + 1, endExclusive);
            useDatabase = name?.parts[0];
            const anchor = b.tok(i)!.end;
            b.clause(
                "useTarget",
                rootScope,
                anchor,
                statement.end > anchor ? statement.end : anchor + 1,
            );
            break;
        }
        case "CREATE":
        case "ALTER": {
            const kindWord = b.word(b.next(i + 1, endExclusive));
            if (kindWord === "TABLE") {
                kind = "createTable";
                const name = readNameParts(b, b.next(i + 1, endExclusive) + 1, endExclusive);
                if (name !== undefined) {
                    let cols: string[] = [];
                    const open = b.next(name.next, endExclusive);
                    let end = name.span.end;
                    if (b.punct(open) === "(") {
                        const close = b.skipBalanced(open, endExclusive);
                        cols = readColumnNames(b, open, close);
                        end = b.tok(Math.max(open, close - 1))!.end;
                    }
                    createdTable = {
                        parts: name.parts,
                        columns: cols,
                        span: { start: name.span.start, end },
                        isAlter: leading === "ALTER" || undefined,
                    };
                }
            } else if (
                kindWord !== undefined &&
                ["PROC", "PROCEDURE", "FUNCTION", "VIEW", "TRIGGER"].includes(kindWord)
            ) {
                kind = "moduleHeader";
                // Header params (@p type, ...) become batch-visible variables.
                parseDeclare(b, b.next(i + 1, endExclusive) + 1, endExclusive);
            } else {
                kind = "ddl";
            }
            break;
        }
        case "IF":
        case "WHILE":
        case "BEGIN":
        case "RETURN":
        case "PRINT":
        case "THROW":
            kind = "procedural";
            scanForSubqueries(b, rootScope, i, endExclusive, 0);
            // Embedded statements after IF/WHILE conditions are segmented as
            // their own statements by the segmenter when keyword-led.
            break;
        default:
            kind = "other";
            break;
    }

    const selectIntoParts = b.selectIntoParts;
    const selectIntoSpan = b.selectIntoSpan;

    return {
        kind,
        span,
        scopes: b.scopes,
        clauses: b.clauses,
        sources: b.sources,
        selectItems: b.selectItems,
        ctes: b.ctes,
        declares: b.declares,
        target,
        insertColumns,
        exec,
        useDatabase,
        createdTable,
        selectInto:
            selectIntoParts !== undefined && selectIntoSpan !== undefined
                ? { parts: selectIntoParts, span: selectIntoSpan }
                : undefined,
    };
}
