/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    LocalReleaseManifestArtifactError,
    persistLocalReleaseManifestArtifact,
    verifyLocalReleaseEvidenceArtifacts,
} from "../../src/runbookStudio/runtime/localReleaseManifestArtifact";
import type { LocalReleaseManifestResult } from "../../src/runbookStudio/runtime/localReleaseManifest";

suite("Runbook Studio local release manifest artifact", () => {
    let root: string;

    setup(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rbs-release-manifest-"));
    });

    teardown(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    test("retains a complete manifest atomically and refuses overwrite", async () => {
        const artifactPath = path.join(root, "release-manifest.json");
        const result = await persistLocalReleaseManifestArtifact(
            artifactPath,
            manifest(),
            () => false,
        );

        expect(result.artifactPath).to.equal(artifactPath);
        expect(result.artifactSizeBytes).to.equal(Buffer.byteLength(manifest().manifestJson));
        expect(fs.existsSync(`${artifactPath}.tmp`)).to.equal(false);
        const original = fs.readFileSync(artifactPath, "utf8");
        expect(
            await failureReason(() =>
                persistLocalReleaseManifestArtifact(artifactPath, manifest(), () => false),
            ),
        ).to.equal("targetExists");
        expect(fs.readFileSync(artifactPath, "utf8")).to.equal(original);
    });

    test("cancellation after the durable temporary write leaves no visible partial artifact", async () => {
        const artifactPath = path.join(root, "release-manifest.json");
        let checks = 0;
        const reason = await failureReason(() =>
            persistLocalReleaseManifestArtifact(artifactPath, manifest(), () => ++checks >= 2),
        );

        expect(reason).to.equal("cancelled");
        expect(fs.existsSync(artifactPath)).to.equal(false);
        expect(fs.existsSync(`${artifactPath}.tmp`)).to.equal(false);
    });

    test("re-verifies base DACPAC, XEL, and candidate bytes immediately before manifest", async () => {
        const artifacts = [
            ["base", "dacpacArtifact/1", "base.dacpac", "base package"],
            ["capture", "xelArtifact/1", "capture.xel", "xel evidence"],
            ["candidate", "dacpacArtifact/1", "candidate.dacpac", "candidate package"],
        ] as const;
        const evidenceValues = new Map<string, Record<string, string | number | boolean>>();
        const required = artifacts.map(([nodeId, contract, fileName, content]) => {
            const artifactPath = path.join(root, fileName);
            const bytes = Buffer.from(content, "utf8");
            fs.writeFileSync(artifactPath, bytes);
            const artifactSha256 = createHash("sha256").update(bytes).digest("hex");
            evidenceValues.set(nodeId, {
                artifactPath,
                artifactSha256,
                artifactSizeBytes: bytes.length,
            });
            return { nodeId, contract, expectedSha256: artifactSha256 };
        });

        await verifyLocalReleaseEvidenceArtifacts({
            evidenceValues,
            required,
            trustedRoots: [root],
            isCancellationRequested: () => false,
        });

        fs.writeFileSync(path.join(root, "candidate.dacpac"), "tampered package!");
        expect(
            await failureReason(() =>
                verifyLocalReleaseEvidenceArtifacts({
                    evidenceValues,
                    required,
                    trustedRoots: [root],
                    isCancellationRequested: () => false,
                }),
            ),
        ).to.equal("inputChanged");
    });
});

function manifest(): LocalReleaseManifestResult {
    return {
        manifestSha256: "a".repeat(64),
        manifestJson: JSON.stringify({ contract: "releaseManifest/1", value: "bounded" }),
        evidenceCount: 16,
        evidenceComplete: true,
        protectedDeploymentAuthorized: false,
        generatedAtUtc: "2026-07-22T00:00:00.000Z",
    };
}

async function failureReason(action: () => Promise<unknown>): Promise<string | undefined> {
    try {
        await action();
        return undefined;
    } catch (error) {
        return error instanceof LocalReleaseManifestArtifactError ? error.reason : undefined;
    }
}
