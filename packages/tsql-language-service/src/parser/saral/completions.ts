/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import { type ASTNode } from "./ast/types.js";
import { findNodeAt } from "./ast/astWalker.js";
import { analyze, type AnalysisDiagnostic, type AnalysisResult } from "./analyze.js";
import { offsetToPosition, type Position, positionToOffset } from "./position.js";
import { Scope, type Symbol, SymbolKind } from "./semantic/scope.js";

export type CompletionItemKind =
    | "keyword"
    | "variable"
    | "table"
    | "column"
    | "alias"
    | "function"
    | "procedure"
    | "type"
    | "cte"
    | "text";

export interface CompletionContext {
    offset: number;
    position: Position;
    prefix: string;
    node: ASTNode | null;
    scope: Scope;
    visibleSymbols: Symbol[];
    diagnostics: AnalysisDiagnostic[];
    keywords: string[];
}

export interface CompletionItem {
    label: string;
    kind: CompletionItemKind;
    detail?: string;
    start: number;
    end: number;
}

const KEYWORDS = [
    "SELECT",
    "FROM",
    "WHERE",
    "JOIN",
    "INNER",
    "LEFT",
    "RIGHT",
    "FULL",
    "CROSS",
    "APPLY",
    "ON",
    "GROUP",
    "BY",
    "HAVING",
    "ORDER",
    "INSERT",
    "UPDATE",
    "DELETE",
    "DECLARE",
    "SET",
    "CREATE",
    "TABLE",
    "VIEW",
    "PROCEDURE",
    "FUNCTION",
    "WITH",
    "AS",
    "CASE",
    "WHEN",
    "THEN",
    "ELSE",
    "END",
    "AND",
    "OR",
    "NOT",
    "NULL",
    "IN",
    "BETWEEN",
    "LIKE",
    "EXISTS",
    "UNION",
    "EXCEPT",
    "INTERSECT",
];

export function getCompletionContext(
    sql: string,
    positionOrOffset: Position | number,
    analysis?: AnalysisResult,
): CompletionContext {
    return getCompletionContextFromAnalysis(sql, analysis ?? analyze(sql), positionOrOffset);
}

/** Builds completion context from an existing analysis without lexing or parsing again. */
export function getCompletionContextFromAnalysis(
    sql: string,
    analysis: AnalysisResult,
    positionOrOffset: Position | number,
): CompletionContext {
    const offset =
        typeof positionOrOffset === "number"
            ? clamp(positionOrOffset, 0, sql.length)
            : positionToOffset(sql, positionOrOffset);

    const position =
        typeof positionOrOffset === "number" ? offsetToPosition(sql, offset) : positionOrOffset;

    const scope = analysis.scope.root.findInnermost(offset);
    const prefix = getPrefix(sql, offset);

    return {
        offset,
        position,
        prefix,
        node: findNodeAt(analysis.ast, offset),
        scope,
        visibleSymbols: scope.getVisibleSymbols(),
        diagnostics: analysis.diagnostics,
        keywords: KEYWORDS,
    };
}

export function getCompletionsAt(
    sql: string,
    positionOrOffset: Position | number,
    analysis?: AnalysisResult,
): CompletionItem[] {
    return getCompletionsAtFromAnalysis(sql, analysis ?? analyze(sql), positionOrOffset);
}

/** Produces completion items from an existing analysis without lexing or parsing again. */
export function getCompletionsAtFromAnalysis(
    sql: string,
    analysis: AnalysisResult,
    positionOrOffset: Position | number,
): CompletionItem[] {
    const context = getCompletionContextFromAnalysis(sql, analysis, positionOrOffset);
    const seen = new Set<string>();
    const items: CompletionItem[] = [];
    const qualified = getQualifiedPrefix(context.prefix);

    if (qualified) {
        const aliasSymbol = context.scope.resolve(qualified.qualifier);
        const columns = getQualifiedSymbolColumns(aliasSymbol, context.scope);

        if (columns) {
            const replaceStart = context.offset - qualified.filter.length;

            for (const column of columns) {
                pushCompletion(
                    items,
                    seen,
                    {
                        label: column,
                        kind: "column",
                        start: replaceStart,
                        end: context.offset,
                    },
                    qualified.filter,
                );
            }

            return items.sort((a, b) => a.label.localeCompare(b.label));
        }
    }

    const replaceStart = context.offset - context.prefix.length;

    for (const keyword of context.keywords) {
        pushCompletion(
            items,
            seen,
            {
                label: keyword,
                kind: "keyword",
                start: replaceStart,
                end: context.offset,
            },
            context.prefix,
        );
    }

    for (const symbol of context.visibleSymbols) {
        pushCompletion(
            items,
            seen,
            {
                label: symbol.name,
                kind: symbolKindToCompletionKind(symbol.kind),
                detail: symbol.dataType ?? symbol.kind,
                start: replaceStart,
                end: context.offset,
            },
            context.prefix,
        );
    }

    return items.sort((a, b) => {
        if (a.kind === b.kind) return a.label.localeCompare(b.label);
        if (a.kind === "keyword") return 1;
        if (b.kind === "keyword") return -1;
        return a.kind.localeCompare(b.kind);
    });
}

function getQualifiedPrefix(prefix: string): { qualifier: string; filter: string } | null {
    const dotIndex = prefix.lastIndexOf(".");
    if (dotIndex < 1) {
        return null;
    }

    return {
        qualifier: prefix.slice(0, dotIndex),
        filter: prefix.slice(dotIndex + 1),
    };
}

function getQualifiedSymbolColumns(symbol: Symbol | undefined, scope: Scope): string[] | null {
    if (!symbol) {
        return null;
    }

    if (symbol.columns && symbol.columns.length > 0) {
        return symbol.columns;
    }

    if (
        symbol.kind === "Alias" &&
        symbol.metadata?.tableName &&
        typeof symbol.metadata.tableName === "string"
    ) {
        const tableSymbol = scope.resolve(symbol.metadata.tableName);
        if (tableSymbol?.columns && tableSymbol.columns.length > 0) {
            return tableSymbol.columns;
        }
    }

    return null;
}

function pushCompletion(
    items: CompletionItem[],
    seen: Set<string>,
    item: CompletionItem,
    prefix: string,
): void {
    if (prefix && !item.label.toLowerCase().startsWith(prefix.toLowerCase())) {
        return;
    }

    const key = `${item.kind}:${item.label.toLowerCase()}`;
    if (seen.has(key)) return;

    seen.add(key);
    items.push(item);
}

function symbolKindToCompletionKind(kind: SymbolKind): CompletionItemKind {
    switch (kind) {
        case SymbolKind.Variable:
        case SymbolKind.Parameter:
            return "variable";
        case SymbolKind.Table:
        case SymbolKind.TempTable:
            return "table";
        case SymbolKind.Column:
            return "column";
        case SymbolKind.Alias:
            return "alias";
        case SymbolKind.CTE:
            return "cte";
        case SymbolKind.Function:
            return "function";
        case SymbolKind.Procedure:
            return "procedure";
        case SymbolKind.Type:
            return "type";
        default:
            return "text";
    }
}

function getPrefix(sql: string, offset: number): string {
    let start = offset;

    while (start > 0 && /[a-zA-Z0-9_@#\[\].]/.test(sql[start - 1])) {
        start--;
    }

    return sql.slice(start, offset);
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}
