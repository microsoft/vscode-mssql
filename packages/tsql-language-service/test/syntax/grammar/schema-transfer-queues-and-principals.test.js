/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

// Every positive form here was confirmed against ScriptDOM before the grammar was changed, and
// every rejected neighbour below was confirmed to be rejected by ScriptDOM too.
const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { assertValid, parse } = createSyntaxHarness("schema-transfer-queues-and-principals.sql");

suite("T-SQL schema transfers, queues, certificates, and principal options", () => {
    // A transferred object may name its securable class.
    test("parses ALTER SCHEMA TRANSFER with a securable class", () => {
        assertValid("alter schema sc1 transfer a1.b1");
        assertValid("alter schema sc1 transfer type::t1");
        assertValid("alter schema sc1 transfer object::a2.b2");
        assertValid("alter schema sc1 transfer xml schema collection::c1");
    });

    // CREATE DEFAULT binds a legacy standalone value expression, as CREATE RULE binds a predicate.
    test("parses CREATE DEFAULT", () => {
        assertValid("create default dbo.r1 as (-10)");
        assertValid("create default piConstant as 3.14");
        assertValid("create rule r1 as @a1 > 10");
        assertValid("drop default d1");
    });

    // A queue activation names the principal its procedure runs as.
    test("parses queue activation options", () => {
        assertValid("create queue dbo.q1");
        assertValid("create queue [q1] on [filegroup]");
        assertValid("create queue db.dbo.q1 with status = off");
        assertValid(
            "create queue q1 with status = on, Activation(status = on, procedure_name = dbo..p1, max_queue_readers = 23, execute as self), retention = off",
        );
        assertValid(
            "ALTER QUEUE ExpenseQueue WITH ACTIVATION (PROCEDURE_NAME = dbo.qspProcessExpenseQueue, EXECUTE AS 'dbo')",
        );
    });

    // Undocumented certificate attestation forms the product still accepts.
    test("parses certificate attestation forms", () => {
        assertValid("alter certificate c1 remove attested option");
        assertValid("alter certificate c1 attested by 'zzz'");
        assertValid("alter certificate c1 remove private key");
        assertValid("alter certificate c1 with active for begin_dialog = on");
    });

    // A contained user names its language by LCID and clears its default schema with NULL.
    test("parses contained user option values", () => {
        assertValid(
            "create user contained_user with password = 'foo', default_language = 1033, default_schema=dbo, sid = 0xdeadbeef",
        );
        assertValid("create user [domain\\user] with default_schema=null");
        assertValid("alter user user1 with default_schema=null");
        assertValid("alter user u1 with password = 'foo', default_language = none");
    });

    // ALTER LOGIN accepts HASHED beside the other password modifiers.
    test("parses HASHED on ALTER LOGIN", () => {
        assertValid("alter login l1 with password = N'PLACEHOLDER1' hashed");
        assertValid("alter login l1 with password = 'PLACEHOLDER1' unlock must_change");
        assertValid(
            "create login l1 with password = 'p1' hashed, sid = 0x10, default_database = db1, check_expiration = on",
        );
    });

    // A CLR table function orders its result after the WITH clause.
    test("parses a CLR table function ORDER clause after WITH", () => {
        assertValid(
            "CREATE FUNCTION [dbo].[TableFunction2](@param1 int) RETURNS TABLE (c1 int, c3 datetime) WITH EXECUTE AS 'User1' ORDER(c3 DESC, c1 ASC) AS EXTERNAL NAME CLR1.UserDefinedFunctions.TableFunction1",
        );
        assertValid(
            "CREATE FUNCTION dbo.f(@p int) RETURNS TABLE (c1 int) ORDER(c1 ASC) AS EXTERNAL NAME a.b.c",
        );
    });

    // IS [NOT] DISTINCT FROM must not regress.
    test("keeps IS DISTINCT FROM intact", () => {
        assertValid("SELECT a FROM t1 WHERE t1.id IS NOT DISTINCT FROM 1;");
        assertValid("SELECT a FROM t1 WHERE t1.id IS DISTINCT FROM NULL;");
        assertValid("SELECT a FROM t1 WHERE t1.id IS NOT NULL;");
    });

    // Neighbours the product rejects must not parse as clean T-SQL here either.
    test("rejects neighbours that the product rejects", () => {
        for (const sql of [
            "create user u1 with default_database = 1033",
            "create user u1 with default_language = null",
            "create user u1 with name = null",
            "CREATE FUNCTION dbo.f(@p int) RETURNS TABLE (c1 int) ORDER(c1 ASC) WITH EXECUTE AS 'U' AS EXTERNAL NAME a.b.c",
            "create queue q1 with activation(execute as caller)",
        ]) {
            assert.ok(parse(sql).statistics.rawErrorNodeCount > 0, sql);
        }
    });

    // ACTIVATION(DROP) turns a queue's activation off by naming DROP as the option, with no value
    // after it. ScriptDOM's TSql170Parser accepts it and the conformance corpus contains it, so it
    // was previously listed as a neighbour to reject on an assumption the oracle does not support.
    test("accepts a queue activation turned off by DROP", () => {
        for (const sql of [
            "alter queue dbo.q1 with activation(drop)",
            "alter queue dbo.q1 with status = on, activation(drop)",
            "alter queue dbo.q1 with poison_message_handling(status = off), activation(drop)",
        ]) {
            assert.equal(parse(sql).statistics.rawErrorNodeCount, 0, sql);
        }
    });

    // A damaged schema transfer must not leak past its GO batch.
    test("keeps a damaged schema transfer inside its GO batch", () => {
        const snapshot = parse("alter schema sc1 transfer type::\nGO\nSELECT 1;");
        assert.ok(snapshot.diagnostics.length > 0);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
        assert.equal(parse("SELECT 1;").statistics.rawErrorNodeCount, 0);
    });
});
