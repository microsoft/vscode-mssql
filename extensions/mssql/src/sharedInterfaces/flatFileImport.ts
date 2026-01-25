/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApiStatus } from "./webview";
import { FormContextProps, FormItemSpec, FormReducers, FormState } from "./form";

export class FlatFileImportState
    implements FormState<FlatFileImportFormState, FlatFileImportState, FlatFileImportFormItemSpec>
{
    loadState: ApiStatus = ApiStatus.Loading;
    errorMessage?: string = "";
    // @ts-ignore
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

export interface FlatFileImportContextProps
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
    ) => Promise<void>;

    getColumnInfo: () => Promise<void>;

    changeColumnSettings: (
        index: number,
        newName?: string,
        newDataType?: string,
        newNullable?: boolean,
        newInPrimaryKey?: boolean,
    ) => Promise<void>;
}

export interface FlatFileImportReducers extends FormReducers<FlatFileImportFormState> {
    getTablePreview: {
        filePath: string;
        tableName: string;
        schemaName?: string;
        fileType?: string;
    };
    getColumnInfo: {};
    changeColumnSettings: {
        index: number;
        newName?: string;
        newDataType?: string;
        newNullable?: boolean;
        newInPrimaryKey?: boolean;
    };
}
