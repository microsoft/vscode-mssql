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
    TsqlColorizationService,
    TsqlLanguageFeatureService,
    formatMultipartName,
} = require("../../dist/index.js");

const uri = "file:///hostile-identifiers.sql";

function metadata() {
    return new InMemoryMetadataProvider({
        environment: { currentDatabase: "db", defaultSchema: "dbo" },
        databases: [{ name: "db" }],
        schemas: [{ database: "db", name: "My Schema" }],
        objects: [
            {
                ref: { id: "hostile-table", database: "db" },
                database: "db",
                schema: "My Schema",
                name: "Order]Items",
                kind: "table",
            },
            {
                ref: { id: "hostile-procedure", database: "db" },
                database: "db",
                schema: "My Schema",
                name: "Do-Thing",
                kind: "procedure",
            },
        ],
        columns: new Map([
            [
                "hostile-table",
                [
                    { name: "select", typeDisplay: "int", nullable: false },
                    { name: "na-me", typeDisplay: "nvarchar(20)", nullable: true },
                    { name: "金額$", typeDisplay: "money", nullable: true },
                ],
            ],
        ]),
        parameters: new Map([
            [
                "hostile-procedure",
                [{ ordinal: 1, name: "@input-value", typeDisplay: "int", output: false }],
            ],
        ]),
    });
}

async function open(sql) {
    const provider = metadata();
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        provider,
    );
    const snapshot = await runtime.open(uri, 1, sql);
    return {
        snapshot,
        features: new TsqlLanguageFeatureService(runtime, provider),
    };
}

suite("hostile identifier feature matrix", () => {
    // One realistic document drives binding, diagnostics, hover, catalog definition descriptors,
    // local definition/reference/rename, signature help, and semantic coloring. It includes a
    // space, hyphen, escaped bracket, reserved word, Unicode, $, and @ in their legal roles.
    test("keeps hostile catalog and local names consistent across features", async () => {
        const sql = [
            "DECLARE @välue int;",
            "SELECT o.[select], o.[na-me], o.[金額$], @välue",
            "FROM [My Schema].[Order]]Items] AS o",
            "WHERE o.[select] = @välue;",
            "EXEC [My Schema].[Do-Thing] @välue;",
        ].join("\n");
        const { features, snapshot } = await open(sql);

        assert.deepEqual(features.diagnostics(uri, 1), { syntax: [], semantic: [] });

        const tableOffset = sql.indexOf("Order]]Items") + 2;
        const tableHover = features.hover(uri, 1, tableOffset);
        assert.match(tableHover?.markdown ?? "", /My Schema\.Order\]Items/u);
        const target = features.definitionTarget(uri, 1, tableOffset);
        assert.deepEqual(target.object, {
            database: "db",
            schema: "My Schema",
            name: "Order]Items",
            kind: "table",
        });

        const columnOffset = sql.indexOf("[select]") + 2;
        assert.match(features.hover(uri, 1, columnOffset)?.markdown ?? "", /column.*select/su);

        const variableOffset = sql.lastIndexOf("@välue") + 2;
        assert.equal(features.definition(uri, 1, variableOffset).length, 1);
        assert.equal(features.references(uri, 1, variableOffset).length, 4);
        assert.deepEqual(
            features.rename(uri, 1, variableOffset, "@réplaced").map((edit) => edit.newText),
            ["@réplaced", "@réplaced", "@réplaced", "@réplaced"],
        );

        const signature = features.signatureHelp(uri, 1, sql.length);
        assert.match(signature?.signatures[0]?.label ?? "", /Do-Thing.*@input-value int/u);

        const colors = new TsqlColorizationService().provideDocumentColors(snapshot).tokens;
        assert.ok(
            colors.some(
                (token) => token.tokenType === "schema" && token.modifiers.includes("quoted"),
            ),
        );
        assert.ok(
            colors.some(
                (token) => token.tokenType === "table" && token.modifiers.includes("quoted"),
            ),
        );
        assert.ok(
            colors.some(
                (token) => token.tokenType === "column" && token.modifiers.includes("quoted"),
            ),
        );

        assert.equal(
            formatMultipartName(["My Schema", "Order]Items"]),
            "[My Schema].[Order]]Items]",
        );
        assert.equal(formatMultipartName(["dbo", "select"]), "dbo.[select]");
    });

    // An unfinished delimiter is a normal typing state: completion must replace only its contents
    // and must write the closing delimiter exactly once.
    test("completes hostile names inside unfinished and empty brackets", async () => {
        for (const [sql, insertion] of [
            ["SELECT * FROM [My Schema].[Ord", "Order]]Items]"],
            ["SELECT * FROM [My Schema].[]", "Order]]Items"],
        ]) {
            const { features } = await open(sql);
            const result = features.completion(
                uri,
                1,
                sql.endsWith("[]") ? sql.length - 1 : sql.length,
            );
            const item = result.items.find((candidate) => candidate.label === "Order]Items");
            assert.ok(item?.edit, sql);
            assert.equal(item.edit.newText, insertion, sql);
        }
    });
});
