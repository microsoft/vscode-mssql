/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "node:assert/strict";
import { test } from "node:test";
import { agentServiceState, agentVisibility } from "../../src/agent/readiness";
void test("service absence and future statuses do not imply a stopped service", () => {
    assert.equal(agentServiceState(4), "running");
    assert.equal(agentServiceState(1), "stopped");
    assert.equal(agentServiceState(7), "other");
    assert.equal(agentServiceState(undefined), "unknown");
    assert.equal(agentServiceState(99), "unknown");
});
void test("Agent visibility reflects role evidence without inventing permission denials", () => {
    assert.equal(agentVisibility({ is_user: 1 }), "owned");
    assert.equal(agentVisibility({ is_user: 1, is_reader: 1 }), "all");
    assert.equal(agentVisibility({ is_admin: true }), "all");
    assert.equal(
        agentVisibility({ is_user: 0, is_admin: 0, is_reader: 0, is_operator: 0 }),
        "unknown",
    );
    assert.equal(agentVisibility({ is_user: null }), "unknown");
});
