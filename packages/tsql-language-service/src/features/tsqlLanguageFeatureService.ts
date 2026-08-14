/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    ColumnMetadata,
    MetadataProvider,
    MetadataView,
    ObjectMetadata,
} from "../metadata/index.js";
import type { DocumentAnalysisSnapshot, LanguageServiceRuntime } from "../runtime/index.js";
import { multipartIdentifierParts, normalizeIdentifier } from "../semantics/index.js";
import type { SyntaxNode } from "../syntax/index.js";
import type {
    CompletionItem,
    CompletionResult,
    DocumentSymbol,
    HoverResult,
    LanguageFeatureService,
    Location,
    SignatureHelp,
    TextEdit,
} from "./contracts.js";

const tableKinds = ["table", "view", "tableFunction", "synonym"] as const;
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

        const prefix = completionPrefix(snapshot.text.text, offset);
        const source = sourceForQualifier(snapshot, view, offset, prefix.qualifiers);
        if (source) {
            const columns = source.columns
                ? { value: source.columns, incomplete: false }
                : this.columns(view, source.object!);
            incomplete ||= columns.incomplete;
            if (columns.value) {
                items.push(
                    ...columns.value
                        .filter((column) => startsWith(column.name, prefix.prefix, view))
                        .map((column) => columnCompletion(column, source.qualifier, prefix.range)),
                );
            }
        } else if (isObjectCompletionContext(snapshot.text.text, prefix.range.start)) {
            const catalog = catalogCompletions(view, prefix);
            items.push(...catalog.items);
            incomplete ||= catalog.incomplete;
            items.push(...localObjectCompletions(snapshot, prefix));
        } else if (prefix.qualifiers.length === 0) {
            const sourceColumns = this.unqualifiedSourceCompletions(snapshot, view, offset, prefix);
            items.push(...sourceColumns.items);
            incomplete ||= sourceColumns.incomplete;
            const insertColumns = this.insertColumnCompletions(snapshot, view, offset, prefix);
            items.push(...insertColumns.items);
            incomplete ||= insertColumns.incomplete;
            items.push(...localSymbolCompletions(snapshot, prefix));
            items.push(...keywordCompletions(prefix));
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
        const symbol = snapshot.semantics.symbolAt(offset);
        if (!symbol) return undefined;
        const object = symbol.object && this._metadata.pin().object(symbol.object);
        const type = symbol.type
            ? `\n\nType: \`${symbol.type.displayName}${symbol.type.nullable ? " NULL" : " NOT NULL"}\``
            : "";
        const source = object ? `\n\nSource: \`${qualifiedName(object)}\`` : "";
        return {
            range: occurrenceRange(snapshot, offset) ?? symbol.declaration,
            markdown:
                symbol.kind === "column"
                    ? `**column** \`${symbol.name}\`${type}${source}`
                    : object
                      ? `**${object.kind}** \`${qualifiedName(object)}\``
                      : `**${symbol.kind}** \`${symbol.name}\`${type}`,
        };
    }

    public definition(_uri: string, _version: number, _offset: number): readonly Location[] {
        const snapshot = this._runtime.snapshot(_uri, _version);
        const symbol = snapshot.semantics.symbolAt(_offset);
        return symbol?.declaration ? [{ uri: _uri, range: symbol.declaration }] : [];
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

    public foldingRanges(uri: string, version: number) {
        const snapshot = this._runtime.snapshot(uri, version);
        const result: { start: number; end: number }[] = [];
        visit(snapshot.syntax.root(), (node) => {
            if (node.kind === "Script" || node.end <= node.start) return;
            if (/\r|\n/u.test(snapshot.text.text.slice(node.start, node.end))) {
                result.push({ start: node.start, end: node.end });
            }
        });
        return result;
    }

    public selectionRanges(uri: string, version: number, offsets: readonly number[]) {
        const snapshot = this._runtime.snapshot(uri, version);
        return offsets.map((offset) => {
            assertOffset(snapshot, offset);
            const node = snapshot.syntax.nodeAt(offset);
            return { start: node.start, end: node.end };
        });
    }

    public signatureHelp(
        _uri: string,
        _version: number,
        _offset: number,
    ): SignatureHelp | undefined {
        return undefined;
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
        for (const source of collectSources(snapshot, view, query)) {
            const columns = source.columns
                ? { value: source.columns, incomplete: false }
                : this.columns(view, source.object!);
            incomplete ||= columns.incomplete;
            if (!columns.value) continue;
            items.push(
                ...columns.value
                    .filter((column) => startsWith(column.name, prefix.prefix, view))
                    .map((column) => columnCompletion(column, source.qualifier, prefix.range)),
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
                .map((column) => columnCompletion(column, parts.at(-1) ?? "", prefix.range)),
        };
    }

    private starExpansion(
        snapshot: DocumentAnalysisSnapshot,
        view: MetadataView,
        offset: number,
    ): { readonly item?: CompletionItem; readonly incomplete: boolean } {
        const text = snapshot.text.text;
        const starOffset =
            text[offset - 1] === "*" ? offset - 1 : text[offset] === "*" ? offset : -1;
        if (starOffset < 0) return { incomplete: false };
        const leaf = snapshot.syntax.nodeAt(starOffset + 1);
        const star = ancestor(leaf, ["StarExpression", "Star"]);
        if (!star || !ancestor(star, ["SelectElement"])) return { incomplete: false };
        const query = ancestor(star, ["QuerySpecification"]);
        if (!query) return { incomplete: false };
        const sources = collectSources(snapshot, view, query);
        if (sources.length === 0) return { incomplete: false };

        const sourcePrefix = sourcePrefixForStar(text.slice(star.start, star.end));
        const selected = sourcePrefix
            ? sources.filter((source) => equal(source.qualifier, sourcePrefix, view))
            : sources;
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
        if (
            !statement ||
            hasDescendant(statement, "InsertColumnList") ||
            hasDescendant(statement, "InsertSource")
        ) {
            return { incomplete: false };
        }
        const target = firstDescendant(statement, "DmlTarget");
        const name = target && firstDescendant(target, "MultipartIdentifier");
        if (!name || offset < name.end) return { incomplete: false };
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
        const values = insertable.map(() => `${childIndent}NULL`);
        const cleanupEnd = insertCleanupEnd(snapshot.text.text, name.end);
        return {
            incomplete: columns.incomplete,
            item: {
                label: "Expand INSERT columns and VALUES",
                kind: "snippet",
                detail: `${insertable.length} insertable columns from ${qualifiedName(resolution.object)}`,
                sortText: "0001-expand-insert",
                edit: {
                    start: name.end,
                    end: cleanupEnd,
                    newText: ` (\n${names.join(",\n")}\n${indent})\n${indent}VALUES (\n${values.join(",\n")}\n${indent});`,
                },
            },
        };
    }
}

interface PrefixContext {
    readonly qualifiers: readonly string[];
    readonly prefix: string;
    readonly range: { readonly start: number; readonly end: number };
}

interface BoundSource {
    readonly qualifier: string;
    readonly object?: ObjectMetadata;
    readonly columns?: readonly ColumnMetadata[];
}

function completionPrefix(text: string, offset: number): PrefixContext {
    let start = offset;
    while (start > 0 && /[\p{L}\p{N}_$#@.\[\]"]/u.test(text[start - 1]!)) start--;
    const value = text.slice(start, offset);
    const rawParts = splitMultipartPrefix(value);
    const trailingDot = value.endsWith(".");
    const prefix = trailingDot ? "" : normalizeIdentifier(rawParts.pop() ?? "");
    const qualifierLength = trailingDot ? value.length : value.lastIndexOf(".") + 1;
    return {
        qualifiers: rawParts.map(normalizeIdentifier),
        prefix,
        range: { start: start + qualifierLength, end: offset },
    };
}

function splitMultipartPrefix(value: string): string[] {
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

function catalogCompletions(
    view: MetadataView,
    prefix: PrefixContext,
): { readonly items: readonly CompletionItem[]; readonly incomplete: boolean } {
    const items: CompletionItem[] = [];
    if (prefix.qualifiers.length === 0) {
        for (const schema of view.schemas(view.environment.currentDatabase) ?? []) {
            if (!startsWith(schema.name, prefix.prefix, view)) continue;
            items.push({
                label: schema.name,
                kind: "schema",
                detail: schema.database ? `schema in ${schema.database}` : "schema",
                sortText: `${schemaRank(schema.name, view)}-${schema.name.toLocaleLowerCase()}`,
                edit: { ...prefix.range, newText: quoteIdentifierIfNeeded(schema.name) },
            });
        }
    } else if (prefix.qualifiers.length === 1) {
        const database = prefix.qualifiers[0]!;
        const knownDatabase =
            (view.databases() ?? []).some((candidate) => equal(candidate.name, database, view)) ||
            (view.schemas(database) ?? []).some(
                (schema) => schema.database && equal(schema.database, database, view),
            );
        if (knownDatabase) {
            for (const schema of view.schemas(database) ?? []) {
                if (!startsWith(schema.name, prefix.prefix, view)) continue;
                items.push({
                    label: schema.name,
                    kind: "schema",
                    detail: `schema in ${schema.database ?? database}`,
                    sortText: `${schemaRank(schema.name, view)}-${schema.name.toLocaleLowerCase()}`,
                    edit: { ...prefix.range, newText: quoteIdentifierIfNeeded(schema.name) },
                });
            }
        }
    }
    const scope = objectScope(prefix.qualifiers, view);
    if (!scope && prefix.qualifiers.length > 0) return { items, incomplete: false };
    const objects = view.searchObjects({
        database: scope?.database,
        schema: scope?.schema,
        prefix: prefix.prefix,
        kinds: tableKinds,
        limit: maximumCatalogItems + 1,
    });
    for (const object of objects.slice(0, maximumCatalogItems)) {
        items.push({
            label: object.name,
            kind: object.kind,
            detail: `${object.system ? "system " : ""}${object.kind} ${qualifiedName(object)}`,
            sortText: `${objectSortRank(object, view)}-${object.name.toLocaleLowerCase()}`,
            edit: { ...prefix.range, newText: quoteIdentifierIfNeeded(object.name) },
        });
    }
    return { items, incomplete: objects.length > maximumCatalogItems };
}

function objectScope(
    qualifiers: readonly string[],
    view: MetadataView,
): { readonly database?: string; readonly schema?: string } | undefined {
    if (qualifiers.length === 0) return {};
    if (qualifiers.length === 1) {
        const schema = (view.schemas() ?? []).find((candidate) =>
            equal(candidate.name, qualifiers[0]!, view),
        );
        return schema ? { database: schema.database, schema: schema.name } : undefined;
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
    const statement = ancestor(snapshot.syntax.nodeAt(offset), ["Statement", "QuerySpecification"]);
    const sources = statement ? collectSources(snapshot, view, statement) : [];
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
            if (
                !name ||
                normalizeIdentifier(
                    snapshot.text.text.slice(name.start, name.end),
                ).toLocaleLowerCase() !== "openjson"
            )
                return;
            const alias = firstDescendant(node, "TableAlias");
            const aliasName = alias && lastDescendant(alias, "IdentifierName");
            if (!aliasName) return;
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
            result.push({
                qualifier: normalizeIdentifier(
                    snapshot.text.text.slice(aliasName.start, aliasName.end),
                ),
                columns,
            });
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

function columnCompletion(
    column: ColumnMetadata,
    qualifier: string,
    range: { readonly start: number; readonly end: number },
): CompletionItem {
    return {
        label: column.name,
        kind: "column",
        detail: `${column.typeDisplay ?? "column"}${column.nullable ? " null" : ""}`,
        sortText: `10-${column.name.toLocaleLowerCase()}`,
        edit: { ...range, newText: quoteIdentifierIfNeeded(column.name) },
        data: { qualifier },
    };
}

const completionKeywords = Object.freeze([
    "ALTER",
    "AND",
    "AS",
    "BEGIN",
    "BY",
    "COMMIT",
    "CREATE",
    "CROSS",
    "DECLARE",
    "DELETE",
    "DROP",
    "ELSE",
    "END",
    "EXECUTE",
    "FETCH",
    "FROM",
    "FULL",
    "GROUP",
    "HAVING",
    "IF",
    "INNER",
    "INSERT",
    "INTO",
    "JOIN",
    "LEFT",
    "MERGE",
    "NOT",
    "NULL",
    "ON",
    "OR",
    "ORDER",
    "OUTER",
    "RETURN",
    "RIGHT",
    "ROLLBACK",
    "SELECT",
    "SET",
    "TABLE",
    "THROW",
    "TOP",
    "TRANSACTION",
    "UPDATE",
    "VALUES",
    "WHEN",
    "WHERE",
    "WHILE",
    "WINDOW",
    "WITH",
]);

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

function keywordCompletions(prefix: PrefixContext): readonly CompletionItem[] {
    if (prefix.prefix.length === 0) return [];
    const folded = prefix.prefix.toLocaleLowerCase();
    return completionKeywords
        .filter((keyword) => keyword.toLocaleLowerCase().startsWith(folded))
        .map((keyword) => ({
            label: keyword,
            kind: "keyword",
            sortText: `40-${keyword.toLocaleLowerCase()}`,
            edit: { ...prefix.range, newText: keyword },
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
            edit: { ...prefix.range, newText: symbol.name },
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
            edit: { ...prefix.range, newText: quoteIdentifierIfNeeded(symbol.name) },
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

function isObjectCompletionContext(text: string, prefixStart: number): boolean {
    const leading = text.slice(Math.max(0, prefixStart - 160), prefixStart);
    return /(?:\bFROM|\bJOIN|\bINTO|\bUPDATE|\bTABLE|\bEXEC(?:UTE)?)\s+(?:[\w\[\]".$#@]+\.)*$/iu.test(
        leading,
    );
}

function schemaRank(name: string, view: MetadataView): string {
    if (equal(name, view.environment.defaultSchema, view)) return "00";
    if (equal(name, "dbo", view)) return "01";
    if (isSystemSchema(name)) return "90";
    return "10";
}

function objectSortRank(object: ObjectMetadata, view: MetadataView): string {
    if (object.system || isSystemSchema(object.schema)) return "90";
    if (equal(object.schema, view.environment.defaultSchema, view)) return "00";
    if (equal(object.schema, "dbo", view)) return "01";
    return "10";
}

function isSystemSchema(name: string): boolean {
    return /^(?:sys|information_schema|db_(?:accessadmin|backupoperator|datareader|datawriter|ddladmin|denydatareader|denydatawriter|owner|securityadmin))$/iu.test(
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
    const match = /^(?:\s*[);])*/u.exec(text.slice(start));
    return match && match[0].trim().length > 0 ? start + match[0].length : start;
}

function lineIndent(text: string, offset: number): string {
    const lineStart =
        Math.max(text.lastIndexOf("\n", offset - 1), text.lastIndexOf("\r", offset - 1)) + 1;
    return /^\s*/u.exec(text.slice(lineStart, offset))?.[0] ?? "";
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
