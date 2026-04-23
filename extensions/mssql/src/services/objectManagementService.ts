/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
import {
    DropDatabaseRequest,
    DropDatabaseResponse,
    InitializeViewRequest,
    InitializeViewRequestParams,
    ObjectManagementSqlObject,
    ObjectManagementViewInfo,
    RenameDatabaseResponse,
    RenameObjectRequest,
    RenameDatabaseRequest,
    SaveObjectRequest,
    SaveObjectRequestResponse,
    ScriptObjectRequest,
    DisposeViewRequest,
    BackupConfigInfoRequest,
    BackupRequest,
    RestoreConfigInfoRequest,
    RestoreRequest,
    RestorePlanRequest,
    CancelRestorePlanRequest,
} from "../models/contracts/objectManagement";
import {
    BackupConfigInfoResponse,
    DefaultDatabaseInfoParams,
    BackupInfo,
    BackupParams,
    BackupResponse,
} from "../sharedInterfaces/backup";
import {
    RestoreConfigInfoResponse,
    RestoreParams,
    RestorePlanResponse,
    RestoreResponse,
} from "../sharedInterfaces/restore";
import { TaskExecutionMode } from "../enums";

export class ObjectManagementService {
    constructor(private _client: SqlToolsServiceClient) {}

    public async initializeView(
        contextId: string,
        objectType: string,
        connectionUri: string,
        database: string,
        isNewObject: boolean,
        parentUrn: string,
        objectUrn?: string,
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

    public async save(
        contextId: string,
        object: ObjectManagementSqlObject,
    ): Promise<SaveObjectRequestResponse> {
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

    public async renameDatabase(
        connectionUri: string,
        database: string,
        newName: string,
        dropConnections: boolean,
        generateScript: boolean,
    ): Promise<RenameDatabaseResponse> {
        return this._client.sendRequest(RenameDatabaseRequest.type, {
            connectionUri,
            database,
            newName,
            dropConnections,
            generateScript,
        });
    }

    public async dropDatabase(
        connectionUri: string,
        database: string,
        dropConnections: boolean,
        deleteBackupHistory: boolean,
        generateScript: boolean,
    ): Promise<DropDatabaseResponse> {
        return this._client.sendRequest(DropDatabaseRequest.type, {
            connectionUri,
            database,
            dropConnections,
            deleteBackupHistory,
            generateScript,
        });
    }

    async getBackupConfigInfo(connectionUri: string): Promise<BackupConfigInfoResponse> {
        try {
            let params: DefaultDatabaseInfoParams = {
                ownerUri: connectionUri,
            };
            return await this._client.sendRequest(BackupConfigInfoRequest.type, params);
        } catch (e) {
            this._client.logger.error(e);
            throw e;
        }
    }

    async backupDatabase(
        connectionUri: string,
        backupInfo: BackupInfo,
        taskMode: TaskExecutionMode,
    ): Promise<BackupResponse> {
        try {
            let params: BackupParams = {
                ownerUri: connectionUri,
                BackupInfo: backupInfo,
                taskExecutionMode: taskMode,
            };
            return await this._client.sendRequest(BackupRequest.type, params);
        } catch (e) {
            this._client.logger.error(e);
            throw e;
        }
    }

    async getRestoreConfigInfo(connectionUri: string): Promise<RestoreConfigInfoResponse> {
        try {
            let params: DefaultDatabaseInfoParams = {
                ownerUri: connectionUri,
            };
            return await this._client.sendRequest(RestoreConfigInfoRequest.type, params);
        } catch (e) {
            this._client.logger.error(e);
            throw e;
        }
    }

    async getRestorePlan(restoreParams: RestoreParams): Promise<RestorePlanResponse> {
        try {
            return await this._client.sendRequest(RestorePlanRequest.type, restoreParams);
        } catch (e) {
            this._client.logger.error(e);
            throw e;
        }
    }

    async cancelRestorePlan(restoreParams: RestoreParams): Promise<boolean> {
        try {
            return await this._client.sendRequest(CancelRestorePlanRequest.type, restoreParams);
        } catch (e) {
            this._client.logger.error(e);
            throw e;
        }
    }

    async restoreDatabase(restoreParams: RestoreParams): Promise<RestoreResponse> {
        try {
            return await this._client.sendRequest(RestoreRequest.type, restoreParams);
        } catch (e) {
            this._client.logger.error(e);
            throw e;
        }
    }
}
