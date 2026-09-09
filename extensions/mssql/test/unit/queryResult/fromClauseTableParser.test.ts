/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { parseSingleTableFromClause } from "../../../src/queryResult/fromClauseTableParser";

suite("parseSingleTableFromClause", () => {
    test("plain table name", () => {
        expect(parseSingleTableFromClause("SELECT * FROM Customers")).to.deep.equal({
            tableName: "Customers",
            schemaName: undefined,
        });
    });

    test("schema-qualified, bracketed identifiers", () => {
        expect(
            parseSingleTableFromClause("SELECT [Id], [Name] FROM [dbo].[Customers] WHERE [Id] = 1"),
        ).to.deep.equal({ tableName: "Customers", schemaName: "dbo" });
    });

    test("quoted identifiers", () => {
        expect(parseSingleTableFromClause('SELECT * FROM "dbo"."Customers"')).to.deep.equal({
            tableName: "Customers",
            schemaName: "dbo",
        });
    });

    test("three-part name takes schema + table, drops database", () => {
        expect(parseSingleTableFromClause("SELECT * FROM MyDb.dbo.Customers")).to.deep.equal({
            tableName: "Customers",
            schemaName: "dbo",
        });
    });

    test("trailing alias is ignored", () => {
        expect(
            parseSingleTableFromClause("SELECT c.Id FROM dbo.Customers AS c WHERE c.Id = 1"),
        ).to.deep.equal({ tableName: "Customers", schemaName: "dbo" });
    });

    test("ORDER BY / GROUP BY / semicolon all terminate the FROM clause", () => {
        expect(parseSingleTableFromClause("SELECT * FROM Customers ORDER BY Id;")).to.deep.equal({
            tableName: "Customers",
            schemaName: undefined,
        });
        expect(
            parseSingleTableFromClause("SELECT Id, COUNT(*) FROM Customers GROUP BY Id"),
        ).to.deep.equal({ tableName: "Customers", schemaName: undefined });
    });

    test("returns undefined for JOIN", () => {
        expect(
            parseSingleTableFromClause(
                "SELECT * FROM Customers c JOIN Orders o ON o.CustomerId = c.Id",
            ),
        ).to.equal(undefined);
    });

    test("returns undefined for UNION", () => {
        expect(
            parseSingleTableFromClause("SELECT Id FROM Customers UNION SELECT Id FROM Archive"),
        ).to.equal(undefined);
    });

    test("returns undefined for comma-join (old-style JOIN)", () => {
        expect(parseSingleTableFromClause("SELECT * FROM Customers, Orders")).to.equal(undefined);
    });

    test("returns undefined for subquery in FROM", () => {
        expect(parseSingleTableFromClause("SELECT * FROM (SELECT * FROM Customers) x")).to.equal(
            undefined,
        );
    });

    test("returns undefined for CTE", () => {
        expect(
            parseSingleTableFromClause("WITH cte AS (SELECT * FROM Customers) SELECT * FROM cte"),
        ).to.equal(undefined);
    });

    test("returns undefined for multiple statements", () => {
        expect(
            parseSingleTableFromClause("SELECT * FROM Customers; SELECT * FROM Orders;"),
        ).to.equal(undefined);
    });

    test("returns undefined for non-SELECT statement", () => {
        expect(parseSingleTableFromClause("EXEC dbo.MyProc")).to.equal(undefined);
    });

    test("ignores FROM keyword inside string literals and comments", () => {
        expect(
            parseSingleTableFromClause("SELECT 'a FROM b' AS x -- FROM comment\nFROM Customers"),
        ).to.deep.equal({ tableName: "Customers", schemaName: undefined });
    });

    test("returns undefined when there is no FROM clause", () => {
        expect(parseSingleTableFromClause("SELECT 1")).to.equal(undefined);
    });

    test("returns undefined for four-part (linked-server) table reference", () => {
        expect(parseSingleTableFromClause("SELECT * FROM Server.MyDb.dbo.Customers")).to.equal(
            undefined,
        );
    });

    test("returns undefined for bracketed identifier with escaped ']]'", () => {
        expect(parseSingleTableFromClause("SELECT * FROM [My]]Table]")).to.equal(undefined);
    });

    test("returns undefined for schema-qualified bracketed identifier with escaped ']]'", () => {
        expect(parseSingleTableFromClause("SELECT * FROM [dbo].[Order]]Item]")).to.equal(undefined);
    });

    test("returns undefined for quoted identifier with escaped '\"\"'", () => {
        expect(parseSingleTableFromClause('SELECT * FROM "My""Table"')).to.equal(undefined);
    });

    test("returns undefined for CROSS APPLY (bare table reference form)", () => {
        expect(parseSingleTableFromClause("SELECT * FROM A CROSS APPLY B")).to.equal(undefined);
    });

    test("returns undefined for OUTER APPLY (bare table reference form)", () => {
        expect(parseSingleTableFromClause("SELECT * FROM A OUTER APPLY B")).to.equal(undefined);
    });
});
