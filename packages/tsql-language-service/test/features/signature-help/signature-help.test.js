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

suite("T-SQL signature help", () => {
    // A stored-procedure call highlights the named argument rather than assuming positional order.
    test("describes catalog procedure parameters and follows named arguments", async () => {
        const { features, runtime } = createServices();
        const sql = "EXEC dbo.SaveOrder @OrderId = 1, @Note = ";
        await runtime.open("file:///procedure-signature.sql", 1, sql);

        const help = features.signatureHelp("file:///procedure-signature.sql", 1, sql.length);
        assert.equal(help.activeParameter, 1);
        assert.equal(
            help.signatures[0].label,
            "EXEC db.dbo.SaveOrder @OrderId int, @Note nvarchar(100) = DEFAULT, @Result int OUTPUT",
        );
        assert.match(help.signatures[0].parameters[1].documentation, /optional/u);
        assert.match(help.signatures[0].parameters[2].documentation, /Input\/output/u);
    });

    // The signature documentation states the return contract of the routine being called: every
    // stored procedure returns int, and an extended stored procedure cannot be described at all.
    test("states the return contract of the routine being called", async () => {
        const { features, runtime } = createServices();
        const procedure = "EXEC dbo.SaveOrder ";
        await runtime.open("file:///return-contract.sql", 1, procedure);
        assert.equal(
            features.signatureHelp("file:///return-contract.sql", 1, procedure.length).signatures[0]
                .documentation,
            "Stored procedures always return INT.",
        );

        const extended = "EXEC dbo.xp_LogEvent ";
        await runtime.open("file:///extended-contract.sql", 1, extended);
        assert.equal(
            features.signatureHelp("file:///extended-contract.sql", 1, extended.length)
                .signatures[0].documentation,
            "Parameter help is not supported for extended stored procedures.",
        );
    });

    // A user-defined function exposes catalog parameter names and advances after a top-level comma.
    test("describes catalog function parameters", async () => {
        const { features, runtime } = createServices();
        const sql = "SELECT dbo.PriceWithTax(10, ";
        await runtime.open("file:///function-signature.sql", 1, sql);

        const help = features.signatureHelp("file:///function-signature.sql", 1, sql.length);
        assert.equal(help.activeParameter, 1);
        assert.deepEqual(
            help.signatures[0].parameters.map(({ label }) => label),
            ["@price decimal(10,2)", "@rate decimal(5,2)"],
        );
    });

    // An explicit INSERT column list defines VALUES order, even when it differs from table order.
    test("uses explicit INSERT column order for value hints", async () => {
        const { features, runtime } = createServices();
        const sql = "INSERT INTO dbo.Orders (CreatedDate, Name) VALUES (GETDATE(), ";
        await runtime.open("file:///insert-explicit-signature.sql", 1, sql);

        const help = features.signatureHelp("file:///insert-explicit-signature.sql", 1, sql.length);
        assert.equal(help.activeParameter, 1);
        assert.deepEqual(
            help.signatures[0].parameters.map(({ label }) => label),
            ["CreatedDate datetime2 NULL", "Name nvarchar(50) NOT NULL"],
        );
    });

    // Without an explicit list, VALUES follows catalog ordinal order and skips generated columns.
    test("uses default insertable table order for INSERT value hints", async () => {
        const { features, runtime } = createServices();
        const sql = "INSERT INTO dbo.Orders VALUES (N'new', ";
        await runtime.open("file:///insert-default-signature.sql", 1, sql);

        const help = features.signatureHelp("file:///insert-default-signature.sql", 1, sql.length);
        assert.deepEqual(
            help.signatures[0].parameters.map(({ label }) => label),
            ["Name nvarchar(50) NOT NULL", "CreatedDate datetime2 NULL"],
        );
    });

    // Common built-ins retain useful signatures even though JSON functions have specialized nodes.
    test("describes built-in JSON function parameters", async () => {
        const { features, runtime } = createServices();
        const sql = "SELECT JSON_VALUE(JsonData, ";
        await runtime.open("file:///json-signature.sql", 1, sql);

        const help = features.signatureHelp("file:///json-signature.sql", 1, sql.length);
        assert.equal(help.activeParameter, 1);
        assert.equal(help.signatures[0].label, "JSON_VALUE(expression, path)");
    });

    // Routines declared earlier in the document provide signatures without catalog round trips.
    test("describes same-document procedure and function parameters", async () => {
        const { features, runtime } = createServices();
        const sql = `CREATE PROCEDURE dbo.LocalProc @first int, @second nvarchar(20) = NULL AS
SELECT 1;
GO
CREATE FUNCTION dbo.LocalFunction(@left int, @right int) RETURNS int AS
BEGIN RETURN @left + @right; END;
GO
EXEC dbo.LocalProc 1,
SELECT dbo.LocalFunction(1, `;
        await runtime.open("file:///local-signatures.sql", 1, sql);

        const procedureOffset = sql.indexOf("\nSELECT dbo.LocalFunction");
        const procedure = features.signatureHelp(
            "file:///local-signatures.sql",
            1,
            procedureOffset,
        );
        const routine = features.signatureHelp("file:///local-signatures.sql", 1, sql.length);

        assert.deepEqual(
            procedure.signatures[0].parameters.map(({ label }) => label),
            ["@first int", "@second nvarchar(20) = DEFAULT"],
        );
        assert.equal(procedure.activeParameter, 1);
        assert.deepEqual(
            routine.signatures[0].parameters.map(({ label }) => label),
            ["@left int", "@right int"],
        );
        assert.equal(routine.activeParameter, 1);
    });
});

function createServices() {
    const metadata = new InMemoryMetadataProvider({
        environment: { currentDatabase: "db", defaultSchema: "dbo", caseSensitive: false },
        schemas: [{ database: "db", name: "dbo" }],
        databases: [{ name: "db" }],
        objects: [
            object("procedure", "SaveOrder", "procedure"),
            { ...object("extended", "xp_LogEvent", "procedure"), extendedProcedure: true },
            object("function", "PriceWithTax", "scalarFunction"),
            object("table", "Orders", "table"),
        ],
        parameters: new Map([
            [
                "procedure",
                [
                    { ordinal: 1, name: "@OrderId", typeDisplay: "int" },
                    {
                        ordinal: 2,
                        name: "@Note",
                        typeDisplay: "nvarchar(100)",
                        hasDefault: true,
                    },
                    { ordinal: 3, name: "@Result", typeDisplay: "int", output: true },
                ],
            ],
            ["extended", [{ ordinal: 1, name: "@message", typeDisplay: "nvarchar(255)" }]],
            [
                "function",
                [
                    { ordinal: 1, name: "@price", typeDisplay: "decimal(10,2)" },
                    { ordinal: 2, name: "@rate", typeDisplay: "decimal(5,2)" },
                ],
            ],
        ]),
        columns: new Map([
            [
                "table",
                [
                    { name: "Id", typeDisplay: "int", identity: true, nullable: false },
                    { name: "Name", typeDisplay: "nvarchar(50)", nullable: false },
                    { name: "CreatedDate", typeDisplay: "datetime2", nullable: true },
                    { name: "Total", typeDisplay: "money", computed: true, nullable: true },
                ],
            ],
        ]),
    });
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        metadata,
    );
    return { runtime, features: new TsqlLanguageFeatureService(runtime, metadata) };
}

function object(id, name, kind) {
    return {
        ref: { id, database: "db" },
        database: "db",
        schema: "dbo",
        name,
        kind,
    };
}
