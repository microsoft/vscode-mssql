/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * VEC-4: analysis worker pure core (findings match planted VectorLab-style
 * anomaly classes, deterministic under a fixed seed), sampling plan and
 * budget honesty in the ingest source, and the workbench service lifecycle
 * (lease held while open, released on close; cancel bumps the generation).
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    analyzePackedVectors,
    VectorWorkerInput,
} from "../../src/queryResults/vector/vectorAnalysisWorker";
import {
    ingestVectorColumn,
    planWindows,
    VectorIngestBudget,
} from "../../src/queryResults/vector/vectorResultSource";
import { VectorWorkbenchService } from "../../src/queryResults/vector/vectorWorkbenchService";
import { RowStore } from "../../src/queryStudio/rowStore";
import { RetainedRowStore } from "../../src/queryResults/resultStoreLease";
import { QUERY_TUNING_DEFAULTS } from "../../src/sharedInterfaces/queryTuning";
import { packBitmap } from "../../src/services/sqlDataPlane/api";

const DIMS = 8;

function packRows(rows: number[][]): Float32Array {
    const packed = new Float32Array(rows.length * DIMS);
    rows.forEach((row, r) => packed.set(row, r * DIMS));
    return packed;
}

function unit(direction: number): number[] {
    // Deterministic unit-ish vector varying by direction.
    const row = Array.from({ length: DIMS }, (_, d) => Math.sin(direction + d * 0.7));
    const norm = Math.sqrt(row.reduce((s, v) => s + v * v, 0));
    return row.map((v) => v / norm);
}

function workerInput(rows: number[][], overrides?: Partial<VectorWorkerInput>): VectorWorkerInput {
    return {
        packed: packRows(rows),
        rows: rows.length,
        dimensions: DIMS,
        seed: 770511,
        timeBudgetMs: 5000,
        pairTarget: 500,
        ...overrides,
    };
}

suite("vector analysis worker (pure core)", () => {
    test("planted anomaly classes are found with the right subjects and ordinals", () => {
        const rows: number[][] = [];
        for (let i = 0; i < 40; i++) {
            rows.push(unit(i));
        }
        rows[3] = new Array(DIMS).fill(0); // zero vector
        rows[7] = new Array(DIMS).fill(1e-9); // near-zero
        rows[11] = [...unit(11)];
        rows[11][2] = Number.NaN; // non-finite
        rows[20] = [...rows[5]]; // duplicate group {5, 20, 21}
        rows[21] = [...rows[5]];

        const result = analyzePackedVectors(workerInput(rows));

        const byKind = new Map(result.findings.map((f) => [f.kind, f]));
        expect(byKind.get("zeroVectors")?.affectedCount).to.equal(1);
        expect(byKind.get("zeroVectors")?.rowIndices).to.deep.equal([3]);
        expect(byKind.get("nearZeroVectors")?.affectedCount).to.equal(1);
        expect(byKind.get("nearZeroVectors")?.rowIndices).to.deep.equal([7]);
        expect(byKind.get("nonFiniteComponents")?.affectedCount).to.equal(1);
        expect(byKind.get("nonFiniteComponents")?.rowIndices).to.deep.equal([11]);
        expect(byKind.get("nonFiniteComponents")?.severity).to.equal("error");
        const dup = byKind.get("duplicateVectors");
        expect(dup?.subject).to.equal("duplicateGroup");
        expect(dup?.affectedCount).to.equal(1); // one group
        expect(dup?.values).to.deep.equal([3]); // covering three rows
        expect(dup?.rowIndices).to.deep.equal([5, 20, 21]);

        expect(result.norms.nearZeroCount).to.equal(2); // zero + near-zero
        expect(result.rows).to.equal(40);
        expect(result.dimensions).to.equal(DIMS);
    });

    test("near-constant dimensions surface as dimension-subject findings", () => {
        // Constant value in dimension 4 across all rows.
        const rows = Array.from({ length: 30 }, (_, i) => {
            const row = unit(i);
            row[4] = 0.5;
            return row;
        });
        const result = analyzePackedVectors(workerInput(rows));
        const finding = result.findings.find((f) => f.kind === "nearConstantDimensions");
        expect(finding?.subject).to.equal("dimension");
        expect(finding?.dimensionOrdinals).to.include(4);
        expect(finding?.values?.[finding.dimensionOrdinals!.indexOf(4)]).to.be.lessThan(1e-5);
    });

    test("unit-norm data centers the L2 histogram at 1 and pair distances are cosine", () => {
        const rows = Array.from({ length: 50 }, (_, i) => unit(i));
        const result = analyzePackedVectors(workerInput(rows));
        expect(result.norms.l2.median).to.be.closeTo(1, 1e-5);
        expect(result.pairDistances?.metric).to.equal("cosine");
        expect(result.pairDistances!.pairCount).to.be.greaterThan(0);
        expect(result.pairDistances!.min).to.be.at.least(-1e-6);
        expect(result.pairDistances!.max).to.be.at.most(2 + 1e-6);
    });

    test("identical seed ⇒ identical result; pairTarget 0 ⇒ no pair histogram", () => {
        const rows = Array.from({ length: 25 }, (_, i) => unit(i * 3));
        const a = analyzePackedVectors(workerInput(rows));
        const b = analyzePackedVectors(workerInput(rows));
        expect(JSON.stringify({ ...a, elapsedMs: 0 })).to.equal(
            JSON.stringify({ ...b, elapsedMs: 0 }),
        );
        const none = analyzePackedVectors(workerInput(rows, { pairTarget: 0 }));
        expect(none.pairDistances).to.equal(undefined);
    });
});

suite("vector ingest source", () => {
    const BUDGET: VectorIngestBudget = {
        maxRowsScanned: 25_000,
        maxSampleRows: 5_000,
        maxComponents: 8_000_000,
        maxPackedBytes: 64 * 1024 * 1024,
        maxScanBytes: 128 * 1024 * 1024,
        maxTimeMs: 30_000,
    };

    test("planWindows: full when everything fits, uniform windows otherwise", () => {
        const full = planWindows(1000, 64, BUDGET);
        expect(full.method).to.equal("full");
        expect(full.windows).to.deep.equal([{ start: 0, rows: 1000 }]);

        const sampled = planWindows(2_000_000, 64, BUDGET);
        expect(sampled.method).to.equal("uniformWindows");
        expect(sampled.targetRows).to.equal(BUDGET.maxSampleRows);
        // Windows are ordered, non-overlapping, and span the whole set.
        let previousEnd = -1;
        for (const window of sampled.windows) {
            expect(window.start).to.be.greaterThan(previousEnd);
            previousEnd = window.start + window.rows - 1;
        }
        expect(previousEnd).to.be.greaterThan(1_000_000); // reaches the tail half

        const componentBound = planWindows(10_000, 1998, {
            ...BUDGET,
            maxComponents: 1998 * 100,
        });
        expect(componentBound.method).to.equal("uniformWindows");
        expect(componentBound.targetRows).to.equal(100);
    });

    function vectorCell(values: number[]): object {
        const bytes = Buffer.alloc(values.length * 4);
        values.forEach((v, i) => bytes.writeFloatLE(v, i * 4));
        return {
            $t: "vector",
            version: 1,
            status: "ok",
            dimensions: values.length,
            baseType: "float32",
            encoding: "f32le",
            byteLength: values.length * 4,
            data: bytes.toString("base64"),
        };
    }

    async function seededVectorStore(
        rows: Array<object | string | null>,
        dims = 3,
    ): Promise<RetainedRowStore> {
        const store = new RowStore(fs.mkdtempSync(path.join(os.tmpdir(), "vec-ingest-")));
        store.beginResultSet("rs1", [
            { name: "id", displayName: "id" },
            {
                name: "embedding",
                displayName: "embedding",
                sqlType: "vector",
                vector: { transport: "binary-v1", dimensions: dims },
            },
        ]);
        for (let i = 0; i < rows.length; i++) {
            const bits = [false, rows[i] === null];
            await store.appendPage("rs1", {
                rowOffset: i,
                rowCount: 1,
                approxBytes: 128,
                compact: {
                    values: [[i, rows[i] === null ? undefined : rows[i]]],
                    nullBitmap: packBitmap(bits),
                },
            });
        }
        store.endResultSet("rs1");
        return new RetainedRowStore(store, {
            runId: "qsrun_vectest",
            createdEpochMs: Date.now(),
            retainedMemoryBytes: 8 * 1024 * 1024,
        });
    }

    test("packs typed cells, counts nulls/unavailable, maps source ordinals", async () => {
        const wrapper = await seededVectorStore([
            vectorCell([1, 2, 3]),
            null,
            { $t: "vector", version: 1, status: "unavailable", reason: "cellLimit" },
            vectorCell([4, 5, 6]),
            "[7,8,9]", // text cell (not typed) → unavailable for packing
        ]);
        const result = await ingestVectorColumn({
            store: wrapper,
            resultSetId: "rs1",
            columnOrdinal: 1,
            budget: BUDGET,
            seed: 42,
        });
        expect("error" in result).to.equal(false);
        if ("error" in result) return;
        expect(result.rows).to.equal(2);
        expect(result.dimensions).to.equal(3);
        expect([...result.packed]).to.deep.equal([1, 2, 3, 4, 5, 6]);
        expect([...result.sourceOrdinals]).to.deep.equal([0, 3]);
        expect(result.nullCount).to.equal(1);
        expect(result.unavailableCount).to.equal(2);
        expect(result.descriptor.method).to.equal("full");
        expect(result.descriptor.totalRows).to.equal(5);
        expect(result.descriptor.partialReason).to.equal(undefined);
        expect(result.descriptor.packedBytes).to.equal(2 * 3 * 4);
        wrapper.releaseLiveOwner("documentClosed");
    });

    test("scan-row budget bounds the PLAN (sampled method, no mid-flight abort)", async () => {
        const wrapper = await seededVectorStore(
            Array.from({ length: 20 }, (_, i) => vectorCell([i, i, i])),
        );
        const result = await ingestVectorColumn({
            store: wrapper,
            resultSetId: "rs1",
            columnOrdinal: 1,
            budget: { ...BUDGET, maxRowsScanned: 10 },
            seed: 42,
        });
        expect("error" in result).to.equal(false);
        if ("error" in result) return;
        // The planner already respects the budget: 10 rows sampled by plan,
        // honestly labeled uniformWindows, no partial-abort reason needed.
        expect(result.rows).to.equal(10);
        expect(result.descriptor.method).to.equal("uniformWindows");
        expect(result.descriptor.rowsScanned).to.equal(10);
        expect(result.descriptor.partialReason).to.equal(undefined);
        expect(result.descriptor.totalRows).to.equal(20);
        wrapper.releaseLiveOwner("documentClosed");
    });

    test("all-null column refuses honestly", async () => {
        const wrapper = await seededVectorStore([null, null, null]);
        const result = await ingestVectorColumn({
            store: wrapper,
            resultSetId: "rs1",
            columnOrdinal: 1,
            budget: BUDGET,
            seed: 42,
        });
        expect("error" in result).to.equal(true);
        wrapper.releaseLiveOwner("documentClosed");
    });

    suite("workbench service", () => {
        const WORKER_PATH = path.resolve(
            __dirname,
            "../../src/queryResults/vector/vectorAnalysisWorker.js",
        );

        function service(): VectorWorkbenchService {
            return new VectorWorkbenchService(() => QUERY_TUNING_DEFAULTS, WORKER_PATH);
        }

        test("open validates the column and holds a lease until close", async () => {
            const wrapper = await seededVectorStore([vectorCell([1, 0, 0]), vectorCell([0, 1, 0])]);
            const svc = service();

            const wrongColumn = svc.open(wrapper, { resultSetId: "rs1", columnOrdinal: 0 });
            expect(wrongColumn.error).to.contain("not a native vector column");

            const opened = svc.open(wrapper, { resultSetId: "rs1", columnOrdinal: 1 });
            expect(opened.error).to.equal(undefined);
            expect(opened.handle).to.have.length.greaterThan(8);
            expect(opened.transport).to.equal("binary-v1");
            expect(opened.totalRows).to.equal(2);
            expect(opened.dimensions).to.equal(3);

            // The vectorWorkbench lease keeps the store alive across live release.
            wrapper.releaseLiveOwner("rerun");
            expect(wrapper.state).to.equal("active");
            svc.close(opened.handle);
            expect(wrapper.state).to.equal("disposed");
            svc.dispose();
        });

        test("profile end-to-end through the real worker; detail maps to result ordinals", async function () {
            this.timeout(20_000);
            const rows: Array<object | null> = [];
            for (let i = 0; i < 12; i++) {
                rows.push(vectorCell([Math.sin(i), Math.cos(i), 0.5]));
            }
            rows[4] = vectorCell([0, 0, 0]); // planted zero vector at ordinal 4
            rows[6] = null; // null shifts packing, ordinal map must absorb it
            const wrapper = await seededVectorStore(rows);
            const svc = service();
            const opened = svc.open(wrapper, { resultSetId: "rs1", columnOrdinal: 1 });
            expect(opened.error).to.equal(undefined);

            const profiled = await svc.profile(opened.handle);
            expect(profiled.error).to.equal(undefined);
            const summary = profiled.summary!;
            expect(summary.dimensions).to.equal(3);
            expect(summary.nullCount).to.equal(1);
            expect(summary.sample.method).to.equal("full");
            expect(summary.evidence.source).to.equal("localComputation");

            const zero = summary.findings.find((f) => f.kind === "zeroVectors");
            expect(zero?.affectedCount).to.equal(1);
            const detail = svc.findingDetail(opened.handle, "zeroVectors");
            // Packed row index ≠ result ordinal (a null sits before it): the
            // drill-in must say ordinal 4, not packed index 4-minus-nulls.
            expect(detail.detail?.resultRowOrdinals).to.deep.equal([4]);

            // Second profile call returns the cached summary (same object shape).
            const again = await svc.profile(opened.handle);
            expect(again.summary).to.equal(summary);

            svc.close(opened.handle);
            wrapper.releaseLiveOwner("documentClosed");
            expect(wrapper.state).to.equal("disposed");
            svc.dispose();
        });

        test("cancel bumps the generation and the in-flight profile reports cancelled", async function () {
            this.timeout(20_000);
            const rows = Array.from({ length: 50 }, (_, i) =>
                vectorCell([Math.sin(i), Math.cos(i), (i % 7) / 7]),
            );
            const wrapper = await seededVectorStore(rows);
            const svc = service();
            const opened = svc.open(wrapper, { resultSetId: "rs1", columnOrdinal: 1 });
            const inFlight = svc.profile(opened.handle);
            svc.cancel(opened.handle);
            const result = await inFlight;
            expect(result.error ?? "").to.contain("cancelled");
            svc.close(opened.handle);
            wrapper.releaseLiveOwner("documentClosed");
            svc.dispose();
        });
    });
});
