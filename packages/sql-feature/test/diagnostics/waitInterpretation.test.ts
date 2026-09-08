/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
    dmvBlockingTree,
    dmvFindings,
    waitInvestigation,
} from "../../src/diagnostics/dmv/interpretation";

void test("wait categories distinguish disk-page I/O from in-memory latch contention", () => {
    assert.equal(waitInvestigation("PAGEIOLATCH_SH"), "dataIo");
    assert.equal(waitInvestigation("PAGELATCH_SH"), "unknown");
    assert.equal(waitInvestigation("LCK_M_X"), "locking");
    assert.equal(waitInvestigation("WRITELOG"), "logIo");
});
void test("coordination and client-consumption waits remain investigation categories", () => {
    assert.equal(waitInvestigation("ASYNC_NETWORK_IO"), "client");
    assert.equal(waitInvestigation("CXCONSUMER"), "parallelism");
    assert.equal(waitInvestigation("SOS_WORK_DISPATCHER"), "unknown");
    assert.equal(waitInvestigation("NEW_SERVER_WAIT_TYPE"), "unknown");
});

void test("blocking findings preserve bounded relationship evidence", () => {
    const findings = dmvFindings("dmv.blockingChain", [
        {
            level: 1,
            session_id: 51,
            blocking_session_id: 52,
            relationship: "intermediate blocker",
            chain_status: "visible",
        },
        {
            level: 2,
            session_id: 52,
            blocking_session_id: 51,
            relationship: "intermediate blocker",
            chain_status: "cycle detected",
        },
        {
            level: 3,
            session_id: 53,
            blocking_session_id: -2,
            relationship: "special blocker",
            chain_status: "not visible in current request/session snapshot",
        },
    ]);
    assert.deepEqual(
        findings.map((finding) => finding.id),
        [
            "dmv.blocking.relationships-observed",
            "dmv.blocking.cycle-observed",
            "dmv.blocking.invisible-parent",
            "dmv.blocking.special-identifier",
        ],
    );
    assert.equal(findings[0].metrics.relationships, 3);
    assert.equal(findings[0].metrics.maxDepth, 3);
    assert.equal(findings[1].evidence[0].rowIndex, 1);
    assert.equal(findings[3].evidence[0].rowIndex, 2);
});

void test("wait and storage findings retain unknown and unmeasured evidence", () => {
    const waitFindings = dmvFindings("dmv.waitStats", [
        { wait_type: "LCK_M_X", wait_time_ms: 100, pct_of_total: 60 },
        { wait_type: "NEW_SERVER_WAIT_TYPE", wait_time_ms: 50, pct_of_total: 30 },
    ]);
    assert.deepEqual(
        waitFindings.map((finding) => finding.id),
        ["dmv.wait.category.locking", "dmv.wait.category.unknown"],
    );
    assert.equal(waitFindings[1].severity, "caution");
    assert.equal(waitFindings[1].evidence[0].rowIndex, 1);

    const storageFindings = dmvFindings("dmv.fileIoStalls", [
        {
            database_name: "db",
            file_name: "db.mdf",
            read_latency_status: "not measured",
            write_latency_status: "measured",
            num_of_reads: 0,
            num_of_writes: 4,
        },
    ]);
    assert.deepEqual(
        storageFindings.map((finding) => finding.id),
        ["dmv.storage.read-not-measured"],
    );
    assert.equal(storageFindings[0].evidence[0].rowIndex, 0);
});

void test("blocking tree remains finite for cycles and keeps invisible or special parents explicit", () => {
    const tree = dmvBlockingTree([
        {
            session_id: 51,
            blocking_session_id: 52,
            chain_status: "visible",
        },
        {
            session_id: 52,
            blocking_session_id: 51,
            chain_status: "cycle detected",
        },
        {
            session_id: 53,
            blocking_session_id: -2,
            chain_status: "special identifier",
        },
        {
            session_id: 54,
            blocking_session_id: 99,
            chain_status: "not visible in current request/session snapshot",
        },
    ]);
    assert.equal(tree.length, 3);
    const cycleRoot = tree.find((node) => node.sessionId === 51);
    const specialRoot = tree.find((node) => node.sessionId === 53);
    const invisibleRoot = tree.find((node) => node.sessionId === 54);
    assert.equal(cycleRoot?.children[0].status, "cycle");
    assert.equal(specialRoot?.status, "special");
    assert.equal(invisibleRoot?.status, "invisible");
});
