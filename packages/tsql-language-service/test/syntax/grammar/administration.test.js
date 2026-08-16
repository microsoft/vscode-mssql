/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    ImmutableTextSnapshot,
    LezerSyntaxService,
    applyTextChanges,
} = require("../../../dist/index.js");

const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { assertValid, parse } = createSyntaxHarness("administration.sql");

suite("T-SQL administrative grammar", () => {
    // Verifies declared cursor lifecycle statements retain direction, source, and INTO variables.
    test("parses cursor lifecycle statements", () => {
        const snapshot = parse(`
DECLARE inventory_cursor CURSOR LOCAL FAST_FORWARD FOR SELECT Id FROM dbo.Items;
OPEN inventory_cursor;
FETCH NEXT FROM inventory_cursor INTO @id;
CLOSE inventory_cursor;
DEALLOCATE inventory_cursor;
`);

        assertValid(snapshot);
        assert.equal(
            (snapshot.tree.toString().match(/CursorLifecycleStatement\(/g) ?? []).length,
            4,
        );
        assert.match(snapshot.tree.toString(), /FetchOrientation\(Next\)/);
    });

    // Verifies database files, bounded options, ALTER actions, and guarded DROP have real nodes.
    test("parses database lifecycle statements", () => {
        const snapshot = parse(`
CREATE DATABASE DemoDb CONTAINMENT = PARTIAL
ON PRIMARY (NAME = N'Demo', FILENAME = N'C:\\data\\Demo.mdf', SIZE = 32)
WITH RECOVERY = FULL;
ALTER DATABASE DemoDb SET READ_COMMITTED_SNAPSHOT ON;
DROP DATABASE IF EXISTS DemoDb;
`);

        assertValid(snapshot);
        const tree = snapshot.tree.toString();
        assert.match(tree, /CreateDatabaseStatement\(/);
        assert.match(tree, /FileDefinition\(/);
        assert.match(tree, /AlterDatabaseStatement\(/);
        assert.match(tree, /DropDatabaseStatement\(/);
    });

    // Verifies schema creation, ownership, object transfer, and guarded removal are structured.
    test("parses schema lifecycle statements", () => {
        const snapshot = parse(`
CREATE SCHEMA reporting AUTHORIZATION dbo;
ALTER SCHEMA archive TRANSFER reporting.MonthlySales;
DROP SCHEMA IF EXISTS reporting;
`);

        assertValid(snapshot);
        assert.match(snapshot.tree.toString(), /CreateSchemaStatement\(/);
        assert.match(snapshot.tree.toString(), /AlterSchemaStatement\(/);
        assert.match(snapshot.tree.toString(), /DropSchemaStatement\(/);
    });

    // Verifies principal DDL and class-qualified permissions do not collide with labels or DML.
    test("parses principals and permissions", () => {
        const snapshot = parse(`
CREATE LOGIN app_login WITH PASSWORD = N'Strong!Pass1', DEFAULT_DATABASE = DemoDb;
CREATE USER app_user FROM LOGIN app_login WITH DEFAULT_SCHEMA = reporting;
CREATE ROLE report_reader;
GRANT SELECT, UPDATE ON OBJECT::reporting.MonthlySales TO report_reader WITH GRANT OPTION;
DENY DELETE ON SCHEMA::reporting TO app_user;
REVOKE UPDATE ON OBJECT::reporting.MonthlySales FROM report_reader;
`);

        assertValid(snapshot);
        const tree = snapshot.tree.toString();
        assert.equal((tree.match(/CreatePrincipalStatement\(/g) ?? []).length, 3);
        assert.equal((tree.match(/PermissionStatement\(/g) ?? []).length, 3);
        assert.equal((tree.match(/DoubleColon/g) ?? []).length, 3);
    });

    // Verifies login sources, database user mappings, role ownership, and membership retain distinct structure.
    test("parses complete principal source and role forms", () => {
        const snapshot = parse(`
CREATE LOGIN app_login WITH PASSWORD = N'Strong!Pass1' MUST_CHANGE,
    DEFAULT_DATABASE = DemoDb, CHECK_POLICY = ON, CHECK_EXPIRATION = ON;
CREATE LOGIN [domain\\user] FROM WINDOWS WITH DEFAULT_DATABASE = DemoDb;
CREATE USER cert_user FOR CERTIFICATE app_certificate;
CREATE USER ext_user FROM EXTERNAL PROVIDER WITH OBJECT_ID = N'11111111-1111-1111-1111-111111111111';
CREATE ROLE report_reader AUTHORIZATION dbo;
ALTER ROLE report_reader ADD MEMBER cert_user;
ALTER ROLE report_reader DROP MEMBER cert_user;
`);

        assertValid(snapshot);
        const tree = snapshot.tree.toString();
        assert.equal((tree.match(/CreatePrincipalStatement\(/g) ?? []).length, 5);
        assert.equal((tree.match(/AlterPrincipalStatement\(/g) ?? []).length, 2);
        assert.match(tree, /LoginPasswordModifier\(MustChange\)/);
        assert.match(tree, /UserCreationClause\(/);
    });

    // Verifies data files, log files, and filegroup changes remain inside their database statement.
    test("parses database log and filegroup forms", () => {
        const snapshot = parse(`
CREATE DATABASE ArchiveDb
ON PRIMARY (NAME = N'Archive', FILENAME = N'C:\\data\\Archive.mdf'),
FILEGROUP ArchiveData (NAME = N'Archive2', FILENAME = N'C:\\data\\Archive2.ndf')
LOG ON (NAME = N'Archive_log', FILENAME = N'C:\\data\\Archive.ldf');
ALTER DATABASE ArchiveDb ADD FILEGROUP History CONTAINS FILESTREAM;
ALTER DATABASE ArchiveDb MODIFY FILEGROUP History DEFAULT;
ALTER DATABASE ArchiveDb REMOVE FILEGROUP History;
`);

        assertValid(snapshot);
        const tree = snapshot.tree.toString();
        assert.match(tree, /DatabaseLogClause\(/);
        assert.match(tree, /DatabaseFilegroupModifier\(/);
        assert.equal((tree.match(/AlterDatabaseStatement\(/g) ?? []).length, 3);
    });

    // Verifies external label recognition accepts one colon but never consumes permission double-colons.
    test("distinguishes labels from securable qualification", () => {
        const snapshot = parse(`
retry_here: GOTO retry_here;
GRANT SELECT ON OBJECT::dbo.Items TO app_user;
`);

        assertValid(snapshot);
        assert.match(snapshot.tree.toString(), /LabelStatement\(Label\)/);
        assert.match(snapshot.tree.toString(), /DoubleColon/);
    });

    // Verifies missing cursor names remain exact parser diagnostics rather than accepted recovery text.
    test("reports malformed cursor lifecycle syntax", () => {
        const snapshot = parse("OPEN ;");

        assert.ok(snapshot.statistics.rawErrorNodeCount > 0);
        assert.deepEqual(snapshot.diagnostics, [
            {
                code: "syntax",
                message: "Incorrect syntax near ';'.",
                severity: "error",
                range: { start: 5, end: 6 },
            },
        ]);
    });

    // Verifies malformed permissions expose the unexpected token at its exact UTF-16 range.
    test("reports malformed permission syntax", () => {
        const snapshot = parse("GRANT SELECT ON OBJECT::dbo.Items TO;");
        const semicolon = snapshot.document.text.lastIndexOf(";");

        assert.ok(snapshot.statistics.rawErrorNodeCount > 0);
        assert.ok(
            snapshot.diagnostics.some(
                (diagnostic) =>
                    diagnostic.message === "Incorrect syntax near ';'." &&
                    diagnostic.range.start === semicolon,
            ),
        );
    });

    // Verifies an edit inside security DDL has exactly the same tree, diagnostics, and tokens as fresh parsing.
    test("keeps administrative incremental and fresh parsing equivalent", () => {
        const service = new LezerSyntaxService();
        const sql = `CREATE ROLE report_reader;\nGO\nGRANT SELECT ON OBJECT::dbo.Items TO report_reader;`;
        const firstDocument = new ImmutableTextSnapshot("file:///administration.sql", 1, sql);
        const first = service.parse(firstDocument);
        const start = sql.lastIndexOf("report_reader");
        const change = { start, end: start + "report_reader".length, text: "report_viewer" };
        const nextDocument = applyTextChanges(firstDocument, 2, [change]);
        const incremental = service.update(first, nextDocument, [change]);
        const fresh = service.parse(nextDocument);

        assert.ok(incremental.statistics.reusableFragmentCount > 0);
        assert.equal(incremental.tree.toString(), fresh.tree.toString());
        assert.deepEqual(incremental.diagnostics, fresh.diagnostics);
        assert.deepEqual([...incremental.tokens()], [...fresh.tokens()]);
    });
});
