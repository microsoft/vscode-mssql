/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
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
import type { RunbookPlanNode } from "../../src/sharedInterfaces/runbookStudio";
import {
    productionHeadlessActivityCapabilities,
    runHeadlessActivities,
} from "../../src/runbookStudio/headless/headlessActivityRunner";
import {
    canonicalizeRunbookArtifact,
    createFixtureRunbookArtifact,
    createNewRunbookArtifact,
} from "../../src/runbookStudio/runbookArtifact";
import { classifyRunbookIntent } from "../../src/runbookStudio/capabilities/runbookCapabilities";
import {
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

    test("blocks unsupported real activities at admission without preview fallback", async () => {
        const result = await runHeadlessActivities({
            artifactText: canonicalizeRunbookArtifact(createFixtureRunbookArtifact()),
            trustedWorkspaceRoot: FIXTURE_ROOT,
            activityArtifactRoot: artifactRoot,
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
            "git.change-set.inspect",
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

async function expectRejected(promise: Promise<unknown>, code: string): Promise<void> {
    try {
        await promise;
        expect.fail("expected the headless Git activity to reject");
    } catch (error) {
        expect(error).to.be.instanceOf(HeadlessGitActivityError);
        expect((error as HeadlessGitActivityError).code).to.equal(code);
    }
}
