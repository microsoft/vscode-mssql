/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    EnvironmentHeadlessSecretProvider,
    HeadlessApprovalManifest,
    HeadlessProviderConfigurationError,
    ManifestHeadlessApprovalProvider,
    resolveHeadlessParameters,
} from "../../src/runbookStudio/headless/headlessExecutionProviders";
import { runHeadlessPreview } from "../../src/runbookStudio/headless/headlessRunner";
import {
    canonicalizeRunbookArtifact,
    computePlanHash,
} from "../../src/runbookStudio/runbookArtifact";
import { createDeveloperValidationPreviewArtifact } from "../../src/runbookStudio/developerValidationPreview";

suite("Runbook Studio headless execution providers", () => {
    test("resolves declared secrets by environment indirection without exposing values", async () => {
        const provider = new EnvironmentHeadlessSecretProvider(
            { saPassword: "MYAPP_SA_PASSWORD" },
            { MYAPP_SA_PASSWORD: "secret-canary-value" },
        );
        const definitions = [
            {
                id: "saPassword",
                label: "SA password",
                type: "secret" as const,
                required: true,
            },
            {
                id: "repetitions",
                label: "Repetitions",
                type: "int" as const,
                required: true,
            },
        ];
        const resolved = await resolveHeadlessParameters(
            definitions,
            { repetitions: 2 },
            { allowInlineSecrets: false, secretProvider: provider },
        );

        expect(resolved.issues).to.deep.equal([]);
        expect(resolved.values).to.deep.equal({
            saPassword: "secret-canary-value",
            repetitions: 2,
        });
        const denied = await resolveHeadlessParameters(
            definitions,
            { repetitions: 2, saPassword: "inline-secret-canary" },
            { allowInlineSecrets: false, secretProvider: provider },
        );
        expect(denied.issues).to.deep.include({
            kind: "parameter",
            code: "HeadlessActivityHost.InlineSecretDenied",
            parameterId: "saPassword",
        });
        expect(JSON.stringify(denied.issues)).not.to.contain("inline-secret-canary");

        const extraMapping = await resolveHeadlessParameters(
            definitions,
            { repetitions: 2 },
            {
                allowInlineSecrets: false,
                secretProvider: new EnvironmentHeadlessSecretProvider(
                    { unknownSecret: "UNKNOWN_SECRET" },
                    { UNKNOWN_SECRET: "unused-secret-canary" },
                ),
            },
        );
        expect(extraMapping.issues).to.deep.include({
            kind: "parameter",
            code: "HeadlessActivityHost.SecretMappingUnknown",
            parameterId: "unknownSecret",
        });
        expect(JSON.stringify(extraMapping.issues)).not.to.contain("unused-secret-canary");
    });

    test("refuses unsafe or aliased environment mappings", () => {
        expect(
            () =>
                new EnvironmentHeadlessSecretProvider({
                    saPassword: "NOT-AN-ENV-NAME",
                }),
        ).to.throw(HeadlessProviderConfigurationError, "HeadlessActivityHost.SecretMappingInvalid");
        expect(
            () =>
                new EnvironmentHeadlessSecretProvider({
                    firstSecret: "SHARED_SECRET",
                    secondSecret: "SHARED_SECRET",
                }),
        ).to.throw(HeadlessProviderConfigurationError, "HeadlessActivityHost.SecretMappingInvalid");
    });

    test("binds approvals to one run, runbook, plan, expiry, and gate set", async () => {
        const artifact = createDeveloperValidationPreviewArtifact();
        const now = Date.now();
        const manifest: HeadlessApprovalManifest = {
            schemaVersion: 1,
            runId: "ci-provider-run",
            runbookId: artifact.id,
            planRevision: artifact.lock!.planRevision,
            planHash: artifact.lock!.planHash,
            approvedGateIds: ["approve-sandbox", "approve-deploy"],
            expiresEpochMs: now + 60_000,
        };
        const provider = new ManifestHeadlessApprovalProvider(manifest, now);
        const approved = await provider.decide({
            runId: manifest.runId,
            runbookId: manifest.runbookId,
            planRevision: manifest.planRevision,
            planHash: manifest.planHash,
            gateId: "approve-sandbox",
        });
        expect(approved).to.include({ approved: true, providerKind: "digestBoundManifest" });
        expect(approved.policyDigest).to.match(/^sha256:[a-f0-9]{64}$/);
        expect(
            (
                await provider.decide({
                    runId: "another-run",
                    runbookId: manifest.runbookId,
                    planRevision: manifest.planRevision,
                    planHash: manifest.planHash,
                    gateId: "approve-sandbox",
                })
            ).approved,
        ).to.equal(false);

        expect(
            () =>
                new ManifestHeadlessApprovalProvider(
                    { ...manifest, expiresEpochMs: now + 25 * 60 * 60 * 1000 },
                    now,
                ),
        ).to.throw(
            HeadlessProviderConfigurationError,
            "HeadlessActivityHost.ApprovalManifestInvalid",
        );
    });

    test("uses runtime secret and manifest approval providers without a blanket bypass", async () => {
        const artifact = createDeveloperValidationPreviewArtifact();
        artifact.source.parameters.push({
            id: "runtimeSecret",
            label: "Runtime secret",
            type: "secret",
            required: true,
        });
        artifact.lock!.planHash = computePlanHash(artifact.source, artifact.lock!);
        const runId = "ci-provider-run";
        const approvalProvider = new ManifestHeadlessApprovalProvider({
            schemaVersion: 1,
            runId,
            runbookId: artifact.id,
            planRevision: artifact.lock!.planRevision,
            planHash: artifact.lock!.planHash,
            approvedGateIds: ["approve-sandbox", "approve-deploy"],
            expiresEpochMs: Date.now() + 60_000,
        });
        const result = await runHeadlessPreview({
            artifactText: canonicalizeRunbookArtifact(artifact),
            parameterValues: {
                projectPath: "Database.sqlproj",
                sandboxConnection: "preview-profile",
            },
            secretProvider: new EnvironmentHeadlessSecretProvider(
                { runtimeSecret: "RBS_RUNTIME_SECRET" },
                { RBS_RUNTIME_SECRET: "provider-secret-canary" },
            ),
            approvalProvider,
            allowInlineSecrets: false,
            approvePreviewGates: false,
            deterministicPreviewAcknowledged: true,
            runId,
        });

        expect(result, JSON.stringify(result, undefined, 2)).to.include({
            outcome: "pass",
            exitCode: 0,
        });
        expect(result.approvalPolicyDigest).to.equal(approvalProvider.policyDigest);
        expect(JSON.stringify(result)).not.to.contain("provider-secret-canary");

        const denied = await runHeadlessPreview({
            artifactText: canonicalizeRunbookArtifact(artifact),
            parameterValues: {
                projectPath: "Database.sqlproj",
                sandboxConnection: "preview-profile",
            },
            secretProvider: new EnvironmentHeadlessSecretProvider(
                { runtimeSecret: "RBS_RUNTIME_SECRET" },
                { RBS_RUNTIME_SECRET: "provider-secret-canary" },
            ),
            approvalProvider: new ManifestHeadlessApprovalProvider({
                schemaVersion: 1,
                runId: "another-run",
                runbookId: artifact.id,
                planRevision: artifact.lock!.planRevision,
                planHash: artifact.lock!.planHash,
                approvedGateIds: ["approve-sandbox", "approve-deploy"],
                expiresEpochMs: Date.now() + 60_000,
            }),
            allowInlineSecrets: false,
            approvePreviewGates: true,
            deterministicPreviewAcknowledged: true,
            runId,
        });
        expect(denied).to.include({ outcome: "blocked", blockedGateId: "approve-sandbox" });
    });
});
