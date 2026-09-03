/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";

const { parse } = createSyntaxHarness("module-placement.sql");

suite("T-SQL module placement diagnostics", () => {
    test("rejects nested Transact-SQL procedure and trigger bodies", () => {
        const cases = [
            "BEGIN CREATE PROCEDURE p AS SELECT 1; END;",
            "IF 1 = 1 ALTER PROCEDURE p AS SELECT 1;",
            "BEGIN CREATE TRIGGER tr ON t AFTER INSERT AS SELECT 1; END;",
            "IF 1 = 1 ALTER TRIGGER tr ON t AFTER INSERT AS SELECT 1;",
        ];

        for (const sql of cases) {
            const diagnostics = parse(sql).diagnostics;
            assert.deepEqual(
                diagnostics.map(({ code, message, range }) => ({
                    code,
                    message,
                    text: sql.slice(range.start, range.end),
                })),
                [
                    {
                        code: "syntax",
                        message: "Incorrect syntax near 'SELECT'.  Expecting EXTERNAL.",
                        text: "SELECT",
                    },
                ],
                sql,
            );
        }
    });

    test("accepts top-level Transact-SQL module bodies", () => {
        const sql = `CREATE PROCEDURE p AS SELECT 1;
GO
ALTER PROCEDURE p AS SELECT 2;
GO
CREATE TRIGGER tr ON t AFTER INSERT AS SELECT 1;
GO
ALTER TRIGGER tr ON t AFTER INSERT AS SELECT 2;`;
        assert.deepEqual(parse(sql).diagnostics, []);
    });

    test("leaves nested external modules to the batch-contract validator", () => {
        const cases = [
            "BEGIN CREATE PROCEDURE p AS EXTERNAL NAME a.b.c; END;",
            "BEGIN CREATE TRIGGER tr ON DATABASE FOR DDL_DATABASE_LEVEL_EVENTS AS EXTERNAL NAME a.b.c; END;",
        ];
        for (const sql of cases) assert.deepEqual(parse(sql).diagnostics, [], sql);
    });
});
