/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    DropDatabaseViewModel,
    ObjectManagementActionParams,
    ObjectManagementActionResult,
    ObjectManagementDialogType,
} from "../sharedInterfaces/objectManagement";
import * as Constants from "../constants/constants";
import * as LocConstants from "../constants/locConstants";
import { ObjectManagementService } from "../services/objectManagementService";
import { getErrorMessage } from "../utils/utils";
import VscodeWrapper from "./vscodeWrapper";
import { ObjectManagementWebviewController } from "./objectManagementWebviewController";

interface DropDatabaseViewInfo {
    objectInfo: { [key: string]: unknown };
}

export class DropDatabaseWebviewController extends ObjectManagementWebviewController {
    private _databaseNameForDrop = "";
    private _objectInfo: { [key: string]: unknown } | undefined;

    public constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        objectManagementService: ObjectManagementService,
        connectionUri: string,
        serverName: string,
        databaseName?: string,
        parentUrn?: string,
        objectUrn?: string,
        dialogTitle?: string,
        webviewTitle?: string,
    ) {
        super(
            context,
            vscodeWrapper,
            objectManagementService,
            ObjectManagementDialogType.DropDatabase,
            dialogTitle ?? LocConstants.dropDatabaseDialogTitle,
            webviewTitle ?? LocConstants.dropDatabaseWebviewTitle,
            {
                light: "dropDatabase_light.svg",
                dark: "dropDatabase_dark.svg",
            },
            "dropDatabaseDialog",
            connectionUri,
            serverName,
            databaseName,
            parentUrn,
            objectUrn,
        );

        this._databaseNameForDrop = databaseName ?? "";
        this.start();
    }

    protected get helpLink(): string {
        return Constants.dropDatabaseHelpLink;
    }

    protected async initializeDialog(): Promise<void> {
        try {
            const viewInfo = this.asViewInfo(
                await this.objectManagementService.initializeView(
                    this.contextId,
                    Constants.databaseString,
                    this.connectionUri,
                    this.databaseName || Constants.defaultDatabase,
                    false,
                    this.parentUrn ?? "Server",
                    this.objectUrn,
                ),
            );

            this._objectInfo = viewInfo.objectInfo as { [key: string]: unknown };
            const viewModel: DropDatabaseViewModel = {
                serverName: this.serverName,
                databaseName:
                    (this._objectInfo?.name as string | undefined) ?? this.databaseName ?? "",
                owner: this._objectInfo?.owner as string | undefined,
                status: this._objectInfo?.status as string | undefined,
            };

            this._databaseNameForDrop = viewModel.databaseName;
            this.updateWebviewState({
                viewModel: {
                    dialogType: ObjectManagementDialogType.DropDatabase,
                    model: viewModel,
                },
                isLoading: false,
            });
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            this.logger.error(`Drop database initialization failed: ${errorMessage}`);
            this.updateWebviewState({
                viewModel: {
                    dialogType: ObjectManagementDialogType.DropDatabase,
                    model: {
                        serverName: this.serverName,
                        databaseName: this.databaseName ?? "",
                    },
                },
                errorMessage,
                isLoading: false,
            });
        }
    }

    protected async handleSubmit(
        params: ObjectManagementActionParams["params"],
    ): Promise<ObjectManagementActionResult> {
        const typedParams = params as { dropConnections: boolean; deleteBackupHistory: boolean };
        try {
            const dropResponse = await this.objectManagementService.dropDatabase(
                this.connectionUri,
                this._databaseNameForDrop,
                typedParams.dropConnections,
                typedParams.deleteBackupHistory,
                false,
            );

            if (dropResponse.errorMessage) {
                return {
                    success: false,
                    errorMessage: dropResponse.errorMessage,
                    taskId: dropResponse.taskId,
                };
            }

            if (!dropResponse.taskId) {
                return {
                    success: false,
                    errorMessage: LocConstants.msgObjectManagementUnknownDialog,
                };
            }

            await this.disposeView();
            this.closeDialog(this._databaseNameForDrop);
            return { success: true, taskId: dropResponse.taskId };
        } catch (error) {
            return { success: false, errorMessage: getErrorMessage(error) };
        }
    }

    protected async handleScript(
        params: ObjectManagementActionParams["params"],
    ): Promise<ObjectManagementActionResult> {
        const typedParams = params as { dropConnections: boolean; deleteBackupHistory: boolean };
        try {
            const response = await this.objectManagementService.dropDatabase(
                this.connectionUri,
                this._databaseNameForDrop,
                typedParams.dropConnections,
                typedParams.deleteBackupHistory,
                true,
            );
            const script = response.script;

            if (!script) {
                void this.vscodeWrapper.showWarningMessage(LocConstants.msgNoScriptGenerated);
                return {
                    success: false,
                    errorMessage: LocConstants.msgNoScriptGenerated,
                };
            }

            await this.openScriptInEditor(script);
            return { success: true };
        } catch (error) {
            this.logger.error(`Script generation failed: ${getErrorMessage(error)}`);
            return { success: false, errorMessage: getErrorMessage(error) };
        }
    }

    private asViewInfo(viewInfo: unknown): DropDatabaseViewInfo {
        return viewInfo as DropDatabaseViewInfo;
    }
}
