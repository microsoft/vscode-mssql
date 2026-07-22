/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";
import type { ActivityExecutionDelegate, NodeExecution } from "../runtime/fakeRuntimeAdapter";
import type { RunbookPlanNode } from "../../sharedInterfaces/runbookStudio";
import { HeadlessGitActivityDelegate, HeadlessGitActivityError } from "./headlessGitActivity";
import { HeadlessEfActivityDelegate } from "./headlessEfActivity";
import { HeadlessEffectAuthority } from "./headlessEffectAuthority";
import { HeadlessSqlActivityDelegate } from "./headlessSqlActivity";
import { HeadlessDacpacActivityDelegate } from "./headlessDacpacActivity";
import { HeadlessPerformanceActivityDelegate } from "./headlessPerformanceActivity";
import { HeadlessReleaseActivityDelegate } from "./headlessReleaseActivity";

const MAX_PROJECTS = 100;
const MAX_VISITED_ENTRIES = 20_000;
const MAX_SOURCE_FILES = 2_000;
const MAX_PROJECT_BYTES = 512 * 1024;
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_TOTAL_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_CONTEXTS_PER_PROJECT = 100;
const EXCLUDED_DIRECTORIES = new Set([
    ".git",
    ".vs",
    ".vscode",
    "node_modules",
    "bin",
    "obj",
    "TestResults",
]);

interface HeadlessWorkspaceInventory {
    sqlProjects: string[];
    efProjects: HeadlessEfProject[];
    truncated: boolean;
}

interface HeadlessEfProject {
    relativeProjectPath: string;
    targetFrameworks: string[];
    providers: string[];
    dbContexts: string[];
    entitySourceFileCount: number;
    scannedSourceFileCount: number;
    truncated: boolean;
}

export class HeadlessWorkspaceActivityDelegate implements ActivityExecutionDelegate {
    public readonly runtimeKind = "local" as const;
    public readonly supportedActivityKinds = new Set([
        "workspace.inspect",
        "git.change-set.inspect",
        "ef.project.discover",
        "ef.relational-model.extract",
        "ef.relational-model.compare",
        "migration.data-loss.analyze",
        "migration.script.generate",
        "migration.apply",
        "migration.scope.validate",
        "sql.container.provision",
        "dacpac.extract",
        "dacpac.deploy.preview",
        "dacpac.deploy.container",
        "schema.compare",
        "schema.compare.export",
        "database.schema.visualize",
        "sql.workload.inspect",
        "database.schema.fingerprint",
        "performance.dmv.snapshot",
        "performance.dmv.delta",
        "xevent.session.start",
        "sql.workload.run",
        "xevent.session.stop",
        "xevent.capture.reconcile",
        "xevent.xel.analyze",
        "xevent.xel.collect",
        "workload.benchmark",
        "release.manifest.create",
        "sql.query.read",
        "sql.container.dispose",
    ]);
    private readonly gitDelegate: HeadlessGitActivityDelegate;
    private readonly efDelegate: HeadlessEfActivityDelegate;
    private readonly sqlDelegate: HeadlessSqlActivityDelegate | undefined;
    private readonly dacpacDelegate: HeadlessDacpacActivityDelegate | undefined;
    private readonly performanceDelegate: HeadlessPerformanceActivityDelegate | undefined;
    private readonly releaseDelegate: HeadlessReleaseActivityDelegate | undefined;

    constructor(
        private readonly trustedWorkspaceRoot: string,
        artifactRoot: string,
        extensionRoot: string,
        runbookId: string,
        effectAuthority: HeadlessEffectAuthority,
        enableSqlActivities: boolean,
    ) {
        this.gitDelegate = new HeadlessGitActivityDelegate(trustedWorkspaceRoot, artifactRoot);
        this.efDelegate = new HeadlessEfActivityDelegate(
            trustedWorkspaceRoot,
            artifactRoot,
            extensionRoot,
        );
        this.sqlDelegate = enableSqlActivities
            ? new HeadlessSqlActivityDelegate(artifactRoot, extensionRoot, effectAuthority)
            : undefined;
        this.dacpacDelegate = this.sqlDelegate
            ? new HeadlessDacpacActivityDelegate(
                  artifactRoot,
                  extensionRoot,
                  effectAuthority,
                  this.sqlDelegate,
                  this.efDelegate,
              )
            : undefined;
        this.performanceDelegate = this.sqlDelegate
            ? new HeadlessPerformanceActivityDelegate(
                  trustedWorkspaceRoot,
                  artifactRoot,
                  effectAuthority,
                  this.sqlDelegate,
              )
            : undefined;
        this.releaseDelegate =
            this.sqlDelegate && this.dacpacDelegate
                ? new HeadlessReleaseActivityDelegate(
                      runbookId,
                      artifactRoot,
                      extensionRoot,
                      this.sqlDelegate,
                      this.dacpacDelegate,
                  )
                : undefined;
    }

    public async executeActivity(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution | undefined> {
        if (node.activityKind === "git.change-set.inspect") {
            return this.gitDelegate.executeActivity(node, binding);
        }
        if (this.efDelegate.supportedActivityKinds.has(node.activityKind ?? "")) {
            return this.efDelegate.executeActivity(node, binding);
        }
        if (this.sqlDelegate?.supportedActivityKinds.has(node.activityKind ?? "")) {
            return this.sqlDelegate.executeActivity(node, binding);
        }
        if (this.dacpacDelegate?.supportedActivityKinds.has(node.activityKind ?? "")) {
            return this.dacpacDelegate.executeActivity(node, binding);
        }
        if (this.performanceDelegate?.supportedActivityKinds.has(node.activityKind ?? "")) {
            return this.performanceDelegate.executeActivity(node, binding);
        }
        if (this.releaseDelegate?.supportedActivityKinds.has(node.activityKind ?? "")) {
            return this.releaseDelegate.executeActivity(node, binding);
        }
        if (
            node.activityKind !== "workspace.inspect" &&
            node.activityKind !== "ef.project.discover"
        ) {
            return undefined;
        }
        try {
            const inventory = await inspectHeadlessWorkspace(
                this.trustedWorkspaceRoot,
                binding.isCancellationRequested,
            );
            return node.activityKind === "workspace.inspect"
                ? workspaceExecution(inventory)
                : efDiscoveryExecution(inventory);
        } catch (error) {
            return {
                success: false,
                errorCode:
                    error instanceof HeadlessGitActivityError
                        ? error.code
                        : "HeadlessActivityHost.WorkspaceInspectionFailed",
                message: "The bounded workspace inspection failed.",
            };
        }
    }

    public async dispose(): Promise<void> {
        await this.performanceDelegate?.dispose();
        await this.dacpacDelegate?.dispose();
        await this.sqlDelegate?.dispose();
    }
}

export async function inspectHeadlessWorkspace(
    workspaceRoot: string,
    isCancellationRequested: () => boolean,
): Promise<HeadlessWorkspaceInventory> {
    const root = await realDirectory(workspaceRoot);
    const discovered = walkWorkspace(root, isCancellationRequested);
    const discoveredSqlProjects = discovered.files.filter((file) =>
        file.toLowerCase().endsWith(".sqlproj"),
    );
    const sqlProjects = discoveredSqlProjects
        .slice(0, MAX_PROJECTS)
        .map((file) => relativePath(root, file));
    let truncated = discovered.truncated || discoveredSqlProjects.length > MAX_PROJECTS;
    const efProjects: HeadlessEfProject[] = [];
    let remainingFiles = MAX_SOURCE_FILES;
    let remainingBytes = MAX_TOTAL_SOURCE_BYTES;
    const discoveredCsProjects = discovered.files.filter((file) =>
        file.toLowerCase().endsWith(".csproj"),
    );
    for (const projectPath of discoveredCsProjects.slice(0, MAX_PROJECTS)) {
        if (isCancellationRequested()) {
            throw new HeadlessGitActivityError("HeadlessActivityHost.ActivityCancelled");
        }
        const stat = fs.lstatSync(projectPath);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PROJECT_BYTES) {
            truncated = true;
            continue;
        }
        const projectText = fs.readFileSync(projectPath, "utf8");
        const sourceFiles = discovered.files.filter(
            (file) =>
                file.toLowerCase().endsWith(".cs") &&
                owningProject(file, discoveredCsProjects) === projectPath,
        );
        const dbContexts: string[] = [];
        let entitySourceFileCount = 0;
        let scannedSourceFileCount = 0;
        let projectTruncated = false;
        for (const sourcePath of sourceFiles) {
            if (isCancellationRequested()) {
                throw new HeadlessGitActivityError("HeadlessActivityHost.ActivityCancelled");
            }
            if (remainingFiles === 0 || remainingBytes === 0) {
                projectTruncated = true;
                break;
            }
            const sourceStat = fs.lstatSync(sourcePath);
            if (
                !sourceStat.isFile() ||
                sourceStat.isSymbolicLink() ||
                sourceStat.size > MAX_SOURCE_BYTES ||
                sourceStat.size > remainingBytes
            ) {
                projectTruncated = true;
                continue;
            }
            const source = fs.readFileSync(sourcePath, "utf8");
            remainingFiles--;
            remainingBytes -= sourceStat.size;
            scannedSourceFileCount++;
            const contextPattern =
                /\b(?:partial\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\([^{};]*\))?\s*:\s*(?:[A-Za-z_][A-Za-z0-9_.]*\.)?DbContext\b/gu;
            let contextMatch: RegExpExecArray | null;
            while ((contextMatch = contextPattern.exec(source)) !== null) {
                if (dbContexts.length >= MAX_CONTEXTS_PER_PROJECT) {
                    projectTruncated = true;
                    break;
                }
                dbContexts.push(contextMatch[1]);
            }
            const relativeSourcePath = relativePath(root, sourcePath);
            if (
                /\bDbSet\s*</u.test(source) ||
                /\bIEntityTypeConfiguration\s*</u.test(source) ||
                /\[\s*Table\s*(?:\(|\])/u.test(source) ||
                /(?:^|\/)Entities(?:\/|$)/iu.test(relativeSourcePath)
            ) {
                entitySourceFileCount++;
            }
        }
        const targetFrameworks = elementValues(projectText, "TargetFramework")
            .concat(elementValues(projectText, "TargetFrameworks"))
            .flatMap((value) => value.split(";"))
            .map((value) => value.trim())
            .filter(Boolean);
        const providers = packageReferences(projectText).filter((name) =>
            /(?:EntityFrameworkCore\.(?:SqlServer|Sqlite|Cosmos|InMemory)|Npgsql\.EntityFrameworkCore|Pomelo\.EntityFrameworkCore)/iu.test(
                name,
            ),
        );
        const project: HeadlessEfProject = {
            relativeProjectPath: relativePath(root, projectPath),
            targetFrameworks: stableUnique(targetFrameworks),
            providers: stableUnique(providers),
            dbContexts: stableUnique(dbContexts),
            entitySourceFileCount,
            scannedSourceFileCount,
            truncated: projectTruncated,
        };
        if (
            project.providers.length > 0 ||
            project.dbContexts.length > 0 ||
            project.entitySourceFileCount > 0
        ) {
            efProjects.push(project);
            truncated ||= projectTruncated;
        }
    }
    if (discoveredCsProjects.length > MAX_PROJECTS) {
        truncated = true;
    }
    return {
        sqlProjects: stableSort(sqlProjects),
        efProjects: efProjects.sort((left, right) =>
            ordinal(left.relativeProjectPath, right.relativeProjectPath),
        ),
        truncated,
    };
}

function workspaceExecution(inventory: HeadlessWorkspaceInventory): NodeExecution {
    return {
        success: true,
        message: `Found ${inventory.sqlProjects.length} database project(s).`,
        runMetrics: {
            "workspace.folderCount": 1,
            "workspace.projectCount": inventory.sqlProjects.length,
            "workspace.truncated": inventory.truncated,
        },
        output: {
            contract: "workspaceSnapshot/1",
            columns: ["project"],
            rows: inventory.sqlProjects.map((project) => [project]),
            scalars: {
                workspaceFolderCount: 1,
                projectCount: inventory.sqlProjects.length,
                truncated: inventory.truncated,
                executionMode: "headless",
            },
        },
        values: { projectCount: inventory.sqlProjects.length },
    };
}

function efDiscoveryExecution(inventory: HeadlessWorkspaceInventory): NodeExecution {
    const dbContextCount = inventory.efProjects.reduce(
        (total, project) => total + project.dbContexts.length,
        0,
    );
    const providers = new Set(inventory.efProjects.flatMap((project) => project.providers));
    const entitySourceFileCount = inventory.efProjects.reduce(
        (total, project) => total + project.entitySourceFileCount,
        0,
    );
    const scannedSourceFileCount = inventory.efProjects.reduce(
        (total, project) => total + project.scannedSourceFileCount,
        0,
    );
    return {
        success: true,
        message: `Discovered ${inventory.efProjects.length} Entity Framework project(s) and ${dbContextCount} DbContext(s).`,
        runMetrics: {
            "ef.projectCount": inventory.efProjects.length,
            "ef.dbContextCount": dbContextCount,
            "ef.providerCount": providers.size,
            "ef.entitySourceFileCount": entitySourceFileCount,
            "ef.discoveryTruncated": inventory.truncated,
        },
        output: {
            contract: "efProjectDiscovery/1",
            columns: [
                "project",
                "targetFrameworks",
                "providers",
                "dbContexts",
                "entitySourceFiles",
                "truncated",
            ],
            rows: inventory.efProjects.map((project) => [
                project.relativeProjectPath,
                project.targetFrameworks.join(", "),
                project.providers.join(", "),
                project.dbContexts.join(", "),
                project.entitySourceFileCount,
                project.truncated,
            ]),
            scalars: {
                projectCount: inventory.efProjects.length,
                dbContextCount,
                providerCount: providers.size,
                entitySourceFileCount,
                scannedSourceFileCount,
                truncated: inventory.truncated,
                executionMode: "headless",
            },
        },
        values: {
            projectCount: inventory.efProjects.length,
            dbContextCount,
            providerCount: providers.size,
            entitySourceFileCount,
            truncated: inventory.truncated,
        },
    };
}

function walkWorkspace(
    root: string,
    isCancellationRequested: () => boolean,
): { files: string[]; truncated: boolean } {
    const pending = [root];
    const files: string[] = [];
    let entriesVisited = 0;
    let truncated = false;
    while (pending.length > 0) {
        if (isCancellationRequested()) {
            throw new HeadlessGitActivityError("HeadlessActivityHost.ActivityCancelled");
        }
        const directory = pending.pop()!;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            entriesVisited++;
            if (entriesVisited > MAX_VISITED_ENTRIES) {
                return { files: stableSort(files), truncated: true };
            }
            if (entry.isSymbolicLink()) {
                truncated = true;
                continue;
            }
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
                    pending.push(entryPath);
                }
            } else if (entry.isFile() && /\.(?:cs|csproj|sqlproj)$/iu.test(entry.name)) {
                files.push(entryPath);
            }
        }
    }
    return { files: stableSort(files), truncated };
}

function packageReferences(projectText: string): string[] {
    const result: string[] = [];
    const pattern = /<PackageReference\b[^>]*\b(?:Include|Update)\s*=\s*["']([^"']+)["'][^>]*>/giu;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(projectText)) !== null) {
        result.push(match[1]);
    }
    return result;
}

function owningProject(sourcePath: string, projectPaths: string[]): string | undefined {
    return projectPaths
        .filter((projectPath) => isContained(path.dirname(projectPath), sourcePath))
        .sort((left, right) => right.length - left.length || ordinal(left, right))[0];
}

function elementValues(projectText: string, elementName: string): string[] {
    const pattern = new RegExp(`<${elementName}\\b[^>]*>([^<]*)</${elementName}>`, "giu");
    const values: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(projectText)) !== null) {
        values.push(match[1]);
    }
    return values;
}

async function realDirectory(value: string): Promise<string> {
    try {
        const resolved = await fs.promises.realpath(path.resolve(value));
        const stat = await fs.promises.lstat(resolved);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
            throw new Error("not a regular directory");
        }
        return resolved;
    } catch {
        throw new HeadlessGitActivityError("HeadlessActivityHost.PathInvalid");
    }
}

function relativePath(root: string, candidate: string): string {
    if (!isContained(root, candidate)) {
        throw new HeadlessGitActivityError("HeadlessActivityHost.TargetOutsideWorkspace");
    }
    return path.relative(root, candidate).replaceAll("\\", "/");
}

function isContained(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return (
        relative === "" ||
        (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
}

function stableUnique(values: string[]): string[] {
    return stableSort([...new Set(values)]);
}

function stableSort(values: string[]): string[] {
    return values.sort(ordinal);
}

function ordinal(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
