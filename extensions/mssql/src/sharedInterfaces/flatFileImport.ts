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
    errorMessage: string = "";
    fullErrorMessage: string = "";
    formState: FlatFileImportFormState = {
        databaseName: "",
        flatFilePath: "",
        tableName: "",
        tableSchema: "",
    };
    schemaLoadStatus: ApiStatus = ApiStatus.Loading;
    formComponents: Partial<Record<keyof FlatFileImportFormState, FlatFileImportFormItemSpec>> = {};
    formErrors: string[] = [];
    serverName: string = "";
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
    getTablePreview: (filePath: string, tableName: string, schemaName?: string) => void;

    getColumnInfo: () => void;

    setColumnChanges: (columnChanges: ChangeColumnSettingsParams[]) => void;

    importData: () => void;

    openVSCodeFileBrowser: () => void;

    dispose: () => void;
}

export interface FlatFileImportReducers extends FormReducers<FlatFileImportFormState> {
    getTablePreview: {
        filePath: string;
        tableName: string;
        schemaName?: string;
    };
    getColumnInfo: {};
    setColumnChanges: {
        columnChanges: ChangeColumnSettingsParams[];
    };
    importData: {};
    openVSCodeFileBrowser: {};
    dispose: {};
}
