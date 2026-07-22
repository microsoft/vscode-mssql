/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Host-neutral exact-ref Git tree materialization for EF design-time work. */

import * as crypto from "crypto";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { canonicalRunbookJson } from "../runbookDigest";

const MAX_GIT_METADATA_BYTES = 512 * 1024;
const MAX_GIT_TREE_METADATA_BYTES = 4 * 1024 * 1024;
const MAX_GIT_SNAPSHOT_FILES = 10_000;
const MAX_GIT_SNAPSHOT_BYTES = 128 * 1024 * 1024;
const CANCEL_POLL_MS = 50;

export interface GitRevisionSnapshotResult {
    repositoryRoot: string;
    requestedRef: string;
    commit: string;
    destinationRoot: string;
    fileCount: number;
    totalBytes: number;
    executableFileCount: number;
    snapshotSha256: string;
}

interface GitTreeFile {
    mode: "100644" | "100755";
    size: number;
    relativePath: string;
}

export class GitRevisionMaterializationError extends Error {
    constructor(public readonly code: string) {
        super(code);
        this.name = "GitRevisionMaterializationError";
    }
}

export async function materializeGitRevision(input: {
    trustedWorkspaceRoots: readonly string[];
    requestedRepository: string;
    requestedRef: string;
    destinationRoot: string;
    isCancellationRequested: () => boolean;
}): Promise<GitRevisionSnapshotResult> {
    if (input.trustedWorkspaceRoots.length === 0 || input.trustedWorkspaceRoots.length > 32) {
        throw new GitRevisionMaterializationError("HeadlessActivityHost.WorkspacePolicyInvalid");
    }
    const trustedRoots = await Promise.all(input.trustedWorkspaceRoots.map(realDirectory));
    const repository = await realDirectory(input.requestedRepository);
    assertContainedByOne(trustedRoots, repository);
    const repositoryRoot = await realDirectory(
        (
            await runBoundedGit(
                repository,
                ["rev-parse", "--show-toplevel"],
                MAX_GIT_METADATA_BYTES,
                input.isCancellationRequested,
            )
        ).trim(),
    );
    assertContainedByOne(trustedRoots, repositoryRoot);
    const normalizedRef = validateGitRef(input.requestedRef);
    const commit = await resolveGitCommit(
        repositoryRoot,
        normalizedRef,
        input.isCancellationRequested,
    );
    const treeText = await runBoundedGit(
        repositoryRoot,
        ["ls-tree", "-r", "-l", "-z", commit],
        MAX_GIT_TREE_METADATA_BYTES,
        input.isCancellationRequested,
    );
    const files = parseGitRevisionTree(treeText);
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (files.length > MAX_GIT_SNAPSHOT_FILES || totalBytes > MAX_GIT_SNAPSHOT_BYTES) {
        throw new GitRevisionMaterializationError("HeadlessActivityHost.GitSnapshotTooLarge");
    }
    const destination = path.resolve(input.destinationRoot);
    if (await pathExists(destination)) {
        throw new GitRevisionMaterializationError("HeadlessActivityHost.ArtifactWriteFailed");
    }
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    const parent = await fs.promises.realpath(path.dirname(destination));
    const parentStat = await fs.promises.lstat(parent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
        throw new GitRevisionMaterializationError("HeadlessActivityHost.ArtifactRootInvalid");
    }
    const indexPath = path.join(
        parent,
        `.${path.basename(destination)}.${crypto.randomUUID()}.index`,
    );
    const gitEnvironment = { GIT_INDEX_FILE: indexPath };
    let complete = false;
    try {
        await fs.promises.mkdir(destination);
        await runBoundedGit(
            repositoryRoot,
            ["read-tree", commit],
            MAX_GIT_METADATA_BYTES,
            input.isCancellationRequested,
            gitEnvironment,
        );
        await runBoundedGit(
            repositoryRoot,
            [
                "-c",
                "core.autocrlf=false",
                "-c",
                "core.eol=lf",
                "checkout-index",
                "--all",
                "--force",
                `--prefix=${destination}${path.sep}`,
            ],
            MAX_GIT_METADATA_BYTES,
            input.isCancellationRequested,
            gitEnvironment,
        );
        const extracted = await inventoryMaterializedRevision(
            destination,
            input.isCancellationRequested,
        );
        if (
            extracted.fileCount !== files.length ||
            extracted.totalBytes !== totalBytes ||
            extracted.relativePaths.some(
                (relativePath, index) => relativePath !== files[index].relativePath,
            )
        ) {
            throw new GitRevisionMaterializationError("HeadlessActivityHost.GitSnapshotInvalid");
        }
        const snapshotSha256 = crypto
            .createHash("sha256")
            .update(
                canonicalRunbookJson({
                    commit,
                    files: files.map((file) => ({
                        mode: file.mode,
                        size: file.size,
                        relativePath: file.relativePath,
                    })),
                }),
            )
            .digest("hex");
        complete = true;
        return {
            repositoryRoot,
            requestedRef: normalizedRef,
            commit,
            destinationRoot: destination,
            fileCount: files.length,
            totalBytes,
            executableFileCount: files.filter((file) => file.mode === "100755").length,
            snapshotSha256,
        };
    } finally {
        await fs.promises.rm(indexPath, { force: true }).catch(() => undefined);
        if (!complete) {
            await fs.promises
                .rm(destination, { recursive: true, force: true })
                .catch(() => undefined);
        }
    }
}

export function parseGitRevisionTree(value: string): GitTreeFile[] {
    const files: GitTreeFile[] = [];
    for (const row of value.split("\0")) {
        if (!row) {
            continue;
        }
        const match = /^(\d{6}) (blob|commit) ([a-f0-9]{40,64})\s+(-|\d+)\t([\s\S]+)$/u.exec(row);
        if (!match || (match[1] !== "100644" && match[1] !== "100755") || match[2] !== "blob") {
            throw new GitRevisionMaterializationError("HeadlessActivityHost.GitSnapshotInvalid");
        }
        const size = Number(match[4]);
        if (!Number.isSafeInteger(size) || size < 0) {
            throw new GitRevisionMaterializationError("HeadlessActivityHost.GitSnapshotInvalid");
        }
        files.push({
            mode: match[1],
            size,
            relativePath: validateGitRelativePath(match[5]),
        });
    }
    return files.sort((left, right) => ordinal(left.relativePath, right.relativePath));
}

async function inventoryMaterializedRevision(
    root: string,
    isCancellationRequested: () => boolean,
): Promise<{ fileCount: number; totalBytes: number; relativePaths: string[] }> {
    const relativePaths: string[] = [];
    let totalBytes = 0;
    const pending = [root];
    while (pending.length > 0) {
        if (isCancellationRequested()) {
            throw new GitRevisionMaterializationError("HeadlessActivityHost.ActivityCancelled");
        }
        const directory = pending.pop()!;
        for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
            const candidate = path.join(directory, entry.name);
            if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
                throw new GitRevisionMaterializationError(
                    "HeadlessActivityHost.GitSnapshotInvalid",
                );
            }
            if (entry.isDirectory()) {
                pending.push(candidate);
                continue;
            }
            const stat = await fs.promises.lstat(candidate);
            if (!stat.isFile() || stat.isSymbolicLink()) {
                throw new GitRevisionMaterializationError(
                    "HeadlessActivityHost.GitSnapshotInvalid",
                );
            }
            totalBytes += stat.size;
            relativePaths.push(validateGitRelativePath(path.relative(root, candidate)));
            if (
                relativePaths.length > MAX_GIT_SNAPSHOT_FILES ||
                totalBytes > MAX_GIT_SNAPSHOT_BYTES
            ) {
                throw new GitRevisionMaterializationError(
                    "HeadlessActivityHost.GitSnapshotTooLarge",
                );
            }
        }
    }
    relativePaths.sort(ordinal);
    return { fileCount: relativePaths.length, totalBytes, relativePaths };
}

async function resolveGitCommit(
    repositoryRoot: string,
    ref: string,
    isCancellationRequested: () => boolean,
): Promise<string> {
    const commit = (
        await runBoundedGit(
            repositoryRoot,
            ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
            MAX_GIT_METADATA_BYTES,
            isCancellationRequested,
        )
    ).trim();
    if (!/^[a-f0-9]{40,64}$/iu.test(commit)) {
        throw new GitRevisionMaterializationError("HeadlessActivityHost.GitRefInvalid");
    }
    return commit.toLowerCase();
}

function runBoundedGit(
    repositoryRoot: string,
    args: readonly string[],
    maximumBytes: number,
    isCancellationRequested: () => boolean,
    environment?: Readonly<Record<string, string>>,
): Promise<string> {
    return new Promise((resolve, reject) => {
        if (isCancellationRequested()) {
            reject(new GitRevisionMaterializationError("HeadlessActivityHost.ActivityCancelled"));
            return;
        }
        const child = spawn("git", [...args], {
            cwd: repositoryRoot,
            ...(environment ? { env: { ...process.env, ...environment } } : {}),
            windowsHide: true,
            shell: false,
            stdio: ["ignore", "pipe", "ignore"],
        });
        const stdout: Buffer[] = [];
        let stdoutBytes = 0;
        let exceeded = false;
        let cancelled = false;
        let settled = false;
        const settle = (action: () => void) => {
            if (!settled) {
                settled = true;
                clearInterval(cancellationPoll);
                action();
            }
        };
        const cancellationPoll = setInterval(() => {
            if (isCancellationRequested()) {
                cancelled = true;
                child.kill();
            }
        }, CANCEL_POLL_MS);
        child.stdout.on("data", (chunk: Buffer) => {
            stdoutBytes += chunk.byteLength;
            if (stdoutBytes > maximumBytes) {
                exceeded = true;
                child.kill();
            } else {
                stdout.push(Buffer.from(chunk));
            }
        });
        child.on("error", () =>
            settle(() =>
                reject(new GitRevisionMaterializationError("HeadlessActivityHost.GitUnavailable")),
            ),
        );
        child.on("close", (code) =>
            settle(() => {
                if (cancelled) {
                    reject(
                        new GitRevisionMaterializationError(
                            "HeadlessActivityHost.ActivityCancelled",
                        ),
                    );
                } else if (exceeded) {
                    reject(
                        new GitRevisionMaterializationError(
                            "HeadlessActivityHost.GitSnapshotTooLarge",
                        ),
                    );
                } else if (code !== 0) {
                    reject(
                        new GitRevisionMaterializationError(
                            "HeadlessActivityHost.GitOperationFailed",
                        ),
                    );
                } else {
                    resolve(Buffer.concat(stdout, stdoutBytes).toString("utf8"));
                }
            }),
        );
    });
}

async function realDirectory(value: string): Promise<string> {
    try {
        const resolved = await fs.promises.realpath(path.resolve(value));
        const stat = await fs.promises.lstat(resolved);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
            throw new Error("not a directory");
        }
        return resolved;
    } catch {
        throw new GitRevisionMaterializationError("HeadlessActivityHost.PathInvalid");
    }
}

function assertContainedByOne(roots: readonly string[], candidate: string): void {
    if (!roots.some((root) => isContained(root, candidate))) {
        throw new GitRevisionMaterializationError("HeadlessActivityHost.TargetOutsideWorkspace");
    }
}

function isContained(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return (
        relative === "" ||
        (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
}

function validateGitRef(value: string): string {
    const ref = value.trim();
    if (!ref || ref.length > 256 || ref.startsWith("-") || /[\u0000-\u001f\u007f]/u.test(ref)) {
        throw new GitRevisionMaterializationError("HeadlessActivityHost.GitRefInvalid");
    }
    return ref;
}

function validateGitRelativePath(value: string): string {
    const relativePath = value.replaceAll("\\", "/");
    if (
        !relativePath ||
        relativePath === ".." ||
        relativePath.startsWith("../") ||
        path.posix.isAbsolute(relativePath) ||
        /^[A-Za-z]:\//u.test(relativePath) ||
        /[\u0000-\u001f\u007f]/u.test(relativePath)
    ) {
        throw new GitRevisionMaterializationError("HeadlessActivityHost.GitSnapshotInvalid");
    }
    return relativePath;
}

function ordinal(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

async function pathExists(value: string): Promise<boolean> {
    try {
        await fs.promises.lstat(value);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return false;
        }
        throw error;
    }
}
