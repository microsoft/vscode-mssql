/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
// A user-defined scalar function must be schema qualified, so a one-part call can only name a
// built-in. Aggregates and window functions are separate catalogs and are never judged here, and a
// qualified name is a catalog object validated by the object rules instead.
const {
    CatalogSemanticBinder,
    ImmutableTextSnapshot,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
} = require("../../../dist/index.js");

const catalog = {
    environment: { currentDatabase: "db", defaultSchema: "dbo" },
    schemas: [{ database: "db", name: "dbo" }],
    databases: [{ name: "db" }],
    objects: [
        {
            ref: { id: "fn", database: "db" },
            database: "db",
            schema: "dbo",
            name: "PriceWithTax",
            kind: "scalarFunction",
        },
        {
            ref: { id: "t", database: "db" },
            database: "db",
            schema: "dbo",
            name: "Orders",
            kind: "table",
        },
    ],
    parameters: new Map([["fn", []]]),
    columns: new Map([["t", [{ name: "Total", typeDisplay: "money" }]]]),
};

async function analyze(sql, patch = {}) {
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        new InMemoryMetadataProvider({ ...catalog, ...patch }),
    );
    const snapshot = await runtime.open("file:///built-in-functions.sql", 1, sql);
    if (!patch.allowSyntaxDiagnostics) assert.deepEqual(snapshot.syntax.diagnostics, []);
    return snapshot.semantics.diagnostics.map(({ code, message, severity, range }) => ({
        code,
        message,
        severity,
        text: sql.slice(range.start, range.end),
    }));
}

const named = (diagnostics) =>
    diagnostics.filter(({ code }) => code === "NotRecognizedFunctionName");

suite("T-SQL built-in function name validation", () => {
    // Exact output for a one-part call that names no built-in.
    test("reports an unknown one-part call with exact output", async () => {
        assert.deepEqual(await analyze("SELECT Bogus(1);"), [
            {
                code: "NotRecognizedFunctionName",
                message: "'Bogus' is not a recognized built-in function name.",
                severity: "error",
                text: "Bogus",
            },
        ]);
    });

    // The catalog covers scalar built-ins across the supported engine profiles.
    test("accepts built-in scalar functions", async () => {
        for (const sql of [
            "SELECT LEN('a');",
            "SELECT ISNULL(1, 2);",
            "SELECT GETDATE();",
            "SELECT DATEADD(day, 1, GETDATE());",
            "SELECT NEWID();",
            "SELECT JSON_VALUE('{}', '$.a');",
            "SELECT AI_GENERATE_EMBEDDINGS('a' USE MODEL m);",
        ]) {
            assert.deepEqual(named(await analyze(sql)), [], sql);
        }
    });

    // A schema-qualified name is a catalog object, so this rule never judges it.
    test("never judges a qualified name", async () => {
        for (const sql of [
            "SELECT dbo.PriceWithTax();",
            "SELECT dbo.Missing();",
            "SELECT db.dbo.Missing();",
        ]) {
            assert.deepEqual(named(await analyze(sql)), [], sql);
        }
        // An unqualified user function is not resolvable in T-SQL, so it is reported.
        assert.deepEqual(
            named(await analyze("SELECT PriceWithTax();")).map(({ text }) => text),
            ["PriceWithTax"],
        );
    });

    // Aggregates and window functions belong to separate catalogs.
    test("never judges an aggregate or window function", async () => {
        for (const sql of [
            "SELECT COUNT(*) FROM dbo.Orders;",
            "SELECT SUM(Total) FROM dbo.Orders;",
            "SELECT MIN(Total), MAX(Total) FROM dbo.Orders;",
            "SELECT ROW_NUMBER() OVER (ORDER BY Total) FROM dbo.Orders;",
            "SELECT RANK() OVER (ORDER BY Total) FROM dbo.Orders;",
            "SELECT LAG(Total) OVER (ORDER BY Total) FROM dbo.Orders;",
            "SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY Total) OVER () FROM dbo.Orders;",
        ]) {
            assert.deepEqual(named(await analyze(sql)), [], sql);
        }
    });

    // Keyword-driven built-ins keep their own syntax and never become a bare call.
    test("never judges a keyword built-in form", async () => {
        for (const sql of [
            "SELECT CAST(1 AS int);",
            "SELECT CONVERT(int, '1');",
            "SELECT TRIM(' a ');",
            "SELECT NEXT VALUE FOR dbo.Seq;",
            "SELECT CURRENT_TIMESTAMP;",
        ]) {
            assert.deepEqual(named(await analyze(sql)), [], sql);
        }
    });

    // A quoted name keeps its written spelling in the message and still resolves case-insensitively.
    test("handles quoted and case-varied names", async () => {
        assert.deepEqual(
            named(await analyze("SELECT [Bogus](1);")).map(({ message, text }) => [message, text]),
            [["'[Bogus]' is not a recognized built-in function name.", "[Bogus]"]],
        );
        assert.deepEqual(named(await analyze("SELECT getdate();")), []);
        assert.deepEqual(named(await analyze("SELECT [LEN]('a');")), []);
    });

    // Damaged input never invents an unrecognized function.
    test("stays silent on malformed editor input", async () => {
        for (const sql of ["SELECT Bogus(", "SELECT Bogus(1", "SELECT ("]) {
            assert.deepEqual(named(await analyze(sql, { allowSyntaxDiagnostics: true })), [], sql);
        }
    });

    // A member call keeps its receiver, so it is never treated as a bare function call.
    test("never judges a member call", async () => {
        assert.deepEqual(named(await analyze("DECLARE @x xml; SELECT @x.query('.');")), []);
    });
});

suite("T-SQL built-in function name incremental equivalence", () => {
    // Incremental analysis of the same final text and generation must equal a fresh analysis.
    test("matches a fresh analysis after an edit", async () => {
        const service = new LezerSyntaxService();
        const binder = new CatalogSemanticBinder();
        const provider = new InMemoryMetadataProvider(catalog);
        const uri = "file:///built-in-incremental.sql";
        const first = "SELECT 1;\nGO\nSELECT LEN('a');\n";
        const final = "SELECT 1;\nGO\nSELECT LENN('a');\n";
        const initialSyntax = service.parse(new ImmutableTextSnapshot(uri, 1, first));
        const initial = binder.bind({ syntax: initialSyntax, metadata: provider.pin() });
        assert.deepEqual(initial.diagnostics, []);
        const change = {
            start: first.indexOf("LEN") + "LEN".length,
            end: first.indexOf("LEN") + "LEN".length,
            text: "N",
        };
        const updatedSyntax = service.update(
            initialSyntax,
            new ImmutableTextSnapshot(uri, 2, final),
            [change],
        );
        const updated = binder.update(initial, {
            syntax: updatedSyntax,
            metadata: provider.pin(),
            previous: initial,
            changedRanges: updatedSyntax.changedRanges,
        });
        const fresh = binder.bind({
            syntax: service.parse(new ImmutableTextSnapshot(uri, 2, final)),
            metadata: provider.pin(),
        });
        const normalize = (snapshot) =>
            snapshot.diagnostics
                .map(({ code, message, range }) => `${code}:${range.start}:${range.end}:${message}`)
                .sort();
        assert.deepEqual(normalize(updated), normalize(fresh));
        assert.equal(normalize(fresh).length, 1);
    });
});
