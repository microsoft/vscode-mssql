/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as os from 'os';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as mssql from 'vscode-mssql';
import { defaultBindingResult, defaultSqlBindingTextLines, sqlBindingResult } from '../constants/constants';
import * as LocalizedConstants from '../constants/localizedConstants';
import { AzureFunctionsService } from '../services/azureFunctionsService';
import * as azureFunctionUtils from '../azureFunction/azureFunctionUtils';
import * as constants from '../constants/constants';
import * as path from 'path';
import { executeCommand, generateQuotedFullName } from '../utils/utils';

export class AzureFunctionProjectService {

	constructor(private azureFunctionsService: AzureFunctionsService) {
	}

	public async createAzureFunction(connectionString: string, schema: string, table: string): Promise<void> {
		const azureFunctionApi = await azureFunctionUtils.getAzureFunctionsExtensionApi();
		if (!azureFunctionApi) {
			return;
		}
		let projectFile = await isAzureFunctionProjectOpen();
		if (!projectFile) {
			vscode.window.showErrorMessage(LocalizedConstants.azureFunctionsProjectMustBeOpened);
			return;
		}

		// because of an AF extension API issue, we have to get the newly created file by adding
		// a watcher: https://github.com/microsoft/vscode-azurefunctions/issues/2908
		const newFilePromise = getNewFunctionFile(projectFile);

		// get function name from user
		const functionName = await vscode.window.showInputBox({
			title: constants.functionNameTitle,
			value: table,
			ignoreFocusOut: true
		});
		if (!functionName) {
			return;
		}

		// create C# HttpTrigger
		await azureFunctionApi.createFunction({
			language: 'C#',
			templateId: 'HttpTrigger',
			functionName: functionName,
			folderPath: projectFile
		});

		// once steps are addressed we add SQL Bindings Nuget and Connection String to local.settings.json
		// and then create a new functions file
		await addNugetReferenceToProjectFile(projectFile);
		await addConnectionStringToConfig(connectionString);
		const functionFile = await newFilePromise;

		let objectName = generateQuotedFullName(schema, table);
		await this.azureFunctionsService.addSqlBinding(
			mssql.BindingType.input,
			functionFile,
			functionName,
			objectName,
			constants.sqlConnectionString
		);

		this.overwriteAzureFunctionMethodBody(functionFile);
	}

	/**
	 * Overwrites the Azure function file to include the new binding in the method body
	 * @param filePath is the path for the function file (.cs for C# functions)
	 */
	private overwriteAzureFunctionMethodBody(filePath: string): void {
		let defaultBindedFunctionText = fs.readFileSync(filePath, 'utf-8');
		// Replace default binding text
		let newValueLines = defaultBindedFunctionText.split(os.EOL);
		const defaultLineSet = new Set(defaultSqlBindingTextLines);
		let replacedValueLines = [];
		for (let defaultLine of newValueLines) {
			// Skipped lines
			if (defaultLineSet.has(defaultLine.trimStart())) {
				continue;
			} else if (defaultLine.trimStart() === defaultBindingResult) { // Result change
				replacedValueLines.push(defaultLine.replace(defaultBindingResult, sqlBindingResult));
			} else {
				// Normal lines to be included
				replacedValueLines.push(defaultLine);
			}
		}
		defaultBindedFunctionText = replacedValueLines.join(os.EOL);
		fs.writeFileSync(filePath, defaultBindedFunctionText, 'utf-8');
	}
}

/**
 * A C# Azure Functions project must be present in order to create a new Azure Function for the table
 * @returns the selected project file path or indicates to user there is no C# Azure Functions project
 */
async function isAzureFunctionProjectOpen(): Promise<string> {
	let selectedProjectFile: string | undefined = '';
	if (vscode.workspace.workspaceFolders === undefined || vscode.workspace.workspaceFolders.length === 0) {
		return selectedProjectFile;
	} else {
		const hostFiles = await getHostFile();
		const projectFiles = await getProjectFile();
		if (projectFiles !== undefined && hostFiles !== undefined) {
			// Check to see if its only a function project using host.json and project file
			let functionProjects = [];
			let count = 0;
			for (let host of hostFiles) {
				for (let project of projectFiles) {
					path.dirname(host) === path.dirname(project) ? functionProjects.push(project) && count++ : count;
				}
			}
			if (count > 1) {
				// select project to add azure function to
				selectedProjectFile = (await vscode.window.showQuickPick(projectFiles, {
					canPickMany: false,
					title: constants.selectProject,
					ignoreFocusOut: true
				}));
				return selectedProjectFile;
			} else if (count === 1) {
				// only one azure function project found
				return functionProjects[0];
			}
		}
		return;
	}
}

// gets the azure functions project file path
async function getProjectFile(): Promise<string[] | undefined> {
	const projUris = await vscode.workspace.findFiles('**/*.csproj');
	let projFiles: string[] = [];
	for (let projUri of projUris) {
		projFiles.push(projUri.fsPath);
	}
	return projFiles.length > 0 ? projFiles : undefined;
}

// gets the host file config file path
async function getHostFile(): Promise<string[] | undefined> {
	const hostUris = await vscode.workspace.findFiles('**/host.json');
	let hostFiles = [];
	for (let hostUri of hostUris) {
		hostFiles.push(hostUri.fsPath);
	}
	return hostFiles.length > 0 ? hostFiles : undefined;
}

// gets the local.settings.json file path
async function getSettingsFile(): Promise<string | undefined> {
	const settingsFiles = await vscode.workspace.findFiles('**/local.settings.json');
	return settingsFiles.length > 0 ? settingsFiles[0].fsPath : undefined;
}

// retrieves the new function file once the file is created
function getNewFunctionFile(projectFile: string): Promise<string> {
	return new Promise((resolve) => {
		const watcher = vscode.workspace.createFileSystemWatcher((
			path.dirname(projectFile), '**/*.cs'), false, true, true);
		watcher.onDidCreate((e) => {
			resolve(e.fsPath);
			watcher.dispose();
		});
	});
}

// adds the required nuget package to the project
async function addNugetReferenceToProjectFile(selectedProjectFile: string): Promise<void> {
	await executeCommand(`dotnet add ${selectedProjectFile} package ${constants.sqlExtensionPackageName} --prerelease`);
}

/**
 * Adds the Sql Connection String to the local.settings.json
 * @param connectionString of the SQL Server connection that was chosen by the user
 */
async function addConnectionStringToConfig(connectionString: string): Promise<void> {
	const settingsFile = await getSettingsFile();
	await azureFunctionUtils.setLocalAppSetting(path.dirname(settingsFile), constants.sqlConnectionString, connectionString);
}
