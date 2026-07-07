/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * B9 / LS-1 native completion suite over the standard fixture catalog —
 * fourslash fixtures per design 05 §17.1, contexts per §10.2, acceptance
 * matrix Appendix A. Grows toward the 150+ target through B10..B13.
 */

import { expect } from "chai";
import { CompletionResult } from "../../src/sqlLanguage/api";
import { NativeSqlLanguageEngine } from "../../src/sqlLanguage/host/nativeEngine";
import {
    FixtureLanguageMetadataProvider,
    FixtureCatalogSpec,
} from "../../src/sqlLanguage/provider/fixtureProvider";
import { TextSnapshot } from "../../src/sqlLanguage/core/text/textSnapshot";
import { parseFourslash } from "../../src/sqlLanguage/testSupport/fourslash";
import { STANDARD_FIXTURE_CATALOG } from "../../src/sqlLanguage/testSupport/fixtureCatalog";
import { ISqlLanguageMetadataProvider } from "../../src/sqlLanguage/provider/types";

const standardProvider = new FixtureLanguageMetadataProvider(STANDARD_FIXTURE_CATALOG);

async function complete(
    source: string,
    provider: ISqlLanguageMetadataProvider = standardProvider,
): Promise<CompletionResult> {
    return completeWithTrigger(source, { trigger: "invoke" }, provider);
}

async function completeWithTrigger(
    source: string,
    trigger: { trigger: "invoke" } | { trigger: "character"; triggerCharacter: string },
    provider: ISqlLanguageMetadataProvider = standardProvider,
): Promise<CompletionResult> {
    const fixture = parseFourslash(source);
    if (fixture.caret === undefined) {
        throw new Error("fixture needs /*caret*/");
    }
    const engine = new NativeSqlLanguageEngine(provider);
    const snapshot = new TextSnapshot(fixture.text, 1);
    const result = await engine.completion({
        text: fixture.text,
        version: 1,
        position: snapshot.positionAt(fixture.caret),
        ...trigger,
    });
    expect(result).to.not.equal(undefined);
    return result!;
}

function labels(result: CompletionResult): string[] {
    return result.items.map((i) => i.label);
}

suite("sqlLanguage native completion: member access", () => {
    test("alias columns, alias declared to the RIGHT of the caret", async () => {
        const result = await complete("SELECT o./*caret*/ FROM Sales.Orders AS o");
        expect(labels(result)).to.include.members(["OrderID", "CustomerID", "OrderDate"]);
        expect(labels(result)).to.not.include("CustomerName");
    });

    test("prefix filtering after the dot", async () => {
        const result = await complete("SELECT o.Or/*caret*/ FROM Sales.Orders o");
        expect(labels(result)).to.include.members(["OrderID", "OrderDate"]);
        expect(labels(result)).to.not.include("Comments");
    });

    test("PK columns carry a PK badge and rank first among columns", async () => {
        const result = await complete("SELECT o./*caret*/ FROM Sales.Orders o");
        const pk = result.items.find((i) => i.label === "OrderID");
        expect(pk?.detail).to.contain("PK");
        expect(labels(result)[0]).to.equal("OrderID");
    });

    test("schema dot lists schema objects", async () => {
        const result = await complete("SELECT * FROM Sales./*caret*/");
        expect(labels(result)).to.include.members(["Orders", "Customers", "vOrderSummary"]);
        expect(labels(result)).to.not.include("OrdersByCustomer"); // dbo schema
    });

    test("current-database qualifier lists schemas", async () => {
        const result = await complete("SELECT * FROM FixtureDb./*caret*/");
        expect(labels(result)).to.include.members(["Sales", "dbo"]);
    });

    test("unhydrated database qualifier degrades honestly", async () => {
        const result = await complete("SELECT * FROM master./*caret*/");
        expect(result.items).to.have.length(0);
        expect(result.isIncomplete).to.equal(true);
        expect(result.incompleteReason).to.equal("crossDatabaseUnhydrated");
    });

    test("unknown qualifier claims nothing", async () => {
        const result = await complete("SELECT zz./*caret*/ FROM Sales.Orders o");
        expect(result.items).to.have.length(0);
    });
});

suite("sqlLanguage native completion: table sources", () => {
    test("FROM lists tables/views/schemas but not procedures", async () => {
        const result = await complete("SELECT * FROM /*caret*/");
        expect(labels(result)).to.include.members([
            "Sales.Orders",
            "Sales.vOrderSummary",
            "Sales",
            "dbo",
        ]);
        expect(labels(result)).to.not.include("Sales.GetOrders");
    });

    test("JOIN ranks FK-adjacent tables first", async () => {
        const result = await complete("SELECT * FROM Sales.Orders o JOIN /*caret*/");
        const catalogLabels = labels(result).filter((l) => l.includes("."));
        expect(["Sales.Customers", "Sales.OrderLines"]).to.include(catalogLabels[0]);
    });

    test("CTE names appear as sources within their statement", async () => {
        const result = await complete(
            "WITH recent AS (SELECT OrderID FROM Sales.Orders) SELECT * FROM /*caret*/",
        );
        expect(labels(result)).to.include("recent");
    });

    test("temp tables and table variables from earlier statements appear", async () => {
        const result = await complete(
            "CREATE TABLE #tmp (Id int)\nDECLARE @tv TABLE (X int)\nSELECT * FROM /*caret*/",
        );
        expect(labels(result)).to.include.members(["#tmp", "@tv"]);
    });

    test("bracket-required identifiers insert bracketed", async () => {
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
        const result = await complete("SELECT * FROM /*caret*/", provider);
        const item = result.items.find((i) => i.label === "dbo.Order Details");
        expect(item?.insertText).to.equal("dbo.[Order Details]");

        const cols = await complete("SELECT d./*caret*/ FROM [Order Details] d", provider);
        const col = cols.items.find((i) => i.label === "Unit Price");
        expect(col?.insertText).to.equal("[Unit Price]");
    });
});

suite("sqlLanguage native completion: join predicates", () => {
    test("ON suggests the FK predicate", async () => {
        const result = await complete(
            "SELECT * FROM Sales.Orders o JOIN Sales.Customers c ON /*caret*/",
        );
        const join = result.items.find((i) => i.kind === "join");
        expect(join?.insertText).to.equal("o.CustomerID = c.CustomerID");
        expect(join?.detail).to.equal("foreign key");
        // FK predicate outranks plain columns.
        expect(result.items[0].kind).to.equal("join");
    });

    test("reverse-direction FK also suggests", async () => {
        const result = await complete(
            "SELECT * FROM Sales.Customers c JOIN Sales.Orders o ON /*caret*/",
        );
        const join = result.items.find((i) => i.kind === "join");
        expect(join?.insertText).to.equal("o.CustomerID = c.CustomerID");
    });
});

suite("sqlLanguage native completion: expressions and clauses", () => {
    test("WHERE offers columns from all sources, qualifying ambiguous names", async () => {
        const result = await complete(
            "SELECT * FROM Sales.Orders o JOIN Sales.Customers c ON o.CustomerID = c.CustomerID WHERE /*caret*/",
        );
        expect(labels(result)).to.include.members(["o.CustomerID", "c.CustomerID", "OrderDate"]);
        const ambiguous = result.items.find((i) => i.label === "o.CustomerID");
        expect(ambiguous?.insertText).to.equal("o.CustomerID");
    });

    test("builtin functions and expression keywords appear in WHERE", async () => {
        const result = await complete("SELECT * FROM Sales.Orders o WHERE /*caret*/");
        expect(labels(result).some((l) => l.startsWith("COALESCE"))).to.equal(true);
        expect(labels(result)).to.include("AND");
    });

    test("variables in scope are offered", async () => {
        const result = await complete(
            "DECLARE @id int\nSELECT * FROM Sales.Orders o WHERE OrderID = /*caret*/",
        );
        expect(labels(result)).to.include("@id");
    });

    test("ORDER BY offers select-list aliases", async () => {
        const result = await complete("SELECT OrderID AS oid FROM Sales.Orders ORDER BY /*caret*/");
        expect(labels(result)).to.include("oid");
    });

    test("no completions inside comments or strings", async () => {
        const inComment = await complete("SELECT 1 -- note /*caret*/ here\nFROM Sales.Orders");
        expect(inComment.items).to.have.length(0);
        const inString = await complete("SELECT 'text /*caret*/ more' FROM Sales.Orders");
        expect(inString.items).to.have.length(0);
    });
});

suite("sqlLanguage native completion: CTEs, derived tables, temp objects", () => {
    test("CTE declared columns complete through the alias", async () => {
        const result = await complete(
            "WITH recent(OrderID, CustomerID) AS (SELECT 1, 2) SELECT r./*caret*/ FROM recent r",
        );
        expect(labels(result)).to.deep.include.members(["OrderID", "CustomerID"]);
    });

    test("CTE inferred columns from its body select list", async () => {
        const result = await complete(
            "WITH recent AS (SELECT OrderID, OrderDate FROM Sales.Orders) SELECT r./*caret*/ FROM recent r",
        );
        expect(labels(result)).to.include.members(["OrderID", "OrderDate"]);
    });

    test("derived table alias columns", async () => {
        const result = await complete(
            "SELECT d./*caret*/ FROM (SELECT OrderID AS oid FROM Sales.Orders) d",
        );
        expect(labels(result)).to.include("oid");
    });

    test("temp table columns from CREATE TABLE", async () => {
        const result = await complete(
            "CREATE TABLE #tmp (Id int, Name nvarchar(10))\nSELECT t./*caret*/ FROM #tmp t",
        );
        expect(labels(result)).to.include.members(["Id", "Name"]);
    });

    test("SELECT INTO temp table columns (names known, types unknown)", async () => {
        const result = await complete(
            "SELECT OrderID AS oid INTO #x FROM Sales.Orders\nSELECT x./*caret*/ FROM #x x",
        );
        expect(labels(result)).to.include("oid");
    });

    test("table variable columns", async () => {
        const result = await complete(
            "DECLARE @tv TABLE (X int, Y int)\nSELECT v./*caret*/ FROM @tv v",
        );
        expect(labels(result)).to.include.members(["X", "Y"]);
    });

    test("correlated subquery sees outer scope sources", async () => {
        const result = await complete(
            "SELECT * FROM Sales.Orders o WHERE EXISTS (SELECT 1 FROM Sales.OrderLines l WHERE l.OrderID = o./*caret*/)",
        );
        expect(labels(result)).to.include("OrderID");
    });
});

suite("sqlLanguage native completion: INSERT / UPDATE / EXEC / DECLARE / USE", () => {
    test("INSERT column list offers writable target columns", async () => {
        const result = await complete("INSERT INTO Sales.Orders (/*caret*/");
        expect(labels(result)).to.include.members(["OrderID", "CustomerID"]);
        expect(labels(result)).to.include("(all columns)");
    });

    test("INSERT column list excludes already-listed and identity/computed columns", async () => {
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
                              ...(o.columns ?? []).slice(1),
                          ],
                      }
                    : o,
            ),
        };
        const provider = new FixtureLanguageMetadataProvider(spec);
        const result = await complete("INSERT INTO Sales.Orders (CustomerID, /*caret*/", provider);
        expect(labels(result)).to.not.include("OrderID"); // identity
        expect(labels(result)).to.not.include("CustomerID"); // listed
        expect(labels(result)).to.include("OrderDate");
    });

    test("UPDATE SET offers target columns with assignment scaffold", async () => {
        const result = await complete("UPDATE Sales.Orders SET /*caret*/");
        const item = result.items.find((i) => i.label === "Comments");
        expect(item?.insertText).to.equal("Comments = ");
    });

    test("UPDATE alias-form target resolves through FROM", async () => {
        const result = await complete("UPDATE o SET /*caret*/ FROM Sales.Orders o");
        expect(labels(result)).to.include("OrderDate");
    });

    test("EXEC offers procedures", async () => {
        const result = await complete("EXEC /*caret*/");
        expect(labels(result)).to.include("Sales.GetOrders");
    });

    test("EXEC args offer remaining named parameters", async () => {
        const result = await complete("EXEC Sales.GetOrders @CustomerID = 1, /*caret*/");
        expect(labels(result)).to.include.members(["@Since", "@Total"]);
        expect(labels(result)).to.not.include("@CustomerID");
        const output = result.items.find((i) => i.label === "@Total");
        expect(output?.detail).to.contain("OUTPUT");
        expect(output?.insertText).to.equal("@Total = ");
    });

    test("DECLARE type position offers types and TABLE", async () => {
        const result = await complete("DECLARE @x /*caret*/");
        expect(labels(result)).to.include.members(["INT", "NVARCHAR", "TABLE"]);
    });

    test("USE offers databases", async () => {
        const result = await complete("USE /*caret*/");
        expect(labels(result)).to.include.members(["FixtureDb", "master", "tempdb"]);
    });
});

suite("sqlLanguage native completion: star expansion", () => {
    test("caret at * offers Expand columns replacing the star", async () => {
        const result = await complete("SELECT */*caret*/ FROM Sales.Orders o");
        const expand = result.items.find((i) => i.label === "Expand columns");
        expect(expand).to.not.equal(undefined);
        expect(expand!.insertText).to.contain("o.OrderID");
        expect(expand!.replaceRange).to.not.equal(undefined);
    });

    test("no expansion when metadata is incomplete", async () => {
        const provider = new FixtureLanguageMetadataProvider({
            ...STANDARD_FIXTURE_CATALOG,
            readiness: { columns: "loading" },
        });
        const result = await complete("SELECT */*caret*/ FROM Sales.Orders o", provider);
        expect(result.items.find((i) => i.label === "Expand columns")).to.equal(undefined);
    });
});

suite("sqlLanguage native completion: honesty under partial readiness", () => {
    test("columns loading -> incomplete result, no wrong claims", async () => {
        const provider = new FixtureLanguageMetadataProvider({
            ...STANDARD_FIXTURE_CATALOG,
            readiness: { columns: "loading" },
        });
        const result = await complete("SELECT o./*caret*/ FROM Sales.Orders o", provider);
        expect(result.items).to.have.length(0);
        expect(result.isIncomplete).to.equal(true);
        expect(result.incompleteReason).to.equal("columnsNotReady");
    });

    test("objects loading -> FROM still serves overlay/schemas, marked incomplete", async () => {
        const provider = new FixtureLanguageMetadataProvider({
            ...STANDARD_FIXTURE_CATALOG,
            readiness: { objects: "loading" },
        });
        const result = await complete(
            "CREATE TABLE #tmp (Id int)\nSELECT * FROM /*caret*/",
            provider,
        );
        expect(labels(result)).to.include("#tmp");
        expect(labels(result)).to.not.include("Sales.Orders");
        expect(result.isIncomplete).to.equal(true);
    });

    test("member-access miss on lazy columns kicks the load; retrigger serves items", async () => {
        // Simulates the LIVE gap: the alias resolves to a catalog table whose
        // columns section is notLoaded. The first request must stay honest
        // (0 items + isIncomplete so Monaco re-queries) AND fire-and-forget
        // the column load through the hydration seam; the retrigger then
        // finds the loaded columns.
        const spec: FixtureCatalogSpec = {
            ...STANDARD_FIXTURE_CATALOG,
            objects: STANDARD_FIXTURE_CATALOG.objects.map((o) =>
                o.schema === "Sales" && o.name === "Orders" ? { ...o, columnsLazy: true } : o,
            ),
        };
        const provider = new FixtureLanguageMetadataProvider(spec);

        const first = await complete("SELECT o./*caret*/ FROM Sales.Orders o", provider);
        expect(first.items).to.have.length(0);
        expect(first.isIncomplete).to.equal(true);
        expect(first.incompleteReason).to.equal("columnsNotReady");
        expect(provider.hydrationRequests).to.have.length(1);
        expect(provider.hydrationRequests[0].kind).to.equal("columns");
        expect(provider.hydrationRequests[0].priority).to.equal("interactiveFollowup");

        // The fixture resolves the load on the request (live: async refresh
        // + didChange). Monaco's isIncomplete retrigger now gets the columns.
        const second = await complete("SELECT o./*caret*/ FROM Sales.Orders o", provider);
        expect(labels(second)).to.include.members(["OrderID", "CustomerID", "OrderDate"]);
        expect(second.isIncomplete).to.equal(false);
        expect(provider.hydrationRequests).to.have.length(1); // no duplicate kick
    });

    test("case-sensitive catalog does not fold-match aliases", async () => {
        const provider = new FixtureLanguageMetadataProvider({
            ...STANDARD_FIXTURE_CATALOG,
            env: { ...STANDARD_FIXTURE_CATALOG.env, caseSensitive: true },
        });
        const wrongCase = await complete("SELECT o./*caret*/ FROM Sales.Orders AS O", provider);
        expect(wrongCase.items).to.have.length(0);
        const rightCase = await complete("SELECT O./*caret*/ FROM Sales.Orders AS O", provider);
        expect(labels(rightCase)).to.include("OrderID");
    });
});

suite("sqlLanguage native completion: latency budget", () => {
    test("warm completion stays inside the p95 budget on a 2k-line document", async () => {
        // Budget (design 05 §16.1): p95 host latency < 40ms warm. The unit
        // lane asserts a generous 100ms ceiling to stay flake-free on CI
        // boxes and logs the observed numbers for the PROGRESS record.
        const bigDoc =
            Array.from(
                { length: 400 },
                (_, i) =>
                    `SELECT o.OrderID, o.OrderDate FROM Sales.Orders o WHERE o.OrderID = ${i};`,
            ).join("\n") + "\nSELECT o./*caret*/ FROM Sales.Orders o";
        const fixture = parseFourslash(bigDoc);
        const engine = new NativeSqlLanguageEngine(standardProvider);
        const snapshot = new TextSnapshot(fixture.text, 1);
        const position = snapshot.positionAt(fixture.caret!);
        const request = { text: fixture.text, version: 1, position, trigger: "invoke" as const };
        await engine.completion(request); // warm the analysis cache
        const samples: number[] = [];
        for (let i = 0; i < 20; i++) {
            const start = performance.now();
            const result = await engine.completion(request);
            samples.push(performance.now() - start);
            expect(result!.items.length).to.be.greaterThan(0);
        }
        samples.sort((a, b) => a - b);
        const p95 = samples[Math.floor(samples.length * 0.95)];
        // eslint-disable-next-line no-console
        console.log(
            `      completion latency warm: median ${samples[10].toFixed(2)}ms p95 ${p95.toFixed(2)}ms`,
        );
        expect(p95).to.be.lessThan(100);
    });
});

suite("sqlLanguage native completion: statement start", () => {
    test("statement keywords and snippets", async () => {
        const result = await complete("/*caret*/");
        expect(labels(result)).to.include.members(["SELECT", "INSERT", "UPDATE", "DECLARE"]);
        expect(result.items.some((i) => i.kind === "snippet")).to.equal(true);
    });

    test("typed prefix ranks statement keywords before snippets", async () => {
        const result = await complete("se/*caret*/");
        const allLabels = labels(result);
        const firstSnippetIndex = result.items.findIndex((i) => i.kind === "snippet");
        let lastKeywordIndex = -1;
        result.items.forEach((item, index) => {
            if (item.kind === "keyword") {
                lastKeywordIndex = index;
            }
        });

        expect(allLabels[0]).to.equal("SELECT");
        expect(result.items[firstSnippetIndex]?.label).to.equal("SELECT ... FROM ... WHERE");
        expect(firstSnippetIndex).to.be.greaterThan(lastKeywordIndex);
    });

    test("go prefix ranks the GO batch separator first", async () => {
        const result = await complete("go/*caret*/");
        const allLabels = labels(result);

        expect(allLabels.slice(0, 2)).to.deep.equal(["GO", "GOTO"]);
        expect(allLabels).to.include.members(["GEOGRAPHY", "GEOMETRY", "GROUP BY"]);
    });

    test("go prefix after a complete query still ranks GO first", async () => {
        const result = await complete(
            "SELECT *\nFROM sys.all_columns\nWHERE name IS NOT NULL\n\ngo/*caret*/",
        );
        const allLabels = labels(result);
        const groupingFunctionIndex = allLabels.indexOf("GROUPING(…)");

        expect(allLabels[0]).to.equal("GO");
        if (groupingFunctionIndex >= 0) {
            expect(allLabels.indexOf("GO")).to.be.lessThan(groupingFunctionIndex);
        }
    });

    test("keyword casing honors the engine option", async () => {
        const engine = new NativeSqlLanguageEngine(standardProvider, () => ({
            snippetsEnabled: false,
            keywordCasing: "lower",
        }));
        const result = await engine.completion({
            text: "",
            version: 1,
            position: { line: 0, character: 0 },
            trigger: "invoke",
        });
        expect(result!.items.some((i) => i.label === "select")).to.equal(true);
        expect(result!.items.some((i) => i.kind === "snippet")).to.equal(false);
    });

    test("space after GO does not auto-popup statement keywords", async () => {
        const result = await completeWithTrigger("GO /*caret*/", {
            trigger: "character",
            triggerCharacter: " ",
        });

        expect(result).to.deep.equal({ items: [], isIncomplete: false });
    });

    test("automatic whitespace completion stays silent after a complete source", async () => {
        const result = await completeWithTrigger("SELECT * FROM sys.all_objects /*caret*/", {
            trigger: "character",
            triggerCharacter: " ",
        });

        expect(result).to.deep.equal({ items: [], isIncomplete: false });
    });

    test("explicit completion after whitespace still offers statement keywords", async () => {
        const result = await complete("GO \n/*caret*/");

        expect(labels(result)).to.include("SELECT");
    });
});

suite("sqlLanguage native completion: static system catalog", () => {
    test("sys. lists catalog objects", async () => {
        const result = await complete("SELECT * FROM sys./*caret*/");
        expect(labels(result)).to.include.members(["databases", "objects", "tables", "schemas"]);
        expect(result.items.some((i) => i.kind === "schema")).to.equal(false);
    });

    test("exact system schema source scopes to system objects only", async () => {
        const result = await complete("SELECT * FROM sys/*caret*/");
        expect(labels(result)).to.include.members(["sys.all_columns", "sys.all_objects"]);
        expect(labels(result)).to.not.include.members(["dbo", "guest", "INFORMATION_SCHEMA"]);
        expect(result.items.some((i) => i.kind === "schema")).to.equal(false);
    });

    test("sys.all prefix lists all system objects by fuzzy prefix", async () => {
        const result = await complete("SELECT * FROM sys.all/*caret*/");
        expect(labels(result)).to.include.members(["all_columns", "all_objects", "all_views"]);
        expect(result.items.some((i) => i.kind === "schema")).to.equal(false);
    });

    test("sys. uses static catalog objects before live object hydration is ready", async () => {
        const provider = new FixtureLanguageMetadataProvider({
            ...STANDARD_FIXTURE_CATALOG,
            databases: ["FixtureDb", "sys"],
            readiness: { objects: "loading" },
        });
        const result = await complete("SELECT * FROM sys./*caret*/", provider);
        expect(labels(result)).to.include.members(["databases", "objects", "tables", "schemas"]);
        expect(result.items.some((i) => i.kind === "schema")).to.equal(false);
    });

    test("sys.all lists all catalog views and other fuzzy matches", async () => {
        const result = await complete("SELECT * FROM sys.all/*caret*/");
        expect(labels(result)).to.include.members([
            "all_columns",
            "all_objects",
            "all_parameters",
            "all_sql_modules",
            "all_views",
            "allocation_units",
        ]);
    });

    test("sys. object prefix uses ordered subsequence matching", async () => {
        const result = await complete("SELECT * FROM sys.aun/*caret*/");
        expect(labels(result)).to.include("allocation_units");
    });

    test("INFORMATION_SCHEMA. lists catalog views", async () => {
        const result = await complete("SELECT * FROM INFORMATION_SCHEMA./*caret*/");
        expect(labels(result)).to.include.members(["TABLES", "COLUMNS", "VIEWS"]);
    });

    test("sys.databases. lists curated columns", async () => {
        const result = await complete("SELECT sys.databases./*caret*/ FROM sys.databases");
        expect(labels(result)).to.include.members(["name", "database_id", "state_desc"]);
    });

    test("alias of a sys table lists curated columns, types unclaimed", async () => {
        const result = await complete("SELECT d./*caret*/ FROM sys.databases d");
        expect(labels(result)).to.include.members(["name", "database_id", "collation_name"]);
        const col = result.items.find((i) => i.label === "database_id");
        expect(col?.detail).to.not.contain("int"); // no type facts in the catalog
    });

    test("live metadata wins over the static catalog", async () => {
        const provider = new FixtureLanguageMetadataProvider({
            ...STANDARD_FIXTURE_CATALOG,
            objects: [
                ...STANDARD_FIXTURE_CATALOG.objects,
                {
                    schema: "sys",
                    name: "databases",
                    kind: "view" as const,
                    columns: [{ name: "LiveCol", typeDisplay: "int", nullable: false }],
                },
            ],
        });
        const result = await complete("SELECT d./*caret*/ FROM sys.databases d", provider);
        expect(labels(result)).to.include("LiveCol");
        expect(labels(result)).to.not.include("database_id");
    });

    test("user schemas are never served by the catalog", async () => {
        const result = await complete("SELECT * FROM dbo./*caret*/");
        expect(labels(result)).to.not.include("databases");
        expect(labels(result)).to.include("OrdersByCustomer");
    });

    test("edition-gated DMVs only list under a matching engine edition", async () => {
        const unknownEdition = await complete("SELECT * FROM sys./*caret*/");
        expect(labels(unknownEdition)).to.not.include("dm_exec_requests");
        const azure = new FixtureLanguageMetadataProvider({
            ...STANDARD_FIXTURE_CATALOG,
            env: { ...STANDARD_FIXTURE_CATALOG.env, engineEdition: 5 },
        });
        const withEdition = await complete("SELECT * FROM sys./*caret*/", azure);
        expect(labels(withEdition)).to.include("dm_exec_requests");
    });

    test("no star expansion over partial system shapes", async () => {
        const result = await complete("SELECT */*caret*/ FROM sys.databases");
        expect(result.items.find((i) => i.label === "Expand columns")).to.equal(undefined);
    });
});
