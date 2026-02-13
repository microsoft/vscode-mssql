/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import VscodeWrapper from "./vscodeWrapper";
import {
    allFileTypes,
    defaultBackupFileTypes,
    https,
    restoreDatabaseHelpLink,
} from "../constants/constants";
import { FileBrowserService } from "../services/fileBrowserService";
import { AzureBlobService } from "../models/contracts/azureBlob";
import { ObjectManagementWebviewController } from "./objectManagementWebviewController";
import {
    DisasterRecoveryAzureFormState,
    ObjectManagementActionParams,
    ObjectManagementActionResult,
    ObjectManagementDialogType,
    ObjectManagementFormItemSpec,
    ObjectManagementWebviewState,
} from "../sharedInterfaces/objectManagement";
import { ObjectManagementService } from "../services/objectManagementService";
import {
    RecoveryState,
    RestoreDatabaseFormState,
    RestoreDatabaseReducers,
    RestoreDatabaseViewModel,
    RestoreInfo,
    RestoreType,
    RestoreResponse,
    RestoreParams,
    RestorePlanResponse,
} from "../sharedInterfaces/restore";
import * as LocConstants from "../constants/locConstants";
import { FormItemOptions, FormItemSpec, FormItemType } from "../sharedInterfaces/form";
import ConnectionManager from "./connectionManager";
import {
    loadAzureComponentHelper,
    reloadAzureComponents,
} from "./sharedDisasterRecoveryAzureHelpers";
import { ApiStatus } from "../sharedInterfaces/webview";
import { BackupFile, MediaDeviceType } from "../sharedInterfaces/backup";
import { TaskExecutionMode } from "../sharedInterfaces/schemaCompare";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import { getErrorMessage, getExpirationDateForSas } from "../utils/utils";
import { VsCodeAzureHelper } from "../connectionconfig/azureHelpers";
import { BlobItem } from "@azure/storage-blob";
import { registerFileBrowserReducers } from "./fileBrowserUtils";
import { FileBrowserReducers, FileBrowserWebviewState } from "../sharedInterfaces/fileBrowser";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import { getCloudProviderSettings } from "../azure/providerSettings";
import { SimpleExecuteResult } from "vscode-mssql";
import { RequestType } from "vscode-languageclient";
import SqlToolsServiceClient from "../languageservice/serviceclient";

export class RestoreDatabaseWebviewController extends ObjectManagementWebviewController<
    RestoreDatabaseFormState,
    RestoreDatabaseReducers<RestoreDatabaseFormState>
> {
    public readonly RESTORE_DATABASE_TASK_NAME = "Restore Database";
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        objectManagementService: ObjectManagementService,
        private client: SqlToolsServiceClient,
        private connectionManager: ConnectionManager,
        private fileBrowserService: FileBrowserService,
        private azureBlobService: AzureBlobService,
        private node: TreeNodeInfo,
    ) {
        super(
            context,
            vscodeWrapper,
            objectManagementService,
            ObjectManagementDialogType.RestoreDatabase,
            LocConstants.RestoreDatabase.restoreDatabaseTitle,
            LocConstants.RestoreDatabase.restoreDatabaseTitle,
            "restoreDatabaseDialog",
            node.sessionId,
            node.connectionProfile.server || "",
        );

        this.start();
    }

    protected async initializeDialog(): Promise<void> {
        let restoreViewModel = new RestoreDatabaseViewModel();
        this.updateViewModel(restoreViewModel);

        restoreViewModel.serverName = this.serverName;

        // Get restore config info; Gets the recovery model, default backup folder, and encryptors
        const restoreConfigInfo = (
            await this.objectManagementService.getRestoreConfigInfo(this.state.ownerUri)
        ).configInfo;

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
        this.state.formState.sourceDatabaseName =
            restoreConfigInfo.sourceDatabaseNamesWithBackupSets[0];

        // Populate options for target database dropdown based on databases in the server
        const databases = await this.connectionManager.listDatabases(this.connectionUri);
        const targetDatabaseOptions = databases.map((dbName) => ({
            value: dbName,
            displayName: dbName,
        }));
        this.state.formComponents["targetDatabaseName"].options = targetDatabaseOptions;
        this.state.formState.targetDatabaseName = this.state.formState.sourceDatabaseName;

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

        // Get credential names in server
        restoreViewModel.credentialNames = await this.getCredentialNames();

        void this.getRestorePlan(false).then((state) => {
            restoreViewModel = this.setDefaultFormValuesFromPlan(state);
            this.updateViewModel(restoreViewModel, state);
        });

        this.registerRestoreRpcHandlers();
        restoreViewModel.loadState = ApiStatus.Loaded;

        this.updateState();
    }

    private registerRestoreRpcHandlers() {
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
                const reloadCompsResult = await reloadAzureComponents(
                    state as ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
                    payload.event.propertyName,
                );
                // Reload necessary dependent components
                state = reloadCompsResult as ObjectManagementWebviewState<RestoreDatabaseFormState>;
            } else {
                // formAction is a normal form item value change; update form state
                (state.formState[
                    payload.event.propertyName
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ] as any) = payload.event.value;

                // If an azure component changed, reload dependent components and revalidate
                if (
                    [
                        "accountId",
                        "tenantId",
                        "subscriptionId",
                        "storageAccountId",
                        "blobContainerId",
                        "blob",
                    ].includes(payload.event.propertyName)
                ) {
                    const reloadCompsResult = await reloadAzureComponents(
                        state as ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
                        payload.event.propertyName,
                    );
                    // Reload necessary dependent components
                    state =
                        reloadCompsResult as ObjectManagementWebviewState<RestoreDatabaseFormState>;
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

                // we have to reload the restore plan if the source database change
                if (
                    payload.event.propertyName === "sourceDatabaseName" ||
                    payload.event.propertyName === "blob"
                ) {
                    void this.getRestorePlan(payload.event.propertyName === "blob", state);
                }
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

        this.registerReducer("setRestoreType", async (state, payload) => {
            state.formErrors = [];

            const restoreViewModel = this.restoreViewModel(state);
            restoreViewModel.restoreType = payload.restoreType;
            restoreViewModel.restorePlan.canRestore = true;

            return this.updateViewModel(restoreViewModel, state);
        });

        this.registerReducer("restoreDatabase", async (state, _payload) => {
            await this.restoreHelper(TaskExecutionMode.executeAndScript);
            return state;
        });

        this.registerReducer("openRestoreScript", async (state, _payload) => {
            await this.restoreHelper(TaskExecutionMode.script);
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
                groupName: RestoreType.Database,
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
                groupName: RestoreType.Url,
                validate(state, value) {
                    const restoreViewModel = state.viewModel.model as RestoreDatabaseViewModel;
                    const isValid =
                        value !== "" || !(restoreViewModel.restoreType === RestoreType.Url);
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
                groupName: RestoreType.Url,
                validate(state, value) {
                    const restoreViewModel = state.viewModel.model as RestoreDatabaseViewModel;
                    const isValid =
                        value !== "" || !(restoreViewModel.restoreType === RestoreType.Url);
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
                groupName: RestoreType.Url,
                validate(state, value) {
                    const restoreViewModel = state.viewModel.model as RestoreDatabaseViewModel;
                    const isValid =
                        value !== "" || !(restoreViewModel.restoreType === RestoreType.Url);
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
                groupName: RestoreType.Url,
                validate(state, value) {
                    const restoreViewModel = state.viewModel.model as RestoreDatabaseViewModel;
                    const isValid =
                        value !== "" || !(restoreViewModel.restoreType === RestoreType.Url);

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
                groupName: RestoreType.Url,
                validate(state, value) {
                    const restoreViewModel = state.viewModel.model as RestoreDatabaseViewModel;
                    const isValid =
                        value !== "" || !(restoreViewModel.restoreType === RestoreType.Url);

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
                groupName: RestoreType.Url,
                validate(state, value) {
                    const restoreViewModel = state.viewModel.model as RestoreDatabaseViewModel;
                    const isValid =
                        value !== "" || !(restoreViewModel.restoreType === RestoreType.Url);
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
            return;
        }
    }

    private async getRestorePlan(
        useDefaults: boolean,
        currentState?: ObjectManagementWebviewState<RestoreDatabaseFormState>,
    ): Promise<ObjectManagementWebviewState<RestoreDatabaseFormState>> {
        const state = currentState ?? this.state;
        const restoreViewModel = this.restoreViewModel(state);

        if (restoreViewModel.restorePlanStatus === ApiStatus.Loading) {
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
            this.state.errorMessage = getErrorMessage(error);
            this.updateViewModel(restoreViewModel, state);

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
        if (!state.formState.standbyFile) {
            state.formState.standbyFile = plan.planDetails.standbyFile?.currentValue || "";
        }
        if (!state.formState.tailLogBackupFile) {
            state.formState.tailLogBackupFile =
                plan.planDetails.tailLogBackupFile?.currentValue || "";
        }

        restoreViewModel.restorePlanStatus = plan.canRestore ? ApiStatus.Loaded : ApiStatus.Error;
        return this.updateViewModel(restoreViewModel, state);
    }

    private async createRestoreConnectionContext(databaseName: string): Promise<boolean> {
        // If we have an existing connection for a different database, disconnect it
        if (this.state.ownerUri && this.state.ownerUri !== this.node.sessionId) {
            void this.connectionManager.disconnect(this.state.ownerUri);
        }

        const databaseConnectionUri = `${databaseName}_${this.node.sessionId}`;

        // Create a new temp connection for the database if we are not already connected
        // This lets sts know the context of the database we are backing up; otherwise,
        // sts will assume the master database context
        const didConnect = await this.connectionManager.connect(databaseConnectionUri, {
            ...this.node.connectionProfile,
            database: databaseName,
        });

        if (didConnect) {
            this.state.ownerUri = databaseConnectionUri;
        } else {
            const databaseFormComponent = this.state.formComponents["sourceDatabaseName"];
            databaseFormComponent.validation = {
                isValid: false,
                validationMessage:
                    LocConstants.RestoreDatabase.couldNotConnectToDatabase(databaseName),
            };
            this.state.formErrors.push("sourceDatabaseName");
        }
        this.updateState();
        return didConnect;
    }

    private async getRestoreParams(
        taskMode: TaskExecutionMode,
        shouldOverwrite: boolean,
        useDefaults: boolean,
        currentState?: ObjectManagementWebviewState<RestoreDatabaseFormState>,
    ): Promise<RestoreParams> {
        const state = currentState ?? this.state;
        let restoreViewModel = this.restoreViewModel(state);
        const restoreFromDatabase = restoreViewModel.restoreType === RestoreType.Database;

        let backupFilePaths = null;
        if (restoreViewModel.restoreType === RestoreType.BackupFile) {
            backupFilePaths = restoreViewModel.backupFiles.map((f) => f.filePath).join(",");
        } else if (restoreViewModel.restoreType === RestoreType.Url) {
            backupFilePaths = await this.getRestoreUrl(state.formState, restoreViewModel);
        }

        let backupSets = null;
        if (!shouldOverwrite && restoreViewModel.restorePlan) {
            backupSets = restoreViewModel.selectedBackupSets;
        }

        await this.createSasKeyIfNeeded(restoreViewModel, state);

        const sourceDatabaseName = useDefaults ? null : state.formState.sourceDatabaseName;
        if (!useDefaults && sourceDatabaseName && !state.ownerUri.startsWith(sourceDatabaseName)) {
            const didConnect = await this.createRestoreConnectionContext(sourceDatabaseName);
            if (!didConnect) {
                throw new Error(
                    LocConstants.RestoreDatabase.couldNotConnectToDatabase(sourceDatabaseName),
                );
            }
        }

        const restoreInfo: RestoreInfo = {
            targetDatabaseName: useDefaults ? "master" : state.formState.targetDatabaseName,
            sourceDatabaseName: sourceDatabaseName,
            relocateDbFiles: state.formState.relocateDbFiles,
            readHeaderFromMedia: restoreFromDatabase ? false : true,
            overwriteTargetDatabase: shouldOverwrite,
            backupFilePaths: backupFilePaths,
            deviceType:
                restoreViewModel.restoreType === RestoreType.Url
                    ? MediaDeviceType.Url
                    : MediaDeviceType.File,
            selectedBackupSets: backupSets,
        };

        const options: { [key: string]: any } = {};
        if (restoreViewModel.restorePlan) {
            restoreViewModel = this.updatePlanFromState(restoreViewModel, state);

            for (const key in restoreViewModel.restorePlan.planDetails) {
                options[key] = restoreViewModel.restorePlan.planDetails[key];
            }
        }
        for (const key in restoreInfo) {
            options[key] = restoreInfo[key];
        }

        const params: RestoreParams = {
            ...restoreInfo,
            ownerUri: useDefaults ? this.node.sessionId : state.ownerUri,
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                restoreViewModel.restorePlan.planDetails[key].currentValue =
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    state.formState[key] as any;
            }
        }
        for (const key in restoreViewModel) {
            if (key in restoreViewModel.restorePlan?.planDetails) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                restoreViewModel.restorePlan.planDetails[key].currentValue =
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    restoreViewModel[key] as any;
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
            if (key in state.formState) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (state.formState[key] as any) =
                    restoreViewModel.restorePlan?.planDetails[key].defaultValue;
            } else if (key in restoreViewModel) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (restoreViewModel[key] as any) =
                    restoreViewModel.restorePlan?.planDetails[key].defaultValue;
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

    private getRestoreUrl(
        formState: RestoreDatabaseFormState,
        restoreViewModel: RestoreDatabaseViewModel,
    ): string {
        const accountEndpoint =
            getCloudProviderSettings().settings.azureStorageResource.endpoint.replace(https, "");

        const storageAccount = restoreViewModel.storageAccounts.find(
            (sa) => sa.id === formState.storageAccountId,
        );
        const blobContainer = restoreViewModel.blobContainers.find(
            (bc) => bc.id === formState.blobContainerId,
        );

        return `${https}${storageAccount.name}.${accountEndpoint}${blobContainer.name}/${formState.blob}`;
    }

    private async getCredentialNames(): Promise<string[]> {
        const getCredsQuery = `
            SELECT name
            FROM sys.credentials`;

        const result = await this.client.sendRequest(
            new RequestType<
                { ownerUri: string; queryString: string },
                SimpleExecuteResult,
                void,
                void
            >("query/simpleexecute"),
            {
                ownerUri: this.node.sessionId,
                queryString: getCredsQuery,
            },
        );

        if (!result || !result.rows || result.rows.length === 0) {
            return [];
        }

        const credentialNames: string[] = [];
        for (const row of result.rows) {
            if (row && row.length > 0 && row[0] && !row[0].isNull) {
                const credName = row[0].displayValue.trim();
                if (credName) {
                    credentialNames.push(credName);
                }
            }
        }
        return credentialNames;
    }

    private async createSasKeyIfNeeded(
        restoreViewModel: RestoreDatabaseViewModel,
        currentState?: ObjectManagementWebviewState<RestoreDatabaseFormState>,
    ): Promise<void> {
        const state = currentState ?? this.state;
        if (restoreViewModel.restoreType !== RestoreType.Url) {
            return;
        }

        if (!restoreViewModel.restoreUrl) {
            restoreViewModel.restoreUrl = this.getRestoreUrl(state.formState, restoreViewModel);
        }

        const blobContainerUrl = restoreViewModel.restoreUrl.substring(
            0,
            restoreViewModel.restoreUrl.lastIndexOf("/"),
        );

        if (!restoreViewModel.credentialNames.includes(blobContainerUrl)) {
            const subscription = restoreViewModel.subscriptions.find(
                (s) => s.subscriptionId === state.formState.subscriptionId,
            );
            const storageAccount = restoreViewModel.storageAccounts.find(
                (sa) => sa.id === state.formState.storageAccountId,
            );

            if (!subscription || !storageAccount) {
                return;
            }

            let sasKeyResult;
            try {
                sasKeyResult = await VsCodeAzureHelper.getStorageAccountKeys(
                    subscription,
                    storageAccount,
                );
                void this.azureBlobService.createSas(
                    this.connectionUri,
                    blobContainerUrl,
                    sasKeyResult.keys[0].value,
                    storageAccount.name,
                    getExpirationDateForSas(),
                );

                restoreViewModel.credentialNames.push(blobContainerUrl);
            } catch (error) {
                vscode.window.showErrorMessage(
                    LocConstants.BackupDatabase.generatingSASKeyFailedWithError(error.message),
                );
            }
        }
    }
}
