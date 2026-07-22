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

import * as vscode from "vscode";
import type * as mssql from "vscode-mssql";
import { RunbookStudio as LocRunbookStudio } from "../../constants/locConstants";
import { RunbookPlanNode } from "../../sharedInterfaces/runbookStudio";
import { isReadOnlySql } from "../readOnlySql";
import {
    ActivityExecutionDelegate,
    ActivityInvocationIdentity,
    NodeExecution,
} from "./fakeRuntimeAdapter";
import type { LocalEvidenceBundleResult } from "./localEvidenceBundle";
import { validateLocalCreateTableSql } from "../schemaMutationPolicy";
import {
    LocalTsqltContractError,
    LocalTsqltSelection,
    normalizeLocalTsqltSelection,
    parseLocalTsqltResult,
} from "./localTsqlt";
import {
    LOCAL_XEVENT_TEMPLATE,
    MAX_LOCAL_XEL_FILE_SIZE_MB,
    MIN_LOCAL_XEL_FILE_SIZE_MB,
} from "./localXevent";
import {
    LOCAL_SCHEMA_INVENTORY_ROW_LIMIT,
    LOCAL_SCHEMA_INVENTORY_SQL,
} from "./localSchemaInventory";
import type { RunbookSchemaCompareDocument } from "../../sharedInterfaces/runbookSchemaCompare";

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
    discoverSqlTests(isCancellationRequested: () => boolean): Promise<LocalSqlTestDiscoveryResult>;
    runTsqlt(
        nodeId: string,
        databaseRef: string,
        selection: LocalTsqltSelection,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<mssql.SimpleExecuteResult>;
    buildDacpac(
        projectPath: string,
        isCancellationRequested: () => boolean,
    ): Promise<LocalDacpacBuildResult>;
    extractDacpac(
        nodeId: string,
        databaseRef: string,
        databaseName: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalDacpacExtractionResult>;
    previewDacpacDeployment(
        dacpacPath: string,
        databaseRef: string,
        isCancellationRequested: () => boolean,
    ): Promise<LocalDeploymentPreviewResult>;
    deployDacpac(
        nodeId: string,
        dacpacPath: string,
        databaseRef: string,
        approvedArtifactDigest: string,
        approvedPreviewDigest: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalDacpacDeploymentResult>;
    deployDevelopmentDacpac(
        nodeId: string,
        dacpacPath: string,
        databaseRef: string,
        approvedArtifactDigest: string,
        approvedPreviewDigest: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalDacpacDeploymentResult>;
    deployContainerDacpac(
        nodeId: string,
        dacpacPath: string,
        databaseRef: string,
        approvedArtifactDigest: string,
        approvedPreviewDigest: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalDacpacDeploymentResult>;
    applySchema(
        nodeId: string,
        databaseRef: string,
        sql: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalSchemaMutationResult>;
    verifyDacpacDeployment(
        dacpacPath: string,
        databaseRef: string,
        isCancellationRequested: () => boolean,
    ): Promise<LocalSchemaComparisonResult>;
    exportSchemaComparison(
        nodeId: string,
        dacpacPath: string,
        databaseRef: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalSchemaComparisonExportResult>;
    provisionSandbox(
        nodeId: string,
        baseConnectionRef: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalSandboxLeaseResult>;
    provisionDevelopmentDatabase(
        nodeId: string,
        baseConnectionRef: string,
        databaseName: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalDevelopmentDatabaseLeaseResult>;
    provisionSqlContainer(
        nodeId: string,
        containerName: string,
        databaseName: string,
        version: string,
        password: string,
        port: number | undefined,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalSqlContainerLeaseResult>;
    inspectWorkload(
        filePath: string,
        isCancellationRequested: () => boolean,
    ): Promise<LocalWorkloadPreviewResult>;
    runWorkload(
        nodeId: string,
        databaseRef: string,
        workloadRef: string,
        expectedWorkloadSha256: string,
        repetitions: number,
        timeoutSeconds: number,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalWorkloadRunResult>;
    startXeventSession(
        nodeId: string,
        databaseRef: string,
        template: string,
        maxFileSizeMb: number,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalXeventSessionResult>;
    stopXeventSession(
        databaseRef: string,
        sessionRef: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalXeventCaptureResult>;
    collectXel(
        nodeId: string,
        databaseRef: string,
        captureRef: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalXelArtifactResult>;
    disposeSandbox(
        nodeId: string,
        leaseRef: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalSandboxCleanupResult>;
    disposeSqlContainer(
        nodeId: string,
        leaseRef: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalSqlContainerCleanupResult>;
    bundleEvidence(
        nodeId: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalEvidenceBundleResult>;
}

export interface LocalWorkspaceSnapshot {
    workspaceFolderCount: number;
    /** Absolute, workspace-contained project paths in stable sort order. */
    projectPaths: string[];
    truncated?: boolean;
}

export interface LocalSqlTestDiscoveryResult {
    candidateSqlFileCount: number;
    scannedSqlFileCount: number;
    skippedOversizedFileCount: number;
    skippedByteBudgetFileCount: number;
    unsafePathFileCount: number;
    unreadableFileCount: number;
    scannedSourceBytes: number;
    tSqltClassCount: number;
    tSqltSourceFileCount: number;
    duplicateDefinitionCount: number;
    truncated: boolean;
    tests: Array<{
        framework: "tSQLt";
        suite: string;
        name: string;
        relativePath: string;
        line: number;
    }>;
}

export interface LocalDacpacBuildResult {
    projectPath: string;
    artifactPath: string;
    artifactSizeBytes: number;
    artifactSha256: string;
    diagnosticCount: number;
    warningCount: number;
    errorCount: number;
    builtAtUtc: string;
}

export interface LocalDacpacExtractionResult {
    databaseName: string;
    operationId: string;
    artifactPath: string;
    artifactSizeBytes: number;
    artifactSha256: string;
    extractedAtUtc: string;
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

export interface LocalDacpacDeploymentResult {
    effectId: string;
    dacpacPath: string;
    artifactSha256: string;
    stagedArtifactSha256: string;
    databaseName: string;
    operationId: string;
    approvedPreviewDigest: string;
    postDeployReportSha256: string;
    postDeployChangeCount: number;
    deployedAtUtc: string;
}

export interface LocalSchemaComparisonResult extends LocalDeploymentPreviewResult {
    matches: boolean;
}

export interface LocalSchemaComparisonExportResult extends LocalSchemaComparisonResult {
    artifactPath: string;
    artifactSizeBytes: number;
    artifactSha256: string;
    deploymentReportArtifactPath: string;
    document: RunbookSchemaCompareDocument;
    exportedAtUtc: string;
}

export interface LocalSandboxLeaseResult {
    effectId: string;
    leaseId: string;
    connectionRef: string;
    databaseName: string;
    createdAtUtc: string;
}

export interface LocalDevelopmentDatabaseLeaseResult extends LocalSandboxLeaseResult {
    retention: "retained";
}

export interface LocalSqlContainerLeaseResult extends LocalSandboxLeaseResult {
    containerName: string;
    port: number;
    version: string;
}

export interface LocalSchemaMutationResult {
    effectId: string;
    databaseName: string;
    tableName: string;
    sqlSha256: string;
    changedObjectCount: number;
    appliedAtUtc: string;
}

export interface LocalSandboxCleanupResult {
    effectId: string;
    leaseId: string;
    databaseName: string;
    cleaned: boolean;
    cleanedAtUtc: string;
    cleanupEvidenceDigest: string;
}

export interface LocalSqlContainerCleanupResult extends LocalSandboxCleanupResult {
    containerName: string;
}

export interface LocalWorkloadPreviewResult {
    workloadRef: string;
    fileName: string;
    workloadSha256: string;
    sourceByteCount: number;
    batchCount: number;
    mutating: boolean;
    inspectedAtUtc: string;
}

export interface LocalWorkloadBatchResult {
    iteration: number;
    batch: number;
    durationMs: number;
    rowCount: number;
    succeeded: boolean;
    errorCode: string;
}

export interface LocalWorkloadRunResult {
    effectId: string;
    workloadSha256: string;
    plannedBatchCount: number;
    executedBatchCount: number;
    failedBatchCount: number;
    totalDurationMs: number;
    repetitions: number;
    results: LocalWorkloadBatchResult[];
    completedAtUtc: string;
}

export interface LocalXeventSessionResult {
    effectId: string;
    sessionRef: string;
    sessionName: string;
    template: string;
    maxFileSizeMb: number;
    startedAtUtc: string;
}

export interface LocalXeventCaptureResult {
    effectId: string;
    captureRef: string;
    sessionName: string;
    eventFileName: string;
    eventCount: number;
    stoppedAtUtc: string;
}

export interface LocalXelArtifactResult {
    sessionName: string;
    artifactPath: string;
    artifactSizeBytes: number;
    artifactSha256: string;
    eventCount: number;
    captureComplete: boolean;
    collectedAtUtc: string;
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
const MAX_SQL_TEST_CASES = 1000;

let queryCounter = 0;

export class LocalSqlActivityDelegate implements ActivityExecutionDelegate {
    public readonly runtimeKind = "local" as const;
    public readonly supportedActivityKinds = new Set([
        "workspace.inspect",
        "sqltest.discover",
        "tsqlt.run",
        "dacpac.build",
        "dacpac.extract",
        "sandbox.provision",
        "devdatabase.provision",
        "sql.container.provision",
        "sql.workload.inspect",
        "dacpac.deploy.preview",
        "dacpac.deploy",
        "dacpac.deploy.dev",
        "dacpac.deploy.container",
        "xevent.session.start",
        "sql.workload.run",
        "xevent.session.stop",
        "xevent.xel.collect",
        "sql.schema.apply",
        "schema.compare",
        "schema.compare.export",
        "database.schema.inventory",
        "sandbox.dispose",
        "sql.container.dispose",
        "sqltest.run",
        "evidence.bundle",
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
            case "sqltest.discover":
                return this.discoverSqlTests(binding);
            case "tsqlt.run":
                return this.executeTsqlt(node, binding);
            case "dacpac.build":
                return this.buildDacpac(node, binding);
            case "dacpac.extract":
                return this.extractDacpac(node, binding);
            case "sandbox.provision":
                return this.provisionSandbox(node, binding);
            case "devdatabase.provision":
                return this.provisionDevelopmentDatabase(node, binding);
            case "sql.container.provision":
                return this.provisionSqlContainer(node, binding);
            case "sql.workload.inspect":
                return this.inspectWorkload(node, binding);
            case "dacpac.deploy.preview":
                return this.previewDacpacDeployment(node, binding);
            case "dacpac.deploy":
                return this.deployDacpac(node, binding);
            case "dacpac.deploy.dev":
                return this.deployDacpac(node, binding, true);
            case "dacpac.deploy.container":
                return this.deployDacpac(node, binding, false, true);
            case "xevent.session.start":
                return this.startXeventSession(node, binding);
            case "sql.workload.run":
                return this.runWorkload(node, binding);
            case "xevent.session.stop":
                return this.stopXeventSession(node, binding);
            case "xevent.xel.collect":
                return this.collectXel(node, binding);
            case "sql.schema.apply":
                return this.applySchema(node, binding);
            case "schema.compare":
                return this.verifyDacpacDeployment(node, binding);
            case "schema.compare.export":
                return this.exportSchemaComparison(node, binding);
            case "database.schema.inventory":
                return this.inventoryDatabaseSchema(node, binding);
            case "sandbox.dispose":
                return this.disposeSandbox(node, binding);
            case "sql.container.dispose":
                return this.disposeSqlContainer(node, binding);
            case "sqltest.run":
                return this.executeSqlTests(node, binding);
            case "evidence.bundle":
                return this.bundleEvidence(node, binding);
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
                runMetrics: {
                    "workspace.folderCount": snapshot.workspaceFolderCount,
                    "workspace.projectCount": projectPaths.length,
                    "workspace.truncated": snapshot.truncated === true,
                },
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

    private async discoverSqlTests(binding: {
        isCancellationRequested: () => boolean;
    }): Promise<NodeExecution> {
        try {
            const result = await this.operations.discoverSqlTests(binding.isCancellationRequested);
            const discoveryComplete =
                !result.truncated &&
                result.skippedOversizedFileCount === 0 &&
                result.skippedByteBudgetFileCount === 0 &&
                result.unsafePathFileCount === 0 &&
                result.unreadableFileCount === 0;
            return {
                success: true,
                runMetrics: {
                    "tests.discovered": result.tests.length,
                    "tests.discoveredClassCount": result.tSqltClassCount,
                    "tests.scannedSqlFileCount": result.scannedSqlFileCount,
                    "tests.discoveryComplete": discoveryComplete,
                },
                message: LocRunbookStudio.sqlTestsDiscovered(
                    result.tests.length,
                    result.tSqltClassCount,
                ),
                output: {
                    contract: "testSuiteDiscovery/1",
                    columns: ["framework", "suite", "test", "repositoryPath", "line"],
                    rows: result.tests.map((test) => [
                        test.framework,
                        test.suite,
                        test.name,
                        test.relativePath,
                        test.line,
                    ]),
                    scalars: {
                        candidateSqlFileCount: result.candidateSqlFileCount,
                        scannedSqlFileCount: result.scannedSqlFileCount,
                        skippedOversizedFileCount: result.skippedOversizedFileCount,
                        skippedByteBudgetFileCount: result.skippedByteBudgetFileCount,
                        unsafePathFileCount: result.unsafePathFileCount,
                        unreadableFileCount: result.unreadableFileCount,
                        scannedSourceBytes: result.scannedSourceBytes,
                        tSqltClassCount: result.tSqltClassCount,
                        tSqltSourceFileCount: result.tSqltSourceFileCount,
                        tSqltTestCount: result.tests.length,
                        duplicateDefinitionCount: result.duplicateDefinitionCount,
                        complete: discoveryComplete,
                        truncated: result.truncated,
                        executionMode: "local",
                    },
                },
                values: {
                    tSqltClassCount: result.tSqltClassCount,
                    tSqltTestCount: result.tests.length,
                    complete: discoveryComplete,
                },
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
                runMetrics: {
                    "build.artifactSizeBytes": result.artifactSizeBytes,
                    "build.diagnosticCount": result.diagnosticCount,
                    "build.warningCount": result.warningCount,
                    "build.errorCount": result.errorCount,
                },
                diagnosticCounts: {
                    warningCount: result.warningCount,
                    errorCount: result.errorCount,
                },
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
                    artifactSha256: result.artifactSha256,
                    diagnosticCount: result.diagnosticCount,
                },
            };
        } catch (error) {
            return activityFailure(error);
        }
    }

    private async extractDacpac(
        node: RunbookPlanNode,
        binding: {
            resolveBind: (input: unknown) => unknown;
            isCancellationRequested: () => boolean;
            invocation: ActivityInvocationIdentity;
        },
    ): Promise<NodeExecution> {
        const databaseRef = binding.resolveBind(node.inputs?.database);
        if (typeof databaseRef !== "string" || databaseRef.trim().length === 0) {
            return invalidBinding("database");
        }
        const databaseName = binding.resolveBind(node.inputs?.databaseName);
        if (typeof databaseName !== "string" || databaseName.trim().length === 0) {
            return invalidBinding("databaseName");
        }
        try {
            const result = await this.operations.extractDacpac(
                node.id,
                databaseRef.trim(),
                databaseName.trim(),
                binding.invocation,
                binding.isCancellationRequested,
            );
            return {
                success: true,
                runMetrics: {
                    "extract.artifactSizeBytes": result.artifactSizeBytes,
                    "extract.completed": true,
                },
                message: LocRunbookStudio.dacpacExtracted(result.databaseName, result.artifactPath),
                output: {
                    contract: "dacpacArtifact/1",
                    scalars: {
                        databaseName: result.databaseName,
                        operationId: result.operationId,
                        artifactPath: result.artifactPath,
                        artifactSizeBytes: result.artifactSizeBytes,
                        artifactSha256: result.artifactSha256,
                        extractedAtUtc: result.extractedAtUtc,
                        executionMode: "local",
                    },
                },
                values: {
                    databaseName: result.databaseName,
                    artifactPath: result.artifactPath,
                    artifactSha256: result.artifactSha256,
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
                runMetrics: { "query.rowCount": result.rowCount },
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

    private async inventoryDatabaseSchema(
        node: RunbookPlanNode,
        binding: { resolveBind: (input: unknown) => unknown },
    ): Promise<NodeExecution> {
        const databaseRef = binding.resolveBind(node.inputs?.database);
        if (typeof databaseRef !== "string" || databaseRef.trim().length === 0) {
            return invalidBinding("database");
        }

        queryCounter++;
        const ownerUri = `runbookstudio://schema-inventory/${queryCounter.toString(36)}/${node.id}`;
        let connected = false;
        try {
            connected = await this.operations.connect(databaseRef.trim(), ownerUri);
            if (!connected) {
                throw new LocalActivityError(
                    LocRunbookStudio.connectFailed,
                    "RunbookStudio.ActivityFailed",
                );
            }
            const result = await this.operations.execute(ownerUri, LOCAL_SCHEMA_INVENTORY_SQL);
            const availableRows = result.rows ?? [];
            const truncated =
                availableRows.length > LOCAL_SCHEMA_INVENTORY_ROW_LIMIT ||
                result.rowCount > LOCAL_SCHEMA_INVENTORY_ROW_LIMIT ||
                result.rowCount > availableRows.length;
            const rows = availableRows
                .slice(0, LOCAL_SCHEMA_INVENTORY_ROW_LIMIT)
                .map((row) => row.map((cell) => (cell.isNull ? null : cell.displayValue)));
            return {
                success: true,
                runMetrics: {
                    "schemaInventory.objectCount": rows.length,
                    "schemaInventory.truncated": truncated,
                },
                message: `${rows.length} schema objects`,
                output: {
                    contract: "databaseSchemaInventory/1",
                    columns: ["ObjectType", "SchemaName", "ObjectName"],
                    rows,
                    scalars: {
                        objectCount: rows.length,
                        truncated,
                        executionMode: "local",
                    },
                },
                values: { objectCount: rows.length, truncated },
            };
        } catch (error) {
            return activityFailure(error);
        } finally {
            if (connected) {
                try {
                    await this.operations.disconnect(ownerUri);
                } catch {
                    // Best effort: inventory execution has already settled.
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
                runMetrics: {
                    "deployment.previewChangeCount": result.changeCount,
                    "deployment.previewAlertCount": result.alertCount,
                },
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
                runMetrics: { "sandbox.provisioned": true },
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

    private async provisionDevelopmentDatabase(
        node: RunbookPlanNode,
        binding: {
            resolveBind: (input: unknown) => unknown;
            isCancellationRequested: () => boolean;
            invocation: ActivityInvocationIdentity;
        },
    ): Promise<NodeExecution> {
        const baseConnectionRef = binding.resolveBind(node.inputs?.server);
        const databaseName = binding.resolveBind(node.inputs?.databaseName);
        if (typeof baseConnectionRef !== "string" || baseConnectionRef.trim().length === 0) {
            return invalidBinding("server");
        }
        if (typeof databaseName !== "string" || databaseName.trim().length === 0) {
            return invalidBinding("databaseName");
        }
        try {
            const result = await this.operations.provisionDevelopmentDatabase(
                node.id,
                baseConnectionRef.trim(),
                databaseName.trim(),
                binding.invocation,
                binding.isCancellationRequested,
            );
            return {
                success: true,
                runMetrics: { "developmentDatabase.provisioned": true },
                message: LocRunbookStudio.developmentDatabaseProvisioned(result.databaseName),
                output: {
                    contract: "databaseLease/1",
                    scalars: {
                        leaseId: result.leaseId,
                        connectionRef: result.connectionRef,
                        databaseName: result.databaseName,
                        effectId: result.effectId,
                        createdAtUtc: result.createdAtUtc,
                        retention: result.retention,
                        executionMode: "local",
                    },
                },
                values: {
                    leaseId: result.leaseId,
                    connectionRef: result.connectionRef,
                    databaseName: result.databaseName,
                },
            };
        } catch (error) {
            return activityFailure(error);
        }
    }

    private async provisionSqlContainer(
        node: RunbookPlanNode,
        binding: {
            resolveBind: (input: unknown) => unknown;
            isCancellationRequested: () => boolean;
            invocation: ActivityInvocationIdentity;
        },
    ): Promise<NodeExecution> {
        const containerName = binding.resolveBind(node.inputs?.containerName);
        const databaseName = binding.resolveBind(node.inputs?.databaseName);
        const version = binding.resolveBind(node.inputs?.version);
        const password = binding.resolveBind(node.inputs?.password);
        const portValue = binding.resolveBind(node.inputs?.port);
        if (typeof containerName !== "string" || containerName.trim().length === 0) {
            return invalidBinding("containerName");
        }
        if (typeof databaseName !== "string" || databaseName.trim().length === 0) {
            return invalidBinding("databaseName");
        }
        if (typeof version !== "string" || version.trim().length === 0) {
            return invalidBinding("version");
        }
        if (typeof password !== "string" || password.length === 0) {
            return invalidBinding("password");
        }
        if (
            portValue !== undefined &&
            portValue !== null &&
            (typeof portValue !== "number" || !Number.isSafeInteger(portValue))
        ) {
            return invalidBinding("port");
        }
        try {
            const result = await this.operations.provisionSqlContainer(
                node.id,
                containerName.trim(),
                databaseName.trim(),
                version.trim(),
                password,
                typeof portValue === "number" ? portValue : undefined,
                binding.invocation,
                binding.isCancellationRequested,
            );
            return {
                success: true,
                runMetrics: {
                    "container.provisioned": true,
                    "container.port": result.port,
                },
                message: LocRunbookStudio.sqlContainerProvisioned(
                    result.containerName,
                    result.databaseName,
                ),
                output: {
                    contract: "databaseLease/1",
                    scalars: {
                        leaseId: result.leaseId,
                        connectionRef: result.connectionRef,
                        databaseName: result.databaseName,
                        containerName: result.containerName,
                        port: result.port,
                        version: result.version,
                        effectId: result.effectId,
                        createdAtUtc: result.createdAtUtc,
                        executionMode: "local",
                    },
                },
                values: {
                    leaseId: result.leaseId,
                    connectionRef: result.connectionRef,
                    databaseName: result.databaseName,
                    containerName: result.containerName,
                    port: result.port,
                },
            };
        } catch (error) {
            return activityFailure(error);
        }
    }

    private async inspectWorkload(
        node: RunbookPlanNode,
        binding: {
            resolveBind: (input: unknown) => unknown;
            isCancellationRequested: () => boolean;
        },
    ): Promise<NodeExecution> {
        const filePath = binding.resolveBind(node.inputs?.file);
        if (typeof filePath !== "string" || filePath.trim().length === 0) {
            return invalidBinding("file");
        }
        try {
            const result = await this.operations.inspectWorkload(
                filePath.trim(),
                binding.isCancellationRequested,
            );
            return {
                success: true,
                runMetrics: {
                    "workload.batchCount": result.batchCount,
                    "workload.sourceByteCount": result.sourceByteCount,
                    "workload.mutating": result.mutating,
                },
                message: LocRunbookStudio.workloadInspected(result.fileName, result.batchCount),
                output: {
                    contract: "workloadPreview/1",
                    scalars: {
                        workloadRef: result.workloadRef,
                        fileName: result.fileName,
                        workloadSha256: result.workloadSha256,
                        sourceByteCount: result.sourceByteCount,
                        batchCount: result.batchCount,
                        mutating: result.mutating,
                        inspectedAtUtc: result.inspectedAtUtc,
                        executionMode: "local",
                    },
                },
                values: {
                    workloadRef: result.workloadRef,
                    workloadSha256: result.workloadSha256,
                    batchCount: result.batchCount,
                    mutating: result.mutating,
                },
            };
        } catch (error) {
            return activityFailure(error);
        }
    }

    private async runWorkload(
        node: RunbookPlanNode,
        binding: {
            resolveBind: (input: unknown) => unknown;
            isCancellationRequested: () => boolean;
            invocation: ActivityInvocationIdentity;
        },
    ): Promise<NodeExecution> {
        const databaseRef = binding.resolveBind(node.inputs?.database);
        const workloadRef = binding.resolveBind(node.inputs?.workload);
        const workloadDigest = binding.resolveBind(node.inputs?.workloadDigest);
        const repetitionValue = binding.resolveBind(node.inputs?.repetitions);
        const timeoutValue = binding.resolveBind(node.inputs?.timeoutSeconds);
        const repetitions = repetitionValue === undefined ? 1 : repetitionValue;
        const timeoutSeconds = timeoutValue === undefined ? 300 : timeoutValue;
        if (typeof databaseRef !== "string" || databaseRef.trim().length === 0) {
            return invalidBinding("database");
        }
        if (typeof workloadRef !== "string" || workloadRef.trim().length === 0) {
            return invalidBinding("workload");
        }
        if (typeof workloadDigest !== "string" || !/^[a-f0-9]{64}$/i.test(workloadDigest)) {
            return invalidBinding("workloadDigest");
        }
        if (
            typeof repetitions !== "number" ||
            !Number.isSafeInteger(repetitions) ||
            repetitions < 1 ||
            repetitions > 100
        ) {
            return invalidBinding("repetitions");
        }
        if (
            typeof timeoutSeconds !== "number" ||
            !Number.isSafeInteger(timeoutSeconds) ||
            timeoutSeconds < 1 ||
            timeoutSeconds > 3600
        ) {
            return invalidBinding("timeoutSeconds");
        }
        try {
            const result = await this.operations.runWorkload(
                node.id,
                databaseRef.trim(),
                workloadRef.trim(),
                workloadDigest.toLowerCase(),
                repetitions,
                timeoutSeconds,
                binding.invocation,
                binding.isCancellationRequested,
            );
            const succeeded = result.failedBatchCount === 0;
            return {
                success: succeeded,
                verdict: succeeded ? "pass" : "fail",
                ...(!succeeded ? { errorCode: "RunbookStudio.WorkloadFailed" } : {}),
                runMetrics: {
                    "workload.plannedBatchCount": result.plannedBatchCount,
                    "workload.executedBatchCount": result.executedBatchCount,
                    "workload.failedBatchCount": result.failedBatchCount,
                    "workload.totalDurationMs": result.totalDurationMs,
                },
                message: succeeded
                    ? LocRunbookStudio.workloadCompleted(result.executedBatchCount)
                    : LocRunbookStudio.workloadFailed(result.failedBatchCount),
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
                    rows: result.results.map((item) => [
                        item.iteration,
                        item.batch,
                        item.durationMs,
                        item.rowCount,
                        item.succeeded,
                        item.errorCode,
                    ]),
                    scalars: {
                        effectId: result.effectId,
                        workloadSha256: result.workloadSha256,
                        plannedBatchCount: result.plannedBatchCount,
                        executedBatchCount: result.executedBatchCount,
                        failedBatchCount: result.failedBatchCount,
                        totalDurationMs: result.totalDurationMs,
                        repetitions: result.repetitions,
                        completedAtUtc: result.completedAtUtc,
                        executionMode: "local",
                    },
                },
                values: {
                    succeeded,
                    executedBatchCount: result.executedBatchCount,
                    failedBatchCount: result.failedBatchCount,
                    totalDurationMs: result.totalDurationMs,
                },
            };
        } catch (error) {
            return activityFailure(error);
        }
    }

    private async startXeventSession(
        node: RunbookPlanNode,
        binding: {
            resolveBind: (input: unknown) => unknown;
            isCancellationRequested: () => boolean;
            invocation: ActivityInvocationIdentity;
        },
    ): Promise<NodeExecution> {
        const databaseRef = binding.resolveBind(node.inputs?.database);
        const template = binding.resolveBind(node.inputs?.template);
        const fileSizeValue = binding.resolveBind(node.inputs?.maxFileSizeMb);
        const maxFileSizeMb = fileSizeValue === undefined ? 16 : fileSizeValue;
        if (typeof databaseRef !== "string" || databaseRef.trim().length === 0) {
            return invalidBinding("database");
        }
        if (template !== LOCAL_XEVENT_TEMPLATE) {
            return invalidBinding("template");
        }
        if (
            typeof maxFileSizeMb !== "number" ||
            !Number.isSafeInteger(maxFileSizeMb) ||
            maxFileSizeMb < MIN_LOCAL_XEL_FILE_SIZE_MB ||
            maxFileSizeMb > MAX_LOCAL_XEL_FILE_SIZE_MB
        ) {
            return invalidBinding("maxFileSizeMb");
        }
        try {
            const result = await this.operations.startXeventSession(
                node.id,
                databaseRef.trim(),
                template,
                maxFileSizeMb,
                binding.invocation,
                binding.isCancellationRequested,
            );
            return {
                success: true,
                runMetrics: { "xevent.sessionStarted": true },
                message: LocRunbookStudio.xeventSessionStarted(result.sessionName),
                output: {
                    contract: "xeventSessionLease/1",
                    scalars: {
                        effectId: result.effectId,
                        sessionRef: result.sessionRef,
                        sessionName: result.sessionName,
                        template: result.template,
                        maxFileSizeMb: result.maxFileSizeMb,
                        startedAtUtc: result.startedAtUtc,
                        executionMode: "local",
                    },
                },
                values: {
                    sessionRef: result.sessionRef,
                    sessionName: result.sessionName,
                    template: result.template,
                },
            };
        } catch (error) {
            return activityFailure(error);
        }
    }

    private async stopXeventSession(
        node: RunbookPlanNode,
        binding: {
            resolveBind: (input: unknown) => unknown;
            isCancellationRequested: () => boolean;
            invocation: ActivityInvocationIdentity;
        },
    ): Promise<NodeExecution> {
        const databaseRef = binding.resolveBind(node.inputs?.database);
        const sessionRef = binding.resolveBind(node.inputs?.session);
        if (typeof databaseRef !== "string" || databaseRef.trim().length === 0) {
            return invalidBinding("database");
        }
        if (typeof sessionRef !== "string" || sessionRef.trim().length === 0) {
            return invalidBinding("session");
        }
        try {
            const result = await this.operations.stopXeventSession(
                databaseRef.trim(),
                sessionRef.trim(),
                binding.invocation,
                binding.isCancellationRequested,
            );
            return {
                success: true,
                runMetrics: { "xevent.sessionStopped": true },
                message: LocRunbookStudio.xeventSessionStopped(result.sessionName),
                output: {
                    contract: "xeventCapture/1",
                    scalars: {
                        effectId: result.effectId,
                        captureRef: result.captureRef,
                        sessionName: result.sessionName,
                        eventFileName: result.eventFileName,
                        eventCount: result.eventCount,
                        stoppedAtUtc: result.stoppedAtUtc,
                        executionMode: "local",
                    },
                },
                values: {
                    captureRef: result.captureRef,
                    sessionName: result.sessionName,
                    eventFileName: result.eventFileName,
                    eventCount: result.eventCount,
                },
            };
        } catch (error) {
            return activityFailure(error);
        }
    }

    private async collectXel(
        node: RunbookPlanNode,
        binding: {
            resolveBind: (input: unknown) => unknown;
            isCancellationRequested: () => boolean;
            invocation: ActivityInvocationIdentity;
        },
    ): Promise<NodeExecution> {
        const databaseRef = binding.resolveBind(node.inputs?.database);
        const captureRef = binding.resolveBind(node.inputs?.capture);
        if (typeof databaseRef !== "string" || databaseRef.trim().length === 0) {
            return invalidBinding("database");
        }
        if (typeof captureRef !== "string" || captureRef.trim().length === 0) {
            return invalidBinding("capture");
        }
        try {
            const result = await this.operations.collectXel(
                node.id,
                databaseRef.trim(),
                captureRef.trim(),
                binding.invocation,
                binding.isCancellationRequested,
            );
            return {
                success: true,
                runMetrics: {
                    "xevent.artifactSizeBytes": result.artifactSizeBytes,
                    "xevent.eventCount": result.eventCount,
                    "xevent.captureComplete": result.captureComplete,
                },
                message: LocRunbookStudio.xelArtifactCollected(result.artifactSizeBytes),
                output: {
                    contract: "xelArtifact/1",
                    scalars: {
                        sessionName: result.sessionName,
                        artifactPath: result.artifactPath,
                        artifactSizeBytes: result.artifactSizeBytes,
                        artifactSha256: result.artifactSha256,
                        eventCount: result.eventCount,
                        captureComplete: result.captureComplete,
                        collectedAtUtc: result.collectedAtUtc,
                        executionMode: "local",
                    },
                },
                values: {
                    artifactPath: result.artifactPath,
                    artifactSizeBytes: result.artifactSizeBytes,
                    artifactSha256: result.artifactSha256,
                    eventCount: result.eventCount,
                    captureComplete: result.captureComplete,
                },
            };
        } catch (error) {
            return activityFailure(error);
        }
    }

    private async deployDacpac(
        node: RunbookPlanNode,
        binding: {
            resolveBind: (input: unknown) => unknown;
            isCancellationRequested: () => boolean;
            invocation: ActivityInvocationIdentity;
        },
        development = false,
        container = false,
    ): Promise<NodeExecution> {
        const dacpacPath = binding.resolveBind(node.inputs?.dacpac);
        const databaseRef = binding.resolveBind(node.inputs?.database);
        const artifactDigest = binding.resolveBind(node.inputs?.artifactDigest);
        const previewDigest = binding.resolveBind(node.inputs?.previewDigest);
        if (typeof dacpacPath !== "string" || dacpacPath.trim().length === 0) {
            return invalidBinding("dacpac");
        }
        if (typeof databaseRef !== "string" || databaseRef.trim().length === 0) {
            return invalidBinding("database");
        }
        if (typeof artifactDigest !== "string" || artifactDigest.trim().length === 0) {
            return invalidBinding("artifactDigest");
        }
        if (typeof previewDigest !== "string" || previewDigest.trim().length === 0) {
            return invalidBinding("previewDigest");
        }
        try {
            const operation = container
                ? this.operations.deployContainerDacpac.bind(this.operations)
                : development
                  ? this.operations.deployDevelopmentDacpac.bind(this.operations)
                  : this.operations.deployDacpac.bind(this.operations);
            const result = await operation(
                node.id,
                dacpacPath.trim(),
                databaseRef.trim(),
                artifactDigest.trim(),
                previewDigest.trim(),
                binding.invocation,
                binding.isCancellationRequested,
            );
            return {
                success: true,
                runMetrics: {
                    "deployment.applied": true,
                    "deployment.postDeployChangeCount": result.postDeployChangeCount,
                },
                message: development
                    ? LocRunbookStudio.developmentDacpacDeployed(result.databaseName)
                    : LocRunbookStudio.dacpacDeployed(result.databaseName),
                output: {
                    contract: "deploymentEvidence/1",
                    scalars: {
                        effectId: result.effectId,
                        dacpacPath: result.dacpacPath,
                        artifactSha256: result.artifactSha256,
                        stagedArtifactSha256: result.stagedArtifactSha256,
                        databaseName: result.databaseName,
                        operationId: result.operationId,
                        approvedPreviewDigest: result.approvedPreviewDigest,
                        postDeployReportSha256: result.postDeployReportSha256,
                        postDeployChangeCount: result.postDeployChangeCount,
                        deployedAtUtc: result.deployedAtUtc,
                        executionMode: "local",
                    },
                },
                values: {
                    deployed: true,
                    postDeployChangeCount: result.postDeployChangeCount,
                    artifactSha256: result.artifactSha256,
                },
            };
        } catch (error) {
            return activityFailure(error);
        }
    }

    private async applySchema(
        node: RunbookPlanNode,
        binding: {
            resolveBind: (input: unknown) => unknown;
            isCancellationRequested: () => boolean;
            invocation: ActivityInvocationIdentity;
        },
    ): Promise<NodeExecution> {
        const databaseRef = binding.resolveBind(node.inputs?.database);
        const sql = binding.resolveBind(node.inputs?.sql);
        if (typeof databaseRef !== "string" || databaseRef.trim().length === 0) {
            return invalidBinding("database");
        }
        const policy = validateLocalCreateTableSql(sql);
        if (!policy) {
            return {
                success: false,
                message: LocRunbookStudio.schemaMutationCreateTableOnly,
                errorCode: "RunbookStudio.ActivityPolicyDenied",
            };
        }
        try {
            const result = await this.operations.applySchema(
                node.id,
                databaseRef.trim(),
                policy.sql,
                binding.invocation,
                binding.isCancellationRequested,
            );
            return {
                success: true,
                runMetrics: {
                    "schemaMutation.applied": true,
                    "schemaMutation.changedObjectCount": result.changedObjectCount,
                },
                message: LocRunbookStudio.schemaMutationApplied(result.tableName),
                output: {
                    contract: "schemaMutationEvidence/1",
                    scalars: {
                        effectId: result.effectId,
                        databaseName: result.databaseName,
                        tableName: result.tableName,
                        sqlSha256: result.sqlSha256,
                        changedObjectCount: result.changedObjectCount,
                        appliedAtUtc: result.appliedAtUtc,
                        executionMode: "local",
                    },
                },
                values: {
                    applied: true,
                    tableName: result.tableName,
                    sqlSha256: result.sqlSha256,
                },
            };
        } catch (error) {
            return activityFailure(error);
        }
    }

    private async verifyDacpacDeployment(
        node: RunbookPlanNode,
        binding: {
            resolveBind: (input: unknown) => unknown;
            isCancellationRequested: () => boolean;
        },
    ): Promise<NodeExecution> {
        const dacpacPath = binding.resolveBind(node.inputs?.dacpac);
        const databaseRef = binding.resolveBind(node.inputs?.database);
        if (typeof dacpacPath !== "string" || dacpacPath.trim().length === 0) {
            return invalidBinding("dacpac");
        }
        if (typeof databaseRef !== "string" || databaseRef.trim().length === 0) {
            return invalidBinding("database");
        }
        try {
            const result = await this.operations.verifyDacpacDeployment(
                dacpacPath.trim(),
                databaseRef.trim(),
                binding.isCancellationRequested,
            );
            return {
                success: result.matches,
                runMetrics: {
                    "schema.alertCount": result.alertCount,
                    "schema.changeCount": result.changeCount,
                    "schema.matches": result.matches,
                },
                message: result.matches
                    ? LocRunbookStudio.schemaMatches
                    : LocRunbookStudio.schemaDriftDetected(result.changeCount),
                ...(!result.matches ? { errorCode: "RunbookStudio.SchemaDriftDetected" } : {}),
                output: {
                    contract: "schemaDiff/1",
                    text: result.reportXml,
                    scalars: {
                        matches: result.matches,
                        targetDatabase: result.targetDatabase,
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
                    matches: result.matches,
                    changeCount: result.changeCount,
                    reportSha256: result.reportSha256,
                },
            };
        } catch (error) {
            return activityFailure(error);
        }
    }

    private async exportSchemaComparison(
        node: RunbookPlanNode,
        binding: {
            resolveBind: (input: unknown) => unknown;
            isCancellationRequested: () => boolean;
            invocation: ActivityInvocationIdentity;
        },
    ): Promise<NodeExecution> {
        const dacpacPath = binding.resolveBind(node.inputs?.dacpac);
        const databaseRef = binding.resolveBind(node.inputs?.database);
        if (typeof dacpacPath !== "string" || dacpacPath.trim().length === 0) {
            return invalidBinding("dacpac");
        }
        if (typeof databaseRef !== "string" || databaseRef.trim().length === 0) {
            return invalidBinding("database");
        }
        try {
            const result = await this.operations.exportSchemaComparison(
                node.id,
                dacpacPath.trim(),
                databaseRef.trim(),
                binding.invocation,
                binding.isCancellationRequested,
            );
            return {
                success: true,
                runMetrics: {
                    "schema.alertCount": result.alertCount,
                    "schema.changeCount": result.changeCount,
                    "schema.matches": result.matches,
                    "schema.exported": true,
                    "schema.exportSizeBytes": result.artifactSizeBytes,
                },
                message: LocRunbookStudio.schemaComparisonExported(
                    result.changeCount,
                    result.artifactPath,
                ),
                output: {
                    contract: "schemaCompareDocument/1",
                    text: JSON.stringify(result.document),
                    scalars: {
                        matches: result.matches,
                        targetDatabase: result.targetDatabase,
                        changeCount: result.changeCount,
                        alertCount: result.alertCount,
                        operationSummary: result.operationSummary,
                        reportSha256: result.reportSha256,
                        reportTruncated: result.reportTruncated,
                        artifactPath: result.artifactPath,
                        artifactSizeBytes: result.artifactSizeBytes,
                        artifactSha256: result.artifactSha256,
                        deploymentReportArtifactPath: result.deploymentReportArtifactPath,
                        generatedAtUtc: result.generatedAtUtc,
                        exportedAtUtc: result.exportedAtUtc,
                        executionMode: "local",
                    },
                },
                values: {
                    matches: result.matches,
                    changeCount: result.changeCount,
                    reportSha256: result.reportSha256,
                    artifactPath: result.artifactPath,
                    artifactSha256: result.artifactSha256,
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
                runMetrics: { "cleanup.completed": result.cleaned },
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

    private async disposeSqlContainer(
        node: RunbookPlanNode,
        binding: {
            resolveBind: (input: unknown) => unknown;
            isCancellationRequested: () => boolean;
            invocation: ActivityInvocationIdentity;
        },
    ): Promise<NodeExecution> {
        const leaseRef = binding.resolveBind(node.inputs?.database);
        if (typeof leaseRef !== "string" || leaseRef.trim().length === 0) {
            return invalidBinding("database");
        }
        try {
            const result = await this.operations.disposeSqlContainer(
                node.id,
                leaseRef.trim(),
                binding.invocation,
                binding.isCancellationRequested,
            );
            return {
                success: true,
                runMetrics: { "container.cleanupCompleted": result.cleaned },
                message: LocRunbookStudio.sqlContainerDisposed(result.containerName),
                output: {
                    contract: "cleanupEvidence/1",
                    scalars: {
                        effectId: result.effectId,
                        leaseId: result.leaseId,
                        databaseName: result.databaseName,
                        containerName: result.containerName,
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

    private async executeSqlTests(
        node: RunbookPlanNode,
        binding: {
            resolveBind: (input: unknown) => unknown;
            isCancellationRequested: () => boolean;
        },
    ): Promise<NodeExecution> {
        const databaseRef = binding.resolveBind(node.inputs?.database);
        const sql = binding.resolveBind(node.inputs?.sql);
        const timeoutValue = binding.resolveBind(node.inputs?.timeoutSeconds);
        if (typeof databaseRef !== "string" || databaseRef.trim().length === 0) {
            return invalidBinding("database");
        }
        if (typeof sql !== "string" || sql.trim().length === 0) {
            return invalidBinding("sql");
        }
        if (!isReadOnlySql(sql)) {
            return {
                success: false,
                message: LocRunbookStudio.sqlNotReadOnly,
                errorCode: "RunbookStudio.ActivityPolicyDenied",
            };
        }
        const timeoutSeconds = timeoutValue === undefined ? 60 : timeoutValue;
        if (
            typeof timeoutSeconds !== "number" ||
            !Number.isInteger(timeoutSeconds) ||
            timeoutSeconds < 1 ||
            timeoutSeconds > 300
        ) {
            return invalidBinding("timeoutSeconds");
        }

        queryCounter++;
        const ownerUri = `runbookstudio://sqltest/${queryCounter.toString(36)}/${node.id}`;
        const cancellation = new vscode.CancellationTokenSource();
        const cancellationPoll = setInterval(() => {
            if (binding.isCancellationRequested()) {
                cancellation.cancel();
            }
        }, 50);
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            cancellation.cancel();
        }, timeoutSeconds * 1000);
        let connected = false;
        try {
            connected = await this.operations.connect(databaseRef.trim(), ownerUri);
            if (!connected) {
                throw new LocalActivityError(
                    LocRunbookStudio.connectFailed,
                    "RunbookStudio.ActivityFailed",
                );
            }
            if (timedOut) {
                throw new LocalActivityError(
                    LocRunbookStudio.sqlTestsTimedOut(timeoutSeconds),
                    "RunbookStudio.Timeout",
                );
            }
            if (cancellation.token.isCancellationRequested || binding.isCancellationRequested()) {
                throw new LocalActivityError(
                    LocRunbookStudio.sqlTestsCancelled,
                    "RunbookStudio.ActivityCancelled",
                );
            }
            const result = await this.operations.execute(ownerUri, sql.trim(), cancellation.token);
            if (timedOut) {
                throw new LocalActivityError(
                    LocRunbookStudio.sqlTestsTimedOut(timeoutSeconds),
                    "RunbookStudio.Timeout",
                );
            }
            if (cancellation.token.isCancellationRequested || binding.isCancellationRequested()) {
                throw new LocalActivityError(
                    LocRunbookStudio.sqlTestsCancelled,
                    "RunbookStudio.ActivityCancelled",
                );
            }
            const tests = parseSqlTestRows(result);
            const passed = tests.filter((test) => test.passed).length;
            const failed = tests.length - passed;
            return {
                success: failed === 0,
                verdict: failed === 0 ? "pass" : "fail",
                runMetrics: {
                    "sqlTests.total": tests.length,
                    "sqlTests.passed": passed,
                    "sqlTests.failed": failed,
                    "sqlTests.allPassed": failed === 0,
                },
                message:
                    failed === 0
                        ? LocRunbookStudio.sqlTestsPassed(tests.length)
                        : LocRunbookStudio.sqlTestsFailed(failed, tests.length),
                ...(failed > 0 ? { errorCode: "RunbookStudio.SqlTestsFailed" } : {}),
                output: {
                    contract: "testResults/1",
                    columns: ["name", "passed", "message"],
                    rows: tests.map((test) => [test.name, test.passed, test.message]),
                    scalars: {
                        total: tests.length,
                        passed,
                        failed,
                        allPassed: failed === 0,
                        executionMode: "local",
                    },
                },
                values: { total: tests.length, passed, failed, allPassed: failed === 0 },
            };
        } catch (error) {
            if (timedOut) {
                return activityFailure(
                    new LocalActivityError(
                        LocRunbookStudio.sqlTestsTimedOut(timeoutSeconds),
                        "RunbookStudio.Timeout",
                    ),
                );
            }
            if (
                error instanceof vscode.CancellationError ||
                cancellation.token.isCancellationRequested ||
                binding.isCancellationRequested()
            ) {
                return activityFailure(
                    new LocalActivityError(
                        LocRunbookStudio.sqlTestsCancelled,
                        "RunbookStudio.ActivityCancelled",
                    ),
                );
            }
            return activityFailure(error);
        } finally {
            clearTimeout(timeout);
            clearInterval(cancellationPoll);
            cancellation.dispose();
            if (connected) {
                try {
                    await this.operations.disconnect(ownerUri);
                } catch {
                    // Best effort: test execution has already settled.
                }
            }
        }
    }

    private async executeTsqlt(
        node: RunbookPlanNode,
        binding: {
            resolveBind: (input: unknown) => unknown;
            isCancellationRequested: () => boolean;
            invocation: ActivityInvocationIdentity;
        },
    ): Promise<NodeExecution> {
        const databaseRef = binding.resolveBind(node.inputs?.database);
        if (typeof databaseRef !== "string" || databaseRef.trim().length === 0) {
            return invalidBinding("database");
        }
        try {
            const selection = normalizeLocalTsqltSelection(
                binding.resolveBind(node.inputs?.suite),
                binding.resolveBind(node.inputs?.test),
            );
            if (binding.isCancellationRequested()) {
                throw new LocalActivityError(
                    LocRunbookStudio.tsqltExecutionCancelled,
                    "RunbookStudio.ActivityCancelled",
                );
            }
            const raw = await this.operations.runTsqlt(
                node.id,
                databaseRef.trim(),
                selection,
                binding.invocation,
                binding.isCancellationRequested,
            );
            const result = parseLocalTsqltResult(raw);
            return {
                success: result.allPassed,
                verdict: result.allPassed ? "pass" : "fail",
                runMetrics: {
                    "tsqlt.total": result.total,
                    "tsqlt.passed": result.passed,
                    "tsqlt.failed": result.failed,
                    "tsqlt.errors": result.errors,
                    "tsqlt.skipped": result.skipped,
                    "tsqlt.allPassed": result.allPassed,
                },
                message: result.allPassed
                    ? LocRunbookStudio.tsqltTestsPassed(result.passed, result.skipped)
                    : LocRunbookStudio.tsqltTestsFailed(result.failed, result.errors, result.total),
                ...(!result.allPassed ? { errorCode: "RunbookStudio.TsqltTestsFailed" } : {}),
                output: {
                    contract: "testResults/1",
                    columns: ["suite", "test", "result", "message", "durationMs"],
                    rows: result.tests.map((test) => [
                        test.suite,
                        test.name,
                        test.result,
                        test.message,
                        test.durationMs,
                    ]),
                    scalars: {
                        total: result.total,
                        passed: result.passed,
                        failed: result.failed,
                        errors: result.errors,
                        skipped: result.skipped,
                        allPassed: result.allPassed,
                        truncatedMessageCount: result.truncatedMessageCount,
                        executionMode: "local",
                    },
                },
                values: {
                    total: result.total,
                    passed: result.passed,
                    failed: result.failed,
                    errors: result.errors,
                    skipped: result.skipped,
                    allPassed: result.allPassed,
                },
            };
        } catch (error) {
            return activityFailure(error);
        }
    }

    private async bundleEvidence(
        node: RunbookPlanNode,
        binding: {
            isCancellationRequested: () => boolean;
            invocation: ActivityInvocationIdentity;
        },
    ): Promise<NodeExecution> {
        try {
            const result = await this.operations.bundleEvidence(
                node.id,
                binding.invocation,
                binding.isCancellationRequested,
            );
            return {
                success: true,
                verdict: result.verdict === "pass" ? "pass" : "fail",
                runMetrics: {
                    "evidence.nodeCount": result.nodeCount,
                    "evidence.passedNodeCount": result.passedNodeCount,
                    "evidence.failedNodeCount": result.failedNodeCount,
                    "evidence.handleCount": result.evidenceHandleCount,
                    "evidence.verdict": result.verdict,
                },
                message:
                    result.verdict === "pass"
                        ? LocRunbookStudio.evidenceBundlePassed(result.nodeCount)
                        : LocRunbookStudio.evidenceBundleNotPassed(result.verdict),
                output: {
                    contract: "evidenceBundle/1",
                    text: result.manifestJson,
                    scalars: {
                        bundleSha256: result.bundleSha256,
                        nodeCount: result.nodeCount,
                        passedNodeCount: result.passedNodeCount,
                        failedNodeCount: result.failedNodeCount,
                        evidenceHandleCount: result.evidenceHandleCount,
                        verdict: result.verdict,
                        generatedAtUtc: result.generatedAtUtc,
                        executionMode: "local",
                    },
                },
                values: {
                    bundleSha256: result.bundleSha256,
                    nodeCount: result.nodeCount,
                    verdict: result.verdict,
                },
            };
        } catch (error) {
            return activityFailure(error);
        }
    }
}

interface ParsedSqlTestCase {
    name: string;
    passed: boolean;
    message: string;
}

function parseSqlTestRows(result: mssql.SimpleExecuteResult): ParsedSqlTestCase[] {
    if (result.rowCount < 1 || result.rows.length < 1) {
        throw new LocalActivityError(
            LocRunbookStudio.sqlTestsNoResults,
            "RunbookStudio.SqlTestContractInvalid",
        );
    }
    if (result.rowCount > MAX_SQL_TEST_CASES || result.rows.length > MAX_SQL_TEST_CASES) {
        throw new LocalActivityError(
            LocRunbookStudio.sqlTestsTooManyResults(MAX_SQL_TEST_CASES),
            "RunbookStudio.SqlTestContractInvalid",
        );
    }
    const columns = result.columnInfo.map((column) =>
        column.columnName.trim().toLowerCase().replaceAll("_", ""),
    );
    const nameIndex = columns.findIndex((column) => column === "name" || column === "testname");
    const passedIndex = columns.indexOf("passed");
    const messageIndex = columns.indexOf("message");
    if (nameIndex < 0 || passedIndex < 0) {
        throw new LocalActivityError(
            LocRunbookStudio.sqlTestsColumnsRequired,
            "RunbookStudio.SqlTestContractInvalid",
        );
    }
    const names = new Set<string>();
    return result.rows.map((row) => {
        const nameCell = row[nameIndex];
        const passedCell = row[passedIndex];
        const name = nameCell?.isNull ? "" : nameCell?.displayValue.trim();
        const nameKey = name?.toLocaleLowerCase();
        if (!name || !nameKey || names.has(nameKey)) {
            throw new LocalActivityError(
                LocRunbookStudio.sqlTestsUniqueNamesRequired,
                "RunbookStudio.SqlTestContractInvalid",
            );
        }
        names.add(nameKey);
        const passed = parseSqlTestBoolean(passedCell);
        const messageCell = messageIndex >= 0 ? row[messageIndex] : undefined;
        return {
            name,
            passed,
            message: messageCell?.isNull ? "" : (messageCell?.displayValue ?? ""),
        };
    });
}

function parseSqlTestBoolean(cell: mssql.DbCellValue | undefined): boolean {
    const value = cell?.isNull ? "" : cell?.displayValue.trim().toLowerCase();
    if (["1", "true", "pass", "passed", "yes"].includes(value ?? "")) {
        return true;
    }
    if (["0", "false", "fail", "failed", "no"].includes(value ?? "")) {
        return false;
    }
    throw new LocalActivityError(
        LocRunbookStudio.sqlTestsPassedValueRequired,
        "RunbookStudio.SqlTestContractInvalid",
    );
}

function activityFailure(error: unknown): NodeExecution {
    return {
        success: false,
        message: error instanceof Error ? error.message : "activity failed",
        errorCode:
            error instanceof LocalActivityError || error instanceof LocalTsqltContractError
                ? error.errorCode
                : "RunbookStudio.ActivityFailed",
    };
}

function invalidBinding(name: string): NodeExecution {
    return {
        success: false,
        message: LocRunbookStudio.parameterRequired(name),
        errorCode: "RunbookStudio.BindingInvalid",
    };
}
