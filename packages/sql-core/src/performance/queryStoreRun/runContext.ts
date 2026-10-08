/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PlatformInfo, hasQueryStore } from "../../common/platform";
import { sessionPreamble } from "../../common/session";
import {
    SqlReadOptions,
    SqlReader,
    SqlResultSet,
    parseSqlDateTime,
    toBooleanValue,
} from "../../common/sqlReader";
import { MissingDataCode, PerfResult, errorResult, unsupportedResult } from "../result";
import { PerfRunOptions, readOptionsOf } from "../runOptions";
import { QueryStoreColumnInfo } from "../queryStore/common/columnInfo";
import { assertBoolean } from "../queryStore/common/configuration";
import { QueryStoreMetric, assertQueryStoreMetric } from "../queryStore/common/metric";
import {
    QueryStoreOperationalMode,
    mapQueryStoreOperationalMode,
    queryStoreOperationalModeQuery,
} from "../queryStore/common/operationalMode";
import {
    availableMetricsProbeQuery,
    mapAvailableMetrics,
    mapReplicaGroupColumnProbe,
    replicaGroupColumnProbeQuery,
} from "../queryStore/common/qdsMetadata";
import { replicaGroupIds } from "../queryStore/common/replicaGroup";
import { formatBigInt } from "../queryStore/common/sqlParameters";
import { QueryStoreStatistic } from "../queryStore/common/statistic";
import {
    QueryStoreReport,
    ReportColumnSource,
    toQueryStoreReport,
    toReportColumns,
} from "./reportData";

/** The options of the Query Store run functions. */
export interface QueryStoreRunOptions extends PerfRunOptions {
    /**
     * The metrics that the server records, from an earlier `probeQueryStore`. Skips the metadata
     * probe.
     */
    readonly availableMetrics?: readonly QueryStoreMetric[];
    /**
     * True when the server has Query Store for secondary replicas, from an earlier
     * `probeQueryStore`. Skips the replica probe.
     */
    readonly isQdsRoAvailable?: boolean;
}

/** The sort order of a report. */
export interface ReportOrderOptions {
    /** A {@link ReportColumn.id} of the report. The default depends on the report. */
    readonly orderByColumnId?: string;
    /** Default true, except where a report says otherwise. */
    readonly descending?: boolean;
}

/**
 * `sqlEngine`: SQL Server 2016 and later, Azure SQL Managed Instance, Azure SQL Database, and SQL
 * database in Fabric. `synapseDedicated`: Query Store with duration and execution count only.
 */
export type QueryStoreFamily = "sqlEngine" | "synapseDedicated";

export function queryStoreFamily(info: PlatformInfo): QueryStoreFamily | undefined {
    if (hasQueryStore(info)) {
        return "sqlEngine";
    }
    return info.platform === "synapseDedicated" ? "synapseDedicated" : undefined;
}

/**
 * The metrics that Synapse dedicated pools record. The other runtime columns are 0, and the
 * plan columns of SQL Server 2022 cause an error.
 */
export const synapseDedicatedQueryStoreMetrics: readonly QueryStoreMetric[] = [
    "duration",
    "executionCount",
];

/** The `sys.query_store_plan` columns that only some versions have. */
export interface PlanColumnAvailability {
    /** `plan_forcing_type_desc`: SQL Server 2017 and later, and the Azure platforms. */
    readonly hasPlanForcingType: boolean;
    /** `plan_type_desc`: SQL Server 2022 and later, and the Azure platforms. */
    readonly hasPlanType: boolean;
}

export interface QueryStoreProbe {
    readonly mode: QueryStoreOperationalMode;
    /**
     * The metrics that the reports can use, in `sys.query_store_runtime_stats` column order. On
     * Synapse dedicated pools, only duration and execution count. Empty when the run did not ask
     * for metrics.
     */
    readonly availableMetrics: readonly QueryStoreMetric[];
    readonly isQdsRoAvailable: boolean;
    readonly planColumns: PlanColumnAvailability;
    /**
     * The start of the oldest runtime stats interval. Only when the run asked for it and Query
     * Store has an interval.
     */
    readonly oldestIntervalStart?: Date;
}

export interface QueryStoreProbeRequest {
    /** Reads the metrics, unless the options have them. */
    readonly metrics?: boolean;
    /** Reads the {@link PlanColumnAvailability}. */
    readonly planColumns?: boolean;
    /** Reads {@link QueryStoreProbe.oldestIntervalStart}. */
    readonly oldestInterval?: boolean;
}

const planColumnsProbeQuery = `SELECT
    CASE WHEN COL_LENGTH('sys.query_store_plan', 'plan_forcing_type_desc') IS NULL THEN 0 ELSE 1 END AS has_plan_forcing_type,
    CASE WHEN COL_LENGTH('sys.query_store_plan', 'plan_type_desc') IS NULL THEN 0 ELSE 1 END AS has_plan_type;`;

const oldestIntervalProbeQuery = `SELECT MIN(start_time) AS oldest_interval_start
FROM sys.query_store_runtime_stats_interval;`;

/**
 * Returns the probe batch: the session preamble, the Query Store state, and the metric, replica,
 * and plan column probes that the run needs. Exported for tests.
 */
export function buildQueryStoreProbeQuery(
    info: PlatformInfo,
    request: QueryStoreProbeRequest,
    options: QueryStoreRunOptions = {},
): string {
    const parts = [sessionPreamble(info, "read"), `${queryStoreOperationalModeQuery};`];
    if (request.metrics && options.availableMetrics === undefined) {
        parts.push(availableMetricsProbeQuery);
    }
    if (options.isQdsRoAvailable === undefined) {
        parts.push(replicaGroupColumnProbeQuery.trim());
    }
    if (request.planColumns) {
        parts.push(planColumnsProbeQuery);
    }
    if (request.oldestInterval) {
        parts.push(oldestIntervalProbeQuery);
    }
    return parts.join("\n");
}

/** Runs the probe batch and maps its result sets. */
export async function readQueryStoreProbe(
    reader: SqlReader,
    info: PlatformInfo,
    family: QueryStoreFamily,
    request: QueryStoreProbeRequest,
    options: QueryStoreRunOptions,
): Promise<QueryStoreProbe> {
    const resultSets = await reader.read(
        buildQueryStoreProbeQuery(info, request, options),
        readOptionsOf(options),
    );
    let index = 0;
    const next = (count: number): SqlResultSet[] => {
        const sets = resultSets.slice(index, index + count);
        index += count;
        return sets;
    };

    const mode = mapQueryStoreOperationalMode(next(1));
    let availableMetrics: readonly QueryStoreMetric[] = [];
    if (request.metrics) {
        availableMetrics =
            options.availableMetrics !== undefined
                ? options.availableMetrics.map(assertQueryStoreMetric)
                : mapAvailableMetrics(next(2));
        if (family === "synapseDedicated") {
            availableMetrics = availableMetrics.filter((metric) =>
                synapseDedicatedQueryStoreMetrics.includes(metric),
            );
        }
    }
    const isQdsRoAvailable =
        options.isQdsRoAvailable !== undefined
            ? assertBoolean(options.isQdsRoAvailable)
            : mapReplicaGroupColumnProbe(next(1));
    let planColumns: PlanColumnAvailability = { hasPlanForcingType: false, hasPlanType: false };
    if (request.planColumns) {
        const row = next(1)[0]?.rows[0];
        planColumns = {
            hasPlanForcingType: toBooleanValue(row?.[0]) ?? false,
            hasPlanType: toBooleanValue(row?.[1]) ?? false,
        };
    }
    const oldestIntervalStart = request.oldestInterval
        ? parseSqlDateTime(next(1)[0]?.rows[0]?.[0])
        : undefined;
    return {
        mode,
        availableMetrics,
        isQdsRoAvailable,
        planColumns,
        ...(oldestIntervalStart ? { oldestIntervalStart } : {}),
    };
}

/** What a run function has to work with after the probe. */
export interface QueryStoreRunContext {
    readonly reader: SqlReader;
    readonly info: PlatformInfo;
    readonly family: QueryStoreFamily;
    readonly probe: QueryStoreProbe;
    readonly now: Date;
    readonly readOptions: SqlReadOptions;
}

export type RunOutcome<T> =
    | {
          readonly status: "ready";
          readonly data: T;
          readonly missing?: readonly MissingDataCode[];
      }
    | {
          readonly status: "noData";
          /** A report keeps its columns. */
          readonly data?: T;
          readonly missing?: readonly MissingDataCode[];
      }
    | { readonly status: "unsupported" };

export interface QueryStoreRunSpec extends QueryStoreProbeRequest {
    /**
     * The replica group of the request. A group other than the primary needs Query Store for
     * secondary replicas.
     */
    readonly replicaGroupId?: number | bigint | string;
    /** False when Synapse dedicated pools do not have the data. Default true. */
    readonly synapseDedicated?: boolean;
}

export const unsupportedOutcome: RunOutcome<never> = { status: "unsupported" };

/**
 * Checks the platform, runs the probe, and then runs `body`:
 *
 * - an unsupported platform, or a replica group other than the primary without Query Store for
 *   secondary replicas, gives `unsupported`;
 * - Query Store OFF or in the error state gives `notConfigured`;
 * - READ_ONLY runs the body and adds `queryStoreReadOnly`;
 * - a read failure gives the status of the error.
 */
export async function runWithQueryStore<T>(
    reader: SqlReader,
    info: PlatformInfo,
    options: QueryStoreRunOptions,
    spec: QueryStoreRunSpec,
    body: (context: QueryStoreRunContext) => Promise<RunOutcome<T>>,
): Promise<PerfResult<T>> {
    const now = options.now ?? new Date();
    const family = queryStoreFamily(info);
    if (!family || (family === "synapseDedicated" && spec.synapseDedicated === false)) {
        return unsupportedResult(info, now);
    }
    const replicaGroupId = formatBigInt(spec.replicaGroupId ?? replicaGroupIds.primary);
    const base = {
        platform: info.platform,
        source: "queryStore",
        scope: "database",
        observedAtUtc: now.toISOString(),
    } as const;

    try {
        const probe = await readQueryStoreProbe(reader, info, family, spec, options);
        if (probe.mode.operationalStatus === "off") {
            return { ...base, status: "notConfigured", missing: [] };
        }
        if (replicaGroupId !== String(replicaGroupIds.primary) && !probe.isQdsRoAvailable) {
            return { ...base, status: "unsupported", missing: [] };
        }
        const outcome = await body({
            reader,
            info,
            family,
            probe,
            now,
            readOptions: readOptionsOf(options),
        });
        if (outcome.status === "unsupported") {
            return { ...base, status: "unsupported", missing: [] };
        }
        const missing = new Set<MissingDataCode>(outcome.missing ?? []);
        if (probe.mode.operationalStatus === "readOnly") {
            missing.add("queryStoreReadOnly");
        }
        return {
            ...base,
            status: outcome.status,
            ...(outcome.data !== undefined ? { data: outcome.data } : {}),
            missing: [...missing],
        };
    } catch (error) {
        return errorResult(info, error, now, "queryStore");
    }
}

/** Runs a report query after the read preamble and maps its only result set. */
export async function readQueryStoreReport(
    context: QueryStoreRunContext,
    sql: string,
    sources: readonly ReportColumnSource[],
): Promise<QueryStoreReport> {
    const [resultSet] = await context.reader.read(
        `${sessionPreamble(context.info, "read")}\n${sql}`,
        context.readOptions,
    );
    return toQueryStoreReport(sources, resultSet);
}

/** `ready` with rows, `noData` without. */
export function reportOutcome<T extends QueryStoreReport>(
    data: T,
    missing: readonly MissingDataCode[] = [],
): RunOutcome<T> {
    return { status: data.rows.length > 0 ? "ready" : "noData", data, missing };
}

/**
 * The missing codes of a report that has every available metric: wait stats and the log and
 * tempdb metrics on SQL Server 2016, and the resource metrics on Synapse dedicated pools.
 */
export function allMetricsMissing(context: QueryStoreRunContext): MissingDataCode[] {
    const metrics = context.probe.availableMetrics;
    const missing: MissingDataCode[] = [];
    if (context.family === "synapseDedicated") {
        missing.push("queryStoreResourceMetrics");
    }
    if (!metrics.includes("waitTime")) {
        missing.push("queryStoreWaitStats");
    }
    if (
        context.family === "sqlEngine" &&
        (!metrics.includes("logMemoryUsed") || !metrics.includes("tempDbMemoryUsed"))
    ) {
        missing.push("queryStoreLogAndTempdbMetrics");
    }
    return missing;
}

/** A resolved sort order: the generator column, or none for the generator's default. */
export interface ResolvedReportOrder {
    readonly column?: QueryStoreColumnInfo;
    readonly descending: boolean;
}

/**
 * Resolves the sort order of a report. Returns undefined when the requested column is not in the
 * report, for example a metric that the server does not record.
 */
export function resolveReportOrder(
    columns: readonly QueryStoreColumnInfo[],
    order: ReportOrderOptions,
    defaultColumn: QueryStoreColumnInfo | undefined,
    defaultDescending = true,
): ResolvedReportOrder | undefined {
    const descending = assertBoolean(order.descending ?? defaultDescending);
    if (order.orderByColumnId === undefined) {
        return { column: defaultColumn, descending };
    }
    const index = toReportColumns(columns).findIndex(
        (column) => column.id === order.orderByColumnId,
    );
    return index < 0 ? undefined : { column: columns[index], descending };
}

/** Like {@link resolveReportOrder}, but throws a `RangeError` for a column that is not there. */
export function requireReportOrder(
    columns: readonly QueryStoreColumnInfo[],
    order: ReportOrderOptions,
    defaultColumn: QueryStoreColumnInfo | undefined,
    defaultDescending = true,
): ResolvedReportOrder {
    const resolved = resolveReportOrder(columns, order, defaultColumn, defaultDescending);
    if (!resolved) {
        throw unknownColumnError(order);
    }
    return resolved;
}

/** The error for a sort column that the report does not have with any metric. */
export function unknownColumnError(order: ReportOrderOptions): RangeError {
    return new RangeError(`The report has no column "${String(order.orderByColumnId)}".`);
}

/**
 * The column of a statistic of a metric: the exact match, or else another statistic of the
 * metric, or else the execution count column for `executionCount`.
 */
export function metricColumn(
    columns: readonly QueryStoreColumnInfo[],
    metric: QueryStoreMetric,
    statistic: QueryStoreStatistic,
    kind: QueryStoreColumnInfo["kind"] = "statisticMetric",
): QueryStoreColumnInfo | undefined {
    return (
        columns.find(
            (column) =>
                column.kind === kind && column.metric === metric && column.statistic === statistic,
        ) ??
        columns.find((column) => column.kind === kind && column.metric === metric) ??
        (metric === "executionCount"
            ? columns.find((column) => column.kind === "executionCount")
            : undefined)
    );
}

/**
 * Puts another body after the declarations of a generated batch. Some generator facades declare
 * the parameters but do not sort, so the run functions use the facade for the declarations and the
 * generator's sorted body for the query. The two bodies use the same parameters. Throws an `Error`
 * when the batch does not end with `body`.
 */
export function replaceQueryBody(batch: string, body: string, newBody: string): string {
    const trimmed = body.trim();
    if (!batch.endsWith(trimmed)) {
        throw new Error("The generated batch does not end with the query body.");
    }
    return `${batch.slice(0, batch.length - trimmed.length)}${newBody.trim()}`;
}
