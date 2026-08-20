/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ColumnMetadata, MetadataView } from "../../metadata/index.js";
import type { SyntaxNode, SyntaxSnapshot } from "../../syntax/index.js";
import {
    ancestorOfKind as ancestor,
    descendantsOfKind as descendants,
    directChildOfKind as directChild,
    firstDescendantOfKind as firstDescendant,
    hasDescendantOfKind as hasDescendant,
    lastDescendantOfKind as lastDescendant,
    visitSyntaxTree as visit,
} from "../../syntax/treeUtilities.js";
import type { TextRange } from "../../text/index.js";
import { multipartIdentifierParts, normalizeIdentifier } from "../identifiers.js";
import { itemsWithinRanges, rangeIndexFor } from "./lookups.js";
import { boundNameFrom } from "./boundName.js";
import { declaredType } from "./expressionTypes.js";
import type {
    BoundColumn,
    BoundRelation,
    BoundRelationKind,
    CatalogTimeline,
    QueryScope,
} from "./contracts.js";

/**
 * Query scopes and the rowsets visible inside them.
 *
 * Aliases, CTEs, derived tables, table-valued functions, `OPENJSON`, and table variables were each
 * rediscovered by completion, diagnostics, and coloring separately. Building them once means an
 * alias that completes also colours, resolves, and validates.
 */

/**
 * The document a local rowset shape is read from.
 *
 * Declared separately from {@link ScopeModelInput} so a caller that only needs the shape of one
 * document-local rowset does not have to build a metadata view and a structural index for it.
 */
export interface LocalRowsetInput {
    readonly syntax: SyntaxSnapshot;
}

export interface ScopeModelInput extends LocalRowsetInput {
    readonly metadata: MetadataView;
    readonly timeline: CatalogTimeline;
    readonly index: ReadonlyMap<string, readonly SyntaxNode[]>;
    /**
     * The parts of the document to build scopes for, when the caller only needs those.
     *
     * Binding a keystroke needs the scopes of the batches it is rebinding and no others, and
     * rebuilding every scope in the script for each of them was the largest single cost in a bind.
     * A scope never spans a batch, so narrowing to whole batches keeps each scope's nesting intact.
     *
     * Omitting it builds the document's scopes, which is what a feature reading the published model
     * needs; a model built from a narrowed set would be missing most of the document's queries.
     */
    readonly ranges?: readonly TextRange[];
}

/** The default projection of `OPENJSON` when no `WITH` schema narrows it. */
const defaultOpenJsonColumns: readonly ColumnMetadata[] = Object.freeze([
    { name: "key", typeDisplay: "nvarchar(4000)", nullable: false },
    { name: "value", typeDisplay: "nvarchar(max)", nullable: true },
    { name: "type", typeDisplay: "int", nullable: false },
]);

export interface ScopeModel {
    readonly scopes: readonly QueryScope[];
    readonly relations: readonly BoundRelation[];
}

export function buildScopes(input: ScopeModelInput): ScopeModel {
    const scopes: QueryScope[] = [];
    const relations: BoundRelation[] = [];
    const roots = [...scopeRootsOfKind(input, "QuerySpecification"), ...statementScopeRoots(input)];
    for (const root of roots) {
        const id = rangeKey(root);
        const parent = enclosingScope(root);
        const ctes = collectCtes(input, root, id);
        const own = classifyCteReferences(collectRelations(input, root, id), ctes);
        relations.push(...own, ...ctes);
        scopes.push(
            Object.freeze({
                id,
                range: { start: root.start, end: root.end },
                ...(parent ? { parent: rangeKey(parent) } : {}),
                relations: Object.freeze(own),
                ctes: Object.freeze(ctes),
            }) as QueryScope,
        );
    }
    scopes.sort((left, right) => left.range.start - right.range.start);
    return {
        scopes: Object.freeze(scopes),
        relations: Object.freeze(relations),
    };
}

/**
 * Marks a source that names a CTE as one.
 *
 * A CTE resolves to no catalog object, so without this its reference would be reported as an
 * ordinary table whose columns happened to be discoverable, and coloring and completion would
 * describe the same name two different ways.
 */
function classifyCteReferences(
    relations: readonly BoundRelation[],
    ctes: readonly BoundRelation[],
): readonly BoundRelation[] {
    if (ctes.length === 0) return relations;
    const names = new Set(ctes.map((cte) => cte.exposedName.toLocaleLowerCase()));
    return relations.map((relation) => {
        if (relation.kind !== "unknown" && relation.kind !== "table") return relation;
        const written = relation.name?.parts;
        if (!written || written.length !== 1) return relation;
        if (!names.has(written[0]!.normalized.toLocaleLowerCase())) return relation;
        return Object.freeze({ ...relation, kind: "cte" as BoundRelationKind });
    });
}

/**
 * Statements that own rowsets without a `QuerySpecification`.
 *
 * `UPDATE t SET ...` and `DELETE FROM t` name a target that later clauses refer to by alias, so
 * they are query boundaries even though nothing projects a select list.
 */
/** The nodes of one kind this build covers, narrowed when the caller asked for part of the document. */
function scopeRootsOfKind(input: ScopeModelInput, kind: string): readonly SyntaxNode[] {
    const bucket = input.index.get(kind) ?? [];
    return input.ranges ? itemsWithinRanges(bucket, input.ranges, (node) => node) : bucket;
}

function statementScopeRoots(input: ScopeModelInput): readonly SyntaxNode[] {
    const roots: SyntaxNode[] = [];
    for (const kind of ["UpdateStatement", "DeleteStatement", "MergeStatement"]) {
        for (const node of scopeRootsOfKind(input, kind)) {
            if (!firstDescendant(node, "QuerySpecification")) roots.push(node);
        }
    }
    return roots;
}

function enclosingScope(node: SyntaxNode): SyntaxNode | undefined {
    for (let current = node.parent(); current; current = current.parent()) {
        // A CTE or ordinary derived table owns an independent scope: an alias inside it is not an
        // outer reference, so the chain stops rather than leaking names outward.
        if (current.kind === "CommonTableExpression" || current.kind === "DerivedTable") {
            return undefined;
        }
        if (current.kind === "QuerySpecification") return current;
    }
    return undefined;
}

function collectCtes(
    input: ScopeModelInput,
    root: SyntaxNode,
    scopeId: string,
): readonly BoundRelation[] {
    const statement = ancestor(root, ["Statement"]) ?? root;
    const declarations = descendants(statement, "CommonTableExpression");
    const enclosing = ancestor(root, ["CommonTableExpression"]);
    const lastVisible = enclosing
        ? declarations.findIndex(
              (candidate) => candidate.start === enclosing.start && candidate.end === enclosing.end,
          )
        : declarations.length - 1;
    const result: BoundRelation[] = [];
    for (const cte of declarations.slice(0, lastVisible + 1)) {
        const name = firstDescendant(cte, "IdentifierName");
        if (!name) continue;
        result.push(
            Object.freeze({
                id: `cte:${rangeKey(cte)}`,
                kind: "cte" as BoundRelationKind,
                exposedName: normalizeIdentifier(source(input, name)),
                scopeId,
                columns: toBoundColumns(cteColumns(input, cte)),
                range: { start: cte.start, end: cte.end },
                implicit: false,
            }) as BoundRelation,
        );
    }
    return result;
}

function collectRelations(
    input: ScopeModelInput,
    root: SyntaxNode,
    scopeId: string,
): readonly BoundRelation[] {
    const result: BoundRelation[] = [];
    const queryRoot =
        root.kind === "QuerySpecification" ? root : firstDescendant(root, "QuerySpecification");
    visit(root, (node) => {
        const containingQuery = ancestor(node, ["QuerySpecification"]);
        if (
            queryRoot &&
            (!containingQuery ||
                containingQuery.start !== queryRoot.start ||
                containingQuery.end !== queryRoot.end)
        ) {
            return;
        }
        const relation = relationFor(input, node, scopeId);
        if (relation) result.push(relation);
    });
    return result;
}

function relationFor(
    input: ScopeModelInput,
    node: SyntaxNode,
    scopeId: string,
): BoundRelation | undefined {
    switch (node.kind) {
        case "NamedTableSource":
            return namedRelation(input, node, scopeId);
        case "VariableTableSource":
            return variableRelation(input, node, scopeId);
        case "FunctionTableSource":
            return functionRelation(input, node, scopeId);
        case "VectorSearchTableSource":
            return vectorRelation(input, node, scopeId);
        case "DerivedTable":
            return derivedRelation(input, node, scopeId);
        case "PivotJoin":
            return pivotRelation(input, node, scopeId);
        case "UnpivotJoin":
            return unpivotRelation(input, node, scopeId);
        default:
            return undefined;
    }
}

/**
 * The rowset `PIVOT` produces.
 *
 * Its columns are one per pivot value, named by the `IN` list. The grouping columns it carries
 * through come from the source relation, which is bound separately, so they are not repeated here:
 * this relation exists so `p.[value]` resolves to the column the pivot created.
 */
function pivotRelation(
    input: ScopeModelInput,
    node: SyntaxNode,
    scopeId: string,
): BoundRelation | undefined {
    const exposedName = aliasOf(input, node);
    const list = firstDescendant(node, "PivotColumnList");
    if (!exposedName || !list) return undefined;
    const columns = descendants(list, "IdentifierName").map((name) => ({
        name: normalizeIdentifier(source(input, name)),
    }));
    return relation(node, scopeId, {
        id: `relation:${rangeKey(node)}`,
        kind: "pivot",
        exposedName,
        columns: toBoundColumns(columns),
    });
}

/**
 * The rowset `UNPIVOT` produces.
 *
 * It replaces the listed source columns with two: the one holding each value and the one naming
 * which column it came from. Those two are what a query written against the unpivot refers to.
 */
function unpivotRelation(
    input: ScopeModelInput,
    node: SyntaxNode,
    scopeId: string,
): BoundRelation | undefined {
    const exposedName = aliasOf(input, node);
    if (!exposedName) return undefined;
    // The grammar writes `UNPIVOT (value FOR name IN (columns))`, so the first two multipart names
    // that are not inside the IN list are the produced columns.
    const list = firstDescendant(node, "UnpivotColumnList");
    const produced = descendants(node, "MultipartIdentifier")
        .filter((name) => !list || name.start < list.start)
        .slice(0, 2)
        .map((name) => ({ name: normalizeIdentifier(source(input, name)) }));
    if (produced.length === 0) return undefined;
    return relation(node, scopeId, {
        id: `relation:${rangeKey(node)}`,
        kind: "unpivot",
        exposedName,
        columns: toBoundColumns(produced),
    });
}

function namedRelation(
    input: ScopeModelInput,
    node: SyntaxNode,
    scopeId: string,
): BoundRelation | undefined {
    const name = firstDescendant(node, "MultipartIdentifier");
    if (!name) return undefined;
    const written = source(input, name);
    const parts = multipartIdentifierParts(written);
    const exposedName = aliasOf(input, node) ?? parts.at(-1);
    if (!exposedName) return undefined;
    const bound = boundNameFrom(input.metadata, name, written, "relation");
    const resolution = input.metadata.resolveObject(parts);
    if (resolution.kind === "resolved") {
        const state = input.metadata.columnState(resolution.object.ref);
        return relation(node, scopeId, {
            id: `relation:${rangeKey(node)}`,
            kind: relationKindFor(resolution.object.kind),
            name: bound,
            exposedName,
            columns: state.kind === "loaded" ? toBoundColumns(state.value) : "unknown",
        });
    }
    const columns = localColumnsForName(input, parts, node.start);
    return relation(node, scopeId, {
        id: `relation:${rangeKey(node)}`,
        kind: columns ? "table" : "unknown",
        name: bound,
        exposedName,
        columns: columns ? toBoundColumns(columns) : "unknown",
    });
}

function variableRelation(
    input: ScopeModelInput,
    node: SyntaxNode,
    scopeId: string,
): BoundRelation | undefined {
    const variable = firstDescendant(node, "Variable");
    if (!variable) return undefined;
    const name = source(input, variable);
    const columns = localColumnsForName(input, [name], node.start);
    return relation(node, scopeId, {
        id: `relation:${rangeKey(node)}`,
        kind: "variable",
        exposedName: aliasOf(input, node) ?? name,
        columns: columns ? toBoundColumns(columns) : "unknown",
    });
}

function functionRelation(
    input: ScopeModelInput,
    node: SyntaxNode,
    scopeId: string,
): BoundRelation | undefined {
    const name = firstDescendant(node, "MultipartIdentifier");
    if (!name) return undefined;
    const written = source(input, name);
    const parts = multipartIdentifierParts(written);
    const exposedName = aliasOf(input, node) ?? parts.at(-1);
    if (!exposedName) return undefined;
    const bound = boundNameFrom(input.metadata, name, written, "routine");
    // `Doc.nodes('/path')` shreds an XML column into a rowset of XML fragments. It is written like
    // a table-valued call but is a method on a column, and its one column is always XML, so it is
    // recognised here rather than being reported as an unresolvable routine.
    if (parts.length >= 2 && parts.at(-1)?.toLocaleLowerCase() === "nodes") {
        const explicitColumns = firstDescendant(node, "ColumnNameList");
        const columns = explicitColumns
            ? descendants(explicitColumns, "IdentifierName").map((column) => ({
                  name: normalizeIdentifier(source(input, column)),
                  typeDisplay: "xml",
                  nullable: false,
              }))
            : [];
        return relation(node, scopeId, {
            id: `relation:${rangeKey(node)}`,
            kind: "xmlNodes",
            exposedName,
            columns: columns.length > 0 ? toBoundColumns(columns) : "unknown",
        });
    }
    if (parts.at(-1)?.toLocaleLowerCase() === "openjson") {
        const schema = firstDescendant(node, "WithColumnSchema");
        const columns = schema
            ? descendants(schema, "ColumnSchemaElement").map((column) =>
                  columnMetadata(input, column),
              )
            : defaultOpenJsonColumns;
        return relation(node, scopeId, {
            id: `relation:${rangeKey(node)}`,
            kind: "openJson",
            exposedName,
            columns: toBoundColumns(columns),
        });
    }
    const explicit = firstDescendant(node, "ColumnNameList");
    if (explicit) {
        return relation(node, scopeId, {
            id: `relation:${rangeKey(node)}`,
            kind: "tableFunction",
            name: bound,
            exposedName,
            columns: toBoundColumns(
                descendants(explicit, "IdentifierName").map((column) => ({
                    name: normalizeIdentifier(source(input, column)),
                })),
            ),
        });
    }
    const local = input.timeline.resolve(parts, node.start);
    if (local?.exists && local.columns) {
        return relation(node, scopeId, {
            id: `relation:${rangeKey(node)}`,
            kind: "tableFunction",
            name: bound,
            exposedName,
            columns: toBoundColumns(local.columns),
        });
    }
    const resolution = input.metadata.resolveObject(parts);
    if (resolution.kind !== "resolved") {
        return relation(node, scopeId, {
            id: `relation:${rangeKey(node)}`,
            kind: "tableFunction",
            name: bound,
            exposedName,
            columns: "unknown",
        });
    }
    const state = input.metadata.columnState(resolution.object.ref);
    return relation(node, scopeId, {
        id: `relation:${rangeKey(node)}`,
        kind: "tableFunction",
        name: bound,
        exposedName,
        columns: state.kind === "loaded" ? toBoundColumns(state.value) : "unknown",
    });
}

function vectorRelation(
    input: ScopeModelInput,
    node: SyntaxNode,
    scopeId: string,
): BoundRelation | undefined {
    const exposedName = aliasOf(input, node);
    if (!exposedName) return undefined;
    return relation(node, scopeId, {
        id: `relation:${rangeKey(node)}`,
        kind: "pseudo",
        exposedName,
        columns: toBoundColumns([{ name: "distance", typeDisplay: "float", nullable: false }]),
    });
}

function derivedRelation(
    input: ScopeModelInput,
    node: SyntaxNode,
    scopeId: string,
): BoundRelation | undefined {
    const alias = firstDescendant(node, "TableAlias");
    const aliasName = alias && lastDescendant(alias, "IdentifierName");
    if (!alias || !aliasName) return undefined;
    const explicit = descendants(node, "ColumnNameList").find((list) => list.start >= alias.end);
    const columns = explicit
        ? descendants(explicit, "IdentifierName").map((name) => ({
              name: normalizeIdentifier(source(input, name)),
          }))
        : projectedColumns(input, firstDescendant(node, "SelectList"));
    return relation(node, scopeId, {
        id: `relation:${rangeKey(node)}`,
        kind: "derived",
        exposedName: normalizeIdentifier(source(input, aliasName)),
        columns: toBoundColumns(columns),
    });
}

function relation(
    node: SyntaxNode,
    scopeId: string,
    fields: Omit<BoundRelation, "range" | "scopeId" | "implicit">,
): BoundRelation {
    return Object.freeze({
        ...fields,
        scopeId,
        range: { start: node.start, end: node.end },
        implicit: false,
    }) as BoundRelation;
}

function relationKindFor(kind: string): BoundRelationKind {
    switch (kind) {
        case "table":
        case "view":
        case "synonym":
        case "tableFunction":
            return kind;
        default:
            return "unknown";
    }
}

function aliasOf(input: ScopeModelInput, node: SyntaxNode): string | undefined {
    const alias = firstDescendant(node, "TableAlias");
    const aliasName = alias && lastDescendant(alias, "IdentifierName");
    return aliasName ? normalizeIdentifier(source(input, aliasName)) : undefined;
}

function toBoundColumns(columns: readonly ColumnMetadata[]): readonly BoundColumn[] {
    return Object.freeze(
        columns.map((column) =>
            Object.freeze({
                name: column.name,
                // A declared type is read the same way wherever it is written, so an `xml` column
                // is the same kind of receiver as an `xml` variable.
                type: column.typeDisplay
                    ? declaredType(column.typeDisplay, column.nullable !== false)
                    : {
                          displayName: "unknown",
                          nullable: column.nullable !== false,
                          category: "unknown" as const,
                          confidence: "unknown" as const,
                      },
            }),
        ),
    );
}

/**
 * One document-local rowset declaration, as the index records it.
 *
 * `batch` is present only for the kinds SQL Server scopes to a batch -- table variables and common
 * table expressions -- because those stop being visible after the `GO` that ends the batch which
 * declared them, while a temporary table and a `SELECT INTO` target do not.
 */
interface LocalRowsetDeclaration {
    readonly kind: "table" | "variable" | "cte" | "into" | "drop";
    readonly node: SyntaxNode;
    readonly start: number;
    readonly end: number;
    readonly batch?: { readonly start: number; readonly end: number };
    readonly statement?: { readonly start: number; readonly end: number };
}

/**
 * Every local rowset declaration in a document, grouped by the name it declares.
 *
 * Built once per syntax snapshot and cached against it. The index exists because the alternative --
 * scanning the document for each name that fails to resolve against the catalog -- is quadratic: a
 * document with a thousand table references walked the whole tree a thousand times. An editor with
 * no connected catalog resolves nothing, so every reference took that path.
 *
 * Keyed on the snapshot rather than threaded through the call chain because the index depends on
 * nothing else: two callers holding the same snapshot are describing the same document.
 */
const localRowsetIndexes = new WeakMap<
    SyntaxSnapshot,
    ReadonlyMap<string, readonly LocalRowsetDeclaration[]>
>();

function localRowsetIndex(
    input: LocalRowsetInput,
): ReadonlyMap<string, readonly LocalRowsetDeclaration[]> {
    const cached = localRowsetIndexes.get(input.syntax);
    if (cached) return cached;
    const built = buildLocalRowsetIndex(input);
    localRowsetIndexes.set(input.syntax, built);
    return built;
}

/** The declaring nodes, by kind, preferring the snapshot's own index over walking the tree. */
function declarationNodesByKind(
    input: LocalRowsetInput,
    kinds: readonly string[],
): ReadonlyMap<string, readonly SyntaxNode[]> {
    const index = input.syntax.structuralIndex?.();
    if (index) {
        const selected = new Map<string, readonly SyntaxNode[]>();
        for (const kind of kinds) selected.set(kind, index.get(kind) ?? []);
        return selected;
    }
    const wanted = new Set(kinds);
    const collected = new Map<string, SyntaxNode[]>();
    visit(input.syntax.root(), (node) => {
        if (!wanted.has(node.kind)) return;
        const nodes = collected.get(node.kind) ?? [];
        nodes.push(node);
        collected.set(node.kind, nodes);
    });
    return collected;
}

function buildLocalRowsetIndex(
    input: LocalRowsetInput,
): ReadonlyMap<string, readonly LocalRowsetDeclaration[]> {
    const byName = new Map<string, LocalRowsetDeclaration[]>();
    const record = (
        name: string | undefined,
        kind: LocalRowsetDeclaration["kind"],
        node: SyntaxNode,
        batchScoped: boolean,
    ): void => {
        if (!name) return;
        const batch = batchScoped ? ancestor(node, ["Batch"]) : undefined;
        const statement = kind === "cte" ? ancestor(node, ["Statement"]) : undefined;
        const declarations = byName.get(name) ?? [];
        declarations.push({
            kind,
            node,
            start: node.start,
            end: node.end,
            ...(batch ? { batch: { start: batch.start, end: batch.end } } : {}),
            ...(statement ? { statement: { start: statement.start, end: statement.end } } : {}),
        });
        byName.set(name, declarations);
    };
    const lastPart = (node: SyntaxNode): string | undefined => {
        const last = multipartIdentifierParts(source(input, node)).at(-1);
        return last ? normalizeIdentifier(last).toLocaleLowerCase() : undefined;
    };

    const nodes = declarationNodesByKind(input, [
        "CreateTableStatement",
        "VariableDeclaration",
        "CommonTableExpression",
        "SelectStatement",
        "DropTableStatement",
    ]);

    for (const node of nodes.get("CreateTableStatement") ?? []) {
        const name = firstDescendant(node, "MultipartIdentifier");
        // A statement with no table definition contributes nothing. The scan this replaced left the
        // previous answer standing in that case rather than clearing it, so it is not a declaration.
        if (!name || !firstDescendant(node, "TableDefinition")) continue;
        record(lastPart(name), "table", node, false);
    }
    for (const node of nodes.get("VariableDeclaration") ?? []) {
        const variable = firstDescendant(node, "Variable");
        if (!variable || !firstDescendant(node, "TableDefinition")) continue;
        record(source(input, variable).toLocaleLowerCase(), "variable", node, true);
    }
    for (const node of nodes.get("CommonTableExpression") ?? []) {
        const name = firstDescendant(node, "IdentifierName");
        if (!name) continue;
        record(normalizeIdentifier(source(input, name)).toLocaleLowerCase(), "cte", node, true);
    }
    for (const node of nodes.get("SelectStatement") ?? []) {
        const into = firstDescendant(node, "IntoClause");
        const name = into && firstDescendant(into, "MultipartIdentifier");
        if (!name) continue;
        record(lastPart(name), "into", node, false);
    }
    for (const node of nodes.get("DropTableStatement") ?? []) {
        for (const name of descendants(node, "MultipartIdentifier")) {
            record(lastPart(name), "drop", node, false);
        }
    }

    return byName;
}

/**
 * The shape of a document-local rowset at one offset.
 *
 * Kept out of the DDL timeline because a table variable, a CTE, and a `SELECT INTO` target are all
 * local rowsets that the timeline does not model as catalog objects.
 *
 * The answer is the most recent declaration of the name completed before this offset, which is why
 * `DROP TABLE` takes part: dropping the name is the most recent thing the document says about it,
 * and it leaves nothing visible.
 */
export function localColumnsForName(
    input: LocalRowsetInput,
    parts: readonly string[],
    useOffset: number,
): readonly ColumnMetadata[] | undefined {
    const wanted = normalizeIdentifier(parts.at(-1) ?? "").toLocaleLowerCase();
    if (!wanted) return undefined;
    const declarations = localRowsetIndex(input).get(wanted);
    if (!declarations || declarations.length === 0) return undefined;

    const useBatch = ancestor(input.syntax.nodeAt(useOffset), ["Batch"]);
    const useStatement = ancestor(input.syntax.nodeAt(useOffset), ["Statement"]);
    const visible = (declaration: LocalRowsetDeclaration): boolean => {
        if (declaration.start >= useOffset) return false;
        if (!declaration.batch || !useBatch) return true;
        if (declaration.batch.start !== useBatch.start || declaration.batch.end !== useBatch.end) {
            return false;
        }
        if (declaration.kind !== "cte") return true;
        return Boolean(
            declaration.statement &&
                useStatement &&
                declaration.statement.start === useStatement.start &&
                declaration.statement.end === useStatement.end,
        );
    };

    // Most recent first, so the first visible declaration is the one in force here.
    for (const declaration of rangeIndexFor(declarations, declarationRange).endingBefore(
        useOffset,
    )) {
        if (visible(declaration)) return columnsForDeclaration(input, declaration);
    }
    return undefined;
}

const declarationRange = (declaration: LocalRowsetDeclaration): TextRange => ({
    start: declaration.start,
    end: declaration.end,
});

/** Reads the columns a declaration exposes. Deferred until one declaration has won. */
function columnsForDeclaration(
    input: LocalRowsetInput,
    declaration: LocalRowsetDeclaration,
): readonly ColumnMetadata[] | undefined {
    switch (declaration.kind) {
        case "drop":
            return undefined;
        case "cte":
            return cteColumns(input, declaration.node);
        case "into":
            return projectedColumns(input, firstDescendant(declaration.node, "SelectList"));
        case "table":
        case "variable": {
            const definition = firstDescendant(declaration.node, "TableDefinition");
            return definition ? tableDefinitionColumns(input, definition) : undefined;
        }
    }
}

function tableDefinitionColumns(
    input: LocalRowsetInput,
    definition: SyntaxNode,
): readonly ColumnMetadata[] {
    return descendants(definition, "ColumnDefinition").map((column) =>
        columnMetadata(input, column),
    );
}

function columnMetadata(input: LocalRowsetInput, node: SyntaxNode): ColumnMetadata {
    const name = firstDescendant(node, "IdentifierName");
    const type = firstDescendant(node, "DataType");
    const written = source(input, node);
    return {
        name: name ? normalizeIdentifier(source(input, name)) : written,
        ...(type ? { typeDisplay: source(input, type) } : {}),
        nullable: !/\bNOT\s+NULL\b/iu.test(written),
    };
}

function cteColumns(input: LocalRowsetInput, cte: SyntaxNode): readonly ColumnMetadata[] {
    const explicit = directChild(cte, "ColumnNameList");
    if (explicit) {
        return descendants(explicit, "IdentifierName").map((name) => ({
            name: normalizeIdentifier(source(input, name)),
        }));
    }
    return projectedColumns(input, firstDescendant(cte, "SelectList"));
}

function projectedColumns(
    input: LocalRowsetInput,
    list: SyntaxNode | undefined,
): readonly ColumnMetadata[] {
    if (!list) return [];
    const columns: ColumnMetadata[] = [];
    for (const element of descendants(list, "SelectElement")) {
        if (hasDescendant(element, "Star")) continue;
        const names = descendants(element, "IdentifierName");
        const name = names.at(-1);
        if (name) columns.push({ name: normalizeIdentifier(source(input, name)) });
    }
    return columns;
}

function source(input: LocalRowsetInput, node: SyntaxNode): string {
    return input.syntax.document.text.slice(node.start, node.end);
}

function rangeKey(node: SyntaxNode): string {
    return `${node.start}:${node.end}`;
}
