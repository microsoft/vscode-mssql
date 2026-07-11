/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * VectorIndexService (VEC-9): derives the Index workspace — state machine,
 * properties, findings, and generated-only scripts — from ONE capability
 * probe result (VEC-7). This module is a PURE derivation:
 *
 * - No session, no I/O, no `services/sqlDataPlane` import anywhere in this
 *   file. The only injected collaborator is a thunk returning the cached /
 *   refreshed `QsVectorCapabilitiesResult` (owned by VectorCapabilityService,
 *   which does the aux-session work). That is the structural proof that the
 *   scripts generated here can never be executed by this service — there is
 *   nothing here capable of executing them.
 *
 * State machine (readiness review P0-3 + the verified provider matrix):
 * - healthyCurrent: confirmed index, `$.Version >= 3` (Azure) OR Version key
 *   absent entirely (SQL 2025 RTM — absence IS the current format there;
 *   guide §8.3 corrected reality; probed, never assumed legacy). Migration
 *   is HIDDEN in this state.
 * - legacyFormat: confirmed index with `$.Version < 3`. Migration script is
 *   generated WITH a mandatory service-impact comment block, and the finding
 *   list carries the same warning so the view can place it ABOVE the script.
 * - noIndex: no confirmed index on the target. A phantom sys.vector_indexes
 *   row (failed Azure build residue, excluded by the sys.indexes join) is
 *   still noIndex — with a finding explaining the transient phantom.
 * - buildFailedTier: caller-supplied fact that a recent CREATE failed with
 *   the tier build error verified in the wild (Msg 42234 on GP_S serverless).
 * - permissionDegraded: the index catalog probe failed — the view says
 *   "Health unavailable" and NEVER anything that reads as "Healthy".
 * - noVectorColumns: discovery found no vector column and no index rows.
 *
 * Health honesty: staleness-like facts are labeled with the column name
 * RESOLVED live from the DMV (`graph_catchup_pending_percent` on Azure — the
 * documented `approximate_staleness_percent` does not exist there). When the
 * DMV is absent (RTM) no staleness is EVER invented — health is a "current
 * catalog snapshot only" finding. Staleness bands are attributed to
 * documentation and never turned into a rebuild threshold (A3).
 */

import {
    VectorCapabilityProbe,
    VectorHealthDmvProbe,
    VectorIndexProbeRow,
    QsVectorCapabilitiesResult,
} from "../../sharedInterfaces/vectorCatalog";
import {
    QsVectorIndexStateResult,
    VectorIndexFinding,
    VectorIndexProperty,
    VectorIndexScript,
    VectorIndexWorkspaceState,
    VectorIndexWorkspaceView,
} from "../../sharedInterfaces/vectorIndex";
import { quoteIdentifier } from "./vectorSqlBuilder";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * Optional search-target facts from the host's binding/target picker. The
 * catalog row does not carry the vector COLUMN name, so create/migration
 * scripts need it from here; absent facts degrade to explicit placeholders
 * in review-only scripts (never guessed).
 */
export interface VectorIndexTargetFacts {
    readonly schema: string;
    readonly table: string;
    readonly vectorColumn?: string;
    /** Preferred metric for a NEW index (defaults to cosine). */
    readonly metric?: string;
    /** Columns observed in search filters (supporting-index suggestion). */
    readonly filterColumns?: readonly string[];
    /**
     * A recent CREATE VECTOR INDEX failure the host observed (user-initiated;
     * probes never run CREATE). Msg 42234 is the verified tier build failure.
     */
    readonly recentCreateError?: { readonly number?: number; readonly text: string };
}

/** Thunk over VectorCapabilityService.capabilities — the ONLY collaborator. */
export type VectorCapabilityThunk = (refresh?: boolean) => Promise<QsVectorCapabilitiesResult>;

// ---------------------------------------------------------------------------
// Script builders (pure string builders; QUOTENAME escaping; review-only)
// ---------------------------------------------------------------------------

/** Every generated script leads with this line — the pane's structural vow. */
export const SCRIPT_REVIEW_HEADER =
    "-- Vector Workbench — generated for review; this pane never executes scripts.";

/** Verified live on both engines: CREATE VECTOR INDEX needs QI ON (Msg 1934). */
const QUOTED_IDENTIFIER_NOTE =
    "-- CREATE VECTOR INDEX requires QUOTED_IDENTIFIER ON (error 1934 otherwise; sqlcmd needs -I).";

/** Mandatory top-of-migration comment block (P0-3 / A3). */
export const MIGRATION_SERVICE_IMPACT_COMMENT = [
    "-- ============================================================================",
    "-- SERVICE IMPACT — READ BEFORE RUNNING:",
    "-- Dropping this index immediately disables approximate (ANN) search on this",
    "-- table until the replacement index finishes building. There is no in-place",
    "-- upgrade for vector indexes — migration is DROP + CREATE.",
    "-- Plan a maintenance window.",
    "-- ============================================================================",
].join("\n");

const PLACEHOLDER_VECTOR_COLUMN = "<vector_column>";

/** Escape a single-quoted T-SQL literal fragment. */
function escapeLiteral(text: string): string {
    return text.replace(/'/g, "''");
}

/** `vec_<table>_<column>` (mock convention), clamped to the 128-char cap. */
export function deriveIndexName(table: string, vectorColumn: string): string {
    return `vec_${table}_${vectorColumn}`.slice(0, 128);
}

const KNOWN_METRICS = new Set(["cosine", "euclidean", "dot"]);

/** Lowercased, escaped metric; unknown catalog values pass through verbatim
 *  (review-only scripts stay honest rather than silently substituting). */
function metricLiteral(metric: string | undefined): string {
    const normalized = (metric ?? "cosine").trim().toLowerCase();
    return escapeLiteral(KNOWN_METRICS.has(normalized) ? normalized : normalized || "cosine");
}

export interface CreateIndexScriptFacts {
    readonly schema: string;
    readonly table: string;
    /** Undefined → explicit placeholder + instruction comment (never guessed). */
    readonly vectorColumn?: string;
    readonly indexName?: string;
    readonly metric?: string;
}

export function buildCreateVectorIndexScript(facts: CreateIndexScriptFacts): string {
    const column = facts.vectorColumn;
    const indexName =
        facts.indexName ?? deriveIndexName(facts.table, column ?? PLACEHOLDER_VECTOR_COLUMN);
    const columnSql = column ? quoteIdentifier(column) : PLACEHOLDER_VECTOR_COLUMN;
    const lines = [
        SCRIPT_REVIEW_HEADER,
        QUOTED_IDENTIFIER_NOTE,
        "-- Options: METRIC = 'cosine' | 'euclidean' | 'dot'; TYPE = 'diskann' (the",
        "-- documented type). Prerequisites (documented): clustered primary key and",
        "-- >= 100 non-null vector rows; availability varies by service tier — probed",
        "-- per connection, never assumed from the engine name.",
    ];
    if (!column) {
        lines.push(
            `-- NOTE: the index catalog does not carry the vector column name; replace`,
            `-- ${PLACEHOLDER_VECTOR_COLUMN} below before review.`,
        );
    }
    lines.push(
        "SET QUOTED_IDENTIFIER ON;",
        "GO",
        `CREATE VECTOR INDEX ${quoteIdentifier(indexName)}`,
        `    ON ${quoteIdentifier(facts.schema)}.${quoteIdentifier(facts.table)}(${columnSql})`,
        `    WITH (METRIC = '${metricLiteral(facts.metric)}', TYPE = 'diskann');`,
    );
    return lines.join("\n");
}

export interface MigrationScriptFacts {
    readonly schema: string;
    readonly table: string;
    readonly indexName: string;
    readonly vectorColumn?: string;
    readonly metric?: string;
}

/** ONLY the legacyFormat state may call this (enforced by the derivation). */
export function buildMigrationScript(facts: MigrationScriptFacts): string {
    const column = facts.vectorColumn;
    const columnSql = column ? quoteIdentifier(column) : PLACEHOLDER_VECTOR_COLUMN;
    const lines = [SCRIPT_REVIEW_HEADER, MIGRATION_SERVICE_IMPACT_COMMENT, QUOTED_IDENTIFIER_NOTE];
    if (!column) {
        lines.push(
            `-- NOTE: the index catalog does not carry the vector column name; replace`,
            `-- ${PLACEHOLDER_VECTOR_COLUMN} below before review.`,
        );
    }
    lines.push(
        "SET QUOTED_IDENTIFIER ON;",
        "GO",
        `DROP INDEX ${quoteIdentifier(facts.indexName)} ON ${quoteIdentifier(facts.schema)}.${quoteIdentifier(facts.table)};`,
        "GO",
        `CREATE VECTOR INDEX ${quoteIdentifier(facts.indexName)}`,
        `    ON ${quoteIdentifier(facts.schema)}.${quoteIdentifier(facts.table)}(${columnSql})`,
        `    WITH (METRIC = '${metricLiteral(facts.metric)}', TYPE = 'diskann');`,
    );
    return lines.join("\n");
}

/**
 * Health snapshot query. With the DMV present the projection uses the column
 * names RESOLVED live from sys.all_columns (never the documented guide names
 * — those fail Msg 207 on Azure, verified). With the DMV absent (RTM) this
 * emits the sys.vector_indexes-only variant with the phantom gate — no
 * staleness column exists there and none is invented.
 */
export function buildHealthSnapshotScript(healthDmv: VectorHealthDmvProbe): string {
    if (healthDmv.present && healthDmv.columns.length > 0) {
        return [
            SCRIPT_REVIEW_HEADER,
            "-- Column names below were RESOLVED from sys.all_columns on THIS connection",
            "-- at probe time (verified live: Azure exposes graph_catchup_pending_percent",
            "-- / last_background_task_execution_time — not the documented names).",
            "SELECT",
            healthDmv.columns.map((column) => `    ${quoteIdentifier(column)}`).join(",\n"),
            "FROM sys.dm_db_vector_indexes;",
        ].join("\n");
    }
    return [
        SCRIPT_REVIEW_HEADER,
        "-- sys.dm_db_vector_indexes is ABSENT on this engine (probed) — this snapshot",
        "-- reads the index catalog only. No staleness or background-task facts exist",
        "-- here; none are invented. The sys.indexes join marks phantom rows (failed-",
        "-- build residue that self-cleans; verified live on Azure).",
        "SELECT",
        "    SCHEMA_NAME(o.schema_id) AS [schema_name],",
        "    o.name AS [table_name],",
        "    v.name AS [index_name],",
        "    v.vector_index_type,",
        "    v.distance_metric,",
        "    v.build_parameters,",
        "    CASE WHEN i.index_id IS NULL THEN N'phantom (failed-build residue)'",
        "         ELSE N'confirmed' END AS [presence]",
        "FROM sys.vector_indexes AS v",
        "JOIN sys.objects AS o ON o.object_id = v.object_id",
        "LEFT JOIN sys.indexes AS i",
        "    ON i.object_id = v.object_id AND i.index_id = v.index_id",
        "ORDER BY o.name, v.name;",
    ].join("\n");
}

/** Config-gate enablement (F8): database-scoped, generated never executed. */
export function buildEnablePreviewScript(): string {
    return [
        SCRIPT_REVIEW_HEADER,
        "-- PREVIEW_FEATURES is a DATABASE-SCOPED configuration: enabling it affects",
        "-- every user of this database, not only this session. Verified live: it",
        "-- gates parse acceptance of VECTOR_SEARCH; CREATE VECTOR INDEX gating varies",
        "-- by engine and tier (probed per connection). Requires ALTER on the database.",
        "ALTER DATABASE SCOPED CONFIGURATION SET PREVIEW_FEATURES = ON;",
    ].join("\n");
}

export interface SupportingIndexScriptFacts {
    readonly schema: string;
    readonly table: string;
    readonly filterColumns: readonly string[];
}

/** Review-only supporting-index suggestion for observed filter columns. */
export function buildSupportingIndexScript(facts: SupportingIndexScriptFacts): string {
    const statements = facts.filterColumns.map((column) =>
        [
            `CREATE INDEX ${quoteIdentifier(`ix_${facts.table}_${column}`.slice(0, 128))}`,
            `    ON ${quoteIdentifier(facts.schema)}.${quoteIdentifier(facts.table)}(${quoteIdentifier(column)});`,
        ].join("\n"),
    );
    return [
        SCRIPT_REVIEW_HEADER,
        "-- REVIEW SUGGESTION, NOT A COMMAND: these columns were observed in vector",
        "-- search filters for this target. A supporting nonclustered index can help",
        "-- filtered search; whether it is worthwhile depends on your workload. This",
        "-- probe does not inspect existing nonclustered indexes — verify before use.",
        statements.join("\nGO\n"),
    ].join("\n");
}

// ---------------------------------------------------------------------------
// State derivation (pure; fully unit-testable)
// ---------------------------------------------------------------------------

const sameIdent = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Format-class facts for one confirmed index row (guide §8.3 corrected). */
function classifyVersion(row: VectorIndexProbeRow): {
    readonly legacy: boolean;
    readonly versionText: string;
} {
    if (row.version === undefined) {
        return {
            legacy: false,
            versionText:
                "absent — no $.Version key in build_parameters; on this engine that IS " +
                "the current format (probed, never assumed)",
        };
    }
    return row.version >= 3
        ? { legacy: false, versionText: `v${row.version} (current format)` }
        : { legacy: true, versionText: `v${row.version} (earlier format — migration available)` };
}

const TIER_BUILD_ERROR_NUMBER = 42234;

function isTierBuildFailure(error: { number?: number; text: string } | undefined): boolean {
    if (!error) {
        return false;
    }
    return (
        error.number === TIER_BUILD_ERROR_NUMBER ||
        /vector index build failed/i.test(error.text) ||
        new RegExp(`\\b${TIER_BUILD_ERROR_NUMBER}\\b`).test(error.text)
    );
}

/** Bound a probe error so a giant message never bloats the view. */
const bounded = (text: string): string => (text.length > 300 ? `${text.slice(0, 300)}…` : text);

interface SharedFacts {
    readonly engineProps: VectorIndexProperty[];
    readonly configProps: VectorIndexProperty[];
    readonly previewKnownOff: boolean;
}

function sharedFacts(probe: VectorCapabilityProbe): SharedFacts {
    const engineProps: VectorIndexProperty[] = [];
    if (probe.engine.error) {
        engineProps.push({
            label: "Engine",
            value: `unavailable — ${bounded(probe.engine.error)}`,
            source: "engine",
        });
    } else {
        const edition = probe.engine.edition ?? "edition unknown";
        const version = probe.engine.productVersion ?? "version unknown";
        engineProps.push({ label: "Engine", value: `${edition} · ${version}`, source: "engine" });
    }

    const configProps: VectorIndexProperty[] = [];
    const preview = probe.previewFeatures;
    configProps.push({
        label: "PREVIEW_FEATURES",
        value: preview.error
            ? `unavailable — ${bounded(preview.error)}`
            : !preview.present
              ? "not present on this engine"
              : preview.enabled === true
                ? "ON (database-scoped)"
                : preview.enabled === false
                  ? "OFF (database-scoped)"
                  : "present — value unreadable",
        source: "config",
    });
    const allowStale = probe.allowStaleVectorIndex;
    configProps.push({
        label: "ALLOW_STALE_VECTOR_INDEX",
        value: allowStale.error
            ? `unavailable — ${bounded(allowStale.error)}`
            : !allowStale.present
              ? "not present on this engine (verified absent on SQL 2025 RTM)"
              : allowStale.enabled === true
                ? "ON (database-scoped)"
                : "OFF (database-scoped)",
        source: "config",
    });

    return {
        engineProps,
        configProps,
        previewKnownOff: preview.present && preview.enabled === false,
    };
}

/** Health facts for a state that shows an index (present-DMV vs absent-DMV). */
function healthFacts(probe: VectorCapabilityProbe): {
    readonly properties: VectorIndexProperty[];
    readonly findings: VectorIndexFinding[];
} {
    const dmv = probe.healthDmv;
    const properties: VectorIndexProperty[] = [];
    const findings: VectorIndexFinding[] = [];

    if (!dmv.present) {
        properties.push({
            label: "Health DMV",
            value: "sys.dm_db_vector_indexes absent on this engine",
            source: "catalog",
        });
        findings.push({
            severity: "info",
            title: "Health: current catalog snapshot only",
            detail:
                "sys.dm_db_vector_indexes is absent on this engine (probed) — no " +
                "staleness or background-task facts exist here; none are invented.",
        });
        return { properties, findings };
    }

    properties.push({
        label: "Health DMV",
        value: "sys.dm_db_vector_indexes present",
        source: "catalog",
    });
    if (dmv.error) {
        properties.push({
            label: "Health",
            value: `unavailable — ${bounded(dmv.error)}`,
            source: "healthDmv",
        });
        return { properties, findings };
    }

    const row = dmv.rows?.[0];
    if ((dmv.rows?.length ?? 0) > 1) {
        properties.push({
            label: "Health rows",
            value: `${dmv.rows!.length} DMV rows visible — first shown`,
            source: "healthDmv",
        });
    }
    if (dmv.stalenessColumn) {
        const raw = row?.[dmv.stalenessColumn];
        if (raw !== undefined && raw !== null) {
            // Label = the RESOLVED column name — never a guide-assumed alias.
            properties.push({ label: dmv.stalenessColumn, value: raw, source: "healthDmv" });
            findings.push({
                severity: "info",
                title: `${dmv.stalenessColumn}: ${raw}`,
                detail:
                    "documentation describes 0–5% as steady state, 20–30% during batch " +
                    "loads as self-draining, sustained >10–15% as worth investigating — " +
                    "attributed to docs; there is no universal rebuild threshold.",
            });
        }
    }
    if (dmv.lastTaskColumn) {
        const raw = row?.[dmv.lastTaskColumn];
        if (raw !== undefined && raw !== null) {
            properties.push({ label: dmv.lastTaskColumn, value: raw, source: "healthDmv" });
        }
    }
    properties.push({
        label: "Health history",
        value: "unavailable — current snapshot only",
        source: "derived",
    });
    return { properties, findings };
}

function truncateFinding(): VectorIndexFinding {
    return {
        severity: "info",
        title: "TRUNCATE TABLE blocked while index exists",
        detail: "documented sequence: drop index → truncate → repopulate ≥ 100 rows → recreate.",
    };
}

function filterColumnFindings(target: VectorIndexTargetFacts | undefined): VectorIndexFinding[] {
    return (target?.filterColumns ?? []).map((column) => ({
        severity: "info" as const,
        title: `Filter column "${column}" observed in search filters`,
        detail:
            "supporting-index script generated — review suggestion, not a command; " +
            "this probe does not inspect existing nonclustered indexes.",
    }));
}

/**
 * Derive the full Index workspace view from one probe pass. Pure function —
 * the entire VEC-9 state machine lives here.
 */
export function deriveVectorIndexView(
    probe: VectorCapabilityProbe,
    target?: VectorIndexTargetFacts,
): VectorIndexWorkspaceView {
    const shared = sharedFacts(probe);

    // --- permissionDegraded: the index catalog itself could not be read ----
    if (!probe.indexes.available) {
        const reason = probe.indexes.error ? bounded(probe.indexes.error) : "catalog unreadable";
        return {
            state: "permissionDegraded",
            properties: [
                ...shared.engineProps,
                { label: "Index catalog", value: `unavailable — ${reason}`, source: "catalog" },
                { label: "Health", value: "unavailable", source: "derived" },
                ...shared.configProps,
            ],
            findings: [
                {
                    severity: "warning",
                    title: "Health unavailable",
                    detail:
                        "index catalog / DMV visibility is degraded on this connection — " +
                        "facts shown are partial and nothing here is a health claim. " +
                        `Reason: ${reason}`,
                },
            ],
            // The snapshot query is still generated so the user can run it
            // elsewhere with sufficient permissions (review-only, as always).
            scripts: [
                {
                    id: "healthSnapshot",
                    title: "Generate health snapshot query",
                    sql: buildHealthSnapshotScript(probe.healthDmv),
                },
            ],
        };
    }

    const confirmed = probe.indexes.indexes;
    const relevant = target
        ? confirmed.filter(
              (row) =>
                  sameIdent(row.schemaName, target.schema) &&
                  sameIdent(row.tableName, target.table),
          )
        : confirmed;
    const index = relevant[0];

    // --- states WITH a confirmed index --------------------------------------
    if (index) {
        return deriveIndexPresentView(probe, target, index, confirmed.length, shared);
    }

    // --- buildFailedTier: host-observed CREATE failure (Msg 42234) ----------
    if (isTierBuildFailure(target?.recentCreateError)) {
        return deriveNoIndexView(probe, target, shared, {
            state: "buildFailedTier",
            extraFindings: [
                {
                    severity: "error",
                    title: "Vector index build failed on this service tier (Msg 42234)",
                    detail:
                        "verified in the wild on serverless tiers: CREATE VECTOR INDEX is " +
                        "accepted but the DiskANN build fails; vector-index availability is " +
                        "per-database (tier/resources), not per-engine. A failed build can " +
                        "leave a transient phantom row in sys.vector_indexes.",
                },
            ],
            extraProperties: [
                {
                    label: "Last CREATE attempt",
                    value: bounded(target!.recentCreateError!.text),
                    source: "derived",
                },
            ],
        });
    }

    // --- noVectorColumns: nothing to describe at all -------------------------
    const anyVectorColumnEvidence =
        target !== undefined ||
        probe.vectorSearchTvf.target !== undefined ||
        confirmed.length > 0 ||
        probe.indexes.phantomCount > 0;
    if (!anyVectorColumnEvidence) {
        return {
            state: "noVectorColumns",
            properties: [...shared.engineProps, ...shared.configProps],
            findings: [
                {
                    severity: "info",
                    title: "No vector columns detected",
                    detail:
                        "probe discovery found no vector-typed columns and no vector " +
                        "indexes are visible — the Index workspace has nothing to describe.",
                },
            ],
            scripts: [],
        };
    }

    // --- noIndex (including the phantom-row case) ----------------------------
    return deriveNoIndexView(probe, target, shared, { state: "noIndex" });
}

function deriveIndexPresentView(
    probe: VectorCapabilityProbe,
    target: VectorIndexTargetFacts | undefined,
    index: VectorIndexProbeRow,
    confirmedCount: number,
    shared: SharedFacts,
): VectorIndexWorkspaceView {
    const format = classifyVersion(index);
    const state: VectorIndexWorkspaceState = format.legacy ? "legacyFormat" : "healthyCurrent";
    const health = healthFacts(probe);

    const properties: VectorIndexProperty[] = [
        { label: "Index", value: index.indexName, source: "catalog" },
        { label: "Table", value: `${index.schemaName}.${index.tableName}`, source: "catalog" },
        {
            label: "Type · metric",
            value: `${index.indexType ?? "type not reported"} · ${index.distanceMetric ?? "metric not reported"}`,
            source: "catalog",
        },
        { label: "Version", value: format.versionText, source: "catalog" },
        ...health.properties,
        ...shared.configProps,
        ...shared.engineProps,
    ];
    if (confirmedCount > 1) {
        properties.push({
            label: "Vector indexes visible",
            value: `${confirmedCount} — first on this target shown`,
            source: "derived",
        });
    }

    const findings: VectorIndexFinding[] = [];
    if (format.legacy) {
        // The service-impact warning leads the list so the view can render it
        // ABOVE the migration script (P0-3).
        findings.push({
            severity: "warning",
            title: "Migration drops and recreates the index",
            detail:
                "SERVICE IMPACT: approximate search on this table is disabled from " +
                "DROP until the new index finishes building — plan a maintenance window.",
        });
        findings.push({
            severity: "warning",
            title: `Earlier index format (${format.versionText})`,
            detail:
                "documented: no in-place upgrade exists for vector indexes; migration " +
                "is drop + recreate.",
        });
        findings.push({
            severity: "info",
            title: "Filtered approximate searches are post-filtered on this format",
            detail:
                "predicates apply after approximate retrieval on earlier formats — the " +
                "Search workspace oversamples TOP_N ×M and discloses it.",
        });
    } else {
        findings.push(
            index.version !== undefined
                ? {
                      severity: "success",
                      title: `Current index format (v${index.version})`,
                      detail:
                          "documented for the latest DiskANN format: full DML support, " +
                          "iterative filtering, optimizer ANN/kNN choice.",
                  }
                : {
                      severity: "success",
                      title: "Index format is current for this engine",
                      detail:
                          "build_parameters carries no $.Version key on SQL Server 2025 RTM " +
                          "— absence IS the current format there (probed, never assumed).",
                  },
        );
    }
    if (target?.metric && index.distanceMetric) {
        const match = sameIdent(target.metric, index.distanceMetric);
        findings.push(
            match
                ? {
                      severity: "success",
                      title: `Metric matches search (${index.distanceMetric.toLowerCase()})`,
                      detail: "approximate search can serve queries with this metric.",
                  }
                : {
                      severity: "warning",
                      title: `Metric mismatch: index ${index.distanceMetric.toLowerCase()}, search ${target.metric.toLowerCase()}`,
                      detail:
                          "an approximate search with a different metric cannot use this " +
                          "index — exact VECTOR_DISTANCE remains available.",
                  },
        );
    }
    findings.push(...health.findings);
    findings.push(truncateFinding());
    findings.push(...filterColumnFindings(target));
    if (probe.indexes.phantomCount > 0) {
        findings.push(phantomFinding(probe.indexes.phantomCount));
    }

    const vectorColumn = target?.vectorColumn;
    const scripts: VectorIndexScript[] = [];
    if (format.legacy) {
        scripts.push({
            id: "migration",
            title: `Generate migration script (${index.version !== undefined ? `v${index.version}` : "earlier"} → current)`,
            sql: buildMigrationScript({
                schema: index.schemaName,
                table: index.tableName,
                indexName: index.indexName,
                ...(vectorColumn ? { vectorColumn } : {}),
                ...(index.distanceMetric ? { metric: index.distanceMetric } : {}),
            }),
        });
    }
    scripts.push({
        id: "createIndex",
        title: "Generate create vector index script",
        sql: buildCreateVectorIndexScript({
            schema: index.schemaName,
            table: index.tableName,
            indexName: index.indexName,
            ...(vectorColumn ? { vectorColumn } : {}),
            ...(index.distanceMetric ? { metric: index.distanceMetric } : {}),
        }),
    });
    scripts.push({
        id: "healthSnapshot",
        title: "Generate health snapshot query",
        sql: buildHealthSnapshotScript(probe.healthDmv),
    });
    pushSupportingAndGateScripts(scripts, target, index.schemaName, index.tableName, shared);

    return { state, properties, findings, scripts };
}

function phantomFinding(phantomCount: number): VectorIndexFinding {
    return {
        severity: "warning",
        title: `Transient phantom row${phantomCount === 1 ? "" : "s"} in sys.vector_indexes (${phantomCount})`,
        detail:
            "residue of a failed DiskANN build (verified live on Azure): absent from " +
            "sys.indexes, unusable by VECTOR_SEARCH (42227), not droppable (3701), " +
            "blocks re-CREATE in the same window (42230), and self-cleans in about a " +
            "minute. Treated as no usable index.",
    };
}

function deriveNoIndexView(
    probe: VectorCapabilityProbe,
    target: VectorIndexTargetFacts | undefined,
    shared: SharedFacts,
    options: {
        readonly state: "noIndex" | "buildFailedTier";
        readonly extraFindings?: readonly VectorIndexFinding[];
        readonly extraProperties?: readonly VectorIndexProperty[];
    },
): VectorIndexWorkspaceView {
    const health = healthFacts(probe);
    const properties: VectorIndexProperty[] = [
        ...(target
            ? [
                  {
                      label: "Target",
                      value: `${target.schema}.${target.table}${target.vectorColumn ? `.${target.vectorColumn}` : ""}`,
                      source: "derived" as const,
                  },
              ]
            : []),
        { label: "Vector index", value: "none confirmed on this target", source: "catalog" },
        ...(options.extraProperties ?? []),
        // DMV presence is still a fact worth stating; staleness rows without
        // an index would be nonsensical, so only the presence line is reused.
        ...health.properties.filter((property) => property.label === "Health DMV"),
        ...shared.configProps,
        ...shared.engineProps,
    ];

    const findings: VectorIndexFinding[] = [...(options.extraFindings ?? [])];
    if (probe.indexes.phantomCount > 0) {
        findings.push(phantomFinding(probe.indexes.phantomCount));
    }
    findings.push({
        severity: "info",
        title: "No vector index on this target",
        detail:
            "exact VECTOR_DISTANCE search remains available without an index; a create " +
            "script is generated for review only — this pane never executes DDL.",
    });
    if (shared.previewKnownOff) {
        findings.push({
            severity: "info",
            title: "PREVIEW_FEATURES is OFF (database-scoped)",
            detail:
                "verified live: PREVIEW_FEATURES gates VECTOR_SEARCH parse acceptance; " +
                "CREATE VECTOR INDEX gating varies by engine — probed per connection, " +
                "never assumed. Enablement script generated for review.",
        });
    }
    findings.push(...filterColumnFindings(target));

    const scripts: VectorIndexScript[] = [];
    if (target) {
        scripts.push({
            id: "createIndex",
            title: "Generate create vector index script",
            sql: buildCreateVectorIndexScript({
                schema: target.schema,
                table: target.table,
                ...(target.vectorColumn ? { vectorColumn: target.vectorColumn } : {}),
                ...(target.metric ? { metric: target.metric } : {}),
            }),
        });
    }
    scripts.push({
        id: "healthSnapshot",
        title: "Generate health snapshot query",
        sql: buildHealthSnapshotScript(probe.healthDmv),
    });
    pushSupportingAndGateScripts(scripts, target, target?.schema, target?.table, shared);

    return { state: options.state, properties, findings, scripts };
}

function pushSupportingAndGateScripts(
    scripts: VectorIndexScript[],
    target: VectorIndexTargetFacts | undefined,
    schema: string | undefined,
    table: string | undefined,
    shared: SharedFacts,
): void {
    const filterColumns = target?.filterColumns ?? [];
    if (filterColumns.length > 0 && schema && table) {
        scripts.push({
            id: "supportingIndex",
            title: "Generate supporting index (review)",
            sql: buildSupportingIndexScript({ schema, table, filterColumns }),
        });
    }
    if (shared.previewKnownOff) {
        scripts.push({
            id: "enablePreview",
            title: "Generate configuration-gate script (PREVIEW_FEATURES)",
            sql: buildEnablePreviewScript(),
        });
    }
}

// ---------------------------------------------------------------------------
// The service (thunk in, view out — nothing else)
// ---------------------------------------------------------------------------

export class VectorIndexService {
    /**
     * @param capabilities Thunk over VectorCapabilityService.capabilities —
     * session sourcing/caching live THERE. This service holds no session.
     * @param targetFacts Optional host-resolved search-target facts.
     */
    constructor(
        private readonly capabilities: VectorCapabilityThunk,
        private readonly targetFacts: () => VectorIndexTargetFacts | undefined = () => undefined,
    ) {}

    /** Answer `qs/vector.indexState` (refresh bypasses the probe cache). */
    async indexState(refresh = false): Promise<QsVectorIndexStateResult> {
        const capabilities = await this.capabilities(refresh);
        if (!capabilities.probe) {
            return {
                error:
                    capabilities.error ??
                    "Vector capability probe unavailable for this connection.",
            };
        }
        return { view: deriveVectorIndexView(capabilities.probe, this.targetFacts()) };
    }
}
