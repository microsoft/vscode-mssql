/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    TsqlLanguageFeatureService,
} = require("../../../dist/index.js");

const uri = "file:///signature.sql";

function catalog() {
    return new InMemoryMetadataProvider({
        environment: { currentDatabase: "db", defaultSchema: "dbo", caseSensitive: false },
        databases: [{ name: "db" }],
        schemas: [{ database: "db", name: "dbo" }],
        objects: [
            {
                ref: { id: "cust", database: "db" },
                database: "db",
                schema: "dbo",
                name: "Customers",
                kind: "table",
            },
            {
                ref: { id: "tvf", database: "db" },
                database: "db",
                schema: "dbo",
                name: "tvf_Split",
                kind: "tableFunction",
            },
        ],
        columns: new Map([
            [
                "cust",
                [
                    { name: "Id", typeDisplay: "int", nullable: false },
                    { name: "Name", typeDisplay: "nvarchar(100)", nullable: true },
                ],
            ],
        ]),
        parameters: new Map([
            ["tvf", [{ ordinal: 1, name: "@csv", typeDisplay: "nvarchar(max)" }]],
        ]),
    });
}

/** Places the cursor where `^` sits and asks for signature help there. */
async function helpAt(template) {
    const sql = template.replace("^", "");
    const offset = template.indexOf("^");
    const metadata = catalog();
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        metadata,
    );
    await runtime.open(uri, 1, sql);
    return new TsqlLanguageFeatureService(runtime, metadata).signatureHelp(uri, 1, offset);
}

suite("signature help contexts", () => {
    test("answers for a table-valued function used as a rowset", async () => {
        const help = await helpAt("SELECT * FROM dbo.tvf_Split(^) AS s;");
        assert.equal(help.signatures[0].label, "db.dbo.tvf_Split(@csv nvarchar(max))");
        assert.equal(help.activeParameter, 0);
    });

    test("answers for a rowset function the server ships", async () => {
        const help = await helpAt("SELECT * FROM OPENJSON(^);");
        assert.match(help.signatures[0].label, /^OPENJSON\(json_expression, \[path\]\)$/u);
    });

    // TOP is an operator, not a function: it is written `TOP (n) PERCENT WITH TIES`, so its label
    // shows that form rather than borrowing a call's parentheses. It still shares argument shape
    // and cursor tracking with calls, which is what lets signature help answer for it at all.
    test("answers for a parenthesized TOP expression", async () => {
        const help = await helpAt("SELECT TOP (^1) * FROM dbo.Customers;");
        assert.equal(help.signatures[0].label, "TOP (expression) [PERCENT] [WITH TIES]");
        assert.equal(help.activeParameter, 0);

        // PERCENT advances the argument the way a comma does in a call, so the caret past it
        // highlights the modifier rather than the row count.
        const percent = await helpAt("SELECT TOP (1) PERCENT^ * FROM dbo.Customers;");
        assert.equal(percent.activeParameter, 1);
    });

    test("answers while the target columns of an INSERT are being named", async () => {
        const first = await helpAt("INSERT INTO dbo.Customers (^) VALUES (1, 'a');");
        assert.equal(
            first.signatures[0].label,
            "INSERT INTO dbo.Customers (Id int NOT NULL, Name nvarchar(100) NULL)",
        );
        assert.match(first.signatures[0].documentation, /Name the target columns/u);
        assert.equal(first.activeParameter, 0);

        const second = await helpAt("INSERT INTO dbo.Customers (Id, ^) VALUES (1, 'a');");
        assert.equal(second.activeParameter, 1);
    });

    test("keeps naming columns apart from supplying values", async () => {
        const values = await helpAt("INSERT INTO dbo.Customers (Id) VALUES (^);");
        assert.match(values.signatures[0].label, /^INSERT INTO dbo\.Customers VALUES \(/u);
        assert.match(values.signatures[0].documentation, /Each VALUES expression/u);
    });

    test("stops answering once the column list is closed", async () => {
        assert.equal(await helpAt("INSERT INTO dbo.Customers (Id) ^VALUES (1);"), undefined);
    });

    test("answers for conversions the grammar models as their own expressions", async () => {
        const cast = await helpAt("SELECT CAST(^ AS int);");
        assert.equal(cast.signatures[0].label, "CAST(expression AS data_type)");
        assert.equal(cast.activeParameter, 0);

        const convert = await helpAt("SELECT CONVERT(int, ^);");
        assert.equal(convert.signatures[0].label, "CONVERT(data_type, expression, [style])");
        assert.equal(convert.activeParameter, 1);
    });

    test("the AS of a conversion advances the argument the way a comma does", async () => {
        const help = await helpAt("SELECT CAST(@v AS ^int);");
        assert.equal(help.activeParameter, 1);
    });

    test("a TRY_ conversion keeps its own spelling", async () => {
        const help = await helpAt("SELECT TRY_CONVERT(int, ^'1');");
        assert.match(help.signatures[0].label, /^TRY_CONVERT\(/u);
    });

    test("answers for statements that read as calls", async () => {
        const raise = await helpAt("RAISERROR(^'bad', 16, 1);");
        assert.equal(raise.signatures[0].label, "RAISERROR(message, severity, state, ...argument)");
        assert.equal(raise.activeParameter, 0);
        assert.equal((await helpAt("RAISERROR('bad', ^16, 1);")).activeParameter, 1);

        assert.match((await helpAt("THROW ^50000, 'x', 1;")).signatures[0].label, /^THROW\(/u);
        assert.match(
            (await helpAt("WAITFOR DELAY ^'00:00:05';")).signatures[0].label,
            /^WAITFOR\(/u,
        );
    });

    test("answers for expressions the grammar shapes itself", async () => {
        assert.match((await helpAt("SELECT TRIM(^' x ');")).signatures[0].label, /^TRIM\(/u);
        assert.match(
            (await helpAt("SELECT JSON_OBJECT(^);")).signatures[0].label,
            /^JSON_OBJECT\(\.\.\.key_value\)$/u,
        );
    });

    test("says nothing for a name it cannot describe", async () => {
        assert.equal(await helpAt("SELECT dbo.not_a_routine(^);"), undefined);
    });
});
