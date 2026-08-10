/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InlayHintKind, type InlayHint, type Range } from "vscode-languageserver-types";
import type { SqlSymbol, SqlType } from "../../analysis/contracts.js";
import {
    positionAt,
    type SqlFeatureDocument,
    type SqlFeatureDocumentAccessor,
} from "./featureDocument.js";
import { offsetsToRange, rangeIntersects } from "./rangeUtils.js";

export interface SqlInlayHintOptions {
    readonly showOutputTypes?: boolean;
    readonly showAliasTargets?: boolean;
}

/** Conservative SQL hints: inferred output types and alias targets, never redundant declarations. */
export class SqlInlayHintProvider {
    public constructor(
        private readonly documents: SqlFeatureDocumentAccessor,
        private readonly options: SqlInlayHintOptions = {},
    ) {}

    public async getInlayHints(uri: string, range: Range): Promise<InlayHint[]> {
        const document = await this.documents.getDocument(uri);
        if (!document) {
            return [];
        }
        const hints: InlayHint[] = [];
        for (const symbol of document.analysis.symbols()) {
            const symbolRange = offsetsToRange(document, symbol.span.start, symbol.span.end);
            if (!rangeIntersects(range, symbolRange)) {
                continue;
            }
            if (this.options.showAliasTargets !== false) {
                const aliasHint = aliasTargetHint(document, symbol);
                if (aliasHint) {
                    hints.push(aliasHint);
                }
            }
            if (this.options.showOutputTypes !== false) {
                const typeHint = outputTypeHint(document, symbol);
                if (typeHint) {
                    hints.push(typeHint);
                }
            }
        }
        return dedupeHints(hints);
    }
}

function aliasTargetHint(document: SqlFeatureDocument, symbol: SqlSymbol): InlayHint | undefined {
    if (symbol.kind !== "alias" || !symbol.source?.name || symbol.source.name === symbol.name) {
        return undefined;
    }
    return {
        position: positionAt(document, symbol.span.end),
        label: ` → ${symbol.source.name}`,
        kind: InlayHintKind.Type,
        paddingLeft: true,
        tooltip: `Alias for ${symbol.source.name}`,
    };
}

function outputTypeHint(document: SqlFeatureDocument, symbol: SqlSymbol): InlayHint | undefined {
    if (
        symbol.kind !== "column" ||
        !symbol.modifiers.includes("output") ||
        !symbol.modifiers.includes("declaration") ||
        !isKnownType(symbol.type)
    ) {
        return undefined;
    }
    const following = document.text.slice(
        symbol.span.end,
        symbol.span.end + symbol.type.display.length + 3,
    );
    if (following.includes(symbol.type.display)) {
        return undefined;
    }
    return {
        position: positionAt(document, symbol.span.end),
        label: `: ${symbol.type.display}`,
        kind: InlayHintKind.Type,
        paddingLeft: true,
        tooltip: `Inferred SQL type: ${symbol.type.display}`,
    };
}

function isKnownType(type: SqlType | undefined): type is Exclude<SqlType, { kind: "unknown" }> {
    return Boolean(type && type.kind !== "unknown");
}

function dedupeHints(hints: readonly InlayHint[]): InlayHint[] {
    const seen = new Set<string>();
    return hints
        .filter((hint) => {
            const label = typeof hint.label === "string" ? hint.label : JSON.stringify(hint.label);
            const key = `${hint.position.line}:${hint.position.character}:${label}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        })
        .sort(
            (left, right) =>
                left.position.line - right.position.line ||
                left.position.character - right.position.character,
        );
}
