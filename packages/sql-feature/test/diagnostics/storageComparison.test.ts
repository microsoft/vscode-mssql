/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "node:assert/strict";
import { test } from "node:test";
import { compareFileIoCounters } from "../../src/diagnostics/dmv/storageComparison";

void test("file I/O comparison uses identity and counter deltas", () => {
    const comparison = compareFileIoCounters(
        [
            {
                database_name: "App",
                file_name: "App.mdf",
                type_desc: "ROWS",
                io_stall_read_ms: 100,
                io_stall_write_ms: 40,
                num_of_reads: 10,
                num_of_writes: 4,
            },
        ],
        [
            {
                database_name: "App",
                file_name: "App.mdf",
                type_desc: "ROWS",
                io_stall_read_ms: 160,
                io_stall_write_ms: 70,
                num_of_reads: 15,
                num_of_writes: 7,
                size_bytes: 2048,
            },
        ],
        { baselineComplete: true, currentComplete: true },
    );
    assert.equal(comparison.status, "delta");
    assert.deepEqual(comparison.rows[0], {
        database_name: "App",
        file_name: "App.mdf",
        type_desc: "ROWS",
        io_stall_read_ms: 60,
        io_stall_write_ms: 30,
        num_of_reads: 5,
        num_of_writes: 3,
        avg_read_stall_ms: 12,
        avg_write_stall_ms: 10,
        read_latency_status: "measured",
        write_latency_status: "measured",
        size_bytes: 2048,
    });
});

void test("file I/O comparison refuses counter resets and incomplete samples", () => {
    const baseline = [
        {
            database_name: "App",
            file_name: "App.mdf",
            type_desc: "ROWS",
            io_stall_read_ms: 10,
            io_stall_write_ms: 0,
            num_of_reads: 1,
            num_of_writes: 0,
        },
    ];
    const reset = compareFileIoCounters(baseline, [{ ...baseline[0], io_stall_read_ms: 2 }], {
        baselineComplete: true,
        currentComplete: true,
    });
    assert.equal(reset.status, "invalid");
    assert.equal(reset.reason, "counterReset");
    assert.equal(
        compareFileIoCounters(baseline, baseline, {
            baselineComplete: false,
            currentComplete: true,
        }).reason,
        "incomplete",
    );
});
