/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { MetadataView } from "../../metadata/index.js";
import type { SyntaxNode, SyntaxSnapshot } from "../../syntax/index.js";
import { visitSyntaxTree as visit } from "../../syntax/treeUtilities.js";
import type { TextRange } from "../../text/index.js";
import { buildAvailabilityDecisions } from "./availabilityModel.js";
import { buildCalls } from "./callModel.js";
import { DocumentCatalogTimeline, emptyCatalogTimeline } from "./catalogTimeline.js";
import { buildExpressionTypes, expressionTypeAt } from "./expressionTypes.js";
import type {
    BoundExpression,
    BoundName,
    BoundRelation,
    CatalogTimeline,
    CatalogTimelineEvent,
    ExpressionType,
    FeatureAvailabilityDecision,
    QueryScope,
    ResolvedCall,
    SemanticModel,
} from "./contracts.js";
import { buildScopes, type ScopeModel } from "./scopeModel.js";
import { rangeIndexFor, type RangeIndex } from "./lookups.js";

/**
 * The document's bound semantic model.
 *
 * It is built once per snapshot and read by every feature. Nothing here re-parses, re-walks, or
 * re-queries metadata: the accessors are lookups over state that binding already produced, which
 * is the property that makes a diagnostic, a tooltip, and a completion agree about one name.
 */
export interface SemanticModelInput {
    readonly syntax: SyntaxSnapshot;
    readonly metadata: MetadataView;
    /** The document's local DDL events, produced by the one collector diagnostics also uses. */
    readonly timelineEvents: readonly CatalogTimelineEvent[];
    readonly index?: ReadonlyMap<string, readonly SyntaxNode[]>;
    /**
     * Scopes the caller already built.
     *
     * The binder needs them while it binds, so it builds them once and hands them here rather than
     * letting a second set be built from the same syntax. Omitting them builds them.
     */
    readonly scopes?: ScopeModel;
    /** The timeline the caller already built from {@link timelineEvents}. */
    readonly timeline?: CatalogTimeline;
    /**
     * Expression types the caller already built.
     *
     * Validation needs them before the model is published, so the binder builds them once and the
     * model publishes that table rather than inferring a second one.
     */
    readonly expressions?: readonly BoundExpression[];
}

export function buildSemanticModel(input: SemanticModelInput): SemanticModel {
    const index = input.index ?? indexSyntax(input.syntax);
    const timeline =
        input.timeline ?? new DocumentCatalogTimeline(input.timelineEvents, input.metadata);
    const scopes =
        input.scopes ??
        buildScopes({
            syntax: input.syntax,
            metadata: input.metadata,
            timeline,
            index,
        });
    const calls = buildCalls({
        syntax: input.syntax,
        metadata: input.metadata,
        index,
        timeline,
        profile: input.syntax.profile,
    });
    const availability = buildAvailabilityDecisions(input.syntax, index, calls);
    // Calls are resolved after validation, so a table built before them is completed here rather
    // than replaced: an expression already typed keeps its type, and a call gains one.
    const expressions = mergeExpressionTypes(
        input.expressions ?? [],
        buildExpressionTypes({
            syntax: input.syntax,
            metadata: input.metadata,
            index,
            relations: scopes.relations,
            calls,
        }),
    );
    const names = collectNames(scopes.relations, calls);
    return new DocumentSemanticModel(
        scopes.scopes,
        scopes.relations,
        names,
        calls,
        expressions,
        timeline,
        availability,
    );
}

/** A model for a document that has not been bound, so a caller never has to test for undefined. */
export const emptySemanticModel: SemanticModel = new (class implements SemanticModel {
    public readonly scopes = Object.freeze([]) as readonly QueryScope[];
    public readonly relations = Object.freeze([]) as readonly BoundRelation[];
    public readonly names = Object.freeze([]) as readonly BoundName[];
    public readonly calls = Object.freeze([]) as readonly ResolvedCall[];
    public readonly expressions = Object.freeze([]) as readonly BoundExpression[];
    public readonly timeline: CatalogTimeline = emptyCatalogTimeline;
    public readonly availability = Object.freeze([]) as readonly FeatureAvailabilityDecision[];
    public scopeAt(): undefined {
        return undefined;
    }
    public visibleRelations(): readonly BoundRelation[] {
        return this.relations;
    }
    public relationFor(): undefined {
        return undefined;
    }
    public nameAt(): undefined {
        return undefined;
    }
    public callAt(): undefined {
        return undefined;
    }
    public callForRange(): undefined {
        return undefined;
    }
    public typeAt(): undefined {
        return undefined;
    }
    public availabilityAt(): undefined {
        return undefined;
    }
})();

class DocumentSemanticModel implements SemanticModel {
    private readonly _scopesById: ReadonlyMap<string, QueryScope>;
    private readonly _scopeIndex: RangeIndex<QueryScope>;
    private readonly _nameIndex: RangeIndex<BoundName>;
    private readonly _callIndex: RangeIndex<ResolvedCall>;
    private readonly _availabilityIndex: RangeIndex<FeatureAvailabilityDecision>;
    private readonly _callsByRange: ReadonlyMap<string, ResolvedCall>;

    public constructor(
        public readonly scopes: readonly QueryScope[],
        public readonly relations: readonly BoundRelation[],
        public readonly names: readonly BoundName[],
        public readonly calls: readonly ResolvedCall[],
        public readonly expressions: readonly BoundExpression[],
        public readonly timeline: CatalogTimeline,
        public readonly availability: readonly FeatureAvailabilityDecision[],
    ) {
        this._scopesById = new Map(scopes.map((scope) => [scope.id, scope]));
        this._scopeIndex = rangeIndexFor(scopes, (scope) => scope.range);
        this._nameIndex = rangeIndexFor(names, (name) => name.range);
        this._callIndex = rangeIndexFor(calls, (call) => call.range);
        this._availabilityIndex = rangeIndexFor(availability, (decision) => decision.range);
        this._callsByRange = new Map(
            calls.map((call) => [`${call.range.start}:${call.range.end}`, call]),
        );
    }

    public scopeAt(offset: number): QueryScope | undefined {
        return this._scopeIndex.containing(offset);
    }

    public visibleRelations(offset: number): readonly BoundRelation[] {
        const result: BoundRelation[] = [];
        let scope = this.scopeAt(offset);
        const seen = new Set<string>();
        while (scope && !seen.has(scope.id)) {
            seen.add(scope.id);
            result.push(...scope.relations, ...scope.ctes);
            scope = scope.parent ? this._scopesById.get(scope.parent) : undefined;
        }
        return Object.freeze(result);
    }

    public relationFor(exposedName: string, offset: number): BoundRelation | undefined {
        const folded = exposedName.toLowerCase();
        return this.visibleRelations(offset).find(
            (relation) => relation.exposedName.toLowerCase() === folded,
        );
    }

    public nameAt(offset: number): BoundName | undefined {
        return this._nameIndex.containing(offset);
    }

    public callAt(offset: number): ResolvedCall | undefined {
        return this._callIndex.containing(offset);
    }

    public callForRange(range: TextRange): ResolvedCall | undefined {
        return this._callsByRange.get(`${range.start}:${range.end}`);
    }

    public typeAt(offset: number): ExpressionType | undefined {
        return expressionTypeAt(this.expressions, offset);
    }

    public availabilityAt(offset: number): FeatureAvailabilityDecision | undefined {
        return this._availabilityIndex.containing(offset);
    }
}

/**
 * Combines two passes over the same document.
 *
 * The later pass knows about resolved calls, so where both name the same span the later type wins;
 * everything the earlier pass typed and the later one did not is kept.
 */
function mergeExpressionTypes(
    earlier: readonly BoundExpression[],
    later: readonly BoundExpression[],
): readonly BoundExpression[] {
    if (earlier.length === 0) return later;
    const byRange = new Map<string, BoundExpression>();
    for (const entry of earlier) byRange.set(`${entry.range.start}:${entry.range.end}`, entry);
    for (const entry of later) byRange.set(`${entry.range.start}:${entry.range.end}`, entry);
    return Object.freeze(
        [...byRange.values()].sort((left, right) => left.range.start - right.range.start),
    );
}

function collectNames(
    relations: readonly BoundRelation[],
    calls: readonly ResolvedCall[],
): readonly BoundName[] {
    const names: BoundName[] = [];
    for (const relation of relations) if (relation.name) names.push(relation.name);
    for (const call of calls) if (call.name) names.push(call.name);
    return Object.freeze(names.sort((left, right) => left.range.start - right.range.start));
}

function indexSyntax(syntax: SyntaxSnapshot): ReadonlyMap<string, readonly SyntaxNode[]> {
    const existing = syntax.structuralIndex?.();
    if (existing) return existing;
    const index = new Map<string, SyntaxNode[]>();
    visit(syntax.root(), (node) => {
        const bucket = index.get(node.kind);
        if (bucket) bucket.push(node);
        else index.set(node.kind, [node]);
    });
    return index;
}
