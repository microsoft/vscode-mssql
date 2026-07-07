/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Caret context classifier (design 05 §10.2): maps an offset in an analyzed
 * statement to a completion context. Tolerant: trailing mid-edit positions
 * ("SELECT * FROM ") classify by the nearest preceding clause.
 */

import { Token, TokenKind, isTrivia, tokenIndexAt } from "./lexer";
import { ClauseKind, StatementSketch } from "./sketch";

export type CompletionContext =
    | { readonly kind: "none"; readonly reason: "comment" | "string" | "sqlcmd" }
    | { readonly kind: "statementStart"; readonly prefix: string }
    | {
          readonly kind: "memberAccess";
          /** Qualifier chain before the final dot (e.g. ["o"] or ["Sales"]). */
          readonly parts: readonly string[];
          /** Typed word after the final dot, "" when the caret sits on the dot. */
          readonly prefix: string;
          readonly scopeId: number;
      }
    | { readonly kind: "tableSource"; readonly scopeId: number; readonly afterJoin: boolean }
    | { readonly kind: "joinPredicate"; readonly scopeId: number }
    | {
          readonly kind: "expression";
          readonly scopeId: number;
          readonly clause: ClauseKind;
          /** Word prefix at the caret ("" when none). */
          readonly prefix: string;
      }
    | { readonly kind: "insertColumnList" }
    | { readonly kind: "updateSetTarget" }
    | { readonly kind: "execProcedure"; readonly prefix: string }
    | { readonly kind: "execArgs" }
    | { readonly kind: "declareType"; readonly prefix: string }
    | { readonly kind: "useDatabase"; readonly prefix: string };

function isNameKind(kind: TokenKind): boolean {
    return (
        kind === TokenKind.Identifier ||
        kind === TokenKind.BracketedIdentifier ||
        kind === TokenKind.QuotedIdentifier ||
        kind === TokenKind.TempName ||
        kind === TokenKind.GlobalTempName
    );
}

function namePartText(text: string, t: Token): string {
    const raw = text.slice(t.start, t.end);
    switch (t.kind) {
        case TokenKind.BracketedIdentifier:
            return raw.slice(1, raw.endsWith("]") ? -1 : undefined).replace(/\]\]/g, "]");
        case TokenKind.QuotedIdentifier:
            return raw.slice(1, raw.endsWith('"') ? -1 : undefined).replace(/""/g, '"');
        default:
            return raw;
    }
}

/** Previous significant token index strictly before `index`, or -1. */
function prevSignificant(tokens: readonly Token[], index: number): number {
    for (let i = index - 1; i >= 0; i--) {
        if (!isTrivia(tokens[i].kind)) {
            return i;
        }
    }
    return -1;
}

export function classifyContext(
    text: string,
    tokens: readonly Token[],
    sketch: StatementSketch,
    offset: number,
): CompletionContext {
    // --- inside comments/strings/sqlcmd: no completions --------------------
    const atIndex = tokenIndexAt(tokens, Math.max(0, offset - 1));
    const at = tokens[atIndex];
    if (at !== undefined && offset > at.start && offset <= at.end) {
        if (at.kind === TokenKind.LineComment || at.kind === TokenKind.BlockComment) {
            return { kind: "none", reason: "comment" };
        }
        if (at.kind === TokenKind.StringLiteral) {
            // Caret after a CLOSED string's final quote is outside it.
            if (offset < at.end || at.unterminated === true) {
                return { kind: "none", reason: "string" };
            }
        }
        if (at.kind === TokenKind.SqlCmdDirective) {
            return { kind: "none", reason: "sqlcmd" };
        }
    }

    const scopeId = deepestScopeAt(sketch, offset);

    // --- member access: word-prefix directly after a dot -------------------
    let prefix = "";
    let anchorIndex = atIndex;
    if (at !== undefined && isNameKind(at.kind) && offset > at.start && offset <= at.end) {
        prefix = text.slice(at.start, offset).replace(/^\[|\]$/g, "");
        anchorIndex = atIndex;
        const before = prevSignificant(tokens, atIndex);
        if (before >= 0 && text.slice(tokens[before].start, tokens[before].end) === ".") {
            const parts = readChainBackward(text, tokens, before);
            if (parts.length > 0) {
                return { kind: "memberAccess", parts, prefix, scopeId };
            }
        }
    } else {
        const before =
            at !== undefined && offset <= at.start ? prevSignificant(tokens, atIndex) : atIndex;
        const anchor =
            before >= 0 && !isTrivia(tokens[before]?.kind ?? TokenKind.EndOfFile)
                ? before
                : prevSignificant(tokens, atIndex);
        anchorIndex = anchor;
        if (
            anchor >= 0 &&
            tokens[anchor] !== undefined &&
            text.slice(tokens[anchor].start, tokens[anchor].end) === "." &&
            offset >= tokens[anchor].end
        ) {
            const parts = readChainBackward(text, tokens, anchor);
            if (parts.length > 0) {
                return { kind: "memberAccess", parts, prefix: "", scopeId };
            }
        }
    }

    // `GO` on a batch-separator line gets its own token kind. While the
    // user is still typing that token, it must still act as the statement
    // prefix so the batch separator ranks ahead of GROUP/GOTO noise.
    if (
        at !== undefined &&
        at.kind === TokenKind.GoSeparator &&
        offset > at.start &&
        offset <= at.end
    ) {
        prefix = text.slice(at.start, offset);
        anchorIndex = atIndex;
    }

    // Variable prefix (@x…) classifies as expression; the engine offers vars.
    if (
        at !== undefined &&
        (at.kind === TokenKind.Variable || at.kind === TokenKind.SystemVariable) &&
        offset > at.start &&
        offset <= at.end
    ) {
        prefix = text.slice(at.start, offset);
    }

    // --- clause-based classification ----------------------------------------
    const clause = clauseAt(sketch, offset);
    if (clause !== undefined) {
        switch (clause) {
            case "from": {
                const afterJoin = isAfterJoinWord(text, tokens, anchorIndex);
                return { kind: "tableSource", scopeId, afterJoin };
            }
            case "on":
                return { kind: "joinPredicate", scopeId };
            case "insertColumns":
                return { kind: "insertColumnList" };
            case "setAssignments": {
                // LHS positions (start of clause or right after a comma).
                const prev = prevSignificantWordOrPunct(text, tokens, offset);
                if (prev === undefined || prev === "," || prev === "SET") {
                    return { kind: "updateSetTarget" };
                }
                return { kind: "expression", scopeId, clause, prefix };
            }
            case "execArgs":
                return { kind: "execArgs" };
            case "useTarget":
                return { kind: "useDatabase", prefix };
            case "declareBody": {
                const prev = prevSignificantTokenBefore(tokens, offset);
                if (prev !== undefined) {
                    if (prev.kind === TokenKind.Variable) {
                        return { kind: "declareType", prefix: "" };
                    }
                    const w = text.slice(prev.start, prev.end).toUpperCase();
                    if (w === "AS") {
                        return { kind: "declareType", prefix };
                    }
                    if (isNameKind(prev.kind) && prefix.length > 0) {
                        return { kind: "declareType", prefix };
                    }
                }
                return { kind: "expression", scopeId, clause, prefix };
            }
            case "selectList":
            case "where":
            case "having":
            case "groupBy":
            case "orderBy":
            case "values":
            case "output":
            case "with":
            case "top":
            case "option":
            case "into":
            case "body":
                return { kind: "expression", scopeId, clause, prefix };
        }
    }

    // --- statement-level fallbacks ------------------------------------------
    if (sketch.kind === "exec") {
        const procEnd = sketch.exec?.procSpan.end ?? sketch.span.start;
        if (
            sketch.exec === undefined ||
            sketch.exec.procParts.length === 0 ||
            offset <= procEnd + 1
        ) {
            return { kind: "execProcedure", prefix };
        }
        return { kind: "execArgs" };
    }
    if (sketch.kind === "use") {
        return { kind: "useDatabase", prefix };
    }

    // At/before the first word of the statement → statement start.
    const firstWordEnd = firstSignificantEnd(tokens, sketch, offset);
    if (firstWordEnd === undefined || offset <= firstWordEnd) {
        return { kind: "statementStart", prefix };
    }

    return { kind: "expression", scopeId, clause: "body", prefix };
}

function deepestScopeAt(sketch: StatementSketch, offset: number): number {
    let best = 0;
    let bestSize = Number.MAX_SAFE_INTEGER;
    for (const scope of sketch.scopes) {
        if (offset >= scope.span.start && offset <= scope.span.end) {
            const size = scope.span.end - scope.span.start;
            if (size < bestSize) {
                best = scope.id;
                bestSize = size;
            }
        }
    }
    return best;
}

/** Innermost clause containing offset; trailing positions use the nearest preceding clause. */
function clauseAt(sketch: StatementSketch, offset: number): ClauseKind | undefined {
    let best: { kind: ClauseKind; size: number } | undefined;
    for (const clause of sketch.clauses) {
        if (offset >= clause.span.start && offset <= clause.span.end) {
            const size = clause.span.end - clause.span.start;
            if (best === undefined || size < best.size) {
                best = { kind: clause.kind, size };
            }
        }
    }
    if (best !== undefined) {
        return best.kind;
    }
    // Trailing edit: nearest clause that starts before the caret.
    let nearest: { kind: ClauseKind; start: number } | undefined;
    for (const clause of sketch.clauses) {
        if (
            clause.span.start <= offset &&
            (nearest === undefined || clause.span.start > nearest.start)
        ) {
            nearest = { kind: clause.kind, start: clause.span.start };
        }
    }
    return nearest?.kind;
}

function readChainBackward(text: string, tokens: readonly Token[], dotIndex: number): string[] {
    const parts: string[] = [];
    let i = dotIndex;
    for (;;) {
        const nameIdx = prevSignificant(tokens, i);
        if (nameIdx < 0 || !isNameKind(tokens[nameIdx].kind)) {
            break;
        }
        parts.unshift(namePartText(text, tokens[nameIdx]));
        const maybeDot = prevSignificant(tokens, nameIdx);
        if (maybeDot < 0 || text.slice(tokens[maybeDot].start, tokens[maybeDot].end) !== ".") {
            break;
        }
        i = maybeDot;
    }
    return parts;
}

function isAfterJoinWord(text: string, tokens: readonly Token[], anchorIndex: number): boolean {
    const JOIN_FAMILY = new Set(["JOIN", "APPLY"]);
    const wordOf = (i: number): string => text.slice(tokens[i].start, tokens[i].end).toUpperCase();
    let i = anchorIndex;
    while (i >= 0 && isTrivia(tokens[i].kind)) {
        i--;
    }
    if (i < 0) {
        return false;
    }
    if (JOIN_FAMILY.has(wordOf(i))) {
        return true;
    }
    // One partial name being typed after JOIN: skip exactly that token.
    if (isNameKind(tokens[i].kind)) {
        i--;
        while (i >= 0 && isTrivia(tokens[i].kind)) {
            i--;
        }
        if (i >= 0 && JOIN_FAMILY.has(wordOf(i))) {
            return true;
        }
    }
    return false;
}

function prevSignificantWordOrPunct(
    text: string,
    tokens: readonly Token[],
    offset: number,
): string | undefined {
    const idx = tokenIndexAt(tokens, Math.max(0, offset - 1));
    // If the caret is inside a word being typed, look before it.
    let i = idx;
    const t = tokens[idx];
    if (t !== undefined && isNameKind(t.kind) && offset > t.start) {
        i = idx - 1;
    } else if (t !== undefined && offset <= t.start) {
        i = idx - 1;
    }
    while (i >= 0 && isTrivia(tokens[i].kind)) {
        i--;
    }
    if (i < 0) {
        return undefined;
    }
    const raw = text.slice(tokens[i].start, tokens[i].end);
    return tokens[i].kind === TokenKind.Identifier ? raw.toUpperCase() : raw;
}

function prevSignificantTokenBefore(tokens: readonly Token[], offset: number): Token | undefined {
    const idx = tokenIndexAt(tokens, Math.max(0, offset - 1));
    let i = idx;
    const t = tokens[idx];
    if (t !== undefined && offset <= t.start) {
        i = idx - 1;
    } else if (t !== undefined && isNameKind(t.kind) && offset > t.start && offset <= t.end) {
        i = idx - 1;
    }
    while (i >= 0 && isTrivia(tokens[i].kind)) {
        i--;
    }
    return i >= 0 ? tokens[i] : undefined;
}

function firstSignificantEnd(
    tokens: readonly Token[],
    sketch: StatementSketch,
    offset: number,
): number | undefined {
    void offset;
    for (const t of tokens) {
        if (t.start >= sketch.span.start && !isTrivia(t.kind) && t.kind !== TokenKind.EndOfFile) {
            return t.end;
        }
        if (t.start > sketch.span.end) {
            break;
        }
    }
    return undefined;
}
