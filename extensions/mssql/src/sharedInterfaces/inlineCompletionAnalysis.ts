/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InlineCompletionDebugEvent } from "./inlineCompletionDebug";

export type InlineCompletionAnalysisResult =
    | "accepted"
    | "cancelled"
    | "rejected"
    | "skipped"
    | "error"
    | "unknown";

export type InlineCompletionAnalysisDimension =
    | "model"
    | "profile"
    | "schemaMode"
    | "schemaSizeKind"
    | "intentMode"
    | "result"
    | "trigger"
    | "language"
    | "inferredSystemQuery"
    | "completionCategory"
    | "replayTrace"
    | "replayRun"
    | "replayMatrixCell"
    | "replaySourceEvent";

export interface InlineCompletionAnalysisFilters {
    models?: string[];
    profiles?: string[];
    schemaModes?: string[];
    schemaSizeKinds?: string[];
    intentModes?: boolean[];
    results?: InlineCompletionAnalysisResult[];
    triggers?: string[];
    dateRange?: {
        start?: number;
        end?: number;
    };
    latencyRange?: {
        min?: number;
        max?: number;
    };
    languages?: string[];
    inferredSystemQuery?: boolean[];
    replayTraces?: string[];
    replayRuns?: string[];
    replayMatrixCells?: string[];
    replaySourceEvents?: string[];
}

export interface InlineCompletionAnalysisMetrics {
    count: number;
    latencyMean: number;
    latencyMedian: number;
    latencyP50: number;
    latencyP95: number;
    latencyP99: number;
    latencyMin: number;
    latencyMax: number;
    inputTokensMean: number;
    inputTokensMedian: number;
    inputTokensSum: number;
    outputTokensMean: number;
    outputTokensMedian: number;
    outputTokensSum: number;
    acceptRate: number;
    cancelRate: number;
    rejectRate: number;
    skipRate: number;
    errorRate: number;
    acceptedCount: number;
    cancelledCount: number;
    rejectedCount: number;
    skippedCount: number;
    errorCount: number;
    unknownCount: number;
    meanCompletionLength: number;
    meanSchemaContextChars: number;
    meanSchemaObjectCount: number;
}

export interface InlineCompletionPivotRow {
    key: string;
    label: string;
    dimension: InlineCompletionAnalysisDimension;
    metrics: InlineCompletionAnalysisMetrics;
    events: InlineCompletionDebugEvent[];
    children?: InlineCompletionPivotRow[];
}

export function filterInlineCompletionEvents(
    events: InlineCompletionDebugEvent[],
    filters: InlineCompletionAnalysisFilters,
): InlineCompletionDebugEvent[] {
    return events.filter((event) => {
        if (filters.models?.length && !filters.models.includes(getEventDimension(event, "model"))) {
            return false;
        }
        if (
            filters.profiles?.length &&
            !filters.profiles.includes(getEventDimension(event, "profile"))
        ) {
            return false;
        }
        if (
            filters.schemaModes?.length &&
            !filters.schemaModes.includes(getEventDimension(event, "schemaMode"))
        ) {
            return false;
        }
        if (
            filters.schemaSizeKinds?.length &&
            !filters.schemaSizeKinds.includes(getEventDimension(event, "schemaSizeKind"))
        ) {
            return false;
        }
        if (filters.intentModes?.length && !filters.intentModes.includes(event.intentMode)) {
            return false;
        }
        if (filters.results?.length && !filters.results.includes(getAnalysisResult(event.result))) {
            return false;
        }
        if (
            filters.triggers?.length &&
            !filters.triggers.includes(getEventDimension(event, "trigger"))
        ) {
            return false;
        }
        if (
            filters.languages?.length &&
            !filters.languages.includes(getEventDimension(event, "language"))
        ) {
            return false;
        }
        if (
            filters.inferredSystemQuery?.length &&
            !filters.inferredSystemQuery.includes(event.inferredSystemQuery)
        ) {
            return false;
        }
        if (
            filters.replayTraces?.length &&
            !filters.replayTraces.includes(getEventDimension(event, "replayTrace"))
        ) {
            return false;
        }
        if (
            filters.replayRuns?.length &&
            !filters.replayRuns.includes(getEventDimension(event, "replayRun"))
        ) {
            return false;
        }
        if (
            filters.replayMatrixCells?.length &&
            !filters.replayMatrixCells.includes(getEventDimension(event, "replayMatrixCell"))
        ) {
            return false;
        }
        if (
            filters.replaySourceEvents?.length &&
            !filters.replaySourceEvents.includes(getEventDimension(event, "replaySourceEvent"))
        ) {
            return false;
        }
        if (filters.dateRange?.start !== undefined && event.timestamp < filters.dateRange.start) {
            return false;
        }
        if (filters.dateRange?.end !== undefined && event.timestamp > filters.dateRange.end) {
            return false;
        }
        if (filters.latencyRange?.min !== undefined && event.latencyMs < filters.latencyRange.min) {
            return false;
        }
        if (filters.latencyRange?.max !== undefined && event.latencyMs > filters.latencyRange.max) {
            return false;
        }
        return true;
    });
}

export function groupInlineCompletionEvents(
    events: InlineCompletionDebugEvent[],
    dimension: InlineCompletionAnalysisDimension,
): Map<string, InlineCompletionDebugEvent[]> {
    const groups = new Map<string, InlineCompletionDebugEvent[]>();
    for (const event of events) {
        const key = getEventDimension(event, dimension);
        const group = groups.get(key);
        if (group) {
            group.push(event);
        } else {
            groups.set(key, [event]);
        }
    }
    return groups;
}

export function pivotInlineCompletionEvents(
    events: InlineCompletionDebugEvent[],
    dimension: InlineCompletionAnalysisDimension,
    secondaryDimension?: InlineCompletionAnalysisDimension,
): InlineCompletionPivotRow[] {
    return Array.from(groupInlineCompletionEvents(events, dimension), ([key, groupedEvents]) => ({
        key,
        label: key,
        dimension,
        metrics: computeInlineCompletionMetrics(groupedEvents),
        events: groupedEvents,
        children: secondaryDimension
            ? pivotInlineCompletionEvents(groupedEvents, secondaryDimension)
            : undefined,
    })).sort(
        (left, right) =>
            right.metrics.count - left.metrics.count || left.label.localeCompare(right.label),
    );
}

export function computeInlineCompletionMetrics(
    events: InlineCompletionDebugEvent[],
): InlineCompletionAnalysisMetrics {
    const latencies = events
        .map((event) => event.latencyMs)
        .filter(isFiniteNumber)
        .sort(compareNumber);
    const inputTokens = events
        .map((event) => event.inputTokens)
        .filter(isFiniteNumber)
        .sort(compareNumber);
    const outputTokens = events
        .map((event) => event.outputTokens)
        .filter(isFiniteNumber)
        .sort(compareNumber);
    const resultCounts = countResults(events);
    const completionLengths = events
        .map((event) => (event.finalCompletionText ?? event.sanitizedResponse ?? "").length)
        .filter(isFiniteNumber);
    const schemaContextLengths = events
        .map((event) => event.schemaContextFormatted?.length ?? 0)
        .filter(isFiniteNumber);
    const schemaObjectCounts = events
        .map((event) => event.schemaObjectCount)
        .filter(isFiniteNumber);
    const denominator = events.length || 1;

    // Acceptance rates use every trace event in the group as the denominator. A successful
    // model response that never receives an accept notification remains "rejected" here; explicit
    // cancellations and model errors are still visible as separate rates.
    return {
        count: events.length,
        latencyMean: mean(latencies),
        latencyMedian: percentile(latencies, 50),
        latencyP50: percentile(latencies, 50),
        latencyP95: percentile(latencies, 95),
        latencyP99: percentile(latencies, 99),
        latencyMin: latencies[0] ?? 0,
        latencyMax: latencies[latencies.length - 1] ?? 0,
        inputTokensMean: mean(inputTokens),
        inputTokensMedian: percentile(inputTokens, 50),
        inputTokensSum: sum(inputTokens),
        outputTokensMean: mean(outputTokens),
        outputTokensMedian: percentile(outputTokens, 50),
        outputTokensSum: sum(outputTokens),
        acceptRate: resultCounts.accepted / denominator,
        cancelRate: resultCounts.cancelled / denominator,
        rejectRate: resultCounts.rejected / denominator,
        skipRate: resultCounts.skipped / denominator,
        errorRate: resultCounts.error / denominator,
        acceptedCount: resultCounts.accepted,
        cancelledCount: resultCounts.cancelled,
        rejectedCount: resultCounts.rejected,
        skippedCount: resultCounts.skipped,
        errorCount: resultCounts.error,
        unknownCount: resultCounts.unknown,
        meanCompletionLength: mean(completionLengths),
        meanSchemaContextChars: mean(schemaContextLengths),
        meanSchemaObjectCount: mean(schemaObjectCounts),
    };
}

export function getEventDimension(
    event: InlineCompletionDebugEvent,
    dimension: InlineCompletionAnalysisDimension,
): string {
    switch (dimension) {
        case "model":
            return getEventModelLabel(event);
        case "profile":
            return (
                event.overridesApplied.profileId ?? asString(event.locals.profileId) ?? "default"
            );
        case "schemaMode":
            return inferSchemaMode(event);
        case "schemaSizeKind":
            return asString(event.locals.schemaSizeKind) ?? "unknown";
        case "intentMode":
            return event.intentMode ? "on" : "off";
        case "result":
            return getAnalysisResult(event.result);
        case "trigger":
            return event.triggerKind === "invoke" || event.explicitFromUser
                ? "manual"
                : "automatic";
        case "language":
            return asString(event.locals["document.languageId"]) ?? "unknown";
        case "inferredSystemQuery":
            return event.inferredSystemQuery ? "yes" : "no";
        case "completionCategory":
            return event.completionCategory ?? (event.intentMode ? "intent" : "continuation");
        case "replayTrace":
            return getEventTag(event, "replayTraceId") ?? "none";
        case "replayRun":
            return getEventTag(event, "replayRunId") ?? "none";
        case "replayMatrixCell":
            return (
                asString(event.locals.replayMatrixCellLabel) ??
                getEventTag(event, "replayMatrixCellId") ??
                "none"
            );
        case "replaySourceEvent":
            return getEventTag(event, "replaySourceEventId") ?? "none";
    }
}

export function getEventModelLabel(event: InlineCompletionDebugEvent): string {
    const recordedModel = asModelIdentifier(event.modelId) ?? asModelIdentifier(event.modelFamily);
    if (recordedModel) {
        return recordedModel;
    }

    const selector =
        event.completionCategory === "continuation"
            ? (event.overridesApplied?.continuationModelSelector ??
              event.overridesApplied?.modelSelector)
            : event.overridesApplied?.modelSelector;
    const selectorModel = getModelIdFromSelector(selector);
    if (selectorModel) {
        return selectorModel;
    }

    return (
        asModelIdentifier(asString(event.locals.selectedModelName)) ??
        asModelIdentifier(event.modelVendor) ??
        "unknown"
    );
}

export function getAnalysisResult(result: string | undefined): InlineCompletionAnalysisResult {
    switch (result) {
        case "accepted":
            return "accepted";
        case "cancelled":
            return "cancelled";
        case "success":
        case "emptyFromModel":
        case "emptyFromSanitizer":
            return "rejected";
        case "skipped":
            return "skipped";
        case "error":
        case "noModel":
        case "noPermission":
            return "error";
        default:
            return "unknown";
    }
}

export function createFacetCounts(
    events: InlineCompletionDebugEvent[],
    dimension: InlineCompletionAnalysisDimension,
): Array<{ value: string; count: number }> {
    return Array.from(groupInlineCompletionEvents(events, dimension), ([value, groupedEvents]) => ({
        value,
        count: groupedEvents.length,
    })).sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

function countResults(events: InlineCompletionDebugEvent[]) {
    const counts: Record<InlineCompletionAnalysisResult, number> = {
        accepted: 0,
        cancelled: 0,
        rejected: 0,
        skipped: 0,
        error: 0,
        unknown: 0,
    };
    for (const event of events) {
        counts[getAnalysisResult(event.result)]++;
    }
    return counts;
}

function inferSchemaMode(event: InlineCompletionDebugEvent): string {
    const overrideProfile = event.overridesApplied.schemaContext?.budgetProfile;
    if (overrideProfile) {
        return overrideProfile;
    }

    const formattedProfile = event.schemaContextFormatted?.match(
        /schema\s+budget:\s+profile\s+([a-z-]+)/i,
    );
    return formattedProfile?.[1] ?? asString(event.locals.schemaBudgetProfile) ?? "unknown";
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) {
        return 0;
    }

    const index = Math.min(values.length - 1, Math.ceil((p / 100) * values.length) - 1);
    return values[index] ?? 0;
}

function mean(values: number[]): number {
    return values.length === 0 ? 0 : sum(values) / values.length;
}

function sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

function compareNumber(left: number, right: number): number {
    return left - right;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function asString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asModelIdentifier(value: unknown): string | undefined {
    const text = asString(value)?.trim();
    return text && text.toLowerCase() !== "default" ? text : undefined;
}

function getModelIdFromSelector(selector: unknown): string | undefined {
    const text = asModelIdentifier(selector);
    if (!text) {
        return undefined;
    }

    const parts = text.split("/").filter(Boolean);
    return asModelIdentifier(parts[parts.length - 1]) ?? text;
}

function getEventTag(event: InlineCompletionDebugEvent, key: string): string | undefined {
    return event.tags?.[key] ?? asString(event.locals[key]);
}
