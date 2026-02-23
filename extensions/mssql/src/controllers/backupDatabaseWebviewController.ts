/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import VscodeWrapper from "./vscodeWrapper";
import {
    BackupComponent,
    BackupCompression,
    BackupDatabaseFormState,
    BackupConfigInfo,
    BackupDatabaseParams,
    BackupDatabaseReducers,
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
import * as LocConstants from "../constants/locConstants";
import { FormItemOptions, FormItemSpec, FormItemType } from "../sharedInterfaces/form";
import {
    allFileTypes,
    backupDatabaseHelpLink,
    defaultBackupFileTypes,
    defaultDatabase,
    simple,
    url,
} from "../constants/constants";
import { FileBrowserService } from "../services/fileBrowserService";
import { registerFileBrowserReducers } from "./fileBrowserUtils";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import { FileBrowserReducers, FileBrowserWebviewState } from "../sharedInterfaces/fileBrowser";
import { AzureBlobService } from "../models/contracts/azureBlob";
import { getErrorMessage } from "../utils/utils";
import { TaskExecutionMode } from "../sharedInterfaces/schemaCompare";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { onTaskCompleted, TaskCompletedEvent } from "../services/sqlTasksService";
import { ObjectManagementWebviewController } from "./objectManagementWebviewController";
import {
    DisasterRecoveryAzureFormState,
    DisasterRecoveryType,
    ObjectManagementActionParams,
    ObjectManagementActionResult,
    ObjectManagementDialogType,
    ObjectManagementFormItemSpec,
    ObjectManagementWebviewState,
} from "../sharedInterfaces/objectManagement";
import { ObjectManagementService } from "../services/objectManagementService";
import {
    createSasKey,
    disasterRecoveryFormAction,
    isAzureSqlDb,
    loadAzureComponentHelper,
    removeBackupFile,
    setType,
} from "./sharedDisasterRecoveryUtils";
import { ConnectionProfile } from "../models/connectionProfile";
import ConnectionManager from "./connectionManager";

export class BackupDatabaseWebviewController extends ObjectManagementWebviewController<
    BackupDatabaseFormState,
    BackupDatabaseReducers<BackupDatabaseFormState>
> {
    public readonly BACKUP_DATABASE_TASK_NAME = "Backup Database";
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        objectManagementService: ObjectManagementService,
        private connectionManager: ConnectionManager,
        private fileBrowserService: FileBrowserService,
        private azureBlobService: AzureBlobService,
        private profile: ConnectionProfile,
        private ownerUri: string,
        databaseName: string,
    ) {
        super(
            context,
            vscodeWrapper,
            objectManagementService,
            ObjectManagementDialogType.BackupDatabase,
            LocConstants.BackupDatabase.backupDatabaseTitle(databaseName),
            LocConstants.BackupDatabase.backupDatabaseTitle(databaseName),
            "backupDatabaseDialog",
            ownerUri,
            profile.server || "",
            databaseName,
        );

        this.start();
    }

    protected async initializeDialog(): Promise<void> {
        const backupModel = new BackupDatabaseViewModel();

        // Make sure the backup load state is set, so the loading ui properly displays
        this.updateViewModel(backupModel);

        backupModel.databaseName = this.databaseName;

        if (isAzureSqlDb(this.profile.server)) {
            backupModel.loadState = ApiStatus.Error;
            this.state.errorMessage = LocConstants.BackupDatabase.azureSqlDbNotSupported;
            this.updateViewModel(backupModel);
            return;
        }

        try {
            this.state.ownerUri = await this.createBackupConnectionContext(
                this.ownerUri,
                this.ownerUri,
                backupModel.databaseName,
                this.profile,
                this.connectionManager,
            );
        } catch (error) {
            backupModel.loadState = ApiStatus.Error;
            this.state.errorMessage = LocConstants.BackupDatabase.couldNotConnectToDatabase(
                backupModel.databaseName,
            );
            this.updateViewModel(backupModel);
            sendErrorEvent(
                TelemetryViews.Backup,
                TelemetryActions.InitializeBackup,
                new Error(LocConstants.BackupDatabase.couldNotConnectToDatabase("")),
                true, // include error message in telemetry
            );
        }

        this.onDisposed(() => {
            void this.connectionManager.disconnect(this.state.ownerUri);
        });

        // Get backup config info; Gets the recovery model, default backup folder, and encryptors
        let backupConfigInfo: BackupConfigInfo;
        let backupConfigError = "";
        try {
            backupConfigInfo = (
                await this.objectManagementService.getBackupConfigInfo(this.state.ownerUri)
            )?.backupConfigInfo;
        } catch (error) {
            backupConfigError = getErrorMessage(error);
        }
        if (backupConfigError || !backupConfigInfo) {
            backupModel.loadState = ApiStatus.Error;
            this.state.errorMessage =
                backupConfigError || LocConstants.BackupDatabase.unableToLoadBackupConfig;
            this.updateViewModel(backupModel);
            sendErrorEvent(
                TelemetryViews.Backup,
                TelemetryActions.InitializeBackup,
                new Error(LocConstants.BackupDatabase.unableToLoadBackupConfig),
                true, // include error message in telemetry
            );
            return;
        }

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

        this.updateViewModel(backupModel);

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
                const backupModel = this.backupViewModel();
                if (backupModel.type === DisasterRecoveryType.BackupFile) {
                    const filePaths = backupModel.backupFiles.map((file) => file.filePath);
                    includesBackupLocation = filePaths.every((path) =>
                        progress.script?.includes(path),
                    );
                } else {
                    includesBackupLocation = progress.script?.includes(backupModel.url);
                }

                if (includesBackupLocation) {
                    this.panel.dispose();
                    this.dispose();
                    sendActionEvent(TelemetryViews.Backup, TelemetryActions.FinishBackup);
                }
            }
        });

        sendActionEvent(TelemetryViews.Backup, TelemetryActions.InitializeBackup);

        this.registerBackupRpcHandlers();
        backupModel.loadState = ApiStatus.Loaded;

        this.updateState();
    }

    protected get helpLink(): string {
        return backupDatabaseHelpLink;
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
            return await disasterRecoveryFormAction<BackupDatabaseFormState>(state, payload);
        });

        this.registerReducer("backupDatabase", async (state, _payload) => {
            void this.backupHelper(TaskExecutionMode.executeAndScript, state);

            const backupViewModel = this.backupViewModel(state);

            sendActionEvent(TelemetryViews.Backup, TelemetryActions.Backup, {
                backupToUrl: backupViewModel.type === DisasterRecoveryType.Url ? "true" : "false",
                backupWithExistingFiles:
                    backupViewModel.type === DisasterRecoveryType.BackupFile &&
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

        this.registerReducer("setType", async (state, payload) => {
            return (await setType(
                state as ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
                payload,
            )) as ObjectManagementWebviewState<BackupDatabaseFormState>;
        });

        this.registerReducer("removeBackupFile", async (state, payload) => {
            state = (await removeBackupFile(
                state as ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
                payload,
            )) as ObjectManagementWebviewState<BackupDatabaseFormState>;
            return this.setMediaOptionsIfExistingFiles(state);
        });

        this.registerReducer("handleFileChange", async (state, payload) => {
            const backupViewModel = this.backupViewModel(state);
            const currentFilePath = backupViewModel.backupFiles[payload.index].filePath;
            let newFilePath = "";
            if (payload.isFolderChange) {
                newFilePath = `${payload.newValue}/${currentFilePath.substring(
                    currentFilePath.lastIndexOf("/") + 1,
                )}`;
            } else {
                newFilePath = `${currentFilePath.substring(0, currentFilePath.lastIndexOf("/") + 1)}${payload.newValue}`;
            }
            backupViewModel.backupFiles[payload.index].filePath = newFilePath;
            return this.updateViewModel(backupViewModel, state);
        });

        this.registerReducer("loadAzureComponent", async (state, payload) => {
            const loadResult = await loadAzureComponentHelper(
                state as ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
                payload,
            );
            return loadResult as ObjectManagementWebviewState<BackupDatabaseFormState>;
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
            return this.setMediaOptionsIfExistingFiles(
                this.updateViewModel(backupViewModel, state),
            );
        });
    }

    private backupViewModel(
        state?: ObjectManagementWebviewState<BackupDatabaseFormState>,
    ): BackupDatabaseViewModel {
        const webviewState = state ?? this.state;
        return webviewState.viewModel.model as BackupDatabaseViewModel;
    }

    private updateViewModel(
        updatedViewModel: BackupDatabaseViewModel,
        state?: ObjectManagementWebviewState<BackupDatabaseFormState>,
    ): ObjectManagementWebviewState<BackupDatabaseFormState> {
        this.state.viewModel.model = updatedViewModel;
        this.updateState(state);
        return this.state;
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
        state: ObjectManagementWebviewState<BackupDatabaseFormState>,
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
        if (backupViewModel.type === DisasterRecoveryType.Url) {
            const stateWithUrl = await createSasKey(
                state as ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
                this.connectionUri,
                this.azureBlobService,
            );
            const backupUrl = `${(stateWithUrl.viewModel.model as BackupDatabaseViewModel).url}/${state.formState.backupName}`;
            backupPathDevices[backupUrl] = MediaDeviceType.Url;
            backupPathList.push(backupUrl);
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
            backupDeviceType:
                backupViewModel.type === DisasterRecoveryType.Url
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
            state.ownerUri,
            backupInfo,
            mode,
        );
        return { success: backupResult.result };
    }

    private async createBackupConnectionContext(
        originalOwnerUri: string,
        currentConnectionUri: string,
        databaseName: string,
        profile: ConnectionProfile,
        connectionManager: ConnectionManager,
    ): Promise<string | undefined> {
        // If we have an existing connection for a different database, disconnect it
        if (currentConnectionUri && currentConnectionUri !== originalOwnerUri) {
            void connectionManager.disconnect(currentConnectionUri);
        }

        const databaseConnectionUri = `${databaseName}_${originalOwnerUri}`;

        // Create a new temp connection for the database if we are not already connected
        // This lets sts know the context of the database we are backing up; otherwise,
        // sts will assume the master database context
        const didConnect = await connectionManager.connect(databaseConnectionUri, {
            ...profile,
            database: databaseName,
        });

        if (didConnect) {
            return databaseConnectionUri;
        }
        return undefined;
    }

    //#region Form Helpers
    protected setFormComponents(): Record<
        string,
        FormItemSpec<
            BackupDatabaseFormState,
            ObjectManagementWebviewState<BackupDatabaseFormState>,
            ObjectManagementFormItemSpec<BackupDatabaseFormState>
        >
    > {
        const createFormItem = (
            spec: Partial<ObjectManagementFormItemSpec<BackupDatabaseFormState>>,
        ): ObjectManagementFormItemSpec<BackupDatabaseFormState> =>
            ({
                required: false,
                ...spec,
            }) as ObjectManagementFormItemSpec<BackupDatabaseFormState>;

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
                    const isValid =
                        value !== "" || backupViewModel.type !== DisasterRecoveryType.Url;
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
                    const isValid =
                        value !== "" || backupViewModel.type !== DisasterRecoveryType.Url;
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
                    const isValid =
                        value !== "" || backupViewModel.type !== DisasterRecoveryType.Url;
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
                    const isValid =
                        value !== "" || backupViewModel.type !== DisasterRecoveryType.Url;
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
                    const isValid =
                        value !== "" || backupViewModel.type !== DisasterRecoveryType.Url;
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
        state: ObjectManagementWebviewState<BackupDatabaseFormState>,
    ): ObjectManagementWebviewState<BackupDatabaseFormState> {
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
}
