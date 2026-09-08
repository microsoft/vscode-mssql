/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type WaitCounterRow = Readonly<Record<string, unknown>>;

export interface WaitComparison {
    readonly status: "baseline" | "delta" | "invalid";
    readonly rows: readonly WaitCounterRow[];
    readonly reason?: "counterReset" | "incomplete" | "invalidValue";
}

/**
 * Compares complete raw wait counters. The caller must collect the same scope and filter for
 * both samples. Missing rows are treated as zero, so a counter disappearing after a reset is
 * invalid rather than being presented as a negative wait interval.
 */
export function compareWaitCounters(
    baseline: readonly WaitCounterRow[] | undefined,
    current: readonly WaitCounterRow[],
    options: { baselineComplete: boolean; currentComplete: boolean },
): WaitComparison {
    if (!baseline) return { status: "baseline", rows: current };
    if (!options.baselineComplete || !options.currentComplete) {
        return { status: "invalid", rows: current, reason: "incomplete" };
    }

    const baselineByType = indexByWaitType(baseline);
    const rows: WaitCounterRow[] = [];
    for (const currentRow of current) {
        const waitType = currentRow.wait_type;
        if (typeof waitType !== "string") {
            return { status: "invalid", rows: current, reason: "invalidValue" };
        }
        const previousRow = baselineByType.get(waitType);
        const waitTime = counter(currentRow.wait_time_ms);
        const previousWaitTime = counter(previousRow?.wait_time_ms ?? 0);
        const taskCount = counter(currentRow.waiting_tasks_count);
        const previousTaskCount = counter(previousRow?.waiting_tasks_count ?? 0);
        const signalWait = counter(currentRow.signal_wait_time_ms);
        const previousSignalWait = counter(previousRow?.signal_wait_time_ms ?? 0);
        if (
            waitTime === undefined ||
            previousWaitTime === undefined ||
            taskCount === undefined ||
            previousTaskCount === undefined ||
            signalWait === undefined ||
            previousSignalWait === undefined
        ) {
            return { status: "invalid", rows: current, reason: "invalidValue" };
        }
        if (
            waitTime < previousWaitTime ||
            taskCount < previousTaskCount ||
            signalWait < previousSignalWait
        ) {
            return { status: "invalid", rows: current, reason: "counterReset" };
        }
        const deltaWaitTime = waitTime - previousWaitTime;
        const deltaTaskCount = taskCount - previousTaskCount;
        const deltaSignalWait = signalWait - previousSignalWait;
        if (deltaWaitTime === 0 && deltaTaskCount === 0 && deltaSignalWait === 0) continue;
        rows.push({
            ...currentRow,
            wait_time_ms: deltaWaitTime,
            waiting_tasks_count: deltaTaskCount,
            signal_wait_time_ms: deltaSignalWait,
            avg_wait_ms: deltaWaitTime / (deltaTaskCount || 1),
            resource_wait_time_ms: Math.max(0, deltaWaitTime - deltaSignalWait),
        });
    }

    for (const [waitType, previousRow] of baselineByType) {
        if (indexByWaitType(current).has(waitType)) continue;
        const previousWaitTime = counter(previousRow.wait_time_ms);
        const previousTaskCount = counter(previousRow.waiting_tasks_count);
        const previousSignalWait = counter(previousRow.signal_wait_time_ms);
        if (
            previousWaitTime === undefined ||
            previousTaskCount === undefined ||
            previousSignalWait === undefined
        ) {
            return { status: "invalid", rows: current, reason: "invalidValue" };
        }
        if (previousWaitTime > 0 || previousTaskCount > 0 || previousSignalWait > 0) {
            return { status: "invalid", rows: current, reason: "counterReset" };
        }
    }

    const total = rows.reduce((sum, row) => sum + counter(row.wait_time_ms)!, 0);
    const deltaRows: WaitCounterRow[] = rows.map((row) => ({
        ...row,
        pct_of_total: total > 0 ? (100 * counter(row.wait_time_ms)!) / total : 0,
    }));
    deltaRows.sort((left, right) => counter(right.wait_time_ms)! - counter(left.wait_time_ms)!);
    return {
        status: "delta",
        rows: deltaRows,
    };
}

function indexByWaitType(rows: readonly WaitCounterRow[]): Map<string, WaitCounterRow> {
    return new Map(
        rows
            .filter(
                (row): row is WaitCounterRow & { wait_type: string } =>
                    typeof row.wait_type === "string",
            )
            .map((row) => [row.wait_type, row]),
    );
}

function counter(value: unknown): number | undefined {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) && number >= 0 ? number : undefined;
}
