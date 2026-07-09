/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * B3 foundations: batch splitter corpus (GO/GO n, comment/string/bracket
 * awareness), the addendum §3.4 error-line-mapping test vector, and RowStore
 * memory/spill/window behavior including the spill round-trip and caps.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { leadingKeyword, mapServerLineToDocument, splitBatches } from "../../src/sql/batchSplitter";
import { DEFAULT_LIMITS, RowStore } from "../../src/queryStudio/rowStore";
import { packBitmap } from "../../src/services/sqlDataPlane/api";

suite("Batch splitter", () => {
    test("simple GO split with line offsets", () => {
        const batches = splitBatches("select 1\nGO\nselect 2\nGO\nselect 3");
        expect(batches.map((b) => b.text.trim())).to.deep.equal([
            "select 1",
            "select 2",
            "select 3",
        ]);
        expect(batches.map((b) => b.startLine)).to.deep.equal([0, 2, 4]);
    });

    test("GO n repeats the batch with ordinals", () => {
        const batches = splitBatches("insert into t values (1)\nGO 3\nselect 1");
        expect(batches).to.have.length(4);
        expect(batches[0].repeatTotal).to.equal(3);
        expect(batches.map((b) => b.repeatOrdinal)).to.deep.equal([0, 1, 2, 0]);
    });

    test("GO with trailing comment splits; case-insensitive; whitespace tolerated", () => {
        const batches = splitBatches("select 1\n  go   -- run it\nselect 2");
        expect(batches).to.have.length(2);
    });

    test("GO inside comments, strings, and brackets does NOT split", () => {
        const inBlockComment = splitBatches("select 1\n/*\nGO\n*/\nselect 2");
        expect(inBlockComment).to.have.length(1);
        const inString = splitBatches("select '\nGO\n' as s");
        expect(inString).to.have.length(1);
        const inBracket = splitBatches("select [col\nGO\nname] from t");
        expect(inBracket).to.have.length(1);
        const nested = splitBatches("select 1\n/* outer /* inner */\nGO\n*/\nselect 2");
        expect(nested, "nested block comments").to.have.length(1);
    });

    test("line comment GO does not split; empty batches skipped", () => {
        expect(splitBatches("-- GO\nselect 1")).to.have.length(1);
        expect(splitBatches("GO\n\nGO\nselect 1\nGO")).to.have.length(1);
    });

    test("escaped quotes and brackets stay in-region", () => {
        expect(splitBatches("select 'it''s\nGO\n' as s")).to.have.length(1);
        expect(splitBatches("select [a]]b\nGO\n] from t")).to.have.length(1);
    });

    test("leadingKeyword skips comments and whitespace (DDL sniffer seam)", () => {
        expect(leadingKeyword("  -- comment\n/* block */ CREATE TABLE t(i int)")).to.equal(
            "CREATE",
        );
        expect(leadingKeyword("\n\nupdate t set x=1")).to.equal("UPDATE");
        expect(leadingKeyword("/* only a comment */")).to.equal(undefined);
    });

    test("error line mapping: the addendum §3.4 vector", () => {
        // Selection starts at document line 10; batch 2 starts at executed-
        // text line 4; server error Line 3 → document line 16.
        expect(mapServerLineToDocument(10, 4, 3)).to.equal(16);
        // Missing/zero server line → the batch's first line.
        expect(mapServerLineToDocument(10, 4, undefined)).to.equal(14);
        expect(mapServerLineToDocument(10, 4, 0)).to.equal(14);
        // Whole-document execution: selectionStartLine = 1.
        expect(mapServerLineToDocument(1, 0, 2)).to.equal(2);
    });
});

suite("RowStore", () => {
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
        return fs.mkdtempSync(path.join(os.tmpdir(), "qs-rowstore-"));
    }

    test("append + window serve with null bitmap and column metadata", async () => {
        const store = new RowStore(tempDir());
        store.beginResultSet("rs1", [
            { name: "a", displayName: "a" },
            { name: "b", displayName: "b" },
        ]);
        await store.appendPage(
            "rs1",
            page(0, [
                [1, "x"],
                [2, null],
            ]),
        );
        await store.appendPage("rs1", page(2, [[3, "z"]]));
        store.endResultSet("rs1");
        const window = await store.getRows("rs1", 1, 2);
        expect(window.rowCount).to.equal(2);
        expect(window.values[0][0]).to.equal(2);
        expect(window.values[1][0]).to.equal(3);
        // Row 0 of the window is (2, null): null bit for col 1 set.
        const bytes = Buffer.from(window.nullBitmap!, "base64");
        expect((bytes[0] & 0b0010) !== 0).to.equal(true);
        store.dispose();
    });

    test("windows clamp to bounds and empty sets serve honestly", async () => {
        const store = new RowStore(tempDir());
        store.beginResultSet("rs1", [{ name: "n", displayName: "n" }]);
        await store.appendPage("rs1", page(0, [[1], [2], [3]]));
        expect((await store.getRows("rs1", 2, 10)).rowCount).to.equal(1);
        expect((await store.getRows("rs1", 99, 10)).rowCount).to.equal(0);
        expect((await store.getRows("missing", 0, 10)).rowCount).to.equal(0);
        store.dispose();
    });

    test("memory cap evicts to spill and windows read back from frames", async () => {
        const dir = tempDir();
        const store = new RowStore(dir, {
            ...DEFAULT_LIMITS,
            maxMemoryBytes: 2500, // forces eviction after ~2 pages
        });
        store.beginResultSet("rs1", [{ name: "n", displayName: "n" }]);
        for (let i = 0; i < 5; i++) {
            await store.appendPage(
                "rs1",
                page(
                    i * 10,
                    Array.from({ length: 10 }, (_, r) => [i * 10 + r]),
                ),
            );
        }
        // Spill writes are ASYNC now (QO-6): settle the queue before asserting.
        await store.flushSpill();
        expect(store.stats.spillBytes).to.be.greaterThan(0);
        // Earliest page was evicted; the window must read it back from spill.
        const window = await store.getRows("rs1", 0, 5);
        expect(window.rowCount).to.equal(5);
        expect(window.values[0][0]).to.equal(0);
        expect(window.values[4][0]).to.equal(4);
        store.dispose();
        await store.flushSpill();
        // Spill artifacts removed with the store (privacy rule).
        expect(fs.existsSync(path.join(dir, "resultsets.pages"))).to.equal(false);
    });

    test("row cap truncates the set honestly", async () => {
        const store = new RowStore(tempDir(), {
            ...DEFAULT_LIMITS,
            maxRowsPerResultSet: 15,
        });
        store.beginResultSet("rs1", [{ name: "n", displayName: "n" }]);
        expect(
            await store.appendPage(
                "rs1",
                page(
                    0,
                    Array.from({ length: 10 }, (_, r) => [r]),
                ),
            ),
        ).to.equal(true);
        expect(
            await store.appendPage(
                "rs1",
                page(
                    10,
                    Array.from({ length: 10 }, (_, r) => [10 + r]),
                ),
            ),
        ).to.equal(false);
        const summary = store.summary("rs1");
        expect(summary?.truncatedReason).to.equal("maxRowsPerResultSet");
        expect(summary?.rowCount).to.equal(10);
        store.dispose();
    });

    test("spill disabled: memory keeps pages (honest backpressure posture)", async () => {
        const store = new RowStore(tempDir(), {
            ...DEFAULT_LIMITS,
            maxMemoryBytes: 1500,
            spillEnabled: false,
        });
        store.beginResultSet("rs1", [{ name: "n", displayName: "n" }]);
        for (let i = 0; i < 4; i++) {
            await store.appendPage(
                "rs1",
                page(
                    i * 5,
                    Array.from({ length: 5 }, (_, r) => [i * 5 + r]),
                ),
            );
        }
        expect(store.stats.spillBytes).to.equal(0);
        expect((await store.getRows("rs1", 0, 20)).rowCount).to.equal(20);
        store.dispose();
    });
});
