/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Full-fidelity T-SQL lexer (language-service design 05 §7.1). Every character
 * of the input is covered by exactly one token (trivia included), spans are
 * exact for replacement edits and anchors, and keyword-looking identifiers are
 * lexed as identifiers WITH keyword metadata — T-SQL permits many
 * keyword-looking identifiers, so keyword-ness is a parser/context decision.
 *
 * Line-start states are tracked so incremental re-lexing can resume at any
 * line whose entry state is unchanged (design §7.1 "track line-start states").
 *
 * Purity: no vscode, no node APIs, no imports outside src/sqlLanguage
 * (lint-enforced). GO recognition follows the execution splitter's rules
 * (line-level, optional count, comments allowed around it) — parity is
 * asserted by tests against src/sql/batchSplitter.ts.
 */

import { TSQL_KEYWORD_MAP, KeywordInfo } from "../data/keywords.generated";

export const enum TokenKind {
    Whitespace = 0,
    NewLine = 1,
    LineComment = 2,
    BlockComment = 3,
    Identifier = 4,
    BracketedIdentifier = 5,
    QuotedIdentifier = 6, // "..." — identifier under QUOTED_IDENTIFIER ON (the default)
    StringLiteral = 7, // '...' and N'...'
    NumberLiteral = 8, // int, decimal, float/scientific, money-ish, 0x binary
    Variable = 9, // @name
    SystemVariable = 10, // @@name
    TempName = 11, // #name
    GlobalTempName = 12, // ##name
    Operator = 13,
    Punctuation = 14, // ( ) , ; .
    GoSeparator = 15, // the GO word on a batch-separator line
    SqlCmdDirective = 16, // :directive line (opaque, design §7.1)
    Unknown = 17,
    EndOfFile = 18,
}

export interface Token {
    readonly kind: TokenKind;
    /** Inclusive start offset. */
    readonly start: number;
    /** Exclusive end offset. */
    readonly end: number;
    /**
     * Uppercase keyword id when an Identifier is keyword-capable
     * (design §7.1: metadata, not a hard keyword token).
     */
    readonly keyword?: KeywordInfo;
    /** True when a string/comment/bracket token is unterminated at EOF. */
    readonly unterminated?: boolean;
}

/** Lexical mode a line can START in (multi-line constructs). */
export const enum LineStartMode {
    Code = 0,
    BlockComment = 1,
    String = 2,
    BracketedIdentifier = 3,
    QuotedIdentifier = 4,
}

export interface LineStartState {
    readonly mode: LineStartMode;
    /** Nesting depth when mode === BlockComment (T-SQL block comments nest). */
    readonly blockDepth: number;
}

export interface LexResult {
    readonly tokens: readonly Token[];
    /** Entry state per line; lineStates.length === lineCount. */
    readonly lineStates: readonly LineStartState[];
}

const CODE_STATE: LineStartState = { mode: LineStartMode.Code, blockDepth: 0 };

function isIdentStart(ch: number): boolean {
    return (
        (ch >= 65 && ch <= 90) || // A-Z
        (ch >= 97 && ch <= 122) || // a-z
        ch === 95 || // _
        ch > 127 // unicode identifiers — tolerant superset
    );
}

function isIdentPart(ch: number): boolean {
    return isIdentStart(ch) || (ch >= 48 && ch <= 57) || ch === 36; // digits, $
}

function isDigit(ch: number): boolean {
    return ch >= 48 && ch <= 57;
}

/**
 * Lex the full document. Deterministic, total: concatenated token spans cover
 * [0, text.length) exactly, ending with a zero-width EndOfFile token.
 */
export function lex(text: string): LexResult {
    const tokens: Token[] = [];
    const lineStates: LineStartState[] = [CODE_STATE];
    const length = text.length;
    let pos = 0;
    // Carried multi-line construct state.
    let mode: LineStartMode = LineStartMode.Code;
    let blockDepth = 0;
    // Token accumulation for a construct that spans lines: we emit ONE token
    // per construct (not per line), so remember where it began.
    let constructStart = -1;
    let atLineStart = true;

    const pushLineState = (): void => {
        lineStates.push(
            mode === LineStartMode.Code ? CODE_STATE : { mode, blockDepth: blockDepth },
        );
    };

    const newLine = (start: number): void => {
        // Consume \r\n | \n | \r as one NewLine token (only in Code mode —
        // inside multi-line constructs the terminator is part of the construct).
        let end = start;
        if (text.charCodeAt(end) === 13) {
            end++;
            if (end < length && text.charCodeAt(end) === 10) {
                end++;
            }
        } else {
            end++;
        }
        tokens.push({ kind: TokenKind.NewLine, start, end });
        pos = end;
        pushLineState();
        atLineStart = true;
    };

    while (pos < length) {
        const ch = text.charCodeAt(pos);

        // ---- resume / continue multi-line constructs -------------------------------
        if (mode === LineStartMode.BlockComment) {
            const start = constructStart >= 0 ? constructStart : pos;
            constructStart = -1;
            let i = pos;
            while (i < length && blockDepth > 0) {
                const c = text.charCodeAt(i);
                if (c === 47 /* / */ && text.charCodeAt(i + 1) === 42 /* * */) {
                    blockDepth++;
                    i += 2;
                } else if (c === 42 && text.charCodeAt(i + 1) === 47) {
                    blockDepth--;
                    i += 2;
                } else {
                    if (c === 10 || c === 13) {
                        if (c === 13 && text.charCodeAt(i + 1) === 10) {
                            i++;
                        }
                        i++;
                        // Line boundary inside the comment: record entry state
                        // for the next line, keep accumulating the construct.
                        pushLineState();
                        continue;
                    }
                    i++;
                }
            }
            if (blockDepth > 0) {
                tokens.push({
                    kind: TokenKind.BlockComment,
                    start,
                    end: length,
                    unterminated: true,
                });
                pos = length;
                break;
            }
            mode = LineStartMode.Code;
            tokens.push({ kind: TokenKind.BlockComment, start, end: i });
            pos = i;
            atLineStart = false;
            continue;
        }
        if (
            mode === LineStartMode.String ||
            mode === LineStartMode.BracketedIdentifier ||
            mode === LineStartMode.QuotedIdentifier
        ) {
            const start = constructStart >= 0 ? constructStart : pos;
            constructStart = -1;
            const closeCh =
                mode === LineStartMode.String
                    ? 39
                    : mode === LineStartMode.QuotedIdentifier
                      ? 34
                      : 93;
            const kind =
                mode === LineStartMode.String
                    ? TokenKind.StringLiteral
                    : mode === LineStartMode.QuotedIdentifier
                      ? TokenKind.QuotedIdentifier
                      : TokenKind.BracketedIdentifier;
            let i = pos;
            let closed = false;
            while (i < length) {
                const c = text.charCodeAt(i);
                if (c === closeCh) {
                    if (text.charCodeAt(i + 1) === closeCh) {
                        i += 2; // escaped '' / ]] / ""
                        continue;
                    }
                    i++;
                    closed = true;
                    break;
                }
                if (c === 10 || c === 13) {
                    if (c === 13 && text.charCodeAt(i + 1) === 10) {
                        i++;
                    }
                    i++;
                    pushLineState();
                    continue;
                }
                i++;
            }
            if (!closed) {
                tokens.push({ kind, start, end: length, unterminated: true });
                pos = length;
                break;
            }
            mode = LineStartMode.Code;
            tokens.push({ kind, start, end: i });
            pos = i;
            atLineStart = false;
            continue;
        }

        // ---- code mode --------------------------------------------------------------
        if (ch === 10 || ch === 13) {
            newLine(pos);
            continue;
        }

        // Whitespace run (no terminators).
        if (ch === 32 || ch === 9 || ch === 11 || ch === 12) {
            let i = pos + 1;
            while (i < length) {
                const c = text.charCodeAt(i);
                if (c === 32 || c === 9 || c === 11 || c === 12) {
                    i++;
                } else {
                    break;
                }
            }
            tokens.push({ kind: TokenKind.Whitespace, start: pos, end: i });
            pos = i;
            continue;
        }

        // SQLCMD directive: a line whose first non-whitespace char is ':' is
        // opaque tooling input (design §7.1). Only when at line start context.
        if (ch === 58 /* : */ && atLineStartIgnoringWs(tokens, atLineStart)) {
            let i = pos + 1;
            while (i < length && text.charCodeAt(i) !== 10 && text.charCodeAt(i) !== 13) {
                i++;
            }
            tokens.push({ kind: TokenKind.SqlCmdDirective, start: pos, end: i });
            pos = i;
            atLineStart = false;
            continue;
        }

        // Comments.
        if (ch === 45 /* - */ && text.charCodeAt(pos + 1) === 45) {
            let i = pos + 2;
            while (i < length && text.charCodeAt(i) !== 10 && text.charCodeAt(i) !== 13) {
                i++;
            }
            tokens.push({ kind: TokenKind.LineComment, start: pos, end: i });
            pos = i;
            atLineStart = false;
            continue;
        }
        if (ch === 47 /* / */ && text.charCodeAt(pos + 1) === 42) {
            mode = LineStartMode.BlockComment;
            blockDepth = 1;
            constructStart = pos;
            pos += 2;
            continue;
        }

        // Strings: '...' and N'...'.
        if (ch === 39 /* ' */) {
            mode = LineStartMode.String;
            constructStart = pos;
            pos += 1;
            continue;
        }
        if ((ch === 78 || ch === 110) /* N|n */ && text.charCodeAt(pos + 1) === 39) {
            mode = LineStartMode.String;
            constructStart = pos;
            pos += 2;
            continue;
        }

        // Bracketed / quoted identifiers.
        if (ch === 91 /* [ */) {
            mode = LineStartMode.BracketedIdentifier;
            constructStart = pos;
            pos += 1;
            continue;
        }
        if (ch === 34 /* " */) {
            mode = LineStartMode.QuotedIdentifier;
            constructStart = pos;
            pos += 1;
            continue;
        }

        // Variables and temp names.
        if (ch === 64 /* @ */) {
            const system = text.charCodeAt(pos + 1) === 64;
            let i = pos + (system ? 2 : 1);
            while (i < length && isIdentPart(text.charCodeAt(i))) {
                i++;
            }
            tokens.push({
                kind: system ? TokenKind.SystemVariable : TokenKind.Variable,
                start: pos,
                end: i,
            });
            pos = i;
            atLineStart = false;
            continue;
        }
        if (ch === 35 /* # */) {
            const global = text.charCodeAt(pos + 1) === 35;
            let i = pos + (global ? 2 : 1);
            while (i < length && isIdentPart(text.charCodeAt(i))) {
                i++;
            }
            tokens.push({
                kind: global ? TokenKind.GlobalTempName : TokenKind.TempName,
                start: pos,
                end: i,
            });
            pos = i;
            atLineStart = false;
            continue;
        }

        // Numbers: 0x..., int/decimal/scientific, leading-dot decimals (.5).
        if (isDigit(ch) || (ch === 46 /* . */ && isDigit(text.charCodeAt(pos + 1)))) {
            let i = pos;
            if (
                ch === 48 &&
                (text.charCodeAt(pos + 1) === 120 || text.charCodeAt(pos + 1) === 88)
            ) {
                i += 2;
                while (i < length && isHexDigit(text.charCodeAt(i))) {
                    i++;
                }
            } else {
                while (i < length && isDigit(text.charCodeAt(i))) {
                    i++;
                }
                if (text.charCodeAt(i) === 46) {
                    i++;
                    while (i < length && isDigit(text.charCodeAt(i))) {
                        i++;
                    }
                }
                const e = text.charCodeAt(i);
                if (e === 101 || e === 69) {
                    const sign = text.charCodeAt(i + 1);
                    const first = sign === 43 || sign === 45 ? i + 2 : i + 1;
                    if (isDigit(text.charCodeAt(first))) {
                        i = first;
                        while (i < length && isDigit(text.charCodeAt(i))) {
                            i++;
                        }
                    }
                }
            }
            tokens.push({ kind: TokenKind.NumberLiteral, start: pos, end: i });
            pos = i;
            atLineStart = false;
            continue;
        }

        // Identifiers (keyword-capable).
        if (isIdentStart(ch)) {
            let i = pos + 1;
            while (i < length && isIdentPart(text.charCodeAt(i))) {
                i++;
            }
            const raw = text.slice(pos, i);
            const upper = raw.toUpperCase();
            // GO batch separator — EXACT execution-splitter parity
            // (src/sql/batchSplitter.ts GO_LINE = /^\s*GO(?:\s+(\d+))?\s*(?:--.*)?$/i):
            // whitespace-only prefix on the line, and the remainder must be an
            // optional count plus an optional line comment. "GO abc" is NOT a
            // separator (it ships to the server as content).
            if (
                upper === "GO" &&
                precededByLineWhitespaceOnly(tokens) &&
                goLineRemainderValid(text, i)
            ) {
                tokens.push({ kind: TokenKind.GoSeparator, start: pos, end: i });
                pos = i;
                atLineStart = false;
                continue;
            }
            const keyword = TSQL_KEYWORD_MAP.get(upper);
            tokens.push(
                keyword
                    ? { kind: TokenKind.Identifier, start: pos, end: i, keyword }
                    : { kind: TokenKind.Identifier, start: pos, end: i },
            );
            pos = i;
            atLineStart = false;
            continue;
        }

        // Operators / punctuation.
        const op = matchOperator(text, pos);
        if (op > 0) {
            const kind =
                ch === 40 || ch === 41 || ch === 44 || ch === 59 || ch === 46
                    ? TokenKind.Punctuation
                    : TokenKind.Operator;
            tokens.push({ kind, start: pos, end: pos + op });
            pos += op;
            atLineStart = false;
            continue;
        }

        tokens.push({ kind: TokenKind.Unknown, start: pos, end: pos + 1 });
        pos += 1;
        atLineStart = false;
    }

    tokens.push({ kind: TokenKind.EndOfFile, start: length, end: length });
    return { tokens, lineStates };
}

function isHexDigit(ch: number): boolean {
    return isDigit(ch) || (ch >= 97 && ch <= 102) || (ch >= 65 && ch <= 70);
}

/** True if ONLY whitespace precedes on the current line (splitter's ^\s* rule). */
function precededByLineWhitespaceOnly(tokens: readonly Token[]): boolean {
    for (let i = tokens.length - 1; i >= 0; i--) {
        const t = tokens[i];
        if (t.kind === TokenKind.NewLine) {
            return true;
        }
        if (t.kind === TokenKind.Whitespace) {
            continue;
        }
        return false;
    }
    return true;
}

const GO_REMAINDER = /^(?:\s+(\d+))?\s*(?:--.*)?$/;

/** The rest of the GO line must be an optional count + optional -- comment. */
function goLineRemainderValid(text: string, afterGo: number): boolean {
    let lineEnd = afterGo;
    while (lineEnd < text.length) {
        const c = text.charCodeAt(lineEnd);
        if (c === 10 || c === 13) {
            break;
        }
        lineEnd++;
    }
    return GO_REMAINDER.test(text.slice(afterGo, lineEnd));
}

function atLineStartIgnoringWs(tokens: readonly Token[], atLineStart: boolean): boolean {
    if (atLineStart) {
        return true;
    }
    for (let i = tokens.length - 1; i >= 0; i--) {
        const t = tokens[i];
        if (t.kind === TokenKind.NewLine) {
            return true;
        }
        if (t.kind === TokenKind.Whitespace) {
            continue;
        }
        return false;
    }
    return true;
}

/** Longest-match operator/punctuation length at pos (0 = none). */
function matchOperator(text: string, pos: number): number {
    const a = text.charCodeAt(pos);
    const b = text.charCodeAt(pos + 1);
    // Two-char operators.
    if (
        (a === 60 && (b === 61 || b === 62)) || // <= <>
        (a === 62 && b === 61) || // >=
        (a === 33 && (b === 61 || b === 60 || b === 62)) || // != !< !>
        (a === 58 && b === 58) || // ::
        ((a === 43 ||
            a === 45 ||
            a === 42 ||
            a === 47 ||
            a === 37 ||
            a === 38 ||
            a === 124 ||
            a === 94) &&
            b === 61) // += -= *= /= %= &= |= ^=
    ) {
        return 2;
    }
    switch (a) {
        case 40: // (
        case 41: // )
        case 44: // ,
        case 59: // ;
        case 46: // .
        case 43: // +
        case 45: // -
        case 42: // *
        case 47: // /
        case 37: // %
        case 38: // &
        case 124: // |
        case 94: // ^
        case 61: // =
        case 60: // <
        case 62: // >
        case 126: // ~
        case 33: // !
            return 1;
        default:
            return 0;
    }
}

/**
 * Token stream helpers for feature code: significant-token navigation that
 * skips trivia (whitespace, newlines, comments).
 */
export function isTrivia(kind: TokenKind): boolean {
    return (
        kind === TokenKind.Whitespace ||
        kind === TokenKind.NewLine ||
        kind === TokenKind.LineComment ||
        kind === TokenKind.BlockComment
    );
}

export function nextSignificant(tokens: readonly Token[], from: number): number {
    let i = from;
    while (i < tokens.length && isTrivia(tokens[i].kind)) {
        i++;
    }
    return i;
}

/** Index of the token containing offset (EndOfFile token for offset >= length). */
export function tokenIndexAt(tokens: readonly Token[], offset: number): number {
    let low = 0;
    let high = tokens.length - 1;
    while (low < high) {
        const mid = (low + high) >> 1;
        const t = tokens[mid];
        if (t.end <= offset) {
            low = mid + 1;
        } else if (t.start > offset) {
            high = mid - 1;
        } else {
            return mid;
        }
    }
    return Math.min(Math.max(low, 0), tokens.length - 1);
}
