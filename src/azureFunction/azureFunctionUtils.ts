/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fse from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import * as constants from '../constants/constants';
import * as LocalizedConstants from '../constants/localizedConstants';
import * as glob from 'fast-glob';
import * as af from '../../typings/vscode-azurefunctions.api';
import { parseJson } from '../constants/parseJson';



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
 * @param localSettingsPath full path to local.settings.json
 * @returns settings in local.settings.json. If no settings are found, returns default "empty" settings
 */
export async function getLocalSettingsJson(localSettingsPath: string): Promise<ILocalSettingsJson> {
	if (await fse.pathExists(localSettingsPath)) {
		const data: string = (await fse.readFile(localSettingsPath)).toString();
		if (/[^\s]/.test(data)) {
			try {
				return parseJson(data);
			} catch (error) {
				throw new Error(constants.failedToParse(error.message));
			}
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
	await fse.writeJson(localSettingsPath, settings, { spaces: 2 });

	return true;
}

/**
 * Adds specified package to Azure Functions project the specified file is a part of
 * @param filePath uri of file to find the containing AF project of to add package reference to
 * @param packageName package to add reference to
 * @param packageVersion optional version of package. If none, latest will be pulled in
 */
export async function addPackageToAFProjectContainingFile(fileUri: vscode.Uri, packageName: string, packageVersion?: string): Promise<void> {
	try {
		const project = await getAFProjectContainingFile(fileUri);

		// if no AF projects were found, an error gets thrown from getAFProjectContainingFile(). This check is temporary until
		// multiple AF projects in the workspace is handled. That scenario returns undefined and shows an info message telling the
		// user to make sure their project has the package reference
		if (project) {
			await this.addPackage(project, packageName, packageVersion);
		} else {
			void vscode.window.showInformationMessage(constants.addPackageReferenceMessage, constants.moreInformation).then((result) => {
				if (result === constants.moreInformation) {
					void vscode.env.openExternal(vscode.Uri.parse(constants.sqlBindingsHelpLink));
				}
			});
		}
	} catch (e) {
		await vscode.window.showErrorMessage(constants.addSqlBindingPackageError, constants.checkoutOutputMessage).then((result) => {
			if (result === constants.checkoutOutputMessage) {
				this._outputChannel.show();
			}
		});
	}
}


/**
 * Gets the Azure Functions project that contains the given file if the project is open in one of the workspace folders
 * @param filePath file that the containing project needs to be found for
 * @returns uri of project or undefined if project couldn't be found
 */
export async function getAFProjectContainingFile(fileUri: vscode.Uri): Promise<vscode.Uri | undefined> {
	// get functions csprojs in the workspace
	const projectPromises = vscode.workspace.workspaceFolders?.map(f => getAllFilesInFolder(f.uri, '.csproj')) ?? [];
	const functionsProjects = (await Promise.all(projectPromises)).reduce((prev, curr) =>
		prev.concat(curr), []).filter(p => isFunctionProject(path.dirname(p.fsPath)));

	// look for project folder containing file if there's more than one
	if (functionsProjects.length > 1) {
		// TODO: figure out which project contains the file
		// the new style csproj doesn't list all the files in the project anymore, unless the file isn't in the same folder
		// so we can't rely on using that to check
		vscode.window.showWarningMessage('Unable to find which project contains the file: ' + fileUri.fsPath);
		console.error('need to find which project contains the file ' + fileUri.fsPath);
		return undefined;
	} else if (functionsProjects.length === 0) {
		throw new Error(constants.noAzureFunctionsProjectsInWorkspace);
	} else {
		return functionsProjects[0];
	}
}


/**
 * Use 'host.json' as an indicator that this is a functions project
 * copied from verifyIsproject.ts in vscode-azurefunctions extension
 * @param folderPath functions file directory path
 * @returns whether the path for the function is exists
 */
export async function isFunctionProject(folderPath: string): Promise<boolean> {
	return fse.pathExists(path.join(folderPath, constants.hostFileName));
}

/**
 * Gets all the projects of the specified extension in the folder
 * @param folder
 * @param projectExtension project extension to filter on
 * @returns array of project uris
 */
export async function getAllFilesInFolder(folder: vscode.Uri, projectExtension: string): Promise<vscode.Uri[]> {
	// path needs to use forward slashes for glob to work
	const escapedPath = glob.escapePath(folder.fsPath.replace(/\\/g, '/'));

	// filter for projects with the specified project extension
	const projFilter = path.posix.join(escapedPath, '**', `*${projectExtension}`);

	// glob will return an array of file paths with forward slashes, so they need to be converted back if on windows
	return (await glob(projFilter)).map(p => vscode.Uri.file(path.resolve(p)));
}


export async function getAzureFunctionsExtensionApi(): Promise<af.AzureFunctionsExtensionApi | undefined> {
	const afExtension = vscode.extensions.getExtension(constants.azureFunctionsExtensionName);
	if (afExtension) {
		let azureFunctionApi = await afExtension.activate();
		if (azureFunctionApi) {
			return azureFunctionApi.getApi('*') as af.AzureFunctionsExtensionApi;
		} else {
			vscode.window.showErrorMessage(LocalizedConstants.azureFunctionsExtensionNotInstalled);
			return undefined;
		}
	}
}
