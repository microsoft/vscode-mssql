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
import { Logger } from "../../src/models/logger";
import { IAccount } from "vscode-mssql";
import * as vscode from "vscode";
import * as armSql from "@azure/arm-sql";
import * as armStorage from "@azure/arm-storage";
import {
    mockAccounts,
    mockSqlDbList,
    mockAzureResources,
    mockManagedInstanceList,
    mockSubscriptions,
    mockTenants,
} from "./azureHelperStubs";
import { MssqlVSCodeAzureSubscriptionProvider } from "../../src/azure/MssqlVSCodeAzureSubscriptionProvider";
import * as utils from "../../src/utils/utils";

chai.use(sinonChai);

suite("Azure Helpers", () => {
    let sandbox: sinon.SinonSandbox;
    let mockAzureAccountService: AzureAccountService;
    let mockLogger: Logger;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockAzureAccountService = sandbox.createStubInstance(AzureAccountService);
        mockLogger = sandbox.createStubInstance(Logger);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("VsCodeAzureHelpers", () => {
        test("getAccounts", async () => {
            sandbox
                .stub(vscode.authentication, "getAccounts")
                .resolves([mockAccounts.signedInAccount, mockAccounts.notSignedInAccount]);

            sandbox.stub(MssqlVSCodeAzureSubscriptionProvider, "getInstance").returns({
                getTenants: (account) => {
                    if (account.id === mockAccounts.signedInAccount.id) {
                        return Promise.resolve(mockTenants);
                    }
                    return Promise.reject("Not signed in");
                },
            } as MssqlVSCodeAzureSubscriptionProvider);

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

            sandbox.stub(MssqlVSCodeAzureSubscriptionProvider, "getInstance").returns({
                signIn: signInStub,
                isSignedIn: isSignedInStub,
            } as unknown as MssqlVSCodeAzureSubscriptionProvider);

            // Case: user should be prompted to sign in when not already signed in
            isSignedInStub.resolves(false);
            let result = await azureHelpers.VsCodeAzureHelper.signIn(false /* forceSignInPrompt */);

            expect(result).to.not.be.undefined;
            expect(signInStub.calledOnce, "signIn should be called once").to.be.true;
            expect(isSignedInStub.calledOnce, "isSignedIn should be called once").to.be.true;

            // Case: user should not be prompted to sign in when already signed in
            signInStub.resetHistory();
            isSignedInStub.reset();
            isSignedInStub.resolves(true);

            result = await azureHelpers.VsCodeAzureHelper.signIn(false /* forceSignInPrompt */);

            expect(result).to.not.be.undefined;
            expect(signInStub.notCalled, "signIn should not be called").to.be.true;
            expect(isSignedInStub.calledOnce, "isSignedIn should be called once").to.be.true;

            // Case: user should be prompted to sign in when forceSignInPrompt is true
            signInStub.resetHistory();
            isSignedInStub.reset();
            isSignedInStub.resolves(false);

            result = await azureHelpers.VsCodeAzureHelper.signIn(true /* forceSignInPrompt */);

            expect(result).to.not.be.undefined;
            expect(signInStub.calledOnce, "signIn should be called once").to.be.true;
            expect(
                isSignedInStub.notCalled,
                "isSignedIn should not be called because the prompt is being forced",
            ).to.be.true;
        });

        test("getTenantsForAccount", async () => {
            const account = mockAccounts.signedInAccount;

            sandbox.stub(MssqlVSCodeAzureSubscriptionProvider, "getInstance").returns({
                getTenants: (account) => {
                    // only the first account is signed in for this mock
                    if (account.id === mockAccounts.signedInAccount.id) {
                        return Promise.resolve(
                            mockTenants.filter((t) => t.account.id === account.id),
                        );
                    }
                    return Promise.reject("Not signed in");
                },
            } as MssqlVSCodeAzureSubscriptionProvider);

            const tenants = await azureHelpers.VsCodeAzureHelper.getTenantsForAccount(account);
            expect(tenants).to.deep.equal([mockTenants[1], mockTenants[0]]); // Tenants are returned alphabetically
        });

        test("getSubscriptionsForTenant", async () => {
            const tenant = mockTenants[0];

            sandbox.stub(MssqlVSCodeAzureSubscriptionProvider, "getInstance").returns({
                getSubscriptions: () => Promise.resolve(mockSubscriptions),
            } as MssqlVSCodeAzureSubscriptionProvider);

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
        expect(
            (mockLogger.error as sinon.SinonStub).calledWithMatch("undefined tenants"),
            "logger should have been called with 'undefined tenants'",
        ).to.be.true;

        // reset mocks for next case
        getAccountStub.reset();
        (mockLogger.error as sinon.SinonStub).resetHistory();

        // undefined properties
        getAccountStub.resolves({
            displayInfo: {
                userId: "test-user-id",
            },
            properties: undefined,
        } as IAccount);

        result = await azureHelpers.getTenants(mockAzureAccountService, "test-user-id", mockLogger);
        expect(result).to.be.an("array").that.is.empty;
        expect(
            (mockLogger.error as sinon.SinonStub).calledWithMatch("undefined properties"),
            "logger should have been called with 'undefined properties'",
        ).to.be.true;
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
        expect(servers[0].server).to.equal(mockAzureResources.azureSqlDbServer.name);
        expect(servers[0].databases).to.deep.equal(["master", "testDatabase"]);
        expect(servers[1].server).to.equal(mockAzureResources.azureSynapseAnalyticsServer.name);
        const managedInstances = servers.filter((s) =>
            s.server.startsWith(mockAzureResources.azureManagedInstance.name),
        );

        expect(managedInstances).to.have.lengthOf(2);
        expect(managedInstances[0].server).to.equal(
            `${mockAzureResources.azureManagedInstance.name} (Private)`,
        );
        expect(managedInstances[0].databases).to.deep.equal(["managedInstanceDb"]);
        expect(managedInstances[0].uri).to.equal(
            `${mockAzureResources.azureManagedInstance.name}.${mockAzureResources.azureManagedInstance.dnsZone}.database.windows.net`,
        );

        expect(managedInstances[1].server).to.equal(
            `${mockAzureResources.azureManagedInstance.name} (Public)`,
        );
        expect(managedInstances[1].databases).to.deep.equal(["managedInstanceDb"]);
        expect(managedInstances[1].uri).to.equal(
            `${mockAzureResources.azureManagedInstance.name}.public.${mockAzureResources.azureManagedInstance.dnsZone}.database.windows.net,${azureHelpers.MANAGED_INSTANCE_PUBLIC_PORT}`,
        );
    });

    test("fetchSqlResourcesForSubscription", async () => {
        sandbox.stub(armSql, "SqlManagementClient").callsFake(
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            (credential: any, subscriptionId: string, options?: any) => {
                return {} as armSql.SqlManagementClient;
            },
        );

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

        const listStub = sinon.stub(utils, "listAllIterator").callsFake((input) => input as any);

        // Stub the class constructor to return your stub instance
        const storageStub = sinon
            .stub(armStorage, "StorageManagementClient")
            .callsFake(() => clientStub);

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

        storageStub.restore();
        listStub.restore();
    });

    test("fetchBlobContainersForStorageAccount", async () => {
        const mockBlobs = [mockAzureResources.blobContainer];

        const clientStub = {
            blobContainers: {
                list: sinon.stub().resolves(mockBlobs),
            },
        };

        // Stub the class constructor to return your stub instance
        const storageStub = sinon
            .stub(armStorage, "StorageManagementClient")
            .callsFake(() => clientStub);

        const listStub = sinon.stub(utils, "listAllIterator").callsFake((input) => input as any);

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

        storageStub.restore();
        listStub.restore();
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
        const storageStub = sinon
            .stub(armStorage, "StorageManagementClient")
            .callsFake(() => clientStub);

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

        storageStub.restore();
    });
});
