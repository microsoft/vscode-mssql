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
import * as constants from "../../constants/constants";
import { RunbookStudio as LocRunbookStudio } from "../../constants/locConstants";
import { ProjectController } from "../../controllers/projectController";
import SqlToolsServerClient from "../../languageservice/serviceclient";
import { readProjectProperties } from "../../publishProject/projectUtils";
import { SqlProjectsService } from "../../services/sqlProjectsService";
import {
    LocalActivityError,
    LocalDacpacBuildResult,
    LocalWorkspaceSnapshot,
} from "./localSqlDelegate";

const MAX_DISCOVERED_PROJECTS = 100;
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

    const normalizedArtifactPath = path.normalize(artifactPath);
    await assertPathInWorkspace(
        normalizedArtifactPath,
        folders,
        LocRunbookStudio.dacpacArtifactLabel,
    );
    let artifactStat: fs.Stats;
    try {
        artifactStat = await fs.promises.stat(normalizedArtifactPath);
    } catch {
        throw new LocalActivityError(
            LocRunbookStudio.dacpacArtifactNotCreated(normalizedArtifactPath),
            "RunbookStudio.ArtifactMissing",
        );
    }
    if (!artifactStat.isFile() || artifactStat.size === 0) {
        throw new LocalActivityError(
            LocRunbookStudio.dacpacArtifactInvalid(normalizedArtifactPath),
            "RunbookStudio.ArtifactInvalid",
        );
    }

    const artifactSha256 = await sha256File(normalizedArtifactPath, isCancellationRequested);
    const diagnosticCount = countProjectDiagnostics(path.dirname(projectPath));
    return {
        projectPath,
        artifactPath: normalizedArtifactPath,
        artifactSizeBytes: artifactStat.size,
        artifactSha256,
        diagnosticCount,
        builtAtUtc: new Date().toISOString(),
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
    for (const folder of folders) {
        let realRoot: string;
        try {
            realRoot = await fs.promises.realpath(folder.uri.fsPath);
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

function countProjectDiagnostics(projectDirectory: string): number {
    let count = 0;
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
        count += diagnostics.filter(
            (diagnostic) =>
                diagnostic.severity === vscode.DiagnosticSeverity.Error ||
                diagnostic.severity === vscode.DiagnosticSeverity.Warning,
        ).length;
    }
    return count;
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
