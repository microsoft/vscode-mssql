/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
    compareQueryStorePlans,
    compareQueryStoreWindows,
    queryStoreCoverageFromRows,
    queryStoreWindowEvidence,
} from "../../src/diagnostics/querystore/evidence";

void test("Query Store evidence preserves interval coverage and rejects clipped plans", () => {
    const evidence = queryStoreWindowEvidence(
        {
            executions: 12,
            available_interval_count: 8,
            observed_interval_count: 3,
            first_interval_start: "2026-09-07T10:00:00Z",
            last_interval_start: "2026-09-07T11:00:00Z",
        },
        true,
    );
    assert.equal(evidence.status, "partial");
    assert.equal(evidence.executions, 12);
    assert.equal(evidence.observedIntervals, 3);
    assert.equal(evidence.availableIntervals, 8);
    assert.equal(evidence.firstObservedInterval, "2026-09-07T10:00:00.000Z");
});

void test("Query Store comparison requires evidence in both windows", () => {
    const recent = queryStoreWindowEvidence({
        executions: 20,
        observed_interval_count: 4,
    });
    const baseline = queryStoreWindowEvidence({
        executions: 20,
        observed_interval_count: 4,
    });
    const comparison = compareQueryStoreWindows(recent, baseline, 410, 100, 5);
    assert.equal(comparison.status, "comparable");
    assert.equal(comparison.ratio, 4.1);
});

void test("Query Store coverage gaps are partial even when transport is complete", () => {
    const recent = queryStoreWindowEvidence({
        executions: 20,
        observed_interval_count: 3,
        available_interval_count: 8,
    });
    const baseline = queryStoreWindowEvidence({
        executions: 20,
        observed_interval_count: 8,
        available_interval_count: 8,
    });
    assert.equal(recent.status, "partial");
    assert.equal(compareQueryStoreWindows(recent, baseline, 410, 100, 5).status, "partialCoverage");
});

void test("Query Store comparison does not produce a ratio for weak or unknown evidence", () => {
    const recent = queryStoreWindowEvidence({ executions: 2, observed_interval_count: 1 });
    const baseline = queryStoreWindowEvidence({ executions: 10, observed_interval_count: 2 });
    assert.equal(
        compareQueryStoreWindows(recent, baseline, 200, 100, 5).status,
        "insufficientExecutions",
    );
    assert.equal(
        compareQueryStoreWindows(recent, undefined, 200, 100, 5).status,
        "missingBaseline",
    );
    assert.equal(
        compareQueryStoreWindows(queryStoreWindowEvidence(undefined), baseline, 200, 100, 5).status,
        "unknown",
    );
});

void test("Query Store plan comparison uses explicit selections, not plan-id chronology", () => {
    const first = {
        planId: 9,
        executions: 10,
        observedIntervals: 2,
    };
    const second = {
        planId: 4,
        executions: 10,
        observedIntervals: 2,
    };
    const comparison = compareQueryStorePlans(first, second, 410, 100, 5);
    assert.equal(comparison.status, "comparable");
    assert.equal(comparison.firstPlanId, 9);
    assert.equal(comparison.secondPlanId, 4);
    assert.equal(comparison.metricRatio, 4.1);
});

void test("Query Store coverage preserves separate recent and baseline interval counts", () => {
    const coverage = queryStoreCoverageFromRows([
        {
            recent_observed_interval_count: 3,
            recent_available_interval_count: 8,
            baseline_observed_interval_count: 6,
            baseline_available_interval_count: 9,
        },
        {
            recent_observed_interval_count: 2,
            recent_available_interval_count: 8,
            baseline_observed_interval_count: 4,
            baseline_available_interval_count: 9,
        },
    ]);
    assert.deepEqual(coverage, {
        observedIntervals: 3,
        availableIntervals: 8,
        baselineObservedIntervals: 6,
        baselineAvailableIntervals: 9,
    });
});
