/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    ColumnMetadata,
    MetadataProvider,
    MetadataView,
    ObjectMetadata,
    ParameterMetadata,
    PrincipalMetadata,
    SqlPrincipalKind,
} from "../metadata/index.js";
import type { DocumentAnalysisSnapshot, LanguageServiceRuntime } from "../runtime/index.js";
import {
    builtInsOfKind,
    formatSignature,
    isBuiltInAvailable,
    lookupBuiltIn,
    type BuiltInProfile,
} from "../common/builtInRegistry.js";
import { latestCompatibilityLevel, type TsqlFeatureProfile } from "../common/engineCapabilities.js";
import {
    platformFeatureKeywords,
    platformOnlyKeywords,
} from "../common/platformFeatureRegistry.js";
import {
    multipartIdentifierParts,
    normalizeIdentifier,
    type SemanticSymbol,
} from "../semantics/index.js";
import {
    contextualKeywordNames,
    keywordMetadata,
    reservedKeywordNames,
    type SyntaxNode,
    type SyntaxSnapshot,
} from "../syntax/index.js";
import {
    ancestorOfKind as ancestor,
    descendantsOfKind as descendants,
    directChildOfKind as directChild,
    firstDescendantOfKind as firstDescendant,
    hasDescendantOfKind as hasDescendant,
    lastDescendantOfKind as lastDescendant,
    visitSyntaxTree as visit,
} from "../syntax/treeUtilities.js";
import { collectFoldingRanges, type FoldingRangeOptions } from "./foldingRanges.js";
import {
    completionIdentifierInsertion,
    completionMultipartInsertion,
    completionPrefix,
    type PrefixContext,
} from "./completionPrefix.js";
import { preserveIdentifierQuotes, quoteIdentifier } from "./identifierFormatting.js";
import { isRoutineParameter, syntacticHover } from "./syntacticHover.js";
import {
    builtInSignatureHelp,
    insertSignatureHelp,
    localRoutineAt,
    routineSignatureHelp,
    signatureContext,
} from "./signatureHelp.js";
import type {
    CompletionItem,
    CompletionResult,
    DefinitionTarget,
    DocumentSymbol,
    FoldingRange,
    HoverResult,
    LanguageFeatureService,
    Location,
    SignatureHelp,
    TextEdit,
} from "./contracts.js";

const tableKinds = ["table", "view", "tableFunction", "synonym"] as const;
const emptyDefinitionTarget: DefinitionTarget = Object.freeze({ locations: Object.freeze([]) });
const maximumCatalogItems = 1_000;

/** Host-neutral editor features backed by one versioned runtime snapshot and pinned metadata view. */
export class TsqlLanguageFeatureService implements LanguageFeatureService {
    public constructor(
        private readonly _runtime: LanguageServiceRuntime,
        private readonly _metadata: MetadataProvider,
    ) {}

    public completion(uri: string, version: number, offset: number): CompletionResult {
        const snapshot = this._runtime.snapshot(uri, version);
        assertOffset(snapshot, offset);
        const view = this._metadata.pin();
        const items: CompletionItem[] = [];
        let incomplete = false;

        const star = this.starExpansion(snapshot, view, offset);
        if (star.item) items.push(star.item);
        incomplete ||= star.incomplete;

        const insert = this.insertExpansion(snapshot, view, offset);
        if (insert.item) items.push(insert.item);
        incomplete ||= insert.incomplete;

        const prefix = completionPrefix(snapshot, offset);
        const principalContext = principalCompletionContext(
            snapshot.text.text,
            prefix.contextStart,
        );
        const objectContext = catalogCompletionContext(snapshot.text.text, prefix.contextStart);
        const dataTypeContext = isDataTypeCompletionContext(
            snapshot.text.text,
            prefix.contextStart,
        );
        const source = sourceForQualifier(snapshot, view, offset, prefix.qualifiers);
        if (dataTypeContext) {
            if (prefix.qualifiers.length === 0) {
                items.push(...dataTypeCompletions(prefix, snapshot.syntax.profile));
            }
            const catalog = catalogCompletions(this._metadata, view, prefix, {
                kinds: ["type"],
            });
            items.push(...catalog.items);
            incomplete ||= catalog.incomplete;
        } else if (source) {
            const columns = source.columns
                ? { value: source.columns, incomplete: false }
                : this.columns(view, source.object!);
            incomplete ||= columns.incomplete;
            if (columns.value) {
                items.push(
                    ...columns.value
                        .filter((column) => startsWith(column.name, prefix.prefix, view))
                        .map((column) => columnCompletion(column, source.qualifier, prefix)),
                );
            }
        } else if (principalContext && prefix.qualifiers.length === 0) {
            const principals = principalCompletions(this._metadata, view, prefix, principalContext);
            items.push(...principals.items);
            incomplete ||= principals.incomplete;
        } else if (objectContext) {
            const catalog = catalogCompletions(this._metadata, view, prefix, objectContext);
            items.push(...catalog.items);
            incomplete ||= catalog.incomplete;
            items.push(...localObjectCompletions(snapshot, prefix));
        } else if (isCatalogQualifier(view, prefix.qualifiers)) {
            const catalog = catalogCompletions(this._metadata, view, prefix, {
                kinds: ["scalarFunction", "tableFunction"],
            });
            items.push(...catalog.items);
            incomplete ||= catalog.incomplete;
        } else if (prefix.qualifiers.length === 0) {
            const parameters = this.routineParameterCompletions(snapshot, view, offset, prefix);
            items.push(...parameters.items);
            incomplete ||= parameters.incomplete;
            const sourceColumns = this.unqualifiedSourceCompletions(snapshot, view, offset, prefix);
            items.push(...sourceColumns.items);
            incomplete ||= sourceColumns.incomplete;
            const insertColumns = this.insertColumnCompletions(snapshot, view, offset, prefix);
            items.push(...insertColumns.items);
            incomplete ||= insertColumns.incomplete;
            items.push(...localSymbolCompletions(snapshot, prefix));
            if (isExpressionCompletionContext(snapshot.text.text, prefix.range.start)) {
                items.push(...builtInFunctionCompletions(prefix, snapshot.syntax.profile));
                items.push(...scalarFunctionCompletions(view, prefix));
            }
            items.push(...keywordCompletions(prefix, snapshot.syntax.profile));
        }

        if (isVectorParameterContext(snapshot, offset)) {
            items.push(...vectorParameterCompletions(prefix));
        }

        return { items: deduplicate(items), incomplete };
    }

    public resolveCompletion(item: CompletionItem): Promise<CompletionItem> {
        return Promise.resolve(item);
    }

    public hover(uri: string, version: number, offset: number): HoverResult | undefined {
        const snapshot = this._runtime.snapshot(uri, version);
        const view = this._metadata.pin();
        // A construct the engine cannot run is explained before anything else. The document
        // already contains it, so hiding it from completion is not enough: the author needs to be
        // told why the editor marked it.
        const unavailable = availabilityHover(snapshot.syntax, offset);
        if (unavailable) return unavailable;
        const symbol = snapshot.semantics.symbolAt(offset);
        if (!symbol) {
            return (
                this.catalogHover(snapshot, view, offset) ??
                syntacticHover(snapshot.syntax, offset, describeBuiltInRoutine)
            );
        }
        const object = symbol.object && view.object(symbol.object);
        const type = symbol.type
            ? `\n\nType: \`${symbol.type.displayName}${symbol.type.nullable ? " NULL" : " NOT NULL"}\``
            : "";
        const source = object ? `\n\nSource: \`${qualifiedName(object)}\`` : "";
        if (object && symbol.kind !== "column") {
            const base = this.objectHover(view, object);
            return {
                range: occurrenceRange(snapshot, offset) ?? symbol.declaration,
                markdown:
                    symbol.kind === "alias" ? `**alias** \`${symbol.name}\`\n\n${base}` : base,
            };
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

    public definition(uri: string, version: number, offset: number): readonly Location[] {
        return this.definitionTarget(uri, version, offset).locations;
    }

    public definitionTarget(uri: string, version: number, offset: number): DefinitionTarget {
        const snapshot = this._runtime.snapshot(uri, version);
        const symbol = snapshot.semantics.symbolAt(offset);
        if (!symbol) return emptyDefinitionTarget;
        const originRange = occurrenceRange(snapshot, offset);
        if (symbol.declaration) {
            return Object.freeze({
                locations: Object.freeze([{ uri, range: symbol.declaration }]),
                ...(originRange ? { originRange } : {}),
            });
        }
        if (!symbol.object) return emptyDefinitionTarget;
        // A catalog object has no declaration in this document. The identity comes from the pinned
        // metadata view, so a still-loading catalog yields nothing rather than a guessed name.
        const object = this._metadata.pin().object(symbol.object);
        if (!object) return emptyDefinitionTarget;
        return Object.freeze({
            locations: Object.freeze([]),
            ...(originRange ? { originRange } : {}),
            object: Object.freeze({
                ...(object.database ? { database: object.database } : {}),
                schema: object.schema,
                name: object.name,
                kind: object.kind,
                ...(object.typeCategory ? { typeCategory: object.typeCategory } : {}),
            }),
        });
    }

    public references(uri: string, version: number, offset: number): readonly Location[] {
        const snapshot = this._runtime.snapshot(uri, version);
        const symbol = snapshot.semantics.symbolAt(offset);
        return symbol
            ? [
                  ...(symbol.declaration ? [{ uri, range: symbol.declaration }] : []),
                  ...snapshot.semantics.references(symbol.id).map((reference) => ({
                      uri,
                      range: { start: reference.start, end: reference.end },
                  })),
              ]
            : [];
    }

    public prepareRename(uri: string, version: number, offset: number) {
        const snapshot = this._runtime.snapshot(uri, version);
        const symbol = snapshot.semantics.symbolAt(offset);
        if (!symbol?.declaration) return undefined;
        return occurrenceRange(snapshot, offset) ?? symbol.declaration;
    }

    public rename(
        uri: string,
        version: number,
        offset: number,
        newName: string,
    ): readonly TextEdit[] {
        const snapshot = this._runtime.snapshot(uri, version);
        const symbol = snapshot.semantics.symbolAt(offset);
        if (!symbol?.declaration) return [];
        const ranges = [symbol.declaration, ...snapshot.semantics.references(symbol.id)];
        return ranges.map((range) => ({
            start: range.start,
            end: range.end,
            newText: preserveIdentifierQuotes(
                snapshot.text.text.slice(range.start, range.end),
                newName,
            ),
        }));
    }

    public diagnostics(uri: string, version: number) {
        const snapshot = this._runtime.snapshot(uri, version);
        return { syntax: snapshot.syntax.diagnostics, semantic: snapshot.semantics.diagnostics };
    }

    public documentSymbols(uri: string, version: number): readonly DocumentSymbol[] {
        const snapshot = this._runtime.snapshot(uri, version);
        return snapshot.semantics.units.flatMap((unit) =>
            unit.symbols.flatMap((symbol) =>
                symbol.declaration
                    ? [
                          {
                              name: symbol.name,
                              kind: symbol.kind,
                              range: symbol.declaration,
                              selectionRange: symbol.declaration,
                          },
                      ]
                    : [],
            ),
        );
    }

    public foldingRanges(
        uri: string,
        version: number,
        options?: FoldingRangeOptions,
    ): readonly FoldingRange[] {
        return collectFoldingRanges(this._runtime.snapshot(uri, version).syntax, options);
    }

    public selectionRanges(uri: string, version: number, offsets: readonly number[]) {
        const snapshot = this._runtime.snapshot(uri, version);
        return offsets.map((offset) => {
            assertOffset(snapshot, offset);
            const node = snapshot.syntax.nodeAt(offset);
            return { start: node.start, end: node.end };
        });
    }

    public signatureHelp(uri: string, version: number, offset: number): SignatureHelp | undefined {
        const snapshot = this._runtime.snapshot(uri, version);
        assertOffset(snapshot, offset);
        const view = this._metadata.pin();
        const context = signatureContext(snapshot, offset);
        if (!context) return undefined;

        if (context.kind === "insert") {
            const resolution = view.resolveObject(context.target);
            const columns =
                resolution.kind === "resolved"
                    ? this.columns(view, resolution.object)
                    : {
                          value: localColumnsForName(snapshot, context.target, offset),
                          incomplete: resolution.kind === "unknown",
                      };
            if (!columns.value) return undefined;
            const selected = context.columns
                ? context.columns.map(
                      (name) =>
                          columns.value!.find((column) => equal(column.name, name, view)) ?? {
                              name,
                          },
                  )
                : columns.value.filter((column) => !column.identity && !column.computed);
            if (selected.length === 0) return undefined;
            return insertSignatureHelp(context, selected);
        }

        const local = localRoutineAt(snapshot, view, context.target, offset, context.kind);
        if (local) {
            return routineSignatureHelp(context, local.displayName, local.parameters);
        }

        const resolution = view.resolveObject(context.target);
        const expectedKind =
            context.kind === "execute" ? ["procedure"] : ["scalarFunction", "tableFunction"];
        if (resolution.kind === "resolved" && expectedKind.includes(resolution.object.kind)) {
            const state = view.parameterState(resolution.object.ref);
            if (state.kind !== "loaded") {
                this._metadata.requestHydration({
                    section: "parameters",
                    object: resolution.object.ref,
                    priority: "interactive",
                });
                if (state.kind !== "failed" || !state.previous) return undefined;
            }
            const parameters = [...(state.kind === "loaded" ? state.value : (state.previous ?? []))]
                .filter((parameter) => parameter.ordinal > 0)
                .sort((left, right) => left.ordinal - right.ordinal);
            return routineSignatureHelp(
                context,
                qualifiedName(resolution.object),
                parameters,
                resolution.object.extendedProcedure === true,
            );
        }

        return context.kind === "function"
            ? builtInSignatureHelp(context, snapshot.syntax.profile)
            : undefined;
    }

    private columns(
        view: MetadataView,
        object: ObjectMetadata,
    ): { readonly value?: readonly ColumnMetadata[]; readonly incomplete: boolean } {
        const state = view.columnState(object.ref);
        if (state.kind === "loaded") return { value: state.value, incomplete: false };
        if (state.kind === "failed" && state.previous) {
            return { value: state.previous, incomplete: true };
        }
        this._metadata.requestHydration({
            section: "columns",
            object: object.ref,
            priority: "interactive",
        });
        return { incomplete: true };
    }

    private objectHover(view: MetadataView, object: ObjectMetadata): string {
        const lines = [
            `**${object.system ? "system " : ""}${object.kind}** \`${qualifiedName(object)}\``,
        ];
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
                this._metadata.requestHydration({
                    section: "columns",
                    object: object.ref,
                    priority: "interactive",
                });
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
                this._metadata.requestHydration({
                    section: "parameters",
                    object: object.ref,
                    priority: "interactive",
                });
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
            const matches: { readonly column: ColumnMetadata; readonly source: BoundSource }[] = [];
            for (const source of collectVisibleSources(snapshot, view, query)) {
                if (qualifier && !equal(source.qualifier, qualifier, view)) continue;
                const columns = source.columns
                    ? { value: source.columns, incomplete: false }
                    : this.columns(view, source.object!);
                for (const column of columns.value ?? []) {
                    if (columnName && equal(column.name, columnName, view)) {
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
            .find((candidate) => equal(candidate.name, name, view));
        if (principal) return { range, markdown: principalHover(principal) };
        const schema = (view.schemas() ?? []).find((candidate) =>
            equal(candidate.name, name, view),
        );
        if (schema) {
            return {
                range,
                markdown: `**schema** \`${[schema.database, schema.name]
                    .filter(Boolean)
                    .join(".")}\``,
            };
        }
        const database = (view.databases() ?? []).find((candidate) =>
            equal(candidate.name, name, view),
        );
        return database ? { range, markdown: `**database** \`${database.name}\`` } : undefined;
    }

    private unqualifiedSourceCompletions(
        snapshot: DocumentAnalysisSnapshot,
        view: MetadataView,
        offset: number,
        prefix: PrefixContext,
    ): { readonly items: readonly CompletionItem[]; readonly incomplete: boolean } {
        const query = ancestor(snapshot.syntax.nodeAt(offset), ["QuerySpecification"]);
        if (!query) return { items: [], incomplete: false };
        const items: CompletionItem[] = [];
        let incomplete = false;
        for (const source of collectVisibleSources(snapshot, view, query)) {
            const columns = source.columns
                ? { value: source.columns, incomplete: false }
                : this.columns(view, source.object!);
            incomplete ||= columns.incomplete;
            if (!columns.value) continue;
            items.push(
                ...columns.value
                    .filter((column) => startsWith(column.name, prefix.prefix, view))
                    .map((column) => columnCompletion(column, source.qualifier, prefix)),
            );
        }
        return { items, incomplete };
    }

    private insertColumnCompletions(
        snapshot: DocumentAnalysisSnapshot,
        view: MetadataView,
        offset: number,
        prefix: PrefixContext,
    ): { readonly items: readonly CompletionItem[]; readonly incomplete: boolean } {
        const statement = ancestor(snapshot.syntax.nodeAt(offset), ["InsertStatement"]);
        if (!statement || !firstDescendant(statement, "InsertColumnList")) {
            return { items: [], incomplete: false };
        }
        const target = firstDescendant(statement, "DmlTarget");
        const name = target && firstDescendant(target, "MultipartIdentifier");
        if (!name) return { items: [], incomplete: false };
        const parts = multipartIdentifierParts(snapshot.text.text.slice(name.start, name.end));
        const resolution = view.resolveObject(parts);
        const columns =
            resolution.kind === "resolved"
                ? this.columns(view, resolution.object)
                : { value: localColumnsForName(snapshot, parts, name.start), incomplete: false };
        return {
            incomplete: columns.incomplete,
            items: (columns.value ?? [])
                .filter((column) => !column.identity && !column.computed)
                .filter((column) => startsWith(column.name, prefix.prefix, view))
                .map((column) => columnCompletion(column, parts.at(-1) ?? "", prefix)),
        };
    }

    private routineParameterCompletions(
        snapshot: DocumentAnalysisSnapshot,
        view: MetadataView,
        offset: number,
        prefix: PrefixContext,
    ): { readonly items: readonly CompletionItem[]; readonly incomplete: boolean } {
        const procedure = procedureNameBeforeArguments(
            snapshot.text.text,
            offset,
            prefix.range.start,
        );
        if (!procedure) return { items: [], incomplete: false };
        const resolution = view.resolveObject(multipartIdentifierParts(procedure));
        if (resolution.kind !== "resolved" || resolution.object.kind !== "procedure") {
            return { items: [], incomplete: resolution.kind === "unknown" };
        }
        const state = view.parameterState(resolution.object.ref);
        if (state.kind !== "loaded") {
            this._metadata.requestHydration({
                section: "parameters",
                object: resolution.object.ref,
                priority: "interactive",
            });
            return {
                items:
                    state.kind === "failed"
                        ? parameterCompletions(state.previous ?? [], prefix)
                        : [],
                incomplete: true,
            };
        }
        return { items: parameterCompletions(state.value, prefix), incomplete: false };
    }

    private starExpansion(
        snapshot: DocumentAnalysisSnapshot,
        view: MetadataView,
        offset: number,
    ): { readonly item?: CompletionItem; readonly incomplete: boolean } {
        const text = snapshot.text.text;
        const expansionSite = selectExpansionStar(snapshot, offset);
        if (!expansionSite) return { incomplete: false };
        const { star, query } = expansionSite;
        const ownSources = collectSources(snapshot, view, query);
        const sourcePrefix = sourcePrefixForStar(text.slice(star.start, star.end));
        if (ownSources.length === 0 && sourcePrefix === undefined) return { incomplete: false };
        const ownSelected = sourcePrefix
            ? ownSources.filter((source) => equal(source.qualifier, sourcePrefix, view))
            : ownSources;
        const selected =
            sourcePrefix && ownSelected.length === 0
                ? collectVisibleSources(snapshot, view, query).filter((source) =>
                      equal(source.qualifier, sourcePrefix, view),
                  )
                : ownSelected;
        if (selected.length === 0) return { incomplete: false };
        const expanded: string[] = [];
        let incomplete = false;
        for (const source of selected) {
            const columns = source.columns
                ? { value: source.columns, incomplete: false }
                : this.columns(view, source.object!);
            incomplete ||= columns.incomplete;
            if (!columns.value) continue;
            const qualify = sourcePrefix !== undefined || selected.length > 1;
            for (const column of columns.value) {
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
                detail: `${expanded.length} columns from ${selected
                    .map((source) =>
                        source.object ? qualifiedName(source.object) : source.qualifier,
                    )
                    .join(", ")}`,
                sortText: "0000-expand-select-star",
                edit: {
                    start: star.start,
                    end: star.end,
                    newText: formatColumnList(expanded, lineIndent(snapshot.text.text, star.start)),
                },
            },
        };
    }

    private insertExpansion(
        snapshot: DocumentAnalysisSnapshot,
        view: MetadataView,
        offset: number,
    ): { readonly item?: CompletionItem; readonly incomplete: boolean } {
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
        const columns = this.columns(view, resolution.object);
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
                detail: `${insertable.length} insertable columns from ${qualifiedName(resolution.object)}`,
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

interface BoundSource {
    readonly qualifier: string;
    readonly object?: ObjectMetadata;
    readonly columns?: readonly ColumnMetadata[];
}

function catalogCompletions(
    provider: MetadataProvider,
    view: MetadataView,
    prefix: PrefixContext,
    context: CatalogCompletionContext,
): { readonly items: readonly CompletionItem[]; readonly incomplete: boolean } {
    const items: CompletionItem[] = [];
    let incomplete = false;
    if (prefix.qualifiers.length === 0) {
        for (const database of view.databases() ?? []) {
            if (!startsWith(database.name, prefix.prefix, view)) continue;
            items.push({
                label: database.name,
                kind: "database",
                detail: "database",
                sortText: `${isSystemDatabase(database.name) ? "90" : "10"}-${database.name.toLocaleLowerCase()}`,
                edit: {
                    ...prefix.range,
                    newText: completionIdentifierInsertion(prefix, database.name),
                },
            });
        }
        incomplete ||= view.completeness.databases !== "ready";
        for (const schema of view.schemas(view.environment.currentDatabase) ?? []) {
            if (!startsWith(schema.name, prefix.prefix, view)) continue;
            items.push({
                label: schema.name,
                kind: "schema",
                detail: schema.database ? `schema in ${schema.database}` : "schema",
                sortText: `${schemaRank(schema.name)}-${schema.name.toLocaleLowerCase()}`,
                edit: {
                    ...prefix.range,
                    newText: completionIdentifierInsertion(prefix, schema.name),
                },
            });
        }
    } else if (prefix.qualifiers.length === 1) {
        const database = canonicalDatabase(view, prefix.qualifiers[0]!);
        if (database) {
            incomplete ||= requestDatabaseSection(provider, view, database, "schemas");
            for (const schema of view.schemas(database) ?? []) {
                if (!startsWith(schema.name, prefix.prefix, view)) continue;
                items.push({
                    label: schema.name,
                    kind: "schema",
                    detail: `schema in ${schema.database ?? database}`,
                    sortText: `${schemaRank(schema.name)}-${schema.name.toLocaleLowerCase()}`,
                    edit: {
                        ...prefix.range,
                        newText: completionIdentifierInsertion(prefix, schema.name),
                    },
                });
            }
        }
    }
    const scope = objectScope(prefix.qualifiers, view);
    if (!scope && prefix.qualifiers.length > 0) return { items, incomplete };
    const database = scope?.database ?? view.environment.currentDatabase;
    if (database) incomplete ||= requestDatabaseSection(provider, view, database, "objects");
    const objects = view.searchObjects({
        database,
        schema: scope?.schema,
        prefix: prefix.prefix,
        kinds: context.kinds,
        limit: maximumCatalogItems + 1,
    });
    for (const object of objects.slice(0, maximumCatalogItems)) {
        const unqualified = prefix.qualifiers.length === 0;
        const needsSchema =
            unqualified &&
            Boolean(object.schema) &&
            !equal(object.schema, view.environment.defaultSchema, view);
        const insertion = needsSchema
            ? completionMultipartInsertion(prefix, [object.schema!, object.name])
            : completionIdentifierInsertion(prefix, object.name);
        const label = needsSchema ? `${object.schema}.${object.name}` : object.name;
        items.push({
            label,
            kind: object.kind,
            detail: `${object.system ? "system " : ""}${object.kind} ${qualifiedName(object)}`,
            documentation: `SQL ${object.kind} \`${qualifiedName(object)}\``,
            sortText: `${objectSortRank(object)}-${object.name.toLocaleLowerCase()}`,
            edit: { ...prefix.range, newText: insertion },
        });
    }
    return { items, incomplete: incomplete || objects.length > maximumCatalogItems };
}

interface PrincipalCompletionContext {
    readonly kinds: readonly SqlPrincipalKind[];
}

function principalCompletions(
    provider: MetadataProvider,
    view: MetadataView,
    prefix: PrefixContext,
    context: PrincipalCompletionContext,
): { readonly items: readonly CompletionItem[]; readonly incomplete: boolean } {
    const incomplete = view.completeness.principals !== "ready";
    if (incomplete) provider.requestHydration({ section: "principals", priority: "interactive" });
    const principals = view.searchPrincipals({
        database: view.environment.currentDatabase,
        prefix: prefix.prefix,
        kinds: context.kinds,
        limit: maximumCatalogItems + 1,
    });
    return {
        incomplete: incomplete || principals.length > maximumCatalogItems,
        items: principals.slice(0, maximumCatalogItems).map((principal) => ({
            label: principal.name,
            kind: principal.kind,
            detail: `${principal.system ? "system " : ""}${principal.kind}${
                principal.database ? ` in ${principal.database}` : ""
            }`,
            documentation: principalHover(principal),
            sortText: `${principal.system ? "90" : "00"}-${principal.name.toLocaleLowerCase()}`,
            edit: {
                ...prefix.range,
                newText: completionIdentifierInsertion(prefix, principal.name),
            },
        })),
    };
}

function objectScope(
    qualifiers: readonly string[],
    view: MetadataView,
): { readonly database?: string; readonly schema?: string } | undefined {
    if (qualifiers.length === 0) return {};
    if (qualifiers.length === 1) {
        if (canonicalDatabase(view, qualifiers[0]!)) return undefined;
        const schema = (view.schemas() ?? []).find((candidate) =>
            equal(candidate.name, qualifiers[0]!, view),
        );
        return schema
            ? {
                  database: schema.database ?? view.environment.currentDatabase,
                  schema: schema.name,
              }
            : undefined;
    }
    if (qualifiers.length === 2) return { database: qualifiers[0], schema: qualifiers[1] };
    return undefined;
}

function sourceForQualifier(
    snapshot: DocumentAnalysisSnapshot,
    view: MetadataView,
    offset: number,
    qualifiers: readonly string[],
): BoundSource | undefined {
    if (qualifiers.length === 0) return undefined;
    const leaf = snapshot.syntax.nodeAt(offset);
    const query = ancestor(leaf, ["QuerySpecification"]);
    const statement = ancestor(leaf, ["Statement"]);
    const sources = query
        ? collectVisibleSources(snapshot, view, query)
        : statement
          ? collectSources(snapshot, view, statement)
          : [];
    if (qualifiers.length === 1) {
        const alias = sources.find((source) => equal(source.qualifier, qualifiers[0]!, view));
        if (alias) return alias;
    }
    const resolution = view.resolveObject(qualifiers);
    return resolution.kind === "resolved"
        ? { qualifier: resolution.object.name, object: resolution.object }
        : undefined;
}

function collectSources(
    snapshot: DocumentAnalysisSnapshot,
    view: MetadataView,
    root: SyntaxNode,
): readonly BoundSource[] {
    const result: BoundSource[] = [];
    const queryRoot =
        root.kind === "QuerySpecification" ? root : firstDescendant(root, "QuerySpecification");
    visit(root, (node) => {
        const containingQuery = ancestor(node, ["QuerySpecification"]);
        if (
            queryRoot &&
            (!containingQuery ||
                containingQuery.start !== queryRoot.start ||
                containingQuery.end !== queryRoot.end)
        )
            return;
        if (node.kind === "NamedTableSource") {
            const name = firstDescendant(node, "MultipartIdentifier");
            if (!name) return;
            const parts = multipartIdentifierParts(snapshot.text.text.slice(name.start, name.end));
            const resolution = view.resolveObject(parts);
            const alias = firstDescendant(node, "TableAlias");
            const aliasName = alias && lastDescendant(alias, "IdentifierName");
            const qualifier = aliasName
                ? normalizeIdentifier(snapshot.text.text.slice(aliasName.start, aliasName.end))
                : parts.at(-1);
            if (!qualifier) return;
            if (resolution.kind === "resolved") {
                result.push({ object: resolution.object, qualifier });
                return;
            }
            const columns = localColumnsForName(snapshot, parts, node.start);
            if (columns) result.push({ qualifier, columns });
        } else if (node.kind === "VariableTableSource") {
            const variable = firstDescendant(node, "Variable");
            if (!variable) return;
            const name = snapshot.text.text.slice(variable.start, variable.end);
            const alias = firstDescendant(node, "TableAlias");
            const aliasName = alias && lastDescendant(alias, "IdentifierName");
            const columns = localColumnsForName(snapshot, [name], node.start);
            if (columns) {
                result.push({
                    qualifier: aliasName
                        ? normalizeIdentifier(
                              snapshot.text.text.slice(aliasName.start, aliasName.end),
                          )
                        : name,
                    columns,
                });
            }
        } else if (node.kind === "FunctionTableSource") {
            const name = firstDescendant(node, "MultipartIdentifier");
            if (!name) return;
            const parts = multipartIdentifierParts(snapshot.text.text.slice(name.start, name.end));
            const functionName = parts.at(-1)?.toLocaleLowerCase();
            const alias = firstDescendant(node, "TableAlias");
            const aliasName = alias && lastDescendant(alias, "IdentifierName");
            const qualifier = aliasName
                ? normalizeIdentifier(snapshot.text.text.slice(aliasName.start, aliasName.end))
                : parts.at(-1);
            if (!qualifier) return;
            if (functionName === "openjson") {
                const schema = firstDescendant(node, "WithColumnSchema");
                const columns = schema
                    ? descendants(schema, "ColumnSchemaElement").map((column) =>
                          columnMetadata(snapshot, column),
                      )
                    : [
                          { name: "key", typeDisplay: "nvarchar(4000)", nullable: false },
                          { name: "value", typeDisplay: "nvarchar(max)", nullable: true },
                          { name: "type", typeDisplay: "int", nullable: false },
                      ];
                result.push({ qualifier, columns });
                return;
            }
            const explicit = firstDescendant(node, "ColumnNameList");
            if (explicit) {
                result.push({
                    qualifier,
                    columns: descendants(explicit, "IdentifierName").map((column) => ({
                        name: normalizeIdentifier(
                            snapshot.text.text.slice(column.start, column.end),
                        ),
                    })),
                });
                return;
            }
            const resolution = view.resolveObject(parts);
            if (resolution.kind === "resolved") {
                result.push({ qualifier, object: resolution.object });
            }
        } else if (node.kind === "VectorSearchTableSource") {
            const alias = firstDescendant(node, "TableAlias");
            const aliasName = alias && lastDescendant(alias, "IdentifierName");
            if (!aliasName) return;
            result.push({
                qualifier: normalizeIdentifier(
                    snapshot.text.text.slice(aliasName.start, aliasName.end),
                ),
                columns: [{ name: "distance", typeDisplay: "float", nullable: false }],
            });
        } else if (node.kind === "DerivedTable") {
            const alias = firstDescendant(node, "TableAlias");
            const aliasName = alias && lastDescendant(alias, "IdentifierName");
            if (!aliasName) return;
            const explicit = descendants(node, "ColumnNameList").find(
                (list) => list.start >= alias.end,
            );
            const columns = explicit
                ? descendants(explicit, "IdentifierName").map((name) => ({
                      name: normalizeIdentifier(snapshot.text.text.slice(name.start, name.end)),
                  }))
                : projectedColumns(snapshot, firstDescendant(node, "SelectList"));
            result.push({
                qualifier: normalizeIdentifier(
                    snapshot.text.text.slice(aliasName.start, aliasName.end),
                ),
                columns,
            });
        }
    });
    return result;
}

function collectVisibleSources(
    snapshot: DocumentAnalysisSnapshot,
    view: MetadataView,
    query: SyntaxNode,
): readonly BoundSource[] {
    const result = [...collectSources(snapshot, view, query)];
    let outer = correlatableOuterQuery(query);
    while (outer) {
        result.push(...collectSources(snapshot, view, outer));
        outer = correlatableOuterQuery(outer);
    }
    return result;
}

function correlatableOuterQuery(query: SyntaxNode): SyntaxNode | undefined {
    for (let current = query.parent(); current; current = current.parent()) {
        // A CTE or ordinary derived table owns an independent query scope. APPLY-specific lateral
        // visibility can be added separately without leaking outer aliases into every subquery.
        if (current.kind === "CommonTableExpression" || current.kind === "DerivedTable") {
            return undefined;
        }
        if (current.kind === "QuerySpecification") return current;
    }
    return undefined;
}

function columnCompletion(
    column: ColumnMetadata,
    qualifier: string,
    prefix: PrefixContext,
): CompletionItem {
    return {
        label: column.name,
        kind: "column",
        detail: `${column.typeDisplay ?? "column"}${column.nullable ? " null" : ""}`,
        sortText: `10-${column.name.toLocaleLowerCase()}`,
        edit: {
            ...prefix.range,
            newText: completionIdentifierInsertion(prefix, column.name),
        },
        data: { qualifier },
    };
}

// The general keyword catalogue plus the words the platform registry names. Several dialect words
// — CLUSTER, PREDICT, DISTRIBUTION — are parser-local and absent from SqlParser's context catalogue,
// so a profile that runs them would otherwise never be offered them.
const generalKeywords: ReadonlySet<string> = new Set(
    [...reservedKeywordNames, ...contextualKeywordNames].map((keyword) =>
        keyword.toLocaleUpperCase(),
    ),
);
const completionKeywords = Object.freeze(
    [...new Set([...generalKeywords, ...platformFeatureKeywords])]
        .map((keyword) => keyword.toLocaleUpperCase())
        .sort(),
);

const vectorParameters = Object.freeze([
    "TABLE",
    "COLUMN",
    "SIMILAR_TO",
    "METRIC",
    "TOP_N",
    "L",
    "M",
    "START_ID",
]);

function keywordCompletions(
    prefix: PrefixContext,
    profile: TsqlFeatureProfile,
): readonly CompletionItem[] {
    if (prefix.prefix.length === 0) return [];
    const folded = prefix.prefix.toLocaleLowerCase();
    // An unreported compatibility level defers rather than restricts, so a still-connecting
    // document keeps every keyword the newest level accepts.
    const compatibility = profile.compatibilityLevel ?? latestCompatibilityLevel;
    // A word that exists only inside a feature this engine cannot run is never offered. A word the
    // general catalogue also carries is never withheld, because it is ordinary T-SQL as well.
    const withheld = platformOnlyKeywords(profile, generalKeywords);
    return completionKeywords
        .filter((keyword) => {
            if (!keyword.toLocaleLowerCase().startsWith(folded)) return false;
            if (withheld.has(keyword)) return false;
            const metadata = keywordMetadata(keyword);
            return (
                metadata?.category !== "reserved" || metadata.minimumCompatibility <= compatibility
            );
        })
        .map((keyword) => ({
            label: keyword,
            kind: "keyword",
            sortText: `40-${keyword.toLocaleLowerCase()}`,
            edit: {
                ...prefix.range,
                newText: completionIdentifierInsertion(prefix, keyword, false),
            },
        }));
}

function dataTypeCompletions(
    prefix: PrefixContext,
    profile: TsqlFeatureProfile,
): readonly CompletionItem[] {
    const folded = prefix.prefix.toLocaleLowerCase();
    return builtInsOfKind("dataType")
        .filter((entry) => isBuiltInAvailable(entry, builtInProfile(profile)))
        .map((entry) => entry.name.toLocaleUpperCase())
        .filter((type) => type.toLocaleLowerCase().startsWith(folded))
        .map((type) => ({
            label: type,
            kind: "type",
            detail: "SQL Server data type",
            sortText: `03-${type.toLocaleLowerCase()}`,
            edit: {
                ...prefix.range,
                newText: completionIdentifierInsertion(prefix, type, false),
            },
        }));
}

function builtInFunctionCompletions(
    prefix: PrefixContext,
    profile: TsqlFeatureProfile,
): readonly CompletionItem[] {
    const folded = prefix.prefix.toLocaleLowerCase();
    return builtInsOfKind("routine")
        .filter((entry) => isBuiltInAvailable(entry, builtInProfile(profile)))
        .filter((entry) => entry.signatures && entry.signatures.length > 0)
        .map((entry) => entry.name.toLocaleUpperCase())
        .filter((name) => name.toLocaleLowerCase().startsWith(folded))
        .map((name) => ({
            label: name,
            kind: "function",
            detail: "SQL Server built-in function",
            sortText: `15-${name.toLocaleLowerCase()}`,
            edit: {
                ...prefix.range,
                newText: completionIdentifierInsertion(prefix, name, false),
            },
        }));
}

/**
 * The availability facts the built-in registry reads, taken from the snapshot's resolved profile
 * rather than from the metadata environment, so syntax and completion never disagree about which
 * engine a document belongs to.
 */
/**
 * Explains an availability restriction the document already contains.
 *
 * The syntax snapshot already carries the structured detail, so hover reads the published
 * diagnostic rather than re-deriving the decision and risking a different answer.
 */
function availabilityHover(syntax: SyntaxSnapshot, offset: number): HoverResult | undefined {
    const diagnostic = syntax.diagnostics.find(
        (candidate) =>
            candidate.availability !== undefined &&
            candidate.range.start <= offset &&
            offset <= candidate.range.end,
    );
    if (!diagnostic?.availability) return undefined;
    const detail = diagnostic.availability;
    return {
        range: diagnostic.range,
        markdown: `**${detail.displayName}**

${diagnostic.message}`,
    };
}

function builtInProfile(profile: TsqlFeatureProfile): BuiltInProfile {
    return {
        engineProfile: profile.engineProfile,
        ...(profile.compatibilityLevel === undefined
            ? {}
            : { compatibilityLevel: profile.compatibilityLevel }),
    };
}

function scalarFunctionCompletions(
    view: MetadataView,
    prefix: PrefixContext,
): readonly CompletionItem[] {
    return view
        .searchObjects({
            database: view.environment.currentDatabase,
            prefix: prefix.prefix,
            kinds: ["scalarFunction"],
            limit: 200,
        })
        .map((object) => ({
            label: object.name,
            kind: object.kind,
            detail: `${object.kind} ${qualifiedName(object)}`,
            sortText: `${objectSortRank(object)}-${object.name.toLocaleLowerCase()}`,
            edit: {
                ...prefix.range,
                newText: completionIdentifierInsertion(prefix, object.name),
            },
        }));
}

function parameterCompletions(
    parameters: readonly ParameterMetadata[],
    prefix: PrefixContext,
): readonly CompletionItem[] {
    const folded = prefix.prefix.toLocaleLowerCase();
    return parameters
        .filter((parameter) => parameter.name.toLocaleLowerCase().startsWith(folded))
        .map((parameter) => ({
            label: parameter.name,
            kind: "parameter",
            detail: `${parameter.typeDisplay ?? "parameter"}${parameter.output ? " OUTPUT" : ""}`,
            sortText: `01-${parameter.ordinal.toString().padStart(5, "0")}`,
            edit: { ...prefix.range, newText: `${parameter.name} = ` },
        }));
}

function localSymbolCompletions(
    snapshot: DocumentAnalysisSnapshot,
    prefix: PrefixContext,
): readonly CompletionItem[] {
    const folded = prefix.prefix.toLocaleLowerCase();
    return snapshot.semantics
        .visibleSymbols(prefix.range.end)
        .filter((symbol) => symbol.name.toLocaleLowerCase().startsWith(folded))
        .map((symbol) => ({
            label: symbol.name,
            kind: symbol.kind,
            detail: symbol.type?.displayName,
            sortText: `05-${symbol.name.toLocaleLowerCase()}`,
            edit: {
                ...prefix.range,
                newText: completionIdentifierInsertion(prefix, symbol.name, false),
            },
        }));
}

function localObjectCompletions(
    snapshot: DocumentAnalysisSnapshot,
    prefix: PrefixContext,
): readonly CompletionItem[] {
    const folded = prefix.prefix.toLocaleLowerCase();
    return snapshot.semantics
        .visibleSymbols(prefix.range.end)
        .filter((symbol) => ["cte", "tempTable", "localTable"].includes(symbol.kind))
        .filter((symbol) => symbol.name.toLocaleLowerCase().startsWith(folded))
        .map((symbol) => ({
            label: symbol.name,
            kind: symbol.kind,
            detail: "document-local object",
            sortText: `00-${symbol.name.toLocaleLowerCase()}`,
            edit: {
                ...prefix.range,
                newText: completionIdentifierInsertion(prefix, symbol.name),
            },
        }));
}

function vectorParameterCompletions(prefix: PrefixContext): readonly CompletionItem[] {
    const folded = prefix.prefix.toLocaleLowerCase();
    return vectorParameters
        .filter((parameter) => parameter.toLocaleLowerCase().startsWith(folded))
        .map((parameter) => ({
            label: parameter,
            kind: "property",
            detail: "VECTOR_SEARCH named parameter",
            sortText: `02-${parameter.toLocaleLowerCase()}`,
            edit: { ...prefix.range, newText: `${parameter} = ` },
        }));
}

function isVectorParameterContext(snapshot: DocumentAnalysisSnapshot, offset: number): boolean {
    if (ancestor(snapshot.syntax.nodeAt(offset), ["VectorSearchTableSource"])) return true;
    const leading = snapshot.text.text.slice(Math.max(0, offset - 2_000), offset);
    const start = leading.toLocaleLowerCase().lastIndexOf("vector_search(");
    if (start < 0) return false;
    let depth = 0;
    for (const character of leading.slice(start + "vector_search".length)) {
        if (character === "(") depth++;
        else if (character === ")") depth--;
    }
    return depth > 0;
}

function procedureNameBeforeArguments(
    text: string,
    offset: number,
    prefixStart: number,
): string | undefined {
    const leading = text.slice(Math.max(0, offset - 1_000), prefixStart);
    const identifier = String.raw`(?:\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*"|[\p{L}_#][\p{L}\p{N}_$#@]*)`;
    const match = new RegExp(
        String.raw`\bEXEC(?:UTE)?\s+(?:@[\p{L}_][\p{L}\p{N}_$#@]*\s*=\s*)?(${identifier}(?:\s*\.\s*${identifier}){0,2})\s+[^;]*$`,
        "iu",
    ).exec(leading);
    return match?.[1];
}

function isDataTypeCompletionContext(text: string, prefixStart: number): boolean {
    const leading = text.slice(Math.max(0, prefixStart - 600), prefixStart);
    const qualifier = String.raw`(?:(?:\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*"|[\p{L}_#][\p{L}\p{N}_$#@]*)\s*\.\s*){0,2}`;
    if (
        new RegExp(
            String.raw`(?:\bDECLARE\s+|,)@[\p{L}_][\p{L}\p{N}_$#@]*\s+${qualifier}$`,
            "iu",
        ).test(leading)
    ) {
        return true;
    }
    if (
        new RegExp(
            String.raw`\b(?:RETURNS|ALTER\s+COLUMN)\s+(?:[\p{L}_][\p{L}\p{N}_$#@]*\s+)?${qualifier}$`,
            "iu",
        ).test(leading)
    ) {
        return true;
    }
    if (new RegExp(String.raw`\bCAST\s*\([^)]*\bAS\s+${qualifier}$`, "iu").test(leading)) {
        return true;
    }
    if (
        new RegExp(
            String.raw`\bCREATE\s+TABLE\b[\s\S]*(?:\(|,)\s*[\p{L}_#][\p{L}\p{N}_$#@]*\s+${qualifier}$`,
            "iu",
        ).test(leading)
    ) {
        return true;
    }
    if (
        new RegExp(
            String.raw`\b(?:CREATE|ALTER)\s+(?:PROC(?:EDURE)?|FUNCTION)\b[\s\S]*@[\p{L}_][\p{L}\p{N}_$#@]*\s+${qualifier}$`,
            "iu",
        ).test(leading)
    ) {
        return true;
    }
    if (
        new RegExp(String.raw`\bCREATE\s+TYPE\b[\s\S]*\bFROM\s+${qualifier}$`, "iu").test(leading)
    ) {
        return true;
    }
    return false;
}

function isExpressionCompletionContext(text: string, prefixStart: number): boolean {
    const leading = text.slice(Math.max(0, prefixStart - 400), prefixStart);
    return /(?:\bSELECT|\bWHERE|\bHAVING|\bON|\bRETURN|\bWHEN|\bTHEN|\bELSE|=|,)\s+$/iu.test(
        leading,
    );
}

function localColumnsForName(
    snapshot: DocumentAnalysisSnapshot,
    parts: readonly string[],
    useOffset: number,
): readonly ColumnMetadata[] | undefined {
    const wanted = normalizeIdentifier(parts.at(-1) ?? "").toLocaleLowerCase();
    if (!wanted) return undefined;
    const useBatch = ancestor(snapshot.syntax.nodeAt(useOffset), ["Batch"]);
    const isSameBatch = (node: SyntaxNode): boolean => {
        const batch = ancestor(node, ["Batch"]);
        return (
            !useBatch || (!!batch && batch.start === useBatch.start && batch.end === useBatch.end)
        );
    };
    let result: readonly ColumnMetadata[] | undefined;
    visit(snapshot.syntax.root(), (node) => {
        if (node.start >= useOffset || node.end > useOffset) return;
        if (node.kind === "CreateTableStatement") {
            const name = firstDescendant(node, "MultipartIdentifier");
            if (!name) return;
            const declared = multipartIdentifierParts(
                snapshot.text.text.slice(name.start, name.end),
            );
            if (normalizeIdentifier(declared.at(-1) ?? "").toLocaleLowerCase() !== wanted) return;
            const definition = firstDescendant(node, "TableDefinition");
            if (definition) result = tableDefinitionColumns(snapshot, definition);
        } else if (node.kind === "VariableDeclaration") {
            if (!isSameBatch(node)) return;
            const variable = firstDescendant(node, "Variable");
            const definition = firstDescendant(node, "TableDefinition");
            if (!variable || !definition) return;
            const declared = snapshot.text.text
                .slice(variable.start, variable.end)
                .toLocaleLowerCase();
            if (declared === wanted) result = tableDefinitionColumns(snapshot, definition);
        } else if (node.kind === "CommonTableExpression") {
            if (!isSameBatch(node)) return;
            const name = firstDescendant(node, "IdentifierName");
            if (!name) return;
            const declared = normalizeIdentifier(
                snapshot.text.text.slice(name.start, name.end),
            ).toLocaleLowerCase();
            if (declared === wanted) result = cteColumns(snapshot, node);
        } else if (node.kind === "SelectStatement") {
            const into = firstDescendant(node, "IntoClause");
            const name = into && firstDescendant(into, "MultipartIdentifier");
            if (!name) return;
            const declared = multipartIdentifierParts(
                snapshot.text.text.slice(name.start, name.end),
            );
            if (normalizeIdentifier(declared.at(-1) ?? "").toLocaleLowerCase() !== wanted) return;
            result = projectedColumns(snapshot, firstDescendant(node, "SelectList"));
        } else if (node.kind === "DropTableStatement") {
            for (const name of descendants(node, "MultipartIdentifier")) {
                const dropped = multipartIdentifierParts(
                    snapshot.text.text.slice(name.start, name.end),
                );
                if (normalizeIdentifier(dropped.at(-1) ?? "").toLocaleLowerCase() === wanted) {
                    result = undefined;
                }
            }
        }
    });
    return result;
}

function tableDefinitionColumns(
    snapshot: DocumentAnalysisSnapshot,
    definition: SyntaxNode,
): readonly ColumnMetadata[] {
    return descendants(definition, "ColumnDefinition").map((column) =>
        columnMetadata(snapshot, column),
    );
}

function columnMetadata(snapshot: DocumentAnalysisSnapshot, node: SyntaxNode): ColumnMetadata {
    const name = firstDescendant(node, "IdentifierName");
    const type = firstDescendant(node, "DataType");
    const source = snapshot.text.text.slice(node.start, node.end);
    return {
        name: name ? normalizeIdentifier(snapshot.text.text.slice(name.start, name.end)) : source,
        ...(type ? { typeDisplay: snapshot.text.text.slice(type.start, type.end) } : {}),
        nullable: !/\bNOT\s+NULL\b/iu.test(source),
    };
}

function cteColumns(
    snapshot: DocumentAnalysisSnapshot,
    cte: SyntaxNode,
): readonly ColumnMetadata[] {
    const explicit = directChild(cte, "ColumnNameList");
    if (explicit) {
        return descendants(explicit, "IdentifierName").map((name) => ({
            name: normalizeIdentifier(snapshot.text.text.slice(name.start, name.end)),
        }));
    }
    const list = firstDescendant(cte, "SelectList");
    return projectedColumns(snapshot, list);
}

function projectedColumns(
    snapshot: DocumentAnalysisSnapshot,
    list: SyntaxNode | undefined,
): readonly ColumnMetadata[] {
    if (!list) return [];
    const columns: ColumnMetadata[] = [];
    for (const element of descendants(list, "SelectElement")) {
        if (hasDescendant(element, "Star")) continue;
        const names = descendants(element, "IdentifierName");
        const name = names.at(-1);
        if (name) {
            columns.push({
                name: normalizeIdentifier(snapshot.text.text.slice(name.start, name.end)),
            });
        }
    }
    return columns;
}

interface CatalogCompletionContext {
    readonly kinds: readonly ObjectMetadata["kind"][];
}

function catalogCompletionContext(
    text: string,
    prefixStart: number,
): CatalogCompletionContext | undefined {
    const leading = text.slice(Math.max(0, prefixStart - 160), prefixStart);
    const qualifiedSuffix = String.raw`(?:[\w\[\]"$#@]+\.)*$`;
    if (new RegExp(String.raw`\bEXEC(?:UTE)?\s+${qualifiedSuffix}`, "iu").test(leading)) {
        return { kinds: ["procedure"] };
    }
    if (
        new RegExp(
            String.raw`\b(?:ALTER|DROP)\s+(?:PROC(?:EDURE)?)\s+${qualifiedSuffix}`,
            "iu",
        ).test(leading)
    ) {
        return { kinds: ["procedure"] };
    }
    if (
        new RegExp(String.raw`\b(?:ALTER|DROP)\s+FUNCTION\s+${qualifiedSuffix}`, "iu").test(leading)
    ) {
        return { kinds: ["scalarFunction", "tableFunction"] };
    }
    if (new RegExp(String.raw`\b(?:ALTER|DROP)\s+VIEW\s+${qualifiedSuffix}`, "iu").test(leading)) {
        return { kinds: ["view"] };
    }
    if (
        new RegExp(String.raw`\b(?:ALTER|DROP|TRUNCATE)\s+TABLE\s+${qualifiedSuffix}`, "iu").test(
            leading,
        )
    ) {
        return { kinds: ["table"] };
    }
    if (
        new RegExp(String.raw`(?:\bFROM|\bJOIN|\bAPPLY)\s+${qualifiedSuffix}`, "iu").test(leading)
    ) {
        return { kinds: tableKinds };
    }
    if (
        new RegExp(
            String.raw`(?:\bINSERT\s+INTO|\bUPDATE|\bDELETE\s+FROM|\bMERGE(?:\s+INTO)?)\s+${qualifiedSuffix}`,
            "iu",
        ).test(leading)
    ) {
        return { kinds: ["table", "view", "synonym"] };
    }
    return undefined;
}

function principalCompletionContext(
    text: string,
    prefixStart: number,
): PrincipalCompletionContext | undefined {
    const leading = text.slice(Math.max(0, prefixStart - 320), prefixStart);
    if (/\b(?:ALTER|DROP)\s+LOGIN\s+$/iu.test(leading)) return { kinds: ["login"] };
    if (/\b(?:ALTER|DROP)\s+USER\s+$/iu.test(leading)) return { kinds: ["user"] };
    if (/\bALTER\s+SERVER\s+ROLE\s+$/iu.test(leading)) return { kinds: ["serverRole"] };
    if (/\bALTER\s+ROLE\s+$/iu.test(leading)) return { kinds: ["databaseRole"] };
    if (/\bFOR\s+LOGIN\s*=*\s*$/iu.test(leading)) return { kinds: ["login"] };
    if (/\bEXECUTE\s+AS\s+LOGIN\s*=\s*$/iu.test(leading)) return { kinds: ["login"] };
    if (/\bEXECUTE\s+AS\s+USER\s*=\s*$/iu.test(leading)) return { kinds: ["user"] };
    if (/\bALTER\s+SERVER\s+ROLE\b[\s\S]*\bADD\s+MEMBER\s+$/iu.test(leading)) {
        return { kinds: ["login", "serverRole"] };
    }
    if (/\bALTER\s+ROLE\b[\s\S]*\bADD\s+MEMBER\s+$/iu.test(leading)) {
        return { kinds: ["user", "databaseRole", "applicationRole"] };
    }
    if (/\b(?:GRANT|DENY|REVOKE)\b[\s\S]*\b(?:TO|FROM)\s+$/iu.test(leading)) {
        return { kinds: ["user", "databaseRole", "applicationRole"] };
    }
    return undefined;
}

function canonicalDatabase(view: MetadataView, name: string): string | undefined {
    return (view.databases() ?? []).find((database) => equal(database.name, name, view))?.name;
}

function isCatalogQualifier(view: MetadataView, qualifiers: readonly string[]): boolean {
    if (qualifiers.length === 0 || qualifiers.length > 2) return false;
    if (qualifiers.length === 2) return canonicalDatabase(view, qualifiers[0]!) !== undefined;
    return (
        canonicalDatabase(view, qualifiers[0]!) !== undefined ||
        (view.schemas() ?? []).some((schema) => equal(schema.name, qualifiers[0]!, view))
    );
}

function requestDatabaseSection(
    provider: MetadataProvider,
    view: MetadataView,
    database: string,
    section: "schemas" | "objects",
): boolean {
    const state = view.databaseCatalogCompleteness(database)[section];
    if (state !== "ready") {
        provider.requestHydration({ section, database, priority: "interactive" });
    }
    return state !== "ready";
}

function schemaRank(name: string): string {
    return isSystemSchema(name) ? "90" : "10";
}

function objectSortRank(object: ObjectMetadata): string {
    return object.system || isSystemSchema(object.schema) ? "90" : "10";
}

function isSystemDatabase(name: string): boolean {
    return /^(?:master|model|msdb|tempdb)$/iu.test(name);
}

function isSystemSchema(name: string): boolean {
    return /^(?:sys|information_schema|guest|dbmanager|loginmanager|db_(?:accessadmin|backupoperator|datareader|datawriter|ddladmin|denydatareader|denydatawriter|owner|securityadmin))$/iu.test(
        name,
    );
}

function qualifiedName(object: ObjectMetadata): string {
    return [object.database, object.schema, object.name].filter(Boolean).join(".");
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
    // Empty or half-typed parentheses belong to the smart expansion edit. A populated column list
    // is rejected before this helper is called, so consuming a lone opening parenthesis is safe.
    const match = /^(?:\s*\(\s*\)?|\s*[);])*/u.exec(text.slice(start));
    return match && match[0].trim().length > 0 ? start + match[0].length : start;
}

function insertExpansionListContext(text: string, targetEnd: number, offset: number): boolean {
    if (offset < targetEnd) return false;
    // When the editor has already inserted `(`, preserve it and begin the completion edit at the
    // cursor. VS Code uses text between an edit's start and the cursor to filter suggestions, so
    // starting at the target name would hide the expansion behind the nonmatching ` (` prefix.
    return /^\s*\(\s*$/u.test(text.slice(targetEnd, offset));
}

function isEmptyInsertSource(text: string, source: SyntaxNode): boolean {
    // An editor-created `VALUES ()` tail is still a parser source node, but it contains no user
    // value and belongs to the smart expansion replacement. Any populated or alternate source is
    // authoritative and must never be overwritten.
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

function principalHover(principal: PrincipalMetadata): string {
    return `**${principal.system ? "system " : ""}${principal.kind}** \`${principal.name}\`${
        principal.database ? `\n\nDatabase: \`${principal.database}\`` : ""
    }`;
}

function columnHover(column: ColumnMetadata, source: BoundSource): string {
    const nullability =
        column.nullable === undefined ? "" : column.nullable ? " NULL" : " NOT NULL";
    return `**column** \`${column.name}\`\n\nType: \`${
        column.typeDisplay ?? "unknown"
    }${nullability}\`\n\nSource: \`${
        source.object ? qualifiedName(source.object) : source.qualifier
    }\``;
}

function identifierRangeAt(
    text: string,
    offset: number,
): { readonly start: number; readonly end: number } | undefined {
    let start = Math.min(offset, text.length);
    let end = start;
    while (start > 0 && /[\p{L}\p{N}_$#@\[\]"]/u.test(text[start - 1]!)) start--;
    while (end < text.length && /[\p{L}\p{N}_$#@\[\]"]/u.test(text[end]!)) end++;
    return end > start ? { start, end } : undefined;
}

/**
 * How a bound local is described. The binder records a routine parameter as an ordinary variable,
 * and only its declaration distinguishes the two, so the tree is asked where that declaration sits.
 */
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

/** One-line documentation for a shipped routine, or nothing when the name is not one. */
function describeBuiltInRoutine(name: string): string | undefined {
    const signature = lookupBuiltIn(name, "routine")?.signatures?.[0];
    if (!signature) return undefined;
    const call = `\`${formatSignature(name, signature)}\``;
    const returns = signature.returnType ? ` Returns \`${signature.returnType}\`.` : "";
    return `${call}\n\n${signature.documentation}${returns}`;
}

function occurrenceRange(
    snapshot: DocumentAnalysisSnapshot,
    offset: number,
): { readonly start: number; readonly end: number } | undefined {
    const node = ancestor(snapshot.syntax.nodeAt(offset), [
        "IdentifierName",
        "MultipartIdentifier",
        "Variable",
    ]);
    return node ? { start: node.start, end: node.end } : undefined;
}

function startsWith(value: string, prefix: string, view: MetadataView): boolean {
    return view.environment.caseSensitive
        ? value.startsWith(prefix)
        : value.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase());
}

function equal(left: string, right: string, view: MetadataView): boolean {
    return view.environment.caseSensitive
        ? left === right
        : left.toLocaleLowerCase() === right.toLocaleLowerCase();
}

function deduplicate(items: readonly CompletionItem[]): readonly CompletionItem[] {
    const seen = new Set<string>();
    return items.filter((item) => {
        const key = `${item.kind}\u0000${item.label}\u0000${item.edit?.start ?? -1}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Finds the SELECT star owned by the query at the cursor. Typing `*` selects the adjacent star,
 * while an explicit completion request elsewhere in the same query selects the nearest eligible
 * projection star. Stars used as function arguments (for example COUNT(*)) are never expandable.
 */
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

    const leaf = snapshot.syntax.nodeAt(offset);
    const query = ancestor(leaf, ["QuerySpecification"]);
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

function sameSyntaxNode(left: SyntaxNode, right: SyntaxNode): boolean {
    return left.kind === right.kind && left.start === right.start && left.end === right.end;
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

function assertOffset(snapshot: DocumentAnalysisSnapshot, offset: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset > snapshot.text.length) {
        throw new RangeError(`Invalid completion offset ${offset}`);
    }
}
