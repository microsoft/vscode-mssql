/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fse from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import * as constants from '../constants/constants';
import * as LocalizedConstants from '../constants/localizedConstants';
// https://github.com/microsoft/vscode-azuretools/blob/main/ui/api.d.ts
import { AzureFunctionsExtensionApi } from '../../typings/vscode-azurefunctions.api';
// https://github.com/microsoft/vscode-azuretools/blob/main/ui/api.d.ts
import { AzureExtensionApiProvider } from '../../typings/vscode-azuretools.api';
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
 * https://github.com/microsoft/vscode-azurefunctions/blob/main/src/funcConfig/local.settings.ts
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
