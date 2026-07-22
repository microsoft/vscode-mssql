/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    LOCAL_PERFORMANCE_SNAPSHOT_SQL,
    LocalPerformanceSnapshotError,
    MAX_LOCAL_PERFORMANCE_SNAPSHOT_ROWS,
    projectLocalPerformanceSnapshot,
} from "../../src/runbookStudio/runtime/localPerformanceSnapshot";

suite("Runbook Studio local performance snapshot", () => {
    test("uses one closed bounded collector without returning SQL or identity fields", () => {
        expect(LOCAL_PERFORMANCE_SNAPSHOT_SQL).to.contain(
            `SELECT TOP (${MAX_LOCAL_PERFORMANCE_SNAPSHOT_ROWS})`,
        );
        expect(LOCAL_PERFORMANCE_SNAPSHOT_SQL).to.contain(
            "sys.dm_io_virtual_file_stats(DB_ID(), NULL)",
        );
        expect(LOCAL_PERFORMANCE_SNAPSHOT_SQL).to.contain("sys.dm_os_wait_stats");
        expect(LOCAL_PERFORMANCE_SNAPSHOT_SQL).to.contain("sys.dm_exec_query_stats");
        expect(LOCAL_PERFORMANCE_SNAPSHOT_SQL).to.contain("sys.dm_exec_requests");
        expect(LOCAL_PERFORMANCE_SNAPSHOT_SQL).not.to.match(
            /SELECT[^;]*(?:statement_text\.text|login_name|host_name|program_name)/i,
        );
    });

    test("projects typed metric rows, completeness, counts, and a stable digest", () => {
        const rows = [
            [
                "2026-07-22T08:00:00.000Z",
                "database",
                "database_io",
                "ROWS:CitiesWorkload",
                "reads",
                "42",
                "count",
                "3",
            ],
            [
                "2026-07-22T08:00:00.000Z",
                "server",
                "server_waits_cumulative",
                "WRITELOG",
                "wait_time",
                12,
                "ms",
                3,
            ],
        ];

        const first = projectLocalPerformanceSnapshot(rows);
        const second = projectLocalPerformanceSnapshot(rows);

        expect(first).to.deep.include({
            capturedAtUtc: "2026-07-22T08:00:00.000Z",
            totalMetricCount: 3,
            truncated: true,
            categoryCounts: { database_io: 1, server_waits_cumulative: 1 },
        });
        expect(first.rows[0]).to.deep.include({ value: 42, unit: "count" });
        expect(first.snapshotSha256).to.match(/^[a-f0-9]{64}$/);
        expect(second.snapshotSha256).to.equal(first.snapshotSha256);
    });

    test("refuses malformed, negative, inconsistent, and unbounded evidence", () => {
        const valid = [
            "2026-07-22T08:00:00.000Z",
            "database",
            "database_io",
            "ROWS:CitiesWorkload",
            "reads",
            42,
            "count",
            1,
        ];
        for (const rows of [
            [],
            [valid.slice(0, 7)],
            [[...valid.slice(0, 5), -1, ...valid.slice(6)]],
            [[...valid.slice(0, 1), "secret", ...valid.slice(2)]],
            [[...valid.slice(0, 7), 0]],
        ]) {
            expect(() => projectLocalPerformanceSnapshot(rows)).to.throw(
                LocalPerformanceSnapshotError,
            );
        }
        expect(() =>
            projectLocalPerformanceSnapshot(
                Array.from({ length: MAX_LOCAL_PERFORMANCE_SNAPSHOT_ROWS + 1 }, () => valid),
            ),
        ).to.throw(LocalPerformanceSnapshotError);
    });
});
