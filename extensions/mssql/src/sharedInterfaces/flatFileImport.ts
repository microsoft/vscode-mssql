/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApiStatus } from "./webview";
import { FormContextProps, FormItemSpec, FormReducers, FormState } from "./form";
import { ChangeColumnSettingsParams, ProseDiscoveryResponse } from "../models/contracts/flatFile";

export class FlatFileImportState implements FormState<
    FlatFileImportFormState,
    FlatFileImportState,
    FlatFileImportFormItemSpec
> {
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
    currentStep: FlatFileStepType = FlatFileStepType.Form;
}

export interface FlatFileImportFormState {
    databaseName: string;
    flatFilePath: string;
    tableName: string;
    tableSchema: string;
}

export interface FlatFileImportFormItemSpec extends FormItemSpec<
    FlatFileImportFormState,
    FlatFileImportState,
    FlatFileImportFormItemSpec
> {
    componentWidth: string;
}

export interface FlatFileImportProvider extends FormContextProps<FlatFileImportFormState> {
    getTablePreview: (filePath: string, tableName: string, schemaName?: string) => void;

    setColumnChanges: (columnChanges: ChangeColumnSettingsParams[]) => void;

    importData: () => void;

    openVSCodeFileBrowser: () => void;

    resetState: (resetType: FlatFileStepType) => void;

    setStep: (step: FlatFileStepType) => void;

    dispose: () => void;
}

export interface FlatFileImportReducers extends FormReducers<FlatFileImportFormState> {
    getTablePreview: {
        filePath: string;
        tableName: string;
        schemaName?: string;
    };
    setColumnChanges: {
        columnChanges: ChangeColumnSettingsParams[];
    };
    importData: {};
    openVSCodeFileBrowser: {};
    resetState: {
        resetType: FlatFileStepType;
    };
    setStep: { step: FlatFileStepType };
    dispose: {};
}

export type ColumnChanges = ChangeColumnSettingsParams;

export enum FlatFileStepType {
    ImportData = "importData",
    ColumnChanges = "columnChanges",
    TablePreview = "tablePreview",
    Form = "form",
}
