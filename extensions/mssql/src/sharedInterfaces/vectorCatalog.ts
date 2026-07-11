/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Vector capability/catalog probe contracts (VEC-7; design addendum A3/A4/A8,
 * readiness review P0-4/P0-5). Shared host ↔ webview — vscode-jsonrpc only
 * (the vectorWorkbench.ts precedent), no vscode/DOM/Node imports.
 *
 * Probe honesty is structural: every probed fact is either a value with its
 * evidence stamp, or an explicit absence with the reason it could not be
 * determined. A probe result NEVER invents a capability — the verified live
 * surface (evidence/vector-provider-matrix.md) shows the same symbol set
 * differs between SQL Server 2025 RTM and Azure SQL DB (health DMV absent on
 * RTM; `build_parameters.$.Version` present only on Azure; phantom
 * `sys.vector_indexes` rows on failed Azure builds), so nothing here may be
 * assumed from an engine name alone.
 *
 * Privacy (binding): probe results carry catalog metadata only — never
 * connection strings, credentials, endpoint URL query strings, source text,
 * or vector components.
 */

import { RequestType } from "vscode-jsonrpc";

// ---------------------------------------------------------------------------
// Capability ladder (VEC-7): what the workbench can honestly do here
// ---------------------------------------------------------------------------

/**
 * Ordered evidence classes for the Vector Workbench on one connection. Rungs
 * are facts, not grades — the UI stands on the rung it proved, never higher:
 *
 * - `typedResult` (A): typed vector transport negotiated for captured results.
 * - `textFallback` (B): vectors visible as JSON text only (no typed cells).
 * - `tableBound` (C): base-table binding + catalog probes available.
 * - `modelEnabled` (D): an EMBEDDINGS external model is configured (configured
 *   ≠ reachable — a successful confirmed call is separate evidence).
 * - `limitedPermissions` (E): catalog/DMV visibility is degraded; facts are
 *   partial and the UI must say so rather than render blanks as zeros.
 */
export type VectorCapabilityLadderRung =
    | "typedResult"
    | "textFallback"
    | "tableBound"
    | "modelEnabled"
    | "limitedPermissions";

// ---------------------------------------------------------------------------
// Evidence stamp (P0-1 vocabulary subset used by probes)
// ---------------------------------------------------------------------------

/** Probes read the catalog or execute diagnostic SQL — nothing else. */
export type VectorProbeEvidenceSource = "catalog" | "diagnosticQuery";

export interface VectorProbeEvidence {
    readonly source: VectorProbeEvidenceSource;
    /** Epoch ms when this section was captured (UI display only). */
    readonly capturedEpochMs: number;
}

// ---------------------------------------------------------------------------
// Probe sections (each tolerant: value or honest absence, never a throw)
// ---------------------------------------------------------------------------

export interface VectorEngineIdentityProbe {
    readonly evidence: VectorProbeEvidence;
    readonly productVersion?: string;
    /** serverproperty('Edition') display name (e.g. "SQL Azure"). */
    readonly edition?: string;
    /** Numeric serverproperty('EngineEdition') — 5 = Azure SQL DB, 8 = MI. */
    readonly engineEditionId?: number;
    readonly database?: string;
    readonly compatibilityLevel?: number;
    /** Honest absence: why identity could not be read. */
    readonly error?: string;
}

/**
 * One database-scoped configuration (PREVIEW_FEATURES /
 * ALLOW_STALE_VECTOR_INDEX). `present:false` is a real fact: verified live,
 * ALLOW_STALE_VECTOR_INDEX does not exist on SQL 2025 RTM but does on Azure.
 */
export interface VectorScopedConfigProbe {
    readonly evidence: VectorProbeEvidence;
    /** The configuration name exists on this engine. */
    readonly present: boolean;
    /** Parsed value when present (0/1 → boolean). */
    readonly enabled?: boolean;
    readonly error?: string;
}

/** CAST('[1,2,3]' AS VECTOR(3)) + VECTORPROPERTY round-trip. */
export interface VectorTypeProbe {
    readonly evidence: VectorProbeEvidence;
    readonly usable: boolean;
    readonly error?: string;
}

/** sys.columns vector metadata columns (vector_dimensions et al.). */
export interface VectorColumnMetadataProbe {
    readonly evidence: VectorProbeEvidence;
    readonly vectorDimensionsPresent: boolean;
    /** All `vector*` column names found on sys.columns. */
    readonly columns: readonly string[];
    readonly error?: string;
}

export interface VectorIndexProbeRow {
    readonly schemaName: string;
    readonly tableName: string;
    readonly indexName: string;
    /** e.g. "DiskANN" — column is `vector_index_type` (never `_desc`). */
    readonly indexType?: string;
    /** e.g. "COSINE" — column is `distance_metric` (never `_desc`). */
    readonly distanceMetric?: string;
    /** Raw build_parameters JSON text (shape differs per engine). */
    readonly buildParameters?: string;
    /**
     * `$.Version` from build_parameters when the key exists (Azure carries
     * it; RTM does not — absence here is NOT "legacy", it is "unversioned").
     */
    readonly version?: number;
}

export interface VectorIndexCatalogProbe {
    readonly evidence: VectorProbeEvidence;
    /** sys.vector_indexes was queryable at all. */
    readonly available: boolean;
    /** Rows CONFIRMED by the sys.indexes join (phantom residue excluded). */
    readonly indexes: readonly VectorIndexProbeRow[];
    /**
     * sys.vector_indexes rows absent from sys.indexes — the transient
     * residue a failed Azure DiskANN build leaves behind (verified live:
     * unusable, undroppable, self-cleans). Counted honestly, never usable.
     */
    readonly phantomCount: number;
    readonly error?: string;
}

/**
 * sys.dm_db_vector_indexes with COLUMN-NAME RESOLUTION: the guide's assumed
 * names are wrong on Azure (`graph_catchup_pending_percent`, not
 * `approximate_staleness_percent`; `last_background_task_execution_time`,
 * not `last_background_task_time`) — so column names are resolved from
 * sys.all_columns at probe time and values are returned as name→value maps.
 */
export interface VectorHealthDmvProbe {
    readonly evidence: VectorProbeEvidence;
    readonly present: boolean;
    /** Resolved column names, catalog order (empty when absent). */
    readonly columns: readonly string[];
    /** Staleness-like column resolved dynamically, when one exists. */
    readonly stalenessColumn?: string;
    /** Last-background-task-like column resolved dynamically. */
    readonly lastTaskColumn?: string;
    /** DMV rows as columnName → text value (bounded; absent when no DMV). */
    readonly rows?: readonly Readonly<Record<string, string | null>>[];
    readonly error?: string;
}

// ---------------------------------------------------------------------------
// External models (P0-4: database-scoped names + owner; A4: egress class)
// ---------------------------------------------------------------------------

/**
 * Egress class per API_FORMAT (addendum A4 / readiness P0-5 layered claim):
 * - `externalEgress`: SQL Server calls an external endpoint — text leaves
 *   your environment ('Azure OpenAI', 'OpenAI').
 * - `hostLocal`: host-local endpoint — text leaves the database engine but
 *   not the host ('Ollama').
 * - `inProcess`: local ONNX runtime on the SQL Server host — no network
 *   egress ('ONNX' / 'ONNX Runtime').
 * - `unknown`: unrecognized API_FORMAT — never guessed downward.
 */
export type VectorModelEgressClass = "externalEgress" | "hostLocal" | "inProcess" | "unknown";

export function classifyModelEgress(apiFormat: string | undefined): VectorModelEgressClass {
    switch ((apiFormat ?? "").trim().toLowerCase()) {
        case "azure openai":
        case "openai":
            return "externalEgress";
        case "ollama":
            return "hostLocal";
        case "onnx":
        case "onnx runtime":
            return "inProcess";
        default:
            return "unknown";
    }
}

/**
 * One EMBEDDINGS external model. Models are DATABASE-SCOPED objects with an
 * owner principal — NEVER schema-qualified (P0-4): display as
 * `Model <name> / Owner <owner>`, not `dbo.<name>`.
 */
export interface VectorExternalModelProbeRow {
    readonly name: string;
    /** Owner principal (USER_NAME of principal_id) — not a schema. */
    readonly owner?: string;
    /** API_FORMAT verbatim ('Azure OpenAI' | 'OpenAI' | 'Ollama' | 'ONNX' …). */
    readonly apiFormat?: string;
    /** MODEL_TYPE — probes filter to EMBEDDINGS server-side (A9). */
    readonly modelType?: string;
    /** Provider model string (e.g. "text-embedding-3-small"). */
    readonly providerModel?: string;
    /** Endpoint HOST only — the URL path/query string never leaves the probe. */
    readonly endpointHost?: string;
    /** Model modify time (reproducibility identity, P0-4). */
    readonly modifyTime?: string;
    readonly egress: VectorModelEgressClass;
}

export interface VectorExternalModelsProbe {
    readonly evidence: VectorProbeEvidence;
    /** sys.external_models was queryable at all. */
    readonly available: boolean;
    readonly models: readonly VectorExternalModelProbeRow[];
    readonly error?: string;
}

/**
 * Server configuration gates (box/MI; A3). Verified live: rows exist on both
 * engines but values differ (Azure defaults `external rest endpoint enabled`
 * to 1). Absence of a row is honest `undefined`, not false.
 */
export interface VectorServerConfigProbe {
    readonly evidence: VectorProbeEvidence;
    readonly externalRestEndpointEnabled?: boolean;
    readonly externalAiRuntimesEnabled?: boolean;
    readonly error?: string;
}

// ---------------------------------------------------------------------------
// Syntax-acceptance probes (A8 — template selection is evidence-backed)
// ---------------------------------------------------------------------------

/**
 * - `accepted`: the construct got past the parser (a bind-time "cannot find a
 *   vector index" or missing-object message still proves syntax acceptance —
 *   the message rides along).
 * - `needsPreview`: parse-rejected while PREVIEW_FEATURES is known OFF
 *   (verified live: PREVIEW_FEATURES gates VECTOR_SEARCH parse acceptance).
 * - `rejected`: parse-rejected (or the probe could not classify) — message
 *   carried verbatim.
 * - `notProbed`: the probe did not run (no session, disposed early).
 */
export type VectorSyntaxProbeStatus = "accepted" | "rejected" | "needsPreview" | "notProbed";

export interface VectorSyntaxProbe {
    readonly evidence: VectorProbeEvidence;
    readonly status: VectorSyntaxProbeStatus;
    /** Server message text when not a clean acceptance (bounded, verbatim). */
    readonly message?: string;
    /** Probe target table ("schema.table") — absent when none existed. */
    readonly target?: string;
}

// ---------------------------------------------------------------------------
// The full probe result
// ---------------------------------------------------------------------------

export interface VectorCapabilityProbe {
    /** Stamp for the probe run as a whole (sections carry their own). */
    readonly evidence: VectorProbeEvidence;
    readonly engine: VectorEngineIdentityProbe;
    readonly previewFeatures: VectorScopedConfigProbe;
    readonly allowStaleVectorIndex: VectorScopedConfigProbe;
    readonly vectorType: VectorTypeProbe;
    readonly columnMetadata: VectorColumnMetadataProbe;
    readonly indexes: VectorIndexCatalogProbe;
    readonly healthDmv: VectorHealthDmvProbe;
    readonly externalModels: VectorExternalModelsProbe;
    readonly serverConfig: VectorServerConfigProbe;
    /** VECTOR_SEARCH TVF parse acceptance (works on RTM w/ preview ON). */
    readonly vectorSearchTvf: VectorSyntaxProbe;
    /** TOP (n) WITH APPROXIMATE — rejected on BOTH verified engines today. */
    readonly topNWithApproximate: VectorSyntaxProbe;
}

// ---------------------------------------------------------------------------
// Pull RPC (host mints everything; webview asks, never configures)
// ---------------------------------------------------------------------------

export const VECTOR_CATALOG_RPC = {
    capabilities: "qs/vector.capabilities",
} as const;

export interface QsVectorCapabilitiesParams {
    /** Bypass the host-side cache (explicit user refresh only). */
    readonly refresh?: boolean;
}

export interface QsVectorCapabilitiesResult {
    readonly probe?: VectorCapabilityProbe;
    /** Honest refusal (no connection, no aux session, data plane off). */
    readonly error?: string;
}

export namespace QsVectorCapabilitiesRequest {
    export const type = new RequestType<
        QsVectorCapabilitiesParams,
        QsVectorCapabilitiesResult,
        void
    >(VECTOR_CATALOG_RPC.capabilities);
}
