/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * B10 / LS-2 native diagnostics suite: T1 lexical/structural errors, T2
 * binder 207/208/209-style warnings, and the design 05 §17.4 HONESTY SUITE —
 * scripts that must produce ZERO diagnostics unless explicitly expected,
 * with every §11.2 suppression counted by reason (never identifier text).
 */

import { expect } from "chai";
import { DiagnosticsResult, SqlDiagnostic } from "../../src/sqlLanguage/api";
import { NATIVE_DIAGNOSTIC_SOURCE } from "../../src/sqlLanguage/features/diagnostics";
import { NativeSqlLanguageEngine } from "../../src/sqlLanguage/host/nativeEngine";
import { FixtureLanguageMetadataProvider } from "../../src/sqlLanguage/provider/fixtureProvider";
import { NullLanguageMetadataProvider } from "../../src/sqlLanguage/provider/nullProvider";
import { STANDARD_FIXTURE_CATALOG } from "../../src/sqlLanguage/testSupport/fixtureCatalog";
import { ISqlLanguageMetadataProvider } from "../../src/sqlLanguage/provider/types";

const standardProvider = new FixtureLanguageMetadataProvider(STANDARD_FIXTURE_CATALOG);
const nullProvider = new NullLanguageMetadataProvider();

async function diagnose(
    text: string,
    provider: ISqlLanguageMetadataProvider = standardProvider,
): Promise<DiagnosticsResult> {
    const engine = new NativeSqlLanguageEngine(provider);
    const result = await engine.diagnostics({ text, version: 1 });
    expect(result).to.not.equal(undefined);
    return result!;
}

function codes(result: DiagnosticsResult): (string | undefined)[] {
    return result.diagnostics.map((d) => d.code);
}

function only(result: DiagnosticsResult): SqlDiagnostic {
    expect(result.diagnostics).to.have.length(1);
    return result.diagnostics[0];
}

function expectClean(result: DiagnosticsResult): void {
    expect(
        result.diagnostics,
        `unexpected diagnostics: ${result.diagnostics.map((d) => `${d.code ?? "?"} ${d.message}`).join(" | ")}`,
    ).to.have.length(0);
}

// ---------------------------------------------------------------------------
// T1 — lexical
// ---------------------------------------------------------------------------

suite("sqlLanguage diagnostics T1: lexical", () => {
    test("unterminated string literal is an error (105-style)", async () => {
        const d = only(await diagnose("SELECT 'abc", nullProvider));
        expect(d.severity).to.equal("error");
        expect(d.code).to.equal("mssql(105)");
        expect(d.source).to.equal(NATIVE_DIAGNOSTIC_SOURCE);
    });

    test("unterminated N'...' string is an error", async () => {
        const d = only(await diagnose("SELECT N'abc", nullProvider));
        expect(d.code).to.equal("mssql(105)");
    });

    test("unterminated block comment is an error (113-style)", async () => {
        const d = only(await diagnose("SELECT 1 /* never closed", nullProvider));
        expect(d.severity).to.equal("error");
        expect(d.code).to.equal("mssql(113)");
    });

    test("unterminated NESTED block comment is an error", async () => {
        const d = only(await diagnose("/* outer /* inner */ still open", nullProvider));
        expect(d.code).to.equal("mssql(113)");
    });

    test("unterminated bracketed identifier is an error", async () => {
        const d = only(await diagnose("SELECT [abc", nullProvider));
        expect(d.severity).to.equal("error");
        expect(d.message).to.contain("]");
    });

    test("unterminated quoted identifier is an error", async () => {
        const d = only(await diagnose('SELECT "abc', nullProvider));
        expect(d.severity).to.equal("error");
    });

    test("terminated strings, comments and identifiers are clean", async () => {
        expectClean(
            await diagnose(
                "SELECT 'it''s', N'x', [a]], b], \"q\"\"q\" /* c /* n */ ok */ -- tail",
                nullProvider,
            ),
        );
    });

    test("multi-line string is clean", async () => {
        expectClean(await diagnose("SELECT 'line1\nline2'", nullProvider));
    });
});

suite("sqlLanguage diagnostics T1: GO lines", () => {
    test("GO with trailing junk after a statement is an error", async () => {
        const result = await diagnose("SELECT 1\nGO abc", nullProvider);
        const d = only(result);
        expect(d.severity).to.equal("error");
        expect(d.message).to.contain("'GO'");
    });

    test("GO junk at document start is an error", async () => {
        const d = only(await diagnose("GO abc\nSELECT 1", nullProvider));
        expect(d.severity).to.equal("error");
    });

    test("GO with a count and junk is an error", async () => {
        const d = only(await diagnose("SELECT 1\nGO 5 x", nullProvider));
        expect(d.severity).to.equal("error");
    });

    test("valid GO, GO n and GO with comment are clean", async () => {
        expectClean(
            await diagnose("SELECT 1\nGO\nSELECT 2\nGO 5\nSELECT 3\nGO -- done", nullProvider),
        );
    });

    test("go as a column at line start in an expression is NOT flagged", async () => {
        expectClean(await diagnose("SELECT OrderID FROM Sales.Orders WHERE\ngo = 1"));
    });

    test("go as a name after a reserved keyword is NOT flagged", async () => {
        expectClean(await diagnose("SELECT c FROM\ngo x", nullProvider));
    });

    test("go after a comma is NOT flagged", async () => {
        expectClean(await diagnose("SELECT a,\ngo, b FROM t", nullProvider));
    });
});

suite("sqlLanguage diagnostics T1: structure", () => {
    test("unmatched closing parenthesis is an error (102-style)", async () => {
        const d = only(await diagnose("SELECT (1 + 2))", nullProvider));
        expect(d.severity).to.equal("error");
        expect(d.code).to.equal("mssql(102)");
    });

    test("unclosed parenthesis with a following statement is an error", async () => {
        const result = await diagnose("SELECT (1\nGO\nSELECT 2", nullProvider);
        const d = only(result);
        expect(d.code).to.equal("mssql(102)");
    });

    test("unclosed parenthesis terminated by semicolon is an error", async () => {
        const d = only(await diagnose("SELECT (1;", nullProvider));
        expect(d.code).to.equal("mssql(102)");
    });

    test("trailing unclosed parenthesis at end of document is MID-EDIT — clean", async () => {
        expectClean(await diagnose("SELECT (1", nullProvider));
    });

    test("balanced nesting is clean", async () => {
        expectClean(await diagnose("SELECT ((1) + (2 * (3)))", nullProvider));
    });

    test("duplicate correlation name is an error (1011-style)", async () => {
        const result = await diagnose(
            "SELECT * FROM Sales.Orders o JOIN Sales.Customers o ON 1 = 1",
        );
        expect(codes(result)).to.include("mssql(1011)");
    });

    test("duplicate exposed name without aliases is an error (1013-style)", async () => {
        const result = await diagnose("SELECT * FROM Sales.Orders, Sales.Orders");
        expect(codes(result)).to.include("mssql(1013)");
    });

    test("same table twice with distinct aliases is clean", async () => {
        expectClean(
            await diagnose(
                "SELECT * FROM Sales.Orders a JOIN Sales.Orders b ON a.OrderID = b.OrderID",
            ),
        );
    });

    test("same table in different UNION branches is clean", async () => {
        expectClean(
            await diagnose(
                "SELECT OrderID FROM Sales.Orders UNION ALL SELECT OrderID FROM Sales.Orders",
            ),
        );
    });

    test("same alias in independent subqueries is clean", async () => {
        expectClean(
            await diagnose(
                "SELECT (SELECT MAX(x.OrderID) FROM Sales.Orders x), (SELECT MIN(x.OrderID) FROM Sales.Orders x)",
            ),
        );
    });
});

// ---------------------------------------------------------------------------
// T1 — unrecognized statement head (flag ONLY on body betrayal; a bare
// unknown identifier may be an EXEC-less proc call and must stay silent)
// ---------------------------------------------------------------------------

suite("sqlLanguage diagnostics T1: unrecognized statement", () => {
    test("split statement keyword with a betraying FROM is an error (SEL ECT)", async () => {
        const d = only(await diagnose("sel ect * from x", nullProvider));
        expect(d.severity).to.equal("error");
        expect(d.code).to.equal("mssql(102)");
        expect(d.message).to.contain("'sel'");
        expect(d.message).to.contain("did you mean SELECT?");
        // The squiggle covers the split pair "sel ect", not just the head.
        expect(d.range.start.character).to.equal(0);
        expect(d.range.end.character).to.equal(7);
    });

    test("split INSERT with INTO/VALUES gets the INSERT suggestion", async () => {
        const d = only(await diagnose("ins ert into t values (1)", nullProvider));
        expect(d.code).to.equal("mssql(102)");
        expect(d.message).to.contain("did you mean INSERT?");
    });

    test("one-edit-away head gets a did-you-mean; squiggle is the head only", async () => {
        const d = only(await diagnose("slect * from x", nullProvider));
        expect(d.severity).to.equal("error");
        expect(d.message).to.contain("did you mean SELECT?");
        expect(d.range.end.character).to.equal(5);
    });

    test("unknown head with a top-level clause word but no near keyword — no suggestion", async () => {
        const d = only(await diagnose("frobnicate x from y", nullProvider));
        expect(d.severity).to.equal("error");
        expect(d.message).to.not.contain("did you mean");
    });

    test("bare procedure invocation stays silent (EXEC-less first statement)", async () => {
        expectClean(await diagnose("myproc @a = 1", nullProvider));
    });

    test("known catalog procedure invocation stays silent when metadata is ready", async () => {
        expectClean(await diagnose("Sales.GetOrders @CustomerID = 1"));
    });

    test("bare proc call with identifier args stays silent (sp_help style)", async () => {
        expectClean(await diagnose("sp_help Orders", nullProvider));
    });

    test("system proc-shaped call stays silent even with user-object metadata ready", async () => {
        expectClean(await diagnose("sp_help Orders"));
    });

    test("EXEC call stays silent", async () => {
        expectClean(await diagnose("EXEC myproc", nullProvider));
    });

    test("lone unknown head stays silent (possible proc call / mid-edit)", async () => {
        expectClean(await diagnose("sel", nullProvider));
    });

    test("connected lone statement typo gets a syntax suggestion", async () => {
        const d = only(await diagnose("sel"));
        expect(d.code).to.equal("mssql(102)");
        expect(d.message).to.contain("did you mean SELECT?");
    });

    test("connected unknown bare command reports a missing stored procedure", async () => {
        const d = only(await diagnose("scasdf"));
        expect(d.code).to.equal("mssql(2812)");
        expect(d.message).to.contain("Could not find stored procedure 'scasdf'.");
    });

    test("unknown head as the last statement without body keywords stays silent", async () => {
        expectClean(await diagnose("SELECT 1;\nsel", nullProvider));
    });

    test("WITH-led CTE statement stays silent", async () => {
        expectClean(await diagnose("WITH x AS (SELECT 1 AS a) SELECT a FROM x", nullProvider));
    });

    test("unmodeled keyword-led statements stay silent", async () => {
        expectClean(await diagnose("TRUNCATE TABLE dbo.T1", nullProvider));
    });
});

suite("sqlLanguage diagnostics T1: SELECT syntax recovery", () => {
    test("split FROM inside SELECT is an error", async () => {
        const result = await diagnose("select * fr om Sales.Orders");
        const d = only(result);

        expect(d.severity).to.equal("error");
        expect(d.code).to.equal("mssql(102)");
        expect(d.message).to.contain("did you mean FROM?");
        expect(d.range.start.character).to.equal(9);
        expect(d.range.end.character).to.equal(14);
        expect(result.suppressed.syntaxUntrusted).to.equal(1);
    });

    test("split WHERE inside SELECT is an error", async () => {
        const result = await diagnose("select * from Sales.Orders wh ere OrderID = 1");
        const d = only(result);

        expect(d.code).to.equal("mssql(102)");
        expect(d.message).to.contain("did you mean WHERE?");
        expect(result.suppressed.syntaxUntrusted).to.equal(1);
    });

    test("ORDER without BY is an error when the next token exists", async () => {
        const result = await diagnose("select * from Sales.Orders order OrderID");
        const d = only(result);

        expect(d.code).to.equal("mssql(102)");
        expect(d.message).to.contain("Expected BY after ORDER.");
        expect(result.suppressed.syntaxUntrusted).to.equal(1);
    });

    test("top-level split clause text stays silent as possible proc text", async () => {
        expectClean(await diagnose("fr om", nullProvider));
    });

    test("EXEC-less procedure protections still stay silent", async () => {
        expectClean(await diagnose("sp_help Orders", nullProvider));
        expectClean(await diagnose("Sales.GetOrders @CustomerID = 1"));
    });
});

// ---------------------------------------------------------------------------
// T2 — 208-style invalid object
// ---------------------------------------------------------------------------

suite("sqlLanguage diagnostics T2: invalid object (208)", () => {
    test("unknown schema-qualified table warns 208", async () => {
        const d = only(await diagnose("SELECT * FROM Sales.Missing"));
        expect(d.severity).to.equal("warning");
        expect(d.code).to.equal("mssql(208)");
        expect(d.message).to.contain("Sales.Missing");
        expect(d.source).to.equal(NATIVE_DIAGNOSTIC_SOURCE);
    });

    test("unknown one-part table warns 208", async () => {
        const d = only(await diagnose("SELECT * FROM Nowhere"));
        expect(d.code).to.equal("mssql(208)");
    });

    test("known tables, views and synonyms are clean", async () => {
        expectClean(
            await diagnose(
                "SELECT * FROM Sales.Orders; SELECT * FROM Sales.vOrderSummary; SELECT * FROM dbo.OrdersSynonym",
            ),
        );
    });

    test("current-database three-part name resolves clean", async () => {
        expectClean(await diagnose("SELECT OrderID FROM FixtureDb.Sales.Orders"));
    });

    test("INSERT into unknown table warns 208", async () => {
        const d = only(await diagnose("INSERT INTO Sales.Missing (a) VALUES (1)"));
        expect(d.code).to.equal("mssql(208)");
    });

    test("UPDATE of unknown table warns 208", async () => {
        const d = only(await diagnose("UPDATE Sales.Missing SET a = 1"));
        expect(d.code).to.equal("mssql(208)");
    });

    test("DELETE from unknown table warns 208", async () => {
        const d = only(await diagnose("DELETE FROM Sales.Missing"));
        expect(d.code).to.equal("mssql(208)");
    });

    test("alias-form UPDATE target is clean", async () => {
        expectClean(
            await diagnose("UPDATE o SET Comments = NULL FROM Sales.Orders o WHERE o.OrderID = 1"),
        );
    });

    test("unknown TVF source never warns (system TVF honesty)", async () => {
        const result = await diagnose("SELECT * FROM STRING_SPLIT('a,b', ',')");
        expectClean(result);
        expect(result.suppressed?.opaqueSource).to.be.at.least(1);
    });

    test("resolved TVF source is clean", async () => {
        expectClean(await diagnose("SELECT OrderID FROM dbo.OrdersByCustomer(1)"));
    });
});

// ---------------------------------------------------------------------------
// T2 — 207/209-style column diagnostics
// ---------------------------------------------------------------------------

suite("sqlLanguage diagnostics T2: invalid column (207)", () => {
    test("qualified unknown column warns 207", async () => {
        const d = only(await diagnose("SELECT o.Missing FROM Sales.Orders o"));
        expect(d.severity).to.equal("warning");
        expect(d.code).to.equal("mssql(207)");
        expect(d.message).to.contain("Missing");
    });

    test("qualified known column is clean", async () => {
        expectClean(await diagnose("SELECT o.OrderID, o.Comments FROM Sales.Orders o"));
    });

    test("unqualified unknown column warns 207", async () => {
        const d = only(await diagnose("SELECT Missing FROM Sales.Orders"));
        expect(d.code).to.equal("mssql(207)");
    });

    test("unqualified known columns across clauses are clean", async () => {
        expectClean(
            await diagnose(
                "SELECT OrderID FROM Sales.Orders WHERE CustomerID = 1 GROUP BY OrderID HAVING COUNT(*) > 1 ORDER BY OrderID",
            ),
        );
    });

    test("bracketed alias and column are clean", async () => {
        expectClean(await diagnose("SELECT [o].[Comments] FROM Sales.Orders [o]"));
    });

    test("WHERE clause unknown column warns 207", async () => {
        const d = only(await diagnose("SELECT OrderID FROM Sales.Orders WHERE Nope = 1"));
        expect(d.code).to.equal("mssql(207)");
    });

    test("JOIN ON unknown qualified column warns 207", async () => {
        const d = only(
            await diagnose(
                "SELECT o.OrderID FROM Sales.Orders o JOIN Sales.Customers c ON o.CustomerID = c.Nope",
            ),
        );
        expect(d.code).to.equal("mssql(207)");
    });

    test("ORDER BY select alias is clean; unknown name warns", async () => {
        expectClean(await diagnose("SELECT OrderID AS ord FROM Sales.Orders ORDER BY ord"));
        const d = only(await diagnose("SELECT OrderID FROM Sales.Orders ORDER BY nope"));
        expect(d.code).to.equal("mssql(207)");
    });

    test("UPDATE SET of unknown target column warns 207", async () => {
        const d = only(await diagnose("UPDATE Sales.Orders SET Missing = 1"));
        expect(d.code).to.equal("mssql(207)");
    });

    test("UPDATE SET of known target column is clean", async () => {
        expectClean(await diagnose("UPDATE Sales.Orders SET Comments = NULL WHERE OrderID = 1"));
    });

    test("DELETE WHERE resolves against the target's columns", async () => {
        expectClean(await diagnose("DELETE FROM Sales.Orders WHERE OrderID = 1"));
        const d = only(await diagnose("DELETE FROM Sales.Orders WHERE Nope = 1"));
        expect(d.code).to.equal("mssql(207)");
    });

    test("INSERT column list checks against the target", async () => {
        const d = only(await diagnose("INSERT INTO Sales.Orders (OrderID, Nope) VALUES (1, 2)"));
        expect(d.code).to.equal("mssql(207)");
        expect(d.message).to.contain("Nope");
        expectClean(
            await diagnose(
                "INSERT INTO Sales.Orders (OrderID, CustomerID, OrderDate) VALUES (1, 2, '2026-01-01')",
            ),
        );
    });

    test("derived table with nameable shape checks members", async () => {
        expectClean(await diagnose("SELECT d.OrderID FROM (SELECT OrderID FROM Sales.Orders) d"));
        const d = only(await diagnose("SELECT d.Nope FROM (SELECT OrderID FROM Sales.Orders) d"));
        expect(d.code).to.equal("mssql(207)");
    });

    test("declared temp table shape is trusted", async () => {
        expectClean(await diagnose("CREATE TABLE #t (a int, b int)\nSELECT a, b FROM #t"));
        const d = only(await diagnose("CREATE TABLE #t (a int)\nSELECT b FROM #t"));
        expect(d.code).to.equal("mssql(207)");
    });

    test("declared table variable shape is trusted", async () => {
        expectClean(await diagnose("DECLARE @t TABLE (id int)\nSELECT id FROM @t"));
        const d = only(await diagnose("DECLARE @t TABLE (id int)\nSELECT nope FROM @t"));
        expect(d.code).to.equal("mssql(207)");
    });

    test("CTE with declared column list is trusted", async () => {
        expectClean(
            await diagnose(
                "WITH c (a, b) AS (SELECT OrderID, CustomerID FROM Sales.Orders) SELECT a, b FROM c",
            ),
        );
        const d = only(
            await diagnose("WITH c (a) AS (SELECT OrderID FROM Sales.Orders) SELECT nope FROM c"),
        );
        expect(d.code).to.equal("mssql(207)");
    });
});

suite("sqlLanguage diagnostics T2: ambiguous column (209)", () => {
    test("column present in two joined sources warns 209", async () => {
        const d = only(
            await diagnose(
                "SELECT CustomerID FROM Sales.Orders o JOIN Sales.Customers c ON o.CustomerID = c.CustomerID",
            ),
        );
        expect(d.severity).to.equal("warning");
        expect(d.code).to.equal("mssql(209)");
        expect(d.message).to.contain("CustomerID");
    });

    test("qualification resolves the ambiguity", async () => {
        expectClean(
            await diagnose(
                "SELECT o.CustomerID FROM Sales.Orders o JOIN Sales.Customers c ON o.CustomerID = c.CustomerID",
            ),
        );
    });

    test("correlated subquery resolves INNER scope first — no false 209", async () => {
        expectClean(
            await diagnose(
                "SELECT o.OrderID FROM Sales.Orders o WHERE EXISTS (SELECT OrderID FROM Sales.OrderLines WHERE Quantity > 1)",
            ),
        );
    });

    test("outer reference from a subquery is clean", async () => {
        expectClean(
            await diagnose(
                "SELECT o.OrderID FROM Sales.Orders o WHERE EXISTS (SELECT 1 FROM Sales.OrderLines l WHERE l.OrderID = o.OrderID)",
            ),
        );
    });

    test("UNION branches share a sketch scope — suppressed, never 209", async () => {
        const result = await diagnose(
            "SELECT CustomerID FROM Sales.Orders UNION SELECT CustomerID FROM Sales.Customers",
        );
        expectClean(result);
        expect(result.suppressed?.setOperationScope).to.be.at.least(1);
    });
});

// ---------------------------------------------------------------------------
// §17.4 honesty suite — ZERO diagnostics on the suppression corpus
// ---------------------------------------------------------------------------

interface HonestyCase {
    readonly name: string;
    readonly sql: string;
    readonly provider?: ISqlLanguageMetadataProvider;
    /** Suppression reason expected to be counted (when deterministic). */
    readonly reason?: string;
}

const partialObjectsProvider = new FixtureLanguageMetadataProvider({
    ...STANDARD_FIXTURE_CATALOG,
    readiness: { objects: "partial" },
});
const loadingObjectsProvider = new FixtureLanguageMetadataProvider({
    ...STANDARD_FIXTURE_CATALOG,
    readiness: { objects: "loading", columns: "loading" },
});
const partialColumnsProvider = new FixtureLanguageMetadataProvider({
    ...STANDARD_FIXTURE_CATALOG,
    readiness: { columns: "partial" },
});
const liteModeProvider = new FixtureLanguageMetadataProvider({
    ...STANDARD_FIXTURE_CATALOG,
    readiness: { mode: "lite" },
});
const caseSensitiveProvider = new FixtureLanguageMetadataProvider({
    ...STANDARD_FIXTURE_CATALOG,
    env: { currentDatabase: "FixtureDb", defaultSchema: "dbo", caseSensitive: true },
});
const keywordishProvider = new FixtureLanguageMetadataProvider({
    objects: [
        {
            schema: "dbo",
            name: "Order",
            kind: "table",
            columns: [
                { name: "Group", typeDisplay: "int" },
                { name: "Key", typeDisplay: "int" },
            ],
        },
    ],
    env: { currentDatabase: "FixtureDb", defaultSchema: "dbo", caseSensitive: false },
});

const HONESTY_CASES: readonly HonestyCase[] = [
    // CTEs
    {
        name: "CTE with inferred columns",
        sql: "WITH recent AS (SELECT OrderID FROM Sales.Orders) SELECT OrderID FROM recent",
    },
    {
        name: "CTE with declared columns",
        sql: "WITH c (a, b) AS (SELECT OrderID, CustomerID FROM Sales.Orders) SELECT a FROM c",
    },
    {
        name: "recursive CTE",
        sql: "WITH r AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM r WHERE n < 10) SELECT n FROM r",
    },
    {
        name: "updatable CTE",
        sql: "WITH c AS (SELECT OrderID, Comments FROM Sales.Orders) UPDATE c SET Comments = NULL",
    },
    // Temp tables
    {
        name: "temp table created in the script",
        sql: "CREATE TABLE #t (a int, b int)\nINSERT INTO #t (a, b) VALUES (1, 2)\nSELECT a, b FROM #t",
    },
    {
        name: "temp table NOT visible in the overlay (session may own it)",
        sql: "SELECT anything FROM #sessionTemp",
        reason: "tempTableUnknown",
    },
    {
        name: "global temp table not visible",
        sql: "SELECT x FROM ##shared",
        reason: "tempTableUnknown",
    },
    {
        name: "temp table altered after creation",
        sql: "CREATE TABLE #t (a int)\nALTER TABLE #t ADD b int\nSELECT b FROM #t",
        reason: "unknownOverlayType",
    },
    {
        name: "catalog table altered in-script",
        sql: "ALTER TABLE Sales.Orders ADD NewCol int\nSELECT NewCol FROM Sales.Orders",
        reason: "unknownOverlayType",
    },
    // Table variables
    {
        name: "table variable declared in batch",
        sql: "DECLARE @t TABLE (id int, nm nvarchar(10))\nSELECT id, nm FROM @t",
    },
    {
        name: "table variable not declared (mid-edit)",
        sql: "SELECT x FROM @missing",
        reason: "unknownOverlayType",
    },
    // SELECT INTO
    {
        name: "SELECT INTO temp table then reuse",
        sql: "SELECT OrderID INTO #x FROM Sales.Orders\nSELECT whatever FROM #x",
        reason: "unknownOverlayType",
    },
    {
        name: "SELECT INTO real table then reuse by one-part name",
        sql: "SELECT OrderID INTO dbo.Snapshot1 FROM Sales.Orders\nSELECT anything FROM Snapshot1",
        reason: "unknownOverlayType",
    },
    // Dynamic SQL
    {
        name: "EXEC of a string",
        sql: "EXEC('SELECT * FROM NotReal')",
        reason: "dynamicSql",
    },
    {
        name: "sp_executesql",
        sql: "EXEC sp_executesql N'SELECT * FROM NotReal'",
        reason: "dynamicSql",
    },
    // OPENJSON / OPENROWSET
    {
        name: "OPENROWSET source",
        sql: "SELECT * FROM OPENROWSET('SQLNCLI', 'x', 'SELECT 1') AS r",
        reason: "opaqueSource",
    },
    {
        name: "OPENJSON with column access",
        sql: "DECLARE @j nvarchar(max)\nSELECT j.value FROM OPENJSON(@j) j",
    },
    // Synonyms
    {
        name: "synonym columns are never claimed",
        sql: "SELECT anything FROM dbo.OrdersSynonym",
        reason: "opaqueSource",
    },
    // Cross-database / linked server
    {
        name: "cross-database reference not hydrated",
        sql: "SELECT x FROM OtherDb.dbo.Table1",
        reason: "crossDatabaseUnhydrated",
    },
    {
        name: "four-part linked-server reference",
        sql: "SELECT x FROM Server1.OtherDb.dbo.Table1",
        reason: "linkedServer",
    },
    // Lite / partial metadata + mid-hydration
    {
        name: "objects partially hydrated",
        sql: "SELECT * FROM Sales.MissingButUnknowable",
        provider: partialObjectsProvider,
        reason: "providerNotReady",
    },
    {
        name: "objects still loading (mid-hydration)",
        sql: "SELECT Missing FROM Sales.Orders",
        provider: loadingObjectsProvider,
        reason: "providerNotReady",
    },
    {
        name: "columns partially hydrated",
        sql: "SELECT Missing FROM Sales.Orders",
        provider: partialColumnsProvider,
        reason: "columnsNotReady",
    },
    {
        name: "lite metadata mode",
        sql: "SELECT Missing FROM Sales.Orders",
        provider: liteModeProvider,
        reason: "providerNotReady",
    },
    {
        name: "offline (null provider)",
        sql: "SELECT Missing FROM NoCatalog",
        provider: nullProvider,
        reason: "providerNotReady",
    },
    // Keyword-looking identifiers
    {
        name: "bracketed reserved-word table and column",
        sql: "SELECT [Group], [Key] FROM [Order]",
        provider: keywordishProvider,
    },
    {
        name: "system catalog views",
        sql: "SELECT name FROM sys.objects",
        reason: "systemObject",
    },
    {
        name: "INFORMATION_SCHEMA views",
        sql: "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES",
        reason: "systemObject",
    },
    {
        name: "legacy system table",
        sql: "SELECT id FROM sysobjects",
        reason: "systemObject",
    },
    {
        name: "OFFSET / FETCH contextual keywords",
        sql: "SELECT OrderID FROM Sales.Orders ORDER BY OrderID OFFSET 5 ROWS FETCH NEXT 10 ROWS ONLY",
    },
    {
        name: "window function with PARTITION BY",
        sql: "SELECT ROW_NUMBER() OVER (PARTITION BY CustomerID ORDER BY OrderID) AS rn FROM Sales.Orders",
    },
    {
        name: "GROUPING SETS",
        sql: "SELECT CustomerID FROM Sales.Orders GROUP BY GROUPING SETS ((CustomerID), ())",
    },
    {
        name: "ROLLUP / CUBE",
        sql: "SELECT CustomerID FROM Sales.Orders GROUP BY ROLLUP (CustomerID)",
    },
    {
        name: "DATEADD datepart first argument",
        sql: "SELECT DATEADD(day, 1, OrderDate) FROM Sales.Orders",
    },
    {
        name: "DATEDIFF datepart first argument",
        sql: "SELECT DATEDIFF(month, OrderDate, OrderDate) FROM Sales.Orders",
    },
    {
        name: "CONVERT type first argument",
        sql: "SELECT CONVERT(varchar(10), OrderDate) FROM Sales.Orders",
    },
    {
        name: "CAST ... AS type",
        sql: "SELECT CAST(OrderID AS varchar(10)) FROM Sales.Orders",
    },
    {
        name: "NEXT VALUE FOR sequence",
        sql: "SELECT NEXT VALUE FOR dbo.OrderSeq",
    },
    {
        name: "COLLATE clause collation name",
        sql: "SELECT Comments COLLATE Latin1_General_CI_AS FROM Sales.Orders",
    },
    {
        name: "quoted identifier that may be a string",
        sql: 'SELECT "possibly a string" FROM Sales.Orders',
        reason: "quotedIdentifierAmbiguous",
    },
    // Case-sensitive collation
    {
        name: "case-sensitive catalog with exact-case references",
        sql: "SELECT OrderID, CustomerID FROM Sales.Orders WHERE OrderID = 1",
        provider: caseSensitiveProvider,
    },
    // USE switching
    {
        name: "USE another database suppresses claims",
        sql: "USE OtherDb\nGO\nSELECT x FROM UnknownThere",
        reason: "databaseNotHydrated",
    },
    {
        name: "USE back to the hydrated database stays quiet on valid SQL",
        sql: "USE OtherDb\nGO\nUSE FixtureDb\nGO\nSELECT OrderID FROM Sales.Orders",
    },
    // Mid-edit tolerance
    {
        name: "trailing member access dot",
        sql: "SELECT o. FROM Sales.Orders o",
    },
    {
        name: "SELECT list typed before FROM exists",
        sql: "SELECT SomeColumn, OtherColumn",
    },
    {
        name: "dangling FROM",
        sql: "SELECT OrderID FROM ",
    },
    {
        name: "half-written JOIN",
        sql: "SELECT * FROM Sales.Orders o JOIN ",
    },
    // Statement families the binder does not model yet
    {
        name: "MERGE skeleton",
        sql: "MERGE Sales.Orders AS t USING Sales.Customers AS s ON t.CustomerID = s.CustomerID WHEN MATCHED THEN UPDATE SET t.Comments = NULL;",
        reason: "unsupportedSyntax",
    },
    {
        name: "OUTPUT inserted/deleted pseudo-sources",
        sql: "UPDATE Sales.Orders SET Comments = NULL OUTPUT inserted.OrderID WHERE OrderID = 1",
    },
    {
        name: "scalar SET with subquery",
        sql: "DECLARE @m int\nSET @m = (SELECT MAX(OrderID) FROM Sales.Orders)",
    },
    {
        name: "procedural IF EXISTS",
        sql: "IF EXISTS (SELECT 1 FROM Sales.Orders) SELECT OrderID FROM Sales.Orders",
    },
    {
        name: "module body statements bind normally",
        sql: "CREATE PROCEDURE dbo.P1 @id int AS SELECT OrderID FROM Sales.Orders WHERE OrderID = @id",
    },
    {
        name: "VALUES derived source with column alias list",
        sql: "SELECT v.a FROM (VALUES (1), (2)) v(a)",
    },
    {
        name: "table hints",
        sql: "SELECT OrderID FROM Sales.Orders WITH (NOLOCK)",
    },
    {
        name: "star and qualified star",
        sql: "SELECT *, o.* FROM Sales.Orders o",
    },
    {
        name: "FOR XML PATH tail",
        sql: "SELECT OrderID FROM Sales.Orders FOR XML PATH('')",
    },
    {
        name: "variables and system variables in expressions",
        sql: "DECLARE @x int\nSELECT @x, @@ROWCOUNT, OrderID FROM Sales.Orders",
    },
    {
        name: "CASE expression over known columns",
        sql: "SELECT CASE WHEN OrderID > 5 THEN 'big' ELSE 'small' END FROM Sales.Orders",
    },
    {
        name: "aggregates and DISTINCT",
        sql: "SELECT COUNT(*), COUNT(DISTINCT CustomerID) FROM Sales.Orders",
    },
    {
        name: "IN list and BETWEEN",
        sql: "SELECT OrderID FROM Sales.Orders WHERE OrderID IN (1, 2, 3) AND OrderID BETWEEN 1 AND 10",
    },
    {
        name: "PIVOT region is opaque",
        sql: "SELECT * FROM (SELECT CustomerID, OrderID FROM Sales.Orders) s PIVOT (COUNT(OrderID) FOR CustomerID IN ([1], [2])) p",
    },
    {
        name: "sqlcmd directive lines are opaque",
        sql: ":setvar db FixtureDb\nSELECT OrderID FROM Sales.Orders",
    },
];

suite("sqlLanguage diagnostics HONESTY SUITE (§17.4): zero unexpected diagnostics", () => {
    for (const honesty of HONESTY_CASES) {
        test(honesty.name, async () => {
            const result = await diagnose(honesty.sql, honesty.provider ?? standardProvider);
            expectClean(result);
            if (honesty.reason !== undefined) {
                expect(
                    result.suppressed?.[honesty.reason] ?? 0,
                    `expected suppression reason ${honesty.reason} in ${JSON.stringify(result.suppressed)}`,
                ).to.be.at.least(1);
            }
        });
    }
});

// ---------------------------------------------------------------------------
// Suppression accounting + privacy
// ---------------------------------------------------------------------------

suite("sqlLanguage diagnostics suppression accounting", () => {
    test("unresolved qualifier is counted, never guessed", async () => {
        const result = await diagnose("SELECT zz.Whatever FROM Sales.Orders o");
        expectClean(result);
        expect(result.suppressed?.unresolvedQualifier).to.be.at.least(1);
    });

    test("ambiguous object resolution is counted", async () => {
        // "Orders" exists in Sales and dbo; dbo wins as default schema, so
        // force ambiguity via a catalog without a default-schema match.
        const provider = new FixtureLanguageMetadataProvider({
            objects: [
                { schema: "s1", name: "Dup", kind: "table", columns: [] },
                { schema: "s2", name: "Dup", kind: "table", columns: [] },
            ],
            env: { currentDatabase: "FixtureDb", defaultSchema: "dbo", caseSensitive: false },
        });
        const result = await diagnose("SELECT x FROM Dup", provider);
        expectClean(result);
        expect(result.suppressed?.ambiguousName).to.be.at.least(1);
    });

    test("multiple reasons accumulate independently", async () => {
        const result = await diagnose("SELECT a FROM #x\nSELECT b FROM OtherDb.dbo.T\nEXEC('x')");
        expectClean(result);
        expect(result.suppressed?.tempTableUnknown).to.be.at.least(1);
        expect(result.suppressed?.crossDatabaseUnhydrated).to.be.at.least(1);
        expect(result.suppressed?.dynamicSql).to.be.at.least(1);
    });

    test("PRIVACY: suppression payload never contains identifier text", async () => {
        const result = await diagnose(
            "SELECT SecretColumn9 FROM SecretTable7.SecretSchema8.SecretName6\nSELECT x FROM #SecretTemp5",
        );
        const payload = JSON.stringify(result.suppressed ?? {});
        for (const secret of ["Secret", "secret"]) {
            expect(payload).to.not.contain(secret);
        }
        // Keys are drawn from the fixed reason taxonomy only.
        const REASONS = new Set([
            "providerNotReady",
            "columnsNotReady",
            "databaseNotHydrated",
            "crossDatabaseUnhydrated",
            "linkedServer",
            "opaqueSource",
            "dynamicSql",
            "unknownSketchRegion",
            "unknownOverlayType",
            "tempTableUnknown",
            "systemObject",
            "ambiguousName",
            "unresolvedQualifier",
            "quotedIdentifierAmbiguous",
            "setOperationScope",
            "unsupportedSyntax",
            // CACHE-5 freshness reasons (§7.3) — counted, never identifiers.
            "metadataNotValidated",
            "metadataStale",
        ]);
        for (const key of Object.keys(result.suppressed ?? {})) {
            expect(REASONS.has(key), `unknown suppression key ${key}`).to.equal(true);
        }
    });

    test("case-sensitive catalog flags wrong-case columns (server parity)", async () => {
        const d = only(await diagnose("SELECT orderid FROM Sales.Orders", caseSensitiveProvider));
        expect(d.code).to.equal("mssql(207)");
    });

    test("case-insensitive catalog accepts any casing", async () => {
        expectClean(await diagnose("select ORDERID from sales.ORDERS"));
    });
});

// ---------------------------------------------------------------------------
// Lazy-columns hydration kick (diagnostics analogue of the completion path)
// ---------------------------------------------------------------------------

suite("sqlLanguage diagnostics T2: lazy column hydration kick", () => {
    /** Fresh provider per test: hydration state and requests are mutable. */
    const lazyColumnsProvider = (): FixtureLanguageMetadataProvider =>
        new FixtureLanguageMetadataProvider({
            objects: [
                {
                    schema: "Sales",
                    name: "LazyOrders",
                    kind: "table",
                    columns: [{ name: "OrderID", typeDisplay: "int" }],
                    columnsLazy: true,
                },
                // No declared columns: stays notLoaded even after the fixture
                // "load", keeping the per-pass kick de-dupe observable.
                { schema: "Sales", name: "LazyNoCols", kind: "table", columnsLazy: true },
            ],
            env: { currentDatabase: "FixtureDb", defaultSchema: "dbo", caseSensitive: false },
        });

    test("columnsNotReady suppression kicks hydration; re-run emits the real 207", async () => {
        const provider = lazyColumnsProvider();
        const engine = new NativeSqlLanguageEngine(provider);
        const first = await engine.diagnostics({
            text: "SELECT Missing FROM Sales.LazyOrders",
            version: 1,
        });
        expect(first?.diagnostics).to.have.length(0);
        expect(first?.suppressed?.columnsNotReady ?? 0).to.be.at.least(1);
        expect(provider.hydrationRequests).to.have.length(1);
        expect(provider.hydrationRequests[0].kind).to.equal("columns");
        expect(provider.hydrationRequests[0].priority).to.equal("background");
        expect(provider.hydrationRequests[0].object).to.not.equal(undefined);
        // The fixture "load" completed (and fired didChange — the
        // orchestrator's provider-change listener reschedules a pass on
        // that); the re-run pass now claims honestly.
        const second = await engine.diagnostics({
            text: "SELECT Missing FROM Sales.LazyOrders",
            version: 2,
        });
        expect(second?.diagnostics).to.have.length(1);
        expect(second?.diagnostics[0].code).to.equal("mssql(207)");
        expect(second?.diagnostics[0].message).to.contain("Missing");
        expect(provider.hydrationRequests).to.have.length(1); // no duplicate kick
    });

    test("one de-duped kick per distinct object within a pass", async () => {
        const provider = lazyColumnsProvider();
        const engine = new NativeSqlLanguageEngine(provider);
        const result = await engine.diagnostics({
            text: "SELECT a.X9, b.Y8 FROM Sales.LazyNoCols a JOIN Sales.LazyNoCols b ON 1 = 1",
            version: 1,
        });
        expect(result?.diagnostics).to.have.length(0);
        expect(result?.suppressed?.columnsNotReady ?? 0).to.be.at.least(2);
        expect(provider.hydrationRequests).to.have.length(1);
    });

    test("distinct lazy objects each get one kick", async () => {
        const provider = lazyColumnsProvider();
        const engine = new NativeSqlLanguageEngine(provider);
        const result = await engine.diagnostics({
            text: "SELECT o.M1, l.M2 FROM Sales.LazyOrders o JOIN Sales.LazyNoCols l ON 1 = 1",
            version: 1,
        });
        expect(result?.diagnostics).to.have.length(0);
        expect(provider.hydrationRequests).to.have.length(2);
        const ids = new Set(provider.hydrationRequests.map((r) => r.object?.objectId));
        expect(ids.size).to.equal(2);
    });
});

// ---------------------------------------------------------------------------
// Engine pass mechanics (sliced computation + memoization)
// ---------------------------------------------------------------------------

suite("sqlLanguage diagnostics engine pass", () => {
    test("pass is resumable: one unit per statement plus the lexical sweep", () => {
        const engine = new NativeSqlLanguageEngine(standardProvider);
        const pass = engine.diagnosticsPass({
            text: "SELECT 1\nGO\nSELECT 2\nSELECT 3",
            version: 7,
        });
        let steps = 0;
        while (pass.step()) {
            steps++;
        }
        // 3 statements + lexical sweep - final step returns false with work done.
        expect(steps).to.be.at.least(3);
        const result = pass.finish();
        expect(result.diagnostics).to.deep.equal([]);
    });

    test("abort is safe and does not publish", () => {
        const engine = new NativeSqlLanguageEngine(standardProvider);
        const pass = engine.diagnosticsPass({ text: "SELECT 1\nSELECT 2", version: 8 });
        pass.step();
        pass.abort(); // must not throw; span released
    });

    test("results memoize per version+generation (pull after pass is free)", async () => {
        const engine = new NativeSqlLanguageEngine(standardProvider);
        const first = await engine.diagnostics({ text: "SELECT * FROM Sales.Missing", version: 9 });
        const second = await engine.diagnostics({
            text: "SELECT * FROM Sales.Missing",
            version: 9,
        });
        expect(second).to.equal(first); // identical object — memo hit
        const third = await engine.diagnostics({
            text: "SELECT * FROM Sales.Missing",
            version: 10,
        });
        expect(third).to.not.equal(first);
    });

    test("suppression counts ride the engine result", async () => {
        const engine = new NativeSqlLanguageEngine(standardProvider);
        const result = await engine.diagnostics({ text: "EXEC('x')", version: 11 });
        expect(result?.suppressed?.dynamicSql).to.be.at.least(1);
    });
});
