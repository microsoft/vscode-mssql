/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import VscodeWrapper from "./vscodeWrapper";
import {
    BackupDatabaseFormItemSpec,
    BackupDatabaseFormState,
    BackupDatabaseReducers,
    BackupDatabaseState,
} from "../sharedInterfaces/objectManagement";
import { ApiStatus } from "../sharedInterfaces/webview";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import { FormWebviewController } from "../forms/formWebviewController";
import * as LocConstants from "../constants/locConstants";

export class BackupDatabaseWebviewController extends FormWebviewController<
    BackupDatabaseFormState,
    BackupDatabaseState,
    BackupDatabaseFormItemSpec,
    BackupDatabaseReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private databaseNode: TreeNodeInfo,
    ) {
        super(
            context,
            vscodeWrapper,
            "backupDatabase",
            "backupDatabase",
            new BackupDatabaseState(),
            {
                title: LocConstants.BackupDatabase.backupDatabaseTitle(
                    databaseNode.label.toString(),
                ),
                viewColumn: vscode.ViewColumn.Active, // Sets the view column of the webview
                iconPath: {
                    dark: vscode.Uri.joinPath(context.extensionUri, "media", "database_dark.svg"),
                    light: vscode.Uri.joinPath(context.extensionUri, "media", "database_light.svg"),
                },
            },
        );
        void this.initialize();
    }

    private async initialize() {
        this.state.databaseNode = {
            label: this.databaseNode.label.toString(),
            nodePath: this.databaseNode.nodePath,
            nodeStatus: this.databaseNode.nodeStatus,
        };
        this.registerRpcHandlers();
        this.state.loadState = ApiStatus.Loaded;
        this.updateState();
    }

    private registerRpcHandlers() {
        this.registerReducer("getDatabase", async (state, _payload) => {
            return state;
        });
    }

    async updateItemVisibility() {}

    protected getActiveFormComponents(
        state: BackupDatabaseState,
    ): (keyof BackupDatabaseFormState)[] {
        return Object.keys(state.formComponents) as (keyof BackupDatabaseFormState)[];
    }

    /*  private setBackupDatabaseFormComponents(): Record<
        string,
        FormItemSpec<BackupDatabaseFormState, BackupDatabaseState, BackupDatabaseFormItemSpec>
    > {
        const createFormItem = (
            spec: Partial<BackupDatabaseFormItemSpec>,
        ): BackupDatabaseFormItemSpec =>
            ({
                required: false,
                ...spec,
            }) as BackupDatabaseFormItemSpec;

        return {
            backupName: createFormItem({
                type: FormItemType.Input,
                propertyName: "backupName",
                label: LocConstants.BackupDatabase.backupName,
            }),

            recoveryModel: createFormItem({
                type: FormItemType.Dropdown,
                propertyName: "recoveryModel",
                label: LocConstants.BackupDatabase.recoveryModel,
                options: this.getRecoveryModelOptions(),
            }),

            backupType: createFormItem({
                type: FormItemType.Dropdown,
                propertyName: "backupType",
                label: LocConstants.BackupDatabase.backupType,
                options: this.getBackupTypeOptions(),
            }),

            copyOnly: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "copyOnly",
                label: LocConstants.BackupDatabase.copyOnly,
            }),

            saveToUrl: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "saveToUrl",
                label: LocConstants.BackupDatabase.saveToUrl,
            }),

            backupCompression: createFormItem({
                type: FormItemType.Dropdown,
                propertyName: "backupCompression",
                label: LocConstants.BackupDatabase.backupCompression,
                options: this.getBackupCompressionOptions(),
            }),

            profileName: createFormItem({
                type: FormItemType.Input,
                propertyName: "profileName",
                label: ConnectionDialog.profileName,
                tooltip: ConnectionDialog.profileNameTooltip,
                placeholder: ConnectionDialog.profileNamePlaceholder,
            }),

            containerName: createFormItem({
                type: FormItemType.Input,
                propertyName: "containerName",
                label: LocalContainers.containerName,
                isAdvancedOption: true,
                tooltip: LocalContainers.containerNameTooltip,
                placeholder: LocalContainers.containerNamePlaceholder,
            }),

            port: createFormItem({
                type: FormItemType.Input,
                propertyName: "port",
                label: LocalContainers.port,
                isAdvancedOption: true,
                tooltip: LocalContainers.portTooltip,
                placeholder: LocalContainers.portPlaceholder,
            }),

            hostname: createFormItem({
                type: FormItemType.Input,
                propertyName: "hostname",
                label: LocalContainers.hostname,
                isAdvancedOption: true,
                tooltip: LocalContainers.hostnameTooltip,
                placeholder: LocalContainers.hostnamePlaceholder,
            }),

            acceptEula: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "acceptEula",
                label: `<span>
                            ${Common.accept}
                            <a
                                href="https://go.microsoft.com/fwlink/?LinkId=746388"
                                target="_blank"
                            >
                                ${LocalContainers.termsAndConditions}
                            </a>
                        </span>`,
                required: true,
                tooltip: LocalContainers.acceptSqlServerEulaTooltip,
                componentWidth: "600px",
                validate(_, value) {
                    return value
                        ? { isValid: true, validationMessage: "" }
                        : {
                              isValid: false,
                              validationMessage: LocalContainers.acceptSqlServerEula,
                          };
                },
            }),
        };
    }

    private getRecoveryModelOptions(): FormItemOptions[] {
        return [
            {
                displayName: LocConstants.BackupDatabase.full,
                value: RecoveryModel.Full,
            },
            {
                displayName: LocConstants.BackupDatabase.bulkLogged,
                value: RecoveryModel.BulkLogged,
            },
            {
                displayName: LocConstants.BackupDatabase.simple,
                value: RecoveryModel.Simple,
            },
        ];
    }

    private getBackupTypeOptions(): FormItemOptions[] {
        return [
            {
                displayName: LocConstants.BackupDatabase.full,
                value: BackupType.Full,
            },
            {
                displayName: LocConstants.BackupDatabase.differential,
                value: BackupType.Differential,
            },
            {
                displayName: LocConstants.BackupDatabase.transactionLog,
                value: BackupType.TransactionLog,
            },
        ];
    }

    private getBackupCompressionOptions(): FormItemOptions[] {
        return [
            {
                displayName: LocConstants.BackupDatabase.useDefault,
                value: BackupCompression.Default,
            },
            {
                displayName: LocConstants.BackupDatabase.compressBackup,
                value: BackupCompression.Compress,
            },
            {
                displayName: LocConstants.BackupDatabase.doNotCompressBackup,
                value: BackupCompression.NoCompression,
            },
        ];
    }
        */
}
