/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSemanticHarness } from "../../support/semanticHarness.ts";

const { analyze } = createSemanticHarness({ uri: "file:///semantic-search-semantics.sql" });

suite("SEMANTIC_SEARCH semantic diagnostics", () => {
    test("defers rowset inputs and exposes an unknown result projection", async () => {
        const diagnostics = await analyze(`
SELECT results.score
FROM SEMANTIC_SEARCH(
    TABLE = db.dbo.Documents AS source,
    COLUMN = (title, body),
    SEARCH_STRING = @query,
    TOP_N = @top_n,
    WEIGHT = @weight
) AS results;`);

        assert.deepEqual(diagnostics, []);
    });
});
