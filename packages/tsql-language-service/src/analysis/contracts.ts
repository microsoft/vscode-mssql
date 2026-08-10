/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Parser-independent contracts for the T-SQL editor analysis pipeline.
 *
 * Offsets are UTF-16 offsets into {@link SqlAnalysisSnapshot.text}. Spans are start-inclusive and
 * end-exclusive. Lines and columns are zero-based. Implementations must treat snapshots as immutable.
 */

export type SqlAnalysisCapability =
    | "incrementalUpdate"
    | "syntaxDiagnostics"
    | "semanticDiagnostics"
    | "lexicalTokens"
    | "statements"
    | "scopes"
    | "symbols"
    | "completion"
    | "references"
    | "typeLookup"
    | "lineage"
    | "externalReferences"
    | "mutationTargets"
    | "starExpansion"
    | "signatureHelp"
    | "clauseGeometry"
    | "identifierNormalization"
    | "reservedWords"
    | "catalogAwareAnalysis";

export type SqlCapabilityLevel = "unsupported" | "partial" | "supported";

export interface SqlCapabilitySupport {
    readonly level: SqlCapabilityLevel;
    readonly detail?: string;
}

export type SqlAnalysisCapabilities = Readonly<
    Record<SqlAnalysisCapability, Readonly<SqlCapabilitySupport>>
>;

export interface SqlPosition {
    readonly line: number;
    readonly character: number;
}

export interface SqlSpan {
    readonly start: number;
    readonly end: number;
}

export interface SqlCatalogColumn {
    readonly name: string;
    readonly type?: string;
    readonly nullable?: boolean;
}

export interface SqlCatalogChild {
    readonly name: string;
    readonly kind: "namespace" | "table";
}

export interface SqlRoutineParameter {
    readonly name: string;
    readonly type?: string;
    readonly direction?: "input" | "output" | "inputOutput" | "returnValue";
    readonly optional?: boolean;
}

export interface SqlCatalogObject {
    readonly parts: readonly string[];
    readonly kind:
        | "table"
        | "view"
        | "procedure"
        | "scalarFunction"
        | "tableFunction"
        | "synonym"
        | "type"
        | "unknown";
    readonly columns?: readonly SqlCatalogColumn[];
    readonly parameters?: readonly SqlRoutineParameter[];
    readonly returnType?: string;
    readonly synonymTarget?: readonly string[];
}

/** Synchronous view over a host-owned, asynchronously populated metadata cache. */
export interface SqlCatalogProvider {
    readonly version: string | number;
    readonly world: "open" | "closed";
    columnsFor(parts: readonly string[]): readonly SqlCatalogColumn[] | undefined;
    tableCandidates?(parts: readonly string[]): readonly (readonly string[])[];
    childrenOf?(prefixParts: readonly string[]): readonly SqlCatalogChild[];
    tables?(): readonly string[];
    objectFor?(parts: readonly string[]): SqlCatalogObject | undefined;
}

export interface SqlAnalysisInput {
    readonly text: string;
    readonly uri?: string;
    readonly catalog?: SqlCatalogProvider;
}

export interface SqlAnalysisUpdate {
    readonly text: string;
    readonly uri?: string;
    /** `undefined` retains the prior catalog; `null` explicitly removes it. */
    readonly catalog?: SqlCatalogProvider | null;
}

export type SqlTokenRole =
    | "keyword"
    | "identifier"
    | "string"
    | "number"
    | "comment"
    | "operator"
    | "punctuation"
    | "whitespace"
    | "embedded"
    | "other";

export interface SqlToken {
    readonly text: string;
    readonly span: SqlSpan;
    readonly start: SqlPosition;
    readonly end: SqlPosition;
    readonly role: SqlTokenRole;
    readonly channel: "code" | "trivia" | "embedded";
    readonly consumedAs?: "keyword" | "identifier" | "type";
    readonly tokenName?: string;
}

export type SqlStatementCategory =
    | "query"
    | "dml"
    | "ddl"
    | "dcl"
    | "tcl"
    | "utility"
    | "compound"
    | "other";

export interface SqlStatement {
    readonly index: number;
    readonly span: SqlSpan;
    readonly category: SqlStatementCategory;
    readonly rootScopeId?: string;
    readonly syntaxErrorCount: number;
}

export type SqlScopeKind = "select" | "setOperation" | "pipe" | "other";

export interface SqlScopeSource {
    readonly key: string;
    readonly kind:
        | "table"
        | "cte"
        | "subquery"
        | "lateral"
        | "relation"
        | "graphTable"
        | "pivot"
        | "other";
    readonly name?: string;
    readonly nameParts?: readonly string[];
    readonly span?: SqlSpan;
}

export interface SqlScope {
    readonly id: string;
    readonly statementIndex: number;
    readonly kind: SqlScopeKind;
    readonly span?: SqlSpan;
    readonly parentId?: string;
    readonly childIds: readonly string[];
    readonly sources: readonly SqlScopeSource[];
    readonly outputs: readonly string[] | "unknown";
}

export type SqlSymbolKind =
    | "table"
    | "cte"
    | "subquery"
    | "lateral"
    | "column"
    | "alias"
    | "function"
    | "parameter"
    | "variable"
    | "procedure"
    | "tempTable"
    | "type";

export type SqlSymbolModifier =
    | "declaration"
    | "reference"
    | "output"
    | "aggregate"
    | "window"
    | "correlated"
    | "star";

export type SqlType =
    | { readonly kind: "scalar"; readonly name: string; readonly display: string }
    | { readonly kind: "array"; readonly element: SqlType; readonly display: string }
    | {
          readonly kind: "map";
          readonly key: SqlType;
          readonly value: SqlType;
          readonly display: string;
      }
    | {
          readonly kind: "struct";
          readonly fields: readonly { readonly name: string; readonly type: SqlType }[];
          readonly display: string;
      }
    | { readonly kind: "unknown"; readonly display: "unknown" };

export interface SqlOrigin {
    readonly table: readonly string[];
    readonly column: string;
}

export interface SqlSymbol {
    readonly kind: SqlSymbolKind;
    readonly modifiers: readonly SqlSymbolModifier[];
    readonly name: string;
    readonly span: SqlSpan;
    readonly frame: string;
    readonly alias?: { readonly name: string; readonly span: SqlSpan };
    readonly definition?: SqlSpan;
    readonly type?: SqlType;
    readonly origins?: readonly SqlOrigin[];
    readonly partSpans?: readonly SqlSpan[];
    readonly source?: Pick<SqlSymbol, "kind" | "name" | "span">;
}

export interface SqlDiagnostic {
    readonly kind: "syntax" | "semantic";
    readonly code: string;
    readonly message: string;
    readonly span: SqlSpan;
    readonly severity: "error" | "warning" | "information" | "hint";
}

export type SqlCompletionKind =
    | "keyword"
    | "column"
    | "table"
    | "cte"
    | "namespace"
    | "function"
    | "template"
    | "alias"
    | "procedure"
    | "type"
    | "text";

export interface SqlCompletion {
    readonly label: string;
    readonly kind: SqlCompletionKind;
    readonly detail?: string;
    readonly documentation?: string;
}

export interface SqlCompletionResult {
    readonly items: readonly SqlCompletion[];
    readonly replaceSpan?: SqlSpan;
}

export interface SqlOccurrence {
    readonly span: SqlSpan;
    readonly role: "declaration" | "reference";
}

export interface SqlReferences {
    readonly symbol: string;
    readonly kind: SqlSymbolKind;
    readonly declaration?: SqlSpan;
    readonly occurrences: readonly SqlOccurrence[];
}

export type SqlObjectKind =
    | "table"
    | "view"
    | "function"
    | "procedure"
    | "tempTable"
    | "type"
    | "unknown";

export interface SqlExternalReference {
    readonly name: string;
    readonly nameParts?: readonly string[];
    readonly kind: SqlObjectKind;
    readonly role: "read" | "write" | "execute" | "define" | "drop" | "unknown";
    readonly span: SqlSpan;
}

export interface SqlMutationTarget {
    readonly operation: "insert" | "update" | "delete" | "merge";
    readonly target: SqlExternalReference;
}

export interface SqlColumnLineage {
    readonly output: string;
    readonly origins: readonly SqlOrigin[];
}

export interface SqlExpandedColumn {
    readonly name: string;
    readonly sourceKey: string;
}

export type SqlClauseKind =
    | "select"
    | "from"
    | "join"
    | "where"
    | "groupBy"
    | "having"
    | "qualify"
    | "window"
    | "orderBy"
    | "limit";

export interface SqlClause {
    readonly kind: SqlClauseKind;
    readonly anchorSpan: SqlSpan;
    readonly span: SqlSpan;
}

export interface SqlSignature {
    readonly label: string;
    readonly parameters: readonly { readonly label: string }[];
}

export interface SqlSignatureHelp {
    readonly signatures: readonly SqlSignature[];
    readonly activeSignature: number;
    readonly activeParameter: number;
}

export interface SqlAnalysisSnapshot {
    readonly engineId: string;
    readonly text: string;
    readonly uri?: string;
    readonly version: number;
    readonly syntaxDiagnostics: readonly SqlDiagnostic[];
    readonly semanticDiagnostics: readonly SqlDiagnostic[];
    readonly tokens: readonly SqlToken[];
    readonly statements: readonly SqlStatement[];
    readonly scopes: readonly SqlScope[];

    positionAt(offset: number): SqlPosition;
    offsetAt(position: SqlPosition): number;
    scopeAt(offset: number): SqlScope | undefined;
    clausesAt(offset: number): readonly SqlClause[];
    symbols(): readonly SqlSymbol[];
    symbolAt(offset: number): SqlSymbol | undefined;
    externalReferences(): readonly SqlExternalReference[];
    mutationTargets(): readonly SqlMutationTarget[];
    lineage(): readonly SqlColumnLineage[];
    expandStarAt(offset: number): readonly SqlExpandedColumn[] | undefined;
    completeAt(offset: number): SqlCompletionResult;
    referencesAt(offset: number): SqlReferences | undefined;
    typeAt(offset: number): SqlType;
    signatureAt(offset: number): SqlSignatureHelp | undefined;
    isReservedKeyword(word: string): boolean;
    normalizeIdentifier(identifier: string, kind?: "table" | "other"): string;
    displayIdentifier(identifier: string): string;
}

/** Strategy implemented by each parser/analyzer adapter. */
export interface SqlAnalysisEngine {
    readonly id: string;
    readonly displayName: string;
    readonly version: string;
    readonly capabilities: SqlAnalysisCapabilities;

    createSnapshot(input: SqlAnalysisInput): SqlAnalysisSnapshot;
    updateSnapshot(previous: SqlAnalysisSnapshot, update: SqlAnalysisUpdate): SqlAnalysisSnapshot;
}
