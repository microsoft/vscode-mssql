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
    private databaseNameForDrop = "";
    private objectInfo: { [key: string]: unknown } | undefined;

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
    ) {
        super(
            context,
            vscodeWrapper,
            objectManagementService,
            ObjectManagementDialogType.DropDatabase,
            dialogTitle ?? LocConstants.dropDatabaseDialogTitle,
            "dropDatabaseDialog",
            connectionUri,
            serverName,
            databaseName,
            parentUrn,
            objectUrn,
        );

        this.databaseNameForDrop = databaseName ?? "";
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

            this.objectInfo = viewInfo.objectInfo as { [key: string]: unknown };
            const viewModel: DropDatabaseViewModel = {
                serverName: this.serverName,
                databaseName:
                    (this.objectInfo?.name as string | undefined) ?? this.databaseName ?? "",
                owner: this.objectInfo?.owner as string | undefined,
                status: this.objectInfo?.status as string | undefined,
            };

            this.databaseNameForDrop = viewModel.databaseName;
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
            await this.objectManagementService.dropDatabase(
                this.connectionUri,
                this.databaseNameForDrop,
                typedParams.dropConnections,
                typedParams.deleteBackupHistory,
                false,
            );
            await this.disposeView();
            this.closeDialog(this.databaseNameForDrop);
            return { success: true };
        } catch (error) {
            return { success: false, errorMessage: getErrorMessage(error) };
        }
    }

    protected async handleScript(
        params: ObjectManagementActionParams["params"],
    ): Promise<ObjectManagementActionResult> {
        const typedParams = params as { dropConnections: boolean; deleteBackupHistory: boolean };
        try {
            const script = await this.objectManagementService.dropDatabase(
                this.connectionUri,
                this.databaseNameForDrop,
                typedParams.dropConnections,
                typedParams.deleteBackupHistory,
                true,
            );

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
