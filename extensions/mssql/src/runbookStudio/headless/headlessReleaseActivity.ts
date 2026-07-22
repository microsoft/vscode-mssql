/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Canonical no-VS-Code release-candidate manifest activity. */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { config } from "../../configurations/config";
import type { RunbookPlanNode } from "../../sharedInterfaces/runbookStudio";
import {
    buildLocalReleaseManifest,
    type LocalReleaseManifestInput,
} from "../runtime/localReleaseManifest";
import {
    persistLocalReleaseManifestArtifact,
    verifyLocalReleaseEvidenceArtifacts,
} from "../runtime/localReleaseManifestArtifact";
import { buildLocalToolchainProvenance } from "../runtime/localToolchainProvenance";
import type {
    ActivityExecutionDelegate,
    ActivityInvocationIdentity,
    NodeExecution,
} from "../runtime/fakeRuntimeAdapter";
import { HeadlessDacpacActivityDelegate } from "./headlessDacpacActivity";
import { HeadlessSqlActivityDelegate } from "./headlessSqlActivity";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;

export class HeadlessReleaseActivityDelegate implements ActivityExecutionDelegate {
    public readonly runtimeKind = "local" as const;
    public readonly supportedActivityKinds = new Set(["release.manifest.create"]);

    constructor(
        private readonly runbookId: string,
        private readonly artifactRoot: string,
        private readonly extensionRoot: string,
        private readonly sql: HeadlessSqlActivityDelegate,
        private readonly dacpac: HeadlessDacpacActivityDelegate,
    ) {}

    public async executeActivity(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution | undefined> {
        if (node.activityKind !== "release.manifest.create") {
            return undefined;
        }
        try {
            return await this.createManifest(node, binding);
        } catch (error) {
            return {
                success: false,
                errorCode:
                    typeof (error as { code?: unknown })?.code === "string"
                        ? (error as { code: string }).code
                        : "HeadlessActivityHost.ReleaseManifestFailed",
                message:
                    "The release-candidate manifest was refused because its same-run evidence was incomplete or changed.",
            };
        }
    }

    private async createManifest(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution> {
        const input: Omit<
            LocalReleaseManifestInput,
            "runId" | "runbookId" | "planRevision" | "planHash" | "toolchain"
        > = {
            baseCommit: requiredString(binding.resolveBind(node.inputs?.baseCommit)),
            headCommit: requiredString(binding.resolveBind(node.inputs?.headCommit)),
            changeSetSha256: digest(binding.resolveBind(node.inputs?.changeSetDigest)),
            baseModelSha256: digest(binding.resolveBind(node.inputs?.baseModelDigest)),
            headModelSha256: digest(binding.resolveBind(node.inputs?.headModelDigest)),
            modelDiffSha256: digest(binding.resolveBind(node.inputs?.modelDiffDigest)),
            migrationManifestSha256: digest(
                binding.resolveBind(node.inputs?.migrationManifestDigest),
            ),
            baseDacpacSha256: digest(binding.resolveBind(node.inputs?.baseDacpacDigest)),
            baseSchemaReportSha256: digest(
                binding.resolveBind(node.inputs?.baseSchemaReportDigest),
            ),
            forwardConvergenceSha256: digest(
                binding.resolveBind(node.inputs?.forwardConvergenceDigest),
            ),
            forwardConverged: requiredBoolean(binding.resolveBind(node.inputs?.forwardConverged)),
            workloadSha256: digest(binding.resolveBind(node.inputs?.workloadDigest)),
            workloadFingerprint: digest(binding.resolveBind(node.inputs?.workloadFingerprint)),
            environmentFingerprint: digest(
                binding.resolveBind(node.inputs?.environmentFingerprint),
            ),
            beforeSchemaSha256: requiredString(
                binding.resolveBind(node.inputs?.beforeSchemaDigest),
            ),
            afterSchemaSha256: requiredString(binding.resolveBind(node.inputs?.afterSchemaDigest)),
            performanceDeltaSha256: digest(
                binding.resolveBind(node.inputs?.performanceDeltaDigest),
            ),
            schemaComparability: requiredString(
                binding.resolveBind(node.inputs?.schemaComparability),
            ),
            failedBatchCount: requiredNonnegativeInteger(
                binding.resolveBind(node.inputs?.failedBatchCount),
            ),
            xelSha256: digest(binding.resolveBind(node.inputs?.xelDigest)),
            captureComplete: requiredBoolean(binding.resolveBind(node.inputs?.captureComplete)),
            candidateDacpacSha256: digest(binding.resolveBind(node.inputs?.candidateDacpacDigest)),
        };
        const baseDacpacNode = producerNodeId(node, "baseDacpacDigest");
        const xelNode = producerNodeId(node, "xelDigest");
        const candidateDacpacNode = producerNodeId(node, "candidateDacpacDigest");
        if (!baseDacpacNode || !xelNode || !candidateDacpacNode) {
            throw codedError("HeadlessActivityHost.ReleaseEvidenceBindingInvalid");
        }
        const evidenceValues = new Map<string, Record<string, string | number | boolean>>();
        for (const evidence of [
            {
                nodeId: baseDacpacNode,
                contract: "dacpacArtifact/1" as const,
                digest: input.baseDacpacSha256,
                extension: ".dacpac",
            },
            {
                nodeId: xelNode,
                contract: "xelArtifact/1" as const,
                digest: input.xelSha256,
                extension: ".xel",
            },
            {
                nodeId: candidateDacpacNode,
                contract: "dacpacArtifact/1" as const,
                digest: input.candidateDacpacSha256,
                extension: ".dacpac",
            },
        ]) {
            const artifact = findSameRunArtifact(
                this.artifactRoot,
                binding.invocation,
                evidence.nodeId,
                evidence.extension,
                evidence.digest,
            );
            evidenceValues.set(evidence.nodeId, {
                artifactPath: artifact.path,
                artifactSha256: artifact.sha256,
                artifactSizeBytes: artifact.size,
            });
        }
        await verifyLocalReleaseEvidenceArtifacts({
            evidenceValues,
            required: [
                {
                    nodeId: baseDacpacNode,
                    contract: "dacpacArtifact/1",
                    expectedSha256: input.baseDacpacSha256,
                },
                {
                    nodeId: xelNode,
                    contract: "xelArtifact/1",
                    expectedSha256: input.xelSha256,
                },
                {
                    nodeId: candidateDacpacNode,
                    contract: "dacpacArtifact/1",
                    expectedSha256: input.candidateDacpacSha256,
                },
            ],
            trustedRoots: [path.resolve(this.artifactRoot)],
            isCancellationRequested: binding.isCancellationRequested,
        });
        const toolchain = await this.toolchain(binding.isCancellationRequested);
        const manifest = buildLocalReleaseManifest({
            ...input,
            runId: binding.invocation.runId,
            runbookId: this.runbookId,
            planRevision: binding.invocation.planRevision,
            planHash: binding.invocation.planHash,
            toolchain,
        });
        const artifactPath = createNewArtifactPath(
            this.artifactRoot,
            binding.invocation,
            node.id,
            "release-manifest.json",
        );
        const artifact = await persistLocalReleaseManifestArtifact(
            artifactPath,
            manifest,
            binding.isCancellationRequested,
        );
        return {
            success: true,
            message: `Created a release-candidate manifest with ${manifest.evidenceCount} evidence item(s).`,
            runMetrics: {
                "releaseManifest.evidenceCount": manifest.evidenceCount,
                "releaseManifest.evidenceComplete": manifest.evidenceComplete,
                "releaseManifest.protectedDeploymentAuthorized": false,
            },
            output: {
                contract: "releaseManifest/1",
                text: manifest.manifestJson,
                scalars: {
                    manifestSha256: manifest.manifestSha256,
                    artifactPath: artifact.artifactPath,
                    artifactSha256: artifact.artifactSha256,
                    artifactSizeBytes: artifact.artifactSizeBytes,
                    evidenceCount: manifest.evidenceCount,
                    evidenceComplete: manifest.evidenceComplete,
                    protectedDeploymentAuthorized: false,
                    generatedAtUtc: manifest.generatedAtUtc,
                    executionMode: "headless",
                },
            },
            values: {
                manifestSha256: manifest.manifestSha256,
                artifactPath: artifact.artifactPath,
                artifactSha256: artifact.artifactSha256,
                evidenceCount: manifest.evidenceCount,
                evidenceComplete: manifest.evidenceComplete,
                protectedDeploymentAuthorized: false,
            },
        };
    }

    private async toolchain(isCancellationRequested: () => boolean) {
        const packageJson = boundedJson(path.join(this.extensionRoot, "package.json"));
        const serviceRoot = installedServiceRoot(this.extensionRoot);
        const [serviceVersion, dockerEngineVersion] = await Promise.all([
            this.dacpac.serviceVersion(isCancellationRequested),
            this.sql.dockerEngineVersion(),
        ]);
        if (isCancellationRequested()) {
            throw codedError("HeadlessActivityHost.ActivityCancelled");
        }
        return buildLocalToolchainProvenance({
            vscodeVersion: undefined,
            headlessRunnerVersion: packageJson.version,
            mssqlExtensionVersion: packageJson.version,
            sqlDatabaseProjectsExtensionVersion: undefined,
            sqlToolsServiceRuntimeVersion: serviceVersion,
            sqlToolsServiceConfiguredVersion: config.service.version,
            sqlToolsServiceRoot: serviceRoot,
            dockerEngineVersion,
        });
    }
}

function findSameRunArtifact(
    artifactRoot: string,
    invocation: ActivityInvocationIdentity,
    nodeId: string,
    extension: string,
    expectedSha256: string,
): { path: string; size: number; sha256: string } {
    if (!SAFE_ID.test(invocation.runId) || !SAFE_ID.test(nodeId)) {
        throw codedError("HeadlessActivityHost.ArtifactPathInvalid");
    }
    const root = fs.realpathSync(path.resolve(artifactRoot));
    const runDirectory = fs.realpathSync(path.join(root, invocation.runId));
    if (!isContained(root, runDirectory)) {
        throw codedError("HeadlessActivityHost.ArtifactPathInvalid");
    }
    const candidates = fs
        .readdirSync(runDirectory)
        .filter(
            (name) =>
                name.startsWith(`${nodeId}.`) &&
                name.toLowerCase().endsWith(extension.toLowerCase()),
        );
    if (candidates.length !== 1) {
        throw codedError("HeadlessActivityHost.ReleaseEvidenceChanged");
    }
    const artifactPath = path.join(runDirectory, candidates[0]);
    const stat = fs.lstatSync(artifactPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) {
        throw codedError("HeadlessActivityHost.ReleaseEvidenceChanged");
    }
    const sha256 = crypto.createHash("sha256").update(fs.readFileSync(artifactPath)).digest("hex");
    if (sha256 !== expectedSha256) {
        throw codedError("HeadlessActivityHost.ReleaseEvidenceChanged");
    }
    return { path: artifactPath, size: stat.size, sha256 };
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
    const root = path.resolve(artifactRoot);
    fs.mkdirSync(root, { recursive: true });
    const runDirectory = path.join(root, invocation.runId);
    fs.mkdirSync(runDirectory, { recursive: true });
    const artifactPath = path.join(runDirectory, `${nodeId}.${fileName}`);
    if (fs.existsSync(artifactPath)) {
        throw codedError("HeadlessActivityHost.ArtifactExists");
    }
    return artifactPath;
}

function producerNodeId(node: RunbookPlanNode, inputName: string): string | undefined {
    return /^\$nodes\.([A-Za-z0-9_.:-]+)\.[A-Za-z0-9_.:-]+$/u.exec(
        String(node.inputs?.[inputName] ?? ""),
    )?.[1];
}

function installedServiceRoot(extensionRoot: string): string | undefined {
    const versionRoot = path.join(extensionRoot, "sqltoolsservice", config.service.version);
    try {
        return fs
            .readdirSync(versionRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
            .map((entry) => path.join(versionRoot, entry.name))
            .find((candidate) =>
                fs.existsSync(path.join(candidate, "MicrosoftSqlToolsServiceLayer.deps.json")),
            );
    } catch {
        return undefined;
    }
}

function boundedJson(filePath: string): { version?: string } {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 2 * 1024 * 1024) {
        throw codedError("HeadlessActivityHost.ToolchainUnavailable");
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as { version?: string };
}

function requiredString(value: unknown): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw codedError("HeadlessActivityHost.BindingInvalid");
    }
    return value.trim();
}

function digest(value: unknown): string {
    const normalized = requiredString(value)
        .replace(/^sha256:/u, "")
        .toLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(normalized)) {
        throw codedError("HeadlessActivityHost.BindingInvalid");
    }
    return normalized;
}

function requiredBoolean(value: unknown): boolean {
    if (typeof value !== "boolean") {
        throw codedError("HeadlessActivityHost.BindingInvalid");
    }
    return value;
}

function requiredNonnegativeInteger(value: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw codedError("HeadlessActivityHost.BindingInvalid");
    }
    return value;
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
