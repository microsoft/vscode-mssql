/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type {
    ActivityExecutionDelegate,
    ActivityInvocationIdentity,
    NodeExecution,
} from "../runtime/fakeRuntimeAdapter";
import type { RunbookPlanNode } from "../../sharedInterfaces/runbookStudio";
import { canonicalRunbookJson } from "../runbookDigest";
import { extractLocalEfRelationalModel } from "../runtime/localEfRelationalExtractor";
import {
    compareLocalEfRelationalModels,
    LocalEfRelationalDiff,
    LocalEfRelationalModel,
} from "../runtime/localEfRelationalModel";
import {
    analyzeLocalEfMigrationRisk,
    LocalEfMigrationRiskDocument,
} from "../runtime/localEfMigrationRisk";
import {
    generateLocalEfMigrationProposal,
    LocalEfMigrationManifest,
    parseLocalEfRenameDecisions,
} from "../runtime/localEfMigrationGenerator";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const MAX_MODELS = 16;
const MAX_DIFFS = 8;
const MAX_RISKS = 8;
const MAX_MIGRATIONS = 8;

interface RetainedModel {
    runId: string;
    model: LocalEfRelationalModel;
}

interface RetainedDiff {
    runId: string;
    diff: LocalEfRelationalDiff;
    base: LocalEfRelationalModel;
    head: LocalEfRelationalModel;
}

interface RetainedRisk {
    runId: string;
    risk: LocalEfMigrationRiskDocument;
    diffRef: string;
}

interface RetainedJson {
    artifactPath: string;
    artifactSizeBytes: number;
    artifactSha256: string;
}

export interface HeadlessEfMigrationArtifact {
    runId: string;
    manifest: LocalEfMigrationManifest;
    base: LocalEfRelationalModel;
    head: LocalEfRelationalModel;
    manifestPath: string;
    forwardScriptPath: string;
    rollbackScriptPath: string;
}

export class HeadlessEfActivityDelegate implements ActivityExecutionDelegate {
    public readonly runtimeKind = "local" as const;
    public readonly supportedActivityKinds = new Set([
        "ef.relational-model.extract",
        "ef.relational-model.compare",
        "migration.data-loss.analyze",
        "migration.script.generate",
    ]);
    private readonly models = new Map<string, RetainedModel>();
    private readonly diffs = new Map<string, RetainedDiff>();
    private readonly risks = new Map<string, RetainedRisk>();
    private readonly migrations = new Map<string, HeadlessEfMigrationArtifact>();

    constructor(
        private readonly trustedWorkspaceRoot: string,
        private readonly artifactRoot: string,
        private readonly extensionRoot: string,
    ) {}

    public async executeActivity(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution | undefined> {
        if (node.activityKind === "ef.relational-model.extract") {
            return this.extract(node, binding);
        }
        if (node.activityKind === "ef.relational-model.compare") {
            return this.compare(node, binding);
        }
        if (node.activityKind === "migration.data-loss.analyze") {
            return this.analyzeRisk(node, binding);
        }
        if (node.activityKind === "migration.script.generate") {
            return this.generateMigration(node, binding);
        }
        return undefined;
    }

    public resolveMigration(
        migrationRef: string,
        runId: string,
    ): HeadlessEfMigrationArtifact | undefined {
        const migration = this.migrations.get(migrationRef);
        return migration?.runId === runId ? migration : undefined;
    }

    private async extract(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution> {
        const repository = binding.resolveBind(node.inputs?.repository);
        const revision = binding.resolveBind(node.inputs?.revision);
        const project = binding.resolveBind(node.inputs?.project);
        const dbContext = binding.resolveBind(node.inputs?.dbContext);
        if (![repository, revision, project, dbContext].every(nonEmptyString)) {
            return bindingFailure();
        }
        ensureArtifactRoot(this.artifactRoot);
        const scratchParent = path.join(this.artifactRoot, ".scratch", binding.invocation.runId);
        try {
            const result = await extractLocalEfRelationalModel(
                {
                    repositoryPath: (repository as string).trim(),
                    revision: (revision as string).trim(),
                    projectPath: (project as string).trim(),
                    dbContext: (dbContext as string).trim(),
                    temporaryParentPath: scratchParent,
                    exporterProgramPath: path.join(
                        this.extensionRoot,
                        "resources",
                        "runbook-ef-exporter",
                        "Program.cs",
                    ),
                    trustedWorkspaceRoots: [this.trustedWorkspaceRoot],
                },
                binding.isCancellationRequested,
            );
            if (binding.isCancellationRequested()) {
                return cancelled();
            }
            const retained = retainJson(
                this.artifactRoot,
                binding.invocation,
                node.id,
                "ef-relational-model.json",
                result.model,
            );
            const modelRef = `headless-ef-model:${binding.invocation.runId}:${node.id}:${result.model.modelSha256}`;
            boundedSet(
                this.models,
                modelRef,
                {
                    runId: binding.invocation.runId,
                    model: result.model,
                },
                MAX_MODELS,
            );
            const columnCount = result.model.tables.reduce(
                (total, table) => total + table.columns.length,
                0,
            );
            return {
                success: true,
                message: `Extracted ${result.model.tables.length} table(s) and ${columnCount} column(s) from the exact EF revision.`,
                runMetrics: {
                    "ef.modelTableCount": result.model.tables.length,
                    "ef.modelColumnCount": columnCount,
                    "ef.modelComplete": result.model.complete,
                    "ef.modelUnsupportedCount": result.model.unsupported.length,
                },
                output: {
                    contract: "efRelationalModel/1",
                    columns: ["schema", "table", "columns", "indexes", "foreignKeys", "temporal"],
                    rows: result.model.tables.map((table) => [
                        table.schema,
                        table.name,
                        table.columns.length,
                        table.indexes.length,
                        table.foreignKeys.length,
                        table.temporal,
                    ]),
                    scalars: {
                        modelRef,
                        modelSha256: result.model.modelSha256,
                        commitSha256: result.model.source.commit,
                        provider: result.model.provider.name,
                        providerVersion: result.model.provider.version,
                        targetFramework: result.model.source.targetFramework,
                        tableCount: result.model.tables.length,
                        columnCount,
                        unsupportedCount: result.model.unsupported.length,
                        complete: result.model.complete,
                        diagnosticCount: result.diagnostics.length,
                        ...retained,
                        executionMode: "headless",
                    },
                },
                values: {
                    modelRef,
                    modelSha256: result.model.modelSha256,
                    commit: result.model.source.commit,
                    tableCount: result.model.tables.length,
                    complete: result.model.complete,
                },
            };
        } catch {
            return {
                success: false,
                errorCode: "HeadlessActivityHost.EfExtractionFailed",
                message: "The approval-gated exact-ref Entity Framework extraction failed.",
            };
        } finally {
            fs.rmSync(scratchParent, { recursive: true, force: true });
        }
    }

    private async compare(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution> {
        const baseRef = binding.resolveBind(node.inputs?.base);
        const headRef = binding.resolveBind(node.inputs?.head);
        if (!nonEmptyString(baseRef) || !nonEmptyString(headRef) || baseRef === headRef) {
            return bindingFailure();
        }
        const base = this.models.get(baseRef.trim());
        const head = this.models.get(headRef.trim());
        if (
            !base ||
            !head ||
            base.runId !== binding.invocation.runId ||
            head.runId !== binding.invocation.runId
        ) {
            return {
                success: false,
                errorCode: "HeadlessActivityHost.AuthorityInvalid",
                message: "The EF comparison inputs are not same-run host-owned models.",
            };
        }
        try {
            const diff = compareLocalEfRelationalModels(base.model, head.model);
            const retained = retainJson(
                this.artifactRoot,
                binding.invocation,
                node.id,
                "ef-relational-diff.json",
                diff,
            );
            const diffRef = `headless-ef-diff:${binding.invocation.runId}:${node.id}:${diff.diffSha256}`;
            boundedSet(
                this.diffs,
                diffRef,
                {
                    runId: binding.invocation.runId,
                    diff,
                    base: base.model,
                    head: head.model,
                },
                MAX_DIFFS,
            );
            const changeRows = diff.changes.map((change) => [
                "change",
                change.kind,
                change.objectType,
                change.path,
                change.risk,
                change.changedProperties.join(", "),
                null,
                null,
                null,
            ]);
            const renameRows = diff.renameCandidates.map((candidate) => [
                "renameCandidate",
                "reviewRename",
                candidate.objectType,
                candidate.toPath,
                "review",
                "name",
                candidate.fromPath,
                candidate.toPath,
                candidate.similarity,
            ]);
            return {
                success: true,
                message: `Compared exact EF models with ${diff.changes.length} change(s) and ${diff.renameCandidates.length} rename candidate(s).`,
                runMetrics: {
                    "ef.diffChangeCount": diff.changes.length,
                    "ef.diffDestructiveCount": diff.destructiveChangeCount,
                    "ef.diffRenameCandidateCount": diff.renameCandidates.length,
                    "ef.diffComparable": diff.comparable,
                },
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
                    rows: [...changeRows, ...renameRows],
                    scalars: {
                        diffRef,
                        diffSha256: diff.diffSha256,
                        baseModelSha256: diff.baseModelSha256,
                        headModelSha256: diff.headModelSha256,
                        comparable: diff.comparable,
                        reason: diff.reason,
                        changeCount: diff.changes.length,
                        destructiveChangeCount: diff.destructiveChangeCount,
                        reviewChangeCount: diff.reviewChangeCount,
                        renameCandidateCount: diff.renameCandidates.length,
                        requiresRenameDecision: diff.requiresRenameDecision,
                        potentialDataLoss: diff.potentialDataLoss,
                        ...retained,
                        executionMode: "headless",
                    },
                },
                values: {
                    diffRef,
                    diffSha256: diff.diffSha256,
                    comparable: diff.comparable,
                    changeCount: diff.changes.length,
                    requiresRenameDecision: diff.requiresRenameDecision,
                    potentialDataLoss: diff.potentialDataLoss,
                },
            };
        } catch {
            return {
                success: false,
                errorCode: "HeadlessActivityHost.EfComparisonFailed",
                message: "The same-run Entity Framework model comparison failed.",
            };
        }
    }

    private async analyzeRisk(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution> {
        const diffRef = binding.resolveBind(node.inputs?.diff);
        if (!nonEmptyString(diffRef)) {
            return bindingFailure();
        }
        const source = this.diffs.get(diffRef.trim());
        if (!source || source.runId !== binding.invocation.runId) {
            return authorityFailure("The migration-risk input is not a same-run host-owned diff.");
        }
        try {
            const risk = analyzeLocalEfMigrationRisk(source.diff);
            const retained = retainJson(
                this.artifactRoot,
                binding.invocation,
                node.id,
                "migration-risk.json",
                risk,
            );
            const riskRef = `headless-ef-risk:${binding.invocation.runId}:${node.id}:${risk.riskSha256}`;
            boundedSet(
                this.risks,
                riskRef,
                { runId: binding.invocation.runId, risk, diffRef: diffRef.trim() },
                MAX_RISKS,
            );
            return {
                success: true,
                message: `Analyzed migration risk with ${risk.blockerCount} blocker(s) and ${risk.reviewCount} review item(s).`,
                runMetrics: {
                    "migration.riskBlockerCount": risk.blockerCount,
                    "migration.riskReviewCount": risk.reviewCount,
                    "migration.potentialDataLoss": risk.potentialDataLoss,
                    "migration.renameDecisionRequired": risk.requiresRenameDecision,
                },
                output: {
                    contract: "migrationRisk/1",
                    columns: [
                        "code",
                        "severity",
                        "objectType",
                        "path",
                        "changeKind",
                        "potentialDataLoss",
                        "detail",
                    ],
                    rows: risk.items.map((item) => [
                        item.code,
                        item.severity,
                        item.objectType,
                        item.path,
                        item.changeKind,
                        item.potentialDataLoss,
                        item.detail,
                    ]),
                    scalars: {
                        riskRef,
                        riskSha256: risk.riskSha256,
                        diffSha256: risk.diffSha256,
                        status: risk.status,
                        comparable: risk.comparable,
                        potentialDataLoss: risk.potentialDataLoss,
                        requiresRenameDecision: risk.requiresRenameDecision,
                        blockerCount: risk.blockerCount,
                        reviewCount: risk.reviewCount,
                        ...retained,
                        executionMode: "headless",
                    },
                },
                values: {
                    riskRef,
                    riskSha256: risk.riskSha256,
                    status: risk.status,
                    potentialDataLoss: risk.potentialDataLoss,
                    requiresRenameDecision: risk.requiresRenameDecision,
                    blockerCount: risk.blockerCount,
                    reviewCount: risk.reviewCount,
                },
            };
        } catch {
            return {
                success: false,
                errorCode: "HeadlessActivityHost.EfRiskAnalysisFailed",
                message: "The same-run Entity Framework migration-risk analysis failed.",
            };
        }
    }

    private async generateMigration(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution> {
        const diffRef = binding.resolveBind(node.inputs?.diff);
        const riskRef = binding.resolveBind(node.inputs?.risk);
        const renameDecisions = binding.resolveBind(node.inputs?.renameDecisions);
        if (
            !nonEmptyString(diffRef) ||
            !nonEmptyString(riskRef) ||
            typeof renameDecisions !== "string"
        ) {
            return bindingFailure();
        }
        const source = this.diffs.get(diffRef.trim());
        const risk = this.risks.get(riskRef.trim());
        if (
            !source ||
            !risk ||
            source.runId !== binding.invocation.runId ||
            risk.runId !== binding.invocation.runId ||
            risk.diffRef !== diffRef.trim()
        ) {
            return authorityFailure("The migration inputs are not one same-run host-owned chain.");
        }
        const createdArtifacts: string[] = [];
        try {
            if (binding.isCancellationRequested()) {
                return cancelled();
            }
            const proposal = generateLocalEfMigrationProposal({
                base: source.base,
                head: source.head,
                diff: source.diff,
                risk: risk.risk,
                renameDecisions: parseLocalEfRenameDecisions(renameDecisions),
            });
            const manifest = retainJson(
                this.artifactRoot,
                binding.invocation,
                node.id,
                "migration-manifest.json",
                proposal.manifest,
            );
            createdArtifacts.push(manifest.artifactPath);
            const forward = retainText(
                this.artifactRoot,
                binding.invocation,
                node.id,
                "migration-forward.sql",
                proposal.forwardSql,
            );
            createdArtifacts.push(forward.artifactPath);
            const rollback = retainText(
                this.artifactRoot,
                binding.invocation,
                node.id,
                "migration-rollback.sql",
                proposal.rollbackSql,
            );
            createdArtifacts.push(rollback.artifactPath);
            if (binding.isCancellationRequested()) {
                for (const artifactPath of createdArtifacts) {
                    fs.rmSync(artifactPath, { force: true });
                }
                return cancelled();
            }
            const migrationRef = `headless-ef-migration:${binding.invocation.runId}:${node.id}:${proposal.manifest.manifestSha256}`;
            boundedSet(
                this.migrations,
                migrationRef,
                {
                    runId: binding.invocation.runId,
                    manifest: proposal.manifest,
                    base: source.base,
                    head: source.head,
                    manifestPath: manifest.artifactPath,
                    forwardScriptPath: forward.artifactPath,
                    rollbackScriptPath: rollback.artifactPath,
                },
                MAX_MIGRATIONS,
            );
            return migrationExecution(proposal.manifest, migrationRef, manifest, forward, rollback);
        } catch {
            for (const artifactPath of createdArtifacts) {
                fs.rmSync(artifactPath, { force: true });
            }
            return {
                success: false,
                errorCode: "HeadlessActivityHost.EfMigrationGenerationFailed",
                message: "The reviewed Entity Framework migration could not be generated.",
            };
        }
    }
}

function retainJson(
    artifactRoot: string,
    invocation: ActivityInvocationIdentity,
    nodeId: string,
    fileName: string,
    value: unknown,
): RetainedJson {
    return retainBytes(
        artifactRoot,
        invocation,
        nodeId,
        fileName,
        Buffer.from(canonicalRunbookJson(value), "utf8"),
    );
}

function retainText(
    artifactRoot: string,
    invocation: ActivityInvocationIdentity,
    nodeId: string,
    fileName: string,
    value: string,
): RetainedJson {
    return retainBytes(artifactRoot, invocation, nodeId, fileName, Buffer.from(value, "utf8"));
}

function retainBytes(
    artifactRoot: string,
    invocation: ActivityInvocationIdentity,
    nodeId: string,
    fileName: string,
    bytes: Buffer,
): RetainedJson {
    if (!SAFE_ID.test(invocation.runId) || !SAFE_ID.test(nodeId)) {
        throw new Error("unsafe identity");
    }
    const root = ensureArtifactRoot(artifactRoot);
    const runDirectory = path.join(root, invocation.runId);
    try {
        fs.mkdirSync(runDirectory);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
            throw error;
        }
    }
    const runStat = fs.lstatSync(runDirectory);
    if (!runStat.isDirectory() || runStat.isSymbolicLink()) {
        throw new Error("unsafe run directory");
    }
    const artifactPath = path.join(runDirectory, `${nodeId}.${fileName}`);
    let created = false;
    try {
        const descriptor = fs.openSync(artifactPath, "wx", 0o600);
        created = true;
        try {
            fs.writeFileSync(descriptor, bytes);
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }
    } catch (error) {
        if (created) {
            fs.rmSync(artifactPath, { force: true });
        }
        throw error;
    }
    return {
        artifactPath,
        artifactSizeBytes: bytes.byteLength,
        artifactSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
}

function ensureArtifactRoot(artifactRoot: string): string {
    const root = path.resolve(artifactRoot);
    fs.mkdirSync(root, { recursive: true });
    const rootStat = fs.lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        throw new Error("unsafe artifact root");
    }
    return root;
}

function migrationExecution(
    manifest: LocalEfMigrationManifest,
    migrationRef: string,
    retainedManifest: RetainedJson,
    forward: RetainedJson,
    rollback: RetainedJson,
): NodeExecution {
    return {
        success: true,
        message: `Generated ${manifest.operations.length} reviewed migration operation(s) with ${manifest.rollbackCompleteness} rollback.`,
        runMetrics: {
            "migration.operationCount": manifest.operations.length,
            "migration.potentialDataLoss": manifest.potentialDataLoss,
            "migration.rollbackComplete": manifest.rollbackCompleteness === "complete",
            "migration.forwardScriptSizeBytes": forward.artifactSizeBytes,
            "migration.rollbackScriptSizeBytes": rollback.artifactSizeBytes,
        },
        output: {
            contract: "migrationManifest/1",
            columns: [
                "sequence",
                "kind",
                "objectType",
                "path",
                "risk",
                "forwardStatements",
                "rollbackStatements",
            ],
            rows: manifest.operations.map((operation) => [
                operation.sequence,
                operation.kind,
                operation.objectType,
                operation.path,
                operation.risk,
                operation.forwardStatementCount,
                operation.rollbackStatementCount,
            ]),
            scalars: {
                migrationRef,
                manifestSha256: manifest.manifestSha256,
                forwardScriptSha256: manifest.forwardScriptSha256,
                rollbackScriptSha256: manifest.rollbackScriptSha256,
                operationCount: manifest.operations.length,
                potentialDataLoss: manifest.potentialDataLoss,
                rollbackCompleteness: manifest.rollbackCompleteness,
                artifactPath: retainedManifest.artifactPath,
                artifactSizeBytes: retainedManifest.artifactSizeBytes,
                artifactSha256: retainedManifest.artifactSha256,
                forwardScriptPath: forward.artifactPath,
                forwardScriptSizeBytes: forward.artifactSizeBytes,
                rollbackScriptPath: rollback.artifactPath,
                rollbackScriptSizeBytes: rollback.artifactSizeBytes,
                executionMode: "headless",
            },
        },
        values: {
            migrationRef,
            manifestSha256: manifest.manifestSha256,
            forwardScriptSha256: manifest.forwardScriptSha256,
            rollbackScriptSha256: manifest.rollbackScriptSha256,
            operationCount: manifest.operations.length,
            potentialDataLoss: manifest.potentialDataLoss,
            rollbackCompleteness: manifest.rollbackCompleteness,
        },
    };
}

function boundedSet<T>(map: Map<string, T>, key: string, value: T, maximum: number): void {
    if (map.size >= maximum) {
        const oldest = map.keys().next().value;
        if (typeof oldest === "string") {
            map.delete(oldest);
        }
    }
    map.set(key, value);
}

function nonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function bindingFailure(): NodeExecution {
    return {
        success: false,
        errorCode: "HeadlessActivityHost.BindingInvalid",
        message: "The Entity Framework activity has an invalid binding.",
    };
}

function authorityFailure(message: string): NodeExecution {
    return {
        success: false,
        errorCode: "HeadlessActivityHost.AuthorityInvalid",
        message,
    };
}

function cancelled(): NodeExecution {
    return {
        success: false,
        errorCode: "HeadlessActivityHost.ActivityCancelled",
        message: "The Entity Framework extraction was cancelled.",
    };
}
