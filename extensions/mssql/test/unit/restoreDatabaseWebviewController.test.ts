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
    restoreDatabaseHelpLink,
} from "../../src/constants/constants";
import {
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
} from "../../src/sharedInterfaces/restore";
import { RestoreDatabaseWebviewController } from "../../src/controllers/restoreDatabaseWebviewController";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import { TaskExecutionMode } from "../../src/sharedInterfaces/schemaCompare";
import { FormItemType } from "../../src/sharedInterfaces/form";
import * as utils from "../../src/controllers/sharedDisasterRecoveryUtils";

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
});
