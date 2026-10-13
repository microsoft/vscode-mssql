/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import * as constants from "../constants/constants";
import * as Loc from "../constants/locConstants";
import type * as mssql from "vscode-mssql";
import { sendErrorEvent } from "extension-toolkit/vscode";
import { TelemetryViews, TelemetryActions } from "../sharedInterfaces/telemetry";
import { getErrorMessage } from "../utils/utils";
import { ProjectPropertiesResult } from "../sharedInterfaces/publishDialog";

/**
 * Controller for SQL Project operations
 */
export class ProjectController {
    /**
     * Builds a SQL project and returns the path to the generated DACPAC
     * @param projectProperties Project properties from SQL Projects service (includes projectFilePath and dacpacOutputPath)
     * @returns Path to the generated DACPAC file
     */
    public async buildProject(
        projectProperties: ProjectPropertiesResult,
    ): Promise<string | undefined> {
        try {
            const projectFilePath = projectProperties.projectFilePath;
            const projectDir = path.dirname(projectFilePath);
            const projectName = path.basename(projectFilePath, path.extname(projectFilePath));

            // Construct build arguments based on project type
            const buildDirPath = this.getBuildDirPath();
            const buildArgs = this.constructBuildArguments(
                buildDirPath,
                projectProperties.projectStyle,
            );

            // Create task arguments
            const args: string[] = [constants.build, projectFilePath, ...buildArgs];

            // Create task definition
            const taskDefinition: vscode.TaskDefinition = {
                type: constants.sqlProjBuildTaskType,
                label: Loc.PublishProject.BuildProjectTaskLabel(projectName),
                command: constants.dotnet,
                args: args,
                problemMatcher: constants.msBuildProblemMatcher,
            };

            // Create the build task
            const buildTask = new vscode.Task(
                taskDefinition,
                vscode.TaskScope.Workspace,
                taskDefinition.label,
                taskDefinition.type,
                new vscode.ProcessExecution(taskDefinition.command, args, {
                    cwd: projectDir,
                }),
                taskDefinition.problemMatcher,
            );

            // Execute the task and wait for completion
            await this.executeTask(
                buildTask,
                Loc.PublishProject.BuildingProjectProgress(projectName),
                Loc.PublishProject.BuildFailedWithExitCode,
            );

            // Return the DACPAC output path
            return projectProperties.dacpacOutputPath;
        } catch (error) {
            // Send error telemetry
            sendErrorEvent(
                TelemetryViews.SqlProjects,
                TelemetryActions.BuildProject,
                error instanceof Error ? error : new Error(getErrorMessage(error)),
                false,
            );
            throw error;
        }
    }

    /**
     * Restores the NuGet packages referenced by a SQL project so that analyzer assemblies
     * referenced by the project are present on disk and match the referenced versions.
     * @param projectFilePath Path to the .sqlproj file
     */
    public async restoreProject(projectFilePath: string): Promise<void> {
        try {
            const projectDir = path.dirname(projectFilePath);
            const projectName = path.basename(projectFilePath, path.extname(projectFilePath));
            const args: string[] = [constants.restore, projectFilePath];

            const taskDefinition: vscode.TaskDefinition = {
                type: constants.sqlProjRestoreTaskType,
                label: Loc.CodeAnalysis.restoreProjectTaskLabel(projectName),
                command: constants.dotnet,
                args: args,
                problemMatcher: constants.msBuildProblemMatcher,
            };

            const restoreTask = new vscode.Task(
                taskDefinition,
                vscode.TaskScope.Workspace,
                taskDefinition.label,
                taskDefinition.type,
                new vscode.ProcessExecution(taskDefinition.command, args, {
                    cwd: projectDir,
                }),
                taskDefinition.problemMatcher,
            );

            await this.executeTask(
                restoreTask,
                Loc.CodeAnalysis.restoringProjectProgress(projectName),
                Loc.CodeAnalysis.restoreFailedWithExitCode,
            );
        } catch (error) {
            sendErrorEvent(
                TelemetryViews.SqlProjects,
                TelemetryActions.CodeAnalysisRestoreProjectError,
                error instanceof Error ? error : new Error(getErrorMessage(error)),
                false,
            );
            throw error;
        }
    }

    /**
     * Gets the path to the BuildDirectory folder from the SQL Database Projects extension
     */
    private getBuildDirPath(): string {
        // Use the SQL Database Projects extension's BuildDirectory which contains the required build DLLs and targets
        const extensionPath =
            vscode.extensions.getExtension(constants.sqlDatabaseProjectsExtensionId)
                ?.extensionPath ?? "";
        return path.join(extensionPath, "BuildDirectory");
    }

    /**
     * Constructs the build arguments for building a sqlproj file
     * @param buildDirPath Path to the SQL Tools Service directory containing build dependencies
     * @param projectStyle The project style (SDK-style or Legacy-style)
     * @returns An array of arguments to be used for building the sqlproj file
     */
    private constructBuildArguments(
        buildDirPath: string,
        projectStyle: mssql.ProjectType,
    ): string[] {
        const args: string[] = [
            "/p:NetCoreBuild=true",
            `/p:SystemDacpacsLocation="${buildDirPath}"`,
        ];

        // Adding NETCoreTargetsPath only for non-SDK style projects ProjectType.LegacyStyle = 1
        if (projectStyle === 1) {
            args.push(`/p:NETCoreTargetsPath="${buildDirPath}"`);
        }

        return args;
    }

    /**
     * Executes a task and waits for it to complete
     * @param task The VS Code task to execute
     * @param progressTitle Title shown in the progress notification
     * @param failureMessage Builds the error message from a non-zero exit code
     */
    private async executeTask(
        task: vscode.Task,
        progressTitle: string,
        failureMessage: (exitCode: number) => string,
    ): Promise<void> {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: progressTitle,
                cancellable: false,
            },
            async () => {
                // Execute the task
                const execution = await vscode.tasks.executeTask(task);

                // Wait for task completion
                return new Promise<void>((resolve, reject) => {
                    const disposable = vscode.tasks.onDidEndTaskProcess((e) => {
                        if (e.execution === execution) {
                            disposable.dispose();
                            if (e.exitCode === 0) {
                                resolve();
                            } else {
                                reject(new Error(failureMessage(e.exitCode ?? -1)));
                            }
                        }
                    });
                });
            },
        );
    }
}
