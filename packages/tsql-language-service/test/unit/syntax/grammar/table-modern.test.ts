/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";
const { parse } = createSyntaxHarness("table-modern.sql");

suite("modern T-SQL table grammar", () => {
    // Verifies HIDDEN is independent of temporal generation and composes with ordinary options.
    test("parses hidden, column-set, and FILESTREAM column attributes", () => {
        const snapshot = parse(`
CREATE TABLE dbo.ModernColumns (
  Id uniqueidentifier ROWGUIDCOL NOT NULL UNIQUE,
  BigValue bigint HIDDEN,
  ValidFrom datetime2 GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
  SparseValues xml COLUMN_SET FOR ALL_SPARSE_COLUMNS HIDDEN,
  Payload varbinary(max) FILESTREAM HIDDEN NULL
);`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /ColumnOption\(Hidden\)/);
    });

    // Verifies all SWITCH partition shapes accept bounded low-priority lock-wait options.
    test("parses ALTER TABLE SWITCH low-priority waits", () => {
        const snapshot = parse(`
ALTER TABLE t1 SWITCH TO t2
WITH (WAIT_AT_LOW_PRIORITY (MAX_DURATION = 0, ABORT_AFTER_WAIT = NONE));
ALTER TABLE t1 SWITCH PARTITION 1 TO t2
WITH (WAIT_AT_LOW_PRIORITY (MAX_DURATION = 1440 MINUTES, ABORT_AFTER_WAIT = SELF));
ALTER TABLE t1 SWITCH PARTITION 1 TO t2 PARTITION 1
WITH (WAIT_AT_LOW_PRIORITY (MAX_DURATION = 1, ABORT_AFTER_WAIT = BLOCKERS));`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(
            (snapshot.tree.toString().match(/AlterTableSwitchWithClause\(/g) ?? []).length,
            3,
        );
    });

    // Verifies COLUMN_SET requires the complete FOR ALL_SPARSE_COLUMNS phrase.
    test("reports an incomplete sparse column-set attribute", () => {
        assert.ok(parse("CREATE TABLE t (c xml COLUMN_SET FOR);").diagnostics.length > 0);
    });

    // Verifies WAIT_AT_LOW_PRIORITY remains a parenthesized named option block.
    test("reports a malformed SWITCH wait option", () => {
        const snapshot = parse(
            "ALTER TABLE t1 SWITCH TO t2 WITH (WAIT_AT_LOW_PRIORITY MAX_DURATION = 1);",
        );
        assert.ok(snapshot.diagnostics.length > 0);
    });
});
