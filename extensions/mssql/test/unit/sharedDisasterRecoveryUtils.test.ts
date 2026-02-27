/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import * as LocConstants from "../../src/constants/locConstants";
import * as azureHelpers from "../../src/connectionconfig/azureHelpers";
import {
    DisasterRecoveryAzureFormState,
    DisasterRecoveryType,
    DisasterRecoveryViewModel,
    ObjectManagementDialogType,
    ObjectManagementWebviewState,
} from "../../src/sharedInterfaces/objectManagement";
import * as utils from "../../src/controllers/sharedDisasterRecoveryUtils";
import { BackupDatabaseFormState } from "../../src/sharedInterfaces/backup";
import * as azureSettings from "../../src/azure/providerSettings";
import { AzureBlobService } from "../../src/services/azureBlobService";

chai.use(sinonChai);

suite("Shared Disaster Recovery Utils", () => {
    let sandbox: sinon.SinonSandbox;
    let mockInitialState: ObjectManagementWebviewState<DisasterRecoveryAzureFormState>;
    let mockAzureBlobService: AzureBlobService;

    setup(async () => {
        sandbox = sinon.createSandbox();

        mockAzureBlobService = sinon.createStubInstance(AzureBlobService);

        mockInitialState = {
            viewModel: {
                model: {
                    azureComponentStatuses: {
                        accountId: ApiStatus.NotStarted,
                        tenantId: ApiStatus.NotStarted,
                        subscriptionId: ApiStatus.NotStarted,
                        storageAccountId: ApiStatus.NotStarted,
                        blobContainerId: ApiStatus.NotStarted,
                    },
                    loadState: ApiStatus.Loading,
                    type: DisasterRecoveryType.BackupFile,
                    backupFiles: [],
                    url: "",
                    tenants: [],
                    subscriptions: [],
                    storageAccounts: [],
                    blobContainers: [],
                } as DisasterRecoveryViewModel,
            },
            formState: {
                accountId: "",
                tenantId: "",
                subscriptionId: "",
                storageAccountId: "",
                blobContainerId: "",
            },
            formErrors: [],
            formComponents: {
                accountId: {
                    options: [],
                    placeholder: "",
                    actionButtons: [],
                    isAdvancedOption: false,
                },
                tenantId: { options: [], placeholder: "", isAdvancedOption: false },
                subscriptionId: { options: [], placeholder: "", isAdvancedOption: false },
                storageAccountId: { options: [], placeholder: "", isAdvancedOption: false },
                blobContainerId: { options: [], placeholder: "", isAdvancedOption: false },
            },
        } as ObjectManagementWebviewState<DisasterRecoveryAzureFormState>;
    });

    teardown(() => {
        sandbox.restore();
    });

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

        const getAzureActionButtonStub = sandbox.spy(utils, "getAzureActionButton");

        const buttons = await utils.getAzureActionButton(
            state as ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
        );

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

        expect(getAzureActionButtonStub.callCount).to.equal(1);

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

        const state = {
            ...mockInitialState,
            formComponents: {
                accountId: { options: [], placeholder: "", isAdvancedOption: false },
            },
        };

        const result = await utils.loadAccountComponent(
            state as ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
        );

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
        expect(result.formComponents.accountId.actionButtons[0].label).to.equal("Add account");

        // State object returned
        expect(result).to.equal(state);

        getAccountsStub.restore();
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
        let result = await utils.loadTenantComponent(
            state as ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
        );

        expect(
            (result.viewModel.model as DisasterRecoveryViewModel).azureComponentStatuses.tenantId,
        ).to.equal(ApiStatus.Error);
        expect(result.formComponents.tenantId.placeholder).to.equal(
            LocConstants.BackupDatabase.noTenantsFound,
        );
        expect(result.formComponents.tenantId.options).to.deep.equal([]);
        expect(result.formState.tenantId).to.equal("");

        /* ----------- AccountId set: success path ----------- */
        result.formState.accountId = "account1";
        (result.viewModel.model as DisasterRecoveryViewModel).azureComponentStatuses.tenantId =
            ApiStatus.NotStarted;

        result = await utils.loadTenantComponent(result);

        expect(getTenantsStub).to.have.been.calledOnceWith("account1");

        expect(result.formComponents.tenantId.options).to.deep.equal([
            { displayName: "Tenant One", value: "t1" },
            { displayName: "Tenant Two", value: "t2" },
        ]);

        expect(result.formComponents.tenantId.placeholder).to.equal(
            LocConstants.ConnectionDialog.selectATenant,
        );

        expect(result.formState.tenantId).to.equal("t1");
        expect((result.viewModel.model as DisasterRecoveryViewModel).tenants).to.equal(tenants);

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
        let result = await utils.loadSubscriptionComponent(
            state as ObjectManagementWebviewState<DisasterRecoveryAzureFormState>,
        );

        expect(
            (result.viewModel.model as DisasterRecoveryViewModel).azureComponentStatuses
                .subscriptionId,
        ).to.equal(ApiStatus.Error);
        expect(result.formComponents.subscriptionId.placeholder).to.equal(
            LocConstants.BackupDatabase.noSubscriptionsFound,
        );
        expect(result.formComponents.subscriptionId.options).to.deep.equal([]);
        expect(result.formState.subscriptionId).to.equal("");

        /* ---------- TenantId set: success path ---------- */
        result.formState.tenantId = "tenant1";
        (
            result.viewModel.model as DisasterRecoveryViewModel
        ).azureComponentStatuses.subscriptionId = ApiStatus.NotStarted;
        result = await utils.loadSubscriptionComponent(result);

        expect(getSubscriptionsStub).to.have.been.calledOnceWith(
            (result.viewModel.model as DisasterRecoveryViewModel).tenants[0],
        );

        expect(result.formComponents.subscriptionId.options).to.deep.equal([
            { displayName: "Subscription One", value: "sub1" },
            { displayName: "Subscription Two", value: "sub2" },
        ]);

        expect(result.formState.subscriptionId).to.equal("sub1");

        expect(result.formComponents.subscriptionId.placeholder).to.equal(
            LocConstants.BackupDatabase.selectASubscription,
        );

        expect((result.viewModel.model as DisasterRecoveryViewModel).subscriptions).to.equal(
            subscriptions,
        );

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
        let result = await utils.loadStorageAccountComponent(state);

        expect(
            (result.viewModel.model as DisasterRecoveryViewModel).azureComponentStatuses
                .storageAccountId,
        ).to.equal(ApiStatus.Error);
        expect(result.formComponents.storageAccountId.placeholder).to.equal(
            LocConstants.BackupDatabase.noStorageAccountsFound,
        );
        expect(result.formComponents.storageAccountId.options).to.deep.equal([]);
        expect(result.formState.storageAccountId).to.equal("");

        /* ---------- Subscription set, fetch throws Error ---------- */
        result.formState.subscriptionId = "sub1";
        (
            result.viewModel.model as DisasterRecoveryViewModel
        ).azureComponentStatuses.storageAccountId = ApiStatus.NotStarted;
        fetchStorageAccountsStub.rejects(new Error("fetch failed"));

        result = await utils.loadStorageAccountComponent(result);

        expect(result.formComponents.storageAccountId.placeholder).to.equal(
            LocConstants.BackupDatabase.noStorageAccountsFound,
        );
        expect(result.formComponents.storageAccountId.options).to.deep.equal([]);
        expect((result.viewModel.model as DisasterRecoveryViewModel).storageAccounts).to.deep.equal(
            [],
        );
        expect(result.formState.storageAccountId).to.equal("");
        expect(result.errorMessage).to.equal("fetch failed");

        /* ---------- Fetch returns empty array ---------- */
        fetchStorageAccountsStub.resolves([]);

        result = await utils.loadStorageAccountComponent(result);

        expect(result.formComponents.storageAccountId.placeholder).to.equal(
            LocConstants.BackupDatabase.noStorageAccountsFound,
        );
        expect(result.formComponents.storageAccountId.options).to.deep.equal([]);
        expect((result.viewModel.model as DisasterRecoveryViewModel).storageAccounts).to.deep.equal(
            [],
        );
        expect(result.formState.storageAccountId).to.equal("");

        /* ---------- Fetch returns storage accounts ---------- */
        fetchStorageAccountsStub.resolves(storageAccounts as any);

        result = await utils.loadStorageAccountComponent(result);

        expect(fetchStorageAccountsStub).to.have.been.calledWith(
            (result.viewModel.model as DisasterRecoveryViewModel).subscriptions[0],
        );

        expect(result.formComponents.storageAccountId.options).to.deep.equal([
            { displayName: "Storage Account 1", value: "sa1" },
            { displayName: "Storage Account 2", value: "sa2" },
        ]);

        expect(result.formComponents.storageAccountId.placeholder).to.equal(
            LocConstants.BackupDatabase.selectAStorageAccount,
        );

        expect(result.formState.storageAccountId).to.equal("sa1");
        expect((result.viewModel.model as DisasterRecoveryViewModel).storageAccounts).to.equal(
            storageAccounts,
        );
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
        let result = await utils.loadBlobContainerComponent(state);

        expect(
            (result.viewModel.model as DisasterRecoveryViewModel).azureComponentStatuses
                .blobContainerId,
        ).to.equal(ApiStatus.Error);
        expect(result.formComponents.blobContainerId.placeholder).to.equal(
            LocConstants.BackupDatabase.noBlobContainersFound,
        );
        expect(result.formComponents.blobContainerId.options).to.deep.equal([]);
        expect(result.formState.blobContainerId).to.equal("");

        /* ---------- IDs set, fetch throws Error ---------- */
        result.formState.subscriptionId = "sub1";
        result.formState.storageAccountId = "sa1";
        (
            result.viewModel.model as DisasterRecoveryViewModel
        ).azureComponentStatuses.blobContainerId = ApiStatus.NotStarted;

        fetchBlobContainersStub.rejects(new Error("fetch failed"));

        result = await utils.loadBlobContainerComponent(result);

        expect(result.formComponents.blobContainerId.placeholder).to.equal(
            LocConstants.BackupDatabase.noBlobContainersFound,
        );
        expect(result.formComponents.blobContainerId.options).to.deep.equal([]);
        expect((result.viewModel.model as DisasterRecoveryViewModel).blobContainers).to.deep.equal(
            [],
        );
        expect(result.formState.blobContainerId).to.equal("");
        expect(result.errorMessage).to.equal("fetch failed");

        /* ---------- Fetch returns empty array ---------- */
        fetchBlobContainersStub.resolves([]);

        result = await utils.loadBlobContainerComponent(result);

        expect(result.formComponents.blobContainerId.placeholder).to.equal(
            LocConstants.BackupDatabase.noBlobContainersFound,
        );
        expect(result.formComponents.blobContainerId.options).to.deep.equal([]);
        expect((result.viewModel.model as DisasterRecoveryViewModel).blobContainers).to.deep.equal(
            [],
        );
        expect(result.formState.blobContainerId).to.equal("");

        /* ---------- Fetch returns blob containers ---------- */
        fetchBlobContainersStub.resolves(blobContainers as any);

        result = await utils.loadBlobContainerComponent(result);

        expect(fetchBlobContainersStub).to.have.been.calledWith(
            (result.viewModel.model as DisasterRecoveryViewModel).subscriptions[0],
            (result.viewModel.model as DisasterRecoveryViewModel).storageAccounts[0],
        );

        expect(result.formComponents.blobContainerId.options).to.deep.equal([
            { displayName: "Container One", value: "bc1" },
            { displayName: "Container Two", value: "bc2" },
        ]);

        expect(result.formComponents.blobContainerId.placeholder).to.equal(
            LocConstants.BackupDatabase.selectABlobContainer,
        );

        expect(result.formState.blobContainerId).to.equal("bc1");
        expect((result.viewModel.model as DisasterRecoveryViewModel).blobContainers).to.equal(
            blobContainers,
        );

        fetchBlobContainersStub.restore();
    });

    test("reloadAzureComponents resets downstream Azure components for backup dialog", () => {
        const state = {
            viewModel: {
                model: {
                    azureComponentStatuses: {
                        accountId: ApiStatus.Loaded,
                        tenantId: ApiStatus.Loaded,
                        subscriptionId: ApiStatus.Loaded,
                        storageAccountId: ApiStatus.Loaded,
                        blobContainerId: ApiStatus.Loaded,
                    },
                    loadState: ApiStatus.Loading,
                    type: DisasterRecoveryType.BackupFile,
                    backupFiles: [],
                    url: "",
                    tenants: [],
                    subscriptions: [],
                    storageAccounts: [],
                    blobContainers: [],
                } as DisasterRecoveryViewModel,
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
            formErrors: [],
        } as unknown as ObjectManagementWebviewState<DisasterRecoveryAzureFormState>;

        const result = utils.reloadAzureComponents(state, "tenantId");

        /* ---------- Components BEFORE formComponent remain unchanged ---------- */
        expect(
            (result.viewModel.model as DisasterRecoveryViewModel).azureComponentStatuses.accountId,
        ).to.equal(ApiStatus.Loaded);
        expect(
            (result.viewModel.model as DisasterRecoveryViewModel).azureComponentStatuses.tenantId,
        ).to.equal(ApiStatus.Loaded);
        expect(result.formState.accountId).to.equal("acc1");
        expect(result.formState.tenantId).to.equal("tenant1");
        expect(result.formComponents.accountId.options).to.not.be.empty;
        expect(result.formComponents.tenantId.options).to.not.be.empty;

        /* ---------- Components AFTER formComponent are reset ---------- */
        expect(
            (result.viewModel.model as DisasterRecoveryViewModel).azureComponentStatuses
                .subscriptionId,
        ).to.equal(ApiStatus.NotStarted);
        expect(
            (result.viewModel.model as DisasterRecoveryViewModel).azureComponentStatuses
                .storageAccountId,
        ).to.equal(ApiStatus.NotStarted);
        expect(
            (result.viewModel.model as DisasterRecoveryViewModel).azureComponentStatuses
                .blobContainerId,
        ).to.equal(ApiStatus.NotStarted);
        expect(result.formState.subscriptionId).to.equal("");
        expect(result.formState.storageAccountId).to.equal("");
        expect(result.formState.blobContainerId).to.equal("");

        expect(result.formComponents.subscriptionId.options).to.deep.equal([]);
        expect(result.formComponents.storageAccountId.options).to.deep.equal([]);
        expect(result.formComponents.blobContainerId.options).to.deep.equal([]);
    });

    test("reloadAzureComponents resets downstream Azure components", () => {
        const state = {
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

        const result = utils.reloadAzureComponents(state, "tenantId");

        /* ---------- Components BEFORE formComponent remain unchanged ---------- */
        expect(
            (result.viewModel.model as DisasterRecoveryViewModel).azureComponentStatuses.accountId,
        ).to.equal(ApiStatus.Loaded);
        expect(
            (result.viewModel.model as DisasterRecoveryViewModel).azureComponentStatuses.tenantId,
        ).to.equal(ApiStatus.Loaded);
        expect(result.formState.accountId).to.equal("acc1");
        expect(result.formState.tenantId).to.equal("tenant1");
        expect(result.formComponents.accountId.options).to.not.be.empty;
        expect(result.formComponents.tenantId.options).to.not.be.empty;

        /* ---------- Components AFTER formComponent are reset ---------- */
        expect(
            (result.viewModel.model as DisasterRecoveryViewModel).azureComponentStatuses
                .subscriptionId,
        ).to.equal(ApiStatus.NotStarted);
        expect(
            (result.viewModel.model as DisasterRecoveryViewModel).azureComponentStatuses
                .storageAccountId,
        ).to.equal(ApiStatus.NotStarted);
        expect(
            (result.viewModel.model as DisasterRecoveryViewModel).azureComponentStatuses
                .blobContainerId,
        ).to.equal(ApiStatus.NotStarted);
        expect(result.formState.subscriptionId).to.equal("");
        expect(result.formState.storageAccountId).to.equal("");
        expect(result.formState.blobContainerId).to.equal("");

        expect(result.formComponents.subscriptionId.options).to.deep.equal([]);
        expect(result.formComponents.storageAccountId.options).to.deep.equal([]);
        expect(result.formComponents.blobContainerId.options).to.deep.equal([]);
    });

    test("disasterRecoveryFormAction", async () => {
        const testStub = sinon.stub();

        const state = {
            ...mockInitialState,
            viewModel: {
                model: {
                    azureComponentStatuses: {
                        accountId: "Loaded",
                        tenantId: "Loaded",
                        subscriptionId: "Loaded",
                    },
                },
            },
            formState: {
                ...mockInitialState.formState,
                accountId: "",
                tenantId: "oldTenant",
                subscriptionId: "oldSub",
                copyOnly: false,
            },
            formComponents: {
                accountId: {
                    options: [],
                    actionButtons: [
                        {
                            label: "testButton",
                            id: "testButtonId",
                            callback: async () => {
                                testStub();
                            },
                        },
                    ],
                    validate: (state: BackupDatabaseFormState, value: string) => {
                        return { isValid: false, validationMessage: "accountId is required" };
                    },
                },
                tenantId: {
                    options: ["x"],
                    validate: (state: BackupDatabaseFormState, value: string) => {
                        return { isValid: true };
                    },
                },
                subscriptionId: { options: ["y"] },
            },
            formErrors: ["tenantId"],
        } as any;

        let result = await utils.disasterRecoveryFormAction<BackupDatabaseFormState>(state, {
            event: { isAction: true, propertyName: "accountId", value: "testButtonId" },
        });

        expect(testStub).to.have.been.calledOnce;

        // verify reload side effects instead of stub
        expect(result.formState.tenantId).to.equal("");
        expect(result.formState.subscriptionId).to.equal("");
        expect(result.formComponents.tenantId.options).to.deep.equal([]);
        expect(result.formComponents.subscriptionId.options).to.deep.equal([]);

        result = await utils.disasterRecoveryFormAction(state, {
            event: { isAction: false, propertyName: "accountId", value: "" },
        });

        expect(result.formErrors).to.include("accountId");

        result = await utils.disasterRecoveryFormAction<BackupDatabaseFormState>(state, {
            event: { isAction: false, propertyName: "tenantId", value: "valid" },
        });

        expect(result.formErrors).to.not.include("tenantId");

        result = await utils.disasterRecoveryFormAction<BackupDatabaseFormState>(state, {
            event: { isAction: false, propertyName: "copyOnly", value: true },
        });

        expect(result.formState.copyOnly).to.be.true;

        expect(result.formState.tenantId).to.equal("valid");
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
        } as ObjectManagementWebviewState<DisasterRecoveryAzureFormState>;

        const result = await utils.removeBackupFile(state, {
            filePath: "path1",
        });
        expect((result.viewModel.model as DisasterRecoveryViewModel).backupFiles.length).to.equal(
            1,
        );
        expect(
            (result.viewModel.model as DisasterRecoveryViewModel).backupFiles[0].filePath,
        ).to.equal("path2");
    });

    test("loadAzureComponentHelper", async () => {
        let result = await utils.loadAzureComponentHelper(mockInitialState, {
            componentName: "accountId",
        });
        expect(
            (result.viewModel.model as DisasterRecoveryViewModel).azureComponentStatuses.accountId,
        ).to.equal(ApiStatus.Loaded);

        result = await utils.loadAzureComponentHelper(mockInitialState, {
            componentName: "accountId",
        });
        expect(
            (result.viewModel.model as DisasterRecoveryViewModel).azureComponentStatuses.accountId,
        ).to.equal(ApiStatus.Loaded);

        result = await utils.loadAzureComponentHelper(mockInitialState, {
            componentName: "tenantId",
        });
        expect(
            (result.viewModel.model as DisasterRecoveryViewModel).azureComponentStatuses.tenantId,
        ).to.equal(ApiStatus.Loaded);

        result = await utils.loadAzureComponentHelper(mockInitialState, {
            componentName: "subscriptionId",
        });
        expect(
            (result.viewModel.model as DisasterRecoveryViewModel).azureComponentStatuses
                .subscriptionId,
        ).to.equal(ApiStatus.Loaded);

        result = await utils.loadAzureComponentHelper(mockInitialState, {
            componentName: "storageAccountId",
        });
        expect(
            (result.viewModel.model as DisasterRecoveryViewModel).azureComponentStatuses
                .storageAccountId,
        ).to.equal(ApiStatus.Loaded);

        result = await utils.loadAzureComponentHelper(mockInitialState, {
            componentName: "blobContainerId",
        });
        expect(
            (result.viewModel.model as DisasterRecoveryViewModel).azureComponentStatuses
                .blobContainerId,
        ).to.equal(ApiStatus.Loaded);
    });

    test("getUrl constructs correct Azure blob storage URL for different accounts and containers", () => {
        const mockStorageAccounts = [
            { id: "sa1", name: "mystorageaccount" },
            { id: "sa2", name: "secondstorage" },
        ];

        const mockBlobContainers = [
            { id: "bc1", name: "container1" },
            { id: "bc2", name: "backupcontainer" },
        ];

        const mockCloudProviderSettings = {
            settings: {
                azureStorageResource: {
                    endpoint: "https://blob.core.windows.net/",
                },
            },
        };

        const getCloudProviderSettingsStub = sandbox
            .stub(azureSettings, "getCloudProviderSettings")
            .returns(mockCloudProviderSettings as any);

        /* ---------- First storage account and container ---------- */
        let state = {
            viewModel: {
                model: {
                    storageAccounts: mockStorageAccounts,
                    blobContainers: mockBlobContainers,
                } as DisasterRecoveryViewModel,
            },
            formState: {
                storageAccountId: "sa1",
                blobContainerId: "bc1",
            },
        } as ObjectManagementWebviewState<DisasterRecoveryAzureFormState>;

        let result = utils.getUrl(state);

        expect(result).to.equal("https://mystorageaccount.blob.core.windows.net/container1");

        /* ---------- Second storage account and container ---------- */
        state.formState.storageAccountId = "sa2";
        state.formState.blobContainerId = "bc2";

        result = utils.getUrl(state);

        expect(result).to.equal("https://secondstorage.blob.core.windows.net/backupcontainer");

        getCloudProviderSettingsStub.restore();
    });

    test("createSasKey generates SAS key for URL type and handles various scenarios", async () => {
        const state = {
            ...mockInitialState,
            formState: {
                ...mockInitialState.formState,
                subscriptionId: "sub1",
                storageAccountId: "sa1",
                blobContainerId: "bc1",
            },
            viewModel: {
                model: {
                    ...mockInitialState.viewModel.model,
                    subscriptions: [{ subscriptionId: "sub1", name: "Subscription 1" }],
                    storageAccounts: [{ id: "sa1", name: "mystorageaccount" }],
                    blobContainers: [{ id: "bc1", name: "container1" }],
                    type: DisasterRecoveryType.BackupFile,
                },
            },
        } as ObjectManagementWebviewState<DisasterRecoveryAzureFormState>;

        const mockCloudProviderSettings = {
            settings: {
                azureStorageResource: {
                    endpoint: "https://blob.core.windows.net/",
                },
            },
        };

        let getCloudProviderSettingsStub = sinon
            .stub(azureSettings, "getCloudProviderSettings")
            .returns(mockCloudProviderSettings as any);

        const mockSasKeyResult = {
            keys: [{ value: "mockStorageKey123" }],
        };

        let getStorageKeyStub = sinon
            .stub(azureHelpers.VsCodeAzureHelper, "getStorageAccountKeys")
            .resolves(mockSasKeyResult as any);

        await utils.createSasKey(state, "ownerUri", mockAzureBlobService);

        expect(getStorageKeyStub).to.not.have.been.called;
        expect(getCloudProviderSettingsStub).to.not.have.been.called;

        (state.viewModel.model as DisasterRecoveryViewModel).type = DisasterRecoveryType.Url;

        await utils.createSasKey(state, "ownerUri", mockAzureBlobService);

        expect(getStorageKeyStub).to.have.been.calledOnce;
        expect(getCloudProviderSettingsStub).to.have.been.calledOnce;

        getStorageKeyStub.resetHistory();
        getCloudProviderSettingsStub.resetHistory();

        state.formState.subscriptionId = "";

        await utils.createSasKey(state, "ownerUri", mockAzureBlobService);
        expect(getStorageKeyStub).to.not.have.been.called;
        expect(getCloudProviderSettingsStub).to.not.have.been.called;

        getStorageKeyStub.resetHistory();
        getCloudProviderSettingsStub.resetHistory();

        state.formState.storageAccountId = "";
        state.formState.subscriptionId = "sub1";
        await utils.createSasKey(state, "ownerUri", mockAzureBlobService);
        expect(getStorageKeyStub).to.not.have.been.called;
        expect(getCloudProviderSettingsStub).to.not.have.been.called;

        getStorageKeyStub.resetHistory();
        getCloudProviderSettingsStub.resetHistory();

        const showErrorMessageStub = sandbox.stub(vscode.window, "showErrorMessage");
        state.formState.storageAccountId = "sa1";
        getStorageKeyStub.rejects(new Error("Failed to generate SAS key"));
        await utils.createSasKey(state, "ownerUri", mockAzureBlobService);

        expect(showErrorMessageStub).to.have.been.calledOnce;

        showErrorMessageStub.restore();
        getStorageKeyStub.restore();
        getCloudProviderSettingsStub.restore();
    });
});
