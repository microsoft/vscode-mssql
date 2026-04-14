/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    ObjectManagementActionParams,
    ObjectManagementActionResult,
    ObjectManagementDialogType,
    RenameDatabaseParams,
    RenameDatabaseViewModel,
} from "../sharedInterfaces/objectManagement";
import * as Constants from "../constants/constants";
import * as LocConstants from "../constants/locConstants";
import { ObjectManagementService } from "../services/objectManagementService";
import { getErrorMessage } from "../utils/utils";
import VscodeWrapper from "./vscodeWrapper";
import { ObjectManagementWebviewController } from "./objectManagementWebviewController";

interface RenameDatabaseViewInfo {
    objectInfo: { [key: string]: unknown };
}

export class RenameDatabaseWebviewController extends ObjectManagementWebviewController {
    private databaseNameForRename = "";

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
            ObjectManagementDialogType.RenameDatabase,
            dialogTitle ?? LocConstants.renameDatabaseDialogTitle,
            webviewTitle ?? LocConstants.renameDatabaseWebviewTitle,
            {
                light: "renameDatabase_light.svg",
                dark: "renameDatabase_dark.svg",
            },
            "renameDatabaseDialog",
            connectionUri,
            serverName,
            databaseName,
            parentUrn,
            objectUrn,
        );

        this.databaseNameForRename = databaseName ?? "";
        this.start();
    }

    protected get helpLink(): string {
        return Constants.renameDatabaseHelpLink;
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

            const objectInfo = viewInfo.objectInfo as { [key: string]: unknown };
            const databaseName =
                (objectInfo?.name as string | undefined) ?? this.databaseName ?? "";
            const viewModel: RenameDatabaseViewModel = {
                serverName: this.serverName,
                databaseName,
                newDatabaseName: databaseName,
                owner: objectInfo?.owner as string | undefined,
                status: objectInfo?.status as string | undefined,
            };

            this.databaseNameForRename = databaseName;
            this.updateWebviewState({
                viewModel: {
                    dialogType: ObjectManagementDialogType.RenameDatabase,
                    model: viewModel,
                },
                isLoading: false,
            });
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            this.logger.error(`Rename database initialization failed: ${errorMessage}`);
            this.updateWebviewState({
                viewModel: {
                    dialogType: ObjectManagementDialogType.RenameDatabase,
                    model: {
                        serverName: this.serverName,
                        databaseName: this.databaseName ?? "",
                        newDatabaseName: this.databaseName ?? "",
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
        const typedParams = params as RenameDatabaseParams;
        try {
            await this.objectManagementService.renameDatabase(
                this.connectionUri,
                this.databaseNameForRename,
                typedParams.newName,
                typedParams.dropConnections,
                false,
            );
            await this.disposeView();
            this.closeDialog(typedParams.newName);
            return { success: true };
        } catch (error) {
            return { success: false, errorMessage: getErrorMessage(error) };
        }
    }

    protected async handleScript(
        params: ObjectManagementActionParams["params"],
    ): Promise<ObjectManagementActionResult> {
        const typedParams = params as RenameDatabaseParams;
        try {
            const script = await this.objectManagementService.renameDatabase(
                this.connectionUri,
                this.databaseNameForRename,
                typedParams.newName,
                typedParams.dropConnections,
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

    private asViewInfo(viewInfo: unknown): RenameDatabaseViewInfo {
        return viewInfo as RenameDatabaseViewInfo;
    }
}
