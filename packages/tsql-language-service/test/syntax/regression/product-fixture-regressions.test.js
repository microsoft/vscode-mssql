/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { assertValid, parse } = createSyntaxHarness("product-fixture-regressions.sql");

suite("T-SQL product fixture regressions", () => {
    // Derived from long_varchar_table_select.sql: a named inline DEFAULT is one column constraint.
    test("parses named default column constraints", () => {
        assertValid(`
CREATE TABLE dbo.LongTextTable (
    CreatedDate datetime2(0) NOT NULL
        CONSTRAINT DF_LongTextTable_CreatedDate DEFAULT SYSUTCDATETIME()
);`);
    });

    // Derived from sad_face_parser_stress.sql: transaction names can be supplied by variables.
    test("parses variable transaction names", () => {
        assertValid(`
DECLARE @tran_name sysname = N'work';
BEGIN TRANSACTION @tran_name;
COMMIT TRANSACTION @tran_name;
`);
    });

    // Derived from tricky_bracket_parser_stress.sql: database-scoped credentials are distinct DDL.
    test("parses database-scoped credentials", () => {
        assertValid(`
CREATE DATABASE SCOPED CREDENTIAL [sa]
WITH IDENTITY = N'sa', SECRET = N'temporary';
DROP DATABASE SCOPED CREDENTIAL [sa];
`);
    });

    // Derived from tricky_bracket_parser_stress.sql: BEGIN TRANSACTION must not unbalance TRY/CATCH.
    test("keeps transaction statements inside TRY CATCH boundaries", () => {
        const snapshot = parse(`
BEGIN TRY
    BEGIN TRANSACTION work;
    SELECT 1;
    COMMIT TRANSACTION work;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION work;
    THROW;
END CATCH;
`);

        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /BeginControlStatement\(/);
    });

    // Derived from xml_employee_examples.sql: FOR XML modes/directives belong to scalar subqueries.
    test("parses FOR XML modes and nested scalar subqueries", () => {
        const snapshot = parse(`
SELECT Department,
    (SELECT TOP 3 Name
     FROM dbo.EmployeeData AS child
     WHERE child.Department = parent.Department
     ORDER BY Name
     FOR XML PATH('Employee'), TYPE) AS Employees
FROM dbo.EmployeeData AS parent
GROUP BY Department
FOR XML RAW('Department'), ROOT('Company'), ELEMENTS XSINIL;
`);

        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.match(tree, /ParenthesizedQuery\(/);
        assert.equal((tree.match(/ForClause\(/g) ?? []).length, 2);
        assert.match(tree, /XmlForMode\(Path/);
        assert.match(tree, /XmlForMode\(Raw/);
    });

    // Derived from alter_login_must_change.sql: password policy modifiers remain part of ALTER LOGIN.
    test("parses ALTER LOGIN password modifiers", () => {
        assertValid(`
ALTER LOGIN [tempChange]
WITH PASSWORD = N'<temporary-password>' MUST_CHANGE;
ALTER LOGIN [tempChange]
WITH PASSWORD = N'<new-password>' OLD_PASSWORD = N'<old-password>', CHECK_POLICY = ON;
`);
    });
});
