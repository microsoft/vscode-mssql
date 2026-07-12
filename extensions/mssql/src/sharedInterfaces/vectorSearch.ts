/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Vector Search workspace contracts (VEC-8; r01 §8, r06 §3.3). Shared host ↔
 * webview — vscode-jsonrpc only (the vectorWorkbench.ts precedent), no
 * vscode/DOM/Node imports and no imports from the host-side builder: the
 * predicate/exclusion/metric shapes here are STRUCTURALLY identical to
 * vectorSqlBuilder's inputs so the service passes them straight through.
 *
 * Honesty is structural: the displayed SQL in `executedSql` is byte-for-byte
 * the text the host executed (parameters are inlined at the execution edge —
 * the data plane has no parameter binding); every evidence row carries its
 * source; the recall denominator is disclosed; timings are labeled a SINGLE
 * OBSERVATION, never a benchmark. The webview has ZERO authority over
 * sessions or SQL text — it sends the composition, the host mints the rest.
 *
 * Privacy (binding): neighbor keys/labels/distances and the query vector are
 * result data — allowed to the webview, banned from telemetry/diagnostics.
 */

import { RequestType } from "vscode-jsonrpc";
import type { VectorModelEgressClass, VectorModelStatementCounts } from "./vectorCatalog";
import type { VectorEvidenceSource } from "./vectorWorkbench";

// ---------------------------------------------------------------------------
// Composition inputs (structural mirrors of the builder's pure input shapes)
// ---------------------------------------------------------------------------

export type VectorSearchMetric = "cosine" | "euclidean" | "dot";

export type VectorSearchPredicateOp = "eq" | "ne" | "gt" | "lt" | "ge" | "le";

/** One AND-combined structured predicate (r01 §8: AND-only builder). */
export interface VectorSearchPredicateInput {
    readonly column: string;
    readonly op: VectorSearchPredicateOp;
    readonly value: string | number | boolean | null;
}

/** Structured key facts for the exclusion flags (P0-6: never raw SQL). */
export interface VectorSearchKeyPredicateInput {
    readonly sourceRowKey?: string | number;
    readonly exactDuplicateKeys?: readonly (string | number)[];
    readonly documentColumn?: string;
    readonly sourceDocumentValue?: string | number;
}

/** P0-6 structured exclusion policy (mirrors VectorSearchExclusionPolicy). */
export interface VectorSearchExclusionInput {
    readonly excludeSourceRow: boolean;
    readonly excludeExactVectorDuplicates: boolean;
    readonly excludeSameDocument?: boolean;
    readonly keyPredicate?: VectorSearchKeyPredicateInput;
}

/**
 * One searchable base table + vector column, derived from a catalog query on
 * the auxiliary diagnostic session. `keyColumn` is a SINGLE-column unique key
 * (PK preferred) — searches require it for tie-breaks, exclusions, and recall
 * identity; targets without one are listed but not searchable.
 */
export interface VectorSearchTargetInfo {
    /** Opaque host-minted binding identifier. The webview never sends SQL identifiers back. */
    readonly id: string;
    readonly schema: string;
    readonly table: string;
    readonly vectorColumn: string;
    /** Declared VECTOR dimensions from sys.columns (absent = unknown). */
    readonly dimensions?: number;
    readonly keyColumn?: string;
    /** True only when keyColumn came from a unique single-column index/PK. */
    readonly keyIsUnique: boolean;
    /** Display-only label column heuristic: first character column, if any. */
    readonly labelColumn?: string;
    /** sys.partitions row estimate (heap/clustered) — approximate by nature. */
    readonly rowCountEstimate?: number;
    /** Catalog-verified scalar columns offered by the structured filter builder. */
    readonly filterColumns: readonly VectorSearchFilterColumn[];
}

export interface VectorSearchFilterColumn {
    readonly name: string;
    readonly sqlType: string;
}

export const VECTOR_SEARCH_MIN_K = 1;
export const VECTOR_SEARCH_MAX_K = 1000;
export const VECTOR_SEARCH_DEFAULT_K = 20;

/** Search text is intentionally smaller than nvarchar(max) to bound RPC/SQL memory. */
export const VECTOR_SEARCH_MODEL_TEXT_MAX_CHARS = 32_768;
export const VECTOR_SEARCH_MODEL_TEXT_MAX_UTF8_BYTES = 128 * 1024;
export const VECTOR_SEARCH_MODEL_PARAMETERS_MAX_UTF8_BYTES = 4 * 1024;
export const VECTOR_SEARCH_MODEL_TOKEN_TTL_MS = 120_000;

/** Where the frozen query vector comes from (P0-10: resolved ONCE host-side). */
export type VectorSearchExpressionSymbol = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

export interface VectorSearchExpressionBasketEntry {
    /** A-H only; the host requires the canonical contiguous basket order. */
    readonly symbol: VectorSearchExpressionSymbol;
    /** Zero-based ordinal in the controller-bound result set. */
    readonly ordinal: number;
}

export type VectorSearchSource =
    | { readonly kind: "selectedRow"; readonly ordinal: number }
    | { readonly kind: "pastedVector"; readonly json: string }
    | {
          readonly kind: "generatedVector";
          /** Opaque host cache id; vector components never round-trip through the webview. */
          readonly id: string;
      }
    | {
          readonly kind: "expression";
          /** Audited grammar only; never SQL or JavaScript source. */
          readonly expression: string;
          /** Compare basket snapshot, capped to A-H and revalidated host-side. */
          readonly basket: readonly VectorSearchExpressionBasketEntry[];
      };

// ---------------------------------------------------------------------------
// Text-with-model source: inventory -> prepare -> one-shot execute
// ---------------------------------------------------------------------------

/** One catalog-verified, database-scoped EMBEDDINGS model. */
export interface VectorSearchModelInfo {
    /** Opaque host binding id. The webview never supplies an SQL model identifier. */
    readonly id: string;
    readonly name: string;
    readonly owner?: string;
    readonly modelType: "EMBEDDINGS";
    readonly apiFormat?: string;
    readonly endpointHost?: string;
    readonly egress: VectorModelEgressClass;
}

export interface QsVectorSearchModelsResult {
    readonly models: readonly VectorSearchModelInfo[];
    readonly modelStatementCounts: VectorModelStatementCounts;
    readonly error?: string;
}

export interface QsVectorSearchModelPrepareParams {
    readonly handle: string;
    /** Opaque verified target; its declared dimensions bind the generated result. */
    readonly targetId: string;
    /** Opaque verified EMBEDDINGS model binding from qs/vector.searchModels. */
    readonly modelId: string;
    readonly text: string;
    /** Optional bounded allowlisted JSON; omitted means use model defaults. */
    readonly parametersJson?: string;
}

/** Host-authored confirmation rows; the webview renders these without inference. */
export interface VectorSearchModelDescriptor {
    readonly model: string;
    readonly owner?: string;
    readonly modelType: "EMBEDDINGS";
    readonly apiFormat: string;
    readonly endpointHost: string;
    readonly egress: VectorModelEgressClass;
    /** Catalog identity used to detect a replacement before the call. */
    readonly modelModifyTime: string;
    readonly source: "Text entered in Search";
    readonly rowsCalls: 1;
    readonly textChars: number;
    readonly approxPayloadKiB: number;
    readonly expectedDimensions: number;
    readonly parameters: "model defaults" | "validated per-call overrides";
    readonly retryPolicy: string;
    readonly execution: string;
    readonly resultHandling: "kept in this panel · not written to the table";
}

export interface QsVectorSearchModelPrepareResult {
    readonly confirmationToken?: string;
    readonly tokenExpiresEpochMs?: number;
    readonly descriptor?: VectorSearchModelDescriptor;
    /** Exactly the model-call statement the host will execute. */
    readonly generatedSql?: string;
    readonly error?: string;
}

export interface QsVectorSearchModelExecuteResult {
    /** Opaque host cache id consumed by VectorSearchSource.generatedVector. */
    readonly generatedVectorId?: string;
    readonly dimensions?: number;
    /** Wall time of the consumed-token attempt, including identity verification. */
    readonly elapsedMs?: number;
    /** Host-authored fact: the AI_GENERATE_EMBEDDINGS statement obtained a query handle. */
    readonly modelStatementIssued?: boolean;
    /** Exact consented model egress; present only when the model statement was issued. */
    readonly modelEgress?: VectorModelEgressClass;
    /** Authoritative counter snapshot after this attempt. */
    readonly modelStatementCounts?: VectorModelStatementCounts;
    readonly error?: string;
}

// ---------------------------------------------------------------------------
// Pull RPC — qs/vector.searchTargets
// ---------------------------------------------------------------------------

export interface QsVectorSearchTargetsParams {
    /** Workbench handle scopes cancellation to the current Vector pane. */
    readonly handle: string;
    /** Reserved for an explicit user refresh (no host cache in v1). */
    readonly refresh?: boolean;
}

export interface QsVectorSearchTargetsResult {
    readonly targets?: readonly VectorSearchTargetInfo[];
    /** Honest refusal (no connection, no aux session, catalog error). */
    readonly error?: string;
}

// ---------------------------------------------------------------------------
// Pull RPC — qs/vector.search
// ---------------------------------------------------------------------------

export interface QsVectorSearchParams {
    /** Workbench session handle — source of the frozen vector for selectedRow. */
    readonly handle: string;
    readonly source: VectorSearchSource;
    /** Resolves only against the host's current catalog snapshot. */
    readonly targetId: string;
    readonly metric: VectorSearchMetric;
    /** Clamped host-side to 1..1000 — the host never trusts this raw. */
    readonly k: number;
    readonly predicates?: readonly VectorSearchPredicateInput[];
    readonly exclusion?: VectorSearchExclusionInput;
    readonly includeApprox: boolean;
}

export type VectorSearchRankStatus = "matched" | "exactOnly" | "approxOnly";

/** One neighbor from one variant's result (1-based rank, raw distance). */
export interface VectorSearchNeighborRow {
    readonly rank: number;
    readonly key: string | number;
    readonly label?: string;
    readonly distance: number;
}

/** Union row for the rank grid (r06 §3.3: exact#/approx#/Δ/key/dists/status). */
export interface VectorSearchRankRow {
    readonly key: string | number;
    readonly label?: string;
    readonly exactRank?: number;
    readonly approxRank?: number;
    /** approxRank − exactRank when both ran (positive = worse under approx). */
    readonly delta?: number;
    readonly exactDistance?: number;
    readonly approxDistance?: number;
    readonly status: VectorSearchRankStatus;
    /** Exact-distance order is unstable within the approved relative tolerance. */
    readonly distanceTie?: boolean;
}

/** One label/value evidence line with its evidence class (P0-1 vocabulary). */
export interface VectorSearchEvidenceRow {
    readonly label: string;
    readonly value: string;
    readonly source: VectorEvidenceSource;
}

export interface VectorSearchRecall {
    /** overlap / min(k, |exact|); absent when the denominator is 0. */
    readonly recallAtK?: number;
    readonly overlap: number;
    readonly exactCount: number;
    readonly approxCount: number;
    readonly denominatorDisclosure: string;
}

/** Copy for the timing disclosure — verbatim in the facts strip. */
export const VECTOR_SEARCH_TIMING_DISCLOSURE = "single observation — not a benchmark";

export interface VectorSearchTimings {
    readonly exactMs: number;
    readonly approxMs?: number;
    /** Always VECTOR_SEARCH_TIMING_DISCLOSURE — one wall-clock run each. */
    readonly disclosure: string;
}

/** Byte-for-byte the statements the host executed (displayed == executed). */
export interface VectorSearchExecutedSql {
    readonly exact: string;
    /** Present ONLY when the approximate variant actually executed. */
    readonly approx?: string;
}

export interface QsVectorSearchComparison {
    readonly exact: readonly VectorSearchNeighborRow[];
    /** Present only when the approximate variant executed successfully. */
    readonly approx?: readonly VectorSearchNeighborRow[];
    readonly rankRows: readonly VectorSearchRankRow[];
    /** Present only when both variants ran (needs both key sets). */
    readonly recall?: VectorSearchRecall;
    readonly evidence: readonly VectorSearchEvidenceRow[];
    readonly executedSql: VectorSearchExecutedSql;
    readonly timings: VectorSearchTimings;
    /** Effective (clamped) K the statements used. */
    readonly k: number;
    readonly metric: VectorSearchMetric;
    readonly dimensions: number;
    /** Why the approximate variant did not run (gate/probe/not requested). */
    readonly approxSkippedReason?: string;
    /** The approximate variant executed but failed; exact results stand. */
    readonly approxError?: string;
}

export interface QsVectorSearchResult {
    /** Workbench-session generation echo (0 when no session was involved). */
    readonly generation: number;
    /** Opaque host cache id used to restore a terminal comparison after renderer reload. */
    readonly runId?: string;
    readonly comparison?: QsVectorSearchComparison;
    /** Honest failure (no session, bad source, exact execution failed, …). */
    readonly error?: string;
}

// ---------------------------------------------------------------------------
// Request types (host handlers auto-spanned per method name)
// ---------------------------------------------------------------------------

export const VECTOR_SEARCH_RPC = {
    searchTargets: "qs/vector.searchTargets",
    searchModels: "qs/vector.searchModels",
    modelPrepare: "qs/vector.searchModelPrepare",
    modelExecute: "qs/vector.searchModelExecute",
    search: "qs/vector.search",
    cancel: "qs/vector.searchCancel",
    result: "qs/vector.searchResult",
} as const;

export namespace QsVectorSearchModelsRequest {
    export const type = new RequestType<
        { readonly handle: string; readonly refresh?: boolean },
        QsVectorSearchModelsResult,
        void
    >(VECTOR_SEARCH_RPC.searchModels);
}

export namespace QsVectorSearchModelPrepareRequest {
    export const type = new RequestType<
        QsVectorSearchModelPrepareParams,
        QsVectorSearchModelPrepareResult,
        void
    >(VECTOR_SEARCH_RPC.modelPrepare);
}

export namespace QsVectorSearchModelExecuteRequest {
    export const type = new RequestType<
        { readonly handle: string; readonly token: string },
        QsVectorSearchModelExecuteResult,
        void
    >(VECTOR_SEARCH_RPC.modelExecute);
}

export namespace QsVectorSearchTargetsRequest {
    export const type = new RequestType<
        QsVectorSearchTargetsParams,
        QsVectorSearchTargetsResult,
        void
    >(VECTOR_SEARCH_RPC.searchTargets);
}

export namespace QsVectorSearchRequest {
    export const type = new RequestType<QsVectorSearchParams, QsVectorSearchResult, void>(
        VECTOR_SEARCH_RPC.search,
    );
}

export namespace QsVectorSearchCancelRequest {
    export const type = new RequestType<
        { readonly handle: string; readonly sensitive?: boolean },
        void,
        void
    >(VECTOR_SEARCH_RPC.cancel);
}

export namespace QsVectorSearchResultRequest {
    export const type = new RequestType<
        { readonly handle: string; readonly runId: string; readonly targetId: string },
        QsVectorSearchResult,
        void
    >(VECTOR_SEARCH_RPC.result);
}
