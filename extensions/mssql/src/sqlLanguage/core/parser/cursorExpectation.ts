/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Parser-owned completion expectation (C0).
 *
 * The current completion stack still uses CompletionContext as the producer
 * contract. This module is the compatibility layer from parser expectations to
 * that contract: it keeps proven producers intact, while giving the parser the
 * first say on contexts where silence is more useful than broad fallbacks.
 */

import { CompletionContext, classifyContext } from "../context";
import { Token, TokenKind, isTrivia, tokenIndexAt } from "../lexer";
import { ClauseKind, StatementSketch } from "../sketch";

export type CompletionExpectationKind =
    | "none"
    | "declarationName"
    | "typeName"
    | "statementKeyword"
    | "memberAccess"
    | "tableSource"
    | "joinTableSource"
    | "joinOperator"
    | "joinPredicate"
    | "columnExpression"
    | "predicateExpression"
    | "valueExpression"
    | "insertColumnList"
    | "updateSetTarget"
    | "execProcedure"
    | "execArgument"
    | "databaseName";

export type CompletionExpectationConfidence = "high" | "medium" | "low";

export type CompletionSuppressReason = "comment" | "string" | "sqlcmd" | "declarationSymbol";

export interface CompletionExpectation {
    readonly kind: CompletionExpectationKind;
    readonly confidence: CompletionExpectationConfidence;
    readonly context: CompletionContext;
    readonly suppressReason?: CompletionSuppressReason;
}

export function completionContextFromExpectation(
    expectation: CompletionExpectation,
): CompletionContext {
    return expectation.context;
}

export function completionExpectationAt(
    text: string,
    tokens: readonly Token[],
    sketch: StatementSketch,
    offset: number,
): CompletionExpectation {
    const legacy = classifyContext(text, tokens, sketch, offset);
    if (
        legacy.kind === "none" &&
        (legacy.reason === "comment" || legacy.reason === "string" || legacy.reason === "sqlcmd")
    ) {
        return fromLegacy(legacy);
    }

    const declaration = declarationNameExpectation(text, tokens, sketch, offset, legacy);
    if (declaration !== undefined) {
        return declaration;
    }

    const typeName = typeNameExpectation(text, tokens, sketch, offset);
    if (typeName !== undefined) {
        return typeName;
    }

    return fromLegacy(legacy);
}

function declarationNameExpectation(
    text: string,
    tokens: readonly Token[],
    sketch: StatementSketch,
    offset: number,
    legacy: CompletionContext,
): CompletionExpectation | undefined {
    if (legacy.kind === "none" && legacy.reason === "declarationSymbol") {
        return declarationName();
    }
    if (isModuleObjectNameContext(text, tokens, sketch, offset)) {
        return declarationName();
    }
    if (isDeclareVariableNameContext(text, tokens, sketch, offset)) {
        return declarationName();
    }
    if (isTableColumnNameContext(text, tokens, sketch, offset)) {
        return declarationName();
    }
    if (isAlterTableAddColumnNameContext(text, tokens, sketch, offset)) {
        return declarationName();
    }
    return undefined;
}

function typeNameExpectation(
    text: string,
    tokens: readonly Token[],
    sketch: StatementSketch,
    offset: number,
): CompletionExpectation | undefined {
    const tableTypePrefix = tableColumnTypePrefix(text, tokens, sketch, offset);
    if (tableTypePrefix !== undefined) {
        return typeName(tableTypePrefix);
    }
    const alterAddPrefix = alterTableAddTypePrefix(text, tokens, sketch, offset);
    if (alterAddPrefix !== undefined) {
        return typeName(alterAddPrefix);
    }
    return undefined;
}

function declarationName(): CompletionExpectation {
    return {
        kind: "declarationName",
        confidence: "high",
        suppressReason: "declarationSymbol",
        context: { kind: "none", reason: "declarationSymbol" },
    };
}

function typeName(prefix: string): CompletionExpectation {
    return {
        kind: "typeName",
        confidence: "high",
        context: { kind: "declareType", prefix },
    };
}

function fromLegacy(context: CompletionContext): CompletionExpectation {
    if (context.kind === "none") {
        return {
            kind: context.reason === "declarationSymbol" ? "declarationName" : "none",
            confidence: "high",
            suppressReason: context.reason,
            context,
        };
    }
    switch (context.kind) {
        case "statementStart":
            return { kind: "statementKeyword", confidence: "medium", context };
        case "memberAccess":
            return { kind: "memberAccess", confidence: "high", context };
        case "tableSource":
            return {
                kind: context.afterJoin ? "joinTableSource" : "tableSource",
                confidence: "high",
                context,
            };
        case "joinOperator":
            return { kind: "joinOperator", confidence: "high", context };
        case "joinPredicate":
            return { kind: "joinPredicate", confidence: "high", context };
        case "expression":
            return {
                kind: expressionExpectationKind(context.clause),
                confidence: "medium",
                context,
            };
        case "insertColumnList":
            return { kind: "insertColumnList", confidence: "high", context };
        case "updateSetTarget":
            return { kind: "updateSetTarget", confidence: "high", context };
        case "execProcedure":
            return { kind: "execProcedure", confidence: "high", context };
        case "execArgs":
            return { kind: "execArgument", confidence: "high", context };
        case "declareType":
            return { kind: "typeName", confidence: "high", context };
        case "useDatabase":
            return { kind: "databaseName", confidence: "high", context };
    }
}

function expressionExpectationKind(clause: ClauseKind): CompletionExpectationKind {
    switch (clause) {
        case "selectList":
        case "groupBy":
        case "orderBy":
        case "output":
            return "columnExpression";
        case "where":
        case "having":
            return "predicateExpression";
        default:
            return "valueExpression";
    }
}

function isModuleObjectNameContext(
    text: string,
    tokens: readonly Token[],
    sketch: StatementSketch,
    offset: number,
): boolean {
    if (sketch.kind !== "moduleHeader") {
        return false;
    }
    const first = firstSignificantIndex(tokens, sketch);
    if (first < 0 || !isCreateOrAlter(text, tokens[first])) {
        return false;
    }
    const moduleKind = nextSignificantInSketch(tokens, sketch, first + 1);
    if (moduleKind < 0 || !isModuleKind(text, tokens[moduleKind])) {
        return false;
    }
    return isDottedDeclarationNameAfter(
        text,
        tokens,
        sketch,
        moduleKind,
        offset,
        new Set(["AS", "WITH", "RETURNS", "ON", "FOR"]),
    );
}

function isDeclareVariableNameContext(
    text: string,
    tokens: readonly Token[],
    sketch: StatementSketch,
    offset: number,
): boolean {
    if (sketch.kind !== "declare") {
        return false;
    }
    const first = firstSignificantIndex(tokens, sketch);
    if (first < 0 || word(text, tokens[first]) !== "DECLARE") {
        return false;
    }
    const current = tokenAtOffset(tokens, offset);
    if (
        current !== undefined &&
        current.kind === TokenKind.Variable &&
        offset > current.start &&
        offset <= current.end
    ) {
        const currentIndex = tokenIndexAt(tokens, Math.max(0, offset - 1));
        const prev = prevSignificant(tokens, currentIndex, first);
        return prev >= 0 && isDeclareNameAnchor(text, tokens[prev]);
    }
    const prev = prevSignificantBeforeOffset(tokens, offset, first);
    if (prev < 0) {
        return false;
    }
    if (!isDeclareNameAnchor(text, tokens[prev])) {
        return false;
    }
    const next = nextSignificantBeforeOffset(tokens, prev + 1, offset);
    return next < 0;
}

function isTableColumnNameContext(
    text: string,
    tokens: readonly Token[],
    sketch: StatementSketch,
    offset: number,
): boolean {
    const info = tableColumnSlot(text, tokens, sketch, offset);
    return info?.position === "columnName";
}

function tableColumnTypePrefix(
    text: string,
    tokens: readonly Token[],
    sketch: StatementSketch,
    offset: number,
): string | undefined {
    const info = tableColumnSlot(text, tokens, sketch, offset);
    return info?.position === "typeName" ? info.prefix : undefined;
}

function tableColumnSlot(
    text: string,
    tokens: readonly Token[],
    sketch: StatementSketch,
    offset: number,
):
    | { readonly position: "columnName" }
    | { readonly position: "typeName"; readonly prefix: string }
    | undefined {
    if (sketch.kind !== "createTable" && sketch.kind !== "declare") {
        return undefined;
    }
    const open = tableDefinitionOpen(text, tokens, sketch, offset);
    if (open < 0 || parenDepthFromOpen(tokens, text, open, offset) !== 1) {
        return undefined;
    }
    return columnDeclarationSlot(text, tokens, sketch, open, offset);
}

function isAlterTableAddColumnNameContext(
    text: string,
    tokens: readonly Token[],
    sketch: StatementSketch,
    offset: number,
): boolean {
    const slot = alterTableAddSlot(text, tokens, sketch, offset);
    return slot?.position === "columnName";
}

function alterTableAddTypePrefix(
    text: string,
    tokens: readonly Token[],
    sketch: StatementSketch,
    offset: number,
): string | undefined {
    const slot = alterTableAddSlot(text, tokens, sketch, offset);
    return slot?.position === "typeName" ? slot.prefix : undefined;
}

function alterTableAddSlot(
    text: string,
    tokens: readonly Token[],
    sketch: StatementSketch,
    offset: number,
):
    | { readonly position: "columnName" }
    | { readonly position: "typeName"; readonly prefix: string }
    | undefined {
    const first = firstSignificantIndex(tokens, sketch);
    if (first < 0 || word(text, tokens[first]) !== "ALTER") {
        return undefined;
    }
    const table = nextSignificantInSketch(tokens, sketch, first + 1);
    if (table < 0 || word(text, tokens[table]) !== "TABLE") {
        return undefined;
    }
    let add = -1;
    for (let i = table + 1; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.start >= offset || t.start > sketch.span.end || t.kind === TokenKind.EndOfFile) {
            break;
        }
        if (isTrivia(t.kind)) {
            continue;
        }
        if (word(text, t) === "ADD") {
            add = i;
            break;
        }
    }
    if (add < 0 || offset <= tokens[add].end) {
        return undefined;
    }
    const afterAdd = nextSignificantBeforeOffset(tokens, add + 1, offset);
    const anchor = afterAdd >= 0 && word(text, tokens[afterAdd]) === "COLUMN" ? afterAdd : add;
    return simpleDeclarationSlot(text, tokens, anchor, offset);
}

function columnDeclarationSlot(
    text: string,
    tokens: readonly Token[],
    sketch: StatementSketch,
    openIndex: number,
    offset: number,
):
    | { readonly position: "columnName" }
    | { readonly position: "typeName"; readonly prefix: string }
    | undefined {
    let segmentStart = openIndex;
    let depth = 1;
    for (let i = openIndex + 1; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.start >= offset || t.start > sketch.span.end || t.kind === TokenKind.EndOfFile) {
            break;
        }
        if (isTrivia(t.kind)) {
            continue;
        }
        const p = punct(text, t);
        if (p === "(") {
            depth++;
        } else if (p === ")") {
            depth = Math.max(0, depth - 1);
        } else if (p === "," && depth === 1) {
            segmentStart = i;
        }
    }
    if (depth !== 1) {
        return undefined;
    }
    return simpleDeclarationSlot(text, tokens, segmentStart, offset);
}

function simpleDeclarationSlot(
    text: string,
    tokens: readonly Token[],
    anchorIndex: number,
    offset: number,
):
    | { readonly position: "columnName" }
    | { readonly position: "typeName"; readonly prefix: string }
    | undefined {
    const first = nextSignificantBeforeOffset(tokens, anchorIndex + 1, offset);
    if (first < 0) {
        return { position: "columnName" };
    }
    const firstToken = tokens[first];
    if (!isNameToken(firstToken)) {
        return undefined;
    }
    if (offset > firstToken.start && offset <= firstToken.end) {
        return { position: "columnName" };
    }
    const second = nextSignificantBeforeOffset(tokens, first + 1, offset);
    if (second < 0) {
        return { position: "typeName", prefix: "" };
    }
    const secondToken = tokens[second];
    if (isNameToken(secondToken) && offset > secondToken.start && offset <= secondToken.end) {
        return { position: "typeName", prefix: text.slice(secondToken.start, offset) };
    }
    return undefined;
}

function isDottedDeclarationNameAfter(
    text: string,
    tokens: readonly Token[],
    sketch: StatementSketch,
    anchorIndex: number,
    offset: number,
    stopWords: ReadonlySet<string>,
): boolean {
    if (offset <= tokens[anchorIndex].end) {
        return false;
    }
    let sawContent = false;
    let previousWasDot = false;
    for (let i = anchorIndex + 1; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.start > sketch.span.end || t.kind === TokenKind.EndOfFile) {
            break;
        }
        if (isTrivia(t.kind)) {
            if (t.start < offset && offset <= t.end) {
                return !sawContent || previousWasDot;
            }
            continue;
        }
        if (t.start >= offset) {
            return !sawContent || previousWasDot;
        }
        const w = word(text, t);
        if (w !== undefined && stopWords.has(w)) {
            return false;
        }
        if (isNameToken(t)) {
            sawContent = true;
            previousWasDot = false;
            if (offset > t.start && offset <= t.end) {
                return true;
            }
            continue;
        }
        if (punct(text, t) === ".") {
            sawContent = true;
            previousWasDot = true;
            if (offset >= t.end) {
                continue;
            }
        }
        return false;
    }
    return !sawContent || previousWasDot;
}

function tableDefinitionOpen(
    text: string,
    tokens: readonly Token[],
    sketch: StatementSketch,
    offset: number,
): number {
    let tableIndex = -1;
    for (let i = firstSignificantIndex(tokens, sketch); i >= 0 && i < tokens.length; i++) {
        const t = tokens[i];
        if (t.start >= offset || t.start > sketch.span.end || t.kind === TokenKind.EndOfFile) {
            break;
        }
        if (!isTrivia(t.kind) && word(text, t) === "TABLE") {
            tableIndex = i;
            break;
        }
    }
    if (tableIndex < 0) {
        return -1;
    }
    let depth = 0;
    for (let i = tableIndex + 1; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.start >= offset || t.start > sketch.span.end || t.kind === TokenKind.EndOfFile) {
            break;
        }
        if (isTrivia(t.kind)) {
            continue;
        }
        const p = punct(text, t);
        if (p === "(") {
            if (depth === 0) {
                return i;
            }
            depth++;
        } else if (p === ")") {
            depth = Math.max(0, depth - 1);
        }
    }
    return -1;
}

function parenDepthFromOpen(
    tokens: readonly Token[],
    text: string,
    openIndex: number,
    offset: number,
): number {
    let depth = 0;
    for (let i = openIndex; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.start >= offset || t.kind === TokenKind.EndOfFile) {
            break;
        }
        if (isTrivia(t.kind)) {
            continue;
        }
        const p = punct(text, t);
        if (p === "(") {
            depth++;
        } else if (p === ")") {
            depth = Math.max(0, depth - 1);
        }
    }
    return depth;
}

function firstSignificantIndex(tokens: readonly Token[], sketch: StatementSketch): number {
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.start >= sketch.span.start && !isTrivia(t.kind) && t.kind !== TokenKind.EndOfFile) {
            return i;
        }
        if (t.start > sketch.span.end) {
            break;
        }
    }
    return -1;
}

function nextSignificantInSketch(
    tokens: readonly Token[],
    sketch: StatementSketch,
    start: number,
): number {
    for (let i = start; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.start > sketch.span.end || t.kind === TokenKind.EndOfFile) {
            return -1;
        }
        if (!isTrivia(t.kind)) {
            return i;
        }
    }
    return -1;
}

function nextSignificantBeforeOffset(
    tokens: readonly Token[],
    start: number,
    offset: number,
): number {
    for (let i = start; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.start >= offset || t.kind === TokenKind.EndOfFile) {
            return -1;
        }
        if (!isTrivia(t.kind)) {
            return i;
        }
    }
    return -1;
}

function prevSignificant(tokens: readonly Token[], start: number, minInclusive: number): number {
    for (let i = start - 1; i >= minInclusive; i--) {
        if (!isTrivia(tokens[i].kind)) {
            return i;
        }
    }
    return -1;
}

function prevSignificantBeforeOffset(
    tokens: readonly Token[],
    offset: number,
    minInclusive: number,
): number {
    const idx = tokenIndexAt(tokens, Math.max(0, offset - 1));
    let i = idx;
    const t = tokens[idx];
    if (t !== undefined && offset <= t.start) {
        i = idx - 1;
    } else if (t !== undefined && isNameToken(t) && offset > t.start && offset <= t.end) {
        i = idx - 1;
    }
    while (i >= minInclusive && isTrivia(tokens[i].kind)) {
        i--;
    }
    return i >= minInclusive ? i : -1;
}

function tokenAtOffset(tokens: readonly Token[], offset: number): Token | undefined {
    const idx = tokenIndexAt(tokens, Math.max(0, offset - 1));
    return tokens[idx];
}

function word(text: string, token: Token | undefined): string | undefined {
    return token !== undefined && token.kind === TokenKind.Identifier
        ? text.slice(token.start, token.end).toUpperCase()
        : undefined;
}

function punct(text: string, token: Token | undefined): string | undefined {
    return token !== undefined &&
        (token.kind === TokenKind.Punctuation || token.kind === TokenKind.Operator)
        ? text.slice(token.start, token.end)
        : undefined;
}

function isCreateOrAlter(text: string, token: Token): boolean {
    const w = word(text, token);
    return w === "CREATE" || w === "ALTER";
}

function isModuleKind(text: string, token: Token): boolean {
    const w = word(text, token);
    return w === "PROC" || w === "PROCEDURE" || w === "FUNCTION" || w === "VIEW" || w === "TRIGGER";
}

function isDeclareNameAnchor(text: string, token: Token): boolean {
    const w = word(text, token);
    return w === "DECLARE" || punct(text, token) === ",";
}

function isNameToken(token: Token | undefined): boolean {
    return (
        token?.kind === TokenKind.Identifier ||
        token?.kind === TokenKind.BracketedIdentifier ||
        token?.kind === TokenKind.QuotedIdentifier ||
        token?.kind === TokenKind.TempName ||
        token?.kind === TokenKind.GlobalTempName
    );
}
