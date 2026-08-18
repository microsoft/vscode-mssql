/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    classificationOf,
    colorize,
    createColoringMetadata,
} = require("../support/coloringHarness.js");

const provider = () => createColoringMetadata();

/** Roles that only a bound symbol can supply, layered over the syntactic ones. */
suite("bound coloring", () => {
    test("resolves a rowset to the catalog kind it actually has", async () => {
        const { tokens, sql } = await colorize(
            "SELECT 1 FROM dbo.ActiveCustomers; SELECT 1 FROM dbo.Customers;",
            { provider: provider() },
        );
        assert.deepEqual(classificationOf(tokens, sql, "ActiveCustomers"), {
            type: "view",
            modifiers: [],
        });
        assert.deepEqual(classificationOf(tokens, sql, "Customers"), {
            type: "table",
            modifiers: [],
        });
    });

    test("resolves routines used as rowsets and as scalars", async () => {
        const { tokens, sql } = await colorize(
            "SELECT dbo.fn_Rate(1) FROM dbo.tvf_Split(1) AS s;",
            { provider: provider() },
        );
        assert.deepEqual(classificationOf(tokens, sql, "fn_Rate"), {
            type: "function",
            modifiers: [],
        });
        assert.deepEqual(classificationOf(tokens, sql, "tvf_Split"), {
            type: "function",
            modifiers: [],
        });
    });

    test("colors a correlation-name qualifier as the alias it binds to", async () => {
        const { described } = await colorize("SELECT c.Name FROM dbo.Customers AS c;", {
            provider: provider(),
        });
        assert.deepEqual(described, [
            "SELECT keyword",
            "c alias",
            "Name column",
            "FROM keyword",
            "dbo schema",
            "Customers table",
            "AS keyword",
            "c alias declaration",
        ]);
    });

    test("marks a DML target as a write", async () => {
        const { tokens, sql } = await colorize("DELETE FROM dbo.Orders WHERE OrderId = 1;", {
            provider: provider(),
        });
        assert.deepEqual(classificationOf(tokens, sql, "Orders"), {
            type: "table",
            modifiers: ["write"],
        });
        assert.deepEqual(classificationOf(tokens, sql, "OrderId"), {
            type: "column",
            modifiers: [],
        });
    });

    test("binds references to a local temporary table", async () => {
        const { tokens, sql } = await colorize(
            "CREATE TABLE #staging (Id int); SELECT Id FROM #staging;",
            { provider: provider() },
        );
        assert.deepEqual(classificationOf(tokens, sql, "#staging", 0), {
            type: "temporaryTable",
            modifiers: ["declaration", "definition", "temporary"],
        });
        assert.deepEqual(classificationOf(tokens, sql, "#staging", 1), {
            type: "temporaryTable",
            modifiers: ["temporary"],
        });
    });

    test("binds references to a common table expression", async () => {
        const { tokens, sql } = await colorize(
            "WITH recent AS (SELECT Id FROM dbo.Customers) SELECT Id FROM recent;",
            { provider: provider() },
        );
        assert.deepEqual(classificationOf(tokens, sql, "recent", 1), {
            type: "commonTableExpression",
            modifiers: [],
        });
    });

    test("binds a variable use to its declaration", async () => {
        const { described } = await colorize("DECLARE @id int; SELECT @id;", {
            provider: provider(),
        });
        assert.deepEqual(described, [
            "DECLARE keyword",
            "@id variable declaration",
            "int type",
            "SELECT keyword",
            "@id variable",
        ]);
    });

    test("a routine parameter keeps its declaration role when bound as a local", async () => {
        const { tokens, sql } = await colorize(
            "CREATE PROCEDURE dbo.usp_Do @id int AS BEGIN SELECT @id; END",
            { provider: provider() },
        );
        assert.deepEqual(classificationOf(tokens, sql, "@id", 0), {
            type: "parameter",
            modifiers: ["declaration"],
        });
        assert.deepEqual(classificationOf(tokens, sql, "@id", 1), {
            type: "variable",
            modifiers: [],
        });
    });

    test("a rowset function stays a routine at its call site", async () => {
        const withSchema = await colorize("SELECT * FROM OPENJSON(@j) WITH (Id int);", {
            provider: provider(),
        });
        assert.deepEqual(classificationOf(withSchema.tokens, withSchema.sql, "OPENJSON"), {
            type: "function",
            modifiers: ["defaultLibrary"],
        });
        const aliased = await colorize("SELECT * FROM OPENJSON(@j) AS j;", {
            provider: provider(),
        });
        assert.deepEqual(classificationOf(aliased.tokens, aliased.sql, "OPENJSON"), {
            type: "function",
            modifiers: ["defaultLibrary"],
        });
        assert.deepEqual(classificationOf(aliased.tokens, aliased.sql, "j"), {
            type: "alias",
            modifiers: ["declaration"],
        });
    });

    test("an unresolved name keeps its syntactic role instead of inventing a kind", async () => {
        const { tokens, sql } = await colorize("SELECT 1 FROM dbo.Missing;", {
            provider: provider(),
        });
        assert.deepEqual(classificationOf(tokens, sql, "Missing"), {
            type: "table",
            modifiers: [],
        });
    });

    test("coloring is identical whether or not the catalog is available", async () => {
        const sql = "SELECT 1 FROM dbo.Missing AS m WHERE m.x = 1;";
        const withCatalog = await colorize(sql, { provider: provider() });
        const withoutCatalog = await colorize(sql);
        assert.deepEqual(withCatalog.described, withoutCatalog.described);
    });
});
