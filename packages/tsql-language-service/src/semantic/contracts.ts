/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Parser-independent values used by the semantic orchestration layer. */

export interface SemanticSpan {
    readonly start: number;
    readonly end: number;
}

export type SemanticObjectKind =
    | "table"
    | "view"
    | "procedure"
    | "scalarFunction"
    | "tableFunction"
    | "synonym"
    | "type"
    | "unknown";

export interface SemanticColumn {
    readonly name: string;
    readonly type?: string;
    readonly nullable?: boolean;
    readonly span?: SemanticSpan;
}

export interface SemanticParameter {
    readonly name: string;
    readonly type?: string;
    readonly direction?: "input" | "output" | "inputOutput" | "returnValue";
    readonly optional?: boolean;
    readonly span?: SemanticSpan;
}

/**
 * An object identity is deliberately independent of document URI and catalog implementation.
 * It is safe to use as a cache/index key within a connection and database context.
 */
export interface SemanticObjectIdentity {
    readonly kind: SemanticObjectKind;
    readonly parts: readonly string[];
    readonly key: string;
}

export interface SemanticObject {
    readonly identity: SemanticObjectIdentity;
    readonly parts: readonly string[];
    readonly name: string;
    readonly kind: SemanticObjectKind;
    readonly columns?: readonly SemanticColumn[];
    readonly parameters?: readonly SemanticParameter[];
    readonly returnType?: string;
    readonly definition?: SemanticSpan;
    readonly uri?: string;
    readonly batch: number;
}

/**
 * Structural subset of the metadata catalog. Existing metadata adapters can be supplied without
 * creating a dependency from this layer back to the metadata package.
 */
export interface SemanticCatalogObject {
    readonly parts: readonly string[];
    readonly kind: SemanticObjectKind;
    readonly columns?: readonly SemanticColumn[];
    readonly parameters?: readonly SemanticParameter[];
    readonly returnType?: string;
}

export interface SemanticCatalogChild {
    readonly name: string;
    readonly kind: "namespace" | "table";
}

export interface SemanticCatalogProvider {
    readonly version: string | number;
    readonly world: "open" | "closed";
    columnsFor(parts: readonly string[]): readonly SemanticColumn[] | undefined;
    objectFor?(parts: readonly string[]): SemanticCatalogObject | undefined;
    childrenOf?(prefixParts: readonly string[]): readonly SemanticCatalogChild[];
    tableCandidates?(parts: readonly string[]): readonly (readonly string[])[];
    tables?(): readonly string[];
}

export interface SemanticVisibleSource {
    readonly name: string;
    readonly alias?: string;
    readonly objectParts?: readonly string[];
    readonly columns?: readonly SemanticColumn[];
    readonly span?: SemanticSpan;
}

/** Normalized grammar evidence from a current parser snapshot. */
export interface GrammarCompletionContext {
    readonly kind:
        | "object"
        | "namespace"
        | "qualifiedMember"
        | "column"
        | "expression"
        | "execute"
        | "type"
        | "unknown";
    readonly replaceSpan: SemanticSpan;
    readonly prefix: string;
    readonly qualifier?: string;
    readonly expectedKeywords?: readonly string[];
    readonly visibleSources?: readonly SemanticVisibleSource[];
}

/**
 * Minimal seam an adapter exposes from its already-current parser snapshot. No parser is invoked
 * by semantic completion, so features remain bounded to the LSP's active document generation.
 */
export interface SemanticParserSnapshot {
    completionContextAt(offset: number): GrammarCompletionContext | undefined;
    hoverTargetAt?(offset: number): SemanticHoverTarget | undefined;
    occurrences?(): readonly SemanticOccurrence[];
}

export interface SemanticHoverTarget {
    readonly kind: "object" | "column" | "alias" | "routine";
    readonly span: SemanticSpan;
    readonly name: string;
    readonly objectParts?: readonly string[];
    readonly columnName?: string;
    readonly alias?: string;
    readonly source?: SemanticVisibleSource;
}

export interface SemanticOccurrence {
    readonly identity: SemanticObjectIdentity;
    readonly span: SemanticSpan;
    readonly role: "declaration" | "reference";
    readonly uri?: string;
}
