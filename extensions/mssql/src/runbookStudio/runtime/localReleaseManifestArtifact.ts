/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Atomic retention and immediate tamper checks for release-manifest inputs. */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { retainedOutputArtifact, verifyRetainedOutputArtifact } from "../outputArtifact";
import type { LocalReleaseManifestResult } from "./localReleaseManifest";

export type LocalReleaseManifestArtifactErrorReason =
    | "cancelled"
    | "inputChanged"
    | "targetExists"
    | "writeFailed";

export class LocalReleaseManifestArtifactError extends Error {
    constructor(public readonly reason: LocalReleaseManifestArtifactErrorReason) {
        super(`release manifest artifact ${reason}`);
        this.name = "LocalReleaseManifestArtifactError";
    }
}

export interface RequiredReleaseEvidenceArtifact {
    nodeId: string;
    contract: "dacpacArtifact/1" | "xelArtifact/1";
    expectedSha256: string;
}

export async function verifyLocalReleaseEvidenceArtifacts(input: {
    evidenceValues: ReadonlyMap<string, Record<string, string | number | boolean>>;
    required: readonly RequiredReleaseEvidenceArtifact[];
    trustedRoots: readonly string[];
    isCancellationRequested: () => boolean;
}): Promise<void> {
    for (const required of input.required) {
        if (input.isCancellationRequested()) {
            throw new LocalReleaseManifestArtifactError("cancelled");
        }
        const scalars = input.evidenceValues.get(required.nodeId);
        const expectedSha256 = normalizeSha256(required.expectedSha256);
        const recordedSha256 = normalizeSha256(scalars?.artifactSha256);
        const artifact = scalars
            ? retainedOutputArtifact({ contract: required.contract, scalars })
            : undefined;
        if (
            !expectedSha256 ||
            recordedSha256 !== expectedSha256 ||
            !artifact ||
            !(await verifyRetainedOutputArtifact(artifact, input.trustedRoots))
        ) {
            throw new LocalReleaseManifestArtifactError("inputChanged");
        }
    }
}

export async function persistLocalReleaseManifestArtifact(
    artifactPath: string,
    manifest: LocalReleaseManifestResult,
    isCancellationRequested: () => boolean,
): Promise<{ artifactPath: string; artifactSha256: string; artifactSizeBytes: number }> {
    if (!path.isAbsolute(artifactPath) || path.extname(artifactPath).toLowerCase() !== ".json") {
        throw new LocalReleaseManifestArtifactError("writeFailed");
    }
    if (isCancellationRequested()) {
        throw new LocalReleaseManifestArtifactError("cancelled");
    }
    const temporaryPath = `${artifactPath}.tmp`;
    if ((await exists(artifactPath)) || (await exists(temporaryPath))) {
        throw new LocalReleaseManifestArtifactError("targetExists");
    }
    const bytes = Buffer.from(manifest.manifestJson, "utf8");
    let committed = false;
    let renamed = false;
    try {
        const handle = await fs.promises.open(temporaryPath, "wx");
        try {
            await handle.writeFile(bytes);
            await handle.sync();
        } finally {
            await handle.close();
        }
        if (isCancellationRequested()) {
            throw new LocalReleaseManifestArtifactError("cancelled");
        }
        await fs.promises.rename(temporaryPath, artifactPath);
        renamed = true;
        const [stat, retainedBytes] = await Promise.all([
            fs.promises.stat(artifactPath),
            fs.promises.readFile(artifactPath),
        ]);
        if (!stat.isFile() || stat.size !== bytes.length || !retainedBytes.equals(bytes)) {
            throw new LocalReleaseManifestArtifactError("writeFailed");
        }
        if (isCancellationRequested()) {
            throw new LocalReleaseManifestArtifactError("cancelled");
        }
        committed = true;
        return {
            artifactPath,
            artifactSha256: crypto.createHash("sha256").update(retainedBytes).digest("hex"),
            artifactSizeBytes: stat.size,
        };
    } catch (error) {
        if (error instanceof LocalReleaseManifestArtifactError) {
            throw error;
        }
        throw new LocalReleaseManifestArtifactError("writeFailed");
    } finally {
        await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
        if (renamed && !committed) {
            await fs.promises.rm(artifactPath, { force: true }).catch(() => undefined);
        }
    }
}

function normalizeSha256(value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }
    const normalized = value.startsWith("sha256:") ? value.slice("sha256:".length) : value;
    return /^[a-f0-9]{64}$/i.test(normalized) ? normalized.toLowerCase() : undefined;
}

async function exists(candidate: string): Promise<boolean> {
    try {
        await fs.promises.access(candidate, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}
