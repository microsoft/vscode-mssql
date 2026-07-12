/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Vector catalog/capability probes (VEC-7; addendum A3/A4/A8). One tolerant
 * pass over the verified July-2026 vector surface: engine identity, scoped
 * configs, vector type usability, sys.columns metadata, vector indexes with
 * the sys.indexes phantom gate, health-DMV presence + dynamic column-name
 * resolution, EMBEDDINGS external models with egress classification, server
 * configuration gates, and the two syntax-acceptance probes.
 *
 * Tolerance is the contract: every probe runs as its own execute; a missing
 * symbol (Msg 207/208/socket/an entire absent DMV) is captured as an honest
 * absence on the section result — probeVectorCapabilities NEVER throws for a
 * missing surface. Nothing is templated from the engine name: the verified
 * matrix shows RTM and Azure disagree on symbols the guide assumed stable
 * (`distance_metric` not `_desc`; `$.Version` Azure-only; DMV names differ;
 * phantom index rows on failed Azure builds).
 *
 * Execution discipline: every statement uses the background-SQL idiom
 * (priority "background", commandKind "metadata", tag
 * "queryStudio:vectorProbe") on the CALLER-SUPPLIED session — expected to be
 * an auxiliary diagnostic session, never the user's. Syntax probes are
 * wrapped `WHERE 1 = 0` so they can never scan data.
 *
 * No caching here — the service layer (vectorCapabilityService) owns policy.
 */

import { ISqlSession, IQueryEventSink, QueryHandle } from "../../services/sqlDataPlane/api";
import {
    classifyModelEgress,
    VectorCapabilityProbe,
    VectorColumnMetadataProbe,
    VectorEngineIdentityProbe,
    VectorExternalModelProbeRow,
    VectorExternalModelsProbe,
    VectorHealthDmvProbe,
    VectorIndexCatalogProbe,
    VectorIndexProbeRow,
    VectorProbeEvidence,
    VectorScopedConfigProbe,
    VectorServerConfigProbe,
    VectorSyntaxProbe,
    VectorTypeProbe,
} from "../../sharedInterfaces/vectorCatalog";

export const VECTOR_PROBE_TAG = "queryStudio:vectorProbe";

/** Bracket-escape one T-SQL identifier part. */
function ident(name: string): string {
    return `[${name.replace(/]/g, "]]")}]`;
}

/** Syntax-probe target: a real vector column when one exists. */
export interface VectorProbeTarget {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
    readonly dimensions: number;
    /** Metric to name in the probe (an existing index's metric when known). */
    readonly metric: string;
}

/** Optional table scope for the index probe (host-resolved, never webview). */
export interface VectorProbeTableFilter {
    readonly schema: string;
    readonly table: string;
}

/** Placeholder used when no real vector column exists: Msg 208 (invalid
 *  object) still proves the parser ACCEPTED the construct, while a true
 *  syntax rejection fails earlier with Msg 102 (verified live). */
const NO_TABLE_PROBE_TARGET: VectorProbeTarget = {
    schema: "dbo",
    table: "__mssql_vector_probe_no_such_table__",
    column: "v",
    dimensions: 3,
    metric: "cosine",
};

/**
 * The exact probe SQL, exported so the gated LIVE tests execute the same
 * text this module runs in production (no drift between test and product).
 */
export const VECTOR_PROBE_SQL = {
    engineIdentity: [
        "SELECT",
        "    CONVERT(nvarchar(128), SERVERPROPERTY('ProductVersion')),",
        "    CONVERT(nvarchar(128), SERVERPROPERTY('Edition')),",
        "    CONVERT(int, SERVERPROPERTY('EngineEdition')),",
        "    CONVERT(nvarchar(128), DB_NAME()),",
        "    CONVERT(int, (SELECT compatibility_level FROM sys.databases WHERE database_id = DB_ID()));",
    ].join("\n"),

    scopedConfigs: [
        "SELECT CONVERT(nvarchar(64), name), TRY_CONVERT(int, CONVERT(nvarchar(16), value))",
        "FROM sys.database_scoped_configurations",
        "WHERE name IN (N'PREVIEW_FEATURES', N'ALLOW_STALE_VECTOR_INDEX');",
    ].join("\n"),

    vectorType: "SELECT CONVERT(int, VECTORPROPERTY(CAST('[1,2,3]' AS VECTOR(3)), 'Dimensions'));",

    columnMetadata: [
        "SELECT CONVERT(nvarchar(128), name)",
        "FROM sys.all_columns",
        "WHERE object_id = OBJECT_ID(N'sys.columns') AND name LIKE N'vector%'",
        "ORDER BY name;",
    ].join("\n"),

    /**
     * Tolerant projection over verified column names (`vector_index_type`,
     * `distance_metric`, `build_parameters` — never `_desc`) with the
     * sys.indexes LEFT JOIN whose null side marks PHANTOM rows (failed Azure
     * builds leave sys.vector_indexes residue absent from sys.indexes).
     * Version extraction happens client-side (JSON.parse) so an engine
     * without the `$.Version` key can never error the whole probe.
     */
    vectorIndexes: (filter?: VectorProbeTableFilter): string =>
        [
            filter ? "SELECT" : "SELECT TOP (64)",
            "    TRY_CONVERT(int, v.object_id),",
            "    TRY_CONVERT(int, v.index_id),",
            "    CONVERT(nvarchar(128), SCHEMA_NAME(o.schema_id)),",
            "    CONVERT(nvarchar(128), o.name),",
            "    CONVERT(nvarchar(128), v.name),",
            "    CONVERT(nvarchar(128), vc.name),",
            "    CONVERT(nvarchar(64), v.vector_index_type),",
            "    CONVERT(nvarchar(64), v.distance_metric),",
            "    CONVERT(nvarchar(max), v.build_parameters),",
            "    TRY_CONVERT(int, vc.column_id),",
            "    CASE WHEN iraw.index_id IS NOT NULL THEN 1 ELSE 0 END,",
            "    CASE WHEN iusable.index_id IS NOT NULL THEN 1 ELSE 0 END",
            "FROM sys.vector_indexes v",
            "JOIN sys.objects o ON o.object_id = v.object_id",
            "LEFT JOIN sys.indexes iraw ON iraw.object_id = v.object_id AND iraw.index_id = v.index_id",
            "LEFT JOIN sys.indexes iusable ON iusable.object_id = v.object_id AND iusable.index_id = v.index_id",
            "    AND iusable.is_disabled = 0 AND iusable.is_hypothetical = 0",
            "OUTER APPLY (",
            "    SELECT TOP (1) c.name, c.column_id",
            "    FROM sys.index_columns ic",
            "    JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id",
            "    WHERE ic.object_id = v.object_id AND ic.index_id = v.index_id",
            "      AND ic.is_included_column = 0",
            "    ORDER BY ic.key_ordinal, ic.index_column_id",
            ") vc",
            ...(filter
                ? [
                      `WHERE v.object_id = OBJECT_ID(N'${ident(filter.schema).replace(/'/g, "''")}.${ident(filter.table).replace(/'/g, "''")}')`,
                  ]
                : []),
            "ORDER BY o.name, v.name;",
        ].join("\n"),

    healthDmvPresence:
        "SELECT CASE WHEN OBJECT_ID(N'sys.dm_db_vector_indexes') IS NULL THEN 0 ELSE 1 END;",

    healthDmvColumns: [
        "SELECT CONVERT(nvarchar(128), name)",
        "FROM sys.all_columns",
        "WHERE object_id = OBJECT_ID(N'sys.dm_db_vector_indexes')",
        "ORDER BY column_id;",
    ].join("\n"),

    /** Dynamic projection over RESOLVED names — never the guide's assumed ones. */
    healthDmvRows: (columns: readonly string[], filter?: VectorProbeTableFilter): string => {
        const objectIdColumn = columns.find((column) => column.toLowerCase() === "object_id");
        return [
            filter && objectIdColumn ? "SELECT" : "SELECT TOP (16)",
            columns
                .map((c) => `    TRY_CONVERT(nvarchar(256), ${ident(c)}) AS ${ident(c)}`)
                .join(",\n"),
            "FROM sys.dm_db_vector_indexes",
            ...(filter && objectIdColumn
                ? [
                      `WHERE ${ident(objectIdColumn)} = OBJECT_ID(N'${ident(filter.schema).replace(/'/g, "''")}.${ident(filter.table).replace(/'/g, "''")}');`,
                  ]
                : [";"]),
        ].join("\n");
    },

    /** EMBEDDINGS filter server-side (A9); owner via principal (P0-4). */
    externalModels: [
        "SELECT",
        "    CONVERT(nvarchar(128), m.name),",
        "    CONVERT(nvarchar(128), USER_NAME(m.principal_id)),",
        "    CONVERT(nvarchar(64), m.api_format),",
        "    CONVERT(nvarchar(64), m.model_type_desc),",
        "    CONVERT(nvarchar(256), m.model),",
        "    CONVERT(nvarchar(1024), m.location),",
        "    CONVERT(nvarchar(64), m.modify_time, 126)",
        "FROM sys.external_models m",
        "WHERE m.model_type_desc = N'EMBEDDINGS'",
        "ORDER BY m.name;",
    ].join("\n"),

    serverConfig: [
        "SELECT CONVERT(nvarchar(64), name), TRY_CONVERT(int, CONVERT(nvarchar(16), value_in_use))",
        "FROM sys.configurations",
        "WHERE name IN (N'external rest endpoint enabled', N'external AI runtimes enabled');",
    ].join("\n"),

    /** Deterministic discovery of real vector columns for syntax probes. */
    discoverVectorColumns: [
        "SELECT TOP (32)",
        "    CONVERT(nvarchar(128), SCHEMA_NAME(o.schema_id)),",
        "    CONVERT(nvarchar(128), o.name),",
        "    CONVERT(nvarchar(128), c.name),",
        "    TRY_CONVERT(int, c.vector_dimensions)",
        "FROM sys.columns c",
        "JOIN sys.objects o ON o.object_id = c.object_id",
        "JOIN sys.types t ON t.user_type_id = c.user_type_id",
        "WHERE t.name = N'vector' AND o.type = 'U'",
        "ORDER BY o.name, c.column_id;",
    ].join("\n"),

    /**
     * VECTOR_SEARCH TVF parse probe. SIMILAR_TO must be a VARIABLE (an
     * inline CAST is itself a Msg 102, verified live) and `WHERE 1 = 0`
     * guarantees no scan. Selecting only `r.distance` avoids assuming any
     * base-table column names.
     */
    vectorSearchTvf: (target: VectorProbeTarget): string =>
        [
            `DECLARE @q VECTOR(${Math.max(1, Math.floor(target.dimensions))});`,
            "SELECT r.distance FROM VECTOR_SEARCH(",
            `    TABLE = ${ident(target.schema)}.${ident(target.table)} AS t,`,
            `    COLUMN = ${ident(target.column)},`,
            "    SIMILAR_TO = @q,",
            `    METRIC = '${target.metric.replace(/'/g, "''").toLowerCase()}',`,
            "    TOP_N = 1",
            ") AS r WHERE 1 = 0;",
        ].join("\n"),

    /** TOP (n) WITH APPROXIMATE probe — expected REJECTED on both verified
     *  engines today (Msg 102/156); recorded honestly either way. */
    topNWithApproximate: (target: VectorProbeTarget): string =>
        [
            `DECLARE @q VECTOR(${Math.max(1, Math.floor(target.dimensions))});`,
            `SELECT TOP (1) WITH APPROXIMATE t.${ident(target.column)}`,
            `FROM ${ident(target.schema)}.${ident(target.table)} AS t`,
            "WHERE 1 = 0",
            `ORDER BY VECTOR_DISTANCE('${target.metric.replace(/'/g, "''").toLowerCase()}', t.${ident(target.column)}, @q);`,
        ].join("\n"),
} as const;

/**
 * Resolve the staleness-like and last-task-like health-DMV columns from the
 * ACTUAL column list (exported for the live tests). Matches both the
 * documented names (`approximate_staleness_percent`,
 * `last_background_task_time`) and the verified Azure names
 * (`graph_catchup_pending_percent`, `last_background_task_execution_time`).
 */
export function resolveHealthColumns(columns: readonly string[]): {
    stalenessColumn?: string;
    lastTaskColumn?: string;
} {
    const staleness =
        columns.find((c) => /staleness/i.test(c)) ??
        columns.find((c) => /(catchup|pending).*percent/i.test(c));
    const lastTask =
        columns.find((c) => /last_background_task.*time/i.test(c)) ??
        columns.find((c) => /last_background_task/i.test(c));
    return {
        ...(staleness ? { stalenessColumn: staleness } : {}),
        ...(lastTask ? { lastTaskColumn: lastTask } : {}),
    };
}

/** Client-side `$.Version` extraction — tolerant of any malformed shape. */
export function extractBuildParametersVersion(
    buildParameters: string | undefined,
): number | undefined {
    if (!buildParameters) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(buildParameters) as Record<string, unknown> | null;
        const raw = parsed?.Version;
        const value =
            typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
        return Number.isFinite(value) ? value : undefined;
    } catch {
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// Tolerant execution (never throws; errors become honest section absences)
// ---------------------------------------------------------------------------

interface ProbeQueryOutcome {
    readonly rows: unknown[][];
    readonly columns: string[];
    readonly errors: { number?: number; text: string }[];
    /** Set when the statement did not succeed (first error / status). */
    readonly failed?: string;
}

/** Bounded busy retry (executionOrchestrator.executeWhenFree recipe): the
 *  session allows ONE active query; completion reactions free the slot in
 *  registration order, so a short wait covers any scheduling race. */
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
                { priority: "background", commandKind: "metadata", tag: VECTOR_PROBE_TAG },
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

async function runProbe(session: ISqlSession, sql: string): Promise<ProbeQueryOutcome> {
    const rows: unknown[][] = [];
    const columns: string[] = [];
    const errors: { number?: number; text: string }[] = [];
    try {
        const sink: IQueryEventSink = {
            onResultSetStarted: (meta) => {
                if (columns.length === 0) {
                    for (const column of meta.columns) {
                        columns.push(column.name);
                    }
                }
            },
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
        const handle = await executeWhenFree(session, sql, sink);
        // Await the HANDLE completion (session frees its active slot in
        // completion reaction order — resolving on a sink callback races
        // the next probe into Busy).
        const summary = await handle.completion;
        if (summary.status !== "succeeded") {
            return {
                rows,
                columns,
                errors,
                failed: errors[0]?.text ?? `probe ${summary.status}`,
            };
        }
        return { rows, columns, errors };
    } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        return { rows, columns, errors, failed: text };
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

function stamp(source: VectorProbeEvidence["source"]): VectorProbeEvidence {
    return { source, capturedEpochMs: Date.now() };
}

/** Bound a server message so a giant error can never bloat the result. */
const bounded = (text: string): string => (text.length > 500 ? `${text.slice(0, 500)}…` : text);

// ---------------------------------------------------------------------------
// Syntax classification (A8)
// ---------------------------------------------------------------------------

const PARSE_ERROR_NUMBERS = new Set([102, 156, 319]);

function classifySyntaxProbe(
    outcome: ProbeQueryOutcome,
    previewFeaturesEnabled: boolean | undefined,
    target: VectorProbeTarget | undefined,
): VectorSyntaxProbe {
    const evidence = stamp("diagnosticQuery");
    const targetName = target ? `${target.schema}.${target.table}` : undefined;
    if (!outcome.failed) {
        return { evidence, status: "accepted", ...(targetName ? { target: targetName } : {}) };
    }
    const first = outcome.errors[0];
    const text = first?.text ?? outcome.failed;
    const isParseError =
        (first?.number !== undefined && PARSE_ERROR_NUMBERS.has(first.number)) ||
        /incorrect syntax/i.test(text);
    if (isParseError) {
        // Preview-gated parse (verified: VECTOR_SEARCH needs PREVIEW_FEATURES).
        const status = previewFeaturesEnabled === false ? "needsPreview" : "rejected";
        return {
            evidence,
            status,
            message: bounded(text),
            ...(targetName ? { target: targetName } : {}),
        };
    }
    // Past the parser: a missing probe object (208) or a missing usable
    // vector index (42227) still proves SYNTAX acceptance — the limitation
    // is carried on the message and on the index probe itself.
    const acceptedPastParser =
        (first?.number !== undefined && (first.number === 208 || first.number === 42227)) ||
        /invalid object name/i.test(text) ||
        /cannot find a vector index/i.test(text);
    if (acceptedPastParser) {
        return {
            evidence,
            status: "accepted",
            message: bounded(text),
            ...(targetName ? { target: targetName } : {}),
        };
    }
    return {
        evidence,
        status: "rejected",
        message: bounded(text),
        ...(targetName ? { target: targetName } : {}),
    };
}

// ---------------------------------------------------------------------------
// The probe suite
// ---------------------------------------------------------------------------

export interface ProbeVectorCapabilitiesOptions {
    /** Scope the index probe to one table (host-resolved binding target). */
    readonly table?: VectorProbeTableFilter;
}

/**
 * Run the full tolerant probe pass on the given (auxiliary) session. The
 * optional `database` names the context for callers that key results — the
 * probes always run in the session's CURRENT database (aux sessions are
 * opened on the user session's database by the binding).
 *
 * NEVER throws for a missing surface: each section carries value-or-absence.
 */
export async function probeVectorCapabilities(
    session: ISqlSession,
    database?: string,
    options?: ProbeVectorCapabilitiesOptions,
): Promise<VectorCapabilityProbe> {
    void database; // context is keyed by the caller; probes use the session's db

    // 1. Engine identity + compat level.
    const identityOutcome = await runProbe(session, VECTOR_PROBE_SQL.engineIdentity);
    const identityRow = identityOutcome.rows[0];
    const engine: VectorEngineIdentityProbe = identityOutcome.failed
        ? { evidence: stamp("catalog"), error: bounded(identityOutcome.failed) }
        : {
              evidence: stamp("catalog"),
              ...(cellText(identityRow?.[0]) ? { productVersion: cellText(identityRow?.[0]) } : {}),
              ...(cellText(identityRow?.[1]) ? { edition: cellText(identityRow?.[1]) } : {}),
              ...(cellInt(identityRow?.[2]) !== undefined
                  ? { engineEditionId: cellInt(identityRow?.[2]) }
                  : {}),
              ...(cellText(identityRow?.[3]) ? { database: cellText(identityRow?.[3]) } : {}),
              ...(cellInt(identityRow?.[4]) !== undefined
                  ? { compatibilityLevel: cellInt(identityRow?.[4]) }
                  : {}),
          };

    // 2. Database-scoped configurations (tolerant; ALLOW_STALE is Azure-only).
    const configsOutcome = await runProbe(session, VECTOR_PROBE_SQL.scopedConfigs);
    const scopedConfig = (name: string): VectorScopedConfigProbe => {
        if (configsOutcome.failed) {
            return {
                evidence: stamp("catalog"),
                present: false,
                error: bounded(configsOutcome.failed),
            };
        }
        const row = configsOutcome.rows.find(
            (candidate) => cellText(candidate[0])?.toUpperCase() === name,
        );
        if (!row) {
            return { evidence: stamp("catalog"), present: false };
        }
        const value = cellInt(row[1]);
        return {
            evidence: stamp("catalog"),
            present: true,
            ...(value !== undefined ? { enabled: value !== 0 } : {}),
        };
    };
    const previewFeatures = scopedConfig("PREVIEW_FEATURES");
    const allowStaleVectorIndex = scopedConfig("ALLOW_STALE_VECTOR_INDEX");

    // 3. Vector type usable (CAST + VECTORPROPERTY round-trip).
    const typeOutcome = await runProbe(session, VECTOR_PROBE_SQL.vectorType);
    const vectorType: VectorTypeProbe = typeOutcome.failed
        ? { evidence: stamp("diagnosticQuery"), usable: false, error: bounded(typeOutcome.failed) }
        : { evidence: stamp("diagnosticQuery"), usable: cellInt(typeOutcome.rows[0]?.[0]) === 3 };

    // 4. sys.columns vector metadata columns.
    const columnsOutcome = await runProbe(session, VECTOR_PROBE_SQL.columnMetadata);
    const metadataColumns = columnsOutcome.rows
        .map((row) => cellText(row[0]))
        .filter((name): name is string => name !== undefined);
    const columnMetadata: VectorColumnMetadataProbe = columnsOutcome.failed
        ? {
              evidence: stamp("catalog"),
              vectorDimensionsPresent: false,
              columns: [],
              error: bounded(columnsOutcome.failed),
          }
        : {
              evidence: stamp("catalog"),
              vectorDimensionsPresent: metadataColumns.some(
                  (name) => name.toLowerCase() === "vector_dimensions",
              ),
              columns: metadataColumns,
          };

    // 5. Vector indexes with the phantom gate.
    const indexesOutcome = await runProbe(session, VECTOR_PROBE_SQL.vectorIndexes(options?.table));
    let indexes: VectorIndexCatalogProbe;
    if (indexesOutcome.failed) {
        indexes = {
            evidence: stamp("catalog"),
            available: false,
            indexes: [],
            phantomCount: 0,
            error: bounded(indexesOutcome.failed),
        };
    } else {
        const confirmed: VectorIndexProbeRow[] = [];
        let phantomCount = 0;
        let unusableCount = 0;
        for (const row of indexesOutcome.rows) {
            const rawPresent = cellInt(row[10]) === 1;
            const isUsable = cellInt(row[11]) === 1;
            if (!rawPresent) {
                phantomCount++; // failed-build residue: never usable, never hidden
                continue;
            }
            if (!isUsable) {
                unusableCount++;
                continue;
            }
            const buildParameters = cellText(row[8]);
            const version = extractBuildParametersVersion(buildParameters);
            confirmed.push({
                ...(cellInt(row[0]) !== undefined ? { objectId: cellInt(row[0]) } : {}),
                ...(cellInt(row[1]) !== undefined ? { indexId: cellInt(row[1]) } : {}),
                ...(cellInt(row[9]) !== undefined ? { vectorColumnId: cellInt(row[9]) } : {}),
                schemaName: cellText(row[2]) ?? "",
                tableName: cellText(row[3]) ?? "",
                indexName: cellText(row[4]) ?? "",
                ...(cellText(row[5]) ? { vectorColumn: cellText(row[5]) } : {}),
                ...(cellText(row[6]) ? { indexType: cellText(row[6]) } : {}),
                ...(cellText(row[7]) ? { distanceMetric: cellText(row[7]) } : {}),
                ...(buildParameters ? { buildParameters } : {}),
                ...(version !== undefined ? { version } : {}),
            });
        }
        indexes = {
            evidence: stamp("catalog"),
            available: true,
            indexes: confirmed,
            phantomCount,
            ...(unusableCount > 0 ? { unusableCount } : {}),
        };
    }

    // 6. Health DMV: presence, then RESOLVED column names, then rows.
    let healthDmv: VectorHealthDmvProbe;
    const presenceOutcome = await runProbe(session, VECTOR_PROBE_SQL.healthDmvPresence);
    if (presenceOutcome.failed) {
        healthDmv = {
            evidence: stamp("catalog"),
            present: false,
            columns: [],
            error: bounded(presenceOutcome.failed),
        };
    } else if (cellInt(presenceOutcome.rows[0]?.[0]) !== 1) {
        healthDmv = { evidence: stamp("catalog"), present: false, columns: [] };
    } else {
        const dmvColumnsOutcome = await runProbe(session, VECTOR_PROBE_SQL.healthDmvColumns);
        const dmvColumns = dmvColumnsOutcome.rows
            .map((row) => cellText(row[0]))
            .filter((name): name is string => name !== undefined);
        if (dmvColumnsOutcome.failed || dmvColumns.length === 0) {
            healthDmv = {
                evidence: stamp("catalog"),
                present: true,
                columns: dmvColumns,
                ...(dmvColumnsOutcome.failed ? { error: bounded(dmvColumnsOutcome.failed) } : {}),
            };
        } else {
            const resolved = resolveHealthColumns(dmvColumns);
            const rowsOutcome = await runProbe(
                session,
                VECTOR_PROBE_SQL.healthDmvRows(dmvColumns, options?.table),
            );
            const rows = rowsOutcome.failed
                ? undefined
                : rowsOutcome.rows.map((row) => {
                      const map: Record<string, string | null> = {};
                      dmvColumns.forEach((name, ordinal) => {
                          map[name] = cellText(row[ordinal]) ?? null;
                      });
                      return map;
                  });
            healthDmv = {
                evidence: stamp("catalog"),
                present: true,
                columns: dmvColumns,
                ...resolved,
                ...(rows ? { rows } : {}),
                ...(rowsOutcome.failed ? { error: bounded(rowsOutcome.failed) } : {}),
            };
        }
    }

    // 7. External models (EMBEDDINGS only; DB-scoped name + owner; egress A4).
    const modelsOutcome = await runProbe(session, VECTOR_PROBE_SQL.externalModels);
    let externalModels: VectorExternalModelsProbe;
    if (modelsOutcome.failed) {
        externalModels = {
            evidence: stamp("catalog"),
            available: false,
            models: [],
            error: bounded(modelsOutcome.failed),
        };
    } else {
        const models: VectorExternalModelProbeRow[] = modelsOutcome.rows
            .map((row) => {
                const name = cellText(row[0]);
                if (!name) {
                    return undefined;
                }
                const apiFormat = cellText(row[2]);
                return {
                    name,
                    ...(cellText(row[1]) ? { owner: cellText(row[1]) } : {}),
                    ...(apiFormat ? { apiFormat } : {}),
                    ...(cellText(row[3]) ? { modelType: cellText(row[3]) } : {}),
                    ...(cellText(row[4]) ? { providerModel: cellText(row[4]) } : {}),
                    ...(endpointHost(cellText(row[5]))
                        ? { endpointHost: endpointHost(cellText(row[5])) }
                        : {}),
                    ...(cellText(row[6]) ? { modifyTime: cellText(row[6]) } : {}),
                    egress: classifyModelEgress(apiFormat),
                } satisfies VectorExternalModelProbeRow;
            })
            .filter((model): model is VectorExternalModelProbeRow => model !== undefined);
        externalModels = { evidence: stamp("catalog"), available: true, models };
    }

    // 8. Server configuration gates (box/MI; values recorded, absence honest).
    const serverConfigOutcome = await runProbe(session, VECTOR_PROBE_SQL.serverConfig);
    let serverConfig: VectorServerConfigProbe;
    if (serverConfigOutcome.failed) {
        serverConfig = {
            evidence: stamp("catalog"),
            error: bounded(serverConfigOutcome.failed),
        };
    } else {
        const configValue = (name: string): boolean | undefined => {
            const row = serverConfigOutcome.rows.find(
                (candidate) => cellText(candidate[0])?.toLowerCase() === name,
            );
            const value = row ? cellInt(row[1]) : undefined;
            return value === undefined ? undefined : value !== 0;
        };
        const rest = configValue("external rest endpoint enabled");
        const runtimes = configValue("external ai runtimes enabled");
        serverConfig = {
            evidence: stamp("catalog"),
            ...(rest !== undefined ? { externalRestEndpointEnabled: rest } : {}),
            ...(runtimes !== undefined ? { externalAiRuntimesEnabled: runtimes } : {}),
        };
    }

    // 9. Syntax-probe target: prefer a REAL vector column on a table that has
    //    a confirmed vector index (clean acceptance), else any vector column,
    //    else the nonexistent-table placeholder (parse-acceptance only).
    const discoveryOutcome = await runProbe(session, VECTOR_PROBE_SQL.discoverVectorColumns);
    const discovered = discoveryOutcome.failed
        ? []
        : discoveryOutcome.rows
              .map((row) => ({
                  schema: cellText(row[0]) ?? "",
                  table: cellText(row[1]) ?? "",
                  column: cellText(row[2]) ?? "",
                  dimensions: cellInt(row[3]) ?? 0,
              }))
              .filter((row) => row.schema && row.table && row.column && row.dimensions > 0);
    const indexedTarget = discovered
        .map((row) => {
            const index = indexes.indexes.find(
                (candidate) =>
                    candidate.schemaName === row.schema && candidate.tableName === row.table,
            );
            return index
                ? { ...row, metric: (index.distanceMetric ?? "cosine").toLowerCase() }
                : undefined;
        })
        .find((row) => row !== undefined);
    const target: VectorProbeTarget | undefined =
        indexedTarget ?? (discovered[0] ? { ...discovered[0], metric: "cosine" } : undefined);
    const effectiveTarget = target ?? NO_TABLE_PROBE_TARGET;

    // 10. VECTOR_SEARCH TVF parse acceptance (never scans: WHERE 1 = 0).
    const tvfOutcome = await runProbe(session, VECTOR_PROBE_SQL.vectorSearchTvf(effectiveTarget));
    const vectorSearchTvf = classifySyntaxProbe(tvfOutcome, previewFeatures.enabled, target);

    // 11. TOP (n) WITH APPROXIMATE acceptance (expected rejected today).
    const approxOutcome = await runProbe(
        session,
        VECTOR_PROBE_SQL.topNWithApproximate(effectiveTarget),
    );
    const topNWithApproximate = classifySyntaxProbe(approxOutcome, previewFeatures.enabled, target);

    return {
        evidence: stamp("diagnosticQuery"),
        engine,
        previewFeatures,
        allowStaleVectorIndex,
        vectorType,
        columnMetadata,
        indexes,
        healthDmv,
        externalModels,
        serverConfig,
        vectorSearchTvf,
        topNWithApproximate,
    };
}

/** HOST only — path/query string (which can carry api keys) never escapes. */
function endpointHost(location: string | undefined): string | undefined {
    if (!location) {
        return undefined;
    }
    try {
        const host = new URL(location).hostname;
        return host.length > 0 ? host : undefined;
    } catch {
        return undefined;
    }
}
