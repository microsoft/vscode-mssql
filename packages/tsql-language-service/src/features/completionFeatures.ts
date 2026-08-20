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
    SqlPrincipalKind,
} from "../metadata/index.js";
import type { DocumentAnalysisSnapshot, LanguageServiceRuntime } from "../runtime/index.js";
import {
    builtInsOfKind,
    isBuiltInAvailable,
    lookupBuiltIn,
    type BuiltInProfile,
} from "../common/builtInRegistry.js";
import {
    catalogOwnershipSortRank,
    isSystemDatabaseName,
    isSystemSchemaName,
} from "../common/catalogPresentationPolicy.js";
import { latestCompatibilityLevel, type TsqlFeatureProfile } from "../common/engineCapabilities.js";
import { xmlDataTypeMembers } from "../common/typeMemberRegistry.js";
import {
    platformFeatureKeywords,
    platformOnlyKeywords,
} from "../common/platformFeatureRegistry.js";
import {
    buildCursorContext,
    localColumnsForName as modelLocalColumns,
    multipartIdentifierParts,
    normalizeIdentifier,
    type CursorContext,
    type ExpressionType,
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
    firstDescendantOfKind as firstDescendant,
} from "../syntax/treeUtilities.js";
import { CatalogFeatureContext } from "./catalogFeatureContext.js";
import { CompletionExpansionProvider } from "./completionExpansions.js";
import {
    completionIdentifierInsertion,
    completionMultipartInsertion,
    completionPrefix,
    type PrefixContext,
} from "./completionPrefix.js";
import { assertDocumentOffset } from "./featureSnapshotUtilities.js";
import { sourceForQualifier, visibleQuerySources } from "./querySources.js";
import { principalHoverMarkdown, qualifiedCatalogName } from "./catalogPresentation.js";
import { signatureContext } from "./signatureHelp.js";
import type { CompletionItem, CompletionResult } from "./contracts.js";

const tableKinds = ["table", "view", "tableFunction", "synonym"] as const;
const maximumCatalogItems = 1_000;

/** Completion and expansion policy over one published semantic snapshot and pinned catalog view. */
export class CompletionFeatureProvider {
    private readonly _expansions: CompletionExpansionProvider;

    public constructor(
        private readonly _runtime: LanguageServiceRuntime,
        private readonly _metadata: MetadataProvider,
        private readonly _catalog: CatalogFeatureContext,
    ) {
        this._expansions = new CompletionExpansionProvider(_catalog);
    }

    public completion(uri: string, version: number, offset: number): CompletionResult {
        const snapshot = this._runtime.snapshot(uri, version);
        assertDocumentOffset(snapshot, offset);
        const view = snapshot.metadata;
        const items: CompletionItem[] = [];
        let incomplete = false;

        const star = this._expansions.star(snapshot, view, offset);
        const adjacentStar =
            snapshot.text.text[offset - 1] === "*" || snapshot.text.text[offset] === "*";
        if (adjacentStar && (star.item || star.incomplete)) {
            return { items: star.item ? [star.item] : [], incomplete: star.incomplete };
        }
        if (star.item) items.push(star.item);
        incomplete ||= star.incomplete;

        const insert = this._expansions.insert(snapshot, view, offset);
        if (insert.item) items.push(insert.item);
        incomplete ||= insert.incomplete;

        // One cursor product, built once: the semantic model answers what the caret names and how
        // damaged the surrounding syntax is, and the prefix answers what text an edit replaces.
        // Completion reads that object rather than re-deriving context per branch.
        const context = completionContextAt(snapshot, offset);
        const { prefix, principalContext, objectContext, dataTypeContext } = context;
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
                : this._catalog.columns(view, source.object!, "completion");
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
            items.push(...localObjectCompletions(snapshot, view, offset, prefix));
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
            items.push(...relationQualifierCompletions(snapshot, view, offset, prefix));
            items.push(...localSymbolCompletions(snapshot, prefix));
            if (context.expression) {
                items.push(...builtInFunctionCompletions(prefix, snapshot.syntax.profile));
                items.push(...scalarFunctionCompletions(view, prefix));
            }
            items.push(...keywordCompletions(prefix, snapshot.syntax.profile));
        }

        if (context.vectorParameter) {
            items.push(...vectorParameterCompletions(prefix));
        }

        // Members come from the receiver's bound type, which is the same type hover shows and
        // argument validation compares against.
        items.push(...memberCompletions(snapshot, view, prefix));

        return { items: deduplicate(items), incomplete };
    }

    public resolveCompletion(item: CompletionItem): Promise<CompletionItem> {
        return Promise.resolve(item);
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
        for (const source of visibleQuerySources(snapshot, view, query)) {
            const columns = source.columns
                ? { value: source.columns, incomplete: false }
                : this._catalog.columns(view, source.object!, "completion");
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
        const context = signatureContext(snapshot, offset);
        if (context?.kind !== "insert" || !context.namingColumns) {
            return { items: [], incomplete: false };
        }
        const parts = context.target;
        const resolution = view.resolveObject(parts);
        const columns =
            resolution.kind === "resolved"
                ? this._catalog.columns(view, resolution.object, "completion")
                : { value: localColumnsForName(snapshot, parts, offset), incomplete: false };
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
        const context = signatureContext(snapshot, offset);
        if (context?.kind !== "execute") return { items: [], incomplete: false };
        const resolution = view.resolveObject(context.target);
        if (resolution.kind !== "resolved" || resolution.object.kind !== "procedure") {
            return { items: [], incomplete: resolution.kind === "unknown" };
        }
        const state = view.parameterState(resolution.object.ref);
        if (state.kind !== "loaded") {
            this._catalog.hydrate(
                {
                    section: "parameters",
                    object: resolution.object.ref,
                    priority: "interactive",
                },
                "completion",
            );
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
                sortText: `${catalogOwnershipSortRank(isSystemDatabaseName(database.name))}-${database.name.toLowerCase()}`,
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
                sortText: `${schemaRank(schema.name)}-${schema.name.toLowerCase()}`,
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
                    sortText: `${schemaRank(schema.name)}-${schema.name.toLowerCase()}`,
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
            detail: `${object.system ? "system " : ""}${object.kind} ${qualifiedCatalogName(object)}`,
            documentation: `SQL ${object.kind} \`${qualifiedCatalogName(object)}\``,
            sortText: `${objectSortRank(object)}-${object.name.toLowerCase()}`,
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
    if (incomplete) {
        provider.requestHydration({
            section: "principals",
            priority: "interactive",
            reason: "completion",
        });
    }
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
            documentation: principalHoverMarkdown(principal),
            sortText: `${catalogOwnershipSortRank(principal.system === true)}-${principal.name.toLowerCase()}`,
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

function columnCompletion(
    column: ColumnMetadata,
    qualifier: string,
    prefix: PrefixContext,
): CompletionItem {
    return {
        label: column.name,
        kind: "column",
        detail: `${column.typeDisplay ?? "column"}${column.nullable ? " null" : ""}`,
        sortText: `10-${column.name.toLowerCase()}`,
        edit: {
            ...prefix.range,
            newText: completionIdentifierInsertion(prefix, column.name),
        },
        data: { qualifier },
    };
}

// The general keyword catalogue plus words owned by the platform registry. Some dialect words are
// intentionally parser-local, so the active profile contributes them to completion explicitly.
const generalKeywords: ReadonlySet<string> = new Set(
    [...reservedKeywordNames, ...contextualKeywordNames].map((keyword) => keyword.toUpperCase()),
);
/**
 * Words a platform feature contributes that are really routine names.
 *
 * `JSON_ARRAY` is both a gated feature keyword and a registry routine. Offered from both lists it
 * appears twice, and the bare keyword carries none of the documentation or signature the registry
 * entry has, so the routine lists own these names and the keyword list drops them.
 */
const routineFeatureKeywords: ReadonlySet<string> = new Set(
    platformFeatureKeywords
        .filter((keyword) => lookupBuiltIn(keyword, "routine") !== undefined)
        .map((keyword) => keyword.toUpperCase()),
);

const completionKeywords = Object.freeze(
    [...new Set([...generalKeywords, ...platformFeatureKeywords])]
        .map((keyword) => keyword.toUpperCase())
        .filter((keyword) => !routineFeatureKeywords.has(keyword))
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
    const folded = prefix.prefix.toLowerCase();
    // An unreported compatibility level defers rather than restricts, so a still-connecting
    // document keeps every keyword the newest level accepts.
    const compatibility = profile.compatibilityLevel ?? latestCompatibilityLevel;
    // A word that exists only inside a feature this engine cannot run is never offered. A word the
    // general catalogue also carries is never withheld, because it is ordinary T-SQL as well.
    const withheld = platformOnlyKeywords(profile, generalKeywords);
    return completionKeywords
        .filter((keyword) => {
            if (!keyword.toLowerCase().startsWith(folded)) return false;
            if (withheld.has(keyword)) return false;
            const metadata = keywordMetadata(keyword);
            return (
                metadata?.category !== "reserved" || metadata.minimumCompatibility <= compatibility
            );
        })
        .map((keyword) => ({
            label: keyword,
            kind: "keyword",
            sortText: `40-${keyword.toLowerCase()}`,
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
    const folded = prefix.prefix.toLowerCase();
    return builtInsOfKind("dataType")
        .filter((entry) => isBuiltInAvailable(entry, builtInProfile(profile)))
        .map((entry) => entry.name.toUpperCase())
        .filter((type) => type.toLowerCase().startsWith(folded))
        .map((type) => ({
            label: type,
            kind: "type",
            detail: "SQL Server data type",
            sortText: `03-${type.toLowerCase()}`,
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
    const folded = prefix.prefix.toLowerCase();
    return builtInsOfKind("routine")
        .filter((entry) => isBuiltInAvailable(entry, builtInProfile(profile)))
        .filter((entry) => entry.signatures && entry.signatures.length > 0)
        .map((entry) => entry.name.toUpperCase())
        .filter((name) => name.toLowerCase().startsWith(folded))
        .map((name) => ({
            label: name,
            kind: "function",
            detail: "SQL Server built-in function",
            sortText: `15-${name.toLowerCase()}`,
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
/**
 * The bound type of the expression under the cursor.
 *
 * Read from the semantic model rather than inferred here, so the type a tooltip shows is the type
 * argument validation and member completion compare against. An `unknown` confidence produces no
 * hover at all: showing "unknown" would state a fact the service does not have.
 */
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
            detail: `${object.kind} ${qualifiedCatalogName(object)}`,
            sortText: `${objectSortRank(object)}-${object.name.toLowerCase()}`,
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
    const folded = prefix.prefix.toLowerCase();
    return parameters
        .filter((parameter) => parameter.name.toLowerCase().startsWith(folded))
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
    const folded = prefix.prefix.toLowerCase();
    return snapshot.semantics
        .visibleSymbols(prefix.range.end)
        .filter((symbol) => symbol.kind === "variable")
        .filter((symbol) => symbol.name.toLowerCase().startsWith(folded))
        .map((symbol) => ({
            label: symbol.name,
            kind: symbol.kind,
            detail: symbol.type?.displayName,
            sortText: `05-${symbol.name.toLowerCase()}`,
            edit: {
                ...prefix.range,
                newText: completionIdentifierInsertion(prefix, symbol.name, false),
            },
        }));
}

function relationQualifierCompletions(
    snapshot: DocumentAnalysisSnapshot,
    view: MetadataView,
    offset: number,
    prefix: PrefixContext,
): readonly CompletionItem[] {
    return snapshot.semantics.model
        .visibleRelations(offset)
        .filter((relation) => startsWith(relation.exposedName, prefix.prefix, view))
        .map((relation) => {
            const sourceName = relation.name?.object;
            const kind =
                sourceName && equal(sourceName, relation.exposedName, view)
                    ? relation.kind
                    : relation.kind === "cte" && !relation.name
                      ? "cte"
                      : relation.kind === "variable" && relation.exposedName.startsWith("@")
                        ? "variable"
                        : "alias";
            return {
                label: relation.exposedName,
                kind,
                detail: `${relation.kind} source`,
                sortText: `04-${relation.exposedName.toLowerCase()}`,
                edit: {
                    ...prefix.range,
                    newText: completionIdentifierInsertion(
                        prefix,
                        relation.exposedName,
                        kind !== "variable",
                    ),
                },
            };
        });
}

function localObjectCompletions(
    snapshot: DocumentAnalysisSnapshot,
    view: MetadataView,
    offset: number,
    prefix: PrefixContext,
): readonly CompletionItem[] {
    const candidates = new Map<string, { readonly name: string; readonly kind: string }>();
    const add = (name: string, kind: string): void => {
        if (!startsWith(name, prefix.prefix, view)) return;
        const key = view.environment.caseSensitive ? name : name.toLowerCase();
        candidates.set(key, { name, kind });
    };

    for (const relation of snapshot.semantics.model.visibleRelations(offset)) {
        if (relation.kind === "cte" && !relation.name) add(relation.exposedName, "cte");
    }

    for (const event of snapshot.semantics.model.timeline.events) {
        if (event.offset > offset || event.kind !== "table" || event.action === "drop") continue;
        const state = snapshot.semantics.model.timeline.resolve(event.parts, offset, ["table"]);
        if (!state?.exists || state.event?.offset !== event.offset) continue;
        const name = normalizeIdentifier(event.parts.at(-1) ?? "");
        if (name) add(name, name.startsWith("#") ? "tempTable" : "localTable");
    }

    for (const symbol of snapshot.semantics.visibleSymbols(offset)) {
        if (symbol.kind !== "variable" || !symbol.declaration) continue;
        const declaration = ancestor(snapshot.syntax.nodeAt(symbol.declaration.start + 1), [
            "VariableDeclaration",
        ]);
        if (declaration && firstDescendant(declaration, "TableDefinition")) {
            add(symbol.name, "variable");
        }
    }

    return [...candidates.values()].map(({ name, kind }) => ({
        label: name,
        kind,
        detail: "document-local object",
        sortText: `00-${name.toLowerCase()}`,
        edit: {
            ...prefix.range,
            newText: completionIdentifierInsertion(prefix, name, kind !== "variable"),
        },
    }));
}

function vectorParameterCompletions(prefix: PrefixContext): readonly CompletionItem[] {
    const folded = prefix.prefix.toLowerCase();
    return vectorParameters
        .filter((parameter) => parameter.toLowerCase().startsWith(folded))
        .map((parameter) => ({
            label: parameter,
            kind: "property",
            detail: "VECTOR_SEARCH named parameter",
            sortText: `02-${parameter.toLowerCase()}`,
            edit: { ...prefix.range, newText: `${parameter} = ` },
        }));
}

function isVectorParameterContext(snapshot: DocumentAnalysisSnapshot, offset: number): boolean {
    if (ancestor(snapshot.syntax.nodeAt(offset), ["VectorSearchTableSource"])) return true;
    const leading = snapshot.text.text.slice(Math.max(0, offset - 2_000), offset);
    const start = leading.toLowerCase().lastIndexOf("vector_search(");
    if (start < 0) return false;
    let depth = 0;
    for (const character of leading.slice(start + "vector_search".length)) {
        if (character === "(") depth++;
        else if (character === ")") depth--;
    }
    return depth > 0;
}

/** The shape of a document-local rowset at an offset, from the model's one implementation. */
function localColumnsForName(
    snapshot: DocumentAnalysisSnapshot,
    parts: readonly string[],
    useOffset: number,
): readonly ColumnMetadata[] | undefined {
    return modelLocalColumns({ syntax: snapshot.syntax }, parts, useOffset);
}

/**
 * Everything completion needs to know about one caret position.
 *
 * The semantic half — what the caret names, which scope it is in, and whether the parser had to
 * recover — comes from the published {@link CursorContext}; the textual half is the delimiter-aware
 * prefix an edit replaces. Building both here means completion never rebuilds either, and a caller
 * that needs to know the syntax was damaged can ask instead of guessing.
 */
interface CompletionContext {
    readonly cursor: CursorContext;
    readonly prefix: PrefixContext;
    readonly principalContext: PrincipalCompletionContext | undefined;
    readonly objectContext: CatalogCompletionContext | undefined;
    readonly dataTypeContext: boolean;
    readonly expression: boolean;
    readonly vectorParameter: boolean;
}

function completionContextAt(
    snapshot: DocumentAnalysisSnapshot,
    offset: number,
): CompletionContext {
    const prefix = completionPrefix(snapshot, offset);
    const cursor = buildCursorContext(snapshot.syntax, snapshot.semantics.model, offset);
    return {
        cursor,
        prefix,
        principalContext: principalCompletionContext(snapshot, prefix.contextStart),
        objectContext: catalogCompletionContext(snapshot, offset, cursor),
        dataTypeContext: cursor.expected === "datatype",
        expression:
            cursor.expected === "column" ||
            cursor.expected === "function" ||
            cursor.expected === "parameter" ||
            Boolean(
                ancestor(snapshot.syntax.nodeAt(offset), [
                    "ReturnStatement",
                    "WhenClause",
                    "CaseExpression",
                    "SetStatement",
                    "PrintStatement",
                    "ThrowStatement",
                ]),
            ),
        vectorParameter: isVectorParameterContext(snapshot, offset),
    };
}

/**
 * Members offered after a `.` on a typed receiver.
 *
 * The receiver's type comes from the semantic model, so a value hover describes as `xml` offers
 * XML methods, and a CLR type offers the members its metadata reports. A receiver whose type the
 * binder could not determine offers nothing rather than guessing.
 */
function memberCompletions(
    snapshot: DocumentAnalysisSnapshot,
    view: MetadataView,
    prefix: PrefixContext,
): readonly CompletionItem[] {
    // A member position is written `receiver.` — the qualifier is the receiver, not a schema.
    if (prefix.qualifiers.length === 0) return [];
    const receiver = receiverTypeAt(snapshot, prefix);
    if (!receiver || receiver.confidence === "unknown") return [];

    if (receiver.category === "xml") {
        return xmlDataTypeMembers
            .filter((method) => startsWith(method.name, prefix.prefix, view))
            .map((method) => ({
                label: method.name,
                kind: "method",
                detail: method.detail,
                sortText: `05-${method.name}`,
                edit: { ...prefix.range, newText: method.name },
            }));
    }
    if (receiver.category !== "clr") return [];
    const resolution = view.resolveObject(multipartIdentifierParts(receiver.displayName));
    if (resolution.kind !== "resolved") return [];
    const state = view.clrTypeState(resolution.object.ref);
    if (state.kind !== "loaded") return [];
    return state.value.members
        .filter((member) => !member.static && startsWith(member.name, prefix.prefix, view))
        .map((member) => ({
            label: member.name,
            kind: member.kind === "method" ? "method" : "property",
            detail: `${member.kind}${member.typeDisplay ? `: ${member.typeDisplay}` : ""}`,
            sortText: `05-${member.name}`,
            edit: { ...prefix.range, newText: member.name },
        }));
}

/** The bound type of the receiver a member position is qualified by. */
function receiverTypeAt(
    snapshot: DocumentAnalysisSnapshot,
    prefix: PrefixContext,
): ExpressionType | undefined {
    // The receiver ends where the qualifier's trailing dot begins, so the character before the
    // written prefix is inside it.
    const receiverEnd = prefix.contextStart - 1;
    if (receiverEnd <= 0) return undefined;
    return snapshot.semantics.model.typeAt(receiverEnd - 1);
}

interface CatalogCompletionContext {
    readonly kinds: readonly ObjectMetadata["kind"][];
}

function catalogCompletionContext(
    snapshot: DocumentAnalysisSnapshot,
    offset: number,
    cursor: CursorContext,
): CatalogCompletionContext | undefined {
    const node = snapshot.syntax.nodeAt(Math.max(0, Math.min(offset, snapshot.text.length) - 1));
    if (ancestor(node, ["InsertColumnList"])) return undefined;
    if (ancestor(node, ["ExecutableEntity"])) {
        return { kinds: ["procedure"] };
    }
    const functionDdl = ancestor(node, [
        "CreateFunctionStatement",
        "AlterFunctionStatement",
        "DropFunctionStatement",
    ]);
    if (functionDdl) {
        return ddlObjectNameAt(functionDdl, offset, ["MultipartIdentifier"])
            ? { kinds: ["scalarFunction", "tableFunction"] }
            : undefined;
    }
    const viewDdl = ancestor(node, [
        "CreateViewStatement",
        "AlterViewStatement",
        "DropViewStatement",
    ]);
    if (viewDdl) {
        return ddlObjectNameAt(viewDdl, offset, ["MultipartIdentifier"])
            ? { kinds: ["view"] }
            : undefined;
    }
    const tableDdl = ancestor(node, [
        "CreateTableStatement",
        "AlterTableStatement",
        "DropTableStatement",
        "TruncateTableStatement",
    ]);
    if (tableDdl) {
        return ddlObjectNameAt(tableDdl, offset, ["TableSourceName", "MultipartIdentifier"])
            ? { kinds: ["table"] }
            : undefined;
    }
    const dmlTarget = ancestor(node, ["DmlTarget"]);
    if (dmlTarget) {
        const targetName = firstDescendant(dmlTarget, "TableSourceName");
        return targetName && offset <= targetName.end
            ? { kinds: ["table", "view", "synonym"] }
            : undefined;
    }
    if (
        cursor.expected === "relation" ||
        ancestor(node, ["FromClause", "TableSource", "JoinPart", "ApplyJoin"])
    ) {
        return { kinds: tableKinds };
    }
    return undefined;
}

/**
 * Whether the caret is in one of the object-name children owned directly by a DDL statement.
 *
 * Looking only at the statement kind is too broad: a cursor in a view query, function body, table
 * definition, or table option is still beneath that statement and would otherwise be mistaken for
 * a catalog object name. The grammar gives declaration/target names a direct wrapper, so this
 * remains tree-based and also works for recovered multipart names.
 */
function ddlObjectNameAt(
    statement: SyntaxNode,
    offset: number,
    nameKinds: readonly string[],
): boolean {
    return [...statement.children()].some(
        (child) => nameKinds.includes(child.kind) && child.start <= offset && offset <= child.end,
    );
}

function principalCompletionContext(
    snapshot: DocumentAnalysisSnapshot,
    prefixStart: number,
): PrincipalCompletionContext | undefined {
    const node = snapshot.syntax.nodeAt(prefixStart);
    const principal = ancestor(node, ["AlterPrincipalStatement", "DropPrincipalStatement"]);
    if (principal) {
        const words = structuralWords(snapshot.syntax, principal, prefixStart);
        const member = words.at(-2) === "ADD" && words.at(-1) === "MEMBER";
        if (words[0] === "ALTER" && words[1] === "SERVER" && words[2] === "ROLE") {
            return member ? { kinds: ["login", "serverRole"] } : { kinds: ["serverRole"] };
        }
        if (words[0] === "ALTER" && words[1] === "ROLE") {
            return member
                ? { kinds: ["user", "databaseRole", "applicationRole"] }
                : { kinds: ["databaseRole"] };
        }
        if (["ALTER", "DROP"].includes(words[0] ?? "") && words[1] === "LOGIN") {
            return { kinds: ["login"] };
        }
        if (["ALTER", "DROP"].includes(words[0] ?? "") && words[1] === "USER") {
            return { kinds: ["user"] };
        }
    }

    const userCreation = ancestor(node, ["UserCreationClause"]);
    if (userCreation) {
        const words = structuralWords(snapshot.syntax, userCreation, prefixStart);
        if (words.at(-2) === "LOGIN" && words.at(-1) === "=") return { kinds: ["login"] };
    }

    const executeAs = ancestor(node, ["ExecuteAsStatement"]);
    if (executeAs) {
        const words = structuralWords(snapshot.syntax, executeAs, prefixStart);
        if (words.at(-2) === "LOGIN" && words.at(-1) === "=") return { kinds: ["login"] };
        if (words.at(-2) === "USER" && words.at(-1) === "=") return { kinds: ["user"] };
    }

    const permission = ancestor(node, ["PermissionStatement"]);
    if (permission) {
        const last = structuralWords(snapshot.syntax, permission, prefixStart).at(-1);
        if (last === "TO" || last === "FROM") {
            return { kinds: ["user", "databaseRole", "applicationRole"] };
        }
    }
    return undefined;
}

function structuralWords(
    syntax: SyntaxSnapshot,
    owner: SyntaxNode,
    end: number,
): readonly string[] {
    return [...syntax.tokens({ start: owner.start, end: Math.min(owner.end, end) })]
        .filter((token) => !token.trivia && token.end <= end)
        .map((token) => token.text.toUpperCase());
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
        provider.requestHydration({
            section,
            database,
            priority: "interactive",
            reason: "completion",
        });
    }
    return state !== "ready";
}

function schemaRank(name: string): string {
    return catalogOwnershipSortRank(isSystemSchemaName(name));
}

function objectSortRank(object: ObjectMetadata): string {
    return catalogOwnershipSortRank(object.system === true || isSystemSchemaName(object.schema));
}

function startsWith(value: string, prefix: string, view: MetadataView): boolean {
    return view.nameComparison.startsWith(value, prefix);
}

function equal(left: string, right: string, view: MetadataView): boolean {
    return view.nameComparison.equals(left, right);
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
