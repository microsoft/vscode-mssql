/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type QueryStoreMetric = "duration" | "cpu" | "reads" | "executions";
export type QueryStoreAggregation = "total" | "weightedMean" | "maximum" | "pooledVariation";
export type QueryStoreExecutionType = "all" | "successful" | "aborted" | "exception";
export type QueryStoreSource = "user" | "internal";

export interface QueryStoreInvestigationContext {
    readonly window: {
        readonly kind: "lookback" | "comparison";
        readonly referenceAt: string;
        readonly start: string;
        readonly end: string;
        readonly baselineStart?: string;
        readonly baselineEnd?: string;
        readonly timezone: "UTC";
        readonly includesCurrentInterval: boolean;
    };
    readonly metric: QueryStoreMetric;
    readonly aggregation: QueryStoreAggregation;
    readonly filters: {
        readonly queryId?: number;
        readonly text?: string;
        readonly executionType: QueryStoreExecutionType;
        readonly source?: QueryStoreSource;
        readonly waitCategory?: string;
    };
    readonly rowLimit?: number;
    readonly minimumExecutions?: number;
    readonly coverage: {
        readonly kind: "intervals";
        readonly note: string;
    };
}

const metrics: readonly QueryStoreMetric[] = ["duration", "cpu", "reads", "executions"];
const aggregations: readonly QueryStoreAggregation[] = [
    "total",
    "weightedMean",
    "maximum",
    "pooledVariation",
];
const executionTypes: readonly QueryStoreExecutionType[] = [
    "all",
    "successful",
    "aborted",
    "exception",
];

/** Builds the immutable context used by Query Store SQL, views, details, and exports. */
export function queryStoreInvestigationContext(
    queryId: string,
    params: Readonly<Record<string, unknown>> | undefined,
    fallbackReferenceAt: string,
): QueryStoreInvestigationContext {
    const referenceAt = normalizeInstant(
        typeof params?.referenceAt === "string" ? params.referenceAt : fallbackReferenceAt,
    );
    const recentHours = boundedHours(params?.recentHours ?? params?.hours, 24);
    const baselineHours = boundedHours(params?.baselineHours, recentHours);
    const end = new Date(referenceAt);
    const isComparison = queryId === "qds.regressedQueries";
    const recentWindow = explicitWindow(params, "startAt", "endAt");
    const recentStart = recentWindow?.start ?? subtractHours(end, recentHours);
    const recentEnd = recentWindow?.end ?? end;
    if (recentStart >= recentEnd) {
        throw new Error("Query Store investigation windows must have a positive duration.");
    }
    if (recentEnd > end) {
        throw new Error(
            "Query Store investigation windows cannot extend beyond the reference time.",
        );
    }
    const baselineWindow = isComparison
        ? explicitWindow(params, "baselineStartAt", "baselineEndAt")
        : undefined;
    const baselineStart = baselineWindow?.start ?? subtractHours(recentStart, baselineHours);
    const baselineEnd = baselineWindow?.end ?? recentStart;
    if (isComparison && baselineStart >= baselineEnd) {
        throw new Error("Query Store baseline windows must have a positive duration.");
    }
    if (isComparison && baselineEnd > recentStart) {
        throw new Error("Query Store comparison windows must not overlap.");
    }
    const metric = enumValue(params?.metric, metrics, "duration");
    const aggregation = enumValue(
        params?.aggregation,
        aggregations,
        queryId === "qds.highVariation" ? "pooledVariation" : "weightedMean",
    );
    const executionType = enumValue(params?.executionType, executionTypes, "successful");
    const queryFilter = params?.queryId;
    const queryIdFilter =
        typeof queryFilter === "number" && Number.isSafeInteger(queryFilter) && queryFilter > 0
            ? queryFilter
            : undefined;
    const text = typeof params?.text === "string" ? params.text.trim() : undefined;
    if (text && text.length > 256)
        throw new Error("Query Store text filters are limited to 256 characters.");
    const source =
        params?.source === "user" || params?.source === "internal" ? params.source : undefined;
    const waitCategory = boundedText(params?.waitCategory, "waitCategory");
    const rowLimit =
        boundedInteger(params?.top, 1, 1000) ??
        (queryId === "qds.workloadHistory" || queryId === "qds.allQueries"
            ? 1000
            : queryId === "qds.topResourceConsumers" ||
                queryId === "qds.regressedQueries" ||
                queryId === "qds.highVariation"
              ? 50
              : undefined);
    const minimumExecutions = boundedInteger(params?.minExecutions, 1, 1_000_000);

    return {
        window: {
            kind: isComparison ? "comparison" : "lookback",
            referenceAt,
            start: (isComparison ? baselineStart : recentStart).toISOString(),
            end: recentEnd.toISOString(),
            ...(isComparison
                ? {
                      baselineStart: baselineStart.toISOString(),
                      baselineEnd: baselineEnd.toISOString(),
                  }
                : {}),
            timezone: "UTC",
            includesCurrentInterval: recentEnd >= end,
        },
        metric,
        aggregation,
        filters: {
            ...(queryIdFilter === undefined ? {} : { queryId: queryIdFilter }),
            ...(text ? { text } : {}),
            executionType,
            ...(source ? { source } : {}),
            ...(waitCategory ? { waitCategory } : {}),
        },
        ...(rowLimit === undefined ? {} : { rowLimit }),
        ...(minimumExecutions === undefined ? {} : { minimumExecutions }),
        coverage: {
            kind: "intervals",
            note: "Available Query Store aggregation intervals only; missing history is not backfilled.",
        },
    };
}

/** Returns a safe SQL datetimeoffset literal for a previously frozen context reference time. */
export function queryStoreReferenceSql(
    params: Readonly<Record<string, unknown>> | undefined,
): string {
    const raw = params?.referenceAt;
    const instant = normalizeInstant(typeof raw === "string" ? raw : new Date().toISOString());
    return `CONVERT(datetimeoffset, N'${instant}', 127)`;
}

export function normalizeInstant(value: string): string {
    const date = new Date(value);
    if (!value.trim() || Number.isNaN(date.getTime())) {
        throw new Error("Query Store reference time must be a valid instant.");
    }
    return date.toISOString();
}

export interface QueryStorePlanXmlInspection {
    readonly complete: boolean;
    readonly xml?: string;
    readonly reason?: "missing" | "truncated" | "invalidRoot" | "incomplete";
}

/** Prevents the plan viewer and findings from treating clipped XML as a complete plan. */
export function inspectQueryStorePlanXml(
    value: unknown,
    truncated = false,
): QueryStorePlanXmlInspection {
    if (typeof value !== "string" || value.trim().length === 0) {
        return { complete: false, reason: "missing" };
    }
    const xml = value.trim();
    if (truncated) return { complete: false, xml, reason: "truncated" };
    const document = xml.replace(/^<\?xml[^>]*>\s*/i, "");
    if (!/^<ShowPlanXML\b/i.test(document)) {
        return { complete: false, xml, reason: "invalidRoot" };
    }
    if (!/<\/ShowPlanXML>\s*$/i.test(xml)) {
        return { complete: false, xml, reason: "incomplete" };
    }
    return { complete: true, xml };
}

function boundedHours(value: unknown, fallback: number): number {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isSafeInteger(number) && number > 0 && number <= 24 * 90 ? number : fallback;
}

function explicitWindow(
    params: Readonly<Record<string, unknown>> | undefined,
    startKey: string,
    endKey: string,
): { start: Date; end: Date } | undefined {
    const rawStart = params?.[startKey];
    const rawEnd = params?.[endKey];
    if (rawStart === undefined && rawEnd === undefined) return undefined;
    if (typeof rawStart !== "string" || typeof rawEnd !== "string") {
        throw new Error("Query Store investigation windows require both start and end instants.");
    }
    const start = new Date(normalizeInstant(rawStart));
    const end = new Date(normalizeInstant(rawEnd));
    const durationHours = (end.getTime() - start.getTime()) / (60 * 60 * 1000);
    if (!Number.isFinite(durationHours) || durationHours < 1 / 60 || durationHours > 24 * 90) {
        throw new Error(
            "Query Store investigation windows must be between one minute and 90 days.",
        );
    }
    return { start, end };
}

function boundedInteger(value: unknown, min: number, max: number): number | undefined {
    if (value === undefined) return undefined;
    return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max
        ? value
        : undefined;
}

function boundedText(value: unknown, name: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || value.length > 256) {
        throw new Error(`Query Store ${name} filters are limited to 256 characters.`);
    }
    return value.trim() || undefined;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function subtractHours(date: Date, hours: number): Date {
    return new Date(date.getTime() - hours * 60 * 60 * 1000);
}
