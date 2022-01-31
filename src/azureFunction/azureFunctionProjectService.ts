/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as mssql from 'vscode-mssql';
import * as LocalizedConstants from '../constants/localizedConstants';
import { AzureFunctionsService } from '../services/azureFunctionsService';
import * as azureFunctionUtils from '../azureFunction/azureFunctionUtils';
import * as constants from '../constants/constants';
import { generateQuotedFullName } from '../utils/utils';

export class AzureFunctionProjectService {

	constructor(private azureFunctionsService: AzureFunctionsService) {
	}

	public async createAzureFunction(connectionString: string, schema: string, table: string): Promise<void> {
		const azureFunctionApi = await azureFunctionUtils.getAzureFunctionsExtensionApi();
		if (!azureFunctionApi) {
			return;
		}
		let projectFile = await azureFunctionUtils.getAzureFunctionProject();
		if (!projectFile) {
			vscode.window.showErrorMessage(LocalizedConstants.azureFunctionsProjectMustBeOpened);
			return;
		}

		// because of an AF extension API issue, we have to get the newly created file by adding
		// a watcher: https://github.com/microsoft/vscode-azurefunctions/issues/2908
		const newFilePromise = azureFunctionUtils.waitForNewFunctionFile(projectFile);

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

		await azureFunctionUtils.addNugetReferenceToProjectFile(projectFile);
		await azureFunctionUtils.addConnectionStringToConfig(connectionString, projectFile);
		const functionFile = await newFilePromise;

		let objectName = generateQuotedFullName(schema, table);
		await this.azureFunctionsService.addSqlBinding(
			mssql.BindingType.input,
			functionFile,
			functionName,
			objectName,
			constants.sqlConnectionString
		);

		azureFunctionUtils.overwriteAzureFunctionMethodBody(functionFile);
	}
}
