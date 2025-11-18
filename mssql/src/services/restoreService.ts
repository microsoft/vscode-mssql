/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as mssql from "vscode-mssql";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import * as restoreContracts from "../models/contracts/restore/restoreContracts";
import { TaskExecutionMode } from "../sharedInterfaces/schemaCompare";

export class RestoreService implements mssql.IRestoreService {
    constructor(private _client: SqlToolsServiceClient) {}

    public restore(
        ownerUri: string,
        options: { [key: string]: any },
        taskExecutionMode: TaskExecutionMode,
    ): Thenable<mssql.RestoreResponse> {
        const params: mssql.RestoreParams = {
            ownerUri,
            options,
            taskExecutionMode,
        };
        return this._client.sendRequest(restoreContracts.RestoreRequest.type, params);
    }

    public getRestorePlan(
        ownerUri: string,
        options: { [key: string]: any },
        taskExecutionMode: TaskExecutionMode,
    ): Thenable<mssql.RestorePlanResponse> {
        const params: mssql.RestoreParams = {
            ownerUri,
            options,
            taskExecutionMode,
        };
        return this._client.sendRequest(restoreContracts.RestorePlanRequest.type, params);
    }

    public cancelRestorePlan(
        ownerUri: string,
        options: { [key: string]: any },
        taskExecutionMode: TaskExecutionMode,
    ): Thenable<boolean> {
        const params: mssql.RestoreParams = {
            ownerUri,
            options,
            taskExecutionMode,
        };
        return this._client.sendRequest(restoreContracts.CancelRestorePlanRequest.type, params);
    }

    public getRestoreConfigInfo(ownerUri: string): Thenable<mssql.RestoreConfigInfoResponse> {
        const params: mssql.RestoreConfigInfoRequestParams = {
            ownerUri,
        };
        return this._client.sendRequest(restoreContracts.RestoreConfigInfoRequest.type, params);
    }
}
