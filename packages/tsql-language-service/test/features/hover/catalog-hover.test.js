/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    createCatalogFeatureServices: createServices,
} = require("../../support/catalogFeatureHarness.js");

suite("catalog hover", () => {
    // Verifies catalog hover provides object kind, exact SQL types, nullability, and signatures.
    test("hovers catalog objects with lazily loaded details", async () => {
        const { runtime, features } = createServices();
        const tableSql = "SELECT * FROM dbo.Users;";
        await runtime.open("file:///table-hover.sql", 1, tableSql);
        const tableHover = features.hover(
            "file:///table-hover.sql",
            1,
            tableSql.indexOf("Users") + 2,
        );
        assert.match(tableHover.markdown, /\*\*table\*\*/);
        assert.match(tableHover.markdown, /Display Name.*nvarchar\(100\).*NULL/s);

        const columnSql = "SELECT Id FROM dbo.Users;";
        await runtime.open("file:///column-hover.sql", 1, columnSql);
        const columnHover = features.hover("file:///column-hover.sql", 1, columnSql.indexOf("Id"));
        assert.match(columnHover.markdown, /\*\*column\*\* `Id`/);
        assert.match(columnHover.markdown, /Type: `int NOT NULL`/);

        const procedureSql = "EXEC sales.RebuildOrder;";
        await runtime.open("file:///procedure-hover.sql", 1, procedureSql);
        const procedureHover = features.hover(
            "file:///procedure-hover.sql",
            1,
            procedureSql.indexOf("RebuildOrder") + 2,
        );
        assert.match(procedureHover.markdown, /\*\*procedure\*\*/);
        assert.match(procedureHover.markdown, /@OrderId int/);
    });
});
