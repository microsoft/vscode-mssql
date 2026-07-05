/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Statement sketch model (design 05 §7.3). The sketch is tolerant and TOTAL:
 * every statement yields a sketch even mid-edit. It records what language
 * features need — clause spans, query scopes with their sources, CTEs,
 * DML targets, EXEC calls, declarations, overlay-relevant DDL — not a full
 * AST. Expressions stay balanced-token spans until a feature needs more
 * (feature-driven deepening, design §1.3 #1).
 */

export interface SketchSpan {
    readonly start: number;
    readonly end: number;
}

export type StatementKind =
    | "select"
    | "insert"
    | "update"
    | "delete"
    | "merge"
    | "declare"
    | "set"
    | "exec"
    | "use"
    | "createTable"
    | "moduleHeader"
    | "ddl"
    | "procedural"
    | "other";

export type ClauseKind =
    | "with"
    | "selectList"
    | "into"
    | "from"
    | "on"
    | "where"
    | "groupBy"
    | "having"
    | "window"
    | "orderBy"
    | "option"
    | "values"
    | "setAssignments"
    | "insertColumns"
    | "execArgs"
    | "declareBody"
    | "useTarget"
    | "output"
    | "top"
    | "body"; // module body / opaque remainder

export interface ClauseSpan {
    readonly kind: ClauseKind;
    /** Scope this clause belongs to (correlated subqueries nest). */
    readonly scopeId: number;
    readonly span: SketchSpan;
}

export type SourceKind = "table" | "derived" | "tvf" | "values" | "openrowset" | "unknown";

export interface SourceRef {
    readonly scopeId: number;
    /** Dotted name parts in document order (unquoted text, brackets stripped). */
    readonly parts: readonly string[];
    readonly kind: SourceKind;
    readonly alias?: string;
    readonly span: SketchSpan;
    /** The derived table / TVF body scope, when kind is derived. */
    readonly innerScopeId?: number;
}

export interface QueryScope {
    readonly id: number;
    readonly parentId?: number;
    readonly span: SketchSpan;
}

export interface SelectItem {
    readonly scopeId: number;
    readonly span: SketchSpan;
    /** Trailing alias (expr AS alias / expr alias) when trivially present. */
    readonly alias?: string;
    /** True when the item is `*` or `alias.*`. */
    readonly isStar?: boolean;
    readonly starQualifier?: string;
}

export interface CteDecl {
    readonly name: string;
    /** Declared column list when written: WITH x (a, b) AS (...). */
    readonly columns?: readonly string[];
    readonly bodyScopeId?: number;
    readonly span: SketchSpan;
}

export interface VariableDecl {
    readonly name: string; // includes @
    /** Type display text; "TABLE" for table variables. */
    readonly typeText?: string;
    readonly isTable?: boolean;
    /** Declared columns for @t TABLE (...) — names only. */
    readonly tableColumns?: readonly string[];
    readonly span: SketchSpan;
}

export interface ExecArg {
    readonly name?: string; // @param when the named form is used
    readonly span: SketchSpan;
}

export interface ExecCall {
    readonly procParts: readonly string[];
    readonly procSpan: SketchSpan;
    readonly args: readonly ExecArg[];
}

export interface DmlTarget {
    readonly parts: readonly string[];
    readonly span: SketchSpan;
    /** UPDATE o SET ... FROM Orders o — alias-form target. */
    readonly isAliasForm?: boolean;
}

export interface CreatedTable {
    readonly parts: readonly string[]; // may be [#temp]
    readonly columns: readonly string[];
    readonly span: SketchSpan;
}

export interface StatementSketch {
    readonly kind: StatementKind;
    readonly span: SketchSpan;
    readonly scopes: readonly QueryScope[];
    readonly clauses: readonly ClauseSpan[];
    readonly sources: readonly SourceRef[];
    readonly selectItems: readonly SelectItem[];
    readonly ctes: readonly CteDecl[];
    readonly declares: readonly VariableDecl[];
    readonly target?: DmlTarget;
    readonly insertColumns?: { readonly names: readonly string[]; readonly span: SketchSpan };
    readonly exec?: ExecCall;
    readonly useDatabase?: string;
    readonly createdTable?: CreatedTable;
    /** SELECT ... INTO target (temp or real). */
    readonly selectInto?: { readonly parts: readonly string[]; readonly span: SketchSpan };
}
