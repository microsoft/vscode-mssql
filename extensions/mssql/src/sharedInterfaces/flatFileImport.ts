/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApiStatus } from "./webview";
import { FormContextProps, FormItemSpec, FormReducers, FormState } from "./form";
import { ChangeColumnSettingsParams, ProseDiscoveryResponse } from "../models/contracts/flatFile";

export class FlatFileImportState
    implements FormState<FlatFileImportFormState, FlatFileImportState, FlatFileImportFormItemSpec>
{
    loadState: ApiStatus = ApiStatus.Loading;
    errorMessage?: string = "";
    formState: FlatFileImportFormState = {
        databaseName: "",
        flatFilePath: "",
        tableName: "",
        tableSchema: "",
    };
    formComponents: Partial<Record<keyof FlatFileImportFormState, FlatFileImportFormItemSpec>> = {};
    formErrors: string[] = [];
    serverName: string = "";
    fileType: string = "";
    isDatabase: boolean = false;
    tablePreview: ProseDiscoveryResponse | undefined = undefined;
    tablePreviewStatus: ApiStatus = ApiStatus.Loading;
    importDataStatus: ApiStatus = ApiStatus.NotStarted;
    columnChanges: ChangeColumnSettingsParams[] = [];
}

export interface FlatFileImportFormState {
    databaseName: string;
    flatFilePath: string;
    tableName: string;
    tableSchema: string;
}

export interface FlatFileImportFormItemSpec
    extends FormItemSpec<FlatFileImportFormState, FlatFileImportState, FlatFileImportFormItemSpec> {
    componentWidth: string;
}

export interface FlatFileImportProvider
    extends FormContextProps<
        FlatFileImportFormState,
        FlatFileImportState,
        FlatFileImportFormItemSpec
    > {
    getTablePreview: (
        filePath: string,
        tableName: string,
        schemaName?: string,
        fileType?: string,
    ) => void;

    getColumnInfo: () => void;

    setColumnChanges: (columnChanges: ChangeColumnSettingsParams[]) => void;

    changeColumnSettings: (
        index: number,
        newName?: string,
        newDataType?: string,
        newNullable?: boolean,
        newIsPrimaryKey?: boolean,
    ) => void;

    importData: () => void;

    openVSCodeFileBrowser: () => void;
}

export interface FlatFileImportReducers extends FormReducers<FlatFileImportFormState> {
    getTablePreview: {
        filePath: string;
        tableName: string;
        schemaName?: string;
        fileType?: string;
    };
    getColumnInfo: {};
    setColumnChanges: {
        columnChanges: ChangeColumnSettingsParams[];
    };
    changeColumnSettings: {
        index: number;
        newName?: string;
        newDataType?: string;
        newNullable?: boolean;
        newIsPrimaryKey?: boolean;
    };
    importData: {};
    openVSCodeFileBrowser: {};
}
