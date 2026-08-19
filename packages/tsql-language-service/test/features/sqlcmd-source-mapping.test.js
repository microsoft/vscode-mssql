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
    SourceMappedFeatureService,
    TsqlLanguageFeatureService,
} = require("../../dist/index.js");

const uri = "file:///mapped.sql";

function metadata() {
    return new InMemoryMetadataProvider({
        environment: { currentDatabase: "db", defaultSchema: "dbo" },
        schemas: [{ database: "db", name: "dbo" }],
        databases: [{ name: "db" }],
        objects: [
            {
                ref: { id: "customers", database: "db" },
                database: "db",
                schema: "dbo",
                name: "Customers",
                kind: "table",
            },
        ],
        columns: new Map([
            [
                "customers",
                [
                    { name: "Id", typeDisplay: "int", nullable: false },
                    { name: "Name", typeDisplay: "nvarchar(100)", nullable: true },
                ],
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
    const inner = new TsqlLanguageFeatureService(runtime, provider);
    return { snapshot, inner, mapped: new SourceMappedFeatureService(inner, runtime), sql };
}

suite("SQLCMD source mapping for feature results", () => {
    // A document with no SQLCMD syntax projects itself, so the wrapper must be transparent: the
    // identity case is detected by reference and returns the inner result untouched.
    test("passes an ordinary document straight through", async () => {
        const sql = "SELECT Id FROM dbo.Customers;";
        const { inner, mapped } = await open(sql);
        const offset = sql.indexOf("Id");

        assert.deepEqual(
            mapped.completion(uri, 1, offset).items.map(({ label, edit }) => ({ label, edit })),
            inner.completion(uri, 1, offset).items.map(({ label, edit }) => ({ label, edit })),
        );
        assert.deepEqual(mapped.foldingRanges(uri, 1), inner.foldingRanges(uri, 1));
    });

    // The directive line disappears from the projection, so every projected offset is shifted.
    // A host asking about a source offset must still be answered about the right token.
    test("converts a host offset into the projected document", async () => {
        const sql = ":setvar unused 1\nSELECT Name FROM dbo.Customers;\n";
        const { mapped } = await open(sql);

        const hover = mapped.hover(uri, 1, sql.indexOf("Customers"));
        assert.ok(hover, "the caret lands on the table in projected coordinates");
        assert.match(hover.markdown, /Customers/u);
        assert.deepEqual(hover.range, {
            start: sql.indexOf("dbo.Customers"),
            end: sql.indexOf("dbo.Customers") + "dbo.Customers".length,
        });
    });

    // A diagnostic's range is produced in projected coordinates. Published unmapped it would
    // underline the wrong characters in every SQLCMD document.
    test("maps a diagnostic range back to the source", async () => {
        const sql = ":setvar unused 1\nSELECT Id FROM dbo.Missing;\n";
        const { inner, mapped } = await open(sql);

        const [projected] = inner.diagnostics(uri, 1).semantic;
        const [source] = mapped.diagnostics(uri, 1).semantic;
        assert.equal(source.code, "MSSQL208");
        assert.notDeepEqual(source.range, projected.range, "the projection shifted the offsets");
        assert.equal(sql.slice(source.range.start, source.range.end), "dbo.Missing");
    });

    // A completion edit is written back into the file. An edit whose span came from inside a
    // substitution cannot be written without changing the variable, so no edit is offered rather
    // than one that corrupts the document.
    test("drops a completion edit that would land inside a substitution", async () => {
        const sql = ":setvar tbl Customers\nSELECT Id FROM dbo.$(tbl);\n";
        const { mapped } = await open(sql);

        for (const item of mapped.completion(uri, 1, sql.indexOf("$(tbl)") + 3).items) {
            if (!item.edit) continue;
            assert.ok(
                sql.slice(item.edit.start, item.edit.end) !== "",
                "an offered edit names real source text",
            );
            assert.ok(item.edit.start >= 0 && item.edit.end <= sql.length);
        }
    });

    // Folding ranges are structural, so they map cleanly and must stay inside the source document.
    test("keeps folding ranges inside the source document", async () => {
        const sql = ":setvar unused 1\nSELECT Id,\n  Name\nFROM dbo.Customers;\n";
        const { mapped } = await open(sql);

        for (const range of mapped.foldingRanges(uri, 1)) {
            assert.ok(range.start >= 0 && range.end <= sql.length, JSON.stringify(range));
        }
    });
});
