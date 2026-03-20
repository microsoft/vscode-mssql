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
    BackupFile,
} from "../sharedInterfaces/backup";
import { ApiStatus } from "../sharedInterfaces/webview";
import * as LocConstants from "../constants/locConstants";
import { FormItemOptions, FormItemSpec, FormItemType } from "../sharedInterfaces/form";
import {
    allFileTypes,
    backupDatabaseHelpLink,
    defaultBackupFileTypes,
    defaultDatabase,
    restoreDatabaseHelpLink,
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
    getUrl,
    loadAzureComponentHelper,
    removeBackupFile,
    setType,
} from "./sharedDisasterRecoveryUtils";
import { ConnectionProfile } from "../models/connectionProfile";
import ConnectionManager from "./connectionManager";
import { getServerTypes, ServerType } from "../models/connectionInfo";
import {
    RecoveryState,
    RestoreConfigInfo,
    RestoreDatabaseFormState,
    RestoreDatabaseReducers,
    RestoreDatabaseViewModel,
    RestoreInfo,
    RestoreParams,
    RestorePlanDetails,
    RestorePlanResponse,
    RestoreResponse,
} from "../sharedInterfaces/restore";
import { BlobItem } from "@azure/storage-blob";
import { VsCodeAzureHelper } from "../connectionconfig/azureHelpers";

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
            {
                light: "backup_light.svg",
                dark: "backup_dark.svg",
            },
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

        const serverTypes = getServerTypes(this.profile);
        if (serverTypes.includes(ServerType.Azure) && serverTypes.includes(ServerType.Sql)) {
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
            if (payload.event.propertyName === "backupName") {
                (state.viewModel.model as BackupDatabaseViewModel).isBackupNameDirty = true;
            }
            const updatedState = await disasterRecoveryFormAction<BackupDatabaseFormState>(
                state,
                payload,
            );
            // if the backup name is not dirty, ie. the default backup name
            // and the property changed is backup type, then update the backup name to reflect the backup type change
            if (
                payload.event.propertyName === "backupType" &&
                !(updatedState.viewModel.model as BackupDatabaseViewModel).isBackupNameDirty
            ) {
                // this is guaranteed to have more than 1 part because the default backup name is
                // generated in the format of database_backupType_timestamp.bak
                //
                const locBackupType = this.state.formComponents["backupType"].options.find(
                    (option) => option.value === updatedState.formState.backupType,
                )?.displayName;
                const splitBackupName = updatedState.formState.backupName.split("-");
                splitBackupName[1] = locBackupType;
                updatedState.formState.backupName = splitBackupName.join("-");
            }
            return updatedState;
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
            const isExisting = !state.fileBrowserState.showFoldersOnly;

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
        let name = `${state.databaseName}-${BackupType.Full}`;
        if (newFiles.length > 0) {
            name += `-${newFiles.length}`;
        }
        return name + `-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.bak`;
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

export class RestoreDatabaseWebviewController extends ObjectManagementWebviewController<
    RestoreDatabaseFormState,
    RestoreDatabaseReducers<RestoreDatabaseFormState>
> {
    public readonly RESTORE_DATABASE_TASK_NAME = "Restore Database";
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        objectManagementService: ObjectManagementService,
        private connectionManager: ConnectionManager,
        private fileBrowserService: FileBrowserService,
        private azureBlobService: AzureBlobService,
        private profile: ConnectionProfile,
        private ownerUri: string,
        databaseName?: string,
    ) {
        super(
            context,
            vscodeWrapper,
            objectManagementService,
            ObjectManagementDialogType.RestoreDatabase,
            LocConstants.RestoreDatabase.restoreDatabaseTitle,
            LocConstants.RestoreDatabase.restoreDatabaseTitle,
            "restoreDatabaseDialog",
            ownerUri,
            profile.server || "",
            databaseName || profile.database || "",
        );

        this.start();
    }

    protected async initializeDialog(): Promise<void> {
        let restoreViewModel = new RestoreDatabaseViewModel();
        this.updateViewModel(restoreViewModel);

        const serverTypes = getServerTypes(this.profile);
        if (serverTypes.includes(ServerType.Azure) && serverTypes.includes(ServerType.Sql)) {
            restoreViewModel.loadState = ApiStatus.Error;
            restoreViewModel.errorMessage = LocConstants.RestoreDatabase.azureSqlDbNotSupported;
            this.updateViewModel(restoreViewModel);
            return;
        }

        this.state.ownerUri = this.ownerUri;

        // Get restore config info
        let restoreConfigInfo: RestoreConfigInfo;
        try {
            restoreConfigInfo = (
                await this.objectManagementService.getRestoreConfigInfo(this.ownerUri)
            ).configInfo;
        } catch (error) {
            restoreViewModel.loadState = ApiStatus.Error;
            restoreViewModel.errorMessage = getErrorMessage(error);
            this.updateViewModel(restoreViewModel);
            sendErrorEvent(
                TelemetryViews.Restore,
                TelemetryActions.InitializeRestore,
                error,
                false, // include error message in telemetry
            );
            return;
        }

        // File Browser setup
        this.state.defaultFileBrowserExpandPath = restoreConfigInfo.defaultBackupFolder;
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

        this.state.formComponents = this.setFormComponents();

        // Populate options for source database dropdown based on restoreConfigInfo
        this.state.formComponents["sourceDatabaseName"].options =
            restoreConfigInfo.sourceDatabaseNamesWithBackupSets.map((dbName) => ({
                value: dbName,
                displayName: dbName,
            }));
        if (
            this.databaseName &&
            restoreConfigInfo.sourceDatabaseNamesWithBackupSets.includes(this.databaseName)
        ) {
            this.state.formState.sourceDatabaseName = this.databaseName;
        } else if (restoreConfigInfo.sourceDatabaseNamesWithBackupSets.length > 0) {
            this.state.formState.sourceDatabaseName =
                restoreConfigInfo.sourceDatabaseNamesWithBackupSets[0];
        } else {
            this.state.formComponents["sourceDatabaseName"].placeholder =
                LocConstants.RestoreDatabase.noDatabasesWithBackups;
        }

        // Populate options for target database dropdown based on databases in the server
        const databases = await this.connectionManager.listDatabases(this.connectionUri);
        const targetDatabaseOptions = databases.map((dbName) => ({
            value: dbName,
            displayName: dbName,
        }));
        this.state.formComponents["targetDatabaseName"].options = targetDatabaseOptions;
        this.state.formState.targetDatabaseName =
            this.state.formState.sourceDatabaseName ?? databases[0];

        // Set initial form state
        this.state.formState = {
            ...this.state.formState,
            relocateDbFiles: false,
            replaceDatabase: false,
            keepReplication: false,
            setRestrictedUser: false,
            recoveryState: RecoveryState.WithRecovery,
            backupTailLog: false,
            tailLogWithNoRecovery: false,
            closeExistingConnections: false,
            blob: "",
            dataFileFolder: restoreConfigInfo.dataFileFolder,
            logFileFolder: restoreConfigInfo.logFileFolder,
        };

        // Set restoreViewModel defaults
        restoreViewModel.type = DisasterRecoveryType.Database;
        restoreViewModel.serverName = this.profile.server || "";
        restoreViewModel.azureComponentStatuses["blob"] = ApiStatus.NotStarted;

        void this.getRestorePlan(false)
            .then((state) => {
                restoreViewModel = this.setDefaultFormValuesFromPlan(state);
            })
            .catch((error) => {
                sendErrorEvent(
                    TelemetryViews.Restore,
                    TelemetryActions.GetRestorePlan,
                    error,
                    false, // include error message in telemetry
                );
            });

        this.registerRestoreRpcHandlers();

        restoreViewModel.loadState = ApiStatus.Loaded;
        this.updateViewModel(restoreViewModel);

        sendActionEvent(TelemetryViews.Restore, TelemetryActions.InitializeRestore);
    }

    private registerRestoreRpcHandlers() {
        this.registerReducer("formAction", async (state, payload) => {
            state = await disasterRecoveryFormAction<RestoreDatabaseFormState>(state, payload);

            // Reset error message on form change
            const restoreViewModel = this.restoreViewModel(state);
            restoreViewModel.errorMessage = undefined;

            // If the source database or blob fields were changed,
            // we need to get an updated restore plan
            if (
                payload.event.propertyName === "sourceDatabaseName" ||
                payload.event.propertyName === "blob"
            ) {
                if (restoreViewModel.restorePlanStatus !== ApiStatus.Loading) {
                    restoreViewModel.restorePlanStatus = ApiStatus.NotStarted;
                }
                state = this.updateViewModel(restoreViewModel, state);
                void this.getRestorePlan(payload.event.propertyName === "blob", state);
            }
            return this.updateViewModel(restoreViewModel, state);
        });

        this.registerReducer("loadAzureComponent", async (state, payload) => {
            const restoreViewModel = this.restoreViewModel(state);
            if (restoreViewModel.restorePlanStatus !== ApiStatus.Loading) {
                (state.viewModel.model as RestoreDatabaseViewModel).restorePlanStatus =
                    ApiStatus.NotStarted;
            }
            if (
                payload.componentName == "blob" &&
                restoreViewModel.azureComponentStatuses["blob"] === ApiStatus.NotStarted
            ) {
                state = await this.loadBlobComponent(
                    state as ObjectManagementWebviewState<RestoreDatabaseFormState>,
                );
                let viewModel = this.restoreViewModel(state);
                viewModel.azureComponentStatuses[payload.componentName] = ApiStatus.Loaded;
                state = this.updateViewModel(viewModel, state);

                void this.getRestorePlan(true, state);
                return state;
            } else {
                const loadResult = await loadAzureComponentHelper(
                    state as ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
                    payload,
                );
                return loadResult as ObjectManagementWebviewState<RestoreDatabaseFormState>;
            }
        });

        this.registerReducer("setType", async (state, payload) => {
            state = (await setType(
                state as ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
                payload,
            )) as ObjectManagementWebviewState<RestoreDatabaseFormState>;
            const restoreViewModel = this.restoreViewModel(state);
            if (restoreViewModel.restorePlanStatus !== ApiStatus.Loading) {
                restoreViewModel.restorePlanStatus = ApiStatus.NotStarted;
            }
            if (payload.type === DisasterRecoveryType.Database) {
                void this.getRestorePlan(false, this.updateViewModel(restoreViewModel, state));
            }
            // reset error message on type change
            restoreViewModel.errorMessage = undefined;

            return this.updateViewModel(restoreViewModel, state);
        });

        this.registerReducer("restoreDatabase", async (state, _payload) => {
            await this.restoreHelper(TaskExecutionMode.executeAndScript);
            sendActionEvent(TelemetryViews.Restore, TelemetryActions.Restore, {
                restoreType: this.restoreViewModel(state).type,
            });
            return state;
        });

        this.registerReducer("openRestoreScript", async (state, _payload) => {
            const restoreViewModel = this.restoreViewModel(state);
            if (restoreViewModel.restorePlanStatus !== ApiStatus.Loaded) {
                restoreViewModel.errorMessage =
                    LocConstants.RestoreDatabase.cannotGenerateScriptWithNoRestorePlan;
                return this.updateViewModel(restoreViewModel, state);
            } else if (restoreViewModel.selectedBackupSets.length === 0) {
                restoreViewModel.errorMessage =
                    LocConstants.RestoreDatabase.pleaseChooseAtLeastOneBackupSetToRestore;

                return this.updateViewModel(restoreViewModel, state);
            }

            await this.restoreHelper(TaskExecutionMode.script);
            sendActionEvent(TelemetryViews.Restore, TelemetryActions.ScriptRestore, {
                restoreType: this.restoreViewModel(state).type,
            });
            return state;
        });

        this.registerReducer("removeBackupFile", async (state, payload) => {
            const restoreViewModel = this.restoreViewModel(state);
            restoreViewModel.backupFiles = restoreViewModel.backupFiles.filter(
                (file) => file.filePath !== payload.filePath,
            );
            // reset error message on file change
            restoreViewModel.errorMessage = undefined;

            return this.updateViewModel(restoreViewModel, state);
        });

        this.registerReducer("updateSelectedBackupSets", async (state, payload) => {
            const restoreViewModel = this.restoreViewModel(state);

            // reset error message on backup set change
            restoreViewModel.errorMessage = undefined;

            restoreViewModel.selectedBackupSets =
                restoreViewModel.restorePlan.backupSetsToRestore
                    ?.filter((_, index) => payload.selectedBackupSets.includes(index))
                    .map((backupSet) => backupSet.id) ?? [];

            return this.updateViewModel(restoreViewModel, state);
        });

        registerFileBrowserReducers(
            this as ReactWebviewPanelController<FileBrowserWebviewState, FileBrowserReducers, any>,
            this.fileBrowserService,
            defaultBackupFileTypes,
        );

        // Override default file browser submitFilePath reducer
        this.registerReducer("submitFilePath", async (state, payload) => {
            const restoreViewModel = this.restoreViewModel(state);

            // reset error message on file change
            restoreViewModel.errorMessage = undefined;

            if (!payload.propertyName) {
                const paths = restoreViewModel.backupFiles.map((f) => f.filePath);
                if (!paths.includes(payload.selectedPath)) {
                    const newFile: BackupFile = {
                        filePath: payload.selectedPath,
                        isExisting: true,
                    };
                    restoreViewModel.backupFiles.push(newFile);
                    void this.getRestorePlan(true, state);
                }
            } else {
                if (payload.propertyName in state.formState) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (state.formState[payload.propertyName] as any) = payload.selectedPath;
                } else if (payload.propertyName in restoreViewModel) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (restoreViewModel[payload.propertyName] as any) = payload.selectedPath;
                }
            }
            return this.updateViewModel(restoreViewModel, state);
        });
    }

    //#region Object Management overrides and helpers
    protected get helpLink(): string {
        return restoreDatabaseHelpLink;
    }

    protected async handleScript(
        params: ObjectManagementActionParams["params"],
    ): Promise<ObjectManagementActionResult> {
        const scriptResult = await this.restoreHelper(TaskExecutionMode.script);
        return {
            success: scriptResult.result,
            errorMessage: scriptResult.errorMessage,
        };
    }

    protected async handleSubmit(
        params: ObjectManagementActionParams["params"],
    ): Promise<ObjectManagementActionResult> {
        const restoreResult = await this.restoreHelper(TaskExecutionMode.executeAndScript);
        return {
            success: restoreResult.result,
            errorMessage: restoreResult.errorMessage,
        };
    }

    private restoreViewModel(
        state?: ObjectManagementWebviewState<RestoreDatabaseFormState>,
    ): RestoreDatabaseViewModel {
        const webviewState = state ?? this.state;
        return webviewState.viewModel.model as RestoreDatabaseViewModel;
    }

    private updateViewModel(
        updatedViewModel: RestoreDatabaseViewModel,
        state?: ObjectManagementWebviewState<RestoreDatabaseFormState>,
    ): ObjectManagementWebviewState<RestoreDatabaseFormState> {
        this.state.viewModel.model = updatedViewModel;
        this.updateState(state);
        return this.state;
    }
    //#endregion

    //#region Form Helpers
    protected setFormComponents(): Record<
        string,
        FormItemSpec<
            RestoreDatabaseFormState,
            ObjectManagementWebviewState<RestoreDatabaseFormState>,
            ObjectManagementFormItemSpec<RestoreDatabaseFormState>
        >
    > {
        const createFormItem = (
            spec: Partial<ObjectManagementFormItemSpec<RestoreDatabaseFormState>>,
        ): ObjectManagementFormItemSpec<RestoreDatabaseFormState> =>
            ({
                required: false,
                ...spec,
            }) as ObjectManagementFormItemSpec<RestoreDatabaseFormState>;

        return {
            sourceDatabaseName: createFormItem({
                type: FormItemType.Dropdown,
                propertyName: "sourceDatabaseName",
                label: LocConstants.RestoreDatabase.sourceDatabase,
                groupName: DisasterRecoveryType.Database,
                options: [],
            }),

            targetDatabaseName: createFormItem({
                type: FormItemType.Combobox,
                propertyName: "targetDatabaseName",
                label: LocConstants.RestoreDatabase.targetDatabase,
                options: [],
                componentProps: {
                    freeform: true,
                },
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
                groupName: DisasterRecoveryType.Url,
                validate(state, value) {
                    const restoreViewModel = state.viewModel.model as RestoreDatabaseViewModel;
                    const isValid =
                        value !== "" || !(restoreViewModel.type === DisasterRecoveryType.Url);
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
                groupName: DisasterRecoveryType.Url,
                validate(state, value) {
                    const restoreViewModel = state.viewModel.model as RestoreDatabaseViewModel;
                    const isValid =
                        value !== "" || !(restoreViewModel.type === DisasterRecoveryType.Url);
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
                groupName: DisasterRecoveryType.Url,
                validate(state, value) {
                    const restoreViewModel = state.viewModel.model as RestoreDatabaseViewModel;
                    const isValid =
                        value !== "" || !(restoreViewModel.type === DisasterRecoveryType.Url);
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
                groupName: DisasterRecoveryType.Url,
                validate(state, value) {
                    const restoreViewModel = state.viewModel.model as RestoreDatabaseViewModel;
                    const isValid =
                        value !== "" || !(restoreViewModel.type === DisasterRecoveryType.Url);

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
                groupName: DisasterRecoveryType.Url,
                validate(state, value) {
                    const restoreViewModel = state.viewModel.model as RestoreDatabaseViewModel;
                    const isValid =
                        value !== "" || !(restoreViewModel.type === DisasterRecoveryType.Url);

                    return {
                        isValid: isValid,
                        validationMessage: isValid
                            ? ""
                            : LocConstants.BackupDatabase.blobContainerIsRequired,
                    };
                },
            }),

            blob: createFormItem({
                propertyName: "blob",
                label: LocConstants.RestoreDatabase.blob,
                required: true,
                type: FormItemType.SearchableDropdown,
                options: [],
                placeholder: LocConstants.RestoreDatabase.selectABlob,
                groupName: DisasterRecoveryType.Url,
                validate(state, value) {
                    const restoreViewModel = state.viewModel.model as RestoreDatabaseViewModel;
                    const isValid =
                        value !== "" || !(restoreViewModel.type === DisasterRecoveryType.Url);
                    return {
                        isValid: isValid,
                        validationMessage: isValid
                            ? ""
                            : LocConstants.RestoreDatabase.blobIsRequired,
                    };
                },
            }),

            relocateDbFiles: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "relocateDbFiles",
                label: LocConstants.RestoreDatabase.relocateDbFiles,
                isAdvancedOption: true,
                groupName: LocConstants.RestoreDatabase.files,
            }),

            replaceDatabase: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "replaceDatabase",
                label: LocConstants.RestoreDatabase.overwriteExistingDb,
                isAdvancedOption: true,
                groupName: LocConstants.RestoreDatabase.general,
                tooltip: LocConstants.RestoreDatabase.overwriteExistingDbTooltip,
            }),

            keepReplication: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "keepReplication",
                label: LocConstants.RestoreDatabase.preserveReplicationSettings,
                isAdvancedOption: true,
                groupName: LocConstants.RestoreDatabase.general,
                tooltip: LocConstants.RestoreDatabase.preserveReplicationSettingsTooltip,
            }),

            setRestrictedUser: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "setRestrictedUser",
                label: LocConstants.RestoreDatabase.restrictAccessToRestoredDb,
                isAdvancedOption: true,
                groupName: LocConstants.RestoreDatabase.general,
                tooltip: LocConstants.RestoreDatabase.restrictAccessToRestoredDbTooltip,
            }),

            recoveryState: createFormItem({
                type: FormItemType.Dropdown,
                propertyName: "recoveryState",
                label: LocConstants.RestoreDatabase.recoveryState,
                options: this.getRecoveryStateOptions(),
                isAdvancedOption: true,
                groupName: LocConstants.RestoreDatabase.general,
            }),

            backupTailLog: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "backupTailLog",
                label: LocConstants.RestoreDatabase.takeTailLogBackup,
                isAdvancedOption: true,
                groupName: LocConstants.RestoreDatabase.tailLogBackup,
            }),

            tailLogWithNoRecovery: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "tailLogWithNoRecovery",
                label: LocConstants.RestoreDatabase.leaveSourceDatabase,
                isAdvancedOption: true,
                groupName: LocConstants.RestoreDatabase.tailLogBackup,
                tooltip: LocConstants.RestoreDatabase.leaveSourceDatabaseTooltip,
            }),

            closeExistingConnections: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "closeExistingConnections",
                label: LocConstants.RestoreDatabase.closeExistingConnections,
                isAdvancedOption: true,
                groupName: LocConstants.RestoreDatabase.serverConnections,
            }),

            dataFileFolder: createFormItem({
                type: FormItemType.Input,
                propertyName: "dataFileFolder",
                label: LocConstants.RestoreDatabase.dataFileFolder,
                isAdvancedOption: true,
                groupName: LocConstants.RestoreDatabase.files,
            }),

            logFileFolder: createFormItem({
                type: FormItemType.Input,
                propertyName: "logFileFolder",
                label: LocConstants.RestoreDatabase.logFileFolder,
                isAdvancedOption: true,
                groupName: LocConstants.RestoreDatabase.files,
            }),

            standbyFile: createFormItem({
                type: FormItemType.Input,
                propertyName: "standbyFile",
                label: LocConstants.RestoreDatabase.standbyFile,
                isAdvancedOption: true,
                groupName: LocConstants.RestoreDatabase.general,
            }),

            tailLogBackupFile: createFormItem({
                type: FormItemType.Input,
                propertyName: "tailLogBackupFile",
                label: LocConstants.RestoreDatabase.tailLogBackupFile,
                isAdvancedOption: true,
                groupName: LocConstants.RestoreDatabase.tailLogBackup,
            }),
        };
    }

    private getRecoveryStateOptions(): FormItemOptions[] {
        return [
            {
                value: RecoveryState.WithRecovery,
                displayName: LocConstants.RestoreDatabase.restoreWithRecovery,
            },
            {
                value: RecoveryState.NoRecovery,
                displayName: LocConstants.RestoreDatabase.restoreWithNoRecovery,
            },
            {
                value: RecoveryState.Standby,
                displayName: LocConstants.RestoreDatabase.restoreWithStandby,
            },
        ];
    }
    //#endregion

    private async restoreHelper(taskMode: TaskExecutionMode): Promise<RestoreResponse> {
        try {
            const params = await this.getRestoreParams(taskMode, false, false);
            return await this.objectManagementService.restoreDatabase(params);
        } catch (error) {
            this.state.errorMessage = getErrorMessage(error);
            sendErrorEvent(
                TelemetryViews.Restore,
                TelemetryActions.Restore,
                error,
                false, // include error message in telemetry
                undefined, // error code
                undefined, // error type
                {
                    isScript: (taskMode === TaskExecutionMode.script).toString(),
                },
            );
            return;
        }
    }

    private async getRestorePlan(
        useDefaults: boolean,
        currentState?: ObjectManagementWebviewState<RestoreDatabaseFormState>,
    ): Promise<ObjectManagementWebviewState<RestoreDatabaseFormState>> {
        const state = currentState ?? this.state;
        const restoreViewModel = this.restoreViewModel(state);

        if (
            restoreViewModel.restorePlanStatus === ApiStatus.Loading &&
            restoreViewModel.cachedRestorePlanParams
        ) {
            void this.objectManagementService.cancelRestorePlan(
                restoreViewModel.cachedRestorePlanParams,
            );
        }
        restoreViewModel.restorePlanStatus = ApiStatus.Loading;
        this.updateViewModel(restoreViewModel, state);

        let plan: RestorePlanResponse;
        let params: RestoreParams;
        try {
            params = await this.getRestoreParams(TaskExecutionMode.execute, true, useDefaults);
            plan = await this.objectManagementService.getRestorePlan(params);
            state.errorMessage = undefined;
        } catch (error) {
            restoreViewModel.restorePlanStatus = ApiStatus.Error;
            restoreViewModel.restorePlan = undefined;
            restoreViewModel.errorMessage = getErrorMessage(error);
            this.updateViewModel(restoreViewModel, state);
            sendErrorEvent(
                TelemetryViews.Restore,
                TelemetryActions.GetRestorePlan,
                error,
                false, // include error message in telemetry
            );

            return this.updateViewModel(restoreViewModel, state);
        }
        restoreViewModel.cachedRestorePlanParams = params;
        restoreViewModel.restorePlan = plan;

        const sourceDatabaseName = plan.planDetails.sourceDatabaseName.currentValue;

        if (
            sourceDatabaseName &&
            state.formComponents["sourceDatabaseName"].options.some(
                (o) => o.value === sourceDatabaseName,
            )
        ) {
            state.formState.sourceDatabaseName = sourceDatabaseName;
        }

        state.formState.targetDatabaseName =
            plan.planDetails.targetDatabaseName.currentValue || state.formState.targetDatabaseName;

        state.formState.standbyFile = plan.planDetails.standbyFile?.currentValue || "";
        state.formState.tailLogBackupFile = plan.planDetails.tailLogBackupFile?.currentValue || "";

        restoreViewModel.restorePlanStatus = plan.canRestore ? ApiStatus.Loaded : ApiStatus.Error;

        restoreViewModel.selectedBackupSets = plan.backupSetsToRestore
            .filter((backupSet) => backupSet.isSelected)
            .map((backupSet) => backupSet.id);

        sendActionEvent(TelemetryViews.Restore, TelemetryActions.GetRestorePlan);

        return this.updateViewModel(restoreViewModel, state);
    }

    private async getRestoreParams(
        taskMode: TaskExecutionMode,
        isRestorePlan: boolean,
        useDefaults: boolean,
        currentState?: ObjectManagementWebviewState<RestoreDatabaseFormState>,
    ): Promise<RestoreParams> {
        let state = currentState ?? this.state;
        let restoreViewModel = this.restoreViewModel(state);
        const restoreFromDatabase = restoreViewModel.type === DisasterRecoveryType.Database;

        let backupFilePaths = "";
        if (restoreViewModel.type === DisasterRecoveryType.BackupFile) {
            backupFilePaths = restoreViewModel.backupFiles.map((f) => f.filePath).join(",");
        } else if (restoreViewModel.type === DisasterRecoveryType.Url) {
            backupFilePaths = await getUrl(
                state as ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
            );
            backupFilePaths += `/${state.formState.blob}`;
        }

        state = (await createSasKey(
            state as ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
            this.ownerUri,
            this.azureBlobService,
        )) as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        const restoreInfo: RestoreInfo = {
            targetDatabaseName: useDefaults ? defaultDatabase : state.formState.targetDatabaseName,
            sourceDatabaseName: !restoreFromDatabase
                ? null
                : useDefaults
                  ? ""
                  : state.formState.sourceDatabaseName,
            relocateDbFiles: state.formState.relocateDbFiles,
            readHeaderFromMedia: restoreFromDatabase ? false : true,
            overwriteTargetDatabase: isRestorePlan,
            backupFilePaths: backupFilePaths,
            deviceType:
                restoreViewModel.type === DisasterRecoveryType.Url
                    ? MediaDeviceType.Url
                    : MediaDeviceType.File,
            selectedBackupSets: isRestorePlan ? null : restoreViewModel.selectedBackupSets,
            sessionId: isRestorePlan ? undefined : restoreViewModel.restorePlan?.sessionId,
        };

        const options: { [key: string]: any } = {};
        if (!isRestorePlan && restoreViewModel.restorePlan) {
            restoreViewModel = this.updatePlanFromState(restoreViewModel, state);

            for (const key in restoreViewModel.restorePlan?.planDetails) {
                const detail = restoreViewModel.restorePlan.planDetails[key];
                if (!detail || !(key in state.formState)) continue;

                const defaultValue = detail.defaultValue;
                const currentValue = state.formState[key];

                if (currentValue != defaultValue) {
                    options[key] = currentValue;
                }
            }
        }
        for (const key in restoreInfo) {
            options[key] = restoreInfo[key];
        }

        const params: RestoreParams = {
            ...restoreInfo,
            ownerUri: this.ownerUri,
            options: options,
            taskExecutionMode: taskMode,
        };
        return params;
    }

    private updatePlanFromState(
        restoreViewModel: RestoreDatabaseViewModel,
        currentState?: ObjectManagementWebviewState<RestoreDatabaseFormState>,
    ): RestoreDatabaseViewModel {
        const state = currentState ?? this.state;
        for (const key in state.formState) {
            if (key in restoreViewModel.restorePlan?.planDetails) {
                restoreViewModel.restorePlan.planDetails[key].currentValue = state.formState[
                    key
                ] as keyof RestorePlanDetails;
            }
        }
        for (const key in restoreViewModel) {
            if (key in restoreViewModel.restorePlan?.planDetails) {
                restoreViewModel.restorePlan.planDetails[key].currentValue = restoreViewModel[
                    key
                ] as keyof RestorePlanDetails;
            }
        }

        return restoreViewModel;
    }

    private setDefaultFormValuesFromPlan(
        currentState?: ObjectManagementWebviewState<RestoreDatabaseFormState>,
    ): RestoreDatabaseViewModel {
        const state = currentState ?? this.state;
        const restoreViewModel = this.restoreViewModel(state);
        for (const key in restoreViewModel.restorePlan?.planDetails) {
            if (key in state.formState && !state.formState[key]) {
                state.formState[key] = restoreViewModel.restorePlan?.planDetails[key].defaultValue;
            } else if (key in restoreViewModel && !restoreViewModel[key]) {
                restoreViewModel[key] = restoreViewModel.restorePlan?.planDetails[key].defaultValue;
            }
        }
        return restoreViewModel;
    }

    private async loadBlobComponent(
        state: ObjectManagementWebviewState<RestoreDatabaseFormState>,
    ): Promise<ObjectManagementWebviewState<RestoreDatabaseFormState>> {
        const restoreViewModel = this.restoreViewModel(state);
        const blobComponent = state.formComponents["blob"];

        // if no storage account or subscription selected, set error state and return
        if (
            !state.formState.subscriptionId ||
            !state.formState.storageAccountId ||
            !state.formState.blobContainerId
        ) {
            restoreViewModel.azureComponentStatuses["blob"] = ApiStatus.Error;
            blobComponent.placeholder = LocConstants.RestoreDatabase.noBlobsFound;
            return state;
        }

        // Load storage accounts for selected subscription
        const subscription = restoreViewModel.subscriptions.find(
            (s) => s.subscriptionId === state.formState.subscriptionId,
        );
        const storageAccount = restoreViewModel.storageAccounts.find(
            (sa) => sa.id === state.formState.storageAccountId,
        );
        const blobContainer = restoreViewModel.blobContainers.find(
            (bc) => bc.id === state.formState.blobContainerId,
        );
        let blobs: BlobItem[] = [];
        try {
            blobs = await VsCodeAzureHelper.fetchBlobsForContainer(
                subscription,
                storageAccount,
                blobContainer,
            );
        } catch (error) {
            state.errorMessage = error.message;
        }
        const blobOptions: FormItemOptions[] = blobs.map((blob) => ({
            value: blob.name,
            displayName: blob.name,
        }));

        // Set associated state values
        blobComponent.options = blobOptions;
        state.formState.blob = blobOptions.length > 0 ? blobOptions[0].value : "";
        blobComponent.placeholder =
            blobOptions.length > 0
                ? LocConstants.RestoreDatabase.selectABlob
                : LocConstants.RestoreDatabase.noBlobsFound;
        restoreViewModel.blobs = blobs;

        state.viewModel.model = restoreViewModel;
        return state;
    }
}
