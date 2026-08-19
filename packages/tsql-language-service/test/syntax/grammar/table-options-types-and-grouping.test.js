/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

// Every positive form here was confirmed against ScriptDOM before the grammar was changed.
const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { assertValid, parse } = createSyntaxHarness("table-options-types-and-grouping.sql");

suite("T-SQL table options, qualified types, and grouping elements", () => {
    // A range partition may omit LEFT/RIGHT and may list no boundaries at all.
    test("parses partition table options", () => {
        assertValid(
            "CREATE TABLE t (COL0 INT NOT NULL, COL1 VARCHAR (20)) WITH (PARTITION(COL0 RANGE FOR VALUES ()));",
        );
        assertValid(
            "CREATE TABLE t (COL0 INT NOT NULL) WITH (PARTITION(COL0 RANGE FOR VALUES (1, 5, 10)));",
        );
        assertValid(
            "CREATE TABLE t (COL0 INT NOT NULL) WITH (PARTITION(COL0 RANGE LEFT FOR VALUES (1)));",
        );
    });

    // An ordered clustered columnstore index names its ordering columns.
    test("parses ordered clustered columnstore table options", () => {
        assertValid(
            "CREATE TABLE dbo.T (c1 INT NOT NULL, c3 INT) WITH (CLUSTERED COLUMNSTORE INDEX ORDER(c1, c3));",
        );
        assertValid("CREATE TABLE dbo.T (c1 INT NOT NULL) WITH (CLUSTERED COLUMNSTORE INDEX);");
        assertValid("CREATE TABLE dbo.T (c1 INT NOT NULL) WITH (HEAP);");
    });

    // A table-level key constraint carries NOT ENFORCED, as a column-level one already did.
    test("parses NOT ENFORCED on table constraints", () => {
        assertValid(
            "CREATE TABLE [dbo].[t4] ([col1] INT NOT NULL, CONSTRAINT [pk1] PRIMARY KEY NONCLUSTERED ([col1] ASC) NOT ENFORCED);",
        );
        assertValid(
            "CREATE TABLE [dbo].[t7] ([col2] INT NOT NULL, CONSTRAINT [u1] UNIQUE ([col2] ASC) NOT ENFORCED);",
        );
        assertValid(
            "CREATE TABLE [dbo].[t9] ([col1] INT NOT NULL, CONSTRAINT [fk1] FOREIGN KEY ([col1]) REFERENCES [dbo].[t4] ([col1]) NOT ENFORCED);",
        );
        assertValid(
            "CREATE TABLE [dbo].[t8] ([col1] INT NOT NULL, CONSTRAINT [pk2] PRIMARY KEY ([col1]));",
        );
    });

    // Built-in type names may be schema-qualified, and NATIONAL may qualify one.
    test("parses schema-qualified and national type names", () => {
        assertValid(
            'CREATE TABLE t1(c1 sys.int, c2 national sys.text, c3 national sys.Char varying, c4 sys.binARY varying, c5 [sys]."Char" varying, c6 sys.[xml](CONTENT dbo.xsd1))',
        );
        assertValid("CREATE TABLE t1(c1 int, c2 national character varying(10))");
    });

    // The XML type binds a schema collection, with or without CONTENT/DOCUMENT.
    test("parses XML schema collection types", () => {
        assertValid("CREATE TABLE t1(c6 xml(CONTENT dbo.xsd1))");
        assertValid("CREATE TABLE t1(c6 xml(DOCUMENT dbo.xsd1))");
        assertValid("CREATE TABLE t1(c6 xml(dbo.xsd1))");
        assertValid("CREATE TABLE t1(c6 xml)");
    });

    // The empty grouping set is a list element in its own right.
    test("parses the empty grouping set", () => {
        assertValid("SELECT c1 FROM t1 GROUP BY CUBE(c1), ROLLUP(c2), GROUPING SETS(c1), (), c1");
        assertValid(
            "SELECT c1 FROM t1 GROUP BY GROUPING SETS (CUBE(c1), (c1, c2)), (), N'something'",
        );
        assertValid("SELECT c1 FROM t1 GROUP BY c1, c2");
        assertValid("SELECT c1 FROM t1 GROUP BY GROUPING SETS (ROLLUP(c1))");
    });

    // SQL 100 keeps the legacy WITH CUBE/ROLLUP tail after a grand-total grouping element.
    test("parses legacy grouping tails after an empty grouping set", () => {
        const snapshot = parse(`
SELECT c1 FROM t1 GROUP BY () WITH CUBE;
SELECT c1 FROM t1 GROUP BY () WITH ROLLUP;
`);

        assertValid(snapshot);
        assert.equal((snapshot.tree.toString().match(/GroupByOption\(/g) ?? []).length, 2);
    });

    // SQL 130 permits UNIQUE before HASH/NONCLUSTERED on inline memory-optimized indexes.
    test("parses unique inline hash and nonclustered indexes", () => {
        const snapshot = parse(`
CREATE TABLE T (
    i int NOT NULL,
    k int NOT NULL,
    INDEX ix_t UNIQUE HASH (i, k) WITH (BUCKET_COUNT = 10000)
);
ALTER TABLE T ADD INDEX ix_a UNIQUE NONCLUSTERED HASH (i) WITH (BUCKET_COUNT = 256);
`);

        assertValid(snapshot);
        const tree = snapshot.tree.toString();
        assert.equal((tree.match(/ColumnInlineIndexDefinition\(/g) ?? []).length, 0);
        assert.equal((tree.match(/InlineIndexDefinition\(/g) ?? []).length, 2);
    });

    // Temporal tables use a dedicated DROP PERIOD FOR SYSTEM_TIME ALTER TABLE action.
    test("parses dropping a system-time period", () => {
        const snapshot = parse("ALTER TABLE dbo.T DROP PERIOD FOR SYSTEM_TIME;");

        assertValid(snapshot);
        assert.match(snapshot.tree.toString(), /AlterTableAction\(Drop,Period,For,SystemTime\)/);
    });

    // Column-level inline indexes own their filegroup and FILESTREAM_ON tails.
    test("parses column inline index storage tails", () => {
        const snapshot = parse(`
CREATE TABLE dbo.T (
    c int INDEX ix_c WITH (BUCKET_COUNT = 1000) ON fg FILESTREAM_ON fs_fg
);
`);

        assertValid(snapshot);
        assert.equal(
            (snapshot.tree.toString().match(/CreateTableStorageClause\(/g) ?? []).length,
            2,
        );
    });

    // Table-level inline indexes use the same storage tail as column-level indexes.
    test("parses table inline index storage tails", () => {
        const snapshot = parse(`
CREATE TABLE dbo.T (
    c int,
    INDEX ix_c (c) WITH (DATA_COMPRESSION = ROW) ON fg FILESTREAM_ON fs_fg
);
`);

        assertValid(snapshot);
        assert.equal(
            (snapshot.tree.toString().match(/CreateTableStorageClause\(/g) ?? []).length,
            2,
        );
    });

    // A damaged partition option must not leak past its GO batch.
    test("keeps a damaged table option inside its GO batch", () => {
        const snapshot = parse("CREATE TABLE t (c int) WITH (PARTITION(c RANGE FOR\nGO\nSELECT 1;");
        assert.ok(snapshot.diagnostics.length > 0);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
        assert.equal(parse("SELECT 1;").statistics.rawErrorNodeCount, 0);
    });
});
