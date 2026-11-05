/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * VEC-10: the Pipeline service — host-minted confirmation tokens (mint /
 * consume-once / expiry / wrong-token), the truncated-source refusal, N''
 * escaping + QUOTENAME injection discipline (displayed == executed), local
 * chunk math, hand-checked comparison math, egress copy per API_FORMAT
 * class, confirmation-descriptor field completeness against the
 * vec_pipeline_regen.png mock, and the payload-KiB estimate.
 *
 * Part 2 — LIVE gated smoke (skip-not-fail, vectorCatalogProbes pattern):
 * ONE AI_GENERATE_EMBEDDINGS call against the local SQL Server 2025
 * VectorLab fixture (fresh embedding of a literal string must be 1536-D,
 * strictly parseable, unit-norm ±0.01) plus an AI_GENERATE_CHUNKS acceptance
 * probe via TRY/CATCH around sp_executesql (parse errors of dynamic SQL are
 * catchable; a bare batch parse error is not). Connection strings and
 * passwords are never printed.
 */

import { expect } from "chai";
import * as cp from "child_process";
import { FakeBackend, FakeScript } from "../../src/services/sqlDataPlane/fakeBackend";
import { ISqlSession } from "../../src/services/sqlDataPlane/api";
import {
    buildPipelineModelVerificationSql,
    buildReembedSql,
    compareStoredVsFresh,
    computeFixedChunks,
    escapeNString,
    estimatePayloadKiB,
    executionCopyForEgress,
    parseFreshVectorJson,
    quoteSqlIdentifier,
    TRUNCATED_CHUNK_REFUSAL,
    TRUNCATED_SOURCE_REFUSAL,
    VectorPipelineService,
    VectorPipelineThunks,
} from "../../src/queryResults/vector/vectorPipelineService";
import {
    VECTOR_CHUNK_PREVIEW_CHARS,
    VECTOR_CHUNK_PREVIEW_MAX_CHUNKS,
    VECTOR_REEMBED_TOKEN_TTL_MS,
    VECTOR_REEMBED_SOURCE_MAX_CHARS,
    VECTOR_REEMBED_SOURCE_MAX_UTF8_BYTES,
    VECTOR_SERVER_SIDE_CLAIM,
} from "../../src/sharedInterfaces/vectorPipeline";
import { Perf } from "../../src/perf/perfTelemetry";
import {
    VectorCapabilityProbe,
    VectorExternalModelProbeRow,
    VectorProbeEvidence,
} from "../../src/sharedInterfaces/vectorCatalog";
import {
    IQueryResultStore,
    QueryResultSetFrozenSummary,
} from "../../src/queryResults/queryResultTypes";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Encode a typed ok vector cell (wire shape) from float32 components. */
function vectorCell(values: number[]): unknown {
    const packed = new Float32Array(values);
    const data = Buffer.from(packed.buffer, packed.byteOffset, packed.byteLength).toString(
        "base64",
    );
    return {
        $t: "vector",
        version: 1,
        status: "ok",
        dimensions: values.length,
        baseType: "float32",
        encoding: "f32le",
        byteLength: values.length * 4,
        data,
    };
}

const SOURCE_TEXT =
    "Customers on annual plans may request a prorated refund within 30 days of renewal.";

function stamp(source: VectorProbeEvidence["source"]): VectorProbeEvidence {
    return { source, capturedEpochMs: 0 };
}

function defaultModel(): VectorExternalModelProbeRow {
    return {
        name: "VectorLabEmbeddingModel",
        owner: "dbo",
        apiFormat: "Azure OpenAI",
        modelType: "EMBEDDINGS",
        providerModel: "text-embedding-3-small",
        endpointHost: "example.openai.azure.com",
        modifyTime: "2026-07-11T00:00:00",
        egress: "externalEgress",
    };
}

function fakeProbe(
    models: VectorExternalModelProbeRow[],
    compat: number | "absent",
): VectorCapabilityProbe {
    return {
        evidence: stamp("diagnosticQuery"),
        engine: {
            evidence: stamp("catalog"),
            ...(compat !== "absent" ? { compatibilityLevel: compat } : {}),
        },
        previewFeatures: { evidence: stamp("catalog"), present: true, enabled: true },
        allowStaleVectorIndex: { evidence: stamp("catalog"), present: false },
        vectorType: { evidence: stamp("diagnosticQuery"), usable: true },
        columnMetadata: {
            evidence: stamp("catalog"),
            vectorDimensionsPresent: true,
            columns: ["vector_dimensions"],
        },
        indexes: { evidence: stamp("catalog"), available: true, indexes: [], phantomCount: 0 },
        healthDmv: { evidence: stamp("catalog"), present: false, columns: [] },
        externalModels: { evidence: stamp("catalog"), available: true, models },
        serverConfig: { evidence: stamp("catalog"), externalRestEndpointEnabled: true },
        vectorSearchTvf: { evidence: stamp("diagnosticQuery"), status: "accepted" },
        topNWithApproximate: { evidence: stamp("diagnosticQuery"), status: "rejected" },
    };
}

/** Minimal result-store fake: summary + sparse getWindow over fixed rows. */
function fakeStore(columns: string[], rows: unknown[][], windowDelayMs = 0): IQueryResultStore {
    const summary: QueryResultSetFrozenSummary = {
        resultSetId: "rs1",
        columnNames: [...columns],
        columns: columns.map((name) => ({ name, displayName: name })),
        rowCount: rows.length,
        complete: true,
        corrupt: false,
    };
    return {
        storeId: "store1",
        runId: "run1",
        createdEpochMs: 0,
        kind: "rowStoreV1",
        state: "active",
        retain: () => undefined,
        getWindow: async (req) => {
            if (windowDelayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, windowDelayMs));
            }
            return {
                resultSetId: req.resultSetId,
                start: req.rowStart,
                rowCount: 1,
                columns: [],
                values: [
                    (req.columnOrdinals ?? []).map(
                        (ordinal) => rows[req.rowStart]?.[ordinal] ?? null,
                    ),
                ],
            };
        },

        streamRows: async function* () {
            throw new Error("streamRows is not used by the pipeline service");
        },
        summary: (resultSetId) => (resultSetId === "rs1" ? summary : undefined),
        stats: () => ({
            memoryBytes: 0,
            spillBytes: 0,
            resultSets: 1,
            pages: 0,
            spillReads: 0,
            windowCacheHits: 0,
            windowCacheMisses: 0,
            windowReads: 0,
        }),
        demote: () => undefined,
    };
}

interface HarnessOptions {
    rows?: unknown[][];
    columns?: string[];
    models?: VectorExternalModelProbeRow[];
    compat?: number | "absent";
    capabilitiesError?: string;
    /** Model-call script outcome: the returned JSON text (success path). */
    modelResponse?: string;
    /** Model-call script outcome: server error text (failure path). */
    modelFailure?: string;
    modelDelayMs?: number;
    verificationModel?: VectorExternalModelProbeRow;
    verificationLocation?: string;
    verificationFailure?: string;
    auxAcquireDelayMs?: number;
    auxAcquireFailure?: string;
    auxAvailable?: boolean;
    capabilitiesDelayMs?: number;
    windowDelayMs?: number;
}

function makeHarness(options: HarnessOptions = {}) {
    const columns = options.columns ?? ["id", "chunk_text", "embedding"];
    const rows = options.rows ?? [[1, SOURCE_TEXT, vectorCell([0.6, 0.8])]];
    const store = fakeStore(columns, rows, options.windowDelayMs);
    const models = options.models ?? [defaultModel()];
    const verificationModel = options.verificationModel ?? models[0];
    const executed: string[] = [];
    const counters = {
        auxAcquired: 0,
        auxDisposed: 0,
        queryStarted: 0,
        queryCanceled: 0,
        queryDisposed: 0,
    };
    let modelStarted!: () => void;
    const modelStartedPromise = new Promise<void>((resolve) => (modelStarted = resolve));
    let nowMs = 1_000_000;

    const modelScript = (): FakeScript => {
        const events: FakeScript["events"] = options.modelFailure
            ? [
                  { type: "message", kind: "error", text: options.modelFailure },
                  { type: "complete", status: "failed" },
              ]
            : [
                  {
                      type: "resultSet",
                      columns: ["fresh"],
                      rows: [[options.modelResponse ?? "[0.8,0.6]"]],
                      ...(options.modelDelayMs ? { delayMs: options.modelDelayMs } : {}),
                  },
                  { type: "complete", status: "succeeded" },
              ];
        return {
            match: (text) => {
                const matches = text.includes("AI_GENERATE_EMBEDDINGS");
                if (matches) executed.push(text);
                return matches;
            },
            events,
        };
    };
    const verificationScript = (): FakeScript => ({
        match: (text) => text.includes("FROM sys.external_models m"),
        events: options.verificationFailure
            ? [
                  { type: "message", kind: "error", text: options.verificationFailure },
                  { type: "complete", status: "failed" },
              ]
            : [
                  {
                      type: "resultSet",
                      columns: [
                          "name",
                          "owner",
                          "api_format",
                          "model_type_desc",
                          "model",
                          "location",
                          "modify_time",
                      ],
                      rows: verificationModel
                          ? [
                                [
                                    verificationModel.name,
                                    verificationModel.owner ?? null,
                                    verificationModel.apiFormat ?? null,
                                    verificationModel.modelType ?? null,
                                    verificationModel.providerModel ?? null,
                                    options.verificationLocation ??
                                        (verificationModel.endpointHost
                                            ? `https://${verificationModel.endpointHost}/openai/embeddings`
                                            : null),
                                    verificationModel.modifyTime ?? null,
                                ],
                            ]
                          : [],
                  },
                  { type: "complete", status: "succeeded" },
              ],
    });

    const thunks: VectorPipelineThunks = {
        auxModelSession: async () => {
            if (options.auxAcquireDelayMs) {
                await new Promise((resolve) => setTimeout(resolve, options.auxAcquireDelayMs));
            }
            if (options.auxAcquireFailure) {
                throw new Error(options.auxAcquireFailure);
            }
            if (options.auxAvailable === false) {
                return undefined;
            }
            counters.auxAcquired++;
            const backend = new FakeBackend({ scripts: [verificationScript(), modelScript()] });
            const session: ISqlSession = await backend.openSession({
                profile: { profileFingerprint: "fp", server: "srv", authKind: "integrated" },
                applicationName: "test-vector-model-call",
            });
            const execute = session.execute.bind(session);
            session.execute = (text, executeOptions, sink) => {
                counters.queryStarted++;
                const handle = execute(text, executeOptions, sink);
                if (text.includes("AI_GENERATE_EMBEDDINGS")) modelStarted();
                return {
                    ...handle,
                    cancel: async () => {
                        counters.queryCanceled++;
                        return handle.cancel();
                    },
                    dispose: async () => {
                        counters.queryDisposed++;
                        return handle.dispose();
                    },
                };
            };
            return {
                session,
                dispose: () => {
                    counters.auxDisposed++;
                    void session.close();
                },
            };
        },
        capabilities: async () => {
            if (options.capabilitiesDelayMs) {
                await new Promise((resolve) => setTimeout(resolve, options.capabilitiesDelayMs));
            }
            return options.capabilitiesError
                ? { error: options.capabilitiesError }
                : { probe: fakeProbe(models, options.compat ?? 170) };
        },
        workbench: (handle) =>
            handle === "h1" ? { store, resultSetId: "rs1", vectorColumnOrdinal: 2 } : undefined,
    };
    const service = new VectorPipelineService(thunks, () => nowMs);
    return {
        service,
        executed,
        counters,
        modelStarted: modelStartedPromise,
        advance: (ms: number) => {
            nowMs += ms;
        },
    };
}

const PREPARE_DEFAULTS = {
    handle: "h1",
    ordinal: 0,
    sourceColumnOrdinal: 1,
};

async function prepareDefault(
    harness: ReturnType<typeof makeHarness>,
    overrides: Partial<{
        handle: string;
        ordinal: number;
        sourceColumnOrdinal: number;
        modelId: string;
    }> = {},
) {
    const state = await harness.service.pipelineState();
    return harness.service.reembedPrepare({
        ...PREPARE_DEFAULTS,
        modelId: state.models[0]?.id ?? "missing-model-binding",
        ...overrides,
    });
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

suite("VectorPipelineService (VEC-10) — pure helpers", () => {
    test("N'' escaping + QUOTENAME: injection attempts stay inert and the SQL is exact", () => {
        expect(escapeNString("O'Brien")).to.equal("O''Brien");
        expect(quoteSqlIdentifier("Weird]Model'Name")).to.equal("[Weird]]Model'Name]");

        const sql = buildReembedSql("O'Brien'); DROP TABLE Students;--", "Weird]Model'Name");
        expect(sql).to.equal(
            [
                "DECLARE @t nvarchar(max) = N'O''Brien''); DROP TABLE Students;--';",
                "SELECT CAST(AI_GENERATE_EMBEDDINGS(@t USE MODEL [Weird]]Model'Name]) AS nvarchar(max)) AS fresh;",
            ].join("\n"),
        );
        // Database-scoped model naming (P0-4): never schema-qualified.
        expect(sql).to.include("USE MODEL [");
        expect(sql).to.not.include("USE MODEL [dbo].");
        // The N'' literal's quotes are balanced: an odd count on the DECLARE
        // line would terminate the literal early. (The identifier line may
        // carry a lone quote INSIDE brackets — legal and inert there.)
        const declareLine = sql.split("\n")[0];
        const quoteCount = (declareLine.match(/'/g) ?? []).length;
        expect(quoteCount % 2).to.equal(0);
    });

    test("model verification uses an exact binary database-scoped identity", () => {
        const sql = buildPipelineModelVerificationSql("Case]Sensitive'Model");
        expect(sql).to.contain("FROM sys.external_models m");
        expect(sql).to.contain("CONVERT(varbinary(512), m.name)");
        expect(sql).to.contain("N'Case]Sensitive''Model'");
        expect(sql).to.contain("m.model_type_desc");
    });

    test("payload estimate: UTF-16 upper bound rounded UP to 0.1 KiB (mock: 842 chars → 1.7 KiB)", () => {
        expect(estimatePayloadKiB(842)).to.equal(1.7);
        expect(estimatePayloadKiB(100)).to.equal(0.2);
        expect(estimatePayloadKiB(1)).to.equal(0.1);
        expect(estimatePayloadKiB(1024 * 512)).to.equal(1024);
    });

    test("egress copy per class (A4/P0-5): truthful execution + layered claim", () => {
        expect(executionCopyForEgress("externalEgress")).to.equal(
            "SQL Server calls the external endpoint via AI_GENERATE_EMBEDDINGS",
        );
        expect(executionCopyForEgress("hostLocal")).to.include("host-local endpoint");
        expect(executionCopyForEgress("inProcess")).to.include("no network egress");
        expect(executionCopyForEgress("unknown")).to.include("unclassified");

        expect(VECTOR_SERVER_SIDE_CLAIM.externalEgress).to.include("leaves your environment");
        expect(VECTOR_SERVER_SIDE_CLAIM.hostLocal).to.include("not the host");
        expect(VECTOR_SERVER_SIDE_CLAIM.inProcess).to.include("no network egress");
        expect(VECTOR_SERVER_SIDE_CLAIM.unknown).to.include("cannot be classified");
    });

    test("chunk math: overlap, stride, tail, and stop-at-end", () => {
        // 1,000 chars, size 300, overlap 10% → 30 chars shared, stride 270.
        const text = "x".repeat(1000);
        const computed = computeFixedChunks(text, 300, 10);
        expect(computed.totalChars).to.equal(1000);
        expect(computed.chunkListTruncated).to.equal(false);
        expect(computed.chunks.map((c) => c.startOffset)).to.deep.equal([0, 270, 540, 810]);
        expect(computed.chunks.map((c) => c.chars)).to.deep.equal([300, 300, 300, 190]);
        expect(computed.chunks.map((c) => c.overlapChars)).to.deep.equal([0, 30, 30, 30]);

        // 50% overlap: emission stops once a chunk reaches the end — no
        // degenerate tail fully contained in its predecessor.
        const half = computeFixedChunks("y".repeat(1000), 800, 50);
        expect(half.chunks.map((c) => c.startOffset)).to.deep.equal([0, 400]);
        expect(half.chunks.map((c) => c.chars)).to.deep.equal([800, 600]);
        expect(half.chunks.map((c) => c.overlapChars)).to.deep.equal([0, 400]);
    });

    test("chunk math edges: shorter-than-one-chunk, exact fit, one-char tail, empty", () => {
        const tiny = computeFixedChunks("abc", 200, 15);
        expect(tiny.chunks).to.have.length(1);
        expect(tiny.chunks[0]).to.deep.include({
            index: 0,
            startOffset: 0,
            chars: 3,
            overlapChars: 0,
        });

        expect(computeFixedChunks("z".repeat(800), 800, 15).chunks).to.have.length(1);

        const tail = computeFixedChunks("q".repeat(801), 800, 0);
        expect(tail.chunks.map((c) => c.chars)).to.deep.equal([800, 1]);
        expect(tail.chunks[1].overlapChars).to.equal(0);

        expect(computeFixedChunks("", 200, 0).chunks).to.have.length(0);
    });

    test("chunk previews are bounded to the first 80 characters; the list caps disclosed", () => {
        const alphabet = "abcdefghij".repeat(120); // 1,200 chars
        const computed = computeFixedChunks(alphabet, 200, 0);
        for (const chunk of computed.chunks) {
            expect(chunk.previewText.length).to.be.at.most(VECTOR_CHUNK_PREVIEW_CHARS);
            expect(chunk.previewText).to.equal(
                alphabet.slice(
                    chunk.startOffset,
                    chunk.startOffset + Math.min(chunk.chars, VECTOR_CHUNK_PREVIEW_CHARS),
                ),
            );
        }

        const huge = computeFixedChunks("h".repeat(200 * 300), 200, 0);
        expect(huge.chunkListTruncated).to.equal(true);
        expect(huge.chunks).to.have.length(VECTOR_CHUNK_PREVIEW_MAX_CHUNKS);
    });

    test("fresh-vector JSON parse is STRICT: arrays of finite numbers only", () => {
        expect(parseFreshVectorJson("[1.5,-2.25,0]").values).to.deep.equal([1.5, -2.25, 0]);
        expect(parseFreshVectorJson("not json").error).to.include("not valid JSON");
        expect(parseFreshVectorJson("{}").error).to.include("non-empty array");
        expect(parseFreshVectorJson("[]").error).to.include("non-empty array");
        expect(parseFreshVectorJson('[1,"a"]').error).to.include("non-numeric");
        expect(parseFreshVectorJson("[1,null]").error).to.include("non-numeric");
        expect(parseFreshVectorJson("[Infinity]").error).to.include("not valid JSON");
    });

    test("comparison math hand-checked (float64; zero-norm cosine is null, never coerced)", () => {
        const orthogonal = compareStoredVsFresh([1, 0], [0, 1]);
        expect(orthogonal.cosine).to.be.closeTo(1, 1e-12);
        expect(orthogonal.euclidean).to.be.closeTo(Math.SQRT2, 1e-12);
        expect(orthogonal.negativeDot).to.be.closeTo(0, 1e-12);
        expect(orthogonal.normStored).to.equal(1);
        expect(orthogonal.normFresh).to.equal(1);
        expect(orthogonal.dimensions).to.equal(2);

        const identical = compareStoredVsFresh([3, 4], [3, 4]);
        expect(identical.cosine).to.be.closeTo(0, 1e-12);
        expect(identical.euclidean).to.equal(0);
        expect(identical.negativeDot).to.equal(-25);
        expect(identical.normStored).to.equal(5);

        // dot = 8, norms 3·3 ⇒ cosine distance 1 − 8/9.
        const skew = compareStoredVsFresh([1, 2, 2], [2, 2, 1]);
        expect(skew.cosine).to.be.closeTo(1 - 8 / 9, 1e-12);
        expect(skew.euclidean).to.be.closeTo(Math.SQRT2, 1e-12);
        expect(skew.negativeDot).to.equal(-8);

        expect(compareStoredVsFresh([0, 0], [1, 1]).cosine).to.equal(null);
    });
});

// ---------------------------------------------------------------------------
// pipelineState
// ---------------------------------------------------------------------------

suite("VectorPipelineService (VEC-10) — pipelineState", () => {
    test("models come from the probe with owner + api_format + egress; non-EMBEDDINGS filtered (A9)", async () => {
        const h = makeHarness({
            models: [
                defaultModel(),
                {
                    name: "SomeChatThing",
                    owner: "dbo",
                    apiFormat: "Azure OpenAI",
                    modelType: "CHAT",
                    egress: "externalEgress",
                },
            ],
        });
        const state = await h.service.pipelineState();
        expect(state.error).to.equal(undefined);
        expect(state.models).to.have.length(1);
        expect(state.models[0]).to.deep.include({
            name: "VectorLabEmbeddingModel",
            owner: "dbo",
            apiFormat: "Azure OpenAI",
            modelType: "EMBEDDINGS",
            providerModel: "text-embedding-3-small",
            endpointHost: "example.openai.azure.com",
            egress: "externalEgress",
        });
        expect(state.networkClaim.webview).to.equal("none");
        expect(Object.keys(state.networkClaim.serverSide)).to.have.members([
            "externalEgress",
            "hostLocal",
            "inProcess",
            "unknown",
        ]);
    });

    test("chunkingAvailable follows the probed compatibility level (170 gate)", async () => {
        expect((await makeHarness({ compat: 170 }).service.pipelineState()).chunkingAvailable) //
            .to.equal(true);
        expect((await makeHarness({ compat: 160 }).service.pipelineState()).chunkingAvailable) //
            .to.equal(false);
        expect(
            (await makeHarness({ compat: "absent" }).service.pipelineState()).chunkingAvailable,
        ).to.equal(false);
    });

    test("capability refusal passes through honestly — no invented models", async () => {
        const h = makeHarness({ capabilitiesError: "No active connection." });
        const state = await h.service.pipelineState();
        expect(state.models).to.have.length(0);
        expect(state.chunkingAvailable).to.equal(false);
        expect(state.error).to.include("No active connection");
    });
});

// ---------------------------------------------------------------------------
// reembedPrepare — host-minted confirmation
// ---------------------------------------------------------------------------

suite("VectorPipelineService (VEC-10) — reembedPrepare", () => {
    test("descriptor carries EVERY confirmation-dialog field from the mock", async () => {
        const h = makeHarness();
        const prepared = await prepareDefault(h);
        expect(prepared.error).to.equal(undefined);
        expect(prepared.confirmationToken).to.be.a("string").with.length.greaterThan(20);
        expect(prepared.tokenExpiresEpochMs).to.equal(1_000_000 + VECTOR_REEMBED_TOKEN_TTL_MS);
        expect(prepared.storedDimensions).to.equal(2);
        expect(prepared.sourcePreview).to.equal(SOURCE_TEXT); // short text: no ellipsis
        expect(prepared.sourcePreviewTruncated).to.equal(false);

        const d = prepared.descriptor!;
        expect(d.model).to.equal("VectorLabEmbeddingModel");
        expect(d.owner).to.equal("dbo"); // owner principal, never a schema prefix
        expect(d.modelType).to.equal("EMBEDDINGS");
        expect(d.apiFormat).to.equal("Azure OpenAI");
        expect(d.endpointHost).to.equal("example.openai.azure.com");
        expect(d.egress).to.equal("externalEgress");
        expect(d.modelModifyTime).to.equal("2026-07-11T00:00:00");
        expect(d.source).to.equal("Selected row · chunk_text");
        expect(d.rowsCalls).to.equal(1);
        expect(d.textChars).to.equal(SOURCE_TEXT.length);
        expect(d.approxPayloadKiB).to.equal(estimatePayloadKiB(SOURCE_TEXT.length));
        expect(d.execution).to.equal(
            "SQL Server calls the external endpoint via AI_GENERATE_EMBEDDINGS",
        );
        expect(d.resultHandling).to.equal("kept in this panel · not written to the table");

        expect(prepared.generatedSql).to.equal(
            buildReembedSql(SOURCE_TEXT, "VectorLabEmbeddingModel"),
        );
    });

    test("TRUNCATED source cell is a hard refusal — never a partial document to a model", async () => {
        const h = makeHarness({
            rows: [
                [
                    1,
                    { $t: "truncated", of: "string", bytes: 4096, v: "a kept prefix…" },
                    vectorCell([0.6, 0.8]),
                ],
            ],
        });
        const prepared = await prepareDefault(h);
        expect(prepared.error).to.equal(TRUNCATED_SOURCE_REFUSAL);
        expect(prepared.confirmationToken).to.equal(undefined);
        expect(prepared.generatedSql).to.equal(undefined);
    });

    test("independent source character and UTF-8 byte caps refuse before SQL/token retention", async () => {
        const tooManyChars = makeHarness({
            rows: [[1, "x".repeat(VECTOR_REEMBED_SOURCE_MAX_CHARS + 1), vectorCell([0.6, 0.8])]],
        });
        const chars = await prepareDefault(tooManyChars);
        expect(chars.error).to.include("characters");
        expect(chars.confirmationToken).to.equal(undefined);
        expect(chars.generatedSql).to.equal(undefined);

        const byteHeavy = "€".repeat(Math.floor(VECTOR_REEMBED_SOURCE_MAX_UTF8_BYTES / 3) + 1);
        expect(byteHeavy.length).to.be.lessThan(VECTOR_REEMBED_SOURCE_MAX_CHARS);
        const tooManyBytes = makeHarness({
            rows: [[1, byteHeavy, vectorCell([0.6, 0.8])]],
        });
        const bytes = await prepareDefault(tooManyBytes);
        expect(bytes.error).to.include("UTF-8 bytes");
        expect(bytes.confirmationToken).to.equal(undefined);
        expect(bytes.generatedSql).to.equal(undefined);
    });

    test("bounded source preview is explicitly labeled while SQL retains the full accepted source", async () => {
        const fullSource = "a".repeat(220);
        const h = makeHarness({ rows: [[1, fullSource, vectorCell([0.6, 0.8])]] });
        const prepared = await prepareDefault(h);
        expect(prepared.sourcePreview).to.equal(fullSource.slice(0, 160) + "…");
        expect(prepared.sourcePreviewTruncated).to.equal(true);
        expect(prepared.descriptor?.textChars).to.equal(fullSource.length);
        expect(prepared.generatedSql).to.equal(
            buildReembedSql(fullSource, "VectorLabEmbeddingModel"),
        );
    });

    test("model selection is opaque and preserves the probe's exact case-sensitive identity", async () => {
        const h = makeHarness();
        const state = await h.service.pipelineState();
        expect(state.models[0].id).to.match(/^vpm_/);
        const prepared = await h.service.reembedPrepare({
            ...PREPARE_DEFAULTS,
            modelId: state.models[0].id,
        });
        expect(prepared.descriptor?.model).to.equal("VectorLabEmbeddingModel");

        const unknown = await h.service.reembedPrepare({
            ...PREPARE_DEFAULTS,
            modelId: "vpm_forged",
        });
        expect(unknown.error).to.include("Refresh the catalog-verified");
    });

    test("refusals: expired handle, ordinal range, vector column as source, no stored vector, null source", async () => {
        const h = makeHarness({
            rows: [
                [1, SOURCE_TEXT, vectorCell([0.6, 0.8])],
                [2, SOURCE_TEXT, null], // no stored vector
                [3, null, vectorCell([0.6, 0.8])], // no source text
            ],
        });
        expect((await prepareDefault(h, { handle: "gone" })).error).to.include(
            "session has expired",
        );
        expect((await prepareDefault(h, { ordinal: 99 })).error).to.include("out of range");
        expect((await prepareDefault(h, { sourceColumnOrdinal: 2 })).error).to.include(
            "not the vector column",
        );
        expect((await prepareDefault(h, { ordinal: 1 })).error).to.include(
            "no analyzable stored vector",
        );
        expect((await prepareDefault(h, { ordinal: 2 })).error).to.include("no source text");
    });
});

// ---------------------------------------------------------------------------
// Token lifecycle + execution
// ---------------------------------------------------------------------------

suite("VectorPipelineService (VEC-10) — token lifecycle + execute", () => {
    test("wrong token: refused, no session acquired", async () => {
        const h = makeHarness();
        const executed = await h.service.reembedExecute("h1", "not-a-token");
        expect(executed.error).to.include("invalid, expired, or already used");
        expect(h.counters.auxAcquired).to.equal(0);
    });

    test("consumed consent emits exactly one value-free model.end for success and pre-SQL failures", async () => {
        const calls: Array<{ name: string; attrs: Record<string, unknown> }> = [];
        const original = Perf.marker;
        Perf.marker = ((name: string, _phase: string, attrs: Record<string, unknown>) => {
            calls.push({ name, attrs });
        }) as typeof Perf.marker;
        try {
            const success = makeHarness();
            const successPrepared = await prepareDefault(success);
            expect(
                (await success.service.reembedExecute("h1", successPrepared.confirmationToken!))
                    .comparison,
            ).not.to.equal(undefined);

            const unavailable = makeHarness({ auxAvailable: false });
            const unavailablePrepared = await prepareDefault(unavailable);
            expect(
                (
                    await unavailable.service.reembedExecute(
                        "h1",
                        unavailablePrepared.confirmationToken!,
                    )
                ).error,
            ).to.include("No auxiliary session");

            const throwing = makeHarness({ auxAcquireFailure: "model session factory failed" });
            const throwingPrepared = await prepareDefault(throwing);
            expect(
                (await throwing.service.reembedExecute("h1", throwingPrepared.confirmationToken!))
                    .error,
            ).to.include("factory failed");

            const markers = calls.filter(
                (call) => call.name === "mssql.queryResults.vector.model.end",
            );
            expect(markers).to.have.length(3);
            expect(markers.map((call) => call.attrs.outcome)).to.deep.equal([
                "ok",
                "error",
                "error",
            ]);
            for (const marker of markers) {
                expect(Object.keys(marker.attrs).sort()).to.deep.equal(["dims", "ms", "outcome"]);
                expect(JSON.stringify(marker.attrs)).not.to.include("VectorLab");
                expect(JSON.stringify(marker.attrs)).not.to.include("example.openai");
            }
        } finally {
            Perf.marker = original;
        }
    });

    test("same-session verification refuses case/endpoint drift before external egress", async () => {
        const changed = {
            ...defaultModel(),
            name: "vectorlabembeddingmodel",
            endpointHost: "different.example.com",
        };
        const h = makeHarness({ verificationModel: changed });
        const prepared = await prepareDefault(h);
        const executed = await h.service.reembedExecute("h1", prepared.confirmationToken!);
        expect(executed.error).to.include("identity or endpoint changed");
        expect(executed.modelStatementIssued).to.equal(false);
        expect(h.executed).to.have.length(0);
        expect(h.counters.queryStarted).to.equal(1);
        expect(h.counters.queryDisposed).to.equal(1);
    });

    test("happy path: displayed SQL == executed SQL; comparison hand-checked; lease disposed", async () => {
        const h = makeHarness({ modelResponse: "[0.8,0.6]" });
        const prepared = await prepareDefault(h);
        const executed = await h.service.reembedExecute("h1", prepared.confirmationToken!);
        expect(executed.error).to.equal(undefined);
        expect(executed.elapsedMs).to.be.a("number");
        expect(executed.modelStatementIssued).to.equal(true);
        expect(executed.modelEgress).to.equal("externalEgress");
        expect(executed.modelStatementCounts?.externalEgress).to.equal(1);
        expect(executed.runId).to.match(/^vpr_[A-Za-z0-9_-]{16}$/);
        expect(executed.context).to.include({ rowOrdinal: 0, sourceColumnOrdinal: 1 });
        expect(executed.context?.modelId).to.match(/^vpm_/);

        // The auxiliary "vectorModelCall" session ran EXACTLY the displayed SQL.
        expect(h.executed).to.have.length(1);
        expect(h.executed[0]).to.equal(prepared.generatedSql);
        expect(h.counters.auxAcquired).to.equal(1);
        expect(h.counters.auxDisposed).to.equal(1);
        expect(h.counters.queryStarted).to.equal(2); // identity verification + model call
        expect(h.counters.queryDisposed).to.equal(2); // every completed handle is disposed

        // stored ≈ [0.6, 0.8] (float32), fresh = [0.8, 0.6]:
        // dot ≈ 0.96 ⇒ cosine ≈ 0.04; distance ≈ √0.08; norms ≈ 1.
        const comparison = executed.comparison!;
        expect(comparison.cosine).to.be.closeTo(0.04, 1e-6);
        expect(comparison.euclidean).to.be.closeTo(Math.sqrt(0.08), 1e-6);
        expect(comparison.negativeDot).to.be.closeTo(-0.96, 1e-6);
        expect(comparison.normStored).to.be.closeTo(1, 1e-6);
        expect(comparison.normFresh).to.be.closeTo(1, 1e-6);
        expect(comparison.dimensions).to.equal(2);

        const restored = await h.service.reembedResult("h1", executed.runId!);
        expect(restored).to.deep.equal(executed);
        expect((await h.service.reembedResult("h1", "forged")).error).to.include("invalid");
    });

    test("consume-once: a token works exactly once, even when the call fails", async () => {
        const h = makeHarness({ modelResponse: "[0.8,0.6]" });
        const prepared = await prepareDefault(h);
        expect((await h.service.reembedExecute("h1", prepared.confirmationToken!)).comparison)
            .to.not //
            .equal(undefined);
        const replay = await h.service.reembedExecute("h1", prepared.confirmationToken!);
        expect(replay.error).to.include("invalid, expired, or already used");
        expect(h.counters.auxAcquired).to.equal(1); // replay never reached a session

        const failing = makeHarness({
            modelFailure: "Msg 42902: external endpoint refused the call.",
        });
        const preparedFailing = await prepareDefault(failing);
        const first = await failing.service.reembedExecute(
            "h1",
            preparedFailing.confirmationToken!,
        );
        expect(first.error).to.include("external endpoint refused");
        expect(first.modelStatementIssued).to.equal(true);
        expect(first.modelEgress).to.equal("externalEgress");
        expect(failing.counters.auxDisposed).to.equal(1); // lease released in finally
        const second = await failing.service.reembedExecute(
            "h1",
            preparedFailing.confirmationToken!,
        );
        expect(second.error).to.include("invalid, expired, or already used");
    });

    test("expiry: a token older than 2 minutes is refused without touching a session", async () => {
        const h = makeHarness();
        const prepared = await prepareDefault(h);
        h.advance(VECTOR_REEMBED_TOKEN_TTL_MS + 1);
        const executed = await h.service.reembedExecute("h1", prepared.confirmationToken!);
        expect(executed.error).to.include("invalid, expired, or already used");
        expect(h.counters.auxAcquired).to.equal(0);
    });

    test("re-mint replaces: a new confirmation for the same handle invalidates the previous token", async () => {
        const h = makeHarness({ modelResponse: "[0.8,0.6]" });
        const first = await prepareDefault(h);
        const second = await prepareDefault(h);
        expect(first.confirmationToken).to.not.equal(second.confirmationToken);
        expect((await h.service.reembedExecute("h1", first.confirmationToken!)).error).to.include(
            "invalid, expired, or already used",
        );
        expect(
            (await h.service.reembedExecute("h1", second.confirmationToken!)).comparison,
        ).to.not.equal(undefined);
    });

    test("token binds the exact opaque model identity across refresh", async () => {
        const models = [defaultModel()];
        const h = makeHarness({ models });
        const prepared = await prepareDefault(h);
        models[0] = { ...defaultModel(), modifyTime: "2026-07-12T00:00:00" };
        await h.service.pipelineState(true);
        const executed = await h.service.reembedExecute("h1", prepared.confirmationToken!);
        expect(executed.error).to.include("model changed");
        expect(h.counters.auxAcquired).to.equal(0);
    });

    test("handle-scoped cancel revokes only matching consent and settles active SQL", async () => {
        const pendingHarness = makeHarness();
        const pending = await prepareDefault(pendingHarness);
        await pendingHarness.service.cancel("other-handle");
        expect(
            (
                await pendingHarness.service.reembedExecute(
                    "wrong-handle",
                    pending.confirmationToken!,
                )
            ).error,
        ).to.include("invalid, expired, or already used");
        expect(
            (await pendingHarness.service.reembedExecute("h1", pending.confirmationToken!))
                .comparison,
        ).not.to.equal(undefined);

        const revoked = await prepareDefault(pendingHarness);
        await pendingHarness.service.cancel("h1");
        expect(
            (await pendingHarness.service.reembedExecute("h1", revoked.confirmationToken!)).error,
        ).to.include("invalid, expired, or already used");

        const activeHarness = makeHarness({ modelDelayMs: 250 });
        const active = await prepareDefault(activeHarness);
        const markerCalls: string[] = [];
        const originalMarker = Perf.marker;
        Perf.marker = ((name: string) => markerCalls.push(name)) as typeof Perf.marker;
        try {
            const executing = activeHarness.service.reembedExecute("h1", active.confirmationToken!);
            await activeHarness.modelStarted;
            await activeHarness.service.cancel("h1");
            const result = await executing;
            expect(result.error).to.include("cancelled");
            expect(activeHarness.counters.queryCanceled).to.equal(1);
            expect(activeHarness.counters.queryDisposed).to.equal(2);
            expect(activeHarness.counters.auxDisposed).to.equal(1);
            expect(
                markerCalls.filter((name) => name === "mssql.queryResults.vector.model.end"),
            ).to.have.length(1);
        } finally {
            Perf.marker = originalMarker;
        }
    });

    test("dimension mismatch: fresh vs stored dims refuse the comparison with both counts", async () => {
        const h = makeHarness({ modelResponse: "[1,2,3]" });
        const prepared = await prepareDefault(h);
        const executed = await h.service.reembedExecute("h1", prepared.confirmationToken!);
        expect(executed.comparison).to.equal(undefined);
        expect(executed.error).to.include("3 dimensions");
        expect(executed.error).to.include("2");
    });

    test("non-JSON model output and missing aux session are honest refusals", async () => {
        const garbage = makeHarness({ modelResponse: "oops not json" });
        const preparedGarbage = await prepareDefault(garbage);
        expect(
            (await garbage.service.reembedExecute("h1", preparedGarbage.confirmationToken!)).error,
        ).to.include("not valid JSON");

        const noAux = makeHarness({ auxAvailable: false });
        const preparedNoAux = await prepareDefault(noAux);
        const noAuxResult = await noAux.service.reembedExecute(
            "h1",
            preparedNoAux.confirmationToken!,
        );
        expect(noAuxResult.error).to.include("No auxiliary session");
        expect(noAuxResult.modelStatementIssued).to.equal(false);
    });

    test("suspend retains only two terminal comparisons and counters while revoking consent and bindings", async () => {
        const h = makeHarness({ modelResponse: "[0.8,0.6]" });
        const completed = [];
        for (let index = 0; index < 3; index++) {
            const prepared = await prepareDefault(h);
            completed.push(await h.service.reembedExecute("h1", prepared.confirmationToken!));
        }
        const state = await h.service.pipelineState();
        const pending = await h.service.reembedPrepare({
            ...PREPARE_DEFAULTS,
            modelId: state.models[0].id,
        });

        await h.service.suspendSensitiveState();

        expect((await h.service.reembedExecute("h1", pending.confirmationToken!)).error).to.include(
            "invalid, expired, or already used",
        );
        expect(
            (
                await h.service.reembedPrepare({
                    ...PREPARE_DEFAULTS,
                    modelId: state.models[0].id,
                })
            ).error,
        ).to.include("Refresh the catalog-verified");
        expect((await h.service.reembedResult("h1", completed[0].runId!)).error).to.include(
            "no longer available",
        );
        const restored = await h.service.reembedResult("h1", completed[2].runId!);
        expect(restored.runId).to.equal(completed[2].runId);
        expect(restored.comparison).to.deep.equal(completed[2].comparison);
        expect(restored.modelStatementCounts?.externalEgress).to.equal(3);

        const resumed = await h.service.pipelineState();
        expect(resumed.error).to.equal(undefined);
        expect(resumed.models).to.have.length(1);
        expect(resumed.models[0].id).to.equal(state.models[0].id);
        expect(resumed.modelStatementCounts.externalEgress).to.equal(3);
    });

    test("suspend settles active model SQL and leaves the service reusable", async () => {
        const h = makeHarness({ modelDelayMs: 250 });
        const prepared = await prepareDefault(h);
        const executing = h.service.reembedExecute("h1", prepared.confirmationToken!);
        await h.modelStarted;

        const issuedState = await h.service.pipelineState();
        expect(issuedState.modelStatementCounts.externalEgress).to.equal(1);

        const suspending = h.service.suspendSensitiveState();
        const reopenedState = await h.service.pipelineState();
        expect(reopenedState.modelStatementCounts.externalEgress).to.equal(1);
        await suspending;
        const result = await executing;

        expect(result.comparison).to.equal(undefined);
        expect(result.error).to.include("cancelled");
        expect(h.counters.queryCanceled).to.equal(1);
        expect(h.counters.queryDisposed).to.equal(2);
        expect(h.counters.auxDisposed).to.equal(1);
        const resumed = await h.service.pipelineState();
        expect(resumed.error).to.equal(undefined);
        expect(resumed.models).to.have.length(1);
        expect(resumed.modelStatementCounts.externalEgress).to.equal(1);
    });

    test("suspend invalidates in-flight catalog and source reads", async () => {
        const catalog = makeHarness({ capabilitiesDelayMs: 25 });
        const loading = catalog.service.pipelineState();
        await catalog.service.suspendSensitiveState();
        const staleState = await loading;
        expect(staleState.models).to.have.length(0);
        expect(staleState.error).to.include("pane was hidden");
        const freshState = await catalog.service.pipelineState();
        expect(freshState.models).to.have.length(1);

        const source = makeHarness({ windowDelayMs: 25 });
        const sourceState = await source.service.pipelineState();
        const preparing = source.service.reembedPrepare({
            ...PREPARE_DEFAULTS,
            modelId: sourceState.models[0].id,
        });
        await source.service.suspendSensitiveState();
        const stalePrepare = await preparing;
        expect(stalePrepare.confirmationToken).to.equal(undefined);
        expect(stalePrepare.generatedSql).to.equal(undefined);
        expect(stalePrepare.error).to.include("pane was hidden");
    });

    test("dispose cancels an active query, suppresses its result, and releases the lease once", async () => {
        const h = makeHarness({ modelDelayMs: 250 });
        const prepared = await prepareDefault(h);
        const executing = h.service.reembedExecute("h1", prepared.confirmationToken!);
        await h.modelStarted;

        h.service.dispose();
        const result = await executing;

        expect(result.comparison).to.equal(undefined);
        expect(result.error).to.include("cancelled");
        expect(h.counters.queryCanceled).to.equal(1);
        expect(h.counters.queryDisposed).to.equal(2);
        expect(h.counters.auxDisposed).to.equal(1);
    });

    test("dispose during auxiliary-session acquisition closes the late lease without executing", async () => {
        const h = makeHarness({ auxAcquireDelayMs: 25 });
        const prepared = await prepareDefault(h);
        const executing = h.service.reembedExecute("h1", prepared.confirmationToken!);

        h.service.dispose();
        const result = await executing;

        expect(result.error).to.include("cancelled");
        expect(h.counters.auxAcquired).to.equal(1);
        expect(h.counters.auxDisposed).to.equal(1);
        expect(h.counters.queryStarted).to.equal(0);
        expect(
            (await h.service.reembedPrepare({ ...PREPARE_DEFAULTS, modelId: "vpm_closed" })).error,
        ).to.include("closed");
    });
});

// ---------------------------------------------------------------------------
// chunkPreview RPC
// ---------------------------------------------------------------------------

suite("VectorPipelineService (VEC-10) — chunkPreview", () => {
    const CHUNK_DEFAULTS = { handle: "h1", ordinal: 0, sourceColumnOrdinal: 1 };

    test("local character math over the FULL source text (no SQL, no model, no aux session)", async () => {
        const h = makeHarness();
        const preview = await h.service.chunkPreview({
            ...CHUNK_DEFAULTS,
            chunkSize: 200,
            overlapPct: 0,
        });
        expect(preview.error).to.equal(undefined);
        expect(preview.totalChars).to.equal(SOURCE_TEXT.length);
        expect(preview.chunks).to.deep.equal(computeFixedChunks(SOURCE_TEXT, 200, 0).chunks);
        expect(h.counters.auxAcquired).to.equal(0);
        expect(h.executed).to.have.length(0);
    });

    test("range validation: size 200–2000, overlap 0–50, integers only", async () => {
        const h = makeHarness();
        const cases: Array<[number, number, string]> = [
            [150, 0, "Chunk size"],
            [2001, 0, "Chunk size"],
            [250.5, 0, "Chunk size"],
            [200, 51, "Overlap"],
            [200, -5, "Overlap"],
        ];
        for (const [chunkSize, overlapPct, fragment] of cases) {
            const preview = await h.service.chunkPreview({
                ...CHUNK_DEFAULTS,
                chunkSize,
                overlapPct,
            });
            expect(preview.error, `${chunkSize}/${overlapPct}`).to.include(fragment);
        }
    });

    test("truncated source refuses chunk math (offsets over a partial document lie)", async () => {
        const h = makeHarness({
            rows: [[1, { $t: "truncated", of: "string", bytes: 999, v: "prefix" }, null]],
        });
        const preview = await h.service.chunkPreview({
            ...CHUNK_DEFAULTS,
            chunkSize: 200,
            overlapPct: 0,
        });
        expect(preview.error).to.equal(TRUNCATED_CHUNK_REFUSAL);
    });

    test("expired handle refusal", async () => {
        const h = makeHarness();
        const preview = await h.service.chunkPreview({
            ...CHUNK_DEFAULTS,
            handle: "gone",
            chunkSize: 200,
            overlapPct: 0,
        });
        expect(preview.error).to.include("session has expired");
    });
});

// ---------------------------------------------------------------------------
// LIVE gated smoke (skip-not-fail; never print secrets)
// ---------------------------------------------------------------------------

interface LiveTarget {
    readonly server: string;
    readonly database?: string;
    readonly user?: string;
    readonly password?: string;
    readonly integrated: boolean;
}

function parseConnString(raw: string | undefined): LiveTarget | undefined {
    if (!raw) {
        return undefined;
    }
    const map = new Map<string, string>();
    for (const segment of raw.split(";")) {
        const idx = segment.indexOf("=");
        if (idx > 0) {
            map.set(segment.slice(0, idx).trim().toLowerCase(), segment.slice(idx + 1).trim());
        }
    }
    const server = map.get("data source") ?? map.get("server");
    if (!server) {
        return undefined;
    }
    const database = map.get("initial catalog") ?? map.get("database");
    const user = map.get("user id") ?? map.get("uid");
    const password = map.get("password") ?? map.get("pwd");
    return {
        server,
        ...(database ? { database } : {}),
        ...(user ? { user } : {}),
        ...(password ? { password } : {}),
        integrated: /^(true|sspi|yes)$/i.test(map.get("integrated security") ?? ""),
    };
}

let sqlcmdChecked: boolean | undefined;
function sqlcmdAvailable(): boolean {
    if (sqlcmdChecked === undefined) {
        try {
            cp.execFileSync("sqlcmd", ["-?"], { stdio: "pipe", timeout: 10_000 });
            sqlcmdChecked = true;
        } catch {
            sqlcmdChecked = false;
        }
    }
    return sqlcmdChecked;
}

/** Run one statement via sqlcmd; wide output (-y 0 / -w 65535) for long JSON. */
function runLiveSql(
    target: LiveTarget,
    database: string,
    sql: string,
): { ok: boolean; text: string } {
    const args = [
        "-S",
        target.server,
        "-d",
        database,
        "-I", // QUOTED_IDENTIFIER ON (required by the vector surface)
        // NOTE: -h -1 and -W are mutually exclusive with -y 0 on this sqlcmd;
        // headers stay on and callers extract sentinel-prefixed data lines.
        "-y",
        "0", // do not truncate long variable-length values
        "-w",
        "65535", // do not wrap long lines
        "-s",
        "|",
        "-l",
        "8",
        "-Q",
        `SET NOCOUNT ON; ${sql}`,
    ];
    if (target.integrated) {
        args.push("-E");
    } else {
        args.push("-U", target.user ?? "", "-P", target.password ?? "");
    }
    try {
        const out = cp.execFileSync("sqlcmd", args, {
            encoding: "utf8",
            timeout: 90_000,
            stdio: ["ignore", "pipe", "pipe"],
        });
        return { ok: !/^Msg \d+/m.test(out), text: out };
    } catch (error) {
        // NEVER surface error.message — it embeds the argv (credentials).
        const stdout = (error as { stdout?: unknown }).stdout;
        const text =
            typeof stdout === "string"
                ? stdout
                : Buffer.isBuffer(stdout)
                  ? stdout.toString("utf8")
                  : "sqlcmd execution failed";
        return { ok: false, text };
    }
}

/** Data rows are sentinel-prefixed (`SELECT N'ROW:' + …`) so headers,
 *  dash separators, and row-count footers can never be mistaken for data. */
function sentinelRows(text: string): string[] {
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("ROW:"))
        .map((line) => line.slice("ROW:".length));
}

/** First JSON-array line of the output (the embedding smoke runs the exact
 *  product SQL, unwrapped — its data line is the one starting with `[`). */
function firstJsonArrayLine(text: string): string | undefined {
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith("["));
}

suite("Vector pipeline — LIVE gated smoke (skip-not-fail)", function () {
    this.timeout(180_000);

    /** Shared gate: env var set, sqlcmd present, VectorLab reachable. */
    function liveTargetOrSkip(ctx: Mocha.Context): LiveTarget | undefined {
        const target = parseConnString(process.env.STS2_SQLSERVER_CONNSTRING);
        if (!target) {
            console.log("[vectorPipeline.live] SKIP: STS2_SQLSERVER_CONNSTRING not set");
            ctx.skip();
        }
        if (!sqlcmdAvailable()) {
            console.log("[vectorPipeline.live] SKIP: sqlcmd not available");
            ctx.skip();
        }
        const reachability = runLiveSql(
            target!,
            target!.database ?? "master",
            "SELECT N'ROW:' + CONVERT(nvarchar(1), CASE WHEN DB_ID(N'VectorLab') IS NULL THEN 0 ELSE 1 END);",
        );
        if (!reachability.ok) {
            console.log("[vectorPipeline.live] SKIP: server unreachable or query failed");
            ctx.skip();
        }
        if (sentinelRows(reachability.text)[0] !== "1") {
            console.log("[vectorPipeline.live] SKIP: VectorLab fixture database absent");
            ctx.skip();
        }
        return target;
    }

    test("ONE AI_GENERATE_EMBEDDINGS call: 1536-D, strictly parseable, unit-norm ±0.01", function () {
        const target = liveTargetOrSkip(this);
        const modelCheck = runLiveSql(
            target!,
            "VectorLab",
            "SELECT N'ROW:' + CONVERT(nvarchar(10), COUNT(*)) FROM sys.external_models WHERE name = N'VectorLabEmbeddingModel' AND model_type_desc = N'EMBEDDINGS';",
        );
        if (!modelCheck.ok || sentinelRows(modelCheck.text)[0] !== "1") {
            console.log("[vectorPipeline.live] SKIP: VectorLabEmbeddingModel not configured");
            this.skip();
        }

        // The one live model call of this suite — the same statement shape the
        // service generates (displayed == executed), against a literal string.
        const sql = buildReembedSql(
            "vector workbench pipeline smoke: prorated refunds apply within 30 days of renewal",
            "VectorLabEmbeddingModel",
        );
        const startedAt = Date.now();
        const call = runLiveSql(target!, "VectorLab", sql);
        const elapsedMs = Date.now() - startedAt;
        expect(call.ok, call.text.slice(0, 500)).to.equal(true);
        const jsonText = firstJsonArrayLine(call.text);
        expect(jsonText, "expected one JSON line from the model call").to.be.a("string");

        const parsed = parseFreshVectorJson(jsonText);
        expect(parsed.error, parsed.error).to.equal(undefined);
        expect(parsed.values).to.have.length(1536);
        let normSq = 0;
        for (const component of parsed.values!) {
            expect(Number.isFinite(component)).to.equal(true);
            normSq += component * component;
        }
        const norm = Math.sqrt(normSq);
        expect(norm).to.be.closeTo(1, 0.01);
        console.log(
            `[vectorPipeline.live] AI_GENERATE_EMBEDDINGS ok: 1536-D, L2 norm ${norm.toFixed(6)}, ${elapsedMs} ms (single observation)`,
        );
    });

    test("AI_GENERATE_CHUNKS acceptance probe (TRY/CATCH over sp_executesql; outcome recorded honestly)", function () {
        const target = liveTargetOrSkip(this);
        // Dynamic SQL makes a parse rejection catchable; a bare batch parse
        // error would kill the whole batch before TRY/CATCH could run.
        const probe = [
            "DECLARE @outcome nvarchar(400);",
            "BEGIN TRY",
            "    DECLARE @n int;",
            "    EXEC sp_executesql",
            "        N'DECLARE @src nvarchar(max) = REPLICATE(CONVERT(nvarchar(max), N''a''), 1000);",
            "          SELECT @n = COUNT(*) FROM AI_GENERATE_CHUNKS(SOURCE = @src, CHUNK_TYPE = FIXED, CHUNK_SIZE = 300, OVERLAP = 10);',",
            "        N'@n int OUTPUT', @n = @n OUTPUT;",
            "    SET @outcome = N'CHUNKS_OK:' + CONVERT(nvarchar(20), @n);",
            "END TRY",
            "BEGIN CATCH",
            "    SET @outcome = N'CHUNKS_ERR:' + ERROR_MESSAGE();",
            "END CATCH",
            "SELECT N'ROW:' + @outcome;",
        ].join("\n");
        const result = runLiveSql(target!, "VectorLab", probe);
        expect(result.ok, result.text.slice(0, 500)).to.equal(true);
        const outcome = sentinelRows(result.text)[0] ?? "";
        expect(outcome, "probe must produce an outcome line").to.match(/^CHUNKS_(OK|ERR):/);
        if (outcome.startsWith("CHUNKS_OK:")) {
            const serverCount = Number(outcome.slice("CHUNKS_OK:".length));
            expect(serverCount).to.be.at.least(1);
            const localCount = computeFixedChunks("a".repeat(1000), 300, 10).chunks.length;
            // Server semantics are the server's own — recorded, not asserted.
            console.log(
                `[vectorPipeline.live] AI_GENERATE_CHUNKS ACCEPTED: server ${serverCount} chunks vs local character math ${localCount} (1000 chars, size 300, overlap 10%)`,
            );
        } else {
            console.log(
                `[vectorPipeline.live] AI_GENERATE_CHUNKS NOT ACCEPTED on this engine: ${outcome.slice(0, 300)}`,
            );
        }
    });
});
