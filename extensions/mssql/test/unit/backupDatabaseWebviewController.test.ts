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
import * as azureHelpers from "../../src/connectionconfig/azureHelpers";
import {
    ObjectManagementDialogType,
    ObjectManagementFormState,
    ObjectManagementWebviewState,
} from "../../src/sharedInterfaces/objectManagement";

chai.use(sinonChai);

suite("BackupDatabaseWebviewController", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockObjectManagementService: ObjectManagementService;
    let mockFileBrowserService: FileBrowserService;
    let mockAzureBlobService: AzureBlobService;
    let controller: BackupDatabaseWebviewController;
    let mockInitialState: ObjectManagementWebviewState;
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

        controller = new BackupDatabaseWebviewController(
            mockContext,
            vscodeWrapper,
            mockObjectManagementService,
            mockFileBrowserService,
            mockAzureBlobService,
            "ownerUri",
            "serverName",
            "testDatabase",
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
                    saveToUrl: false,
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
                    backupUrl: "",
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
            } as ObjectManagementFormState,
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
        } as ObjectManagementWebviewState;

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
            TelemetryActions.StartBackup,
        );

        defaultStub.restore();
    });

    test("setBackupDatabaseFormComponents sets form components correctly", async () => {
        const diskMockState = {
            viewModel: {
                model: { saveToUrl: false } as BackupDatabaseViewModel,
                dialogType: ObjectManagementDialogType.BackupDatabase,
            },
        } as ObjectManagementWebviewState;

        const urlMockState = {
            viewModel: {
                model: { saveToUrl: true } as BackupDatabaseViewModel,
                dialogType: ObjectManagementDialogType.BackupDatabase,
            },
        } as ObjectManagementWebviewState;

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
        } as ObjectManagementWebviewState;
        const mockNewFiles = {
            viewModel: {
                model: { backupFiles: [{ filePath: "some-path", isExisting: false }] },
                dialogType: ObjectManagementDialogType.BackupDatabase,
            },
        } as ObjectManagementWebviewState;
        const mockNoFiles = {
            viewModel: {
                model: { backupFiles: [] },
                dialogType: ObjectManagementDialogType.BackupDatabase,
            },
        } as ObjectManagementWebviewState;

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
        const state = {
            ...mockInitialState,
            formComponents: {
                accountId: { options: [], placeholder: "", isAdvancedOption: false },
            },
        } as any;

        // Test action button callback
        const testStub = sinon.stub();
        controller.state.formComponents.accountId.actionButtons = [
            {
                label: "testButton",
                id: "testButtonId",
                callback: async () => {
                    testStub();
                },
            },
        ];

        const reloadStub = sandbox
            .stub(controller as any, "reloadAzureComponents")
            .callsFake((state) => state);
        const validateFormStub = sandbox
            .stub(controller as any, "validateForm")
            .returns(["accountId"]);

        let result = await controller["_reducerHandlers"].get("formAction")(state, {
            event: { isAction: true, propertyName: "accountId", value: "testButtonId" },
        });
        expect(reloadStub).to.have.been.calledOnce;
        reloadStub.resetHistory();

        result = await controller["_reducerHandlers"].get("formAction")(mockInitialState, {
            event: { isAction: false, propertyName: "accountId", value: "" },
        });
        expect(result.formErrors).to.include("accountId");
        expect(validateFormStub).to.have.been.calledOnce;
        expect(reloadStub).to.have.been.calledOnce;

        validateFormStub.resetHistory();
        reloadStub.resetHistory();

        validateFormStub.returns([]);
        result = await controller["_reducerHandlers"].get("formAction")(mockInitialState, {
            event: { isAction: false, propertyName: "tenantId", value: "valid" },
        });
        expect(result.formErrors).to.not.include("tenantId");
        expect(validateFormStub).to.have.been.calledOnce;
        expect(reloadStub).to.have.been.calledOnce;

        reloadStub.resetHistory();
        validateFormStub.resetHistory();

        result = await controller["_reducerHandlers"].get("formAction")(mockInitialState, {
            event: { isAction: false, propertyName: "copyOnly", value: true },
        });
        expect(result.formState.copyOnly).to.be.true;
        expect(validateFormStub).to.have.been.calledOnce;
        expect(reloadStub).to.have.not.been.called;

        reloadStub.restore();
    });

    test("backupDatabase Reducer", async () => {
        const backupDatabaseStub = sandbox
            .stub(controller as any, "backupHelper")
            .returns({ success: true });

        let result = await controller["_reducerHandlers"].get("backupDatabase")(
            mockInitialState,
            {},
        );
        expect(backupDatabaseStub).to.have.been.calledOnce;
        expect(backupDatabaseStub).to.have.been.calledWithMatch(TaskExecutionMode.executeAndScript);
        expect(result).to.deep.equal(mockInitialState);

        expect(sendActionEvent).to.have.been.calledWith(
            TelemetryViews.Backup,
            TelemetryActions.Backup,
            {
                backupToUrl: "false",
                backupWithExistingFiles: "false",
            },
        );

        backupDatabaseStub.resetHistory();

        result = await controller["_reducerHandlers"].get("backupDatabase")(
            {
                ...mockInitialState,
                viewModel: {
                    model: {
                        ...mockInitialState.viewModel.model,
                        saveToUrl: true,
                        backupFiles: [{ filePath: "some-path", isExisting: true }],
                    },
                    dialogType: ObjectManagementDialogType.BackupDatabase,
                },
            } as ObjectManagementWebviewState,
            {},
        );
        expect(backupDatabaseStub).to.have.been.calledOnce;
        expect(backupDatabaseStub).to.have.been.calledWithMatch(TaskExecutionMode.executeAndScript);

        expect(sendActionEvent).to.have.been.calledWith(
            TelemetryViews.Backup,
            TelemetryActions.Backup,
            {
                backupToUrl: "true",
                backupWithExistingFiles: "true",
            },
        );

        backupDatabaseStub.resetHistory();
        result = await controller["_reducerHandlers"].get("backupDatabase")(
            {
                ...mockInitialState,
                viewModel: {
                    model: {
                        ...mockInitialState.viewModel.model,
                        saveToUrl: true,
                        backupFiles: [{ filePath: "some-path", isExisting: false }],
                    },
                    dialogType: ObjectManagementDialogType.BackupDatabase,
                },
            } as ObjectManagementWebviewState,
            {},
        );
        expect(backupDatabaseStub).to.have.been.calledOnce;
        expect(backupDatabaseStub).to.have.been.calledWithMatch(TaskExecutionMode.executeAndScript);
        expect(sendActionEvent).to.have.been.calledWith(
            TelemetryViews.Backup,
            TelemetryActions.Backup,
            {
                backupToUrl: "true",
                backupWithExistingFiles: "false",
            },
        );
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

    test("setSaveLocation Reducer", async () => {
        const state = {
            ...mockInitialState,
            viewModel: {
                model: {
                    ...mockInitialState.viewModel.model,
                    saveToUrl: false,
                },
                dialogType: ObjectManagementDialogType.BackupDatabase,
            },
            formErrors: ["test"],
        } as ObjectManagementWebviewState;
        const result = await controller["_reducerHandlers"].get("setSaveLocation")(state, {
            saveToUrl: true,
        });
        expect((result.viewModel.model as BackupDatabaseViewModel).saveToUrl).to.be.true;
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
        } as ObjectManagementWebviewState;
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
        } as ObjectManagementWebviewState;

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
        const loadAccountStub = sandbox
            .stub(controller as any, "loadAccountComponent")
            .callsFake((state) => state);

        const loadTenantStub = sandbox
            .stub(controller as any, "loadTenantComponent")
            .callsFake((state) => state);

        const loadSubscriptionStub = sandbox
            .stub(controller as any, "loadSubscriptionComponent")
            .callsFake((state) => state);

        const loadStorageAccountStub = sandbox
            .stub(controller as any, "loadStorageAccountComponent")
            .callsFake((state) => state);

        const loadBlobContainerStub = sandbox
            .stub(controller as any, "loadBlobContainerComponent")
            .callsFake((state) => state);

        let result = await controller["_reducerHandlers"].get("loadAzureComponent")(
            mockInitialState,
            { componentName: "accountId" },
        );
        expect(loadAccountStub).to.have.been.calledOnce;
        expect(
            (result.viewModel.model as BackupDatabaseViewModel).azureComponentStatuses.accountId,
        ).to.equal(ApiStatus.Loaded);

        loadAccountStub.resetHistory();
        (
            mockInitialState.viewModel.model as BackupDatabaseViewModel
        ).azureComponentStatuses.accountId = ApiStatus.Loaded;
        result = await controller["_reducerHandlers"].get("loadAzureComponent")(mockInitialState, {
            componentName: "accountId",
        });
        expect(loadTenantStub).to.not.have.been.called;

        result = await controller["_reducerHandlers"].get("loadAzureComponent")(mockInitialState, {
            componentName: "tenantId",
        });
        expect(loadTenantStub).to.have.been.calledOnce;
        expect(
            (result.viewModel.model as BackupDatabaseViewModel).azureComponentStatuses.tenantId,
        ).to.equal(ApiStatus.Loaded);

        result = await controller["_reducerHandlers"].get("loadAzureComponent")(mockInitialState, {
            componentName: "subscriptionId",
        });
        expect(loadSubscriptionStub).to.have.been.calledOnce;
        expect(
            (result.viewModel.model as BackupDatabaseViewModel).azureComponentStatuses
                .subscriptionId,
        ).to.equal(ApiStatus.Loaded);

        result = await controller["_reducerHandlers"].get("loadAzureComponent")(mockInitialState, {
            componentName: "storageAccountId",
        });
        expect(loadStorageAccountStub).to.have.been.calledOnce;
        expect(
            (result.viewModel.model as BackupDatabaseViewModel).azureComponentStatuses
                .storageAccountId,
        ).to.equal(ApiStatus.Loaded);

        result = await controller["_reducerHandlers"].get("loadAzureComponent")(mockInitialState, {
            componentName: "blobContainerId",
        });
        expect(loadBlobContainerStub).to.have.been.calledOnce;
        expect(
            (result.viewModel.model as BackupDatabaseViewModel).azureComponentStatuses
                .blobContainerId,
        ).to.equal(ApiStatus.Loaded);
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
        } as ObjectManagementWebviewState;
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

        const getStorageKeysStub = sandbox
            .stub(azureHelpers.VsCodeAzureHelper, "getStorageAccountKeys")
            .resolves({
                keys: [{ value: "sas-key" }],
            } as any);

        const createSasStub = mockAzureBlobService.createSas as sinon.SinonStub;
        createSasStub.resolves(undefined);

        /* ---------- State ---------- */
        const state = {
            ...mockInitialState,
            viewModel: {
                model: {
                    ...mockInitialState.viewModel.model,
                    saveToUrl: true,
                    subscriptions: [{ subscriptionId: "sub1" }],
                    storageAccounts: [{ id: "sa1", name: "storageacct" }],
                    blobContainers: [{ id: "bc1", name: "container" }],
                    backupFiles: [],
                    backupEncryptors: [],
                    defaultBackupName: "default",
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

        const backupViewModelStub = sandbox
            .stub(controller as any, "backupViewModel")
            .callsFake((_s) => state.viewModel.model);

        /* ---------- Execute ---------- */
        const result = await controller["backupHelper"](TaskExecutionMode.executeAndScript, state);

        /* ---------- Assertions ---------- */
        expect(getStorageKeysStub).to.have.been.calledOnceWith(
            state.viewModel.model.subscriptions[0],
            state.viewModel.model.storageAccounts[0],
        );

        expect(createSasStub).to.have.been.calledOnce;

        const [, blobContainerUrl] = createSasStub.firstCall.args;
        expect(blobContainerUrl).to.equal("https://storageacct.blob.core.windows.net/container");

        expect(backupDatabaseStub).to.have.been.calledOnce;

        const [, backupInfo] = backupDatabaseStub.firstCall.args;

        expect(backupInfo.backupPathList).to.deep.equal([
            "https://storageacct.blob.core.windows.net/container/backup.bak",
        ]);

        expect(backupInfo.backupPathDevices).to.deep.equal({
            "https://storageacct.blob.core.windows.net/container/backup.bak": MediaDeviceType.Url,
        });

        expect(backupInfo.backupDeviceType).to.equal(PhysicalDeviceType.Url);
        expect(result.success).to.be.true;

        /* ---------- Cleanup ---------- */
        backupDatabaseStub.restore();
        getStorageKeysStub.restore();
        createSasStub.restore();
        backupViewModelStub.restore();
    });

    //#endregion

    //#region Azure Related Tests
    test("getAzureActionButton", async () => {
        const state = {
            ...mockInitialState,
            formComponents: {
                accountId: { options: [], placeholder: "", isAdvancedOption: false },
            },
        };
        const signInStub = sandbox.stub(azureHelpers.VsCodeAzureHelper, "signIn").resolves();

        const accountsStub = sandbox.stub(azureHelpers.VsCodeAzureHelper, "getAccounts").resolves([
            { id: "acc1", label: "Account 1" },
            { id: "acc2", label: "Account 2" },
        ] as any);

        const getAzureActionButtonStub = sandbox.spy(controller as any, "getAzureActionButton");

        const buttons = await (controller as any).getAzureActionButton(state);

        expect(buttons).to.have.length(1);
        expect(buttons[0].id).to.equal("azureSignIn");
        expect(buttons[0].label).to.equal(LocConstants.ConnectionDialog.signIn);

        // Invoke callback
        await buttons[0].callback();

        expect(signInStub).to.have.been.calledOnceWith(true);
        expect(accountsStub).to.have.been.calledOnce;

        // Options populated
        expect(state.formComponents.accountId.options).to.deep.equal([
            { displayName: "Account 1", value: "acc1" },
            { displayName: "Account 2", value: "acc2" },
        ]);

        // First account auto-selected
        expect(state.formState.accountId).to.equal("acc2");

        // Recursive refresh
        expect(getAzureActionButtonStub.callCount).to.equal(2);

        signInStub.restore();
        accountsStub.restore();
        getAzureActionButtonStub.restore();
    });

    test("loadAccountComponent loads accounts and initializes account component", async () => {
        const getAccountsStub = sandbox
            .stub(azureHelpers.VsCodeAzureHelper, "getAccounts")
            .resolves([
                { id: "acc1", label: "Account 1" },
                { id: "acc2", label: "Account 2" },
            ] as any);

        const actionButtons = [{ id: "azureSignIn" }] as any;

        const getAzureActionButtonStub = sandbox
            .stub(controller as any, "getAzureActionButton")
            .resolves(actionButtons);

        const state = {
            ...mockInitialState,
            formComponents: {
                accountId: { options: [], placeholder: "", isAdvancedOption: false },
            },
        };

        const result = await (controller as any).loadAccountComponent(state);

        // Azure accounts fetched
        expect(getAccountsStub).to.have.been.calledOnce;

        // Account auto-selected
        expect(result.formState.accountId).to.equal("acc1");

        // Options populated
        expect(result.formComponents.accountId.options).to.deep.equal([
            { displayName: "Account 1", value: "acc1" },
            { displayName: "Account 2", value: "acc2" },
        ]);

        // Action buttons set
        expect(result.formComponents.accountId.actionButtons).to.equal(actionButtons);
        expect(getAzureActionButtonStub).to.have.been.calledOnceWith(state);

        // State object returned
        expect(result).to.equal(state);

        getAccountsStub.restore();
        getAzureActionButtonStub.restore();
    });

    test("loadTenantComponent handles missing accountId and loads tenants when accountId is set", async () => {
        const tenants = [
            { tenantId: "t1", displayName: "Tenant One" },
            { tenantId: "t2", displayName: "Tenant Two" },
        ];

        const getTenantsStub = sandbox
            .stub(azureHelpers.VsCodeAzureHelper, "getTenantsForAccount")
            .resolves(tenants as any);

        const defaultTenantStub = sandbox.stub(azureHelpers, "getDefaultTenantId").returns("t1");

        const state = {
            ...mockInitialState,
            formComponents: {
                tenantId: { options: [], placeholder: "", isAdvancedOption: false },
            },
        };

        /* ---------- No accountId: error path ---------- */
        let result = await (controller as any).loadTenantComponent(state);

        expect(result.viewModel.model.azureComponentStatuses.tenantId).to.equal(ApiStatus.Error);
        expect(result.formComponents.tenantId.placeholder).to.equal(
            LocConstants.BackupDatabase.noTenantsFound,
        );
        expect(result.formComponents.tenantId.options).to.deep.equal([]);
        expect(result.formState.tenantId).to.equal("");

        /* ----------- AccountId set: success path ----------- */
        result.formState.accountId = "account1";
        result.viewModel.model.azureComponentStatuses.tenantId = ApiStatus.NotStarted;

        result = await (controller as any).loadTenantComponent(result);

        expect(getTenantsStub).to.have.been.calledOnceWith("account1");

        expect(result.formComponents.tenantId.options).to.deep.equal([
            { displayName: "Tenant One", value: "t1" },
            { displayName: "Tenant Two", value: "t2" },
        ]);

        expect(result.formComponents.tenantId.placeholder).to.equal(
            LocConstants.ConnectionDialog.selectATenant,
        );

        expect(result.formState.tenantId).to.equal("t1");
        expect(result.viewModel.model.tenants).to.equal(tenants);

        getTenantsStub.restore();
        defaultTenantStub.restore();
    });

    test("loadSubscriptionComponent handles missing tenantId and loads subscriptions when tenantId is set", async () => {
        const subscriptions = [
            { subscriptionId: "sub1", name: "Subscription One" },
            { subscriptionId: "sub2", name: "Subscription Two" },
        ];

        const getSubscriptionsStub = sandbox
            .stub(azureHelpers.VsCodeAzureHelper, "getSubscriptionsForTenant")
            .resolves(subscriptions as any);

        const state = {
            ...mockInitialState,
            viewModel: {
                model: {
                    ...mockInitialState.viewModel.model,
                    tenants: [{ tenantId: "tenant1", displayName: "Tenant 1" }],
                },
                dialogType: ObjectManagementDialogType.BackupDatabase,
            },
            formComponents: {
                subscriptionId: { options: [], placeholder: "", isAdvancedOption: false },
            },
        };
        /* ---------- No tenantId: error path ---------- */
        let result = await (controller as any).loadSubscriptionComponent(state);

        expect(result.viewModel.model.azureComponentStatuses.subscriptionId).to.equal(
            ApiStatus.Error,
        );
        expect(result.formComponents.subscriptionId.placeholder).to.equal(
            LocConstants.BackupDatabase.noSubscriptionsFound,
        );
        expect(result.formComponents.subscriptionId.options).to.deep.equal([]);
        expect(result.formState.subscriptionId).to.equal("");

        /* ---------- TenantId set: success path ---------- */
        result.formState.tenantId = "tenant1";
        result.viewModel.model.azureComponentStatuses.subscriptionId = ApiStatus.NotStarted;
        result = await (controller as any).loadSubscriptionComponent(result);

        expect(getSubscriptionsStub).to.have.been.calledOnceWith(result.viewModel.model.tenants[0]);

        expect(result.formComponents.subscriptionId.options).to.deep.equal([
            { displayName: "Subscription One", value: "sub1" },
            { displayName: "Subscription Two", value: "sub2" },
        ]);

        expect(result.formState.subscriptionId).to.equal("sub1");

        expect(result.formComponents.subscriptionId.placeholder).to.equal(
            LocConstants.BackupDatabase.selectASubscription,
        );

        expect(result.viewModel.model.subscriptions).to.equal(subscriptions);

        getSubscriptionsStub.restore();
    });

    test("loadStorageAccountComponent handles missing subscription, error, empty results, and success", async () => {
        const storageAccounts = [
            { id: "sa1", name: "Storage Account 1" },
            { id: "sa2", name: "Storage Account 2" },
        ];

        const fetchStorageAccountsStub = sandbox.stub(
            azureHelpers.VsCodeAzureHelper,
            "fetchStorageAccountsForSubscription",
        );

        const state: any = {
            ...mockInitialState,
            viewModel: {
                model: {
                    subscriptions: [{ subscriptionId: "sub1", displayName: "Subscription 1" }],
                    azureComponentStatuses: { storageAccountId: ApiStatus.NotStarted },
                },
                dialogType: ObjectManagementDialogType.BackupDatabase,
            },
            formComponents: {
                storageAccountId: { options: [], placeholder: "", isAdvancedOption: false },
            },
        };

        /* ---------- No subscriptionId: error path ---------- */
        let result = await (controller as any).loadStorageAccountComponent(state);

        expect(result.viewModel.model.azureComponentStatuses.storageAccountId).to.equal(
            ApiStatus.Error,
        );
        expect(result.formComponents.storageAccountId.placeholder).to.equal(
            LocConstants.BackupDatabase.noStorageAccountsFound,
        );
        expect(result.formComponents.storageAccountId.options).to.deep.equal([]);
        expect(result.formState.storageAccountId).to.equal("");

        /* ---------- Subscription set, fetch throws Error ---------- */
        result.formState.subscriptionId = "sub1";
        result.viewModel.model.azureComponentStatuses.storageAccountId = ApiStatus.NotStarted;
        fetchStorageAccountsStub.rejects(new Error("fetch failed"));

        result = await (controller as any).loadStorageAccountComponent(result);

        expect(result.formComponents.storageAccountId.placeholder).to.equal(
            LocConstants.BackupDatabase.noStorageAccountsFound,
        );
        expect(result.formComponents.storageAccountId.options).to.deep.equal([]);
        expect(result.viewModel.model.storageAccounts).to.deep.equal([]);
        expect(result.formState.storageAccountId).to.equal("");
        expect(result.errorMessage).to.equal("fetch failed");

        /* ---------- Fetch returns empty array ---------- */
        fetchStorageAccountsStub.resolves([]);

        result = await (controller as any).loadStorageAccountComponent(result);

        expect(result.formComponents.storageAccountId.placeholder).to.equal(
            LocConstants.BackupDatabase.noStorageAccountsFound,
        );
        expect(result.formComponents.storageAccountId.options).to.deep.equal([]);
        expect(result.viewModel.model.storageAccounts).to.deep.equal([]);
        expect(result.formState.storageAccountId).to.equal("");

        /* ---------- Fetch returns storage accounts ---------- */
        fetchStorageAccountsStub.resolves(storageAccounts as any);

        result = await (controller as any).loadStorageAccountComponent(result);

        expect(fetchStorageAccountsStub).to.have.been.calledWith(
            result.viewModel.model.subscriptions[0],
        );

        expect(result.formComponents.storageAccountId.options).to.deep.equal([
            { displayName: "Storage Account 1", value: "sa1" },
            { displayName: "Storage Account 2", value: "sa2" },
        ]);

        expect(result.formComponents.storageAccountId.placeholder).to.equal(
            LocConstants.BackupDatabase.selectAStorageAccount,
        );

        expect(result.formState.storageAccountId).to.equal("sa1");
        expect(result.viewModel.model.storageAccounts).to.equal(storageAccounts);
        fetchStorageAccountsStub.restore();
    });

    test("loadBlobContainerComponent handles missing state, error, empty results, and success", async () => {
        const blobContainers = [
            { id: "bc1", name: "Container One" },
            { id: "bc2", name: "Container Two" },
        ];

        const fetchBlobContainersStub = sandbox.stub(
            azureHelpers.VsCodeAzureHelper,
            "fetchBlobContainersForStorageAccount",
        );

        const state: any = {
            ...mockInitialState,
            viewModel: {
                model: {
                    subscriptions: [{ subscriptionId: "sub1", displayName: "Subscription 1" }],
                    storageAccounts: [{ id: "sa1", name: "Storage Account 1" }],
                    azureComponentStatuses: { blobContainerId: ApiStatus.NotStarted },
                },
                dialogType: ObjectManagementDialogType.BackupDatabase,
            },
            formComponents: {
                blobContainerId: { options: [], placeholder: "", isAdvancedOption: false },
            },
        };

        /* ---------- Missing subscriptionId or storageAccountId ---------- */
        let result = await (controller as any).loadBlobContainerComponent(state);

        expect(result.viewModel.model.azureComponentStatuses.blobContainerId).to.equal(
            ApiStatus.Error,
        );
        expect(result.formComponents.blobContainerId.placeholder).to.equal(
            LocConstants.BackupDatabase.noBlobContainersFound,
        );
        expect(result.formComponents.blobContainerId.options).to.deep.equal([]);
        expect(result.formState.blobContainerId).to.equal("");

        /* ---------- IDs set, fetch throws Error ---------- */
        result.formState.subscriptionId = "sub1";
        result.formState.storageAccountId = "sa1";
        result.viewModel.model.azureComponentStatuses.blobContainerId = ApiStatus.NotStarted;

        fetchBlobContainersStub.rejects(new Error("fetch failed"));

        result = await (controller as any).loadBlobContainerComponent(result);

        expect(result.formComponents.blobContainerId.placeholder).to.equal(
            LocConstants.BackupDatabase.noBlobContainersFound,
        );
        expect(result.formComponents.blobContainerId.options).to.deep.equal([]);
        expect(result.viewModel.model.blobContainers).to.deep.equal([]);
        expect(result.formState.blobContainerId).to.equal("");
        expect(result.errorMessage).to.equal("fetch failed");

        /* ---------- Fetch returns empty array ---------- */
        fetchBlobContainersStub.resolves([]);

        result = await (controller as any).loadBlobContainerComponent(result);

        expect(result.formComponents.blobContainerId.placeholder).to.equal(
            LocConstants.BackupDatabase.noBlobContainersFound,
        );
        expect(result.formComponents.blobContainerId.options).to.deep.equal([]);
        expect(result.viewModel.model.blobContainers).to.deep.equal([]);
        expect(result.formState.blobContainerId).to.equal("");

        /* ---------- Fetch returns blob containers ---------- */
        fetchBlobContainersStub.resolves(blobContainers as any);

        result = await (controller as any).loadBlobContainerComponent(result);

        expect(fetchBlobContainersStub).to.have.been.calledWith(
            result.viewModel.model.subscriptions[0],
            result.viewModel.model.storageAccounts[0],
        );

        expect(result.formComponents.blobContainerId.options).to.deep.equal([
            { displayName: "Container One", value: "bc1" },
            { displayName: "Container Two", value: "bc2" },
        ]);

        expect(result.formComponents.blobContainerId.placeholder).to.equal(
            LocConstants.BackupDatabase.selectABlobContainer,
        );

        expect(result.formState.blobContainerId).to.equal("bc1");
        expect(result.viewModel.model.blobContainers).to.equal(blobContainers);

        fetchBlobContainersStub.restore();
    });

    test("reloadAzureComponents resets downstream Azure components", () => {
        const state: BackupDatabaseViewModel = {
            viewModel: {
                model: {
                    azureComponentStatuses: {
                        accountId: ApiStatus.Loaded,
                        tenantId: ApiStatus.Loaded,
                        subscriptionId: ApiStatus.Loaded,
                        storageAccountId: ApiStatus.Loaded,
                        blobContainerId: ApiStatus.Loaded,
                    },
                },
                dialogType: ObjectManagementDialogType.BackupDatabase,
            },
            formState: {
                accountId: "acc1",
                tenantId: "tenant1",
                subscriptionId: "sub1",
                storageAccountId: "sa1",
                blobContainerId: "bc1",
            },
            formComponents: {
                accountId: { options: [{ label: "a" }] },
                tenantId: { options: [{ label: "t" }] },
                subscriptionId: { options: [{ label: "s" }] },
                storageAccountId: { options: [{ label: "sa" }] },
                blobContainerId: { options: [{ label: "bc" }] },
            },
        } as any;

        const result = (controller as any).reloadAzureComponents(state, "tenantId");

        /* ---------- Components BEFORE formComponent remain unchanged ---------- */
        expect(result.viewModel.model.azureComponentStatuses.accountId).to.equal(ApiStatus.Loaded);
        expect(result.viewModel.model.azureComponentStatuses.tenantId).to.equal(ApiStatus.Loaded);
        expect(result.formState.accountId).to.equal("acc1");
        expect(result.formState.tenantId).to.equal("tenant1");
        expect(result.formComponents.accountId.options).to.not.be.empty;
        expect(result.formComponents.tenantId.options).to.not.be.empty;

        /* ---------- Components AFTER formComponent are reset ---------- */
        expect(result.viewModel.model.azureComponentStatuses.subscriptionId).to.equal(
            ApiStatus.NotStarted,
        );
        expect(result.viewModel.model.azureComponentStatuses.storageAccountId).to.equal(
            ApiStatus.NotStarted,
        );
        expect(result.viewModel.model.azureComponentStatuses.blobContainerId).to.equal(
            ApiStatus.NotStarted,
        );
        expect(result.formState.subscriptionId).to.equal("");
        expect(result.formState.storageAccountId).to.equal("");
        expect(result.formState.blobContainerId).to.equal("");

        expect(result.formComponents.subscriptionId.options).to.deep.equal([]);
        expect(result.formComponents.storageAccountId.options).to.deep.equal([]);
        expect(result.formComponents.blobContainerId.options).to.deep.equal([]);
    });
    //#endregion
});
