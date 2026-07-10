/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * C2D-T: transform spec validation/digest, the fused engine against a naive
 * full-materialize reference (golden + seeded property tests), budget
 * honesty, cancellation, truncated-cell semantics, groupBy overflow
 * accounting, and derived snapshots over the real store stack.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { QsCellWindow } from "../../src/sharedInterfaces/queryStudio";
import { packBitmap } from "../../src/services/sqlDataPlane/api";
import {
    TransformSpec,
    transformOutputClass,
    transformSpecDigest,
    validateTransformSpec,
} from "../../src/queryResults/transformSpec";
import {
    EvaluateOptions,
    TransformSourceReader,
    evaluateTransform,
} from "../../src/queryResults/transformEngine";
import { RowStore } from "../../src/queryStudio/rowStore";
import { RetainedRowStore } from "../../src/queryResults/resultStoreLease";
import { QueryResultAccessService } from "../../src/queryResults/queryResultAccessService";
import {
    QUERY_RESULTS_DEFAULTS,
    computeQueryResultsDigest,
} from "../../src/queryResults/queryResultsParams";
import {
    LiveQueryResultSource,
    QueryResultAccessError,
    QueryResultSetFrozenSummary,
} from "../../src/queryResults/queryResultTypes";

// --- in-memory reader fixture -------------------------------------------------------

function windowOf(rows: unknown[][], start: number, columns: string[]): QsCellWindow {
    const bits: boolean[] = [];
    for (const row of rows) {
        for (const cell of row) {
            bits.push(cell === null || cell === undefined);
        }
    }
    return {
        resultSetId: "rs1",
        start,
        rowCount: rows.length,
        columns: columns.map((name) => ({ name, displayName: name })),
        values: rows.map((row) => row.map((cell) => (cell === null ? undefined : cell))),
        nullBitmap: packBitmap(bits),
    };
}

function memoryReader(columns: string[], data: unknown[][]): TransformSourceReader {
    return {
        columnNames: () => columns,
        rowCount: () => data.length,
        window: (start, count) =>
            Promise.resolve(windowOf(data.slice(start, start + count), start, columns)),
        async *stream(start, count, chunkRows) {
            let offset = start;
            const end = Math.min(start + count, data.length);
            while (offset < end) {
                const take = Math.min(chunkRows, end - offset);
                yield windowOf(data.slice(offset, offset + take), offset, columns);
                offset += take;
            }
        },
    };
}

function options(overrides: Partial<EvaluateOptions> = {}): EvaluateOptions {
    return {
        budget: {
            maxRowsScanned: 1_000_000,
            maxEvalMs: 10_000,
            maxGroups: 10_000,
            maxOutputCells: 10_000,
            maxOutputBytes: 1024 * 1024,
        },
        chunkRows: 7, // deliberately odd — chunk seams must not matter
        yieldEveryRows: 64,
        maxDistinctExact: 100_000,
        ...overrides,
    };
}

const SALES_COLUMNS = ["region", "amount", "qty", "note"];
const SALES: unknown[][] = [
    ["east", 100, 1, "a"],
    ["west", 250, 2, null],
    ["east", 50, 5, "b"],
    ["north", 300, 1, "c"],
    ["west", 75, 3, null],
    ["east", 125, 2, "d"],
    ["south", 20, 9, "e"],
    ["north", 310, 2, null],
    ["east", 90, 4, "f"],
    ["west", 60, 1, "g"],
];

suite("queryResults transform spec", () => {
    test("validation rejects unknown shapes with paths", () => {
        const bad = validateTransformSpec({
            v: 2,
            source: { snapshotId: "", resultSetId: "rs1" },
            ops: [{ op: "sort" }],
            terminal: { kind: "explode" },
        });
        expect(bad.errors).to.not.equal(undefined);
        const paths = bad.errors!.map((error) => error.path);
        expect(paths).to.include("$.v");
        expect(paths).to.include("$.source.snapshotId");
        expect(paths).to.include("$.ops[0]");
        expect(paths).to.include("$.terminal");
    });

    test("validation accepts the addendum §3.4 exemplar", () => {
        const outcome = validateTransformSpec({
            v: 1,
            source: {
                snapshotId: "s",
                resultSetId: "rs1",
                rows: { kind: "all" },
                columns: [0, 1, 2],
            },
            ops: [
                {
                    op: "filter",
                    pred: {
                        and: [
                            { col: 1, cmp: "ge", value: 100 },
                            { not: { col: 0, cmp: "isNull" } },
                        ],
                    },
                },
                { op: "project", columns: [0, 1] },
                { op: "slice", offset: 0, limit: 100000 },
            ],
            terminal: {
                kind: "groupBy",
                keys: [0],
                aggs: [{ fn: "count" }, { fn: "avg", col: 1 }],
                maxGroups: 1000,
                orderBy: { agg: 0, dir: "desc" },
                limitGroups: 50,
            },
        });
        expect(outcome.errors).to.equal(undefined);
    });

    test("digest is stable under key reordering and changes with content", () => {
        const a = validateTransformSpec({
            v: 1,
            source: { snapshotId: "s", resultSetId: "rs1" },
            terminal: { kind: "rows", limit: 10 },
        }).spec!;
        const b = validateTransformSpec({
            terminal: { limit: 10, kind: "rows" },
            source: { resultSetId: "rs1", snapshotId: "s" },
            v: 1,
        }).spec!;
        expect(transformSpecDigest(a)).to.equal(transformSpecDigest(b));
        const c: TransformSpec = { ...a, terminal: { kind: "rows", limit: 11 } };
        expect(transformSpecDigest(c)).to.not.equal(transformSpecDigest(a));
    });

    test("output classification (§1.4): values vs aggregate-numeric", () => {
        const base = { v: 1 as const, source: { snapshotId: "s", resultSetId: "r" } };
        expect(transformOutputClass({ ...base, terminal: { kind: "rows", limit: 1 } })).to.equal(
            "values",
        );
        expect(
            transformOutputClass({
                ...base,
                terminal: { kind: "aggregate", aggs: [{ fn: "count" }, { fn: "avg", col: 1 }] },
            }),
        ).to.equal("aggregateNumeric");
        expect(
            transformOutputClass({
                ...base,
                terminal: { kind: "aggregate", aggs: [{ fn: "min", col: 1 }] },
            }),
        ).to.equal("values");
        expect(
            transformOutputClass({
                ...base,
                terminal: { kind: "histogram", col: 1, boundaries: [10] },
            }),
        ).to.equal("aggregateNumeric");
        expect(transformOutputClass({ ...base, terminal: { kind: "histogram", col: 1 } })).to.equal(
            "values",
        );
        expect(
            transformOutputClass({
                ...base,
                terminal: { kind: "groupBy", keys: [0], aggs: [{ fn: "count" }] },
            }),
        ).to.equal("values");
    });
});

suite("queryResults transform engine", () => {
    const source = { snapshotId: "s", resultSetId: "rs1" };

    test("filter + project + rows matches the naive reference", async () => {
        const spec: TransformSpec = {
            v: 1,
            source,
            ops: [
                { op: "filter", pred: { col: 1, cmp: "ge", value: 100 } },
                { op: "project", columns: [0, 1] },
            ],
            terminal: { kind: "rows", limit: 100 },
        };
        const result = await evaluateTransform(spec, memoryReader(SALES_COLUMNS, SALES), options());
        const reference = SALES.filter((row) => (row[1] as number) >= 100).map((row) => [
            row[0],
            row[1],
        ]);
        expect(result.rows).to.deep.equal(reference);
        expect(result.columns).to.deep.equal(["region", "amount"]);
        expect(result.stats.rowsScanned).to.equal(SALES.length);
        expect(result.stats.rowsMatched).to.equal(reference.length);
        expect(result.stats.partial).to.equal(false);
    });

    test("slice offsets/limits count post-filter rows", async () => {
        const spec: TransformSpec = {
            v: 1,
            source,
            ops: [
                { op: "filter", pred: { col: 0, cmp: "eq", value: "east" } },
                { op: "slice", offset: 1, limit: 2 },
            ],
            terminal: { kind: "rows", limit: 100 },
        };
        const result = await evaluateTransform(spec, memoryReader(SALES_COLUMNS, SALES), options());
        const east = SALES.filter((row) => row[0] === "east").slice(1, 3);
        expect(result.rows).to.deep.equal(east);
        expect(result.stats.partial).to.equal(false);
    });

    test("aggregate: count/nullCount/sum/avg/min/max/stddev/distinctCount", async () => {
        const spec: TransformSpec = {
            v: 1,
            source,
            terminal: {
                kind: "aggregate",
                aggs: [
                    { fn: "count" },
                    { fn: "nullCount", col: 3 },
                    { fn: "sum", col: 1 },
                    { fn: "avg", col: 1 },
                    { fn: "min", col: 1 },
                    { fn: "max", col: 1 },
                    { fn: "distinctCount", col: 0 },
                ],
            },
        };
        const result = await evaluateTransform(spec, memoryReader(SALES_COLUMNS, SALES), options());
        const amounts = SALES.map((row) => row[1] as number);
        const total = amounts.reduce((a, b) => a + b, 0);
        expect(result.rows).to.have.length(1);
        const [count, nulls, sum, avg, min, max, distinct] = result.rows[0] as number[];
        expect(count).to.equal(10);
        expect(nulls).to.equal(3);
        expect(sum).to.equal(total);
        expect(avg).to.be.closeTo(total / 10, 1e-9);
        expect(min).to.equal(20);
        expect(max).to.equal(310);
        expect(distinct).to.equal(4);
        expect(result.outputClass).to.equal("values"); // min/max present
    });

    test("groupBy with orderBy/limit matches reference", async () => {
        const spec: TransformSpec = {
            v: 1,
            source,
            terminal: {
                kind: "groupBy",
                keys: [0],
                aggs: [{ fn: "count" }, { fn: "sum", col: 1 }],
                orderBy: { agg: 1, dir: "desc" },
            },
        };
        const result = await evaluateTransform(spec, memoryReader(SALES_COLUMNS, SALES), options());
        const totals = new Map<string, { count: number; sum: number }>();
        for (const row of SALES) {
            const entry = totals.get(row[0] as string) ?? { count: 0, sum: 0 };
            entry.count++;
            entry.sum += row[1] as number;
            totals.set(row[0] as string, entry);
        }
        const reference = [...totals.entries()]
            .map(([key, entry]) => [key, entry.count, entry.sum])
            .sort((a, b) => (b[2] as number) - (a[2] as number));
        expect(result.rows).to.deep.equal(reference);
        expect(result.columns).to.deep.equal(["region", "count", "sum(amount)"]);
    });

    test("groupBy overflow folds into __other__ with honest accounting", async () => {
        const spec: TransformSpec = {
            v: 1,
            source,
            terminal: { kind: "groupBy", keys: [0], aggs: [{ fn: "count" }], maxGroups: 2 },
        };
        const result = await evaluateTransform(spec, memoryReader(SALES_COLUMNS, SALES), options());
        // 4 regions, cap 2 → 2 real groups + __other__ bucket, 2 overflow keys.
        expect(result.rows).to.have.length(3);
        expect(result.overflowGroups).to.equal(2);
        const counted = result.rows.reduce((total, row) => total + (row[1] as number), 0);
        expect(counted, "overflow rows accumulate, never drop").to.equal(SALES.length);
        const other = result.rows.find((row) => row[0] === "__other__");
        expect(other).to.not.equal(undefined);
    });

    test("topK by value and by frequency", async () => {
        const byValue = await evaluateTransform(
            { v: 1, source, terminal: { kind: "topK", col: 1, k: 3, by: "value" } },
            memoryReader(SALES_COLUMNS, SALES),
            options(),
        );
        expect(byValue.rows.map((row) => row[0])).to.deep.equal([310, 300, 250]);
        const byFrequency = await evaluateTransform(
            { v: 1, source, terminal: { kind: "topK", col: 0, k: 2, by: "frequency" } },
            memoryReader(SALES_COLUMNS, SALES),
            options(),
        );
        expect(byFrequency.rows[0]).to.deep.equal(["east", 4]);
        expect(byFrequency.rows[1]![1]).to.equal(3); // west
    });

    test("histogram with caller boundaries and auto boundaries", async () => {
        const withBoundaries = await evaluateTransform(
            { v: 1, source, terminal: { kind: "histogram", col: 1, boundaries: [100, 300] } },
            memoryReader(SALES_COLUMNS, SALES),
            options(),
        );
        // Buckets: <100, [100,300), >=300.
        expect(withBoundaries.rows.map((row) => row[2])).to.deep.equal([5, 3, 2]);
        expect(withBoundaries.outputClass).to.equal("aggregateNumeric");
        const auto = await evaluateTransform(
            { v: 1, source, terminal: { kind: "histogram", col: 1, bucketCount: 4 } },
            memoryReader(SALES_COLUMNS, SALES),
            options(),
        );
        const totalCounted = auto.rows.reduce((total, row) => total + (row[2] as number), 0);
        expect(totalCounted).to.equal(SALES.length);
        expect(auto.outputClass).to.equal("values"); // boundaries derive from data
        // Pre-pass + main pass both charge the budget.
        expect(auto.stats.rowsScanned).to.equal(SALES.length * 2);
    });

    test("sampling: head, head_tail, deterministic seeded reservoir", async () => {
        const head = await evaluateTransform(
            { v: 1, source, terminal: { kind: "sample", strategy: "head", n: 3 } },
            memoryReader(SALES_COLUMNS, SALES),
            options(),
        );
        expect(head.rows).to.deep.equal(SALES.slice(0, 3));
        const headTail = await evaluateTransform(
            { v: 1, source, terminal: { kind: "sample", strategy: "head_tail", n: 4 } },
            memoryReader(SALES_COLUMNS, SALES),
            options(),
        );
        expect(headTail.rows.slice(0, 2)).to.deep.equal(SALES.slice(0, 2));
        expect(headTail.rows.slice(2)).to.deep.equal(SALES.slice(-2));
        const spec: TransformSpec = {
            v: 1,
            source,
            terminal: { kind: "sample", strategy: "reservoir", n: 4 },
        };
        const first = await evaluateTransform(spec, memoryReader(SALES_COLUMNS, SALES), options());
        const second = await evaluateTransform(spec, memoryReader(SALES_COLUMNS, SALES), options());
        expect(first.rows, "seeded reservoir is deterministic").to.deep.equal(second.rows);
        expect(first.rows).to.have.length(4);
    });

    test("budget honesty: rows cap → partial with prefix semantics", async () => {
        const spec: TransformSpec = {
            v: 1,
            source,
            terminal: { kind: "aggregate", aggs: [{ fn: "count" }] },
        };
        const result = await evaluateTransform(
            spec,
            memoryReader(SALES_COLUMNS, SALES),
            options({ budget: { ...options().budget, maxRowsScanned: 6 } }),
        );
        expect(result.stats.partial).to.equal(true);
        expect(result.stats.partialReason).to.equal("rows");
        expect(result.stats.rowsScanned).to.equal(6);
        expect(result.rows[0]![0], "aggregate covers the scanned prefix").to.equal(6);
    });

    test("budget honesty: output cells cap cuts values output", async () => {
        const spec: TransformSpec = {
            v: 1,
            source,
            terminal: { kind: "rows", limit: 1000 },
        };
        const result = await evaluateTransform(
            spec,
            memoryReader(SALES_COLUMNS, SALES),
            options({ budget: { ...options().budget, maxOutputCells: 8 } }),
        );
        expect(result.stats.partial).to.equal(true);
        expect(result.stats.partialReason).to.equal("outputCells");
        expect(result.rows.length).to.be.lessThan(SALES.length);
    });

    test("cancellation halts at a yield point", async () => {
        const big = Array.from({ length: 5000 }, (_, index) => [`r${index}`, index, 1, null]);
        let cancelled = false;
        const spec: TransformSpec = {
            v: 1,
            source,
            terminal: { kind: "aggregate", aggs: [{ fn: "count" }] },
        };
        const result = await evaluateTransform(
            spec,
            memoryReader(SALES_COLUMNS, big),
            options({
                yieldEveryRows: 100,
                isCancelled: () => cancelled || ((cancelled = true), false),
            }),
        );
        expect(result.stats.partial).to.equal(true);
        expect(result.stats.partialReason).to.equal("canceled");
        expect(result.stats.rowsScanned).to.be.lessThan(big.length);
    });

    test("nulls: filters use bitmap semantics; NULL compares to nothing", async () => {
        const spec: TransformSpec = {
            v: 1,
            source,
            ops: [{ op: "filter", pred: { col: 3, cmp: "isNull" } }],
            terminal: { kind: "rows", limit: 100 },
        };
        const result = await evaluateTransform(spec, memoryReader(SALES_COLUMNS, SALES), options());
        expect(result.rows).to.have.length(3);
        const eq = await evaluateTransform(
            {
                v: 1,
                source,
                ops: [{ op: "filter", pred: { col: 3, cmp: "eq", value: "a" } }],
                terminal: { kind: "aggregate", aggs: [{ fn: "count" }] },
            },
            memoryReader(SALES_COLUMNS, SALES),
            options(),
        );
        expect(eq.rows[0]![0], "NULL never equals a literal").to.equal(1);
    });

    test("truncated cells are incomparable and counted, never prefix-compared", async () => {
        const columns = ["v"];
        const data: unknown[][] = [
            [{ $t: "truncated", of: "string", v: "prefix", bytes: 999 }],
            ["prefix"],
            ["other"],
        ];
        const result = await evaluateTransform(
            {
                v: 1,
                source,
                ops: [{ op: "filter", pred: { col: 0, cmp: "eq", value: "prefix" } }],
                terminal: { kind: "aggregate", aggs: [{ fn: "count" }] },
            },
            memoryReader(columns, data),
            options(),
        );
        // Only the REAL "prefix" row matches; the truncated cell is skipped.
        expect(result.rows[0]![0]).to.equal(1);
        expect(result.stats.truncatedCellsSkipped).to.equal(1);
    });

    test("seeded property test: engine ≡ naive reference over random specs", async () => {
        let seed = 0xc2d7;
        const rand = () => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return seed / 0x7fffffff;
        };
        for (let round = 0; round < 25; round++) {
            const rowCount = 1 + Math.floor(rand() * 40);
            const data: unknown[][] = Array.from({ length: rowCount }, () => [
                ["a", "b", "c", null][Math.floor(rand() * 4)],
                Math.floor(rand() * 100),
                rand() < 0.15 ? null : Math.floor(rand() * 10),
            ]);
            const threshold = Math.floor(rand() * 100);
            const spec: TransformSpec = {
                v: 1,
                source,
                ops: [{ op: "filter", pred: { col: 1, cmp: "lt", value: threshold } }],
                terminal: { kind: "aggregate", aggs: [{ fn: "count" }, { fn: "sum", col: 1 }] },
            };
            const result = await evaluateTransform(
                spec,
                memoryReader(["k", "n", "m"], data),
                options({ chunkRows: 1 + Math.floor(rand() * 10) }),
            );
            const matched = data.filter((row) => (row[1] as number) < threshold);
            const expectedSum = matched.reduce((total, row) => total + (row[1] as number), 0);
            expect(result.rows[0]![0], `round ${round} count`).to.equal(matched.length);
            expect(result.rows[0]![1], `round ${round} sum`).to.equal(expectedSum);
        }
    });
});

// --- derived snapshots over the real store stack ---------------------------------------

function tempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "qr-derive-"));
}

function page(rowOffset: number, rows: unknown[][]) {
    const bits: boolean[] = [];
    for (const row of rows) {
        for (const cell of row) {
            bits.push(cell === null);
        }
    }
    return {
        rowOffset,
        rowCount: rows.length,
        approxBytes: 1000,
        compact: {
            values: rows.map((r) => r.map((c) => (c === null ? undefined : c))),
            nullBitmap: packBitmap(bits),
        },
    };
}

class DeriveFakeSource implements LiveQueryResultSource {
    readonly sourceId = "derive-src";
    readonly sourceKind = "queryStudio" as const;
    store: RetainedRowStore | undefined;
    private summaries: QueryResultSetFrozenSummary[] = [];

    async seed(rows: unknown[][]) {
        const rowStore = new RowStore(tempDir());
        rowStore.beginResultSet("rs1", [
            { name: "region", displayName: "region" },
            { name: "amount", displayName: "amount" },
        ]);
        for (let i = 0; i < rows.length; i++) {
            await rowStore.appendPage("rs1", page(i, [rows[i]]));
        }
        rowStore.endResultSet("rs1");
        this.store = new RetainedRowStore(rowStore, {
            runId: "qsrun_derive",
            createdEpochMs: Date.now(),
            retainedMemoryBytes: 8 * 1024 * 1024,
        });
        this.summaries = [
            {
                resultSetId: "rs1",
                columnNames: ["region", "amount"],
                rowCount: rows.length,
                complete: true,
                corrupt: false,
            },
        ];
    }

    sourceTitle() {
        return "derive fixture";
    }
    sourceUriDigest() {
        return "abcdefabcdef";
    }
    state() {
        return { streaming: false, resultSets: this.summaries };
    }
    currentStore() {
        return this.store;
    }
    messagesSnapshot() {
        return [];
    }
    queryText() {
        return undefined;
    }
    runRecordId() {
        return undefined;
    }
    tuning() {
        return {};
    }
}

suite("queryResults derived snapshots", () => {
    function makeService() {
        const params = Object.freeze({ ...QUERY_RESULTS_DEFAULTS });
        return new QueryResultAccessService(() => ({
            params,
            digest: computeQueryResultsDigest(params),
            overriddenKeys: [],
        }));
    }

    const DATA: unknown[][] = [
        ["east", 100],
        ["west", 250],
        ["east", 50],
        ["north", 300],
        ["west", 75],
        ["east", 125],
    ];

    async function seedSnapshot(service: QueryResultAccessService) {
        const fixture = new DeriveFakeSource();
        await fixture.seed(DATA);
        service.registerLiveSource(fixture);
        const lease = await service.createSnapshot({
            owner: { kind: "pinnedDocument" },
            reason: "derive fixture",
            sourceId: "derive-src",
            scope: { kind: "allCompleteResultSets" },
        });
        return { fixture, lease };
    }

    test("derive filters into a windowable row-id view; lineage in describe", async () => {
        const service = makeService();
        const { fixture, lease } = await seedSnapshot(service);
        const derived = await service.deriveSnapshot(
            {
                v: 1,
                source: { snapshotId: lease.snapshotId, resultSetId: "rs1" },
                ops: [{ op: "filter", pred: { col: 0, cmp: "eq", value: "east" } }],
                terminal: { kind: "rows", limit: 1000 },
            },
            { kind: "pinnedDocument", label: "filtered view" },
        );
        const description = service.describeSnapshot(derived.snapshotId)!;
        expect(description.totalRows).to.equal(3);
        expect(description.derived?.parentSnapshotId).to.equal(lease.snapshotId);
        expect(description.derived?.specDigest).to.have.length(12);
        // Non-contiguous ids (0, 2, 5) stitch into one clamped window.
        const window = await service.getWindow({
            snapshotId: derived.snapshotId,
            resultSetId: "rs1",
            rowStart: 0,
            rowCount: 100,
            reason: "grid",
        });
        expect(window.rowCount).to.equal(3);
        expect(window.values.map((row) => row[1])).to.deep.equal([100, 50, 125]);
        // Windows into the middle of the view work too.
        const middle = await service.getWindow({
            snapshotId: derived.snapshotId,
            resultSetId: "rs1",
            rowStart: 1,
            rowCount: 1,
            reason: "grid",
        });
        expect(middle.values[0]![1]).to.equal(50);

        // The derived lease keeps the store alive past the parent's close.
        lease.dispose();
        fixture.store?.releaseLiveOwner("documentClosed");
        const survivor = await service.getWindow({
            snapshotId: derived.snapshotId,
            resultSetId: "rs1",
            rowStart: 0,
            rowCount: 3,
            reason: "grid",
        });
        expect(survivor.rowCount).to.equal(3);
        derived.dispose();
        service.dispose();
    });

    test("derive-from-derived composes ids to the physical set", async () => {
        const service = makeService();
        const { lease } = await seedSnapshot(service);
        const east = await service.deriveSnapshot(
            {
                v: 1,
                source: { snapshotId: lease.snapshotId, resultSetId: "rs1" },
                ops: [{ op: "filter", pred: { col: 0, cmp: "eq", value: "east" } }],
                terminal: { kind: "rows", limit: 1000 },
            },
            { kind: "aiTool" },
        );
        const eastBig = await service.deriveSnapshot(
            {
                v: 1,
                source: { snapshotId: east.snapshotId, resultSetId: "rs1" },
                ops: [{ op: "filter", pred: { col: 1, cmp: "ge", value: 100 } }],
                terminal: { kind: "rows", limit: 1000 },
            },
            { kind: "aiTool" },
        );
        const window = await service.getWindow({
            snapshotId: eastBig.snapshotId,
            resultSetId: "rs1",
            rowStart: 0,
            rowCount: 10,
            reason: "grid",
        });
        expect(window.values.map((row) => row[1])).to.deep.equal([100, 125]);
        east.dispose();
        eastBig.dispose();
        lease.dispose();
        service.dispose();
    });

    test("evaluateSnapshotTransform runs against the real store", async () => {
        const service = makeService();
        const { lease } = await seedSnapshot(service);
        const result = await service.evaluateSnapshotTransform({
            v: 1,
            source: { snapshotId: lease.snapshotId, resultSetId: "rs1" },
            terminal: {
                kind: "groupBy",
                keys: [0],
                aggs: [{ fn: "count" }],
                orderBy: { agg: 0, dir: "desc" },
            },
        });
        expect(result.rows[0]).to.deep.equal(["east", 3]);
        expect(result.stats.rowsScanned).to.equal(DATA.length);
        lease.dispose();
        service.dispose();
    });

    test("unknown snapshot rejects with a typed error", async () => {
        const service = makeService();
        try {
            await service.evaluateSnapshotTransform({
                v: 1,
                source: { snapshotId: "qsnap_missing", resultSetId: "rs1" },
                terminal: { kind: "rows", limit: 1 },
            });
            expect.fail("expected snapshotNotFound");
        } catch (error) {
            expect((error as QueryResultAccessError).code).to.equal("snapshotNotFound");
        }
        service.dispose();
    });
});
