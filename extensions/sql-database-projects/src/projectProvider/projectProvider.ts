/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dataworkspace from 'dataworkspace';
import * as sqldbproj from 'sqldbproj';
import * as vscode from 'vscode';
import * as constants from '../common/constants';
import { IconPathHelper } from '../common/iconHelper';
import { getDataWorkspaceExtensionApi, getSqlProjectsService } from '../common/utils';
import { SqlDatabaseProjectTreeViewProvider } from '../controllers/databaseProjectTreeViewProvider';
import { ProjectsController } from '../controllers/projectController';
import { Project } from '../models/project';
import { BaseProjectTreeItem } from '../models/tree/baseTreeItem';

export class SqlDatabaseProjectProvider implements dataworkspace.IProjectProvider, sqldbproj.IExtension {
	constructor(private projectController: ProjectsController) {

	}

	supportsDragAndDrop: boolean = true;

	/**
	 * Move a file in the project tree
	 * @param projectUri
	 * @param source
	 * @param target
	 */
	public async moveFile(projectUri: vscode.Uri, source: any, target: dataworkspace.WorkspaceTreeItem): Promise<void> {
		return this.projectController.moveFile(projectUri, source, target);
	}

	/**
	 * Gets the project tree data provider
	 * @param projectFilePath The project file Uri
	 */
	public async getProjectTreeDataProvider(projectFilePath: vscode.Uri): Promise<vscode.TreeDataProvider<BaseProjectTreeItem>> {
		const provider = new SqlDatabaseProjectTreeViewProvider();
		const project = await Project.openProject(projectFilePath.fsPath, true, true);

		// open project in STS
		const sqlProjectsService = await getSqlProjectsService();
		await sqlProjectsService.openProject(projectFilePath.fsPath);

		provider.load([project]);
		return provider;
	}

	/**
	 * Gets the supported project types
	 */
	public get supportedProjectTypes(): dataworkspace.IProjectType[] {
		return [
			{
				id: constants.emptyAzureDbSqlDatabaseProjectTypeId,
				projectFileExtension: constants.sqlprojExtension.replace(/\./g, ''),
				displayName: constants.emptyAzureDbProjectTypeDisplayName,
				description: constants.emptyAzureDbProjectTypeDescription,
				targetPlatforms: Array.from(constants.targetPlatformToVersion.keys()),
				defaultTargetPlatform: sqldbproj.SqlTargetPlatform.sqlAzure,
				icon: IconPathHelper.azureSqlDbProject,
				sdkStyleOption: true,
				sdkStyleLearnMoreUrl: constants.sdkLearnMoreUrl,
				learnMoreUrl: constants.azureDevOpsLink
			},
			{
				id: constants.emptySqlDatabaseProjectTypeId,
				projectFileExtension: constants.sqlprojExtension.replace(/\./g, ''),
				displayName: constants.emptyProjectTypeDisplayName,
				description: constants.emptyProjectTypeDescription,
				icon: IconPathHelper.colorfulSqlProject,
				targetPlatforms: Array.from(constants.targetPlatformToVersion.keys()),
				defaultTargetPlatform: constants.defaultTargetPlatform,
				sdkStyleOption: true,
				sdkStyleLearnMoreUrl: constants.sdkLearnMoreUrl
			}
		];
	}

	/**
	 * Create a project
	 * @param name name of the project
	 * @param location the parent directory
	 * @param projectTypeId the ID of the project/template
	 * @param targetPlatform the target platform of the project
	 * @param sdkStyle whether project is sdk-style. Default is false
	 * @param configureDefaultBuild whether to configure default build. Default is false
	 * @returns Uri of the newly created project file
	 */
	public async createProject(name: string, location: vscode.Uri, projectTypeId: string, targetPlatform?: sqldbproj.SqlTargetPlatform, sdkStyle: boolean = false, configureDefaultBuild: boolean = false): Promise<vscode.Uri> {
		if (!targetPlatform) {
			const projectType = this.supportedProjectTypes.find(x => x.id === projectTypeId);
			if (projectType && projectType.defaultTargetPlatform) {
				targetPlatform = projectType.defaultTargetPlatform as sqldbproj.SqlTargetPlatform;
			}
		}
		const projectFile = await this.projectController.createNewProject({
			newProjName: name,
			folderUri: location,
			projectTypeId: projectTypeId,
			configureDefaultBuild: configureDefaultBuild,
			targetPlatform: targetPlatform,
			sdkStyle: sdkStyle
		});

		return vscode.Uri.file(projectFile);
	}

	/**
	 * Opens and loads a .sqlproj file
	 */
	public openProject(projectFilePath: string): Promise<sqldbproj.ISqlProject> {
		return Project.openProject(projectFilePath, true, true);
	}

	public addItemPrompt(project: sqldbproj.ISqlProject, relativeFilePath: string, options?: sqldbproj.AddItemOptions): Promise<void> {
		return this.projectController.addItemPrompt(project, relativeFilePath, options);
	}

	/**
	 * Gets the project actions to be placed on the dashboard toolbar
	 */
	public get projectToolbarActions(): (dataworkspace.IProjectAction | dataworkspace.IProjectActionGroup)[] {
		const addItemAction: dataworkspace.IProjectAction = {
			id: constants.addItemAction,
			icon: IconPathHelper.add,
			run: (treeItem: dataworkspace.WorkspaceTreeItem) => this.projectController.addItemPromptFromNode(treeItem)
		};

		const schemaCompareAction: dataworkspace.IProjectAction = {
			id: constants.schemaCompareAction,
			icon: IconPathHelper.schemaCompare,
			run: (treeItem: dataworkspace.WorkspaceTreeItem) => this.projectController.schemaCompare(treeItem)
		};

		const buildAction: dataworkspace.IProjectAction = {
			id: constants.buildAction,
			icon: IconPathHelper.build,
			run: (treeItem: dataworkspace.WorkspaceTreeItem) => this.projectController.buildProject(treeItem)
		};

		const publishAction: dataworkspace.IProjectAction = {
			id: constants.publishAction,
			icon: IconPathHelper.publish,
			run: (treeItem: dataworkspace.WorkspaceTreeItem) => this.projectController.publishProjectDialog(treeItem)
		};

		const changeTargetPlatformAction: dataworkspace.IProjectAction = {
			id: constants.changeTargetPlatformAction,
			icon: IconPathHelper.targetPlatform,
			run: (treeItem: dataworkspace.WorkspaceTreeItem) => this.projectController.changeTargetPlatform(treeItem)
		};

		let group: dataworkspace.IProjectActionGroup = { actions: [addItemAction, schemaCompareAction, buildAction, publishAction] };

		return [group, changeTargetPlatformAction];
	}

	/**
	 * Gets the data to be displayed in the project dashboard.
	 * Dashboard is not used in VS Code, so this returns empty.
	 */
	public getDashboardComponents(_projectFile: string): dataworkspace.IDashboardTable[] {
		return [];
	}

	public openSqlNewProjectDialog(allowedTargetPlatforms?: sqldbproj.SqlTargetPlatform[]): Promise<vscode.Uri | undefined> {
		let targetPlatforms = Array.from(constants.targetPlatformToVersion.keys());
		if (allowedTargetPlatforms) {
			targetPlatforms = targetPlatforms.filter(p => allowedTargetPlatforms.toString().includes(p));
		}

		const projectUri = getDataWorkspaceExtensionApi().openSpecificProjectNewProjectDialog();
		return projectUri;
	}

	/**
	 * Gets the list of .sql scripts contained in a project
	 * @param projectFilePath
	 */
	public getProjectScriptFiles(projectFilePath: string): Promise<string[]> {
		return this.projectController.getProjectScriptFiles(projectFilePath);
	}

	/**
	 * Gets the Database Schema Provider version for a SQL project
	 */
	public getProjectDatabaseSchemaProvider(projectFilePath: string): Promise<string> {
		return this.projectController.getProjectDatabaseSchemaProvider(projectFilePath);
	}

	public generateProjectFromOpenApiSpec(options?: sqldbproj.GenerateProjectFromOpenApiSpecOptions): Promise<sqldbproj.ISqlProject | undefined> {
		return this.projectController.generateProjectFromOpenApiSpec(options);
	}

}
