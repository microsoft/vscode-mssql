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
 *   - activity kinds: SQL/assert plus preview-only developer build/sandbox
 *     contracts that return typed synthetic evidence and never touch disk,
 *     processes, containers, networks, or databases.
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

/**
 * Optional per-activity override consulted BEFORE the built-in deterministic
 * behavior. The "local" runtime lane injects a delegate that executes
 * sql.query.read against a real extension-owned connection; every other
 * activity keeps the shared deterministic semantics. Returning undefined
 * falls through to the built-in execution.
 */
export interface ActivityExecutionDelegate {
    readonly runtimeKind: "fake" | "hobbes" | "local";
    /** Activity kinds implemented by this delegate. Validation uses this
     * closed list; execution never assumes that a delegate can handle an
     * activity merely because it is registered in the product catalog. */
    readonly supportedActivityKinds?: ReadonlySet<string>;
    executeActivity(
        node: RunbookPlanNode,
        binding: {
            parameterValues: Record<string, string | number | boolean | null>;
            resolveBind: (input: unknown) => unknown;
            isCancellationRequested: () => boolean;
            invocation: ActivityInvocationIdentity;
        },
    ): Promise<NodeExecution | undefined>;
}

export interface ActivityInvocationIdentity {
    runId: string;
    planRevision: string;
    planHash: string;
    attempt: number;
}

export class FakeRuntimeAdapter implements RunbookRuntimeAdapter {
    private readonly activeRuns = new Map<string, ActiveRun>();
    private disposed = false;

    constructor(private readonly delegate?: ActivityExecutionDelegate) {}

    public initialize(_context: RunbookOperationContext): Promise<RuntimeCapabilities> {
        return Promise.resolve({
            runtimeKind: this.delegate?.runtimeKind ?? "fake",
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
                if (
                    node.kind === "activity" &&
                    !isKnownActivity(
                        node.activityKind,
                        this.delegate === undefined,
                        this.delegate?.supportedActivityKinds,
                    )
                ) {
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
                // Delegate-first (local lane real SQL); built-in deterministic
                // semantics otherwise. A delegate throw fails the node, never
                // the walker.
                let result: NodeExecution | undefined;
                if (this.delegate && current.kind === "activity") {
                    try {
                        result = await this.delegate.executeActivity(current, {
                            parameterValues: request.parameterValues,
                            resolveBind: (input) =>
                                resolveBind(input, request.parameterValues, nodeValues),
                            isCancellationRequested: () => run.cancelRequested,
                            invocation: {
                                runId: request.runId,
                                planRevision: lock.planRevision,
                                planHash: lock.planHash,
                                attempt: 1,
                            },
                        });
                    } catch (error) {
                        result = {
                            success: false,
                            message: error instanceof Error ? error.message : "activity failed",
                            errorCode: "RunbookStudio.ActivityFailed",
                        };
                    }
                }
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
                result ??= executeNode(
                    current,
                    request.parameterValues,
                    nodeValues,
                    this.delegate === undefined,
                );
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

const PREVIEW_ACTIVITY_KINDS = new Set([
    "workspace.inspect",
    "dacpac.build",
    "sandbox.provision",
    "dacpac.deploy.preview",
    "dacpac.deploy",
    "schema.compare",
    "sandbox.dispose",
]);

function isKnownActivity(
    kind: string | undefined,
    allowPreviewActivities: boolean,
    delegatedActivities?: ReadonlySet<string>,
): boolean {
    return (
        kind === "sql.query.read" ||
        kind === "assert.threshold" ||
        (kind !== undefined && delegatedActivities?.has(kind) === true) ||
        (allowPreviewActivities && kind !== undefined && PREVIEW_ACTIVITY_KINDS.has(kind))
    );
}

export interface NodeExecution {
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
    allowPreviewActivities: boolean,
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
    if (PREVIEW_ACTIVITY_KINDS.has(node.activityKind ?? "") && !allowPreviewActivities) {
        return {
            success: false,
            message: `preview-only activity '${node.activityKind}' requires the fake runtime`,
            errorCode: "RunbookStudio.ActivityPolicyDenied",
        };
    }
    switch (node.activityKind) {
        case "workspace.inspect":
            return {
                success: true,
                message: "1 database project (deterministic preview)",
                output: {
                    contract: "workspaceSnapshot/1",
                    scalars: {
                        projectCount: 1,
                        projectPath: "preview://workspace/Database.sqlproj",
                        preview: true,
                    },
                },
                values: {
                    projectCount: 1,
                    projectPath: "preview://workspace/Database.sqlproj",
                },
            };
        case "dacpac.build": {
            const project = resolveBind(node.inputs?.project, parameterValues, nodeValues);
            if (typeof project !== "string" || project.length === 0) {
                return invalidPreviewBinding("dacpac.build", "project");
            }
            return {
                success: true,
                message: "DACPAC build contract passed (deterministic preview)",
                output: {
                    contract: "dacpacArtifact/1",
                    scalars: {
                        artifactPath: "preview://artifacts/Database.dacpac",
                        artifactSha256: "preview-artifact-sha256",
                        diagnosticCount: 0,
                        preview: true,
                    },
                },
                values: {
                    artifactPath: "preview://artifacts/Database.dacpac",
                    artifactSha256: "preview-artifact-sha256",
                    diagnosticCount: 0,
                },
            };
        }
        case "sandbox.provision": {
            const sandbox = resolveBind(node.inputs?.sandbox, parameterValues, nodeValues);
            if (typeof sandbox !== "string" || sandbox.length === 0) {
                return invalidPreviewBinding("sandbox.provision", "sandbox");
            }
            return {
                success: true,
                message: "Ephemeral lease created (deterministic preview)",
                output: {
                    contract: "databaseLease/1",
                    scalars: {
                        leaseId: "preview-lease-001",
                        connectionRef: "preview://sql/sandbox",
                        preview: true,
                    },
                },
                values: {
                    leaseId: "preview-lease-001",
                    connectionRef: "preview://sql/sandbox",
                },
            };
        }
        case "dacpac.deploy.preview": {
            const dacpac = resolveBind(node.inputs?.dacpac, parameterValues, nodeValues);
            const database = resolveBind(node.inputs?.database, parameterValues, nodeValues);
            if (typeof dacpac !== "string" || typeof database !== "string") {
                return invalidPreviewBinding("dacpac.deploy.preview", "dacpac/database");
            }
            return {
                success: true,
                message: "3 schema changes previewed (no deployment executed)",
                output: {
                    contract: "deploymentPreview/1",
                    text: '<DeploymentReport><Operations><Operation Name="Create"><Item Value="preview" /></Operation></Operations></DeploymentReport>',
                    scalars: {
                        changeCount: 3,
                        alertCount: 0,
                        operationSummary: "Create: 3",
                        reportSha256: "preview-report-sha256",
                        preview: true,
                    },
                },
                values: {
                    changeCount: 3,
                    reportSha256: "preview-report-sha256",
                },
            };
        }
        case "dacpac.deploy": {
            const dacpac = resolveBind(node.inputs?.dacpac, parameterValues, nodeValues);
            const database = resolveBind(node.inputs?.database, parameterValues, nodeValues);
            const artifactDigest = resolveBind(
                node.inputs?.artifactDigest,
                parameterValues,
                nodeValues,
            );
            const previewDigest = resolveBind(
                node.inputs?.previewDigest,
                parameterValues,
                nodeValues,
            );
            if (
                typeof dacpac !== "string" ||
                typeof database !== "string" ||
                typeof artifactDigest !== "string" ||
                typeof previewDigest !== "string"
            ) {
                return invalidPreviewBinding(
                    "dacpac.deploy",
                    "dacpac/database/artifactDigest/previewDigest",
                );
            }
            return {
                success: true,
                message: "DACPAC deployed (deterministic preview)",
                output: {
                    contract: "deploymentEvidence/1",
                    scalars: {
                        deployed: true,
                        artifactSha256: artifactDigest,
                        approvedPreviewDigest: previewDigest,
                        postDeployChangeCount: 0,
                        preview: true,
                    },
                },
                values: {
                    deployed: true,
                    artifactSha256: artifactDigest,
                    postDeployChangeCount: 0,
                },
            };
        }
        case "schema.compare": {
            const dacpac = resolveBind(node.inputs?.dacpac, parameterValues, nodeValues);
            const database = resolveBind(node.inputs?.database, parameterValues, nodeValues);
            if (typeof dacpac !== "string" || typeof database !== "string") {
                return invalidPreviewBinding("schema.compare", "dacpac/database");
            }
            return {
                success: true,
                message: "Schema matches DACPAC (deterministic preview)",
                output: {
                    contract: "schemaDiff/1",
                    text: "<DeploymentReport />",
                    scalars: {
                        matches: true,
                        changeCount: 0,
                        reportSha256: "preview-post-deploy-report-sha256",
                        preview: true,
                    },
                },
                values: {
                    matches: true,
                    changeCount: 0,
                    reportSha256: "preview-post-deploy-report-sha256",
                },
            };
        }
        case "sandbox.dispose": {
            const database = resolveBind(node.inputs?.database, parameterValues, nodeValues);
            if (typeof database !== "string") {
                return invalidPreviewBinding("sandbox.dispose", "database");
            }
            return {
                success: true,
                message: "Ephemeral lease disposed (deterministic preview)",
                output: {
                    contract: "cleanupEvidence/1",
                    scalars: { cleaned: true, preview: true },
                },
                values: { cleaned: true },
            };
        }
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

function invalidPreviewBinding(activityKind: string, input: string): NodeExecution {
    return {
        success: false,
        message: `${activityKind} input '${input}' did not resolve`,
        errorCode: "RunbookStudio.BindingInvalid",
    };
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
