/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
import {
    DropDatabaseRequest,
    InitializeViewRequest,
    InitializeViewRequestParams,
    ObjectManagementSqlObject,
    ObjectManagementViewInfo,
    RenameObjectRequest,
    SaveObjectRequest,
    ScriptObjectRequest,
    DisposeViewRequest,
} from "../models/contracts/objectManagement";

export class ObjectManagementService {
    constructor(private _client: SqlToolsServiceClient) {}

    public async initializeView(
        contextId: string,
        objectType: string,
        connectionUri: string,
        database: string,
        isNewObject: boolean,
        parentUrn: string,
        objectUrn: string,
    ): Promise<ObjectManagementViewInfo<ObjectManagementSqlObject>> {
        const params: InitializeViewRequestParams = {
            connectionUri,
            contextId,
            isNewObject,
            objectType,
            database,
            parentUrn,
            objectUrn,
        };
        return this._client.sendRequest(InitializeViewRequest.type, params);
    }

    public async save(contextId: string, object: ObjectManagementSqlObject): Promise<void> {
        return this._client.sendRequest(SaveObjectRequest.type, { contextId, object });
    }

    public async script(contextId: string, object: ObjectManagementSqlObject): Promise<string> {
        return this._client.sendRequest(ScriptObjectRequest.type, { contextId, object });
    }

    public async disposeView(contextId: string): Promise<void> {
        return this._client.sendRequest(DisposeViewRequest.type, { contextId });
    }

    public async rename(
        connectionUri: string,
        objectType: string,
        objectUrn: string,
        newName: string,
    ): Promise<void> {
        return this._client.sendRequest(RenameObjectRequest.type, {
            connectionUri,
            objectType,
            objectUrn,
            newName,
        });
    }

    public async dropDatabase(
        connectionUri: string,
        database: string,
        dropConnections: boolean,
        deleteBackupHistory: boolean,
        generateScript: boolean,
    ): Promise<string> {
        return this._client.sendRequest(DropDatabaseRequest.type, {
            connectionUri,
            database,
            dropConnections,
            deleteBackupHistory,
            generateScript,
        });
    }
}
