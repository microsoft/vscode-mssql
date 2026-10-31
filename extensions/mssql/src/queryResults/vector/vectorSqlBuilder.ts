/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * VectorSqlBuilder (VEC-8 foundation): pure, deterministic generation of the
 * Search workspace's exact / approximate T-SQL plus the recall-evidence math.
 * No I/O, no session state — the VEC-7 probe service supplies `ProbeFacts`
 * and an executor binds the emitted parameters.
 *
 * Non-negotiables encoded here (r01 UX spec §8, r03 addenda, provider matrix):
 * - Displayed SQL == executed SQL: everything the statement does is in its
 *   text; user VALUES never appear in the text — they ride typed parameters.
 * - Every identifier is QUOTENAME-escaped (`[x]` with `]]` doubling).
 * - P0-10 frozen query vector: ONE JSON-array parameter (`@qv`) shared by
 *   every variant of a comparison; each statement declares
 *   `DECLARE @q VECTOR(d) = CAST(@qv AS VECTOR(d));` and reuses `@q`.
 * - P0-6 structured exclusion policy: source row excluded by KEY, exact
 *   vector duplicates excluded by KEY LIST (float equality against the
 *   vector column is wrong), same-document exclusion by document column —
 *   all structured, never raw predicate SQL; exact and approximate variants
 *   share the identical exclusion predicate.
 * - P0-7 read consistency: the builder emits NO isolation hints and never
 *   changes database settings; `declaredReadConsistency` only DECLARES what
 *   the session ran under.
 * - A1 filtered-ANN semantics: the host supplies proof for the exact bound
 *   index. Current/v3 indexes keep TOP_N at K and disclose iterative
 *   traversal; verified earlier semantics oversample to K×M and disclose
 *   post-filtering; unknown formats conservatively oversample but remain
 *   explicitly unverified.
 * - Evidence honesty: `TOP (n) WITH APPROXIMATE` and `FORCE_ANN_ONLY` are
 *   REJECTED on both verified targets, so a successful TVF run can only ever
 *   earn "Approximate requested, strategy unverified".
 */

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

export interface VectorSearchTarget {
    readonly schema: string;
    readonly table: string;
    /** Stable key column used for tie-breaks, exclusions, and recall identity. */
    readonly keyColumn: string;
    readonly vectorColumn: string;
    /** Optional human-readable label column included in the select list. */
    readonly labelColumn?: string;
}

export type VectorMetric = "cosine" | "euclidean" | "dot";

/** One AND-combined structured predicate (r01 §8: AND-only builder; values are parameterized). */
export interface StructuredPredicate {
    readonly column: string;
    readonly op: "eq" | "ne" | "gt" | "lt" | "ge" | "le";
    readonly value: string | number | boolean | null;
}

/**
 * P0-6 exclusion policy, structured. The brief's `keyPredicateSql?: string`
 * is deliberately replaced by `keyPredicate` — a structured key predicate —
 * so no raw SQL ever crosses this boundary.
 */
export interface VectorSearchExclusionPolicy {
    readonly excludeSourceRow: boolean;
    readonly excludeExactVectorDuplicates: boolean;
    readonly excludeSameDocument?: boolean;
    /** Structured facts the exclusion flags need; required by the flags that use them. */
    readonly keyPredicate?: VectorSearchKeyPredicate;
}

/** Structured replacement for the brief's raw `keyPredicateSql`. */
export interface VectorSearchKeyPredicate {
    /** Source row's key value (required when `excludeSourceRow`). */
    readonly sourceRowKey?: string | number;
    /**
     * Keys of rows whose stored vectors are exact (byte-equal) duplicates of
     * the query vector, identified UPSTREAM (profile pass). Exclusion is by
     * key list — never `vectorColumn <> @q` (float equality is unreliable).
     * Required (may be empty) when `excludeExactVectorDuplicates`.
     */
    readonly exactDuplicateKeys?: readonly (string | number)[];
    /** Document identity column (required when `excludeSameDocument`). */
    readonly documentColumn?: string;
    /** Source row's document value (required when `excludeSameDocument`). */
    readonly sourceDocumentValue?: string | number;
}

/**
 * Probe facts consumed from the VEC-7 syntax/capability probe service (DA A8:
 * probes are mandatory — the guide's current/legacy split is inverted on RTM).
 * The probe service adapts its richer result to this input shape.
 */
export interface ProbeFacts {
    /** Legacy-form TVF `VECTOR_SEARCH(..., TOP_N = n)` acceptance on the target. */
    readonly vectorSearchTvf: "accepted" | "rejected" | "needsPreview";
    /** `SELECT TOP (n) ... WITH APPROXIMATE` acceptance (rejected on all verified targets). */
    readonly withApproximate: "accepted" | "rejected";
}

export interface VectorSearchSqlRequest {
    readonly target: VectorSearchTarget;
    readonly metric: VectorMetric;
    readonly k: number;
    readonly predicates?: readonly StructuredPredicate[];
    readonly exclusion?: VectorSearchExclusionPolicy;
    /** Frozen query vector as a JSON numeric-array literal (P0-10: obtained ONCE). */
    readonly queryVectorJson: string;
    readonly dims: number;
}

export interface VectorApproxSearchRequest extends VectorSearchSqlRequest {
    readonly probeFacts: ProbeFacts;
    /**
     * Host-derived proof of how this exact confirmed index applies filters.
     * This is deliberately required at the SQL-builder boundary and is never
     * accepted from a webview request.
     */
    readonly annFilterCapability: VectorAnnFilterCapability;
    /** Host-configured oversample multiplier M for post-filtered TVF searches (A1). */
    readonly oversampleMultiplier?: number;
}

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

export type SqlParameterType = "nvarchar" | "float" | "bigint" | "bit" | "vector";

export interface SqlParameter {
    /** Parameter name including the `@` prefix. */
    readonly name: string;
    readonly type: SqlParameterType;
    /** For `vector`: the frozen JSON array text (bound as text, cast by the DECLARE header). */
    readonly value: string | number | boolean;
}

export interface VectorSearchSql {
    readonly sql: string;
    readonly parameters: readonly SqlParameter[];
}

/** Catalog/engine proof supplied by the extension host, never by the webview. */
export type VectorAnnFilterCapability = "verifiedIterative" | "verifiedPostFilter" | "unknown";

export type VectorFilterSemantics =
    | "noFilter"
    | "iterative"
    | "postFilteredOversample"
    | "unknownConservativeOversample";

export interface VectorApproxSearchSql extends VectorSearchSql {
    /**
     * How filters relate to the approximate retrieval, based only on
     * host-verified index/engine facts. Unknown formats are conservatively
     * oversampled but remain explicitly unverified.
     */
    readonly filterSemantics: VectorFilterSemantics;
    /** Present when verified/possible post-filtering forced a TOP_N oversample. */
    readonly disclosedMultiplier?: number;
    /** The literal TOP_N emitted into the statement (k, or k×M when post-filtered). */
    readonly topN: number;
    /** UX-spec disclosure line, e.g. "Post-filtered, TOP_N ×5". Present with the oversample. */
    readonly disclosure?: string;
}

export interface VectorSearchUnavailable {
    readonly unavailable: string;
}

/** Evidence taxonomy for this engine generation (UX spec §8 execution evidence). */
export type VectorExecutionEvidence =
    | "exactGroundTruth"
    | "approxStrategyUnverified"
    | "noCompatibleIndex"
    | "syntaxUnavailable";

/** Display copy per evidence state (label copy per UX spec — never a green check for syntax alone). */
export const VECTOR_EXECUTION_EVIDENCE_COPY: Record<VectorExecutionEvidence, string> = {
    exactGroundTruth: "Exact ground truth (full VECTOR_DISTANCE scan)",
    approxStrategyUnverified: "Approximate requested, strategy unverified",
    noCompatibleIndex: "No compatible vector index",
    syntaxUnavailable: "Approximate search syntax unavailable on this connection",
};

export interface VectorComparisonSql {
    readonly exact: { readonly sql: string };
    readonly approx:
        | {
              readonly sql: string;
              readonly filterSemantics: VectorFilterSemantics;
              readonly disclosedMultiplier?: number;
              readonly topN: number;
              readonly disclosure?: string;
          }
        | VectorSearchUnavailable;
    /** ONE shared parameter list: the frozen `@qv` (P0-10), `@k`, predicate and exclusion values. */
    readonly parameters: readonly SqlParameter[];
    readonly exactEvidence: "exactGroundTruth";
    readonly approxEvidence: VectorExecutionEvidence;
    /** Name of the single frozen query-vector parameter shared by all variants. */
    readonly queryVectorParameterName: string;
    /** P0-6 visible evidence lines (source row / duplicates / same document). */
    readonly exclusionDisclosures: readonly string[];
}

export interface VectorRecallComparison {
    /** overlap / min(k, |exact|); undefined when exact returned no rows (denominator 0). */
    readonly recallAtK?: number;
    readonly overlap: number;
    readonly exactCount: number;
    readonly approxCount: number;
    readonly exactOnly: readonly (string | number)[];
    readonly approxOnly: readonly (string | number)[];
    readonly denominatorDisclosure: string;
}

// ---------------------------------------------------------------------------
// Identifier / value hygiene
// ---------------------------------------------------------------------------

/** QUOTENAME-equivalent bracket quoting: `[name]` with `]` doubled to `]]`. */
export function quoteIdentifier(name: string): string {
    if (typeof name !== "string" || name.length === 0) {
        throw new Error("vectorSqlBuilder: identifier must be a non-empty string");
    }
    if (name.length > 128) {
        throw new Error(`vectorSqlBuilder: identifier exceeds 128 characters: ${name.length}`);
    }
    return `[${name.replace(/]/g, "]]")}]`;
}

const METRIC_SQL: Record<VectorMetric, string> = {
    cosine: "cosine",
    euclidean: "euclidean",
    dot: "dot",
};

function metricSql(metric: VectorMetric): string {
    const mapped = METRIC_SQL[metric];
    if (mapped === undefined) {
        throw new Error(`vectorSqlBuilder: unsupported metric ${String(metric)}`);
    }
    return mapped;
}

function assertPositiveInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`vectorSqlBuilder: ${label} must be a positive integer (got ${value})`);
    }
}

/** Validates the frozen query vector text ONCE (P0-10): JSON array of `dims` finite numbers. */
export function validateQueryVectorJson(queryVectorJson: string, dims: number): void {
    assertPositiveInteger(dims, "dims");
    let parsed: unknown;
    try {
        parsed = JSON.parse(queryVectorJson);
    } catch {
        throw new Error("vectorSqlBuilder: query vector is not valid JSON");
    }
    if (!Array.isArray(parsed)) {
        throw new Error("vectorSqlBuilder: query vector JSON must be a flat numeric array");
    }
    if (parsed.length !== dims) {
        throw new Error(
            `vectorSqlBuilder: query vector has ${parsed.length} components, expected ${dims}`,
        );
    }
    for (const component of parsed) {
        if (typeof component !== "number" || !Number.isFinite(component)) {
            throw new Error("vectorSqlBuilder: query vector components must be finite numbers");
        }
    }
}

function parameterTypeForValue(value: string | number | boolean, label: string): SqlParameterType {
    if (typeof value === "string") {
        return "nvarchar";
    }
    if (typeof value === "boolean") {
        return "bit";
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new Error(`vectorSqlBuilder: ${label} must be finite`);
        }
        return Number.isInteger(value) ? "bigint" : "float";
    }
    throw new Error(`vectorSqlBuilder: unsupported ${label} value type`);
}

// ---------------------------------------------------------------------------
// Shared fragments (built once per comparison so both variants are identical)
// ---------------------------------------------------------------------------

const QUERY_VECTOR_PARAM = "@qv";
const K_PARAM = "@k";
/** Fixed, builder-owned aliases (never user input). */
const TABLE_ALIAS = "t";
const TVF_ALIAS = "s";

interface SqlFragments {
    /** WHERE fragments from structured predicates + exclusions (no IS NOT NULL guard). */
    readonly filterFragments: readonly string[];
    /** Every parameter both variants share (frozen @qv first, then @k, then values). */
    readonly parameters: readonly SqlParameter[];
    readonly exclusionDisclosures: readonly string[];
}

const PREDICATE_OP_SQL: Record<StructuredPredicate["op"], string> = {
    eq: "=",
    ne: "<>",
    gt: ">",
    lt: "<",
    ge: ">=",
    le: "<=",
};

function buildPredicateFragments(
    predicates: readonly StructuredPredicate[],
    parameters: SqlParameter[],
): string[] {
    const fragments: string[] = [];
    predicates.forEach((predicate, index) => {
        const column = `${TABLE_ALIAS}.${quoteIdentifier(predicate.column)}`;
        if (predicate.value === null) {
            if (predicate.op === "eq") {
                fragments.push(`${column} IS NULL`);
                return;
            }
            if (predicate.op === "ne") {
                fragments.push(`${column} IS NOT NULL`);
                return;
            }
            throw new Error(
                `vectorSqlBuilder: predicate on ${predicate.column}: NULL only supports eq/ne`,
            );
        }
        const op = PREDICATE_OP_SQL[predicate.op];
        if (op === undefined) {
            throw new Error(`vectorSqlBuilder: unsupported predicate op ${String(predicate.op)}`);
        }
        const name = `@p${index}`;
        parameters.push({
            name,
            type: parameterTypeForValue(predicate.value, `predicate ${predicate.column}`),
            value: predicate.value,
        });
        fragments.push(`${column} ${op} ${name}`);
    });
    return fragments;
}

function buildExclusionFragments(
    target: VectorSearchTarget,
    exclusion: VectorSearchExclusionPolicy,
    parameters: SqlParameter[],
): { fragments: string[]; disclosures: string[] } {
    const fragments: string[] = [];
    const disclosures: string[] = [];
    const keyColumn = `${TABLE_ALIAS}.${quoteIdentifier(target.keyColumn)}`;
    const keyPredicate = exclusion.keyPredicate;

    if (exclusion.excludeSourceRow) {
        const sourceRowKey = keyPredicate?.sourceRowKey;
        if (sourceRowKey === undefined) {
            throw new Error(
                "vectorSqlBuilder: excludeSourceRow requires keyPredicate.sourceRowKey",
            );
        }
        parameters.push({
            name: "@xsrc",
            type: parameterTypeForValue(sourceRowKey, "source row key"),
            value: sourceRowKey,
        });
        fragments.push(`${keyColumn} <> @xsrc`);
        disclosures.push(
            `Source row excluded by key: ${target.keyColumn} <> ${String(sourceRowKey)}`,
        );
    } else {
        disclosures.push("Source row included");
    }

    if (exclusion.excludeExactVectorDuplicates) {
        const duplicateKeys = keyPredicate?.exactDuplicateKeys;
        if (duplicateKeys === undefined) {
            throw new Error(
                "vectorSqlBuilder: excludeExactVectorDuplicates requires " +
                    "keyPredicate.exactDuplicateKeys (exclusion is by key list, " +
                    "never float equality on the vector column)",
            );
        }
        if (duplicateKeys.length > 0) {
            const names = duplicateKeys.map((key, index) => {
                const name = `@xdup${index}`;
                parameters.push({
                    name,
                    type: parameterTypeForValue(key, "duplicate key"),
                    value: key,
                });
                return name;
            });
            fragments.push(`${keyColumn} NOT IN (${names.join(", ")})`);
        }
        disclosures.push(
            `Exact vector duplicates excluded by key list (${duplicateKeys.length} known duplicate rows)`,
        );
    } else {
        disclosures.push("Exact vector duplicates included");
    }

    if (exclusion.excludeSameDocument === true) {
        const documentColumn = keyPredicate?.documentColumn;
        const sourceDocumentValue = keyPredicate?.sourceDocumentValue;
        if (documentColumn === undefined || sourceDocumentValue === undefined) {
            throw new Error(
                "vectorSqlBuilder: excludeSameDocument requires keyPredicate.documentColumn " +
                    "and keyPredicate.sourceDocumentValue",
            );
        }
        const docColumn = `${TABLE_ALIAS}.${quoteIdentifier(documentColumn)}`;
        parameters.push({
            name: "@xdoc",
            type: parameterTypeForValue(sourceDocumentValue, "source document value"),
            value: sourceDocumentValue,
        });
        // NULL-document rows are NOT the same document; keep them eligible.
        fragments.push(`(${docColumn} <> @xdoc OR ${docColumn} IS NULL)`);
        disclosures.push(
            `Same-document chunks excluded: ${documentColumn} <> ${String(sourceDocumentValue)}`,
        );
    } else {
        disclosures.push("Same-document chunks included");
    }

    return { fragments, disclosures };
}

function buildFragments(request: VectorSearchSqlRequest): SqlFragments {
    assertPositiveInteger(request.k, "k");
    validateQueryVectorJson(request.queryVectorJson, request.dims);
    metricSql(request.metric); // validate early even for callers that only read fragments

    const parameters: SqlParameter[] = [
        { name: QUERY_VECTOR_PARAM, type: "vector", value: request.queryVectorJson },
        { name: K_PARAM, type: "bigint", value: request.k },
    ];
    const filterFragments: string[] = [];
    let exclusionDisclosures: string[] = [];

    filterFragments.push(...buildPredicateFragments(request.predicates ?? [], parameters));
    if (request.exclusion !== undefined) {
        const built = buildExclusionFragments(request.target, request.exclusion, parameters);
        filterFragments.push(...built.fragments);
        exclusionDisclosures = built.disclosures;
    }
    return { filterFragments, parameters, exclusionDisclosures };
}

/** `DECLARE @q VECTOR(d) = CAST(@qv AS VECTOR(d));` — the single frozen vector (P0-10). */
function declareHeader(dims: number): string {
    return `DECLARE @q VECTOR(${dims}) = CAST(${QUERY_VECTOR_PARAM} AS VECTOR(${dims}));`;
}

function selectColumns(target: VectorSearchTarget, distanceExpression: string): string {
    const columns = [`${TABLE_ALIAS}.${quoteIdentifier(target.keyColumn)}`];
    if (target.labelColumn !== undefined) {
        columns.push(`${TABLE_ALIAS}.${quoteIdentifier(target.labelColumn)}`);
    }
    columns.push(`${distanceExpression} AS [distance]`);
    return columns.join(",\n    ");
}

/** Deterministic tie-break: distance first, then the stable key (r01 §8). */
function orderByClause(target: VectorSearchTarget): string {
    return `ORDER BY [distance] ASC, ${TABLE_ALIAS}.${quoteIdentifier(target.keyColumn)} ASC;`;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Exact ground truth: full `VECTOR_DISTANCE` scan — the recall denominator.
 * Never uses an index hint or isolation hint.
 */
export function buildExactSearch(request: VectorSearchSqlRequest): VectorSearchSql {
    const fragments = buildFragments(request);
    return {
        sql: renderExactSql(request, fragments.filterFragments),
        parameters: fragments.parameters,
    };
}

function renderExactSql(
    request: VectorSearchSqlRequest,
    filterFragments: readonly string[],
): string {
    const target = request.target;
    const vectorColumn = `${TABLE_ALIAS}.${quoteIdentifier(target.vectorColumn)}`;
    const where = [`${vectorColumn} IS NOT NULL`, ...filterFragments];
    return [
        "-- Vector Workbench — exact ground truth (full VECTOR_DISTANCE scan; no vector index required).",
        `-- Frozen query vector: ${QUERY_VECTOR_PARAM} is bound once and shared across all comparison variants.`,
        declareHeader(request.dims),
        `SELECT TOP (${K_PARAM})`,
        `    ${selectColumns(target, `VECTOR_DISTANCE('${metricSql(request.metric)}', ${vectorColumn}, @q)`)}`,
        `FROM ${quoteIdentifier(target.schema)}.${quoteIdentifier(target.table)} AS ${TABLE_ALIAS}`,
        `WHERE ${where.join("\n    AND ")}`,
        orderByClause(target),
    ].join("\n");
}

export const DEFAULT_OVERSAMPLE_MULTIPLIER = 5;

/**
 * Approximate search on the VERIFIED surface of this engine generation: the
 * `VECTOR_SEARCH(..., TOP_N = n)` TVF (provider matrix: the TVF works on SQL
 * 2025 RTM with preview + index and parses on Azure with preview; `WITH
 * APPROXIMATE` is rejected everywhere). Gated on VEC-7 probe facts — when the
 * TVF is not accepted this returns `{ unavailable }` instead of SQL.
 */
export function buildApproxSearch(
    request: VectorApproxSearchRequest,
): VectorApproxSearchSql | VectorSearchUnavailable {
    const unavailable = approxUnavailableReason(request.probeFacts);
    if (unavailable !== undefined) {
        return { unavailable };
    }
    const fragments = buildFragments(request);
    return renderApproxSql(request, fragments);
}

function approxUnavailableReason(probeFacts: ProbeFacts): string | undefined {
    switch (probeFacts.vectorSearchTvf) {
        case "accepted":
            return undefined;
        case "needsPreview":
            return (
                "VECTOR_SEARCH is parse-gated by PREVIEW_FEATURES on this database " +
                "(probe: needsPreview). The workbench never changes database configuration; " +
                "generate the enablement script for review, or run exact search only."
            );
        case "rejected":
            return (
                "VECTOR_SEARCH is not accepted on this connection (probe: rejected). " +
                "Exact search remains available."
            );
        default:
            return `VECTOR_SEARCH probe state unknown (${String(probeFacts.vectorSearchTvf)}).`;
    }
}

function renderApproxSql(
    request: VectorApproxSearchRequest,
    fragments: SqlFragments,
): VectorApproxSearchSql {
    const target = request.target;
    const multiplier = request.oversampleMultiplier ?? DEFAULT_OVERSAMPLE_MULTIPLIER;
    assertPositiveInteger(multiplier, "oversampleMultiplier");

    const hasFilters = fragments.filterFragments.length > 0;
    const oversample = hasFilters && request.annFilterCapability !== "verifiedIterative";
    const topN = oversample ? request.k * multiplier : request.k;
    assertPositiveInteger(topN, "TOP_N");

    let filterSemantics: VectorFilterSemantics = "noFilter";
    let disclosure: string | undefined;
    if (hasFilters) {
        switch (request.annFilterCapability) {
            case "verifiedIterative":
                filterSemantics = "iterative";
                disclosure = "Iterative filtering (during traversal)";
                break;
            case "verifiedPostFilter":
                filterSemantics = "postFilteredOversample";
                disclosure = `Post-filtered, TOP_N ×${multiplier}`;
                break;
            case "unknown":
                filterSemantics = "unknownConservativeOversample";
                disclosure = `Unverified filter behavior; conservative post-filter TOP_N ×${multiplier}`;
                break;
            default:
                throw new Error(
                    `vectorSqlBuilder: unsupported ANN filter capability ${String(request.annFilterCapability)}`,
                );
        }
    }
    const commentLines = [
        "-- Vector Workbench — approximate (VECTOR_SEARCH TVF, TOP_N form; verified surface of this engine generation).",
        `-- Evidence: ${VECTOR_EXECUTION_EVIDENCE_COPY.approxStrategyUnverified} — no forced-ANN proof mechanism exists on this target.`,
        `-- Frozen query vector: ${QUERY_VECTOR_PARAM} is bound once and shared across all comparison variants.`,
    ];
    if (hasFilters) {
        switch (filterSemantics) {
            case "iterative":
                commentLines.push(
                    `-- Filter semantics: iterative filtering during traversal (verified for the bound current-format index); TOP_N = K = ${topN}.`,
                );
                break;
            case "postFilteredOversample":
                commentLines.push(
                    `-- Filter semantics: post-filtered after approximate retrieval; TOP_N oversampled ×${multiplier} (TOP_N = ${topN}).`,
                );
                break;
            case "unknownConservativeOversample":
                commentLines.push(
                    `-- Filter semantics: unverified for the bound index; conservatively treated as post-filtered and TOP_N oversampled ×${multiplier} (TOP_N = ${topN}).`,
                );
                break;
        }
    }

    const whereClause =
        fragments.filterFragments.length > 0
            ? [`WHERE ${fragments.filterFragments.join("\n    AND ")}`]
            : [];
    const sql = [
        ...commentLines,
        declareHeader(request.dims),
        `SELECT TOP (${K_PARAM})`,
        `    ${selectColumns(target, `${TVF_ALIAS}.[distance]`)}`,
        "FROM VECTOR_SEARCH(",
        `    TABLE = ${quoteIdentifier(target.schema)}.${quoteIdentifier(target.table)} AS ${TABLE_ALIAS},`,
        `    COLUMN = ${quoteIdentifier(target.vectorColumn)},`,
        "    SIMILAR_TO = @q,",
        `    METRIC = '${metricSql(request.metric)}',`,
        `    TOP_N = ${topN}`,
        `) AS ${TVF_ALIAS}`,
        ...whereClause,
        orderByClause(target),
    ].join("\n");

    return {
        sql,
        parameters: fragments.parameters,
        filterSemantics,
        disclosedMultiplier: oversample ? multiplier : undefined,
        topN,
        disclosure,
    };
}

/** Classifies approximate execution evidence from probe facts (never from syntax hope). */
export function classifyApproxEvidence(probeFacts: ProbeFacts): VectorExecutionEvidence {
    return probeFacts.vectorSearchTvf === "accepted"
        ? "approxStrategyUnverified"
        : "syntaxUnavailable";
}

/**
 * Builds the exact + approximate variants of ONE comparison sharing ONE
 * parameter list — the frozen query vector (`@qv`), `@k`, and every predicate
 * and exclusion value are bound once and reused by both statements (P0-10;
 * P0-6 "exact and approximate variants must use the same exclusion predicate").
 */
export function buildComparison(request: VectorApproxSearchRequest): VectorComparisonSql {
    const fragments = buildFragments(request);
    const exactSql = renderExactSql(request, fragments.filterFragments);
    const unavailable = approxUnavailableReason(request.probeFacts);
    let approx: VectorComparisonSql["approx"];
    if (unavailable !== undefined) {
        approx = { unavailable };
    } else {
        const built = renderApproxSql(request, fragments);
        approx = {
            sql: built.sql,
            filterSemantics: built.filterSemantics,
            disclosedMultiplier: built.disclosedMultiplier,
            topN: built.topN,
            disclosure: built.disclosure,
        };
    }
    return {
        exact: { sql: exactSql },
        approx,
        parameters: fragments.parameters,
        exactEvidence: "exactGroundTruth",
        approxEvidence: classifyApproxEvidence(request.probeFacts),
        queryVectorParameterName: QUERY_VECTOR_PARAM,
        exclusionDisclosures: fragments.exclusionDisclosures,
    };
}

// ---------------------------------------------------------------------------
// Recall evidence (r01 §8: recall@K = overlap / min(K, |E|), disclosed denominator)
// ---------------------------------------------------------------------------

export function buildRecallComparison(
    exactKeys: readonly (string | number)[],
    approxKeys: readonly (string | number)[],
    k: number,
): VectorRecallComparison {
    assertPositiveInteger(k, "k");
    const exact = dedupe(exactKeys);
    const approx = dedupe(approxKeys);
    const approxSet = new Set(approx);
    const exactSet = new Set(exact);

    const overlap = exact.filter((key) => approxSet.has(key)).length;
    const exactOnly = exact.filter((key) => !approxSet.has(key));
    const approxOnly = approx.filter((key) => !exactSet.has(key));
    const denominator = Math.min(k, exact.length);

    let recallAtK: number | undefined;
    let denominatorDisclosure: string;
    if (denominator === 0) {
        recallAtK = undefined;
        denominatorDisclosure = `Recall@${k} undefined: exact search returned no eligible rows`;
    } else {
        recallAtK = overlap / denominator;
        denominatorDisclosure =
            exact.length < k
                ? `Recall@${k} denominator = ${exact.length}: exact search returned fewer than K eligible rows`
                : `Recall@${k} denominator = ${k} exact neighbors`;
    }

    return {
        recallAtK,
        overlap,
        exactCount: exact.length,
        approxCount: approx.length,
        exactOnly,
        approxOnly,
        denominatorDisclosure,
    };
}

function dedupe(keys: readonly (string | number)[]): (string | number)[] {
    const seen = new Set<string | number>();
    const result: (string | number)[] = [];
    for (const key of keys) {
        if (!seen.has(key)) {
            seen.add(key);
            result.push(key);
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// Read-consistency declaration (P0-7)
// ---------------------------------------------------------------------------

/**
 * The builder emits NO isolation hints and NEVER enables snapshot isolation.
 * This only DECLARES what the diagnostic session ran under so the evidence
 * panel can state it (P0-7).
 */
export function declaredReadConsistency(sessionDefault: string): string {
    const normalized = sessionDefault
        .trim()
        .toLowerCase()
        .replace(/[_\s-]+/g, " ");
    if (
        normalized === "read only snapshot transaction" ||
        normalized === "one read only snapshot transaction" ||
        normalized === "snapshot transaction"
    ) {
        return "Read consistency: one read-only snapshot transaction";
    }
    if (normalized === "snapshot" || normalized === "database snapshot isolation") {
        return "Read consistency: database snapshot isolation";
    }
    if (normalized === "read committed" || normalized === "readcommitted") {
        return "Read consistency: read committed; concurrent changes may affect comparison";
    }
    // Unknown/other levels are declared verbatim — never upgraded, never guessed.
    return `Read consistency: ${sessionDefault.trim()}; concurrent changes may affect comparison`;
}
