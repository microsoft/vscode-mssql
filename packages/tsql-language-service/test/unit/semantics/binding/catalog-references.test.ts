/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { analyzeSql, createMetadata } from "../../support/semanticHarness.ts";

const uri = "file:///catalog-references.sql";

function catalog() {
    return createMetadata({
        objects: [
            {
                ref: { id: "cust", database: "db" },
                database: "db",
                schema: "dbo",
                name: "Customers",
                kind: "table",
            },
            {
                ref: { id: "rate", database: "db" },
                database: "db",
                schema: "dbo",
                name: "fn_Rate",
                kind: "scalarFunction",
            },
            {
                ref: { id: "split", database: "db" },
                database: "db",
                schema: "dbo",
                name: "tvf_Split",
                kind: "tableFunction",
            },
            {
                ref: { id: "refresh", database: "db" },
                database: "db",
                schema: "dbo",
                name: "usp_Refresh",
                kind: "procedure",
            },
            {
                ref: { id: "code", database: "db" },
                database: "db",
                schema: "dbo",
                name: "OrderCode",
                kind: "type",
                typeCategory: "alias",
            },
            {
                ref: { id: "shadow-int", database: "db" },
                database: "db",
                schema: "dbo",
                name: "int",
                kind: "type",
                typeCategory: "alias",
            },
            {
                ref: { id: "shadow-getdate", database: "db" },
                database: "db",
                schema: "dbo",
                name: "GETDATE",
                kind: "scalarFunction",
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
    });
}

/** The bound symbol at the first occurrence of `needle`, described as kind and name. */
async function symbolAt(sql: string, needle: string): Promise<string | undefined> {
    const snapshot = await analyzeSql(sql, catalog(), {
        snapshot: true,
        allowSyntaxDiagnostics: true,
        uri,
    });
    const symbol = snapshot.semantics.symbolAt(sql.indexOf(needle) + 1);
    return symbol && `${symbol.kind} ${symbol.name}`;
}

/** Whether the occurrence at `needle` was recorded as a write. */
async function writesAt(sql: string, needle: string): Promise<boolean> {
    const snapshot = await analyzeSql(sql, catalog(), {
        snapshot: true,
        allowSyntaxDiagnostics: true,
        uri,
    });
    const offset = sql.indexOf(needle);
    return snapshot.semantics.units
        .flatMap((unit) => unit.references)
        .some(
            (reference) => reference.start <= offset && offset <= reference.end && reference.write,
        );
}

suite("catalog references outside rowset positions", () => {
    test("binds an executed module and a called routine", async () => {
        assert.equal(
            await symbolAt("EXEC dbo.usp_Refresh;", "usp_Refresh"),
            "procedure dbo.usp_Refresh",
        );
        assert.equal(
            await symbolAt("SELECT dbo.fn_Rate(1);", "fn_Rate"),
            "scalarFunction dbo.fn_Rate",
        );
        assert.equal(
            await symbolAt("SELECT * FROM dbo.tvf_Split(1) AS s;", "tvf_Split"),
            "tableFunction dbo.tvf_Split",
        );
    });

    test("binds a user-defined type where it is mentioned", async () => {
        assert.equal(
            await symbolAt("DECLARE @v dbo.OrderCode;", "OrderCode"),
            "type dbo.OrderCode",
        );
        assert.equal(
            await symbolAt("CREATE TABLE dbo.T (a dbo.OrderCode);", "OrderCode"),
            "type dbo.OrderCode",
        );
    });

    test("binds the object a DDL statement acts on, and records that it writes", async () => {
        for (const sql of [
            "ALTER TABLE dbo.Customers ADD b int;",
            "DROP TABLE dbo.Customers;",
            "TRUNCATE TABLE dbo.Customers;",
        ]) {
            assert.equal(await symbolAt(sql, "Customers"), "table dbo.Customers", sql);
            assert.equal(await writesAt(sql, "Customers"), true, sql);
        }
        assert.equal(
            await symbolAt("CREATE INDEX ix ON dbo.Customers (Id);", "Customers"),
            "table dbo.Customers",
        );
        assert.equal(
            await symbolAt(
                "CREATE TRIGGER tr ON dbo.Customers AFTER INSERT AS SELECT 1;",
                "Customers",
            ),
            "table dbo.Customers",
        );
    });

    test("binds a granted securable that names an object", async () => {
        assert.equal(
            await symbolAt("GRANT SELECT ON dbo.Customers TO reader;", "Customers"),
            "table dbo.Customers",
        );
        // A class-qualified securable is not an object, so it stays unbound.
        assert.equal(await symbolAt("GRANT SELECT ON SCHEMA::dbo TO reader;", "dbo"), undefined);
    });

    test("leaves a name that resolves to the wrong kind unbound", async () => {
        // A table cannot stand where a routine is called.
        assert.equal(await symbolAt("SELECT dbo.Customers(1);", "Customers"), undefined);
        assert.equal(await symbolAt("EXEC dbo.Customers;", "Customers"), undefined);
    });

    test("leaves an unresolved name unbound rather than inventing a symbol", async () => {
        assert.equal(await symbolAt("EXEC dbo.usp_Missing;", "usp_Missing"), undefined);
        assert.equal(await symbolAt("DECLARE @v dbo.MissingType;", "MissingType"), undefined);
    });

    test("does not let one-part catalog names shadow built-in types or functions", async () => {
        assert.equal(await symbolAt("DECLARE @v int;", "int"), undefined);
        assert.equal(await symbolAt("SELECT GETDATE();", "GETDATE"), undefined);
        assert.equal(await symbolAt("DECLARE @v dbo.int;", "int"), "type dbo.int");
        assert.equal(
            await symbolAt("SELECT dbo.GETDATE();", "GETDATE"),
            "scalarFunction dbo.GETDATE",
        );
    });
});

suite("columns a statement writes and orders by", () => {
    test("binds the target columns an INSERT names, as writes", async () => {
        const sql = "INSERT INTO dbo.Customers (Name) VALUES ('a');";
        assert.equal(await symbolAt(sql, "Name)"), "column Name");
        assert.equal(await writesAt(sql, "Name)"), true);
    });

    test("binds the column a SET clause assigns, as a write", async () => {
        const sql = "UPDATE dbo.Customers SET Name = 'a';";
        assert.equal(await symbolAt(sql, "Name"), "column Name");
        assert.equal(await writesAt(sql, "Name"), true);
    });

    test("binds a column read through the rowsets OUTPUT exposes", async () => {
        assert.equal(
            await symbolAt("DELETE dbo.Customers OUTPUT deleted.Name;", "Name"),
            "column Name",
        );
        assert.equal(
            await symbolAt(
                "INSERT INTO dbo.Customers (Name) OUTPUT inserted.Id VALUES ('a');",
                "Id VALUES",
            ),
            "column Id",
        );
    });

    test("binds a column named by ORDER BY, which follows the query it orders", async () => {
        assert.equal(
            await symbolAt("SELECT Id FROM dbo.Customers ORDER BY Name;", "Name;"),
            "column Name",
        );
    });

    test("a column read in a WHERE clause is not recorded as a write", async () => {
        const sql = "UPDATE dbo.Customers SET Name = 'a' WHERE Id = 1;";
        assert.equal(await symbolAt(sql, "Id ="), "column Id");
        assert.equal(await writesAt(sql, "Id ="), false);
    });
});
