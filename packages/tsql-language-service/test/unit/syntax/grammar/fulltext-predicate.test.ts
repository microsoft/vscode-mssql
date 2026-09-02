/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";
const { parse } = createSyntaxHarness("fulltext-predicate.sql");

suite("T-SQL full-text and trigger predicates", () => {
    // Verifies CONTAINS and FREETEXT accept their SQL Server column-target variants.
    test("parses full-text column and star targets", () => {
        const snapshot = parse(`
SELECT * FROM dbo.Documents WHERE CONTAINS(Name, '"Mountain" OR "Road"');
SELECT * FROM dbo.Documents WHERE FREETEXT(t.*, N'vital safety components');
SELECT * FROM dbo.Documents WHERE CONTAINS((t.c1, c2, t.$identity), @search);`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /FullTextPredicate/);
        assert.match(snapshot.tree.toString(), /FullTextColumnTarget/);
    });

    // Verifies full-text predicates preserve numeric, binary, string, and variable language values.
    test("parses full-text LANGUAGE values", () => {
        const snapshot = parse(`
SELECT * FROM t WHERE FREETEXT((c1), N'abc', LANGUAGE 1033);
SELECT * FROM t WHERE FREETEXT((c1), N'abc', LANGUAGE 0x413);
SELECT * FROM t WHERE CONTAINS(c1, @search, LANGUAGE 'English');
SELECT * FROM t WHERE CONTAINS(c1, @search, LANGUAGE @current);`);

        assert.deepEqual(snapshot.diagnostics, []);
    });

    // Verifies the UPDATE(column) trigger predicate composes with Boolean expressions.
    test("parses UPDATE trigger predicates", () => {
        const snapshot = parse(
            "IF (UPDATE(StateProvinceID) OR UPDATE(PostalCode)) BEGIN PRINT 'changed'; END;",
        );

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /UpdatePredicate/);
    });

    // Verifies a mounted trigger body stops at GO and cannot corrupt valid statements in later batches.
    test("keeps trigger bodies inside their batch", () => {
        const snapshot = parse(`
CREATE TRIGGER reminder ON dbo.Address AFTER UPDATE AS
IF (UPDATE(StateProvinceID) OR UPDATE(PostalCode)) BEGIN PRINT 'changed'; END;
GO
CREATE PROCEDURE p1 AS
SELECT CASE WHEN ISNULL((SELECT 1 FROM dbo.t WHERE 1 = 1), 0) = 0 THEN 0 ELSE 14 END
FROM dbo.t;
GO`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /CreateTriggerStatement/);
        assert.match(snapshot.tree.toString(), /CreateProcedureStatement/);
    });

    // Verifies a full-text predicate cannot omit its required search condition.
    test("reports a missing full-text search condition", () => {
        const snapshot = parse("SELECT * FROM t WHERE CONTAINS(c1,);");
        assert.ok(snapshot.diagnostics.length > 0);
    });

    // Verifies LANGUAGE cannot omit its required LCID, name, or variable value.
    test("reports a missing full-text language value", () => {
        const snapshot = parse("SELECT * FROM t WHERE FREETEXT(c1, 'abc', LANGUAGE);");
        assert.ok(snapshot.diagnostics.length > 0);
    });
});
