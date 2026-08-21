/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    TsqlColorizationService,
    TsqlLanguageFeatureService,
} from "../../../../src/index.ts";
import { defined } from "../../support/assertions.ts";

const uri = "file:///hover.sql";

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
        ],
        columns: new Map([["cust", [{ name: "Id", typeDisplay: "int", nullable: false }]]]),
    });
}

async function open(sql: string) {
    const metadata = catalog();
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        metadata,
    );
    const snapshot = await runtime.open(uri, 1, sql);
    return { features: new TsqlLanguageFeatureService(runtime, metadata), snapshot };
}

/** Hovers just inside the first occurrence of `needle`, the way a cursor sits in a word. */
async function optionalHoverOn(sql: string, needle: string): Promise<string | undefined> {
    const { features } = await open(sql);
    const result = features.hover(uri, 1, sql.indexOf(needle) + 1);
    return result?.markdown;
}

async function hoverOn(sql: string, needle: string): Promise<string> {
    return defined(await optionalHoverOn(sql, needle), `expected hover for ${needle}`);
}

suite("hover for names no symbol is bound to", () => {
    test("describes a built-in function, with its signature when one is documented", async () => {
        assert.match(
            await hoverOn("SELECT GETDATE();", "GETDATE"),
            /\*\*built-in function\*\* `GETDATE`/u,
        );
        const documented = await hoverOn("SELECT DATEADD(day, 1, @d);", "DATEADD");
        assert.match(documented, /\*\*built-in function\*\* `DATEADD`/u);
        assert.match(documented, /DATEADD\(datepart, number, date\)/u);
    });

    test("describes a built-in data type", async () => {
        const markdown = await hoverOn("DECLARE @v int;", "int");
        assert.match(markdown, /\*\*data type\*\* `int`/u);
        assert.match(markdown, /Exact number, 4 bytes/u);
        assert.match(await hoverOn("DECLARE @v nvarchar(50);", "nvarchar"), /\*\*data type\*\*/u);
    });

    test("describes a system variable", async () => {
        const markdown = await hoverOn("SELECT @@ROWCOUNT;", "@@ROWCOUNT");
        assert.match(markdown, /\*\*system variable\*\* `@@ROWCOUNT`/u);
        assert.match(markdown, /Rows affected/u);
        // One with no documentation still reports what it is.
        assert.match(
            await hoverOn("SELECT @@UNDOCUMENTED;", "@@UNDOC"),
            /\*\*system variable\*\*/u,
        );
    });

    test("describes labels at their definition and their jump", async () => {
        assert.match(await hoverOn("retry: GOTO retry;", "retry:"), /\*\*label\*\* `retry`/u);
        assert.match(await hoverOn("retry: GOTO retry;", "retry;"), /\*\*label\*\* `retry`/u);
    });

    test("describes a cursor where it is declared and where it is used", async () => {
        const sql = "DECLARE cur CURSOR FOR SELECT 1; OPEN cur;";
        assert.match(await hoverOn(sql, "cur CURSOR"), /\*\*cursor\*\* `cur`/u);
        assert.match(await hoverOn(sql, "cur;"), /\*\*cursor\*\* `cur`/u);
    });

    test("describes a result column alias", async () => {
        assert.match(
            await hoverOn("SELECT Id AS Ident FROM dbo.Customers;", "Ident"),
            /\*\*result column\*\* `Ident`/u,
        );
    });

    test("describes an index name", async () => {
        assert.match(
            await hoverOn("CREATE INDEX ix_name ON dbo.Customers (Id);", "ix_name"),
            /\*\*index\*\* `ix_name`/u,
        );
    });

    test("names a routine parameter as a parameter, at its declaration and its use", async () => {
        const sql = "CREATE PROCEDURE dbo.p @id int AS BEGIN SELECT @id; END";
        assert.match(await hoverOn(sql, "@id int"), /\*\*parameter\*\* `@id`/u);
        assert.match(await hoverOn(sql, "@id;"), /\*\*parameter\*\* `@id`/u);
        // A local declared with DECLARE is still a variable.
        assert.match(await hoverOn("DECLARE @v int; SELECT @v;", "@v;"), /\*\*variable\*\* `@v`/u);
    });

    test("a qualified name answers about the object from any part of it", async () => {
        const sql = "SELECT 1 FROM dbo.Customers;";
        for (const needle of ["dbo", "Customers"]) {
            assert.match(await hoverOn(sql, needle), /\*\*table\*\* `db\.dbo\.Customers`/u);
        }
    });

    test("a catalog object of the same name is not masked by the shipped one", async () => {
        const metadata = new InMemoryMetadataProvider({
            environment: { currentDatabase: "db", defaultSchema: "dbo", caseSensitive: false },
            databases: [{ name: "db" }],
            schemas: [{ database: "db", name: "dbo" }],
            objects: [
                {
                    ref: { id: "own", database: "db" },
                    database: "db",
                    schema: "dbo",
                    name: "GETDATE",
                    kind: "scalarFunction",
                },
            ],
        });
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(),
            new CatalogSemanticBinder(),
            metadata,
        );
        const sql = "SELECT dbo.GETDATE();";
        await runtime.open(uri, 1, sql);
        const features = new TsqlLanguageFeatureService(runtime, metadata);
        const markdown = features.hover(uri, 1, sql.indexOf("GETDATE") + 1)?.markdown ?? "";
        assert.match(markdown, /\*\*scalarFunction\*\* `db\.dbo\.GETDATE`/u);
        assert.doesNotMatch(markdown, /built-in/u);
    });

    test("keeps quiet where there is nothing to say", async () => {
        assert.equal(await optionalHoverOn("SELECT 1;", "1"), undefined);
        assert.equal(await optionalHoverOn("SELECT 'text';", "'text'"), undefined);
        assert.equal(await optionalHoverOn("SELECT 1;", "SELECT"), undefined);
    });

    test("hover agrees with how coloring classified the same token", async () => {
        const sql = "CREATE PROCEDURE dbo.p @id int AS BEGIN SELECT @@ROWCOUNT, GETDATE(); END";
        const { features, snapshot } = await open(sql);
        const tokens = new TsqlColorizationService().provideDocumentColors(snapshot).tokens;
        const expected = new Map([
            ["parameter", /\*\*parameter\*\*/u],
            ["type", /\*\*data type\*\*/u],
        ]);
        let checked = 0;
        for (const token of tokens) {
            const pattern = expected.get(token.tokenType);
            if (!pattern) continue;
            const markdown = features.hover(uri, 1, token.start + 1)?.markdown ?? "";
            assert.match(markdown, pattern, `token ${sql.slice(token.start, token.end)}`);
            checked++;
        }
        assert.ok(checked >= 2);
    });
});
