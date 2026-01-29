/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import VscodeWrapper from "./vscodeWrapper";
import {
    BackupComponent,
    BackupCompression,
    BackupDatabaseParams,
    BackupDatabaseViewModel,
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
    PhysicalDeviceType,
} from "../sharedInterfaces/backup";
import { ApiStatus } from "../sharedInterfaces/webview";
import * as Constants from "../constants/constants";
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
import { getCloudProviderSettings } from "../azure/providerSettings";
import { AzureBlobService } from "../models/contracts/azureBlob";
import { getExpirationDateForSas } from "../utils/utils";
import { TaskExecutionMode } from "../sharedInterfaces/schemaCompare";
import { sendActionEvent } from "../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { BlobContainer, StorageAccount } from "@azure/arm-storage";
import { onTaskCompleted, TaskCompletedEvent } from "../services/sqlTasksService";
import { ObjectManagementWebviewController } from "./objectManagementWebviewController";
import {
    ObjectManagementActionParams,
    ObjectManagementActionResult,
    ObjectManagementDialogType,
    ObjectManagementFormItemSpec,
    ObjectManagementFormState,
    ObjectManagementWebviewState,
} from "../sharedInterfaces/objectManagement";
import { ObjectManagementService } from "../services/objectManagementService";

export class BackupDatabaseWebviewController extends ObjectManagementWebviewController {
    public readonly BACKUP_DATABASE_TASK_NAME = "Backup Database";
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        objectManagementService: ObjectManagementService,
        private fileBrowserService: FileBrowserService,
        private azureBlobService: AzureBlobService,
        connectionUri: string,
        serverName: string,
        databaseName: string,
        parentUrn?: string,
        dialogTitle?: string,
    ) {
        super(
            context,
            vscodeWrapper,
            objectManagementService,
            ObjectManagementDialogType.BackupDatabase,
            dialogTitle ?? LocConstants.BackupDatabase.backupDatabaseTitle(databaseName),
            "backupDatabaseDialog",
            connectionUri,
            serverName,
            databaseName,
            parentUrn,
        );

        this.start();
    }

    protected async initializeDialog(): Promise<void> {
        const backupModel = new BackupDatabaseViewModel();
        this.state.ownerUri = this.connectionUri;

        // Get backup config info; Gets the recovery model, default backup folder, and encryptors
        const backupConfigInfo = (
            await this.objectManagementService.getBackupConfigInfo(this.state.ownerUri)
        )?.backupConfigInfo;

        // File Browser setup
        this.state.defaultFileBrowserExpandPath = backupConfigInfo.defaultBackupFolder;
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

        backupModel.databaseName = this.databaseName;
        backupModel.backupEncryptors = backupConfigInfo.backupEncryptors;
        backupModel.recoveryModel = backupConfigInfo.recoveryModel;

        // Set default backup file props
        backupModel.defaultBackupName = this.getDefaultBackupFileName(backupModel);
        backupModel.backupFiles = [
            {
                filePath: `${this.state.defaultFileBrowserExpandPath}/${backupModel.defaultBackupName}`,
                isExisting: false,
            },
        ];

        // Set initial azure component statuses
        backupModel.azureComponentStatuses = {
            accountId: ApiStatus.NotStarted,
            tenantId: ApiStatus.NotStarted,
            subscriptionId: ApiStatus.NotStarted,
            storageAccountId: ApiStatus.NotStarted,
            blobContainerId: ApiStatus.NotStarted,
        };

        this.state.viewModel.model = backupModel;

        // Set default form values
        this.state.formComponents = this.setFormComponents();
        this.state.formState = {
            backupName: backupModel.defaultBackupName,
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
            encryptorName: backupModel.backupEncryptors.length
                ? backupModel.backupEncryptors[0].encryptorName
                : undefined,
            retainDays: 0,
            accountId: "",
            tenantId: "",
            subscriptionId: "",
            storageAccountId: "",
            blobContainerId: "",
        };

        // Handle task completed events to close the webview if the backup task completed
        onTaskCompleted((taskCompletedEvent: TaskCompletedEvent) => {
            const { task, progress } = taskCompletedEvent;
            if (task.name === this.BACKUP_DATABASE_TASK_NAME && progress.script) {
                let includesBackupLocation = false;
                if (!backupModel.saveToUrl) {
                    const filePaths = backupModel.backupFiles.map((file) => file.filePath);
                    includesBackupLocation = filePaths.every((path) =>
                        progress.script?.includes(path),
                    );
                } else {
                    includesBackupLocation = progress.script?.includes(backupModel.backupUrl);
                }

                if (includesBackupLocation) {
                    this.panel.dispose();
                    this.dispose();
                }
            }
        });

        sendActionEvent(TelemetryViews.Backup, TelemetryActions.StartBackup);

        this.registerBackupRpcHandlers();
        this.updateState();
        backupModel.loadState = ApiStatus.Loaded;
    }

    protected get helpLink(): string {
        return Constants.backupDatabaseHelpLink;
    }

    protected handleScript(
        params: ObjectManagementActionParams["params"],
    ): Promise<ObjectManagementActionResult> {
        const backupParams = params as BackupDatabaseParams;
        return this.backupHelper(backupParams.taskExecutionMode, backupParams.state);
    }

    protected handleSubmit(
        params: ObjectManagementActionParams["params"],
    ): Promise<ObjectManagementActionResult> {
        const backupParams = params as BackupDatabaseParams;
        return this.backupHelper(backupParams.taskExecutionMode, backupParams.state);
    }

    private registerBackupRpcHandlers() {
        this.registerReducer("formAction", async (state, payload) => {
            // isAction indicates whether the event was triggered by an action button
            if (payload.event.isAction) {
                const component = state.formComponents[payload.event.propertyName];
                if (component && component.actionButtons) {
                    const actionButton = component.actionButtons.find(
                        (b) => b.id === payload.event.value,
                    );
                    if (actionButton?.callback) {
                        await actionButton.callback();
                    }
                }
                // Only action form event is for account id, so reload dependent components
                state = this.reloadAzureComponents(state, payload.event.propertyName);
            } else {
                // formAction is a normal form item value change; update form state
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
                const [componentFormError] = await this.validateForm(
                    state.formState,
                    payload.event.propertyName,
                    true,
                );
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
            void this.backupHelper(TaskExecutionMode.executeAndScript, state);

            const backupViewModel = this.backupViewModel(state);

            sendActionEvent(TelemetryViews.Backup, TelemetryActions.Backup, {
                backupToUrl: backupViewModel.saveToUrl ? "true" : "false",
                backupWithExistingFiles:
                    backupViewModel.saveToUrl &&
                    backupViewModel.backupFiles.some((file) => file.isExisting)
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
            const backupViewModel = this.backupViewModel(state);
            backupViewModel.saveToUrl = payload.saveToUrl;
            state.viewModel.model = backupViewModel;
            state.formErrors = [];
            return state;
        });

        this.registerReducer("removeBackupFile", async (state, payload) => {
            const backupViewModel = this.backupViewModel(state);
            backupViewModel.backupFiles = backupViewModel.backupFiles.filter(
                (file) => file.filePath !== payload.filePath,
            );
            state.viewModel.model = backupViewModel;
            return this.setMediaOptionsIfExistingFiles(state);
        });

        this.registerReducer("handleFileChange", async (state, payload) => {
            const backupViewModel = this.backupViewModel(state);
            const currentFilePath = backupViewModel.backupFiles[payload.index].filePath;
            let newFilePath: string = "";
            if (payload.isFolderChange) {
                newFilePath = `${payload.newValue}/${currentFilePath.substring(
                    currentFilePath.lastIndexOf("/") + 1,
                )}`;
            } else {
                newFilePath = `${currentFilePath.substring(0, currentFilePath.lastIndexOf("/") + 1)}${payload.newValue}`;
            }
            backupViewModel.backupFiles[payload.index].filePath = newFilePath;
            state.viewModel.model = backupViewModel;
            return state;
        });

        this.registerReducer("loadAzureComponent", async (state, payload) => {
            let backupViewModel = this.backupViewModel(state);
            // Only start loading if not already started
            if (
                backupViewModel.azureComponentStatuses[payload.componentName] !==
                ApiStatus.NotStarted
            )
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

            backupViewModel = this.backupViewModel(state);
            backupViewModel.azureComponentStatuses[payload.componentName] = ApiStatus.Loaded;
            state.viewModel.model = backupViewModel;

            return state;
        });

        registerFileBrowserReducers(
            this as ReactWebviewPanelController<FileBrowserWebviewState, FileBrowserReducers, any>,
            this.fileBrowserService,
            defaultBackupFileTypes,
        );

        // Override default file browser submitFilePath reducer
        this.registerReducer("submitFilePath", async (state, payload) => {
            const backupViewModel = this.backupViewModel(state);
            // Check if an existing file was selected
            const isExisting = payload.selectedPath.includes(".");

            // Folder selected, generate default backup name
            if (!isExisting) {
                const defaultFileName = this.getDefaultBackupFileName(backupViewModel);
                payload.selectedPath = `${payload.selectedPath}/${defaultFileName}`;
            }

            const paths = backupViewModel.backupFiles.map((f) => f.filePath);
            if (!paths.includes(payload.selectedPath)) {
                backupViewModel.backupFiles.push({
                    filePath: payload.selectedPath,
                    isExisting: isExisting,
                });
            }

            // Update media options if there are existing files
            state.viewModel.model = backupViewModel;
            return this.setMediaOptionsIfExistingFiles(state);
        });
    }

    private backupViewModel(state?: ObjectManagementWebviewState): BackupDatabaseViewModel {
        const webviewState = state ?? this.state;
        return webviewState.viewModel.model as BackupDatabaseViewModel;
    }

    /**
     * Generates a default backup file name based on database name and number of new files
     * @param state Current backup database state
     * @returns Default backup file name
     */
    private getDefaultBackupFileName(state: BackupDatabaseViewModel): string {
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
        state: ObjectManagementWebviewState,
    ): Promise<ObjectManagementActionResult> {
        const backupViewModel = this.backupViewModel(state);
        const createNewMediaSet = state.formState.mediaSet === MediaSet.Create;
        const overwriteMediaSet = state.formState.mediaSet === MediaSet.Overwrite;

        let encryptor: BackupEncryptor = {
            encryptorType: undefined,
            encryptorName: "",
        };
        if (state.formState.encryptionEnabled) {
            encryptor = backupViewModel.backupEncryptors.find(
                (be) => be.encryptorName === state.formState.encryptorName,
            );
        }

        const backupPathDevices: Record<string, MediaDeviceType> = {};
        const backupPathList: string[] = [];

        // If saving to URL, construct the Blob URL and get SAS token
        if (backupViewModel.saveToUrl) {
            const accountEndpoint =
                getCloudProviderSettings().settings.azureStorageResource.endpoint.replace(
                    https,
                    "",
                );
            const subscription = backupViewModel.subscriptions.find(
                (s) => s.subscriptionId === state.formState.subscriptionId,
            );
            const storageAccount = backupViewModel.storageAccounts.find(
                (sa) => sa.id === state.formState.storageAccountId,
            );
            const blobContainer = backupViewModel.blobContainers.find(
                (bc) => bc.id === state.formState.blobContainerId,
            );

            const blobContainerUrl = `${https}${storageAccount.name}.${accountEndpoint}${blobContainer.name}`;
            const backupUrl = `${blobContainerUrl}/${state.formState.backupName}`;
            backupViewModel.backupUrl = backupUrl;
            backupPathDevices[backupUrl] = MediaDeviceType.Url;
            backupPathList.push(backupUrl);

            let sasKeyResult;
            try {
                sasKeyResult = await VsCodeAzureHelper.getStorageAccountKeys(
                    subscription,
                    storageAccount,
                );
            } catch (error) {
                vscode.window.showErrorMessage(
                    LocConstants.BackupDatabase.generatingSASKeyFailedWithError(error.message),
                );
                return;
            }

            void this.azureBlobService.createSas(
                this.connectionUri,
                blobContainerUrl,
                sasKeyResult.keys[0].value,
                storageAccount.name,
                getExpirationDateForSas(),
            );
        } else {
            for (const file of backupViewModel.backupFiles) {
                backupPathDevices[file.filePath] = MediaDeviceType.File;
                backupPathList.push(file.filePath);
            }
        }

        const backupInfo: BackupInfo = {
            databaseName: backupViewModel.databaseName,
            backupType: getBackupTypeNumber(state.formState.backupType),
            backupComponent: BackupComponent.Database, // always database for this scenario
            backupDeviceType: backupViewModel.saveToUrl
                ? PhysicalDeviceType.Url
                : PhysicalDeviceType.Disk, // always disk or URL
            selectedFiles: undefined,
            backupsetName: state.formState.backupName ?? backupViewModel.defaultBackupName,
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
        const backupResult = await this.objectManagementService.backupDatabase(
            this.connectionUri,
            backupInfo,
            mode,
        );
        return { success: backupResult.result };
    }

    //#region Form Helpers
    protected setFormComponents(): Record<
        string,
        FormItemSpec<
            ObjectManagementFormState,
            ObjectManagementWebviewState,
            ObjectManagementFormItemSpec
        >
    > {
        const createFormItem = (
            spec: Partial<ObjectManagementFormItemSpec>,
        ): ObjectManagementFormItemSpec =>
            ({
                required: false,
                ...spec,
            }) as ObjectManagementFormItemSpec;

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
                componentWidth: "420px",
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
                    const backupViewModel = state.viewModel.model as BackupDatabaseViewModel;
                    const isValid = value !== "" || !backupViewModel.saveToUrl;
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
                    const backupViewModel = state.viewModel.model as BackupDatabaseViewModel;
                    const isValid = value !== "" || !backupViewModel.saveToUrl;
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
                    const backupViewModel = state.viewModel.model as BackupDatabaseViewModel;
                    const isValid = value !== "" || !backupViewModel.saveToUrl;
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
                    const backupViewModel = state.viewModel.model as BackupDatabaseViewModel;
                    const isValid = value !== "" || !backupViewModel.saveToUrl;
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
                    const backupViewModel = state.viewModel.model as BackupDatabaseViewModel;
                    const isValid = value !== "" || !backupViewModel.saveToUrl;
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
                    const backupViewModel = state.viewModel.model as BackupDatabaseViewModel;
                    const isValid =
                        !backupViewModel.backupFiles.some((file) => file.isExisting) ||
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
                    const backupViewModel = state.viewModel.model as BackupDatabaseViewModel;
                    const isValid =
                        !backupViewModel.backupFiles.some((file) => file.isExisting) ||
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
                    const backupViewModel = state.viewModel.model as BackupDatabaseViewModel;
                    const isValid =
                        !backupViewModel.backupFiles.some((file) => file.isExisting) ||
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
        if (this.backupViewModel().databaseName !== defaultDatabase) {
            backupTypeOptions.push({
                displayName: LocConstants.BackupDatabase.differential,
                value: BackupType.Differential,
            });
        }
        // Only add Transaction Log option if the database is not in Simple recovery model
        if (this.backupViewModel().recoveryModel !== simple) {
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
    private setMediaOptionsIfExistingFiles(
        state: ObjectManagementWebviewState,
    ): ObjectManagementWebviewState {
        const backupViewModel = this.backupViewModel(state);

        const { mediaSet, mediaSetName, mediaSetDescription } = state.formComponents;
        const hasExistingFiles = backupViewModel.backupFiles.some((f) => f.isExisting);
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

        state.viewModel.model = backupViewModel;
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
        return this.backupViewModel().backupEncryptors.map((be) => ({
            displayName: be.encryptorName,
            value: be.encryptorName,
        }));
    }
    //#endregion

    //#region Azure Loading and Helpers
    private async getAzureActionButton(
        state: ObjectManagementWebviewState,
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
                await VsCodeAzureHelper.signIn(true);

                const accountsComponent = state.formComponents[accountFormComponentId];

                const azureAccounts = await VsCodeAzureHelper.getAccounts();
                accountsComponent.options = azureAccounts.map((account) => ({
                    displayName: account.label,
                    value: account.id,
                }));

                // There should always be at least one account, because the user just went through the sign in workflow
                if (azureAccounts.length !== 0) {
                    state.formState.accountId = azureAccounts[azureAccounts.length - 1].id;
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
    private async loadAccountComponent(
        state: ObjectManagementWebviewState,
    ): Promise<ObjectManagementWebviewState> {
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
    private async loadTenantComponent(
        state: ObjectManagementWebviewState,
    ): Promise<ObjectManagementWebviewState> {
        const backupViewModel = this.backupViewModel(state);
        const tenantComponent = state.formComponents["tenantId"];

        // If no account selected, set error state and return
        if (!state.formState.accountId) {
            backupViewModel.azureComponentStatuses["tenantId"] = ApiStatus.Error;
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
        backupViewModel.tenants = tenants;

        state.viewModel.model = backupViewModel;
        return state;
    }

    /**
     * Loads the Azure subscription options
     * @param state Current backup database state
     * @returns Updated backup database state with subscription component options loaded
     */
    private async loadSubscriptionComponent(
        state: ObjectManagementWebviewState,
    ): Promise<ObjectManagementWebviewState> {
        const backupViewModel = this.backupViewModel(state);
        const subscriptionComponent = state.formComponents["subscriptionId"];

        // if no tenant selected, set error state and return
        if (!state.formState.tenantId) {
            backupViewModel.azureComponentStatuses["subscriptionId"] = ApiStatus.Error;
            subscriptionComponent.placeholder = LocConstants.BackupDatabase.noSubscriptionsFound;
            return state;
        }

        // Load subscriptions for selected tenant
        const tenant = backupViewModel.tenants.find((t) => t.tenantId === state.formState.tenantId);
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
        backupViewModel.subscriptions = subscriptions;

        state.viewModel.model = backupViewModel;
        return state;
    }

    /**
     * Loads the Azure storage account options
     * @param state Current backup database state
     * @returns Updated backup database state with storage account component options loaded
     */
    private async loadStorageAccountComponent(
        state: ObjectManagementWebviewState,
    ): Promise<ObjectManagementWebviewState> {
        const backupViewModel = this.backupViewModel(state);
        const storageAccountComponent = state.formComponents["storageAccountId"];

        // if no subscription selected, set error state and return
        if (!state.formState.subscriptionId) {
            backupViewModel.azureComponentStatuses["storageAccountId"] = ApiStatus.Error;
            storageAccountComponent.placeholder =
                LocConstants.BackupDatabase.noStorageAccountsFound;
            return state;
        }

        // Load storage accounts for selected subscription
        const subscription = backupViewModel.subscriptions.find(
            (s) => s.subscriptionId === state.formState.subscriptionId,
        );
        let storageAccounts: StorageAccount[] = [];
        try {
            storageAccounts =
                await VsCodeAzureHelper.fetchStorageAccountsForSubscription(subscription);
        } catch (error) {
            state.errorMessage = error.message;
        }
        const storageAccountOptions = storageAccounts.map((account) => ({
            displayName: account.name,
            value: account.id,
        }));

        // Set associated state values
        storageAccountComponent.options = storageAccountOptions;
        state.formState.storageAccountId =
            storageAccountOptions.length > 0 ? storageAccountOptions[0].value : "";
        storageAccountComponent.placeholder =
            storageAccounts.length > 0
                ? LocConstants.BackupDatabase.selectAStorageAccount
                : LocConstants.BackupDatabase.noStorageAccountsFound;
        backupViewModel.storageAccounts = storageAccounts;

        state.viewModel.model = backupViewModel;
        return state;
    }

    /**
     * Loads the Azure blob container options
     * @param state Current backup database state
     * @returns Updated backup database state with blob container component options loaded
     */
    private async loadBlobContainerComponent(
        state: ObjectManagementWebviewState,
    ): Promise<ObjectManagementWebviewState> {
        const backupViewModel = this.backupViewModel(state);
        const blobContainerComponent = state.formComponents["blobContainerId"];

        // if no storage account or subscription selected, set error state and return
        if (!state.formState.storageAccountId || !state.formState.subscriptionId) {
            backupViewModel.azureComponentStatuses["blobContainerId"] = ApiStatus.Error;
            blobContainerComponent.placeholder = LocConstants.BackupDatabase.noBlobContainersFound;
            return state;
        }

        // Load blob containers for selected storage account and subscription
        const subscription = backupViewModel.subscriptions.find(
            (s) => s.subscriptionId === state.formState.subscriptionId,
        );
        const storageAccount = backupViewModel.storageAccounts.find(
            (sa) => sa.id === state.formState.storageAccountId,
        );

        let blobContainers: BlobContainer[] = [];
        try {
            blobContainers = await VsCodeAzureHelper.fetchBlobContainersForStorageAccount(
                subscription,
                storageAccount,
            );
        } catch (error) {
            state.errorMessage = error.message;
        }

        const blobContainerOptions = blobContainers.map((container) => ({
            displayName: container.name,
            value: container.id,
        }));

        // Set associated state values
        blobContainerComponent.options = blobContainerOptions;
        state.formState.blobContainerId =
            blobContainers.length > 0 ? blobContainerOptions[0].value : "";
        blobContainerComponent.placeholder =
            blobContainers.length > 0
                ? LocConstants.BackupDatabase.selectABlobContainer
                : LocConstants.BackupDatabase.noBlobContainersFound;
        backupViewModel.blobContainers = blobContainers;

        state.viewModel.model = backupViewModel;
        return state;
    }

    /**
     * Reloads Azure components starting from the specified component
     * @param state Current backup database state
     * @param formComponent Component ID to start reloading from
     * @returns Updated backup database state with components reloaded
     */
    private reloadAzureComponents(
        state: ObjectManagementWebviewState,
        formComponent: string,
    ): ObjectManagementWebviewState {
        const backupViewModel = this.backupViewModel(state);
        const azureComponents = Object.keys(backupViewModel.azureComponentStatuses);
        const reloadComponentsFromIndex = azureComponents.indexOf(formComponent) + 1;

        // for every component after the formComponent, set status to NotStarted to trigger reload
        for (let i = reloadComponentsFromIndex; i < azureComponents.length; i++) {
            backupViewModel.azureComponentStatuses[azureComponents[i]] = ApiStatus.NotStarted;
            state.formComponents[azureComponents[i]].options = [];
            state.formState[azureComponents[i]] = "";
        }

        state.viewModel.model = backupViewModel;
        return state;
    }
    //#endregion
}
