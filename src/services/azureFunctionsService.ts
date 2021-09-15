/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import SqlToolsServiceClient from '../languageservice/serviceclient';
import * as mssql from 'vscode-mssql';
import * as azureFunctionsContracts from '../models/contracts/azureFunctions/azureFunctionsContracts';

export const hostFileName: string = 'host.json';

/**
 * Adds SQL Bindings to generated Azure Functions in a file
 */
export class AzureFunctionsService implements mssql.IAzureFunctionsService {

    constructor(private _client: SqlToolsServiceClient) { }

    /**
     *
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
}
