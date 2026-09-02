/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import type { FoldingRange } from "../../../../src/index.ts";
import { fold, script } from "../../support/foldingHarness.ts";
import { defined } from "../../support/assertions.ts";

suite("folding ranges", () => {
    test("folds a multi-line statement from its first line", () => {
        const { described } = fold(script("SELECT", "    a,", "    b", "FROM dbo.T;"));
        assert.deepEqual(described, ["0-3 code"]);
    });

    test("never folds a statement that fits on one line", () => {
        assert.deepEqual(fold("SELECT 1;\nSELECT 2;\n").described, []);
    });

    test("folds a module, its parameters, and its body block", () => {
        const { described } = fold(
            script(
                "CREATE PROCEDURE dbo.usp_Do",
                "    @id int,",
                "    @name nvarchar(10)",
                "AS",
                "BEGIN",
                "    SELECT @id;",
                "END",
            ),
        );
        assert.deepEqual(described, ["0-6 code", "1-2 code", "4-6 code"]);
    });

    test("folds TRY and CATCH as separate blocks", () => {
        const { described } = fold(
            script(
                "BEGIN TRY",
                "    SELECT 1;",
                "END TRY",
                "BEGIN CATCH",
                "    THROW;",
                "END CATCH",
            ),
        );
        assert.deepEqual(described, ["0-2 code", "3-5 code"]);
    });

    test("folds nested control flow at each level", () => {
        const { described } = fold(
            script(
                "IF @a = 1",
                "BEGIN",
                "    WHILE @b < 2",
                "    BEGIN",
                "        SET @b += 1;",
                "    END",
                "END",
            ),
        );
        assert.deepEqual(described, ["0-6 code", "1-6 code", "2-5 code", "3-5 code"]);
    });

    test("folds a batch only when it groups several statements", () => {
        const grouped = fold(script("SELECT 1;", "SELECT 2;", "SELECT 3;", "GO", "SELECT 4;"));
        assert.deepEqual(grouped.described, ["0-2 code"]);

        const single = fold(script("SELECT", "    1;", "GO"));
        assert.deepEqual(single.described, ["0-1 code"]);
    });

    test("folds subqueries, value lists, and CASE expressions", () => {
        const { described } = fold(
            script(
                "INSERT INTO dbo.T (a)",
                "VALUES",
                "    (1),",
                "    (2);",
                "SELECT",
                "    CASE",
                "        WHEN a = 1 THEN 'one'",
                "        ELSE 'many'",
                "    END AS label",
                "FROM (",
                "    SELECT a",
                "    FROM dbo.T",
                ") AS s;",
            ),
        );
        assert.deepEqual(described, [
            "0-3 code",
            "1-3 code",
            "4-12 code",
            "5-8 code",
            "9-12 code",
            "10-11 code",
        ]);
    });

    test("folds a run of line comments and a block comment", () => {
        const { described } = fold(
            script(
                "-- first",
                "-- second",
                "-- third",
                "SELECT 1;",
                "/* one",
                "   two */",
                "SELECT 2;",
            ),
        );
        assert.deepEqual(described, ["0-2 comment", "4-5 comment"]);
    });

    test("a blank line and trailing code both end a comment run", () => {
        const { described } = fold(
            script("-- first", "", "-- second", "-- third", "SELECT 1; -- trailing", "-- last"),
        );
        assert.deepEqual(described, ["2-3 comment"]);
    });

    test("folds region markers declared by the language configuration", () => {
        const { described } = fold(
            script(
                "-- #region outer",
                "SELECT 1;",
                "-- #region inner",
                "SELECT 2;",
                "-- #endregion",
                "-- #endregion",
            ),
        );
        assert.deepEqual(described, ["0-5 region", "2-4 region"]);
    });

    test("an unmatched region marker folds nothing", () => {
        assert.deepEqual(fold(script("-- #endregion", "SELECT 1;")).described, []);
        assert.deepEqual(fold(script("-- #region open", "SELECT 1;")).described, []);
    });

    test("ranges are sorted, uniquely started, and properly nested", () => {
        const { ranges, syntax } = fold(
            script(
                "-- #region all",
                "CREATE PROCEDURE dbo.usp_Do",
                "AS",
                "BEGIN",
                "    IF @a = 1",
                "    BEGIN",
                "        SELECT",
                "            1;",
                "    END",
                "END",
                "-- #endregion",
            ),
        );
        const startLines = ranges.map((range) => syntax.document.positionAt(range.start).line);
        assert.deepEqual(
            [...startLines].sort((a, b) => a - b),
            startLines,
        );
        assert.equal(new Set(startLines).size, startLines.length);
        const open: FoldingRange[] = [];
        for (const range of ranges) {
            while (open.length > 0 && defined(open.at(-1)).end < range.start) open.pop();
            if (open.length > 0) {
                assert.ok(range.end <= defined(open.at(-1)).end, "ranges must nest");
            }
            open.push(range);
        }
    });

    test("ends stop at the last line of content, not on the blank lines after it", () => {
        const { ranges, syntax } = fold(script("SELECT", "    1;", "", "", "SELECT 2;"));
        assert.equal(ranges.length, 1);
        const range = ranges[0];
        assert.ok(range);
        assert.equal(syntax.document.positionAt(range.end).line, 1);
        const remainderOfLine = defined(syntax.document.text.slice(range.end).split(/\r?\n/u)[0]);
        assert.equal(remainderOfLine.trim(), ";");
    });

    test("damaged input still folds what parsed and invents nothing", () => {
        const { described, syntax } = fold(
            script("CREATE PROCEDURE dbo.usp_Do", "AS", "BEGIN", "    SELECT * FROM;"),
        );
        assert.ok(syntax.diagnostics.length > 0);
        assert.deepEqual(described, ["0-3 code", "2-3 code"]);
    });

    test("an empty document folds nothing", () => {
        assert.deepEqual(fold("").described, []);
        assert.deepEqual(fold("\n\n\n").described, []);
    });
});
