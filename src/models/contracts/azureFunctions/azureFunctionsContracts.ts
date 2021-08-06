/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { RequestType } from 'vscode-languageclient';
import * as mssql from 'vscode-mssql';

export namespace AddSqlBindingRequest {
    export const type = new RequestType<mssql.AddSqlBindingParams, mssql.ResultStatus, void, void>('azureFunctions/sqlBinding');
}
