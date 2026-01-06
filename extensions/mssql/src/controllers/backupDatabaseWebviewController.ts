/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import VscodeWrapper from "./vscodeWrapper";
import {
    BackupComponent,
    BackupCompression,
    BackupDatabaseFormItemSpec,
    BackupDatabaseFormState,
    BackupDatabaseReducers,
    BackupDatabaseState,
    BackupInfo,
    BackupType,
    getBackupCompressionNumber,
    getBackupTypeNumber,
    LogOption,
    MediaSet,
    ObjectManagementService,
    PhysicalDeviceType,
} from "../sharedInterfaces/objectManagement";
import { ApiStatus } from "../sharedInterfaces/webview";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import { FormWebviewController } from "../forms/formWebviewController";
import * as LocConstants from "../constants/locConstants";
import { TaskExecutionMode } from "../sharedInterfaces/task";
import { FormItemOptions, FormItemSpec, FormItemType } from "../sharedInterfaces/form";
import { simple } from "../constants/constants";

export class BackupDatabaseWebviewController extends FormWebviewController<
    BackupDatabaseFormState,
    BackupDatabaseState,
    BackupDatabaseFormItemSpec,
    BackupDatabaseReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private objectManagementService: ObjectManagementService,
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
            nodeUri: this.databaseNode.sessionId,
            nodePath: this.databaseNode.nodePath,
            nodeStatus: this.databaseNode.nodeStatus,
        };

        const backupConfigInfo = (
            await this.objectManagementService.getBackupConfigInfo(this.databaseNode.sessionId)
        )?.backupConfigInfo;
        this.state.defaultBackupFolder = backupConfigInfo.defaultBackupFolder;
        this.state.backupEncryptors = backupConfigInfo.backupEncryptors;
        this.state.recoveryModel = backupConfigInfo.recoveryModel;
        this.state.formComponents = this.setBackupDatabaseFormComponents();

        this.registerRpcHandlers();
        this.state.loadState = ApiStatus.Loaded;
        this.updateState();
    }

    private registerRpcHandlers() {
        this.registerReducer("backupDatabase", async (state, _payload) => {
            const backupName = `testBackup_${new Date().getTime()}`;
            const backupPath = `/var/opt/mssql/data/${backupName}.bak`;
            const backupPathDevices: Record<string, number> = {
                [backupPath]: PhysicalDeviceType.Disk,
            };
            const testBackupInfo: BackupInfo = {
                databaseName: this.databaseNode.label.toString(),
                backupType: getBackupTypeNumber(BackupType.Full),
                backupComponent: BackupComponent.Database, // always database for this scenario
                backupDeviceType: PhysicalDeviceType.Disk, // always disk or URL
                selectedFiles: undefined,
                backupsetName: backupName,
                selectedFileGroup: undefined,
                backupPathDevices: backupPathDevices,
                backupPathList: [backupPath],
                isCopyOnly: false,
                formatMedia: false,
                initialize: false,
                skipTapeHeader: false,
                mediaName: "",
                mediaDescription: "",
                checksum: false,
                continueAfterError: false,
                logTruncation: false,
                tailLogBackup: false,
                backupSetDescription: "",
                retainDays: 0,
                expirationDate: undefined,
                compressionOption: getBackupCompressionNumber(BackupCompression.Default),
                verifyBackupRequired: false,
                encryptionAlgorithm: 0,
                encryptorType: undefined,
                encryptorName: "",
            };
            const backupResult = await this.objectManagementService.backupDatabase(
                state.databaseNode.nodeUri,
                testBackupInfo,
                TaskExecutionMode.execute,
            );
            console.log("Backup Result: ", JSON.stringify(backupResult));
            return state;
        });
    }

    async updateItemVisibility() {}

    protected getActiveFormComponents(
        state: BackupDatabaseState,
    ): (keyof BackupDatabaseFormState)[] {
        return Object.keys(state.formComponents) as (keyof BackupDatabaseFormState)[];
    }

    private setBackupDatabaseFormComponents(): Record<
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

            backupType: createFormItem({
                type: FormItemType.Dropdown,
                propertyName: "backupType",
                label: LocConstants.BackupDatabase.backupType,
                options: this.getTypeOptions(),
            }),

            copyOnly: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "copyOnly",
                label: LocConstants.BackupDatabase.copyOnly,
            }),

            backupFilePath: createFormItem({
                type: FormItemType.Input,
                propertyName: "backupFilePath",
                label: LocConstants.BackupDatabase.backupFiles,
            }),

            // TODO: add when implementing URL backups
            // saveToUrl: createFormItem({
            //     type: FormItemType.Checkbox,
            //     propertyName: "saveToUrl",
            //     label: LocConstants.BackupDatabase.saveToUrl,
            // }),

            backupCompression: createFormItem({
                type: FormItemType.Dropdown,
                propertyName: "backupCompression",
                label: LocConstants.BackupDatabase.backupCompression,
                options: this.getCompressionOptions(),
                isAdvancedOption: true,
            }),

            mediaSet: createFormItem({
                type: FormItemType.Dropdown,
                propertyName: "mediaSet",
                label: LocConstants.BackupDatabase.backupMediaSet,
                options: this.getMediaSetOptions(),
                isAdvancedOption: true,
            }),

            mediaSetName: createFormItem({
                type: FormItemType.Input,
                propertyName: "mediaSetName",
                label: LocConstants.BackupDatabase.newMediaSetName,
                isAdvancedOption: true,
            }),

            mediaSetDescription: createFormItem({
                type: FormItemType.Input,
                propertyName: "mediaSetDescription",
                label: LocConstants.BackupDatabase.newMediaSetDescription,
                isAdvancedOption: true,
            }),

            performChecksum: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "performChecksum",
                label: LocConstants.BackupDatabase.performChecksum,
                isAdvancedOption: true,
            }),

            verifyBackup: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "verifyBackup",
                label: LocConstants.BackupDatabase.verifyBackup,
                isAdvancedOption: true,
            }),

            continueOnError: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "continueOnError",
                label: LocConstants.BackupDatabase.continueOnError,
                isAdvancedOption: true,
            }),

            transactionLog: createFormItem({
                type: FormItemType.Dropdown,
                propertyName: "transactionLog",
                label: LocConstants.BackupDatabase.transactionLog,
                options: this.getTransactionLogOptions(),
                isAdvancedOption: true,
            }),

            retainDays: createFormItem({
                type: FormItemType.Input,
                propertyName: "retainDays",
                label: LocConstants.BackupDatabase.retainDays,
                isAdvancedOption: true,
            }),
        };
    }

    private getTypeOptions(): FormItemOptions[] {
        const backupTypeOptions: FormItemOptions[] = [
            {
                displayName: LocConstants.BackupDatabase.full,
                value: BackupType.Full,
            },
            {
                displayName: LocConstants.BackupDatabase.differential,
                value: BackupType.Differential,
            },
        ];

        // Only add Transaction Log option if the database is not in Simple recovery model
        if (this.state.recoveryModel !== simple) {
            backupTypeOptions.push({
                displayName: LocConstants.BackupDatabase.transactionLog,
                value: BackupType.TransactionLog,
            });
        }
        return backupTypeOptions;
    }

    private getCompressionOptions(): FormItemOptions[] {
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

    private getMediaSetOptions(): FormItemOptions[] {
        return [
            {
                displayName: LocConstants.BackupDatabase.append,
                value: MediaSet.Append,
            },
            {
                displayName: LocConstants.BackupDatabase.overwrite,
                value: MediaSet.Overwrite,
            },
            {
                displayName: LocConstants.BackupDatabase.create,
                value: MediaSet.Create,
            },
        ];
    }

    private getTransactionLogOptions(): FormItemOptions[] {
        return [
            {
                displayName: LocConstants.BackupDatabase.truncateLog,
                value: LogOption.Truncate,
            },
            {
                displayName: LocConstants.BackupDatabase.backupTail,
                value: LogOption.BackupTail,
            },
        ];
    }
}
