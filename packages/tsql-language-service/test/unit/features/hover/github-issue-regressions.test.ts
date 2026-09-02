/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createCatalogFeatureServices } from "../../support/catalogFeatureHarness.ts";

suite("GitHub issue hover regressions", () => {
    test("shows table and column extended properties (vscode-mssql#22576)", async () => {
        const { runtime, features } = createCatalogFeatureServices();
        const uri = "file:///extended-property-hover.sql";
        const sql = "SELECT Id FROM dbo.Users;";
        await runtime.open(uri, 1, sql);

        const table = features.hover(uri, 1, sql.indexOf("Users") + 2);
        assert.match(table?.markdown ?? "", /MS_Description.*Application users/s);

        const column = features.hover(uri, 1, sql.indexOf("Id"));
        assert.match(column?.markdown ?? "", /MS_Description.*Stable user identifier/s);
    });
});
