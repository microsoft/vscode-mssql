/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * VEC-4: analysis worker pure core (findings match planted VectorLab-style
 * anomaly classes, deterministic under a fixed seed), sampling plan and
 * budget honesty in the ingest source, and the workbench service lifecycle
 * (lease held while open, released on close; cancel bumps the generation).
 *
 * VEC-6: deterministic PCA 2D (determinism, planted-plane recovery,
 * profile-only runs skip PCA), analyzed-vs-rendered render-cap honesty,
 * Compare math (hand-checked metrics, top-|Δ| ordering), and service-level
 * projection/compare including ordinal validation.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    analyzePackedVectors,
    computePca2d,
    VectorWorkerInput,
} from "../../src/queryResults/vector/vectorAnalysisWorker";
import {
    computeVectorCompare,
    selectRenderIndices,
} from "../../src/queryResults/vector/vectorCompareMath";
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

suite("deterministic PCA 2D (VEC-6)", () => {
    test("profile-only runs skip PCA; opts.projection computes it", () => {
        const rows = Array.from({ length: 20 }, (_, i) => unit(i));
        const profileOnly = analyzePackedVectors(workerInput(rows));
        expect(profileOnly.projection).to.equal(undefined);

        const withProjection = analyzePackedVectors(
            workerInput(rows, { opts: { projection: true } }),
        );
        expect(withProjection.projection).to.not.equal(undefined);
        expect(withProjection.projection!.analyzedRows).to.equal(20);
        expect(withProjection.projection!.coords.length).to.equal(40);
        // Projection-only run (cached profile) skips the heavy profile stages.
        const projectionOnly = analyzePackedVectors(
            workerInput(rows, { opts: { profile: false, projection: true } }),
        );
        expect(projectionOnly.projection).to.not.equal(undefined);
        expect(projectionOnly.pairDistances).to.equal(undefined);
    });

    test("same input ⇒ bit-identical coordinates and variances", () => {
        const rows = Array.from({ length: 30 }, (_, i) => unit(i * 2));
        const a = analyzePackedVectors(workerInput(rows, { opts: { projection: true } }));
        const b = analyzePackedVectors(workerInput(rows, { opts: { projection: true } }));
        expect(a.projection).to.not.equal(undefined);
        expect([...a.projection!.coords]).to.deep.equal([...b.projection!.coords]);
        expect(a.projection!.pc1VariancePct).to.equal(b.projection!.pc1VariancePct);
        expect(a.projection!.pc2VariancePct).to.equal(b.projection!.pc2VariancePct);
        expect(a.projection!.nextVariancePct).to.equal(b.projection!.nextVariancePct);
        expect(a.projection!.iterations).to.equal(b.projection!.iterations);
    });

    test("2D-planted data recovers the plane: variance concentrates in 2 PCs", () => {
        // Orthonormal, non-axis-aligned plane basis in 8-D.
        const u = [0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0];
        const w = [0.5, -0.5, 0.5, -0.5, 0, 0, 0, 0];
        const rows: number[][] = [];
        for (let i = 0; i < 60; i++) {
            const a = Math.sin(i) * 3;
            const b = Math.cos(1.3 * i);
            rows.push(u.map((uv, d) => a * uv + b * w[d]));
        }
        const result = analyzePackedVectors(workerInput(rows, { opts: { projection: true } }));
        const projection = result.projection!;
        expect(projection.pc1VariancePct).to.be.at.least(projection.pc2VariancePct);
        expect(projection.pc2VariancePct).to.be.at.least(projection.nextVariancePct);
        expect(projection.pc1VariancePct + projection.pc2VariancePct).to.be.greaterThan(99.9);
        expect(projection.nextVariancePct).to.be.lessThan(0.05);
        // The data lives IN the plane, so projected pairwise distances match
        // original-space distances (orthogonal projection loses nothing).
        const coords = projection.coords;
        const original = (i: number, j: number) =>
            Math.sqrt(rows[i].reduce((s, v, d) => s + (v - rows[j][d]) ** 2, 0));
        const projected = (i: number, j: number) =>
            Math.hypot(coords[i * 2] - coords[j * 2], coords[i * 2 + 1] - coords[j * 2 + 1]);
        for (const [i, j] of [
            [0, 1],
            [5, 40],
            [17, 59],
        ]) {
            expect(projected(i, j)).to.be.closeTo(original(i, j), 1e-4);
        }
    });

    test("non-finite rows are excluded from the PCA, not from honesty", () => {
        const rows = Array.from({ length: 25 }, (_, i) => unit(i));
        rows[9] = [...unit(9)];
        rows[9][3] = Number.POSITIVE_INFINITY;
        const result = analyzePackedVectors(workerInput(rows, { opts: { projection: true } }));
        const projection = result.projection!;
        expect(projection.analyzedRows).to.equal(24);
        expect([...projection.rowIndices]).to.not.include(9);
        expect(projection.coords.length).to.equal(48);
        for (const value of projection.coords) {
            expect(Number.isFinite(value)).to.equal(true);
        }
    });

    test("deadline abort yields NO projection (never a half-projection)", () => {
        const rows = Array.from({ length: 40 }, (_, i) => unit(i));
        const packed = packRows(rows);
        const expired = computePca2d(
            packed,
            DIMS,
            Int32Array.from({ length: 40 }, (_, r) => r),
            0,
        );
        expect(expired).to.equal(null);
    });

    test("render-cap selection: analyzed vs rendered stay separate (P0-8)", () => {
        const identity = selectRenderIndices(8, 1200);
        expect(identity).to.deep.equal([0, 1, 2, 3, 4, 5, 6, 7]);
        const thinned = selectRenderIndices(30, 10);
        expect(thinned).to.have.length(10);
        expect(thinned[0]).to.equal(0);
        for (let i = 1; i < thinned.length; i++) {
            expect(thinned[i]).to.be.greaterThan(thinned[i - 1]);
            expect(thinned[i]).to.be.lessThan(30);
        }
        expect(selectRenderIndices(0, 10)).to.deep.equal([]);
    });
});

suite("compare math (VEC-6)", () => {
    const f32 = (values: number[]) => Float32Array.from(values);

    test("hand-checked metrics on orthogonal unit vectors", () => {
        const result = computeVectorCompare([
            { ordinal: 0, values: f32([1, 0, 0]) },
            { ordinal: 4, values: f32([0, 1, 0]) },
        ]);
        expect(result.items.map((i) => i.ordinal)).to.deep.equal([0, 4]);
        expect(result.items[0].l2).to.equal(1);
        expect(result.items[0].l1).to.equal(1);
        expect(result.items[0].linf).to.equal(1);
        expect(result.pairwise.cosine[0][1]).to.equal(1);
        expect(result.pairwise.cosine[0][0]).to.equal(0); // diagonal identity
        expect(result.pairwise.euclidean[0][1]).to.be.closeTo(Math.SQRT2, 1e-12);
        expect(result.pairwise.negativeDot[0][1]).to.equal(0);
        expect(result.pairwise.negativeDot[0][0]).to.equal(-1); // −‖a‖²
        expect(result.summary.compatibleCount).to.equal(2);
    });

    test("hand-checked metrics on [1,2,3] vs [4,5,6]", () => {
        const result = computeVectorCompare([
            { ordinal: 1, values: f32([1, 2, 3]) },
            { ordinal: 2, values: f32([4, 5, 6]) },
        ]);
        // dot = 32, ‖a‖ = √14, ‖b‖ = √77 → cosine = 1 − 32/√1078.
        expect(result.pairwise.cosine[0][1]).to.be.closeTo(1 - 32 / Math.sqrt(14 * 77), 1e-12);
        expect(result.pairwise.euclidean[0][1]).to.be.closeTo(Math.sqrt(27), 1e-12);
        expect(result.pairwise.negativeDot[0][1]).to.equal(-32);
        // Matrix symmetry.
        expect(result.pairwise.cosine[1][0]).to.equal(result.pairwise.cosine[0][1]);
        // Contributions aᵢ·bᵢ = [4, 10, 18], ranked by |value| desc.
        expect(result.topContributions.map((e) => e.dimension)).to.deep.equal([2, 1, 0]);
        expect(result.topContributions.map((e) => e.value)).to.deep.equal([18, 10, 4]);
    });

    test("top-|Δ| ordering is by absolute delta, signed values, dim asc ties", () => {
        const result = computeVectorCompare([
            { ordinal: 0, values: f32([1, 2, 3, 4]) },
            { ordinal: 1, values: f32([1, 0, 6, 3.5]) },
        ]);
        // Δ = a − b = [0, 2, −3, 0.5].
        expect(result.topDeltaDimensions.map((e) => e.dimension)).to.deep.equal([2, 1, 3, 0]);
        expect(result.topDeltaDimensions[0].value).to.equal(-3);
        expect(result.topDeltaDimensions[1].value).to.equal(2);
        expect(result.topDeltaDimensions[2].value).to.equal(0.5);
    });

    test("zero-norm cosine is undefined (null), never coerced", () => {
        const result = computeVectorCompare([
            { ordinal: 0, values: f32([0, 0]) },
            { ordinal: 1, values: f32([1, 0]) },
        ]);
        expect(result.pairwise.cosine[0][1]).to.equal(null);
        expect(result.pairwise.cosine[0][0]).to.equal(null); // zero-norm diagonal
        expect(result.pairwise.euclidean[0][1]).to.equal(1);
        expect(result.summary.avgPairDistance).to.equal(null);
        expect(result.summary.closestPair).to.equal(null);
        expect(result.summary.medoidIndex).to.equal(null);
    });

    test("selection summary: medoid, most isolated, closest pair", () => {
        const angle = (deg: number) => {
            const rad = (deg * Math.PI) / 180;
            return f32([Math.cos(rad), Math.sin(rad)]);
        };
        const result = computeVectorCompare([
            { ordinal: 10, values: angle(0) },
            { ordinal: 11, values: angle(10) },
            { ordinal: 12, values: angle(90) },
        ]);
        // d01 ≈ 0.0152, d02 = 1, d12 ≈ 0.8264 → medoid is index 1 (min avg),
        // most isolated index 2 (max avg), closest pair (0, 1).
        expect(result.summary.medoidIndex).to.equal(1);
        expect(result.summary.mostIsolatedIndex).to.equal(2);
        expect(result.summary.closestPair?.a).to.equal(0);
        expect(result.summary.closestPair?.b).to.equal(1);
        const d01 = result.pairwise.cosine[0][1] as number;
        const d02 = result.pairwise.cosine[0][2] as number;
        const d12 = result.pairwise.cosine[1][2] as number;
        expect(result.summary.avgPairDistance).to.be.closeTo((d01 + d02 + d12) / 3, 1e-12);
        expect(result.summary.mostIsolatedAvgDistance).to.be.closeTo((d02 + d12) / 2, 1e-12);
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
        complete = true,
        truncatedReason?: string,
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
        if (complete) {
            store.endResultSet("rs1", truncatedReason);
        }
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

        test("open refuses streaming sets but accepts terminal partial sets", async () => {
            const streaming = await seededVectorStore([vectorCell([1, 0, 0])], 3, false);
            const svc = service();
            const refused = svc.open(streaming, { resultSetId: "rs1", columnOrdinal: 1 });
            expect(refused.error).to.contain("terminal state");
            streaming.releaseLiveOwner("documentClosed");

            const partial = await seededVectorStore(
                [vectorCell([1, 0, 0])],
                3,
                true,
                "maxRowsPerResultSet",
            );
            const opened = svc.open(partial, { resultSetId: "rs1", columnOrdinal: 1 });
            expect(opened.error).to.equal(undefined);
            svc.close(opened.handle);
            partial.releaseLiveOwner("documentClosed");
            svc.dispose();
        });

        test("close defers its store lease until an active ingest settles", async () => {
            const wrapper = await seededVectorStore([vectorCell([1, 0, 0])]);
            const originalStreamRows = wrapper.streamRows.bind(wrapper);
            let scanEntered!: () => void;
            let releaseScan!: () => void;
            const entered = new Promise<void>((resolve) => (scanEntered = resolve));
            const scanGate = new Promise<void>((resolve) => (releaseScan = resolve));
            wrapper.streamRows = async function* (request) {
                scanEntered();
                await scanGate;
                yield* originalStreamRows(request);
            };

            const svc = service();
            const opened = svc.open(wrapper, { resultSetId: "rs1", columnOrdinal: 1 });
            wrapper.releaseLiveOwner("rerun");
            const inFlight = svc.profile(opened.handle);
            await entered;

            svc.close(opened.handle);
            expect(wrapper.state).to.equal("active");

            releaseScan();
            const result = await inFlight;
            expect(result.error).to.contain("cancelled");
            expect(wrapper.state).to.equal("disposed");
            svc.dispose();
        });

        test("close defers its store lease through compare and scoped Pipeline reads", async () => {
            const wrapper = await seededVectorStore([vectorCell([1, 0, 0]), vectorCell([0, 1, 0])]);
            const originalGetWindow = wrapper.getWindow.bind(wrapper);
            let readEntered!: () => void;
            let releaseRead!: () => void;
            const entered = new Promise<void>((resolve) => (readEntered = resolve));
            const readGate = new Promise<void>((resolve) => (releaseRead = resolve));
            wrapper.getWindow = async (request) => {
                readEntered();
                await readGate;
                return originalGetWindow(request);
            };

            const svc = service();
            const opened = svc.open(wrapper, { resultSetId: "rs1", columnOrdinal: 1 });
            wrapper.releaseLiveOwner("rerun");
            const comparing = svc.compare(opened.handle, [0, 1]);
            await entered;

            svc.close(opened.handle);
            expect(wrapper.state).to.equal("active");
            releaseRead();
            expect((await comparing).error).to.contain("cancelled");
            expect(wrapper.state).to.equal("disposed");

            const second = await seededVectorStore([vectorCell([1, 0, 0])]);
            const openedSecond = svc.open(second, { resultSetId: "rs1", columnOrdinal: 1 });
            const facts = svc.sessionFacts(openedSecond.handle)!;
            second.releaseLiveOwner("rerun");
            svc.close(openedSecond.handle);
            expect(second.state).to.equal("active");
            facts.release();
            expect(second.state).to.equal("disposed");
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

        test("projection end-to-end: coords for analyzed rows, ordinal map, cached", async function () {
            this.timeout(20_000);
            const rows: Array<object | null> = [];
            for (let i = 0; i < 12; i++) {
                rows.push(vectorCell([Math.sin(i), Math.cos(i), (i % 5) / 5]));
            }
            rows[6] = null; // null shifts packing; ordinal map must absorb it
            const wrapper = await seededVectorStore(rows);
            const svc = service();
            const opened = svc.open(wrapper, { resultSetId: "rs1", columnOrdinal: 1 });
            expect(opened.error).to.equal(undefined);

            const result = await svc.projection(opened.handle);
            expect(result.error).to.equal(undefined);
            const projection = result.projection!;
            // Analyzed vs rendered are separate facts; under the cap they match.
            expect(projection.analyzedCount).to.equal(11);
            expect(projection.renderedCount).to.equal(11);
            expect(projection.renderedCount).to.equal(projection.points.length);
            expect(projection.renderCap).to.be.at.least(projection.renderedCount);
            expect(projection.dimensions).to.equal(3);
            // Result-row ordinals, ascending, skipping the null row (6).
            const ordinals = projection.points.map((p) => p.ordinal);
            expect(ordinals).to.deep.equal([0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11]);
            for (const point of projection.points) {
                expect(Number.isFinite(point.x)).to.equal(true);
                expect(Number.isFinite(point.y)).to.equal(true);
            }
            expect(projection.pc1VariancePct).to.be.at.least(projection.pc2VariancePct);
            expect(projection.pc2VariancePct).to.be.at.least(projection.nextVariancePct);
            expect(
                projection.pc1VariancePct + projection.pc2VariancePct + projection.nextVariancePct,
            ).to.be.at.most(100 + 1e-6);
            expect(projection.evidence.source).to.equal("localComputation");
            expect(projection.sample.method).to.equal("full");

            // Cached per session: second call returns the same object.
            const again = await svc.projection(opened.handle);
            expect(again.projection).to.equal(projection);

            // The single worker run also warmed the profile cache.
            const profiled = await svc.profile(opened.handle);
            expect(profiled.error).to.equal(undefined);
            expect(profiled.summary).to.not.equal(undefined);

            svc.close(opened.handle);
            wrapper.releaseLiveOwner("documentClosed");
            svc.dispose();
        });

        test("compare validates ordinals honestly", async () => {
            const wrapper = await seededVectorStore([
                vectorCell([1, 0, 0]),
                vectorCell([0, 1, 0]),
                null,
                vectorCell([0, 0, 1]),
            ]);
            const svc = service();
            const opened = svc.open(wrapper, { resultSetId: "rs1", columnOrdinal: 1 });

            expect((await svc.compare(opened.handle, [0])).error).to.contain("between 2 and 8");
            expect(
                (await svc.compare(opened.handle, [0, 1, 2, 3, 4, 5, 6, 7, 8])).error,
            ).to.contain("between 2 and 8");
            expect((await svc.compare(opened.handle, [0, 99])).error).to.contain("out of range");
            expect((await svc.compare(opened.handle, [0, 1.5])).error).to.contain("out of range");
            expect((await svc.compare(opened.handle, [0, 0])).error).to.contain("more than once");
            expect((await svc.compare(opened.handle, [0, 2])).error).to.contain(
                "no analyzable vector value",
            );
            expect((await svc.compare("vec_bogus", [0, 1])).error).to.contain("expired");

            svc.close(opened.handle);
            wrapper.releaseLiveOwner("documentClosed");
            svc.dispose();
        });

        test("compare end-to-end: hand-checkable metrics over selected rows", async () => {
            const wrapper = await seededVectorStore([
                vectorCell([1, 0, 0]),
                vectorCell([0, 1, 0]),
                null,
                vectorCell([0, 0, 1]),
            ]);
            const svc = service();
            const opened = svc.open(wrapper, { resultSetId: "rs1", columnOrdinal: 1 });

            const result = await svc.compare(opened.handle, [0, 1, 3]);
            expect(result.error).to.equal(undefined);
            const compare = result.compare!;
            expect(compare.items.map((i) => i.ordinal)).to.deep.equal([0, 1, 3]);
            expect(compare.items.every((i) => i.dimensions === 3 && i.l2 === 1)).to.equal(true);
            // Orthogonal unit vectors: cosine 1, euclidean √2, −dot 0 off-diag.
            expect(compare.pairwise.cosine[0][1]).to.equal(1);
            expect(compare.pairwise.cosine[1][2]).to.equal(1);
            expect(compare.pairwise.euclidean[0][2]).to.be.closeTo(Math.SQRT2, 1e-6);
            expect(compare.pairwise.negativeDot[0][1]).to.equal(0);
            // First pair Δ = [1, −1, 0]: |Δ| ties break by ascending dimension.
            expect(compare.topDeltaDimensions.map((e) => e.dimension)).to.deep.equal([0, 1, 2]);
            expect(compare.topDeltaDimensions[0].value).to.equal(1);
            expect(compare.topDeltaDimensions[1].value).to.equal(-1);
            expect(compare.summary.compatibleCount).to.equal(3);
            expect(compare.summary.avgPairDistance).to.be.closeTo(1, 1e-12);
            expect(compare.evidence.source).to.equal("localComputation");

            svc.close(opened.handle);
            wrapper.releaseLiveOwner("documentClosed");
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
