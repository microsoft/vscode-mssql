/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";

const { assertValid, parse } = createSyntaxHarness("statement-contract-diagnostics.sql");

const messages = (sql: string): readonly string[] =>
    parse(sql).diagnostics.map(({ message }) => message);

suite("table-valued function body contracts", () => {
    test("accepts each return type with the body it takes", () => {
        assertValid("CREATE FUNCTION f() RETURNS TABLE AS RETURN (SELECT 1 AS c)");
        assertValid("CREATE FUNCTION f() RETURNS TABLE AS RETURN SELECT 1 AS c");
        assertValid("CREATE FUNCTION f() RETURNS @t TABLE (c int) AS BEGIN RETURN END");
        assertValid("CREATE FUNCTION f() RETURNS TABLE (c int) AS EXTERNAL NAME asm.cls.mth");
        assertValid("CREATE FUNCTION f() RETURNS TABLE (c int) EXTERNAL NAME asm.cls.mth");
        assertValid("ALTER FUNCTION f() RETURNS TABLE AS RETURN (SELECT 1 AS c)");
        // A common table expression makes the parser mount the body as a module, which does not
        // make it a block.
        assertValid(
            "CREATE FUNCTION f() RETURNS TABLE AS RETURN WITH c AS (SELECT 1 x) SELECT x FROM c",
        );
    });

    test("requires an external entry point when the result shape is declared", () => {
        assert.deepEqual(
            messages(
                "CREATE FUNCTION f() RETURNS TABLE (col1 int NOT NULL, col2 varchar(100))" +
                    " AS RETURN select 1 as bar",
            ),
            ["Incorrect syntax near 'RETURN'.  Expecting EXTERNAL."],
        );
        assert.deepEqual(
            messages("CREATE FUNCTION f() RETURNS TABLE (col1 int) AS BEGIN return END"),
            ["Incorrect syntax near 'BEGIN'.  Expecting EXTERNAL."],
        );
    });

    test("rejects a block body on an inline table function", () => {
        assert.deepEqual(messages("CREATE FUNCTION f() RETURNS TABLE AS BEGIN return END"), [
            "Incorrect syntax near 'BEGIN return END'.",
        ]);
    });
});

suite("collation name diagnostics", () => {
    test("accepts a collation named by a plain identifier", () => {
        assertValid("DECLARE @t TABLE (c varchar(20) COLLATE Albanian_100_BIN)");
        assertValid("CREATE TABLE t (c varchar(20) COLLATE Latin1_General_CI_AS)");
    });

    test("rejects a delimited collation name", () => {
        assert.deepEqual(messages("DECLARE @t TABLE (c varchar(20) COLLATE [Albanian_100_BIN])"), [
            "Incorrect syntax near '[Albanian_100_BIN]'.",
        ]);
    });
});

suite("event session and backup option contracts", () => {
    test("accepts the documented unit words and bare option values", () => {
        assertValid("ALTER EVENT SESSION [s] ON SERVER WITH (MAX_DURATION = 20 MINUTES)");
        assertValid("ALTER EVENT SESSION [s] ON SERVER WITH (MAX_DURATION = 45 SECONDS)");
        assertValid("ALTER EVENT SESSION [s] ON SERVER WITH (MAX_DURATION = 3 HOURS)");
        assertValid("ALTER EVENT SESSION [s] ON SERVER WITH (MAX_DURATION = 2 DAYS)");
        assertValid("ALTER EVENT SESSION [s] ON SERVER WITH (MAX_MEMORY = 4096 KB)");
        assertValid(
            "ALTER EVENT SESSION [s] ON SERVER WITH" +
                " (EVENT_RETENTION_MODE = ALLOW_SINGLE_EVENT_LOSS)",
        );
    });

    test("rejects a word that is not a unit", () => {
        assert.deepEqual(
            messages("ALTER EVENT SESSION [s] ON SERVER WITH (MAX_DURATION = 2 foo)"),
            ["Incorrect syntax near 'foo'."],
        );
    });

    test("accepts backup compression with and without its algorithm", () => {
        assertValid("BACKUP DATABASE [a] TO DISK = 'd' WITH COMPRESSION, STATS = 10");
        assertValid("BACKUP DATABASE [a] TO DISK = 'd' WITH COMPRESSION (ALGORITHM = ms_xpress)");
    });

    test("rejects a backup compression option other than the algorithm", () => {
        assert.deepEqual(
            messages("BACKUP DATABASE [a] TO DISK = 'd' WITH COMPRESSION (MYWORD = ms_xpress)"),
            ["Incorrect syntax near 'MYWORD'.  Expecting ALGORITHM."],
        );
    });
});

suite("predicate function operands", () => {
    test("accepts a predicate function in a condition", () => {
        assertValid("SELECT * FROM t WHERE REGEXP_LIKE(name, 'tbl')");
        assertValid("SELECT CASE WHEN REGEXP_LIKE(name, 't') THEN 1 ELSE 0 END FROM t");
        assertValid("SELECT REGEXP_REPLACE(a, 'b', 'c') FROM t WHERE x > 1");
    });

    test("rejects a predicate function used as a compared value", () => {
        assert.deepEqual(messages("SELECT 1 WHERE REGEXP_LIKE('abc', 'ab')>1"), [
            "Incorrect syntax near '>'.",
        ]);
        assert.deepEqual(messages("SELECT 1 WHERE 1 < REGEXP_LIKE('abc', 'ab')"), [
            "Incorrect syntax near '<'.",
        ]);
    });
});

suite("option clause and table definition expectations", () => {
    test("names the parenthesis an option clause is missing", () => {
        const sql =
            "CREATE TYPE dbo.t AS TABLE (c1 int NOT NULL," +
            " INDEX ix HASH (c1) WITH BUCKET_COUNT = 1024 ) WITH (MEMORY_OPTIMIZED = ON)";
        assert.ok(
            messages(sql).includes("Incorrect syntax near 'BUCKET_COUNT'.  Expecting '('."),
            JSON.stringify(messages(sql)),
        );
    });

    test("names what may follow a table element", () => {
        const sql =
            "CREATE TYPE dbo.t AS TABLE (c1 int NOT NULL," +
            " INDEX ix HASH (c1) WITH (BUCKET_COUNT = 1024 ) WITH (MEMORY_OPTIMIZED = ON)";
        assert.ok(
            messages(sql).includes("Incorrect syntax near 'WITH'.  Expecting ')', or ','."),
            JSON.stringify(messages(sql)),
        );
    });
});

suite("unclosed run reporting", () => {
    // The run is quoted as written, so the reader sees the delimiter the scanner is still inside.
    test("quotes an unclosed run including its opening delimiter", () => {
        assert.deepEqual(messages("SELECT 'unfinished"), [
            "Unclosed quotation mark after the character string ''unfinished'.",
        ]);
        assert.deepEqual(messages("SELECT 'foo from t'' go"), [
            "Unclosed quotation mark after the character string ''foo from t'' go'.",
        ]);
        assert.deepEqual(messages('SELECT * FROM db."foo go'), [
            "Unclosed quotation mark after the character string '\"foo go'.",
        ]);
    });
});

suite("argument list recovery tails", () => {
    test("reports each call a damaged argument list can no longer place", () => {
        assert.deepEqual(
            messages("SELECT ai_generate_embeddings('txt' PARAMETERS (TRY_CONVERT(JSON, N'{}')))"),
            [
                "Incorrect syntax near 'PARAMETERS'.",
                "Incorrect syntax near 'TRY_CONVERT'.  Expecting '(', or SELECT.",
                "Incorrect syntax near 'JSON'.  Expecting '(', or SELECT.",
            ],
        );
    });

    test("leaves a healthy argument list alone", () => {
        assertValid("SELECT f(a, g(b)) FROM t");
        assertValid("SELECT COALESCE((SELECT 1), 2)");
    });
});

suite("shapes the grammar must accept", () => {
    // Each of these was reported by an earlier rule or lexer state and is valid Transact-SQL.
    test("accepts a decimal literal written without a leading digit", () => {
        assertValid("UPDATE t SET Bonus = 6000, CommissionPct = .10");
        assertValid("SELECT .5, .5e3 FROM t");
    });

    test("keeps a leading dot available to a name that starts with one", () => {
        assertValid("SELECT * FROM ..t");
    });

    test("accepts a root element name in every FOR XML mode", () => {
        assertValid("SELECT 1 AS c FOR XML AUTO, ROOT ('x')");
        assertValid("SELECT 1 AS c FOR XML RAW ('r'), ROOT ('x')");
        assert.deepEqual(messages("SELECT 1 AS c FOR XML AUTO ('r')"), [
            "Row tag name is only allowed with RAW or PATH mode of FOR XML.",
        ]);
    });

    test("accepts a comment between WITH and CHECK OPTION", () => {
        assertValid("CREATE VIEW v AS SELECT 1 AS c WITH /* embedded */ CHECK OPTION");
        assertValid("CREATE VIEW v AS SELECT 1 AS c WITH CHECK OPTION");
    });

    test("accepts a trigger statement as a controlled statement", () => {
        assertValid("IF 1 = 1 DISABLE TRIGGER a ON b");
        assertValid("IF EXISTS (SELECT 1) ENABLE TRIGGER a ON b");
        assertValid("IF 1 = 1 SELECT 1 ELSE SELECT 2");
    });

    test("accepts the permission and storage spellings the product documents", () => {
        assertValid("GRANT ALTER ANY DATABASE EVENT SESSION OPTION TO guest");
        assertValid("GRANT ADMINISTER DATABASE BULK OPERATIONS TO guest");
        assertValid("CREATE SEMANTIC INDEX ix ON t (c) WITH (EXTERNAL_MODEL = m) ON FILEGROUP fg");
    });

    test("accepts a common table expression inside a returned query", () => {
        assertValid(
            "CREATE FUNCTION f() RETURNS TABLE AS RETURN (WITH c AS (SELECT 1 x) SELECT x FROM c)",
        );
    });
});
