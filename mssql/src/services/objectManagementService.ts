/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as mssql from "vscode-mssql";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import * as objectManagementContracts from "../models/contracts/objectManagement/objectManagementContracts";

export class ObjectManagementService implements mssql.IObjectManagementService {
    constructor(private _client: SqlToolsServiceClient) {}

    public async initializeView(
        contextId: string,
        objectType: mssql.ObjectManagement.NodeType,
        connectionUri: string,
        database: string,
        isNewObject: boolean,
        parentUrn: string,
        objectUrn: string,
    ): Promise<mssql.ObjectManagement.ObjectViewInfo<mssql.ObjectManagement.SqlObject>> {
        const params: objectManagementContracts.InitializeViewRequestParams = {
            connectionUri,
            contextId,
            isNewObject,
            objectType,
            database,
            parentUrn,
            objectUrn,
        };
        return this._client.sendRequest(
            objectManagementContracts.InitializeViewRequest.type,
            params,
        );
    }

    public async save(
        contextId: string,
        object: mssql.ObjectManagement.SqlObject,
    ): Promise<void> {
        const params: objectManagementContracts.SaveObjectRequestParams = {
            contextId,
            object,
        };
        return this._client.sendRequest(objectManagementContracts.SaveObjectRequest.type, params);
    }

    public async script(
        contextId: string,
        object: mssql.ObjectManagement.SqlObject,
    ): Promise<string> {
        const params: objectManagementContracts.ScriptObjectRequestParams = {
            contextId,
            object,
        };
        return this._client.sendRequest(objectManagementContracts.ScriptObjectRequest.type, params);
    }

    public async disposeView(contextId: string): Promise<void> {
        const params: objectManagementContracts.DisposeViewRequestParams = {
            contextId,
        };
        return this._client.sendRequest(
            objectManagementContracts.DisposeViewRequest.type,
            params,
        );
    }

    public async rename(
        connectionUri: string,
        objectType: mssql.ObjectManagement.NodeType,
        objectUrn: string,
        newName: string,
    ): Promise<void> {
        const params: objectManagementContracts.RenameObjectRequestParams = {
            connectionUri,
            objectUrn,
            newName,
            objectType,
        };
        return this._client.sendRequest(objectManagementContracts.RenameObjectRequest.type, params);
    }

    public async drop(
        connectionUri: string,
        objectType: mssql.ObjectManagement.NodeType,
        objectUrn: string,
    ): Promise<void> {
        const params: objectManagementContracts.DropObjectRequestParams = {
            connectionUri,
            objectUrn,
            objectType,
        };
        return this._client.sendRequest(objectManagementContracts.DropObjectRequest.type, params);
    }

    public async search(
        contextId: string,
        objectTypes: string[],
        searchText?: string,
        schema?: string,
    ): Promise<mssql.ObjectManagement.SearchResultItem[]> {
        const params: objectManagementContracts.SearchObjectRequestParams = {
            contextId,
            searchText,
            objectTypes: objectTypes as mssql.ObjectManagement.NodeType[],
            schema,
        };
        return this._client.sendRequest(objectManagementContracts.SearchObjectRequest.type, params);
    }

    public async detachDatabase(
        connectionUri: string,
        database: string,
        dropConnections: boolean,
        updateStatistics: boolean,
        generateScript: boolean,
    ): Promise<string> {
        const params: objectManagementContracts.DetachDatabaseRequestParams = {
            connectionUri,
            database,
            dropConnections,
            updateStatistics,
            generateScript,
        };
        return this._client.sendRequest(
            objectManagementContracts.DetachDatabaseRequest.type,
            params,
        );
    }

    public async attachDatabases(
        connectionUri: string,
        databases: mssql.DatabaseFileData[],
        generateScript: boolean,
    ): Promise<string> {
        const params: objectManagementContracts.AttachDatabaseRequestParams = {
            connectionUri,
            databases,
            generateScript,
        };
        return this._client.sendRequest(
            objectManagementContracts.AttachDatabaseRequest.type,
            params,
        );
    }

    public async backupDatabase(
        connectionUri: string,
        backupInfo: mssql.BackupInfo,
        taskMode: mssql.TaskExecutionMode,
    ): Promise<mssql.BackupResponse> {
        const params: objectManagementContracts.BackupDatabaseRequestParams = {
            ownerUri: connectionUri,
            backupInfo,
            taskExecutionMode: taskMode,
        };
        return this._client.sendRequest(
            objectManagementContracts.BackupDatabaseRequest.type,
            params,
        );
    }

    public async dropDatabase(
        connectionUri: string,
        database: string,
        dropConnections: boolean,
        deleteBackupHistory: boolean,
        generateScript: boolean,
    ): Promise<string> {
        const params: objectManagementContracts.DropDatabaseRequestParams = {
            connectionUri,
            database,
            dropConnections,
            deleteBackupHistory,
            generateScript,
        };
        return this._client.sendRequest(
            objectManagementContracts.DropDatabaseRequest.type,
            params,
        );
    }

    public async getDataFolder(connectionUri: string): Promise<string> {
        const params: objectManagementContracts.GetDataFolderRequestParams = {
            connectionUri,
        };
        return this._client.sendRequest(
            objectManagementContracts.GetDataFolderRequest.type,
            params,
        );
    }

    public async getBackupFolder(connectionUri: string): Promise<string> {
        const params: objectManagementContracts.GetBackupFolderRequestParams = {
            connectionUri,
        };
        return this._client.sendRequest(
            objectManagementContracts.GetBackupFolderRequest.type,
            params,
        );
    }

    public async getAssociatedFiles(
        connectionUri: string,
        primaryFilePath: string,
    ): Promise<string[]> {
        const params: objectManagementContracts.GetAssociatedFilesRequestParams = {
            connectionUri,
            primaryFilePath,
        };
        return this._client.sendRequest(
            objectManagementContracts.GetAssociatedFilesRequest.type,
            params,
        );
    }

    public async purgeQueryStoreData(connectionUri: string, database: string): Promise<void> {
        const params: objectManagementContracts.PurgeQueryStoreDataRequestParams = {
            connectionUri,
            database,
        };
        return this._client.sendRequest(
            objectManagementContracts.PurgeQueryStoreDataRequest.type,
            params,
        );
    }

    public async createCredential(
        connectionUri: string,
        credentialInfo: mssql.CredentialInfo,
    ): Promise<void> {
        const params: objectManagementContracts.CreateCredentialRequestParams = {
            connectionUri,
            credentialInfo,
        };
        return this._client.sendRequest(
            objectManagementContracts.CreateCredentialRequest.type,
            params,
        );
    }

    public async getCredentialNames(connectionUri: string): Promise<string[]> {
        const params: objectManagementContracts.GetCredentialNamesRequestParams = {
            connectionUri,
        };
        return this._client.sendRequest(
            objectManagementContracts.GetCredentialNamesRequest.type,
            params,
        );
    }
}
