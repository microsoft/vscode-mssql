/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createCatalogFeatureServices as createServices } from "../../support/catalogFeatureHarness.ts";

suite("catalog binding", () => {
    // Verifies three-part cross-schema sources bind to pinned catalog identities and aliases.
    test("binds cross-schema table sources", async () => {
        const { runtime } = createServices();
        const sql = "SELECT o.Id FROM CustomerDb.sales.Orders AS o;";
        const snapshot = await runtime.open("file:///binding.sql", 1, sql);

        const symbols = snapshot.semantics.visibleSymbols(sql.indexOf("o.Id"));
        assert.ok(symbols.some((symbol) => symbol.name === "sales.Orders"));
        assert.ok(symbols.some((symbol) => symbol.name === "o" && symbol.kind === "alias"));
    });
});
