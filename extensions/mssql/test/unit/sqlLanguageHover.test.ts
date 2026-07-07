/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * B11 / LS-3 native hover suite over the standard fixture catalog — content
 * per bound symbol kind (design 05 §12.1) and the honesty ladder: hovers
 * only ever state facts a ready metadata section (or the script itself)
 * supports. Includes the B10 findings: SELECT INTO overlay shapes never
 * claim column lists, ALTER'd shapes are untrusted, MERGE column binding is
 * suppressed.
 */

import { expect } from "chai";
import { HoverResult } from "../../src/sqlLanguage/api";
import { NativeSqlLanguageEngine } from "../../src/sqlLanguage/host/nativeEngine";
import {
    FixtureCatalogSpec,
    FixtureLanguageMetadataProvider,
} from "../../src/sqlLanguage/provider/fixtureProvider";
import { NullLanguageMetadataProvider } from "../../src/sqlLanguage/provider/nullProvider";
import { ISqlLanguageMetadataProvider } from "../../src/sqlLanguage/provider/types";
import { TextSnapshot } from "../../src/sqlLanguage/core/text/textSnapshot";
import { parseFourslash } from "../../src/sqlLanguage/testSupport/fourslash";
import { STANDARD_FIXTURE_CATALOG } from "../../src/sqlLanguage/testSupport/fixtureCatalog";

const standardProvider = new FixtureLanguageMetadataProvider(STANDARD_FIXTURE_CATALOG);

/** Standard catalog + H7-style descriptions + a scalar function. */
const DESCRIBED_CATALOG: FixtureCatalogSpec = {
    ...STANDARD_FIXTURE_CATALOG,
    objects: [
        ...STANDARD_FIXTURE_CATALOG.objects.map((o) =>
            o.schema === "Sales" && o.name === "Orders"
                ? {
                      ...o,
                      description: "Customer order headers.",
                      columnDescriptions: { CustomerID: "FK to the owning customer." },
                  }
                : o,
        ),
        {
            schema: "dbo",
            name: "OrderCount",
            kind: "scalarFunction" as const,
            parameters: [
                { ordinal: 0, name: "", typeDisplay: "int", isOutput: false },
                { ordinal: 1, name: "@CustomerID", typeDisplay: "int", isOutput: false },
            ],
        },
    ],
};
const describedProvider = new FixtureLanguageMetadataProvider(DESCRIBED_CATALOG);

async function hover(
    source: string,
    provider: ISqlLanguageMetadataProvider = standardProvider,
): Promise<HoverResult | undefined> {
    const fixture = parseFourslash(source);
    if (fixture.caret === undefined) {
        throw new Error("fixture needs /*caret*/");
    }
    const engine = new NativeSqlLanguageEngine(provider);
    const snapshot = new TextSnapshot(fixture.text, 1);
    return engine.hover({
        text: fixture.text,
        version: 1,
        position: snapshot.positionAt(fixture.caret),
    });
}

async function md(
    source: string,
    provider: ISqlLanguageMetadataProvider = standardProvider,
): Promise<string> {
    const result = await hover(source, provider);
    expect(result, "expected a hover").to.not.equal(undefined);
    return result!.contentsMarkdown;
}

suite("sqlLanguage native hover: tables, views, synonyms", () => {
    test("table hover: kind, schema-qualified name", async () => {
        const content = await md("SELECT * FROM Sales./*caret*/Orders");
        expect(content).to.contain("**table**");
        expect(content).to.contain("Sales.Orders");
    });

    test("table hover: column count when columns are ready", async () => {
        const content = await md("SELECT * FROM Sales./*caret*/Orders");
        expect(content).to.contain("4 columns");
    });

    test("table hover: PK badge from PK-flagged columns", async () => {
        const content = await md("SELECT * FROM Sales./*caret*/Orders");
        expect(content).to.contain("PK(OrderID)");
    });

    test("table hover: composite PK badge in key order", async () => {
        const content = await md("SELECT * FROM Sales./*caret*/OrderLines");
        expect(content).to.contain("PK(OrderID, LineNumber)");
    });

    test("table hover: FK count when foreign keys are ready", async () => {
        const content = await md("SELECT * FROM Sales./*caret*/Orders");
        expect(content).to.contain("1 foreign key");
    });

    test("table without outgoing FKs claims no FK count", async () => {
        const content = await md("SELECT * FROM Sales./*caret*/Customers");
        expect(content).to.not.contain("foreign key");
    });

    test("view hover: kind and columns", async () => {
        const content = await md("SELECT * FROM Sales./*caret*/vOrderSummary");
        expect(content).to.contain("**view**");
        expect(content).to.contain("2 columns");
    });

    test("synonym hover: kind only — no shape claims", async () => {
        const content = await md("SELECT * FROM dbo./*caret*/OrdersSynonym");
        expect(content).to.contain("**synonym**");
        expect(content).to.contain("dbo.OrdersSynonym");
        expect(content).to.not.contain("column");
    });

    test("TVF source hover: table function with columns and parameters", async () => {
        const content = await md("SELECT * FROM dbo./*caret*/OrdersByCustomer(1) o");
        expect(content).to.contain("**table function**");
        expect(content).to.contain("1 column");
        expect(content).to.contain("@CustomerID int");
    });

    test("unqualified name resolves via the default schema", async () => {
        const content = await md("SELECT * FROM /*caret*/Orders");
        expect(content).to.contain("dbo.Orders");
    });

    test("hover works on the table name of an aliased source", async () => {
        const content = await md("SELECT o.OrderID FROM Sales./*caret*/Orders AS o");
        expect(content).to.contain("**table**");
    });

    test("hover range covers exactly the identifier token", async () => {
        const result = await hover("SELECT * FROM Sales./*caret*/Orders");
        expect(result!.range).to.deep.equal({
            start: { line: 0, character: 20 },
            end: { line: 0, character: 26 },
        });
    });

    test("bracketed identifiers hover with brackets stripped", async () => {
        const spec: FixtureCatalogSpec = {
            ...STANDARD_FIXTURE_CATALOG,
            objects: [
                ...STANDARD_FIXTURE_CATALOG.objects,
                {
                    schema: "dbo",
                    name: "Order Details",
                    kind: "table",
                    columns: [{ name: "Unit Price", typeDisplay: "money", nullable: false }],
                },
            ],
        };
        const provider = new FixtureLanguageMetadataProvider(spec);
        const content = await md("SELECT * FROM /*caret*/[Order Details]", provider);
        expect(content).to.contain("dbo.Order Details");
        expect(content).to.contain("1 column");
    });

    test("unknown object name yields no hover — never a guess", async () => {
        expect(await hover("SELECT * FROM dbo./*caret*/Nope")).to.equal(undefined);
    });
});

suite("sqlLanguage native hover: schema and database parts", () => {
    test("schema part of a source name", async () => {
        const content = await md("SELECT * FROM /*caret*/Sales.Orders");
        expect(content).to.contain("**schema** `Sales`");
    });

    test("database qualifier of a three-part source name", async () => {
        const content = await md("SELECT * FROM /*caret*/FixtureDb.Sales.Orders");
        expect(content).to.contain("**database** `FixtureDb`");
    });

    test("schema part under the current database qualifier", async () => {
        const content = await md("SELECT * FROM FixtureDb./*caret*/Sales.Orders");
        expect(content).to.contain("**schema** `Sales`");
    });

    test("object part of a current-database three-part name", async () => {
        const content = await md("SELECT * FROM FixtureDb.Sales./*caret*/Orders");
        expect(content).to.contain("**table** `Sales.Orders`");
    });

    test("schema part of a non-current database name is not claimed", async () => {
        expect(await hover("SELECT * FROM master./*caret*/dbo.Things")).to.equal(undefined);
    });

    test("unknown qualifier part yields nothing", async () => {
        expect(await hover("SELECT /*caret*/zz.Col FROM Sales.Orders")).to.equal(undefined);
    });
});

suite("sqlLanguage native hover: columns", () => {
    test("alias-qualified column: type and NOT NULL", async () => {
        const content = await md("SELECT o./*caret*/OrderID FROM Sales.Orders o");
        expect(content).to.contain("**column** `o.OrderID`");
        expect(content).to.contain("`int`");
        expect(content).to.contain("NOT NULL");
    });

    test("nullable column renders NULL", async () => {
        const content = await md("SELECT o./*caret*/Comments FROM Sales.Orders o");
        expect(content).to.contain("`nvarchar(max)`");
        expect(content).to.contain("NULL");
        expect(content).to.not.contain("NOT NULL");
    });

    test("column hover names the owning object", async () => {
        const content = await md("SELECT o./*caret*/OrderID FROM Sales.Orders o");
        expect(content).to.contain("Sales.Orders");
    });

    test("PK badge on primary key columns", async () => {
        const content = await md("SELECT o./*caret*/OrderID FROM Sales.Orders o");
        expect(content).to.contain("PK");
    });

    test("FK edge line for participating columns", async () => {
        const content = await md("SELECT o./*caret*/CustomerID FROM Sales.Orders o");
        expect(content).to.contain("FK → Sales.Customers(CustomerID)");
    });

    test("non-FK columns get no FK line", async () => {
        const content = await md("SELECT o./*caret*/OrderDate FROM Sales.Orders o");
        expect(content).to.not.contain("FK →");
    });

    test("identity and computed badges", async () => {
        const spec: FixtureCatalogSpec = {
            ...STANDARD_FIXTURE_CATALOG,
            objects: STANDARD_FIXTURE_CATALOG.objects.map((o) =>
                o.name === "Orders" && o.schema === "Sales"
                    ? {
                          ...o,
                          columns: [
                              {
                                  name: "OrderID",
                                  typeDisplay: "int",
                                  nullable: false,
                                  isPrimaryKey: true,
                                  isIdentity: true,
                              },
                              {
                                  name: "Total",
                                  typeDisplay: "money",
                                  nullable: true,
                                  isComputed: true,
                              },
                          ],
                      }
                    : o,
            ),
        };
        const provider = new FixtureLanguageMetadataProvider(spec);
        const identity = await md("SELECT o./*caret*/OrderID FROM Sales.Orders o", provider);
        expect(identity).to.contain("identity");
        const computed = await md("SELECT o./*caret*/Total FROM Sales.Orders o", provider);
        expect(computed).to.contain("computed");
    });

    test("table-name-qualified column resolves through the source", async () => {
        const content = await md("SELECT Orders./*caret*/OrderID FROM Sales.Orders");
        expect(content).to.contain("**column**");
        expect(content).to.contain("Sales.Orders");
    });

    test("schema.table.column chains resolve through the catalog", async () => {
        const content = await md("SELECT Sales.Orders./*caret*/OrderID FROM Sales.Orders");
        expect(content).to.contain("**column**");
        expect(content).to.contain("`int`");
    });

    test("unqualified unique column resolves across sources", async () => {
        const content = await md("SELECT /*caret*/OrderDate FROM Sales.Orders o");
        expect(content).to.contain("**column**");
        expect(content).to.contain("datetime2(7)");
    });

    test("ambiguous unqualified column yields no hover", async () => {
        expect(
            await hover(
                "SELECT /*caret*/CustomerID FROM Sales.Orders o JOIN Sales.Customers c ON o.CustomerID = c.CustomerID",
            ),
        ).to.equal(undefined);
    });

    test("column of a WHERE clause hovers too", async () => {
        const content = await md("SELECT 1 FROM Sales.Orders o WHERE o./*caret*/CustomerID = 3");
        expect(content).to.contain("**column** `o.CustomerID`");
    });

    test("correlated subquery: outer alias columns hover inside", async () => {
        const content = await md(
            "SELECT * FROM Sales.Orders o WHERE EXISTS (SELECT 1 FROM Sales.OrderLines l WHERE l.OrderID = o./*caret*/OrderID)",
        );
        expect(content).to.contain("**column** `o.OrderID`");
    });

    test("column missing from a trusted shape yields no hover", async () => {
        expect(await hover("SELECT o./*caret*/Nope FROM Sales.Orders o")).to.equal(undefined);
    });

    test("bracketed column name hovers", async () => {
        const spec: FixtureCatalogSpec = {
            ...STANDARD_FIXTURE_CATALOG,
            objects: [
                ...STANDARD_FIXTURE_CATALOG.objects,
                {
                    schema: "dbo",
                    name: "Order Details",
                    kind: "table",
                    columns: [{ name: "Unit Price", typeDisplay: "money", nullable: false }],
                },
            ],
        };
        const provider = new FixtureLanguageMetadataProvider(spec);
        const content = await md("SELECT d./*caret*/[Unit Price] FROM [Order Details] d", provider);
        expect(content).to.contain("Unit Price");
        expect(content).to.contain("money");
    });
});

suite("sqlLanguage native hover: aliases and select aliases", () => {
    test("alias reference resolves to its catalog table", async () => {
        const content = await md("SELECT /*caret*/o.OrderID FROM Sales.Orders AS o");
        expect(content).to.contain("**alias** `o`");
        expect(content).to.contain("Sales.Orders");
    });

    test("alias at its definition site", async () => {
        const content = await md("SELECT 1 FROM Sales.Orders AS /*caret*/o");
        expect(content).to.contain("**alias** `o`");
    });

    test("alias of a CTE", async () => {
        const content = await md(
            "WITH recent AS (SELECT OrderID FROM Sales.Orders) SELECT /*caret*/r.OrderID FROM recent r",
        );
        expect(content).to.contain("**alias** `r`");
        expect(content).to.contain("(CTE)");
    });

    test("alias of a derived table", async () => {
        const content = await md(
            "SELECT /*caret*/d.oid FROM (SELECT OrderID AS oid FROM Sales.Orders) d",
        );
        expect(content).to.contain("**alias** `d`");
        expect(content).to.contain("(derived table)");
    });

    test("alias of a table variable", async () => {
        const content = await md("DECLARE @tv TABLE (X int)\nSELECT /*caret*/v.X FROM @tv v");
        expect(content).to.contain("**alias** `v`");
        expect(content).to.contain("@tv");
    });

    test("bare alias reference in an expression", async () => {
        const content = await md("SELECT 1 FROM Sales.Orders AS o WHERE /*caret*/o.OrderID = 1");
        expect(content).to.contain("**alias** `o`");
    });

    test("select-list alias hovers from ORDER BY", async () => {
        const content = await md("SELECT OrderID AS oid FROM Sales.Orders ORDER BY /*caret*/oid");
        expect(content).to.contain("**alias** `oid`");
        expect(content).to.contain("select list");
    });
});

suite("sqlLanguage native hover: CTEs, derived tables", () => {
    test("CTE source with declared columns", async () => {
        const content = await md(
            "WITH recent(OrderID, CustomerID) AS (SELECT 1, 2) SELECT * FROM /*caret*/recent",
        );
        expect(content).to.contain("**CTE** `recent`");
        expect(content).to.contain("OrderID, CustomerID");
    });

    test("CTE source with body-inferred columns", async () => {
        const content = await md(
            "WITH recent AS (SELECT OrderID, OrderDate FROM Sales.Orders) SELECT * FROM /*caret*/recent",
        );
        expect(content).to.contain("**CTE** `recent`");
        expect(content).to.contain("OrderID, OrderDate");
    });

    test("CTE with unnameable body items claims no columns", async () => {
        const content = await md(
            "WITH agg AS (SELECT COUNT(*) FROM Sales.Orders) SELECT * FROM /*caret*/agg",
        );
        expect(content).to.contain("**CTE** `agg`");
        expect(content).to.not.contain("columns:");
    });

    test("CTE column through the alias", async () => {
        const content = await md(
            "WITH recent(OrderID) AS (SELECT 1) SELECT r./*caret*/OrderID FROM recent r",
        );
        expect(content).to.contain("**column**");
        expect(content).to.contain("`r.OrderID`");
    });

    test("derived table column via alias (no type claim)", async () => {
        const content = await md(
            "SELECT d./*caret*/oid FROM (SELECT OrderID AS oid FROM Sales.Orders) d",
        );
        expect(content).to.contain("**column** `d.oid`");
        expect(content).to.not.contain("`int`");
    });

    test("recursive CTE hover stays honest", async () => {
        const content = await md(
            "WITH nums(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM nums WHERE n < 5) SELECT * FROM /*caret*/nums",
        );
        expect(content).to.contain("**CTE** `nums`");
        expect(content).to.contain("n");
    });
});

suite("sqlLanguage native hover: temp tables, table variables, overlay honesty", () => {
    test("temp table from CREATE TABLE: trustworthy column list", async () => {
        const content = await md(
            "CREATE TABLE #tmp (Id int, Name nvarchar(10))\nSELECT * FROM /*caret*/#tmp",
        );
        expect(content).to.contain("**temp table** `#tmp`");
        expect(content).to.contain("2 columns (Id, Name)");
    });

    test("temp table hover at its creation site", async () => {
        const content = await md("CREATE TABLE /*caret*/#tmp (Id int)");
        expect(content).to.contain("**temp table** `#tmp`");
    });

    test("global temp table hovers", async () => {
        const content = await md("CREATE TABLE ##shared (A int)\nSELECT * FROM /*caret*/##shared");
        expect(content).to.contain("**temp table** `##shared`");
    });

    test("SELECT INTO shape NEVER claims a column list (B10 finding)", async () => {
        const content = await md(
            "SELECT OrderID AS oid INTO #x FROM Sales.Orders\nSELECT * FROM /*caret*/#x",
        );
        expect(content).to.contain("**temp table** `#x`");
        expect(content).to.not.contain("column");
        expect(content).to.not.contain("oid");
    });

    test("ALTER'd temp table shape is untrusted — no column claims", async () => {
        const content = await md(
            "CREATE TABLE #t (a int)\nALTER TABLE #t ADD b int\nSELECT * FROM /*caret*/#t",
        );
        expect(content).to.contain("**temp table** `#t`");
        expect(content).to.not.contain("column");
    });

    test("unknown temp table yields no hover (session may own it)", async () => {
        expect(await hover("SELECT * FROM /*caret*/#unknown")).to.equal(undefined);
    });

    test("table variable with declared columns", async () => {
        const content = await md("DECLARE @tv TABLE (X int, Y int)\nSELECT * FROM /*caret*/@tv v");
        expect(content).to.contain("**table variable** `@tv`");
        expect(content).to.contain("2 columns (X, Y)");
    });

    test("temp table column via alias (names only, no type claim)", async () => {
        const content = await md("CREATE TABLE #tmp (Id int)\nSELECT t./*caret*/Id FROM #tmp t");
        expect(content).to.contain("**column** `t.Id`");
    });

    test("script-local CREATE TABLE hovers as a script table", async () => {
        const content = await md(
            "CREATE TABLE dbo.Staging (A int)\nSELECT * FROM /*caret*/Staging",
        );
        expect(content).to.contain("**script table** `Staging`");
    });
});

suite("sqlLanguage native hover: variables and parameters", () => {
    test("scalar variable at its declaration, with declared line", async () => {
        const content = await md("DECLARE /*caret*/@id int");
        expect(content).to.contain("**variable** `@id`");
        expect(content).to.contain("`int`");
        expect(content).to.contain("declared at line 1");
    });

    test("scalar variable referenced in a later statement", async () => {
        const content = await md(
            "DECLARE @id int\nSELECT * FROM Sales.Orders WHERE OrderID = /*caret*/@id",
        );
        expect(content).to.contain("**variable** `@id`");
        expect(content).to.contain("`int`");
    });

    test("variable with a parenthesized type", async () => {
        const content = await md("DECLARE @name nvarchar(50)\nSELECT /*caret*/@name");
        expect(content).to.contain("nvarchar(50)");
    });

    test("module header parameter hovers as a variable", async () => {
        const content = await md("CREATE PROCEDURE dbo.P @cust int AS SELECT /*caret*/@cust");
        expect(content).to.contain("**variable** `@cust`");
        expect(content).to.contain("`int`");
    });

    test("undeclared variable yields no hover", async () => {
        expect(await hover("SELECT /*caret*/@mystery")).to.equal(undefined);
    });

    test("system variables (@@) are never guessed", async () => {
        expect(await hover("SELECT /*caret*/@@ROWCOUNT")).to.equal(undefined);
    });

    test("EXEC named argument hovers as the routine's parameter", async () => {
        const content = await md("EXEC Sales.GetOrders /*caret*/@CustomerID = 1");
        expect(content).to.contain("**parameter** `@CustomerID`");
        expect(content).to.contain("`int`");
        expect(content).to.contain("Sales.GetOrders");
    });

    test("EXEC OUTPUT parameter carries the OUTPUT badge", async () => {
        const content = await md(
            "DECLARE @t money\nEXEC Sales.GetOrders @CustomerID = 1, /*caret*/@Total = @t OUTPUT",
        );
        expect(content).to.contain("**parameter** `@Total`");
        expect(content).to.contain("OUTPUT");
    });

    test("EXEC argument VALUE variable hovers as the local variable", async () => {
        const content = await md(
            "DECLARE @t money\nEXEC Sales.GetOrders @Total = /*caret*/@t OUTPUT",
        );
        expect(content).to.contain("**variable** `@t`");
        expect(content).to.contain("money");
    });

    test("table variable reference outside FROM", async () => {
        const content = await md("DECLARE @tv TABLE (X int)\nSELECT * FROM /*caret*/@tv");
        expect(content).to.contain("**table variable** `@tv`");
    });
});

suite("sqlLanguage native hover: procedures, functions, builtins", () => {
    test("EXEC procedure name: signature from parameters", async () => {
        const content = await md("EXEC Sales./*caret*/GetOrders @CustomerID = 1");
        expect(content).to.contain("**procedure** `Sales.GetOrders`");
        expect(content).to.contain("@CustomerID int");
        expect(content).to.contain("@Since datetime2(7)");
        expect(content).to.contain("@Total money OUTPUT");
    });

    test("scalar function hover shows parameters and return type", async () => {
        const content = await md("SELECT dbo./*caret*/OrderCount(1)", describedProvider);
        expect(content).to.contain("**scalar function** `dbo.OrderCount`");
        expect(content).to.contain("@CustomerID int");
        expect(content).to.contain("returns int");
    });

    test("builtin function: signature, description, doc link", async () => {
        const content = await md("SELECT /*caret*/SUBSTRING(Comments, 1, 2) FROM Sales.Orders");
        expect(content).to.contain("**function** `SUBSTRING`");
        expect(content).to.contain("SUBSTRING(expression, start, length)");
        expect(content).to.contain("Returns part of a character");
        expect(content).to.contain("[Microsoft Learn](https://learn.microsoft.com");
    });

    test("builtin with multiple overloads lists each signature", async () => {
        const content = await md("SELECT /*caret*/COUNT(*) FROM Sales.Orders");
        expect(content).to.contain("COUNT(*)");
        expect(content).to.contain("COUNT([ALL | DISTINCT] expression)");
    });

    test("reserved-word builtins (LEFT) hover as functions when called", async () => {
        const content = await md("SELECT /*caret*/LEFT(Comments, 2) FROM Sales.Orders");
        expect(content).to.contain("**function** `LEFT`");
    });

    test("niladic builtins hover without parentheses", async () => {
        const content = await md("SELECT /*caret*/CURRENT_TIMESTAMP");
        expect(content).to.contain("**function** `CURRENT_TIMESTAMP`");
        expect(content).to.contain("datetime");
    });

    test("builtin names not followed by ( are not hijacked", async () => {
        const spec: FixtureCatalogSpec = {
            ...STANDARD_FIXTURE_CATALOG,
            objects: STANDARD_FIXTURE_CATALOG.objects.map((o) =>
                o.name === "Orders" && o.schema === "Sales"
                    ? {
                          ...o,
                          columns: [
                              ...(o.columns ?? []),
                              { name: "Count", typeDisplay: "int", nullable: true },
                          ],
                      }
                    : o,
            ),
        };
        const provider = new FixtureLanguageMetadataProvider(spec);
        const content = await md("SELECT o./*caret*/Count FROM Sales.Orders o", provider);
        expect(content).to.contain("**column**");
    });

    test("builtin return types render per signature", async () => {
        const content = await md("SELECT /*caret*/GETDATE()");
        expect(content).to.contain("→ datetime");
    });
});

suite("sqlLanguage native hover: descriptions (H7)", () => {
    test("object description appears when present", async () => {
        const content = await md("SELECT * FROM Sales./*caret*/Orders", describedProvider);
        expect(content).to.contain("Customer order headers.");
    });

    test("column description appears when present", async () => {
        const content = await md(
            "SELECT o./*caret*/CustomerID FROM Sales.Orders o",
            describedProvider,
        );
        expect(content).to.contain("FK to the owning customer.");
    });

    test("columns without descriptions add no phantom text", async () => {
        const content = await md(
            "SELECT o./*caret*/OrderID FROM Sales.Orders o",
            describedProvider,
        );
        expect(content).to.not.contain("FK to the owning customer.");
        expect(content).to.not.contain("Customer order headers.");
    });

    test("providers without getDescription still hover (facts only)", async () => {
        const content = await md("SELECT * FROM Sales./*caret*/Orders");
        expect(content).to.contain("**table**");
    });
});

suite("sqlLanguage native hover: honesty under partial/missing metadata", () => {
    test("columns loading: object hover keeps the name, drops column facts", async () => {
        const provider = new FixtureLanguageMetadataProvider({
            ...STANDARD_FIXTURE_CATALOG,
            readiness: { columns: "loading" },
        });
        const content = await md("SELECT * FROM Sales./*caret*/Orders", provider);
        expect(content).to.contain("**table** `Sales.Orders`");
        expect(content).to.not.contain("column");
        expect(content).to.not.contain("PK(");
    });

    test("columns loading: column hover is suppressed entirely", async () => {
        const provider = new FixtureLanguageMetadataProvider({
            ...STANDARD_FIXTURE_CATALOG,
            readiness: { columns: "loading" },
        });
        expect(await hover("SELECT o./*caret*/OrderID FROM Sales.Orders o", provider)).to.equal(
            undefined,
        );
    });

    test("objects loading: no catalog object hover", async () => {
        const provider = new FixtureLanguageMetadataProvider({
            ...STANDARD_FIXTURE_CATALOG,
            readiness: { objects: "loading" },
        });
        expect(await hover("SELECT * FROM Sales./*caret*/Orders", provider)).to.equal(undefined);
    });

    test("objects loading: overlay objects still hover", async () => {
        const provider = new FixtureLanguageMetadataProvider({
            ...STANDARD_FIXTURE_CATALOG,
            readiness: { objects: "loading" },
        });
        const content = await md(
            "CREATE TABLE #tmp (Id int)\nSELECT * FROM /*caret*/#tmp",
            provider,
        );
        expect(content).to.contain("**temp table** `#tmp`");
    });

    test("foreign keys loading: no FK badge, no FK edge line", async () => {
        const provider = new FixtureLanguageMetadataProvider({
            ...STANDARD_FIXTURE_CATALOG,
            readiness: { foreignKeys: "loading" },
        });
        const table = await md("SELECT * FROM Sales./*caret*/Orders", provider);
        expect(table).to.not.contain("foreign key");
        const column = await md("SELECT o./*caret*/CustomerID FROM Sales.Orders o", provider);
        expect(column).to.not.contain("FK →");
    });

    test("parameters loading: routine hover keeps name, drops signature", async () => {
        const provider = new FixtureLanguageMetadataProvider({
            ...STANDARD_FIXTURE_CATALOG,
            readiness: { parameters: "loading" },
        });
        const content = await md("EXEC Sales./*caret*/GetOrders", provider);
        expect(content).to.contain("**procedure** `Sales.GetOrders`");
        expect(content).to.not.contain("@CustomerID");
    });

    test("offline provider: no catalog hovers at all", async () => {
        const provider = new NullLanguageMetadataProvider();
        expect(await hover("SELECT * FROM Sales./*caret*/Orders", provider)).to.equal(undefined);
    });

    test("offline provider: CTEs still hover (script-local facts)", async () => {
        const provider = new NullLanguageMetadataProvider();
        const content = await md("WITH r(x) AS (SELECT 1) SELECT * FROM /*caret*/r", provider);
        expect(content).to.contain("**CTE** `r`");
    });

    test("offline provider: builtins still hover (local data asset)", async () => {
        const provider = new NullLanguageMetadataProvider();
        const content = await md("SELECT /*caret*/GETDATE()", provider);
        expect(content).to.contain("**function** `GETDATE`");
    });

    test("ALTER'd catalog table drops column facts from the object hover", async () => {
        const content = await md("ALTER TABLE Orders ADD Extra int\nSELECT * FROM /*caret*/Orders");
        expect(content).to.contain("dbo.Orders");
        expect(content).to.not.contain("column");
    });
});

suite("sqlLanguage native hover: USE switching, cross-database, MERGE", () => {
    test("statement after USE other-db gets no catalog hover", async () => {
        expect(await hover("USE master\nSELECT * FROM Sales./*caret*/Orders")).to.equal(undefined);
    });

    test("statement after USE back to the current database hovers again", async () => {
        const content = await md("USE master\nUSE FixtureDb\nSELECT * FROM Sales./*caret*/Orders");
        expect(content).to.contain("**table** `Sales.Orders`");
    });

    test("after USE other-db, overlay objects still hover", async () => {
        const content = await md("CREATE TABLE #t (Id int)\nUSE master\nSELECT * FROM /*caret*/#t");
        expect(content).to.contain("**temp table** `#t`");
    });

    test("after USE other-db, variables still hover", async () => {
        const content = await md("DECLARE @x int\nUSE master\nSELECT /*caret*/@x");
        expect(content).to.contain("**variable** `@x`");
    });

    test("cross-database three-part names are never claimed", async () => {
        expect(await hover("SELECT * FROM OtherDb.dbo./*caret*/Things")).to.equal(undefined);
    });

    test("four-part linked-server names are never claimed", async () => {
        expect(await hover("SELECT * FROM Srv.Db.dbo./*caret*/Things")).to.equal(undefined);
    });

    test("MERGE: source object names still hover", async () => {
        const content = await md(
            "MERGE Sales.Orders AS t USING Sales./*caret*/Customers AS c ON t.CustomerID = c.CustomerID WHEN MATCHED THEN UPDATE SET Comments = 'x';",
        );
        expect(content).to.contain("**table** `Sales.Customers`");
    });

    test("MERGE: column hovers are suppressed (binding unsupported)", async () => {
        expect(
            await hover(
                "MERGE Sales.Orders AS t USING Sales.Customers AS c ON t.CustomerID = c.CustomerID WHEN MATCHED THEN UPDATE SET t./*caret*/Comments = 'x';",
            ),
        ).to.equal(undefined);
    });

    test("MERGE: aliases still hover (name-level facts)", async () => {
        const content = await md(
            "MERGE Sales.Orders AS t USING Sales.Customers AS c ON /*caret*/t.CustomerID = c.CustomerID WHEN MATCHED THEN UPDATE SET Comments = 'x';",
        );
        expect(content).to.contain("**alias** `t`");
    });
});

suite("sqlLanguage native hover: DML targets and statement positions", () => {
    test("INSERT target hovers as the catalog table", async () => {
        const content = await md("INSERT INTO Sales./*caret*/Orders (OrderID) VALUES (1)");
        expect(content).to.contain("**table** `Sales.Orders`");
    });

    test("UPDATE direct target hovers", async () => {
        const content = await md("UPDATE Sales./*caret*/Orders SET Comments = 'x'");
        expect(content).to.contain("**table** `Sales.Orders`");
    });

    test("UPDATE alias-form target hovers via FROM", async () => {
        const content = await md("UPDATE /*caret*/o SET Comments = 'x' FROM Sales.Orders o");
        expect(content).to.contain("**alias** `o`");
        expect(content).to.contain("Sales.Orders");
    });

    test("DELETE target hovers", async () => {
        const content = await md("DELETE FROM Sales./*caret*/Orders WHERE OrderID = 1");
        expect(content).to.contain("**table** `Sales.Orders`");
    });

    test("INSERT column list column hovers", async () => {
        const content = await md("INSERT INTO Sales.Orders (/*caret*/CustomerID) VALUES (1)");
        expect(content).to.contain("**column**");
    });

    test("SELECT INTO target hovers as an overlay object without shape claims", async () => {
        const content = await md("SELECT OrderID INTO /*caret*/#dst FROM Sales.Orders");
        expect(content).to.contain("**temp table** `#dst`");
        expect(content).to.not.contain("columns");
    });
});

suite("sqlLanguage native hover: never-hover positions", () => {
    test("no hover inside comments", async () => {
        expect(await hover("SELECT 1 -- /*caret*/Orders comment")).to.equal(undefined);
        expect(await hover("SELECT 1 /* block /*caret*/Orders */")).to.equal(undefined);
    });

    test("no hover inside string literals", async () => {
        expect(await hover("SELECT 'text /*caret*/Orders more'")).to.equal(undefined);
    });

    test("no hover on number literals or operators", async () => {
        expect(await hover("SELECT /*caret*/42")).to.equal(undefined);
        expect(await hover("SELECT 1 /*caret*/+ 2")).to.equal(undefined);
    });

    test("no hover on bare keywords", async () => {
        expect(await hover("/*caret*/SELECT 1 FROM Sales.Orders")).to.equal(undefined);
        expect(await hover("SELECT 1 /*caret*/FROM Sales.Orders")).to.equal(undefined);
    });

    test("no hover on whitespace between statements or in empty documents", async () => {
        expect(await hover("SELECT 1\n/*caret*/\nSELECT 2")).to.equal(undefined);
        expect(await hover("/*caret*/")).to.equal(undefined);
    });

    test("case-sensitive catalog: wrong-case alias gets no hover", async () => {
        const provider = new FixtureLanguageMetadataProvider({
            ...STANDARD_FIXTURE_CATALOG,
            env: { ...STANDARD_FIXTURE_CATALOG.env, caseSensitive: true },
        });
        expect(await hover("SELECT o./*caret*/OrderID FROM Sales.Orders AS O", provider)).to.equal(
            undefined,
        );
        const right = await md("SELECT O./*caret*/OrderID FROM Sales.Orders AS O", provider);
        expect(right).to.contain("**column**");
    });

    test("keyword-lookalike identifiers hover by binding, not by keyword-ness", async () => {
        const spec: FixtureCatalogSpec = {
            ...STANDARD_FIXTURE_CATALOG,
            objects: [
                ...STANDARD_FIXTURE_CATALOG.objects,
                {
                    schema: "dbo",
                    name: "Status",
                    kind: "table",
                    columns: [{ name: "Value", typeDisplay: "int", nullable: false }],
                },
            ],
        };
        const provider = new FixtureLanguageMetadataProvider(spec);
        const content = await md("SELECT * FROM dbo./*caret*/Status", provider);
        expect(content).to.contain("**table** `dbo.Status`");
    });
});

suite("sqlLanguage native hover: static system catalog", () => {
    test("sys object hover: kind + name, no column-count overclaim", async () => {
        const content = await md("SELECT * FROM sys./*caret*/databases");
        expect(content).to.contain("**view** `sys.databases`");
        // Curated column lists are subsets — a count would overclaim.
        expect(content).to.not.contain("columns");
    });

    test("INFORMATION_SCHEMA object hover: kind + name", async () => {
        const content = await md("SELECT * FROM INFORMATION_SCHEMA./*caret*/TABLES");
        expect(content).to.contain("**view** `INFORMATION_SCHEMA.TABLES`");
    });

    test("sys column hover via alias: same card shape as user columns", async () => {
        const content = await md("SELECT d./*caret*/name FROM sys.databases d");
        expect(content).to.contain("**column** `d.name`");
        expect(content).to.contain("sys.databases");
    });

    test("unqualified sys column hover resolves from the curated list", async () => {
        const content = await md("SELECT /*caret*/state_desc FROM sys.databases");
        expect(content).to.contain("**column** `state_desc`");
        expect(content).to.contain("sys.databases");
    });

    test("column missing from the curated list never claims", async () => {
        expect(await hover("SELECT d./*caret*/owner_sid FROM sys.databases d")).to.equal(undefined);
    });

    test("partial system shapes break unqualified single-ownership claims", async () => {
        // state_desc matches only sys.databases' curated list, but the other
        // system source's list is a subset — ownership cannot be claimed.
        expect(
            await hover(
                "SELECT /*caret*/state_desc FROM sys.databases d JOIN sys.objects o ON d.database_id = o.object_id",
            ),
        ).to.equal(undefined);
    });

    test("hover on the sys schema qualifier", async () => {
        const content = await md("SELECT * FROM /*caret*/sys.databases");
        expect(content).to.contain("**schema** `sys`");
    });
});
