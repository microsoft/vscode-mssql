/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Local activity delegate (the "local" runtime lane): executes read-only SQL
 * through the extension-owned connection path and developer build activities
 * through native VS Code workspace/task services. Guardrails:
 *   - only single read-only SELECT/WITH statements execute (a policy engine
 *     replaces this conservative check in RBS2-13, but the refusal is
 *     visible and typed, never silent);
 *   - the connection binds by PROFILE ID (an opaque host handle — plans
 *     never carry connection strings or credentials);
 *   - each activity connects on a private runbook URI and disconnects in
 *     finally, so runs never leak sessions.
 */

import type * as mssql from "vscode-mssql";
import { RunbookStudio as LocRunbookStudio } from "../../constants/locConstants";
import { RunbookPlanNode } from "../../sharedInterfaces/runbookStudio";
import { isReadOnlySql } from "../readOnlySql";
import {
    ActivityExecutionDelegate,
    ActivityInvocationIdentity,
    NodeExecution,
} from "./fakeRuntimeAdapter";

export { isReadOnlySql } from "../readOnlySql";

/** Injected host operations (real implementations wire ConnectionManager +
 *  SqlToolsServiceClient; tests inject fakes). */
export interface LocalSqlOperations {
    connect(profileId: string, ownerUri: string): Promise<boolean>;
    execute(
        ownerUri: string,
        sql: string,
        cancellationToken?: import("vscode").CancellationToken,
    ): Promise<mssql.SimpleExecuteResult>;
    disconnect(ownerUri: string): Promise<void>;
    inspectWorkspace(): Promise<LocalWorkspaceSnapshot>;
    buildDacpac(
        projectPath: string,
        isCancellationRequested: () => boolean,
    ): Promise<LocalDacpacBuildResult>;
    previewDacpacDeployment(
        dacpacPath: string,
        databaseRef: string,
        isCancellationRequested: () => boolean,
    ): Promise<LocalDeploymentPreviewResult>;
    provisionSandbox(
        nodeId: string,
        baseConnectionRef: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalSandboxLeaseResult>;
    disposeSandbox(
        nodeId: string,
        leaseRef: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalSandboxCleanupResult>;
}

export interface LocalWorkspaceSnapshot {
    workspaceFolderCount: number;
    /** Absolute, workspace-contained project paths in stable sort order. */
    projectPaths: string[];
    truncated?: boolean;
}

export interface LocalDacpacBuildResult {
    projectPath: string;
    artifactPath: string;
    artifactSizeBytes: number;
    artifactSha256: string;
    diagnosticCount: number;
    builtAtUtc: string;
}

export interface LocalDeploymentPreviewResult {
    dacpacPath: string;
    targetDatabase: string;
    operationId: string;
    changeCount: number;
    alertCount: number;
    operationSummary: string;
    reportSha256: string;
    /** Bounded XML projection; the SHA-256 covers the complete report. */
    reportXml: string;
    reportTruncated: boolean;
    generatedAtUtc: string;
}

export interface LocalSandboxLeaseResult {
    effectId: string;
    leaseId: string;
    connectionRef: string;
    databaseName: string;
    createdAtUtc: string;
}

export interface LocalSandboxCleanupResult {
    effectId: string;
    leaseId: string;
    databaseName: string;
    cleaned: boolean;
    cleanedAtUtc: string;
    cleanupEvidenceDigest: string;
}

/** Expected host refusal with a stable, non-secret error classification. */
export class LocalActivityError extends Error {
    constructor(
        message: string,
        public readonly errorCode: string,
    ) {
        super(message);
        this.name = "LocalActivityError";
    }
}

const MAX_STORED_ROWS = 5000;

let queryCounter = 0;

export class LocalSqlActivityDelegate implements ActivityExecutionDelegate {
    public readonly runtimeKind = "local" as const;
    public readonly supportedActivityKinds = new Set([
        "workspace.inspect",
        "dacpac.build",
        "sandbox.provision",
        "dacpac.deploy.preview",
        "sandbox.dispose",
        "sql.query.read",
    ]);

    constructor(private readonly operations: LocalSqlOperations) {}

    public async executeActivity(
        node: RunbookPlanNode,
        binding: {
            parameterValues: Record<string, string | number | boolean | null>;
            resolveBind: (input: unknown) => unknown;
            isCancellationRequested: () => boolean;
            invocation: ActivityInvocationIdentity;
        },
    ): Promise<NodeExecution | undefined> {
        switch (node.activityKind) {
            case "workspace.inspect":
                return this.inspectWorkspace();
            case "dacpac.build":
                return this.buildDacpac(node, binding);
            case "sandbox.provision":
                return this.provisionSandbox(node, binding);
            case "dacpac.deploy.preview":
                return this.previewDacpacDeployment(node, binding);
            case "sandbox.dispose":
                return this.disposeSandbox(node, binding);
            case "sql.query.read":
                return this.executeSql(node, binding);
            default:
                return undefined;
        }
    }

    private async inspectWorkspace(): Promise<NodeExecution> {
        try {
            const snapshot = await this.operations.inspectWorkspace();
            const projectPaths = [...snapshot.projectPaths].sort((left, right) =>
                left.localeCompare(right),
            );
            return {
                success: true,
                message: LocRunbookStudio.workspaceProjectsFound(projectPaths.length),
                output: {
                    contract: "workspaceSnapshot/1",
                    scalars: {
                        workspaceFolderCount: snapshot.workspaceFolderCount,
                        projectCount: projectPaths.length,
                        projectPaths: projectPaths.join("\n") || "(none)",
                        truncated: snapshot.truncated === true,
                        executionMode: "local",
                    },
                },
                values: { projectCount: projectPaths.length },
            };
        } catch (error) {
            return activityFailure(error);
        }
    }

    private async buildDacpac(
        node: RunbookPlanNode,
        binding: {
            resolveBind: (input: unknown) => unknown;
            isCancellationRequested: () => boolean;
        },
    ): Promise<NodeExecution> {
        const projectPath = binding.resolveBind(node.inputs?.project);
        if (typeof projectPath !== "string" || projectPath.trim().length === 0) {
            return {
                success: false,
                message: LocRunbookStudio.parameterRequired("project"),
                errorCode: "RunbookStudio.BindingInvalid",
            };
        }
        try {
            const result = await this.operations.buildDacpac(
                projectPath.trim(),
                binding.isCancellationRequested,
            );
            return {
                success: true,
                message: LocRunbookStudio.dacpacBuilt(result.artifactPath, result.diagnosticCount),
                output: {
                    contract: "dacpacArtifact/1",
                    scalars: {
                        projectPath: result.projectPath,
                        artifactPath: result.artifactPath,
                        artifactSizeBytes: result.artifactSizeBytes,
                        artifactSha256: result.artifactSha256,
                        diagnosticCount: result.diagnosticCount,
                        builtAtUtc: result.builtAtUtc,
                        executionMode: "local",
                    },
                },
                values: {
                    artifactPath: result.artifactPath,
                    diagnosticCount: result.diagnosticCount,
                },
            };
        } catch (error) {
            return activityFailure(error);
        }
    }

    private async executeSql(
        node: RunbookPlanNode,
        binding: { resolveBind: (input: unknown) => unknown },
    ): Promise<NodeExecution> {
        const profileId = binding.resolveBind(node.inputs?.connection);
        if (typeof profileId !== "string" || profileId.length === 0) {
            return {
                success: false,
                message: LocRunbookStudio.parameterRequired("connection"),
                errorCode: "RunbookStudio.BindingInvalid",
            };
        }
        const sql = binding.resolveBind(node.inputs?.sql);
        if (typeof sql !== "string" || sql.trim().length === 0) {
            return {
                success: false,
                message: LocRunbookStudio.parameterRequired("sql"),
                errorCode: "RunbookStudio.BindingInvalid",
            };
        }
        if (!isReadOnlySql(sql)) {
            return {
                success: false,
                message: LocRunbookStudio.sqlNotReadOnly,
                errorCode: "RunbookStudio.ActivityPolicyDenied",
            };
        }

        queryCounter++;
        const ownerUri = `runbookstudio://query/${queryCounter.toString(36)}/${node.id}`;
        let connected = false;
        try {
            connected = await this.operations.connect(profileId, ownerUri);
            if (!connected) {
                return {
                    success: false,
                    message: LocRunbookStudio.connectFailed,
                    errorCode: "RunbookStudio.ActivityFailed",
                };
            }
            const result = await this.operations.execute(ownerUri, sql);
            const rows = (result.rows ?? [])
                .slice(0, MAX_STORED_ROWS)
                .map((row) => row.map((cell) => (cell.isNull ? null : cell.displayValue)));
            return {
                success: true,
                message: `${result.rowCount} rows`,
                output: {
                    contract: "rowset/1",
                    columns: (result.columnInfo ?? []).map((column) => column.columnName),
                    rows,
                },
                values: { rowCount: result.rowCount },
            };
        } finally {
            if (connected) {
                try {
                    await this.operations.disconnect(ownerUri);
                } catch {
                    // best-effort cleanup; the run outcome is already decided
                }
            }
        }
    }

    private async previewDacpacDeployment(
        node: RunbookPlanNode,
        binding: {
            resolveBind: (input: unknown) => unknown;
            isCancellationRequested: () => boolean;
        },
    ): Promise<NodeExecution> {
        const dacpacPath = binding.resolveBind(node.inputs?.dacpac);
        const databaseRef = binding.resolveBind(node.inputs?.database);
        if (typeof dacpacPath !== "string" || dacpacPath.trim().length === 0) {
            return {
                success: false,
                message: LocRunbookStudio.parameterRequired("dacpac"),
                errorCode: "RunbookStudio.BindingInvalid",
            };
        }
        if (typeof databaseRef !== "string" || databaseRef.trim().length === 0) {
            return {
                success: false,
                message: LocRunbookStudio.parameterRequired("database"),
                errorCode: "RunbookStudio.BindingInvalid",
            };
        }
        try {
            const result = await this.operations.previewDacpacDeployment(
                dacpacPath.trim(),
                databaseRef.trim(),
                binding.isCancellationRequested,
            );
            return {
                success: true,
                message: LocRunbookStudio.dacpacPreviewGenerated(
                    result.changeCount,
                    result.alertCount,
                ),
                output: {
                    contract: "deploymentPreview/1",
                    text: result.reportXml,
                    scalars: {
                        dacpacPath: result.dacpacPath,
                        targetDatabase: result.targetDatabase,
                        operationId: result.operationId,
                        changeCount: result.changeCount,
                        alertCount: result.alertCount,
                        operationSummary: result.operationSummary,
                        reportSha256: result.reportSha256,
                        reportTruncated: result.reportTruncated,
                        generatedAtUtc: result.generatedAtUtc,
                        executionMode: "local",
                    },
                },
                values: {
                    changeCount: result.changeCount,
                    reportSha256: result.reportSha256,
                },
            };
        } catch (error) {
            return activityFailure(error);
        }
    }

    private async provisionSandbox(
        node: RunbookPlanNode,
        binding: {
            resolveBind: (input: unknown) => unknown;
            isCancellationRequested: () => boolean;
            invocation: ActivityInvocationIdentity;
        },
    ): Promise<NodeExecution> {
        const baseConnectionRef = binding.resolveBind(node.inputs?.sandbox);
        if (typeof baseConnectionRef !== "string" || baseConnectionRef.trim().length === 0) {
            return {
                success: false,
                message: LocRunbookStudio.parameterRequired("sandbox"),
                errorCode: "RunbookStudio.BindingInvalid",
            };
        }
        try {
            const result = await this.operations.provisionSandbox(
                node.id,
                baseConnectionRef.trim(),
                binding.invocation,
                binding.isCancellationRequested,
            );
            return {
                success: true,
                message: LocRunbookStudio.sandboxProvisioned(result.databaseName),
                output: {
                    contract: "databaseLease/1",
                    scalars: {
                        leaseId: result.leaseId,
                        connectionRef: result.connectionRef,
                        databaseName: result.databaseName,
                        effectId: result.effectId,
                        createdAtUtc: result.createdAtUtc,
                        executionMode: "local",
                    },
                },
                values: {
                    leaseId: result.leaseId,
                    connectionRef: result.connectionRef,
                },
            };
        } catch (error) {
            return activityFailure(error);
        }
    }

    private async disposeSandbox(
        node: RunbookPlanNode,
        binding: {
            resolveBind: (input: unknown) => unknown;
            isCancellationRequested: () => boolean;
            invocation: ActivityInvocationIdentity;
        },
    ): Promise<NodeExecution> {
        const leaseRef = binding.resolveBind(node.inputs?.database);
        if (typeof leaseRef !== "string" || leaseRef.trim().length === 0) {
            return {
                success: false,
                message: LocRunbookStudio.parameterRequired("database"),
                errorCode: "RunbookStudio.BindingInvalid",
            };
        }
        try {
            const result = await this.operations.disposeSandbox(
                node.id,
                leaseRef.trim(),
                binding.invocation,
                binding.isCancellationRequested,
            );
            return {
                success: true,
                message: LocRunbookStudio.sandboxDisposed(result.databaseName),
                output: {
                    contract: "cleanupEvidence/1",
                    scalars: {
                        effectId: result.effectId,
                        leaseId: result.leaseId,
                        databaseName: result.databaseName,
                        cleaned: result.cleaned,
                        cleanedAtUtc: result.cleanedAtUtc,
                        cleanupEvidenceDigest: result.cleanupEvidenceDigest,
                        executionMode: "local",
                    },
                },
                values: { cleaned: result.cleaned },
            };
        } catch (error) {
            return activityFailure(error);
        }
    }
}

function activityFailure(error: unknown): NodeExecution {
    return {
        success: false,
        message: error instanceof Error ? error.message : "activity failed",
        errorCode:
            error instanceof LocalActivityError ? error.errorCode : "RunbookStudio.ActivityFailed",
    };
}
