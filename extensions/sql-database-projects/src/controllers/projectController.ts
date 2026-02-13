/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as constants from "../common/constants";
import * as path from "path";
import * as utils from "../common/utils";
import * as UUID from "vscode-languageclient/lib/utils/uuid";
import * as templates from "../templates/templates";
import * as vscode from "vscode";
import * as dataworkspace from "dataworkspace";
import * as mssqlVscode from "vscode-mssql";

import { promises as fs } from "fs";
import { Project } from "../models/project";
import { SqlDatabaseProjectTreeViewProvider } from "./databaseProjectTreeViewProvider";
import { FolderNode, FileNode } from "../models/tree/fileFolderTreeItem";
import { BaseProjectTreeItem } from "../models/tree/baseTreeItem";
import { ImportDataModel } from "../models/api/import";
import { NetCoreTool, DotNetError } from "../tools/netcoreTool";
import { BuildHelper } from "../tools/buildHelper";
import {
    ISystemDatabaseReferenceSettings,
    IDacpacReferenceSettings,
    IProjectReferenceSettings,
    INugetPackageReferenceSettings,
} from "../models/IDatabaseReferenceSettings";
import {
    DatabaseReferenceTreeItem,
    SqlProjectReferenceTreeItem,
} from "../models/tree/databaseReferencesTreeItem";
import { TelemetryActions, TelemetryReporter, TelemetryViews } from "../common/telemetry";
import {
    AddItemOptions,
    EntryType,
    GenerateProjectFromOpenApiSpecOptions,
    IDatabaseReferenceProjectEntry,
    ISqlProject,
    ItemType,
    SqlTargetPlatform,
} from "sqldbproj";
import { AutorestHelper } from "../tools/autorestHelper";
import { createNewProjectFromDatabaseWithQuickpick } from "../dialogs/createProjectFromDatabaseQuickpick";
import { UpdateProjectFromDatabaseWithQuickpick } from "../dialogs/updateProjectFromDatabaseQuickpick";
import { addDatabaseReferenceQuickpick } from "../dialogs/addDatabaseReferenceQuickpick";
import { FileProjectEntry, SqlProjectReferenceProjectEntry } from "../models/projectEntry";
import { UpdateProjectAction, UpdateProjectDataModel } from "../models/api/updateProject";
import { SqlCmdVariableTreeItem } from "../models/tree/sqlcmdVariableTreeItem";
import { DeploymentScenario, TaskExecutionMode } from "../common/enums";

export type AddDatabaseReferenceSettings =
    | ISystemDatabaseReferenceSettings
    | IDacpacReferenceSettings
    | IProjectReferenceSettings
    | INugetPackageReferenceSettings;

interface FileWatcherStatus {
    fileWatcher: vscode.FileSystemWatcher;
}

/**
 * Controller for managing lifecycle of projects
 */
export class ProjectsController {
    private netCoreTool: NetCoreTool;
    private buildHelper: BuildHelper;
    private autorestHelper: AutorestHelper;

    private projFileWatchers = new Map<string, vscode.FileSystemWatcher>();
    private fileWatchers = new Map<string, FileWatcherStatus>();

    constructor(private _outputChannel: vscode.OutputChannel) {
        this.netCoreTool = new NetCoreTool(this._outputChannel);
        this.buildHelper = new BuildHelper();
        this.autorestHelper = new AutorestHelper(this._outputChannel);
    }

    //#region Create new project

    /**
     * Creates a new folder with the project name in the specified location, and places the new .sqlproj inside it
     * @param creationParams
     */
    public async createNewProject(creationParams: NewProjectParams): Promise<string> {
        TelemetryReporter.createActionEvent(
            TelemetryViews.ProjectController,
            TelemetryActions.createNewProject,
        )
            .withAdditionalProperties({
                template: creationParams.projectTypeId,
                sdkStyle: creationParams.sdkStyle!.toString(),
                targetPlatform: creationParams.targetPlatform?.toString() ?? "",
            })
            .send();

        if (creationParams.projectGuid && !UUID.isUUID(creationParams.projectGuid)) {
            throw new Error(constants.invalidGuid(creationParams.projectGuid));
        }

        if (
            creationParams.targetPlatform &&
            !constants.targetPlatformToVersion.get(creationParams.targetPlatform)
        ) {
            throw new Error(
                constants.invalidTargetPlatform(
                    creationParams.targetPlatform,
                    Array.from(constants.targetPlatformToVersion.keys()),
                ),
            );
        }

        let targetPlatform = creationParams.targetPlatform
            ? constants.targetPlatformToVersion.get(creationParams.targetPlatform)!
            : constants.defaultDSP;

        targetPlatform =
            constants.MicrosoftDatatoolsSchemaSqlSql +
            targetPlatform +
            constants.databaseSchemaProvider;

        let newProjFileName = creationParams.newProjName;

        if (!newProjFileName.toLowerCase().endsWith(constants.sqlprojExtension)) {
            newProjFileName += constants.sqlprojExtension;
        }

        const newProjFilePath = path.join(
            creationParams.folderUri.fsPath,
            path.parse(newProjFileName).name,
            newProjFileName,
        );

        if (await utils.exists(newProjFilePath)) {
            throw new Error(
                constants.projectAlreadyExists(newProjFileName, path.parse(newProjFilePath).dir),
            );
        }

        const sqlProjectsService = await utils.getSqlProjectsService();
        // default version of Microsoft.Build.Sql for SDK style projects, update in README when updating this, and buildHelper.cs for legacy projects SDK support
        const microsoftBuildSqlSDKStyleDefaultVersion = "2.1.0";
        const projectStyle = creationParams.sdkStyle
            ? mssqlVscode.ProjectType.SdkStyle
            : mssqlVscode.ProjectType.LegacyStyle;
        const result = await (sqlProjectsService as mssqlVscode.ISqlProjectsService).createProject(
            newProjFilePath,
            projectStyle,
            targetPlatform,
            microsoftBuildSqlSDKStyleDefaultVersion,
        );

        utils.throwIfFailed(result);

        await this.addTemplateFiles(
            newProjFilePath,
            creationParams.projectTypeId,
            creationParams.configureDefaultBuild ?? false,
        );

        return newProjFilePath;
    }

    /**
     * Adds the template files for the provided project type
     * @param newProjFilePath path to project to add template files to
     * @param projectTypeId project type id
     * @param configureDefaultBuild whether to configure the default build task in tasks.json
     *
     */
    private async addTemplateFiles(
        newProjFilePath: string,
        projectTypeId: string,
        configureDefaultBuild: boolean,
    ): Promise<void> {
        const project = await Project.openProject(newProjFilePath);
        if (projectTypeId === constants.emptySqlDatabaseProjectTypeId || newProjFilePath === "") {
            await this.addTasksJsonFile(project, configureDefaultBuild);
            return;
        }

        if (projectTypeId === constants.edgeSqlDatabaseProjectTypeId) {
            await this.addFileToProjectFromTemplate(
                project,
                templates.get(ItemType.table),
                "DataTable.sql",
                new Map([["OBJECT_NAME", "DataTable"]]),
            );
            await this.addFileToProjectFromTemplate(
                project,
                templates.get(ItemType.dataSource),
                "EdgeHubInputDataSource.sql",
                new Map([
                    ["OBJECT_NAME", "EdgeHubInputDataSource"],
                    ["LOCATION", "edgehub://"],
                ]),
            );
            await this.addFileToProjectFromTemplate(
                project,
                templates.get(ItemType.dataSource),
                "SqlOutputDataSource.sql",
                new Map([
                    ["OBJECT_NAME", "SqlOutputDataSource"],
                    ["LOCATION", "sqlserver://tcp:.,1433"],
                ]),
            );
            await this.addFileToProjectFromTemplate(
                project,
                templates.get(ItemType.fileFormat),
                "StreamFileFormat.sql",
                new Map([["OBJECT_NAME", "StreamFileFormat"]]),
            );
            await this.addFileToProjectFromTemplate(
                project,
                templates.get(ItemType.externalStream),
                "EdgeHubInputStream.sql",
                new Map([
                    ["OBJECT_NAME", "EdgeHubInputStream"],
                    ["DATA_SOURCE_NAME", "EdgeHubInputDataSource"],
                    ["LOCATION", "input"],
                    ["OPTIONS", ",\n\tFILE_FORMAT = StreamFileFormat"],
                ]),
            );
            await this.addFileToProjectFromTemplate(
                project,
                templates.get(ItemType.externalStream),
                "SqlOutputStream.sql",
                new Map([
                    ["OBJECT_NAME", "SqlOutputStream"],
                    ["DATA_SOURCE_NAME", "SqlOutputDataSource"],
                    ["LOCATION", "TSQLStreaming.dbo.DataTable"],
                    ["OPTIONS", ""],
                ]),
            );
            await this.addFileToProjectFromTemplate(
                project,
                templates.get(ItemType.externalStreamingJob),
                "EdgeStreamingJob.sql",
                new Map([["OBJECT_NAME", "EdgeStreamingJob"]]),
            );
        }

        await this.addTasksJsonFile(project, configureDefaultBuild);
    }

    /**
     * Adds or updates a tasks.json file at the workspace level (not inside the project folder).
     * If the workspace already has a tasks.json, the SQL project build task is merged into it.
     * If no workspace folder is found, falls back to creating tasks.json inside the project folder.
     * @param project project to add the tasks.json file for
     * @param configureDefaultBuild whether to configure the default build task in tasks.json
     */
    private async addTasksJsonFile(
        project: ISqlProject,
        configureDefaultBuild: boolean,
    ): Promise<void> {
        // Find the workspace folder that contains the project
        const projectUri = vscode.Uri.file(project.projectFilePath);
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(projectUri);

        // Determine the target folder: workspace root if available, otherwise project folder
        const targetFolder = workspaceFolder
            ? workspaceFolder.uri.fsPath
            : project.projectFolderPath;
        const vscodeFolder = path.join(targetFolder, constants.vscodeFolderName);
        const tasksJsonPath = path.join(vscodeFolder, constants.tasksJsonFileName);

        const projectName = path.basename(project.projectFilePath, constants.sqlprojExtension);

        // Check if tasks.json already exists at workspace level
        if (await utils.exists(tasksJsonPath)) {
            // Read and parse existing tasks.json
            try {
                const existingContent = await fs.readFile(tasksJsonPath, "utf8");
                const existingTasksJson = JSON.parse(existingContent);

                if (
                    existingTasksJson.tasks !== undefined &&
                    !Array.isArray(existingTasksJson.tasks)
                ) {
                    // This error is caught below — project creation still succeeds, only the tasks.json update is skipped
                    throw new Error(constants.tasksJsonInvalidTasksArrayError);
                }

                // Initialize tasks array if it doesn't exist yet
                if (!existingTasksJson.tasks) {
                    existingTasksJson.tasks = [];
                }

                // Check if a build task for this specific project already exists
                const taskLabel = constants.getSqlProjectBuildTaskLabel(projectName);
                const sqlBuildTaskExists = existingTasksJson.tasks.some(
                    (task: { label?: string }) => task.label === taskLabel,
                );

                if (!sqlBuildTaskExists) {
                    // Only create the task when we need to add it
                    const newTask = this.createBuildTaskForProject(
                        project,
                        projectName,
                        configureDefaultBuild,
                    );

                    // Merge the new task into existing tasks
                    existingTasksJson.tasks.push(newTask);

                    // Write back the merged tasks.json
                    await fs.writeFile(
                        tasksJsonPath,
                        JSON.stringify(existingTasksJson, null, "\t"),
                        "utf8",
                    );

                    // Show notification to user
                    void vscode.window.showInformationMessage(constants.updatingExistingTasksJson);
                }
            } catch (error) {
                // If parsing fails, log error and notify user with option to view output
                const errorMessage = utils.getErrorMessage(error);
                this._outputChannel.appendLine(constants.tasksJsonUpdateError(errorMessage));

                TelemetryReporter.createErrorEvent2(
                    TelemetryViews.ProjectController,
                    TelemetryActions.tasksJsonError,
                    error,
                )
                    .withAdditionalProperties({
                        hasWorkspaceFolder: (workspaceFolder !== undefined).toString(),
                        errorMessage: errorMessage,
                    })
                    .send();

                void utils.showErrorMessageWithOutputChannel(
                    constants.tasksJsonUpdateError,
                    errorMessage,
                    this._outputChannel,
                );
            }
        } else {
            // Create new tasks.json - only create the task when needed
            const newTask = this.createBuildTaskForProject(
                project,
                projectName,
                configureDefaultBuild,
            );
            const newTasksJson = utils.createTasksJson([newTask]);

            await fs.mkdir(vscodeFolder, { recursive: true });
            await fs.writeFile(tasksJsonPath, JSON.stringify(newTasksJson, null, "\t"), "utf8");

            // If created inside the project folder (no workspace), add to project's None items
            if (!workspaceFolder) {
                await project.addNoneItem(
                    utils.convertSlashesForSqlProj(
                        `${constants.vscodeFolderName}/${constants.tasksJsonFileName}`,
                    ),
                );
            }
        }
    }

    /**
     * Creates a build task object for the given project
     */
    private createBuildTaskForProject(
        project: ISqlProject,
        projectName: string,
        configureDefaultBuild: boolean,
    ): object {
        // Use forward slashes for cross-platform compatibility (dotnet accepts both)
        const projectFilePathNormalized = utils.getPlatformSafeFileEntryPath(
            project.projectFilePath,
        );

        // Build args array for process execution (avoids shell escaping issues)
        const buildArgs: string[] = [constants.build, projectFilePathNormalized];
        if (project.sqlProjStyleName !== constants.sdkStyleProjectStyleName) {
            // Legacy projects need additional build arguments
            // No quotes needed - process execution handles paths with spaces correctly
            const buildDirPath = utils.getPlatformSafeFileEntryPath(
                this.buildHelper.extensionBuildDirPath,
            );
            buildArgs.push(
                constants.netCoreBuildArg,
                `${constants.netCoreTargetsPathArgPrefix}${buildDirPath}`,
                `${constants.systemDacpacsLocationArgPrefix}${buildDirPath}`,
            );
        }

        return utils.createSqlProjectBuildTask({
            projectName,
            buildArgs,
            isDefault: configureDefaultBuild,
        });
    }

    private async addFileToProjectFromTemplate(
        project: ISqlProject,
        itemType: templates.ProjectScriptType,
        relativePath: string,
        expansionMacros: Map<string, string>,
    ): Promise<string> {
        const newFileText = templates.macroExpansion(itemType.templateScript, expansionMacros);
        const absolutePath = path.join(project.projectFolderPath, relativePath);
        await utils.ensureFileExists(absolutePath, newFileText);

        switch (itemType.type) {
            case ItemType.preDeployScript:
                await project.addPreDeploymentScript(relativePath);
                break;
            case ItemType.postDeployScript:
                await project.addPostDeploymentScript(relativePath);
                break;
            case ItemType.publishProfile:
                await project.addNoneItem(relativePath);
                break;
            default: // a normal SQL object script
                await project.addSqlObjectScript(relativePath);
                break;
        }

        return absolutePath;
    }

    //#endregion

    /**
     * Builds a project, producing a dacpac
     * @param treeNode a treeItem in a project's hierarchy, to be used to obtain a Project
     * @param codeAnalysis whether to run code analysis
     * @returns path of the built dacpac
     */
    public async buildProject(
        treeNode: dataworkspace.WorkspaceTreeItem,
        codeAnalysis?: boolean,
    ): Promise<string>;
    /**
     * Builds a project, producing a dacpac
     * @param project Project to be built
     * @param codeAnalysis whether to run code analysis
     * @returns path of the built dacpac
     */
    public async buildProject(project: Project, codeAnalysis?: boolean): Promise<string>;
    public async buildProject(
        context: Project | dataworkspace.WorkspaceTreeItem,
        codeAnalysis: boolean = false,
    ): Promise<string> {
        const project: Project = await this.getProjectFromContext(context);

        const startTime = new Date();

        // get dlls and targets file needed for building for legacy style projects
        if (project.sqlProjStyle === mssqlVscode.ProjectType.LegacyStyle) {
            const result = await this.buildHelper.createBuildDirFolder(this._outputChannel);

            if (!result) {
                void vscode.window.showErrorMessage(constants.errorRetrievingBuildFiles);
                return "";
            }
        }

        // Get the build arguments from buildhelper method and create a new vscode.task
        const buildArgs: string[] = this.buildHelper.constructBuildArguments(
            this.buildHelper.extensionBuildDirPath,
            project.sqlProjStyle,
        );
        const vscodeTask: vscode.Task = await this.createVsCodeTask(
            project,
            codeAnalysis,
            buildArgs,
        );

        try {
            const crossPlatCompatible: boolean = await Project.checkPromptCrossPlatStatus(
                project,
                true /* blocking prompt */,
            );

            if (!crossPlatCompatible) {
                // user rejected updating for cross-plat
                void vscode.window.showErrorMessage(
                    constants.projectNeedsUpdatingForCrossPlat(project.projectFileName),
                );
                return "";
            }
        } catch (error) {
            void vscode.window.showErrorMessage(utils.getErrorMessage(error));
            return "";
        }

        try {
            // Check if the dotnet core is installed and if not, prompt the user to install it
            // If the user does not have .NET Core installed, we will throw an error and stops building the project
            await this.netCoreTool.verifyNetCoreInstallation();

            // Execute the task and wait for it to complete
            const execution = await vscode.tasks.executeTask(vscodeTask);

            // Wait until the build task instance is finishes.
            // `onDidEndTaskProcess` fires for every task in the workspace, so Filtering events to the exact TaskExecution
            // object we kicked off (`e.execution === execution`), ensuring we don't resolve because some other task ended.
            await new Promise<void>((resolve) => {
                const disposable = vscode.tasks.onDidEndTaskProcess((e) => {
                    if (e.execution === execution) {
                        // Once we get the matching event, dispose the listener to avoid leaks and resolve the promise.
                        disposable.dispose();
                        resolve();
                    }
                });
            });

            // If the build was successful, we will get the path to the built dacpac
            const timeToBuild = new Date().getTime() - startTime.getTime();

            TelemetryReporter.createActionEvent(
                TelemetryViews.ProjectController,
                TelemetryActions.build,
            )
                .withAdditionalMeasurements({ duration: timeToBuild })
                .withAdditionalProperties({
                    databaseSource: project.getDatabaseSourceValues().join(";"),
                })
                .send();

            return project.dacpacOutputPath;
        } catch (err) {
            const timeToFailureBuild = new Date().getTime() - startTime.getTime();

            TelemetryReporter.createErrorEvent2(
                TelemetryViews.ProjectController,
                TelemetryActions.build,
                err,
            )
                .withAdditionalMeasurements({ duration: timeToFailureBuild })
                .withAdditionalProperties({
                    databaseSource: project.getDatabaseSourceValues().join(";"),
                })
                .send();

            const message = utils.getErrorMessage(err);
            if (err instanceof DotNetError) {
                // DotNetErrors already get shown by the netCoreTool so just show this one in the console
                console.error(message);
            } else {
                void vscode.window.showErrorMessage(constants.projBuildFailed(message));
            }
            return "";
        }
    }

    /**
     * Creates a VS Code task for building the project
     * @param project Project to be built
     * @param codeAnalysis Whether to run code analysis
     * @param buildArguments Arguments to pass to the build command
     * @returns A VS Code task for building the project
     * */
    private async createVsCodeTask(
        project: Project,
        codeAnalysis: boolean,
        buildArguments: string[],
    ): Promise<vscode.Task> {
        let vscodeTask: vscode.Task | undefined = undefined;
        const label = codeAnalysis
            ? constants.buildWithCodeAnalysisTaskName
            : constants.buildTaskName;

        // Create an array of arguments instead of a single command string
        const args: string[] = [constants.build, utils.getNonQuotedPath(project.projectFilePath)];

        if (codeAnalysis) {
            args.push(constants.runCodeAnalysisParam);
        }

        // Adding build arguments to the args
        args.push(...buildArguments);

        // Task definition with required args
        const taskDefinition: vscode.TaskDefinition = {
            type: constants.sqlProjTaskType,
            label: label,
            command: constants.dotnet,
            args: args,
            problemMatcher: constants.problemMatcher,
        };

        // Create a new task with the definition and process executable
        vscodeTask = new vscode.Task(
            taskDefinition,
            vscode.TaskScope.Workspace,
            taskDefinition.label,
            taskDefinition.type,
            new vscode.ProcessExecution(taskDefinition.command, args, {
                cwd: project.projectFolderPath,
            }),
            taskDefinition.problemMatcher,
        );

        return vscodeTask;
    }

    //#region Publish

    /**
     * Builds and publishes a project
     * @param treeNode a treeItem in a project's hierarchy, to be used to obtain a Project
     */
    public async publishProject(treeNode: dataworkspace.WorkspaceTreeItem): Promise<void>;
    /**
     * Builds and publishes a project
     * @param project Project to be built and published
     */
    public async publishProject(project: Project): Promise<void>;
    public async publishProject(context: Project | dataworkspace.WorkspaceTreeItem): Promise<void> {
        const project: Project = await this.getProjectFromContext(context);
        // Use the new publish dialog flow
        return await vscode.commands.executeCommand(
            constants.mssqlPublishProjectCommand,
            project.projectFilePath,
        );
    }

    //#endregion

    /**
     * Launches the schema compare extension with the source and target
     * @param source source for schema compare - a project node
     * @param targetParam target for schema compare
     */
    public async schemaCompare(
        source: dataworkspace.WorkspaceTreeItem,
        targetParam: any = undefined,
    ): Promise<void> {
        try {
            // check if schema compare service is available
            const service = await utils.getSchemaCompareService();
            if (service) {
                const sourceParam = (await this.getProjectFromContext(source)).projectFilePath;
                try {
                    TelemetryReporter.sendActionEvent(
                        TelemetryViews.ProjectController,
                        TelemetryActions.projectSchemaCompareCommandInvoked,
                    );
                    await vscode.commands.executeCommand(
                        constants.mssqlSchemaCompareCommand,
                        sourceParam,
                        undefined,
                        undefined,
                    );
                } catch (e) {
                    throw new Error(constants.buildFailedCannotStartSchemaCompare);
                }
            } else {
                throw new Error(constants.schemaCompareNotInstalled);
            }
        } catch (err) {
            const props: Record<string, string> = {};
            const message = utils.getErrorMessage(err);

            if (
                message === constants.buildFailedCannotStartSchemaCompare ||
                message === constants.schemaCompareNotInstalled
            ) {
                props.errorMessage = message;
            }

            TelemetryReporter.createErrorEvent2(
                TelemetryViews.ProjectController,
                TelemetryActions.projectSchemaCompareCommandInvoked,
                err,
            )
                .withAdditionalProperties(props)
                .send();

            void vscode.window.showErrorMessage(utils.getErrorMessage(err));
        }
    }

    //#region Add/Exclude/Delete Item

    public async addFolderPrompt(treeNode: dataworkspace.WorkspaceTreeItem): Promise<void> {
        const project = await this.getProjectFromContext(treeNode);
        const projectRelativeUri = vscode.Uri.file(
            path.basename(
                (treeNode.element as BaseProjectTreeItem).projectFileUri.fsPath,
                constants.sqlprojExtension,
            ),
        );
        const relativePathToParent = this.getRelativePath(projectRelativeUri, treeNode.element);
        const absolutePathToParent = path.join(project.projectFolderPath, relativePathToParent);
        const newFolderName = await this.promptForNewObjectName(
            new templates.ProjectScriptType(ItemType.folder, constants.folderFriendlyName, ""),
            project,
            absolutePathToParent,
        );

        if (!newFolderName) {
            return; // user cancelled
        }

        const relativeFolderPath = path.join(relativePathToParent, newFolderName);

        try {
            // check if folder already exists or is a reserved folder
            const absoluteFolderPath = path.join(absolutePathToParent, newFolderName);
            const folderExists = await utils.exists(absoluteFolderPath);

            if (
                folderExists ||
                this.isReservedFolder(absoluteFolderPath, project.projectFolderPath)
            ) {
                throw new Error(constants.folderAlreadyExists(path.parse(absoluteFolderPath).name));
            }

            await project.addFolder(relativeFolderPath);
            this.refreshProjectsTree(treeNode);
        } catch (err) {
            void vscode.window.showErrorMessage(utils.getErrorMessage(err));
        }
    }

    private async promptForNewObjectName(
        itemType: templates.ProjectScriptType,
        _project: ISqlProject,
        folderPath: string,
        fileExtension?: string,
        defaultName?: string,
    ): Promise<string | undefined> {
        const suggestedName = utils.sanitizeStringForFilename(
            defaultName ?? itemType.friendlyName.replace(/\s+/g, ""),
        );
        let counter = 0;

        do {
            counter++;
        } while (
            counter < Number.MAX_SAFE_INTEGER &&
            (await utils.exists(
                path.join(folderPath, `${suggestedName}${counter}${fileExtension ?? ""}`),
            ))
        );

        const itemObjectName = await vscode.window.showInputBox({
            prompt: constants.newObjectNamePrompt(itemType.friendlyName),
            value: `${suggestedName}${counter}`,
            validateInput: (value) => {
                return utils.isValidBasenameErrorMessage(value);
            },
            ignoreFocusOut: true,
        });

        return itemObjectName;
    }

    public isReservedFolder(absoluteFolderPath: string, projectFolderPath: string): boolean {
        const sameName =
            constants.reservedProjectFolders.find(
                (f) => f === path.parse(absoluteFolderPath).name,
            ) !== undefined;
        const sameLocation = path.parse(absoluteFolderPath).dir === projectFolderPath;
        return sameName && sameLocation;
    }

    /**
     * Parses a schema-qualified object name (e.g., "sales.MyFunction") into schema and object name parts.
     * If no schema is specified, returns 'dbo' as the default schema.
     * @param input The user-provided object name, optionally schema-qualified
     * @returns An object containing the schema name and object name
     */
    public parseSchemaAndObjectName(input: string): { schemaName: string; objectName: string } {
        const dotIndex = input.indexOf(".");
        if (dotIndex > 0 && dotIndex < input.length - 1) {
            // Format: schema.objectName
            return {
                schemaName: input.substring(0, dotIndex),
                objectName: input.substring(dotIndex + 1),
            };
        }
        // No schema specified, use default schema
        return {
            schemaName: constants.defaultSchemaName,
            objectName: input,
        };
    }

    /**
     * Gets the default folder path for a given item type when creating at project root.
     * For schema-dependent items: Checks Schema/ObjectType/ (e.g., Sales/Functions/)
     * For non-schema items (like Database Trigger): Checks root-level ObjectType folder (e.g., DatabaseTriggers/)
     * @param itemType The type of item being created
     * @param project The project to check for existing folders
     * @param schemaName Optional schema name to look for schema-named folders
     * @returns The default folder path if it exists, or empty string otherwise
     */
    public getDefaultFolderForItemType(
        itemType: ItemType,
        project: ISqlProject,
        schemaName?: string,
    ): string {
        let relativePath = "";

        // Get the folder config for this item type (defaults to schema-dependent if not in map)
        const folderConfig = templates.itemTypeToFolderMap.get(itemType);
        const isSchemaDependent = folderConfig?.schemaDependent ?? true;
        const folderName = folderConfig?.folderName;

        // Non-schema-dependent items - check root-level folder only
        if (!isSchemaDependent && folderName) {
            const rootFolder = project.folders.find(
                (f) => f.relativePath.toLowerCase() === folderName.toLowerCase(),
            );
            if (rootFolder) {
                relativePath = rootFolder.relativePath;
            }
            return relativePath;
        }

        // Case for Sequence: Check root-level Sequences folder first
        if (itemType === ItemType.sequence && folderName) {
            const rootObjectFolder = project.folders.find(
                (f) => f.relativePath.toLowerCase() === folderName.toLowerCase(),
            );

            if (rootObjectFolder) {
                return rootObjectFolder.relativePath;
            }
        }

        // For schema-dependent items, check schema folders
        if (schemaName) {
            // Case 1: Check for schema folder (e.g., "Sales", "dbo") - case-insensitive
            const schemaFolder = project.folders.find(
                (f) => f.relativePath.toLowerCase() === schemaName.toLowerCase(),
            );

            if (schemaFolder) {
                relativePath = schemaFolder.relativePath;

                // Case 2: Check for nested object type folder (e.g., "Sales/Functions")
                if (folderName) {
                    const nestedPath = path.join(schemaFolder.relativePath, folderName);
                    const nestedFolder = project.folders.find(
                        (f) => f.relativePath.toLowerCase() === nestedPath.toLowerCase(),
                    );

                    if (nestedFolder) {
                        relativePath = nestedFolder.relativePath;
                    }
                }
            }
        }

        // Case 3: If no schema folder found, return empty string (place at root)
        return relativePath;
    }

    public async addItemPromptFromNode(
        treeNode: dataworkspace.WorkspaceTreeItem,
        itemTypeName?: string,
    ): Promise<void> {
        const projectRelativeUri = vscode.Uri.file(
            path.basename(
                (treeNode.element as BaseProjectTreeItem).projectFileUri.fsPath,
                constants.sqlprojExtension,
            ),
        );
        await this.addItemPrompt(
            await this.getProjectFromContext(treeNode),
            this.getRelativePath(projectRelativeUri, treeNode.element),
            { itemType: itemTypeName },
            treeNode.treeDataProvider as SqlDatabaseProjectTreeViewProvider,
        );
    }

    public async addItemPrompt(
        project: ISqlProject,
        relativePath: string,
        options?: AddItemOptions,
        treeDataProvider?: SqlDatabaseProjectTreeViewProvider,
    ): Promise<void> {
        let itemTypeName = options?.itemType;
        if (!itemTypeName) {
            const items: vscode.QuickPickItem[] = [];

            for (const itemType of templates.projectScriptTypes()) {
                items.push({ label: itemType.friendlyName });
            }

            itemTypeName = (
                await vscode.window.showQuickPick(items, {
                    canPickMany: false,
                })
            )?.label;

            if (!itemTypeName) {
                return; // user cancelled
            }
        }

        const itemType = templates.get(itemTypeName);
        const absolutePathToParent = path.join(project.projectFolderPath, relativePath);
        const isItemTypePublishProfile =
            itemTypeName === constants.publishProfileFriendlyName ||
            itemTypeName === ItemType.publishProfile;
        const fileExtension = isItemTypePublishProfile
            ? constants.publishProfileExtension
            : constants.sqlFileExtension;
        const defaultName = isItemTypePublishProfile
            ? `${project.projectFileName}_`
            : options?.defaultName;
        let itemObjectName = await this.promptForNewObjectName(
            itemType,
            project,
            absolutePathToParent,
            fileExtension,
            defaultName,
        );

        itemObjectName = itemObjectName?.trim();

        if (!itemObjectName) {
            return; // user cancelled
        }

        // Check if itemObjectName contains the file extension, remove the last occurrence
        if (itemObjectName.toLowerCase().endsWith(fileExtension.toLowerCase())) {
            itemObjectName = itemObjectName?.slice(0, -fileExtension.length).trim();
        }

        // Parse schema and object name from input (e.g., "sales.MyFunction" -> schema="sales", objectName="MyFunction")
        const { schemaName, objectName } = this.parseSchemaAndObjectName(itemObjectName);

        // Determine the folder for this item when creating at project root
        // Checks: Schema folder -> Schema/ObjectType folder -> root
        if (relativePath === "") {
            relativePath = this.getDefaultFolderForItemType(itemType.type, project, schemaName);
        }

        const relativeFilePath = path.join(relativePath, objectName + fileExtension);

        const telemetryProps: Record<string, string> = { itemType: itemType.type };
        const telemetryMeasurements: Record<string, number> = {};

        if (itemType.type === ItemType.preDeployScript) {
            telemetryMeasurements.numPredeployScripts = project.preDeployScripts.length;
        } else if (itemType.type === ItemType.postDeployScript) {
            telemetryMeasurements.numPostdeployScripts = project.postDeployScripts.length;
        }

        try {
            const absolutePath = await this.addFileToProjectFromTemplate(
                project,
                itemType,
                relativeFilePath,
                new Map([
                    ["OBJECT_NAME", objectName],
                    ["SCHEMA_NAME", schemaName],
                    ["PROJECT_NAME", project.projectFileName],
                ]),
            );

            TelemetryReporter.createActionEvent(
                TelemetryViews.ProjectTree,
                TelemetryActions.addItemFromTree,
            )
                .withAdditionalProperties(telemetryProps)
                .withAdditionalMeasurements(telemetryMeasurements)
                .send();

            await vscode.commands.executeCommand(
                constants.vscodeOpenCommand,
                vscode.Uri.file(absolutePath),
            );
            treeDataProvider?.notifyTreeDataChanged();
        } catch (err) {
            void vscode.window.showErrorMessage(utils.getErrorMessage(err));

            TelemetryReporter.createErrorEvent2(
                TelemetryViews.ProjectTree,
                TelemetryActions.addItemFromTree,
                err,
            )
                .withAdditionalProperties(telemetryProps)
                .withAdditionalMeasurements(telemetryMeasurements)
                .send();
        }
    }

    public async addExistingItemPrompt(treeNode: dataworkspace.WorkspaceTreeItem): Promise<void> {
        const project = await this.getProjectFromContext(treeNode);

        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: constants.selectString,
            title: constants.selectFileString,
        });

        if (!uris) {
            return; // user cancelled
        }

        try {
            TelemetryReporter.sendActionEvent(
                TelemetryViews.ProjectTree,
                TelemetryActions.addExistingItem,
            );
            await project.addExistingItem(uris[0].fsPath);
            this.refreshProjectsTree(treeNode);
        } catch (err) {
            void vscode.window.showErrorMessage(utils.getErrorMessage(err));
            TelemetryReporter.sendErrorEvent2(
                TelemetryViews.ProjectTree,
                TelemetryActions.addExistingItem,
                err,
            );
        }
    }

    public async exclude(context: dataworkspace.WorkspaceTreeItem): Promise<void> {
        const node = context.element as BaseProjectTreeItem;
        const project = await this.getProjectFromContext(node);

        if (node.entryKey) {
            TelemetryReporter.sendActionEvent(
                TelemetryViews.ProjectTree,
                TelemetryActions.excludeFromProject,
            );

            switch (node.type) {
                case constants.DatabaseProjectItemType.sqlObjectScript:
                case constants.DatabaseProjectItemType.table:
                case constants.DatabaseProjectItemType.externalStreamingJob:
                    await project.excludeSqlObjectScript(node.entryKey);
                    break;
                case constants.DatabaseProjectItemType.folder:
                    await project.excludeFolder(node.entryKey);
                    break;
                case constants.DatabaseProjectItemType.preDeploymentScript:
                    await project.excludePreDeploymentScript(node.entryKey);
                    break;
                case constants.DatabaseProjectItemType.postDeploymentScript:
                    await project.excludePostDeploymentScript(node.entryKey);
                    break;
                case constants.DatabaseProjectItemType.noneFile:
                case constants.DatabaseProjectItemType.publishProfile:
                    await project.excludeNoneItem(node.entryKey);
                    break;
                default:
                    throw new Error(constants.unhandledExcludeType(node.type));
            }
        } else {
            TelemetryReporter.sendErrorEvent2(
                TelemetryViews.ProjectTree,
                TelemetryActions.excludeFromProject,
            );
            void vscode.window.showErrorMessage(
                constants.unableToPerformAction(
                    constants.excludeAction,
                    node.relativeProjectUri.path,
                ),
            );
        }

        this.refreshProjectsTree(context);
    }

    public async delete(context: dataworkspace.WorkspaceTreeItem): Promise<void> {
        const node = context.element as BaseProjectTreeItem;
        const project = await this.getProjectFromContext(node);

        let confirmationPrompt;
        if (node instanceof DatabaseReferenceTreeItem) {
            confirmationPrompt = constants.deleteReferenceConfirmation(node.friendlyName);
        } else if (node instanceof SqlCmdVariableTreeItem) {
            confirmationPrompt = constants.deleteSqlCmdVariableConfirmation(node.friendlyName);
        } else if (node instanceof FolderNode) {
            confirmationPrompt = constants.deleteConfirmationContents(node.friendlyName);
        } else {
            confirmationPrompt = constants.deleteConfirmation(node.friendlyName);
        }

        const response = await vscode.window.showWarningMessage(
            confirmationPrompt,
            { modal: true },
            constants.yesString,
        );

        if (response !== constants.yesString) {
            return;
        }

        try {
            if (node instanceof DatabaseReferenceTreeItem) {
                const databaseReference = this.getDatabaseReference(project, node);

                if (databaseReference) {
                    await project.deleteDatabaseReferenceByEntry(databaseReference);
                }
            } else if (node instanceof SqlCmdVariableTreeItem) {
                await project.deleteSqlCmdVariable(node.friendlyName);
            } else if (node instanceof FolderNode) {
                await project.deleteFolder(node.entryKey);
            } else if (node instanceof FileNode) {
                switch (node.type) {
                    case constants.DatabaseProjectItemType.sqlObjectScript:
                    case constants.DatabaseProjectItemType.table:
                    case constants.DatabaseProjectItemType.externalStreamingJob:
                        await project.deleteSqlObjectScript(node.entryKey);
                        break;
                    case constants.DatabaseProjectItemType.preDeploymentScript:
                        await project.deletePreDeploymentScript(node.entryKey);
                        break;
                    case constants.DatabaseProjectItemType.postDeploymentScript:
                        await project.deletePostDeploymentScript(node.entryKey);
                        break;
                    case constants.DatabaseProjectItemType.noneFile:
                    case constants.DatabaseProjectItemType.publishProfile:
                        await project.deleteNoneItem(node.entryKey);
                        break;
                    default:
                        throw new Error(constants.unhandledDeleteType(node.type));
                }
            }
            TelemetryReporter.createActionEvent(
                TelemetryViews.ProjectTree,
                TelemetryActions.deleteObjectFromProject,
            )
                .withAdditionalProperties({ objectType: node.constructor.name })
                .send();

            this.refreshProjectsTree(context);
        } catch (err) {
            TelemetryReporter.createErrorEvent2(
                TelemetryViews.ProjectTree,
                TelemetryActions.deleteObjectFromProject,
            )
                .withAdditionalProperties({ objectType: node.constructor.name })
                .send();

            void vscode.window.showErrorMessage(
                constants.unableToPerformAction(
                    constants.deleteAction,
                    node.relativeProjectUri.path,
                    utils.getErrorMessage(err),
                ),
            );
        }
    }

    public async rename(context: dataworkspace.WorkspaceTreeItem): Promise<void> {
        const node = context.element as BaseProjectTreeItem;
        const project = await this.getProjectFromContext(node);

        const originalAbsolutePath = utils.getPlatformSafeFileEntryPath(node.projectFileUri.fsPath);
        const originalName = path.basename(node.friendlyName);
        const originalExt = path.extname(node.friendlyName);

        // need to use quickpick because input box isn't supported in treeviews
        // https://github.com/microsoft/vscode/issues/117502 and https://github.com/microsoft/vscode/issues/97190
        const newFileName = await vscode.window.showInputBox({
            title: constants.enterNewName,
            value: originalName,
            valueSelection: [0, path.basename(originalName, originalExt).length],
            ignoreFocusOut: true,
            validateInput: async (newName) => {
                return (await this.fileAlreadyExists(newName, originalAbsolutePath))
                    ? constants.fileAlreadyExists(newName)
                    : undefined;
            },
        });

        if (!newFileName) {
            return;
        }

        const newFilePath = path.join(
            path.dirname(utils.getPlatformSafeFileEntryPath(node.relativeProjectUri.fsPath!)),
            newFileName,
        );
        const result = await project.move(node, newFilePath);

        if (result?.success) {
            TelemetryReporter.sendActionEvent(TelemetryViews.ProjectTree, TelemetryActions.rename);
        } else {
            TelemetryReporter.sendErrorEvent2(TelemetryViews.ProjectTree, TelemetryActions.rename);
            void vscode.window.showErrorMessage(
                constants.errorRenamingFile(node.entryKey!, newFilePath, result?.errorMessage),
            );
        }

        this.refreshProjectsTree(context);
    }

    private fileAlreadyExists(newFileName: string, previousFilePath: string): Promise<boolean> {
        return utils.exists(path.join(path.dirname(previousFilePath), newFileName));
    }

    /**
     * Opens a quickpick to edit the value of the SQLCMD variable launched from
     * @param context
     */
    public async editSqlCmdVariable(context: dataworkspace.WorkspaceTreeItem): Promise<void> {
        const node = context.element as SqlCmdVariableTreeItem;
        const project = await this.getProjectFromContext(node);
        const variableName = node.friendlyName;
        const originalValue = project.sqlCmdVariables.get(variableName);

        const newValue = await vscode.window.showInputBox({
            title: constants.enterNewValueForVar(variableName),
            value: originalValue,
            ignoreFocusOut: true,
        });

        if (!newValue) {
            return;
        }

        await project.updateSqlCmdVariable(variableName, newValue);
        this.refreshProjectsTree(context);
    }

    /**
     * Opens a quickpick to add a new SQLCMD variable to the project
     * @param context
     */
    public async addSqlCmdVariable(context: dataworkspace.WorkspaceTreeItem): Promise<void> {
        const project = await this.getProjectFromContext(context);

        const variableName = await vscode.window.showInputBox({
            title: constants.enterNewSqlCmdVariableName,
            ignoreFocusOut: true,
            validateInput: (value) => {
                return project.sqlCmdVariables.has(value)
                    ? constants.sqlcmdVariableAlreadyExists
                    : undefined;
            },
        });

        if (!variableName) {
            return;
        }

        let defaultValue = await vscode.window.showInputBox({
            title: constants.enterNewSqlCmdVariableDefaultValue(variableName),
            ignoreFocusOut: true,
        });

        if (!defaultValue) {
            // prompt asking if they want to add to add a sqlcmd variable without a default value
            const result = await vscode.window.showInformationMessage(
                constants.addSqlCmdVariableWithoutDefaultValue(variableName),
                constants.yesString,
                constants.noString,
            );

            if (result === constants.noString) {
                return;
            } else {
                defaultValue = "";
            }
        }

        await project.addSqlCmdVariable(variableName, defaultValue);
        this.refreshProjectsTree(context);
    }

    private getDatabaseReference(
        project: Project,
        context: BaseProjectTreeItem,
    ): IDatabaseReferenceProjectEntry | undefined {
        const databaseReference = context as DatabaseReferenceTreeItem;

        if (databaseReference) {
            return project.databaseReferences.find(
                (r) => r.referenceName === databaseReference.treeItem.label,
            );
        }

        return undefined;
    }

    //#endregion

    /**
     * Opens the folder containing the project
     * @param context a treeItem in a project's hierarchy, to be used to obtain a Project
     */
    public async openContainingFolder(context: dataworkspace.WorkspaceTreeItem): Promise<void> {
        const project = await this.getProjectFromContext(context);
        await vscode.commands.executeCommand(
            constants.revealFileInOsCommand,
            vscode.Uri.file(project.projectFilePath),
        );
    }

    /**
     * Open the project indicated by `context` in the workspace
     * @param context a SqlProjectReferenceTreeItem in the project's tree
     */
    public async openReferencedSqlProject(context: dataworkspace.WorkspaceTreeItem): Promise<void> {
        const node = context.element as BaseProjectTreeItem;
        const project = await this.getProjectFromContext(node);

        if (!(node instanceof SqlProjectReferenceTreeItem)) {
            return;
        }

        const absolutePath = path.normalize(
            path.join(project.projectFolderPath, node.reference.fsUri.fsPath),
        );
        await this.openProjectInWorkspace(absolutePath);
    }

    /**
     * Opens the .sqlproj file for the given project. Upon update of file, prompts user to
     * reload their project.
     * @param context a treeItem in a project's hierarchy, to be used to obtain a Project
     */
    public async editProjectFile(context: dataworkspace.WorkspaceTreeItem): Promise<void> {
        const project = await this.getProjectFromContext(context);

        try {
            await vscode.commands.executeCommand(
                constants.vscodeOpenCommand,
                vscode.Uri.file(project.projectFilePath),
            );

            TelemetryReporter.sendActionEvent(
                TelemetryViews.ProjectTree,
                TelemetryActions.editProjectFile,
            );

            const projFileWatcher: vscode.FileSystemWatcher =
                vscode.workspace.createFileSystemWatcher(project.projectFilePath);
            this.projFileWatchers.set(project.projectFilePath, projFileWatcher);

            projFileWatcher.onDidChange(async () => {
                const result = await vscode.window.showInformationMessage(
                    constants.reloadProject,
                    constants.yesString,
                    constants.noString,
                );

                if (result === constants.yesString) {
                    return this.reloadProject(context);
                }
            });

            // stop watching for changes to the sqlproj after it's closed
            const closeSqlproj = vscode.workspace.onDidCloseTextDocument((d) => {
                if (this.projFileWatchers.has(d.uri.fsPath)) {
                    this.projFileWatchers.get(d.uri.fsPath)!.dispose();
                    this.projFileWatchers.delete(d.uri.fsPath);
                    closeSqlproj.dispose();
                }
            });
        } catch (err) {
            void vscode.window.showErrorMessage(utils.getErrorMessage(err));
        }
    }

    /**
     * Opens a file in the editor and adds a file watcher to check if a create table statement has been added
     * @param fileSystemUri uri of file
     * @param node node of file in the tree
     */
    public async openFileWithWatcher(fileSystemUri: vscode.Uri, _node: FileNode): Promise<void> {
        await vscode.commands.executeCommand(constants.vscodeOpenCommand, fileSystemUri);

        const fileWatcher: vscode.FileSystemWatcher = vscode.workspace.createFileSystemWatcher(
            fileSystemUri.fsPath,
        );
        this.fileWatchers.set(fileSystemUri.fsPath, { fileWatcher: fileWatcher });

        // stop watching for changes to the file after it's closed
        const closeSqlproj = vscode.workspace.onDidCloseTextDocument((d) => {
            if (this.fileWatchers.has(d.uri.fsPath)) {
                this.fileWatchers.get(d.uri.fsPath)?.fileWatcher.dispose();
                this.fileWatchers.delete(d.uri.fsPath);
                closeSqlproj.dispose();
            }
        });
    }

    /**
     * Reloads the given project. Throws an error if given project is not a valid open project.
     * @param context
     */
    public async reloadProject(context: dataworkspace.WorkspaceTreeItem): Promise<void> {
        const project = await this.getProjectFromContext(context);
        if (project) {
            // won't open any newly referenced projects, but otherwise matches the behavior of reopening the project
            await project.readProjFile();
            this.refreshProjectsTree(context);
        } else {
            throw new Error(constants.invalidProjectReload);
        }
    }

    /**
     * Changes the project's DSP to the selected target platform
     * @param context a treeItem in a project's hierarchy, to be used to obtain a Project
     */
    public async changeTargetPlatform(
        context: Project | dataworkspace.WorkspaceTreeItem,
    ): Promise<void> {
        const project = await this.getProjectFromContext(context);
        const selectedTargetPlatform = (
            await vscode.window.showQuickPick(
                Array.from(constants.targetPlatformToVersion.keys()).map((version) => {
                    return { label: version };
                }),
                {
                    canPickMany: false,
                    placeHolder: constants.selectTargetPlatform(
                        constants.getTargetPlatformFromVersion(project.getProjectTargetVersion()),
                    ),
                },
            )
        )?.label;

        if (selectedTargetPlatform) {
            await project.changeTargetPlatform(
                constants.targetPlatformToVersion.get(selectedTargetPlatform)!,
            );
            void vscode.window.showInformationMessage(
                constants.currentTargetPlatform(
                    project.projectFileName,
                    constants.getTargetPlatformFromVersion(project.getProjectTargetVersion()),
                ),
            );
        }
    }

    //#region database references

    /**
     * Adds a database reference to the project
     * @param context a treeItem in a project's hierarchy, to be used to obtain a Project
     */
    public async addDatabaseReference(
        context: Project | dataworkspace.WorkspaceTreeItem,
    ): Promise<void> {
        const project = await this.getProjectFromContext(context);

        const settings = await addDatabaseReferenceQuickpick(project);
        if (settings) {
            await this.addDatabaseReferenceCallback(
                project,
                settings,
                context as dataworkspace.WorkspaceTreeItem,
            );
        }
    }

    /**
     * Adds a database reference to a project, after selections have been made in the dialog
     * @param project project to which to add the database reference
     * @param settings settings for the database reference
     * @param context a treeItem in a project's hierarchy, to be used to obtain a Project
     */
    public async addDatabaseReferenceCallback(
        project: Project,
        settings: AddDatabaseReferenceSettings,
        context: dataworkspace.WorkspaceTreeItem,
    ): Promise<void> {
        try {
            if ((<IProjectReferenceSettings>settings).projectName !== undefined) {
                // get project path and guid
                const projectReferenceSettings = settings as IProjectReferenceSettings;
                const workspaceProjects = await utils.getSqlProjectsInWorkspace();
                const referencedProject = await Project.openProject(
                    workspaceProjects.filter(
                        (p) => path.parse(p.fsPath).name === projectReferenceSettings.projectName,
                    )[0].fsPath,
                );
                const relativePath = path.relative(
                    project.projectFolderPath,
                    referencedProject?.projectFilePath!,
                );
                projectReferenceSettings.projectRelativePath = vscode.Uri.file(relativePath);
                projectReferenceSettings.projectGuid = referencedProject?.projectGuid!;

                const projectReferences =
                    referencedProject?.databaseReferences.filter(
                        (r) => r instanceof SqlProjectReferenceProjectEntry,
                    ) ?? [];

                // check for cirular dependency
                for (let r of projectReferences) {
                    if (
                        (<SqlProjectReferenceProjectEntry>r).projectName === project.projectFileName
                    ) {
                        void vscode.window.showErrorMessage(
                            constants.cantAddCircularProjectReference(
                                referencedProject?.projectFileName!,
                            ),
                        );
                        return;
                    }
                }

                await project.addProjectReference(projectReferenceSettings);
            } else if ((<ISystemDatabaseReferenceSettings>settings).systemDb !== undefined) {
                await project.addSystemDatabaseReference(
                    <ISystemDatabaseReferenceSettings>settings,
                );
            } else if ((<IDacpacReferenceSettings>settings).dacpacFileLocation !== undefined) {
                // update dacpacFileLocation to relative path to project file
                const dacpacRefSettings = settings as IDacpacReferenceSettings;
                dacpacRefSettings.dacpacFileLocation = vscode.Uri.file(
                    path.relative(
                        project.projectFolderPath,
                        dacpacRefSettings.dacpacFileLocation.fsPath,
                    ),
                );
                await project.addDatabaseReference(dacpacRefSettings);
            } else {
                await project.addNugetPackageReference(<INugetPackageReferenceSettings>settings);
            }

            this.refreshProjectsTree(context);
        } catch (err) {
            void vscode.window.showErrorMessage(utils.getErrorMessage(err));
        }
    }

    //#endregion

    /**
     * Validates the contents of an external streaming job's query against the last-built dacpac.
     * If no dacpac exists at the output path, one will be built first.
     * @param node a treeItem in a project's hierarchy, to be used to obtain a Project
     */
    public async validateExternalStreamingJob(
        node: dataworkspace.WorkspaceTreeItem,
    ): Promise<mssqlVscode.ValidateStreamingJobResult> {
        const project: Project = await this.getProjectFromContext(node);

        let dacpacPath: string = project.dacpacOutputPath;
        const preExistingDacpac = await utils.exists(dacpacPath);

        const telemetryProps: Record<string, string> = {
            preExistingDacpac: preExistingDacpac.toString(),
        };

        if (!preExistingDacpac) {
            dacpacPath = await this.buildProject(project);
        }

        const streamingJobDefinition: string = (
            await fs.readFile(node.element.fileSystemUri.fsPath)
        ).toString();

        const dacFxService = await utils.getDacFxService();
        const actionStartTime = new Date().getTime();

        const result: mssqlVscode.ValidateStreamingJobResult =
            await dacFxService.validateStreamingJob(dacpacPath, streamingJobDefinition);

        const duration = new Date().getTime() - actionStartTime;
        telemetryProps.success = result.success.toString();

        if (result.success) {
            void vscode.window.showInformationMessage(
                constants.externalStreamingJobValidationPassed,
            );
        } else {
            void vscode.window.showErrorMessage(result.errorMessage);
        }

        TelemetryReporter.createActionEvent(
            TelemetryViews.ProjectTree,
            TelemetryActions.runStreamingJobValidation,
        )
            .withAdditionalProperties(telemetryProps)
            .withAdditionalMeasurements({ duration: duration })
            .send();

        return result;
    }

    //#region AutoRest

    public async selectAutorestSpecFile(): Promise<string | undefined> {
        let quickpickSelection = await vscode.window.showQuickPick(
            [constants.browseEllipsisWithIcon],
            { title: constants.selectSpecFile, ignoreFocusOut: true },
        );
        if (!quickpickSelection) {
            return;
        }

        const filters: { [name: string]: string[] } = {};
        filters[constants.specSelectionText] = constants.openApiSpecFileExtensions;

        let uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: constants.selectString,
            filters: filters,
            title: constants.selectSpecFile,
        });

        if (!uris) {
            return;
        }

        return uris[0].fsPath;
    }

    /**
     * @returns \{ newProjectFolder: 'C:\Source\MyProject',
     * 			outputFolder: 'C:\Source',
     * 			projectName: 'MyProject'}
     */
    public async selectAutorestProjectLocation(
        projectName: string,
        defaultOutputLocation: vscode.Uri | undefined,
    ): Promise<
        { newProjectFolder: string; outputFolder: string; projectName: string } | undefined
    > {
        let newProjectFolder = defaultOutputLocation
            ? path.join(defaultOutputLocation.fsPath, projectName)
            : "";
        let outputFolder = defaultOutputLocation?.fsPath || "";
        while (true) {
            let quickPickTitle = "";
            if (newProjectFolder && (await utils.exists(newProjectFolder))) {
                // Folder already exists at target location, prompt for new location
                quickPickTitle = constants.folderAlreadyExistsChooseNewLocation(newProjectFolder);
            } else if (!newProjectFolder) {
                // No target location yet
                quickPickTitle = constants.selectProjectLocation;
            } else {
                // Folder doesn't exist at target location so we're done
                break;
            }
            const quickpickSelection = await vscode.window.showQuickPick(
                [constants.browseEllipsisWithIcon],
                { title: quickPickTitle, ignoreFocusOut: true },
            );
            if (!quickpickSelection) {
                return;
            }

            const folders = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: constants.selectString,
                defaultUri: defaultOutputLocation ?? vscode.workspace.workspaceFolders?.[0]?.uri,
                title: constants.selectProjectLocation,
            });

            if (!folders) {
                return;
            }

            outputFolder = folders[0].fsPath;

            newProjectFolder = path.join(outputFolder, projectName);
        }

        return { newProjectFolder, outputFolder, projectName };
    }

    public async generateAutorestFiles(
        specPath: string,
        newProjectFolder: string,
    ): Promise<string | undefined> {
        await fs.mkdir(newProjectFolder, { recursive: true });

        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: constants.generatingProjectFromAutorest(path.basename(specPath)),
                cancellable: false,
            },
            async (_progress, _token) => {
                return this.autorestHelper.generateAutorestFiles(specPath, newProjectFolder);
            },
        );
    }

    /**
     * Adds the provided project in the workspace, opening it in the projects viewlet
     * @param projectFilePath
     */
    public async openProjectInWorkspace(projectFilePath: string): Promise<void> {
        const workspaceApi = utils.getDataWorkspaceExtensionApi();
        await workspaceApi.validateWorkspace();
        await workspaceApi.addProjectsToWorkspace([vscode.Uri.file(projectFilePath)]);

        workspaceApi.showProjectsView();
    }

    public async promptForAutorestProjectName(defaultName?: string): Promise<string | undefined> {
        let name: string | undefined = await vscode.window.showInputBox({
            ignoreFocusOut: true,
            prompt: constants.autorestProjectName,
            value: defaultName,
            validateInput: (value) => {
                return utils.isValidBasenameErrorMessage(value);
            },
        });

        if (name === undefined) {
            return; // cancelled by user
        }

        name = name.trim();

        return name;
    }

    /**
     * Prompts the user with vscode quickpicks to select an OpenApi or Swagger spec to generate sql project from
     * @param options optional options to pass in instead of using quickpicks to prompt
     * @returns created sql project
     */
    public async generateProjectFromOpenApiSpec(
        options?: GenerateProjectFromOpenApiSpecOptions,
    ): Promise<Project | undefined> {
        try {
            TelemetryReporter.sendActionEvent(
                TelemetryViews.ProjectController,
                TelemetryActions.generateProjectFromOpenApiSpec,
            );

            // 1. select spec file
            const specPath: string | undefined =
                options?.openApiSpecFile?.fsPath || (await this.selectAutorestSpecFile());
            if (!specPath) {
                return;
            }

            // 2. prompt for project name
            const projectName = await this.promptForAutorestProjectName(
                options?.defaultProjectName || path.basename(specPath, path.extname(specPath)),
            );
            if (!projectName) {
                return;
            }

            // 3. select location, make new folder
            const projectInfo = await this.selectAutorestProjectLocation(
                projectName!,
                options?.defaultOutputLocation,
            );
            if (!projectInfo) {
                return;
            }

            // 4. run AutoRest to generate .sql files
            const result = await this.generateAutorestFiles(specPath, projectInfo.newProjectFolder);
            if (!result) {
                // user canceled operation when choosing how to run autorest
                return;
            }

            const scriptList: vscode.Uri[] | undefined = await this.getSqlFileList(
                projectInfo.newProjectFolder,
            );

            if (!scriptList || scriptList.length === 0) {
                void vscode.window.showInformationMessage(constants.noSqlFilesGenerated);
                this._outputChannel.show();
                return;
            }

            // 5. create new SQL project
            const newProjFilePath = await this.createNewProject({
                newProjName: projectInfo.projectName,
                folderUri: vscode.Uri.file(projectInfo.outputFolder),
                projectTypeId: constants.emptySqlDatabaseProjectTypeId,
                sdkStyle: !!options?.isSDKStyle,
                configureDefaultBuild: true,
            });

            const project = await Project.openProject(newProjFilePath);

            // 6. add generated files to SQL project

            const uriList = scriptList.filter(
                (f) => !f.fsPath.endsWith(constants.autorestPostDeploymentScriptName),
            );
            const relativePaths = uriList.map((f) =>
                path.relative(project.projectFolderPath, f.fsPath),
            );
            await project.addSqlObjectScripts(relativePaths); // Add generated file structure to the project

            const postDeploymentScript: vscode.Uri | undefined =
                this.findPostDeploymentScript(scriptList);

            if (postDeploymentScript) {
                await project.addPostDeploymentScript(
                    path.relative(project.projectFolderPath, postDeploymentScript.fsPath),
                );
            }

            if (options?.doNotOpenInWorkspace !== true) {
                // 7. add project to workspace and open
                await this.openProjectInWorkspace(newProjFilePath);
            }

            return project;
        } catch (err) {
            void vscode.window.showErrorMessage(
                constants.generatingProjectFailed(utils.getErrorMessage(err)),
            );
            TelemetryReporter.sendErrorEvent2(
                TelemetryViews.ProjectController,
                TelemetryActions.generateProjectFromOpenApiSpec,
                err,
            );
            this._outputChannel.show();
            return;
        }
    }

    private findPostDeploymentScript(files: vscode.Uri[]): vscode.Uri | undefined {
        // Locate the post-deployment script generated by autorest, if one exists.
        // It's only generated if enums are present in spec, b/c the enum values need to be inserted into the generated table.
        // Because autorest is executed via command rather than API, we can't easily "receive" the name of the script,
        // so we're stuck just matching on a file name.
        const results = files.filter((f) =>
            f.fsPath.endsWith(constants.autorestPostDeploymentScriptName),
        );

        switch (results.length) {
            case 0:
                return undefined;
            case 1:
                return results[0];
            default:
                throw new Error(constants.multipleMostDeploymentScripts(results.length));
        }
    }

    private async getSqlFileList(folder: string): Promise<vscode.Uri[] | undefined> {
        if (!(await utils.exists(folder))) {
            return undefined;
        }

        const entries = await fs.readdir(folder, { withFileTypes: true });

        const folders = entries
            .filter((dir) => dir.isDirectory())
            .map((dir) => path.join(folder, dir.name));
        const files = entries
            .filter(
                (file) =>
                    !file.isDirectory() && path.extname(file.name) === constants.sqlFileExtension,
            )
            .map((file) => vscode.Uri.file(path.join(folder, file.name)));

        for (const folder of folders) {
            files.push(...((await this.getSqlFileList(folder)) ?? []));
        }

        return files;
    }

    //#endregion

    //#region Helper methods

    private async getProjectFromContext(
        context: Project | BaseProjectTreeItem | dataworkspace.WorkspaceTreeItem,
    ): Promise<Project> {
        if ("element" in context) {
            context = context.element;
        }

        if (context instanceof Project) {
            return context;
        }

        if (context instanceof BaseProjectTreeItem) {
            return Project.openProject(context.projectFileUri.fsPath);
        } else {
            throw new Error(constants.unexpectedProjectContext(JSON.stringify(context)));
        }
    }

    private getRelativePath(rootProjectUri: vscode.Uri, treeNode: BaseProjectTreeItem): string {
        return treeNode instanceof FolderNode
            ? utils.trimUri(rootProjectUri, treeNode.relativeProjectUri)
            : "";
    }

    private getConnectionProfileFromContext(
        context: mssqlVscode.ITreeNodeInfo | undefined,
    ): mssqlVscode.IConnectionInfo | undefined {
        if (!context) {
            return undefined;
        }

        // depending on where import new project is launched from, the connection profile could be passed as just
        // the profile or it could be wrapped in another object
        return (
            (<any>context)?.connectionProfile ??
            (context as mssqlVscode.ITreeNodeInfo).connectionInfo ??
            context
        );
    }

    private refreshProjectsTree(workspaceTreeItem: dataworkspace.WorkspaceTreeItem): void {
        (
            workspaceTreeItem.treeDataProvider as SqlDatabaseProjectTreeViewProvider
        ).notifyTreeDataChanged();
    }

    //#endregion

    //#region Create project from database

    /**
     * Creates a new SQL database project from the existing database,
     * prompting the user for a name, file path location and extract target
     */
    public async createProjectFromDatabase(
        context: mssqlVscode.ITreeNodeInfo | undefined,
    ): Promise<void> {
        const profile = this.getConnectionProfileFromContext(context);
        if (context) {
            // The profile we get from VS Code is for the overall server connection and isn't updated based on the database node
            // the command was launched from like it is in ADS. So get the actual database name from the MSSQL extension and
            // update the connection info here.
            const treeNodeContext = context as mssqlVscode.ITreeNodeInfo;
            const databaseName = (await utils.getVscodeMssqlApi()).getDatabaseNameFromTreeNode(
                treeNodeContext,
            );
            (profile as mssqlVscode.IConnectionInfo).database = databaseName;
        }
        await createNewProjectFromDatabaseWithQuickpick(
            profile as mssqlVscode.IConnectionInfo,
            (
                model: ImportDataModel,
                connectionInfo?: string | mssqlVscode.IConnectionInfo,
                serverName?: string,
            ) => this.createProjectFromDatabaseCallback(model, connectionInfo, serverName),
        );
    }

    public async createProjectFromDatabaseCallback(
        model: ImportDataModel,
        connectionInfo?: string | mssqlVscode.IConnectionInfo,
        serverName?: string,
    ) {
        try {
            const newProjFolderUri = model.filePath;
            let targetPlatform: SqlTargetPlatform | undefined;
            let serverInfo;
            if (connectionInfo) {
                if (typeof connectionInfo === "string") {
                    throw new Error("Connection ID string is not supported in VS Code");
                } else {
                    serverInfo = (await utils.getVscodeMssqlApi()).getServerInfo(connectionInfo);
                }
            }

            if (serverInfo) {
                targetPlatform = await utils.getTargetPlatformFromServerVersion(
                    serverInfo,
                    serverName,
                );
            }

            const newProjFilePath = await this.createNewProject({
                newProjName: model.projName,
                folderUri: vscode.Uri.file(newProjFolderUri),
                projectTypeId: model.sdkStyle
                    ? constants.emptySqlDatabaseSdkProjectTypeId
                    : constants.emptySqlDatabaseProjectTypeId,
                sdkStyle: model.sdkStyle,
                targetPlatform: targetPlatform,
                configureDefaultBuild: true,
            });

            model.filePath = path.dirname(newProjFilePath);
            this.setFilePath(model);

            const project = await Project.openProject(newProjFilePath);

            const startTime = new Date();

            await this.createProjectFromDatabaseApiCall(model); // Call ExtractAPI in DacFx Service

            const timeToExtract = new Date().getTime() - startTime.getTime();
            TelemetryReporter.createActionEvent(
                TelemetryViews.ProjectController,
                TelemetryActions.createProjectFromDatabase,
            )
                .withAdditionalMeasurements({ durationMs: timeToExtract })
                .send();

            const scriptList: vscode.Uri[] =
                model.extractTarget === mssqlVscode.ExtractTarget.file
                    ? [vscode.Uri.file(model.filePath)]
                    : await this.generateScriptList(model.filePath); // Create a list of all the files to be added to project

            const relativePaths = scriptList.map((f) =>
                path.relative(project.projectFolderPath, f.fsPath),
            );

            if (!model.sdkStyle) {
                await project.addSqlObjectScripts(relativePaths); // Add generated file structure to the project
            }

            // add project to workspace
            const workspaceApi = utils.getDataWorkspaceExtensionApi();
            workspaceApi.showProjectsView();
            await workspaceApi.addProjectsToWorkspace([vscode.Uri.file(newProjFilePath)]);
        } catch (err) {
            void vscode.window.showErrorMessage(utils.getErrorMessage(err));
            TelemetryReporter.sendErrorEvent2(
                TelemetryViews.ProjectController,
                TelemetryActions.createProjectFromDatabase,
                err,
            );
        }
    }

    public async createProjectFromDatabaseApiCall(model: ImportDataModel): Promise<void> {
        const service = await utils.getDacFxService();
        await (service as mssqlVscode.IDacFxService).createProjectFromDatabase(
            model.database,
            model.filePath,
            model.projName,
            model.version,
            model.connectionUri,
            model.extractTarget as mssqlVscode.ExtractTarget,
            TaskExecutionMode.execute as unknown as mssqlVscode.TaskExecutionMode,
            model.includePermissions,
        );
        // TODO: Check for success; throw error
    }

    public setFilePath(model: ImportDataModel) {
        if (model.extractTarget === mssqlVscode.ExtractTarget.file) {
            model.filePath = path.join(model.filePath, `${model.projName}.sql`); // File extractTarget specifies the exact file rather than the containing folder
        }
    }

    /**
     * Generate a flat list of all scripts under a folder.
     * @param absolutePath absolute path to folder to generate the list of files from
     * @returns array of uris of files under the provided folder
     */
    public async generateScriptList(absolutePath: string): Promise<vscode.Uri[]> {
        let fileList: vscode.Uri[] = [];

        if (!(await utils.exists(absolutePath))) {
            if (await utils.exists(absolutePath + constants.sqlFileExtension)) {
                absolutePath += constants.sqlFileExtension;
            } else {
                void vscode.window.showErrorMessage(constants.cannotResolvePath(absolutePath));
                return fileList;
            }
        }

        const files = [absolutePath];
        do {
            const filepath = files.pop();

            if (filepath) {
                const stat = await fs.stat(filepath);

                if (stat.isDirectory()) {
                    (await fs.readdir(filepath)).forEach((f: string) =>
                        files.push(path.join(filepath, f)),
                    );
                } else if (stat.isFile() && path.extname(filepath) === constants.sqlFileExtension) {
                    fileList.push(vscode.Uri.file(filepath));
                }
            }
        } while (files.length !== 0);

        return fileList;
    }

    //#endregion

    //#region Update project from database

    /**
     * Display dialog for user to configure existing SQL Project with the changes/differences from a database
     */
    public async updateProjectFromDatabase(
        context: mssqlVscode.ITreeNodeInfo | dataworkspace.WorkspaceTreeItem,
    ): Promise<void> {
        let connection: mssqlVscode.IConnectionInfo | undefined;

        try {
            if ("connectionProfile" in context) {
                connection = this.getConnectionProfileFromContext(
                    context as mssqlVscode.ITreeNodeInfo,
                );
            }
        } catch {}

        let projectFilePath: string | undefined;
        if (context) {
            // VS Code's connection/profile may only represent the server-level connection and won't reflect
            // the database selected in the MSSQL tree node that the user invoked the command from.
            // In ADS the context can include the database info, but in VS Code we need to ask the MSSQL
            // extension for the actual database name for this tree node and then update the connection object.
            if (connection !== undefined) {
                const treeNodeContext = context as mssqlVscode.ITreeNodeInfo;
                const databaseName = (await utils.getVscodeMssqlApi()).getDatabaseNameFromTreeNode(
                    treeNodeContext,
                );
                (connection as mssqlVscode.IConnectionInfo).database = databaseName;
            } else {
                // Check if it's a WorkspaceTreeItem by checking for the expected properties
                const workspaceItem = context as dataworkspace.WorkspaceTreeItem;
                if (workspaceItem.element && workspaceItem.treeDataProvider) {
                    const project = await this.getProjectFromContext(workspaceItem);
                    projectFilePath = project.projectFilePath;
                }
            }
        }
        await UpdateProjectFromDatabaseWithQuickpick(
            connection as mssqlVscode.IConnectionInfo,
            projectFilePath,
            (model: UpdateProjectDataModel) => this.updateProjectFromDatabaseCallback(model),
        );
    }

    public async updateProjectFromDatabaseCallback(model: UpdateProjectDataModel) {
        try {
            const startTime = new Date();

            await this.updateProjectFromDatabaseApiCall(model);

            const timeToUpdate = new Date().getTime() - startTime.getTime();
            TelemetryReporter.createActionEvent(
                TelemetryViews.ProjectController,
                TelemetryActions.updateProjectFromDatabase,
            )
                .withAdditionalMeasurements({ durationMs: timeToUpdate })
                .send();
        } catch (err) {
            void vscode.window.showErrorMessage(utils.getErrorMessage(err));
            TelemetryReporter.sendErrorEvent2(
                TelemetryViews.ProjectController,
                TelemetryActions.updateProjectFromDatabase,
                err,
            );
        }
    }

    /**
     * Uses the DacFx service to update an existing SQL Project with the changes/differences from a database
     */
    public async updateProjectFromDatabaseApiCall(model: UpdateProjectDataModel): Promise<void> {
        if (model.action === UpdateProjectAction.Compare) {
            await vscode.commands.executeCommand(
                constants.mssqlSchemaCompareCommand,
                model.sourceEndpointInfo,
                model.targetEndpointInfo,
                true,
                undefined,
            );
        } else if (model.action === UpdateProjectAction.Update) {
            await vscode.window
                .showWarningMessage(
                    constants.applyConfirmation,
                    { modal: true },
                    constants.yesString,
                )
                .then(async (result) => {
                    if (result === constants.yesString) {
                        await vscode.window.withProgress(
                            {
                                location: vscode.ProgressLocation.Notification,
                                title: constants.updatingProjectFromDatabase(
                                    path.basename(model.targetEndpointInfo.projectFilePath),
                                    model.sourceEndpointInfo.databaseName,
                                ),
                                cancellable: false,
                            },
                            async (_progress, _token) => {
                                return this.schemaCompareAndUpdateProject(
                                    model.sourceEndpointInfo,
                                    model.targetEndpointInfo,
                                );
                            },
                        );

                        void vscode.commands.executeCommand(constants.refreshDataWorkspaceCommand);
                        utils.getDataWorkspaceExtensionApi().showProjectsView();
                    }
                });
        } else {
            throw new Error(`Unknown UpdateProjectAction: ${model.action}`);
        }

        return;
    }

    /**
     * Performs a schema compare of the source and target and updates the project with the results
     * @param source source for schema comparison
     * @param target target sql project for schema comparison to update
     */
    private async schemaCompareAndUpdateProject(
        source: mssqlVscode.SchemaCompareEndpointInfo,
        target: mssqlVscode.SchemaCompareEndpointInfo,
    ): Promise<void> {
        // Run schema comparison - use the schema compare service
        const service = await utils.getSchemaCompareService();
        const dacFxService = await utils.getDacFxService();
        const operationId = UUID.generateUuid();

        target.targetScripts = await this.getProjectScriptFiles(target.projectFilePath);
        target.dataSchemaProvider = await this.getProjectDatabaseSchemaProvider(
            target.projectFilePath,
        );

        TelemetryReporter.sendActionEvent(
            TelemetryViews.ProjectController,
            TelemetryActions.SchemaComparisonStarted,
        );

        const deploymentOptions = await (
            dacFxService as mssqlVscode.IDacFxService
        ).getDeploymentOptions(
            DeploymentScenario.SchemaCompare as unknown as mssqlVscode.DeploymentScenario,
        );

        // Perform schema comparison
        const comparisonResult = await (service as mssqlVscode.ISchemaCompareService).compare(
            operationId,
            source as mssqlVscode.SchemaCompareEndpointInfo,
            target as mssqlVscode.SchemaCompareEndpointInfo,
            mssqlVscode.TaskExecutionMode.execute,
            deploymentOptions.defaultDeploymentOptions,
        );

        if (!comparisonResult || !comparisonResult.success) {
            TelemetryReporter.createErrorEvent2(
                TelemetryViews.ProjectController,
                "SchemaComparisonFailed",
            )
                .withAdditionalProperties({
                    operationId: comparisonResult.operationId,
                })
                .send();
            await vscode.window.showErrorMessage(
                constants.compareErrorMessage(comparisonResult?.errorMessage),
            );
            return;
        }

        TelemetryReporter.createActionEvent(
            TelemetryViews.ProjectController,
            TelemetryActions.SchemaComparisonFinished,
        )
            .withAdditionalProperties({
                endTime: Date.now().toString(),
                operationId: comparisonResult.operationId,
            })
            .send();

        if (comparisonResult.areEqual) {
            void vscode.window.showInformationMessage(constants.equalComparison);
            return;
        }
        if (comparisonResult.areEqual) {
            void vscode.window.showInformationMessage(constants.equalComparison);
            return;
        }

        // Publish the changes (retrieved from the cache by operationId)
        const publishResult = await this.schemaComparePublishProjectChanges(
            operationId,
            target.projectFilePath,
            target.extractTarget as mssqlVscode.ExtractTarget,
        );

        if (publishResult.success) {
            void vscode.window.showInformationMessage(constants.applySuccess);
        } else {
            void vscode.window.showErrorMessage(constants.applyError(publishResult.errorMessage));
        }
    }

    public async getProjectScriptFiles(projectFilePath: string): Promise<string[]> {
        const project = await Project.openProject(projectFilePath);

        return project.sqlObjectScripts
            .filter((f) => f.fsUri.fsPath.endsWith(constants.sqlFileExtension))
            .map((f) => f.fsUri.fsPath);
    }

    public async getProjectDatabaseSchemaProvider(projectFilePath: string): Promise<string> {
        const project = await Project.openProject(projectFilePath);
        return project.getProjectTargetVersion();
    }

    /**
     * Updates the provided project with the results of the schema compare
     * @param operationId id of the schema comparison to update the project with
     * @param projectFilePath path to sql project to update
     * @param folderStructure folder structure to use when updating the target project
     * @returns
     */
    public async schemaComparePublishProjectChanges(
        operationId: string,
        projectFilePath: string,
        folderStructure: mssqlVscode.ExtractTarget,
    ): Promise<mssqlVscode.SchemaComparePublishProjectResult> {
        const service = await utils.getSchemaCompareService();
        const projectPath = path.dirname(projectFilePath);

        // Perform schema compare publish
        const result = await (service as mssqlVscode.ISchemaCompareService).publishProjectChanges(
            operationId,
            projectPath,
            folderStructure as mssqlVscode.ExtractTarget,
            mssqlVscode.TaskExecutionMode.execute as any,
        );

        if (!result.errorMessage) {
            const project = await Project.openProject(projectFilePath);

            let toAdd: vscode.Uri[] = [];
            result.addedFiles.forEach((f: any) => toAdd.push(vscode.Uri.file(f)));
            const relativePaths = toAdd.map((f) =>
                path.relative(project.projectFolderPath, f.fsPath),
            );

            await project.addSqlObjectScripts(relativePaths);

            let toRemove: vscode.Uri[] = [];
            result.deletedFiles.forEach((f: any) => toRemove.push(vscode.Uri.file(f)));

            let toRemoveEntries: FileProjectEntry[] = [];
            toRemove.forEach((f) =>
                toRemoveEntries.push(
                    new FileProjectEntry(
                        f,
                        f.fsPath.replace(projectPath + "\\", ""),
                        EntryType.File,
                    ),
                ),
            );

            toRemoveEntries.forEach(
                async (f) => await project.excludeSqlObjectScript(f.fsUri.fsPath),
            );

            await this.buildProject(project);
        }

        return result;
    }

    //#endregion

    /**
     * Move a file or folder in the project tree
     * @param projectUri URI of the project
     * @param source
     * @param target
     */
    public async moveFile(
        projectUri: vscode.Uri,
        source: any,
        target: dataworkspace.WorkspaceTreeItem,
    ): Promise<void> {
        const sourceFileNode = source as FileNode | FolderNode;
        const project = await this.getProjectFromContext(sourceFileNode);

        // only moving files and folders are supported
        if (
            !sourceFileNode ||
            !(sourceFileNode instanceof FileNode || sourceFileNode instanceof FolderNode)
        ) {
            void vscode.window.showErrorMessage(constants.onlyMoveFilesFoldersSupported);
            return;
        }

        // Moving files/folders to the SQLCMD variables and Database references folders isn't allowed
        if (!target.element.fileSystemUri) {
            return;
        }

        // TODO: handle moving between different projects
        if (projectUri.fsPath !== target.element.projectFileUri.fsPath) {
            void vscode.window.showErrorMessage(constants.movingFilesBetweenProjectsNotSupported);
            return;
        }

        // Calculate the new file path
        let folderPath;
        // target is the root of project, which is the .sqlproj
        if (target.element.projectFileUri.fsPath === target.element.fileSystemUri.fsPath) {
            // Get the project name from .sqlproj file path, not the folder name
            folderPath = path.basename(
                target.element.projectFileUri.fsPath,
                constants.sqlprojExtension,
            );
        } else {
            // target is another file or folder
            folderPath = target.element.relativeProjectUri.fsPath.endsWith(
                constants.sqlFileExtension,
            )
                ? path.dirname(target.element.relativeProjectUri.fsPath)
                : target.element.relativeProjectUri.fsPath;
        }

        const newPath = path.join(folderPath!, sourceFileNode.friendlyName);

        // don't do anything if the path is the same
        if (newPath === sourceFileNode.relativeProjectUri.fsPath) {
            return;
        }

        const result = await vscode.window.showWarningMessage(
            constants.moveConfirmationPrompt(
                path.basename(sourceFileNode.fileSystemUri.fsPath),
                path.basename(folderPath),
            ),
            { modal: true },
            constants.move,
        );
        if (result !== constants.move) {
            return;
        }

        // Move the file/folder
        const moveResult = await project.move(sourceFileNode, newPath);

        if (moveResult?.success) {
            TelemetryReporter.sendActionEvent(TelemetryViews.ProjectTree, TelemetryActions.move);
        } else {
            TelemetryReporter.sendErrorEvent2(TelemetryViews.ProjectTree, TelemetryActions.move);
            void vscode.window.showErrorMessage(
                constants.errorMovingFile(
                    sourceFileNode.fileSystemUri.fsPath,
                    newPath,
                    utils.getErrorMessage(moveResult?.errorMessage),
                ),
            );
        }
    }
}

export interface NewProjectParams {
    newProjName: string;
    folderUri: vscode.Uri;
    projectTypeId: string;
    sdkStyle: boolean;
    projectGuid?: string;
    targetPlatform?: SqlTargetPlatform;
    configureDefaultBuild?: boolean;
}
