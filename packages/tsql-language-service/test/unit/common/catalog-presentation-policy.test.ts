/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import {
    catalogOwnershipSortRank,
    isSystemDatabaseName,
    isSystemSchemaName,
} from "../../../src/index.ts";

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
