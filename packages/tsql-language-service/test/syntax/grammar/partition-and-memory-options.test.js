/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { assertValid, parse } = createSyntaxHarness("partition-and-memory-options.sql");

suite("T-SQL partition-scoped options and memory-optimized table shapes", () => {
    // Compression options may be scoped to single partitions or inclusive ranges.
    test("parses partition-scoped compression options", () => {
        const snapshot = assertValid(
            "ALTER TABLE t1 REBUILD PARTITION = ALL WITH (DATA_COMPRESSION = ROW ON PARTITIONS (1));",
        );
        assert.match(snapshot.tree.toString(), /OptionPartitionsClause\(/);

        assertValid(
            "CREATE INDEX i ON t(c) WITH (DATA_COMPRESSION = PAGE ON PARTITIONS (2, 3 TO 5));",
        );
        assertValid("CREATE INDEX i ON t(c) WITH (XML_COMPRESSION = ON ON PARTITIONS (1));");
        assertValid(
            "ALTER TABLE t1 REBUILD PARTITION = ALL WITH (DATA_COMPRESSION = COLUMNSTORE ON PARTITIONS (1, 3), DATA_COMPRESSION = COLUMNSTORE_ARCHIVE ON PARTITIONS (2));",
        );
    });

    // UPDATE STATISTICS reuses the same partition-scoped tail after RESAMPLE.
    test("parses RESAMPLE ON PARTITIONS in statistics options", () => {
        assertValid(
            "UPDATE STATISTICS dbo.t1 WITH FULLSCAN, INCREMENTAL = ON, RESAMPLE ON PARTITIONS (1, 3 TO 7, 10);",
        );
    });

    // Options without a partition tail keep their existing shape.
    test("keeps unpartitioned compression options intact", () => {
        assertValid("CREATE INDEX i ON t(c) WITH (DATA_COMPRESSION = PAGE);");
        assertValid("ALTER TABLE t1 REBUILD WITH (DATA_COMPRESSION = ROW);");
    });

    // A memory-optimized table type carries a table WITH clause after its definition.
    test("parses memory-optimized table types and table variables", () => {
        assertValid(
            "CREATE TYPE tableType1 AS TABLE (c1 int primary key) WITH (MEMORY_OPTIMIZED = ON);",
        );
        assertValid(
            "CREATE TYPE tt AS TABLE (c1 int index ix_c1 hash with (bucket_count = 8)) WITH (MEMORY_OPTIMIZED = OFF);",
        );
    });

    // The option list stays optional so ordinary table types are unaffected.
    test("keeps ordinary table types and table variables intact", () => {
        assertValid("CREATE TYPE tt AS TABLE (c1 int);");
        assertValid("DECLARE @t TABLE (c1 int, c2 nvarchar(10));");
    });

    // ALTER INDEX accepts SQL Server's omitted multipart target components.
    test("parses ALTER INDEX targets with omitted multipart components", () => {
        assertValid("ALTER INDEX ind1 ON .db..t1 REBUILD;");
        assertValid("ALTER INDEX ALL ON ..t1 REORGANIZE;");
        assertValid("ALTER INDEX ind1 ON dbo.t1 REBUILD;");
        assertValid("ALTER INDEX ind1 ON srv.db.dbo.t1 DISABLE;");
    });

    // SET OFFSETS names constructs using reserved statement keywords.
    test("parses SET OFFSETS lists", () => {
        assertValid(
            "SET OFFSETS SELECT, FROM, ORDER, COMPUTE, TABLE, PROCEDURE, EXECUTE, STATEMENT, PARAM ON;",
        );
        assertValid("SET OFFSETS FROM, ORDER OFF;");
        assertValid("SET OFFSETS PARAM ON;");
    });

    // A damaged option tail must not leak past its GO batch.
    test("keeps a damaged partition option inside its GO batch", () => {
        const snapshot = parse(
            "CREATE INDEX i ON t(c) WITH (DATA_COMPRESSION = PAGE ON PARTITIONS (\nGO\nSELECT 1;",
        );
        assert.ok(snapshot.diagnostics.length > 0);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
        assert.equal(parse("SELECT 1;").statistics.rawErrorNodeCount, 0);
    });
});
