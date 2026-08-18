/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TextRange } from "../text/index.js";
import type { SqlCmdDirectiveKind } from "./contracts.js";

/**
 * One argument as written, before variable substitution.
 *
 * Substitution is deferred because a value depends on every `:setvar` that precedes the line, and
 * scanning is deliberately line-local so an edit rescans only from the line it touched.
 */
export interface ScannedArgument {
    readonly text: string;
    readonly range: TextRange;
    readonly quoted: boolean;
    readonly secret: boolean;
}

export interface ScannedDirective {
    readonly kind: SqlCmdDirectiveKind;
    readonly keyword: string;
    readonly keywordRange: TextRange;
    readonly range: TextRange;
    readonly rawArguments: readonly ScannedArgument[];
    readonly batchCount?: number;
    /** Set when the line is a recognizable directive written incorrectly. */
    readonly malformed?: {
        readonly code: string;
        readonly message: string;
        readonly range: TextRange;
    };
}

/** A `$(name)` occurrence, or a `$(` that never completed one. */
export interface ScannedVariableReference {
    readonly name: string;
    readonly range: TextRange;
}

export interface ScannedLine {
    /** The line's first character, excluding nothing. */
    readonly start: number;
    /** The line's end, excluding its line break. */
    readonly end: number;
    /** The next line's start, so a projection can copy the break exactly as written. */
    readonly next: number;
    readonly directive?: ScannedDirective;
    readonly references: readonly ScannedVariableReference[];
}

/**
 * Directive spellings SQLCMD accepts.
 *
 * `on error` is two words, so the table is keyed by the first word and the multi-word forms are
 * completed by the scanner. Everything here is recognized only as the first non-blank text on a
 * line, which is what makes a `:` inside SQL harmless.
 */
const directiveKinds: ReadonlyMap<string, SqlCmdDirectiveKind> = new Map([
    ["setvar", "setvar"],
    ["r", "include"],
    ["connect", "connect"],
    ["on", "onError"],
    ["out", "out"],
    ["error", "error"],
    ["list", "list"],
    ["listvar", "listVar"],
    ["reset", "reset"],
    ["quit", "quit"],
    ["exit", "exit"],
    ["ed", "editor"],
    ["help", "help"],
    ["serverlist", "serverList"],
    ["perftrace", "perfTrace"],
    ["xml", "xmlMode"],
]);

/** Every directive name a host may complete, in the spelling SQLCMD documents them with. */
export const sqlCmdDirectiveNames: readonly string[] = Object.freeze([
    ":connect",
    ":ed",
    ":error",
    ":exit",
    ":help",
    ":list",
    ":listvar",
    ":on error",
    ":out",
    ":perftrace",
    ":quit",
    ":r",
    ":reset",
    ":serverlist",
    ":setvar",
    ":xml",
]);

/** Switches whose value is a credential. Their text never leaves the source document. */
const secretSwitches = new Set(["-p", "/p"]);

/**
 * Scans one document into lines, directives, and variable references.
 *
 * Scanning is purely lexical and line-local. It resolves nothing: a `:r` reference and a `$(name)`
 * are recorded exactly as written so the fold that follows can substitute values in order.
 */
export function scanSqlCmdLines(text: string): readonly ScannedLine[] {
    const lines: ScannedLine[] = [];
    let index = 0;
    while (index <= text.length) {
        const breakIndex = findLineBreak(text, index);
        const end = breakIndex.end;
        const next = breakIndex.next;
        const line: ScannedLine = {
            start: index,
            end,
            next,
            ...directiveOf(text, index, end),
            references: scanVariableReferences(text, index, end),
        };
        lines.push(line);
        if (next === index) break;
        index = next;
        if (index > text.length) break;
    }
    return lines;
}

function findLineBreak(text: string, start: number): { end: number; next: number } {
    for (let index = start; index < text.length; index++) {
        const code = text.charCodeAt(index);
        if (code === 10) return { end: index, next: index + 1 };
        if (code === 13) {
            return text.charCodeAt(index + 1) === 10
                ? { end: index, next: index + 2 }
                : { end: index, next: index + 1 };
        }
    }
    return { end: text.length, next: text.length + 1 };
}

function directiveOf(
    text: string,
    start: number,
    end: number,
): { readonly directive?: ScannedDirective } {
    let cursor = skipSpaces(text, start, end);
    if (cursor >= end) return {};
    // `!!` runs a shell command. It is recognized so it can be reported and excluded from the
    // projection; this package has no way to execute one and never acquires one.
    if (text.charCodeAt(cursor) === 33 && text.charCodeAt(cursor + 1) === 33) {
        return {
            directive: {
                kind: "shell",
                keyword: "!!",
                keywordRange: { start: cursor, end: cursor + 2 },
                range: { start, end },
                rawArguments: [
                    {
                        text: text.slice(cursor + 2, end).trim(),
                        range: { start: cursor + 2, end },
                        quoted: false,
                        secret: false,
                    },
                ],
            },
        };
    }
    if (text.charCodeAt(cursor) === 58) return colonDirective(text, start, end, cursor);
    return goDirective(text, start, end, cursor);
}

function colonDirective(
    text: string,
    start: number,
    end: number,
    colon: number,
): { readonly directive?: ScannedDirective } {
    const wordStart = colon + 1;
    const wordEnd = readWord(text, wordStart, end);
    const word = text.slice(wordStart, wordEnd).toLowerCase();
    let kind = directiveKinds.get(word);
    let keywordEnd = wordEnd;
    let keyword = text.slice(wordStart, wordEnd);
    if (kind === "onError") {
        // `:on error` is the only two-word directive. A bare `:on` is malformed rather than unknown.
        const secondStart = skipSpaces(text, wordEnd, end);
        const secondEnd = readWord(text, secondStart, end);
        if (text.slice(secondStart, secondEnd).toLowerCase() !== "error") {
            return {
                directive: {
                    kind: "onError",
                    keyword,
                    keywordRange: { start: colon, end: wordEnd },
                    range: { start, end },
                    rawArguments: [],
                    malformed: {
                        code: "SqlCmdMalformedDirective",
                        message: "':on' must be written as ':on error'.",
                        range: { start: colon, end: wordEnd },
                    },
                },
            };
        }
        keywordEnd = secondEnd;
        keyword = text.slice(wordStart, secondEnd);
    }
    if (kind === undefined) {
        if (wordEnd === wordStart) return {};
        kind = "unknown";
    }
    const rawArguments = readArguments(text, keywordEnd, end);
    return {
        directive: {
            kind,
            keyword,
            keywordRange: { start: colon, end: keywordEnd },
            range: { start, end },
            rawArguments,
            ...(kind === "unknown"
                ? {
                      malformed: {
                          code: "SqlCmdUnknownDirective",
                          message: `':${keyword}' is not a SQLCMD command.`,
                          range: { start: colon, end: keywordEnd },
                      },
                  }
                : {}),
        },
    };
}

function goDirective(
    text: string,
    start: number,
    end: number,
    cursor: number,
): { readonly directive?: ScannedDirective } {
    const wordEnd = readWord(text, cursor, end);
    if (text.slice(cursor, wordEnd).toLowerCase() !== "go") return {};
    const rest = skipSpaces(text, wordEnd, end);
    const countEnd = readDigits(text, rest, end);
    const tail = skipSpaces(text, countEnd, end);
    const hasCount = countEnd > rest;
    if (tail < end) {
        // `GO` followed by anything but a repeat count is ordinary SQL, not a batch separator.
        return {};
    }
    const count = hasCount ? Number(text.slice(rest, countEnd)) : undefined;
    return {
        directive: {
            kind: "go",
            keyword: text.slice(cursor, wordEnd),
            keywordRange: { start: cursor, end: wordEnd },
            range: { start, end },
            rawArguments: hasCount
                ? [
                      {
                          text: text.slice(rest, countEnd),
                          range: { start: rest, end: countEnd },
                          quoted: false,
                          secret: false,
                      },
                  ]
                : [],
            ...(count !== undefined && Number.isSafeInteger(count) ? { batchCount: count } : {}),
        },
    };
}

function readArguments(text: string, from: number, end: number): readonly ScannedArgument[] {
    const result: ScannedArgument[] = [];
    let cursor = skipSpaces(text, from, end);
    let previousSwitch = "";
    while (cursor < end) {
        const code = text.charCodeAt(cursor);
        if (code === 34) {
            const closing = text.indexOf('"', cursor + 1);
            // An unterminated quote runs to the end of the line rather than swallowing the rest of
            // the document, so a half-typed argument stays confined to the line being typed.
            const closed = closing >= 0 && closing < end;
            const stop = closed ? closing + 1 : end;
            const inner = text.slice(cursor + 1, closed ? closing : end);
            result.push({
                text: secretSwitches.has(previousSwitch) ? "" : inner,
                range: { start: cursor, end: stop },
                quoted: true,
                secret: secretSwitches.has(previousSwitch),
            });
            previousSwitch = "";
            cursor = skipSpaces(text, stop, end);
            continue;
        }
        const wordEnd = readArgumentWord(text, cursor, end);
        const raw = text.slice(cursor, wordEnd);
        const secret = secretSwitches.has(previousSwitch);
        result.push({
            text: secret ? "" : raw,
            range: { start: cursor, end: wordEnd },
            quoted: false,
            secret,
        });
        previousSwitch = /^[-/]/u.test(raw) ? raw.toLowerCase() : "";
        cursor = skipSpaces(text, wordEnd, end);
    }
    return Object.freeze(result);
}

/**
 * Reads a `$(name)` occurrence anywhere on the line.
 *
 * SQLCMD substitutes textually, before any SQL lexing, so a reference inside a string literal or a
 * comment is substituted too and is recorded here as well. A `$(` that never closes, or one whose
 * contents are not a valid name, is ordinary text: that is SQLCMD's own escape, and no reference is
 * recorded for it.
 */
function scanVariableReferences(
    text: string,
    start: number,
    end: number,
): readonly ScannedVariableReference[] {
    const result: ScannedVariableReference[] = [];
    for (let index = start; index + 2 < end; index++) {
        if (text.charCodeAt(index) !== 36 || text.charCodeAt(index + 1) !== 40) continue;
        const nameStart = index + 2;
        let cursor = nameStart;
        while (cursor < end && isVariableNameCharacter(text.charCodeAt(cursor))) cursor++;
        if (cursor === nameStart || cursor >= end || text.charCodeAt(cursor) !== 41) continue;
        result.push({
            name: text.slice(nameStart, cursor),
            range: { start: index, end: cursor + 1 },
        });
        index = cursor;
    }
    return result.length === 0 ? emptyReferences : Object.freeze(result);
}

const emptyReferences: readonly ScannedVariableReference[] = Object.freeze([]);

/** SQLCMD variable names allow letters, digits, and underscores. */
export function isValidVariableName(name: string): boolean {
    if (name.length === 0) return false;
    for (let index = 0; index < name.length; index++) {
        if (!isVariableNameCharacter(name.charCodeAt(index))) return false;
    }
    return true;
}

function isVariableNameCharacter(code: number): boolean {
    return (
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        code === 95 ||
        code > 127
    );
}

function skipSpaces(text: string, from: number, end: number): number {
    let cursor = from;
    while (cursor < end) {
        const code = text.charCodeAt(cursor);
        if (code !== 32 && code !== 9) break;
        cursor++;
    }
    return cursor;
}

function readWord(text: string, from: number, end: number): number {
    let cursor = from;
    while (cursor < end) {
        const code = text.charCodeAt(cursor);
        if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122))) break;
        cursor++;
    }
    return cursor;
}

function readDigits(text: string, from: number, end: number): number {
    let cursor = from;
    while (cursor < end) {
        const code = text.charCodeAt(cursor);
        if (code < 48 || code > 57) break;
        cursor++;
    }
    return cursor;
}

function readArgumentWord(text: string, from: number, end: number): number {
    let cursor = from;
    while (cursor < end) {
        const code = text.charCodeAt(cursor);
        if (code === 32 || code === 9) break;
        cursor++;
    }
    return cursor;
}
