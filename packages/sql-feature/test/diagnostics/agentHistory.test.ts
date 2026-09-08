/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "node:assert/strict";
import { test } from "node:test";
import { groupJobHistory } from "../../src/agent/history";
void test("history groups retries by execution boundaries and preserves original row indexes", () => {
    const rows = [
        { instance_id: 6, step_id: 0, run_status_code: 1, run_time: "2028-01-02T01:00:00" },
        { instance_id: 5, step_id: 1, run_status_code: 1, run_time: "2028-01-02T01:02:00" },
        { instance_id: 4, step_id: 1, run_status_code: 2, run_time: "2028-01-02T01:00:00" },
        { instance_id: 3, step_id: 0, run_status_code: 0, run_time: "2028-01-01T01:00:00" },
        { instance_id: 2, step_id: 2, run_status_code: 0, run_time: "2028-01-01T01:02:00" },
        { instance_id: 1, step_id: 1, run_status_code: 1, run_time: "2028-01-01T01:00:00" },
    ];
    assert.deepEqual(groupJobHistory(rows), [
        { summaryIndex: 0, stepIndexes: [2, 1] },
        { summaryIndex: 3, stepIndexes: [5, 4] },
    ]);
});
void test("missing summaries, unknown outcomes and mismatched timestamps remain unassigned", () => {
    const rows = [
        { instance_id: 5, step_id: 1, run_time: "2028-01-03T00:00:00" },
        { instance_id: 4, step_id: 0, run_status_code: 1, run_time: "2028-01-02T00:00:00" },
        { instance_id: 3, step_id: 1, run_time: "2028-01-01T00:00:00" },
        { instance_id: 2, step_id: 0, run_status_code: null, run_time: "2028-01-01T00:00:00" },
        { instance_id: 1, step_id: 1, run_time: null },
    ];
    assert.deepEqual(groupJobHistory(rows), [
        { stepIndexes: [0, 2, 3, 4] },
        { summaryIndex: 1, stepIndexes: [] },
    ]);
});
void test("history grouping accepts database numeric values returned as strings", () => {
    const groups = groupJobHistory([
        { instance_id: "2", step_id: "0", run_status_code: "1", run_time: "2028-01-02T00:00:00Z" },
        { instance_id: "1", step_id: "1", run_status_code: "1", run_time: "2028-01-02T00:01:00Z" },
    ]);
    assert.deepEqual(groups, [{ summaryIndex: 0, stepIndexes: [1] }]);
});
