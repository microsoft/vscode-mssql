/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type QueryStoreEvidenceStatus = "complete" | "empty" | "partial" | "unknown";

export interface QueryStoreWindowEvidence {
    readonly status: QueryStoreEvidenceStatus;
    readonly executions: number;
    readonly observedIntervals: number;
    readonly availableIntervals?: number;
    readonly firstObservedInterval?: string;
    readonly lastObservedInterval?: string;
}

export interface QueryStorePlanEvidence {
    readonly planId: number;
    readonly executions: number;
    readonly observedIntervals: number;
    readonly firstObservedInterval?: string;
    readonly lastObservedInterval?: string;
    readonly firstCompileAt?: string;
    readonly lastCompileAt?: string;
}

export type QueryStorePlanComparisonStatus =
    | "comparable"
    | "missingMetric"
    | "insufficientEvidence";

export type QueryStoreEvidenceReason =
    | "missingBaseline"
    | "unknownEvidence"
    | "partialCoverage"
    | "insufficientExecutions"
    | "metricUnavailable"
    | "plansMissing"
    | "planExecutionsInsufficient"
    | "planMetricUnavailable";

export interface QueryStorePlanComparison {
    readonly status: QueryStorePlanComparisonStatus;
    readonly firstPlanId: number;
    readonly secondPlanId: number;
    readonly first?: QueryStorePlanEvidence;
    readonly second?: QueryStorePlanEvidence;
    readonly metricRatio?: number;
    readonly reason?: QueryStoreEvidenceReason;
}

export type QueryStoreComparisonStatus =
    | "comparable"
    | "missingBaseline"
    | "insufficientExecutions"
    | "partialCoverage"
    | "unknown";

export interface QueryStoreComparisonEvidence {
    readonly status: QueryStoreComparisonStatus;
    readonly recent: QueryStoreWindowEvidence;
    readonly baseline?: QueryStoreWindowEvidence;
    readonly ratio?: number;
    readonly reason?: QueryStoreEvidenceReason;
}

export interface QueryStoreEvidenceRow {
    readonly executions?: unknown;
    readonly available_interval_count?: unknown;
    readonly observed_interval_count?: unknown;
    readonly recent_available_interval_count?: unknown;
    readonly recent_observed_interval_count?: unknown;
    readonly baseline_available_interval_count?: unknown;
    readonly baseline_observed_interval_count?: unknown;
    readonly first_interval_start?: unknown;
    readonly last_interval_start?: unknown;
    readonly first_compile_start_time?: unknown;
    readonly last_compile_start_time?: unknown;
}

export interface QueryStoreCoverageEvidence {
    readonly observedIntervals?: number;
    readonly availableIntervals?: number;
    readonly baselineObservedIntervals?: number;
    readonly baselineAvailableIntervals?: number;
}

/** Projects interval coverage from the rows actually returned to the caller. */
export function queryStoreCoverageFromRows(
    rows: readonly QueryStoreEvidenceRow[],
): QueryStoreCoverageEvidence {
    return {
        ...optionalCoverage(rows, "observed_interval_count", "available_interval_count"),
        ...optionalCoverage(
            rows,
            "recent_observed_interval_count",
            "recent_available_interval_count",
            "observedIntervals",
            "availableIntervals",
        ),
        ...optionalCoverage(
            rows,
            "baseline_observed_interval_count",
            "baseline_available_interval_count",
            "baselineObservedIntervals",
            "baselineAvailableIntervals",
        ),
    };
}

export function queryStoreWindowEvidence(
    row: QueryStoreEvidenceRow | undefined,
    truncated = false,
): QueryStoreWindowEvidence {
    const executions = nonNegativeInteger(row?.executions);
    const observedIntervals = nonNegativeInteger(row?.observed_interval_count);
    const availableIntervals = optionalNonNegativeInteger(row?.available_interval_count);
    const status: QueryStoreEvidenceStatus = truncated
        ? "partial"
        : row === undefined
          ? "unknown"
          : availableIntervals !== undefined && observedIntervals < availableIntervals
            ? "partial"
            : observedIntervals === 0
              ? "empty"
              : "complete";

    return {
        status,
        executions,
        observedIntervals,
        ...(availableIntervals === undefined ? {} : { availableIntervals }),
        ...timestamp(row?.first_interval_start, "firstObservedInterval"),
        ...timestamp(row?.last_interval_start, "lastObservedInterval"),
    };
}

export function compareQueryStoreWindows(
    recent: QueryStoreWindowEvidence,
    baseline: QueryStoreWindowEvidence | undefined,
    recentMetric: number | undefined,
    baselineMetric: number | undefined,
    minimumExecutions: number,
): QueryStoreComparisonEvidence {
    if (baseline === undefined || baseline.status === "empty") {
        return {
            status: "missingBaseline",
            recent,
            ...(baseline === undefined ? {} : { baseline }),
            reason: "missingBaseline",
        };
    }
    if (recent.status === "unknown" || baseline.status === "unknown") {
        return {
            status: "unknown",
            recent,
            baseline,
            reason: "unknownEvidence",
        };
    }
    if (recent.status === "partial" || baseline.status === "partial") {
        return {
            status: "partialCoverage",
            recent,
            baseline,
            reason: "partialCoverage",
        };
    }
    if (recent.executions < minimumExecutions || baseline.executions < minimumExecutions) {
        return {
            status: "insufficientExecutions",
            recent,
            baseline,
            reason: "insufficientExecutions",
        };
    }
    if (
        recentMetric === undefined ||
        baselineMetric === undefined ||
        !Number.isFinite(recentMetric) ||
        !Number.isFinite(baselineMetric) ||
        baselineMetric <= 0
    ) {
        return {
            status: "unknown",
            recent,
            baseline,
            reason: "metricUnavailable",
        };
    }
    return {
        status: "comparable",
        recent,
        baseline,
        ratio: recentMetric / baselineMetric,
    };
}

/** Compares two explicitly selected plans; plan identity order is caller-selected, never inferred. */
export function compareQueryStorePlans(
    first: QueryStorePlanEvidence | undefined,
    second: QueryStorePlanEvidence | undefined,
    firstMetric: number | undefined,
    secondMetric: number | undefined,
    minimumExecutions: number,
): QueryStorePlanComparison {
    const firstPlanId = first?.planId ?? 0;
    const secondPlanId = second?.planId ?? 0;
    if (first === undefined || second === undefined) {
        return {
            status: "insufficientEvidence",
            firstPlanId,
            secondPlanId,
            ...(first === undefined ? {} : { first }),
            ...(second === undefined ? {} : { second }),
            reason: "plansMissing",
        };
    }
    if (first.executions < minimumExecutions || second.executions < minimumExecutions) {
        return {
            status: "insufficientEvidence",
            firstPlanId,
            secondPlanId,
            first,
            second,
            reason: "planExecutionsInsufficient",
        };
    }
    if (
        firstMetric === undefined ||
        secondMetric === undefined ||
        !Number.isFinite(firstMetric) ||
        !Number.isFinite(secondMetric) ||
        secondMetric <= 0
    ) {
        return {
            status: "missingMetric",
            firstPlanId,
            secondPlanId,
            first,
            second,
            reason: "planMetricUnavailable",
        };
    }
    return {
        status: "comparable",
        firstPlanId,
        secondPlanId,
        first,
        second,
        metricRatio: firstMetric / secondMetric,
    };
}

function nonNegativeInteger(value: unknown): number {
    return optionalNonNegativeInteger(value) ?? 0;
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function timestamp(
    value: unknown,
    key: "firstObservedInterval" | "lastObservedInterval",
): Partial<Record<"firstObservedInterval" | "lastObservedInterval", string>> {
    return typeof value === "string" && !Number.isNaN(new Date(value).getTime())
        ? { [key]: new Date(value).toISOString() }
        : {};
}

function optionalCoverage(
    rows: readonly QueryStoreEvidenceRow[],
    observedKey: string,
    availableKey: string,
    observedOutput = "observedIntervals",
    availableOutput = "availableIntervals",
): Partial<QueryStoreCoverageEvidence> {
    const observed = maximumInteger(
        rows.map((row) => row[observedKey as keyof QueryStoreEvidenceRow]),
    );
    const available = maximumInteger(
        rows.map((row) => row[availableKey as keyof QueryStoreEvidenceRow]),
    );
    return {
        ...(observed === undefined ? {} : { [observedOutput]: observed }),
        ...(available === undefined ? {} : { [availableOutput]: available }),
    } as Partial<QueryStoreCoverageEvidence>;
}

function maximumInteger(values: readonly unknown[]): number | undefined {
    const numbers = values
        .map((value) => optionalNonNegativeInteger(value))
        .filter((value): value is number => value !== undefined);
    return numbers.length === 0 ? undefined : Math.max(...numbers);
}
