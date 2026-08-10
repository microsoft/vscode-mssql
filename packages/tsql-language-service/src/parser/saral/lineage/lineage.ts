/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import { type Expression, type NodeLocation } from "../ast/types.js";

export type LineageSourceKind =
    | "table"
    | "cte"
    | "derived_subquery"
    | "derived_values"
    | "derived_apply"
    | "function"
    | "pivot"
    | "unpivot"
    | "pseudo_output"
    | "unknown";

export type LineageNodeKind = "table" | "column" | "cte" | "variable" | "result";

export interface LineageNode {
    kind: LineageNodeKind;

    /**
     * Full identifier:
     *  Orders.Amount
     *  Customer.Name
     *  @BatchId
     *  *
     */
    name: string;

    /**
     * Owner:
     *  Orders
     *  Customer
     */
    source?: string;
    sourceKind?: LineageSourceKind;

    /**
     * True for:
     *  Orders.*
     */
    wildcard?: boolean;
    resolution?: "resolved" | "ambiguous" | "unresolved";
    candidateSources?: string[];

    location?: NodeLocation;
}

export interface DerivedColumn {
    /**
     * Final output name
     */
    name: string;

    /**
     * Original expression
     */
    expression?: Expression;

    /**
     * Upstream inputs
     */
    inputs: LineageNode[];

    location: NodeLocation;
}

export interface VirtualSource {
    name: string;
    kind: LineageSourceKind;
    alias?: string;
    definedAt?: NodeLocation;
    baseName?: string;
    columns: Map<string, DerivedColumn>;
    wildcardSources: LineageNode[];
}

export interface SourceProjectionColumn {
    name: string;
    normalizedName: string;
    location?: NodeLocation;
}

export interface SourceExposure {
    name: string;
    alias?: string;
    kind: LineageSourceKind;
    baseName?: string;
    location?: NodeLocation;
    projection: SourceProjectionColumn[];
}

export interface AmbiguityDiagnostic {
    name: string;
    location: NodeLocation;
    candidates: string[];
}

export interface MutationTarget {
    statement: "UPDATE" | "DELETE";
    targetName: string;
    targetAlias?: string;
    resolvedSourceName?: string;
    predicateInputs: LineageNode[];
    location: NodeLocation;
}

export interface ReadScopeSource {
    name: string;
    alias?: string;
    kind: LineageSourceKind;
    location?: NodeLocation;
}

export interface ReadScopeExposure {
    statement: "INSERT" | "UPDATE" | "DELETE" | "SELECT";
    location: NodeLocation;
    sources: ReadScopeSource[];
}

export interface LineageEdge {
    from: LineageNode;
    to: LineageNode;
    location: NodeLocation;
}

export interface LineageResult {
    columns: DerivedColumn[];
    edges: LineageEdge[];
    sources: SourceExposure[];
    ambiguities: AmbiguityDiagnostic[];
    mutations: MutationTarget[];
    readScopes: ReadScopeExposure[];
}
