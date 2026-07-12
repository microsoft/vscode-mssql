/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * VectorSearchService (VEC-8): executes the Search workspace's exact /
 * approximate comparison on ONE auxiliary diagnostic session and returns the
 * evidence-stamped result contract. The pure SQL comes from vectorSqlBuilder;
 * this layer owns exactly what the builder does not:
 *
 * 1. The frozen query vector (P0-10): resolved ONCE — a selected result row
 *    is sparse-fetched through the Vector Workbench session's store lease and
 *    codec-decoded to JSON-array text; a pasted vector is validated and
 *    canonicalized — then the SAME text rides every variant.
 * 2. Literal inlining at the execution edge: the data plane's
 *    ISqlSession.execute takes SQL TEXT ONLY (STS2 v2/query.execute has no
 *    parameter binding today), so the builder's parameterized output is
 *    inlined through a SAFE literal encoder (numbers via strict finite/
 *    safe-integer validation, strings/vector JSON via N'…' with '' doubling).
 *    The DISPLAYED SQL is the inlined text — displayed == executed holds
 *    byte-for-byte.
 * 3. Session discipline: both variants run SEQUENTIALLY on one aux session
 *    (DocumentSessionBinding.acquireAuxiliarySession("vectorDiagnostics") via
 *    the injected thunk), disposed in a finally. Search statements run
 *    priority "interactive", commandKind "user", tag "queryStudio:vectorSearch".
 * 4. Evidence honesty: probe facts gate the approximate variant (probe
 *    "notProbed" adapts to "rejected" — never hope); a missing/phantom index
 *    yields `noCompatibleIndex` evidence with the approximate variant skipped
 *    while exact still runs; read consistency is DECLARED from the session's
 *    actual isolation level; timings are one wall-clock observation each.
 *
 * Observability: only the registered `mssql.queryResults.vector.ingest`
 * marker (phase safeEnum + counts) — never keys, labels, distances, SQL text,
 * or vector components.
 */

import * as crypto from "crypto";
import { Perf } from "../../perf/perfTelemetry";
import { IQueryEventSink, ISqlSession, QueryHandle } from "../../services/sqlDataPlane/api";
import {
    decodeVectorFloat32,
    vectorJsonArrayText,
} from "../../sharedInterfaces/queryResultCellCodec";
import {
    QsVectorCapabilitiesResult,
    VectorCapabilityProbe,
    VectorExternalModelProbeRow,
    VectorIndexProbeRow,
    VectorModelEgressClass,
} from "../../sharedInterfaces/vectorCatalog";
import {
    QsVectorSearchComparison,
    QsVectorSearchModelExecuteResult,
    QsVectorSearchModelPrepareParams,
    QsVectorSearchModelPrepareResult,
    QsVectorSearchModelsResult,
    QsVectorSearchParams,
    QsVectorSearchResult,
    QsVectorSearchTargetsResult,
    VECTOR_SEARCH_DEFAULT_K,
    VECTOR_SEARCH_MAX_K,
    VECTOR_SEARCH_MIN_K,
    VECTOR_SEARCH_MODEL_PARAMETERS_MAX_UTF8_BYTES,
    VECTOR_SEARCH_MODEL_TEXT_MAX_CHARS,
    VECTOR_SEARCH_MODEL_TEXT_MAX_UTF8_BYTES,
    VECTOR_SEARCH_MODEL_TOKEN_TTL_MS,
    VECTOR_SEARCH_TIMING_DISCLOSURE,
    VectorSearchEvidenceRow,
    VectorSearchNeighborRow,
    VectorSearchRankRow,
    VectorSearchModelDescriptor,
    VectorSearchModelInfo,
    VectorSearchTargetInfo,
} from "../../sharedInterfaces/vectorSearch";
import { AuxiliarySessionLease } from "./vectorCapabilityService";
import {
    buildComparison,
    buildRecallComparison,
    declaredReadConsistency,
    ProbeFacts,
    SqlParameter,
    VECTOR_EXECUTION_EVIDENCE_COPY,
    VectorAnnFilterCapability,
    VectorComparisonSql,
} from "./vectorSqlBuilder";
import { VectorWorkbenchSessionFacts } from "./vectorWorkbenchService";
import type { VectorIndexTargetFacts } from "./vectorIndexService";
import type { VectorProbeTableFilter } from "./vectorCatalogProbes";
import { VectorModelStatementCounter } from "./vectorModelStatementCounter";
import {
    buildPipelineModelVerificationSql,
    escapeNString,
    estimatePayloadKiB,
    executionCopyForEgress,
    parseFreshVectorJson,
    quoteSqlIdentifier,
    VECTOR_MODEL_CALL_TAG,
} from "./vectorPipelineService";
import {
    evaluateVectorExpression,
    VECTOR_EXPRESSION_SYMBOLS,
    VectorExpressionBasket,
    VectorExpressionError,
} from "./vectorExpression";

export const VECTOR_SEARCH_TAG = "queryStudio:vectorSearch";

// ---------------------------------------------------------------------------
// Dependencies (thunks — the controller wires the document model in)
// ---------------------------------------------------------------------------

export interface VectorSearchServiceDeps {
    /** Auxiliary diagnostic session lease (undefined = honest refusal). */
    readonly auxSession: () => Promise<AuxiliarySessionLease | undefined>;
    /** Separate session purpose for the explicitly consented external-model call. */
    readonly auxModelSession: () => Promise<AuxiliarySessionLease | undefined>;
    /** VEC-7 capability probe (cached by VectorCapabilityService). */
    readonly capabilities: (
        refresh: boolean,
        table?: VectorProbeTableFilter,
    ) => Promise<QsVectorCapabilitiesResult>;
    /** Scoped Workbench facts — frozen-vector fetch and run-lifetime guard. */
    readonly workbench: (handle: string) => VectorWorkbenchSessionFacts | undefined;
    /** A1 oversample multiplier for post-filtered TVF searches (default 5). */
    readonly oversampleMultiplier?: number;
    /** Controller-owned so renderer navigation cannot discard issued-statement evidence. */
    readonly modelStatements?: VectorModelStatementCounter;
}

// ---------------------------------------------------------------------------
// Catalog SQL (exported so gated live tests execute the exact product text)
// ---------------------------------------------------------------------------

/**
 * Search-target discovery: vector columns on user tables, with a
 * single-column UNIQUE key (PK preferred), a display-label heuristic (first
 * character-typed column), and a sys.partitions row estimate. Requires an
 * engine whose sys.columns carries vector metadata — on engines without the
 * vector type the statement fails and the result is an honest error.
 */
export const VECTOR_SEARCH_TARGETS_SQL = [
    "SELECT TOP (64)",
    "    CONVERT(nvarchar(128), SCHEMA_NAME(o.schema_id)),",
    "    CONVERT(nvarchar(128), o.name),",
    "    CONVERT(nvarchar(128), c.name),",
    "    TRY_CONVERT(int, c.vector_dimensions),",
    "    CONVERT(nvarchar(128), k.key_column),",
    "    CASE WHEN k.key_column IS NOT NULL THEN 1 ELSE 0 END,",
    "    CONVERT(nvarchar(128), lbl.label_column),",
    "    TRY_CONVERT(bigint, st.row_estimate),",
    "    TRY_CONVERT(int, o.object_id),",
    "    TRY_CONVERT(int, c.column_id),",
    "    TRY_CONVERT(int, k.key_column_id),",
    "    TRY_CONVERT(int, lbl.label_column_id)",
    "FROM sys.columns c",
    "JOIN sys.objects o ON o.object_id = c.object_id",
    "JOIN sys.types t ON t.user_type_id = c.user_type_id",
    "OUTER APPLY (",
    "    SELECT TOP (1) col.name AS key_column, col.column_id AS key_column_id",
    "    FROM sys.indexes i",
    "    JOIN sys.index_columns ic",
    "        ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0",
    "    JOIN sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id",
    "    WHERE i.object_id = o.object_id",
    "      AND i.is_unique = 1",
    "      AND i.is_disabled = 0",
    "      AND i.is_hypothetical = 0",
    "      AND i.has_filter = 0",
    "      AND ic.is_included_column = 0",
    "      AND ic.key_ordinal = 1",
    "      AND col.is_nullable = 0",
    "      AND 1 = (",
    "          SELECT COUNT(*) FROM sys.index_columns ic2",
    "          WHERE ic2.object_id = i.object_id AND ic2.index_id = i.index_id",
    "            AND ic2.is_included_column = 0",
    "      )",
    "    ORDER BY i.is_primary_key DESC, i.index_id ASC",
    ") k",
    "OUTER APPLY (",
    "    SELECT TOP (1) lc.name AS label_column, lc.column_id AS label_column_id",
    "    FROM sys.columns lc",
    "    JOIN sys.types lt ON lt.user_type_id = lc.user_type_id",
    "    WHERE lc.object_id = o.object_id",
    "      AND lt.name IN (N'nvarchar', N'varchar', N'nchar', N'char')",
    "      AND lc.max_length > 0 AND lc.max_length <= 512",
    "    ORDER BY lc.column_id",
    ") lbl",
    "OUTER APPLY (",
    "    SELECT SUM(p.rows) AS row_estimate",
    "    FROM sys.partitions p",
    "    WHERE p.object_id = o.object_id AND p.index_id IN (0, 1)",
    ") st",
    "WHERE t.name = N'vector' AND o.type = 'U'",
    "ORDER BY o.name, c.column_id;",
].join("\n");

/** Scalar columns offered by the structured AND-only filter builder. */
export const VECTOR_SEARCH_FILTER_COLUMNS_SQL = [
    "SELECT TOP (1024)",
    "    CONVERT(nvarchar(128), SCHEMA_NAME(o.schema_id)),",
    "    CONVERT(nvarchar(128), o.name),",
    "    CONVERT(nvarchar(128), c.name),",
    "    CONVERT(nvarchar(128), t.name),",
    "    TRY_CONVERT(int, o.object_id),",
    "    TRY_CONVERT(int, c.column_id),",
    "    TRY_CONVERT(int, c.max_length),",
    "    TRY_CONVERT(int, c.precision),",
    "    TRY_CONVERT(int, c.scale)",
    "FROM sys.columns c",
    "JOIN sys.objects o ON o.object_id = c.object_id",
    "JOIN sys.types t ON t.user_type_id = c.user_type_id",
    "WHERE o.type = 'U'",
    "  AND t.name IN (N'bit', N'tinyint', N'smallint', N'int', N'bigint',",
    "      N'decimal', N'numeric', N'money', N'smallmoney', N'real', N'float',",
    "      N'char', N'varchar', N'nchar', N'nvarchar', N'uniqueidentifier',",
    "      N'date', N'time', N'smalldatetime', N'datetime', N'datetime2', N'datetimeoffset')",
    "  AND EXISTS (",
    "      SELECT 1",
    "      FROM sys.columns vc",
    "      JOIN sys.types vt ON vt.user_type_id = vc.user_type_id",
    "      WHERE vc.object_id = o.object_id AND vt.name = N'vector'",
    "  )",
    "ORDER BY o.name, c.column_id;",
].join("\n");

/**
 * Isolation-level declaration (P0-7): the service NEVER sets isolation — it
 * reads what the aux session actually runs under so the evidence panel can
 * state it. Level names per sys.dm_exec_sessions documentation.
 */
export const VECTOR_SEARCH_ISOLATION_SQL =
    "SELECT CONVERT(int, transaction_isolation_level) FROM sys.dm_exec_sessions WHERE session_id = @@SPID;";

const ISOLATION_LEVEL_NAMES: Record<number, string> = {
    0: "unspecified",
    1: "read uncommitted",
    2: "read committed",
    3: "repeatable read",
    4: "serializable",
    5: "snapshot",
};

const VECTOR_SEARCH_MAX_PREDICATES = 8;
const VECTOR_SEARCH_MAX_VECTOR_JSON_BYTES = 256 * 1024;
const VECTOR_SEARCH_MAX_DIMENSIONS = 1998;
const VECTOR_SEARCH_MAX_SCALAR_CHARS = 4_000;
const VECTOR_SEARCH_MAX_EXCLUSION_BYTES = 64 * 1024;
const VECTOR_SEARCH_GENERATED_CACHE_LIMIT = 4;

export interface ValidatedSearchModelParameters {
    readonly canonicalJson?: string;
    readonly error?: string;
}

/**
 * Deliberately narrow per-call overrides. Endpoint-specific arbitrary fields
 * can carry secrets or unbounded structures, so Search currently permits
 * only the documented dimensions and SQL retry controls.
 */
export function validateSearchModelParameters(
    input: string | undefined,
): ValidatedSearchModelParameters {
    if (input === undefined || input.trim().length === 0) {
        return {};
    }
    if (Buffer.byteLength(input, "utf8") > VECTOR_SEARCH_MODEL_PARAMETERS_MAX_UTF8_BYTES) {
        return {
            error: `Model parameters exceed ${VECTOR_SEARCH_MODEL_PARAMETERS_MAX_UTF8_BYTES.toLocaleString("en-US")} UTF-8 bytes.`,
        };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(input);
    } catch {
        return { error: "Model parameters are not valid JSON." };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { error: "Model parameters must be a JSON object." };
    }
    const value = parsed as Record<string, unknown>;
    const allowed = new Set(["dimensions", "sql_rest_options"]);
    const unknown = Object.keys(value).find((key) => !allowed.has(key));
    if (unknown) {
        return {
            error: `Model parameter "${unknown}" is not allowed. Search supports only dimensions and sql_rest_options.retry_count.`,
        };
    }
    const canonical: {
        dimensions?: number;
        sql_rest_options?: { retry_count: number };
    } = {};
    if (value.dimensions !== undefined) {
        if (
            !Number.isInteger(value.dimensions) ||
            (value.dimensions as number) < 1 ||
            (value.dimensions as number) > VECTOR_SEARCH_MAX_DIMENSIONS
        ) {
            return {
                error: `dimensions must be an integer from 1 to ${VECTOR_SEARCH_MAX_DIMENSIONS}.`,
            };
        }
        canonical.dimensions = value.dimensions as number;
    }
    if (value.sql_rest_options !== undefined) {
        const rest = value.sql_rest_options;
        if (!rest || typeof rest !== "object" || Array.isArray(rest)) {
            return { error: "sql_rest_options must be a JSON object." };
        }
        const restRecord = rest as Record<string, unknown>;
        if (
            Object.keys(restRecord).length !== 1 ||
            !Object.prototype.hasOwnProperty.call(restRecord, "retry_count") ||
            !Number.isInteger(restRecord.retry_count) ||
            (restRecord.retry_count as number) < 0 ||
            (restRecord.retry_count as number) > 10
        ) {
            return { error: "sql_rest_options supports only retry_count from 0 to 10." };
        }
        canonical.sql_rest_options = { retry_count: restRecord.retry_count as number };
    }
    if (Object.keys(canonical).length === 0) {
        return {
            error: "Model parameters must include dimensions or sql_rest_options.retry_count.",
        };
    }
    return { canonicalJson: JSON.stringify(canonical) };
}

/** Displayed == executed model-call SQL. Values are bounded before this builder. */
export function buildSearchModelSql(
    text: string,
    modelName: string,
    parametersJson?: string,
): string {
    const lines = [`DECLARE @t nvarchar(max) = N'${escapeNString(text)}';`];
    if (parametersJson !== undefined) {
        lines.push(`DECLARE @params JSON = N'${escapeNString(parametersJson)}';`);
    }
    lines.push(
        `SELECT CAST(AI_GENERATE_EMBEDDINGS(@t USE MODEL ${quoteSqlIdentifier(modelName)}${
            parametersJson !== undefined ? " PARAMETERS @params" : ""
        }) AS nvarchar(max)) AS generated;`,
    );
    return lines.join("\n");
}

const INTEGER_TYPES = new Set(["tinyint", "smallint", "int", "bigint"]);
const NUMERIC_TYPES = new Set([
    ...INTEGER_TYPES,
    "decimal",
    "numeric",
    "money",
    "smallmoney",
    "real",
    "float",
]);

function validatePredicates(
    target: VectorSearchTargetInfo,
    predicates: QsVectorSearchParams["predicates"],
): string | undefined {
    if (!predicates) {
        return undefined;
    }
    if (!Array.isArray(predicates)) {
        return "Structured filters must be an array.";
    }
    if (predicates.length > VECTOR_SEARCH_MAX_PREDICATES) {
        return `At most ${VECTOR_SEARCH_MAX_PREDICATES} structured filters are allowed.`;
    }
    const columns = new Map(target.filterColumns.map((column) => [column.name, column] as const));
    for (const predicate of predicates) {
        if (!predicate || typeof predicate !== "object") {
            return "Each structured filter must be an object.";
        }
        if (
            typeof predicate.column !== "string" ||
            predicate.column.length === 0 ||
            predicate.column.length > 128
        ) {
            return "Filter column names must contain 1 to 128 characters.";
        }
        if (!("eq ne gt lt ge le".split(" ") as string[]).includes(predicate.op)) {
            return `Filter operator on ${predicate.column} is not supported.`;
        }
        const column = columns.get(predicate.column);
        if (!column) {
            return `Filter column "${predicate.column}" is not in the verified target binding.`;
        }
        if (predicate.value === null) {
            if (predicate.op !== "eq" && predicate.op !== "ne") {
                return `NULL on ${column.name} supports only equals or not equals.`;
            }
            continue;
        }
        if (column.sqlType === "bit" && typeof predicate.value !== "boolean") {
            return `${column.name} requires a true/false value.`;
        }
        if (NUMERIC_TYPES.has(column.sqlType)) {
            const numericText =
                typeof predicate.value === "string" &&
                predicate.value.length <= 128 &&
                /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(predicate.value);
            if (
                (typeof predicate.value !== "number" || !Number.isFinite(predicate.value)) &&
                !numericText
            ) {
                return `${column.name} requires a finite numeric value.`;
            }
            if (
                INTEGER_TYPES.has(column.sqlType) &&
                !(
                    (typeof predicate.value === "number" &&
                        Number.isSafeInteger(predicate.value)) ||
                    (typeof predicate.value === "string" && /^[+-]?\d+$/.test(predicate.value))
                )
            ) {
                return `${column.name} requires a safe integer value.`;
            }
        } else if (column.sqlType !== "bit" && typeof predicate.value !== "string") {
            return `${column.name} requires a text value.`;
        }
        if (
            typeof predicate.value === "string" &&
            predicate.value.length > VECTOR_SEARCH_MAX_SCALAR_CHARS
        ) {
            return `${column.name} filter text exceeds ${VECTOR_SEARCH_MAX_SCALAR_CHARS.toLocaleString("en-US")} characters.`;
        }
    }
    return undefined;
}

function validateExclusion(
    target: VectorSearchTargetInfo,
    exclusion: QsVectorSearchParams["exclusion"],
): string | undefined {
    if (exclusion === undefined) {
        return undefined;
    }
    if (!exclusion || typeof exclusion !== "object" || Array.isArray(exclusion)) {
        return "The exclusion policy must be a structured object.";
    }
    if (
        typeof exclusion.excludeSourceRow !== "boolean" ||
        typeof exclusion.excludeExactVectorDuplicates !== "boolean" ||
        (exclusion.excludeSameDocument !== undefined &&
            typeof exclusion.excludeSameDocument !== "boolean")
    ) {
        return "Exclusion flags must be true or false.";
    }
    const key = exclusion.keyPredicate;
    if (key !== undefined && (!key || typeof key !== "object" || Array.isArray(key))) {
        return "The exclusion key predicate must be a structured object.";
    }
    const scalarBytes = (value: unknown, label: string): string | number => {
        if (typeof value === "string") {
            if (value.length > VECTOR_SEARCH_MAX_SCALAR_CHARS) {
                return `${label} exceeds ${VECTOR_SEARCH_MAX_SCALAR_CHARS.toLocaleString("en-US")} characters.`;
            }
            return Buffer.byteLength(value, "utf8");
        }
        if (typeof value === "number" && Number.isFinite(value)) {
            return 16;
        }
        return `${label} must be a finite number or bounded string.`;
    };
    let bytes = 0;
    const addScalar = (value: unknown, label: string): string | undefined => {
        const measured = scalarBytes(value, label);
        if (typeof measured === "string") {
            return measured;
        }
        bytes += measured;
        return bytes > VECTOR_SEARCH_MAX_EXCLUSION_BYTES
            ? `Exclusion values exceed ${VECTOR_SEARCH_MAX_EXCLUSION_BYTES.toLocaleString("en-US")} UTF-8 bytes.`
            : undefined;
    };

    if (exclusion.excludeSourceRow) {
        if (key?.sourceRowKey === undefined) {
            return "Source-row exclusion requires a source row key.";
        }
        const error = addScalar(key.sourceRowKey, "The source row key");
        if (error) return error;
    }
    if (exclusion.excludeExactVectorDuplicates) {
        if (!Array.isArray(key?.exactDuplicateKeys)) {
            return "Exact-duplicate exclusion requires a bounded key list.";
        }
        if (key.exactDuplicateKeys.length > 256) {
            return "At most 256 exact-duplicate keys can be excluded in one comparison.";
        }
        for (const duplicate of key.exactDuplicateKeys) {
            const error = addScalar(duplicate, "An exact-duplicate key");
            if (error) return error;
        }
    }
    if (exclusion.excludeSameDocument) {
        if (
            typeof key?.documentColumn !== "string" ||
            key.documentColumn.length === 0 ||
            key.documentColumn.length > 128 ||
            !target.filterColumns.some((column) => column.name === key.documentColumn)
        ) {
            return "The same-document exclusion column is not in the verified binding.";
        }
        if (key.sourceDocumentValue === undefined) {
            return "Same-document exclusion requires a source document value.";
        }
        const error = addScalar(key.sourceDocumentValue, "The source document value");
        if (error) return error;
    }
    return undefined;
}

interface CatalogFilterColumn {
    readonly name: string;
    readonly sqlType: string;
    readonly columnId: number;
    readonly maxLength: number;
    readonly precision: number;
    readonly scale: number;
}

interface CatalogTargetBinding {
    readonly target: VectorSearchTargetInfo;
    readonly objectId: number;
    readonly vectorColumnId: number;
    readonly keyColumnId?: number;
    readonly labelColumnId?: number;
    readonly filterColumns: readonly CatalogFilterColumn[];
}

function exactCatalogName(expression: string, value: string): string {
    // Identifier comparisons must not inherit the database collation. A
    // case-insensitive comparison could otherwise authorize a different
    // identifier than the one minted into the opaque catalog binding.
    return `CONVERT(varbinary(512), ${expression}) = CONVERT(varbinary(512), ${encodeNString(value)})`;
}

function catalogBindingIdentity(binding: CatalogTargetBinding): string {
    const { target } = binding;
    return JSON.stringify([
        binding.objectId,
        binding.vectorColumnId,
        target.schema,
        target.table,
        target.vectorColumn,
        target.dimensions,
        binding.keyColumnId,
        target.keyColumn,
        target.keyIsUnique,
        binding.labelColumnId,
        target.labelColumn,
        binding.filterColumns.map((column) => [
            column.columnId,
            column.name,
            column.sqlType,
            column.maxLength,
            column.precision,
            column.scale,
        ]),
    ]);
}

function targetVerificationSql(
    binding: CatalogTargetBinding,
    requestedFilterColumns: readonly string[],
): string {
    const { target } = binding;
    const dimensions =
        target.dimensions !== undefined
            ? ` AND TRY_CONVERT(int, vc.vector_dimensions) = ${target.dimensions}`
            : "";
    const verification = [
        "SELECT CASE WHEN EXISTS (",
        "    SELECT 1",
        "    FROM sys.objects o",
        "    JOIN sys.columns vc ON vc.object_id = o.object_id",
        "    JOIN sys.types vt ON vt.user_type_id = vc.user_type_id",
        `    WHERE o.object_id = ${binding.objectId}`,
        `      AND ${exactCatalogName("SCHEMA_NAME(o.schema_id)", target.schema)}`,
        `      AND ${exactCatalogName("o.name", target.table)}`,
        `      AND vc.column_id = ${binding.vectorColumnId}`,
        `      AND ${exactCatalogName("vc.name", target.vectorColumn)}`,
        `      AND vt.name = N'vector'${dimensions}`,
        "      AND EXISTS (",
        "          SELECT 1",
        "          FROM sys.indexes i",
        "          JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id",
        "          JOIN sys.columns kc ON kc.object_id = ic.object_id AND kc.column_id = ic.column_id",
        "          WHERE i.object_id = o.object_id",
        "            AND i.is_unique = 1 AND i.is_disabled = 0 AND i.is_hypothetical = 0 AND i.has_filter = 0",
        "            AND ic.is_included_column = 0 AND ic.key_ordinal = 1",
        `            AND kc.column_id = ${binding.keyColumnId ?? -1}`,
        `            AND ${exactCatalogName("kc.name", target.keyColumn ?? "")}`,
        "            AND kc.is_nullable = 0",
        "            AND 1 = (SELECT COUNT(*) FROM sys.index_columns ic2",
        "                     WHERE ic2.object_id = i.object_id AND ic2.index_id = i.index_id",
        "                       AND ic2.is_included_column = 0)",
        "      )",
    ];
    if (target.labelColumn !== undefined && binding.labelColumnId !== undefined) {
        verification.push(
            "      AND EXISTS (SELECT 1 FROM sys.columns lc",
            "                  JOIN sys.types lt ON lt.user_type_id = lc.user_type_id",
            "                  WHERE lc.object_id = o.object_id",
            `                    AND lc.column_id = ${binding.labelColumnId}`,
            `                    AND ${exactCatalogName("lc.name", target.labelColumn)}`,
            "                    AND lt.name IN (N'nvarchar', N'varchar', N'nchar', N'char')",
            "                    AND lc.max_length > 0 AND lc.max_length <= 512)",
        );
    }
    for (const name of new Set(requestedFilterColumns)) {
        const column = binding.filterColumns.find((candidate) => candidate.name === name);
        if (!column) {
            continue;
        }
        verification.push(
            "      AND EXISTS (SELECT 1 FROM sys.columns fc",
            "                  JOIN sys.types ft ON ft.user_type_id = fc.user_type_id",
            "                  WHERE fc.object_id = o.object_id",
            `                    AND fc.column_id = ${column.columnId}`,
            `                    AND ${exactCatalogName("fc.name", column.name)}`,
            `                    AND ${exactCatalogName("ft.name", column.sqlType)}`,
            `                    AND fc.max_length = ${column.maxLength}`,
            `                    AND fc.precision = ${column.precision}`,
            `                    AND fc.scale = ${column.scale})`,
        );
    }
    verification.push(") THEN 1 ELSE 0 END;");
    return verification.join("\n");
}

// ---------------------------------------------------------------------------
// Probe-facts adaptation (documented VEC-8 notes: "notProbed" → "rejected")
// ---------------------------------------------------------------------------

/**
 * Adapt the VEC-7 probe result to the builder's ProbeFacts input. The probe
 * vocabulary has one extra state — "notProbed" — which the builder must treat
 * as REJECTED: an unprobed surface is never assumed available.
 */
export function adaptProbeFacts(probe: VectorCapabilityProbe): ProbeFacts {
    const tvf = probe.vectorSearchTvf.status;
    return {
        vectorSearchTvf: tvf === "notProbed" ? "rejected" : tvf,
        withApproximate: probe.topNWithApproximate.status === "accepted" ? "accepted" : "rejected",
    };
}

/** Builder facts when capabilities could not be probed at all (no session). */
const REFUSED_PROBE_FACTS: ProbeFacts = {
    vectorSearchTvf: "rejected",
    withApproximate: "rejected",
};

/**
 * Classify filter behavior from host-owned catalog and engine evidence for
 * the exact confirmed index. An absent or ambiguous format is never promoted
 * to iterative filtering. SQL Server 2025 RTM's verified unversioned shape
 * retains the earlier post-filter behavior even though it is that engine's
 * current on-box format.
 */
export function deriveAnnFilterCapability(
    probe: VectorCapabilityProbe | undefined,
    index: VectorIndexProbeRow | undefined,
): VectorAnnFilterCapability {
    if (!probe || !index) {
        return "unknown";
    }
    if (index.version !== undefined) {
        return index.version >= 3 ? "verifiedIterative" : "verifiedPostFilter";
    }

    let validJsonWithoutVersion = false;
    try {
        const parsed = index.buildParameters ? JSON.parse(index.buildParameters) : undefined;
        validJsonWithoutVersion =
            parsed !== null &&
            typeof parsed === "object" &&
            !Array.isArray(parsed) &&
            !Object.prototype.hasOwnProperty.call(parsed, "Version");
    } catch {
        validJsonWithoutVersion = false;
    }
    return probe.engine.engineEditionId === 3 &&
        /^17\./.test(probe.engine.productVersion ?? "") &&
        validJsonWithoutVersion
        ? "verifiedPostFilter"
        : "unknown";
}

// ---------------------------------------------------------------------------
// Safe literal encoding (the execution edge; tests prove no injection)
// ---------------------------------------------------------------------------

/** N'…' encoding with '' doubling — the ONLY way text enters a statement. */
function encodeNString(value: string): string {
    return `N'${value.replace(/'/g, "''")}'`;
}

/**
 * Encode one builder parameter as a safe T-SQL literal:
 * - `vector`: value must round-trip JSON.parse to a flat array of finite
 *   numbers (re-validated HERE, independent of upstream checks), then rides
 *   as an N'…' string for the DECLARE header's CAST.
 * - `bigint`: strict safe integer; emitted bare.
 * - `float`: strict finite number; emitted bare (JS number → valid T-SQL).
 * - `bit`: strictly boolean; emitted 1/0.
 * - `nvarchar`: N'…' with '' doubling (brackets/semicolons/unicode inert
 *   inside a string literal once quotes cannot terminate it).
 * Anything that fails validation THROWS — a refused literal is a refused
 * search, never a best-effort string.
 */
export function encodeSqlLiteral(parameter: SqlParameter): string {
    const { name, type, value } = parameter;
    switch (type) {
        case "vector": {
            if (typeof value !== "string") {
                throw new Error(`vectorSearchService: ${name} vector value must be a string`);
            }
            let parsed: unknown;
            try {
                parsed = JSON.parse(value);
            } catch {
                throw new Error(`vectorSearchService: ${name} is not valid JSON`);
            }
            if (
                !Array.isArray(parsed) ||
                parsed.length === 0 ||
                parsed.some(
                    (component) => typeof component !== "number" || !Number.isFinite(component),
                )
            ) {
                throw new Error(
                    `vectorSearchService: ${name} must be a flat JSON array of finite numbers`,
                );
            }
            return encodeNString(value);
        }
        case "bigint": {
            if (typeof value !== "number" || !Number.isSafeInteger(value)) {
                throw new Error(`vectorSearchService: ${name} must be a safe integer`);
            }
            return String(value);
        }
        case "float": {
            if (typeof value !== "number" || !Number.isFinite(value)) {
                throw new Error(`vectorSearchService: ${name} must be a finite number`);
            }
            return String(value);
        }
        case "bit": {
            if (typeof value !== "boolean") {
                throw new Error(`vectorSearchService: ${name} must be a boolean`);
            }
            return value ? "1" : "0";
        }
        case "nvarchar": {
            if (typeof value !== "string") {
                throw new Error(`vectorSearchService: ${name} must be a string`);
            }
            return encodeNString(value);
        }
        default:
            throw new Error(`vectorSearchService: unsupported parameter type ${String(type)}`);
    }
}

const INLINE_HEADER =
    "-- Parameters inlined as validated literals at the execution edge (the data plane binds no parameters).\n" +
    "-- This text is byte-for-byte the statement that executed.";

/**
 * Inline every builder parameter into the SQL text as a safe literal.
 * Replacement is a single lexical pass over the ORIGINAL statement. Tokens
 * inside comments, string literals, bracketed identifiers, and double-quoted
 * identifiers are never touched, and inserted literals are never rescanned.
 * a parameter that never appears in the text throws — that would mean the
 * builder text and parameter list drifted apart.
 */
export function inlineParameters(sql: string, parameters: readonly SqlParameter[]): string {
    const ordered = [...parameters].sort((a, b) => b.name.length - a.name.length);
    const literals = new Map<string, string>();
    for (const parameter of ordered) {
        if (!/^@[A-Za-z_][A-Za-z0-9_$#@]*$/.test(parameter.name)) {
            throw new Error(`vectorSearchService: invalid parameter name ${parameter.name}`);
        }
        if (literals.has(parameter.name)) {
            throw new Error(`vectorSearchService: duplicate parameter ${parameter.name}`);
        }
        literals.set(parameter.name, encodeSqlLiteral(parameter));
    }

    const used = new Set<string>();
    let output = "";
    let state: "code" | "string" | "bracket" | "quoted" | "lineComment" | "blockComment" = "code";
    let blockDepth = 0;
    const tokenChar = (char: string | undefined): boolean =>
        char !== undefined && /[A-Za-z0-9_$#@]/.test(char);

    for (let i = 0; i < sql.length; ) {
        const char = sql[i];
        const next = sql[i + 1];
        if (state === "code") {
            if (char === "-" && next === "-") {
                output += "--";
                i += 2;
                state = "lineComment";
                continue;
            }
            if (char === "/" && next === "*") {
                output += "/*";
                i += 2;
                blockDepth = 1;
                state = "blockComment";
                continue;
            }
            if (char === "'") state = "string";
            else if (char === "[") state = "bracket";
            else if (char === '"') state = "quoted";
            else if (char === "@" && !tokenChar(sql[i - 1])) {
                const name = ordered.find(
                    (parameter) =>
                        sql.startsWith(parameter.name, i) &&
                        !tokenChar(sql[i + parameter.name.length]),
                )?.name;
                if (name) {
                    output += literals.get(name)!;
                    used.add(name);
                    i += name.length;
                    continue;
                }
            }
            output += char;
            i++;
            continue;
        }

        output += char;
        i++;
        if (state === "lineComment") {
            if (char === "\n") state = "code";
        } else if (state === "string" && char === "'") {
            if (next === "'") {
                output += next;
                i++;
            } else {
                state = "code";
            }
        } else if (state === "bracket" && char === "]") {
            if (next === "]") {
                output += next;
                i++;
            } else {
                state = "code";
            }
        } else if (state === "quoted" && char === '"') {
            if (next === '"') {
                output += next;
                i++;
            } else {
                state = "code";
            }
        } else if (state === "blockComment") {
            if (char === "/" && next === "*") {
                output += next;
                i++;
                blockDepth++;
            } else if (char === "*" && next === "/") {
                output += next;
                i++;
                blockDepth--;
                if (blockDepth === 0) state = "code";
            }
        }
    }

    for (const parameter of ordered) {
        if (!used.has(parameter.name)) {
            throw new Error(
                `vectorSearchService: parameter ${parameter.name} does not appear in the statement`,
            );
        }
    }
    return `${INLINE_HEADER}\n${output}`;
}

/** Re-resolve a confirmed model identity immediately before external egress. */
function modelVerificationSql(row: VectorExternalModelProbeRow): string {
    return buildPipelineModelVerificationSql(row.name);
}

function endpointHost(location: string | undefined): string | undefined {
    if (!location) return undefined;
    try {
        return new URL(location).hostname || undefined;
    } catch {
        return undefined;
    }
}

/** Host-side K clamp (1..1000); non-numeric input falls to the default. */
export function clampK(k: unknown): number {
    if (typeof k !== "number" || !Number.isFinite(k)) {
        return VECTOR_SEARCH_DEFAULT_K;
    }
    return Math.min(VECTOR_SEARCH_MAX_K, Math.max(VECTOR_SEARCH_MIN_K, Math.floor(k)));
}

// ---------------------------------------------------------------------------
// Statement execution (row collection over the event sink)
// ---------------------------------------------------------------------------

interface StatementOutcome {
    readonly rows: unknown[][];
    readonly errors: { number?: number; text: string }[];
    /** True only after session.execute returned a handle for this statement. */
    readonly issued: boolean;
    /** First error / status text when the statement did not succeed. */
    readonly failed?: string;
}

/** Match the same catalog identity and normalized endpoint used by Pipeline. */
function verifiedModelMatches(
    outcome: StatementOutcome,
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

/** Bounded busy retry (the executionOrchestrator recipe — one active query). */
async function executeWhenFree(
    session: ISqlSession,
    text: string,
    kind: "search" | "catalog" | "model",
    sink: IQueryEventSink,
    signal?: AbortSignal,
    deadlineMs = 5_000,
): Promise<QueryHandle> {
    const startedAt = Date.now();
    const options =
        kind === "catalog"
            ? ({
                  priority: "background",
                  commandKind: "metadata",
                  tag: VECTOR_SEARCH_TAG,
              } as const)
            : ({
                  priority: "interactive",
                  commandKind: "user",
                  tag: kind === "model" ? VECTOR_MODEL_CALL_TAG : VECTOR_SEARCH_TAG,
                  ...(kind === "model" ? { timeoutMs: 120_000 } : {}),
              } as const);
    for (;;) {
        if (signal?.aborted) {
            throw new Error("The vector search was cancelled.");
        }
        try {
            return session.execute(text, options, sink);
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

async function runStatement(
    session: ISqlSession,
    sql: string,
    kind: "search" | "catalog" | "model",
    control?: {
        readonly signal: AbortSignal;
        readonly onHandle: (handle: QueryHandle | undefined) => void;
    },
): Promise<StatementOutcome> {
    const rows: unknown[][] = [];
    const errors: { number?: number; text: string }[] = [];
    let issued = false;
    try {
        const sink: IQueryEventSink = {
            onResultSetStarted: () => undefined,
            onRowsPage: (page) => {
                rows.push(...page.compact.values);
            },
            onMessage: (message) => {
                if (message.kind === "error") {
                    errors.push({
                        ...(message.number !== undefined ? { number: message.number } : {}),
                        text: message.text,
                    });
                }
            },
            onComplete: () => undefined,
        };
        const handle = await executeWhenFree(session, sql, kind, sink, control?.signal);
        issued = true;
        control?.onHandle(handle);
        let summary;
        try {
            summary = await handle.completion;
        } finally {
            control?.onHandle(undefined);
            await handle.dispose().catch(() => undefined);
        }
        if (control?.signal.aborted) {
            return { rows, errors, issued, failed: "The vector search was cancelled." };
        }
        if (summary.status !== "succeeded") {
            return {
                rows,
                errors,
                issued,
                failed: errors[0]?.text ?? summary.error?.message ?? `query ${summary.status}`,
            };
        }
        return { rows, errors, issued };
    } catch (error) {
        return {
            rows,
            errors,
            issued,
            failed: error instanceof Error ? error.message : String(error),
        };
    }
}

const cellText = (cell: unknown): string | undefined =>
    cell === null || cell === undefined ? undefined : String(cell);

const cellInt = (cell: unknown): number | undefined => {
    if (cell === null || cell === undefined) {
        return undefined;
    }
    const value = typeof cell === "number" ? cell : Number(cell);
    return Number.isFinite(value) ? value : undefined;
};

// ---------------------------------------------------------------------------
// Frozen-vector fetch (reads a scoped Workbench session lease)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

type ResolvedVector =
    | { json: string; dimensions: number; sourceDisclosure: string }
    | { error: string };

interface SearchModelBinding {
    readonly info: VectorSearchModelInfo;
    readonly row: VectorExternalModelProbeRow;
}

interface PendingSearchModelCall {
    readonly handle: string;
    readonly targetId: string;
    readonly modelId: string;
    readonly resultSetId: string;
    readonly vectorColumnOrdinal: number;
    readonly generation: number;
    readonly expectedDimensions: number;
    readonly sql: string;
    readonly descriptor: VectorSearchModelDescriptor;
    readonly expiresAtMs: number;
}

interface CachedGeneratedVector {
    readonly handle: string;
    readonly targetId: string;
    readonly resultSetId: string;
    readonly vectorColumnOrdinal: number;
    readonly generation: number;
    readonly json: string;
    readonly dimensions: number;
}

export class VectorSearchService {
    /** One comparison at a time — both variants share ONE aux session. */
    private running = false;
    /** Opaque binding id -> host-owned catalog facts. Replaced on refresh. */
    private readonly targets = new Map<string, CatalogTargetBinding>();
    private readonly completedResults = new Map<
        string,
        {
            readonly resultSetId: string;
            readonly vectorColumnOrdinal: number;
            readonly targetId: string;
            readonly comparison: QsVectorSearchComparison;
        }
    >();
    /** Opaque model bindings and model output; never serialized into panel state. */
    private readonly modelBindings = new Map<string, SearchModelBinding>();
    private modelsStale = false;
    private readonly pendingModelCalls = new Map<string, PendingSearchModelCall>();
    private readonly pendingModelTokenByHandle = new Map<string, string>();
    private readonly generatedVectors = new Map<string, CachedGeneratedVector>();
    private activeAbortController: AbortController | undefined;
    private activeOperationHandle: string | undefined;
    private activeOperationCompletion: Promise<void> | undefined;
    private settleActiveOperation: (() => void) | undefined;
    private targetDiscovery:
        | { readonly handle?: string; readonly promise: Promise<QsVectorSearchTargetsResult> }
        | undefined;
    private targetsStale = false;
    private readonly activeHandles = new Set<QueryHandle>();
    private readonly modelStatements: VectorModelStatementCounter;
    private disposed = false;

    constructor(
        private readonly deps: VectorSearchServiceDeps,
        private readonly now: () => number = Date.now,
    ) {
        this.modelStatements = deps.modelStatements ?? new VectorModelStatementCounter();
    }

    /** qs/vector.searchTargets — coalesced catalog discovery on the aux session. */
    async searchTargets(handle?: string): Promise<QsVectorSearchTargetsResult> {
        if (this.targetDiscovery && this.targetDiscovery.handle === handle) {
            return this.targetDiscovery.promise;
        }
        const promise = this.discoverTargets(handle);
        const discovery = { ...(handle ? { handle } : {}), promise };
        this.targetDiscovery = discovery;
        try {
            return await promise;
        } finally {
            if (this.targetDiscovery === discovery) {
                this.targetDiscovery = undefined;
            }
        }
    }

    private cachedTargetsWithError(error: string, markStale = true): QsVectorSearchTargetsResult {
        if (markStale) this.targetsStale = this.targets.size > 0;
        const targets = [...this.targets.values()].map((binding) => binding.target);
        return targets.length > 0 ? { targets, error } : { error };
    }

    private async discoverTargets(handle?: string): Promise<QsVectorSearchTargetsResult> {
        if (this.disposed) {
            return { error: "The vector search service is closed." };
        }
        if (this.activeAbortController) {
            return this.cachedTargetsWithError(
                "Another Vector Search operation is still running.",
                false,
            );
        }
        const abortController = new AbortController();
        this.beginOperation(abortController, handle);
        const previousIds = new Map<string, string>(
            [...this.targets.values()].map(
                (binding) => [catalogBindingIdentity(binding), binding.target.id] as const,
            ),
        );
        let lease: AuxiliarySessionLease | undefined;
        try {
            lease = await this.deps.auxSession();
        } catch (error) {
            this.finishOperation(abortController);
            return this.cachedTargetsWithError(
                `Search targets could not be listed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        if (!lease) {
            this.finishOperation(abortController);
            return this.cachedTargetsWithError(
                "No auxiliary diagnostic session is available for this connection.",
            );
        }
        try {
            const outcome = await this.runTrackedStatement(
                lease.session,
                VECTOR_SEARCH_TARGETS_SQL,
                "catalog",
                abortController.signal,
            );
            if (outcome.failed) {
                return this.cachedTargetsWithError(
                    `Search targets could not be listed: ${outcome.failed}`,
                    !abortController.signal.aborted,
                );
            }
            const filtersOutcome = await this.runTrackedStatement(
                lease.session,
                VECTOR_SEARCH_FILTER_COLUMNS_SQL,
                "catalog",
                abortController.signal,
            );
            if (filtersOutcome.failed) {
                return this.cachedTargetsWithError(
                    `Search filter columns could not be listed: ${filtersOutcome.failed}`,
                    !abortController.signal.aborted,
                );
            }
            const filtersByObjectId = new Map<number, CatalogFilterColumn[]>();
            for (const row of filtersOutcome.rows) {
                const name = cellText(row[2]);
                const sqlType = cellText(row[3]);
                const objectId = cellInt(row[4]);
                const columnId = cellInt(row[5]);
                const maxLength = cellInt(row[6]);
                const precision = cellInt(row[7]);
                const scale = cellInt(row[8]);
                if (
                    !name ||
                    !sqlType ||
                    objectId === undefined ||
                    columnId === undefined ||
                    maxLength === undefined ||
                    precision === undefined ||
                    scale === undefined
                ) {
                    continue;
                }
                const existing = filtersByObjectId.get(objectId) ?? [];
                existing.push({
                    name,
                    sqlType: sqlType.toLowerCase(),
                    columnId,
                    maxLength,
                    precision,
                    scale,
                });
                filtersByObjectId.set(objectId, existing);
            }
            const targets: VectorSearchTargetInfo[] = [];
            const bindings: CatalogTargetBinding[] = [];
            for (const row of outcome.rows) {
                const schema = cellText(row[0]);
                const table = cellText(row[1]);
                const vectorColumn = cellText(row[2]);
                const objectId = cellInt(row[8]);
                const vectorColumnId = cellInt(row[9]);
                if (
                    !schema ||
                    !table ||
                    !vectorColumn ||
                    objectId === undefined ||
                    vectorColumnId === undefined
                ) {
                    continue;
                }
                const dimensions = cellInt(row[3]);
                const keyColumn = cellText(row[4]);
                const labelColumn = cellText(row[6]);
                const rowCountEstimate = cellInt(row[7]);
                const keyColumnId = cellInt(row[10]);
                const labelColumnId = cellInt(row[11]);
                const catalogFilters = filtersByObjectId.get(objectId) ?? [];
                const provisionalTarget: VectorSearchTargetInfo = {
                    id: "",
                    schema,
                    table,
                    vectorColumn,
                    ...(dimensions !== undefined && dimensions > 0 ? { dimensions } : {}),
                    ...(keyColumn && keyColumnId !== undefined ? { keyColumn } : {}),
                    keyIsUnique:
                        keyColumn !== undefined &&
                        keyColumnId !== undefined &&
                        cellInt(row[5]) === 1,
                    ...(labelColumn && labelColumnId !== undefined ? { labelColumn } : {}),
                    ...(rowCountEstimate !== undefined ? { rowCountEstimate } : {}),
                    filterColumns: catalogFilters.map(({ name, sqlType }) => ({ name, sqlType })),
                };
                const provisionalBinding: CatalogTargetBinding = {
                    target: provisionalTarget,
                    objectId,
                    vectorColumnId,
                    ...(keyColumnId !== undefined ? { keyColumnId } : {}),
                    ...(labelColumnId !== undefined ? { labelColumnId } : {}),
                    filterColumns: catalogFilters,
                };
                const identity = catalogBindingIdentity(provisionalBinding);
                const id =
                    previousIds.get(identity) ??
                    `vst_${crypto.randomBytes(12).toString("base64url")}`;
                const target: VectorSearchTargetInfo = {
                    ...provisionalTarget,
                    id,
                };
                targets.push(target);
                bindings.push({ ...provisionalBinding, target });
            }
            this.targets.clear();
            for (const binding of bindings) {
                this.targets.set(binding.target.id, binding);
            }
            this.targetsStale = false;
            return { targets };
        } finally {
            lease.dispose();
            this.finishOperation(abortController);
        }
    }

    /** Catalog-verified EMBEDDINGS models; listing never invokes a model. */
    async searchModels(handle: string, refresh = false): Promise<QsVectorSearchModelsResult> {
        if (this.disposed) {
            return {
                models: [],
                modelStatementCounts: this.modelStatements.snapshot(),
                error: "The vector search service is closed.",
            };
        }
        const session = this.deps.workbench(handle);
        if (!session) {
            return {
                models: [],
                modelStatementCounts: this.modelStatements.snapshot(),
                error: "The Vector Workbench session has expired.",
            };
        }
        const cached = () => [...this.modelBindings.values()].map((binding) => binding.info);
        try {
            let capabilities: QsVectorCapabilitiesResult;
            try {
                capabilities = await this.deps.capabilities(refresh);
            } catch (error) {
                this.modelsStale = this.modelBindings.size > 0;
                return {
                    models: cached(),
                    modelStatementCounts: this.modelStatements.snapshot(),
                    error: `Embedding models could not be listed: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                };
            }
            if (!session.isActive()) {
                return {
                    models: cached(),
                    modelStatementCounts: this.modelStatements.snapshot(),
                    error: "The Vector Workbench session has expired.",
                };
            }
            if (capabilities.error || !capabilities.probe) {
                this.modelsStale = this.modelBindings.size > 0;
                return {
                    models: cached(),
                    modelStatementCounts: this.modelStatements.snapshot(),
                    error:
                        capabilities.error ??
                        "Vector capabilities are unavailable; embedding models cannot be verified.",
                };
            }
            if (capabilities.probe.externalModels.error) {
                this.modelsStale = this.modelBindings.size > 0;
                return {
                    models: cached(),
                    modelStatementCounts: this.modelStatements.snapshot(),
                    error: capabilities.probe.externalModels.error,
                };
            }
            const previousIds = new Map<string, string>(
                [...this.modelBindings].map(([id, binding]) => [JSON.stringify(binding.row), id]),
            );
            const next = new Map<string, SearchModelBinding>();
            for (const row of capabilities.probe.externalModels.models) {
                if ((row.modelType ?? "").trim().toUpperCase() !== "EMBEDDINGS") {
                    continue;
                }
                const id =
                    previousIds.get(JSON.stringify(row)) ??
                    `vsm_${crypto.randomBytes(12).toString("base64url")}`;
                const info: VectorSearchModelInfo = {
                    id,
                    name: row.name,
                    ...(row.owner !== undefined ? { owner: row.owner } : {}),
                    modelType: "EMBEDDINGS",
                    ...(row.apiFormat !== undefined ? { apiFormat: row.apiFormat } : {}),
                    ...(row.endpointHost !== undefined ? { endpointHost: row.endpointHost } : {}),
                    egress: row.egress,
                };
                next.set(id, { info, row });
            }
            this.modelBindings.clear();
            for (const [id, binding] of next) {
                this.modelBindings.set(id, binding);
            }
            this.modelsStale = false;
            return { models: cached(), modelStatementCounts: this.modelStatements.snapshot() };
        } finally {
            session.release();
        }
    }

    /** Validate composition and mint a short-lived, single-use confirmation. */
    async searchModelPrepare(
        params: QsVectorSearchModelPrepareParams,
    ): Promise<QsVectorSearchModelPrepareResult> {
        if (this.disposed) {
            return { error: "The vector search service is closed." };
        }
        this.sweepExpiredModelCalls();
        const session = this.deps.workbench(params.handle);
        if (!session) {
            return { error: "The Vector Workbench session has expired." };
        }
        try {
            const targetBinding = this.targets.get(params.targetId);
            if (!targetBinding || this.targetsStale) {
                return {
                    error: "Refresh the catalog-verified Search target before generating an embedding.",
                };
            }
            const expectedDimensions = targetBinding.target.dimensions;
            if (
                expectedDimensions === undefined ||
                expectedDimensions < 1 ||
                expectedDimensions > VECTOR_SEARCH_MAX_DIMENSIONS
            ) {
                return {
                    error: "The verified target has no supported declared dimensions; generated output cannot be validated safely.",
                };
            }
            const modelBinding = this.modelBindings.get(params.modelId);
            if (!modelBinding || this.modelsStale) {
                return {
                    error: "Refresh the catalog-verified EMBEDDINGS model list before generating.",
                };
            }
            if (!modelBinding.row.modifyTime) {
                return {
                    error: "The model probe did not return a modification identity; Search will not authorize an unverifiable model call.",
                };
            }
            if (typeof params.text !== "string" || params.text.trim().length === 0) {
                return { error: "Enter text to generate an embedding." };
            }
            if (params.text.length > VECTOR_SEARCH_MODEL_TEXT_MAX_CHARS) {
                return {
                    error: `Text exceeds ${VECTOR_SEARCH_MODEL_TEXT_MAX_CHARS.toLocaleString("en-US")} characters.`,
                };
            }
            if (Buffer.byteLength(params.text, "utf8") > VECTOR_SEARCH_MODEL_TEXT_MAX_UTF8_BYTES) {
                return {
                    error: `Text exceeds ${VECTOR_SEARCH_MODEL_TEXT_MAX_UTF8_BYTES.toLocaleString("en-US")} UTF-8 bytes.`,
                };
            }
            if (params.text.includes("\u0000")) {
                return { error: "Text cannot contain a NUL character." };
            }
            const validatedParameters = validateSearchModelParameters(params.parametersJson);
            if (validatedParameters.error) {
                return { error: validatedParameters.error };
            }
            let parsedParameters:
                | {
                      dimensions?: number;
                      sql_rest_options?: { retry_count: number };
                  }
                | undefined;
            if (validatedParameters.canonicalJson !== undefined) {
                parsedParameters = JSON.parse(validatedParameters.canonicalJson) as {
                    dimensions?: number;
                    sql_rest_options?: { retry_count: number };
                };
                if (
                    parsedParameters.dimensions !== undefined &&
                    parsedParameters.dimensions !== expectedDimensions
                ) {
                    return {
                        error: `The dimensions override is ${parsedParameters.dimensions}; the verified target declares ${expectedDimensions}.`,
                    };
                }
            }
            const sql = buildSearchModelSql(
                params.text,
                modelBinding.row.name,
                validatedParameters.canonicalJson,
            );
            const descriptor: VectorSearchModelDescriptor = {
                model: modelBinding.row.name,
                ...(modelBinding.row.owner !== undefined ? { owner: modelBinding.row.owner } : {}),
                modelType: "EMBEDDINGS",
                apiFormat: modelBinding.row.apiFormat ?? "unknown",
                endpointHost:
                    modelBinding.row.endpointHost ??
                    (modelBinding.row.egress === "inProcess"
                        ? "local runtime (no endpoint)"
                        : "unknown"),
                egress: modelBinding.row.egress,
                modelModifyTime: modelBinding.row.modifyTime,
                source: "Text entered in Search",
                rowsCalls: 1,
                textChars: params.text.length,
                approxPayloadKiB: estimatePayloadKiB(params.text.length),
                expectedDimensions,
                parameters:
                    validatedParameters.canonicalJson === undefined
                        ? "model defaults"
                        : "validated per-call overrides",
                retryPolicy:
                    parsedParameters?.sql_rest_options?.retry_count !== undefined
                        ? `${parsedParameters.sql_rest_options.retry_count} ${
                              parsedParameters.sql_rest_options.retry_count === 1
                                  ? "retry"
                                  : "retries"
                          } · at most ${
                              parsedParameters.sql_rest_options.retry_count + 1
                          } endpoint attempts`
                        : "model-configured retry policy · maximum attempts not exposed",
                execution: executionCopyForEgress(modelBinding.row.egress),
                resultHandling: "kept in this panel · not written to the table",
            };
            const token = crypto.randomBytes(24).toString("base64url");
            const previous = this.pendingModelTokenByHandle.get(params.handle);
            if (previous) {
                this.pendingModelCalls.delete(previous);
            }
            const expiresAtMs = this.now() + VECTOR_SEARCH_MODEL_TOKEN_TTL_MS;
            this.pendingModelCalls.set(token, {
                handle: params.handle,
                targetId: params.targetId,
                modelId: params.modelId,
                resultSetId: session.resultSetId,
                vectorColumnOrdinal: session.vectorColumnOrdinal,
                generation: session.generation,
                expectedDimensions,
                sql,
                descriptor,
                expiresAtMs,
            });
            this.pendingModelTokenByHandle.set(params.handle, token);
            const expiryTimer = setTimeout(() => {
                const current = this.pendingModelCalls.get(token);
                if (!current) return;
                this.pendingModelCalls.delete(token);
                if (this.pendingModelTokenByHandle.get(current.handle) === token) {
                    this.pendingModelTokenByHandle.delete(current.handle);
                }
            }, VECTOR_SEARCH_MODEL_TOKEN_TTL_MS);
            expiryTimer.unref?.();
            return {
                confirmationToken: token,
                tokenExpiresEpochMs: expiresAtMs,
                descriptor,
                generatedSql: sql,
            };
        } finally {
            session.release();
        }
    }

    /** Execute one consented model call and cache only its opaque host result. */
    async searchModelExecute(
        handle: string,
        token: string,
    ): Promise<QsVectorSearchModelExecuteResult> {
        this.sweepExpiredModelCalls();
        const pending =
            typeof token === "string" && token.length <= 128
                ? this.pendingModelCalls.get(token)
                : undefined;
        if (!pending || pending.handle !== handle) {
            return {
                modelStatementCounts: this.modelStatements.snapshot(),
                error: "The confirmation token is invalid, expired, or already used.",
            };
        }
        // Consume before every await: one token authorizes at most one attempt.
        this.pendingModelCalls.delete(token);
        if (this.pendingModelTokenByHandle.get(handle) === token) {
            this.pendingModelTokenByHandle.delete(handle);
        }
        const startedAt = performance.now();
        let result: QsVectorSearchModelExecuteResult;
        try {
            result = await this.searchModelExecuteInner(pending);
        } catch (error) {
            result = { error: error instanceof Error ? error.message : String(error) };
        }
        const elapsedMs = Math.round(performance.now() - startedAt);
        Perf.marker("mssql.queryResults.vector.model.end", "instant", {
            outcome: result.generatedVectorId ? "ok" : "error",
            dims: result.dimensions ?? 0,
            ms: elapsedMs,
        });
        return {
            ...result,
            elapsedMs,
            modelStatementIssued: result.modelStatementIssued === true,
            modelStatementCounts: this.modelStatements.snapshot(),
        };
    }

    private async searchModelExecuteInner(
        pending: PendingSearchModelCall,
    ): Promise<QsVectorSearchModelExecuteResult> {
        if (this.disposed) {
            return { error: "The vector search service is closed." };
        }
        if (this.activeAbortController) {
            return { error: "Another Vector Search operation is still running." };
        }
        const targetBinding = this.targets.get(pending.targetId);
        const modelBinding = this.modelBindings.get(pending.modelId);
        if (!targetBinding || this.targetsStale || !modelBinding || this.modelsStale) {
            return { error: "The verified target or model binding changed; prepare again." };
        }
        const session = this.deps.workbench(pending.handle);
        if (
            !session ||
            session.resultSetId !== pending.resultSetId ||
            session.vectorColumnOrdinal !== pending.vectorColumnOrdinal ||
            session.generation !== pending.generation
        ) {
            session?.release();
            return { error: "The Vector Workbench session has expired." };
        }
        const abortController = new AbortController();
        this.beginOperation(abortController, pending.handle);
        let lease: AuxiliarySessionLease | undefined;
        try {
            lease = await this.deps.auxModelSession();
            if (!lease) {
                return {
                    error: "No auxiliary model-call session is available for this connection.",
                };
            }
            if (abortController.signal.aborted || !session.isActive()) {
                return { error: "The model call was cancelled." };
            }
            const verified = await this.runTrackedStatement(
                lease.session,
                targetVerificationSql(targetBinding, []),
                "catalog",
                abortController.signal,
            );
            if (verified.failed || cellInt(verified.rows[0]?.[0]) !== 1) {
                return {
                    error: "The target binding changed or can no longer be verified; refresh Search targets.",
                };
            }
            const verifiedModel = await this.runTrackedStatement(
                lease.session,
                modelVerificationSql(modelBinding.row),
                "catalog",
                abortController.signal,
            );
            if (!verifiedModelMatches(verifiedModel, modelBinding.row)) {
                return {
                    error: "The EMBEDDINGS model identity or endpoint changed after confirmation; refresh and prepare again.",
                };
            }
            if (abortController.signal.aborted || !session.isActive()) {
                return { error: "The model call was cancelled." };
            }
            const outcome = await this.runTrackedStatement(
                lease.session,
                pending.sql,
                "model",
                abortController.signal,
                modelBinding.row.egress,
            );
            const modelEvidence = {
                modelStatementIssued: outcome.issued,
                ...(outcome.issued ? { modelEgress: modelBinding.row.egress } : {}),
            };
            if (abortController.signal.aborted || !session.isActive()) {
                return { error: "The model call was cancelled.", ...modelEvidence };
            }
            if (outcome.failed) {
                return {
                    error:
                        outcome.failed.length > 500
                            ? `${outcome.failed.slice(0, 500)}…`
                            : outcome.failed,
                    ...modelEvidence,
                };
            }
            const cell: unknown = outcome.rows[0]?.[0];
            if (typeof cell !== "string" || cell.length === 0) {
                return { error: "The model call returned no embedding JSON.", ...modelEvidence };
            }
            if (Buffer.byteLength(cell, "utf8") > VECTOR_SEARCH_MAX_VECTOR_JSON_BYTES) {
                return {
                    error: "The model output exceeded the bounded vector payload.",
                    ...modelEvidence,
                };
            }
            const parsed = parseFreshVectorJson(cell);
            if (parsed.error || !parsed.values) {
                return {
                    error: parsed.error ?? "The generated embedding is invalid.",
                    ...modelEvidence,
                };
            }
            if (parsed.values.length !== pending.expectedDimensions) {
                return {
                    error:
                        `The model returned ${parsed.values.length} dimensions; the verified ` +
                        `target declares ${pending.expectedDimensions}.`,
                    ...modelEvidence,
                };
            }
            const generatedVectorId = `vsg_${crypto.randomBytes(18).toString("base64url")}`;
            this.generatedVectors.set(generatedVectorId, {
                handle: pending.handle,
                targetId: pending.targetId,
                resultSetId: pending.resultSetId,
                vectorColumnOrdinal: pending.vectorColumnOrdinal,
                generation: pending.generation,
                json: JSON.stringify(parsed.values),
                dimensions: parsed.values.length,
            });
            while (this.generatedVectors.size > VECTOR_SEARCH_GENERATED_CACHE_LIMIT) {
                const oldest = this.generatedVectors.keys().next().value as string | undefined;
                if (!oldest) break;
                this.generatedVectors.delete(oldest);
            }
            return { generatedVectorId, dimensions: parsed.values.length, ...modelEvidence };
        } finally {
            lease?.dispose();
            session.release();
            this.finishOperation(abortController);
        }
    }

    /** qs/vector.search — exact (+ gated approximate) comparison. */
    async search(params: QsVectorSearchParams): Promise<QsVectorSearchResult> {
        const startedAt = performance.now();
        const effectiveK = clampK(params.k);
        if (this.running || this.activeAbortController) {
            const refused: QsVectorSearchResult = {
                generation: 0,
                error: "A vector search is already running on this document; wait for it to finish.",
            };
            this.markSearchEnd("refused", effectiveK, refused, startedAt);
            return refused;
        }
        if (this.disposed) {
            const refused: QsVectorSearchResult = {
                generation: 0,
                error: "The vector search service is closed.",
            };
            this.markSearchEnd("refused", effectiveK, refused, startedAt);
            return refused;
        }
        this.running = true;
        const abortController = new AbortController();
        this.beginOperation(abortController, params.handle);
        let result: QsVectorSearchResult;
        let unexpectedError = false;
        try {
            result = await this.searchInner(params, abortController.signal);
        } catch (error) {
            unexpectedError = true;
            result = {
                generation: 0,
                error: error instanceof Error ? error.message : String(error),
            };
        } finally {
            this.running = false;
            this.finishOperation(abortController);
        }
        const outcome = result.comparison
            ? "ok"
            : unexpectedError || /(?:search failed|cancelled)/i.test(result.error ?? "")
              ? "error"
              : "refused";
        this.markSearchEnd(outcome, effectiveK, result, startedAt);
        return result;
    }

    /** Cancel outstanding catalog/search SQL; completion remains awaitable. */
    async cancel(handle?: string): Promise<void> {
        this.revokePendingModelCalls(handle);
        if (handle !== undefined && this.activeOperationHandle !== handle) {
            return;
        }
        const completion = this.activeOperationCompletion;
        if (this.activeAbortController && !this.activeAbortController.signal.aborted) {
            this.activeAbortController.abort();
        }
        await Promise.all(
            [...this.activeHandles].map(async (queryHandle) => {
                await queryHandle.cancel().catch(() => undefined);
                await queryHandle.dispose().catch(() => undefined);
            }),
        );
        await completion;
    }

    /** Whole-panel suspension drops all model-derived sensitive memory. */
    async suspendSensitiveState(handle?: string): Promise<void> {
        this.revokeSensitiveModelState(handle);
        await this.cancel(handle);
    }

    dispose(): void {
        this.disposed = true;
        this.targets.clear();
        this.completedResults.clear();
        this.modelBindings.clear();
        this.revokeSensitiveModelState();
        void this.cancel();
    }

    restoreResult(handle: string, runId: string, targetId: string): QsVectorSearchResult {
        const session = this.deps.workbench(handle);
        if (!session) {
            return { generation: 0, error: "The Vector Workbench session has expired." };
        }
        try {
            const cached = this.completedResults.get(runId);
            if (
                !cached ||
                cached.resultSetId !== session.resultSetId ||
                cached.vectorColumnOrdinal !== session.vectorColumnOrdinal ||
                cached.targetId !== targetId ||
                !this.targets.has(targetId)
            ) {
                return {
                    generation: session.generation,
                    error: "The cached search result is unavailable for this result set.",
                };
            }
            return { generation: session.generation, runId, comparison: cached.comparison };
        } finally {
            session.release();
        }
    }

    /** Resolve Index workspace facts without accepting identifiers from UI. */
    indexTargetFacts(
        targetId: string | undefined,
        metric: QsVectorSearchParams["metric"] | undefined,
        filterColumns: readonly string[] | undefined,
    ): VectorIndexTargetFacts | undefined {
        if (!targetId) {
            return undefined;
        }
        const binding = this.targets.get(targetId);
        if (!binding || this.targetsStale) {
            return undefined;
        }
        const { target } = binding;
        const allowed = new Set(target.filterColumns.map((column) => column.name));
        return {
            objectId: binding.objectId,
            vectorColumnId: binding.vectorColumnId,
            schema: target.schema,
            table: target.table,
            vectorColumn: target.vectorColumn,
            ...(metric ? { metric } : {}),
            ...(filterColumns
                ? {
                      filterColumns: filterColumns.filter((column) => allowed.has(column)),
                  }
                : {}),
        };
    }

    private async searchInner(
        params: QsVectorSearchParams,
        signal: AbortSignal,
    ): Promise<QsVectorSearchResult> {
        const binding = this.targets.get(params.targetId);
        const session = this.deps.workbench(params.handle);
        const generation = session?.generation ?? 0;
        const fail = (error: string): QsVectorSearchResult => ({ generation, error });

        if (!session) {
            return fail("The Vector Workbench session has expired; reopen the Vector tab.");
        }
        if (!binding) {
            session.release();
            return fail("The search binding has expired; refresh the verified target list.");
        }
        const { target } = binding;
        try {
            if (this.targetsStale) {
                return fail(
                    "The verified target list is stale because its last catalog refresh failed; refresh Search targets before running SQL.",
                );
            }
            if (!target.keyColumn) {
                return fail(
                    `${target.schema}.${target.table} has no single-column unique key — searches need a stable key for tie-breaks, exclusions, and recall identity.`,
                );
            }
            if (!target.keyIsUnique) {
                return fail("The verified search target no longer has a usable unique key.");
            }
            if (!(["cosine", "euclidean", "dot"] as const).includes(params.metric)) {
                return fail("The requested distance metric is not supported.");
            }
            const predicateError = validatePredicates(target, params.predicates);
            if (predicateError) {
                return fail(predicateError);
            }
            if (
                params.exclusion?.excludeSourceRow &&
                params.exclusion.keyPredicate?.sourceRowKey === undefined
            ) {
                return fail(
                    "Source-row exclusion requires a verified result-to-table lineage binding; this STS2 result does not carry one.",
                );
            }
            const exclusionError = validateExclusion(target, params.exclusion);
            if (exclusionError) {
                return fail(exclusionError);
            }
            if (params.exclusion?.excludeSourceRow) {
                return fail(
                    "Source-row exclusion requires a verified result-to-table lineage binding; this STS2 result does not carry one.",
                );
            }
            const documentColumn = params.exclusion?.keyPredicate?.documentColumn;
            const k = clampK(params.k);

            // 1. Frozen query vector (P0-10): resolved ONCE, shared by variants.
            const resolved = await this.resolveQueryVector(params, session, signal);
            if ("error" in resolved) {
                return fail(resolved.error);
            }
            if (signal.aborted || !session.isActive()) {
                return fail("The vector search was cancelled because its source run closed.");
            }
            if (target.dimensions !== undefined && target.dimensions !== resolved.dimensions) {
                return fail(
                    `The query vector has ${resolved.dimensions} dimensions; ${target.schema}.${target.table}.${target.vectorColumn} declares ${target.dimensions}. Incompatible dimensions cannot be searched.`,
                );
            }

            // 2. Capability facts (VEC-7). A refusal degrades to exact-only.
            const caps = await this.deps.capabilities(true, {
                schema: target.schema,
                table: target.table,
            });
            if (signal.aborted || !session.isActive()) {
                return fail("The vector search was cancelled because its source run closed.");
            }
            const probe = caps.probe;
            const probeFacts = probe ? adaptProbeFacts(probe) : REFUSED_PROBE_FACTS;
            const confirmedIndex = this.findConfirmedIndex(probe, binding, params.metric);
            const annFilterCapability = deriveAnnFilterCapability(probe, confirmedIndex);
            const phantomCount = probe?.indexes.phantomCount ?? 0;
            const unusableCount = probe?.indexes.unusableCount ?? 0;

            // 3. Pure SQL (one shared parameter list — the frozen @qv rides both).
            let comparison: VectorComparisonSql;
            try {
                comparison = buildComparison({
                    target: {
                        schema: target.schema,
                        table: target.table,
                        keyColumn: target.keyColumn,
                        vectorColumn: target.vectorColumn,
                        ...(target.labelColumn ? { labelColumn: target.labelColumn } : {}),
                    },
                    metric: params.metric,
                    k,
                    ...(params.predicates && params.predicates.length > 0
                        ? { predicates: params.predicates }
                        : {}),
                    ...(params.exclusion ? { exclusion: params.exclusion } : {}),
                    queryVectorJson: resolved.json,
                    dims: resolved.dimensions,
                    probeFacts,
                    annFilterCapability,
                    ...(this.deps.oversampleMultiplier !== undefined
                        ? { oversampleMultiplier: this.deps.oversampleMultiplier }
                        : {}),
                });
            } catch (error) {
                return fail(error instanceof Error ? error.message : String(error));
            }

            // 4. Approximate gate: request + probe + a CONFIRMED index (phantom
            //    residue never counts). Exact always runs.
            const approxBuilt = !("unavailable" in comparison.approx);
            let approxSkippedReason: string | undefined;
            if (!params.includeApprox) {
                approxSkippedReason = "Approximate variant not requested.";
            } else if (!probe && !approxBuilt) {
                approxSkippedReason = `${VECTOR_EXECUTION_EVIDENCE_COPY.syntaxUnavailable} — capabilities could not be probed: ${caps.error ?? "unknown"}`;
            } else if (!confirmedIndex) {
                approxSkippedReason =
                    `${VECTOR_EXECUTION_EVIDENCE_COPY.noCompatibleIndex} on ${target.schema}.${target.table}` +
                    (phantomCount > 0
                        ? ` (${phantomCount} database-wide unconfirmed sys.vector_indexes row${phantomCount === 1 ? "" : "s"} — not attributed to this target and never usable)`
                        : "") +
                    (unusableCount > 0
                        ? ` (${unusableCount} database-wide disabled/hypothetical row${unusableCount === 1 ? "" : "s"} excluded — not attributed to this target)`
                        : "");
            } else if (!approxBuilt) {
                approxSkippedReason = (comparison.approx as { unavailable: string }).unavailable;
            }
            const runApprox = approxSkippedReason === undefined && approxBuilt;

            // 5. Inline literals at the execution edge (displayed == executed).
            const exactSql = inlineParameters(comparison.exact.sql, comparison.parameters);
            const approxSql = runApprox
                ? inlineParameters(
                      (comparison.approx as { sql: string }).sql,
                      comparison.parameters,
                  )
                : undefined;

            // 6. ONE aux session; isolation declaration, then exact, then approx.
            const lease = await this.deps.auxSession();
            if (!lease) {
                return fail("No auxiliary diagnostic session is available for this connection.");
            }
            let readConsistency: string;
            let exactOutcome: StatementOutcome;
            let exactMs: number;
            let approxOutcome: StatementOutcome | undefined;
            let approxMs: number | undefined;
            let stalenessEvidence: VectorSearchEvidenceRow;
            try {
                const verified = await this.runTrackedStatement(
                    lease.session,
                    targetVerificationSql(binding, [
                        ...(params.predicates?.map((predicate) => predicate.column) ?? []),
                        ...(documentColumn !== undefined ? [documentColumn] : []),
                    ]),
                    "catalog",
                    signal,
                );
                if (verified.failed || cellInt(verified.rows[0]?.[0]) !== 1) {
                    if (signal.aborted || !session.isActive()) {
                        return fail(
                            "The vector search was cancelled because its source run closed.",
                        );
                    }
                    return fail(
                        "The target binding changed or can no longer be verified; refresh Search targets.",
                    );
                }
                readConsistency = await this.probeReadConsistency(lease.session, signal);
                if (signal.aborted || !session.isActive()) {
                    return fail("The vector search was cancelled because its source run closed.");
                }
                stalenessEvidence = await this.measureIndexStaleness(
                    lease.session,
                    probe,
                    confirmedIndex,
                    signal,
                );
                if (signal.aborted || !session.isActive()) {
                    return fail("The vector search was cancelled because its source run closed.");
                }
                const exactStart = performance.now();
                exactOutcome = await this.runTrackedStatement(
                    lease.session,
                    exactSql,
                    "search",
                    signal,
                );
                exactMs = Math.round(performance.now() - exactStart);
                if (signal.aborted || !session.isActive()) {
                    return fail("The vector search was cancelled because its source run closed.");
                }
                if (exactOutcome.failed) {
                    return fail(`Exact search failed: ${exactOutcome.failed}`);
                }
                if (approxSql !== undefined) {
                    const approxStart = performance.now();
                    approxOutcome = await this.runTrackedStatement(
                        lease.session,
                        approxSql,
                        "search",
                        signal,
                    );
                    approxMs = Math.round(performance.now() - approxStart);
                    if (signal.aborted || !session.isActive()) {
                        return fail(
                            "The vector search was cancelled because its source run closed.",
                        );
                    }
                }
            } finally {
                lease.dispose();
            }

            // 7. Shape results + recall evidence.
            if (signal.aborted || !session.isActive()) {
                return fail("The vector search was cancelled because its source run closed.");
            }
            const hasLabel = target.labelColumn !== undefined;
            const exactRows = toNeighborRows(exactOutcome.rows, hasLabel);
            const approxFailed = approxOutcome?.failed;
            const approxRows =
                approxOutcome && !approxOutcome.failed
                    ? toNeighborRows(approxOutcome.rows, hasLabel)
                    : undefined;
            const recall = approxRows
                ? buildRecallComparison(
                      exactRows.map((row) => row.key),
                      approxRows.map((row) => row.key),
                      k,
                  )
                : undefined;
            const rankRows = buildRankRows(exactRows, approxRows);

            const evidence = this.buildEvidence({
                comparison,
                confirmedIndex,
                phantomCount,
                unusableCount,
                probe,
                capsError: caps.error,
                target,
                readConsistency,
                approxRan: approxRows !== undefined,
                approxSkippedReason,
                approxFailed,
                recallDisclosure: recall?.denominatorDisclosure,
                dimensions: resolved.dimensions,
                queryVectorDisclosure: resolved.sourceDisclosure,
                stalenessEvidence,
            });

            const body: QsVectorSearchComparison = {
                exact: exactRows,
                ...(approxRows ? { approx: approxRows } : {}),
                rankRows,
                ...(recall
                    ? {
                          recall: {
                              ...(recall.recallAtK !== undefined
                                  ? { recallAtK: recall.recallAtK }
                                  : {}),
                              overlap: recall.overlap,
                              exactCount: recall.exactCount,
                              approxCount: recall.approxCount,
                              denominatorDisclosure: recall.denominatorDisclosure,
                          },
                      }
                    : {}),
                evidence,
                executedSql: {
                    exact: exactSql,
                    // Present when the statement was SENT (even a failed run is
                    // an execution the user is entitled to see verbatim).
                    ...(approxSql !== undefined && approxOutcome !== undefined
                        ? { approx: approxSql }
                        : {}),
                },
                timings: {
                    exactMs,
                    ...(approxMs !== undefined ? { approxMs } : {}),
                    disclosure: VECTOR_SEARCH_TIMING_DISCLOSURE,
                },
                k,
                metric: params.metric,
                dimensions: resolved.dimensions,
                ...(approxSkippedReason !== undefined ? { approxSkippedReason } : {}),
                ...(approxFailed !== undefined
                    ? { approxError: `Approximate search failed: ${approxFailed}` }
                    : {}),
            };
            if (signal.aborted || !session.isActive()) {
                return fail("The vector search was cancelled because its source run closed.");
            }
            const runId = `vsr_${crypto.randomBytes(12).toString("base64url")}`;
            this.completedResults.set(runId, {
                resultSetId: session.resultSetId,
                vectorColumnOrdinal: session.vectorColumnOrdinal,
                targetId: params.targetId,
                comparison: body,
            });
            while (this.completedResults.size > 2) {
                const oldest = this.completedResults.keys().next().value as string | undefined;
                if (!oldest) {
                    break;
                }
                this.completedResults.delete(oldest);
            }
            return { generation, runId, comparison: body };
        } finally {
            session.release();
        }
    }

    // -- helpers -------------------------------------------------------------

    private beginOperation(abortController: AbortController, handle?: string): void {
        this.activeAbortController = abortController;
        this.activeOperationHandle = handle;
        this.activeOperationCompletion = new Promise<void>((resolve) => {
            this.settleActiveOperation = resolve;
        });
    }

    private finishOperation(abortController: AbortController): void {
        if (this.activeAbortController !== abortController) {
            return;
        }
        this.activeAbortController = undefined;
        this.activeOperationHandle = undefined;
        const settle = this.settleActiveOperation;
        this.settleActiveOperation = undefined;
        this.activeOperationCompletion = undefined;
        settle?.();
    }

    private async resolveQueryVector(
        params: QsVectorSearchParams,
        session: VectorWorkbenchSessionFacts,
        signal: AbortSignal,
    ): Promise<ResolvedVector> {
        const source = params.source;
        if (source.kind === "pastedVector") {
            if (Buffer.byteLength(source.json, "utf8") > VECTOR_SEARCH_MAX_VECTOR_JSON_BYTES) {
                return {
                    error: `The pasted vector exceeds ${VECTOR_SEARCH_MAX_VECTOR_JSON_BYTES.toLocaleString("en-US")} UTF-8 bytes.`,
                };
            }
            let parsed: unknown;
            try {
                parsed = JSON.parse(source.json);
            } catch {
                return { error: "The pasted vector is not valid JSON." };
            }
            if (
                !Array.isArray(parsed) ||
                parsed.length === 0 ||
                parsed.length > VECTOR_SEARCH_MAX_DIMENSIONS ||
                parsed.some(
                    (component) => typeof component !== "number" || !Number.isFinite(component),
                )
            ) {
                return {
                    error: `The pasted vector must be a flat JSON array of 1 to ${VECTOR_SEARCH_MAX_DIMENSIONS} finite numbers (no objects or nested arrays).`,
                };
            }
            const float32 = parsed.map((component) => Math.fround(component as number));
            if (float32.some((component) => !Number.isFinite(component))) {
                return {
                    error: "Every pasted-vector component must be representable as a finite float32 value.",
                };
            }
            // Canonical text: ONE frozen serialization shared by all variants.
            return {
                json: JSON.stringify(float32),
                dimensions: float32.length,
                sourceDisclosure: "Pasted vector · provenance unknown",
            };
        }
        if (source.kind === "generatedVector") {
            if (typeof source.id !== "string" || !/^vsg_[A-Za-z0-9_-]{20,40}$/.test(source.id)) {
                return { error: "The generated query-vector reference is invalid." };
            }
            const generated = this.generatedVectors.get(source.id);
            if (
                !generated ||
                generated.handle !== params.handle ||
                generated.targetId !== params.targetId ||
                generated.resultSetId !== session.resultSetId ||
                generated.vectorColumnOrdinal !== session.vectorColumnOrdinal ||
                generated.generation !== session.generation
            ) {
                return {
                    error: "The generated query vector is no longer available; generate it again.",
                };
            }
            return {
                json: generated.json,
                dimensions: generated.dimensions,
                sourceDisclosure:
                    "Generated by one explicitly confirmed, catalog-verified EMBEDDINGS model call · panel memory only",
            };
        }
        if (source.kind === "expression") {
            return this.resolveExpressionVector(source, session, signal);
        }
        if (session.transport !== "binary-v1") {
            return {
                error: "This query ran without the typed vector transport; rerun with the Vector Workbench enabled to search from a selected row.",
            };
        }
        const summary = session.store.summary(session.resultSetId);
        if (!summary) {
            return { error: "The result set is no longer available." };
        }
        const ordinal = source.ordinal;
        if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= summary.rowCount) {
            return {
                error: `Result-row ordinal ${ordinal} is out of range (0–${summary.rowCount - 1}).`,
            };
        }
        const window = await session.store.getWindow({
            resultSetId: session.resultSetId,
            rowStart: ordinal,
            rowCount: 1,
            columnOrdinals: [session.vectorColumnOrdinal],
            reason: "vectorAnalysis",
        });
        if (!session.isActive()) {
            return { error: "The vector search was cancelled because its source run closed." };
        }
        const cell: unknown = window.values[0]?.[0];
        const decoded = cell === undefined || cell === null ? null : decodeVectorFloat32(cell);
        if (decoded === null) {
            return {
                error: `Row ${ordinal} has no analyzable vector value in the selected column.`,
            };
        }
        return {
            json: vectorJsonArrayText(decoded),
            dimensions: decoded.dimensions,
            sourceDisclosure: `Selected result row #${ordinal}`,
        };
    }

    private async resolveExpressionVector(
        source: Extract<QsVectorSearchParams["source"], { readonly kind: "expression" }>,
        session: VectorWorkbenchSessionFacts,
        signal: AbortSignal,
    ): Promise<ResolvedVector> {
        if (session.transport !== "binary-v1") {
            return {
                error: "This query ran without the typed vector transport; rerun with the Vector Workbench enabled to evaluate an expression.",
            };
        }
        if (!Array.isArray(source.basket) || source.basket.length < 2 || source.basket.length > 8) {
            return { error: "Expression search requires a Compare basket of 2 to 8 result rows." };
        }
        if (typeof source.expression !== "string") {
            return { error: "The vector expression must be text in the constrained grammar." };
        }
        const summary = session.store.summary(session.resultSetId);
        if (!summary) {
            return { error: "The result set is no longer available." };
        }

        const seenOrdinals = new Set<number>();
        for (let index = 0; index < source.basket.length; index++) {
            const entry = source.basket[index];
            const expectedSymbol = VECTOR_EXPRESSION_SYMBOLS[index];
            if (
                !entry ||
                entry.symbol !== expectedSymbol ||
                !Number.isInteger(entry.ordinal) ||
                entry.ordinal < 0 ||
                entry.ordinal >= summary.rowCount ||
                seenOrdinals.has(entry.ordinal)
            ) {
                return {
                    error: `Expression basket entry ${expectedSymbol} must map to one distinct result-row ordinal between 0 and ${summary.rowCount - 1}.`,
                };
            }
            seenOrdinals.add(entry.ordinal);
        }

        const basket: Partial<Record<(typeof VECTOR_EXPRESSION_SYMBOLS)[number], Float32Array>> =
            {};
        for (const entry of source.basket) {
            if (signal.aborted || !session.isActive()) {
                return { error: "The vector search was cancelled because its source run closed." };
            }
            const window = await session.store.getWindow({
                resultSetId: session.resultSetId,
                rowStart: entry.ordinal,
                rowCount: 1,
                columnOrdinals: [session.vectorColumnOrdinal],
                reason: "vectorAnalysis",
            });
            if (signal.aborted || !session.isActive()) {
                return { error: "The vector search was cancelled because its source run closed." };
            }
            const cell: unknown = window.values[0]?.[0];
            const decoded = cell === undefined || cell === null ? null : decodeVectorFloat32(cell);
            if (decoded === null) {
                return {
                    error: `Expression basket ${entry.symbol} (row ${entry.ordinal}) has no analyzable vector value in the selected column.`,
                };
            }
            basket[entry.symbol] = decoded.values;
        }

        try {
            const result = evaluateVectorExpression(
                source.expression,
                basket as VectorExpressionBasket,
            );
            return {
                json: vectorJsonArrayText(result),
                dimensions: result.dimensions,
                sourceDisclosure: `Experimental expression using ${result.symbols.join(", ")} · provenance unknown · L2 norm ${result.l2.toPrecision(6)}`,
            };
        } catch (error) {
            return {
                error:
                    error instanceof VectorExpressionError
                        ? `Vector expression: ${error.message}`
                        : "The vector expression could not be evaluated.",
            };
        }
    }

    private findConfirmedIndex(
        probe: VectorCapabilityProbe | undefined,
        binding: CatalogTargetBinding,
        metric: QsVectorSearchParams["metric"],
    ): VectorIndexProbeRow | undefined {
        if (!probe || !probe.indexes.available) {
            return undefined;
        }
        const { target } = binding;
        // probe.indexes.indexes already excludes phantom rows (sys.indexes gate).
        return probe.indexes.indexes.find(
            (index) =>
                (index.objectId === undefined || index.objectId === binding.objectId) &&
                (index.vectorColumnId === undefined ||
                    index.vectorColumnId === binding.vectorColumnId) &&
                index.schemaName === target.schema &&
                index.tableName === target.table &&
                index.vectorColumn === target.vectorColumn &&
                index.distanceMetric?.toLowerCase() === metric.toLowerCase(),
        );
    }

    private async probeReadConsistency(session: ISqlSession, signal: AbortSignal): Promise<string> {
        const outcome = await this.runTrackedStatement(
            session,
            VECTOR_SEARCH_ISOLATION_SQL,
            "catalog",
            signal,
        );
        if (outcome.failed) {
            return "Read consistency: unknown (isolation level could not be read); concurrent changes may affect comparison";
        }
        const level = cellInt(outcome.rows[0]?.[0]);
        const name = level !== undefined ? ISOLATION_LEVEL_NAMES[level] : undefined;
        return declaredReadConsistency(name ?? `isolation level ${String(level)}`);
    }

    private runTrackedStatement(
        session: ISqlSession,
        sql: string,
        kind: "search" | "catalog" | "model",
        signal: AbortSignal,
        modelEgress?: VectorModelEgressClass,
    ): Promise<StatementOutcome> {
        let modelStatementRecorded = false;
        return runStatement(session, sql, kind, {
            signal,
            onHandle: (handle) => {
                if (handle) {
                    if (kind === "model" && modelEgress !== undefined && !modelStatementRecorded) {
                        modelStatementRecorded = true;
                        this.modelStatements.record(modelEgress);
                    }
                    this.activeHandles.add(handle);
                    if (signal.aborted) {
                        void handle.cancel().catch(() => undefined);
                        void handle.dispose().catch(() => undefined);
                    }
                } else {
                    this.activeHandles.clear();
                }
            },
        });
    }

    private sweepExpiredModelCalls(): void {
        const now = this.now();
        for (const [token, pending] of this.pendingModelCalls) {
            if (pending.expiresAtMs <= now) {
                this.pendingModelCalls.delete(token);
                if (this.pendingModelTokenByHandle.get(pending.handle) === token) {
                    this.pendingModelTokenByHandle.delete(pending.handle);
                }
            }
        }
    }

    /** Source text lives in pending SQL. */
    private revokePendingModelCalls(handle?: string): void {
        for (const [token, pending] of this.pendingModelCalls) {
            if (handle === undefined || pending.handle === handle) {
                this.pendingModelCalls.delete(token);
                if (this.pendingModelTokenByHandle.get(pending.handle) === token) {
                    this.pendingModelTokenByHandle.delete(pending.handle);
                }
            }
        }
    }

    /** Source text lives in pending SQL and vectors live in generated cache. */
    private revokeSensitiveModelState(handle?: string): void {
        this.revokePendingModelCalls(handle);
        for (const [id, generated] of this.generatedVectors) {
            if (handle === undefined || generated.handle === handle) {
                this.generatedVectors.delete(id);
            }
        }
    }

    private markSearchEnd(
        outcome: "ok" | "error" | "refused",
        k: number,
        result: QsVectorSearchResult,
        startedAt: number,
    ): void {
        Perf.marker("mssql.queryResults.vector.search.end", "instant", {
            outcome,
            k,
            exactMs: result.comparison?.timings.exactMs ?? 0,
            approxMs: result.comparison?.timings.approxMs ?? 0,
            approxIncluded: result.comparison?.approx !== undefined,
            ms: Math.round(performance.now() - startedAt),
        });
    }

    private buildEvidence(facts: {
        comparison: VectorComparisonSql;
        confirmedIndex: VectorIndexProbeRow | undefined;
        phantomCount: number;
        unusableCount: number;
        probe: VectorCapabilityProbe | undefined;
        capsError: string | undefined;
        target: VectorSearchTargetInfo;
        readConsistency: string;
        approxRan: boolean;
        approxSkippedReason: string | undefined;
        approxFailed: string | undefined;
        recallDisclosure: string | undefined;
        dimensions: number;
        queryVectorDisclosure: string;
        stalenessEvidence: VectorSearchEvidenceRow;
    }): VectorSearchEvidenceRow[] {
        const rows: VectorSearchEvidenceRow[] = [];
        rows.push({
            label: "Exact execution",
            value: VECTOR_EXECUTION_EVIDENCE_COPY.exactGroundTruth,
            source: "diagnosticQuery",
        });
        if (facts.approxFailed !== undefined) {
            rows.push({
                label: "Approximate execution",
                value: `Failed: ${facts.approxFailed}`,
                source: "diagnosticQuery",
            });
        } else if (facts.approxRan) {
            // Honest ceiling on this engine generation: no forced-ANN proof
            // mechanism exists, so success can only ever earn "unverified".
            rows.push({
                label: "Approximate execution",
                value: VECTOR_EXECUTION_EVIDENCE_COPY.approxStrategyUnverified,
                source: "diagnosticQuery",
            });
        } else {
            rows.push({
                label: "Approximate execution",
                value: `Skipped — ${facts.approxSkippedReason ?? "unavailable"}`,
                source: facts.probe ? "catalog" : "interpretation",
            });
        }
        if (facts.approxRan && !("unavailable" in facts.comparison.approx)) {
            const approx = facts.comparison.approx;
            rows.push({
                label: "Filter semantics",
                value:
                    approx.filterSemantics === "postFilteredOversample"
                        ? `Post-filtered after approximate retrieval — ${approx.disclosure ?? "TOP_N oversampled"} (TOP_N = ${approx.topN})`
                        : approx.filterSemantics === "iterative"
                          ? `${approx.disclosure ?? "Iterative filtering (during traversal)"} (TOP_N = K = ${approx.topN})`
                          : approx.filterSemantics === "unknownConservativeOversample"
                            ? `${approx.disclosure ?? "Filter behavior unverified; conservative post-filter oversample"} (TOP_N = ${approx.topN})`
                            : "No outer predicates — filter semantics do not apply",
                source: "localComputation",
            });
        }
        rows.push({
            label: "Read consistency",
            value: facts.readConsistency.replace(/^Read consistency: /, ""),
            source: "diagnosticQuery",
        });
        rows.push({
            label: "Comparison snapshot",
            value: "Sequential statements on one auxiliary session; no snapshot transaction is imposed, so concurrent DML can change the observations.",
            source: "interpretation",
        });
        rows.push({
            label: "Session scope",
            value: "Separate connection using the saved profile; query-session temp tables, uncommitted changes, and SESSION_CONTEXT values are not inherited.",
            source: "interpretation",
        });
        rows.push({
            label: "Vector index",
            value: facts.confirmedIndex
                ? [
                      facts.confirmedIndex.indexName,
                      facts.confirmedIndex.indexType,
                      facts.confirmedIndex.distanceMetric,
                      facts.confirmedIndex.version !== undefined
                          ? `version ${facts.confirmedIndex.version}`
                          : undefined,
                  ]
                      .filter((part): part is string => part !== undefined)
                      .join(" · ")
                : `${VECTOR_EXECUTION_EVIDENCE_COPY.noCompatibleIndex} on ${facts.target.schema}.${facts.target.table}` +
                  (facts.phantomCount > 0
                      ? ` · ${facts.phantomCount} database-wide phantom sys.vector_indexes row${facts.phantomCount === 1 ? "" : "s"} excluded (not target-attributed)`
                      : "") +
                  (facts.unusableCount > 0
                      ? ` · ${facts.unusableCount} database-wide disabled/hypothetical row${facts.unusableCount === 1 ? "" : "s"} excluded (not target-attributed)`
                      : ""),
            source: "catalog",
        });
        rows.push(facts.stalenessEvidence);
        rows.push({
            label: "Syntax probes",
            value: facts.probe
                ? `VECTOR_SEARCH ${facts.probe.vectorSearchTvf.status} · TOP (n) WITH APPROXIMATE ${facts.probe.topNWithApproximate.status}`
                : `Not probed — ${facts.capsError ?? "capabilities unavailable"}`,
            source: facts.probe ? "diagnosticQuery" : "interpretation",
        });
        rows.push({
            label: "Recall denominator",
            value:
                facts.recallDisclosure ??
                "Recall not computed — the approximate variant did not run",
            source: "localComputation",
        });
        rows.push({
            label: "Query vector",
            value: `${facts.queryVectorDisclosure} · ${facts.dimensions}-D · frozen once · the same literal rides every executed variant`,
            source: "localComputation",
        });
        if (facts.comparison.exclusionDisclosures.length === 0) {
            rows.push({
                label: "Exclusion",
                value: "Source row, exact-vector duplicates, and same-document chunks are included; no verified base-key mapping was supplied.",
                source: "localComputation",
            });
        } else {
            for (const disclosure of facts.comparison.exclusionDisclosures) {
                rows.push({ label: "Exclusion", value: disclosure, source: "localComputation" });
            }
        }
        return rows;
    }

    private async measureIndexStaleness(
        session: ISqlSession,
        probe: VectorCapabilityProbe | undefined,
        index: VectorIndexProbeRow | undefined,
        signal: AbortSignal,
    ): Promise<VectorSearchEvidenceRow> {
        if (!index) {
            return {
                label: "Index staleness",
                value: "Not measured because no compatible target index was verified.",
                source: "catalog",
            };
        }
        const health = probe?.healthDmv;
        if (!health?.present) {
            return {
                label: "Index staleness",
                value: "Unavailable on this engine; no staleness percentage is claimed.",
                source: "catalog",
            };
        }
        const resolveColumn = (name: string | undefined): string | undefined =>
            name === undefined
                ? undefined
                : health.columns.find(
                      (candidate) => candidate.toLowerCase() === name.toLowerCase(),
                  );
        const stalenessColumn = resolveColumn(health.stalenessColumn);
        const objectIdColumn = resolveColumn("object_id");
        const indexIdColumn = resolveColumn("index_id");
        if (
            !stalenessColumn ||
            !objectIdColumn ||
            !indexIdColumn ||
            index.objectId === undefined ||
            index.indexId === undefined
        ) {
            return {
                label: "Index staleness",
                value: "The health DMV lacks a resolved staleness column or target catalog identity; no value is inferred.",
                source: "catalog",
            };
        }
        const sql = [
            `SELECT TOP (1) TRY_CONVERT(nvarchar(256), ${quoteSqlIdentifier(stalenessColumn)})`,
            "FROM sys.dm_db_vector_indexes",
            `WHERE ${quoteSqlIdentifier(objectIdColumn)} = ${index.objectId}`,
            `  AND ${quoteSqlIdentifier(indexIdColumn)} = ${index.indexId};`,
        ].join("\n");
        const outcome = await this.runTrackedStatement(session, sql, "catalog", signal);
        if (outcome.failed) {
            return {
                label: "Index staleness",
                value: `Measurement immediately before the search variants failed: ${outcome.failed.slice(0, 512)}`,
                source: "diagnosticQuery",
            };
        }
        const staleness = cellText(outcome.rows[0]?.[0]);
        return {
            label: "Index staleness",
            value:
                staleness !== undefined
                    ? `${stalenessColumn}: ${staleness} (same diagnostic session, immediately before variants)`
                    : "The same-session DMV measurement immediately before the variants returned no target row; no value is inferred.",
            source: "diagnosticQuery",
        };
    }
}

// ---------------------------------------------------------------------------
// Result shaping (pure; exported for tests)
// ---------------------------------------------------------------------------

/** Rows arrive as [key, label?, distance] per the builder's select list. */
export function toNeighborRows(
    rows: readonly unknown[][],
    hasLabel: boolean,
): VectorSearchNeighborRow[] {
    return rows.map((row, index) => {
        const keyCell = row[0];
        const key =
            typeof keyCell === "number"
                ? keyCell
                : keyCell === null || keyCell === undefined
                  ? "NULL"
                  : String(keyCell);
        const label = hasLabel ? cellText(row[1]) : undefined;
        const distanceCell = row[hasLabel ? 2 : 1];
        const distance =
            typeof distanceCell === "number" ? distanceCell : Number(cellText(distanceCell));
        return {
            rank: index + 1,
            key,
            ...(label !== undefined ? { label } : {}),
            distance,
        };
    });
}

/** Union rows for the rank grid, ordered by exact rank then approx rank. */
export function buildRankRows(
    exact: readonly VectorSearchNeighborRow[],
    approx: readonly VectorSearchNeighborRow[] | undefined,
): VectorSearchRankRow[] {
    interface MutableRankRow {
        key: string | number;
        label?: string;
        exactRank?: number;
        approxRank?: number;
        delta?: number;
        exactDistance?: number;
        approxDistance?: number;
        status: VectorSearchRankRow["status"];
        distanceTie?: boolean;
    }
    const byKey = new Map<string | number, MutableRankRow>();
    for (const row of exact) {
        if (byKey.has(row.key)) {
            continue; // duplicate keys keep first (recall math dedupes too)
        }
        // Status is only meaningful when both variants ran; exact-only runs
        // keep "exactOnly" and the view hides the status column.
        byKey.set(row.key, {
            key: row.key,
            ...(row.label !== undefined ? { label: row.label } : {}),
            exactRank: row.rank,
            exactDistance: row.distance,
            status: "exactOnly",
        });
    }
    if (approx) {
        for (const row of approx) {
            const existing = byKey.get(row.key);
            if (existing) {
                if (existing.approxRank !== undefined) {
                    continue;
                }
                existing.approxRank = row.rank;
                existing.approxDistance = row.distance;
                if (existing.exactRank !== undefined) {
                    existing.delta = row.rank - existing.exactRank;
                    existing.status = "matched";
                }
            } else {
                byKey.set(row.key, {
                    key: row.key,
                    ...(row.label !== undefined ? { label: row.label } : {}),
                    approxRank: row.rank,
                    approxDistance: row.distance,
                    status: "approxOnly",
                });
            }
        }
    }
    const max = Number.MAX_SAFE_INTEGER;
    const sorted = [...byKey.values()].sort(
        (a, b) =>
            (a.exactRank ?? max) - (b.exactRank ?? max) ||
            (a.approxRank ?? max) - (b.approxRank ?? max),
    );
    const tieTolerance = 1e-9;
    for (let index = 1; index < sorted.length; index++) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        if (previous.exactDistance === undefined || current.exactDistance === undefined) {
            continue;
        }
        const scale = Math.max(
            1,
            Math.abs(previous.exactDistance),
            Math.abs(current.exactDistance),
        );
        if (Math.abs(previous.exactDistance - current.exactDistance) <= tieTolerance * scale) {
            previous.distanceTie = true;
            current.distanceTie = true;
        }
    }
    return sorted;
}
