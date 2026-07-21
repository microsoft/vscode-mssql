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
    LocalSqlTestDiscoveryResult,
    LocalWorkspaceSnapshot,
} from "./localSqlDelegate";
import { analyzeRepositorySqlTests, RepositorySqlTestSource } from "./repositorySqlTestDiscovery";

const MAX_DISCOVERED_PROJECTS = 100;
const MAX_REPOSITORY_SQL_FILES = 2000;
const MAX_REPOSITORY_SQL_FILE_BYTES = 512 * 1024;
const MAX_REPOSITORY_SQL_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_DEPLOYMENT_REPORT_BYTES = 256 * 1024;
const CANCEL_POLL_MS = 50;

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

function sqlTestDiscoveryCancelled(): LocalActivityError {
    return new LocalActivityError(
        LocRunbookStudio.sqlTestDiscoveryCancelled,
        "RunbookStudio.ActivityCancelled",
    );
}
