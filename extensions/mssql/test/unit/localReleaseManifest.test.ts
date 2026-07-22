/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { buildLocalReleaseManifest } from "../../src/runbookStudio/runtime/localReleaseManifest";
import type { LocalToolchainProvenance } from "../../src/runbookStudio/runtime/localToolchainProvenance";

const toolchain: LocalToolchainProvenance = {
    complete: true,
    components: [
        { id: "vscode", version: "1.106.0", status: "resolved", versionSource: "host" },
        {
            id: "mssqlExtension",
            version: "1.45.0",
            status: "resolved",
            versionSource: "extensionManifest",
        },
        {
            id: "sqlDatabaseProjectsExtension",
            version: null,
            status: "unavailable",
            versionSource: "none",
        },
        {
            id: "sqlToolsService",
            version: "6.0.0.0",
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

function validInput() {
    return {
        runId: "run-1",
        runbookId: "book-1",
        planRevision: "7",
        planHash: `sha256:${"f".repeat(64)}`,
        baseCommit: "1".repeat(40),
        headCommit: "2".repeat(40),
        changeSetSha256: "3".repeat(64),
        baseModelSha256: "4".repeat(64),
        headModelSha256: "5".repeat(64),
        modelDiffSha256: "6".repeat(64),
        migrationManifestSha256: "7".repeat(64),
        baseDacpacSha256: "8".repeat(64),
        baseSchemaReportSha256: "9".repeat(64),
        forwardConvergenceSha256: "a".repeat(64),
        forwardConverged: true,
        workloadSha256: "b".repeat(64),
        workloadFingerprint: "c".repeat(64),
        environmentFingerprint: "d".repeat(64),
        beforeSchemaSha256: "e".repeat(64),
        afterSchemaSha256: "e".repeat(64),
        performanceDeltaSha256: "f".repeat(64),
        schemaComparability: "same",
        failedBatchCount: 0,
        xelSha256: "1".repeat(64),
        captureComplete: true,
        candidateDacpacSha256: "2".repeat(64),
        toolchain,
    };
}

suite("Runbook Studio local release manifest", () => {
    test("binds a stable candidate digest without protected deployment authority", () => {
        const first = buildLocalReleaseManifest({
            ...validInput(),
            generatedAtUtc: "2026-07-21T01:00:00.000Z",
        });
        const second = buildLocalReleaseManifest({
            ...validInput(),
            generatedAtUtc: "2026-07-21T02:00:00.000Z",
        });
        const manifest = JSON.parse(first.manifestJson);

        expect(first.manifestSha256).to.equal(second.manifestSha256);
        expect(first.evidenceCount).to.equal(16);
        expect(first.evidenceComplete).to.equal(true);
        expect(first.protectedDeploymentAuthorized).to.equal(false);
        expect(manifest.authority).to.deep.equal({
            scope: "ownedContainerCandidate",
            protectedDeploymentAuthorized: false,
        });
        expect(first.manifestJson).not.to.contain("connectionRef");
        expect(first.manifestJson).not.to.contain("artifactPath");
    });

    test("fails closed on invalid or unsuccessful validation evidence", () => {
        expect(() => buildLocalReleaseManifest({ ...validInput(), failedBatchCount: 1 })).to.throw(
            "incomplete or failed",
        );
        expect(() =>
            buildLocalReleaseManifest({
                ...validInput(),
                afterSchemaSha256: "0".repeat(64),
            }),
        ).to.throw("incomplete or failed");
        expect(() =>
            buildLocalReleaseManifest({ ...validInput(), xelSha256: "not-a-digest" }),
        ).to.throw("invalid release manifest digest");
    });

    test("records incomplete toolchain provenance without granting authority", () => {
        const result = buildLocalReleaseManifest({
            ...validInput(),
            toolchain: {
                complete: false,
                components: toolchain.components.map((component) =>
                    component.id === "dacFx"
                        ? { ...component, version: null, status: "unavailable" as const }
                        : component,
                ),
            },
        });

        expect(result.evidenceComplete).to.equal(false);
        expect(result.protectedDeploymentAuthorized).to.equal(false);
    });

    test("normalizes labeled host fingerprints into canonical evidence digests", () => {
        const result = buildLocalReleaseManifest({
            ...validInput(),
            environmentFingerprint: `sha256:${"d".repeat(64)}`,
        });

        expect(result.manifestJson).to.contain(`"sha256": "${"d".repeat(64)}"`);
        expect(result.manifestJson).not.to.contain("sha256:dddd");
    });

    test("retains the STS v2 schema visualizer identity as a typed fingerprint", () => {
        const schemaFingerprint = `svf_${"A".repeat(22)}`;
        const result = buildLocalReleaseManifest({
            ...validInput(),
            beforeSchemaSha256: schemaFingerprint,
            afterSchemaSha256: schemaFingerprint,
        });

        expect(result.manifestJson).to.contain(`"schemaFingerprint": "${schemaFingerprint}"`);
        expect(result.manifestJson).to.contain('"fingerprintKind": "schemaVisualizer/1"');
        expect(() =>
            buildLocalReleaseManifest({
                ...validInput(),
                beforeSchemaSha256: schemaFingerprint,
                afterSchemaSha256: `svf_${"B".repeat(22)}`,
            }),
        ).to.throw("incomplete or failed");
    });
});
