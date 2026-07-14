/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * VEC-8 Search workspace service: safe literal encoding (injection-proof by
 * scanner, not by hope), parameter inlining with displayed == executed,
 * probe-facts adaptation ("notProbed" → "rejected"), the frozen query vector
 * riding BOTH executed variants as ONE literal, approximate gating (probe
 * rejection and missing/phantom index both skip approx while exact runs),
 * recall wiring, host-side K clamping, catalog target mapping, and honest
 * error paths — all against scripted data-plane sessions plus a REAL
 * VectorWorkbenchService/RowStore pair for the sparse frozen-vector fetch.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    ISqlSession,
    IQueryEventSink,
    QueryHandle,
    SqlBackendCapabilities,
    ExecuteOptions,
    packBitmap,
} from "../../src/services/sqlDataPlane/api";
import {
    QsVectorCapabilitiesResult,
    VectorCapabilityProbe,
    VectorIndexProbeRow,
    VectorProbeEvidence,
    VectorSyntaxProbeStatus,
} from "../../src/sharedInterfaces/vectorCatalog";
import {
    QsVectorSearchParams,
    VECTOR_SEARCH_MODEL_TEXT_MAX_CHARS,
    VECTOR_SEARCH_TIMING_DISCLOSURE,
} from "../../src/sharedInterfaces/vectorSearch";
import { QUERY_TUNING_DEFAULTS } from "../../src/sharedInterfaces/queryTuning";
import { RowStore } from "../../src/queryStudio/rowStore";
import { RetainedRowStore } from "../../src/queryResults/resultStoreLease";
import { buildComparison, SqlParameter } from "../../src/queryResults/vector/vectorSqlBuilder";
import {
    adaptProbeFacts,
    buildRankRows,
    buildSearchModelSql,
    clampK,
    deriveAnnFilterCapability,
    encodeSqlLiteral,
    inlineParameters,
    toNeighborRows,
    validateSearchModelParameters,
    VectorSearchService,
    VECTOR_SEARCH_TAG,
    VECTOR_SEARCH_FILTER_COLUMNS_SQL,
    VECTOR_SEARCH_TARGETS_SQL,
} from "../../src/queryResults/vector/vectorSearchService";
import { VECTOR_MODEL_CALL_TAG } from "../../src/queryResults/vector/vectorPipelineService";
import { VectorWorkbenchService } from "../../src/queryResults/vector/vectorWorkbenchService";
import { Perf } from "../../src/perf/perfTelemetry";

// ---------------------------------------------------------------------------
// Scripted data plane
// ---------------------------------------------------------------------------

const CAPS: SqlBackendCapabilities = {
    streamingRows: true,
    creditBackpressure: false,
    cancel: true,
    dispose: true,
    oneActiveQueryPerSession: true,
    multipleResultSets: true,
    serverMessagesVerbatim: true,
    rowsAffectedStructured: false,
    executionPlanXml: false,
    estimatedPlan: false,
    actualPlan: false,
    typedCells: false,
    maxCellBytesHonored: false,
    pageRowsHonored: false,
    pageBytesHonored: false,
    queryTimeoutHonored: false,
    compactRows: true,
    vectorBinaryV1: false,
    spatialWkbV1: false,
    captureControl: false,
    replayDescriptors: false,
    resumeAfterDisconnect: false,
};

interface ScriptedRule {
    /** First matching rule wins. */
    readonly match: (sql: string) => boolean;
    readonly rows?: unknown[][];
    /** Statement fails with this server error text. */
    readonly fail?: string;
    /** Delay before completing (concurrency tests). */
    readonly delayMs?: number;
}

interface ExecutedStatement {
    readonly text: string;
    readonly opts: ExecuteOptions;
}

class ScriptedSession implements ISqlSession {
    readonly sessionId = "scripted";
    readonly connectionId = "scripted-conn";
    readonly info = { backendKind: "scripted" };
    readonly capabilities = CAPS;
    readonly state = "open" as const;
    readonly onDidChangeState = () => ({ dispose: () => undefined });
    readonly onDidChangeDatabase = () => ({ dispose: () => undefined });
    readonly onServerInfoMessage = () => ({ dispose: () => undefined });
    readonly executed: ExecutedStatement[] = [];
    cancelCount = 0;
    disposeHandleCount = 0;

    constructor(private readonly rules: ScriptedRule[]) {}

    signalDatabaseChanged(): void {}

    execute(text: string, opts: ExecuteOptions, sink: IQueryEventSink): QueryHandle {
        this.executed.push({ text, opts });
        const rule = this.rules.find((candidate) => candidate.match(text));
        const completion = (async () => {
            if (rule?.delayMs) {
                await new Promise((resolve) => setTimeout(resolve, rule.delayMs));
            } else {
                await Promise.resolve();
            }
            if (rule?.fail !== undefined) {
                await sink.onMessage({ kind: "error", text: rule.fail, number: 207 });
                return {
                    clientQueryId: "q1",
                    status: "failed" as const,
                    resultSetCount: 0,
                    totalRows: 0,
                    errorCount: 1,
                };
            }
            const rows = rule?.rows ?? [];
            await sink.onResultSetStarted({
                resultSetId: "rs",
                batchOrdinal: 0,
                columns: [],
            });
            await sink.onRowsPage({
                resultSetId: "rs",
                pageSeq: 0,
                rowOffset: 0,
                compact: { values: rows },
                rowCount: rows.length,
                approxBytes: 0,
            });
            const summary = {
                clientQueryId: "q1",
                status: "succeeded" as const,
                resultSetCount: 1,
                totalRows: rows.length,
                errorCount: 0,
            };
            await sink.onComplete(summary);
            return summary;
        })();
        return {
            clientQueryId: "q1",
            accepted: Promise.resolve({
                status: "accepted" as const,
                clientQueryId: "q1",
                acceptedEpochMs: 0,
            }),
            completion,
            cancel: async () => {
                this.cancelCount++;
                return { acknowledged: true };
            },
            dispose: async () => {
                this.disposeHandleCount++;
            },
        };
    }

    async close(): Promise<void> {}
    dispose(): void {}
}

// ---------------------------------------------------------------------------
// Probe fabrication
// ---------------------------------------------------------------------------

const STAMP: VectorProbeEvidence = { source: "catalog", capturedEpochMs: 0 };
const DIAG: VectorProbeEvidence = { source: "diagnosticQuery", capturedEpochMs: 0 };

function makeProbe(overrides?: {
    tvf?: VectorSyntaxProbeStatus;
    indexes?: VectorIndexProbeRow[];
    phantomCount?: number;
    healthDmv?: VectorCapabilityProbe["healthDmv"];
}): VectorCapabilityProbe {
    return {
        evidence: DIAG,
        engine: { evidence: STAMP },
        previewFeatures: { evidence: STAMP, present: true, enabled: true },
        allowStaleVectorIndex: { evidence: STAMP, present: false },
        vectorType: { evidence: DIAG, usable: true },
        columnMetadata: {
            evidence: STAMP,
            vectorDimensionsPresent: true,
            columns: ["vector_dimensions"],
        },
        indexes: {
            evidence: STAMP,
            available: true,
            indexes: overrides?.indexes ?? [],
            phantomCount: overrides?.phantomCount ?? 0,
        },
        healthDmv: overrides?.healthDmv ?? { evidence: STAMP, present: false, columns: [] },
        externalModels: { evidence: STAMP, available: false, models: [] },
        serverConfig: { evidence: STAMP },
        vectorSearchTvf: { evidence: DIAG, status: overrides?.tvf ?? "accepted" },
        topNWithApproximate: { evidence: DIAG, status: "rejected" },
    };
}

const CONFIRMED_INDEX: VectorIndexProbeRow = {
    objectId: 100,
    indexId: 7,
    vectorColumnId: 2,
    schemaName: "dbo",
    tableName: "DocumentChunks",
    indexName: "vec_DocumentChunks_embedding",
    vectorColumn: "embedding",
    indexType: "DiskANN",
    distanceMetric: "cosine",
    version: 3,
};

// ---------------------------------------------------------------------------
// Real workbench session over a seeded RowStore (frozen-vector source)
// ---------------------------------------------------------------------------

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
    const store = new RowStore(fs.mkdtempSync(path.join(os.tmpdir(), "vec-search-")));
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
        runId: "qsrun_vecsearch",
        createdEpochMs: Date.now(),
        retainedMemoryBytes: 8 * 1024 * 1024,
    });
}

const isIsolation = (sql: string) => sql.includes("transaction_isolation_level");
const isExact = (sql: string) => sql.includes("VECTOR_DISTANCE(");
const isApprox = (sql: string) => sql.includes("VECTOR_SEARCH(");
const isTargets = (sql: string) => sql.includes("vector_dimensions") && sql.includes("OUTER APPLY");
const isFilterColumns = (sql: string) => sql.includes("SELECT TOP (1024)");
const isTargetVerification = (sql: string) => sql.includes("SELECT CASE WHEN EXISTS (");
const isModelVerification = (sql: string) =>
    sql.includes("FROM sys.external_models m") &&
    sql.includes("CONVERT(nvarchar(1024), m.location)");
const isStaleness = (sql: string) => sql.includes("FROM sys.dm_db_vector_indexes");

const BINDING_RULES: ScriptedRule[] = [
    {
        match: isTargets,
        rows: [
            ["dbo", "DocumentChunks", "embedding", 3, "chunk_id", 1, "title", 1000, 100, 2, 1, 3],
        ],
    },
    {
        match: isFilterColumns,
        rows: [
            ["dbo", "DocumentChunks", "category", "nvarchar", 100, 4, 200, 0, 0],
            ["dbo", "DocumentChunks", "tenant_id", "int", 100, 5, 4, 10, 0],
        ],
    },
    { match: isTargetVerification, rows: [[1]] },
    {
        match: isModelVerification,
        rows: [
            [
                "VectorLabEmbeddingModel",
                "dbo",
                "Azure OpenAI",
                "EMBEDDINGS",
                "text-embedding-3-small",
                "https://example.openai.azure.com/openai/embeddings?api-key=not-exposed",
                "2026-07-12T01:02:03",
            ],
        ],
    },
];

const DEFAULT_RULES: ScriptedRule[] = [
    { match: isIsolation, rows: [[2]] },
    {
        match: isExact,
        rows: [
            [1, "alpha", 0.1],
            [2, "beta", 0.2],
        ],
    },
    {
        match: isApprox,
        rows: [
            [1, "alpha", 0.11],
            [3, "gamma", 0.3],
        ],
    },
];

interface Harness {
    readonly service: VectorSearchService;
    readonly session: ScriptedSession;
    readonly handle: string;
    readonly targetId: string;
    readonly wrapper: RetainedRowStore;
    readonly workbench: VectorWorkbenchService;
    readonly leaseDisposals: number;
}

async function makeHarness(opts?: {
    rules?: ScriptedRule[];
    capabilities?: QsVectorCapabilitiesResult;
    capabilityCalls?: Array<{
        refresh: boolean;
        table?: { schema: string; table: string };
    }>;
    auxAvailable?: boolean;
    storeRows?: Array<object | string | null>;
}): Promise<Harness> {
    const wrapper = await seededVectorStore(
        opts?.storeRows ?? [vectorCell([1, 2.5, -3]), null, vectorCell([4, 5, 6])],
    );
    const workbench = new VectorWorkbenchService(
        () => QUERY_TUNING_DEFAULTS,
        path.join(os.tmpdir(), "no-worker.js"),
    );
    const opened = workbench.open(wrapper, { resultSetId: "rs1", columnOrdinal: 1 });
    expect(opened.error).to.equal(undefined);
    const session = new ScriptedSession([...(opts?.rules ?? DEFAULT_RULES), ...BINDING_RULES]);
    const counters = { leaseDisposals: 0 };
    const service = new VectorSearchService({
        auxSession: async () =>
            (opts?.auxAvailable ?? true)
                ? {
                      session,
                      dispose: () => {
                          counters.leaseDisposals++;
                      },
                  }
                : undefined,
        auxModelSession: async () =>
            (opts?.auxAvailable ?? true)
                ? {
                      session,
                      dispose: () => {
                          counters.leaseDisposals++;
                      },
                  }
                : undefined,
        capabilities: async (refresh, table) => {
            opts?.capabilityCalls?.push({ refresh, ...(table ? { table } : {}) });
            return opts?.capabilities ?? { probe: makeProbe({ indexes: [CONFIRMED_INDEX] }) };
        },
        workbench: (handle) => workbench.sessionFacts(handle),
    });
    const targetResult = await service.searchTargets();
    return {
        service,
        session,
        handle: opened.handle,
        targetId: targetResult.targets?.[0]?.id ?? "missing-binding",
        wrapper,
        workbench,
        get leaseDisposals() {
            return counters.leaseDisposals;
        },
    };
}

function searchParams(
    harness: Harness,
    overrides?: Partial<QsVectorSearchParams>,
): QsVectorSearchParams {
    return {
        handle: harness.handle,
        source: { kind: "selectedRow", ordinal: 0 },
        targetId: harness.targetId,
        metric: "cosine",
        k: 5,
        includeApprox: true,
        ...overrides,
    };
}

function teardown(harness: Harness): void {
    harness.workbench.dispose();
    harness.wrapper.releaseLiveOwner("documentClosed");
}

/** T-SQL string scanner: every N'…' literal must terminate; the text must end
 *  OUTSIDE a string. Proves no encoded value can escape its literal. */
function assertQuoteBalanced(sql: string): void {
    let inString = false;
    for (let i = 0; i < sql.length; i++) {
        if (sql[i] !== "'") {
            continue;
        }
        if (!inString) {
            inString = true;
        } else if (sql[i + 1] === "'") {
            i++; // escaped quote inside the literal
        } else {
            inString = false;
        }
    }
    expect(inString, "unterminated string literal").to.equal(false);
}

function countOccurrences(text: string, needle: string): number {
    return text.split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// Literal encoding + inlining
// ---------------------------------------------------------------------------

suite("vectorSearchService literal encoding", () => {
    test("nvarchar doubles quotes; brackets/semicolons/unicode ride inertly", () => {
        expect(encodeSqlLiteral({ name: "@p0", type: "nvarchar", value: "plain" })).to.equal(
            "N'plain'",
        );
        expect(
            encodeSqlLiteral({ name: "@p0", type: "nvarchar", value: "x'; DROP TABLE t; --" }),
        ).to.equal("N'x''; DROP TABLE t; --'");
        expect(encodeSqlLiteral({ name: "@p0", type: "nvarchar", value: "a]b[c" })).to.equal(
            "N'a]b[c'",
        );
        expect(
            encodeSqlLiteral({ name: "@p0", type: "nvarchar", value: "日本語 'quote'" }),
        ).to.equal("N'日本語 ''quote'''");
        assertQuoteBalanced(
            `SELECT ${encodeSqlLiteral({ name: "@p0", type: "nvarchar", value: "x'; SELECT '" })};`,
        );
    });

    test("numeric literals are strictly validated, never stringly encoded", () => {
        expect(encodeSqlLiteral({ name: "@k", type: "bigint", value: 20 })).to.equal("20");
        expect(encodeSqlLiteral({ name: "@p0", type: "float", value: -0.25 })).to.equal("-0.25");
        expect(encodeSqlLiteral({ name: "@p0", type: "bit", value: true })).to.equal("1");
        expect(encodeSqlLiteral({ name: "@p0", type: "bit", value: false })).to.equal("0");
        expect(() => encodeSqlLiteral({ name: "@k", type: "bigint", value: 1.5 })).to.throw(
            /safe integer/,
        );
        expect(() =>
            encodeSqlLiteral({ name: "@k", type: "bigint", value: Number.NaN }),
        ).to.throw();
        expect(() =>
            encodeSqlLiteral({ name: "@p0", type: "float", value: Number.POSITIVE_INFINITY }),
        ).to.throw(/finite/);
        expect(() =>
            encodeSqlLiteral({ name: "@p0", type: "float", value: "1; DROP" as unknown as number }),
        ).to.throw(/finite/);
        expect(() =>
            encodeSqlLiteral({ name: "@p0", type: "bit", value: "1" as unknown as boolean }),
        ).to.throw(/boolean/);
    });

    test("vector literal re-validates the JSON independently of upstream", () => {
        expect(encodeSqlLiteral({ name: "@qv", type: "vector", value: "[1,2.5,-3]" })).to.equal(
            "N'[1,2.5,-3]'",
        );
        expect(() => encodeSqlLiteral({ name: "@qv", type: "vector", value: "not json" })).to.throw(
            /valid JSON/,
        );
        expect(() => encodeSqlLiteral({ name: "@qv", type: "vector", value: '[1,"a"]' })).to.throw(
            /finite numbers/,
        );
        expect(() =>
            encodeSqlLiteral({ name: "@qv", type: "vector", value: "[[1],[2]]" }),
        ).to.throw(/finite numbers/);
        expect(() => encodeSqlLiteral({ name: "@qv", type: "vector", value: "[]" })).to.throw();
        expect(() =>
            encodeSqlLiteral({ name: "@qv", type: "vector", value: 3 as unknown as string }),
        ).to.throw(/string/);
    });

    test("inlineParameters replaces whole tokens only (@p1 never eats @p10)", () => {
        const parameters: SqlParameter[] = [
            { name: "@p1", type: "bigint", value: 11 },
            { name: "@p10", type: "bigint", value: 1010 },
        ];
        const inlined = inlineParameters("SELECT @p1, @p10, @p1;", parameters);
        expect(inlined).to.contain("SELECT 11, 1010, 11;");
    });

    test("inlineParameters never rescans inserted literals or quoted/commented token text", () => {
        const sql = [
            "SELECT @p0, @p1, [name@p0], \"quoted@p1\", N'original @p0';",
            "-- @p0 remains narrative",
            "/* outer @p1 /* nested @p0 */ still comment */ SELECT @p0;",
        ].join("\n");
        const inlined = inlineParameters(sql, [
            { name: "@p0", type: "nvarchar", value: "literal @p1" },
            { name: "@p1", type: "nvarchar", value: "x'; DROP TABLE t; --" },
        ]);
        expect(inlined).to.contain(
            "SELECT N'literal @p1', N'x''; DROP TABLE t; --', [name@p0], \"quoted@p1\", N'original @p0';",
        );
        expect(inlined).to.contain("-- @p0 remains narrative");
        expect(inlined).to.contain("/* outer @p1 /* nested @p0 */ still comment */");
        expect(inlined).to.contain("SELECT N'literal @p1';");
    });

    test("inlineParameters refuses duplicate and invalid parameter names", () => {
        expect(() =>
            inlineParameters("SELECT @p;", [
                { name: "@p", type: "bigint", value: 1 },
                { name: "@p", type: "bigint", value: 2 },
            ]),
        ).to.throw(/duplicate parameter/);
        expect(() =>
            inlineParameters("SELECT @bad-name;", [
                { name: "@bad-name", type: "bigint", value: 1 },
            ]),
        ).to.throw(/invalid parameter name/);
    });

    test("inlineParameters throws when a parameter never appears (drift guard)", () => {
        expect(() =>
            inlineParameters("SELECT 1;", [{ name: "@k", type: "bigint", value: 5 }]),
        ).to.throw(/does not appear/);
    });

    test("builder comparison inlines cleanly: comments untouched, no live placeholders, quote-balanced", () => {
        const comparison = buildComparison({
            target: {
                schema: "dbo",
                table: "DocumentChunks",
                keyColumn: "chunk_id",
                vectorColumn: "embedding",
                labelColumn: "title",
            },
            metric: "cosine",
            k: 20,
            predicates: [{ column: "category", op: "eq", value: "x'; DROP TABLE t; --" }],
            queryVectorJson: "[1,2.5,-3]",
            dims: 3,
            probeFacts: { vectorSearchTvf: "accepted", withApproximate: "rejected" },
            annFilterCapability: "unknown",
        });
        const exact = inlineParameters(comparison.exact.sql, comparison.parameters);
        expect("unavailable" in comparison.approx).to.equal(false);
        const approx = inlineParameters(
            (comparison.approx as { sql: string }).sql,
            comparison.parameters,
        );
        for (const sql of [exact, approx]) {
            assertQuoteBalanced(sql);
            // The narrative comment still names @qv; no live placeholder
            // remains outside comments.
            const liveLines = sql.split("\n").filter((line) => !line.trimStart().startsWith("--"));
            expect(liveLines.join("\n")).to.not.match(/@qv|@k(?![A-Za-z0-9_])|@p0/);
            expect(sql).to.contain("t.[category] = N'x''; DROP TABLE t; --'");
            // The frozen vector is ONE literal per statement.
            expect(countOccurrences(sql, "N'[1,2.5,-3]'")).to.equal(1);
        }
        expect(exact).to.contain("SELECT TOP (20)");
        // Comment line kept verbatim (narrative @qv mention preserved).
        expect(exact).to.contain("-- Frozen query vector: @qv is bound once");
    });

    test("clampK clamps host-side to 1..1000 and defaults non-numeric input", () => {
        expect(clampK(20)).to.equal(20);
        expect(clampK(20.7)).to.equal(20);
        expect(clampK(0)).to.equal(1);
        expect(clampK(-5)).to.equal(1);
        expect(clampK(5000)).to.equal(1000);
        expect(clampK(Number.NaN)).to.equal(20);
        expect(clampK("50" as unknown as number)).to.equal(20);
    });
});

suite("vectorSearchService probe adaptation", () => {
    test("notProbed adapts to rejected; probed states pass through", () => {
        expect(adaptProbeFacts(makeProbe({ tvf: "notProbed" })).vectorSearchTvf).to.equal(
            "rejected",
        );
        expect(adaptProbeFacts(makeProbe({ tvf: "accepted" })).vectorSearchTvf).to.equal(
            "accepted",
        );
        expect(adaptProbeFacts(makeProbe({ tvf: "needsPreview" })).vectorSearchTvf).to.equal(
            "needsPreview",
        );
        expect(adaptProbeFacts(makeProbe()).withApproximate).to.equal("rejected");
    });

    test("ANN filter semantics require exact index-version or verified RTM evidence", () => {
        const current = makeProbe({ indexes: [CONFIRMED_INDEX] });
        expect(deriveAnnFilterCapability(current, CONFIRMED_INDEX)).to.equal("verifiedIterative");

        const earlier = { ...CONFIRMED_INDEX, version: 2 };
        expect(deriveAnnFilterCapability(makeProbe({ indexes: [earlier] }), earlier)).to.equal(
            "verifiedPostFilter",
        );

        const unknown = { ...CONFIRMED_INDEX, version: undefined, buildParameters: "{}" };
        expect(deriveAnnFilterCapability(makeProbe({ indexes: [unknown] }), unknown)).to.equal(
            "unknown",
        );

        const rtm = {
            ...makeProbe({ indexes: [unknown] }),
            engine: {
                evidence: STAMP,
                engineEditionId: 3,
                productVersion: "17.0.1000.1",
            },
        };
        expect(deriveAnnFilterCapability(rtm, unknown)).to.equal("verifiedPostFilter");
        expect(deriveAnnFilterCapability(rtm, undefined)).to.equal("unknown");
    });
});

// ---------------------------------------------------------------------------
// Pure result shaping
// ---------------------------------------------------------------------------

suite("vectorSearchService result shaping", () => {
    test("toNeighborRows maps [key, label, distance] and tolerates text cells", () => {
        const rows = toNeighborRows(
            [
                [1, "alpha", 0.1],
                ["k2", "beta", "0.25"],
                [null, null, 0.3],
            ],
            true,
        );
        expect(rows[0]).to.deep.equal({ rank: 1, key: 1, label: "alpha", distance: 0.1 });
        expect(rows[1]).to.deep.equal({ rank: 2, key: "k2", label: "beta", distance: 0.25 });
        expect(rows[2].key).to.equal("NULL");
        const noLabel = toNeighborRows([[7, 0.5]], false);
        expect(noLabel[0]).to.deep.equal({ rank: 1, key: 7, distance: 0.5 });
    });

    test("buildRankRows unions by key with status + delta, exact order first", () => {
        const exact = toNeighborRows(
            [
                [1, 0.1],
                [2, 0.2],
                [3, 0.3],
            ],
            false,
        );
        const approx = toNeighborRows(
            [
                [1, 0.11],
                [3, 0.29],
                [9, 0.9],
            ],
            false,
        );
        const rows = buildRankRows(exact, approx);
        expect(rows.map((row) => row.key)).to.deep.equal([1, 2, 3, 9]);
        expect(rows[0]).to.include({ status: "matched", exactRank: 1, approxRank: 1, delta: 0 });
        expect(rows[1]).to.include({ status: "exactOnly", exactRank: 2 });
        expect(rows[1].approxRank).to.equal(undefined);
        expect(rows[2]).to.include({ status: "matched", exactRank: 3, approxRank: 2, delta: -1 });
        expect(rows[3]).to.include({ status: "approxOnly", approxRank: 3 });
    });

    test("buildRankRows marks exact-distance ties without overstating rank movement", () => {
        const rows = buildRankRows(
            [
                { rank: 1, key: 1, distance: 0.25 },
                { rank: 2, key: 2, distance: 0.25 + 1e-12 },
                { rank: 3, key: 3, distance: 0.4 },
            ],
            undefined,
        );
        expect(rows[0].distanceTie).to.equal(true);
        expect(rows[1].distanceTie).to.equal(true);
        expect(rows[2].distanceTie).to.equal(undefined);
    });
});

// ---------------------------------------------------------------------------
// Search flow against scripted sessions
// ---------------------------------------------------------------------------

suite("vectorSearchService search flow", () => {
    test("frozen selected-row vector rides BOTH executed variants as ONE identical literal; displayed == executed", async () => {
        const harness = await makeHarness();
        try {
            const result = await harness.service.search(searchParams(harness));
            expect(result.error).to.equal(undefined);
            const comparison = result.comparison!;

            const exactSent = harness.session.executed.find((s) => isExact(s.text));
            const approxSent = harness.session.executed.find((s) => isApprox(s.text));
            expect(exactSent, "exact statement executed").to.not.equal(undefined);
            expect(approxSent, "approx statement executed").to.not.equal(undefined);

            // Displayed SQL is byte-for-byte the executed text.
            expect(comparison.executedSql.exact).to.equal(exactSent!.text);
            expect(comparison.executedSql.approx).to.equal(approxSent!.text);

            // ONE frozen vector literal, identical across both variants.
            const frozen = "N'[1,2.5,-3]'";
            expect(countOccurrences(exactSent!.text, frozen)).to.equal(1);
            expect(countOccurrences(approxSent!.text, frozen)).to.equal(1);
            assertQuoteBalanced(exactSent!.text);
            assertQuoteBalanced(approxSent!.text);

            // Search statements ride interactive/user with the search tag.
            for (const statement of [exactSent!, approxSent!]) {
                expect(statement.opts.priority).to.equal("interactive");
                expect(statement.opts.commandKind).to.equal("user");
                expect(statement.opts.tag).to.equal(VECTOR_SEARCH_TAG);
            }

            // One aux lease for the whole run, disposed afterwards.
            expect(harness.leaseDisposals).to.equal(2);

            // Recall: exact {1,2}, approx {1,3}, k=5 → denominator 2, overlap 1.
            expect(comparison.recall?.overlap).to.equal(1);
            expect(comparison.recall?.recallAtK).to.equal(0.5);
            expect(comparison.recall?.denominatorDisclosure).to.contain("fewer than K");

            // Rank union: 1 matched, 2 exact-only, 3 approx-only.
            expect(comparison.rankRows.map((row) => row.status)).to.deep.equal([
                "matched",
                "exactOnly",
                "approxOnly",
            ]);
            expect(comparison.rankRows[0].label).to.equal("alpha");

            // Honest evidence + single-observation timings.
            const evidenceValues = comparison.evidence.map((row) => `${row.label}: ${row.value}`);
            expect(
                evidenceValues.some((line) =>
                    line.includes("Approximate requested, strategy unverified"),
                ),
            ).to.equal(true);
            expect(evidenceValues.some((line) => line.includes("read committed"))).to.equal(true);
            expect(
                evidenceValues.some((line) => line.includes("vec_DocumentChunks_embedding")),
            ).to.equal(true);
            expect(comparison.timings.disclosure).to.equal(VECTOR_SEARCH_TIMING_DISCLOSURE);
            expect(comparison.timings.exactMs).to.be.at.least(0);
            expect(comparison.timings.approxMs).to.be.at.least(0);
            expect(result.generation).to.be.greaterThan(0);
        } finally {
            teardown(harness);
        }
    });

    test("search probes capabilities for the exact host-verified target table", async () => {
        const capabilityCalls: Array<{
            refresh: boolean;
            table?: { schema: string; table: string };
        }> = [];
        const harness = await makeHarness({ capabilityCalls });
        try {
            const result = await harness.service.search(
                searchParams(harness, { includeApprox: false }),
            );
            expect(result.error).to.equal(undefined);
            expect(capabilityCalls).to.deep.equal([
                {
                    refresh: true,
                    table: { schema: "dbo", table: "DocumentChunks" },
                },
            ]);
        } finally {
            teardown(harness);
        }
    });

    test("host-derived index semantics select iterative, earlier, or conservative filtered ANN", async () => {
        const withoutVersion = { ...CONFIRMED_INDEX, version: undefined };
        const cases = [
            {
                index: CONFIRMED_INDEX,
                topN: 5,
                evidence: "Iterative filtering (during traversal)",
            },
            {
                index: { ...CONFIRMED_INDEX, version: 2 },
                topN: 25,
                evidence: "Post-filtered after approximate retrieval",
            },
            {
                index: withoutVersion,
                topN: 25,
                evidence: "Unverified filter behavior; conservative post-filter",
            },
        ];
        const exactStatements: string[] = [];
        for (const testCase of cases) {
            const harness = await makeHarness({
                capabilities: { probe: makeProbe({ indexes: [testCase.index] }) },
            });
            try {
                const webviewRequest = {
                    ...searchParams(harness, {
                        predicates: [{ column: "category", op: "eq", value: "news" }],
                    }),
                    // A forged runtime field is ignored; only the host-derived
                    // confirmed-index classification reaches the builder.
                    annFilterCapability:
                        testCase.topN === 5 ? "verifiedPostFilter" : "verifiedIterative",
                };
                const result = await harness.service.search(webviewRequest);
                expect(result.error).to.equal(undefined);
                const exact = harness.session.executed.find((entry) => isExact(entry.text))!.text;
                const approx = harness.session.executed.find((entry) => isApprox(entry.text))!.text;
                exactStatements.push(exact);
                expect(exact).to.contain("t.[category] = N'news'");
                expect(approx).to.contain("t.[category] = N'news'");
                expect(approx).to.contain(`TOP_N = ${testCase.topN}`);
                expect(
                    result.comparison?.evidence.find((row) => row.label === "Filter semantics")
                        ?.value,
                ).to.contain(testCase.evidence);
            } finally {
                teardown(harness);
            }
        }
        expect(new Set(exactStatements).size).to.equal(1);
    });

    test("pasted vector is canonicalized; K is clamped into the executed TOP", async () => {
        const harness = await makeHarness();
        try {
            const result = await harness.service.search(
                searchParams(harness, {
                    source: { kind: "pastedVector", json: " [1, 2.5,\n -3] " },
                    k: 5000,
                }),
            );
            expect(result.error).to.equal(undefined);
            const exactSent = harness.session.executed.find((s) => isExact(s.text))!;
            expect(countOccurrences(exactSent.text, "N'[1,2.5,-3]'")).to.equal(1);
            expect(exactSent.text).to.contain("SELECT TOP (1000)");
            expect(result.comparison?.k).to.equal(1000);
        } finally {
            teardown(harness);
        }
    });

    test("index staleness is measured on the comparison session immediately before exact", async () => {
        const probe = makeProbe({
            indexes: [CONFIRMED_INDEX],
            healthDmv: {
                evidence: STAMP,
                present: true,
                columns: ["object_id", "index_id", "graph_catchup_pending_percent"],
                stalenessColumn: "graph_catchup_pending_percent",
                rows: [{ object_id: "100", index_id: "7", graph_catchup_pending_percent: "99" }],
            },
        });
        const harness = await makeHarness({
            capabilities: { probe },
            rules: [{ match: isStaleness, rows: [["1.25"]] }, ...DEFAULT_RULES],
        });
        try {
            const result = await harness.service.search(searchParams(harness));
            expect(result.error).to.equal(undefined);
            const statements = harness.session.executed.map((statement) => statement.text);
            const stalenessIndex = statements.findIndex(isStaleness);
            const exactIndex = statements.findIndex(isExact);
            expect(stalenessIndex).to.be.greaterThan(-1);
            expect(stalenessIndex).to.be.lessThan(exactIndex);
            const evidence = result.comparison?.evidence.find(
                (row) => row.label === "Index staleness",
            );
            expect(evidence?.value).to.contain("1.25");
            expect(evidence?.value).to.contain("same diagnostic session");
            expect(evidence?.value).to.not.contain("99");
            expect(evidence?.source).to.equal("diagnosticQuery");
        } finally {
            teardown(harness);
        }
    });

    test("expression rereads the bounded A-H basket and freezes one host-evaluated vector", async () => {
        const harness = await makeHarness();
        try {
            const result = await harness.service.search(
                searchParams(harness, {
                    source: {
                        kind: "expression",
                        expression: "centroid(A, B)",
                        basket: [
                            { symbol: "A", ordinal: 0 },
                            { symbol: "B", ordinal: 2 },
                        ],
                    },
                }),
            );
            expect(result.error).to.equal(undefined);
            const exactSent = harness.session.executed.find((statement) => isExact(statement.text));
            const approxSent = harness.session.executed.find((statement) =>
                isApprox(statement.text),
            );
            const frozen = "N'[2.5,3.75,1.5]'";
            expect(countOccurrences(exactSent!.text, frozen)).to.equal(1);
            expect(countOccurrences(approxSent!.text, frozen)).to.equal(1);
            expect(exactSent!.text).to.not.contain("centroid(A, B)");
            const sourceEvidence = result.comparison?.evidence.find(
                (row) => row.label === "Query vector",
            );
            expect(sourceEvidence?.value).to.contain("Experimental expression using A, B");
            expect(sourceEvidence?.value).to.contain("provenance unknown");
        } finally {
            teardown(harness);
        }
    });

    test("probe rejection skips approximate honestly; exact still runs", async () => {
        for (const tvf of ["rejected", "notProbed"] as const) {
            const harness = await makeHarness({
                capabilities: {
                    probe: makeProbe({ tvf, indexes: [CONFIRMED_INDEX] }),
                },
            });
            try {
                const result = await harness.service.search(searchParams(harness));
                expect(result.error).to.equal(undefined);
                const comparison = result.comparison!;
                expect(comparison.approx).to.equal(undefined);
                expect(comparison.executedSql.approx).to.equal(undefined);
                expect(comparison.approxSkippedReason).to.contain("not accepted");
                expect(comparison.exact.length).to.equal(2);
                expect(comparison.recall).to.equal(undefined);
                expect(
                    harness.session.executed.some((s) => isApprox(s.text)),
                    "no approx statement may execute",
                ).to.equal(false);
                const approxRow = comparison.evidence.find(
                    (row) => row.label === "Approximate execution",
                );
                expect(approxRow?.value).to.contain("Skipped");
                const recallRow = comparison.evidence.find(
                    (row) => row.label === "Recall denominator",
                );
                expect(recallRow?.value).to.contain("did not run");
            } finally {
                teardown(harness);
            }
        }
    });

    test("missing/phantom index skips approximate with noCompatibleIndex evidence", async () => {
        const harness = await makeHarness({
            capabilities: { probe: makeProbe({ indexes: [], phantomCount: 2 }) },
        });
        try {
            const result = await harness.service.search(searchParams(harness));
            expect(result.error).to.equal(undefined);
            const comparison = result.comparison!;
            expect(comparison.approx).to.equal(undefined);
            expect(comparison.approxSkippedReason).to.contain("No compatible vector index");
            expect(comparison.approxSkippedReason).to.contain("2 database-wide unconfirmed");
            expect(comparison.approxSkippedReason).to.contain("not attributed to this target");
            expect(harness.session.executed.some((s) => isApprox(s.text))).to.equal(false);
            const indexRow = comparison.evidence.find((row) => row.label === "Vector index");
            expect(indexRow?.value).to.contain("No compatible vector index");
            expect(indexRow?.value).to.contain("phantom");
            expect(comparison.exact.length).to.equal(2);
        } finally {
            teardown(harness);
        }
    });

    test("capability refusal degrades to exact-only with the refusal on evidence", async () => {
        const harness = await makeHarness({
            capabilities: { error: "No active connection." },
        });
        try {
            const result = await harness.service.search(searchParams(harness));
            expect(result.error).to.equal(undefined);
            const comparison = result.comparison!;
            expect(comparison.approx).to.equal(undefined);
            expect(comparison.approxSkippedReason).to.contain("could not be probed");
            const probeRow = comparison.evidence.find((row) => row.label === "Syntax probes");
            expect(probeRow?.value).to.contain("No active connection.");
        } finally {
            teardown(harness);
        }
    });

    test("selectedRow error paths: expired handle, out-of-range ordinal, null cell", async () => {
        const harness = await makeHarness();
        try {
            const expired = await harness.service.search(
                searchParams(harness, { handle: "vec_nope" }),
            );
            expect(expired.error).to.contain("expired");

            const outOfRange = await harness.service.search(
                searchParams(harness, { source: { kind: "selectedRow", ordinal: 99 } }),
            );
            expect(outOfRange.error).to.contain("out of range");

            const nullRow = await harness.service.search(
                searchParams(harness, { source: { kind: "selectedRow", ordinal: 1 } }),
            );
            expect(nullRow.error).to.contain("no analyzable vector");
        } finally {
            teardown(harness);
        }
    });

    test("pasted vector error paths: invalid JSON, nested arrays, dimension mismatch", async () => {
        const harness = await makeHarness();
        try {
            const invalid = await harness.service.search(
                searchParams(harness, {
                    source: { kind: "pastedVector", json: "not json" },
                }),
            );
            expect(invalid.error).to.contain("not valid JSON");

            const nested = await harness.service.search(
                searchParams(harness, {
                    source: { kind: "pastedVector", json: "[[1,2],[3,4]]" },
                }),
            );
            expect(nested.error).to.contain("flat JSON array");

            const mismatch = await harness.service.search(
                searchParams(harness, {
                    source: { kind: "pastedVector", json: "[1,2]" },
                }),
            );
            expect(mismatch.error).to.contain("2 dimensions");
            expect(mismatch.error).to.contain("declares 3");

            const overflow = await harness.service.search(
                searchParams(harness, {
                    source: { kind: "pastedVector", json: "[3.5e38,2,3]" },
                }),
            );
            expect(overflow.error).to.contain("finite float32");
        } finally {
            teardown(harness);
        }
    });

    test("expression host validation refuses forged mappings, unsafe syntax, and incompatible rows", async () => {
        const harness = await makeHarness({
            storeRows: [vectorCell([1, 2, 3]), vectorCell([4, 5]), vectorCell([6, 7, 8])],
        });
        try {
            const forged = await harness.service.search(
                searchParams(harness, {
                    source: {
                        kind: "expression",
                        expression: "A + B",
                        basket: [
                            { symbol: "B", ordinal: 0 },
                            { symbol: "A", ordinal: 2 },
                        ],
                    },
                }),
            );
            expect(forged.error).to.contain("entry A");

            const injection = await harness.service.search(
                searchParams(harness, {
                    source: {
                        kind: "expression",
                        expression: "A.constructor",
                        basket: [
                            { symbol: "A", ordinal: 0 },
                            { symbol: "B", ordinal: 2 },
                        ],
                    },
                }),
            );
            expect(injection.error).to.contain("Vector expression");

            const mismatch = await harness.service.search(
                searchParams(harness, {
                    source: {
                        kind: "expression",
                        expression: "A + B",
                        basket: [
                            { symbol: "A", ordinal: 0 },
                            { symbol: "B", ordinal: 1 },
                        ],
                    },
                }),
            );
            expect(mismatch.error).to.contain("dimensions");
            expect(harness.session.executed.some((statement) => isExact(statement.text))).to.equal(
                false,
            );
        } finally {
            teardown(harness);
        }
    });

    test("forged or stale target binding is refused before search SQL", async () => {
        const harness = await makeHarness();
        try {
            const result = await harness.service.search(
                searchParams(harness, { targetId: "forged-binding" }),
            );
            expect(result.error).to.contain("binding has expired");
            expect(harness.session.executed.some((statement) => isExact(statement.text))).to.equal(
                false,
            );
        } finally {
            teardown(harness);
        }
    });

    test("exact failure is an honest error; approx failure preserves exact results", async () => {
        const exactFails = await makeHarness({
            rules: [
                { match: isIsolation, rows: [[2]] },
                { match: isExact, fail: "Invalid column name 'category'." },
            ],
        });
        try {
            const result = await exactFails.service.search(searchParams(exactFails));
            expect(result.comparison).to.equal(undefined);
            expect(result.error).to.contain("Exact search failed");
            expect(result.error).to.contain("Invalid column name");
        } finally {
            teardown(exactFails);
        }

        const approxFails = await makeHarness({
            rules: [
                { match: isIsolation, rows: [[2]] },
                { match: isExact, rows: [[1, "alpha", 0.1]] },
                { match: isApprox, fail: "Cannot find a vector index." },
            ],
        });
        try {
            const result = await approxFails.service.search(searchParams(approxFails));
            expect(result.error).to.equal(undefined);
            const comparison = result.comparison!;
            expect(comparison.exact.length).to.equal(1);
            expect(comparison.approx).to.equal(undefined);
            expect(comparison.recall).to.equal(undefined);
            expect(comparison.approxError).to.contain("Cannot find a vector index");
            // The failed statement WAS sent — its text stays visible.
            expect(comparison.executedSql.approx).to.not.equal(undefined);
            const approxRow = comparison.evidence.find(
                (row) => row.label === "Approximate execution",
            );
            expect(approxRow?.value).to.contain("Failed");
        } finally {
            teardown(approxFails);
        }
    });

    test("no auxiliary session refuses search and searchTargets honestly", async () => {
        const harness = await makeHarness({ auxAvailable: false });
        try {
            const search = await harness.service.search(searchParams(harness));
            expect(search.error).to.contain("binding has expired");
            const targets = await harness.service.searchTargets();
            expect(targets.error).to.contain("auxiliary diagnostic session");
        } finally {
            teardown(harness);
        }
    });

    test("structured duplicate exclusion rides both variants and its disclosure rides evidence", async () => {
        const harness = await makeHarness();
        try {
            const result = await harness.service.search(
                searchParams(harness, {
                    exclusion: {
                        excludeSourceRow: false,
                        excludeExactVectorDuplicates: true,
                        keyPredicate: { exactDuplicateKeys: [42] },
                    },
                }),
            );
            expect(result.error).to.equal(undefined);
            const exactSent = harness.session.executed.find((s) => isExact(s.text))!;
            const approxSent = harness.session.executed.find((s) => isApprox(s.text))!;
            expect(exactSent.text).to.contain("t.[chunk_id] NOT IN (42)");
            expect(approxSent.text).to.contain("t.[chunk_id] NOT IN (42)");
            const exclusions = result
                .comparison!.evidence.filter((row) => row.label === "Exclusion")
                .map((row) => row.value);
            expect(
                exclusions.some((value) => value.includes("Exact vector duplicates excluded")),
            ).to.equal(true);
        } finally {
            teardown(harness);
        }
    });

    test("a second search while one is running is refused", async () => {
        const harness = await makeHarness({
            rules: [
                { match: isIsolation, rows: [[2]] },
                { match: isExact, rows: [[1, "alpha", 0.1]], delayMs: 60 },
                { match: isApprox, rows: [] },
            ],
        });
        try {
            const first = harness.service.search(searchParams(harness));
            const second = await harness.service.search(searchParams(harness));
            expect(second.error).to.contain("already running");
            const firstResult = await first;
            expect(firstResult.error).to.equal(undefined);
        } finally {
            teardown(harness);
        }
    });

    test("unverified filter columns and wrong scalar types are refused before search SQL", async () => {
        const harness = await makeHarness();
        try {
            const forged = await harness.service.search(
                searchParams(harness, {
                    predicates: [{ column: "secret_column", op: "eq", value: "x" }],
                }),
            );
            expect(forged.error).to.contain("not in the verified target binding");

            const wrongType = await harness.service.search(
                searchParams(harness, {
                    predicates: [{ column: "tenant_id", op: "eq", value: "not-a-number" }],
                }),
            );
            expect(wrongType.error).to.contain("finite numeric value");
            expect(harness.session.executed.some((statement) => isExact(statement.text))).to.equal(
                false,
            );
        } finally {
            teardown(harness);
        }
    });

    test("selected-row exclusion is refused without verified result-to-table lineage", async () => {
        const harness = await makeHarness();
        try {
            const result = await harness.service.search(
                searchParams(harness, {
                    exclusion: {
                        excludeSourceRow: true,
                        excludeExactVectorDuplicates: false,
                    },
                }),
            );
            expect(result.error).to.contain("verified result-to-table lineage binding");
            expect(harness.session.executed.some((statement) => isExact(statement.text))).to.equal(
                false,
            );
        } finally {
            teardown(harness);
        }
    });

    test("forged exclusion values are bounded before any search SQL", async () => {
        const harness = await makeHarness();
        try {
            const tooLarge = await harness.service.search(
                searchParams(harness, {
                    exclusion: {
                        excludeSourceRow: true,
                        excludeExactVectorDuplicates: false,
                        keyPredicate: { sourceRowKey: "x".repeat(4_001) },
                    },
                }),
            );
            expect(tooLarge.error).to.contain("4,000");
            const wrongType = await harness.service.search(
                searchParams(harness, {
                    exclusion: {
                        excludeSourceRow: true,
                        excludeExactVectorDuplicates: false,
                        keyPredicate: {
                            sourceRowKey: true as unknown as string,
                        },
                    },
                }),
            );
            expect(wrongType.error).to.contain("finite number or bounded string");
            expect(harness.session.executed.some((statement) => isExact(statement.text))).to.equal(
                false,
            );
        } finally {
            teardown(harness);
        }
    });

    test("high-precision numeric filter text reaches SQL without JS rounding", async () => {
        const exactDecimal = "12345678901234567890123456789012345678";
        const harness = await makeHarness({
            rules: [
                {
                    match: isFilterColumns,
                    rows: [["dbo", "DocumentChunks", "score", "decimal", 100, 6, 17, 38, 0]],
                },
            ],
        });
        try {
            const result = await harness.service.search(
                searchParams(harness, {
                    predicates: [{ column: "score", op: "eq", value: exactDecimal }],
                }),
            );
            expect(result.error).to.equal(undefined);
            const exact = harness.session.executed.find((statement) => isExact(statement.text));
            expect(exact?.text).to.contain(`N'${exactDecimal}'`);
            expect(exact?.text).to.not.contain(String(Number(exactDecimal)));
        } finally {
            teardown(harness);
        }
    });

    test("catalog verification rejects hypothetical keys and rechecks label/filter metadata", async () => {
        expect(VECTOR_SEARCH_TARGETS_SQL).to.contain("i.is_hypothetical = 0");
        const harness = await makeHarness();
        try {
            const result = await harness.service.search(
                searchParams(harness, {
                    predicates: [{ column: "category", op: "eq", value: "news" }],
                }),
            );
            expect(result.error).to.equal(undefined);
            const verification = harness.session.executed.find((statement) =>
                isTargetVerification(statement.text),
            )!.text;
            expect(verification).to.contain("i.is_hypothetical = 0");
            expect(verification).to.contain("JOIN sys.types lt");
            expect(verification).to.contain("lc.max_length > 0 AND lc.max_length <= 512");
            expect(verification).to.contain("JOIN sys.types ft");
            expect(verification).to.contain("fc.max_length = 200");
            expect(verification).to.contain("fc.precision = 0");
        } finally {
            teardown(harness);
        }
    });

    test("catalog identifier casing is authoritative for filters and exclusions", async () => {
        const harness = await makeHarness({
            rules: [
                {
                    match: isFilterColumns,
                    rows: [
                        ["dbo", "DocumentChunks", "Category", "nvarchar", 100, 4, 200, 0, 0],
                        ["dbo", "documentchunks", "category", "nvarchar", 101, 4, 200, 0, 0],
                    ],
                },
                {
                    match: isTargets,
                    rows: [
                        [
                            "dbo",
                            "DocumentChunks",
                            "Embedding",
                            3,
                            "ChunkId",
                            1,
                            "Title",
                            100,
                            100,
                            2,
                            1,
                            3,
                        ],
                        [
                            "dbo",
                            "documentchunks",
                            "embedding",
                            3,
                            "chunkid",
                            1,
                            "title",
                            100,
                            101,
                            2,
                            1,
                            3,
                        ],
                    ],
                },
            ],
        });
        try {
            const targets = await harness.service.searchTargets();
            expect(targets.targets).to.have.length(2);
            const upper = targets.targets![0];
            const lower = targets.targets![1];
            expect(upper.id).to.not.equal(lower.id);
            expect(upper.filterColumns).to.deep.equal([{ name: "Category", sqlType: "nvarchar" }]);
            expect(lower.filterColumns).to.deep.equal([{ name: "category", sqlType: "nvarchar" }]);

            const facts = harness.service.indexTargetFacts(upper.id, "cosine", [
                "Category",
                "category",
            ]);
            expect(facts?.filterColumns).to.deep.equal(["Category"]);

            const exactBefore = harness.session.executed.filter((statement) =>
                isExact(statement.text),
            ).length;
            const forgedFilter = await harness.service.search(
                searchParams(harness, {
                    targetId: upper.id,
                    predicates: [{ column: "category", op: "eq", value: "news" }],
                }),
            );
            expect(forgedFilter.error).to.contain("not in the verified target binding");

            const forgedExclusion = await harness.service.search(
                searchParams(harness, {
                    targetId: upper.id,
                    exclusion: {
                        excludeSourceRow: false,
                        excludeExactVectorDuplicates: false,
                        excludeSameDocument: true,
                        keyPredicate: {
                            documentColumn: "category",
                            sourceDocumentValue: "news",
                        },
                    },
                }),
            );
            expect(forgedExclusion.error).to.contain(
                "same-document exclusion column is not in the verified binding",
            );
            expect(
                harness.session.executed.filter((statement) => isExact(statement.text)),
            ).to.have.length(exactBefore);
        } finally {
            teardown(harness);
        }
    });

    test("approximate search requires an index on the selected vector column and metric", async () => {
        for (const index of [
            { ...CONFIRMED_INDEX, vectorColumn: "other_embedding" },
            { ...CONFIRMED_INDEX, distanceMetric: "euclidean" },
            { ...CONFIRMED_INDEX, schemaName: "DBO" },
            { ...CONFIRMED_INDEX, tableName: "documentchunks" },
        ]) {
            const harness = await makeHarness({
                capabilities: { probe: makeProbe({ indexes: [index] }) },
            });
            try {
                const result = await harness.service.search(searchParams(harness));
                expect(result.error).to.equal(undefined);
                expect(result.comparison?.approx).to.equal(undefined);
                expect(result.comparison?.approxSkippedReason).to.contain(
                    "No compatible vector index",
                );
                expect(
                    harness.session.executed.some((statement) => isApprox(statement.text)),
                ).to.equal(false);
            } finally {
                teardown(harness);
            }
        }
    });

    test("catalog drift immediately before execution invalidates the binding", async () => {
        const harness = await makeHarness({
            rules: [{ match: isTargetVerification, rows: [[0]] }],
        });
        try {
            const result = await harness.service.search(searchParams(harness));
            expect(result.error).to.contain("binding changed");
            expect(harness.session.executed.some((statement) => isExact(statement.text))).to.equal(
                false,
            );
        } finally {
            teardown(harness);
        }
    });

    test("refresh preserves opaque ids for unchanged host-verified targets", async () => {
        const harness = await makeHarness();
        try {
            const oldId = harness.targetId;
            const refreshed = await harness.service.searchTargets();
            expect(refreshed.targets?.[0]?.id).to.equal(oldId);
            const result = await harness.service.search(searchParams(harness, { targetId: oldId }));
            expect(result.error).to.equal(undefined);
        } finally {
            teardown(harness);
        }
    });

    test("case-only catalog identity changes invalidate old opaque bindings", async () => {
        const targetRows: unknown[][] = [
            ["dbo", "DocumentChunks", "embedding", 3, "chunk_id", 1, "title", 1000, 100, 2, 1, 3],
        ];
        const filterRows: unknown[][] = [
            ["dbo", "DocumentChunks", "category", "nvarchar", 100, 4, 200, 0, 0],
        ];
        const harness = await makeHarness({
            rules: [
                { match: isTargets, rows: targetRows },
                { match: isFilterColumns, rows: filterRows },
            ],
        });
        try {
            const oldId = harness.targetId;
            targetRows[0][1] = "documentchunks";
            const refreshed = await harness.service.searchTargets();
            expect(refreshed.targets?.[0]?.id).to.not.equal(oldId);
            expect(harness.service.indexTargetFacts(oldId, "cosine", [])).to.equal(undefined);

            targetRows[0][1] = "DocumentChunks";
            filterRows[0][2] = "Category";
            const rebound = await harness.service.searchTargets();
            expect(rebound.targets?.[0]?.id).to.not.equal(oldId);
            expect(rebound.targets?.[0]?.id).to.not.equal(refreshed.targets?.[0]?.id);
        } finally {
            teardown(harness);
        }
    });

    test("terminal comparison restores by opaque id without serializing it into panel state", async () => {
        const harness = await makeHarness();
        try {
            const result = await harness.service.search(searchParams(harness));
            expect(result.runId).to.match(/^vsr_/);
            const restored = harness.service.restoreResult(
                harness.handle,
                result.runId!,
                harness.targetId,
            );
            expect(restored.error).to.equal(undefined);
            expect(restored.comparison).to.equal(result.comparison);
            expect(
                harness.service.restoreResult(harness.handle, "vsr_forged", harness.targetId).error,
            ).to.contain("unavailable");
        } finally {
            teardown(harness);
        }
    });

    test("cancel stops the active query and suppresses its late result", async () => {
        const harness = await makeHarness({
            rules: [
                { match: isIsolation, rows: [[2]] },
                { match: isExact, rows: [[1, "alpha", 0.1]], delayMs: 60 },
            ],
        });
        try {
            const pending = harness.service.search(searchParams(harness));
            await new Promise((resolve) => setTimeout(resolve, 10));
            await harness.service.cancel(harness.handle);
            const result = await pending;
            expect(result.comparison).to.equal(undefined);
            expect(result.error).to.contain("cancelled");
            expect(harness.session.cancelCount).to.be.greaterThan(0);
            expect(harness.session.disposeHandleCount).to.be.greaterThan(0);
        } finally {
            teardown(harness);
        }
    });

    test("cancel during approximate execution never caches a ghost comparison", async () => {
        const harness = await makeHarness({
            rules: [
                { match: isIsolation, rows: [[2]] },
                { match: isExact, rows: [[1, "alpha", 0.1]] },
                { match: isApprox, rows: [[1, "alpha", 0.11]], delayMs: 80 },
            ],
        });
        try {
            const baseline = await harness.service.search(
                searchParams(harness, { includeApprox: false }),
            );
            expect(baseline.runId).to.match(/^vsr_/);

            const pending = harness.service.search(searchParams(harness));
            while (!harness.session.executed.some((statement) => isApprox(statement.text))) {
                await new Promise((resolve) => setTimeout(resolve, 2));
            }
            await harness.service.cancel(harness.handle);
            const cancelled = await pending;
            expect(cancelled.comparison).to.equal(undefined);
            expect(cancelled.runId).to.equal(undefined);
            expect(cancelled.error).to.contain("cancelled");
            expect(
                harness.service.restoreResult(harness.handle, baseline.runId!, harness.targetId)
                    .comparison,
            ).to.equal(baseline.comparison);
        } finally {
            teardown(harness);
        }
    });

    test("search.end marker is exactly once and contains registered value-free fields only", async () => {
        const harness = await makeHarness();
        const calls: Array<{ name: string; attrs: Record<string, unknown> }> = [];
        const original = Perf.marker;
        Perf.marker = ((name: string, _phase: string, attrs: Record<string, unknown>) => {
            calls.push({ name, attrs });
        }) as typeof Perf.marker;
        try {
            const result = await harness.service.search(searchParams(harness));
            expect(result.error).to.equal(undefined);
            const searchCalls = calls.filter(
                (call) => call.name === "mssql.queryResults.vector.search.end",
            );
            expect(searchCalls).to.have.length(1);
            expect(Object.keys(searchCalls[0].attrs).sort()).to.deep.equal([
                "approxIncluded",
                "approxMs",
                "exactMs",
                "k",
                "ms",
                "outcome",
            ]);
            expect(JSON.stringify(searchCalls[0].attrs)).to.not.contain("alpha");
            expect(JSON.stringify(searchCalls[0].attrs)).to.not.contain("DocumentChunks");
            expect(JSON.stringify(searchCalls[0].attrs)).to.not.contain("[1,2.5,-3]");
        } finally {
            Perf.marker = original;
            teardown(harness);
        }
    });
});

// ---------------------------------------------------------------------------
// Search targets (catalog discovery)
// ---------------------------------------------------------------------------

suite("vectorSearchService search targets", () => {
    test("same-handle concurrent discovery coalesces onto one catalog pass", async () => {
        const harness = await makeHarness({
            rules: [
                {
                    match: isTargets,
                    rows: [
                        [
                            "dbo",
                            "DocumentChunks",
                            "embedding",
                            3,
                            "chunk_id",
                            1,
                            "title",
                            1000,
                            100,
                            2,
                            1,
                            3,
                        ],
                    ],
                    delayMs: 40,
                },
            ],
        });
        try {
            const targetPassesBefore = harness.session.executed.filter((statement) =>
                isTargets(statement.text),
            ).length;
            const filterPassesBefore = harness.session.executed.filter((statement) =>
                isFilterColumns(statement.text),
            ).length;
            const disposalsBefore = harness.leaseDisposals;

            const [first, second] = await Promise.all([
                harness.service.searchTargets(harness.handle),
                harness.service.searchTargets(harness.handle),
            ]);

            expect(first.error).to.equal(undefined);
            expect(second).to.deep.equal(first);
            expect(
                harness.session.executed.filter((statement) => isTargets(statement.text)),
            ).to.have.length(targetPassesBefore + 1);
            expect(
                harness.session.executed.filter((statement) => isFilterColumns(statement.text)),
            ).to.have.length(filterPassesBefore + 1);
            expect(harness.leaseDisposals).to.equal(disposalsBefore + 1);
        } finally {
            teardown(harness);
        }
    });

    test("failed refresh retains but locks the snapshot, restores completed work, then recovers", async () => {
        const targetRule = {
            match: isTargets,
            rows: [
                [
                    "dbo",
                    "DocumentChunks",
                    "embedding",
                    3,
                    "chunk_id",
                    1,
                    "title",
                    1000,
                    100,
                    2,
                    1,
                    3,
                ],
            ],
            fail: undefined as string | undefined,
        };
        const harness = await makeHarness({ rules: [targetRule] });
        try {
            const completed = await harness.service.search(
                searchParams(harness, { includeApprox: false }),
            );
            expect(completed.runId).to.match(/^vsr_/);
            const exactPassesBeforeFailure = harness.session.executed.filter((statement) =>
                isExact(statement.text),
            ).length;

            targetRule.fail = "The catalog is temporarily unavailable.";
            const stale = await harness.service.searchTargets(harness.handle);
            expect(stale.error).to.contain("temporarily unavailable");
            expect(stale.targets?.map((target) => target.id)).to.deep.equal([harness.targetId]);
            expect(
                harness.service.indexTargetFacts(harness.targetId, "cosine", ["category"]),
            ).to.equal(undefined);

            const refused = await harness.service.search(searchParams(harness));
            expect(refused.error).to.contain("verified target list is stale");
            expect(
                harness.session.executed.filter((statement) => isExact(statement.text)),
            ).to.have.length(exactPassesBeforeFailure);

            const restoredWhileStale = harness.service.restoreResult(
                harness.handle,
                completed.runId!,
                harness.targetId,
            );
            expect(restoredWhileStale.error).to.equal(undefined);
            expect(restoredWhileStale.comparison).to.equal(completed.comparison);

            targetRule.fail = undefined;
            const recovered = await harness.service.searchTargets(harness.handle);
            expect(recovered.error).to.equal(undefined);
            expect(recovered.targets?.[0]?.id).to.equal(harness.targetId);
            expect(
                harness.service.indexTargetFacts(harness.targetId, "cosine", ["category"]),
            ).to.deep.include({
                schema: "dbo",
                table: "DocumentChunks",
                vectorColumn: "embedding",
                metric: "cosine",
            });

            const afterRecovery = await harness.service.search(
                searchParams(harness, { includeApprox: false }),
            );
            expect(afterRecovery.error).to.equal(undefined);
            expect(afterRecovery.comparison).to.not.equal(undefined);
        } finally {
            teardown(harness);
        }
    });

    test("maps catalog rows to targets; keyless tables stay listed but unkeyed", async () => {
        const harness = await makeHarness({
            rules: [
                {
                    match: isTargets,
                    rows: [
                        [
                            "dbo",
                            "DocumentChunks",
                            "embedding",
                            1536,
                            "chunk_id",
                            1,
                            "title",
                            "2412883",
                            100,
                            2,
                            1,
                            3,
                        ],
                        ["sales", "Vectors", "vec", 8, null, 0, null, null, 200, 2, null, null],
                    ],
                },
            ],
        });
        try {
            const result = await harness.service.searchTargets();
            expect(result.error).to.equal(undefined);
            expect(result.targets).to.have.length(2);
            expect(result.targets![0]).to.include({
                schema: "dbo",
                table: "DocumentChunks",
                vectorColumn: "embedding",
                dimensions: 1536,
                keyColumn: "chunk_id",
                keyIsUnique: true,
                labelColumn: "title",
            });
            expect(result.targets![0].rowCountEstimate).to.equal(2412883);
            expect(result.targets![0].id).to.match(/^vst_/);
            expect(result.targets![0].filterColumns).to.deep.equal([
                { name: "category", sqlType: "nvarchar" },
                { name: "tenant_id", sqlType: "int" },
            ]);
            expect(result.targets![1]).to.include({
                schema: "sales",
                table: "Vectors",
                vectorColumn: "vec",
                dimensions: 8,
                keyIsUnique: false,
            });
            // Catalog statement rides background/metadata with the search tag.
            const sent = harness.session.executed.find((s) => isTargets(s.text))!;
            expect(sent.text).to.equal(VECTOR_SEARCH_TARGETS_SQL);
            expect(sent.opts.priority).to.equal("background");
            expect(sent.opts.commandKind).to.equal("metadata");
            expect(sent.opts.tag).to.equal(VECTOR_SEARCH_TAG);
            expect(
                harness.session.executed.some(
                    (statement) => statement.text === VECTOR_SEARCH_FILTER_COLUMNS_SQL,
                ),
            ).to.equal(true);
            expect(harness.leaseDisposals).to.equal(2);
        } finally {
            teardown(harness);
        }
    });

    test("catalog failure is an honest error", async () => {
        const harness = await makeHarness({
            rules: [{ match: isTargets, fail: "Invalid column name 'vector_dimensions'." }],
        });
        try {
            const result = await harness.service.searchTargets();
            expect(result.error).to.contain("Search targets could not be listed");
            expect(result.error).to.contain("vector_dimensions");
        } finally {
            teardown(harness);
        }
    });
});

// ---------------------------------------------------------------------------
// Search Text-with-model source
// ---------------------------------------------------------------------------

suite("vectorSearchService text-with-model source", () => {
    const modelProbe = (): VectorCapabilityProbe => ({
        ...makeProbe({ indexes: [CONFIRMED_INDEX] }),
        externalModels: {
            evidence: STAMP,
            available: true,
            models: [
                {
                    name: "VectorLabEmbeddingModel",
                    owner: "dbo",
                    apiFormat: "Azure OpenAI",
                    modelType: "EMBEDDINGS",
                    providerModel: "text-embedding-3-small",
                    endpointHost: "example.openai.azure.com",
                    modifyTime: "2026-07-12T01:02:03",
                    egress: "externalEgress",
                },
                {
                    name: "NotAnEmbeddingModel",
                    modelType: "CHAT",
                    egress: "externalEgress",
                },
            ],
        },
    });
    const isModelCall = (sql: string) => sql.includes("AI_GENERATE_EMBEDDINGS");

    test("parameters are bounded, canonical, and restricted to documented numeric overrides", () => {
        expect(validateSearchModelParameters(undefined)).to.deep.equal({});
        expect(
            validateSearchModelParameters(
                '{ "sql_rest_options": { "retry_count": 2 }, "dimensions": 3 }',
            ),
        ).to.deep.equal({
            canonicalJson: '{"dimensions":3,"sql_rest_options":{"retry_count":2}}',
        });
        expect(validateSearchModelParameters('{"api_key":"secret"}').error).to.contain(
            "not allowed",
        );
        expect(
            validateSearchModelParameters('{"sql_rest_options":{"retry_count":11}}').error,
        ).to.contain("0 to 10");
        expect(validateSearchModelParameters("[]").error).to.contain("JSON object");
    });

    test("generated SQL escapes values and uses PARAMETERS without trusting a model identifier", () => {
        const sql = buildSearchModelSql("O'Brien\nsecond line", "Odd]Model", '{"dimensions":3}');
        expect(sql).to.contain("N'O''Brien\nsecond line'");
        expect(sql).to.contain("USE MODEL [Odd]]Model] PARAMETERS @params");
        expect(sql).to.contain("DECLARE @params JSON = N'{\"dimensions\":3}'");
        expect(sql).to.not.contain("USE MODEL dbo.");
    });

    test("inventory and prepare make no model call; execute mints only an opaque vector id", async () => {
        const harness = await makeHarness({
            capabilities: { probe: modelProbe() },
            rules: [{ match: isModelCall, rows: [["[0.1,0.2,0.3]"]] }],
        });
        const markerCalls: Array<{ name: string; attrs: Record<string, unknown> }> = [];
        const originalMarker = Perf.marker;
        Perf.marker = ((name: string, _phase: string, attrs: Record<string, unknown>) => {
            markerCalls.push({ name, attrs });
        }) as typeof Perf.marker;
        try {
            const inventory = await harness.service.searchModels(harness.handle);
            expect(inventory.error).to.equal(undefined);
            expect(inventory.models).to.have.length(1);
            expect(inventory.models[0]).to.include({
                name: "VectorLabEmbeddingModel",
                modelType: "EMBEDDINGS",
                egress: "externalEgress",
            });
            expect(inventory.models[0].id).to.match(/^vsm_/);
            expect(harness.session.executed.some((entry) => isModelCall(entry.text))).to.equal(
                false,
            );

            const prepared = await harness.service.searchModelPrepare({
                handle: harness.handle,
                targetId: harness.targetId,
                modelId: inventory.models[0].id,
                text: "private multiline source\nwith apostrophe ' and unicode Ω",
                parametersJson: '{"dimensions":3,"sql_rest_options":{"retry_count":1}}',
            });
            expect(prepared.error).to.equal(undefined);
            expect(prepared.confirmationToken).to.match(/^[A-Za-z0-9_-]+$/);
            expect(prepared.descriptor).to.include({
                model: "VectorLabEmbeddingModel",
                modelType: "EMBEDDINGS",
                endpointHost: "example.openai.azure.com",
                egress: "externalEgress",
                modelModifyTime: "2026-07-12T01:02:03",
                rowsCalls: 1,
                expectedDimensions: 3,
                retryPolicy: "1 retry · at most 2 endpoint attempts",
                resultHandling: "kept in this panel · not written to the table",
            });
            expect(prepared.generatedSql).to.contain("PARAMETERS @params");
            expect(harness.session.executed.some((entry) => isModelCall(entry.text))).to.equal(
                false,
            );

            const generated = await harness.service.searchModelExecute(
                harness.handle,
                prepared.confirmationToken!,
            );
            expect(generated.error).to.equal(undefined);
            expect(generated.generatedVectorId).to.match(/^vsg_/);
            expect(generated.dimensions).to.equal(3);
            expect(generated.modelStatementIssued).to.equal(true);
            expect(generated.modelEgress).to.equal("externalEgress");
            expect(generated.modelStatementCounts?.externalEgress).to.equal(1);
            expect(generated).to.not.have.property("vector");
            const sent = harness.session.executed.find((entry) => isModelCall(entry.text))!;
            const verificationIndex = harness.session.executed.findIndex((entry) =>
                isModelVerification(entry.text),
            );
            const modelCallIndex = harness.session.executed.findIndex((entry) =>
                isModelCall(entry.text),
            );
            expect(verificationIndex).to.be.greaterThan(-1);
            expect(verificationIndex).to.be.lessThan(modelCallIndex);
            expect(harness.session.executed[verificationIndex].text).to.contain("m.location");
            expect(sent.opts.tag).to.equal(VECTOR_MODEL_CALL_TAG);
            expect(sent.opts.commandKind).to.equal("user");

            const comparison = await harness.service.search(
                searchParams(harness, {
                    source: { kind: "generatedVector", id: generated.generatedVectorId! },
                    includeApprox: false,
                }),
            );
            expect(comparison.error).to.equal(undefined);
            expect(comparison.comparison?.dimensions).to.equal(3);
            expect(
                comparison.comparison?.evidence.find((row) => row.label === "Query vector")?.value,
            ).to.contain("explicitly confirmed");

            const reused = await harness.service.searchModelExecute(
                harness.handle,
                prepared.confirmationToken!,
            );
            expect(reused.error).to.contain("already used");
            const modelMarkers = markerCalls.filter(
                (call) => call.name === "mssql.queryResults.vector.model.end",
            );
            expect(modelMarkers).to.have.length(1);
            expect(Object.keys(modelMarkers[0].attrs).sort()).to.deep.equal([
                "dims",
                "ms",
                "outcome",
            ]);
            expect(JSON.stringify(modelMarkers[0].attrs)).to.not.contain("VectorLab");
            expect(JSON.stringify(modelMarkers[0].attrs)).to.not.contain("example.openai");
            expect(JSON.stringify(modelMarkers[0].attrs)).to.not.contain("private multiline");

            await harness.service.suspendSensitiveState(harness.handle);
            const revoked = await harness.service.search(
                searchParams(harness, {
                    source: { kind: "generatedVector", id: generated.generatedVectorId! },
                    includeApprox: false,
                }),
            );
            expect(revoked.error).to.contain("no longer available");
        } finally {
            Perf.marker = originalMarker;
            teardown(harness);
        }
    });

    test("same-session verification refuses endpoint drift before external egress", async () => {
        const changedLocation =
            "https://different.example.com/openai/embeddings?api-key=must-not-leak";
        const harness = await makeHarness({
            capabilities: { probe: modelProbe() },
            rules: [
                {
                    match: isModelVerification,
                    rows: [
                        [
                            "VectorLabEmbeddingModel",
                            "dbo",
                            "Azure OpenAI",
                            "EMBEDDINGS",
                            "text-embedding-3-small",
                            changedLocation,
                            "2026-07-12T01:02:03",
                        ],
                    ],
                },
                { match: isModelCall, rows: [["[0.1,0.2,0.3]"]] },
            ],
        });
        try {
            const inventory = await harness.service.searchModels(harness.handle);
            const prepared = await harness.service.searchModelPrepare({
                handle: harness.handle,
                targetId: harness.targetId,
                modelId: inventory.models[0].id,
                text: "do not send this text after endpoint drift",
            });
            const executed = await harness.service.searchModelExecute(
                harness.handle,
                prepared.confirmationToken!,
            );

            expect(executed.error).to.contain("identity or endpoint changed");
            expect(executed.error).to.not.contain("different.example.com");
            expect(executed.error).to.not.contain("must-not-leak");
            expect(executed.modelStatementIssued).to.equal(false);
            expect(executed.modelStatementCounts?.externalEgress).to.equal(0);
            expect(harness.session.executed.some((entry) => isModelCall(entry.text))).to.equal(
                false,
            );
        } finally {
            teardown(harness);
        }
    });

    test("prepare enforces text and target-dimension bounds before consent", async () => {
        const harness = await makeHarness({ capabilities: { probe: modelProbe() } });
        try {
            const inventory = await harness.service.searchModels(harness.handle);
            const tooLong = await harness.service.searchModelPrepare({
                handle: harness.handle,
                targetId: harness.targetId,
                modelId: inventory.models[0].id,
                text: "x".repeat(VECTOR_SEARCH_MODEL_TEXT_MAX_CHARS + 1),
            });
            expect(tooLong.error).to.contain("characters");
            const wrongDimensions = await harness.service.searchModelPrepare({
                handle: harness.handle,
                targetId: harness.targetId,
                modelId: inventory.models[0].id,
                text: "bounded input",
                parametersJson: '{"dimensions":2}',
            });
            expect(wrongDimensions.error).to.contain("verified target declares 3");
            const revocable = await harness.service.searchModelPrepare({
                handle: harness.handle,
                targetId: harness.targetId,
                modelId: inventory.models[0].id,
                text: "dialog cancelled before execution",
            });
            await harness.service.cancel(harness.handle);
            const afterCancel = await harness.service.searchModelExecute(
                harness.handle,
                revocable.confirmationToken!,
            );
            expect(afterCancel.error).to.contain("invalid, expired, or already used");
            expect(harness.session.executed.some((entry) => isModelCall(entry.text))).to.equal(
                false,
            );
        } finally {
            teardown(harness);
        }
    });

    test("invalid dimensions and cancellation each emit one value-free terminal marker", async () => {
        const harness = await makeHarness({
            capabilities: { probe: modelProbe() },
            rules: [{ match: isModelCall, rows: [["[0.1,0.2]"]], delayMs: 50 }],
        });
        const markerCalls: Array<{ name: string; attrs: Record<string, unknown> }> = [];
        const originalMarker = Perf.marker;
        Perf.marker = ((name: string, _phase: string, attrs: Record<string, unknown>) => {
            markerCalls.push({ name, attrs });
        }) as typeof Perf.marker;
        try {
            const inventory = await harness.service.searchModels(harness.handle);
            const prepared = await harness.service.searchModelPrepare({
                handle: harness.handle,
                targetId: harness.targetId,
                modelId: inventory.models[0].id,
                text: "cancel me",
            });
            const pending = harness.service.searchModelExecute(
                harness.handle,
                prepared.confirmationToken!,
            );
            while (!harness.session.executed.some((entry) => isModelCall(entry.text))) {
                await new Promise((resolve) => setTimeout(resolve, 2));
            }
            const issuedInventory = await harness.service.searchModels(harness.handle);
            expect(issuedInventory.modelStatementCounts.externalEgress).to.equal(1);
            const suspending = harness.service.suspendSensitiveState(harness.handle);
            const reopenedInventory = await harness.service.searchModels(harness.handle);
            expect(reopenedInventory.modelStatementCounts.externalEgress).to.equal(1);
            await suspending;
            const result = await pending;
            expect(result.generatedVectorId).to.equal(undefined);
            expect(result.error).to.contain("cancelled");
            const modelMarkers = markerCalls.filter(
                (call) => call.name === "mssql.queryResults.vector.model.end",
            );
            expect(modelMarkers).to.have.length(1);
            expect(modelMarkers[0].attrs.outcome).to.equal("error");
            expect(modelMarkers[0].attrs.dims).to.equal(0);
            expect(JSON.stringify(modelMarkers[0].attrs)).to.not.contain("cancel me");
        } finally {
            Perf.marker = originalMarker;
            teardown(harness);
        }
    });
});
