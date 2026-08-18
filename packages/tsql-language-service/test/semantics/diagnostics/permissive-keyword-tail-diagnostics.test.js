/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
// Three productions accept a bare identifier where the product accepts only a fixed vocabulary:
// the words leading a KILL variant, the option that may carry ON PARTITIONS, and the
// boolean-valued function option. The grammar stays permissive so a misspelling keeps an exact
// range instead of collapsing into recovery. These tests are the other half of that trade. Every
// expectation below was taken from ScriptDOM's own output for the same input.
const { createSemanticHarness } = require("../../support/semanticHarness.js");
const { analyze } = createSemanticHarness({ uri: "file:///permissive-tails.sql" });

const codesAndMessages = async (sql) =>
    (await analyze(sql)).map(({ code, message }) => [code, message]);

suite("T-SQL permissive keyword tail validation", () => {
    test("reports the first KILL word the product could not reconcile", async () => {
        assert.deepEqual(await codesAndMessages("KILL alpha beta gamma 5;"), [
            ["ExpectedTokenNotFound", "Expected STATS but encountered alpha instead."],
        ]);
        assert.deepEqual(await codesAndMessages("KILL SOMETHING JOB 12;"), [
            ["ExpectedTokenNotFound", "Expected STATS but encountered SOMETHING instead."],
        ]);
        assert.deepEqual(await codesAndMessages("KILL STATS FOO 12;"), [
            ["ExpectedTokenNotFound", "Expected JOB but encountered FOO instead."],
        ]);
        assert.deepEqual(await codesAndMessages("KILL QUERY NOTIFICATION FOO ALL;"), [
            ["ExpectedTokenNotFound", "Expected SUBSCRIPTION but encountered FOO instead."],
        ]);
    });

    test("ranges a rejected KILL word to that word alone", async () => {
        const sql = "KILL STATS FOO 12;";
        const [diagnostic] = await analyze(sql);
        assert.equal(diagnostic.severity, "error");
        assert.equal(sql.slice(diagnostic.range.start, diagnostic.range.end), "FOO");
    });

    test("accepts both KILL keyword sequences", async () => {
        for (const sql of [
            "KILL STATS JOB 1234;",
            "KILL QUERY NOTIFICATION SUBSCRIPTION ALL;",
            "KILL QUERY NOTIFICATION SUBSCRIPTION 12;",
            "KILL 53;",
            "KILL 53 WITH STATUSONLY;",
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
    });

    test("rejects ON PARTITIONS on an option that does not scope to partitions", async () => {
        assert.deepEqual(
            await codesAndMessages(
                "ALTER INDEX i1 ON t1 REBUILD WITH (ONLINE = ON ON PARTITIONS (2));",
            ),
            [["IncorrectSyntaxNear", "Incorrect syntax near 'ON'."]],
        );
        assert.deepEqual(
            await codesAndMessages(
                "ALTER INDEX i1 ON t1 REBUILD WITH (BOGUS_OPTION = ROW ON PARTITIONS (2));",
            ),
            [["IncorrectSyntaxNear", "Incorrect syntax near 'ON'."]],
        );
    });

    test("accepts ON PARTITIONS on both compression settings", async () => {
        for (const sql of [
            "ALTER INDEX i1 ON t1 REBUILD PARTITION = 2 WITH (DATA_COMPRESSION = ROW ON PARTITIONS (2));",
            "CREATE INDEX i1 ON t1 (c1) WITH (XML_COMPRESSION = ON ON PARTITIONS (1 TO 4));",
            "UPDATE STATISTICS t1 s1 WITH RESAMPLE ON PARTITIONS (1, 2);",
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
    });

    test("rejects a boolean-valued function option other than INLINE", async () => {
        assert.deepEqual(
            await codesAndMessages(
                "CREATE FUNCTION dbo.f1() RETURNS int WITH BOGUS = ON AS BEGIN RETURN 1 END;",
            ),
            [["IncorrectSyntaxNear", "Incorrect syntax near 'BOGUS'."]],
        );
    });

    test("accepts INLINE in every function shape", async () => {
        for (const sql of [
            "CREATE FUNCTION dbo.f1() RETURNS int WITH INLINE = ON AS BEGIN RETURN 1 END;",
            "CREATE FUNCTION dbo.f1() RETURNS int WITH INLINE = OFF AS BEGIN RETURN 1 END;",
            "CREATE FUNCTION dbo.f1() RETURNS TABLE WITH INLINE = ON AS RETURN (SELECT 1 AS c);",
            "CREATE FUNCTION dbo.f1() RETURNS @t TABLE (c int) WITH INLINE = ON AS BEGIN RETURN END;",
            "CREATE FUNCTION dbo.f1() RETURNS int WITH INLINE = ON AS EXTERNAL NAME asm.cls.mth;",
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
    });

    // SERVER CERTIFICATE and SERVER ASYMMETRIC KEY belong to a backup ENCRYPTION option. The
    // option grammar is shared by every WITH list, so their placement is a validation rule.
    test("rejects a backup key holder outside the ENCRYPTION option", async () => {
        assert.deepEqual(
            await codesAndMessages(
                "backup database d1 to disk = 'd:' with server certificate = c1;",
            ),
            [["IncorrectSyntaxNear", "Incorrect syntax near 'server'."]],
        );
        assert.deepEqual(
            await codesAndMessages(
                "restore database d1 from disk = 'd' with server certificate = c1;",
            ),
            [["IncorrectSyntaxNear", "Incorrect syntax near 'server'."]],
        );
    });

    test("accepts a backup key holder inside the ENCRYPTION option", async () => {
        for (const sql of [
            "backup database d1 to disk = 'd:' with encryption(algorithm = AES_128, server certificate = cert1);",
            "backup database d1 to disk = 'd' with encryption(algorithm = AES_256, server asymmetric key = k1);",
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
    });

    // A rowset or module name is capped at four parts; a column reference is not. The shared name
    // rule carries both, so the cap is a validation rule reported on the first part beyond it.
    test("rejects a rowset or module name beyond four parts", async () => {
        for (const sql of [
            "exec a.b.c.d.e;",
            "insert into a.b.c.d.e values (1);",
            "delete from a.b.c.d.e;",
            "select * from a.b.c.d.e.f(1);",
        ]) {
            const diagnostics = await analyze(sql);
            const syntax = diagnostics.filter(({ code }) => code === "IncorrectSyntaxNear");
            assert.deepEqual(
                syntax.map(({ message }) => message),
                ["Incorrect syntax near 'e'."],
                sql,
            );
        }
    });

    test("ranges an over-long rowset name to the offending part", async () => {
        const sql = "exec a.b.c.d.e;";
        const [diagnostic] = (await analyze(sql)).filter(
            ({ code }) => code === "IncorrectSyntaxNear",
        );
        assert.equal(sql.slice(diagnostic.range.start, diagnostic.range.end), "e");
    });

    test("accepts a column reference beyond four parts", async () => {
        for (const sql of ["select a.b.c.d.e.f.g from t1;", "select 1 where a.b.c.d.e.f = 1;"]) {
            const syntax = (await analyze(sql)).filter(
                ({ code }) => code === "IncorrectSyntaxNear",
            );
            assert.deepEqual(syntax, [], sql);
        }
    });

    // EXECUTE AS inside an option list names a queue activation principal and nothing else.
    test("rejects EXECUTE AS outside a queue ACTIVATION option", async () => {
        assert.deepEqual(
            await codesAndMessages("backup database d1 to disk = 'd' with execute as self;"),
            [["IncorrectSyntaxNear", "Incorrect syntax near 'EXECUTE'."]],
        );
    });

    test("accepts EXECUTE AS inside a queue ACTIVATION option", async () => {
        for (const sql of [
            "create queue q1 with activation(procedure_name = dbo.p1, execute as self, max_queue_readers = 1)",
            "ALTER QUEUE q1 WITH ACTIVATION (PROCEDURE_NAME = dbo.p, EXECUTE AS 'dbo')",
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
    });

    // COMPRESSION_DELAY belongs to a columnstore index; the shared index option list takes any name.
    test("rejects COMPRESSION_DELAY on a non-columnstore index", async () => {
        assert.deepEqual(
            await codesAndMessages(
                "create table t1 (c int, index ix1 with (compression_delay = 1 minute));",
            ),
            [["IncorrectSyntaxNear", "Incorrect syntax near 'compression_delay'."]],
        );
    });

    test("accepts COMPRESSION_DELAY on a columnstore index", async () => {
        for (const sql of [
            "create table t1 (c int, index ix1 clustered columnstore with (compression_delay = 1 minute));",
            "create table t1 (c int, index ix1 nonclustered (c) with (fillfactor = 80));",
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
    });

    // The return table of a multi-statement table-valued function is declared by RETURNS, so
    // neither its own name nor a body reference to it is an undeclared variable.
    test("treats a table-valued function return variable as declared", async () => {
        for (const sql of [
            "CREATE FUNCTION dbo.f1() RETURNS @t TABLE (c int) AS BEGIN RETURN END;",
            "CREATE FUNCTION dbo.f1() RETURNS @t TABLE (c int) AS BEGIN INSERT INTO @t (c) VALUES (1); RETURN END;",
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
        assert.deepEqual(await codesAndMessages("SELECT @undeclared;"), [
            ["ScalarVariableRequired", 'Must declare the scalar variable "@undeclared".'],
        ]);
    });
});
