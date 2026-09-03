/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import type { SemanticDiagnostic } from "../../../../src/index.ts";
import { analyzeSql, createMetadata } from "../../support/semanticHarness.ts";

const batchDiagnostics = (diagnostics: readonly SemanticDiagnostic[]) =>
    diagnostics.filter(({ code }) => code === "MustBeOnlyStatementInBatch");

async function analyze(sql: string, allowSyntaxDiagnostics = false) {
    return analyzeSql(sql, createMetadata(), { allowSyntaxDiagnostics });
}

suite("T-SQL batch contract diagnostics", () => {
    test("requires every batch-isolated statement family to be the sole statement", async () => {
        const cases = [
            ["CREATE SCHEMA s; SELECT 1;", "CREATE SCHEMA"],
            ["CREATE RULE r AS 1 > 0; SELECT 1;", "CREATE RULE"],
            ["CREATE DEFAULT d AS 0; SELECT 1;", "CREATE DEFAULT"],
            [
                "SELECT 0; CREATE FUNCTION f() RETURNS int AS BEGIN RETURN 1; END;",
                "CREATE FUNCTION",
            ],
            ["SELECT 0; ALTER FUNCTION f() RETURNS int AS BEGIN RETURN 1; END;", "ALTER FUNCTION"],
            ["SELECT 0; CREATE PROCEDURE p AS SELECT 1;", "CREATE PROCEDURE"],
            ["SELECT 0; ALTER PROCEDURE p AS SELECT 1;", "ALTER PROCEDURE"],
            ["SELECT 0; CREATE TRIGGER tr ON t AFTER INSERT AS SELECT 1;", "CREATE TRIGGER"],
            ["SELECT 0; ALTER TRIGGER tr ON t AFTER INSERT AS SELECT 1;", "ALTER TRIGGER"],
            ["SELECT 0; CREATE VIEW v AS SELECT 1 AS x;", "CREATE VIEW"],
            ["SELECT 0; ALTER VIEW v AS SELECT 1 AS x;", "ALTER VIEW"],
            ["CREATE PROCEDURE p AS EXTERNAL NAME a.b.c; SELECT 1;", "CREATE PROCEDURE"],
            [
                "CREATE TRIGGER tr ON DATABASE FOR DDL_DATABASE_LEVEL_EVENTS AS EXTERNAL NAME a.b.c; SELECT 1;",
                "CREATE TRIGGER",
            ],
        ] as const;

        for (const [sql, phrase] of cases) {
            assert.deepEqual(
                batchDiagnostics(await analyze(sql)).map(({ message }) => message),
                [`Incorrect syntax: '${phrase}' must be the only statement in the batch.`],
                sql,
            );
        }
    });

    test("accepts isolated statements, batch separators, schema elements, and DROP RULE or DEFAULT", async () => {
        const cases = [
            "CREATE SCHEMA s;",
            "CREATE SCHEMA s CREATE TABLE t(i int);",
            "CREATE SCHEMA s CREATE VIEW v AS SELECT 1 AS x;",
            "CREATE SCHEMA s\nGO\nSELECT 1;",
            "CREATE RULE r AS 1 > 0;",
            "CREATE DEFAULT d AS 0;",
            "DROP RULE r; SELECT 1;",
            "DROP DEFAULT d; SELECT 1;",
        ];

        for (const sql of cases) {
            assert.deepEqual(batchDiagnostics(await analyze(sql)), [], sql);
        }
    });

    test("rejects batch-isolated statements nested in control flow or module bodies", async () => {
        const cases = [
            ["BEGIN CREATE SCHEMA s; END;", "CREATE SCHEMA"],
            ["IF 1 = 1 CREATE VIEW v AS SELECT 1 AS x;", "CREATE VIEW"],
            [
                "BEGIN CREATE FUNCTION f() RETURNS int AS BEGIN RETURN 1; END; END;",
                "CREATE FUNCTION",
            ],
            ["BEGIN CREATE RULE r AS 1 > 0; END;", "CREATE RULE"],
            ["BEGIN CREATE DEFAULT d AS 0; END;", "CREATE DEFAULT"],
            ["BEGIN CREATE PROCEDURE p AS EXTERNAL NAME a.b.c; END;", "CREATE PROCEDURE"],
            [
                "BEGIN CREATE TRIGGER tr ON DATABASE FOR DDL_DATABASE_LEVEL_EVENTS AS EXTERNAL NAME a.b.c; END;",
                "CREATE TRIGGER",
            ],
            ["CREATE PROCEDURE p AS CREATE VIEW v AS SELECT 1 AS x;", "CREATE VIEW"],
        ] as const;

        for (const [sql, phrase] of cases) {
            assert.deepEqual(
                batchDiagnostics(await analyze(sql)).map(({ message }) => message),
                [`Incorrect syntax: '${phrase}' must be the only statement in the batch.`],
                sql,
            );
        }
    });

    test("does not duplicate the syntax diagnostic for nested Transact-SQL modules", async () => {
        const cases = [
            "BEGIN CREATE PROCEDURE p AS SELECT 1; END;",
            "BEGIN CREATE TRIGGER tr ON t AFTER INSERT AS SELECT 1; END;",
        ];
        for (const sql of cases) {
            assert.deepEqual(batchDiagnostics(await analyze(sql, true)), [], sql);
        }
    });

    test("uses the underlying CREATE phrase for CREATE OR ALTER statements", async () => {
        const cases = [
            [
                "SELECT 0; CREATE OR ALTER FUNCTION f() RETURNS int AS BEGIN RETURN 1; END;",
                "CREATE FUNCTION",
            ],
            ["SELECT 0; CREATE OR ALTER PROCEDURE p AS SELECT 1;", "CREATE PROCEDURE"],
            [
                "SELECT 0; CREATE OR ALTER TRIGGER tr ON t AFTER INSERT AS SELECT 1;",
                "CREATE TRIGGER",
            ],
            ["SELECT 0; CREATE OR ALTER VIEW v AS SELECT 1 AS x;", "CREATE VIEW"],
        ] as const;

        for (const [sql, phrase] of cases) {
            assert.deepEqual(
                batchDiagnostics(await analyze(sql)).map(({ message }) => message),
                [`Incorrect syntax: '${phrase}' must be the only statement in the batch.`],
                sql,
            );
        }
    });

    test("does not add a batch error to an incomplete module definition", async () => {
        const cases = [
            "SELECT 1; CREATE VIEW",
            "SELECT 1; ALTER VIEW",
            "SELECT 1; CREATE FUNCTION",
            "SELECT 1; ALTER FUNCTION",
            "SELECT 1; CREATE PROCEDURE",
            "SELECT 1; ALTER PROCEDURE",
            "SELECT 1; CREATE TRIGGER",
            "SELECT 1; ALTER TRIGGER",
            "SELECT 1; CREATE RULE",
            "SELECT 1; CREATE DEFAULT",
        ];

        for (const sql of cases) {
            assert.deepEqual(batchDiagnostics(await analyze(sql, true)), [], sql);
        }
    });

    test("distinguishes an uncommitted schema element from an incomplete committed element", async () => {
        const uncommitted = [
            "CREATE SCHEMA testconf\nCREATE TABLE testconf.te",
            "CREATE SCHEMA s\nCREATE TABLE t(",
            "CREATE SCHEMA s\nCREATE VIEW v",
            "CREATE SCHEMA s\nCREATE VIEW v AS",
            "CREATE SCHEMA s\nGRANT SELECT ON t TO",
        ];
        for (const sql of uncommitted) {
            assert.deepEqual(
                batchDiagnostics(await analyze(sql, true)).map(({ message }) => message),
                ["Incorrect syntax: 'CREATE SCHEMA' must be the only statement in the batch."],
                sql,
            );
        }

        const committed = [
            "CREATE SCHEMA s\nCREATE TABLE t(i",
            "CREATE SCHEMA s\nCREATE TABLE t(i int",
            "CREATE SCHEMA s\nCREATE VIEW v AS SELECT",
        ];
        for (const sql of committed) {
            assert.deepEqual(batchDiagnostics(await analyze(sql, true)), [], sql);
        }
    });
});
