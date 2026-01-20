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
    MediaDeviceType,
    MediaSet,
    BackupService,
    PhysicalDeviceType,
} from "../sharedInterfaces/backup";
import { ApiStatus } from "../sharedInterfaces/webview";
import { FormWebviewController } from "../forms/formWebviewController";
import * as LocConstants from "../constants/locConstants";
import {
    FormItemActionButton,
    FormItemOptions,
    FormItemSpec,
    FormItemType,
} from "../sharedInterfaces/form";
import {
    allFileTypes,
    defaultBackupFileTypes,
    defaultDatabase,
    https,
    simple,
    url,
} from "../constants/constants";
import { FileBrowserService } from "../services/fileBrowserService";
import { registerFileBrowserReducers } from "./fileBrowserUtils";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import { FileBrowserReducers, FileBrowserWebviewState } from "../sharedInterfaces/fileBrowser";
import { getDefaultTenantId, VsCodeAzureHelper } from "../connectionconfig/azureHelpers";
import { BackupResponse } from "azdata";
import { getCloudProviderSettings } from "../azure/providerSettings";
import { AzureBlobService } from "../models/contracts/azureBlob";
import { nextYear } from "../utils/utils";
import { TaskExecutionMode } from "../sharedInterfaces/schemaCompare";
import { sendActionEvent } from "../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";

export class BackupDatabaseWebviewController extends FormWebviewController<
    BackupDatabaseFormState,
    BackupDatabaseState,
    BackupDatabaseFormItemSpec,
    BackupDatabaseReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private objectManagementService: BackupService,
        private fileBrowserService: FileBrowserService,
        private azureBlobService: AzureBlobService,
        private ownerUri: string,
        private databaseName: string,
    ) {
        super(
            context,
            vscodeWrapper,
            "backupDatabase",
            "backupDatabase",
            new BackupDatabaseState(),
            {
                title: LocConstants.BackupDatabase.backupDatabaseTitle(databaseName),
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
        this.state.databaseName = this.databaseName;
        this.state.ownerUri = this.ownerUri;

        // Get backup config info; Gets the recovery model, default backup folder, and encryptors
        const backupConfigInfo = (
            await this.objectManagementService.getBackupConfigInfo(this.state.ownerUri)
        )?.backupConfigInfo;
        this.state.defaultFileBrowserExpandPath = backupConfigInfo.defaultBackupFolder;
        this.state.backupEncryptors = backupConfigInfo.backupEncryptors;
        this.state.recoveryModel = backupConfigInfo.recoveryModel;

        // Set default backup file props
        this.state.defaultBackupName = this.getDefaultBackupFileName(this.state);
        this.state.backupFiles = [
            {
                filePath: `${this.state.defaultFileBrowserExpandPath}/${this.state.defaultBackupName}`,
                isExisting: false,
            },
        ];
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

        // Set initial azure component statuses
        this.state.azureComponentStatuses = {
            accountId: ApiStatus.NotStarted,
            tenantId: ApiStatus.NotStarted,
            subscriptionId: ApiStatus.NotStarted,
            storageAccountId: ApiStatus.NotStarted,
            blobContainerId: ApiStatus.NotStarted,
        };

        this.state.formComponents = this.setBackupDatabaseFormComponents();

        // Set default form state values
        this.state.formState = {
            backupName: this.state.defaultBackupName,
            backupType: BackupType.Full,
            copyOnly: false,
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
            accountId: "",
            tenantId: "",
            subscriptionId: "",
            storageAccountId: "",
            blobContainerId: "",
        };

        sendActionEvent(TelemetryViews.Backup, TelemetryActions.StartBackup);

        this.registerRpcHandlers();
        this.state.loadState = ApiStatus.Loaded;
        this.updateState();
    }

    private registerRpcHandlers() {
        this.registerReducer("formAction", async (state, payload) => {
            if (payload.event.isAction) {
                const component = state.formComponents[payload.event.propertyName];
                if (component && component.actionButtons) {
                    const actionButton = component.actionButtons.find(
                        (b) => b.id === payload.event.value,
                    );
                    if (actionButton?.callback) {
                        void actionButton.callback();
                    }
                }
            } else {
                (state.formState[
                    payload.event.propertyName
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ] as any) = payload.event.value;

                // If an azure component changed, reload dependent components and revalidate
                if (
                    ["accountId", "tenantId", "subscriptionId", "storageAccountId"].includes(
                        payload.event.propertyName,
                    )
                ) {
                    // Reload necessary dependent components
                    state = this.reloadAzureComponents(state, payload.event.propertyName);
                }

                // Re-validate the changed component
                const componentFormError = (
                    await this.validateForm(state.formState, payload.event.propertyName, true)
                )[0];
                if (componentFormError) {
                    state.formErrors.push(payload.event.propertyName);
                } else {
                    state.formErrors = state.formErrors.filter(
                        (formError) => formError !== payload.event.propertyName,
                    );
                }
            }
            return state;
        });

        this.registerReducer("backupDatabase", async (state, _payload) => {
            void this.backupHelper(TaskExecutionMode.execute, state);

            sendActionEvent(TelemetryViews.Backup, TelemetryActions.Backup, {
                backupToUrl: state.saveToUrl ? "true" : "false",
                backupWithExistingFiles:
                    state.saveToUrl && state.backupFiles.some((file) => file.isExisting)
                        ? "true"
                        : "false",
            });
            return state;
        });

        this.registerReducer("openBackupScript", async (state, _payload) => {
            void this.backupHelper(TaskExecutionMode.script, state);

            sendActionEvent(TelemetryViews.Backup, TelemetryActions.ScriptBackup);
            return state;
        });

        this.registerReducer("setSaveLocation", async (state, payload) => {
            // Set save to URL or local files; reload form errors
            state.saveToUrl = payload.saveToUrl;
            state.formErrors = [];
            return state;
        });

        this.registerReducer("removeBackupFile", async (state, payload) => {
            state.backupFiles = state.backupFiles.filter(
                (file) => file.filePath !== payload.filePath,
            );
            state = this.setMediaOptionsIfExistingFiles(state);
            return state;
        });

        this.registerReducer("handleFileChange", async (state, payload) => {
            const currentFilePath = state.backupFiles[payload.index].filePath;
            let newFilePath: string = "";
            if (payload.isFolderChange) {
                newFilePath = `${payload.newValue}/${currentFilePath.substring(
                    currentFilePath.lastIndexOf("/") + 1,
                )}`;
            } else {
                newFilePath = `${currentFilePath.substring(0, currentFilePath.lastIndexOf("/") + 1)}${payload.newValue}`;
            }
            state.backupFiles[payload.index].filePath = newFilePath;
            return state;
        });

        this.registerReducer("loadAzureComponent", async (state, payload) => {
            // Only start loading if not already started
            if (state.azureComponentStatuses[payload.componentName] !== ApiStatus.NotStarted)
                return state;

            switch (payload.componentName) {
                case "accountId":
                    state = await this.loadAccountComponent(state);
                    break;
                case "tenantId":
                    state = await this.loadTenantComponent(state);
                    break;
                case "subscriptionId":
                    state = await this.loadSubscriptionComponent(state);
                    break;
                case "storageAccountId":
                    state = await this.loadStorageAccountComponent(state);
                    break;
                case "blobContainerId":
                    state = await this.loadBlobContainerComponent(state);
                    break;
            }

            state.azureComponentStatuses[payload.componentName] = ApiStatus.Loaded;

            return state;
        });

        registerFileBrowserReducers(
            this as ReactWebviewPanelController<FileBrowserWebviewState, FileBrowserReducers, any>,
            this.fileBrowserService,
            defaultBackupFileTypes,
        );

        // Override default file browser submitFilePath reducer
        this.registerReducer("submitFilePath", async (state, payload) => {
            // Check if an existing file was selected
            const isExisting = payload.selectedPath.includes(".");

            // Folder selected, generate default backup name
            if (!isExisting) {
                const defaultFileName = this.getDefaultBackupFileName(state);
                payload.selectedPath = `${payload.selectedPath}/${defaultFileName}`;
            }

            const paths = state.backupFiles.map((f) => f.filePath);
            if (!paths.includes(payload.selectedPath)) {
                state.backupFiles.push({
                    filePath: payload.selectedPath,
                    isExisting: isExisting,
                });
            }

            // Update media options if there are existing files
            state = this.setMediaOptionsIfExistingFiles(state);

            return state;
        });
    }

    /**
     * Generates a default backup file name based on database name and number of new files
     * @param state Current backup database state
     * @returns Default backup file name
     */
    private getDefaultBackupFileName(state: BackupDatabaseState): string {
        const newFiles = state.backupFiles.filter((file) => !file.isExisting);
        let name = state.databaseName;
        if (newFiles.length > 0) {
            name += `_${newFiles.length}`;
        }
        return name + `_${new Date().toISOString().slice(0, 19)}.bak`;
    }

    /**
     * Handles the backup operation
     * @param mode Whether to script or execute
     * @param state Current backup database state
     * @returns Backup response
     */
    private async backupHelper(
        mode: TaskExecutionMode,
        state: BackupDatabaseState,
    ): Promise<BackupResponse> {
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

        const backupPathDevices: Record<string, MediaDeviceType> = {};
        const backupPathList: string[] = [];

        // If saving to URL, construct the Blob URL and get SAS token
        if (state.saveToUrl) {
            const accountEndpoint =
                getCloudProviderSettings().settings.azureStorageResource.endpoint.replace(
                    https,
                    "",
                );
            const subscription = state.subscriptions.find(
                (s) => s.subscriptionId === state.formState.subscriptionId,
            );
            const storageAccount = state.storageAccounts.find(
                (sa) => sa.id === state.formState.storageAccountId,
            );
            const blobContainer = state.blobContainers.find(
                (bc) => bc.id === state.formState.blobContainerId,
            );

            const blobContainerUrl = `${https}${storageAccount.name}.${accountEndpoint}${blobContainer.name}`;
            const backupUrl = `${blobContainerUrl}/${state.formState.backupName}`;
            backupPathDevices[backupUrl] = MediaDeviceType.Url;
            backupPathList.push(backupUrl);

            const key = (
                await VsCodeAzureHelper.getStorageAccountKeys(subscription, storageAccount)
            ).keys[0].value;

            void this.azureBlobService.createSas(
                state.ownerUri,
                blobContainerUrl,
                key,
                storageAccount.name,
                nextYear(),
            );
        } else {
            for (const file of state.backupFiles) {
                backupPathDevices[file.filePath] = MediaDeviceType.File;
                backupPathList.push(file.filePath);
            }
        }

        const backupInfo: BackupInfo = {
            databaseName: state.databaseName,
            backupType: getBackupTypeNumber(state.formState.backupType),
            backupComponent: BackupComponent.Database, // always database for this scenario
            backupDeviceType: state.saveToUrl ? PhysicalDeviceType.Url : PhysicalDeviceType.Disk, // always disk or URL
            selectedFiles: undefined,
            backupsetName: state.formState.backupName ?? this.state.defaultBackupName,
            selectedFileGroup: undefined,
            backupPathDevices: backupPathDevices,
            backupPathList: backupPathList,
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
            encryptionAlgorithm: getEncryptionAlgorithmNumber(state.formState.encryptionAlgorithm),
            encryptorType: encryptor.encryptorType,
            encryptorName: encryptor.encryptorName,
        };
        return this.objectManagementService.backupDatabase(state.ownerUri, backupInfo, mode);
    }

    //#region Form Helpers
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

            accountId: createFormItem({
                propertyName: "accountId",
                label: LocConstants.BackupDatabase.azureAccount,
                required: true,
                type: FormItemType.Dropdown,
                options: [],
                placeholder: LocConstants.ConnectionDialog.selectAnAccount,
                actionButtons: [],
                isAdvancedOption: false,
                groupName: url,
                validate(state, value) {
                    const isValid = value !== "" || !state.saveToUrl;
                    return {
                        isValid: isValid,
                        validationMessage: isValid
                            ? ""
                            : LocConstants.BackupDatabase.azureAccountIsRequired,
                    };
                },
            }),

            tenantId: createFormItem({
                propertyName: "tenantId",
                label: LocConstants.BackupDatabase.tenant,
                required: true,
                type: FormItemType.Dropdown,
                options: [],
                placeholder: LocConstants.ConnectionDialog.selectATenant,
                groupName: url,
                validate(state, value) {
                    const isValid = value !== "" || !state.saveToUrl;
                    return {
                        isValid: isValid,
                        validationMessage: isValid
                            ? ""
                            : LocConstants.BackupDatabase.tenantIsRequired,
                    };
                },
            }),

            subscriptionId: createFormItem({
                propertyName: "subscriptionId",
                label: LocConstants.BackupDatabase.subscription,
                required: true,
                type: FormItemType.SearchableDropdown,
                options: [],
                placeholder: LocConstants.BackupDatabase.selectASubscription,
                groupName: url,
                validate(state, value) {
                    const isValid = value !== "" || !state.saveToUrl;
                    return {
                        isValid: isValid,
                        validationMessage: isValid
                            ? ""
                            : LocConstants.BackupDatabase.subscriptionIsRequired,
                    };
                },
            }),

            storageAccountId: createFormItem({
                propertyName: "storageAccountId",
                label: LocConstants.BackupDatabase.storageAccount,
                required: true,
                type: FormItemType.SearchableDropdown,
                options: [],
                placeholder: LocConstants.BackupDatabase.selectAStorageAccount,
                groupName: url,
                validate(state, value) {
                    const isValid = value !== "" || !state.saveToUrl;
                    return {
                        isValid: isValid,
                        validationMessage: isValid
                            ? ""
                            : LocConstants.BackupDatabase.storageAccountIsRequired,
                    };
                },
            }),

            blobContainerId: createFormItem({
                propertyName: "blobContainerId",
                label: LocConstants.BackupDatabase.blobContainer,
                required: true,
                type: FormItemType.SearchableDropdown,
                options: [],
                placeholder: LocConstants.BackupDatabase.selectABlobContainer,
                groupName: url,
                validate(state, value) {
                    const isValid = value !== "" || !state.saveToUrl;
                    return {
                        isValid: isValid,
                        validationMessage: isValid
                            ? ""
                            : LocConstants.BackupDatabase.blobContainerIsRequired,
                    };
                },
            }),

            backupCompression: createFormItem({
                type: FormItemType.Dropdown,
                propertyName: "backupCompression",
                label: LocConstants.BackupDatabase.backupCompression,
                options: this.getCompressionOptions(),
                isAdvancedOption: true,
                groupName: LocConstants.BackupDatabase.compression,
            }),

            mediaSet: createFormItem({
                type: FormItemType.Dropdown,
                propertyName: "mediaSet",
                label: LocConstants.BackupDatabase.backupMediaSet,
                options: this.getMediaSetOptions(),
                isAdvancedOption: true,
                groupName: LocConstants.BackupDatabase.media,
                validate(state, value) {
                    const isValid =
                        !state.backupFiles.some((file) => file.isExisting) ||
                        value === MediaSet.Create;
                    return {
                        isValid: isValid,
                        validationMessage: isValid
                            ? ""
                            : LocConstants.BackupDatabase.pleaseChooseValidMediaOption,
                    };
                },
            }),

            mediaSetName: createFormItem({
                type: FormItemType.Input,
                propertyName: "mediaSetName",
                label: LocConstants.BackupDatabase.newMediaSetName,
                isAdvancedOption: true,
                groupName: LocConstants.BackupDatabase.media,
                validate(state, value) {
                    const isValid =
                        !state.backupFiles.some((file) => file.isExisting) ||
                        value.toString().trim() !== "";
                    return {
                        isValid: isValid,
                        validationMessage: isValid
                            ? ""
                            : LocConstants.BackupDatabase.mediaSetNameIsRequired,
                    };
                },
            }),

            mediaSetDescription: createFormItem({
                type: FormItemType.Input,
                propertyName: "mediaSetDescription",
                label: LocConstants.BackupDatabase.newMediaSetDescription,
                isAdvancedOption: true,
                groupName: LocConstants.BackupDatabase.media,
                validate(state, value) {
                    const isValid =
                        !state.backupFiles.some((file) => file.isExisting) ||
                        value.toString().trim() !== "";
                    return {
                        isValid: isValid,
                        validationMessage: isValid
                            ? ""
                            : LocConstants.BackupDatabase.mediaSetDescriptionIsRequired,
                    };
                },
            }),

            performChecksum: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "performChecksum",
                label: LocConstants.BackupDatabase.performChecksum,
                isAdvancedOption: true,
                groupName: LocConstants.BackupDatabase.reliability,
            }),

            verifyBackup: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "verifyBackup",
                label: LocConstants.BackupDatabase.verifyBackup,
                isAdvancedOption: true,
                groupName: LocConstants.BackupDatabase.reliability,
            }),

            continueOnError: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "continueOnError",
                label: LocConstants.BackupDatabase.continueOnError,
                isAdvancedOption: true,
                groupName: LocConstants.BackupDatabase.reliability,
            }),

            transactionLog: createFormItem({
                type: FormItemType.Dropdown,
                propertyName: "transactionLog",
                label: LocConstants.BackupDatabase.transactionLog,
                options: this.getTransactionLogOptions(),
                isAdvancedOption: true,
                groupName: LocConstants.BackupDatabase.transactionLog,
            }),

            retainDays: createFormItem({
                type: FormItemType.Input,
                propertyName: "retainDays",
                label: LocConstants.BackupDatabase.retainDays,
                isAdvancedOption: true,
                groupName: LocConstants.BackupDatabase.expiration,
                componentProps: {
                    inputMode: "numeric",
                },
            }),

            encryptionEnabled: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "encryptionEnabled",
                label: LocConstants.BackupDatabase.enableEncryption,
                isAdvancedOption: true,
                groupName: LocConstants.BackupDatabase.encryption,
            }),

            encryptionAlgorithm: createFormItem({
                type: FormItemType.Dropdown,
                propertyName: "encryptionAlgorithm",
                label: LocConstants.BackupDatabase.encryptionAlgorithm,
                options: this.getEncryptionAlgorithmOptions(),
                isAdvancedOption: true,
                groupName: LocConstants.BackupDatabase.encryption,
            }),

            encryptorName: createFormItem({
                type: FormItemType.Dropdown,
                propertyName: "encryptorName",
                label: LocConstants.BackupDatabase.encryptionType,
                options: this.getEncryptorNameOptions(),
                isAdvancedOption: true,
                groupName: LocConstants.BackupDatabase.encryption,
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
        if (this.state.databaseName !== defaultDatabase) {
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

    /**
     * Get's the media set options, disabling Append and Overwrite if creating a backup to existing files
     * @param isExisting whether creating a backup to existing files
     * @returns Media set options
     */
    private getMediaSetOptions(isExisting?: boolean): FormItemOptions[] {
        return [
            {
                displayName: LocConstants.BackupDatabase.append,
                value: MediaSet.Append,
                color: isExisting ? "colorNeutralForegroundDisabled" : "",
                description: isExisting
                    ? LocConstants.BackupDatabase.unavailableForBackupsToExistingFiles
                    : "",
                icon: isExisting ? "Warning20Regular" : "",
            },
            {
                displayName: LocConstants.BackupDatabase.overwrite,
                value: MediaSet.Overwrite,
                color: isExisting ? "colorNeutralForegroundDisabled" : "",
                description: isExisting
                    ? LocConstants.BackupDatabase.unavailableForBackupsToExistingFiles
                    : "",
                icon: isExisting ? "Warning20Regular" : "",
            },
            {
                displayName: LocConstants.BackupDatabase.create,
                value: MediaSet.Create,
            },
        ];
    }

    /**
     * Sets media options and advanced option visibility based on whether there are existing files
     * @param state The current state of the backup database form
     * @returns The updated state with media options set
     */
    private setMediaOptionsIfExistingFiles(state: BackupDatabaseState): BackupDatabaseState {
        const { mediaSet, mediaSetName, mediaSetDescription } = state.formComponents;
        const hasExistingFiles = state.backupFiles.some((f) => f.isExisting);
        const setByExistingFiles = !mediaSet.isAdvancedOption;

        // If there are existing files, and media set was not already set by existing files, set to Create
        if (hasExistingFiles) {
            state.formState.mediaSet = MediaSet.Create;
        } else if (setByExistingFiles) {
            state.formState.mediaSet = MediaSet.Append;
        }

        mediaSet.isAdvancedOption = !hasExistingFiles;
        mediaSet.options = this.getMediaSetOptions(hasExistingFiles);

        [mediaSetName, mediaSetDescription].forEach((c) => {
            c.isAdvancedOption = !hasExistingFiles;
            c.required = hasExistingFiles;
        });

        return state;
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

    //#endregion
    //#region Azure Loading and Helpers
    private async getAzureActionButton(
        state: BackupDatabaseState,
    ): Promise<FormItemActionButton[]> {
        const accountFormComponentId = "accountId";

        const actionButtons: FormItemActionButton[] = [];
        actionButtons.push({
            label:
                state.formState.accountId === ""
                    ? LocConstants.ConnectionDialog.signIn
                    : LocConstants.ConnectionDialog.addAccount,
            id: "azureSignIn",
            callback: async () => {
                // Force sign in prompt
                void VsCodeAzureHelper.signIn(true);

                const accountsComponent = state.formComponents[accountFormComponentId];

                const azureAccounts = await VsCodeAzureHelper.getAccounts();
                accountsComponent.options = azureAccounts.map((account) => ({
                    displayName: account.label,
                    value: account.id,
                }));

                // There should always be at least one account, because the user just went through the sign in workflow
                if (azureAccounts.length !== 0) {
                    state.formState.accountId = azureAccounts[0].id;
                }

                const accountComponent = state.formComponents["accountId"];
                accountComponent.actionButtons = await this.getAzureActionButton(state);
            },
        });
        return actionButtons;
    }

    /**
     * Loads the Azure Account component options
     * @param state Current backup database state
     * @returns Updated backup database state with account component options loaded
     */
    private async loadAccountComponent(state: BackupDatabaseState): Promise<BackupDatabaseState> {
        const accountComponent = state.formComponents["accountId"];
        const azureAccounts = await VsCodeAzureHelper.getAccounts();
        const azureAccountOptions = azureAccounts.map((account) => ({
            displayName: account.label,
            value: account.id,
        }));
        state.formState.accountId = azureAccounts.length > 0 ? azureAccounts[0].id : "";

        accountComponent.options = azureAccountOptions;
        accountComponent.actionButtons = await this.getAzureActionButton(state);

        return state;
    }

    /**
     * Loads the Azure tenant options
     * @param state Current backup database state
     * @returns Updated backup database state with tenant component options loaded
     */
    private async loadTenantComponent(state: BackupDatabaseState): Promise<BackupDatabaseState> {
        const tenantComponent = state.formComponents["tenantId"];

        // If no account selected, set error state and return
        if (!state.formState.accountId) {
            state.azureComponentStatuses["tenantId"] = ApiStatus.Error;
            tenantComponent.placeholder = LocConstants.BackupDatabase.noTenantsFound;
            return state;
        }

        // Load tenants for selected account
        const tenants = await VsCodeAzureHelper.getTenantsForAccount(state.formState.accountId);
        const tenantOptions = tenants.map((tenant) => ({
            displayName: tenant.displayName,
            value: tenant.tenantId,
        }));

        // Set associated state values
        tenantComponent.options = tenantOptions;
        tenantComponent.placeholder = tenants.length
            ? LocConstants.ConnectionDialog.selectATenant
            : LocConstants.BackupDatabase.noTenantsFound;
        state.formState.tenantId = getDefaultTenantId(state.formState.accountId, tenants);
        state.tenants = tenants;

        return state;
    }

    /**
     * Loads the Azure subscription options
     * @param state Current backup database state
     * @returns Updated backup database state with subscription component options loaded
     */
    private async loadSubscriptionComponent(
        state: BackupDatabaseState,
    ): Promise<BackupDatabaseState> {
        const subscriptionComponent = state.formComponents["subscriptionId"];

        // if no tenant selected, set error state and return
        if (!state.formState.tenantId) {
            state.azureComponentStatuses["subscriptionId"] = ApiStatus.Error;
            subscriptionComponent.placeholder = LocConstants.BackupDatabase.noSubscriptionsFound;
            return state;
        }

        // Load subscriptions for selected tenant
        const tenant = state.tenants.find((t) => t.tenantId === state.formState.tenantId);
        const subscriptions = await VsCodeAzureHelper.getSubscriptionsForTenant(tenant);
        const subscriptionOptions = subscriptions.map((subscription) => ({
            displayName: subscription.name,
            value: subscription.subscriptionId,
        }));

        // Set associated state values
        subscriptionComponent.options = subscriptionOptions;
        state.formState.subscriptionId =
            subscriptionOptions.length > 0 ? subscriptionOptions[0].value : "";
        subscriptionComponent.placeholder = subscriptions.length
            ? LocConstants.BackupDatabase.selectASubscription
            : LocConstants.BackupDatabase.noSubscriptionsFound;
        state.subscriptions = subscriptions;

        return state;
    }

    /**
     * Loads the Azure storage account options
     * @param state Current backup database state
     * @returns Updated backup database state with storage account component options loaded
     */
    private async loadStorageAccountComponent(
        state: BackupDatabaseState,
    ): Promise<BackupDatabaseState> {
        const storageAccountComponent = state.formComponents["storageAccountId"];

        // if no subscription selected, set error state and return
        if (!state.formState.subscriptionId) {
            state.azureComponentStatuses["storageAccountId"] = ApiStatus.Error;
            storageAccountComponent.placeholder =
                LocConstants.BackupDatabase.noStorageAccountsFound;
            return state;
        }

        // Load storage accounts for selected subscription
        const subscription = state.subscriptions.find(
            (s) => s.subscriptionId === state.formState.subscriptionId,
        );
        const storageAccounts =
            await VsCodeAzureHelper.fetchStorageAccountsForSubscription(subscription);
        const storageAccountOptions = storageAccounts.map((account) => ({
            displayName: account.name,
            value: account.id,
        }));

        // Set associated state values
        storageAccountComponent.options = storageAccountOptions;
        state.formState.storageAccountId =
            storageAccountOptions.length > 0 ? storageAccountOptions[0].value : "";
        storageAccountComponent.placeholder = storageAccountOptions.length
            ? LocConstants.BackupDatabase.selectAStorageAccount
            : LocConstants.BackupDatabase.noStorageAccountsFound;
        state.storageAccounts = storageAccounts;

        return state;
    }

    /**
     * Loads the Azure blob container options
     * @param state Current backup database state
     * @returns Updated backup database state with blob container component options loaded
     */
    private async loadBlobContainerComponent(
        state: BackupDatabaseState,
    ): Promise<BackupDatabaseState> {
        const blobContainerComponent = state.formComponents["blobContainerId"];

        // if no storage account or subscription selected, set error state and return
        if (!state.formState.storageAccountId || !state.formState.subscriptionId) {
            state.azureComponentStatuses["blobContainerId"] = ApiStatus.Error;
            blobContainerComponent.placeholder = LocConstants.BackupDatabase.noBlobContainersFound;
            return state;
        }

        // Load blob containers for selected storage account and subscription
        const subscription = state.subscriptions.find(
            (s) => s.subscriptionId === state.formState.subscriptionId,
        );
        const storageAccount = state.storageAccounts.find(
            (sa) => sa.id === state.formState.storageAccountId,
        );
        const blobContainers = await VsCodeAzureHelper.fetchBlobContainersForStorageAccount(
            subscription,
            storageAccount,
        );
        const blobContainerOptions = blobContainers.map((container) => ({
            displayName: container.name,
            value: container.id,
        }));

        // Set associated state values
        blobContainerComponent.options = blobContainerOptions;
        state.formState.blobContainerId =
            blobContainerOptions.length > 0 ? blobContainerOptions[0].value : "";

        blobContainerComponent.placeholder = blobContainerOptions.length
            ? LocConstants.BackupDatabase.selectABlobContainer
            : LocConstants.BackupDatabase.noBlobContainersFound;
        state.blobContainers = blobContainers;

        return state;
    }

    /**
     * Reloads Azure components starting from the specified component
     * @param state Current backup database state
     * @param fromComponent Component ID to start reloading from
     * @returns Updated backup database state with components reloaded
     */
    private reloadAzureComponents(
        state: BackupDatabaseState,
        fromComponent: string,
    ): BackupDatabaseState {
        const azureComponents = Object.keys(state.azureComponentStatuses);
        const reloadComponentsFromIndex = azureComponents.indexOf(fromComponent) + 1;
        // for every component after the fromComponent, set status to NotStarted to trigger reload
        for (let i = reloadComponentsFromIndex; i < azureComponents.length; i++) {
            state.azureComponentStatuses[azureComponents[i]] = ApiStatus.NotStarted;
            state.formComponents[azureComponents[i]].options = [];
            state.formState[azureComponents[i]] = "";
        }
        return state;
    }
    //#endregion
}
