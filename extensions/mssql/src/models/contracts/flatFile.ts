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
    filePath: string;
    tableName: string;
    schemaName?: string;
    fileType?: string;
}

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
 * GetColumnInfoRequest
 */
export interface GetColumnInfoParams {}

export interface GetColumnInfoResponse {
    columnInfo: ColumnInfo[];
}

export namespace GetColumnInfoRequest {
    export const type = new RequestType<GetColumnInfoParams, GetColumnInfoResponse, void, void>(
        "flatfile/getColumnInfo",
    );
}

/**
 * ChangeColumnSettingsRequest
 */
export interface ChangeColumnSettingsParams {
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
    connectionString: string;
    batchSize: number;
    /**
     * For azure MFA connections we need to send the account token to establish a connection
     * from flatFile service without doing Oauth.
     */
    azureAccessToken: string | undefined;
}

export namespace InsertDataRequest {
    export const type = new RequestType<InsertDataParams, InsertDataResponse, void, void>(
        "flatfile/insertData",
    );
}

export interface InsertDataResponse {
    result: Result;
}

export interface FlatFileProvider {
    providerId?: string;

    sendProseDiscoveryRequest(params: ProseDiscoveryParams): Thenable<ProseDiscoveryResponse>;
    sendGetColumnInfoRequest(params: GetColumnInfoParams): Thenable<GetColumnInfoResponse>;
    sendChangeColumnSettingsRequest(
        params: ChangeColumnSettingsParams,
    ): Thenable<ChangeColumnSettingsResponse>;
    sendInsertDataRequest(params: InsertDataParams): Thenable<InsertDataResponse>;
}

export enum FlatFileApiType {
    FlatFileProvider = "FlatFileProvider",
}
