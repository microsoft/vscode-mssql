/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { DEMO_RUNBOOK_INTENT } from "./demoRunbookPrompt";
import { createDeveloperValidationPreviewArtifact } from "../../src/runbookStudio/developerValidationPreview";
import { parseHeadlessCliArguments } from "../../src/runbookStudio/headless/headlessCliArguments";
import {
    HEADLESS_EXIT_CODES,
    headlessCapabilities,
    runHeadlessPreview,
    validateHeadlessPreview,
} from "../../src/runbookStudio/headless/headlessRunner";
import {
    canonicalizeRunbookArtifact,
    computePlanHash,
    createNewRunbookArtifact,
    createFixtureRunbookArtifact,
} from "../../src/runbookStudio/runbookArtifact";
import { classifyRunbookIntent } from "../../src/runbookStudio/capabilities/runbookCapabilities";
import {
    compileDeterministicCitiesWorkload,
    compileDeterministicDacpacEvolution,
    compileDeterministicDacpacInventory,
    compileDeterministicEfModelComparison,
    isProposalFailure,
} from "../../src/runbookStudio/models/planCompiler";

suite("Runbook Studio headless deterministic preview", () => {
    const parameterValues = {
        projectPath: "Database.sqlproj",
        sandboxConnection: "preview-profile-secret-canary",
    };

    test("advertises an explicitly effect-free no-model capability", () => {
        const capabilities = headlessCapabilities() as {
            runtimeKind: string;
            mode: string;
            modelRequired: boolean;
            effects: string;
            productionHeadlessActivityHostAvailable: boolean;
            productionHeadlessActivitySubsetAvailable: boolean;
            productionHeadlessActivityKinds: string[];
            evidenceFormats: string[];
            executionProviderContracts: Record<string, string>;
        };
        expect(capabilities).to.include({
            runtimeKind: "fake",
            mode: "deterministicPreview",
            modelRequired: false,
            effects: "none",
            productionHeadlessActivityHostAvailable: false,
        });
        expect(capabilities.evidenceFormats).to.deep.equal(["json", "junit", "sarif", "markdown"]);
        expect(capabilities.productionHeadlessActivitySubsetAvailable).to.equal(true);
        expect(capabilities.productionHeadlessActivityKinds).to.deep.equal([
            "workspace.inspect",
            "git.change-set.inspect",
            "ef.project.discover",
            "ef.relational-model.extract",
            "ef.relational-model.compare",
            "migration.data-loss.analyze",
            "migration.script.generate",
            "sql.container.provision",
            "sql.query.read",
            "sql.container.dispose",
        ]);
        expect(capabilities.executionProviderContracts).to.deep.equal({
            secret: "environmentIndirection",
            approval: "runPlanGateDigestBoundManifest",
            machineOutput: "createNewAtomicSummaryLast",
        });
    });

    test("fails closed on undocumented, duplicate, missing-value, and extra CLI arguments", () => {
        expect(parseHeadlessCliArguments(["run", "book.json", "--mystery"]).error).to.equal(
            "HeadlessPreview.OptionUnknown",
        );
        expect(
            parseHeadlessCliArguments([
                "run",
                "book.json",
                "--run-id",
                "first",
                "--run-id",
                "second",
            ]).error,
        ).to.equal("HeadlessPreview.OptionDuplicate");
        expect(parseHeadlessCliArguments(["run", "book.json", "--params"]).error).to.equal(
            "HeadlessPreview.OptionValueRequired",
        );
        expect(parseHeadlessCliArguments(["validate", "one.json", "two.json"]).error).to.equal(
            "HeadlessPreview.ArgumentUnexpected",
        );
        expect(parseHeadlessCliArguments(["capabilities", "secret-canary"]).error).to.equal(
            "HeadlessPreview.ArgumentUnexpected",
        );
        expect(
            JSON.stringify(parseHeadlessCliArguments(["run", "book.json", "--secret-canary"])),
        ).not.to.contain("secret-canary");
    });

    test("accepts only the options documented for each command", () => {
        expect(parseHeadlessCliArguments(["capabilities", "--json"])).to.include({
            command: "capabilities",
            deterministicPreview: false,
            approvePreview: false,
        });
        expect(
            parseHeadlessCliArguments([
                "run",
                "book.json",
                "--deterministic-preview",
                "--params",
                "params.json",
                "--output",
                "out",
                "--run-id",
                "ci-run",
                "--secret-env-map",
                "secrets.json",
                "--approval-manifest",
                "approval.json",
            ]),
        ).to.include({
            command: "run",
            artifactPath: "book.json",
            deterministicPreview: true,
            approvePreview: false,
            paramsPath: "params.json",
            outputDirectory: "out",
            runId: "ci-run",
            secretEnvironmentMapPath: "secrets.json",
            approvalManifestPath: "approval.json",
        });
        expect(
            parseHeadlessCliArguments([
                "run",
                "book.json",
                "--approve-preview",
                "--approval-manifest",
                "approval.json",
            ]).error,
        ).to.equal("HeadlessPreview.OptionConflict");
        expect(
            parseHeadlessCliArguments(["validate", "book.json", "--output", "out"]).error,
        ).to.equal("HeadlessPreview.OptionUnknown");
        expect(
            parseHeadlessCliArguments([
                "run-activities",
                "book.json",
                "--workspace",
                "repo",
                "--activity-artifacts",
                "activity-drop",
                "--output",
                "machine-output",
            ]),
        ).to.include({
            command: "run-activities",
            artifactPath: "book.json",
            trustedWorkspaceRoot: "repo",
            activityArtifactRoot: "activity-drop",
            outputDirectory: "machine-output",
        });
        expect(
            parseHeadlessCliArguments(["run-activities", "book.json", "--deterministic-preview"])
                .error,
        ).to.equal("HeadlessPreview.OptionUnknown");
    });

    test("distinguishes malformed, design-only, and bind-invalid artifacts", async () => {
        const malformed = await validateHeadlessPreview("{not json");
        expect(malformed.result).to.include({ valid: false, executable: false });
        expect(malformed.result.issues[0].code).to.equal("RunbookStudio.InvalidArtifact");

        const designOnly = createDeveloperValidationPreviewArtifact();
        designOnly.lock = undefined;
        const uncompiled = await validateHeadlessPreview(canonicalizeRunbookArtifact(designOnly));
        expect(uncompiled.result).to.include({ valid: true, executable: false });
        expect(uncompiled.result.issues[0].code).to.equal("RunbookStudio.NotCompiled");

        const artifactText = canonicalizeRunbookArtifact(
            createDeveloperValidationPreviewArtifact(),
        );
        const missing = await validateHeadlessPreview(artifactText, {
            unknownSecret: "must-not-echo",
        });
        expect(missing.result).to.include({ valid: false, executable: false });
        expect(missing.result.issues.map((issue) => issue.code)).to.include.members([
            "HeadlessPreview.ParameterUnknown",
            "HeadlessPreview.ParameterRequired",
        ]);
        expect(JSON.stringify(missing.result)).not.to.contain("must-not-echo");
    });

    test("requires an explicit deterministic-preview acknowledgement", async () => {
        const result = await runHeadlessPreview({
            artifactText: canonicalizeRunbookArtifact(createDeveloperValidationPreviewArtifact()),
            parameterValues,
            runId: "ci-no-ack",
            deterministicPreviewAcknowledged: false,
            approvePreviewGates: true,
        });
        expect(result).to.include({
            outcome: "blocked",
            exitCode: HEADLESS_EXIT_CODES.blocked,
            evidenceAvailable: false,
        });
        expect(result.validation.issues.at(-1)?.code).to.equal(
            "HeadlessPreview.AcknowledgementRequired",
        );
    });

    test("missing gate authority is blocked rather than reported as a test failure", async () => {
        const result = await runHeadlessPreview({
            artifactText: canonicalizeRunbookArtifact(createDeveloperValidationPreviewArtifact()),
            parameterValues,
            runId: "ci-gate-blocked",
            deterministicPreviewAcknowledged: true,
            approvePreviewGates: false,
        });
        expect(result).to.include({
            outcome: "blocked",
            exitCode: HEADLESS_EXIT_CODES.blocked,
            blockedGateId: "approve-sandbox",
        });
    });

    test("runs the immutable fake lock without VS Code or a model and exports CI evidence", async () => {
        const artifactText = canonicalizeRunbookArtifact(
            createDeveloperValidationPreviewArtifact(),
        );
        const first = await runHeadlessPreview({
            artifactText,
            parameterValues,
            runId: "ci-preview-1",
            deterministicPreviewAcknowledged: true,
            approvePreviewGates: true,
        });
        const repeated = await runHeadlessPreview({
            artifactText,
            parameterValues,
            runId: "ci-preview-1",
            deterministicPreviewAcknowledged: true,
            approvePreviewGates: true,
        });

        expect(first).to.include({
            outcome: "pass",
            exitCode: HEADLESS_EXIT_CODES.pass,
            terminalState: "succeeded",
            verdict: "pass",
            evidenceAvailable: true,
        });
        expect(first.validation.simulatedMutationCount).to.be.greaterThan(0);
        expect(first.nodeCounts).to.deep.equal({
            succeeded: 13,
            failed: 0,
            skipped: 0,
            cancelled: 0,
        });
        expect(Object.keys(first.exports ?? {}).sort()).to.deep.equal([
            "json",
            "junit",
            "markdown",
            "sarif",
        ]);
        expect(first.exports?.json.content).to.equal(repeated.exports?.json.content);
        for (const artifact of Object.values(first.exports ?? {})) {
            expect(artifact.content).not.to.contain("preview-profile-secret-canary");
            expect(artifact.content).not.to.contain("fake/");
        }
    });

    test("drives the exact DACPAC inventory prompt through the headless plan runner", async () => {
        const intent =
            "Extract WideWorldImporters to a dacpac, import it back as WWI_2, " +
            "dump all the schema objects from WWI_2 into an output table.";
        const classified = classifyRunbookIntent(intent);
        const base = createNewRunbookArtifact("New runbook", "headless-dacpac-inventory");
        base.family = classified.family;
        base.source.requirements = classified.requirements;
        const compiled = compileDeterministicDacpacInventory(base, intent);
        if (!compiled) {
            throw new Error("deterministic workflow was not selected");
        }
        if (isProposalFailure(compiled)) {
            throw new Error(compiled.detail);
        }

        const result = await runHeadlessPreview({
            artifactText: canonicalizeRunbookArtifact(compiled.artifact),
            parameterValues: {
                sourceConnection: "preview-source-profile",
                targetServer: "preview-localhost-profile",
            },
            runId: "dacpac-inventory-preview",
            deterministicPreviewAcknowledged: true,
            approvePreviewGates: true,
        });

        expect(result).to.include({
            outcome: "pass",
            exitCode: HEADLESS_EXIT_CODES.pass,
            terminalState: "succeeded",
            verdict: "pass",
            evidenceAvailable: false,
        });
        expect(result.nodeCounts).to.deep.equal({
            succeeded: 9,
            failed: 0,
            skipped: 0,
            cancelled: 0,
        });
        expect(result.validation).to.include({
            valid: true,
            executable: true,
            simulatedMutationCount: 3,
        });
    });

    test("drives schema evolution and expected diff output through the headless plan runner", async () => {
        const intent =
            "Extract WideWorldImporters database to a dacpac. Deploy the dacpac back to the " +
            "same server and name it WideWorld_WIP. Now add a new table to WideWorld_WIP that " +
            "is dbo.Logs and add a representative logging table. Then run a schema compare " +
            "and show the schema deltas as diff output.";
        const classified = classifyRunbookIntent(intent);
        const base = createNewRunbookArtifact("New runbook", "headless-schema-evolution");
        base.family = classified.family;
        base.source.requirements = classified.requirements;
        const compiled = compileDeterministicDacpacEvolution(base, intent);
        if (!compiled) {
            throw new Error("deterministic schema evolution workflow was not selected");
        }
        if (isProposalFailure(compiled)) {
            throw new Error(compiled.detail);
        }

        const result = await runHeadlessPreview({
            artifactText: canonicalizeRunbookArtifact(compiled.artifact),
            parameterValues: {
                sourceConnection: "preview-source-profile",
                targetServer: "preview-localhost-profile",
            },
            runId: "schema-evolution-preview",
            deterministicPreviewAcknowledged: true,
            approvePreviewGates: true,
        });

        expect(result).to.include({
            outcome: "pass",
            exitCode: HEADLESS_EXIT_CODES.pass,
            terminalState: "succeeded",
            verdict: "pass",
            evidenceAvailable: false,
        });
        expect(result.nodeCounts).to.deep.equal({
            succeeded: 10,
            failed: 0,
            skipped: 0,
            cancelled: 0,
        });
        expect(result.validation).to.include({
            valid: true,
            executable: true,
            simulatedMutationCount: 5,
        });
    });

    test("drives sampled Cities workload capture and metrics through the headless plan runner", async () => {
        const intent =
            "Look at data in the WideWorldImporters database Application.Cities table, sample 20 rows, " +
            "generate a workload that does inserts and deletes in a loop 1000 times, collect server " +
            "statistics around IO and blocking, and present performance activity metrics.";
        const classified = classifyRunbookIntent(intent);
        const base = createNewRunbookArtifact("New runbook", "headless-cities-workload");
        base.family = classified.family;
        base.source.requirements = classified.requirements;
        const compiled = compileDeterministicCitiesWorkload(base, intent);
        if (!compiled) {
            throw new Error("deterministic Cities workload workflow was not selected");
        }
        if (isProposalFailure(compiled)) {
            throw new Error(compiled.detail);
        }

        const result = await runHeadlessPreview({
            artifactText: canonicalizeRunbookArtifact(compiled.artifact),
            parameterValues: {
                sourceConnection: "preview-wideworldimporters-profile",
                saPassword: "preview-secret-canary",
            },
            runId: "cities-workload-preview",
            deterministicPreviewAcknowledged: true,
            approvePreviewGates: true,
        });

        expect(result, JSON.stringify(result, undefined, 2)).to.include({
            outcome: "pass",
            exitCode: HEADLESS_EXIT_CODES.pass,
            terminalState: "succeeded",
            verdict: "pass",
            evidenceAvailable: false,
        });
        expect(result.nodeCounts).to.deep.equal({
            succeeded: 18,
            failed: 0,
            skipped: 0,
            cancelled: 0,
        });
        expect(result.validation).to.include({
            valid: true,
            executable: true,
            simulatedMutationCount: 7,
        });
        expect(JSON.stringify(result)).not.to.contain("preview-secret-canary");
    });

    test("previews the complete EF staging-clone validation lock without VS Code or a model", async () => {
        const intent = DEMO_RUNBOOK_INTENT;
        const classified = classifyRunbookIntent(intent);
        const base = createNewRunbookArtifact("New runbook", "headless-ef-release-candidate");
        base.family = classified.family;
        base.source.requirements = classified.requirements;
        const compiled = compileDeterministicEfModelComparison(base, intent);
        if (!compiled) {
            throw new Error("deterministic EF release-candidate workflow was not selected");
        }
        if (isProposalFailure(compiled)) {
            throw new Error(compiled.detail);
        }

        const result = await runHeadlessPreview({
            artifactText: canonicalizeRunbookArtifact(compiled.artifact),
            parameterValues: {
                repository: "C:\\preview\\myapp",
                baseRef: "main",
                headRef: "demo",
                project: "src/MyApp.Data/MyApp.Data.csproj",
                dbContext: "AppDbContext",
                renameDecisions: "[]",
                sourceConnection: "preview-staging-profile",
                sourceDatabaseName: "HobbesDemo_MyApp_Staging",
                containerName: "preview-myapp-sql2025",
                databaseName: "MyAppCandidate",
                sqlVersion: "2025",
                saPassword: "preview-secret-canary",
                migrationTimeoutSeconds: 300,
                workloadFile: "scripts/workload.sql",
                workloadRepetitions: 2,
                workloadTimeoutSeconds: 300,
                xeventMaxFileSizeMb: 16,
            },
            runId: "ef-release-candidate-preview",
            deterministicPreviewAcknowledged: true,
            approvePreviewGates: true,
        });

        expect(result, JSON.stringify(result, undefined, 2)).to.include({
            outcome: "pass",
            exitCode: HEADLESS_EXIT_CODES.pass,
            terminalState: "succeeded",
            verdict: "pass",
            evidenceAvailable: false,
        });
        expect(result.nodeCounts).to.deep.equal({
            succeeded: 40,
            failed: 0,
            skipped: 5,
            cancelled: 0,
        });
        expect(result.validation).to.include({ valid: true, executable: true });
        expect(result.validation.simulatedMutationCount).to.be.greaterThan(10);
        expect(JSON.stringify(result)).not.to.contain("preview-secret-canary");
        expect(JSON.stringify(result)).not.to.contain("preview-staging-profile");
    });

    test("refuses unsafe caller-provided run identities", async () => {
        const result = await runHeadlessPreview({
            artifactText: canonicalizeRunbookArtifact(createDeveloperValidationPreviewArtifact()),
            parameterValues,
            runId: "../escape",
            deterministicPreviewAcknowledged: true,
            approvePreviewGates: true,
        });
        expect(result).to.include({
            outcome: "invalid",
            exitCode: HEADLESS_EXIT_CODES.invalid,
            evidenceAvailable: false,
        });
        expect(result.validation.issues.at(-1)?.code).to.equal("HeadlessPreview.RunIdInvalid");
    });

    test("returns a distinct failing exit code without requiring evidence", async () => {
        const artifact = createFixtureRunbookArtifact();
        artifact.lock!.nodes[0].inputs!.sql = "SELECT 1";
        artifact.lock!.planHash = computePlanHash(artifact.source, artifact.lock!);
        const result = await runHeadlessPreview({
            artifactText: canonicalizeRunbookArtifact(artifact),
            parameterValues: { target: "synthetic-target", maxCount: 0 },
            runId: "ci-failing-preview",
            deterministicPreviewAcknowledged: true,
        });
        expect(result).to.include({
            outcome: "fail",
            exitCode: HEADLESS_EXIT_CODES.fail,
            terminalState: "failed",
            verdict: "fail",
            evidenceAvailable: false,
        });
    });

    test("returns the cancelled exit code for an aborted invocation", async () => {
        const cancellation = new AbortController();
        cancellation.abort();
        const result = await runHeadlessPreview({
            artifactText: canonicalizeRunbookArtifact(createDeveloperValidationPreviewArtifact()),
            parameterValues,
            runId: "ci-cancelled-preview",
            deterministicPreviewAcknowledged: true,
            approvePreviewGates: true,
            cancellationSignal: cancellation.signal,
        });
        expect(result).to.include({
            outcome: "cancelled",
            exitCode: HEADLESS_EXIT_CODES.cancelled,
            evidenceAvailable: false,
        });
    });
});
