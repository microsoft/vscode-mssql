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

// ---------------------------------------------------------------------------
// Provenance cohorts (addendum §8.1 / WI-4.1 — NORMATIVE)
//
// Every event belongs to exactly one cohort. Default quality views EXCLUDE
// replay and fixtures; replay analysis starts from a run or an explicit
// replay filter. The union is typed fully; only the cohorts that exist today
// (liveUser, interactiveReplay, externalImport) are ever derived — harness
// and fixture events arrive later with an explicit stamp.
// ---------------------------------------------------------------------------

export const inlineCompletionProvenanceCohorts = [
    "liveUser",
    "interactiveReplay",
    "controlledHarness",
    "externalImport",
    "generatedFixture",
] as const;

export type InlineCompletionProvenanceCohort = (typeof inlineCompletionProvenanceCohorts)[number];

/**
 * Derive an event's provenance cohort:
 * 1. an explicit cohort stamp (tags/locals) wins — future harness/fixture
 *    emitters use this;
 * 2. replay evidence (WI-3.4 provenance block or any replay tag) →
 *    `interactiveReplay`;
 * 3. a trace-entry `sourceKind: "imported"` stamp (applied by the dataset
 *    assembly) → `externalImport`;
 * 4. else `liveUser`.
 */
export function getEventProvenanceCohort(
    event: InlineCompletionDebugEvent,
): InlineCompletionProvenanceCohort {
    const stamped = getEventTag(event, "provenanceCohort");
    if (
        stamped !== undefined &&
        (inlineCompletionProvenanceCohorts as readonly string[]).includes(stamped)
    ) {
        return stamped as InlineCompletionProvenanceCohort;
    }
    if (
        event.replayProvenance !== undefined ||
        getEventTag(event, "replayRunId") !== undefined ||
        getEventTag(event, "replayTraceId") !== undefined ||
        getEventTag(event, "replaySourceEventId") !== undefined ||
        getEventTag(event, "replayMatrixCellId") !== undefined ||
        asString(event.locals.replayMode) !== undefined
    ) {
        return "interactiveReplay";
    }
    if (asString(event.locals.traceSourceKind) === "imported") {
        return "externalImport";
    }
    return "liveUser";
}

/**
 * The compact cohort selector vocabulary (Sessions filter rail). "live" is
 * the DEFAULT view: liveUser ONLY — replay results are never counted as user
 * acceptance (§2.2.6) by construction, and imports/fixtures never pollute
 * live quality rates.
 */
export type InlineCompletionCohortSelection = "live" | "replay" | "all";

export const inlineCompletionCohortSelectionOptions: ReadonlyArray<{
    id: InlineCompletionCohortSelection;
    label: string;
    description: string;
}> = [
    {
        id: "live",
        label: "Live",
        description:
            "liveUser cohort only — replay, imports, harness and fixture events excluded (default quality view, §8.1).",
    },
    {
        id: "replay",
        label: "Replay",
        description:
            "interactiveReplay cohort only — replayed executions; outputs are exploratory and never user acceptance.",
    },
    {
        id: "all",
        label: "All",
        description:
            "Every cohort together — mixed provenance; quality rates are not comparable across cohorts.",
    },
];

export function filterInlineCompletionEventsByCohort(
    events: InlineCompletionDebugEvent[],
    selection: InlineCompletionCohortSelection,
): InlineCompletionDebugEvent[] {
    if (selection === "all") {
        return events;
    }
    const wanted: InlineCompletionProvenanceCohort =
        selection === "live" ? "liveUser" : "interactiveReplay";
    return events.filter((event) => getEventProvenanceCohort(event) === wanted);
}

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
    | "replaySourceEvent"
    /** WI-3.4: the explicit replay mode from event provenance; "n/a" for live events. */
    | "replayMode"
    /** WI-4.1: the §8.1 provenance cohort (liveUser | interactiveReplay | ...). */
    | "provenanceCohort";

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
    replayModes?: string[];
    provenanceCohorts?: string[];
}

export interface InlineCompletionAnalysisMetrics {
    /** Every event in the group, including non-terminal records. */
    count: number;
    /**
     * §8.2 base population: terminal requests only. Pending, queued and
     * blocked records NEVER enter terminal denominators.
     */
    terminalCount: number;
    /** pending | queued | blocked records (excluded from every rate). */
    nonTerminalCount: number;
    /** Suggestions actually shown: result success | accepted. */
    shownCount: number;
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
        if (
            filters.replayModes?.length &&
            !filters.replayModes.includes(getEventDimension(event, "replayMode"))
        ) {
            return false;
        }
        if (
            filters.provenanceCohorts?.length &&
            !filters.provenanceCohorts.includes(getEventDimension(event, "provenanceCohort"))
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
    const populations = countResultPopulations(events);

    // §8.2 corrected denominators (WI-4.1). The old implementation divided
    // every rate by every event in the group; the corrected populations are:
    // - acceptance = accepted / shown (shown = success | accepted — the
    //   suggestions a user could actually evaluate);
    // - cancellation = cancelled / started (terminal minus skipped);
    // - skip / error rates = count / terminal requests;
    // - pending, queued and blocked records never enter any denominator.
    return {
        count: events.length,
        terminalCount: populations.terminal,
        nonTerminalCount: events.length - populations.terminal,
        shownCount: populations.shown,
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
        acceptRate: safeRate(resultCounts.accepted, populations.shown),
        cancelRate: safeRate(resultCounts.cancelled, populations.started),
        rejectRate: safeRate(resultCounts.rejected, populations.terminal),
        skipRate: safeRate(resultCounts.skipped, populations.terminal),
        errorRate: safeRate(resultCounts.error, populations.terminal),
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

// ---------------------------------------------------------------------------
// §8.2 corrected metric table (WI-4.1 — NORMATIVE)
// ---------------------------------------------------------------------------

/**
 * Result-population membership for one raw terminal result (§8.2). Pending,
 * queued and blocked records are non-terminal: nothing settled (blocked =
 * a replay item refused before execution), so they belong to NO population.
 */
export interface InlineCompletionResultPopulations {
    /** The request settled (any §8.2 terminal outcome). */
    terminal: boolean;
    /** The request proceeded past the skip gate (terminal minus skipped). */
    started: boolean;
    /** A model call actually happened (excludes noModel/noPermission; a
     *  cancelled request may or may not have reached the model — counted in
     *  `started` but conservatively NOT in `modelCalled`). */
    modelCalled: boolean;
    /** A nonempty suggestion was shown (success | accepted). */
    shown: boolean;
    /** The raw model response was nonempty (shown + emptyFromSanitizer). */
    rawNonempty: boolean;
}

export function classifyInlineCompletionResult(
    result: string | undefined,
): InlineCompletionResultPopulations {
    switch (result) {
        case "success":
        case "accepted":
            return {
                terminal: true,
                started: true,
                modelCalled: true,
                shown: true,
                rawNonempty: true,
            };
        case "emptyFromModel":
            return {
                terminal: true,
                started: true,
                modelCalled: true,
                shown: false,
                rawNonempty: false,
            };
        case "emptyFromSanitizer":
            return {
                terminal: true,
                started: true,
                modelCalled: true,
                shown: false,
                rawNonempty: true,
            };
        case "error":
            return {
                terminal: true,
                started: true,
                modelCalled: true,
                shown: false,
                rawNonempty: false,
            };
        case "noModel":
        case "noPermission":
            return {
                terminal: true,
                started: true,
                modelCalled: false,
                shown: false,
                rawNonempty: false,
            };
        case "cancelled":
            return {
                terminal: true,
                started: true,
                modelCalled: false,
                shown: false,
                rawNonempty: false,
            };
        case "skipped":
            return {
                terminal: true,
                started: false,
                modelCalled: false,
                shown: false,
                rawNonempty: false,
            };
        default:
            // pending | queued | blocked | unknown future values
            return {
                terminal: false,
                started: false,
                modelCalled: false,
                shown: false,
                rawNonempty: false,
            };
    }
}

export type InlineCompletionRateMetricId =
    | "requestErrorRate"
    | "skipRate"
    | "modelCallRate"
    | "suggestionYieldRate"
    | "acceptanceRate"
    | "cancellationRate"
    | "sanitizerEmptyRate"
    | "unavailableRate"
    | "replayProductionRate"
    | "replayManualPreference";

/**
 * One §8.2 metric with its honest numerator/denominator. `rate` is undefined
 * when the denominator is empty — never fabricated as 0.
 */
export interface InlineCompletionRateMetric {
    id: InlineCompletionRateMetricId;
    label: string;
    numerator: number;
    denominator: number;
    rate: number | undefined;
    numeratorLabel: string;
    denominatorLabel: string;
}

/**
 * Compute the full §8.2 metric table over a set of events. The caller owns
 * the cohort: the default Sessions view passes the liveUser cohort, so the
 * acceptance metric excludes interactiveReplay BY CONSTRUCTION (§2.2.6). The
 * two replay metrics are computed over the interactiveReplay subset of the
 * given events (they read as 0/0 → undefined in a pure live view — honest).
 */
export function computeInlineCompletionRateMetrics(
    events: InlineCompletionDebugEvent[],
): InlineCompletionRateMetric[] {
    let terminal = 0;
    let started = 0;
    let modelCalled = 0;
    let shown = 0;
    let rawNonempty = 0;
    let accepted = 0;
    let cancelled = 0;
    let skipped = 0;
    let errors = 0;
    let sanitizerEmpty = 0;
    let unavailable = 0;
    let replayProduced = 0;
    let replayCompleted = 0;
    for (const event of events) {
        const populations = classifyInlineCompletionResult(event.result);
        if (populations.terminal) terminal++;
        if (populations.started) started++;
        if (populations.modelCalled) modelCalled++;
        if (populations.shown) shown++;
        if (populations.rawNonempty) rawNonempty++;
        switch (event.result) {
            case "accepted":
                accepted++;
                break;
            case "cancelled":
                cancelled++;
                break;
            case "skipped":
                skipped++;
                break;
            case "error":
                errors++;
                break;
            case "emptyFromSanitizer":
                sanitizerEmpty++;
                break;
            case "noModel":
            case "noPermission":
                unavailable++;
                break;
        }
        if (getEventProvenanceCohort(event) === "interactiveReplay") {
            // "Completed" replay execution = the model call settled
            // (success/accepted/empty results); failed/cancelled/blocked
            // items do not fabricate the production denominator.
            if (
                event.result === "success" ||
                event.result === "accepted" ||
                event.result === "emptyFromModel" ||
                event.result === "emptyFromSanitizer"
            ) {
                replayCompleted++;
                if (populations.shown) {
                    replayProduced++;
                }
            }
        }
    }
    const metric = (
        id: InlineCompletionRateMetricId,
        label: string,
        numerator: number,
        denominator: number,
        numeratorLabel: string,
        denominatorLabel: string,
    ): InlineCompletionRateMetric => ({
        id,
        label,
        numerator,
        denominator,
        rate: denominator > 0 ? numerator / denominator : undefined,
        numeratorLabel,
        denominatorLabel,
    });
    return [
        metric(
            "requestErrorRate",
            "Error rate",
            errors,
            terminal,
            "error terminals",
            "all terminal requests",
        ),
        metric(
            "skipRate",
            "Skip rate",
            skipped,
            terminal,
            "skipped terminals",
            "all terminal requests",
        ),
        metric(
            "modelCallRate",
            "Model-call rate",
            modelCalled,
            started,
            "requests that called a model",
            "eligible (non-skipped) terminal requests",
        ),
        metric(
            "suggestionYieldRate",
            "Yield rate",
            shown,
            modelCalled,
            "nonempty suggestions shown",
            "model calls",
        ),
        metric(
            "acceptanceRate",
            "Accept rate",
            accepted,
            shown,
            "accepted suggestions",
            "accepted + shown-not-accepted suggestions",
        ),
        metric(
            "cancellationRate",
            "Cancel rate",
            cancelled,
            started,
            "cancelled requests",
            "started requests",
        ),
        metric(
            "sanitizerEmptyRate",
            "Sanitizer-empty rate",
            sanitizerEmpty,
            rawNonempty,
            "empty after sanitizer",
            "nonempty raw model responses",
        ),
        metric(
            "unavailableRate",
            "Unavailable rate",
            unavailable,
            terminal,
            "noModel + noPermission outcomes",
            "all terminal requests",
        ),
        metric(
            "replayProductionRate",
            "Replay production",
            replayProduced,
            replayCompleted,
            "replay items producing output",
            "completed replay items (interactiveReplay cohort)",
        ),
        // Placeholder: manual replay evaluation does not exist yet — 0/0
        // stays honestly undefined until explicitly rated pairs arrive.
        metric(
            "replayManualPreference",
            "Replay manual preference",
            0,
            0,
            "preferred replay outputs",
            "explicitly evaluated replay pairs (none yet — placeholder)",
        ),
    ];
}

function safeRate(numerator: number, denominator: number): number {
    return denominator > 0 ? numerator / denominator : 0;
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
        case "replayMode":
            // Provenance is authoritative (WI-3.4); the locals value covers
            // replays recorded between the locals and provenance fields
            // landing. Live (non-replay) events are honestly "n/a".
            return event.replayProvenance?.mode ?? asString(event.locals.replayMode) ?? "n/a";
        case "provenanceCohort":
            return getEventProvenanceCohort(event);
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

function countResultPopulations(events: InlineCompletionDebugEvent[]): {
    terminal: number;
    started: number;
    shown: number;
} {
    let terminal = 0;
    let started = 0;
    let shown = 0;
    for (const event of events) {
        const populations = classifyInlineCompletionResult(event.result);
        if (populations.terminal) terminal++;
        if (populations.started) started++;
        if (populations.shown) shown++;
    }
    return { terminal, started, shown };
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

// ---------------------------------------------------------------------------
// Distribution primitives — exported (WI-4.3): the Replay Lab paired analysis
// (inlineCompletionReplayAnalysis.ts) is the second real consumer of these
// helpers, so they graduate to module exports. Deliberately NOT an
// `analysisKit/` directory: both consumers are completions-owned modules and
// no second FEATURE provider needs them yet (§8.4 restraint).
// ---------------------------------------------------------------------------

/** Nearest-rank percentile over a PRE-SORTED ascending array (0 when empty). */
export function percentile(values: number[], p: number): number {
    if (values.length === 0) {
        return 0;
    }

    const index = Math.min(values.length - 1, Math.ceil((p / 100) * values.length) - 1);
    return values[index] ?? 0;
}

export function mean(values: number[]): number {
    return values.length === 0 ? 0 : sum(values) / values.length;
}

export function sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

/** Compact distribution summary shared by the pivot and the paired analysis. */
export interface NumberDistributionSummary {
    n: number;
    mean: number;
    p50: number;
    p95: number;
    min: number;
    max: number;
}

/** undefined when there are no samples — never a fabricated zero row. */
export function summarizeNumberDistribution(
    values: number[],
): NumberDistributionSummary | undefined {
    const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (sorted.length === 0) {
        return undefined;
    }
    return {
        n: sorted.length,
        mean: mean(sorted),
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        min: sorted[0] ?? 0,
        max: sorted[sorted.length - 1] ?? 0,
    };
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
