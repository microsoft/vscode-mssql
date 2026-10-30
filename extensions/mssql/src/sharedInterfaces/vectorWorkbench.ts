/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Vector Workbench contracts (VEC-4; readiness-review P0-1/P0-2/P0-8, design
 * addendum A6). Shared host ↔ webview — vscode-jsonrpc only (the
 * queryStudio.ts precedent), no vscode/DOM/Node imports.
 *
 * Evidence honesty is structural, not stylistic: every result contract
 * carries its `VectorEvidenceSource`, every finding carries its subject, the
 * sample descriptor disclosés its budgets and why analysis stopped, and
 * analyzed-vs-rendered counts are separate fields. The webview has ZERO
 * authority over budgets, store ids, run ids, or lease ids — it sends
 * selections and pulls derived data; the host mints everything else.
 *
 * Privacy (binding): none of these types may carry vector components, source
 * text, keys, labels, distances, or projection coordinates into diagnostics
 * or telemetry. Logging uses counts/bytes/ms/enums only.
 */

import { RequestType } from "vscode-jsonrpc";

// ---------------------------------------------------------------------------
// Evidence (P0-1): where a displayed fact came from
// ---------------------------------------------------------------------------

export type VectorEvidenceSource =
    | "capturedResult" // the query's own result data (RowStore lease)
    | "boundTableSample" // rows read from the bound base table
    | "catalog" // system catalog / DMV facts
    | "diagnosticQuery" // SQL this pane executed (isolated session, disclosed)
    | "localComputation" // computed locally over a bounded sample
    | "interpretation"; // heuristic reading of other evidence — lowest class

export interface VectorEvidenceRecord {
    readonly source: VectorEvidenceSource;
    /** Sample scope stamp when source involves sampled data. */
    readonly sampleDescriptor?: VectorSampleDescriptor;
    /** Epoch ms when the evidence was captured (UI display only). */
    readonly capturedEpochMs?: number;
}

// ---------------------------------------------------------------------------
// Sampling scope (A6: scan-bytes budget disclosed)
// ---------------------------------------------------------------------------

export type VectorPartialReason =
    | "rowBudget"
    | "componentBudget"
    | "byteBudget"
    | "timeBudget"
    | "cancelled"
    | "storeShortRead"
    | "storeCorrupt";

export interface VectorSampleDescriptor {
    /** Rows the analysis actually consumed. */
    readonly sampleRows: number;
    /** Rows in the underlying result set (denominator, honesty). */
    readonly totalRows: number;
    /** Deterministic sampling method; "full" when sampleRows === totalRows. */
    readonly method: "full" | "uniformWindows";
    /** Seed for deterministic re-runs (uniformWindows only). */
    readonly seed?: number;
    /** Rows scanned to build the sample (scan cap disclosure). */
    readonly rowsScanned: number;
    /** Effective budgets (host registry echo — informational, never writable). */
    readonly budget: {
        readonly maxRowsScanned: number;
        readonly maxSampleRows: number;
        readonly maxComponents: number;
        readonly maxPackedBytes: number;
        readonly maxScanBytes: number;
        readonly maxTimeMs: number;
    };
    /** Packed bytes actually ingested. */
    readonly packedBytes: number;
    /** Scan bytes actually consumed (A6 disclosure). */
    readonly scannedBytes: number;
    /** Why the analysis stopped early; absent = ran to completion. */
    readonly partialReason?: VectorPartialReason;
}

// ---------------------------------------------------------------------------
// Findings (P0-2): subject-typed, severity-ordered
// ---------------------------------------------------------------------------

export type VectorFindingSubject =
    | "row"
    | "dimension"
    | "duplicateGroup"
    | "pair"
    | "category"
    | "document"
    | "index"
    | "model"
    | "chunk";

export type VectorFindingSeverity = "error" | "warning" | "info";

export type VectorFindingKind =
    | "nonFiniteComponents"
    | "zeroVectors"
    | "nearZeroVectors"
    | "normOutliers"
    | "duplicateVectors"
    | "nearConstantDimensions"
    | "centroidDistanceOutliers"
    | "groupGeometryDiffers"
    | "staleSourceText" // P1-4 freshness: source modified after embedding
    | "provenanceMismatch"; // P1-3: mixed/unexpected embedding provenance

export interface VectorFindingSummary {
    readonly kind: VectorFindingKind;
    readonly subject: VectorFindingSubject;
    readonly severity: VectorFindingSeverity;
    /** How many subjects are affected (rows, dimensions, groups, …). */
    readonly affectedCount: number;
    /** Evidence class for this finding's basis. */
    readonly evidence: VectorEvidenceRecord;
    /** Bounded drill-in payload; fetched lazily via vector/getFindingDetail. */
    readonly hasDetail: boolean;
}

/** Drill-in rows for one finding (bounded; result-row ordinals only). */
export interface VectorFindingDetail {
    readonly kind: VectorFindingKind;
    readonly subject: VectorFindingSubject;
    /** Zero-based result-row ordinals (detached identity) — capped. */
    readonly resultRowOrdinals?: readonly number[];
    /** Affected dimension ordinals (subject "dimension") — capped. */
    readonly dimensionOrdinals?: readonly number[];
    /** Per-subject scalar facts (norms, variances) aligned with the ordinal list. */
    readonly values?: readonly number[];
    /** True when the list was capped (never silent). */
    readonly truncated: boolean;
    readonly evidence: VectorEvidenceRecord;
}

// ---------------------------------------------------------------------------
// Profile analysis results (P0-8: analyzed vs rendered separate)
// ---------------------------------------------------------------------------

export interface VectorHistogram {
    /** Inclusive lower bound of the first bucket. */
    readonly min: number;
    /** Exclusive upper bound of the last bucket. */
    readonly max: number;
    readonly bucketCounts: readonly number[];
    readonly p5: number;
    readonly median: number;
    readonly p95: number;
}

export interface VectorNormsSummary {
    readonly l2: VectorHistogram;
    readonly l1: VectorHistogram;
    readonly linf: VectorHistogram;
    readonly nearZeroCount: number;
    /** near-zero threshold used (disclosed, not hidden policy). */
    readonly nearZeroEpsilon: number;
}

export interface VectorDimensionVarianceEntry {
    /** Zero-based dimension ordinal (display is 1-based). */
    readonly dimension: number;
    readonly variance: number;
}

export interface VectorProfileSummary {
    readonly evidence: VectorEvidenceRecord;
    readonly sample: VectorSampleDescriptor;
    readonly dimensions: number;
    readonly baseType: "float32";
    readonly nullCount: number;
    readonly unavailableCount: number;
    readonly norms: VectorNormsSummary;
    /** Top + bottom per-dimension variance (bounded lists). */
    readonly varianceTop: readonly VectorDimensionVarianceEntry[];
    readonly varianceBottom: readonly VectorDimensionVarianceEntry[];
    readonly findings: readonly VectorFindingSummary[];
    /** Sampled pair-distance histogram (metric + pair count disclosed). */
    readonly pairDistances?: VectorHistogram & {
        readonly metric: "cosine";
        readonly pairCount: number;
    };
}

// ---------------------------------------------------------------------------
// Projection (VEC-6): deterministic PCA 2D — derived coordinates only
// ---------------------------------------------------------------------------

/**
 * Render cap for projection point payloads (P0-8). Analyzed and rendered
 * counts are SEPARATE fields — the render cap is a payload bound, never a
 * sample: every analyzed row went through the PCA, only the point list sent
 * to the webview is thinned. Copy must never call the rendered subset
 * "sampled".
 */
export const VECTOR_PROJECTION_RENDER_CAP = 1200;

export interface VectorProjectionPoint {
    /** Zero-based result-row ordinal (detached identity). */
    readonly ordinal: number;
    /** PC1 score (projection coordinate — allowed to the webview, banned from logs). */
    readonly x: number;
    /** PC2 score. */
    readonly y: number;
}

export interface VectorProjectionSummary {
    /** Rendered points (≤ renderCap; evenly thinned from the analyzed rows). */
    readonly points: readonly VectorProjectionPoint[];
    /** Rows the PCA actually analyzed (finite vectors in the sample). */
    readonly analyzedCount: number;
    /** Points in this payload — separate from analyzedCount (P0-8). */
    readonly renderedCount: number;
    readonly renderCap: number;
    /** Explained variance of PC1/PC2 as a % of total sampled variance. */
    readonly pc1VariancePct: number;
    readonly pc2VariancePct: number;
    /** Estimated next component ("next z% not shown" in the truth banner). */
    readonly nextVariancePct: number;
    /** Original space dimensionality (truth banner: distances live there). */
    readonly dimensions: number;
    readonly evidence: VectorEvidenceRecord;
    readonly sample: VectorSampleDescriptor;
}

// ---------------------------------------------------------------------------
// Compare (VEC-6): 2..8 selected result rows — derived numbers only
// ---------------------------------------------------------------------------

export const VECTOR_COMPARE_MIN_ROWS = 2;
export const VECTOR_COMPARE_MAX_ROWS = 8;
/** Bounded top-|Δ| / top-contribution list length. */
export const VECTOR_COMPARE_TOP_DIMENSIONS = 5;

export interface VectorCompareItem {
    /** Zero-based result-row ordinal (basket identity). */
    readonly ordinal: number;
    readonly dimensions: number;
    readonly l2: number;
    readonly l1: number;
    readonly linf: number;
}

/**
 * Pairwise value matrices, indexed by basket position. Diagonal is the metric
 * identity (0 for distances). `null` marks an undefined value — zero-norm
 * cosine is undefined, never coerced to 0 or 1.
 */
export interface VectorPairwiseMatrices {
    readonly cosine: ReadonlyArray<ReadonlyArray<number | null>>;
    readonly euclidean: ReadonlyArray<ReadonlyArray<number>>;
    readonly negativeDot: ReadonlyArray<ReadonlyArray<number>>;
}

export interface VectorCompareDimensionEntry {
    /** Zero-based dimension ordinal (display is 1-based). */
    readonly dimension: number;
    /** Signed value: componentwise Δ (a−b) or contribution (aᵢ·bᵢ). */
    readonly value: number;
}

export interface VectorCompareSummary {
    /** Metric the summary aggregates use (named — never a "% similar"). */
    readonly metric: "cosine";
    /** Basket index minimizing mean distance to the others; null if undefined. */
    readonly medoidIndex: number | null;
    /** Basket index maximizing mean distance to the others. */
    readonly mostIsolatedIndex: number | null;
    readonly mostIsolatedAvgDistance: number | null;
    readonly closestPair: {
        readonly a: number;
        readonly b: number;
        readonly distance: number;
    } | null;
    readonly avgPairDistance: number | null;
    /** Items sharing the selection's dimensionality (all, by construction). */
    readonly compatibleCount: number;
}

export interface VectorCompareBody {
    readonly items: readonly VectorCompareItem[];
    readonly pairwise: VectorPairwiseMatrices;
    /** Top |Δ| dimensions for the FIRST pair (A ↔ B) — bounded, signed a−b. */
    readonly topDeltaDimensions: readonly VectorCompareDimensionEntry[];
    /** Top |aᵢ·bᵢ| contribution dimensions for the FIRST pair — bounded. */
    readonly topContributions: readonly VectorCompareDimensionEntry[];
    readonly summary: VectorCompareSummary;
    readonly evidence: VectorEvidenceRecord;
}

// ---------------------------------------------------------------------------
// Pull RPC (opaque handles; host mints everything)
// ---------------------------------------------------------------------------

/**
 * Method names (vscode-jsonrpc, "qs/vector." prefix — every handler is
 * auto-spanned by the webview controller for Debug Console coverage).
 */
export const VECTOR_RPC = {
    open: "qs/vector.open",
    profile: "qs/vector.profile",
    projection: "qs/vector.projection",
    compare: "qs/vector.compare",
    findingDetail: "qs/vector.findingDetail",
    cancel: "qs/vector.cancel",
    close: "qs/vector.close",
} as const;

export interface QsVectorOpenParams {
    /** Result set the user selected (webview authority ends here). */
    readonly resultSetId: string;
    /** Column ordinal of the vector column. */
    readonly columnOrdinal: number;
}

export interface QsVectorOpenResult {
    /** Opaque analysis-session handle (host-minted, random). */
    readonly handle: string;
    /** Generation stamp — stale responses are discarded by comparison. */
    readonly generation: number;
    readonly dimensions?: number;
    readonly transport: "binary-v1" | "textFallback";
    readonly totalRows: number;
    /** Registry echo so the UI can render honest budget copy. */
    readonly effectiveBudget: VectorSampleDescriptor["budget"];
    /** Refused honestly (gate off, no lease, wrong column, store gone). */
    readonly error?: string;
}

export interface QsVectorProfileParams {
    readonly handle: string;
}

export interface QsVectorProfileResult {
    readonly generation: number;
    readonly summary?: VectorProfileSummary;
    /** Honest failure text (budget exceeded pre-flight, store disposed, …). */
    readonly error?: string;
}

export interface QsVectorProjectionParams {
    readonly handle: string;
}

export interface QsVectorProjectionResult {
    readonly generation: number;
    readonly projection?: VectorProjectionSummary;
    /** Honest failure text (time budget, store disposed, cancelled, …). */
    readonly error?: string;
}

export interface QsVectorCompareParams {
    readonly handle: string;
    /** 2..8 zero-based result-row ordinals (validated host-side). */
    readonly ordinals: readonly number[];
}

export interface QsVectorCompareResult {
    readonly generation: number;
    readonly compare?: VectorCompareBody;
    readonly error?: string;
}

export interface QsVectorFindingDetailParams {
    readonly handle: string;
    readonly kind: VectorFindingKind;
}

export interface QsVectorFindingDetailResult {
    readonly generation: number;
    readonly detail?: VectorFindingDetail;
    readonly error?: string;
}

export interface QsVectorCancelParams {
    readonly handle: string;
}

export interface QsVectorCloseParams {
    readonly handle: string;
}

// vscode-jsonrpc request types (host handlers auto-spanned per method name).
export namespace QsVectorOpenRequest {
    export const type = new RequestType<QsVectorOpenParams, QsVectorOpenResult, void>(
        VECTOR_RPC.open,
    );
}
export namespace QsVectorProfileRequest {
    export const type = new RequestType<QsVectorProfileParams, QsVectorProfileResult, void>(
        VECTOR_RPC.profile,
    );
}
export namespace QsVectorProjectionRequest {
    export const type = new RequestType<QsVectorProjectionParams, QsVectorProjectionResult, void>(
        VECTOR_RPC.projection,
    );
}
export namespace QsVectorCompareRequest {
    export const type = new RequestType<QsVectorCompareParams, QsVectorCompareResult, void>(
        VECTOR_RPC.compare,
    );
}
export namespace QsVectorFindingDetailRequest {
    export const type = new RequestType<
        QsVectorFindingDetailParams,
        QsVectorFindingDetailResult,
        void
    >(VECTOR_RPC.findingDetail);
}
export namespace QsVectorCancelRequest {
    export const type = new RequestType<QsVectorCancelParams, void, void>(VECTOR_RPC.cancel);
}
export namespace QsVectorCloseRequest {
    export const type = new RequestType<QsVectorCloseParams, void, void>(VECTOR_RPC.close);
}
