/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as constants from '../constants/constants';
import * as LocalizedConstants from '../constants/localizedConstants';
// https://github.com/microsoft/vscode-azurefunctions/blob/main/src/vscode-azurefunctions.api.d.ts
import { AzureFunctionsExtensionApi } from '../../typings/vscode-azurefunctions.api';
// https://github.com/microsoft/vscode-azuretools/blob/main/ui/api.d.ts
import { AzureExtensionApiProvider } from '../../typings/vscode-azuretools.api';
import { executeCommand } from '../utils/utils';

/**
 * Represents the settings in an Azure function project's local.settings.json file
 */
export interface ILocalSettingsJson {
	IsEncrypted?: boolean;
	Values?: { [key: string]: string };
	Host?: { [key: string]: string };
	ConnectionStrings?: { [key: string]: string };
}

/**
 * copied and modified from vscode-azurefunctions extension
 * https://github.com/microsoft/vscode-azurefunctions/blob/main/src/funcConfig/local.settings.ts
 * @param localSettingsPath full path to local.settings.json
 * @returns settings in local.settings.json. If no settings are found, returns default "empty" settings
 */
export async function getLocalSettingsJson(localSettingsPath: string): Promise<ILocalSettingsJson> {
	if (await fs.existsSync(localSettingsPath)) {
		const data: string = (fs.readFileSync(localSettingsPath)).toString();
		try {
			return JSON.parse(data);
		} catch (error) {
			console.log(error);
			throw new Error(constants.failedToParse(error.message));
		}
	}

	return {
		IsEncrypted: false // Include this by default otherwise the func cli assumes settings are encrypted and fails to run
	};
}

/**
 * Adds a new setting to a project's local.settings.json file
 * modified from setLocalAppSetting code from vscode-azurefunctions extension
 * @param projectFolder full path to project folder
 * @param key Key of the new setting
 * @param value Value of the new setting
 * @returns true if successful adding the new setting, false if unsuccessful
 */
export async function setLocalAppSetting(projectFolder: string, key: string, value: string): Promise<boolean> {
	const localSettingsPath: string = path.join(projectFolder, constants.azureFunctionLocalSettingsFileName);
	const settings: ILocalSettingsJson = await getLocalSettingsJson(localSettingsPath);

	settings.Values = settings.Values || {};
	if (settings.Values[key] === value) {
		// don't do anything if it's the same as the existing value
		return true;
	} else if (settings.Values[key]) {
		const result = await vscode.window.showWarningMessage(constants.settingAlreadyExists(key), { modal: true }, constants.yesString);
		if (result !== constants.yesString) {
			// key already exists and user doesn't want to overwrite it
			return false;
		}
	}

	settings.Values[key] = value;
	fs.promises.writeFile(localSettingsPath, JSON.stringify(settings, undefined, 2));

	return true;
}

export async function getAzureFunctionsExtensionApi(): Promise<AzureFunctionsExtensionApi | undefined> {
	const apiProvider = await vscode.extensions.getExtension(constants.azureFunctionsExtensionName)?.activate() as AzureExtensionApiProvider;
	const azureFunctionApi = apiProvider.getApi<AzureFunctionsExtensionApi>('*');
	if (azureFunctionApi) {
		return azureFunctionApi;
	} else {
		vscode.window.showErrorMessage(LocalizedConstants.azureFunctionsExtensionNotInstalled);
		return undefined;
	}
}

/**
 * Overwrites the Azure function methods body to work with the binding
 * @param filePath is the path for the function file (.cs for C# functions)
 */
export function overwriteAzureFunctionMethodBody(filePath: string): void {
	let defaultBindedFunctionText = fs.readFileSync(filePath, 'utf-8');
	// Replace default binding text
	let newValueLines = defaultBindedFunctionText.split(os.EOL);
	const defaultFunctionTextToSkip = new Set(constants.defaultSqlBindingTextLines);
	let replacedValueLines = [];
	for (let defaultLine of newValueLines) {
		// Skipped lines
		if (defaultFunctionTextToSkip.has(defaultLine.trimStart())) {
			continue;
		} else if (defaultLine.trimStart() === constants.defaultBindingResult) { // Result change
			replacedValueLines.push(defaultLine.replace(constants.defaultBindingResult, constants.sqlBindingResult));
		} else {
			// Normal lines to be included
			replacedValueLines.push(defaultLine);
		}
	}
	defaultBindedFunctionText = replacedValueLines.join(os.EOL);
	fs.writeFileSync(filePath, defaultBindedFunctionText, 'utf-8');
}

/**
 * Gets the azure function project for the user to choose from a list of projects files
 * If only one project is found that project is used to add the binding to
 * if no project is found, user is informed there needs to be a C# Azure Functions project
 * @returns the selected project file path
 */
export async function getAzureFunctionProject(): Promise<string | undefined> {
	let selectedProjectFile: string | undefined = '';
	if (vscode.workspace.workspaceFolders === undefined || vscode.workspace.workspaceFolders.length === 0) {
		return selectedProjectFile;
	} else {
		const projectFiles = await getAzureFunctionProjectFiles();
		if (projectFiles !== undefined) {
			if (projectFiles.length > 1) {
				// select project to add azure function to
				selectedProjectFile = (await vscode.window.showQuickPick(projectFiles, {
					canPickMany: false,
					title: constants.selectProject,
					ignoreFocusOut: true
				}));
				return selectedProjectFile;
			} else if (projectFiles.length === 1) {
				// only one azure function project found
				return projectFiles[0];
			}
		}
		return undefined;
	}
}

/**
 * Gets the azure function project files based on the host file found in the same folder
 * @returns the azure function project files paths
 */
export async function getAzureFunctionProjectFiles(): Promise<string[] | undefined> {
	let projFiles: string[] = [];
	const hostFiles = await getHostFiles();
	for (let host of hostFiles) {
		let projectFile = await vscode.workspace.findFiles('*.csproj', path.dirname(host));
		projectFile.filter(file => path.dirname(file.fsPath) === path.dirname(host) ? projFiles.push(file?.fsPath) : projFiles);
	}
	return projFiles.length > 0 ? projFiles : undefined;
}

/**
 * Gets the host files from the workspace
 * @returns the host file paths
 */
export async function getHostFiles(): Promise<string[] | undefined> {
	const hostUris = await vscode.workspace.findFiles('**/host.json');
	const hostFiles = hostUris.map(uri => uri.fsPath);
	return hostFiles.length > 0 ? hostFiles : undefined;
}

/**
 * Gets the local.settings.json file path
 * @param projectFile path of the azure function project
 * @returns the local.settings.json file path
 */
export async function getSettingsFile(projectFile: string): Promise<string | undefined> {
	return path.join(path.dirname(projectFile), 'local.settings.json');
}

/**
 * Retrieves the new function file once the file is created
 * @param projectFile is the path to the project file
 * @returns the function file path once created
 */
export function waitForNewFunctionFile(projectFile: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const watcher = vscode.workspace.createFileSystemWatcher((
			path.dirname(projectFile), '**/*.cs'), false, true, true);
		const timeout = setTimeout(async () => {
			reject(new Error(constants.timeoutError));
			watcher.dispose();
		}, 10000);
		watcher.onDidCreate((e) => {
			resolve(e.fsPath);
			watcher.dispose();
			clearTimeout(timeout);
		});
	});
}

/**
 * Adds the required nuget package to the project
 * @param selectedProjectFile is the users selected project file path
 */
export async function addNugetReferenceToProjectFile(selectedProjectFile: string): Promise<void> {
	await executeCommand(`dotnet add ${selectedProjectFile} package ${constants.sqlExtensionPackageName} --prerelease`);
}

/**
 * Adds the Sql Connection String to the local.settings.json
 * @param connectionString of the SQL Server connection that was chosen by the user
 */
export async function addConnectionStringToConfig(connectionString: string, projectFile: string): Promise<void> {
	const settingsFile = await getSettingsFile(projectFile);
	await setLocalAppSetting(path.dirname(settingsFile), constants.sqlConnectionString, connectionString);
}

