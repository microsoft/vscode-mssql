/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    SqlAnalysisEngine,
    SqlAnalysisSnapshot,
    SqlCatalogProvider,
    SqlDiagnostic,
    SqlScope,
    SqlSpan,
    SqlStatementCategory,
} from "@vscode-mssql/tsql-language-service";
import {
    comparisonScenarios,
    comparisonSchema,
    resolveSelector,
    type ComparisonScenario,
    type DiagnosticSpanScenario,
    type DmlTargetScenario,
} from "./comparisonScenarios";
import { scoreComparison, type ComparisonScore, type ScenarioResult } from "./comparisonScore";

export interface EngineComparisonReport {
    engineId: string;
    engineName: string;
    engineVersion: string;
    results: ScenarioResult[];
    score: ComparisonScore;
}

/** Runs the complete fixed-denominator oracle against one parser-independent engine. */
export function evaluateComparison(engine: SqlAnalysisEngine): EngineComparisonReport {
    const catalog = createComparisonCatalog();
    const results = comparisonScenarios.map((scenario): ScenarioResult => {
        try {
            const snapshot = engine.createSnapshot({
                text: scenario.sql,
                uri: `file:///parser-comparison/${scenario.id}.sql`,
                catalog,
            });
            const failures = evaluateScenario(scenario, snapshot);
            return {
                scenarioId: scenario.id,
                feature: scenario.feature,
                passed: failures.length === 0,
                details: failures.length === 0 ? undefined : failures.join("; "),
            };
        } catch (error) {
            return {
                scenarioId: scenario.id,
                feature: scenario.feature,
                passed: false,
                details: `engine threw: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    });

    return {
        engineId: engine.id,
        engineName: engine.displayName,
        engineVersion: engine.version,
        results,
        score: scoreComparison(comparisonScenarios, results),
    };
}

/** Converts the neutral comparison schema into the catalog boundary shared by both adapters. */
export function createComparisonCatalog(): SqlCatalogProvider {
    const tables = Object.entries(comparisonSchema.schemas).flatMap(([schemaName, schema]) =>
        Object.entries(schema).map(([tableName, columns]) => ({
            schemaName,
            tableName,
            columns,
        })),
    );
    const findTable = (parts: readonly string[]) => {
        const normalized = parts.map(normalizeName);
        return tables.find(({ schemaName, tableName }) => {
            if (normalized.length === 1) {
                return normalizeName(tableName) === normalized[0];
            }
            return (
                normalizeName(schemaName) === normalized.at(-2) &&
                normalizeName(tableName) === normalized.at(-1)
            );
        });
    };

    return Object.freeze({
        version: "comparison-schema-v1",
        world: "closed" as const,
        columnsFor: (parts: readonly string[]) => {
            const table = findTable(parts);
            return table
                ? Object.freeze(
                      Object.entries(table.columns).map(([name, type]) =>
                          Object.freeze({ name, type }),
                      ),
                  )
                : undefined;
        },
        objectFor: (parts: readonly string[]) => {
            const table = findTable(parts);
            if (table) {
                return Object.freeze({
                    parts: Object.freeze([table.schemaName, table.tableName]),
                    kind: "table" as const,
                    columns: Object.freeze(
                        Object.entries(table.columns).map(([name, type]) =>
                            Object.freeze({ name, type }),
                        ),
                    ),
                });
            }
            const requested = parts.map(normalizeName).join(".");
            const procedure = comparisonSchema.procedures.find(
                (candidate) => normalizeName(candidate) === requested,
            );
            return procedure
                ? Object.freeze({
                      parts: Object.freeze(procedure.split(".")),
                      kind: "procedure" as const,
                  })
                : undefined;
        },
        tableCandidates: (parts: readonly string[]) => {
            const table = findTable(parts);
            return table ? [Object.freeze([table.schemaName, table.tableName])] : [];
        },
        childrenOf: (parts: readonly string[]) => {
            if (parts.length === 0) {
                return Object.freeze(
                    Object.keys(comparisonSchema.schemas).map((name) =>
                        Object.freeze({ name, kind: "namespace" as const }),
                    ),
                );
            }
            if (parts.length === 1) {
                const schema =
                    comparisonSchema.schemas[
                        Object.keys(comparisonSchema.schemas).find(
                            (name) => normalizeName(name) === normalizeName(parts[0]),
                        ) ?? ""
                    ];
                return Object.freeze(
                    Object.keys(schema ?? {}).map((name) =>
                        Object.freeze({ name, kind: "table" as const }),
                    ),
                );
            }
            return [];
        },
        tables: () => Object.freeze(tables.map(({ tableName }) => tableName)),
    });
}

function evaluateScenario(scenario: ComparisonScenario, snapshot: SqlAnalysisSnapshot): string[] {
    switch (scenario.feature) {
        case "syntax": {
            if (!scenario.valid) {
                if (!scenario.expectedDiagnostic) {
                    return ["invalid scenario has no diagnostic oracle"];
                }
                const expected = resolveSelector(scenario.sql, scenario.expectedDiagnostic.span);
                return diagnosticFailures(snapshot.syntaxDiagnostics, [
                    { codeFamily: "syntax", span: expected },
                ]);
            }
            const failures: string[] = [];
            if (snapshot.syntaxDiagnostics.length > 0) {
                failures.push(`unexpected syntax diagnostics: ${describeDiagnostics(snapshot)}`);
            }
            if (scenario.expectedStatementKinds) {
                const actual = snapshot.statements.map((statement) => statement.category);
                const expected = scenario.expectedStatementKinds.map(expectedStatementCategory);
                if (!sameArray(actual, expected)) {
                    failures.push(
                        `statement categories ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
                    );
                }
            }
            return failures;
        }
        case "recovery": {
            const damaged = resolveSelector(scenario.sql, scenario.damagedSpan);
            const failures: string[] = [];
            if (!snapshot.syntaxDiagnostics.some((item) => spansTouch(item.span, damaged))) {
                failures.push(`no syntax diagnostic at damaged span ${formatSpan(damaged)}`);
            }
            if (scenario.preservedStatement) {
                const preserved = resolveSelector(scenario.sql, scenario.preservedStatement);
                if (!snapshot.statements.some((statement) => contains(statement.span, preserved))) {
                    failures.push(`later statement at ${formatSpan(preserved)} was not preserved`);
                }
            }
            if (scenario.completion) {
                failures.push(
                    ...completionFailures(
                        snapshot,
                        resolveSelector(scenario.sql, scenario.completion.caret).start,
                        scenario.completion.include,
                        scenario.completion.exclude,
                    ),
                );
            }
            return failures;
        }
        case "diagnosticSpans":
            return evaluateDiagnosticScenario(scenario, snapshot);
        case "dmlTargets":
            return evaluateDmlTargetScenario(scenario, snapshot);
        case "scopes": {
            const offset = selectorOffset(scenario.sql, scenario.at);
            const visible = visibleScopeSymbols(snapshot, snapshot.scopeAt(offset));
            const failures: string[] = [];
            for (const expected of scenario.visible) {
                if (!visible.has(symbolKey(expected.kind, expected.name))) {
                    failures.push(`missing visible ${expected.kind} ${expected.name}`);
                }
            }
            for (const hidden of scenario.hidden ?? []) {
                if (visible.has(symbolKey(hidden.kind, hidden.name))) {
                    failures.push(`unexpected visible ${hidden.kind} ${hidden.name}`);
                }
            }
            return failures;
        }
        case "symbols": {
            const actual = snapshot.symbols();
            const failures: string[] = [];
            for (const expected of scenario.expected) {
                const span = resolveSelector(scenario.sql, expected.span);
                if (
                    !actual.some(
                        (symbol) =>
                            normalizeName(symbol.name) === normalizeName(expected.name) &&
                            normalizeName(symbol.kind) === normalizeName(expected.kind) &&
                            symbol.modifiers.includes(expected.role) &&
                            sameSpan(symbol.span, span),
                    )
                ) {
                    failures.push(
                        `missing ${expected.role} ${expected.kind} ${expected.name} at ${formatSpan(span)}`,
                    );
                }
            }
            return failures;
        }
        case "references": {
            const result = snapshot.referencesAt(selectorOffset(scenario.sql, scenario.at));
            if (!result) {
                return ["referencesAt returned no result"];
            }
            const failures: string[] = [];
            if (normalizeSymbolName(result.symbol) !== normalizeSymbolName(scenario.symbol.name)) {
                failures.push(`symbol ${result.symbol}, expected ${scenario.symbol.name}`);
            }
            if (normalizeName(result.kind) !== normalizeName(scenario.symbol.kind)) {
                failures.push(`kind ${result.kind}, expected ${scenario.symbol.kind}`);
            }
            const expected = scenario.occurrences.map((occurrence) => ({
                span: resolveSelector(scenario.sql, occurrence.span),
                role: occurrence.role === "write" ? "reference" : occurrence.role,
            }));
            const actual = result.occurrences.map((occurrence) => ({
                span: occurrence.span,
                role: occurrence.role,
            }));
            if (!sameOccurrences(actual, expected)) {
                failures.push(
                    `occurrences ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
                );
            }
            return failures;
        }
        case "types": {
            const actual = snapshot.typeAt(selectorOffset(scenario.sql, scenario.at));
            const normalized = normalizeType(actual.display);
            return normalized === normalizeType(scenario.expectedType)
                ? []
                : [`type ${actual.display}, expected ${scenario.expectedType}`];
        }
        case "completions":
            return completionFailures(
                snapshot,
                resolveSelector(scenario.sql, scenario.caret).start,
                scenario.include,
                scenario.exclude,
            );
    }
}

function evaluateDiagnosticScenario(
    scenario: DiagnosticSpanScenario,
    snapshot: SqlAnalysisSnapshot,
): string[] {
    const expected = scenario.expectedDiagnostics.map((diagnostic) => ({
        codeFamily: diagnostic.codeFamily,
        span: resolveSelector(scenario.sql, diagnostic.span),
    }));
    const actual = [...snapshot.syntaxDiagnostics, ...snapshot.semanticDiagnostics];
    const failures = diagnosticFailures(actual, expected);
    if (scenario.exact && actual.length !== expected.length) {
        failures.push(`diagnostic count ${actual.length}, expected ${expected.length}`);
    }
    return failures;
}

function evaluateDmlTargetScenario(
    scenario: DmlTargetScenario,
    snapshot: SqlAnalysisSnapshot,
): string[] {
    const expectedSpan = resolveSelector(scenario.sql, scenario.target);
    const references =
        scenario.statementKind === "execute"
            ? snapshot
                  .externalReferences()
                  .filter((reference) => reference.role === "execute")
                  .map((reference) => ({ operation: "execute", target: reference }))
            : snapshot.mutationTargets();
    const expectedOperation = scenario.statementKind;
    const found = references.some(
        ({ operation, target }) =>
            operation === expectedOperation &&
            normalizeName(target.name) === normalizeName(scenario.targetName) &&
            sameSpan(target.span, expectedSpan),
    );
    const failures = found
        ? []
        : [
              `missing ${expectedOperation} target ${scenario.targetName} at ${formatSpan(expectedSpan)}`,
          ];
    const diagnostics = snapshot.semanticDiagnostics.filter((diagnostic) =>
        isDiagnosticFamily(diagnostic, "unknown-object"),
    );
    if (scenario.targetExists) {
        if (diagnostics.some((diagnostic) => sameSpan(diagnostic.span, expectedSpan))) {
            failures.push("known target was diagnosed as unknown");
        }
    } else if (!diagnostics.some((diagnostic) => sameSpan(diagnostic.span, expectedSpan))) {
        failures.push(`missing unknown-object diagnostic at ${formatSpan(expectedSpan)}`);
    }
    return failures;
}

function diagnosticFailures(
    actual: readonly SqlDiagnostic[],
    expected: ReadonlyArray<{ codeFamily: string; span: SqlSpan }>,
): string[] {
    return expected.flatMap((item) =>
        actual.some(
            (diagnostic) =>
                isDiagnosticFamily(diagnostic, item.codeFamily) &&
                sameSpan(diagnostic.span, item.span),
        )
            ? []
            : [`missing ${item.codeFamily} diagnostic at ${formatSpan(item.span)}`],
    );
}

function isDiagnosticFamily(diagnostic: SqlDiagnostic, family: string): boolean {
    const code = normalizeName(diagnostic.code);
    if (family === "syntax") {
        return diagnostic.kind === "syntax";
    }
    if (family === "unknown-object") {
        return (
            diagnostic.kind === "semantic" &&
            (/unknown(?:-|_)?(?:object|table|relation|procedure|function)/.test(code) ||
                code === "mssql208")
        );
    }
    return code.includes(normalizeName(family));
}

function completionFailures(
    snapshot: SqlAnalysisSnapshot,
    offset: number,
    include: readonly string[],
    exclude: readonly string[] = [],
): string[] {
    const labels = new Set(
        snapshot.completeAt(offset).items.map((item) => normalizeName(item.label)),
    );
    return [
        ...include
            .filter((label) => !labels.has(normalizeName(label)))
            .map((label) => `missing completion ${label}`),
        ...exclude
            .filter((label) => labels.has(normalizeName(label)))
            .map((label) => `unexpected completion ${label}`),
    ];
}

function visibleScopeSymbols(
    snapshot: SqlAnalysisSnapshot,
    initial: SqlScope | undefined,
): Set<string> {
    const scopes = new Map(snapshot.scopes.map((scope) => [scope.id, scope]));
    const result = new Set<string>();
    let scope = initial;
    while (scope) {
        for (const source of scope.sources) {
            result.add(symbolKey("alias", source.key));
            if (source.name) {
                result.add(symbolKey(source.kind, source.name));
            }
        }
        scope = scope.parentId ? scopes.get(scope.parentId) : undefined;
    }
    return result;
}

function selectorOffset(sql: string, selector: Parameters<typeof resolveSelector>[1]): number {
    const span = resolveSelector(sql, selector);
    return span.start + Math.min(1, Math.max(0, span.end - span.start - 1));
}

function expectedStatementCategory(kind: string): SqlStatementCategory {
    if (["select", "query"].includes(normalizeName(kind))) {
        return "query";
    }
    if (["insert", "update", "delete", "merge", "dml"].includes(normalizeName(kind))) {
        return "dml";
    }
    return normalizeName(kind) as SqlStatementCategory;
}

function sameOccurrences(
    actual: ReadonlyArray<{ span: SqlSpan; role: string }>,
    expected: ReadonlyArray<{ span: SqlSpan; role: string }>,
): boolean {
    const key = (item: { span: SqlSpan; role: string }) =>
        `${item.span.start}:${item.span.end}:${item.role}`;
    return sameArray(actual.map(key).sort(), expected.map(key).sort());
}

function normalizeType(value: string): string {
    return value.toLocaleLowerCase().replaceAll(/\s+/g, "");
}

function normalizeName(value: string): string {
    return value.toLocaleLowerCase();
}

function normalizeSymbolName(value: string): string {
    return normalizeName(value).replace(/^@/, "");
}

function symbolKey(kind: string, name: string): string {
    return `${normalizeName(kind)}:${normalizeSymbolName(name)}`;
}

function sameSpan(left: SqlSpan, right: SqlSpan): boolean {
    return left.start === right.start && left.end === right.end;
}

function contains(container: SqlSpan, item: SqlSpan): boolean {
    return container.start <= item.start && item.end <= container.end;
}

function spansTouch(left: SqlSpan, right: SqlSpan): boolean {
    if (right.start === right.end) {
        return left.start <= right.start && right.start <= left.end;
    }
    return left.start <= right.end && right.start <= left.end;
}

function sameArray<T>(left: readonly T[], right: readonly T[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function describeDiagnostics(snapshot: SqlAnalysisSnapshot): string {
    return JSON.stringify([...snapshot.syntaxDiagnostics, ...snapshot.semanticDiagnostics]);
}

function formatSpan(span: SqlSpan): string {
    return `${span.start}:${span.end}`;
}
