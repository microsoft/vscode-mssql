/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { classificationOf, colorize, createColoringMetadata } from "../support/coloringHarness.ts";

suite("lexical coloring", () => {
    test("classifies comments, literals, keywords, and operators", async () => {
        const { described } = await colorize(
            ["-- lead", "SELECT /* inline */ 1 + 2.5, 0x0A, N'text';"].join("\n"),
        );
        assert.deepEqual(described, [
            "-- lead comment",
            "SELECT keyword",
            "/* inline */ comment",
            "1 number",
            "+ operator",
            "2.5 number",
            "0x0A number",
            "N'text' string",
        ]);
    });

    test("keeps list and statement punctuation unclassified", async () => {
        const { described } = await colorize("SELECT (1), 2;");
        assert.deepEqual(described, ["SELECT keyword", "1 number", "2 number"]);
    });

    test("marks the legacy outer-join comparisons deprecated", async () => {
        const { tokens, sql } = await colorize("SELECT 1 FROM a, b WHERE a.x *= b.y;");
        assert.deepEqual(classificationOf(tokens, sql, "*="), {
            type: "operator",
            modifiers: ["deprecated"],
        });
    });

    test("classifies global variables as read-only system variables", async () => {
        const { described } = await colorize("SELECT @@ROWCOUNT;");
        assert.deepEqual(described, ["SELECT keyword", "@@ROWCOUNT variable readonly system"]);
    });

    test("a contextual keyword used as a name is colored as the name, not a keyword", async () => {
        const { tokens, sql } = await colorize("SELECT value, name, type FROM dbo.Customers;", {
            provider: createColoringMetadata(),
        });
        for (const name of ["value", "name", "type"]) {
            assert.deepEqual(
                classificationOf(tokens, sql, name),
                { type: "column", modifiers: [] },
                `${name} must not be colored as a keyword`,
            );
        }
    });

    test("a name inside a string or comment is never recolored as a symbol", async () => {
        const sql = [
            "-- update dbo.Customers set Name = 1",
            "SELECT N'dbo.Customers' FROM dbo.Customers;",
        ].join("\n");
        const { described } = await colorize(sql, { provider: createColoringMetadata() });
        assert.deepEqual(described, [
            "-- update dbo.Customers set Name = 1 comment",
            "SELECT keyword",
            "N'dbo.Customers' string",
            "FROM keyword",
            "dbo schema",
            "Customers table",
        ]);
    });

    test("an unterminated string stays one string and colors no symbol", async () => {
        const { described } = await colorize("SELECT 'dbo.Customers", {
            provider: createColoringMetadata(),
        });
        assert.deepEqual(described, ["SELECT keyword", "'dbo.Customers string"]);
    });

    test("delimited names carry the quoted modifier and exact UTF-16 ranges", async () => {
        const sql = "SELECT [Schéma].[Ta😀ble].Id FROM [Schéma].[Ta😀ble];";
        const { tokens } = await colorize(sql);
        for (const token of tokens) {
            assert.equal(
                sql.slice(token.start, token.end).length,
                token.end - token.start,
                "ranges must be UTF-16 code-unit offsets",
            );
        }
        assert.deepEqual(classificationOf(tokens, sql, "[Ta😀ble]"), {
            type: "table",
            modifiers: ["quoted"],
        });
        assert.deepEqual(classificationOf(tokens, sql, "[Schéma]"), {
            type: "schema",
            modifiers: ["quoted"],
        });
    });

    test("the batch separator is colored as a keyword", async () => {
        const { described } = await colorize("SELECT 1;\nGO\nSELECT 2;\n");
        assert.deepEqual(described, [
            "SELECT keyword",
            "1 number",
            "GO keyword",
            "SELECT keyword",
            "2 number",
        ]);
    });
});
