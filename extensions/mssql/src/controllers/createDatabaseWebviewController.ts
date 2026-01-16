/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    CreateDatabaseParams,
    CreateDatabaseViewModel,
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

interface OptionsCollection {
    options?: string[];
    defaultValueIndex?: number;
}

interface CreateDatabaseViewInfo {
    objectInfo: { [key: string]: unknown };
    loginNames?: OptionsCollection;
    collationNames?: OptionsCollection;
    recoveryModels?: OptionsCollection;
    compatibilityLevels?: OptionsCollection;
    containmentTypes?: OptionsCollection;
}

export class CreateDatabaseWebviewController extends ObjectManagementWebviewController {
    private objectInfo: { [key: string]: unknown } | undefined;

    public constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        objectManagementService: ObjectManagementService,
        connectionUri: string,
        serverName: string,
        databaseName?: string,
        parentUrn?: string,
        dialogTitle?: string,
    ) {
        super(
            context,
            vscodeWrapper,
            objectManagementService,
            ObjectManagementDialogType.CreateDatabase,
            dialogTitle ?? LocConstants.createDatabaseDialogTitle,
            "createDatabaseDialog",
            connectionUri,
            serverName,
            databaseName,
            parentUrn,
        );

        this.start();
    }

    protected get helpLink(): string {
        return Constants.createDatabaseHelpLink;
    }

    protected async initializeDialog(): Promise<void> {
        try {
            const viewInfo = this.asViewInfo(
                await this.objectManagementService.initializeView(
                    this.contextId,
                    Constants.databaseString,
                    this.connectionUri,
                    this.databaseName || Constants.defaultDatabase,
                    true,
                    this.parentUrn ?? "Server",
                    undefined,
                ),
            );

            this.objectInfo = viewInfo.objectInfo as { [key: string]: unknown };
            const getDefault = (options?: { options?: string[]; defaultValueIndex?: number }) => {
                if (!options?.options?.length) {
                    return undefined;
                }
                const index = options.defaultValueIndex ?? 0;
                return options.options[index];
            };

            const viewModel: CreateDatabaseViewModel = {
                serverName: this.serverName,
                databaseName: (this.objectInfo?.name as string | undefined) ?? "",
                ownerOptions: viewInfo.loginNames?.options,
                owner:
                    (this.objectInfo?.owner as string | undefined) ??
                    getDefault(viewInfo.loginNames),
                collationOptions: viewInfo.collationNames?.options,
                collationName:
                    (this.objectInfo?.collationName as string | undefined) ??
                    getDefault(viewInfo.collationNames),
                recoveryModelOptions: viewInfo.recoveryModels?.options,
                recoveryModel:
                    (this.objectInfo?.recoveryModel as string | undefined) ??
                    getDefault(viewInfo.recoveryModels),
                compatibilityLevelOptions: viewInfo.compatibilityLevels?.options,
                compatibilityLevel:
                    (this.objectInfo?.compatibilityLevel as string | undefined) ??
                    getDefault(viewInfo.compatibilityLevels),
                containmentTypeOptions: viewInfo.containmentTypes?.options,
                containmentType:
                    (this.objectInfo?.containmentType as string | undefined) ??
                    getDefault(viewInfo.containmentTypes),
                isLedgerDatabase: this.objectInfo?.isLedgerDatabase as boolean | undefined,
            };

            this.updateWebviewState({
                viewModel: {
                    dialogType: ObjectManagementDialogType.CreateDatabase,
                    model: viewModel,
                },
                isLoading: false,
            });
        } catch (error) {
            this.logger.error(`Create database initialization failed: ${getErrorMessage(error)}`);
            this.updateWebviewState({
                viewModel: {
                    dialogType: ObjectManagementDialogType.CreateDatabase,
                    model: {
                        serverName: this.serverName,
                        databaseName: "",
                    },
                },
                isLoading: false,
            });
        }
    }

    protected async handleSubmit(
        params: ObjectManagementActionParams["params"],
    ): Promise<ObjectManagementActionResult> {
        const typedParams = params as CreateDatabaseParams;
        try {
            if (!this.objectInfo) {
                return {
                    success: false,
                    errorMessage: LocConstants.msgChooseDatabaseNotConnected,
                };
            }

            this.applyCreateParams(typedParams);
            await this.objectManagementService.save(
                this.contextId,
                this.objectInfo as { name: string; [key: string]: unknown },
            );

            await this.disposeView();
            this.closeDialog(typedParams.name);
            return { success: true };
        } catch (error) {
            return { success: false, errorMessage: getErrorMessage(error) };
        }
    }

    protected async handleScript(
        params: ObjectManagementActionParams["params"],
    ): Promise<ObjectManagementActionResult> {
        const typedParams = params as CreateDatabaseParams;
        try {
            if (!this.objectInfo) {
                return {
                    success: false,
                    errorMessage: LocConstants.msgChooseDatabaseNotConnected,
                };
            }

            this.applyCreateParams(typedParams);
            const script = await this.objectManagementService.script(
                this.contextId,
                this.objectInfo as { name: string; [key: string]: unknown },
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

    private asViewInfo(viewInfo: unknown): CreateDatabaseViewInfo {
        return viewInfo as CreateDatabaseViewInfo;
    }

    private applyCreateParams(params: CreateDatabaseParams): void {
        if (!this.objectInfo) {
            return;
        }

        this.objectInfo.name = params.name;
        if (params.owner !== undefined) {
            this.objectInfo.owner = params.owner;
        }
        if (params.collationName !== undefined) {
            this.objectInfo.collationName = params.collationName;
        }
        if (params.recoveryModel !== undefined) {
            this.objectInfo.recoveryModel = params.recoveryModel;
        }
        if (params.compatibilityLevel !== undefined) {
            this.objectInfo.compatibilityLevel = params.compatibilityLevel;
        }
        if (params.containmentType !== undefined) {
            this.objectInfo.containmentType = params.containmentType;
        }
        if (params.isLedgerDatabase !== undefined) {
            this.objectInfo.isLedgerDatabase = params.isLedgerDatabase;
        }
    }
}
