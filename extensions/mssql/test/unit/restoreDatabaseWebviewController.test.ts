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
import { stubVscodeWrapper, stubTelemetry } from "./utils";
import { FileBrowserService } from "../../src/services/fileBrowserService";
import { AzureBlobService } from "../../src/services/azureBlobService";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import * as LocConstants from "../../src/constants/locConstants";
import { allFileTypes, defaultBackupFileTypes } from "../../src/constants/constants";
import {
    DisasterRecoveryType,
    ObjectManagementDialogType,
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

        await controller["registerRpcHandlers"]();
        await controller["registerRestoreRpcHandlers"]();
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
        expect(
            happyController.state.formComponents["sourceDatabaseName"]?.options[0].value,
        ).to.equal("testDatabase");
        expect(
            happyController.state.formComponents["sourceDatabaseName"]?.options[0].displayName,
        ).to.equal("testDatabase");
        expect(
            happyController.state.formComponents["targetDatabaseName"]?.options[1].value,
        ).to.equal("otherDatabase");
        expect(
            happyController.state.formComponents["targetDatabaseName"]?.options[1].displayName,
        ).to.equal("otherDatabase");

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

    //#endregion
});
