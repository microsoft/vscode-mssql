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

import { QueryResultAccessError } from "./queryResultTypes";
import { QueryResultsAnalysis as AnalysisLoc } from "../constants/locConstants";
import { QsCellWindow } from "../sharedInterfaces/queryStudio";
import { CellRead, cellEqualityKey, cellNumeric, windowCellReader } from "./cellReader";
import {
    TransformAggregate,
    TransformPredicate,
    TransformSpec,
    transformOutputClass,
    transformSpecDigest,
    validateTransformSpec,
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
): boolean | undefined {
    if ("and" in pred) {
        const results = pred.and.map((child) => evaluatePredicate(child, cellAt, counters));
        return results.includes(false) ? false : results.includes(undefined) ? undefined : true;
    }
    if ("or" in pred) {
        const results = pred.or.map((child) => evaluatePredicate(child, cellAt, counters));
        return results.includes(true) ? true : results.includes(undefined) ? undefined : false;
    }
    if ("not" in pred) {
        const result = evaluatePredicate(pred.not, cellAt, counters);
        return result === undefined ? undefined : !result;
    }
    const cell = cellAt(pred.col);
    if (pred.cmp !== "isNull" && pred.cmp !== "notNull" && (cell.isNull || cell.isTruncated)) {
        if (cell.isTruncated) counters.truncatedCellsSkipped++;
        return undefined;
    }
    switch (pred.cmp) {
        case "isNull":
            return cell.isNull;
        case "notNull":
            return !cell.isNull;
        case "contains":
        case "startsWith": {
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
                return undefined;
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
    const validation = validateTransformSpec(spec);
    if (!validation.spec) {
        throw new QueryResultAccessError(
            "invalidTransformSpec",
            AnalysisLoc.invalidTransformSpec(
                validation.errors!.map((e) => e.path + ": " + e.message).join("; "),
            ),
        );
    }
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
    const checkOrdinal = (ordinal: number, width: number) => {
        if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= width) {
            throw new QueryResultAccessError(
                "invalidTransformSpec",
                AnalysisLoc.columnOutsideTransformSchema(String(ordinal), String(width)),
            );
        }
    };
    const checkPredicate = (pred: TransformPredicate, width: number): void => {
        if ("and" in pred) pred.and.forEach((child) => checkPredicate(child, width));
        else if ("or" in pred) pred.or.forEach((child) => checkPredicate(child, width));
        else if ("not" in pred) checkPredicate(pred.not, width);
        else checkOrdinal(pred.col, width);
    };
    spec.source.columns?.forEach((col) => checkOrdinal(col, sourceNames.length));
    let mapping = spec.source.columns ?? sourceNames.map((_, index) => index);
    const opPlan: Array<
        | { kind: "filter"; pred: TransformPredicate; mapping: number[] }
        | { kind: "slice"; offset: number; limit: number }
    > = [];
    for (const op of opsList) {
        if (op.op === "project") {
            op.columns.forEach((col) => checkOrdinal(col, mapping.length));
            mapping = op.columns.map((ordinal) => mapping[ordinal]);
        } else if (op.op === "filter") {
            checkPredicate(op.pred, mapping.length);
            opPlan.push({ kind: "filter", pred: op.pred, mapping: [...mapping] });
        } else {
            opPlan.push({ kind: "slice", offset: op.offset, limit: op.limit });
        }
    }
    const t = spec.terminal;
    if ("col" in t) checkOrdinal(t.col, mapping.length);
    if ("aggs" in t)
        t.aggs.forEach((agg) => {
            if (agg.col !== undefined) checkOrdinal(agg.col, mapping.length);
        });
    if (t.kind === "groupBy") {
        t.keys.forEach((col) => checkOrdinal(col, mapping.length));
        if (t.orderBy) checkOrdinal(t.orderBy.agg, t.aggs.length);
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
    let outputBytes = 2; // JSON array brackets; rows include their delimiters and escaping.
    let overflowGroups: number | undefined;
    const matchedIds: number[] = [];
    let matchedOverflow = false;

    const chargeOutput = (row: unknown[]): boolean => {
        outputCells += row.length;
        outputBytes +=
            Buffer.byteLength(JSON.stringify(row), "utf8") + (outputCells > row.length ? 1 : 0);
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
        // The next scan shares budgets and refuses to continue after a cut.
    }

    // Main fused scan ----------------------------------------------------------------
    const consumeRow = async (cellAt: CellAt, sourceRow: number): Promise<boolean> => {
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
                const compositeKey = JSON.stringify(keyCells.map(cellEqualityKey));
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
                        sampleRows!.push(row);
                        break;
                }
                return true;
            }
        }
        return true;
    };

    if (terminal.kind === "sample" && terminal.strategy === "uniform_windows") {
        // Allocate disjoint windows entirely inside the source span. Never scan
        // the source first, and use the same cancellation/row/time/yield path.
        const n = Math.min(terminal.n, span.count);
        const windows = Math.min(32, n);
        async function* sampledWindows(): AsyncIterable<QsCellWindow> {
            let allocated = 0;
            for (let i = 0; i < windows; i++) {
                const count = Math.ceil((n - allocated) / (windows - i));
                const start =
                    span.start +
                    allocated +
                    Math.floor(((span.count - n) * i) / Math.max(1, windows - 1));
                yield await reader.window(start, count);
                allocated += count;
            }
        }
        await scan(consumeRow, sampledWindows(), n);
    } else {
        await scan(consumeRow);
    }

    // Terminal finalization -------------------------------------------------------------
    switch (terminal.kind) {
        case "aggregate": {
            const row = aggregateAccs!.map((acc) => acc.value());
            if (chargeOutput(row)) outRows.push(row);
            break;
        }
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
            if (chargeOutput([distinct!.size])) outRows.push([distinct!.size]);
            if (distinctCapped) {
                approximate = true;
            }
            break;
        case "histogram":
            if (histogramBoundaries && histogramCounts) {
                for (let index = 0; index < histogramCounts.length; index++) {
                    const row = [
                        index === 0 ? null : histogramBoundaries[index - 1],
                        index === histogramBoundaries.length ? null : histogramBoundaries[index],
                        histogramCounts[index],
                    ];
                    if (!chargeOutput(row)) break;
                    outRows.push(row);
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

    function withinBudget(): boolean {
        if (options.isCancelled?.()) cut("canceled");
        else if (stats.rowsScanned >= options.budget.maxRowsScanned) cut("rows");
        else if (now() - startedAt > options.budget.maxEvalMs) cut("time");
        return !stopped;
    }

    async function scan(
        onRow: (cellAt: CellAt, sourceRow: number) => Promise<boolean> | boolean,
        windows: AsyncIterable<QsCellWindow> = reader.stream(
            span.start,
            span.count,
            options.chunkRows,
        ),
        expectedRows = span.count,
    ): Promise<void> {
        if (stats.partial) return;
        stopped = false;
        for (const state of sliceStates) {
            state.skipped = 0;
            state.taken = 0;
        }
        let sinceYield = 0;
        let scannedThisPass = 0;
        const iterator = windows[Symbol.asyncIterator]();
        try {
            while (scannedThisPass < expectedRows && withinBudget()) {
                const next = await iterator.next();
                if (next.done) return;
                const window = next.value;
                const cells = windowCellReader(window);
                for (let r = 0; r < window.rowCount; r++) {
                    if (!withinBudget()) return;
                    stats.rowsScanned++;
                    scannedThisPass++;
                    // Rejected rows also yield, allowing cancellation and UI events.
                    if (++sinceYield >= options.yieldEveryRows) {
                        sinceYield = 0;
                        await new Promise<void>((resolve) => setImmediate(resolve));
                        if (options.isCancelled?.()) {
                            cut("canceled");
                            return;
                        }
                    }
                    const raw: CellAt = (sourceCol) => cells.cellAt(r, sourceCol);
                    if (!passesOpsBound(raw)) continue;
                    if (
                        !(await onRow((col) => raw(finalMapping[col]), window.start + r)) ||
                        stopped
                    )
                        return;
                }
            }
        } finally {
            await iterator.return?.();
        }
    }

    function passesOpsBound(raw: CellAt): boolean {
        let sliceIndex = 0;
        for (const op of opPlan) {
            if (op.kind === "filter") {
                if (evaluatePredicate(op.pred, (col) => raw(op.mapping[col]), stats) !== true) {
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
