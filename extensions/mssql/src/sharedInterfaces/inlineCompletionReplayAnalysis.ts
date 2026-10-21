/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Paired replay-matrix analysis (final plan WI-4.2 / addendum §8.3 —
 * NORMATIVE). Pure, webview-safe functions: given a replay run's item
 * records (plus whatever result-event stats could be resolved), produce
 *
 * - per-cell aggregates (counts by status, latency distribution, token sums,
 *   output-presence rate, missingness, mode/fallback dimensions);
 * - SOURCE-PAIRED deltas versus a chosen baseline cell (per source event
 *   across cells: latency, tokens, output presence) — matrix cells compare
 *   the same source set, and incomplete runs never fabricate denominators;
 * - honest sample counts: n=1 cells carry `singleSample: true`, and no
 *   confidence intervals are computed anywhere ("a single call per cell is
 *   useful debugging evidence, not a stable quality conclusion").
 *
 * Everything here is EXPLORATORY by §7.1 semantics — the constant label
 * below is part of the contract and rendered verbatim by the Replay Lab.
 */

import {
    NumberDistributionSummary,
    mean,
    summarizeNumberDistribution,
} from "./inlineCompletionAnalysis";

/** §8.3 trust label — every analysis result carries it, the UI renders it. */
export const REPLAY_ANALYSIS_EXPLORATORY_LABEL =
    "exploratory · stochastic model output — single calls are debugging evidence, not quality conclusions";

/** Synthetic cell for single-config runs whose items carry no matrix cell. */
export const REPLAY_ANALYSIS_DEFAULT_CELL_ID = "(single-config)";

export type ReplayAnalysisItemStatus =
    | "completed"
    | "failed"
    | "cancelled"
    | "blocked"
    | "queued"
    | "running";

/**
 * One replay item, reduced to analysis-grade stats. Latency comes from the
 * durable item record; token counts and output presence come from the
 * RESOLVED result event when it is loadable (this console's live ring) and
 * stay undefined otherwise — undefined is missingness, never zero.
 */
export interface ReplayAnalysisItemInputV1 {
    replayItemId: string;
    sourceCaptureEventId: string;
    matrixCellId?: string;
    repetition: number;
    status: ReplayAnalysisItemStatus;
    latencyMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    /** True/false when the result event was resolvable; undefined = unknown. */
    outputPresent?: boolean;
    replayMode?: string;
    schemaContextSource?: string;
}

export interface ReplayAnalysisCellRefV1 {
    cellId: string;
    label: string;
    ordinal: number;
}

export interface ReplayOutputPresenceV1 {
    /** Items whose resolved result produced nonempty output. */
    produced: number;
    /** Items whose output presence is KNOWN (result event resolved). */
    known: number;
    /** produced / known; undefined when nothing is known. */
    rate: number | undefined;
}

export interface ReplayCellAggregateV1 {
    cellId: string;
    label: string;
    ordinal: number;
    /** sources × repetitions — what a complete run would have settled. */
    expectedItems: number;
    settledItems: number;
    completed: number;
    failed: number;
    cancelled: number;
    blocked: number;
    /** queued/running items (live view of an active run). */
    pending: number;
    /** expected − settled − pending, floored at 0: the honest gap. */
    missingItems: number;
    latency: NumberDistributionSummary | undefined;
    /** Sums over completed items whose result event exposed token counts. */
    inputTokensSum: number | undefined;
    outputTokensSum: number | undefined;
    /** Completed items contributing token sums (honest sample size). */
    tokenSampleCount: number;
    outputPresence: ReplayOutputPresenceV1;
    /** §8.3 n=1 marking: at most one completed sample in this cell. */
    singleSample: boolean;
    /** WI-3.4 dimensions observed on this cell's items. */
    replayModes: string[];
    schemaContextSources: string[];
    /** Items that used the explicit captured-schema fallback. */
    fallbackCount: number;
}

/** Source-paired deltas of one cell versus the baseline cell (§8.3). */
export interface ReplayPairedCellDeltaV1 {
    cellId: string;
    label: string;
    baselineCellId: string;
    /** Sources with ≥1 completed item in BOTH this cell and the baseline. */
    pairedSources: number;
    /** Sources missing a completed item on either side — never imputed. */
    missingPairs: number;
    /** Distribution of per-source (cell − baseline) latency deltas. */
    latencyDelta: NumberDistributionSummary | undefined;
    inputTokensDeltaMean: number | undefined;
    outputTokensDeltaMean: number | undefined;
    /** Paired sources with KNOWN presence on both sides. */
    presencePairs: number;
    /** producedRate(cell) − producedRate(baseline) over presencePairs. */
    outputPresenceDelta: number | undefined;
    singleSample: boolean;
}

export interface ReplayRunAnalysisV1 {
    /** Always true — §7.1 interactive-experiment semantics. */
    exploratory: true;
    exploratoryLabel: string;
    baselineCellId: string;
    sourceCount: number;
    repetitions: number;
    cells: ReplayCellAggregateV1[];
    /** Non-baseline cells versus the baseline; empty for single-cell runs. */
    pairedDeltas: ReplayPairedCellDeltaV1[];
    /** Distinct WI-3.4 dimensions across the whole run. */
    replayModes: string[];
    schemaContextSources: string[];
    /** Items whose result events could not be resolved for token/output
     *  stats (other host session, evicted ring) — the missingness caveat. */
    unresolvedResultStats: number;
}

export interface ComputeReplayRunAnalysisInput {
    cells: ReplayAnalysisCellRefV1[];
    /** Distinct source capture-event ids from the run manifest. */
    sourceCaptureEventIds: string[];
    repetitions: number;
    items: ReplayAnalysisItemInputV1[];
    /** Defaults to the first cell by ordinal. */
    baselineCellId?: string;
}

/** Per-(source, cell) reduced stats used for pairing. */
interface SourceCellSample {
    latencies: number[];
    inputTokens: number[];
    outputTokens: number[];
    producedKnown: number;
    producedTrue: number;
    completed: number;
}

export function computeReplayRunAnalysis(
    input: ComputeReplayRunAnalysisInput,
): ReplayRunAnalysisV1 {
    const cellRefs = normalizeCells(input.cells, input.items);
    const sourceIds = new Set(input.sourceCaptureEventIds);
    for (const item of input.items) {
        sourceIds.add(item.sourceCaptureEventId);
    }
    const repetitions = Math.max(1, input.repetitions);
    const expectedPerCell = sourceIds.size * repetitions;

    // ---- per-cell aggregates -------------------------------------------------
    const itemsByCell = new Map<string, ReplayAnalysisItemInputV1[]>();
    for (const ref of cellRefs) {
        itemsByCell.set(ref.cellId, []);
    }
    let unresolvedResultStats = 0;
    for (const item of input.items) {
        const cellId = item.matrixCellId ?? REPLAY_ANALYSIS_DEFAULT_CELL_ID;
        const bucket = itemsByCell.get(cellId);
        if (bucket) {
            bucket.push(item);
        } else {
            // An item referencing an unknown cell still counts — honest data
            // beats a clean table.
            itemsByCell.set(cellId, [item]);
            cellRefs.push({ cellId, label: cellId, ordinal: cellRefs.length });
        }
        if (item.status === "completed" && item.outputPresent === undefined) {
            unresolvedResultStats++;
        }
    }

    const cells: ReplayCellAggregateV1[] = cellRefs
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((ref) => aggregateCell(ref, itemsByCell.get(ref.cellId) ?? [], expectedPerCell));

    // ---- source-paired deltas (§8.3) ----------------------------------------
    const baselineCellId = resolveBaselineCellId(cells, input.baselineCellId);
    const samples = collectSourceCellSamples(input.items);
    const baselineBySource = samples.get(baselineCellId) ?? new Map<string, SourceCellSample>();

    const pairedDeltas: ReplayPairedCellDeltaV1[] = cells
        .filter((cell) => cell.cellId !== baselineCellId)
        .map((cell) => {
            const cellBySource = samples.get(cell.cellId) ?? new Map<string, SourceCellSample>();
            const latencyDeltas: number[] = [];
            const inputTokenDeltas: number[] = [];
            const outputTokenDeltas: number[] = [];
            let pairedSources = 0;
            let presencePairs = 0;
            let cellProduced = 0;
            let baselineProduced = 0;
            for (const sourceId of sourceIds) {
                const cellSample = cellBySource.get(sourceId);
                const baseSample = baselineBySource.get(sourceId);
                if (
                    !cellSample ||
                    !baseSample ||
                    cellSample.completed === 0 ||
                    baseSample.completed === 0
                ) {
                    continue; // missing on either side: never imputed
                }
                pairedSources++;
                if (cellSample.latencies.length > 0 && baseSample.latencies.length > 0) {
                    latencyDeltas.push(mean(cellSample.latencies) - mean(baseSample.latencies));
                }
                if (cellSample.inputTokens.length > 0 && baseSample.inputTokens.length > 0) {
                    inputTokenDeltas.push(
                        mean(cellSample.inputTokens) - mean(baseSample.inputTokens),
                    );
                }
                if (cellSample.outputTokens.length > 0 && baseSample.outputTokens.length > 0) {
                    outputTokenDeltas.push(
                        mean(cellSample.outputTokens) - mean(baseSample.outputTokens),
                    );
                }
                if (cellSample.producedKnown > 0 && baseSample.producedKnown > 0) {
                    presencePairs++;
                    if (cellSample.producedTrue > 0) cellProduced++;
                    if (baseSample.producedTrue > 0) baselineProduced++;
                }
            }
            return {
                cellId: cell.cellId,
                label: cell.label,
                baselineCellId,
                pairedSources,
                missingPairs: Math.max(0, sourceIds.size - pairedSources),
                latencyDelta: summarizeNumberDistribution(latencyDeltas),
                inputTokensDeltaMean:
                    inputTokenDeltas.length > 0 ? mean(inputTokenDeltas) : undefined,
                outputTokensDeltaMean:
                    outputTokenDeltas.length > 0 ? mean(outputTokenDeltas) : undefined,
                presencePairs,
                outputPresenceDelta:
                    presencePairs > 0
                        ? cellProduced / presencePairs - baselineProduced / presencePairs
                        : undefined,
                singleSample: pairedSources <= 1,
            };
        });

    return {
        exploratory: true,
        exploratoryLabel: REPLAY_ANALYSIS_EXPLORATORY_LABEL,
        baselineCellId,
        sourceCount: sourceIds.size,
        repetitions,
        cells,
        pairedDeltas,
        replayModes: distinct(cells.flatMap((cell) => cell.replayModes)),
        schemaContextSources: distinct(cells.flatMap((cell) => cell.schemaContextSources)),
        unresolvedResultStats,
    };
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function normalizeCells(
    cells: ReplayAnalysisCellRefV1[],
    items: ReplayAnalysisItemInputV1[],
): ReplayAnalysisCellRefV1[] {
    const refs = cells.map((cell) => ({ ...cell }));
    const hasUncelledItems = items.some((item) => item.matrixCellId === undefined);
    if (refs.length === 0 || hasUncelledItems) {
        refs.push({
            cellId: REPLAY_ANALYSIS_DEFAULT_CELL_ID,
            label: "single config",
            // After the declared cells, but first when there are none.
            ordinal: refs.length === 0 ? 0 : Math.max(...refs.map((r) => r.ordinal)) + 1,
        });
    }
    return refs;
}

function aggregateCell(
    ref: ReplayAnalysisCellRefV1,
    items: ReplayAnalysisItemInputV1[],
    expectedItems: number,
): ReplayCellAggregateV1 {
    let completed = 0;
    let failed = 0;
    let cancelled = 0;
    let blocked = 0;
    let pending = 0;
    let fallbackCount = 0;
    let produced = 0;
    let presenceKnown = 0;
    let tokenSampleCount = 0;
    let inputTokensSum = 0;
    let outputTokensSum = 0;
    let sawTokens = false;
    const latencies: number[] = [];
    const modes = new Set<string>();
    const schemaSources = new Set<string>();
    for (const item of items) {
        switch (item.status) {
            case "completed":
                completed++;
                break;
            case "failed":
                failed++;
                break;
            case "cancelled":
                cancelled++;
                break;
            case "blocked":
                blocked++;
                break;
            default:
                pending++;
                break;
        }
        if (item.replayMode) modes.add(item.replayMode);
        if (item.schemaContextSource) schemaSources.add(item.schemaContextSource);
        if (item.schemaContextSource === "explicitFallback") fallbackCount++;
        if (item.status !== "completed") {
            continue; // only completed executions contribute stats
        }
        if (typeof item.latencyMs === "number" && Number.isFinite(item.latencyMs)) {
            latencies.push(item.latencyMs);
        }
        if (item.outputPresent !== undefined) {
            presenceKnown++;
            if (item.outputPresent) produced++;
        }
        if (typeof item.inputTokens === "number" || typeof item.outputTokens === "number") {
            tokenSampleCount++;
            sawTokens = true;
            inputTokensSum += item.inputTokens ?? 0;
            outputTokensSum += item.outputTokens ?? 0;
        }
    }
    const settledItems = completed + failed + cancelled + blocked;
    return {
        cellId: ref.cellId,
        label: ref.label,
        ordinal: ref.ordinal,
        expectedItems,
        settledItems,
        completed,
        failed,
        cancelled,
        blocked,
        pending,
        missingItems: Math.max(0, expectedItems - settledItems - pending),
        latency: summarizeNumberDistribution(latencies),
        inputTokensSum: sawTokens ? inputTokensSum : undefined,
        outputTokensSum: sawTokens ? outputTokensSum : undefined,
        tokenSampleCount,
        outputPresence: {
            produced,
            known: presenceKnown,
            rate: presenceKnown > 0 ? produced / presenceKnown : undefined,
        },
        singleSample: completed <= 1,
        replayModes: [...modes].sort(),
        schemaContextSources: [...schemaSources].sort(),
        fallbackCount,
    };
}

function collectSourceCellSamples(
    items: ReplayAnalysisItemInputV1[],
): Map<string, Map<string, SourceCellSample>> {
    const byCell = new Map<string, Map<string, SourceCellSample>>();
    for (const item of items) {
        if (item.status !== "completed") {
            continue;
        }
        const cellId = item.matrixCellId ?? REPLAY_ANALYSIS_DEFAULT_CELL_ID;
        let bySource = byCell.get(cellId);
        if (!bySource) {
            bySource = new Map<string, SourceCellSample>();
            byCell.set(cellId, bySource);
        }
        let sample = bySource.get(item.sourceCaptureEventId);
        if (!sample) {
            sample = {
                latencies: [],
                inputTokens: [],
                outputTokens: [],
                producedKnown: 0,
                producedTrue: 0,
                completed: 0,
            };
            bySource.set(item.sourceCaptureEventId, sample);
        }
        sample.completed++;
        if (typeof item.latencyMs === "number" && Number.isFinite(item.latencyMs)) {
            sample.latencies.push(item.latencyMs);
        }
        if (typeof item.inputTokens === "number" && Number.isFinite(item.inputTokens)) {
            sample.inputTokens.push(item.inputTokens);
        }
        if (typeof item.outputTokens === "number" && Number.isFinite(item.outputTokens)) {
            sample.outputTokens.push(item.outputTokens);
        }
        if (item.outputPresent !== undefined) {
            sample.producedKnown++;
            if (item.outputPresent) sample.producedTrue++;
        }
    }
    return byCell;
}

function resolveBaselineCellId(
    cells: ReplayCellAggregateV1[],
    requested: string | undefined,
): string {
    if (requested !== undefined && cells.some((cell) => cell.cellId === requested)) {
        return requested;
    }
    // First cell by ordinal — the documented default baseline.
    return cells[0]?.cellId ?? REPLAY_ANALYSIS_DEFAULT_CELL_ID;
}

function distinct(values: string[]): string[] {
    return [...new Set(values)].sort();
}
