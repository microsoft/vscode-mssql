/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxNode, SyntaxSnapshot } from "../../syntax/index.js";
import { ancestorOfKind as ancestor } from "../../syntax/treeUtilities.js";
import type { TextRange } from "../../text/index.js";
import { parseMultipartName } from "../identifiers.js";
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
    const replacementRange = identifierRangeAt(syntax.document.text, offset);
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
    if (ancestor(node, ["DataType", "CastExpression", "TryCastExpression"])) {
        if (ancestor(node, ["DataType"])) return "datatype";
    }
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
    void syntax;
    return "unknown";
}

function recoveryAt(node: SyntaxNode): CursorContext["recovery"] {
    for (let current: SyntaxNode | undefined = node; current; current = current.parent()) {
        if (recoveryKinds.has(current.kind) || current.error) return "recovered";
    }
    return "complete";
}

/** The span a completion edit replaces: the identifier the caret is inside or adjacent to. */
export function identifierRangeAt(text: string, offset: number): TextRange {
    let start = offset;
    while (start > 0 && isNameCharacter(text[start - 1]!)) start--;
    let end = offset;
    while (end < text.length && isNameCharacter(text[end]!)) end++;
    return { start, end };
}

function isNameCharacter(character: string): boolean {
    return /[\p{L}\p{N}_$#@.]/u.test(character);
}
