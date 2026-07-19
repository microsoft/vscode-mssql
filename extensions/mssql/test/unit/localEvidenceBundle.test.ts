/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { buildLocalEvidenceBundle } from "../../src/runbookStudio/runtime/localEvidenceBundle";

suite("Runbook Studio local evidence bundle", () => {
    test("builds a stable secret-safe manifest from durable handles", () => {
        const input = {
            runId: "run-1",
            runbookId: "book-1",
            planRevision: "3",
            planHash: "sha256:plan",
            runtimeKind: "local",
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
            nodes: [
                {
                    nodeId: "verify",
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
});
