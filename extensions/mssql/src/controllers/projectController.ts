/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import * as constants from "../constants/constants";
import * as Loc from "../constants/locConstants";
import type * as mssql from "vscode-mssql";
import { sendErrorEvent } from "../telemetry/telemetry";
import { TelemetryViews, TelemetryActions } from "../sharedInterfaces/telemetry";
import { getErrorMessage } from "../utils/utils";
import { ProjectPropertiesResult } from "../sharedInterfaces/publishDialog";

export interface ProjectBuildOptions {
    /** External cancellation owned by the calling workflow. */
    cancellationToken?: vscode.CancellationToken;
    /** Publish UI keeps its notification; background automation opts out. */
    showProgress?: boolean;
}

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
        options: ProjectBuildOptions = {},
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
            await this.executeBuildTask(buildTask, projectName, options);

            // Return the DACPAC output path
            return projectProperties.dacpacOutputPath;
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                throw error;
            }
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
     * Executes a build task and waits for it to complete
     * @param buildTask The VS Code task to execute
     * @param projectName Name of the project being built
     */
    private async executeBuildTask(
        buildTask: vscode.Task,
        projectName: string,
        options: ProjectBuildOptions,
    ): Promise<void> {
        const execute = async (): Promise<void> => {
            if (options.cancellationToken?.isCancellationRequested) {
                throw new vscode.CancellationError();
            }
            const execution = await vscode.tasks.executeTask(buildTask);
            return new Promise<void>((resolve, reject) => {
                let settled = false;
                let cancellationDisposable: vscode.Disposable | undefined;
                const finish = (error?: Error) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    processDisposable.dispose();
                    cancellationDisposable?.dispose();
                    error ? reject(error) : resolve();
                };
                const processDisposable = vscode.tasks.onDidEndTaskProcess((event) => {
                    if (event.execution !== execution) {
                        return;
                    }
                    if (event.exitCode === 0) {
                        finish();
                    } else {
                        finish(
                            new Error(
                                Loc.PublishProject.BuildFailedWithExitCode(event.exitCode ?? -1),
                            ),
                        );
                    }
                });
                cancellationDisposable = options.cancellationToken?.onCancellationRequested(() => {
                    try {
                        execution.terminate();
                    } finally {
                        finish(new vscode.CancellationError());
                    }
                });
            });
        };

        if (options.showProgress === false) {
            return execute();
        }
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: Loc.PublishProject.BuildingProjectProgress(projectName),
                cancellable: false,
            },
            execute,
        );
    }
}
