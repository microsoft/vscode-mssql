/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "node:assert/strict";
import { test } from "node:test";
import { canApplyJobAction, jobActionFingerprint } from "../../src/agent/authorization";
void test("reader visibility does not confer control of another owner's jobs", () => {
    const reader = { is_reader: 1, is_local: 1, can_start: 1 };
    assert.equal(canApplyJobAction(reader, "start"), false);
    assert.equal(canApplyJobAction({ ...reader, is_owner: 1 }, "start"), true);
});
void test("operators manage local execution and enablement but not others' definitions", () => {
    const operator = { is_operator: 1, is_local: 1, can_start: 1, can_enable: 1, can_delete: 1 };
    assert.equal(canApplyJobAction(operator, "start"), true);
    assert.equal(canApplyJobAction(operator, "enable"), true);
    assert.equal(canApplyJobAction(operator, "delete"), false);
    assert.equal(canApplyJobAction({ ...operator, is_local: 0 }, "start"), false);
    assert.equal(canApplyJobAction({ ...operator, can_enable: 0 }, "enable"), false);
});
void test("missing role or procedure evidence is not positive authorization", () => {
    assert.equal(canApplyJobAction(undefined, "start"), false);
    assert.equal(canApplyJobAction({ is_owner: 1, is_local: 1 }, "start"), false);
    assert.equal(canApplyJobAction({ is_admin: 1 }, "delete"), true);
});
void test("review fingerprint follows definition and authorization rather than row ordering", () => {
    assert.equal(
        jobActionFingerprint({ name: "Job", version_number: 1 }),
        jobActionFingerprint({ version_number: 1, name: "Job" }),
    );
    assert.notEqual(
        jobActionFingerprint({ name: "Job", version_number: 1 }),
        jobActionFingerprint({ name: "Job", version_number: 2 }),
    );
    assert.notEqual(jobActionFingerprint({ is_admin: 1 }), jobActionFingerprint({ is_admin: 0 }));
});
