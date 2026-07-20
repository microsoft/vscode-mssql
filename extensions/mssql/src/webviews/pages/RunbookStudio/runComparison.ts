/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunbookNodeSnapshot, RunbookRunSnapshot } from "../../../sharedInterfaces/runbookStudio";

export interface RunComparisonValue<T> {
    baseline?: T;
    current?: T;
    delta?: number;
    changed: boolean;
}

export interface RunNodeComparison {
    nodeId: string;
    baselineState?: RunbookNodeSnapshot["state"];
    currentState?: RunbookNodeSnapshot["state"];
    baselineOutcome?: RunbookNodeSnapshot["outcome"];
    currentOutcome?: RunbookNodeSnapshot["outcome"];
    durationMs: RunComparisonValue<number>;
    rows: RunComparisonValue<number>;
    changed: boolean;
}

export interface RunMetricComparison {
    key: string;
    baseline?: string | number | boolean;
    current?: string | number | boolean;
    delta?: number;
    changed: boolean;
}

export interface RunComparison {
    samePlan: boolean;
    elapsedMs: RunComparisonValue<number>;
    completedNodes: RunComparisonValue<number>;
    warningCount?: RunComparisonValue<number>;
    errorCount?: RunComparisonValue<number>;
    nodes: RunNodeComparison[];
    metrics: RunMetricComparison[];
}

const TERMINAL_NODE_STATES = new Set<RunbookNodeSnapshot["state"]>([
    "succeeded",
    "failed",
    "skipped",
    "cancelled",
]);

function elapsedMs(snapshot: RunbookRunSnapshot): number | undefined {
    return snapshot.startedEpochMs !== undefined && snapshot.endedEpochMs !== undefined
        ? Math.max(0, snapshot.endedEpochMs - snapshot.startedEpochMs)
        : undefined;
}

function outputRows(node: RunbookNodeSnapshot | undefined): number | undefined {
    if (!node) {
        return undefined;
    }
    const measured = (node.outputs ?? []).flatMap((output) =>
        output.rows === undefined ? [] : [output.rows],
    );
    return measured.length > 0 ? measured.reduce((sum, rows) => sum + rows, 0) : undefined;
}

function numericComparison(
    baseline: number | undefined,
    current: number | undefined,
): RunComparisonValue<number> {
    return {
        ...(baseline !== undefined ? { baseline } : {}),
        ...(current !== undefined ? { current } : {}),
        ...(baseline !== undefined && current !== undefined ? { delta: current - baseline } : {}),
        changed: baseline !== current,
    };
}

/** Compare durable facts only. Positive/negative deltas deliberately carry
 * no regression judgment because performance noise policy and baselines are
 * separate product capabilities. */
export function compareRunSnapshots(
    baseline: RunbookRunSnapshot,
    current: RunbookRunSnapshot,
): RunComparison {
    const baselineNodes = new Map(baseline.nodes.map((node) => [node.nodeId, node]));
    const currentNodes = new Map(current.nodes.map((node) => [node.nodeId, node]));
    const nodeIds = [
        ...baseline.nodes.map((node) => node.nodeId),
        ...current.nodes.map((node) => node.nodeId).filter((nodeId) => !baselineNodes.has(nodeId)),
    ];
    const nodes = nodeIds.map((nodeId): RunNodeComparison => {
        const baselineNode = baselineNodes.get(nodeId);
        const currentNode = currentNodes.get(nodeId);
        const duration = numericComparison(baselineNode?.durationMs, currentNode?.durationMs);
        const rows = numericComparison(outputRows(baselineNode), outputRows(currentNode));
        const stateChanged = baselineNode?.state !== currentNode?.state;
        const outcomeChanged = baselineNode?.outcome !== currentNode?.outcome;
        return {
            nodeId,
            ...(baselineNode ? { baselineState: baselineNode.state } : {}),
            ...(currentNode ? { currentState: currentNode.state } : {}),
            ...(baselineNode?.outcome ? { baselineOutcome: baselineNode.outcome } : {}),
            ...(currentNode?.outcome ? { currentOutcome: currentNode.outcome } : {}),
            durationMs: duration,
            rows,
            changed: stateChanged || outcomeChanged || duration.changed || rows.changed,
        };
    });
    const metricKeys = [
        ...Object.keys(baseline.runMetrics ?? {}),
        ...Object.keys(current.runMetrics ?? {}).filter(
            (key) => baseline.runMetrics?.[key] === undefined,
        ),
    ].sort();
    const metrics = metricKeys.map((key): RunMetricComparison => {
        const baselineValue = baseline.runMetrics?.[key];
        const currentValue = current.runMetrics?.[key];
        return {
            key,
            ...(baselineValue !== undefined ? { baseline: baselineValue } : {}),
            ...(currentValue !== undefined ? { current: currentValue } : {}),
            ...(typeof baselineValue === "number" && typeof currentValue === "number"
                ? { delta: currentValue - baselineValue }
                : {}),
            changed: !Object.is(baselineValue, currentValue),
        };
    });
    return {
        samePlan:
            baseline.planRevision === current.planRevision &&
            baseline.planHash === current.planHash,
        elapsedMs: numericComparison(elapsedMs(baseline), elapsedMs(current)),
        completedNodes: numericComparison(
            baseline.nodes.filter((node) => TERMINAL_NODE_STATES.has(node.state)).length,
            current.nodes.filter((node) => TERMINAL_NODE_STATES.has(node.state)).length,
        ),
        ...(baseline.diagnosticCounts && current.diagnosticCounts
            ? {
                  warningCount: numericComparison(
                      baseline.diagnosticCounts.warningCount,
                      current.diagnosticCounts.warningCount,
                  ),
                  errorCount: numericComparison(
                      baseline.diagnosticCounts.errorCount,
                      current.diagnosticCounts.errorCount,
                  ),
              }
            : {}),
        nodes,
        metrics,
    };
}
