/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * VectorPipelineService (VEC-10): the host side of the Pipeline workspace —
 * pipeline state (provenance inputs from the VEC-7 probe), the HOST-MINTED
 * re-embed confirmation flow, token-gated model-call execution on an
 * auxiliary "vectorModelCall" session, and the local chunk-debugger math.
 *
 * Consent is structural, not stylistic: `reembedPrepare` fetches the FULL
 * source text (never a truncated grid prefix — a truncated cell is a hard
 * refusal), builds the exact SQL that would run, and mints a single-use
 * confirmation token with a 2-minute TTL. `reembedExecute` accepts only that
 * token, consumes it BEFORE executing (single-use even on failure), and runs
 * the stored SQL verbatim — displayed == executed, always.
 *
 * Comparison math is local float64: the stored vector is decoded from the
 * result store via the shared cell codec at prepare time (held host-side,
 * never sent anywhere); the fresh vector arrives as JSON text from the
 * executed SELECT and is parsed STRICTLY (array of finite numbers, nothing
 * else). Dimensions must match or the comparison is refused with both counts.
 *
 * Privacy (binding): this module emits NO telemetry markers — no registered
 * vocabulary exists for model calls yet, and nothing here may improvise one.
 * Errors surface to the panel as result data; source text, vectors, SQL
 * text, and endpoint secrets never reach logs. The endpoint HOST appears
 * only in the confirmation descriptor (allowed UI fact, P0-5/A4).
 */

import * as crypto from "crypto";
import { Perf } from "../../perf/perfTelemetry";
import { IQueryEventSink, ISqlSession, QueryHandle } from "../../services/sqlDataPlane/api";
import { decodeVectorFloat32 } from "../../sharedInterfaces/queryResultCellCodec";
import {
    cellTextForPurpose,
    isTruncatedCellMarker,
} from "../../sharedInterfaces/queryStudioGridOps";
import {
    QsVectorCapabilitiesResult,
    VectorExternalModelProbeRow,
    VectorModelEgressClass,
} from "../../sharedInterfaces/vectorCatalog";
import {
    QsVectorChunkPreviewParams,
    QsVectorChunkPreviewResult,
    QsVectorPipelineStateResult,
    QsVectorReembedExecuteResult,
    QsVectorReembedPrepareParams,
    QsVectorReembedPrepareResult,
    VECTOR_CHUNK_OVERLAP_MAX,
    VECTOR_CHUNK_OVERLAP_MIN,
    VECTOR_CHUNK_PREVIEW_CHARS,
    VECTOR_CHUNK_PREVIEW_MAX_CHUNKS,
    VECTOR_CHUNK_SIZE_MAX,
    VECTOR_CHUNK_SIZE_MIN,
    VECTOR_REEMBED_TOKEN_TTL_MS,
    VECTOR_REEMBED_SOURCE_MAX_CHARS,
    VECTOR_REEMBED_SOURCE_MAX_UTF8_BYTES,
    VECTOR_SERVER_SIDE_CLAIM,
    VECTOR_SOURCE_PREVIEW_CHARS,
    VectorChunkPreviewEntry,
    VectorPipelineModel,
    VectorReembedComparison,
    VectorReembedDescriptor,
} from "../../sharedInterfaces/vectorPipeline";
import { IQueryResultStore } from "../queryResultTypes";
import { AuxiliarySessionLease } from "./vectorCapabilityService";
import { VectorModelStatementCounter } from "./vectorModelStatementCounter";

export const VECTOR_MODEL_CALL_TAG = "queryStudio:vectorModelCall";

/** Refusal text for a truncated source cell (exact, tested verbatim). */
export const TRUNCATED_SOURCE_REFUSAL =
    "Source text is truncated in the result — cannot send a partial document to the model.";

/** Refusal text when chunk math would run over a partial document. */
export const TRUNCATED_CHUNK_REFUSAL =
    "Source text is truncated in the result — chunk offsets over a partial document would be wrong.";

const PIPELINE_CLOSED_REFUSAL = "The Vector Pipeline session has closed.";
const MODEL_CALL_CANCELLED = "The model call was cancelled.";
const PIPELINE_SUSPENDED_REFUSAL =
    "The Vector Pipeline request was cancelled because the pane was hidden.";
const MAX_RETAINED_MODEL_IDS = 256;

// ---------------------------------------------------------------------------
// Thunks (the controller supplies all authority; the service owns policy)
// ---------------------------------------------------------------------------

/** Facts about one open Vector analysis session (host-resolved by handle). */
export interface VectorPipelineWorkbenchSessionFacts {
    readonly store: IQueryResultStore;
    readonly resultSetId: string;
    /** Vector column ordinal the analysis session was opened on. */
    readonly vectorColumnOrdinal: number;
    /** Releases the workbench's scoped result-store operation lease. */
    readonly release?: () => void;
    /** False once the originating analysis handle has closed. */
    readonly isActive?: () => boolean;
}

export interface VectorPipelineThunks {
    /** DocumentSessionBinding.acquireAuxiliarySession("vectorModelCall"). */
    auxModelSession(): Promise<AuxiliarySessionLease | undefined>;
    /** VectorCapabilityService.capabilities(refresh) — probe facts. */
    capabilities(refresh?: boolean): Promise<QsVectorCapabilitiesResult>;
    /** Resolve an open workbench analysis session; undefined = expired. */
    workbench(handle: string): VectorPipelineWorkbenchSessionFacts | undefined;
    /** Controller-owned so hidden-service recreation cannot erase statement history. */
    readonly modelStatements?: VectorModelStatementCounter;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests — no I/O, no state)
// ---------------------------------------------------------------------------

/** Double single quotes for an N'…' literal. */
export function escapeNString(text: string): string {
    return text.replace(/'/g, "''");
}

/** QUOTENAME: bracket-escape one T-SQL identifier part (`]` doubles). */
export function quoteSqlIdentifier(name: string): string {
    return `[${name.replace(/]/g, "]]")}]`;
}

/**
 * The exact re-embed statement — the string that is BOTH displayed by "View
 * generated T-SQL" and executed by reembedExecute. The model name is the
 * PROBE's name (host-resolved), QUOTENAME-escaped; the source text rides an
 * N'…' literal with doubled quotes (values never concatenate unescaped).
 */
export function buildReembedSql(sourceText: string, modelName: string): string {
    return [
        `DECLARE @t nvarchar(max) = N'${escapeNString(sourceText)}';`,
        `SELECT CAST(AI_GENERATE_EMBEDDINGS(@t USE MODEL ${quoteSqlIdentifier(modelName)}) AS nvarchar(max)) AS fresh;`,
    ].join("\n");
}

/** Catalog row used to re-resolve an opaque model immediately before egress. */
export function buildPipelineModelVerificationSql(modelName: string): string {
    return [
        "SELECT TOP (2)",
        "    CONVERT(nvarchar(128), m.name),",
        "    CONVERT(nvarchar(128), USER_NAME(m.principal_id)),",
        "    CONVERT(nvarchar(64), m.api_format),",
        "    CONVERT(nvarchar(64), m.model_type_desc),",
        "    CONVERT(nvarchar(256), m.model),",
        "    CONVERT(nvarchar(1024), m.location),",
        "    CONVERT(nvarchar(64), m.modify_time, 126)",
        "FROM sys.external_models m",
        `WHERE CONVERT(varbinary(512), m.name) = CONVERT(varbinary(512), N'${escapeNString(modelName)}')`,
        "  AND CONVERT(varbinary(512), m.model_type_desc) = CONVERT(varbinary(512), N'EMBEDDINGS');",
    ].join("\n");
}

function modelIdentity(row: VectorExternalModelProbeRow): string {
    return JSON.stringify([
        row.name,
        row.owner,
        row.apiFormat,
        row.modelType,
        row.providerModel,
        row.endpointHost,
        row.modifyTime,
        row.egress,
    ]);
}

function modelIdentityDigest(row: VectorExternalModelProbeRow, key: Buffer): string {
    return crypto.createHmac("sha256", key).update(modelIdentity(row)).digest("base64url");
}

function endpointHost(location: string | undefined): string | undefined {
    if (!location) return undefined;
    try {
        return new URL(location).hostname || undefined;
    } catch {
        return undefined;
    }
}

/**
 * Upper-bound payload estimate in KiB: 2 bytes per character (UTF-16 bound —
 * honest "approx", matches the mock's 842 chars → 1.7 KiB), rounded UP to
 * 0.1 KiB, floored at 0.1 KiB.
 */
export function estimatePayloadKiB(textChars: number): number {
    return Math.max(0.1, Math.ceil(((textChars * 2) / 1024) * 10) / 10);
}

/** Egress-truthful "Execution" line for the confirmation dialog (A4/P0-5). */
export function executionCopyForEgress(egress: VectorModelEgressClass): string {
    switch (egress) {
        case "externalEgress":
            return "SQL Server calls the external endpoint via AI_GENERATE_EMBEDDINGS";
        case "hostLocal":
            return "SQL Server calls the host-local endpoint via AI_GENERATE_EMBEDDINGS";
        case "inProcess":
            return "SQL Server runs the local ONNX runtime via AI_GENERATE_EMBEDDINGS — no network egress";
        case "unknown":
            return "SQL Server executes AI_GENERATE_EMBEDDINGS against an unclassified API format";
    }
}

export interface VectorChunkComputation {
    readonly chunks: readonly VectorChunkPreviewEntry[];
    readonly totalChars: number;
    readonly chunkListTruncated: boolean;
}

/**
 * Fixed-size character chunking with percentage overlap — LOCAL math only
 * (the chunk debugger never runs SQL and never calls a model):
 * - `overlapChars = floor(chunkSize * overlapPct / 100)`; adjacent chunks
 *   share that many characters (stride = chunkSize − overlapChars).
 * - Emission stops once a chunk reaches the end of the text — no degenerate
 *   tail chunk fully contained in its predecessor.
 * - Text shorter than one chunk yields exactly one chunk of the full text.
 * - Preview text is bounded to VECTOR_CHUNK_PREVIEW_CHARS characters.
 */
export function computeFixedChunks(
    text: string,
    chunkSize: number,
    overlapPct: number,
): VectorChunkComputation {
    const totalChars = text.length;
    const chunks: VectorChunkPreviewEntry[] = [];
    if (totalChars === 0) {
        return { chunks, totalChars, chunkListTruncated: false };
    }
    const overlap = Math.floor((chunkSize * overlapPct) / 100);
    const stride = Math.max(1, chunkSize - overlap);
    let truncated = false;
    let start = 0;
    for (let index = 0; ; index++) {
        if (index >= VECTOR_CHUNK_PREVIEW_MAX_CHUNKS) {
            truncated = true;
            break;
        }
        const end = Math.min(start + chunkSize, totalChars);
        const chars = end - start;
        const previousEnd =
            index === 0 ? 0 : chunks[index - 1].startOffset + chunks[index - 1].chars;
        const overlapChars = index === 0 ? 0 : Math.min(previousEnd - start, chars);
        chunks.push({
            index,
            startOffset: start,
            chars,
            overlapChars,
            previewText: text.slice(start, Math.min(end, start + VECTOR_CHUNK_PREVIEW_CHARS)),
        });
        if (end >= totalChars) {
            break;
        }
        start += stride;
    }
    return { chunks, totalChars, chunkListTruncated: truncated };
}

/**
 * STRICT parse of the fresh embedding's JSON text: a JSON array in which
 * every element is a finite number — anything else is a refusal, never a
 * silent coercion (NaN/Infinity are invalid JSON and fail parse; null holes
 * fail the element check).
 */
export function parseFreshVectorJson(text: string): {
    readonly values?: readonly number[];
    readonly error?: string;
} {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { error: "The model returned text that is not valid JSON." };
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
        return { error: "The model returned JSON that is not a non-empty array." };
    }
    for (const element of parsed) {
        if (typeof element !== "number" || !Number.isFinite(element)) {
            return {
                error: "The model returned an array with non-finite or non-numeric components.",
            };
        }
    }
    return { values: parsed as number[] };
}

/**
 * Stored-vs-fresh comparison in float64. Caller guarantees equal lengths.
 * Zero-norm cosine is UNDEFINED (null), never coerced to 0 or 1 — the same
 * discipline as vectorCompareMath.
 */
export function compareStoredVsFresh(
    stored: ArrayLike<number>,
    fresh: ArrayLike<number>,
): VectorReembedComparison {
    const dimensions = stored.length;
    let dot = 0;
    let distSq = 0;
    let normStoredSq = 0;
    let normFreshSq = 0;
    for (let d = 0; d < dimensions; d++) {
        const a = stored[d];
        const b = fresh[d];
        dot += a * b;
        const diff = a - b;
        distSq += diff * diff;
        normStoredSq += a * a;
        normFreshSq += b * b;
    }
    const normStored = Math.sqrt(normStoredSq);
    const normFresh = Math.sqrt(normFreshSq);
    const cosine = normStored > 0 && normFresh > 0 ? 1 - dot / (normStored * normFresh) : null;
    return {
        cosine,
        euclidean: Math.sqrt(distSq),
        negativeDot: -dot,
        normStored,
        normFresh,
        dimensions,
    };
}

// ---------------------------------------------------------------------------
// Tolerant SQL execution on the auxiliary session (probe idiom)
// ---------------------------------------------------------------------------

interface ModelCallOutcome {
    readonly rows: unknown[][];
    readonly errors: string[];
    /** True only after session.execute returned a handle for this statement. */
    readonly issued: boolean;
    /** Set when the statement did not succeed. */
    readonly failed?: string;
}

/** Bound a server message so a giant error can never bloat the result. */
const bounded = (text: string): string => (text.length > 500 ? `${text.slice(0, 500)}…` : text);

/** Bounded busy retry (executionOrchestrator.executeWhenFree recipe). */
async function executeWhenFree(
    session: ISqlSession,
    text: string,
    sink: IQueryEventSink,
    signal?: AbortSignal,
    deadlineMs = 5_000,
): Promise<QueryHandle> {
    const startedAt = Date.now();
    for (;;) {
        if (signal?.aborted) {
            throw new Error(MODEL_CALL_CANCELLED);
        }
        try {
            return session.execute(
                text,
                {
                    priority: "interactive",
                    commandKind: "user",
                    tag: VECTOR_MODEL_CALL_TAG,
                    timeoutMs: 120_000,
                },
                sink,
            );
        } catch (error) {
            const busy =
                (error as { code?: string }).code === "SqlDataPlane.Busy" &&
                Date.now() - startedAt < deadlineMs;
            if (!busy) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 40));
        }
    }
}

async function runModelCall(
    session: ISqlSession,
    sql: string,
    control: {
        signal: AbortSignal;
        onHandle(handle: QueryHandle): void;
        onSettled(handle: QueryHandle): Promise<void>;
    },
): Promise<ModelCallOutcome> {
    const rows: unknown[][] = [];
    const errors: string[] = [];
    let issued = false;
    try {
        const sink: IQueryEventSink = {
            onResultSetStarted: () => undefined,
            onRowsPage: (page) => {
                rows.push(...page.compact.values);
            },
            onMessage: (message) => {
                if (message.kind === "error") {
                    errors.push(message.text);
                }
            },
            onComplete: () => undefined,
        };
        const handle = await executeWhenFree(session, sql, sink, control.signal);
        issued = true;
        control.onHandle(handle);
        try {
            if (control.signal.aborted) {
                return { rows, errors, issued, failed: MODEL_CALL_CANCELLED };
            }
            const summary = await handle.completion;
            if (control.signal.aborted) {
                return { rows, errors, issued, failed: MODEL_CALL_CANCELLED };
            }
            if (summary.status !== "succeeded") {
                return {
                    rows,
                    errors,
                    issued,
                    failed: errors[0] ?? `model call ${summary.status}`,
                };
            }
            return { rows, errors, issued };
        } finally {
            await control.onSettled(handle);
        }
    } catch (error) {
        return {
            rows,
            errors,
            issued,
            failed: error instanceof Error ? error.message : String(error),
        };
    }
}

function verifiedModelMatches(
    outcome: ModelCallOutcome,
    expected: VectorExternalModelProbeRow,
): boolean {
    if (outcome.failed || outcome.rows.length !== 1) return false;
    const row = outcome.rows[0];
    const text = (index: number): string | undefined => {
        const value = row[index];
        return value === null || value === undefined ? undefined : String(value);
    };
    return (
        text(0) === expected.name &&
        text(1) === expected.owner &&
        text(2) === expected.apiFormat &&
        text(3) === "EMBEDDINGS" &&
        text(3) === expected.modelType &&
        text(4) === expected.providerModel &&
        endpointHost(text(5)) === expected.endpointHost &&
        text(6) === expected.modifyTime
    );
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

interface PendingReembed {
    readonly handle: string;
    readonly modelId: string;
    readonly model: VectorExternalModelProbeRow;
    readonly modelIdentity: string;
    readonly resultSetId: string;
    readonly vectorColumnOrdinal: number;
    readonly rowOrdinal: number;
    readonly sourceColumnOrdinal: number;
    readonly sql: string;
    readonly descriptor: VectorReembedDescriptor;
    /** Decoded stored vector, held HOST-SIDE only for the comparison. */
    readonly stored: Float32Array;
    readonly expiresAtMs: number;
}

interface ActiveModelCall {
    readonly ownerHandle: string;
    readonly abortController: AbortController;
    readonly done: Promise<void>;
    readonly settleDone: () => void;
    lease?: AuxiliarySessionLease;
    handle?: QueryHandle;
    queryStop?: Promise<void>;
    leaseReleased: boolean;
}

interface CompletedPipelineResult {
    readonly resultSetId: string;
    readonly vectorColumnOrdinal: number;
    /** Explicit metadata allowlist: never retain source text, SQL, vectors, or consent state. */
    readonly result: QsVectorReembedExecuteResult;
}

function retainCompletedResult(result: QsVectorReembedExecuteResult): QsVectorReembedExecuteResult {
    return {
        ...(result.runId !== undefined ? { runId: result.runId } : {}),
        ...(result.comparison !== undefined ? { comparison: { ...result.comparison } } : {}),
        ...(result.context !== undefined ? { context: { ...result.context } } : {}),
        ...(result.elapsedMs !== undefined ? { elapsedMs: result.elapsedMs } : {}),
        ...(result.modelStatementIssued !== undefined
            ? { modelStatementIssued: result.modelStatementIssued }
            : {}),
        ...(result.modelEgress !== undefined ? { modelEgress: result.modelEgress } : {}),
        ...(result.modelStatementCounts !== undefined
            ? { modelStatementCounts: { ...result.modelStatementCounts } }
            : {}),
    };
}

export class VectorPipelineService {
    /** Opaque binding id -> exact catalog identity from the last successful probe. */
    private readonly modelBindings = new Map<
        string,
        { readonly row: VectorExternalModelProbeRow; readonly info: VectorPipelineModel }
    >();
    /** Bounded, non-reversible identity digest -> opaque UI id for suspend/reprobe continuity. */
    private readonly retainedModelIds = new Map<string, string>();
    private readonly modelIdentityKey = crypto.randomBytes(32);
    private modelsStale = false;
    /** token → pending confirmation (single-use; TTL-swept). */
    private readonly pending = new Map<string, PendingReembed>();
    /** handle → its one outstanding token (a new mint replaces the old). */
    private readonly tokenByHandle = new Map<string, string>();
    /** Model calls registered before their first await, so dispose sees all races. */
    private readonly activeModelCalls = new Set<ActiveModelCall>();
    private readonly completedResults = new Map<string, CompletedPipelineResult>();
    private readonly modelStatements: VectorModelStatementCounter;
    /** Invalidates async work that crossed a suspend boundary. */
    private sensitiveStateEpoch = 0;
    private disposed = false;

    constructor(
        private readonly thunks: VectorPipelineThunks,
        /** Injectable clock for deterministic TTL tests. */
        private readonly now: () => number = Date.now,
    ) {
        this.modelStatements = thunks.modelStatements ?? new VectorModelStatementCounter();
    }

    // --- pipeline state (provenance inputs) --------------------------------

    async pipelineState(refresh = false): Promise<QsVectorPipelineStateResult> {
        if (this.disposed) {
            return {
                models: [],
                networkClaim: { webview: "none", serverSide: VECTOR_SERVER_SIDE_CLAIM },
                modelStatementCounts: this.modelStatements.snapshot(),
                chunkingAvailable: false,
                error: PIPELINE_CLOSED_REFUSAL,
            };
        }
        const networkClaim = { webview: "none" as const, serverSide: VECTOR_SERVER_SIDE_CLAIM };
        const cachedModels = () => [...this.modelBindings.values()].map((binding) => binding.info);
        const stateEpoch = this.sensitiveStateEpoch;
        let capabilities: QsVectorCapabilitiesResult;
        try {
            capabilities = await this.thunks.capabilities(refresh);
        } catch (error) {
            if (stateEpoch !== this.sensitiveStateEpoch) {
                return {
                    models: [],
                    networkClaim,
                    modelStatementCounts: this.modelStatements.snapshot(),
                    chunkingAvailable: false,
                    error: PIPELINE_SUSPENDED_REFUSAL,
                };
            }
            this.modelsStale = this.modelBindings.size > 0;
            return {
                models: cachedModels(),
                networkClaim,
                modelStatementCounts: this.modelStatements.snapshot(),
                chunkingAvailable: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
        if (this.disposed) {
            return {
                models: [],
                networkClaim,
                modelStatementCounts: this.modelStatements.snapshot(),
                chunkingAvailable: false,
                error: PIPELINE_CLOSED_REFUSAL,
            };
        }
        if (stateEpoch !== this.sensitiveStateEpoch) {
            return {
                models: [],
                networkClaim,
                modelStatementCounts: this.modelStatements.snapshot(),
                chunkingAvailable: false,
                error: PIPELINE_SUSPENDED_REFUSAL,
            };
        }
        if (capabilities.error || !capabilities.probe) {
            this.modelsStale = this.modelBindings.size > 0;
            return {
                models: cachedModels(),
                networkClaim,
                modelStatementCounts: this.modelStatements.snapshot(),
                chunkingAvailable: false,
                error: capabilities.error ?? "Vector capabilities are unavailable.",
            };
        }
        const probe = capabilities.probe;
        if (probe.externalModels.error) {
            this.modelsStale = this.modelBindings.size > 0;
            return {
                models: cachedModels(),
                networkClaim,
                modelStatementCounts: this.modelStatements.snapshot(),
                chunkingAvailable: false,
                error: probe.externalModels.error,
            };
        }
        // A9 guard: offer ONLY MODEL_TYPE = EMBEDDINGS, re-filtered here even
        // though the probe filters server-side — a future type expansion must
        // degrade to "not offered", never to a wrong offer.
        const previousIds = new Map(this.retainedModelIds);
        for (const [id, binding] of this.modelBindings) {
            previousIds.set(modelIdentityDigest(binding.row, this.modelIdentityKey), id);
        }
        const nextBindings = new Map<
            string,
            { readonly row: VectorExternalModelProbeRow; readonly info: VectorPipelineModel }
        >();
        const models: VectorPipelineModel[] = probe.externalModels.models
            .filter((model) => (model.modelType ?? "").trim().toUpperCase() === "EMBEDDINGS")
            .map((model) => {
                const id =
                    previousIds.get(modelIdentityDigest(model, this.modelIdentityKey)) ??
                    `vpm_${crypto.randomBytes(12).toString("base64url")}`;
                const info: VectorPipelineModel = {
                    id,
                    name: model.name,
                    ...(model.owner !== undefined ? { owner: model.owner } : {}),
                    ...(model.apiFormat !== undefined ? { apiFormat: model.apiFormat } : {}),
                    modelType: "EMBEDDINGS",
                    ...(model.providerModel !== undefined
                        ? { providerModel: model.providerModel }
                        : {}),
                    ...(model.endpointHost !== undefined
                        ? { endpointHost: model.endpointHost }
                        : {}),
                    ...(model.modifyTime !== undefined ? { modifyTime: model.modifyTime } : {}),
                    egress: model.egress,
                };
                nextBindings.set(id, { row: model, info });
                return info;
            });
        this.modelBindings.clear();
        for (const [id, binding] of nextBindings) this.modelBindings.set(id, binding);
        this.retainedModelIds.clear();
        for (const [id, binding] of nextBindings) {
            this.retainedModelIds.set(modelIdentityDigest(binding.row, this.modelIdentityKey), id);
            if (this.retainedModelIds.size > MAX_RETAINED_MODEL_IDS) {
                const oldest = this.retainedModelIds.keys().next().value as string | undefined;
                if (oldest) this.retainedModelIds.delete(oldest);
            }
        }
        this.modelsStale = false;
        const chunkingAvailable =
            probe.engine.compatibilityLevel !== undefined && probe.engine.compatibilityLevel >= 170;
        return {
            models,
            networkClaim,
            modelStatementCounts: this.modelStatements.snapshot(),
            chunkingAvailable,
        };
    }

    // --- re-embed prepare (host-minted confirmation) ------------------------

    async reembedPrepare(
        params: QsVectorReembedPrepareParams,
    ): Promise<QsVectorReembedPrepareResult> {
        if (this.disposed) {
            return { error: PIPELINE_CLOSED_REFUSAL };
        }
        const stateEpoch = this.sensitiveStateEpoch;
        this.sweepExpired();
        const facts = this.thunks.workbench(params.handle);
        if (!facts) {
            return { error: "The analysis session has expired; reopen the Vector tab." };
        }
        try {
            const summary = facts.store.summary(facts.resultSetId);
            if (!summary) {
                return { error: "The result set is no longer available." };
            }
            if (
                !Number.isInteger(params.ordinal) ||
                params.ordinal < 0 ||
                params.ordinal >= summary.rowCount
            ) {
                return {
                    error: `Result-row ordinal ${params.ordinal} is out of range (0–${summary.rowCount - 1}).`,
                };
            }
            const columnCount = summary.columns?.length ?? summary.columnNames.length;
            if (
                !Number.isInteger(params.sourceColumnOrdinal) ||
                params.sourceColumnOrdinal < 0 ||
                params.sourceColumnOrdinal >= columnCount
            ) {
                return { error: "The selected source text column does not exist in this result." };
            }
            if (params.sourceColumnOrdinal === facts.vectorColumnOrdinal) {
                return {
                    error: "Choose a text column as the source — not the vector column itself.",
                };
            }
            const model = this.modelBindings.get(params.modelId);
            if (!model || this.modelsStale) {
                return {
                    error: "Refresh the catalog-verified EMBEDDINGS model list before re-embedding.",
                };
            }
            if (!model.row.modifyTime) {
                return {
                    error: "The model probe did not return a modification identity; Pipeline will not authorize an unverifiable model call.",
                };
            }
            // Fetch the FULL source text and the stored vector in one sparse read
            // (reason vectorAnalysis — non-admitting, never evicts the grid).
            const window = await facts.store.getWindow({
                resultSetId: facts.resultSetId,
                rowStart: params.ordinal,
                rowCount: 1,
                columnOrdinals: [params.sourceColumnOrdinal, facts.vectorColumnOrdinal],
                reason: "vectorAnalysis",
            });
            if (
                this.disposed ||
                stateEpoch !== this.sensitiveStateEpoch ||
                facts.isActive?.() === false
            ) {
                return {
                    error: this.disposed
                        ? PIPELINE_CLOSED_REFUSAL
                        : stateEpoch !== this.sensitiveStateEpoch
                          ? PIPELINE_SUSPENDED_REFUSAL
                          : "The analysis session has expired; reopen the Vector tab.",
                };
            }
            const sourceCell: unknown = window.values[0]?.[0];
            const vectorCell: unknown = window.values[0]?.[1];
            if (sourceCell === undefined || sourceCell === null) {
                return { error: "The selected row has no source text in the chosen column." };
            }
            // The Pipeline NEVER sends a truncated cell prefix to a model.
            if (isTruncatedCellMarker(sourceCell)) {
                return { error: TRUNCATED_SOURCE_REFUSAL };
            }
            const text = cellTextForPurpose(sourceCell, "copy");
            if (text.length === 0) {
                return { error: "The selected row's source text is empty." };
            }
            if (text.length > VECTOR_REEMBED_SOURCE_MAX_CHARS) {
                return {
                    error: `Source text exceeds ${VECTOR_REEMBED_SOURCE_MAX_CHARS.toLocaleString("en-US")} characters; Pipeline will not build or retain the model-call SQL.`,
                };
            }
            if (Buffer.byteLength(text, "utf8") > VECTOR_REEMBED_SOURCE_MAX_UTF8_BYTES) {
                return {
                    error: `Source text exceeds ${VECTOR_REEMBED_SOURCE_MAX_UTF8_BYTES.toLocaleString("en-US")} UTF-8 bytes; Pipeline will not build or retain the model-call SQL.`,
                };
            }
            const stored =
                vectorCell === undefined || vectorCell === null
                    ? null
                    : decodeVectorFloat32(vectorCell);
            if (stored === null) {
                return {
                    error: "The selected row has no analyzable stored vector to compare against.",
                };
            }
            const sql = buildReembedSql(text, model.row.name);
            const sourceColumnName =
                summary.columns?.[params.sourceColumnOrdinal]?.name ??
                summary.columnNames[params.sourceColumnOrdinal] ??
                `column ${params.sourceColumnOrdinal}`;
            const egress = model.row.egress;
            const descriptor: VectorReembedDescriptor = {
                model: model.row.name,
                ...(model.row.owner !== undefined ? { owner: model.row.owner } : {}),
                modelType: "EMBEDDINGS",
                apiFormat: model.row.apiFormat ?? "unknown",
                endpointHost:
                    model.row.endpointHost ??
                    (egress === "inProcess" ? "local runtime (no endpoint)" : "unknown"),
                egress,
                modelModifyTime: model.row.modifyTime,
                source: `Selected row · ${sourceColumnName}`,
                rowsCalls: 1,
                textChars: text.length,
                approxPayloadKiB: estimatePayloadKiB(text.length),
                execution: executionCopyForEgress(egress),
                resultHandling: "kept in this panel · not written to the table",
            };
            // Mint: crypto-random, single-use, short TTL. A new mint for the same
            // handle invalidates the previous token (one pending confirmation).
            const token = crypto.randomBytes(24).toString("base64url");
            const previous = this.tokenByHandle.get(params.handle);
            if (previous !== undefined) {
                this.pending.delete(previous);
            }
            const expiresAtMs = this.now() + VECTOR_REEMBED_TOKEN_TTL_MS;
            this.pending.set(token, {
                handle: params.handle,
                modelId: params.modelId,
                model: model.row,
                modelIdentity: modelIdentity(model.row),
                resultSetId: facts.resultSetId,
                vectorColumnOrdinal: facts.vectorColumnOrdinal,
                rowOrdinal: params.ordinal,
                sourceColumnOrdinal: params.sourceColumnOrdinal,
                sql,
                descriptor,
                stored: stored.values,
                expiresAtMs,
            });
            this.tokenByHandle.set(params.handle, token);
            const expiryTimer = setTimeout(() => {
                const current = this.pending.get(token);
                if (!current) return;
                this.pending.delete(token);
                if (this.tokenByHandle.get(current.handle) === token) {
                    this.tokenByHandle.delete(current.handle);
                }
            }, VECTOR_REEMBED_TOKEN_TTL_MS);
            expiryTimer.unref?.();
            const sourcePreview =
                text.length > VECTOR_SOURCE_PREVIEW_CHARS
                    ? `${text.slice(0, VECTOR_SOURCE_PREVIEW_CHARS)}…`
                    : text;
            return {
                confirmationToken: token,
                tokenExpiresEpochMs: expiresAtMs,
                descriptor,
                generatedSql: sql,
                sourcePreview,
                sourcePreviewTruncated: text.length > VECTOR_SOURCE_PREVIEW_CHARS,
                storedDimensions: stored.dimensions,
            };
        } finally {
            facts.release?.();
        }
    }

    // --- re-embed execute (token-gated, aux session, single-use) ------------

    async reembedExecute(handle: string, token: string): Promise<QsVectorReembedExecuteResult> {
        if (this.disposed) {
            return { error: PIPELINE_CLOSED_REFUSAL };
        }
        this.sweepExpired();
        const pending = typeof token === "string" ? this.pending.get(token) : undefined;
        if (!pending || pending.handle !== handle) {
            return { error: "The confirmation token is invalid, expired, or already used." };
        }
        // Consume BEFORE executing: single-use even when the call fails.
        this.pending.delete(token);
        if (this.tokenByHandle.get(pending.handle) === token) {
            this.tokenByHandle.delete(pending.handle);
        }
        const startedAt = performance.now();
        let result: QsVectorReembedExecuteResult;
        try {
            result = await this.executeConsumedReembed(pending);
        } catch (error) {
            result = { error: error instanceof Error ? error.message : String(error) };
        }
        const elapsedMs = Math.round(performance.now() - startedAt);
        Perf.marker("mssql.queryResults.vector.model.end", "instant", {
            outcome: result.comparison ? "ok" : "error",
            dims: result.comparison?.dimensions ?? 0,
            ms: elapsedMs,
        });
        let finalResult: QsVectorReembedExecuteResult = {
            ...result,
            elapsedMs,
            modelStatementIssued: result.modelStatementIssued === true,
            ...(result.modelStatementIssued === true ? { modelEgress: pending.model.egress } : {}),
            modelStatementCounts: this.modelStatements.snapshot(),
        };
        if (finalResult.comparison) {
            const runId = `vpr_${crypto.randomBytes(12).toString("base64url")}`;
            finalResult = {
                ...finalResult,
                runId,
                context: {
                    modelId: pending.modelId,
                    rowOrdinal: pending.rowOrdinal,
                    sourceColumnOrdinal: pending.sourceColumnOrdinal,
                },
            };
            this.completedResults.set(runId, {
                resultSetId: pending.resultSetId,
                vectorColumnOrdinal: pending.vectorColumnOrdinal,
                result: retainCompletedResult(finalResult),
            });
            while (this.completedResults.size > 2) {
                const oldest = this.completedResults.keys().next().value as string | undefined;
                if (!oldest) break;
                this.completedResults.delete(oldest);
            }
        }
        return finalResult;
    }

    async reembedResult(handle: string, runId: string): Promise<QsVectorReembedExecuteResult> {
        if (!/^vpr_[A-Za-z0-9_-]{16}$/.test(runId)) {
            return { error: "The Pipeline result reference is invalid." };
        }
        const cached = this.completedResults.get(runId);
        const facts = this.thunks.workbench(handle);
        if (!cached || !facts) {
            facts?.release?.();
            return { error: "The completed Pipeline comparison is no longer available." };
        }
        try {
            if (
                facts.resultSetId !== cached.resultSetId ||
                facts.vectorColumnOrdinal !== cached.vectorColumnOrdinal ||
                facts.isActive?.() === false
            ) {
                return { error: "The completed Pipeline comparison belongs to another result." };
            }
            return { ...cached.result, modelStatementCounts: this.modelStatements.snapshot() };
        } finally {
            facts.release?.();
        }
    }

    private async executeConsumedReembed(
        pending: PendingReembed,
    ): Promise<QsVectorReembedExecuteResult> {
        const current = this.modelBindings.get(pending.modelId);
        if (!current || this.modelsStale || modelIdentity(current.row) !== pending.modelIdentity) {
            return { error: "The verified EMBEDDINGS model changed; refresh and prepare again." };
        }
        const facts = this.thunks.workbench(pending.handle);
        if (!facts || facts.isActive?.() === false) {
            facts?.release?.();
            return { error: "The analysis session has expired; reopen the Vector tab." };
        }
        let settleDone!: () => void;
        const operation: ActiveModelCall = {
            ownerHandle: pending.handle,
            abortController: new AbortController(),
            done: new Promise<void>((resolve) => (settleDone = resolve)),
            settleDone: () => settleDone(),
            leaseReleased: false,
        };
        this.activeModelCalls.add(operation);
        try {
            const lease = await this.thunks.auxModelSession();
            if (!lease) {
                return {
                    error: "No auxiliary session is available for the model call on this connection.",
                };
            }
            operation.lease = lease;
            if (this.disposed || operation.abortController.signal.aborted) {
                return { error: MODEL_CALL_CANCELLED };
            }
            const verified = await this.runTrackedModelStatement(
                lease.session,
                buildPipelineModelVerificationSql(pending.model.name),
                operation,
            );
            if (this.disposed || operation.abortController.signal.aborted) {
                return { error: MODEL_CALL_CANCELLED };
            }
            if (!verifiedModelMatches(verified, pending.model)) {
                return {
                    error: "The EMBEDDINGS model identity or endpoint changed after confirmation; refresh and prepare again.",
                };
            }
            const outcome = await this.runTrackedModelStatement(
                lease.session,
                pending.sql,
                operation,
                pending.model.egress,
            );
            if (this.disposed || operation.abortController.signal.aborted) {
                return { error: MODEL_CALL_CANCELLED, modelStatementIssued: outcome.issued };
            }
            if (outcome.failed) {
                return { error: bounded(outcome.failed), modelStatementIssued: outcome.issued };
            }
            const cell: unknown = outcome.rows[0]?.[0];
            if (typeof cell !== "string" || cell.length === 0) {
                return {
                    error: "The model call returned no embedding text to compare.",
                    modelStatementIssued: outcome.issued,
                };
            }
            const fresh = parseFreshVectorJson(cell);
            if (fresh.error || !fresh.values) {
                return {
                    error: fresh.error ?? "Fresh embedding parse failed.",
                    modelStatementIssued: outcome.issued,
                };
            }
            if (fresh.values.length !== pending.stored.length) {
                return {
                    error:
                        `The fresh embedding has ${fresh.values.length} dimensions; the stored ` +
                        `vector has ${pending.stored.length}. Different models or model versions ` +
                        `cannot be compared component-wise.`,
                    modelStatementIssued: outcome.issued,
                };
            }
            return {
                comparison: compareStoredVsFresh(pending.stored, fresh.values),
                modelStatementIssued: outcome.issued,
            };
        } finally {
            if (operation.queryStop) await operation.queryStop;
            this.activeModelCalls.delete(operation);
            this.releaseModelCallLease(operation);
            facts.release?.();
            operation.settleDone();
        }
    }

    // --- chunk debugger (local character math) ------------------------------

    async chunkPreview(params: QsVectorChunkPreviewParams): Promise<QsVectorChunkPreviewResult> {
        if (this.disposed) {
            return { error: PIPELINE_CLOSED_REFUSAL };
        }
        const stateEpoch = this.sensitiveStateEpoch;
        if (
            !Number.isInteger(params.chunkSize) ||
            params.chunkSize < VECTOR_CHUNK_SIZE_MIN ||
            params.chunkSize > VECTOR_CHUNK_SIZE_MAX
        ) {
            return {
                error: `Chunk size must be an integer between ${VECTOR_CHUNK_SIZE_MIN} and ${VECTOR_CHUNK_SIZE_MAX} characters.`,
            };
        }
        if (
            !Number.isInteger(params.overlapPct) ||
            params.overlapPct < VECTOR_CHUNK_OVERLAP_MIN ||
            params.overlapPct > VECTOR_CHUNK_OVERLAP_MAX
        ) {
            return {
                error: `Overlap must be an integer between ${VECTOR_CHUNK_OVERLAP_MIN} and ${VECTOR_CHUNK_OVERLAP_MAX} percent.`,
            };
        }
        const facts = this.thunks.workbench(params.handle);
        if (!facts) {
            return { error: "The analysis session has expired; reopen the Vector tab." };
        }
        try {
            const summary = facts.store.summary(facts.resultSetId);
            if (!summary) {
                return { error: "The result set is no longer available." };
            }
            if (
                !Number.isInteger(params.ordinal) ||
                params.ordinal < 0 ||
                params.ordinal >= summary.rowCount
            ) {
                return {
                    error: `Result-row ordinal ${params.ordinal} is out of range (0–${summary.rowCount - 1}).`,
                };
            }
            const columnCount = summary.columns?.length ?? summary.columnNames.length;
            if (
                !Number.isInteger(params.sourceColumnOrdinal) ||
                params.sourceColumnOrdinal < 0 ||
                params.sourceColumnOrdinal >= columnCount
            ) {
                return { error: "The selected source text column does not exist in this result." };
            }
            const window = await facts.store.getWindow({
                resultSetId: facts.resultSetId,
                rowStart: params.ordinal,
                rowCount: 1,
                columnOrdinals: [params.sourceColumnOrdinal],
                reason: "vectorAnalysis",
            });
            if (
                this.disposed ||
                stateEpoch !== this.sensitiveStateEpoch ||
                facts.isActive?.() === false
            ) {
                return {
                    error: this.disposed
                        ? PIPELINE_CLOSED_REFUSAL
                        : stateEpoch !== this.sensitiveStateEpoch
                          ? PIPELINE_SUSPENDED_REFUSAL
                          : "The analysis session has expired; reopen the Vector tab.",
                };
            }
            const sourceCell: unknown = window.values[0]?.[0];
            if (sourceCell === undefined || sourceCell === null) {
                return { error: "The selected row has no source text in the chosen column." };
            }
            if (isTruncatedCellMarker(sourceCell)) {
                return { error: TRUNCATED_CHUNK_REFUSAL };
            }
            const text = cellTextForPurpose(sourceCell, "copy");
            if (text.length === 0) {
                return { error: "The selected row's source text is empty." };
            }
            const computed = computeFixedChunks(text, params.chunkSize, params.overlapPct);
            return {
                chunks: computed.chunks,
                totalChars: computed.totalChars,
                chunkListTruncated: computed.chunkListTruncated,
            };
        } finally {
            facts.release?.();
        }
    }

    /** Revoke this pane's pending consent and settle any active model SQL. */
    async cancel(handle: string): Promise<void> {
        this.revokePending(handle);
        const operations = [...this.activeModelCalls].filter(
            (operation) => operation.ownerHandle === handle,
        );
        for (const operation of operations) {
            operation.abortController.abort();
            this.stopActiveQuery(operation);
        }
        await Promise.all(
            operations.map(async (operation) => {
                if (operation.queryStop) await operation.queryStop;
                await operation.done;
            }),
        );
    }

    /**
     * Revoke live and source-sensitive state without erasing terminal comparison metadata.
     * The retained cache is already capped at two entries and contains only the explicit
     * metadata allowlist built by retainCompletedResult; statement counters are controller-owned.
     */
    async suspendSensitiveState(): Promise<void> {
        if (this.disposed) {
            return;
        }
        this.sensitiveStateEpoch++;
        this.pending.clear();
        this.tokenByHandle.clear();
        this.modelBindings.clear();
        this.modelsStale = false;

        const operations = [...this.activeModelCalls];
        for (const operation of operations) {
            operation.abortController.abort();
            this.stopActiveQuery(operation);
        }
        await Promise.all(
            operations.map(async (operation) => {
                if (operation.queryStop) await operation.queryStop;
                await operation.done;
            }),
        );
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.sensitiveStateEpoch++;
        this.pending.clear();
        this.tokenByHandle.clear();
        this.modelBindings.clear();
        this.retainedModelIds.clear();
        this.modelIdentityKey.fill(0);
        this.completedResults.clear();
        for (const operation of this.activeModelCalls) {
            operation.abortController.abort();
            this.stopActiveQuery(operation);
            if (operation.queryStop) {
                // Keep the auxiliary-session lease until cancel/dispose has
                // reached the active handle. reembedExecute's finally also
                // awaits this promise; release is idempotent for either path.
                void operation.queryStop.finally(() => this.releaseModelCallLease(operation));
            } else {
                this.releaseModelCallLease(operation);
            }
        }
    }

    // --- internals ----------------------------------------------------------

    private runTrackedModelStatement(
        session: ISqlSession,
        sql: string,
        operation: ActiveModelCall,
        modelEgress?: VectorModelEgressClass,
    ): Promise<ModelCallOutcome> {
        return runModelCall(session, sql, {
            signal: operation.abortController.signal,
            onHandle: (handle) => {
                if (modelEgress !== undefined) {
                    this.modelStatements.record(modelEgress);
                }
                operation.handle = handle;
                operation.queryStop = undefined;
                this.stopActiveQuery(operation);
            },
            onSettled: async (handle) => {
                if (operation.queryStop) {
                    await operation.queryStop;
                } else {
                    await handle.dispose().catch(() => undefined);
                }
                if (operation.handle === handle) operation.handle = undefined;
                operation.queryStop = undefined;
            },
        });
    }

    private revokePending(handle: string): void {
        const token = this.tokenByHandle.get(handle);
        if (token) this.pending.delete(token);
        this.tokenByHandle.delete(handle);
    }

    private sweepExpired(): void {
        const now = this.now();
        for (const [token, entry] of this.pending) {
            if (entry.expiresAtMs <= now) {
                this.pending.delete(token);
                if (this.tokenByHandle.get(entry.handle) === token) {
                    this.tokenByHandle.delete(entry.handle);
                }
            }
        }
    }

    private stopActiveQuery(operation: ActiveModelCall): void {
        const handle = operation.handle;
        if (!operation.abortController.signal.aborted || !handle || operation.queryStop) {
            return;
        }
        operation.queryStop = (async () => {
            try {
                await handle.cancel();
            } catch {
                // Disposal is best-effort but must still reach handle.dispose().
            }
            try {
                await handle.dispose();
            } catch {
                // The auxiliary lease close below is the final liveness floor.
            }
        })();
    }

    private releaseModelCallLease(operation: ActiveModelCall): void {
        if (!operation.lease || operation.leaseReleased) {
            return;
        }
        operation.leaseReleased = true;
        operation.lease.dispose();
    }
}
