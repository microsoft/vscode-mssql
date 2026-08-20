/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxNode, SyntaxSnapshot } from "../../syntax/index.js";
import { ancestorOfKind as ancestor } from "../../syntax/treeUtilities.js";
import { multipartIdentifierRangeAt, parseMultipartName } from "../identifiers.js";
import type { CursorContext, CursorExpectation, ResolvedCall, SemanticModel } from "./contracts.js";

/**
 * The caret's semantic position, built once from recovered syntax plus the bound model.
 *
 * Completion and signature help previously each reconstructed context from damaged syntax, which is
 * why the same caret could be a column position for one and a keyword position for the other.
 * Recovery is recorded rather than hidden: a caller that must not guess can check it.
 */

/** Node kinds whose presence means the caret is inside a construct the parser could not finish. */
const recoveryKinds: ReadonlySet<string> = new Set(["⚠"]);

export function buildCursorContext(
    syntax: SyntaxSnapshot,
    model: SemanticModel,
    offset: number,
): CursorContext {
    const node = syntax.nodeAt(offset);
    const call = model.callAt(offset);
    const replacementRange = multipartIdentifierRangeAt(syntax.document.text, offset);
    const written = syntax.document.text.slice(replacementRange.start, replacementRange.end);
    const partial = parseMultipartName(written, replacementRange.start);
    return Object.freeze({
        offset,
        replacementRange,
        expected: expectationAt(syntax, node, call, offset),
        ...(model.scopeAt(offset) ? { scope: model.scopeAt(offset)! } : {}),
        ...(partial.parts.length > 0
            ? {
                  partialName: Object.freeze({
                      parts: partial.parts,
                      range: replacementRange,
                      role: "unknown" as const,
                      object: partial.parts.at(-1)!.normalized,
                      hasOmittedParts: partial.hasOmittedParts,
                      resolution: { kind: "unresolved" as const, reason: "unknown" as const },
                      insertionForm: written,
                  }),
              }
            : {}),
        ...(call ? { call } : {}),
        ...(call ? { activeArgument: activeArgument(call, offset) } : {}),
        recovery: recoveryAt(node),
    }) as CursorContext;
}

/**
 * Which argument the caret is in.
 *
 * Counting the separators the call model already recorded means a parenthesized call, a
 * keyword-separated conversion, and `TOP` all answer through the same rule, with no feature
 * re-deriving where one argument ends and the next begins.
 */
export function activeArgument(call: ResolvedCall, offset: number): number {
    let active = 0;
    for (const separator of call.separators) {
        if (separator < offset) active++;
    }
    return active;
}

function expectationAt(
    syntax: SyntaxSnapshot,
    node: SyntaxNode,
    call: ResolvedCall | undefined,
    offset: number,
): CursorExpectation {
    if (expectsDataType(syntax, node, offset)) return "datatype";
    if (ancestor(node, ["FromClause", "TableSource", "DmlTarget", "IntoClause"])) return "relation";
    if (call && call.argumentRange && offset > call.argumentRange.start) return "parameter";
    if (
        ancestor(node, [
            "SelectList",
            "WhereClause",
            "GroupByClause",
            "HavingClause",
            "OrderByClause",
        ])
    ) {
        return "column";
    }
    if (ancestor(node, ["FunctionCall", "FunctionTableSource"])) return "function";
    return "unknown";
}

/**
 * Recognizes complete and normally incomplete type positions from recovered tree ownership.
 * Keyword checks are constrained to one structural owner; this never scans backward across a
 * statement and therefore cannot turn text in a literal or a previous declaration into context.
 */
function expectsDataType(syntax: SyntaxSnapshot, node: SyntaxNode, offset: number): boolean {
    if (ancestor(node, ["DataType"])) return true;

    const declaration = ancestor(node, [
        "VariableDeclaration",
        "ColumnDefinition",
        "ProcedureParameter",
    ]);
    if (declaration && !containsKind(declaration, "DataType")) return true;

    const cast = ancestor(node, ["CastExpression", "TryCastExpression"]);
    if (
        (cast && typeOwnerWords(syntax, cast, node, offset, 1)[0] === "AS") ||
        incompleteConversionBefore(syntax, offset)
    ) {
        return true;
    }

    const functionDefinition = ancestor(node, ["FunctionDefinition"]);
    if (
        functionDefinition &&
        typeOwnerWords(syntax, functionDefinition, node, offset, 1)[0] === "RETURNS"
    ) {
        return true;
    }

    const createType = ancestor(node, ["CreateTypeStatement"]);
    if (createType && typeOwnerWords(syntax, createType, node, offset, 1)[0] === "FROM") {
        return true;
    }

    const alter = ancestor(node, ["AlterTableAction"]);
    const alterTail = alter ? typeOwnerWords(syntax, alter, node, offset, 2) : [];
    return Boolean(alter && alterTail[0] === "COLUMN" && alterTail.length === 2);
}

function incompleteConversionBefore(syntax: SyntaxSnapshot, offset: number): boolean {
    const current = lastSignificantToken(syntax, syntax.root(), offset);
    if (!current || current.end !== offset) return false;
    for (const kind of ["CastExpression", "TryCastExpression"] as const) {
        for (const candidate of syntax.structuralIndex?.().get(kind) ?? []) {
            if (candidate.end !== current.start || containsKind(candidate, "DataType")) continue;
            if (lastWords(syntax, candidate, candidate.end, 1)[0] === "AS") return true;
        }
    }
    return false;
}

function containsKind(node: SyntaxNode, kind: string): boolean {
    if (node.kind === kind) return true;
    for (const child of node.children()) {
        if (containsKind(child, kind)) return true;
    }
    return false;
}

function lastWords(
    syntax: SyntaxSnapshot,
    owner: SyntaxNode,
    offset: number,
    count: number,
): readonly string[] {
    const words: string[] = [];
    for (const token of syntax.tokens({ start: owner.start, end: Math.min(owner.end, offset) })) {
        if (token.trivia || token.end > offset) continue;
        words.push(token.text.toUpperCase());
    }
    return words.slice(-count);
}

function typeOwnerWords(
    syntax: SyntaxSnapshot,
    owner: SyntaxNode,
    node: SyntaxNode,
    offset: number,
    count: number,
): readonly string[] {
    const tokens = significantTokens(syntax, owner, offset);
    if (recoveryAt(node) !== "complete" && tokens.at(-1)?.end === offset) tokens.pop();
    return tokens.slice(-count).map((token) => token.text.toUpperCase());
}

function lastSignificantToken(syntax: SyntaxSnapshot, owner: SyntaxNode, offset: number) {
    return significantTokens(syntax, owner, offset).at(-1);
}

function significantTokens(syntax: SyntaxSnapshot, owner: SyntaxNode, offset: number) {
    return [...syntax.tokens({ start: owner.start, end: Math.min(owner.end, offset) })].filter(
        (token) => !token.trivia && token.end <= offset,
    );
}

function recoveryAt(node: SyntaxNode): CursorContext["recovery"] {
    for (let current: SyntaxNode | undefined = node; current; current = current.parent()) {
        if (recoveryKinds.has(current.kind) || current.error) return "recovered";
    }
    return "complete";
}
