/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CompletionItem, CompletionResult } from "../features/contracts.js";
import { compareOrdinal } from "../common/ordinal.js";
import type { SqlCmdDocumentSnapshot } from "./contracts.js";
import { sqlCmdDirectiveDescriptor, sqlCmdDirectiveNames } from "./sqlCmdScanner.js";

/**
 * Completion for the SQLCMD layer.
 *
 * It answers only where SQLCMD owns the text: at the start of a directive line, inside a
 * directive's argument list, and inside a `$(` reference. Everywhere else it returns nothing so
 * the T-SQL feature service keeps ownership of the position.
 */
export function sqlCmdCompletion(
    snapshot: SqlCmdDocumentSnapshot,
    offset: number,
): CompletionResult | undefined {
    const text = snapshot.text;
    if (offset < 0 || offset > text.length) return undefined;

    const variable = variableReferenceContext(text, offset);
    if (variable) {
        return {
            items: Object.freeze(variableCompletions(snapshot, variable)),
            incomplete: false,
        };
    }

    const line = lineBounds(text, offset);
    const firstNonBlank = skipBlanks(text, line.start, line.end);
    if (firstNonBlank >= offset && text.charCodeAt(firstNonBlank) !== 58) {
        // The cursor is still in the leading whitespace of a line, so a directive may begin here.
        return offset === firstNonBlank && isBlankLine(text, line)
            ? {
                  items: Object.freeze(directiveCompletions("", { start: offset, end: offset })),
                  incomplete: false,
              }
            : undefined;
    }
    if (text.charCodeAt(firstNonBlank) !== 58) return undefined;

    const wordEnd = readDirectiveWord(text, firstNonBlank, line.end);
    if (offset <= wordEnd) {
        return {
            items: Object.freeze(
                directiveCompletions(text.slice(firstNonBlank, offset), {
                    start: firstNonBlank,
                    end: wordEnd,
                }),
            ),
            incomplete: false,
        };
    }
    const directive = snapshot.directives.find(
        (candidate) =>
            candidate.documentUri === snapshot.uri &&
            candidate.range.start <= offset &&
            offset <= candidate.range.end,
    );
    const keyword = directive ? `:${directive.keyword.toLowerCase()}` : undefined;
    const values = keyword ? sqlCmdDirectiveDescriptor(keyword)?.arguments : undefined;
    if (!values) return { items: Object.freeze([]), incomplete: false };
    const argumentStart = argumentWordStart(text, offset, line.start);
    return {
        items: Object.freeze(
            values
                .filter((value) =>
                    value.startsWith(text.slice(argumentStart, offset).toLowerCase()),
                )
                .map((value) => ({
                    label: value,
                    kind: "value",
                    sortText: `01-${value}`,
                    edit: { start: argumentStart, end: offset, newText: value },
                })),
        ),
        incomplete: false,
    };
}

function directiveCompletions(
    prefix: string,
    range: { start: number; end: number },
): CompletionItem[] {
    const folded = prefix.toLowerCase();
    return sqlCmdDirectiveNames
        .filter((name) => name.startsWith(folded))
        .map((name) => ({
            label: name,
            kind: "keyword",
            detail: "SQLCMD command",
            documentation: sqlCmdDirectiveDescriptor(name)?.documentation ?? "",
            sortText: `00-${name}`,
            edit: { ...range, newText: name },
        }));
}

function variableCompletions(
    snapshot: SqlCmdDocumentSnapshot,
    context: { readonly prefix: string; readonly start: number; readonly end: number },
): CompletionItem[] {
    const folded = context.prefix.toUpperCase();
    // Names are matched without regard to case, so one entry per variable is offered, spelled the
    // way the document declared it rather than the way the lookup key normalizes it.
    const names = new Map<string, string>();
    for (const name of snapshot.variables.keys()) names.set(name.toUpperCase(), name);
    for (const definition of snapshot.variableDefinitions) {
        names.set(definition.name.toUpperCase(), definition.name);
    }
    return [...names.values()]
        .filter((name) => name.toUpperCase().startsWith(folded))
        .sort(compareOrdinal)
        .map((name) => ({
            label: name,
            kind: "variable",
            detail: "SQLCMD variable",
            // A value may hold a connection detail, so only the name is offered.
            sortText: `00-${name}`,
            edit: { start: context.start, end: context.end, newText: name },
        }));
}

function variableReferenceContext(
    text: string,
    offset: number,
): { readonly prefix: string; readonly start: number; readonly end: number } | undefined {
    let cursor = offset;
    while (cursor > 0 && isNameCharacter(text.charCodeAt(cursor - 1))) cursor--;
    if (cursor < 2 || text.charCodeAt(cursor - 1) !== 40 || text.charCodeAt(cursor - 2) !== 36) {
        return undefined;
    }
    let end = offset;
    while (end < text.length && isNameCharacter(text.charCodeAt(end))) end++;
    return { prefix: text.slice(cursor, offset), start: cursor, end };
}

function isNameCharacter(code: number): boolean {
    return (
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        code === 95
    );
}

function lineBounds(text: string, offset: number): { start: number; end: number } {
    let start = offset;
    while (start > 0 && text.charCodeAt(start - 1) !== 10 && text.charCodeAt(start - 1) !== 13) {
        start--;
    }
    let end = offset;
    while (end < text.length && text.charCodeAt(end) !== 10 && text.charCodeAt(end) !== 13) end++;
    return { start, end };
}

function isBlankLine(text: string, line: { start: number; end: number }): boolean {
    return text.slice(line.start, line.end).trim().length === 0;
}

function skipBlanks(text: string, from: number, end: number): number {
    let cursor = from;
    while (cursor < end) {
        const code = text.charCodeAt(cursor);
        if (code !== 32 && code !== 9) break;
        cursor++;
    }
    return cursor;
}

function readDirectiveWord(text: string, colon: number, end: number): number {
    let cursor = colon + 1;
    while (cursor < end) {
        const code = text.charCodeAt(cursor);
        if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122))) break;
        cursor++;
    }
    // ':on error' is the only two-word command, so a following ' error' belongs to the word.
    if (text.slice(colon, cursor).toLowerCase() === ":on") {
        const spaceEnd = skipBlanks(text, cursor, end);
        let wordEnd = spaceEnd;
        while (wordEnd < end) {
            const code = text.charCodeAt(wordEnd);
            if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122))) break;
            wordEnd++;
        }
        if (text.slice(spaceEnd, wordEnd).toLowerCase() === "error") return wordEnd;
    }
    return cursor;
}

function argumentWordStart(text: string, offset: number, lineStart: number): number {
    let cursor = offset;
    while (cursor > lineStart) {
        const code = text.charCodeAt(cursor - 1);
        if (code === 32 || code === 9) break;
        cursor--;
    }
    return cursor;
}
