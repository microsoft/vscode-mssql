/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

export { Lexer, TokenType } from "./parser/lexer.js";
export type { Token } from "./parser/lexer.js";

export { Parser } from "./parser/parser.js";
export type {
    ParseResult,
    Program,
    Statement,
    Expression,
    // All node types a consumer might use
    SelectNode,
    InsertNode,
    UpdateNode,
    DeleteNode,
    DeclareNode,
    SetNode,
    CreateNode,
    WithNode,
    IfNode,
    BlockNode,
    PrintNode,
    ErrorNode,
    // Expression nodes
    BinaryExpression,
    UnaryExpression,
    LiteralNode,
    IdentifierNode,
    VariableNode,
    FunctionCallNode,
    CaseExpression,
    InExpression,
    BetweenExpression,
    GroupingExpression,
    SubqueryExpression,
    OverExpression,
    MemberExpression,
    WildcardExpression,
    // Structural
    ASTNode,
    NodeLocation,
    TableReference,
    JoinNode,
    JoinType,
    ColumnNode,
    ColumnDefinition,
    ParameterDefinition,
    QueryStatement,
} from "./ast/types.js";

export { analyze, analyzeParseResult } from "./analyze.js";
export type { AnalysisResult } from "./analyze.js";

export {
    collectNodes,
    findFirst,
    findNodeAt,
    findParent,
    getChildren,
    walkAST,
} from "./ast/astWalker.js";
export type { ASTVisitor } from "./ast/astWalker.js";

export { getDocumentSymbols } from "./documentSymbols.js";
export type { DocumentSymbol, DocumentSymbolKind } from "./documentSymbols.js";

export {
    getCompletionContext,
    getCompletionContextFromAnalysis,
    getCompletionsAt,
    getCompletionsAtFromAnalysis,
} from "./completions.js";
export type { CompletionContext, CompletionItem, CompletionItemKind } from "./completions.js";

export { extractDeclarations, extractDependencies, extractReferences } from "./extractors.js";
export type {
    ExtractedDeclaration,
    ExtractedDeclarationKind,
    ExtractedDependency,
    ExtractedReference,
    ExtractedReferenceContext,
    ExtractedReferenceKind,
} from "./extractors.js";

export {
    LineIndex,
    createLineIndex,
    locationToRange,
    offsetToPosition,
    positionToOffset,
} from "./position.js";
export type { Position, Range } from "./position.js";

export { ScopeBuilder } from "./semantic/scopeBuilder.js";
export type { ScopeBuilderResult, DuplicateDeclaration } from "./semantic/scopeBuilder.js";

export { Scope, SymbolKind } from "./semantic/scope.js";
export type {
    Symbol,
    SymbolReference,
    ReferenceKind,
    SymbolColumn,
    TypeMember,
} from "./semantic/scope.js";

export { DiagnosticCode, diagnose } from "./diagnostics/diagnostics.js";
export type { Diagnostic, DiagnosticSeverity } from "./diagnostics/diagnostics.js";

export { LineageBuilder } from "./lineage/lineageBuilder.js";
export type {
    LineageNode,
    DerivedColumn,
    VirtualSource,
    LineageSourceKind,
    SourceExposure,
    AmbiguityDiagnostic,
    MutationTarget,
    ReadScopeSource,
    ReadScopeExposure,
    LineageEdge,
    LineageResult,
} from "./lineage/lineage.js";

export { ColumnAnalyzer } from "./semantic/columnAnalyzer.js";
export type {
    ColumnAnalysisResult,
    ColumnResolution,
    PropertyAccessResolution,
} from "./semantic/columnAnalyzer.js";
export {
    getBuiltinTypeMembersCatalog,
    getTypeMembers,
    resolveTypeMember,
} from "./semantic/typeMembers.js";

export { SqlCmdPreprocessor } from "./parser/sqlcmdPreprocessor.js";
export type { SqlCmdOptions, PreprocessResult } from "./parser/sqlcmdPreprocessor.js";
