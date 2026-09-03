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
    TsqlLanguageFeatureService,
} from "../../../../src/index.ts";
import { defined } from "../../support/assertions.ts";

const uri = "file:///hover-type-facets.sql";

/**
 * Length, precision, and scale are part of a type's identity, so every hover that names a type has
 * to carry them: a `varchar(50)` column is not interchangeable with a `varchar(max)` one.
 */
function catalog() {
    return new InMemoryMetadataProvider({
        environment: { currentDatabase: "db", defaultSchema: "dbo", caseSensitive: false },
        databases: [{ name: "db" }],
        schemas: [{ database: "db", name: "dbo" }],
        objects: [
            {
                ref: { id: "t", database: "db" },
                database: "db",
                schema: "dbo",
                name: "Sized",
                kind: "table",
            },
            {
                ref: { id: "p", database: "db" },
                database: "db",
                schema: "dbo",
                name: "SizedProc",
                kind: "procedure",
            },
        ],
        columns: new Map([
            [
                "t",
                [
                    { name: "a", typeDisplay: "varchar(50)", nullable: true },
                    { name: "b", typeDisplay: "decimal(18,4)", nullable: false },
                    { name: "c", typeDisplay: "datetime2(3)", nullable: true },
                    { name: "d", typeDisplay: "vector(1536)", nullable: true },
                    { name: "e", typeDisplay: "nvarchar(max)", nullable: true },
                ],
            ],
        ]),
        parameters: new Map([
            ["p", [{ ordinal: 1, name: "@amount", typeDisplay: "decimal(18,4)" }]],
        ]),
    });
}

async function open(sql: string) {
    const metadata = catalog();
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        metadata,
    );
    await runtime.open(uri, 1, sql);
    return new TsqlLanguageFeatureService(runtime, metadata);
}

async function hoverOn(sql: string, needle: string, occurrence = 0): Promise<string> {
    const features = await open(sql);
    let offset = -1;
    for (let index = 0; index <= occurrence; index++) offset = sql.indexOf(needle, offset + 1);
    return defined(features.hover(uri, 1, offset + 1)?.markdown, `expected hover for ${needle}`);
}

suite("hover reports length, precision, and scale", () => {
    test("names the full type of a catalog column", async () => {
        const sql = "SELECT a, b, c, d, e FROM dbo.Sized;";
        assert.match(await hoverOn(sql, "a"), /Type: `varchar\(50\) NULL`/u);
        assert.match(await hoverOn(sql, "b"), /Type: `decimal\(18,4\) NOT NULL`/u);
        assert.match(await hoverOn(sql, "c"), /Type: `datetime2\(3\) NULL`/u);
        assert.match(await hoverOn(sql, "d"), /Type: `vector\(1536\) NULL`/u);
        assert.match(await hoverOn(sql, "e"), /Type: `nvarchar\(max\) NULL`/u);
    });

    test("names the full type of every column in an object hover", async () => {
        const markdown = await hoverOn("SELECT * FROM dbo.Sized;", "Sized");
        for (const type of [
            "varchar(50)",
            "decimal(18,4)",
            "datetime2(3)",
            "vector(1536)",
            "nvarchar(max)",
        ]) {
            assert.ok(markdown.includes(type), `${type} missing from ${markdown}`);
        }
    });

    test("names the full type of a catalog procedure parameter", async () => {
        assert.match(
            await hoverOn("EXEC dbo.SizedProc @amount = 1;", "SizedProc"),
            /@amount decimal\(18,4\)/u,
        );
    });

    test("names the full type of a declared variable", async () => {
        assert.match(
            await hoverOn("DECLARE @v varchar(50);\nSELECT @v;", "@v", 1),
            /varchar\(50\)/u,
        );
        assert.match(
            await hoverOn("DECLARE @d decimal(18, 4);\nSELECT @d;", "@d", 1),
            /decimal\(18, ?4\)/u,
        );
        assert.match(
            await hoverOn("DECLARE @t datetime2(3);\nSELECT @t;", "@t", 1),
            /datetime2\(3\)/u,
        );
        assert.match(
            await hoverOn("DECLARE @e vector(1536);\nSELECT @e;", "@e", 1),
            /vector\(1536\)/u,
        );
    });

    test("names the full type of a local module parameter", async () => {
        const sql =
            "CREATE PROCEDURE dbo.Local @amount decimal(18,4), @name varchar(50) AS\n" +
            "BEGIN SELECT @amount, @name; END";
        assert.match(await hoverOn(sql, "@amount", 1), /decimal\(18,4\)/u);
        assert.match(await hoverOn(sql, "@name", 1), /varchar\(50\)/u);
    });

    test("names the full type of a local table variable column", async () => {
        const sql =
            "DECLARE @t TABLE (col1 varchar(50), col2 decimal(18,4));\n" +
            "SELECT col1, col2 FROM @t;";
        assert.match(await hoverOn(sql, "col1", 1), /varchar\(50\)/u);
        assert.match(await hoverOn(sql, "col2", 1), /decimal\(18,4\)/u);
    });
});
