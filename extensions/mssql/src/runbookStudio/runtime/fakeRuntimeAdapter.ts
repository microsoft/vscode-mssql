/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Deterministic fake runtime (A2 §3.4 "a fake adapter is required"): executes
 * a compiled lock's DAG in-process with no model, no network, and no SQL.
 * Drives unit tests, the webview against fixtures, and the official
 * deterministic perftest lane (A2 §12.4). Semantics are intentionally small:
 *   - nodes execute sequentially from entryNodeId following edges;
 *   - edge conditions: success/failure on activities, approved/rejected on
 *     gates, absent = success path;
 *   - unreached nodes are reported skipped before the terminal event;
 *   - cancellation settles between nodes with one terminal;
 *   - activity kinds: sql.query.read (fixed rowset), assert.threshold
 *     (bind-expression compare), report (markdown summary).
 */

import type {
    RunbookArtifactFile,
    RunbookPlanEdge,
    RunbookPlanNode,
} from "../../sharedInterfaces/runbookStudio";
import type { RunbookOperationContext } from "../runbookDiag";
import type {
    RunbookRuntimeAdapter,
    RuntimeBoundaryEvent,
    RuntimeCapabilities,
    RuntimeEventObserver,
    RuntimeOutputPayload,
    RuntimeStartRequest,
    RuntimeValidationIssue,
} from "./runtimeAdapterTypes";

const FIXTURE_COLUMNS = ["object_id", "name", "type_desc", "row_estimate"];
const FIXTURE_ROWS: Array<Array<string | number | boolean | null>> = [
    [245575913, "Customers", "USER_TABLE", 1000],
    [277576027, "Products", "USER_TABLE", 250],
    [309576141, "Orders", "USER_TABLE", 4213],
    [341576255, "OrderItems", "USER_TABLE", 12847],
    [373576369, "AuditLog", "USER_TABLE", 88210],
];

interface ActiveRun {
    cancelRequested: boolean;
    terminalSent: boolean;
    pendingGate?: {
        nodeId: string;
        resolve: (approved: boolean) => void;
    };
}

/** Deterministic pause point so cancellation has a window between nodes. */
function tick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 1));
}

export class FakeRuntimeAdapter implements RunbookRuntimeAdapter {
    private readonly activeRuns = new Map<string, ActiveRun>();
    private disposed = false;

    public initialize(_context: RunbookOperationContext): Promise<RuntimeCapabilities> {
        return Promise.resolve({
            runtimeKind: "fake",
            runtimeVersion: "0.1.0",
            protocolVersion: "1",
            supportsCancellation: true,
            supportsGates: true,
            supportsResume: false,
            maxConcurrentRuns: 4,
        });
    }

    public validate(
        artifact: RunbookArtifactFile,
        _context: RunbookOperationContext,
    ): Promise<{ ok: boolean; issues: RuntimeValidationIssue[] }> {
        const issues: RuntimeValidationIssue[] = [];
        if (!artifact.lock) {
            issues.push({ detail: "artifact has no compiled lock" });
        } else {
            for (const node of artifact.lock.nodes) {
                if (node.kind === "activity" && !isKnownActivity(node.activityKind)) {
                    issues.push({
                        nodeId: node.id,
                        detail: `unsupported activity '${node.activityKind}'`,
                    });
                }
            }
        }
        return Promise.resolve({ ok: issues.length === 0, issues });
    }

    public async startRun(
        request: RuntimeStartRequest,
        observer: RuntimeEventObserver,
        _context: RunbookOperationContext,
    ): Promise<void> {
        if (this.disposed) {
            throw new Error("adapter disposed");
        }
        const lock = request.artifact.lock;
        if (!lock) {
            throw new Error("artifact has no compiled lock");
        }
        if (this.activeRuns.has(request.runId)) {
            throw new Error(`run ${request.runId} already active`);
        }
        const run: ActiveRun = { cancelRequested: false, terminalSent: false };
        this.activeRuns.set(request.runId, run);
        // Accepted: the caller's promise resolves now; execution continues
        // asynchronously exactly like a real out-of-process runtime.
        void this.execute(request, run, observer).catch(() => {
            // execute() reports its own terminal; a throw past that point is
            // a fake-runtime bug surfaced via the unexpected-exit path.
            if (!run.terminalSent) {
                observer.onExit(true);
                this.activeRuns.delete(request.runId);
            }
        });
    }

    public cancelRun(
        runId: string,
        _context: RunbookOperationContext,
    ): Promise<"cancelled" | "alreadyTerminal" | "failed"> {
        const run = this.activeRuns.get(runId);
        if (!run || run.terminalSent) {
            return Promise.resolve("alreadyTerminal");
        }
        run.cancelRequested = true;
        // A pending gate settles immediately as rejected-by-cancellation.
        run.pendingGate?.resolve(false);
        return Promise.resolve("cancelled");
    }

    public respondToGate(
        runId: string,
        nodeId: string,
        approve: boolean,
        _context: RunbookOperationContext,
    ): Promise<boolean> {
        const run = this.activeRuns.get(runId);
        if (!run || run.pendingGate?.nodeId !== nodeId) {
            return Promise.resolve(false);
        }
        run.pendingGate.resolve(approve);
        return Promise.resolve(true);
    }

    public dispose(): Promise<void> {
        this.disposed = true;
        for (const run of this.activeRuns.values()) {
            run.cancelRequested = true;
            run.pendingGate?.resolve(false);
        }
        return Promise.resolve();
    }

    // -----------------------------------------------------------------------

    private async execute(
        request: RuntimeStartRequest,
        run: ActiveRun,
        observer: RuntimeEventObserver,
    ): Promise<void> {
        const lock = request.artifact.lock!;
        const nodesById = new Map(lock.nodes.map((n) => [n.id, n]));
        const visited = new Set<string>();
        /** Deterministic values produced by executed nodes ($nodes.<id>.<k>). */
        const nodeValues = new Map<string, Record<string, number | string | boolean>>();
        const emit = (event: RuntimeBoundaryEvent) => {
            if (!run.terminalSent) {
                observer.onEvent(event);
            }
        };
        const terminal = (event: Extract<RuntimeBoundaryEvent, { kind: "terminal" }>) => {
            if (run.terminalSent) {
                return;
            }
            // Every unreached node is reported skipped BEFORE the terminal —
            // the ledger refuses post-terminal output (A2 §7.3).
            for (const node of lock.nodes) {
                if (!visited.has(node.id)) {
                    emit({
                        kind: "nodeState",
                        nodeId: node.id,
                        state: "skipped",
                        attempt: 0,
                        outcome: "skipped",
                    });
                }
            }
            observer.onEvent(event);
            run.terminalSent = true;
            this.activeRuns.delete(request.runId);
        };

        emit({ kind: "runState", state: "running" });

        let current: RunbookPlanNode | undefined = nodesById.get(lock.entryNodeId);
        let verdict: "pass" | "fail" | "indeterminate" | undefined;
        while (current) {
            await tick();
            if (run.cancelRequested) {
                emit({
                    kind: "nodeState",
                    nodeId: current.id,
                    state: "cancelled",
                    attempt: 1,
                    outcome: "cancelled",
                });
                visited.add(current.id);
                terminal({ kind: "terminal", state: "cancelled" });
                return;
            }
            visited.add(current.id);
            emit({ kind: "nodeState", nodeId: current.id, state: "running", attempt: 1 });

            let edgeCondition: RunbookPlanEdge["when"];
            if (current.kind === "gate") {
                emit({
                    kind: "gateRequested",
                    nodeId: current.id,
                    impactSummary: current.label,
                });
                const approved = await new Promise<boolean>((resolve) => {
                    run.pendingGate = { nodeId: current!.id, resolve };
                });
                run.pendingGate = undefined;
                emit({ kind: "gateResponded", nodeId: current.id, approved });
                if (run.cancelRequested) {
                    emit({
                        kind: "nodeState",
                        nodeId: current.id,
                        state: "cancelled",
                        attempt: 1,
                        outcome: "cancelled",
                    });
                    terminal({ kind: "terminal", state: "cancelled" });
                    return;
                }
                emit({
                    kind: "nodeState",
                    nodeId: current.id,
                    state: approved ? "succeeded" : "failed",
                    attempt: 1,
                    outcome: approved ? "success" : "failure",
                    message: approved ? "Approved" : "Rejected",
                });
                edgeCondition = approved ? "approved" : "rejected";
                if (!approved && !hasEdge(lock.edges, current.id, "rejected")) {
                    terminal({ kind: "terminal", state: "failed", verdict: "fail" });
                    return;
                }
            } else {
                const result = executeNode(current, request.parameterValues, nodeValues);
                if (result.values) {
                    nodeValues.set(current.id, result.values);
                }
                emit({
                    kind: "nodeState",
                    nodeId: current.id,
                    state: result.success ? "succeeded" : "failed",
                    attempt: 1,
                    outcome: result.success ? "success" : "failure",
                    ...(result.message ? { message: result.message } : {}),
                    ...(result.output ? { output: result.output } : {}),
                });
                if (result.verdict) {
                    verdict = result.verdict;
                }
                edgeCondition = result.success ? "success" : "failure";
                if (!result.success && !hasEdge(lock.edges, current.id, "failure")) {
                    terminal({
                        kind: "terminal",
                        state: "failed",
                        verdict: verdict ?? "fail",
                        errorCode: result.errorCode,
                        ...(result.message ? { errorMessage: result.message } : {}),
                    });
                    return;
                }
            }

            const nextEdge =
                lock.edges.find((e) => e.from === current!.id && e.when === edgeCondition) ??
                lock.edges.find((e) => e.from === current!.id && e.when === undefined);
            current = nextEdge ? nodesById.get(nextEdge.to) : undefined;
        }

        terminal({ kind: "terminal", state: "succeeded", verdict: verdict ?? "pass" });
    }
}

function hasEdge(edges: RunbookPlanEdge[], from: string, when: RunbookPlanEdge["when"]): boolean {
    return edges.some((e) => e.from === from && e.when === when);
}

function isKnownActivity(kind: string | undefined): boolean {
    return kind === "sql.query.read" || kind === "assert.threshold";
}

interface NodeExecution {
    success: boolean;
    message?: string;
    output?: RuntimeOutputPayload;
    values?: Record<string, number | string | boolean>;
    verdict?: "pass" | "fail";
    errorCode?: string;
}

function executeNode(
    node: RunbookPlanNode,
    parameterValues: Record<string, string | number | boolean | null>,
    nodeValues: Map<string, Record<string, number | string | boolean>>,
): NodeExecution {
    if (node.kind === "report") {
        return {
            success: true,
            output: {
                contract: "markdown/1",
                text: `Run summary for '${node.label}': all upstream checks completed.`,
            },
        };
    }
    switch (node.activityKind) {
        case "sql.query.read": {
            return {
                success: true,
                message: `${FIXTURE_ROWS.length} rows`,
                output: {
                    contract: "rowset/1",
                    columns: FIXTURE_COLUMNS,
                    rows: FIXTURE_ROWS,
                },
                values: { rowCount: FIXTURE_ROWS.length },
            };
        }
        case "assert.threshold": {
            const value = resolveBind(node.inputs?.value, parameterValues, nodeValues);
            const max = resolveBind(node.inputs?.max, parameterValues, nodeValues);
            if (typeof value !== "number" || typeof max !== "number") {
                return {
                    success: false,
                    message: "threshold inputs did not resolve to numbers",
                    errorCode: "RunbookStudio.BindingInvalid",
                };
            }
            const pass = value <= max;
            return {
                success: pass,
                verdict: pass ? "pass" : "fail",
                message: pass ? `${value} <= ${max}` : `${value} > ${max}`,
                output: {
                    contract: "scalarSet/1",
                    scalars: { value, max, pass },
                },
            };
        }
        default:
            return {
                success: false,
                message: `unsupported activity '${node.activityKind}'`,
                errorCode: "RunbookStudio.ActivityUnsupported",
            };
    }
}

/** Minimal deterministic bind-expression resolver:
 *  $params.<id> | $nodes.<id>.<key> | literal passthrough. */
function resolveBind(
    input: unknown,
    parameterValues: Record<string, string | number | boolean | null>,
    nodeValues: Map<string, Record<string, number | string | boolean>>,
): unknown {
    if (typeof input !== "string") {
        return input;
    }
    const paramMatch = /^\$params\.([A-Za-z0-9_-]+)$/.exec(input);
    if (paramMatch) {
        return coerceNumber(parameterValues[paramMatch[1]]);
    }
    const nodeMatch = /^\$nodes\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(input);
    if (nodeMatch) {
        return nodeValues.get(nodeMatch[1])?.[nodeMatch[2]];
    }
    return input;
}

function coerceNumber(value: string | number | boolean | null | undefined): unknown {
    if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
        return Number(value);
    }
    return value ?? undefined;
}
