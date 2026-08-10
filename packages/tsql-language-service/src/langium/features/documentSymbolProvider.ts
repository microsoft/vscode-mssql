/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SymbolKind, type DocumentSymbol, type Range } from "vscode-languageserver-types";
import type { SqlSymbol } from "../../analysis/contracts.js";
import type { SqlFeatureDocument, SqlFeatureDocumentAccessor } from "./featureDocument.js";
import { spanToRange } from "./rangeUtils.js";

export class SqlDocumentSymbolProvider {
    public constructor(private readonly documents: SqlFeatureDocumentAccessor) {}

    public async getSymbols(uri: string): Promise<DocumentSymbol[]> {
        const document = await this.documents.getDocument(uri);
        if (!document) {
            return [];
        }
        const declarations = document.analysis
            .symbols()
            .filter(
                (symbol) =>
                    isOutlineDeclaration(symbol) && symbol.span.start < document.text.length,
            )
            .sort(
                (left, right) =>
                    left.span.start - right.span.start || left.span.end - right.span.end,
            );
        const entries = declarations.map((symbol) => ({
            frame: symbol.frame,
            symbol: this.createSymbol(document, symbol),
            sqlSymbol: symbol,
        }));
        const ownersByName = new Map<string, typeof entries>();
        for (const entry of entries) {
            if (isFrameOwner(entry.sqlSymbol)) {
                const owners = ownersByName.get(entry.sqlSymbol.name) ?? [];
                owners.push(entry);
                ownersByName.set(entry.sqlSymbol.name, owners);
            }
        }
        const roots: DocumentSymbol[] = [];
        for (const entry of entries) {
            const parent = (ownersByName.get(entry.frame) ?? [])
                .filter(
                    (candidate) =>
                        candidate !== entry &&
                        candidate.sqlSymbol.span.start <= entry.sqlSymbol.span.start,
                )
                .sort((left, right) => right.sqlSymbol.span.start - left.sqlSymbol.span.start)[0];
            if (parent) {
                (parent.symbol.children ??= []).push(entry.symbol);
            } else {
                roots.push(entry.symbol);
            }
        }
        roots.forEach(expandContainerRange);
        return roots;
    }

    private createSymbol(document: SqlFeatureDocument, symbol: SqlSymbol): DocumentSymbol {
        const selectionRange = spanToRange(document, symbol.span);
        return {
            name: symbol.name,
            detail: detailFor(symbol),
            kind: protocolKind(symbol),
            range: this.containerRange(document, symbol, selectionRange),
            selectionRange,
        };
    }

    private containerRange(
        document: SqlFeatureDocument,
        symbol: SqlSymbol,
        fallback: Range,
    ): Range {
        const declaration = isFrameOwner(symbol)
            ? document.analysis.referencesAt(symbol.span.start)?.declaration
            : undefined;
        return declaration ? spanToRange(document, declaration) : fallback;
    }
}

function expandContainerRange(symbol: DocumentSymbol): Range {
    for (const child of symbol.children ?? []) {
        const childRange = expandContainerRange(child);
        if (comparePosition(childRange.start, symbol.range.start) < 0) {
            symbol.range.start = childRange.start;
        }
        if (comparePosition(childRange.end, symbol.range.end) > 0) {
            symbol.range.end = childRange.end;
        }
    }
    return symbol.range;
}

function comparePosition(
    left: { readonly line: number; readonly character: number },
    right: { readonly line: number; readonly character: number },
): number {
    return left.line - right.line || left.character - right.character;
}

function isOutlineDeclaration(symbol: SqlSymbol): boolean {
    return (
        symbol.modifiers.includes("declaration") &&
        symbol.kind !== "alias" &&
        symbol.span.end > symbol.span.start
    );
}

function isFrameOwner(symbol: SqlSymbol): boolean {
    return symbol.kind === "cte" || symbol.kind === "subquery" || symbol.kind === "lateral";
}

function protocolKind(symbol: SqlSymbol): SymbolKind {
    switch (symbol.kind) {
        case "table":
        case "tempTable":
            return SymbolKind.Class;
        case "cte":
        case "subquery":
        case "lateral":
            return SymbolKind.Struct;
        case "column":
            return SymbolKind.Field;
        case "function":
            return SymbolKind.Function;
        case "procedure":
            return SymbolKind.Method;
        case "parameter":
            return SymbolKind.TypeParameter;
        case "type":
            return SymbolKind.TypeParameter;
        case "variable":
        case "alias":
            return SymbolKind.Variable;
    }
}

function detailFor(symbol: SqlSymbol): string {
    return symbol.kind === "column" && symbol.modifiers.includes("output")
        ? "output column"
        : symbol.kind;
}
