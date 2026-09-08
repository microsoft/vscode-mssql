/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "node:assert/strict";
import { test } from "node:test";
import { capabilitiesFrom } from "../../src/core/platform";
import {
    compileClearQueryStoreHint,
    compileQueryStoreHint,
    compileQueryStoreMaintenance,
    compileQueryStorePlanAction,
    queryStoreInterventionCapabilities,
} from "../../src/diagnostics/querystore/interventions";

void test("plan actions and maintenance operations are fixed and reversible", () => {
    assert.equal(
        compileQueryStorePlanAction(12, 34, "force"),
        "EXEC sys.sp_query_store_force_plan @query_id = 12, @plan_id = 34;",
    );
    assert.equal(
        compileQueryStorePlanAction(12, 34, "unforce"),
        "EXEC sys.sp_query_store_unforce_plan @query_id = 12, @plan_id = 34;",
    );
    assert.equal(
        compileQueryStoreMaintenance("A]B", "clearHistory"),
        "ALTER DATABASE [A]]B] SET QUERY_STORE CLEAR ALL;",
    );
    assert.equal(
        compileQueryStoreMaintenance("App", "flush"),
        "ALTER DATABASE [App] SET QUERY_STORE FLUSH;",
    );
});

void test("hints are literalized and reject invalid query identities", () => {
    assert.equal(
        compileQueryStoreHint(12, "OPTION (MAXDOP 1), 'quoted'"),
        "EXEC sys.sp_query_store_set_hints @query_id = 12, @query_hints = N'OPTION (MAXDOP 1), ''quoted''';",
    );
    assert.equal(
        compileClearQueryStoreHint(12),
        "EXEC sys.sp_query_store_clear_hints @query_id = 12;",
    );
    assert.throws(() => compileQueryStorePlanAction(0, 34, "force"));
    assert.throws(() => compileQueryStoreHint(12, "\0"));
});

void test("hint capability is version and platform aware", () => {
    assert.equal(
        queryStoreInterventionCapabilities(
            capabilitiesFrom({ engineEditionId: 3, majorVersion: 15 }),
        ).hints,
        false,
    );
    assert.equal(
        queryStoreInterventionCapabilities(
            capabilitiesFrom({ engineEditionId: 3, majorVersion: 16 }),
        ).hints,
        true,
    );
    assert.equal(
        queryStoreInterventionCapabilities(
            capabilitiesFrom({ engineEditionId: 5, majorVersion: 16 }),
        ).maintenance.disable,
        false,
    );
});
