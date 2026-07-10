/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Transform engine (C2D-T, addendum §3.5): single-pass FUSED evaluation —
 * filter/project/slice and the terminal accumulate in one chunked scan over
 * bounded windows. Cooperative yielding keeps the shared extension host
 * responsive; every budget carries into EvalStats and a budget-cut result
 * says `partial: true` with a reason — it never pretends to be the full
 * answer (honesty discipline, QO invariant 4).
 *
 * Determinism: given (immutable snapshot, spec, budget) results are
 * deterministic — reservoir sampling seeds its PRNG from the specDigest.
 * All cell access rides CellReader (§1.5): nulls from bitmaps, truncated
 * cells incomparable (counted, never silently compared by prefix).
 */

import { QsCellWindow } from "../sharedInterfaces/queryStudio";
import { CellRead, cellEqualityKey, cellNumeric, windowCellReader } from "./cellReader";
import {
    TransformAggregate,
    TransformPredicate,
    TransformSpec,
    transformOutputClass,
    transformSpecDigest,
} from "./transformSpec";

// --- budgets / stats -------------------------------------------------------------

export interface EvalBudget {
    maxRowsScanned: number;
    maxEvalMs: number;
    maxGroups: number;
    maxOutputCells: number;
    maxOutputBytes: number;
}

export type EvalPartialReason =
    | "rows"
    | "time"
    | "groups"
    | "outputCells"
    | "outputBytes"
    | "canceled";

export interface EvalStats {
    rowsScanned: number;
    rowsMatched: number;
    elapsedMs: number;
    partial: boolean;
    partialReason?: EvalPartialReason;
    truncatedCellsSkipped: number;
}

export interface TransformResult {
    specDigest: string;
    outputClass: "values" | "aggregateNumeric";
    /** Output column labels (uniform table shape for every terminal). */
    columns: string[];
    /** Bounded output rows; nulls are null. */
    rows: unknown[][];
    stats: EvalStats;
    /** groupBy: distinct keys folded into the __other__ bucket (lower bound). */
    overflowGroups?: number;
    /** Result is approximate (frequency cap / overflow tracking cap hit). */
    approximate?: boolean;
    /** Present when options.collectMatchedRowIds was set (derive path). */
    matchedSourceRowIds?: number[];
    matchedRowIdsOverflow?: boolean;
}

export interface TransformSourceReader {
    columnNames(): string[];
    rowCount(): number;
    stream(start: number, count: number, chunkRows: number): AsyncIterable<QsCellWindow>;
    /** One bounded window (uniform_windows sampling). */
    window(start: number, count: number): Promise<QsCellWindow>;
}

export interface EvaluateOptions {
    budget: EvalBudget;
    chunkRows: number;
    yieldEveryRows: number;
    maxDistinctExact: number;
    isCancelled?: () => boolean;
    /** Collect post-ops source row ids (derived snapshots, §3.6). */
    collectMatchedRowIds?: { max: number };
    now?: () => number;
}

// --- deterministic PRNG (mulberry32 seeded from the spec digest) --------------------

function seededRandom(seedText: string): () => number {
    let seed = 0;
    for (let i = 0; i < seedText.length; i++) {
        seed = (seed * 31 + seedText.charCodeAt(i)) >>> 0;
    }
    return () => {
        seed = (seed + 0x6d2b79f5) >>> 0;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// --- predicate evaluation -------------------------------------------------------------

type CellAt = (col: number) => CellRead;

function compareCells(cell: CellRead, literal: string | number | boolean): number | undefined {
    if (cell.isNull) {
        return undefined; // SQL-ish: NULL compares to nothing
    }
    if (cell.isTruncated) {
        return undefined; // incomparable — counted by the caller
    }
    const numericCell = cellNumeric(cell);
    const numericLiteral =
        typeof literal === "number"
            ? literal
            : typeof literal === "boolean"
              ? literal
                  ? 1
                  : 0
              : Number.isFinite(Number(literal)) && String(literal).trim() !== ""
                ? Number(literal)
                : undefined;
    if (numericCell !== undefined && numericLiteral !== undefined) {
        return numericCell < numericLiteral ? -1 : numericCell > numericLiteral ? 1 : 0;
    }
    const left = String(cell.value);
    const right = String(literal);
    return left < right ? -1 : left > right ? 1 : 0;
}

function evaluatePredicate(
    pred: TransformPredicate,
    cellAt: CellAt,
    counters: { truncatedCellsSkipped: number },
): boolean {
    if ("and" in pred) {
        return pred.and.every((child) => evaluatePredicate(child, cellAt, counters));
    }
    if ("or" in pred) {
        return pred.or.some((child) => evaluatePredicate(child, cellAt, counters));
    }
    if ("not" in pred) {
        return !evaluatePredicate(pred.not, cellAt, counters);
    }
    const cell = cellAt(pred.col);
    switch (pred.cmp) {
        case "isNull":
            return cell.isNull;
        case "notNull":
            return !cell.isNull;
        case "contains":
        case "startsWith": {
            if (cell.isNull) {
                return false;
            }
            if (cell.isTruncated) {
                // A prefix CAN answer startsWith when it is long enough; it
                // cannot answer contains. Err honest: count and refuse both.
                counters.truncatedCellsSkipped++;
                return false;
            }
            const text = String(cell.value);
            const needle = String(pred.value ?? "");
            return pred.cmp === "contains" ? text.includes(needle) : text.startsWith(needle);
        }
        case "inSet":
            return (pred.values ?? []).some((candidate) => {
                const outcome = compareCells(cell, candidate);
                if (outcome === undefined && cell.isTruncated) {
                    counters.truncatedCellsSkipped++;
                }
                return outcome === 0;
            });
        default: {
            const outcome = compareCells(cell, pred.value as string | number | boolean);
            if (outcome === undefined) {
                if (cell.isTruncated) {
                    counters.truncatedCellsSkipped++;
                }
                return false;
            }
            switch (pred.cmp) {
                case "eq":
                    return outcome === 0;
                case "ne":
                    return outcome !== 0;
                case "lt":
                    return outcome < 0;
                case "le":
                    return outcome <= 0;
                case "gt":
                    return outcome > 0;
                case "ge":
                    return outcome >= 0;
            }
        }
    }
    return false;
}

// --- aggregate accumulators --------------------------------------------------------------

interface AggAccumulator {
    add(cellAt: CellAt): void;
    value(): unknown;
    label: string;
}

function makeAccumulator(
    agg: TransformAggregate,
    columnLabel: (col: number) => string,
    maxDistinctExact: number,
    flagApproximate: () => void,
): AggAccumulator {
    const label = agg.fn === "count" ? "count" : `${agg.fn}(${columnLabel(agg.col ?? 0)})`;
    switch (agg.fn) {
        case "count": {
            let count = 0;
            return { label, add: () => count++, value: () => count };
        }
        case "nullCount": {
            let count = 0;
            return {
                label,
                add: (cellAt) => {
                    if (cellAt(agg.col!).isNull) {
                        count++;
                    }
                },
                value: () => count,
            };
        }
        case "sum":
        case "avg":
        case "stddev": {
            // Welford: single-pass mean/variance without catastrophic loss.
            let n = 0;
            let mean = 0;
            let m2 = 0;
            let sum = 0;
            return {
                label,
                add: (cellAt) => {
                    const numeric = cellNumeric(cellAt(agg.col!));
                    if (numeric === undefined) {
                        return;
                    }
                    n++;
                    sum += numeric;
                    const delta = numeric - mean;
                    mean += delta / n;
                    m2 += delta * (numeric - mean);
                },
                value: () =>
                    agg.fn === "sum"
                        ? sum
                        : n === 0
                          ? null
                          : agg.fn === "avg"
                            ? mean
                            : n < 2
                              ? 0
                              : Math.sqrt(m2 / (n - 1)),
            };
        }
        case "min":
        case "max": {
            let best: CellRead | undefined;
            const keep = agg.fn === "min" ? -1 : 1;
            return {
                label,
                add: (cellAt) => {
                    const cell = cellAt(agg.col!);
                    if (cell.isNull || cell.isTruncated) {
                        return;
                    }
                    if (best === undefined) {
                        best = cell;
                        return;
                    }
                    const outcome = compareCells(cell, best.value as string | number | boolean);
                    if (outcome !== undefined && Math.sign(outcome) === keep) {
                        best = cell;
                    }
                },
                value: () => (best === undefined ? null : best.value),
            };
        }
        case "distinctCount": {
            const seen = new Set<string>();
            let capped = false;
            return {
                label,
                add: (cellAt) => {
                    if (capped) {
                        return;
                    }
                    seen.add(cellEqualityKey(cellAt(agg.col!)));
                    if (seen.size >= maxDistinctExact) {
                        capped = true;
                        flagApproximate();
                    }
                },
                value: () => seen.size,
            };
        }
    }
}

// --- evaluation --------------------------------------------------------------------------

export async function evaluateTransform(
    spec: TransformSpec,
    reader: TransformSourceReader,
    options: EvaluateOptions,
): Promise<TransformResult> {
    const now = options.now ?? (() => Date.now());
    const startedAt = now();
    const digest = transformSpecDigest(spec);
    const stats: EvalStats = {
        rowsScanned: 0,
        rowsMatched: 0,
        elapsedMs: 0,
        partial: false,
        truncatedCellsSkipped: 0,
    };
    let approximate = false;
    const flagApproximate = () => {
        approximate = true;
    };

    // Column mapping: engine ordinals → source ordinals, folded through
    // source.columns and project ops IN ORDER. Filters see the mapping in
    // effect where they appear.
    const sourceNames = reader.columnNames();
    const opsList = spec.ops ?? [];
    let mapping = spec.source.columns ?? sourceNames.map((_, index) => index);
    const opPlan: Array<
        | { kind: "filter"; pred: TransformPredicate; mapping: number[] }
        | { kind: "slice"; offset: number; limit: number }
    > = [];
    for (const op of opsList) {
        if (op.op === "project") {
            mapping = op.columns.map((ordinal) => mapping[ordinal] ?? 0);
        } else if (op.op === "filter") {
            opPlan.push({ kind: "filter", pred: op.pred, mapping: [...mapping] });
        } else {
            opPlan.push({ kind: "slice", offset: op.offset, limit: op.limit });
        }
    }
    const finalMapping = mapping;
    const finalColumnLabel = (col: number) => sourceNames[finalMapping[col] ?? -1] ?? `col${col}`;

    const totalRows = reader.rowCount();
    const span =
        spec.source.rows?.kind === "span"
            ? {
                  start: Math.min(spec.source.rows.start, totalRows),
                  count: Math.min(
                      spec.source.rows.count,
                      totalRows - Math.min(spec.source.rows.start, totalRows),
                  ),
              }
            : { start: 0, count: totalRows };

    // Slice counters live across the whole scan.
    const sliceStates = opPlan
        .filter((op): op is { kind: "slice"; offset: number; limit: number } => op.kind === "slice")
        .map((op) => ({ op, skipped: 0, taken: 0 }));

    // Terminal state --------------------------------------------------------------
    const terminal = spec.terminal;
    const outRows: unknown[][] = [];
    let outColumns: string[] = [];
    let outputCells = 0;
    let outputBytes = 0;
    let overflowGroups: number | undefined;
    const matchedIds: number[] = [];
    let matchedOverflow = false;

    const chargeOutput = (row: unknown[]): boolean => {
        outputCells += row.length;
        for (const value of row) {
            outputBytes += typeof value === "string" ? value.length : 8;
        }
        if (outputCells > options.budget.maxOutputCells) {
            cut("outputCells");
            return false;
        }
        if (outputBytes > options.budget.maxOutputBytes) {
            cut("outputBytes");
            return false;
        }
        return true;
    };

    let stopped = false;
    const cut = (reason: EvalPartialReason) => {
        if (!stats.partial) {
            stats.partial = true;
            stats.partialReason = reason;
        }
        stopped = true;
    };

    // Terminal accumulators ---------------------------------------------------------
    let aggregateAccs: AggAccumulator[] | undefined;
    interface GroupEntry {
        keyValues: unknown[];
        accs: AggAccumulator[];
    }
    let groups: Map<string, GroupEntry> | undefined;
    let overflowEntry: GroupEntry | undefined;
    let overflowKeys: Set<string> | undefined;
    let topValues: Array<{ sortKey: number | string; value: unknown }> | undefined;
    let frequency: Map<string, { value: unknown; count: number }> | undefined;
    let distinct: Set<string> | undefined;
    let distinctCapped = false;
    let histogramCounts: number[] | undefined;
    let histogramBoundaries: number[] | undefined;
    let sampleRows: unknown[][] | undefined;
    let sampleTail: unknown[][] | undefined;
    let reservoirSeen = 0;
    const random = seededRandom(digest);

    const makeAggs = (labelFor: (col: number) => string, aggs: TransformAggregate[]) =>
        aggs.map((agg) =>
            makeAccumulator(agg, labelFor, options.maxDistinctExact, flagApproximate),
        );

    switch (terminal.kind) {
        case "aggregate":
            aggregateAccs = makeAggs(finalColumnLabel, terminal.aggs);
            outColumns = aggregateAccs.map((acc) => acc.label);
            break;
        case "groupBy":
            groups = new Map();
            overflowKeys = new Set();
            outColumns = [
                ...terminal.keys.map(finalColumnLabel),
                ...makeAggs(finalColumnLabel, terminal.aggs).map((acc) => acc.label),
            ];
            break;
        case "topK":
            if (terminal.by === "value") {
                topValues = [];
            } else {
                frequency = new Map();
            }
            outColumns =
                terminal.by === "value"
                    ? [finalColumnLabel(terminal.col)]
                    : [finalColumnLabel(terminal.col), "count"];
            break;
        case "distinctCount":
            distinct = new Set();
            outColumns = [`distinctCount(${finalColumnLabel(terminal.col)})`];
            break;
        case "histogram":
            outColumns = ["bucketStart", "bucketEnd", "count"];
            if (terminal.boundaries) {
                histogramBoundaries = terminal.boundaries;
                histogramCounts = new Array(terminal.boundaries.length + 1).fill(0);
            }
            break;
        case "rows":
            outColumns = finalMapping.map((_, index) => finalColumnLabel(index));
            break;
        case "sample":
            outColumns = finalMapping.map((_, index) => finalColumnLabel(index));
            sampleRows = [];
            if (terminal.strategy === "head_tail") {
                sampleTail = [];
            }
            break;
    }

    // Auto-histogram: min/max pre-pass charged against the same budget.
    if (terminal.kind === "histogram" && !terminal.boundaries) {
        let min: number | undefined;
        let max: number | undefined;
        await scan(async (cellAt) => {
            const numeric = cellNumeric(cellAt(terminal.col));
            if (numeric !== undefined) {
                min = min === undefined ? numeric : Math.min(min, numeric);
                max = max === undefined ? numeric : Math.max(max, numeric);
            }
            return true;
        });
        const buckets = terminal.bucketCount ?? 20;
        if (min === undefined || max === undefined || !(max > min)) {
            histogramBoundaries = [min ?? 0];
        } else {
            histogramBoundaries = Array.from(
                { length: buckets - 1 },
                (_, index) => min! + ((max! - min!) * (index + 1)) / buckets,
            );
        }
        histogramCounts = new Array(histogramBoundaries.length + 1).fill(0);
        stopped = false; // pre-pass may have consumed rows; budget carries over
    }

    // Main fused scan ----------------------------------------------------------------
    await scan(async (cellAt, sourceRow) => {
        stats.rowsMatched++;
        if (options.collectMatchedRowIds) {
            if (matchedIds.length < options.collectMatchedRowIds.max) {
                matchedIds.push(sourceRow);
            } else {
                matchedOverflow = true;
            }
        }
        switch (terminal.kind) {
            case "aggregate":
                for (const acc of aggregateAccs!) {
                    acc.add(cellAt);
                }
                return true;
            case "groupBy": {
                const keyCells = terminal.keys.map((key) => cellAt(key));
                const compositeKey = keyCells.map(cellEqualityKey).join(" ");
                let entry = groups!.get(compositeKey);
                if (!entry) {
                    const cap = Math.min(
                        terminal.maxGroups ?? options.budget.maxGroups,
                        options.budget.maxGroups,
                    );
                    if (groups!.size >= cap) {
                        if (overflowKeys!.size < 10_000) {
                            overflowKeys!.add(compositeKey);
                        } else {
                            flagApproximate();
                        }
                        overflowEntry ??= {
                            keyValues: terminal.keys.map(() => "__other__"),
                            accs: makeAggs(finalColumnLabel, terminal.aggs),
                        };
                        entry = overflowEntry;
                    } else {
                        entry = {
                            keyValues: keyCells.map((cell) => (cell.isNull ? null : cell.value)),
                            accs: makeAggs(finalColumnLabel, terminal.aggs),
                        };
                        groups!.set(compositeKey, entry);
                    }
                }
                for (const acc of entry.accs) {
                    acc.add(cellAt);
                }
                return true;
            }
            case "topK": {
                const cell = cellAt(terminal.col);
                if (cell.isNull || cell.isTruncated) {
                    if (cell.isTruncated) {
                        stats.truncatedCellsSkipped++;
                    }
                    return true;
                }
                if (terminal.by === "value") {
                    const numeric = cellNumeric(cell);
                    topValues!.push({
                        sortKey: numeric !== undefined ? numeric : String(cell.value),
                        value: cell.value,
                    });
                    if (topValues!.length > Math.max(4096, terminal.k * 4)) {
                        sortTopValues(topValues!);
                        topValues!.length = terminal.k;
                    }
                } else {
                    const key = cellEqualityKey(cell);
                    const entry = frequency!.get(key);
                    if (entry) {
                        entry.count++;
                    } else if (frequency!.size < options.maxDistinctExact) {
                        frequency!.set(key, { value: cell.value, count: 1 });
                    } else {
                        flagApproximate();
                    }
                }
                return true;
            }
            case "distinctCount":
                if (!distinctCapped) {
                    distinct!.add(cellEqualityKey(cellAt(terminal.col)));
                    if (distinct!.size >= options.maxDistinctExact) {
                        distinctCapped = true;
                    }
                }
                return true;
            case "histogram": {
                const numeric = cellNumeric(cellAt(terminal.col));
                if (numeric !== undefined && histogramBoundaries && histogramCounts) {
                    let bucket = histogramBoundaries.findIndex((b) => numeric < b);
                    if (bucket < 0) {
                        bucket = histogramBoundaries.length;
                    }
                    histogramCounts[bucket]++;
                }
                return true;
            }
            case "rows": {
                if (outRows.length >= terminal.limit) {
                    cut("outputCells");
                    return false;
                }
                const row = finalMapping.map((_, index) => {
                    const cell = cellAt(index);
                    return cell.isNull ? null : cell.value;
                });
                if (!chargeOutput(row)) {
                    return false;
                }
                outRows.push(row);
                if (outRows.length >= terminal.limit && !options.collectMatchedRowIds) {
                    stopped = true; // satisfied, not partial
                }
                return true;
            }
            case "sample": {
                const row = finalMapping.map((_, index) => {
                    const cell = cellAt(index);
                    return cell.isNull ? null : cell.value;
                });
                switch (terminal.strategy) {
                    case "head":
                        if (sampleRows!.length < terminal.n) {
                            sampleRows!.push(row);
                            if (sampleRows!.length >= terminal.n) {
                                stopped = true;
                            }
                        }
                        break;
                    case "head_tail": {
                        const headCount = Math.ceil(terminal.n / 2);
                        const tailCount = Math.floor(terminal.n / 2);
                        if (sampleRows!.length < headCount) {
                            sampleRows!.push(row);
                        } else if (tailCount > 0) {
                            sampleTail!.push(row);
                            if (sampleTail!.length > tailCount) {
                                sampleTail!.shift();
                            }
                        }
                        break;
                    }
                    case "reservoir": {
                        reservoirSeen++;
                        if (sampleRows!.length < terminal.n) {
                            sampleRows!.push(row);
                        } else {
                            const slot = Math.floor(random() * reservoirSeen);
                            if (slot < terminal.n) {
                                sampleRows![slot] = row;
                            }
                        }
                        break;
                    }
                    case "uniform_windows":
                        // Handled below via direct window fetches.
                        break;
                }
                return true;
            }
        }
        return true;
    });

    // uniform_windows: evenly spaced bounded windows instead of a full scan.
    if (terminal.kind === "sample" && terminal.strategy === "uniform_windows") {
        const n = terminal.n;
        const windows = Math.min(Math.max(1, Math.min(32, n)), Math.max(1, span.count));
        const perWindow = Math.ceil(n / windows);
        for (let index = 0; index < windows && sampleRows!.length < n; index++) {
            const start =
                span.start +
                Math.floor((span.count - perWindow) * (windows === 1 ? 0 : index / (windows - 1)));
            const window = await reader.window(Math.max(span.start, start), perWindow);
            const cells = windowCellReader(window);
            for (let r = 0; r < window.rowCount && sampleRows!.length < n; r++) {
                stats.rowsScanned++;
                const raw: CellAt = (sourceCol) => cells.cellAt(r, sourceCol);
                if (!passesOpsBound(raw)) {
                    continue;
                }
                stats.rowsMatched++;
                sampleRows!.push(
                    finalMapping.map((_, colIndex) => {
                        const cell = raw(finalMapping[colIndex] ?? colIndex);
                        return cell.isNull ? null : cell.value;
                    }),
                );
            }
        }
    }

    // Terminal finalization -------------------------------------------------------------
    switch (terminal.kind) {
        case "aggregate":
            outRows.push(aggregateAccs!.map((acc) => acc.value()));
            break;
        case "groupBy": {
            const entries = [...groups!.values()];
            if (overflowEntry) {
                entries.push(overflowEntry);
                overflowGroups = overflowKeys!.size;
            }
            let tabulated = entries.map((entry) => [
                ...entry.keyValues,
                ...entry.accs.map((acc) => acc.value()),
            ]);
            if (terminal.orderBy) {
                const column = terminal.keys.length + terminal.orderBy.agg;
                const direction = terminal.orderBy.dir === "asc" ? 1 : -1;
                tabulated = tabulated.sort((a, b) => {
                    const left = a[column] as number;
                    const right = b[column] as number;
                    return left < right ? -direction : left > right ? direction : 0;
                });
            }
            if (terminal.limitGroups !== undefined) {
                tabulated = tabulated.slice(0, terminal.limitGroups);
            }
            for (const row of tabulated) {
                if (!chargeOutput(row)) {
                    break;
                }
                outRows.push(row);
            }
            break;
        }
        case "topK":
            if (terminal.by === "value") {
                sortTopValues(topValues!);
                for (const entry of topValues!.slice(0, terminal.k)) {
                    if (!chargeOutput([entry.value])) {
                        break;
                    }
                    outRows.push([entry.value]);
                }
            } else {
                const ranked = [...frequency!.values()]
                    .sort((a, b) => b.count - a.count)
                    .slice(0, terminal.k);
                for (const entry of ranked) {
                    if (!chargeOutput([entry.value, entry.count])) {
                        break;
                    }
                    outRows.push([entry.value, entry.count]);
                }
            }
            break;
        case "distinctCount":
            outRows.push([distinct!.size]);
            if (distinctCapped) {
                approximate = true;
            }
            break;
        case "histogram":
            if (histogramBoundaries && histogramCounts) {
                for (let index = 0; index < histogramCounts.length; index++) {
                    outRows.push([
                        index === 0 ? null : histogramBoundaries[index - 1],
                        index === histogramBoundaries.length ? null : histogramBoundaries[index],
                        histogramCounts[index],
                    ]);
                }
            }
            break;
        case "sample":
            if (terminal.strategy === "head_tail" && sampleTail) {
                sampleRows!.push(...sampleTail);
            }
            for (const row of sampleRows ?? []) {
                if (!chargeOutput(row)) {
                    break;
                }
                outRows.push(row);
            }
            break;
        case "rows":
            break;
    }

    stats.elapsedMs = now() - startedAt;
    return {
        specDigest: digest,
        outputClass: transformOutputClass(spec),
        columns: outColumns,
        rows: outRows,
        stats,
        ...(overflowGroups !== undefined ? { overflowGroups } : {}),
        ...(approximate ? { approximate: true } : {}),
        ...(options.collectMatchedRowIds
            ? { matchedSourceRowIds: matchedIds, matchedRowIdsOverflow: matchedOverflow }
            : {}),
    };

    // --- helpers over the shared scan state ------------------------------------------

    async function scan(
        onRow: (cellAt: CellAt, sourceRow: number) => Promise<boolean> | boolean,
    ): Promise<void> {
        stopped = false;
        for (const state of sliceStates) {
            state.skipped = 0;
            state.taken = 0;
        }
        let sinceYield = 0;
        for await (const window of reader.stream(span.start, span.count, options.chunkRows)) {
            const cells = windowCellReader(window);
            for (let r = 0; r < window.rowCount; r++) {
                if (stopped) {
                    return;
                }
                if (stats.rowsScanned >= options.budget.maxRowsScanned) {
                    cut("rows");
                    return;
                }
                if (now() - startedAt > options.budget.maxEvalMs) {
                    cut("time");
                    return;
                }
                if (options.isCancelled?.()) {
                    cut("canceled");
                    return;
                }
                stats.rowsScanned++;
                const sourceRow = window.start + r;
                const raw: CellAt = (sourceCol) => cells.cellAt(r, sourceCol);
                const finalCellAt: CellAt = (col) => raw(finalMapping[col] ?? col);
                if (!passesOpsBound(raw)) {
                    continue;
                }
                const keep = await onRow(finalCellAt, sourceRow);
                if (!keep || stopped) {
                    return;
                }
                if (++sinceYield >= options.yieldEveryRows) {
                    sinceYield = 0;
                    await new Promise<void>((resolve) => setImmediate(resolve));
                }
            }
            if (stopped) {
                return;
            }
        }
    }

    function passesOpsBound(raw: CellAt): boolean {
        let sliceIndex = 0;
        for (const op of opPlan) {
            if (op.kind === "filter") {
                if (!evaluatePredicate(op.pred, (col) => raw(op.mapping[col] ?? 0), stats)) {
                    return false;
                }
            } else {
                const state = sliceStates[sliceIndex++];
                if (state.skipped < op.offset) {
                    state.skipped++;
                    return false;
                }
                if (state.taken >= op.limit) {
                    stopped = true;
                    return false;
                }
                state.taken++;
            }
        }
        return true;
    }
}

function sortTopValues(values: Array<{ sortKey: number | string; value: unknown }>): void {
    values.sort((a, b) => {
        const left = a.sortKey;
        const right = b.sortKey;
        if (typeof left === "number" && typeof right === "number") {
            return right - left;
        }
        const ls = String(left);
        const rs = String(right);
        return ls < rs ? 1 : ls > rs ? -1 : 0;
    });
}
