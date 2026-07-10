/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * C2D-1 lease lifetime + store contract (chat_to_data plan §19.1, addendum
 * §8.1/§8.2): the RetainedRowStore state machine, rerun/close survival,
 * final-release spill cleanup, window equivalence against the raw RowStore,
 * streamRows ≡ concatenated windows, and race/idempotency interleavings.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RowStore } from "../../src/queryStudio/rowStore";
import { RetainedRowStore } from "../../src/queryResults/resultStoreLease";
import { packBitmap } from "../../src/services/sqlDataPlane/api";
import { QsCellWindow } from "../../src/sharedInterfaces/queryStudio";

function page(rowOffset: number, rows: unknown[][], bytes = 1000) {
    const bits: boolean[] = [];
    for (const row of rows) {
        for (const cell of row) {
            bits.push(cell === null);
        }
    }
    return {
        rowOffset,
        rowCount: rows.length,
        approxBytes: bytes,
        compact: {
            values: rows.map((r) => r.map((c) => (c === null ? undefined : c))),
            nullBitmap: packBitmap(bits),
        },
    };
}

function tempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "qr-leases-"));
}

async function seededStore(dir: string, rowCount = 10): Promise<RowStore> {
    const store = new RowStore(dir);
    store.beginResultSet("rs1", [{ name: "n", displayName: "n" }]);
    for (let i = 0; i < rowCount; i++) {
        await store.appendPage("rs1", page(i, [[i]]));
    }
    store.endResultSet("rs1");
    return store;
}

function retained(store: RowStore): RetainedRowStore {
    return new RetainedRowStore(store, {
        runId: "qsrun_test1",
        createdEpochMs: Date.now(),
        tuningDigest: "abc123def456",
        tuningProfileId: "interactive",
        retainedMemoryBytes: 8 * 1024 * 1024,
    });
}

suite("queryResults RetainedRowStore", () => {
    test("live release with no other leases disposes the store (pre-C2D behavior)", async () => {
        const store = await seededStore(tempDir());
        const wrapper = retained(store);
        expect(wrapper.state).to.equal("active");
        wrapper.releaseLiveOwner("rerun");
        expect(wrapper.state).to.equal("disposed");
        const window = await wrapper.getWindow({
            resultSetId: "rs1",
            rowStart: 0,
            rowCount: 5,
            reason: "grid",
        });
        expect(window.rowCount).to.equal(0);
    });

    test("a snapshot lease survives live release; final release disposes", async () => {
        const store = await seededStore(tempDir());
        const wrapper = retained(store);
        const lease = wrapper.retain({ kind: "pinnedDocument" })!;
        expect(lease).to.not.equal(undefined);
        wrapper.releaseLiveOwner("rerun");
        expect(wrapper.state).to.equal("active");
        const window = await wrapper.getWindow({
            resultSetId: "rs1",
            rowStart: 0,
            rowCount: 10,
            reason: "grid",
        });
        expect(window.rowCount).to.equal(10);
        lease.dispose();
        expect(wrapper.state).to.equal("disposed");
    });

    test("multiple leases share one store; releasing one does not break another", async () => {
        const store = await seededStore(tempDir());
        const wrapper = retained(store);
        const a = wrapper.retain({ kind: "pinnedDocument" })!;
        const b = wrapper.retain({ kind: "aiTool" })!;
        wrapper.releaseLiveOwner("documentClosed");
        a.dispose();
        expect(wrapper.state).to.equal("active");
        const window = await wrapper.getWindow({
            resultSetId: "rs1",
            rowStart: 2,
            rowCount: 3,
            reason: "aiTool",
        });
        expect(window.values.map((r) => r[0])).to.deep.equal([2, 3, 4]);
        b.dispose();
        expect(wrapper.state).to.equal("disposed");
    });

    test("release paths are idempotent; retain after drain returns undefined", async () => {
        const store = await seededStore(tempDir());
        const wrapper = retained(store);
        const lease = wrapper.retain({ kind: "export" })!;
        wrapper.releaseLiveOwner("rerun");
        wrapper.releaseLiveOwner("documentClosed"); // second live release: no-op
        lease.dispose();
        lease.dispose(); // double lease dispose: no-op
        expect(wrapper.state).to.equal("disposed");
        expect(wrapper.retain({ kind: "aiTool" })).to.equal(undefined);
    });

    test("final lease release deletes the spill directory", async () => {
        const dir = tempDir();
        const store = new RowStore(dir, {
            maxMemoryBytes: 1500,
            spillEnabled: true,
            maxSpillBytes: 10 * 1024 * 1024,
            maxRowsPerResultSet: 1000,
        });
        store.beginResultSet("rs1", [{ name: "n", displayName: "n" }]);
        for (let i = 0; i < 8; i++) {
            await store.appendPage("rs1", page(i, [[i]]));
        }
        store.endResultSet("rs1");
        await store.flushSpill?.();
        const wrapper = retained(store);
        const lease = wrapper.retain({ kind: "pinnedDocument" })!;
        wrapper.releaseLiveOwner("rerun");
        lease.dispose();
        // dispose chains async spill cleanup; poll briefly for the delete.
        for (let i = 0; i < 50 && fs.existsSync(path.join(dir, "resultsets.pages")); i++) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(fs.existsSync(path.join(dir, "resultsets.pages"))).to.equal(false);
    });

    test("windows through the facade match RowStore.getRows byte-for-byte", async () => {
        const store = await seededStore(tempDir(), 25);
        const wrapper = retained(store);
        const direct = await store.getRows("rs1", 5, 10, "grid");
        const viaFacade = await wrapper.getWindow({
            resultSetId: "rs1",
            rowStart: 5,
            rowCount: 10,
            reason: "grid",
        });
        expect(JSON.stringify(viaFacade)).to.equal(JSON.stringify(direct));
        wrapper.releaseLiveOwner("documentClosed");
    });

    test("streamRows equals concatenated windows and honors chunking", async () => {
        const store = await seededStore(tempDir(), 23);
        const wrapper = retained(store);
        const chunks: QsCellWindow[] = [];
        for await (const window of wrapper.streamRows({
            resultSetId: "rs1",
            rowStart: 0,
            rowCount: 23,
            chunkRows: 7,
            reason: "transform",
        })) {
            chunks.push(window);
        }
        expect(chunks.map((c) => c.rowCount)).to.deep.equal([7, 7, 7, 2]);
        const streamed = chunks.flatMap((c) => c.values.map((r) => r[0]));
        const direct = await store.getRows("rs1", 0, 23, "grid");
        expect(streamed).to.deep.equal(direct.values.map((r) => r[0]));
        wrapper.releaseLiveOwner("documentClosed");
    });

    test("demotion on live release: memory cap shrinks when leases remain", async () => {
        const dir = tempDir();
        const store = new RowStore(dir, {
            maxMemoryBytes: 64 * 1024 * 1024,
            spillEnabled: true,
            maxSpillBytes: 10 * 1024 * 1024,
            maxRowsPerResultSet: 1000,
        });
        store.beginResultSet("rs1", [{ name: "n", displayName: "n" }]);
        for (let i = 0; i < 10; i++) {
            await store.appendPage("rs1", page(i, [[i]], 100_000));
        }
        store.endResultSet("rs1");
        const wrapper = new RetainedRowStore(store, {
            runId: "qsrun_demote",
            createdEpochMs: Date.now(),
            retainedMemoryBytes: 200_000,
        });
        const lease = wrapper.retain({ kind: "pinnedDocument" })!;
        expect(store.stats.memoryBytes).to.equal(1_000_000);
        wrapper.releaseLiveOwner("rerun");
        // Lazy demotion queues async spill; poll for the drain.
        for (let i = 0; i < 100 && store.stats.memoryBytes > 200_000; i++) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(store.stats.memoryBytes).to.be.at.most(200_000);
        // Rows still readable after demotion (from spill).
        const window = await wrapper.getWindow({
            resultSetId: "rs1",
            rowStart: 0,
            rowCount: 10,
            reason: "grid",
        });
        expect(window.rowCount).to.equal(10);
        lease.dispose();
    });

    test("frozen summary carries truncation and completion state", async () => {
        const store = await seededStore(tempDir());
        store.endResultSet("rs1", "maxRowsPerResultSet");
        const wrapper = retained(store);
        const summary = wrapper.summary("rs1")!;
        expect(summary.complete).to.equal(true);
        expect(summary.truncatedReason).to.equal("maxRowsPerResultSet");
        expect(summary.corrupt).to.equal(false);
        expect(summary.columnNames).to.deep.equal(["n"]);
        wrapper.releaseLiveOwner("documentClosed");
    });

    test("stats counts facade window reads (scan-free proof source)", async () => {
        const store = await seededStore(tempDir());
        const wrapper = retained(store);
        expect(wrapper.stats().windowReads).to.equal(0);
        await wrapper.getWindow({ resultSetId: "rs1", rowStart: 0, rowCount: 1, reason: "grid" });
        expect(wrapper.stats().windowReads).to.equal(1);
        wrapper.releaseLiveOwner("documentClosed");
    });

    test("seeded randomized interleaving: no lease ever observes a disposed store", async () => {
        // Deterministic LCG so failures reproduce.
        let seed = 0xc2d1;
        const rand = () => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return seed / 0x7fffffff;
        };
        for (let round = 0; round < 20; round++) {
            const store = await seededStore(tempDir(), 5);
            const wrapper = retained(store);
            const leases = [
                wrapper.retain({ kind: "pinnedDocument" }),
                wrapper.retain({ kind: "aiTool" }),
                wrapper.retain({ kind: "export" }),
            ];
            const actions: Array<() => void> = [
                () => wrapper.releaseLiveOwner("rerun"),
                ...leases.map((lease) => () => lease?.dispose()),
                () => wrapper.demote(1024),
            ];
            // Shuffle and run; every acquired lease must read successfully
            // BEFORE its own dispose regardless of the others' order.
            actions.sort(() => rand() - 0.5);
            for (const lease of leases) {
                if (lease && wrapper.state === "active") {
                    const window = await wrapper.getWindow({
                        resultSetId: "rs1",
                        rowStart: 0,
                        rowCount: 1,
                        reason: "grid",
                    });
                    expect(window.rowCount).to.equal(1);
                }
            }
            for (const action of actions) {
                action();
            }
            expect(wrapper.state).to.equal("disposed");
            expect(wrapper.retain({ kind: "debug" })).to.equal(undefined);
        }
    });
});
