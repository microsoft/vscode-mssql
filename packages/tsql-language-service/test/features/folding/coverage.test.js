/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    collectFoldingRanges,
    ImmutableTextSnapshot,
    LezerSyntaxService,
} = require("../../../dist/index.js");
const { describeRanges, fold, script } = require("../../support/foldingHarness.js");

suite("folding coverage", () => {
    test("pairs a transaction with the statement that closes it", () => {
        assert.deepEqual(
            fold(script("BEGIN TRANSACTION;", "    UPDATE dbo.T SET a = 1;", "COMMIT TRANSACTION;"))
                .described,
            ["0-2 code"],
        );
        assert.deepEqual(
            fold(script("BEGIN TRANSACTION;", "    SELECT 1;", "ROLLBACK TRANSACTION;")).described,
            ["0-2 code"],
        );
    });

    test("pairs nested transactions innermost first", () => {
        const { described } = fold(
            script(
                "BEGIN TRAN;",
                "    BEGIN TRAN;",
                "        SELECT 1;",
                "    COMMIT;",
                "ROLLBACK;",
            ),
        );
        assert.deepEqual(described, ["0-4 code", "1-3 code"]);
    });

    test("an unclosed transaction folds nothing", () => {
        assert.deepEqual(fold(script("BEGIN TRAN;", "    SELECT 1;")).described, []);
    });

    test("folds clauses that begin with their own keyword", () => {
        const { described } = fold(
            script(
                "SELECT a",
                "FROM dbo.T",
                "WHERE a IN (",
                "    1,",
                "    2",
                ")",
                "GROUP BY",
                "    a",
                "HAVING",
                "    COUNT(*) > 1",
                "ORDER BY",
                "    a;",
            ),
        );
        assert.deepEqual(described, [
            "0-11 code",
            "2-5 code",
            "6-7 code",
            "8-9 code",
            "10-11 code",
        ]);
    });

    test("folds bracketed hint, option, constraint, and rowset clauses", () => {
        assert.deepEqual(
            fold(script("SELECT a", "FROM dbo.T WITH (", "    NOLOCK", ");")).described.at(-1),
            "1-3 code",
        );
        assert.deepEqual(
            fold(script("CREATE INDEX ix ON dbo.T (a)", "WITH (", "    ONLINE = ON", ");"))
                .described,
            ["0-3 code", "1-3 code"],
        );
        assert.deepEqual(
            fold(
                script(
                    "CREATE TABLE dbo.T (",
                    "    a int,",
                    "    CONSTRAINT pk PRIMARY KEY (",
                    "        a",
                    "    )",
                    ");",
                ),
            ).described,
            ["0-5 code", "2-4 code"],
        );
        assert.deepEqual(
            fold(
                script(
                    "SELECT *",
                    "FROM dbo.T",
                    "PIVOT (",
                    "    SUM(a)",
                    "    FOR b IN ([x])",
                    ") AS p;",
                ),
            ).described,
            ["0-5 code", "1-5 code", "2-5 code"],
        );
        assert.deepEqual(
            fold(
                script(
                    "SELECT SUM(a) OVER w",
                    "FROM dbo.T",
                    "WINDOW w AS (",
                    "    PARTITION BY b",
                    ");",
                ),
            ).described.at(-1),
            "2-4 code",
        );
    });

    test("folds a string literal that runs over several lines", () => {
        const { described } = fold(script("EXEC sp_executesql", "    N'", "SELECT 1;", "';"));
        assert.deepEqual(described, ["0-3 code", "1-3 code"]);
    });

    test("matches the region markers the language configuration declares", () => {
        assert.deepEqual(
            fold(script("-- #REGION Setup", "SELECT 1;", "SELECT 2;", "-- #ENDREGION")).described,
            ["0-3 region"],
        );
        assert.deepEqual(
            fold(script("-- #region  Load data", "SELECT 1;", "SELECT 2;", "-- #endregion Load"))
                .described,
            ["0-3 region"],
        );
        assert.deepEqual(
            fold(script("--#region", "SELECT 1;", "SELECT 2;", "--#endregion")).described,
            ["0-3 region"],
        );
    });

    test("spends a range budget on the widest regions", () => {
        const sql = script(
            "CREATE PROCEDURE dbo.usp_Do",
            "AS",
            "BEGIN",
            "    IF @a = 1",
            "    BEGIN",
            "        SELECT",
            "            1;",
            "    END",
            "END",
        );
        const syntax = new LezerSyntaxService().parse(
            new ImmutableTextSnapshot("file:///budget.sql", 1, sql),
        );
        const all = collectFoldingRanges(syntax);
        assert.ok(all.length > 3);

        const limited = collectFoldingRanges(syntax, { limit: 2 });
        assert.equal(limited.length, 2);
        assert.deepEqual(describeRanges(limited, syntax), describeRanges(all.slice(0, 2), syntax));
        assert.deepEqual(collectFoldingRanges(syntax, { limit: 0 }), []);
        assert.deepEqual(collectFoldingRanges(syntax, { limit: all.length }), all);
    });

    test("a budget keeps ranges sorted and properly nested", () => {
        let sql = "";
        for (let index = 0; index < 40; index++) {
            sql += script("IF @a = 1", "BEGIN", "    SELECT", "        1;", "END", "");
        }
        const syntax = new LezerSyntaxService().parse(
            new ImmutableTextSnapshot("file:///budget.sql", 1, sql),
        );
        const limited = collectFoldingRanges(syntax, { limit: 25 });
        assert.equal(limited.length, 25);
        const open = [];
        let previousStart = -1;
        for (const range of limited) {
            assert.ok(range.start > previousStart);
            previousStart = range.start;
            while (open.length > 0 && open.at(-1) < range.start) open.pop();
            if (open.length > 0) assert.ok(range.end <= open.at(-1));
            open.push(range.end);
        }
    });
});
