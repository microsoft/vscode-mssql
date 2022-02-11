/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import SqlToolsServiceClient from '../languageservice/serviceclient';
import * as vscode from 'vscode';
import * as mssql from 'vscode-mssql';
import * as azureFunctionsContracts from '../models/contracts/azureFunctions/azureFunctionsContracts';
import * as azureFunctionUtils from '../azureFunction/azureFunctionUtils';
import * as constants from '../constants/constants';
import { generateQuotedFullName } from '../utils/utils';
import * as LocalizedConstants from '../constants/localizedConstants';

export const hostFileName: string = 'host.json';

/**
 * Adds SQL Bindings to generated Azure Functions in a file
 */
export class AzureFunctionsService implements mssql.IAzureFunctionsService {

	constructor(private _client: SqlToolsServiceClient) { }

	/**
	 * Adds a SQL Binding to a specified Azure function in a file
	 * @param bindingType Type of SQL Binding
	 * @param filePath Path of the file where the Azure Functions are
	 * @param functionName Name of the function where the SQL Binding is to be added
	 * @param objectName Name of Object for the SQL Query
	 * @param connectionStringSetting Setting for the connection string
	 * @returns
	 */
	addSqlBinding(
		bindingType: mssql.BindingType,
		filePath: string,
		functionName: string,
		objectName: string,
		connectionStringSetting: string
	): Thenable<mssql.ResultStatus> {
		const params: mssql.AddSqlBindingParams = {
			bindingType: bindingType,
			filePath: filePath,
			functionName: functionName,
			objectName: objectName,
			connectionStringSetting: connectionStringSetting
		};

		return this._client.sendRequest(azureFunctionsContracts.AddSqlBindingRequest.type, params);
	}

	/**
	 * Gets the names of the Azure functions in the file
	 * @param filePath Path of the file to get the Azure functions
	 * @returns array of names of Azure functions in the file
	 */
	getAzureFunctions(filePath: string): Thenable<mssql.GetAzureFunctionsResult> {
		const params: mssql.GetAzureFunctionsParams = {
			filePath: filePath
		};

		return this._client.sendRequest(azureFunctionsContracts.GetAzureFunctionsRequest.type, params);
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
			title: LocalizedConstants.functionNameTitle,
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
		await this.addSqlBinding(
			mssql.BindingType.input,
			functionFile,
			functionName,
			objectName,
			constants.sqlConnectionString
		);

		azureFunctionUtils.overwriteAzureFunctionMethodBody(functionFile);
	}
}
