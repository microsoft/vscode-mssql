/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "node:assert/strict";
import { test } from "node:test";
import { queryStoreReadiness } from "../../src/diagnostics/querystore/readiness";

void test("empty or denied metadata never becomes off or healthy", () => {
    for (const row of [undefined, {}, { actual_state: null }, { actual_state: "" }]) {
        const state = queryStoreReadiness(true, "App", row);
        assert.equal(state.status, "unknown");
        assert.equal(state.access, "inconclusive");
        assert.equal(state.canReadHistory, false);
        assert.equal(state.canConfigure, undefined);
    }
});
void test("unsupported system databases cannot offer setup", () => {
    for (const name of ["master", "TEMPDB"])
        assert.equal(queryStoreReadiness(true, name).status, "unsupported");
    assert.equal(queryStoreReadiness(false, "App").status, "unsupported");
    assert.equal(queryStoreReadiness(false, "App").access, "notApplicable");
});
void test("read-only history is available while collection is paused", () => {
    assert.equal(
        queryStoreReadiness(true, "App", { actual_state: 1, desired_state: 1 }).status,
        "readOnly",
    );
    const state = queryStoreReadiness(true, "App", {
        actual_state: 1,
        desired_state: 2,
        readonly_reason: 65536 + 8 + 16,
    });
    assert.equal(state.status, "readOnlyUnexpected");
    assert.equal(state.access, "granted");
    assert.equal(state.canReadHistory, true);
    assert.deepEqual(state.readonlyReasons, [8, 65536]);
    assert.equal(state.unknownReasonBits, 16);
});
void test("denied history access does not claim that collection is healthy", () => {
    const state = queryStoreReadiness(true, "App", {
        actual_state: 2,
        desired_state: 2,
        can_read_history: 0,
    });
    assert.equal(state.status, "unknown");
    assert.equal(state.access, "denied");
    assert.equal(state.canReadHistory, false);
});
void test("collection, permissions and capture settings stay independent", () => {
    const state = queryStoreReadiness(true, "App", {
        actual_state: 2,
        desired_state: 2,
        can_configure: 0,
        query_capture_mode_desc: "NONE",
        current_storage_size_mb: 0,
        max_storage_size_mb: 100,
        interval_length_minutes: 60,
        flush_interval_seconds: 900,
    });
    assert.equal(state.status, "collecting");
    assert.equal(state.canConfigure, false);
    assert.equal(state.captureMode, "NONE");
    assert.equal(state.currentStorageMb, 0);
    assert.equal(state.runtimeIntervalMinutes, 60);
    assert.equal(state.flushIntervalSeconds, 900);
});
void test("error and future states never masquerade as collecting", () => {
    assert.equal(queryStoreReadiness(true, "App", { actual_state: 3 }).status, "error");
    assert.equal(queryStoreReadiness(true, "App", { actual_state: 99 }).status, "unknown");
    assert.equal(queryStoreReadiness(true, "App", { actual_state: 8 }).status, "secondary");
    assert.equal(queryStoreReadiness(true, "App", { actual_state: 0 }).status, "off");
});
