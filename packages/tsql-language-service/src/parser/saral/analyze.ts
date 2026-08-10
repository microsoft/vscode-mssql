/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import { type Program, type ParseIssue, type ParseResult } from "./ast/types.js";
import { type Diagnostic, diagnose } from "./diagnostics/diagnostics.js";
import { Lexer } from "./parser/lexer.js";
import { Parser } from "./parser/parser.js";
import { type LineageResult } from "./lineage/lineage.js";
import { LineageBuilder } from "./lineage/lineageBuilder.js";
import { type ColumnAnalysisResult, ColumnAnalyzer } from "./semantic/columnAnalyzer.js";
import { ScopeBuilder, type ScopeBuilderResult } from "./semantic/scopeBuilder.js";
import { SqlCmdPreprocessor, type SqlCmdOptions } from "./parser/sqlcmdPreprocessor.js";
import { type TypeMember } from "./semantic/scope.js";
import { getBuiltinTypeMembersCatalog, getTypeMembers } from "./semantic/typeMembers.js";

export type AnalysisDiagnosticSource = "parser" | "semantic" | "sqlcmd";

export interface AnalysisDiagnostic {
    source: AnalysisDiagnosticSource;
    code: string;
    message: string;
    severity: Diagnostic["severity"];
    start: number;
    end: number;
}

export interface AnalysisResult {
    ast: Program;
    issues: ParseIssue[];
    scope: ScopeBuilderResult;
    semanticDiagnostics: Diagnostic[];
    diagnostics: AnalysisDiagnostic[];
    lineage: LineageResult;
    columns: ColumnAnalysisResult;
    typeMembers: {
        builtIn: Record<string, TypeMember[]>;
        referenced: Record<string, TypeMember[]>;
    };
}

export function analyze(sql: string, options?: SqlCmdOptions): AnalysisResult {
    const preprocessor = new SqlCmdPreprocessor();
    const preprocessResult = preprocessor.process(sql, options);

    const parseResult = new Parser(new Lexer(preprocessResult.text)).parse();
    const result = analyzeParseResult(parseResult, preprocessResult.issues);

    applyOffsetMapping(result, preprocessResult.mapOffset);
    return result;
}

/**
 * Runs Saral's semantic layers over an existing parser product. This is the non-parsing entry point
 * for hosts that cache or incrementally materialize a {@link ParseResult}.
 */
export function analyzeParseResult(
    parseResult: ParseResult,
    sqlCmdIssues: readonly ParseIssue[] = [],
): AnalysisResult {
    const scope = new ScopeBuilder().build(parseResult.ast);
    const semanticDiagnostics = diagnose(parseResult.ast, scope);
    const lineage = new LineageBuilder().build(parseResult.ast);
    const columns = new ColumnAnalyzer().analyze(parseResult.ast, scope, lineage);
    const typeMembers = buildTypeMembers(scope);
    const issues = parseResult.issues ?? [];

    const diagnostics = combineDiagnostics(sqlCmdIssues, issues, semanticDiagnostics);

    const result: AnalysisResult = {
        ast: parseResult.ast,
        issues,
        scope,
        semanticDiagnostics,
        diagnostics,
        lineage,
        columns,
        typeMembers,
    };

    return result;
}

function buildTypeMembers(scope: ScopeBuilderResult): {
    builtIn: Record<string, TypeMember[]>;
    referenced: Record<string, TypeMember[]>;
} {
    const referenced = new Map<string, TypeMember[]>();

    const visit = (s: any): void => {
        for (const symbol of s.symbols?.values?.() ?? []) {
            if (!symbol?.dataType) continue;
            const base = symbol.dataType.trim().toUpperCase().split("(")[0]?.trim();
            if (!base || referenced.has(base)) continue;
            const members = getTypeMembers(base);
            if (members?.length) referenced.set(base, members);
        }
        for (const child of s.children ?? []) visit(child);
    };

    visit(scope.root);

    return {
        builtIn: getBuiltinTypeMembersCatalog(),
        referenced: Object.fromEntries(referenced.entries()),
    };
}

function combineDiagnostics(
    cmdIssues: readonly ParseIssue[],
    issues: readonly ParseIssue[],
    semanticDiagnostics: readonly Diagnostic[],
): AnalysisDiagnostic[] {
    return [
        ...cmdIssues.map((issue) => ({
            source: "sqlcmd" as const,
            code: issue.code,
            message: issue.message,
            severity: "warning" as const,
            start: issue.start,
            end: issue.end,
        })),
        ...issues.map((issue) => ({
            source: "parser" as const,
            code: issue.code,
            message: issue.message,
            severity: "error" as const,
            start: issue.start,
            end: issue.end,
        })),
        ...semanticDiagnostics.map((diagnostic) => ({
            source: "semantic" as const,
            code: diagnostic.code,
            message: diagnostic.message,
            severity: diagnostic.severity,
            start: diagnostic.start,
            end: diagnostic.end,
        })),
    ].sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start;
        if (a.end !== b.end) return a.end - b.end;
        return a.source.localeCompare(b.source);
    });
}

function applyOffsetMapping(
    obj: any,
    mapOffset: (o: number) => number,
    visited = new Set<any>(),
): void {
    if (!obj || typeof obj !== "object") return;
    if (visited.has(obj)) return;
    visited.add(obj);

    if (typeof obj.start === "number") obj.start = mapOffset(obj.start);
    if (typeof obj.end === "number") obj.end = mapOffset(obj.end);
    if (typeof obj.selectionStart === "number") obj.selectionStart = mapOffset(obj.selectionStart);
    if (typeof obj.selectionEnd === "number") obj.selectionEnd = mapOffset(obj.selectionEnd);
    if (typeof obj.variableStart === "number") obj.variableStart = mapOffset(obj.variableStart);
    if (typeof obj.variableEnd === "number") obj.variableEnd = mapOffset(obj.variableEnd);

    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) applyOffsetMapping(obj[i], mapOffset, visited);
    } else if (obj instanceof Map) {
        for (const value of obj.values()) applyOffsetMapping(value, mapOffset, visited);
    } else {
        for (const key of Object.keys(obj)) applyOffsetMapping(obj[key], mapOffset, visited);
    }
}
