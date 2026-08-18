/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { assertValid, parse } = createSyntaxHarness("semantic-tables-and-constraints.sql");

suite("T-SQL semantic table functions, federated tables, and constraint enforcement", () => {
    // The semantic full-text table functions accept `*`, bare or parenthesized, meaning every
    // indexed column.
    test("parses star arguments to rowset functions", () => {
        assertValid("SELECT * FROM SEMANTICKEYPHRASETABLE(t1, *) t_alias;");
        assertValid("SELECT * FROM SEMANTICKEYPHRASETABLE(t1, (*), 10) t_alias;");
        assertValid("SELECT * FROM SEMANTICKEYPHRASETABLE(remote1.db1.s1.t1, (*), 10) t;");
        assertValid("SELECT * FROM SEMANTICSIMILARITYTABLE(t1, *, @k) t;");
        assertValid("SELECT * FROM SEMANTICSIMILARITYDETAILSTABLE(t1, c1, @a, c1, @b) t;");
    });

    // DUMP and LOAD are the pre-7.0 spellings of BACKUP and RESTORE. ScriptDOM accepts them at
    // compatibility levels 80 and 90 and rejects them from 100 onward, so they must parse
    // structurally at every level and carry the deliberate feature diagnostic only when the
    // profile is newer than the last release that accepted them.
    test("parses legacy DUMP and LOAD statements under their own compatibility level", () => {
        const legacy = createSyntaxHarness("legacy.sql", {
            serverMajorVersion: 17,
            compatibilityLevel: 90,
            engineProfile: "sql-server",
            previewFeatures: false,
        });
        for (const sql of [
            "DUMP DATABASE d1 TO someDevice;",
            "DUMP DATABASE d1 TO @deviceName, DISK = 'c:', TAPE = @tapeName;",
            "LOAD DATABASE db1 FROM someDevice;",
        ]) {
            legacy.assertValid(sql);
        }
    });

    // On a modern profile the same statements still parse, but are reported as unavailable.
    test("reports legacy DUMP and LOAD on a modern profile without recovering", () => {
        const snapshot = parse("DUMP DATABASE d1 TO someDevice;");
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.deepEqual(
            snapshot.diagnostics.map(({ message }) => message),
            [
                "The DUMP statement is not available on SQL Server 2025 (compatibility level 170). It was removed after database compatibility level 90.",
            ],
        );
    });

    // The modern spellings must keep working unchanged.
    test("keeps BACKUP and RESTORE intact", () => {
        assertValid("BACKUP DATABASE d1 TO DISK = 'b.bak' WITH CHECKSUM;");
        assertValid("RESTORE DATABASE db FROM DISK = 'b.bak' WITH REPLACE;");
        assertValid("RESTORE HEADERONLY FROM DISK = 'b.bak';");
    });

    // DISK INIT and DISK RESIZE are the pre-7.0 device statements. ScriptDOM accepts them only at
    // compatibility level 80.
    test("parses legacy DISK statements under their own compatibility level", () => {
        const legacy = createSyntaxHarness("legacy-disk.sql", {
            serverMajorVersion: 17,
            compatibilityLevel: 80,
            engineProfile: "sql-server",
            previewFeatures: false,
        });
        legacy.assertValid(
            "DISK INIT NAME = 'DEVICE1', PHYSNAME = 'c:\\sql80\\data\\device1.dat', VDEVNO = 1, SIZE = 6144;",
        );
        legacy.assertValid("DISK RESIZE NAME = 'DEVICE1', SIZE = 1057;");
    });

    // On a modern profile DISK INIT parses structurally and is reported as unavailable.
    test("reports legacy DISK on a modern profile without recovering", () => {
        const snapshot = parse("DISK INIT NAME = 'DEVICE1', SIZE = 6144;");
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.ok(snapshot.diagnostics.length > 0);
    });

    // Ordinary rowset function arguments must not regress.
    test("keeps ordinary rowset function arguments intact", () => {
        assertValid("SELECT * FROM SEMANTICSIMILARITYTABLE(t1, c1, @k) t;");
        assertValid("SELECT * FROM dbo.f(1, 'a') AS x;");
        assertValid("SELECT * FROM OPENJSON(@j) AS x;");
    });

    // A federated table maps its rows onto a federation distribution key.
    test("parses FEDERATED ON in CREATE TABLE", () => {
        assertValid("CREATE TABLE t1 (c1 bigint PRIMARY KEY NOT NULL) FEDERATED ON (c1 = c1);");
        assertValid("CREATE TABLE t1 (c1 bigint, c2 int) FEDERATED ON (range_id = c1);");
    });

    // Ordinary storage clauses keep working.
    test("keeps ordinary CREATE TABLE storage clauses intact", () => {
        assertValid("CREATE TABLE t1 (c1 int) ON [PRIMARY];");
        assertValid("CREATE TABLE t1 (c1 varbinary(max)) TEXTIMAGE_ON [PRIMARY];");
    });

    // A column-level key constraint may restate its column list and be declared unenforced.
    test("parses column constraints with column lists and enforcement markers", () => {
        assertValid(
            "CREATE TABLE t ([col1] INT NOT NULL CONSTRAINT [pk] PRIMARY KEY NONCLUSTERED ([col1] ASC) NOT ENFORCED);",
        );
        assertValid("CREATE TABLE t ([col2] INT UNIQUE NOT ENFORCED);");
        assertValid("CREATE TABLE t ([col3] INT PRIMARY KEY NONCLUSTERED ([col3] ASC));");
    });

    // The ordinary column constraint forms, including NOT NULL beside a constraint, must not regress.
    test("keeps ordinary column constraints intact", () => {
        assertValid("CREATE TABLE t (c1 int NOT NULL PRIMARY KEY);");
        assertValid("CREATE TABLE t (c1 int NULL UNIQUE CLUSTERED);");
        assertValid("CREATE TABLE t (c1 int NOT NULL REFERENCES o(c1));");
        assertValid("CREATE TABLE t (c1 int CONSTRAINT ck CHECK (c1 > 0) NOT NULL);");
        assertValid("CREATE TABLE t (c1 int NOT NULL CONSTRAINT df DEFAULT 1);");
    });

    // OUTPUT INTO accepts SQL Server's omitted multipart destination components.
    test("parses OUTPUT INTO with omitted multipart destinations", () => {
        assertValid("DELETE t1 OUTPUT deleted.c1 INTO .dbo.a(c1) FROM t2;");
        assertValid("INSERT t1 OUTPUT inserted.c1 INTO ..a(c1) VALUES (1);");
        assertValid("DELETE t1 OUTPUT deleted.c1 INTO dbo.a(c1);");
    });

    // A damaged federated clause must not leak past its GO batch.
    test("keeps a damaged FEDERATED clause inside its GO batch", () => {
        const snapshot = parse("CREATE TABLE t1 (c1 int) FEDERATED ON (\nGO\nSELECT 1;");
        assert.ok(snapshot.diagnostics.length > 0);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
        assert.equal(parse("SELECT 1;").statistics.rawErrorNodeCount, 0);
    });
});
