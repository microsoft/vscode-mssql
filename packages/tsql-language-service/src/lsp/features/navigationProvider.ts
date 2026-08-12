/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DocumentHighlightKind,
    type DocumentHighlight,
    type Location,
    type Position,
    type Range,
    type WorkspaceEdit,
} from "vscode-languageserver-types";
import type { SqlReferences } from "../../analysis/contracts.js";
import {
    offsetAt,
    type SqlFeatureDocument,
    type SqlFeatureDocumentAccessor,
} from "./featureDocument.js";
import { compareRanges, normalizeOccurrence, spanToRange } from "./rangeUtils.js";

export class SqlNavigationProvider {
    public constructor(private readonly documents: SqlFeatureDocumentAccessor) {}

    public async findDefinition(uri: string, position: Position): Promise<Location | undefined> {
        const document = await this.documents.getDocument(uri);
        if (!document) {
            return undefined;
        }
        const offset = offsetAt(document, position);
        const symbol = document.analysis.symbolAt(offset);
        const declaration =
            symbol?.definition ?? document.analysis.referencesAt(offset)?.declaration;
        return declaration
            ? { uri: document.uri, range: spanToRange(document, declaration) }
            : undefined;
    }

    public async findReferences(
        uri: string,
        position: Position,
        includeDeclaration = true,
    ): Promise<Location[]> {
        const document = await this.documents.getDocument(uri);
        const target = document ? this.targetAt(document, position) : undefined;
        return document && target
            ? this.normalizedOccurrences(document, target)
                  .filter((item) => includeDeclaration || item.role !== "declaration")
                  .map((item) => ({ uri: document.uri, range: item.range }))
            : [];
    }

    public async getDocumentHighlights(
        uri: string,
        position: Position,
    ): Promise<DocumentHighlight[] | undefined> {
        const document = await this.documents.getDocument(uri);
        const target = document ? this.targetAt(document, position) : undefined;
        if (!document || !target) {
            return undefined;
        }
        const highlights = this.normalizedOccurrences(document, target).map((item) => ({
            range: item.range,
            kind:
                item.role === "declaration"
                    ? DocumentHighlightKind.Write
                    : DocumentHighlightKind.Read,
        }));
        return highlights.length > 0 ? highlights : undefined;
    }

    public async prepareRename(uri: string, position: Position): Promise<Range | undefined> {
        const document = await this.documents.getDocument(uri);
        const target = document ? this.targetAt(document, position) : undefined;
        if (!document || !target || !this.canRename(target)) {
            return undefined;
        }
        const offset = offsetAt(document, position);
        return this.normalizedOccurrences(document, target).find(
            (item) => item.start <= offset && offset < item.end,
        )?.range;
    }

    public async rename(
        uri: string,
        position: Position,
        newName: string,
    ): Promise<WorkspaceEdit | undefined> {
        const document = await this.documents.getDocument(uri);
        if (!document || !this.isValidNewName(document, newName)) {
            return undefined;
        }
        const target = this.targetAt(document, position);
        if (!target || !this.canRename(target)) {
            return undefined;
        }
        const occurrences = this.normalizedOccurrences(document, target);
        return occurrences.length > 0
            ? {
                  changes: {
                      [document.uri]: occurrences.map((item) => ({
                          range: item.range,
                          newText: renderReplacement(item.sourceText, newName),
                      })),
                  },
              }
            : undefined;
    }

    private targetAt(document: SqlFeatureDocument, position: Position): SqlReferences | undefined {
        return document.analysis.referencesAt(offsetAt(document, position));
    }

    private normalizedOccurrences(document: SqlFeatureDocument, target: SqlReferences) {
        const symbols = document.analysis.symbols();
        const deduped = new Map<string, ReturnType<typeof normalizeOccurrence>>();
        for (const occurrence of target.occurrences) {
            const item = normalizeOccurrence(
                document,
                occurrence,
                target.symbol,
                target.kind,
                symbols,
            );
            if (!item) {
                continue;
            }
            const key = `${item.start}:${item.end}`;
            const existing = deduped.get(key);
            if (!existing || occurrence.role === "declaration") {
                deduped.set(key, item);
            }
        }
        return [...deduped.values()]
            .filter((item): item is NonNullable<typeof item> => item !== undefined)
            .map((item) => ({ ...item, role: item.occurrence.role }))
            .sort((left, right) => compareRanges(left.range, right.range));
    }

    private canRename(target: SqlReferences): boolean {
        if (!target.occurrences.some((occurrence) => occurrence.role === "declaration")) {
            return false;
        }
        return !["table", "function", "procedure", "type"].includes(target.kind);
    }

    private isValidNewName(document: SqlFeatureDocument, newName: string): boolean {
        const trimmed = newName.trim();
        if (trimmed !== newName || trimmed.length === 0) {
            return false;
        }
        if (/^\[(?:[^\]]|\]\])+\]$/.test(trimmed) || /^"(?:[^"]|"")+"$/.test(trimmed)) {
            return true;
        }
        const bare = trimmed.replace(/^[@#]+/, "");
        return (
            /^[A-Za-z_][A-Za-z0-9_@$#]*$/.test(bare) && !document.analysis.isReservedKeyword(bare)
        );
    }
}

function renderReplacement(sourceText: string, newName: string): string {
    const explicitDelimiter = newName.startsWith("[") || newName.startsWith('"');
    if (!explicitDelimiter && sourceText.startsWith("[") && sourceText.endsWith("]")) {
        const escaped = newName.replace(/\]/g, "]]");
        return `[${escaped}]`;
    }
    if (!explicitDelimiter && sourceText.startsWith('"') && sourceText.endsWith('"')) {
        return `"${newName.replace(/"/g, '""')}"`;
    }
    const sigil = /^[@#]+/.exec(sourceText)?.[0];
    return sigil && !/^[@#]/.test(newName) ? sigil + newName : newName;
}
