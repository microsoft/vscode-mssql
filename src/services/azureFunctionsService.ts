/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import SqlToolsServiceClient from '../languageservice/serviceclient';
import * as mssql from 'vscode-mssql';
import * as azureFunctionsContracts from '../models/contracts/azureFunctions/azureFunctionsContracts';

export const hostFileName: string = 'host.json';

export class AzureFunctionsService implements mssql.IAzureFunctionsService {

    constructor(private _client: SqlToolsServiceClient) { }

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
