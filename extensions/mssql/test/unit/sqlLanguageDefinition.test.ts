/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * B12 / LS-4 native definition suite (design 05 §13.4): routing per bound
 * symbol kind — script-local symbols (aliases via token-level declaration
 * lookup, variables incl. batch-visible ones, CTEs, temp tables, table
 * variables, derived-table columns) navigate IN-DOCUMENT with exact ranges;
 * catalog objects return SCRIPTED virtual content (module text for
 * views/procs, synthesized CREATE TABLE for tables) with column/parameter
 * anchors; honesty mirrors hover (USE switch, ambiguity, offline, encrypted
 * modules, reserved-word builtins).
 */

import { expect } from "chai";
import { DefinitionLocationResult } from "../../src/sqlLanguage/api";
import { TextSnapshot } from "../../src/sqlLanguage/core/text/textSnapshot";
import { NativeSqlLanguageEngine } from "../../src/sqlLanguage/host/nativeEngine";
import { LS0_NATIVE_CAPABILITIES } from "../../src/sqlLanguage/host/router";
import {
    FixtureCatalogSpec,
    FixtureLanguageMetadataProvider,
} from "../../src/sqlLanguage/provider/fixtureProvider";
import { NullLanguageMetadataProvider } from "../../src/sqlLanguage/provider/nullProvider";
import { ISqlLanguageMetadataProvider } from "../../src/sqlLanguage/provider/types";
import { FourslashFixture, parseFourslash } from "../../src/sqlLanguage/testSupport/fourslash";
import { STANDARD_FIXTURE_CATALOG } from "../../src/sqlLanguage/testSupport/fixtureCatalog";

const standardProvider = new FixtureLanguageMetadataProvider(STANDARD_FIXTURE_CATALOG);

const MODULE_CATALOG: FixtureCatalogSpec = {
    ...STANDARD_FIXTURE_CATALOG,
    objects: [
        ...STANDARD_FIXTURE_CATALOG.objects,
        {
            schema: "dbo",
            name: "OrderCount",
            kind: "scalarFunction",
            parameters: [
                { ordinal: 0, name: "", typeDisplay: "int", isOutput: false },
                { ordinal: 1, name: "@CustomerID", typeDisplay: "int", isOutput: false },
            ],
            definition:
                "CREATE FUNCTION dbo.OrderCount (@CustomerID int)\nRETURNS int\nAS\nBEGIN RETURN 1; END;",
        },
        {
            schema: "dbo",
            name: "SecretProc",
            kind: "procedure",
            definitionUnavailable: "encrypted",
        },
        // No definition text: the fixture's lazy read yields "notLoaded",
        // exactly what a session-less (offline) sys.sql_modules read maps to.
        { schema: "dbo", name: "NoTextView", kind: "view" },
    ],
};
const moduleProvider = new FixtureLanguageMetadataProvider(MODULE_CATALOG);

/**
 * Provider double for the CACHE-6 offline honesty check: same catalog, but
 * the pinned view exposes NO getDefinition seam (no metadata session — the
 * offline acquisition path). The engine must refuse honestly, never serve a
 * blank or fabricated module body.
 */
function providerWithoutLazyReads(spec: FixtureCatalogSpec): ISqlLanguageMetadataProvider {
    const base = new FixtureLanguageMetadataProvider(spec);
    const pin = (): ReturnType<FixtureLanguageMetadataProvider["pin"]> => {
        const view = base.pin();
        return {
            generation: view.generation,
            env: view.env,
            readiness: view.readiness,
            resolveObject: (parts) => view.resolveObject(parts),
            getObject: (ref) => view.getObject(ref),
            getColumns: (ref) => view.getColumns(ref),
            getParameters: (ref) => view.getParameters(ref),
            fkFrom: (ref) => view.fkFrom(ref),
            fkTo: (ref) => view.fkTo(ref),
            searchObjects: (query) => view.searchObjects(query),
            listSchemas: () => view.listSchemas(),
            // getDefinition deliberately ABSENT — no session to read from.
        };
    };
    return {
        generation: base.generation,
        env: () => base.env(),
        readiness: () => base.readiness(),
        pin,
        databases: () => base.databases(),
        onDidChange: (listener) => base.onDidChange(listener),
    };
}

interface DefinitionRun {
    readonly result: DefinitionLocationResult | undefined;
    readonly fixture: FourslashFixture;
    readonly snapshot: TextSnapshot;
}

async function definitionAt(
    source: string,
    provider: ISqlLanguageMetadataProvider = standardProvider,
): Promise<DefinitionRun> {
    const fixture = parseFourslash(source);
    if (fixture.caret === undefined) {
        throw new Error("fixture needs /*caret*/");
    }
    const engine = new NativeSqlLanguageEngine(provider);
    const snapshot = new TextSnapshot(fixture.text, 1);
    const result = await engine.definition({
        text: fixture.text,
        version: 1,
        position: snapshot.positionAt(fixture.caret),
    });
    return { result, fixture, snapshot };
}

/** Assert an in-document range whose START equals the /*def*​/ marker. */
function expectRangeStartAtDef(run: DefinitionRun, length?: number): void {
    const def = run.fixture.markers.get("def");
    expect(def, "fixture needs /*def*/").to.not.equal(undefined);
    expect(run.result, "expected a definition").to.not.equal(undefined);
    expect(run.result!.range, "expected an in-document range").to.not.equal(undefined);
    const start = run.snapshot.offsetAt(run.result!.range!.start);
    expect(start, "range start").to.equal(def);
    if (length !== undefined) {
        const end = run.snapshot.offsetAt(run.result!.range!.end);
        expect(end - start, "range length").to.equal(length);
    }
}

/** Assert an in-document range that CONTAINS the /*def*​/ marker. */
function expectRangeCoveringDef(run: DefinitionRun): void {
    const def = run.fixture.markers.get("def");
    expect(def, "fixture needs /*def*/").to.not.equal(undefined);
    expect(run.result?.range, "expected an in-document range").to.not.equal(undefined);
    const start = run.snapshot.offsetAt(run.result!.range!.start);
    const end = run.snapshot.offsetAt(run.result!.range!.end);
    expect(start <= def! && def! <= end, `range [${start},${end}] should cover ${def}`).to.equal(
        true,
    );
}

function expectNone(run: DefinitionRun): void {
    expect(run.result).to.equal(undefined);
}

function virtualOf(run: DefinitionRun): NonNullable<DefinitionLocationResult["virtualContent"]> {
    expect(run.result, "expected a definition").to.not.equal(undefined);
    expect(run.result!.virtualContent, "expected virtual content").to.not.equal(undefined);
    return run.result!.virtualContent!;
}

suite("sqlLanguage definition: aliases", () => {
    test("alias reference navigates to the alias declaration token", async () => {
        const run = await definitionAt("SELECT /*caret*/o.OrderID FROM Sales.Orders AS /*def*/o;");
        expectRangeStartAtDef(run, 1);
    });

    test("alias without AS", async () => {
        const run = await definitionAt("SELECT /*caret*/o.OrderID FROM Sales.Orders /*def*/o;");
        expectRangeStartAtDef(run, 1);
    });

    test("bracketed alias declaration", async () => {
        const run = await definitionAt(
            "SELECT /*caret*/o.OrderID FROM Sales.Orders AS /*def*/[o];",
        );
        expectRangeStartAtDef(run, 3);
    });

    test("caret on the alias declaration itself resolves to itself", async () => {
        const run = await definitionAt("SELECT o.OrderID FROM Sales.Orders AS /*def*//*caret*/o;");
        expectRangeStartAtDef(run, 1);
    });

    test("alias in a WHERE clause qualifier", async () => {
        const run = await definitionAt(
            "SELECT 1 FROM Sales.Orders AS /*def*/o WHERE /*caret*/o.OrderID = 1;",
        );
        expectRangeStartAtDef(run, 1);
    });
});

suite("sqlLanguage definition: variables", () => {
    test("variable usage → DECLARE span", async () => {
        const run = await definitionAt("DECLARE /*def*/@x int;\nSET /*caret*/@x = 1;");
        expectRangeStartAtDef(run);
    });

    test("variable declared in an earlier statement of the same batch", async () => {
        const run = await definitionAt("DECLARE /*def*/@x int;\nSELECT 1;\nSELECT /*caret*/@x;");
        expectRangeStartAtDef(run);
    });

    test("variables do NOT cross GO", async () => {
        const run = await definitionAt("DECLARE @x int;\nGO\nSELECT /*caret*/@x;");
        expectNone(run);
    });

    test("undeclared variable: none (never guess)", async () => {
        const run = await definitionAt("SELECT /*caret*/@nope;");
        expectNone(run);
    });

    test("system variables have no definition", async () => {
        const run = await definitionAt("SELECT /*caret*/@@ROWCOUNT;");
        expectNone(run);
    });

    test("table variable reference → DECLARE span", async () => {
        const run = await definitionAt(
            "DECLARE /*def*/@t TABLE (a int);\nSELECT * FROM /*caret*/@t;",
        );
        expectRangeStartAtDef(run);
    });
});

suite("sqlLanguage definition: CTEs, temp tables, script-local objects", () => {
    test("CTE reference → CTE declaration", async () => {
        const run = await definitionAt(
            "WITH /*def*/c AS (SELECT 1 AS x) SELECT * FROM /*caret*/c;",
        );
        expectRangeStartAtDef(run);
    });

    test("CTE column → declared column list entry", async () => {
        const run = await definitionAt("WITH c (/*def*/x) AS (SELECT 1) SELECT /*caret*/x FROM c;");
        expectRangeStartAtDef(run, 1);
    });

    test("temp table reference → creating CREATE TABLE statement", async () => {
        const run = await definitionAt(
            "CREATE TABLE /*def*/#t (a int);\nSELECT * FROM /*caret*/#t;",
        );
        expectRangeStartAtDef(run);
    });

    test("temp table column → exact column token in the CREATE", async () => {
        const run = await definitionAt(
            "CREATE TABLE #t (/*def*/a int);\nSELECT /*caret*/a FROM #t;",
        );
        expectRangeStartAtDef(run, 1);
    });

    test("session temp table (not created here): none", async () => {
        const run = await definitionAt("SELECT * FROM /*caret*/#session;");
        expectNone(run);
    });

    test("SELECT INTO temp target → the INTO statement", async () => {
        const run = await definitionAt(
            "SELECT OrderID AS id INTO /*def*/#x FROM Sales.Orders;\nSELECT * FROM /*caret*/#x;",
        );
        expectRangeCoveringDef(run);
    });

    test("UPDATE on a temp table: bare SET column navigates in-document", async () => {
        const run = await definitionAt(
            "CREATE TABLE #t (/*def*/a int);\nUPDATE #t SET /*caret*/a = 1;",
        );
        expectRangeStartAtDef(run, 1);
    });

    test("derived table column → the select item", async () => {
        const run = await definitionAt(
            "SELECT /*caret*/n FROM (SELECT CustomerName AS /*def*/n FROM Sales.Customers) d;",
        );
        expectRangeCoveringDef(run);
    });

    test("select alias in ORDER BY → the select item", async () => {
        const run = await definitionAt(
            "SELECT OrderID AS /*def*/total FROM Sales.Orders ORDER BY /*caret*/total;",
        );
        expectRangeCoveringDef(run);
    });
});

suite("sqlLanguage definition: scripted catalog tables", () => {
    test("table in FROM → synthesized CREATE TABLE virtual content", async () => {
        const run = await definitionAt("SELECT * FROM Sales./*caret*/Orders;");
        const virtual = virtualOf(run);
        expect(virtual.title).to.equal("Sales.Orders");
        expect(virtual.text).to.contain("CREATE TABLE Sales.Orders (");
        expect(virtual.cacheKey).to.equal("FixtureDb:1:create:1");
        expect(virtual.unavailableReason).to.equal(undefined);
        // Anchored at the object name on the CREATE line.
        expect(virtual.anchor).to.deep.equal({
            line: 2,
            character: "CREATE TABLE Sales.".length,
        });
    });

    test("unqualified table resolves through the catalog", async () => {
        const run = await definitionAt("SELECT * FROM /*caret*/Customers;");
        expect(virtualOf(run).title).to.equal("Sales.Customers");
    });

    test("default-schema preference on ambiguous one-part names", async () => {
        const run = await definitionAt("SELECT * FROM /*caret*/Orders;");
        expect(virtualOf(run).title).to.equal("dbo.Orders");
    });

    test("qualified column → CREATE TABLE anchored AT the column", async () => {
        const run = await definitionAt("SELECT o./*caret*/CustomerID FROM Sales.Orders o;");
        const virtual = virtualOf(run);
        expect(virtual.title).to.equal("Sales.Orders");
        expect(virtual.anchor).to.deep.equal({ line: 4, character: 4 });
    });

    test("unqualified column with a single source → column anchor", async () => {
        const run = await definitionAt("SELECT /*caret*/Comments FROM Sales.Orders;");
        expect(virtualOf(run).anchor).to.deep.equal({ line: 6, character: 4 });
    });

    test("schema-qualified column chain → column anchor", async () => {
        const run = await definitionAt("SELECT Sales.Orders./*caret*/OrderDate FROM Sales.Orders;");
        expect(virtualOf(run).anchor).to.deep.equal({ line: 5, character: 4 });
    });

    test("INSERT column-list entry → column anchor", async () => {
        const run = await definitionAt(
            "INSERT INTO Sales.Orders (/*caret*/CustomerID) VALUES (1);",
        );
        expect(virtualOf(run).anchor).to.deep.equal({ line: 4, character: 4 });
    });

    test("UPDATE SET bare column against the target table", async () => {
        const run = await definitionAt("UPDATE Sales.Orders SET /*caret*/Comments = NULL;");
        expect(virtualOf(run).anchor).to.deep.equal({ line: 6, character: 4 });
    });

    test("UPDATE target table name itself scripts the table", async () => {
        const run = await definitionAt("UPDATE Sales./*caret*/Orders SET Comments = NULL;");
        expect(virtualOf(run).title).to.equal("Sales.Orders");
    });

    test("ambiguous unqualified column across two sources: none", async () => {
        const run = await definitionAt(
            "SELECT /*caret*/OrderID FROM Sales.Orders o JOIN Sales.OrderLines l ON l.OrderID = o.OrderID;",
        );
        expectNone(run);
    });

    test("unknown column: none (never guess)", async () => {
        const run = await definitionAt("SELECT /*caret*/Nope FROM Sales.Orders;");
        expectNone(run);
    });
});

suite("sqlLanguage definition: scripted modules", () => {
    test("view → stored definition text", async () => {
        const run = await definitionAt("SELECT * FROM Sales./*caret*/vOrderSummary;");
        const virtual = virtualOf(run);
        expect(virtual.title).to.equal("Sales.vOrderSummary");
        expect(virtual.text.startsWith("CREATE VIEW Sales.vOrderSummary")).to.equal(true);
        expect(virtual.anchor).to.deep.equal({
            line: 0,
            character: "CREATE VIEW Sales.".length,
        });
    });

    test("view column → the view's definition (module text)", async () => {
        const run = await definitionAt(
            "SELECT v./*caret*/CustomerName FROM Sales.vOrderSummary v;",
        );
        const virtual = virtualOf(run);
        expect(virtual.text.startsWith("CREATE VIEW")).to.equal(true);
        expect(virtual.anchor!.line).to.equal(0);
    });

    test("EXEC procedure name → stored procedure definition", async () => {
        const run = await definitionAt("EXEC Sales./*caret*/GetOrders;");
        const virtual = virtualOf(run);
        expect(virtual.title).to.equal("Sales.GetOrders");
        expect(virtual.text.startsWith("CREATE PROCEDURE Sales.GetOrders")).to.equal(true);
        expect(virtual.anchor).to.deep.equal({
            line: 0,
            character: "CREATE PROCEDURE Sales.".length,
        });
    });

    test("EXEC named argument → definition anchored at the parameter", async () => {
        const run = await definitionAt(
            "EXEC Sales.GetOrders @CustomerID = 1, /*caret*/@Total = @x OUTPUT;",
        );
        const virtual = virtualOf(run);
        const definition = STANDARD_FIXTURE_CATALOG.objects.find(
            (o) => o.name === "GetOrders",
        )!.definition!;
        expect(virtual.anchor).to.deep.equal({
            line: 0,
            character: definition.indexOf("@Total"),
        });
    });

    test("scalar function callee → stored function definition", async () => {
        const run = await definitionAt("SELECT dbo./*caret*/OrderCount(1);", moduleProvider);
        const virtual = virtualOf(run);
        expect(virtual.title).to.equal("dbo.OrderCount");
        expect(virtual.text.startsWith("CREATE FUNCTION dbo.OrderCount")).to.equal(true);
    });

    test("encrypted module: honest comment-only content, no fabricated body", async () => {
        const run = await definitionAt("EXEC dbo./*caret*/SecretProc;", moduleProvider);
        const virtual = virtualOf(run);
        expect(virtual.unavailableReason).to.equal("encrypted");
        expect(virtual.text).to.contain("encrypted");
        expect(virtual.text).to.not.contain("CREATE PROC");
    });

    test("offline lazy read (notLoaded): module text is a refusal, never blank (CACHE-6)", async () => {
        // A session-less module read maps to "notLoaded" (metadataService
        // catches and never throws); the definition path must surface that
        // as an honest comment document, not empty virtual content.
        const run = await definitionAt("SELECT * FROM dbo./*caret*/NoTextView;", moduleProvider);
        const virtual = virtualOf(run);
        expect(virtual.unavailableReason).to.equal("notLoaded");
        expect(virtual.text.trim().length).to.be.greaterThan(0);
        expect(virtual.text).to.contain("Cannot script dbo.NoTextView");
        expect(virtual.text).to.contain("not been loaded");
        expect(virtual.text).to.not.contain("CREATE VIEW");
    });

    test("no metadata session at all: module definition refuses as offline (CACHE-6)", async () => {
        const run = await definitionAt(
            "EXEC Sales./*caret*/GetOrders;",
            providerWithoutLazyReads(MODULE_CATALOG),
        );
        const virtual = virtualOf(run);
        expect(virtual.unavailableReason).to.equal("offline");
        expect(virtual.text).to.contain("no metadata connection");
        expect(virtual.text).to.not.contain("CREATE PROCEDURE");
    });

    test("offline never blocks SYNTHESIZED table scripts (no lazy read involved)", async () => {
        const run = await definitionAt(
            "SELECT * FROM Sales./*caret*/Orders;",
            providerWithoutLazyReads(MODULE_CATALOG),
        );
        const virtual = virtualOf(run);
        expect(virtual.unavailableReason).to.equal(undefined);
        expect(virtual.text).to.contain("CREATE TABLE Sales.Orders (");
    });

    test("synonym: honest unsupported content", async () => {
        const run = await definitionAt("SELECT * FROM dbo./*caret*/OrdersSynonym;");
        const virtual = virtualOf(run);
        expect(virtual.unavailableReason).to.equal("unsupported");
    });
});

suite("sqlLanguage definition: honesty ladder", () => {
    test("USE-switched statements make no catalog claims", async () => {
        const run = await definitionAt("USE OtherDb;\nGO\nSELECT * FROM Sales./*caret*/Orders;");
        expectNone(run);
    });

    test("USE back to the hydrated database restores catalog serving", async () => {
        const run = await definitionAt("USE FixtureDb;\nGO\nSELECT * FROM Sales./*caret*/Orders;");
        expect(virtualOf(run).title).to.equal("Sales.Orders");
    });

    test("local symbols still navigate under a switched database", async () => {
        const run = await definitionAt(
            "USE OtherDb;\nGO\nDECLARE /*def*/@x int;\nSELECT /*caret*/@x;",
        );
        expectRangeStartAtDef(run);
    });

    test("temp tables still navigate under a switched database", async () => {
        const run = await definitionAt(
            "USE OtherDb;\nGO\nCREATE TABLE /*def*/#t (a int);\nSELECT * FROM /*caret*/#t;",
        );
        expectRangeStartAtDef(run);
    });

    test("null provider: catalog names yield none", async () => {
        const run = await definitionAt(
            "SELECT * FROM Sales./*caret*/Orders;",
            new NullLanguageMetadataProvider(),
        );
        expectNone(run);
    });

    test("null provider: local symbols still resolve", async () => {
        const run = await definitionAt(
            "DECLARE /*def*/@x int;\nSELECT /*caret*/@x;",
            new NullLanguageMetadataProvider(),
        );
        expectRangeStartAtDef(run);
    });

    test("cross-database three-part names are refused", async () => {
        const run = await definitionAt("SELECT * FROM OtherDb.Sales./*caret*/Orders;");
        expectNone(run);
    });

    test("linked-server four-part names are refused", async () => {
        const run = await definitionAt("SELECT * FROM Srv.Db.Sales./*caret*/Orders;");
        expectNone(run);
    });

    test("reserved-word builtin callee (LEFT) is classified, not navigated", async () => {
        const run = await definitionAt(
            "SELECT /*caret*/LEFT(CustomerName, 2) FROM Sales.Customers;",
        );
        expectNone(run);
    });

    test("comments never navigate", async () => {
        const run = await definitionAt("SELECT 1; -- /*caret*/Sales.Orders");
        expectNone(run);
    });

    test("string literals never navigate", async () => {
        const run = await definitionAt("SELECT '/*caret*/Sales.Orders';");
        expectNone(run);
    });

    test("numbers never navigate", async () => {
        const run = await definitionAt("SELECT /*caret*/42;");
        expectNone(run);
    });

    test("whitespace between statements: none", async () => {
        const run = await definitionAt("SELECT 1;  /*caret*/  ");
        expectNone(run);
    });

    test("schema qualifier part alone has no definition target (v1)", async () => {
        const run = await definitionAt("SELECT * FROM /*caret*/Sales.Orders;");
        expectNone(run);
    });
});

suite("sqlLanguage definition: router capability", () => {
    test("definition graduated to preview in the capability table", () => {
        expect(LS0_NATIVE_CAPABILITIES.definition).to.equal("preview");
    });
});
