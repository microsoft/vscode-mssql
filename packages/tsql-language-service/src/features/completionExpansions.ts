/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { MetadataView } from "../metadata/index.js";
import type { DocumentAnalysisSnapshot } from "../runtime/index.js";
import { multipartIdentifierParts, normalizeIdentifier } from "../semantics/index.js";
import type { SyntaxNode } from "../syntax/index.js";
import {
    ancestorOfKind as ancestor,
    descendantsOfKind as descendants,
    firstDescendantOfKind as firstDescendant,
    sameSyntaxNode,
} from "../syntax/treeUtilities.js";
import { CatalogFeatureContext } from "./catalogFeatureContext.js";
import { qualifiedCatalogName } from "./catalogPresentation.js";
import type { CompletionItem } from "./contracts.js";
import { quoteIdentifier } from "./identifierFormatting.js";
import { querySourcesWithin, visibleQuerySources } from "./querySources.js";

export interface CompletionExpansionResult {
    readonly item?: CompletionItem;
    readonly incomplete: boolean;
}

/**
 * Smart SELECT-star and INSERT expansion over one published syntax/semantic/catalog snapshot.
 *
 * The small text recognizers below only consume punctuation and whitespace around an already
 * identified syntax node. They deliberately do not classify a SQL clause or parse an identifier.
 */
export class CompletionExpansionProvider {
    public constructor(private readonly _catalog: CatalogFeatureContext) {}

    public star(
        snapshot: DocumentAnalysisSnapshot,
        view: MetadataView,
        offset: number,
    ): CompletionExpansionResult {
        const text = snapshot.text.text;
        const expansionSite = selectExpansionStar(snapshot, offset);
        if (!expansionSite) return { incomplete: false };
        const { star, query } = expansionSite;
        const ownSources = querySourcesWithin(snapshot, view, query);
        const sourcePrefix = sourcePrefixForStar(text.slice(star.start, star.end));
        if (ownSources.length === 0 && sourcePrefix === undefined) return { incomplete: false };
        const ownSelected = sourcePrefix
            ? ownSources.filter((source) =>
                  view.nameComparison.equals(source.qualifier, sourcePrefix),
              )
            : ownSources;
        const selected =
            sourcePrefix && ownSelected.length === 0
                ? visibleQuerySources(snapshot, view, query).filter((source) =>
                      view.nameComparison.equals(source.qualifier, sourcePrefix),
                  )
                : ownSelected;
        if (selected.length === 0) return { incomplete: false };
        const expanded: string[] = [];
        let incomplete = false;
        for (const source of selected) {
            const columns = source.columns
                ? { value: source.columns, incomplete: false }
                : this._catalog.columns(view, source.object!, "completion");
            incomplete ||= columns.incomplete;
            if (!columns.value) continue;
            const qualify = sourcePrefix !== undefined || selected.length > 1;
            for (const column of columns.value) {
                if (column.hidden) continue;
                expanded.push(
                    qualify
                        ? `${quoteIdentifier(source.qualifier)}.${quoteIdentifier(column.name)}`
                        : quoteIdentifier(column.name),
                );
            }
        }
        if (expanded.length === 0) return { incomplete };
        return {
            incomplete,
            item: {
                label: "Expand SELECT *",
                kind: "snippet",
                detail: `${expanded.length} columns from ${selected.map((source) => (source.object ? qualifiedCatalogName(source.object) : source.qualifier)).join(", ")}`,
                sortText: "0000-expand-select-star",
                filterText: "*",
                preselect: true,
                edit: {
                    start: star.start,
                    end: star.end,
                    newText: formatColumnList(expanded, lineIndent(snapshot.text.text, star.start)),
                },
            },
        };
    }

    public insert(
        snapshot: DocumentAnalysisSnapshot,
        view: MetadataView,
        offset: number,
    ): CompletionExpansionResult {
        const statement = ancestor(snapshot.syntax.nodeAt(offset), ["InsertStatement"]);
        if (!statement) return { incomplete: false };
        const source = firstDescendant(statement, "InsertSource");
        if (source && !isEmptyInsertSource(snapshot.text.text, source)) {
            return { incomplete: false };
        }
        const target = firstDescendant(statement, "DmlTarget");
        const name = target && firstDescendant(target, "MultipartIdentifier");
        if (!name || offset < name.end) return { incomplete: false };
        const columnList = firstDescendant(statement, "InsertColumnList");
        const suppliedColumns = columnList
            ? descendants(columnList, "MultipartIdentifier")
            : descendants(target, "ColumnReference").filter((column) => column.start >= name.end);
        if (suppliedColumns.length > 0) return { incomplete: false };
        const resolution = view.resolveObject(
            multipartIdentifierParts(snapshot.text.text.slice(name.start, name.end)),
        );
        if (resolution.kind !== "resolved") return { incomplete: false };
        const columns = this._catalog.columns(view, resolution.object, "completion");
        if (!columns.value) return { incomplete: columns.incomplete };
        const insertable = columns.value.filter((column) => !column.identity && !column.computed);
        if (insertable.length === 0) return { incomplete: columns.incomplete };
        const indent = lineIndent(snapshot.text.text, statement.start);
        const childIndent = `${indent}    `;
        const names = insertable.map((column) => `${childIndent}${quoteIdentifier(column.name)}`);
        const values = insertable.map((_column, index) => `${childIndent}\${${index + 1}:NULL}`);
        const existingList = insertExpansionListContext(snapshot.text.text, name.end, offset);
        const editStart = existingList ? offset : name.end;
        const cleanupEnd = existingList
            ? insertExpansionEnd(snapshot.text.text, offset)
            : insertCleanupEnd(snapshot.text.text, name.end);
        const opening = existingList ? "" : " (";
        return {
            incomplete: columns.incomplete,
            item: {
                label: "Expand INSERT columns and VALUES",
                kind: "snippet",
                detail: `${insertable.length} insertable columns from ${qualifiedCatalogName(resolution.object)}`,
                sortText: "0001-expand-insert",
                filterText: "columns values",
                insertTextFormat: "snippet",
                preselect: true,
                command: {
                    command: "editor.action.triggerParameterHints",
                    title: "Show INSERT value hints",
                },
                edit: {
                    start: editStart,
                    end: cleanupEnd,
                    newText: `${opening}\n${names.join(",\n")}\n${indent})\n${indent}VALUES (\n${values.join(",\n")}\n${indent});\$0`,
                },
            },
        };
    }
}

function formatColumnList(columns: readonly string[], indent: string): string {
    if (columns.length <= 4) return columns.join(", ");
    const childIndent = `${indent}    `;
    return columns.map((column) => `${childIndent}${column}`).join(",\n");
}

function sourcePrefixForStar(text: string): string | undefined {
    const dot = text.lastIndexOf(".");
    return dot < 0 ? undefined : normalizeIdentifier(text.slice(0, dot).trim());
}

function insertCleanupEnd(text: string, start: number): number {
    let cursor = start;
    let consumedEnd = start;
    while (cursor < text.length) {
        while (cursor < text.length && isWhitespace(text[cursor]!)) cursor++;
        const character = text[cursor];
        if (character === "(") {
            cursor++;
            while (cursor < text.length && isWhitespace(text[cursor]!)) cursor++;
            if (text[cursor] === ")") cursor++;
            consumedEnd = cursor;
            continue;
        }
        if (character === ")" || character === ";") {
            consumedEnd = ++cursor;
            continue;
        }
        break;
    }
    return consumedEnd;
}

function isWhitespace(character: string): boolean {
    return character.trim().length === 0;
}

function insertExpansionListContext(text: string, targetEnd: number, offset: number): boolean {
    if (offset < targetEnd) return false;
    return /^\s*\(\s*$/u.test(text.slice(targetEnd, offset));
}

function isEmptyInsertSource(text: string, source: SyntaxNode): boolean {
    return /^values\s*\(\s*\)?$/iu.test(text.slice(source.start, source.end).trim());
}

function insertExpansionEnd(text: string, start: number): number {
    const suffix = text.slice(start);
    const targetClose = /^\s*\)/u.exec(suffix);
    if (!targetClose) return start;

    let consumed = targetClose[0].length;
    const afterTarget = suffix.slice(consumed);
    const emptyValues = /^\s*values\s*\(\s*\)(?:[ \t]*;)?/iu.exec(afterTarget);
    if (emptyValues) consumed += emptyValues[0].length;
    else consumed += /^(?:[ \t]*;)?/u.exec(afterTarget)?.[0].length ?? 0;
    return start + consumed;
}

function lineIndent(text: string, offset: number): string {
    const lineStart =
        Math.max(text.lastIndexOf("\n", offset - 1), text.lastIndexOf("\r", offset - 1)) + 1;
    return /^\s*/u.exec(text.slice(lineStart, offset))?.[0] ?? "";
}

function selectExpansionStar(
    snapshot: DocumentAnalysisSnapshot,
    offset: number,
): { readonly star: SyntaxNode; readonly query: SyntaxNode } | undefined {
    const text = snapshot.text.text;
    const adjacentOffset =
        text[offset - 1] === "*" ? offset - 1 : text[offset] === "*" ? offset : undefined;
    if (adjacentOffset !== undefined) {
        const adjacent = expansionStar(
            ancestor(snapshot.syntax.nodeAt(adjacentOffset + 1), ["StarExpression", "Star"]),
        );
        const query = adjacent && ancestor(adjacent, ["QuerySpecification"]);
        if (adjacent && query) return { star: adjacent, query };
    }

    const query = ancestor(snapshot.syntax.nodeAt(offset), ["QuerySpecification"]);
    if (!query) return undefined;
    const candidates = new Map<string, SyntaxNode>();
    for (const candidate of [
        ...descendants(query, "StarExpression"),
        ...descendants(query, "Star"),
    ]) {
        const star = expansionStar(candidate);
        const owner = star && ancestor(star, ["QuerySpecification"]);
        if (!star || !owner || !sameSyntaxNode(owner, query)) continue;
        candidates.set(`${star.start}:${star.end}`, star);
    }
    const nearest = [...candidates.values()].sort(
        (left, right) =>
            distanceToRange(offset, left) - distanceToRange(offset, right) ||
            left.start - right.start,
    )[0];
    return nearest ? { star: nearest, query } : undefined;
}

function expansionStar(node: SyntaxNode | undefined): SyntaxNode | undefined {
    if (!node) return undefined;
    const star = node.kind === "Star" ? (ancestor(node, ["StarExpression"]) ?? node) : node;
    if (!ancestor(star, ["SelectElement"]) || ancestor(star, ["FunctionCall"])) return undefined;
    return star;
}

function distanceToRange(
    offset: number,
    range: { readonly start: number; readonly end: number },
): number {
    if (offset < range.start) return range.start - offset;
    if (offset > range.end) return offset - range.end;
    return 0;
}
