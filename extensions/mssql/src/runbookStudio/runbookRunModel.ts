/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure run-model fold (RBS2-3): ledger events -> RunbookRunSnapshot, with
 * the protocol invariants enforced at the fold (A2 §7.3 / §4.1):
 *   - event sequence is strictly monotonic (+1 from the previous event);
 *   - exactly one terminal event per run; nothing folds after it;
 *   - node references must exist in the accepted plan;
 *   - state transitions never resurrect a terminal node.
 * No vscode imports — unit-testable and reusable by a headless host.
 */

import {
    RunbookNodeSnapshot,
    RunbookNodeStateKind,
    RunbookRunEvent,
    RunbookRunSnapshot,
    RunbookRunStateKind,
} from "../sharedInterfaces/runbookStudio";

export class LedgerInvariantError extends Error {
    constructor(
        public readonly invariant:
            | "seqNotMonotonic"
            | "eventAfterTerminal"
            | "duplicateTerminal"
            | "unknownNode"
            | "notAccepted"
            | "nodeResurrected",
        message: string,
    ) {
        super(message);
        this.name = "LedgerInvariantError";
    }
}

const TERMINAL_RUN_STATES: ReadonlySet<RunbookRunStateKind> = new Set([
    "succeeded",
    "failed",
    "cancelled",
]);

const TERMINAL_NODE_STATES: ReadonlySet<RunbookNodeStateKind> = new Set([
    "succeeded",
    "failed",
    "skipped",
    "cancelled",
]);

export function isTerminalRunState(state: RunbookRunStateKind): boolean {
    return TERMINAL_RUN_STATES.has(state);
}

export function isTerminalNodeState(state: RunbookNodeStateKind): boolean {
    return TERMINAL_NODE_STATES.has(state);
}

/** Snapshot before any event: every node pending, seq 0. */
export function createInitialSnapshot(init: {
    runId: string;
    runbookId: string;
    planRevision: string;
    planHash: string;
    nodeIds: string[];
}): RunbookRunSnapshot {
    return {
        runId: init.runId,
        runbookId: init.runbookId,
        planRevision: init.planRevision,
        planHash: init.planHash,
        state: "accepted",
        seq: 0,
        nodes: init.nodeIds.map(
            (nodeId): RunbookNodeSnapshot => ({ nodeId, state: "pending", attempt: 0 }),
        ),
    };
}

/**
 * Fold one event into a snapshot. Pure: returns a new snapshot; throws
 * LedgerInvariantError when the event violates a protocol invariant.
 */
export function applyRunEvent(
    snapshot: RunbookRunSnapshot,
    event: RunbookRunEvent,
): RunbookRunSnapshot {
    if (event.runId !== snapshot.runId) {
        throw new LedgerInvariantError(
            "unknownNode",
            `event for run ${event.runId} applied to run ${snapshot.runId}`,
        );
    }
    if (event.seq !== snapshot.seq + 1) {
        throw new LedgerInvariantError(
            "seqNotMonotonic",
            `expected seq ${snapshot.seq + 1}, got ${event.seq}`,
        );
    }
    if (isTerminalRunState(snapshot.state) && snapshot.seq > 0) {
        throw new LedgerInvariantError(
            "eventAfterTerminal",
            `event seq ${event.seq} after terminal state ${snapshot.state}`,
        );
    }

    const next: RunbookRunSnapshot = {
        ...snapshot,
        seq: event.seq,
        nodes: snapshot.nodes,
    };

    switch (event.type) {
        case "run.accepted": {
            next.state = "accepted";
            next.startedEpochMs = event.epochMs;
            return next;
        }
        case "run.state": {
            if (!event.runState) {
                return next;
            }
            if (isTerminalRunState(event.runState)) {
                throw new LedgerInvariantError(
                    "duplicateTerminal",
                    `terminal state ${event.runState} must arrive as run.terminal`,
                );
            }
            next.state = event.runState;
            return next;
        }
        case "node.state": {
            const index = snapshot.nodes.findIndex((n) => n.nodeId === event.nodeId);
            if (index < 0) {
                throw new LedgerInvariantError(
                    "unknownNode",
                    `node.state for unknown node '${event.nodeId}'`,
                );
            }
            const current = snapshot.nodes[index];
            if (
                isTerminalNodeState(current.state) &&
                event.nodeState !== undefined &&
                !isTerminalNodeState(event.nodeState) &&
                (event.attempt ?? current.attempt) <= current.attempt
            ) {
                throw new LedgerInvariantError(
                    "nodeResurrected",
                    `node '${event.nodeId}' left terminal state ${current.state} without a new attempt`,
                );
            }
            const updated: RunbookNodeSnapshot = {
                ...current,
                state: event.nodeState ?? current.state,
                attempt: event.attempt ?? current.attempt,
            };
            if (event.nodeState === "running" && current.state !== "running") {
                updated.startedEpochMs = event.epochMs;
            }
            if (event.outcome !== undefined) {
                updated.outcome = event.outcome as RunbookNodeSnapshot["outcome"];
            }
            if (event.message !== undefined) {
                updated.message = event.message;
            }
            if (event.branchNotTaken !== undefined) {
                updated.branchNotTaken = event.branchNotTaken;
            }
            if (event.outputs !== undefined) {
                updated.outputs = [...(current.outputs ?? []), ...event.outputs];
            }
            if (
                event.nodeState !== undefined &&
                isTerminalNodeState(event.nodeState) &&
                updated.startedEpochMs !== undefined
            ) {
                updated.durationMs = Math.max(0, event.epochMs - updated.startedEpochMs);
            }
            const nodes = [...snapshot.nodes];
            nodes[index] = updated;
            next.nodes = nodes;
            return next;
        }
        case "node.progress": {
            // Coalescible; carries no snapshot state.
            return next;
        }
        case "gate.requested": {
            if (!event.gate) {
                return next;
            }
            if (!snapshot.nodes.some((n) => n.nodeId === event.gate!.nodeId)) {
                throw new LedgerInvariantError(
                    "unknownNode",
                    `gate.requested for unknown node '${event.gate.nodeId}'`,
                );
            }
            next.pendingGate = event.gate;
            next.state = "awaitingApproval";
            return next;
        }
        case "gate.responded": {
            next.pendingGate = undefined;
            if (next.state === "awaitingApproval") {
                next.state = "running";
            }
            return next;
        }
        case "run.terminal": {
            if (isTerminalRunState(snapshot.state)) {
                throw new LedgerInvariantError(
                    "duplicateTerminal",
                    `second terminal for run ${snapshot.runId}`,
                );
            }
            const terminalState = event.runState;
            if (!terminalState || !isTerminalRunState(terminalState)) {
                throw new LedgerInvariantError(
                    "duplicateTerminal",
                    `run.terminal without a terminal runState`,
                );
            }
            next.state = terminalState;
            next.endedEpochMs = event.epochMs;
            next.pendingGate = undefined;
            if (event.outcome === "pass" || event.outcome === "fail") {
                next.verdict = event.outcome;
            } else if (event.outcome === "indeterminate") {
                next.verdict = "indeterminate";
            }
            if (event.error) {
                next.error = event.error;
            }
            return next;
        }
        default:
            return next;
    }
}

/** Fold a full event list from scratch (recovery/reopen path). */
export function foldRunEvents(
    initial: RunbookRunSnapshot,
    events: RunbookRunEvent[],
): RunbookRunSnapshot {
    let snapshot = initial;
    for (const event of events) {
        snapshot = applyRunEvent(snapshot, event);
    }
    return snapshot;
}
