/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Host-only retained artifact validation. Runtime output paths are evidence,
 * never authority: callers must resolve the opaque result handle, admit a
 * closed contract/extension pair, confine the real path to a trusted root,
 * and verify the recorded size and digest immediately before an action.
 */

import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { RuntimeOutputPayload } from "./runtime/runtimeAdapterTypes";

const OUTPUT_ARTIFACT_EXTENSIONS = new Map<string, ReadonlySet<string>>([
    ["dacpacArtifact/1", new Set([".dacpac"])],
    ["schemaDiff/1", new Set([".xml"])],
    ["schemaCompareDocument/1", new Set([".json"])],
    ["workloadArtifact/1", new Set([".sql"])],
    ["xelArtifact/1", new Set([".xel"])],
    ["gitChangeSet/1", new Set([".patch"])],
]);

export const XEL_CUSTOM_EDITOR_VIEW_TYPE = "mssql.profilerXelView";

export function outputArtifactEditorViewType(contract: string): string | undefined {
    return contract === "xelArtifact/1" ? XEL_CUSTOM_EDITOR_VIEW_TYPE : undefined;
}

export interface RetainedOutputArtifact {
    contract: string;
    artifactPath: string;
    artifactSha256: string;
    artifactSizeBytes: number;
    fileName: string;
}

export function isOutputArtifactContract(contract: string): boolean {
    return OUTPUT_ARTIFACT_EXTENSIONS.has(contract);
}

export function retainedOutputArtifact(
    payload: RuntimeOutputPayload,
): RetainedOutputArtifact | undefined {
    const extensions = OUTPUT_ARTIFACT_EXTENSIONS.get(payload.contract);
    const artifactPath = payload.scalars?.artifactPath;
    const artifactSha256 = payload.scalars?.artifactSha256;
    const artifactSizeBytes = payload.scalars?.artifactSizeBytes;
    if (
        !extensions ||
        typeof artifactPath !== "string" ||
        !path.isAbsolute(artifactPath) ||
        typeof artifactSha256 !== "string" ||
        !/^[a-f0-9]{64}$/i.test(artifactSha256) ||
        typeof artifactSizeBytes !== "number" ||
        !Number.isSafeInteger(artifactSizeBytes) ||
        artifactSizeBytes <= 0
    ) {
        return undefined;
    }
    const extension = path.extname(artifactPath).toLowerCase();
    const fileName = path.basename(artifactPath);
    if (!extensions.has(extension) || !fileName || fileName === "." || fileName === "..") {
        return undefined;
    }
    return {
        contract: payload.contract,
        artifactPath: path.normalize(artifactPath),
        artifactSha256: artifactSha256.toLowerCase(),
        artifactSizeBytes,
        fileName,
    };
}

/** Returns the canonical file path only when it still matches its retained evidence. */
export async function verifyRetainedOutputArtifact(
    artifact: RetainedOutputArtifact,
    trustedRoots: readonly string[],
): Promise<string | undefined> {
    let realArtifactPath: string;
    try {
        realArtifactPath = await fs.promises.realpath(artifact.artifactPath);
    } catch {
        return undefined;
    }
    let confined = false;
    for (const trustedRoot of trustedRoots) {
        try {
            const realRoot = await fs.promises.realpath(trustedRoot);
            const relative = path.relative(realRoot, realArtifactPath);
            if (
                relative === "" ||
                (relative !== ".." &&
                    !relative.startsWith(`..${path.sep}`) &&
                    !path.isAbsolute(relative))
            ) {
                confined = true;
                break;
            }
        } catch {
            // A missing/unreadable root cannot admit a file.
        }
    }
    if (!confined) {
        return undefined;
    }
    try {
        const stat = await fs.promises.stat(realArtifactPath);
        if (!stat.isFile() || stat.size !== artifact.artifactSizeBytes) {
            return undefined;
        }
        const digest = await sha256File(realArtifactPath);
        return digest === artifact.artifactSha256 ? realArtifactPath : undefined;
    } catch {
        return undefined;
    }
}

function sha256File(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash("sha256");
        const stream = fs.createReadStream(filePath);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(hash.digest("hex")));
    });
}
