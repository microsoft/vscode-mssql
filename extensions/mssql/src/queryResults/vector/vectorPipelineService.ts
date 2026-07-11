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
    VECTOR_SERVER_SIDE_CLAIM,
    VECTOR_SOURCE_PREVIEW_CHARS,
    VectorChunkPreviewEntry,
    VectorPipelineModel,
    VectorReembedComparison,
    VectorReembedDescriptor,
} from "../../sharedInterfaces/vectorPipeline";
import { IQueryResultStore } from "../queryResultTypes";
import { AuxiliarySessionLease } from "./vectorCapabilityService";

export const VECTOR_MODEL_CALL_TAG = "queryStudio:vectorModelCall";

/** Refusal text for a truncated source cell (exact, tested verbatim). */
export const TRUNCATED_SOURCE_REFUSAL =
    "Source text is truncated in the result — cannot send a partial document to the model.";

/** Refusal text when chunk math would run over a partial document. */
export const TRUNCATED_CHUNK_REFUSAL =
    "Source text is truncated in the result — chunk offsets over a partial document would be wrong.";

// ---------------------------------------------------------------------------
// Thunks (the controller supplies all authority; the service owns policy)
// ---------------------------------------------------------------------------

/** Facts about one open Vector analysis session (host-resolved by handle). */
export interface VectorPipelineWorkbenchSessionFacts {
    readonly store: IQueryResultStore;
    readonly resultSetId: string;
    /** Vector column ordinal the analysis session was opened on. */
    readonly vectorColumnOrdinal: number;
}

export interface VectorPipelineThunks {
    /** DocumentSessionBinding.acquireAuxiliarySession("vectorModelCall"). */
    auxModelSession(): Promise<AuxiliarySessionLease | undefined>;
    /** VectorCapabilityService.capabilities(refresh) — probe facts. */
    capabilities(refresh?: boolean): Promise<QsVectorCapabilitiesResult>;
    /** Resolve an open workbench analysis session; undefined = expired. */
    workbench(handle: string): VectorPipelineWorkbenchSessionFacts | undefined;
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
    deadlineMs = 5_000,
): Promise<QueryHandle> {
    const startedAt = Date.now();
    for (;;) {
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

async function runModelCall(session: ISqlSession, sql: string): Promise<ModelCallOutcome> {
    const rows: unknown[][] = [];
    const errors: string[] = [];
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
        const handle = await executeWhenFree(session, sql, sink);
        const summary = await handle.completion;
        if (summary.status !== "succeeded") {
            return { rows, errors, failed: errors[0] ?? `model call ${summary.status}` };
        }
        return { rows, errors };
    } catch (error) {
        return { rows, errors, failed: error instanceof Error ? error.message : String(error) };
    }
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

interface PendingReembed {
    readonly handle: string;
    readonly sql: string;
    readonly descriptor: VectorReembedDescriptor;
    /** Decoded stored vector, held HOST-SIDE only for the comparison. */
    readonly stored: Float32Array;
    readonly expiresAtMs: number;
}

export class VectorPipelineService {
    /** token → pending confirmation (single-use; TTL-swept). */
    private readonly pending = new Map<string, PendingReembed>();
    /** handle → its one outstanding token (a new mint replaces the old). */
    private readonly tokenByHandle = new Map<string, string>();

    constructor(
        private readonly thunks: VectorPipelineThunks,
        /** Injectable clock for deterministic TTL tests. */
        private readonly now: () => number = Date.now,
    ) {}

    // --- pipeline state (provenance inputs) --------------------------------

    async pipelineState(refresh = false): Promise<QsVectorPipelineStateResult> {
        const networkClaim = { webview: "none" as const, serverSide: VECTOR_SERVER_SIDE_CLAIM };
        const capabilities = await this.thunks.capabilities(refresh);
        if (capabilities.error || !capabilities.probe) {
            return {
                models: [],
                networkClaim,
                chunkingAvailable: false,
                error: capabilities.error ?? "Vector capabilities are unavailable.",
            };
        }
        const probe = capabilities.probe;
        // A9 guard: offer ONLY MODEL_TYPE = EMBEDDINGS, re-filtered here even
        // though the probe filters server-side — a future type expansion must
        // degrade to "not offered", never to a wrong offer.
        const models: VectorPipelineModel[] = probe.externalModels.models
            .filter((model) => (model.modelType ?? "").trim().toUpperCase() === "EMBEDDINGS")
            .map((model) => ({
                name: model.name,
                ...(model.owner !== undefined ? { owner: model.owner } : {}),
                ...(model.apiFormat !== undefined ? { apiFormat: model.apiFormat } : {}),
                modelType: "EMBEDDINGS",
                ...(model.providerModel !== undefined
                    ? { providerModel: model.providerModel }
                    : {}),
                ...(model.endpointHost !== undefined ? { endpointHost: model.endpointHost } : {}),
                ...(model.modifyTime !== undefined ? { modifyTime: model.modifyTime } : {}),
                egress: model.egress,
            }));
        const chunkingAvailable =
            probe.engine.compatibilityLevel !== undefined && probe.engine.compatibilityLevel >= 170;
        return {
            models,
            networkClaim,
            chunkingAvailable,
            ...(models.length === 0 && probe.externalModels.error
                ? { error: probe.externalModels.error }
                : {}),
        };
    }

    // --- re-embed prepare (host-minted confirmation) ------------------------

    async reembedPrepare(
        params: QsVectorReembedPrepareParams,
    ): Promise<QsVectorReembedPrepareResult> {
        this.sweepExpired();
        const facts = this.thunks.workbench(params.handle);
        if (!facts) {
            return { error: "The analysis session has expired; reopen the Vector tab." };
        }
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
            return { error: "Choose a text column as the source — not the vector column itself." };
        }
        // Host-resolves the model against the probe: the webview's string
        // selects, it never names an object into SQL directly.
        const model = await this.resolveModel(params.modelName);
        if ("error" in model) {
            return { error: model.error };
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
            sql,
            descriptor,
            stored: stored.values,
            expiresAtMs,
        });
        this.tokenByHandle.set(params.handle, token);
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
            storedDimensions: stored.dimensions,
        };
    }

    // --- re-embed execute (token-gated, aux session, single-use) ------------

    async reembedExecute(token: string): Promise<QsVectorReembedExecuteResult> {
        this.sweepExpired();
        const pending = typeof token === "string" ? this.pending.get(token) : undefined;
        if (!pending) {
            return { error: "The confirmation token is invalid, expired, or already used." };
        }
        // Consume BEFORE executing: single-use even when the call fails.
        this.pending.delete(token);
        if (this.tokenByHandle.get(pending.handle) === token) {
            this.tokenByHandle.delete(pending.handle);
        }
        const lease = await this.thunks.auxModelSession();
        if (!lease) {
            return {
                error: "No auxiliary session is available for the model call on this connection.",
            };
        }
        const startedAt = performance.now();
        const markEnd = (outcome: "ok" | "error", dims: number, ms: number) =>
            Perf.marker("mssql.queryResults.vector.model.end", "instant", {
                outcome,
                dims,
                ms,
            });
        try {
            const outcome = await runModelCall(lease.session, pending.sql);
            const elapsedMs = Math.round(performance.now() - startedAt);
            if (outcome.failed) {
                markEnd("error", 0, elapsedMs);
                return { elapsedMs, error: bounded(outcome.failed) };
            }
            const cell: unknown = outcome.rows[0]?.[0];
            if (typeof cell !== "string" || cell.length === 0) {
                markEnd("error", 0, elapsedMs);
                return {
                    elapsedMs,
                    error: "The model call returned no embedding text to compare.",
                };
            }
            const fresh = parseFreshVectorJson(cell);
            if (fresh.error || !fresh.values) {
                markEnd("error", 0, elapsedMs);
                return { elapsedMs, error: fresh.error ?? "Fresh embedding parse failed." };
            }
            if (fresh.values.length !== pending.stored.length) {
                markEnd("error", fresh.values.length, elapsedMs);
                return {
                    elapsedMs,
                    error:
                        `The fresh embedding has ${fresh.values.length} dimensions; the stored ` +
                        `vector has ${pending.stored.length}. Different models or model versions ` +
                        `cannot be compared component-wise.`,
                };
            }
            markEnd("ok", fresh.values.length, elapsedMs);
            return {
                comparison: compareStoredVsFresh(pending.stored, fresh.values),
                elapsedMs,
            };
        } finally {
            lease.dispose();
        }
    }

    // --- chunk debugger (local character math) ------------------------------

    async chunkPreview(params: QsVectorChunkPreviewParams): Promise<QsVectorChunkPreviewResult> {
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
    }

    dispose(): void {
        this.pending.clear();
        this.tokenByHandle.clear();
    }

    // --- internals ----------------------------------------------------------

    private async resolveModel(
        modelName: string,
    ): Promise<{ row: VectorExternalModelProbeRow } | { error: string }> {
        if (typeof modelName !== "string" || modelName.trim().length === 0) {
            return { error: "No embedding model was selected." };
        }
        const capabilities = await this.thunks.capabilities();
        if (capabilities.error || !capabilities.probe) {
            return {
                error:
                    capabilities.error ??
                    "Vector capabilities are unavailable; cannot verify the model.",
            };
        }
        const wanted = modelName.trim().toLowerCase();
        const row = capabilities.probe.externalModels.models.find(
            (candidate) =>
                candidate.name.toLowerCase() === wanted &&
                (candidate.modelType ?? "").trim().toUpperCase() === "EMBEDDINGS",
        );
        if (!row) {
            return {
                error: `"${modelName}" is not an EMBEDDINGS external model on this connection.`,
            };
        }
        return { row };
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
}
