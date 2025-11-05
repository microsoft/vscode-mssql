/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import * as mssql from "vscode-mssql";
import * as constants from "../constants/constants";
import { sendErrorEvent } from "../telemetry/telemetry";
import { TelemetryViews, TelemetryActions } from "../sharedInterfaces/telemetry";

/**
 * Controller for SQL Project operations like building
 */
export class ProjectController {
    /**
     * Builds a SQL project and returns the path to the generated DACPAC
     * Based on the ADS SQL Projects extension implementation
     * @param projectProperties Project properties from SQL Projects service (includes projectFilePath and dacpacOutputPath)
     * @returns Path to the generated DACPAC file
     */
    public async buildProject(
        projectProperties: mssql.GetProjectPropertiesResult & {
            projectFilePath: string;
            dacpacOutputPath: string;
        },
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
                label: `Build ${projectName}`,
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
                new vscode.ShellExecution(taskDefinition.command, args, { cwd: projectDir }),
                taskDefinition.problemMatcher,
            );

            // Execute the task and wait for completion
            await this.executeBuildTask(buildTask, projectName);

            // Return the DACPAC output path (matches ADS pattern using project.dacpacOutputPath)
            return projectProperties.dacpacOutputPath;
        } catch (error) {
            // Send error telemetry (matches ADS pattern)
            sendErrorEvent(
                TelemetryViews.SqlProjects,
                TelemetryActions.BuildProject,
                error instanceof Error ? error : new Error(String(error)),
                false,
            );
            throw error;
        }
    }

    /**
     * Gets the build directory path
     * @returns The path to the directory containing build dependencies
     */
    private getBuildDirPath(): string {
        const extensionDir =
            vscode.extensions.getExtension(mssql.extension.name)?.extensionPath ?? "";
        return path.join(extensionDir, constants.buildDirectory);
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
        const args: string[] = ["/p:NetCoreBuild=true", `/p:SystemDacpacsLocation=${buildDirPath}`];

        // Adding NETCoreTargetsPath only for non-SDK style projects
        const isSdkStyle = projectStyle === mssql.ProjectType.SdkStyle;

        if (!isSdkStyle) {
            args.push(`/p:NETCoreTargetsPath=${buildDirPath}`);
        }

        return args;
    }

    /**
     * Executes a build task and waits for it to complete
     * @param buildTask The VS Code task to execute
     * @param projectName Name of the project being built
     */
    private async executeBuildTask(buildTask: vscode.Task, projectName: string): Promise<void> {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Building ${projectName}...`,
                cancellable: false,
            },
            async () => {
                // Execute the task
                const execution = await vscode.tasks.executeTask(buildTask);

                // Wait for task completion
                return new Promise<void>((resolve, reject) => {
                    const disposable = vscode.tasks.onDidEndTaskProcess((e) => {
                        if (e.execution === execution) {
                            disposable.dispose();
                            if (e.exitCode === 0) {
                                resolve();
                            } else {
                                const errorMsg = `Build failed with exit code ${e.exitCode}`;
                                reject(new Error(errorMsg));
                            }
                        }
                    });
                });
            },
        );
    }
}
