/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { MappingCatalogProvider, type SqlSymbol as Sym } from "@vscode-mssql/tsql-language-service";
import { PackageAnalysisSession as SqlSession } from "../packageAnalysisSession";

interface CompleteStressScenario {
    name: string;
    sql: string;
    expectedSymbols: Array<{ kind: Sym["kind"]; name: string }>;
    expectedCategory?: "query" | "dml";
    expectedDiagnostic?: { kind: string; message: string };
    knownParserGap?: string;
}

interface RecoveryStressScenario {
    name: string;
    markedSql: string;
    expectedColumns: string[];
    knownParserGap?: string;
}

suite("Package parser contributed T-SQL stress scenarios", () => {
    const schema = createStressSchema();

    const completeScenarios: CompleteStressScenario[] = [
        {
            name: "multi-CTE window and aggregate query",
            sql: `WITH Base AS (
    SELECT
        t.Id,
        t.Name,
        t.CategoryId,
        t.CreatedAt,
        ROW_NUMBER() OVER (
            PARTITION BY t.CategoryId
            ORDER BY t.CreatedAt DESC
        ) AS rn,
        COUNT(*) OVER (
            PARTITION BY t.CategoryId
        ) AS CategoryCount
    FROM dbo.DboScale00001 AS t
),
Latest AS (
    SELECT *
    FROM Base
    WHERE rn = 1
)
SELECT
    l.CategoryId,
    l.Id,
    l.Name,
    l.CategoryCount
FROM Latest AS l
ORDER BY l.CategoryCount DESC, l.Id;`,
            expectedSymbols: [
                { kind: "cte", name: "Base" },
                { kind: "cte", name: "Latest" },
                { kind: "column", name: "l.CategoryCount" },
            ],
        },
        {
            name: "nested joins derived aggregate and correlated subqueries",
            sql: `SELECT
    a.Id,
    a.Name,
    b.Description,
    d.TotalCount
FROM dbo.DboScale00001 AS a
INNER JOIN dbo.DboScale00002 AS b
    ON a.Id = b.ParentId
LEFT JOIN (
    SELECT
        c.ParentId,
        COUNT(*) AS TotalCount
    FROM dbo.DboScale00003 AS c
    WHERE EXISTS (
        SELECT 1
        FROM dbo.DboScale00004 AS x
        WHERE x.Id = c.Id
          AND x.IsActive = 1
    )
    GROUP BY c.ParentId
) AS d
    ON d.ParentId = a.Id
WHERE a.Id IN (
    SELECT z.ParentId
    FROM dbo.DboScale00005 AS z
    WHERE z.CreatedAt > DATEADD(DAY, -30, SYSUTCDATETIME())
);`,
            expectedSymbols: [
                { kind: "alias", name: "d" },
                { kind: "column", name: "d.TotalCount" },
                { kind: "column", name: "x.IsActive" },
            ],
        },
        {
            name: "correlated CROSS APPLY TOP lookup",
            sql: `SELECT
    p.Id,
    p.Name,
    latest.ChildId,
    latest.CreatedAt
FROM dbo.DboScale00001 AS p
CROSS APPLY (
    SELECT TOP (1)
        c.Id AS ChildId,
        c.CreatedAt
    FROM dbo.DboScale00002 AS c
    WHERE c.ParentId = p.Id
    ORDER BY c.CreatedAt DESC
) AS latest;`,
            expectedSymbols: [
                { kind: "alias", name: "latest" },
                { kind: "column", name: "latest.ChildId" },
                { kind: "column", name: "p.Id" },
            ],
        },
        {
            name: "OUTER APPLY aggregate subquery",
            sql: `SELECT
    p.Id,
    p.Name,
    stats.ChildCount,
    stats.MaxCreatedAt
FROM dbo.DboScale00001 AS p
OUTER APPLY (
    SELECT
        COUNT(*) AS ChildCount,
        MAX(c.CreatedAt) AS MaxCreatedAt
    FROM dbo.DboScale00002 AS c
    WHERE c.ParentId = p.Id
) AS stats
WHERE ISNULL(stats.ChildCount, 0) > 5;`,
            expectedSymbols: [
                { kind: "alias", name: "stats" },
                { kind: "column", name: "stats.ChildCount" },
                { kind: "column", name: "stats.MaxCreatedAt" },
            ],
        },
        {
            name: "bounded and unbounded window frames",
            sql: `SELECT
    t.Id,
    t.CategoryId,
    t.Amount,
    SUM(t.Amount) OVER (
        PARTITION BY t.CategoryId
        ORDER BY t.CreatedAt
        ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
    ) AS RollingAmount,
    AVG(t.Amount) OVER (
        PARTITION BY t.CategoryId
        ORDER BY t.CreatedAt
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS RunningAverage
FROM dbo.DboScale00001 AS t;`,
            expectedSymbols: [
                { kind: "column", name: "t.Amount" },
                { kind: "column", name: "t.CategoryId" },
                { kind: "function", name: "SUM" },
            ],
        },
        {
            name: "recursive hierarchy CTE with query option",
            sql: `WITH Hierarchy AS (
    SELECT
        t.Id,
        t.ParentId,
        t.Name,
        0 AS Depth,
        CAST('/' + CAST(t.Id AS varchar(20)) AS varchar(max)) AS Path
    FROM dbo.DboScale00001 AS t
    WHERE t.ParentId IS NULL

    UNION ALL

    SELECT
        c.Id,
        c.ParentId,
        c.Name,
        h.Depth + 1,
        CAST(h.Path + '/' + CAST(c.Id AS varchar(20)) AS varchar(max))
    FROM dbo.DboScale00001 AS c
    INNER JOIN Hierarchy AS h
        ON c.ParentId = h.Id
)
SELECT *
FROM Hierarchy
OPTION (MAXRECURSION 100);`,
            expectedSymbols: [
                { kind: "cte", name: "Hierarchy" },
                { kind: "column", name: "h.Depth" },
                { kind: "column", name: "h.Path" },
            ],
        },
        {
            name: "MERGE with all branches and OUTPUT pseudo tables",
            sql: `MERGE dbo.DboScale00001 AS target
USING dbo.DboScale00002 AS source
    ON target.Id = source.Id
WHEN MATCHED AND target.Name <> source.Name THEN
    UPDATE SET
        target.Name = source.Name,
        target.ModifiedAt = SYSUTCDATETIME()
WHEN NOT MATCHED BY TARGET THEN
    INSERT (Id, Name, CreatedAt)
    VALUES (source.Id, source.Name, SYSUTCDATETIME())
WHEN NOT MATCHED BY SOURCE THEN
    DELETE
OUTPUT
    $action,
    inserted.Id,
    deleted.Id;`,
            expectedSymbols: [],
            expectedCategory: "dml",
        },
        {
            name: "PIVOT over a derived relation",
            sql: `SELECT
    CategoryId,
    [Open],
    [Closed],
    [Pending]
FROM (
    SELECT
        t.CategoryId,
        t.Status,
        t.Id
    FROM dbo.DboScale00001 AS t
) AS src
PIVOT (
    COUNT(Id)
    FOR Status IN ([Open], [Closed], [Pending])
) AS p;`,
            expectedSymbols: [
                { kind: "subquery", name: "p" },
                { kind: "column", name: "CategoryId" },
                { kind: "column", name: "Open" },
            ],
        },
        {
            name: "UNPIVOT with generated metric columns",
            sql: `SELECT
    t.Id,
    u.MetricName,
    u.MetricValue
FROM dbo.DboScale00001 AS t
UNPIVOT (
    MetricValue
    FOR MetricName IN (
        Metric1,
        Metric2,
        Metric3
    )
) AS u;`,
            expectedSymbols: [
                { kind: "subquery", name: "u" },
                { kind: "column", name: "u.MetricName" },
                { kind: "column", name: "u.MetricValue" },
            ],
        },
        {
            name: "OPENJSON extraction with an explicit schema",
            sql: `SELECT
    t.Id,
    j.Name,
    j.Value,
    j.Ordinal
FROM dbo.DboScale00001 AS t
CROSS APPLY OPENJSON(t.JsonData, '$.items')
WITH (
    Name nvarchar(200) '$.name',
    Value decimal(18,2) '$.value',
    Ordinal int '$.ordinal'
) AS j
WHERE j.Value > 100;`,
            expectedSymbols: [
                { kind: "alias", name: "j" },
                { kind: "column", name: "j.Value" },
                { kind: "column", name: "j.Ordinal" },
            ],
        },
        {
            name: "nested FOR JSON generation",
            sql: `SELECT
    p.Id,
    p.Name,
    (
        SELECT
            c.Id,
            c.Name,
            c.CreatedAt
        FROM dbo.DboScale00002 AS c
        WHERE c.ParentId = p.Id
        FOR JSON PATH
    ) AS Children
FROM dbo.DboScale00001 AS p
FOR JSON PATH, ROOT('parents');`,
            expectedSymbols: [
                { kind: "alias", name: "p" },
                { kind: "alias", name: "c" },
                { kind: "column", name: "c.ParentId" },
            ],
        },
        {
            name: "XML nodes and scalar XML methods",
            sql: `SELECT
    t.Id,
    n.value('(Name/text())[1]', 'nvarchar(100)') AS Name,
    n.value('(Value/text())[1]', 'int') AS Value
FROM dbo.DboScale00001 AS t
CROSS APPLY t.XmlData.nodes('/Root/Item') AS x(n)
WHERE n.exist('Value[. > 10]') = 1;`,
            expectedSymbols: [
                { kind: "alias", name: "x" },
                { kind: "column", name: "t.XmlData" },
                { kind: "column", name: "n" },
            ],
        },
        {
            name: "deeply nested derived-table alias resolution",
            sql: `SELECT
    outer_q.Id,
    outer_q.Name,
    outer_q.Total
FROM (
    SELECT
        inner_q.Id,
        inner_q.Name,
        SUM(inner_q.Amount) AS Total
    FROM (
        SELECT
            a.Id,
            a.Name,
            b.Amount
        FROM dbo.DboScale00001 AS a
        LEFT JOIN dbo.DboScale00002 AS b
            ON b.ParentId = a.Id
    ) AS inner_q
    GROUP BY
        inner_q.Id,
        inner_q.Name
) AS outer_q
WHERE outer_q.Total > 1000;`,
            expectedSymbols: [
                { kind: "alias", name: "outer_q" },
                { kind: "column", name: "outer_q.Total" },
                { kind: "column", name: "inner_q.Amount" },
            ],
        },
        {
            name: "cross-database and cross-schema references",
            sql: `SELECT
    a.Id,
    b.Id,
    c.Id
FROM Issue21930Repro_6d31c8a4.dbo.DboScale00001 AS a
INNER JOIN Issue21930Repro_6d31c8a4.sales.DboScale00002 AS b
    ON b.ParentId = a.Id
LEFT JOIN master.dbo.spt_values AS c
    ON c.number = a.Id
WHERE c.type = 'P';`,
            expectedSymbols: [
                { kind: "table", name: "Issue21930Repro_6d31c8a4.dbo.DboScale00001" },
                { kind: "table", name: "Issue21930Repro_6d31c8a4.sales.DboScale00002" },
                { kind: "column", name: "c.number" },
            ],
            expectedDiagnostic: {
                kind: "semantic",
                message: "Invalid column name 'Id'.",
            },
        },
        {
            name: "UNION ALL with expressions and a correlated anti-join",
            sql: `SELECT
    t.Id,
    t.Name,
    CAST('primary' AS varchar(20)) AS Source
FROM dbo.DboScale00001 AS t

UNION ALL

SELECT
    x.Id,
    COALESCE(x.DisplayName, x.Name),
    'secondary'
FROM dbo.DboScale00002 AS x
WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.DboScale00001 AS t
    WHERE t.Id = x.Id
);`,
            expectedSymbols: [
                { kind: "alias", name: "x" },
                { kind: "column", name: "x.DisplayName" },
                { kind: "function", name: "COALESCE" },
            ],
        },
    ];

    for (const scenario of completeScenarios) {
        /** Verifies a contributed complete stress query parses, binds, and exposes its key symbols. */
        const register = scenario.knownParserGap ? test.skip : test;
        register(`analyzes ${scenario.name}`, () => {
            const session = createSession(scenario.sql, schema);

            expect(session.syntaxDiagnostics, scenario.name).to.be.empty;
            expect(session.doc.statements[0]?.category, scenario.name).to.equal(
                scenario.expectedCategory ?? "query",
            );
            const diagnostics = session.diagnostics();
            if (scenario.expectedDiagnostic) {
                expect(
                    diagnostics.some(
                        (diagnostic) =>
                            "kind" in diagnostic &&
                            diagnostic.kind === scenario.expectedDiagnostic?.kind &&
                            diagnostic.message === scenario.expectedDiagnostic.message,
                    ),
                    `${scenario.name}: ${JSON.stringify(diagnostics)}`,
                ).to.be.true;
                expect(diagnostics, scenario.name).to.have.lengthOf(1);
            } else {
                expect(diagnostics, `${scenario.name}: ${JSON.stringify(diagnostics)}`).to.be.empty;
            }

            const symbols = session.deriveSymbols();
            const symbolInventory = symbols.map(({ kind, name }) => ({ kind, name }));
            for (const expected of scenario.expectedSymbols) {
                expect(symbolInventory, scenario.name).to.deep.include(expected);
            }
        });
    }

    const recoveryScenarios: RecoveryStressScenario[] = [
        {
            name: "projection after a table alias dot",
            markedSql: `SELECT t.|
FROM dbo.DboScale00001 AS t;`,
            expectedColumns: ["Id", "Name", "CategoryId", "CreatedAt"],
        },
        {
            name: "JOIN predicate after a left-side alias dot",
            markedSql: `SELECT *
FROM dbo.DboScale00001 AS t
INNER JOIN dbo.DboScale00002 AS k
    ON t.|`,
            expectedColumns: ["Id", "Name", "CategoryId", "CreatedAt"],
        },
        {
            name: "damaged CTE projection after its source alias dot",
            markedSql: `WITH x AS (
    SELECT
        t.Id,
        t.|
    FROM dbo.DboScale00001 AS t
)
SELECT x.
FROM x;`,
            expectedColumns: ["Id", "Name", "CategoryId", "CreatedAt"],
        },
        {
            name: "outer projection from a damaged CTE",
            markedSql: `WITH x AS (
    SELECT
        t.Id,
        t.
    FROM dbo.DboScale00001 AS t
)
SELECT x.|
FROM x;`,
            expectedColumns: ["Id"],
        },
        {
            name: "APPLY projection after its local alias dot",
            markedSql: `SELECT *
FROM dbo.DboScale00001 AS t
CROSS APPLY (
    SELECT TOP 1 k.|
    FROM dbo.DboScale00002 AS k
    WHERE k.ParentId = t.
) AS q;`,
            expectedColumns: ["Id", "ParentId", "Name", "CreatedAt"],
        },
        {
            name: "correlated APPLY predicate after its outer alias dot",
            markedSql: `SELECT *
FROM dbo.DboScale00001 AS t
CROSS APPLY (
    SELECT TOP 1 k.
    FROM dbo.DboScale00002 AS k
    WHERE k.ParentId = t.|
) AS q;`,
            expectedColumns: ["Id", "Name", "CategoryId", "CreatedAt"],
        },
        {
            name: "later WHERE clause after an incomplete JOIN equality",
            markedSql: `SELECT *
FROM dbo.DboScale00001 AS t
LEFT JOIN dbo.DboScale00002 AS k
    ON t.Id = k.Id
LEFT JOIN dbo.DboScale00003 AS z
    ON z.ParentId =
WHERE t.|`,
            expectedColumns: ["Id", "Name", "CategoryId", "CreatedAt"],
        },
    ];

    for (const scenario of recoveryScenarios) {
        /** Verifies completion preserves the correct alias scope while the surrounding query is incomplete. */
        const register = scenario.knownParserGap ? test.skip : test;
        register(`recovers ${scenario.name}`, () => {
            const { sql, offset } = caret(scenario.markedSql);
            const labels = createSession(sql, schema)
                .completeAt(offset)
                .map((completion) => completion.label);

            expect(labels, scenario.name).to.include.members(scenario.expectedColumns);
        });
    }
});

/** Creates a closed catalog covering every relation referenced by the contributed stress suite. */
function createStressSchema(): MappingCatalogProvider {
    const primary = {
        Id: "int",
        ParentId: "int",
        Name: "nvarchar(200)",
        CategoryId: "int",
        CreatedAt: "datetime2",
        ModifiedAt: "datetime2",
        Amount: "decimal(18,2)",
        Status: "nvarchar(30)",
        JsonData: "nvarchar(max)",
        XmlData: "xml",
        Metric1: "decimal(18,2)",
        Metric2: "decimal(18,2)",
        Metric3: "decimal(18,2)",
    };
    const child = {
        Id: "int",
        ParentId: "int",
        Name: "nvarchar(200)",
        DisplayName: "nvarchar(200)",
        Description: "nvarchar(400)",
        CreatedAt: "datetime2",
        Amount: "decimal(18,2)",
    };

    return new MappingCatalogProvider(
        {
            dbo: {
                DboScale00001: primary,
                DboScale00002: child,
                DboScale00003: { Id: "int", ParentId: "int" },
                DboScale00004: { Id: "int", IsActive: "bit" },
                DboScale00005: { ParentId: "int", CreatedAt: "datetime2" },
            },
            Issue21930Repro_6d31c8a4: {
                dbo: { DboScale00001: primary },
                sales: { DboScale00002: child },
            },
            master: {
                dbo: {
                    spt_values: {
                        name: "nvarchar(35)",
                        number: "int",
                        type: "nchar(3)",
                        low: "int",
                        high: "int",
                        status: "int",
                    },
                },
            },
        },
        1,
        "closed",
    );
}

/** Creates an isolated T-SQL session for a contributed stress query. */
function createSession(sql: string, schema: MappingCatalogProvider): SqlSession {
    return SqlSession.create(sql, {
        schema,
        uri: "file:///beta-sql-contributed-stress-scenarios.sql",
    });
}

/** Removes one cursor marker and returns its source offset. */
function caret(markedSql: string): { sql: string; offset: number } {
    const offset = markedSql.indexOf("|");
    expect(offset, "Scenario SQL must contain a caret marker").to.be.greaterThanOrEqual(0);
    return { sql: markedSql.replace("|", ""), offset };
}
