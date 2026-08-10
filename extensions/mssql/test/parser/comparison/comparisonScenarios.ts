/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Parser-independent comparison inputs and oracles.
 *
 * These scenarios intentionally describe observable editor behaviour rather than either
 * parser's AST. An adapter that cannot expose a feature receives a failed scenario for that
 * feature; callers must not remove unsupported scenarios from the denominator.
 */

export type ComparisonFeature =
    | "syntax"
    | "recovery"
    | "diagnosticSpans"
    | "dmlTargets"
    | "scopes"
    | "symbols"
    | "references"
    | "types"
    | "completions";

export interface TextSelector {
    needle: string;
    occurrence?: number;
}

export interface ComparisonSchema {
    schemas: Record<string, Record<string, Record<string, string>>>;
    procedures: string[];
}

interface ScenarioBase {
    id: string;
    feature: ComparisonFeature;
    description: string;
    sql: string;
}

export interface SyntaxScenario extends ScenarioBase {
    feature: "syntax";
    valid: boolean;
    expectedStatementKinds?: string[];
    expectedDiagnostic?: {
        codeFamily: "syntax";
        span: TextSelector | "eof";
    };
}

export interface RecoveryScenario extends ScenarioBase {
    feature: "recovery";
    damagedSpan: TextSelector | "eof";
    preservedStatement?: TextSelector;
    completion?: {
        caret: TextSelector | "eof";
        include: string[];
        exclude?: string[];
    };
}

export interface DiagnosticSpanScenario extends ScenarioBase {
    feature: "diagnosticSpans";
    expectedDiagnostics: Array<{
        codeFamily: "syntax" | "unknown-object" | "unknown-column" | "ambiguous-column";
        span: TextSelector | "eof";
    }>;
    /** Exact means missing diagnostics and unrelated false positives both fail the scenario. */
    exact: boolean;
}

export interface DmlTargetScenario extends ScenarioBase {
    feature: "dmlTargets";
    statementKind: "insert" | "update" | "delete" | "merge" | "execute";
    target: TextSelector;
    targetName: string;
    targetExists: boolean;
    expectedDiagnosticSpan?: TextSelector;
}

export interface ScopeScenario extends ScenarioBase {
    feature: "scopes";
    at: TextSelector;
    visible: Array<{ name: string; kind: string }>;
    hidden?: Array<{ name: string; kind: string }>;
}

export interface SymbolScenario extends ScenarioBase {
    feature: "symbols";
    expected: Array<{
        name: string;
        kind: string;
        role: "declaration" | "reference";
        span: TextSelector;
    }>;
}

export interface ReferenceScenario extends ScenarioBase {
    feature: "references";
    at: TextSelector;
    symbol: { name: string; kind: string };
    occurrences: Array<{
        span: TextSelector;
        role: "declaration" | "reference" | "write";
    }>;
}

export interface TypeScenario extends ScenarioBase {
    feature: "types";
    at: TextSelector;
    expectedType: string;
}

export interface CompletionScenario extends ScenarioBase {
    feature: "completions";
    caret: TextSelector | "eof";
    include: string[];
    exclude?: string[];
}

export type ComparisonScenario =
    | SyntaxScenario
    | RecoveryScenario
    | DiagnosticSpanScenario
    | DmlTargetScenario
    | ScopeScenario
    | SymbolScenario
    | ReferenceScenario
    | TypeScenario
    | CompletionScenario;

export const comparisonSchema: ComparisonSchema = {
    schemas: {
        dbo: {
            Users: {
                UserId: "int",
                DisplayName: "nvarchar",
                IsActive: "bit",
            },
            Orders: {
                OrderId: "int",
                UserId: "int",
                Total: "decimal(10,2)",
                OrderDate: "datetime2",
            },
        },
    },
    procedures: ["dbo.ArchiveUsers"],
};

export const comparisonScenarios: readonly ComparisonScenario[] = [
    {
        id: "syntax-multi-cte-window",
        feature: "syntax",
        description: "Accepts the complete multi-CTE/window surface from the migration contracts",
        valid: true,
        expectedStatementKinds: ["query"],
        sql: `WITH ActiveUsers AS (
    SELECT UserId, DisplayName FROM dbo.Users WHERE IsActive = 1
), RankedOrders AS (
    SELECT o.UserId, o.Total,
        ROW_NUMBER() OVER (PARTITION BY o.UserId ORDER BY o.OrderDate DESC) AS rn
    FROM dbo.Orders AS o
)
SELECT a.UserId, a.DisplayName, r.Total
FROM ActiveUsers AS a
LEFT JOIN RankedOrders AS r ON r.UserId = a.UserId AND r.rn = 1;`,
    },
    {
        id: "syntax-merge-output",
        feature: "syntax",
        description: "Accepts MERGE branches and OUTPUT pseudo tables",
        valid: true,
        expectedStatementKinds: ["merge"],
        sql: `MERGE dbo.Users AS target
USING dbo.Users AS source ON target.UserId = source.UserId
WHEN MATCHED THEN UPDATE SET target.DisplayName = source.DisplayName
WHEN NOT MATCHED THEN INSERT (UserId, DisplayName)
    VALUES (source.UserId, source.DisplayName)
OUTPUT $action, inserted.UserId, deleted.UserId;`,
    },
    {
        id: "syntax-pivot-apply-json",
        feature: "syntax",
        description: "Accepts derived PIVOT, APPLY, and FOR JSON in one batch",
        valid: true,
        expectedStatementKinds: ["query", "query", "query"],
        sql:
            "SELECT UserId, [Open] FROM (SELECT UserId, Total FROM dbo.Orders) AS s " +
            "PIVOT (SUM(Total) FOR UserId IN ([Open])) AS p;\n" +
            "SELECT u.UserId, x.Total FROM dbo.Users AS u OUTER APPLY " +
            "(SELECT TOP (1) o.Total FROM dbo.Orders AS o WHERE o.UserId = u.UserId) AS x;\n" +
            "SELECT UserId FROM dbo.Users FOR JSON PATH;",
    },
    {
        id: "syntax-incomplete-where",
        feature: "syntax",
        description: "Rejects a missing predicate instead of treating silence as support",
        valid: false,
        expectedDiagnostic: { codeFamily: "syntax", span: "eof" },
        sql: "SELECT UserId FROM dbo.Users WHERE",
    },
    {
        id: "recovery-trailing-statement",
        feature: "recovery",
        description: "Preserves a later statement after a damaged JOIN predicate",
        damagedSpan: { needle: "=" },
        preservedStatement: { needle: "SELECT DisplayName", occurrence: 0 },
        sql:
            "SELECT u.UserId FROM dbo.Users AS u JOIN dbo.Orders AS o ON u.UserId = ;\n" +
            "SELECT DisplayName FROM dbo.Users;",
    },
    {
        id: "recovery-alias-completion",
        feature: "recovery",
        description: "Retains alias scope at an incomplete member access",
        damagedSpan: "eof",
        completion: {
            caret: "eof",
            include: ["OrderId", "UserId", "Total", "OrderDate"],
            exclude: ["DisplayName", "IsActive"],
        },
        sql: "SELECT * FROM dbo.Users AS u JOIN dbo.Orders AS o ON o.",
    },
    {
        id: "diagnostic-unknown-column-span",
        feature: "diagnosticSpans",
        description: "Reports exactly the missing projected column",
        expectedDiagnostics: [{ codeFamily: "unknown-column", span: { needle: "MissingColumn" } }],
        exact: true,
        sql: "SELECT MissingColumn FROM dbo.Users",
    },
    {
        id: "diagnostic-ambiguous-column-span",
        feature: "diagnosticSpans",
        description: "Reports exactly the ambiguous unqualified join column",
        expectedDiagnostics: [{ codeFamily: "ambiguous-column", span: { needle: "UserId" } }],
        exact: true,
        sql: "SELECT UserId FROM dbo.Users AS u JOIN dbo.Orders AS o " + "ON u.UserId = o.UserId",
    },
    {
        id: "diagnostic-valid-query-clean",
        feature: "diagnosticSpans",
        description: "Penalizes false positives on a valid correlated query",
        expectedDiagnostics: [],
        exact: true,
        sql:
            "SELECT u.UserId FROM dbo.Users AS u WHERE EXISTS " +
            "(SELECT 1 FROM dbo.Orders AS o WHERE o.UserId = u.UserId)",
    },
    ...dmlTargetScenarios(),
    {
        id: "scope-correlated-subquery",
        feature: "scopes",
        description: "Exposes both local and correlated aliases inside a subquery",
        at: { needle: "o.UserId = u.UserId" },
        visible: [
            { name: "o", kind: "alias" },
            { name: "u", kind: "alias" },
        ],
        sql:
            "SELECT u.UserId FROM dbo.Users AS u WHERE EXISTS " +
            "(SELECT 1 FROM dbo.Orders AS o WHERE o.UserId = u.UserId)",
    },
    {
        id: "scope-batch-isolation",
        feature: "scopes",
        description: "Does not leak variables across GO-separated batches",
        at: { needle: "SELECT @BatchValue", occurrence: 0 },
        visible: [],
        hidden: [{ name: "@BatchValue", kind: "variable" }],
        sql: "DECLARE @BatchValue int = 1;\nGO\nSELECT @BatchValue;",
    },
    {
        id: "symbols-cte-aliases",
        feature: "symbols",
        description: "Produces declaration/reference roles for CTE and alias symbols",
        expected: [
            {
                name: "Recent",
                kind: "cte",
                role: "declaration",
                span: { needle: "Recent", occurrence: 0 },
            },
            {
                name: "Recent",
                kind: "cte",
                role: "reference",
                span: { needle: "Recent", occurrence: 1 },
            },
            {
                name: "recent_alias",
                kind: "alias",
                role: "declaration",
                span: { needle: "recent_alias", occurrence: 1 },
            },
        ],
        sql:
            "WITH Recent AS (SELECT UserId FROM dbo.Users) " +
            "SELECT recent_alias.UserId FROM Recent AS recent_alias",
    },
    {
        id: "references-variable-cross-statement",
        feature: "references",
        description: "Returns every declaration/read of a variable across statements",
        at: { needle: "@MinTotal", occurrence: 1 },
        symbol: { name: "MinTotal", kind: "variable" },
        occurrences: [
            { span: { needle: "@MinTotal", occurrence: 0 }, role: "declaration" },
            { span: { needle: "@MinTotal", occurrence: 1 }, role: "reference" },
            { span: { needle: "@MinTotal", occurrence: 2 }, role: "reference" },
        ],
        sql:
            "DECLARE @MinTotal decimal(10,2) = 10; " +
            "SELECT OrderId FROM dbo.Orders WHERE Total > @MinTotal; " +
            "SELECT @MinTotal AS Threshold;",
    },
    {
        id: "references-cte",
        feature: "references",
        description: "Connects a CTE declaration to its source use",
        at: { needle: "Recent", occurrence: 1 },
        symbol: { name: "Recent", kind: "cte" },
        occurrences: [
            { span: { needle: "Recent", occurrence: 0 }, role: "declaration" },
            { span: { needle: "Recent", occurrence: 1 }, role: "reference" },
        ],
        sql: "WITH Recent AS (SELECT UserId FROM dbo.Users) SELECT * FROM Recent",
    },
    {
        id: "types-schema-column",
        feature: "types",
        description: "Infers catalog-backed scalar types at column references",
        at: { needle: "u.DisplayName" },
        expectedType: "nvarchar",
        sql: "SELECT u.DisplayName FROM dbo.Users AS u",
    },
    {
        id: "types-expression",
        feature: "types",
        description: "Applies SQL Server's decimal SUM result-type rule",
        at: { needle: "SUM(o.Total)" },
        expectedType: "decimal(38,2)",
        sql: "SELECT SUM(o.Total) FROM dbo.Orders AS o",
    },
    {
        id: "completion-alias-columns",
        feature: "completions",
        description: "Returns only columns belonging to the qualified alias",
        caret: "eof",
        include: ["OrderId", "UserId", "Total", "OrderDate"],
        exclude: ["DisplayName", "IsActive"],
        sql: "SELECT * FROM dbo.Users AS u JOIN dbo.Orders AS o ON o.",
    },
    {
        id: "completion-cte",
        feature: "completions",
        description: "Offers a CTE relation at the FROM cursor",
        caret: "eof",
        include: ["recent"],
        sql: "WITH recent AS (SELECT UserId FROM dbo.Users) SELECT * FROM rec",
    },
    {
        id: "completion-group-by",
        feature: "completions",
        description: "Offers visible source columns in GROUP BY",
        caret: "eof",
        include: ["OrderId", "UserId", "Total", "OrderDate"],
        exclude: ["DisplayName", "IsActive"],
        sql: "SELECT UserId, COUNT(*) FROM dbo.Orders GROUP BY ",
    },
] as const;

/** Resolves a selector without coupling the comparison runner to either parser's location model. */
export function resolveSelector(
    sql: string,
    selector: TextSelector | "eof",
): {
    start: number;
    end: number;
} {
    if (selector === "eof") {
        return { start: sql.length, end: sql.length };
    }

    const occurrence = selector.occurrence ?? 0;
    let start = -1;
    let from = 0;
    for (let index = 0; index <= occurrence; index++) {
        start = sql.indexOf(selector.needle, from);
        if (start < 0) {
            throw new Error(
                `Selector ${JSON.stringify(selector.needle)} occurrence ${occurrence} was not found`,
            );
        }
        from = start + selector.needle.length;
    }
    return { start, end: start + selector.needle.length };
}

function dmlTargetScenarios(): DmlTargetScenario[] {
    const inputs: Array<{
        statementKind: DmlTargetScenario["statementKind"];
        sql: string;
        targetName: string;
        targetExists: boolean;
    }> = [
        {
            statementKind: "insert",
            sql: "INSERT INTO dbo.DoesNotExist (UserId) VALUES (1)",
            targetName: "dbo.DoesNotExist",
            targetExists: false,
        },
        {
            statementKind: "update",
            sql: "UPDATE dbo.DoesNotExist SET UserId = 1",
            targetName: "dbo.DoesNotExist",
            targetExists: false,
        },
        {
            statementKind: "delete",
            sql: "DELETE FROM dbo.DoesNotExist WHERE UserId = 1",
            targetName: "dbo.DoesNotExist",
            targetExists: false,
        },
        {
            statementKind: "merge",
            sql:
                "MERGE dbo.DoesNotExist AS target USING dbo.Users AS source " +
                "ON target.UserId = source.UserId WHEN MATCHED THEN DELETE;",
            targetName: "dbo.DoesNotExist",
            targetExists: false,
        },
        {
            statementKind: "execute",
            sql: "EXEC dbo.DoesNotExist @UserId = 1",
            targetName: "dbo.DoesNotExist",
            targetExists: false,
        },
        {
            statementKind: "insert",
            sql: "INSERT INTO dbo.Users (UserId, IsActive) VALUES (1, 1)",
            targetName: "dbo.Users",
            targetExists: true,
        },
        {
            statementKind: "execute",
            sql: "EXEC dbo.ArchiveUsers @UserId = 1",
            targetName: "dbo.ArchiveUsers",
            targetExists: true,
        },
    ];

    return inputs.map((input) => {
        const scenario: DmlTargetScenario = {
            id: `dml-target-${input.statementKind}-${input.targetExists ? "known" : "unknown"}`,
            feature: "dmlTargets",
            description: `${input.statementKind} exposes and validates its target`,
            sql: input.sql,
            statementKind: input.statementKind,
            target: { needle: input.targetName },
            targetName: input.targetName,
            targetExists: input.targetExists,
        };
        if (!input.targetExists) {
            scenario.expectedDiagnosticSpan = { needle: input.targetName };
        }
        return scenario;
    });
}
