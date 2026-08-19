/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { assertValid, parse } = createSyntaxHarness("changetable-routes-and-bulk.sql");

suite("T-SQL change tracking arguments, routes, and bulk sources", () => {
    // CHANGES accepts an optional third argument naming a seek behaviour.
    test("parses CHANGETABLE CHANGES with a seek argument", () => {
        assertValid("SELECT * FROM CHANGETABLE(CHANGES t1, 10, FORCESEEK) AS a;");
        assertValid("SELECT * FROM CHANGETABLE(CHANGES dbo.t1, @v, FORCESEEK) AS a;");
    });

    // The two-argument form and the VERSION form must not regress.
    test("keeps existing CHANGETABLE forms intact", () => {
        assertValid("SELECT * FROM CHANGETABLE(CHANGES t1, 10) AS a;");
        assertValid("SELECT * FROM CHANGETABLE(CHANGES d1.dbo.t1, NULL) AS a;");
        assertValid("SELECT * FROM CHANGETABLE(VERSION t1, (c1), (1)) AS a;");
    });

    // A variable is a valid option value in a WITH option list.
    test("parses variable option values", () => {
        assertValid(
            "BACKUP DATABASE d1 TO DISK = 'd:' WITH BLOCKSIZE = 10, BUFFERCOUNT = @count, CHECKSUM;",
        );
        assertValid("BACKUP DATABASE d1 TO DISK = 'd:' WITH MAXTRANSFERSIZE = @size;");
    });

    // Literal and identifier option values keep working.
    test("keeps literal and identifier option values intact", () => {
        assertValid("BACKUP DATABASE d1 TO DISK = 'd:' WITH BLOCKSIZE = 10, CHECKSUM;");
        assertValid("CREATE INDEX i ON t(c) WITH (FILLFACTOR = 34, PAD_INDEX = ON);");
    });

    // A route names the network address Service Broker uses to reach a remote service.
    test("parses route statements", () => {
        assertValid("CREATE ROUTE r1 WITH SERVICE_NAME = 'svc', ADDRESS = 'TCP://x:4022';");
        assertValid(
            "ALTER ROUTE r1 WITH BROKER_INSTANCE = 'b1', LIFETIME = 23, ADDRESS = 'a1', MIRROR_ADDRESS = 'ma1';",
        );
        assertValid("CREATE ROUTE r1 AUTHORIZATION owner1 WITH ADDRESS = 'LOCAL';");
        assertValid("DROP ROUTE r1;");
    });

    // A bulk source may be one path or a parenthesized list of paths.
    test("parses parenthesized OPENROWSET BULK sources", () => {
        assertValid(
            "SELECT TOP 10 * FROM OPENROWSET(BULK ('https://x/a.csv'), FORMAT = 'CSV') WITH (a varchar(20)) AS rows;",
        );
        assertValid(
            "SELECT * FROM OPENROWSET(BULK ('https://x/a.csv', 'https://x/b.csv'), FORMAT = 'CSV') AS rows;",
        );
    });

    // SQL 160 OPENROWSET metadata supports one-based ordinals and trailing commas in path lists.
    test("parses OPENROWSET ordinals and trailing path commas", () => {
        const snapshot = parse(`
SELECT * FROM OPENROWSET(
  BULK ('https://x/2000/*.parquet', 'https://x/2010/*.parquet',), FORMAT = 'PARQUET'
) WITH ([country_code] VARCHAR(5) COLLATE Latin1_General_BIN2 1, [population] BIGINT 4) AS r;
`);

        assertValid(snapshot);
        const tree = snapshot.tree.toString();
        assert.equal((tree.match(/OpenRowsetColumnSchemaElement\(/g) ?? []).length, 2);
        assert.match(tree, /OpenRowsetColumnSchema\(/);
    });

    // The single-path bulk form and the provider form keep working.
    test("keeps existing OPENROWSET forms intact", () => {
        assertValid("SELECT * FROM OPENROWSET(BULK 'data/items.csv', FORMAT = 'CSV') AS rows;");
        assertValid("SELECT * FROM OPENROWSET('prov', 'src', 'obj') AS r;");
    });

    // A damaged route clause must not leak past its GO batch.
    test("keeps a damaged route clause inside its GO batch", () => {
        const snapshot = parse("ALTER ROUTE r1 WITH ADDRESS =\nGO\nSELECT 1;");
        assert.ok(snapshot.diagnostics.length > 0);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
        assert.equal(parse("SELECT 1;").statistics.rawErrorNodeCount, 0);
    });
});
