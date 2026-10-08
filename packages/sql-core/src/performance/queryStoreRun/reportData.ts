/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlResultSet, parseSqlDateTime, toBooleanValue, toIdText } from "../../common/sqlReader";
import { QueryStoreColumnKind } from "../queryStore/common/columnInfo";
import { QueryStoreMetric, QueryStoreMetricUnit, getMetricInfo } from "../queryStore/common/metric";
import { QueryStoreStatistic } from "../queryStore/common/statistic";
import { ComparisonTimeInterval } from "../queryStore/common/timeInterval";

/** A report cell. `null` is SQL `NULL`. */
export type ReportValue = string | number | boolean | null;

/** A report row, keyed by {@link ReportColumn.id}. */
export type ReportRow = Readonly<Record<string, ReportValue>>;

/**
 * The kind of a report column: a Query Store column kind, or `queryTextId` for tracked queries.
 * Callers show localized header text for each kind.
 */
export type ReportColumnKind = QueryStoreColumnKind | "queryTextId";

/**
 * How the values of a column are normalized:
 *
 * - `id`: a decimal string, so that `bigint` IDs stay exact;
 * - `number`: a number;
 * - `text`: a string;
 * - `date`: an ISO 8601 string in UTC (text that the reader returns in another format stays as
 *   it is);
 * - `boolean`: a boolean.
 */
export type ReportValueType = "id" | "number" | "text" | "date" | "boolean";

/**
 * The unit of a numeric column. Callers show localized text for each code. Counts, degrees of
 * parallelism, row counts, and variation ratios have no unit.
 */
export type ReportUnit = QueryStoreMetricUnit | "percent";

export interface ReportColumn {
    /**
     * Unique in the report, and stable. It is the column label of the generated SQL. When two
     * columns have the same label, the second column has an ID from its kind, for example
     * `last_forced_plan_exec_time` in the Forced Plans report.
     */
    readonly id: string;
    readonly kind: ReportColumnKind;
    readonly valueType: ReportValueType;
    /** Set for metric columns, including execution counts. */
    readonly metric?: QueryStoreMetric;
    /** Set for the statistic of a metric. */
    readonly statistic?: QueryStoreStatistic;
    /** The window of a column in the Regressed Queries report. */
    readonly timeInterval?: "recent" | "history";
    readonly unit?: ReportUnit;
}

/** The rows of a report and the columns that describe them. */
export interface QueryStoreReport {
    readonly columns: readonly ReportColumn[];
    readonly rows: readonly ReportRow[];
}

/** A result set column. `QueryStoreColumnInfo` is one. */
export interface ReportColumnSource {
    readonly kind: ReportColumnKind;
    /** The label in the result set. */
    readonly id: string;
    readonly metric?: QueryStoreMetric;
    readonly statistic?: QueryStoreStatistic;
    readonly timeInterval?: ComparisonTimeInterval;
}

const valueTypes: Readonly<Record<ReportColumnKind, ReportValueType>> = {
    queryId: "id",
    objectId: "id",
    planId: "id",
    forcedPlanId: "id",
    queryTextId: "id",
    objectName: "text",
    queryText: "text",
    waitCategoryDesc: "text",
    forcedPlanFailureDescription: "text",
    executionType: "number",
    waitCategoryId: "number",
    numPlans: "number",
    forcedPlanFailureCount: "number",
    executionCount: "number",
    statisticMetric: "number",
    statisticMetricTime: "number",
    statisticMetricRegression: "number",
    lastCompileStartTime: "date",
    lastForcedPlanExecTime: "date",
    lastQueryExecTime: "date",
    firstExecTime: "date",
    lastExecTime: "date",
    bucketStartTime: "date",
    bucketEndTime: "date",
    planForced: "boolean",
};

/**
 * Describes the columns of a result set. The IDs are the labels, made unique as described in
 * {@link ReportColumn.id}.
 */
export function toReportColumns(sources: readonly ReportColumnSource[]): ReportColumn[] {
    const used = new Set<string>();
    return sources.map((source) => {
        const id = uniqueId(source, used);
        used.add(id);
        const metric =
            source.metric ?? (source.kind === "executionCount" ? "executionCount" : undefined);
        const timeInterval =
            source.timeInterval === "recent" || source.timeInterval === "history"
                ? source.timeInterval
                : undefined;
        const column: ReportColumn = {
            id,
            kind: source.kind,
            valueType: valueTypes[source.kind],
            ...(metric !== undefined ? { metric } : {}),
            ...(source.statistic !== undefined ? { statistic: source.statistic } : {}),
            ...(timeInterval !== undefined ? { timeInterval } : {}),
        };
        const unit = unitOf(column);
        return unit !== undefined ? { ...column, unit } : column;
    });
}

/**
 * Maps a result set to a report. A column is found by its label, case-insensitively; when two
 * columns have the same label, they are matched in order. Result set columns without a source,
 * such as `replica_group_id` in some detailed reports, are left out. Throws an `Error` when the
 * result set has rows but does not have a column.
 */
export function toQueryStoreReport(
    sources: readonly ReportColumnSource[],
    resultSet: SqlResultSet | undefined,
): QueryStoreReport {
    const columns = toReportColumns(sources);
    if (!resultSet || resultSet.rows.length === 0) {
        return { columns, rows: [] };
    }
    const taken = new Set<number>();
    const indexes = sources.map((source) => {
        const label = source.id.toLowerCase();
        const index = resultSet.columns.findIndex(
            (name, position) => !taken.has(position) && name.toLowerCase() === label,
        );
        if (index < 0) {
            throw new Error(`The result set does not have the column "${source.id}".`);
        }
        taken.add(index);
        return index;
    });
    const rows = resultSet.rows.map((row) => {
        const record: Record<string, ReportValue> = {};
        columns.forEach((column, position) => {
            record[column.id] = normalizeReportValue(row[indexes[position]], column.valueType);
        });
        return record;
    });
    return { columns, rows };
}

/** Normalizes a reader value for a column type. A value of another type stays as it is. */
export function normalizeReportValue(value: unknown, valueType: ReportValueType): ReportValue {
    if (value === null || value === undefined) {
        return null;
    }
    switch (valueType) {
        case "id":
            return toIdText(value) ?? scalar(value);
        case "number":
            return toNumberValue(value) ?? scalar(value);
        case "date":
            return parseSqlDateTime(value)?.toISOString() ?? scalar(value);
        case "boolean":
            return toBooleanValue(value) ?? scalar(value);
        default:
            return typeof value === "string" ? value : scalar(value);
    }
}

/** Criteria for {@link findReportColumn}. Each field that is set must match. */
export interface ReportColumnCriteria {
    readonly kind?: ReportColumnKind;
    readonly metric?: QueryStoreMetric;
    readonly statistic?: QueryStoreStatistic;
    readonly timeInterval?: "recent" | "history";
}

/**
 * Returns the first column that matches, for example the recent average duration of a Regressed
 * Queries report: `{ kind: "statisticMetricTime", metric: "duration", timeInterval: "recent" }`.
 */
export function findReportColumn(
    columns: readonly ReportColumn[],
    criteria: ReportColumnCriteria,
): ReportColumn | undefined {
    return columns.find(
        (column) =>
            (criteria.kind === undefined || column.kind === criteria.kind) &&
            (criteria.metric === undefined || column.metric === criteria.metric) &&
            (criteria.statistic === undefined || column.statistic === criteria.statistic) &&
            (criteria.timeInterval === undefined || column.timeInterval === criteria.timeInterval),
    );
}

/**
 * Returns a `query_plan_hash` as `0x` and uppercase hex, the text of `CONVERT(varchar(18), hash,
 * 1)`, so that hashes compare as strings. Undefined for an empty value.
 */
export function normalizeQueryPlanHash(value: string | undefined): string | undefined {
    const text = value?.trim();
    return text ? `0x${text.replace(/^0x/i, "").toUpperCase()}` : undefined;
}

function uniqueId(source: ReportColumnSource, used: ReadonlySet<string>): string {
    if (!used.has(source.id)) {
        return source.id;
    }
    const base = source.kind.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    let id = base;
    for (let suffix = 2; used.has(id); suffix++) {
        id = `${base}_${suffix}`;
    }
    return id;
}

function unitOf(column: ReportColumn): ReportUnit | undefined {
    if (column.metric === undefined || column.valueType !== "number") {
        return undefined;
    }
    if (column.kind === "statisticMetricRegression" && column.statistic !== "total") {
        return "percent";
    }
    if (column.statistic === "variation") {
        return undefined;
    }
    return getMetricInfo(column.metric).unit;
}

function toNumberValue(value: unknown): number | undefined {
    if (typeof value === "number") {
        return value;
    }
    if (typeof value === "boolean") {
        return value ? 1 : 0;
    }
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function scalar(value: unknown): ReportValue {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    return String(value);
}
