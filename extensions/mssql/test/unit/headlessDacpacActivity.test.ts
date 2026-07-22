/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { spawnSync } from "child_process";
import * as crypto from "crypto";
import Dockerode = require("dockerode");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { stampCatalogMetadata } from "../../src/runbookStudio/activities/activityCatalog";
import { HeadlessDacpacActivityDelegate } from "../../src/runbookStudio/headless/headlessDacpacActivity";
import { HeadlessEffectAuthority } from "../../src/runbookStudio/headless/headlessEffectAuthority";
import { runHeadlessActivities } from "../../src/runbookStudio/headless/headlessActivityRunner";
import { ManifestHeadlessApprovalProvider } from "../../src/runbookStudio/headless/headlessExecutionProviders";
import { classifyRunbookIntent } from "../../src/runbookStudio/capabilities/runbookCapabilities";
import {
    compileDeterministicEfModelComparison,
    isProposalFailure,
} from "../../src/runbookStudio/models/planCompiler";
import { RunbookEffectLedger } from "../../src/runbookStudio/runbookEffectLedger";
import {
    canonicalizeRunbookArtifact,
    computePlanHash,
    createNewRunbookArtifact,
} from "../../src/runbookStudio/runbookArtifact";
import type { ActivityInvocationIdentity } from "../../src/runbookStudio/runtime/fakeRuntimeAdapter";
import { DEMO_RUNBOOK_INTENT } from "./demoRunbookPrompt";
import {
    RUNBOOK_LOCK_SCHEMA_VERSION,
    type RunbookArtifactFile,
    type RunbookPlanNode,
} from "../../src/sharedInterfaces/runbookStudio";

const EXTENSION_ROOT = path.resolve(__dirname, "../../..");
const WORKSPACE_ROOT = path.resolve(__dirname, "../../../../..");
const EF_FIXTURE_ROOT = path.resolve(
    __dirname,
    "../../../../../..",
    "test_assets",
    "hobbes-ef-model",
    "myapp",
);

suite("Runbook Studio headless DACPAC activity", () => {
    let artifactRoot: string;

    setup(() => {
        artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rbs-headless-dacpac-"));
    });

    teardown(() => {
        fs.rmSync(artifactRoot, { recursive: true, force: true });
    });

    test("extracts, previews, publishes, and compares only the approved artifact digest", async () => {
        const runId = "headless-dacpac-unit";
        const artifact = dacpacArtifact("headless-dacpac-unit-book");
        const invocation: ActivityInvocationIdentity = {
            runId,
            planRevision: artifact.lock!.planRevision,
            planHash: artifact.lock!.planHash,
            attempt: 1,
        };
        const authority = new HeadlessEffectAuthority(runId, artifact, {});
        const fakeDacFx = new FakeDacFx();
        const delegate = new HeadlessDacpacActivityDelegate(
            artifactRoot,
            EXTENSION_ROOT,
            authority,
            {
                resolveOwnedConnection: () =>
                    Promise.resolve({
                        runId,
                        effectId: `effect-${"a".repeat(64)}`,
                        connectionRef: `runbook-sql-container:effect-${"a".repeat(64)}`,
                        connectionString:
                            "Server=localhost,14330;Database=HeadlessDacpacDb;User ID=sa;Password=unit-secret",
                        containerName: "rbs-headless-dacpac-unit",
                        databaseName: "HeadlessDacpacDb",
                        environmentFingerprint: `sha256:${"b".repeat(64)}`,
                    }),
            } as never,
            {} as never,
            { dacFx: fakeDacFx },
        );
        const values = new Map<string, unknown>();
        const binding = () => ({
            parameterValues: {},
            resolveBind: (value: unknown) =>
                typeof value === "string" && value.startsWith("$values.")
                    ? values.get(value.slice("$values.".length))
                    : value,
            isCancellationRequested: () => false,
            invocation,
        });

        const extract = await delegate.executeActivity(artifact.lock!.nodes[0], binding());
        expect(extract?.success).to.equal(true);
        values.set("dacpacPath", extract?.values?.artifactPath);
        values.set("dacpacDigest", extract?.values?.artifactSha256);
        const preview = await delegate.executeActivity(artifact.lock!.nodes[1], binding());
        expect(preview?.success).to.equal(true);
        values.set("previewDigest", preview?.values?.reportSha256);
        authority.recordApprovedGate("approve-deploy", `sha256:${"c".repeat(64)}`, {
            extract: extract!.output!,
            preview: preview!.output!,
        });
        const deploy = await delegate.executeActivity(artifact.lock!.nodes[3], binding());
        expect(deploy?.success).to.equal(true);
        expect(deploy?.values).to.include({ deployed: true, postDeployChangeCount: 0 });
        const compare = await delegate.executeActivity(artifact.lock!.nodes[4], binding());
        expect(compare?.success).to.equal(true);
        expect(compare?.values).to.include({ matches: true, changeCount: 0 });
        expect(fakeDacFx.deployCalls).to.equal(1);
        expect(new RunbookEffectLedger(artifactRoot).scanRecovery().outstanding).to.deep.equal([]);
        await delegate.dispose();
    });
});

suite("Runbook Studio headless DACPAC live smoke (gated)", function () {
    this.timeout(12 * 60_000);
    const sourceConnection =
        process.env.STS2_SQLSERVER_CONNSTRING ?? process.env.STS2_SQLSERVER_SQLLOGIN_CONNSTRING;
    const sourceDatabase = process.env.RBS2_DACPAC_SOURCE_DATABASE ?? "HobbesDemo_MyApp_Staging";
    let artifactRoot: string;
    let docker: Dockerode;

    suiteSetup(async function () {
        if (process.env.RBS2_DACPAC_LIVE !== "1" || !sourceConnection) {
            this.skip();
            return;
        }
        docker = new Dockerode();
        try {
            await docker.ping();
        } catch {
            this.skip();
        }
    });

    setup(() => {
        artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rbs-headless-dacpac-live-"));
    });

    teardown(() => {
        fs.rmSync(artifactRoot, { recursive: true, force: true });
    });

    test("clones a real localhost database through DacFx into an owned SQL 2025 container", async () => {
        const runId = `headless-dacpac-live-${Date.now().toString(36)}`;
        const containerName = `rbs-headless-live-${crypto.randomBytes(4).toString("hex")}`;
        const password = `Rbs!${crypto.randomBytes(12).toString("hex")}Aa1`;
        const artifact = liveDacpacArtifact("headless-dacpac-live-book");
        const approvalProvider = new ManifestHeadlessApprovalProvider({
            schemaVersion: 1,
            runId,
            runbookId: artifact.id,
            planRevision: artifact.lock!.planRevision,
            planHash: artifact.lock!.planHash,
            approvedGateIds: ["approve-container", "approve-deploy"],
            expiresEpochMs: Date.now() + 10 * 60_000,
        });
        try {
            const result = await runHeadlessActivities({
                artifactText: canonicalizeRunbookArtifact(artifact),
                trustedWorkspaceRoot: WORKSPACE_ROOT,
                activityArtifactRoot: artifactRoot,
                extensionRoot: EXTENSION_ROOT,
                parameterValues: {
                    sourceConnection: sourceConnection!,
                    sourceDatabaseName: sourceDatabase,
                    containerName,
                    databaseName: "HeadlessDacpacDb",
                    sqlVersion: "2025",
                    saPassword: password,
                },
                runId,
                approvalProvider,
            });
            expect(result, JSON.stringify(result, undefined, 2)).to.include({
                outcome: "pass",
                terminalState: "succeeded",
            });
            expect(result.nodeCounts).to.deep.equal({
                succeeded: 10,
                failed: 0,
                skipped: 0,
                cancelled: 0,
            });
            expect(result.outputs?.["verify-base"]?.scalars).to.include({ matches: true });
            expect(result.outputs?.["export-base"]?.contract).to.equal("schemaCompareDocument/1");
            expect(JSON.stringify(result)).not.to.contain(password);
            expect(JSON.stringify(result)).not.to.contain(sourceConnection);
            expect(await containerByName(docker, containerName)).to.equal(undefined);
            expect(new RunbookEffectLedger(artifactRoot).scanRecovery().outstanding).to.deep.equal(
                [],
            );
        } finally {
            const leaked = await containerByName(docker, containerName);
            if (leaked) {
                const inspected = await leaked.inspect();
                if (
                    inspected.Config?.Labels?.["com.microsoft.mssql.runbook-studio.run-id"] !==
                    runId
                ) {
                    throw new Error("Live DACPAC container ownership changed; refusing cleanup.");
                }
                await leaked.remove({ force: true });
            }
        }
    });

    test("runs the real 29-node EF clone, migrate, ERD, compare, and rollback lock", async () => {
        const intent =
            "Compare Entity Framework changes between demo and main, generate migration DDL, " +
            "extract a DACPAC from HobbesDemo_MyApp_Staging staging database, provision a SQL " +
            "Server 2025 container, deploy the DACPAC, apply the migration, run a schema compare " +
            "and save the diff output, visualize the schema, roll it back, and visualize the " +
            "rolled-back schema.";
        const classified = classifyRunbookIntent(intent);
        const base = createNewRunbookArtifact("New runbook", "headless-ef-dacpac-live-book");
        base.family = classified.family;
        base.source.requirements = classified.requirements;
        const compiled = compileDeterministicEfModelComparison(base, intent);
        if (!compiled || isProposalFailure(compiled) || !compiled.artifact.lock) {
            throw new Error("The deterministic EF/DACPAC rehearsal plan did not compile.");
        }
        expect(compiled.artifact.lock.nodes).to.have.length(29);
        const runId = `headless-ef-dacpac-${Date.now().toString(36)}`;
        const containerName = `rbs-headless-live-${crypto.randomBytes(4).toString("hex")}`;
        const password = `Rbs!${crypto.randomBytes(12).toString("hex")}Aa1`;
        const approvalProvider = new ManifestHeadlessApprovalProvider({
            schemaVersion: 1,
            runId,
            runbookId: compiled.artifact.id,
            planRevision: compiled.artifact.lock.planRevision,
            planHash: compiled.artifact.lock.planHash,
            approvedGateIds: compiled.artifact.lock.nodes
                .filter((node) => node.kind === "gate")
                .map((node) => node.id),
            expiresEpochMs: Date.now() + 10 * 60_000,
        });
        try {
            const result = await runHeadlessActivities({
                artifactText: canonicalizeRunbookArtifact(compiled.artifact),
                trustedWorkspaceRoot: EF_FIXTURE_ROOT,
                activityArtifactRoot: artifactRoot,
                extensionRoot: EXTENSION_ROOT,
                parameterValues: {
                    repository: EF_FIXTURE_ROOT,
                    baseRef: "main",
                    headRef: "demo",
                    project: "src/MyApp.Data/MyApp.Data.csproj",
                    dbContext: "AppDbContext",
                    renameDecisions: "[]",
                    sourceConnection: sourceConnection!,
                    sourceDatabaseName: sourceDatabase,
                    containerName,
                    databaseName: "HeadlessEfDacpacDb",
                    sqlVersion: "2025",
                    saPassword: password,
                    migrationTimeoutSeconds: 300,
                },
                runId,
                approvalProvider,
            });
            expect(result, JSON.stringify(result, undefined, 2)).to.include({
                outcome: "pass",
                terminalState: "succeeded",
            });
            expect(result.nodeCounts).to.deep.equal({
                succeeded: 29,
                failed: 0,
                skipped: 0,
                cancelled: 0,
            });
            for (const nodeId of [
                "verify-base-deployment",
                "validate-forward-migration",
                "compare-forward-schema",
                "visualize-forward-schema",
                "validate-rollback-migration",
                "verify-rollback-base",
                "visualize-rollback-schema",
            ]) {
                expect(result.outputs?.[nodeId]?.contract, nodeId).to.be.a("string");
            }
            expect(JSON.stringify(result)).not.to.contain(password);
            expect(JSON.stringify(result)).not.to.contain(sourceConnection);
            expect(await containerByName(docker, containerName)).to.equal(undefined);
            expect(new RunbookEffectLedger(artifactRoot).scanRecovery().outstanding).to.deep.equal(
                [],
            );
        } finally {
            const leaked = await containerByName(docker, containerName);
            if (leaked) {
                const inspected = await leaked.inspect();
                if (
                    inspected.Config?.Labels?.["com.microsoft.mssql.runbook-studio.run-id"] !==
                    runId
                ) {
                    throw new Error(
                        "Live EF/DACPAC container ownership changed; refusing cleanup.",
                    );
                }
                await leaked.remove({ force: true });
            }
        }
    });

    test("runs the complete release-candidate demo with workload, DMV, XEvent, and manifest", async () => {
        const classified = classifyRunbookIntent(DEMO_RUNBOOK_INTENT);
        const base = createNewRunbookArtifact("New runbook", "headless-complete-demo-book");
        base.family = classified.family;
        base.source.requirements = classified.requirements;
        const compiled = compileDeterministicEfModelComparison(base, DEMO_RUNBOOK_INTENT);
        if (!compiled || isProposalFailure(compiled) || !compiled.artifact.lock) {
            throw new Error("The deterministic complete demo plan did not compile.");
        }
        expect(compiled.artifact.lock.nodes).to.have.length(45);
        const runId = `headless-complete-demo-${Date.now().toString(36)}`;
        const containerName = `rbs-headless-live-${crypto.randomBytes(4).toString("hex")}`;
        const password = `Rbs!${crypto.randomBytes(12).toString("hex")}Aa1`;
        const approvalProvider = new ManifestHeadlessApprovalProvider({
            schemaVersion: 1,
            runId,
            runbookId: compiled.artifact.id,
            planRevision: compiled.artifact.lock.planRevision,
            planHash: compiled.artifact.lock.planHash,
            approvedGateIds: compiled.artifact.lock.nodes
                .filter((node) => node.kind === "gate")
                .map((node) => node.id),
            expiresEpochMs: Date.now() + 15 * 60_000,
        });
        try {
            const result = await runHeadlessActivities({
                artifactText: canonicalizeRunbookArtifact(compiled.artifact),
                trustedWorkspaceRoot: EF_FIXTURE_ROOT,
                activityArtifactRoot: artifactRoot,
                extensionRoot: EXTENSION_ROOT,
                parameterValues: {
                    repository: EF_FIXTURE_ROOT,
                    baseRef: "main",
                    headRef: "demo",
                    project: "src/MyApp.Data/MyApp.Data.csproj",
                    dbContext: "AppDbContext",
                    renameDecisions: "[]",
                    sourceConnection: sourceConnection!,
                    sourceDatabaseName: sourceDatabase,
                    containerName,
                    databaseName: "HeadlessCompleteDemoDb",
                    sqlVersion: "2025",
                    saPassword: password,
                    migrationTimeoutSeconds: 300,
                    workloadFile: "scripts/workload.sql",
                    workloadRepetitions: 2,
                    workloadTimeoutSeconds: 300,
                    xeventMaxFileSizeMb: 16,
                },
                runId,
                approvalProvider,
            });
            expect(result, JSON.stringify(result, undefined, 2)).to.include({
                outcome: "pass",
                terminalState: "succeeded",
            });
            expect(result.nodeCounts).to.deep.equal({
                succeeded: 40,
                failed: 0,
                skipped: 5,
                cancelled: 0,
            });
            expect(result.outputs?.["summarize-performance"]?.contract).to.equal(
                "performanceMetrics/1",
            );
            expect(result.outputs?.["analyze-capture"]?.contract).to.equal("xeventAnalysis/1");
            expect(result.outputs?.["collect-capture"]?.contract).to.equal("xelArtifact/1");
            expect(result.outputs?.["create-release-manifest"]?.scalars).to.include({
                evidenceComplete: true,
                protectedDeploymentAuthorized: false,
            });
            expect(JSON.stringify(result)).not.to.contain(password);
            expect(JSON.stringify(result)).not.to.contain(sourceConnection);
            expect(await containerByName(docker, containerName)).to.equal(undefined);
            expect(new RunbookEffectLedger(artifactRoot).scanRecovery().outstanding).to.deep.equal(
                [],
            );
        } finally {
            const leaked = await containerByName(docker, containerName);
            if (leaked) {
                const inspected = await leaked.inspect();
                if (
                    inspected.Config?.Labels?.["com.microsoft.mssql.runbook-studio.run-id"] !==
                    runId
                ) {
                    throw new Error("Complete demo container ownership changed; refusing cleanup.");
                }
                await leaked.remove({ force: true });
            }
        }
    });

    test("runs the 29-node EF/DACPAC rehearsal through the bundled CLI", async () => {
        const intent =
            "Compare Entity Framework changes between demo and main, generate migration DDL, " +
            "extract a DACPAC from HobbesDemo_MyApp_Staging staging database, provision a SQL " +
            "Server 2025 container, deploy the DACPAC, apply the migration, run a schema compare " +
            "and save the diff output, visualize the schema, roll it back, and visualize the " +
            "rolled-back schema.";
        const classified = classifyRunbookIntent(intent);
        const base = createNewRunbookArtifact("New runbook", "headless-ef-dacpac-cli-book");
        base.family = classified.family;
        base.source.requirements = classified.requirements;
        const compiled = compileDeterministicEfModelComparison(base, intent);
        if (!compiled || isProposalFailure(compiled) || !compiled.artifact.lock) {
            throw new Error("The deterministic EF/DACPAC CLI plan did not compile.");
        }
        const runId = `headless-ef-dacpac-cli-${Date.now().toString(36)}`;
        const containerName = `rbs-headless-live-${crypto.randomBytes(4).toString("hex")}`;
        const password = `Rbs!${crypto.randomBytes(12).toString("hex")}Aa1`;
        const artifactPath = path.join(artifactRoot, "ef-dacpac.runbook.json");
        const parametersPath = path.join(artifactRoot, "parameters.json");
        const secretMapPath = path.join(artifactRoot, "secret-environment-map.json");
        const approvalPath = path.join(artifactRoot, "approval.json");
        const activityArtifacts = path.join(artifactRoot, "activity-artifacts");
        const connectionEnvironmentName = `RBS2_SOURCE_${crypto
            .randomBytes(4)
            .toString("hex")
            .toUpperCase()}`;
        const passwordEnvironmentName = `RBS2_PASSWORD_${crypto
            .randomBytes(4)
            .toString("hex")
            .toUpperCase()}`;
        fs.writeFileSync(artifactPath, canonicalizeRunbookArtifact(compiled.artifact), "utf8");
        fs.writeFileSync(
            parametersPath,
            JSON.stringify({
                repository: EF_FIXTURE_ROOT,
                baseRef: "main",
                headRef: "demo",
                project: "src/MyApp.Data/MyApp.Data.csproj",
                dbContext: "AppDbContext",
                renameDecisions: "[]",
                sourceDatabaseName: sourceDatabase,
                containerName,
                databaseName: "HeadlessEfDacpacCliDb",
                sqlVersion: "2025",
                migrationTimeoutSeconds: 300,
            }),
            "utf8",
        );
        fs.writeFileSync(
            secretMapPath,
            JSON.stringify({
                sourceConnection: connectionEnvironmentName,
                saPassword: passwordEnvironmentName,
            }),
            "utf8",
        );
        fs.writeFileSync(
            approvalPath,
            JSON.stringify({
                schemaVersion: 1,
                runId,
                runbookId: compiled.artifact.id,
                planRevision: compiled.artifact.lock.planRevision,
                planHash: compiled.artifact.lock.planHash,
                approvedGateIds: compiled.artifact.lock.nodes
                    .filter((node) => node.kind === "gate")
                    .map((node) => node.id),
                expiresEpochMs: Date.now() + 10 * 60_000,
            }),
            "utf8",
        );
        try {
            const executed = spawnSync(
                process.execPath,
                [
                    path.join(EXTENSION_ROOT, "dist", "runbookHeadless.js"),
                    "run-activities",
                    artifactPath,
                    "--workspace",
                    EF_FIXTURE_ROOT,
                    "--activity-artifacts",
                    activityArtifacts,
                    "--params",
                    parametersPath,
                    "--secret-env-map",
                    secretMapPath,
                    "--approval-manifest",
                    approvalPath,
                    "--run-id",
                    runId,
                ],
                {
                    cwd: EXTENSION_ROOT,
                    encoding: "utf8",
                    env: {
                        ...process.env,
                        [connectionEnvironmentName]: sourceConnection!,
                        [passwordEnvironmentName]: password,
                    },
                    maxBuffer: 8 * 1024 * 1024,
                    timeout: 10 * 60_000,
                    windowsHide: true,
                },
            );
            expect(executed.status, executed.stderr || executed.stdout).to.equal(0);
            const summary = JSON.parse(executed.stdout) as {
                mode: string;
                effects: string;
                outcome: string;
                nodeCounts: Record<string, number>;
                outputs: Record<string, { contract: string }>;
            };
            expect(summary).to.include({
                mode: "productionActivityHost",
                effects: "real",
                outcome: "pass",
            });
            expect(summary.nodeCounts.succeeded).to.equal(29);
            expect(summary.outputs["visualize-forward-schema"].contract).to.equal(
                "databaseSchemaGraph/1",
            );
            expect(summary.outputs["verify-rollback-base"].contract).to.equal("schemaDiff/1");
            expect(`${executed.stdout}\n${executed.stderr}`).not.to.contain(password);
            expect(`${executed.stdout}\n${executed.stderr}`).not.to.contain(sourceConnection);
            expect(await containerByName(docker, containerName)).to.equal(undefined);
            expect(
                new RunbookEffectLedger(activityArtifacts).scanRecovery().outstanding,
            ).to.deep.equal([]);
        } finally {
            const leaked = await containerByName(docker, containerName);
            if (leaked) {
                const inspected = await leaked.inspect();
                if (
                    inspected.Config?.Labels?.["com.microsoft.mssql.runbook-studio.run-id"] !==
                    runId
                ) {
                    throw new Error(
                        "Live EF/DACPAC CLI container ownership changed; refusing cleanup.",
                    );
                }
                await leaked.remove({ force: true });
            }
        }
    });

    test("runs the complete release-candidate demo through the bundled CLI", async () => {
        const classified = classifyRunbookIntent(DEMO_RUNBOOK_INTENT);
        const base = createNewRunbookArtifact("New runbook", "headless-complete-demo-cli-book");
        base.family = classified.family;
        base.source.requirements = classified.requirements;
        const compiled = compileDeterministicEfModelComparison(base, DEMO_RUNBOOK_INTENT);
        if (!compiled || isProposalFailure(compiled) || !compiled.artifact.lock) {
            throw new Error("The deterministic complete CLI demo plan did not compile.");
        }
        const runId = `headless-complete-cli-${Date.now().toString(36)}`;
        const containerName = `rbs-headless-live-${crypto.randomBytes(4).toString("hex")}`;
        const password = `Rbs!${crypto.randomBytes(12).toString("hex")}Aa1`;
        const artifactPath = path.join(artifactRoot, "complete-demo.runbook.json");
        const parametersPath = path.join(artifactRoot, "complete-demo.parameters.json");
        const secretMapPath = path.join(artifactRoot, "complete-demo.secret-map.json");
        const approvalPath = path.join(artifactRoot, "complete-demo.approval.json");
        const activityArtifacts = path.join(artifactRoot, "complete-demo-artifacts");
        const connectionEnvironmentName = `RBS2_SOURCE_${crypto
            .randomBytes(4)
            .toString("hex")
            .toUpperCase()}`;
        const passwordEnvironmentName = `RBS2_PASSWORD_${crypto
            .randomBytes(4)
            .toString("hex")
            .toUpperCase()}`;
        fs.writeFileSync(artifactPath, canonicalizeRunbookArtifact(compiled.artifact), "utf8");
        fs.writeFileSync(
            parametersPath,
            JSON.stringify({
                repository: EF_FIXTURE_ROOT,
                baseRef: "main",
                headRef: "demo",
                project: "src/MyApp.Data/MyApp.Data.csproj",
                dbContext: "AppDbContext",
                renameDecisions: "[]",
                sourceDatabaseName: sourceDatabase,
                containerName,
                databaseName: "HeadlessCompleteCliDb",
                sqlVersion: "2025",
                migrationTimeoutSeconds: 300,
                workloadFile: "scripts/workload.sql",
                workloadRepetitions: 2,
                workloadTimeoutSeconds: 300,
                xeventMaxFileSizeMb: 16,
            }),
            "utf8",
        );
        fs.writeFileSync(
            secretMapPath,
            JSON.stringify({
                sourceConnection: connectionEnvironmentName,
                saPassword: passwordEnvironmentName,
            }),
            "utf8",
        );
        fs.writeFileSync(
            approvalPath,
            JSON.stringify({
                schemaVersion: 1,
                runId,
                runbookId: compiled.artifact.id,
                planRevision: compiled.artifact.lock.planRevision,
                planHash: compiled.artifact.lock.planHash,
                approvedGateIds: compiled.artifact.lock.nodes
                    .filter((node) => node.kind === "gate")
                    .map((node) => node.id),
                expiresEpochMs: Date.now() + 15 * 60_000,
            }),
            "utf8",
        );
        try {
            const executed = spawnSync(
                process.execPath,
                [
                    path.join(EXTENSION_ROOT, "dist", "runbookHeadless.js"),
                    "run-activities",
                    artifactPath,
                    "--workspace",
                    EF_FIXTURE_ROOT,
                    "--activity-artifacts",
                    activityArtifacts,
                    "--params",
                    parametersPath,
                    "--secret-env-map",
                    secretMapPath,
                    "--approval-manifest",
                    approvalPath,
                    "--run-id",
                    runId,
                ],
                {
                    cwd: EXTENSION_ROOT,
                    encoding: "utf8",
                    env: {
                        ...process.env,
                        [connectionEnvironmentName]: sourceConnection!,
                        [passwordEnvironmentName]: password,
                    },
                    maxBuffer: 16 * 1024 * 1024,
                    timeout: 10 * 60_000,
                    windowsHide: true,
                },
            );
            expect(executed.status, executed.stderr || executed.stdout).to.equal(0);
            const summary = JSON.parse(executed.stdout) as {
                mode: string;
                effects: string;
                outcome: string;
                nodeCounts: Record<string, number>;
                outputs: Record<string, { contract: string; scalars?: Record<string, unknown> }>;
            };
            expect(summary).to.include({
                mode: "productionActivityHost",
                effects: "real",
                outcome: "pass",
            });
            expect(summary.nodeCounts).to.deep.equal({
                succeeded: 40,
                failed: 0,
                skipped: 5,
                cancelled: 0,
            });
            expect(summary.outputs["collect-capture"].contract).to.equal("xelArtifact/1");
            expect(summary.outputs["create-release-manifest"].scalars).to.include({
                evidenceComplete: true,
                protectedDeploymentAuthorized: false,
            });
            expect(`${executed.stdout}\n${executed.stderr}`).not.to.contain(password);
            expect(`${executed.stdout}\n${executed.stderr}`).not.to.contain(sourceConnection);
            expect(await containerByName(docker, containerName)).to.equal(undefined);
            expect(
                new RunbookEffectLedger(activityArtifacts).scanRecovery().outstanding,
            ).to.deep.equal([]);
        } finally {
            const leaked = await containerByName(docker, containerName);
            if (leaked) {
                const inspected = await leaked.inspect();
                if (
                    inspected.Config?.Labels?.["com.microsoft.mssql.runbook-studio.run-id"] !==
                    runId
                ) {
                    throw new Error("Complete CLI container ownership changed; refusing cleanup.");
                }
                await leaked.remove({ force: true });
            }
        }
    });
});

function dacpacArtifact(id: string): RunbookArtifactFile {
    const artifact = createNewRunbookArtifact("Headless DACPAC unit", id);
    const nodes: RunbookPlanNode[] = stampCatalogMetadata([
        {
            id: "extract",
            label: "Extract",
            kind: "activity",
            activityKind: "dacpac.extract",
            inputs: {
                database: "Server=localhost;Integrated Security=True;Database=SourceDatabase",
                databaseName: "SourceDatabase",
            },
        },
        {
            id: "preview",
            label: "Preview",
            kind: "activity",
            activityKind: "dacpac.deploy.preview",
            inputs: { dacpac: "$values.dacpacPath", database: "owned" },
        },
        { id: "approve-deploy", label: "Approve", kind: "gate" },
        {
            id: "deploy",
            label: "Deploy",
            kind: "activity",
            activityKind: "dacpac.deploy.container",
            inputs: {
                dacpac: "$values.dacpacPath",
                database: "owned",
                artifactDigest: "$values.dacpacDigest",
                previewDigest: "$values.previewDigest",
            },
        },
        {
            id: "compare",
            label: "Compare",
            kind: "activity",
            activityKind: "schema.compare",
            inputs: { dacpac: "$values.dacpacPath", database: "owned" },
        },
    ]);
    artifact.lock = {
        schemaVersion: RUNBOOK_LOCK_SCHEMA_VERSION,
        planRevision: "1",
        planHash: "sha256:pending",
        entryNodeId: "extract",
        nodes,
        edges: [
            { from: "extract", to: "preview" },
            { from: "preview", to: "approve-deploy" },
            { from: "approve-deploy", to: "deploy", when: "approved" },
            { from: "deploy", to: "compare" },
        ],
    };
    artifact.lock.planHash = computePlanHash(artifact.source, artifact.lock);
    return artifact;
}

function liveDacpacArtifact(id: string): RunbookArtifactFile {
    const artifact = createNewRunbookArtifact("Headless DACPAC clone", id);
    artifact.source.parameters = [
        { id: "sourceConnection", label: "Source", type: "connection", required: true },
        { id: "sourceDatabaseName", label: "Source database", type: "string", required: true },
        { id: "containerName", label: "Container", type: "string", required: true },
        { id: "databaseName", label: "Target database", type: "string", required: true },
        {
            id: "sqlVersion",
            label: "SQL version",
            type: "enum",
            required: true,
            enumValues: ["2019", "2022", "2025"],
        },
        { id: "saPassword", label: "Password", type: "secret", required: true },
    ];
    const nodes: RunbookPlanNode[] = stampCatalogMetadata([
        {
            id: "extract-base",
            label: "Extract base",
            kind: "activity",
            activityKind: "dacpac.extract",
            inputs: {
                database: "$params.sourceConnection",
                databaseName: "$params.sourceDatabaseName",
            },
        },
        { id: "approve-container", label: "Approve container", kind: "gate" },
        {
            id: "provision",
            label: "Provision",
            kind: "activity",
            activityKind: "sql.container.provision",
            inputs: {
                containerName: "$params.containerName",
                databaseName: "$params.databaseName",
                version: "$params.sqlVersion",
                password: "$params.saPassword",
            },
        },
        {
            id: "preview-base",
            label: "Preview",
            kind: "activity",
            activityKind: "dacpac.deploy.preview",
            inputs: {
                dacpac: "$nodes.extract-base.artifactPath",
                database: "$nodes.provision.connectionRef",
            },
        },
        { id: "approve-deploy", label: "Approve deploy", kind: "gate" },
        {
            id: "deploy-base",
            label: "Deploy",
            kind: "activity",
            activityKind: "dacpac.deploy.container",
            inputs: {
                dacpac: "$nodes.extract-base.artifactPath",
                database: "$nodes.provision.connectionRef",
                artifactDigest: "$nodes.extract-base.artifactSha256",
                previewDigest: "$nodes.preview-base.reportSha256",
            },
        },
        {
            id: "verify-base",
            label: "Verify",
            kind: "activity",
            activityKind: "schema.compare",
            inputs: {
                dacpac: "$nodes.extract-base.artifactPath",
                database: "$nodes.provision.connectionRef",
            },
        },
        {
            id: "export-base",
            label: "Export comparison",
            kind: "activity",
            activityKind: "schema.compare.export",
            inputs: {
                dacpac: "$nodes.extract-base.artifactPath",
                database: "$nodes.provision.connectionRef",
            },
        },
        {
            id: "dispose",
            label: "Dispose",
            kind: "activity",
            activityKind: "sql.container.dispose",
            inputs: { database: "$nodes.provision.connectionRef" },
        },
        { id: "report", label: "Report", kind: "report" },
    ]);
    artifact.lock = {
        schemaVersion: RUNBOOK_LOCK_SCHEMA_VERSION,
        planRevision: "1",
        planHash: "sha256:pending",
        entryNodeId: "extract-base",
        nodes,
        edges: [
            { from: "extract-base", to: "approve-container" },
            { from: "approve-container", to: "provision", when: "approved" },
            { from: "provision", to: "preview-base" },
            { from: "preview-base", to: "approve-deploy" },
            { from: "approve-deploy", to: "deploy-base", when: "approved" },
            { from: "deploy-base", to: "verify-base" },
            { from: "verify-base", to: "export-base" },
            { from: "export-base", to: "dispose" },
            { from: "dispose", to: "report" },
        ],
    };
    artifact.lock.planHash = computePlanHash(artifact.source, artifact.lock);
    return artifact;
}

async function containerByName(
    docker: Dockerode,
    name: string,
): Promise<Dockerode.Container | undefined> {
    const matches = await docker.listContainers({ all: true, filters: { name: [`^/${name}$`] } });
    return matches[0]?.Id ? docker.getContainer(matches[0].Id) : undefined;
}

class FakeDacFx {
    public deployCalls = 0;

    public extract(_connectionString: string, _databaseName: string, packageFilePath: string) {
        fs.writeFileSync(packageFilePath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]));
        return Promise.resolve({ success: true, operationId: "extract-unit" });
    }

    public deployPlan() {
        return Promise.resolve({
            success: true,
            operationId: "preview-unit",
            report:
                this.deployCalls === 0
                    ? '<DeploymentReport><Operations><Operation Name="Create"><Item Type="Table" Value="[dbo].[Unit]" /></Operation></Operations></DeploymentReport>'
                    : "<DeploymentReport><Operations /></DeploymentReport>",
        });
    }

    public deploy() {
        this.deployCalls++;
        return Promise.resolve({ success: true, operationId: "deploy-unit" });
    }

    public dispose(): Promise<void> {
        return Promise.resolve();
    }
}
