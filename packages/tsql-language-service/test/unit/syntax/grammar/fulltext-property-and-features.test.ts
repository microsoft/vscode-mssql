/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";
const { assertValid, parse } = createSyntaxHarness("fulltext-property-and-features.sql");

suite("T-SQL full-text property search, table features, and option literals", () => {
    // CONTAINS and FREETEXT may search one registered document property instead of the column body.
    test("parses PROPERTY targets in full-text predicates", () => {
        const snapshot = assertValid(
            "SELECT * FROM t1 WHERE CONTAINS(PROPERTY(c1, 'my_property'), 'foo');",
        );
        assert.match(snapshot.tree.toString(), /FullTextPropertyTarget\(/);

        assertValid("SELECT * FROM t1 WHERE FREETEXT(PROPERTY(dbo.t1.c1, 'Title'), 'foo');");
    });

    // The ordinary column, star, and column-list targets all stay valid. A bare `*` searches every
    // full-text indexed column; only the parenthesized `(*)` form used to parse.
    test("parses every full-text predicate column target", () => {
        assertValid("SELECT * FROM t1 WHERE CONTAINS(c1, 'foo');");
        assertValid("SELECT * FROM t1 WHERE CONTAINS((c1, c2), 'foo');");
        assertValid("SELECT * FROM t1 WHERE CONTAINS(*, 'foo');");
        assertValid("SELECT * FROM t1 WHERE CONTAINS((*), 'foo');");
        assertValid("SELECT * FROM t1 WHERE FREETEXT(*, 'foo');");
        assertValid("SELECT * FROM t1 WHERE FREETEXT(c1, 'foo', LANGUAGE 1033);");
    });

    // CREATE EXTERNAL TABLE AS SELECT puts its option list before AS, because the projected shape
    // comes from the query rather than from a declared column list.
    test("parses CREATE EXTERNAL TABLE AS SELECT", () => {
        assertValid(
            "CREATE EXTERNAL TABLE [dbo].[et1] WITH (LOCATION = N'/bands.dat', DATA_SOURCE = [eds1], FILE_FORMAT = [eff1], REJECT_TYPE = PERCENTAGE, REJECT_VALUE = 10.5, REJECT_SAMPLE_VALUE = 10) AS SELECT * FROM dbo.T2;",
        );
        assertValid("CREATE EXTERNAL TABLE dbo.et2 WITH (LOCATION = N'/x') AS SELECT 1;");
    });

    // The declared-column form of CREATE EXTERNAL TABLE keeps its existing shape.
    test("keeps declared-column external tables intact", () => {
        assertValid(
            "CREATE EXTERNAL TABLE dbo.et3 (c1 int) WITH (LOCATION = N'/x', DATA_SOURCE = ds1);",
        );
    });

    // A qualified option value may carry its own nested option list.
    test("parses nested option lists under a qualified value", () => {
        assertValid(
            "CREATE TABLE t (a int) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = dbo.h), LEDGER = ON (LEDGER_VIEW = dbo.v (TRANSACTION_ID_COLUMN_NAME = t)));",
        );
    });

    // ENABLE/DISABLE toggles named table features, which may carry their own option list.
    test("parses ALTER TABLE feature toggles", () => {
        assertValid("ALTER TABLE t1 ENABLE CHANGE_TRACKING;");
        assertValid("ALTER TABLE t1 DISABLE CHANGE_TRACKING;");
        assertValid("ALTER TABLE t1 ENABLE CHANGE_TRACKING WITH (TRACK_COLUMNS_UPDATED = ON);");
    });

    // The trigger form of ENABLE/DISABLE keeps its dedicated shape.
    test("keeps ALTER TABLE trigger toggles intact", () => {
        assertValid("ALTER TABLE t1 ENABLE TRIGGER ALL;");
        assertValid("ALTER TABLE t1 DISABLE TRIGGER tr1, tr2;");
    });

    // Coordinate lists are bare signed literals rather than named options.
    test("parses signed literal option lists", () => {
        assertValid(
            "CREATE SPATIAL INDEX sp1 ON dbo.c (d) WITH (BOUNDING_BOX = (4, -5.5, 6, -9));",
        );
        assertValid("CREATE SPATIAL INDEX sp1 ON a..c (d) WITH (BOUNDING_BOX = (4, -5.5, 6, -9));");
    });

    // Named options inside the same list keep working.
    test("keeps named options in option lists intact", () => {
        assertValid("CREATE INDEX i ON t(c) WITH (FILLFACTOR = 34, PAD_INDEX = ON);");
        assertValid("CREATE SPATIAL INDEX sp1 ON dbo.c (d);");
    });

    // A damaged property target must not leak past its GO batch.
    test("keeps a damaged PROPERTY target inside its GO batch", () => {
        const snapshot = parse("SELECT * FROM t1 WHERE CONTAINS(PROPERTY(c1,\nGO\nSELECT 1;");
        assert.ok(snapshot.diagnostics.length > 0);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
        assert.equal(parse("SELECT 1;").statistics.rawErrorNodeCount, 0);
    });
});
