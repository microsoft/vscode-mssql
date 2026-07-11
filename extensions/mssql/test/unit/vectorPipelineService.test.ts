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
    VECTOR_SERVER_SIDE_CLAIM,
} from "../../src/sharedInterfaces/vectorPipeline";
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
function fakeStore(columns: string[], rows: unknown[][]): IQueryResultStore {
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
        getWindow: async (req) => ({
            resultSetId: req.resultSetId,
            start: req.rowStart,
            rowCount: 1,
            columns: [],
            values: [
                (req.columnOrdinals ?? []).map((ordinal) => rows[req.rowStart]?.[ordinal] ?? null),
            ],
        }),

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
    auxAvailable?: boolean;
}

function makeHarness(options: HarnessOptions = {}) {
    const columns = options.columns ?? ["id", "chunk_text", "embedding"];
    const rows = options.rows ?? [[1, SOURCE_TEXT, vectorCell([0.6, 0.8])]];
    const store = fakeStore(columns, rows);
    const models = options.models ?? [defaultModel()];
    const executed: string[] = [];
    const counters = { auxAcquired: 0, auxDisposed: 0 };
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
                  },
                  { type: "complete", status: "succeeded" },
              ];
        return {
            match: (text) => {
                executed.push(text);
                return text.includes("AI_GENERATE_EMBEDDINGS");
            },
            events,
        };
    };

    const thunks: VectorPipelineThunks = {
        auxModelSession: async () => {
            if (options.auxAvailable === false) {
                return undefined;
            }
            counters.auxAcquired++;
            const backend = new FakeBackend({ scripts: [modelScript()] });
            const session: ISqlSession = await backend.openSession({
                profile: { profileFingerprint: "fp", server: "srv", authKind: "integrated" },
                applicationName: "test-vector-model-call",
            });
            return {
                session,
                dispose: () => {
                    counters.auxDisposed++;
                    void session.close();
                },
            };
        },
        capabilities: async () =>
            options.capabilitiesError
                ? { error: options.capabilitiesError }
                : { probe: fakeProbe(models, options.compat ?? 170) },
        workbench: (handle) =>
            handle === "h1" ? { store, resultSetId: "rs1", vectorColumnOrdinal: 2 } : undefined,
    };
    const service = new VectorPipelineService(thunks, () => nowMs);
    return {
        service,
        executed,
        counters,
        advance: (ms: number) => {
            nowMs += ms;
        },
    };
}

const PREPARE_DEFAULTS = {
    handle: "h1",
    ordinal: 0,
    sourceColumnOrdinal: 1,
    modelName: "VectorLabEmbeddingModel",
};

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
        const prepared = await h.service.reembedPrepare(PREPARE_DEFAULTS);
        expect(prepared.error).to.equal(undefined);
        expect(prepared.confirmationToken).to.be.a("string").with.length.greaterThan(20);
        expect(prepared.tokenExpiresEpochMs).to.equal(1_000_000 + VECTOR_REEMBED_TOKEN_TTL_MS);
        expect(prepared.storedDimensions).to.equal(2);
        expect(prepared.sourcePreview).to.equal(SOURCE_TEXT); // short text: no ellipsis

        const d = prepared.descriptor!;
        expect(d.model).to.equal("VectorLabEmbeddingModel");
        expect(d.owner).to.equal("dbo"); // owner principal, never a schema prefix
        expect(d.modelType).to.equal("EMBEDDINGS");
        expect(d.apiFormat).to.equal("Azure OpenAI");
        expect(d.endpointHost).to.equal("example.openai.azure.com");
        expect(d.egress).to.equal("externalEgress");
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
        const prepared = await h.service.reembedPrepare(PREPARE_DEFAULTS);
        expect(prepared.error).to.equal(TRUNCATED_SOURCE_REFUSAL);
        expect(prepared.confirmationToken).to.equal(undefined);
        expect(prepared.generatedSql).to.equal(undefined);
    });

    test("model is host-resolved against the probe (case-insensitive; probe casing wins; EMBEDDINGS only)", async () => {
        const h = makeHarness();
        const prepared = await h.service.reembedPrepare({
            ...PREPARE_DEFAULTS,
            modelName: "vectorlabembeddingmodel",
        });
        expect(prepared.descriptor?.model).to.equal("VectorLabEmbeddingModel");

        const unknown = await h.service.reembedPrepare({
            ...PREPARE_DEFAULTS,
            modelName: "NoSuchModel",
        });
        expect(unknown.error).to.include("not an EMBEDDINGS external model");
    });

    test("refusals: expired handle, ordinal range, vector column as source, no stored vector, null source", async () => {
        const h = makeHarness({
            rows: [
                [1, SOURCE_TEXT, vectorCell([0.6, 0.8])],
                [2, SOURCE_TEXT, null], // no stored vector
                [3, null, vectorCell([0.6, 0.8])], // no source text
            ],
        });
        expect(
            (await h.service.reembedPrepare({ ...PREPARE_DEFAULTS, handle: "gone" })).error,
        ).to.include("session has expired");
        expect(
            (await h.service.reembedPrepare({ ...PREPARE_DEFAULTS, ordinal: 99 })).error,
        ).to.include("out of range");
        expect(
            (await h.service.reembedPrepare({ ...PREPARE_DEFAULTS, sourceColumnOrdinal: 2 })).error,
        ).to.include("not the vector column");
        expect(
            (await h.service.reembedPrepare({ ...PREPARE_DEFAULTS, ordinal: 1 })).error,
        ).to.include("no analyzable stored vector");
        expect(
            (await h.service.reembedPrepare({ ...PREPARE_DEFAULTS, ordinal: 2 })).error,
        ).to.include("no source text");
    });
});

// ---------------------------------------------------------------------------
// Token lifecycle + execution
// ---------------------------------------------------------------------------

suite("VectorPipelineService (VEC-10) — token lifecycle + execute", () => {
    test("wrong token: refused, no session acquired", async () => {
        const h = makeHarness();
        const executed = await h.service.reembedExecute("not-a-token");
        expect(executed.error).to.include("invalid, expired, or already used");
        expect(h.counters.auxAcquired).to.equal(0);
    });

    test("happy path: displayed SQL == executed SQL; comparison hand-checked; lease disposed", async () => {
        const h = makeHarness({ modelResponse: "[0.8,0.6]" });
        const prepared = await h.service.reembedPrepare(PREPARE_DEFAULTS);
        const executed = await h.service.reembedExecute(prepared.confirmationToken!);
        expect(executed.error).to.equal(undefined);
        expect(executed.elapsedMs).to.be.a("number");

        // The auxiliary "vectorModelCall" session ran EXACTLY the displayed SQL.
        expect(h.executed).to.have.length(1);
        expect(h.executed[0]).to.equal(prepared.generatedSql);
        expect(h.counters.auxAcquired).to.equal(1);
        expect(h.counters.auxDisposed).to.equal(1);

        // stored ≈ [0.6, 0.8] (float32), fresh = [0.8, 0.6]:
        // dot ≈ 0.96 ⇒ cosine ≈ 0.04; distance ≈ √0.08; norms ≈ 1.
        const comparison = executed.comparison!;
        expect(comparison.cosine).to.be.closeTo(0.04, 1e-6);
        expect(comparison.euclidean).to.be.closeTo(Math.sqrt(0.08), 1e-6);
        expect(comparison.negativeDot).to.be.closeTo(-0.96, 1e-6);
        expect(comparison.normStored).to.be.closeTo(1, 1e-6);
        expect(comparison.normFresh).to.be.closeTo(1, 1e-6);
        expect(comparison.dimensions).to.equal(2);
    });

    test("consume-once: a token works exactly once, even when the call fails", async () => {
        const h = makeHarness({ modelResponse: "[0.8,0.6]" });
        const prepared = await h.service.reembedPrepare(PREPARE_DEFAULTS);
        expect((await h.service.reembedExecute(prepared.confirmationToken!)).comparison)
            .to.not //
            .equal(undefined);
        const replay = await h.service.reembedExecute(prepared.confirmationToken!);
        expect(replay.error).to.include("invalid, expired, or already used");
        expect(h.counters.auxAcquired).to.equal(1); // replay never reached a session

        const failing = makeHarness({
            modelFailure: "Msg 42902: external endpoint refused the call.",
        });
        const preparedFailing = await failing.service.reembedPrepare(PREPARE_DEFAULTS);
        const first = await failing.service.reembedExecute(preparedFailing.confirmationToken!);
        expect(first.error).to.include("external endpoint refused");
        expect(failing.counters.auxDisposed).to.equal(1); // lease released in finally
        const second = await failing.service.reembedExecute(preparedFailing.confirmationToken!);
        expect(second.error).to.include("invalid, expired, or already used");
    });

    test("expiry: a token older than 2 minutes is refused without touching a session", async () => {
        const h = makeHarness();
        const prepared = await h.service.reembedPrepare(PREPARE_DEFAULTS);
        h.advance(VECTOR_REEMBED_TOKEN_TTL_MS + 1);
        const executed = await h.service.reembedExecute(prepared.confirmationToken!);
        expect(executed.error).to.include("invalid, expired, or already used");
        expect(h.counters.auxAcquired).to.equal(0);
    });

    test("re-mint replaces: a new confirmation for the same handle invalidates the previous token", async () => {
        const h = makeHarness({ modelResponse: "[0.8,0.6]" });
        const first = await h.service.reembedPrepare(PREPARE_DEFAULTS);
        const second = await h.service.reembedPrepare(PREPARE_DEFAULTS);
        expect(first.confirmationToken).to.not.equal(second.confirmationToken);
        expect((await h.service.reembedExecute(first.confirmationToken!)).error).to.include(
            "invalid, expired, or already used",
        );
        expect((await h.service.reembedExecute(second.confirmationToken!)).comparison).to.not.equal(
            undefined,
        );
    });

    test("dimension mismatch: fresh vs stored dims refuse the comparison with both counts", async () => {
        const h = makeHarness({ modelResponse: "[1,2,3]" });
        const prepared = await h.service.reembedPrepare(PREPARE_DEFAULTS);
        const executed = await h.service.reembedExecute(prepared.confirmationToken!);
        expect(executed.comparison).to.equal(undefined);
        expect(executed.error).to.include("3 dimensions");
        expect(executed.error).to.include("2");
    });

    test("non-JSON model output and missing aux session are honest refusals", async () => {
        const garbage = makeHarness({ modelResponse: "oops not json" });
        const preparedGarbage = await garbage.service.reembedPrepare(PREPARE_DEFAULTS);
        expect(
            (await garbage.service.reembedExecute(preparedGarbage.confirmationToken!)).error,
        ).to.include("not valid JSON");

        const noAux = makeHarness({ auxAvailable: false });
        const preparedNoAux = await noAux.service.reembedPrepare(PREPARE_DEFAULTS);
        expect(
            (await noAux.service.reembedExecute(preparedNoAux.confirmationToken!)).error,
        ).to.include("No auxiliary session");
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
