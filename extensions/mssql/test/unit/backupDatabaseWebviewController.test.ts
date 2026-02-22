/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { BackupDatabaseWebviewController } from "../../src/controllers/backupDatabaseWebviewController";
import { ObjectManagementService } from "../../src/services/objectManagementService";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { stubTelemetry, stubVscodeWrapper } from "./utils";
import {
    BackupCompression,
    BackupDatabaseFormState,
    BackupDatabaseViewModel,
    BackupType,
    EncryptionAlgorithm,
    LogOption,
    MediaDeviceType,
    MediaSet,
    PhysicalDeviceType,
} from "../../src/sharedInterfaces/backup";
import { FileBrowserService } from "../../src/services/fileBrowserService";
import { AzureBlobService } from "../../src/services/azureBlobService";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import * as LocConstants from "../../src/constants/locConstants";
import { allFileTypes, defaultBackupFileTypes, url } from "../../src/constants/constants";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import { TaskExecutionMode } from "../../src/sharedInterfaces/schemaCompare";
import {
    DisasterRecoveryType,
    ObjectManagementDialogType,
    ObjectManagementWebviewState,
} from "../../src/sharedInterfaces/objectManagement";
import { ConnectionProfile } from "../../src/models/connectionProfile";
import ConnectionManager from "../../src/controllers/connectionManager";
import * as utils from "../../src/controllers/sharedDisasterRecoveryUtils";

chai.use(sinonChai);

suite("BackupDatabaseWebviewController", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockObjectManagementService: ObjectManagementService;
    let mockProfile: ConnectionProfile;
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let mockFileBrowserService: FileBrowserService;
    let mockAzureBlobService: AzureBlobService;
    let controller: BackupDatabaseWebviewController;
    let mockInitialState: ObjectManagementWebviewState<BackupDatabaseFormState>;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let sendActionEvent: sinon.SinonStub;
    let getBackupConfigInfoStub: sinon.SinonStub;
    const defaultBackupName = "testDatabase_YYYYMMDD_HHMMSS.bak";

    setup(async () => {
        sandbox = sinon.createSandbox();
        mockContext = {
            extensionUri: vscode.Uri.parse("https://localhost"),
            extensionPath: "path",
        } as unknown as vscode.ExtensionContext;

        vscodeWrapper = stubVscodeWrapper(sandbox);
        ({ sendActionEvent } = stubTelemetry(sandbox));

        mockObjectManagementService = sandbox.createStubInstance(ObjectManagementService);
        mockAzureBlobService = sandbox.createStubInstance(AzureBlobService);
        mockConnectionManager = sandbox.createStubInstance(ConnectionManager);

        const mockConfigInfo = {
            defaultBackupFolder: "C:\\Backups",
            backupEncryptors: [],
            recoveryModel: "Simple",
        };

        getBackupConfigInfoStub =
            mockObjectManagementService.getBackupConfigInfo as sinon.SinonStub;
        getBackupConfigInfoStub.resolves({
            backupConfigInfo: {
                ...mockConfigInfo,
            },
        });

        mockProfile = {
            id: "profile-id",
            server: "serverName",
            database: "testDatabase",
        } as unknown as ConnectionProfile;

        controller = new BackupDatabaseWebviewController(
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
                dialogType: ObjectManagementDialogType.BackupDatabase,
                model: {
                    loadState: ApiStatus.Loaded,
                    azureComponentStatuses: {
                        accountId: ApiStatus.NotStarted,
                        tenantId: ApiStatus.NotStarted,
                        subscriptionId: ApiStatus.NotStarted,
                        storageAccountId: ApiStatus.NotStarted,
                        blobContainerId: ApiStatus.NotStarted,
                    },
                    databaseName: "testDatabase",
                    backupEncryptors: mockConfigInfo.backupEncryptors,
                    recoveryModel: mockConfigInfo.recoveryModel,
                    defaultBackupName: defaultBackupName,
                    type: DisasterRecoveryType.BackupFile,
                    backupFiles: [
                        {
                            filePath: `${mockConfigInfo.defaultBackupFolder}/${defaultBackupName}`,
                            isExisting: false,
                        },
                    ],
                    tenants: [],
                    subscriptions: [],
                    storageAccounts: [],
                    blobContainers: [],
                    url: "",
                } as BackupDatabaseViewModel,
            },
            ownerUri: "ownerUri",
            databaseName: "testDatabase",
            defaultFileBrowserExpandPath: mockConfigInfo.defaultBackupFolder,
            formState: {
                backupName: "testDatabase_YYYYMMDD_HHMMSS.bak",
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
                encryptorName: "",
                retainDays: 0,
                accountId: "",
                tenantId: "",
                subscriptionId: "",
                storageAccountId: "",
                blobContainerId: "",
            } as BackupDatabaseFormState,
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
        } as ObjectManagementWebviewState<BackupDatabaseFormState>;

        await controller["initializeDialog"]();

        mockInitialState.formComponents = controller[
            "setFormComponents"
        ] as typeof mockInitialState.formComponents;

        expect(getBackupConfigInfoStub).to.have.been.called;

        await controller["registerRpcHandlers"]();
        await controller["registerBackupRpcHandlers"]();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("should initialize with correct state", async () => {
        const defaultStub = sandbox
            .stub(controller as any, "getDefaultBackupFileName")
            .returns(
                (mockInitialState.viewModel.model as BackupDatabaseViewModel).defaultBackupName,
            );

        await controller["initializeDialog"]();

        let backupViewModel = controller.state.viewModel.model as BackupDatabaseViewModel;
        const mockBackupViewModel = mockInitialState.viewModel.model as BackupDatabaseViewModel;

        expect(backupViewModel.azureComponentStatuses).to.deep.equal(
            mockBackupViewModel.azureComponentStatuses,
        );
        expect(backupViewModel.defaultBackupName).to.equal(mockBackupViewModel.defaultBackupName);
        expect(controller.state.defaultFileBrowserExpandPath).to.equal(
            mockInitialState.defaultFileBrowserExpandPath,
        );
        expect(backupViewModel.databaseName).to.equal(mockBackupViewModel.databaseName);
        expect(backupViewModel.recoveryModel).to.equal(mockBackupViewModel.recoveryModel);
        expect(backupViewModel.backupFiles).to.deep.equal(mockBackupViewModel.backupFiles);
        expect(controller.state.fileFilterOptions).to.deep.equal(
            mockInitialState.fileFilterOptions,
        );
        expect(controller.state.formState.encryptorName).to.be.undefined;
        expect(backupViewModel.loadState).to.equal(ApiStatus.Loaded);

        getBackupConfigInfoStub.resolves({
            backupConfigInfo: {
                defaultBackupFolder: "D:\\SQLBackups",
                backupEncryptors: [{ encryptorName: "Encryptor1", encryptorType: "1" }],
                recoveryModel: "Full",
            },
        });

        await controller["initializeDialog"]();

        backupViewModel = controller.state.viewModel.model as BackupDatabaseViewModel;

        expect(controller.state.formState.encryptorName).to.equal("Encryptor1");
        expect(backupViewModel.loadState).to.equal(ApiStatus.Loaded);

        expect(sendActionEvent).to.have.been.calledWith(
            TelemetryViews.Backup,
            TelemetryActions.InitializeBackup,
        );

        defaultStub.restore();
    });

    test("setBackupDatabaseFormComponents sets form components correctly", async () => {
        const diskMockState = {
            viewModel: {
                model: { type: DisasterRecoveryType.BackupFile } as BackupDatabaseViewModel,
                dialogType: ObjectManagementDialogType.BackupDatabase,
            },
        } as ObjectManagementWebviewState<BackupDatabaseFormState>;

        const urlMockState = {
            viewModel: {
                model: { type: DisasterRecoveryType.Url } as BackupDatabaseViewModel,
                dialogType: ObjectManagementDialogType.BackupDatabase,
            },
        } as ObjectManagementWebviewState<BackupDatabaseFormState>;

        expect(controller["getActiveFormComponents"](controller.state).length).to.equal(20);

        const backupNameComponent = controller.state.formComponents["backupName"];
        expect(backupNameComponent.type).to.equal("input");
        expect(backupNameComponent.required).to.be.false;

        const backupTypeComponent = controller.state.formComponents["backupType"];
        expect(backupTypeComponent.type).to.equal("dropdown");
        expect(backupTypeComponent.required).to.be.false;
        expect(backupTypeComponent.options).to.deep.equal(controller["getTypeOptions"]());

        const copyOnlyComponent = controller.state.formComponents["copyOnly"];
        expect(copyOnlyComponent.type).to.equal("checkbox");
        expect(copyOnlyComponent.required).to.be.false;

        const accountIdComponent = controller.state.formComponents["accountId"];
        expect(accountIdComponent.type).to.equal("dropdown");
        expect(accountIdComponent.required).to.be.true;
        expect(accountIdComponent.groupName).to.equal(url);
        let validation = accountIdComponent.validate(urlMockState, "");
        expect(validation.isValid).to.be.false;
        expect(validation.validationMessage).to.equal(
            LocConstants.BackupDatabase.azureAccountIsRequired,
        );
        validation = accountIdComponent.validate(urlMockState, "some-id");
        expect(validation.isValid).to.be.true;
        validation = accountIdComponent.validate(diskMockState, "");
        expect(validation.isValid).to.be.true;

        const tenantIdComponent = controller.state.formComponents["tenantId"];
        expect(tenantIdComponent.type).to.equal("dropdown");
        expect(tenantIdComponent.required).to.be.true;
        expect(tenantIdComponent.groupName).to.equal(url);
        validation = tenantIdComponent.validate(urlMockState, "");
        expect(validation.isValid).to.be.false;
        expect(validation.validationMessage).to.equal(LocConstants.BackupDatabase.tenantIsRequired);
        validation = tenantIdComponent.validate(urlMockState, "some-id");
        expect(validation.isValid).to.be.true;
        validation = tenantIdComponent.validate(diskMockState, "");
        expect(validation.isValid).to.be.true;

        const subscriptionIdComponent = controller.state.formComponents["subscriptionId"];
        expect(subscriptionIdComponent.type).to.equal("searchableDropdown");
        expect(subscriptionIdComponent.required).to.be.true;
        expect(subscriptionIdComponent.groupName).to.equal(url);
        validation = subscriptionIdComponent.validate(urlMockState, "");
        expect(validation.isValid).to.be.false;
        expect(validation.validationMessage).to.equal(
            LocConstants.BackupDatabase.subscriptionIsRequired,
        );
        validation = subscriptionIdComponent.validate(urlMockState, "some-id");
        expect(validation.isValid).to.be.true;
        validation = subscriptionIdComponent.validate(diskMockState, "");
        expect(validation.isValid).to.be.true;

        const storageAccountComponent = controller.state.formComponents["storageAccountId"];
        expect(storageAccountComponent.type).to.equal("searchableDropdown");
        expect(storageAccountComponent.required).to.be.true;
        expect(storageAccountComponent.groupName).to.equal(url);
        validation = storageAccountComponent.validate(urlMockState, "");
        expect(validation.isValid).to.be.false;
        expect(validation.validationMessage).to.equal(
            LocConstants.BackupDatabase.storageAccountIsRequired,
        );
        validation = storageAccountComponent.validate(urlMockState, "some-id");
        expect(validation.isValid).to.be.true;
        validation = storageAccountComponent.validate(diskMockState, "");
        expect(validation.isValid).to.be.true;

        const blobContainerComponent = controller.state.formComponents["blobContainerId"];
        expect(blobContainerComponent.type).to.equal("searchableDropdown");
        expect(blobContainerComponent.required).to.be.true;
        expect(blobContainerComponent.groupName).to.equal(url);
        validation = blobContainerComponent.validate(urlMockState, "");
        expect(validation.isValid).to.be.false;
        expect(validation.validationMessage).to.equal(
            LocConstants.BackupDatabase.blobContainerIsRequired,
        );
        validation = blobContainerComponent.validate(urlMockState, "some-id");
        expect(validation.isValid).to.be.true;
        validation = blobContainerComponent.validate(diskMockState, "");
        expect(validation.isValid).to.be.true;

        const backupCompressionComponent = controller.state.formComponents["backupCompression"];
        expect(backupCompressionComponent.type).to.equal("dropdown");
        expect(backupCompressionComponent.required).to.be.false;
        expect(backupCompressionComponent.options).to.deep.equal(
            controller["getCompressionOptions"](),
        );

        const mockExistingFiles = {
            viewModel: {
                model: { backupFiles: [{ filePath: "some-path", isExisting: true }] },
                dialogType: ObjectManagementDialogType.BackupDatabase,
            },
        } as ObjectManagementWebviewState<BackupDatabaseFormState>;
        const mockNewFiles = {
            viewModel: {
                model: { backupFiles: [{ filePath: "some-path", isExisting: false }] },
                dialogType: ObjectManagementDialogType.BackupDatabase,
            },
        } as ObjectManagementWebviewState<BackupDatabaseFormState>;
        const mockNoFiles = {
            viewModel: {
                model: { backupFiles: [] },
                dialogType: ObjectManagementDialogType.BackupDatabase,
            },
        } as ObjectManagementWebviewState<BackupDatabaseFormState>;

        const mediaSetComponent = controller.state.formComponents["mediaSet"];
        expect(mediaSetComponent.type).to.equal("dropdown");
        expect(mediaSetComponent.required).to.be.false;
        expect(mediaSetComponent.options).to.deep.equal(controller["getMediaSetOptions"]());
        validation = mediaSetComponent.validate(mockNewFiles, MediaSet.Overwrite);
        expect(validation.isValid).to.be.true;
        validation = mediaSetComponent.validate(mockExistingFiles, MediaSet.Append);
        expect(validation.isValid).to.be.false;
        expect(validation.validationMessage).to.equal(
            LocConstants.BackupDatabase.pleaseChooseValidMediaOption,
        );
        validation = mediaSetComponent.validate(mockExistingFiles, MediaSet.Create);
        expect(validation.isValid).to.be.true;

        const mediaSetNameComponent = controller.state.formComponents["mediaSetName"];
        expect(mediaSetNameComponent.type).to.equal("input");
        expect(mediaSetNameComponent.required).to.be.false;
        validation = mediaSetNameComponent.validate(mockNoFiles, "");
        expect(validation.isValid).to.be.true;
        validation = mediaSetNameComponent.validate(mockExistingFiles, "ValidName");
        expect(validation.isValid).to.be.true;
        validation = mediaSetNameComponent.validate(mockExistingFiles, "");
        expect(validation.isValid).to.be.false;
        expect(validation.validationMessage).to.equal(
            LocConstants.BackupDatabase.mediaSetNameIsRequired,
        );

        const mediaSetDescriptionComponent = controller.state.formComponents["mediaSetDescription"];
        expect(mediaSetDescriptionComponent.type).to.equal("input");
        expect(mediaSetDescriptionComponent.required).to.be.false;
        validation = mediaSetDescriptionComponent.validate(mockNoFiles, "");
        expect(validation.isValid).to.be.true;
        validation = mediaSetDescriptionComponent.validate(mockExistingFiles, "ValidDescription");
        expect(validation.isValid).to.be.true;
        validation = mediaSetDescriptionComponent.validate(mockExistingFiles, "");
        expect(validation.isValid).to.be.false;
        expect(validation.validationMessage).to.equal(
            LocConstants.BackupDatabase.mediaSetDescriptionIsRequired,
        );

        const performChecksumComponent = controller.state.formComponents["performChecksum"];
        expect(performChecksumComponent.type).to.equal("checkbox");
        expect(performChecksumComponent.required).to.be.false;
        expect(performChecksumComponent.groupName).to.equal(
            LocConstants.BackupDatabase.reliability,
        );

        const verifyBackupComponent = controller.state.formComponents["verifyBackup"];
        expect(verifyBackupComponent.type).to.equal("checkbox");
        expect(verifyBackupComponent.required).to.be.false;
        expect(verifyBackupComponent.groupName).to.equal(LocConstants.BackupDatabase.reliability);

        const continueOnErrorComponent = controller.state.formComponents["continueOnError"];
        expect(continueOnErrorComponent.type).to.equal("checkbox");
        expect(continueOnErrorComponent.required).to.be.false;
        expect(continueOnErrorComponent.groupName).to.equal(
            LocConstants.BackupDatabase.reliability,
        );

        const transactionLogComponent = controller.state.formComponents["transactionLog"];
        expect(transactionLogComponent.type).to.equal("dropdown");
        expect(transactionLogComponent.required).to.be.false;
        expect(transactionLogComponent.options).to.deep.equal(
            controller["getTransactionLogOptions"](),
        );

        const retainDaysComponent = controller.state.formComponents["retainDays"];
        expect(retainDaysComponent.type).to.equal("input");
        expect(retainDaysComponent.required).to.be.false;

        const encryptionEnabledComponent = controller.state.formComponents["encryptionEnabled"];
        expect(encryptionEnabledComponent.type).to.equal("checkbox");
        expect(encryptionEnabledComponent.required).to.be.false;

        const encryptionAlgorithmComponent = controller.state.formComponents["encryptionAlgorithm"];
        expect(encryptionAlgorithmComponent.type).to.equal("dropdown");
        expect(encryptionAlgorithmComponent.required).to.be.false;
        expect(encryptionAlgorithmComponent.options).to.deep.equal(
            controller["getEncryptionAlgorithmOptions"](),
        );

        const encryptorNameComponent = controller.state.formComponents["encryptorName"];
        expect(encryptorNameComponent.type).to.equal("dropdown");
        expect(encryptorNameComponent.required).to.be.false;
    });

    //#region Reducer Tests
    test("formActionReducer", async () => {
        const formActionStub = sandbox.stub(utils, "disasterRecoveryFormAction");

        await controller["_reducerHandlers"].get("formAction")(mockInitialState, {
            propertyName: "copyOnly",
            value: true,
        });

        expect(formActionStub).to.have.been.calledOnce;
    });

    test("backupDatabase Reducer", async () => {
        const backupDatabaseStub = sandbox
            .stub(controller as any, "backupHelper")
            .returns({ success: true });

        (mockInitialState.viewModel.model as BackupDatabaseViewModel).type =
            DisasterRecoveryType.BackupFile;

        let result = await controller["_reducerHandlers"].get("backupDatabase")(
            mockInitialState,
            {},
        );
        expect(backupDatabaseStub).to.have.been.calledOnce;
        expect(backupDatabaseStub).to.have.been.calledWithMatch(TaskExecutionMode.executeAndScript);
        expect(result).to.deep.equal(mockInitialState);

        expect(sendActionEvent).to.have.been.called;

        backupDatabaseStub.resetHistory();
        sendActionEvent.resetHistory();

        result = await controller["_reducerHandlers"].get("backupDatabase")(
            {
                ...mockInitialState,
                viewModel: {
                    model: {
                        ...mockInitialState.viewModel.model,
                        type: DisasterRecoveryType.Url,
                        backupFiles: [{ filePath: "some-path", isExisting: true }],
                    },
                    dialogType: ObjectManagementDialogType.BackupDatabase,
                },
            } as ObjectManagementWebviewState<BackupDatabaseFormState>,
            {},
        );
        expect(backupDatabaseStub).to.have.been.calledOnce;
        expect(backupDatabaseStub).to.have.been.calledWithMatch(TaskExecutionMode.executeAndScript);

        expect(sendActionEvent).to.have.been.called;

        backupDatabaseStub.resetHistory();
        sendActionEvent.resetHistory();

        result = await controller["_reducerHandlers"].get("backupDatabase")(
            {
                ...mockInitialState,
                viewModel: {
                    model: {
                        ...mockInitialState.viewModel.model,
                        type: DisasterRecoveryType.Url,
                        backupFiles: [{ filePath: "some-path", isExisting: false }],
                    },
                    dialogType: ObjectManagementDialogType.BackupDatabase,
                },
            } as ObjectManagementWebviewState<BackupDatabaseFormState>,
            {},
        );
        expect(backupDatabaseStub).to.have.been.calledOnce;
        expect(backupDatabaseStub).to.have.been.calledWithMatch(TaskExecutionMode.executeAndScript);

        expect(sendActionEvent).to.have.been.called;

        backupDatabaseStub.restore();
    });

    test("openBackupScript Reducer", async () => {
        const backupDatabaseStub = sandbox
            .stub(controller as any, "backupHelper")
            .returns({ success: true });

        const result = await controller["_reducerHandlers"].get("openBackupScript")(
            mockInitialState,
            {},
        );
        expect(backupDatabaseStub).to.have.been.calledOnce;
        expect(backupDatabaseStub).to.have.been.calledWithMatch(TaskExecutionMode.script);
        expect(result).to.deep.equal(mockInitialState);

        expect(sendActionEvent).to.have.been.calledWith(
            TelemetryViews.Backup,
            TelemetryActions.ScriptBackup,
        );

        backupDatabaseStub.restore();
    });

    test("setTypeReducer", async () => {
        const state = {
            ...mockInitialState,
            viewModel: {
                model: {
                    ...mockInitialState.viewModel.model,
                    type: DisasterRecoveryType.BackupFile,
                },
                dialogType: ObjectManagementDialogType.BackupDatabase,
            },
            formErrors: ["test"],
        } as ObjectManagementWebviewState<BackupDatabaseFormState>;
        const result = await controller["_reducerHandlers"].get("setType")(state, {
            type: DisasterRecoveryType.Url,
        });
        expect((result.viewModel.model as BackupDatabaseViewModel).type).to.equal(
            DisasterRecoveryType.Url,
        );
        expect(result.formErrors).to.be.empty;
    });

    test("removeBackupFile Reducer", async () => {
        const state = {
            ...mockInitialState,
            viewModel: {
                model: {
                    ...mockInitialState.viewModel.model,
                    backupFiles: [
                        { filePath: "path1", isExisting: true },
                        { filePath: "path2", isExisting: false },
                    ],
                },
                dialogType: ObjectManagementDialogType.BackupDatabase,
            },
        } as ObjectManagementWebviewState<BackupDatabaseFormState>;
        const mediaStub = sandbox
            .stub(controller as any, "setMediaOptionsIfExistingFiles")
            .callsFake((state) => state);

        const result = await controller["_reducerHandlers"].get("removeBackupFile")(state, {
            filePath: "path1",
        });
        expect((result.viewModel.model as BackupDatabaseViewModel).backupFiles.length).to.equal(1);
        expect(
            (result.viewModel.model as BackupDatabaseViewModel).backupFiles[0].filePath,
        ).to.equal("path2");
        expect(mediaStub).to.have.been.calledOnce;
        mediaStub.restore();
    });

    test("handleFileChange Reducer", async () => {
        const state = {
            ...mockInitialState,
            viewModel: {
                model: {
                    ...mockInitialState.viewModel.model,
                    backupFiles: [
                        { filePath: "path1/file1", isExisting: true },
                        { filePath: "path2", isExisting: false },
                    ],
                },
                dialogType: ObjectManagementDialogType.BackupDatabase,
            },
        } as ObjectManagementWebviewState<BackupDatabaseFormState>;

        let result = await controller["_reducerHandlers"].get("handleFileChange")(state, {
            index: 0,
            newValue: "newFile1",
            isFolderChange: false,
        });

        expect(
            (result.viewModel.model as BackupDatabaseViewModel).backupFiles[0].filePath,
        ).to.equal("path1/newFile1");

        result = await controller["_reducerHandlers"].get("handleFileChange")(state, {
            index: 1,
            newValue: "newPath2",
            isFolderChange: true,
        });
        expect(
            (result.viewModel.model as BackupDatabaseViewModel).backupFiles[1].filePath,
        ).to.equal("newPath2/path2");
    });

    test("loadAzureComponent Reducer", async () => {
        const state = {
            ...mockInitialState,
            ownerUri: "testownerUri",
        } as any;
        const loadAzureComponentsStub = sandbox
            .stub(utils, "loadAzureComponentHelper")
            .resolves(state);

        const result = await controller["_reducerHandlers"].get("loadAzureComponent")(state, {
            componentName: "accountId",
        });

        expect(loadAzureComponentsStub).to.have.been.calledOnce;
        expect(result.ownerUri).to.equal("testownerUri");
    });

    test("submitFilePath reducer", async () => {
        const mediaStub = sandbox
            .stub(controller as any, "setMediaOptionsIfExistingFiles")
            .callsFake((state) => state);
        const state = {
            ...mockInitialState,
            viewModel: {
                ...mockInitialState.viewModel,
                model: { ...mockInitialState.viewModel.model, backupFiles: [] },
            },
        } as ObjectManagementWebviewState<BackupDatabaseFormState>;
        let result = await controller["_reducerHandlers"].get("submitFilePath")(state, {
            selectedPath: "newPath/newFile.bak",
        });
        expect(
            (result.viewModel.model as BackupDatabaseViewModel).backupFiles[0].filePath,
        ).to.equal("newPath/newFile.bak");
        expect(mediaStub).to.have.been.calledOnce;

        mediaStub.resetHistory();

        mockInitialState.viewModel.model = {
            ...mockInitialState.viewModel.model,
            backupFiles: [{ filePath: "newPath/newFile.bak", isExisting: false }],
        } as BackupDatabaseViewModel;

        result = await controller["_reducerHandlers"].get("submitFilePath")(state, {
            selectedPath: "newPath/newFile.bak",
        });
        expect((result.viewModel.model as BackupDatabaseViewModel).backupFiles.length).to.equal(1);
        expect(mediaStub).to.have.been.calledOnce;

        mediaStub.resetHistory();

        const defaultStub = sandbox
            .stub(controller as any, "getDefaultBackupFileName")
            .returns("default");

        state.viewModel.model = {
            ...state.viewModel.model,
            backupFiles: [],
        } as BackupDatabaseViewModel;

        result = await controller["_reducerHandlers"].get("submitFilePath")(state, {
            selectedPath: "newPath",
        });
        expect(
            (result.viewModel.model as BackupDatabaseViewModel).backupFiles[0].filePath,
        ).to.equal("newPath/default");
        expect(mediaStub).to.have.been.calledOnce;
        expect(defaultStub).to.have.been.calledOnce;

        mediaStub.restore();
        defaultStub.restore();
    });
    //#endregion

    //#region Helper Method Tests
    test("getDefaultBackupFileName", () => {
        const backupName = controller["getDefaultBackupFileName"](
            mockInitialState.viewModel.model as BackupDatabaseViewModel,
        );
        expect(backupName).to.include("testDatabase_");

        mockInitialState.viewModel.model = {
            ...mockInitialState.viewModel.model,
            backupFiles: [{ filePath: "path/to/backup.bak", isExisting: false }],
        } as BackupDatabaseViewModel;
        const backupName2 = controller["getDefaultBackupFileName"](
            mockInitialState.viewModel.model as BackupDatabaseViewModel,
        );
        expect(backupName2).to.include("testDatabase_1");
    });

    test("setMediaOptionsIfExistingFiles updates media options based on existing backup files", () => {
        const mediaOptionsForExisting = [{ label: "Create", value: MediaSet.Create }];
        const mediaOptionsForNew = [{ label: "Append", value: MediaSet.Append }];

        const getMediaSetOptionsStub = sandbox
            .stub(controller as any, "getMediaSetOptions")
            .callsFake((hasExistingFiles: boolean) =>
                hasExistingFiles ? mediaOptionsForExisting : mediaOptionsForNew,
            );

        let mockState = {
            ...mockInitialState,
            viewModel: {
                model: {
                    backupFiles: [],
                    ...mockInitialState.viewModel.model,
                },
                dialogType: ObjectManagementDialogType.BackupDatabase,
            },
            formState: {
                ...mockInitialState.formState,
                mediaSet: MediaSet.Create,
            },
            formComponents: {
                mediaSet: {
                    isAdvancedOption: false,
                    options: [],
                },
                mediaSetName: {
                    isAdvancedOption: false,
                    required: false,
                },
                mediaSetDescription: {
                    isAdvancedOption: false,
                    required: false,
                },
            },
        };

        /* ---------- No existing files: mediaSet should be Append ---------- */
        let result = (controller as any).setMediaOptionsIfExistingFiles(mockState);

        expect(result.formState.mediaSet).to.equal(MediaSet.Append);
        expect(result.formComponents.mediaSet.isAdvancedOption).to.be.true;
        expect(result.formComponents.mediaSet.options).to.deep.equal(mediaOptionsForNew);

        expect(result.formComponents.mediaSetName.isAdvancedOption).to.be.true;
        expect(result.formComponents.mediaSetDescription.isAdvancedOption).to.be.true;
        expect(result.formComponents.mediaSetName.required).to.be.false;
        expect(result.formComponents.mediaSetDescription.required).to.be.false;

        /* ---------- Existing file present: mediaSet should be Create ---------- */
        result.backupFiles = [
            {
                filePath: "existing.bak",
                isExisting: true,
            },
        ];

        mockState.viewModel.model = {
            ...mockState.viewModel.model,
            backupFiles: [
                ...result.backupFiles,
                {
                    filePath: "existing.bak",
                    isExisting: true,
                },
            ],
        };

        result.formComponents.mediaSet.isAdvancedOption = true;

        result = (controller as any).setMediaOptionsIfExistingFiles(result);

        expect(result.formState.mediaSet).to.equal(MediaSet.Create);
        expect(result.formComponents.mediaSet.isAdvancedOption).to.be.false;
        expect(result.formComponents.mediaSet.options).to.deep.equal(mediaOptionsForExisting);

        expect(result.formComponents.mediaSetName.isAdvancedOption).to.be.false;
        expect(result.formComponents.mediaSetDescription.isAdvancedOption).to.be.false;
        expect(result.formComponents.mediaSetName.required).to.be.true;
        expect(result.formComponents.mediaSetDescription.required).to.be.true;

        getMediaSetOptionsStub.restore();
    });

    test("getMediaSetOptions disables append/overwrite when backing up to existing files", () => {
        /* ---------- No existing files ---------- */
        let options = (controller as any).getMediaSetOptions(false);

        expect(options).to.have.length(3);

        expect(options[0]).to.include({
            displayName: LocConstants.BackupDatabase.append,
            value: MediaSet.Append,
            color: "",
            description: "",
            icon: "",
        });

        expect(options[1]).to.include({
            displayName: LocConstants.BackupDatabase.overwrite,
            value: MediaSet.Overwrite,
            color: "",
            description: "",
            icon: "",
        });

        expect(options[2]).to.include({
            displayName: LocConstants.BackupDatabase.create,
            value: MediaSet.Create,
        });

        /* ---------- Existing files ---------- */
        options = (controller as any).getMediaSetOptions(true);

        expect(options).to.have.length(3);

        expect(options[0]).to.include({
            displayName: LocConstants.BackupDatabase.append,
            value: MediaSet.Append,
            color: "colorNeutralForegroundDisabled",
            description: LocConstants.BackupDatabase.unavailableForBackupsToExistingFiles,
            icon: "Warning20Regular",
        });

        expect(options[1]).to.include({
            displayName: LocConstants.BackupDatabase.overwrite,
            value: MediaSet.Overwrite,
            color: "colorNeutralForegroundDisabled",
            description: LocConstants.BackupDatabase.unavailableForBackupsToExistingFiles,
            icon: "Warning20Regular",
        });

        expect(options[2]).to.include({
            displayName: LocConstants.BackupDatabase.create,
            value: MediaSet.Create,
        });
    });

    test("backupHelper builds BackupInfo correctly and calls backupService for file-based backup", async () => {
        const backupResult = { result: true };

        const backupDatabaseStub = mockObjectManagementService.backupDatabase as sinon.SinonStub;
        backupDatabaseStub.resolves(backupResult as any);

        const state = {
            ...mockInitialState,
            viewModel: {
                model: {
                    ...mockInitialState.viewModel.model,
                    backupEncryptors: [{ encryptorName: "enc1", encryptorType: 1 }],
                    backupFiles: [
                        { filePath: "/tmp/a.bak", isExisting: false },
                        { filePath: "/tmp/b.bak", isExisting: true },
                    ],
                    databaseName: "db1",
                    mediaSet: MediaSet.Overwrite,
                    mediaSetName: "media",
                    mediaSetDescription: "desc",
                },
                dialogType: ObjectManagementDialogType.BackupDatabase,
            },
            formState: {
                ...mockInitialState.formState,
                encryptionEnabled: true,
                encryptorName: "enc1",
            },
        } as any;

        const backupViewModelStub = sandbox
            .stub(controller as any, "backupViewModel")
            .callsFake((_s) => state.viewModel.model);

        const result = await controller["backupHelper"](TaskExecutionMode.executeAndScript, state);

        expect(backupViewModelStub).to.have.returned(state.viewModel.model);

        expect(backupViewModelStub).to.have.been.calledOnceWith();
        expect(backupDatabaseStub).to.have.been.calledOnce;

        const [, backupInfo, mode] = backupDatabaseStub.firstCall.args;

        expect(mode).to.equal(TaskExecutionMode.executeAndScript);

        expect(backupInfo).to.include({
            databaseName: "db1",
            encryptorName: "enc1",
            encryptorType: 1,
        });

        expect(backupInfo.backupPathList).to.deep.equal(["/tmp/a.bak", "/tmp/b.bak"]);

        expect(backupInfo.backupPathDevices).to.deep.equal({
            "/tmp/a.bak": MediaDeviceType.File,
            "/tmp/b.bak": MediaDeviceType.File,
        });

        expect(result.success).to.be.true;

        backupDatabaseStub.resetHistory();
        backupViewModelStub.resetHistory();

        const stateWithoutEncryption = {
            ...state,
            formState: { ...state.formState, encryptionEnabled: false },
        } as any;
        const result2 = await controller["backupHelper"](
            TaskExecutionMode.executeAndScript,
            stateWithoutEncryption,
        );

        expect(backupDatabaseStub).to.have.been.calledOnce;
        expect(backupViewModelStub).to.have.been.calledOnce;

        const [, backupInfo2] = backupDatabaseStub.firstCall.args;
        expect(backupInfo2.encryptorName).to.equal("");
        expect(result2.success).to.be.true;

        backupDatabaseStub.restore();
    });

    test("backupHelper builds Azure blob URL, creates SAS, and calls backupService", async () => {
        const backupResult = { result: true };

        /* ---------- Stubs ---------- */
        const backupDatabaseStub = mockObjectManagementService.backupDatabase as sinon.SinonStub;
        backupDatabaseStub.resolves(backupResult as any);

        const url = "https://url";
        /* ---------- State ---------- */
        const state = {
            ...mockInitialState,
            viewModel: {
                model: {
                    ...mockInitialState.viewModel.model,
                    type: DisasterRecoveryType.Url,
                    subscriptions: [{ subscriptionId: "sub1" }],
                    storageAccounts: [{ id: "sa1", name: "storageacct" }],
                    blobContainers: [{ id: "bc1", name: "container" }],
                    backupFiles: [],
                    backupEncryptors: [],
                    defaultBackupName: "default",
                    url: url,
                },
                dialogType: ObjectManagementDialogType.BackupDatabase,
            },
            formState: {
                ...mockInitialState.formState,
                subscriptionId: "sub1",
                storageAccountId: "sa1",
                blobContainerId: "bc1",
                backupName: "backup.bak",
            },
        } as any;

        const createSasStub = sandbox.stub(utils, "createSasKey").resolves(state);

        const backupViewModelStub = sandbox
            .stub(controller as any, "backupViewModel")
            .callsFake((_s) => state.viewModel.model);

        /* ---------- Execute ---------- */
        const result = await controller["backupHelper"](TaskExecutionMode.executeAndScript, state);

        /* ---------- Assertions ---------- */
        expect(createSasStub).to.have.been.calledOnce;

        expect(backupDatabaseStub).to.have.been.calledOnce;

        const [, backupInfo] = backupDatabaseStub.firstCall.args;

        expect(backupInfo.backupPathList[0]).to.equal(`${url}/${state.formState.backupName}`);
        expect(Object.keys(backupInfo.backupPathDevices)).to.deep.equal([
            `${url}/${state.formState.backupName}`,
        ]);
        expect(backupInfo.backupPathDevices[`${url}/${state.formState.backupName}`]).to.equal(
            MediaDeviceType.Url,
        );

        expect(backupInfo.backupDeviceType).to.equal(PhysicalDeviceType.Url);
        expect(result.success).to.be.true;

        /* ---------- Cleanup ---------- */
        backupDatabaseStub.restore();
        createSasStub.restore();
        backupViewModelStub.restore();
    });

    //#endregion
});
