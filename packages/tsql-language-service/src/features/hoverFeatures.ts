/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { formatSignature, lookupBuiltIn } from "../common/builtInRegistry.js";
import type { ColumnMetadata, MetadataView, ObjectMetadata } from "../metadata/index.js";
import type { DocumentAnalysisSnapshot, LanguageServiceRuntime } from "../runtime/index.js";
import {
    identifierComponentRangeAt,
    multipartIdentifierParts,
    normalizeIdentifier,
    type SemanticSymbol,
} from "../semantics/index.js";
import type { SyntaxSnapshot } from "../syntax/index.js";
import { ancestorOfKind as ancestor } from "../syntax/treeUtilities.js";
import { CatalogFeatureContext } from "./catalogFeatureContext.js";
import { principalHoverMarkdown, qualifiedCatalogName } from "./catalogPresentation.js";
import type { HoverResult } from "./contracts.js";
import { occurrenceRange } from "./featureSnapshotUtilities.js";
import { visibleQuerySources, type BoundQuerySource } from "./querySources.js";
import { isRoutineParameter, syntacticHover } from "./syntacticHover.js";

/** Hover rendering over the same semantic snapshot and pinned catalog used by diagnostics. */
export class HoverFeatureProvider {
    public constructor(
        private readonly _runtime: LanguageServiceRuntime,
        private readonly _catalog: CatalogFeatureContext,
    ) {}

    public hover(uri: string, version: number, offset: number): HoverResult | undefined {
        const snapshot = this._runtime.snapshot(uri, version);
        const view = snapshot.metadata;
        const unavailable = availabilityHover(snapshot.syntax, offset);
        if (unavailable) return unavailable;
        const symbol = snapshot.semantics.symbolAt(offset);
        if (!symbol) {
            return (
                this.catalogHover(snapshot, view, offset) ??
                syntacticHover(snapshot.syntax, offset, describeBuiltInRoutine) ??
                expressionHover(snapshot, offset)
            );
        }
        const object = symbol.object && view.object(symbol.object);
        const type = symbol.type
            ? `\n\nType: \`${symbol.type.displayName}${symbol.type.nullable ? " NULL" : " NOT NULL"}\``
            : "";
        const source = object ? `\n\nSource: \`${qualifiedCatalogName(object)}\`` : "";
        if (object && symbol.kind !== "column") {
            const base = this.objectHover(view, object);
            return {
                range: occurrenceRange(snapshot, offset) ?? symbol.declaration,
                markdown:
                    symbol.kind === "alias" ? `**alias** \`${symbol.name}\`\n\n${base}` : base,
            };
        }
        if (object && symbol.kind === "column") {
            const columns = view.columnState(object.ref);
            const column =
                columns.kind === "loaded"
                    ? columns.value.find((candidate) =>
                          view.nameComparison.equals(candidate.name, symbol.name),
                      )
                    : undefined;
            if (column) {
                return {
                    range: occurrenceRange(snapshot, offset) ?? symbol.declaration,
                    markdown: columnHover(column, { qualifier: object.name, object }),
                };
            }
        }
        return {
            range: occurrenceRange(snapshot, offset) ?? symbol.declaration,
            markdown:
                symbol.kind === "column"
                    ? `**column** \`${symbol.name}\`${type}${source}`
                    : object
                      ? this.objectHover(view, object)
                      : `**${localSymbolKind(snapshot, symbol)}** \`${symbol.name}\`${type}`,
        };
    }

    private objectHover(view: MetadataView, object: ObjectMetadata): string {
        const lines = [
            `**${object.system ? "system " : ""}${object.kind}** \`${qualifiedCatalogName(object)}\``,
        ];
        if (object.extendedProperties?.length) {
            lines.push(extendedPropertiesMarkdown(object.extendedProperties));
        }
        if (["table", "view", "tableFunction"].includes(object.kind)) {
            const columns = view.columnState(object.ref);
            if (columns.kind === "loaded") {
                lines.push(`Columns: **${columns.value.length}**`);
                if (columns.value.length > 0) {
                    lines.push(
                        columns.value
                            .slice(0, 12)
                            .map(
                                (column) =>
                                    `- \`${column.name}\` — \`${column.typeDisplay ?? "unknown"}${
                                        column.nullable === undefined
                                            ? ""
                                            : column.nullable
                                              ? " NULL"
                                              : " NOT NULL"
                                    }\``,
                            )
                            .join("\n") + (columns.value.length > 12 ? "\n- …" : ""),
                    );
                }
            } else {
                this._catalog.hydrate(
                    { section: "columns", object: object.ref, priority: "interactive" },
                    "hover",
                );
            }
        }
        if (["procedure", "scalarFunction", "tableFunction"].includes(object.kind)) {
            const parameters = view.parameterState(object.ref);
            if (parameters.kind === "loaded" && parameters.value.length > 0) {
                lines.push(
                    `Signature: \`${object.name}(${parameters.value
                        .map(
                            (parameter) =>
                                `${parameter.name || `#${parameter.ordinal}`} ${parameter.typeDisplay ?? "unknown"}${
                                    parameter.output ? " OUTPUT" : ""
                                }`,
                        )
                        .join(", ")})\``,
                );
            } else if (parameters.kind !== "loaded") {
                this._catalog.hydrate(
                    { section: "parameters", object: object.ref, priority: "interactive" },
                    "hover",
                );
            }
        }
        return lines.join("\n\n");
    }

    private catalogHover(
        snapshot: DocumentAnalysisSnapshot,
        view: MetadataView,
        offset: number,
    ): HoverResult | undefined {
        const leaf = snapshot.syntax.nodeAt(offset);
        const columnNode = ancestor(leaf, ["ColumnReference"]);
        const query = ancestor(leaf, ["QuerySpecification"]);
        if (columnNode && query) {
            const parts = multipartIdentifierParts(
                snapshot.text.text.slice(columnNode.start, columnNode.end),
            );
            const columnName = parts.at(-1);
            const qualifier = parts.length > 1 ? parts.at(-2) : undefined;
            const matches: {
                readonly column: ColumnMetadata;
                readonly source: BoundQuerySource;
            }[] = [];
            for (const source of visibleQuerySources(snapshot, view, query)) {
                if (qualifier && !view.nameComparison.equals(source.qualifier, qualifier)) continue;
                const columns = source.columns
                    ? { value: source.columns, incomplete: false }
                    : this._catalog.columns(view, source.object!, "hover");
                for (const column of columns.value ?? []) {
                    if (columnName && view.nameComparison.equals(column.name, columnName)) {
                        matches.push({ column, source });
                    }
                }
            }
            if (matches.length === 1) {
                const match = matches[0]!;
                return {
                    range: { start: columnNode.start, end: columnNode.end },
                    markdown: columnHover(match.column, match.source),
                };
            }
        }
        const node = ancestor(leaf, ["MultipartIdentifier", "IdentifierName"]);
        const range = node
            ? { start: node.start, end: node.end }
            : identifierRangeAt(snapshot.text.text, offset);
        if (!range) return undefined;
        const source = snapshot.text.text.slice(range.start, range.end);
        const parts = multipartIdentifierParts(source);
        const resolution = view.resolveObject(parts);
        if (resolution.kind === "resolved") {
            return { range, markdown: this.objectHover(view, resolution.object) };
        }
        const name = normalizeIdentifier(parts.at(-1) ?? source);
        const principal = view
            .searchPrincipals({ prefix: name, limit: 20 })
            .find((candidate) => view.nameComparison.equals(candidate.name, name));
        if (principal) return { range, markdown: principalHoverMarkdown(principal) };
        const schema = (view.schemas() ?? []).find((candidate) =>
            view.nameComparison.equals(candidate.name, name),
        );
        if (schema) {
            return {
                range,
                markdown: `**schema** \`${[schema.database, schema.name].filter(Boolean).join(".")}\``,
            };
        }
        const database = (view.databases() ?? []).find((candidate) =>
            view.nameComparison.equals(candidate.name, name),
        );
        return database ? { range, markdown: `**database** \`${database.name}\`` } : undefined;
    }
}

function expressionHover(
    snapshot: DocumentAnalysisSnapshot,
    offset: number,
): HoverResult | undefined {
    if (ancestor(snapshot.syntax.nodeAt(offset), ["Literal"])) return undefined;
    const type = snapshot.semantics.model.typeAt(offset);
    if (!type || type.confidence === "unknown") return undefined;
    const nullability = type.nullable ? "NULL" : "NOT NULL";
    const category = type.category === "scalar" ? "" : ` (${type.category})`;
    return {
        markdown: `**expression**\n\nType: \`${type.displayName} ${nullability}\`${category}`,
    };
}

function availabilityHover(syntax: SyntaxSnapshot, offset: number): HoverResult | undefined {
    const diagnostic = syntax.diagnostics.find(
        (candidate) =>
            candidate.availability !== undefined &&
            candidate.range.start <= offset &&
            offset <= candidate.range.end,
    );
    if (!diagnostic?.availability) return undefined;
    return {
        range: diagnostic.range,
        markdown: `**${diagnostic.availability.displayName}**\n\n${diagnostic.message}`,
    };
}

function columnHover(column: ColumnMetadata, source: BoundQuerySource): string {
    const nullability =
        column.nullable === undefined ? "" : column.nullable ? " NULL" : " NOT NULL";
    const details = `**column** \`${column.name}\`\n\nType: \`${
        column.typeDisplay ?? "unknown"
    }${nullability}\`\n\nSource: \`${
        source.object ? qualifiedCatalogName(source.object) : source.qualifier
    }\``;
    return column.extendedProperties?.length
        ? `${details}\n\n${extendedPropertiesMarkdown(column.extendedProperties)}`
        : details;
}

function extendedPropertiesMarkdown(
    properties: readonly { readonly name: string; readonly value: string }[],
): string {
    return properties.map((property) => `**${property.name}**: ${property.value}`).join("\n\n");
}

function identifierRangeAt(
    text: string,
    offset: number,
): { readonly start: number; readonly end: number } | undefined {
    const { start, end } = identifierComponentRangeAt(text, offset);
    return end > start ? { start, end } : undefined;
}

function localSymbolKind(snapshot: DocumentAnalysisSnapshot, symbol: SemanticSymbol): string {
    if (
        symbol.kind === "variable" &&
        symbol.declaration &&
        isRoutineParameter(snapshot.syntax, symbol.declaration)
    ) {
        return "parameter";
    }
    return symbol.kind;
}

function describeBuiltInRoutine(name: string): string | undefined {
    const signature = lookupBuiltIn(name, "routine")?.signatures?.[0];
    if (!signature) return undefined;
    const returns = signature.returnType ? ` Returns \`${signature.returnType}\`.` : "";
    return `\`${formatSignature(name, signature)}\`\n\n${signature.documentation}${returns}`;
}
