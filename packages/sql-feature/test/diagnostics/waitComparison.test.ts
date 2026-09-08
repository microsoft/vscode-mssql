/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "node:assert/strict";
import { test } from "node:test";
import { compareWaitCounters } from "../../src/diagnostics/dmv/waitComparison";

void test("wait comparison creates a baseline before calculating a delta", () => {
    const baseline = [
        {
            wait_type: "LCK_M_X",
            wait_time_ms: 100,
            waiting_tasks_count: 4,
            signal_wait_time_ms: 10,
        },
    ];
    const first = compareWaitCounters(undefined, baseline, {
        baselineComplete: true,
        currentComplete: true,
    });
    assert.equal(first.status, "baseline");

    const second = compareWaitCounters(
        baseline,
        [
            {
                wait_type: "LCK_M_X",
                wait_time_ms: 160,
                waiting_tasks_count: 7,
                signal_wait_time_ms: 25,
            },
        ],
        { baselineComplete: true, currentComplete: true },
    );
    assert.equal(second.status, "delta");
    assert.equal(second.rows[0].wait_time_ms, 60);
    assert.equal(second.rows[0].waiting_tasks_count, 3);
    assert.equal(second.rows[0].pct_of_total, 100);
});

void test("a counter reset invalidates the interval instead of showing negative waits", () => {
    const result = compareWaitCounters(
        [
            {
                wait_type: "PAGEIOLATCH_SH",
                wait_time_ms: 500,
                waiting_tasks_count: 9,
                signal_wait_time_ms: 2,
            },
        ],
        [
            {
                wait_type: "PAGEIOLATCH_SH",
                wait_time_ms: 3,
                waiting_tasks_count: 1,
                signal_wait_time_ms: 0,
            },
        ],
        { baselineComplete: true, currentComplete: true },
    );
    assert.equal(result.status, "invalid");
    assert.equal(result.reason, "counterReset");
});
