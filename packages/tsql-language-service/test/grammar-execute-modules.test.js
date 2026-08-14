/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { ImmutableTextSnapshot, LezerSyntaxService } = require("../dist/index.js");

suite("T-SQL advanced EXECUTE and module grammar", () => {
    // Verifies procedure numbers, named arguments, output values, and execution options.
    test("parses advanced procedure execution", () => {
        const snapshot = parse(`
EXECUTE @status = dbo.ProcessOrder;1 DEFAULT, @mode = 'fast', @result = @value OUTPUT
WITH RECOMPILE;
EXEC OPENDATASOURCE('MSOLEDBSQL', 'Server=remote;Trusted_Connection=yes').db.dbo.SyncData;`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /ProcedureNumberClause/);
        assert.match(snapshot.tree.toString(), /OpenDataSourceExecutable/);
    });

    // Verifies dynamic pass-through arguments, AS context, linked servers, and RESULT SETS shapes.
    test("parses dynamic EXECUTE and RESULT SETS", () => {
        const snapshot = parse(`
EXECUTE (N'SELECT id FROM dbo.t WHERE id = ?', 42) AS USER = 'reader' AT Reporting;
EXECUTE dbo.GetPeople WITH RESULT SETS (
  (PersonId INT NOT NULL, DisplayName NVARCHAR(100) NULL),
  AS OBJECT server1.db.dbo.PeopleType,
  AS FOR XML,
  AS TYPE dbo.PersonTableType
), RECOMPILE;
EXECUTE dbo.GetPeople WITH RESULT SETS NONE;
EXECUTE dbo.GetPeople WITH RESULT SETS UNDEFINED;`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal((snapshot.tree.toString().match(/ExecuteWithClause\(/g) ?? []).length, 3);
    });

    // Verifies native procedures retain BEGIN ATOMIC transaction/language settings and SQL bodies.
    test("parses native procedure atomic bodies", () => {
        const snapshot = parse(`
CREATE PROCEDURE dbo.NativeProc
WITH NATIVE_COMPILATION, SCHEMABINDING, EXECUTE AS OWNER
AS
BEGIN ATOMIC WITH (
  TRANSACTION ISOLATION LEVEL = SNAPSHOT,
  LANGUAGE = N'us_english',
  DELAYED_DURABILITY = ON
)
  SELECT 1;
END;`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /AtomicWithClause/);
    });

    // Verifies Fabric external functions support optional signatures and return types.
    test("parses Fabric external functions", () => {
        const snapshot = parse(
            `
CREATE FUNCTION dbo.ExternalScalar(@x INT, @label NVARCHAR(50))
RETURNS BIGINT AS EXTERNAL FUNCTION remote_set.scalar_fn;
ALTER FUNCTION dbo.ExternalScalar(@x INT)
AS EXTERNAL FUNCTION remote_set.scalar_fn_v2;`,
            profile("fabric"),
        );

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal((snapshot.tree.toString().match(/ExternalFunctionBody\(/g) ?? []).length, 2);
    });

    // Verifies Fabric-only external functions are rejected by the SQL Server feature profile.
    test("gates external functions to Fabric", () => {
        const snapshot = parse(
            "CREATE FUNCTION dbo.f AS EXTERNAL FUNCTION remote.f;",
            profile("sql-server"),
        );

        assert.deepEqual(
            snapshot.diagnostics.map((diagnostic) => diagnostic.message),
            ["Incorrect syntax near 'EXTERNAL'."],
        );
    });

    // Verifies incomplete result declarations and external bindings remain visible errors.
    test("reports truncated EXECUTE and external function forms", () => {
        assert.ok(parse("EXEC dbo.p WITH RESULT SETS ();").diagnostics.length > 0);
        assert.ok(
            parse("CREATE FUNCTION dbo.f AS EXTERNAL FUNCTION;", profile("fabric")).diagnostics
                .length > 0,
        );
    });
});

function profile(engineFlavor) {
    return {
        serverMajorVersion: 17,
        compatibilityLevel: 170,
        engineFlavor,
        previewFeatures: false,
    };
}

function parse(sql, selectedProfile = profile("sql-server")) {
    return new LezerSyntaxService(undefined, selectedProfile).parse(
        new ImmutableTextSnapshot("file:///execute-modules.sql", 1, sql),
    );
}
