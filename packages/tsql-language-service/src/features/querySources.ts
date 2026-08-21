/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ColumnMetadata, MetadataView, ObjectMetadata } from "../metadata/index.js";
import type { DocumentAnalysisSnapshot } from "../runtime/index.js";
import {
    localColumnsForName as modelLocalColumns,
    type BoundRelation,
} from "../semantics/index.js";
import type { SyntaxNode } from "../syntax/index.js";
import { ancestorOfKind as ancestor } from "../syntax/treeUtilities.js";

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
): readonly BoundQuerySource[] {
    return boundSources(
        view,
        snapshot.semantics.model.relations.filter(
            (relation) => relation.range.start >= root.start && relation.range.end <= root.end,
        ),
    );
}

export function visibleQuerySources(
    snapshot: DocumentAnalysisSnapshot,
    view: MetadataView,
    query: SyntaxNode,
): readonly BoundQuerySource[] {
    return boundSources(view, snapshot.semantics.model.visibleRelations(query.start + 1));
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
    view: MetadataView,
    relations: readonly BoundRelation[],
): readonly BoundQuerySource[] {
    const result: BoundQuerySource[] = [];
    for (const relation of relations) {
        const resolution = relation.name?.resolution;
        const object = resolution?.kind === "catalog" ? view.object(resolution.object) : undefined;
        if (object) {
            result.push({ qualifier: relation.exposedName, object });
            continue;
        }
        if (relation.columns === "unknown") continue;
        result.push({
            qualifier: relation.exposedName,
            columns: relation.columns.map((column) => ({
                name: column.name,
                ...(column.type && column.type.confidence !== "unknown"
                    ? { typeDisplay: column.type.displayName }
                    : {}),
                ...(column.type ? { nullable: column.type.nullable } : {}),
            })),
        });
    }
    return result;
}
