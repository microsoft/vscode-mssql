/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    createLineIndex,
    extractDeclarations,
    extractReferences,
    getCompletionsAtFromAnalysis,
    matchesCompletionFilter,
    Lexer,
    resolveTypeMember,
    walkAST,
    type AnalysisResult,
    type ASTNode,
    type ColumnNode,
    type ExtractedDeclaration,
    type ExtractedReference,
    type Scope as SaralScope,
    type Statement,
    type Symbol as SaralSymbol,
    type SymbolKind as SaralSymbolKind,
    type TokenType,
} from "../parser/saral/index.js";
import {
    IncrementalBatchAnalyzer,
    type IncrementalAnalysisSnapshot,
    type IncrementalParseStatistics,
} from "../parser/incremental/incrementalBatchParser.js";
import type { DocumentSchemaEvolution } from "../semantic/index.js";
import {
    createDocumentSchemaEvolution,
    DocumentSchemaCatalogProvider,
} from "./documentSchemaCatalog.js";
import type {
    SqlAnalysisCapabilities,
    SqlAnalysisEngine,
    SqlAnalysisInput,
    SqlAnalysisSnapshot,
    SqlAnalysisUpdate,
    SqlClause,
    SqlCompletion,
    SqlCompletionKind,
    SqlCompletionResult,
    SqlDiagnostic,
    SqlExpandedColumn,
    SqlExternalReference,
    SqlMutationTarget,
    SqlColumnLineage,
    SqlOrigin,
    SqlPosition,
    SqlReferences,
    SqlScope,
    SqlScopeSource,
    SqlSpan,
    SqlStatement,
    SqlStatementCategory,
    SqlSymbol,
    SqlSymbolKind,
    SqlToken,
    SqlTokenRole,
    SqlType,
    SqlCatalogProvider,
    SqlCatalogColumn,
} from "../analysis/contracts.js";

const supported = Object.freeze({ level: "supported" as const });
const partial = (detail: string) => Object.freeze({ level: "partial" as const, detail });

// Keep the adapter decoupled from parser enum runtime representation.
const saralTokenType = Object.freeze({
    Keyword: 0 as TokenType,
    Identifier: 1 as TokenType,
    Variable: 2 as TokenType,
    TempTable: 3 as TokenType,
    Operator: 4 as TokenType,
    Number: 5 as TokenType,
    String: 6 as TokenType,
    OpenParen: 7 as TokenType,
    CloseParen: 8 as TokenType,
    Semicolon: 9 as TokenType,
    EOF: 10 as TokenType,
    Comma: 11 as TokenType,
    Dot: 12 as TokenType,
});

const saralTokenNames = Object.freeze([
    "Keyword",
    "Identifier",
    "Variable",
    "TempTable",
    "Operator",
    "Number",
    "String",
    "OpenParen",
    "CloseParen",
    "Semicolon",
    "EOF",
    "Comma",
    "Dot",
]);

const saralSymbolKind = Object.freeze({
    Variable: "Variable" as SaralSymbolKind,
    Parameter: "Parameter" as SaralSymbolKind,
    Table: "Table" as SaralSymbolKind,
    Column: "Column" as SaralSymbolKind,
    Alias: "Alias" as SaralSymbolKind,
    CTE: "CTE" as SaralSymbolKind,
    Procedure: "Procedure" as SaralSymbolKind,
    Function: "Function" as SaralSymbolKind,
    TempTable: "TempTable" as SaralSymbolKind,
    Type: "Type" as SaralSymbolKind,
});

/** Vendored Saral capabilities, kept explicit so partial support is never presented as complete. */
export const saralSqlCapabilities: SqlAnalysisCapabilities = Object.freeze({
    incrementalUpdate: partial(
        "Reuses unchanged GO-separated parse artifacts; semantic analysis is still whole-program.",
    ),
    syntaxDiagnostics: partial(
        "Reports lexer/parser issues, but some truncated editor inputs produce no diagnostic.",
    ),
    semanticDiagnostics: partial(
        "Provides document-local diagnostics plus catalog-backed object and column validation; generated rowsets use conservative validation.",
    ),
    lexicalTokens: partial("Code and comments are available; insignificant whitespace is omitted."),
    statements: supported,
    scopes: partial("Provides lexical scopes but no catalog-enriched source shapes."),
    symbols: partial(
        "Local declarations, references, and catalog-enriched column identities are available.",
    ),
    completion: partial(
        "Uses cached analysis and adds qualified catalog columns when the source can be resolved safely.",
    ),
    references: partial("Document-local references only; external identity is name-based."),
    typeLookup: partial(
        "Includes declared-symbol types and qualified catalog column types, not arbitrary expression inference.",
    ),
    lineage: partial("Structural column lineage is not validated against an external catalog."),
    externalReferences: partial(
        "Extracts common query, DML, and routine references; ALTER and DROP targets are omitted.",
    ),
    mutationTargets: partial("Normalizes INSERT, UPDATE, DELETE, and MERGE targets."),
    starExpansion: supported,
    signatureHelp: partial("Built-in and catalog routine signatures are available."),
    clauseGeometry: partial("Normalizes common SELECT clauses and their source ranges."),
    reservedWords: supported,
    identifierNormalization: partial(
        "Normalizes ordinary, bracketed, and double-quoted multipart T-SQL identifiers.",
    ),
    catalogAwareAnalysis: partial(
        "Validates external object existence and enriches qualified column completion/type lookup.",
    ),
});

/** SaralSQL implementation of the parser-independent analysis boundary. */
export class SaralSqlAnalysisEngine implements SqlAnalysisEngine {
    private readonly analyzer = new IncrementalBatchAnalyzer();

    public readonly id = "saralsql";
    public readonly displayName = "SaralSQL";
    public readonly version = "vendored-e95951c";
    public readonly capabilities = saralSqlCapabilities;

    public createSnapshot(input: SqlAnalysisInput): SqlAnalysisSnapshot {
        return SaralSqlAnalysisSnapshot.create(input, 1, this.analyzer);
    }

    public updateSnapshot(
        previous: SqlAnalysisSnapshot,
        update: SqlAnalysisUpdate,
    ): SqlAnalysisSnapshot {
        if (previous instanceof SaralSqlAnalysisSnapshot) {
            return previous.update(update, this.analyzer);
        }
        return SaralSqlAnalysisSnapshot.create(
            {
                text: update.text,
                uri: update.uri ?? previous.uri,
                catalog: update.catalog ?? undefined,
            },
            1,
            this.analyzer,
        );
    }
}

class SaralSqlAnalysisSnapshot implements SqlAnalysisSnapshot {
    public readonly engineId = "saralsql";
    public readonly syntaxDiagnostics: readonly SqlDiagnostic[];
    public readonly semanticDiagnostics: readonly SqlDiagnostic[];
    public readonly tokens: readonly SqlToken[];
    public readonly statements: readonly SqlStatement[];
    public readonly scopes: readonly SqlScope[];
    /** Exposed for benchmark/test observability without widening the engine-neutral contract. */
    public readonly incrementalStatistics: IncrementalParseStatistics;

    private readonly _lineIndex;
    private readonly _symbols: readonly SqlSymbol[];
    private readonly _declarations: readonly ExtractedDeclaration[];
    private readonly _extractedReferences: readonly ExtractedReference[];
    private readonly _externalReferenceList: readonly SqlExternalReference[];
    private readonly _scopeByNative = new Map<SaralScope, SqlScope>();

    private constructor(
        public readonly text: string,
        public readonly uri: string | undefined,
        public readonly version: number,
        private readonly _incremental: IncrementalAnalysisSnapshot,
        catalog: SqlCatalogProvider | undefined,
    ) {
        const _analysis = _incremental.analysisResult();
        this._analysis = _analysis;
        this._baseCatalog = catalog;
        this._documentSchema = createDocumentSchemaEvolution(_analysis, uri);
        this.incrementalStatistics = Object.freeze({ ..._incremental.statistics });
        this._lineIndex = createLineIndex(text);
        this.tokens = Object.freeze(readTokens(text, this.positionAt.bind(this)));
        const diagnostics = _analysis.diagnostics.map((diagnostic) =>
            normalizeParserDiagnostic(
                Object.freeze({
                    kind:
                        diagnostic.source === "semantic"
                            ? ("semantic" as const)
                            : ("syntax" as const),
                    code: diagnostic.code,
                    message: diagnostic.message,
                    span: freezeSpan(diagnostic.start, diagnostic.end, text.length),
                    severity:
                        diagnostic.severity === "info"
                            ? ("information" as const)
                            : diagnostic.severity,
                }),
                this.tokens,
                text,
            ),
        );
        this.syntaxDiagnostics = Object.freeze(
            deduplicateDiagnostics([
                ...diagnostics.filter((diagnostic) => diagnostic.kind === "syntax"),
                ...structuralSyntaxDiagnostics(this.text, this.tokens),
            ]).filter((diagnostic) => !isNamedWindowParserArtifact(this.text, diagnostic)),
        );
        this.statements = Object.freeze(mapStatements(_analysis, text.length));
        this.scopes = Object.freeze(this.mapScopes(_analysis.scope.root));
        this._declarations = Object.freeze(
            safely(() => extractDeclarations(_analysis.ast), [] as ExtractedDeclaration[]),
        );
        this._extractedReferences = Object.freeze(
            safely(() => extractReferences(_analysis.ast), [] as ExtractedReference[]),
        );
        this._externalReferenceList = Object.freeze(
            buildExternalReferences(
                this._extractedReferences,
                this._declarations,
                this._analysis,
                this.text,
            ),
        );
        this._symbols = Object.freeze(
            mapSymbols(
                _analysis,
                text,
                this._declarations,
                this._extractedReferences,
                this.tokens,
                this.statements,
                (offset) => this.catalogAt(offset),
            ),
        );
        this.semanticDiagnostics = Object.freeze([
            ...diagnostics.filter(
                (diagnostic) => diagnostic.kind === "semantic" && diagnostic.severity === "error",
            ),
            ...catalogObjectDiagnostics(
                this._baseCatalog,
                this.externalReferences(),
                this._analysis,
                this.text,
                this._documentSchema,
            ),
            ...catalogColumnDiagnostics(
                this._baseCatalog,
                this.externalReferences(),
                this.tokens,
                this.statements,
                this.text,
                this._documentSchema,
            ),
        ]);
    }

    private readonly _analysis: AnalysisResult;
    private readonly _baseCatalog: SqlCatalogProvider | undefined;
    private readonly _documentSchema: DocumentSchemaEvolution;

    public static create(
        input: SqlAnalysisInput,
        version: number,
        analyzer: IncrementalBatchAnalyzer,
    ): SaralSqlAnalysisSnapshot {
        return new SaralSqlAnalysisSnapshot(
            input.text,
            input.uri,
            version,
            analyzer.create(input.text, version),
            input.catalog,
        );
    }

    public update(
        update: SqlAnalysisUpdate,
        analyzer: IncrementalBatchAnalyzer,
    ): SaralSqlAnalysisSnapshot {
        const version = this.version + 1;
        return new SaralSqlAnalysisSnapshot(
            update.text,
            update.uri ?? this.uri,
            version,
            analyzer.update(this._incremental, update.text, version),
            update.catalog === undefined ? this._baseCatalog : (update.catalog ?? undefined),
        );
    }

    public positionAt(offset: number): SqlPosition {
        return this._lineIndex.offsetToPosition(clamp(offset, 0, this.text.length));
    }

    public offsetAt(position: SqlPosition): number {
        return clamp(this._lineIndex.positionToOffset(position), 0, this.text.length);
    }

    public scopeAt(offset: number): SqlScope | undefined {
        return this._scopeByNative.get(
            this._analysis.scope.root.findInnermost(clamp(offset, 0, this.text.length)),
        );
    }

    public clausesAt(offset: number): readonly SqlClause[] {
        const boundedOffset = clamp(offset, 0, this.text.length);
        const statement = this.statements.find(
            (candidate) =>
                candidate.span.start <= boundedOffset && boundedOffset <= candidate.span.end,
        );
        if (!statement) {
            return [];
        }
        const anchors: { kind: SqlClause["kind"]; span: SqlSpan }[] = [];
        const tokens = this.tokens.filter(
            (token) =>
                token.channel === "code" &&
                statement.span.start <= token.span.start &&
                token.span.end <= statement.span.end,
        );
        for (let index = 0; index < tokens.length; index++) {
            const token = tokens[index];
            const word = token.text.toLocaleUpperCase();
            const next = tokens[index + 1]?.text.toLocaleUpperCase();
            const kind = clauseKind(word, next);
            if (!kind) {
                continue;
            }
            const end =
                (word === "GROUP" || word === "ORDER") && next === "BY"
                    ? tokens[index + 1].span.end
                    : token.span.end;
            anchors.push({ kind, span: freezeSpan(token.span.start, end, this.text.length) });
        }
        return Object.freeze(
            anchors.map((anchor, index) =>
                Object.freeze({
                    kind: anchor.kind,
                    anchorSpan: anchor.span,
                    span: freezeSpan(
                        anchor.span.start,
                        anchors[index + 1]?.span.start ?? statement.span.end,
                        this.text.length,
                    ),
                }),
            ),
        );
    }

    public symbols(): readonly SqlSymbol[] {
        return this._symbols;
    }

    public symbolAt(offset: number): SqlSymbol | undefined {
        return this._symbols
            .filter((symbol) => symbol.span.start <= offset && offset < symbol.span.end)
            .sort(
                (left, right) =>
                    Number(right.kind === "column" && right.name.includes(".")) -
                        Number(left.kind === "column" && left.name.includes(".")) ||
                    Number(Boolean(right.type)) - Number(Boolean(left.type)) ||
                    spanWidth(left.span) - spanWidth(right.span) ||
                    Number(Boolean(right.definition)) - Number(Boolean(left.definition)),
            )[0];
    }

    public completeAt(offset: number): SqlCompletionResult {
        const boundedOffset = clamp(offset, 0, this.text.length);
        const catalog = this.catalogAt(boundedOffset);
        try {
            const nativeItems = getCompletionsAtFromAnalysis(
                this.text,
                this._analysis,
                boundedOffset,
            );
            const items: SqlCompletion[] = nativeItems.map((item) => {
                const kind = mapCompletionKind(item.kind);
                return Object.freeze({
                    label: item.label,
                    kind,
                    detail: item.detail,
                    documentation: completionDocumentation(item.label, kind, item.detail),
                });
            });
            const qualified = qualifiedCompletionPrefix(this.text, boundedOffset);
            if (qualified) {
                const columns = this.catalogColumnsForQualifier(qualified.qualifier, boundedOffset);
                if (columns) {
                    for (const column of columns) {
                        if (
                            !matchesCompletionFilter(column.name, qualified.filter) ||
                            items.some(
                                (item) =>
                                    item.kind === "column" &&
                                    foldName(item.label) === foldName(column.name),
                            )
                        ) {
                            continue;
                        }
                        items.push(
                            Object.freeze({
                                label: column.name,
                                kind: "column" as const,
                                detail: column.type,
                                documentation: completionDocumentation(
                                    column.name,
                                    "column",
                                    column.type,
                                ),
                            }),
                        );
                    }
                    items.sort((left, right) => left.label.localeCompare(right.label));
                }
            } else if (isColumnCompletionPosition(this.text, boundedOffset)) {
                for (const column of this.catalogColumnsVisibleAt(boundedOffset)) {
                    if (
                        items.some(
                            (item) =>
                                item.kind === "column" &&
                                foldName(item.label) === foldName(column.name),
                        )
                    ) {
                        continue;
                    }
                    items.push(
                        Object.freeze({
                            label: column.name,
                            kind: "column" as const,
                            detail: column.type,
                            documentation: completionDocumentation(
                                column.name,
                                "column",
                                column.type,
                            ),
                        }),
                    );
                }
                items.sort((left, right) => left.label.localeCompare(right.label));
            }
            const relationPrefix = relationCompletionPrefix(this.text, boundedOffset);
            if (relationPrefix && catalog.childrenOf) {
                for (const child of catalog.childrenOf(relationPrefix.prefixParts)) {
                    if (
                        !child.name
                            .toLocaleLowerCase()
                            .startsWith(relationPrefix.filter.toLocaleLowerCase()) ||
                        items.some(
                            (item) =>
                                item.kind === child.kind &&
                                foldName(item.label) === foldName(child.name),
                        )
                    ) {
                        continue;
                    }
                    items.push(
                        Object.freeze({
                            label: child.name,
                            kind: child.kind,
                            detail:
                                child.kind === "namespace"
                                    ? "Database or schema"
                                    : "Catalog relation",
                            documentation: completionDocumentation(child.name, child.kind),
                        }),
                    );
                }
                items.sort((left, right) => left.label.localeCompare(right.label));
            }
            const functionPrefix = identifierPrefixAt(this.text, boundedOffset);
            if (
                !qualified &&
                functionPrefix.text.length > 0 &&
                isFunctionCompletionPosition(this.text, functionPrefix.start)
            ) {
                for (const functionName of builtinFunctionNames) {
                    if (
                        !functionName.startsWith(functionPrefix.text.toLocaleLowerCase()) ||
                        items.some((item) => foldName(item.label) === foldName(functionName))
                    ) {
                        continue;
                    }
                    items.push(
                        Object.freeze({
                            label: functionName,
                            kind: "function" as const,
                            detail: "Built-in T-SQL function",
                            documentation: `Built-in T-SQL function \`${functionName}\`.`,
                        }),
                    );
                }
            }
            if (isInsertTargetListPosition(this.text, boundedOffset)) {
                for (const label of ["VALUES", "SELECT"] as const) {
                    if (!items.some((item) => foldName(item.label) === foldName(label))) {
                        items.push(
                            Object.freeze({
                                label,
                                kind: "keyword" as const,
                                detail: "T-SQL keyword",
                                documentation: completionDocumentation(label, "keyword"),
                            }),
                        );
                    }
                }
            }
            const first = nativeItems[0];
            return Object.freeze({
                items: Object.freeze(items),
                replaceSpan: qualified
                    ? freezeSpan(qualified.filterStart, boundedOffset, this.text.length)
                    : relationPrefix
                      ? freezeSpan(relationPrefix.filterStart, boundedOffset, this.text.length)
                      : functionPrefix.text
                        ? freezeSpan(functionPrefix.start, boundedOffset, this.text.length)
                        : first
                          ? freezeSpan(first.start, first.end, this.text.length)
                          : undefined,
            });
        } catch {
            return Object.freeze({ items: Object.freeze([]) });
        }
    }

    public referencesAt(offset: number): SqlReferences | undefined {
        const target = this.symbolAt(offset);
        if (!target) {
            return undefined;
        }
        const sameIdentity = (symbol: SqlSymbol): boolean => {
            if (symbol.kind !== target.kind) {
                return false;
            }
            if (
                target.definition &&
                ((symbol.modifiers.includes("declaration") &&
                    spansOverlapDefinition(symbol.span, target.definition)) ||
                    (symbol.definition && spansEqual(symbol.definition, target.definition)))
            ) {
                return true;
            }
            return foldName(symbol.name) === foldName(target.name);
        };
        const matches = this._symbols.filter((symbol) => {
            if (!sameIdentity(symbol)) {
                return false;
            }
            if (!target.definition) {
                return !symbol.definition || symbol.modifiers.includes("declaration");
            }
            return (
                spansEqual(symbol.definition, target.definition) ||
                (symbol.modifiers.includes("declaration") &&
                    spansOverlapDefinition(symbol.span, target.definition))
            );
        });
        const declaration = matches
            .filter((symbol) => symbol.modifiers.includes("declaration"))
            .sort(
                (left, right) =>
                    Number(
                        Boolean(target.definition && spansEqual(right.span, target.definition)),
                    ) -
                        Number(
                            Boolean(target.definition && spansEqual(left.span, target.definition)),
                        ) || spanWidth(left.span) - spanWidth(right.span),
            )[0]?.span;
        return Object.freeze({
            symbol:
                target.kind === "column"
                    ? unquoteIdentifier(target.name.split(".").at(-1) ?? target.name)
                    : target.name,
            kind: target.kind,
            declaration,
            occurrences: Object.freeze(
                deduplicateSpans(matches).map((symbol) =>
                    Object.freeze({
                        span: symbol.span,
                        role: symbol.modifiers.includes("declaration")
                            ? ("declaration" as const)
                            : ("reference" as const),
                    }),
                ),
            ),
        });
    }

    public typeAt(offset: number): SqlType {
        const local = this.symbolAt(offset)?.type;
        if (local) {
            return local;
        }
        const aggregate = aggregateCallAt(this.tokens, offset);
        if (aggregate) {
            const column = this.catalogColumnsForQualifier(aggregate.qualifier, offset)?.find(
                (candidate) => foldName(candidate.name) === foldName(aggregate.column),
            );
            const aggregateType = column?.type
                ? aggregateResultType(aggregate.functionName, column.type)
                : undefined;
            if (aggregateType) {
                return aggregateType;
            }
        }
        const typeMember = qualifiedTypeMemberAt(this.tokens, offset);
        if (typeMember) {
            const receiver = this.catalogColumnsForQualifier(typeMember.qualifier, offset)?.find(
                (candidate) => foldName(candidate.name) === foldName(typeMember.column),
            );
            const member = resolveTypeMember(receiver?.type, typeMember.member);
            if (member?.returnType) {
                return typeFromText(member.returnType)!;
            }
        }
        const qualified = qualifiedColumnAt(this.tokens, offset);
        if (!qualified) {
            return unknownType;
        }
        const column = this.catalogColumnsForQualifier(qualified.qualifier, offset)?.find(
            (candidate) => foldName(candidate.name) === foldName(qualified.column),
        );
        return column?.type ? typeFromText(column.type)! : unknownType;
    }

    public externalReferences(): readonly SqlExternalReference[] {
        return this._externalReferenceList;
    }

    public mutationTargets(): readonly SqlMutationTarget[] {
        const targets: SqlMutationTarget[] = [];
        for (const reference of this._extractedReferences) {
            const operation = mutationOperation(reference.context);
            if (operation) {
                targets.push(
                    Object.freeze({
                        operation,
                        target: mapExternalReference(reference, this.text),
                    }),
                );
            }
        }
        for (const statement of this._analysis.ast.body) {
            const merge = mergeMutationTarget(statement, this.text);
            if (merge) {
                targets.push(merge);
            }
        }
        return Object.freeze(
            targets.filter(
                (target, index, all) =>
                    all.findIndex(
                        (candidate) =>
                            candidate.operation === target.operation &&
                            candidate.target.span.start === target.target.span.start &&
                            candidate.target.span.end === target.target.span.end,
                    ) === index,
            ),
        );
    }

    public lineage(): readonly SqlColumnLineage[] {
        return Object.freeze(
            this._analysis.lineage.columns.map((column) =>
                Object.freeze({
                    output: column.name,
                    origins: Object.freeze(
                        deduplicateOrigins(
                            column.inputs
                                .map((input): SqlOrigin | undefined => {
                                    const parts = input.name.split(".");
                                    const columnName = parts.pop();
                                    const table = input.source?.split(".") ?? parts;
                                    return columnName && table.length > 0
                                        ? Object.freeze({
                                              table: Object.freeze(table),
                                              column: columnName,
                                          })
                                        : undefined;
                                })
                                .filter((origin): origin is SqlOrigin => origin !== undefined),
                        ),
                    ),
                }),
            ),
        );
    }

    public expandStarAt(offset: number): readonly SqlExpandedColumn[] | undefined {
        const catalog = this.catalogAt(offset);
        const codeTokens = this.tokens.filter((token) => token.channel === "code");
        const starIndex = codeTokens.findIndex(
            (token) => token.text === "*" && token.span.start <= offset && offset < token.span.end,
        );
        if (starIndex < 0) {
            return undefined;
        }
        const qualifier =
            codeTokens[starIndex - 1]?.text === "." ? codeTokens[starIndex - 2]?.text : undefined;
        if (qualifier) {
            const columns = this.catalogColumnsForQualifier(qualifier, offset);
            return columns
                ? Object.freeze(
                      columns.map((column) =>
                          Object.freeze({
                              name: column.name,
                              sourceKey: unquoteIdentifier(qualifier),
                          }),
                      ),
                  )
                : undefined;
        }
        const statement = this.statements.find(
            (candidate) => candidate.span.start <= offset && offset <= candidate.span.end,
        );
        const references = this.externalReferences().filter(
            (reference) =>
                reference.role === "read" &&
                reference.kind !== "function" &&
                (!statement || spansOverlap(reference.span, statement.span)),
        );
        const expanded = references.flatMap((reference) => {
            const columns = catalogColumnsFor(
                catalog,
                reference.nameParts ?? identifierParts(reference.name).map(unquoteIdentifier),
            );
            const sourceKey =
                sourceAliasAfter(this.text, reference.span) ??
                reference.nameParts?.at(-1) ??
                reference.name.split(".").at(-1)!;
            return (columns ?? []).map((column) => Object.freeze({ name: column.name, sourceKey }));
        });
        return expanded.length > 0 ? Object.freeze(expanded) : undefined;
    }

    public signatureAt(
        offset: number,
    ): import("../analysis/contracts.js").SqlSignatureHelp | undefined {
        const call = callAt(this.text, clamp(offset, 0, this.text.length));
        if (!call) {
            return undefined;
        }
        const object = this.catalogAt(offset).objectFor?.(
            identifierParts(call.name).map(unquoteIdentifier),
        );
        const parameters = object?.parameters?.map((parameter) => ({
            label: `${parameter.name}${parameter.type ? ` ${parameter.type}` : ""}`,
        }));
        const builtin = builtinSignatures[call.name.toLocaleUpperCase()];
        const labels = parameters ?? builtin;
        if (!labels) {
            return undefined;
        }
        return Object.freeze({
            signatures: Object.freeze([
                Object.freeze({
                    label:
                        call.name.toLocaleUpperCase() === "COALESCE"
                            ? `${call.name}(expression, ...)`
                            : `${call.name}(${labels.map((parameter) => parameter.label).join(", ")})`,
                    parameters: Object.freeze(labels.map((parameter) => Object.freeze(parameter))),
                }),
            ]),
            activeSignature: 0,
            activeParameter: Math.min(call.activeParameter, Math.max(0, labels.length - 1)),
        });
    }

    public isReservedKeyword(word: string): boolean {
        const lexer = new Lexer(word);
        const token = lexer.nextToken();
        return token.type === saralTokenType.Keyword && token.offset === 0;
    }

    public normalizeIdentifier(identifier: string, _kind: "table" | "other" = "other"): string {
        return identifierParts(identifier).map(unquoteIdentifier).join(".").toLocaleLowerCase();
    }

    public displayIdentifier(identifier: string): string {
        return identifierParts(identifier).map(unquoteIdentifier).join(".");
    }

    private catalogColumnsForQualifier(
        qualifier: string,
        offset: number,
    ): readonly SqlCatalogColumn[] | undefined {
        const catalog = this.catalogAt(offset);
        const scope = this._analysis.scope.root.findInnermost(clamp(offset, 0, this.text.length));
        const displayedQualifier = this.displayIdentifier(qualifier);
        const symbol = scope.resolve(displayedQualifier) ?? scope.resolve(qualifier);
        let sourceName: string | undefined;
        if (symbol?.metadata?.tableName && typeof symbol.metadata.tableName === "string") {
            sourceName = symbol.metadata.tableName;
        } else if (
            symbol?.kind === saralSymbolKind.Table ||
            symbol?.kind === saralSymbolKind.TempTable
        ) {
            sourceName = symbol.name;
        }
        if (!sourceName) {
            return undefined;
        }
        return catalogColumnsFor(catalog, identifierParts(sourceName).map(unquoteIdentifier));
    }

    private catalogColumnsVisibleAt(offset: number): readonly SqlCatalogColumn[] {
        const catalog = this.catalogAt(offset);
        const statement = this.statements.find(
            (candidate) => candidate.span.start <= offset && offset <= candidate.span.end,
        );
        const references = this.externalReferences().filter(
            (reference) =>
                reference.role === "read" &&
                reference.kind !== "function" &&
                reference.span.start < offset &&
                (!statement || spansOverlap(reference.span, statement.span)),
        );
        const columns = references.flatMap(
            (reference) =>
                catalogColumnsFor(
                    catalog,
                    reference.nameParts ?? identifierParts(reference.name).map(unquoteIdentifier),
                ) ?? [],
        );
        return columns.filter(
            (column, index) =>
                columns.findIndex(
                    (candidate) => foldName(candidate.name) === foldName(column.name),
                ) === index,
        );
    }

    private catalogAt(offset: number): SqlCatalogProvider {
        return new DocumentSchemaCatalogProvider(
            this._documentSchema,
            clamp(offset, 0, this.text.length),
            this._baseCatalog,
            this.version,
        );
    }

    private mapScopes(root: SaralScope): SqlScope[] {
        const nativeScopes: SaralScope[] = [];
        const visit = (scope: SaralScope): void => {
            nativeScopes.push(scope);
            for (const child of scope.getChildren()) {
                visit(child);
            }
        };
        visit(root);
        const ids = new Map(nativeScopes.map((scope, index) => [scope, `scope:${index}`]));
        const result = nativeScopes.map((scope) => {
            const ownSymbols = scope.getOwnSymbols();
            const normalized: SqlScope = Object.freeze({
                id: ids.get(scope)!,
                statementIndex: statementIndexAt(this.statements, scope.start),
                kind: "other" as const,
                span: freezeSpan(scope.start, scope.end, this.text.length),
                parentId: scope.parent ? ids.get(scope.parent) : undefined,
                childIds: Object.freeze(scope.getChildren().map((child) => ids.get(child)!)),
                sources: Object.freeze(
                    ownSymbols
                        .filter(isSourceSymbol)
                        .map((symbol) => mapScopeSource(symbol, this.text.length)),
                ),
                outputs: Object.freeze(
                    ownSymbols
                        .filter((symbol) => symbol.kind === saralSymbolKind.Column)
                        .map((symbol) => symbol.name),
                ),
            });
            this._scopeByNative.set(scope, normalized);
            return normalized;
        });
        return result;
    }
}

const unknownType: SqlType = Object.freeze({ kind: "unknown", display: "unknown" });

const builtinSignatures: Readonly<Record<string, readonly { readonly label: string }[]>> =
    Object.freeze({
        ABS: Object.freeze([{ label: "numeric_expression" }]),
        COUNT: Object.freeze([{ label: "expression" }]),
        SUM: Object.freeze([{ label: "expression" }]),
        AVG: Object.freeze([{ label: "expression" }]),
        MIN: Object.freeze([{ label: "expression" }]),
        MAX: Object.freeze([{ label: "expression" }]),
        COALESCE: Object.freeze([{ label: "expression" }, { label: "expression" }]),
        ISNULL: Object.freeze([{ label: "check_expression" }, { label: "replacement_value" }]),
    });

const builtinFunctionNames = Object.freeze([
    "abs",
    "avg",
    "cast",
    "coalesce",
    "concat",
    "convert",
    "count",
    "dateadd",
    "datediff",
    "getdate",
    "isnull",
    "len",
    "lower",
    "max",
    "min",
    "newid",
    "replace",
    "row_number",
    "substring",
    "sum",
    "upper",
]);

function identifierPrefixAt(
    text: string,
    offset: number,
): { readonly text: string; readonly start: number } {
    const match = /[#@A-Za-z_][\w$#@]*$/u.exec(text.slice(0, offset));
    return match
        ? { text: match[0], start: offset - match[0].length }
        : { text: "", start: offset };
}

function relationCompletionPrefix(
    text: string,
    offset: number,
):
    | {
          readonly prefixParts: readonly string[];
          readonly filter: string;
          readonly filterStart: number;
      }
    | undefined {
    const before = text.slice(0, offset);
    const match =
        /\b(?:FROM|JOIN|APPLY|UPDATE|INTO|USING|MERGE|EXEC(?:UTE)?)\s+((?:\[[^\]]*\]|"(?:[^"]|"")*"|[#@A-Za-z_][\w$#@]*)(?:\s*\.\s*(?:\[[^\]]*\]|"(?:[^"]|"")*"|[#@A-Za-z_][\w$#@]*)){0,3}|(?:\[[^\]]*\]|"(?:[^"]|"")*"|[#@A-Za-z_][\w$#@]*)?\s*\.\s*)$/iu.exec(
            before,
        );
    if (!match) {
        return undefined;
    }
    const reference = match[1].trim();
    const endsWithDot = /\.\s*$/u.test(reference);
    const parts = identifierParts(reference).map(unquoteIdentifier);
    const filter = endsWithDot ? "" : (parts.pop() ?? "");
    const rawFilter = endsWithDot
        ? ""
        : (/(?:\[[^\]]*\]|"(?:[^"]|"")*"|[#@A-Za-z_][\w$#@]*)\s*$/u.exec(reference)?.[0] ?? filter);
    return {
        prefixParts: Object.freeze(parts),
        filter,
        filterStart: offset - rawFilter.trimEnd().length,
    };
}

function isFunctionCompletionPosition(text: string, prefixStart: number): boolean {
    return /(?:^|[,(=+\-*/])\s*(?:SELECT\s+)?$/iu.test(text.slice(0, prefixStart));
}

function isInsertTargetListPosition(text: string, offset: number): boolean {
    const prefix = text.slice(0, offset);
    const insert =
        /\bINSERT\s+INTO\s+(?:\[[^\]]+\]|"(?:[^"]|"")+"|[#@\w$]+)(?:\s*\.\s*(?:\[[^\]]+\]|"(?:[^"]|"")+"|[#@\w$]+)){0,3}\s*\(([^)]*)$/iu.exec(
            prefix,
        );
    return Boolean(insert);
}

function clauseKind(word: string, next: string | undefined): SqlClause["kind"] | undefined {
    switch (word) {
        case "SELECT":
            return "select";
        case "FROM":
            return "from";
        case "JOIN":
        case "APPLY":
            return "join";
        case "WHERE":
            return "where";
        case "GROUP":
            return next === "BY" ? "groupBy" : undefined;
        case "HAVING":
            return "having";
        case "ORDER":
            return next === "BY" ? "orderBy" : undefined;
        case "OFFSET":
        case "FETCH":
            return "limit";
        default:
            return undefined;
    }
}

function sourceAliasAfter(text: string, span: SqlSpan): string | undefined {
    const match = /^\s+(?:AS\s+)?(\[[^\]]+\]|"(?:[^"]|"")+"|[#@A-Za-z_][\w$#@]*)/iu.exec(
        text.slice(span.end),
    );
    if (
        !match ||
        /^(?:where|join|on|group|order|having|union|intersect|except|window|option)$/i.test(
            match[1],
        )
    ) {
        return undefined;
    }
    return unquoteIdentifier(match[1]);
}

function callAt(
    text: string,
    offset: number,
): { readonly name: string; readonly activeParameter: number } | undefined {
    let depth = 0;
    let activeParameter = 0;
    for (let index = offset - 1; index >= 0; index--) {
        const character = text[index];
        if (character === ")") {
            depth++;
        } else if (character === "(") {
            if (depth > 0) {
                depth--;
                continue;
            }
            const prefix = text.slice(0, index);
            const match = /([#@A-Za-z_][\w$#@]*(?:\s*\.\s*[#@A-Za-z_][\w$#@]*)*)\s*$/u.exec(prefix);
            return match
                ? {
                      name: match[1].replace(/\s+/g, ""),
                      activeParameter,
                  }
                : undefined;
        } else if (character === "," && depth === 0) {
            activeParameter++;
        }
    }
    return undefined;
}

function catalogObjectDiagnostics(
    catalog: SqlCatalogProvider | undefined,
    references: readonly SqlExternalReference[],
    analysis: AnalysisResult,
    text: string,
    documentSchema: DocumentSchemaEvolution,
): SqlDiagnostic[] {
    if (!catalog || catalog.world !== "closed") {
        return [];
    }
    const diagnostics: SqlDiagnostic[] = [];
    const seen = new Set<string>();
    for (const reference of references) {
        if (
            !["read", "write", "execute"].includes(reference.role) ||
            reference.kind === "tempTable" ||
            /^[#@]/.test(reference.name) ||
            reference.kind === "function" ||
            /^(?:OPENJSON|OPENXML|STRING_SPLIT|GENERATE_SERIES)$/iu.test(reference.name) ||
            isDocumentLocalRelation(reference, analysis)
        ) {
            continue;
        }
        const parts = reference.nameParts ?? identifierParts(reference.name).map(unquoteIdentifier);
        if (
            documentSchema.resolveAt(parts, reference.span.start) ||
            catalogHasObject(catalog, parts)
        ) {
            continue;
        }
        const key = `${reference.span.start}:${reference.span.end}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        diagnostics.push(
            Object.freeze({
                kind: "semantic" as const,
                code: "MSSQL208",
                message: `Invalid object name '${reference.name}'.`,
                span: freezeSpan(reference.span.start, reference.span.end, text.length),
                severity: "error" as const,
            }),
        );
    }
    return diagnostics;
}

function normalizeParserDiagnostic(
    diagnostic: SqlDiagnostic,
    tokens: readonly SqlToken[],
    text: string,
): SqlDiagnostic {
    if (
        diagnostic.kind === "syntax" &&
        diagnostic.message === "Expected expression" &&
        /\b(?:WHERE|ON|HAVING|AND|OR)\s*$/iu.test(text)
    ) {
        return Object.freeze({
            ...diagnostic,
            span: freezeSpan(text.length, text.length, text.length),
        });
    }
    if (diagnostic.kind !== "syntax" || !/^Unexpected token:/i.test(diagnostic.message)) {
        return diagnostic;
    }
    const previous = tokens
        .filter(
            (token) =>
                token.channel === "code" &&
                token.role === "keyword" &&
                token.span.end <= diagnostic.span.start,
        )
        .at(-1);
    if (!previous) {
        return diagnostic;
    }
    return Object.freeze({
        ...diagnostic,
        code: "syntax",
        message: `Incorrect syntax near '${previous.text.toLocaleLowerCase()}'.`,
        span: freezeSpan(previous.span.start, previous.span.end, text.length),
    });
}

function structuralSyntaxDiagnostics(text: string, tokens: readonly SqlToken[]): SqlDiagnostic[] {
    const code = tokens.filter((token) => token.channel === "code");
    const diagnostics: SqlDiagnostic[] = [];
    for (let index = 0; index < code.length; index++) {
        const token = code[index];
        const word = token.text.toLocaleUpperCase();
        const next = code[index + 1];
        const missingAtEnd =
            ["WHERE", "ON", "HAVING", "AND", "OR"].includes(word) &&
            (!next || next.text === ";" || next.text.toLocaleUpperCase() === "GO");
        const missingAfterOperator =
            ["=", "<", ">", "<=", ">=", "<>", "!="].includes(token.text) &&
            (!next ||
                next.text === ";" ||
                ["SELECT", "FROM", "WHERE", "GROUP", "ORDER", "HAVING", "GO"].includes(
                    next.text.toLocaleUpperCase(),
                ));
        if (!missingAtEnd && !missingAfterOperator) {
            continue;
        }
        const atEof = !next && token.span.end >= text.trimEnd().length;
        diagnostics.push(
            Object.freeze({
                kind: "syntax" as const,
                code: "syntax",
                message: atEof
                    ? "Incorrect syntax near the end of the input."
                    : `Incorrect syntax near '${token.text}'.`,
                span: atEof ? freezeSpan(text.length, text.length, text.length) : token.span,
                severity: "error" as const,
            }),
        );
    }
    return diagnostics;
}

/**
 * SaralSQL 0.4.7 predates SQL Server 2022 named WINDOW clauses and reports two recovery
 * diagnostics after it has already retained the surrounding SELECT. Suppress only that exact,
 * internally consistent shape; arbitrary OVER/WINDOW damage continues to surface normally.
 */
function isNamedWindowParserArtifact(text: string, diagnostic: SqlDiagnostic): boolean {
    if (diagnostic.kind !== "syntax") {
        return false;
    }
    const match = /\bOVER\s+([\[\]"\w$#@]+)\b[\s\S]*?\bWINDOW\s+\1\s+AS\s*\(/iu.exec(text);
    return Boolean(match && diagnostic.span.end >= (match.index ?? 0));
}

function catalogColumnDiagnostics(
    catalog: SqlCatalogProvider | undefined,
    externalReferences: readonly SqlExternalReference[],
    tokens: readonly SqlToken[],
    statements: readonly SqlStatement[],
    text: string,
    documentSchema: DocumentSchemaEvolution,
): SqlDiagnostic[] {
    if (!catalog || catalog.world !== "closed") {
        return [];
    }
    const relations = externalReferences
        .filter(
            (reference) =>
                reference.kind === "table" &&
                (reference.role === "read" || reference.role === "write"),
        )
        .map((reference) => ({
            reference,
            span: reference.span,
            statementIndex: statementIndexAt(statements, reference.span.start),
            alias: sourceAliasAfter(text, reference.span),
            columns:
                documentSchema.columnsForAt(
                    reference.nameParts ?? identifierParts(reference.name).map(unquoteIdentifier),
                    reference.span.start,
                ) ??
                catalogColumnsFor(
                    catalog,
                    reference.nameParts ?? identifierParts(reference.name).map(unquoteIdentifier),
                ),
        }))
        .filter(
            (entry): entry is typeof entry & { columns: readonly SqlCatalogColumn[] } =>
                entry.columns !== undefined,
        );
    if (relations.length === 0) {
        return [];
    }
    const code = tokens.filter((token) => token.channel === "code");
    const namedWindows = namedWindowNames(text);
    const localQualifiers = documentLocalQualifiers(text);
    const relationsByStatement = new Map<number, typeof relations>();
    for (const relation of relations) {
        const current = relationsByStatement.get(relation.statementIndex) ?? [];
        current.push(relation);
        relationsByStatement.set(relation.statementIndex, current);
    }
    const segmentsByStatement = new Map(
        statements.map((statement) => [
            statement.index,
            setOperationSegments(text, statement.span),
        ]),
    );
    const generatedRowsetStatements = new Set(
        statements
            .filter((statement) =>
                statementUsesGeneratedRowset(text.slice(statement.span.start, statement.span.end)),
            )
            .map((statement) => statement.index),
    );
    const diagnostics: SqlDiagnostic[] = [];
    for (let index = 0; index < code.length; index++) {
        const token = code[index];
        if (
            token.role !== "identifier" ||
            token.text.startsWith("@") ||
            token.text.startsWith("#") ||
            token.text.startsWith("$") ||
            /^\[\d+\]$/u.test(token.text) ||
            namedWindows.has(foldName(unquoteIdentifier(token.text)))
        ) {
            continue;
        }
        const statement = statementAt(statements, token.span.start);
        let visibleRelations = statement ? (relationsByStatement.get(statement.index) ?? []) : [];
        if (statement) {
            const segment = segmentAt(
                segmentsByStatement.get(statement.index) ?? [statement.span],
                token.span.start,
            );
            visibleRelations = visibleRelations.filter(
                (relation) =>
                    segment.start <= relation.span.start && relation.span.start < segment.end,
            );
        }
        if (
            visibleRelations.length === 0 ||
            visibleRelations.some((relation) => spansOverlap(relation.span, token.span))
        ) {
            continue;
        }
        const previous = code[index - 1];
        const next = code[index + 1];
        if (next?.text === ".") {
            continue;
        }
        if (next?.text === "(" && isSqlTypeMethodName(token.text)) {
            continue;
        }
        if (previous?.text === ".") {
            if (isCatalogTypeMember(code, index, visibleRelations)) {
                continue;
            }
            const qualifier = code[index - 2]?.text;
            if (!qualifier) {
                continue;
            }
            const relation = visibleRelations.find(
                (candidate) =>
                    foldName(candidate.alias ?? candidate.reference.name.split(".").at(-1)!) ===
                    foldName(qualifier),
            );
            if (!relation) {
                // Derived tables, CTEs, APPLY/PIVOT results, and the DML pseudo tables do not have
                // catalog objects. An undeclared qualifier is still an invalid column reference.
                if (
                    !localQualifiers.has(foldName(unquoteIdentifier(qualifier))) &&
                    !/^(?:inserted|deleted|source|target)$/iu.test(unquoteIdentifier(qualifier))
                ) {
                    diagnostics.push(columnDiagnostic("unknown-column", token, text));
                }
                continue;
            }
            const known = relation?.columns.some(
                (column) => foldName(column.name) === foldName(token.text),
            );
            if (!known) {
                diagnostics.push(columnDiagnostic("unknown-column", token, text));
            }
            continue;
        }
        if (
            next?.text === "(" ||
            next?.text.toLocaleUpperCase() === "AS" ||
            [
                "FROM",
                "JOIN",
                "APPLY",
                "INTO",
                "UPDATE",
                "EXEC",
                "EXECUTE",
                "AS",
                "DECLARE",
                "TABLE",
                "VIEW",
                "PROCEDURE",
                "FUNCTION",
                "TYPE",
            ].includes(previous?.text.toLocaleUpperCase() ?? "") ||
            visibleRelations.some(
                (relation) => relation.alias && foldName(relation.alias) === foldName(token.text),
            ) ||
            isNonColumnIdentifier(token, previous, next) ||
            (statement && isDmlTargetColumn(text, statement.span, token.span)) ||
            (statement && isGeneratedRowsetAliasColumn(text, statement.span, token.span)) ||
            (statement && generatedRowsetStatements.has(statement.index))
        ) {
            continue;
        }
        const matches = visibleRelations.filter((relation) =>
            relation.columns.some((column) => foldName(column.name) === foldName(token.text)),
        );
        if (matches.length === 0) {
            diagnostics.push(columnDiagnostic("unknown-column", token, text));
        } else if (matches.length > 1) {
            diagnostics.push(columnDiagnostic("ambiguous-column", token, text));
        }
    }
    return deduplicateDiagnostics(diagnostics);
}

function columnDiagnostic(
    code: "unknown-column" | "ambiguous-column",
    token: SqlToken,
    text: string,
): SqlDiagnostic {
    const name = unquoteIdentifier(token.text);
    return Object.freeze({
        kind: "semantic" as const,
        code,
        message:
            code === "unknown-column"
                ? `Invalid column name '${name}'.`
                : `Ambiguous column name '${name}'.`,
        span: freezeSpan(token.span.start, token.span.end, text.length),
        severity: "error" as const,
    });
}

function documentLocalQualifiers(text: string): ReadonlySet<string> {
    const result = new Set<string>();
    const aliases = /\bAS\s+(\[[^\]]+\]|"(?:[^"]|"")+"|[#@A-Za-z_][\w$#@]*)/giu;
    for (let match = aliases.exec(text); match; match = aliases.exec(text)) {
        result.add(foldName(unquoteIdentifier(match[1])));
    }
    const ctes = /(?:\bWITH|,)\s*(\[[^\]]+\]|"(?:[^"]|"")+"|[A-Za-z_][\w$#@]*)\s+AS\s*\(/giu;
    for (let match = ctes.exec(text); match; match = ctes.exec(text)) {
        result.add(foldName(unquoteIdentifier(match[1])));
    }
    return result;
}

function isNonColumnIdentifier(
    token: SqlToken,
    previous: SqlToken | undefined,
    next: SqlToken | undefined,
): boolean {
    const word = unquoteIdentifier(token.text).toLocaleUpperCase();
    if (
        [
            "DAY",
            "DAYOFYEAR",
            "WEEK",
            "MONTH",
            "QUARTER",
            "YEAR",
            "HOUR",
            "MINUTE",
            "SECOND",
            "MILLISECOND",
            "MICROSECOND",
            "NANOSECOND",
            "PATH",
            "AUTO",
            "ROOT",
            "WINDOW",
            "PARTITION",
        ].includes(word)
    ) {
        return true;
    }
    return (
        previous?.text.toLocaleUpperCase() === "WINDOW" ||
        previous?.text.toLocaleUpperCase() === "OVER" ||
        next?.text.toLocaleUpperCase() === "AS"
    );
}

function namedWindowNames(text: string): ReadonlySet<string> {
    const result = new Set<string>();
    const pattern = /\bWINDOW\s+(\[[^\]]+\]|"(?:[^"]|"")+"|[A-Za-z_][\w$#@]*)\s+AS\s*\(/giu;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
        result.add(foldName(unquoteIdentifier(match[1])));
    }
    return result;
}

function statementUsesGeneratedRowset(statementText: string): boolean {
    return /\b(?:PIVOT|UNPIVOT|OPENJSON|OPENXML)\b|\bFROM\s*\(|(?:^|\s)WITH\s+[\[\]"\w$#@]+\s+AS\s*\(/iu.test(
        statementText,
    );
}

function isSqlTypeMethodName(value: string): boolean {
    return /^(?:exist|modify|nodes|query|value)$/iu.test(unquoteIdentifier(value));
}

function isCatalogTypeMember(
    code: readonly SqlToken[],
    index: number,
    relations: readonly {
        alias: string | undefined;
        reference: SqlExternalReference;
        columns: readonly SqlCatalogColumn[];
    }[],
): boolean {
    if (code[index - 3]?.text !== ".") {
        return false;
    }
    const qualifier = code[index - 4]?.text;
    const columnName = code[index - 2]?.text;
    if (!qualifier || !columnName) {
        return false;
    }
    const relation = relations.find(
        (candidate) =>
            foldName(candidate.alias ?? candidate.reference.name.split(".").at(-1)!) ===
            foldName(unquoteIdentifier(qualifier)),
    );
    const column = relation?.columns.find(
        (candidate) => foldName(candidate.name) === foldName(unquoteIdentifier(columnName)),
    );
    return Boolean(resolveTypeMember(column?.type, unquoteIdentifier(code[index].text)));
}

function isGeneratedRowsetAliasColumn(text: string, statement: SqlSpan, token: SqlSpan): boolean {
    const identifier = String.raw`(?:\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")+"|[#@A-Za-z_][\w$#@]*)`;
    const before = text.slice(statement.start, token.start);
    const after = text.slice(token.end, statement.end);
    if (!/^\s*(?:,|\))/u.test(after)) {
        return false;
    }
    return new RegExp(
        String.raw`\bAS\s+${identifier}\s*\(\s*(?:${identifier}\s*,\s*)*$`,
        "iu",
    ).test(before);
}

function isDmlTargetColumn(text: string, statement: SqlSpan, token: SqlSpan): boolean {
    const before = text.slice(statement.start, token.start);
    const after = text.slice(token.end, statement.end);
    if (/^\s*=/u.test(after) && /\bSET\s+(?:[\s\S]*,\s*)?$/iu.test(before)) {
        return true;
    }
    const insert = before.toLocaleUpperCase().lastIndexOf("INSERT");
    if (insert < 0) {
        return false;
    }
    const targetList = before.slice(insert);
    const opens = (targetList.match(/\(/gu) ?? []).length;
    const closes = (targetList.match(/\)/gu) ?? []).length;
    return opens > closes && !/\bVALUES\b/iu.test(targetList);
}

function setOperationSegments(text: string, statement: SqlSpan): readonly SqlSpan[] {
    const boundaries = [statement.start];
    const pattern = /\b(?:UNION(?:\s+ALL)?|INTERSECT|EXCEPT)\b/giu;
    const source = text.slice(statement.start, statement.end);
    for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
        boundaries.push(
            statement.start + match.index,
            statement.start + match.index + match[0].length,
        );
    }
    boundaries.push(statement.end);
    boundaries.sort((left, right) => left - right);
    const segments: SqlSpan[] = [];
    for (let index = 0; index + 1 < boundaries.length; index++) {
        segments.push(freezeSpan(boundaries[index], boundaries[index + 1], text.length));
    }
    return segments;
}

function segmentAt(segments: readonly SqlSpan[], offset: number): SqlSpan {
    return (
        segments.find((segment) => segment.start <= offset && offset < segment.end) ??
        segments.at(-1) ?? { start: offset, end: offset }
    );
}

function deduplicateDiagnostics(diagnostics: readonly SqlDiagnostic[]): SqlDiagnostic[] {
    const seen = new Set<string>();
    return diagnostics.filter((diagnostic) => {
        const key = `${diagnostic.code}:${diagnostic.span.start}:${diagnostic.span.end}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function isDocumentLocalRelation(
    reference: SqlExternalReference,
    analysis: AnalysisResult,
): boolean {
    if (reference.nameParts && reference.nameParts.length > 1) {
        return false;
    }
    const scope = analysis.scope.root.findInnermost(reference.span.start);
    const symbol = scope.resolve(reference.name);
    return Boolean(
        symbol &&
            (symbol.kind === saralSymbolKind.Alias ||
                symbol.kind === saralSymbolKind.CTE ||
                symbol.kind === saralSymbolKind.TempTable),
    );
}

function catalogHasObject(catalog: SqlCatalogProvider, parts: readonly string[]): boolean {
    return catalogCandidates(catalog, parts).some(
        (candidate) =>
            catalog.objectFor?.(candidate) !== undefined ||
            catalog.columnsFor(candidate) !== undefined,
    );
}

function catalogColumnsFor(
    catalog: SqlCatalogProvider,
    parts: readonly string[],
): readonly SqlCatalogColumn[] | undefined {
    for (const candidate of catalogCandidates(catalog, parts)) {
        const columns = catalog.columnsFor(candidate) ?? catalog.objectFor?.(candidate)?.columns;
        if (columns) {
            return columns;
        }
    }
    return undefined;
}

function catalogCandidates(
    catalog: SqlCatalogProvider,
    parts: readonly string[],
): readonly (readonly string[])[] {
    const candidates = [parts, ...(catalog.tableCandidates?.(parts) ?? [])];
    const seen = new Set<string>();
    return candidates.filter((candidate) => {
        const key = candidate.map(foldName).join(".");
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function qualifiedColumnAt(
    tokens: readonly SqlToken[],
    offset: number,
): { qualifier: string; column: string } | undefined {
    const touchedIndex = tokens.findIndex(
        (token) => token.span.start <= offset && offset < token.span.end,
    );
    const columnIndex =
        touchedIndex >= 0 && tokens[touchedIndex].text === "."
            ? touchedIndex + 1
            : touchedIndex >= 0 &&
                tokens[touchedIndex + 1]?.text === "." &&
                tokens[touchedIndex + 2]?.role === "identifier"
              ? touchedIndex + 2
              : touchedIndex;
    if (
        columnIndex < 2 ||
        tokens[columnIndex - 1].text !== "." ||
        tokens[columnIndex - 2].role !== "identifier"
    ) {
        return undefined;
    }
    return {
        qualifier: tokens[columnIndex - 2].text,
        column: unquoteIdentifier(tokens[columnIndex].text),
    };
}

function qualifiedTypeMemberAt(
    tokens: readonly SqlToken[],
    offset: number,
): { qualifier: string; column: string; member: string } | undefined {
    const code = tokens.filter((token) => token.channel === "code");
    const memberIndex = code.findIndex(
        (token) => token.span.start <= offset && offset < token.span.end,
    );
    if (
        memberIndex < 4 ||
        code[memberIndex].role !== "identifier" ||
        code[memberIndex - 1].text !== "." ||
        code[memberIndex - 2].role !== "identifier" ||
        code[memberIndex - 3].text !== "." ||
        code[memberIndex - 4].role !== "identifier"
    ) {
        return undefined;
    }
    return {
        qualifier: code[memberIndex - 4].text,
        column: unquoteIdentifier(code[memberIndex - 2].text),
        member: unquoteIdentifier(code[memberIndex].text),
    };
}

function aggregateCallAt(
    tokens: readonly SqlToken[],
    offset: number,
):
    | { readonly functionName: string; readonly qualifier: string; readonly column: string }
    | undefined {
    const code = tokens.filter((token) => token.channel === "code");
    const functionIndex = code.findIndex(
        (token, index) =>
            token.span.start <= offset &&
            offset < token.span.end &&
            code[index + 1]?.text === "(" &&
            ["SUM", "AVG", "MIN", "MAX"].includes(token.text.toLocaleUpperCase()),
    );
    if (
        functionIndex < 0 ||
        code[functionIndex + 2]?.role !== "identifier" ||
        code[functionIndex + 3]?.text !== "." ||
        code[functionIndex + 4]?.role !== "identifier"
    ) {
        return undefined;
    }
    return {
        functionName: code[functionIndex].text,
        qualifier: code[functionIndex + 2].text,
        column: unquoteIdentifier(code[functionIndex + 4].text),
    };
}

function aggregateResultType(functionName: string, inputType: string): SqlType | undefined {
    const normalizedFunction = functionName.toLocaleUpperCase();
    const normalizedType = inputType.toLocaleLowerCase();
    if (
        (normalizedFunction === "SUM" || normalizedFunction === "AVG") &&
        /^(?:decimal|numeric)\(/.test(normalizedType)
    ) {
        const scale = /\(\s*\d+\s*,\s*(\d+)\s*\)/.exec(normalizedType)?.[1] ?? "0";
        const resultScale =
            normalizedFunction === "AVG" ? Math.max(6, Number(scale)) : Number(scale);
        return typeFromText(`decimal(38,${resultScale})`);
    }
    if (["SUM", "AVG", "MIN", "MAX"].includes(normalizedFunction)) {
        return typeFromText(inputType);
    }
    return undefined;
}

function isColumnCompletionPosition(text: string, offset: number): boolean {
    const prefix = text.slice(0, offset);
    return /\b(?:select|where|having|group\s+by|order\s+by|on|set)\s+(?:[^;]*)$/iu.test(prefix);
}

function qualifiedCompletionPrefix(
    text: string,
    offset: number,
): { qualifier: string; filter: string; filterStart: number } | undefined {
    const before = text.slice(0, offset);
    const match = /(\[[^\]]+\]|"(?:[^"]|"")+"|[#@A-Za-z_][\w$#@]*)\.([#@A-Za-z_][\w$#@]*)?$/u.exec(
        before,
    );
    if (!match) {
        return undefined;
    }
    const filter = match[2] ?? "";
    return {
        qualifier: match[1],
        filter,
        filterStart: offset - filter.length,
    };
}

function readTokens(text: string, positionAt: (offset: number) => SqlPosition): SqlToken[] {
    const lexer = new Lexer(text);
    const result: SqlToken[] = [];
    for (;;) {
        const token = lexer.nextToken();
        if (token.type === saralTokenType.EOF) {
            break;
        }
        const sourceText = token.raw ?? text.slice(token.offset, token.offset + token.value.length);
        const span = freezeSpan(token.offset, token.offset + sourceText.length, text.length);
        result.push(
            Object.freeze({
                text: sourceText,
                span,
                start: Object.freeze(positionAt(span.start)),
                end: Object.freeze(positionAt(span.end)),
                role: tokenRole(token.type),
                channel: "code" as const,
                consumedAs:
                    token.type === saralTokenType.Keyword
                        ? ("keyword" as const)
                        : token.type === saralTokenType.Identifier ||
                            token.type === saralTokenType.TempTable
                          ? ("identifier" as const)
                          : undefined,
                tokenName: saralTokenNames[token.type],
            }),
        );
    }
    result.push(...readCommentTokens(text, positionAt));
    return result.sort((left, right) => left.span.start - right.span.start);
}

function readCommentTokens(text: string, positionAt: (offset: number) => SqlPosition): SqlToken[] {
    const comments: SqlToken[] = [];
    let index = 0;
    let quote: "'" | '"' | "]" | undefined;
    while (index < text.length) {
        const current = text[index];
        const next = text[index + 1];
        if (quote) {
            if (current === quote) {
                if (next === quote) {
                    index += 2;
                    continue;
                }
                quote = undefined;
            }
            index++;
            continue;
        }
        if (current === "'" || current === '"') {
            quote = current;
            index++;
            continue;
        }
        if (current === "[") {
            quote = "]";
            index++;
            continue;
        }
        if (current === "-" && next === "-") {
            const start = index;
            index += 2;
            while (index < text.length && text[index] !== "\r" && text[index] !== "\n") {
                index++;
            }
            comments.push(commentToken(text, start, index, positionAt));
            continue;
        }
        if (current === "/" && next === "*") {
            const start = index;
            let depth = 1;
            index += 2;
            while (index < text.length && depth > 0) {
                if (text[index] === "/" && text[index + 1] === "*") {
                    depth++;
                    index += 2;
                } else if (text[index] === "*" && text[index + 1] === "/") {
                    depth--;
                    index += 2;
                } else {
                    index++;
                }
            }
            comments.push(commentToken(text, start, index, positionAt));
            continue;
        }
        index++;
    }
    return comments;
}

function commentToken(
    text: string,
    start: number,
    end: number,
    positionAt: (offset: number) => SqlPosition,
): SqlToken {
    return Object.freeze({
        text: text.slice(start, end),
        span: Object.freeze({ start, end }),
        start: Object.freeze(positionAt(start)),
        end: Object.freeze(positionAt(end)),
        role: "comment" as const,
        channel: "trivia" as const,
        tokenName: "Comment",
    });
}

function tokenRole(type: TokenType): SqlTokenRole {
    switch (type) {
        case saralTokenType.Keyword:
            return "keyword";
        case saralTokenType.Identifier:
        case saralTokenType.Variable:
        case saralTokenType.TempTable:
            return "identifier";
        case saralTokenType.String:
            return "string";
        case saralTokenType.Number:
            return "number";
        case saralTokenType.Operator:
            return "operator";
        case saralTokenType.OpenParen:
        case saralTokenType.CloseParen:
        case saralTokenType.Semicolon:
        case saralTokenType.Comma:
        case saralTokenType.Dot:
            return "punctuation";
        default:
            return "other";
    }
}

function mapStatements(analysis: AnalysisResult, sourceLength: number): SqlStatement[] {
    return analysis.ast.body.map((statement, index) => {
        const span = freezeSpan(statement.start, statement.end, sourceLength);
        return Object.freeze({
            index,
            span,
            category: statementCategory(statement),
            rootScopeId: index === 0 ? "scope:0" : undefined,
            syntaxErrorCount: analysis.issues.filter(
                (issue) => issue.start < span.end && issue.end > span.start,
            ).length,
        });
    });
}

function statementCategory(statement: Statement): SqlStatementCategory {
    if (statement.type === "WithStatement") {
        return statementCategory(statement.body);
    }
    if (statement.type === "SelectStatement" || statement.type === "SetOperator") {
        return "query";
    }
    if (/^(?:Insert|Update|Delete|Merge)/.test(statement.type)) {
        return "dml";
    }
    if (/^(?:Create|Alter|Drop|Truncate)/.test(statement.type)) {
        return "ddl";
    }
    if (statement.type === "PermissionStatement") {
        return "dcl";
    }
    if (statement.type === "TransactionStatement") {
        return "tcl";
    }
    if (/^(?:If|While|Block|TryCatch)/.test(statement.type)) {
        return "compound";
    }
    return "utility";
}

function mapSymbols(
    analysis: AnalysisResult,
    text: string,
    declarations: readonly ExtractedDeclaration[],
    extractedReferences: readonly ExtractedReference[],
    tokens: readonly SqlToken[],
    statements: readonly SqlStatement[],
    catalogAt: (offset: number) => SqlCatalogProvider,
): SqlSymbol[] {
    const symbols: SqlSymbol[] = [];
    const declarationsByName = new Map<string, ExtractedDeclaration[]>();
    for (const declaration of flattenDeclarations(declarations)) {
        const key = `${mapDeclarationKind(declaration)}:${declaration.normalizedName}`;
        const candidates = declarationsByName.get(key) ?? [];
        candidates.push(declaration);
        declarationsByName.set(key, candidates);
        const kind = mapDeclarationKind(declaration);
        if (!kind) {
            continue;
        }
        symbols.push(
            Object.freeze({
                kind,
                modifiers: Object.freeze(["declaration" as const]),
                name: declaration.name,
                span: freezeSpan(
                    declaration.nameLocation.start,
                    declaration.nameLocation.end,
                    text.length,
                ),
                frame: declaration.parentName ?? "_main_",
                type: typeFromText(declaration.dataType),
            }),
        );
    }

    for (const reference of extractedReferences) {
        const kind = mapReferenceKind(reference);
        if (!kind) {
            continue;
        }
        const span = referenceSpan(reference, text);
        const key = `${kind}:${reference.normalizedName}`;
        const declaration = declarationsByName.get(key)?.[0];
        symbols.push(
            Object.freeze({
                kind,
                modifiers: Object.freeze(["reference" as const]),
                name: reference.name,
                span,
                frame: "_main_",
                definition: declaration
                    ? freezeSpan(
                          declaration.nameLocation.start,
                          declaration.nameLocation.end,
                          text.length,
                      )
                    : undefined,
                partSpans: Object.freeze(identifierPartSpans(text, span)),
            }),
        );
    }

    addScopeSymbols(analysis.scope.root, symbols, text);
    addProjectionSymbols(analysis, declarations, symbols, text, statements);
    addCatalogColumnSymbols(extractedReferences, tokens, statements, catalogAt, symbols, text);
    addCteProjectionDefinitions(symbols, text, statements, declarations);
    addDerivedProjectionDefinitions(symbols, text, statements);
    addGeneratedRowsetSymbols(symbols, text);
    enrichBuiltinFunctionSymbols(symbols, statements);
    return deduplicateSymbols(symbols).sort(
        (left, right) =>
            left.span.start - right.span.start || spanWidth(left.span) - spanWidth(right.span),
    );
}

function addProjectionSymbols(
    analysis: AnalysisResult,
    declarations: readonly ExtractedDeclaration[],
    target: SqlSymbol[],
    text: string,
    statements: readonly SqlStatement[],
): void {
    const ctes = flattenDeclarations(declarations).filter(
        (declaration) => declaration.kind === "cte",
    );
    const ctesByStatement = new Map<number, ExtractedDeclaration[]>();
    for (const cte of ctes) {
        const index = statementIndexAt(statements, cte.location.start);
        const candidates = ctesByStatement.get(index) ?? [];
        candidates.push(cte);
        ctesByStatement.set(index, candidates);
    }
    for (const symbol of [...target]) {
        if (symbol.kind !== "alias" || !symbol.modifiers.includes("declaration")) {
            continue;
        }
        const cte = (
            ctesByStatement.get(statementIndexAt(statements, symbol.span.start)) ?? []
        ).find(
            (candidate) =>
                candidate.location.start <= symbol.span.start &&
                symbol.span.end <= candidate.location.end,
        );
        if (cte) {
            target.push(
                Object.freeze({
                    kind: "column" as const,
                    modifiers: Object.freeze(["declaration" as const, "output" as const]),
                    name: symbol.name,
                    span: symbol.span,
                    frame: cte.name,
                    type: symbol.type,
                }),
            );
        }
    }
    walkAST(analysis.ast, {
        enter(node) {
            if (node.type !== "Column") {
                return;
            }
            const column = node as ColumnNode;
            const rawName = column.alias ?? column.outputName;
            if (!rawName || rawName === "expression" || column.wildcard) {
                return;
            }
            const name = unquoteIdentifier(rawName);
            const cte = (
                ctesByStatement.get(statementIndexAt(statements, column.start)) ?? []
            ).find(
                (candidate) =>
                    candidate.location.start <= column.start &&
                    column.end <= candidate.location.end,
            );
            const span = exactSaralSymbolSpan(column, rawName, text, true);
            target.push(
                Object.freeze({
                    kind: "column" as const,
                    modifiers: Object.freeze(["declaration" as const, "output" as const]),
                    name,
                    span,
                    frame: cte?.name ?? "_main_",
                }),
            );
        },
    });
}

function addCatalogColumnSymbols(
    extractedReferences: readonly ExtractedReference[],
    tokens: readonly SqlToken[],
    statements: readonly SqlStatement[],
    catalogAt: (offset: number) => SqlCatalogProvider,
    target: SqlSymbol[],
    text: string,
): void {
    const extractedReferenceSpans = new Set(
        extractedReferences.map(
            (reference) => `${reference.location.start}:${reference.location.end}`,
        ),
    );
    const parserReferences: readonly ExtractedReference[] = [
        ...extractedReferences,
        ...textualExternalReferences(text)
            .filter(
                (reference) =>
                    reference.kind === "table" &&
                    !extractedReferenceSpans.has(`${reference.span.start}:${reference.span.end}`),
            )
            .map(
                (reference): ExtractedReference => ({
                    kind: "table",
                    context: "from",
                    name: reference.name,
                    normalizedName: foldName(reference.name),
                    location: reference.span,
                    parts: reference.nameParts ? [...reference.nameParts] : undefined,
                }),
            ),
    ];
    const relations = parserReferences
        .filter((reference) => reference.kind === "table")
        .map((reference) => {
            const span = freezeSpan(reference.location.start, reference.location.end, text.length);
            return {
                reference,
                span,
                statementIndex: statementIndexAt(statements, span.start),
                alias: sourceAliasAfter(text, span),
                columns: catalogColumnsFor(
                    catalogAt(span.start),
                    reference.parts ?? identifierParts(reference.name).map(unquoteIdentifier),
                ),
            };
        })
        .filter(
            (entry): entry is typeof entry & { columns: readonly SqlCatalogColumn[] } =>
                entry.columns !== undefined,
        );
    if (relations.length === 0) {
        return;
    }
    const relationSpans = parserReferences
        .filter((reference) => reference.kind === "table")
        .map((reference) =>
            freezeSpan(reference.location.start, reference.location.end, text.length),
        )
        .sort((left, right) => left.start - right.start || left.end - right.end);
    const relationsByStatement = new Map<number, typeof relations>();
    for (const relation of relations) {
        const current = relationsByStatement.get(relation.statementIndex) ?? [];
        current.push(relation);
        relationsByStatement.set(relation.statementIndex, current);
    }
    const aliasSymbols = new Map<string, number[]>();
    for (let index = 0; index < target.length; index++) {
        const symbol = target[index];
        if (symbol.kind !== "alias") continue;
        const key = `${statementIndexAt(statements, symbol.span.start)}:${foldName(symbol.name)}`;
        const indices = aliasSymbols.get(key) ?? [];
        indices.push(index);
        aliasSymbols.set(key, indices);
    }

    // Saral's scope locations cover the whole table reference in a few joins. Add the exact alias
    // declaration and use it as the definition for every alias occurrence.
    for (const relation of relations) {
        if (!relation.alias) {
            continue;
        }
        const aliasSpan = sourceAliasSpanAfter(text, relation.span);
        if (!aliasSpan) {
            continue;
        }
        target.push(
            Object.freeze({
                kind: "alias" as const,
                modifiers: Object.freeze(["declaration" as const]),
                name: relation.alias,
                span: aliasSpan,
                frame: "_main_",
                source: Object.freeze({
                    kind: "table" as const,
                    name: relation.reference.name,
                    span: relation.span,
                }),
            }),
        );
        const aliasKey = `${relation.statementIndex}:${foldName(relation.alias)}`;
        for (const index of aliasSymbols.get(aliasKey) ?? []) {
            const symbol = target[index];
            target[index] = Object.freeze({ ...symbol, definition: aliasSpan });
        }
    }

    // Enrich parser references in place so hover, semantic tokens, navigation, and diagnostics all
    // observe the same catalog-backed identity rather than a parallel token-only symbol.
    for (let index = 0; index < target.length; index++) {
        const symbol = target[index];
        if (symbol.kind !== "column" || !symbol.modifiers.includes("reference")) {
            continue;
        }
        const parts = identifierParts(symbol.name).map(unquoteIdentifier);
        const columnName = parts.at(-1) ?? symbol.name;
        const qualifier = parts.length > 1 ? parts.at(-2) : undefined;
        const statementRelations =
            relationsByStatement.get(statementIndexAt(statements, symbol.span.start)) ?? [];
        const candidates = statementRelations.filter((relation) => {
            if (qualifier) {
                return (
                    foldName(relation.alias ?? relation.reference.name.split(".").at(-1)!) ===
                    foldName(qualifier)
                );
            }
            return relation.columns.some(
                (column) => foldName(column.name) === foldName(columnName),
            );
        });
        const matches = candidates.flatMap((relation) =>
            relation.columns
                .filter((column) => foldName(column.name) === foldName(columnName))
                .map((column) => ({ relation, column })),
        );
        if (matches.length !== 1) {
            continue;
        }
        const [{ relation, column }] = matches;
        target[index] = Object.freeze({
            ...symbol,
            type: typeFromText(column.type),
            origins: Object.freeze([
                Object.freeze({
                    table: Object.freeze(
                        relation.reference.parts ?? relation.reference.name.split("."),
                    ),
                    column: column.name,
                }),
            ]),
            source: Object.freeze({
                kind: "table" as const,
                name: relation.reference.name,
                span: relation.span,
            }),
        });
    }

    const typedColumnSpans = new Set(
        target
            .filter((symbol) => symbol.kind === "column" && symbol.type !== undefined)
            .map((symbol) => `${symbol.span.start}:${symbol.span.end}`),
    );
    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
        const token = tokens[tokenIndex];
        if (
            token.role !== "identifier" ||
            sortedSpansOverlap(relationSpans, token.span) ||
            typedColumnSpans.has(`${token.span.start}:${token.span.end}`)
        ) {
            continue;
        }
        const qualifierToken =
            tokens[tokenIndex - 1]?.text === "." ? tokens[tokenIndex - 2] : undefined;
        const statementRelations =
            relationsByStatement.get(statementIndexAt(statements, token.span.start)) ?? [];
        const candidateRelations = qualifierToken
            ? statementRelations.filter(
                  (entry) =>
                      foldName(entry.alias ?? entry.reference.name.split(".").at(-1)!) ===
                      foldName(qualifierToken.text),
              )
            : statementRelations;
        const matches = candidateRelations.flatMap((entry) =>
            entry.columns
                .filter((column) => foldName(column.name) === foldName(token.text))
                .map((column) => ({ entry, column })),
        );
        if (matches.length !== 1) {
            continue;
        }
        const [{ entry, column }] = matches;
        target.push(
            Object.freeze({
                kind: "column" as const,
                modifiers: Object.freeze(["reference" as const]),
                name: qualifierToken
                    ? `${unquoteIdentifier(qualifierToken.text)}.${unquoteIdentifier(token.text)}`
                    : unquoteIdentifier(token.text),
                span: qualifierToken
                    ? freezeSpan(qualifierToken.span.start, token.span.end, text.length)
                    : token.span,
                frame: "_main_",
                type: typeFromText(column.type),
                origins: Object.freeze([
                    Object.freeze({
                        table: Object.freeze(
                            entry.reference.parts ?? entry.reference.name.split("."),
                        ),
                        column: column.name,
                    }),
                ]),
                source: Object.freeze({
                    kind: "table" as const,
                    name: entry.reference.name,
                    span: freezeSpan(
                        entry.reference.location.start,
                        entry.reference.location.end,
                        text.length,
                    ),
                }),
            }),
        );
        typedColumnSpans.add(`${token.span.start}:${token.span.end}`);
    }
}

function sourceAliasSpanAfter(text: string, span: SqlSpan): SqlSpan | undefined {
    const source = text.slice(span.end);
    const match = /^\s+(?:AS\s+)?(\[[^\]]+\]|"(?:[^"]|"")+"|[#@A-Za-z_][\w$#@]*)/iu.exec(source);
    if (
        !match ||
        /^(?:where|join|on|group|order|having|union|intersect|except|window|option)$/iu.test(
            match[1],
        )
    ) {
        return undefined;
    }
    const relative = match.index + match[0].lastIndexOf(match[1]);
    return freezeSpan(span.end + relative, span.end + relative + match[1].length, text.length);
}

function addCteProjectionDefinitions(
    target: SqlSymbol[],
    text: string,
    statements: readonly SqlStatement[],
    declarations: readonly ExtractedDeclaration[],
): void {
    const symbolIndices = symbolIndicesByStatement(target, statements);
    const declarationSpans = new Set(
        target
            .filter(
                (symbol) => symbol.kind === "column" && symbol.modifiers.includes("declaration"),
            )
            .map((symbol) => `${symbol.span.start}:${symbol.span.end}`),
    );
    const ctes = flattenDeclarations(declarations).filter(
        (declaration) => declaration.kind === "cte",
    );
    for (const cte of ctes) {
        const cteName = unquoteIdentifier(cte.name);
        const open = text.indexOf("(", cte.nameLocation.end);
        const close = matchingCloseParenthesis(text, open);
        const statement = statementAt(statements, cte.location.start);
        if (
            open < 0 ||
            open >= cte.location.end ||
            close === undefined ||
            !statement ||
            close > statement.span.end
        ) {
            continue;
        }
        const body = text.slice(open + 1, close);
        const select = /\bSELECT\b/iu.exec(body);
        if (!select) {
            continue;
        }
        const projectionStart = open + 1 + (select.index ?? 0) + select[0].length;
        const from = /\bFROM\b/iu.exec(text.slice(projectionStart, close));
        const projectionEnd = from ? projectionStart + (from.index ?? 0) : close;
        const projected = projectionSpans(text, projectionStart, projectionEnd);
        if (projected.size === 0) {
            continue;
        }
        for (const [name, span] of projected) {
            const spanKey = `${span.start}:${span.end}`;
            if (!declarationSpans.has(spanKey)) {
                target.push(
                    Object.freeze({
                        kind: "column" as const,
                        modifiers: Object.freeze(["declaration" as const, "output" as const]),
                        name,
                        span,
                        frame: cteName,
                    }),
                );
                declarationSpans.add(spanKey);
            }
        }
        const sourcePattern = new RegExp(`\\b(?:FROM|JOIN)\\s+${escapeRegExp(cteName)}\\b`, "iu");
        if (!sourcePattern.test(text.slice(close + 1, statement.span.end))) {
            continue;
        }
        for (const index of symbolIndices.get(statement.index) ?? []) {
            const symbol = target[index];
            if (
                symbol.kind !== "column" ||
                symbol.span.start <= close ||
                symbol.span.start > statement.span.end
            ) {
                continue;
            }
            const name = unquoteIdentifier(symbol.name.split(".").at(-1) ?? symbol.name);
            const definition = projected.get(foldName(name));
            if (definition) {
                target[index] = Object.freeze({ ...symbol, definition });
            }
        }
    }
}

function projectionSpans(text: string, start: number, end: number): Map<string, SqlSpan> {
    const result = new Map<string, SqlSpan>();
    let depth = 0;
    let pieceStart = start;
    const addPiece = (pieceEnd: number): void => {
        const value = text.slice(pieceStart, pieceEnd);
        const identifiers = [...value.matchAll(/\[[^\]]+\]|"(?:[^"]|"")+"|[A-Za-z_][\w$#@]*/gu)];
        const alias = /\bAS\s+(\[[^\]]+\]|"(?:[^"]|"")+"|[A-Za-z_][\w$#@]*)\s*$/iu.exec(value);
        const selected = alias
            ? { text: alias[1], index: (alias.index ?? 0) + alias[0].lastIndexOf(alias[1]) }
            : identifiers.at(-1)
              ? { text: identifiers.at(-1)![0], index: identifiers.at(-1)!.index ?? 0 }
              : undefined;
        if (!selected || /^(?:NULL|END)$/iu.test(selected.text)) {
            return;
        }
        const name = unquoteIdentifier(selected.text);
        result.set(
            foldName(name),
            freezeSpan(
                pieceStart + selected.index,
                pieceStart + selected.index + selected.text.length,
                text.length,
            ),
        );
    };
    for (let index = start; index < end; index++) {
        if (text[index] === "(") {
            depth++;
        } else if (text[index] === ")") {
            depth = Math.max(0, depth - 1);
        } else if (text[index] === "," && depth === 0) {
            addPiece(index);
            pieceStart = index + 1;
        }
    }
    addPiece(end);
    return result;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function addDerivedProjectionDefinitions(
    target: SqlSymbol[],
    text: string,
    statements: readonly SqlStatement[],
): void {
    const symbolIndices = symbolIndicesByStatement(target, statements);
    for (const statement of statements) {
        const statementText = text.slice(statement.span.start, statement.span.end);
        if (!/\(\s*SELECT\b/iu.test(statementText)) continue;
        const derived =
            /\(\s*SELECT\s+([\s\S]*?)\bFROM\b[\s\S]*?\)\s+(?:AS\s+)?(\[[^\]]+\]|"(?:[^"]|"")+"|[A-Za-z_][\w$#@]*)/giu;
        for (let match = derived.exec(statementText); match; match = derived.exec(statementText)) {
            const alias = unquoteIdentifier(match[2]);
            const projectionStart =
                statement.span.start + (match.index ?? 0) + match[0].indexOf(match[1]);
            const projection = match[1];
            const projected = new Map<string, SqlSpan>();
            const identifiers = /\[[^\]]+\]|"(?:[^"]|"")+"|[A-Za-z_][\w$#@]*/gu;
            for (
                let identifier = identifiers.exec(projection);
                identifier;
                identifier = identifiers.exec(projection)
            ) {
                const name = unquoteIdentifier(identifier[0]);
                if (/^(?:AS|DISTINCT|TOP)$/iu.test(name)) {
                    continue;
                }
                projected.set(
                    foldName(name),
                    freezeSpan(
                        projectionStart + identifier.index,
                        projectionStart + identifier.index + identifier[0].length,
                        text.length,
                    ),
                );
            }
            for (const index of symbolIndices.get(statement.index) ?? []) {
                const symbol = target[index];
                if (
                    symbol.kind !== "column" ||
                    !symbol.modifiers.includes("reference") ||
                    symbol.span.start < statement.span.start ||
                    symbol.span.end > statement.span.end
                ) {
                    continue;
                }
                const parts = identifierParts(symbol.name).map(unquoteIdentifier);
                if (parts.length < 2 || foldName(parts.at(-2)!) !== foldName(alias)) {
                    continue;
                }
                const definition = projected.get(foldName(parts.at(-1)!));
                if (definition) {
                    target[index] = Object.freeze({ ...symbol, definition });
                }
            }
        }
    }
}

function addGeneratedRowsetSymbols(target: SqlSymbol[], text: string): void {
    const pattern = /\b(?:PIVOT|UNPIVOT)\s*\(/giu;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
        const open = (match.index ?? 0) + match[0].lastIndexOf("(");
        const close = matchingCloseParenthesis(text, open);
        if (close === undefined) {
            continue;
        }
        const alias = /^\s+(?:AS\s+)?(\[[^\]]+\]|"(?:[^"]|"")+"|[A-Za-z_][\w$#@]*)/iu.exec(
            text.slice(close + 1),
        );
        if (!alias) {
            continue;
        }
        const rawName = alias[1];
        const relative = alias[0].lastIndexOf(rawName);
        const span = freezeSpan(
            close + 1 + relative,
            close + 1 + relative + rawName.length,
            text.length,
        );
        target.push(
            Object.freeze({
                kind: "subquery" as const,
                modifiers: Object.freeze(["declaration" as const]),
                name: unquoteIdentifier(rawName),
                span,
                frame: "_main_",
            }),
        );
    }
}

function matchingCloseParenthesis(text: string, open: number): number | undefined {
    let depth = 0;
    let quote: "'" | '"' | "]" | undefined;
    for (let index = open; index < text.length; index++) {
        const character = text[index];
        if (quote) {
            if (character === quote) {
                if (quote !== "]" && text[index + 1] === quote) {
                    index++;
                } else {
                    quote = undefined;
                }
            }
            continue;
        }
        if (character === "'" || character === '"') {
            quote = character;
        } else if (character === "[") {
            quote = "]";
        } else if (character === "(") {
            depth++;
        } else if (character === ")" && --depth === 0) {
            return index;
        }
    }
    return undefined;
}

function enrichBuiltinFunctionSymbols(
    target: SqlSymbol[],
    statements: readonly SqlStatement[],
): void {
    const symbolIndices = symbolIndicesByStatement(target, statements);
    for (let index = 0; index < target.length; index++) {
        const symbol = target[index];
        if (symbol.kind !== "function") {
            continue;
        }
        const name = symbol.name.toLocaleUpperCase();
        if (!(name in builtinSignatures)) {
            continue;
        }
        const aggregate = ["COUNT", "SUM", "AVG", "MIN", "MAX"].includes(name);
        const argumentIndex = (
            symbolIndices.get(statementIndexAt(statements, symbol.span.start)) ?? []
        ).find((candidateIndex) => {
            const candidate = target[candidateIndex];
            return (
                candidate.kind === "column" &&
                candidate.type !== undefined &&
                symbol.span.start <= candidate.span.start &&
                candidate.span.end <= symbol.span.end
            );
        });
        const argument = argumentIndex === undefined ? undefined : target[argumentIndex];
        const type =
            name === "COUNT"
                ? typeFromText("int")
                : aggregate && argument?.type?.kind === "scalar"
                  ? aggregateResultType(name, argument.type.display)
                  : argument?.type;
        target[index] = Object.freeze({
            ...symbol,
            modifiers: Object.freeze([
                "reference" as const,
                ...(aggregate ? (["aggregate" as const] as const) : []),
            ]),
            type,
        });
    }
}

function addScopeSymbols(scope: SaralScope, target: SqlSymbol[], text: string): void {
    for (const symbol of scope.getOwnSymbols()) {
        const kind = mapSaralSymbolKind(symbol.kind);
        if (!kind) {
            continue;
        }
        const declaration = exactSaralSymbolSpan(symbol.location, symbol.name, text, true);
        target.push(
            Object.freeze({
                kind,
                modifiers: Object.freeze(["declaration" as const]),
                name: symbol.name,
                span: declaration,
                frame: scope.name ?? "_main_",
                type: typeFromText(symbol.dataType),
            }),
        );
        for (const reference of symbol.references) {
            target.push(
                Object.freeze({
                    kind,
                    modifiers: Object.freeze(["reference" as const]),
                    name: symbol.name,
                    span: exactSaralSymbolSpan(reference.location, symbol.name, text, false),
                    frame: scope.name ?? "_main_",
                    definition: declaration,
                    type: typeFromText(symbol.dataType),
                }),
            );
        }
    }
    for (const child of scope.getChildren()) {
        addScopeSymbols(child, target, text);
    }
}

function flattenDeclarations(
    declarations: readonly ExtractedDeclaration[],
): ExtractedDeclaration[] {
    const result: ExtractedDeclaration[] = [];
    for (const declaration of declarations) {
        result.push(declaration);
        result.push(...flattenDeclarations(declaration.columns ?? []));
        result.push(...flattenDeclarations(declaration.parameters ?? []));
    }
    return result;
}

function mapDeclarationKind(declaration: ExtractedDeclaration): SqlSymbolKind | undefined {
    switch (declaration.kind) {
        case "table":
        case "view":
            return "table";
        case "cte":
            return "cte";
        case "column":
            return "column";
        case "function":
            return "function";
        case "procedure":
            return "procedure";
        case "type":
            return "type";
        case "parameter":
            return "parameter";
        case "variable":
            return "variable";
        default:
            return undefined;
    }
}

function mapReferenceKind(reference: ExtractedReference): SqlSymbolKind | undefined {
    switch (reference.kind) {
        case "table":
            return reference.name.startsWith("#") ? "tempTable" : "table";
        case "column":
            return "column";
        case "cte":
            return "cte";
        case "alias":
            return "alias";
        case "function":
            return "function";
        case "variable":
            return "variable";
        default:
            return undefined;
    }
}

function mapSaralSymbolKind(kind: SaralSymbolKind): SqlSymbolKind | undefined {
    switch (kind) {
        case saralSymbolKind.Table:
            return "table";
        case saralSymbolKind.TempTable:
            return "tempTable";
        case saralSymbolKind.Column:
            return "column";
        case saralSymbolKind.Alias:
            return "alias";
        case saralSymbolKind.CTE:
            return "cte";
        case saralSymbolKind.Function:
            return "function";
        case saralSymbolKind.Procedure:
            return "procedure";
        case saralSymbolKind.Type:
            return "type";
        case saralSymbolKind.Parameter:
            return "parameter";
        case saralSymbolKind.Variable:
            return "variable";
        default:
            return undefined;
    }
}

function mapCompletionKind(kind: string): SqlCompletionKind {
    switch (kind) {
        case "column":
            return "column";
        case "alias":
            return "alias";
        case "table":
            return "table";
        case "cte":
            return "cte";
        case "function":
            return "function";
        case "procedure":
            return "procedure";
        case "type":
            return "type";
        case "text":
            return "text";
        default:
            return "keyword";
    }
}

const keywordDocumentation: Readonly<Record<string, string>> = Object.freeze({
    SELECT: "Retrieves rows and expressions from one or more T-SQL row sources.",
    FROM: "Introduces the row sources used by a query or data modification statement.",
    WHERE: "Filters rows using a Boolean search condition.",
    JOIN: "Combines rows from two row sources using a join condition.",
    GROUP: "Groups rows for aggregate evaluation; normally followed by BY.",
    HAVING: "Filters groups after aggregation.",
    ORDER: "Defines result ordering; normally followed by BY.",
    INSERT: "Adds rows to a table or view.",
    UPDATE: "Changes values in existing rows.",
    DELETE: "Removes rows from a table or view.",
    MERGE: "Conditionally inserts, updates, or deletes using a source rowset.",
    CREATE: "Creates a SQL Server schema object.",
    ALTER: "Changes an existing SQL Server schema object.",
    DROP: "Removes a SQL Server schema object.",
    EXEC: "Executes a stored procedure or dynamic T-SQL batch.",
    EXECUTE: "Executes a stored procedure or dynamic T-SQL batch.",
});

function completionDocumentation(
    label: string,
    kind: SqlCompletionKind,
    detail?: string,
): string | undefined {
    if (kind === "keyword") {
        return keywordDocumentation[label.toUpperCase()];
    }
    if (kind === "column" && detail) {
        return `Column \`${label}\` has SQL type \`${detail}\`.`;
    }
    if (["table", "procedure", "function", "type"].includes(kind)) {
        return `${kind[0].toUpperCase()}${kind.slice(1)} \`${label}\`${detail ? ` — ${detail}` : ""}.`;
    }
    return undefined;
}

function isExternalReference(reference: ExtractedReference): boolean {
    return (
        reference.kind === "table" ||
        reference.kind === "function" ||
        reference.context === "execute-target"
    );
}

function buildExternalReferences(
    extractedReferences: readonly ExtractedReference[],
    declarations: readonly ExtractedDeclaration[],
    analysis: AnalysisResult,
    text: string,
): SqlExternalReference[] {
    const result: SqlExternalReference[] = extractedReferences
        .filter((reference) => isExternalReference(reference))
        .map((reference) => mapExternalReference(reference, text));
    const known = new Set(
        result.map(
            (reference) => `${reference.kind}:${reference.span.start}:${reference.span.end}`,
        ),
    );

    for (const declaration of flattenDeclarations(declarations)) {
        const kind = mapExternalDeclarationKind(declaration);
        if (!kind) continue;
        const reference = Object.freeze({
            name: declaration.name,
            nameParts: Object.freeze(declaration.name.split(".")),
            kind,
            role: "define" as const,
            span: freezeSpan(
                declaration.nameLocation.start,
                declaration.nameLocation.end,
                text.length,
            ),
        });
        result.push(reference);
        known.add(`${reference.kind}:${reference.span.start}:${reference.span.end}`);
    }
    for (const statement of analysis.ast.body) {
        const merge = mergeMutationTarget(statement, text);
        if (merge) {
            result.push(merge.target);
            known.add(`${merge.target.kind}:${merge.target.span.start}:${merge.target.span.end}`);
        }
    }
    for (const reference of textualExternalReferences(text)) {
        const key = `${reference.kind}:${reference.span.start}:${reference.span.end}`;
        if (!known.has(key)) {
            known.add(key);
            result.push(reference);
        }
    }
    return deduplicateExternalReferences(result);
}

function mapExternalReference(reference: ExtractedReference, text: string): SqlExternalReference {
    const role =
        reference.context === "execute-target"
            ? ("execute" as const)
            : mutationOperation(reference.context)
              ? ("write" as const)
              : ("read" as const);
    const kind =
        reference.context === "execute-target"
            ? ("procedure" as const)
            : reference.kind === "function"
              ? ("function" as const)
              : reference.name.startsWith("#")
                ? ("tempTable" as const)
                : ("table" as const);
    return Object.freeze({
        name: reference.name,
        nameParts: Object.freeze(reference.parts ?? reference.name.split(".")),
        kind,
        role,
        span: referenceSpan(reference, text),
    });
}

function textualExternalReferences(text: string): SqlExternalReference[] {
    const identifier = String.raw`(?:\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")+"|[#@A-Za-z_][\w$#@]*)`;
    const qualified = String.raw`${identifier}(?:\s*\.\s*${identifier}){0,3}`;
    const pattern = new RegExp(String.raw`\b(?:from|join|apply|using)\s+(${qualified})`, "giu");
    const result: SqlExternalReference[] = [];
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
        const nameText = match[1];
        const relativeStart = match[0].lastIndexOf(nameText);
        const start = match.index + relativeStart;
        const compact = nameText.replace(/\s*\.\s*/g, ".");
        const parts = identifierParts(compact).map(unquoteIdentifier);
        if (isSqlTypeMethodName(parts.at(-1) ?? "")) {
            continue;
        }
        result.push(
            Object.freeze({
                name: parts.join("."),
                nameParts: Object.freeze(parts),
                kind: /^[#@]/.test(parts.at(-1) ?? "")
                    ? ("tempTable" as const)
                    : ("table" as const),
                role: "read" as const,
                span: freezeSpan(start, start + nameText.length, text.length),
            }),
        );
    }
    return result;
}

function mapExternalDeclarationKind(
    declaration: ExtractedDeclaration,
): SqlExternalReference["kind"] | undefined {
    switch (declaration.kind) {
        case "table":
            return declaration.name.startsWith("#") ? "tempTable" : "table";
        case "view":
            return "view";
        case "function":
            return "function";
        case "procedure":
            return "procedure";
        case "type":
            return "type";
        default:
            return undefined;
    }
}

function mutationOperation(
    context: ExtractedReference["context"],
): SqlMutationTarget["operation"] | undefined {
    switch (context) {
        case "insert-target":
            return "insert";
        case "update-target":
            return "update";
        case "delete-target":
            return "delete";
        case "merge-target":
            return "merge";
        default:
            return undefined;
    }
}

function mergeMutationTarget(statement: Statement, text: string): SqlMutationTarget | undefined {
    if (statement.type !== "MergeStatement") {
        return undefined;
    }
    // MergeNode is part of Statement's public union but is not re-exported by the package root.
    const target = (
        statement as ASTNode & { target?: (ASTNode & { name?: string; parts?: string[] }) | null }
    ).target;
    if (!target?.name) {
        return undefined;
    }
    const reference: SqlExternalReference = Object.freeze({
        name: target.name,
        nameParts: Object.freeze(target.parts ?? target.name.split(".")),
        kind: target.name.startsWith("#") ? ("tempTable" as const) : ("table" as const),
        role: "write" as const,
        span: freezeSpan(target.start, target.end, text.length),
    });
    return Object.freeze({ operation: "merge" as const, target: reference });
}

function deduplicateExternalReferences(
    references: readonly SqlExternalReference[],
): SqlExternalReference[] {
    const seen = new Set<string>();
    return references.filter((reference) => {
        const key = `${reference.kind}:${reference.role}:${reference.span.start}:${reference.span.end}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function deduplicateOrigins(origins: readonly SqlOrigin[]): SqlOrigin[] {
    const seen = new Set<string>();
    return origins.filter((origin) => {
        const key = `${origin.table.join(".").toLocaleLowerCase()}.${origin.column.toLocaleLowerCase()}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function isSourceSymbol(symbol: SaralSymbol): boolean {
    return (
        symbol.kind === saralSymbolKind.Table ||
        symbol.kind === saralSymbolKind.TempTable ||
        symbol.kind === saralSymbolKind.CTE ||
        symbol.kind === saralSymbolKind.Alias
    );
}

function mapScopeSource(symbol: SaralSymbol, sourceLength: number): SqlScopeSource {
    return Object.freeze({
        key: foldName(symbol.name),
        kind:
            symbol.kind === saralSymbolKind.CTE
                ? ("cte" as const)
                : symbol.kind === saralSymbolKind.Alias
                  ? ("relation" as const)
                  : ("table" as const),
        name: symbol.name,
        nameParts: Object.freeze(symbol.name.split(".")),
        span: freezeSpan(symbol.location.start, symbol.location.end, sourceLength),
    });
}

function referenceSpan(reference: ExtractedReference, text: string): SqlSpan {
    const raw = freezeSpan(reference.location.start, reference.location.end, text.length);
    if (reference.kind !== "alias") {
        return raw;
    }
    const alias = reference.name;
    const relative = text
        .slice(raw.start, raw.end)
        .toLocaleLowerCase()
        .lastIndexOf(alias.toLocaleLowerCase());
    return relative < 0
        ? raw
        : freezeSpan(raw.start + relative, raw.start + relative + alias.length, text.length);
}

function exactSaralSymbolSpan(
    location: { start: number; end: number },
    name: string,
    text: string,
    preferLast: boolean,
): SqlSpan {
    const raw = freezeSpan(location.start, location.end, text.length);
    const source = text.slice(raw.start, raw.end).toLocaleLowerCase();
    const needle = name.toLocaleLowerCase();
    const relative = preferLast ? source.lastIndexOf(needle) : source.indexOf(needle);
    if (relative < 0) {
        return raw;
    }
    let start = raw.start + relative;
    if (start > raw.start && (text[start - 1] === "@" || text[start - 1] === "#")) {
        start--;
    }
    return freezeSpan(start, raw.start + relative + name.length, text.length);
}

function identifierPartSpans(text: string, span: SqlSpan): SqlSpan[] {
    const result: SqlSpan[] = [];
    const value = text.slice(span.start, span.end);
    const pattern = /\[[^\]]*(?:\]\][^\]]*)*\]|"(?:[^"]|"")+"|[#@]?[A-Za-z_][\w$#@]*/g;
    for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
        result.push(
            freezeSpan(
                span.start + match.index,
                span.start + match.index + match[0].length,
                text.length,
            ),
        );
    }
    return result;
}

function typeFromText(value: string | undefined): SqlType | undefined {
    return value
        ? Object.freeze({ kind: "scalar" as const, name: value, display: value })
        : undefined;
}

function deduplicateSymbols(symbols: readonly SqlSymbol[]): SqlSymbol[] {
    const seen = new Set<string>();
    return symbols.filter((symbol) => {
        const key = `${symbol.kind}:${symbol.span.start}:${symbol.span.end}:${symbol.modifiers.join(",")}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function deduplicateSpans(symbols: readonly SqlSymbol[]): SqlSymbol[] {
    const seen = new Set<string>();
    return symbols.filter((symbol) => {
        const key = `${symbol.span.start}:${symbol.span.end}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function statementIndexAt(statements: readonly SqlStatement[], offset: number): number {
    return statementAt(statements, offset)?.index ?? 0;
}

function statementAt(
    statements: readonly SqlStatement[],
    offset: number,
): SqlStatement | undefined {
    let low = 0;
    let high = statements.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if ((statements[middle]?.span.start ?? Number.POSITIVE_INFINITY) <= offset) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    const candidate = low > 0 ? statements[low - 1] : undefined;
    return candidate && offset <= candidate.span.end ? candidate : undefined;
}

function symbolIndicesByStatement(
    symbols: readonly SqlSymbol[],
    statements: readonly SqlStatement[],
): Map<number, number[]> {
    const result = new Map<number, number[]>();
    for (let index = 0; index < symbols.length; index++) {
        const statement = statementAt(statements, symbols[index]!.span.start);
        if (!statement) continue;
        const indices = result.get(statement.index) ?? [];
        indices.push(index);
        result.set(statement.index, indices);
    }
    return result;
}

function foldName(name: string): string {
    return name
        .replace(/^[@#]+/, "")
        .replace(/[\[\]"]/g, "")
        .toLocaleLowerCase();
}

function identifierParts(identifier: string): string[] {
    const parts = identifier.match(/\[[^\]]*(?:\]\][^\]]*)*\]|"(?:[^"]|"")+"|[^.]+/g);
    return parts?.map((part) => part.trim()).filter(Boolean) ?? [identifier];
}

function unquoteIdentifier(identifier: string): string {
    if (identifier.startsWith("[") && identifier.endsWith("]")) {
        return identifier.slice(1, -1).replace(/\]\]/g, "]");
    }
    if (identifier.startsWith('"') && identifier.endsWith('"')) {
        return identifier.slice(1, -1).replace(/""/g, '"');
    }
    return identifier;
}

function spanWidth(span: SqlSpan): number {
    return span.end - span.start;
}

function spansEqual(left: SqlSpan | undefined, right: SqlSpan | undefined): boolean {
    return Boolean(left && right && left.start === right.start && left.end === right.end);
}

function spansOverlap(left: SqlSpan, right: SqlSpan): boolean {
    return left.start < right.end && right.start < left.end;
}

/** Tests one span against start-sorted spans without scanning the whole document. */
function sortedSpansOverlap(spans: readonly SqlSpan[], target: SqlSpan): boolean {
    let low = 0;
    let high = spans.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if ((spans[middle]?.start ?? Number.POSITIVE_INFINITY) < target.end) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    for (let index = low - 1; index >= 0; index--) {
        const span = spans[index]!;
        if (span.end <= target.start) return false;
        if (spansOverlap(span, target)) return true;
    }
    return false;
}

function spansOverlapDefinition(left: SqlSpan, right: SqlSpan): boolean {
    return (
        (left.start <= right.start && right.end <= left.end) ||
        (right.start <= left.start && left.end <= right.end)
    );
}

function freezeSpan(start: number, end: number, sourceLength: number): SqlSpan {
    const boundedStart = clamp(start, 0, sourceLength);
    return Object.freeze({ start: boundedStart, end: clamp(end, boundedStart, sourceLength) });
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), maximum);
}

function safely<T>(action: () => T, fallback: T): T {
    try {
        return action();
    } catch {
        return fallback;
    }
}
