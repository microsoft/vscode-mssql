/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { buildLocalEvidenceBundle } from "../../src/runbookStudio/runtime/localEvidenceBundle";
import type { LocalToolchainProvenance } from "../../src/runbookStudio/runtime/localToolchainProvenance";

const completeToolchain: LocalToolchainProvenance = {
    complete: true,
    components: [
        {
            id: "vscode",
            version: "1.106.0",
            status: "resolved",
            versionSource: "host",
        },
        {
            id: "mssqlExtension",
            version: "1.45.0",
            status: "resolved",
            versionSource: "extensionManifest",
        },
        {
            id: "sqlDatabaseProjectsExtension",
            version: "1.5.0",
            status: "resolved",
            versionSource: "extensionManifest",
        },
        {
            id: "sqlToolsService",
            version: "6.0.0.0",
            configuredVersion: "6.0.20260713.1",
            status: "resolved",
            versionSource: "runtimeRequest",
        },
        {
            id: "dacFx",
            version: "170.5.38-preview",
            status: "resolved",
            versionSource: "serviceDependencyManifest",
            hostComponent: "sqlToolsService",
        },
        {
            id: "dockerEngine",
            version: "29.6.1",
            status: "resolved",
            versionSource: "runtimeRequest",
        },
    ],
};

suite("Runbook Studio local evidence bundle", () => {
    test("builds a stable secret-safe manifest from durable handles", () => {
        const input = {
            runId: "run-1",
            runbookId: "book-1",
            planRevision: "3",
            planHash: "sha256:plan",
            runtimeKind: "local",
            toolchain: completeToolchain,
            nodes: [
                {
                    nodeId: "build",
                    activityKind: "dacpac.build",
                    state: "succeeded" as const,
                    attempt: 1,
                    outcome: "success" as const,
                    outputs: [
                        {
                            handleId: "run-1/build/1",
                            contract: "dacpacArtifact/1",
                            bytes: 200,
                        },
                    ],
                    scalars: {
                        artifactPath: "C:\\private\\Database.dacpac",
                        artifactSha256: "a".repeat(64),
                        diagnosticCount: 0,
                        connectionRef: "profile-secret-handle",
                    },
                },
            ],
            generatedAtUtc: "2026-07-19T21:00:00.000Z",
        };

        const first = buildLocalEvidenceBundle(input);
        const retried = buildLocalEvidenceBundle({
            ...input,
            generatedAtUtc: "2026-07-19T22:00:00.000Z",
        });

        expect(first.verdict).to.equal("pass");
        expect(first.bundleSha256).to.equal(retried.bundleSha256);
        expect(first.manifestJson).to.contain("dacpacArtifact/1");
        expect(first.manifestJson).to.contain("artifactSha256");
        expect(first.manifestJson).to.contain("diagnosticCount");
        expect(first.manifestJson).to.contain("170.5.38-preview");
        expect(first.manifestJson).not.to.contain("C:\\private");
        expect(first.manifestJson).not.to.contain("profile-secret-handle");
    });

    test("reports failed nodes and expired evidence honestly", () => {
        const result = buildLocalEvidenceBundle({
            runId: "run-2",
            runbookId: "book-2",
            planRevision: "1",
            planHash: "sha256:plan",
            runtimeKind: "local",
            toolchain: completeToolchain,
            nodes: [
                {
                    nodeId: "tests",
                    activityKind: "sqltest.run",
                    state: "failed",
                    attempt: 1,
                    outcome: "failure",
                    outputs: [
                        {
                            handleId: "run-2/tests/1",
                            contract: "testResults/1",
                            expired: true,
                        },
                    ],
                    scalars: { total: 2, passed: 1, failed: 1 },
                },
            ],
        });

        expect(result.verdict).to.equal("fail");
        expect(result.failedNodeCount).to.equal(1);
        expect(result.evidenceHandleCount).to.equal(1);
        expect(JSON.parse(result.manifestJson).summary.incompleteEvidence).to.equal(true);
    });

    test("uses indeterminate when evidence handles have expired without a failed check", () => {
        const result = buildLocalEvidenceBundle({
            runId: "run-3",
            runbookId: "book-3",
            planRevision: "1",
            planHash: "sha256:plan",
            runtimeKind: "local",
            toolchain: completeToolchain,
            nodes: [
                {
                    nodeId: "verify",
                    activityKind: "schema.compare",
                    state: "succeeded",
                    attempt: 1,
                    outcome: "success",
                    outputs: [
                        {
                            handleId: "run-3/verify/1",
                            contract: "schemaDiff/1",
                            expired: true,
                        },
                    ],
                },
            ],
        });

        expect(result.verdict).to.equal("indeterminate");
    });

    test("uses indeterminate when runtime tool versions cannot be proven", () => {
        const result = buildLocalEvidenceBundle({
            runId: "run-4",
            runbookId: "book-4",
            planRevision: "1",
            planHash: "sha256:plan",
            runtimeKind: "local",
            toolchain: {
                complete: false,
                components: completeToolchain.components.map((component) =>
                    component.id === "dacFx"
                        ? { ...component, version: null, status: "unavailable" as const }
                        : { ...component },
                ),
            },
            nodes: [
                {
                    nodeId: "verify",
                    activityKind: "schema.compare",
                    state: "succeeded",
                    attempt: 1,
                    outcome: "success",
                    outputs: [{ handleId: "run-4/verify/1", contract: "schemaDiff/1" }],
                },
            ],
        });

        expect(result.verdict).to.equal("indeterminate");
        expect(JSON.parse(result.manifestJson).summary.toolchainComplete).to.equal(false);
    });

    test("does not require unused developer providers for read-only evidence", () => {
        const result = buildLocalEvidenceBundle({
            runId: "run-5",
            runbookId: "book-5",
            planRevision: "1",
            planHash: "sha256:plan",
            runtimeKind: "local",
            toolchain: {
                complete: false,
                components: completeToolchain.components.map((component) =>
                    component.id === "dacFx" || component.id === "sqlDatabaseProjectsExtension"
                        ? { ...component, version: null, status: "unavailable" as const }
                        : { ...component },
                ),
            },
            nodes: [
                {
                    nodeId: "query",
                    activityKind: "sql.query.read",
                    state: "succeeded",
                    attempt: 1,
                    outcome: "success",
                    outputs: [{ handleId: "run-5/query/1", contract: "rowset/1" }],
                },
            ],
        });

        const manifest = JSON.parse(result.manifestJson);
        expect(result.verdict).to.equal("pass");
        expect(manifest.toolchain.requiredComponents).to.deep.equal([
            "vscode",
            "mssqlExtension",
            "sqlToolsService",
        ]);
    });

    test("requires Docker engine identity for retained XEL evidence", () => {
        const result = buildLocalEvidenceBundle({
            runId: "run-xel",
            runbookId: "book-xel",
            planRevision: "1",
            planHash: "sha256:plan",
            runtimeKind: "local",
            toolchain: {
                complete: false,
                components: completeToolchain.components.map((component) =>
                    component.id === "dockerEngine"
                        ? { ...component, version: null, status: "unavailable" as const }
                        : { ...component },
                ),
            },
            nodes: [
                {
                    nodeId: "collect",
                    activityKind: "xevent.xel.collect",
                    state: "succeeded",
                    attempt: 1,
                    outcome: "success",
                    outputs: [{ handleId: "run-xel/collect/1", contract: "xelArtifact/1" }],
                },
            ],
        });

        const manifest = JSON.parse(result.manifestJson);
        expect(result.verdict).to.equal("indeterminate");
        expect(manifest.toolchain.requiredComponents).to.include("dockerEngine");
    });

    test("fake preview evidence requires only the host and extension", () => {
        const result = buildLocalEvidenceBundle({
            runId: "run-fake",
            runbookId: "book-fake",
            planRevision: "1",
            planHash: `sha256:${"a".repeat(64)}`,
            runtimeKind: "fake",
            toolchain: {
                complete: false,
                components: completeToolchain.components.map((component) =>
                    component.id === "vscode" || component.id === "mssqlExtension"
                        ? component
                        : { ...component, version: null, status: "unavailable" as const },
                ),
            },
            nodes: [
                {
                    nodeId: "preview",
                    activityKind: "dacpac.deploy",
                    state: "succeeded",
                    attempt: 1,
                    outcome: "success",
                },
            ],
        });

        const manifest = JSON.parse(result.manifestJson);
        expect(result.verdict).to.equal("pass");
        expect(manifest.toolchain.requiredComponents).to.deep.equal(["vscode", "mssqlExtension"]);
        expect(manifest.toolchain.allComponentsResolved).to.equal(false);
    });
});
