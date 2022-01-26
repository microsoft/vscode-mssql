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
import * as cp from 'child_process';

const sqlBindingNugetSource = 'https://www.myget.org/F/azure-appservice/api/v3/index.json';
const sqlBindingPackageName = 'Microsoft.Azure.WebJobs.Extensions.Sql';
export class AzureFunctionProjectService {

	constructor(private azureFunctionsService: AzureFunctionsService) {
	}

	public async createAzureFunction(connectionString: string, schema: string, table: string): Promise<void> {
		const azureFunctionApi = await azureFunctionUtils.getAzureFunctionsExtensionApi();
		if (!azureFunctionApi) {
			return;
		}
		if (!await isAzureFunctionProjectOpen()) {
			vscode.window.showErrorMessage(LocalizedConstants.azureFunctionsProjectMustBeOpened);
			return;
		}

		// because of an AF extension API issue, we have to get the newly created file by adding
		// a watcher: https://github.com/microsoft/vscode-azurefunctions/issues/2908
		const newFilePromise = getNewFunctionFile();

		// get function name from user
		const functionName = await vscode.window.showInputBox({
			title: constants.functionNameTitle,
			value: table
		});

		// create C# HttpTrigger
		await azureFunctionApi.createFunction({
			language: 'C#',
			templateId: 'HttpTrigger',
			functionName: functionName
		});

		// once steps are addressed we add SQL Bindings Nuget and Connection String to local.settings.json
		// and then create a new functions file
		await addNugetReferenceToProjectFile();
		await addConnectionStringToConfig(connectionString);
		const functionFile = await newFilePromise;


		await this.azureFunctionsService.addSqlBinding(
			mssql.BindingType.input,
			functionFile,
			functionName,
			'[' + schema + ']' + '.' + '[' + table + ']',
			constants.sqlConnectionString
		);

		this.refactorAzureFunction(functionFile);
	}
	/**
	 * Refactors the Azure function file to include the sql binding specific function
	 * @param filePath is the path for the function file (.cs for C# functions)
	 */
	private refactorAzureFunction(filePath: string): void {
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

// A C# Azure Functions project must be present in order to create a new Azure Function for the table
async function isAzureFunctionProjectOpen(): Promise<boolean> {
	if (vscode.workspace.workspaceFolders === undefined || vscode.workspace.workspaceFolders.length === 0) {
		return false;
	}
	const projFile = await getProjectFile();
	const hostFile = await getHostFile();
	return projFile !== undefined && hostFile !== undefined;
}

// gets the azure functions project file path
async function getProjectFile(): Promise<string | undefined> {
	const projFiles = await vscode.workspace.findFiles('**/*.csproj');
	return projFiles.length > 0 ? projFiles[0].fsPath : undefined;
}

// gets the host file config file path
async function getHostFile(): Promise<string | undefined> {
	const hostFiles = await vscode.workspace.findFiles('**/host.json');
	return hostFiles.length > 0 ? hostFiles[0].fsPath : undefined;
}

// gets the local.settings.json file path
async function getSettingsFile(): Promise<string | undefined> {
	const settingsFiles = await vscode.workspace.findFiles('**/local.settings.json');
	return settingsFiles.length > 0 ? settingsFiles[0].fsPath : undefined;
}

// retrieves the new function file once the file is created
function getNewFunctionFile(): Promise<string> {
	return new Promise((resolve) => {
		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(
			vscode.workspace.workspaceFolders[0], '**/*.cs'), false, true, true);
		watcher.onDidCreate((e) => {
			resolve(e.fsPath);
			watcher.dispose();
		});
	});
}

// adds the required nuget package to the project
async function addNugetReferenceToProjectFile(): Promise<void> {
	// Make sure the nuget source is added
	const currentSources = await executeCommand('dotnet nuget list source');
	if (currentSources.indexOf(sqlBindingNugetSource) === -1) {
		await executeCommand(`dotnet nuget add source ${sqlBindingNugetSource}`);
	}
	const projFile = await getProjectFile();
	await executeCommand(`dotnet add package ${sqlBindingPackageName} --prerelease`, path.dirname(projFile));
}

// adds the Sql Connection String to the local.settings.json
async function addConnectionStringToConfig(connectionString: string): Promise<void> {
	const settingsFile = await getSettingsFile();
	await azureFunctionUtils.setLocalAppSetting(path.dirname(settingsFile), constants.sqlConnectionString, connectionString);
}

async function executeCommand(command: string, cwd?: string): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		cp.exec(command, { maxBuffer: 500 * 1024, cwd: cwd }, (error: Error, stdout: string, stderr: string) => {
			if (error) {
				reject(error);
				return;
			}
			if (stderr && stderr.length > 0) {
				reject(new Error(stderr));
				return;
			}
			resolve(stdout);
		});
	});
}
