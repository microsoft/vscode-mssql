/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Vector Workbench INDEX workspace contracts (VEC-9; readiness review P0-3
 * state machine, design addendum A3 findings). Shared host ↔ webview —
 * vscode-jsonrpc only (the vectorCatalog.ts precedent), no vscode/DOM/Node
 * imports.
 *
 * Honesty rules encoded in these shapes (P0-3 + the verified provider
 * matrix, evidence/vector-provider-matrix.md):
 * - The state machine is EXPLICIT: a healthy-current index never carries a
 *   migration script; a legacy index carries one WITH a service-impact
 *   warning; permission degradation says "Health unavailable" and never
 *   renders anything that could read as "Healthy".
 * - Every property names its evidence source; a staleness-like value is
 *   labeled with the column name RESOLVED from the live DMV (verified live:
 *   Azure exposes `graph_catchup_pending_percent`, not the documented
 *   `approximate_staleness_percent`).
 * - `$.Version` absent from build_parameters is NOT legacy — on SQL Server
 *   2025 RTM absence IS the current format (guide §8.3 corrected reality;
 *   probed, never assumed).
 * - Every script is GENERATED ONLY: this pane never executes any of them.
 */

import { RequestType } from "vscode-jsonrpc";

// ---------------------------------------------------------------------------
// State machine (P0-3): explicit, mutually exclusive workspace states
// ---------------------------------------------------------------------------

/**
 * - `healthyCurrent`: a confirmed vector index in the current format for THIS
 *   engine (Azure `$.Version >= 3`, or RTM with no Version key at all).
 *   Migration is HIDDEN — never offered for a current-format index.
 * - `legacyFormat`: confirmed index with `$.Version < 3`. Migration script is
 *   offered with the service-impact warning ABOVE the script.
 * - `noIndex`: no confirmed vector index on the target (includes the
 *   transient phantom-row case, which carries an explanatory finding).
 * - `buildFailedTier`: a recent CREATE VECTOR INDEX failed with the tier /
 *   resource build error observed in the wild (Msg 42234 on serverless).
 * - `permissionDegraded`: the index catalog (or its join partners) could not
 *   be read — facts are partial; the UI says "Health unavailable", NEVER
 *   "Healthy".
 * - `noVectorColumns`: probe discovery found no vector columns and no vector
 *   indexes — there is nothing for this workspace to describe.
 */
export type VectorIndexWorkspaceState =
    | "healthyCurrent"
    | "legacyFormat"
    | "formatUnknown"
    | "noIndex"
    | "buildFailedTier"
    | "permissionDegraded"
    | "noVectorColumns";

// ---------------------------------------------------------------------------
// Properties (label/value/source — the PROPERTIES grid of the mock)
// ---------------------------------------------------------------------------

/**
 * Where a displayed fact came from (source tint in the properties grid):
 * - `catalog`: sys.vector_indexes / sys.indexes / sys.objects.
 * - `healthDmv`: sys.dm_db_vector_indexes (column names resolved live).
 * - `config`: database-scoped configurations / sys.configurations.
 * - `engine`: SERVERPROPERTY facts.
 * - `derived`: computed/explanatory value derived from probe facts (still
 *   probe-grounded — never invented).
 */
export type VectorIndexFactSource = "catalog" | "healthDmv" | "config" | "engine" | "derived";

export interface VectorIndexProperty {
    readonly label: string;
    readonly value: string;
    readonly source: VectorIndexFactSource;
}

// ---------------------------------------------------------------------------
// Findings (severity icons + factual title + method/detail line)
// ---------------------------------------------------------------------------

export type VectorIndexFindingSeverity = "error" | "warning" | "info" | "success";

export interface VectorIndexFinding {
    readonly severity: VectorIndexFindingSeverity;
    /** Factual title (e.g. "TRUNCATE TABLE blocked while index exists"). */
    readonly title: string;
    /** Method / consequence / attribution line (10–11px mono in the view). */
    readonly detail: string;
}

// ---------------------------------------------------------------------------
// Scripts (ALL generated-only — never executed by this pane)
// ---------------------------------------------------------------------------

export type VectorIndexScriptId =
    | "createIndex"
    | "migration"
    | "healthSnapshot"
    | "enablePreview"
    | "supportingIndex";

export interface VectorIndexScript {
    readonly id: VectorIndexScriptId;
    /** Command-list title (e.g. "Generate create vector index script"). */
    readonly title: string;
    /** The generated T-SQL. Review-only: this pane NEVER executes it. */
    readonly sql: string;
}

// ---------------------------------------------------------------------------
// The workspace view (one derivation from one probe pass)
// ---------------------------------------------------------------------------

export interface VectorIndexWorkspaceView {
    readonly state: VectorIndexWorkspaceState;
    readonly properties: readonly VectorIndexProperty[];
    readonly findings: readonly VectorIndexFinding[];
    /**
     * Generated-only scripts. Structural guarantee: `migration` appears here
     * ONLY when `state === "legacyFormat"` (P0-3 — a healthy current-format
     * index never offers a destructive migration).
     */
    readonly scripts: readonly VectorIndexScript[];
}

// ---------------------------------------------------------------------------
// Pull RPC (host derives everything; webview asks, never configures)
// ---------------------------------------------------------------------------

export const VECTOR_INDEX_RPC = {
    indexState: "qs/vector.indexState",
} as const;

export interface QsVectorIndexStateParams {
    /** Workbench handle scopes target discovery and cancellation. */
    readonly handle: string;
    /** Bypass the capability cache (explicit user refresh only). */
    readonly refresh?: boolean;
    /** Opaque host-owned target binding selected in Search. */
    readonly targetId?: string;
    readonly metric?: "cosine" | "euclidean" | "dot";
    /** Host revalidates these names against the binding whitelist. */
    readonly filterColumns?: readonly string[];
    /**
     * Result metadata is only a discovery hint. The host resolves it against
     * freshly catalog-verified targets and refuses ambiguous matches.
     */
    readonly resultVectorColumn?: string;
    readonly resultDimensions?: number;
}

export interface QsVectorIndexStateResult {
    readonly view?: VectorIndexWorkspaceView;
    /** Honest refusal (no connection, no aux session) — never a fake state. */
    readonly error?: string;
}

export namespace QsVectorIndexStateRequest {
    export const type = new RequestType<QsVectorIndexStateParams, QsVectorIndexStateResult, void>(
        VECTOR_INDEX_RPC.indexState,
    );
}
