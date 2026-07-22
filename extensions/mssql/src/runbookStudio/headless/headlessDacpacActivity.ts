/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** No-VS-Code DacFx, reviewed migration, and schema-convergence activities. */

import { DOMParser } from "@xmldom/xmldom";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { RunbookPlanNode } from "../../sharedInterfaces/runbookStudio";
import type { RunbookSchemaCompareDocument } from "../../sharedInterfaces/runbookSchemaCompare";
import { parseSqlConnectionString } from "../../diagnostics/selfTest/connectionString";
import { MetadataStore } from "../../services/metadata/metadataStore";
import { MetadataStoreRunbookSchemaGraphProvider } from "../providers/schemaGraphProvider";
import { digestRunbookValue } from "../runbookDigest";
import { deriveRunbookEffectId, RunbookEffectLedger } from "../runbookEffectLedger";
import {
    LOCAL_EF_SCHEMA_SCOPE_SQL,
    MAX_LOCAL_EF_SCHEMA_ROWS,
    projectLocalEfLiveSchema,
    verifyLocalEfMigrationScope,
} from "../runtime/localEfMigrationConvergence";
import type {
    ActivityExecutionDelegate,
    ActivityInvocationIdentity,
    NodeExecution,
} from "../runtime/fakeRuntimeAdapter";
import { HeadlessEfActivityDelegate } from "./headlessEfActivity";
import { HeadlessEffectAuthority } from "./headlessEffectAuthority";
import { HeadlessSqlActivityDelegate } from "./headlessSqlActivity";
import {
    HeadlessStsDacFxClient,
    type HeadlessDacFxResult,
    type HeadlessDeployPlanResult,
} from "./headlessStsDacFxClient";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;
const MAX_DACPAC_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_REPORT_BYTES = 256 * 1024;
const MAX_COMPARE_ITEMS = 500;
const MAX_MIGRATION_BYTES = 8 * 1024 * 1024;

interface DacFxClient {
    serviceVersion?(isCancellationRequested: () => boolean): Promise<string | undefined>;
    extract(
        connectionString: string,
        databaseName: string,
        packageFilePath: string,
        isCancellationRequested: () => boolean,
    ): Promise<HeadlessDacFxResult>;
    deployPlan(
        connectionString: string,
        databaseName: string,
        packageFilePath: string,
        isCancellationRequested: () => boolean,
    ): Promise<HeadlessDeployPlanResult>;
    deploy(
        connectionString: string,
        databaseName: string,
        packageFilePath: string,
        isCancellationRequested: () => boolean,
    ): Promise<HeadlessDacFxResult>;
    dispose(): Promise<void>;
}

interface DeploymentPreview {
    dacpacPath: string;
    targetDatabase: string;
    operationId: string;
    changeCount: number;
    alertCount: number;
    operationSummary: string;
    reportSha256: string;
    reportXml: string;
    reportTruncated: boolean;
    generatedAtUtc: string;
    items: Array<{ operation: string; objectType: string; name: string }>;
}

interface RetainedPreview {
    runId: string;
    dacpacSha256: string;
    databaseRef: string;
    preview: DeploymentPreview;
}

export interface HeadlessDacpacActivityDependencies {
    dacFx?: DacFxClient;
}

export class HeadlessDacpacActivityDelegate implements ActivityExecutionDelegate {
    public readonly runtimeKind = "local" as const;
    public readonly supportedActivityKinds = new Set([
        "dacpac.extract",
        "dacpac.deploy.preview",
        "dacpac.deploy.container",
        "schema.compare",
        "schema.compare.export",
        "database.schema.visualize",
        "migration.apply",
        "migration.scope.validate",
    ]);
    private readonly ledger: RunbookEffectLedger;
    private readonly dacFx: DacFxClient;
    private readonly previews = new Map<string, RetainedPreview>();

    constructor(
        private readonly artifactRoot: string,
        extensionRoot: string,
        private readonly authority: HeadlessEffectAuthority,
        private readonly sql: HeadlessSqlActivityDelegate,
        private readonly ef: HeadlessEfActivityDelegate,
        dependencies: HeadlessDacpacActivityDependencies = {},
    ) {
        ensureArtifactRoot(artifactRoot);
        this.ledger = new RunbookEffectLedger(artifactRoot);
        this.dacFx = dependencies.dacFx ?? new HeadlessStsDacFxClient(extensionRoot);
    }

    public async executeActivity(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution | undefined> {
        if (!this.supportedActivityKinds.has(node.activityKind ?? "")) {
            return undefined;
        }
        try {
            switch (node.activityKind) {
                case "dacpac.extract":
                    return await this.extract(node, binding);
                case "dacpac.deploy.preview":
                    return await this.preview(node, binding);
                case "dacpac.deploy.container":
                    return await this.deploy(node, binding);
                case "schema.compare":
                    return await this.compare(node, binding, false);
                case "schema.compare.export":
                    return await this.compare(node, binding, true);
                case "database.schema.visualize":
                    return await this.visualize(node, binding);
                case "migration.apply":
                    return await this.applyMigration(node, binding);
                case "migration.scope.validate":
                    return await this.validateMigration(node, binding);
            }
        } catch (error) {
            return failure(error);
        }
        return undefined;
    }

    public dispose(): Promise<void> {
        return this.dacFx.dispose();
    }

    public serviceVersion(isCancellationRequested: () => boolean): Promise<string | undefined> {
        return this.dacFx.serviceVersion?.(isCancellationRequested) ?? Promise.resolve(undefined);
    }

    private async extract(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution> {
        const databaseRef = requiredString(binding.resolveBind(node.inputs?.database));
        const databaseName = databaseNameValue(binding.resolveBind(node.inputs?.databaseName));
        const connectionString = await this.resolveConnectionString(
            databaseRef,
            databaseName,
            binding.invocation,
        );
        const artifactPath = createNewArtifactPath(
            this.artifactRoot,
            binding.invocation,
            node.id,
            `${safeFileName(databaseName)}.dacpac`,
        );
        let complete = false;
        try {
            const result = await this.dacFx.extract(
                connectionString,
                databaseName,
                artifactPath,
                binding.isCancellationRequested,
            );
            if (!result.success || !result.operationId) {
                throw codedError("HeadlessActivityHost.DacpacExtractFailed");
            }
            const artifact = await verifyDacpac(artifactPath, binding.isCancellationRequested);
            complete = true;
            return {
                success: true,
                message: `Extracted '${databaseName}' as a retained DACPAC.`,
                runMetrics: {
                    "extract.artifactSizeBytes": artifact.size,
                    "extract.completed": true,
                },
                output: {
                    contract: "dacpacArtifact/1",
                    scalars: {
                        databaseName,
                        operationId: result.operationId,
                        artifactPath,
                        artifactSizeBytes: artifact.size,
                        artifactSha256: artifact.sha256,
                        extractedAtUtc: new Date().toISOString(),
                        executionMode: "headless",
                    },
                },
                values: { databaseName, artifactPath, artifactSha256: artifact.sha256 },
            };
        } finally {
            if (!complete) {
                fs.rmSync(artifactPath, { force: true });
            }
        }
    }

    private async preview(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution> {
        const dacpacPath = requiredString(binding.resolveBind(node.inputs?.dacpac));
        const databaseRef = requiredString(binding.resolveBind(node.inputs?.database));
        const artifact = await verifyTrustedDacpac(
            this.artifactRoot,
            dacpacPath,
            binding.isCancellationRequested,
        );
        const target = await this.sql.resolveOwnedConnection(databaseRef, binding.invocation);
        const preview = await this.generatePreview(
            artifact.path,
            target.connectionString,
            target.databaseName,
            binding.isCancellationRequested,
        );
        boundedSet(this.previews, preview.reportSha256, {
            runId: binding.invocation.runId,
            dacpacSha256: artifact.sha256,
            databaseRef,
            preview,
        });
        return previewExecution(preview);
    }

    private async deploy(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution> {
        const dacpacPath = requiredString(binding.resolveBind(node.inputs?.dacpac));
        const databaseRef = requiredString(binding.resolveBind(node.inputs?.database));
        const artifactDigest = requiredString(binding.resolveBind(node.inputs?.artifactDigest));
        const previewDigest = requiredString(binding.resolveBind(node.inputs?.previewDigest));
        const authorization = this.authority.require(
            node.id,
            "dacpac.deploy.container",
            binding.invocation,
        );
        const artifact = await verifyTrustedDacpac(
            this.artifactRoot,
            dacpacPath,
            binding.isCancellationRequested,
        );
        const retainedPreview = this.previews.get(previewDigest);
        if (
            artifact.sha256 !== artifactDigest ||
            !retainedPreview ||
            retainedPreview.runId !== binding.invocation.runId ||
            retainedPreview.dacpacSha256 !== artifactDigest ||
            retainedPreview.databaseRef !== databaseRef
        ) {
            throw codedError("HeadlessActivityHost.DeploymentPreviewChanged");
        }
        const target = await this.sql.resolveOwnedConnection(databaseRef, binding.invocation);
        const effectId = effectIdentity(
            this.ledger,
            node,
            binding.invocation,
            authorization,
            "dacpac.deploy.container",
            target.containerName,
            target.effectId,
            { artifactDigest, previewDigest, databaseName: target.databaseName },
        );
        const stagedPath = createNewArtifactPath(
            this.artifactRoot,
            binding.invocation,
            node.id,
            "approved-deploy.dacpac.stage",
        );
        try {
            fs.copyFileSync(artifact.path, stagedPath, fs.constants.COPYFILE_EXCL);
            const staged = await verifyDacpac(stagedPath, binding.isCancellationRequested);
            if (staged.sha256 !== artifactDigest) {
                this.ledger.recordNoEffectFailure(effectId, "ArtifactChangedBeforePublish");
                throw codedError("HeadlessActivityHost.DeploymentPreviewChanged");
            }
            const result = await this.dacFx.deploy(
                target.connectionString,
                target.databaseName,
                stagedPath,
                binding.isCancellationRequested,
            );
            if (!result.success || !result.operationId) {
                this.ledger.requireOperatorDecision(effectId, "DacpacPublishFailedOrUnknown");
                throw codedError("HeadlessActivityHost.DacpacDeployFailed");
            }
            this.ledger.recordEffectObserved(effectId, {
                resourceKind: "dacpacDeployment",
                resourceId: target.containerName,
                ownershipMarkerDigest: digestRunbookValue(target.effectId),
                connectionProfileId: target.connectionRef,
                outputHandles: [databaseRef, result.operationId],
            });
            const postDeploy = await this.generatePreview(
                artifact.path,
                target.connectionString,
                target.databaseName,
                () => false,
            );
            this.ledger.finalizeEffect(
                effectId,
                digestRunbookValue({
                    effectId,
                    artifactDigest,
                    previewDigest,
                    postDeployReportSha256: postDeploy.reportSha256,
                    postDeployChangeCount: postDeploy.changeCount,
                }),
            );
            return {
                success: true,
                message: `Deployed the approved DACPAC to owned database '${target.databaseName}'.`,
                runMetrics: {
                    "deployment.applied": true,
                    "deployment.postDeployChangeCount": postDeploy.changeCount,
                },
                output: {
                    contract: "deploymentEvidence/1",
                    scalars: {
                        effectId,
                        dacpacPath: artifact.path,
                        artifactSha256: artifact.sha256,
                        stagedArtifactSha256: staged.sha256,
                        databaseName: target.databaseName,
                        operationId: result.operationId,
                        approvedPreviewDigest: previewDigest,
                        postDeployReportSha256: postDeploy.reportSha256,
                        postDeployChangeCount: postDeploy.changeCount,
                        deployedAtUtc: new Date().toISOString(),
                        executionMode: "headless",
                    },
                },
                values: {
                    deployed: true,
                    postDeployChangeCount: postDeploy.changeCount,
                    artifactSha256: artifact.sha256,
                },
            };
        } finally {
            fs.rmSync(stagedPath, { force: true });
        }
    }

    private async compare(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
        retain: boolean,
    ): Promise<NodeExecution> {
        const dacpacPath = requiredString(binding.resolveBind(node.inputs?.dacpac));
        const databaseRef = requiredString(binding.resolveBind(node.inputs?.database));
        const artifact = await verifyTrustedDacpac(
            this.artifactRoot,
            dacpacPath,
            binding.isCancellationRequested,
        );
        const target = await this.sql.resolveOwnedConnection(databaseRef, binding.invocation);
        const preview = await this.generatePreview(
            artifact.path,
            target.connectionString,
            target.databaseName,
            binding.isCancellationRequested,
        );
        const matches = preview.changeCount === 0;
        if (!retain) {
            return {
                success: matches,
                verdict: matches ? "pass" : "fail",
                errorCode: matches ? undefined : "RunbookStudio.SchemaDriftDetected",
                message: matches
                    ? "The owned database matches the DACPAC."
                    : `Detected ${preview.changeCount} schema change(s).`,
                runMetrics: {
                    "schema.alertCount": preview.alertCount,
                    "schema.changeCount": preview.changeCount,
                    "schema.matches": matches,
                },
                output: {
                    contract: "schemaDiff/1",
                    text: preview.reportXml,
                    scalars: { ...previewScalars(preview), matches, executionMode: "headless" },
                },
                values: {
                    matches,
                    changeCount: preview.changeCount,
                    reportSha256: preview.reportSha256,
                },
            };
        }
        const document = schemaCompareDocument(preview, artifact.path, target.databaseName);
        const reportPath = retainBytes(
            this.artifactRoot,
            binding.invocation,
            node.id,
            "schema-comparison.xml",
            Buffer.from(preview.reportXml, "utf8"),
        );
        const documentBytes = Buffer.from(JSON.stringify(document, undefined, 2) + "\n", "utf8");
        const retained = retainBytes(
            this.artifactRoot,
            binding.invocation,
            node.id,
            "schema-comparison.json",
            documentBytes,
        );
        return {
            success: true,
            message: `Exported ${preview.changeCount} schema difference(s).`,
            runMetrics: {
                "schema.alertCount": preview.alertCount,
                "schema.changeCount": preview.changeCount,
                "schema.matches": matches,
                "schema.exported": true,
                "schema.exportSizeBytes": retained.size,
            },
            output: {
                contract: "schemaCompareDocument/1",
                text: JSON.stringify(document),
                scalars: {
                    ...previewScalars(preview),
                    matches,
                    artifactPath: retained.path,
                    artifactSizeBytes: retained.size,
                    artifactSha256: retained.sha256,
                    deploymentReportArtifactPath: reportPath.path,
                    exportedAtUtc: new Date().toISOString(),
                    executionMode: "headless",
                },
            },
            values: {
                matches,
                changeCount: preview.changeCount,
                reportSha256: preview.reportSha256,
                artifactPath: retained.path,
                artifactSha256: retained.sha256,
            },
        };
    }

    private async applyMigration(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution> {
        const databaseRef = requiredString(binding.resolveBind(node.inputs?.database));
        const migrationRef = requiredString(binding.resolveBind(node.inputs?.migration));
        const manifestDigest = requiredString(binding.resolveBind(node.inputs?.manifestDigest));
        const forwardDigest = requiredString(binding.resolveBind(node.inputs?.forwardScriptDigest));
        const rollbackDigest = requiredString(
            binding.resolveBind(node.inputs?.rollbackScriptDigest),
        );
        const direction = binding.resolveBind(node.inputs?.direction);
        const timeout = binding.resolveBind(node.inputs?.timeoutSeconds) ?? 300;
        if (
            (direction !== "forward" && direction !== "rollback") ||
            typeof timeout !== "number" ||
            !Number.isSafeInteger(timeout) ||
            timeout < 1 ||
            timeout > 3600
        ) {
            throw codedError("HeadlessActivityHost.BindingInvalid");
        }
        const authorization = this.authority.require(
            node.id,
            "migration.apply",
            binding.invocation,
        );
        const migration = this.ef.resolveMigration(migrationRef, binding.invocation.runId);
        if (
            !migration ||
            migration.manifest.manifestSha256 !== manifestDigest ||
            migration.manifest.forwardScriptSha256 !== forwardDigest ||
            migration.manifest.rollbackScriptSha256 !== rollbackDigest
        ) {
            throw codedError("HeadlessActivityHost.DeploymentPreviewChanged");
        }
        const scriptPath =
            direction === "forward" ? migration.forwardScriptPath : migration.rollbackScriptPath;
        const expectedDigest = direction === "forward" ? forwardDigest : rollbackDigest;
        const script = readBoundedFile(scriptPath, MAX_MIGRATION_BYTES);
        if (sha256(script) !== expectedDigest) {
            throw codedError("HeadlessActivityHost.DeploymentPreviewChanged");
        }
        const target = await this.sql.resolveOwnedConnection(databaseRef, binding.invocation);
        const effectId = effectIdentity(
            this.ledger,
            node,
            binding.invocation,
            authorization,
            "migration.apply",
            target.containerName,
            target.effectId,
            { manifestDigest, scriptDigest: expectedDigest, direction },
        );
        const startedAt = Date.now();
        this.ledger.recordEffectObserved(effectId, {
            resourceKind: "migrationExecution",
            resourceId: target.containerName,
            ownershipMarkerDigest: digestRunbookValue(target.effectId),
            connectionProfileId: target.connectionRef,
            outputHandles: [databaseRef, migrationRef],
        });
        await this.sql.executeOwnedSql(
            databaseRef,
            script.toString("utf8"),
            binding.invocation,
            binding.isCancellationRequested,
            { tag: "headless-migration-apply", maxRows: 1, timeoutMs: timeout * 1000 },
        );
        const durationMs = Math.max(0, Date.now() - startedAt);
        this.ledger.finalizeEffect(
            effectId,
            digestRunbookValue({
                effectId,
                manifestDigest,
                scriptDigest: expectedDigest,
                direction,
                durationMs,
                operationCount: migration.manifest.operations.length,
            }),
        );
        return {
            success: true,
            message: `Applied ${migration.manifest.operations.length} reviewed ${direction} migration operation(s).`,
            runMetrics: {
                "migration.applied": true,
                "migration.applyDirection": direction,
                "migration.applyDurationMs": durationMs,
                "migration.appliedOperationCount": migration.manifest.operations.length,
            },
            output: {
                contract: "migrationExecution/1",
                scalars: {
                    effectId,
                    applied: true,
                    direction,
                    manifestSha256: manifestDigest,
                    scriptSha256: expectedDigest,
                    operationCount: migration.manifest.operations.length,
                    potentialDataLoss: migration.manifest.potentialDataLoss,
                    rollbackCompleteness: migration.manifest.rollbackCompleteness,
                    durationMs,
                    completedAtUtc: new Date().toISOString(),
                    executionMode: "headless",
                },
            },
            values: {
                applied: true,
                direction,
                manifestSha256: manifestDigest,
                scriptSha256: expectedDigest,
                operationCount: migration.manifest.operations.length,
                durationMs,
            },
        };
    }

    private async visualize(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution> {
        const databaseRef = requiredString(binding.resolveBind(node.inputs?.database));
        const context = await this.sql.ownedMetadataContext(databaseRef, binding.invocation);
        const store = new MetadataStore(() => Promise.resolve(context.service), {
            idleTtlMs: 0,
            maxIdleDatabases: 0,
        });
        try {
            const document = await new MetadataStoreRunbookSchemaGraphProvider(store).visualize({
                prepared: context.prepared,
                database: context.database,
                isCancellationRequested: binding.isCancellationRequested,
            });
            return {
                success: true,
                message: `Created an ERD with ${document.tables.length} table(s) and ${document.relationships.length} relationship(s).`,
                runMetrics: {
                    "schemaGraph.totalTables": document.totalTables,
                    "schemaGraph.renderedTables": document.tables.length,
                    "schemaGraph.relationships": document.relationships.length,
                    "schemaGraph.truncated": document.truncated,
                },
                output: {
                    contract: "databaseSchemaGraph/1",
                    text: JSON.stringify(document),
                    scalars: {
                        databaseName: document.databaseLabel,
                        totalTables: document.totalTables,
                        renderedTables: document.tables.length,
                        relationshipCount: document.relationships.length,
                        omittedTableCount: document.omittedTableCount,
                        omittedRelationshipCount: document.omittedRelationshipCount,
                        truncated: document.truncated,
                        executionMode: "headless",
                    },
                },
                values: {
                    totalTables: document.totalTables,
                    renderedTables: document.tables.length,
                    relationshipCount: document.relationships.length,
                    truncated: document.truncated,
                },
            };
        } finally {
            store.dispose();
        }
    }

    private async validateMigration(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution> {
        const databaseRef = requiredString(binding.resolveBind(node.inputs?.database));
        const migrationRef = requiredString(binding.resolveBind(node.inputs?.migration));
        const manifestDigest = requiredString(binding.resolveBind(node.inputs?.manifestDigest));
        const expectedState = binding.resolveBind(node.inputs?.expectedState);
        if (expectedState !== "head" && expectedState !== "base") {
            throw codedError("HeadlessActivityHost.BindingInvalid");
        }
        const migration = this.ef.resolveMigration(migrationRef, binding.invocation.runId);
        if (!migration || migration.manifest.manifestSha256 !== manifestDigest) {
            throw codedError("HeadlessActivityHost.TargetChanged");
        }
        const query = await this.sql.executeOwnedSql(
            databaseRef,
            LOCAL_EF_SCHEMA_SCOPE_SQL,
            binding.invocation,
            binding.isCancellationRequested,
            {
                tag: "headless-migration-convergence",
                maxRows: MAX_LOCAL_EF_SCHEMA_ROWS,
                timeoutMs: 120_000,
            },
        );
        const result = verifyLocalEfMigrationScope({
            expectedState,
            expected: expectedState === "head" ? migration.head : migration.base,
            manifest: migration.manifest,
            live: projectLocalEfLiveSchema(query.rows),
        });
        const { differences, ...summary } = result;
        return {
            success: result.converged,
            verdict: result.converged ? "pass" : "fail",
            errorCode: result.converged ? undefined : "RunbookStudio.SchemaDriftDetected",
            message: result.converged
                ? `The owned database converged to the reviewed ${expectedState} model.`
                : `Detected ${result.differenceCount} migration-scope difference(s).`,
            runMetrics: {
                "migration.converged": result.converged,
                "migration.convergenceDifferenceCount": result.differenceCount,
                "migration.convergenceScopeTableCount": result.scopeTableCount,
                "migration.convergenceCheckedObjectCount": result.checkedObjectCount,
            },
            output: {
                contract: "migrationConvergence/1",
                columns: ["kind", "objectType", "path", "property", "expected", "actual"],
                rows: differences.map((difference) => [
                    difference.kind,
                    difference.objectType,
                    difference.path,
                    difference.property,
                    difference.expected,
                    difference.actual,
                ]),
                scalars: { ...summary, executionMode: "headless" },
            },
            values: {
                converged: result.converged,
                differenceCount: result.differenceCount,
                comparisonSha256: result.comparisonSha256,
                expectedState: result.expectedState,
            },
        };
    }

    private async generatePreview(
        dacpacPath: string,
        connectionString: string,
        databaseName: string,
        isCancellationRequested: () => boolean,
    ): Promise<DeploymentPreview> {
        const result = await this.dacFx.deployPlan(
            connectionString,
            databaseName,
            dacpacPath,
            isCancellationRequested,
        );
        if (!result.success || !result.operationId || !result.report?.trim()) {
            throw codedError("HeadlessActivityHost.DeploymentReportInvalid");
        }
        return parseDeploymentReport(dacpacPath, databaseName, result.operationId, result.report);
    }

    private async resolveConnectionString(
        databaseRef: string,
        databaseName: string,
        invocation: ActivityInvocationIdentity,
    ): Promise<string> {
        try {
            const owned = await this.sql.resolveOwnedConnection(databaseRef, invocation);
            if (owned.databaseName !== databaseName) {
                throw codedError("HeadlessActivityHost.TargetChanged");
            }
            return owned.connectionString;
        } catch (error) {
            if (databaseRef.startsWith("runbook-sql-container:")) {
                throw error;
            }
        }
        const parsed = parseSqlConnectionString(databaseRef);
        if ("error" in parsed) {
            throw codedError("HeadlessActivityHost.ConnectionInvalid");
        }
        return [
            `Server=${quoteConnectionValue(parsed.parsed.server)}`,
            `Database=${quoteConnectionValue(databaseName)}`,
            ...(parsed.parsed.integrated
                ? ["Integrated Security=True"]
                : [
                      `User ID=${quoteConnectionValue(parsed.parsed.user!)}`,
                      `Password=${quoteConnectionValue(parsed.parsed.password ?? "")}`,
                  ]),
            ...(parsed.parsed.encrypt
                ? [`Encrypt=${quoteConnectionValue(parsed.parsed.encrypt)}`]
                : []),
            ...(parsed.parsed.trustServerCertificate !== undefined
                ? [
                      `TrustServerCertificate=${parsed.parsed.trustServerCertificate ? "True" : "False"}`,
                  ]
                : []),
            "Connect Timeout=30",
        ].join(";");
    }
}

function effectIdentity(
    ledger: RunbookEffectLedger,
    node: RunbookPlanNode,
    invocation: ActivityInvocationIdentity,
    authorization: ReturnType<HeadlessEffectAuthority["require"]>,
    activityKind: string,
    containerName: string,
    containerEffectId: string,
    idempotency: unknown,
): string {
    const effectId = deriveRunbookEffectId({
        runId: invocation.runId,
        nodeId: node.id,
        attempt: invocation.attempt,
        activityKind,
        activityVersion: authorization.challenge.activityVersion,
    });
    if (ledger.recoverEffect(effectId)) {
        throw codedError("HeadlessActivityHost.EffectRecoveryRequired");
    }
    ledger.prepareEffect({
        effectId,
        runId: invocation.runId,
        nodeId: node.id,
        attempt: invocation.attempt,
        activityKind,
        activityVersion: authorization.challenge.activityVersion,
        idempotencyKey: digestRunbookValue({ effectId, idempotency }),
        planHash: invocation.planHash,
        bindingDigest: authorization.challenge.resolvedArgumentDigest,
        targetFingerprint: authorization.challenge.targetFingerprint,
        retrySemantics: "atMostOnceUnknownOutcome",
        ownerPid: process.pid,
        policy: { version: authorization.challenge.policyVersion, outcome: "allowed" },
        approval: authorization.evidence,
        recovery: {
            resourceKind:
                activityKind === "migration.apply" ? "migrationExecution" : "dacpacDeployment",
            resourceId: containerName,
            connectionProfileId: `runbook-sql-container:${containerEffectId}`,
            ownershipMarkerDigest: digestRunbookValue(containerEffectId),
        },
    });
    return effectId;
}

function previewExecution(preview: DeploymentPreview): NodeExecution {
    return {
        success: true,
        message: `Previewed ${preview.changeCount} DACPAC deployment change(s).`,
        runMetrics: {
            "deployment.previewChangeCount": preview.changeCount,
            "deployment.previewAlertCount": preview.alertCount,
        },
        output: {
            contract: "deploymentPreview/1",
            text: preview.reportXml,
            scalars: { ...previewScalars(preview), executionMode: "headless" },
        },
        values: { changeCount: preview.changeCount, reportSha256: preview.reportSha256 },
    };
}

function previewScalars(preview: DeploymentPreview) {
    return {
        dacpacPath: preview.dacpacPath,
        targetDatabase: preview.targetDatabase,
        operationId: preview.operationId,
        changeCount: preview.changeCount,
        alertCount: preview.alertCount,
        operationSummary: preview.operationSummary,
        reportSha256: preview.reportSha256,
        reportTruncated: preview.reportTruncated,
        generatedAtUtc: preview.generatedAtUtc,
    };
}

function parseDeploymentReport(
    dacpacPath: string,
    targetDatabase: string,
    operationId: string,
    report: string,
): DeploymentPreview {
    let parseFailed = false;
    const document = new DOMParser({
        onError: (level) => {
            parseFailed ||= level !== "warning";
        },
    }).parseFromString(report, "application/xml");
    if (parseFailed || !document.documentElement) {
        throw codedError("HeadlessActivityHost.DeploymentReportInvalid");
    }
    const operationCounts = new Map<string, number>();
    const items: DeploymentPreview["items"] = [];
    let alertCount = 0;
    const elements = document.getElementsByTagName("*");
    for (let index = 0; index < elements.length; index++) {
        const element = elements.item(index);
        const localName = element && (element.localName || element.nodeName.split(":").at(-1));
        if (!element) {
            continue;
        }
        if (localName === "Alert") {
            alertCount++;
        }
        if (localName !== "Operation") {
            continue;
        }
        const operation = boundedLabel(element.getAttribute("Name")) || "Other";
        let count = 0;
        const children = element.getElementsByTagName("*");
        for (let childIndex = 0; childIndex < children.length; childIndex++) {
            const child = children.item(childIndex);
            if (!child || (child.localName || child.nodeName.split(":").at(-1)) !== "Item") {
                continue;
            }
            count++;
            if (items.length < MAX_COMPARE_ITEMS) {
                items.push({
                    operation,
                    objectType: boundedLabel(child.getAttribute("Type")) || "Object",
                    name:
                        boundedLabel(child.getAttribute("Value")) ||
                        boundedLabel(child.textContent) ||
                        "(unnamed)",
                });
            }
        }
        operationCounts.set(operation, (operationCounts.get(operation) ?? 0) + count);
    }
    const changeCount = [...operationCounts.values()].reduce((sum, count) => sum + count, 0);
    const bytes = Buffer.from(report, "utf8");
    return {
        dacpacPath,
        targetDatabase,
        operationId,
        changeCount,
        alertCount,
        operationSummary:
            [...operationCounts.entries()]
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([name, count]) => `${name}: ${count}`)
                .join("; ") || "No schema changes",
        reportSha256: sha256(bytes),
        reportXml:
            bytes.byteLength > MAX_REPORT_BYTES
                ? `${bytes.subarray(0, MAX_REPORT_BYTES).toString("utf8")}\n<!-- report projection truncated -->`
                : report,
        reportTruncated: bytes.byteLength > MAX_REPORT_BYTES,
        generatedAtUtc: new Date().toISOString(),
        items,
    };
}

function schemaCompareDocument(
    preview: DeploymentPreview,
    dacpacPath: string,
    databaseName: string,
): RunbookSchemaCompareDocument {
    return {
        schemaVersion: 1,
        source: { kind: "dacpac", label: path.basename(dacpacPath) },
        target: { kind: "database", label: databaseName },
        areEqual: preview.changeCount === 0,
        totalDifferences: preview.changeCount,
        items: preview.items.map((item, index) => ({
            id: `difference-${index + 1}`,
            action: compareAction(item.operation),
            objectType: item.objectType,
            sourceName: item.name,
            targetName: item.name,
        })),
        truncated: preview.items.length < preview.changeCount,
        omittedCount: Math.max(0, preview.changeCount - preview.items.length),
        provider: { kind: "sts-v1-dacfx-deployment-report", contractVersion: 1 },
    };
}

function compareAction(operation: string): "add" | "change" | "delete" | "unknown" {
    if (/create|add/iu.test(operation)) {
        return "add";
    }
    if (/drop|delete/iu.test(operation)) {
        return "delete";
    }
    if (/alter|change|update/iu.test(operation)) {
        return "change";
    }
    return "unknown";
}

async function verifyTrustedDacpac(
    artifactRoot: string,
    requestedPath: string,
    isCancellationRequested: () => boolean,
) {
    const root = fs.realpathSync(ensureArtifactRoot(artifactRoot));
    const resolved = fs.realpathSync(path.resolve(requestedPath));
    if (!isContained(root, resolved)) {
        throw codedError("HeadlessActivityHost.ArtifactOutsideRunDrop");
    }
    return { path: resolved, ...(await verifyDacpac(resolved, isCancellationRequested)) };
}

async function verifyDacpac(
    artifactPath: string,
    isCancellationRequested: () => boolean,
): Promise<{ size: number; sha256: string }> {
    if (isCancellationRequested()) {
        throw codedError("HeadlessActivityHost.ActivityCancelled");
    }
    const stat = fs.lstatSync(artifactPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 4 || stat.size > MAX_DACPAC_BYTES) {
        throw codedError("HeadlessActivityHost.DacpacArtifactInvalid");
    }
    const descriptor = fs.openSync(artifactPath, "r");
    const header = Buffer.alloc(4);
    try {
        fs.readSync(descriptor, header, 0, 4, 0);
    } finally {
        fs.closeSync(descriptor);
    }
    if (!header.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
        throw codedError("HeadlessActivityHost.DacpacArtifactInvalid");
    }
    return { size: stat.size, sha256: await sha256File(artifactPath, isCancellationRequested) };
}

function sha256File(filePath: string, isCancellationRequested: () => boolean): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath);
        stream.on("data", (chunk: Buffer) => {
            if (isCancellationRequested()) {
                stream.destroy(codedError("HeadlessActivityHost.ActivityCancelled"));
                return;
            }
            hash.update(chunk);
        });
        stream.once("error", reject);
        stream.once("end", () => resolve(hash.digest("hex")));
    });
}

function createNewArtifactPath(
    artifactRoot: string,
    invocation: ActivityInvocationIdentity,
    nodeId: string,
    fileName: string,
): string {
    if (
        !SAFE_ID.test(invocation.runId) ||
        !SAFE_ID.test(nodeId) ||
        path.basename(fileName) !== fileName
    ) {
        throw codedError("HeadlessActivityHost.ArtifactPathInvalid");
    }
    const root = ensureArtifactRoot(artifactRoot);
    const runDirectory = path.join(root, invocation.runId);
    fs.mkdirSync(runDirectory, { recursive: true });
    const stat = fs.lstatSync(runDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw codedError("HeadlessActivityHost.ArtifactPathInvalid");
    }
    const artifactPath = path.join(runDirectory, `${nodeId}.${fileName}`);
    if (fs.existsSync(artifactPath)) {
        throw codedError("HeadlessActivityHost.ArtifactExists");
    }
    return artifactPath;
}

function retainBytes(
    artifactRoot: string,
    invocation: ActivityInvocationIdentity,
    nodeId: string,
    fileName: string,
    bytes: Buffer,
) {
    const artifactPath = createNewArtifactPath(artifactRoot, invocation, nodeId, fileName);
    const descriptor = fs.openSync(artifactPath, "wx", 0o600);
    try {
        fs.writeFileSync(descriptor, bytes);
        fs.fsyncSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
    return { path: artifactPath, size: bytes.byteLength, sha256: sha256(bytes) };
}

function ensureArtifactRoot(root: string): string {
    const resolved = path.resolve(root);
    fs.mkdirSync(resolved, { recursive: true });
    const stat = fs.lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw codedError("HeadlessActivityHost.ArtifactPathInvalid");
    }
    return resolved;
}

function readBoundedFile(filePath: string, maximum: number): Buffer {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > maximum) {
        throw codedError("HeadlessActivityHost.ArtifactInvalid");
    }
    return fs.readFileSync(filePath);
}

function requiredString(value: unknown): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw codedError("HeadlessActivityHost.BindingInvalid");
    }
    return value.trim();
}

function databaseNameValue(value: unknown): string {
    const name = requiredString(value);
    if (name.length > 128 || /[\u0000-\u001f\u007f]/u.test(name)) {
        throw codedError("HeadlessActivityHost.BindingInvalid");
    }
    return name;
}

function safeFileName(value: string): string {
    return value.replace(/[^A-Za-z0-9_.-]/gu, "_").slice(0, 100) || "database";
}

function quoteConnectionValue(value: string): string {
    return `"${value.replace(/"/gu, '""')}"`;
}

function boundedLabel(value: string | null | undefined): string {
    return (value ?? "").trim().slice(0, 500);
}

function boundedSet<T>(map: Map<string, T>, key: string, value: T): void {
    map.set(key, value);
    while (map.size > 32) {
        map.delete(map.keys().next().value!);
    }
}

function sha256(value: Buffer): string {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function isContained(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return (
        relative !== "" &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
    );
}

function codedError(code: string): Error & { code: string } {
    const error = new Error(code) as Error & { code: string };
    error.code = code;
    return error;
}

function failure(error: unknown): NodeExecution {
    return {
        success: false,
        errorCode:
            typeof (error as { code?: unknown })?.code === "string"
                ? (error as { code: string }).code
                : "HeadlessActivityHost.DacpacActivityFailed",
        message:
            "The no-VS-Code DacFx or migration activity failed without exposing connection, credential, SQL, or data values.",
    };
}
