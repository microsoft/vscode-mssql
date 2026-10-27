/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlReader } from "../common/sqlReader";
import { QueryStoreCapabilities } from "./capabilities";
import { queryStoreMetrics } from "./metrics";
import { PlanSummary, summarizePlan } from "./planSummary";
import { QueryStorePlan, getPlanXml, getQueryPlans } from "./plans";
import { QueryStoreQueryDetails, getQueryDetails } from "./queries";
import { QueryStoreInterval, getQueryHistory, historyBucketMinutes } from "./runtimeStats";
import { QueryStoreReadOptions, QueryStoreResult, TimeWindow } from "./state";
import { QueryStoreWaitStats, getWaitStats } from "./waitStats";

export interface QueryAnalysisRequest extends TimeWindow {
    /** The Query Store `query_id`. A `bigint`. */
    readonly queryId: string;
    /** Plans to summarize first, for example the plans that the user selected. */
    readonly planIds?: readonly string[];
    /** The plans to summarize. Default 2: the selected plans, then the longest running. */
    readonly maxPlanSummaries?: number;
    /** The rows of the history and the wait buckets. Default 48. */
    readonly maxBuckets?: number;
}

export interface QueryAnalysisPlanSummary {
    readonly planId: string;
    readonly summary: PlanSummary;
}

/**
 * The facts that explain a query's performance in a window, in one object: the query, its plans,
 * its history and waits by time, and summaries of its main plans. Every metric that the server
 * records is read. Times in milliseconds, sizes in KB.
 */
export interface QueryAnalysis {
    readonly startUtc: string;
    readonly endUtc: string;
    readonly query: QueryStoreQueryDetails;
    readonly plans: readonly QueryStorePlan[];
    readonly history: readonly QueryStoreInterval[];
    /** Absent when the server has no wait statistics in Query Store. */
    readonly waits?: QueryStoreWaitStats;
    readonly planSummaries: readonly QueryAnalysisPlanSummary[];
}

/**
 * Reads a {@link QueryAnalysis}. `noData` when Query Store does not have the query. Each part
 * after the query is optional: a part that cannot be read is left out, not an error.
 */
export async function buildQueryAnalysis(
    reader: SqlReader,
    capabilities: QueryStoreCapabilities,
    request: QueryAnalysisRequest,
    options?: QueryStoreReadOptions,
): Promise<QueryStoreResult<QueryAnalysis>> {
    const window = { start: request.start, end: request.end };
    const base = { ...window, queryId: request.queryId, metrics: queryStoreMetrics };
    const details = await getQueryDetails(reader, capabilities, base, options);
    if (!details.data) {
        return { ...details, data: undefined };
    }
    const bucketMinutes = historyBucketMinutes(window, request.maxBuckets ?? 48);
    const plans = (await getQueryPlans(reader, capabilities, base, options)).data ?? [];
    const history =
        (await getQueryHistory(reader, capabilities, { ...base, bucketMinutes }, options)).data ??
        [];
    const waits = await getWaitStats(
        reader,
        capabilities,
        { ...window, queryId: request.queryId, bucketMinutes },
        options,
    );
    const planSummaries: QueryAnalysisPlanSummary[] = [];
    for (const planId of plansToSummarize(plans, request)) {
        const planXml = (await getPlanXml(reader, capabilities, planId, options)).data;
        const summary = planXml ? summarizePlan(planXml) : undefined;
        if (summary) {
            planSummaries.push({ planId, summary });
        }
    }
    return {
        ...details,
        data: {
            startUtc: request.start.toISOString(),
            endUtc: request.end.toISOString(),
            query: details.data,
            plans,
            history,
            ...(waits.data ? { waits: waits.data } : {}),
            planSummaries,
        },
    };
}

/** The selected plans, then the plans with the most total duration in the window. */
function plansToSummarize(
    plans: readonly QueryStorePlan[],
    request: QueryAnalysisRequest,
): string[] {
    const known = new Set(plans.map((plan) => plan.planId));
    const selected = (request.planIds ?? []).filter((planId) => known.has(planId));
    const byDuration = [...plans]
        .filter((plan) => plan.executionCount > 0)
        .sort(
            (left, right) =>
                (right.metrics.duration?.total ?? 0) - (left.metrics.duration?.total ?? 0),
        )
        .map((plan) => plan.planId);
    return [...new Set([...selected, ...byDuration])].slice(0, request.maxPlanSummaries ?? 2);
}
