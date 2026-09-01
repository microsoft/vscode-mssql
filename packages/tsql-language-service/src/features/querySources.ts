/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ColumnMetadata, MetadataView, ObjectMetadata } from "../metadata/index.js";
import type { DocumentAnalysisSnapshot } from "../runtime/index.js";
import {
    localColumnsForName as modelLocalColumns,
    normalizeIdentifier,
    type BoundRelation,
} from "../semantics/index.js";
import type { SyntaxNode } from "../syntax/index.js";
import {
    ancestorOfKind as ancestor,
    descendantsOfKind as descendants,
    directChildOfKind as directChild,
    firstDescendantOfKind as firstDescendant,
    sameSyntaxNode,
} from "../syntax/treeUtilities.js";

export interface BoundQuerySource {
    readonly qualifier: string;
    readonly object?: ObjectMetadata;
    readonly columns?: readonly ColumnMetadata[];
}

export function sourceForQualifier(
    snapshot: DocumentAnalysisSnapshot,
    view: MetadataView,
    offset: number,
    qualifiers: readonly string[],
): BoundQuerySource | undefined {
    if (qualifiers.length === 0) return undefined;
    const leaf = snapshot.syntax.nodeAt(offset);
    const query = ancestor(leaf, ["QuerySpecification"]);
    const statement = ancestor(leaf, ["Statement"]);
    const sources = query
        ? visibleQuerySources(snapshot, view, query)
        : statement
          ? querySourcesWithin(snapshot, view, statement)
          : [];
    if (qualifiers.length === 1) {
        const alias = sources.find((source) =>
            view.nameComparison.equals(source.qualifier, qualifiers[0]!),
        );
        if (alias) return alias;
    }
    const resolution = view.resolveObject(qualifiers);
    return resolution.kind === "resolved"
        ? { qualifier: resolution.object.name, object: resolution.object }
        : undefined;
}

/** Projects the binder's relation model into the shared completion/hover source shape. */
export function querySourcesWithin(
    snapshot: DocumentAnalysisSnapshot,
    view: MetadataView,
    root: SyntaxNode,
    enrichProjectedColumns = true,
): readonly BoundQuerySource[] {
    return boundSources(
        snapshot,
        view,
        snapshot.semantics.model.relations.filter(
            (relation) => relation.range.start >= root.start && relation.range.end <= root.end,
        ),
        enrichProjectedColumns,
    );
}

export function visibleQuerySources(
    snapshot: DocumentAnalysisSnapshot,
    view: MetadataView,
    query: SyntaxNode,
    enrichProjectedColumns = true,
): readonly BoundQuerySource[] {
    return boundSources(
        snapshot,
        view,
        snapshot.semantics.model.visibleRelations(query.start + 1),
        enrichProjectedColumns,
    );
}

/** Returns the projected columns of a document-local relation at one use site. */
export function localRelationColumnsForName(
    snapshot: DocumentAnalysisSnapshot,
    parts: readonly string[],
    useOffset: number,
): readonly ColumnMetadata[] | undefined {
    return modelLocalColumns({ syntax: snapshot.syntax }, parts, useOffset);
}

function boundSources(
    snapshot: DocumentAnalysisSnapshot,
    view: MetadataView,
    relations: readonly BoundRelation[],
    enrichProjectedColumns: boolean,
): readonly BoundQuerySource[] {
    const result: BoundQuerySource[] = [];
    for (const relation of relations) {
        // A CTE declaration is available as a name in a FROM clause, but it is not itself a row
        // source in the current query. Its `relation:` reference below is the source whose alias
        // and projected columns belong in expression completion.
        if (relation.id.startsWith("cte:")) continue;
        const resolution = relation.name?.resolution;
        const object = resolution?.kind === "catalog" ? view.object(resolution.object) : undefined;
        if (object) {
            result.push({ qualifier: relation.exposedName, object });
            continue;
        }
        if (relation.columns === "unknown") continue;
        result.push({
            qualifier: relation.exposedName,
            columns: enrichProjectedColumns
                ? projectedRelationColumns(snapshot, relation)
                : boundColumns(relation),
        });
    }
    return result;
}

const projectedColumnCaches = new WeakMap<
    DocumentAnalysisSnapshot,
    Map<string, readonly ColumnMetadata[]>
>();

interface ProjectionIndex {
    readonly ctesByName: ReadonlyMap<string, readonly BoundRelation[]>;
    readonly relationsByQuery: ReadonlyMap<string, readonly BoundRelation[]>;
}

const projectionIndexes = new WeakMap<DocumentAnalysisSnapshot, ProjectionIndex>();

function projectedRelationColumns(
    snapshot: DocumentAnalysisSnapshot,
    relation: BoundRelation,
): readonly ColumnMetadata[] {
    const fallback = boundColumns(relation);
    if (relation.kind !== "cte") return fallback;
    const declaration = visibleCteDeclaration(snapshot, relation);
    if (!declaration) return fallback;
    return projectedCteColumns(snapshot, declaration, new Set()) ?? fallback;
}

function projectedCteColumns(
    snapshot: DocumentAnalysisSnapshot,
    declaration: BoundRelation,
    active: Set<string>,
): readonly ColumnMetadata[] | undefined {
    let cache = projectedColumnCaches.get(snapshot);
    if (!cache) {
        cache = new Map();
        projectedColumnCaches.set(snapshot, cache);
    }
    const cached = cache.get(declaration.id);
    if (cached) return cached;
    if (active.has(declaration.id)) return undefined;
    active.add(declaration.id);
    try {
        const cte = syntaxNodeForRelation(snapshot, declaration);
        const query = cte && firstDescendant(cte, "QuerySpecification");
        const list = query && firstDescendant(query, "SelectList");
        if (!cte || !query || !list || declaration.columns === "unknown") return undefined;
        const outputNames = declaration.columns.map((column) => column.name);
        const columns: ColumnMetadata[] = [];
        let outputIndex = 0;
        const sources = relationsOwnedByQuery(snapshot, query);
        for (const element of descendants(list, "SelectElement")) {
            if (!sameSyntaxNode(ancestor(element, ["QuerySpecification"]), query)) continue;
            const star =
                firstDescendant(element, "StarExpression") ?? firstDescendant(element, "Star");
            if (star && !ancestor(star, ["FunctionCall"])) {
                const written = snapshot.text.text.slice(star.start, star.end);
                const dot = written.lastIndexOf(".");
                const prefix =
                    dot < 0 ? undefined : normalizeIdentifier(written.slice(0, dot).trim());
                for (const source of sources) {
                    if (prefix && source.exposedName.toLowerCase() !== prefix.toLowerCase()) {
                        continue;
                    }
                    const sourceColumns =
                        source.kind === "cte"
                            ? projectedCteColumns(
                                  snapshot,
                                  visibleCteDeclaration(snapshot, source) ?? source,
                                  active,
                              )
                            : source.columns === "unknown"
                              ? undefined
                              : boundColumns(source);
                    for (const column of sourceColumns ?? []) {
                        columns.push({ ...column, name: outputNames[outputIndex] ?? column.name });
                        outputIndex++;
                    }
                }
                continue;
            }
            const name = outputNames[outputIndex];
            if (!name) continue;
            const expression = directChild(element, "Expression");
            const type = snapshot.semantics.model.typeAt(expression?.start ?? element.start);
            columns.push({
                name,
                ...(type && type.confidence !== "unknown"
                    ? { typeDisplay: type.displayName, nullable: type.nullable }
                    : {}),
            });
            outputIndex++;
        }
        const explicit = directChild(cte, "ColumnNameList");
        if (explicit) {
            const names = descendants(explicit, "IdentifierName").map((name) =>
                normalizeIdentifier(snapshot.text.text.slice(name.start, name.end)),
            );
            for (const [index, name] of names.entries()) {
                const column = columns[index];
                if (column) columns[index] = { ...column, name };
            }
        }
        const result = Object.freeze(columns);
        cache.set(declaration.id, result);
        return result;
    } finally {
        active.delete(declaration.id);
    }
}

function visibleCteDeclaration(
    snapshot: DocumentAnalysisSnapshot,
    relation: BoundRelation,
): BoundRelation | undefined {
    const folded = (relation.name?.object ?? relation.exposedName).toLowerCase();
    const candidates = projectionIndex(snapshot).ctesByName.get(folded) ?? [];
    for (let index = candidates.length - 1; index >= 0; index--) {
        const candidate = candidates[index]!;
        if (candidate.range.start <= relation.range.start) return candidate;
    }
    return undefined;
}

function relationsOwnedByQuery(
    snapshot: DocumentAnalysisSnapshot,
    query: SyntaxNode,
): readonly BoundRelation[] {
    return projectionIndex(snapshot).relationsByQuery.get(nodeKey(query)) ?? [];
}

function projectionIndex(snapshot: DocumentAnalysisSnapshot): ProjectionIndex {
    const cached = projectionIndexes.get(snapshot);
    if (cached) return cached;
    const ctesByName = new Map<string, BoundRelation[]>();
    const relationsByQuery = new Map<string, BoundRelation[]>();
    for (const relation of snapshot.semantics.model.relations) {
        if (relation.id.startsWith("cte:")) {
            const key = relation.exposedName.toLowerCase();
            const declarations = ctesByName.get(key) ?? [];
            declarations.push(relation);
            ctesByName.set(key, declarations);
            continue;
        }
        if (!relation.id.startsWith("relation:")) continue;
        const node = syntaxNodeForRelation(snapshot, relation);
        const query = node && ancestor(node, ["QuerySpecification"]);
        if (!query) continue;
        const key = nodeKey(query);
        const sources = relationsByQuery.get(key) ?? [];
        sources.push(relation);
        relationsByQuery.set(key, sources);
    }
    const result = { ctesByName, relationsByQuery } satisfies ProjectionIndex;
    projectionIndexes.set(snapshot, result);
    return result;
}

function nodeKey(node: SyntaxNode): string {
    return `${node.start}:${node.end}`;
}

function syntaxNodeForRelation(
    snapshot: DocumentAnalysisSnapshot,
    relation: BoundRelation,
): SyntaxNode | undefined {
    let node: SyntaxNode | undefined = snapshot.syntax.nodeAt(
        Math.min(relation.range.end - 1, relation.range.start + 1),
    );
    while (node && (node.start !== relation.range.start || node.end !== relation.range.end)) {
        node = node.parent();
    }
    return node;
}

function boundColumns(relation: BoundRelation): readonly ColumnMetadata[] {
    if (relation.columns === "unknown") return [];
    return relation.columns.map((column) => ({
        name: column.name,
        ...(column.type && column.type.confidence !== "unknown"
            ? { typeDisplay: column.type.displayName }
            : {}),
        ...(column.type ? { nullable: column.type.nullable } : {}),
    }));
}
