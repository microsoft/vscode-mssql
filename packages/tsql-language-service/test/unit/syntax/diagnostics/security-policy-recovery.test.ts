/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";

const { assertValid, parse } = createSyntaxHarness("security-policy-recovery.sql");

const messages = (sql: string): readonly string[] =>
    parse(sql).diagnostics.map(({ message }) => message);

suite("security policy recovery diagnostics", () => {
    test("accepts the supported policy shapes", () => {
        assertValid("CREATE SECURITY POLICY sec1 ADD FILTER PREDICATE dbo.f1(c1) ON dbo.t1");
        assertValid(
            "CREATE SECURITY POLICY sec1 ADD FILTER PREDICATE dbo.f1(c1) ON dbo.t1," +
                " ADD BLOCK PREDICATE dbo.f2(c2) ON dbo.t2 AFTER UPDATE",
        );
        assertValid(
            "CREATE SECURITY POLICY sec1 ADD FILTER PREDICATE dbo.f1(c1) ON dbo.t1" +
                " WITH (STATE = ON, SCHEMABINDING = OFF) NOT FOR REPLICATION",
        );
        assertValid("ALTER SECURITY POLICY sec1 DROP FILTER PREDICATE ON dbo.t1");
        assertValid("ALTER SECURITY POLICY sec1 ALTER BLOCK PREDICATE dbo.f1(c1) ON dbo.t1");
        assertValid("ALTER SECURITY POLICY sec1 ADD NOT FOR REPLICATION");
    });

    test("reports a predicate kind the policy does not define", () => {
        assert.deepEqual(
            messages("ALTER SECURITY POLICY sec1 ADD FILTE PREDICATE dbo.f1(c1) ON dbo.t1"),
            [
                "Incorrect syntax near 'FILTE'.  Expecting NOT_FOR, SP_BLOCK, or SP_FILTER.",
                "Incorrect syntax near 'c1'.  Expecting '(', or SELECT.",
            ],
        );
    });

    test("reports a missing separator between predicate actions", () => {
        assert.deepEqual(
            messages(
                "ALTER SECURITY POLICY sec2 ADD FILTER PREDICATE dbo.f1(c1) ON dbo.t1" +
                    " ADD FILTER PREDICATE dbo.f2(c2) ON dbo.t2",
            ),
            [
                "Incorrect syntax near 'FILTER'.  Expecting ADD_COUNTER, ADD_SENSITIVITY, or ADD_SIGNATURE.",
                "Incorrect syntax near 'c2'.  Expecting '(', or SELECT.",
            ],
        );
    });

    test("reports a predicate expression in a DROP action", () => {
        assert.deepEqual(
            messages("ALTER SECURITY POLICY sec1 DROP BLOCK PREDICATE dbo.f1(c1) ON dbo.t2"),
            [
                "Incorrect syntax near 'dbo'.  Expecting ON.",
                "Incorrect syntax near 'c1'.  Expecting '(', or SELECT.",
            ],
        );
    });

    test("reports an unclosed predicate argument list", () => {
        assert.deepEqual(
            messages("CREATE SECURITY POLICY sec1 ADD FILTER PREDICATE dbo.f1(c1 ON dbo.t1"),
            ["Incorrect syntax near 'ON'."],
        );
    });

    test("reports a misspelled ON and the action that follows it", () => {
        assert.deepEqual(
            messages(
                "CREATE SECURITY POLICY sec2 ADD FILTER PREDICATE dbo.f1(c1) O dbo.t1," +
                    " ADD FILTER PREDICATE dbo.f2(c2) ON dbo.t2",
            ),
            ["Incorrect syntax near 'O'.  Expecting ON.", "Incorrect syntax near 'ADD'."],
        );
    });

    test("reports a policy option value that is not a switch", () => {
        assert.deepEqual(
            messages(
                "CREATE SECURITY POLICY sec2 ADD FILTER PREDICATE dbo.f1(c1) ON dbo.t1" +
                    " WITH (STATE=OFF, SCHEMABINDING=5) NOT FOR REPLICATION",
            ),
            ["Incorrect syntax near '5'.  Expecting OFF, or ON."],
        );
    });

    test("reports a misspelled replication clause", () => {
        assert.deepEqual(
            messages(
                "CREATE SECURITY POLICY sec2 ADD BLOCK PREDICATE dbo.f2(c2) ON dbo.t2" +
                    " WITH (SCHEMABINDING=ON) NOT FOR RPLICATION",
            ),
            ["Incorrect syntax near 'RPLICATION'.  Expecting REPLICATION."],
        );
    });

    test("bounds recovery to the policy statement that owns it", () => {
        const sql =
            "CREATE SECURITY POLICY a ADD FILTER PREDICATE dbo.f(c) ON dbo.t;\n" +
            "GO\n" +
            "SELECT 1;\n" +
            "GO\n" +
            "CREATE SECURITY POLICY b ADD FILTE PREDICATE dbo.f(c) ON dbo.t;\n";
        assert.deepEqual(messages(sql), [
            "Incorrect syntax near 'FILTE'.  Expecting NOT_FOR, SP_BLOCK, or SP_FILTER.",
            "Incorrect syntax near 'c'.  Expecting '(', or SELECT.",
        ]);
    });

    test("ignores policy words written inside comments and strings", () => {
        assertValid(
            "-- CREATE SECURITY POLICY p ADD FILTE PREDICATE dbo.f(c) ON dbo.t\n" +
                "SELECT 'ALTER SECURITY POLICY p DROP BLOCK PREDICATE dbo.f(c) ON dbo.t' AS c",
        );
    });
});
