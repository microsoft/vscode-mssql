/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared position→symbol token resolvers (B12 hoist of the B11 finding:
 * hover and signature help each grew a copy of the dotted-chain reader and
 * the enclosing-call scanner; definition would have been the third). One
 * home for: name-token classification, identifier unquoting, dotted-chain
 * reading around a caret token, callee-chain reading, and the innermost
 * enclosing call-expression scan.
 *
 * The callee classifier WHITELISTS reserved-word builtins (LEFT, RIGHT,
 * COALESCE, CONVERT, …) — they are reserved keywords AND callable functions,
 * so reserved-ness alone must never disqualify a callee (B11 fix).
 * Pure: no vscode, no node builtins, no I/O (lint-enforced).
 */

import { TSQL_BUILTIN_FUNCTIONS } from "../data/builtinFunctions.generated";
import { SketchSpan } from "./sketch";
import { Token, TokenKind, isTrivia, nextSignificant, tokenIndexAt } from "./lexer";

const BUILTIN_NAMES: ReadonlySet<string> = new Set(TSQL_BUILTIN_FUNCTIONS.map((fn) => fn.name));

/** True when the (uppercased) word is a curated builtin function name. */
export function isBuiltinFunctionName(word: string): boolean {
    return BUILTIN_NAMES.has(word.toUpperCase());
}

/** Token kinds that can be a dotted-name part. */
export function isNameKind(kind: TokenKind): boolean {
    return (
        kind === TokenKind.Identifier ||
        kind === TokenKind.BracketedIdentifier ||
        kind === TokenKind.QuotedIdentifier ||
        kind === TokenKind.TempName ||
        kind === TokenKind.GlobalTempName
    );
}

/** Unquoted text of a name token ([x] / "x" unwrapped, escapes folded). */
export function namePartText(text: string, t: Token): string {
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

/** Index of the nearest significant token before `index` (-1 when none). */
export function prevSignificant(tokens: readonly Token[], index: number): number {
    for (let i = index - 1; i >= 0; i--) {
        if (!isTrivia(tokens[i].kind)) {
            return i;
        }
    }
    return -1;
}

export interface NameChain {
    readonly parts: readonly string[];
    readonly spans: readonly SketchSpan[];
    /** Which part the caret token is. */
    readonly partIndex: number;
}

/** Read the full dotted chain around the token at `index` (both directions). */
export function readChainAround(text: string, tokens: readonly Token[], index: number): NameChain {
    const parts: string[] = [namePartText(text, tokens[index])];
    const spans: SketchSpan[] = [{ start: tokens[index].start, end: tokens[index].end }];
    // Backward: name . name . <caret>
    let i = index;
    for (;;) {
        const dot = prevSignificant(tokens, i);
        if (dot < 0 || text.slice(tokens[dot].start, tokens[dot].end) !== ".") {
            break;
        }
        const name = prevSignificant(tokens, dot);
        if (name < 0 || !isNameKind(tokens[name].kind)) {
            break;
        }
        parts.unshift(namePartText(text, tokens[name]));
        spans.unshift({ start: tokens[name].start, end: tokens[name].end });
        i = name;
    }
    const partIndex = parts.length - 1;
    // Forward: <caret> . name . name
    let j = index;
    for (;;) {
        const dot = nextSignificant(tokens, j + 1);
        if (dot >= tokens.length || text.slice(tokens[dot].start, tokens[dot].end) !== ".") {
            break;
        }
        const name = nextSignificant(tokens, dot + 1);
        if (name >= tokens.length || !isNameKind(tokens[name].kind)) {
            break;
        }
        parts.push(namePartText(text, tokens[name]));
        spans.push({ start: tokens[name].start, end: tokens[name].end });
        j = name;
    }
    return { parts, spans, partIndex };
}

/** Dotted callee chain ending AT `nameIndex` (reads backward across dots). */
export function readCalleeChain(
    text: string,
    tokens: readonly Token[],
    nameIndex: number,
): string[] {
    const parts = [namePartText(text, tokens[nameIndex])];
    let i = nameIndex;
    for (;;) {
        const dot = prevSignificant(tokens, i);
        if (dot < 0 || text.slice(tokens[dot].start, tokens[dot].end) !== ".") {
            break;
        }
        const name = prevSignificant(tokens, dot);
        if (name < 0 || !isNameKind(tokens[name].kind)) {
            break;
        }
        parts.unshift(namePartText(text, tokens[name]));
        i = name;
    }
    return parts;
}

export interface EnclosingCall {
    readonly parts: readonly string[];
    /** Top-level comma count between the open paren and the caret. */
    readonly commas: number;
    /** Token index of the callee's last name part. */
    readonly calleeTokenIndex: number;
}

export interface EnclosingCallScan {
    readonly text: string;
    readonly tokens: readonly Token[];
    readonly offset: number;
    /** Scan floor: tokens ending at or before this offset are out of scope. */
    readonly statementStart: number;
}

/**
 * Scan backward from the caret for the innermost unclosed `(` with a
 * name-chain callee. Grouping parens (no callee) are stepped over; commas
 * counted inside them are discarded because everything at the caret's depth
 * before a grouping `(` lies within that group. Reserved words are not
 * callees UNLESS they are curated builtins (the B11 whitelist).
 */
export function findEnclosingCall(scan: EnclosingCallScan): EnclosingCall | undefined {
    const { text, tokens, offset, statementStart } = scan;
    let i = tokenIndexAt(tokens, Math.max(0, offset - 1));
    if (tokens[i] !== undefined && tokens[i].start >= offset) {
        i--;
    }
    let depth = 0;
    let commas = 0;
    while (i >= 0) {
        const t = tokens[i];
        if (t === undefined || t.end <= statementStart) {
            break;
        }
        if (isTrivia(t.kind)) {
            i--;
            continue;
        }
        const raw = text.slice(t.start, t.end);
        if (t.kind === TokenKind.Punctuation || t.kind === TokenKind.Operator) {
            if (raw === ")") {
                depth++;
            } else if (raw === "(") {
                if (depth > 0) {
                    depth--;
                } else {
                    const nameIndex = prevSignificant(tokens, i);
                    if (nameIndex >= 0 && isNameKind(tokens[nameIndex].kind)) {
                        const callee = tokens[nameIndex];
                        const word = namePartText(text, callee).toUpperCase();
                        if (callee.keyword?.reserved !== true || isBuiltinFunctionName(word)) {
                            return {
                                parts: readCalleeChain(text, tokens, nameIndex),
                                commas,
                                calleeTokenIndex: nameIndex,
                            };
                        }
                    }
                    // Grouping paren: continue outward; all commas seen so
                    // far were inside this group.
                    commas = 0;
                }
            } else if (raw === "," && depth === 0) {
                commas++;
            } else if (raw === ";") {
                break;
            }
        }
        i--;
    }
    return undefined;
}
