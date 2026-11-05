/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Vector Workbench PIPELINE contracts (VEC-10; readiness review P0-4/P0-5,
 * design addendum A4/A9, RR §5.10/§5.11). Shared host ↔ webview —
 * vscode-jsonrpc only (the vectorWorkbench.ts precedent), no vscode/DOM/Node
 * imports.
 *
 * Authority model (binding):
 * - The webview asks; the host mints. A model call is possible ONLY through a
 *   host-minted confirmation: `reembedPrepare` returns a descriptor (every
 *   fact the confirmation dialog shows) plus a single-use, short-TTL token;
 *   `reembedExecute` accepts nothing but that token. The webview cannot
 *   fabricate consent — it holds no SQL text authority, no model authority,
 *   and no session authority.
 * - `generatedSql` is DISPLAYED and EXECUTED from the same host-side string;
 *   the webview's "View generated T-SQL" shows exactly what will run.
 * - The chunk preview is LOCAL character math on the host (no SQL, no model
 *   call) over the FULL source text; chunk previews are bounded to
 *   {@link VECTOR_CHUNK_PREVIEW_CHARS} characters each.
 *
 * Privacy (binding): descriptor fields carry counts, the endpoint HOST, and
 * a column name — never credentials, URL query strings, or (into telemetry)
 * source text or vector components. Source text appears only as bounded
 * result data to the panel (`sourcePreview`, chunk `previewText`), never in
 * logs or markers.
 */

import { RequestType } from "vscode-jsonrpc";
import { VectorModelEgressClass, VectorModelStatementCounts } from "./vectorCatalog";

// ---------------------------------------------------------------------------
// Constants (host-authoritative; echoed here so the UI renders honest bounds)
// ---------------------------------------------------------------------------

/** Confirmation tokens are single-use and expire 2 minutes after minting. */
export const VECTOR_REEMBED_TOKEN_TTL_MS = 120_000;

/** Chunk debugger fixed-size range (characters, never tokens). */
export const VECTOR_CHUNK_SIZE_MIN = 200;
export const VECTOR_CHUNK_SIZE_MAX = 2000;
export const VECTOR_CHUNK_SIZE_STEP = 50;

/** Chunk debugger overlap range (% of chunk size). */
export const VECTOR_CHUNK_OVERLAP_MIN = 0;
export const VECTOR_CHUNK_OVERLAP_MAX = 50;
export const VECTOR_CHUNK_OVERLAP_STEP = 5;

/** Bounded per-chunk preview text (first N characters only). */
export const VECTOR_CHUNK_PREVIEW_CHARS = 80;

/** Chunk list payload cap (`chunkListTruncated` discloses the cap). */
export const VECTOR_CHUNK_PREVIEW_MAX_CHUNKS = 256;

/** Bounded source-text preview returned by reembedPrepare (result data). */
export const VECTOR_SOURCE_PREVIEW_CHARS = 160;
/** Full source accepted into one pending model-call statement. */
export const VECTOR_REEMBED_SOURCE_MAX_CHARS = 65_536;
export const VECTOR_REEMBED_SOURCE_MAX_UTF8_BYTES = 128 * 1024;

// ---------------------------------------------------------------------------
// Layered network claim (P0-5): webview vs server-side, per egress class
// ---------------------------------------------------------------------------

/**
 * Truthful server-side claim per egress class (P0-5 layered copy). The
 * webview itself performs NO network requests, ever — that half of the claim
 * is a constant; this half depends on where the configured model points.
 */
export const VECTOR_SERVER_SIDE_CLAIM: Readonly<Record<VectorModelEgressClass, string>> = {
    externalEgress: "SQL Server calls the external endpoint — text leaves your environment.",
    hostLocal: "Host-local endpoint — text leaves the database engine but not the host.",
    inProcess: "Local ONNX runtime on the SQL Server host — no network egress.",
    unknown: "Unrecognized API format — egress cannot be classified.",
};

export interface VectorPipelineNetworkClaim {
    /** Always "none": the Vector webview performs no network requests. */
    readonly webview: "none";
    /** Server-side copy per egress class (the view picks the model's class). */
    readonly serverSide: Readonly<Record<VectorModelEgressClass, string>>;
}

// ---------------------------------------------------------------------------
// Pipeline state (provenance inputs from the VEC-7 probe)
// ---------------------------------------------------------------------------

/**
 * One EMBEDDINGS external model offered to the Pipeline (P0-4: DATABASE-
 * scoped name + owner principal — never schema-qualified anywhere).
 */
export interface VectorPipelineModel {
    /** Opaque host binding; SQL identifiers never round-trip from the webview. */
    readonly id: string;
    readonly name: string;
    /** Owner principal — not a schema. Display "owner dbo", never "dbo.". */
    readonly owner?: string;
    /** API_FORMAT verbatim ('Azure OpenAI' | 'OpenAI' | 'Ollama' | 'ONNX' …). */
    readonly apiFormat?: string;
    /** Always "EMBEDDINGS" here (A9 guard filters everything else out). */
    readonly modelType: string;
    /** Provider model string (e.g. "text-embedding-3-small"). */
    readonly providerModel?: string;
    /** Endpoint HOST only — path/query strings never leave the probe. */
    readonly endpointHost?: string;
    /** Model modify time (reproducibility identity, P0-4). */
    readonly modifyTime?: string;
    readonly egress: VectorModelEgressClass;
}

export interface QsVectorPipelineStateParams {
    /** Bypass the host-side capability cache (explicit user refresh only). */
    readonly refresh?: boolean;
}

export interface QsVectorPipelineStateResult {
    /** EMBEDDINGS models from the probe (empty on refusal — never invented). */
    readonly models: readonly VectorPipelineModel[];
    readonly networkClaim: VectorPipelineNetworkClaim;
    /** Controller-owned statement counts; renderer state is never authoritative for this claim. */
    readonly modelStatementCounts: VectorModelStatementCounts;
    /**
     * AI_GENERATE_CHUNKS availability HINT: compatibility level ≥ 170 per the
     * probe. This is a catalog fact, not a verified parse acceptance — the
     * live acceptance probe is a gated test concern, and the chunk debugger
     * itself is local character math either way.
     */
    readonly chunkingAvailable: boolean;
    /** Honest refusal (no connection, no aux session, catalog unqueryable). */
    readonly error?: string;
}

// ---------------------------------------------------------------------------
// Re-embed: host-minted confirmation (prepare) + token-gated execution
// ---------------------------------------------------------------------------

export interface QsVectorReembedPrepareParams {
    /** Open analysis-session handle (qs/vector.open) — host-minted. */
    readonly handle: string;
    /** Zero-based result-row ordinal of the selected row. */
    readonly ordinal: number;
    /** Column ordinal holding the source text (webview's column pick). */
    readonly sourceColumnOrdinal: number;
    /** Opaque verified model binding returned by qs/vector.pipelineState. */
    readonly modelId: string;
}

/**
 * Every row of the confirmation dialog (mock `vec_pipeline_regen.png`),
 * minted by the host. The webview renders these verbatim — it cannot compose
 * its own claim about what a model call will do.
 */
export interface VectorReembedDescriptor {
    /** Database-scoped model name (P0-4 — never schema-qualified). */
    readonly model: string;
    /** Owner principal, when the catalog exposed it. */
    readonly owner?: string;
    /** Always "EMBEDDINGS" (A9). */
    readonly modelType: string;
    readonly apiFormat: string;
    readonly endpointHost: string;
    readonly egress: VectorModelEgressClass;
    readonly modelModifyTime: string;
    /** e.g. "Selected row · chunk_text". */
    readonly source: string;
    /** Always 1 for single-row re-embed. */
    readonly rowsCalls: number;
    /** Full source-text length in characters (never a truncated prefix). */
    readonly textChars: number;
    /** Upper-bound payload estimate in KiB (UTF-16 bound, 0.1 KiB steps). */
    readonly approxPayloadKiB: number;
    /** Egress-truthful execution copy (A4). */
    readonly execution: string;
    /** "kept in this panel · not written to the table". */
    readonly resultHandling: string;
}

export interface QsVectorReembedPrepareResult {
    /** Single-use token; expires VECTOR_REEMBED_TOKEN_TTL_MS after minting. */
    readonly confirmationToken?: string;
    /** Epoch ms when the token expires (countdown display only). */
    readonly tokenExpiresEpochMs?: number;
    readonly descriptor?: VectorReembedDescriptor;
    /** Exactly the SQL reembedExecute will run (displayed == executed). */
    readonly generatedSql?: string;
    /** Bounded preview of the FULL source text (result data, panel only). */
    readonly sourcePreview?: string;
    /** True means sourcePreview is explicitly only the first bounded characters. */
    readonly sourcePreviewTruncated?: boolean;
    /** Stored vector dimensionality (fresh dims are validated against it). */
    readonly storedDimensions?: number;
    /**
     * Honest refusal. Includes the truncated-source refusal: the Pipeline
     * never sends a truncated result-cell prefix to a model.
     */
    readonly error?: string;
}

export interface QsVectorReembedExecuteParams {
    readonly handle: string;
    /** The host-minted confirmation token — the ONLY accepted authority. */
    readonly token: string;
}

/** Stored-vs-fresh comparison, computed host-side in float64. */
export interface VectorReembedComparison {
    /** Cosine DISTANCE (1 − cos θ); null when either norm is zero (undefined). */
    readonly cosine: number | null;
    /** Euclidean distance. */
    readonly euclidean: number;
    /** Negative dot product (SQL metric register). */
    readonly negativeDot: number;
    readonly normStored: number;
    readonly normFresh: number;
    /** Shared dimensionality of the compared pair. */
    readonly dimensions: number;
}

export interface QsVectorReembedExecuteResult {
    /** Opaque host-cache id used only to restore this terminal comparison. */
    readonly runId?: string;
    readonly comparison?: VectorReembedComparison;
    readonly context?: {
        readonly modelId: string;
        readonly rowOrdinal: number;
        readonly sourceColumnOrdinal: number;
    };
    /** Wall time of the consumed-token attempt, including identity verification (single observation). */
    readonly elapsedMs?: number;
    /** Host-authored fact: the AI_GENERATE_EMBEDDINGS statement obtained a query handle. */
    readonly modelStatementIssued?: boolean;
    /** Egress class of the exact consented model; present only when the model statement was issued. */
    readonly modelEgress?: VectorModelEgressClass;
    /** Authoritative counter snapshot after this attempt. */
    readonly modelStatementCounts?: VectorModelStatementCounts;
    readonly error?: string;
}

export interface QsVectorReembedResultParams {
    readonly handle: string;
    readonly runId: string;
}

// ---------------------------------------------------------------------------
// Chunk debugger (local character math — no SQL, no model)
// ---------------------------------------------------------------------------

export interface QsVectorChunkPreviewParams {
    readonly handle: string;
    /** Zero-based result-row ordinal of the selected row. */
    readonly ordinal: number;
    readonly sourceColumnOrdinal: number;
    /** Characters per chunk (VECTOR_CHUNK_SIZE_MIN..MAX). */
    readonly chunkSize: number;
    /** Overlap as % of chunk size (VECTOR_CHUNK_OVERLAP_MIN..MAX). */
    readonly overlapPct: number;
}

export interface VectorChunkPreviewEntry {
    /** Zero-based chunk order. */
    readonly index: number;
    /** Character offset of the chunk start in the source text. */
    readonly startOffset: number;
    /** Chunk length in characters (tail chunks may be shorter). */
    readonly chars: number;
    /** Characters shared with the PREVIOUS chunk (0 for the first). */
    readonly overlapChars: number;
    /** First VECTOR_CHUNK_PREVIEW_CHARS characters only — never full text. */
    readonly previewText: string;
}

export interface QsVectorChunkPreviewResult {
    readonly chunks?: readonly VectorChunkPreviewEntry[];
    /** Full source-text length the math ran over. */
    readonly totalChars?: number;
    /** True when the chunk list was capped at VECTOR_CHUNK_PREVIEW_MAX_CHUNKS. */
    readonly chunkListTruncated?: boolean;
    readonly error?: string;
}

// ---------------------------------------------------------------------------
// Pull RPC (host mints everything; webview asks, never configures)
// ---------------------------------------------------------------------------

export const VECTOR_PIPELINE_RPC = {
    pipelineState: "qs/vector.pipelineState",
    reembedPrepare: "qs/vector.reembedPrepare",
    reembedExecute: "qs/vector.reembedExecute",
    reembedResult: "qs/vector.reembedResult",
    cancel: "qs/vector.pipelineCancel",
    chunkPreview: "qs/vector.chunkPreview",
} as const;

export namespace QsVectorPipelineCancelRequest {
    export const type = new RequestType<{ readonly handle: string }, void, void>(
        VECTOR_PIPELINE_RPC.cancel,
    );
}

export namespace QsVectorPipelineStateRequest {
    export const type = new RequestType<
        QsVectorPipelineStateParams,
        QsVectorPipelineStateResult,
        void
    >(VECTOR_PIPELINE_RPC.pipelineState);
}

export namespace QsVectorReembedPrepareRequest {
    export const type = new RequestType<
        QsVectorReembedPrepareParams,
        QsVectorReembedPrepareResult,
        void
    >(VECTOR_PIPELINE_RPC.reembedPrepare);
}

export namespace QsVectorReembedExecuteRequest {
    export const type = new RequestType<
        QsVectorReembedExecuteParams,
        QsVectorReembedExecuteResult,
        void
    >(VECTOR_PIPELINE_RPC.reembedExecute);
}

export namespace QsVectorReembedResultRequest {
    export const type = new RequestType<
        QsVectorReembedResultParams,
        QsVectorReembedExecuteResult,
        void
    >(VECTOR_PIPELINE_RPC.reembedResult);
}

export namespace QsVectorChunkPreviewRequest {
    export const type = new RequestType<
        QsVectorChunkPreviewParams,
        QsVectorChunkPreviewResult,
        void
    >(VECTOR_PIPELINE_RPC.chunkPreview);
}
