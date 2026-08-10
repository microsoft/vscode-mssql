/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    MappingCatalogProvider,
    type SqlSymbol as Sym,
    type SqlType as Type,
} from "@vscode-mssql/tsql-language-service";
import {
    formatAnalysisType as formatType,
    PackageAnalysisSession as SqlSession,
} from "../packageAnalysisSession";

suite("Package T-SQL language service scenarios", () => {
    const schema = new MappingCatalogProvider(
        {
            dbo: {
                Orders: {
                    OrderId: "int",
                    UserId: "int",
                    Total: "decimal(10,2)",
                    OrderDate: "datetime",
                },
                Users: {
                    UserId: "int",
                    DisplayName: "nvarchar",
                    IsActive: "bit",
                },
            },
            HumanResources: {
                vEmployee: {
                    EmployeeId: "int",
                    FirstName: "nvarchar",
                },
            },
        },
        1,
        "closed",
    );

    suite("completions", () => {
        const scenarios = [
            {
                name: "table alias columns",
                sql: "SELECT u.| FROM dbo.Users AS u",
                expected: ["UserId", "DisplayName", "IsActive"],
            },
            {
                name: "join source columns",
                sql: "SELECT * FROM dbo.Users AS u JOIN dbo.Orders AS o ON o.|",
                expected: ["OrderId", "UserId", "Total"],
            },
            {
                name: "CTE relation names",
                sql: "WITH recent AS (SELECT UserId FROM dbo.Users) SELECT * FROM rec|",
                expected: ["recent"],
            },
            {
                name: "GROUP BY columns",
                sql: "SELECT UserId, COUNT(*) FROM dbo.Orders GROUP BY |",
                expected: ["OrderId", "UserId", "Total"],
            },
            {
                name: "built-in functions",
                sql: "SELECT COA|",
                expected: ["coalesce"],
            },
            {
                name: "aliases in later batches",
                sql: "SELECT UserId FROM dbo.Users; SELECT o.| FROM dbo.Orders AS o",
                expected: ["OrderId", "UserId", "Total"],
            },
        ];

        for (const scenario of scenarios) {
            /** Verifies the package engine produces the expected candidates for each context. */
            test(`completes ${scenario.name}`, () => {
                const { sql, offset } = caret(scenario.sql);
                const labels = createSession(sql)
                    .completeAt(offset)
                    .map((completion) => completion.label);

                expect(labels).to.include.members(scenario.expected);
            });
        }

        /** Verifies the grammar offers valid continuations while an INSERT target list is open. */
        test("offers grammar completions in INSERT column lists", () => {
            const { sql, offset } = caret("INSERT INTO dbo.Users (|");
            const labels = createSession(sql)
                .completeAt(offset)
                .map((completion) => completion.label);

            expect(labels).to.include.members(["VALUES", "SELECT"]);
        });
    });

    /** Verifies the parser classifies and validates the common data-modification statements. */
    test("parses common INSERT, UPDATE, and DELETE statements", () => {
        const statements = [
            "INSERT INTO dbo.Users (UserId, IsActive) VALUES (1, 1)",
            "UPDATE dbo.Users SET IsActive = 0 WHERE UserId = 1",
            "DELETE FROM dbo.Users WHERE UserId = 1",
        ];

        for (const sql of statements) {
            const session = createSession(sql);
            expect(session.doc.statements[0]?.category).to.equal("dml");
            expect(session.diagnostics()).to.be.empty;
        }
    });

    suite("SqlParser parity scenarios", () => {
        const scenarios = [
            {
                name: "MERGE with matched and unmatched branches",
                sql:
                    "MERGE dbo.Users AS target USING dbo.Orders AS source " +
                    "ON target.UserId = source.UserId " +
                    "WHEN MATCHED THEN UPDATE SET IsActive = 1 " +
                    "WHEN NOT MATCHED THEN INSERT (UserId, IsActive) VALUES (source.UserId, 1);",
            },
            {
                name: "UPDATE with a joined FROM clause",
                sql:
                    "UPDATE users SET IsActive = 0 FROM dbo.Users AS users " +
                    "JOIN dbo.Orders AS orders ON users.UserId = orders.UserId " +
                    "WHERE orders.Total = 0",
            },
            {
                name: "DELETE with a joined source",
                sql:
                    "DELETE users FROM dbo.Users AS users JOIN dbo.Orders AS orders " +
                    "ON users.UserId = orders.UserId WHERE orders.Total = 0",
            },
            {
                name: "DML OUTPUT pseudo tables",
                sql:
                    "UPDATE dbo.Users SET IsActive = 0 OUTPUT inserted.UserId " +
                    "WHERE UserId = 1",
            },
            {
                name: "PIVOT over a derived relation",
                sql:
                    "SELECT * FROM (SELECT UserId, Total FROM dbo.Orders) AS source " +
                    "PIVOT (SUM(Total) FOR UserId IN ([1], [2])) AS pivoted",
            },
            {
                name: "correlated CROSS APPLY",
                sql:
                    "SELECT users.UserId FROM dbo.Users AS users CROSS APPLY " +
                    "(SELECT TOP 1 * FROM dbo.Orders AS orders " +
                    "WHERE orders.UserId = users.UserId) AS latest",
            },
            {
                name: "GO-separated batches",
                sql: "SELECT UserId FROM dbo.Users\nGO\n" + "SELECT OrderId FROM dbo.Orders",
            },
            {
                name: "named WINDOW clauses",
                sql:
                    "SELECT SUM(Total) OVER totals FROM dbo.Orders " +
                    "WINDOW totals AS (PARTITION BY UserId)",
            },
        ];

        for (const scenario of scenarios) {
            /** Verifies representative Microsoft SqlParser grammar scenarios remain error-free. */
            test(`parses ${scenario.name}`, () => {
                const session = createSession(scenario.sql);

                expect(session.syntaxDiagnostics).to.be.empty;
                expect(session.diagnostics()).to.be.empty;
            });
        }
    });

    suite("common query analysis", () => {
        const scenarios = [
            {
                name: "UNION ALL set operations",
                sql: "SELECT UserId FROM dbo.Users UNION ALL SELECT UserId FROM dbo.Orders",
            },
            {
                name: "CASE expressions",
                sql: "SELECT CASE WHEN IsActive = 1 THEN DisplayName ELSE N'inactive' END AS Status FROM dbo.Users",
            },
            {
                name: "window functions",
                sql: "SELECT UserId, ROW_NUMBER() OVER (ORDER BY OrderDate) AS RowNumber FROM dbo.Orders",
            },
            {
                name: "GROUP BY, HAVING, and ORDER BY",
                sql: "SELECT UserId, COUNT(*) FROM dbo.Orders GROUP BY UserId HAVING COUNT(*) > 1 ORDER BY UserId",
            },
            {
                name: "correlated EXISTS subqueries",
                sql: "SELECT u.UserId FROM dbo.Users AS u WHERE EXISTS (SELECT 1 FROM dbo.Orders AS o WHERE o.UserId = u.UserId)",
            },
            {
                name: "variables across statement batches",
                sql: "DECLARE @MinTotal decimal(10,2) = 10; SELECT OrderId FROM dbo.Orders WHERE Total > @MinTotal",
            },
        ];

        for (const scenario of scenarios) {
            /** Verifies each representative query shape binds without syntax or semantic errors. */
            test(`analyzes ${scenario.name}`, () => {
                const session = createSession(scenario.sql);

                expect(session.syntaxDiagnostics).to.be.empty;
                expect(session.diagnostics()).to.be.empty;
            });
        }

        for (const sql of [
            "DECLARE @t TABLE(id INT) SELECT * FROM @t",
            "DECLARE @t TABLE(id INT, id2 char(5)) SELECT * FROM @t",
            "DECLARE @t TABLE(id INT) SELECT * FROM @t AS t",
        ]) {
            /** Verifies table variables bind consistently across legacy query shapes. */
            test(`binds the legacy table-variable scenario: ${sql}`, () => {
                expect(createSession(sql).diagnostics()).to.be.empty;
            });
        }

        /** Verifies SELECT INTO temp tables remain visible to later statements. */
        test("binds a SELECT INTO temp table in a later statement", () => {
            const sql =
                "SELECT * INTO #ActiveUsers FROM dbo.Users WHERE IsActive = 1; " +
                "SELECT * FROM #ActiveUsers";
            const diagnostics = createSession(sql).diagnostics();

            expect(diagnostics).to.be.empty;
        });
    });

    suite("diagnostics", () => {
        /** Verifies the parser locates a missing expression at the incomplete clause boundary. */
        test("reports T-SQL syntax diagnostics for an incomplete clause", () => {
            const session = createSession("SELECT UserId FROM dbo.Users WHERE");

            expect(session.syntaxDiagnostics).to.not.be.empty;
            expect(session.syntaxDiagnostics[0].message).to.equal("Expected expression");
            expect(session.syntaxDiagnostics[0].span.start).to.equal(
                "SELECT UserId FROM dbo.Users WHERE".length,
            );
        });

        /** Verifies schema binding reports the exact unknown projected column. */
        test("reports semantic diagnostics for an unknown column", () => {
            const sql = "SELECT MissingColumn FROM dbo.Users";
            const session = createSession(sql);
            const diagnostics = session.diagnostics();

            expect(diagnostics).to.have.lengthOf(1);
            expect(diagnostics[0]).to.deep.include({
                kind: "semantic",
                code: "unknown-column",
                message: "Invalid column name 'MissingColumn'.",
                span: { start: 7, end: 20 },
                severity: "error",
            });
        });

        /** Verifies closed-world schema analysis reports missing relation names. */
        test("reports an unknown table", () => {
            const diagnostics = createSession("SELECT * FROM dbo.DoesNotExist").diagnostics();

            expect(diagnostics).to.deep.include({
                kind: "semantic",
                code: "MSSQL208",
                message: "Invalid object name 'dbo.DoesNotExist'.",
                span: { start: 14, end: 30 },
                severity: "error",
            });
        });

        /** Verifies unqualified duplicate column names are diagnosed as ambiguous. */
        test("reports ambiguous columns across joins", () => {
            const sql =
                "SELECT UserId FROM dbo.Users AS u JOIN dbo.Orders AS o ON u.UserId = o.UserId";
            const diagnostics = createSession(sql).diagnostics();

            expect(diagnostics).to.deep.include({
                kind: "semantic",
                code: "ambiguous-column",
                message: "Ambiguous column name 'UserId'.",
                span: { start: 7, end: 13 },
                severity: "error",
            });
        });

        const invalidPredicateScenarios = [
            "MissingColumn = 1",
            "MissingAlias.FirstName = N'Ada'",
            "MissingSchema.vEmployee.FirstName = N'Ada'",
            "MissingDatabase.HumanResources.vEmployee.FirstName = N'Ada'",
            "MissingColumn LIKE N'A%'",
            "MissingColumn NOT LIKE N'A%'",
            "MissingColumn IN (N'Ada')",
            "MissingColumn NOT IN (N'Ada')",
            "MissingColumn BETWEEN 1 AND 2",
            "MissingColumn NOT BETWEEN 1 AND 2",
            "MissingColumn IS NULL",
            "MissingColumn IS NOT NULL",
            "EXISTS (SELECT 1 WHERE MissingColumn = 1)",
            "NOT EXISTS (SELECT 1 WHERE MissingColumn = 1)",
        ];

        for (const predicate of invalidPredicateScenarios) {
            /** Verifies each legacy invalid predicate still produces an unknown-column diagnostic. */
            test(`ports the legacy invalid-object predicate: ${predicate}`, () => {
                const diagnostics = createSession(
                    `SELECT * FROM HumanResources.vEmployee AS Emp WHERE ${predicate}`,
                ).diagnostics();

                expect(
                    diagnostics.some((diagnostic) =>
                        diagnostic.code.toLowerCase().includes("unknown-column"),
                    ),
                ).to.be.true;
            });
        }
    });

    /** Verifies aliases, join sources, and qualified columns bind to their schema definitions. */
    test("resolves table aliases and join columns against the supplied schema", () => {
        const sql =
            "SELECT u.UserId, o.Total FROM dbo.Users AS u INNER JOIN dbo.Orders AS o ON o.UserId = u.UserId";
        const session = createSession(sql);
        const symbols = session.deriveSymbols();

        expect(findSymbol(symbols, "table", "dbo.Users").modifiers).to.deep.equal(["reference"]);
        expect(findSymbol(symbols, "alias", "u").modifiers).to.deep.equal(["declaration"]);
        expect(findSymbol(symbols, "table", "dbo.Orders").modifiers).to.deep.equal(["reference"]);
        expect(findSymbol(symbols, "alias", "o").modifiers).to.deep.equal(["declaration"]);
        expect(findSymbol(symbols, "column", "u.UserId").type).to.deep.equal(scalar("int"));
        expect(findSymbol(symbols, "column", "o.Total").type).to.deep.equal(
            scalar("decimal(10,2)"),
        );
        expect(session.diagnostics()).to.be.empty;
    });

    /** Verifies CTE declarations connect to relation and projected-column references. */
    test("resolves CTE declarations, references, and projected column definitions", () => {
        const sql =
            "WITH Recent AS (SELECT UserId, DisplayName FROM dbo.Users WHERE IsActive = 1) " +
            "SELECT r.UserId FROM Recent AS r";
        const session = createSession(sql);
        const symbols = session.deriveSymbols();
        const cteReferenceOffset = sql.lastIndexOf("Recent");
        const references = session.referencesAt(cteReferenceOffset);

        expect(findSymbol(symbols, "cte", "Recent", "declaration").modifiers).to.deep.equal([
            "declaration",
        ]);
        expect(findSymbol(symbols, "cte", "Recent", "reference").definition).to.deep.equal(
            spanOf(sql, 5, 11),
        );
        expect(findSymbol(symbols, "alias", "r").modifiers).to.deep.equal(["declaration"]);
        expect(references).to.not.be.null;
        expect(references).to.deep.include({
            symbol: "Recent",
            kind: "cte",
            declaration: spanOf(sql, 5, 11),
        });
        expect(references?.occurrences).to.have.length.greaterThan(1);
        expect(session.diagnostics()).to.be.empty;
    });

    /** Verifies projected subquery columns retain navigation targets through their alias. */
    test("resolves subquery aliases and definitions for projected columns", () => {
        const sql = "SELECT x.DisplayName FROM (SELECT DisplayName FROM dbo.Users) AS x";
        const session = createSession(sql);
        const displayNameReference = session
            .deriveSymbols()
            .find((symbol) => symbol.name === "x.DisplayName");

        expect(displayNameReference).to.not.be.undefined;
        expect(displayNameReference?.definition).to.deep.equal(spanOf(sql, 34, 45));
        expect(session.referencesAt(sql.indexOf("x.DisplayName") + 2)).to.deep.include({
            symbol: "DisplayName",
            kind: "column",
            declaration: spanOf(sql, 34, 45),
        });
        expect(session.diagnostics()).to.be.empty;
    });

    /** Verifies built-in functions expose symbols, inferred types, and parameter signatures. */
    test("infers built-in function symbols, signatures, and hover-relevant types", () => {
        const sql =
            "SELECT COUNT(*) AS Total, COALESCE(DisplayName, 'unknown') AS Name FROM dbo.Users";
        const session = createSession(sql);
        const symbols = session.deriveSymbols();
        const count = symbols.find((symbol) => symbol.name === "COUNT");
        const coalesce = symbols.find((symbol) => symbol.name === "COALESCE");
        const nameType = session.typeAt(sql.indexOf("DisplayName"));
        const signature = session.signatureAt(sql.indexOf("COALESCE") + "COALESCE(".length);

        expect(count).to.deep.include({
            kind: "function",
            modifiers: ["reference", "aggregate"],
            type: scalar("int"),
        });
        expect(coalesce).to.deep.include({
            kind: "function",
            modifiers: ["reference"],
            type: scalar("nvarchar"),
        });
        expect(formatType(nameType)).to.equal("nvarchar");
        expect(signature).to.deep.equal({
            signatures: [
                {
                    label: "COALESCE(expression, ...)",
                    parameters: [{ label: "expression" }, { label: "expression" }],
                },
            ],
            activeSignature: 0,
            activeParameter: 0,
        });
    });

    /** Verifies hover-facing symbols carry both their source relation and scalar type. */
    test("exposes hover symbols with schema-derived types and source names", () => {
        const sql = "SELECT u.UserId, u.DisplayName FROM dbo.Users AS u";
        const session = createSession(sql);
        const symbols = session.deriveSymbols();
        const userId = symbols.find(
            (symbol) => symbol.kind === "column" && symbol.name === "u.UserId",
        );
        const displayName = symbols.find(
            (symbol) => symbol.kind === "column" && symbol.name === "u.DisplayName",
        );

        expect(userId?.type).to.deep.equal(scalar("int"));
        expect(userId?.source?.name).to.equal("dbo.Users");
        expect(displayName?.type).to.deep.equal(scalar("nvarchar"));
        expect(session.typeAt(sql.indexOf("u.DisplayName"))).to.deep.equal(scalar("nvarchar"));
    });

    function createSession(text: string): SqlSession {
        return SqlSession.create(text, {
            schema,
            uri: "file:///beta-sql-language-service-scenarios.sql",
        });
    }
});

function scalar(name: string): Type {
    return { kind: "scalar", name, display: name };
}

function findSymbol(
    symbols: readonly Sym[],
    kind: Sym["kind"],
    name: string,
    modifier?: Sym["modifiers"][number],
): Sym {
    const symbol = symbols
        .filter(
            (candidate) =>
                candidate.kind === kind &&
                candidate.name === name &&
                (!modifier || candidate.modifiers.includes(modifier)),
        )
        .sort(
            (left, right) =>
                Number(right.modifiers.includes("declaration")) -
                Number(left.modifiers.includes("declaration")),
        )[0];
    expect(symbol, `Expected ${kind} symbol ${name}`).to.not.be.undefined;
    return symbol!;
}

function spanOf(text: string, start: number, end: number): Sym["span"] {
    return {
        start,
        end,
    };
}

function caret(markedSql: string): { sql: string; offset: number } {
    const offset = markedSql.indexOf("|");
    expect(offset, "Scenario SQL must contain a caret marker").to.be.greaterThanOrEqual(0);
    return { sql: markedSql.replace("|", ""), offset };
}
