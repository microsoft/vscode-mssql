/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { RequestType } from 'vscode-languageclient';
import * as mssql from 'vscode-mssql';

/**
 * Adds a SQL Binding to a specified Azure function in a file
 */
export namespace AddSqlBindingRequest {
	export const type = new RequestType<mssql.AddSqlBindingParams, mssql.ResultStatus, void, void>('azureFunctions/sqlBinding');
}

/**
 * Gets the names of the Azure functions in a file
 */
export namespace GetAzureFunctionsRequest {
	export const type = new RequestType<mssql.GetAzureFunctionsParams, mssql.GetAzureFunctionsResult, void, void>('azureFunctions/getAzureFunctions');
}
