/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { classificationOf, colorize } = require("../support/coloringHarness.js");

/** Roles that come from tree shape alone, with no catalog behind the document. */
suite("syntactic coloring", () => {
    test("names a four-part rowset from server down to object", async () => {
        const { described } = await colorize("SELECT 1 FROM srv.db.dbo.Customers;");
        assert.deepEqual(described.slice(3), [
            "srv server",
            "db database",
            "dbo schema",
            "Customers table",
        ]);
    });

    test("names a qualified column through its rowset qualifier", async () => {
        const { described } = await colorize("SELECT db.dbo.Customers.Name FROM t;");
        assert.deepEqual(described.slice(1, 5), [
            "db database",
            "dbo schema",
            "Customers table",
            "Name column",
        ]);
    });

    test("classifies a qualified star through its rowset", async () => {
        const { described } = await colorize("SELECT dbo.o.* FROM dbo.Orders AS o;");
        assert.deepEqual(described.slice(1, 3), ["dbo schema", "o table"]);
    });

    test("classifies temporary rowsets", async () => {
        const { tokens, sql } = await colorize("SELECT * FROM #staging;");
        assert.deepEqual(classificationOf(tokens, sql, "#staging"), {
            type: "temporaryTable",
            modifiers: ["temporary"],
        });
    });

    test("marks objects qualified by the system schema", async () => {
        const { tokens, sql } = await colorize("SELECT * FROM sys.objects;");
        assert.deepEqual(classificationOf(tokens, sql, "objects"), {
            type: "table",
            modifiers: ["system"],
        });
    });

    test("declares and defines objects created by DDL", async () => {
        const { described } = await colorize(
            "CREATE TABLE dbo.Audit (Id int NOT NULL, Note nvarchar(50));",
        );
        assert.deepEqual(described, [
            "CREATE keyword",
            "TABLE keyword",
            "dbo schema",
            "Audit table declaration definition",
            "Id column declaration",
            "int type",
            "NOT keyword",
            "NULL keyword",
            "Note column declaration",
            "nvarchar type",
            "50 number",
        ]);
    });

    test("separates a module name, its parameters, and its body variables", async () => {
        const { described } = await colorize(
            "CREATE PROCEDURE dbo.usp_Do @id int AS BEGIN SELECT @id; END",
        );
        assert.deepEqual(described, [
            "CREATE keyword",
            "PROCEDURE keyword",
            "dbo schema",
            "usp_Do procedure declaration definition",
            "@id parameter declaration",
            "int type",
            "AS keyword",
            "BEGIN keyword",
            "SELECT keyword",
            "@id variable",
            "END keyword",
        ]);
    });

    test("names an index and the table it belongs to differently", async () => {
        const { described } = await colorize("CREATE INDEX ix_name ON dbo.Customers (Name);");
        assert.deepEqual(described, [
            "CREATE keyword",
            "INDEX keyword",
            "ix_name identifier declaration",
            "ON keyword",
            "dbo schema",
            "Customers table",
            "Name column",
        ]);
    });

    test("declares common table expressions and correlation names", async () => {
        const { tokens, sql } = await colorize(
            "WITH recent AS (SELECT 1 AS n) SELECT r.n FROM recent AS r;",
        );
        assert.deepEqual(classificationOf(tokens, sql, "recent"), {
            type: "commonTableExpression",
            modifiers: ["declaration"],
        });
        assert.deepEqual(classificationOf(tokens, sql, "r", 1), {
            type: "alias",
            modifiers: ["declaration"],
        });
        // The projected name of a common table expression is a column of that expression.
        assert.deepEqual(classificationOf(tokens, sql, "n", 0), {
            type: "column",
            modifiers: ["declaration"],
        });
    });

    test("marks an assigned column as a write", async () => {
        const { tokens, sql } = await colorize("UPDATE dbo.Customers SET Name = 'x';");
        assert.deepEqual(classificationOf(tokens, sql, "Name"), {
            type: "column",
            modifiers: ["write"],
        });
    });

    test("reads, rather than writes, a name assigned into a variable", async () => {
        const { tokens, sql } = await colorize("UPDATE dbo.Customers SET @v = Name;");
        assert.deepEqual(classificationOf(tokens, sql, "Name"), {
            type: "column",
            modifiers: [],
        });
    });

    test("classifies built-in routines apart from user routines", async () => {
        const { tokens, sql } = await colorize("SELECT GETDATE(), dbo.fn_Rate(1);");
        assert.deepEqual(classificationOf(tokens, sql, "GETDATE"), {
            type: "function",
            modifiers: ["defaultLibrary"],
        });
        assert.deepEqual(classificationOf(tokens, sql, "fn_Rate"), {
            type: "function",
            modifiers: [],
        });
    });

    test("classifies executed modules as procedures", async () => {
        const { described } = await colorize("EXEC dbo.usp_Refresh 1;");
        assert.deepEqual(described.slice(1, 3), ["dbo schema", "usp_Refresh procedure"]);
    });

    test("classifies labels at their definition and their jump", async () => {
        const { described } = await colorize("retry: GOTO retry;");
        assert.deepEqual(described, ["retry: label declaration", "GOTO keyword", "retry label"]);
    });

    test("classifies the database named by USE", async () => {
        const { described } = await colorize("USE master;");
        assert.deepEqual(described, ["USE keyword", "master database"]);
    });

    test("keeps an unrecognized name as a plain identifier", async () => {
        const { tokens, sql } = await colorize("CREATE SEQUENCE dbo.Counter AS int;");
        assert.deepEqual(classificationOf(tokens, sql, "Counter"), {
            type: "identifier",
            modifiers: [],
        });
    });

    test("an incomplete name colors from the tree and declares nothing", async () => {
        const { described, snapshot } = await colorize("SELECT * FROM dbo.");
        assert.ok(snapshot.syntax.diagnostics.length > 0);
        assert.deepEqual(described, ["SELECT keyword", "* operator", "FROM keyword", "dbo table"]);
    });

    test("recovery never turns a damaged statement into a declaration", async () => {
        const { tokens } = await colorize("CREATE TABL dbo.X (a int);");
        assert.deepEqual(
            tokens.filter((token) => token.modifiers.includes("declaration")),
            [],
        );
    });
});
