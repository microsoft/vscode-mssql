/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import VscodeWrapper from "./vscodeWrapper";
import {
    allFileTypes,
    defaultBackupFileTypes,
    defaultDatabase,
    restoreDatabaseHelpLink,
} from "../constants/constants";
import { FileBrowserService } from "../services/fileBrowserService";
import { AzureBlobService } from "../models/contracts/azureBlob";
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
    RecoveryState,
    RestoreConfigInfo,
    RestoreDatabaseFormState,
    RestoreDatabaseReducers,
    RestoreDatabaseViewModel,
    RestoreInfo,
    RestoreResponse,
    RestoreParams,
    RestorePlanResponse,
    RestorePlanDetails,
} from "../sharedInterfaces/restore";
import * as LocConstants from "../constants/locConstants";
import { FormItemOptions, FormItemSpec, FormItemType } from "../sharedInterfaces/form";
import ConnectionManager from "./connectionManager";
import {
    createSasKey,
    disasterRecoveryFormAction,
    getUrl,
    loadAzureComponentHelper,
    setType,
} from "./sharedDisasterRecoveryUtils";
import { ApiStatus } from "../sharedInterfaces/webview";
import { BackupFile, MediaDeviceType } from "../sharedInterfaces/backup";
import { TaskExecutionMode } from "../sharedInterfaces/schemaCompare";
import { getErrorMessage } from "../utils/utils";
import { VsCodeAzureHelper } from "../connectionconfig/azureHelpers";
import { BlobItem } from "@azure/storage-blob";
import { registerFileBrowserReducers } from "./fileBrowserUtils";
import { FileBrowserReducers, FileBrowserWebviewState } from "../sharedInterfaces/fileBrowser";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import { ConnectionProfile } from "../models/connectionProfile";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";

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

        // Default restore type
        restoreViewModel.type = DisasterRecoveryType.Database;
        restoreViewModel.serverName = this.profile.server || "";
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
        } else {
            this.state.formState.sourceDatabaseName =
                restoreConfigInfo.sourceDatabaseNamesWithBackupSets[0];
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

        // Set Azure related defaults
        restoreViewModel.azureComponentStatuses["blob"] = ApiStatus.NotStarted;

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

        void this.getRestorePlan(false)
            .then((state) => {
                restoreViewModel = this.setDefaultFormValuesFromPlan(state);
                this.updateViewModel(restoreViewModel, state);
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

        this.updateState();

        sendActionEvent(TelemetryViews.Restore, TelemetryActions.InitializeRestore);
    }

    private registerRestoreRpcHandlers() {
        this.registerReducer("formAction", async (state, payload) => {
            state = await disasterRecoveryFormAction<RestoreDatabaseFormState>(state, payload);

            // If the source database or blob fields were changed,
            // we need to get an updated restore plan
            if (
                payload.event.propertyName === "sourceDatabaseName" ||
                payload.event.propertyName === "blob"
            ) {
                const restoreViewModel = this.restoreViewModel(state);
                if (restoreViewModel.restorePlanStatus !== ApiStatus.Loading) {
                    restoreViewModel.restorePlanStatus = ApiStatus.NotStarted;
                }
                state = this.updateViewModel(restoreViewModel, state);
                void this.getRestorePlan(payload.event.propertyName === "blob", state);
            }
            return state;
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
                vscode.window.showErrorMessage(
                    LocConstants.RestoreDatabase.cannotGenerateScriptWithNoRestorePlan,
                );
                return state;
            } else if (restoreViewModel.selectedBackupSets.length === 0) {
                vscode.window.showErrorMessage(
                    LocConstants.RestoreDatabase.pleaseChooseAtLeastOneBackupSetToRestore,
                );
                return state;
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
            return this.updateViewModel(restoreViewModel, state);
        });

        this.registerReducer("updateSelectedBackupSets", async (state, payload) => {
            const restoreViewModel = this.restoreViewModel(state);

            restoreViewModel.selectedBackupSets =
                restoreViewModel.restorePlan.backupSetsToRestore
                    ?.filter((_, index) => payload.selectedBackupSets.includes(index))
                    .map((backupSet) => backupSet.id) ?? [];

            if (restoreViewModel.selectedBackupSets.length) {
                state.formState.closeExistingConnections = true;
            } else {
                state.formState.closeExistingConnections =
                    restoreViewModel.restorePlan.planDetails.closeExistingConnections.defaultValue;
            }

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
                type: FormItemType.Dropdown,
                propertyName: "targetDatabaseName",
                label: LocConstants.RestoreDatabase.targetDatabase,
                required: true,
                options: [],
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

            return state;
        }
        restoreViewModel.cachedRestorePlanParams = params;
        restoreViewModel.restorePlan = plan;

        const sourceDatabaseName = plan.planDetails.sourceDatabaseName.currentValue;
        const targetDatabaseName = plan.planDetails.targetDatabaseName.currentValue;

        if (
            sourceDatabaseName &&
            state.formComponents["sourceDatabaseName"].options.some(
                (o) => o.value === sourceDatabaseName,
            )
        ) {
            state.formState.sourceDatabaseName = sourceDatabaseName;
        }

        if (
            targetDatabaseName &&
            state.formComponents["targetDatabaseName"].options.some(
                (o) => o.value === targetDatabaseName,
            )
        ) {
            state.formState.targetDatabaseName = targetDatabaseName;
        }
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
            sourceDatabaseName: useDefaults ? "" : state.formState.sourceDatabaseName,
            relocateDbFiles: state.formState.relocateDbFiles,
            readHeaderFromMedia: restoreFromDatabase ? false : true,
            overwriteTargetDatabase: isRestorePlan,
            backupFilePaths: backupFilePaths,
            deviceType:
                restoreViewModel.type === DisasterRecoveryType.Url
                    ? MediaDeviceType.Url
                    : MediaDeviceType.File,
            selectedBackupSets: restoreViewModel.selectedBackupSets,
            sessionId: isRestorePlan ? undefined : restoreViewModel.restorePlan?.sessionId,
        };

        const options: { [key: string]: any } = {};
        if (restoreViewModel.restorePlan) {
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
