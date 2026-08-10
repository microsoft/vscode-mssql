/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import {
    type Program,
    type Expression,
    type IdentifierNode,
    type SelectNode,
    type UpdateNode,
    type DeleteNode,
} from "../ast/types.js";

import { LineageBuilder } from "../lineage/lineageBuilder.js";
import { type LineageNode, type DerivedColumn, type LineageResult } from "../lineage/lineage.js";
import { type ScopeBuilderResult } from "./scopeBuilder.js";
import { Scope, type Symbol, type SymbolColumn } from "./scope.js";
import { resolveTypeMember } from "./typeMembers.js";
import { collectNodes } from "../ast/astWalker.js";

// ---------------------------------------------
// Public types
// ---------------------------------------------
export interface ColumnResolution {
    location: IdentifierNode;
    inputs: LineageNode[];
    ambiguityCandidates?: string[];
    owner?: string;
    scopeDepth?: number;
    decisionReason?:
        | "qualified_reference"
        | "single_scope_owner"
        | "single_candidate_promotion"
        | "ambiguous_candidates"
        | "unresolved_external"
        | "non_column";
    decision: {
        owner?: string;
        scopeDepth?: number;
        ambiguityCandidates?: string[];
        decisionReason: NonNullable<ColumnResolution["decisionReason"]>;
    };
    isCorrelated?: boolean;
    isUnverifiable?: boolean;
}

export interface ColumnAnalysisResult {
    resolutions: ColumnResolution[];
    propertyAccesses: PropertyAccessResolution[];
}

export interface PropertyAccessResolution {
    location: IdentifierNode;
    baseExpr: string;
    member: string;
    resolutionMode: "local_typed_member" | "local_untyped_member" | "shape_member";
    owner?: string;
    dataType?: string;
    memberType?: string;
}

// ---------------------------------------------
// Column Analyzer
// ---------------------------------------------
export class ColumnAnalyzer {
    private builder = new LineageBuilder();

    analyze(
        program: Program,
        scopeResult?: ScopeBuilderResult,
        prebuiltLineage?: LineageResult,
    ): ColumnAnalysisResult {
        const lineage = prebuiltLineage ?? this.builder.build(program);

        const resolutions: ColumnResolution[] = [];
        const propertyAccesses: PropertyAccessResolution[] = [];

        // Walk all derived columns from lineage
        for (const col of lineage.columns) {
            if (!col.expression) continue;

            this.collectIdentifiers(col.expression, (id) => {
                this.resolveAndRecordColumn(
                    id,
                    this.getIdentifierInputs(id, col.inputs),
                    scopeResult,
                    resolutions,
                    propertyAccesses,
                );
            });
        }

        // ORDER BY can reference a SELECT-list output alias
        // (e.g. `SELECT Id AS RowId ... ORDER BY RowId`) rather than a
        // real table column. lineage.columns only tracks projected output
        // columns, so without this pass these references got no
        // resolution at all. Resolve them by reusing the already-computed
        // lineage inputs of the SELECT column the alias refers to.
        //
        // Known limitation: this only covers ORDER BY names that match a
        // SELECT-list alias. ORDER BY referencing a real FROM-clause
        // column that isn't in the SELECT list is not yet covered.
        const derivedColumnsByOffset = new Map<number, DerivedColumn>();
        for (const col of lineage.columns) {
            derivedColumnsByOffset.set(col.location.start, col);
        }

        const selectsWithOrderBy = collectNodes(program, (n): n is SelectNode => {
            if (n.type !== "SelectStatement") return false;
            return !!(n as SelectNode).orderBy?.length;
        });

        for (const stmt of selectsWithOrderBy) {
            for (const order of stmt.orderBy!) {
                this.collectIdentifiers(order.expression, (id) => {
                    if (id.parts.length !== 1) return;

                    const matchedColumn = stmt.columns.find(
                        (c) => c.outputName.toLowerCase() === id.name.toLowerCase(),
                    );
                    if (!matchedColumn) return;

                    const derived = derivedColumnsByOffset.get(matchedColumn.start);
                    if (!derived) return;

                    this.resolveAndRecordColumn(
                        id,
                        derived.inputs,
                        scopeResult,
                        resolutions,
                        propertyAccesses,
                    );
                });
            }
        }

        // UPDATE/DELETE WHERE-clause columns are read-side references, not
        // part of the mutation target — lineageBuilder already resolves
        // them (lineage.mutations[].predicateInputs) but columnAnalyzer
        // never consumed that, so they had no resolution entry at all
        // (lineage.columns only tracks SET-assignment values for UPDATE,
        // and nothing at all for DELETE).
        const mutationsByOffset = new Map(
            lineage.mutations.map((m) => [m.location.start, m] as const),
        );

        const updatesAndDeletes = collectNodes(
            program,
            (n): n is UpdateNode | DeleteNode =>
                n.type === "UpdateStatement" || n.type === "DeleteStatement",
        );

        for (const stmt of updatesAndDeletes) {
            if (!stmt.where) continue;

            const mutation = mutationsByOffset.get(stmt.start);
            if (!mutation?.predicateInputs) continue;

            this.collectIdentifiers(stmt.where, (id) => {
                this.resolveAndRecordColumn(
                    id,
                    this.getIdentifierInputs(id, mutation.predicateInputs!),
                    scopeResult,
                    resolutions,
                    propertyAccesses,
                );
            });
        }

        return { resolutions, propertyAccesses };
    }

    private resolveAndRecordColumn(
        id: IdentifierNode,
        inputs: LineageNode[],
        scopeResult: ScopeBuilderResult | undefined,
        resolutions: ColumnResolution[],
        propertyAccesses: PropertyAccessResolution[],
    ): void {
        const ambiguityCandidates = this.collectAmbiguityCandidates(inputs);
        const propertyAccess = this.buildPropertyAccessDecision(id, scopeResult?.root);
        const decision = this.buildDecision(
            id,
            inputs,
            ambiguityCandidates,
            scopeResult?.root,
            propertyAccess,
        );

        let isUnverifiable = false;
        if (scopeResult && id.parts.length === 1) {
            let scope: any = scopeResult.root.findInnermost(id.start);
            while (scope) {
                if (scope.hasUnverifiableSources) {
                    isUnverifiable = true;
                    break;
                }
                scope = scope.parent;
            }
        }

        resolutions.push({
            location: id,
            inputs,
            ...(ambiguityCandidates.length ? { ambiguityCandidates } : {}),
            ...(decision.owner !== undefined ? { owner: decision.owner } : {}),
            ...(decision.scopeDepth !== undefined ? { scopeDepth: decision.scopeDepth } : {}),
            decisionReason: decision.decisionReason,
            decision,
            isCorrelated:
                id.parts.length >= 2 && inputs.some((input) => input.resolution === "resolved"),
            ...(isUnverifiable ? { isUnverifiable } : {}),
        });

        if (propertyAccess) {
            propertyAccesses.push(propertyAccess);
        }
    }

    private collectAmbiguityCandidates(inputs: LineageNode[]): string[] {
        const seen = new Set<string>();
        const candidates: string[] = [];

        for (const input of inputs) {
            for (const candidate of input.candidateSources ?? []) {
                const key = candidate.toLowerCase();
                if (seen.has(key)) {
                    continue;
                }

                seen.add(key);
                candidates.push(candidate);
            }
        }

        return candidates;
    }

    private getIdentifierInputs(
        identifier: IdentifierNode,
        columnInputs: LineageNode[],
    ): LineageNode[] {
        const matched = columnInputs.filter(
            (input) =>
                input.location &&
                input.location.start === identifier.start &&
                input.location.end === identifier.end,
        );

        if (matched.length > 0) {
            return matched;
        }

        return columnInputs;
    }

    private buildDecision(
        identifier: IdentifierNode,
        inputs: LineageNode[],
        ambiguityCandidates: string[],
        rootScope?: Scope,
        propertyAccess?: PropertyAccessResolution | null,
    ): ColumnResolution["decision"] {
        const resolvedSources = inputs
            .filter(
                (input) =>
                    input.kind === "column" && input.resolution === "resolved" && !!input.source,
            )
            .map((input) => input.source!);
        const uniqueResolved = [...new Set(resolvedSources.map((x) => x.toLowerCase()))].map(
            (key) => resolvedSources.find((x) => x.toLowerCase() === key)!,
        );
        const hasColumnInput = inputs.some((input) => input.kind === "column");

        if (identifier.parts.length >= 2) {
            const qualifier = identifier.parts[0];

            // Prefer the literal qualifier when it is itself a real,
            // scope-resolvable name (alias, table variable, CTE, derived
            // table, ...). Lineage's deep source-tracing can cross through
            // a derived/union boundary and surface an unrelated base table
            // — correct for a simple 1:1 passthrough alias, wrong for
            // anything where the qualifier's own projection is what matters.
            if (rootScope) {
                const scope = rootScope.findInnermost(identifier.start);

                if (scope.resolve(qualifier)) {
                    const scopeDepth = this.resolveScopeDepth(
                        rootScope,
                        identifier.start,
                        qualifier,
                    );
                    return {
                        owner: qualifier,
                        ...(scopeDepth !== undefined ? { scopeDepth } : {}),
                        ...(ambiguityCandidates.length ? { ambiguityCandidates } : {}),
                        decisionReason: "qualified_reference",
                    };
                }

                // Not a real table/alias qualifier — this is a member or
                // property access on a locally-typed column (e.g.
                // GeoPoint.Lat), not a table-qualified column reference.
                // Defer to that decision's owner so resolutions[] and
                // propertyAccesses[] agree instead of contradicting
                // each other.
                if (propertyAccess?.owner && propertyAccess.resolutionMode !== "shape_member") {
                    const scopeDepth = this.resolveScopeDepth(
                        rootScope,
                        identifier.start,
                        propertyAccess.owner,
                    );
                    return {
                        owner: propertyAccess.owner,
                        ...(scopeDepth !== undefined ? { scopeDepth } : {}),
                        decisionReason: "qualified_reference",
                    };
                }
            }

            const owner = uniqueResolved[0] ?? qualifier;
            const scopeDepth = rootScope
                ? this.resolveScopeDepth(rootScope, identifier.start, owner)
                : undefined;
            return {
                owner,
                ...(scopeDepth !== undefined ? { scopeDepth } : {}),
                ...(ambiguityCandidates.length ? { ambiguityCandidates } : {}),
                decisionReason: "qualified_reference",
            };
        }

        if (!hasColumnInput) {
            return {
                decisionReason: "non_column",
            };
        }

        if (ambiguityCandidates.length > 1) {
            return {
                ambiguityCandidates,
                decisionReason: "ambiguous_candidates",
            };
        }

        if (uniqueResolved.length === 1) {
            const owner = uniqueResolved[0];
            const scopeDepth = rootScope
                ? this.resolveScopeDepth(rootScope, identifier.start, owner)
                : undefined;
            const promoted = inputs.some(
                (input) =>
                    input.kind === "column" &&
                    input.resolution === "resolved" &&
                    input.source === owner &&
                    (input.candidateSources?.length ?? 0) === 1,
            );
            return {
                owner,
                ...(scopeDepth !== undefined ? { scopeDepth } : {}),
                ...(ambiguityCandidates.length ? { ambiguityCandidates } : {}),
                decisionReason: promoted ? "single_candidate_promotion" : "single_scope_owner",
            };
        }

        if (ambiguityCandidates.length === 1) {
            const owner = ambiguityCandidates[0];
            const scopeDepth = rootScope
                ? this.resolveScopeDepth(rootScope, identifier.start, owner)
                : undefined;
            return {
                owner,
                ...(scopeDepth !== undefined ? { scopeDepth } : {}),
                ambiguityCandidates,
                decisionReason: "single_candidate_promotion",
            };
        }

        return {
            ...(ambiguityCandidates.length ? { ambiguityCandidates } : {}),
            decisionReason: "unresolved_external",
        };
    }

    private resolveScopeDepth(root: Scope, offset: number, ownerName: string): number | undefined {
        let scope: Scope | null = root.findInnermost(offset);
        let depth = 0;

        while (scope) {
            if (scope.resolveLocal(ownerName)) {
                return depth;
            }
            depth++;
            scope = scope.parent;
        }

        return undefined;
    }

    private buildPropertyAccessDecision(
        identifier: IdentifierNode,
        rootScope?: Scope,
    ): PropertyAccessResolution | null {
        if (identifier.parts.length < 2) {
            return null;
        }

        const baseExpr = identifier.parts.slice(0, -1).join(".");
        const member = identifier.parts[identifier.parts.length - 1];

        // table-or-alias qualified column (e.g., e.FirstName) is not property access
        if (identifier.parts.length === 2 && rootScope) {
            const scope = rootScope.findInnermost(identifier.start);
            if (scope.resolve(identifier.parts[0])) {
                return null;
            }

            const localOwner = this.resolveSingleLocalColumnOwner(scope, identifier.parts[0]);
            if (localOwner) {
                const resolvedMember = resolveTypeMember(localOwner.column.dataType, member);
                return {
                    location: identifier,
                    baseExpr,
                    member,
                    owner: localOwner.owner.name,
                    ...(localOwner.column.dataType ? { dataType: localOwner.column.dataType } : {}),
                    ...(resolvedMember ? { memberType: resolvedMember.returnType } : {}),
                    resolutionMode: localOwner.column.dataType
                        ? "local_typed_member"
                        : "local_untyped_member",
                };
            }
        }

        // qualifier.base.member chain (e.g., te.GeoPoint.Lat)
        if (identifier.parts.length >= 3 && rootScope) {
            const scope = rootScope.findInnermost(identifier.start);
            const qualifier = identifier.parts[0];
            const baseColumn = identifier.parts[1];
            const symbol = scope.resolve(qualifier);
            const localColumn = symbol ? this.findLocalColumn(symbol, baseColumn) : undefined;

            if (localColumn) {
                const resolvedMember = resolveTypeMember(localColumn.dataType, member);
                return {
                    location: identifier,
                    baseExpr,
                    member,
                    owner: symbol?.name,
                    ...(localColumn.dataType ? { dataType: localColumn.dataType } : {}),
                    ...(resolvedMember ? { memberType: resolvedMember.returnType } : {}),
                    resolutionMode: localColumn.dataType
                        ? "local_typed_member"
                        : "local_untyped_member",
                };
            }
        }

        return {
            location: identifier,
            baseExpr,
            member,
            resolutionMode: "shape_member",
        };
    }

    private resolveSingleLocalColumnOwner(
        scope: Scope,
        columnName: string,
    ): { owner: Symbol; column: SymbolColumn } | null {
        const normalized = columnName.toLowerCase();
        const candidates: { owner: Symbol; column: SymbolColumn }[] = [];
        const seen = new Set<string>();

        for (const symbol of scope.getVisibleSymbols()) {
            const key = symbol.name.toLowerCase();
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);

            const matched = symbol.localColumns?.find((col) => col.normalizedName === normalized);
            if (matched) {
                candidates.push({ owner: symbol, column: matched });
            }
        }

        if (candidates.length === 1) {
            return candidates[0];
        }

        return null;
    }

    private findLocalColumn(symbol: Symbol, columnName: string): SymbolColumn | undefined {
        const normalized = columnName.toLowerCase();
        return symbol.localColumns?.find((col) => col.normalizedName === normalized);
    }

    // -----------------------------------------
    // Expression traversal (NULL SAFE)
    // -----------------------------------------

    private collectIdentifiers(
        expr: Expression | null | undefined,
        cb: (id: IdentifierNode) => void,
    ): void {
        if (!expr) return;

        switch (expr.type) {
            case "Identifier":
                cb(expr);
                return;

            case "BinaryExpression":
                this.collectIdentifiers(expr.left, cb);
                this.collectIdentifiers(expr.right, cb); // can be null
                return;

            case "UnaryExpression":
                this.collectIdentifiers(expr.right, cb); // can be null
                return;

            case "GroupingExpression":
                this.collectIdentifiers(expr.expression, cb); // can be null
                return;

            case "FunctionCall":
                this.collectIdentifiers(expr.receiver, cb);
                for (const arg of expr.args) {
                    this.collectIdentifiers(arg, cb);
                }
                return;

            case "ValuesTableExpression":
                for (const row of expr.rows) {
                    for (const value of row) {
                        this.collectIdentifiers(value, cb);
                    }
                }
                return;

            case "CaseExpression":
                if (expr.input) {
                    this.collectIdentifiers(expr.input, cb);
                }

                for (const branch of expr.branches) {
                    this.collectIdentifiers(branch.when, cb); // nullable
                    this.collectIdentifiers(branch.then, cb); // nullable
                }

                if (expr.elseBranch) {
                    this.collectIdentifiers(expr.elseBranch, cb);
                }
                return;

            // ✅ FIXED: InExpression (your actual shape)
            case "InExpression":
                this.collectIdentifiers(expr.left, cb);

                if (expr.list) {
                    for (const item of expr.list) {
                        this.collectIdentifiers(item, cb);
                    }
                }

                // subquery intentionally ignored (handled by lineage)
                return;

            // ✅ FIXED: BetweenExpression (your actual shape)
            case "BetweenExpression":
                this.collectIdentifiers(expr.left, cb);
                this.collectIdentifiers(expr.lowerBound, cb);
                this.collectIdentifiers(expr.upperBound, cb);
                return;

            case "MemberExpression":
                this.collectIdentifiers(expr.object, cb);
                return;

            case "OverExpression":
                this.collectIdentifiers(expr.expression, cb);

                if (expr.window.partitionBy) {
                    for (const p of expr.window.partitionBy) {
                        this.collectIdentifiers(p, cb);
                    }
                }

                if (expr.window.orderBy) {
                    for (const o of expr.window.orderBy) {
                        this.collectIdentifiers(o.expression, cb);
                    }
                }

                return;

            case "SubqueryExpression":
                // handled elsewhere
                return;

            case "WildcardExpression":
                // no identifiers to collect
                return;

            case "Literal":
                return;

            case "Variable":
                return;

            default:
                return;
        }
    }
}
