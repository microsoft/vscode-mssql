/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    captureHeadlessGitChangeSet,
    HeadlessGitActivityDelegate,
    HeadlessGitActivityError,
    parseHeadlessGitNameStatus,
} from "../../src/runbookStudio/headless/headlessGitActivity";
import {
    RUNBOOK_LOCK_SCHEMA_VERSION,
    type RunbookPlanNode,
} from "../../src/sharedInterfaces/runbookStudio";
import {
    productionHeadlessActivityCapabilities,
    runHeadlessActivities,
} from "../../src/runbookStudio/headless/headlessActivityRunner";
import {
    canonicalizeRunbookArtifact,
    computePlanHash,
    createFixtureRunbookArtifact,
    createNewRunbookArtifact,
} from "../../src/runbookStudio/runbookArtifact";
import { stampCatalogMetadata } from "../../src/runbookStudio/activities/activityCatalog";
import { classifyRunbookIntent } from "../../src/runbookStudio/capabilities/runbookCapabilities";
import {
    compileDeterministicEfModelComparison,
    compileDeterministicGitChangeSet,
    isProposalFailure,
} from "../../src/runbookStudio/models/planCompiler";

const FIXTURE_ROOT = path.resolve(
    __dirname,
    "../../../../../..",
    "test_assets",
    "hobbes-ef-model",
    "myapp",
);
const EXTENSION_ROOT = path.resolve(__dirname, "../../..");

suite("Runbook Studio headless Git activity", () => {
    let artifactRoot: string;

    setup(() => {
        artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rbs-headless-git-"));
    });

    teardown(() => {
        fs.rmSync(artifactRoot, { recursive: true, force: true });
    });

    test("captures the real myapp main-to-demo change set without changing the checkout", async () => {
        const beforeHead = fs.readFileSync(path.join(FIXTURE_ROOT, ".git", "HEAD"), "utf8");
        const result = await captureHeadlessGitChangeSet({
            trustedWorkspaceRoot: FIXTURE_ROOT,
            requestedRepository: FIXTURE_ROOT,
            baseRef: "main",
            headRef: "demo",
            includeWorkingTree: false,
            artifactRoot,
            runId: "headless-git-live",
            nodeId: "capture-change-set",
            isCancellationRequested: () => false,
        });

        expect(result.files.map((file) => [file.status, file.relativePath])).to.deep.equal([
            ["A", "README.md"],
            ["A", "myapp_schema.sql"],
            ["A", "scripts/workload.sql"],
            ["A", "setup_local_staging.sql"],
            ["M", "src/MyApp.Data/AppDbContext.cs"],
            ["A", "src/MyApp.Data/Entities/RehearsalEvent.cs"],
        ]);
        expect(result.entityRelatedFileCount).to.equal(2);
        expect(result.dirty).to.equal(false);
        const patch = fs.readFileSync(result.artifactPath);
        expect(result.artifactSizeBytes).to.equal(patch.byteLength);
        expect(result.artifactSha256).to.equal(
            crypto.createHash("sha256").update(patch).digest("hex"),
        );
        expect(fs.readFileSync(path.join(FIXTURE_ROOT, ".git", "HEAD"), "utf8")).to.equal(
            beforeHead,
        );
    });

    test("exposes the captured artifact through the closed activity delegate contract", async () => {
        const delegate = new HeadlessGitActivityDelegate(FIXTURE_ROOT, artifactRoot);
        const node: RunbookPlanNode = {
            id: "capture-change-set",
            label: "Capture Git change set",
            kind: "activity",
            activityKind: "git.change-set.inspect",
            activityVersion: 1,
            inputs: {
                repository: "$params.repository",
                baseRef: "main",
                headRef: "demo",
                includeWorkingTree: false,
            },
        };
        const execution = await delegate.executeActivity(node, {
            parameterValues: { repository: FIXTURE_ROOT },
            resolveBind: (value) => (value === "$params.repository" ? FIXTURE_ROOT : value),
            isCancellationRequested: () => false,
            invocation: {
                runId: "headless-git-delegate",
                planRevision: "1",
                planHash: `sha256:${"a".repeat(64)}`,
                attempt: 1,
            },
        });

        expect(execution?.success).to.equal(true);
        expect(execution?.output?.contract).to.equal("gitChangeSet/1");
        expect(execution?.runMetrics?.["git.entityRelatedFileCount"]).to.equal(2);
        const artifactPath = execution?.values?.artifactPath;
        expect(artifactPath).to.be.a("string");
        expect(fs.existsSync(artifactPath as string)).to.equal(true);
    });

    test("runs the real Git-only immutable plan through the no-VS-Code activity host", async () => {
        const intent = "Capture the git diff changes between main and demo.";
        const classified = classifyRunbookIntent(intent);
        const base = createNewRunbookArtifact("Git evidence", "headless-real-git");
        base.family = classified.family;
        base.source.requirements = classified.requirements;
        const compiled = compileDeterministicGitChangeSet(base, intent);
        if (!compiled || isProposalFailure(compiled)) {
            throw new Error("the deterministic Git plan did not compile");
        }

        const result = await runHeadlessActivities({
            artifactText: canonicalizeRunbookArtifact(compiled.artifact),
            trustedWorkspaceRoot: FIXTURE_ROOT,
            activityArtifactRoot: artifactRoot,
            extensionRoot: EXTENSION_ROOT,
            parameterValues: {
                repository: FIXTURE_ROOT,
                baseRef: "main",
                headRef: "demo",
                includeWorkingTree: false,
            },
            runId: "headless-real-git-run",
        });

        expect(result).to.include({
            mode: "productionActivityHost",
            effects: "real",
            outcome: "pass",
            exitCode: 0,
            terminalState: "succeeded",
        });
        expect(result.validation).to.include({
            valid: true,
            executable: true,
            realActivityCount: 1,
        });
        expect(result.nodeCounts).to.deep.equal({
            succeeded: 2,
            failed: 0,
            skipped: 0,
            cancelled: 0,
        });
        expect(result.outputs?.["capture-change-set"].contract).to.equal("gitChangeSet/1");
        expect(
            fs.existsSync(result.outputs?.["capture-change-set"].scalars?.artifactPath as string),
        ).to.equal(true);
    });

    test("discovers real workspace and EF metadata without executing repository code", async () => {
        const artifact = createNewRunbookArtifact("Workspace discovery", "headless-workspace");
        artifact.lock = {
            schemaVersion: RUNBOOK_LOCK_SCHEMA_VERSION,
            planRevision: "1",
            planHash: "sha256:pending",
            entryNodeId: "workspace",
            nodes: stampCatalogMetadata([
                {
                    id: "workspace",
                    label: "Inspect workspace",
                    kind: "activity",
                    activityKind: "workspace.inspect",
                    activityVersion: 1,
                },
                {
                    id: "ef",
                    label: "Discover EF projects",
                    kind: "activity",
                    activityKind: "ef.project.discover",
                    activityVersion: 1,
                },
                { id: "report", label: "Summarize discovery", kind: "report" },
            ]),
            edges: [
                { from: "workspace", to: "ef" },
                { from: "ef", to: "report" },
            ],
        };
        artifact.lock.planHash = computePlanHash(artifact.source, artifact.lock);

        const result = await runHeadlessActivities({
            artifactText: canonicalizeRunbookArtifact(artifact),
            trustedWorkspaceRoot: FIXTURE_ROOT,
            activityArtifactRoot: artifactRoot,
            extensionRoot: EXTENSION_ROOT,
            runId: "headless-workspace-discovery",
        });

        expect(result).to.include({ outcome: "pass", terminalState: "succeeded" });
        expect(result.validation.realActivityCount).to.equal(2);
        expect(result.outputs?.workspace.scalars).to.include({
            workspaceFolderCount: 1,
            projectCount: 0,
            executionMode: "headless",
        });
        expect(result.outputs?.ef.rows).to.deep.equal([
            [
                "src/MyApp.Data/MyApp.Data.csproj",
                "net8.0",
                "Microsoft.EntityFrameworkCore.SqlServer",
                "AppDbContext",
                4,
                false,
            ],
        ]);
        expect(result.outputs?.ef.scalars).to.include({
            projectCount: 1,
            dbContextCount: 1,
            providerCount: 1,
            entitySourceFileCount: 4,
            truncated: false,
            executionMode: "headless",
        });
        expect(fs.readdirSync(artifactRoot)).to.deep.equal([]);
    });

    test("blocks unsupported real activities at admission without preview fallback", async () => {
        const result = await runHeadlessActivities({
            artifactText: canonicalizeRunbookArtifact(createFixtureRunbookArtifact()),
            trustedWorkspaceRoot: FIXTURE_ROOT,
            activityArtifactRoot: artifactRoot,
            extensionRoot: EXTENSION_ROOT,
            parameterValues: { target: "not-used", maxCount: 1 },
            runId: "headless-no-preview-fallback",
        });

        expect(result).to.include({ outcome: "blocked", exitCode: 3 });
        expect(result.validation).to.include({ valid: true, executable: false });
        expect(result.validation.issues.map((issue) => issue.code)).to.include(
            "HeadlessActivity.ActivityUnsupported",
        );
        expect(fs.readdirSync(artifactRoot)).to.deep.equal([]);
        const capabilities = productionHeadlessActivityCapabilities() as {
            productionHeadlessActivityHostAvailable: boolean;
            productionHeadlessActivitySubsetAvailable: boolean;
            activities: Array<{ kind: string }>;
        };
        expect(capabilities.productionHeadlessActivityHostAvailable).to.equal(false);
        expect(capabilities.productionHeadlessActivitySubsetAvailable).to.equal(true);
        expect(capabilities.activities.map((activity) => activity.kind)).to.deep.equal([
            "workspace.inspect",
            "git.change-set.inspect",
            "ef.project.discover",
            "ef.relational-model.extract",
            "ef.relational-model.compare",
            "migration.data-loss.analyze",
            "migration.script.generate",
        ]);
    });

    test("refuses outside-workspace repositories, unsafe refs, duplicate drops, and cancellation", async () => {
        const base = {
            trustedWorkspaceRoot: FIXTURE_ROOT,
            requestedRepository: FIXTURE_ROOT,
            baseRef: "main",
            headRef: "demo",
            includeWorkingTree: false,
            artifactRoot,
            runId: "headless-git-policy",
            nodeId: "capture-change-set",
            isCancellationRequested: () => false,
        };
        await expectRejected(
            captureHeadlessGitChangeSet({ ...base, requestedRepository: artifactRoot }),
            "HeadlessActivityHost.TargetOutsideWorkspace",
        );
        await expectRejected(
            captureHeadlessGitChangeSet({ ...base, baseRef: "--output=secret" }),
            "HeadlessActivityHost.GitRefInvalid",
        );
        const retained = await captureHeadlessGitChangeSet(base);
        const retainedBytes = fs.readFileSync(retained.artifactPath);
        await expectRejected(
            captureHeadlessGitChangeSet(base),
            "HeadlessActivityHost.ArtifactWriteFailed",
        );
        expect(fs.readFileSync(retained.artifactPath)).to.deep.equal(retainedBytes);
        await expectRejected(
            captureHeadlessGitChangeSet({
                ...base,
                runId: "cancelled-run",
                isCancellationRequested: () => true,
            }),
            "HeadlessActivityHost.ActivityCancelled",
        );
    });

    test("parses bounded rename metadata and rejects escaped paths", () => {
        expect(parseHeadlessGitNameStatus("R100\0Models/Old.cs\0Models/New.cs\0")).to.deep.equal([
            {
                status: "R100",
                previousPath: "Models/Old.cs",
                relativePath: "Models/New.cs",
                entityRelated: true,
            },
        ]);
        expect(() => parseHeadlessGitNameStatus("M\t../outside.cs\n")).to.throw(
            HeadlessGitActivityError,
            "HeadlessActivityHost.GitChangeSetInvalid",
        );
    });
});

suite("Runbook Studio headless EF exact-ref activity live smoke (gated)", function () {
    this.timeout(10 * 60 * 1000);
    let artifactRoot: string;

    suiteSetup(function () {
        if (
            process.env.RBS2_EF_LIVE !== "1" ||
            !fs.existsSync(path.join(FIXTURE_ROOT, ".git")) ||
            !fs.existsSync(
                path.join(EXTENSION_ROOT, "resources", "runbook-ef-exporter", "Program.cs"),
            )
        ) {
            this.skip();
        }
    });

    setup(() => {
        artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rbs-headless-ef-"));
    });

    teardown(() => {
        fs.rmSync(artifactRoot, { recursive: true, force: true });
    });

    test("extracts and compares main and demo through the production host", async () => {
        const intent =
            "Compare Entity Framework changes between development and main, generate migration DDL, and analyze possible data loss.";
        const classified = classifyRunbookIntent(intent);
        const base = createNewRunbookArtifact("EF comparison", "headless-real-ef");
        base.family = classified.family;
        base.source.requirements = classified.requirements;
        const compiled = compileDeterministicEfModelComparison(base, intent);
        if (!compiled || isProposalFailure(compiled)) {
            throw new Error("the deterministic EF comparison plan did not compile");
        }
        const beforeHead = fs.readFileSync(path.join(FIXTURE_ROOT, ".git", "HEAD"), "utf8");
        const result = await runHeadlessActivities({
            artifactText: canonicalizeRunbookArtifact(compiled.artifact),
            trustedWorkspaceRoot: FIXTURE_ROOT,
            activityArtifactRoot: artifactRoot,
            extensionRoot: EXTENSION_ROOT,
            parameterValues: {
                repository: FIXTURE_ROOT,
                baseRef: "main",
                headRef: "demo",
                project: "src/MyApp.Data/MyApp.Data.csproj",
                dbContext: "AppDbContext",
                renameDecisions: "[]",
            },
            runId: "headless-real-ef-run",
            approvalProvider: {
                kind: "liveTest",
                decide: () =>
                    Promise.resolve({
                        approved: true,
                        providerKind: "liveTest",
                        policyDigest: "live-test-policy",
                    }),
            },
        });

        expect(result, JSON.stringify(result, undefined, 2)).to.include({
            outcome: "pass",
            terminalState: "succeeded",
        });
        expect(result.nodeCounts).to.deep.equal({
            succeeded: 11,
            failed: 0,
            skipped: 0,
            cancelled: 0,
        });
        expect(result.outputs?.["extract-base-model"].contract).to.equal("efRelationalModel/1");
        expect(result.outputs?.["extract-head-model"].contract).to.equal("efRelationalModel/1");
        expect(result.outputs?.["compare-models"].contract).to.equal("efModelDiff/1");
        expect(result.outputs?.["compare-models"].scalars).to.include({
            comparable: true,
            potentialDataLoss: false,
            executionMode: "headless",
        });
        expect(result.outputs?.["compare-models"].scalars?.changeCount).to.be.greaterThan(0);
        expect(result.outputs?.["analyze-migration-risk"].contract).to.equal("migrationRisk/1");
        expect(result.outputs?.["generate-migration"].contract).to.equal("migrationManifest/1");
        expect(result.outputs?.["generate-migration"].scalars).to.include({
            operationCount: 2,
            potentialDataLoss: false,
            rollbackCompleteness: "complete",
            executionMode: "headless",
        });
        const forwardScriptPath = result.outputs?.["generate-migration"].scalars
            ?.forwardScriptPath as string;
        expect(fs.readFileSync(forwardScriptPath, "utf8")).to.include(
            "CREATE TABLE [dbo].[RehearsalEvents]",
        );
        expect(fs.readFileSync(path.join(FIXTURE_ROOT, ".git", "HEAD"), "utf8")).to.equal(
            beforeHead,
        );
        expect(fs.existsSync(path.join(artifactRoot, ".scratch"))).to.equal(true);
        expect(fs.readdirSync(path.join(artifactRoot, ".scratch"))).to.deep.equal([]);
    });

    test("runs the approved EF/DDL lock through the bundled CLI process", () => {
        const intent =
            "Compare Entity Framework changes between development and main, generate migration DDL, and analyze possible data loss.";
        const classified = classifyRunbookIntent(intent);
        const base = createNewRunbookArtifact("EF CLI comparison", "headless-cli-ef");
        base.family = classified.family;
        base.source.requirements = classified.requirements;
        const compiled = compileDeterministicEfModelComparison(base, intent);
        if (!compiled || isProposalFailure(compiled) || !compiled.artifact.lock) {
            throw new Error("the deterministic EF CLI plan did not compile");
        }
        const runId = "headless-cli-ef-run";
        const artifactPath = path.join(artifactRoot, "ef.runbook.json");
        const parametersPath = path.join(artifactRoot, "params.json");
        const approvalPath = path.join(artifactRoot, "approval.json");
        const activityArtifacts = path.join(artifactRoot, "activity-artifacts");
        fs.writeFileSync(artifactPath, canonicalizeRunbookArtifact(compiled.artifact), "utf8");
        fs.writeFileSync(
            parametersPath,
            JSON.stringify({
                repository: FIXTURE_ROOT,
                baseRef: "main",
                headRef: "demo",
                project: "src/MyApp.Data/MyApp.Data.csproj",
                dbContext: "AppDbContext",
                renameDecisions: "[]",
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

        const executed = spawnSync(
            process.execPath,
            [
                path.join(EXTENSION_ROOT, "dist", "runbookHeadless.js"),
                "run-activities",
                artifactPath,
                "--workspace",
                FIXTURE_ROOT,
                "--activity-artifacts",
                activityArtifacts,
                "--params",
                parametersPath,
                "--approval-manifest",
                approvalPath,
                "--run-id",
                runId,
            ],
            {
                cwd: EXTENSION_ROOT,
                encoding: "utf8",
                maxBuffer: 4 * 1024 * 1024,
                windowsHide: true,
            },
        );

        expect(executed.status, executed.stderr).to.equal(0);
        const summary = JSON.parse(executed.stdout) as {
            mode: string;
            effects: string;
            outcome: string;
            approvalPolicyDigest?: string;
            nodeCounts: Record<string, number>;
            outputs: Record<string, { contract: string }>;
        };
        expect(summary).to.include({
            mode: "productionActivityHost",
            effects: "real",
            outcome: "pass",
        });
        expect(summary.approvalPolicyDigest).to.match(/^sha256:[a-f0-9]{64}$/u);
        expect(summary.nodeCounts.succeeded).to.equal(11);
        expect(summary.outputs["generate-migration"].contract).to.equal("migrationManifest/1");
    });
});

async function expectRejected(promise: Promise<unknown>, code: string): Promise<void> {
    try {
        await promise;
        expect.fail("expected the headless Git activity to reject");
    } catch (error) {
        expect(error).to.be.instanceOf(HeadlessGitActivityError);
        expect((error as HeadlessGitActivityError).code).to.equal(code);
    }
}
