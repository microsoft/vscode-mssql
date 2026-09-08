/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "node:assert/strict";
import { test } from "node:test";
import { capabilitiesFrom } from "../../src/core/platform";
import {
    compileQueryStoreConfiguration,
    queryStoreConfigurationMatches,
    QueryStoreConfiguration,
} from "../../src/diagnostics/querystore/configuration";
import { queryStoreReadiness } from "../../src/diagnostics/querystore/readiness";

const capabilities = capabilitiesFrom({ engineEditionId: 3, majorVersion: 16 });
void test("configuration patches preserve options that were not changed and quote database names", () => {
    assert.equal(
        compileQueryStoreConfiguration("A]B", { maxStorageMb: 500 }, capabilities),
        "ALTER DATABASE [A]]B] SET QUERY_STORE (\n    MAX_STORAGE_SIZE_MB = 500\n);",
    );
    const sql = compileQueryStoreConfiguration(
        "App",
        { operationMode: "READ_WRITE", retentionDays: 30, runtimeIntervalMinutes: 15 },
        capabilities,
    );
    assert.match(sql, /SET QUERY_STORE = ON/);
    assert.match(sql, /CLEANUP_POLICY = \(STALE_QUERY_THRESHOLD_DAYS = 30\)/);
    assert.doesNotMatch(sql, /QUERY_CAPTURE_MODE/);
    assert.match(
        compileQueryStoreConfiguration("App", { operationMode: "READ_ONLY" }, capabilities),
        /SET QUERY_STORE \(/,
    );
    assert.doesNotMatch(
        compileQueryStoreConfiguration("App", { operationMode: "READ_ONLY" }, capabilities),
        /SET QUERY_STORE = ON/,
    );
});
void test("configuration rejects injected enums, invalid intervals and unsafe numeric values", () => {
    for (const patch of [
        { captureMode: "AUTO); DROP DATABASE X;--" },
        { runtimeIntervalMinutes: 17 },
        { maxStorageMb: NaN },
        { retentionDays: -1 },
        { flushIntervalSeconds: 1.5 },
        { maxStorageMb: Number.MAX_SAFE_INTEGER + 1 },
        { unexpected: true },
        {},
    ]) {
        assert.throws(() =>
            compileQueryStoreConfiguration("App", patch as QueryStoreConfiguration, capabilities),
        );
    }
    assert.throws(() =>
        compileQueryStoreConfiguration("master", { maxStorageMb: 500 }, capabilities),
    );
});
void test("wait capture settings are rejected on SQL Server 2016", () => {
    assert.throws(() =>
        compileQueryStoreConfiguration(
            "App",
            { waitCaptureMode: "ON" },
            capabilitiesFrom({ engineEditionId: 3, majorVersion: 13 }),
        ),
    );
});
void test("verification checks actual state and each changed option", () => {
    const state = queryStoreReadiness(true, "App", {
        actual_state: 1,
        desired_state: 2,
        max_storage_size_mb: 500,
        size_based_cleanup_mode_desc: "AUTO",
    });
    assert.equal(
        queryStoreConfigurationMatches(state, { maxStorageMb: 500, cleanupMode: "AUTO" }),
        true,
    );
    assert.equal(queryStoreConfigurationMatches(state, { operationMode: "READ_WRITE" }), false);
    assert.equal(queryStoreConfigurationMatches(state, { maxStorageMb: 1000 }), false);
    assert.equal(queryStoreConfigurationMatches(undefined, { operationMode: "READ_WRITE" }), false);
});
