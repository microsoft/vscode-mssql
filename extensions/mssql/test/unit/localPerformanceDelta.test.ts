/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { compareLocalPerformanceSnapshots } from "../../src/runbookStudio/runtime/localPerformanceDelta";
import type { LocalPerformanceSnapshotResult } from "../../src/runbookStudio/runtime/localPerformanceSnapshot";

function snapshot(
    capturedAtUtc: string,
    values: Array<[category: string, item: string, metric: string, value: number]>,
    truncated = false,
): LocalPerformanceSnapshotResult {
    const rows = values.map(([category, item, metric, value]) => ({
        capturedAtUtc,
        scope: category === "server_waits_cumulative" ? ("server" as const) : ("database" as const),
        category,
        item,
        metric,
        value,
        unit: metric.includes("time") ? "ms" : "count",
    }));
    return {
        capturedAtUtc,
        rows,
        totalMetricCount: rows.length,
        truncated,
        snapshotSha256: capturedAtUtc.startsWith("2026-07-22T08:00")
            ? "a".repeat(64)
            : "b".repeat(64),
        categoryCounts: {},
    };
}

suite("Runbook Studio local performance delta", () => {
    test("computes cumulative and point-in-time deltas without assigning a verdict", () => {
        const result = compareLocalPerformanceSnapshots(
            snapshot("2026-07-22T08:00:00.000Z", [
                ["database_io", "ROWS:Db", "reads", 10],
                ["database_space", "ROWS:Db", "allocated", 100],
            ]),
            snapshot("2026-07-22T08:01:00.000Z", [
                ["database_io", "ROWS:Db", "reads", 52],
                ["database_space", "ROWS:Db", "allocated", 96],
            ]),
        );

        expect(result.rows).to.deep.include.members([
            {
                scope: "database",
                category: "database_io",
                item: "ROWS:Db",
                metric: "reads",
                unit: "count",
                beforeValue: 10,
                afterValue: 52,
                deltaValue: 42,
                comparability: "comparable",
            },
            {
                scope: "database",
                category: "database_space",
                item: "ROWS:Db",
                metric: "allocated",
                unit: "count",
                beforeValue: 100,
                afterValue: 96,
                deltaValue: -4,
                comparability: "pointInTime",
            },
        ]);
        expect(result).to.deep.include({
            comparableMetricCount: 2,
            incompleteMetricCount: 0,
            counterResetMetricCount: 0,
            inputTruncated: false,
            truncated: false,
        });
        expect(result).not.to.have.property("verdict");
        expect(result.deltaSha256).to.match(/^[a-f0-9]{64}$/);
    });

    test("reports missing metrics, reset counters, and truncated source evidence", () => {
        const result = compareLocalPerformanceSnapshots(
            snapshot("2026-07-22T08:00:00.000Z", [
                ["database_io", "ROWS:Db", "reads", 100],
                ["database_io", "ROWS:Db", "writes", 5],
            ]),
            snapshot(
                "2026-07-22T08:01:00.000Z",
                [
                    ["database_io", "ROWS:Db", "reads", 2],
                    ["server_waits_cumulative", "WRITELOG", "wait_time", 8],
                ],
                true,
            ),
        );

        expect(result.rows.map((row) => row.comparability)).to.have.members([
            "counterReset",
            "missingAfter",
            "missingBefore",
        ]);
        expect(result).to.deep.include({
            comparableMetricCount: 0,
            incompleteMetricCount: 3,
            counterResetMetricCount: 1,
            inputTruncated: true,
        });
    });

    test("refuses reversed time and duplicate metric identities", () => {
        const before = snapshot("2026-07-22T08:01:00.000Z", [
            ["database_io", "ROWS:Db", "reads", 1],
        ]);
        const after = snapshot("2026-07-22T08:00:00.000Z", [
            ["database_io", "ROWS:Db", "reads", 2],
        ]);
        expect(() => compareLocalPerformanceSnapshots(before, after)).to.throw(
            "chronological order",
        );

        before.capturedAtUtc = "2026-07-22T08:00:00.000Z";
        after.capturedAtUtc = "2026-07-22T08:01:00.000Z";
        before.rows.push({ ...before.rows[0] });
        expect(() => compareLocalPerformanceSnapshots(before, after)).to.throw(
            "duplicate metric identity",
        );
    });
});
