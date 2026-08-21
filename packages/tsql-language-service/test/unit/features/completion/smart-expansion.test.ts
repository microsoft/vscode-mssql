/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createCatalogFeatureServices as createServices } from "../../support/catalogFeatureHarness.ts";
import { assertDefined } from "../../support/assertions.ts";

suite("smart SQL completion expansion", () => {
    // Verifies SELECT * expansion uses bound catalog columns and quotes unsafe identifiers.
    test("expands SELECT star from the bound source", async () => {
        const { runtime, features } = createServices();
        const sql = "SELECT * FROM dbo.Users;";
        await runtime.open("file:///star.sql", 1, sql);
        const result = features.completion("file:///star.sql", 1, sql.indexOf("*") + 1);
        const expansion = result.items.find((item) => item.label === "Expand SELECT *");
        assertDefined(expansion);

        assert.deepEqual(
            result.items.map((item) => item.label),
            ["Expand SELECT *"],
        );
        assert.equal(expansion.filterText, "*");
        assert.equal(expansion.preselect, true);
        assert.deepEqual(expansion.edit, {
            start: sql.indexOf("*"),
            end: sql.indexOf("*") + 1,
            newText: "[Id], [Display Name]",
        });
    });
    // Verifies Ctrl+Space can discover an earlier projection star from elsewhere in its query.
    test("offers SELECT star expansion for manual completion at the end of the query", async () => {
        const { runtime, features } = createServices();
        const sql = "SELECT * FROM dbo.Users";
        await runtime.open("file:///manual-star.sql", 1, sql);

        const result = features.completion("file:///manual-star.sql", 1, sql.length);
        const expansion = result.items.find((item) => item.label === "Expand SELECT *");
        assertDefined(expansion);

        assert.deepEqual(expansion.edit, {
            start: sql.indexOf("*"),
            end: sql.indexOf("*") + 1,
            newText: "[Id], [Display Name]",
        });
    });
    // Verifies function wildcards do not become column-list expansion edits.
    test("does not expand COUNT star during manual completion", async () => {
        const { runtime, features } = createServices();
        const sql = "SELECT COUNT(*) FROM dbo.Users";
        await runtime.open("file:///count-star.sql", 1, sql);

        const result = features.completion("file:///count-star.sql", 1, sql.length);

        assert.equal(
            result.items.some((item) => item.label === "Expand SELECT *"),
            false,
        );
    });
    // Verifies smart INSERT expansion omits generated columns and replaces stray closing syntax.
    test("expands INSERT columns and values without duplicate closing brackets", async () => {
        const { runtime, features } = createServices();
        const sql = "INSERT INTO sales.Orders);)";
        await runtime.open("file:///insert.sql", 1, sql);
        const offset = sql.indexOf("Orders") + "Orders".length;
        const result = features.completion("file:///insert.sql", 1, offset);
        const expansion = result.items.find(
            (item) => item.label === "Expand INSERT columns and VALUES",
        );

        assert.ok(expansion);
        assertDefined(expansion.edit);
        assert.equal(expansion.edit.end, sql.length);
        assert.match(expansion.edit.newText, /\[CustomerId\]/);
        assert.doesNotMatch(expansion.edit.newText, /OrderId|ComputedTotal/);
        assert.match(expansion.edit.newText, /VALUES \(\n\s+\$\{1:NULL\}\n\);\$0$/);
    });
    // Verifies Ctrl+Space at the target's end offers INSERT expansion without a typing trigger.
    test("offers INSERT expansion for manual completion", async () => {
        const { runtime, features } = createServices();
        const sql = "INSERT INTO sales.Orders";
        await runtime.open("file:///manual-insert.sql", 1, sql);

        const result = features.completion("file:///manual-insert.sql", 1, sql.length);

        assert.ok(result.items.some((item) => item.label === "Expand INSERT columns and VALUES"));
    });
    // Verifies Ctrl+Space inside an empty column list replaces both parentheses with the expansion.
    test("expands INSERT from inside empty parentheses", async () => {
        const { runtime, features } = createServices();
        const sql = "INSERT INTO sales.Orders ()";
        const offset = sql.indexOf("(") + 1;
        await runtime.open("file:///empty-insert-list.sql", 1, sql);

        const result = features.completion("file:///empty-insert-list.sql", 1, offset);
        const expansion = result.items.find(
            (item) => item.label === "Expand INSERT columns and VALUES",
        );

        assert.ok(expansion);
        assertDefined(expansion.edit);
        assertDefined(expansion.command);
        assert.equal(expansion.edit.start, offset);
        assert.equal(expansion.edit.end, sql.length);
        assert.match(expansion.edit.newText, /^\n/u);
        assert.match(expansion.edit.newText, /VALUES \(\n\s+\$\{1:NULL\}\n\);\$0$/u);
        assert.equal(expansion.filterText, "columns values");
        assert.equal(expansion.insertTextFormat, "snippet");
        assert.equal(expansion.preselect, true);
        assert.equal(expansion.command.command, "editor.action.triggerParameterHints");
    });
    // Verifies accepting expansion consumes an editor-created empty VALUES skeleton as one edit.
    test("replaces an empty INSERT columns and VALUES skeleton", async () => {
        const { runtime, features } = createServices();
        const sql = "INSERT INTO sales.Orders (\n)\nVALUES (\n);";
        const offset = sql.indexOf("(") + 1;
        await runtime.open("file:///empty-insert-skeleton.sql", 1, sql);

        const expansion = features
            .completion("file:///empty-insert-skeleton.sql", 1, offset)
            .items.find((item) => item.label === "Expand INSERT columns and VALUES");

        assert.ok(expansion);
        assertDefined(expansion.edit);
        assert.equal(expansion.edit.start, offset);
        assert.equal(expansion.edit.end, sql.length);
        assert.match(expansion.edit.newText, /\);\$0$/u);
    });

    // Verifies a real user-supplied column list is never replaced by the smart INSERT action.
    test("does not replace a populated INSERT column list", async () => {
        const { runtime, features } = createServices();
        const sql = "INSERT INTO sales.Orders (CustomerId)";
        const offset = sql.indexOf("CustomerId") + 2;
        await runtime.open("file:///populated-insert-list.sql", 1, sql);

        const result = features.completion("file:///populated-insert-list.sql", 1, offset);

        assert.equal(
            result.items.some((item) => item.label === "Expand INSERT columns and VALUES"),
            false,
        );
    });
});
