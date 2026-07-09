/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RowStore } from "../../../src/queryStudio/rowStore";

suite("Query Studio RowStore", () => {
    test("serves high-offset windows from many small pages", async () => {
        const spillDir = fs.mkdtempSync(path.join(os.tmpdir(), "qs-row-store-"));
        const store = new RowStore(spillDir);
        try {
            store.beginResultSet("r0", [
                { name: "id", displayName: "id" },
                { name: "name", displayName: "name" },
            ]);
            for (let i = 0; i < 1000; i++) {
                await store.appendPage("r0", {
                    rowOffset: i,
                    rowCount: 1,
                    approxBytes: 16,
                    compact: { values: [[i, `value-${i}`]] },
                });
            }

            const window = await store.getRows("r0", 995, 3);

            expect(window.rowCount).to.equal(3);
            expect(window.values).to.deep.equal([
                [995, "value-995"],
                [996, "value-996"],
                [997, "value-997"],
            ]);
            expect(store.stats.pages).to.equal(1000);
        } finally {
            store.dispose();
        }
    });

    test("spill round-trip: eviction under memory cap, windows served from spill, stats attribute it", async () => {
        const spillDir = fs.mkdtempSync(path.join(os.tmpdir(), "qs-row-store-"));
        // Tiny memory cap forces early pages out to spill.
        const store = new RowStore(spillDir, {
            maxMemoryBytes: 4 * 1024,
            spillEnabled: true,
            maxSpillBytes: 64 * 1024 * 1024,
            maxRowsPerResultSet: 1_000_000,
        });
        try {
            store.beginResultSet("r0", [{ name: "v", displayName: "v" }]);
            for (let i = 0; i < 100; i++) {
                await store.appendPage("r0", {
                    rowOffset: i * 10,
                    rowCount: 10,
                    approxBytes: 512,
                    compact: {
                        values: Array.from({ length: 10 }, (_, r) => [`row-${i * 10 + r}`]),
                    },
                });
            }
            await store.flushSpill();
            expect(store.stats.spillWrites).to.be.greaterThan(0);
            expect(store.stats.spillBytes).to.be.greaterThan(0);
            expect(store.stats.memoryBytes).to.be.at.most(4 * 1024 + 512);

            // A window over early (spilled) pages materializes correctly.
            const window = await store.getRows("r0", 0, 5);
            expect(window.rowCount).to.equal(5);
            expect(window.values).to.deep.equal([
                ["row-0"],
                ["row-1"],
                ["row-2"],
                ["row-3"],
                ["row-4"],
            ]);
            expect(store.stats.spillReads).to.be.greaterThan(0);
            expect(store.stats.spillWriteMsTotal).to.be.at.least(0);
            expect(store.stats.materializeMsTotal).to.be.greaterThan(0);
        } finally {
            store.dispose();
        }
    });

    test("row cap rejects the overflowing page and records the truncation reason", async () => {
        const spillDir = fs.mkdtempSync(path.join(os.tmpdir(), "qs-row-store-"));
        const store = new RowStore(spillDir, {
            maxMemoryBytes: 64 * 1024 * 1024,
            spillEnabled: true,
            maxSpillBytes: 64 * 1024 * 1024,
            maxRowsPerResultSet: 15,
        });
        try {
            store.beginResultSet("r0", [{ name: "v", displayName: "v" }]);
            expect(
                await store.appendPage("r0", {
                    rowOffset: 0,
                    rowCount: 10,
                    approxBytes: 100,
                    compact: { values: Array.from({ length: 10 }, (_, r) => [r]) },
                }),
            ).to.equal(true);
            expect(
                await store.appendPage("r0", {
                    rowOffset: 10,
                    rowCount: 10,
                    approxBytes: 100,
                    compact: { values: Array.from({ length: 10 }, (_, r) => [10 + r]) },
                }),
            ).to.equal(false);
            expect(store.summary("r0")?.truncatedReason).to.equal("maxRowsPerResultSet");
            expect(store.summary("r0")?.rowCount).to.equal(10);
        } finally {
            store.dispose();
        }
    });

    test("diagnostics level does not change served windows (verbose only prices counting)", async () => {
        for (const level of ["minimal", "verbose"] as const) {
            const spillDir = fs.mkdtempSync(path.join(os.tmpdir(), "qs-row-store-"));
            const store = new RowStore(
                spillDir,
                {
                    maxMemoryBytes: 64 * 1024 * 1024,
                    spillEnabled: true,
                    maxSpillBytes: 64 * 1024 * 1024,
                    maxRowsPerResultSet: 1000,
                },
                level,
            );
            try {
                store.beginResultSet("r0", [
                    { name: "a", displayName: "a" },
                    { name: "b", displayName: "b" },
                ]);
                await store.appendPage("r0", {
                    rowOffset: 0,
                    rowCount: 3,
                    approxBytes: 64,
                    compact: {
                        values: [
                            [1, "x"],
                            [2, undefined],
                            [3, ""],
                        ],
                    },
                });
                const window = await store.getRows("r0", 0, 3);
                expect(window.rowCount, level).to.equal(3);
                expect(window.nullBitmap, level).to.be.a("string");
                expect(window.values[1]?.[1], level).to.equal(undefined);
            } finally {
                store.dispose();
            }
        }
    });

    test("export-reason reads stream from spill WITHOUT evicting the viewport (QO-6)", async () => {
        const spillDir = fs.mkdtempSync(path.join(os.tmpdir(), "qs-row-store-"));
        const store = new RowStore(
            spillDir,
            {
                maxMemoryBytes: 4 * 1024,
                spillEnabled: true,
                maxSpillBytes: 64 * 1024 * 1024,
                maxRowsPerResultSet: 1_000_000,
            },
            "minimal",
            {
                maxPendingSpillBytes: 32 * 1024 * 1024,
                protectedCacheRatio: 0.5,
                windowCacheEntries: 8,
            },
        );
        try {
            store.beginResultSet("r0", [{ name: "v", displayName: "v" }]);
            for (let i = 0; i < 100; i++) {
                await store.appendPage("r0", {
                    rowOffset: i * 10,
                    rowCount: 10,
                    approxBytes: 512,
                    compact: {
                        values: Array.from({ length: 10 }, (_, r) => [`row-${i * 10 + r}`]),
                    },
                });
            }
            await store.flushSpill();
            // Pin a viewport window (grid reason promotes to protected).
            const viewport = await store.getRows("r0", 990, 10, "grid");
            expect(viewport.rowCount).to.equal(10);
            const memoryBefore = store.stats.memoryBytes;

            // Full export scan over the (mostly spilled) set: values correct,
            // and NOTHING was re-admitted — the viewport stays resident.
            let exported = 0;
            for (let start = 0; start < 1000; start += 100) {
                const window = await store.getRows("r0", start, 100, "export");
                exported += window.rowCount;
            }
            expect(exported).to.equal(1000);
            expect(store.stats.memoryBytes).to.equal(memoryBefore);

            // The viewport re-fetch is a warm window-cache hit (no spill read).
            const spillReadsBefore = store.stats.spillReads;
            const again = await store.getRows("r0", 990, 10, "grid");
            expect(again.rowCount).to.equal(10);
            expect(store.stats.spillReads).to.equal(spillReadsBefore);
            expect(store.stats.windowCacheHits).to.be.greaterThan(0);
        } finally {
            store.dispose();
        }
    });

    test("spill cap rejects with spillLimit and the run truncates honestly (QO-6)", async () => {
        const spillDir = fs.mkdtempSync(path.join(os.tmpdir(), "qs-row-store-"));
        const store = new RowStore(spillDir, {
            maxMemoryBytes: 1024,
            spillEnabled: true,
            maxSpillBytes: 2048, // tiny: the spill file fills almost immediately
            maxRowsPerResultSet: 1_000_000,
        });
        try {
            store.beginResultSet("r0", [{ name: "v", displayName: "v" }]);
            let accepted = true;
            for (let i = 0; i < 200 && accepted; i++) {
                accepted = await store.appendPage("r0", {
                    rowOffset: i * 10,
                    rowCount: 10,
                    approxBytes: 600,
                    compact: {
                        values: Array.from({ length: 10 }, (_, r) => [`row-${i * 10 + r}`]),
                    },
                });
                await store.flushSpill();
            }
            expect(accepted).to.equal(false);
            expect(store.summary("r0")?.truncatedReason).to.equal("spillLimit");
        } finally {
            store.dispose();
        }
    });
});
