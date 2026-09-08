/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "node:assert/strict";
import { test } from "node:test";
import { capabilitiesFrom } from "../../src/core/platform";
import {
    dmvReadinessFrom,
    dmvReadinessWithCollectorFailure,
} from "../../src/diagnostics/dmv/readiness";

void test("a failed collector is distinct from denied and empty readiness", () => {
    const readiness = dmvReadinessFrom(capabilitiesFrom({ engineEditionId: 3, majorVersion: 16 }), {
        view_server_state: 1,
        view_database_state: 1,
    });
    const failed = dmvReadinessWithCollectorFailure(
        readiness,
        "overview",
        "The overview collector timed out.",
    );

    assert.equal(failed.collectors.overview.status, "failed");
    assert.equal(failed.collectors.overview.error, "The overview collector timed out.");
    assert.equal(failed.status, "partial");
    assert.equal(failed.collectors.workload.status, "ready");
});

void test("a readiness probe failure remains unknown and keeps its reason", () => {
    const readiness = dmvReadinessFrom(
        capabilitiesFrom({ engineEditionId: 3, majorVersion: 16 }),
        undefined,
        "The permission probe could not be completed.",
    );

    assert.equal(readiness.status, "unknown");
    assert.equal(readiness.error, "The permission probe could not be completed.");
    assert.equal(readiness.collectors.overview.status, "unknown");
});
