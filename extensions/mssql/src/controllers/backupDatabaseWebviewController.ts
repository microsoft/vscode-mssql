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
    ObjectManagementService,
    PhysicalDeviceType,
} from "../sharedInterfaces/objectManagement";
import { ApiStatus } from "../sharedInterfaces/webview";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import { FormWebviewController } from "../forms/formWebviewController";
import * as LocConstants from "../constants/locConstants";
import { TaskExecutionMode } from "../sharedInterfaces/task";
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
        private azureBlobService: AzureBlobService,
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

        this.state.defaultBackupName = this.getDefaultBackupFileName(this.state);

        this.state.backupFiles = [
            {
                filePath: `${this.state.defaultFileBrowserExpandPath}/${this.state.defaultBackupName}`,
                isExisting: false,
            },
        ];

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
        this.registerReducer("formAction", async (state, payload) => {
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
            } else {
                (state.formState[
                    payload.event.propertyName
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ] as any) = payload.event.value;
                if (
                    ["accountId", "tenantId", "subscriptionId", "storageAccountId"].includes(
                        payload.event.propertyName,
                    )
                ) {
                    // Reload necessary dependent components
                    state = this.reloadAzureComponents(state, payload.event.propertyName);
                }
            }
            return state;
        });

        this.registerReducer("backupDatabase", async (state, _payload) => {
            await this.backupHelper(TaskExecutionMode.execute, state);
            return state;
        });

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
            return state;
        });

        this.registerReducer("openBackupScript", async (state, _payload) => {
            await this.backupHelper(TaskExecutionMode.script, state);
            return state;
        });

        this.registerReducer("setSaveLocation", async (state, payload) => {
            state.saveToUrl = payload.saveToUrl;
            return state;
        });

        this.registerReducer("removeBackupFile", async (state, payload) => {
            state.backupFiles = state.backupFiles.filter(
                (file) => file.filePath !== payload.filePath,
            );
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
            // only set azure context if it has not already been set
            if (state.azureComponentStatuses[payload.componentName] !== ApiStatus.NotStarted)
                return;

            switch (payload.componentName) {
                case "accountId":
                    return await this.loadAccountComponent(state);
                case "tenantId":
                    return await this.loadTenantComponent(state);
                case "subscriptionId":
                    return await this.loadSubscriptionComponent(state);
                case "storageAccountId":
                    return await this.loadStorageAccountComponent(state);
                case "blobContainerId":
                    return await this.loadBlobContainerComponent(state);
                default:
                    break;
            }
            return state;
        });

        registerFileBrowserReducers(
            this as ReactWebviewPanelController<FileBrowserWebviewState, FileBrowserReducers, any>,
            this.fileBrowserService,
            defaultBackupFileTypes,
        );
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
            }),

            tenantId: createFormItem({
                propertyName: "tenantId",
                label: LocConstants.BackupDatabase.tenant,
                required: true,
                type: FormItemType.Dropdown,
                options: [],
                placeholder: LocConstants.ConnectionDialog.selectATenant,
                groupName: url,
            }),

            subscriptionId: createFormItem({
                propertyName: "subscriptionId",
                label: LocConstants.BackupDatabase.subscription,
                required: true,
                type: FormItemType.SearchableDropdown,
                options: [],
                placeholder: LocConstants.BackupDatabase.selectASubscription,
                groupName: url,
            }),

            storageAccountId: createFormItem({
                propertyName: "storageAccountId",
                label: LocConstants.BackupDatabase.storageAccount,
                required: true,
                type: FormItemType.SearchableDropdown,
                options: [],
                placeholder: LocConstants.BackupDatabase.selectAStorageAccount,
                groupName: url,
            }),

            blobContainerId: createFormItem({
                propertyName: "blobContainerId",
                label: LocConstants.BackupDatabase.blobContainer,
                required: true,
                type: FormItemType.SearchableDropdown,
                options: [],
                placeholder: LocConstants.BackupDatabase.selectABlobContainer,
                groupName: url,
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
            }),

            mediaSetName: createFormItem({
                type: FormItemType.Input,
                propertyName: "mediaSetName",
                label: LocConstants.BackupDatabase.newMediaSetName,
                isAdvancedOption: true,
                groupName: LocConstants.BackupDatabase.media,
            }),

            mediaSetDescription: createFormItem({
                type: FormItemType.Input,
                propertyName: "mediaSetDescription",
                label: LocConstants.BackupDatabase.newMediaSetDescription,
                isAdvancedOption: true,
                groupName: LocConstants.BackupDatabase.media,
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

    private getDefaultBackupFileName(state): string {
        const newFiles = state.backupFiles.filter((file) => !file.isExisting);
        let name = this.databaseNode.label.toString();
        if (newFiles.length > 0) {
            name += `_${newFiles.length}`;
        }
        return name + `_${new Date().toISOString().slice(0, 19)}.bak`;
    }

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
        if (state.saveToUrl) {
            const accountEndpoint =
                getCloudProviderSettings().settings.azureStorageResource.endpoint.replace(
                    "https://",
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

            const blobContainerUrl = `https://${storageAccount.name}.${accountEndpoint}${blobContainer.name}`;
            const backupUrl = `${blobContainerUrl}/${state.formState.backupName}`;
            backupPathDevices[backupUrl] = MediaDeviceType.Url;
            backupPathList.push(backupUrl);

            const key = (
                await VsCodeAzureHelper.getStorageAccountKeys(subscription, storageAccount)
            ).keys[0].value;

            const sasResponse = await this.azureBlobService.createSas(
                state.ownerUri,
                blobContainerUrl,
                key,
                storageAccount.name,
                nextYear(),
            );
            console.log("SAS Response: ", sasResponse);
        } else {
            for (const file of state.backupFiles) {
                backupPathDevices[file.filePath] = MediaDeviceType.File;
                backupPathList.push(file.filePath);
            }
        }

        const backupInfo: BackupInfo = {
            databaseName: this.databaseNode.label.toString(),
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
        return this.objectManagementService.backupDatabase(
            state.databaseNode.nodeUri,
            backupInfo,
            mode,
        );
    }

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
                await VsCodeAzureHelper.signIn(true);

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
        state.azureComponentStatuses["accountId"] = ApiStatus.Loaded;

        return state;
    }

    private async loadTenantComponent(state: BackupDatabaseState): Promise<BackupDatabaseState> {
        const tenantComponent = state.formComponents["tenantId"];

        if (!state.formState.accountId) {
            state.azureComponentStatuses["tenantId"] = ApiStatus.Error;
            tenantComponent.placeholder = LocConstants.BackupDatabase.noTenantsFound;
            return state;
        }
        const tenants = await VsCodeAzureHelper.getTenantsForAccount(state.formState.accountId);
        const tenantOptions = tenants.map((tenant) => ({
            displayName: tenant.displayName,
            value: tenant.tenantId,
        }));
        tenantComponent.options = tenantOptions;
        tenantComponent.placeholder = tenants.length
            ? LocConstants.ConnectionDialog.selectATenant
            : LocConstants.BackupDatabase.noTenantsFound;

        state.formState.tenantId = getDefaultTenantId(state.formState.accountId, tenants);
        state.tenants = tenants;
        state.azureComponentStatuses["tenantId"] = ApiStatus.Loaded;

        return state;
    }

    private async loadSubscriptionComponent(
        state: BackupDatabaseState,
    ): Promise<BackupDatabaseState> {
        const subscriptionComponent = state.formComponents["subscriptionId"];

        if (!state.formState.tenantId) {
            state.azureComponentStatuses["subscriptionId"] = ApiStatus.Error;
            subscriptionComponent.placeholder = LocConstants.BackupDatabase.noSubscriptionsFound;
            return state;
        }
        const tenant = state.tenants.find((t) => t.tenantId === state.formState.tenantId);
        const subscriptions = await VsCodeAzureHelper.getSubscriptionsForTenant(tenant);
        const subscriptionOptions = subscriptions.map((subscription) => ({
            displayName: subscription.name,
            value: subscription.subscriptionId,
        }));
        subscriptionComponent.options = subscriptionOptions;
        state.formState.subscriptionId =
            subscriptionOptions.length > 0 ? subscriptionOptions[0].value : "";
        subscriptionComponent.placeholder = subscriptions.length
            ? LocConstants.BackupDatabase.selectASubscription
            : LocConstants.BackupDatabase.noSubscriptionsFound;

        state.subscriptions = subscriptions;
        state.azureComponentStatuses["subscriptionId"] = ApiStatus.Loaded;

        return state;
    }

    private async loadStorageAccountComponent(
        state: BackupDatabaseState,
    ): Promise<BackupDatabaseState> {
        const storageAccountComponent = state.formComponents["storageAccountId"];

        if (!state.formState.subscriptionId) {
            state.azureComponentStatuses["storageAccountId"] = ApiStatus.Error;
            storageAccountComponent.placeholder =
                LocConstants.BackupDatabase.noStorageAccountsFound;
            return state;
        }

        const subscription = state.subscriptions.find(
            (s) => s.subscriptionId === state.formState.subscriptionId,
        );
        const storageAccounts =
            await VsCodeAzureHelper.fetchStorageAccountsForSubscription(subscription);
        const storageAccountOptions = storageAccounts.map((account) => ({
            displayName: account.name,
            value: account.id,
        }));
        storageAccountComponent.options = storageAccountOptions;
        state.formState.storageAccountId =
            storageAccountOptions.length > 0 ? storageAccountOptions[0].value : "";
        state.storageAccounts = storageAccounts;
        storageAccountComponent.placeholder = storageAccountOptions.length
            ? LocConstants.BackupDatabase.selectAStorageAccount
            : LocConstants.BackupDatabase.noStorageAccountsFound;

        state.azureComponentStatuses["storageAccountId"] = ApiStatus.Loaded;
        return state;
    }

    private async loadBlobContainerComponent(
        state: BackupDatabaseState,
    ): Promise<BackupDatabaseState> {
        if (!state.formState.storageAccountId || !state.formState.subscriptionId) {
            state.azureComponentStatuses["blobContainerId"] = ApiStatus.Error;
            state.formComponents["blobContainerId"].placeholder =
                LocConstants.BackupDatabase.noBlobContainersFound;
            return state;
        }

        const subscription = state.subscriptions.find(
            (s) => s.subscriptionId === state.formState.subscriptionId,
        );
        const storageAccount = state.storageAccounts.find(
            (sa) => sa.id === state.formState.storageAccountId,
        );
        const blobContainerComponent = state.formComponents["blobContainerId"];
        const blobContainers = await VsCodeAzureHelper.fetchBlobContainersForStorageAccount(
            subscription,
            storageAccount,
        );
        const blobContainerOptions = blobContainers.map((container) => ({
            displayName: container.name,
            value: container.id,
        }));
        blobContainerComponent.options = blobContainerOptions;
        state.formState.blobContainerId =
            blobContainerOptions.length > 0 ? blobContainerOptions[0].value : "";
        blobContainerComponent.placeholder = blobContainerOptions.length
            ? LocConstants.BackupDatabase.selectABlobContainer
            : LocConstants.BackupDatabase.noBlobContainersFound;

        state.blobContainers = blobContainers;
        state.azureComponentStatuses["blobContainerId"] = ApiStatus.Loaded;
        return state;
    }

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
}
