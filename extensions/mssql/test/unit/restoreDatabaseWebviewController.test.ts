/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { ObjectManagementService } from "../../src/services/objectManagementService";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { stubTelemetry, stubVscodeWrapper } from "./utils";
import { FileBrowserService } from "../../src/services/fileBrowserService";
import { AzureBlobService } from "../../src/services/azureBlobService";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import * as LocConstants from "../../src/constants/locConstants";
import {
    allFileTypes,
    defaultBackupFileTypes,
    defaultDatabase,
    restoreDatabaseHelpLink,
} from "../../src/constants/constants";
import {
    DisasterRecoveryAzureFormState,
    DisasterRecoveryType,
    ObjectManagementDialogType,
    ObjectManagementFormItemSpec,
    ObjectManagementWebviewState,
} from "../../src/sharedInterfaces/objectManagement";
import { ConnectionProfile } from "../../src/models/connectionProfile";
import ConnectionManager from "../../src/controllers/connectionManager";
import {
    RecoveryState,
    RestoreDatabaseFormState,
    RestoreDatabaseViewModel,
    RestorePlanResponse,
} from "../../src/sharedInterfaces/restore";
import { RestoreDatabaseWebviewController } from "../../src/controllers/restoreDatabaseWebviewController";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import { TaskExecutionMode } from "../../src/sharedInterfaces/schemaCompare";
import { FormItemType } from "../../src/sharedInterfaces/form";
import * as utils from "../../src/controllers/sharedDisasterRecoveryUtils";
import { VsCodeAzureHelper } from "../../src/connectionconfig/azureHelpers";
import { AzureSubscription } from "@microsoft/vscode-azext-azureauth";
import { BlobItem } from "@azure/storage-blob";
import { BlobContainer, StorageAccount } from "@azure/arm-storage";
import { MediaDeviceType } from "../../src/sharedInterfaces/backup";

chai.use(sinonChai);

suite("RestoreDatabaseWebviewController", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockObjectManagementService: ObjectManagementService;
    let mockProfile: ConnectionProfile;
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let mockFileBrowserService: FileBrowserService;
    let mockAzureBlobService: AzureBlobService;
    let controller: RestoreDatabaseWebviewController;
    let mockInitialState: ObjectManagementWebviewState<RestoreDatabaseFormState>;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let getRestoreConfigInfoStub: sinon.SinonStub;
    // let getRestorePlanStub: sinon.SinonStub;
    const defaultBackupName = "testDatabase_YYYYMMDD_HHMMSS.bak";
    const mockConfigInfo = {
        configInfo: {
            defaultBackupFolder: "C:\\Backups",
            dataFileFolder: "C:\\DataFiles",
            logFileFolder: "C:\\LogFiles",
            sourceDatabaseNamesWithBackupSets: ["testDatabase", "otherDatabase"],
        },
    };

    setup(async () => {
        sandbox = sinon.createSandbox();
        mockContext = {
            extensionUri: vscode.Uri.parse("https://localhost"),
            extensionPath: "path",
        } as unknown as vscode.ExtensionContext;

        vscodeWrapper = stubVscodeWrapper(sandbox);

        mockObjectManagementService = sandbox.createStubInstance(ObjectManagementService);
        mockAzureBlobService = sandbox.createStubInstance(AzureBlobService);
        mockConnectionManager = sandbox.createStubInstance(ConnectionManager);

        getRestoreConfigInfoStub =
            mockObjectManagementService.getRestoreConfigInfo as sinon.SinonStub;
        mockObjectManagementService.getBackupConfigInfo as sinon.SinonStub;
        getRestoreConfigInfoStub.resolves(mockConfigInfo);

        const listDatabaseStub = mockConnectionManager.listDatabases as sinon.SinonStub;
        listDatabaseStub.resolves(["testDatabase", "otherDatabase"]);

        mockProfile = {
            id: "profile-id",
            server: "serverName",
            database: "testDatabase",
        } as unknown as ConnectionProfile;

        controller = new RestoreDatabaseWebviewController(
            mockContext,
            vscodeWrapper,
            mockObjectManagementService,
            mockConnectionManager,
            mockFileBrowserService,
            mockAzureBlobService,
            mockProfile,
            "ownerUri",
            mockProfile.database,
        );

        mockInitialState = {
            viewModel: {
                dialogType: ObjectManagementDialogType.RestoreDatabase,
                model: {
                    loadState: ApiStatus.Loaded,
                    azureComponentStatuses: {
                        accountId: ApiStatus.NotStarted,
                        tenantId: ApiStatus.NotStarted,
                        subscriptionId: ApiStatus.NotStarted,
                        storageAccountId: ApiStatus.NotStarted,
                        blobContainerId: ApiStatus.NotStarted,
                    },
                    type: DisasterRecoveryType.BackupFile,
                    backupFiles: [
                        {
                            filePath: `${mockConfigInfo.configInfo.defaultBackupFolder}/${defaultBackupName}`,
                            isExisting: false,
                        },
                    ],
                    tenants: [],
                    subscriptions: [],
                    storageAccounts: [],
                    blobContainers: [],
                    url: "",
                    serverName: "serverName",
                    restorePlan: undefined,
                    restorePlanStatus: ApiStatus.NotStarted,
                    blobs: [],
                    cachedRestorePlanParams: undefined,
                    selectedBackupSets: [],
                } as RestoreDatabaseViewModel,
            },
            ownerUri: "ownerUri",
            databaseName: "testDatabase",
            defaultFileBrowserExpandPath: mockConfigInfo.configInfo.defaultBackupFolder,
            formState: {
                sourceDatabaseName: "",
                targetDatabaseName: "",
                accountId: "",
                tenantId: "",
                subscriptionId: "",
                storageAccountId: "",
                blobContainerId: "",
                dataFileFolder: mockConfigInfo.configInfo.dataFileFolder,
                logFileFolder: mockConfigInfo.configInfo.logFileFolder,
            } as RestoreDatabaseFormState,
            formComponents: {},
            fileBrowserState: undefined,
            dialog: undefined,
            formErrors: [],
            fileFilterOptions: [
                {
                    displayName: LocConstants.BackupDatabase.backupFileTypes,
                    value: defaultBackupFileTypes,
                },
                {
                    displayName: LocConstants.BackupDatabase.allFiles,
                    value: allFileTypes,
                },
            ],
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        await controller["initializeDialog"]();

        mockInitialState.formComponents = controller[
            "setFormComponents"
        ] as typeof mockInitialState.formComponents;

        expect(getRestoreConfigInfoStub).to.have.been.called;
        expect(listDatabaseStub).to.have.been.called;

        await controller["registerRestoreRpcHandlers"]();
        expect((controller.state.viewModel.model as RestoreDatabaseViewModel).loadState).to.equal(
            ApiStatus.Loaded,
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    test("should initialize with correct state", async () => {
        const { sendActionEvent, sendErrorEvent } = stubTelemetry(sandbox);

        // --- Path 1: Azure SQL DB not supported ---
        // Simulate a profile that returns both Azure and SQL server types
        const azureProfile = {
            ...mockProfile,
            server: "https://test.database.windows.net",
        } as unknown as ConnectionProfile;

        const azureController = new RestoreDatabaseWebviewController(
            mockContext,
            vscodeWrapper,
            mockObjectManagementService,
            mockConnectionManager,
            mockFileBrowserService,
            mockAzureBlobService,
            azureProfile,
            "ownerUri",
            azureProfile.database,
        );

        let getRestorePlanStub = sandbox.stub(azureController as any, "getRestorePlan");
        let setDefaultFormValuesFromPlanStub = sandbox.stub(
            azureController as any,
            "setDefaultFormValuesFromPlan",
        );
        await azureController["initializeDialog"]();

        let resultModel = azureController.state.viewModel.model as RestoreDatabaseViewModel;
        expect(resultModel.loadState).to.equal(ApiStatus.Error);
        expect(resultModel.errorMessage).to.equal(
            LocConstants.RestoreDatabase.azureSqlDbNotSupported,
        );
        expect(getRestorePlanStub).to.not.have.been.called;
        expect(setDefaultFormValuesFromPlanStub).to.not.have.been.called;
        getRestorePlanStub.resetHistory();
        setDefaultFormValuesFromPlanStub.resetHistory();

        // --- Path 2: getRestoreConfigInfo throws ---
        getRestoreConfigInfoStub.rejects(new Error("Service unavailable"));
        const errorController = new RestoreDatabaseWebviewController(
            mockContext,
            vscodeWrapper,
            mockObjectManagementService,
            mockConnectionManager,
            mockFileBrowserService,
            mockAzureBlobService,
            mockProfile,
            "ownerUri",
            mockProfile.database,
        );
        getRestorePlanStub = sandbox.stub(errorController as any, "getRestorePlan");
        setDefaultFormValuesFromPlanStub = sandbox.stub(
            errorController as any,
            "setDefaultFormValuesFromPlan",
        );
        await errorController["initializeDialog"]();
        resultModel = errorController.state.viewModel.model as RestoreDatabaseViewModel;
        expect(resultModel.loadState).to.equal(ApiStatus.Error);
        expect(resultModel.errorMessage).to.equal("Service unavailable");
        expect(getRestorePlanStub).to.not.have.been.called;
        expect(setDefaultFormValuesFromPlanStub).to.not.have.been.called;

        // Reset stub back to resolving
        getRestoreConfigInfoStub.resolves(mockConfigInfo);

        // --- Path 3: databaseName exists in sourceDatabaseNamesWithBackupSets ---
        const happyController = new RestoreDatabaseWebviewController(
            mockContext,
            vscodeWrapper,
            mockObjectManagementService,
            mockConnectionManager,
            mockFileBrowserService,
            mockAzureBlobService,
            mockProfile,
            "ownerUri",
            "testDatabase", // exists in list
        );
        getRestorePlanStub = sandbox
            .stub(happyController as any, "getRestorePlan")
            .resolves(mockInitialState);
        setDefaultFormValuesFromPlanStub = sandbox
            .stub(happyController as any, "setDefaultFormValuesFromPlan")
            .returns(mockInitialState.viewModel.model);
        await happyController["initializeDialog"]();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(getRestorePlanStub).to.have.been.called;
        expect(setDefaultFormValuesFromPlanStub).to.have.been.called;
        resultModel = happyController.state.viewModel.model as RestoreDatabaseViewModel;
        expect(happyController.state.formState.sourceDatabaseName).to.equal("testDatabase");
        expect(happyController.state.formState.targetDatabaseName).to.equal("testDatabase");
        expect(happyController.state.formState.recoveryState).to.equal(RecoveryState.WithRecovery);
        expect(resultModel.loadState).to.equal(ApiStatus.Loaded);
        expect(happyController.state.defaultFileBrowserExpandPath).to.equal("C:\\Backups");
        expect(happyController.state.fileFilterOptions).to.deep.equal([
            {
                displayName: LocConstants.BackupDatabase.backupFileTypes,
                value: defaultBackupFileTypes,
            },
            { displayName: LocConstants.BackupDatabase.allFiles, value: allFileTypes },
        ]);
        expect(happyController.state.formState.relocateDbFiles).to.equal(false);
        expect(happyController.state.formState.replaceDatabase).to.equal(false);
        expect(happyController.state.formState.dataFileFolder).to.equal("C:\\DataFiles");
        expect(happyController.state.formState.logFileFolder).to.equal("C:\\LogFiles");

        // --- Path 4: databaseName NOT in sourceDatabaseNamesWithBackupSets, list non-empty ---
        getRestoreConfigInfoStub.resolves({
            configInfo: {
                ...mockConfigInfo.configInfo,
                sourceDatabaseNamesWithBackupSets: ["otherDatabase"],
            },
        });
        const fallbackController = new RestoreDatabaseWebviewController(
            mockContext,
            vscodeWrapper,
            mockObjectManagementService,
            mockConnectionManager,
            mockFileBrowserService,
            mockAzureBlobService,
            mockProfile,
            "ownerUri",
            "testDatabase", // NOT in list
        );
        await fallbackController["initializeDialog"]();
        expect(fallbackController.state.formState.sourceDatabaseName).to.equal("otherDatabase");

        // --- Path 5: sourceDatabaseNamesWithBackupSets is empty ---
        getRestoreConfigInfoStub.resolves({
            configInfo: {
                ...mockConfigInfo.configInfo,
                sourceDatabaseNamesWithBackupSets: [],
            },
        });
        getRestorePlanStub.rejects(new Error("No databases with backup sets"));
        const emptyController = new RestoreDatabaseWebviewController(
            mockContext,
            vscodeWrapper,
            mockObjectManagementService,
            mockConnectionManager,
            mockFileBrowserService,
            mockAzureBlobService,
            mockProfile,
            "ownerUri",
            "testDatabase",
        );
        await emptyController["initializeDialog"]();
        const emptyState = emptyController.state;
        expect(emptyState.formComponents["sourceDatabaseName"]?.placeholder).to.equal(
            LocConstants.RestoreDatabase.noDatabasesWithBackups,
        );
        expect(sendErrorEvent).to.have.been.calledWith(
            TelemetryViews.Restore,
            TelemetryActions.GetRestorePlan,
        );
        expect(sendActionEvent).to.have.been.calledWith(
            TelemetryViews.Restore,
            TelemetryActions.InitializeRestore,
        );
    });

    test("helpLink should return restoreDatabaseHelpLink", () => {
        expect(controller["helpLink"]).to.equal(restoreDatabaseHelpLink);
    });

    test("handleScript should call restoreHelper with script mode and return result", async () => {
        const restoreHelperStub = sandbox
            .stub(controller as any, "restoreHelper")
            .resolves({ result: true, errorMessage: undefined });

        const result = await controller["handleScript"](undefined);

        expect(restoreHelperStub).to.have.been.calledOnceWith(TaskExecutionMode.script);
        expect(result.success).to.equal(true);
        expect(result.errorMessage).to.be.undefined;

        // Error case
        restoreHelperStub.resolves({ result: false, errorMessage: "Script failed" });
        const errorResult = await controller["handleScript"](undefined);
        expect(errorResult.success).to.equal(false);
        expect(errorResult.errorMessage).to.equal("Script failed");
    });

    test("handleSubmit should call restoreHelper with executeAndScript mode and return result", async () => {
        const restoreHelperStub = sandbox
            .stub(controller as any, "restoreHelper")
            .resolves({ result: true, errorMessage: undefined });

        const result = await controller["handleSubmit"](undefined);

        expect(restoreHelperStub).to.have.been.calledOnceWith(TaskExecutionMode.executeAndScript);
        expect(result.success).to.equal(true);
        expect(result.errorMessage).to.be.undefined;

        // Error case
        restoreHelperStub.resolves({ result: false, errorMessage: "Restore failed" });
        const errorResult = await controller["handleSubmit"](undefined);
        expect(errorResult.success).to.equal(false);
        expect(errorResult.errorMessage).to.equal("Restore failed");
    });

    test("restoreViewModel should return model from provided state or this.state", () => {
        const customState = {
            ...mockInitialState,
            viewModel: {
                ...mockInitialState.viewModel,
                model: {
                    ...mockInitialState.viewModel.model,
                    loadState: ApiStatus.Loading,
                } as RestoreDatabaseViewModel,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        // With explicit state provided
        const resultWithState = controller["restoreViewModel"](customState);
        expect(resultWithState.loadState).to.equal(ApiStatus.Loading);

        // Without state, falls back to this.state
        const resultWithoutState = controller["restoreViewModel"]();
        expect(resultWithoutState).to.equal(controller.state.viewModel.model);
    });

    test("updateViewModel should update model on this.state and call updateState", () => {
        const updateStateStub = sandbox.stub(controller as any, "updateState");

        const updatedModel = {
            ...mockInitialState.viewModel.model,
            loadState: ApiStatus.Error,
            errorMessage: "something went wrong",
        } as RestoreDatabaseViewModel;

        controller["updateViewModel"](updatedModel);

        const updatedViewModel = controller.state.viewModel.model as RestoreDatabaseViewModel;
        expect(updatedViewModel).to.equal(updatedModel);
        expect(updatedViewModel.loadState).to.equal(ApiStatus.Error);
        expect(updatedViewModel.errorMessage).to.equal("something went wrong");
        expect(updateStateStub).to.have.been.calledOnce;
    });

    test("setFormComponents sets form components correctly", async () => {
        const urlMockState = {
            viewModel: {
                model: { type: DisasterRecoveryType.Url } as RestoreDatabaseViewModel,
                dialogType: ObjectManagementDialogType.RestoreDatabase,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        const nonUrlMockState = {
            viewModel: {
                model: { type: DisasterRecoveryType.Database } as RestoreDatabaseViewModel,
                dialogType: ObjectManagementDialogType.RestoreDatabase,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        const formComponents = controller.state.formComponents as Record<
            string,
            ObjectManagementFormItemSpec<RestoreDatabaseFormState>
        >;

        // sourceDatabaseName
        const sourceDatabaseNameComponent = formComponents["sourceDatabaseName"];
        expect(sourceDatabaseNameComponent.type).to.equal(FormItemType.Dropdown);
        expect(sourceDatabaseNameComponent.required).to.be.false;
        expect(sourceDatabaseNameComponent.groupName).to.equal(DisasterRecoveryType.Database);
        expect(sourceDatabaseNameComponent.options[0].value).to.equal("testDatabase");
        expect(sourceDatabaseNameComponent.options[0].displayName).to.equal("testDatabase");

        // targetDatabaseName
        const targetDatabaseNameComponent = formComponents["targetDatabaseName"];
        expect(targetDatabaseNameComponent.type).to.equal(FormItemType.Combobox);
        expect(targetDatabaseNameComponent.required).to.be.false;
        expect(targetDatabaseNameComponent.componentProps).to.deep.equal({ freeform: true });
        expect(targetDatabaseNameComponent.options[1].value).to.equal("otherDatabase");
        expect(targetDatabaseNameComponent.options[1].displayName).to.equal("otherDatabase");

        // accountId
        const accountIdComponent = formComponents["accountId"];
        expect(accountIdComponent.type).to.equal(FormItemType.Dropdown);
        expect(accountIdComponent.required).to.be.true;
        expect(accountIdComponent.groupName).to.equal(DisasterRecoveryType.Url);
        expect(accountIdComponent.placeholder).to.equal(
            LocConstants.ConnectionDialog.selectAnAccount,
        );
        let validation = accountIdComponent.validate(urlMockState, "");
        expect(validation.isValid).to.be.false;
        expect(validation.validationMessage).to.equal(
            LocConstants.BackupDatabase.azureAccountIsRequired,
        );
        validation = accountIdComponent.validate(urlMockState, "some-id");
        expect(validation.isValid).to.be.true;
        validation = accountIdComponent.validate(nonUrlMockState, "");
        expect(validation.isValid).to.be.true;

        // tenantId
        const tenantIdComponent = formComponents["tenantId"];
        expect(tenantIdComponent.type).to.equal(FormItemType.Dropdown);
        expect(tenantIdComponent.required).to.be.true;
        expect(tenantIdComponent.groupName).to.equal(DisasterRecoveryType.Url);
        expect(tenantIdComponent.placeholder).to.equal(LocConstants.ConnectionDialog.selectATenant);
        validation = tenantIdComponent.validate(urlMockState, "");
        expect(validation.isValid).to.be.false;
        expect(validation.validationMessage).to.equal(LocConstants.BackupDatabase.tenantIsRequired);
        validation = tenantIdComponent.validate(urlMockState, "some-id");
        expect(validation.isValid).to.be.true;
        validation = tenantIdComponent.validate(nonUrlMockState, "");
        expect(validation.isValid).to.be.true;

        // subscriptionId
        const subscriptionIdComponent = formComponents["subscriptionId"];
        expect(subscriptionIdComponent.type).to.equal(FormItemType.SearchableDropdown);
        expect(subscriptionIdComponent.required).to.be.true;
        expect(subscriptionIdComponent.groupName).to.equal(DisasterRecoveryType.Url);
        expect(subscriptionIdComponent.placeholder).to.equal(
            LocConstants.BackupDatabase.selectASubscription,
        );
        validation = subscriptionIdComponent.validate(urlMockState, "");
        expect(validation.isValid).to.be.false;
        expect(validation.validationMessage).to.equal(
            LocConstants.BackupDatabase.subscriptionIsRequired,
        );
        validation = subscriptionIdComponent.validate(urlMockState, "some-id");
        expect(validation.isValid).to.be.true;
        validation = subscriptionIdComponent.validate(nonUrlMockState, "");
        expect(validation.isValid).to.be.true;

        // storageAccountId
        const storageAccountComponent = formComponents["storageAccountId"];
        expect(storageAccountComponent.type).to.equal(FormItemType.SearchableDropdown);
        expect(storageAccountComponent.required).to.be.true;
        expect(storageAccountComponent.groupName).to.equal(DisasterRecoveryType.Url);
        expect(storageAccountComponent.placeholder).to.equal(
            LocConstants.BackupDatabase.selectAStorageAccount,
        );
        validation = storageAccountComponent.validate(urlMockState, "");
        expect(validation.isValid).to.be.false;
        expect(validation.validationMessage).to.equal(
            LocConstants.BackupDatabase.storageAccountIsRequired,
        );
        validation = storageAccountComponent.validate(urlMockState, "some-id");
        expect(validation.isValid).to.be.true;
        validation = storageAccountComponent.validate(nonUrlMockState, "");
        expect(validation.isValid).to.be.true;

        // blobContainerId
        const blobContainerComponent = formComponents["blobContainerId"];
        expect(blobContainerComponent.type).to.equal(FormItemType.SearchableDropdown);
        expect(blobContainerComponent.required).to.be.true;
        expect(blobContainerComponent.groupName).to.equal(DisasterRecoveryType.Url);
        expect(blobContainerComponent.placeholder).to.equal(
            LocConstants.BackupDatabase.selectABlobContainer,
        );
        validation = blobContainerComponent.validate(urlMockState, "");
        expect(validation.isValid).to.be.false;
        expect(validation.validationMessage).to.equal(
            LocConstants.BackupDatabase.blobContainerIsRequired,
        );
        validation = blobContainerComponent.validate(urlMockState, "some-id");
        expect(validation.isValid).to.be.true;
        validation = blobContainerComponent.validate(nonUrlMockState, "");
        expect(validation.isValid).to.be.true;

        // blob
        const blobComponent = formComponents["blob"];
        expect(blobComponent.type).to.equal(FormItemType.SearchableDropdown);
        expect(blobComponent.required).to.be.true;
        expect(blobComponent.groupName).to.equal(DisasterRecoveryType.Url);
        expect(blobComponent.placeholder).to.equal(LocConstants.RestoreDatabase.selectABlob);
        validation = blobComponent.validate(urlMockState, "");
        expect(validation.isValid).to.be.false;
        expect(validation.validationMessage).to.equal(LocConstants.RestoreDatabase.blobIsRequired);
        validation = blobComponent.validate(urlMockState, "some-blob");
        expect(validation.isValid).to.be.true;
        validation = blobComponent.validate(nonUrlMockState, "");
        expect(validation.isValid).to.be.true;

        // Checkbox advanced options
        const relocateDbFilesComponent = formComponents["relocateDbFiles"];
        expect(relocateDbFilesComponent.type).to.equal(FormItemType.Checkbox);
        expect(relocateDbFilesComponent.isAdvancedOption).to.be.true;
        expect(relocateDbFilesComponent.groupName).to.equal(LocConstants.RestoreDatabase.files);

        const replaceDatabaseComponent = formComponents["replaceDatabase"];
        expect(replaceDatabaseComponent.type).to.equal(FormItemType.Checkbox);
        expect(replaceDatabaseComponent.isAdvancedOption).to.be.true;
        expect(replaceDatabaseComponent.groupName).to.equal(LocConstants.RestoreDatabase.general);
        expect(replaceDatabaseComponent.tooltip).to.equal(
            LocConstants.RestoreDatabase.overwriteExistingDbTooltip,
        );

        const keepReplicationComponent = formComponents["keepReplication"];
        expect(keepReplicationComponent.type).to.equal(FormItemType.Checkbox);
        expect(keepReplicationComponent.isAdvancedOption).to.be.true;
        expect(keepReplicationComponent.groupName).to.equal(LocConstants.RestoreDatabase.general);
        expect(keepReplicationComponent.tooltip).to.equal(
            LocConstants.RestoreDatabase.preserveReplicationSettingsTooltip,
        );

        const setRestrictedUserComponent = formComponents["setRestrictedUser"];
        expect(setRestrictedUserComponent.type).to.equal(FormItemType.Checkbox);
        expect(setRestrictedUserComponent.isAdvancedOption).to.be.true;
        expect(setRestrictedUserComponent.groupName).to.equal(LocConstants.RestoreDatabase.general);
        expect(setRestrictedUserComponent.tooltip).to.equal(
            LocConstants.RestoreDatabase.restrictAccessToRestoredDbTooltip,
        );

        // recoveryState
        const recoveryStateComponent = formComponents["recoveryState"];
        expect(recoveryStateComponent.type).to.equal(FormItemType.Dropdown);
        expect(recoveryStateComponent.isAdvancedOption).to.be.true;
        expect(recoveryStateComponent.groupName).to.equal(LocConstants.RestoreDatabase.general);
        expect(recoveryStateComponent.options).to.deep.equal(
            controller["getRecoveryStateOptions"](),
        );

        // Tail log backup group
        const backupTailLogComponent = formComponents["backupTailLog"];
        expect(backupTailLogComponent.type).to.equal(FormItemType.Checkbox);
        expect(backupTailLogComponent.isAdvancedOption).to.be.true;
        expect(backupTailLogComponent.groupName).to.equal(
            LocConstants.RestoreDatabase.tailLogBackup,
        );

        const tailLogWithNoRecoveryComponent = formComponents["tailLogWithNoRecovery"];
        expect(tailLogWithNoRecoveryComponent.type).to.equal(FormItemType.Checkbox);
        expect(tailLogWithNoRecoveryComponent.isAdvancedOption).to.be.true;
        expect(tailLogWithNoRecoveryComponent.groupName).to.equal(
            LocConstants.RestoreDatabase.tailLogBackup,
        );
        expect(tailLogWithNoRecoveryComponent.tooltip).to.equal(
            LocConstants.RestoreDatabase.leaveSourceDatabaseTooltip,
        );

        const closeExistingConnectionsComponent = formComponents["closeExistingConnections"];
        expect(closeExistingConnectionsComponent.type).to.equal(FormItemType.Checkbox);
        expect(closeExistingConnectionsComponent.isAdvancedOption).to.be.true;
        expect(closeExistingConnectionsComponent.groupName).to.equal(
            LocConstants.RestoreDatabase.serverConnections,
        );

        // File input fields
        const dataFileFolderComponent = formComponents["dataFileFolder"];
        expect(dataFileFolderComponent.type).to.equal(FormItemType.Input);
        expect(dataFileFolderComponent.isAdvancedOption).to.be.true;
        expect(dataFileFolderComponent.groupName).to.equal(LocConstants.RestoreDatabase.files);

        const logFileFolderComponent = formComponents["logFileFolder"];
        expect(logFileFolderComponent.type).to.equal(FormItemType.Input);
        expect(logFileFolderComponent.isAdvancedOption).to.be.true;
        expect(logFileFolderComponent.groupName).to.equal(LocConstants.RestoreDatabase.files);

        const standbyFileComponent = formComponents["standbyFile"];
        expect(standbyFileComponent.type).to.equal(FormItemType.Input);
        expect(standbyFileComponent.isAdvancedOption).to.be.true;
        expect(standbyFileComponent.groupName).to.equal(LocConstants.RestoreDatabase.general);

        const tailLogBackupFileComponent = formComponents["tailLogBackupFile"];
        expect(tailLogBackupFileComponent.type).to.equal(FormItemType.Input);
        expect(tailLogBackupFileComponent.isAdvancedOption).to.be.true;
        expect(tailLogBackupFileComponent.groupName).to.equal(
            LocConstants.RestoreDatabase.tailLogBackup,
        );
    });

    test("getRecoveryStateOptions should return correct options", () => {
        const options = controller["getRecoveryStateOptions"]();

        expect(options).to.have.length(3);
        expect(options[0]).to.deep.equal({
            value: RecoveryState.WithRecovery,
            displayName: LocConstants.RestoreDatabase.restoreWithRecovery,
        });
        expect(options[1]).to.deep.equal({
            value: RecoveryState.NoRecovery,
            displayName: LocConstants.RestoreDatabase.restoreWithNoRecovery,
        });
        expect(options[2]).to.deep.equal({
            value: RecoveryState.Standby,
            displayName: LocConstants.RestoreDatabase.restoreWithStandby,
        });
    });

    test("formActionReducer", async () => {
        const mockStateWithErrorMessage = {
            ...mockInitialState,
            viewModel: {
                ...mockInitialState.viewModel,
                model: {
                    ...mockInitialState.viewModel.model,
                    errorMessage: "some error",
                    restorePlanStatus: ApiStatus.Error,
                } as RestoreDatabaseViewModel,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;
        const updateViewModelStub = sandbox.spy(controller as any, "updateViewModel");
        const formActionStub = sandbox.spy(utils, "disasterRecoveryFormAction");
        const getRestorePlanStub = sandbox.stub(controller as any, "getRestorePlan").resolves({});

        let resultState = await controller["_reducerHandlers"].get("formAction")(
            mockStateWithErrorMessage,
            {
                event: {
                    propertyName: "relocateDbFiles",
                    value: true,
                },
            },
        );
        expect(formActionStub).to.have.been.calledOnce;
        expect(updateViewModelStub).to.have.been.calledOnce;
        expect(getRestorePlanStub).to.not.have.been.called;
        expect(resultState.formState.relocateDbFiles).to.equal(true);
        expect(
            (resultState.viewModel.model as RestoreDatabaseViewModel).restorePlanStatus,
        ).to.equal(ApiStatus.Error);
        expect((resultState.viewModel.model as RestoreDatabaseViewModel).errorMessage).to.be
            .undefined;

        // Reset stubs
        formActionStub.resetHistory();
        updateViewModelStub.resetHistory();

        resultState = await controller["_reducerHandlers"].get("formAction")(
            mockStateWithErrorMessage,
            {
                event: {
                    propertyName: "sourceDatabaseName",
                    value: "db",
                },
            },
        );
        expect(formActionStub).to.have.been.calledOnce;
        expect(updateViewModelStub).to.have.been.calledTwice;
        expect(getRestorePlanStub).to.have.been.calledOnce;
        expect(resultState.formState.sourceDatabaseName).to.equal("db");
        expect((resultState.viewModel.model as RestoreDatabaseViewModel).errorMessage).to.be
            .undefined;
        expect(
            (resultState.viewModel.model as RestoreDatabaseViewModel).restorePlanStatus,
        ).to.equal(ApiStatus.NotStarted);
    });

    test("loadAzureComponent reducer", async () => {
        const loadAzureComponentHelperStub = sandbox
            .stub(utils, "loadAzureComponentHelper")
            .resolves(
                mockInitialState as ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
            );
        const loadBlobComponentStub = sandbox
            .stub(controller as any, "loadBlobComponent")
            .resolves(mockInitialState);
        const getRestorePlanStub = sandbox
            .stub(controller as any, "getRestorePlan")
            .resolves(mockInitialState);

        // Path 1: payload.componentName === "blob" and blob status is NotStarted
        let stateWithBlobNotStarted = {
            ...mockInitialState,
            viewModel: {
                ...mockInitialState.viewModel,
                model: {
                    ...mockInitialState.viewModel.model,
                    restorePlanStatus: ApiStatus.Loaded,
                    azureComponentStatuses: {
                        ...(mockInitialState.viewModel.model as RestoreDatabaseViewModel)
                            .azureComponentStatuses,
                        blob: ApiStatus.NotStarted,
                    },
                } as RestoreDatabaseViewModel,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        let result = await controller["_reducerHandlers"].get("loadAzureComponent")(
            stateWithBlobNotStarted,
            { componentName: "blob" },
        );
        expect(loadBlobComponentStub).to.have.been.calledOnce;
        expect(getRestorePlanStub).to.have.been.calledOnce;
        expect(loadAzureComponentHelperStub).to.not.have.been.called;
        const resultModel = result.viewModel.model as RestoreDatabaseViewModel;
        expect(resultModel.azureComponentStatuses["blob"]).to.equal(ApiStatus.Loaded);

        // Reset stubs
        loadBlobComponentStub.resetHistory();
        getRestorePlanStub.resetHistory();
        loadAzureComponentHelperStub.resetHistory();

        // Path 2: payload.componentName !== "blob" → falls through to loadAzureComponentHelper
        await controller["_reducerHandlers"].get("loadAzureComponent")(mockInitialState, {
            componentName: "subscriptionId",
        });
        expect(loadBlobComponentStub).to.not.have.been.called;
        expect(getRestorePlanStub).to.not.have.been.called;
        expect(loadAzureComponentHelperStub).to.have.been.calledOnce;

        // Path 3: restorePlanStatus is Loading — should set to NotStarted
        let stateWithLoading = {
            ...mockInitialState,
            viewModel: {
                ...mockInitialState.viewModel,
                model: {
                    ...mockInitialState.viewModel.model,
                    restorePlanStatus: ApiStatus.Loading,
                    azureComponentStatuses: {
                        ...(mockInitialState.viewModel.model as RestoreDatabaseViewModel)
                            .azureComponentStatuses,
                        blob: ApiStatus.NotStarted,
                    },
                } as RestoreDatabaseViewModel,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        await controller["_reducerHandlers"].get("loadAzureComponent")(stateWithLoading, {
            componentName: "accountId",
        });
        // When loading, restorePlanStatus should NOT be overwritten to NotStarted
        expect(
            (stateWithLoading.viewModel.model as RestoreDatabaseViewModel).restorePlanStatus,
        ).to.equal(ApiStatus.Loading);
    });

    test("setType reducer", async () => {
        const setTypeStub = sandbox
            .stub(utils, "setType")
            .resolves(
                mockInitialState as ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
            );
        const getRestorePlanStub = sandbox
            .stub(controller as any, "getRestorePlan")
            .resolves(mockInitialState);
        const updateViewModelStub = sandbox.spy(controller as any, "updateViewModel");

        // Path 1: type is Database → triggers getRestorePlan
        await controller["_reducerHandlers"].get("setType")(mockInitialState, {
            type: DisasterRecoveryType.Database,
        });
        expect(setTypeStub).to.have.been.calledOnce;
        expect(getRestorePlanStub).to.have.been.calledOnce;
        const resultModel = (await updateViewModelStub.returnValues[0]).viewModel
            .model as RestoreDatabaseViewModel;
        expect(resultModel.errorMessage).to.be.undefined;

        setTypeStub.resetHistory();
        getRestorePlanStub.resetHistory();
        updateViewModelStub.resetHistory();

        // Path 2: type is not Database → does NOT trigger getRestorePlan
        await controller["_reducerHandlers"].get("setType")(mockInitialState, {
            type: DisasterRecoveryType.BackupFile,
        });
        expect(setTypeStub).to.have.been.calledOnce;
        expect(getRestorePlanStub).to.not.have.been.called;

        // Path 3: restorePlanStatus is Loading → should NOT reset to NotStarted
        setTypeStub.resolves({
            ...mockInitialState,
            viewModel: {
                ...mockInitialState.viewModel,
                model: {
                    ...mockInitialState.viewModel.model,
                    restorePlanStatus: ApiStatus.Loading,
                } as RestoreDatabaseViewModel,
            },
        } as ObjectManagementWebviewState<DisasterRecoveryAzureFormState>);
        const result = await controller["_reducerHandlers"].get("setType")(mockInitialState, {
            type: DisasterRecoveryType.Url,
        });
        expect((result.viewModel.model as RestoreDatabaseViewModel).restorePlanStatus).to.equal(
            ApiStatus.Loading,
        );
    });

    test("removeBackupFile reducer", async () => {
        const stateWithFiles = {
            ...mockInitialState,
            viewModel: {
                ...mockInitialState.viewModel,
                model: {
                    ...mockInitialState.viewModel.model,
                    errorMessage: "some error",
                    backupFiles: [
                        { filePath: "C:\\Backups\\file1.bak", isExisting: true },
                        { filePath: "C:\\Backups\\file2.bak", isExisting: true },
                    ],
                } as RestoreDatabaseViewModel,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        // Path 1: remove existing file
        let result = await controller["_reducerHandlers"].get("removeBackupFile")(stateWithFiles, {
            filePath: "C:\\Backups\\file1.bak",
        });
        const resultModel = result.viewModel.model as RestoreDatabaseViewModel;
        expect(resultModel.backupFiles).to.have.length(1);
        expect(resultModel.backupFiles[0].filePath).to.equal("C:\\Backups\\file2.bak");
        expect(resultModel.errorMessage).to.be.undefined; // error message cleared

        // Path 2: remove non-existent file — list unchanged
        const numberOfFilesBefore = (stateWithFiles.viewModel.model as RestoreDatabaseViewModel)
            .backupFiles.length;
        result = await controller["_reducerHandlers"].get("removeBackupFile")(stateWithFiles, {
            filePath: "C:\\Backups\\nonexistent.bak",
        });
        expect((result.viewModel.model as RestoreDatabaseViewModel).backupFiles).to.have.length(
            numberOfFilesBefore,
        );
    });

    test("updateSelectedBackupSets reducer", async () => {
        const mockRestorePlan = {
            backupSetsToRestore: [
                { id: "set-1", properties: [], isSelected: false },
                { id: "set-2", properties: [], isSelected: false },
                { id: "set-3", properties: [], isSelected: false },
            ],
            sessionId: "session-123",
            canRestore: true,
            errorMessage: undefined,
            dbFiles: [],
            databaseNamesFromBackupSets: ["db1", "db2"],
            planDetails: undefined,
        } as RestorePlanResponse;

        const stateWithPlan = {
            ...mockInitialState,
            viewModel: {
                ...mockInitialState.viewModel,
                model: {
                    ...mockInitialState.viewModel.model,
                    errorMessage: "some error",
                    restorePlan: mockRestorePlan,
                    selectedBackupSets: [],
                } as RestoreDatabaseViewModel,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        // Path 1: select indices 0 and 2
        let result = await controller["_reducerHandlers"].get("updateSelectedBackupSets")(
            stateWithPlan,
            { selectedBackupSets: [0, 2] },
        );
        let resultModel = result.viewModel.model as RestoreDatabaseViewModel;
        expect(resultModel.selectedBackupSets).to.deep.equal(["set-1", "set-3"]);
        expect(resultModel.errorMessage).to.be.undefined; // error message cleared

        // Path 2: empty selection
        result = await controller["_reducerHandlers"].get("updateSelectedBackupSets")(
            stateWithPlan,
            { selectedBackupSets: [] },
        );
        resultModel = result.viewModel.model as RestoreDatabaseViewModel;
        expect(resultModel.selectedBackupSets).to.deep.equal([]);

        // Path 3: no restorePlan (undefined) → should return empty array
        const stateNoPlan = {
            ...mockInitialState,
            viewModel: {
                ...mockInitialState.viewModel,
                model: {
                    ...mockInitialState.viewModel.model,
                    restorePlan: {
                        ...mockRestorePlan,
                        backupSetsToRestore: undefined,
                    },
                    selectedBackupSets: [],
                } as RestoreDatabaseViewModel,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        result = await controller["_reducerHandlers"].get("updateSelectedBackupSets")(stateNoPlan, {
            selectedBackupSets: [0],
        });
        expect(
            (result.viewModel.model as RestoreDatabaseViewModel).selectedBackupSets,
        ).to.deep.equal([]);
    });

    test("submitFilePath reducer", async () => {
        const getRestorePlanStub = sandbox
            .stub(controller as any, "getRestorePlan")
            .resolves(mockInitialState);

        const stateWithFiles = {
            ...mockInitialState,
            viewModel: {
                ...mockInitialState.viewModel,
                model: {
                    ...mockInitialState.viewModel.model,
                    errorMessage: "some error",
                    backupFiles: [{ filePath: "C:\\Backups\\existing.bak", isExisting: true }],
                } as RestoreDatabaseViewModel,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        // Path 1: no propertyName, new path not already in list → adds file and calls getRestorePlan
        let result = await controller["_reducerHandlers"].get("submitFilePath")(stateWithFiles, {
            selectedPath: "C:\\Backups\\new.bak",
            propertyName: undefined,
        });
        let resultModel = result.viewModel.model as RestoreDatabaseViewModel;
        expect(resultModel.backupFiles).to.have.length(2);
        expect(resultModel.backupFiles[1].filePath).to.equal("C:\\Backups\\new.bak");
        expect(resultModel.backupFiles[1].isExisting).to.be.true;
        expect(getRestorePlanStub).to.have.been.calledOnce;
        expect(resultModel.errorMessage).to.be.undefined;

        getRestorePlanStub.resetHistory();

        // Path 2: no propertyName, path already exists → does NOT add duplicate, no extra getRestorePlan
        const previousLength = (stateWithFiles.viewModel.model as RestoreDatabaseViewModel)
            .backupFiles.length;
        result = await controller["_reducerHandlers"].get("submitFilePath")(stateWithFiles, {
            selectedPath: "C:\\Backups\\existing.bak",
            propertyName: undefined,
        });
        resultModel = result.viewModel.model as RestoreDatabaseViewModel;
        expect(resultModel.backupFiles).to.have.length(previousLength);
        expect(getRestorePlanStub).to.not.have.been.called;

        // Path 3: propertyName maps to formState key
        expect(mockInitialState.formState.dataFileFolder).to.equal(
            mockConfigInfo.configInfo.dataFileFolder,
        );
        result = await controller["_reducerHandlers"].get("submitFilePath")(mockInitialState, {
            selectedPath: "C:\\NewData",
            propertyName: "dataFileFolder",
        });
        expect(result.formState.dataFileFolder).to.equal("C:\\NewData");

        // Path 4: propertyName maps to viewModel key
        result = await controller["_reducerHandlers"].get("submitFilePath")(stateWithFiles, {
            selectedPath: "C:\\Backups\\someFile.bak",
            propertyName: "someViewModelProp",
        });
        // No crash — property set on restoreViewModel if it exists there
    });

    test("restoreDatabase reducer should call restoreHelper and send telemetry", async () => {
        const { sendActionEvent } = stubTelemetry(sandbox);
        const restoreHelperStub = sandbox
            .stub(controller as any, "restoreHelper")
            .resolves({ result: true, errorMessage: undefined });

        const result = await controller["_reducerHandlers"].get("restoreDatabase")(
            mockInitialState,
            {},
        );

        expect(restoreHelperStub).to.have.been.calledOnceWith(TaskExecutionMode.executeAndScript);
        expect(sendActionEvent).to.have.been.calledWith(
            TelemetryViews.Restore,
            TelemetryActions.Restore,
            { restoreType: (mockInitialState.viewModel.model as RestoreDatabaseViewModel).type },
        );
        expect(result).to.deep.equal(mockInitialState); // state returned unchanged
    });

    test("openRestoreScript reducer", async () => {
        const { sendActionEvent } = stubTelemetry(sandbox);
        const restoreHelperStub = sandbox
            .stub(controller as any, "restoreHelper")
            .resolves({ result: true, errorMessage: undefined });

        // Path 1: restorePlanStatus !== Loaded → sets errorMessage, no restoreHelper
        const stateNotLoaded = {
            ...mockInitialState,
            viewModel: {
                ...mockInitialState.viewModel,
                model: {
                    ...mockInitialState.viewModel.model,
                    restorePlanStatus: ApiStatus.NotStarted,
                    selectedBackupSets: [],
                } as RestoreDatabaseViewModel,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        let result = await controller["_reducerHandlers"].get("openRestoreScript")(
            stateNotLoaded,
            {},
        );
        expect(restoreHelperStub).to.not.have.been.called;
        expect((result.viewModel.model as RestoreDatabaseViewModel).errorMessage).to.equal(
            LocConstants.RestoreDatabase.cannotGenerateScriptWithNoRestorePlan,
        );

        // Path 2: restorePlanStatus === Loaded but no selectedBackupSets → sets different error
        const stateLoadedNoSets = {
            ...mockInitialState,
            viewModel: {
                ...mockInitialState.viewModel,
                model: {
                    ...mockInitialState.viewModel.model,
                    restorePlanStatus: ApiStatus.Loaded,
                    selectedBackupSets: [],
                } as RestoreDatabaseViewModel,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        result = await controller["_reducerHandlers"].get("openRestoreScript")(
            stateLoadedNoSets,
            {},
        );
        expect(restoreHelperStub).to.not.have.been.called;
        expect((result.viewModel.model as RestoreDatabaseViewModel).errorMessage).to.equal(
            LocConstants.RestoreDatabase.pleaseChooseAtLeastOneBackupSetToRestore,
        );

        // Path 3: Loaded + selectedBackupSets present → calls restoreHelper and sends telemetry
        const stateReady = {
            ...mockInitialState,
            viewModel: {
                ...mockInitialState.viewModel,
                model: {
                    ...mockInitialState.viewModel.model,
                    restorePlanStatus: ApiStatus.Loaded,
                    selectedBackupSets: ["set-1"],
                } as RestoreDatabaseViewModel,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        result = await controller["_reducerHandlers"].get("openRestoreScript")(stateReady, {});
        expect(restoreHelperStub).to.have.been.calledOnceWith(TaskExecutionMode.script);
        expect(sendActionEvent).to.have.been.calledWith(
            TelemetryViews.Restore,
            TelemetryActions.ScriptRestore,
            { restoreType: (stateReady.viewModel.model as RestoreDatabaseViewModel).type },
        );
    });

    test("loadBlobComponent", async () => {
        const mockSubscription = {
            subscriptionId: "sub-1",
            name: "My Subscription",
        } as AzureSubscription;
        const mockStorageAccount = { id: "sa-1", name: "myStorageAccount" } as StorageAccount;
        const mockBlobContainer = { id: "bc-1", name: "myContainer" } as BlobContainer;
        const mockBlobs = [{ name: "backup1.bak" }, { name: "backup2.bak" }] as BlobItem[];

        const stateWithAzureSelections = {
            ...mockInitialState,
            formState: {
                ...mockInitialState.formState,
                subscriptionId: "sub-1",
                storageAccountId: "sa-1",
                blobContainerId: "bc-1",
            },
            formComponents: {
                ...mockInitialState.formComponents,
                blob: {
                    type: FormItemType.SearchableDropdown,
                    options: [],
                    placeholder: "",
                },
            },
            viewModel: {
                ...mockInitialState.viewModel,
                model: {
                    ...mockInitialState.viewModel.model,
                    subscriptions: [mockSubscription],
                    storageAccounts: [mockStorageAccount],
                    blobContainers: [mockBlobContainer],
                    blobs: [],
                    azureComponentStatuses: {
                        ...(mockInitialState.viewModel.model as RestoreDatabaseViewModel)
                            .azureComponentStatuses,
                        blob: ApiStatus.NotStarted,
                    },
                } as RestoreDatabaseViewModel,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        const fetchBlobsStub = sandbox
            .stub(VsCodeAzureHelper, "fetchBlobsForContainer")
            .resolves(mockBlobs as any);

        // Path 1: missing subscriptionId → error state, no fetch
        const stateMissingSubscription = {
            ...stateWithAzureSelections,
            formState: { ...stateWithAzureSelections.formState, subscriptionId: "" },
        };
        let result = await controller["loadBlobComponent"](stateMissingSubscription);
        let resultModel = result.viewModel.model as RestoreDatabaseViewModel;
        expect(fetchBlobsStub).to.not.have.been.called;
        expect(resultModel.azureComponentStatuses["blob"]).to.equal(ApiStatus.Error);
        expect(result.formComponents["blob"].placeholder).to.equal(
            LocConstants.RestoreDatabase.noBlobsFound,
        );

        // Path 2: missing storageAccountId → error state, no fetch
        const stateMissingStorage = {
            ...stateWithAzureSelections,
            formState: { ...stateWithAzureSelections.formState, storageAccountId: "" },
        };
        result = await controller["loadBlobComponent"](stateMissingStorage);
        resultModel = result.viewModel.model as RestoreDatabaseViewModel;
        expect(fetchBlobsStub).to.not.have.been.called;
        expect(resultModel.azureComponentStatuses["blob"]).to.equal(ApiStatus.Error);
        expect(result.formComponents["blob"].placeholder).to.equal(
            LocConstants.RestoreDatabase.noBlobsFound,
        );

        // Path 3: missing blobContainerId → error state, no fetch
        const stateMissingContainer = {
            ...stateWithAzureSelections,
            formState: { ...stateWithAzureSelections.formState, blobContainerId: "" },
        };
        result = await controller["loadBlobComponent"](stateMissingContainer);
        resultModel = result.viewModel.model as RestoreDatabaseViewModel;
        expect(fetchBlobsStub).to.not.have.been.called;
        expect(resultModel.azureComponentStatuses["blob"]).to.equal(ApiStatus.Error);
        expect(result.formComponents["blob"].placeholder).to.equal(
            LocConstants.RestoreDatabase.noBlobsFound,
        );

        // Path 4: all fields present, blobs returned → sets options, selects first blob
        result = await controller["loadBlobComponent"](stateWithAzureSelections);
        resultModel = result.viewModel.model as RestoreDatabaseViewModel;
        expect(fetchBlobsStub).to.have.been.calledOnceWith(
            mockSubscription,
            mockStorageAccount,
            mockBlobContainer,
        );
        expect(result.formComponents["blob"].options).to.deep.equal([
            { value: "backup1.bak", displayName: "backup1.bak" },
            { value: "backup2.bak", displayName: "backup2.bak" },
        ]);
        expect(result.formState.blob).to.equal("backup1.bak");
        expect(result.formComponents["blob"].placeholder).to.equal(
            LocConstants.RestoreDatabase.selectABlob,
        );
        expect(resultModel.blobs).to.deep.equal(mockBlobs);

        fetchBlobsStub.resetHistory();

        // Path 5: all fields present, no blobs returned → empty options, noBlobsFound placeholder
        fetchBlobsStub.resolves([]);
        result = await controller["loadBlobComponent"](stateWithAzureSelections);
        expect(result.formComponents["blob"].options).to.deep.equal([]);
        expect(result.formState.blob).to.equal("");
        expect(result.formComponents["blob"].placeholder).to.equal(
            LocConstants.RestoreDatabase.noBlobsFound,
        );
        expect((result.viewModel.model as RestoreDatabaseViewModel).blobs).to.deep.equal([]);

        fetchBlobsStub.resetHistory();

        // Path 6: fetchBlobsForContainer throws → sets errorMessage on state
        fetchBlobsStub.rejects(new Error("Network error"));
        result = await controller["loadBlobComponent"](stateWithAzureSelections);
        expect(result.errorMessage).to.equal("Network error");
    });

    test("updatePlanFromState should sync formState and viewModel values into restorePlan planDetails", () => {
        const mockRestoreViewModel: RestoreDatabaseViewModel = {
            ...mockInitialState.viewModel.model,
            restorePlan: {
                planDetails: {
                    sourceDatabaseName: { currentValue: "", defaultValue: "oldDb" },
                    targetDatabaseName: { currentValue: "", defaultValue: "oldTarget" },
                    backupFiles: { currentValue: [], defaultValue: [] },
                } as any,
            },
        } as RestoreDatabaseViewModel;

        const stateWithValues = {
            ...mockInitialState,
            formState: {
                ...mockInitialState.formState,
                sourceDatabaseName: "myDatabase",
                targetDatabaseName: "myTarget",
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        // Path 1: explicit state provided — formState keys present in planDetails get written
        const result = controller["updatePlanFromState"](mockRestoreViewModel, stateWithValues);
        expect(result.restorePlan.planDetails["sourceDatabaseName"].currentValue).to.equal(
            "myDatabase",
        );
        expect(result.restorePlan.planDetails["targetDatabaseName"].currentValue).to.equal(
            "myTarget",
        );

        // Path 2: viewModel key present in planDetails gets written from restoreViewModel
        const viewModelWithBackupFiles: RestoreDatabaseViewModel = {
            ...mockRestoreViewModel,
            backupFiles: [{ filePath: "C:\\Backups\\file.bak", isExisting: true }],
            restorePlan: {
                planDetails: {
                    backupFiles: { currentValue: [], defaultValue: [] },
                    sourceDatabaseName: { currentValue: "", defaultValue: "oldDb" },
                } as any,
            },
        } as RestoreDatabaseViewModel;
        mockInitialState.formState.sourceDatabaseName = "original";
        const result2 = controller["updatePlanFromState"](
            viewModelWithBackupFiles,
            mockInitialState,
        );
        expect(result2.restorePlan.planDetails["backupFiles"].currentValue).to.deep.equal(
            viewModelWithBackupFiles.backupFiles,
        );
        expect(result2.restorePlan.planDetails["sourceDatabaseName"].currentValue).to.equal(
            "original",
        );

        // Path 3: key in formState but NOT in planDetails → planDetails unchanged
        const stateWithExtraKey = {
            ...mockInitialState,
            formState: {
                ...mockInitialState.formState,
                accountId: "some-account", // not in planDetails
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        const result3 = controller["updatePlanFromState"](
            viewModelWithBackupFiles,
            stateWithExtraKey,
        );
        expect(result3.restorePlan.planDetails["accountId"]).to.be.undefined;

        // Path 4: no explicit state provided — falls back to this.state
        controller.state.formState.sourceDatabaseName = "fromThisState";
        const viewModelForThisState: RestoreDatabaseViewModel = {
            ...mockRestoreViewModel,
            restorePlan: {
                planDetails: {
                    sourceDatabaseName: { currentValue: "", defaultValue: "" },
                } as any,
            },
        } as RestoreDatabaseViewModel;

        const result4 = controller["updatePlanFromState"](viewModelForThisState);
        expect(result4.restorePlan.planDetails["sourceDatabaseName"].currentValue).to.equal(
            "fromThisState",
        );
    });

    test("setDefaultFormValuesFromPlan should populate empty form values from plan defaults", () => {
        // Path 1: formState key present, currently empty → filled from defaultValue
        const stateWithEmptyFormValues = {
            ...mockInitialState,
            formState: {
                ...mockInitialState.formState,
                sourceDatabaseName: "", // empty — should be filled
                targetDatabaseName: "existingTarget", // non-empty — should NOT be overwritten
            },
            viewModel: {
                ...mockInitialState.viewModel,
                model: {
                    ...mockInitialState.viewModel.model,
                    restorePlan: {
                        planDetails: {
                            sourceDatabaseName: { currentValue: "", defaultValue: "defaultDb" },
                            targetDatabaseName: { currentValue: "", defaultValue: "defaultTarget" },
                        } as any,
                    },
                } as RestoreDatabaseViewModel,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        const result = controller["setDefaultFormValuesFromPlan"](stateWithEmptyFormValues);
        expect(stateWithEmptyFormValues.formState.sourceDatabaseName).to.equal("defaultDb");
        expect(stateWithEmptyFormValues.formState.targetDatabaseName).to.equal("existingTarget");
        expect(result).to.be.instanceOf(Object); // returns restoreViewModel

        // Path 2: key is in restoreViewModel (not formState), currently empty → filled from defaultValue
        const stateWithEmptyViewModelProp = {
            ...mockInitialState,
            formState: {
                ...mockInitialState.formState,
            },
            viewModel: {
                ...mockInitialState.viewModel,
                model: {
                    ...mockInitialState.viewModel.model,
                    url: "", // empty viewModel prop
                    restorePlan: {
                        planDetails: {
                            url: {
                                currentValue: "",
                                defaultValue: "https://defaultstorage.blob.core.windows.net",
                            },
                        } as any,
                    },
                } as RestoreDatabaseViewModel,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        const result2 = controller["setDefaultFormValuesFromPlan"](stateWithEmptyViewModelProp);
        expect(result2.url).to.equal("https://defaultstorage.blob.core.windows.net");

        // Path 3: key is in restoreViewModel, already has a value → NOT overwritten
        const stateWithExistingViewModelProp = {
            ...mockInitialState,
            viewModel: {
                ...mockInitialState.viewModel,
                model: {
                    ...mockInitialState.viewModel.model,
                    url: "https://existing.blob.core.windows.net",
                    restorePlan: {
                        planDetails: {
                            url: {
                                currentValue: "",
                                defaultValue: "https://shouldnotreplace.blob.core.windows.net",
                            },
                        } as any,
                    },
                } as RestoreDatabaseViewModel,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        const result3 = controller["setDefaultFormValuesFromPlan"](stateWithExistingViewModelProp);
        expect(result3.url).to.equal("https://existing.blob.core.windows.net");

        // Path 4: no explicit state — falls back to this.state
        controller.state.formState.sourceDatabaseName = "";
        (controller.state.viewModel.model as RestoreDatabaseViewModel).restorePlan = {
            planDetails: {
                sourceDatabaseName: { currentValue: "", defaultValue: "fromThisState" },
            },
        } as any;

        controller["setDefaultFormValuesFromPlan"]();
        expect(controller.state.formState.sourceDatabaseName).to.equal("fromThisState");

        // Path 5: restorePlan is undefined — no crash, returns restoreViewModel as-is
        const stateNoPlan = {
            ...mockInitialState,
            viewModel: {
                ...mockInitialState.viewModel,
                model: {
                    ...mockInitialState.viewModel.model,
                    restorePlan: undefined,
                } as RestoreDatabaseViewModel,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        const result5 = controller["setDefaultFormValuesFromPlan"](stateNoPlan);
        expect(result5).to.be.instanceOf(Object);
        expect(result5.restorePlan).to.be.undefined;
    });

    test("restoreHelper", async () => {
        const { sendErrorEvent } = stubTelemetry(sandbox);
        const getRestoreParamsStub = sandbox
            .stub(controller as any, "getRestoreParams")
            .resolves({ ownerUri: "ownerUri" });
        const restoreDatabaseStub = mockObjectManagementService.restoreDatabase as sinon.SinonStub;

        // Path 1: happy path → calls getRestoreParams and restoreDatabase, returns result
        restoreDatabaseStub.resolves({ result: true, errorMessage: undefined });
        let result = await controller["restoreHelper"](TaskExecutionMode.executeAndScript);
        expect(getRestoreParamsStub).to.have.been.calledOnceWith(
            TaskExecutionMode.executeAndScript,
            false,
            false,
        );
        expect(restoreDatabaseStub).to.have.been.calledOnce;
        expect(result.result).to.be.true;
        expect(result.errorMessage).to.be.undefined;

        getRestoreParamsStub.resetHistory();
        restoreDatabaseStub.resetHistory();

        // Path 2: script mode → passes correct taskMode through
        restoreDatabaseStub.resolves({ result: true, errorMessage: undefined });
        await controller["restoreHelper"](TaskExecutionMode.script);
        expect(getRestoreParamsStub).to.have.been.calledOnceWith(
            TaskExecutionMode.script,
            false,
            false,
        );

        getRestoreParamsStub.resetHistory();
        restoreDatabaseStub.resetHistory();

        // Path 3: restoreDatabase throws → sets errorMessage on state, sends error telemetry, returns undefined
        const restoreError = new Error("Restore failed");
        restoreDatabaseStub.rejects(restoreError);
        result = await controller["restoreHelper"](TaskExecutionMode.executeAndScript);
        expect(result).to.be.undefined;
        expect(controller.state.errorMessage).to.equal("Restore failed");
        expect(sendErrorEvent).to.have.been.calledWith(
            TelemetryViews.Restore,
            TelemetryActions.Restore,
            restoreError,
            false,
            undefined,
            undefined,
            { isScript: "false" },
        );

        getRestoreParamsStub.resetHistory();
        restoreDatabaseStub.resetHistory();
        (controller.state as any).errorMessage = undefined;

        // Path 4: getRestoreParams throws → same error handling path
        getRestoreParamsStub.rejects(new Error("Params error"));
        result = await controller["restoreHelper"](TaskExecutionMode.script);
        expect(result).to.be.undefined;
        expect(controller.state.errorMessage).to.equal("Params error");
        expect(sendErrorEvent).to.have.been.calledWith(
            TelemetryViews.Restore,
            TelemetryActions.Restore,
            sinon.match.instanceOf(Error),
            false,
            undefined,
            undefined,
            { isScript: "true" }, // script mode
        );
    });

    test("getRestorePlan", async () => {
        const { sendActionEvent, sendErrorEvent } = stubTelemetry(sandbox);
        const cancelRestorePlanStub =
            mockObjectManagementService.cancelRestorePlan as sinon.SinonStub;
        const getRestorePlanStub = mockObjectManagementService.getRestorePlan as sinon.SinonStub;
        const getRestoreParamsStub = sandbox
            .stub(controller as any, "getRestoreParams")
            .resolves({ ownerUri: "ownerUri" });

        const mockPlan = {
            canRestore: true,
            sessionId: "session-1",
            planDetails: {
                sourceDatabaseName: { currentValue: "testDatabase", defaultValue: "" },
                targetDatabaseName: { currentValue: "restoredDb", defaultValue: "" },
                standbyFile: { currentValue: "C:\\standby.bak", defaultValue: "" },
                tailLogBackupFile: { currentValue: "C:\\taillog.bak", defaultValue: "" },
            },
            backupSetsToRestore: [
                { id: "set-1", isSelected: true },
                { id: "set-2", isSelected: false },
                { id: "set-3", isSelected: true },
            ],
        };

        getRestorePlanStub.resolves(mockPlan);

        const stateWithSourceOptions = {
            ...mockInitialState,
            formState: {
                ...mockInitialState.formState,
                sourceDatabaseName: "",
                targetDatabaseName: "",
                standbyFile: "",
                tailLogBackupFile: "",
            },
            formComponents: {
                ...mockInitialState.formComponents,
                sourceDatabaseName: {
                    options: [
                        { value: "testDatabase", displayName: "testDatabase" },
                        { value: "otherDatabase", displayName: "otherDatabase" },
                    ],
                },
            },
            viewModel: {
                ...mockInitialState.viewModel,
                model: {
                    ...mockInitialState.viewModel.model,
                    restorePlanStatus: ApiStatus.NotStarted,
                    cachedRestorePlanParams: undefined,
                } as RestoreDatabaseViewModel,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        // Path 1: happy path — plan loaded, fields populated, selected backup sets filtered
        let result = await controller["getRestorePlan"](false, stateWithSourceOptions);
        let resultModel = result.viewModel.model as RestoreDatabaseViewModel;

        expect(getRestoreParamsStub).to.have.been.calledOnceWith(
            TaskExecutionMode.execute,
            true,
            false,
        );
        expect(cancelRestorePlanStub).to.not.have.been.called;
        expect(resultModel.restorePlanStatus).to.equal(ApiStatus.Loaded);
        expect(resultModel.restorePlan).to.deep.equal(mockPlan);
        expect(resultModel.cachedRestorePlanParams).to.deep.equal({ ownerUri: "ownerUri" });
        expect(result.formState.sourceDatabaseName).to.equal("testDatabase");
        expect(result.formState.targetDatabaseName).to.equal("restoredDb");
        expect(result.formState.standbyFile).to.equal("C:\\standby.bak");
        expect(result.formState.tailLogBackupFile).to.equal("C:\\taillog.bak");
        expect(resultModel.selectedBackupSets).to.deep.equal(["set-1", "set-3"]);
        expect(result.errorMessage).to.be.undefined;
        expect(sendActionEvent).to.have.been.calledWith(
            TelemetryViews.Restore,
            TelemetryActions.GetRestorePlan,
        );

        getRestoreParamsStub.resetHistory();
        cancelRestorePlanStub.resetHistory();

        // Path 2: useDefaults = true → passed through to getRestoreParams
        await controller["getRestorePlan"](true, stateWithSourceOptions);
        expect(getRestoreParamsStub).to.have.been.calledOnceWith(
            TaskExecutionMode.execute,
            true,
            true,
        );

        getRestoreParamsStub.resetHistory();

        // Path 3: plan.canRestore = false → restorePlanStatus set to Error
        getRestorePlanStub.resolves({ ...mockPlan, canRestore: false });
        result = await controller["getRestorePlan"](false, stateWithSourceOptions);
        resultModel = result.viewModel.model as RestoreDatabaseViewModel;
        expect(resultModel.restorePlanStatus).to.equal(ApiStatus.Error);

        getRestorePlanStub.resolves(mockPlan);
        getRestoreParamsStub.resetHistory();

        // Path 4: sourceDatabaseName from plan NOT in options → formState not updated
        const stateWithoutMatchingOption = {
            ...stateWithSourceOptions,
            formState: {
                ...stateWithSourceOptions.formState,
                sourceDatabaseName: "existingSelection",
            },
            formComponents: {
                ...stateWithSourceOptions.formComponents,
                sourceDatabaseName: {
                    options: [{ value: "otherDatabase", displayName: "otherDatabase" }],
                },
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        result = await controller["getRestorePlan"](false, stateWithoutMatchingOption);
        expect(result.formState.sourceDatabaseName).to.equal("existingSelection");

        getRestoreParamsStub.resetHistory();

        // Path 5: currently loading with cached params → cancels existing plan first
        const cachedParams = { ownerUri: "ownerUri", taskExecutionMode: TaskExecutionMode.execute };
        const stateCurrentlyLoading = {
            ...stateWithSourceOptions,
            viewModel: {
                ...stateWithSourceOptions.viewModel,
                model: {
                    ...stateWithSourceOptions.viewModel.model,
                    restorePlanStatus: ApiStatus.Loading,
                    cachedRestorePlanParams: cachedParams,
                } as RestoreDatabaseViewModel,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        cancelRestorePlanStub.resolves();
        await controller["getRestorePlan"](false, stateCurrentlyLoading);
        expect(cancelRestorePlanStub).to.have.been.calledOnceWith(cachedParams);

        getRestoreParamsStub.resetHistory();
        cancelRestorePlanStub.resetHistory();

        // Path 6: getRestorePlan service throws → sets Error status, errorMessage, sends error telemetry
        getRestorePlanStub.rejects(new Error("Plan fetch failed"));
        result = await controller["getRestorePlan"](false, stateWithSourceOptions);
        resultModel = result.viewModel.model as RestoreDatabaseViewModel;
        expect(resultModel.restorePlanStatus).to.equal(ApiStatus.Error);
        expect(resultModel.restorePlan).to.be.undefined;
        expect(resultModel.errorMessage).to.equal("Plan fetch failed");
        expect(sendErrorEvent).to.have.been.calledWith(
            TelemetryViews.Restore,
            TelemetryActions.GetRestorePlan,
            sinon.match.instanceOf(Error),
            false,
        );

        // Path 7: no explicit state → falls back to this.state
        getRestorePlanStub.resolves(mockPlan);
        getRestoreParamsStub.resetHistory();
        await controller["getRestorePlan"](false);
        expect(getRestoreParamsStub).to.have.been.called;
    });

    test("getRestoreParams", async () => {
        const createSasKeyStub = sandbox
            .stub(utils, "createSasKey")
            .callsFake((state) => Promise.resolve(state));
        const getUrlStub = sandbox
            .stub(utils, "getUrl")
            .resolves("https://storage.blob.core.windows.net/container");
        const updatePlanFromStateStub = sandbox.spy(controller as any, "updatePlanFromState");

        // Path 1: BackupFile type — joins file paths with comma
        const stateWithBackupFiles = {
            ...mockInitialState,
            formState: {
                ...mockInitialState.formState,
                sourceDatabaseName: "testDatabase",
                targetDatabaseName: "restoredDb",
                relocateDbFiles: false,
                blob: "",
            },
            viewModel: {
                ...mockInitialState.viewModel,
                model: {
                    ...mockInitialState.viewModel.model,
                    type: DisasterRecoveryType.BackupFile,
                    backupFiles: [
                        { filePath: "C:\\Backups\\file1.bak", isExisting: true },
                        { filePath: "C:\\Backups\\file2.bak", isExisting: true },
                    ],
                    restorePlan: undefined,
                    selectedBackupSets: ["set-1"],
                } as RestoreDatabaseViewModel,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        let result = await controller["getRestoreParams"](
            TaskExecutionMode.executeAndScript,
            false,
            false,
            stateWithBackupFiles,
        );
        expect(result.options["backupFilePaths"]).to.equal(
            "C:\\Backups\\file1.bak,C:\\Backups\\file2.bak",
        );
        expect(result.options["deviceType"]).to.equal(MediaDeviceType.File);
        expect(result.options["readHeaderFromMedia"]).to.be.true;
        expect(result.options["selectedBackupSets"]).to.deep.equal(["set-1"]);
        expect(result.ownerUri).to.equal("ownerUri");
        expect(result.taskExecutionMode).to.equal(TaskExecutionMode.executeAndScript);
        expect(getUrlStub).to.not.have.been.called;
        expect(createSasKeyStub).to.have.been.called;

        createSasKeyStub.resetHistory();

        // Path 2: Url type — calls getUrl and appends blob name
        const stateWithUrl = {
            ...mockInitialState,
            formState: {
                ...mockInitialState.formState,
                blob: "myBackup.bak",
                targetDatabaseName: "restoredDb",
                relocateDbFiles: false,
            },
            viewModel: {
                ...mockInitialState.viewModel,
                model: {
                    ...mockInitialState.viewModel.model,
                    type: DisasterRecoveryType.Url,
                    backupFiles: [],
                    restorePlan: undefined,
                    selectedBackupSets: [],
                } as RestoreDatabaseViewModel,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        result = await controller["getRestoreParams"](
            TaskExecutionMode.execute,
            true,
            false,
            stateWithUrl,
        );
        expect(getUrlStub).to.have.been.calledOnce;
        expect(createSasKeyStub).to.have.been.calledOnce;
        expect(result.options["backupFilePaths"]).to.equal(
            "https://storage.blob.core.windows.net/container/myBackup.bak",
        );
        expect(result.options["deviceType"]).to.equal(MediaDeviceType.Url);

        getUrlStub.resetHistory();
        createSasKeyStub.resetHistory();

        // Path 3: Database type — backupFilePaths is empty, readHeaderFromMedia is false
        const stateWithDatabase = {
            ...mockInitialState,
            formState: {
                ...mockInitialState.formState,
                sourceDatabaseName: "testDatabase",
                targetDatabaseName: "restoredDb",
                relocateDbFiles: false,
            },
            viewModel: {
                ...mockInitialState.viewModel,
                model: {
                    ...mockInitialState.viewModel.model,
                    type: DisasterRecoveryType.Database,
                    backupFiles: [],
                    restorePlan: undefined,
                    selectedBackupSets: [],
                } as RestoreDatabaseViewModel,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        result = await controller["getRestoreParams"](
            TaskExecutionMode.execute,
            false, // isRestorePlan
            false, // useDefaults
            stateWithDatabase,
        );
        expect(result.options["backupFilePaths"]).to.equal("");
        expect(result.options["readHeaderFromMedia"]).to.be.false;
        expect(result.readHeaderFromMedia).to.be.false;
        // AssertionError: expected '' to equal 'testDatabase'
        expect(result.sourceDatabaseName).to.equal("testDatabase");
        expect(result.options["sourceDatabaseName"]).to.equal("testDatabase");
        expect(getUrlStub).to.not.have.been.called;
        expect(createSasKeyStub).to.have.been.called;

        createSasKeyStub.resetHistory();

        // Path 4: useDefaults = true → targetDatabaseName is defaultDatabase, sourceDatabaseName is ""
        result = await controller["getRestoreParams"](
            TaskExecutionMode.execute,
            true,
            true,
            stateWithDatabase,
        );
        expect(result.options["targetDatabaseName"]).to.equal(defaultDatabase);
        expect(result.options["sourceDatabaseName"]).to.equal("");

        // Path 5: isRestorePlan = true → selectedBackupSets and sessionId are null/undefined
        result = await controller["getRestoreParams"](
            TaskExecutionMode.execute,
            true,
            false,
            stateWithBackupFiles,
        );
        expect(result.options["selectedBackupSets"]).to.be.null;
        expect(result.options["sessionId"]).to.be.undefined;
        expect(result.options["overwriteTargetDatabase"]).to.be.true;

        // Path 6: isRestorePlan = false with restorePlan present →
        // calls updatePlanFromState, only includes options where currentValue != defaultValue
        const stateWithPlan = {
            ...stateWithBackupFiles,
            formState: {
                ...stateWithBackupFiles.formState,
                relocateDbFiles: true, // differs from default (false)
                replaceDatabase: false, // matches default
            },
            viewModel: {
                ...stateWithBackupFiles.viewModel,
                model: {
                    ...stateWithBackupFiles.viewModel.model,
                    restorePlan: {
                        sessionId: "session-1",
                        planDetails: {
                            relocateDbFiles: { currentValue: false, defaultValue: false },
                            replaceDatabase: { currentValue: false, defaultValue: false },
                        },
                    } as any,
                    selectedBackupSets: ["set-1"],
                } as RestoreDatabaseViewModel,
            },
        } as ObjectManagementWebviewState<RestoreDatabaseFormState>;

        result = await controller["getRestoreParams"](
            TaskExecutionMode.executeAndScript,
            false,
            false,
            stateWithPlan,
        );
        expect(updatePlanFromStateStub).to.have.been.called;
        expect(result.options["relocateDbFiles"]).to.equal(true); // differs from default
        expect(result.options["replaceDatabase"]).to.be.undefined; // matches default — excluded
        expect(result.options["sessionId"]).to.equal("session-1");
        expect(result.options["selectedBackupSets"]).to.deep.equal(["set-1"]);

        // Path 7: no explicit state → falls back to this.state
        result = await controller["getRestoreParams"](TaskExecutionMode.execute, true, false);
        expect(result.ownerUri).to.equal("ownerUri");
    });
});
