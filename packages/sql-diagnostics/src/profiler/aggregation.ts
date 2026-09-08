/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProfilerEvent } from "./xelParser";

/**
 * Groups captured events by query so the profiler can answer "what is slow?" directly, rather
 * than leaving a user to read a scrolling grid.
 *
 * Aggregates are maintained incrementally: {@link add} on capture and {@link remove} when a
 * ring buffer evicts an event, so the totals always describe exactly what is retained.
 *
 * These figures describe the captured sample, not the server. A profiler holds a bounded number
 * of recent events, so this ranks what was seen — Query Store answers the server-wide question.
 */

export interface QueryAggregate {
    /** query_hash when the session collects it, otherwise a normalized form of the text. */
    readonly key: string;
    /** Representative statement text for display. */
    text: string;
    count: number;
    /** Durations are microseconds, as Extended Events reports them. */
    totalDurationUs: number;
    maxDurationUs: number;
    totalCpuUs: number;
    totalLogicalReads: number;
    totalRowCount: number;
    /** Most recent timestamp seen for this query, ISO 8601. */
    lastSeen: string;
}

export interface AggregateView extends QueryAggregate {
    readonly avgDurationUs: number;
}

/** Fields the aggregation reads, in the order it prefers them. */
const TEXT_FIELDS = ["batch_text", "statement", "sql_text", "options_text"] as const;
const DURATION_FIELDS = ["duration"] as const;
const CPU_FIELDS = ["cpu_time"] as const;
const READ_FIELDS = ["logical_reads"] as const;
const ROW_FIELDS = ["row_count"] as const;

function firstNumber(event: ProfilerEvent, fields: readonly string[]): number {
    for (const field of fields) {
        const raw = event.values[field];
        if (raw !== undefined) {
            const n = Number(raw);
            if (Number.isFinite(n)) {
                return n;
            }
        }
    }
    return 0;
}

function firstText(event: ProfilerEvent, fields: readonly string[]): string | undefined {
    for (const field of fields) {
        const raw = event.values[field];
        if (raw !== undefined && raw !== "") {
            return raw;
        }
    }
    return undefined;
}

/**
 * Collapses a statement to a shape that groups equivalent queries together, for sessions that
 * do not collect query_hash. Literals become placeholders and whitespace is flattened.
 */
export function normalizeStatement(text: string): string {
    return text
        .replace(/'(?:[^']|'')*'/g, "?")
        .replace(/\b0x[0-9a-fA-F]+\b/g, "?")
        .replace(/\b\d+\b/g, "?")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
        .slice(0, 4000);
}

/** The key an event groups under: its query hash when present, otherwise its normalized text. */
export function aggregationKey(event: ProfilerEvent): string | undefined {
    const hash = event.values.query_hash;
    if (hash && hash !== "0" && hash !== "0x0000000000000000") {
        return hash;
    }
    const text = firstText(event, TEXT_FIELDS);
    return text ? normalizeStatement(text) : undefined;
}

export class QueryAggregator {
    private readonly _byKey = new Map<string, QueryAggregate>();

    get size(): number {
        return this._byKey.size;
    }

    /** Folds one captured event into the totals. */
    add(event: ProfilerEvent): void {
        const key = aggregationKey(event);
        if (!key) {
            return;
        }

        const duration = firstNumber(event, DURATION_FIELDS);
        let entry = this._byKey.get(key);
        if (!entry) {
            entry = {
                key,
                text: firstText(event, TEXT_FIELDS) ?? event.name,
                count: 0,
                totalDurationUs: 0,
                maxDurationUs: 0,
                totalCpuUs: 0,
                totalLogicalReads: 0,
                totalRowCount: 0,
                lastSeen: event.timestamp,
            };
            this._byKey.set(key, entry);
        }

        entry.count++;
        entry.totalDurationUs += duration;
        entry.maxDurationUs = Math.max(entry.maxDurationUs, duration);
        entry.totalCpuUs += firstNumber(event, CPU_FIELDS);
        entry.totalLogicalReads += firstNumber(event, READ_FIELDS);
        entry.totalRowCount += firstNumber(event, ROW_FIELDS);
        if (event.timestamp > entry.lastSeen) {
            entry.lastSeen = event.timestamp;
        }
    }

    /**
     * Reverses {@link add} for an event leaving the retained window, so the totals keep
     * describing the buffer rather than everything ever seen.
     */
    remove(event: ProfilerEvent): void {
        const key = aggregationKey(event);
        if (!key) {
            return;
        }
        const entry = this._byKey.get(key);
        if (!entry) {
            return;
        }

        entry.count--;
        entry.totalDurationUs -= firstNumber(event, DURATION_FIELDS);
        entry.totalCpuUs -= firstNumber(event, CPU_FIELDS);
        entry.totalLogicalReads -= firstNumber(event, READ_FIELDS);
        entry.totalRowCount -= firstNumber(event, ROW_FIELDS);

        if (entry.count <= 0) {
            this._byKey.delete(key);
        }
        // maxDurationUs is deliberately not recomputed: doing so would need every retained
        // event for this key. It stays an upper bound over the window, which is what a "max"
        // column is read as, and it is reset when the key empties.
    }

    clear(): void {
        this._byKey.clear();
    }

    /** Ranked view of the aggregates. Default order is total duration, descending. */
    top(
        limit = 100,
        sortBy: keyof QueryAggregate | "avgDurationUs" = "totalDurationUs",
    ): readonly AggregateView[] {
        const views: AggregateView[] = [];
        for (const entry of this._byKey.values()) {
            views.push({
                ...entry,
                avgDurationUs: entry.count > 0 ? entry.totalDurationUs / entry.count : 0,
            });
        }

        views.sort((a, b) => {
            const av = a[sortBy as keyof AggregateView];
            const bv = b[sortBy as keyof AggregateView];
            if (typeof av === "number" && typeof bv === "number") {
                return bv - av;
            }
            return String(bv).localeCompare(String(av));
        });

        return views.slice(0, limit);
    }
}
