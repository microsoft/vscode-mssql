/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Extension-controlled staging for approved DACPAC deployment effects.
 *
 * A workspace build artifact is mutable. Copying it beneath a directory named
 * by its approved SHA-256 gives the deployment boundary a private, unique file
 * to preview and publish. The copy is re-hashed after staging and immediately
 * before publish; cleanup only ever unlinks the exact validated stage file.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const STAGED_FILE_PATTERN = /^[a-f0-9-]{36}\.dacpac$/;

export type LocalDacpacStageFailure =
    | "cancelled"
    | "copyFailed"
    | "digestMismatch"
    | "invalidArtifact"
    | "invalidDigest"
    | "invalidStagePath";

export class LocalDacpacStageError extends Error {
    constructor(public readonly reason: LocalDacpacStageFailure) {
        super(`Local DACPAC staging failed: ${reason}`);
        this.name = "LocalDacpacStageError";
    }
}

export interface StagedLocalDacpacArtifact {
    readonly stagingRoot: string;
    readonly contentDirectory: string;
    readonly stagedPath: string;
    readonly artifactSha256: string;
    readonly artifactSizeBytes: number;
}

export interface StagedLocalDacpacCleanupResult {
    deletedFiles: number;
    deletedDirectories: number;
}

export async function stageLocalDacpacArtifact(
    requestedStagingRoot: string,
    sourcePath: string,
    expectedSha256: string,
    isCancellationRequested: () => boolean,
): Promise<StagedLocalDacpacArtifact> {
    if (!SHA256_PATTERN.test(expectedSha256)) {
        throw new LocalDacpacStageError("invalidDigest");
    }
    throwIfCancelled(isCancellationRequested);

    const stagingRoot = path.resolve(requestedStagingRoot);
    const contentDirectory = path.join(stagingRoot, expectedSha256);
    const stagedPath = path.join(contentDirectory, `${crypto.randomUUID()}.dacpac`);
    await fs.promises.mkdir(contentDirectory, { recursive: true });
    try {
        await fs.promises.copyFile(sourcePath, stagedPath, fs.constants.COPYFILE_EXCL);
        throwIfCancelled(isCancellationRequested);
        const stat = await fs.promises.lstat(stagedPath);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) {
            throw new LocalDacpacStageError("invalidArtifact");
        }
        const artifactSha256 = await sha256File(stagedPath, isCancellationRequested);
        if (artifactSha256 !== expectedSha256) {
            throw new LocalDacpacStageError("digestMismatch");
        }
        try {
            await fs.promises.chmod(stagedPath, 0o444);
        } catch {
            // Windows ACLs may not implement POSIX read-only modes. Integrity
            // never relies on this hint: verifyStagedLocalDacpacArtifact hashes
            // the private copy again immediately before publish.
        }
        return Object.freeze({
            stagingRoot,
            contentDirectory,
            stagedPath,
            artifactSha256,
            artifactSizeBytes: stat.size,
        });
    } catch (error) {
        await removeExactStageFile(stagingRoot, contentDirectory, stagedPath);
        if (error instanceof LocalDacpacStageError) {
            throw error;
        }
        throw new LocalDacpacStageError("copyFailed");
    }
}

export async function verifyStagedLocalDacpacArtifact(
    stage: StagedLocalDacpacArtifact,
    isCancellationRequested: () => boolean,
): Promise<void> {
    assertStagePath(stage);
    throwIfCancelled(isCancellationRequested);
    let stat: fs.Stats;
    try {
        stat = await fs.promises.lstat(stage.stagedPath);
    } catch {
        throw new LocalDacpacStageError("invalidArtifact");
    }
    if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size !== stage.artifactSizeBytes ||
        stat.size === 0
    ) {
        throw new LocalDacpacStageError("invalidArtifact");
    }
    const digest = await sha256File(stage.stagedPath, isCancellationRequested);
    if (digest !== stage.artifactSha256) {
        throw new LocalDacpacStageError("digestMismatch");
    }
}

export async function disposeStagedLocalDacpacArtifact(
    stage: StagedLocalDacpacArtifact,
): Promise<void> {
    assertStagePath(stage);
    await removeExactStageFile(stage.stagingRoot, stage.contentDirectory, stage.stagedPath);
}

/**
 * Remove only old, directly contained stage files whose directory and file
 * names match the format this module creates. Unknown entries are preserved.
 */
export function cleanupStaleLocalDacpacArtifacts(
    requestedStagingRoot: string,
    olderThanEpochMs: number,
): StagedLocalDacpacCleanupResult {
    const stagingRoot = path.resolve(requestedStagingRoot);
    let deletedFiles = 0;
    let deletedDirectories = 0;
    let contentDirectories: fs.Dirent[];
    try {
        contentDirectories = fs.readdirSync(stagingRoot, { withFileTypes: true });
    } catch {
        return { deletedFiles, deletedDirectories };
    }
    for (const contentEntry of contentDirectories) {
        if (!contentEntry.isDirectory() || !SHA256_PATTERN.test(contentEntry.name)) {
            continue;
        }
        const contentDirectory = path.join(stagingRoot, contentEntry.name);
        let stageEntries: fs.Dirent[];
        try {
            stageEntries = fs.readdirSync(contentDirectory, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const stageEntry of stageEntries) {
            if (!STAGED_FILE_PATTERN.test(stageEntry.name)) {
                continue;
            }
            const stagedPath = path.join(contentDirectory, stageEntry.name);
            try {
                const stat = fs.lstatSync(stagedPath);
                if (stat.mtimeMs >= olderThanEpochMs) {
                    continue;
                }
                if (stat.isFile()) {
                    try {
                        fs.chmodSync(stagedPath, 0o600);
                    } catch {
                        // Best effort before unlinking a read-only regular file.
                    }
                } else if (!stat.isSymbolicLink()) {
                    continue;
                }
                fs.unlinkSync(stagedPath);
                deletedFiles++;
            } catch {
                // A live deployment or another extension window may own it.
            }
        }
        try {
            fs.rmdirSync(contentDirectory);
            deletedDirectories++;
        } catch {
            // Non-empty, live, or concurrently removed directories remain.
        }
    }
    return { deletedFiles, deletedDirectories };
}

function assertStagePath(stage: StagedLocalDacpacArtifact): void {
    if (!SHA256_PATTERN.test(stage.artifactSha256)) {
        throw new LocalDacpacStageError("invalidStagePath");
    }
    const stagingRoot = path.resolve(stage.stagingRoot);
    const expectedDirectory = path.join(stagingRoot, stage.artifactSha256);
    const contentDirectory = path.resolve(stage.contentDirectory);
    const stagedPath = path.resolve(stage.stagedPath);
    if (
        contentDirectory !== expectedDirectory ||
        path.dirname(stagedPath) !== expectedDirectory ||
        !STAGED_FILE_PATTERN.test(path.basename(stagedPath))
    ) {
        throw new LocalDacpacStageError("invalidStagePath");
    }
}

async function removeExactStageFile(
    stagingRoot: string,
    contentDirectory: string,
    stagedPath: string,
): Promise<void> {
    const resolvedRoot = path.resolve(stagingRoot);
    const resolvedDirectory = path.resolve(contentDirectory);
    const resolvedPath = path.resolve(stagedPath);
    if (
        path.dirname(resolvedDirectory) !== resolvedRoot ||
        path.dirname(resolvedPath) !== resolvedDirectory ||
        !SHA256_PATTERN.test(path.basename(resolvedDirectory)) ||
        !STAGED_FILE_PATTERN.test(path.basename(resolvedPath))
    ) {
        throw new LocalDacpacStageError("invalidStagePath");
    }
    try {
        const stat = await fs.promises.lstat(resolvedPath);
        if (stat.isFile()) {
            try {
                await fs.promises.chmod(resolvedPath, 0o600);
            } catch {
                // Best effort before unlinking a read-only regular file.
            }
        }
        if (stat.isFile() || stat.isSymbolicLink()) {
            await fs.promises.unlink(resolvedPath);
        }
    } catch (error) {
        if (!isNodeErrorCode(error, "ENOENT")) {
            throw error;
        }
    }
    try {
        await fs.promises.rmdir(resolvedDirectory);
    } catch (error) {
        if (!isNodeErrorCode(error, "ENOENT") && !isNodeErrorCode(error, "ENOTEMPTY")) {
            throw error;
        }
    }
}

function sha256File(filePath: string, isCancellationRequested: () => boolean): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath);
        stream.on("data", (chunk) => {
            if (isCancellationRequested()) {
                stream.destroy(new LocalDacpacStageError("cancelled"));
                return;
            }
            hash.update(chunk);
        });
        stream.on("error", reject);
        stream.on("end", () => resolve(hash.digest("hex")));
    });
}

function throwIfCancelled(isCancellationRequested: () => boolean): void {
    if (isCancellationRequested()) {
        throw new LocalDacpacStageError("cancelled");
    }
}

function isNodeErrorCode(error: unknown, code: string): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === code;
}
