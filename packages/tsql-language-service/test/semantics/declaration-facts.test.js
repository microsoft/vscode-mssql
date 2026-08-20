/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    columnAllowsNull,
    descendantsOfKind,
    ImmutableTextSnapshot,
    LezerSyntaxService,
} = require("../../dist/index.js");

suite("declaration facts", () => {
    // Nullability belongs to the parsed column option. A CHECK predicate containing NOT NULL must
    // not be mistaken for the declaration modifier by a source-text scan.
    test("reads column nullability from structural options", () => {
        const sql = `CREATE TABLE dbo.T (
            A int NOT NULL,
            B int NULL,
            C int,
            D AS 1 PERSISTED NOT NULL,
            E int CHECK (E IS NOT NULL)
        );`;
        const syntax = new LezerSyntaxService().parse(
            new ImmutableTextSnapshot("file:///declaration-facts.sql", 1, sql),
        );
        const columns = descendantsOfKind(syntax.root(), "ColumnDefinition");
        assert.deepEqual(columns.map(columnAllowsNull), [false, true, true, false, true]);
    });
});
