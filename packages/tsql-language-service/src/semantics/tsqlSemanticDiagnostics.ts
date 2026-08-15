/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    ColumnMetadata,
    MetadataView,
    ObjectMetadata,
    ParameterMetadata,
    SqlPrincipalKind,
} from "../metadata/index.js";
import type { SyntaxNode, SyntaxSnapshot } from "../syntax/index.js";
import type { TextRange } from "../text/index.js";
import type { SemanticDiagnostic } from "./contracts.js";

/**
 * SQL Server-compatible catalog, scope, type, and cross-statement validations.
 *
 * The validator is deliberately independent from VS Code and from the metadata implementation.
 * A `notFound` result is authoritative; `unknown` metadata never becomes a false diagnostic.
 */
export function collectTsqlSemanticDiagnostics(
    syntax: SyntaxSnapshot,
    metadata: MetadataView,
    validationRanges?: readonly TextRange[],
): readonly SemanticDiagnostic[] {
    const index = indexSyntax(syntax.root());
    const context = new ValidationContext(syntax, metadata, index, validationRanges);
    context.validateIdentifierNames();
    context.validateObjects();
    context.validateXmlTableMethods();
    context.validateQueries();
    context.validateProjectedRelations();
    context.validatePivotOperators();
    context.validateBooleanContexts();
    context.validateCommonTableExpressions();
    context.validateVariables();
    context.validateTableDefinitions();
    context.validateForeignKeys();
    context.validateExecutions();
    context.validateDml();
    context.validateOutputClauses();
    context.validateOrderBy();
    context.validateUserTypes();
    context.validateDataTypesAndColumns();
    context.validateDatabases();
    context.validatePrincipals();
    context.validateModuleDefinitions();
    context.validateDdlObjects();
    context.validateIndexes();
    context.validateConstraintIndexOptions();
    context.validateComputedColumnConstraints();
    context.validateBatchContracts();
    context.validateBuiltInFunctions();
    context.validateCatalogFunctionArguments();
    context.validateOptions();
    context.validateCursors();
    context.validateSynonyms();
    return context.result();
}

class ValidationContext {
    private readonly _text: string;
    private readonly _diagnostics: SemanticDiagnostic[] = [];
    private readonly _seen = new Set<string>();
    private readonly _localRelations: ReadonlyMap<string, readonly LocalRelationEvent[]>;
    private readonly _localProcedures: ReadonlyMap<string, readonly LocalProcedureEvent[]>;
    private readonly _localLogins: ReadonlyMap<string, readonly LocalLoginEvent[]>;
    private readonly _localTypes: ReadonlyMap<string, readonly LocalTypeEvent[]>;
    private readonly _variableDeclarations: readonly VariableDeclaration[];

    public constructor(
        private readonly _syntax: SyntaxSnapshot,
        private readonly _metadata: MetadataView,
        private readonly _index: ReadonlyMap<string, readonly SyntaxNode[]>,
        private readonly _validationRanges?: readonly TextRange[],
    ) {
        this._text = _syntax.document.text;
        this._localRelations = indexObjectEvents(
            collectLocalRelationEvents(_syntax, _index),
            _metadata,
        );
        this._localProcedures = indexObjectEvents(
            collectLocalProcedureEvents(_syntax, _index),
            _metadata,
        );
        this._localLogins = indexLoginEvents(collectLocalLoginEvents(_syntax, _index), _metadata);
        this._localTypes = indexObjectEvents(collectLocalTypeEvents(_syntax, _index), _metadata);
        this._variableDeclarations = collectVariableDeclarations(_syntax, _index);
    }

    public validateObjects(): void {
        for (const node of this.nodes("NamedTableSource")) this.validateRelation(node, false);
        for (const node of this.nodes("DmlTarget")) this.validateRelation(node, true);
        for (const node of this.nodes("FunctionTableSource")) this.validateRelation(node, false);
        for (const node of this.nodes("VariableTableSource")) {
            const variable = firstDescendant(node, "Variable");
            if (!variable) continue;
            const name = this.source(variable);
            if (!this.variableAt(name, variable.start, true)) {
                this.add(
                    "TableVariableRequired",
                    `Must declare the table variable \"${name}\".`,
                    variable,
                );
            }
        }
    }

    public validateIdentifierNames(): void {
        for (const identifier of this.nodes("IdentifierName")) {
            if (normalizeIdentifier(this.source(identifier)).length > 0) continue;
            this.add(
                "ObjectNameIsMissingOrEmpty",
                'An object or column name is missing or empty. For SELECT INTO statements, verify each column has a name. For other statements, look for empty alias names. Aliases defined as "" or [] are not allowed. Change the alias to a valid name.',
                identifier,
            );
        }
    }

    public validateDatabases(): void {
        const databases = this._metadata.databases();
        if (!databases) return;
        for (const statement of this.nodes("UseStatement")) {
            const nameNode = firstDescendant(statement, "IdentifierName");
            if (!nameNode) continue;
            const name = normalizeIdentifier(this.source(nameNode));
            if (!databases.some((database) => this.equal(database.name, name))) {
                this.add(
                    "CouldNotLocateEntryInSysdatabases",
                    `Could not locate entry in sysdatabases for database '${name}'. No entry found with that name. Make sure that the name is entered correctly.`,
                    nameNode,
                );
            }
            if (
                ancestor(statement, "CreateProcedureStatement") ||
                ancestor(statement, "CreateFunctionStatement") ||
                ancestor(statement, "CreateTriggerStatement") ||
                ancestor(statement, "AlterProcedureStatement") ||
                ancestor(statement, "AlterFunctionStatement") ||
                ancestor(statement, "AlterTriggerStatement")
            ) {
                this.add(
                    "UseDatabaseStatementNotAllowed",
                    "a USE database statement is not allowed in a procedure, function or trigger.",
                    statement,
                );
            }
        }
        for (const kind of [
            "CreateProcedureStatement",
            "CreateFunctionStatement",
            "CreateTriggerStatement",
            "AlterProcedureStatement",
            "AlterFunctionStatement",
            "AlterTriggerStatement",
        ]) {
            for (const module of this.nodes(kind)) {
                if (descendants(module, "UseStatement").length > 0) continue;
                const tokens = [...this._syntax.tokens(module)].filter((token) => !token.trivia);
                for (let index = 0; index < tokens.length; index++) {
                    const token = tokens[index]!;
                    if (token.kind === "BlockChunk") {
                        const source = this._text.slice(token.start, token.end);
                        for (const match of source.matchAll(
                            /(?:^|[;\r\n])\s*(USE)\s+(?!MODEL\b|HINT\b|PLAN\b)/giu,
                        )) {
                            const keyword = match[1]!;
                            const relativeStart = match.index! + match[0].lastIndexOf(keyword);
                            this.add(
                                "UseDatabaseStatementNotAllowed",
                                "a USE database statement is not allowed in a procedure, function or trigger.",
                                {
                                    start: token.start + relativeStart,
                                    end: token.start + relativeStart + keyword.length,
                                },
                            );
                        }
                        continue;
                    }
                    if (token.text.toLocaleUpperCase() !== "USE") continue;
                    const previous = tokens[index - 1]?.text.toLocaleUpperCase();
                    const next = tokens[index + 1]?.text.toLocaleUpperCase();
                    if (!token.lineStart && previous !== ";" && previous !== "BEGIN") continue;
                    if (!next || next === "MODEL" || next === "HINT" || next === "PLAN") continue;
                    this.add(
                        "UseDatabaseStatementNotAllowed",
                        "a USE database statement is not allowed in a procedure, function or trigger.",
                        token,
                    );
                }
            }
        }
    }

    public validatePrincipals(): void {
        if (this._metadata.completeness.principals !== "ready") return;
        for (const statement of [
            ...this.nodes("CreatePrincipalStatement"),
            ...this.nodes("AlterPrincipalStatement"),
            ...this.nodes("DropPrincipalStatement"),
        ]) {
            const source = this.source(statement);
            const operation = /^\s*(CREATE|ALTER|DROP)\s+(LOGIN|USER|ROLE)\b/iu.exec(source);
            const nameNode = firstDescendant(statement, "IdentifierName");
            if (!operation || !nameNode) continue;
            const verb = operation[1]!.toLocaleUpperCase();
            const kind = operation[2]!.toLocaleUpperCase();
            const name = normalizeIdentifier(this.source(nameNode));
            const existing = this.principalExistsAt(name, principalKinds(kind), nameNode.start);
            if (verb === "CREATE" && existing) {
                if (kind === "LOGIN") {
                    this.add(
                        "LoginExist",
                        `There is already a login named '${name}' in the database.`,
                        nameNode,
                    );
                } else if (kind === "USER") {
                    this.add(
                        "UserExist",
                        `There is already a user named '${name}' in the database.`,
                        nameNode,
                    );
                } else {
                    this.add(
                        "UserGroupOrRoleExists",
                        `User, group, or role '${name}' already exists in the current database.`,
                        nameNode,
                    );
                }
            } else if (verb !== "CREATE" && !existing) {
                if (kind === "LOGIN") {
                    this.add(
                        "CouldNotFindLogin",
                        `Cannot find the login '${name}', because it does not exist or you do not have permission.`,
                        nameNode,
                    );
                } else {
                    this.add(
                        "CannotFindUser",
                        `Cannot find the user '${name}', because it does not exist or you do not have permission.`,
                        nameNode,
                    );
                }
            }

            if (verb === "CREATE" && kind === "USER" && /\b(?:FOR|FROM)\s+LOGIN\b/iu.test(source)) {
                const identifiers = descendants(statement, "IdentifierName");
                const loginNode = identifiers[1];
                if (loginNode) {
                    const login = normalizeIdentifier(this.source(loginNode));
                    if (!this.principalExistsAt(login, ["login"], loginNode.start)) {
                        this.add(
                            "CouldNotFindLogin",
                            `Cannot find the login '${login}', because it does not exist or you do not have permission.`,
                            loginNode,
                        );
                    }
                }
            }
        }

        for (const statement of [
            ...this.nodes("CreateSchemaStatement"),
            ...this.nodes("CreatePrincipalStatement").filter((node) =>
                /^\s*CREATE\s+ROLE\b/iu.test(this.source(node)),
            ),
        ]) {
            const source = this.source(statement);
            if (!/\bAUTHORIZATION\b/iu.test(source)) continue;
            const owner = lastDescendant(statement, "IdentifierName");
            if (!owner) continue;
            const name = normalizeIdentifier(this.source(owner));
            if (
                !this.principalExistsAt(
                    name,
                    ["user", "databaseRole", "applicationRole"],
                    owner.start,
                )
            ) {
                this.add(
                    "CannotFindUser",
                    `Cannot find the user '${name}', because it does not exist or you do not have permission.`,
                    owner,
                );
            }
        }
    }

    public validateQueries(): void {
        for (const query of this.nodes("QuerySpecification")) {
            const selectElements = descendantsOwnedBy(query, "SelectElement", query);
            const assignmentElements = selectElements.filter((element) =>
                selectElementAssignsVariable(this.source(element)),
            );
            if (
                assignmentElements.length > 0 &&
                assignmentElements.length < selectElements.length
            ) {
                const retrieval = selectElements.find(
                    (element) => !selectElementAssignsVariable(this.source(element)),
                );
                this.add(
                    "SelectAssignmentError",
                    "A SELECT statement that assigns a value to a variable must not be combined with data-retrieval operations.",
                    retrieval ?? query,
                );
            }

            const sources = this.querySources(query);
            this.validateExposedNames(sources);
            const visibleSources = this.visibleQuerySources(query);
            this.validateXmlNodeStars(query, visibleSources);
            const aliases = selectAliases(this._syntax, query);
            for (const column of descendantsOwnedBy(query, "ColumnReference", query)) {
                if (ancestor(column, "DmlTarget")) continue;
                // Type parameters such as nvarchar(max) use an expression node so invalid type
                // arguments can recover locally. They are not query-column references.
                if (ancestor(column, "DataType")) continue;
                if (ancestor(column, "VectorSearchTableSource")) continue;
                if (isFunctionOptionArgument(this._syntax, column)) continue;
                const parts = multipartIdentifierParts(this.source(column));
                if (parts.length === 0) continue;
                if (ancestor(column, "OrderByClause") && aliases.has(this.fold(parts.at(-1)!))) {
                    continue;
                }
                this.validateColumn(column, parts, visibleSources);
                this.validateXmlNodeColumnUse(column, parts, visibleSources);
            }
        }

        // Only UNION has an ALL form; EXCEPT ALL and INTERSECT ALL parse so the unsupported
        // operator can be named instead of recovered.
        for (const kind of ["QueryExpression", "QueryTerm"] as const) {
            for (const node of this.nodes(kind)) {
                let operator: SyntaxNode | undefined;
                for (const child of node.children()) {
                    if (child.kind === "Except" || child.kind === "Intersect") {
                        operator = child;
                        continue;
                    }
                    if (child.kind === "All" && operator) {
                        this.add(
                            "OperatorNotSupported",
                            `The 'ALL' version of the ${operator.kind} operator is not supported.`,
                            { start: operator.start, end: child.end },
                        );
                    }
                    operator = undefined;
                }
            }
        }

        for (const option of this.nodes("GroupByOption")) {
            const spelling = this.source(option).trim().replace(/\s+/gu, " ");
            if (/^WITH\s+(?:CUBE|ROLLUP)$/iu.test(spelling)) continue;
            this.add(
                "InvalidGroupByOption",
                ` '${spelling}' is not a recognized GROUP BY option.`,
                option,
            );
        }

        for (const expression of this.nodes("QueryExpression")) {
            const terms = descendantsOwnedBy(expression, "QuerySpecification", expression).sort(
                (left, right) => left.start - right.start,
            );
            if (terms.length < 2) continue;
            for (const term of terms.slice(1)) {
                const into = descendantsOwnedBy(term, "IntoClause", term)[0];
                if (!into) continue;
                this.add(
                    "SelectIntoMustBeFirstQuery",
                    "SELECT INTO must be the first query in a statement containing a UNION, INTERSECT or EXCEPT operator.",
                    into,
                );
            }
        }
    }

    public validateBooleanContexts(): void {
        const expressions: SyntaxNode[] = [];
        for (const kind of ["WhereClause", "HavingClause", "QualifiedJoin"]) {
            for (const context of this.nodes(kind)) {
                if (kind === "WhereClause" && ancestor(context, "CreateIndexStatement")) continue;
                const expression = firstDescendant(context, "Expression");
                if (expression) expressions.push(expression);
            }
        }
        for (const expression of expressions) {
            if (isBooleanSource(this.source(expression))) continue;
            this.add(
                "BooleanConditionExpected",
                "An expression of non-boolean type specified in a context where a condition is expected.",
                expression,
            );
        }
    }

    public validateXmlTableMethods(): void {
        for (const source of this.nodes("FunctionTableSource")) {
            const nameNode = firstDescendant(source, "MultipartIdentifier");
            if (!nameNode) continue;
            const parts = multipartIdentifierParts(this.source(nameNode));
            if (!this.isInstanceTableMethod(source, parts)) continue;
            const alias = directChildren(source, "TableAlias")[0];
            const columns = directChildren(source, "ColumnNameList")[0];
            if (alias && columns) continue;
            this.add(
                "TVFMethodMustBeAliased",
                "The table (and its columns) returned by a table-valued method need to be aliased.",
                nameNode,
            );
        }
    }

    public validateCommonTableExpressions(): void {
        for (const withClause of this.nodes("WithClause")) {
            const names = new Set<string>();
            for (const cte of directOwnedDescendants(withClause, "CommonTableExpression")) {
                const nameNode = firstDescendant(cte, "IdentifierName");
                if (!nameNode) continue;
                const name = normalizeIdentifier(this.source(nameNode));
                const key = this.fold(name);
                if (names.has(key)) {
                    this.add(
                        "DuplicateCteName",
                        `Duplicate common table expression name '${name}' was specified.`,
                        nameNode,
                    );
                }
                names.add(key);

                const query = firstDescendant(cte, "QueryExpression");
                if (!query) continue;
                const terms = [...query.children()].filter((child) => child.kind === "QueryTerm");
                if (terms.length === 0) continue;
                const references = terms.map((term) =>
                    descendants(term, "NamedTableSource").filter((source) => {
                        const identifier = firstDescendant(source, "MultipartIdentifier");
                        const parts = identifier
                            ? multipartIdentifierParts(this.source(identifier))
                            : [];
                        return parts.length === 1 && this.equal(parts[0]!, name);
                    }),
                );
                const hasSelfReference = references.some((items) => items.length > 0);
                if (!hasSelfReference) continue;
                const hasUnionAll = terms
                    .slice(1)
                    .some((term, index) =>
                        /\bUNION\s+ALL\b/iu.test(this._text.slice(terms[index]!.end, term.start)),
                    );
                if (references[0]!.length > 0) {
                    const reference = references[0]![0]!;
                    if (hasUnionAll) {
                        this.add(
                            "NoAnchorMemberForRecursiveQuery",
                            `No anchor member was specified for recursive query "${name}".`,
                            reference,
                        );
                    } else {
                        this.add(
                            "RecursiveCteHasNoUnionAll",
                            `Recursive common table expression '${name}' does not contain a top-level UNION ALL operator.`,
                            reference,
                        );
                    }
                }
                let recursiveMemberSeen = false;
                for (let index = 0; index < terms.length; index++) {
                    const items = references[index]!;
                    if (items.length > 1) {
                        this.add(
                            "RecursiveCteMemberHasMultipleRefs",
                            `Recursive member of a common table expression '${name}' has multiple recursive references.`,
                            items[1]!,
                        );
                    }
                    if (items.length > 0) recursiveMemberSeen = true;
                    else if (recursiveMemberSeen) {
                        this.add(
                            "AnchorMemberFoundInRecursiveQuery",
                            `An anchor member was found in the recursive part of recursive query "${name}".`,
                            terms[index]!,
                        );
                    }
                }
            }
        }
    }

    public validateProjectedRelations(): void {
        for (const cte of this.nodes("CommonTableExpression")) {
            const name = directChildren(cte, "IdentifierName")[0];
            if (!name) continue;
            this.validateProjectedRelation(name, directChildren(cte, "ColumnNameList")[0], cte);
        }
        for (const derived of this.nodes("DerivedTable")) {
            const alias = directChildren(derived, "TableAlias")[0];
            const name = alias && firstDescendant(alias, "IdentifierName");
            if (!name) continue;
            this.validateProjectedRelation(
                name,
                directChildren(derived, "ColumnNameList")[0],
                derived,
            );
        }
        for (const view of [
            ...this.nodes("CreateViewStatement"),
            ...this.nodes("AlterViewStatement"),
        ]) {
            const name = firstDescendant(view, "MultipartIdentifier");
            if (!name) continue;
            this.validateProjectedRelation(name, directChildren(view, "ColumnNameList")[0], view);
        }
    }

    public validatePivotOperators(): void {
        for (const pivot of this.nodes("PivotJoin")) {
            this.validatePivotAggregate(pivot);
            const sourceColumns = this.joinInputColumns(pivot);
            const list = directChildren(pivot, "PivotColumnList")[0];
            if (!list) continue;
            const seen = new Set<string>();
            const alias = tableOperatorAlias(this._syntax, pivot, "PIVOT");
            for (const column of directChildren(list, "MultipartIdentifier")) {
                const parts = multipartIdentifierParts(this.source(column));
                // A qualified name replaces the conflict and duplicate checks, as it names no
                // column the PIVOT output could hold.
                if (parts.length > 1) {
                    this.add(
                        "PrefixedColumnsNotAllowedInPivot",
                        "Prefixed columns are not allowed in the column list of a PIVOT operator.",
                        column,
                    );
                    continue;
                }
                const name = parts[0] ?? "";
                const key = this.fold(name);
                if (seen.has(key)) {
                    this.add(
                        "ColumnSpecifiedMultipleTimes",
                        `The column '${name}' was specified multiple times for '${alias}'.`,
                        column,
                    );
                }
                seen.add(key);
                if (sourceColumns && hasColumn(sourceColumns, name, this._metadata)) {
                    this.add(
                        "ColumnNameConflictsInPivot",
                        `The column name "${name}" specified in the PIVOT operator conflicts with the existing column name in the PIVOT argument.`,
                        column,
                    );
                }
            }
        }

        for (const unpivot of this.nodes("UnpivotJoin")) {
            const sourceColumns = this.joinInputColumns(unpivot);
            const list = directChildren(unpivot, "ColumnNameList")[0];
            if (list) {
                const seen = new Set<string>();
                for (const column of descendants(list, "IdentifierName")) {
                    const name = normalizeIdentifier(this.source(column));
                    const key = this.fold(name);
                    if (seen.has(key)) {
                        this.add(
                            "ColumnSpecifiedMultipleTimesInUnpivot",
                            `The column "${name}" is specified multiple times in the column list of the UNPIVOT operator.`,
                            column,
                        );
                    }
                    seen.add(key);
                }
            }

            const outputColumns = directChildren(unpivot, "MultipartIdentifier").slice(0, 2);
            const outputSeen = new Set<string>();
            const alias = tableOperatorAlias(this._syntax, unpivot, "UNPIVOT");
            for (const column of outputColumns) {
                const parts = multipartIdentifierParts(this.source(column));
                // The value and pivoted columns name new output columns, so a prefix names nothing.
                if (parts.length > 1) {
                    this.add(
                        "PrefixedColumnsNotAllowedInUnpivot",
                        "Prefixes are not allowed in value or pivot columns of an UNPIVOT operator.",
                        column,
                    );
                    continue;
                }
                const name = parts[0] ?? "";
                const key = this.fold(name);
                if (outputSeen.has(key)) {
                    this.add(
                        "ColumnSpecifiedMultipleTimes",
                        `The column '${name}' was specified multiple times for '${alias}'.`,
                        column,
                    );
                }
                outputSeen.add(key);
                if (sourceColumns && hasColumn(sourceColumns, name, this._metadata)) {
                    this.add(
                        "ColumnNameConflictsInUnpivot",
                        `The column name "${name}" specified in the UNPIVOT operator conflicts with the existing column name in the UNPIVOT argument.`,
                        column,
                    );
                }
            }
        }
    }

    private validatePivotAggregate(pivot: SyntaxNode): void {
        const expression = directChildren(pivot, "Expression")[0];
        const call = expression && firstDescendant(expression, "FunctionCall");
        const nameNode = call && firstDescendant(call, "MultipartIdentifier");
        if (!call || !nameNode) return;
        const parts = multipartIdentifierParts(this.source(nameNode));
        // Multi-part names may be user-defined aggregates. The metadata contract deliberately
        // does not guess whether an ordinary catalog function is an aggregate.
        if (parts.length !== 1) return;
        const displayName = normalizeIdentifier(parts[0]!);
        const name = displayName.toLocaleUpperCase();
        if (!aggregateFunctionNames.has(name)) {
            this.add(
                "InvalidAggregateFunction",
                `'${displayName}' is not a recognized aggregate function.`,
                nameNode,
            );
            return;
        }

        const arity = pivotAggregateArities.get(name);
        if (!arity) return;
        const argumentList = firstDescendant(call, "ArgumentList");
        const actual = argumentList
            ? directChildren(argumentList, "Expression").length
            : firstDescendant(call, "Star")
              ? 1
              : 0;
        if (actual < arity.minimum) {
            this.add(
                "InsufficientArguments",
                `An insufficient number of arguments were supplied for the procedure or function ${displayName}.`,
                nameNode,
            );
        } else if (actual > arity.maximum) {
            this.add(
                "TooManyArguments",
                `Procedure or function '${displayName}' has too many arguments specified.`,
                nameNode,
            );
        }
    }

    public validateVariables(): void {
        const declarationsByScope = new Map<string, Map<string, VariableDeclaration>>();
        for (const declaration of this._variableDeclarations) {
            const scope = declaration.scope;
            const names = declarationsByScope.get(scope) ?? new Map<string, VariableDeclaration>();
            const key = this.fold(declaration.name);
            if (names.has(key)) {
                this.add(
                    "VariableNameNotUnique",
                    `The variable name '${declaration.name}' has already been declared.Variable names must be unique within a query batch or stored procedure.`,
                    declaration.node,
                );
            } else {
                names.set(key, declaration);
            }
            declarationsByScope.set(scope, names);
        }

        const declarationRanges = new Set(
            this._variableDeclarations.map(({ node }) => `${node.start}:${node.end}`),
        );
        for (const variable of this.nodes("Variable")) {
            if (declarationRanges.has(`${variable.start}:${variable.end}`)) continue;
            const name = this.source(variable);
            if (name.startsWith("@@")) continue;
            const tableSource = ancestor(variable, "VariableTableSource");
            if (tableSource) continue;
            const namedArgument = ancestor(variable, "NamedExecuteArgument");
            if (
                namedArgument &&
                variable.start === firstDescendant(namedArgument, "Variable")?.start
            ) {
                continue;
            }
            if (!this.variableAt(name, variable.start, false)) {
                this.add(
                    "ScalarVariableRequired",
                    `Must declare the scalar variable \"${name}\".`,
                    variable,
                );
            }
        }
    }

    public validateTableDefinitions(): void {
        for (const definition of this.nodes("TableDefinition")) {
            const owner = tableDefinitionOwner(this._syntax, definition);
            const seen = new Set<string>();
            let primaryKeyCount = 0;
            const columnSets: SyntaxNode[] = [];
            const rowStarts: NamedNode[] = [];
            const rowEnds: NamedNode[] = [];
            for (const column of directOwnedDescendants(definition, "ColumnDefinition")) {
                const nameNode = firstDescendant(column, "IdentifierName");
                if (!nameNode) continue;
                const name = normalizeIdentifier(this.source(nameNode));
                const source = this.source(column);
                const key = this.fold(name);
                if (seen.has(key)) {
                    this.add(
                        "ColumnNameNotUnique",
                        `Column names in each table must be unique. Column name '${name}' in table '${owner}' is specified more than once.`,
                        nameNode,
                    );
                }
                seen.add(key);

                primaryKeyCount += countMatches(source, /\bPRIMARY\s+KEY\b/giu);
                this.validateColumnConstraints(column, name, owner, source);

                if (/\bCOLUMN_SET\s+FOR\s+ALL_SPARSE_COLUMNS\b/iu.test(source)) {
                    columnSets.push(column);
                    const type = firstDescendant(column, "DataType");
                    const typeText = type ? this.source(type) : "";
                    if (!/^\s*XML\b/iu.test(typeText) || /\bNOT\s+NULL\b/iu.test(source)) {
                        this.add(
                            "CannotCreateSparseColumnSetOnTable",
                            `Cannot create the sparse column set '${name}' in the table '${owner}' because a sparse column set must be a nullable xml column. Modify the column definition to allow null values.`,
                            column,
                        );
                    }
                }

                const generated = /\bGENERATED\s+ALWAYS\s+AS\s+ROW\s+(START|END)\b/iu.exec(source);
                if (generated) {
                    const target =
                        generated[1]!.toLocaleUpperCase() === "START" ? rowStarts : rowEnds;
                    target.push({ name, node: column });
                    const type = firstDescendant(column, "DataType");
                    if (!type || !/^\s*DATETIME2\b/iu.test(this.source(type))) {
                        this.add(
                            "CannotCreateGeneratedAlwaysColumnType",
                            `Temporal generated always column '${name}' has invalid data type.`,
                            column,
                        );
                    } else if (/\bNULL\b/iu.test(source) && !/\bNOT\s+NULL\b/iu.test(source)) {
                        this.add(
                            "CannotCreateGeneratedAlwaysColumnNullable",
                            `Period column '${name}' in a system-versioned temporal table cannot be nullable.`,
                            column,
                        );
                    }
                }
            }

            primaryKeyCount += directOwnedDescendants(definition, "TableConstraint").reduce(
                (count, constraint) =>
                    count + countMatches(this.source(constraint), /\bPRIMARY\s+KEY\b/giu),
                0,
            );
            if (primaryKeyCount > 1) {
                this.add(
                    "MultiplePrimaryKey",
                    `Cannot add multiple PRIMARY KEY constraints to table '${owner}'.`,
                    definition,
                );
            }
            if (columnSets.length > 1) {
                const duplicate = columnSets[1]!;
                const name = normalizeIdentifier(
                    this.source(firstDescendant(duplicate, "IdentifierName") ?? duplicate),
                );
                this.add(
                    "CannotCreateMoreThanOneColumnSetOnTable",
                    `Cannot create the sparse column set '${name}' in the table '${owner}' because a table cannot have more than one sparse column set. Modify the statement so that only one column is specified as COLUMN_SET FOR ALL_SPARSE_COLUMNS.`,
                    duplicate,
                );
            }
            if (rowStarts.length > 1) {
                this.add(
                    "CannotCreateMoreThanOneGeneratedAlwaysAsRowStartColumnOnTable",
                    "Table cannot have more than one 'GENERATED ALWAYS AS ROW START' column.",
                    rowStarts[1]!.node,
                );
            }
            if (rowEnds.length > 1) {
                this.add(
                    "CannotCreateMoreThanOneGeneratedAlwaysAsRowEndColumnOnTable",
                    "Table cannot have more than one 'GENERATED ALWAYS AS ROW END' column.",
                    rowEnds[1]!.node,
                );
            }

            const periods = directOwnedDescendants(definition, "PeriodDefinition");
            if (periods.length > 1) {
                this.add(
                    "CannotCreateMoreThanOneTemporalSystemTimePeriodOnTable",
                    "Table cannot have more than one SYSTEM_TIME period definition.",
                    periods[1]!,
                );
            }
            const period = periods[0];
            if (period) {
                if (rowStarts.length === 0) {
                    this.add(
                        "GeneratedAlwaysAsRowStartColumnDefinitionMissing",
                        "Temporal 'GENERATED ALWAYS AS ROW START' column definition missing.",
                        period,
                    );
                } else if (rowEnds.length === 0) {
                    this.add(
                        "GeneratedAlwaysAsRowEndColumnDefinitionMissing",
                        "Temporal 'GENERATED ALWAYS AS ROW END' column definition missing.",
                        period,
                    );
                } else {
                    const periodNames = descendants(period, "IdentifierName").map((node) =>
                        normalizeIdentifier(this.source(node)),
                    );
                    if (periodNames[0] && !this.equal(periodNames[0], rowStarts[0]!.name)) {
                        this.add(
                            "GeneratedAlwaysAsRowStartColumnWrongName",
                            "Table SYSTEM_TIME period definition start column name not matching 'GENERATED ALWAYS AS ROW START' column name.",
                            period,
                        );
                    }
                    if (periodNames[1] && !this.equal(periodNames[1], rowEnds[0]!.name)) {
                        this.add(
                            "GeneratedAlwaysAsRowEndColumnWrongName",
                            "Table SYSTEM_TIME period definition end column name not matching 'GENERATED ALWAYS AS ROW END' column name.",
                            period,
                        );
                    }
                }
            } else if (rowStarts.length > 0 || rowEnds.length > 0) {
                this.add(
                    "TemporalSystemTimePeriodDefinitionMissing",
                    "Cannot create generated always column when SYSTEM_TIME period is not defined.",
                    definition,
                );
            }
        }
    }

    public validateForeignKeys(): void {
        for (const reference of this.nodes("ReferencesClause")) {
            const definition = ancestor(reference, "TableDefinition");
            const create = definition && ancestor(definition, "CreateTableStatement");
            const ownerNameNode = create && firstDescendant(create, "MultipartIdentifier");
            const referencedNameNode = firstDescendant(reference, "MultipartIdentifier");
            if (!definition || !ownerNameNode || !referencedNameNode) continue;

            const ownerName = compactMultipartName(this.source(ownerNameNode));
            const ownerParts = multipartIdentifierParts(ownerName);
            const ownerDisplay = ownerParts.at(-1) ?? ownerName;
            const tableConstraint = ancestor(reference, "TableConstraint");
            const constraintBody =
                tableConstraint && firstDescendant(tableConstraint, "TableConstraintBody");
            if (
                tableConstraint &&
                constraintBody &&
                directChildren(constraintBody, "ColumnNameList").length === 0
            ) {
                this.add(
                    "TableConstraintHasNoColumnList",
                    `Table level constraint does not specify column list, table '${ownerDisplay}'.`,
                    tableConstraint,
                );
                continue;
            }
            const constraintName = foreignKeyConstraintName(
                this._syntax,
                tableConstraint ?? ancestor(reference, "ColumnConstraint"),
            );
            const localColumns = definitionColumns(this._syntax, definition);
            const referencingNodes = foreignKeyReferencingColumns(reference);
            const referencingColumns = referencingNodes.map((node) => ({
                node,
                name: normalizeIdentifier(this.source(node)),
                column: localColumns.find((column) =>
                    this.equal(column.name, normalizeIdentifier(this.source(node))),
                ),
            }));
            for (const entry of referencingColumns) {
                if (entry.column) continue;
                this.add(
                    "ForeignKeyInvalidReferencingColumn",
                    `Foreign key '${constraintName}' references invalid column '${entry.name}' in referencing table '${ownerDisplay}'.`,
                    entry.node,
                );
            }

            const referencedName = compactMultipartName(this.source(referencedNameNode));
            const referencedParts = multipartIdentifierParts(referencedName);
            const selfReference = sameObjectName(ownerParts, referencedParts, this._metadata);
            const localEvent = selfReference
                ? undefined
                : this.localRelationEventAt(referencedParts, reference.start);
            const localReference = selfReference
                ? { columns: localColumns }
                : localEvent?.create
                  ? localEvent
                  : undefined;
            const resolution =
                localReference || localEvent
                    ? undefined
                    : this._metadata.resolveObject(referencedParts);
            if (
                !localReference &&
                ((localEvent !== undefined && !localEvent.create) ||
                    resolution?.kind === "notFound" ||
                    (resolution?.kind === "resolved" && resolution.object.kind !== "table"))
            ) {
                this.add(
                    "ForeignKeyReferencesInvalidTable",
                    `Foreign key '${constraintName}' references invalid table '${referencedName}'.`,
                    referencedNameNode,
                );
                continue;
            }
            let referencedColumns: readonly ColumnMetadata[] | undefined;
            if (localReference) {
                referencedColumns = localReference.columns;
            } else if (resolution?.kind === "resolved") {
                referencedColumns = this.loadedColumns(resolution.object);
            } else {
                continue;
            }
            if (!referencedColumns) continue;
            const explicitList = firstDescendant(reference, "ColumnNameList");
            let referencedEntries: readonly {
                readonly node: SyntaxNode;
                readonly name: string;
                readonly column?: ColumnMetadata;
            }[];
            if (explicitList) {
                referencedEntries = descendants(explicitList, "IdentifierName").map((node) => {
                    const name = normalizeIdentifier(this.source(node));
                    return {
                        node,
                        name,
                        column: referencedColumns.find((column) => this.equal(column.name, name)),
                    };
                });
                for (const entry of referencedEntries) {
                    if (entry.column) continue;
                    this.add(
                        "ForeignKeyInvalidReferencedColumn",
                        `Foreign key '${constraintName}' references invalid column '${entry.name}' in referenced table '${referencedName}'.`,
                        entry.node,
                    );
                }
            } else {
                const primaryKey = referencedColumns
                    .filter((column) => column.primaryKeyOrdinal !== undefined)
                    .sort((left, right) => left.primaryKeyOrdinal! - right.primaryKeyOrdinal!);
                if (primaryKey.length === 0) {
                    this.add(
                        "ForeignKeyReferencesImplicitlyTableWithoutPrimaryKey",
                        `Foreign key '${constraintName}' has implicit reference to object '${referencedName}' which does not have a primary key defined on it.`,
                        referencedNameNode,
                    );
                    continue;
                }
                referencedEntries = primaryKey.map((column) => ({
                    node: referencedNameNode,
                    name: column.name,
                    column,
                }));
            }

            if (referencingColumns.length !== referencedEntries.length) {
                this.add(
                    "ForeignKeyNumberOfRefColumnsDiffers",
                    `Number of referencing columns in foreign key differs from number of referenced columns, table '${ownerDisplay}'.`,
                    reference,
                );
                continue;
            }
            for (let index = 0; index < referencingColumns.length; index++) {
                const referencing = referencingColumns[index]!;
                const referenced = referencedEntries[index]!;
                if (!referencing.column || !referenced.column) continue;
                const referencingType = foreignKeyBaseType(referencing.column.typeDisplay);
                const referencedType = foreignKeyBaseType(referenced.column.typeDisplay);
                if (!referencingType || !referencedType || referencingType === referencedType) {
                    continue;
                }
                this.add(
                    "ColumnIsNotSameTypeAsRefColumn",
                    `Column '${referencedName}.${referenced.name}' is not the same data type as referencing column '${ownerDisplay}.${referencing.name}' in foreign key '${constraintName}'.`,
                    referencing.node,
                );
            }
        }
    }

    private validateColumnConstraints(
        column: SyntaxNode,
        name: string,
        owner: string,
        source: string,
    ): void {
        const constraints: readonly [string, RegExp][] = [
            ["CHECK", /\bCHECK\s*\(/giu],
            ["DEFAULT", /\bDEFAULT\b/giu],
            ["IDENTITY", /\bIDENTITY\b/giu],
            ["PRIMARY KEY", /\bPRIMARY\s+KEY\b/giu],
            ["ROWGUIDCOL", /\bROWGUIDCOL\b/giu],
            ["UNIQUE", /\bUNIQUE\b/giu],
        ];
        for (const [label, pattern] of constraints) {
            if (countMatches(source, pattern) <= 1) continue;
            this.add(
                "ColumnConstraintNotUnique",
                `Multiple ${label} constraints were specified for column '${name}', table '${owner}'.`,
                column,
            );
        }
        const nullOptions = source.match(/\b(?:NOT\s+)?NULL\b/giu) ?? [];
        if (nullOptions.length > 1) {
            this.add(
                "ColumnConstraintNotUnique",
                `Multiple NULL constraints were specified for column '${name}', table '${owner}'.`,
                column,
            );
        }
        if (/\bPRIMARY\s+KEY\b/iu.test(source) && /\bUNIQUE\b/iu.test(source)) {
            this.add(
                "PrimaryKeyNotUnique",
                `Both a PRIMARY KEY and UNIQUE constraint have been defined for column '${name}', table '${owner}'. Only one is allowed.`,
                column,
            );
        }
        if (/\bSPARSE\b/iu.test(source)) {
            const type = firstDescendant(column, "DataType");
            const typeText = type ? this.source(type) : "";
            const invalidSparse =
                !/\bNULL\b/iu.test(source) ||
                /\bNOT\s+NULL\b|\bIDENTITY\b|\bROWGUIDCOL\b|\bFILESTREAM\b/iu.test(source) ||
                /^\s*(?:GEOGRAPHY|GEOMETRY|TEXT|NTEXT|IMAGE|TIMESTAMP)\b/iu.test(typeText);
            if (invalidSparse) {
                this.add(
                    "CannotCreateSparseColumn",
                    `Cannot create the sparse column '${name}' in the table '${owner}' because an option or data type specified is not valid. A sparse column must be nullable and cannot have the ROWGUIDCOL, IDENTITY, or FILESTREAM properties. A sparse column cannot be of the following data types: text, ntext, image, geometry, geography, or user-defined type.`,
                    column,
                );
            } else if (/\bDEFAULT\b/iu.test(source)) {
                this.add(
                    "CannotCreateDefaultConstraintOnSparseColumn",
                    `A DEFAULT constraint cannot be created on the column '${name}' in the table '${owner}' because the column is a sparse column or sparse column set. Sparse columns or sparse column sets cannot have a DEFAULT constraint.`,
                    column,
                );
            } else if (/\b(?:PRIMARY\s+KEY|UNIQUE)\b/iu.test(source)) {
                this.add(
                    "ColumnIsInvalidForUseAsKeyColumnInIndex",
                    `Column '${name}' in table '${owner}' is of a type that is invalid for use as a key column in an index.`,
                    column,
                );
            }
        }
    }

    public validateExecutions(): void {
        for (const execute of this.nodes("ExecuteStatement")) {
            for (const argument of descendantsOwnedBy(execute, "ExecuteArgument", execute)) {
                // READONLY belongs to a routine declaration; SQL Server parses it after an EXECUTE
                // argument only to reject it there.
                const option = firstDescendant(argument, "ExecuteArgumentOption");
                if (option && /^READONLY$/iu.test(this.source(option).trim())) {
                    this.add(
                        "ReadonlyCannotBeUsed",
                        "The READONLY option cannot be used in an EXECUTE or CREATE AGGREGATE statement.",
                        option,
                    );
                    continue;
                }
                const source = this.source(argument);
                if (!/\b(?:OUT|OUTPUT)\s*$/iu.test(source)) continue;
                const expression = firstDescendant(argument, "Expression");
                if (expression && /^\s*@[^\s]+\s*$/u.test(this.source(expression))) continue;
                this.add(
                    "InvalidConstantOutput",
                    "Cannot use the OUTPUT option when passing a constant to a stored procedure.",
                    argument,
                );
            }
            const entity = firstDescendant(execute, "ExecutableEntity");
            const nameNode = entity && firstDescendant(entity, "MultipartIdentifier");
            if (!nameNode) continue;
            const name = compactMultipartName(this.source(nameNode));
            const parts = multipartIdentifierParts(name);
            const local = this.localProcedureAt(parts, nameNode.start);
            if (local) {
                this.validateExecuteArguments(execute, name, local.parameters);
                continue;
            }
            const resolution = this._metadata.resolveObject(parts);
            if (resolution.kind === "notFound") {
                this.add(
                    "CannotFindStoredProcedure",
                    `Could not find stored procedure '${name}'.`,
                    nameNode,
                );
                continue;
            }
            if (resolution.kind !== "resolved") continue;
            if (resolution.object.kind !== "procedure") {
                this.add(
                    "ObjectNotExistOrIsInvalid",
                    `The object '${name}' does not exist or is invalid for this operation.`,
                    nameNode,
                );
                continue;
            }
            const parameterState = this._metadata.parameterState(resolution.object.ref);
            if (parameterState.kind !== "loaded") continue;
            this.validateExecuteArguments(execute, name, parameterState.value);
        }
    }

    public validateDml(): void {
        for (const insert of this.nodes("InsertStatement")) {
            const target = firstDescendant(insert, "DmlTarget");
            const nameNode = target && firstDescendant(target, "MultipartIdentifier");
            if (!target || !nameNode) continue;
            const targetName = compactMultipartName(this.source(nameNode));
            const targetColumns = this.relationColumnsAt(
                multipartIdentifierParts(targetName),
                target.start,
            );
            const insertColumns = directOwnedDescendants(target, "ColumnReference");
            const seen = new Set<string>();
            for (const column of insertColumns) {
                const name = multipartIdentifierParts(this.source(column)).at(-1);
                if (!name) continue;
                const key = this.fold(name);
                if (seen.has(key)) {
                    this.add(
                        "ColumnSpecifiedMultipleTimes",
                        `The column '${name}' was specified multiple times for '${targetName}'.`,
                        column,
                    );
                }
                seen.add(key);
                if (targetColumns && !hasColumn(targetColumns, name, this._metadata)) {
                    this.add(
                        "ColumnNameNotInTargetTable",
                        `Column name '${name}' does not exist in the target table or view.`,
                        column,
                    );
                }
            }

            const rows = descendantsOwnedBy(insert, "RowValue", insert);
            const rowCounts = rows.map((row) => directChildren(row, "Expression").length);
            if (new Set(rowCounts).size > 1) {
                this.add(
                    "NumberOfColumnsMustBeTheSame",
                    "The number of columns for each row in a table value constructor must be the same.",
                    rows.find((_, index) => index > 0 && rowCounts[index] !== rowCounts[0]) ??
                        insert,
                );
            }
            const expected =
                insertColumns.length > 0
                    ? insertColumns.length
                    : targetColumns?.filter((column) => !column.computed && !column.identity)
                          .length;
            if (expected !== undefined && rowCounts.some((count) => count !== expected)) {
                this.add(
                    "NumberOfValuesDoesNotMatchTableDef",
                    "Column name or number of supplied values does not match table definition.",
                    rows.find((_, index) => rowCounts[index] !== expected) ?? insert,
                );
            }

            const sourceSelect = firstDescendant(
                firstDescendant(insert, "InsertSource") ?? insert,
                "SelectList",
            );
            if (sourceSelect && insertColumns.length > 0) {
                const selected = directOwnedDescendants(sourceSelect, "SelectElement").length;
                if (selected < insertColumns.length) {
                    this.add(
                        "SelectListOfInsertHasFewerItems",
                        "The select list for the INSERT statement contains fewer items than the insert list. The number of SELECT values must match the number of INSERT columns.",
                        sourceSelect,
                    );
                } else if (selected > insertColumns.length) {
                    this.add(
                        "SelectListOfInsertHasMoreItems",
                        "The select list for the INSERT statement contains more items than the insert list. The number of SELECT values must match the number of INSERT columns.",
                        sourceSelect,
                    );
                }
            }
        }

        for (const update of this.nodes("UpdateStatement")) {
            const target = firstDescendant(update, "DmlTarget");
            const nameNode = target && firstDescendant(target, "MultipartIdentifier");
            const targetColumns = nameNode
                ? this.relationColumnsAt(
                      multipartIdentifierParts(this.source(nameNode)),
                      nameNode.start,
                  )
                : undefined;
            const seen = new Set<string>();
            for (const clause of descendantsOwnedBy(update, "SetClause", update)) {
                const columnNode = firstDescendant(clause, "MultipartIdentifier");
                const name = columnNode && multipartIdentifierParts(this.source(columnNode)).at(-1);
                if (!columnNode || !name) continue;
                const key = this.fold(name);
                if (seen.has(key)) {
                    this.add(
                        "SetClauseColumnSpecifiedMultipleTimes",
                        `The column name '${name}' is specified more than once in the SET clause. A column cannot be assigned more than one value in the same SET clause. Modify the SET clause to make sure that a column is updated only once. If the SET clause updates columns of a view, then the column name '${name}' may appear twice in the view definition.`,
                        columnNode,
                    );
                }
                seen.add(key);
                if (targetColumns && !hasColumn(targetColumns, name, this._metadata)) {
                    this.add(
                        "ColumnNameNotInTargetTable",
                        `Column name '${name}' does not exist in the target table or view.`,
                        columnNode,
                    );
                }
            }
        }
    }

    public validateOutputClauses(): void {
        for (const output of this.nodes("OutputClause")) {
            for (const element of descendantsOwnedBy(output, "OutputElement", output)) {
                const expression = firstDescendant(element, "Expression");
                if (!expression) continue;
                const subquery = firstDescendant(expression, "ParenthesizedQuery");
                if (subquery) {
                    this.add(
                        "SubqueriesNotAllowedInOutput",
                        "Subqueries are not allowed in the OUTPUT clause.",
                        subquery,
                    );
                    continue;
                }
                for (const call of descendants(expression, "FunctionCall")) {
                    const nameNode = firstDescendant(call, "MultipartIdentifier");
                    const name = nameNode
                        ? multipartIdentifierParts(this.source(nameNode)).at(-1)
                        : undefined;
                    if (!name || !aggregateFunctionNames.has(name.toLocaleUpperCase())) continue;
                    this.add(
                        "AggregateNotAllowedInOutput",
                        "An aggregate may not appear in the OUTPUT clause.",
                        call,
                    );
                }
            }

            const into = firstDescendant(output, "OutputIntoClause");
            const target = into && firstDescendant(into, "DmlTarget");
            if (!into || !target) continue;
            const targetNameNode = firstDescendant(target, "MultipartIdentifier");
            if (targetNameNode) {
                const targetName = compactMultipartName(this.source(targetNameNode));
                const parts = multipartIdentifierParts(targetName);
                const resolution = this._metadata.resolveObject(parts);
                if (
                    this.isCteReference(targetNameNode, parts) ||
                    (resolution.kind === "resolved" && resolution.object.kind === "view")
                ) {
                    this.add(
                        "OutputIntoTargetCannotBeViewOrCte",
                        `The target '${targetName}' of the OUTPUT INTO clause cannot be a view or common table expression.`,
                        targetNameNode,
                    );
                }

                if (resolution.kind === "resolved") {
                    const state = this._metadata.columnState(resolution.object.ref);
                    const columns = state.kind === "loaded" ? state.value : undefined;
                    const outputCount = descendantsOwnedBy(output, "OutputElement", output).length;
                    const hasColumnList = firstDescendant(into, "InsertColumnList") !== undefined;
                    if (
                        !hasColumnList &&
                        columns?.some((column) => column.identity) &&
                        outputCount > columns.filter((column) => !column.identity).length
                    ) {
                        this.add(
                            "ExplicitValueForIdentityColumn",
                            `An explicit value for the identity column in table '${targetName}' can only be specified when a column list is used and IDENTITY_INSERT is ON.`,
                            targetNameNode,
                        );
                    }
                }
            }

            const variable = firstDescendant(target, "Variable");
            const declaration = variable
                ? this.variableAt(this.source(variable), variable.start, true)
                : undefined;
            if (!variable || !declaration?.columns) continue;
            const supplied = [
                ...descendants(into, "InsertColumn"),
                ...descendants(into, "ColumnReference"),
            ];
            for (const columnNode of supplied) {
                const name = multipartIdentifierParts(this.source(columnNode)).at(-1);
                if (!name) continue;
                const column = declaration.columns.find((candidate) =>
                    this.equal(candidate.name, name),
                );
                if (column?.identity) {
                    this.add(
                        "InsertIntoIdentityColumnNotAllowed",
                        "INSERT into an identity column not allowed on table variables.",
                        columnNode,
                    );
                }
            }
        }
    }

    public validateOrderBy(): void {
        for (const order of this.nodes("OrderByClause")) {
            const select = ancestor(order, "SelectStatement");
            const query = select && firstDescendant(select, "QuerySpecification");
            const selectList = query && firstDescendant(query, "SelectList");
            if (!selectList) continue;
            const selected = directOwnedDescendants(selectList, "SelectElement");
            const expressions = directOwnedDescendants(order, "OrderExpression");
            for (const [index, expression] of expressions.entries()) {
                const source = this.source(expression)
                    .trim()
                    .replace(/\s+(?:ASC|DESC)\s*$/iu, "");
                if (/^[0-9]+$/u.test(source)) {
                    const position = Number(source);
                    if (position < 1 || position > selected.length) {
                        this.add(
                            "OrderByPositionNumberIsOutOfRange",
                            `The ORDER BY position number ${position} is out of range of the number of items in the select list.`,
                            expression,
                        );
                    } else if (descendants(selected[position - 1]!, "Variable").length > 0) {
                        this.add(
                            "OrderByItemContainsVariable",
                            `The SELECT item identified by the ORDER BY number ${position} contains a variable as part of the expression identifying a column position. Variables are only allowed when ordering by an expression referencing a column name.`,
                            expression,
                        );
                    }
                } else if (isConstantExpression(source)) {
                    this.add(
                        "OrderByListHasConstantExpression",
                        `A constant expression was encountered in the ORDER BY list, position ${index + 1}.`,
                        expression,
                    );
                }
            }
        }
    }

    public validateDataTypesAndColumns(): void {
        for (const dataType of this.nodes("DataType")) {
            const parsed = parseDataType(this.source(dataType));
            if (!parsed) continue;
            const parts = dataTypeParts(this._syntax, dataType);
            // A type name may carry at most a schema prefix, and an XML schema collection name the
            // same. An over-prefixed name makes the whole specification invalid, so nothing else
            // about this type is worth reporting.
            if (this.reportOverPrefixedTypeNames(dataType, parts, parsed.name)) continue;
            const systemType = isSystemDataType(parts, parsed.name, this.source(dataType));
            const typeResolution = systemType ? undefined : this.userTypeAt(parts, dataType.start);
            if (
                ["CastExpression", "TryCastExpression", "ConvertExpression"].some((kind) =>
                    ancestor(dataType, kind),
                ) &&
                !systemType
            ) {
                this.add(
                    "TypeIsNotSystemType",
                    `Type '${compactMultipartName(this.source(dataType))}' is not a defined system type.`,
                    dataType,
                );
            }
            const column = ancestor(dataType, "ColumnDefinition");
            const parameter = ancestor(dataType, "ProcedureParameter");
            const variable = ancestor(dataType, "VariableDeclaration");
            const collation = column
                ? descendantsOwnedBy(column, "ColumnOption", column).find((option) =>
                      /^\s*COLLATE\b/iu.test(this.source(option)),
                  )
                : undefined;
            if (typeResolution?.kind === "notFound" && !ancestor(dataType, "CreateTypeStatement")) {
                if (column) {
                    const nameNode = firstDescendant(column, "IdentifierName");
                    const name = nameNode
                        ? normalizeIdentifier(this.source(nameNode))
                        : compactMultipartName(this.source(dataType));
                    this.add(
                        "ColumnHasInvalidDataType",
                        `Column '${name}' has an invalid data type.`,
                        dataType,
                    );
                } else if (parameter || variable) {
                    const owner = parameter ?? variable!;
                    const variableNode = firstDescendant(owner, "Variable");
                    const name = variableNode ? this.source(variableNode) : "";
                    this.add(
                        "ParamVarHasInvalidDataType",
                        `Parameter or variable '${name}' has an invalid data type.`,
                        dataType,
                    );
                }
            }
            if (typeResolution?.kind === "resolved") {
                if (column && typeResolution.typeCategory === "table") {
                    const nameNode = firstDescendant(column, "IdentifierName");
                    const name = nameNode ? normalizeIdentifier(this.source(nameNode)) : "";
                    this.add(
                        "ColumnHasUserDefinedTableType",
                        `The column "${name}" does not have a valid data type. A column cannot be of a user-defined table type.`,
                        dataType,
                    );
                }
                if (parameter) {
                    const variableNode = firstDescendant(parameter, "Variable");
                    const name = variableNode ? this.source(variableNode) : "";
                    const readOnly = /\bREADONLY\b/iu.test(this.source(parameter));
                    if (typeResolution.typeCategory === "table" && !readOnly) {
                        this.add(
                            "TableValuedParameterMustBeReadOnly",
                            `The table-valued parameter "${name}" must be declared with the READONLY option.`,
                            dataType,
                        );
                    } else if (typeResolution.typeCategory !== "table" && readOnly) {
                        this.add(
                            "ParameterCannotBeReadOnly",
                            `The parameter "${name}" can not be declared READONLY since it is not a table-valued parameter.`,
                            dataType,
                        );
                    }
                }
            } else if (parameter && systemType && /\bREADONLY\b/iu.test(this.source(parameter))) {
                const variableNode = firstDescendant(parameter, "Variable");
                const name = variableNode ? this.source(variableNode) : "";
                this.add(
                    "ParameterCannotBeReadOnly",
                    `The parameter "${name}" can not be declared READONLY since it is not a table-valued parameter.`,
                    dataType,
                );
            }
            if (collation) {
                if (typeResolution?.kind === "resolved") {
                    this.add(
                        "CollateCannotBeUsedOnUddt",
                        "COLLATE clause cannot be used on user-defined data types.",
                        collation,
                    );
                } else if (
                    systemType &&
                    !isCollatableSystemDataType(parsed.name, this.source(dataType))
                ) {
                    this.add(
                        "ExpressionTypeInvalidForCollate",
                        `Expression type ${parsed.name} is invalid for COLLATE clause.`,
                        collation,
                    );
                }
            }
            const [first, second] = parsed.arguments;
            if (["decimal", "numeric"].includes(parsed.name)) {
                if (first !== undefined && (first < 1 || first > 38)) {
                    this.add(
                        "InvalidLengthOrPrecision",
                        `Length or precision specification ${first} is invalid.`,
                        dataType,
                    );
                }
                if (second !== undefined && (second < 0 || second > 38)) {
                    this.add("InvalidScale", `Specified scale ${second} is invalid.`, dataType);
                }
                if (first !== undefined && second !== undefined && second > first) {
                    this.add(
                        "ScalePrecisionMismatch",
                        "The scale must be less than or equal to the precision.",
                        dataType,
                    );
                }
            }
            // A single length argument may never exceed the 8000-byte ceiling that applies to every
            // data type; only below that ceiling does a type's own maximum decide.
            const lengthArgument = firstArgumentNode(dataType) ?? dataType;
            const maximum = typeLengthMaximum[parsed.name];
            if (
                parsed.arguments.length === 1 &&
                first !== undefined &&
                first > maximumSizeForAnyType &&
                !scaleArgumentTypes.has(parsed.name)
            ) {
                this.add(
                    "MaximumSizeErrorForAnyType",
                    `The size (${first}) given to the type '${parsed.name}' exceeds the maximum allowed for any data type (${maximumSizeForAnyType}).`,
                    lengthArgument,
                );
            } else if (maximum && first !== undefined && first > maximum) {
                this.add(
                    "MaximumSizeError",
                    `The size (${first}) given to the type '${parsed.name}' exceeds the maximum allowed (${maximum}).`,
                    dataType,
                );
            }
            if (
                ["time", "datetime2", "datetimeoffset"].includes(parsed.name) &&
                first !== undefined &&
                (first < 0 || first > 7)
            ) {
                this.add("InvalidScale", `Specified scale ${first} is invalid.`, dataType);
            }
            if (parsed.name === "float" && first !== undefined && (first < 1 || first > 53)) {
                this.add(
                    "InvalidLengthOrPrecision",
                    `Length or precision specification ${first} is invalid.`,
                    dataType,
                );
            }
        }

        for (const column of this.nodes("ColumnDefinition")) {
            const nameNode = firstDescendant(column, "IdentifierName");
            const typeNode = firstDescendant(column, "DataType");
            if (!nameNode) continue;
            const name = normalizeIdentifier(this.source(nameNode));
            const owner = tableDefinitionOwner(
                this._syntax,
                ancestor(column, "TableDefinition") ?? column,
            );
            const source = this.source(column);
            const identity = /\bIDENTITY\b/iu.test(source);
            const explicitlyNullable =
                /\bNULL\b/iu.test(source) && !/\bNOT\s+NULL\b/iu.test(source);
            if (!typeNode) {
                this.add(
                    "DataTypeMissing",
                    `The definition for column '${name}' must include a data type.`,
                    nameNode,
                );
                continue;
            }
            const type = parseDataType(this.source(typeNode))?.name;
            if (identity && explicitlyNullable) {
                this.add(
                    "CannotCreateIdentityOnNullable",
                    `Could not create IDENTITY attribute on nullable column '${name}', table '${owner}'.`,
                    nameNode,
                );
            }
            if (identity && /\bDEFAULT\b/iu.test(source)) {
                this.add(
                    "CannotHaveDefaultsOnIdentity",
                    `Defaults cannot be created on columns with an IDENTITY attribute. Table '${owner}', column '${name}'.`,
                    nameNode,
                );
            }
            if (identity && type && !identityTypes.has(type)) {
                this.add(
                    "IdentityColumnInvalidType",
                    `Identity column '${name}' must be of data type int, bigint, smallint, tinyint, or decimal or numeric with a scale of 0, and constrained to be nonnullable.`,
                    nameNode,
                );
            }
            const identityArguments = firstDescendant(column, "IdentityArguments");
            if (identityArguments) {
                const values = directChildren(identityArguments, "Expression");
                if (values[0] && !isNumericIdentityValue(this.source(values[0]))) {
                    this.add(
                        "InvalidSeed",
                        `Identity column '${name}' contains invalid SEED.`,
                        values[0],
                    );
                }
                if (values[1] && !isNumericIdentityValue(this.source(values[1]))) {
                    this.add(
                        "InvalidIncrement",
                        `Identity column '${name}' contains invalid INCREMENT.`,
                        values[1],
                    );
                }
            }
            if (/\bROWGUIDCOL\b/iu.test(source) && type !== "uniqueidentifier") {
                this.add(
                    "RowguidcolDatatypeMismatch",
                    "The ROWGUIDCOL property can only be specified on the uniqueidentifier data type.",
                    nameNode,
                );
            }
            if (/\bPRIMARY\s+KEY\b/iu.test(source) && explicitlyNullable) {
                this.add(
                    "CannotDefinePrimaryKeyOnNullable",
                    `Cannot define PRIMARY KEY constraint on nullable column in table '${owner}'.`,
                    nameNode,
                );
            }
        }
    }

    public validateUserTypes(): void {
        for (const create of this.nodes("CreateTypeStatement")) {
            const nameNode = firstDescendant(create, "MultipartIdentifier");
            if (!nameNode) continue;
            const parts = multipartIdentifierParts(this.source(nameNode));
            const existing = this.userTypeAt(parts, create.start);
            if (existing.kind === "resolved") {
                const display = compactMultipartName(this.source(nameNode));
                this.add(
                    "UserDefinedTypeExist",
                    `The type '${display}' already exists, or you do not have permission to create it.`,
                    nameNode,
                );
            }
            const baseType = directChildren(create, "DataType")[0];
            if (!baseType) continue;
            const parsed = parseDataType(this.source(baseType));
            if (!parsed) continue;
            const baseParts = dataTypeParts(this._syntax, baseType);
            const systemType = isSystemDataType(baseParts, parsed.name, this.source(baseType));
            if (systemType && !invalidAliasBaseTypes.has(parsed.name)) continue;
            const display = compactMultipartName(this.source(baseType)).replace(/\s*\(.*$/u, "");
            this.add(
                "InvalidBaseTypeForAlias",
                `The base type '${display}' is not a valid base type for the alias data type.`,
                baseType,
            );
        }
    }

    public validateDdlObjects(): void {
        const rules: readonly DdlRule[] = [
            {
                create: "CreateTableStatement",
                alter: "AlterTableStatement",
                drop: "DropTableStatement",
                kind: "table",
            },
            {
                create: "CreateViewStatement",
                alter: "AlterViewStatement",
                drop: "DropViewStatement",
                kind: "view",
            },
            {
                create: "CreateProcedureStatement",
                alter: "AlterProcedureStatement",
                drop: "DropProcedureStatement",
                kind: "procedure",
            },
            {
                create: "CreateFunctionStatement",
                alter: "AlterFunctionStatement",
                drop: "DropFunctionStatement",
                kind: "function",
            },
        ];
        for (const rule of rules) {
            for (const node of this.nodes(rule.create)) this.validateCreateObject(node);
            for (const node of this.nodes(rule.alter)) this.validateAlterObject(node, rule.kind);
            for (const node of this.nodes(rule.drop)) this.validateDropObject(node, rule.kind);
        }
    }

    public validateModuleDefinitions(): void {
        for (const kind of ["CreateProcedureStatement", "AlterProcedureStatement"] as const) {
            for (const module of this.nodes(kind)) {
                const nameNode = firstDescendant(module, "MultipartIdentifier");
                if (nameNode) {
                    const parts = multipartIdentifierParts(this.source(nameNode));
                    if (parts.length >= 3) {
                        this.add(
                            "DbNameIsNotAllowedForCreateAlterProc",
                            "CREATE/ALTER PROCEDURE' does not allow specifying the database name as a prefix to the object name.",
                            identifierPartRange(nameNode, this.source(nameNode), parts.length - 3),
                        );
                    }
                }
                const numberClause = firstDescendant(module, "ProcedureNumberClause");
                const numberNode = numberClause && firstDescendant(numberClause, "IntegerLiteral");
                if (numberNode) {
                    const value = BigInt(this.source(numberNode));
                    if (value <= 2_147_483_647n && (value === 0n || value > 32_767n)) {
                        this.add(
                            "InvalidProcedureNumberRange",
                            `Invalid procedure number ${value}.Must be between 1 and 32767.`,
                            numberNode,
                        );
                    }
                }
            }
        }

        for (const kind of ["CreateFunctionStatement", "AlterFunctionStatement"] as const) {
            for (const module of this.nodes(kind)) {
                const nameNode = firstDescendant(module, "MultipartIdentifier");
                if (nameNode) {
                    const parts = multipartIdentifierParts(this.source(nameNode));
                    if (parts.length >= 3) {
                        this.add(
                            "DbNameIsNotAllowedForCreateAlterFunc",
                            "CREATE/ALTER FUNCTION' does not allow specifying the database name as a prefix to the object name.",
                            identifierPartRange(nameNode, this.source(nameNode), parts.length - 3),
                        );
                    }
                    if (parts.at(-1)?.startsWith("#")) {
                        this.add(
                            "TempFunctionNameIsNotAllowed",
                            "Creation of temporary functions is not allowed.",
                            lastIdentifierRange(nameNode, this.source(nameNode)),
                        );
                    }
                }
                const options = descendantsOwnedBy(module, "FunctionOption", module);
                const returnsNull = options.find((option) =>
                    /^\s*RETURNS\s+NULL\s+ON\s+NULL\s+INPUT\s*$/iu.test(this.source(option)),
                );
                const calledOnNull = options.find((option) =>
                    /^\s*CALLED\s+ON\s+NULL\s+INPUT\s*$/iu.test(this.source(option)),
                );
                if (returnsNull && calledOnNull) {
                    this.add(
                        "ConflictingReturnsNullAndCalledOnNullInputOptions",
                        'Conflicting CREATE/ALTER FUNCTION options "RETURNS NULL ON NULL INPUT" and "CALLED ON NULL INPUT".',
                        returnsNull.start > calledOnNull.start ? returnsNull : calledOnNull,
                    );
                }
                const definition = firstDescendant(module, "FunctionDefinition");
                if (!definition) continue;
                const tableValued =
                    firstDescendant(definition, "FunctionTableReturnType") !== undefined;
                const external = firstDescendant(definition, "ExternalModuleBody") !== undefined;
                const inlineTable =
                    tableValued &&
                    !external &&
                    firstDescendant(definition, "ModuleBody") === undefined;
                const allowed = external
                    ? tableValued
                        ? externalTableFunctionOptions
                        : externalScalarFunctionOptions
                    : tableValued
                      ? inlineTable
                          ? inlineTableFunctionOptions
                          : tableFunctionOptions
                      : scalarFunctionOptions;
                for (const option of options) {
                    if (allowed.has(moduleOptionKey(this.source(option)))) continue;
                    this.add(
                        "InvalidOptionInCreateFunction",
                        'An invalid option was specified for the statement "CREATE/ALTER FUNCTION".',
                        option,
                    );
                }
                if (!external && !inlineTable) {
                    this.validateFunctionBody(module, tableValued, nameNode);
                }
            }
        }

        for (const kind of ["CreateViewStatement", "AlterViewStatement"] as const) {
            for (const module of this.nodes(kind)) {
                const nameNode = firstDescendant(module, "MultipartIdentifier");
                if (!nameNode) continue;
                const parts = multipartIdentifierParts(this.source(nameNode));
                if (parts.length >= 3) {
                    this.add(
                        "DatabaseNameAsPrefixInCreateView",
                        "'CREATE/ALTER VIEW' does not allow specifying the database name as a prefix to the object name.",
                        identifierPartRange(nameNode, this.source(nameNode), parts.length - 3),
                    );
                }
            }
        }
    }

    private validateFunctionBody(
        module: SyntaxNode,
        tableValued: boolean,
        nameNode: SyntaxNode | undefined,
    ): void {
        const statements = moduleBodyStatements(module);
        const last = statements.at(-1);
        if (nameNode && last && directChildren(last, "ReturnStatement").length === 0) {
            this.add(
                "LastStatementWithinFunctionMustBeReturn",
                "The last statement included within a function must be a return statement.",
                nameNode,
            );
        }

        // Every statement in the body, at any block depth, is checked for side effects.
        for (const statement of descendants(module, "Statement")) {
            for (const child of statement.children()) {
                // Recovery nodes are not reliable enough to classify as side-effecting statements.
                if (containsErrorNode(child)) continue;
                const phrase = this.sideEffectingPhrase(child);
                if (!phrase) continue;
                this.add(
                    "InvalidUseOfSideEffectingOperatorWithinFunction",
                    `Invalid use of a side-effecting operator '${phrase}' within a function.`,
                    child,
                );
            }
        }

        for (const statement of statementsInModule(module)) {
            const intoSelect = directChildren(statement, "SelectStatement")[0];
            if (
                intoSelect &&
                !containsErrorNode(intoSelect) &&
                firstDescendant(intoSelect, "IntoClause")
            ) {
                this.add(
                    "InvalidUseOfSideEffectingOperatorWithinFunction",
                    "Invalid use of a side-effecting operator 'SELECT' within a function.",
                    intoSelect,
                );
                continue;
            }

            const returnStatement = directChildren(statement, "ReturnStatement")[0];
            if (returnStatement) {
                const expression = directChildren(returnStatement, "Expression")[0];
                if (!tableValued && !expression) {
                    this.add(
                        "ReturnStatementInScalarValuedFunctionMustIncludeArg",
                        "RETURN statements in scalar valued functions must include an argument.",
                        returnStatement,
                    );
                } else if (tableValued && expression) {
                    this.add(
                        "UseReturnStatementWithValueCannotBeUsed",
                        " A RETURN statement with a return value cannot be used in this context.",
                        returnStatement,
                    );
                }
                continue;
            }

            const select = directChildren(statement, "SelectStatement")[0];
            if (!select || !selectReturnsClientData(this._syntax, select)) continue;
            this.add(
                "SelectStatementWithinFunctionCannotReturnData",
                "Select statements included within a function cannot return data to a client.",
                select,
            );
        }
    }

    /**
     * Names the statement phrase when this statement is side-effecting inside a function body.
     * The phrase is the longest leading keyword sequence SQL Server names for a statement, which
     * also decides whether the statement is one of the reported kinds at all.
     */
    private sideEffectingPhrase(statement: SyntaxNode): string | undefined {
        let phrase = sideEffectingStatementPhrases.get(statement.kind);
        if (phrase === undefined) {
            if (!derivedStatementPhraseKinds.has(statement.kind)) return undefined;
            // These node kinds cover several statements whose phrase is their own leading words.
            const words = (
                this.source(statement).match(/^(?:[\p{L}_]+\s+){0,3}[\p{L}_]+/u)?.[0] ?? ""
            )
                .toLocaleUpperCase()
                .split(/\s+/u);
            for (let length = words.length; length > 0; length--) {
                const candidate = words.slice(0, length).join(" ");
                if (knownStatementPhrases.has(candidate)) {
                    phrase = candidate;
                    break;
                }
            }
            if (phrase === undefined) return undefined;
        }
        // SET assigns a variable as often as it changes session state; only the latter is reported.
        if (phrase === "SET" && directChildren(statement, "Variable").length > 0) return undefined;
        // INSERT, DELETE, and MERGE are allowed against a table variable that produces no output.
        // SQL Server deliberately does not apply this check to UPDATE.
        if (dmlStatementPhrases.has(phrase) && this.isFunctionSafeDml(statement)) return undefined;
        return phrase;
    }

    /** A function body may modify a table variable, and only when it produces no output rows. */
    private isFunctionSafeDml(statement: SyntaxNode): boolean {
        const target = firstDescendant(statement, "DmlTarget");
        if (!target) return true;
        if (!firstDescendant(target, "Variable")) return false;
        const output = firstDescendant(statement, "OutputClause");
        if (!output) return true;
        const into = firstDescendant(output, "OutputIntoClause");
        const intoTarget = into && firstDescendant(into, "DmlTarget");
        return intoTarget !== undefined && firstDescendant(intoTarget, "Variable") !== undefined;
    }

    /**
     * A computed column always accepts UNIQUE and PRIMARY KEY. CHECK, FOREIGN KEY, and NOT NULL
     * describe stored data, so they require the column to be persisted.
     */
    public validateComputedColumnConstraints(): void {
        for (const column of this.nodes("ColumnDefinition")) {
            if (containsErrorNode(column)) continue;
            // A computed column has an expression where an ordinary column has its data type.
            if (directChildren(column, "DataType").length > 0) continue;
            const persisted = directChildren(column, "Persisted").length > 0;
            if (persisted) continue;
            for (const constraint of directChildren(column, "ColumnConstraint")) {
                const source = this.source(constraint);
                if (
                    !/^\s*(?:CONSTRAINT\s+\S+\s+)?(?:CHECK|FOREIGN\s+KEY|REFERENCES|NOT\s+NULL)\b/iu.test(
                        source,
                    )
                ) {
                    continue;
                }
                this.add(
                    "ComputedColumnsConstraintCheckError",
                    "Only UNIQUE or PRIMARY KEY constraints can be created on computed columns, while CHECK, FOREIGN KEY, and NOT NULL constraints require that computed columns be persisted.",
                    constraint,
                );
            }
        }
    }

    /**
     * A PRIMARY KEY or UNIQUE constraint accepts index options, but not the ones that only make
     * sense while building an index. DROP_EXISTING and STATISTICS_ONLY are never accepted, and
     * MAXDOP, SORT_IN_TEMPDB, and ONLINE are accepted only by ALTER TABLE.
     */
    public validateConstraintIndexOptions(): void {
        for (const clause of this.nodes("ConstraintIndexWithClause")) {
            if (containsErrorNode(clause)) continue;
            const constraint =
                ancestor(clause, "TableConstraintBody") ?? ancestor(clause, "ColumnConstraint");
            if (!constraint) continue;
            if (!/^\s*(?:PRIMARY\s+KEY|UNIQUE)\b/iu.test(this.source(constraint))) continue;
            const inCreate = ancestor(clause, "CreateTableStatement") !== undefined;
            for (const option of descendantsOwnedBy(clause, "GenericOptionName", clause)) {
                const name = normalizeIdentifier(this.source(option).trim()).toLocaleUpperCase();
                const rejected =
                    constraintForbiddenIndexOptions.has(name) ||
                    (inCreate && constraintBuildOnlyIndexOptions.has(name));
                if (!rejected) continue;
                this.add("UnrecognizedOption", `'${name}' is not a recognized option.`, option);
            }
        }
    }

    public validateIndexes(): void {
        for (const index of this.nodes("CreateIndexStatement")) {
            const target = firstDescendant(index, "MultipartIdentifier");
            const indexNameNode = firstDescendant(index, "IdentifierName");
            if (!target || !indexNameNode) continue;
            const targetName = compactMultipartName(this.source(target));
            const targetColumns = this.relationColumnsAt(
                multipartIdentifierParts(targetName),
                index.start,
            );
            const keyList = firstDescendant(index, "IndexColumnList");
            const include = firstDescendant(index, "IncludeClause");
            const keyColumns = keyList
                ? descendants(keyList, "IndexColumn").flatMap((column) => {
                      const name = firstDescendant(column, "IdentifierName");
                      return name ? [name] : [];
                  })
                : [];
            const includedColumns = include ? descendants(include, "IdentifierName") : [];
            const seen = new Set<string>();
            for (const column of [...keyColumns, ...includedColumns]) {
                const name = normalizeIdentifier(this.source(column));
                const key = this.fold(name);
                if (seen.has(key)) {
                    this.add(
                        "DuplicateColumnNamesInIndex",
                        `Cannot use duplicate column names in index. Column name '${name}' listed more than once.`,
                        column,
                    );
                }
                seen.add(key);
                const metadata = targetColumns?.find((candidate) =>
                    this.equal(candidate.name, name),
                );
                if (targetColumns && !metadata) {
                    this.add(
                        "ColumnNameNotInTargetTable",
                        `Column name '${name}' does not exist in the target table or view.`,
                        column,
                    );
                    continue;
                }
                if (!metadata?.typeDisplay) continue;
                const type = metadata.typeDisplay.replace(/\s+/gu, "").toLocaleLowerCase();
                const included = includedColumns.some(
                    (candidate) => candidate.start === column.start && candidate.end === column.end,
                );
                const invalidForBoth = /^(?:image|ntext|text)\b/u.test(type);
                const invalidForKey =
                    invalidForBoth ||
                    /^(?:geography|geometry|xml)\b/u.test(type) ||
                    /^(?:nvarchar|varbinary|varchar)\(max\)$/u.test(type);
                if ((included && invalidForBoth) || (!included && invalidForKey)) {
                    this.add(
                        included ? "InvalidIndexIncludedColumnType" : "InvalidIndexKeyColumnType",
                        included
                            ? ` Column '${name}' in table '${targetName}' is of a type that is invalid for use as included column in an index.`
                            : `Column '${name}' in table '${targetName}' is of a type that is invalid for use as a key column in an index.`,
                        column,
                    );
                }
            }
            const source = this.source(index);
            if (/^\s*CREATE\s+(?:UNIQUE\s+)?CLUSTERED\s+INDEX\b/iu.test(source) && include) {
                this.add(
                    "CannotSpecifyIncludedColumnsForClusteredIndex",
                    "Cannot specify included columns for a clustered index.",
                    indexNameNode,
                );
            }
            for (const option of descendants(index, "GenericOption")) {
                const optionSource = this.source(option);
                const fillFactor = /^\s*FILLFACTOR\s*=\s*(-?\d+)/iu.exec(optionSource)?.[1];
                if (fillFactor !== undefined && (+fillFactor < 1 || +fillFactor > 100)) {
                    this.add(
                        "InvalidFillFactorPercentage",
                        `Fillfactor ${fillFactor} is not a valid percentage; fillfactor must be between 1 and 100.`,
                        option,
                    );
                }
                const maxDop = /^\s*MAXDOP\s*=\s*(-?\d+)/iu.exec(optionSource)?.[1];
                if (maxDop !== undefined && (+maxDop < 0 || +maxDop > 64)) {
                    this.add(
                        "OutOfRangeDegreeOfParallelism",
                        `'${maxDop}' is out of range for index option 'maxdop'. See sp_configure option 'max degree of parallelism' for valid values.`,
                        option,
                    );
                }
            }
            const where = firstDescendant(index, "WhereClause");
            if (where) {
                const expression = firstDescendant(where, "Expression");
                if (!expression || !isBooleanSource(this.source(expression))) {
                    const indexName = normalizeIdentifier(this.source(indexNameNode));
                    this.add(
                        "IncorrectWhereClauseForFilteredIndex",
                        `Incorrect WHERE clause for filtered index '${indexName}' on table '${targetName}'.`,
                        where,
                    );
                }
            }
        }
        for (const index of this.nodes("CreateSemanticIndexStatement")) {
            if (firstDescendant(index, "SemanticExternalModel")) continue;
            const withClause = firstDescendant(index, "SemanticIndexWithClause") ?? index;
            this.add(
                "MissingSemanticIndexOption",
                "Missing EXTERNAL_MODEL in the CREATE SEMANTIC INDEX statement.",
                withClause,
            );
        }
    }

    public validateBatchContracts(): void {
        for (const batch of this.nodes("Batch")) {
            const statements = directChildren(batch, "Statement");
            if (statements.length === 1) continue;
            for (const statement of statements) {
                const body = [...statement.children()].find((child) =>
                    onlyStatementModuleKinds.has(child.kind),
                );
                if (!body) continue;
                const phrase = moduleStatementPhrase(this.source(body));
                this.add(
                    "MustBeOnlyStatementInBatch",
                    `Incorrect syntax: '${phrase}' must be the only statement in the batch.`,
                    body,
                );
            }
        }
    }

    public validateBuiltInFunctions(): void {
        for (const call of this.nodes("FunctionCall")) {
            const nameNode = firstDescendant(call, "MultipartIdentifier");
            if (!nameNode) continue;
            const parts = multipartIdentifierParts(this.source(nameNode));
            if (parts.length !== 1) continue;
            const name = parts[0]!.toLocaleUpperCase();
            const arity = builtInFunctionArities.get(name);
            const argumentList = firstDescendant(call, "ArgumentList");
            const arguments_ = argumentList ? directChildren(argumentList, "Expression") : [];
            if (arity && (arguments_.length < arity.minimum || arguments_.length > arity.maximum)) {
                this.add(arityCode(arity), arityMessage(name, arity), nameNode);
            }
            if (datePartFunctions.has(name) && arguments_.length > 0) {
                const argument = arguments_[0]!;
                const option = this.source(argument).trim();
                const reference = firstDescendant(argument, "ColumnReference");
                if (!reference) {
                    this.add(
                        "InvalidParameterOne",
                        `Invalid parameter 1 specified for ${name}.`,
                        argument,
                    );
                } else if (!dateParts.has(option.toLocaleUpperCase())) {
                    this.add(
                        "NotRecognizedDatePartOption",
                        `'${normalizeIdentifier(option)}' is not a recognized ${name} option.`,
                        argument,
                    );
                }
            }
            if (name === "ISJSON" && arguments_.length > 1) {
                const argument = arguments_[1]!;
                const option = normalizeIdentifier(this.source(argument).trim());
                if (!isJsonValueTypes.has(option.toLocaleUpperCase())) {
                    this.add(
                        "NotRecognizedIsJsonType",
                        `'${option}' is not a recognized ISJSON option.`,
                        argument,
                    );
                }
            }
        }
    }

    public validateCatalogFunctionArguments(): void {
        for (const call of [...this.nodes("FunctionCall"), ...this.nodes("FunctionTableSource")]) {
            const nameNode = firstDescendant(call, "MultipartIdentifier");
            if (!nameNode) continue;
            const parts = multipartIdentifierParts(this.source(nameNode));
            const resolution = this._metadata.resolveObject(parts);
            if (
                resolution.kind !== "resolved" ||
                (resolution.object.kind !== "scalarFunction" &&
                    resolution.object.kind !== "tableFunction")
            ) {
                continue;
            }
            const state = this._metadata.parameterState(resolution.object.ref);
            if (state.kind !== "loaded") continue;
            const argumentList = firstDescendant(call, "ArgumentList");
            const actual = argumentList
                ? directChildren(argumentList, "Expression").length
                : firstDescendant(call, "Star")
                  ? 1
                  : 0;
            const required = state.value.filter(
                (parameter) => parameter.hasDefault !== true,
            ).length;
            const displayName = compactMultipartName(this.source(nameNode));
            if (actual < required) {
                this.add(
                    "InsufficientArguments",
                    `An insufficient number of arguments were supplied for the procedure or function ${displayName}.`,
                    nameNode,
                );
            } else if (actual > state.value.length) {
                this.add(
                    "TooManyArguments",
                    `Procedure or function '${displayName}' has too many arguments specified.`,
                    nameNode,
                );
            }
        }
    }

    public validateOptions(): void {
        for (const hint of this.nodes("TableHint")) {
            const nameNode = firstDescendant(hint, "TableHintName");
            if (!nameNode) continue;
            const displayName = normalizeIdentifier(this.source(nameNode));
            if (validTableHintNames.has(displayName.toLocaleUpperCase())) continue;
            this.add(
                "InvalidTableHint",
                `${displayName} is not a recognized table hints option. If it is intended as a parameter to a table-valued function, ensure that your database compatibility mode is set to 90.`,
                nameNode,
            );
        }

        // A procedure or trigger WITH clause classifies each option exactly once: an unknown name
        // is unrecognized, a known module option outside the statement's option set is invalid for
        // that statement, and only an allowed option can also be reported as a repeat.
        for (const module of moduleOptionStatements) {
            for (const clause of this.nodes(module.clause)) {
                if (containsErrorNode(clause)) continue;
                const seen = new Set<string>();
                for (const option of directChildren(clause, module.option)) {
                    const name = moduleOptionDisplayName(this.source(option));
                    if (name !== "EXECUTE AS" && !recognizedModuleOptions.has(name)) {
                        this.add(
                            "OptionNotRecognized",
                            `'${name}' is not a recognized option.`,
                            option,
                        );
                    } else if (!module.allowed.has(name)) {
                        this.add(module.code, module.message, option);
                    } else if (seen.has(name)) {
                        this.add(
                            "OptionSpecifiedMultipleTimes",
                            `Option '${name}' is specified more than once.`,
                            option,
                        );
                    }
                    seen.add(name);
                }
            }
        }

        const groups: SyntaxNode[][] = [];
        for (const clause of [
            ...this.nodes("FunctionWithClause"),
            ...this.nodes("ExecuteWithClause"),
        ]) {
            groups.push(
                [...clause.children()].filter((child) =>
                    ["FunctionOption", "ExecuteOption"].includes(child.kind),
                ),
            );
        }
        for (const clause of this.nodes("ViewOptionClause")) {
            const options = directChildren(clause, "IdentifierName");
            groups.push(options);
            for (const option of options) {
                const name = normalizeIdentifier(this.source(option)).toLocaleUpperCase();
                if (viewOptions.has(name)) continue;
                if (moduleOptionNames.has(name)) {
                    this.add(
                        "InvalidOptionInCreateView",
                        'An invalid option was specified for the statement "CREATE/ALTER VIEW".',
                        option,
                    );
                } else {
                    this.add(
                        "OptionNotRecognized",
                        `'${name}' is not a recognized option.`,
                        option,
                    );
                }
            }
        }
        for (const group of groups) this.validateDuplicateOptions(group);

        for (const clause of this.nodes("LoginCreationClause")) {
            const modifiers = directChildren(clause, "LoginPasswordModifier");
            this.validateDuplicateOptions(modifiers);
            const hashed = modifiers.find((modifier) =>
                /^\s*HASHED\b/iu.test(this.source(modifier)),
            );
            if (hashed && modifiers.some((modifier) => modifier.start < hashed.start)) {
                this.add(
                    "IncorrectOptionOrder",
                    "'HASHED' is specified at incorrect location.",
                    hashed,
                );
            }
            const options = [
                ...directChildren(clause, "LoginPasswordOption"),
                ...directChildren(clause, "PrincipalOption"),
            ];
            this.validateDuplicateOptions(options);
        }
    }

    public validateCursors(): void {
        const conflictingGroups = [
            ["GLOBAL", "LOCAL"],
            ["FORWARD_ONLY", "SCROLL"],
            ["STATIC", "KEYSET", "DYNAMIC", "FAST_FORWARD"],
            ["READ_ONLY", "SCROLL_LOCKS", "OPTIMISTIC"],
        ] as const;
        for (const cursor of this.nodes("CursorDeclaration")) {
            if (containsErrorNode(cursor)) continue;
            // The ISO list precedes CURSOR and the extended list follows it. SQL Server rejects a
            // declaration that uses both, and each list accepts a different set of option names.
            const isoOptions = directChildren(cursor, "CursorIsoOption");
            const options = directChildren(cursor, "CursorOption");
            if (isoOptions.length > 0 && options.length > 0) {
                this.add(
                    "MixingOldAndNewSyntaxForCursorOptionsNotAllowed",
                    "Mixing old and new syntax to specify cursor options is not allowed.",
                    cursor,
                );
            }
            for (const option of [...isoOptions, ...options]) {
                const spelling = this.source(option).trim();
                const name = spelling.toLocaleUpperCase();
                if (!cursorOptionNames.has(name)) {
                    this.add(
                        "UnrecognizedCursorOption",
                        `'${spelling}' is not a recognized CURSOR option.`,
                        option,
                    );
                    continue;
                }
                const allowed = isoOptions.includes(option)
                    ? isoCursorOptionNames.has(name)
                    : name !== "INSENSITIVE";
                if (!allowed) {
                    this.add(
                        "InvalidUsageOfCursorOption",
                        `Invalid usage of the option '${spelling}' in the DECLARE CURSOR statement.`,
                        option,
                    );
                }
            }
            for (const group of conflictingGroups) {
                let first: { readonly name: string; readonly node: SyntaxNode } | undefined;
                for (const option of options) {
                    const name = this.source(option).trim().toLocaleUpperCase();
                    if (!group.some((candidate) => candidate === name)) continue;
                    if (!first) {
                        first = { name, node: option };
                        continue;
                    }
                    this.add(
                        "ConflictingCursorOption",
                        `Conflicting cursor options ${first.name} and ${name}.`,
                        option,
                    );
                }
            }
        }
    }

    public validateSynonyms(): void {
        for (const create of this.nodes("CreateSynonymStatement")) {
            const name = firstDescendant(create, "MultipartIdentifier");
            if (name) {
                this.validateSynonymDatabasePrefix(
                    name,
                    "DbNameIsNotAllowedForCreateSynonym",
                    "'CREATE SYNONYM' does not allow specifying the database name as a prefix to the object name.",
                );
            }
        }
        for (const drop of this.nodes("DropSynonymStatement")) {
            for (const name of descendantsOwnedBy(drop, "MultipartIdentifier", drop)) {
                this.validateSynonymDatabasePrefix(
                    name,
                    "DbNameIsNotAllowedForDropSynonym",
                    "'DROP SYNONYM' does not allow specifying the database name as a prefix to the object name.",
                );
            }
        }
    }

    private validateSynonymDatabasePrefix(name: SyntaxNode, code: string, message: string): void {
        const parts = multipartIdentifierParts(this.source(name));
        if (parts.length < 3) return;
        this.add(code, message, identifierPartRange(name, this.source(name), parts.length - 3));
    }

    private validateProjectedRelation(
        owner: SyntaxNode,
        explicitColumns: SyntaxNode | undefined,
        queryRoot: SyntaxNode,
    ): void {
        const selectList = firstDescendant(queryRoot, "SelectList");
        if (!selectList) return;
        const elements = directChildren(selectList, "SelectElement");
        if (
            elements.length === 0 ||
            elements.some(
                (element) =>
                    directChildren(element, "Star").length > 0 ||
                    firstDescendant(element, "StarExpression") !== undefined,
            )
        ) {
            return;
        }

        const displayName = projectedRelationName(this._syntax, owner);
        if (explicitColumns) {
            const names = descendants(explicitColumns, "IdentifierName");
            if (elements.length > names.length) {
                this.add(
                    "MoreColumns",
                    `'${displayName}' has more columns than specified in the column list.`,
                    owner,
                );
            } else if (elements.length < names.length) {
                this.add(
                    "FewerColumns",
                    `'${displayName}' has fewer columns than specified in the column list.`,
                    owner,
                );
            }
            return;
        }

        for (const [index, element] of elements.entries()) {
            if (projectedElementHasName(element)) continue;
            this.add(
                "MissingColumn",
                `No column was specified for column ${index + 1} of '${displayName}'.`,
                owner,
            );
        }
    }

    private joinInputColumns(join: SyntaxNode): readonly ColumnMetadata[] | undefined {
        const tableSource = ancestor(join, "TableSource");
        const query = ancestor(join, "QuerySpecification");
        if (!tableSource || !query) return undefined;
        return this.querySources(query)
            .filter(
                (source) =>
                    source.node.end <= join.start &&
                    sameNode(ancestor(source.node, "TableSource"), tableSource),
            )
            .at(-1)?.columns;
    }

    /**
     * Reports a data type name, or an XML schema collection name, that carries more prefixes than
     * SQL Server allows. Returns true when the specification is invalid and must not be validated
     * further.
     */
    private reportOverPrefixedTypeNames(
        dataType: SyntaxNode,
        parts: readonly string[],
        typeName: string,
    ): boolean {
        const nameNode = firstDescendant(dataType, "MultipartIdentifier");
        if (nameNode && parts.length > 2) {
            this.add(
                "TypeNameMaxPrefixError",
                `The type name '${compactMultipartName(this.source(nameNode))}' contains more than the maximum number of prefixes. The maximum is 1.`,
                nameNode,
            );
            return true;
        }
        if (typeName !== "xml") return false;
        const argumentList = firstDescendant(dataType, "ArgumentList");
        const collection = argumentList && firstDescendant(argumentList, "MultipartIdentifier");
        if (!collection) return false;
        const collectionName = compactMultipartName(this.source(collection));
        if (multipartIdentifierParts(collectionName).length <= 2) return false;
        this.add(
            "XmlSchemaCollectionMaxPrefixError",
            `The xml schema collection name '${collectionName}' contains more than the maximum number of prefixes. The maximum is 1.`,
            collection,
        );
        return true;
    }

    private validateDuplicateOptions(options: readonly SyntaxNode[]): void {
        const seen = new Set<string>();
        for (const option of options) {
            const name = optionName(this.source(option));
            if (!name) continue;
            if (seen.has(name)) {
                this.add(
                    "OptionSpecifiedMultipleTimes",
                    `Option '${name}' is specified more than once.`,
                    option,
                );
            }
            seen.add(name);
        }
    }

    public result(): readonly SemanticDiagnostic[] {
        return Object.freeze(
            [...this._diagnostics].sort(
                (left, right) =>
                    left.range.start - right.range.start || left.code.localeCompare(right.code),
            ),
        );
    }

    private validateRelation(node: SyntaxNode, write: boolean): void {
        const nameNode = firstDescendant(node, "MultipartIdentifier");
        if (!nameNode || this.hasSyntaxError(nameNode)) return;
        const source = compactMultipartName(this.source(nameNode));
        const parts = multipartIdentifierParts(source);
        if (parts.length === 0 || parts.at(-1)?.startsWith("@")) return;
        const database = parts.length >= 3 ? parts.at(-3)! : undefined;
        if (database && this.databaseMissing(database)) {
            this.add(
                "CouldNotLocateDatabase",
                `Could not locate entry in sysdatabases for database '${database}'. No entry found with that name. Make sure that the name is entered correctly.`,
                identifierPartRange(nameNode, this.source(nameNode), parts.length - 3),
            );
            return;
        }
        const localEvent = this.localRelationEventAt(parts, nameNode.start);
        // Session-scoped temp objects cannot be authoritatively disproved by a catalog snapshot.
        // Locally declared temp tables are still bound through the ordered document timeline.
        if (parts.at(-1)?.startsWith("#") && !localEvent?.create) return;
        if (
            node.kind === "FunctionTableSource" &&
            builtInTableFunctions.has(parts.at(-1)!.toLocaleUpperCase())
        ) {
            return;
        }
        if (node.kind === "FunctionTableSource" && this.isInstanceTableMethod(node, parts)) return;
        if (localEvent?.create || this.isCteReference(nameNode, parts)) {
            return;
        }
        // A DROP in the current document is newer than the pinned catalog generation. Do not
        // resurrect that object from stale metadata for later statements.
        if (localEvent && !localEvent.create) {
            this.add("MSSQL208", `Invalid object name '${source}'.`, nameNode);
            return;
        }
        const resolution = this._metadata.resolveObject(parts);
        if (resolution.kind === "notFound") {
            this.add("MSSQL208", `Invalid object name '${source}'.`, nameNode);
        } else if (resolution.kind === "ambiguous") {
            this.add("TableIsAmbiguous", `The table '${source}' is ambiguous.`, nameNode);
        } else if (
            resolution.kind === "resolved" &&
            write &&
            !["table", "view"].includes(resolution.object.kind)
        ) {
            if (resolution.object.kind === "tableFunction" && /\(\s*\)/u.test(this.source(node))) {
                this.add(
                    "FunctionCannotBeUsedToMatchTarget",
                    `Function call cannot be used to match a target table in the FROM clause of a DELETE or UPDATE statement. Use function name '${source}' without parameters instead.`,
                    nameNode,
                );
            } else {
                this.add(
                    "ObjectCannotBeModified",
                    `Object '${source}' cannot be modified.`,
                    nameNode,
                );
            }
        } else if (
            resolution.kind === "resolved" &&
            node.kind === "FunctionTableSource" &&
            resolution.object.kind !== "tableFunction"
        ) {
            this.add(
                "ParametersSuppliedForNonFunction",
                `Parameters supplied for object '${source}' which is not a function. If the parameters are intended as a table hint, a WITH keyword is required.`,
                nameNode,
            );
        } else if (
            resolution.kind === "resolved" &&
            node.kind === "NamedTableSource" &&
            resolution.object.kind === "tableFunction"
        ) {
            this.add(
                "ParametersNotSuppliedForFunction",
                `Parameters were not supplied for the function '${source}'.`,
                nameNode,
            );
        }
    }

    private validateColumn(
        node: SyntaxNode,
        parts: readonly string[],
        sources: readonly QuerySource[],
    ): void {
        const columnName = parts.at(-1)!;
        if (parts.length > 1) {
            const qualifier = parts.at(-2)!;
            const source = sources.find((candidate) =>
                this.equal(candidate.exposedName, qualifier),
            );
            if (!source) {
                this.add(
                    "ColumnPrefixMismatch",
                    `The column prefix '${qualifier}' does not match with a table name or alias name used in the query.`,
                    identifierPartRange(node, this.source(node), parts.length - 2),
                );
                return;
            }
            if (source.columns && !hasColumn(source.columns, columnName, this._metadata)) {
                this.add(
                    "MSSQL207",
                    `Invalid column name '${columnName}'.`,
                    lastIdentifierRange(node, this.source(node)),
                );
            }
            return;
        }

        const completeSources = sources.filter(
            (source): source is QuerySource & { readonly columns: readonly ColumnMetadata[] } =>
                source.columns !== undefined,
        );
        const maximumDepth = Math.max(0, ...sources.map(({ scopeDepth }) => scopeDepth));
        for (let depth = 0; depth <= maximumDepth; depth++) {
            const scoped = sources.filter((source) => source.scopeDepth === depth);
            if (scoped.length === 0) continue;
            const complete = completeSources.filter((source) => source.scopeDepth === depth);
            const matches = complete.filter((source) =>
                hasColumn(source.columns, columnName, this._metadata),
            );
            if (matches.length > 1) {
                this.add("MSSQL209", `Ambiguous column name '${columnName}'.`, node);
                return;
            }
            if (matches.length === 1) return;
            // An incomplete nearer scope may contain the name, so a negative result is unsafe.
            if (complete.length !== scoped.length) return;
        }
        if (sources.length > 0) this.add("MSSQL207", `Invalid column name '${columnName}'.`, node);
    }

    private validateXmlNodeColumnUse(
        node: SyntaxNode,
        parts: readonly string[],
        sources: readonly QuerySource[],
    ): void {
        const source = this.xmlNodeSourceForColumn(parts, sources);
        if (!source) return;
        const expression = ancestor(node, "Expression");
        if (
            expression &&
            /^\s+IS\s+(?:NOT\s+)?NULL\b/iu.test(this._text.slice(node.end, expression.end))
        ) {
            return;
        }
        const columnName = parts.at(-1)!;
        this.add(
            "InvalidColumnXmlNodeUse",
            `The column '${columnName}' that was returned from the nodes() method cannot be used directly. It can only be used with one of the four XML data type methods, exist(), nodes(), query(), and value(), or in IS NULL and IS NOT NULL checks.`,
            node,
        );
    }

    private validateXmlNodeStars(query: SyntaxNode, sources: readonly QuerySource[]): void {
        for (const element of descendantsOwnedBy(query, "SelectElement", query)) {
            const star = /^(?:(.+)\.)?\*$/u.exec(this.source(element).trim());
            if (!star) continue;
            const qualifier = star[1] && normalizeIdentifier(star[1]);
            for (const source of sources) {
                if (source.scopeDepth !== 0 || !this.isXmlNodesSource(source)) continue;
                if (qualifier && !this.equal(source.exposedName, qualifier)) continue;
                for (const column of source.columns ?? []) {
                    this.add(
                        "InvalidColumnXmlNodeUse",
                        `The column '${column.name}' that was returned from the nodes() method cannot be used directly. It can only be used with one of the four XML data type methods, exist(), nodes(), query(), and value(), or in IS NULL and IS NOT NULL checks.`,
                        element,
                    );
                }
            }
        }
    }

    private xmlNodeSourceForColumn(
        parts: readonly string[],
        sources: readonly QuerySource[],
    ): QuerySource | undefined {
        const columnName = parts.at(-1);
        if (!columnName) return undefined;
        const qualifier = parts.length > 1 ? parts.at(-2) : undefined;
        const matches = sources.filter(
            (source) =>
                this.isXmlNodesSource(source) &&
                (!qualifier || this.equal(source.exposedName, qualifier)) &&
                source.columns !== undefined &&
                hasColumn(source.columns, columnName, this._metadata),
        );
        return matches.length === 1 ? matches[0] : undefined;
    }

    private isXmlNodesSource(source: QuerySource): boolean {
        if (source.node.kind !== "FunctionTableSource") return false;
        const name = firstDescendant(source.node, "MultipartIdentifier");
        if (!name) return false;
        const parts = multipartIdentifierParts(this.source(name));
        return this.isInstanceTableMethod(source.node, parts);
    }

    private validateExposedNames(sources: readonly QuerySource[]): void {
        const seen = new Map<string, QuerySource>();
        for (const source of sources) {
            const key = this.fold(source.exposedName);
            const previous = seen.get(key);
            if (previous) {
                if (previous.alias && source.alias) {
                    this.add(
                        "CorrelationNameNotUnique",
                        `The correlation name '${source.exposedName}' is specified multiple times in a FROM clause.`,
                        source.exposedRange,
                    );
                } else if (previous.alias || source.alias) {
                    const alias = previous.alias ? previous : source;
                    const table = previous.alias ? source : previous;
                    this.add(
                        "InvalidCorrelationNameWithTable",
                        `The correlation name '${alias.exposedName}' has the same exposed name as table '${table.objectName}'.`,
                        alias.exposedRange,
                    );
                } else {
                    this.add(
                        "InvalidCorrelationNamesInFrom",
                        `The objects \"${previous.exposedName}\" and \"${source.exposedName}\" in the FROM clause have the same exposed names. Use correlation names to distinguish them.`,
                        source.exposedRange,
                    );
                }
            } else {
                seen.set(key, source);
            }
        }
    }

    private validateExecuteArguments(
        execute: SyntaxNode,
        procedureName: string,
        parameters: readonly ParameterMetadata[],
    ): void {
        const arguments_ = descendantsOwnedBy(execute, "ExecuteArgument", execute);
        if (parameters.length === 0 && arguments_.length > 0) {
            this.add(
                "MissingParameters",
                `Procedure ${procedureName} has no parameters and arguments were supplied.`,
                arguments_[0]!,
            );
            return;
        }
        if (arguments_.length > parameters.length) {
            this.add(
                "TooManyArguments",
                `Procedure or function '${procedureName}' has too many arguments specified.`,
                arguments_.at(-1)!,
            );
        }
        const parameterByName = new Map(
            parameters.map((parameter) => [this.fold(parameter.name), parameter]),
        );
        const supplied = new Set<string>();
        let namedSeen = false;
        for (const [index, argument] of arguments_.entries()) {
            const text = this.source(argument);
            const named = /^\s*(@[\p{L}_][\p{L}\p{N}_$#@]*)\s*=/iu.exec(text)?.[1];
            if (!named) {
                const positional = parameters[index];
                if (positional) supplied.add(this.fold(positional.name));
                if (namedSeen) {
                    this.add(
                        "InconsistentParameterFormat",
                        `Must pass parameter number ${index + 1} and subsequent parameters as '@name = value'. After the form '@name = value' has been used, all subsequent parameters must be passed in the form '@name = value'.`,
                        argument,
                    );
                }
                continue;
            }
            namedSeen = true;
            const key = this.fold(named);
            if (supplied.has(key)) {
                this.add(
                    "ParameterSuppliedMultipleTimes",
                    `Parameter '${named}' was supplied multiple times.`,
                    leadingVariableRange(argument, text),
                );
                continue;
            }
            supplied.add(key);
            const parameter = parameterByName.get(key);
            if (!parameter) {
                this.add(
                    "InvalidParameter",
                    `${named} is not a parameter for procedure ${procedureName}.`,
                    leadingVariableRange(argument, text),
                );
            } else if (/\bOUTPUT\s*$/iu.test(text) && !parameter.output) {
                this.add(
                    "OutputParameterMismatch",
                    `The formal parameter \"${named}\" was not declared as an OUTPUT parameter, but the actual parameter passed in requested output.`,
                    leadingVariableRange(argument, text),
                );
            }
        }
        for (const parameter of parameters) {
            if (
                parameter.ordinal <= 0 ||
                parameter.hasDefault !== false ||
                supplied.has(this.fold(parameter.name))
            ) {
                continue;
            }
            this.add(
                "MissingParameter",
                `Procedure or function '${procedureName}' expects parameter '${parameter.name}', which was not supplied.`,
                execute,
            );
        }
    }

    private relationColumnsAt(
        parts: readonly string[],
        offset: number,
    ): readonly ColumnMetadata[] | undefined {
        const local = this.localRelationEventAt(parts, offset);
        if (local) return local.create ? local.columns : undefined;
        const resolution = this._metadata.resolveObject(parts);
        if (resolution.kind !== "resolved") return undefined;
        return this.loadedColumns(resolution.object);
    }

    private loadedColumns(object: ObjectMetadata): readonly ColumnMetadata[] | undefined {
        const state = this._metadata.columnState(object.ref);
        return state.kind === "loaded" ? state.value : undefined;
    }

    private validateCreateObject(node: SyntaxNode): void {
        const nameNode = firstDescendant(node, "MultipartIdentifier");
        if (!nameNode) return;
        const name = compactMultipartName(this.source(nameNode));
        const parts = multipartIdentifierParts(name);
        if (parts.length >= 3 && databasePrefixedModuleKinds.has(node.kind)) return;
        if (parts.at(-1)?.startsWith("#")) return;
        if (parts.length >= 3 && this.databaseMissing(parts.at(-3)!)) {
            const database = parts.at(-3)!;
            this.add(
                "DatabaseNotExist",
                `Database '${database}' does not exist.`,
                identifierPartRange(nameNode, this.source(nameNode), parts.length - 3),
            );
            return;
        }
        if (parts.length >= 2) {
            const schemaName = parts.at(-2)!;
            const database =
                parts.length >= 3 ? parts.at(-3) : this._metadata.environment.currentDatabase;
            const schemas = this._metadata.schemas(database);
            if (
                schemas &&
                !schemas.some(
                    (schema) =>
                        this.equal(schema.name, schemaName) &&
                        (!database || !schema.database || this.equal(schema.database, database)),
                )
            ) {
                this.add(
                    "SchemaNotExist",
                    ` The specified schema name \"${schemaName}\" either does not exist or you do not have permission to use it.`,
                    identifierPartRange(nameNode, this.source(nameNode), parts.length - 2),
                );
                return;
            }
        }
        // CREATE OR ALTER intentionally accepts an existing module. Its grammar node is shared
        // with CREATE, so distinguish the header before applying the duplicate-object rule.
        if (
            !/^\s*CREATE\s+OR\s+ALTER\b/iu.test(this.source(node)) &&
            this._metadata.resolveObject(parts).kind === "resolved"
        ) {
            this.add(
                "DatabaseObjectExist",
                `There is already an object named '${name}' in the database.`,
                nameNode,
            );
        }
    }

    private validateAlterObject(node: SyntaxNode, expectedKind: DdlObjectKind): void {
        const nameNode = firstDescendant(node, "MultipartIdentifier");
        if (!nameNode) return;
        const name = compactMultipartName(this.source(nameNode));
        const parts = multipartIdentifierParts(name);
        if (parts.length >= 3 && databasePrefixedModuleKinds.has(node.kind)) return;
        const local = this.localRelationEventAt(parts, nameNode.start);
        const resolution = this._metadata.resolveObject(parts);
        if (
            (local && (!local.create || !localRelationMatchesDdlKind(local, expectedKind))) ||
            (!local &&
                (resolution.kind === "notFound" ||
                    (resolution.kind === "resolved" &&
                        !objectMatchesDdlKind(resolution.object, expectedKind))))
        ) {
            this.add(
                "CannotPerformAlterOnObject",
                `Cannot perform alter on '${name}' because it is an incompatible object type.`,
                nameNode,
            );
        }
    }

    private validateDropObject(node: SyntaxNode, expectedKind: DdlObjectKind): void {
        for (const nameNode of directOwnedDescendants(node, "MultipartIdentifier")) {
            const name = compactMultipartName(this.source(nameNode));
            const parts = multipartIdentifierParts(name);
            const local = this.localRelationEventAt(parts, nameNode.start);
            const resolution = this._metadata.resolveObject(parts);
            if ((local && !local.create) || (!local && resolution.kind === "notFound")) {
                this.add(
                    "CannotDropObject",
                    `Cannot drop the ${expectedKind} '${name}', because it does not exist or you do not have permission.`,
                    nameNode,
                );
            } else if (
                (local?.create && !localRelationMatchesDdlKind(local, expectedKind)) ||
                (!local &&
                    resolution.kind === "resolved" &&
                    !objectMatchesDdlKind(resolution.object, expectedKind))
            ) {
                const actualKind =
                    local?.kind ??
                    (resolution.kind === "resolved" ? resolution.object.kind : "object");
                this.add(
                    "CannotUseDrop",
                    `Cannot use DROP ${expectedKind.toLocaleUpperCase()} with '${name}' because '${name}' is a ${actualKind}.`,
                    nameNode,
                );
            }
        }
    }

    private querySources(query: SyntaxNode, scopeDepth = 0): readonly QuerySource[] {
        const result: QuerySource[] = [];
        for (const node of [
            ...descendantsOwnedBy(query, "NamedTableSource", query),
            ...descendantsOwnedBy(query, "FunctionTableSource", query),
            ...descendantsOwnedBy(query, "VariableTableSource", query),
            ...descendantsOwnedBy(query, "DerivedTableSource", query),
            ...descendantsOwnedBy(query, "DerivedTable", query),
            ...descendantsOwnedBy(query, "VectorSearchTableSource", query),
        ]) {
            const aliasNode = firstDescendant(node, "TableAlias");
            const aliasName = aliasNode && lastDescendant(aliasNode, "IdentifierName");
            const variable =
                node.kind === "VariableTableSource" ? firstDescendant(node, "Variable") : undefined;
            const nameNode = firstDescendant(node, "MultipartIdentifier");
            const parts = nameNode ? multipartIdentifierParts(this.source(nameNode)) : [];
            const baseName = variable
                ? this.source(variable)
                : (parts.at(-1) ?? `derived@${node.start}`);
            const exposedName = aliasName
                ? normalizeIdentifier(this.source(aliasName))
                : normalizeIdentifier(baseName);
            const exposedRange = aliasName ?? nameNode ?? variable ?? node;
            result.push({
                node,
                exposedName,
                exposedRange,
                alias: aliasName !== undefined,
                objectName: normalizeIdentifier(baseName),
                scopeDepth,
                columns: this.sourceColumns(
                    node,
                    parts,
                    variable ? this.source(variable) : undefined,
                ),
            });
        }
        return result.sort((left, right) => left.node.start - right.node.start);
    }

    private visibleQuerySources(query: SyntaxNode): readonly QuerySource[] {
        const result: QuerySource[] = [...this.querySources(query)];
        let outer = ancestor(query, "QuerySpecification");
        let scopeDepth = 1;
        while (outer) {
            result.push(...this.querySources(outer, scopeDepth));
            outer = ancestor(outer, "QuerySpecification");
            scopeDepth++;
        }
        return result;
    }

    private sourceColumns(
        source: SyntaxNode,
        parts: readonly string[],
        variableName?: string,
    ): readonly ColumnMetadata[] | undefined {
        if (source.kind === "VariableTableSource" && variableName) {
            return this.variableAt(variableName, source.start, true)?.columns;
        }
        if (source.kind === "VectorSearchTableSource") {
            const tableArgument = firstDescendant(source, "VectorSearchTableArgument");
            const tableName =
                tableArgument && firstDescendant(tableArgument, "MultipartIdentifier");
            const tableParts = tableName ? multipartIdentifierParts(this.source(tableName)) : [];
            const resolution = this._metadata.resolveObject(tableParts);
            const state =
                resolution.kind === "resolved"
                    ? this._metadata.columnState(resolution.object.ref)
                    : undefined;
            return [
                ...(state?.kind === "loaded" ? state.value : []),
                { name: "distance", typeDisplay: "float", nullable: false },
            ];
        }
        if (source.kind === "DerivedTableSource" || source.kind === "DerivedTable") {
            return projectedColumns(this._syntax, source);
        }
        if (source.kind === "FunctionTableSource") {
            const builtIn = parts.at(-1)?.toLocaleUpperCase();
            if (builtIn === "OPENJSON") {
                const withClause = firstDescendant(source, "OpenJsonWithClause");
                return withClause
                    ? definitionColumns(this._syntax, withClause)
                    : [
                          { name: "key", typeDisplay: "nvarchar(4000)" },
                          { name: "value", typeDisplay: "nvarchar(max)" },
                          { name: "type", typeDisplay: "int" },
                      ];
            }
            if (builtIn === "NODES") {
                const names = firstDescendant(source, "ColumnNameList");
                const columns = names
                    ? descendants(names, "IdentifierName").map((name) => ({
                          name: normalizeIdentifier(this.source(name)),
                          typeDisplay: "xml",
                      }))
                    : [];
                return columns.length > 0 ? columns : undefined;
            }
        }
        const local = this.localRelationEventAt(parts, source.start);
        if (local) return local.create ? local.columns : undefined;
        if (this.isCteReference(source, parts)) {
            const statement = ancestor(source, "Statement");
            const cte =
                statement && findCte(this._syntax, statement, parts.at(-1)!, this._metadata);
            return cte ? projectedColumns(this._syntax, cte) : undefined;
        }
        const resolution = this._metadata.resolveObject(parts);
        if (resolution.kind !== "resolved") return undefined;
        const state = this._metadata.columnState(resolution.object.ref);
        return state.kind === "loaded" ? state.value : undefined;
    }

    private localRelationEventAt(
        parts: readonly string[],
        offset: number,
    ): LocalRelationEvent | undefined {
        return lastEventAt(this._localRelations.get(objectNameKey(parts, this._metadata)), offset);
    }

    private localProcedureAt(
        parts: readonly string[],
        offset: number,
    ): LocalProcedureEvent | undefined {
        const event = lastEventAt(
            this._localProcedures.get(objectNameKey(parts, this._metadata)),
            offset,
        );
        return event?.create ? event : undefined;
    }

    private userTypeAt(parts: readonly string[], offset: number): UserTypeResolution {
        const catalog = this._metadata.resolveObject(parts);
        let state: UserTypeResolution;
        if (catalog.kind === "resolved") {
            state =
                catalog.object.kind === "type" && catalog.object.typeCategory
                    ? { kind: "resolved", typeCategory: catalog.object.typeCategory }
                    : { kind: "notFound" };
        } else if (catalog.kind === "notFound") {
            state = { kind: "notFound" };
        } else {
            state = { kind: "unknown" };
        }
        const event = lastEventAt(
            this._localTypes.get(objectNameKey(parts, this._metadata)),
            offset,
        );
        if (event) {
            state = event.create
                ? { kind: "resolved", typeCategory: event.typeCategory }
                : { kind: "notFound" };
        }
        return state;
    }

    private isInstanceTableMethod(node: SyntaxNode, parts: readonly string[]): boolean {
        if (parts.at(-1)?.toLocaleUpperCase() !== "NODES" || parts.length < 2) return false;
        const query = ancestor(node, "QuerySpecification");
        if (!query) return false;
        const receiver = parts.slice(0, -1);
        const columnName = receiver.at(-1)!;
        const qualifier = receiver.length > 1 ? receiver.at(-2) : undefined;
        return this.visibleQuerySources(query).some(
            (source) =>
                !sameNode(source.node, node) &&
                (!qualifier || this.equal(source.exposedName, qualifier)) &&
                source.columns !== undefined &&
                hasColumn(source.columns, columnName, this._metadata),
        );
    }

    private variableAt(
        name: string,
        offset: number,
        requireTable: boolean,
    ): VariableDeclaration | undefined {
        const scope = scopeAt(this._syntax.root(), offset);
        return this._variableDeclarations.find(
            (declaration) =>
                declaration.node.start <= offset &&
                declaration.scope === nodeKey(scope) &&
                this.equal(declaration.name, name) &&
                (!requireTable || declaration.columns !== undefined),
        );
    }

    private isCteReference(node: SyntaxNode, parts: readonly string[]): boolean {
        if (parts.length !== 1) return false;
        const statement = ancestor(node, "Statement");
        return Boolean(statement && findCte(this._syntax, statement, parts[0]!, this._metadata));
    }

    private source(node: TextRange): string {
        return this._text.slice(node.start, node.end);
    }

    private nodes(kind: string): readonly SyntaxNode[] {
        const nodes = this._index.get(kind) ?? [];
        if (!this._validationRanges) return nodes;
        return nodes.filter((node) => this.inValidationRange(node));
    }

    private fold(value: string): string {
        return this._metadata.environment.caseSensitive
            ? normalizeIdentifier(value)
            : normalizeIdentifier(value).toLocaleLowerCase();
    }

    private equal(left: string, right: string): boolean {
        return this.fold(left) === this.fold(right);
    }

    private databaseMissing(name: string): boolean {
        const databases = this._metadata.databases();
        return Boolean(databases && !databases.some((database) => this.equal(database.name, name)));
    }

    private principal(name: string, kinds: readonly SqlPrincipalKind[]) {
        return this._metadata
            .searchPrincipals({
                database: this._metadata.environment.currentDatabase,
                prefix: name,
                kinds,
                limit: 20,
            })
            .find((candidate) => this.equal(candidate.name, name));
    }

    private principalExistsAt(
        name: string,
        kinds: readonly SqlPrincipalKind[],
        offset: number,
    ): boolean {
        let exists = Boolean(this.principal(name, kinds));
        if (!kinds.includes("login")) return exists;
        const event = lastEventAt(this._localLogins.get(this.fold(name)), offset);
        if (event) exists = event.create;
        return exists;
    }

    private hasSyntaxError(range: TextRange): boolean {
        return this._syntax.diagnostics.some(
            (diagnostic) =>
                diagnostic.range.start < range.end && range.start < diagnostic.range.end,
        );
    }

    private add(code: string, message: string, range: TextRange): void {
        if (!this.inValidationRange(range)) return;
        const key = `${code}:${range.start}:${range.end}:${message}`;
        if (this._seen.has(key)) return;
        this._seen.add(key);
        this._diagnostics.push({ code, message, severity: "error", range: freezeRange(range) });
    }

    private inValidationRange(range: TextRange): boolean {
        return (
            !this._validationRanges ||
            this._validationRanges.some(
                (candidate) => candidate.start <= range.start && range.end <= candidate.end,
            )
        );
    }
}

function principalKinds(kind: string): readonly SqlPrincipalKind[] {
    if (kind === "LOGIN") return ["login"];
    if (kind === "USER") return ["user"];
    return ["databaseRole", "applicationRole"];
}

interface QuerySource {
    readonly node: SyntaxNode;
    readonly exposedName: string;
    readonly exposedRange: TextRange;
    readonly alias: boolean;
    readonly objectName: string;
    readonly scopeDepth: number;
    readonly columns?: readonly ColumnMetadata[];
}

interface NamedNode {
    readonly name: string;
    readonly node: SyntaxNode;
}

interface LocalRelationEvent {
    readonly offset: number;
    readonly create: boolean;
    readonly parts: readonly string[];
    readonly kind: "table" | "view" | "tableFunction" | "synonym";
    /** Undefined means the object is known to exist but its projected shape is not authoritative. */
    readonly columns?: readonly ColumnMetadata[];
}

interface LocalProcedureEvent {
    readonly offset: number;
    readonly create: boolean;
    readonly parts: readonly string[];
    readonly parameters: readonly ParameterMetadata[];
}

interface LocalLoginEvent {
    readonly offset: number;
    readonly create: boolean;
    readonly name: string;
}

interface LocalTypeEvent {
    readonly offset: number;
    readonly create: boolean;
    readonly parts: readonly string[];
    readonly typeCategory: "alias" | "clr" | "table";
}

type UserTypeResolution =
    | { readonly kind: "resolved"; readonly typeCategory: "alias" | "clr" | "table" }
    | { readonly kind: "notFound" }
    | { readonly kind: "unknown" };

interface VariableDeclaration {
    readonly name: string;
    readonly node: TextRange;
    readonly scope: string;
    readonly columns?: readonly ColumnMetadata[];
}

type DdlObjectKind = "table" | "view" | "procedure" | "function";

interface DdlRule {
    readonly create: string;
    readonly alter: string;
    readonly drop: string;
    readonly kind: DdlObjectKind;
}

interface FunctionArity {
    readonly minimum: number;
    readonly maximum: number;
}

function indexObjectEvents<
    T extends { readonly offset: number; readonly parts: readonly string[] },
>(events: readonly T[], metadata: MetadataView): ReadonlyMap<string, readonly T[]> {
    const result = new Map<string, T[]>();
    for (const event of events) {
        const key = objectNameKey(event.parts, metadata);
        const timeline = result.get(key) ?? [];
        timeline.push(event);
        result.set(key, timeline);
    }
    return new Map([...result].map(([key, timeline]) => [key, Object.freeze(timeline)]));
}

function indexLoginEvents(
    events: readonly LocalLoginEvent[],
    metadata: MetadataView,
): ReadonlyMap<string, readonly LocalLoginEvent[]> {
    const result = new Map<string, LocalLoginEvent[]>();
    for (const event of events) {
        const key = foldName(event.name, metadata);
        const timeline = result.get(key) ?? [];
        timeline.push(event);
        result.set(key, timeline);
    }
    return new Map([...result].map(([key, timeline]) => [key, Object.freeze(timeline)]));
}

function lastEventAt<T extends { readonly offset: number }>(
    events: readonly T[] | undefined,
    offset: number,
): T | undefined {
    if (!events || events.length === 0) return undefined;
    let low = 0;
    let high = events.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (events[middle]!.offset <= offset) low = middle + 1;
        else high = middle;
    }
    return low === 0 ? undefined : events[low - 1];
}

function collectLocalRelationEvents(
    syntax: SyntaxSnapshot,
    index: ReadonlyMap<string, readonly SyntaxNode[]>,
): readonly LocalRelationEvent[] {
    const events: LocalRelationEvent[] = [];
    for (const node of index.get("CreateTableStatement") ?? []) {
        const name = firstDescendant(node, "MultipartIdentifier");
        const definition = firstDescendant(node, "TableDefinition");
        if (!name) continue;
        const projected = definition ? undefined : projectedColumns(syntax, node);
        events.push({
            offset: node.end,
            create: true,
            kind: "table",
            parts: multipartIdentifierParts(syntax.document.text.slice(name.start, name.end)),
            ...(definition
                ? { columns: definitionColumns(syntax, definition) }
                : projected && projected.length > 0
                  ? { columns: projected }
                  : {}),
        });
    }
    for (const kind of ["CreateViewStatement", "CreateMaterializedViewStatement"] as const) {
        for (const node of index.get(kind) ?? []) {
            const name = firstDescendant(node, "MultipartIdentifier");
            if (!name) continue;
            const columns = projectedColumns(syntax, node);
            events.push({
                offset: node.end,
                create: true,
                kind: "view",
                parts: multipartIdentifierParts(syntax.document.text.slice(name.start, name.end)),
                ...(columns.length > 0 ? { columns } : {}),
            });
        }
    }
    for (const kind of ["CreateFunctionStatement"] as const) {
        for (const node of index.get(kind) ?? []) {
            const name = firstDescendant(node, "MultipartIdentifier");
            const returnType = firstDescendant(node, "FunctionTableReturnType");
            if (!name || !returnType) continue;
            const definition = firstDescendant(returnType, "TableDefinition");
            const projected = definition ? undefined : projectedColumns(syntax, node);
            events.push({
                offset: node.end,
                create: true,
                kind: "tableFunction",
                parts: multipartIdentifierParts(syntax.document.text.slice(name.start, name.end)),
                ...(definition
                    ? { columns: definitionColumns(syntax, definition) }
                    : projected && projected.length > 0
                      ? { columns: projected }
                      : {}),
            });
        }
    }
    for (const node of index.get("CreateExternalTableStatement") ?? []) {
        const name = firstDescendant(node, "MultipartIdentifier");
        const definition = firstDescendant(node, "TableDefinition");
        if (!name) continue;
        const projected = definition ? undefined : projectedColumns(syntax, node);
        events.push({
            offset: node.end,
            create: true,
            kind: "table",
            parts: multipartIdentifierParts(syntax.document.text.slice(name.start, name.end)),
            ...(definition
                ? { columns: definitionColumns(syntax, definition) }
                : projected && projected.length > 0
                  ? { columns: projected }
                  : {}),
        });
    }
    for (const node of index.get("CreateSynonymStatement") ?? []) {
        const name = firstDescendant(node, "MultipartIdentifier");
        if (!name) continue;
        events.push({
            offset: node.end,
            create: true,
            kind: "synonym",
            parts: multipartIdentifierParts(syntax.document.text.slice(name.start, name.end)),
        });
    }
    for (const into of index.get("IntoClause") ?? []) {
        const name = firstDescendant(into, "MultipartIdentifier");
        const select = ancestor(into, "SelectStatement");
        if (!name || !select) continue;
        const columns = projectedColumns(syntax, select);
        events.push({
            offset: select.end,
            create: true,
            kind: "table",
            parts: multipartIdentifierParts(syntax.document.text.slice(name.start, name.end)),
            ...(columns.length > 0 ? { columns } : {}),
        });
    }
    for (const kind of [
        "DropTableStatement",
        "DropViewStatement",
        "DropFunctionStatement",
        "DropExternalTableStatement",
        "DropSynonymStatement",
    ] as const) {
        for (const node of index.get(kind) ?? []) {
            for (const name of descendantsOwnedBy(node, "MultipartIdentifier", node)) {
                events.push({
                    offset: node.end,
                    create: false,
                    kind: dropRelationKind(kind),
                    parts: multipartIdentifierParts(
                        syntax.document.text.slice(name.start, name.end),
                    ),
                });
            }
        }
    }
    return Object.freeze(events.sort((left, right) => left.offset - right.offset));
}

function dropRelationKind(syntaxKind: string): LocalRelationEvent["kind"] {
    if (syntaxKind === "DropViewStatement") return "view";
    if (syntaxKind === "DropFunctionStatement") return "tableFunction";
    if (syntaxKind === "DropSynonymStatement") return "synonym";
    return "table";
}

function localRelationMatchesDdlKind(event: LocalRelationEvent, expected: DdlObjectKind): boolean {
    if (expected === "function") return event.kind === "tableFunction";
    return event.kind === expected;
}

function collectLocalProcedureEvents(
    syntax: SyntaxSnapshot,
    index: ReadonlyMap<string, readonly SyntaxNode[]>,
): readonly LocalProcedureEvent[] {
    const events: LocalProcedureEvent[] = [];
    for (const kind of ["CreateProcedureStatement", "AlterProcedureStatement"] as const) {
        for (const node of index.get(kind) ?? []) {
            const name = firstDescendant(node, "MultipartIdentifier");
            if (!name) continue;
            events.push({
                offset: node.end,
                create: true,
                parts: multipartIdentifierParts(syntax.document.text.slice(name.start, name.end)),
                parameters: descendantsOwnedBy(node, "ProcedureParameter", node).map(
                    (parameter, index) => {
                        const variable = firstDescendant(parameter, "Variable");
                        const dataType = firstDescendant(parameter, "DataType");
                        const source = syntax.document.text.slice(parameter.start, parameter.end);
                        return {
                            ordinal: index + 1,
                            name: variable
                                ? syntax.document.text.slice(variable.start, variable.end)
                                : `@parameter${index + 1}`,
                            ...(dataType
                                ? {
                                      typeDisplay: syntax.document.text.slice(
                                          dataType.start,
                                          dataType.end,
                                      ),
                                  }
                                : {}),
                            output: /\b(?:OUT|OUTPUT)\s*$/iu.test(source),
                            hasDefault: /=/u.test(source),
                        };
                    },
                ),
            });
        }
    }
    for (const node of index.get("DropProcedureStatement") ?? []) {
        const name = firstDescendant(node, "MultipartIdentifier");
        if (!name) continue;
        events.push({
            offset: node.end,
            create: false,
            parts: multipartIdentifierParts(syntax.document.text.slice(name.start, name.end)),
            parameters: [],
        });
    }
    return Object.freeze(events.sort((left, right) => left.offset - right.offset));
}

function collectLocalLoginEvents(
    syntax: SyntaxSnapshot,
    index: ReadonlyMap<string, readonly SyntaxNode[]>,
): readonly LocalLoginEvent[] {
    const events: LocalLoginEvent[] = [];
    for (const kind of ["CreatePrincipalStatement", "DropPrincipalStatement"] as const) {
        for (const node of index.get(kind) ?? []) {
            const statement = node.parent();
            if (statement?.kind !== "Statement" || statement.parent()?.kind !== "Batch") continue;
            const source = syntax.document.text.slice(node.start, node.end);
            const operation = /^\s*(CREATE|DROP)\s+LOGIN\b/iu.exec(source)?.[1];
            const nameNode = firstDescendant(node, "IdentifierName");
            if (!operation || !nameNode) continue;
            events.push({
                offset: node.end,
                create: operation.toLocaleUpperCase() === "CREATE",
                name: normalizeIdentifier(syntax.document.text.slice(nameNode.start, nameNode.end)),
            });
        }
    }
    return Object.freeze(events.sort((left, right) => left.offset - right.offset));
}

function collectLocalTypeEvents(
    syntax: SyntaxSnapshot,
    index: ReadonlyMap<string, readonly SyntaxNode[]>,
): readonly LocalTypeEvent[] {
    const events: LocalTypeEvent[] = [];
    for (const node of index.get("CreateTypeStatement") ?? []) {
        const name = firstDescendant(node, "MultipartIdentifier");
        if (!name) continue;
        const source = syntax.document.text.slice(node.start, node.end);
        events.push({
            offset: node.end,
            create: true,
            parts: multipartIdentifierParts(syntax.document.text.slice(name.start, name.end)),
            typeCategory: /\bAS\s+TABLE\b/iu.test(source)
                ? "table"
                : /\bEXTERNAL\s+NAME\b/iu.test(source)
                  ? "clr"
                  : "alias",
        });
    }
    for (const node of index.get("DropTypeStatement") ?? []) {
        for (const name of descendantsOwnedBy(node, "MultipartIdentifier", node)) {
            events.push({
                offset: node.end,
                create: false,
                parts: multipartIdentifierParts(syntax.document.text.slice(name.start, name.end)),
                typeCategory: "alias",
            });
        }
    }
    return Object.freeze(events.sort((left, right) => left.offset - right.offset));
}

function collectVariableDeclarations(
    syntax: SyntaxSnapshot,
    index: ReadonlyMap<string, readonly SyntaxNode[]>,
): readonly VariableDeclaration[] {
    const declarations = [
        ...(index.get("VariableDeclaration") ?? []),
        ...(index.get("ProcedureParameter") ?? []),
    ]
        .map((declaration): VariableDeclaration | undefined => {
            const variable = firstDescendant(declaration, "Variable");
            if (!variable) return undefined;
            const definition = firstDescendant(declaration, "TableDefinition");
            return {
                name: syntax.document.text.slice(variable.start, variable.end),
                node: variable,
                scope: nodeKey(scopeAt(syntax.root(), declaration.start)),
                ...(definition ? { columns: definitionColumns(syntax, definition) } : {}),
            };
        })
        .filter((value): value is VariableDeclaration => value !== undefined);

    // Recovery nodes retain statement text that the procedural scanner could not split. Preserve
    // declarations from that text so later references do not become phantom undeclared-variable
    // errors while the parser still exposes the unsupported region explicitly.
    for (const opaque of index.get("OpaqueSqlStatement") ?? []) {
        const source = syntax.document.text.slice(opaque.start, opaque.end);
        for (const match of source.matchAll(/\bDECLARE\s+(@[\p{L}_][\p{L}\p{N}_$#@]*)/giu)) {
            if (match.index === undefined) continue;
            const relativeStart = match.index + match[0].lastIndexOf(match[1]!);
            const start = opaque.start + relativeStart;
            const end = start + match[1]!.length;
            if (declarations.some(({ node }) => node.start === start && node.end === end)) continue;
            declarations.push({
                name: match[1]!,
                node: { start, end },
                scope: nodeKey(scopeAt(syntax.root(), start)),
            });
        }
    }
    return Object.freeze(declarations.sort((left, right) => left.node.start - right.node.start));
}

function indexSyntax(root: SyntaxNode): ReadonlyMap<string, readonly SyntaxNode[]> {
    const mutable = new Map<string, SyntaxNode[]>();
    const pending = [root];
    while (pending.length > 0) {
        const node = pending.pop()!;
        const nodes = mutable.get(node.kind) ?? [];
        nodes.push(node);
        mutable.set(node.kind, nodes);
        const children = [...node.children()];
        for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]!);
    }
    return mutable;
}

function definitionColumns(syntax: SyntaxSnapshot, root: SyntaxNode): readonly ColumnMetadata[] {
    const columns = directOwnedDescendants(root, "ColumnDefinition").flatMap((column) => {
        const name = firstDescendant(column, "IdentifierName");
        if (!name) return [];
        const type = firstDescendant(column, "DataType");
        const source = syntax.document.text.slice(column.start, column.end);
        return [
            {
                name: normalizeIdentifier(syntax.document.text.slice(name.start, name.end)),
                ...(type ? { typeDisplay: syntax.document.text.slice(type.start, type.end) } : {}),
                nullable: !/\bNOT\s+NULL\b/iu.test(source),
                identity: /\bIDENTITY\b/iu.test(source),
                computed: type === undefined && /\bAS\b/iu.test(source),
            },
        ];
    });
    const primaryKeyNames: string[] = [];
    for (const column of directOwnedDescendants(root, "ColumnDefinition")) {
        if (!/\bPRIMARY\s+KEY\b/iu.test(syntax.document.text.slice(column.start, column.end))) {
            continue;
        }
        const name = firstDescendant(column, "IdentifierName");
        if (name) {
            primaryKeyNames.push(
                normalizeIdentifier(syntax.document.text.slice(name.start, name.end)),
            );
        }
    }
    for (const constraint of directOwnedDescendants(root, "TableConstraint")) {
        if (
            !/\bPRIMARY\s+KEY\b/iu.test(
                syntax.document.text.slice(constraint.start, constraint.end),
            )
        ) {
            continue;
        }
        const list = firstDescendant(constraint, "ColumnNameList");
        if (!list) continue;
        primaryKeyNames.push(
            ...descendants(list, "IdentifierName").map((name) =>
                normalizeIdentifier(syntax.document.text.slice(name.start, name.end)),
            ),
        );
    }
    return columns.map((column) => {
        const ordinal = primaryKeyNames.findIndex(
            (name) => name.toLocaleLowerCase() === column.name.toLocaleLowerCase(),
        );
        return ordinal < 0 ? column : { ...column, primaryKeyOrdinal: ordinal + 1 };
    });
}

function projectedColumns(syntax: SyntaxSnapshot, root: SyntaxNode): readonly ColumnMetadata[] {
    const explicit = firstDescendant(root, "ColumnNameList");
    if (explicit) {
        return descendants(explicit, "IdentifierName").map((node) => ({
            name: normalizeIdentifier(syntax.document.text.slice(node.start, node.end)),
        }));
    }
    const selectList = firstDescendant(root, "SelectList");
    if (!selectList) return [];
    return directOwnedDescendants(selectList, "SelectElement").flatMap((element) => {
        const alias = lastDescendant(element, "IdentifierName");
        if (!alias) return [];
        return [{ name: normalizeIdentifier(syntax.document.text.slice(alias.start, alias.end)) }];
    });
}

function projectedRelationName(syntax: SyntaxSnapshot, owner: SyntaxNode): string {
    const source = syntax.document.text.slice(owner.start, owner.end);
    return owner.kind === "MultipartIdentifier"
        ? compactMultipartName(source)
        : normalizeIdentifier(source);
}

function projectedElementHasName(element: SyntaxNode): boolean {
    if (
        directChildren(element, "IdentifierName").length > 0 ||
        directChildren(element, "StringLiteral").length > 0 ||
        directChildren(element, "LegacyStringAlias").length > 0
    ) {
        return true;
    }
    const expression = directChildren(element, "Expression")[0];
    const column = expression && firstDescendant(expression, "ColumnReference");
    return Boolean(
        expression && column && expression.start === column.start && expression.end === column.end,
    );
}

function tableOperatorAlias(
    syntax: SyntaxSnapshot,
    operator: SyntaxNode,
    fallback: string,
): string {
    const alias = directChildren(operator, "TableAlias")[0];
    const name = alias && lastDescendant(alias, "IdentifierName");
    return name ? normalizeIdentifier(syntax.document.text.slice(name.start, name.end)) : fallback;
}

function selectAliases(syntax: SyntaxSnapshot, query: SyntaxNode): ReadonlySet<string> {
    const aliases = new Set<string>();
    const selectList = firstDescendant(query, "SelectList");
    if (!selectList) return aliases;
    for (const element of directOwnedDescendants(selectList, "SelectElement")) {
        const text = syntax.document.text.slice(element.start, element.end);
        const match = /\bAS\s+(\[[^\]]+\]|"(?:[^"]|"")+"|[\p{L}_][\p{L}\p{N}_$#@]*)\s*$/iu.exec(
            text,
        );
        if (match) aliases.add(normalizeIdentifier(match[1]!).toLocaleLowerCase());
    }
    return aliases;
}

function tableDefinitionOwner(syntax: SyntaxSnapshot, definition: SyntaxNode): string {
    const create = ancestor(definition, "CreateTableStatement");
    const variable = ancestor(definition, "VariableDeclaration");
    const name = create
        ? firstDescendant(create, "MultipartIdentifier")
        : variable
          ? firstDescendant(variable, "Variable")
          : undefined;
    return name ? compactMultipartName(syntax.document.text.slice(name.start, name.end)) : "table";
}

function foreignKeyConstraintName(
    syntax: SyntaxSnapshot,
    constraint: SyntaxNode | undefined,
): string {
    if (!constraint) return "";
    const source = syntax.document.text.slice(constraint.start, constraint.end);
    const match =
        /\bCONSTRAINT\s+(\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*"|[\p{L}_][\p{L}\p{N}_$#@]*)/iu.exec(
            source,
        );
    return normalizeIdentifier(match?.[1] ?? "");
}

function foreignKeyReferencingColumns(reference: SyntaxNode): readonly SyntaxNode[] {
    const tableConstraint = ancestor(reference, "TableConstraint");
    if (tableConstraint) {
        const list = descendants(tableConstraint, "ColumnNameList").find(
            (candidate) => candidate.end <= reference.start,
        );
        return list ? descendants(list, "IdentifierName") : [];
    }
    const column = ancestor(reference, "ColumnDefinition");
    const name = column && firstDescendant(column, "IdentifierName");
    return name ? [name] : [];
}

function foreignKeyBaseType(typeDisplay: string | undefined): string | undefined {
    if (!typeDisplay) return undefined;
    const parsed = parseDataType(typeDisplay);
    if (!parsed) return undefined;
    const aliases: Readonly<Record<string, string>> = {
        dec: "decimal",
        double: "float",
        integer: "int",
        national: "nchar",
        rowversion: "timestamp",
    };
    const name = aliases[parsed.name] ?? parsed.name;
    return systemDataTypes.has(name) ? name : undefined;
}

function scopeAt(root: SyntaxNode, offset: number): SyntaxNode {
    let current: SyntaxNode | undefined = deepestContaining(root, offset);
    let batch: SyntaxNode | undefined;
    while (current) {
        if (current.kind === "CreateProcedureStatement") return current;
        // BEGIN/END bodies contain parser Batch nodes, but T-SQL variables remain scoped to the
        // surrounding GO batch. Retain the outermost batch unless a module scope is encountered.
        if (current.kind === "Batch") batch = current;
        current = current.parent();
    }
    return batch ?? root;
}

function deepestContaining(node: SyntaxNode, offset: number): SyntaxNode {
    for (const child of node.children()) {
        if (child.start <= offset && offset <= child.end) return deepestContaining(child, offset);
    }
    return node;
}

function findCte(
    syntax: SyntaxSnapshot,
    statement: SyntaxNode,
    name: string,
    metadata: MetadataView,
): SyntaxNode | undefined {
    return descendants(statement, "CommonTableExpression").find((cte) => {
        const nameNode = firstDescendant(cte, "IdentifierName");
        if (!nameNode) return false;
        const candidate = normalizeIdentifier(
            syntax.document.text.slice(nameNode.start, nameNode.end),
        );
        return equalName(candidate, name, metadata);
    });
}

function sameObjectName(
    left: readonly string[],
    right: readonly string[],
    metadata: MetadataView,
): boolean {
    return objectNameKey(left, metadata) === objectNameKey(right, metadata);
}

function objectNameKey(parts: readonly string[], metadata: MetadataView): string {
    const name = normalizeIdentifier(parts.at(-1) ?? "");
    if (name.startsWith("#")) return foldName(name, metadata);
    const schema =
        parts.length >= 2 ? normalizeIdentifier(parts.at(-2)!) : metadata.environment.defaultSchema;
    const database =
        parts.length >= 3
            ? normalizeIdentifier(parts.at(-3)!)
            : (metadata.environment.currentDatabase ?? "");
    return [database, schema, name].map((part) => foldName(part, metadata)).join("\0");
}

function foldName(value: string, metadata: MetadataView): string {
    const normalized = normalizeIdentifier(value);
    return metadata.environment.caseSensitive ? normalized : normalized.toLocaleLowerCase();
}

function hasColumn(
    columns: readonly ColumnMetadata[],
    name: string,
    metadata: MetadataView,
): boolean {
    return columns.some((column) => equalName(column.name, name, metadata));
}

function equalName(left: string, right: string, metadata: MetadataView): boolean {
    const a = normalizeIdentifier(left);
    const b = normalizeIdentifier(right);
    return metadata.environment.caseSensitive
        ? a === b
        : a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

function objectMatchesDdlKind(object: ObjectMetadata, expected: DdlObjectKind): boolean {
    return expected === "function"
        ? object.kind === "scalarFunction" || object.kind === "tableFunction"
        : object.kind === expected;
}

function firstDescendant(node: SyntaxNode, kind: string): SyntaxNode | undefined {
    for (const child of node.children()) {
        if (child.kind === kind) return child;
        const nested = firstDescendant(child, kind);
        if (nested) return nested;
    }
    return undefined;
}

function lastDescendant(node: SyntaxNode, kind: string): SyntaxNode | undefined {
    let result: SyntaxNode | undefined;
    visit(node, (candidate) => {
        if (candidate.kind === kind) result = candidate;
    });
    return result;
}

function descendants(node: SyntaxNode, kind: string): SyntaxNode[] {
    const result: SyntaxNode[] = [];
    visit(node, (candidate) => {
        if (candidate !== node && candidate.kind === kind) result.push(candidate);
    });
    return result;
}

function directChildren(node: SyntaxNode, kind: string): SyntaxNode[] {
    return [...node.children()].filter((child) => child.kind === kind);
}

function descendantsOwnedBy(node: SyntaxNode, kind: string, owner: SyntaxNode): SyntaxNode[] {
    return descendants(node, kind).filter((candidate) =>
        sameNode(nearestAncestor(candidate, owner.kind), owner),
    );
}

function directOwnedDescendants(node: SyntaxNode, kind: string): SyntaxNode[] {
    return descendants(node, kind).filter((candidate) =>
        sameNode(nearestAncestor(candidate, node.kind), node),
    );
}

function ancestor(node: SyntaxNode, kind: string): SyntaxNode | undefined {
    for (let current = node.parent(); current; current = current.parent()) {
        if (current.kind === kind) return current;
    }
    return undefined;
}

function nearestAncestor(node: SyntaxNode, kind: string): SyntaxNode | undefined {
    return ancestor(node, kind);
}

function sameNode(left: SyntaxNode | undefined, right: SyntaxNode | undefined): boolean {
    return Boolean(
        left &&
            right &&
            left.kind === right.kind &&
            left.start === right.start &&
            left.end === right.end,
    );
}

function selectElementAssignsVariable(source: string): boolean {
    return /^\s*@(?:[\p{L}_]|[^\u0000-\u007f])(?:[\p{L}\p{N}_$#@]|[^\u0000-\u007f])*\s*(?:=|\+=|-=|\*=|\/=|%=|&=|\|=|\^=)/u.test(
        source,
    );
}

function nodeKey(node: SyntaxNode): string {
    return `${node.kind}:${node.start}:${node.end}`;
}

function visit(node: SyntaxNode, callback: (node: SyntaxNode) => void): void {
    callback(node);
    for (const child of node.children()) visit(child, callback);
}

function compactMultipartName(value: string): string {
    return value.replace(/\s*\.\s*/gu, ".").trim();
}

/** Canonical display name for one module option, matching how SQL Server names it in messages. */
function moduleOptionDisplayName(source: string): string {
    const value = source.trim();
    if (/^EXECUTE\s+AS\b/iu.test(value)) return "EXECUTE AS";
    return normalizeIdentifier(value).toLocaleUpperCase();
}

function containsErrorNode(node: SyntaxNode): boolean {
    if (node.error) return true;
    for (const child of node.children()) {
        if (containsErrorNode(child)) return true;
    }
    return false;
}

function moduleOptionKey(value: string): string {
    const normalized = value.trim().replace(/\s+/gu, " ").toLocaleUpperCase();
    if (normalized.startsWith("EXECUTE AS ")) return "EXECUTE AS";
    if (normalized.startsWith("RETURNS NULL ON NULL INPUT")) return "RETURNS NULL ON NULL INPUT";
    if (normalized.startsWith("CALLED ON NULL INPUT")) return "CALLED ON NULL INPUT";
    return normalized;
}

function moduleBodyStatements(module: SyntaxNode): readonly SyntaxNode[] {
    const body = firstDescendant(module, "ModuleBody");
    const script = body && directChildren(body, "Script")[0];
    const batch = script && directChildren(script, "Batch")[0];
    const outer = batch ? directChildren(batch, "Statement") : [];
    if (outer.length !== 1) return outer;
    const block = firstDescendant(outer[0]!, "BeginControlStatement");
    const nestedScript = block && directChildren(block, "Script")[0];
    const nestedBatch = nestedScript && directChildren(nestedScript, "Batch")[0];
    return nestedBatch ? directChildren(nestedBatch, "Statement") : outer;
}

function statementsInModule(module: SyntaxNode): readonly SyntaxNode[] {
    return descendants(module, "Statement").filter(
        (statement) =>
            directChildren(statement, "ReturnStatement").length > 0 ||
            directChildren(statement, "SelectStatement").length > 0,
    );
}

function selectReturnsClientData(syntax: SyntaxSnapshot, select: SyntaxNode): boolean {
    const list = firstDescendant(select, "SelectList");
    if (!list) return true;
    const elements = directChildren(list, "SelectElement");
    return (
        elements.length === 0 ||
        elements.some(
            (element) =>
                !selectElementAssignsVariable(
                    syntax.document.text.slice(element.start, element.end),
                ),
        )
    );
}

function identifierPartRange(node: SyntaxNode, text: string, partIndex: number): TextRange {
    const matcher = /\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*"|[^.\s]+/gu;
    const matches = [...text.matchAll(matcher)];
    const match = matches[partIndex];
    return match?.index === undefined
        ? freezeRange(node)
        : { start: node.start + match.index, end: node.start + match.index + match[0].length };
}

function lastIdentifierRange(node: SyntaxNode, text: string): TextRange {
    const parts = multipartIdentifierParts(text);
    return identifierPartRange(node, text, Math.max(0, parts.length - 1));
}

function leadingVariableRange(node: SyntaxNode, text: string): TextRange {
    const match = /^\s*(@[\p{L}_][\p{L}\p{N}_$#@]*)/iu.exec(text);
    return match?.index === undefined
        ? freezeRange(node)
        : {
              start: node.start + match.index + match[0].indexOf(match[1]!),
              end: node.start + match.index + match[0].indexOf(match[1]!) + match[1]!.length,
          };
}

function freezeRange(range: TextRange): TextRange {
    return Object.freeze({ start: range.start, end: range.end });
}

function parseDataType(
    source: string,
): { readonly name: string; readonly arguments: readonly number[] } | undefined {
    const match =
        /^\s*(?:\[[^\]]+\]|"[^"]+"|[\p{L}_][\p{L}\p{N}_$#@]*)(?:\s*\.\s*(?:\[[^\]]+\]|"[^"]+"|[\p{L}_][\p{L}\p{N}_$#@]*))*\s*(?:\(([^)]*)\))?/iu.exec(
            source,
        );
    if (!match) return undefined;
    const name = multipartIdentifierParts(match[0]!.split("(", 1)[0]!).at(-1)?.toLocaleLowerCase();
    if (!name) return undefined;
    const arguments_ = (match[1] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => /^[+-]?[0-9]+$/u.test(value))
        .map(Number);
    return { name, arguments: arguments_ };
}

/** The first parenthesized data-type argument, used to range a length diagnostic exactly. */
function firstArgumentNode(dataType: SyntaxNode): SyntaxNode | undefined {
    const argumentList = firstDescendant(dataType, "ArgumentList");
    return argumentList ? directChildren(argumentList, "Expression")[0] : undefined;
}

function dataTypeParts(syntax: SyntaxSnapshot, dataType: SyntaxNode): readonly string[] {
    const name = firstDescendant(dataType, "MultipartIdentifier");
    return name ? multipartIdentifierParts(syntax.document.text.slice(name.start, name.end)) : [];
}

function isSystemDataType(parts: readonly string[], parsedName: string, source: string): boolean {
    const normalizedSource = source
        .replace(/\([^)]*\)/gu, "")
        .trim()
        .replace(/\s+/gu, " ")
        .toLocaleLowerCase();
    const known = systemDataTypes.has(parsedName) || systemDataTypeSynonyms.has(normalizedSource);
    if (!known) return false;
    return parts.length <= 1 || (parts.length === 2 && parts[0]!.toLocaleLowerCase() === "sys");
}

function isCollatableSystemDataType(name: string, source: string): boolean {
    if (collatableSystemDataTypes.has(name)) return true;
    const normalized = source
        .replace(/\([^)]*\)/gu, "")
        .trim()
        .replace(/\s+/gu, " ")
        .toLocaleLowerCase();
    return collatableSystemTypeSynonyms.has(normalized);
}

function isNumericIdentityValue(source: string): boolean {
    const normalized = source
        .trim()
        .replace(/^\((.*)\)$/u, "$1")
        .trim();
    return /^[+-]?(?:[$£¥€]\s*)?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(normalized);
}

function isConstantExpression(source: string): boolean {
    return /[+\-*/%]/u.test(source) && /^[\s0-9.eE+\-*/%()]+$/u.test(source);
}

function isBooleanSource(source: string): boolean {
    return /(?:=|<>|!=|<=|>=|<|>|\bIS\s+(?:NOT\s+)?NULL\b|\bLIKE\b|\bIN\s*\(|\bBETWEEN\b|\bEXISTS\s*\(|\b(?:CONTAINS|FREETEXT)\s*\(|\bMATCH\s*\()/iu.test(
        source,
    );
}

function optionName(source: string): string | undefined {
    return /^\s*([\p{L}_][\p{L}\p{N}_$#@]*)/iu.exec(source)?.[1]?.toLocaleUpperCase();
}

function isFunctionOptionArgument(syntax: SyntaxSnapshot, node: SyntaxNode): boolean {
    const call = ancestor(node, "FunctionCall");
    if (!call) return false;
    const nameNode = firstDescendant(call, "MultipartIdentifier");
    const argumentList = firstDescendant(call, "ArgumentList");
    const arguments_ = argumentList ? directChildren(argumentList, "Expression") : [];
    if (!nameNode) return false;
    const name = syntax.document.text
        .slice(nameNode.start, nameNode.end)
        .trim()
        .toLocaleUpperCase();
    const optionIndex = name === "ISJSON" ? 1 : datePartFunctions.has(name) ? 0 : -1;
    const option = arguments_[optionIndex];
    return Boolean(option && option.start <= node.start && node.end <= option.end);
}

function arityCode(arity: FunctionArity): string {
    if (arity.minimum === arity.maximum) {
        if (arity.minimum === 0) return "FunctionRequiresZeroArguments";
        if (arity.minimum === 1) return "FunctionRequiresOneArgument";
        return "FunctionRequiresNumberOfArguments";
    }
    if (arity.maximum === Number.POSITIVE_INFINITY) {
        return arity.minimum === 1
            ? "FunctionRequiresAtLeastOneArgument"
            : "FunctionRequiresAtLeastNumberOfArguments";
    }
    return "FunctionRequiresRangeOfAruments";
}

function arityMessage(name: string, arity: FunctionArity): string {
    if (arity.minimum === arity.maximum) {
        if (arity.minimum === 0) return `The function '${name}' takes exactly 0 arguments.`;
        if (arity.minimum === 1) return ` The ${name} function takes exactly 1 argument.`;
        return ` The ${name} function requires ${arity.minimum} arguments.`;
    }
    if (arity.maximum === Number.POSITIVE_INFINITY) {
        return arity.minimum === 1
            ? `Function '${name}' requires at least 1 argument.`
            : `Function '${name}' requires at least ${arity.minimum} arguments.`;
    }
    return `The ${name} function requires ${arity.minimum} to ${arity.maximum} arguments.`;
}

function multipartIdentifierParts(text: string): readonly string[] {
    const parts: string[] = [];
    const matcher = /\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*"|[^.\s]+/gu;
    for (const match of text.matchAll(matcher)) parts.push(normalizeIdentifier(match[0]));
    return parts;
}

function normalizeIdentifier(value: string): string {
    if (value.startsWith("[") && value.endsWith("]")) {
        return value.slice(1, -1).replaceAll("]]", "]");
    }
    if (value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1).replaceAll('""', '"');
    }
    return value;
}

function countMatches(value: string, pattern: RegExp): number {
    return [...value.matchAll(pattern)].length;
}

function moduleStatementPhrase(source: string): string {
    return (
        /^\s*((?:CREATE|ALTER)(?:\s+OR\s+ALTER)?\s+(?:PROC(?:EDURE)?|FUNCTION|TRIGGER|VIEW))\b/iu
            .exec(source)?.[1]
            ?.replace(/\s+/gu, " ")
            .toLocaleUpperCase() ?? "CREATE/ALTER MODULE"
    );
}

const onlyStatementModuleKinds = new Set([
    "AlterFunctionStatement",
    "AlterProcedureStatement",
    "AlterTriggerStatement",
    "AlterViewStatement",
    "CreateFunctionStatement",
    "CreateProcedureStatement",
    "CreateTriggerStatement",
    "CreateViewStatement",
]);

const databasePrefixedModuleKinds = new Set([
    "AlterFunctionStatement",
    "AlterProcedureStatement",
    "AlterViewStatement",
    "CreateFunctionStatement",
    "CreateProcedureStatement",
    "CreateViewStatement",
]);

const builtInTableFunctions = new Set([
    "CHANGETABLE",
    "GENERATE_SERIES",
    "OPENJSON",
    "OPENROWSET",
    "OPENXML",
    "SEMANTIC_SEARCH",
    "STRING_SPLIT",
    "VECTOR_SEARCH",
]);

// SQL Server names each side-effecting statement by its statement phrase. The phrase depends on the
// statement kind, not on how it is spelled, so CREATE UNIQUE CLUSTERED INDEX is still "CREATE INDEX".
const sideEffectingStatementPhrases = new Map([
    ["AlterFunctionStatement", "ALTER FUNCTION"],
    ["AlterProcedureStatement", "ALTER PROCEDURE"],
    ["AlterTriggerStatement", "ALTER TRIGGER"],
    ["AlterViewStatement", "ALTER VIEW"],
    ["CreateFunctionStatement", "CREATE FUNCTION"],
    ["CreateIndexStatement", "CREATE INDEX"],
    ["CreateProcedureStatement", "CREATE PROCEDURE"],
    ["CreateSchemaStatement", "CREATE SCHEMA"],
    ["CreateSynonymStatement", "CREATE SYNONYM"],
    ["CreateTableStatement", "CREATE TABLE"],
    ["CreateTriggerStatement", "CREATE TRIGGER"],
    ["CreateTypeStatement", "CREATE TYPE"],
    ["CreateViewStatement", "CREATE VIEW"],
    ["DbccStatement", "DBCC"],
    ["DeleteStatement", "DELETE"],
    ["DropDatabaseStatement", "DROP DATABASE"],
    ["DropFunctionStatement", "DROP FUNCTION"],
    ["DropProcedureStatement", "DROP PROCEDURE"],
    ["DropSchemaStatement", "DROP SCHEMA"],
    ["DropSequenceStatement", "DROP SEQUENCE"],
    ["DropSynonymStatement", "DROP SYNONYM"],
    ["DropTableStatement", "DROP TABLE"],
    ["DropTriggerStatement", "DROP TRIGGER"],
    ["DropTypeStatement", "DROP TYPE"],
    ["DropViewStatement", "DROP VIEW"],
    ["InsertStatement", "INSERT"],
    ["MergeStatement", "MERGE"],
    ["SetStatement", "SET"],
]);

// These node kinds each cover several statements, so their phrase comes from their leading words.
const derivedStatementPhraseKinds = new Set([
    "AggregateStatement",
    "AlterPrincipalStatement",
    "BackupStatement",
    "CreatePrincipalStatement",
    "DropPrincipalStatement",
    "PermissionStatement",
    "RestoreStatement",
    "RuleDefaultStatement",
    "SecurityPolicyStatement",
]);

// The phrases those multi-form kinds may produce. A leading-word sequence outside this list names a
// statement SQL Server does not report, such as CREATE AGGREGATE or ALTER USER.
const knownStatementPhrases = new Set([
    "ALTER LOGIN",
    "BACKUP CERTIFICATE",
    "BACKUP DATABASE",
    "BACKUP LOG",
    "BACKUP MASTER KEY",
    "BACKUP SERVICE MASTER KEY",
    "BACKUP TABLE",
    "CREATE LOGIN",
    "CREATE ROLE",
    "CREATE USER",
    "DENY",
    "DROP AGGREGATE",
    "DROP DEFAULT",
    "DROP LOGIN",
    "DROP ROLE",
    "DROP RULE",
    "DROP SECURITY POLICY",
    "DROP USER",
    "GRANT",
    "RESTORE DATABASE",
    "RESTORE INFORMATION",
    "RESTORE LOG",
    "RESTORE MASTER KEY",
    "RESTORE SERVICE MASTER KEY",
    "RESTORE TABLE",
    "REVOKE",
]);

const dmlStatementPhrases = new Set(["DELETE", "INSERT", "MERGE"]);

// Index options a key constraint never accepts, and those it accepts only through ALTER TABLE.
const constraintForbiddenIndexOptions = new Set(["DROP_EXISTING", "STATISTICS_ONLY"]);
const constraintBuildOnlyIndexOptions = new Set(["MAXDOP", "ONLINE", "SORT_IN_TEMPDB"]);

// No data type may be given a length above this ceiling, whatever its own maximum is.
const maximumSizeForAnyType = 8000;

// Types whose single argument is a fractional-seconds scale rather than a length.
const scaleArgumentTypes = new Set(["datetime2", "datetimeoffset", "time"]);

const typeLengthMaximum: Readonly<Record<string, number>> = Object.freeze({
    binary: 8000,
    char: 8000,
    nchar: 4000,
    nvarchar: 4000,
    varbinary: 8000,
    varchar: 8000,
});

const aggregateFunctionNames = new Set([
    "APPROX_COUNT_DISTINCT",
    "AVG",
    "CHECKSUM_AGG",
    "COUNT",
    "COUNT_BIG",
    "GROUPING",
    "GROUPING_ID",
    "MAX",
    "MIN",
    "STDEV",
    "STDEVP",
    "STRING_AGG",
    "SUM",
    "VAR",
    "VARP",
]);

const scalarFunctionOptions = new Set([
    "ENCRYPTION",
    "SCHEMABINDING",
    "EXECUTE AS",
    "RETURNS NULL ON NULL INPUT",
    "CALLED ON NULL INPUT",
]);
const tableFunctionOptions = new Set(["ENCRYPTION", "SCHEMABINDING", "EXECUTE AS"]);
const inlineTableFunctionOptions = new Set(["ENCRYPTION", "SCHEMABINDING", "NATIVE_COMPILATION"]);
const externalScalarFunctionOptions = new Set([
    "EXECUTE AS",
    "RETURNS NULL ON NULL INPUT",
    "CALLED ON NULL INPUT",
]);
const externalTableFunctionOptions = new Set(["EXECUTE AS"]);

const pivotAggregateArities = new Map<string, FunctionArity>([
    ...[
        "APPROX_COUNT_DISTINCT",
        "AVG",
        "CHECKSUM_AGG",
        "COUNT",
        "COUNT_BIG",
        "GROUPING",
        "MAX",
        "MIN",
        "STDEV",
        "STDEVP",
        "SUM",
        "VAR",
        "VARP",
    ].map((name) => [name, { minimum: 1, maximum: 1 }] as const),
    ["GROUPING_ID", { minimum: 1, maximum: Number.POSITIVE_INFINITY }],
    ["STRING_AGG", { minimum: 2, maximum: 2 }],
]);

const validTableHintNames = new Set([
    "FASTFIRSTROW",
    "FORCESEEK",
    "FORCESCAN",
    "FORCE_ANN_ONLY",
    "HOLDLOCK",
    "IGNORE_CONSTRAINTS",
    "IGNORE_TRIGGERS",
    "INDEX",
    "KEEPDEFAULTS",
    "KEEPIDENTITY",
    "NOEXPAND",
    "NOLOCK",
    "NOWAIT",
    "PAGLOCK",
    "READCOMMITTED",
    "READCOMMITTEDLOCK",
    "READPAST",
    "READUNCOMMITTED",
    "REPEATABLEREAD",
    "ROWLOCK",
    "SERIALIZABLE",
    "SNAPSHOT",
    "SPATIAL_WINDOW_MAX_CELLS",
    "TABLOCK",
    "TABLOCKX",
    "UPDLOCK",
    "XLOCK",
]);

const identityTypes = new Set(["bigint", "decimal", "int", "numeric", "smallint", "tinyint"]);

const invalidAliasBaseTypes = new Set([
    "geography",
    "geometry",
    "hierarchyid",
    "json",
    "sysname",
    "vector",
    "xml",
]);

const collatableSystemDataTypes = new Set([
    "char",
    "nchar",
    "ntext",
    "nvarchar",
    "sysname",
    "text",
    "varchar",
]);

const collatableSystemTypeSynonyms = new Set([
    "char varying",
    "character",
    "character varying",
    "national char",
    "national char varying",
    "national character",
    "national character varying",
]);

const viewOptions = new Set(["ENCRYPTION", "SCHEMABINDING", "VIEW_METADATA"]);

// SQL Server maps exactly these spellings to a cursor option; anything else in either cursor option
// list is unrecognized. Only INSENSITIVE and SCROLL may appear in the ISO list before CURSOR.
const cursorOptionNames = new Set([
    "DYNAMIC",
    "FAST_FORWARD",
    "FORWARD_ONLY",
    "GLOBAL",
    "INSENSITIVE",
    "KEYSET",
    "LOCAL",
    "OPTIMISTIC",
    "READ_ONLY",
    "SCROLL",
    "SCROLL_LOCKS",
    "STATIC",
    "TYPE_WARNING",
]);
const isoCursorOptionNames = new Set(["INSENSITIVE", "SCROLL"]);

// SQL Server recognizes exactly these single-word module options inside a module WITH clause; any
// other name there is unrecognized rather than misplaced. EXECUTE AS has its own option syntax.
const recognizedModuleOptions = new Set([
    "ENCRYPTION",
    "NATIVE_COMPILATION",
    "RECOMPILE",
    "SCHEMABINDING",
    "VIEW_METADATA",
]);

const moduleOptionStatements = [
    {
        clause: "ProcedureWithClause",
        option: "ProcedureOption",
        allowed: new Set([
            "ENCRYPTION",
            "EXECUTE AS",
            "NATIVE_COMPILATION",
            "RECOMPILE",
            "SCHEMABINDING",
        ]),
        code: "InvalidOptionInCreateProcedure",
        message: 'An invalid option was specified for the statement "CREATE/ALTER PROCEDURE".',
    },
    {
        clause: "TriggerWithClause",
        option: "TriggerOption",
        allowed: new Set(["ENCRYPTION", "EXECUTE AS", "NATIVE_COMPILATION", "SCHEMABINDING"]),
        code: "InvalidOptionInCreateTrigger",
        message: 'An invalid option was specified for the statement "CREATE/ALTER TRIGGER".',
    },
] as const;

const moduleOptionNames = new Set([
    "CALLED ON NULL INPUT",
    "ENCRYPTION",
    "EXECUTE AS",
    "INLINE",
    "NATIVE_COMPILATION",
    "RECOMPILE",
    "RETURNS NULL ON NULL INPUT",
    "SCHEMABINDING",
    "VIEW_METADATA",
]);

const systemDataTypes = new Set([
    "bigint",
    "binary",
    "bit",
    "char",
    "date",
    "datetime",
    "datetime2",
    "datetimeoffset",
    "decimal",
    "float",
    "geography",
    "geometry",
    "hierarchyid",
    "image",
    "int",
    "json",
    "money",
    "nchar",
    "ntext",
    "numeric",
    "nvarchar",
    "real",
    "rowversion",
    "smalldatetime",
    "smallint",
    "smallmoney",
    "sql_variant",
    "sysname",
    "text",
    "time",
    "timestamp",
    "tinyint",
    "uniqueidentifier",
    "varbinary",
    "varchar",
    "vector",
    "xml",
]);

const systemDataTypeSynonyms = new Set([
    "binary varying",
    "char varying",
    "character",
    "character varying",
    "dec",
    "double precision",
    "integer",
    "national char",
    "national char varying",
    "national character",
    "national character varying",
]);

const datePartFunctions = new Set([
    "DATEADD",
    "DATEDIFF",
    "DATEDIFF_BIG",
    "DATENAME",
    "DATEPART",
    "DATE_BUCKET",
]);

const isJsonValueTypes = new Set(["ARRAY", "OBJECT", "SCALAR", "VALUE"]);

const dateParts = new Set([
    "DAY",
    "DAYOFYEAR",
    "DD",
    "DW",
    "DY",
    "HOUR",
    "HH",
    "ISO_WEEK",
    "ISOWK",
    "ISOWW",
    "MICROSECOND",
    "MCS",
    "MILLISECOND",
    "MINUTE",
    "MM",
    "MONTH",
    "MS",
    "NANOSECOND",
    "NS",
    "N",
    "QUARTER",
    "QQ",
    "Q",
    "SECOND",
    "SS",
    "S",
    "TZOFFSET",
    "TZ",
    "WEEK",
    "WEEKDAY",
    "WK",
    "WW",
    "YEAR",
    "YY",
    "YYYY",
]);

const builtInFunctionArities = new Map<string, FunctionArity>([
    ...[
        "ABS",
        "ACOS",
        "ASIN",
        "ATAN",
        "CEILING",
        "COS",
        "COT",
        "DAY",
        "DEGREES",
        "EXP",
        "FLOOR",
        "ISNUMERIC",
        "LOG10",
        "MONTH",
        "RADIANS",
        "SIGN",
        "SIN",
        "SQRT",
        "SQUARE",
        "TAN",
        "YEAR",
    ].map((name) => [name, { minimum: 1, maximum: 1 }] as const),
    ...[
        "CURRENT_TIMESTAMP",
        "GETDATE",
        "GETUTCDATE",
        "NEWID",
        "PI",
        "SYSDATETIME",
        "SYSDATETIMEOFFSET",
        "SYSUTCDATETIME",
    ].map((name) => [name, { minimum: 0, maximum: 0 }] as const),
    ["ATN2", { minimum: 2, maximum: 2 }],
    ["COALESCE", { minimum: 2, maximum: Number.POSITIVE_INFINITY }],
    ["CONCAT", { minimum: 2, maximum: 254 }],
    ["DATEADD", { minimum: 3, maximum: 3 }],
    ["DATEDIFF", { minimum: 3, maximum: 3 }],
    ["DATEDIFF_BIG", { minimum: 3, maximum: 3 }],
    ["DATEFROMPARTS", { minimum: 3, maximum: 3 }],
    ["DATENAME", { minimum: 2, maximum: 2 }],
    ["DATEPART", { minimum: 2, maximum: 2 }],
    ["EOMONTH", { minimum: 1, maximum: 2 }],
    ["IIF", { minimum: 3, maximum: 3 }],
    ["ISJSON", { minimum: 1, maximum: 2 }],
    ["JSON_MODIFY", { minimum: 3, maximum: 3 }],
    ["JSON_QUERY", { minimum: 1, maximum: 2 }],
    ["JSON_VALUE", { minimum: 2, maximum: 2 }],
    ["LOG", { minimum: 1, maximum: 2 }],
    ["NULLIF", { minimum: 2, maximum: 2 }],
    ["POWER", { minimum: 2, maximum: 2 }],
    ["RAND", { minimum: 0, maximum: 1 }],
    ["ROUND", { minimum: 2, maximum: 3 }],
]);
