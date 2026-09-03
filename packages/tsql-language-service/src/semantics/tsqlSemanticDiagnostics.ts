/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AnalysisProfile } from "../common/analysisProfile.js";
import { defaultAnalysisProfile } from "../common/analysisProfile.js";
import { normalizeSystemDataTypeName } from "../common/builtInRegistry.js";
import { compareOrdinal } from "../common/ordinal.js";
import type {
    ColumnMetadata,
    MetadataView,
    ObjectMetadata,
    ParameterMetadata,
    SqlPrincipalKind,
} from "../metadata/index.js";
import type { SyntaxNode, SyntaxSnapshot, SyntaxToken } from "../syntax/index.js";
import {
    containsSyntaxError as containsErrorNode,
    descendantsOfKind as descendants,
    descendantsOwnedByKind as descendantsOwnedBy,
    directChildrenOfKind as directChildren,
    directChildOfKind as directChild,
    directOwnedDescendantsOfKind as directOwnedDescendants,
    firstDescendantOfKind as firstDescendant,
    lastDescendantOfKind as lastDescendant,
    parentOfKind as ancestor,
    sameSyntaxNode as sameNode,
} from "../syntax/treeUtilities.js";
import type { TextRange } from "../text/index.js";
import type { SemanticDiagnostic } from "./contracts.js";
import type { BoundExpression, CatalogTimeline, CatalogTimelineEvent } from "./model/contracts.js";
import {
    DocumentCatalogTimeline,
    procedureEventKinds,
    relationEventKinds,
    typeEventKinds,
} from "./model/catalogTimeline.js";
import { itemsWithinRanges } from "./model/lookups.js";
import { localColumnsForName } from "./model/scopeModel.js";
import {
    compactMultipartName,
    lastMultipartIdentifierPartRange,
    multipartIdentifierPartRange,
    multipartIdentifierParts,
    normalizeIdentifier,
    normalizeStringLiteral,
} from "./identifiers.js";
import {
    validateBatchContracts,
    validateBuildMode,
    validateCursorOptions,
    validateBuiltInRoutineNames,
    validateBuiltInFunctions,
    validateCatalogFunctionArguments,
    validateCollations,
    columnDefinitionTextFacts,
    dataTypeNameText,
    validateComputedColumnConstraints,
    validateConstraintIndexOptions,
    validateExternalStreamParameters,
    validateForeignKeys,
    validateExecutions,
    validateIdentifierNames,
    validateNestedDml,
    validateDatabases,
    validateDataTypesAndColumns,
    validateDdlObjects,
    validateDml,
    validateOptions,
    validateQueryShapes,
    validateBooleanContexts,
    validateOrderBy,
    validateOutputClauses,
    validatePermissiveKeywordTails,
    validatePrincipals,
    validateScopedConfigurations,
    validateSecurables,
    validateSetOptions,
    validateSynonyms,
    validateTableDefinitions,
    validateTriggerCatalog,
    validateTypeMembers,
    validateUserTypes,
    validateVariables,
    validateXmlTableMethods,
    isXmlNodeNullCheckSuffix,
    localLoginOperation,
    localTypeCategory,
    normalizedSystemDataTypeText,
    recoveredSelectAlias,
    recoveredVariableDeclarations,
    routineParameterTextFacts,
    selectElementAssignsVariable,
    selectStarQualifier,
    statementPhrase as diagnosticStatementPhrase,
    validateIndexes,
    validateModuleDefinitions,
} from "./diagnostics/index.js";

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
    profile: AnalysisProfile = defaultAnalysisProfile,
): readonly SemanticDiagnostic[] {
    return collectTsqlSemanticDiagnosticsWithState(
        syntax,
        metadata,
        validationRanges,
        undefined,
        undefined,
        profile,
    ).diagnostics;
}

/** Opaque document environment reused when a local edit cannot change DDL visibility. */
export interface TsqlSemanticDiagnosticState {
    readonly documentLength: number;
    readonly metadataGeneration: number;
}

export interface TsqlSemanticDiagnosticResult {
    readonly diagnostics: readonly SemanticDiagnostic[];
    readonly state: TsqlSemanticDiagnosticState;
}

/**
 * Incremental entry point used by the binder. When the caller proves that document-level DDL
 * state is unchanged, only the supplied validation roots are indexed and validated.
 */
export function collectTsqlSemanticDiagnosticsWithState(
    syntax: SyntaxSnapshot,
    metadata: MetadataView,
    validationRanges?: readonly TextRange[],
    validationRoots?: readonly SyntaxNode[],
    previousState?: TsqlSemanticDiagnosticState,
    profile: AnalysisProfile = defaultAnalysisProfile,
    /**
     * The bound expression types, supplied by the caller that will also publish them.
     *
     * Validation needs types while it validates, and features need the same types afterwards.
     * Taking them as an input means both read one table rather than each inferring its own, which
     * is what stops a squiggle and a tooltip from disagreeing about what an expression is.
     */
    expressionsFor?: (state: TsqlSemanticDiagnosticState) => readonly BoundExpression[],
): TsqlSemanticDiagnosticResult {
    const reusableState =
        validationRoots &&
        previousState instanceof CachedTsqlSemanticDiagnosticState &&
        previousState.documentLength === syntax.document.length &&
        previousState.metadataGeneration === metadata.generation
            ? previousState
            : undefined;
    const index = reusableState
        ? indexSyntax(validationRoots!)
        : (syntax.structuralIndex?.() ?? indexSyntax([syntax.root()]));
    const state =
        reusableState ??
        new CachedTsqlSemanticDiagnosticState(
            syntax.document.length,
            metadata.generation,
            indexObjectEvents(collectLocalRelationEvents(syntax, index), metadata),
            indexObjectEvents(collectLocalProcedureEvents(syntax, index), metadata),
            indexLoginEvents(collectLocalLoginEvents(syntax, index), metadata),
            indexObjectEvents(collectLocalTypeEvents(syntax, index), metadata),
        );
    const context = new ValidationContext(
        syntax,
        metadata,
        index,
        validationRanges,
        state,
        profile,
        expressionsFor?.(state),
    );
    validateBuildMode(context);
    validateIdentifierNames(context);
    context.validateObjects();
    validateTypeMembers(context);
    validateXmlTableMethods(context);
    context.validateQueries();
    validateQueryShapes(context);
    context.validateProjectedRelations();
    context.validatePivotOperators();
    validateBooleanContexts(context);
    context.validateCommonTableExpressions();
    validateVariables(context);
    validateTableDefinitions(context);
    validateForeignKeys(context);
    validateExecutions(context);
    validateDml(context);
    validateNestedDml(context);
    validateOutputClauses(context);
    validateOrderBy(context);
    validateUserTypes(context);
    validateDataTypesAndColumns(context);
    validateDatabases(context);
    validateScopedConfigurations(context);
    validatePrincipals(context);
    validateSecurables(context);
    validateCollations(context);
    validateModuleDefinitions(context);
    validateDdlObjects(context);
    validateTriggerCatalog(context);
    validateIndexes(context);
    validateConstraintIndexOptions(context);
    validateComputedColumnConstraints(context);
    validateBatchContracts(context);
    validateExternalStreamParameters(context);
    validateBuiltInRoutineNames(context);
    validateBuiltInFunctions(context);
    validateCatalogFunctionArguments(context);
    validateOptions(context);
    validateSetOptions(context);
    validatePermissiveKeywordTails(context);
    validateCursorOptions(context);
    validateSynonyms(context);
    return { diagnostics: context.result(), state };
}

class ValidationContext {
    private readonly _text: string;
    private readonly _diagnostics: SemanticDiagnostic[] = [];
    private readonly _seen = new Set<string>();
    /**
     * The document's local DDL, read through the same timeline every feature reads.
     *
     * The per-namespace maps behind it are still what the collectors produce, but resolution goes
     * through one object so a squiggle and a completion cannot answer "does this exist here?"
     * differently.
     */
    private readonly _timeline: CatalogTimeline;
    private readonly _localLogins: ReadonlyMap<string, readonly LocalLoginEvent[]>;
    private readonly _variableDeclarations: readonly VariableDeclaration[];
    /** Nodes of a kind already narrowed to the validation ranges. See {@link nodes}. */
    private readonly _nodesInRange = new Map<string, readonly SyntaxNode[]>();

    public constructor(
        private readonly _syntax: SyntaxSnapshot,
        private readonly _metadata: MetadataView,
        private readonly _index: ReadonlyMap<string, readonly SyntaxNode[]>,
        private readonly _validationRanges?: readonly TextRange[],
        environment?: CachedTsqlSemanticDiagnosticState,
        public readonly profile: AnalysisProfile = defaultAnalysisProfile,
        private readonly _expressions: readonly BoundExpression[] = [],
    ) {
        this._text = _syntax.document.text;
        const state =
            environment ??
            new CachedTsqlSemanticDiagnosticState(
                _syntax.document.length,
                _metadata.generation,
                indexObjectEvents(collectLocalRelationEvents(_syntax, _index), _metadata),
                indexObjectEvents(collectLocalProcedureEvents(_syntax, _index), _metadata),
                indexLoginEvents(collectLocalLoginEvents(_syntax, _index), _metadata),
                indexObjectEvents(collectLocalTypeEvents(_syntax, _index), _metadata),
            );
        this._timeline = new DocumentCatalogTimeline(
            collectCatalogTimelineEvents(_syntax, _index, state),
            _metadata,
        );
        // A login is not a catalog object: it is server-scoped and named by one word, so it keeps
        // its own index rather than sharing the object timeline's multipart keys.
        this._localLogins = state.localLogins;
        this._variableDeclarations = collectVariableDeclarations(_syntax, _index);
    }

    /** The pinned catalog generation shared by binding and every diagnostic family. */
    public get metadata(): MetadataView {
        return this._metadata;
    }

    /** The one published syntax snapshot shared by binding and every diagnostic family. */
    public get syntax(): SyntaxSnapshot {
        return this._syntax;
    }

    public validateObjects(): void {
        for (const node of this.nodes("NamedTableSource")) this.validateRelation(node, false);
        for (const node of this.nodes("DmlTarget")) this.validateRelation(node, true);
        for (const node of this.nodes("FunctionTableSource")) this.validateRelation(node, false);
        for (const node of this.nodes("VariableTableSource")) {
            const variable = firstDescendant(node, "Variable");
            if (!variable) continue;
            const name = this.source(variable);
            if (firstDescendant(node, "Dot") && this.variableAt(name, variable.start, false)) {
                continue;
            }
            if (!this.variableAt(name, variable.start, true)) {
                this.add(
                    "TableVariableRequired",
                    `Must declare the table variable \"${name}\".`,
                    variable,
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
                // A nested DML statement brings its own target and inserted/deleted rowsets, which
                // the enclosing query's sources do not describe.
                if (ancestor(column, "NestedDmlTableSource")) continue;
                if (isFunctionOptionArgument(this._syntax, column)) continue;
                const parts = multipartIdentifierParts(this.source(column));
                if (parts.length === 0) continue;
                if (ancestor(column, "OrderByClause") && aliases.has(this.fold(parts.at(-1)!))) {
                    continue;
                }
                this.validateColumn(column, parts, visibleSources);
                this.validateXmlNodeColumnUse(column, parts, visibleSources);
            }
            for (const call of descendantsOwnedBy(query, "FunctionCall", query)) {
                this.validateRemoteFunctionReference(call, visibleSources);
            }
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

                const query =
                    firstDescendant(cte, "QueryExpression") ??
                    firstDescendant(cte, "SelectQueryExpression");
                if (!query) continue;
                const terms = setOperatorTerms(query);
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
                const hasUnionAll = terms.slice(1).some((term, index) => {
                    const operator = this.significantTokens(
                        { start: terms[index]!.end, end: term.start },
                        2,
                    );
                    return (
                        operator[0]?.text.toUpperCase() === "UNION" &&
                        operator[1]?.text.toUpperCase() === "ALL"
                    );
                });
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
            // The unpivoted list parses multipart names so a qualified name is diagnosed here
            // rather than recovered, so it is its own node kind rather than a plain column list.
            const list = directChildren(unpivot, "UnpivotColumnList")[0];
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
        const name = displayName.toUpperCase();
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

    public functionRedefinedBefore(parts: readonly string[], offset: number): boolean {
        const key = objectNameKey(parts, this._metadata);
        for (const kind of ["CreateFunctionStatement", "AlterFunctionStatement"] as const) {
            for (const node of this._index.get(kind) ?? []) {
                if (node.end > offset) continue;
                const nameNode = firstDescendant(node, "MultipartIdentifier");
                if (!nameNode) continue;
                const declared = multipartIdentifierParts(
                    compactMultipartName(this.source(nameNode)),
                );
                if (objectNameKey(declared, this._metadata) === key) return true;
            }
        }
        return false;
    }

    public statementPhrase(statement: SyntaxNode): string | undefined {
        return diagnosticStatementPhrase(this, statement);
    }

    /** The first `limit` non-trivia tokens of a node, in document order. */
    public significantTokens(range: TextRange, limit: number): readonly SyntaxToken[] {
        const result: SyntaxToken[] = [];
        for (const token of this._syntax.tokens(range)) {
            if (token.trivia) continue;
            result.push(token);
            if (result.length === limit) break;
        }
        return result;
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
    public reportOverPrefixedTypeNames(
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

    public result(): readonly SemanticDiagnostic[] {
        return Object.freeze(
            [...this._diagnostics].sort(
                (left, right) =>
                    left.range.start - right.range.start || compareOrdinal(left.code, right.code),
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
            parts.length === 1 &&
            builtInTableFunctions.has(parts.at(-1)!.toUpperCase())
        ) {
            return;
        }
        if (node.kind === "FunctionTableSource" && this.isInstanceTableMethod(node, parts)) return;
        if (localEvent?.create) {
            // A document-local object obeys the same call-shape rules as a catalog one: naming a
            // table-valued function without parentheses is the same mistake either way, and
            // parenthesising something that is not a function is too.
            if (node.kind === "NamedTableSource" && localEvent.kind === "tableFunction") {
                this.add(
                    "ParametersNotSuppliedForFunction",
                    `Parameters were not supplied for the function '${source}'.`,
                    nameNode,
                );
            } else if (node.kind === "FunctionTableSource" && localEvent.kind !== "tableFunction") {
                this.add(
                    "ParametersSuppliedForNonFunction",
                    `Parameters supplied for object '${source}' which is not a function. If the parameters are intended as a table hint, a WITH keyword is required.`,
                    nameNode,
                );
            }
            return;
        }
        if (this.isCteReference(nameNode, parts)) {
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
            const arguments_ = firstDescendant(node, "ArgumentList");
            const direct = [...node.children()];
            const emptyTargetCall =
                direct.some((child) => child.kind === "OpenParen") &&
                direct.some((child) => child.kind === "CloseParen");
            if (
                resolution.object.kind === "tableFunction" &&
                ((arguments_ !== undefined &&
                    directChildren(arguments_, "Expression").length === 0) ||
                    emptyTargetCall)
            ) {
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

    /**
     * Reports a four-part function call that names a remote function.
     *
     * A four-part name in a call position takes precedence over every other result for that call.
     * It stays silent when the call resolves to a function, and when its last part binds as an
     * ordinary column, because only a UDT or XML column can carry a callable member.
     */
    private validateRemoteFunctionReference(
        call: SyntaxNode,
        sources: readonly QuerySource[],
    ): void {
        if (containsErrorNode(call)) return;
        const nameNode = firstDescendant(call, "MultipartIdentifier");
        if (!nameNode) return;
        const displayName = compactMultipartName(this.source(nameNode));
        const parts = multipartIdentifierParts(displayName);
        if (parts.length !== 4) return;
        if (this.localRelationEventAt(parts, nameNode.start)) return;
        const resolution = this._metadata.resolveObject(parts);
        if (resolution.kind === "resolved" || resolution.kind === "unknown") return;
        const columnName = parts.at(-1)!;
        const source = sources.find((candidate) =>
            this.equal(candidate.exposedName, parts.at(-2)!),
        );
        const column = source?.columns?.find((candidate) => this.equal(candidate.name, columnName));
        // A column that can carry a callable member does not make the four-part name valid.
        if (column && !memberBearingColumnType(column.typeDisplay)) return;
        this.add(
            "RemoteFunctionRefIsNotAllowed",
            `Remote function reference '${displayName}' is not allowed, and the column name '${columnName}' could not be found or is ambiguous.`,
            nameNode,
        );
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
                // A qualified column whose qualifier binds to no rowset is a multi-part identifier
                // that could not be bound. The prefix-mismatch message belongs to a qualified star,
                // where there is no column name to report and the qualifier itself is at fault.
                this.add(
                    "MultiPartIdentifierBindingError",
                    `The multi-part identifier "${compactMultipartName(this.source(node))}" could not be bound.`,
                    node,
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
        if (expression && isXmlNodeNullCheckSuffix(this._text.slice(node.end, expression.end))) {
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
            const qualifier = selectStarQualifier(this.source(element));
            if (qualifier === false) continue;
            // A qualified star has no column name to report, so an unmatched qualifier is reported
            // as a prefix mismatch at the qualifier itself.
            if (
                qualifier !== undefined &&
                sources.length > 0 &&
                !sources.some((source) => this.equal(source.exposedName, qualifier))
            ) {
                const identifiers = descendants(element, "IdentifierName");
                this.add(
                    "ColumnPrefixMismatch",
                    `The column prefix '${qualifier}' does not match with a table name or alias name used in the query.`,
                    identifiers.at(-1) ?? element,
                );
            }
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
        if (source.node.kind === "VariableTableSource") {
            const variable = firstDescendant(source.node, "Variable");
            const member = directChildren(source.node, "IdentifierName")[0];
            return Boolean(
                variable &&
                    member &&
                    this.equal(this.source(member), "nodes") &&
                    this.variableTypeAt(this.source(variable), variable.start)?.toLowerCase() ===
                        "xml",
            );
        }
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

    /**
     * Reports an argument whose type does not match a non-scalar parameter.
     *
     * Only cursor and table-valued parameters carry this rule: a scalar parameter converts its
     * argument instead. Both type names must be known, so an argument that is not a declared
     * variable, or a parameter whose type does not resolve, reports nothing.
     */
    public validateNonScalarArgumentType(
        argument: SyntaxNode,
        parameter: ParameterMetadata,
        named: boolean,
    ): void {
        const parameterType = this.nonScalarTypeName(parameter.typeDisplay);
        if (!parameterType) return;
        // A named argument spells the parameter first, so the supplied value is the later variable.
        const variables = descendants(argument, "Variable");
        const variable = named ? variables.at(-1) : variables[0];
        if (!variable || (named && variables.length < 2)) return;
        // The bound type first, so any expression the binder could type participates; the declared
        // variable is the fallback for the shapes the type table does not cover yet.
        const bound = this.boundTypeAt(variable.start);
        const declaration = this.variableAt(this.source(variable), variable.start, false);
        const argumentType =
            (bound && this.declaredTypeName(bound)) ??
            (declaration && this.declaredTypeName(declaration.typeDisplay));
        if (!argumentType || this.equal(argumentType, parameterType)) return;
        this.add(
            "OperandTypeClash",
            `Operand type clash: ${argumentType} is incompatible with ${parameterType}`,
            argument,
        );
    }

    /** Names a parameter's type when that type is a cursor or a table type, and nothing otherwise. */
    private nonScalarTypeName(typeDisplay: string | undefined): string | undefined {
        const name = this.declaredTypeName(typeDisplay);
        if (!name) return undefined;
        if (name.toLowerCase() === "cursor") return name;
        const parts = multipartIdentifierParts(
            compactMultipartName(dataTypeNameText(typeDisplay!)),
        );
        const resolution = this._metadata.resolveObject(parts);
        return resolution.kind === "resolved" &&
            resolution.object.kind === "type" &&
            resolution.object.typeCategory === "table"
            ? name
            : undefined;
    }

    /** The bare type name of a declared type, without its schema or its arguments. */
    private declaredTypeName(typeDisplay: string | undefined): string | undefined {
        if (!typeDisplay) return undefined;
        const parts = multipartIdentifierParts(compactMultipartName(dataTypeNameText(typeDisplay)));
        return parts.at(-1);
    }

    public relationColumnsAt(
        parts: readonly string[],
        offset: number,
    ): readonly ColumnMetadata[] | undefined {
        const local = this.localRelationEventAt(parts, offset);
        if (local) return local.create ? local.columns : undefined;
        const resolution = this._metadata.resolveObject(parts);
        if (resolution.kind !== "resolved") return undefined;
        return this.loadedColumns(resolution.object);
    }

    public loadedColumns(object: ObjectMetadata): readonly ColumnMetadata[] | undefined {
        const state = this._metadata.columnState(object.ref);
        return state.kind === "loaded" ? state.value : undefined;
    }

    private querySources(query: SyntaxNode, scopeDepth = 0): readonly QuerySource[] {
        const result: QuerySource[] = [];
        for (const node of [
            ...descendantsOwnedBy(query, "NamedTableSource", query),
            ...descendantsOwnedBy(query, "FunctionTableSource", query),
            ...descendantsOwnedBy(query, "VariableTableSource", query),
            ...descendantsOwnedBy(query, "DerivedTable", query),
            ...descendantsOwnedBy(query, "NestedDmlTableSource", query),
            ...descendantsOwnedBy(query, "SemanticSearchTableSource", query),
            ...descendantsOwnedBy(query, "VectorSearchTableSource", query),
        ]) {
            const aliasNode =
                node.kind === "SemanticSearchTableSource"
                    ? directChild(node, "TableAlias")
                    : firstDescendant(node, "TableAlias");
            const aliasName = aliasNode && lastDescendant(aliasNode, "IdentifierName");
            const variable =
                node.kind === "VariableTableSource" ? firstDescendant(node, "Variable") : undefined;
            const nameNode = firstDescendant(node, "MultipartIdentifier");
            const parts = nameNode ? multipartIdentifierParts(this.source(nameNode)) : [];
            const baseName = variable
                ? this.source(variable)
                : node.kind === "SemanticSearchTableSource"
                  ? "SEMANTIC_SEARCH"
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
            if (firstDescendant(source, "Dot")) {
                const names = firstDescendant(source, "ColumnNameList");
                const columns = names
                    ? descendants(names, "IdentifierName").map((name) => ({
                          name: normalizeIdentifier(this.source(name)),
                          typeDisplay: "xml",
                      }))
                    : [];
                return columns.length > 0 ? columns : undefined;
            }
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
        if (source.kind === "SemanticSearchTableSource") return undefined;
        if (source.kind === "DerivedTable") {
            return projectedColumns(this._syntax, source);
        }
        // A nested DML statement exposes exactly the columns its explicit list names; without one
        // the OUTPUT clause decides, which this layer does not type.
        if (source.kind === "NestedDmlTableSource") {
            const names = firstDescendant(source, "ColumnNameList");
            return names
                ? descendants(names, "IdentifierName").map((node) => ({
                      name: normalizeIdentifier(this.source(node)),
                  }))
                : undefined;
        }
        if (source.kind === "FunctionTableSource") {
            const builtIn = parts.at(-1)?.toUpperCase();
            if (builtIn === "OPENJSON") {
                const withClause = firstDescendant(source, "WithColumnSchema");
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
            return localColumnsForName({ syntax: this._syntax }, parts, source.start);
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
        const state = this._timeline.resolve(parts, offset, relationEventKinds);
        if (!state?.event) return undefined;
        return {
            offset: state.event.offset,
            create: state.exists,
            parts: state.event.parts,
            kind: state.event.kind as LocalRelationEvent["kind"],
            ...(state.parameters ? { parameters: state.parameters } : {}),
            ...(state.columns ? { columns: state.columns } : {}),
        };
    }

    /** Whether same-document DDL has an authoritative event for this relation at an offset. */
    public localRelationKnownAt(parts: readonly string[], offset: number): boolean {
        return this.localRelationEventAt(parts, offset) !== undefined;
    }

    /** Same-document relation state shared with CREATE/ALTER/DROP diagnostics. */
    public localDdlObjectAt(
        parts: readonly string[],
        offset: number,
    ): { readonly create: boolean; readonly kind: LocalRelationEvent["kind"] } | undefined {
        return this.localRelationEventAt(parts, offset);
    }

    /** Full same-document relation state shared with foreign-key diagnostics. */
    public localRelationAt(
        parts: readonly string[],
        offset: number,
    ): LocalRelationEvent | undefined {
        return this.localRelationEventAt(parts, offset);
    }

    /** Parameters of a document-local table function visible at this source offset. */
    public localFunctionParameters(
        parts: readonly string[],
        offset: number,
    ): readonly ParameterMetadata[] | undefined {
        const local = this.localRelationEventAt(parts, offset);
        return local?.create && local.kind === "tableFunction" ? local.parameters : undefined;
    }

    private localProcedureAt(
        parts: readonly string[],
        offset: number,
    ): LocalProcedureEvent | undefined {
        const state = this._timeline.resolve(parts, offset, procedureEventKinds);
        if (!state?.exists || !state.event) return undefined;
        return {
            offset: state.event.offset,
            create: true,
            parts: state.event.parts,
            parameters: state.parameters ?? [],
        };
    }

    /** Parameters of a document-local procedure visible at this source offset. */
    public localProcedureParameters(
        parts: readonly string[],
        offset: number,
    ): readonly ParameterMetadata[] | undefined {
        return this.localProcedureAt(parts, offset)?.parameters;
    }

    /**
     * The bound type of the expression at an offset, when only a known one should be believed.
     *
     * An inferred or unknown type is not evidence: a rule that reports a mismatch has to be sure
     * of both sides, and this side is the one the service inferred.
     */
    private boundTypeAt(offset: number): string | undefined {
        let best: BoundExpression | undefined;
        for (const entry of this._expressions) {
            if (entry.range.start > offset || offset > entry.range.end) continue;
            if (!best || entry.range.end - entry.range.start < best.range.end - best.range.start) {
                best = entry;
            }
        }
        return best?.type.confidence === "known" ? best.type.displayName : undefined;
    }

    public userTypeAt(parts: readonly string[], offset: number): UserTypeResolution {
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
        const local = this._timeline.resolve(parts, offset, typeEventKinds);
        if (local) {
            state =
                local.exists && local.typeCategory
                    ? { kind: "resolved", typeCategory: local.typeCategory }
                    : { kind: "notFound" };
        }
        return state;
    }

    public isInstanceTableMethod(node: SyntaxNode, parts: readonly string[]): boolean {
        if (parts.at(-1)?.toUpperCase() !== "NODES" || parts.length < 2) return false;
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

    /** Declared variable type visible at an offset, shared with member diagnostics. */
    public variableTypeAt(name: string, offset: number): string | undefined {
        return this.variableAt(name, offset, false)?.typeDisplay;
    }

    /** Immutable declaration index shared with variable diagnostics. */
    public variableDeclarations(): readonly VariableDeclaration[] {
        return this._variableDeclarations;
    }

    /** Whether a matching declaration is visible in the parser-owned scope at an offset. */
    public variableDeclaredAt(name: string, offset: number, requireTable: boolean): boolean {
        return this.variableAt(name, offset, requireTable) !== undefined;
    }

    /** Table-variable shape visible at an offset, shared with DML diagnostics. */
    public tableVariableColumnsAt(
        name: string,
        offset: number,
    ): readonly ColumnMetadata[] | undefined {
        return this.variableAt(name, offset, true)?.columns;
    }

    /** System-type registry query shared with member diagnostics. */
    public isKnownSystemDataType(parts: readonly string[], name: string, source: string): boolean {
        return isSystemDataType(parts, name, source);
    }

    /** Display owner for a parser-owned table definition. */
    public tableDefinitionOwner(definition: SyntaxNode): string {
        return tableDefinitionOwner(this._syntax, definition);
    }

    /** Parser-owned column declarations shared with table and foreign-key diagnostics. */
    public definitionColumns(root: SyntaxNode): readonly ColumnMetadata[] {
        return definitionColumns(this._syntax, root);
    }

    /** Catalog-aware multipart object identity shared with foreign-key diagnostics. */
    public sameObjectName(left: readonly string[], right: readonly string[]): boolean {
        return sameObjectName(left, right, this._metadata);
    }

    public isCteReference(node: SyntaxNode, parts: readonly string[]): boolean {
        if (parts.length !== 1) return false;
        return Boolean(findCte(this._syntax, node, parts[0]!, this._metadata));
    }

    public source(node: TextRange): string {
        return this._text.slice(node.start, node.end);
    }

    /**
     * Every node of `kind` the current pass is allowed to look at.
     *
     * Narrowed by binary search rather than by filtering the bucket. Validating one edited batch
     * used to walk every node of that kind in the document, once for each of the rules that asked,
     * which is what made a keystroke in a large script cost time proportional to the whole script
     * instead of to the part that changed.
     *
     * Cached per kind because several rules ask for the same one, and neither the index nor the
     * ranges change for the lifetime of this validator.
     */
    public nodes(kind: string): readonly SyntaxNode[] {
        const nodes = this._index.get(kind) ?? [];
        if (!this._validationRanges) return nodes;
        const cached = this._nodesInRange.get(kind);
        if (cached) return cached;
        const selected = itemsWithinRanges(nodes, this._validationRanges, (node) => node);
        this._nodesInRange.set(kind, selected);
        return selected;
    }

    public fold(value: string): string {
        return this._metadata.environment.caseSensitive
            ? normalizeIdentifier(value)
            : normalizeIdentifier(value).toLowerCase();
    }

    public equal(left: string, right: string): boolean {
        return this.fold(left) === this.fold(right);
    }

    public databaseMissing(name: string): boolean {
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

    public principalExistsAt(
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

    public add(code: string, message: string, range: TextRange): void {
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

interface QuerySource {
    readonly node: SyntaxNode;
    readonly exposedName: string;
    readonly exposedRange: TextRange;
    readonly alias: boolean;
    readonly objectName: string;
    readonly scopeDepth: number;
    readonly columns?: readonly ColumnMetadata[];
}

/**
 * The document's local DDL as one ordered event list.
 *
 * The collectors below are the only implementation of same-document `CREATE`/`ALTER`/`DROP`
 * visibility. Publishing their result as a timeline is what lets completion, hover, definition,
 * and signature help agree with diagnostics instead of each rediscovering local DDL.
 */
export function collectCatalogTimelineEvents(
    syntax: SyntaxSnapshot,
    index?: ReadonlyMap<string, readonly SyntaxNode[]>,
    published?: TsqlSemanticDiagnosticState,
): readonly CatalogTimelineEvent[] {
    // Reuse the validator's own indexes when the caller holds them. Collecting a second time would
    // walk the whole document again to produce the same answer, and two collections are two things
    // that can drift.
    if (published instanceof CachedTsqlSemanticDiagnosticState) {
        return timelineEventsFromState(published);
    }
    const structural = index ?? syntax.structuralIndex?.() ?? indexSyntax([syntax.root()]);
    const events: CatalogTimelineEvent[] = [];
    for (const event of collectLocalRelationEvents(syntax, structural)) {
        events.push(relationTimelineEvent(event));
    }
    for (const event of collectLocalProcedureEvents(syntax, structural)) {
        events.push(procedureTimelineEvent(event));
    }
    for (const event of collectLocalTypeEvents(syntax, structural)) {
        events.push(typeTimelineEvent(event));
    }
    return Object.freeze(events.sort((left, right) => left.offset - right.offset));
}

function timelineEventsFromState(
    state: CachedTsqlSemanticDiagnosticState,
): readonly CatalogTimelineEvent[] {
    const events: CatalogTimelineEvent[] = [];
    for (const timeline of state.localRelations.values()) {
        for (const event of timeline) events.push(relationTimelineEvent(event));
    }
    for (const timeline of state.localProcedures.values()) {
        for (const event of timeline) events.push(procedureTimelineEvent(event));
    }
    for (const timeline of state.localTypes.values()) {
        for (const event of timeline) events.push(typeTimelineEvent(event));
    }
    return Object.freeze(events.sort((left, right) => left.offset - right.offset));
}

function relationTimelineEvent(event: LocalRelationEvent): CatalogTimelineEvent {
    return {
        offset: event.offset,
        action: event.create ? "create" : "drop",
        parts: event.parts,
        kind: event.kind,
        ...(event.declaration ? { declaration: event.declaration } : {}),
        ...(event.columns ? { columns: event.columns } : {}),
        ...(event.parameters ? { parameters: event.parameters } : {}),
    };
}

function procedureTimelineEvent(event: LocalProcedureEvent): CatalogTimelineEvent {
    return {
        offset: event.offset,
        action: event.create ? "create" : "drop",
        parts: event.parts,
        kind: "procedure",
        parameters: event.parameters,
    };
}

function typeTimelineEvent(event: LocalTypeEvent): CatalogTimelineEvent {
    return {
        offset: event.offset,
        action: event.create ? "create" : "drop",
        parts: event.parts,
        kind: "type",
        typeCategory: event.typeCategory,
    };
}

interface LocalRelationEvent {
    readonly offset: number;
    readonly create: boolean;
    readonly parts: readonly string[];
    readonly kind: "table" | "view" | "tableFunction" | "synonym";
    readonly declaration?: TextRange;
    /** Parameters declared by a document-local table-valued function. */
    readonly parameters?: readonly ParameterMetadata[];
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

class CachedTsqlSemanticDiagnosticState implements TsqlSemanticDiagnosticState {
    public constructor(
        public readonly documentLength: number,
        public readonly metadataGeneration: number,
        public readonly localRelations: ReadonlyMap<string, readonly LocalRelationEvent[]>,
        public readonly localProcedures: ReadonlyMap<string, readonly LocalProcedureEvent[]>,
        public readonly localLogins: ReadonlyMap<string, readonly LocalLoginEvent[]>,
        public readonly localTypes: ReadonlyMap<string, readonly LocalTypeEvent[]>,
    ) {}
}

type UserTypeResolution =
    | { readonly kind: "resolved"; readonly typeCategory: "alias" | "clr" | "table" }
    | { readonly kind: "notFound" }
    | { readonly kind: "unknown" };

interface VariableDeclaration {
    readonly name: string;
    readonly node: TextRange;
    readonly scope: string;
    /** The declared type as written, used to bind member access on the variable. */
    readonly typeDisplay?: string;
    readonly columns?: readonly ColumnMetadata[];
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
            declaration: { start: name.start, end: name.end },
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
                declaration: { start: name.start, end: name.end },
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
                declaration: { start: name.start, end: name.end },
                parameters: collectRoutineParameters(syntax, node),
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
            declaration: { start: name.start, end: name.end },
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
            declaration: { start: name.start, end: name.end },
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
            declaration: { start: name.start, end: name.end },
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
                parameters: collectRoutineParameters(syntax, node),
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

function collectRoutineParameters(
    syntax: SyntaxSnapshot,
    node: SyntaxNode,
): readonly ParameterMetadata[] {
    return descendantsOwnedBy(node, "ProcedureParameter", node).map((parameter, index) => {
        const variable = firstDescendant(parameter, "Variable");
        const dataType = firstDescendant(parameter, "DataType");
        const source = syntax.document.text.slice(parameter.start, parameter.end);
        const facts = routineParameterTextFacts(source);
        return {
            ordinal: index + 1,
            name: variable
                ? syntax.document.text.slice(variable.start, variable.end)
                : `@parameter${index + 1}`,
            ...(dataType
                ? { typeDisplay: syntax.document.text.slice(dataType.start, dataType.end) }
                : {}),
            output: facts.output,
            hasDefault: facts.hasDefault,
        };
    });
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
            const operation = localLoginOperation(source);
            const nameNode = firstDescendant(node, "IdentifierName");
            if (!operation || !nameNode) continue;
            events.push({
                offset: node.end,
                create: operation === "CREATE",
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
        events.push({
            offset: node.end,
            create: true,
            parts: multipartIdentifierParts(syntax.document.text.slice(name.start, name.end)),
            typeCategory: localTypeCategory(syntax.document.text.slice(node.start, node.end)),
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
        // A multi-statement table-valued function names its return table in RETURNS, which declares
        // that variable for the whole body exactly as a table-variable DECLARE would.
        ...(index.get("FunctionTableReturnType") ?? []),
    ]
        .map((declaration): VariableDeclaration | undefined => {
            const variable = firstDescendant(declaration, "Variable");
            if (!variable) return undefined;
            const definition = firstDescendant(declaration, "TableDefinition");
            const dataType = firstDescendant(declaration, "DataType");
            return {
                name: syntax.document.text.slice(variable.start, variable.end),
                node: variable,
                scope: nodeKey(scopeAt(syntax.root(), declaration.start)),
                ...(dataType
                    ? { typeDisplay: syntax.document.text.slice(dataType.start, dataType.end) }
                    : {}),
                ...(definition ? { columns: definitionColumns(syntax, definition) } : {}),
            };
        })
        .filter((value): value is VariableDeclaration => value !== undefined);

    // Recovery nodes retain statement text that the procedural scanner could not split. Preserve
    // declarations from that text so later references do not become phantom undeclared-variable
    // errors while the parser still exposes the unsupported region explicitly.
    for (const opaque of index.get("OpaqueSqlStatement") ?? []) {
        const source = syntax.document.text.slice(opaque.start, opaque.end);
        for (const recovered of recoveredVariableDeclarations(source, opaque.start)) {
            const { start, end } = recovered;
            if (declarations.some(({ node }) => node.start === start && node.end === end)) continue;
            declarations.push({
                name: recovered.name,
                node: { start, end },
                scope: nodeKey(scopeAt(syntax.root(), start)),
            });
        }
    }
    return Object.freeze(declarations.sort((left, right) => left.node.start - right.node.start));
}

function indexSyntax(roots: readonly SyntaxNode[]): ReadonlyMap<string, readonly SyntaxNode[]> {
    const mutable = new Map<string, SyntaxNode[]>();
    const pending = [...roots];
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
        const facts = columnDefinitionTextFacts(source);
        return [
            {
                name: normalizeIdentifier(syntax.document.text.slice(name.start, name.end)),
                ...(type ? { typeDisplay: syntax.document.text.slice(type.start, type.end) } : {}),
                nullable: facts.nullable,
                identity: facts.identity,
                computed: type === undefined && facts.computed,
            },
        ];
    });
    const primaryKeyNames: string[] = [];
    for (const column of directOwnedDescendants(root, "ColumnDefinition")) {
        if (
            columnDefinitionTextFacts(syntax.document.text.slice(column.start, column.end))
                .primaryKeyCount === 0
        ) {
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
            columnDefinitionTextFacts(syntax.document.text.slice(constraint.start, constraint.end))
                .primaryKeyCount === 0
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
            (name) => name.toLowerCase() === column.name.toLowerCase(),
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
        const stringAlias = directChildren(element, "StringLiteral").at(-1);
        if (stringAlias) {
            return [
                {
                    name: normalizeStringLiteral(
                        syntax.document.text.slice(stringAlias.start, stringAlias.end),
                    ),
                },
            ];
        }
        const identifierAlias = directChildren(element, "IdentifierName").at(-1);
        if (identifierAlias) {
            return [
                {
                    name: normalizeIdentifier(
                        syntax.document.text.slice(identifierAlias.start, identifierAlias.end),
                    ),
                },
            ];
        }
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
        const alias = recoveredSelectAlias(syntax.document.text.slice(element.start, element.end));
        if (alias) aliases.add(alias.toLowerCase());
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
    node: SyntaxNode,
    name: string,
    metadata: MetadataView,
): SyntaxNode | undefined {
    const statement = ancestor(node, "Statement");
    if (!statement) return undefined;
    const declarations = descendants(statement, "CommonTableExpression");
    const enclosing = ancestor(node, "CommonTableExpression");
    const lastVisible = enclosing
        ? declarations.findIndex(
              (candidate) => candidate.start === enclosing.start && candidate.end === enclosing.end,
          )
        : declarations.length - 1;
    return declarations.slice(0, lastVisible + 1).find((cte) => {
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
    return metadata.environment.caseSensitive ? normalized : normalized.toLowerCase();
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
    return metadata.environment.caseSensitive ? a === b : a.toLowerCase() === b.toLowerCase();
}

function setOperatorTerms(node: SyntaxNode): SyntaxNode[] {
    const terms: SyntaxNode[] = [];
    for (const child of node.children()) {
        if (child.kind === "SelectQueryExpression") {
            terms.push(...setOperatorTerms(child));
            continue;
        }
        if (
            child.kind === "QuerySpecification" ||
            child.kind === "QueryTerm" ||
            child.kind === "QueryPrimary" ||
            child.kind === "ParenthesizedQuery"
        ) {
            terms.push(child);
        }
    }
    return terms;
}

function nodeKey(node: SyntaxNode): string {
    return `${node.kind}:${node.start}:${node.end}`;
}

function identifierPartRange(node: SyntaxNode, text: string, partIndex: number): TextRange {
    return multipartIdentifierPartRange(text, node.start, partIndex, node);
}

function lastIdentifierRange(node: SyntaxNode, text: string): TextRange {
    return lastMultipartIdentifierPartRange(text, node.start, node);
}

function freezeRange(range: TextRange): TextRange {
    return Object.freeze({ start: range.start, end: range.end });
}

function isSystemDataType(parts: readonly string[], parsedName: string, source: string): boolean {
    const normalizedSource = normalizedSystemDataTypeText(source);
    const known =
        normalizeSystemDataTypeName(normalizedSource) !== undefined ||
        normalizeSystemDataTypeName(parsedName) !== undefined;
    if (!known) return false;
    return parts.length <= 1 || (parts.length === 2 && parts[0]!.toLowerCase() === "sys");
}

function isFunctionOptionArgument(syntax: SyntaxSnapshot, node: SyntaxNode): boolean {
    const call = ancestor(node, "FunctionCall");
    if (!call) return false;
    const nameNode = firstDescendant(call, "MultipartIdentifier");
    const argumentList = firstDescendant(call, "ArgumentList");
    const arguments_ = argumentList ? directChildren(argumentList, "Expression") : [];
    if (!nameNode) return false;
    const name = syntax.document.text.slice(nameNode.start, nameNode.end).trim().toUpperCase();
    const optionIndex = name === "ISJSON" ? 1 : datePartFunctions.has(name) ? 0 : -1;
    const option = arguments_[optionIndex];
    return Boolean(option && option.start <= node.start && node.end <= option.end);
}

const builtInTableFunctions = new Set([
    "AI_GENERATE_CHUNKS",
    "CHANGETABLE",
    "GENERATE_SERIES",
    "OPENJSON",
    "OPENROWSET",
    "OPENXML",
    "SEMANTIC_SEARCH",
    "STRING_SPLIT",
    "VECTOR_SEARCH",
]);

/** Only a UDT or XML column can carry a callable member, so only those keep a four-part call valid. */
function memberBearingColumnType(typeDisplay: string | undefined): boolean {
    if (!typeDisplay) return true;
    const normalized = normalizedSystemDataTypeText(typeDisplay);
    const systemType = normalizeSystemDataTypeName(normalized);
    if (systemType === "xml") return true;
    return systemType === undefined;
}

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

const datePartFunctions = new Set([
    "DATEADD",
    "DATEDIFF",
    "DATEDIFF_BIG",
    "DATENAME",
    "DATEPART",
    "DATE_BUCKET",
]);
