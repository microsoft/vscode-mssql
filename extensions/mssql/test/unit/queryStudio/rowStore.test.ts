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
                        values: Array.from({ length: 10 }, (_, r) => [
                            i === 0 && r === 0 ? undefined : `row-${i * 10 + r}`,
                        ]),
                        ...(i === 0 ? { nullBitmap: "AQ==" } : {}),
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
                [undefined],
                ["row-1"],
                ["row-2"],
                ["row-3"],
                ["row-4"],
            ]);
            expect(store.stats.spillReads).to.be.greaterThan(0);
            expect(store.stats.spillEncoding).to.equal("v8-v1");
            expect(store.stats.spillWriteMsTotal).to.be.at.least(0);
            expect(store.stats.spillSerializeMsTotal).to.be.at.least(0);
            expect(store.stats.spillWriteIoMsTotal).to.be.at.least(0);
            expect(store.stats.spillDeserializeMsTotal).to.be.at.least(0);
            expect(store.stats.materializeMsTotal).to.be.greaterThan(0);
        } finally {
            store.dispose();
        }
    });

    test("dispose waits for queued spill work and removes the spill directory", async () => {
        const spillDir = fs.mkdtempSync(path.join(os.tmpdir(), "qs-row-store-dispose-"));
        const store = new RowStore(spillDir, {
            maxMemoryBytes: 1,
            spillEnabled: true,
            maxSpillBytes: 64 * 1024 * 1024,
            maxRowsPerResultSet: 1_000_000,
        });
        store.beginResultSet("r0", [{ name: "v", displayName: "v" }]);
        await store.appendPage("r0", {
            rowOffset: 0,
            rowCount: 10,
            approxBytes: 1024,
            compact: { values: Array.from({ length: 10 }, (_, row) => [`row-${row}`]) },
        });
        await store.flushSpill();
        expect(store.stats.spillWrites).to.be.greaterThan(0);
        expect(fs.existsSync(spillDir)).to.equal(true);

        store.dispose();
        await store.flushSpill();

        expect(fs.existsSync(spillDir)).to.equal(false);
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
                windowCacheMaxBytes: 16 * 1024 * 1024,
                displayCellClamp: 2048,
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
            store.endResultSet("r0");
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

    test("column projection returns only the requested span with matching metadata (QO-7b)", async () => {
        const spillDir = fs.mkdtempSync(path.join(os.tmpdir(), "qs-row-store-"));
        const store = new RowStore(spillDir);
        try {
            store.beginResultSet("r0", [
                { name: "a", displayName: "a" },
                { name: "b", displayName: "b" },
                { name: "c", displayName: "c" },
                { name: "d", displayName: "d" },
            ]);
            await store.appendPage("r0", {
                rowOffset: 0,
                rowCount: 2,
                approxBytes: 64,
                compact: {
                    values: [
                        [1, "b1", undefined, "d1"],
                        [2, "b2", "c2", "d2"],
                    ],
                    typeHints: ["number", "string", "string", "string"],
                },
            });
            const window = await store.getRows("r0", 0, 2, "grid", { start: 1, count: 2 });
            expect(window.rowCount).to.equal(2);
            expect(window.columns.map((c) => c.name)).to.deep.equal(["b", "c"]);
            expect(window.typeHints).to.deep.equal(["string", "string"]);
            expect(window.values).to.deep.equal([
                ["b1", undefined],
                ["b2", "c2"],
            ]);
            // Null bitmap covers ONLY the projected span: row 0 col 1 (c) null.
            const bytes = Buffer.from(window.nullBitmap!, "base64");
            expect((bytes[0] & 0b0010) !== 0).to.equal(true);
            expect((bytes[0] & 0b0001) !== 0).to.equal(false);

            // Out-of-range spans clamp honestly.
            const clamped = await store.getRows("r0", 0, 2, "grid", { start: 3, count: 10 });
            expect(clamped.columns.map((c) => c.name)).to.deep.equal(["d"]);
            expect(clamped.values).to.deep.equal([["d1"], ["d2"]]);

            // Full-width fetches are unchanged (distinct cache identity).
            const full = await store.getRows("r0", 0, 2);
            expect(full.columns).to.have.length(4);
            expect(full.values[0]).to.have.length(4);
        } finally {
            store.dispose();
        }
    });

    test("served-window cache reports retained bytes, peaks, and evictions", async () => {
        const spillDir = fs.mkdtempSync(path.join(os.tmpdir(), "qs-row-store-"));
        const store = new RowStore(spillDir, undefined, "minimal", {
            maxPendingSpillBytes: 32 * 1024 * 1024,
            protectedCacheRatio: 0.5,
            windowCacheEntries: 1,
            windowCacheMaxBytes: 16 * 1024 * 1024,
            displayCellClamp: 2048,
        });
        try {
            store.beginResultSet("r0", [{ name: "v", displayName: "v" }]);
            await store.appendPage("r0", {
                rowOffset: 0,
                rowCount: 4,
                approxBytes: 128,
                compact: { values: [["alpha"], ["beta"], ["gamma"], ["delta"]] },
            });
            store.endResultSet("r0");

            await store.getRows("r0", 0, 2, "grid");
            const first = store.stats;
            expect(first.windowCacheEntries).to.equal(1);
            expect(first.windowCacheBytes).to.be.greaterThan(0);
            expect(first.windowCachePeakBytes).to.equal(first.windowCacheBytes);

            await store.getRows("r0", 2, 2, "grid");
            expect(store.stats.windowCacheEntries).to.equal(1);
            expect(store.stats.windowCacheEvictions).to.equal(1);
            expect(store.stats.windowCachePeakBytes).to.be.at.least(store.stats.windowCacheBytes);

            store.markCorrupt("r0");
            expect(store.stats.windowCacheEntries).to.equal(0);
            expect(store.stats.windowCacheBytes).to.equal(0);
        } finally {
            store.dispose();
        }
    });

    test("grid windows carry bounded previews while fidelity reads retain exact values", async () => {
        const spillDir = fs.mkdtempSync(path.join(os.tmpdir(), "qs-row-store-"));
        const store = new RowStore(spillDir, undefined, "minimal", {
            maxPendingSpillBytes: 32 * 1024 * 1024,
            protectedCacheRatio: 0.5,
            windowCacheEntries: 8,
            windowCacheMaxBytes: 16 * 1024 * 1024,
            displayCellClamp: 16,
        });
        try {
            const raw = `{"data":"${"x".repeat(100)}"}`;
            store.beginResultSet("r0", [{ name: "payload", displayName: "payload", isJson: true }]);
            await store.appendPage("r0", {
                rowOffset: 0,
                rowCount: 1,
                approxBytes: raw.length * 2,
                compact: { values: [[raw]] },
            });

            const preview = await store.getRows("r0", 0, 1, "gridPreview");
            expect(preview.valueMode).to.equal("gridPreview");
            expect(preview.values[0][0]).to.equal(raw.slice(0, 16) + "…");
            expect(preview.documentLanguages).to.deep.equal(["json"]);

            const copy = await store.getRows("r0", 0, 1, "copy");
            expect(copy.valueMode).to.equal(undefined);
            expect(copy.values[0][0]).to.equal(raw);
        } finally {
            store.dispose();
        }
    });

    test("served-window cache skips streaming prefixes and enforces its byte ceiling", async () => {
        const spillDir = fs.mkdtempSync(path.join(os.tmpdir(), "qs-row-store-"));
        const store = new RowStore(spillDir, undefined, "minimal", {
            maxPendingSpillBytes: 32 * 1024 * 1024,
            protectedCacheRatio: 0.5,
            windowCacheEntries: 8,
            windowCacheMaxBytes: 1,
            displayCellClamp: 64,
        });
        try {
            store.beginResultSet("r0", [{ name: "v", displayName: "v" }]);
            await store.appendPage("r0", {
                rowOffset: 0,
                rowCount: 1,
                approxBytes: 1024,
                compact: { values: [["x".repeat(512)]] },
            });

            await store.getRows("r0", 0, 1, "grid");
            expect(store.stats.windowCacheEntries).to.equal(0);
            expect(store.stats.windowCacheBypasses).to.equal(1);

            store.endResultSet("r0");
            await store.getRows("r0", 0, 1, "grid");
            expect(store.stats.windowCacheEntries).to.equal(0);
            expect(store.stats.windowCacheBytes).to.equal(0);
            expect(store.stats.windowCachePeakBytes).to.equal(0);
            expect(store.stats.windowCacheOversizeSkips).to.equal(1);
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
