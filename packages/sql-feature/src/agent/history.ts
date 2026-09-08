/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface AgentHistoryGroup {
    summaryIndex?: number;
    stepIndexes: number[];
}

/** Groups retained rows by terminal step-zero boundaries; never invents a running execution. */
export function groupJobHistory(rows: readonly Record<string, unknown>[]): AgentHistoryGroup[] {
    const groups: AgentHistoryGroup[] = [];
    const unassigned: AgentHistoryGroup = { stepIndexes: [] };
    let current: AgentHistoryGroup | undefined;
    const entries = rows
        .map((row, index) => ({ row, index }))
        .sort((a, b) => Number(b.row.instance_id) - Number(a.row.instance_id));
    for (const { row, index } of entries) {
        const instanceId = integer(row.instance_id);
        const stepId = integer(row.step_id);
        if (instanceId === undefined || stepId === undefined) {
            unassigned.stepIndexes.push(index);
            continue;
        }
        if (stepId === 0) {
            current = undefined;
            if (
                integer(row.run_status_code) !== undefined &&
                [0, 1, 3].includes(integer(row.run_status_code)!)
            ) {
                current = { summaryIndex: index, stepIndexes: [] };
                groups.push(current);
            } else unassigned.stepIndexes.push(index);
            continue;
        }
        const summary =
            current?.summaryIndex === undefined ? undefined : rows[current.summaryIndex];
        // ISO values share a server-local basis. Missing/older timestamps cannot safely belong here.
        if (current && isAtOrAfter(row.run_time, summary?.run_time))
            current.stepIndexes.push(index);
        else unassigned.stepIndexes.push(index);
    }
    for (const group of groups) group.stepIndexes.reverse();
    if (unassigned.stepIndexes.length) groups.unshift(unassigned);
    return groups;
}

function integer(value: unknown): number | undefined {
    if (value === null || value === undefined || value === "") return undefined;
    const number = typeof value === "number" ? value : Number(value);
    return Number.isSafeInteger(number) ? number : undefined;
}

function isAtOrAfter(value: unknown, boundary: unknown): boolean {
    if (typeof value !== "string" || typeof boundary !== "string") return false;
    const timestamp = Date.parse(value);
    const boundaryTimestamp = Date.parse(boundary);
    return (
        Number.isFinite(timestamp) &&
        Number.isFinite(boundaryTimestamp) &&
        timestamp >= boundaryTimestamp
    );
}
