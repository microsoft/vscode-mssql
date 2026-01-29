/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";

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

export namespace SaveObjectRequest {
    export const type = new RequestType<SaveObjectRequestParams, void, void, void>(
        "objectManagement/save",
    );
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

export interface DropDatabaseRequestParams {
    connectionUri: string;
    database: string;
    dropConnections: boolean;
    deleteBackupHistory: boolean;
    generateScript: boolean;
}

export namespace DropDatabaseRequest {
    export const type = new RequestType<DropDatabaseRequestParams, string, void, void>(
        "objectManagement/dropDatabase",
    );
}
