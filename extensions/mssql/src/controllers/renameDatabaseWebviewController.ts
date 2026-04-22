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
import { onTaskCompleted, TaskCompletedEvent, TaskStatus } from "../services/sqlTasksService";
import { getErrorMessage } from "../utils/utils";
import VscodeWrapper from "./vscodeWrapper";
import { ObjectManagementWebviewController } from "./objectManagementWebviewController";

interface RenameDatabaseViewInfo {
    objectInfo: { [key: string]: unknown };
}

export class RenameDatabaseWebviewController extends ObjectManagementWebviewController {
    private static readonly _renameDatabaseOperationName = "RenameDatabaseOperation";
    private _databaseNameForRename = "";

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

        this._databaseNameForRename = databaseName ?? "";
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

            this._databaseNameForRename = databaseName;
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
            const renameResponse = await this.objectManagementService.renameDatabase(
                this.connectionUri,
                this._databaseNameForRename,
                typedParams.newName,
                typedParams.dropConnections,
                false,
            );

            if (!renameResponse.taskId) {
                return {
                    success: false,
                    errorMessage: LocConstants.msgObjectManagementUnknownDialog,
                };
            }

            const renameTaskCompletion = this.waitForRenameTaskCompletion(renameResponse.taskId);

            const completionResult = await renameTaskCompletion.promise;
            if (!completionResult.success) {
                return completionResult;
            }

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
            const response = await this.objectManagementService.renameDatabase(
                this.connectionUri,
                this._databaseNameForRename,
                typedParams.newName,
                typedParams.dropConnections,
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

    private asViewInfo(viewInfo: unknown): RenameDatabaseViewInfo {
        return viewInfo as RenameDatabaseViewInfo;
    }

    private waitForRenameTaskCompletion(taskId: string): {
        promise: Promise<ObjectManagementActionResult>;
        dispose: () => void;
    } {
        let completionListener: vscode.Disposable | undefined;

        const promise = new Promise<ObjectManagementActionResult>((resolve) => {
            completionListener = onTaskCompleted((taskCompletedEvent: TaskCompletedEvent) => {
                const { task, progress } = taskCompletedEvent;
                if (
                    task.operationName !==
                        RenameDatabaseWebviewController._renameDatabaseOperationName ||
                    task.taskId !== taskId
                ) {
                    return;
                }

                completionListener?.dispose();
                completionListener = undefined;

                if (
                    progress.status === TaskStatus.Succeeded ||
                    progress.status === TaskStatus.SucceededWithWarning
                ) {
                    resolve({ success: true });
                    return;
                }

                resolve({
                    success: false,
                    errorMessage: progress.message || LocConstants.msgObjectManagementUnknownDialog,
                });
            });
        });

        return {
            promise,
            dispose: () => {
                completionListener?.dispose();
                completionListener = undefined;
            },
        };
    }
}
