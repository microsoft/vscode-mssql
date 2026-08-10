/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import {
    type Program,
    type Statement,
    type Expression,
    type DeclareNode,
    type CreateNode,
    type WithNode,
    type BlockNode,
    type IfNode,
    type SelectNode,
    type UpdateNode,
    type UpdateAssignment,
    type DeleteNode,
    type InsertNode,
    type SetNode,
    type PrintNode,
    type MergeNode,
    type TryCatchNode,
    type RaiseErrorNode,
    type ThrowNode,
    type WhileNode,
    type ExecuteNode,
    type ReturnNode,
    type WaitForNode,
    type DeclareCursorNode,
    type OpenCursorNode,
    type FetchCursorNode,
    type CloseCursorNode,
    type DeallocateCursorNode,
    type QueryStatement,
    type TableReference,
    type JoinNode,
    type NodeLocation,
    type SubqueryExpression,
    type OutputClauseNode,
    type IdentifierNode,
} from "../ast/types.js";

import {
    Scope,
    type Symbol,
    SymbolKind,
    type SymbolReference,
    type ReferenceKind,
    type SymbolColumn,
} from "./scope.js";
import { getTypeMembers } from "./typeMembers.js";

export interface DuplicateDeclaration {
    name: string;
    original: NodeLocation;
    duplicate: NodeLocation;
    scopeName?: string;
}

// ─── Result ──────────────────────────────────────────────────────────────────

export interface ScopeBuilderResult {
    root: Scope;
    references: Map<string, SymbolReference[]>;
    undeclared: SymbolReference[];
    duplicates: DuplicateDeclaration[];
}

// ─── Builder ─────────────────────────────────────────────────────────────────

export class ScopeBuilder {
    private root!: Scope;
    private current!: Scope;

    private references = new Map<string, SymbolReference[]>();
    private undeclared: SymbolReference[] = [];
    private duplicates: DuplicateDeclaration[] = [];

    // ── Public ────────────────────────────────────────────────────────────────

    build(program: Program): ScopeBuilderResult {
        this.references = new Map();
        this.undeclared = [];
        this.duplicates = [];

        this.root = new Scope(0, Number.MAX_SAFE_INTEGER, null, "root");
        this.current = this.root;

        if (program.body.some((stmt) => stmt.type === "BatchSeparatorStatement")) {
            this.visitBatches(program);
        } else {
            for (const stmt of program.body) {
                this.visitStatement(stmt);
            }
        }

        return {
            root: this.root,
            references: this.references,
            undeclared: this.undeclared,
            duplicates: this.duplicates,
        };
    }

    private visitBatches(program: Program): void {
        for (let i = 0; i < program.body.length; i++) {
            const stmt = program.body[i];

            if (stmt.type === "BatchSeparatorStatement") {
                if (this.current !== this.root) {
                    this.popScope();
                }
                continue;
            }

            if (this.current === this.root) {
                this.pushScope(stmt.start, this.findBatchEnd(program, i), "batch");
            }

            this.visitStatement(stmt);
        }

        if (this.current !== this.root) {
            this.popScope();
        }
    }

    private findBatchEnd(program: Program, startIndex: number): number {
        for (let i = startIndex + 1; i < program.body.length; i++) {
            const stmt = program.body[i];
            if (stmt.type === "BatchSeparatorStatement") {
                return stmt.start;
            }
        }

        return program.end;
    }

    // ── Scope stack ───────────────────────────────────────────────────────────

    private pushScope(start: number, end: number, name?: string): void {
        const child = new Scope(start, end, this.current, name);
        this.current = child;
    }

    private popScope(): void {
        if (this.current.parent) {
            this.current = this.current.parent;
        }
    }

    private declare(symbol: Symbol): void {
        const existing = this.current.define(symbol);
        if (existing) {
            this.duplicates.push({
                name: symbol.name,
                original: existing.location,
                duplicate: symbol.location,
                scopeName: this.current.name,
            });
        }
    }

    // CREATE TYPE persists across GO-separated batches like any other
    // catalog object (unlike DECLARE'd variables, which are batch-scoped),
    // so a TVP parameter's type lookup can't rely on the normal
    // ancestor-chain resolve() — the type may live in a sibling batch
    // scope. Search the whole tree instead.
    private findTypeSymbol(name: string): Symbol | undefined {
        const search = (scope: Scope): Symbol | undefined => {
            const local = scope.resolveLocal(name);
            if (local?.kind === SymbolKind.Type) {
                return local;
            }
            for (const child of scope.getChildren()) {
                const found = search(child);
                if (found) {
                    return found;
                }
            }
            return undefined;
        };

        return search(this.root);
    }

    // ── References ────────────────────────────────────────────────────────────

    private recordReference(
        name: string,
        location: NodeLocation,
        kind: ReferenceKind = "read",
    ): void {
        if (name.startsWith("@@")) return;

        const ref: SymbolReference = { location, kind };
        const key = name.toLowerCase();

        if (!this.references.has(key)) {
            this.references.set(key, []);
        }

        this.references.get(key)!.push(ref);

        const symbol = this.current.resolve(name);
        if (symbol) {
            symbol.references.push(ref);
        } else {
            this.undeclared.push(ref);
        }
    }

    // ── Statement visitor ─────────────────────────────────────────────────────

    private visitStatement(stmt: Statement): void {
        switch (stmt.type) {
            case "BatchSeparatorStatement":
                break;

            case "DeclareStatement":
                this.visitDeclare(stmt);
                break;

            case "CreateStatement":
                this.visitCreate(stmt);
                break;

            case "WithStatement":
                this.visitWith(stmt);
                break;

            case "BlockStatement":
                this.visitBlock(stmt);
                break;

            case "IfStatement":
                this.visitIf(stmt);
                break;

            case "SelectStatement":
                this.visitSelect(stmt);
                break;

            case "SetOperator":
                this.visitQuery(stmt);
                break;

            case "UpdateStatement":
                this.visitUpdate(stmt);
                break;

            case "DeleteStatement":
                this.visitDelete(stmt);
                break;

            case "InsertStatement":
                this.visitInsert(stmt);
                break;

            case "MergeStatement":
                this.visitMerge(stmt);
                break;

            case "SetStatement":
                this.visitSet(stmt);
                break;

            case "PrintStatement":
                this.visitPrint(stmt);
                break;

            case "RaiseErrorStatement":
                this.visitRaiseError(stmt);
                break;

            case "ThrowStatement":
                this.visitThrow(stmt);
                break;

            case "TryCatchStatement":
                this.visitTryCatch(stmt);
                break;

            case "WhileStatement":
                this.visitWhile(stmt);
                break;

            case "ExecuteStatement":
                this.visitExecute(stmt);
                break;

            case "ReturnStatement":
                this.visitReturn(stmt);
                break;

            case "WaitForStatement":
                this.visitWaitFor(stmt);
                break;

            case "DeclareCursorStatement":
                this.visitDeclareCursor(stmt);
                break;

            case "OpenCursorStatement":
                this.visitOpenCursor(stmt);
                break;

            case "FetchCursorStatement":
                this.visitFetchCursor(stmt);
                break;

            case "CloseCursorStatement":
                this.visitCloseCursor(stmt);
                break;

            case "DeallocateCursorStatement":
                this.visitDeallocateCursor(stmt);
                break;

            default:
                break;
        }
    }

    // ── DML ───────────────────────────────────────────────────────────────────

    private visitDeclare(stmt: DeclareNode): void {
        for (const variable of stmt.variables) {
            const localColumns = variable.columns?.map((c) =>
                this.makeSymbolColumn(c.name, c.dataType, c),
            );

            this.declare({
                name: variable.name,
                kind: variable.dataType === "TABLE" ? SymbolKind.Table : SymbolKind.Variable,
                dataType: variable.dataType,
                columns: variable.columns?.map((c) => c.name),
                ...(localColumns?.length ? { localColumns } : {}),
                location: { start: variable.start, end: variable.end },
                references: [],
            });

            if (variable.initialValue) {
                this.visitExpression(variable.initialValue);

                // DECLARE @x INT = 1 assigns a value just like SET would —
                // record it as a write so "used before SET" analysis doesn't
                // treat an initialized variable as never having been set.
                if (variable.name.startsWith("@")) {
                    this.recordReference(
                        variable.name,
                        { start: variable.start, end: variable.end },
                        "write",
                    );
                }
            }
        }
    }

    private visitSet(stmt: SetNode): void {
        // Only variable assignments are symbol references
        // Examples:
        // SET @x = 1
        // SET @@ROWCOUNT = 5
        if (stmt.variable.startsWith("@")) {
            this.recordReference(
                stmt.variable,
                {
                    start: stmt.variableStart,
                    end: stmt.variableEnd,
                },
                "write",
            );
        }

        if (stmt.value) {
            this.visitExpression(stmt.value);
        }

        if (stmt.cursorQuery) {
            this.visitQuery(stmt.cursorQuery);
        }
    }

    private visitPrint(stmt: PrintNode): void {
        this.visitExpression(stmt.value);
    }

    private visitRaiseError(stmt: RaiseErrorNode): void {
        for (const arg of stmt.args) {
            this.visitExpression(arg);
        }
    }

    private visitThrow(stmt: ThrowNode): void {
        if (stmt.errorNumber) {
            this.visitExpression(stmt.errorNumber);
        }

        if (stmt.message) {
            this.visitExpression(stmt.message);
        }

        if (stmt.state) {
            this.visitExpression(stmt.state);
        }
    }

    private visitTryCatch(stmt: TryCatchNode): void {
        this.visitBlock(stmt.tryBlock);
        this.visitBlock(stmt.catchBlock);
    }

    private visitWhile(stmt: WhileNode): void {
        if (stmt.condition) {
            this.visitExpression(stmt.condition);
        }

        if (stmt.body) {
            this.visitStatement(stmt.body);
        }
    }

    private visitExecute(stmt: ExecuteNode): void {
        if (stmt.target) {
            this.visitExpression(stmt.target);
        }

        for (const arg of stmt.args) {
            if (!arg.value) {
                continue;
            }

            this.visitExpression(arg.value);

            if (arg.isOutput && arg.value.type === "Variable") {
                this.recordReference(arg.value.name, arg.value, "write");
            }
        }
    }

    private visitReturn(stmt: ReturnNode): void {
        if (stmt.query) {
            this.visitStatement(stmt.query);
        }

        if (stmt.value) {
            this.visitExpression(stmt.value);
        }
    }

    private visitWaitFor(stmt: WaitForNode): void {
        if (stmt.value) {
            this.visitExpression(stmt.value);
        }
    }

    private visitDeclareCursor(stmt: DeclareCursorNode): void {
        if (stmt.query) {
            this.visitQuery(stmt.query);
        }
    }

    private visitOpenCursor(_stmt: OpenCursorNode): void {
        // Cursor handle names are not tracked as scope symbols today.
    }

    private visitFetchCursor(stmt: FetchCursorNode): void {
        if (stmt.offset) {
            this.visitExpression(stmt.offset);
        }

        for (const name of stmt.into ?? []) {
            if (!name.startsWith("@")) {
                continue;
            }

            this.recordReference(name, stmt, "write");
        }
    }

    private visitCloseCursor(_stmt: CloseCursorNode): void {
        // Cursor handle names are not tracked as scope symbols today.
    }

    private visitDeallocateCursor(_stmt: DeallocateCursorNode): void {
        // Cursor handle names are not tracked as scope symbols today.
    }

    private visitInsert(stmt: InsertNode): void {
        this.pushScope(stmt.start, stmt.end, "insert");

        if (stmt.output) {
            this.declareOutputPseudoTables(stmt.output);
        }
        if (stmt.table) {
            if (stmt.table.type === "Identifier" && stmt.table.name.startsWith("@")) {
                this.recordReference(stmt.table.name, stmt.table, "write");
            } else {
                this.visitExpression(stmt.table);
            }
        }

        if (stmt.values) {
            for (const row of stmt.values) {
                for (const expr of row) {
                    this.visitExpression(expr);
                }
            }
        }

        if (stmt.selectQuery) {
            this.visitQuery(stmt.selectQuery);
        }

        this.visitOutputClause(stmt.output);

        this.popScope();
    }

    private visitUpdate(stmt: UpdateNode): void {
        if (stmt.top?.quantity) {
            this.visitExpression(stmt.top.quantity);
        }

        if (stmt.target) {
            this.visitExpression(stmt.target);
        }

        this.pushScope(stmt.start, stmt.end, "update");

        if (stmt.output) {
            this.declareOutputPseudoTables(stmt.output);
        }

        if (stmt.from) {
            for (const table of stmt.from) {
                this.visitTableReference(table);
            }
        }

        // Declare the target table in scope so it's visible at SET/WHERE
        // positions (e.g. `UPDATE Employee SET ... WHERE Employee.Id = 1`).
        // FROM-declared aliases take precedence; we only insert the target
        // when it hasn't already been declared via a FROM alias.
        if (stmt.target?.type === "Identifier") {
            const bindName = stmt.target.parts[stmt.target.parts.length - 1] ?? stmt.target.name;
            if (!this.current.resolveLocal(bindName)) {
                this.declare({
                    name: bindName,
                    kind: SymbolKind.Alias,
                    location: stmt.target,
                    references: [],
                    metadata: { tableName: stmt.target.name, sourceKind: "table" },
                });
            }
        }

        if (stmt.assignments) {
            for (const assignment of stmt.assignments) {
                this.visitUpdateAssignment(assignment);
            }
        }

        if (stmt.where) {
            this.visitExpression(stmt.where);
        }

        this.visitOutputClause(stmt.output);

        this.popScope();
    }

    private visitDelete(stmt: DeleteNode): void {
        if (stmt.top?.quantity) {
            this.visitExpression(stmt.top.quantity);
        }

        if (stmt.target) {
            if (stmt.target.type === "Identifier" && stmt.target.name.startsWith("@")) {
                this.recordReference(stmt.target.name, stmt.target, "write");
            } else {
                this.visitExpression(stmt.target);
            }
        }

        this.pushScope(stmt.start, stmt.end, "delete");

        if (stmt.output) {
            this.declareOutputPseudoTables(stmt.output);
        }

        if (stmt.from) {
            for (const table of stmt.from) {
                this.visitTableReference(table);
            }
        }

        if (stmt.target?.type === "Identifier") {
            const bindName = stmt.target.parts[stmt.target.parts.length - 1] ?? stmt.target.name;
            if (!this.current.resolveLocal(bindName)) {
                this.declare({
                    name: bindName,
                    kind: SymbolKind.Alias,
                    location: stmt.target,
                    references: [],
                    metadata: { tableName: stmt.target.name, sourceKind: "table" },
                });
            }
        }

        if (stmt.where) {
            this.visitExpression(stmt.where);
        }

        this.visitOutputClause(stmt.output);

        this.popScope();
    }

    private visitMerge(stmt: MergeNode): void {
        if (stmt.top?.quantity) {
            this.visitExpression(stmt.top.quantity);
        }

        this.pushScope(stmt.start, stmt.end, "merge");

        if (stmt.output) {
            this.declareOutputPseudoTables(stmt.output);
        }

        if (stmt.target && stmt.targetAlias) {
            let targetName: string | undefined;

            if (stmt.target.type === "Identifier") {
                targetName = stmt.target.name;
            }

            this.declare({
                name: stmt.targetAlias,
                kind: SymbolKind.Alias,
                location: stmt,
                references: [],
                metadata: targetName ? { tableName: targetName } : undefined,
            });
        }

        if (stmt.target) {
            this.visitExpression(stmt.target);
        }

        if (stmt.using) {
            this.visitTableReference(stmt.using);
        }

        if (stmt.on) {
            this.visitExpression(stmt.on);
        }

        for (const clause of stmt.whenClauses) {
            if (clause.predicate) {
                this.visitExpression(clause.predicate);
            }

            switch (clause.action.type) {
                case "MergeUpdateAction":
                    for (const assignment of clause.action.assignments ?? []) {
                        if (assignment.columnNode) {
                            this.visitExpression(assignment.columnNode);
                        }

                        this.visitExpression(assignment.value);
                    }
                    break;

                case "MergeInsertAction":
                    if (clause.action.values) {
                        for (const value of clause.action.values) {
                            this.visitExpression(value);
                        }
                    }

                    if (clause.action.selectQuery) {
                        this.visitQuery(clause.action.selectQuery);
                    }
                    break;

                case "MergeDeleteAction":
                    break;
            }
        }

        this.visitOutputClause(stmt.output);

        this.popScope();
    }

    private visitCreate(stmt: CreateNode): void {
        // An unmodeled CREATE target has no parsed name, so declaring it would put an empty
        // symbol in scope and report it as a duplicate against the next one.
        if (stmt.unsupportedObjectType || !stmt.name) {
            return;
        }
        switch (stmt.objectType) {
            case "TABLE": {
                const localColumns = stmt.columns?.map((c) =>
                    this.makeSymbolColumn(c.name, c.dataType, c),
                );
                this.declare({
                    name: stmt.name,
                    kind: SymbolKind.Table,
                    columns: stmt.columns?.map((c) => c.name),
                    ...(localColumns?.length ? { localColumns } : {}),
                    location: stmt,
                    references: [],
                });
                return;
            }

            case "VIEW": {
                const localColumns = stmt.columns?.map((c) =>
                    this.makeSymbolColumn(c.name, c.dataType, c),
                );
                this.declare({
                    name: stmt.name,
                    kind: SymbolKind.Table,
                    columns: stmt.columns?.map((c) => c.name),
                    ...(localColumns?.length ? { localColumns } : {}),
                    location: stmt,
                    references: [],
                });

                this.pushScope(stmt.start, stmt.end, stmt.name);

                if (Array.isArray(stmt.body)) {
                    for (const child of stmt.body) {
                        this.visitStatement(child);
                    }
                } else if (stmt.body) {
                    this.visitStatement(stmt.body);
                }

                this.popScope();
                return;
            }

            case "TYPE": {
                const localColumns = stmt.columns?.map((c) =>
                    this.makeSymbolColumn(c.name, c.dataType, c),
                );
                this.declare({
                    name: stmt.name,
                    kind: SymbolKind.Type,
                    columns: stmt.columns?.map((c) => c.name),
                    ...(localColumns?.length ? { localColumns } : {}),
                    location: stmt,
                    references: [],
                });
                return;
            }

            case "PROCEDURE":
            case "FUNCTION":
                this.declare({
                    name: stmt.name,
                    kind:
                        stmt.objectType === "PROCEDURE"
                            ? SymbolKind.Procedure
                            : SymbolKind.Function,
                    location: stmt,
                    references: [],
                });

                this.pushScope(stmt.start, stmt.end, stmt.name);

                for (const param of stmt.parameters ?? []) {
                    // Table-valued parameters declared against a same-file
                    // CREATE TYPE ... AS TABLE (e.g. `@Emp dbo.EmpTableType
                    // READONLY`) can cross-reference that type's own
                    // localColumns — no external schema needed, the type
                    // definition is already in scope.
                    const typeSymbol = param.dataType
                        ? this.findTypeSymbol(param.dataType)
                        : undefined;
                    const localColumns =
                        typeSymbol?.kind === SymbolKind.Type && typeSymbol.localColumns?.length
                            ? typeSymbol.localColumns.map((col) => ({ ...col }))
                            : undefined;

                    this.declare({
                        name: param.name,
                        kind: SymbolKind.Parameter,
                        dataType: param.dataType,
                        ...(localColumns?.length
                            ? { columns: localColumns.map((c) => c.rawName), localColumns }
                            : {}),
                        location: param,
                        references: [],
                        metadata: {
                            isOutput: !!param.isOutput,
                            isReadOnly: !!param.isReadOnly,
                        },
                    });
                }

                if (stmt.returnVariable) {
                    const localColumns = stmt.returnColumns?.map((c) =>
                        this.makeSymbolColumn(c.name, c.dataType, c),
                    );
                    this.declare({
                        name: stmt.returnVariable,
                        kind: SymbolKind.Table,
                        columns: stmt.returnColumns?.map((c) => c.name),
                        ...(localColumns?.length ? { localColumns } : {}),
                        location: stmt,
                        references: [],
                    });
                }

                if (Array.isArray(stmt.body)) {
                    for (const child of stmt.body) {
                        this.visitStatement(child);
                    }
                } else if (stmt.body) {
                    this.visitStatement(stmt.body);
                }

                this.popScope();
                return;

            default:
                return;
        }
    }

    // ── Control flow ──────────────────────────────────────────────────────────

    private visitWith(stmt: WithNode): void {
        this.pushScope(stmt.start, stmt.end, "with");

        for (const cte of stmt.ctes) {
            // Visit body before declaring so that:
            // (a) the CTE cannot see itself in its own anchor branch (issue 8),
            // (b) earlier CTEs in the chain are already declared and visible here.
            this.visitQuery(cte.query);

            const columns = this.getQueryOutputColumns(cte.query);
            const localColumns = columns?.map((name) =>
                this.makeSymbolColumn(name, undefined, cte),
            );

            this.declare({
                name: cte.name,
                kind: SymbolKind.CTE,
                location: cte,
                references: [],
                ...(columns?.length ? { columns } : {}),
                ...(localColumns?.length ? { localColumns } : {}),
            });
        }

        this.visitStatement(stmt.body);

        this.popScope();
    }

    private visitBlock(stmt: BlockNode): void {
        for (const child of stmt.body) {
            this.visitStatement(child);
        }
    }

    private visitIf(stmt: IfNode): void {
        this.visitExpression(stmt.condition);
        this.visitBranch(stmt.thenBranch);

        if (stmt.elseBranch) {
            this.visitBranch(stmt.elseBranch);
        }
    }

    private visitBranch(branch: Statement | Statement[]): void {
        if (Array.isArray(branch)) {
            for (const stmt of branch) {
                this.visitStatement(stmt);
            }
            return;
        }

        this.visitStatement(branch);
    }

    // ── Query ────────────────────────────────────────────────────────────────

    private visitQuery(query: QueryStatement | null): void {
        if (!query) {
            return;
        }

        if (query.type === "SetOperator") {
            this.visitQuery(query.left);

            if (query.right) {
                this.visitQuery(query.right);
            }

            return;
        }

        this.visitSelect(query);
    }

    private visitSelect(stmt: SelectNode): void {
        this.pushScope(stmt.start, stmt.end, "select");

        if (stmt.top?.quantity) {
            this.visitExpression(stmt.top.quantity);
        }

        if (stmt.from) {
            for (const table of stmt.from) {
                this.visitTableReference(table);
            }
        }

        for (const col of stmt.columns) {
            this.visitSelectColumnExpression(col.expression);
        }

        if (stmt.where) {
            this.visitExpression(stmt.where);
        }

        if (stmt.groupBy) {
            for (const expr of stmt.groupBy) {
                this.visitExpression(expr);
            }
        }

        if (stmt.having) {
            this.visitExpression(stmt.having);
        }

        // SELECT output aliases are visible to ORDER BY, but they should not
        // collide with table aliases declared earlier in the same SELECT.
        this.pushScope(stmt.start, stmt.end, "select-output");
        for (const col of stmt.columns) {
            if (col.alias) {
                this.declare({
                    name: col.alias,
                    kind: SymbolKind.Alias,
                    location: col,
                    references: [],
                });
            }
        }

        if (stmt.orderBy) {
            for (const order of stmt.orderBy) {
                this.visitExpression(order.expression);
            }
        }

        if (stmt.offset) {
            this.visitExpression(stmt.offset);
        }

        if (stmt.fetch) {
            this.visitExpression(stmt.fetch);
        }

        this.popScope();
        this.popScope();
    }

    private visitSelectColumnExpression(expr: Expression | null | undefined): void {
        if (
            expr?.type === "BinaryExpression" &&
            expr.operator === "=" &&
            expr.left.type === "Variable"
        ) {
            this.recordReference(expr.left.name, expr.left, "write");
            this.visitExpression(expr.right);
            return;
        }

        this.visitExpression(expr);
    }

    private visitUpdateAssignment(assignment: UpdateAssignment): void {
        if (assignment.targetKind === "variable" && assignment.column.startsWith("@")) {
            this.recordReference(assignment.column, assignment.columnNode ?? assignment, "write");
        } else if (assignment.columnNode) {
            this.visitExpression(assignment.columnNode);
        }

        if (assignment.value) {
            this.visitExpression(assignment.value);
        }
    }

    private visitTableReference(ref: TableReference): void {
        const table = ref.table;

        if (table?.type === "Identifier") {
            const name = table.name;
            if (name.startsWith("@") || name.startsWith("#")) {
                const sym = this.current.resolve(name);
                if (!sym || !sym.columns || sym.columns.length === 0) {
                    this.current.hasUnverifiableSources = true;
                }
            }
        } else if (table?.type === "FunctionCall") {
            this.current.hasUnverifiableSources = true;
        }

        if (ref.alias) {
            let columns = this.getTableReferenceAliasColumns(ref);
            const localColumns = this.getTableReferenceAliasLocalColumns(ref);
            if (!columns?.length && localColumns?.length) {
                columns = localColumns.map((c) => c.rawName);
            }

            this.declare({
                name: ref.alias,
                kind: SymbolKind.Alias,
                location: ref,
                references: [],
                ...(columns?.length ? { columns } : {}),
                ...(localColumns?.length ? { localColumns } : {}),
                metadata:
                    table?.type === "Identifier"
                        ? { tableName: table.name, sourceKind: "table" }
                        : {
                              sourceKind:
                                  table?.type === "SubqueryExpression"
                                      ? "derived_subquery"
                                      : table?.type === "FunctionCall"
                                        ? "function"
                                        : table?.type === "ValuesTableExpression"
                                          ? "derived_values"
                                          : "derived",
                          },
            });
        }

        if (table) {
            if (table.type === "TableReference") {
                this.visitTableReference(table);
            } else if (table.type === "SubqueryExpression") {
                this.visitSubquery(table);
            } else {
                this.visitExpression(table);
            }
        }

        this.visitTemporalTableClause(ref.forSystemTime);

        for (const join of ref.joins) {
            this.visitJoin(join);
        }
    }

    private visitJoin(join: JoinNode): void {
        if (join.alias) {
            const isApply = join.type === "CROSS APPLY" || join.type === "OUTER APPLY";
            let columns = join.aliasColumns;
            const localColumns = this.getJoinAliasLocalColumns(join);
            if (!columns?.length && localColumns?.length) {
                columns = localColumns.map((c) => c.rawName);
            }

            this.declare({
                name: join.alias,
                kind: SymbolKind.Alias,
                location: join,
                references: [],
                ...(columns?.length ? { columns } : {}),
                ...(localColumns?.length ? { localColumns } : {}),
                metadata:
                    join.table?.type === "Identifier"
                        ? { tableName: join.table.name, sourceKind: "table", joinType: join.type }
                        : {
                              sourceKind: isApply ? "derived_apply" : "derived",
                              joinType: join.type,
                          },
            });
        }

        const table = join.table;

        if (table) {
            if (table.type === "TableReference") {
                this.visitTableReference(table);
            } else if (table.type === "SubqueryExpression") {
                this.visitSubquery(table);
            } else {
                this.visitExpression(table);
            }
        }

        if (join.on) {
            this.visitExpression(join.on);
        }

        this.visitTemporalTableClause(join.forSystemTime);
    }

    private visitTemporalTableClause(
        clause: TableReference["forSystemTime"] | JoinNode["forSystemTime"],
    ): void {
        if (!clause || clause.kind === "ALL") {
            return;
        }

        if (clause.kind === "AS_OF") {
            this.visitExpression(clause.asOf);
            return;
        }

        this.visitExpression(clause.from);
        this.visitExpression(clause.to);
    }

    private visitSubquery(expr: SubqueryExpression): void {
        this.pushScope(expr.start, expr.end, "subquery");
        this.visitQuery(expr.query);
        this.popScope();
    }

    // ── Expression ───────────────────────────────────────────────────────────

    private visitExpression(expr: Expression | null | undefined): void {
        if (!expr) return;

        switch (expr.type) {
            case "Variable":
                this.recordReference(expr.name, expr);
                break;

            case "Identifier":
                this.recordIdentifierReference(expr);
                break;

            case "Literal":
                break;

            case "MemberExpression":
                this.visitExpression(expr.object);
                break;

            case "BinaryExpression":
                this.visitExpression(expr.left);
                this.visitExpression(expr.right);
                break;

            case "UnaryExpression":
                this.visitExpression(expr.right);
                break;

            case "GroupingExpression":
                this.visitExpression(expr.expression);
                break;

            case "FunctionCall":
                this.visitExpression(expr.receiver);
                this.recordFunctionCallVariableReference(expr);

                for (const arg of expr.args) {
                    this.visitExpression(arg);
                }

                if (expr.withinGroup) {
                    for (const order of expr.withinGroup) {
                        this.visitExpression(order.expression);
                    }
                }
                break;

            case "OverExpression":
                this.visitExpression(expr.expression);

                if (expr.window.partitionBy) {
                    for (const e of expr.window.partitionBy) {
                        this.visitExpression(e);
                    }
                }

                if (expr.window.orderBy) {
                    for (const o of expr.window.orderBy) {
                        this.visitExpression(o.expression);
                    }
                }
                break;

            case "CastExpression":
                this.visitExpression(expr.expression);

                if (expr.style) {
                    this.visitExpression(expr.style);
                }
                break;

            case "CaseExpression":
                if (expr.input) {
                    this.visitExpression(expr.input);
                }

                for (const branch of expr.branches) {
                    this.visitExpression(branch.when);
                    this.visitExpression(branch.then);
                }

                if (expr.elseBranch) {
                    this.visitExpression(expr.elseBranch);
                }
                break;

            case "InExpression":
                this.visitExpression(expr.left);

                if (expr.list) {
                    for (const item of expr.list) {
                        this.visitExpression(item);
                    }
                }

                if (expr.subquery) {
                    this.visitSubquery({
                        type: "SubqueryExpression",
                        query: expr.subquery,
                        start: expr.start,
                        end: expr.end,
                    });
                }
                break;

            case "BetweenExpression":
                this.visitExpression(expr.left);
                this.visitExpression(expr.lowerBound);
                this.visitExpression(expr.upperBound);
                break;

            case "SubqueryExpression":
                this.visitSubquery(expr);
                break;

            case "ExistsExpression":
                this.visitSubquery({
                    type: "SubqueryExpression",
                    query: expr.query,
                    start: expr.start,
                    end: expr.end,
                });
                break;

            case "ValuesTableExpression":
                for (const row of expr.rows) {
                    for (const value of row) {
                        this.visitExpression(value);
                    }
                }
                break;

            default:
                break;
        }
    }

    private declareOutputPseudoTables(location: NodeLocation): void {
        this.declare({
            name: "INSERTED",
            kind: SymbolKind.Table,
            location,
            references: [],
        });

        this.declare({
            name: "DELETED",
            kind: SymbolKind.Table,
            location,
            references: [],
        });
    }

    private visitOutputClause(output?: OutputClauseNode): void {
        if (!output) {
            return;
        }

        for (const col of output.columns) {
            if (col.sourceTable) {
                this.recordReference(col.sourceTable, col);
            }

            this.visitExpression(col.column.expression);
        }

        if (output.intoTable) {
            if (output.intoTable.type === "Identifier" && output.intoTable.name.startsWith("@")) {
                this.recordReference(output.intoTable.name, output.intoTable, "write");
            } else {
                this.visitExpression(output.intoTable);
            }
        }
    }

    private recordIdentifierReference(expr: IdentifierNode): void {
        const parts = expr.parts;

        // -----------------------------------------
        // CASE 1: Qualified identifier (u.Id)
        // -----------------------------------------
        if (parts.length >= 2) {
            const qualifier = parts[0];

            if (this.current.resolve(qualifier)) {
                //  only record qualifier (alias/table symbol)
                this.recordReference(qualifier, expr);
            }

            return;
        }

        // -----------------------------------------
        // CASE 2: Single identifier
        // -----------------------------------------
        const name = expr.name;

        // ONLY resolve declared symbols (variables, alias, params, etc.)
        if (this.current.resolve(name)) {
            this.recordReference(name, expr);
        }

        //  DO NOT attempt column resolution here
        //  DO NOT push undeclared for identifiers
    }

    private recordFunctionCallVariableReference(expr: {
        name: string;
        start: number;
        end: number;
    }): void {
        const match = expr.name.match(/^(@@?[^.\s]+)\./);

        if (!match) {
            return;
        }

        const variableName = match[1];

        if (!variableName.startsWith("@") || variableName.startsWith("@@")) {
            return;
        }

        this.recordReference(variableName, {
            start: expr.start,
            end: expr.start + variableName.length,
        });
    }

    private getTableReferenceAliasColumns(ref: TableReference): string[] | undefined {
        if (ref.aliasColumns?.length) {
            return ref.aliasColumns;
        }

        if (ref.pivot) {
            return this.getPivotOutputColumns(ref);
        }

        if (ref.unpivot) {
            return this.getUnpivotOutputColumns(ref);
        }

        return undefined;
    }

    private getPivotOutputColumns(ref: TableReference): string[] | undefined {
        const pivot = ref.pivot;
        if (!pivot) {
            return undefined;
        }

        const sourceColumns = this.getExpressionOutputColumns(ref.table) ?? [];
        const forColumnName = pivot.forColumn?.name;
        const aggregateInputColumns = this.getExpressionIdentifierNames(pivot.aggregate);
        const pivotColumns = pivot.inColumns.map((col) => col.name);

        const preserved = sourceColumns.filter(
            (name) =>
                !this.isSameColumnName(name, forColumnName) &&
                !aggregateInputColumns.some((input) => this.isSameColumnName(name, input)),
        );

        const combined = [...preserved, ...pivotColumns];

        return combined.length ? this.uniqueColumnNames(combined) : undefined;
    }

    private getUnpivotOutputColumns(ref: TableReference): string[] | undefined {
        const unpivot = ref.unpivot;
        if (!unpivot) {
            return undefined;
        }

        const sourceColumns = this.getExpressionOutputColumns(ref.table) ?? [];
        const inputColumns = unpivot.inColumns.map((col) => col.name);
        const preserved = sourceColumns.filter(
            (name) => !inputColumns.some((input) => this.isSameColumnName(name, input)),
        );

        const combined = [
            ...preserved,
            ...(unpivot.valueColumn ? [unpivot.valueColumn.name] : []),
            ...(unpivot.forColumn ? [unpivot.forColumn.name] : []),
        ];

        return combined.length ? this.uniqueColumnNames(combined) : undefined;
    }

    private getExpressionOutputColumns(
        expr: Expression | TableReference | null | undefined,
    ): string[] | undefined {
        if (!expr) {
            return undefined;
        }

        if (expr.type === "TableReference") {
            return this.getTableReferenceAliasColumns(expr);
        }

        if (expr.type === "Identifier") {
            const sym = this.current.resolve(expr.name);
            if (!sym) {
                return undefined;
            }

            if (sym.localColumns?.length) {
                return sym.localColumns.map((c) => c.rawName);
            }

            return sym.columns;
        }

        if (expr.type === "SubqueryExpression") {
            return this.getQueryOutputColumns(expr.query);
        }

        return undefined;
    }

    private getQueryOutputColumns(query: QueryStatement | null | undefined): string[] | undefined {
        if (!query) {
            return undefined;
        }

        if (query.type === "SetOperator") {
            return this.getQueryOutputColumns(query.left);
        }

        const columns = query.columns
            .map((col) => col.alias || col.outputName || col.sourceName)
            .filter((name): name is string => Boolean(name));

        return columns.length ? columns : undefined;
    }

    private getExpressionIdentifierNames(expr: Expression | null | undefined): string[] {
        if (!expr) {
            return [];
        }

        switch (expr.type) {
            case "Identifier":
                return [expr.name];

            case "FunctionCall":
                return [
                    ...(expr.receiver ? this.getExpressionIdentifierNames(expr.receiver) : []),
                    ...expr.args.flatMap((arg) => this.getExpressionIdentifierNames(arg)),
                ];

            case "BinaryExpression":
                return [
                    ...this.getExpressionIdentifierNames(expr.left),
                    ...this.getExpressionIdentifierNames(expr.right),
                ];

            case "UnaryExpression":
                return this.getExpressionIdentifierNames(expr.right);

            case "GroupingExpression":
                return this.getExpressionIdentifierNames(expr.expression);

            case "MemberExpression":
                return this.getExpressionIdentifierNames(expr.object);

            case "CastExpression":
                return this.getExpressionIdentifierNames(expr.expression);

            case "ValuesTableExpression":
                return expr.rows.flatMap((row) =>
                    row.flatMap((value) => this.getExpressionIdentifierNames(value)),
                );

            default:
                return [];
        }
    }

    private isSameColumnName(left: string | undefined, right: string | undefined): boolean {
        if (!left || !right) {
            return false;
        }

        return this.normalizeColumnName(left) === this.normalizeColumnName(right);
    }

    private normalizeColumnName(name: string): string {
        return name
            .trim()
            .replace(/^\[(.*)\]$/, "$1")
            .toLowerCase();
    }

    private uniqueColumnNames(columns: string[]): string[] {
        const seen = new Set<string>();
        const unique: string[] = [];

        for (const column of columns) {
            const key = this.normalizeColumnName(column);

            if (seen.has(key)) {
                continue;
            }

            seen.add(key);
            unique.push(column);
        }

        return unique;
    }

    private makeSymbolColumn(
        rawName: string,
        dataType?: string,
        location?: NodeLocation,
    ): SymbolColumn {
        const typeMembers = getTypeMembers(dataType);
        return {
            rawName,
            normalizedName: this.normalizeColumnName(rawName),
            ...(dataType ? { dataType } : {}),
            ...(typeMembers?.length ? { typeMembers } : {}),
            ...(location ? { location } : {}),
        };
    }

    private getTableReferenceAliasLocalColumns(ref: TableReference): SymbolColumn[] | undefined {
        if (ref.aliasColumns?.length) {
            return ref.aliasColumns.map((name) => this.makeSymbolColumn(name, undefined, ref));
        }

        if (ref.table?.type === "Identifier") {
            const source = this.current.resolve(ref.table.name);
            if (source?.localColumns?.length) {
                return source.localColumns.map((col) => ({
                    ...col,
                }));
            }
        }

        const derived = this.getTableReferenceAliasColumns(ref);
        if (derived?.length) {
            return derived.map((name) => this.makeSymbolColumn(name, undefined, ref));
        }

        return undefined;
    }

    private getJoinAliasLocalColumns(join: JoinNode): SymbolColumn[] | undefined {
        if (join.aliasColumns?.length) {
            return join.aliasColumns.map((name) => this.makeSymbolColumn(name, undefined, join));
        }

        if (join.table?.type === "Identifier") {
            const source = this.current.resolve(join.table.name);
            if (source?.localColumns?.length) {
                return source.localColumns.map((col) => ({
                    ...col,
                }));
            }
        }

        return undefined;
    }
}
