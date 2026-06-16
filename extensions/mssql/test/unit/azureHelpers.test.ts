/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { AzureAccountService } from "../../src/services/azureAccountService";
import * as sinon from "sinon";
import * as azureHelpers from "../../src/connectionconfig/azureHelpers";
import { ILogger } from "../../src/sharedInterfaces/logger";
import { IAccount } from "vscode-mssql";
import * as vscode from "vscode";
import * as armStorage from "@azure/arm-storage";
import {
    mockAccounts,
    mockSqlDbList,
    mockAzureResources,
    mockManagedInstanceList,
    mockSubscriptions,
    mockTenants,
} from "./azureHelperStubs";
import { VSCodeAzureSubscriptionProvider } from "@microsoft/vscode-azext-azureauth";
import * as utils from "../../src/utils/utils";
import { BlobServiceClient } from "@azure/storage-blob";
import { createStubLogger } from "./utils";

chai.use(sinonChai);

suite("Azure Helpers", () => {
    let sandbox: sinon.SinonSandbox;
    let mockAzureAccountService: AzureAccountService;
    let mockLogger: sinon.SinonStubbedInstance<ILogger>;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockAzureAccountService = sandbox.createStubInstance(AzureAccountService);
        mockLogger = createStubLogger(sandbox);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("VsCodeAzureHelpers", () => {
        test("getAccounts", async () => {
            sandbox
                .stub(vscode.authentication, "getAccounts")
                .resolves([mockAccounts.signedInAccount, mockAccounts.notSignedInAccount]);

            sandbox.stub(azureHelpers.VsCodeAzureHelper, "getProvider").returns({
                getTenants: (account) => {
                    if (account.id === mockAccounts.signedInAccount.id) {
                        return Promise.resolve(mockTenants);
                    }
                    return Promise.reject("Not signed in");
                },
            } as unknown as VSCodeAzureSubscriptionProvider);

            const accounts = await azureHelpers.VsCodeAzureHelper.getAccounts(
                true /* onlyAllowedForExtension */,
            );

            expect(accounts, "Only signed-in accounts should be returned").to.deep.equal([
                mockAccounts.signedInAccount,
            ]);
        });

        test("signIn", async () => {
            const signInStub = sandbox.stub().resolves(true);
            const isSignedInStub = sandbox.stub();

            const mockAuthProvider = {
                signIn: signInStub,
                isSignedIn: isSignedInStub,
            };
            sandbox
                .stub(azureHelpers.VsCodeAzureHelper, "getProvider")
                .returns(mockAuthProvider as unknown as VSCodeAzureSubscriptionProvider);

            // Stub getAccounts so signIn can diff before/after to identify the new account
            const getAccountsStub = sandbox.stub(azureHelpers.VsCodeAzureHelper, "getAccounts");

            // Case: user should be prompted to sign in when not already signed in
            isSignedInStub.resolves(false);
            getAccountsStub.onFirstCall().resolves([]);
            getAccountsStub.onSecondCall().resolves([mockAccounts.signedInAccount]);

            let result = await azureHelpers.VsCodeAzureHelper.signIn(false /* forceSignInPrompt */);

            expect(result).to.not.be.undefined;
            expect(result!.auth).to.equal(mockAuthProvider);
            expect(result!.newAccountId).to.equal(
                mockAccounts.signedInAccount.id,
                "accountId should be the newly added account",
            );
            expect(signInStub.calledOnce, "signIn should be called once").to.be.true;
            expect(isSignedInStub.calledOnce, "isSignedIn should be called once").to.be.true;

            // Case: user should not be prompted to sign in when already signed in
            signInStub.resetHistory();
            isSignedInStub.reset();
            getAccountsStub.reset();
            isSignedInStub.resolves(true);
            getAccountsStub.resolves([mockAccounts.signedInAccount]);

            result = await azureHelpers.VsCodeAzureHelper.signIn(false /* forceSignInPrompt */);

            expect(result).to.not.be.undefined;
            expect(result!.auth).to.equal(mockAuthProvider);
            expect(result!.newAccountId).to.equal(
                mockAccounts.signedInAccount.id,
                "accountId should be the first existing account",
            );
            expect(signInStub.notCalled, "signIn should not be called").to.be.true;
            expect(isSignedInStub.calledOnce, "isSignedIn should be called once").to.be.true;

            // Case: user should be prompted to sign in when forceSignInPrompt is true
            signInStub.resetHistory();
            isSignedInStub.reset();
            getAccountsStub.reset();
            getAccountsStub.onFirstCall().resolves([]);
            getAccountsStub.onSecondCall().resolves([mockAccounts.signedInAccount]);

            result = await azureHelpers.VsCodeAzureHelper.signIn(true /* forceSignInPrompt */);

            expect(result).to.not.be.undefined;
            expect(result!.newAccountId).to.equal(
                mockAccounts.signedInAccount.id,
                "accountId should be the newly added account",
            );
            expect(signInStub.calledOnce, "signIn should be called once").to.be.true;
            expect(
                isSignedInStub.notCalled,
                "isSignedIn should not be called because the prompt is being forced",
            ).to.be.true;
        });

        test("getTenantsForAccount", async () => {
            const account = mockAccounts.signedInAccount;

            sandbox.stub(azureHelpers.VsCodeAzureHelper, "getProvider").returns({
                getTenants: (account) => {
                    // only the first account is signed in for this mock
                    if (account.id === mockAccounts.signedInAccount.id) {
                        return Promise.resolve(
                            mockTenants.filter((t) => t.account.id === account.id),
                        );
                    }
                    return Promise.reject("Not signed in");
                },
            } as unknown as VSCodeAzureSubscriptionProvider);

            const tenants = await azureHelpers.VsCodeAzureHelper.getTenantsForAccount(account);
            expect(tenants).to.deep.equal([mockTenants[1], mockTenants[0]]); // Tenants are returned alphabetically
        });

        test("getSubscriptionsForTenant", async () => {
            const tenant = mockTenants[0];

            sandbox.stub(azureHelpers.VsCodeAzureHelper, "getProvider").returns({
                getSubscriptions: () => Promise.resolve(mockSubscriptions),
            } as unknown as VSCodeAzureSubscriptionProvider);

            const subscriptions =
                await azureHelpers.VsCodeAzureHelper.getSubscriptionsForTenant(tenant);
            expect(subscriptions).to.have.lengthOf(1);
            expect(subscriptions[0].name).to.equal(mockSubscriptions[0].name);
        });
    });

    test("getTenants handles error cases", async () => {
        const getAccountStub = mockAzureAccountService.getAccount as sinon.SinonStub;
        // undefined tenants
        getAccountStub.resolves({
            displayInfo: {
                userId: "test-user-id",
            },
            properties: {
                tenants: undefined,
            },
        } as IAccount);

        let result = await azureHelpers.getTenants(
            mockAzureAccountService,
            "test-user-id",
            mockLogger,
        );
        expect(result).to.be.an("array").that.is.empty;

        // reset mocks for next case
        getAccountStub.reset();

        // undefined properties
        getAccountStub.resolves({
            displayInfo: {
                userId: "test-user-id",
            },
            properties: undefined,
        } as IAccount);

        result = await azureHelpers.getTenants(mockAzureAccountService, "test-user-id", mockLogger);
        expect(result).to.be.an("array").that.is.empty;
    });

    test("extractFromResourceId", () => {
        const resourceId =
            "subscriptions/test-subscription/resourceGroups/test-resource-group/providers/Microsoft.Sql/servers/test-server/databases/test-database";
        let result = azureHelpers.extractFromResourceId(resourceId, "servers");
        expect(result).to.equal("test-server");

        result = azureHelpers.extractFromResourceId(resourceId, "databases");
        expect(result).to.equal("test-database");

        result = azureHelpers.extractFromResourceId(resourceId, "fakeProperty");
        expect(result).to.be.undefined;
    });

    test("fetchServersFromAzure", async () => {
        sandbox
            .stub(azureHelpers.VsCodeAzureHelper, "fetchSqlResourcesForSubscription")
            .callsFake(async (sub, listServers /*, listDatabasesFactory */) => {
                const fnText = String(listServers);
                if (fnText.includes("managedInstances")) {
                    return mockManagedInstanceList;
                } else {
                    return mockSqlDbList;
                }
            });

        const servers = await azureHelpers.VsCodeAzureHelper.fetchServersFromAzure(
            mockSubscriptions[0],
        );

        expect(servers).to.have.lengthOf(4); // 1 SQL DB servers + 1 Synapse + 2 MI servers (public and private endpoints)
        expect(servers[0].displayName).to.equal(mockAzureResources.azureSqlDbServer.name);
        expect(servers[0].databases).to.deep.equal(["master", "testDatabase"]);
        expect(servers[1].displayName).to.equal(
            mockAzureResources.azureSynapseAnalyticsServer.name,
        );
        expect(servers[1].type).to.equal("AzureSynapseAnalytics");
        expect(servers[1].server).to.equal(
            `${mockAzureResources.azureSynapseAnalyticsServer.name}.sql.azuresynapse.net`,
        );
        const managedInstances = servers.filter((s) =>
            s.displayName.startsWith(mockAzureResources.azureManagedInstance.name),
        );

        expect(managedInstances).to.have.lengthOf(2);
        expect(managedInstances[0].displayName).to.equal(
            `${mockAzureResources.azureManagedInstance.name} (Private)`,
        );
        expect(managedInstances[0].databases).to.deep.equal(["managedInstanceDb"]);
        expect(managedInstances[0].server).to.equal(
            `${mockAzureResources.azureManagedInstance.name}.${mockAzureResources.azureManagedInstance.dnsZone}.database.windows.net`,
        );

        expect(managedInstances[1].displayName).to.equal(
            `${mockAzureResources.azureManagedInstance.name} (Public)`,
        );
        expect(managedInstances[1].databases).to.deep.equal(["managedInstanceDb"]);
        expect(managedInstances[1].server).to.equal(
            `${mockAzureResources.azureManagedInstance.name}.public.${mockAzureResources.azureManagedInstance.dnsZone}.database.windows.net,${azureHelpers.MANAGED_INSTANCE_PUBLIC_PORT}`,
        );
    });

    test("fetchSqlResourcesForSubscription", async () => {
        const listServersFactory = sandbox.stub().callsFake(
            () =>
                async function* () {
                    yield mockAzureResources.azureSqlDbServer;
                } as unknown as any,
        );

        const listDatabasesFactory = sandbox.stub().callsFake(
            () =>
                async function* (_resourceGroup?: string, _serverName?: string) {
                    yield mockAzureResources.azureSqlDbDatabase1;
                    yield mockAzureResources.azureSqlDbDatabase2;
                } as unknown as any,
        );

        const result = await azureHelpers.VsCodeAzureHelper.fetchSqlResourcesForSubscription(
            mockSubscriptions[0],
            listServersFactory,
            listDatabasesFactory,
        );

        const expectedResult = {
            servers: [mockAzureResources.azureSqlDbServer],
            databases: [
                {
                    ...mockAzureResources.azureSqlDbDatabase1,
                    server: mockAzureResources.azureSqlDbServer.name,
                },
                {
                    ...mockAzureResources.azureSqlDbDatabase2,
                    server: mockAzureResources.azureSqlDbServer.name,
                },
            ],
        };

        expect(result).to.deep.equal(expectedResult);
        expect(listServersFactory).to.have.been.calledOnce;
        expect(listDatabasesFactory).to.have.been.calledOnce;
    });

    test("fetchStorageAccountsForSubscription", async () => {
        const mockAccounts = [mockAzureResources.storageAccount];

        const clientStub = {
            storageAccounts: {
                list: sinon.stub().resolves(mockAccounts),
            },
        };

        const listStub = sandbox.stub(utils, "listAllIterator").callsFake((input) => input as any);

        // Stub the class constructor to return your stub instance
        sandbox.stub(armStorage, "StorageManagementClient").callsFake(() => clientStub);

        let result = await azureHelpers.VsCodeAzureHelper.fetchStorageAccountsForSubscription(
            mockSubscriptions[0],
            clientStub as unknown as armStorage.StorageManagementClient,
        );

        expect(result).to.deep.equal(mockAccounts);
        expect(listStub.calledOnce, "listAllIterator should be called once").to.be.true;
        expect(
            clientStub.storageAccounts.list.calledOnce,
            "storageAccounts.list should be called once",
        ).to.be.true;

        clientStub.storageAccounts.list = sinon.stub().rejects(new Error("Test error"));

        try {
            result = await azureHelpers.VsCodeAzureHelper.fetchStorageAccountsForSubscription(
                mockSubscriptions[0],
                clientStub as unknown as armStorage.StorageManagementClient,
            );
            expect.fail("Expected fetchStorageAccountsForSubscription to throw");
        } catch (e) {
            expect(e.message).to.equal("Test error");
        }
    });

    test("fetchBlobContainersForStorageAccount", async () => {
        const mockBlobs = [mockAzureResources.blobContainer];

        const clientStub = {
            blobContainers: {
                list: sinon.stub().resolves(mockBlobs),
            },
        };

        // Stub the class constructor to return your stub instance
        sandbox.stub(armStorage, "StorageManagementClient").callsFake(() => clientStub);

        const listStub = sandbox.stub(utils, "listAllIterator").callsFake((input) => input as any);

        let result = await azureHelpers.VsCodeAzureHelper.fetchBlobContainersForStorageAccount(
            mockSubscriptions[0],
            mockAzureResources.storageAccount,
            clientStub as unknown as armStorage.StorageManagementClient,
        );

        expect(result).to.deep.equal([mockAzureResources.blobContainer]);
        expect(listStub.calledOnce, "listAllIterator should be called once").to.be.true;
        expect(
            clientStub.blobContainers.list.calledOnce,
            "blobContainers.list should be called once",
        ).to.be.true;

        clientStub.blobContainers.list = sinon.stub().rejects(new Error("Test error"));
        try {
            result = await azureHelpers.VsCodeAzureHelper.fetchBlobContainersForStorageAccount(
                mockSubscriptions[0],
                mockAzureResources.storageAccount,
                clientStub as unknown as armStorage.StorageManagementClient,
            );
            expect.fail("Expected fetchBlobContainersForStorageAccount to throw");
        } catch (e) {
            expect(e.message).to.equal("Test error");
        }
    });

    test("getStorageAccountKeys", async () => {
        const mockKeys: armStorage.StorageAccountKey[] = [
            { keyName: "key1", value: "value1" },
            { keyName: "key2", value: "value2" },
        ];

        const clientStub = {
            storageAccounts: {
                listKeys: sinon
                    .stub()
                    .resolves({ keys: mockKeys } as armStorage.StorageAccountsListKeysResponse),
            },
        };

        // Stub the class constructor to return your stub instance
        sandbox.stub(armStorage, "StorageManagementClient").callsFake(() => clientStub);

        let result = (await azureHelpers.VsCodeAzureHelper.getStorageAccountKeys(
            mockSubscriptions[0],
            mockAzureResources.storageAccount,
            clientStub as unknown as armStorage.StorageManagementClient,
        )) as armStorage.StorageAccountsListKeysResponse;

        expect(result.keys).to.deep.equal(mockKeys);
        expect(
            clientStub.storageAccounts.listKeys.calledOnce,
            "storageAccounts.listKeys should be called once",
        ).to.be.true;

        clientStub.storageAccounts.listKeys = sinon.stub().rejects(new Error("Test error"));

        try {
            result = (await azureHelpers.VsCodeAzureHelper.getStorageAccountKeys(
                mockSubscriptions[0],
                mockAzureResources.storageAccount,
                clientStub as unknown as armStorage.StorageManagementClient,
            )) as armStorage.StorageAccountsListKeysResponse;
            expect.fail("Expected getStorageAccountKeys to throw");
        } catch (e) {
            expect(e.message).to.equal("Test error");
        }
    });

    test("fetchBlobsForContainer", async () => {
        const mockBlobs = [mockAzureResources.blob];

        const listBlobsFlatStub = sinon.stub().returns({
            [Symbol.asyncIterator]: async function* () {
                for (const blob of mockBlobs) {
                    yield blob;
                }
            },
        });

        const containerClientStub = {
            listBlobsFlat: listBlobsFlatStub,
        };

        const clientStub = {
            getContainerClient: sinon.stub().returns(containerClientStub),
        };

        // Stub the class constructor to return your stub instance
        sandbox.stub(azureHelpers.VsCodeAzureHelper, "getStorageAccountKeys").resolves({
            keys: [{ keyName: "key1", value: "value1" }],
        } as armStorage.StorageAccountsListKeysResponse);

        let result = await azureHelpers.VsCodeAzureHelper.fetchBlobsForContainer(
            mockSubscriptions[0],
            mockAzureResources.storageAccount,
            mockAzureResources.blobContainer,
            clientStub as unknown as BlobServiceClient,
        );

        expect(result).to.deep.equal(mockBlobs);
        expect(
            clientStub.getContainerClient().listBlobsFlat.calledOnce,
            "listBlobsFlat should be called once",
        ).to.be.true;

        const testError = new Error("Test error");
        clientStub.getContainerClient().listBlobsFlat = sinon.stub().returns({
            [Symbol.asyncIterator]: async function* () {
                throw testError;
            },
        });

        try {
            result = await azureHelpers.VsCodeAzureHelper.fetchBlobsForContainer(
                mockSubscriptions[0],
                mockAzureResources.storageAccount,
                mockAzureResources.blobContainer,
                clientStub as unknown as BlobServiceClient,
            );
            expect.fail("Expected fetchBlobsForContainer to throw");
        } catch (e) {
            expect(e).to.equal(testError);
        }
    });
});
