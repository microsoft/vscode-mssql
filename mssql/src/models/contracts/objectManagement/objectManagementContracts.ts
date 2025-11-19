/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";
import type * as mssql from "vscode-mssql";

// Request Types
export namespace InitializeViewRequest {
    export const type = new RequestType<
        InitializeViewRequestParams,
        mssql.ObjectManagement.ObjectViewInfo<mssql.ObjectManagement.SqlObject>,
        void,
        void
    >("objectManagement/initializeView");
}

export interface InitializeViewRequestParams {
    connectionUri: string;
    database: string;
    contextId: string;
    isNewObject: boolean;
    objectType: string;
    parentUrn: string;
    objectUrn?: string;
}

export namespace SaveObjectRequest {
    export const type = new RequestType<SaveObjectRequestParams, void, void, void>(
        "objectManagement/save",
    );
}

export interface SaveObjectRequestParams {
    contextId: string;
    object: mssql.ObjectManagement.SqlObject;
}

export namespace ScriptObjectRequest {
    export const type = new RequestType<ScriptObjectRequestParams, string, void, void>(
        "objectManagement/script",
    );
}

export interface ScriptObjectRequestParams {
    contextId: string;
    object: mssql.ObjectManagement.SqlObject;
}

export namespace DisposeViewRequest {
    export const type = new RequestType<DisposeViewRequestParams, void, void, void>(
        "objectManagement/disposeView",
    );
}

export interface DisposeViewRequestParams {
    contextId: string;
}

export namespace RenameObjectRequest {
    export const type = new RequestType<RenameObjectRequestParams, void, void, void>(
        "objectManagement/rename",
    );
}

export interface RenameObjectRequestParams {
    connectionUri: string;
    newName: string;
    objectUrn: string;
    objectType: mssql.ObjectManagement.NodeType;
}

export namespace DropObjectRequest {
    export const type = new RequestType<DropObjectRequestParams, void, void, void>(
        "objectManagement/drop",
    );
}

export interface DropObjectRequestParams {
    connectionUri: string;
    objectUrn: string;
    objectType: mssql.ObjectManagement.NodeType;
}

export namespace SearchObjectRequest {
    export const type = new RequestType<
        SearchObjectRequestParams,
        mssql.ObjectManagement.SearchResultItem[],
        void,
        void
    >("objectManagement/search");
}

export interface SearchObjectRequestParams {
    contextId: string;
    searchText: string | undefined;
    schema: string | undefined;
    objectTypes: mssql.ObjectManagement.NodeType[];
}

export namespace DetachDatabaseRequest {
    export const type = new RequestType<DetachDatabaseRequestParams, string, void, void>(
        "objectManagement/detachDatabase",
    );
}

export interface DetachDatabaseRequestParams {
    connectionUri: string;
    database: string;
    dropConnections: boolean;
    updateStatistics: boolean;
    generateScript: boolean;
}

export namespace DropDatabaseRequest {
    export const type = new RequestType<DropDatabaseRequestParams, string, void, void>(
        "objectManagement/dropDatabase",
    );
}

export interface DropDatabaseRequestParams {
    connectionUri: string;
    database: string;
    dropConnections: boolean;
    deleteBackupHistory: boolean;
    generateScript: boolean;
}

export namespace AttachDatabaseRequest {
    export const type = new RequestType<AttachDatabaseRequestParams, string, void, void>(
        "objectManagement/attachDatabase",
    );
}

export interface AttachDatabaseRequestParams {
    connectionUri: string;
    databases: mssql.DatabaseFileData[];
    generateScript: boolean;
}

export namespace GetDataFolderRequest {
    export const type = new RequestType<GetDataFolderRequestParams, string, void, void>(
        "admin/getdatafolder",
    );
}

export interface GetDataFolderRequestParams {
    connectionUri: string;
}

export namespace GetBackupFolderRequest {
    export const type = new RequestType<GetBackupFolderRequestParams, string, void, void>(
        "admin/getbackupfolder",
    );
}

export interface GetBackupFolderRequestParams {
    connectionUri: string;
}

export namespace BackupDatabaseRequest {
    export const type = new RequestType<
        BackupDatabaseRequestParams,
        mssql.BackupResponse,
        void,
        void
    >("backup/backup");
}

export interface BackupDatabaseRequestParams {
    ownerUri: string;
    backupInfo: mssql.BackupInfo;
    taskExecutionMode: mssql.TaskExecutionMode;
}

export namespace GetAssociatedFilesRequest {
    export const type = new RequestType<GetAssociatedFilesRequestParams, string[], void, void>(
        "admin/getassociatedfiles",
    );
}

export interface GetAssociatedFilesRequestParams {
    connectionUri: string;
    primaryFilePath: string;
}

export namespace PurgeQueryStoreDataRequest {
    export const type = new RequestType<PurgeQueryStoreDataRequestParams, void, void, void>(
        "objectManagement/purgeQueryStoreData",
    );
}

export interface PurgeQueryStoreDataRequestParams {
    connectionUri: string;
    database: string;
}

export namespace CreateCredentialRequest {
    export const type = new RequestType<CreateCredentialRequestParams, void, void, void>(
        "objectManagement/createCredentialRequest",
    );
}

export interface CreateCredentialRequestParams {
    credentialInfo: mssql.CredentialInfo;
    connectionUri: string;
}

export namespace GetCredentialNamesRequest {
    export const type = new RequestType<GetCredentialNamesRequestParams, string[], void, void>(
        "objectManagement/getCredentialNamesRequest",
    );
}

export interface GetCredentialNamesRequestParams {
    connectionUri: string;
}
