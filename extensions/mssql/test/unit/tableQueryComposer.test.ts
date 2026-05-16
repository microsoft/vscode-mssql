/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    AppliedFilter,
    composeFilteredQuery,
    composeSortedQuery,
    operatorTakesValue,
    stripTrailingOrderByAndSemicolon,
} from "../../src/tableExplorer/tableQueryComposer";

suite("tableQueryComposer", () => {
    suite("operatorTakesValue", () => {
        test("returns false for null-check operators", () => {
            expect(operatorTakesValue("isNull")).to.equal(false);
            expect(operatorTakesValue("isNotNull")).to.equal(false);
        });

        test("returns true for value-bearing operators", () => {
            for (const op of [
                "equals",
                "notEquals",
                "contains",
                "notContains",
                "startsWith",
                "endsWith",
                "greaterThan",
                "lessThan",
            ] as const) {
                expect(operatorTakesValue(op), op).to.equal(true);
            }
        });
    });

    suite("stripTrailingOrderByAndSemicolon", () => {
        test("returns input unchanged when there's no ORDER BY or semicolon", () => {
            const sql = "SELECT * FROM [dbo].[t]";
            expect(stripTrailingOrderByAndSemicolon(sql)).to.equal(sql);
        });

        test("removes a trailing semicolon", () => {
            expect(stripTrailingOrderByAndSemicolon("SELECT 1;")).to.equal("SELECT 1");
        });

        test("removes a trailing ORDER BY clause", () => {
            const input = "SELECT * FROM t\nORDER BY [a] ASC";
            expect(stripTrailingOrderByAndSemicolon(input)).to.equal("SELECT * FROM t");
        });

        test("removes ORDER BY and a trailing semicolon together", () => {
            const input = "SELECT * FROM t ORDER BY [a] ASC;";
            expect(stripTrailingOrderByAndSemicolon(input)).to.equal("SELECT * FROM t");
        });

        test("is case-insensitive on the ORDER BY keyword", () => {
            expect(stripTrailingOrderByAndSemicolon("SELECT * FROM t order  by [a]")).to.equal(
                "SELECT * FROM t",
            );
        });

        test("strips only the last ORDER BY when multiple appear", () => {
            // The earlier "ORDER BY" lives inside a subquery and must be preserved.
            const input = "SELECT * FROM (SELECT TOP 5 * FROM t ORDER BY [a]) x ORDER BY [b] DESC";
            expect(stripTrailingOrderByAndSemicolon(input)).to.equal(
                "SELECT * FROM (SELECT TOP 5 * FROM t ORDER BY [a]) x",
            );
        });
    });

    suite("composeSortedQuery", () => {
        test("returns base unchanged when sort list is empty", () => {
            const base = "SELECT * FROM t";
            expect(composeSortedQuery(base, [])).to.equal(base);
        });

        test("returns empty string unchanged", () => {
            expect(composeSortedQuery("", [{ columnName: "a", sortAsc: true }])).to.equal("");
        });

        test("appends ORDER BY ASC and DESC clauses with bracket-escaped identifiers", () => {
            const result = composeSortedQuery("SELECT * FROM t", [
                { columnName: "first", sortAsc: true },
                { columnName: "second", sortAsc: false },
            ]);
            expect(result).to.equal("SELECT * FROM t\nORDER BY [first] ASC, [second] DESC");
        });

        test("escapes closing brackets in column names", () => {
            const result = composeSortedQuery("SELECT * FROM t", [
                { columnName: "weird]name", sortAsc: true },
            ]);
            expect(result).to.equal("SELECT * FROM t\nORDER BY [weird]]name] ASC");
        });

        test("replaces a pre-existing trailing ORDER BY", () => {
            const result = composeSortedQuery("SELECT * FROM t ORDER BY [a] ASC", [
                { columnName: "b", sortAsc: false },
            ]);
            expect(result).to.equal("SELECT * FROM t\nORDER BY [b] DESC");
        });
    });

    suite("composeFilteredQuery", () => {
        const filter = (
            column: string,
            operator: AppliedFilter["operator"],
            value: string,
            conjunction?: AppliedFilter["conjunction"],
        ): AppliedFilter => ({ column, operator, value, conjunction });

        test("returns base when no filters yield predicates", () => {
            const base = "SELECT * FROM t";
            expect(composeFilteredQuery(base, [])).to.equal(base);
            // Missing column → empty predicate → no WHERE added
            expect(composeFilteredQuery(base, [filter("", "equals", "x")])).to.equal(base);
            // Missing value on a value-bearing operator → no predicate
            expect(composeFilteredQuery(base, [filter("a", "equals", "")])).to.equal(base);
        });

        test("emits equality and inequality predicates with N'' literals", () => {
            const eq = composeFilteredQuery("SELECT * FROM t", [filter("name", "equals", "Bob")]);
            expect(eq).to.equal("SELECT * FROM t\nWHERE [name] = N'Bob'\n");

            const ne = composeFilteredQuery("SELECT * FROM t", [
                filter("name", "notEquals", "Bob"),
            ]);
            expect(ne).to.equal("SELECT * FROM t\nWHERE [name] <> N'Bob'\n");
        });

        test("emits comparison predicates", () => {
            const gt = composeFilteredQuery("SELECT * FROM t", [filter("age", "greaterThan", "5")]);
            expect(gt).to.include("[age] > N'5'");
            const lt = composeFilteredQuery("SELECT * FROM t", [filter("age", "lessThan", "5")]);
            expect(lt).to.include("[age] < N'5'");
        });

        test("emits LIKE predicates with %/_ wildcards escaped", () => {
            const contains = composeFilteredQuery("SELECT * FROM t", [
                filter("name", "contains", "100%_done"),
            ]);
            // % and _ in user input must be escaped so they're treated as literals
            expect(contains).to.include("[name] LIKE N'%100\\%\\_done%' ESCAPE '\\'");

            const notContains = composeFilteredQuery("SELECT * FROM t", [
                filter("name", "notContains", "abc"),
            ]);
            expect(notContains).to.include("[name] NOT LIKE N'%abc%' ESCAPE '\\'");

            const startsWith = composeFilteredQuery("SELECT * FROM t", [
                filter("name", "startsWith", "abc"),
            ]);
            expect(startsWith).to.include("[name] LIKE N'abc%' ESCAPE '\\'");

            const endsWith = composeFilteredQuery("SELECT * FROM t", [
                filter("name", "endsWith", "abc"),
            ]);
            expect(endsWith).to.include("[name] LIKE N'%abc' ESCAPE '\\'");
        });

        test("emits IS NULL / IS NOT NULL without requiring a value", () => {
            const isNull = composeFilteredQuery("SELECT * FROM t", [filter("name", "isNull", "")]);
            expect(isNull).to.include("[name] IS NULL");

            const isNotNull = composeFilteredQuery("SELECT * FROM t", [
                filter("name", "isNotNull", ""),
            ]);
            expect(isNotNull).to.include("[name] IS NOT NULL");
        });

        test("escapes single quotes in values to prevent SQL injection", () => {
            const result = composeFilteredQuery("SELECT * FROM t", [
                filter("name", "equals", "O'Brien"),
            ]);
            expect(result).to.include("[name] = N'O''Brien'");
        });

        test("escapes closing brackets in column names", () => {
            const result = composeFilteredQuery("SELECT * FROM t", [
                filter("weird]name", "equals", "x"),
            ]);
            expect(result).to.include("[weird]]name] = N'x'");
        });

        test("inserts WHERE before an existing ORDER BY clause", () => {
            const result = composeFilteredQuery("SELECT * FROM t\nORDER BY [a] ASC", [
                filter("name", "equals", "Bob"),
            ]);
            expect(result).to.equal("SELECT * FROM t\nWHERE [name] = N'Bob'\nORDER BY [a] ASC");
        });

        test("combines with an existing WHERE clause using AND", () => {
            const result = composeFilteredQuery("SELECT * FROM t WHERE [age] > 18", [
                filter("name", "equals", "Bob"),
            ]);
            expect(result).to.equal("SELECT * FROM t WHERE ([age] > 18) AND ([name] = N'Bob') ");
        });

        test("preserves a trailing semicolon when there's no ORDER BY", () => {
            const result = composeFilteredQuery("SELECT * FROM t;", [
                filter("name", "equals", "Bob"),
            ]);
            expect(result.trim().endsWith(";")).to.equal(true);
            expect(result).to.include("WHERE [name] = N'Bob'");
        });

        test("joins multiple filters with the configured conjunctions", () => {
            const result = composeFilteredQuery("SELECT * FROM t", [
                // The first filter's conjunction is ignored — it's the anchor.
                filter("a", "equals", "1", "OR"),
                filter("b", "equals", "2", "OR"),
                filter("c", "equals", "3"), // default → AND
            ]);
            expect(result).to.equal(
                "SELECT * FROM t\nWHERE [a] = N'1' OR [b] = N'2' AND [c] = N'3'\n",
            );
        });
    });
});
