/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";
import {
    BackupParams,
    DefaultDatabaseInfoParams,
    BackupConfigInfoResponse,
    BackupResponse,
} from "../../sharedInterfaces/backup";
import {
    RestoreConfigInfoResponse,
    RestoreParams,
    RestorePlanResponse,
    RestoreResponse,
} from "../../sharedInterfaces/restore";

export interface ObjectManagementSqlObject {
    name: string;
    [key: string]: unknown;
}

export interface ObjectManagementViewInfo<T extends ObjectManagementSqlObject> {
    objectInfo: T;
}

export interface InitializeViewRequestParams {
    connectionUri: string;
    contextId: string;
    isNewObject: boolean;
    objectType: string;
    database?: string;
    parentUrn?: string;
    objectUrn?: string;
}

export namespace InitializeViewRequest {
    export const type = new RequestType<
        InitializeViewRequestParams,
        ObjectManagementViewInfo<ObjectManagementSqlObject>,
        void,
        void
    >("objectManagement/initializeView");
}

export interface SaveObjectRequestParams {
    contextId: string;
    object: ObjectManagementSqlObject;
}

export interface SaveObjectRequestResponse {
    taskId?: string;
    errorMessage?: string;
}

export namespace SaveObjectRequest {
    export const type = new RequestType<
        SaveObjectRequestParams,
        SaveObjectRequestResponse,
        void,
        void
    >("objectManagement/save");
}

export interface ScriptObjectRequestParams {
    contextId: string;
    object: ObjectManagementSqlObject;
}

export namespace ScriptObjectRequest {
    export const type = new RequestType<ScriptObjectRequestParams, string, void, void>(
        "objectManagement/script",
    );
}

export interface DisposeViewRequestParams {
    contextId: string;
}

export namespace DisposeViewRequest {
    export const type = new RequestType<DisposeViewRequestParams, void, void, void>(
        "objectManagement/disposeView",
    );
}

export interface RenameObjectRequestParams {
    connectionUri: string;
    newName: string;
    objectUrn: string;
    objectType: string;
}

export namespace RenameObjectRequest {
    export const type = new RequestType<RenameObjectRequestParams, void, void, void>(
        "objectManagement/rename",
    );
}

export interface RenameDatabaseRequestParams {
    connectionUri: string;
    database: string;
    newName: string;
    dropConnections: boolean;
    generateScript: boolean;
}

export interface RenameDatabaseResponse {
    taskId?: string;
    script?: string;
    errorMessage?: string;
}

export namespace RenameDatabaseRequest {
    export const type = new RequestType<
        RenameDatabaseRequestParams,
        RenameDatabaseResponse,
        void,
        void
    >("objectManagement/renameDatabase");
}

export interface DropDatabaseRequestParams {
    connectionUri: string;
    database: string;
    dropConnections: boolean;
    deleteBackupHistory: boolean;
    generateScript: boolean;
}

export interface DropDatabaseResponse {
    taskId?: string;
    script?: string;
    errorMessage?: string;
}

export namespace DropDatabaseRequest {
    export const type = new RequestType<
        DropDatabaseRequestParams,
        DropDatabaseResponse,
        void,
        void
    >("objectManagement/dropDatabase");
}

//#region Backup Database;
export namespace BackupRequest {
    export const type = new RequestType<BackupParams, BackupResponse, void, void>("backup/backup");
}

export namespace BackupConfigInfoRequest {
    export const type = new RequestType<
        DefaultDatabaseInfoParams,
        BackupConfigInfoResponse,
        void,
        void
    >("backup/backupconfiginfo");
}

//#endregion

// #region Restore Database
export namespace RestoreConfigInfoRequest {
    export const type = new RequestType<
        DefaultDatabaseInfoParams,
        RestoreConfigInfoResponse,
        void,
        void
    >("restore/restoreconfiginfo");
}
export namespace RestorePlanRequest {
    export const type = new RequestType<RestoreParams, RestorePlanResponse, void, void>(
        "restore/restoreplan",
    );
}

export namespace CancelRestorePlanRequest {
    export const type = new RequestType<RestoreParams, boolean, void, void>(
        "restore/cancelrestoreplan",
    );
}

export namespace RestoreRequest {
    export const type = new RequestType<RestoreParams, RestoreResponse, void, void>(
        "restore/restore",
    );
}

// #endregion
