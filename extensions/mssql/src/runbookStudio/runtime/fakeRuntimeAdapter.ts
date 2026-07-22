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

import * as crypto from "crypto";
import type {
    RunbookArtifactFile,
    RunbookDiagnosticCounts,
    RunbookPlanEdge,
    RunbookPlanNode,
} from "../../sharedInterfaces/runbookStudio";
import type { RunbookOperationContext } from "../runbookDiag";
import { validateLocalCreateTableSql } from "../schemaMutationPolicy";
import { buildLocalEvidenceBundle, LocalEvidenceNodeInput } from "./localEvidenceBundle";
import type { LocalToolchainProvenance } from "./localToolchainProvenance";
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

interface FakeEvidenceContext {
    runId: string;
    runbookId: string;
    planRevision: string;
    planHash: string;
    nodes: LocalEvidenceNodeInput[];
}

const FAKE_TOOLCHAIN: LocalToolchainProvenance = {
    complete: false,
    components: [
        {
            id: "vscode",
            version: "0.0.0-fake",
            status: "resolved",
            versionSource: "host",
        },
        {
            id: "mssqlExtension",
            version: "0.0.0-fake",
            status: "resolved",
            versionSource: "extensionManifest",
        },
        {
            id: "sqlDatabaseProjectsExtension",
            version: null,
            status: "unavailable",
            versionSource: "none",
        },
        {
            id: "sqlToolsService",
            version: null,
            status: "unavailable",
            versionSource: "none",
        },
        {
            id: "dacFx",
            version: null,
            status: "unavailable",
            versionSource: "none",
            hostComponent: "sqlToolsService",
        },
    ],
};

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
        const runMetrics: Record<string, string | number | boolean> = {};
        const diagnosticCounts: RunbookDiagnosticCounts = { warningCount: 0, errorCount: 0 };
        /** Deterministic values produced by executed nodes ($nodes.<id>.<k>). */
        const nodeValues = new Map<string, Record<string, number | string | boolean>>();
        const evidenceNodes = new Map<string, LocalEvidenceNodeInput>();
        const emit = (event: RuntimeBoundaryEvent) => {
            if (!run.terminalSent) {
                observer.onEvent(event);
            }
        };
        const terminal = (event: Extract<RuntimeBoundaryEvent, { kind: "terminal" }>) => {
            if (run.terminalSent) {
                return;
            }
            mergeRunMetrics(runMetrics, event.runMetrics);
            diagnosticCounts.warningCount = addBoundedCount(
                diagnosticCounts.warningCount,
                event.diagnosticCounts?.warningCount,
            );
            diagnosticCounts.errorCount = addBoundedCount(
                diagnosticCounts.errorCount,
                event.diagnosticCounts?.errorCount,
            );
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
            observer.onEvent({
                ...event,
                ...(Object.keys(runMetrics).length > 0 ? { runMetrics: { ...runMetrics } } : {}),
                diagnosticCounts: { ...diagnosticCounts },
            });
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
                // Make the gate actionable before publishing it. A webview
                // naturally responds on a later turn, but headless clients
                // may approve synchronously from the gateRequested callback.
                const gateDecision = new Promise<boolean>((resolve) => {
                    run.pendingGate = { nodeId: current!.id, resolve };
                });
                emit({
                    kind: "gateRequested",
                    nodeId: current.id,
                    impactSummary: current.label,
                });
                const approved = await gateDecision;
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
                evidenceNodes.set(current.id, {
                    nodeId: current.id,
                    state: approved ? "succeeded" : "failed",
                    attempt: 1,
                    outcome: approved ? "success" : "failure",
                });
                if (!approved) {
                    verdict = "fail";
                }
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
                    {
                        runId: request.runId,
                        runbookId: request.artifact.id,
                        planRevision: lock.planRevision,
                        planHash: lock.planHash,
                        nodes: [...evidenceNodes.values()],
                    },
                );
                mergeRunMetrics(runMetrics, result.runMetrics);
                diagnosticCounts.warningCount = addBoundedCount(
                    diagnosticCounts.warningCount,
                    result.diagnosticCounts?.warningCount,
                );
                diagnosticCounts.errorCount = addBoundedCount(
                    diagnosticCounts.errorCount,
                    Math.max(
                        measuredCount(result.diagnosticCounts?.errorCount),
                        result.success ? 0 : 1,
                    ),
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
                evidenceNodes.set(current.id, {
                    nodeId: current.id,
                    ...(current.activityKind ? { activityKind: current.activityKind } : {}),
                    state: result.success ? "succeeded" : "failed",
                    attempt: 1,
                    outcome: result.success ? "success" : "failure",
                    ...(result.output
                        ? {
                              outputs: [
                                  {
                                      handleId: `fake/${current.id}`,
                                      contract: result.output.contract,
                                      ...(result.output.rows
                                          ? { rows: result.output.rows.length }
                                          : {}),
                                      bytes: Buffer.byteLength(
                                          JSON.stringify(result.output),
                                          "utf8",
                                      ),
                                  },
                              ],
                          }
                        : {}),
                    ...(result.output?.scalars ? { scalars: result.output.scalars } : {}),
                });
                if (result.verdict) {
                    verdict = result.verdict;
                }
                if (!result.success) {
                    verdict = "fail";
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

        const finalVerdict = verdict ?? "pass";
        terminal({
            kind: "terminal",
            state: finalVerdict === "fail" ? "failed" : "succeeded",
            verdict: finalVerdict,
        });
    }
}

function hasEdge(edges: RunbookPlanEdge[], from: string, when: RunbookPlanEdge["when"]): boolean {
    return edges.some((e) => e.from === from && e.when === when);
}

const PREVIEW_ACTIVITY_KINDS = new Set([
    "workspace.inspect",
    "git.change-set.inspect",
    "ef.project.discover",
    "ef.relational-model.extract",
    "ef.relational-model.compare",
    "sqltest.discover",
    "tsqlt.run",
    "dacpac.build",
    "dacpac.extract",
    "sandbox.provision",
    "devdatabase.provision",
    "sql.container.provision",
    "sql.workload.generate",
    "sql.workload.inspect",
    "dacpac.deploy.preview",
    "dacpac.deploy",
    "dacpac.deploy.dev",
    "dacpac.deploy.container",
    "xevent.session.start",
    "sql.workload.run",
    "xevent.session.stop",
    "xevent.xel.collect",
    "xevent.xel.analyze",
    "database.schema.fingerprint",
    "performance.dmv.snapshot",
    "performance.dmv.delta",
    "workload.benchmark",
    "schema.compare",
    "schema.compare.export",
    "database.schema.visualize",
    "sql.schema.apply",
    "database.schema.inventory",
    "sqltest.run",
    "sandbox.dispose",
    "sql.container.dispose",
    "evidence.bundle",
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
    /** Closed, trusted scalar facts to publish on the terminal run record. */
    runMetrics?: Record<string, string | number | boolean>;
    /** Measured activity diagnostics. Failed activities without an explicit
     * count contribute one runtime error diagnostic at the walker boundary. */
    diagnosticCounts?: RunbookDiagnosticCounts;
}

function mergeRunMetrics(
    target: Record<string, string | number | boolean>,
    source: Record<string, string | number | boolean> | undefined,
): void {
    if (!source) {
        return;
    }
    for (const [key, value] of Object.entries(source)) {
        if (
            (!(key in target) && Object.keys(target).length >= 100) ||
            key.length === 0 ||
            key.length > 256 ||
            (typeof value !== "string" &&
                typeof value !== "boolean" &&
                !(typeof value === "number" && Number.isFinite(value)))
        ) {
            continue;
        }
        target[key] = value;
    }
}

function measuredCount(value: number | undefined): number {
    return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function addBoundedCount(current: number, value: number | undefined): number {
    return Math.min(Number.MAX_SAFE_INTEGER, current + measuredCount(value));
}

function executeNode(
    node: RunbookPlanNode,
    parameterValues: Record<string, string | number | boolean | null>,
    nodeValues: Map<string, Record<string, number | string | boolean>>,
    allowPreviewActivities: boolean,
    evidenceContext: FakeEvidenceContext,
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
                runMetrics: {
                    "workspace.folderCount": 1,
                    "workspace.projectCount": 1,
                    "workspace.truncated": false,
                },
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
        case "ef.project.discover":
            return {
                success: true,
                runMetrics: {
                    "ef.projectCount": 1,
                    "ef.dbContextCount": 1,
                    "ef.providerCount": 1,
                    "ef.entitySourceFileCount": 2,
                    "ef.discoveryTruncated": false,
                },
                message: "1 Entity Framework project candidate (deterministic preview)",
                output: {
                    contract: "efProjectDiscovery/1",
                    columns: [
                        "project",
                        "targetFrameworks",
                        "providers",
                        "dbContexts",
                        "entitySourceFiles",
                        "truncated",
                    ],
                    rows: [
                        [
                            "src/MyApp.csproj",
                            "net8.0",
                            "Microsoft.EntityFrameworkCore.SqlServer",
                            "AppDbContext",
                            2,
                            false,
                        ],
                    ],
                    scalars: {
                        projectCount: 1,
                        dbContextCount: 1,
                        providerCount: 1,
                        entitySourceFileCount: 2,
                        scannedSourceFileCount: 3,
                        truncated: false,
                        preview: true,
                    },
                },
                values: {
                    projectCount: 1,
                    dbContextCount: 1,
                    providerCount: 1,
                    entitySourceFileCount: 2,
                    truncated: false,
                },
            };
        case "ef.relational-model.extract": {
            const revision = resolveBind(node.inputs?.revision, parameterValues, nodeValues);
            if (typeof revision !== "string") {
                return invalidPreviewBinding("ef.relational-model.extract", "revision");
            }
            const digest = crypto.createHash("sha256").update(revision).digest("hex");
            return {
                success: true,
                runMetrics: {
                    "ef.modelTableCount": 2,
                    "ef.modelColumnCount": 8,
                    "ef.modelComplete": true,
                    "ef.modelUnsupportedCount": 0,
                },
                message: "2-table EF relational model (deterministic preview)",
                output: {
                    contract: "efRelationalModel/1",
                    columns: ["schema", "table", "columns", "indexes", "foreignKeys", "temporal"],
                    rows: [
                        ["dbo", "Customers", 3, 1, 0, false],
                        ["dbo", "Orders", 5, 1, 1, false],
                    ],
                    scalars: {
                        modelRef: `preview-ef-model:${digest}`,
                        modelSha256: digest,
                        tableCount: 2,
                        columnCount: 8,
                        complete: true,
                        preview: true,
                    },
                },
                values: {
                    modelRef: `preview-ef-model:${digest}`,
                    modelSha256: digest,
                    commit: digest.slice(0, 40),
                    tableCount: 2,
                    complete: true,
                },
            };
        }
        case "ef.relational-model.compare": {
            const base = resolveBind(node.inputs?.base, parameterValues, nodeValues);
            const head = resolveBind(node.inputs?.head, parameterValues, nodeValues);
            if (typeof base !== "string" || typeof head !== "string" || base === head) {
                return invalidPreviewBinding("ef.relational-model.compare", "base/head");
            }
            const digest = crypto.createHash("sha256").update(`${base}\0${head}`).digest("hex");
            return {
                success: true,
                runMetrics: {
                    "ef.diffChangeCount": 2,
                    "ef.diffDestructiveCount": 0,
                    "ef.diffRenameCandidateCount": 0,
                    "ef.diffComparable": true,
                },
                message: "2 EF relational changes (deterministic preview)",
                output: {
                    contract: "efModelDiff/1",
                    columns: [
                        "recordType",
                        "kind",
                        "objectType",
                        "path",
                        "risk",
                        "changedProperties",
                        "candidateFrom",
                        "candidateTo",
                        "similarity",
                    ],
                    rows: [
                        [
                            "change",
                            "addTable",
                            "table",
                            "[dbo].[AuditLogs]",
                            "safe",
                            "",
                            null,
                            null,
                            null,
                        ],
                        [
                            "change",
                            "addColumn",
                            "column",
                            "[dbo].[Customers].[Email]",
                            "safe",
                            "",
                            null,
                            null,
                            null,
                        ],
                    ],
                    scalars: {
                        diffRef: `preview-ef-diff:${digest}`,
                        diffSha256: digest,
                        comparable: true,
                        changeCount: 2,
                        requiresRenameDecision: false,
                        potentialDataLoss: false,
                        preview: true,
                    },
                },
                values: {
                    diffRef: `preview-ef-diff:${digest}`,
                    diffSha256: digest,
                    comparable: true,
                    changeCount: 2,
                    requiresRenameDecision: false,
                    potentialDataLoss: false,
                },
            };
        }
        case "git.change-set.inspect": {
            const repository = resolveBind(node.inputs?.repository, parameterValues, nodeValues);
            const baseRef = resolveBind(node.inputs?.baseRef, parameterValues, nodeValues);
            const headRef = resolveBind(node.inputs?.headRef, parameterValues, nodeValues);
            const includeWorkingTree = resolveBind(
                node.inputs?.includeWorkingTree,
                parameterValues,
                nodeValues,
            );
            if (
                typeof repository !== "string" ||
                typeof baseRef !== "string" ||
                typeof headRef !== "string" ||
                typeof includeWorkingTree !== "boolean"
            ) {
                return invalidPreviewBinding(
                    "git.change-set.inspect",
                    "repository/baseRef/headRef/includeWorkingTree",
                );
            }
            return {
                success: true,
                runMetrics: {
                    "git.changedFileCount": 2,
                    "git.entityRelatedFileCount": 2,
                    "git.dirty": includeWorkingTree,
                    "git.includeWorkingTree": includeWorkingTree,
                },
                message: "2 repository files changed (deterministic preview)",
                output: {
                    contract: "gitChangeSet/1",
                    columns: ["status", "path", "previousPath", "entityRelated"],
                    rows: [
                        ["A", "src/Entities/AuditLog.cs", null, true],
                        ["M", "src/Entities/Order.cs", null, true],
                    ],
                    scalars: {
                        artifactPath: "preview://artifacts/changes.patch",
                        artifactSha256: "a".repeat(64),
                        artifactSizeBytes: 1024,
                        baseRef,
                        headRef,
                        changedFileCount: 2,
                        entityRelatedFileCount: 2,
                        dirty: includeWorkingTree,
                        preview: true,
                    },
                },
                values: {
                    artifactPath: "preview://artifacts/changes.patch",
                    artifactSha256: "a".repeat(64),
                    changedFileCount: 2,
                    entityRelatedFileCount: 2,
                    dirty: includeWorkingTree,
                },
            };
        }
        case "sqltest.discover":
            return {
                success: true,
                runMetrics: {
                    "tests.discovered": 2,
                    "tests.discoveredClassCount": 1,
                    "tests.scannedSqlFileCount": 2,
                    "tests.discoveryComplete": true,
                },
                message: "2 tSQLt tests discovered (deterministic preview)",
                output: {
                    contract: "testSuiteDiscovery/1",
                    columns: ["framework", "suite", "test", "repositoryPath", "line"],
                    rows: [
                        ["tSQLt", "OrderTests", "test total is correct", "tests/OrderTests.sql", 8],
                        [
                            "tSQLt",
                            "OrderTests",
                            "test customer is required",
                            "tests/OrderTests.sql",
                            24,
                        ],
                    ],
                    scalars: {
                        candidateSqlFileCount: 2,
                        scannedSqlFileCount: 2,
                        skippedOversizedFileCount: 0,
                        skippedByteBudgetFileCount: 0,
                        unsafePathFileCount: 0,
                        unreadableFileCount: 0,
                        scannedSourceBytes: 512,
                        tSqltClassCount: 1,
                        tSqltSourceFileCount: 1,
                        tSqltTestCount: 2,
                        duplicateDefinitionCount: 0,
                        complete: true,
                        truncated: false,
                        preview: true,
                    },
                },
                values: { tSqltClassCount: 1, tSqltTestCount: 2, complete: true },
            };
        case "dacpac.build": {
            const project = resolveBind(node.inputs?.project, parameterValues, nodeValues);
            if (typeof project !== "string" || project.length === 0) {
                return invalidPreviewBinding("dacpac.build", "project");
            }
            return {
                success: true,
                runMetrics: {
                    "build.artifactSizeBytes": 84 * 1024,
                    "build.diagnosticCount": 0,
                    "build.warningCount": 0,
                    "build.errorCount": 0,
                },
                diagnosticCounts: { warningCount: 0, errorCount: 0 },
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
        case "dacpac.extract": {
            const database = resolveBind(node.inputs?.database, parameterValues, nodeValues);
            if (typeof database !== "string" || database.length === 0) {
                return invalidPreviewBinding("dacpac.extract", "database");
            }
            return {
                success: true,
                runMetrics: {
                    "extract.artifactSizeBytes": 96 * 1024,
                    "extract.completed": true,
                },
                message: "Database DACPAC extracted (deterministic preview)",
                output: {
                    contract: "dacpacArtifact/1",
                    scalars: {
                        databaseName: "PreviewDatabase",
                        artifactPath: "preview://artifacts/PreviewDatabase.dacpac",
                        artifactSha256: "preview-extracted-artifact-sha256",
                        preview: true,
                    },
                },
                values: {
                    databaseName: "PreviewDatabase",
                    artifactPath: "preview://artifacts/PreviewDatabase.dacpac",
                    artifactSha256: "preview-extracted-artifact-sha256",
                },
            };
        }
        case "sql.container.provision": {
            const imageDigest = `sha256:${"a".repeat(64)}`;
            const environmentFingerprint = "b".repeat(64);
            const containerName = resolveBind(
                node.inputs?.containerName,
                parameterValues,
                nodeValues,
            );
            const databaseName = resolveBind(
                node.inputs?.databaseName,
                parameterValues,
                nodeValues,
            );
            const version = resolveBind(node.inputs?.version, parameterValues, nodeValues);
            const password = resolveBind(node.inputs?.password, parameterValues, nodeValues);
            if (
                typeof containerName !== "string" ||
                typeof databaseName !== "string" ||
                typeof version !== "string" ||
                typeof password !== "string"
            ) {
                return invalidPreviewBinding(
                    "sql.container.provision",
                    "containerName/databaseName/version/password",
                );
            }
            return {
                success: true,
                runMetrics: { "container.provisioned": true },
                message: "SQL container lease created (deterministic preview)",
                output: {
                    contract: "databaseLease/1",
                    scalars: {
                        leaseId: "preview-container-lease-001",
                        connectionRef: "preview://sql/container",
                        containerName,
                        databaseName,
                        version,
                        imageDigest,
                        environmentFingerprint,
                        port: 14330,
                        preview: true,
                    },
                },
                values: {
                    leaseId: "preview-container-lease-001",
                    connectionRef: "preview://sql/container",
                    containerName,
                    databaseName,
                    port: 14330,
                    version,
                    imageDigest,
                    environmentFingerprint,
                },
            };
        }
        case "sql.workload.inspect": {
            const file = resolveBind(node.inputs?.file, parameterValues, nodeValues);
            if (typeof file !== "string" || file.length === 0) {
                return invalidPreviewBinding("sql.workload.inspect", "file");
            }
            return {
                success: true,
                runMetrics: {
                    "workload.batchCount": 2,
                    "workload.sourceByteCount": 256,
                    "workload.mutating": true,
                },
                message: "SQL workload inspected (deterministic preview)",
                output: {
                    contract: "workloadPreview/1",
                    scalars: {
                        workloadRef: "preview://workload/001",
                        fileName: "workload.sql",
                        workloadSha256: "preview-workload-sha256",
                        workloadFingerprint: "d".repeat(64),
                        batchCount: 2,
                        mutating: true,
                        preview: true,
                    },
                },
                values: {
                    workloadRef: "preview://workload/001",
                    workloadSha256: "preview-workload-sha256",
                    workloadFingerprint: "d".repeat(64),
                    batchCount: 2,
                    mutating: true,
                },
            };
        }
        case "sql.workload.generate": {
            const workloadFingerprint = "c".repeat(64);
            const database = resolveBind(node.inputs?.database, parameterValues, nodeValues);
            const template = resolveBind(node.inputs?.template, parameterValues, nodeValues);
            const sampleRows = resolveBind(node.inputs?.sampleRows, parameterValues, nodeValues);
            const iterations = resolveBind(node.inputs?.iterations, parameterValues, nodeValues);
            if (
                typeof database !== "string" ||
                template !== "application-cities-shadow" ||
                typeof sampleRows !== "number" ||
                typeof iterations !== "number"
            ) {
                return invalidPreviewBinding(
                    "sql.workload.generate",
                    "database/template/sampleRows/iterations",
                );
            }
            return {
                success: true,
                runMetrics: {
                    "workload.generated": true,
                    "workload.sampleRowCount": sampleRows,
                    "workload.iterations": iterations,
                },
                message: "SQL workload generated (deterministic preview)",
                output: {
                    contract: "workloadArtifact/1",
                    text: "generated-cities-workload.sql",
                    scalars: {
                        workloadRef: "preview://workload/generated/001",
                        workloadSha256: "preview-generated-workload-sha256",
                        artifactPath: "preview://artifacts/generated-cities-workload.sql",
                        sampleRowCount: sampleRows,
                        iterations,
                        template,
                        workloadFingerprint,
                        preview: true,
                    },
                },
                values: {
                    workloadRef: "preview://workload/generated/001",
                    workloadSha256: "preview-generated-workload-sha256",
                    artifactPath: "preview://artifacts/generated-cities-workload.sql",
                    sampleRowCount: sampleRows,
                    iterations,
                    workloadFingerprint,
                },
            };
        }
        case "sandbox.provision":
        case "devdatabase.provision": {
            const sandbox = resolveBind(
                node.activityKind === "devdatabase.provision"
                    ? node.inputs?.server
                    : node.inputs?.sandbox,
                parameterValues,
                nodeValues,
            );
            if (typeof sandbox !== "string" || sandbox.length === 0) {
                return invalidPreviewBinding(node.activityKind, "server/sandbox");
            }
            const databaseName =
                node.activityKind === "devdatabase.provision"
                    ? resolveBind(node.inputs?.databaseName, parameterValues, nodeValues)
                    : "PreviewDatabase";
            if (typeof databaseName !== "string" || databaseName.length === 0) {
                return invalidPreviewBinding(node.activityKind, "databaseName");
            }
            return {
                success: true,
                runMetrics: { "sandbox.provisioned": true },
                message: "Ephemeral lease created (deterministic preview)",
                output: {
                    contract: "databaseLease/1",
                    scalars: {
                        leaseId: "preview-lease-001",
                        connectionRef: "preview://sql/sandbox",
                        databaseName,
                        preview: true,
                    },
                },
                values: {
                    leaseId: "preview-lease-001",
                    connectionRef: "preview://sql/sandbox",
                    databaseName,
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
                runMetrics: {
                    "deployment.previewChangeCount": 3,
                    "deployment.previewAlertCount": 0,
                },
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
        case "dacpac.deploy":
        case "dacpac.deploy.container":
        case "dacpac.deploy.dev": {
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
                    node.activityKind,
                    "dacpac/database/artifactDigest/previewDigest",
                );
            }
            return {
                success: true,
                runMetrics: {
                    "deployment.applied": true,
                    "deployment.postDeployChangeCount": 0,
                },
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
        case "sql.schema.apply": {
            const database = resolveBind(node.inputs?.database, parameterValues, nodeValues);
            const sql = resolveBind(node.inputs?.sql, parameterValues, nodeValues);
            const policy = validateLocalCreateTableSql(sql);
            if (typeof database !== "string" || !policy) {
                return invalidPreviewBinding("sql.schema.apply", "database/sql");
            }
            return {
                success: true,
                runMetrics: {
                    "schemaMutation.applied": true,
                    "schemaMutation.changedObjectCount": 1,
                },
                message: "CREATE TABLE applied (deterministic preview)",
                output: {
                    contract: "schemaMutationEvidence/1",
                    scalars: {
                        databaseName: "PreviewDatabase",
                        tableName: policy.qualifiedTableName,
                        sqlSha256: policy.sqlSha256,
                        changedObjectCount: 1,
                        preview: true,
                    },
                },
                values: {
                    applied: true,
                    tableName: policy.qualifiedTableName,
                    sqlSha256: policy.sqlSha256,
                },
            };
        }
        case "xevent.session.start": {
            const database = resolveBind(node.inputs?.database, parameterValues, nodeValues);
            const template = resolveBind(node.inputs?.template, parameterValues, nodeValues);
            if (typeof database !== "string" || template !== "developer-diagnostics") {
                return invalidPreviewBinding("xevent.session.start", "database/template");
            }
            return {
                success: true,
                runMetrics: { "xevent.sessionStarted": true },
                message: "XEvent session started (deterministic preview)",
                output: {
                    contract: "xeventSessionLease/1",
                    scalars: {
                        sessionRef: "preview://xevent/session/001",
                        sessionName: "rbs_xe_preview",
                        template,
                        preview: true,
                    },
                },
                values: {
                    sessionRef: "preview://xevent/session/001",
                    sessionName: "rbs_xe_preview",
                    template,
                },
            };
        }
        case "sql.workload.run": {
            const database = resolveBind(node.inputs?.database, parameterValues, nodeValues);
            const workload = resolveBind(node.inputs?.workload, parameterValues, nodeValues);
            const workloadDigest = resolveBind(
                node.inputs?.workloadDigest,
                parameterValues,
                nodeValues,
            );
            const repetitions = resolveBind(node.inputs?.repetitions, parameterValues, nodeValues);
            if (
                typeof database !== "string" ||
                typeof workload !== "string" ||
                typeof workloadDigest !== "string" ||
                typeof repetitions !== "number"
            ) {
                return invalidPreviewBinding(
                    "sql.workload.run",
                    "database/workload/workloadDigest",
                );
            }
            return {
                success: true,
                verdict: "pass",
                runMetrics: {
                    "workload.plannedBatchCount": 2,
                    "workload.executedBatchCount": 2,
                    "workload.failedBatchCount": 0,
                    "workload.totalDurationMs": 42,
                    "workload.measurementSampleCount": repetitions,
                    "workload.meanDurationMs": 42,
                    "workload.p95DurationMs": 44,
                },
                message: "SQL workload completed (deterministic preview)",
                output: {
                    contract: "workloadResults/1",
                    columns: [
                        "iteration",
                        "batch",
                        "durationMs",
                        "rowCount",
                        "succeeded",
                        "errorCode",
                    ],
                    rows: [
                        [1, 1, 20, 1, true, ""],
                        [1, 2, 22, 1, true, ""],
                    ],
                    scalars: {
                        workloadSha256: workloadDigest,
                        plannedBatchCount: 2,
                        executedBatchCount: 2,
                        failedBatchCount: 0,
                        totalDurationMs: 42,
                        repetitions,
                        measurementSampleCount: repetitions,
                        meanDurationMs: 42,
                        p50DurationMs: 42,
                        p95DurationMs: 44,
                        minDurationMs: 40,
                        maxDurationMs: 44,
                        standardDeviationMs: 1.5,
                        preview: true,
                    },
                },
                values: {
                    succeeded: true,
                    executedBatchCount: 2,
                    failedBatchCount: 0,
                    totalDurationMs: 42,
                    repetitions,
                    measurementSampleCount: repetitions,
                    meanDurationMs: 42,
                    p50DurationMs: 42,
                    p95DurationMs: 44,
                    minDurationMs: 40,
                    maxDurationMs: 44,
                    standardDeviationMs: 1.5,
                },
            };
        }
        case "xevent.session.stop": {
            const database = resolveBind(node.inputs?.database, parameterValues, nodeValues);
            const session = resolveBind(node.inputs?.session, parameterValues, nodeValues);
            if (typeof database !== "string" || typeof session !== "string") {
                return invalidPreviewBinding("xevent.session.stop", "database/session");
            }
            return {
                success: true,
                runMetrics: { "xevent.sessionStopped": true },
                message: "XEvent session stopped (deterministic preview)",
                output: {
                    contract: "xeventCapture/1",
                    scalars: {
                        captureRef: "preview://xevent/capture/001",
                        sessionName: "rbs_xe_preview",
                        eventFileName: "rbs_xe_preview.xel",
                        eventCount: 12,
                        preview: true,
                    },
                },
                values: {
                    captureRef: "preview://xevent/capture/001",
                    sessionName: "rbs_xe_preview",
                    eventFileName: "rbs_xe_preview.xel",
                    eventCount: 12,
                },
            };
        }
        case "xevent.xel.collect": {
            const database = resolveBind(node.inputs?.database, parameterValues, nodeValues);
            const capture = resolveBind(node.inputs?.capture, parameterValues, nodeValues);
            if (typeof database !== "string" || typeof capture !== "string") {
                return invalidPreviewBinding("xevent.xel.collect", "database/capture");
            }
            return {
                success: true,
                runMetrics: {
                    "xevent.artifactSizeBytes": 4096,
                    "xevent.eventCount": 12,
                    "xevent.captureComplete": true,
                },
                message: "XEL artifact collected (deterministic preview)",
                output: {
                    contract: "xelArtifact/1",
                    scalars: {
                        artifactPath: "preview://artifacts/rbs_xe_preview.xel",
                        artifactSizeBytes: 4096,
                        artifactSha256: "preview-xel-sha256",
                        eventCount: 12,
                        captureComplete: true,
                        preview: true,
                    },
                },
                values: {
                    artifactPath: "preview://artifacts/rbs_xe_preview.xel",
                    artifactSizeBytes: 4096,
                    artifactSha256: "preview-xel-sha256",
                    eventCount: 12,
                    captureComplete: true,
                },
            };
        }
        case "xevent.xel.analyze": {
            const database = resolveBind(node.inputs?.database, parameterValues, nodeValues);
            const capture = resolveBind(node.inputs?.capture, parameterValues, nodeValues);
            if (typeof database !== "string" || typeof capture !== "string") {
                return invalidPreviewBinding("xevent.xel.analyze", "database/capture");
            }
            return {
                success: true,
                runMetrics: {
                    "xevent.analyzedEventCount": 12,
                    "xevent.logicalReads": 180,
                    "xevent.physicalReads": 2,
                    "xevent.writes": 24,
                },
                message: "XEL metrics analyzed (deterministic preview)",
                output: {
                    contract: "xeventAnalysis/1",
                    columns: [
                        "timestampUtc",
                        "eventName",
                        "durationMs",
                        "cpuMs",
                        "logicalReads",
                        "physicalReads",
                        "writes",
                        "rowCount",
                        "objectName",
                        "errorNumber",
                    ],
                    rows: [
                        [
                            "2026-07-21T09:00:00Z",
                            "sql_batch_completed",
                            42,
                            8,
                            180,
                            2,
                            24,
                            2000,
                            "",
                            0,
                        ],
                    ],
                    scalars: {
                        eventCount: 12,
                        durationMs: 42,
                        cpuMs: 8,
                        logicalReads: 180,
                        physicalReads: 2,
                        writes: 24,
                        preview: true,
                    },
                },
                values: {
                    eventCount: 12,
                    durationMs: 42,
                    cpuMs: 8,
                    logicalReads: 180,
                    physicalReads: 2,
                    writes: 24,
                },
            };
        }
        case "database.schema.fingerprint": {
            const database = resolveBind(node.inputs?.database, parameterValues, nodeValues);
            if (typeof database !== "string") {
                return invalidPreviewBinding("database.schema.fingerprint", "database");
            }
            const schemaSha256 = "c".repeat(64);
            const schemaFingerprintRef = `preview://schema-fingerprint/${node.id}`;
            return {
                success: true,
                runMetrics: {
                    "schemaFingerprint.tableCount": 1,
                    "schemaFingerprint.complete": true,
                },
                message: "Complete schema fingerprint for 1 table (deterministic preview)",
                output: {
                    contract: "databaseSchemaFingerprint/1",
                    columns: ["property", "value"],
                    rows: [
                        ["tableCount", 1],
                        ["complete", true],
                        ["freshness", "fresh"],
                        ["provider", "deterministic-preview"],
                    ],
                    scalars: {
                        databaseName: "CitiesWorkload",
                        schemaSha256,
                        complete: true,
                        tableCount: 1,
                        capturedAtUtc: "2026-07-22T07:59:59.000Z",
                        provider: "deterministic-preview",
                        preview: true,
                    },
                },
                values: {
                    schemaSha256,
                    schemaFingerprintRef,
                    complete: true,
                    tableCount: 1,
                },
            };
        }
        case "performance.dmv.snapshot": {
            const database = resolveBind(node.inputs?.database, parameterValues, nodeValues);
            if (typeof database !== "string") {
                return invalidPreviewBinding("performance.dmv.snapshot", "database");
            }
            const capturedAtUtc = "2026-07-22T08:00:00.000Z";
            const snapshotSha256 = "d".repeat(64);
            const snapshotRef = `preview://performance-snapshot/${node.id}`;
            return {
                success: true,
                runMetrics: {
                    "performanceSnapshot.metricCount": 4,
                    "performanceSnapshot.totalMetricCount": 4,
                    "performanceSnapshot.databaseIoMetricCount": 2,
                    "performanceSnapshot.waitMetricCount": 2,
                    "performanceSnapshot.queryMetricCount": 0,
                    "performanceSnapshot.activeRequestMetricCount": 0,
                    "performanceSnapshot.truncated": false,
                },
                message: "4 SQL Server performance metrics (deterministic preview)",
                output: {
                    contract: "performanceSnapshot/1",
                    columns: [
                        "capturedAtUtc",
                        "scope",
                        "category",
                        "item",
                        "metric",
                        "value",
                        "unit",
                    ],
                    rows: [
                        [
                            capturedAtUtc,
                            "database",
                            "database_io",
                            "ROWS:CitiesWorkload",
                            "reads",
                            42,
                            "count",
                        ],
                        [
                            capturedAtUtc,
                            "database",
                            "database_io",
                            "ROWS:CitiesWorkload",
                            "bytes_read",
                            344064,
                            "bytes",
                        ],
                        [
                            capturedAtUtc,
                            "server",
                            "server_waits_cumulative",
                            "WRITELOG",
                            "wait_time",
                            12,
                            "ms",
                        ],
                        [
                            capturedAtUtc,
                            "server",
                            "server_waits_cumulative",
                            "WRITELOG",
                            "waiting_tasks",
                            4,
                            "count",
                        ],
                    ],
                    scalars: {
                        capturedAtUtc,
                        metricCount: 4,
                        totalMetricCount: 4,
                        snapshotSha256,
                        snapshotRef,
                        truncated: false,
                        interpretation:
                            "Point-in-time and cumulative counters; no regression verdict.",
                        preview: true,
                    },
                },
                values: {
                    capturedAtUtc,
                    metricCount: 4,
                    totalMetricCount: 4,
                    snapshotSha256,
                    snapshotRef,
                    truncated: false,
                },
            };
        }
        case "performance.dmv.delta": {
            const database = resolveBind(node.inputs?.database, parameterValues, nodeValues);
            const before = resolveBind(node.inputs?.before, parameterValues, nodeValues);
            const after = resolveBind(node.inputs?.after, parameterValues, nodeValues);
            const beforeSchema = resolveBind(
                node.inputs?.beforeSchema,
                parameterValues,
                nodeValues,
            );
            const afterSchema = resolveBind(node.inputs?.afterSchema, parameterValues, nodeValues);
            if (
                typeof database !== "string" ||
                typeof before !== "string" ||
                typeof after !== "string" ||
                typeof beforeSchema !== "string" ||
                typeof afterSchema !== "string" ||
                before === after ||
                beforeSchema === afterSchema
            ) {
                return invalidPreviewBinding(
                    "performance.dmv.delta",
                    "database/before/after/beforeSchema/afterSchema",
                );
            }
            const deltaSha256 = "e".repeat(64);
            return {
                success: true,
                runMetrics: {
                    "performanceDelta.metricCount": 2,
                    "performanceDelta.comparableMetricCount": 2,
                    "performanceDelta.incompleteMetricCount": 0,
                    "performanceDelta.counterResetMetricCount": 0,
                    "performanceDelta.inputTruncated": false,
                    "performanceDelta.truncated": false,
                    "performanceDelta.schemaComparable": true,
                },
                message: "2 comparable performance metric deltas (deterministic preview)",
                output: {
                    contract: "performanceDelta/1",
                    columns: [
                        "scope",
                        "category",
                        "item",
                        "metric",
                        "unit",
                        "beforeValue",
                        "afterValue",
                        "deltaValue",
                        "comparability",
                    ],
                    rows: [
                        [
                            "database",
                            "database_io",
                            "ROWS:CitiesWorkload",
                            "reads",
                            "count",
                            10,
                            52,
                            42,
                            "comparable",
                        ],
                        [
                            "server",
                            "server_waits_cumulative",
                            "WRITELOG",
                            "wait_time",
                            "ms",
                            4,
                            12,
                            8,
                            "comparable",
                        ],
                    ],
                    scalars: {
                        beforeSnapshotSha256: "d".repeat(64),
                        afterSnapshotSha256: "d".repeat(64),
                        deltaSha256,
                        metricCount: 2,
                        comparableMetricCount: 2,
                        incompleteMetricCount: 0,
                        counterResetMetricCount: 0,
                        beforeSchemaSha256: "c".repeat(64),
                        afterSchemaSha256: "c".repeat(64),
                        schemaComparability: "same",
                        inputTruncated: false,
                        truncated: false,
                        verdict: "notEvaluated",
                        preview: true,
                    },
                },
                values: {
                    deltaSha256,
                    metricCount: 2,
                    comparableMetricCount: 2,
                    incompleteMetricCount: 0,
                    counterResetMetricCount: 0,
                    schemaComparability: "same",
                    inputTruncated: false,
                    truncated: false,
                },
            };
        }
        case "workload.benchmark": {
            const workloadFingerprint = resolveBind(
                node.inputs?.workloadFingerprint,
                parameterValues,
                nodeValues,
            );
            const environmentFingerprint = resolveBind(
                node.inputs?.environmentFingerprint,
                parameterValues,
                nodeValues,
            );
            const durationMs = resolveBind(
                node.inputs?.workloadDurationMs,
                parameterValues,
                nodeValues,
            );
            const executedBatchCount = resolveBind(
                node.inputs?.executedBatchCount,
                parameterValues,
                nodeValues,
            );
            const failedBatchCount = resolveBind(
                node.inputs?.failedBatchCount,
                parameterValues,
                nodeValues,
            );
            const repetitions = resolveBind(node.inputs?.repetitions, parameterValues, nodeValues);
            const measurementSampleCount = resolveBind(
                node.inputs?.measurementSampleCount,
                parameterValues,
                nodeValues,
            );
            const meanDurationMs = resolveBind(
                node.inputs?.meanDurationMs,
                parameterValues,
                nodeValues,
            );
            const p50DurationMs = resolveBind(
                node.inputs?.p50DurationMs,
                parameterValues,
                nodeValues,
            );
            const p95DurationMs = resolveBind(
                node.inputs?.p95DurationMs,
                parameterValues,
                nodeValues,
            );
            const minDurationMs = resolveBind(
                node.inputs?.minDurationMs,
                parameterValues,
                nodeValues,
            );
            const maxDurationMs = resolveBind(
                node.inputs?.maxDurationMs,
                parameterValues,
                nodeValues,
            );
            const standardDeviationMs = resolveBind(
                node.inputs?.standardDeviationMs,
                parameterValues,
                nodeValues,
            );
            if (
                typeof workloadFingerprint !== "string" ||
                typeof environmentFingerprint !== "string" ||
                typeof durationMs !== "number" ||
                typeof executedBatchCount !== "number" ||
                typeof failedBatchCount !== "number" ||
                typeof repetitions !== "number" ||
                typeof measurementSampleCount !== "number" ||
                typeof meanDurationMs !== "number" ||
                typeof p50DurationMs !== "number" ||
                typeof p95DurationMs !== "number" ||
                typeof minDurationMs !== "number" ||
                typeof maxDurationMs !== "number" ||
                typeof standardDeviationMs !== "number"
            ) {
                return invalidPreviewBinding(
                    "workload.benchmark",
                    "workloadDurationMs/executedBatchCount/failedBatchCount",
                );
            }
            return {
                success: failedBatchCount === 0,
                verdict: failedBatchCount === 0 ? "pass" : "fail",
                message: "Workload metrics summarized (deterministic preview)",
                output: {
                    contract: "performanceMetrics/1",
                    columns: ["metric", "value", "unit"],
                    rows: [
                        ["Workload duration", durationMs, "ms"],
                        ["Executed batches", executedBatchCount, "count"],
                        ["Failed batches", failedBatchCount, "count"],
                        ["Measured repetitions", measurementSampleCount, "count"],
                        ["Mean repetition duration", meanDurationMs, "ms"],
                        ["P50 repetition duration", p50DurationMs, "ms"],
                        ["P95 repetition duration", p95DurationMs, "ms"],
                        ["Minimum repetition duration", minDurationMs, "ms"],
                        ["Maximum repetition duration", maxDurationMs, "ms"],
                        ["Duration standard deviation", standardDeviationMs, "ms"],
                    ],
                    scalars: {
                        durationMs,
                        executedBatchCount,
                        failedBatchCount,
                        workloadFingerprint,
                        environmentFingerprint,
                        repetitions,
                        measurementSampleCount,
                        meanDurationMs,
                        p50DurationMs,
                        p95DurationMs,
                        minDurationMs,
                        maxDurationMs,
                        standardDeviationMs,
                        preview: true,
                    },
                },
                values: {
                    durationMs,
                    executedBatchCount,
                    failedBatchCount,
                    workloadFingerprint,
                    environmentFingerprint,
                    repetitions,
                    measurementSampleCount,
                    meanDurationMs,
                    p50DurationMs,
                    p95DurationMs,
                    minDurationMs,
                    maxDurationMs,
                    standardDeviationMs,
                },
            };
        }
        case "sql.container.dispose": {
            const database = resolveBind(node.inputs?.database, parameterValues, nodeValues);
            if (typeof database !== "string") {
                return invalidPreviewBinding("sql.container.dispose", "database");
            }
            return {
                success: true,
                runMetrics: { "container.cleanupCompleted": true },
                message: "SQL container removed (deterministic preview)",
                output: {
                    contract: "cleanupEvidence/1",
                    scalars: { cleaned: true, preview: true },
                },
                values: { cleaned: true },
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
                runMetrics: {
                    "schema.alertCount": 0,
                    "schema.changeCount": 0,
                    "schema.matches": true,
                },
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
        case "database.schema.inventory": {
            const database = resolveBind(node.inputs?.database, parameterValues, nodeValues);
            if (typeof database !== "string") {
                return invalidPreviewBinding("database.schema.inventory", "database");
            }
            return {
                success: true,
                runMetrics: {
                    "schemaInventory.objectCount": 3,
                    "schemaInventory.truncated": false,
                },
                message: "3 schema objects inventoried (deterministic preview)",
                output: {
                    contract: "databaseSchemaInventory/1",
                    columns: ["ObjectType", "SchemaName", "ObjectName"],
                    rows: [
                        ["Table", "dbo", "PreviewTable"],
                        ["View", "dbo", "PreviewView"],
                        ["Stored procedure", "dbo", "PreviewProcedure"],
                    ],
                    scalars: { objectCount: 3, truncated: false, preview: true },
                },
                values: { objectCount: 3, truncated: false },
            };
        }
        case "schema.compare.export": {
            const dacpac = resolveBind(node.inputs?.dacpac, parameterValues, nodeValues);
            const database = resolveBind(node.inputs?.database, parameterValues, nodeValues);
            if (typeof dacpac !== "string" || typeof database !== "string") {
                return invalidPreviewBinding("schema.compare.export", "dacpac/database");
            }
            return {
                success: true,
                runMetrics: {
                    "schema.alertCount": 0,
                    "schema.changeCount": 1,
                    "schema.matches": false,
                    "schema.exported": true,
                    "schema.exportSizeBytes": 512,
                },
                message: "Schema comparison report exported (deterministic preview)",
                output: {
                    contract: "schemaCompareDocument/1",
                    text: JSON.stringify({
                        schemaVersion: 1,
                        source: { kind: "dacpac", label: "Preview.dacpac" },
                        target: { kind: "database", label: "PreviewDatabase" },
                        areEqual: false,
                        totalDifferences: 1,
                        items: [
                            {
                                id: "difference-1",
                                action: "add",
                                objectType: "Table",
                                targetName: "dbo.PreviewTable",
                                targetSql: "CREATE TABLE [dbo].[PreviewTable] ([Id] int NOT NULL);",
                            },
                        ],
                        truncated: false,
                        omittedCount: 0,
                        provider: { kind: "deterministic-preview", contractVersion: 1 },
                    }),
                    scalars: {
                        matches: false,
                        changeCount: 1,
                        reportSha256: "preview-schema-report-sha256",
                        artifactPath: "preview://artifacts/schema-comparison.xml",
                        artifactSha256: "preview-schema-report-sha256",
                        preview: true,
                    },
                },
                values: {
                    matches: false,
                    changeCount: 1,
                    reportSha256: "preview-schema-report-sha256",
                    artifactPath: "preview://artifacts/schema-comparison.xml",
                    artifactSha256: "preview-schema-report-sha256",
                },
            };
        }
        case "database.schema.visualize": {
            const database = resolveBind(node.inputs?.database, parameterValues, nodeValues);
            if (typeof database !== "string") {
                return invalidPreviewBinding("database.schema.visualize", "database");
            }
            return {
                success: true,
                runMetrics: {
                    "schemaGraph.totalTables": 2,
                    "schemaGraph.renderedTables": 2,
                    "schemaGraph.relationships": 1,
                    "schemaGraph.truncated": false,
                },
                message: "Schema diagram created (deterministic preview)",
                output: {
                    contract: "databaseSchemaGraph/1",
                    text: JSON.stringify({
                        schemaVersion: 1,
                        databaseLabel: "PreviewDatabase",
                        totalTables: 2,
                        tables: [
                            {
                                id: "table:1",
                                schema: "dbo",
                                name: "Parent",
                                totalColumns: 1,
                                columns: [
                                    {
                                        id: "column:1:1",
                                        name: "Id",
                                        typeDisplay: "int",
                                        nullable: false,
                                        isPrimaryKey: true,
                                        isForeignKey: false,
                                        isIdentity: true,
                                        isComputed: false,
                                    },
                                ],
                                columnsTruncated: false,
                            },
                            {
                                id: "table:2",
                                schema: "dbo",
                                name: "Child",
                                totalColumns: 1,
                                columns: [
                                    {
                                        id: "column:2:1",
                                        name: "ParentId",
                                        typeDisplay: "int",
                                        nullable: false,
                                        isPrimaryKey: false,
                                        isForeignKey: true,
                                        isIdentity: false,
                                        isComputed: false,
                                    },
                                ],
                                columnsTruncated: false,
                            },
                        ],
                        relationships: [
                            {
                                id: "fk:3",
                                name: "FK_Child_Parent",
                                sourceTableId: "table:2",
                                targetTableId: "table:1",
                                columnPairs: [{ fromColumnName: "ParentId", toColumnName: "Id" }],
                                onDeleteLabel: "NO_ACTION",
                                onUpdateLabel: "NO_ACTION",
                            },
                        ],
                        omittedTableCount: 0,
                        omittedRelationshipCount: 0,
                        danglingRelationshipCount: 0,
                        truncated: false,
                        freshness: {
                            source: "live",
                            freshness: "fresh",
                            validation: "full",
                        },
                        provider: { kind: "deterministic-preview", contractVersion: 1 },
                    }),
                    scalars: {
                        totalTables: 2,
                        renderedTables: 2,
                        relationshipCount: 1,
                        truncated: false,
                        preview: true,
                    },
                },
                values: {
                    totalTables: 2,
                    renderedTables: 2,
                    relationshipCount: 1,
                    truncated: false,
                },
            };
        }
        case "sqltest.run": {
            const database = resolveBind(node.inputs?.database, parameterValues, nodeValues);
            const sql = resolveBind(node.inputs?.sql, parameterValues, nodeValues);
            if (typeof database !== "string" || typeof sql !== "string") {
                return invalidPreviewBinding("sqltest.run", "database/sql");
            }
            return {
                success: true,
                verdict: "pass",
                runMetrics: {
                    "sqlTests.total": 2,
                    "sqlTests.passed": 2,
                    "sqlTests.failed": 0,
                    "sqlTests.allPassed": true,
                },
                message: "2 SQL tests passed (deterministic preview)",
                output: {
                    contract: "testResults/1",
                    columns: ["name", "passed", "message"],
                    rows: [
                        ["Owned sandbox target", true, "Ownership marker is present"],
                        ["DACPAC convergence", true, "No remaining schema changes"],
                    ],
                    scalars: {
                        total: 2,
                        passed: 2,
                        failed: 0,
                        allPassed: true,
                        preview: true,
                    },
                },
                values: { total: 2, passed: 2, failed: 0, allPassed: true },
            };
        }
        case "tsqlt.run": {
            const database = resolveBind(node.inputs?.database, parameterValues, nodeValues);
            const suite = resolveBind(node.inputs?.suite, parameterValues, nodeValues);
            const test = resolveBind(node.inputs?.test, parameterValues, nodeValues);
            if (
                typeof database !== "string" ||
                (suite !== undefined && typeof suite !== "string") ||
                (test !== undefined && typeof test !== "string") ||
                (typeof test === "string" && typeof suite !== "string")
            ) {
                return invalidPreviewBinding("tsqlt.run", "database/suite/test");
            }
            return {
                success: true,
                verdict: "pass",
                runMetrics: {
                    "tsqlt.total": 2,
                    "tsqlt.passed": 2,
                    "tsqlt.failed": 0,
                    "tsqlt.errors": 0,
                    "tsqlt.skipped": 0,
                    "tsqlt.allPassed": true,
                },
                message: "2 tSQLt tests passed (deterministic preview)",
                output: {
                    contract: "testResults/1",
                    columns: ["suite", "test", "result", "message", "durationMs"],
                    rows: [
                        ["OrderTests", "test total is correct", "passed", "", 12],
                        ["OrderTests", "test customer is required", "passed", "", 9],
                    ],
                    scalars: {
                        total: 2,
                        passed: 2,
                        failed: 0,
                        errors: 0,
                        skipped: 0,
                        allPassed: true,
                        truncatedMessageCount: 0,
                        preview: true,
                    },
                },
                values: {
                    total: 2,
                    passed: 2,
                    failed: 0,
                    errors: 0,
                    skipped: 0,
                    allPassed: true,
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
                runMetrics: { "cleanup.completed": true },
                message: "Ephemeral lease disposed (deterministic preview)",
                output: {
                    contract: "cleanupEvidence/1",
                    scalars: { cleaned: true, preview: true },
                },
                values: { cleaned: true },
            };
        }
        case "evidence.bundle": {
            const bundle = buildLocalEvidenceBundle({
                ...evidenceContext,
                runtimeKind: "fake",
                toolchain: FAKE_TOOLCHAIN,
                generatedAtUtc: "1970-01-01T00:00:00.000Z",
            });
            return {
                success: true,
                runMetrics: {
                    "evidence.nodeCount": bundle.nodeCount,
                    "evidence.passedNodeCount": bundle.passedNodeCount,
                    "evidence.failedNodeCount": bundle.failedNodeCount,
                    "evidence.handleCount": bundle.evidenceHandleCount,
                    "evidence.verdict": bundle.verdict,
                },
                verdict: bundle.verdict === "pass" ? "pass" : "fail",
                message: "Evidence manifest assembled (deterministic preview)",
                output: {
                    contract: "evidenceBundle/1",
                    text: bundle.manifestJson,
                    scalars: {
                        bundleSha256: bundle.bundleSha256,
                        nodeCount: bundle.nodeCount,
                        verdict: bundle.verdict,
                        preview: true,
                    },
                },
                values: {
                    bundleSha256: bundle.bundleSha256,
                    nodeCount: bundle.nodeCount,
                    verdict: bundle.verdict,
                },
            };
        }
        case "sql.query.read": {
            return {
                success: true,
                runMetrics: { "query.rowCount": FIXTURE_ROWS.length },
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
                runMetrics: {
                    "assertions.passed": pass ? 1 : 0,
                    "assertions.failed": pass ? 0 : 1,
                },
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
        // Parameter validation already preserves the declared type. Numeric
        // enum and string values (for example SQL Server version "2025")
        // must not be silently converted into numbers at execution time.
        return parameterValues[paramMatch[1]] ?? undefined;
    }
    const nodeMatch = /^\$nodes\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(input);
    if (nodeMatch) {
        return nodeValues.get(nodeMatch[1])?.[nodeMatch[2]];
    }
    return input;
}
