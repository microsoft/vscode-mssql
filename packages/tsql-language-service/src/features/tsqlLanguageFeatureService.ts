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
    formatParameter,
    formatSignature,
    isBuiltInAvailable,
    lookupBuiltIn,
    type BuiltInSignature,
} from "../common/builtInRegistry.js";
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
} from "../syntax/index.js";
import { collectFoldingRanges, type FoldingRangeOptions } from "./foldingRanges.js";
import { isRoutineParameter, syntacticHover } from "./syntacticHover.js";
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
            if (prefix.qualifiers.length === 0) items.push(...dataTypeCompletions(prefix, view));
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
                items.push(...builtInFunctionCompletions(prefix, view));
                items.push(...scalarFunctionCompletions(view, prefix));
            }
            items.push(...keywordCompletions(prefix, view));
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

        return context.kind === "function" ? builtInSignatureHelp(context, view) : undefined;
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

interface PrefixContext {
    readonly qualifiers: readonly string[];
    readonly prefix: string;
    readonly range: { readonly start: number; readonly end: number };
    readonly contextStart: number;
    readonly delimiter?: {
        readonly kind: "bracket" | "doubleQuote";
        readonly closed: boolean;
    };
}

interface BoundSource {
    readonly qualifier: string;
    readonly object?: ObjectMetadata;
    readonly columns?: readonly ColumnMetadata[];
}

interface RoutineSignatureContext {
    readonly kind: "function" | "execute";
    readonly target: readonly string[];
    readonly activeParameter: number;
    readonly namedParameter?: string;
}

interface InsertSignatureContext {
    readonly kind: "insert";
    readonly target: readonly string[];
    readonly columns?: readonly string[];
    readonly activeParameter: number;
    /** True while the cursor is inside the target column list rather than a VALUES row. */
    readonly namingColumns?: boolean;
}

type SignatureContext = RoutineSignatureContext | InsertSignatureContext;

/**
 * Expressions the grammar models in their own right rather than as calls. Each still reads as a
 * routine to anyone typing one, so signature help answers for them the same way.
 */
const specialExpressionRoutines: ReadonlyMap<string, string> = new Map([
    ["JsonValueExpression", "JSON_VALUE"],
    ["JsonQueryExpression", "JSON_QUERY"],
    ["JsonConstructorExpression", "JSON_OBJECT"],
    ["JsonAggregateExpression", "JSON_OBJECTAGG"],
    ["CastExpression", "CAST"],
    ["TryCastExpression", "TRY_CAST"],
    ["ConvertExpression", "CONVERT"],
    ["ParseExpression", "PARSE"],
    ["TrimExpression", "TRIM"],
    ["AiGenerateEmbeddingsExpression", "AI_GENERATE_EMBEDDINGS"],
    // Statements that read as calls. Their arguments have fixed meanings, which is why the grammar
    // gives them their own shape, but anyone typing one expects the same help a call gives.
    ["RaiserrorStatement", "RAISERROR"],
    ["ThrowStatement", "THROW"],
    ["WaitForStatement", "WAITFOR"],
]);

/** CONVERT and PARSE share a node with their TRY_ form, so the written spelling decides. */
function conversionSpelling(
    snapshot: DocumentAnalysisSnapshot,
    node: SyntaxNode,
    fallback: string,
): string {
    const written = /^[A-Za-z_]+/u.exec(snapshot.text.text.slice(node.start, node.end))?.[0];
    return written ? written.toLocaleUpperCase() : fallback;
}

/**
 * CAST separates its two arguments with AS rather than a comma, so the keyword advances the active
 * parameter the way a comma does elsewhere.
 */
function conversionActiveParameter(node: SyntaxNode, offset: number): number {
    let active = activeParameterIn(node, offset);
    for (const child of node.children()) {
        // AS and USING separate arguments here the way a comma does in an ordinary call.
        if ((child.kind === "As" || child.kind === "Using") && child.start < offset) active++;
    }
    return active;
}

function signatureContext(
    snapshot: DocumentAnalysisSnapshot,
    offset: number,
): SignatureContext | undefined {
    const specialized = cursorAncestor(snapshot, offset, [...specialExpressionRoutines.keys()]);
    if (specialized) {
        const routine = specialExpressionRoutines.get(specialized.kind)!;
        return {
            kind: "function",
            target: [conversionSpelling(snapshot, specialized, routine)],
            activeParameter: conversionActiveParameter(specialized, offset),
        };
    }

    const call = cursorAncestor(snapshot, offset, [
        "FunctionCall",
        "FunctionTableSource",
        "GlobalFunctionTableSource",
    ]);
    if (call) {
        const name =
            firstDescendant(call, "MultipartIdentifier") ?? firstDescendant(call, "IdentifierName");
        if (name) {
            const argumentsNode =
                firstDescendant(call, "ArgumentList") ??
                firstDescendant(call, "TableFunctionArgumentList");
            return {
                kind: "function",
                target: multipartIdentifierParts(snapshot.text.text.slice(name.start, name.end)),
                activeParameter: argumentsNode ? activeParameterIn(argumentsNode, offset) : 0,
            };
        }
    }

    // The target column list of an INSERT sits inside the target itself, which the grammar also
    // uses for the parenthesised form of a rowset target, so the parentheses are found there.
    const dmlTarget = cursorAncestor(snapshot, offset, ["DmlTarget"]);
    if (dmlTarget && ancestor(dmlTarget, ["InsertStatement"])) {
        const open = childOfKind(dmlTarget, "OpenParen");
        const close = childOfKind(dmlTarget, "CloseParen");
        const name = firstDescendant(dmlTarget, "MultipartIdentifier");
        if (name && open && offset > open.start && (!close || offset <= close.start)) {
            const list =
                firstDescendant(dmlTarget, "InsertColumnList") ??
                firstDescendant(dmlTarget, "ArgumentList");
            return {
                kind: "insert",
                target: multipartIdentifierParts(snapshot.text.text.slice(name.start, name.end)),
                activeParameter: list ? activeParameterIn(list, offset) : 0,
                namingColumns: true,
            };
        }
    }

    const row = cursorAncestor(snapshot, offset, ["RowValue"]);
    const insert = row && ancestor(row, ["InsertStatement"]);
    if (row && insert && ancestor(row, ["ValuesInsertSource"])) {
        const target = firstDescendant(insert, "DmlTarget");
        const name = target && firstDescendant(target, "MultipartIdentifier");
        if (target && name) {
            const explicit =
                firstDescendant(target, "InsertColumnList") ??
                firstDescendant(target, "ArgumentList");
            const columns = explicit
                ? descendants(explicit, "ColumnReference")
                      .map((column) =>
                          multipartIdentifierParts(
                              snapshot.text.text.slice(column.start, column.end),
                          ).at(-1),
                      )
                      .filter((column): column is string => column !== undefined)
                : undefined;
            return {
                kind: "insert",
                target: multipartIdentifierParts(snapshot.text.text.slice(name.start, name.end)),
                ...(columns && columns.length > 0 ? { columns } : {}),
                activeParameter: activeParameterIn(row, offset),
            };
        }
    }

    const execute = cursorAncestor(snapshot, offset, ["ExecuteStatement"]);
    if (execute) {
        const entity = firstDescendant(execute, "ExecutableEntity");
        const name = entity && firstDescendant(entity, "MultipartIdentifier");
        if (name) {
            const argumentsNode = firstDescendant(execute, "ExecuteArgumentList");
            return {
                kind: "execute",
                target: multipartIdentifierParts(snapshot.text.text.slice(name.start, name.end)),
                activeParameter: argumentsNode ? activeParameterIn(argumentsNode, offset) : 0,
                ...(argumentsNode
                    ? {
                          namedParameter: activeNamedParameter(
                              snapshot.text.text,
                              argumentsNode,
                              offset,
                          ),
                      }
                    : {}),
            };
        }
    }
    return undefined;
}

function cursorAncestor(
    snapshot: DocumentAnalysisSnapshot,
    offset: number,
    kinds: readonly string[],
): SyntaxNode | undefined {
    const exact = ancestor(snapshot.syntax.nodeAt(offset), kinds);
    return exact ?? (offset > 0 ? ancestor(snapshot.syntax.nodeAt(offset - 1), kinds) : undefined);
}

function childOfKind(node: SyntaxNode, kind: string): SyntaxNode | undefined {
    for (const child of node.children()) {
        if (child.kind === kind) return child;
    }
    return undefined;
}

function activeParameterIn(node: SyntaxNode, offset: number): number {
    let active = 0;
    for (const child of node.children()) {
        if (child.kind === "Comma" && child.start < offset) active++;
    }
    return active;
}

function activeNamedParameter(
    text: string,
    argumentsNode: SyntaxNode,
    offset: number,
): string | undefined {
    let start = argumentsNode.start;
    for (const child of argumentsNode.children()) {
        if (child.kind === "Comma" && child.start < offset) start = child.end;
    }
    return /(@[\p{L}_][\p{L}\p{N}_$#@]*)\s*=/iu.exec(text.slice(start, offset))?.[1];
}

function routineSignatureHelp(
    context: RoutineSignatureContext,
    displayName: string,
    parameters: readonly ParameterMetadata[],
    extendedProcedure = false,
): SignatureHelp {
    const labels = parameters.map(parameterLabel);
    const namedIndex = context.namedParameter
        ? parameters.findIndex(
              (parameter) =>
                  parameter.name.toLocaleLowerCase() ===
                  context.namedParameter!.toLocaleLowerCase(),
          )
        : -1;
    const activeParameter =
        parameters.length === 0
            ? 0
            : Math.min(
                  namedIndex >= 0 ? namedIndex : context.activeParameter,
                  parameters.length - 1,
              );
    return {
        signatures: [
            {
                label:
                    context.kind === "execute"
                        ? `EXEC ${displayName}${labels.length > 0 ? ` ${labels.join(", ")}` : ""}`
                        : `${displayName}(${labels.join(", ")})`,
                documentation:
                    context.kind === "execute"
                        ? extendedProcedure
                            ? "Parameter help is not supported for extended stored procedures."
                            : "Stored procedures always return INT."
                        : "Function parameters in declaration order.",
                parameters: parameters.map((parameter) => ({
                    label: parameterLabel(parameter),
                    documentation: parameterDocumentation(parameter),
                })),
            },
        ],
        activeSignature: 0,
        activeParameter,
    };
}

function parameterLabel(parameter: ParameterMetadata): string {
    const name = parameter.name || `#${parameter.ordinal}`;
    return `${name} ${parameter.typeDisplay ?? "unknown"}${
        parameter.hasDefault ? " = DEFAULT" : ""
    }${parameter.output ? " OUTPUT" : ""}`;
}

function parameterDocumentation(parameter: ParameterMetadata): string {
    const direction = parameter.output ? "Input/output" : "Input";
    const requirement =
        parameter.hasDefault === undefined
            ? "optionality unavailable"
            : parameter.hasDefault
              ? "optional"
              : "required";
    return `${direction} parameter (${requirement}). Type: \`${parameter.typeDisplay ?? "unknown"}\`.`;
}

function insertSignatureHelp(
    context: InsertSignatureContext,
    columns: readonly ColumnMetadata[],
): SignatureHelp {
    const labels = columns.map(
        (column) =>
            `${quoteIdentifierIfNeeded(column.name)} ${column.typeDisplay ?? "unknown"}${
                column.nullable === undefined ? "" : column.nullable ? " NULL" : " NOT NULL"
            }`,
    );
    return {
        signatures: [
            {
                label: `INSERT INTO ${context.target.map(quoteIdentifierIfNeeded).join(".")}${
                    context.namingColumns ? "" : " VALUES"
                } (${labels.join(", ")})`,
                documentation: context.namingColumns
                    ? "Name the target columns to populate; the highlighted one is next."
                    : "Each VALUES expression corresponds to the highlighted target column.",
                parameters: columns.map((column, index) => ({
                    label: labels[index]!,
                    documentation: `Target column \`${column.name}\`. Type: \`${
                        column.typeDisplay ?? "unknown"
                    }\`${
                        column.nullable === undefined
                            ? "."
                            : column.nullable
                              ? "; NULL is allowed."
                              : "; NULL is not allowed."
                    }`,
                })),
            },
        ],
        activeSignature: 0,
        activeParameter: Math.min(context.activeParameter, columns.length - 1),
    };
}

function localRoutineAt(
    snapshot: DocumentAnalysisSnapshot,
    view: MetadataView,
    target: readonly string[],
    offset: number,
    callKind: RoutineSignatureContext["kind"],
): { readonly displayName: string; readonly parameters: readonly ParameterMetadata[] } | undefined {
    const declarationKinds =
        callKind === "execute"
            ? ["CreateProcedureStatement", "AlterProcedureStatement"]
            : ["CreateFunctionStatement", "AlterFunctionStatement"];
    const dropKind = callKind === "execute" ? "DropProcedureStatement" : "DropFunctionStatement";
    let result:
        | {
              readonly offset: number;
              readonly displayName: string;
              readonly parameters: readonly ParameterMetadata[];
          }
        | undefined;
    visit(snapshot.syntax.root(), (node) => {
        if (
            node.end > offset ||
            (!declarationKinds.includes(node.kind) && node.kind !== dropKind)
        ) {
            return;
        }
        const names =
            node.kind === dropKind
                ? descendants(node, "MultipartIdentifier")
                : [firstDescendant(node, "MultipartIdentifier")].filter(
                      (name): name is SyntaxNode => name !== undefined,
                  );
        for (const name of names) {
            const parts = multipartIdentifierParts(snapshot.text.text.slice(name.start, name.end));
            if (!localNameMatches(parts, target, view)) continue;
            if (!result || node.end >= result.offset) {
                result =
                    node.kind === dropKind
                        ? undefined
                        : {
                              offset: node.end,
                              displayName: parts.join("."),
                              parameters: localRoutineParameters(snapshot, node),
                          };
            }
        }
    });
    return result;
}

function localNameMatches(
    declaration: readonly string[],
    target: readonly string[],
    view: MetadataView,
): boolean {
    const declarationName = declaration.at(-1);
    const targetName = target.at(-1);
    if (!declarationName || !targetName || !equal(declarationName, targetName, view)) return false;
    if (target.length === 1) {
        const schema = declaration.at(-2);
        return !schema || equal(schema, view.environment.defaultSchema, view);
    }
    const count = Math.min(declaration.length, target.length);
    for (let index = 1; index <= count; index++) {
        if (!equal(declaration.at(-index)!, target.at(-index)!, view)) return false;
    }
    return true;
}

function localRoutineParameters(
    snapshot: DocumentAnalysisSnapshot,
    routine: SyntaxNode,
): readonly ParameterMetadata[] {
    const list =
        firstDescendant(routine, "ProcedureParameterClause") ??
        firstDescendant(routine, "FunctionParameterList");
    if (!list) return [];
    return descendants(list, "ProcedureParameter").map((parameter, index) => {
        const variable = firstDescendant(parameter, "Variable");
        const dataType = firstDescendant(parameter, "DataType");
        const source = snapshot.text.text.slice(parameter.start, parameter.end);
        return {
            ordinal: index + 1,
            name: variable
                ? snapshot.text.text.slice(variable.start, variable.end)
                : `@parameter${index + 1}`,
            ...(dataType
                ? { typeDisplay: snapshot.text.text.slice(dataType.start, dataType.end) }
                : {}),
            output: /\b(?:OUT|OUTPUT)\s*$/iu.test(source),
            hasDefault: /=/u.test(source),
        };
    });
}

function builtInSignatureHelp(
    context: RoutineSignatureContext,
    view: MetadataView,
): SignatureHelp | undefined {
    const name = context.target.at(-1);
    const entry = name ? lookupBuiltIn(name, "routine") : undefined;
    if (!entry || !isBuiltInAvailable(entry, builtInProfile(view))) return undefined;
    const signatures = entry?.signatures;
    if (!name || !signatures || signatures.length === 0) return undefined;
    return {
        signatures: signatures.map((signature) => ({
            label: formatSignature(name, signature),
            documentation: signatureDocumentation(signature),
            parameters: signature.parameters.map((parameter) => ({
                label: formatParameter(parameter),
                ...(parameter.optional ? { documentation: "Optional." } : {}),
                ...(parameter.variadic ? { documentation: "May be repeated." } : {}),
            })),
        })),
        activeSignature: 0,
        activeParameter: activeParameterWithin(signatures[0]!, context.activeParameter),
    };
}

/** A variadic argument absorbs every argument after it, so the last one stays highlighted. */
function activeParameterWithin(signature: BuiltInSignature, active: number): number {
    const count = signature.parameters.length;
    if (count === 0) return 0;
    return Math.min(active, count - 1);
}

function signatureDocumentation(signature: BuiltInSignature): string {
    return signature.returnType
        ? `${signature.documentation}\n\nReturns \`${signature.returnType}\`.`
        : signature.documentation;
}

function completionPrefix(snapshot: DocumentAnalysisSnapshot, offset: number): PrefixContext {
    const text = snapshot.text.text;
    const delimited = delimitedIdentifierAt(snapshot, offset);
    let partStart: number;
    let prefix: string;
    let range: { start: number; end: number };
    let delimiter: PrefixContext["delimiter"];

    if (delimited) {
        partStart = delimited.start;
        const contentStart = delimited.start + 1;
        const contentEnd = delimited.closed ? delimited.end - 1 : delimited.end;
        const rawPrefix = text.slice(contentStart, offset);
        prefix =
            delimited.kind === "bracket"
                ? rawPrefix.replaceAll("]]", "]")
                : rawPrefix.replaceAll('""', '"');
        range = { start: contentStart, end: contentEnd };
        delimiter = { kind: delimited.kind, closed: delimited.closed };
    } else {
        partStart = offset;
        while (partStart > 0 && isIdentifierCompletionCharacter(text[partStart - 1]!)) {
            partStart--;
        }
        let partEnd = offset;
        while (partEnd < text.length && isIdentifierCompletionCharacter(text[partEnd]!)) {
            partEnd++;
        }
        prefix = text.slice(partStart, offset);
        range = { start: partStart, end: partEnd };
    }

    const qualifier = multipartQualifierBefore(text, partStart);
    return {
        qualifiers:
            qualifier.length === 0
                ? []
                : splitMultipartPrefix(qualifier).map((part) => normalizeIdentifier(part.trim())),
        prefix,
        range,
        contextStart: partStart,
        ...(delimiter ? { delimiter } : {}),
    };
}

function delimitedIdentifierAt(
    snapshot: DocumentAnalysisSnapshot,
    offset: number,
):
    | {
          readonly kind: "bracket" | "doubleQuote";
          readonly start: number;
          readonly end: number;
          readonly closed: boolean;
      }
    | undefined {
    const candidates = [offset, offset - 1, offset + 1]
        .filter((position) => position >= 0 && position <= snapshot.text.text.length)
        .map((position) => snapshot.syntax.nodeAt(position));
    for (const node of candidates) {
        const kind =
            node.kind === "BracketedIdentifier"
                ? "bracket"
                : node.kind === "DoubleQuotedIdentifier"
                  ? "doubleQuote"
                  : undefined;
        if (!kind || offset < node.start + 1 || offset > node.end - 1) continue;
        return { kind, start: node.start, end: node.end, closed: true };
    }

    // During typing, the closing delimiter may not exist yet and therefore has no lexer token.
    // Limit this fallback to the current line and reject string-literal nodes so SQL string text
    // cannot accidentally become an identifier completion context.
    const current = snapshot.syntax.nodeAt(offset);
    if (current.kind === "StringLiteral") return undefined;
    const lineStart =
        Math.max(
            snapshot.text.text.lastIndexOf("\n", offset - 1),
            snapshot.text.text.lastIndexOf("\r", offset - 1),
        ) + 1;
    const leading = snapshot.text.text.slice(lineStart, offset);
    const bracket = /\[((?:[^\]]|\]\])*)$/u.exec(leading);
    if (bracket?.index !== undefined) {
        return {
            kind: "bracket",
            start: lineStart + bracket.index,
            end: offset,
            closed: false,
        };
    }
    const doubleQuote = /"((?:[^"]|"")*)$/u.exec(leading);
    if (doubleQuote?.index !== undefined) {
        return {
            kind: "doubleQuote",
            start: lineStart + doubleQuote.index,
            end: offset,
            closed: false,
        };
    }
    return undefined;
}

function multipartQualifierBefore(text: string, partStart: number): string {
    const identifier = String.raw`(?:\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*"|[\p{L}_$#@][\p{L}\p{N}_$#@]*)`;
    const match = new RegExp(String.raw`(?:${identifier}\s*\.\s*)+$`, "u").exec(
        text.slice(0, partStart),
    );
    return match?.[0] ?? "";
}

function isIdentifierCompletionCharacter(character: string): boolean {
    return /[\p{L}\p{N}_$#@]/u.test(character);
}

function splitMultipartPrefix(value: string): string[] {
    value = value.trim();
    const parts: string[] = [];
    let start = 0;
    let close = "";
    for (let index = 0; index < value.length; index++) {
        const character = value[index]!;
        if (!close && character === "[") close = "]";
        else if (!close && character === '"') close = '"';
        else if (close && character === close) {
            if (value[index + 1] === close) index++;
            else close = "";
        } else if (!close && character === ".") {
            parts.push(value.slice(start, index));
            start = index + 1;
        }
    }
    parts.push(value.slice(start));
    if (value.endsWith(".")) parts.pop();
    return parts;
}

function completionIdentifierInsertion(
    prefix: PrefixContext,
    value: string,
    quoteIfNeeded = true,
): string {
    if (prefix.delimiter?.kind === "bracket") {
        return `${value.replaceAll("]", "]]")}${prefix.delimiter.closed ? "" : "]"}`;
    }
    if (prefix.delimiter?.kind === "doubleQuote") {
        return `${value.replaceAll('"', '""')}${prefix.delimiter.closed ? "" : '"'}`;
    }
    return quoteIfNeeded ? quoteIdentifierIfNeeded(value) : value;
}

function completionMultipartInsertion(prefix: PrefixContext, parts: readonly string[]): string {
    if (prefix.delimiter?.kind === "bracket") {
        const content = parts.map((part) => part.replaceAll("]", "]]")).join("].[");
        return `${content}${prefix.delimiter.closed ? "" : "]"}`;
    }
    if (prefix.delimiter?.kind === "doubleQuote") {
        const content = parts.map((part) => part.replaceAll('"', '""')).join('"."');
        return `${content}${prefix.delimiter.closed ? "" : '"'}`;
    }
    return parts.map(quoteIdentifierIfNeeded).join(".");
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

const completionKeywords = Object.freeze(
    [...new Set([...reservedKeywordNames, ...contextualKeywordNames])]
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

function keywordCompletions(prefix: PrefixContext, view: MetadataView): readonly CompletionItem[] {
    if (prefix.prefix.length === 0) return [];
    const folded = prefix.prefix.toLocaleLowerCase();
    return completionKeywords
        .filter((keyword) => {
            if (!keyword.toLocaleLowerCase().startsWith(folded)) return false;
            const metadata = keywordMetadata(keyword);
            return (
                metadata?.category !== "reserved" ||
                metadata.minimumCompatibility <= (view.environment.compatibilityLevel ?? 170)
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

function dataTypeCompletions(prefix: PrefixContext, view: MetadataView): readonly CompletionItem[] {
    const folded = prefix.prefix.toLocaleLowerCase();
    return builtInsOfKind("dataType")
        .filter((entry) => isBuiltInAvailable(entry, builtInProfile(view)))
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
    view: MetadataView,
): readonly CompletionItem[] {
    const folded = prefix.prefix.toLocaleLowerCase();
    return builtInsOfKind("routine")
        .filter((entry) => isBuiltInAvailable(entry, builtInProfile(view)))
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

function builtInProfile(view: MetadataView): { readonly compatibilityLevel?: number } {
    return view.environment.compatibilityLevel === undefined
        ? {}
        : { compatibilityLevel: view.environment.compatibilityLevel };
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

function preserveIdentifierQuotes(original: string, replacement: string): string {
    if (original.startsWith("[") && original.endsWith("]")) return quoteIdentifier(replacement);
    if (original.startsWith('"') && original.endsWith('"')) {
        return `"${replacement.replaceAll('"', '""')}"`;
    }
    return replacement;
}

function quoteIdentifier(value: string): string {
    return "[" + value.replaceAll("]", "]]") + "]";
}

function quoteIdentifierIfNeeded(value: string): string {
    return /^[\p{L}_#][\p{L}\p{N}_$#@]*$/u.test(value) ? value : quoteIdentifier(value);
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

function ancestor(node: SyntaxNode | undefined, kinds: readonly string[]): SyntaxNode | undefined {
    for (let current = node; current; current = current.parent()) {
        if (kinds.includes(current.kind)) return current;
    }
    return undefined;
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

function visit(node: SyntaxNode, callback: (node: SyntaxNode) => void): void {
    callback(node);
    for (const child of node.children()) visit(child, callback);
}

function firstDescendant(node: SyntaxNode, kind: string): SyntaxNode | undefined {
    for (const child of node.children()) {
        if (child.kind === kind) return child;
        const nested = firstDescendant(child, kind);
        if (nested) return nested;
    }
    return undefined;
}

function lastDescendant(node: SyntaxNode, kind: string): SyntaxNode | undefined {
    let result: SyntaxNode | undefined;
    visit(node, (candidate) => {
        if (candidate.kind === kind) result = candidate;
    });
    return result;
}

function descendants(node: SyntaxNode, kind: string): SyntaxNode[] {
    const result: SyntaxNode[] = [];
    visit(node, (candidate) => {
        if (candidate !== node && candidate.kind === kind) result.push(candidate);
    });
    return result;
}

function directChild(node: SyntaxNode, kind: string): SyntaxNode | undefined {
    return [...node.children()].find((child) => child.kind === kind);
}

function hasDescendant(node: SyntaxNode, kind: string): boolean {
    return firstDescendant(node, kind) !== undefined;
}

function assertOffset(snapshot: DocumentAnalysisSnapshot, offset: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset > snapshot.text.length) {
        throw new RangeError(`Invalid completion offset ${offset}`);
    }
}
