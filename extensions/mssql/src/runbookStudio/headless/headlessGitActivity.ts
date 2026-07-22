/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from "crypto";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { ActivityExecutionDelegate, NodeExecution } from "../runtime/fakeRuntimeAdapter";
import type { RunbookPlanNode } from "../../sharedInterfaces/runbookStudio";

const MAX_GIT_PATCH_BYTES = 8 * 1024 * 1024;
const MAX_GIT_METADATA_BYTES = 512 * 1024;
const MAX_GIT_CHANGED_FILES = 2000;
const CANCEL_POLL_MS = 50;
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SAFE_NODE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;

export class HeadlessGitActivityError extends Error {
    constructor(public readonly code: string) {
        super(code);
        this.name = "HeadlessGitActivityError";
    }
}

export interface HeadlessGitChangedFile {
    status: string;
    relativePath: string;
    previousPath?: string;
    entityRelated: boolean;
}

export interface HeadlessGitChangeSetResult {
    repositoryRoot: string;
    baseRef: string;
    headRef: string;
    baseCommit: string;
    headCommit: string;
    mergeBase: string;
    includeWorkingTree: boolean;
    dirty: boolean;
    dirtyFileCount: number;
    files: HeadlessGitChangedFile[];
    entityRelatedFileCount: number;
    artifactPath: string;
    artifactSizeBytes: number;
    artifactSha256: string;
}

export async function captureHeadlessGitChangeSet(input: {
    trustedWorkspaceRoot: string;
    requestedRepository: string;
    baseRef: string;
    headRef: string;
    includeWorkingTree: boolean;
    artifactRoot: string;
    runId: string;
    nodeId: string;
    isCancellationRequested: () => boolean;
}): Promise<HeadlessGitChangeSetResult> {
    if (!SAFE_RUN_ID.test(input.runId) || !SAFE_NODE_ID.test(input.nodeId)) {
        throw new HeadlessGitActivityError("HeadlessActivityHost.IdentityInvalid");
    }
    const trustedWorkspaceRoot = await realDirectory(input.trustedWorkspaceRoot);
    const requestedRepository = await realDirectory(input.requestedRepository);
    assertContained(trustedWorkspaceRoot, requestedRepository);
    const baseRef = validateGitRef(input.baseRef);
    const headRef = validateGitRef(input.headRef);
    const repositoryRoot = await realDirectory(
        (
            await runBoundedGit(
                requestedRepository,
                ["rev-parse", "--show-toplevel"],
                MAX_GIT_METADATA_BYTES,
                input.isCancellationRequested,
            )
        ).trim(),
    );
    assertContained(trustedWorkspaceRoot, repositoryRoot);
    const baseCommit = await resolveGitCommit(
        repositoryRoot,
        baseRef,
        input.isCancellationRequested,
    );
    const headCommit = await resolveGitCommit(
        repositoryRoot,
        headRef,
        input.isCancellationRequested,
    );
    const currentHead = await resolveGitCommit(
        repositoryRoot,
        "HEAD",
        input.isCancellationRequested,
    );
    if (input.includeWorkingTree && currentHead !== headCommit) {
        throw new HeadlessGitActivityError("HeadlessActivityHost.WorkingTreeHeadMismatch");
    }
    const mergeBase = (
        await runBoundedGit(
            repositoryRoot,
            ["merge-base", baseCommit, headCommit],
            MAX_GIT_METADATA_BYTES,
            input.isCancellationRequested,
        )
    ).trim();
    const statusText = await runBoundedGit(
        repositoryRoot,
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        MAX_GIT_METADATA_BYTES,
        input.isCancellationRequested,
    );
    const dirtyFileCount = statusText.split("\0").filter(Boolean).length;
    const range = input.includeWorkingTree ? [baseCommit] : [baseCommit, headCommit];
    const nameStatus = await runBoundedGit(
        repositoryRoot,
        [
            "-c",
            "core.quotepath=false",
            "diff",
            "--find-renames",
            "--name-status",
            "-z",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            ...range,
            "--",
        ],
        MAX_GIT_METADATA_BYTES,
        input.isCancellationRequested,
    );
    const files = parseHeadlessGitNameStatus(nameStatus);
    if (files.length > MAX_GIT_CHANGED_FILES) {
        throw new HeadlessGitActivityError("HeadlessActivityHost.GitChangeSetTooLarge");
    }
    const patchText = await runBoundedGit(
        repositoryRoot,
        [
            "-c",
            "core.quotepath=false",
            "diff",
            "--find-renames",
            "--binary",
            "--full-index",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            ...range,
            "--",
        ],
        MAX_GIT_PATCH_BYTES,
        input.isCancellationRequested,
    );
    const patchBytes = Buffer.from(
        patchText ||
            `# No changes between ${baseRef} (${baseCommit}) and ${headRef} (${headCommit}).\n`,
        "utf8",
    );
    const artifactRoot = await requireArtifactRoot(input.artifactRoot);
    const runDirectory = path.join(artifactRoot, input.runId);
    try {
        fs.mkdirSync(runDirectory, { recursive: false });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
            throw new HeadlessGitActivityError("HeadlessActivityHost.ArtifactWriteFailed");
        }
    }
    const runDirectoryStat = fs.lstatSync(runDirectory);
    if (!runDirectoryStat.isDirectory() || runDirectoryStat.isSymbolicLink()) {
        throw new HeadlessGitActivityError("HeadlessActivityHost.ArtifactRootInvalid");
    }
    const artifactPath = path.join(runDirectory, `${input.nodeId}.patch`);
    let artifactCreated = false;
    try {
        const descriptor = fs.openSync(artifactPath, "wx", 0o600);
        artifactCreated = true;
        try {
            fs.writeFileSync(descriptor, patchBytes);
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }
    } catch {
        if (artifactCreated) {
            fs.rmSync(artifactPath, { force: true });
        }
        throw new HeadlessGitActivityError("HeadlessActivityHost.ArtifactWriteFailed");
    }
    return {
        repositoryRoot,
        baseRef,
        headRef,
        baseCommit,
        headCommit,
        mergeBase,
        includeWorkingTree: input.includeWorkingTree,
        dirty: dirtyFileCount > 0,
        dirtyFileCount,
        files,
        entityRelatedFileCount: files.filter((file) => file.entityRelated).length,
        artifactPath,
        artifactSizeBytes: patchBytes.byteLength,
        artifactSha256: crypto.createHash("sha256").update(patchBytes).digest("hex"),
    };
}

export class HeadlessGitActivityDelegate implements ActivityExecutionDelegate {
    public readonly runtimeKind = "local" as const;
    public readonly supportedActivityKinds = new Set(["git.change-set.inspect"]);

    constructor(
        private readonly trustedWorkspaceRoot: string,
        private readonly artifactRoot: string,
    ) {}

    public async executeActivity(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution | undefined> {
        if (node.activityKind !== "git.change-set.inspect") {
            return undefined;
        }
        const repository = binding.resolveBind(node.inputs?.repository);
        const baseRef = binding.resolveBind(node.inputs?.baseRef);
        const headRef = binding.resolveBind(node.inputs?.headRef);
        const includeWorkingTree = binding.resolveBind(node.inputs?.includeWorkingTree);
        if (
            typeof repository !== "string" ||
            typeof baseRef !== "string" ||
            typeof headRef !== "string" ||
            typeof includeWorkingTree !== "boolean"
        ) {
            return {
                success: false,
                errorCode: "HeadlessActivityHost.BindingInvalid",
                message: "The Git change-set activity has an invalid binding.",
            };
        }
        try {
            const result = await captureHeadlessGitChangeSet({
                trustedWorkspaceRoot: this.trustedWorkspaceRoot,
                requestedRepository: repository,
                baseRef,
                headRef,
                includeWorkingTree,
                artifactRoot: this.artifactRoot,
                runId: binding.invocation.runId,
                nodeId: node.id,
                isCancellationRequested: binding.isCancellationRequested,
            });
            return {
                success: true,
                message: `Captured ${result.files.length} changed file(s), including ${result.entityRelatedFileCount} Entity Framework-related file(s).`,
                runMetrics: {
                    "git.changedFileCount": result.files.length,
                    "git.entityRelatedFileCount": result.entityRelatedFileCount,
                    "git.dirty": result.dirty,
                    "git.includeWorkingTree": result.includeWorkingTree,
                },
                output: {
                    contract: "gitChangeSet/1",
                    columns: ["status", "path", "previousPath", "entityRelated"],
                    rows: result.files.map((file) => [
                        file.status,
                        file.relativePath,
                        file.previousPath ?? null,
                        file.entityRelated,
                    ]),
                    scalars: {
                        artifactPath: result.artifactPath,
                        artifactSha256: result.artifactSha256,
                        artifactSizeBytes: result.artifactSizeBytes,
                        baseRef: result.baseRef,
                        headRef: result.headRef,
                        baseCommitSha256: result.baseCommit,
                        headCommitSha256: result.headCommit,
                        mergeBaseSha256: result.mergeBase,
                        changedFileCount: result.files.length,
                        entityRelatedFileCount: result.entityRelatedFileCount,
                        dirty: result.dirty,
                        dirtyFileCount: result.dirtyFileCount,
                        includeWorkingTree: result.includeWorkingTree,
                        executionMode: "headless",
                    },
                },
                values: {
                    artifactPath: result.artifactPath,
                    artifactSha256: result.artifactSha256,
                    changedFileCount: result.files.length,
                    entityRelatedFileCount: result.entityRelatedFileCount,
                    baseCommit: result.baseCommit,
                    headCommit: result.headCommit,
                    mergeBase: result.mergeBase,
                    dirty: result.dirty,
                },
            };
        } catch (error) {
            return {
                success: false,
                errorCode:
                    error instanceof HeadlessGitActivityError
                        ? error.code
                        : "HeadlessActivityHost.GitActivityFailed",
                message: "The bounded Git change-set activity failed.",
            };
        }
    }
}

export function parseHeadlessGitNameStatus(value: string): HeadlessGitChangedFile[] {
    if (value.includes("\0")) {
        return parseNullDelimitedNameStatus(value);
    }
    const files: HeadlessGitChangedFile[] = [];
    for (const line of value.split(/\r?\n/u)) {
        if (!line) {
            continue;
        }
        const fields = line.split("\t");
        const status = fields[0];
        const renamed = /^[RC]\d{0,3}$/u.test(status);
        if (!/^(?:[ACDMRTUXB]|[RC]\d{0,3})$/u.test(status) || fields.length !== (renamed ? 3 : 2)) {
            throw new HeadlessGitActivityError("HeadlessActivityHost.GitChangeSetInvalid");
        }
        const previousPath = renamed ? validateGitRelativePath(fields[1]) : undefined;
        const relativePath = validateGitRelativePath(fields[renamed ? 2 : 1]);
        files.push({
            status,
            relativePath,
            ...(previousPath ? { previousPath } : {}),
            entityRelated: isEntityRelatedPath(relativePath),
        });
    }
    return sortChangedFiles(files);
}

function parseNullDelimitedNameStatus(value: string): HeadlessGitChangedFile[] {
    const fields = value.split("\0");
    if (fields.at(-1) === "") {
        fields.pop();
    }
    const files: HeadlessGitChangedFile[] = [];
    for (let index = 0; index < fields.length; ) {
        const status = fields[index++];
        const renamed = /^[RC]\d{0,3}$/u.test(status);
        if (!/^(?:[ACDMRTUXB]|[RC]\d{0,3})$/u.test(status)) {
            throw new HeadlessGitActivityError("HeadlessActivityHost.GitChangeSetInvalid");
        }
        const firstPath = fields[index++];
        const secondPath = renamed ? fields[index++] : undefined;
        if (firstPath === undefined || (renamed && secondPath === undefined)) {
            throw new HeadlessGitActivityError("HeadlessActivityHost.GitChangeSetInvalid");
        }
        const previousPath = renamed ? validateGitRelativePath(firstPath) : undefined;
        const relativePath = validateGitRelativePath(renamed ? secondPath! : firstPath);
        files.push({
            status,
            relativePath,
            ...(previousPath ? { previousPath } : {}),
            entityRelated: isEntityRelatedPath(relativePath),
        });
    }
    return sortChangedFiles(files);
}

function sortChangedFiles(files: HeadlessGitChangedFile[]): HeadlessGitChangedFile[] {
    return files.sort((left, right) =>
        left.relativePath < right.relativePath
            ? -1
            : left.relativePath > right.relativePath
              ? 1
              : 0,
    );
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
        throw new HeadlessGitActivityError("HeadlessActivityHost.GitRefInvalid");
    }
    return commit.toLowerCase();
}

function runBoundedGit(
    repositoryRoot: string,
    args: readonly string[],
    maximumBytes: number,
    isCancellationRequested: () => boolean,
): Promise<string> {
    return new Promise((resolve, reject) => {
        if (isCancellationRequested()) {
            reject(new HeadlessGitActivityError("HeadlessActivityHost.ActivityCancelled"));
            return;
        }
        const child = spawn("git", [...args], {
            cwd: repositoryRoot,
            windowsHide: true,
            shell: false,
            stdio: ["ignore", "pipe", "ignore"],
        });
        const stdout: Buffer[] = [];
        let stdoutBytes = 0;
        let outputExceeded = false;
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
                outputExceeded = true;
                child.kill();
            } else {
                stdout.push(Buffer.from(chunk));
            }
        });
        child.on("error", () =>
            settle(() =>
                reject(new HeadlessGitActivityError("HeadlessActivityHost.GitUnavailable")),
            ),
        );
        child.on("close", (code) =>
            settle(() => {
                if (cancelled) {
                    reject(new HeadlessGitActivityError("HeadlessActivityHost.ActivityCancelled"));
                } else if (outputExceeded) {
                    reject(
                        new HeadlessGitActivityError("HeadlessActivityHost.GitChangeSetTooLarge"),
                    );
                } else if (code !== 0) {
                    reject(new HeadlessGitActivityError("HeadlessActivityHost.GitOperationFailed"));
                } else {
                    resolve(Buffer.concat(stdout, stdoutBytes).toString("utf8"));
                }
            }),
        );
    });
}

async function requireArtifactRoot(value: string): Promise<string> {
    const root = path.resolve(value);
    fs.mkdirSync(root, { recursive: true });
    const stat = fs.lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new HeadlessGitActivityError("HeadlessActivityHost.ArtifactRootInvalid");
    }
    return fs.promises.realpath(root);
}

async function realDirectory(value: string): Promise<string> {
    try {
        const resolved = await fs.promises.realpath(path.resolve(value));
        if (!(await fs.promises.stat(resolved)).isDirectory()) {
            throw new Error("not a directory");
        }
        return resolved;
    } catch {
        throw new HeadlessGitActivityError("HeadlessActivityHost.PathInvalid");
    }
}

function assertContained(root: string, candidate: string): void {
    const relative = path.relative(root, candidate);
    if (
        relative !== "" &&
        (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    ) {
        throw new HeadlessGitActivityError("HeadlessActivityHost.TargetOutsideWorkspace");
    }
}

function validateGitRef(value: string): string {
    const ref = value.trim();
    if (!ref || ref.length > 256 || ref.startsWith("-") || /[\u0000-\u001f\u007f]/u.test(ref)) {
        throw new HeadlessGitActivityError("HeadlessActivityHost.GitRefInvalid");
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
        throw new HeadlessGitActivityError("HeadlessActivityHost.GitChangeSetInvalid");
    }
    return relativePath;
}

function isEntityRelatedPath(relativePath: string): boolean {
    return (
        /(?:^|\/)(?:entities|models|migrations)(?:\/|$)/iu.test(relativePath) ||
        /(?:dbcontext|modelsnapshot)\.cs$/iu.test(relativePath) ||
        /\.csproj$/iu.test(relativePath)
    );
}
