/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import VscodeWrapper from "./vscodeWrapper";
import { ApiStatus } from "../sharedInterfaces/webview";
import * as Loc from "../constants/locConstants";
import { FormWebviewController } from "../forms/formWebviewController";
import {
    FlatFileImportFormItemSpec,
    FlatFileImportFormState,
    FlatFileImportReducers,
    FlatFileImportState,
} from "../sharedInterfaces/flatFileImport";
import {
    ChangeColumnSettingsParams,
    FlatFilePreviewParams,
    FlatFileProvider,
    GetColumnInfoParams,
} from "../models/contracts/flatFile";

/**
 * Controller for the Add Firewall Rule dialog
 */
export class FlatFileImportController extends FormWebviewController<
    FlatFileImportFormState,
    FlatFileImportState,
    FlatFileImportFormItemSpec,
    FlatFileImportReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private provider: FlatFileProvider,
    ) {
        super(
            context,
            vscodeWrapper,
            "flatFileImport",
            "flatFileImport",
            new FlatFileImportState(),
            {
                title: Loc.FlatFileImport.flatFileImportTitle,
                viewColumn: vscode.ViewColumn.One,
                iconPath: {
                    light: vscode.Uri.joinPath(context.extensionUri, "media", "database_light.svg"),
                    dark: vscode.Uri.joinPath(context.extensionUri, "media", "database_dark.svg"),
                },
            },
        );
        void this.initialize();
    }

    /**
     * Initialize the controller
     */
    private async initialize(): Promise<void> {
        const params: FlatFilePreviewParams = {
            filePath: "C:\\Users\\laurennathan\\Downloads\\customers-100.csv",
            tableName: "test",
            schemaName: "dbo",
        };
        const response = await this.provider.sendFlatFilePreviewRequest(params);
        console.log(response);
        this.registerRpcHandlers();
        this.state.loadState = ApiStatus.Loaded;
        this.updateState();
    }

    /**
     * Register reducers for handling actions from the webview
     */
    private registerRpcHandlers(): void {
        this.registerReducer("getTablePreview", async (state, payload) => {
            const params: FlatFilePreviewParams = {
                filePath: payload.filePath,
                tableName: payload.tableName,
                schemaName: payload.schemaName,
                fileType: payload.fileType,
            };
            const response = await this.provider.sendFlatFilePreviewRequest(params);
            console.log(response);
            return state;
        });

        this.registerReducer("getColumnInfo", async (state, _payload) => {
            const response = await this.provider.sendGetColumnInfoRequest(
                {} as GetColumnInfoParams,
            );
            console.log(response);
            return state;
        });

        this.registerReducer("changeColumnSettings", async (state, payload) => {
            const params: ChangeColumnSettingsParams = {
                index: payload.index,
                newName: payload.newName,
                newDataType: payload.newDataType,
                newNullable: payload.newNullable,
                newInPrimaryKey: payload.newInPrimaryKey,
            };
            const response = await this.provider.sendChangeColumnSettingsRequest(params);
            console.log(response);
            return state;
        });
    }

    async updateItemVisibility() {}

    protected getActiveFormComponents(
        state: FlatFileImportState,
    ): (keyof FlatFileImportFormState)[] {
        return Object.keys(state.formComponents) as (keyof FlatFileImportFormState)[];
    }
}
