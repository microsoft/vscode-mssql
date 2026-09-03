/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxNode as LezerNode, Tree } from "@lezer/common";
import type { TextRange } from "../../text/index.js";
import type { SyntaxDiagnostic } from "../contracts.js";
import { codeMask } from "./syntaxDiagnosticUtilities.js";

/**
 * What a statement leaves behind after it has already failed.
 *
 * Once a statement cannot continue, the text after the break is no longer read as part of it. A
 * parenthesis written after a name then reads as the start of a parenthesized query, and the first
 * word inside it is reported against that reading; a parenthesis written after WITH reads as a
 * common table expression, which reports the parenthesis itself as well. Reporting the tail this
 * way names the constructs the statement can no longer hold, instead of restating one mistake at
 * every remaining token.
 */
const cteNameExpectation = "CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES";
const groupedQueryExpectation = "'(', or SELECT";

/**
 * The statements whose trailing option list this applies to. Each defines its object with a WITH
 * list written after the definition body, which is where a failed definition leaves the reader.
 */
const optionListStatements = new Set([
    "CreateTableStatement",
    "CreateTypeStatement",
    "CreateSemanticIndexStatement",
]);

export function recoveryTailDiagnostics(tree: Tree, text: string): readonly SyntaxDiagnostic[] {
    const tails = new Map<LezerNode, number>();
    const argumentTails = new Map<LezerNode, number>();
    tree.iterate({
        enter(node) {
            if (!node.type.isError) return;
            const statement = enclosingStatement(node.node);
            if (statement) tails.set(statement, Math.max(tails.get(statement) ?? 0, node.to));
            const argumentList = enclosingArgumentList(node.node);
            if (argumentList) {
                argumentTails.set(
                    argumentList,
                    Math.max(argumentTails.get(argumentList) ?? 0, node.to),
                );
            }
        },
    });
    if (tails.size === 0 && argumentTails.size === 0) return [];
    const code = codeMask(text);
    const result: SyntaxDiagnostic[] = [];
    for (const [statement, from] of tails) {
        result.push(...tailDiagnostics(text, code, from, statement.to, false));
    }
    for (const [argumentList, from] of argumentTails) {
        result.push(...tailDiagnostics(text, code, from, argumentList.to, true));
    }
    return result;
}

/**
 * An argument list that has already failed reads the rest of its arguments as parenthesized
 * queries, so each call written inside it reports the word its parentheses open on.
 */
function enclosingArgumentList(node: LezerNode): LezerNode | undefined {
    for (let current: LezerNode | null = node.parent; current; current = current.parent) {
        if (current.name === "ArgumentList") return current;
        if (current.name === "Statement") return undefined;
    }
    return undefined;
}

/** The tail belongs to the innermost statement, so a nested module body keeps its own boundary. */
function enclosingStatement(node: LezerNode): LezerNode | undefined {
    for (let current: LezerNode | null = node.parent; current; current = current.parent) {
        if (optionListStatements.has(current.name)) return current;
        if (current.name === "Statement") return undefined;
    }
    return undefined;
}

function tailDiagnostics(
    text: string,
    code: string,
    from: number,
    to: number,
    calls: boolean,
): readonly SyntaxDiagnostic[] {
    const result: SyntaxDiagnostic[] = [];
    for (let index = from; index < to; index++) {
        if (code[index] !== "(") continue;
        const owner = precedingWord(code, index);
        // A WITH the statement already reported against is the mistake itself, not its tail.
        if (!owner || owner.start < from) continue;
        const cte = owner.word === "with";
        if (!cte && !calls) continue;
        const first = firstTokenInside(code, index + 1, to);
        if (!first) continue;
        if (cte) result.push(near(text, { start: index, end: index + 1 }, cteNameExpectation));
        result.push(near(text, first, groupedQueryExpectation));
    }
    return result;
}

/** Reports the word directly before this parenthesis, or nothing when none stands there. */
function precedingWord(
    code: string,
    open: number,
): { readonly word: string; readonly start: number } | undefined {
    let end = open;
    while (end > 0 && isSpace(code[end - 1]!)) end--;
    if (end === 0) return undefined;
    let start = end;
    while (start > 0 && isNameCharacter(code[start - 1]!)) start--;
    return start === end ? undefined : { word: code.slice(start, end).toLowerCase(), start };
}

function firstTokenInside(code: string, from: number, to: number): TextRange | undefined {
    let start = from;
    while (start < to && isSpace(code[start]!)) start++;
    if (start >= to) return undefined;
    if (code[start] === "[" || code[start] === '"') {
        const close = code[start] === "[" ? "]" : '"';
        const end = code.indexOf(close, start + 1);
        return end < 0 || end >= to ? undefined : { start, end: end + 1 };
    }
    let end = start;
    while (end < to && isNameCharacter(code[end]!)) end++;
    return end === start ? undefined : { start, end };
}

function isSpace(character: string): boolean {
    return character === " " || character === "\t" || character === "\n" || character === "\r";
}

function isNameCharacter(character: string): boolean {
    return /[\p{L}\p{N}_$#@.]/u.test(character);
}

function near(text: string, range: TextRange, expected: string): SyntaxDiagnostic {
    return {
        code: "syntax",
        message: `Incorrect syntax near '${text.slice(range.start, range.end)}'.  Expecting ${expected}.`,
        severity: "error",
        range,
    };
}
