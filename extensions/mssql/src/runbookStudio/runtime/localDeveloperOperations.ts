/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * VS Code host operations for the local Runbook Studio developer lane.
 * These functions deliberately reuse the SQL Database Projects build task,
 * constrain every project/artifact to an open workspace, and verify the
 * resulting DACPAC before it becomes run evidence.
 */

import * as crypto from "crypto";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { DOMParser, type Document as XmlDocument } from "@xmldom/xmldom";
import * as constants from "../../constants/constants";
import { RunbookStudio as LocRunbookStudio } from "../../constants/locConstants";
import { ProjectController } from "../../controllers/projectController";
import SqlToolsServerClient from "../../languageservice/serviceclient";
import { readProjectProperties } from "../../publishProject/projectUtils";
import { SqlProjectsService } from "../../services/sqlProjectsService";
import {
    LocalActivityError,
    LocalDacpacBuildResult,
    LocalDeploymentPreviewResult,
    LocalEfProjectCandidate,
    LocalEfProjectDiscoveryResult,
    LocalGitChangeSetResult,
    LocalSqlTestDiscoveryResult,
    LocalWorkspaceSnapshot,
} from "./localSqlDelegate";
import { analyzeRepositorySqlTests, RepositorySqlTestSource } from "./repositorySqlTestDiscovery";
import { canonicalRunbookJson } from "../runbookDigest";

const MAX_DISCOVERED_PROJECTS = 100;
const MAX_EF_SOURCE_FILES = 2000;
const MAX_EF_PROJECT_BYTES = 512 * 1024;
const MAX_EF_SOURCE_FILE_BYTES = 256 * 1024;
const MAX_EF_SOURCE_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_EF_CONTEXTS_PER_PROJECT = 100;
const MAX_REPOSITORY_SQL_FILES = 2000;
const MAX_REPOSITORY_SQL_FILE_BYTES = 512 * 1024;
const MAX_REPOSITORY_SQL_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_DEPLOYMENT_REPORT_BYTES = 256 * 1024;
const CANCEL_POLL_MS = 50;
const MAX_GIT_PATCH_BYTES = 8 * 1024 * 1024;
const MAX_GIT_METADATA_BYTES = 512 * 1024;
const MAX_GIT_CHANGED_FILES = 2000;
const MAX_GIT_SNAPSHOT_FILES = 10_000;
const MAX_GIT_SNAPSHOT_BYTES = 128 * 1024 * 1024;
const MAX_GIT_TREE_METADATA_BYTES = 4 * 1024 * 1024;

/** DacFx receives the database name as a structured argument, but still keep
 * the authored override bounded and free of control characters before it is
 * copied onto a connection profile or used in an artifact filename. */
export function isValidDacpacSourceDatabaseName(value: string): boolean {
    const name = value.trim();
    return name.length > 0 && name.length <= 128 && !/[\u0000-\u001f\u007f]/.test(name);
}

export async function inspectLocalWorkspace(): Promise<LocalWorkspaceSnapshot> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
        throw new LocalActivityError(
            LocRunbookStudio.openWorkspaceForDatabaseProject,
            "RunbookStudio.WorkspaceUnavailable",
        );
    }
    const paths = new Set<string>();
    let truncated = false;
    for (const folder of folders) {
        const matches = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, "**/*.sqlproj"),
            "**/{.git,node_modules,bin,obj}/**",
            MAX_DISCOVERED_PROJECTS + 1,
        );
        if (matches.length > MAX_DISCOVERED_PROJECTS) {
            truncated = true;
        }
        for (const uri of matches.slice(0, MAX_DISCOVERED_PROJECTS)) {
            paths.add(path.normalize(uri.fsPath));
        }
    }
    return {
        workspaceFolderCount: folders.length,
        projectPaths: [...paths]
            .sort((left, right) => left.localeCompare(right))
            .slice(0, MAX_DISCOVERED_PROJECTS),
        truncated: truncated || paths.size > MAX_DISCOVERED_PROJECTS,
    };
}

/** Read-only EF candidate discovery. This inventories project metadata and
 * source declarations only; it does not restore/build a project or load its
 * design-time code. Those effects require a separate explicit trust gate. */
export async function discoverLocalEfProjects(
    isCancellationRequested: () => boolean,
): Promise<LocalEfProjectDiscoveryResult> {
    if (!vscode.workspace.isTrusted) {
        throw new LocalActivityError(
            LocRunbookStudio.efWorkspaceTrustRequired,
            "RunbookStudio.WorkspaceUntrusted",
        );
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
        throw new LocalActivityError(
            LocRunbookStudio.efWorkspaceRequired,
            "RunbookStudio.WorkspaceUnavailable",
        );
    }
    const projectUris = new Map<string, vscode.Uri>();
    let truncated = false;
    for (const folder of folders) {
        const matches = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, "**/*.csproj"),
            "**/{.git,.vs,.vscode,node_modules,bin,obj,TestResults}/**",
            MAX_DISCOVERED_PROJECTS + 1,
        );
        if (matches.length > MAX_DISCOVERED_PROJECTS) {
            truncated = true;
        }
        for (const uri of matches.slice(0, MAX_DISCOVERED_PROJECTS)) {
            projectUris.set(path.normalize(uri.fsPath).toLowerCase(), uri);
        }
    }

    const projects: LocalEfProjectCandidate[] = [];
    let remainingSourceFiles = MAX_EF_SOURCE_FILES;
    let remainingSourceBytes = MAX_EF_SOURCE_TOTAL_BYTES;
    for (const uri of [...projectUris.values()]
        .sort((left, right) => left.fsPath.localeCompare(right.fsPath))
        .slice(0, MAX_DISCOVERED_PROJECTS)) {
        if (isCancellationRequested()) {
            throw new LocalActivityError(
                LocRunbookStudio.efDiscoveryCancelled,
                "RunbookStudio.ActivityCancelled",
            );
        }
        await assertPathInWorkspace(uri.fsPath, folders, LocRunbookStudio.efProjectLabel);
        const projectStat = await fs.promises.stat(uri.fsPath);
        if (!projectStat.isFile() || projectStat.size > MAX_EF_PROJECT_BYTES) {
            truncated = true;
            continue;
        }
        const projectText = await fs.promises.readFile(uri.fsPath, "utf8");
        const projectXml = new DOMParser().parseFromString(projectText, "application/xml");
        const targetFrameworks = readProjectValues(projectXml, [
            "TargetFramework",
            "TargetFrameworks",
        ]).flatMap((value) =>
            value
                .split(";")
                .map((item) => item.trim())
                .filter(Boolean),
        );
        const providers = readEfProviderReferences(projectXml);
        const projectDirectory = path.dirname(uri.fsPath);
        const matchLimit = Math.min(remainingSourceFiles + 1, MAX_EF_SOURCE_FILES + 1);
        const sourceUris = await vscode.workspace.findFiles(
            new vscode.RelativePattern(projectDirectory, "**/*.cs"),
            "**/{.git,.vs,.vscode,node_modules,bin,obj,TestResults}/**",
            matchLimit,
        );
        let projectTruncated = sourceUris.length > remainingSourceFiles;
        const dbContexts: LocalEfProjectCandidate["dbContexts"] = [];
        let entitySourceFileCount = 0;
        let scannedSourceFileCount = 0;
        for (const sourceUri of sourceUris.slice(0, remainingSourceFiles)) {
            if (isCancellationRequested()) {
                throw new LocalActivityError(
                    LocRunbookStudio.efDiscoveryCancelled,
                    "RunbookStudio.ActivityCancelled",
                );
            }
            await assertPathInWorkspace(
                sourceUri.fsPath,
                folders,
                LocRunbookStudio.efSourceFileLabel,
            );
            const sourceStat = await fs.promises.stat(sourceUri.fsPath);
            if (
                !sourceStat.isFile() ||
                sourceStat.size > MAX_EF_SOURCE_FILE_BYTES ||
                sourceStat.size > remainingSourceBytes
            ) {
                projectTruncated = true;
                continue;
            }
            const source = await fs.promises.readFile(sourceUri.fsPath, "utf8");
            remainingSourceFiles--;
            remainingSourceBytes -= sourceStat.size;
            scannedSourceFileCount++;
            const relativePath = vscode.workspace.asRelativePath(sourceUri, false);
            const contextPattern =
                /\b(?:partial\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?:[A-Za-z_][A-Za-z0-9_.]*\.)?DbContext\b/g;
            let contextMatch: RegExpExecArray | null;
            while (
                dbContexts.length < MAX_EF_CONTEXTS_PER_PROJECT &&
                (contextMatch = contextPattern.exec(source)) !== null
            ) {
                dbContexts.push({ name: contextMatch[1], relativePath });
            }
            if (contextPattern.exec(source) !== null) {
                projectTruncated = true;
            }
            if (
                /\bDbSet\s*</.test(source) ||
                /\bIEntityTypeConfiguration\s*</.test(source) ||
                /\[\s*Table\s*(?:\(|\])/.test(source) ||
                /(?:^|[\\/])Entities(?:[\\/]|$)/i.test(relativePath)
            ) {
                entitySourceFileCount++;
            }
            if (remainingSourceFiles === 0 || remainingSourceBytes === 0) {
                projectTruncated = sourceUris.length > scannedSourceFileCount;
                break;
            }
        }
        projects.push({
            projectPath: path.normalize(uri.fsPath),
            relativeProjectPath: vscode.workspace.asRelativePath(uri, false),
            targetFrameworks: [...new Set(targetFrameworks)].sort((left, right) =>
                left.localeCompare(right),
            ),
            providers,
            dbContexts: dbContexts.sort((left, right) =>
                `${left.name}\u0000${left.relativePath}`.localeCompare(
                    `${right.name}\u0000${right.relativePath}`,
                ),
            ),
            entitySourceFileCount,
            scannedSourceFileCount,
            truncated: projectTruncated,
        });
        truncated ||= projectTruncated;
        if (remainingSourceFiles === 0 || remainingSourceBytes === 0) {
            truncated = true;
            break;
        }
    }
    return {
        workspaceFolderCount: folders.length,
        projects,
        projectCount: projects.length,
        dbContextCount: projects.reduce((sum, project) => sum + project.dbContexts.length, 0),
        providerCount: new Set(projects.flatMap((project) => project.providers)).size,
        entitySourceFileCount: projects.reduce(
            (sum, project) => sum + project.entitySourceFileCount,
            0,
        ),
        scannedSourceFileCount: projects.reduce(
            (sum, project) => sum + project.scannedSourceFileCount,
            0,
        ),
        truncated: truncated || projectUris.size > MAX_DISCOVERED_PROJECTS,
    };
}

function readProjectValues(document: XmlDocument, elementNames: readonly string[]): string[] {
    const values: string[] = [];
    for (const elementName of elementNames) {
        const nodes = document.getElementsByTagName(elementName);
        for (let index = 0; index < nodes.length; index++) {
            const value = nodes.item(index)?.textContent?.trim();
            if (value) {
                values.push(value);
            }
        }
    }
    return values;
}

function readEfProviderReferences(document: XmlDocument): string[] {
    const providers = new Set<string>();
    const nodes = document.getElementsByTagName("PackageReference");
    for (let index = 0; index < nodes.length; index++) {
        const node = nodes.item(index);
        const packageName = node?.getAttribute("Include") ?? node?.getAttribute("Update") ?? "";
        if (/entityframework/i.test(packageName)) {
            providers.add(packageName.trim());
        }
    }
    return [...providers].sort((left, right) => left.localeCompare(right));
}

/** Capture one immutable, content-addressed source change without checking
 * out, resetting, stashing, or otherwise changing the user's repository. */
export async function inspectLocalGitChangeSet(
    requestedRepository: string,
    baseRef: string,
    headRef: string,
    includeWorkingTree: boolean,
    artifactPath: string,
    isCancellationRequested: () => boolean,
): Promise<LocalGitChangeSetResult> {
    if (!vscode.workspace.isTrusted) {
        throw new LocalActivityError(
            LocRunbookStudio.gitWorkspaceTrustRequired,
            "RunbookStudio.WorkspaceUntrusted",
        );
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
        throw new LocalActivityError(
            LocRunbookStudio.gitRepositoryRequired,
            "RunbookStudio.WorkspaceUnavailable",
        );
    }
    const repository = path.resolve(requestedRepository.trim());
    await assertPathInWorkspace(repository, folders, LocRunbookStudio.gitRepositoryLabel);
    const normalizedBaseRef = validateGitRef(baseRef);
    const normalizedHeadRef = validateGitRef(headRef);
    const rootText = await runBoundedGit(
        repository,
        ["rev-parse", "--show-toplevel"],
        MAX_GIT_METADATA_BYTES,
        isCancellationRequested,
    );
    const repositoryRoot = path.normalize(rootText.trim());
    await assertPathInWorkspace(repositoryRoot, folders, LocRunbookStudio.gitRepositoryLabel);
    const baseCommit = await resolveGitCommit(
        repositoryRoot,
        normalizedBaseRef,
        isCancellationRequested,
    );
    const headCommit = await resolveGitCommit(
        repositoryRoot,
        normalizedHeadRef,
        isCancellationRequested,
    );
    const currentHead = await resolveGitCommit(repositoryRoot, "HEAD", isCancellationRequested);
    if (includeWorkingTree && currentHead !== headCommit) {
        throw new LocalActivityError(
            LocRunbookStudio.gitWorkingTreeHeadRequired,
            "RunbookStudio.BindingInvalid",
        );
    }
    const mergeBase = (
        await runBoundedGit(
            repositoryRoot,
            ["merge-base", baseCommit, headCommit],
            MAX_GIT_METADATA_BYTES,
            isCancellationRequested,
        )
    ).trim();
    const statusText = await runBoundedGit(
        repositoryRoot,
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        MAX_GIT_METADATA_BYTES,
        isCancellationRequested,
    );
    const dirtyFileCount = statusText.split("\0").filter(Boolean).length;
    const range = includeWorkingTree ? [baseCommit] : [baseCommit, headCommit];
    const commonDiffArguments = [
        "-c",
        "core.quotepath=false",
        "diff",
        "--find-renames",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        ...range,
        "--",
    ];
    const nameStatus = await runBoundedGit(
        repositoryRoot,
        [...commonDiffArguments.slice(0, 4), "--name-status", ...commonDiffArguments.slice(4)],
        MAX_GIT_METADATA_BYTES,
        isCancellationRequested,
    );
    const files = parseGitNameStatus(nameStatus);
    if (files.length > MAX_GIT_CHANGED_FILES) {
        throw new LocalActivityError(
            LocRunbookStudio.gitChangeSetTooLarge,
            "RunbookStudio.ResultTooLarge",
        );
    }
    const patch = await runBoundedGit(
        repositoryRoot,
        [
            ...commonDiffArguments.slice(0, 4),
            "--binary",
            "--full-index",
            ...commonDiffArguments.slice(4),
        ],
        MAX_GIT_PATCH_BYTES,
        isCancellationRequested,
    );
    const patchBytes = Buffer.from(
        patch ||
            `# No changes between ${normalizedBaseRef} (${baseCommit}) and ${normalizedHeadRef} (${headCommit}).\n`,
        "utf8",
    );
    try {
        await fs.promises.writeFile(artifactPath, patchBytes, { flag: "wx" });
        const artifactSha256 = crypto.createHash("sha256").update(patchBytes).digest("hex");
        return {
            repositoryRoot,
            baseRef: normalizedBaseRef,
            headRef: normalizedHeadRef,
            baseCommit,
            headCommit,
            mergeBase,
            includeWorkingTree,
            dirty: dirtyFileCount > 0,
            dirtyFileCount,
            files,
            entityRelatedFileCount: files.filter((file) => file.entityRelated).length,
            artifactPath,
            artifactSizeBytes: patchBytes.byteLength,
            artifactSha256,
        };
    } catch (error) {
        await fs.promises.rm(artifactPath, { force: true }).catch(() => undefined);
        throw error;
    }
}

export interface LocalGitRevisionSnapshotResult {
    repositoryRoot: string;
    requestedRef: string;
    commit: string;
    destinationRoot: string;
    fileCount: number;
    totalBytes: number;
    executableFileCount: number;
    snapshotSha256: string;
}

interface LocalGitTreeFile {
    mode: "100644" | "100755";
    size: number;
    relativePath: string;
}

/** Materialize one exact committed Git tree without checking out, stashing,
 * resetting, or changing the repository index. A private temporary index is
 * used so later EF design-time work can build base/head revisions in
 * isolation. Links, submodules, control-character paths, and oversized trees
 * are refused before any source file is written. */
export async function materializeLocalGitRevision(
    requestedRepository: string,
    requestedRef: string,
    destinationRoot: string,
    isCancellationRequested: () => boolean,
): Promise<LocalGitRevisionSnapshotResult> {
    if (!vscode.workspace.isTrusted) {
        throw new LocalActivityError(
            LocRunbookStudio.gitWorkspaceTrustRequired,
            "RunbookStudio.WorkspaceUntrusted",
        );
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
        throw new LocalActivityError(
            LocRunbookStudio.gitRepositoryRequired,
            "RunbookStudio.WorkspaceUnavailable",
        );
    }
    const repository = path.resolve(requestedRepository.trim());
    await assertPathInWorkspace(repository, folders, LocRunbookStudio.gitRepositoryLabel);
    const repositoryRoot = path.normalize(
        (
            await runBoundedGit(
                repository,
                ["rev-parse", "--show-toplevel"],
                MAX_GIT_METADATA_BYTES,
                isCancellationRequested,
            )
        ).trim(),
    );
    await assertPathInWorkspace(repositoryRoot, folders, LocRunbookStudio.gitRepositoryLabel);
    const normalizedRef = validateGitRef(requestedRef);
    const commit = await resolveGitCommit(repositoryRoot, normalizedRef, isCancellationRequested);
    const treeText = await runBoundedGit(
        repositoryRoot,
        ["ls-tree", "-r", "-l", "-z", commit],
        MAX_GIT_TREE_METADATA_BYTES,
        isCancellationRequested,
    );
    const files = parseGitRevisionTree(treeText);
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (files.length > MAX_GIT_SNAPSHOT_FILES || totalBytes > MAX_GIT_SNAPSHOT_BYTES) {
        throw new LocalActivityError(
            LocRunbookStudio.gitChangeSetTooLarge,
            "RunbookStudio.ResultTooLarge",
        );
    }
    const destination = path.resolve(destinationRoot);
    if (await localPathExists(destination)) {
        throw new LocalActivityError(
            LocRunbookStudio.runbookArtifactAlreadyExists(destination),
            "RunbookStudio.ArtifactExists",
        );
    }
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    const indexPath = path.join(
        path.dirname(destination),
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
            isCancellationRequested,
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
            isCancellationRequested,
            gitEnvironment,
        );
        const extracted = await inventoryMaterializedRevision(destination, isCancellationRequested);
        if (
            extracted.fileCount !== files.length ||
            extracted.totalBytes !== totalBytes ||
            extracted.relativePaths.some(
                (relativePath, index) => relativePath !== files[index].relativePath,
            )
        ) {
            throw new LocalActivityError(
                LocRunbookStudio.gitChangeSetInvalid,
                "RunbookStudio.ArtifactInvalid",
            );
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

export function parseGitRevisionTree(value: string): LocalGitTreeFile[] {
    const files: LocalGitTreeFile[] = [];
    for (const row of value.split("\0")) {
        if (!row) {
            continue;
        }
        const match = /^(\d{6}) (blob|commit) ([a-f0-9]{40,64})\s+(-|\d+)\t([\s\S]+)$/.exec(row);
        if (!match || (match[1] !== "100644" && match[1] !== "100755") || match[2] !== "blob") {
            throw new LocalActivityError(
                LocRunbookStudio.gitChangeSetInvalid,
                "RunbookStudio.ArtifactInvalid",
            );
        }
        const size = Number(match[4]);
        if (!Number.isSafeInteger(size) || size < 0) {
            throw new LocalActivityError(
                LocRunbookStudio.gitChangeSetInvalid,
                "RunbookStudio.ArtifactInvalid",
            );
        }
        files.push({
            mode: match[1],
            size,
            relativePath: validateGitRelativePath(match[5]),
        });
    }
    return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
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
            throw new LocalActivityError(
                LocRunbookStudio.gitChangeSetCancelled,
                "RunbookStudio.ActivityCancelled",
            );
        }
        const directory = pending.pop()!;
        for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
            const candidate = path.join(directory, entry.name);
            if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
                throw new LocalActivityError(
                    LocRunbookStudio.gitChangeSetInvalid,
                    "RunbookStudio.ArtifactInvalid",
                );
            }
            if (entry.isDirectory()) {
                pending.push(candidate);
                continue;
            }
            const stat = await fs.promises.stat(candidate);
            totalBytes += stat.size;
            relativePaths.push(validateGitRelativePath(path.relative(root, candidate)));
            if (
                relativePaths.length > MAX_GIT_SNAPSHOT_FILES ||
                totalBytes > MAX_GIT_SNAPSHOT_BYTES
            ) {
                throw new LocalActivityError(
                    LocRunbookStudio.gitChangeSetTooLarge,
                    "RunbookStudio.ResultTooLarge",
                );
            }
        }
    }
    relativePaths.sort((left, right) => left.localeCompare(right));
    return { fileCount: relativePaths.length, totalBytes, relativePaths };
}

export function parseGitNameStatus(value: string): LocalGitChangeSetResult["files"] {
    const files: LocalGitChangeSetResult["files"] = [];
    for (const line of value.split(/\r?\n/)) {
        if (!line) {
            continue;
        }
        const fields = line.split("\t");
        const status = fields[0];
        const renamed = /^[RC]\d{0,3}$/.test(status);
        const expectedFields = renamed ? 3 : 2;
        if (!/^(?:[ACDMRTUXB]|[RC]\d{0,3})$/.test(status) || fields.length !== expectedFields) {
            throw new LocalActivityError(
                LocRunbookStudio.gitChangeSetInvalid,
                "RunbookStudio.ArtifactInvalid",
            );
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
    return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function validateGitRef(value: string): string {
    const ref = value.trim();
    if (!ref || ref.length > 256 || ref.startsWith("-") || /[\u0000-\u001f\u007f]/.test(ref)) {
        throw new LocalActivityError(
            LocRunbookStudio.gitRefInvalid,
            "RunbookStudio.BindingInvalid",
        );
    }
    return ref;
}

function validateGitRelativePath(value: string): string {
    const relativePath = value.replace(/\\/g, "/");
    if (
        !relativePath ||
        relativePath === ".." ||
        relativePath.startsWith("../") ||
        path.posix.isAbsolute(relativePath) ||
        /^[A-Za-z]:\//.test(relativePath) ||
        /[\u0000-\u001f\u007f]/.test(relativePath)
    ) {
        throw new LocalActivityError(
            LocRunbookStudio.gitChangeSetInvalid,
            "RunbookStudio.ArtifactInvalid",
        );
    }
    return relativePath;
}

function isEntityRelatedPath(relativePath: string): boolean {
    return (
        /(?:^|\/)(?:entities|models|migrations)(?:\/|$)/i.test(relativePath) ||
        /(?:dbcontext|modelsnapshot)\.cs$/i.test(relativePath) ||
        /\.csproj$/i.test(relativePath)
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
    if (!/^[a-f0-9]{40,64}$/i.test(commit)) {
        throw new LocalActivityError(
            LocRunbookStudio.gitRefInvalid,
            "RunbookStudio.TargetNotFound",
        );
    }
    return commit.toLowerCase();
}

function runBoundedGit(
    repositoryRoot: string,
    args: readonly string[],
    maxOutputBytes: number,
    isCancellationRequested: () => boolean,
    environment?: Readonly<Record<string, string>>,
): Promise<string> {
    return new Promise((resolve, reject) => {
        if (isCancellationRequested()) {
            reject(
                new LocalActivityError(
                    LocRunbookStudio.gitChangeSetCancelled,
                    "RunbookStudio.ActivityCancelled",
                ),
            );
            return;
        }
        const child = spawn("git", [...args], {
            cwd: repositoryRoot,
            ...(environment ? { env: { ...process.env, ...environment } } : {}),
            windowsHide: true,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let outputExceeded = false;
        let cancelled = false;
        const cancellationPoll = setInterval(() => {
            if (isCancellationRequested()) {
                cancelled = true;
                child.kill();
            }
        }, CANCEL_POLL_MS);
        child.stdout.on("data", (chunk: Buffer) => {
            stdoutBytes += chunk.byteLength;
            if (stdoutBytes > maxOutputBytes) {
                outputExceeded = true;
                child.kill();
                return;
            }
            stdout.push(Buffer.from(chunk));
        });
        child.stderr.on("data", (chunk: Buffer) => {
            stderrBytes += chunk.byteLength;
            if (stderrBytes <= 32 * 1024) {
                stderr.push(Buffer.from(chunk));
            }
        });
        child.on("error", () => {
            clearInterval(cancellationPoll);
            reject(
                new LocalActivityError(
                    LocRunbookStudio.gitProviderUnavailable,
                    "RunbookStudio.ProviderUnavailable",
                ),
            );
        });
        child.on("close", (code) => {
            clearInterval(cancellationPoll);
            if (cancelled) {
                reject(
                    new LocalActivityError(
                        LocRunbookStudio.gitChangeSetCancelled,
                        "RunbookStudio.ActivityCancelled",
                    ),
                );
                return;
            }
            if (outputExceeded) {
                reject(
                    new LocalActivityError(
                        LocRunbookStudio.gitChangeSetTooLarge,
                        "RunbookStudio.ResultTooLarge",
                    ),
                );
                return;
            }
            if (code !== 0) {
                reject(
                    new LocalActivityError(
                        LocRunbookStudio.gitOperationFailed,
                        "RunbookStudio.ActivityFailed",
                    ),
                );
                return;
            }
            resolve(Buffer.concat(stdout, stdoutBytes).toString("utf8"));
        });
    });
}

export async function discoverLocalSqlTests(
    isCancellationRequested: () => boolean,
): Promise<LocalSqlTestDiscoveryResult> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
        throw new LocalActivityError(
            LocRunbookStudio.openWorkspaceForSqlTestDiscovery,
            "RunbookStudio.WorkspaceUnavailable",
        );
    }
    const candidatesByUri = new Map<string, { uri: vscode.Uri; relativePath: string }>();
    let unsafePathFileCount = 0;
    for (const folder of folders) {
        if (isCancellationRequested()) {
            throw sqlTestDiscoveryCancelled();
        }
        const matches = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, "**/*.sql"),
            "**/{.git,.vs,node_modules,bin,obj}/**",
            MAX_REPOSITORY_SQL_FILES + 1,
        );
        for (const uri of matches) {
            const relativePath = repositoryRelativePath(folder, uri);
            if (!relativePath) {
                unsafePathFileCount++;
                continue;
            }
            candidatesByUri.set(uri.toString(true), {
                uri,
                relativePath,
            });
        }
    }
    const candidates = [...candidatesByUri.values()].sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath),
    );
    const candidateTruncated = candidates.length > MAX_REPOSITORY_SQL_FILES;
    const selected = candidates.slice(0, MAX_REPOSITORY_SQL_FILES);
    const sources: RepositorySqlTestSource[] = [];
    let skippedOversizedFileCount = 0;
    let skippedByteBudgetFileCount = 0;
    let unreadableFileCount = 0;
    let scannedSourceBytes = 0;
    for (const candidate of selected) {
        if (isCancellationRequested()) {
            throw sqlTestDiscoveryCancelled();
        }
        try {
            const stat = await vscode.workspace.fs.stat(candidate.uri);
            if (
                (stat.type & vscode.FileType.File) === 0 ||
                stat.size > MAX_REPOSITORY_SQL_FILE_BYTES
            ) {
                skippedOversizedFileCount++;
                continue;
            }
            if (scannedSourceBytes + stat.size > MAX_REPOSITORY_SQL_TOTAL_BYTES) {
                skippedByteBudgetFileCount++;
                continue;
            }
            const bytes = await vscode.workspace.fs.readFile(candidate.uri);
            if (bytes.byteLength > MAX_REPOSITORY_SQL_FILE_BYTES) {
                skippedOversizedFileCount++;
                continue;
            }
            if (scannedSourceBytes + bytes.byteLength > MAX_REPOSITORY_SQL_TOTAL_BYTES) {
                skippedByteBudgetFileCount++;
                continue;
            }
            const text = Buffer.from(bytes).toString("utf8");
            if (text.includes("\0")) {
                unreadableFileCount++;
                continue;
            }
            sources.push({ relativePath: candidate.relativePath, text });
            scannedSourceBytes += bytes.byteLength;
        } catch {
            unreadableFileCount++;
        }
    }
    const analysis = analyzeRepositorySqlTests(sources);
    return {
        candidateSqlFileCount: candidates.length,
        scannedSqlFileCount: sources.length,
        skippedOversizedFileCount,
        skippedByteBudgetFileCount,
        unsafePathFileCount,
        unreadableFileCount,
        scannedSourceBytes,
        tSqltClassCount: analysis.tSqltClassCount,
        tSqltSourceFileCount: analysis.tSqltSourceFileCount,
        duplicateDefinitionCount: analysis.duplicateDefinitionCount,
        truncated: candidateTruncated || analysis.truncated || skippedByteBudgetFileCount > 0,
        tests: analysis.tests,
    };
}

function repositoryRelativePath(
    folder: vscode.WorkspaceFolder,
    candidate: vscode.Uri,
): string | undefined {
    if (folder.uri.scheme !== candidate.scheme || folder.uri.authority !== candidate.authority) {
        return undefined;
    }
    const relative = path.posix.relative(folder.uri.path, candidate.path).replace(/\\/g, "/");
    if (
        !relative ||
        relative === ".." ||
        relative.startsWith("../") ||
        path.posix.isAbsolute(relative)
    ) {
        return undefined;
    }
    return `workspace-${folder.index + 1}/${relative}`;
}

export async function buildLocalDacpac(
    requestedProjectPath: string,
    isCancellationRequested: () => boolean,
): Promise<LocalDacpacBuildResult> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
        throw new LocalActivityError(
            LocRunbookStudio.openWorkspaceForDatabaseProject,
            "RunbookStudio.WorkspaceUnavailable",
        );
    }
    const projectPath = await resolveWorkspaceProjectPath(requestedProjectPath, folders);
    if (isCancellationRequested()) {
        throw new LocalActivityError(
            LocRunbookStudio.dacpacBuildCancelled,
            "RunbookStudio.ActivityCancelled",
        );
    }

    const sqlProjectsExtension = vscode.extensions.getExtension(
        constants.sqlDatabaseProjectsExtensionId,
    );
    if (!sqlProjectsExtension) {
        throw new LocalActivityError(
            LocRunbookStudio.sqlProjectsRequired,
            "RunbookStudio.ProviderUnavailable",
        );
    }
    await sqlProjectsExtension.activate();

    const sqlProjectsService = new SqlProjectsService(SqlToolsServerClient.instance);
    const projectProperties = await readProjectProperties(sqlProjectsService, projectPath);
    if (!projectProperties) {
        throw new LocalActivityError(
            LocRunbookStudio.projectPropertiesUnavailable(projectPath),
            "RunbookStudio.ProjectInvalid",
        );
    }

    const cancellation = new vscode.CancellationTokenSource();
    const cancellationPoll = setInterval(() => {
        if (isCancellationRequested()) {
            cancellation.cancel();
        }
    }, CANCEL_POLL_MS);
    let artifactPath: string | undefined;
    try {
        artifactPath = await new ProjectController().buildProject(projectProperties, {
            cancellationToken: cancellation.token,
            showProgress: false,
        });
    } catch (error) {
        if (cancellation.token.isCancellationRequested || isCancellationRequested()) {
            throw new LocalActivityError(
                LocRunbookStudio.dacpacBuildCancelled,
                "RunbookStudio.ActivityCancelled",
            );
        }
        throw error;
    } finally {
        clearInterval(cancellationPoll);
        cancellation.dispose();
    }
    if (!artifactPath) {
        throw new LocalActivityError(
            LocRunbookStudio.dacpacArtifactNotReported(projectPath),
            "RunbookStudio.ArtifactMissing",
        );
    }

    const artifact = await verifyLocalDacpacArtifact(artifactPath, isCancellationRequested);
    const diagnosticCounts = countProjectDiagnostics(path.dirname(projectPath));
    return {
        projectPath,
        artifactPath: artifact.artifactPath,
        artifactSizeBytes: artifact.artifactSizeBytes,
        artifactSha256: artifact.artifactSha256,
        diagnosticCount: diagnosticCounts.warningCount + diagnosticCounts.errorCount,
        ...diagnosticCounts,
        builtAtUtc: new Date().toISOString(),
    };
}

export async function verifyLocalDacpacArtifact(
    requestedPath: string,
    isCancellationRequested: () => boolean,
    trustedRoots: readonly string[] = [],
): Promise<{
    artifactPath: string;
    artifactSizeBytes: number;
    artifactSha256: string;
}> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const artifactPath = path.normalize(requestedPath);
    if (path.extname(artifactPath).toLowerCase() !== ".dacpac") {
        throw new LocalActivityError(
            LocRunbookStudio.dacpacArtifactInvalid(artifactPath),
            "RunbookStudio.ArtifactInvalid",
        );
    }
    await assertPathInWorkspace(
        artifactPath,
        folders,
        LocRunbookStudio.dacpacArtifactLabel,
        trustedRoots,
    );
    let artifactStat: fs.Stats;
    try {
        artifactStat = await fs.promises.stat(artifactPath);
    } catch {
        throw new LocalActivityError(
            LocRunbookStudio.dacpacArtifactNotCreated(artifactPath),
            "RunbookStudio.ArtifactMissing",
        );
    }
    if (!artifactStat.isFile() || artifactStat.size === 0) {
        throw new LocalActivityError(
            LocRunbookStudio.dacpacArtifactInvalid(artifactPath),
            "RunbookStudio.ArtifactInvalid",
        );
    }
    return {
        artifactPath,
        artifactSizeBytes: artifactStat.size,
        artifactSha256: await sha256File(artifactPath, isCancellationRequested),
    };
}

export function buildLocalDeploymentPreviewResult(
    dacpacPath: string,
    targetDatabase: string,
    operationId: string,
    report: string,
): LocalDeploymentPreviewResult {
    if (!report.trim()) {
        throw new LocalActivityError(
            LocRunbookStudio.dacpacPreviewReportInvalid,
            "RunbookStudio.DeploymentReportInvalid",
        );
    }
    let parseFailed = false;
    let document: XmlDocument | undefined;
    try {
        document = new DOMParser({
            onError: (level) => {
                if (level !== "warning") {
                    parseFailed = true;
                }
            },
        }).parseFromString(report, "application/xml");
    } catch {
        parseFailed = true;
    }
    if (parseFailed || !document?.documentElement) {
        throw new LocalActivityError(
            LocRunbookStudio.dacpacPreviewReportInvalid,
            "RunbookStudio.DeploymentReportInvalid",
        );
    }

    const operationCounts = new Map<string, number>();
    let alertCount = 0;
    const elements = document.getElementsByTagName("*");
    for (let index = 0; index < elements.length; index++) {
        const element = elements.item(index);
        if (!element) {
            continue;
        }
        const localName = element.localName || element.nodeName.split(":").at(-1);
        if (localName === "Alert") {
            alertCount++;
        }
        if (localName !== "Operation") {
            continue;
        }
        const name = element.getAttribute("Name") || "Other";
        let itemCount = 0;
        const children = element.getElementsByTagName("*");
        for (let childIndex = 0; childIndex < children.length; childIndex++) {
            const child = children.item(childIndex);
            if ((child?.localName || child?.nodeName.split(":").at(-1)) === "Item") {
                itemCount++;
            }
        }
        operationCounts.set(name, (operationCounts.get(name) ?? 0) + itemCount);
    }
    const changeCount = [...operationCounts.values()].reduce((sum, count) => sum + count, 0);
    const operationSummary = [...operationCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, count]) => `${name}: ${count}`)
        .join("; ");
    const reportBytes = Buffer.from(report, "utf8");
    const reportTruncated = reportBytes.byteLength > MAX_DEPLOYMENT_REPORT_BYTES;
    const reportXml = reportTruncated
        ? `${reportBytes.subarray(0, MAX_DEPLOYMENT_REPORT_BYTES).toString("utf8")}\n<!-- report projection truncated -->`
        : report;
    return {
        dacpacPath,
        targetDatabase,
        operationId,
        changeCount,
        alertCount,
        operationSummary: operationSummary || LocRunbookStudio.dacpacPreviewNoSchemaChanges,
        reportSha256: crypto.createHash("sha256").update(report).digest("hex"),
        reportXml,
        reportTruncated,
        generatedAtUtc: new Date().toISOString(),
    };
}

async function resolveWorkspaceProjectPath(
    requestedPath: string,
    folders: readonly vscode.WorkspaceFolder[],
): Promise<string> {
    const trimmed = requestedPath.trim();
    if (path.extname(trimmed).toLowerCase() !== ".sqlproj") {
        throw new LocalActivityError(
            LocRunbookStudio.databaseProjectMustBeSqlproj(trimmed),
            "RunbookStudio.ProjectInvalid",
        );
    }
    const candidates = path.isAbsolute(trimmed)
        ? [path.normalize(trimmed)]
        : folders.map((folder) => path.resolve(folder.uri.fsPath, trimmed));
    const existing: string[] = [];
    for (const candidate of candidates) {
        try {
            const stat = await fs.promises.stat(candidate);
            if (stat.isFile()) {
                existing.push(candidate);
            }
        } catch {
            // Keep looking across multi-root workspaces.
        }
    }
    if (existing.length === 0) {
        throw new LocalActivityError(
            LocRunbookStudio.databaseProjectNotFound(trimmed),
            "RunbookStudio.ProjectNotFound",
        );
    }
    if (existing.length > 1) {
        throw new LocalActivityError(
            LocRunbookStudio.databaseProjectAmbiguous(trimmed),
            "RunbookStudio.TargetAmbiguous",
        );
    }
    await assertPathInWorkspace(existing[0], folders, LocRunbookStudio.databaseProjectLabel);
    return path.normalize(existing[0]);
}

async function assertPathInWorkspace(
    candidate: string,
    folders: readonly vscode.WorkspaceFolder[],
    label: string,
    trustedRoots: readonly string[] = [],
): Promise<void> {
    let realCandidate: string;
    try {
        realCandidate = await fs.promises.realpath(candidate);
    } catch {
        throw new LocalActivityError(
            LocRunbookStudio.runbookPathDoesNotExist(label, candidate),
            "RunbookStudio.PathInvalid",
        );
    }
    const roots = [...folders.map((folder) => folder.uri.fsPath), ...trustedRoots];
    for (const root of roots) {
        let realRoot: string;
        try {
            realRoot = await fs.promises.realpath(root);
        } catch {
            continue;
        }
        const relative = path.relative(realRoot, realCandidate);
        if (
            relative === "" ||
            (!relative.startsWith(`..${path.sep}`) &&
                relative !== ".." &&
                !path.isAbsolute(relative))
        ) {
            return;
        }
    }
    throw new LocalActivityError(
        LocRunbookStudio.runbookPathOutsideWorkspace(label, candidate),
        "RunbookStudio.TargetOutsideWorkspace",
    );
}

function countProjectDiagnostics(projectDirectory: string): {
    warningCount: number;
    errorCount: number;
} {
    let warningCount = 0;
    let errorCount = 0;
    for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
        const relative = path.relative(projectDirectory, uri.fsPath);
        if (
            relative === "" ||
            relative === ".." ||
            relative.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relative)
        ) {
            continue;
        }
        for (const diagnostic of diagnostics) {
            if (diagnostic.severity === vscode.DiagnosticSeverity.Error) {
                errorCount++;
            } else if (diagnostic.severity === vscode.DiagnosticSeverity.Warning) {
                warningCount++;
            }
        }
    }
    return { warningCount, errorCount };
}

function sha256File(filePath: string, isCancellationRequested: () => boolean): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath);
        stream.on("data", (chunk) => {
            if (isCancellationRequested()) {
                stream.destroy(
                    new LocalActivityError(
                        LocRunbookStudio.dacpacEvidenceCancelled,
                        "RunbookStudio.ActivityCancelled",
                    ),
                );
                return;
            }
            hash.update(chunk);
        });
        stream.on("error", reject);
        stream.on("end", () => resolve(hash.digest("hex")));
    });
}

async function localPathExists(candidate: string): Promise<boolean> {
    try {
        await fs.promises.access(candidate);
        return true;
    } catch {
        return false;
    }
}

function sqlTestDiscoveryCancelled(): LocalActivityError {
    return new LocalActivityError(
        LocRunbookStudio.sqlTestDiscoveryCancelled,
        "RunbookStudio.ActivityCancelled",
    );
}
