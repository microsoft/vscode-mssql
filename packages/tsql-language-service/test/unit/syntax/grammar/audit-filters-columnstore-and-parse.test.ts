/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

// Every positive form here was confirmed against ScriptDOM before the grammar was changed, and
// every rejected neighbour below was confirmed to be rejected by ScriptDOM too.
import { createSyntaxHarness } from "../../support/syntaxHarness.ts";
const { assertValid, parse } = createSyntaxHarness("audit-filters-columnstore-and-parse.sql");

suite("T-SQL audit filters, columnstore indexes, backup encryption, and PARSE", () => {
    // A server audit may filter recorded events, and ALTER may drop that filter.
    test("parses server audit WHERE filters", () => {
        assertValid(
            "CREATE SERVER AUDIT a1 TO FILE (FILEPATH='aaa', max_files=10) with (on_failure=fail_operation) where c1 = 1",
        );
        assertValid("alter server audit a1 where c1 = 1");
        assertValid("alter server audit a1 remove where");
        assertValid("alter server audit a1 where c1 = 1 and c2 > 2");
    });

    // Audit statements without a filter keep working.
    test("keeps unfiltered audit statements intact", () => {
        assertValid("CREATE SERVER AUDIT a1 TO FILE (FILEPATH='aaa')");
        assertValid("alter server audit a1 modify name = a2");
        assertValid("drop server audit a1");
    });

    // A clustered columnstore index covers the whole table, so it names no key columns.
    test("parses inline columnstore indexes without a column list", () => {
        assertValid("create table t1(c int, index cci clustered columnstore)");
        assertValid(
            "create table t1 (c int, index ncci clustered columnstore with (compression_delay = 1))",
        );
        assertValid(
            "create table t1 (c int, index ncci clustered columnstore with (compression_delay = 1 minute))",
        );
        assertValid(
            "create table t1 (c int, index cci clustered columnstore with (compression_delay = 10 minutes))",
        );
        assertValid("create table t1 (c int, index ix1)");
    });

    // Keyed inline indexes must not regress.
    test("keeps keyed inline indexes intact", () => {
        assertValid("create table t1 (c int, index ix1 nonclustered (c))");
        assertValid("create table t1 (c int, index ix1 nonclustered columnstore (c))");
        assertValid("create table t1 (c int, index ix1 nonclustered (c) with (fillfactor = 80))");
    });

    // A backup may name every read/write filegroup, mixed freely into the file list.
    test("parses READ_WRITE_FILEGROUPS in a backup file list", () => {
        assertValid("BACKUP DATABASE db1 READ_WRITE_FILEGROUPS TO d1;");
        assertValid("BACKUP DATABASE db1 READ_WRITE_FILEGROUPS, FILE = 'f' TO d1;");
        assertValid("BACKUP DATABASE db1 FILE = 'f', READ_WRITE_FILEGROUPS TO d1;");
        assertValid("BACKUP DATABASE db1 FILEGROUP = 'g' TO d1;");
    });

    // Backup encryption names its key holder with two words.
    test("parses backup encryption key holders", () => {
        assertValid(
            "backup database d1 to disk = 'd:' with format, compression, encryption(algorithm = AES_128, server certificate = cert1), stats = 10;",
        );
        assertValid(
            "backup database d1 to disk = 'd:' with encryption(algorithm = AES_256, server asymmetric key = key1);",
        );
    });

    // PARSE and TRY_PARSE take a target type and an optional culture.
    test("parses PARSE and TRY_PARSE", () => {
        assertValid("select parse('12345.98' as float);");
        assertValid("select parse('12345.54' as float using 'en-US');");
        assertValid("select try_parse('12345.98' as float);");
        assertValid("select try_parse('12345.54' as float using 'en-US');");
        assertValid("select try_cast('12345' as int);");
        assertValid("select parse as c1 from t1;");
    });

    // OVER stands where INTO does in the legacy INSERT OVER form.
    test("parses INSERT OVER", () => {
        assertValid("Insert over t1 default values");
        assertValid("Insert into t1 default values");
        assertValid("insert t1 default values");
    });

    // Neighbours the product rejects must not parse as clean T-SQL here either.
    test("rejects neighbours that the product rejects", () => {
        for (const sql of [
            "Insert over into t1 default values",
            "select parse('1' as float using 'en-US' extra);",
            "select parse('1' float);",
            "alter server audit a1 where",
        ]) {
            assert.ok(parse(sql).statistics.rawErrorNodeCount > 0, sql);
        }
    });

    // A damaged audit filter must not leak past its GO batch.
    test("keeps a damaged audit filter inside its GO batch", () => {
        const snapshot = parse("alter server audit a1 where\nGO\nSELECT 1;");
        assert.ok(snapshot.diagnostics.length > 0);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
        assert.equal(parse("SELECT 1;").statistics.rawErrorNodeCount, 0);
    });
});
