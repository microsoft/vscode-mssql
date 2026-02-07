/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import VscodeWrapper from "./vscodeWrapper";
import { restoreDatabaseHelpLink } from "../constants/constants";
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
    RestorePlanResponse,
    RestoreResponse,
    RestoreParams,
} from "../sharedInterfaces/restore";
import * as LocConstants from "../constants/locConstants";
import { FormItemOptions, FormItemSpec, FormItemType } from "../sharedInterfaces/form";
import ConnectionManager from "./connectionManager";
import {
    loadAzureComponentHelper,
    reloadAzureComponents,
} from "./sharedDisasterRecoveryAzureHelpers";
import { ApiStatus } from "../sharedInterfaces/webview";
import { MediaDeviceType } from "../sharedInterfaces/backup";
import { TaskExecutionMode } from "../sharedInterfaces/schemaCompare";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import { getErrorMessage } from "../utils/utils";

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
        private node: TreeNodeInfo,
    ) {
        super(
            context,
            vscodeWrapper,
            objectManagementService,
            ObjectManagementDialogType.RestoreDatabase,
            LocConstants.RestoreDatabase.restoreDatabaseTitle,
            "restoreDatabaseDialog",
            node.sessionId,
            node.connectionProfile.server || "",
        );

        this.start();
    }

    protected async initializeDialog(): Promise<void> {
        const restoreViewModel = new RestoreDatabaseViewModel();
        this.state.viewModel.model = restoreViewModel;
        // Make sure the load state is set
        this.updateState();

        restoreViewModel.serverName = this.serverName;

        // Get restore config info; Gets the recovery model, default backup folder, and encryptors
        const restoreConfigInfo = (
            await this.objectManagementService.getRestoreConfigInfo(this.state.ownerUri)
        ).configInfo;

        this.state.defaultFileBrowserExpandPath = restoreConfigInfo.defaultBackupFolder;
        restoreViewModel.dataFileFolder = restoreConfigInfo.dataFileFolder;
        restoreViewModel.logFileFolder = restoreConfigInfo.logFileFolder;

        this.state.formComponents = this.setFormComponents();

        // Populate options for source database dropdown based on restoreConfigInfo
        this.state.formComponents["sourceDatabase"].options =
            restoreConfigInfo.sourceDatabaseNamesWithBackupSets.map((dbName) => ({
                value: dbName,
                displayName: dbName,
            }));
        this.state.formState.sourceDatabase =
            restoreConfigInfo.sourceDatabaseNamesWithBackupSets[0];

        // Populate options for target database dropdown based on databases in the server
        const databases = await this.connectionManager.listDatabases(this.connectionUri);
        const targetDatabaseOptions = databases.map((dbName) => ({
            value: dbName,
            displayName: dbName,
        }));
        this.state.formComponents["targetDatabase"].options = targetDatabaseOptions;
        this.state.formState.targetDatabase = this.state.formState.sourceDatabase;

        this.state.formState = {
            ...this.state.formState,
            relocateDbFiles: false,
            overwriteExistingDatabase: false,
            preserveReplicationSettings: false,
            restrictAccess: false,
            recoveryState: RecoveryState.WithRecovery,
            tailLogBackup: false,
            leaveSourceDatabase: false,
            closeConn: false,
        };

        await this.createRestoreConnectionContext(this.state.formState.sourceDatabase);

        this.state.viewModel.model = restoreViewModel;
        try {
            restoreViewModel.restorePlan = await this.getRestorePlan();

            // Set default values in form state based on restore plan defaults
            this.state.formState.relocateDbFiles =
                restoreViewModel.restorePlan.planDetails.relocateDbFiles.defaultValue;
            this.state.formState.overwriteExistingDatabase =
                restoreViewModel.restorePlan.planDetails.replaceExistingDatabase.defaultValue;
            this.state.formState.preserveReplicationSettings =
                restoreViewModel.restorePlan.planDetails.keepReplication.defaultValue;
            this.state.formState.restrictAccess =
                restoreViewModel.restorePlan.planDetails.restrictAccess.defaultValue;
            this.state.formState.recoveryState =
                restoreViewModel.restorePlan.planDetails.recoveryState.defaultValue;
            this.state.formState.tailLogBackup =
                restoreViewModel.restorePlan.planDetails.backupTailLog.defaultValue;
            this.state.formState.leaveSourceDatabase =
                restoreViewModel.restorePlan.planDetails.tailLogWithNoRecovery.defaultValue;
            this.state.formState.closeConn =
                restoreViewModel.restorePlan.planDetails.closeExistingConnections.defaultValue;
        } catch (error) {
            restoreViewModel.restorePlanLoadStatus = ApiStatus.Error;
            restoreViewModel.errorMessage = getErrorMessage(error);
        }

        this.registerRestoreRpcHandlers();
        restoreViewModel.loadState = ApiStatus.Loaded;

        console.log(this.fileBrowserService);
        console.log(this.azureBlobService);

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
                    ["accountId", "tenantId", "subscriptionId", "storageAccountId"].includes(
                        payload.event.propertyName,
                    )
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
            }
            return state;
        });

        this.registerReducer("loadAzureComponent", async (state, payload) => {
            const loadResult = await loadAzureComponentHelper(
                state as ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
                payload,
            );
            return loadResult as ObjectManagementWebviewState<RestoreDatabaseFormState>;
        });

        this.registerReducer("setRestoreType", async (state, payload) => {
            const restoreViewModel = state.viewModel.model as RestoreDatabaseViewModel;
            restoreViewModel.restoreType = payload.restoreType;
            state.viewModel.model = restoreViewModel;
            return state;
        });

        this.registerReducer("restoreDatabase", async (state, _payload) => {
            await this.restoreHelper(TaskExecutionMode.executeAndScript);
            return state;
        });

        this.registerReducer("openRestoreScript", async (state, _payload) => {
            await this.restoreHelper(TaskExecutionMode.script);
            return state;
        });
    }

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
            sourceDatabase: createFormItem({
                type: FormItemType.Dropdown,
                propertyName: "sourceDatabase",
                label: LocConstants.RestoreDatabase.sourceDatabase,
                groupName: RestoreType.Database,
                options: [],
            }),

            targetDatabase: createFormItem({
                type: FormItemType.Dropdown,
                propertyName: "targetDatabase",
                label: LocConstants.RestoreDatabase.targetDatabase,
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

            relocateDbFiles: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "relocateDbFiles",
                label: LocConstants.RestoreDatabase.relocateDbFiles,
                isAdvancedOption: true,
                groupName: LocConstants.RestoreDatabase.files,
            }),

            overwriteExistingDatabase: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "overwriteExistingDatabase",
                label: LocConstants.RestoreDatabase.overwriteExistingDb,
                isAdvancedOption: true,
                groupName: LocConstants.RestoreDatabase.general,
            }),

            preserveReplicationSettings: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "preserveReplicationSettings",
                label: LocConstants.RestoreDatabase.preserveReplicationSettings,
                isAdvancedOption: true,
                groupName: LocConstants.RestoreDatabase.general,
            }),

            restrictAccess: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "restrictAccess",
                label: LocConstants.RestoreDatabase.restrictAccessToRestoredDb,
                isAdvancedOption: true,
                groupName: LocConstants.RestoreDatabase.general,
            }),

            recoveryState: createFormItem({
                type: FormItemType.Dropdown,
                propertyName: "recoveryState",
                label: LocConstants.RestoreDatabase.recoveryState,
                options: this.getRecoveryStateOptions(),
                isAdvancedOption: true,
                groupName: LocConstants.RestoreDatabase.general,
            }),

            tailLogBackup: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "tailLogBackup",
                label: LocConstants.RestoreDatabase.takeTailLogBackup,
                isAdvancedOption: true,
                groupName: LocConstants.RestoreDatabase.tailLogBackup,
            }),

            leaveSourceDatabase: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "leaveSourceDatabase",
                label: LocConstants.RestoreDatabase.leaveSourceDatabase,
                isAdvancedOption: true,
                groupName: LocConstants.RestoreDatabase.tailLogBackup,
            }),

            closeConn: createFormItem({
                type: FormItemType.Checkbox,
                propertyName: "closeConn",
                label: LocConstants.RestoreDatabase.closeExistingConnections,
                isAdvancedOption: true,
                groupName: LocConstants.RestoreDatabase.serverConnections,
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
        const params = this.getRestoreParams(taskMode);
        return await this.objectManagementService.restoreDatabase(params);
    }
    private async getRestorePlan(): Promise<RestorePlanResponse> {
        const params = this.getRestoreParams(TaskExecutionMode.execute);
        return await this.objectManagementService.getRestorePlan(params);
    }

    private async createRestoreConnectionContext(databaseName: string): Promise<void> {
        // If we have an existing connection for a different database, disconnect it
        if (this.state.ownerUri && this.state.ownerUri !== this.node.sessionId) {
            void this.connectionManager.disconnect(this.state.ownerUri);
        }

        const databaseConnectionUri = `${databaseName}_${this.node.sessionId}`;

        // Create a new temp connection for the database if we are not already connected
        // This lets sts know the context of the database we are backing up; otherwise,
        // sts will assume the master database context
        await this.connectionManager.connect(databaseConnectionUri, {
            ...this.node.connectionProfile,
            database: databaseName,
        });

        this.state.ownerUri = databaseConnectionUri;
    }

    private getRestoreParams(taskMode: TaskExecutionMode): RestoreParams {
        const restoreViewModel = this.restoreViewModel();
        const restoreFromDatabase = restoreViewModel.restoreType === RestoreType.Database;

        const backupFilePathsCommaDelimited = restoreViewModel.backupFilePaths.join(",");
        const restoreInfo: RestoreInfo = {
            targetDatabaseName: this.state.formState.targetDatabase,
            sourceDatabaseName: this.state.formState.sourceDatabase || null,
            relocateDbFiles: this.state.formState.relocateDbFiles,
            readHeaderFromMedia: restoreFromDatabase ? false : true,
            overwriteTargetDatabase: true,
            backupFilePaths: restoreFromDatabase ? null : backupFilePathsCommaDelimited,
            deviceType:
                restoreViewModel.restoreType === RestoreType.Url
                    ? MediaDeviceType.Url
                    : MediaDeviceType.File,
            selectedBackupSets: null,
        };

        const options: { [key: string]: any } = {};
        if (restoreViewModel.restorePlan) {
            // Take tail log backup
            restoreViewModel.restorePlan.planDetails.backupTailLog.currentValue =
                this.state.formState.tailLogBackup;

            // Close existing connections
            restoreViewModel.restorePlan.planDetails.closeExistingConnections.currentValue =
                this.state.formState.closeConn;

            // Data file folder
            restoreViewModel.restorePlan.planDetails.dataFileFolder.currentValue =
                restoreViewModel.dataFileFolder;

            // Preserve replication settings
            restoreViewModel.restorePlan.planDetails.keepReplication.currentValue =
                this.state.formState.preserveReplicationSettings;

            // Log file folder
            restoreViewModel.restorePlan.planDetails.logFileFolder.currentValue =
                restoreViewModel.logFileFolder;

            // Recovery state
            restoreViewModel.restorePlan.planDetails.recoveryState.currentValue =
                this.state.formState.recoveryState;

            // Relocate db files
            restoreViewModel.restorePlan.planDetails.relocateDbFiles.currentValue =
                this.state.formState.relocateDbFiles;

            // Overwrite target database
            restoreViewModel.restorePlan.planDetails.replaceDatabase.currentValue =
                this.state.formState.overwriteExistingDatabase;

            // Restrict access to restored database
            restoreViewModel.restorePlan.planDetails.setRestrictedUser.currentValue =
                this.state.formState.restrictAccess;

            // Source database name
            restoreViewModel.restorePlan.planDetails.sourceDatabaseName.currentValue =
                this.state.formState.sourceDatabase;

            // Standby file
            if (restoreViewModel.standbyFile) {
                restoreViewModel.restorePlan.planDetails.standbyFile.currentValue =
                    restoreViewModel.standbyFile;
            }

            // Tail log backup file
            if (restoreViewModel.tailLogBackupFilePath) {
                restoreViewModel.restorePlan.planDetails.tailLogBackupFile.currentValue =
                    restoreViewModel.tailLogBackupFilePath;
            }

            // Leave source database in the restored state after restore
            restoreViewModel.restorePlan.planDetails.tailLogWithNoRecovery.currentValue =
                this.state.formState.leaveSourceDatabase;

            // Target database name
            restoreViewModel.restorePlan.planDetails.targetDatabaseName.currentValue =
                this.state.formState.targetDatabase;

            for (const key in restoreViewModel.restorePlan.planDetails) {
                options[key] = restoreViewModel.restorePlan.planDetails[key];
            }
        }
        for (const key in restoreInfo) {
            options[key] = restoreInfo[key];
        }

        const params: RestoreParams = {
            ...restoreInfo,
            ownerUri: this.state.ownerUri,
            options: options,
            taskExecutionMode: taskMode,
        };
        return params;
    }
}
