/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    catalogOwnershipSortRank,
    isSystemDatabaseName,
    isSystemSchemaName,
} = require("../../dist/index.js");

suite("catalog presentation policy", () => {
    // System catalog names rank after ordinary user schemas without classifying similar names.
    test("owns the system database and schema inventory", () => {
        assert.equal(isSystemDatabaseName("MASTER"), true);
        assert.equal(isSystemDatabaseName("master_data"), false);
        assert.equal(isSystemSchemaName("INFORMATION_SCHEMA"), true);
        assert.equal(isSystemSchemaName("db_datareader"), true);
        assert.equal(isSystemSchemaName("dbo"), false);
        assert.equal(isSystemSchemaName("sys_app"), false);
        assert.ok(catalogOwnershipSortRank(false) < catalogOwnershipSortRank(true));
    });
});
