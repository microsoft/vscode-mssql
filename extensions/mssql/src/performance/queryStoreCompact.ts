/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    PlanSummary,
    QueryAnalysis,
    QueryStoreInterval,
    QueryStorePlan,
    QueryStoreQuery,
    QueryStoreRuntimeStats,
    QueryStoreWaitStats,
} from "sql-core/queryStore";

/*
 * Compact forms of Query Store data for a language model: rounded numbers, shortened text, and no
 * empty fields, so a result spends few tokens. Times stay in milliseconds and sizes in KB.
 */

/** The query text in a list of queries. */
export const listQueryTextLength = 1000;
/** The query text of one query. */
export const detailQueryTextLength = 20_000;

/** Rounds to two decimals. */
export function round(value: number): number {
    return Math.round(value * 100) / 100;
}

/** The execution count and the rounded statistics of each metric. */
export function compactStats(stats: QueryStoreRuntimeStats) {
    return {
        executionCount: stats.executionCount,
        metrics: Object.fromEntries(
            Object.entries(stats.metrics).map(([metric, values]) => [
                metric,
                {
                    total: round(values.total),
                    avg: round(values.avg),
                    min: round(values.min),
                    max: round(values.max),
                    stdev: round(values.stdev),
                },
            ]),
        ),
    };
}

function cutText(text: string, length: number): { queryText: string; queryTextTruncated?: true } {
    return text.length > length
        ? { queryText: text.slice(0, length), queryTextTruncated: true }
        : { queryText: text };
}

export function compactQuery(query: QueryStoreQuery, textLength: number) {
    return {
        queryId: query.queryId,
        ...cutText(query.queryText, textLength),
        objectName: query.objectName,
        ...(query.readsOnlySystemCatalog ? { readsOnlySystemCatalog: true } : {}),
        planCount: query.planCount,
        lastExecutionTimeUtc: query.lastExecutionTimeUtc,
        ...compactStats(query),
    };
}

export function compactPlan(plan: QueryStorePlan) {
    return {
        planId: plan.planId,
        isForced: plan.isForced,
        forcingType: plan.forcingType,
        planType: plan.planType,
        forceFailureCount: plan.forceFailureCount || undefined,
        lastForceFailureReason: plan.lastForceFailureReason,
        isParallel: plan.isParallel,
        compileCount: plan.compileCount,
        lastExecutionTimeUtc: plan.lastExecutionTimeUtc,
        ...compactStats(plan),
    };
}

export function compactInterval(interval: QueryStoreInterval) {
    return {
        startUtc: interval.startUtc,
        endUtc: interval.endUtc,
        ...compactStats(interval),
        plans: interval.plans.map((plan) => ({ planId: plan.planId, ...compactStats(plan) })),
    };
}

export function compactWaits(waits: QueryStoreWaitStats) {
    return {
        captureMode: waits.captureMode,
        executionCount: waits.executionCount,
        durationTotalMs: round(waits.durationTotalMs),
        totalWaitMs: round(waits.totalWaitMs),
        categories: waits.categories.map((category) => ({
            category: category.category,
            totalMs: round(category.totalMs),
            avgMsPerExecution:
                category.avgMsPerExecution === undefined
                    ? undefined
                    : round(category.avgMsPerExecution),
            maxMs: round(category.maxMs),
            share: round(category.share),
        })),
    };
}

/** A plan summary with rounded costs. */
export function compactPlanSummary(summary: PlanSummary) {
    return {
        ...summary,
        statements: summary.statements.map((statement) => ({
            ...statement,
            estimatedCost:
                statement.estimatedCost === undefined ? undefined : round(statement.estimatedCost),
            topOperators: statement.topOperators.map((operator) => ({
                ...operator,
                selfCost: round(operator.selfCost),
                costShare: round(operator.costShare),
            })),
        })),
    };
}

export function compactAnalysis(analysis: QueryAnalysis) {
    return {
        startUtc: analysis.startUtc,
        endUtc: analysis.endUtc,
        query: {
            ...compactQuery(analysis.query, detailQueryTextLength),
            totalPlanCount: analysis.query.totalPlanCount,
            forcedPlanId: analysis.query.forcedPlanId,
        },
        plans: analysis.plans.map(compactPlan),
        history: analysis.history.map(compactInterval),
        waits: analysis.waits ? compactWaits(analysis.waits) : undefined,
        planSummaries: analysis.planSummaries.map((plan) => ({
            planId: plan.planId,
            summary: compactPlanSummary(plan.summary),
        })),
    };
}
