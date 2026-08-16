/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    analyzeSql: analyze,
    createMetadata: metadata,
    messages,
    table,
} = require("../../support/semanticHarness.js");

suite("T-SQL scope, security, and XML diagnostics", () => {
    // BEGIN/END is control flow, not a new variable scope; document-local procedures persist over GO.
    test("binds batch variables through blocks and local procedures across batches", async () => {
        const diagnostics = await analyze(
            `DECLARE @i int = 0;
WHILE @i < 2
BEGIN
    SET @i = @i + 1;
END;
GO
CREATE OR ALTER PROCEDURE dbo.LocalProcedure AS SELECT 1;
GO
EXEC dbo.LocalProcedure;`,
            metadata(),
        );
        assert.deepEqual(diagnostics, []);
    });
    // Correlated scopes and XML rowset methods bind from syntax and local table shapes.
    test("binds correlated derived tables and XML nodes rowsets", async () => {
        const diagnostics = await analyze(
            `CREATE TABLE dbo.EmployeeData (ID int, Department nvarchar(20));
GO
SELECT (
    SELECT emp.ID
    FROM dbo.EmployeeData AS emp
    WHERE emp.Department = dept.Department
)
FROM (SELECT DISTINCT Department FROM dbo.EmployeeData) AS dept;

CREATE TABLE #XmlInput (XmlData xml);
SELECT Spec.value('.', 'int')
FROM #XmlInput
CROSS APPLY XmlData.nodes('/') AS T(Spec);`,
            metadata(),
        );
        assert.deepEqual(diagnostics, []);
    });
    // Runtime temp objects can exist outside the editor document and are not catalog-authoritative.
    test("does not claim externally created temp objects are missing", async () => {
        assert.deepEqual(await analyze("INSERT ##RuntimeLog VALUES (1);", metadata()), []);
    });
    // WHERE and JOIN predicates require a condition, while valid comparison predicates remain clean.
    test("validates boolean query contexts", async () => {
        const provider = metadata({
            objects: [table("target", "dbo", "Target")],
            columns: new Map([["target", [{ name: "Id", typeDisplay: "int" }]]]),
        });
        const diagnostics = await analyze(
            `SELECT * FROM dbo.Target WHERE 1;
SELECT * FROM dbo.Target AS a JOIN dbo.Target AS b ON 1;
SELECT * FROM dbo.Target WHERE Id = 1;`,
            provider,
        );
        assert.deepEqual(
            diagnostics.map(({ code }) => code),
            ["BooleanConditionExpected", "BooleanConditionExpected"],
        );
    });
    // Database references are diagnosed only when the pinned database list is authoritative.
    test("validates USE and multipart database references", async () => {
        const diagnostics = await analyze(
            `USE MissingDb;
SELECT * FROM MissingDb.dbo.Target;
CREATE TABLE MissingDb.dbo.NewTarget (Id int);
GO
CREATE PROCEDURE dbo.SwitchDatabase AS
BEGIN
    USE db;
END;`,
            metadata(),
        );
        const output = messages(diagnostics);
        assert.ok(
            output.includes(
                "Could not locate entry in sysdatabases for database 'MissingDb'. No entry found with that name. Make sure that the name is entered correctly.",
            ),
        );
        assert.ok(
            diagnostics.some(
                ({ code, range }) =>
                    code === "CouldNotLocateEntryInSysdatabases" &&
                    range.start === "USE ".length &&
                    range.end === "USE MissingDb".length,
            ),
        );
        assert.ok(
            diagnostics.some(
                ({ code, message }) =>
                    code === "DatabaseNotExist" &&
                    message === "Database 'MissingDb' does not exist.",
            ),
        );
        assert.ok(
            output.includes(
                "a USE database statement is not allowed in a procedure, function or trigger.",
            ),
        );
    });
    // Principal DDL uses the pinned server/database principal catalog without speculative errors.
    test("validates login, user, role, and authorization identities", async () => {
        const diagnostics = await analyze(
            `CREATE LOGIN AppLogin WITH PASSWORD = 'secret';
CREATE USER Alice WITHOUT LOGIN;
CREATE ROLE app_role;
ALTER LOGIN MissingLogin DISABLE;
DROP USER MissingUser;
CREATE USER Bob FOR LOGIN MissingLogin;
CREATE SCHEMA reporting AUTHORIZATION MissingOwner;`,
            metadata({
                principals: [
                    { id: "login:app", name: "AppLogin", kind: "login" },
                    { id: "user:alice", database: "db", name: "Alice", kind: "user" },
                    {
                        id: "role:app",
                        database: "db",
                        name: "app_role",
                        kind: "databaseRole",
                    },
                ],
            }),
        );
        const output = messages(diagnostics);
        assert.ok(output.includes("There is already a login named 'AppLogin' in the database."));
        assert.ok(output.includes("There is already a user named 'Alice' in the database."));
        assert.ok(
            output.includes(
                "User, group, or role 'app_role' already exists in the current database.",
            ),
        );
        assert.ok(
            output.includes(
                "Cannot find the login 'MissingLogin', because it does not exist or you do not have permission.",
            ),
        );
        assert.ok(
            output.includes(
                "Cannot find the user 'MissingUser', because it does not exist or you do not have permission.",
            ),
        );
        assert.ok(
            output.includes(
                "Cannot find the user 'MissingOwner', because it does not exist or you do not have permission.",
            ),
        );
    });
    // A top-level CREATE LOGIN is visible to later statements, including across GO; DROP removes
    // that document-local identity, and a second CREATE is still diagnosed as a duplicate.
    test("tracks document-local login lifetime", async () => {
        const diagnostics = await analyze(
            `CREATE LOGIN LocalLogin WITH PASSWORD = 'secret';
GO
ALTER LOGIN LocalLogin DISABLE;
DROP LOGIN LocalLogin;
ALTER LOGIN LocalLogin ENABLE;
CREATE LOGIN DuplicateLogin WITH PASSWORD = 'secret';
CREATE LOGIN DuplicateLogin WITH PASSWORD = 'secret';`,
            metadata(),
        );

        assert.deepEqual(
            diagnostics
                .filter(({ code }) => ["CouldNotFindLogin", "LoginExist"].includes(code))
                .map(({ message }) => message),
            [
                "Cannot find the login 'LocalLogin', because it does not exist or you do not have permission.",
                "There is already a login named 'DuplicateLogin' in the database.",
            ],
        );
    });
    // Cursor declaration options are accepted individually, but mutually exclusive choices in
    // each behavior group are diagnosed on the later conflicting option.
    test("validates conflicting cursor options", async () => {
        const diagnostics = await analyze(
            `DECLARE valid_cursor CURSOR LOCAL FORWARD_ONLY STATIC READ_ONLY FOR SELECT 1;
DECLARE bad_cursor CURSOR LOCAL GLOBAL FORWARD_ONLY SCROLL STATIC KEYSET READ_ONLY OPTIMISTIC FOR SELECT 1;`,
            metadata(),
        );

        assert.deepEqual(
            diagnostics.map(({ code, message }) => ({ code, message })),
            [
                {
                    code: "ConflictingCursorOption",
                    message: "Conflicting cursor options LOCAL and GLOBAL.",
                },
                {
                    code: "ConflictingCursorOption",
                    message: "Conflicting cursor options FORWARD_ONLY and SCROLL.",
                },
                {
                    code: "ConflictingCursorOption",
                    message: "Conflicting cursor options STATIC and KEYSET.",
                },
                {
                    code: "ConflictingCursorOption",
                    message: "Conflicting cursor options READ_ONLY and OPTIMISTIC.",
                },
            ],
        );
    });
    // A synonym's own name is at most schema-qualified; its referenced base object can remain a
    // valid three- or four-part name.
    test("rejects database prefixes on synonym declarations and drops", async () => {
        const sql = `CREATE SYNONYM db.dbo.BadSynonym FOR server.db.dbo.Target;
CREATE SYNONYM dbo.GoodSynonym FOR server.db.dbo.Target;
DROP SYNONYM db.dbo.BadSynonym, dbo.GoodSynonym;`;
        const diagnostics = await analyze(sql, metadata());

        assert.deepEqual(
            diagnostics.map(({ code, message, range }) => ({
                code,
                message,
                source: sql.slice(range.start, range.end),
            })),
            [
                {
                    code: "DbNameIsNotAllowedForCreateSynonym",
                    message:
                        "'CREATE SYNONYM' does not allow specifying the database name as a prefix to the object name.",
                    source: "db",
                },
                {
                    code: "DbNameIsNotAllowedForDropSynonym",
                    message:
                        "'DROP SYNONYM' does not allow specifying the database name as a prefix to the object name.",
                    source: "db",
                },
            ],
        );
    });
    // XML nodes() produces a special rowset: both the table and its node column require aliases,
    // and the node value is consumable only through XML methods or NULL predicates.
    test("validates XML nodes rowset aliases and direct node-column use", async () => {
        const diagnostics = await analyze(
            `CREATE TABLE #XmlInput (XmlData xml);
SELECT Spec FROM #XmlInput CROSS APPLY XmlData.nodes('/') AS T(Spec);
SELECT T.* FROM #XmlInput CROSS APPLY XmlData.nodes('/') AS T(Spec);
SELECT Spec.value('.', 'int') FROM #XmlInput CROSS APPLY XmlData.nodes('/') AS T(Spec) WHERE Spec IS NOT NULL;
SELECT 1 FROM #XmlInput CROSS APPLY XmlData.nodes('/');`,
            metadata(),
        );

        assert.deepEqual(
            diagnostics.map(({ code, message }) => ({ code, message })),
            [
                {
                    code: "InvalidColumnXmlNodeUse",
                    message:
                        "The column 'Spec' that was returned from the nodes() method cannot be used directly. It can only be used with one of the four XML data type methods, exist(), nodes(), query(), and value(), or in IS NULL and IS NOT NULL checks.",
                },
                {
                    code: "InvalidColumnXmlNodeUse",
                    message:
                        "The column 'Spec' that was returned from the nodes() method cannot be used directly. It can only be used with one of the four XML data type methods, exist(), nodes(), query(), and value(), or in IS NULL and IS NOT NULL checks.",
                },
                {
                    code: "TVFMethodMustBeAliased",
                    message:
                        "The table (and its columns) returned by a table-valued method need to be aliased.",
                },
            ],
        );
    });
});
