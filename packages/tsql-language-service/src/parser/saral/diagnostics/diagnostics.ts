/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import {
    type Program,
    type Statement,
    type Expression,
    type SelectNode,
    type UpdateNode,
    type DeleteNode,
    type InsertNode,
    type MergeNode,
    type WithNode,
    type IfNode,
    type BlockNode,
    type CreateNode,
    type AlterTableNode,
    type QueryStatement,
    type NodeLocation,
    type ColumnNode,
    type IdentifierNode,
    type TableReference,
    type FunctionCallNode,
    type CreateIndexNode,
} from "../ast/types.js";

import { type ScopeBuilderResult } from "../semantic/scopeBuilder.js";
import { SymbolKind, Scope } from "../semantic/scope.js";

// ─── Core types ───────────────────────────────────────────────────────────────

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
    code: DiagnosticCode;
    message: string;
    severity: DiagnosticSeverity;
    start: number;
    end: number;
}

export enum DiagnosticCode {
    UndeclaredVariable = "VAR001",
    UnusedVariable = "VAR002",
    UnusedParameter = "VAR003",
    VariableUsedBeforeSet = "VAR004",
    InvalidQualifiedTableVariableReference = "VAR005",
    UnknownColumn = "COL001",
    UnbracketedKeywordColumnName = "NAM001",

    MissingCommaBeforeTableConstraint = "DDL001",
    UnnamedKeyConstraint = "DDL002",
    UnnamedDefaultConstraint = "DDL003",
    CreateMustBeFirstInBatch = "DDL004",

    UpdateWithoutWhere = "DML001",
    DeleteWithoutWhere = "DML002",
    InsertWithoutColumnList = "DML003",
    UpdateTargetNoLock = "DML004",
    JoinHintUsage = "JOIN001",
    CursorUsage = "CUR001",
    TableHintUsage = "HINT001",
    QueryOptionUsage = "OPT001",

    SelectStar = "SEL001",
    SelectStarInView = "SEL002",
    SelfComparison = "LOG001",

    DuplicateVariable = "DUP001",
    DuplicateCte = "DUP002",
    DuplicateSelectAlias = "DUP003",
    InvalidBuiltinArguments = "FUN001",
    InvalidJsonFunctionArgument = "JSON001",
    InvalidVectorFunctionArgument = "VEC001",
    InvalidVectorSearch = "VEC002",
    InvalidSpecializedIndex = "IDX001",
    InvalidApproximateQuery = "VEC003",
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class DiagnosticEngine {
    private diagnostics: Diagnostic[] = [];
    private rootScope: Scope | null = null;
    private invalidQualifiedTableVariables = new Set<string>();
    private static readonly KEYWORD_COLUMN_NAMES = new Set([
        "ADD",
        "ALL",
        "ALTER",
        "AND",
        "APPLY",
        "AS",
        "ASC",
        "BEGIN",
        "BETWEEN",
        "BREAK",
        "BY",
        "CASE",
        "CATCH",
        "CHECK",
        "CLOSE",
        "COLUMN",
        "COMMIT",
        "CONSTRAINT",
        "CONTINUE",
        "CREATE",
        "CROSS",
        "CURSOR",
        "DEALLOCATE",
        "DECLARE",
        "DEFAULT",
        "DELETE",
        "DELAY",
        "DESC",
        "DISTINCT",
        "DROP",
        "ELSE",
        "END",
        "EXCEPT",
        "EXEC",
        "EXECUTE",
        "EXISTS",
        "FETCH",
        "FOR",
        "FOREIGN",
        "FROM",
        "FULL",
        "FUNCTION",
        "GO",
        "GOTO",
        "GROUP",
        "HAVING",
        "IDENTITY",
        "IF",
        "IN",
        "INDEX",
        "INNER",
        "INSERT",
        "INTERSECT",
        "INTO",
        "IS",
        "JOIN",
        "KEY",
        "LEFT",
        "LIKE",
        "LOOP",
        "MATCHED",
        "MERGE",
        "NEXT",
        "NOT",
        "NULL",
        "OFFSET",
        "ON",
        "ONLY",
        "OPEN",
        "OPTION",
        "OR",
        "ORDER",
        "OUT",
        "OUTER",
        "OUTPUT",
        "OVER",
        "PARTITION",
        "PERCENT",
        "PIVOT",
        "PRECEDING",
        "PRIMARY",
        "PRINT",
        "PROCEDURE",
        "RAISERROR",
        "RANGE",
        "READONLY",
        "REFERENCES",
        "RETURN",
        "RIGHT",
        "ROLLBACK",
        "ROW",
        "ROWS",
        "SAVE",
        "SELECT",
        "SEMICOLON",
        "SET",
        "TABLE",
        "TARGET",
        "THEN",
        "THROW",
        "TIES",
        "TOP",
        "TRAN",
        "TRANSACTION",
        "TRUNCATE",
        "TRY",
        "UNBOUNDED",
        "UNION",
        "UNIQUE",
        "UNPIVOT",
        "UPDATE",
        "USING",
        "VALUES",
        "VIEW",
        "WAITFOR",
        "WHEN",
        "WHERE",
        "WHILE",
        "WITH",
        "WITHIN",
    ]);

    run(program: Program, scopeResult: ScopeBuilderResult): Diagnostic[] {
        this.diagnostics = [];
        this.rootScope = scopeResult.root;
        this.invalidQualifiedTableVariables = new Set();

        for (const stmt of program.body) {
            this.visitStatement(stmt, false);
        }

        this.checkBatchPlacement(program);
        this.checkUndeclaredVariables(scopeResult);
        this.checkUnusedSymbols(scopeResult);
        this.checkVariableUsedBeforeSet(scopeResult);
        this.checkDuplicateDeclarations(scopeResult);

        return this.diagnostics.sort((a, b) => a.start - b.start);
    }

    // ── Scope rules ───────────────────────────────────────────────────────────

    private checkUndeclaredVariables(result: ScopeBuilderResult): void {
        for (const ref of result.undeclared) {
            this.emit({
                code: DiagnosticCode.UndeclaredVariable,
                message: `Variable is not declared`,
                severity: "error",
                start: ref.location.start,
                end: ref.location.end,
            });
        }
    }

    private checkDuplicateDeclarations(result: ScopeBuilderResult): void {
        for (const dup of result.duplicates) {
            if (dup.scopeName === "with") continue; // WITH clause duplicates are already reported by the CheckWith method

            if (dup.scopeName === "select-output") {
                this.emit({
                    code: DiagnosticCode.DuplicateSelectAlias,
                    message: `SELECT output alias '${dup.name}' is used more than once`,
                    severity: "warning",
                    start: dup.duplicate.start,
                    end: dup.duplicate.end,
                });
                continue;
            }

            this.emit({
                code: DiagnosticCode.DuplicateVariable,
                message: `'${dup.name}' is already declared in this scope`,
                severity: "error",
                start: dup.duplicate.start,
                end: dup.duplicate.end,
            });
        }
    }

    private checkUnusedSymbols(result: ScopeBuilderResult): void {
        this.walkScopes(result.root, (scope) => {
            for (const symbol of scope.getOwnSymbols()) {
                const readRefs = symbol.references.filter((r) => r.kind === "read");
                const writeRefs = symbol.references.filter((r) => r.kind === "write");

                if (readRefs.length > 0) continue;

                if (symbol.kind === SymbolKind.Variable) {
                    this.emit({
                        code: DiagnosticCode.UnusedVariable,
                        message: `Variable '${symbol.name}' is declared but never used`,
                        severity: "warning",
                        start: symbol.location.start,
                        end: symbol.location.end,
                    });
                }

                if (symbol.kind === SymbolKind.Parameter) {
                    const isOutputParameter = symbol.metadata?.isOutput === true;

                    if (isOutputParameter && writeRefs.length > 0) {
                        continue;
                    }

                    if (this.invalidQualifiedTableVariables.has(symbol.name.toLowerCase())) {
                        continue;
                    }

                    this.emit({
                        code: DiagnosticCode.UnusedParameter,
                        message: `Parameter '${symbol.name}' is declared but never used`,
                        severity: "warning",
                        start: symbol.location.start,
                        end: symbol.location.end,
                    });
                }
            }
        });
    }

    // Flags a read of a local variable that occurs before any write
    // (a SET, or a DECLARE with an initializer) reaches it. This is a
    // purely textual/offset check — it does not reason about control flow,
    // so a variable set inside one IF branch and read unconditionally
    // afterward will not be flagged. That's intentional: we'd rather miss
    // a real bug than flag a read that's actually fine on some paths.
    private checkVariableUsedBeforeSet(result: ScopeBuilderResult): void {
        this.walkScopes(result.root, (scope) => {
            for (const symbol of scope.getOwnSymbols()) {
                const isTrackable =
                    symbol.kind === SymbolKind.Variable ||
                    (symbol.kind === SymbolKind.Table && symbol.name.startsWith("@"));
                if (!isTrackable) continue;

                const writeOffsets = symbol.references
                    .filter((r) => r.kind === "write")
                    .map((r) => r.location.start);

                const earliestWrite = writeOffsets.length ? Math.min(...writeOffsets) : null;

                for (const ref of symbol.references) {
                    if (ref.kind !== "read") continue;
                    if (earliestWrite !== null && ref.location.start >= earliestWrite) continue;

                    this.emit({
                        code: DiagnosticCode.VariableUsedBeforeSet,
                        message: `Variable '${symbol.name}' is used before it is assigned a value — it will be NULL here`,
                        severity: "warning",
                        start: ref.location.start,
                        end: ref.location.end,
                    });
                }
            }
        });
    }

    // ── Statement traversal ───────────────────────────────────────────────────

    private visitStatement(stmt: Statement, insideView: boolean): void {
        switch (stmt.type) {
            case "BatchSeparatorStatement":
                break;

            case "SelectStatement":
                this.checkSelect(stmt, insideView);
                break;

            case "UpdateStatement":
                this.checkUpdate(stmt);
                break;

            case "DeleteStatement":
                this.checkDelete(stmt);
                break;

            case "InsertStatement":
                this.checkInsert(stmt);
                break;

            case "MergeStatement":
                this.checkMerge(stmt);
                break;

            case "CreateStatement":
                this.checkCreate(stmt);
                break;

            case "CreateIndexStatement":
                this.checkSpecializedIndex(stmt);
                break;

            case "AlterTableStatement":
                this.checkAlterTable(stmt);
                break;

            case "WithStatement":
                this.checkWith(stmt, insideView);
                break;

            case "IfStatement":
                this.checkIf(stmt);
                break;

            case "BlockStatement":
                this.checkBlock(stmt);
                break;

            case "DeclareCursorStatement":
                this.emit({
                    code: DiagnosticCode.CursorUsage,
                    message: `Cursor usage can be slow and hard to maintain; prefer set-based logic when possible`,
                    severity: "warning",
                    start: stmt.start,
                    end: stmt.end,
                });
                break;

            case "SetOperator":
                this.visitQuery(stmt, insideView);
                break;
        }
    }

    private visitQuery(query: QueryStatement | null, insideView: boolean): void {
        if (!query) {
            return;
        }

        if (query.type === "SetOperator") {
            this.visitQuery(query.left, insideView);

            if (query.right) {
                this.visitQuery(query.right, insideView);
            }

            return;
        }

        this.checkSelect(query, insideView);
    }

    // ── DML rules ─────────────────────────────────────────────────────────────

    private checkUpdate(stmt: UpdateNode): void {
        if (stmt.incomplete) return;

        if (this.updateTargetHasNoLockHint(stmt)) {
            this.emit({
                code: DiagnosticCode.UpdateTargetNoLock,
                message: `UPDATE target table must not use WITH (NOLOCK)`,
                severity: "error",
                start: stmt.start,
                end: stmt.end,
            });
        }

        if (!stmt.where && !this.hasJoinedFromClause(stmt.from)) {
            this.emit({
                code: DiagnosticCode.UpdateWithoutWhere,
                message: `UPDATE statement has no WHERE clause — all rows will be affected`,
                severity: "warning",
                start: stmt.start,
                end: stmt.start + 6,
            });
        }

        for (const assignment of stmt.assignments ?? []) {
            this.visitExpression(assignment.value, false);
        }

        this.visitTableReferences(stmt.from, false);

        if (stmt.where) {
            this.visitExpression(stmt.where, false);
        }

        this.checkOptionClause(stmt.optionClause);
    }

    private checkDelete(stmt: DeleteNode): void {
        if (stmt.incomplete) return;

        if (!stmt.where && !this.hasJoinedFromClause(stmt.from)) {
            this.emit({
                code: DiagnosticCode.DeleteWithoutWhere,
                message: `DELETE statement has no WHERE clause — all rows will be deleted`,
                severity: "warning",
                start: stmt.start,
                end: stmt.start + 6,
            });
        }

        this.visitTableReferences(stmt.from, false);

        if (stmt.where) {
            this.visitExpression(stmt.where, false);
        }

        this.checkOptionClause(stmt.optionClause);
    }

    private checkInsert(stmt: InsertNode): void {
        if (!stmt.columns) {
            this.emit({
                code: DiagnosticCode.InsertWithoutColumnList,
                message:
                    `INSERT statement does not specify a column list — ` +
                    `this will break if the table schema changes`,
                severity: "warning",
                start: stmt.start,
                end: stmt.start + 6,
            });
        }

        for (const columnNode of stmt.columnNodes ?? []) {
            this.checkIdentifierColumnName(columnNode);
        }

        for (const columnNode of stmt.output?.intoColumnNodes ?? []) {
            this.checkIdentifierColumnName(columnNode);
        }

        if (stmt.selectQuery) {
            this.visitQuery(stmt.selectQuery, false);
        }
    }

    private checkMerge(stmt: MergeNode): void {
        if (stmt.incomplete) return;

        for (const clause of stmt.whenClauses) {
            if (
                clause.action.type === "MergeInsertAction" &&
                clause.action.values &&
                !clause.action.columns
            ) {
                this.emit({
                    code: DiagnosticCode.InsertWithoutColumnList,
                    message:
                        `MERGE INSERT action does not specify a column list — ` +
                        `this will break if the target table schema changes`,
                    severity: "warning",
                    start: clause.action.start,
                    end: clause.action.end,
                });
            }
        }

        this.checkOptionClause(stmt.optionClause);
    }

    // ── SELECT rules ──────────────────────────────────────────────────────────

    private checkSelect(stmt: SelectNode, insideView: boolean): void {
        for (const col of stmt.columns) {
            if (this.isWildcard(col)) {
                if (insideView) {
                    this.emit({
                        code: DiagnosticCode.SelectStarInView,
                        message: `SELECT * inside a view will break if the underlying table schema changes`,
                        severity: "error",
                        start: col.start,
                        end: col.end,
                    });
                } else {
                    this.emit({
                        code: DiagnosticCode.SelectStar,
                        message: `SELECT * is not recommended — list columns explicitly`,
                        severity: "info",
                        start: col.start,
                        end: col.end,
                    });
                }
            }

            this.visitExpression(col.expression, insideView);
        }

        this.visitTableReferences(stmt.from, insideView);

        if (stmt.where) {
            this.visitExpression(stmt.where, insideView);
        }

        if (stmt.having) {
            this.visitExpression(stmt.having, insideView);
        }

        if (stmt.groupBy) {
            for (const expr of stmt.groupBy) {
                this.visitExpression(expr, insideView);
            }
        }

        if (stmt.orderBy) {
            for (const order of stmt.orderBy) {
                this.visitExpression(order.expression, insideView);
            }
        }

        this.checkApproximateQuery(stmt);

        this.checkOptionClause(stmt.optionClause);
    }

    // ── Batch rules ───────────────────────────────────────────────────────────

    // SQL Server requires CREATE/ALTER PROCEDURE, FUNCTION, VIEW, and TRIGGER
    // to be the only statement in their batch (i.e. preceded only by GO, or
    // by nothing). SET statements (most commonly SET ANSI_NULLS ON / SET
    // QUOTED_IDENTIFIER ON, which SSMS scripts immediately before these
    // objects) are treated as not counting against this rule — that pattern
    // is extremely common and we'd rather under-report than flag it.
    private static readonly BATCH_FIRST_OBJECT_TYPES = new Set([
        "PROCEDURE",
        "FUNCTION",
        "VIEW",
        "TRIGGER",
    ]);

    private checkBatchPlacement(program: Program): void {
        let sawPrecedingStatementInBatch = false;

        for (const stmt of program.body) {
            if (stmt.type === "BatchSeparatorStatement") {
                sawPrecedingStatementInBatch = false;
                continue;
            }

            if (
                stmt.type === "CreateStatement" &&
                DiagnosticEngine.BATCH_FIRST_OBJECT_TYPES.has(stmt.objectType) &&
                sawPrecedingStatementInBatch
            ) {
                this.emit({
                    code: DiagnosticCode.CreateMustBeFirstInBatch,
                    message:
                        `${stmt.orAlter ? "ALTER" : "CREATE"} ${stmt.objectType} must be the first statement in a batch — ` +
                        `add GO before it or move the preceding statements into their own batch`,
                    severity: "error",
                    start: stmt.start,
                    end: stmt.end,
                });
            }

            if (stmt.type !== "SetStatement") {
                sawPrecedingStatementInBatch = true;
            }
        }
    }

    // ── WITH / CREATE / IF / BLOCK ───────────────────────────────────────────

    private checkWith(stmt: WithNode, insideView: boolean): void {
        const seen = new Map<string, NodeLocation>();

        for (const cte of stmt.ctes) {
            const key = cte.name.toLowerCase();

            if (seen.has(key)) {
                this.emit({
                    code: DiagnosticCode.DuplicateCte,
                    message: `CTE '${cte.name}' is defined more than once in this WITH clause`,
                    severity: "error",
                    start: cte.start,
                    end: cte.end,
                });
            } else {
                seen.set(key, cte);
            }

            for (const columnName of cte.columns ?? []) {
                this.checkColumnNameText(columnName, cte.start, cte.end);
            }

            this.visitQuery(cte.query, insideView);
        }

        this.visitStatement(stmt.body, insideView);
    }

    private checkCreate(stmt: CreateNode): void {
        const isView = stmt.objectType === "VIEW";

        if (stmt.objectType === "TABLE" && stmt.constraints?.length) {
            for (const constraint of stmt.constraints) {
                if (constraint.missingLeadingComma) {
                    this.emit({
                        code: DiagnosticCode.MissingCommaBeforeTableConstraint,
                        message: `Table-level constraint is missing a preceding comma`,
                        severity: "warning",
                        start: constraint.start,
                        end: constraint.end,
                    });
                }

                this.checkUnnamedConstraint(constraint);
            }
        }

        for (const column of stmt.columns ?? []) {
            this.checkColumnNameText(column.name, column.start, column.start + column.name.length);

            for (const constraint of column.constraints ?? []) {
                this.checkUnnamedConstraint(constraint);
            }
        }

        if (!stmt.body) return;

        if (Array.isArray(stmt.body)) {
            for (const s of stmt.body) {
                this.visitStatement(s, isView);
            }
        } else {
            this.visitStatement(stmt.body, isView);
        }
    }

    private checkIf(stmt: IfNode): void {
        this.visitBranch(stmt.thenBranch, false);

        if (stmt.elseBranch) {
            this.visitBranch(stmt.elseBranch, false);
        }
    }

    private checkBlock(stmt: BlockNode): void {
        for (const s of stmt.body) {
            this.visitStatement(s, false);
        }
    }

    private visitTableReferences(
        refs: SelectNode["from"] | UpdateNode["from"] | DeleteNode["from"],
        insideView: boolean,
    ): void {
        if (!refs) {
            return;
        }

        for (const ref of refs) {
            this.checkTableHints(ref.hints, ref.start, ref.end);

            const table = ref.table;

            this.checkInvalidQualifiedTableVariableReference(table, ref.start, ref.end);

            if (table?.type === "TableReference") {
                this.visitTableReferences([table], insideView);
            } else if (table?.type === "SubqueryExpression") {
                this.visitQuery(table.query, insideView);
            } else if (table) {
                this.visitExpression(table, insideView);
            }

            for (const join of ref.joins) {
                if (join.joinHint) {
                    this.emit({
                        code: DiagnosticCode.JoinHintUsage,
                        message: `${join.joinHint} JOIN hint can reduce optimizer flexibility; review whether it is really needed`,
                        severity: "warning",
                        start: join.start,
                        end: join.end,
                    });
                }

                this.checkTableHints(join.hints, join.start, join.end);

                const jt = join.table;

                this.checkInvalidQualifiedTableVariableReference(jt, join.start, join.end);

                if (jt?.type === "TableReference") {
                    this.visitTableReferences([jt], insideView);
                } else if (jt?.type === "SubqueryExpression") {
                    this.visitQuery(jt.query, insideView);
                } else if (jt) {
                    this.visitExpression(jt, insideView);
                }

                if (join.on) {
                    this.visitExpression(join.on, insideView);
                }
            }
        }
    }

    private checkTableHints(hints: string[] | undefined, start: number, end: number): void {
        for (const hint of hints ?? []) {
            const normalized = hint.trim().toUpperCase();

            if (
                normalized === "NOLOCK" ||
                normalized === "READUNCOMMITTED" ||
                normalized === "NOEXPAND"
            ) {
                continue;
            }

            this.emit({
                code: DiagnosticCode.TableHintUsage,
                message: this.describeTableHint(hint),
                severity: "warning",
                start,
                end,
            });
        }
    }

    private checkInvalidQualifiedTableVariableReference(
        table: Expression | TableReference | null | undefined,
        start: number,
        end: number,
    ): void {
        if (!table || table.type !== "Identifier") {
            return;
        }

        const invalidVariableName = this.getInvalidQualifiedTableVariableName(table);

        if (!invalidVariableName) {
            return;
        }

        this.invalidQualifiedTableVariables.add(invalidVariableName.toLowerCase());

        this.emit({
            code: DiagnosticCode.InvalidQualifiedTableVariableReference,
            message: `Invalid schema-qualified table variable reference '${table.name}'; use '${invalidVariableName}' directly in the FROM clause`,
            severity: "error",
            start,
            end,
        });
    }

    private getInvalidQualifiedTableVariableName(expr: IdentifierNode): string | null {
        if (expr.parts.length < 2) {
            return null;
        }

        const lastPart = this.normalizeIdentifierPart(expr.parts[expr.parts.length - 1]);

        if (!lastPart.startsWith("@")) {
            return null;
        }

        return lastPart;
    }

    private normalizeIdentifierPart(part: string): string {
        return part.trim().replace(/^\[(.*)\]$/, "$1");
    }

    private checkOptionClause(
        optionClause:
            | {
                  start: number;
                  end: number;
                  hints: { kind: string; raw: string }[];
              }
            | null
            | undefined,
    ): void {
        if (!optionClause) {
            return;
        }

        for (const hint of optionClause.hints) {
            this.emit({
                code: DiagnosticCode.QueryOptionUsage,
                message: this.describeQueryOption(hint.kind, hint.raw),
                severity: "warning",
                start: optionClause.start,
                end: optionClause.end,
            });
        }
    }

    private visitBranch(branch: Statement | Statement[], insideView: boolean): void {
        if (Array.isArray(branch)) {
            for (const s of branch) {
                this.visitStatement(s, insideView);
            }
            return;
        }

        this.visitStatement(branch, insideView);
    }

    // ── Expression traversal ──────────────────────────────────────────────────

    private visitExpression(expr: Expression | null | undefined, insideView: boolean): void {
        if (!expr) return;

        switch (expr.type) {
            case "WildcardExpression":
                break;
            case "SubqueryExpression":
                this.visitQuery(expr.query, insideView);
                break;
            case "ValuesTableExpression":
                for (const row of expr.rows) {
                    for (const value of row) {
                        this.visitExpression(value, insideView);
                    }
                }
                break;

            case "InExpression":
                this.visitExpression(expr.left, insideView);

                if (expr.list) {
                    for (const item of expr.list) {
                        this.visitExpression(item, insideView);
                    }
                }

                if (expr.subquery) {
                    this.visitQuery(expr.subquery, insideView);
                }
                break;

            case "BinaryExpression":
                this.checkBinaryExpression(expr);
                this.visitExpression(expr.left, insideView);
                this.visitExpression(expr.right, insideView);
                break;

            case "UnaryExpression":
                this.visitExpression(expr.right, insideView);
                break;

            case "GroupingExpression":
                this.visitExpression(expr.expression, insideView);
                break;

            case "BetweenExpression":
                this.visitExpression(expr.left, insideView);
                this.visitExpression(expr.lowerBound, insideView);
                this.visitExpression(expr.upperBound, insideView);
                break;

            case "CaseExpression":
                if (expr.input) {
                    this.visitExpression(expr.input, insideView);
                }

                for (const b of expr.branches) {
                    this.visitExpression(b.when, insideView);
                    this.visitExpression(b.then, insideView);
                }

                if (expr.elseBranch) {
                    this.visitExpression(expr.elseBranch, insideView);
                }
                break;

            case "FunctionCall":
                this.checkFunctionCall(expr);
                this.visitExpression(expr.receiver, insideView);
                for (const arg of expr.args) {
                    this.visitExpression(arg, insideView);
                }
                break;

            case "OverExpression":
                this.visitExpression(expr.expression, insideView);

                if (expr.window.partitionBy) {
                    for (const p of expr.window.partitionBy) {
                        this.visitExpression(p, insideView);
                    }
                }

                if (expr.window.orderBy) {
                    for (const o of expr.window.orderBy) {
                        this.visitExpression(o.expression, insideView);
                    }
                }
                break;

            case "MemberExpression":
                this.visitExpression(expr.object, insideView);
                break;

            case "Literal":
            case "Variable":
                break;

            case "Identifier":
                this.checkQualifiedIdentifierColumn(expr);
                break;
        }
    }

    private checkFunctionCall(expr: FunctionCallNode): void {
        const name = expr.name.toUpperCase();
        const arity = new Map<string, readonly [number, number]>([
            ["JSON_VALUE", [2, 2]],
            ["JSON_QUERY", [1, 2]],
            ["ISJSON", [1, 2]],
            ["JSON_MODIFY", [3, 3]],
            ["JSON_PATH_EXISTS", [2, 2]],
            ["JSON_CONTAINS", [2, 4]],
            ["JSON_ARRAYAGG", [1, 1]],
            ["JSON_OBJECTAGG", [2, 2]],
            ["VECTOR_DISTANCE", [3, 3]],
            ["VECTOR_NORM", [2, 2]],
            ["VECTOR_NORMALIZE", [2, 2]],
        ]);
        const expected = arity.get(name);
        if (expected && (expr.args.length < expected[0] || expr.args.length > expected[1])) {
            const description =
                expected[0] === expected[1] ? `${expected[0]}` : `${expected[0]} to ${expected[1]}`;
            this.emit({
                code:
                    name.startsWith("JSON") || name === "ISJSON"
                        ? DiagnosticCode.InvalidJsonFunctionArgument
                        : DiagnosticCode.InvalidVectorFunctionArgument,
                message: `${name} requires ${description} argument${expected[1] === 1 ? "" : "s"}.`,
                severity: "error",
                start: expr.start,
                end: expr.start + expr.name.length,
            });
        }

        if (name === "ISJSON" && expr.args[1]) {
            const constraint =
                expr.args[1].type === "Identifier" || expr.args[1].type === "BuiltInArgument"
                    ? ("name" in expr.args[1]
                          ? expr.args[1].name
                          : expr.args[1].value
                      ).toUpperCase()
                    : "";
            if (!["VALUE", "ARRAY", "OBJECT", "SCALAR"].includes(constraint)) {
                this.emit({
                    code: DiagnosticCode.InvalidJsonFunctionArgument,
                    message: "The ISJSON type constraint must be VALUE, ARRAY, OBJECT, or SCALAR.",
                    severity: "error",
                    start: expr.args[1].start,
                    end: expr.args[1].end,
                });
            }
        }

        if (name === "VECTOR_SEARCH") {
            this.checkVectorSearch(expr);
        }
        if (name === "VECTOR_DISTANCE" && expr.args[0]) {
            this.checkVectorOptionLiteral(
                expr.args[0],
                ["cosine", "euclidean", "dot"],
                "VECTOR_DISTANCE metric",
            );
        }
        if ((name === "VECTOR_NORM" || name === "VECTOR_NORMALIZE") && expr.args[1]) {
            this.checkVectorOptionLiteral(
                expr.args[1],
                ["norm1", "norm2", "norminf"],
                `${name} norm type`,
            );
        }
    }

    private checkVectorOptionLiteral(
        expression: Expression,
        allowed: readonly string[],
        description: string,
    ): void {
        if (
            expression.type === "Literal" &&
            expression.variant === "string" &&
            allowed.includes(String(expression.value).toLowerCase())
        ) {
            return;
        }
        this.emit({
            code: DiagnosticCode.InvalidVectorFunctionArgument,
            message: `${description} must be one of ${allowed.map((value) => `'${value}'`).join(", ")}.`,
            severity: "error",
            start: expression.start,
            end: expression.end,
        });
    }

    private checkVectorSearch(expr: FunctionCallNode): void {
        const clause = expr.vectorSearch;
        if (!clause) return;
        const required = ["TABLE", "COLUMN", "SIMILAR_TO", "METRIC"];
        const allowed = [...required, "TOP_N", "L", "M", "START_ID"];
        const names = clause.parameters.map((parameter) => parameter.name);
        for (const name of required) {
            if (!names.includes(name)) {
                this.emit({
                    code: DiagnosticCode.InvalidVectorSearch,
                    message: `VECTOR_SEARCH requires the ${name} parameter.`,
                    severity: "error",
                    start: expr.start,
                    end: expr.start + expr.name.length,
                });
            }
        }
        for (const parameter of clause.parameters) {
            if (!allowed.includes(parameter.name)) {
                this.emit({
                    code: DiagnosticCode.InvalidVectorSearch,
                    message: `'${parameter.name}' is not a valid VECTOR_SEARCH parameter.`,
                    severity: "error",
                    start: parameter.start,
                    end: parameter.end,
                });
            }
            if (parameter.value?.type === "SubqueryExpression") {
                this.emit({
                    code: DiagnosticCode.InvalidVectorSearch,
                    message: `A subquery is not allowed for the ${parameter.name} parameter.`,
                    severity: "error",
                    start: parameter.value.start,
                    end: parameter.value.end,
                });
            }
        }
        const ordered = names.filter((name) => required.includes(name));
        if (ordered.some((name, index) => name !== required[index])) {
            this.emit({
                code: DiagnosticCode.InvalidVectorSearch,
                message:
                    "VECTOR_SEARCH parameters TABLE, COLUMN, SIMILAR_TO, and METRIC must appear in that order.",
                severity: "error",
                start: expr.start,
                end: expr.end,
            });
        }
        const column = clause.parameters.find((parameter) => parameter.name === "COLUMN")?.value;
        if (column?.type !== "Identifier" || column.parts.length !== 1) {
            this.emit({
                code: DiagnosticCode.InvalidVectorSearch,
                message: "The VECTOR_SEARCH COLUMN parameter must be a one-part column name.",
                severity: "error",
                start: column?.start ?? expr.start,
                end: column?.end ?? expr.start + expr.name.length,
            });
        }
        const metric = clause.parameters.find((parameter) => parameter.name === "METRIC")?.value;
        if (
            metric &&
            (metric.type !== "Literal" ||
                metric.variant !== "string" ||
                !["cosine", "euclidean", "dot"].includes(String(metric.value).toLowerCase()))
        ) {
            this.emit({
                code: DiagnosticCode.InvalidVectorSearch,
                message:
                    "The VECTOR_SEARCH METRIC parameter must be 'cosine', 'euclidean', or 'dot'.",
                severity: "error",
                start: metric.start,
                end: metric.end,
            });
        }
        if (clause.forIndexCreate) {
            this.emit({
                code: DiagnosticCode.InvalidVectorSearch,
                message: "FOR INDEX CREATE is reserved for internal use.",
                severity: "error",
                start: expr.start,
                end: expr.end,
            });
        }
    }

    private checkSpecializedIndex(stmt: CreateIndexNode): void {
        if (stmt.indexKind === "BTREE") return;
        const options = stmt.options ?? [];
        if (stmt.columns.length !== 1) {
            this.emit({
                code: DiagnosticCode.InvalidSpecializedIndex,
                message: `CREATE ${stmt.indexKind} INDEX requires exactly one key column.`,
                severity: "error",
                start: stmt.columns[0]?.start ?? stmt.nameNode.start,
                end: stmt.columns.at(-1)?.end ?? stmt.nameNode.end,
            });
        }
        if (stmt.indexKind === "VECTOR") {
            const allowed = new Set(["METRIC", "TYPE", "MAXDOP", "DROP_EXISTING", "R", "L", "M"]);
            if (!options.some((option) => option.name === "METRIC")) {
                this.emit({
                    code: DiagnosticCode.InvalidSpecializedIndex,
                    message: "CREATE VECTOR INDEX requires the METRIC option.",
                    severity: "error",
                    start: stmt.nameNode.start,
                    end: stmt.nameNode.end,
                });
            }
            for (const option of options.filter((option) => !allowed.has(option.name))) {
                this.emit({
                    code: DiagnosticCode.InvalidSpecializedIndex,
                    message: `'${option.name}' is not a valid VECTOR index option.`,
                    severity: "error",
                    start: option.start,
                    end: option.end,
                });
            }
            const metric = options.find((option) => option.name === "METRIC");
            if (
                metric &&
                !["'COSINE'", "'EUCLIDEAN'", "'DOT'"].includes(metric.value.toUpperCase())
            ) {
                this.emit({
                    code: DiagnosticCode.InvalidSpecializedIndex,
                    message: "VECTOR index METRIC must be 'cosine', 'euclidean', or 'dot'.",
                    severity: "error",
                    start: metric.start,
                    end: metric.end,
                });
            }
        } else {
            const allowed = new Set([
                "ALLOW_ROW_LOCKS",
                "ALLOW_PAGE_LOCKS",
                "ONLINE",
                "OPTIMIZE_FOR_ARRAY_SEARCH",
            ]);
            for (const option of options.filter((option) => !allowed.has(option.name))) {
                this.emit({
                    code: DiagnosticCode.InvalidSpecializedIndex,
                    message: `'${option.name}' is not a valid JSON index option.`,
                    severity: "error",
                    start: option.start,
                    end: option.end,
                });
            }
            for (const option of options.filter(
                (option) => allowed.has(option.name) && !["ON", "OFF"].includes(option.value),
            )) {
                this.emit({
                    code: DiagnosticCode.InvalidSpecializedIndex,
                    message: `${option.name} must be ON or OFF for a JSON index.`,
                    severity: "error",
                    start: option.start,
                    end: option.end,
                });
            }
            for (const path of stmt.jsonPaths ?? []) {
                if (path.type !== "Literal" || path.variant !== "string") {
                    this.emit({
                        code: DiagnosticCode.InvalidSpecializedIndex,
                        message: "JSON index paths must be string literals.",
                        severity: "error",
                        start: path.start,
                        end: path.end,
                    });
                }
            }
        }
    }

    private checkApproximateQuery(stmt: SelectNode): void {
        if (!stmt.top?.approximate && !stmt.fetchApproximate) return;
        const vectorSources = (stmt.from ?? [])
            .flatMap((reference) => [reference, ...reference.joins])
            .filter(
                (source) =>
                    source.table?.type === "FunctionCall" &&
                    source.table.name.toUpperCase() === "VECTOR_SEARCH",
            );
        const label = stmt.fetchApproximate ? "FETCH APPROX" : "TOP WITH APPROX";
        if (!vectorSources.length) {
            this.emit({
                code: DiagnosticCode.InvalidApproximateQuery,
                message: `${label} requires VECTOR_SEARCH in the FROM clause.`,
                severity: "error",
                start: stmt.top?.start ?? stmt.fetch?.start ?? stmt.start,
                end: stmt.top?.end ?? stmt.fetch?.end ?? stmt.start,
            });
        } else if (!stmt.orderBy?.length) {
            this.emit({
                code: DiagnosticCode.InvalidApproximateQuery,
                message: `${label} requires ORDER BY on the VECTOR_SEARCH distance column.`,
                severity: "error",
                start: stmt.top?.start ?? stmt.fetch?.start ?? stmt.start,
                end: stmt.top?.end ?? stmt.fetch?.end ?? stmt.start,
            });
        } else {
            const aliases = vectorSources
                .map((source) => source.alias?.replace(/^\[|\]$/gu, "").toUpperCase())
                .filter((alias): alias is string => Boolean(alias));
            const ordersByDistance = stmt.orderBy.some((order) => {
                if (order.expression.type !== "Identifier") return false;
                const parts = order.expression.parts.map((part) =>
                    part.replace(/^\[|\]$/gu, "").toUpperCase(),
                );
                if (parts.at(-1) !== "DISTANCE") return false;
                return parts.length === 1 || aliases.includes(parts.at(-2)!);
            });
            if (!ordersByDistance) {
                this.emit({
                    code: DiagnosticCode.InvalidApproximateQuery,
                    message: `${label} ORDER BY must reference the VECTOR_SEARCH distance column.`,
                    severity: "error",
                    start: stmt.orderBy[0].start,
                    end: stmt.orderBy.at(-1)!.end,
                });
            }
        }
    }

    private checkAlterTable(stmt: AlterTableNode): void {
        if (stmt.action?.kind === "ADD_COLUMN" || stmt.action?.kind === "ALTER_COLUMN") {
            const column = stmt.action.column;

            this.checkColumnNameText(column.name, column.start, column.start + column.name.length);

            for (const constraint of column.constraints ?? []) {
                this.checkUnnamedConstraint(constraint);
            }
        }

        if (stmt.action?.kind === "ADD_CONSTRAINT") {
            this.checkUnnamedConstraint(stmt.action.constraint);
        }
    }

    private checkUnnamedConstraint(constraint: {
        kind: string;
        name?: string;
        start: number;
        end: number;
    }): void {
        if (
            (constraint.kind === "PRIMARY KEY" || constraint.kind === "UNIQUE") &&
            !constraint.name
        ) {
            this.emit({
                code: DiagnosticCode.UnnamedKeyConstraint,
                message: `${constraint.kind} constraint is unnamed; naming keys makes automated drop/recreate deployments safer`,
                severity: "warning",
                start: constraint.start,
                end: constraint.end,
            });
        }

        if (constraint.kind === "DEFAULT" && !constraint.name) {
            this.emit({
                code: DiagnosticCode.UnnamedDefaultConstraint,
                message: `DEFAULT constraint is unnamed; naming defaults makes automated drop/recreate deployments safer`,
                severity: "warning",
                start: constraint.start,
                end: constraint.end,
            });
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private isWildcard(col: ColumnNode): boolean {
        const expr = col.expression;

        // Check for the new dedicated node type (e.g., SELECT *)
        if (expr.type === "WildcardExpression") {
            return true;
        }

        // Check for table wildcards (e.g., SELECT u.*)
        // If your parser still produces MemberExpression for these, keep this check:
        if (expr.type === "MemberExpression" && expr.property === "*") {
            return true;
        }

        // Fallback for legacy Identifier nodes with '*' name
        if (expr.type === "Identifier" && expr.name === "*") {
            return true;
        }

        return false;
    }

    private updateTargetHasNoLockHint(stmt: UpdateNode): boolean {
        if (!stmt.target || stmt.target.type !== "Identifier" || !stmt.from) {
            return false;
        }

        const targetName = stmt.target.name.toLowerCase();

        for (const ref of stmt.from) {
            const hints = ref.hints ?? [];

            if (!hints.some((h) => h.toUpperCase() === "NOLOCK")) {
                continue;
            }

            if (ref.alias && ref.alias.toLowerCase() === targetName) {
                return true;
            }

            if (
                ref.table &&
                ref.table.type === "Identifier" &&
                ref.table.name.toLowerCase() === targetName
            ) {
                return true;
            }
        }

        return false;
    }

    private checkBinaryExpression(expr: Extract<Expression, { type: "BinaryExpression" }>): void {
        this.checkSelfComparison(expr);
    }

    private checkSelfComparison(expr: Extract<Expression, { type: "BinaryExpression" }>): void {
        if (!expr.right) {
            return;
        }

        if (!["=", "<>", "!=", "<", ">", "<=", ">="].includes(expr.operator)) {
            return;
        }

        const leftRef = this.getComparableReferenceName(expr.left);
        const rightRef = this.getComparableReferenceName(expr.right);

        if (!leftRef || !rightRef) {
            return;
        }

        if (leftRef.toLowerCase() !== rightRef.toLowerCase()) {
            return;
        }

        this.emit({
            code: DiagnosticCode.SelfComparison,
            message: `Condition compares '${leftRef}' to itself`,
            severity: "warning",
            start: expr.start,
            end: expr.end,
        });
    }

    private getComparableReferenceName(expr: Expression): string | null {
        switch (expr.type) {
            case "Identifier":
                return expr.name;
            case "Variable":
                return expr.name;
            default:
                return null;
        }
    }

    private checkQualifiedIdentifierColumn(
        expr: Extract<Expression, { type: "Identifier" }>,
    ): void {
        if (expr.parts.length < 2 || !this.rootScope) {
            return;
        }

        const qualifier = expr.parts[0];
        const columnName = expr.parts[expr.parts.length - 1];
        const columns = this.getKnownColumnsForQualifier(qualifier, expr.start);

        if (!columns?.length) {
            return;
        }

        const normalizedTarget = this.normalizeColumnName(columnName);
        const exists = columns.some((col) => this.normalizeColumnName(col) === normalizedTarget);

        if (exists) {
            return;
        }

        this.emit({
            code: DiagnosticCode.UnknownColumn,
            message: `Unknown column '${columnName}' on '${qualifier}'`,
            severity: "warning",
            start: expr.start,
            end: expr.end,
        });
    }

    private getKnownColumnsForQualifier(name: string, offset: number): string[] | null {
        if (!this.rootScope) {
            return null;
        }

        const scope = this.rootScope.findInnermost(offset);
        const symbol = scope.resolve(name);

        if (!symbol) {
            return null;
        }

        if (symbol.columns && symbol.columns.length > 0) {
            return symbol.columns;
        }

        if (
            symbol.kind === SymbolKind.Alias &&
            symbol.metadata?.tableName &&
            typeof symbol.metadata.tableName === "string"
        ) {
            const tableSymbol = scope.resolve(symbol.metadata.tableName);
            if (tableSymbol?.columns && tableSymbol.columns.length > 0) {
                return tableSymbol.columns;
            }
        }

        return null;
    }

    private hasJoinedFromClause(
        from: SelectNode["from"] | UpdateNode["from"] | DeleteNode["from"] | undefined,
    ): boolean {
        if (!from?.length) {
            return false;
        }

        return from.some((ref) => ref.joins.length > 0);
    }

    private normalizeColumnName(name: string): string {
        return name
            .trim()
            .replace(/^\[(.*)\]$/, "$1")
            .toLowerCase();
    }

    private describeTableHint(hint: string): string {
        const normalized = hint.trim().toUpperCase();

        if (normalized === "NOLOCK" || normalized === "READUNCOMMITTED") {
            return `Table hint '${hint}' can return dirty or inconsistent data; prefer READ COMMITTED SNAPSHOT or SNAPSHOT isolation when blocking is the concern`;
        }

        if (normalized === "READPAST") {
            return `Table hint '${hint}' silently skips locked rows; prefer queue-specific logic or row versioning if skipped work would be risky`;
        }

        if (
            normalized === "UPDLOCK" ||
            normalized === "HOLDLOCK" ||
            normalized === "SERIALIZABLE"
        ) {
            return `Table hint '${hint}' increases locking and deadlock risk; consider narrower transactions or stronger isolation only around the critical section`;
        }

        if (
            normalized === "TABLOCK" ||
            normalized === "TABLOCKX" ||
            normalized === "XLOCK" ||
            normalized === "ROWLOCK" ||
            normalized === "PAGLOCK"
        ) {
            return `Table hint '${hint}' forces a locking strategy and can hurt concurrency; prefer letting the optimizer choose unless contention data proves otherwise`;
        }

        if (normalized.startsWith("INDEX(")) {
            return `Table hint '${hint}' couples the query to a specific index and can age badly as data changes; prefer refreshed statistics, indexing changes, or query rewrites first`;
        }

        if (normalized.startsWith("FORCESEEK") || normalized.startsWith("FORCESCAN")) {
            return `Table hint '${hint}' forces an access path and can become a regression as data distribution changes; prefer statistics updates or query tuning before pinning the plan`;
        }

        return `Table hint '${hint}' overrides optimizer behavior and may trade correctness or concurrency for a local fix; verify the risk and consider isolation-level or indexing changes first`;
    }

    private describeQueryOption(kind: string, raw: string): string {
        switch (kind) {
            case "RECOMPILE":
                return `OPTION (${raw}) avoids plan reuse and can increase CPU under load; prefer fixing parameter sensitivity with Query Store hints, filtered stats, or query rewrites when possible`;

            case "MAXDOP":
                return `OPTION (${raw}) forces a parallelism cap and can shift load elsewhere; prefer server or database-level tuning unless this query is a proven hotspot`;

            case "FAST":
                return `OPTION (${raw}) biases the plan for early rows and can hurt full-result performance; prefer explicit pagination or query rewrites if first-row latency matters`;

            case "MAXRECURSION":
                return `OPTION (${raw}) changes recursion safety limits; verify termination logic and consider tightening the CTE rather than relying on a high cap`;

            case "FORCE_ORDER":
                return `OPTION (${raw}) removes join reordering freedom and can regress as cardinalities drift; prefer better statistics or clearer predicates first`;

            case "HASH_JOIN":
            case "MERGE_JOIN":
            case "LOOP_JOIN":
            case "HASH_GROUP":
            case "ORDER_GROUP":
            case "MERGE_UNION":
            case "CONCAT_UNION":
                return `OPTION (${raw}) forces a physical strategy and reduces optimizer flexibility; prefer updated statistics or query/index tuning before pinning the plan shape`;

            case "KEEP_PLAN":
            case "KEEPFIXED_PLAN":
            case "ROBUST_PLAN":
                return `OPTION (${raw}) changes plan stability behavior and can hide underlying cardinality issues; prefer fixing statistics or query shape first`;

            case "PARAMETERIZATION":
            case "OPTIMIZE_FOR":
            case "USE_HINT":
                return `OPTION (${raw}) is a targeted optimizer override; document why it is needed and prefer Query Store hints or schema/statistics fixes when available`;

            default:
                return `OPTION (${raw}) overrides normal optimizer choices; document the reason and review whether statistics, indexing, or query rewrites would be safer long term`;
        }
    }

    private walkScopes(scope: Scope, visitor: (scope: Scope) => void): void {
        visitor(scope);

        for (const child of scope.getChildren()) {
            this.walkScopes(child, visitor);
        }
    }

    private emit(diagnostic: Diagnostic): void {
        this.diagnostics.push(diagnostic);
    }

    private checkIdentifierColumnName(node: IdentifierNode): void {
        this.checkColumnNameText(node.name, node.start, node.end);
    }

    private checkColumnNameText(name: string, start: number, end: number): void {
        if (!name || name.startsWith("[") || name.includes(".")) {
            return;
        }

        const normalized = name.toUpperCase();

        if (DiagnosticEngine.KEYWORD_COLUMN_NAMES.has(normalized)) {
            this.emit({
                code: DiagnosticCode.UnbracketedKeywordColumnName,
                message: `Column name '${normalized}' matches a SQL keyword; bracket it to avoid ambiguity`,
                severity: "warning",
                start,
                end,
            });
        }
    }
}

// ─── Convenience ──────────────────────────────────────────────────────────────

export function diagnose(program: Program, scopeResult: ScopeBuilderResult): Diagnostic[] {
    return new DiagnosticEngine().run(program, scopeResult);
}
