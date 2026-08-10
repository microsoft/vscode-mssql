/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import {
    type Program,
    type Statement,
    type QueryStatement,
    type SelectNode,
    type MergeNode,
    type MergeAction,
    type Expression,
    type IdentifierNode,
    type WildcardExpression,
    type WithNode,
    type CreateNode,
    type IfNode,
    type BlockNode,
    type TryCatchNode,
    type NodeLocation,
    type InsertNode,
    type UpdateNode,
    type DeleteNode,
    type OutputClauseNode,
    type TableReference,
    type JoinNode,
    type FrameBoundary,
} from "../ast/types.js";

import {
    type LineageNode,
    type DerivedColumn,
    type VirtualSource,
    type LineageEdge,
    type LineageResult,
    type LineageSourceKind,
    type SourceExposure,
    type AmbiguityDiagnostic,
    type MutationTarget,
    type ReadScopeExposure,
    type ReadScopeSource,
} from "./lineage.js";

type SourceMap = Map<string, VirtualSource>;

export class LineageBuilder {
    private columns: DerivedColumn[] = [];
    private sources: SourceMap[] = [];
    private sourceExposure = new Map<string, SourceExposure>();
    private ambiguities: AmbiguityDiagnostic[] = [];
    private mutations: MutationTarget[] = [];
    private readScopes: ReadScopeExposure[] = [];

    build(program: Program): LineageResult {
        this.columns = [];
        this.sources = [new Map()];
        this.sourceExposure = new Map();
        this.ambiguities = [];
        this.mutations = [];
        this.readScopes = [];

        for (const stmt of program.body) {
            this.visitStatement(stmt);
        }

        return {
            columns: this.columns,
            edges: this.buildEdges(this.columns),
            sources: [...this.sourceExposure.values()],
            ambiguities: this.ambiguities,
            mutations: this.mutations,
            readScopes: this.readScopes,
        };
    }

    // ============================================================
    // source scopes
    // ============================================================

    private pushSources(): void {
        this.sources.push(new Map());
    }

    private popSources(): void {
        this.sources.pop();
    }

    private currentSources(): SourceMap {
        return this.sources[this.sources.length - 1];
    }

    private defineSource(name: string, source: VirtualSource): void {
        this.currentSources().set(name.toLowerCase(), source);

        const key = `${source.name.toLowerCase()}::${(source.alias ?? "").toLowerCase()}::${source.kind}`;
        if (!this.sourceExposure.has(key)) {
            this.sourceExposure.set(key, {
                name: source.name,
                alias: source.alias,
                kind: source.kind,
                baseName: source.baseName,
                location: source.definedAt,
                projection: [...source.columns.values()].map((col) => ({
                    name: col.name,
                    normalizedName: col.name.toLowerCase(),
                    location: col.location,
                })),
            });
        }
    }

    private resolveSource(name: string): VirtualSource | undefined {
        const key = name.toLowerCase();

        for (let i = this.sources.length - 1; i >= 0; i--) {
            const found = this.sources[i].get(key);
            if (found) return found;
        }

        return undefined;
    }

    // ============================================================
    // traversal
    // ============================================================

    private visitStatement(stmt: Statement): void {
        switch (stmt.type) {
            case "BatchSeparatorStatement":
                break;

            case "SelectStatement":
                this.visitSelect(stmt, true);
                break;

            case "SetOperator":
                this.visitQuery(stmt, true);
                break;

            case "WithStatement":
                this.visitWith(stmt);
                break;

            case "CreateStatement":
                this.visitCreate(stmt);
                break;

            case "IfStatement":
                this.visitIf(stmt);
                break;

            case "BlockStatement":
                this.visitBlock(stmt);
                break;

            case "TryCatchStatement":
                this.visitTryCatch(stmt);
                break;

            case "InsertStatement":
                this.visitInsert(stmt);
                break;

            case "UpdateStatement":
                this.visitUpdate(stmt);
                break;

            case "DeleteStatement":
                this.visitDelete(stmt);
                break;

            case "MergeStatement":
                this.visitMerge(stmt);
                break;
        }
    }

    private visitCreate(stmt: CreateNode): void {
        if (
            stmt.objectType === "TABLE" &&
            stmt.nameNode?.name &&
            stmt.nameNode.name.startsWith("#") &&
            stmt.columns &&
            stmt.columns.length > 0
        ) {
            const name = stmt.nameNode.name;
            const source: VirtualSource = {
                name,
                kind: "table",
                definedAt: stmt.nameNode,
                columns: new Map(
                    stmt.columns.map((col) => [
                        col.name.toLowerCase(),
                        {
                            name: col.name,
                            inputs: [
                                {
                                    kind: "column",
                                    name: `${name}.${col.name}`,
                                    source: name,
                                    sourceKind: "table",
                                    resolution: "resolved",
                                    location: col,
                                },
                            ],
                            location: stmt,
                        } as DerivedColumn,
                    ]),
                ),
                wildcardSources: [
                    {
                        kind: "column",
                        name: `${name}.*`,
                        source: name,
                        sourceKind: "table",
                        resolution: "resolved",
                        wildcard: true,
                        location: stmt.nameNode,
                    },
                ],
            };

            this.defineSource(name, source);
        }

        if (!stmt.body) {
            return;
        }

        if (Array.isArray(stmt.body)) {
            for (const child of stmt.body) {
                this.visitStatement(child);
            }
            return;
        }

        this.visitStatement(stmt.body);
    }

    private visitIf(stmt: IfNode): void {
        this.visitBranch(stmt.thenBranch);

        if (stmt.elseBranch) {
            this.visitBranch(stmt.elseBranch);
        }
    }

    private visitBlock(stmt: BlockNode): void {
        for (const child of stmt.body) {
            this.visitStatement(child);
        }
    }

    private visitTryCatch(stmt: TryCatchNode): void {
        this.visitStatement(stmt.tryBlock);
        this.visitStatement(stmt.catchBlock);
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

    private defineOutputPseudoSources(): void {
        for (const name of ["INSERTED", "DELETED"]) {
            this.defineSource(name, {
                name,
                kind: "pseudo_output",
                columns: new Map(),
                wildcardSources: [
                    {
                        kind: "column",
                        name: `${name}.*`,
                        source: name,
                        sourceKind: "pseudo_output",
                        resolution: "resolved",
                        wildcard: true,
                    },
                ],
            });
        }
    }

    private visitOutputClause(output: OutputClauseNode | undefined): void {
        if (!output) {
            return;
        }

        for (let i = 0; i < output.columns.length; i++) {
            const out = output.columns[i];

            let inputs: LineageNode[];

            // ------------------------------------------------------------
            // 1. Special-case wildcard: inserted.* / deleted.*
            // ------------------------------------------------------------
            if (out.sourceTable && out.column.wildcard) {
                inputs = [
                    {
                        kind: "column",
                        name: `${out.sourceTable}.*`,
                        source: out.sourceTable,
                        wildcard: true,
                        location: out.column,
                    },
                ];
            } else {
                // ------------------------------------------------------------
                // 2. Resolve expression normally
                // ------------------------------------------------------------
                inputs = this.resolveExpression(out.column.expression);

                // ------------------------------------------------------------
                // 3. Restore INSERTED / DELETED prefix
                // ------------------------------------------------------------
                if (out.sourceTable) {
                    const source = out.sourceTable; // narrowed to non-null

                    inputs = inputs.map((node) => {
                        const loc = node.location as IdentifierNode | undefined;
                        if (
                            node.kind === "column" &&
                            loc?.type === "Identifier" &&
                            loc.parts.length === 1
                        ) {
                            const localName = loc.parts[0] ?? node.name;
                            return {
                                ...node,
                                name: `${source}.${localName}`,
                                source,
                                sourceKind: "pseudo_output",
                                resolution: "resolved",
                            } as LineageNode;
                        }

                        return node;
                    });
                }
            }

            // ------------------------------------------------------------
            // 4. Target name
            // ------------------------------------------------------------
            let target = out.column.outputName;

            if (
                output.intoTable &&
                output.intoTable.type === "Identifier" &&
                output.intoColumns &&
                output.intoColumns[i]
            ) {
                target = `${output.intoTable.name}.${output.intoColumns[i]}`;
            }

            // ------------------------------------------------------------
            // 5. Emit lineage
            // ------------------------------------------------------------
            this.columns.push({
                name: target,
                expression: out.column.expression,
                inputs,
                location: out,
            });
        }
    }

    private visitDelete(stmt: DeleteNode): void {
        this.pushSources();

        this.defineOutputPseudoSources();

        if (stmt.from) {
            for (const ref of stmt.from) {
                this.registerTableReference(ref);
            }
        }

        this.recordReadScope("DELETE", stmt, stmt.from ?? []);

        // Mirrors visitUpdate: a simple `DELETE FROM dbo.T WHERE ...` (no
        // separate aliased FROM-list) never reaches registerTableReference
        // above, so without this the target table is never a resolvable
        // source and WHERE-clause columns can't resolve against it at all.
        this.registerSource(stmt.target, undefined, undefined, "table");

        const predicateInputs = this.resolveExpression(stmt.where);

        if (stmt.target && stmt.target.type === "Identifier") {
            this.recordMutationTarget("DELETE", stmt, stmt.target.name, predicateInputs);
        }

        this.visitOutputClause(stmt.output);

        this.popSources();
    }

    private visitMerge(stmt: MergeNode): void {
        this.pushSources();

        if (stmt.output) {
            this.defineOutputPseudoSources();
        }

        if (stmt.target) {
            this.registerSource(stmt.target, stmt.targetAlias);
        }

        if (stmt.using) {
            this.registerTableReference(stmt.using);
        }

        if (stmt.on) {
            this.resolveExpression(stmt.on);
        }

        for (const clause of stmt.whenClauses) {
            if (clause.predicate) {
                this.resolveExpression(clause.predicate);
            }

            this.visitMergeAction(clause.action, stmt);
        }

        this.visitOutputClause(stmt.output);

        this.popSources();
    }

    private visitMergeAction(action: MergeAction, stmt: MergeNode): void {
        if (action.type === "MergeUpdateAction") {
            const targetName = this.resolveMergeTargetName(stmt);

            for (const assignment of action.assignments ?? []) {
                this.columns.push({
                    name:
                        assignment.columnNode && assignment.columnNode.parts.length > 1
                            ? assignment.columnNode.name
                            : `${targetName}.${assignment.column}`,
                    expression: assignment.value ?? undefined,
                    inputs: assignment.value ? this.resolveExpression(assignment.value) : [],
                    location: stmt,
                });
            }

            return;
        }

        if (action.type === "MergeInsertAction") {
            const targetName = this.resolveMergeTargetName(stmt);

            if (action.values && action.columns) {
                for (let i = 0; i < action.columns.length; i++) {
                    const target = `${targetName}.${action.columns[i]}`;
                    const value = action.values[i];
                    this.columns.push({
                        name: target,
                        expression: value ?? undefined,
                        inputs: value ? this.resolveExpression(value) : [],
                        location: stmt,
                    });
                }
            }

            if (action.columns && action.selectQuery) {
                const sourceCols = this.visitQuery(action.selectQuery, false);

                for (let i = 0; i < action.columns.length; i++) {
                    const target = `${targetName}.${action.columns[i]}`;
                    const sourceCol = sourceCols[i];

                    if (!sourceCol) {
                        continue;
                    }

                    this.columns.push({
                        name: target,
                        inputs: sourceCol.inputs,
                        location: stmt,
                    });
                }
            }

            return;
        }
    }

    private resolveMergeTargetName(stmt: MergeNode): string {
        if (!stmt.target || stmt.target.type !== "Identifier") {
            return "";
        }

        return stmt.targetAlias ?? stmt.target.name;
    }

    private visitQuery(query: QueryStatement | null, emit = false): DerivedColumn[] {
        if (!query) {
            return [];
        }

        if (query.type === "SetOperator") {
            return this.visitQuery(query.left, emit);
        }

        return this.visitSelect(query, emit);
    }

    private visitWith(stmt: WithNode): void {
        this.pushSources();

        for (const cte of stmt.ctes) {
            const cols = this.visitQuery(cte.query, true);

            this.defineSource(cte.name, {
                name: cte.name,
                kind: "cte",
                alias: cte.name,
                definedAt: cte,
                columns: new Map(cols.map((c) => [c.name.toLowerCase(), c])),
                wildcardSources: this.collectWildcardSources(cols),
            });
        }

        this.visitStatement(stmt.body);

        this.popSources();
    }

    // ============================================================
    // SELECT
    // ============================================================

    private visitSelect(stmt: SelectNode, emit = false): DerivedColumn[] {
        this.pushSources();

        if (stmt.from) {
            for (const ref of stmt.from) {
                this.registerTableReference(ref);
            }
        }

        if (emit) {
            this.recordReadScope("SELECT", stmt, stmt.from ?? []);
        }

        const derived: DerivedColumn[] = [];

        for (const col of stmt.columns) {
            if (
                col.expression.type === "BinaryExpression" &&
                col.expression.operator === "=" &&
                col.expression.left.type === "Variable"
            ) {
                const dc: DerivedColumn = {
                    name: col.expression.left.name,
                    expression: col.expression.right ?? undefined,
                    inputs: this.resolveExpression(col.expression.right),
                    location: col,
                };

                derived.push(dc);

                if (emit) {
                    this.columns.push(dc);
                }

                continue;
            }

            const dc: DerivedColumn = {
                name: col.outputName,
                expression: col.expression,
                inputs: this.resolveExpression(col.expression),
                location: col,
            };

            derived.push(dc);

            if (emit) {
                this.columns.push(dc);
            }
        }

        this.popSources();

        return derived;
    }

    private registerTableReference(ref: TableReference): void {
        const forcedKind: LineageSourceKind | undefined = ref.pivot
            ? "pivot"
            : ref.unpivot
              ? "unpivot"
              : undefined;
        const projectionColumns = ref.aliasColumns?.length
            ? ref.aliasColumns
            : this.getTableReferenceProjectionColumns(ref);
        this.registerSource(ref.table, ref.alias, projectionColumns, forcedKind, ref);

        for (const join of ref.joins) {
            this.registerJoin(join);
        }
    }

    private registerJoin(join: JoinNode): void {
        this.registerSource(
            join.table,
            join.alias,
            join.aliasColumns,
            join.type === "CROSS APPLY" || join.type === "OUTER APPLY"
                ? "derived_apply"
                : undefined,
            join,
        );
    }

    private registerSource(
        expr: Expression | TableReference | null,
        alias?: string,
        aliasColumns?: string[],
        forcedKind?: LineageSourceKind,
        location?: { start: number; end: number },
    ): void {
        if (!expr) {
            return;
        }

        if (expr.type === "TableReference") {
            this.registerTableReference(expr);
            return;
        }

        // ------------------------------------------------------------
        // subquery source
        // ------------------------------------------------------------
        if (expr.type === "SubqueryExpression") {
            const bindName = alias ?? "__subquery";
            const kind = forcedKind ?? "derived_subquery";

            const cols = this.applyAliasColumns(this.visitQuery(expr.query, true), aliasColumns);

            this.defineSource(bindName, {
                name: bindName,
                alias,
                kind,
                definedAt: location ?? expr,
                columns: new Map(cols.map((c) => [c.name.toLowerCase(), c])),
                wildcardSources: this.collectWildcardSources(cols),
            });

            return;
        }

        // ------------------------------------------------------------
        // physical table / CTE
        // ------------------------------------------------------------
        if (expr.type === "Identifier") {
            const objectName = expr.parts.length > 0 ? expr.parts.join(".") : expr.name;

            const bindName = alias ?? objectName;

            // existing virtual source (CTE etc.)
            const existing = this.resolveSource(objectName);

            if (existing) {
                // preserve original underlying name
                this.defineSource(bindName, {
                    ...existing,
                    name: existing.name,
                    alias: alias ?? existing.alias,
                });
                return;
            }

            // physical table
            const physical: VirtualSource = {
                name: objectName,
                kind: forcedKind ?? "table",
                alias,
                baseName: objectName,
                definedAt: location ?? expr,
                columns: new Map(),
                wildcardSources: [
                    {
                        kind: "column",
                        name: `${objectName}.*`,
                        source: objectName,
                        sourceKind: forcedKind ?? "table",
                        resolution: "resolved",
                        wildcard: true,
                        location: expr,
                    },
                ],
            };

            // bind alias -> physical
            this.defineSource(bindName, physical);

            // also bind physical name -> physical
            // Customer -> Customer
            if (bindName.toLowerCase() !== objectName.toLowerCase()) {
                this.defineSource(objectName, physical);
            }

            return;
        }

        if (expr.type === "FunctionCall" || expr.type === "ValuesTableExpression") {
            const bindName = alias ?? "__derived";
            const kind: LineageSourceKind =
                forcedKind ?? (expr.type === "FunctionCall" ? "function" : "derived_values");

            const projected = aliasColumns
                ? new Map(
                      aliasColumns.map((name) => [
                          name.toLowerCase(),
                          {
                              name,
                              inputs: [],
                              location: expr,
                          } as DerivedColumn,
                      ]),
                  )
                : new Map<string, DerivedColumn>();

            this.defineSource(bindName, {
                name: bindName,
                alias,
                kind,
                definedAt: location ?? expr,
                columns: projected,
                wildcardSources: [
                    {
                        kind: "column",
                        name: `${bindName}.*`,
                        source: bindName,
                        sourceKind: kind,
                        resolution: "resolved",
                        wildcard: true,
                        location: expr,
                    },
                ],
            });
        }
    }

    private applyAliasColumns(columns: DerivedColumn[], aliasColumns?: string[]): DerivedColumn[] {
        if (!aliasColumns?.length) {
            return columns;
        }

        return columns.map((column, index) => ({
            ...column,
            name: aliasColumns[index] ?? column.name,
        }));
    }

    private getTableReferenceProjectionColumns(ref: TableReference): string[] | undefined {
        if (ref.pivot) {
            return ref.pivot.inColumns.map((col) => col.name);
        }

        if (ref.unpivot) {
            const cols: string[] = [];
            if (ref.unpivot.valueColumn) {
                cols.push(ref.unpivot.valueColumn.name);
            }
            if (ref.unpivot.forColumn) {
                cols.push(ref.unpivot.forColumn.name);
            }
            return cols.length ? cols : undefined;
        }

        return undefined;
    }

    // ============================================================
    // INSERT
    // ============================================================

    private visitInsert(stmt: InsertNode): void {
        // OUTPUT pseudo tables live in statement-local scope
        this.pushSources();
        this.defineOutputPseudoSources();

        // INSERT ... SELECT lineage
        if (stmt.table && stmt.table.type === "Identifier" && stmt.selectQuery) {
            this.recordReadScopeForQuery("INSERT", stmt, stmt.selectQuery);
            const target = stmt.table.name;
            const sourceCols = this.visitQuery(stmt.selectQuery, false);
            const targetSource = this.resolveSource(target);
            const targetCols =
                stmt.columns && stmt.columns.length > 0
                    ? stmt.columns
                    : [...(targetSource?.columns.values() ?? [])].map((col) => col.name);

            if (
                targetCols.length === 0 &&
                sourceCols.length === 1 &&
                sourceCols[0].inputs.some((input) => input.wildcard)
            ) {
                this.columns.push({
                    name: `${target}.*`,
                    expression: sourceCols[0].expression,
                    inputs: sourceCols[0].inputs,
                    location: stmt,
                });
            }

            for (let i = 0; i < targetCols.length; i++) {
                const targetCol = targetCols[i];
                const src = sourceCols[i];

                if (!src) {
                    continue;
                }

                this.columns.push({
                    name: `${target}.${targetCol}`,
                    inputs: src.inputs,
                    location: stmt,
                });
            }
        }

        // INSERT ... VALUES lineage
        if (
            stmt.table &&
            stmt.table.type === "Identifier" &&
            stmt.values &&
            stmt.columns &&
            stmt.columns.length > 0
        ) {
            const target = stmt.table.name;

            for (const row of stmt.values) {
                for (let i = 0; i < stmt.columns.length; i++) {
                    const targetCol = stmt.columns[i];
                    const expr = row[i];

                    if (!expr) {
                        continue;
                    }

                    this.columns.push({
                        name: `${target}.${targetCol}`,
                        expression: expr,
                        inputs: this.resolveExpression(expr),
                        location: stmt,
                    });
                }
            }
        }

        // INSERT ... OUTPUT ...
        this.visitOutputClause(stmt.output);

        this.popSources();
    }

    // ============================================================
    // UPDATE
    // ============================================================

    private visitUpdate(stmt: UpdateNode): void {
        if (!stmt.target || stmt.target.type !== "Identifier") {
            return;
        }

        this.pushSources();
        this.defineOutputPseudoSources();

        if (stmt.from) {
            for (const ref of stmt.from) {
                this.registerTableReference(ref);
            }
        }

        this.recordReadScope("UPDATE", stmt, stmt.from ?? []);
        this.registerSource(stmt.target, undefined, undefined, "table");

        const target = stmt.target.name;
        const predicateInputs = this.resolveExpression(stmt.where);
        this.recordMutationTarget("UPDATE", stmt, target, predicateInputs);

        for (const assignment of stmt.assignments ?? []) {
            this.columns.push({
                name:
                    assignment.columnNode && assignment.columnNode.parts.length > 1
                        ? assignment.columnNode.name
                        : `${target}.${assignment.column}`,
                expression: assignment.value ?? undefined,
                inputs: assignment.value ? this.resolveExpression(assignment.value) : [],
                location: stmt,
            });
        }

        this.visitOutputClause(stmt.output);
        this.popSources();
    }

    // ============================================================
    // expression resolution
    // ============================================================

    private resolveExpression(expr: Expression | null | undefined): LineageNode[] {
        if (!expr) {
            return [];
        }

        switch (expr.type) {
            case "Identifier":
                return this.resolveIdentifier(expr);

            case "Variable":
                return [
                    {
                        kind: "variable",
                        name: expr.name,
                        location: expr,
                    },
                ];

            case "WildcardExpression":
                return this.resolveWildcard(expr);

            case "BinaryExpression":
                return [
                    ...this.resolveExpression(expr.left),
                    ...this.resolveExpression(expr.right),
                ];

            case "UnaryExpression":
                return this.resolveExpression(expr.right);

            case "GroupingExpression":
                return this.resolveExpression(expr.expression);

            case "FunctionCall":
                return [
                    ...this.resolveExpression(expr.receiver),
                    ...expr.args.flatMap((x) => this.resolveExpression(x)),
                    ...(expr.withinGroup?.flatMap((order) =>
                        this.resolveExpression(order.expression),
                    ) ?? []),
                ];

            case "ValuesTableExpression":
                return expr.rows.flatMap((row) =>
                    row.flatMap((value) => this.resolveExpression(value)),
                );

            case "CaseExpression":
                return [
                    ...(expr.input ? this.resolveExpression(expr.input) : []),
                    ...expr.branches.flatMap((b) => [
                        ...(b.when ? this.resolveExpression(b.when) : []),
                        ...(b.then ? this.resolveExpression(b.then) : []),
                    ]),
                    ...(expr.elseBranch ? this.resolveExpression(expr.elseBranch) : []),
                ];

            case "BetweenExpression":
                return [
                    ...this.resolveExpression(expr.left),
                    ...this.resolveExpression(expr.lowerBound),
                    ...this.resolveExpression(expr.upperBound),
                ];

            case "InExpression":
                return [
                    ...this.resolveExpression(expr.left),
                    ...(expr.list?.flatMap((x) => this.resolveExpression(x)) ?? []),
                    ...(expr.subquery ? this.resolveQueryInputs(expr.subquery) : []),
                ];

            case "OverExpression":
                return [
                    ...this.resolveExpression(expr.expression),
                    ...(expr.window.partitionBy?.flatMap((partition) =>
                        this.resolveExpression(partition),
                    ) ?? []),
                    ...(expr.window.orderBy?.flatMap((order) =>
                        this.resolveExpression(order.expression),
                    ) ?? []),
                    ...this.resolveFrameBoundary(expr.window.frame?.from),
                    ...this.resolveFrameBoundary(expr.window.frame?.to),
                ];

            case "CastExpression":
                return [
                    ...this.resolveExpression(expr.expression),
                    ...(expr.style ? this.resolveExpression(expr.style) : []),
                ];

            case "SubqueryExpression":
                return this.resolveQueryInputs(expr.query);

            case "ExistsExpression":
                return this.resolveQueryInputs(expr.query);

            default:
                return [];
        }
    }

    private resolveQueryInputs(query: QueryStatement): LineageNode[] {
        return this.visitQuery(query, false).flatMap((column) => column.inputs);
    }

    private resolveFrameBoundary(boundary: FrameBoundary | null | undefined): LineageNode[] {
        if (!boundary) {
            return [];
        }

        if (boundary.type === "PRECEDING" || boundary.type === "FOLLOWING") {
            return this.resolveExpression(boundary.value);
        }

        return [];
    }

    private resolveIdentifier(expr: IdentifierNode): LineageNode[] {
        const parts = expr.parts;

        // ------------------------------------------------------------
        // qualified reference: alias.column / table.column
        // ------------------------------------------------------------
        if (parts.length >= 2) {
            const qualifier = parts[0];
            const column = parts[parts.length - 1];

            const source = this.resolveSource(qualifier);

            if (source) {
                const derived = source.columns.get(column.toLowerCase());

                // flatten virtual source lineage
                if (derived) {
                    return derived.inputs;
                }

                // physical table column
                return [
                    {
                        kind: "column",
                        name: `${source.name}.${column}`,
                        source: source.name,
                        sourceKind: source.kind,
                        resolution: "resolved",
                        location: expr,
                    },
                ];
            }

            return [
                {
                    kind: "column",
                    name: expr.name,
                    resolution: "unresolved",
                    location: expr,
                },
            ];
        }

        // ------------------------------------------------------------
        // unqualified reference: infer source if exactly one visible
        // ------------------------------------------------------------
        const unique = new Map<string, VirtualSource>();
        const visibleSources = this.getCandidateBearingSources();

        for (const source of visibleSources) {
            unique.set(source.name.toLowerCase(), source);
        }

        // exactly one visible source → infer ownership
        if (unique.size === 1) {
            const source = [...unique.values()][0];

            const derived = source.columns.get(expr.name.toLowerCase());

            // flatten virtual source lineage
            if (derived) {
                return derived.inputs;
            }

            return [
                {
                    kind: "column",
                    name: `${source.name}.${expr.name}`,
                    source: source.name,
                    sourceKind: source.kind,
                    resolution: "resolved",
                    location: expr,
                },
            ];
        }

        const candidates = this.getCandidateSourceNames(expr.name);

        // exactly one viable owner for this column in scope -> promote directly
        if (candidates.length === 1) {
            const source = this.resolveSource(candidates[0]);

            if (source) {
                const derived = source.columns.get(expr.name.toLowerCase());

                if (derived) {
                    return derived.inputs;
                }

                return [
                    {
                        kind: "column",
                        name: `${source.name}.${expr.name}`,
                        source: source.name,
                        sourceKind: source.kind,
                        resolution: "resolved",
                        candidateSources: candidates,
                        location: expr,
                    },
                ];
            }
        }

        if (candidates.length > 1) {
            this.ambiguities.push({
                name: expr.name,
                location: expr,
                candidates,
            });
        }

        // ambiguous / unknown
        return [
            {
                kind: "column",
                name: expr.name,
                resolution: candidates.length > 1 ? "ambiguous" : "unresolved",
                candidateSources: candidates.length > 0 ? candidates : undefined,
                location: expr,
            },
        ];
    }

    private getCandidateSourceNames(columnName: string): string[] {
        const normalized = columnName.toLowerCase();
        const candidates = new Map<string, true>();

        for (const source of this.getCandidateBearingSources()) {
            if (source.columns.size === 0 || source.columns.has(normalized)) {
                candidates.set(source.name, true);
            }
        }

        return [...candidates.keys()];
    }

    private getCandidateBearingSources(): VirtualSource[] {
        const sources: VirtualSource[] = [];
        for (const source of this.currentSources().values()) {
            if (source.kind === "pseudo_output") {
                continue;
            }
            sources.push(source);
        }
        return sources;
    }

    private resolveWildcard(expr: WildcardExpression): LineageNode[] {
        // ------------------------------------------------------------
        // SELECT *
        // Expand to every visible source in current FROM scope.
        // ------------------------------------------------------------
        if (!expr.tablePrefix) {
            const seen = new Set<string>();
            const nodes: LineageNode[] = [];

            const current = this.currentSources();

            for (const source of current.values()) {
                for (const wildcard of source.wildcardSources) {
                    const key = wildcard.name.toLowerCase();

                    if (seen.has(key)) {
                        continue;
                    }

                    seen.add(key);
                    nodes.push(wildcard);
                }
            }

            // fallback: malformed / missing FROM
            if (nodes.length === 0) {
                return [
                    {
                        kind: "column",
                        name: "*",
                        wildcard: true,
                        location: expr,
                    },
                ];
            }

            return nodes;
        }

        // ------------------------------------------------------------
        // SELECT alias.*
        // ------------------------------------------------------------
        const qualifier = expr.tablePrefix.name;
        const source = this.resolveSource(qualifier);

        // unresolved alias:
        // preserve qualifier instead of degrading to bare *
        if (!source) {
            return [
                {
                    kind: "column",
                    name: `${qualifier}.*`,
                    source: qualifier,
                    wildcard: true,
                    location: expr,
                },
            ];
        }

        return source.wildcardSources;
    }

    // ============================================================
    // edge projection
    // ============================================================

    private buildEdges(columns: DerivedColumn[]): LineageEdge[] {
        const edges: LineageEdge[] = [];
        const seen = new Set<string>();

        for (const col of columns) {
            const target: LineageNode = {
                kind: "result",
                name: col.name,
                location: col.location,
            };

            for (const input of col.inputs) {
                const key = `${input.name}->${target.name}`;

                if (seen.has(key)) {
                    continue;
                }

                seen.add(key);

                edges.push({
                    from: input,
                    to: target,
                    location: col.location,
                });
            }
        }

        return edges;
    }

    private collectWildcardSources(cols: DerivedColumn[]): LineageNode[] {
        const seen = new Set<string>();
        const nodes: LineageNode[] = [];

        for (const col of cols) {
            for (const input of col.inputs) {
                if (!input.wildcard) {
                    continue;
                }

                const key = input.name.toLowerCase();

                if (seen.has(key)) {
                    continue;
                }

                seen.add(key);
                nodes.push(input);
            }
        }

        return nodes;
    }

    public resolveExpressionPublic(expr: Expression | null | undefined): LineageNode[] {
        return this.resolveExpression(expr);
    }

    private recordMutationTarget(
        statement: "UPDATE" | "DELETE",
        stmt: UpdateNode | DeleteNode,
        targetName: string,
        predicateInputs?: LineageNode[],
    ): void {
        const source = this.resolveSource(targetName);
        this.mutations.push({
            statement,
            targetName,
            targetAlias: source?.alias,
            resolvedSourceName: source?.name,
            predicateInputs: predicateInputs ?? [],
            location: stmt,
        });
    }

    private recordReadScope(
        statement: "INSERT" | "UPDATE" | "DELETE" | "SELECT",
        location: NodeLocation,
        tableRefs: TableReference[],
    ): void {
        const sources: ReadScopeSource[] = [];
        const seen = new Set<string>();

        const walk = (ref: TableReference): void => {
            const source = this.toReadScopeSource(ref);
            if (source) {
                const key = `${source.name.toLowerCase()}|${(source.alias ?? "").toLowerCase()}|${source.kind}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    sources.push(source);
                }
            }

            for (const join of ref.joins) {
                const joinSource = this.toReadScopeSourceFromJoin(join);
                if (joinSource) {
                    const key = `${joinSource.name.toLowerCase()}|${(joinSource.alias ?? "").toLowerCase()}|${joinSource.kind}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        sources.push(joinSource);
                    }
                }
            }
        };

        for (const ref of tableRefs) {
            walk(ref);
        }

        this.readScopes.push({
            statement,
            location,
            sources,
        });
    }

    private recordReadScopeForQuery(
        statement: "INSERT" | "UPDATE" | "DELETE",
        location: NodeLocation,
        query: QueryStatement,
    ): void {
        const refs = this.collectTopLevelTableReferences(query);
        this.recordReadScope(statement, location, refs);
    }

    private collectTopLevelTableReferences(query: QueryStatement): TableReference[] {
        if (query.type === "SetOperator") {
            return this.collectTopLevelTableReferences(query.left);
        }

        return query.from ?? [];
    }

    private toReadScopeSource(ref: TableReference): ReadScopeSource | null {
        const expr = ref.table;
        if (!expr) return null;

        if (expr.type === "Identifier") {
            const resolved = this.resolveSource(ref.alias ?? expr.name);
            return {
                name: resolved?.name ?? expr.name,
                ...(ref.alias ? { alias: ref.alias } : {}),
                kind: resolved?.kind ?? "table",
                location: expr,
            };
        }

        if (expr.type === "SubqueryExpression") {
            return {
                name: ref.alias ?? "__subquery",
                ...(ref.alias ? { alias: ref.alias } : {}),
                kind: "derived_subquery",
                location: expr,
            };
        }

        if (expr.type === "FunctionCall") {
            return {
                name: ref.alias ?? expr.name,
                ...(ref.alias ? { alias: ref.alias } : {}),
                kind: "function",
                location: expr,
            };
        }

        if (expr.type === "ValuesTableExpression") {
            return {
                name: ref.alias ?? "__values",
                ...(ref.alias ? { alias: ref.alias } : {}),
                kind: "derived_values",
                location: expr,
            };
        }

        return null;
    }

    private toReadScopeSourceFromJoin(join: JoinNode): ReadScopeSource | null {
        const expr = join.table;
        if (!expr) return null;

        if (expr.type === "Identifier") {
            const resolved = this.resolveSource(join.alias ?? expr.name);
            return {
                name: resolved?.name ?? expr.name,
                ...(join.alias ? { alias: join.alias } : {}),
                kind: resolved?.kind ?? "table",
                location: expr,
            };
        }

        if (expr.type === "SubqueryExpression") {
            const isApply = join.type === "CROSS APPLY" || join.type === "OUTER APPLY";
            return {
                name: join.alias ?? "__subquery",
                ...(join.alias ? { alias: join.alias } : {}),
                kind: isApply ? "derived_apply" : "derived_subquery",
                location: expr,
            };
        }

        if (expr.type === "FunctionCall") {
            const isApply = join.type === "CROSS APPLY" || join.type === "OUTER APPLY";
            return {
                name: join.alias ?? expr.name,
                ...(join.alias ? { alias: join.alias } : {}),
                kind: isApply ? "derived_apply" : "function",
                location: expr,
            };
        }

        if (expr.type === "ValuesTableExpression") {
            return {
                name: join.alias ?? "__values",
                ...(join.alias ? { alias: join.alias } : {}),
                kind: "derived_values",
                location: expr,
            };
        }

        return null;
    }
}
