/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import { getErrorMessage } from "../utils/utils";

/**
 * Controller for SQL Project operations like building
 */
export class ProjectController {
    constructor(private _outputChannel: vscode.OutputChannel) {}

    /**
     * Builds a SQL project and returns the path to the generated DACPAC
     * Based on the ADS SQL Projects extension implementation
     * @param projectFilePath Path to the .sqlproj file
     * @returns Path to the generated DACPAC file, or undefined if build failed
     */
    public async buildProject(projectFilePath: string): Promise<string | undefined> {
        try {
            const projectDir = path.dirname(projectFilePath);
            const projectName = path.basename(projectFilePath, path.extname(projectFilePath));

            // Create a VS Code task for building like ADS does
            const buildArgs: string[] = [
                "/p:NetCoreBuild=true",
                // Add verbose flag for better diagnostics
                "/verbosity:normal",
            ];

            const args: string[] = ["build", projectFilePath, ...buildArgs];

            // Create task definition
            const taskDefinition: vscode.TaskDefinition = {
                type: "mssql-build",
                label: `Build ${projectName}`,
                command: "dotnet",
                args: args,
            };

            // Create the build task
            const buildTask = new vscode.Task(
                taskDefinition,
                vscode.TaskScope.Workspace,
                taskDefinition.label,
                taskDefinition.type,
                new vscode.ShellExecution("dotnet", args, { cwd: projectDir }),
                ["$msCompile"], // Use MS Build problem matcher
            );

            // Execute the task and wait for completion
            await this.executeBuildTask(buildTask, projectName);

            // Calculate the expected DACPAC path
            const dacpacPath = path.join(projectDir, "bin", "Debug", `${projectName}.dacpac`);

            // Check if DACPAC was created
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(dacpacPath));
                return dacpacPath;
            } catch {
                // Try alternative paths
                const alternativePaths = [
                    path.join(projectDir, "bin", "Release", `${projectName}.dacpac`),
                    path.join(projectDir, "bin", `${projectName}.dacpac`),
                    path.join(projectDir, `${projectName}.dacpac`),
                ];

                for (const altPath of alternativePaths) {
                    try {
                        await vscode.workspace.fs.stat(vscode.Uri.file(altPath));
                        return altPath;
                    } catch {
                        continue;
                    }
                }
            }

            return undefined;
        } catch (error) {
            this._outputChannel.appendLine(`Build project failed: ${getErrorMessage(error)}`);
            console.error("Build project failed:", error);
            void vscode.window.showErrorMessage(`Build failed: ${getErrorMessage(error)}`);
            return undefined;
        }
    }

    /**
     * Executes a build task and waits for it to complete
     * @param buildTask The VS Code task to execute
     * @param projectName Name of the project being built
     */
    private async executeBuildTask(buildTask: vscode.Task, projectName: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            void vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Building ${projectName}...`,
                    cancellable: false,
                },
                async () => {
                    try {
                        // Execute the task
                        const execution = await vscode.tasks.executeTask(buildTask);

                        // Wait for task completion
                        const disposable = vscode.tasks.onDidEndTaskProcess((e) => {
                            if (e.execution === execution) {
                                disposable.dispose();
                                if (e.exitCode === 0) {
                                    this._outputChannel.appendLine(
                                        `Build completed successfully for ${projectName}`,
                                    );
                                    resolve();
                                } else {
                                    const errorMsg = `Build failed with exit code ${e.exitCode}`;
                                    this._outputChannel.appendLine(errorMsg);
                                    reject(new Error(errorMsg));
                                }
                            }
                        });
                    } catch (error) {
                        this._outputChannel.appendLine(
                            `Build execution failed: ${getErrorMessage(error)}`,
                        );
                        reject(error);
                    }
                },
            );
        });
    }
}
