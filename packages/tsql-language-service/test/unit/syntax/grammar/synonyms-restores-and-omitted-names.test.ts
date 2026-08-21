/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

// Every positive form here was confirmed against ScriptDOM before the grammar was changed.
import { createSyntaxHarness } from "../../support/syntaxHarness.ts";
const { assertValid, parse } = createSyntaxHarness("synonyms-restores-and-omitted-names.sql");

suite("T-SQL synonyms, restores, and omitted name components", () => {
    // Both the synonym and its target may omit leading name components.
    test("parses synonyms with omitted name components", () => {
        assertValid("create synonym mysyn for t1;");
        assertValid("create synonym .mysyn2 for dbo.t1;");
        assertValid("create synonym [dbo].[mysyn3] for ...t1;");
        assertValid("create synonym dbo.mysyn4 for .[db]..t1;");
        assertValid("drop synonym mysyn;");
    });

    // A single omitted schema component leaves just `.name` in any rowset position.
    test("parses a single omitted name component", () => {
        assertValid("select * from .t1;");
        assertValid("insert into .t1 values (1);");
        assertValid("truncate table .t1;");
        assertValid("select * from ..t1;");
        assertValid("select * from a..b;");
    });

    // A restore may name no device at all.
    test("parses restores without a device list", () => {
        assertValid("restore database db1");
        assertValid("restore log db1");
        assertValid("restore database @var1 from @var2");
        assertValid("restore database db1 from disk = 'd:'");
        assertValid("restore filelistonly from disk = 'd:'");
    });

    // The product rejects a certificate login source; so must this grammar.
    test("rejects a login source the product rejects", () => {
        assert.ok(parse("create login l1 from cert").statistics.rawErrorNodeCount > 0);
    });

    // A damaged synonym target must not leak past its GO batch.
    test("keeps a damaged synonym inside its GO batch", () => {
        const snapshot = parse("create synonym s1 for\nGO\nSELECT 1;");
        assert.ok(snapshot.diagnostics.length > 0);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
        assert.equal(parse("SELECT 1;").statistics.rawErrorNodeCount, 0);
    });
});
