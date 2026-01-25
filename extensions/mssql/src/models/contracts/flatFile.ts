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
}

/**
 * FlatFilePreviewRequest
 */
export interface FlatFilePreviewParams {
    filePath: string;
    tableName: string;
    schemaName?: string;
    fileType?: string;
}

export interface FlatFilePreviewResponse {
    dataPreview: string[][];
    columnInfo: ColumnInfo[];
}

export namespace FlatFilePreviewRequest {
    export const type = new RequestType<FlatFilePreviewParams, FlatFilePreviewResponse, void, void>(
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

export interface FlatFileProvider {
    providerId?: string;

    sendFlatFilePreviewRequest(params: FlatFilePreviewParams): Thenable<FlatFilePreviewResponse>;
    sendGetColumnInfoRequest(params: GetColumnInfoParams): Thenable<GetColumnInfoResponse>;
    sendChangeColumnSettingsRequest(
        params: ChangeColumnSettingsParams,
    ): Thenable<ChangeColumnSettingsResponse>;
}

export enum FlatFileApiType {
    FlatFileProvider = "FlatFileProvider",
}
