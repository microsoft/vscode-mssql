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
    BackupEncryptor,
    BackupInfo,
    BackupType,
    EncryptionAlgorithm,
    getBackupCompressionNumber,
    getBackupTypeNumber,
    getEncryptionAlgorithmNumber,
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
import {
    allFileTypes,
    defaultBackupFileTypes,
    defaultDatabase,
    simple,
} from "../constants/constants";
import { FileBrowserService } from "../services/fileBrowserService";
import { registerFileBrowserReducers } from "./fileBrowserUtils";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import { FileBrowserReducers, FileBrowserWebviewState } from "../sharedInterfaces/fileBrowser";
import { TelemetryViews, TelemetryActions } from "../sharedInterfaces/telemetry";
import { sendActionEvent } from "../telemetry/telemetry";

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
        private fileBrowserService: FileBrowserService,
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

        this.state.ownerUri = this.databaseNode.sessionId;

        const backupConfigInfo = (
            await this.objectManagementService.getBackupConfigInfo(this.databaseNode.sessionId)
        )?.backupConfigInfo;
        this.state.defaultFileBrowserExpandPath = backupConfigInfo.defaultBackupFolder;
        this.state.backupEncryptors = backupConfigInfo.backupEncryptors;
        this.state.recoveryModel = backupConfigInfo.recoveryModel;

        this.state.formComponents = this.setBackupDatabaseFormComponents();
        this.state.defaultBackupName = `${this.databaseNode.label.toString()}_${new Date().toISOString().slice(0, 19)}`;

        // Set default form state values
        this.state.formState = {
            backupName: this.state.defaultBackupName,
            backupType: BackupType.Full,
            copyOnly: false,
            saveToUrl: false,
            backupFilePath: `${this.state.defaultFileBrowserExpandPath}/${this.state.defaultBackupName}.bak`,
            backupFiles: [],
            backupCompression: BackupCompression.Default,
            mediaSet: MediaSet.Append,
            mediaSetName: "",
            mediaSetDescription: "",
            performChecksum: false,
            verifyBackup: false,
            continueOnError: false,
            transactionLog: LogOption.Truncate,
            encryptionEnabled: false,
            encryptionAlgorithm: EncryptionAlgorithm.AES128,
            encryptorName: this.state.backupEncryptors.length
                ? this.state.backupEncryptors[0].encryptorName
                : undefined,
            retainDays: 0,
        };

        this.state.fileFilterOptions = [
            {
                displayName: LocConstants.BackupDatabase.backupFileTypes,
                value: defaultBackupFileTypes,
            },
            {
                displayName: LocConstants.BackupDatabase.allFiles,
                value: allFileTypes,
            },
        ];

        this.registerRpcHandlers();
        this.state.loadState = ApiStatus.Loaded;
        this.updateState();
    }

    private registerRpcHandlers() {
        this.registerReducer("backupDatabase", async (state, _payload) => {
            const backupPathDevices: Record<string, number> = {
                [state.formState.backupFilePath]: PhysicalDeviceType.Disk,
            };
            const createNewMediaSet = state.formState.mediaSet === MediaSet.Create;
            const overwriteMediaSet = state.formState.mediaSet === MediaSet.Overwrite;

            let encryptor: BackupEncryptor = {
                encryptorType: undefined,
                encryptorName: "",
            };
            if (state.formState.encryptionEnabled) {
                encryptor = this.state.backupEncryptors.find(
                    (be) => be.encryptorName === state.formState.encryptorName,
                );
            }

            const backupInfo: BackupInfo = {
                databaseName: this.databaseNode.label.toString(),
                backupType: getBackupTypeNumber(state.formState.backupType),
                backupComponent: BackupComponent.Database, // always database for this scenario
                backupDeviceType: PhysicalDeviceType.Disk, // always disk or URL
                selectedFiles: undefined,
                backupsetName: state.formState.backupName ?? this.state.defaultBackupName,
                selectedFileGroup: undefined,
                backupPathDevices: backupPathDevices,
                backupPathList: [state.formState.backupFilePath],
                isCopyOnly: state.formState.copyOnly,
                formatMedia: createNewMediaSet,
                initialize: createNewMediaSet || overwriteMediaSet,
                skipTapeHeader: createNewMediaSet,
                mediaName: state.formState.mediaSetName,
                mediaDescription: state.formState.mediaSetDescription,
                checksum: state.formState.performChecksum,
                continueAfterError: state.formState.continueOnError,
                logTruncation: state.formState.transactionLog === LogOption.Truncate,
                tailLogBackup: state.formState.transactionLog === LogOption.BackupTail,
                retainDays: state.formState.retainDays,
                compressionOption: getBackupCompressionNumber(state.formState.backupCompression),
                verifyBackupRequired: state.formState.verifyBackup,
                encryptionAlgorithm: getEncryptionAlgorithmNumber(
                    state.formState.encryptionAlgorithm,
                ),
                encryptorType: encryptor.encryptorType,
                encryptorName: encryptor.encryptorName,
            };
            const backupResult = await this.objectManagementService.backupDatabase(
                state.databaseNode.nodeUri,
                backupInfo,
                TaskExecutionMode.execute,
            );
            console.log("Backup Result: ", JSON.stringify(backupResult));
            return state;
        });

        registerFileBrowserReducers(
            this as ReactWebviewPanelController<FileBrowserWebviewState, FileBrowserReducers, any>,
            this.fileBrowserService,
            false,
            defaultBackupFileTypes,
        );

        // Override default file browser submitFilePath reducer
        this.registerReducer("submitFilePath", async (state, payload) => {
            state.formState.backupFiles.push(payload.selectedPath);
            sendActionEvent(TelemetryViews.FileBrowser, TelemetryActions.FileBrowserDialog, {
                isOpen: "true",
            });

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
                advancedGroupName: LocConstants.BackupDatabase.compression,
            }),

            mediaSet: createFormItem({
                type: FormItemType.Dropdown,
                propertyName: "mediaSet",
                label: LocConstants.BackupDatabase.backupMediaSet,
                options: this.getMediaSetOptions(),
                isAdvancedOption: true,
                advancedGroupName: LocConstants.BackupDatabase.media,
            }),

            mediaSetName: createFormItem({
                type: FormItemType.Input,
                propertyName: "mediaSetName",
                label: LocConstants.BackupDatabase.newMediaSetName,
                isAdvancedOption: true,
                advancedGroupName: LocConstants.BackupDatabase.media,
            }),

            mediaSetDescription: createFormItem({
                type: FormItemType.Input,
                propertyName: "mediaSetDescription",
                label: LocConstants.BackupDatabase.newMediaSetDescription,
                isAdvancedOption: true,
                advancedGroupName: LocConstants.BackupDatabase.media,
            }),

            performChecksum: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "performChecksum",
                label: LocConstants.BackupDatabase.performChecksum,
                isAdvancedOption: true,
                advancedGroupName: LocConstants.BackupDatabase.reliability,
            }),

            verifyBackup: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "verifyBackup",
                label: LocConstants.BackupDatabase.verifyBackup,
                isAdvancedOption: true,
                advancedGroupName: LocConstants.BackupDatabase.reliability,
            }),

            continueOnError: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "continueOnError",
                label: LocConstants.BackupDatabase.continueOnError,
                isAdvancedOption: true,
                advancedGroupName: LocConstants.BackupDatabase.reliability,
            }),

            transactionLog: createFormItem({
                type: FormItemType.Dropdown,
                propertyName: "transactionLog",
                label: LocConstants.BackupDatabase.transactionLog,
                options: this.getTransactionLogOptions(),
                isAdvancedOption: true,
                advancedGroupName: LocConstants.BackupDatabase.transactionLog,
            }),

            retainDays: createFormItem({
                type: FormItemType.Input,
                propertyName: "retainDays",
                label: LocConstants.BackupDatabase.retainDays,
                isAdvancedOption: true,
                advancedGroupName: LocConstants.BackupDatabase.expiration,
            }),

            encryptionEnabled: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "encryptionEnabled",
                label: LocConstants.BackupDatabase.enableEncryption,
                isAdvancedOption: true,
                advancedGroupName: LocConstants.BackupDatabase.encryption,
            }),

            encryptionAlgorithm: createFormItem({
                type: FormItemType.Dropdown,
                propertyName: "encryptionAlgorithm",
                label: LocConstants.BackupDatabase.encryptionAlgorithm,
                options: this.getEncryptionAlgorithmOptions(),
                isAdvancedOption: true,
                advancedGroupName: LocConstants.BackupDatabase.encryption,
            }),

            encryptorName: createFormItem({
                type: FormItemType.Dropdown,
                propertyName: "encryptorName",
                label: LocConstants.BackupDatabase.encryptionType,
                options: this.getEncryptorNameOptions(),
                isAdvancedOption: true,
                advancedGroupName: LocConstants.BackupDatabase.encryption,
            }),
        };
    }

    private getTypeOptions(): FormItemOptions[] {
        const backupTypeOptions: FormItemOptions[] = [
            {
                displayName: LocConstants.BackupDatabase.full,
                value: BackupType.Full,
            },
        ];

        // If the database is not master, then add Differential option
        if (this.databaseNode.label.toString() !== defaultDatabase) {
            backupTypeOptions.push({
                displayName: LocConstants.BackupDatabase.differential,
                value: BackupType.Differential,
            });
        }
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

    private getEncryptionAlgorithmOptions(): FormItemOptions[] {
        return [
            {
                displayName: EncryptionAlgorithm.AES128,
                value: EncryptionAlgorithm.AES128,
            },
            {
                displayName: EncryptionAlgorithm.AES192,
                value: EncryptionAlgorithm.AES192,
            },
            {
                displayName: EncryptionAlgorithm.AES256,
                value: EncryptionAlgorithm.AES256,
            },
            {
                displayName: EncryptionAlgorithm.TripleDES,
                value: EncryptionAlgorithm.TripleDES,
            },
        ];
    }

    private getEncryptorNameOptions(): FormItemOptions[] {
        return this.state.backupEncryptors.map((be) => ({
            displayName: be.encryptorName,
            value: be.encryptorName,
        }));
    }
}
