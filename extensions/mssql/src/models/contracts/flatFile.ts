/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";

/**
 * General Flat File interfaces
 */
export interface Result {
    success: boolean;
    errorMessage: string;
}

export interface ColumnInfo {
    name: string;
    sqlType: string;
    isNullable: boolean;
    isInPrimaryKey?: boolean;
}

/**
 * FlatFilePreviewRequest
 */
export interface ProseDiscoveryParams {
    operationId: string;
    filePath: string;
    tableName: string;
    schemaName?: string;
    fileType?: string;
}

/**
 * ProseDiscoveryRequest
 * Gets column information and data preview for a given file
 */
export interface ProseDiscoveryResponse {
    dataPreview: string[][];
    columnInfo: ColumnInfo[];
}

export namespace ProseDiscoveryRequest {
    export const type = new RequestType<ProseDiscoveryParams, ProseDiscoveryResponse, void, void>(
        "flatfile/proseDiscovery",
    );
}

/**
 * ChangeColumnSettingsRequest
 */
export interface ChangeColumnSettingsParams {
    operationId?: string;
    index: number;
    newName?: string;
    newDataType?: string;
    newNullable?: boolean;
    newInPrimaryKey?: boolean;
}

export interface ChangeColumnSettingsResponse {
    result: Result;
}

export namespace ChangeColumnSettingsRequest {
    export const type = new RequestType<
        ChangeColumnSettingsParams,
        ChangeColumnSettingsResponse,
        void,
        void
    >("flatfile/changeColumnSettings");
}

/**
 * InsertDataRequest
 */
export interface InsertDataParams {
    operationId: string;
    ownerUri: string;
    databaseName?: string;
    batchSize: number;
}

export namespace InsertDataRequest {
    export const type = new RequestType<InsertDataParams, InsertDataResponse, void, void>(
        "flatfile/insertData",
    );
}

export interface InsertDataResponse {
    result: Result;
}

export interface DisposeSessionParams {
    operationId: string;
}

export interface DisposeSessionResponse {
    result: Result;
}

export namespace DisposeSessionRequest {
    export const type = new RequestType<DisposeSessionParams, DisposeSessionResponse, void, void>(
        "flatfile/disposeSession",
    );
}
